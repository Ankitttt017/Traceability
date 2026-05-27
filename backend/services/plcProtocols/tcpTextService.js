const { withTimeout } = require("./utils");
const { withSocket } = require("./socketPool");

const DEFAULT_CONNECT_TIMEOUT_MS = Number(process.env.PLC_CONNECT_TIMEOUT_MS || 2000);
const DEFAULT_START_ACK_TIMEOUT_MS = Number(process.env.PLC_START_ACK_TIMEOUT_MS || 3000);
const DEFAULT_END_ACK_TIMEOUT_MS = Number(process.env.PLC_END_ACK_TIMEOUT_MS || 120000);

function normalizeMessage(raw) {
  return String(raw || "").trim().replace(/\r/g, "");
}

const ACK_SUCCESS_LIST = ["ACK", "OK", "READY", "0", "ACK_START", "ACK_END_OK"];

function parseAck(message) {
  const normalized = String(message || "").trim().toUpperCase();
  if (!normalized) return { type: "NACK", partId: null };

  // Support both "TYPE|PART_ID" and simple "TYPE"
  const tokens = normalized.split(/[|,:;]/);
  const typeToken = tokens[0].trim();
  const partIdToken = tokens.length > 1 ? tokens[1].trim() : null;

  // Map simple successes to standard types if needed, or return as is
  let type = typeToken;
  if (ACK_SUCCESS_LIST.includes(typeToken)) {
    // If it's a generic success but we need a specific type, we'll handle it in the caller
  } else if (typeToken.includes("ERR") || typeToken.includes("FAIL")) {
    type = "NACK";
  }

  return { type, partId: partIdToken, raw: normalized };
}

function waitForMatchingAck(socket, partId, acceptedTypes, timeoutMs) {
  return withTimeout(
    new Promise((resolve, reject) => {
      let buffer = "";

      const cleanup = () => {
        socket.off("data", onData);
        socket.off("error", onError);
      };

      const onError = (error) => {
        cleanup();
        reject(error);
      };

      const onData = (data) => {
        buffer += data.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          const ack = parseAck(line);
          const typeMatch = acceptedTypes.includes(ack.type) || 
                            (acceptedTypes.includes("ACK_START") && ACK_SUCCESS_LIST.includes(ack.type));
          
          // Flexible Matching: If PLC echoes PartID, it must match. 
          // If PLC sends simple ACK (no PartID), we accept it.
          const partIdMatch = !ack.partId || ack.partId === partId;

          if (typeMatch && partIdMatch) {
            cleanup();
            resolve(ack);
            return;
          }
        }
      };

      socket.on("data", onData);
      socket.on("error", onError);
    }),
    timeoutMs,
    `PLC ACK timeout (${acceptedTypes.join(",")})`
  );
}

async function handshake({ ip, port, partId, stationNo, protocol = "TCP_TEXT" }) {
  return withSocket({ ip, port, timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS }, async (socket) => {
    socket.write(`START_OPERATION|${partId}|${stationNo}\n`);

    const startAck = await waitForMatchingAck(socket, partId, ["ACK_START"], DEFAULT_START_ACK_TIMEOUT_MS);
    const endAck = await waitForMatchingAck(
      socket,
      partId,
      ["ACK_END_OK", "ACK_END_NG"],
      DEFAULT_END_ACK_TIMEOUT_MS
    );

    return {
      ok: true,
      startAck,
      endAck,
      protocol,
    };
  });
}

async function reset({ ip, port, stationNo, protocol = "TCP_TEXT" }) {
  return withSocket({ ip, port, timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS }, async (socket) => {
    const station = String(stationNo || "").trim();
    const command = station ? `RESET_OPERATION|${station}\n` : "RESET_OPERATION\n";
    socket.write(command);
    return {
      protocol,
      connected: true,
      resetCommand: command.trim(),
    };
  });
}

async function probe({ ip, port, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS, protocol = "TCP_TEXT" }) {
  return withSocket({ ip, port, timeoutMs }, async () => ({
    protocol,
    connected: true,
  }));
}

async function sendCommand({ ip, port, command, partId, stationNo, protocol = "TCP_TEXT" }) {
  return withSocket({ ip, port, timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS }, async (socket) => {
    const normalized = String(command || "").trim().toUpperCase();
    let payload = normalized;
    if (normalized === "START_OPERATION") {
      payload = `START_OPERATION|${partId || ""}|${stationNo || ""}`;
    } else if (normalized === "BLOCK_OPERATION") {
      payload = `BLOCK_OPERATION|${partId || ""}|${stationNo || ""}`;
    } else if (normalized === "RESET_OPERATION") {
      payload = stationNo ? `RESET_OPERATION|${stationNo}` : "RESET_OPERATION";
    }
    socket.write(`${payload}\n`);
    return {
      protocol,
      command: normalized,
      payload,
      connected: true,
    };
  });
}

module.exports = {
  handshake,
  probe,
  reset,
  sendCommand,
};
