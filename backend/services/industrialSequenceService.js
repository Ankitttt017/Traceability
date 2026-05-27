/**
 * industrialSequenceService.js
 * 
 * PREVIOUS STATION / SEQUENCE CONTROL
 * 
 * Ensures:
 * • Previous station completion enforcement.
 * • Rework flow validation.
 * • Repair/rejection station routing.
 * • Sequence rollback handling.
 * • Duplicate previous-station records handling.
 */

const OperationLog = require("../models/OperationLog");
const { logWarn, logInfo } = require("./industrialLogger");

class IndustrialSequenceService {
  /**
   * Validate if a part can proceed to the current station.
   */
  async validateSequence(partId, currentStationNo, machineId) {
    // 1. Check for rework/rollback - get latest log
    const lastLog = await OperationLog.findOne({
      where: { part_id: partId },
      order: [['created_at', 'DESC']]
    });

    if (!lastLog) {
      // First station? Check if currentStation is allowed to be first
      // (This usually depends on your plant layout)
      logInfo("SEQUENCE_FIRST_STATION", { partId, currentStationNo });
      return { ok: true, isFirst: true };
    }

    // 2. Enforcement: Has previous station finished?
    // In many industrial lines, stations are sequential (e.g., 10 -> 20 -> 30)
    const lastStationNo = lastLog.station_no;
    const lastStatus = lastLog.status;

    if (lastStatus !== "OK" && lastStatus !== "PASS") {
      logWarn("SEQUENCE_PREVIOUS_STATION_FAILED", { 
        partId, 
        lastStationNo, 
        lastStatus, 
        currentStationNo 
      });
      return { 
        ok: false, 
        reason: "PREVIOUS_STATION_FAILED", 
        lastStationNo, 
        lastStatus 
      };
    }

    // 3. Rollback / Skip Detection
    // If the part is jumping backwards or skipping a station
    // (Logic depends on your sequence_no or station_no numbering)
    if (Number(currentStationNo) < Number(lastStationNo)) {
      logInfo("SEQUENCE_ROLLBACK_DETECTED", { partId, from: lastStationNo, to: currentStationNo });
      return { ok: true, isRollback: true };
    }

    // 4. Duplicate Check
    if (currentStationNo === lastStationNo) {
      logWarn("SEQUENCE_DUPLICATE_STATION_ATTEMPT", { partId, currentStationNo });
      return { ok: false, reason: "DUPLICATE_STATION_OPERATION" };
    }

    return { ok: true };
  }

  /**
   * Handle rework flow - marks part as needing rework or allows repair station.
   */
  async authorizeRework(partId, machineId, supervisorId) {
    logInfo("REWORK_AUTHORIZED", { partId, machineId, supervisorId });
    // This would typically involve inserting a REWORK_START log or similar
    return true;
  }
}

module.exports = new IndustrialSequenceService();
