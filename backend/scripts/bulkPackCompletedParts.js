/**
 * bulkPackCompletedParts.js
 * 
 * Bulk-packs all COMPLETED (passed) parts that are not yet in any packing box.
 * Creates as many 64-slot boxes as needed (BOX-0001, BOX-0002, ...).
 * 
 * Run: node scripts/bulkPackCompletedParts.js
 */

require("dotenv").config();
const { Sequelize, Op } = require("sequelize");
const sequelize = require("../config/db");

// Load models (must be done after sequelize is initialized)
const Part = require("../models/Part");
const PackingSession = require("../models/PackingSession");
const PackingItem = require("../models/PackingItem");
const PartCodeMapping = require("../models/PartCodeMapping");
const PackingManagementSetting = require("../models/PackingManagementSetting");

const BOX_CAPACITY = 64;
const COMPLETED_STATUSES = ["OK", "PASSED", "PASS", "COMPLETED", "COMPLETED_OK", "ENDED_OK"];

function formatBoxNumber(prefix, separator, padding, serial) {
  return `${prefix}${separator}${String(serial).padStart(padding, "0")}`;
}

async function getOrCreateSettings() {
  let row = await PackingManagementSetting.findOne({ where: { config_key: "DEFAULT" } });
  if (!row) {
    row = await PackingManagementSetting.create({
      config_key: "DEFAULT",
      box_prefix: "BOX",
      box_separator: "-",
      serial_padding: 4,
      next_serial: 1,
      default_capacity: 64,
      auto_create_next_box: true,
      label_prefix: "PKG",
    });
  }
  return row;
}

async function run() {
  try {
    await sequelize.authenticate();
    console.log("✅ DB connected");

    // Get settings for box number format
    const settings = await getOrCreateSettings();
    const boxPrefix = String(settings.box_prefix || "BOX").trim().toUpperCase();
    const boxSeparator = String(settings.box_separator || "-");
    const serialPadding = Math.max(1, Number(settings.serial_padding) || 4);
    let nextSerial = Math.max(1, Number(settings.next_serial) || 1);

    // Find all already-packed part_ids
    const packedItems = await PackingItem.findAll({ attributes: ["part_id"], raw: true });
    const packedPartIds = new Set(packedItems.map((i) => String(i.part_id || "").trim()).filter(Boolean));
    console.log(`📦 Already packed: ${packedPartIds.size} parts`);

    // Find all COMPLETED parts not yet packed, ordered oldest first
    const completedParts = await Part.findAll({
      where: {
        status: { [Op.in]: COMPLETED_STATUSES },
      },
      attributes: ["part_id", "status", "current_station"],
      order: [["updatedAt", "ASC"]],
      raw: true,
    });

    const unpackedParts = completedParts.filter((p) => !packedPartIds.has(String(p.part_id || "").trim()));
    console.log(`🔍 COMPLETED parts to pack: ${unpackedParts.length}`);

    if (unpackedParts.length === 0) {
      console.log("✅ All completed parts are already packed!");
      process.exit(0);
    }

    // Look up customer QR codes
    const partIds = unpackedParts.map((p) => p.part_id);
    const mappings = await PartCodeMapping.findAll({
      where: { old_part_id: { [Op.in]: partIds }, is_active: true },
      attributes: ["old_part_id", "customer_qr"],
      order: [["updatedAt", "DESC"]],
      raw: true,
    });
    const customerQrByPartId = {};
    for (const m of mappings) {
      if (!customerQrByPartId[m.old_part_id]) {
        customerQrByPartId[m.old_part_id] = m.customer_qr;
      }
    }

    // Find the current highest box serial already in DB to avoid conflicts
    const existingBoxes = await PackingSession.findAll({
      attributes: ["box_number"],
      raw: true,
    });
    const usedSerials = new Set();
    for (const box of existingBoxes) {
      const match = String(box.box_number || "").match(/(\d+)$/);
      if (match) usedSerials.add(Number(match[1]));
    }
    // Advance nextSerial past any used ones
    while (usedSerials.has(nextSerial)) nextSerial++;

    let currentSession = null;
    let currentSlot = 0;
    let boxesCreated = 0;
    let partsPacked = 0;
    const createdAt = new Date();

    // Function to create a new box session
    async function openNewBox() {
      const boxNumber = formatBoxNumber(boxPrefix, boxSeparator, serialPadding, nextSerial);
      while (usedSerials.has(nextSerial)) nextSerial++;
      const boxNum = formatBoxNumber(boxPrefix, boxSeparator, serialPadding, nextSerial);
      nextSerial++;

      const session = await PackingSession.create({
        box_number: boxNum,
        capacity: BOX_CAPACITY,
        packed_count: 0,
        status: "CLOSED", // Pre-mark as closed since we're bulk-filling
        serial_no: nextSerial - 1,
        generation_source: "AUTO",
        closed_at: createdAt,
        label_code: `PKG-${boxNum}-${String(nextSerial - 1).padStart(6, "0")}`,
        createdAt: createdAt,
        updatedAt: createdAt,
      });

      boxesCreated++;
      console.log(`\n📦 Created box: ${session.box_number} (ID: ${session.id})`);
      return session;
    }

    // Batch insert for performance
    const itemsToInsert = [];
    const sessionUpdates = [];

    for (const part of unpackedParts) {
      // Need a new box?
      if (!currentSession || currentSlot >= BOX_CAPACITY) {
        // Save packed_count for previous session
        if (currentSession) {
          sessionUpdates.push({ id: currentSession.id, packed_count: currentSlot });
        }
        currentSession = await openNewBox();
        currentSlot = 0;
      }

      currentSlot++;
      itemsToInsert.push({
        session_id: currentSession.id,
        part_id: String(part.part_id || "").trim(),
        slot_no: currentSlot,
        createdAt: createdAt,
        updatedAt: createdAt,
      });

      partsPacked++;

      if (partsPacked % 100 === 0) {
        process.stdout.write(`\r   ↳ Packing... ${partsPacked}/${unpackedParts.length}`);
      }
    }

    // Save final session
    if (currentSession && currentSlot > 0) {
      sessionUpdates.push({ id: currentSession.id, packed_count: currentSlot });
    }

    // Bulk insert all items
    console.log(`\n⚡ Bulk inserting ${itemsToInsert.length} packing items...`);
    await PackingItem.bulkCreate(itemsToInsert);

    // Update packed_count for all sessions
    for (const upd of sessionUpdates) {
      await PackingSession.update({ packed_count: upd.packed_count }, { where: { id: upd.id } });
    }

    // Update settings next_serial
    settings.next_serial = nextSerial;
    await settings.save();

    console.log(`\n✅ DONE!`);
    console.log(`   📦 Boxes created: ${boxesCreated}`);
    console.log(`   🔩 Parts packed:  ${partsPacked}`);
    console.log(`   📋 Box capacity:  ${BOX_CAPACITY} per box`);
    console.log(`   ⬛ Next box serial: ${nextSerial}`);

    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

run();
