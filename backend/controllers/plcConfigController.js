const { Op } = require("sequelize");
const Machine = require("../models/Machine");
const PlcRegisterRange = require("../models/PlcRegisterRange");

const RANGE_INPUT_REGEX = /^\s*(\d+)\s*[-:]\s*(\d+)\s*$/;

const REGISTER_ROLE_META = [
  { key: "startRegister", label: "START_CMD", machineColumn: "plc_start_register" },
  { key: "statusRegister", label: "STATUS", machineColumn: "plc_status_register" },
  { key: "partRegister", label: "PART_ID_HASH", machineColumn: "plc_part_register" },
  { key: "stationRegister", label: "STATION_HASH", machineColumn: "plc_station_register" },
  { key: "resetRegister", label: "RESET_CMD", machineColumn: "plc_reset_register" },
  { key: "heartbeatRegister", label: "HEARTBEAT", machineColumn: "plc_heartbeat_register" },
];

function toInt(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase() === "INACTIVE" ? "INACTIVE" : "ACTIVE";
}

function normalizeProtocol(value) {
  const protocol = String(value || "").trim().toUpperCase();
  if (protocol === "TCP_TEXT") {
    return "TCP_TEXT";
  }
  if (protocol === "SLMP") {
    return "SLMP";
  }
  return "MODBUS_TCP";
}

function parseDefaultRegisterMap(rawValue, rangeStart, rangeEnd) {
  if (!rawValue) {
    return {};
  }

  let source = rawValue;
  if (typeof rawValue === "string") {
    try {
      source = JSON.parse(rawValue);
    } catch (_error) {
      source = {};
    }
  }

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {};
  }

  // Backward-compatible aliases used by earlier frontend drafts.
  if (source.completeRegister !== undefined && source.stationRegister === undefined) {
    source.stationRegister = source.completeRegister;
  }
  if (source.interlockRegister !== undefined && source.statusRegister === undefined) {
    source.statusRegister = source.interlockRegister;
  }
  if (source.triggerRegister !== undefined && source.startRegister === undefined) {
    source.startRegister = source.triggerRegister;
  }

  const parsed = REGISTER_ROLE_META.reduce((acc, entry) => {
    const registerNo = toInt(source[entry.key]);
    if (registerNo === null) {
      return acc;
    }
    if (registerNo < rangeStart || registerNo > rangeEnd) {
      throw new Error(`${entry.key} (${registerNo}) must be inside configured range ${rangeStart}-${rangeEnd}`);
    }
    acc[entry.key] = registerNo;
    return acc;
  }, {});

  return parsed;
}

function serializeDefaultRegisterMap(registerMap = {}) {
  const hasValue = Object.values(registerMap).some((value) => Number.isFinite(Number(value)));
  if (!hasValue) {
    return null;
  }
  return JSON.stringify(registerMap);
}

function resolveRangePayload(body = {}, existingRow = null) {
  const rangeInput = normalizeText(body.rangeInput ?? body.range ?? "");
  let rangeStart = toInt(body.rangeStart ?? body.range_start ?? existingRow?.range_start);
  let rangeSize = toInt(body.rangeSize ?? body.range_size ?? existingRow?.range_size);

  if (rangeInput) {
    const match = rangeInput.match(RANGE_INPUT_REGEX);
    if (!match) {
      throw new Error("rangeInput format should be like 100-200");
    }
    const startVal = toInt(match[1]);
    const endVal = toInt(match[2]);
    if (endVal < startVal) {
      throw new Error("End register must be greater than or equal to start register");
    }
    rangeStart = startVal;
    rangeSize = endVal - startVal + 1;
  }

  if (rangeStart === null || rangeSize === null) {
    throw new Error("rangeStart and rangeEnd are required");
  }
  if (rangeStart < 0) {
    throw new Error("rangeStart must be >= 0");
  }
  if (rangeSize < 1 || rangeSize > 10000) {
    throw new Error("rangeSize must be between 1 and 10000");
  }

  const rangeEnd = rangeStart + rangeSize - 1;
  const generatedNameSeed =
    normalizeText(body.plcName ?? body.plc_name ?? existingRow?.plc_name) ||
    normalizeText(body.plcIp ?? body.plc_ip ?? existingRow?.plc_ip) ||
    "PLC";
  const rangeName =
    normalizeText(body.rangeName ?? body.range_name ?? existingRow?.range_name) ||
    `${generatedNameSeed}_${rangeStart}-${rangeEnd}`;

  const defaultRegisters = parseDefaultRegisterMap(
    body.defaultRegisters ?? body.default_register_map ?? existingRow?.default_register_map,
    rangeStart,
    rangeEnd
  );

  return {
    range_name: rangeName,
    plc_name: normalizeText(body.plcName ?? body.plc_name ?? existingRow?.plc_name) || null,
    plc_ip: normalizeText(body.plcIp ?? body.plc_ip ?? existingRow?.plc_ip) || null,
    plc_port: toInt(body.plcPort ?? body.port ?? body.plc_port ?? existingRow?.plc_port),
    plc_protocol: normalizeProtocol(body.plcProtocol ?? body.protocol ?? body.plc_protocol ?? existingRow?.plc_protocol),
    range_start: rangeStart,
    range_size: rangeSize,
    range_end: rangeEnd,
    status: normalizeStatus(body.status ?? existingRow?.status),
    default_register_map: serializeDefaultRegisterMap(defaultRegisters),
    notes: normalizeText(body.notes ?? existingRow?.notes) || null,
    updated_by: reqUserId(body),
  };
}

