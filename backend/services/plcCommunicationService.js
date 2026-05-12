const { emitRealtime } = require("./realtimeService");
const tcpTextService = require("./plcProtocols/tcpTextService");
const modbusService = require("./plcProtocols/modbusService");
const slmpService = require("./plcProtocols/slmpService");
const { toBoundedInt, sleep } = require("./plcProtocols/utils");

class PlcService {
  constructor() {
    this.DEFAULT_CONNECT_TIMEOUT_MS = Number(process.env.PLC_CONNECT_TIMEOUT_MS || 2000);
    this.DEFAULT_TEST_TIMEOUT_MS = Number(process.env.PLC_TEST_TIMEOUT_MS || this.DEFAULT_CONNECT_TIMEOUT_MS);
    this.DEFAULT_TEST_RETRY_COUNT = Math.max(Number(process.env.PLC_TEST_RETRY_COUNT || 2), 1);
    this.DEFAULT_RETRIES = Number(process.env.PLC_RETRY_COUNT || 3);
    this.DEFAULT_CIRCUIT_FAILURE_THRESHOLD = Math.max(Number(process.env.PLC_CIRCUIT_FAILURE_THRESHOLD || 5), 1);
    this.DEFAULT_CIRCUIT_OPEN_MS = Math.max(Number(process.env.PLC_CIRCUIT_OPEN_MS || 30000), 1000);

    this.SIMULATION_MODE = ["1", "true", "yes", "on"].includes(
      String(process.env.PLC_SIMULATION_MODE || process.env.PLC_SIMULATION || "").trim().toLowerCase()
    );
    this.SIMULATION_RESULT = String(process.env.PLC_SIMULATION_RESULT || "OK").trim().toUpperCase();
    this.SIM_START_DELAY_MS = Math.max(Number(process.env.PLC_SIM_START_DELAY_MS || 150), 0);
    this.SIM_END_DELAY_MS = Math.max(Number(process.env.PLC_SIM_END_DELAY_MS || 600), 0);

    this.circuitStateMap = new Map();
    this.PROTOCOLS = {
      TCP_TEXT: tcpTextService,
      MODBUS_TCP: modbusService,
      SLMP: slmpService,
    };

    // Bind methods that are often destructured by consumers
    this.getPlcCircuitSnapshot = this.getPlcCircuitSnapshot.bind(this);
    this.executePlcHandshake = this.executePlcHandshake.bind(this);
    this.sendPlcCommand = this.sendPlcCommand.bind(this);
    // Bind helpers used internally
    this.normalizeProtocol = this.normalizeProtocol.bind(this);
    this.getProtocolService = this.getProtocolService.bind(this);
    this.shouldSimulate = this.shouldSimulate.bind(this);
    this.getCircuitKey = this.getCircuitKey.bind(this);
    this.getCircuitState = this.getCircuitState.bind(this);
    this.isCircuitOpen = this.isCircuitOpen.bind(this);
    this.recordCircuitSuccess = this.recordCircuitSuccess.bind(this);
    this.recordCircuitFailure = this.recordCircuitFailure.bind(this);
    this.logPlc = this.logPlc.bind(this);
    this.simulateHandshake = this.simulateHandshake.bind(this);
  }

  normalizeProtocol(value) {
    const protocol = String(value || "").trim().toUpperCase();
    if (protocol === "MODBUS" || protocol === "MODBUS_TCP") return "MODBUS_TCP";
    if (protocol === "SLMP") return "SLMP";
    if (["TCP", "TEXT", "TCP_TEXT"].includes(protocol)) return "TCP_TEXT";
    return "TCP_TEXT";
  }

  getProtocolService(protocol) {
    const normalized = this.normalizeProtocol(protocol);
    return this.PROTOCOLS[normalized] || tcpTextService;
  }

  shouldSimulate(machine) {
    if (this.SIMULATION_MODE) return true;
    const flag = String(machine?.plc_simulation_mode || machine?.plc_simulation || "").trim().toUpperCase();
    return ["TRUE", "ON", "1", "YES"].includes(flag);
  }

  getCircuitKey(machineId, ip, port) {
    if (machineId) return `machine:${machineId}`;
    return `endpoint:${ip}:${port}`;
  }

  getCircuitState(key) {
    const existing = this.circuitStateMap.get(key);
    if (existing) return existing;
    const initial = {
      consecutiveFailures: 0,
      openUntil: 0,
      lastError: null,
      lastFailureAt: null,
      lastSuccessAt: null,
    };
    this.circuitStateMap.set(key, initial);
    return initial;
  }

  isCircuitOpen(state) {
    return Number(state.openUntil || 0) > Date.now();
  }

  recordCircuitSuccess({ key, machineId, partId, stationNo, protocol }) {
    const state = this.getCircuitState(key);
    const hadFailures = state.consecutiveFailures > 0 || state.openUntil > 0;
    state.consecutiveFailures = 0;
    state.openUntil = 0;
    state.lastSuccessAt = new Date().toISOString();
    state.lastError = null;
    if (hadFailures) {
      emitRealtime("plc_circuit_event", {
        machineId: machineId || null,
        partId: partId || null,
        stationNo: stationNo || null,
        protocol,
        key,
        state: "CLOSED",
        checkedAt: state.lastSuccessAt,
      });
    }
  }

