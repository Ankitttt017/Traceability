const PackingSession = require("../models/PackingSession");
const PackingItem = require("../models/PackingItem");
const { packPart, createSessionIfMissing, getPackingOverview } = require("../services/packingService");

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
    const session = await createSessionIfMissing(boxNumber, capacity || 65);
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
    const { boxNumber, partId } = req.body;
    if (!partId) {
      return res.status(400).json({ error: "partId is required" });
    }
    const packed = await packPart({ boxNumber, partId });
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
