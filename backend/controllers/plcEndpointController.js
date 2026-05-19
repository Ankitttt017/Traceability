const { Op } = require("sequelize");
const PlcEndpoint = require("../models/PlcEndpoint");
const PlcRegisterRange = require("../models/PlcRegisterRange");
const Machine = require("../models/Machine");

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

function toEndpointResponse(row, usage = {}) {
  return {
    id: row.id,
    endpointName: row.endpoint_name,
    plcIp: row.plc_ip,
    plcPort: row.plc_port,
    plcProtocol: row.plc_protocol,
    plcName: row.plc_name,
    description: row.description,
    status: row.status || "ACTIVE",
    notes: row.notes,
    updatedBy: row.updated_by,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    usedByRanges: usage.rangeCount || 0,
    usedByMachines: usage.machineCount || 0,
  };
}

// List all PLC endpoints
exports.listEndpoints = async (_req, res) => {
  try {
    const endpoints = await PlcEndpoint.findAll({
      order: [["endpoint_name", "ASC"]],
    });

    // Count usage by ranges and machines
    const [ranges, machines] = await Promise.all([
      PlcRegisterRange.findAll({
        attributes: ["plc_endpoint_id"],
      }),
      Machine.findAll({
        attributes: ["plc_endpoint_id"],
      }),
    ]);

    const usageMap = new Map();
    endpoints.forEach((ep) => {
      usageMap.set(ep.id, { rangeCount: 0, machineCount: 0 });
    });

    ranges.forEach((r) => {
      if (r.plc_endpoint_id && usageMap.has(r.plc_endpoint_id)) {
        usageMap.get(r.plc_endpoint_id).rangeCount += 1;
      }
    });

    machines.forEach((m) => {
      if (m.plc_endpoint_id && usageMap.has(m.plc_endpoint_id)) {
        usageMap.get(m.plc_endpoint_id).machineCount += 1;
      }
    });

    res.json(
      endpoints.map((ep) => toEndpointResponse(ep, usageMap.get(ep.id) || {}))
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get single endpoint with usage details
exports.getEndpoint = async (req, res) => {
  try {
    const { id } = req.params;
    const endpoint = await PlcEndpoint.findByPk(id);

    if (!endpoint) {
      return res.status(404).json({ error: "Endpoint not found" });
    }

    const [ranges, machines] = await Promise.all([
      PlcRegisterRange.findAll({
        where: { plc_endpoint_id: id },
        attributes: ["id", "range_name", "range_start", "range_end", "status"],
      }),
      Machine.findAll({
        where: { plc_endpoint_id: id },
        attributes: ["id", "machine_name", "operation_no"],
      }),
    ]);

    res.json({
      ...toEndpointResponse(endpoint, {
        rangeCount: ranges.length,
        machineCount: machines.length,
      }),
      ranges,
      machines,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Create new endpoint
exports.createEndpoint = async (req, res) => {
  try {
    const { endpointName, plcIp, plcPort, plcProtocol, plcName, description, notes } = req.body;

    // Validation
    if (!normalizeText(endpointName)) {
      return res.status(400).json({ error: "Endpoint name is required" });
    }
    if (!normalizeText(plcIp)) {
      return res.status(400).json({ error: "PLC IP is required" });
    }
    const port = toInt(plcPort);
    if (port === null || port < 1 || port > 65535) {
      return res.status(400).json({ error: "Port must be between 1 and 65535" });
    }

    // Check for duplicate endpoint name
    const existing = await PlcEndpoint.findOne({
      where: { endpoint_name: normalizeText(endpointName) },
    });
    if (existing) {
      return res.status(400).json({ error: "Endpoint name already exists" });
    }

    const endpoint = await PlcEndpoint.create({
      endpoint_name: normalizeText(endpointName),
      plc_ip: normalizeText(plcIp),
      plc_port: port,
      plc_protocol: normalizeProtocol(plcProtocol),
      plc_name: normalizeText(plcName) || null,
      description: normalizeText(description) || null,
      notes: normalizeText(notes) || null,
      updated_by: req.user?.id || null,
    });

    res.status(201).json(toEndpointResponse(endpoint));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update endpoint (affects all machines/ranges using it)
exports.updateEndpoint = async (req, res) => {
  try {
    const { id } = req.params;
    const { endpointName, plcIp, plcPort, plcProtocol, plcName, description, status, notes } = req.body;

    const endpoint = await PlcEndpoint.findByPk(id);
    if (!endpoint) {
      return res.status(404).json({ error: "Endpoint not found" });
    }

    // Validate new values if provided
    if (plcIp && !normalizeText(plcIp)) {
      return res.status(400).json({ error: "PLC IP cannot be empty" });
    }
    if (plcPort !== undefined) {
      const port = toInt(plcPort);
      if (port === null || port < 1 || port > 65535) {
        return res.status(400).json({ error: "Port must be between 1 and 65535" });
      }
    }

    // Check for duplicate endpoint name (if changing)
    if (endpointName && normalizeText(endpointName) !== endpoint.endpoint_name) {
      const existing = await PlcEndpoint.findOne({
        where: {
          endpoint_name: normalizeText(endpointName),
          id: { [Op.ne]: id },
        },
      });
      if (existing) {
        return res.status(400).json({ error: "Endpoint name already exists" });
      }
    }

    // Update fields
    if (endpointName) endpoint.endpoint_name = normalizeText(endpointName);
    if (plcIp) endpoint.plc_ip = normalizeText(plcIp);
    if (plcPort !== undefined) endpoint.plc_port = toInt(plcPort);
    if (plcProtocol) endpoint.plc_protocol = normalizeProtocol(plcProtocol);
    if (plcName !== undefined) endpoint.plc_name = normalizeText(plcName) || null;
    if (description !== undefined) endpoint.description = normalizeText(description) || null;
    if (status) endpoint.status = normalizeStatus(status);
    if (notes !== undefined) endpoint.notes = normalizeText(notes) || null;
    endpoint.updated_by = req.user?.id || null;

    await endpoint.save();

    res.json(toEndpointResponse(endpoint));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete endpoint (only if not used)
exports.deleteEndpoint = async (req, res) => {
  try {
    const { id } = req.params;

    const endpoint = await PlcEndpoint.findByPk(id);
    if (!endpoint) {
      return res.status(404).json({ error: "Endpoint not found" });
    }

    // Check if used
    const [rangeCount, machineCount] = await Promise.all([
      PlcRegisterRange.count({ where: { plc_endpoint_id: id } }),
      Machine.count({ where: { plc_endpoint_id: id } }),
    ]);

    if (rangeCount > 0 || machineCount > 0) {
      return res.status(400).json({
        error: `Cannot delete. Used by ${rangeCount} ranges and ${machineCount} machines.`,
        usedByRanges: rangeCount,
        usedByMachines: machineCount,
      });
    }

    await endpoint.destroy();
    res.json({ message: "Endpoint deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Test endpoint connection
exports.testEndpoint = async (req, res) => {
  try {
    const { id } = req.params;
    const endpoint = await PlcEndpoint.findByPk(id);

    if (!endpoint) {
      return res.status(404).json({ error: "Endpoint not found" });
    }

    // Basic connectivity test
    const net = require("net");
    const socket = new net.Socket();
    let connected = false;

    socket.setTimeout(3000);

    socket.on("connect", () => {
      connected = true;
      socket.destroy();
    });

    socket.on("error", (err) => {
      socket.destroy();
    });

    socket.on("timeout", () => {
      socket.destroy();
    });

    // Attempt connection
    socket.connect(endpoint.plc_port, endpoint.plc_ip);

    // Wait for connection result
    await new Promise((resolve) => {
      setTimeout(() => {
        socket.destroy();
        resolve();
      }, 3500);
    });

    res.json({
      endpointId: id,
      endpointName: endpoint.endpoint_name,
      plcIp: endpoint.plc_ip,
      plcPort: endpoint.plc_port,
      connected,
      message: connected ? "Connection successful" : "Connection failed or timed out",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
