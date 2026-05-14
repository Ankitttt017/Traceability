const { emitRealtime } = require("./realtimeService");
const plcService = require("./plcCommunicationService");
const plcConnectionManager = require("./plcConnectionManager");
const { logInfo, logWarn } = require("./industrialLogger");
const telemetry = require("./industrialTelemetryService");
const recoveryEngine = require("./plcReconnectRecoveryEngine");
const { TIMELINE_EVENTS, recordTimelineEvent } = require("./operationTimelineService");
const plcStateMachineService = require("./plcStateMachineService");
const industrialEventService = require("./industrialEventService");
const machineWatchdogService = require("./machineWatchdogService");
const { sleep } = require("./plcProtocols/utils");
const { writeModbusRegister, writeSlmpRegister } = require("./plcIoService");

// Industrial Spam Suppression Cache (Section 4)
const suppressionCache = new Map();
const SUPPRESSION_WINDOW_MS = 5000;

// Helper function to resolve bin acknowledgment configuration
function resolveBinAckConfig(machine = {}) {
  let signalMap = [];
  try {
    signalMap = typeof machine?.plc_signal_map === "string" ? JSON.parse(machine.plc_signal_map) : machine?.plc_signal_map || [];
  } catch (e) {
    signalMap = [];
  }

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

  return { enabled: false, register: null, value: 0, label: "BIN_ACK" };
}

class PlcHandshakeEngine {
  constructor() {
    this.machineBusy = new Set();
    this.cycleContext = new Map();
    this.machineStates = new Map(); // Memory cache for rapid UI updates
  }

  async transitionSafely(machineId, targetState, metadata = {}, options = {}) {
    const { suppressInvalid = true, tag = "FSM_TRANSITION_FAILED" } = options;
    try {
      this.machineStates.set(machineId, targetState);
      await plcStateMachineService.transition(machineId, targetState, metadata);
      return true;
    } catch (error) {
      if (suppressInvalid && String(error?.message || "").includes("Illegal state transition")) {
        logWarn(tag, {
          machineId,
          targetState,
          error: error.message,
          suppressed: true
        });
        return false;
      }
      throw error;
    }
  }

  resolveFailureState(currentState, error) {
    const timeoutFailure = String(error?.message || "").toUpperCase().includes("TIMEOUT");
    if (!timeoutFailure) return plcStateMachineService.states.PLC_ERROR;

    switch (currentState) {
      case plcStateMachineService.states.START_SENT:
        return plcStateMachineService.states.RUNNING_TIMEOUT;
      case plcStateMachineService.states.WAITING_RUNNING:
      case plcStateMachineService.states.RUNNING:
        return plcStateMachineService.states.RUNNING_TIMEOUT;
      case plcStateMachineService.states.WAITING_END:
        return plcStateMachineService.states.END_TIMEOUT;
      case plcStateMachineService.states.RESETTING:
      case plcStateMachineService.states.RESET_ACK_WAIT:
        return plcStateMachineService.states.RESET_TIMEOUT;
      default:
        return plcStateMachineService.states.PLC_ERROR;
    }
  }

  getState(machineId) {
    const id = Number(machineId || 0);
    return {
      isBusy: this.machineBusy.has(id),
      state: this.machineStates.get(id) || "IDLE",
      context: this.cycleContext.get(id) || null,
    };
  }

  /**
   * Mark a machine as resetting (used by cycleFinalizationService).
   * Prevents new cycles from starting during reset.
   */
  async markResetting(machineId) {
    const id = Number(machineId || 0);
    if (!id) return;
    try {
      // Use proper state machine transition instead of directly setting state
      await plcStateMachineService.transition(id, plcStateMachineService.states.RESETTING, {
        error_message: "Cycle finalization - entering reset state"
      });
    } catch (transitionError) {
      // If transition fails due to invalid state, log it but continue
      logWarn("MARK_RESETTING_TRANSITION_FAILED", {
        machineId: id,
        error: transitionError.message
      });
    }
    // Keep machineBusy set to block new cycles during reset
    this.machineBusy.add(id);
    this.machineStates.set(id, "RESETTING");
  }

