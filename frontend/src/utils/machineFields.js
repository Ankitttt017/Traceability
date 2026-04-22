export const MACHINE_FORM_FIELD_CONFIG = [
  {
    key: "machineName",
    label: "Machine Name",
    type: "text",
    required: true,
  },
  {
    key: "lineName",
    label: "Line Name",
    type: "text",
    required: true,
  },
  {
    key: "sequenceNo",
    label: "Sequence No",
    type: "number",
    required: true,
  },
  {
    key: "operationNo",
    label: "Operation No",
    type: "text",
    required: true,
  },
  {
    key: "dailyTargetQty",
    label: "Daily Target Qty",
    type: "number",
    required: false,
  },
  {
    key: "plcProtocol",
    label: "Protocol",
    type: "select",
    required: true,
    options: ["TCP_TEXT", "MODBUS_TCP", "SLMP"],
  },
];

export const MACHINE_REGISTER_ROLE_FIELDS = [
  {
    key: "startRegister",
    label: "Start Register",
    required: true,
    description: "Register for START command signal.",
  },
  {
    key: "blockRegister",
    label: "Block Register",
    required: true,
    description: "Register for BLOCK/INTERLOCK signal.",
  },
  {
    key: "runningRegister",
    label: "Running Register",
    required: true,
    description: "Register for RUNNING status feedback signal.",
  },
  {
    key: "endOkRegister",
    label: "End OK Register",
    required: true,
    description: "Register for END_OK completion signal.",
  },
  {
    key: "endNgRegister",
    label: "End NG Register",
    required: true,
    description: "Register for END_NG error signal.",
  },
  {
    key: "partRegister",
    label: "Part ID Register",
    required: false,
    description: "Optional register for PART_ID hash/value exchange.",
  },
  {
    key: "stationRegister",
    label: "Station Register",
    required: false,
    description: "Optional register for STATION hash/value exchange.",
  },
  {
    key: "resetRegister",
    label: "Reset Register",
    required: true,
    description: "Register for RESET command signal.",
  },
  {
    key: "heartbeatRegister",
    label: "Heartbeat Register",
    required: false,
    description: "Optional heartbeat register for PLC link health.",
  },
];

export const MACHINE_MODBUS_TUNING_FIELD_CONFIG = [
  {
    key: "startValue",
    label: "Start Value",
    type: "number",
    required: true,
    placeholder: "1",
  },
  {
    key: "blockValue",
    label: "Block Value",
    type: "number",
    required: true,
    placeholder: "2",
  },
  {
    key: "startedValue",
    label: "Started Value",
    type: "number",
    required: true,
    placeholder: "2",
  },
  {
    key: "endOkValue",
    label: "End OK Value",
    type: "number",
    required: true,
    placeholder: "3",
  },
  {
    key: "endNgValue",
    label: "End NG Value",
    type: "number",
    required: true,
    placeholder: "4",
  },
  {
    key: "resetValue",
    label: "Reset Value",
    type: "number",
    required: true,
    placeholder: "9",
  },
];

export const MACHINE_TABLE_COLUMNS = [
  { key: "machineName", label: "Machine Name", sortable: true },
  { key: "lineName", label: "Line Name", sortable: true },
  { key: "sequenceNo", label: "Sequence No", sortable: true },
  { key: "operationNo", label: "Operation No", sortable: true },
  { key: "plcProtocol", label: "PLC Protocol", sortable: true },
  { key: "plcIp", label: "PLC IP", sortable: true },
  { key: "plcPort", label: "PLC Port", sortable: true },
  { key: "dailyTargetQty", label: "Daily Target", sortable: true },
  { key: "plcRangeId", label: "PLC Range", sortable: true },
  { key: "plcConfig", label: "PLC Config", sortable: false },
  { key: "status", label: "Status", sortable: true },
];

export function getMachineStage(machine) {
  return machine?.operationNo || machine?.stationNo || "-";
}

export function formatMachineLabel(machine) {
  if (!machine) {
    return "Machine";
  }
  const stage = getMachineStage(machine);
  const line = machine.lineName ? ` | ${machine.lineName}` : "";
  return `${stage} - ${machine.machineName || "Machine"}${line}`;
}
