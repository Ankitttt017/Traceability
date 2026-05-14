/**
 * deterministicResetValidationService.js
 * ════════════════════════════════════════════════════════════════
 * 
 * DETERMINISTIC RESET VALIDATION
 * 
 * After operation completion, ensures:
 * • Reset signals sent and acknowledged
 * • PLC signals fully cleared
 * • Machine returned to safe idle state
 * • No stale signals contaminate next cycle
 * • Prevents unlock until validation complete
 * 
 * Reset Sequence:
 * 1. Send reset/clear command to PLC
 * 2. Wait for PLC acknowledgment
 * 3. Poll PLC signals until cleared
 * 4. Verify safe idle state
 * 5. Clear machine lock in DB
 * 
 * Guarantees:
 * • Atomic DB unlock
 * • Signal verification before unlock
 * • Timeout recovery if reset hangs
 * • Deterministic state after reset
 * • No stale operations on next cycle
 * 
 * ════════════════════════════════════════════════════════════════
 */

const { logInfo, logWarn, logError } = require("./industrialLogger");

const RESET_TIMEOUT_MS = Number(
  process.env.PLC_RESET_TIMEOUT_MS || 10000
);
const RESET_SIGNAL_CLEAR_TIMEOUT_MS = Number(
  process.env.PLC_RESET_SIGNAL_CLEAR_TIMEOUT_MS || 5000
);
const RESET_POLL_INTERVAL_MS = Number(
  process.env.PLC_RESET_POLL_INTERVAL_MS || 500
);

/**
 * Validate machine reset sequence.
 */
async function validateResetSequence({
  machineId,
  plcEndpoint,
  sendResetFn,
  pollSignalsFn,
  verifyIdleFn,
  timeoutMs = RESET_TIMEOUT_MS,
}) {
  const startTime = Date.now();
  const steps = [];

  try {
    // Step 1: Send reset command
    logInfo("RESET_VALIDATION_START", {
      machineId,
      endpoint: plcEndpoint,
    });

    steps.push({ step: "SEND_RESET", status: "IN_PROGRESS" });

    let resetAck;
    try {
      resetAck = await withTimeout(
        sendResetFn(),
        RESET_TIMEOUT_MS,
        "Reset command timeout"
      );
      steps[steps.length - 1].status = "COMPLETE";
      steps[steps.length - 1].ack = resetAck;
    } catch (err) {
      steps[steps.length - 1].status = "FAILED";
      steps[steps.length - 1].error = err.message;
      throw err;
    }

    // Step 2: Poll until signals cleared
    steps.push({ step: "WAIT_SIGNALS_CLEAR", status: "IN_PROGRESS" });

    let signalsClear = false;
    let pollAttempts = 0;
    const maxPollAttempts = Math.ceil(
      RESET_SIGNAL_CLEAR_TIMEOUT_MS / RESET_POLL_INTERVAL_MS
    );

    while (!signalsClear && pollAttempts < maxPollAttempts) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error("Reset validation timeout (signals not clearing)");
      }

      try {
        const signals = await pollSignalsFn();
        signalsClear = _areSignalsCleared(signals);
        pollAttempts += 1;

        if (!signalsClear && pollAttempts % 3 === 0) {
          // Log every 3rd attempt
          logInfo("RESET_SIGNALS_POLLING", {
            machineId,
            attempt: pollAttempts,
            signals,
          });
        }

        if (!signalsClear) {
          // Wait before next poll
          await new Promise((r) =>
            setTimeout(r, RESET_POLL_INTERVAL_MS)
          );
        }
      } catch (err) {
        logWarn("RESET_SIGNALS_POLL_ERROR", {
          machineId,
          error: err.message,
        });
        throw err;
      }
    }

    if (!signalsClear) {
      throw new Error("Reset signals did not clear within timeout");
    }

    steps[steps.length - 1].status = "COMPLETE";
    steps[steps.length - 1].pollAttempts = pollAttempts;

    // Step 3: Verify machine in safe idle
    steps.push({ step: "VERIFY_IDLE", status: "IN_PROGRESS" });

    let idleVerified = false;
    try {
      const idleState = await withTimeout(
        verifyIdleFn(),
        5000,
        "Idle verification timeout"
      );
      idleVerified = _isInSafeIdleState(idleState);

      if (!idleVerified) {
        logWarn("RESET_NOT_IN_IDLE", {
          machineId,
          idleState,
        });
        throw new Error("Machine not in safe idle state after reset");
      }

      steps[steps.length - 1].status = "COMPLETE";
      steps[steps.length - 1].idleState = idleState;
    } catch (err) {
      steps[steps.length - 1].status = "FAILED";
      steps[steps.length - 1].error = err.message;
      throw err;
    }

    // All steps passed
    const totalDuration = Date.now() - startTime;

    logInfo("RESET_VALIDATION_SUCCESS", {
      machineId,
      endpoint: plcEndpoint,
      durationMs: totalDuration,
      steps,
    });

    return {
      validated: true,
      machineId,
      durationMs: totalDuration,
      steps,
      readyToUnlock: true,
    };
  } catch (error) {
    const totalDuration = Date.now() - startTime;

    logError("RESET_VALIDATION_FAILED", {
      machineId,
      endpoint: plcEndpoint,
      error: error.message,
      durationMs: totalDuration,
      failedStep: steps.length > 0 ? steps[steps.length - 1].step : null,
    });

    return {
      validated: false,
      machineId,
      durationMs: totalDuration,
      error: error.message,
      steps,
      readyToUnlock: false,
    };
  }
}

