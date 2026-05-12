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
const DEFAULT_SIGNAL_HOLD_MS = Math.max(Number(process.env.PLC_SIGNAL_HOLD_MS || 700), 100);
const STRICT_START_ACK_REQUIRED = String(process.env.PLC_STRICT_START_ACK_REQUIRED || "true").trim().toLowerCase() !== "false";

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
  const normalized = DEVICE_CODES[key] ? key : fallback;
  // STEP 9 — Verify Address Normalization
  if (value && value.toUpperCase() !== normalized) {
    console.log(`[PLC:NORMALIZED_ADDRESS] input=${value} output=${normalized}`);
  }
  return normalized;
}

function normalizeFrameMode(value, fallback = "AUTO") {
  const mode = String(value || "").trim().toUpperCase();
  if (mode === "ASCII" || mode === "BINARY" || mode === "AUTO") return mode;
  return fallback;
}

function isRetryableSlmpAttemptError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("invalid slmp") ||
    message.includes("slmp end code") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("ehostunreach") ||
    message.includes("socket hang up") ||
    message.includes("write after end")
  );
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

function resolveTimingConfig(machine = {}) {
  let snapshot = {};
  try {
    snapshot = typeof machine?.plc_registers === "string" ? JSON.parse(machine.plc_registers) : machine?.plc_registers || {};
  } catch (_error) {
    snapshot = {};
  }
  return {
    signalHoldMs: Math.max(Number(snapshot?.signalHoldMs || snapshot?.plcSignalHoldMs || DEFAULT_SIGNAL_HOLD_MS), 100),
    pollIntervalMs: Math.max(Number(snapshot?.pollIntervalMs || snapshot?.plcPollIntervalMs || DEFAULT_SLMP_POLL_INTERVAL_MS), 50),
    startAckTimeoutMs: Math.max(Number(snapshot?.startAckTimeoutMs || machine?.plc_start_ack_timeout_ms || DEFAULT_START_ACK_TIMEOUT_MS), 300),
    endAckTimeoutMs: Math.max(Number(snapshot?.endAckTimeoutMs || machine?.plc_end_ack_timeout_ms || DEFAULT_END_ACK_TIMEOUT_MS), 1000),
  };
}

function parseMachineSnapshot(machine = {}) {
  try {
    return typeof machine?.plc_registers === "string" ? JSON.parse(machine.plc_registers) : machine?.plc_registers || {};
  } catch (_error) {
    return {};
  }
}



