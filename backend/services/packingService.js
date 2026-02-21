const PackingSession = require("../models/PackingSession");
const PackingItem = require("../models/PackingItem");
const Part = require("../models/Part");
const { emitRealtime } = require("./realtimeService");

function normalizeBoxNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

async function getOpenSessionByBox(boxNumber) {
  const normalized = normalizeBoxNumber(boxNumber);
  if (!normalized) {
    return null;
  }
  return PackingSession.findOne({
    where: { box_number: normalized, status: "OPEN" },
  });
}

async function getLatestOpenSession() {
  return PackingSession.findOne({
    where: { status: "OPEN" },
    order: [["createdAt", "DESC"]],
  });
}

async function createSessionIfMissing(boxNumber, capacity = 65) {
  const normalized = normalizeBoxNumber(boxNumber);
  if (!normalized) {
    throw new Error("boxNumber is required");
  }

  const existing = await getOpenSessionByBox(normalized);
  if (existing) {
    return existing;
  }

  const closedExisting = await PackingSession.findOne({
    where: { box_number: normalized, status: "CLOSED" },
  });
  if (closedExisting) {
    throw new Error("Box already closed. Use a new box number.");
  }

  return PackingSession.create({
    box_number: normalized,
    capacity: Number(capacity) || 65,
    packed_count: 0,
    status: "OPEN",
  });
}

async function packPart({ boxNumber, partId }) {
  const normalizedPartId = String(partId || "").trim();
  if (!normalizedPartId) {
    throw new Error("partId is required for packing");
  }

  const part = await Part.findOne({ where: { part_id: normalizedPartId } });
  if (!part) {
    throw new Error("Part not found");
  }
  if (part.status !== "COMPLETED") {
    throw new Error("Only COMPLETED parts can be packed");
  }

  const packedAlready = await PackingItem.findOne({ where: { part_id: normalizedPartId } });
  if (packedAlready) {
    throw new Error("Part already packed");
  }

  let session = null;
  if (boxNumber) {
    session = await createSessionIfMissing(boxNumber);
  } else {
    session = await getLatestOpenSession();
    if (!session) {
      throw new Error("No open box found. Scan box number first.");
    }
  }

  if (session.status !== "OPEN") {
    throw new Error("Selected box is closed");
  }

  const nextSlot = Number(session.packed_count || 0) + 1;
  if (nextSlot > Number(session.capacity || 65)) {
    session.status = "CLOSED";
    await session.save();
    throw new Error("Box capacity reached");
  }

  const item = await PackingItem.create({
    session_id: session.id,
    part_id: normalizedPartId,
    slot_no: nextSlot,
  });

  session.packed_count = nextSlot;
  if (nextSlot >= Number(session.capacity || 65)) {
    session.status = "CLOSED";
  }
  await session.save();

  emitRealtime("packing_update", {
    boxNumber: session.box_number,
    sessionId: session.id,
    partId: normalizedPartId,
    slotNo: nextSlot,
    packedCount: session.packed_count,
    capacity: session.capacity,
    status: session.status,
  });

  return {
    session,
    item,
  };
}

async function getPackingOverview() {
  const [activeSession, recentSessions] = await Promise.all([
    getLatestOpenSession(),
    PackingSession.findAll({
      order: [["createdAt", "DESC"]],
      limit: 10,
    }),
  ]);

  let activeItems = [];
  if (activeSession) {
    activeItems = await PackingItem.findAll({
      where: { session_id: activeSession.id },
      order: [["slot_no", "ASC"]],
    });
  }

  return {
    activeSession,
    activeItems,
    recentSessions,
  };
}

module.exports = {
  packPart,
  createSessionIfMissing,
  getPackingOverview,
  getLatestOpenSession,
};
