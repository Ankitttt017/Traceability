// Machine-scoped popup filtering shared by the Operator page and global
// notification listeners. A station (e.g. OP150 leak test) can have several
// machines; a popup that carries a machineId belongs to that machine only.
// Station matching is a fallback used only when an event has no machineId
// (admin actions such as station reset / rework).

const upper = (value) => String(value ?? "").trim().toUpperCase();

export function getPopupMachineId(payload = {}) {
  return String(payload?.machineId ?? payload?.machine_id ?? "").trim();
}

export function getPopupStationNo(payload = {}) {
  return upper(
    payload?.stationNo ||
    payload?.station_no ||
    payload?.sourceStationNo ||
    payload?.source_station_no ||
    ""
  );
}

export function getPopupStationCandidates(payload = {}) {
  return [
    payload?.stationNo,
    payload?.station_no,
    payload?.sourceStationNo,
    payload?.source_station_no,
    payload?.expectedStation ||
    payload?.expected_station ||
    payload?.lastCompletedStation ||
    payload?.last_completed_station ||
    "",
  ]
    .map(upper)
    .filter(Boolean);
}

/**
 * @param {object} payload socket payload (operator_popup / scan_event / journey_update)
 * @param {{ machineId?: string|number, stationNo?: string, stationReady?: boolean }} active
 */
export function isPopupForMachine(payload = {}, active = {}) {
  const payloadMachineId = getPopupMachineId(payload);
  const activeMachineId = String(active?.machineId ?? "").trim();
  const activeStation = upper(active?.stationNo);
  const payloadStation = getPopupStationNo(payload);
  const candidates = getPopupStationCandidates(payload);
  const stationMatchesActive = Boolean(activeStation) && (
    payloadStation === activeStation || candidates.includes(activeStation)
  );

  if (payloadMachineId) {
    if (!activeMachineId || payloadMachineId !== activeMachineId) return false;
    if (!payloadStation && candidates.length === 0) return true;
    return stationMatchesActive || !activeStation;
  }
  // No machineId on the event: station-level fallback only.
  if (active?.stationReady === false) return false;
  if (!payloadStation && candidates.length === 0) return false;
  return stationMatchesActive;
}