function resolveBinAckConfig(machine = {}) {
  let signalMap = [];
  try {
    signalMap = typeof machine?.plc_signal_map === "string" ? JSON.parse(machine.plc_signal_map) : machine?.plc_signal_map || [];
  } catch (e) { signalMap = []; }

  if (!Array.isArray(signalMap)) signalMap = [];

  const found = signalMap.find(row => {
    const s = String(row.signal || row.label || "").toUpperCase();
    return s.includes("BIN") && (s.includes("ACK") || s.includes("DEP") || s.includes("KEEP") || s.includes("PLACE"));
  });

  if (found && Number.isFinite(Number(found.register))) {
    return {
      enabled: true,
      register: Number(found.register),
      value: Number(found.value ?? 1),
      label: found.signal || found.label || "BIN_ACK"
    };
  }
  return { enabled: false };
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
  
  let resolved = fallback;
  let source = "ENV_FALLBACK";

  if (machine && machine.plc_slmp_device) {
    resolved = normalizeDevice(machine.plc_slmp_device, fallback);
    source = "MACHINE_CONFIG";
  } else if (machine) {
    const map = parseSignalMap(machine.plc_signal_map);
    if (map) {
      const found = map.find((entry) => entry.key === String(signalKey || "").trim().toUpperCase());
      if (found?.device) {
        resolved = normalizeDevice(found.device, fallback);
        source = "SIGNAL_MAP";
      }
    }
  }

  console.log(`[PLC:REGISTER_RESOLVE] signal=${signalKey} input=${machine?.plc_slmp_device || "NULL"} resolve=${resolved} source=${source}`);
  return resolved;
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
  const timing = resolveTimingConfig(machine);
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
  const resetValue = Number(machine?.plc_reset_value ?? 1);
  
  // Resolve advanced register mappings from JSON snapshot
  const snapshot = parseMachineSnapshot(machine);
  const endOkRegister = Number(snapshot?.endOkRegister ?? statusRegister);
  const endNgRegister = Number(snapshot?.endNgRegister ?? statusRegister);
  const deviceEndOk = endOkRegister !== statusRegister ? resolveDevice(machine, "END_OK") : resolveDevice(machine, "STATUS");
  const deviceEndNg = endNgRegister !== statusRegister ? resolveDevice(machine, "END_NG") : resolveDevice(machine, "STATUS");


  if (!Number.isFinite(startRegister) || !Number.isFinite(statusRegister)) {
    throw new Error("SLMP registers missing (plc_start_register/plc_status_register)");
  }

  const frameModes = getFrameModeCandidates(machine);
  let lastError = null;

  for (const frameMode of frameModes) {
    try {
      return await withSocket({ ip, port, timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS }, async (socket) => {
          const deviceStart = resolveDevice(machine, "TRIGGER");
          const devicePart = resolveDevice(machine, "PART_ID");
          const deviceStation = resolveDevice(machine, "STATION_ID");
          const deviceRunning = resolveDevice(machine, "RUNNING");
          const deviceEndOk = resolveDevice(machine, "END_OK");
          const deviceEndNg = resolveDevice(machine, "END_NG");
          const deviceReset = resolveDevice(machine, "RESET");
          const deviceStatus = resolveDevice(machine, "STATUS");

          console.log(`[PLC:REGISTER_RESOLVE] signal=START input=${machine.plc_start_register} resolve=${deviceStart}${startRegister}`);
          console.log(`[PLC:REGISTER_RESOLVE] signal=STATUS input=${machine.plc_status_register} resolve=${deviceStatus}${statusRegister}`);

          console.log(`[PLC:CONFIG_LOADED] machineId=${machine.id} protocol=SLMP`);
          console.log(`[PLC:HANDSHAKE_MODE] DIRECT_HANDSHAKE`);
          console.log(`[PLC:SIGNALS_OK] START=${deviceStart}${startRegister} RUNNING=${deviceStatus}${statusRegister} RESET=${deviceReset}${resetRegister}`);
          console.log(`[PLC:TIMEOUTS] connect=${DEFAULT_CONNECT_TIMEOUT_MS}ms startAck=${timing.startAckTimeoutMs}ms endAck=${timing.endAckTimeoutMs}ms poll=${timing.pollIntervalMs}ms hold=${timing.signalHoldMs}ms`);

          const waitForStatus = async (acceptedValues, timeoutMs, label = "STATUS") => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
              const values = await readWords(socket, {
                device: deviceStatus || "D",
                address: statusRegister,
                count: 1,
                timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
                frameMode,
              });
              const status = values[0];
              console.log(`[PLC:POLL_${label}] ${deviceStatus}${statusRegister}=${status}`);
              
              if (acceptedValues.includes(status)) {
                return status;
              }
              await sleep(timing.pollIntervalMs);
            }
            throw new Error(`PLC SLMP ${label} timeout (expected ${acceptedValues.join(",")})`);
          };

          let startCommandActive = false;
          try {
            if (partRegister !== null) {
              const hash32p = hashToRegisterValue(partId);
              const [phigh, plow] = split32To16(hash32p);
              console.log(
                `[PLC:SLMP] PART_ID_HASH hash32=${hash32p} dev=${devicePart} (High: 0x${phigh.toString(16).padStart(4, '0')}, Low: 0x${plow.toString(16).padStart(4, '0')})`
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
                `[PLC:SLMP] STATION_HASH hash32=${hash32s} dev=${deviceStation} reg[${stationRegister}]=0x${shigh.toString(16).padStart(4, '0')} (high) reg[${stationRegister + 1}]=0x${slow.toString(16).padStart(4, '0')} (low)`
              );
              await writeWords(socket, {
                device: deviceStation,
                address: stationRegister,
                values: [shigh, slow],
                timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
                frameMode,
              });
            }

            // STEP 2 — Verify START Write Path
            const currentStart = await readWords(socket, {
              device: deviceStart,
              address: startRegister,
              count: 1,
              timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
              frameMode,
            });

            if (currentStart[0] !== startValue) {
              console.log(`[PLC:WRITE_ATTEMPT] register=${deviceStart}${startRegister} value=${startValue}`);
              await writeWords(socket, {
                device: deviceStart,
                address: startRegister,
                values: [startValue],
                timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
                frameMode,
              });
              console.log(`[PLC:WRITE_SUCCESS] register=${deviceStart}${startRegister} value=${startValue}`);
              
              // Immediate Read Back for Verification
              const verifyStart = await readWords(socket, {
                device: deviceStart,
                address: startRegister,
                count: 1,
                timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
                frameMode,
              });
              console.log(`[PLC:VERIFY_START] actualValue=${verifyStart[0]}`);
            } else {
              console.log(`[PLC:WRITE_SKIPPED] register=${deviceStart}${startRegister} already active (value=${currentStart[0]})`);
            }

            startCommandActive = true;



          // STEP 11 — Remove START ACK Logic
          // We no longer wait for CONFIRMATION/ACK register.
          // Directly wait for RUNNING status (startedValue) on statusRegister.

          // HOLD is fallback safety only.
          await sleep(timing.signalHoldMs);

          console.log("[PLC:DEBUG_STATUS] Waiting for RUNNING", {
            device: deviceStatus,
            address: statusRegister,
            runningValue: startedValue,
            endOkValue,
            endNgValue
          });

          let firstStatus = await waitForStatus([startedValue, endOkValue, endNgValue], timing.startAckTimeoutMs, "START_ACK");
          const startAck = { type: "ACK_START", partId, protocol: "SLMP", value: firstStatus, frameMode };

          let finalStatus = firstStatus;
          let finalAckType = "ACK_END_OK";

          if (firstStatus === startedValue) {
            console.log(`[PLC:RUNNING_DETECTED] machineId=${machine.id} value=${firstStatus}`);
            console.log(`[PLC:WAITING_END] machineId=${machine.id}`);
            
            // Polling loop for END_OK (D2061) or END_NG (D2062)
            const endDeadline = Date.now() + timing.endAckTimeoutMs;
            let detected = false;
            while (Date.now() < endDeadline) {
              console.log(`[PLC:POLL_END] machineId=${machine.id} polling...`);
              
              // Check OK Register (D2061)
              const okValues = await readWords(socket, {
                device: deviceEndOk || "D",
                address: endOkRegister,
                count: 1,
                timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
                frameMode,
              });
              
              if (okValues[0] === endOkValue) {
                finalStatus = endOkValue;
                finalAckType = "ACK_END_OK";
                detected = true;
                console.log(`[PLC:END_OK_DETECTED] machineId=${machine.id} reg=${deviceEndOk}${endOkRegister} value=${okValues[0]}`);
                break;
              }

              // Check NG Register (D2062)
              const ngValues = await (endNgRegister === endOkRegister && deviceEndNg === deviceEndOk
                ? Promise.resolve(okValues)
                : readWords(socket, {
                    device: deviceEndNg || "D",
                    address: endNgRegister,
                    count: 1,
                    timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
                    frameMode,
                  }));
              
              if (ngValues[0] === endNgValue) {
                finalStatus = endNgValue;
                finalAckType = "ACK_END_NG";
                detected = true;
                console.log(`[PLC:END_NG_DETECTED] machineId=${machine.id} reg=${deviceEndNg}${endNgRegister} value=${ngValues[0]}`);
                break;
              }

              await sleep(timing.pollIntervalMs);
            }

            if (!detected) {
              const err = new Error(`PLC SLMP end status timeout (expected OK:${endOkValue} or NG:${endNgValue})`);
              err.code = "CYCLE_TIMEOUT";
              throw err;
            }
          } else if (firstStatus === endOkValue) {
            console.log(`[PLC:END_OK_DETECTED] machineId=${machine.id} immediate value=${firstStatus}`);
            finalAckType = "ACK_END_OK";
          } else if (firstStatus === endNgValue) {
            console.log(`[PLC:END_NG_DETECTED] machineId=${machine.id} immediate value=${firstStatus}`);
            finalAckType = "ACK_END_NG";
          }

          // Point 21: Optional Bin Acknowledgement for NG Parts
          if (finalAckType === "ACK_END_NG") {
            const bin = resolveBinAckConfig(machine);
            if (bin.enabled) {
              const ackDevice = resolveDevice(machine, "BIN_ACK");
              console.log(`[PLC:SLMP] WAITING_BIN_ACK on dev=${ackDevice} reg=${bin.register} (expected ${bin.value})`);
              const binDeadline = Date.now() + timing.endAckTimeoutMs;
              let binAckReceived = false;
              while (Date.now() < binDeadline) {
                const values = await readWords(socket, {
                  device: ackDevice,
                  address: bin.register,
                  count: 1,
                  timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
                  frameMode,
                });
                if (values[0] === bin.value) {
                  binAckReceived = true;
                  break;
                }
                await sleep(timing.pollIntervalMs);
              }
              if (!binAckReceived) {
                console.warn(`[PLC:SLMP] BIN_ACK timeout for register ${bin.register}`);
              } else {
                console.log(`[PLC:SLMP] BIN_ACK received on register ${bin.register}`);
              }
            }
          }


          // STEP 7 — Industrial Reset Sequence
          if (resetRegister !== null) {
            const finalResetVal = Number(machine?.plc_reset_value ?? 1);

            console.log(`[PLC:RESET_SENT] register=${deviceReset}${resetRegister} value=${finalResetVal}`);
            await writeWords(socket, {
              device: deviceReset || "D",
              address: resetRegister,
              values: [finalResetVal],
              timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
              frameMode,
            });
            await sleep(timing.signalHoldMs);
            await writeWords(socket, {
              device: deviceReset || "D",
              address: resetRegister,
              values: [0],
              timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
              frameMode,
            });
            console.log(`[PLC:RESET_CLEARED] register=${deviceReset}${resetRegister} value=0`);
          }

          console.log(`[PLC:START_CLEARED] register=${deviceStart}${startRegister} value=0`);
          await writeWords(socket, {
            device: deviceStart || "D",
            address: startRegister,
            values: [0],
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
            frameMode,
          });
          startCommandActive = false;

          console.log(`[PLC:HANDSHAKE_VALIDATION_SUCCESS] machineId=${machine.id}`);


          const endAck = {
            type: finalAckType,
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
      if (!isRetryableSlmpAttemptError(error)) {
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
      if (!isRetryableSlmpAttemptError(error)) {
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
      if (!isRetryableSlmpAttemptError(error)) {
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
          console.log(`[PLC:SLMP] sendCommand PART_ID_HASH hash32=${hash32p} reg[${pBase}]=0x${phigh.toString(16)} reg[${pBase + 1}]=0x${plow.toString(16)}`);
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
          console.log(`[PLC:SLMP] sendCommand STATION_HASH hash32=${hash32s} reg[${sBase}]=0x${shigh.toString(16)} reg[${sBase + 1}]=0x${slow.toString(16)}`);
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
      if (!isRetryableSlmpAttemptError(error)) {
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

