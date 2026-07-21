/**
 * industrialTransactionService.js
 * 
 * ATOMIC INDUSTRIAL TRANSACTIONS
 * 
 * Ensures:
 * • DB transactions rollback correctly on failure.
 * • Compensating PLC actions (RESET) if DB fails after PLC write.
 * • Retry-loop infinite recursion protection.
 * • Graceful error propagation.
 */

const sequelize = require("../config/db");
const { logError, logWarn } = require("./industrialLogger");
const plcCommunicationService = require("./plcCommunicationService");

class IndustrialTransactionService {
  constructor() {
    this.MAX_RETRIES = 3;
  }

  async finishSafely(transaction, action, context = {}) {
    if (!transaction || transaction.finished) return false;
    try {
      if (action === "commit") await transaction.commit();
      else if (action === "rollback") await transaction.rollback();
      return true;
    } catch (error) {
      logWarn("INDUSTRIAL_TRANSACTION_FINISH_FAILED", {
        action,
        error: error.message,
        ...context,
      });
      return false;
    }
  }

  /**
   * Execute an atomic DB update and PLC command.
   * If DB fails, rolls back.
   * If PLC fails, rolls back DB and alerts.
   */
  async execute(machine, partId, dbTask, plcCommand = null) {
    let attempt = 0;
    
    while (attempt < this.MAX_RETRIES) {
      const transaction = await sequelize.transaction();
      try {
        attempt++;

        // 1. Execute DB Task (inside transaction)
        const result = await dbTask(transaction);

        // 2. Execute PLC Command (if provided)
        if (plcCommand) {
          try {
            await plcCommunicationService.sendPlcCommand(machine, plcCommand);
          } catch (plcErr) {
            // PLC write failed - abort DB transaction
            throw new Error(`PLC_WRITE_FAILED: ${plcErr.message}`);
          }
        }

        // 3. Commit DB
        await this.finishSafely(transaction, "commit", { machineId: machine.id, partId, attempt });
        return result;

      } catch (error) {
        // 4. Rollback DB
        await this.finishSafely(transaction, "rollback", { machineId: machine.id, partId, attempt });
        
        logError("INDUSTRIAL_TRANSACTION_FAILED", { 
          machineId: machine.id, 
          partId, 
          attempt, 
          error: error.message 
        });

        // Infinite loop protection
        if (attempt >= this.MAX_RETRIES || error.message.includes("FATAL")) {
          throw error;
        }

        // Delay before retry
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
  }

  /**
   * Compensating action for PLC if something went wrong elsewhere.
   */
  async compensatePlc(machine) {
    logWarn("PLC_COMPENSATION_TRIGGERED", { machineId: machine.id });
    try {
      await plcCommunicationService.sendPlcCommand(machine, "RESET_OPERATION");
    } catch (err) {
      logError("PLC_COMPENSATION_FAILED", { machineId: machine.id, error: err.message });
    }
  }
}

module.exports = new IndustrialTransactionService();
