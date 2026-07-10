const PackingSession = require("../models/PackingSession");
const PackingItem = require("../models/PackingItem");
const Part = require("../models/Part");
const PartCodeMapping = require("../models/PartCodeMapping");
const { Op } = require("sequelize");
const { emitRealtime } = require("./realtimeService");
const { getFinalPackingStations } = require("./stationFeatureService");
const { getPackingManagementSettings, reserveNextAutoBox } = require("./packingManagementService");

const DEFAULT_PACKING_CAPACITY = Math.max(Number(process.env.DEFAULT_PACKING_CAPACITY || 65), 1);
const MIN_PACKING_CAPACITY = 1;
const MAX_PACKING_CAPACITY = 500;
const BOX_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;

function normalizeBoxNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function assertValidBoxNumber(value) {
  const normalized = normalizeBoxNumber(value);
  if (!normalized) {
    throw new Error("boxNumber is required");
  }
  if (!BOX_NUMBER_PATTERN.test(normalized)) {
    throw new Error("Invalid box number. Use 2-40 chars: A-Z, 0-9, hyphen, underscore.");
  }
  return normalized;
}

function createLabelCode(session, labelPrefix = "PKG") {
  const safeBox = String(session.box_number || "BOX")
    .toUpperCase()
    .replace(/[^0-9A-Z\-\.\$\/\+\% ]/g, "-");
  const safePrefix = String(labelPrefix || "PKG")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "") || "PKG";
  return `${safePrefix}-${safeBox}-${String(session.id).padStart(6, "0")}`;
}

async function closeSessionWithLabel(session, labelPrefix) {
  if (!session) {
    return null;
  }
  session.status = "CLOSED";
  session.closed_at = session.closed_at || new Date();
  session.label_code = session.label_code || createLabelCode(session, labelPrefix);
  await session.save();
  return session;
}

function normalizeCapacity(value, fallback = DEFAULT_PACKING_CAPACITY) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(MAX_PACKING_CAPACITY, Math.max(MIN_PACKING_CAPACITY, Math.round(parsed)));
}

