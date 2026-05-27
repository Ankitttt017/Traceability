const { Op } = require("sequelize");
const PackingSession = require("../models/PackingSession");
const PackingItem = require("../models/PackingItem");
const Part = require("../models/Part");
const OperationLog = require("../models/OperationLog");
const Machine = require("../models/Machine");
const {
  packPart,
  createAutoSessionIfMissing,
  createSessionIfMissing,
  getPackingOverview,
  updateOpenSession,
  deleteSession,
} = require("../services/packingService");
const {
  getPackingManagementSettings,
  updatePackingManagementSettings,
  listPackingBoxes,
  reserveNextAutoBox,
} = require("../services/packingManagementService");

exports.getOverview = async (_req, res) => {
  try {
    const overview = await getPackingOverview();
    res.json({
      activeSession: overview.activeSession
        ? {
            id: overview.activeSession.id,
            boxNumber: overview.activeSession.box_number,
            serialNo: overview.activeSession.serial_no || null,
            capacity: overview.activeSession.capacity,
            packedCount: overview.activeSession.packed_count,
            status: overview.activeSession.status,
            labelCode: overview.activeSession.label_code || null,
            closedAt: overview.activeSession.closed_at || null,
            generationSource: overview.activeSession.generation_source || "AUTO",
            createdAt: overview.activeSession.createdAt,
          }
        : null,
      activeItems: overview.activeItems.map((item) => ({
        id: item.id,
        partId: item.part_id,
        slotNo: item.slot_no,
        packedAt: item.createdAt,
      })),
      recentSessions: overview.recentSessions.map((session) => ({
        id: session.id,
        boxNumber: session.box_number,
        serialNo: session.serial_no || null,
        capacity: session.capacity,
        packedCount: session.packed_count,
        status: session.status,
        labelCode: session.label_code || null,
        closedAt: session.closed_at || null,
        generationSource: session.generation_source || "AUTO",
        createdAt: session.createdAt,
      })),
      finalPackingStations: overview.finalPackingStations || [],
      managementSettings: overview.managementSettings || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.startBox = async (req, res) => {
  try {
    const { boxNumber, capacity } = req.body;
    if (!boxNumber) {
      return res.status(400).json({ error: "boxNumber is required" });
    }
    const session = await createSessionIfMissing(boxNumber, capacity);
    res.status(201).json({
      id: session.id,
      boxNumber: session.box_number,
      serialNo: session.serial_no || null,
      capacity: session.capacity,
      packedCount: session.packed_count,
      status: session.status,
      labelCode: session.label_code || null,
      closedAt: session.closed_at || null,
      generationSource: session.generation_source || "MANUAL",
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.scanPartToBox = async (req, res) => {
  try {
    const { boxNumber, partId, capacity } = req.body;
    if (!partId) {
      return res.status(400).json({ error: "partId is required" });
    }
    const packed = await packPart({ boxNumber, partId, capacity });
    res.json({
      message: "Part packed successfully",
      box: {
        id: packed.session.id,
        boxNumber: packed.session.box_number,
        serialNo: packed.session.serial_no || null,
        capacity: packed.session.capacity,
        packedCount: packed.session.packed_count,
        status: packed.session.status,
        labelCode: packed.session.label_code || null,
        closedAt: packed.session.closed_at || null,
        generationSource: packed.session.generation_source || "AUTO",
      },
      item: {
        id: packed.item.id,
        partId: packed.item.part_id,
        slotNo: packed.item.slot_no,
        packedAt: packed.item.createdAt,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateBox = async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId || 0);
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const updated = await updateOpenSession({
      sessionId,
      boxNumber: req.body.boxNumber,
      capacity: req.body.capacity,
    });

    res.json({
      id: updated.id,
      boxNumber: updated.box_number,
      serialNo: updated.serial_no || null,
      capacity: updated.capacity,
      packedCount: updated.packed_count,
      status: updated.status,
      labelCode: updated.label_code || null,
      closedAt: updated.closed_at || null,
      generationSource: updated.generation_source || "AUTO",
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteBox = async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId || 0);
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const deleted = await deleteSession(sessionId);
    res.json({
      message: "Box deleted successfully",
      ...deleted,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getSessionByBox = async (req, res) => {
  try {
    const { boxNumber } = req.params;
    const session = await PackingSession.findOne({
      where: { box_number: String(boxNumber || "").trim().toUpperCase() },
      order: [["createdAt", "DESC"]],
    });
    if (!session) {
      return res.status(404).json({ error: "Box session not found" });
    }
    const items = await PackingItem.findAll({
      where: { session_id: session.id },
      order: [["slot_no", "ASC"]],
    });

    const partIds = items.map((item) => String(item.part_id || "").trim()).filter(Boolean);
    const [parts, operationLogs] = await Promise.all([
      partIds.length
        ? Part.findAll({
            where: { part_id: { [Op.in]: partIds } },
          })
        : [],
      partIds.length
        ? OperationLog.findAll({
            where: { part_id: { [Op.in]: partIds } },
            order: [["createdAt", "DESC"]],
          })
        : [],
    ]);

    const machineIds = [
      ...new Set(operationLogs.map((row) => Number(row.machine_id || 0)).filter((value) => value > 0)),
    ];
    const machines = machineIds.length
      ? await Machine.findAll({
          where: { id: { [Op.in]: machineIds } },
        })
      : [];

    const partById = parts.reduce((acc, row) => {
      acc[row.part_id] = row;
      return acc;
    }, {});
    const latestLogByPart = operationLogs.reduce((acc, row) => {
      const key = String(row.part_id || "").trim();
      if (!key || acc[key]) {
        return acc;
      }
      acc[key] = row;
      return acc;
    }, {});
    const machineById = machines.reduce((acc, row) => {
      acc[row.id] = row;
      return acc;
    }, {});

    res.json({
      id: session.id,
      boxNumber: session.box_number,
      serialNo: session.serial_no || null,
      capacity: session.capacity,
      packedCount: session.packed_count,
      status: session.status,
      labelCode: session.label_code || null,
      closedAt: session.closed_at || null,
      generationSource: session.generation_source || "AUTO",
      createdAt: session.createdAt,
      items: items.map((item) => ({
        id: item.id,
        partId: item.part_id,
        slotNo: item.slot_no,
        packedAt: item.createdAt,
        qrCode: item.part_id,
        partStatus: partById[item.part_id]?.status || null,
        currentStation: partById[item.part_id]?.current_station || null,
        operationNo: latestLogByPart[item.part_id]?.operation_no || latestLogByPart[item.part_id]?.station_no || null,
        operationResult: latestLogByPart[item.part_id]?.result || null,
        plcStatus: latestLogByPart[item.part_id]?.plc_status || null,
        machineName: machineById[latestLogByPart[item.part_id]?.machine_id]?.machine_name || null,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getManagementSettings = async (_req, res) => {
  try {
    const settings = await getPackingManagementSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.saveManagementSettings = async (req, res) => {
  try {
    const settings = await updatePackingManagementSettings(req.body || {}, req.user?.id || null);
    res.json({
      message: "Packing management settings saved",
      settings,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.generateNextBox = async (_req, res) => {
  try {
    const ref = await reserveNextAutoBox();
    const session = await createSessionIfMissing(ref.boxNumber, ref.defaultCapacity, {
      serialNo: ref.serialNo,
      generationSource: "AUTO",
    });
    res.status(201).json({
      message: "Next box generated",
      box: {
        id: session.id,
        boxNumber: session.box_number,
        serialNo: session.serial_no || null,
        capacity: session.capacity,
        packedCount: session.packed_count,
        status: session.status,
        generationSource: session.generation_source || "AUTO",
        createdAt: session.createdAt,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.listBoxes = async (req, res) => {
  try {
    const status = req.query.status;
    const limit = Number(req.query.limit || 200);
    const offset = Number(req.query.offset || 0);
    const data = await listPackingBoxes({ status, limit, offset });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