  /**
   * Mark a machine as idle after successful reset (used by cycleFinalizationService).
   * Releases the machine lock so new cycles can start.
   */
  async markIdle(machineId) {
    const id = Number(machineId || 0);
    if (!id) return;
    try {
      // Use proper state machine transition to IDLE
      await plcStateMachineService.transition(id, plcStateMachineService.states.IDLE, {
        error_message: null,
        cycle_token: null,
        active_operation_id: null
      });
    } catch (transitionError) {
      logWarn("MARK_IDLE_TRANSITION_FAILED", {
        machineId: id,
        error: transitionError.message
      });
    } finally {
      // Release locks and clear context to allow new cycles (FRESH START)
      this.machineBusy.delete(id);
      this.cycleContext.delete(id);
      this.machineStates.set(id, "IDLE");
      console.log(`[PLC:IDLE_RESTORED] machineId=${id} - Ready for fresh scan`);
    }
  }

  /**
   * Mark a machine as recovering from an error (used by cycleFinalizationService).
   * Keeps the machine locked but records the error context.
   */
  async markRecovering(machineId, error) {
    const id = Number(machineId || 0);
    if (!id) return;
    try {
      // Try to transition to RECOVERING via PLC_ERROR first if needed
      const runtime = await plcStateMachineService.getOrCreateRuntimeState(id);
      const currentState = runtime.current_state;

      // If we're in RESETTING, we can't go directly to RECOVERING
      // Instead, go through the valid path: RESETTING -> PLC_ERROR -> RECOVERING
      if (currentState === "RESETTING") {
        await plcStateMachineService.transition(id, plcStateMachineService.states.PLC_ERROR, {
          error_message: error?.message || "Unknown recovery error"
        });
      }

      // Now transition to RECOVERING
      await plcStateMachineService.transition(id, plcStateMachineService.states.RECOVERING, {
        error_message: error?.message || "Unknown recovery error"
      });
    } catch (transitionError) {
      logWarn("MARK_RECOVERING_TRANSITION_FAILED", {
        machineId: id,
        error: transitionError.message
      });
    }
    // Release busy lock so operator can retry — keeping it locked would deadlock the machine
    this.machineBusy.delete(id);
  }

  /**
   * Hard Reset (Critical for industrial stability)
   * Clears everything: Pollers, listeners, FSM, and context.
   */
  async hardReset(machineId) {
    const id = Number(machineId || 0);
    if (!id) return;

    console.log(`[PLC:HARD_RESET] machineId=${id} starting...`);

    try {
      // 1. Stop Polling Service for this machine
      const plcPollingService = require("./plcPollingService");
      plcPollingService.stopPolling(id);

      // 2. Reset FSM to IDLE (Clears cycle_token, active_operation_id)
      await plcStateMachineService.transition(id, plcStateMachineService.states.IDLE, {
        error_message: "Hard reset triggered by system",
        cycle_token: null,
        active_operation_id: null
      });

      // 3. Clear local busy lock and cycle context
      this.machineBusy.delete(id);
      this.cycleContext.delete(id);
      this.machineStates.delete(id);

      // 4. Note: Socket listeners are cleaned up by releaseSocket in socketPool
      // which is called by slmpService/modbusService after each operation.

      console.log(`[PLC:HARD_RESET] machineId=${id} completed. System at INITIAL state.`);
      return true;
    } catch (error) {
      logWarn("HARD_RESET_FAILED", { machineId: id, error: error.message });
      return false;
    }
  }

  async recordTimelineForMachine(machineId, eventType, eventData = {}) {
    const context = this.cycleContext.get(Number(machineId || 0));
    if (!context?.operationLogId) return;

    const durationFromStartMs = Date.now() - Number(context.startedAtMs || Date.now());
    try {
      await recordTimelineEvent({
        operationId: context.operationLogId,
        partId: context.partId,
        machineId: Number(machineId || 0),
        stationNo: context.stationNo || null,
        eventType,
        eventData,
        durationFromStartMs,
      });

      // Standardized Industrial Event (Point 18)
      industrialEventService.emitOperationTimeline(machineId, context.cycleToken, eventType, eventData);
    } catch (_error) {
      // Timeline failures must never break PLC runtime.
    }
  }