function reqUserId(body = {}) {
  return toInt(body.updatedBy ?? body.updated_by) ?? null;
}

function parseRowDefaultRegisters(row) {
  return parseDefaultRegisterMap(row.default_register_map, row.range_start, row.range_end);
}

function toRangeResponse(row, usage = {}) {
  const defaultRegisters = parseRowDefaultRegisters(row);
  return {
    id: row.id,
    rangeName: row.range_name,
    plcName: row.plc_name,
    plcIp: row.plc_ip,
    plcPort: row.plc_port,
    plcProtocol: row.plc_protocol,
    rangeStart: row.range_start,
    rangeSize: row.range_size,
    rangeEnd: row.range_end,
    rangeInput: `${row.range_start}-${row.range_end}`,
    status: row.status || "ACTIVE",
    defaultRegisters,
    notes: row.notes,
    updatedBy: row.updated_by,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    assignedMachineCount: usage.assignedMachineCount || 0,
    usedRegisterCount: usage.usedRegisterCount || 0,
  };
}

function getMachineRegisterUsageRows(machine) {
  return REGISTER_ROLE_META.reduce((acc, role) => {
    const registerNo = toInt(machine[role.machineColumn]);
    if (registerNo === null) {
      return acc;
    }
    acc.push({
      registerNo,
      roleKey: role.key,
      roleLabel: role.label,
      machineId: machine.id,
      machineName: machine.machine_name,
      operationNo: machine.operation_no,
    });
    return acc;
  }, []);
}

async function ensureNoOverlap({ rangeStart, rangeEnd, plcIp = null, plcPort = null, excludeId = null }) {
  const conflict = await PlcRegisterRange.findOne({
    where: {
      ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
      plc_ip: plcIp || null,
      plc_port: plcPort || null,
      range_start: { [Op.lte]: rangeEnd },
      range_end: { [Op.gte]: rangeStart },
    },
    order: [["range_start", "ASC"]],
  });

  if (conflict) {
    throw new Error(
      `Range overlap with ${conflict.range_name} (${conflict.range_start}-${conflict.range_end}). Use non-overlapping range.`
    );
  }
}

