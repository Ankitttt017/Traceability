// UPGRADE 1 COMPLETE — 32-bit Part/Station hash via dual-word SLMP writeWords
const { sleep, withTimeout, hashToRegisterValue, split32To16 } = require("./utils");
const { withSocket } = require("./socketPool");

const DEFAULT_CONNECT_TIMEOUT_MS = Number(process.env.PLC_CONNECT_TIMEOUT_MS || 2000);
const DEFAULT_START_ACK_TIMEOUT_MS = Number(process.env.PLC_START_ACK_TIMEOUT_MS || 3000);
const DEFAULT_END_ACK_TIMEOUT_MS = Number(process.env.PLC_END_ACK_TIMEOUT_MS || 120000);
const DEFAULT_SLMP_POLL_INTERVAL_MS = Number(process.env.PLC_SLMP_POLL_INTERVAL_MS || 150);
const DEFAULT_SLMP_FRAME_MODE = String(process.env.PLC_SLMP_FRAME_MODE || "AUTO")
  .trim()
  .toUpperCase();

const DEVICE_CODES = {
  D: 0xa8,
  M: 0x90,
  X: 0x9c,
  Y: 0x9d,
  W: 0xb4,
  L: 0x92,
  F: 0x93,
  V: 0x94,
  B: 0xa0,
  R: 0xaf,
};

function toByte(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 0), 255);
}

function toUInt16(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 0), 0xffff);
}

function normalizeDevice(value, fallback = "D") {
  const key = String(value || "").trim().toUpperCase();
  return DEVICE_CODES[key] ? key : fallback;
}

function normalizeFrameMode(value, fallback = "AUTO") {
  const mode = String(value || "").trim().toUpperCase();
  if (mode === "ASCII" || mode === "BINARY" || mode === "AUTO") return mode;
  return fallback;
}

function getFrameModeCandidates(machine = {}) {
  let snapshotMode = null;
  try {
    const parsed =
      typeof machine?.plc_registers === "string" ? JSON.parse(machine.plc_registers) : machine?.plc_registers;
    snapshotMode = normalizeFrameMode(parsed?.slmpFrameMode ?? parsed?.slmpFrame ?? parsed?.frameMode, null);
  } catch (_error) {
    snapshotMode = null;
  }

  const fromMachine = normalizeFrameMode(
    machine?.plc_slmp_frame_mode ??
      machine?.plcSlmpFrameMode ??
      machine?.slmpFrameMode ??
      snapshotMode ??
      null,
    null
  );
  const selected = fromMachine || normalizeFrameMode(DEFAULT_SLMP_FRAME_MODE, "AUTO");
  if (selected === "ASCII") return ["ASCII", "BINARY"];
  if (selected === "BINARY") return ["BINARY", "ASCII"];
  return ["ASCII", "BINARY"];
}

function parseSignalMap(raw) {
  if (!raw) {
    return null;
  }
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed.map((entry) => ({
      key: String(entry?.key || entry?.signal || entry?.name || "").trim().toUpperCase(),
      device: entry?.device ? String(entry.device).trim().toUpperCase() : null,
    }));
  } catch (_error) {
    return null;
  }
}

function resolveDevice(machine, signalKey) {
  const fallback = normalizeDevice(process.env.PLC_SLMP_DEVICE || "D", "D");
  if (!machine) {
    return fallback;
  }
  if (machine.plc_slmp_device) {
    return normalizeDevice(machine.plc_slmp_device, fallback);
  }
  const map = parseSignalMap(machine.plc_signal_map);
  if (!map) {
    return fallback;
  }
  const found = map.find((entry) => entry.key === String(signalKey || "").trim().toUpperCase());
  if (found?.device) {
    return normalizeDevice(found.device, fallback);
  }
  return fallback;
}

function buildDeviceSpec(address, device) {
  const buffer = Buffer.alloc(4);
  buffer.writeUIntLE(Math.max(0, Number(address) || 0), 0, 3);
  buffer.writeUInt8(DEVICE_CODES[device] || DEVICE_CODES.D, 3);
  return buffer;
}

function toHexByte(value) {
  return toByte(value).toString(16).toUpperCase().padStart(2, "0");
}

function toHexUInt16(value) {
  return toUInt16(value).toString(16).toUpperCase().padStart(4, "0");
}

function toLeHexUInt16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(toUInt16(value), 0);
  return b.toString("hex").toUpperCase();
}

