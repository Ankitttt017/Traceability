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
    key: "plcIp",
    label: "PLC IP",
    type: "text",
    required: true,
  },
  {
    key: "plcPort",
    label: "PLC Port",
    type: "number",
    required: true,
  },
  {
    key: "plcProtocol",
    label: "PLC Protocol",
    type: "select",
    required: true,
    options: ["TCP_TEXT", "MODBUS_TCP"],
  },
  {
    key: "plcRegisters",
    label: "PLC Registers",
    type: "text",
    required: true,
    placeholder: "100,101,102,103,104",
  },
  {
    key: "status",
    label: "Status",
    type: "select",
    required: true,
    options: ["ACTIVE", "INACTIVE"],
  },
];

export const MACHINE_TABLE_COLUMNS = [
  { key: "machineName", label: "Machine Name", sortable: true },
  { key: "lineName", label: "Line Name", sortable: true },
  { key: "sequenceNo", label: "Sequence No", sortable: true },
  { key: "operationNo", label: "Operation No", sortable: true },
  { key: "plcIp", label: "PLC IP", sortable: true },
  { key: "plcPort", label: "PLC Port", sortable: true },
  { key: "plcProtocol", label: "PLC Protocol", sortable: true },
  { key: "plcRegisters", label: "PLC Registers", sortable: false },
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
