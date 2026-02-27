const net = require("net");
const Machine = require("../models/Machine");
const { emitRealtime } = require("./realtimeService");

const HEARTBEAT_INTERVAL_MS = Math.max(Number(process.env.PLC_HEARTBEAT_INTERVAL_MS || 5000), 1000);
const HEARTBEAT_TIMEOUT_MS = Math.max(Number(process.env.PLC_HEARTBEAT_TIMEOUT_MS || 1200), 300);
const HEARTBEAT_STALE_DEFAULT_MS = Math.max(Number(process.env.PLC_HEARTBEAT_STALE_MS || 5000), 1000);

let timerRef = null;
let inFlight = false;
const healthStateMap = new Map();

function normalizeStation(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeProtocol(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
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

function parseModbusReadResponse(packet) {
  if (packet.length < 9) {
    throw new Error("Invalid Modbus read response");
  }
  const functionCode = packet.readUInt8(7);
  if (functionCode === 0x83) {
    throw new Error(`Modbus exception code ${packet.readUInt8(8)}`);
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

function sendAndReceivePacket(socket, frame, timeoutMs) {
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
          cleanup();
          resolve(buffer.subarray(0, totalLength));
        }
      };

      socket.on("data", onData);
      socket.on("error", onError);
      socket.write(frame);
    }),
    timeoutMs,
    "PLC heartbeat packet timeout"
  );
}

function probePlc({ ip, port }) {
  return new Promise((resolve) => {
    if (!ip || !port) {
      resolve({ healthy: false, error: "PLC endpoint missing" });
      return;
    }

    const socket = new net.Socket();
    let settled = false;

    const done = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.destroy();
      } catch (_error) {
        // noop
      }
      resolve(payload);
    };

    socket.setTimeout(HEARTBEAT_TIMEOUT_MS);
    socket.once("connect", () => done({ healthy: true, error: null }));
    socket.once("timeout", () => done({ healthy: false, error: "PLC heartbeat timeout" }));
    socket.once("error", (error) => done({ healthy: false, error: String(error.message || "PLC heartbeat error") }));
    socket.connect(Number(port), ip);
  });
}

function probeModbusHeartbeat({ ip, port, unitId, heartbeatRegister }) {
  return new Promise((resolve) => {
    if (!ip || !port || !Number.isFinite(Number(heartbeatRegister))) {
      resolve({
        healthy: false,
        error: "Heartbeat register not configured",
        heartbeatValue: null,
        probeType: "MODBUS_HEARTBEAT",
      });
      return;
    }

    const socket = new net.Socket();
    let settled = false;
    let transactionId = 0;

    const done = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.destroy();
      } catch (_error) {
        // noop
      }
      resolve(payload);
    };

    const nextTransactionId = () => {
      transactionId += 1;
      if (transactionId > 65535) {
        transactionId = 1;
      }
      return transactionId;
    };

    socket.setTimeout(HEARTBEAT_TIMEOUT_MS);
    socket.once("timeout", () => done({ healthy: false, error: "PLC heartbeat timeout", heartbeatValue: null, probeType: "MODBUS_HEARTBEAT" }));
    socket.once("error", (error) =>
      done({
        healthy: false,
        error: String(error.message || "PLC heartbeat error"),
        heartbeatValue: null,
        probeType: "MODBUS_HEARTBEAT",
      })
    );
    socket.once("connect", async () => {
      try {
        socket.setTimeout(0);
        const frame = buildReadHoldingFrame(nextTransactionId(), Number(unitId || 1), Number(heartbeatRegister), 1);
        const packet = await sendAndReceivePacket(socket, frame, HEARTBEAT_TIMEOUT_MS);
        const heartbeatValue = parseModbusReadResponse(packet);
        done({
          healthy: true,
          error: null,
          heartbeatValue,
          probeType: "MODBUS_HEARTBEAT",
        });
      } catch (error) {
        done({
          healthy: false,
          error: String(error.message || "PLC heartbeat read failed"),
          heartbeatValue: null,
          probeType: "MODBUS_HEARTBEAT",
        });
      }
    });
    socket.connect(Number(port), ip);
  });
}

function shouldEmitHealthEvent(previous, next) {
  if (!previous) {
    return true;
  }
  if (previous.healthy !== next.healthy) {
    return true;
  }
  if (!next.healthy && previous.consecutiveFailures === 0 && next.consecutiveFailures > 0) {
    return true;
  }
  if (previous.lastError !== next.lastError && next.consecutiveFailures <= 1) {
    return true;
  }
  return false;
}

