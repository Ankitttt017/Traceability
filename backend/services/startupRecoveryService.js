const Machine = require("../models/Machine");
const OperationLog = require("../models/OperationLog");
const { Op } = require("sequelize");
const { clearMachineLock } = require("./machineLockService");
const plcHandshakeEngine = require("./plcHandshakeEngine");
const { emitRealtime } = require("./realtimeService");

function normalizeStation(value) {
  return String(value || "").trim().toUpperCase();
}

async function recoverInFlightOperations() {
  const staleRows = await OperationLog.findAll({
    where: {
      plc_status: {
        [Op.in]: ["PENDING", "STARTED"],
      },
    },
    order: [["updatedAt", "ASC"]],
    limit: 500,
  });

  for (const row of staleRows) {
    await row.update({
      plc_status: "PLC_COMM_ERROR",
      interlock_reason: "RECOVERY_PENDING_AFTER_BACKEND_RESTART",
      plc_end_time: new Date(),
      plc_end_at: new Date(),
    });
    emitRealtime("operator_popup", {
      type: "WARNING",
      partId: row.part_id,
      stationNo: normalizeStation(row.station_no || row.operation_no),
      machineId: row.machine_id || null,
      status: "RECOVERING",
      plcStatus: "PLC_COMM_ERROR",
      message: "Recovered unfinished cycle after backend restart. Please reset and re-scan.",
    });
  }
}

async function rebuildMachineRuntimeStates() {
  const plcRecoveryService = require("./plcRecoveryService");
  await plcRecoveryService.recoverAll();
}

async function runStartupRecovery() {
  await recoverInFlightOperations();
  await rebuildMachineRuntimeStates();
}

module.exports = {
  runStartupRecovery,
};