function buildFrameBinary({ command, subcommand, data = Buffer.alloc(0), monitoringTimer = 0x0010 }) {
  const networkNo = toByte(process.env.PLC_SLMP_NETWORK_NO || 0);
  const plcNo = toByte(process.env.PLC_SLMP_PLC_NO || 0xff);
  const ioNo = toUInt16(process.env.PLC_SLMP_IO_NO || 0x03ff);
  const stationNo = toByte(process.env.PLC_SLMP_STATION_NO || 0);

  const requestDataLength = 2 + 2 + 2 + data.length;
  const frame = Buffer.alloc(9 + requestDataLength);

  frame.writeUInt16LE(0x0050, 0); // subheader 3E binary (0x50,0x00)
  frame.writeUInt8(networkNo, 2);
  frame.writeUInt8(plcNo, 3);
  frame.writeUInt16LE(ioNo, 4);
  frame.writeUInt8(stationNo, 6);
  frame.writeUInt16LE(requestDataLength, 7);
  frame.writeUInt16LE(toUInt16(monitoringTimer), 9);
  frame.writeUInt16LE(command, 11);
  frame.writeUInt16LE(subcommand, 13);
  if (data.length > 0) {
    data.copy(frame, 15);
  }
  return frame;
}

function buildFrameAscii({ command, subcommand, data = Buffer.alloc(0), monitoringTimer = 0x0010 }) {
  const networkNo = toByte(process.env.PLC_SLMP_NETWORK_NO || 0);
  const plcNo = toByte(process.env.PLC_SLMP_PLC_NO || 0xff);
  const ioNo = toUInt16(process.env.PLC_SLMP_IO_NO || 0x03ff);
  const stationNo = toByte(process.env.PLC_SLMP_STATION_NO || 0);

  const payloadHex =
    `${toLeHexUInt16(monitoringTimer)}` +
    `${toLeHexUInt16(command)}` +
    `${toLeHexUInt16(subcommand)}` +
    `${data.toString("hex").toUpperCase()}`;
  const requestDataLength = payloadHex.length;
  const frameText =
    "5000" +
    toHexByte(networkNo) +
    toHexByte(plcNo) +
    toHexUInt16(ioNo) +
    toHexByte(stationNo) +
    toHexUInt16(requestDataLength) +
    payloadHex;
  return Buffer.from(frameText, "ascii");
}

function buildFrame(options = {}, frameMode = "BINARY") {
  const mode = normalizeFrameMode(frameMode, "BINARY");
  return mode === "ASCII" ? buildFrameAscii(options) : buildFrameBinary(options);
}