async function runHealthCheckCycle() {
  if (inFlight) {
    return;
  }
  inFlight = true;
  try {
    const machines = await Machine.findAll({
      where: { is_active: true },
      attributes: [
        "id",
        "machine_name",
        "operation_no",
        "plc_ip",
        "plc_port",
        "machine_ip",
        "machine_port",
        "plc_protocol",
        "plc_unit_id",
        "plc_heartbeat_register",
        "plc_heartbeat_stale_ms",
      ],
      order: [["sequence_no", "ASC"]],
    });

    const activeMachineIds = new Set(machines.map((machine) => Number(machine.id)));
    for (const existingMachineId of healthStateMap.keys()) {
      if (!activeMachineIds.has(Number(existingMachineId))) {
        healthStateMap.delete(existingMachineId);
      }
    }

    await Promise.all(
      machines.map(async (machine) => {
        const machineId = Number(machine.id);
        const plcIp = machine.plc_ip || machine.machine_ip || null;
        const plcPort = machine.plc_port || machine.machine_port || null;
        const stationNo = normalizeStation(machine.operation_no);
        const protocol = normalizeProtocol(machine.plc_protocol || "TCP_TEXT");
        const heartbeatRegister = Number(machine.plc_heartbeat_register);
        const staleMs = Math.max(Number(machine.plc_heartbeat_stale_ms || HEARTBEAT_STALE_DEFAULT_MS), 1000);
        const probe =
          protocol === "MODBUS_TCP" && Number.isFinite(heartbeatRegister)
            ? await probeModbusHeartbeat({
                ip: plcIp,
                port: plcPort,
                unitId: machine.plc_unit_id || 1,
                heartbeatRegister,
              })
            : await probePlc({ ip: plcIp, port: plcPort });
        const checkedAt = new Date().toISOString();

        const previous = healthStateMap.get(machineId) || null;
        const nowMs = Date.now();
        const previousChangedAtMs = previous?.heartbeatChangedAt ? new Date(previous.heartbeatChangedAt).getTime() : nowMs;
        const previousHeartbeatValue =
          previous && Number.isFinite(Number(previous.heartbeatValue)) ? Number(previous.heartbeatValue) : null;
        const currentHeartbeatValue =
          probe && Number.isFinite(Number(probe.heartbeatValue)) ? Number(probe.heartbeatValue) : null;

        let heartbeatChangedAtMs = previousChangedAtMs || nowMs;
        if (probe.probeType === "MODBUS_HEARTBEAT") {
          if (previousHeartbeatValue === null || currentHeartbeatValue === null || previousHeartbeatValue !== currentHeartbeatValue) {
            heartbeatChangedAtMs = nowMs;
          }
        } else {
          heartbeatChangedAtMs = nowMs;
        }

        const heartbeatStale =
          probe.probeType === "MODBUS_HEARTBEAT" && nowMs - heartbeatChangedAtMs > staleMs;
        const healthy = probe.healthy && !heartbeatStale;
        const lastError = heartbeatStale ? `PLC heartbeat stale for > ${staleMs}ms` : probe.error || null;
        const consecutiveFailures = healthy ? 0 : Number(previous?.consecutiveFailures || 0) + 1;
        const next = {
          machineId,
          machineName: machine.machine_name,
          stationNo,
          plcIp,
          plcPort,
          protocol,
          healthy,
          consecutiveFailures,
          lastError,
          probeType: probe.probeType || "TCP_CONNECT",
          heartbeatRegister: Number.isFinite(heartbeatRegister) ? heartbeatRegister : null,
          heartbeatValue: currentHeartbeatValue,
          heartbeatChangedAt: new Date(heartbeatChangedAtMs).toISOString(),
          heartbeatStale,
          heartbeatStaleMs: staleMs,
          checkedAt,
        };

        if (shouldEmitHealthEvent(previous, next)) {
          emitRealtime("plc_health", next);
        }
        healthStateMap.set(machineId, next);
      })
    );
  } catch (error) {
    console.error("PLC health monitor error:", error.message);
  } finally {
    inFlight = false;
  }
}

function startPlcHealthMonitor() {
  if (timerRef) {
    return;
  }
  runHealthCheckCycle();
  timerRef = setInterval(() => {
    runHealthCheckCycle();
  }, HEARTBEAT_INTERVAL_MS);
}

function stopPlcHealthMonitor() {
  if (!timerRef) {
    return;
  }
  clearInterval(timerRef);
  timerRef = null;
}

function getPlcHealthSnapshot(machineId = null) {
  if (machineId) {
    return healthStateMap.get(Number(machineId)) || null;
  }
  return Array.from(healthStateMap.values());
}

module.exports = {
  startPlcHealthMonitor,
  stopPlcHealthMonitor,
  getPlcHealthSnapshot,
};
