const PackingSession = require("../models/PackingSession");
const PackingItem = require("../models/PackingItem");
const { packPart, createSessionIfMissing, getPackingOverview, updateOpenSession, deleteSession } = require("../services/packingService");

exports.getOverview = async (_req, res) => {
  try {
    const overview = await getPackingOverview();
    res.json({
      activeSession: overview.activeSession
        ? {
            id: overview.activeSession.id,
            boxNumber: overview.activeSession.box_number,
            capacity: overview.activeSession.capacity,
            packedCount: overview.activeSession.packed_count,
            status: overview.activeSession.status,
          }
        : null,
      activeItems: overview.activeItems.map((item) => ({
        id: item.id,
        partId: item.part_id,
        slotNo: item.slot_no,
      })),
      recentSessions: overview.recentSessions.map((session) => ({
        id: session.id,
        boxNumber: session.box_number,
        capacity: session.capacity,
        packedCount: session.packed_count,
        status: session.status,
        createdAt: session.createdAt,
      })),
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
      capacity: session.capacity,
      packedCount: session.packed_count,
      status: session.status,
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
        capacity: packed.session.capacity,
        packedCount: packed.session.packed_count,
        status: packed.session.status,
      },
      item: {
        id: packed.item.id,
        partId: packed.item.part_id,
        slotNo: packed.item.slot_no,
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
      capacity: updated.capacity,
      packedCount: updated.packed_count,
      status: updated.status,
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
    res.json({
      id: session.id,
      boxNumber: session.box_number,
      capacity: session.capacity,
      packedCount: session.packed_count,
      status: session.status,
      items: items.map((item) => ({
        id: item.id,
        partId: item.part_id,
        slotNo: item.slot_no,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