async function sendAndReceivePacket(socket, frame, timeoutMs, frameMode = "BINARY") {
  const mode = normalizeFrameMode(frameMode, "BINARY");
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
        if (mode === "ASCII") {
          const text = buffer
            .toString("ascii")
            .toUpperCase()
            .replace(/[^0-9A-F]/g, "");
          if (text.length < 18) return;
          const declaredLength = parseInt(text.slice(14, 18), 16);
          if (!Number.isFinite(declaredLength)) return;
          const expectedA = 18 + declaredLength;
          const expectedB = 18 + declaredLength * 2;
          if (text.length >= expectedB || text.length >= expectedA) {
            cleanup();
            resolve(buffer);
          }
          return;
        }
        if (buffer.length < 9) return;
        const payloadLength = buffer.readUInt16LE(7);
        const totalLength = 9 + payloadLength;
        if (buffer.length >= totalLength) {
          cleanup();
          resolve(buffer.subarray(0, totalLength));
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

function parseResponse(packet) {
  const text = packet
    .toString("ascii")
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "");
  if (text.length >= 22 && /^[0-9A-F]+$/.test(text)) {
    const declaredLength = parseInt(text.slice(14, 18), 16);
    if (Number.isFinite(declaredLength)) {
      const payloadStart = 18;
      const candidates = [declaredLength * 2, declaredLength].filter((len) => len >= 4);
      const payloadLength = candidates.find((len) => text.length >= payloadStart + len);
      if (payloadLength) {
        const payloadHex = text.slice(payloadStart, payloadStart + payloadLength);
        const endCodeHex = payloadHex.slice(0, 4);
        const endCodeLE = parseInt(`${endCodeHex.slice(2, 4)}${endCodeHex.slice(0, 2)}`, 16);
        const endCodeBE = parseInt(endCodeHex, 16);
        const isOk = endCodeLE === 0x0000 || endCodeBE === 0x0000;
        if (!isOk) {
          const code = Number.isFinite(endCodeLE) ? endCodeLE : endCodeBE;
          throw new Error(`SLMP end code 0x${String(code || 0).toString(16).padStart(4, "0")}`);
        }
        const dataHex = payloadHex.slice(4);
        if (dataHex.length % 2 !== 0) {
          throw new Error("Invalid SLMP ASCII data length");
        }
        return Buffer.from(dataHex, "hex");
      }
    }
  }

  if (packet.length < 11) {
    throw new Error("Invalid SLMP response length");
  }
  const payloadLength = packet.readUInt16LE(7);
  const endCodeOffset = 9;
  if (packet.length < endCodeOffset + 2) {
    throw new Error("Invalid SLMP response payload");
  }
  const endCode = packet.readUInt16LE(endCodeOffset);
  if (endCode !== 0x0000) {
    throw new Error(`SLMP end code 0x${endCode.toString(16).padStart(4, "0")}`);
  }
  const dataOffset = endCodeOffset + 2;
  const dataLength = Math.max(0, payloadLength - 2);
  return packet.subarray(dataOffset, dataOffset + dataLength);
}

async function readWords(socket, { device, address, count, timeoutMs, frameMode = "BINARY" }) {
  const deviceSpec = buildDeviceSpec(address, device);
  const points = Buffer.alloc(2);
  points.writeUInt16LE(count, 0);
  const data = Buffer.concat([deviceSpec, points]);
  const frame = buildFrame({ command: 0x0401, subcommand: 0x0000, data }, frameMode);
  const packet = await sendAndReceivePacket(socket, frame, timeoutMs, frameMode);
  const payload = parseResponse(packet);
  const values = [];
  for (let i = 0; i < count; i += 1) {
    const offset = i * 2;
    if (offset + 2 <= payload.length) {
      values.push(payload.readUInt16LE(offset));
    }
  }
  return values;
}

async function writeWords(socket, { device, address, values, timeoutMs, frameMode = "BINARY" }) {
  const deviceSpec = buildDeviceSpec(address, device);
  const points = Buffer.alloc(2);
  points.writeUInt16LE(values.length, 0);
  const dataWords = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => {
    dataWords.writeUInt16LE(value & 0xffff, index * 2);
  });
  const data = Buffer.concat([deviceSpec, points, dataWords]);
  const frame = buildFrame({ command: 0x1401, subcommand: 0x0000, data }, frameMode);
  const packet = await sendAndReceivePacket(socket, frame, timeoutMs, frameMode);
  parseResponse(packet);
}