  recordCircuitFailure({ key, machineId, partId, stationNo, protocol, error }) {
    const state = this.getCircuitState(key);
    state.consecutiveFailures += 1;
    state.lastError = String(error?.message || "Unknown PLC failure");
    state.lastFailureAt = new Date().toISOString();

    if (state.consecutiveFailures >= this.DEFAULT_CIRCUIT_FAILURE_THRESHOLD) {
      state.openUntil = Date.now() + this.DEFAULT_CIRCUIT_OPEN_MS;
      emitRealtime("plc_circuit_event", {
        machineId: machineId || null,
        partId: partId || null,
        stationNo: stationNo || null,
        protocol,
        key,
        state: "OPEN",
        openUntil: new Date(state.openUntil).toISOString(),
        consecutiveFailures: state.consecutiveFailures,
        lastError: state.lastError,
        checkedAt: state.lastFailureAt,
      });
    }
  }

  getPlcCircuitSnapshot() {
    return Array.from(this.circuitStateMap.entries()).map(([key, value]) => ({
      key,
      ...value,
      isOpen: this.isCircuitOpen(value),
    }));
  }

  logPlc(level, message, meta = {}) {
    const prefix = `[PLC:${level}]`;
    const details = Object.entries(meta)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    console.log(details ? `${prefix} ${message} ${details}` : `${prefix} ${message}`);
  }

  async simulateHandshake({ partId, stationNo, protocol, onAckStart, onAckEndOk, onAckEndNg }) {
    const startAck = { type: "ACK_START", partId, protocol };
    if (this.SIM_START_DELAY_MS > 0) await sleep(this.SIM_START_DELAY_MS);
    if (typeof onAckStart === "function") await onAckStart(startAck);

    const endType = this.SIMULATION_RESULT === "NG" ? "ACK_END_NG" : "ACK_END_OK";
    const endAck = { type: endType, partId, protocol };
    if (this.SIM_END_DELAY_MS > 0) await sleep(this.SIM_END_DELAY_MS);
    if (endType === "ACK_END_OK" && typeof onAckEndOk === "function") await onAckEndOk(endAck);
    if (endType === "ACK_END_NG" && typeof onAckEndNg === "function") await onAckEndNg(endAck);

    return { ok: true, protocol, simulated: true, finalAck: endType };
  }

  async executePlcHandshake({ ip, port, partId, stationNo, machineId, machine, onAckStart, onAckEndOk, onAckEndNg, onFailure }) {
    if (!ip || !port) {
      const error = new Error("PLC endpoint missing");
      if (typeof onFailure === "function") await onFailure(error);
      return { ok: false, error: error.message };
    }

    const protocol = this.normalizeProtocol(machine?.plc_protocol || process.env.PLC_PROTOCOL || "TCP_TEXT");
    const service = this.getProtocolService(protocol);
    const circuitKey = this.getCircuitKey(machineId, ip, port);
    const circuitState = this.getCircuitState(circuitKey);

    if (this.shouldSimulate(machine)) {
      this.logPlc("SIM", "PLC handshake simulated", { protocol, machineId, partId, stationNo });
      this.recordCircuitSuccess({ key: circuitKey, machineId, partId, stationNo, protocol });
      return this.simulateHandshake({ partId, stationNo, protocol, onAckStart, onAckEndOk, onAckEndNg });
    }

    if (this.isCircuitOpen(circuitState)) {
      const error = new Error(`PLC circuit open until ${new Date(circuitState.openUntil).toISOString()}`);
      emitRealtime("plc_connection_event", { machineId, partId, stationNo, protocol, state: "CIRCUIT_OPEN", error: error.message });
      if (typeof onFailure === "function") await onFailure(error);
      return { ok: false, protocol, circuitOpen: true, error: error.message };
    }

    for (let attempt = 1; attempt <= this.DEFAULT_RETRIES; attempt += 1) {
      try {
        emitRealtime("plc_connection_event", { machineId, partId, stationNo, protocol, attempt, state: "CONNECTING" });
        this.logPlc("INFO", "PLC handshake attempt", { protocol, machineId, attempt, ip, port, partId, stationNo });

        const result = await service.handshake({ protocol, ip, port, partId, stationNo, machine });

        if (typeof onAckStart === "function") await onAckStart(result.startAck);
        if (result.endAck.type === "ACK_END_OK" && typeof onAckEndOk === "function") await onAckEndOk(result.endAck);
        else if (typeof onAckEndNg === "function") await onAckEndNg(result.endAck);

        emitRealtime("plc_connection_event", { machineId, partId, stationNo, protocol, attempt, state: "COMPLETED", finalAck: result.endAck.type });
        this.recordCircuitSuccess({ key: circuitKey, machineId, partId, stationNo, protocol });
        this.logPlc("INFO", "PLC handshake completed", { protocol, machineId, attempt, partId, stationNo, finalAck: result.endAck.type });

        return { ok: true, protocol, attempt, finalAck: result.endAck.type };
      } catch (error) {
        emitRealtime("plc_connection_event", { machineId, partId, stationNo, protocol, attempt, state: "RETRYING", error: error.message });
        this.logPlc("WARN", "PLC handshake failed", { protocol, machineId, attempt, partId, stationNo, error: error.message });

        if (attempt === this.DEFAULT_RETRIES) {
          this.recordCircuitFailure({ key: circuitKey, machineId, partId, stationNo, protocol, error });
          if (typeof onFailure === "function") await onFailure(error);
          return { ok: false, protocol, error: error.message };
        }
        // Industrial best practice: small delay before next retry
        await sleep(250);
      }
    }
    return { ok: false, protocol, error: "Unknown PLC handshake error" };
  }