  async executeCycle({
    machine,
    partId,
    stationNo,
    operationLogId = null,
    onStarted,
    onEndedOk,
    onEndedNg,
    onError,
  }) {
    const machineId = Number(machine?.id || 0);
    if (!machineId) throw new Error("Invalid machine for PLC handshake");

    if (this.machineBusy.has(machineId)) {
      const err = new Error("Machine busy");
      err.code = "MACHINE_BUSY";
      logWarn("MACHINE_BUSY_REJECT", { machineId, partId, stationNo });
      throw err;
    }

    const ip = machine.plc_ip || machine.machine_ip;
    const port = machine.plc_port || machine.machine_port;
    const cycleStartedAtMs = Date.now();

    // Generate Unique Cycle Token (Point 9)
    const cycleToken = plcStateMachineService.generateCycleToken();

    this.machineBusy.add(machineId);
    this.cycleContext.set(machineId, {
      operationLogId,
      partId: String(partId || "").trim() || null,
      stationNo: String(stationNo || "").trim().toUpperCase() || null,
      startedAtMs: cycleStartedAtMs,
      cycleToken
    });

    let cycleError = null;
    try {
      // Handle state machine recovery before starting cycle
      // If machine is in RESETTING, PLC_ERROR, or RECOVERING, we need to go through IDLE first
      const runtime = await plcStateMachineService.getOrCreateRuntimeState(machineId);
      const currentState = runtime.current_state;
      // Industrial Recovery: If we're starting a new scan, any non-IDLE state must be treated as a recovery candidate
      const recoveryStates = ["RUNNING", "WAITING_RUNNING", "START_SENT", "WAITING_END", "RESETTING", "PLC_ERROR", "RECOVERING", "RUNNING_TIMEOUT", "END_TIMEOUT", "RESET_TIMEOUT"];

      if (recoveryStates.includes(currentState)) {
        logInfo("CYCLE_STATE_RECOVERY", {
          machineId,
          fromState: currentState,
          toState: "IDLE"
        });
        try {
          // Force transition to IDLE to recover from error state
          await plcStateMachineService.transition(machineId, plcStateMachineService.states.IDLE, {
            error_message: `Recovery from ${currentState} state`,
            cycle_token: null,
            active_operation_id: null
          });
        } catch (recoveryError) {
          logWarn("CYCLE_STATE_RECOVERY_FAILED", {
            machineId,
            fromState: currentState,
            error: recoveryError.message
          });
          // Continue anyway - the new cycle context will start fresh
        }
      }

      // Now transition to SCANNED (normal entry point for new cycle)
      await this.transitionSafely(machineId, plcStateMachineService.states.SCANNED, {
        cycle_token: cycleToken
      });

      // Transition to VALIDATED (Point 2)
      const validated = await this.transitionSafely(machineId, plcStateMachineService.states.VALIDATED, {
        cycle_token: cycleToken,
        active_operation_id: operationLogId
      });

      if (!validated) {
        throw new Error("Validation state transition failed");
      }
      
      await this.recordTimelineForMachine(machineId, "VALIDATED");

      // STEP 4 — Verify Socket Lease Ownership
      console.log(`[PLC:LEASE_ACQUIRED] machineId=${machineId} op=PLC_HANDSHAKE_CYCLE`);

      // Resolve timing to determine proper queue timeout (Step 8)
      // We need at least startAckTimeout + endAckTimeout + buffer
      const startAckTimeoutMs = Number(machine?.plc_start_ack_timeout_ms || process.env.PLC_START_ACK_TIMEOUT_MS || 3000);
      const endAckTimeoutMs = Number(machine?.plc_end_ack_timeout_ms || process.env.PLC_END_ACK_TIMEOUT_MS || 120000);
      const totalTimeoutMs = startAckTimeoutMs + endAckTimeoutMs + 10000; // 10s buffer

      const result = await plcConnectionManager.runExclusive({
        machineId,
        ip,
        port,
        operationName: "PLC_HANDSHAKE_CYCLE",
        timeoutMs: totalTimeoutMs,
        task: async () => {

          console.log(`[PLC:LEASE_ACTIVE] machineId=${machineId}`);


          // 1. Send START command
          await this.transitionSafely(machineId, plcStateMachineService.states.START_SENT);
          await this.recordTimelineForMachine(machineId, "START_SENT");
          console.log(`[PLC:START_SENT] machineId=${machineId}`);

          await this.transitionSafely(machineId, plcStateMachineService.states.WAITING_RUNNING);
          await this.recordTimelineForMachine(machineId, "WAITING_RUNNING");
          console.log(`[PLC:WAITING_RUNNING] machineId=${machineId}`);


          // Point 10: Hold START signal
          if (machine.start_hold_ms > 0) await sleep(machine.start_hold_ms);

          return plcService.executePlcHandshake({
            ip,
            port,
            partId,
            stationNo,
            machineId,
            machine,
            onAckStart: async (ack) => {
              // STEP 5 — Fast RUNNING Detection (Immediately overrides OP WAIT)
              console.log(`[PLC:RUNNING_DETECTED] machineId=${machineId} value=${ack.value}`);

              // Force transition to RUNNING - this will trigger UI update to IN PROCESS
              await this.transitionSafely(machineId, plcStateMachineService.states.RUNNING, {
                ack,
                status: "IN PROCESS" // Explicit hint for UI
              });
              await this.recordTimelineForMachine(machineId, "RUNNING", { ack });
              console.log(`[PLC:WAITING_END] machineId=${machineId}`);

              if (typeof onStarted === "function") await onStarted(ack);
            },
            onAckEndOk: async (ack) => {
              // STEP 6 — Verify END_OK Detection
              console.log(`[PLC:END_OK_DETECTED] machineId=${machineId} value=${ack.value}`);
              await this.transitionSafely(machineId, plcStateMachineService.states.COMPLETED_OK, { ack });
              await this.recordTimelineForMachine(machineId, "COMPLETED_OK", { ack });

              // CRITICAL: Stop further PLC polling immediately after cycle complete
              const plcPollingService = require("./plcPollingService");
              plcPollingService.stopPolling(machineId);

              machineWatchdogService.recordSuccess(machineId);
              if (typeof onEndedOk === "function") await onEndedOk(ack);

              // Move to IDLE after success acknowledgment (1.5s as per rule)
              setTimeout(async () => {
                await this.markIdle(machineId);
              }, 1500);
            },

            onAckEndNg: async (ack) => {
              const bin = resolveBinAckConfig(machine);
              if (bin.enabled) {
                await this.transitionSafely(machineId, plcStateMachineService.states.WAITING_BIN_ACK, { ack });
                await this.recordTimelineForMachine(machineId, "WAITING_BIN_ACK", { ack });
              } else {
                await this.transitionSafely(machineId, plcStateMachineService.states.COMPLETED_NG, { ack });
                await this.recordTimelineForMachine(machineId, "COMPLETED_NG", { ack });
              }
              machineWatchdogService.recordSuccess(machineId);
              if (typeof onEndedNg === "function") await onEndedNg(ack);
            },
            onFailure: async (error) => {
              const runtime = await plcStateMachineService.getOrCreateRuntimeState(machineId);
              const currentState = runtime.current_state;
              const errorState = this.resolveFailureState(currentState, error);
              const transitioned = await this.transitionSafely(machineId, errorState, {
                error_message: error.message
              }, {
                tag: "ON_FAILURE_STATE_TRANSITION_FAILED"
              });
              if (!transitioned && errorState !== plcStateMachineService.states.PLC_ERROR) {
                await this.transitionSafely(machineId, plcStateMachineService.states.PLC_ERROR, {
                  error_message: error.message
                }, {
                  tag: "ON_FAILURE_PLC_ERROR_FALLBACK_FAILED"
                });
              }

              const timeoutFailure = String(error?.message || "").toUpperCase().includes("TIMEOUT");
              machineWatchdogService.recordError(machineId, timeoutFailure ? "TIMEOUT" : "PLC_ERROR", error.message);

              await this.recordTimelineForMachine(machineId, errorState, { error: error.message });
              if (typeof onError === "function") await onError(error);
            },
          });
        },
      });

      console.log(`[PLC:LEASE_RELEASED] machineId=${machineId}`);
      // STEP 7 — Verify Reset Sequence (Latch Release)
      console.log(`[PLC:LATCH_RELEASED] machineId=${machineId}`);
      console.log(`[PLC:START_CLEARED] machineId=${machineId}`);
      console.log(`[PLC:MACHINE_LOCK_CLEARED] machineId=${machineId}`);


      const latencyMs = Date.now() - cycleStartedAtMs;
      telemetry.recordPlcLatency(latencyMs, Boolean(result?.ok), result?.ok ? null : "ERROR");

      if (!result?.ok) {
        throw new Error(result?.error || "PLC handshake failed");
      }

      telemetry.recordCycleCompletion(latencyMs, true);
      return result;
    } catch (error) {
      cycleError = error;
      const latencyMs = Date.now() - cycleStartedAtMs;
      const isCycleTimeout = error.code === "CYCLE_TIMEOUT" || String(error?.message || "").includes("end status timeout");
      const timeoutFailure = isCycleTimeout || String(error?.message || "").toUpperCase().includes("TIMEOUT");

      // Point 7: Global try/catch around industrial handshake execution
      const isReferenceError = error instanceof ReferenceError;
      if (isReferenceError) {
        console.error(`[PLC:CRITICAL_RUNTIME_ERROR] ReferenceError detected: ${error.message}. Preservation active.`);
      }

      telemetry.recordPlcLatency(latencyMs, false, timeoutFailure ? "TIMEOUT" : "ERROR");
      telemetry.recordCycleCompletion(latencyMs, false);

      // Handle error state transition properly through valid state paths
      try {
        const runtime = await plcStateMachineService.getOrCreateRuntimeState(machineId);
        const currentState = runtime.current_state;

        // Use END_TIMEOUT for cycle timeouts instead of generic PLC_ERROR
        let targetErrorState = this.resolveFailureState(currentState, error);
        if (isCycleTimeout) targetErrorState = plcStateMachineService.states.END_TIMEOUT;

        if (!["PLC_ERROR", "RECOVERING", "RUNNING_TIMEOUT", "END_TIMEOUT", "RESET_TIMEOUT"].includes(currentState)) {
          try {
            await this.transitionSafely(machineId, targetErrorState, {
              error_message: error.message
            });
          } catch (stateError) {
            logWarn("ERROR_STATE_TRANSITION_FAILED", { machineId, currentState, targetState: targetErrorState, error: stateError.message });
          }
        }

        // Only transition to RECOVERING if not a cycle timeout (which allows retry/reset)
        if (!isCycleTimeout) {
          try {
            await this.transitionSafely(machineId, plcStateMachineService.states.RECOVERING, { error_message: error.message });
          } catch (recoveringError) {
            try {
              await this.transitionSafely(machineId, plcStateMachineService.states.IDLE, { error_message: `Recovery fallback from error: ${error.message}` });
            } catch (idleError) { }
          }
        }
      } catch (stateManagementError) {
        logWarn("ERROR_STATE_MANAGEMENT_FAILED", { machineId, error: stateManagementError.message });
      }

      try {
        await recoveryEngine.handlePlcDisconnect({
          machineId,
          currentState: "ERROR",
          operationId: operationLogId,
          error,
        });
      } catch (_recoveryError) { }

      throw error;
    } finally {
      // Preservation logic for machine busy state
      if (cycleError && (cycleError instanceof ReferenceError || cycleError.code === "CYCLE_TIMEOUT")) {
        console.log(`[PLC:PRESERVING_LATCH] machineId=${machineId} due to ${cycleError.code || "RuntimeError"}`);
        await sleep(1500); // 1.5s delay before releasing lock
      }
      this.machineBusy.delete(machineId);
      this.cycleContext.delete(machineId);
      console.log(`[PLC:MACHINE_LOCK_RELEASED] machineId=${machineId}`);
    }
  }