async function resolvePackingPartId(scannedCode) {
  const raw = String(scannedCode || "").trim();
  if (!raw) {
    return { partId: "", customerQrCode: null };
  }
  const mapping = await PartCodeMapping.findOne({
    where: {
      customer_qr: raw,
      is_active: true,
    },
    order: [["updatedAt", "DESC"]],
  });
  if (!mapping?.old_part_id) {
    return { partId: raw, customerQrCode: null };
  }
  return {
    partId: String(mapping.old_part_id || "").trim(),
    customerQrCode: raw,
  };
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

async function createSessionIfMissing(
  boxNumber,
  capacity = DEFAULT_PACKING_CAPACITY,
  { serialNo = null, generationSource = "MANUAL" } = {}
) {
  const normalized = assertValidBoxNumber(boxNumber);

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

  const created = await PackingSession.create({
    box_number: normalized,
    capacity: normalizeCapacity(capacity),
    packed_count: 0,
    status: "OPEN",
    serial_no: Number.isFinite(Number(serialNo)) ? Number(serialNo) : null,
    generation_source: String(generationSource || "MANUAL").toUpperCase() === "AUTO" ? "AUTO" : "MANUAL",
  });

  emitRealtime("packing_update", {
    event: "BOX_READY",
    boxNumber: created.box_number,
    sessionId: created.id,
    packedCount: created.packed_count,
    capacity: created.capacity,
    status: created.status,
    labelCode: created.label_code || null,
    closedAt: created.closed_at || null,
  });

  return created;
}

async function createAutoSessionIfMissing(capacity) {
  const existing = await getLatestOpenSession();
  if (existing) {
    return existing;
  }

  const autoRef = await reserveNextAutoBox();
  return createSessionIfMissing(autoRef.boxNumber, capacity || autoRef.defaultCapacity, {
    serialNo: autoRef.serialNo,
    generationSource: "AUTO",
  });
}

async function packPart({ boxNumber, partId, capacity }) {
  const resolvedScan = await resolvePackingPartId(partId);
  const normalizedPartId = String(resolvedScan.partId || "").trim();
  if (!normalizedPartId) {
    throw new Error("partId is required for packing");
  }

  const part = await Part.findOne({ where: { part_id: normalizedPartId } });
  if (!part) {
    throw new Error("Part not found");
  }
  const partStatusUpper = String(part.status || "").trim().toUpperCase();
  const isCompletedPart = ["OK", "PASSED", "PASS", "COMPLETED", "COMPLETED_OK", "ENDED_OK"].includes(partStatusUpper);
  if (!isCompletedPart) {
    throw new Error("Only COMPLETED/PASSED parts can be packed");
  }

  const finalPackingStations = await getFinalPackingStations();
  if (finalPackingStations.length > 0) {
    const currentStation = String(part.current_station || "")
      .trim()
      .toUpperCase();
    if (!finalPackingStations.includes(currentStation)) {
      throw new Error(
        `Part not from configured final packing station. Required: ${finalPackingStations.join(", ")} | Current: ${currentStation || "-"}`
      );
    }
  }

  const packedAlready = await PackingItem.findOne({ where: { part_id: normalizedPartId } });
  if (packedAlready) {
    throw new Error("Part already packed");
  }

  let session = null;
  if (boxNumber) {
    session = await createSessionIfMissing(boxNumber, capacity, { generationSource: "MANUAL" });
  } else {
    session = await getLatestOpenSession();
    if (!session) {
      const management = await getPackingManagementSettings();
      if (!management.autoCreateNextBox) {
        throw new Error("No open box available. Generate next box from Packing Management.");
      }
      session = await createAutoSessionIfMissing(capacity || management.defaultCapacity);
    }
  }

  if (session.status !== "OPEN") {
    throw new Error("Selected box is closed");
  }

  const nextSlot = Number(session.packed_count || 0) + 1;
  const resolvedCapacity = normalizeCapacity(session.capacity);
  if (nextSlot > resolvedCapacity) {
    const management = await getPackingManagementSettings();
    await closeSessionWithLabel(session, management.labelPrefix);
    throw new Error("Box capacity reached");
  }

  const item = await PackingItem.create({
    session_id: session.id,
    part_id: normalizedPartId,
    slot_no: nextSlot,
  });

  session.packed_count = nextSlot;
  if (nextSlot >= resolvedCapacity) {
    const management = await getPackingManagementSettings();
    await closeSessionWithLabel(session, management.labelPrefix);
  } else {
    await session.save();
  }

  const isClosed = session.status === "CLOSED";
  emitRealtime("packing_update", {
    event: isClosed ? "BOX_CLOSED" : "PART_PACKED",
    boxNumber: session.box_number,
    sessionId: session.id,
    partId: normalizedPartId,
    slotNo: nextSlot,
    packedCount: session.packed_count,
    capacity: session.capacity,
    status: session.status,
    labelCode: session.label_code || null,
    closedAt: session.closed_at || null,
  });

  if (isClosed) {
    const management = await getPackingManagementSettings();
    let nextSession = null;
    if (management.autoCreateNextBox) {
      nextSession = await createAutoSessionIfMissing(management.defaultCapacity);
    }

    emitRealtime("packing_update", {
      event: "NEXT_BOX_READY",
      boxNumber: nextSession?.box_number || null,
      sessionId: nextSession?.id || null,
      packedCount: nextSession?.packed_count || 0,
      capacity: nextSession?.capacity || management.defaultCapacity,
      status: nextSession?.status || (management.autoCreateNextBox ? "OPEN" : "WAIT"),
      labelCode: nextSession?.label_code || null,
      closedAt: null,
    });

    emitRealtime("operator_popup", {
      type: "SUCCESS",
      stationNo: "PACKING",
      message: nextSession
        ? `Box ${session.box_number} full (${session.packed_count}/${session.capacity}). Now use next box ${nextSession.box_number}.`
        : `Box ${session.box_number} full (${session.packed_count}/${session.capacity}). Generate next box from Packing Management.`,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    session,
    item,
    resolvedPartId: normalizedPartId,
    customerQrCode: resolvedScan.customerQrCode,
  };
}

async function getPackingOverview() {
  let [activeSession, managementSettings] = await Promise.all([getLatestOpenSession(), getPackingManagementSettings()]);

  if (!activeSession && managementSettings.autoCreateNextBox) {
    activeSession = await createAutoSessionIfMissing(managementSettings.defaultCapacity);
  }

  const [recentSessions, finalPackingStations] = await Promise.all([
    PackingSession.findAll({
      order: [["createdAt", "DESC"]],
      limit: 40,
    }),
    getFinalPackingStations(),
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
    finalPackingStations,
    managementSettings,
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
    nextBoxNumber = assertValidBoxNumber(boxNumber);
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
    labelCode: session.label_code || null,
    closedAt: session.closed_at || null,
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
  createAutoSessionIfMissing,
  createSessionIfMissing,
  updateOpenSession,
  deleteSession,
  getPackingOverview,
  getLatestOpenSession,
  normalizeCapacity,
  normalizeBoxNumber,
  assertValidBoxNumber,
  resolvePackingPartId,
};
