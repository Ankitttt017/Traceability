const Machine = require("../models/Machine");
const plcCommunicationService = require("./plcCommunicationService");
const plcSnapshotService = require("./plcSnapshotService");
const plcStateMachineService = require("./plcStateMachineService");
const { logPlc, logWarn } = require("./industrialLogger");
const { emitRealtime } = require("./realtimeService");
const { readSlmpRegisters, readModbusRegisters } = require("./plcIoService");

class PlcPollingService {
  constructor() {
    this.pollers = new Map(); // machineId -> intervalRef
    this.signalHistory = new Map(); // machineId -> { signalName -> [values] }
    this.DEFAULT_POLLING_INTERVAL_MS = 300;
    this.QUIET_PLC_POLL_LOGS = String(process.env.QUIET_PLC_POLL_LOGS || "true").trim().toLowerCase() !== "false";
    this.lastRefetchWarnAt = new Map(); // machineId -> timestamp
  }

  async start() {
    const where = {};
    if (Machine.rawAttributes?.is_active) where.is_active = true;
    const machines = await Machine.findAll({ where });
    const plcMachines = machines.filter((machine) => this.isMachineActive(machine) && this.isPLCConfigured(machine));
    for (const machine of plcMachines) {
      this.startPolling(machine);
    }
    console.log(`[PollingService] Started polling for ${plcMachines.length}/${machines.length} active PLC machines`);
  }

  stop() {
    console.log(`[PollingService] Stopping all pollers...`);
    for (const machineId of this.pollers.keys()) {
      this.stopPolling(machineId);
    }
  }

  startPolling(machine) {
    if (this.pollers.has(machine.id)) {
      this.stopPolling(machine.id);
    }

    this.pollers.set(machine.id, { active: true });
    const interval = machine.polling_interval_ms || this.DEFAULT_POLLING_INTERVAL_MS;
    const stagger = machine.stagger_delay_ms || 0;

    // Apply stagger delay (Point 7)
    setTimeout(() => {
      this.pollLoop(machine, interval);
    }, stagger);
  }

  stopPolling(machineId) {
    const poller = this.pollers.get(machineId);
    if (poller) {
      poller.active = false;
      if (poller.timeoutRef) clearTimeout(poller.timeoutRef);
      this.pollers.delete(machineId);
    }
    // Clean up signal history to prevent stale entries
    this.signalHistory.delete(machineId);
  }

  async pollLoop(machine, interval) {
    const poller = this.pollers.get(machine.id);
    if (!poller || !poller.active) return;

    // Re-fetch the latest machine instance from the database dynamically
    let latestMachine = machine;
    try {
      const dbMachine = await Machine.findByPk(machine.id);
      if (!dbMachine || !this.isMachineActive(dbMachine) || !this.isPLCConfigured(dbMachine)) {
        this.stopPolling(machine.id);
        return;
      }
      latestMachine = dbMachine;
    } catch (err) {
      const now = Date.now();
      const prev = this.lastRefetchWarnAt.get(machine.id) || 0;
      if (now - prev >= 30_000) {
        this.lastRefetchWarnAt.set(machine.id, now);
        console.warn(`[PollingService] Failed to re-fetch machine ${machine.id}: ${err.message}`);
      }
    }

    // Guard: Skip polling during active handshake cycle to prevent lease contention
    const plcHandshakeEngine = require("./plcHandshakeEngine");
    if (plcHandshakeEngine.machineBusy.has(latestMachine.id)) {
      const currentInterval = latestMachine.polling_interval_ms || this.DEFAULT_POLLING_INTERVAL_MS;
      // Re-schedule next poll without performing current one
      poller.timeoutRef = setTimeout(() => this.pollLoop(latestMachine, currentInterval), currentInterval);
      return;
    }

    const startTime = Date.now();
    await this.poll(latestMachine);

    // Check if still active after poll completes
    const currentPoller = this.pollers.get(latestMachine.id);
    if (!currentPoller || !currentPoller.active) return;

    const currentInterval = latestMachine.polling_interval_ms || this.DEFAULT_POLLING_INTERVAL_MS;
    // Calculate dynamic delay to maintain steady interval without overlapping
    const elapsed = Date.now() - startTime;
    const delay = Math.max(10, currentInterval - elapsed); // Minimum 10ms safety delay

    currentPoller.timeoutRef = setTimeout(() => this.pollLoop(latestMachine, currentInterval), delay);
  }

