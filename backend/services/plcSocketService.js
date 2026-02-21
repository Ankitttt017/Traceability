const net = require("net");
const { emitRealtime } = require("./realtimeService");

const DEFAULT_CONNECT_TIMEOUT_MS = Number(process.env.PLC_CONNECT_TIMEOUT_MS || 2000);
const DEFAULT_START_ACK_TIMEOUT_MS = Number(process.env.PLC_START_ACK_TIMEOUT_MS || 3000);
const DEFAULT_END_ACK_TIMEOUT_MS = Number(process.env.PLC_END_ACK_TIMEOUT_MS || 120000);
const DEFAULT_RETRIES = Number(process.env.PLC_RETRY_COUNT || 3);
const DEFAULT_MODBUS_POLL_INTERVAL_MS = Number(process.env.PLC_MODBUS_POLL_INTERVAL_MS || 150);

function normalizeMessage(raw) {
  return String(raw || "").trim().replace(/\r/g, "");
}

function parseAck(message) {
  const normalized = normalizeMessage(message);
  const [type, partId] = normalized.split("|");
  return { type, partId };
}

function normalizeProtocol(value) {
  const protocol = String(value || "").trim().toUpperCase();
  return protocol === "MODBUS_TCP" ? "MODBUS_TCP" : "TCP_TEXT";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function createSocketClient({ ip, port }) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (fn) => (value) => {
      if (settled) {
        return;
      }
      settled = true;
      fn(value);
    };

    socket.setTimeout(DEFAULT_CONNECT_TIMEOUT_MS);
    socket.once("error", done((error) => reject(error)));
    socket.once("timeout", done(() => reject(new Error("PLC connect timeout"))));
    socket.connect(
      Number(port),
      ip,
      done(() => {
        socket.setTimeout(0);
        resolve(socket);
      })
    );
  });
}

function hashToRegisterValue(value) {
  const text = String(value || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) & 0xffff;
  }
  return hash & 0xffff;
}

async function sendAndReceivePacket(socket, frame, timeoutMs) {
  return withTimeout(
    new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);

      const cleanup = () => {
        socket.off("data", onData);
        socket.off("error", onError);
      };

      const onError = (error) => {
        cleanup();
        reject(error);
      };

      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length < 6) {
          return;
        }
        const length = buffer.readUInt16BE(4);
        const totalLength = 6 + length;
        if (buffer.length >= totalLength) {
          const packet = buffer.subarray(0, totalLength);
          cleanup();
          resolve(packet);
        }
      };

      socket.on("data", onData);
      socket.on("error", onError);
      socket.write(frame);
    }),
    timeoutMs,
    "PLC packet timeout"
  );
}

function buildReadHoldingFrame(transactionId, unitId, register, quantity) {
  const frame = Buffer.alloc(12);
  frame.writeUInt16BE(transactionId, 0);
  frame.writeUInt16BE(0, 2);
  frame.writeUInt16BE(6, 4);
  frame.writeUInt8(unitId, 6);
  frame.writeUInt8(0x03, 7);
  frame.writeUInt16BE(register, 8);
  frame.writeUInt16BE(quantity, 10);
  return frame;
}

function buildWriteSingleRegisterFrame(transactionId, unitId, register, value) {
  const frame = Buffer.alloc(12);
  frame.writeUInt16BE(transactionId, 0);
  frame.writeUInt16BE(0, 2);
  frame.writeUInt16BE(6, 4);
  frame.writeUInt8(unitId, 6);
  frame.writeUInt8(0x06, 7);
  frame.writeUInt16BE(register, 8);
  frame.writeUInt16BE(value & 0xffff, 10);
  return frame;
}

function parseModbusReadResponse(packet) {
  if (packet.length < 9) {
    throw new Error("Invalid Modbus read response");
  }
  const functionCode = packet.readUInt8(7);
  if (functionCode === 0x83) {
    const code = packet.readUInt8(8);
    throw new Error(`Modbus exception code ${code}`);
  }
  if (functionCode !== 0x03) {
    throw new Error(`Unexpected Modbus function code ${functionCode}`);
  }
  const byteCount = packet.readUInt8(8);
  if (byteCount < 2 || packet.length < 9 + byteCount) {
    throw new Error("Invalid Modbus byte count");
  }
  return packet.readUInt16BE(9);
}