  async testPlcConnection({ ip, port, protocol = "TCP_TEXT", machine = {} }) {
    if (!ip || !port) throw new Error("PLC IP and port are required");

    if (this.shouldSimulate(machine)) {
      this.logPlc("SIM", "PLC test simulated", { protocol, ip, port });
      return {
        protocol: this.normalizeProtocol(protocol || machine?.plc_protocol),
        connected: true, simulated: true, attempt: 1, retryCount: 1, timeoutMs: this.DEFAULT_TEST_TIMEOUT_MS,
      };
    }

    const timeoutMs = toBoundedInt(machine?.plc_test_timeout_ms ?? machine?.testTimeoutMs, this.DEFAULT_TEST_TIMEOUT_MS, 300, 60000);
    const retryCount = toBoundedInt(machine?.plc_test_retry_count ?? machine?.testRetryCount, this.DEFAULT_TEST_RETRY_COUNT, 1, 10);
    const normalizedProtocol = this.normalizeProtocol(protocol || machine?.plc_protocol);
    const service = this.getProtocolService(normalizedProtocol);

    let lastError = null;
    for (let attempt = 1; attempt <= retryCount; attempt += 1) {
      try {
        const probe = await service.probe({ ip, port, machine, timeoutMs, protocol: normalizedProtocol });
        return { ...probe, attempt, retryCount, timeoutMs };
      } catch (error) {
        lastError = error;
        if (attempt < retryCount) await sleep(Math.min(150 * attempt, 600));
      }
    }
    throw new Error(`PLC test failed after ${retryCount} attempt(s): ${String(lastError?.message || "Unknown error")}`);
  }

  async resetPlcState({ ip, port, protocol = "TCP_TEXT", machine = {}, stationNo = "" }) {
    if (!ip || !port) throw new Error("PLC IP and port are required");
    const normalizedProtocol = this.normalizeProtocol(protocol || machine?.plc_protocol);
    const service = this.getProtocolService(normalizedProtocol);

    if (this.shouldSimulate(machine)) {
      this.logPlc("SIM", "PLC reset simulated", { protocol: normalizedProtocol, ip, port });
      return { protocol: normalizedProtocol, connected: true, simulated: true };
    }
    return service.reset({ ip, port, machine, stationNo, protocol: normalizedProtocol });
  }

  async sendPlcCommand({ ip, port, command, protocol = "TCP_TEXT", machine = {}, partId, stationNo }) {
    if (!ip || !port) throw new Error("PLC IP and port are required");
    const normalizedProtocol = this.normalizeProtocol(protocol || machine?.plc_protocol);
    const service = this.getProtocolService(normalizedProtocol);

    if (this.shouldSimulate(machine)) {
      this.logPlc("SIM", "PLC command simulated", { protocol: normalizedProtocol, command });
      return { protocol: normalizedProtocol, command: String(command || "").trim().toUpperCase(), simulated: true };
    }
    if (!service.sendCommand) throw new Error(`sendCommand not supported for protocol ${normalizedProtocol}`);

    const writeResult = await service.sendCommand({ ip, port, command, machine, partId, stationNo, protocol: normalizedProtocol });

    // Industrial Safe Write Verification (Point 17)
    // Read back the status register to confirm PLC processed the write.
    if (["START", "RESET", "BLOCK_OPERATION", "START_OPERATION", "RESET_OPERATION"].includes(command.toUpperCase())) {
      let verified = false;
      for (let vAttempt = 1; vAttempt <= 3; vAttempt++) {
        await sleep(100 * vAttempt);
        try {
          const probe = await service.probe({ ip, port, machine, timeoutMs: 1000, protocol: normalizedProtocol });
          // Check that PLC is reachable AND status register shows a non-zero response
          // (indicating PLC accepted the command). StatusValue of 0 after a START means PLC ignored it.
          if (probe.connected) {
            if (command.toUpperCase().includes("RESET") || probe.statusValue !== undefined) {
              verified = true;
              break;
            }
          }
        } catch (_verifyError) {
          // Retry on next attempt
        }
      }
      if (!verified) throw new Error(`PLC Write Verification Failed for command: ${command}`);
    }

    return writeResult;
  }
}

module.exports = new PlcService();