async function handshake({ ip, port, partId, stationNo, machine }) {
  const startRegister = Number(machine?.plc_start_register);
  const statusRegister = Number(machine?.plc_status_register);
  const partRegister =
    machine?.plc_part_register === null || machine?.plc_part_register === undefined
      ? null
      : Number(machine.plc_part_register);
  const stationRegister =
    machine?.plc_station_register === null || machine?.plc_station_register === undefined
      ? null
      : Number(machine.plc_station_register);
  const resetRegister =
    machine?.plc_reset_register === null || machine?.plc_reset_register === undefined
      ? null
      : Number(machine.plc_reset_register);
  const startValue = Number(machine?.plc_start_value ?? 1);
  const startedValue = Number(machine?.plc_started_value ?? 2);
  const endOkValue = Number(machine?.plc_end_ok_value ?? 3);
  const endNgValue = Number(machine?.plc_end_ng_value ?? 4);

  if (!Number.isFinite(startRegister) || !Number.isFinite(statusRegister)) {
    throw new Error("SLMP registers missing (plc_start_register/plc_status_register)");
  }

  const frameModes = getFrameModeCandidates(machine);
  let lastError = null;

  for (const frameMode of frameModes) {
    try {
      return await withSocket({ ip, port, timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS }, async (socket) => {
        const deviceStart = resolveDevice(machine, "TRIGGER");
        const deviceStatus = resolveDevice(machine, "STATUS");
        const devicePart = resolveDevice(machine, "PART_ID_HASH");
        const deviceStation = resolveDevice(machine, "STATION_HASH");
        const deviceReset = resolveDevice(machine, "RESET");

        const waitForStatus = async (acceptedValues, timeoutMs) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const values = await readWords(socket, {
              device: deviceStatus,
              address: statusRegister,
              count: 1,
              timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
              frameMode,
            });
            const status = values[0];
            if (acceptedValues.includes(status)) {
              return status;
            }
            await sleep(DEFAULT_SLMP_POLL_INTERVAL_MS);
          }
          throw new Error(`PLC SLMP status timeout (${acceptedValues.join(",")})`);
        };

        let startCommandActive = false;
        try {
          if (partRegister !== null) {
            const hash32p = hashToRegisterValue(partId);
            const [phigh, plow] = split32To16(hash32p);
            console.log(
              `[PLC:SLMP] PART_ID_HASH hash32=${hash32p} dev=${devicePart} reg[${partRegister}]=0x${phigh.toString(16).padStart(4,'0')} (high) reg[${partRegister+1}]=0x${plow.toString(16).padStart(4,'0')} (low)`
            );
            await writeWords(socket, {
              device: devicePart,
              address: partRegister,
              values: [phigh, plow],
              timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
              frameMode,
            });
          }
          if (stationRegister !== null) {
            const hash32s = hashToRegisterValue(stationNo);
            const [shigh, slow] = split32To16(hash32s);
            console.log(
              `[PLC:SLMP] STATION_HASH hash32=${hash32s} dev=${deviceStation} reg[${stationRegister}]=0x${shigh.toString(16).padStart(4,'0')} (high) reg[${stationRegister+1}]=0x${slow.toString(16).padStart(4,'0')} (low)`
            );
            await writeWords(socket, {
              device: deviceStation,
              address: stationRegister,
              values: [shigh, slow],
              timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
              frameMode,
            });
          }

          await writeWords(socket, {
            device: deviceStart,
            address: startRegister,
            values: [startValue],
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
          startCommandActive = true;

          let firstStatus = await waitForStatus([startedValue, endOkValue, endNgValue], DEFAULT_START_ACK_TIMEOUT_MS);
          const startAck = { type: "ACK_START", partId, protocol: "SLMP", value: firstStatus, frameMode };

          let finalStatus = firstStatus;
          if (firstStatus !== endOkValue && firstStatus !== endNgValue) {
            finalStatus = await waitForStatus([endOkValue, endNgValue], DEFAULT_END_ACK_TIMEOUT_MS);
          }

          await writeWords(socket, {
            device: deviceStart,
            address: startRegister,
            values: [0],
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
          startCommandActive = false;

          if (resetRegister !== null) {
            await writeWords(socket, {
              device: deviceReset,
              address: resetRegister,
              values: [0],
              timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
              frameMode,
            });
          }

          const endAck = {
            type: finalStatus === endOkValue ? "ACK_END_OK" : "ACK_END_NG",
            partId,
            protocol: "SLMP",
            value: finalStatus,
            frameMode,
          };

          return {
            ok: true,
            startAck,
            endAck,
            protocol: "SLMP",
            frameMode,
          };
        } finally {
          if (startCommandActive) {
            try {
              await writeWords(socket, {
                device: deviceStart,
                address: startRegister,
                values: [0],
                timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
                frameMode,
              });
            } catch (_error) {
              // noop
            }
          }
        }
      });
    } catch (error) {
      lastError = error;
      if (!/timeout|invalid slmp/i.test(String(error?.message || ""))) {
        throw error;
      }
    }
  }

  throw lastError || new Error("PLC packet timeout");
}

async function probe({ ip, port, machine, timeoutMs }) {
  const statusRegister = Number(machine?.plc_status_register);
  const deviceStatus = resolveDevice(machine, "STATUS");
  const frameModes = getFrameModeCandidates(machine);
  let lastError = null;
  for (const frameMode of frameModes) {
    try {
      return await withSocket({ ip, port, timeoutMs }, async (socket) => {
        if (Number.isFinite(statusRegister)) {
          const values = await readWords(socket, {
            device: deviceStatus,
            address: statusRegister,
            count: 1,
            timeoutMs: timeoutMs || DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
          return {
            protocol: "SLMP",
            connected: true,
            statusRegister,
            statusValue: values[0],
            frameMode,
          };
        }
        return { protocol: "SLMP", connected: true, frameMode };
      });
    } catch (error) {
      lastError = error;
      if (!/timeout|invalid slmp/i.test(String(error?.message || ""))) {
        throw error;
      }
    }
  }
  throw lastError || new Error("PLC packet timeout");
}

async function reset({ ip, port, machine }) {
  const resetRegister = Number(machine?.plc_reset_register);
  const startRegister = Number(machine?.plc_start_register);
  const resetValue = Number(machine?.plc_reset_value ?? 9);

  const deviceReset = resolveDevice(machine, "RESET");
  const deviceStart = resolveDevice(machine, "TRIGGER");
  const frameModes = getFrameModeCandidates(machine);
  let lastError = null;
  for (const frameMode of frameModes) {
    try {
      return await withSocket({ ip, port, timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS }, async (socket) => {
        if (Number.isFinite(resetRegister)) {
          await writeWords(socket, {
            device: deviceReset,
            address: resetRegister,
            values: [resetValue],
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
        }
        if (Number.isFinite(startRegister)) {
          await writeWords(socket, {
            device: deviceStart,
            address: startRegister,
            values: [0],
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
        }
        return {
          protocol: "SLMP",
          connected: true,
          frameMode,
          resetRegister: Number.isFinite(resetRegister) ? resetRegister : null,
          resetValue: Number.isFinite(resetRegister) ? resetValue : null,
          startRegister: Number.isFinite(startRegister) ? startRegister : null,
          startValue: Number.isFinite(startRegister) ? 0 : null,
        };
      });
    } catch (error) {
      lastError = error;
      if (!/timeout|invalid slmp/i.test(String(error?.message || ""))) {
        throw error;
      }
    }
  }
  throw lastError || new Error("PLC packet timeout");
}

async function sendCommand({ ip, port, command, machine, partId, stationNo }) {
  const normalized = String(command || "").trim().toUpperCase();
  const commandRegister = Number(machine?.plc_start_register);
  const resetRegister = Number(machine?.plc_reset_register);
  if (!Number.isFinite(commandRegister)) {
    throw new Error("SLMP command register (plc_start_register) is required");
  }

  const commandValue =
    normalized === "RESET_OPERATION"
      ? 0
      : normalized === "BLOCK_OPERATION"
      ? Number(machine?.plc_block_value ?? 2)
      : Number(machine?.plc_start_value ?? 1);

  const deviceCommand = resolveDevice(machine, "TRIGGER");
  const deviceReset = resolveDevice(machine, "RESET");
  const frameModes = getFrameModeCandidates(machine);
  let lastError = null;
  let usedFrameMode = null;
  for (const frameMode of frameModes) {
    try {
      await withSocket({ ip, port, timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS }, async (socket) => {
        if (normalized === "START_OPERATION" && partId && Number.isFinite(machine?.plc_part_register)) {
          const hash32p = hashToRegisterValue(partId);
          const [phigh, plow] = split32To16(hash32p);
          const pBase = Number(machine.plc_part_register);
          console.log(`[PLC:SLMP] sendCommand PART_ID_HASH hash32=${hash32p} reg[${pBase}]=0x${phigh.toString(16)} reg[${pBase+1}]=0x${plow.toString(16)}`);
          await writeWords(socket, {
            device: resolveDevice(machine, "PART_ID_HASH"),
            address: pBase,
            values: [phigh, plow],
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
        }
        if (normalized === "START_OPERATION" && stationNo && Number.isFinite(machine?.plc_station_register)) {
          const hash32s = hashToRegisterValue(stationNo);
          const [shigh, slow] = split32To16(hash32s);
          const sBase = Number(machine.plc_station_register);
          console.log(`[PLC:SLMP] sendCommand STATION_HASH hash32=${hash32s} reg[${sBase}]=0x${shigh.toString(16)} reg[${sBase+1}]=0x${slow.toString(16)}`);
          await writeWords(socket, {
            device: resolveDevice(machine, "STATION_HASH"),
            address: sBase,
            values: [shigh, slow],
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
        }
        await writeWords(socket, {
          device: deviceCommand,
          address: commandRegister,
          values: [commandValue],
          timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
          frameMode,
        });
        if (normalized === "RESET_OPERATION" && Number.isFinite(resetRegister)) {
          const resetValue = Number(machine?.plc_reset_value ?? 9);
          await writeWords(socket, {
            device: deviceReset,
            address: resetRegister,
            values: [resetValue],
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
        }
      });
      usedFrameMode = frameMode;
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (!/timeout|invalid slmp/i.test(String(error?.message || ""))) {
        throw error;
      }
    }
  }
  if (!usedFrameMode) {
    throw lastError || new Error("PLC packet timeout");
  }

  return {
    protocol: "SLMP",
    command: normalized,
    register: commandRegister,
    value: commandValue,
    frameMode: usedFrameMode,
  };
}

module.exports = {
  handshake,
  probe,
  reset,
  sendCommand,
};
