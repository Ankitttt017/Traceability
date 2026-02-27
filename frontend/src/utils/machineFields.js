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
    key: "plcProtocol",
    label: "Protocol",
    type: "select",
    required: true,
    options: ["TCP_TEXT", "MODBUS_TCP"],
  },
];

export const MACHINE_REGISTER_ROLE_FIELDS = [
  {
    key: "startRegister",
    label: "Trigger Register",
    required: true,
    description: "Handshake trigger command register.",
  },
  {
    key: "statusRegister",
    label: "Interlock Register",
    required: true,
    description: "Interlock/feedback status register.",
  },
  {
    key: "stationRegister",
    label: "Complete Register",
    required: true,
    description: "Cycle completion register.",
  },
  {
    key: "resetRegister",
    label: "Reset Register",
    required: true,
    description: "Reset command register.",
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
];

export const MACHINE_TABLE_COLUMNS = [
  { key: "machineName", label: "Machine Name", sortable: true },
  { key: "lineName", label: "Line Name", sortable: true },
  { key: "sequenceNo", label: "Sequence No", sortable: true },
  { key: "operationNo", label: "Operation No", sortable: true },
  { key: "plcProtocol", label: "PLC Protocol", sortable: true },
  { key: "plcIp", label: "PLC IP", sortable: true },
  { key: "plcPort", label: "PLC Port", sortable: true },
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