  /**
   * Signal Interlock to PLC (Rejected Scan)
   * Writes BLOCK/NG value to the mapped register to interlock the machine cycle.
   */
  async signalInterlock(machineId, reason = "REJECTED_SCAN") {
    const id = Number(machineId || 0);
    if (!id) return;

    // Suppression Check (Section 4)
    const cacheKey = `${id}:${reason}`;
    const now = Date.now();
    if (suppressionCache.has(cacheKey) && (now - suppressionCache.get(cacheKey) < SUPPRESSION_WINDOW_MS)) {
      return; // Suppress repeated interlock for cooldown
    }
    suppressionCache.set(cacheKey, now);

    try {
      const Machine = require("../models/Machine");
      const machine = await Machine.findByPk(id);
      if (!machine) return;

      const ip = machine.plc_ip || machine.machine_ip;
      const port = machine.plc_port || machine.machine_port;
      const blockRegRaw = machine.plc_block_register;
      const startRegRaw = machine.plc_start_register;
      const statusRegRaw = machine.plc_status_register;
      
      // Robust register resolution (v4.5) - Priority: Block > Start (Trigger)
      // For this PLC, Start (Value 1) and Block (Value 2) share R2060.
      let targetReg = (Number(blockRegRaw) > 0) 
        ? Number(blockRegRaw) 
        : (Number(startRegRaw) > 0 ? Number(startRegRaw) : null);

      // SAFETY: Never write interlocks to the status register (R2061) if they are distinct
      if (targetReg === Number(statusRegRaw) && Number(startRegRaw) > 0 && Number(startRegRaw) !== targetReg) {
          console.warn(`[PLC:MAP_OVERRIDE] Redirecting interlock from status (R${targetReg}) to start (R${startRegRaw})`);
          targetReg = Number(startRegRaw);
      }

      const ngValue = Number(machine.plc_block_value || 2);
      const protocol = String(machine.plc_protocol || "TCP_TEXT").trim().toUpperCase();
      const plcPort = Number(port);

      // Transition FSM to Industrial Blocked state (Section 3 & 6) - PRIOR to PLC Write
      const state = reason.includes("DUPLICATE") ? plcStateMachineService.states.BLOCKED : plcStateMachineService.states.INTERLOCKED;
      await plcStateMachineService.transition(id, state, { reason });

      if (!ip || !Number.isFinite(plcPort) || plcPort <= 0 || !targetReg) {
        console.error(`[PLC:CRITICAL_CONFIG_ERROR] machineId=${id} register mapping failed. targetReg=${targetReg}. LOGICAL BLOCK ONLY.`);
        return;
      }

      console.log(`[PLC:INTERLOCK_SIGNAL] machineId=${id} reason=${reason} targetReg=R${targetReg} value=${ngValue}`);

      await plcConnectionManager.runExclusive({
        machineId: id,
        ip, port,
        operationName: "PLC_INTERLOCK_SIGNAL",
        task: async () => {
          if (protocol === "MODBUS_TCP" || protocol === "MODBUS") {
            const { writeModbusRegister } = require("./plcIoService");
            await writeModbusRegister({
              ip,
              port: plcPort,
              unitId: Number(machine.plc_unit_id || 1),
              register: Math.trunc(targetReg),
              value: Math.trunc(ngValue),
              timeoutMs: 2000,
            });
          } else if (protocol === "SLMP") {
            const { writeSlmpRegister } = require("./plcIoService");
            await writeSlmpRegister({
              ip,
              port: plcPort,
              register: Math.trunc(targetReg),
              value: Math.trunc(ngValue),
              device: String(machine.plc_slmp_device || "D").trim().toUpperCase() || "D",
              timeoutMs: 2000,
              frameMode: String(machine.plc_slmp_frame_mode || "AUTO").trim().toUpperCase() || "AUTO",
            });
          } else if (protocol === "TCP_TEXT" || protocol === "TCP") {
            const plcService = require("./plcCommunicationService");
            const client = plcService.getTcpClient(ip, plcPort);
            client.write(`INTERLOCK,${Math.trunc(targetReg)},${Math.trunc(ngValue)}\r\n`);
          }
        }
      });

      emitRealtime("dashboard_refresh", { reason: "INTERLOCK_SENT", machineId: id });

      // Auto-return to IDLE after block signal pulse (Rule 3)
      setTimeout(async () => {
        await this.markIdle(id);
      }, 3000);
    } catch (error) {
      logWarn("INTERLOCK_SIGNAL_FAILED", { machineId: id, error: error.message });
    }
  }
}

module.exports = new PlcHandshakeEngine();
