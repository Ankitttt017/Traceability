const PackingSession = require("../models/PackingSession");
const PackingItem = require("../models/PackingItem");
const Part = require("../models/Part");
const { Op } = require("sequelize");
const { emitRealtime } = require("./realtimeService");

const DEFAULT_PACKING_CAPACITY = Math.max(Number(process.env.DEFAULT_PACKING_CAPACITY || 65), 1);
const MIN_PACKING_CAPACITY = 1;
const MAX_PACKING_CAPACITY = 500;

function normalizeBoxNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeCapacity(value, fallback = DEFAULT_PACKING_CAPACITY) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(MAX_PACKING_CAPACITY, Math.max(MIN_PACKING_CAPACITY, Math.round(parsed)));
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

async function createSessionIfMissing(boxNumber, capacity = DEFAULT_PACKING_CAPACITY) {
  const normalized = normalizeBoxNumber(boxNumber);
  if (!normalized) {
    throw new Error("boxNumber is required");
  }

  const openSession = await getLatestOpenSession();
  if (openSession && openSession.box_number !== normalized) {
    throw new Error(`Box ${openSession.box_number} is already OPEN. Fill, close, or delete it before starting a new box.`);
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
    capacity: normalizeCapacity(capacity),
    packed_count: 0,
    status: "OPEN",
  });
}

async function packPart({ boxNumber, partId, capacity }) {
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
    session = await createSessionIfMissing(boxNumber, capacity);
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
  const resolvedCapacity = normalizeCapacity(session.capacity);
  if (nextSlot > resolvedCapacity) {
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
  if (nextSlot >= resolvedCapacity) {
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

async function updateOpenSession({ sessionId, boxNumber, capacity }) {
  const id = Number(sessionId || 0);
  if (!id) {
    throw new Error("sessionId is required");
  }

  const session = await PackingSession.findByPk(id);
  if (!session) {
    throw new Error("Packing session not found");
  }
  if (session.status !== "OPEN") {
    throw new Error("Only OPEN box can be updated");
  }

  let nextBoxNumber = session.box_number;
  if (boxNumber !== undefined && boxNumber !== null && String(boxNumber).trim() !== "") {
    nextBoxNumber = normalizeBoxNumber(boxNumber);
    const existing = await PackingSession.findOne({
      where: {
        box_number: nextBoxNumber,
        id: { [Op.ne]: session.id },
      },
    });
    if (existing) {
      throw new Error("Box number already exists");
    }
  }

  let nextCapacity = session.capacity;
  if (capacity !== undefined && capacity !== null && String(capacity).trim() !== "") {
    nextCapacity = normalizeCapacity(capacity, session.capacity);
  }

  if (Number(nextCapacity) < Number(session.packed_count || 0)) {
    throw new Error(`Capacity cannot be less than packed count (${session.packed_count || 0})`);
  }

  session.box_number = nextBoxNumber;
  session.capacity = nextCapacity;
  await session.save();

  emitRealtime("packing_update", {
    boxNumber: session.box_number,
    sessionId: session.id,
    packedCount: session.packed_count,
    capacity: session.capacity,
    status: session.status,
    event: "BOX_UPDATED",
  });

  emitRealtime("operator_popup", {
    type: "INFO",
    stationNo: "PACKING",
    message: `Packing box updated: ${session.box_number}, capacity ${session.capacity}`,
    timestamp: new Date().toISOString(),
  });

  return session;
}

async function deleteSession(sessionId) {
  const id = Number(sessionId || 0);
  if (!id) {
    throw new Error("sessionId is required");
  }

  const session = await PackingSession.findByPk(id);
  if (!session) {
    throw new Error("Packing session not found");
  }

  const itemCount = await PackingItem.count({ where: { session_id: session.id } });
  if (itemCount > 0) {
    throw new Error("Cannot delete box with packed parts. Only empty boxes can be deleted.");
  }

  await PackingItem.destroy({ where: { session_id: session.id } });
  await session.destroy();

  emitRealtime("packing_update", {
    event: "BOX_DELETED",
    sessionId: session.id,
    boxNumber: session.box_number,
    packedCount: 0,
    capacity: session.capacity,
    status: "DELETED",
  });

  emitRealtime("operator_popup", {
    type: "INFO",
    stationNo: "PACKING",
    message: `Packing box deleted: ${session.box_number}`,
    timestamp: new Date().toISOString(),
  });

  return {
    id: session.id,
    boxNumber: session.box_number,
  };
}

module.exports = {
  packPart,
  createSessionIfMissing,
  updateOpenSession,
  deleteSession,
  getPackingOverview,
  getLatestOpenSession,
  normalizeCapacity,
};