function csvCell(value) {
  const text = String(value ?? "");
  if (!text.includes(",") && !text.includes('"') && !text.includes("\n")) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

exports.listRanges = async (_req, res) => {
  try {
    const [ranges, machines] = await Promise.all([
      PlcRegisterRange.findAll({
        order: [["range_start", "ASC"]],
      }),
      Machine.findAll({
        attributes: [
          "id",
          "machine_name",
          "operation_no",
          "plc_range_id",
          ...REGISTER_ROLE_META.map((entry) => entry.machineColumn),
        ],
      }),
    ]);

    const usageByRange = new Map();
    for (const machine of machines) {
      const rangeId = toInt(machine.plc_range_id);
      if (!rangeId) {
        continue;
      }
      if (!usageByRange.has(rangeId)) {
        usageByRange.set(rangeId, { machineIds: new Set(), usedRegisters: new Set() });
      }
      const usage = usageByRange.get(rangeId);
      usage.machineIds.add(machine.id);
      for (const row of getMachineRegisterUsageRows(machine)) {
        usage.usedRegisters.add(row.registerNo);
      }
    }

    const payload = ranges.map((row) => {
      const usage = usageByRange.get(row.id);
      return toRangeResponse(row, {
        assignedMachineCount: usage ? usage.machineIds.size : 0,
        usedRegisterCount: usage ? usage.usedRegisters.size : 0,
      });
    });

    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createRange = async (req, res) => {
  try {
    const payload = resolveRangePayload({
      ...req.body,
      updatedBy: req.user?.id || null,
    });
    await ensureNoOverlap({
      rangeStart: payload.range_start,
      rangeEnd: payload.range_end,
      plcIp: payload.plc_ip,
      plcPort: payload.plc_port,
    });

    const row = await PlcRegisterRange.create(payload);
    res.status(201).json(toRangeResponse(row));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateRange = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Invalid range id" });
    }

    const row = await PlcRegisterRange.findByPk(id);
    if (!row) {
      return res.status(404).json({ error: "Range not found" });
    }

    const payload = resolveRangePayload(
      {
        ...req.body,
        updatedBy: req.user?.id || null,
      },
      row
    );

    await ensureNoOverlap({
      rangeStart: payload.range_start,
      rangeEnd: payload.range_end,
      plcIp: payload.plc_ip,
      plcPort: payload.plc_port,
      excludeId: id,
    });

    await row.update(payload);
    res.json(toRangeResponse(row));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteRange = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Invalid range id" });
    }

    const row = await PlcRegisterRange.findByPk(id);
    if (!row) {
      return res.status(404).json({ error: "Range not found" });
    }

    const mappedMachineCount = await Machine.count({
      where: { plc_range_id: id },
    });
    if (mappedMachineCount > 0) {
      return res.status(409).json({
        error: "Range is already assigned to machine(s). Re-map machines before delete.",
      });
    }

    await row.destroy();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getRangeRegisters = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Invalid range id" });
    }

    const excludeMachineId = toInt(req.query.excludeMachineId || req.query.exclude_machine_id);
    const [range, machines] = await Promise.all([
      PlcRegisterRange.findByPk(id),
      Machine.findAll({
        where: { plc_range_id: id },
        attributes: [
          "id",
          "machine_name",
          "operation_no",
          ...REGISTER_ROLE_META.map((entry) => entry.machineColumn),
        ],
      }),
    ]);

    if (!range) {
      return res.status(404).json({ error: "Range not found" });
    }

    const allRegisters = [];
    for (let registerNo = range.range_start; registerNo <= range.range_end; registerNo += 1) {
      allRegisters.push(registerNo);
    }

    const usedByOthers = new Set();
    const currentMachineRegisters = new Set();
    const usedRegisters = [];

    for (const machine of machines) {
      for (const usageRow of getMachineRegisterUsageRows(machine)) {
        const isCurrent = excludeMachineId !== null && machine.id === excludeMachineId;
        if (isCurrent) {
          currentMachineRegisters.add(usageRow.registerNo);
        } else {
          usedByOthers.add(usageRow.registerNo);
        }
        usedRegisters.push({
          ...usageRow,
          isCurrentMachine: isCurrent,
        });
      }
    }

    const availableRegisters = allRegisters.filter((registerNo) => !usedByOthers.has(registerNo));
    for (const registerNo of currentMachineRegisters) {
      if (!availableRegisters.includes(registerNo)) {
        availableRegisters.push(registerNo);
      }
    }
    availableRegisters.sort((a, b) => a - b);

    usedRegisters.sort((a, b) => {
      if (a.registerNo === b.registerNo) {
        return `${a.machineName}-${a.roleKey}`.localeCompare(`${b.machineName}-${b.roleKey}`);
      }
      return a.registerNo - b.registerNo;
    });

    res.json({
      range: toRangeResponse(range, {
        assignedMachineCount: new Set(machines.map((entry) => entry.id)).size,
        usedRegisterCount: new Set(usedRegisters.map((entry) => entry.registerNo)).size,
      }),
      allRegisters,
      availableRegisters,
      currentMachineRegisters: Array.from(currentMachineRegisters).sort((a, b) => a - b),
      usedRegisters,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportRegisterPlanCsv = async (_req, res) => {
  try {
    const [ranges, machines] = await Promise.all([
      PlcRegisterRange.findAll({
        order: [["range_start", "ASC"]],
      }),
      Machine.findAll({
        order: [["sequence_no", "ASC"]],
      }),
    ]);

    const rows = [];
    rows.push([
      "Range Name",
      "PLC Name",
      "PLC IP",
      "PLC Port",
      "Protocol",
      "Status",
      "Range Start",
      "Range Size",
      "Range End",
      ...REGISTER_ROLE_META.map((entry) => `Default ${entry.label}`),
      "Notes",
    ]);

    for (const range of ranges) {
      const defaults = parseRowDefaultRegisters(range);
      rows.push([
        range.range_name,
        range.plc_name || "",
        range.plc_ip || "",
        range.plc_port ?? "",
        range.plc_protocol || "MODBUS_TCP",
        range.status || "ACTIVE",
        range.range_start,
        range.range_size,
        range.range_end,
        ...REGISTER_ROLE_META.map((entry) => defaults[entry.key] ?? ""),
        range.notes || "",
      ]);
    }

    rows.push([]);
    rows.push([
      "Machine Name",
      "Line Name",
      "Station",
      "Range ID",
      "Range Name",
      ...REGISTER_ROLE_META.map((entry) => entry.label),
    ]);

    const rangeById = ranges.reduce((acc, row) => {
      acc[row.id] = row;
      return acc;
    }, {});

    for (const machine of machines) {
      const rangeId = toInt(machine.plc_range_id);
      const range = rangeId ? rangeById[rangeId] : null;
      rows.push([
        machine.machine_name || "",
        machine.line_name || "",
        machine.operation_no || "",
        rangeId || "",
        range?.range_name || "",
        ...REGISTER_ROLE_META.map((entry) => machine[entry.machineColumn] ?? ""),
      ]);
    }

    const csv = rows
      .map((row) => row.map((entry) => csvCell(entry)).join(","))
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=plc_register_plan.csv");
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