  async poll(machine) {
    try {
      // In industrial mode, we read all configured registers at once
      const registers = await this.readAllRegisters(machine);
      if (!registers) return;

      // Clear consecutive failure counter on success
      if (this._failCounts) this._failCounts.delete(machine.id);

      // Update Snapshot (Point 14)
      plcSnapshotService.updateSnapshot(machine.plc_ip, machine.plc_port, registers);

      // Debounce and Validate Signals (Point 6, 20)
      const stableSignals = this.getStableSignals(machine.id, registers, machine.debounce_polls);
      const conflicts = plcSnapshotService.detectConflicts(stableSignals);

      if (conflicts.length > 0) {
        emitRealtime("plc_signal_conflict", {
          machineId: machine.id,
          conflicts,
          signals: stableSignals
        });
      }

      // Drive State Machine (Point 2)
      await this.driveStateMachine(machine, stableSignals);

    } catch (error) {
      // Step 6: Suppress individual poll failures — log ONE warning after N consecutive failures
      if (!this._failCounts) this._failCounts = new Map();
      const prev = this._failCounts.get(machine.id) || 0;
      const count = prev + 1;
      this._failCounts.set(machine.id, count);
      const FAIL_THRESHOLD = 5;
      if (count === FAIL_THRESHOLD) {
        console.warn(`[PLC] Machine ${machine.id} unreachable — polling suspended (${error.message})`);
      }
      // Only transition state once, not on every failure
      if (count <= FAIL_THRESHOLD) {
        try {
          await plcStateMachineService.transition(machine.id, plcStateMachineService.states.PLC_ERROR, {
            error_message: error.message
          });
        } catch (transitionError) {
          // Suppress transition errors entirely
        }
      }
    }
  }

  isPLCConfigured(machine) {
    const ip = machine.plc_ip || machine.machine_ip;
    const port = Number(machine.plc_port || machine.machine_port);
    const protocol = String(machine.plc_protocol || "").trim().toUpperCase();
    
    // Skip if IP is invalid (0.0.0.0 indicates disabled)
    if (!ip || ip === "0.0.0.0" || ip === "localhost" || protocol === "DISABLED" || !Number.isFinite(port) || port <= 0) {
      return false;
    }
    return true;
  }

  isMachineActive(machine) {
    const status = String(machine?.status || "ACTIVE").trim().toUpperCase();
    return machine?.is_active !== false && status !== "INACTIVE" && status !== "DISABLED";
  }