/**
 * Deterministic unlock after validated reset.
 */
async function deterministicUnlock({
  machineId,
  unlockFn,
}) {
  try {
    logInfo("DETERMINISTIC_UNLOCK_START", {
      machineId,
    });

    // Execute unlock (typically DB update)
    const result = await unlockFn();

    logInfo("DETERMINISTIC_UNLOCK_SUCCESS", {
      machineId,
      result,
    });

    return {
      unlocked: true,
      machineId,
      result,
    };
  } catch (error) {
    logError("DETERMINISTIC_UNLOCK_FAILED", {
      machineId,
      error: error.message,
    });

    // Critical: Log but don't propagate (machine needs manual recovery)
    return {
      unlocked: false,
      machineId,
      error: error.message,
    };
  }
}

/**
 * Complete reset validation + unlock sequence.
 */
async function executeResetAndUnlock({
  machineId,
  plcEndpoint,
  sendResetFn,
  pollSignalsFn,
  verifyIdleFn,
  unlockFn,
  timeoutMs = RESET_TIMEOUT_MS,
}) {
  try {
    // Step 1: Validate reset
    const validation = await validateResetSequence({
      machineId,
      plcEndpoint,
      sendResetFn,
      pollSignalsFn,
      verifyIdleFn,
      timeoutMs,
    });

    if (!validation.validated) {
      logWarn("RESET_VALIDATION_FAILED_NOT_UNLOCKING", {
        machineId,
        error: validation.error,
      });

      return {
        success: false,
        reason: "RESET_VALIDATION_FAILED",
        machineId,
        error: validation.error,
      };
    }

    // Step 2: Unlock (only after successful validation)
    const unlock = await deterministicUnlock({
      machineId,
      unlockFn,
    });

    if (!unlock.unlocked) {
      logError("RESET_UNLOCK_FAILED_AFTER_VALIDATION", {
        machineId,
        error: unlock.error,
      });

      return {
        success: false,
        reason: "UNLOCK_FAILED",
        machineId,
        error: unlock.error,
      };
    }

    logInfo("RESET_AND_UNLOCK_SUCCESS", {
      machineId,
    });

    return {
      success: true,
      machineId,
      resetDuration: validation.durationMs,
    };
  } catch (error) {
    logError("RESET_AND_UNLOCK_ERROR", {
      machineId,
      error: error.message,
    });

    return {
      success: false,
      reason: "UNEXPECTED_ERROR",
      machineId,
      error: error.message,
    };
  }
}

/**
 * Check if signals are cleared.
 */
function _areSignalsCleared(signals) {
  if (!signals) return false;

  // Typical industrial signals to check
  const criticalSignals = [
    "start_signal",
    "run_command",
    "output_signal",
    "busy_flag",
  ];

  for (const signal of criticalSignals) {
    if (signals[signal] && signals[signal] !== 0 && signals[signal] !== false) {
      return false;
    }
  }

  return true;
}

/**
 * Check if machine in safe idle state.
 */
function _isInSafeIdleState(idleState) {
  if (!idleState) return false;

  // Machine must be:
  // - Not running
  // - Not in alarm
  // - Ready for next operation
  return (
    idleState.running === false &&
    idleState.alarm === false &&
    idleState.ready === true
  );
}

/**
 * Wrap function with timeout.
 */
function withTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(timeoutMessage)),
        timeoutMs
      )
    ),
  ]);
}

module.exports = {
  validateResetSequence,
  deterministicUnlock,
  executeResetAndUnlock,
};
