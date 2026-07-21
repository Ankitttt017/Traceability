const OperationLog = require("../models/OperationLog");
const { Op } = require("sequelize");
const { clearMachineLock } = require("./machineLockService");
const plcHandshakeEngine = require("./plcHandshakeEngine");
const { emitRealtime } = require("./realtimeService");

const RECOVERY_MAX_AGE_HOURS = Math.max(Number(process.env.STARTUP_RECOVERY_MAX_AGE_HOURS || 24), 1);

function normalizeStation(value) {
  return String(value || "").trim().toUpperCase();
}

async function hasFinalInspectionOk(partId) {
  const cleanPartId = String(partId || "").trim();
  if (!cleanPartId) return false;
  const row = await OperationLog.findOne({
    where: {
      part_id: cleanPartId,
      result: "OK",
      plc_status: { [Op.in]: ["ENDED_OK", "COMPLETED_OK", "OK"] },
      [Op.or]: [{ operation_no: "OP160" }, { station_no: "OP160" }],
    },
  });
  return Boolean(row);
}

async function recoverInFlightOperations() {
  const recoveryCutoff = new Date(Date.now() - RECOVERY_MAX_AGE_HOURS * 60 * 60 * 1000);
  const staleRows = await OperationLog.findAll({
    where: {
      plc_status: {
        [Op.in]: ["PENDING", "STARTED"],
      },
      updatedAt: { [Op.gte]: recoveryCutoff },
    },
    order: [["updatedAt", "ASC"]],
    limit: 500,
  });

  for (const row of staleRows) {
    if (await hasFinalInspectionOk(row.part_id)) {
      continue;
    }
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