  parseRegisterSnapshot(machine) {
    try {
      const parsed = machine?.plc_registers
        ? (typeof machine.plc_registers === "string" ? JSON.parse(machine.plc_registers) : machine.plc_registers)
        : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  getSignalMap(machine) {
    try {
      const map = machine?.plc_signal_map
        ? (typeof machine.plc_signal_map === "string" ? JSON.parse(machine.plc_signal_map) : machine.plc_signal_map)
        : [];
      return Array.isArray(map) ? map : [];
    } catch (_error) {
      return [];
    }
  }

  findSignalRow(machine, aliases = []) {
    const wanted = new Set(aliases.map((alias) => String(alias || "").trim().toUpperCase()));
    return this.getSignalMap(machine).find((row) => {
      const keys = [
        row.signal,
        row.signalName,
        row.name,
        row.key,
        row.category,
      ].map((value) => String(value || "").trim().toUpperCase());
      return keys.some((key) => wanted.has(key) || [...wanted].some((alias) => key.includes(alias)));
    });
  }

  resolveRegister(machine, snapshot, fieldName, aliases = []) {
    const direct = this.toInt(machine?.[fieldName]);
    if (direct !== null) return direct;
    const snapshotKeys = aliases.concat([
      fieldName.replace(/^plc_/, "").replace(/_register$/, "Register"),
    ]);
    for (const key of snapshotKeys) {
      const value = this.toInt(snapshot?.[key]);
      if (value !== null) return value;
    }
    const signalRow = this.findSignalRow(machine, aliases);
    return this.toInt(signalRow?.register ?? signalRow?.registerNo ?? signalRow?.address);
  }

  resolveValue(machine, snapshot, fieldName, aliases = [], fallback = null) {
    const direct = this.toInt(machine?.[fieldName]);
    if (direct !== null) return direct;
    const snapshotKeys = aliases.concat([
      fieldName.replace(/^plc_/, "").replace(/_value$/, "Value"),
    ]);
    for (const key of snapshotKeys) {
      const value = this.toInt(snapshot?.[key]);
      if (value !== null) return value;
    }
    const signalRow = this.findSignalRow(machine, aliases);
    const mapped = this.toInt(signalRow?.value ?? signalRow?.expectedValue);
    return mapped !== null ? mapped : fallback;
  }

  toInt(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }

  async readAllRegisters(machine) {
    if (plcCommunicationService.shouldSimulate(machine)) {
      return this.simulateSignals(machine);
    }

    // Skip polling if PLC is not configured
    if (!this.isPLCConfigured(machine)) {
      return null;
    }

    try {
      const ip = machine.plc_ip || machine.machine_ip;
      const port = machine.plc_port || machine.machine_port;
      const protocol = String(machine.plc_protocol || "TCP_TEXT").trim().toUpperCase();

      const snapshot = this.parseRegisterSnapshot(machine);

      // Section 6: Dynamic Register Mappings
      const runningReg = this.resolveRegister(machine, snapshot, "plc_running_register", ["runningRegister", "statusRegister", "RUNNING", "STATUS"]);
      const endOkReg = this.resolveRegister(machine, snapshot, "plc_end_ok_register", ["endOkRegister", "END_OK", "END OK"]);
      const endNgReg = this.resolveRegister(machine, snapshot, "plc_end_ng_register", ["endNgRegister", "END_NG", "END NG"]);
      const resetReg = this.resolveRegister(machine, snapshot, "plc_reset_register", ["resetRegister", "RESET"]);
      const bypassReg = this.resolveRegister(machine, snapshot, "plc_bypass_register", ["bypassRegister", "BYPASS"]);
      const startReg = this.resolveRegister(machine, snapshot, "plc_start_register", ["startRegister", "START"]);

      const registers = [];
      if (runningReg !== null) registers.push(runningReg);
      if (endOkReg !== null) registers.push(endOkReg);
      if (endNgReg !== null) registers.push(endNgReg);
      if (resetReg !== null) registers.push(resetReg);
      if (bypassReg !== null) registers.push(bypassReg);
      if (startReg !== null) registers.push(startReg);

      if (!registers.length) return null;

      let values = {};
      if (protocol === "SLMP") {
        let signalMap = [];
        try {
          signalMap = typeof machine.plc_signal_map === "string" ? JSON.parse(machine.plc_signal_map) : machine.plc_signal_map || [];
        } catch (e) {
          signalMap = [];
        }
        if (!Array.isArray(signalMap)) signalMap = [];

        const defaultDevice = String(machine.plc_slmp_device || "D").trim().toUpperCase() || "D";
        const mappedRegisters = registers.map((r) => {
          let matched = signalMap.find(row => {
            const parsedReg = Number(row.register ?? row.registerNo ?? row.address);
            return parsedReg === r;
          });
          
          if (!matched) {
            if (r === runningReg) matched = signalMap.find(row => String(row.signal || row.key || "").trim().toUpperCase() === "RUNNING");
            else if (r === endOkReg) matched = signalMap.find(row => String(row.signal || row.key || "").trim().toUpperCase() === "END_OK");
            else if (r === endNgReg) matched = signalMap.find(row => String(row.signal || row.key || "").trim().toUpperCase() === "END_NG");
            else if (r === resetReg) matched = signalMap.find(row => String(row.signal || row.key || "").trim().toUpperCase() === "RESET");
            else if (r === bypassReg) matched = signalMap.find(row => String(row.signal || row.key || "").trim().toUpperCase() === "BYPASS");
            else if (r === startReg) matched = signalMap.find(row => String(row.signal || row.key || "").trim().toUpperCase() === "START");
          }

          const device = matched?.device ? String(matched.device).trim().toUpperCase() : defaultDevice;
          return { register: r, device };
        });

        const result = await readSlmpRegisters({
          ip, port,
          registers: mappedRegisters,
          defaultDevice,
          timeoutMs: 1000,
          frameMode: String(machine.plc_slmp_frame_mode || "AUTO").trim().toUpperCase() || "AUTO"
        });
        values = result?.values || {};
      } else if (protocol === "MODBUS_TCP" || protocol === "MODBUS") {
        const result = await readModbusRegisters({
          ip, port,
          unitId: Number(machine.plc_unit_id) || 1,
          registers,
          timeoutMs: 1000
        });
        values = result?.values || {};
      } else {
        const service = plcCommunicationService.getProtocolService(protocol);
        const probe = await service.probe({ ip, port, machine, timeoutMs: 1000 });
        return probe.signals || probe.data || null;
      }

      // Default Values for Industrial Signals (Rule 6)
      const runningValue = this.resolveValue(machine, snapshot, "plc_running_value", ["runningValue", "startedValue", "RUNNING", "STATUS"], 1);
      const endOkValue = this.resolveValue(machine, snapshot, "plc_end_ok_value", ["endOkValue", "END_OK", "END OK"], 3);
      const endNgValue = this.resolveValue(machine, snapshot, "plc_end_ng_value", ["endNgValue", "END_NG", "END NG"], 4);
      const bypassValue = this.resolveValue(machine, snapshot, "plc_bypass_value", ["bypassValue", "BYPASS"], 1);

      const signals = {};
      if (runningReg !== null && values[runningReg] !== undefined) {
        signals.RUNNING = Number(values[runningReg]) === runningValue;
      }
      if (endOkReg !== null && values[endOkReg] !== undefined) {
        signals.END_OK = Number(values[endOkReg]) === endOkValue;
      }
      if (endNgReg !== null && values[endNgReg] !== undefined) {
        signals.END_NG = Number(values[endNgReg]) === endNgValue;
      }
      if (bypassReg !== null && values[bypassReg] !== undefined) {
        signals.BYPASS = Number(values[bypassReg]) === bypassValue;
      }
      if (resetReg !== null && values[resetReg] !== undefined) {
        signals.RESET = Number(values[resetReg]) > 0;
      }
      if (startReg !== null && values[startReg] !== undefined) {
        signals.START = Number(values[startReg]) > 0;
      }

      signals.TIMESTAMP = Date.now();
      return signals;
    } catch (error) {
      // Suppress address-related errors when PLC is not properly configured
      if (error.code === "EADDRNOTAVAIL" || error.message?.includes("0.0.0.0")) {
        return null;
      }
      if (!this.QUIET_PLC_POLL_LOGS) {
        console.error(`[PollingService] Live read failed for machine ${machine.id}:`, error.message);
      }
      return null;

    }
  }

  simulateSignals(machine) {
    // Basic simulation logic for development
    return {
      START: false,
      RESET: false,
      RUNNING: false,
      END_OK: false,
      END_NG: false,
      TIMESTAMP: Date.now()
    };
  }

  getStableSignals(machineId, currentSignals, debounceCount) {
    // Ensure debounceCount is at least 2 to prevent infinite array growth (Bug 3 fix)
    const safeDebounce = Math.max(Number(debounceCount) || 3, 2);

    if (!this.signalHistory.has(machineId)) {
      this.signalHistory.set(machineId, {});
    }

    const history = this.signalHistory.get(machineId);
    const stable = {};

    for (const [name, value] of Object.entries(currentSignals)) {
      if (!history[name]) history[name] = [];
      history[name].push(value);
      // Cap history length to prevent memory leak
      while (history[name].length > safeDebounce) {
        history[name].shift();
      }

      // Signal is stable only if all values in history are the same
      const allSame = history[name].length >= safeDebounce && history[name].every(v => v === value);
      stable[name] = allSame ? value : (history[name].length >= 2 ? history[name][history[name].length - 2] : value);
    }

    return stable;
  }

  async driveStateMachine(machine, signals) {
    const runtime = await plcStateMachineService.getOrCreateRuntimeState(machine.id);
    const state = runtime.current_state;
    const safeTransition = async (target) => {
      try {
        await plcStateMachineService.transition(machine.id, target);
      } catch (error) {
        logWarn("FSM_TRANSITION_FAILED", { machineId: machine.id, state, target, error: error.message });
      }
    };

    // Transition Logic based on signals
    if ((state === plcStateMachineService.states.START_SENT || state === plcStateMachineService.states.WAITING_RUNNING) && signals.RUNNING) {
      logPlc(machine.id, "FSM_SIGNAL", { state, signal: "RUNNING", next: "RUNNING" });
      await safeTransition(plcStateMachineService.states.RUNNING);
      emitRealtime("operator_popup", {
        type: "INFO",
        machineId: machine.id,
        machineName: machine.machine_name,
        partId: machine.running_part_id, // Added partId for journey resolution
        stationNo: machine.operation_no,
        status: "RUNNING",
        plcStatus: "RUNNING",
        message: "IN PROCESS - Machine Cycle Running",
        timestamp: new Date().toISOString()
      });
    } else if (state === plcStateMachineService.states.RUNNING && !signals.RUNNING) {
      logPlc(machine.id, "FSM_SIGNAL", { state, signal: "RUNNING_LOST", next: "WAITING_END" });
      await safeTransition(plcStateMachineService.states.WAITING_END);
    } else if (state === plcStateMachineService.states.WAITING_END) {
      if (signals.END_OK) {
        logPlc(machine.id, "FSM_SIGNAL", { state, signal: "END_OK", next: "COMPLETED_OK" });
        await safeTransition(plcStateMachineService.states.COMPLETED_OK);
        emitRealtime("operator_popup", {
          type: "SUCCESS",
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "PASSED",
          plcStatus: "ENDED_OK",
          message: "PASSED - Cycle Completed Successfully",
          timestamp: new Date().toISOString()
        });
      } else if (signals.END_NG) {
        logPlc(machine.id, "FSM_SIGNAL", { state, signal: "END_NG", next: "COMPLETED_NG" });
        await safeTransition(plcStateMachineService.states.COMPLETED_NG);
        emitRealtime("operator_popup", {
          type: "ERROR",
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "FAILED",
          plcStatus: "ENDED_NG",
          message: "FAILED - Cycle Completed NG",
          timestamp: new Date().toISOString()
        });
      }
    } else if (signals.RESET && state !== plcStateMachineService.states.RESETTING) {
      logPlc(machine.id, "FSM_SIGNAL", { state, signal: "RESET_DETECTED", next: "RESETTING" });
      await safeTransition(plcStateMachineService.states.RESETTING);
    }

    // Auto-idle after completion or validation block (Rule 3)
    const isTerminal = [plcStateMachineService.states.COMPLETED_OK, plcStateMachineService.states.COMPLETED_NG].includes(state);
    const isBlocked = [plcStateMachineService.states.BLOCKED, plcStateMachineService.states.INTERLOCKED].includes(state);

    if (isTerminal || isBlocked) {
      // Delay slightly or wait for PLC to clear signals
      if (!signals.END_OK && !signals.END_NG && !signals.START) {
        await safeTransition(plcStateMachineService.states.IDLE);
      }
    }
  }
}

module.exports = new PlcPollingService();
