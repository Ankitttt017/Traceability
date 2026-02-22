let ioRef = null;

function setSocketServer(io) {
  ioRef = io;
}

function normalizePartId(partId) {
  const normalized = String(partId || "").trim();
  return normalized || null;
}

function getPartRoom(partId) {
  const normalized = normalizePartId(partId);
  if (!normalized) {
    return null;
  }
  return `part:${normalized}`;
}

function buildJourneyUpdatePayload(sourceEvent, payload = {}) {
  const partId = normalizePartId(payload.partId || payload.part_id);
  if (!partId) {
    return null;
  }

  return {
    sourceEvent,
    partId,
    stationNo: payload.stationNo || payload.station_no || null,
    machineId: payload.machineId || payload.machine_id || null,
    status: payload.status || null,
    decision: payload.decision || null,
    reason: payload.reason || null,
    message: payload.message || null,
    currentStatus: payload.currentStatus || payload.current_status || null,
    expectedStation: payload.expectedStation || payload.expected_station || null,
    timestamp: payload.timestamp || new Date().toISOString(),
  };
}

function emitRealtime(event, payload) {
  if (!ioRef) {
    return;
  }

  ioRef.emit(event, payload);

  const partRoom = getPartRoom(payload?.partId || payload?.part_id);
  if (partRoom) {
    // Narrowcast the original payload to clients subscribed to that part.
    ioRef.to(partRoom).emit(event, payload);
  }

  if (event === "operator_popup" || event === "scan_event") {
    const journeyPayload = buildJourneyUpdatePayload(event, payload);
    if (!journeyPayload) {
      return;
    }

    ioRef.emit("journey_update", journeyPayload);
    const journeyRoom = getPartRoom(journeyPayload.partId);
    if (journeyRoom) {
      ioRef.to(journeyRoom).emit("journey_update", journeyPayload);
    }
  }
}

module.exports = {
  setSocketServer,
  emitRealtime,
  getPartRoom,
};
