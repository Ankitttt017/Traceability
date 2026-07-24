const Machine = require("../../models/Machine");

function normalizeText(value) {
  return String(value ?? "").trim();
}

async function buildStationPairsFromRows(rows = [], filters = {}) {
  const machineWhere = {};
  if (filters?.machineId) machineWhere.id = filters.machineId;
  if (filters?.plantId) machineWhere.plant_id = filters.plantId;
  if (filters?.lineId) machineWhere.line_id = filters.lineId;
  else if (filters?.lineName) machineWhere.line_name = filters.lineName;

  const machines = await Machine.findAll({ where: machineWhere, raw: true });
  const fromMachines = (machines || []).map((machine) => {
    const machineName = normalizeText(machine.machine_name || machine.machineName);
    const op = normalizeText(machine.operation_no || machine.operationNo || machine.station_no || machine.stationNo);
    if (!machineName || !op) return null;
    return { key: `${machineName}__${op}`, machineName, op, label: `${machineName} + ${op}` };
  }).filter(Boolean);

  const fromRows = (rows || []).map((row) => {
    const machineName = normalizeText(row.machineName || row.machine_name || row?.Machine?.machine_name);
    const op = normalizeText(row.operationNo || row.operation_no || row.stationNo || row.station_no);
    if (!machineName || !op || machineName === "-") return null;
    return { key: `${machineName}__${op}`, machineName, op, label: `${machineName} + ${op}` };
  }).filter(Boolean);

  const map = new Map();
  [...fromMachines, ...fromRows].forEach((pair) => {
    if (!map.has(pair.key)) map.set(pair.key, pair);
  });

  return [...map.values()].sort((a, b) =>
    a.op.localeCompare(b.op, undefined, { numeric: true, sensitivity: "base" }) ||
    a.machineName.localeCompare(b.machineName)
  );
}

module.exports = {
  buildStationPairsFromRows,
};
