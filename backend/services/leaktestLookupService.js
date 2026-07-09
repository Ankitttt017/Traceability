const { Op } = require("sequelize");
const LeaktestRecord = require("../models/LeaktestRecord");

const LEAKTEST_OPERATION = "OP150";
const LEAKTEST_VISIBLE_FIELDS = [
  "Machine",
  "Cycle_End_Time",
  "Part_QR_Code",
  "Result",
  "Body_Leak_Value",
  "Gall_1",
  "Gall_2",
  "Cycle_Time",
  "Running_Mode",
  "Manual",
  "Dry",
  "Wey",
  "Both",
];

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeMachineName(value) {
  return normalizeUpper(value).replace(/[^A-Z0-9]+/g, "");
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function getMachineIpCandidates(machine = {}) {
  return uniqueStrings([
    machine.plc_ip,
    machine.qr_scanner_ip,
    machine.machine_ip,
    machine.plcIp,
    machine.qrScannerIp,
    machine.machineIp,
  ]);
}

function isLeaktestMachine(machine = {}) {
  const stationNo = normalizeUpper(machine.operation_no || machine.operationNo || machine.stationNo || machine.station_no);
  if (stationNo === LEAKTEST_OPERATION) return true;
  const machineName = normalizeUpper(machine.machine_name || machine.machineName);
  return stationNo === LEAKTEST_OPERATION || machineName.includes("LEAK");
}

function normalizeLeaktestRow(row) {
  if (!row) return null;
  return {
    machineName: normalizeText(row.Machine) || null,
    matchedMachineName: normalizeText(row.__matchedMachineName || row.Machine) || null,
    matchedMachineId: Number(row.__matchedMachineId || 0) || null,
    matchedStationNo: normalizeText(row.__matchedStationNo) || LEAKTEST_OPERATION,
    cycleEndTime: row.Cycle_End_Time || null,
    partQrCode: normalizeText(row.Part_QR_Code) || null,
    result: normalizeUpper(row.Result) || null,
    bodyLeakValue: row.Body_Leak_Value ?? null,
    gall1: row.Gall_1 ?? null,
    gall2: row.Gall_2 ?? null,
    cycleTime: row.Cycle_Time ?? null,
    runningMode: row.Running_Mode ?? null,
    manual: row.Manual ?? null,
    dry: row.Dry ?? null,
    wey: row.Wey ?? null,
    both: row.Both ?? null,
    Machine: normalizeText(row.Machine) || null,
    Cycle_End_Time: row.Cycle_End_Time || null,
    Part_QR_Code: normalizeText(row.Part_QR_Code) || null,
    Result: normalizeUpper(row.Result) || null,
    Body_Leak_Value: row.Body_Leak_Value ?? null,
    Gall_1: row.Gall_1 ?? null,
    Gall_2: row.Gall_2 ?? null,
    Cycle_Time: row.Cycle_Time ?? null,
    Running_Mode: row.Running_Mode ?? null,
    Manual: row.Manual ?? null,
    Dry: row.Dry ?? null,
    Wey: row.Wey ?? null,
    Both: row.Both ?? null,
    matchedMachineName: normalizeText(row.__matchedMachineName || row.Machine) || null,
    matchedMachineId: Number(row.__matchedMachineId || 0) || null,
    matchedStationNo: normalizeText(row.__matchedStationNo) || LEAKTEST_OPERATION,
  };
}

function pickBetterLeaktestRow(current, candidate) {
  if (!current) return candidate;
  const currentTime = new Date(current?.Cycle_End_Time || 0).getTime();
  const candidateTime = new Date(candidate?.Cycle_End_Time || 0).getTime();
  if (candidateTime > currentTime) return candidate;
  if (candidateTime < currentTime) return current;

  const currentHasResult = Boolean(normalizeUpper(current?.Result));
  const candidateHasResult = Boolean(normalizeUpper(candidate?.Result));
  if (candidateHasResult && !currentHasResult) return candidate;
  if (!candidateHasResult && currentHasResult) return current;

  return Number(candidate?.Id || 0) > Number(current?.Id || 0) ? candidate : current;
}

async function fetchLeaktestRowsByQrAndIp({ qrCodes = [], machineIps = [] } = {}) {
  const uniqueQrCodes = uniqueStrings(qrCodes);
  const uniqueMachineIps = uniqueStrings(machineIps);
  if (!uniqueQrCodes.length || !uniqueMachineIps.length) {
    return [];
  }

  return LeaktestRecord.findAll({
    where: {
      Part_QR_Code: { [Op.in]: uniqueQrCodes },
      PLC_IP: { [Op.in]: uniqueMachineIps },
    },
    attributes: ["Id", ...LEAKTEST_VISIBLE_FIELDS, "PLC_IP"],
    order: [["Cycle_End_Time", "DESC"], ["Id", "DESC"]],
    raw: true,
  });
}

async function buildLeaktestIndex({ partIds = [], customerQrByPartId = {}, machines = [] } = {}) {
  const leakMachines = (machines || []).filter((machine) => isLeaktestMachine(machine));
  if (!leakMachines.length) {
    return { byPartAndStation: {}, byPartAndIp: {}, leakMachineRows: [] };
  }

  const qrCodes = [];
  for (const partId of partIds || []) {
    const normalizedPartId = normalizeText(partId);
    if (!normalizedPartId) continue;
    const customerQr = normalizeText(customerQrByPartId[normalizeUpper(normalizedPartId)] || customerQrByPartId[normalizedPartId]);
    if (customerQr) qrCodes.push(customerQr);
  }

  const machineIps = leakMachines.flatMap((machine) => getMachineIpCandidates(machine));
  const rows = await fetchLeaktestRowsByQrAndIp({ qrCodes, machineIps });

  const machineIpLookup = leakMachines.reduce((acc, machine) => {
    const stationNo = normalizeUpper(machine.operation_no || machine.operationNo || machine.stationNo || machine.station_no);
    const machineName = normalizeText(machine.machine_name || machine.machineName);
    const normalizedMachineName = normalizeMachineName(machineName);
    const entry = {
      machineId: Number(machine.id || machine.machineId || 0) || null,
      machineName,
      normalizedMachineName,
      stationNo: stationNo || LEAKTEST_OPERATION,
      ipCandidates: getMachineIpCandidates(machine),
    };
    entry.ipCandidates.forEach((ip) => {
      const key = normalizeText(ip);
      if (!key) return;
      if (!acc[key]) acc[key] = [];
      acc[key].push(entry);
    });
    return acc;
  }, {});

  // byPartAndStation — backward-compat aggregate (one best row per station, used for pass/fail gate)
  const byPartAndStation = {};
  // byPartAndIp — one slot per physical machine IP so Leak Test 1/2/3 never overwrite each other
  const byPartAndIp = {};

  for (const row of rows) {
    const partQrCode = normalizeText(row.Part_QR_Code);
    const plcIp     = normalizeText(row.PLC_IP);
    const machineEntries = machineIpLookup[plcIp] || [];
    if (!partQrCode || !machineEntries.length) continue;

    for (const partId of partIds || []) {
      const normalizedPartId = normalizeText(partId);
      if (!normalizedPartId) continue;
      const mappedCustomerQr = normalizeText(customerQrByPartId[normalizeUpper(normalizedPartId)] || customerQrByPartId[normalizedPartId]);
      if (!mappedCustomerQr || partQrCode !== mappedCustomerQr) continue;

      const partKey = normalizeUpper(normalizedPartId);
      if (!byPartAndStation[partKey]) byPartAndStation[partKey] = {};
      if (!byPartAndIp[partKey])      byPartAndIp[partKey]      = {};

      for (const machineEntry of machineEntries) {
        const stationKey = normalizeUpper(machineEntry.stationNo || LEAKTEST_OPERATION);
        const next = {
          ...row,
          __matchedMachineId:   machineEntry.machineId,
          __matchedMachineName: machineEntry.machineName,
          __matchedStationNo:   stationKey,
          __matchedIp:          plcIp,
        };

        // ── Aggregate (best row per station) ──────────────────────
        byPartAndStation[partKey][stationKey] =
          pickBetterLeaktestRow(byPartAndStation[partKey][stationKey], next);

        // ── Per-machine (best row per physical IP) ────────────────
        // Key = "OP150__192.168.119.40"  — unique per physical machine
        const ipKey = `${stationKey}__${plcIp}`;
        byPartAndIp[partKey][ipKey] =
          pickBetterLeaktestRow(byPartAndIp[partKey][ipKey], next);
      }
    }
  }

  return { byPartAndStation, byPartAndIp, leakMachineRows: leakMachines };
}

function getLeaktestReadingForPartStation(index, partId, stationNo) {
  const partKey    = normalizeUpper(partId);
  const stationKey = normalizeUpper(stationNo || LEAKTEST_OPERATION);
  const row = index?.[partKey]?.[stationKey] || null;
  return normalizeLeaktestRow(row);
}

/**
 * getAllLeaktestReadingsForPart
 * Returns an array of normalized readings — one per physical machine IP — for
 * the given part and station.  This is how Leak Test 1, 2 and 3 are surfaced
 * separately even though they all share the same operation_no (OP150).
 *
 * @param {object} byPartAndIp   — the byPartAndIp map from buildLeaktestIndex()
 * @param {string} partId
 * @param {string} [stationNo]   — defaults to LEAKTEST_OPERATION
 * @returns {Array<object>}      — sorted by IP address, empty if none found
 */
function getAllLeaktestReadingsForPart(byPartAndIp, partId, stationNo) {
  const partKey    = normalizeUpper(partId);
  const stationKey = normalizeUpper(stationNo || LEAKTEST_OPERATION);
  const ipMap      = byPartAndIp?.[partKey] || {};

  return Object.entries(ipMap)
    .filter(([ipKey]) => ipKey.startsWith(stationKey + "__"))
    .sort(([a], [b]) => a.localeCompare(b))           // stable order by IP
    .map(([, row]) => normalizeLeaktestRow(row))
    .filter(Boolean);
}

/**
 * getLeaktestStageStateFromReadings
 * Determines the aggregate pass/fail state from ALL physical machines:
 *   - Any NG  → FAILED
 *   - All OK  → PASSED
 *   - Otherwise → PENDING (at least one machine hasn't reported yet)
 */
function getLeaktestStageStateFromReadings(readings = []) {
  if (!readings.length) return "PENDING";
  if (readings.some((r) => normalizeUpper(r?.result) === "NG"))  return "FAILED";
  if (readings.every((r) => normalizeUpper(r?.result) === "OK")) return "PASSED";
  return "PENDING";
}

function getLeaktestStageState(reading) {
  const result = normalizeUpper(reading?.result || reading?.Result);
  if (result === "OK") return "PASSED";
  if (result === "NG") return "FAILED";
  return "PENDING";
}

module.exports = {
  LEAKTEST_OPERATION,
  LEAKTEST_VISIBLE_FIELDS,
  buildLeaktestIndex,
  getLeaktestReadingForPartStation,
  getAllLeaktestReadingsForPart,
  getLeaktestStageState,
  getLeaktestStageStateFromReadings,
  getMachineIpCandidates,
  isLeaktestMachine,
  normalizeLeaktestRow,
  normalizeMachineName,
};
