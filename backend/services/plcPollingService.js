const Machine = require("../models/Machine");
const plcCommunicationService = require("./plcCommunicationService");
const plcSnapshotService = require("./plcSnapshotService");
const plcStateMachineService = require("./plcStateMachineService");
const { emitRealtime } = require("./realtimeService");
const { readSlmpRegisters, readModbusRegisters } = require("./plcIoService");

class PlcPollingService {
  constructor() {
    this.pollers = new Map(); // machineId -> intervalRef
    this.signalHistory = new Map(); // machineId -> { signalName -> [values] }
    this.DEFAULT_POLLING_INTERVAL_MS = 300;
  }

  async start() {
    const machines = await Machine.findAll({ where: { status: "ACTIVE" } });
    for (const machine of machines) {
      this.startPolling(machine);
    }
    console.log(`[PollingService] Started polling for ${machines.length} machines`);
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

    // Guard: Skip polling during active handshake cycle to prevent lease contention
    const plcHandshakeEngine = require("./plcHandshakeEngine");
    if (plcHandshakeEngine.machineBusy.has(machine.id)) {
      // Re-schedule next poll without performing current one
      poller.timeoutRef = setTimeout(() => this.pollLoop(machine, interval), interval);
      return;
    }

    const startTime = Date.now();
    await this.poll(machine);

    // Check if still active after poll completes
    const currentPoller = this.pollers.get(machine.id);
    if (!currentPoller || !currentPoller.active) return;

    // Calculate dynamic delay to maintain steady interval without overlapping
    const elapsed = Date.now() - startTime;
    const delay = Math.max(10, interval - elapsed); // Minimum 10ms safety delay

    currentPoller.timeoutRef = setTimeout(() => this.pollLoop(machine, interval), delay);
  }

  async poll(machine) {
    try {
      // In industrial mode, we read all configured registers at once
      const registers = await this.readAllRegisters(machine);
      if (!registers) return;

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
      console.error(`[PollingService] Error polling machine ${machine.id}:`, error.message);
      // Update state to PLC_ERROR if repeated
      try {
        await plcStateMachineService.transition(machine.id, plcStateMachineService.states.PLC_ERROR, {
          error_message: error.message
        });
      } catch (transitionError) {
        console.warn(`[PollingService] State transition suppressed for machine ${machine.id}: ${transitionError.message}`);
      }
    }
  }

  async readAllRegisters(machine) {
    if (plcCommunicationService.shouldSimulate(machine)) {
      return this.simulateSignals(machine);
    }

    try {
      const ip = machine.plc_ip || machine.machine_ip;
      const port = machine.plc_port || machine.machine_port;
      const protocol = String(machine.plc_protocol || "TCP_TEXT").trim().toUpperCase();

      // Build register list from machine config for batch read
      const registerMap = {}; // register -> signal name
      const toInt = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };
      const startReg = toInt(machine.plc_start_register);
      const statusReg = toInt(machine.plc_status_register);
      const resetReg = toInt(machine.plc_reset_register);
      const stationReg = toInt(machine.plc_station_register);
      if (startReg !== null) registerMap[startReg] = "START";
      if (statusReg !== null) registerMap[statusReg] = "RUNNING";
      if (resetReg !== null) registerMap[resetReg] = "RESET";
      if (stationReg !== null) registerMap[stationReg] = "STATION";

      const registers = Object.keys(registerMap).map(Number);
      if (registers.length === 0) return null;

      const pollStartTime = Date.now();
      let values = {};
      if (protocol === "SLMP") {
        const defaultDevice = String(machine.plc_slmp_device || "D").trim().toUpperCase() || "D";

        // Extract configured frame mode from the JSON payload if the top-level column is missing
        let frameMode = machine.plc_slmp_frame_mode || "AUTO";
        if ((!frameMode || frameMode === "AUTO") && machine.plc_registers) {
          try {
            const parsed = typeof machine.plc_registers === "string" ? JSON.parse(machine.plc_registers) : machine.plc_registers;
            const nestedMode = parsed?.slmpFrameMode || parsed?.slmpFrame || parsed?.frameMode;
            if (nestedMode) frameMode = String(nestedMode).toUpperCase();
          } catch (e) { }
        }

        const result = await readSlmpRegisters({
          ip, port,
          registers: registers.map((r) => ({ register: r, device: defaultDevice })),
          defaultDevice,
          timeoutMs: 1000,
          frameMode,
        });
        values = result?.values || {};
      } else if (protocol === "MODBUS_TCP" || protocol === "MODBUS") {
        const result = await readModbusRegisters({
          ip, port,
          unitId: toInt(machine.plc_unit_id) || 1,
          registers,
          timeoutMs: 1000,
        });
        values = result?.values || {};
      } else {
        // TCP_TEXT: fall back to probe
        const service = plcCommunicationService.getProtocolService(protocol);
        const probe = await service.probe({ ip, port, machine, timeoutMs: 1000 });
        return probe.signals || probe.data || null;
      }

      const pollDuration = Date.now() - pollStartTime;
      if (pollDuration > 500) {
        console.warn(`[PollingService] Slow poll for machine ${machine.id}: ${pollDuration}ms (protocol: ${protocol})`);
      }

      // Map register values back to signal names
      const signals = {};
      const endOkValue = Number(machine.plc_end_ok_value ?? 3);
      const endNgValue = Number(machine.plc_end_ng_value ?? 4);
      const startedValue = Number(machine.plc_started_value ?? 2);
      for (const [reg, name] of Object.entries(registerMap)) {
        const v = values[Number(reg)];
        if (v === undefined || v === null) continue;
        signals[name] = v;
      }
      // Derive logical flags from status register value
      if (statusReg !== null && values[statusReg] !== undefined) {
        const sv = values[statusReg];
        signals.RUNNING = sv === startedValue;
        signals.END_OK = sv === endOkValue;
        signals.END_NG = sv === endNgValue;
      }
      signals.TIMESTAMP = Date.now();
      return signals;
    } catch (error) {
      console.error(`[PollingService] Live read failed for machine ${machine.id}:`, error.message);
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
        console.warn(`[PollingService] driveStateMachine transition suppressed ${state} -> ${target} for machine ${machine.id}: ${error.message}`);
      }
    };

    // Transition Logic based on signals
    if (state === plcStateMachineService.states.START_SENT && signals.RUNNING) {
      await safeTransition(plcStateMachineService.states.RUNNING);
    } else if (state === plcStateMachineService.states.WAITING_RUNNING && signals.RUNNING) {
      await safeTransition(plcStateMachineService.states.RUNNING);
    } else if (state === plcStateMachineService.states.RUNNING && !signals.RUNNING) {
      await safeTransition(plcStateMachineService.states.WAITING_END);
    } else if (state === plcStateMachineService.states.WAITING_END) {
      if (signals.END_OK) {
        await safeTransition(plcStateMachineService.states.COMPLETED_OK);
      } else if (signals.END_NG) {
        await safeTransition(plcStateMachineService.states.COMPLETED_NG);
      }
    } else if (signals.RESET && state !== plcStateMachineService.states.RESETTING) {
      await safeTransition(plcStateMachineService.states.RESETTING);
    }

    // Auto-idle after completion
    if ([plcStateMachineService.states.COMPLETED_OK, plcStateMachineService.states.COMPLETED_NG].includes(state)) {
      // Delay slightly or wait for PLC to clear signals
      if (!signals.END_OK && !signals.END_NG) {
        await safeTransition(plcStateMachineService.states.IDLE);
      }
    }
  }
}

module.exports = new PlcPollingService();
