const Machine = require("../models/Machine");

const DEFAULT_LOCK_STALE_MS = Math.max(Number(process.env.MACHINE_RUN_LOCK_STALE_MS || 15 * 60 * 1000), 5000);

function normalizeMachineId(machineId) {
  const parsed = Number(machineId);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizeLockText(value) {
  const text = String(value || "").trim();
  return text || null;
}

async function clearMachineLock(machineId) {
  const id = normalizeMachineId(machineId);
  if (!id) {
    return;
  }

  await Machine.update(
    {
      is_running: false,
      running_part_id: null,
      running_station_no: null,
      running_started_at: null,
    },
    {
      where: { id },
    }
  );
}

async function tryAcquireMachineLock({ machineId, partId, stationNo }) {
  const id = normalizeMachineId(machineId);
  if (!id) {
    return {
      acquired: false,
      reason: "INVALID_MACHINE",
    };
  }

  const runningPartId = normalizeLockText(partId);
  const runningStationNo = normalizeLockText(stationNo);
  const lockTime = new Date();
  const [updated] = await Machine.update(
    {
      is_running: true,
      running_part_id: runningPartId,
      running_station_no: runningStationNo,
      running_started_at: lockTime,
    },
    {
      where: {
        id,
        is_running: false,
      },
    }
  );

  if (updated > 0) {
    return {
      acquired: true,
      machineId: id,
      runningPartId,
      runningStationNo,
      runningStartedAt: lockTime.toISOString(),
      staleRecovered: false,
    };
  }

  const machine = await Machine.findByPk(id, {
    attributes: ["id", "is_running", "running_part_id", "running_station_no", "running_started_at"],
  });
  if (!machine) {
    return {
      acquired: false,
      reason: "MACHINE_NOT_FOUND",
    };
  }

  const startedAtMs = machine.running_started_at ? new Date(machine.running_started_at).getTime() : 0;
  const stale = !startedAtMs || Date.now() - startedAtMs >= DEFAULT_LOCK_STALE_MS;
  if (stale) {
    await clearMachineLock(id);
    const [recovered] = await Machine.update(
      {
        is_running: true,
        running_part_id: runningPartId,
        running_station_no: runningStationNo,
        running_started_at: lockTime,
      },
      {
        where: {
          id,
          is_running: false,
        },
      }
    );

    if (recovered > 0) {
      return {
        acquired: true,
        machineId: id,
        runningPartId,
        runningStationNo,
        runningStartedAt: lockTime.toISOString(),
        staleRecovered: true,
      };
    }
  }

  return {
    acquired: false,
    reason: "MACHINE_RUNNING",
    machineId: id,
    runningPartId: machine.running_part_id || null,
    runningStationNo: machine.running_station_no || null,
    runningStartedAt: machine.running_started_at || null,
    staleRecovered: false,
  };
}

async function resetAllMachineLocks() {
  await Machine.update(
    {
      is_running: false,
      running_part_id: null,
      running_station_no: null,
      running_started_at: null,
    },
    {
      where: {
        is_running: true,
      },
    }
  );
}

module.exports = {
  tryAcquireMachineLock,
  clearMachineLock,
  resetAllMachineLocks,
};