function parseModbusWriteResponse(packet) {
  if (packet.length < 12) {
    throw new Error("Invalid Modbus write response");
  }
  const functionCode = packet.readUInt8(7);
  if (functionCode === 0x86) {
    const code = packet.readUInt8(8);
    throw new Error(`Modbus exception code ${code}`);
  }
  if (functionCode !== 0x06) {
    throw new Error(`Unexpected Modbus function code ${functionCode}`);
  }
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
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const ack = parseAck(line);
          if (ack.partId !== partId) {
            continue;
          }
          if (acceptedTypes.includes(ack.type)) {
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

async function runTextHandshakeOnce({ ip, port, partId, stationNo }) {
  const socket = await createSocketClient({ ip, port });
  try {
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
      protocol: "TCP_TEXT",
    };
  } finally {
    try {
      socket.destroy();
    } catch (_e) {
      // noop
    }
  }
}

async function runModbusHandshakeOnce({ ip, port, partId, stationNo, machine }) {
  const unitId = Number(machine?.plc_unit_id || 1);
  const startRegister = Number(machine?.plc_start_register);
  const statusRegister = Number(machine?.plc_status_register);
  const partRegister = machine?.plc_part_register === null || machine?.plc_part_register === undefined
    ? null
    : Number(machine.plc_part_register);
  const stationRegister = machine?.plc_station_register === null || machine?.plc_station_register === undefined
    ? null
    : Number(machine.plc_station_register);
  const resetRegister = machine?.plc_reset_register === null || machine?.plc_reset_register === undefined
    ? null
    : Number(machine.plc_reset_register);
  const startValue = Number(machine?.plc_start_value ?? 1);
  const startedValue = Number(machine?.plc_started_value ?? 1);
  const endOkValue = Number(machine?.plc_end_ok_value ?? 2);
  const endNgValue = Number(machine?.plc_end_ng_value ?? 3);

  if (!Number.isFinite(startRegister) || !Number.isFinite(statusRegister)) {
    throw new Error("MODBUS registers missing (plc_start_register/plc_status_register)");
  }

  const socket = await createSocketClient({ ip, port });
  let transactionId = 0;
  const nextTransactionId = () => {
    transactionId += 1;
    if (transactionId > 65535) {
      transactionId = 1;
    }
    return transactionId;
  };

  const readRegister = async (register) => {
    const frame = buildReadHoldingFrame(nextTransactionId(), unitId, register, 1);
    const packet = await sendAndReceivePacket(socket, frame, DEFAULT_CONNECT_TIMEOUT_MS);
    return parseModbusReadResponse(packet);
  };

  const writeRegister = async (register, value) => {
    const frame = buildWriteSingleRegisterFrame(nextTransactionId(), unitId, register, value);
    const packet = await sendAndReceivePacket(socket, frame, DEFAULT_CONNECT_TIMEOUT_MS);
    parseModbusWriteResponse(packet);
  };

  const waitForStatus = async (acceptedValues, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await readRegister(statusRegister);
      if (acceptedValues.includes(status)) {
        return status;
      }
      await sleep(DEFAULT_MODBUS_POLL_INTERVAL_MS);
    }
    throw new Error(`PLC Modbus status timeout (${acceptedValues.join(",")})`);
  };

  try {
    if (partRegister !== null) {
      await writeRegister(partRegister, hashToRegisterValue(partId));
    }
    if (stationRegister !== null) {
      await writeRegister(stationRegister, hashToRegisterValue(stationNo));
    }

    await writeRegister(startRegister, startValue);

    let firstStatus = await waitForStatus([startedValue, endOkValue, endNgValue], DEFAULT_START_ACK_TIMEOUT_MS);
    const startAck = { type: "ACK_START", partId, protocol: "MODBUS_TCP", value: firstStatus };

    let finalStatus = firstStatus;
    if (firstStatus !== endOkValue && firstStatus !== endNgValue) {
      finalStatus = await waitForStatus([endOkValue, endNgValue], DEFAULT_END_ACK_TIMEOUT_MS);
    }

    if (resetRegister !== null) {
      await writeRegister(resetRegister, 0);
    }

    const endAck = {
      type: finalStatus === endOkValue ? "ACK_END_OK" : "ACK_END_NG",
      partId,
      protocol: "MODBUS_TCP",
      value: finalStatus,
    };

    return {
      ok: true,
      startAck,
      endAck,
      protocol: "MODBUS_TCP",
    };
  } finally {
    try {
      socket.destroy();
    } catch (_e) {
      // noop
    }
  }
}

async function runHandshakeOnceByProtocol({ protocol, ip, port, partId, stationNo, machine }) {
  if (protocol === "MODBUS_TCP") {
    return runModbusHandshakeOnce({ ip, port, partId, stationNo, machine });
  }
  return runTextHandshakeOnce({ ip, port, partId, stationNo });
}

async function executePlcHandshake({
  ip,
  port,
  partId,
  stationNo,
  machineId,
  machine,
  onAckStart,
  onAckEndOk,
  onAckEndNg,
  onFailure,
}) {
  if (!ip || !port) {
    const error = new Error("PLC endpoint missing");
    if (typeof onFailure === "function") {
      await onFailure(error);
    }
    return { ok: false, error: error.message };
  }

  const protocol = normalizeProtocol(machine?.plc_protocol || process.env.PLC_PROTOCOL || "TCP_TEXT");

  for (let attempt = 1; attempt <= DEFAULT_RETRIES; attempt += 1) {
    try {
      emitRealtime("plc_connection_event", {
        machineId,
        partId,
        stationNo,
        protocol,
        attempt,
        state: "CONNECTING",
      });

      const result = await runHandshakeOnceByProtocol({
        protocol,
        ip,
        port,
        partId,
        stationNo,
        machine,
      });

      if (typeof onAckStart === "function") {
        await onAckStart(result.startAck);
      }

      if (result.endAck.type === "ACK_END_OK") {
        if (typeof onAckEndOk === "function") {
          await onAckEndOk(result.endAck);
        }
      } else if (typeof onAckEndNg === "function") {
        await onAckEndNg(result.endAck);
      }

      emitRealtime("plc_connection_event", {
        machineId,
        partId,
        stationNo,
        protocol,
        attempt,
        state: "COMPLETED",
        finalAck: result.endAck.type,
      });

      return {
        ok: true,
        protocol,
        attempt,
        finalAck: result.endAck.type,
      };
    } catch (error) {
      emitRealtime("plc_connection_event", {
        machineId,
        partId,
        stationNo,
        protocol,
        attempt,
        state: "RETRYING",
        error: error.message,
      });

      if (attempt === DEFAULT_RETRIES) {
        if (typeof onFailure === "function") {
          await onFailure(error);
        }
        return { ok: false, protocol, error: error.message };
      }
    }
  }

  return { ok: false, protocol, error: "Unknown PLC handshake error" };
}

module.exports = {
  executePlcHandshake,
};
