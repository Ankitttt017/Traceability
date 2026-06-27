const { Op } = require("sequelize");
const RejectionCategory = require("../models/RejectionCategory");
const RejectionReason = require("../models/RejectionReason");
const RejectionView = require("../models/RejectionView");
const RejectionZone = require("../models/RejectionZone");
const RejectionSubZone = require("../models/RejectionSubZone");
const RejectionZoneReason = require("../models/RejectionZoneReason");
const {
  DEFAULT_REJECTION_CATEGORIES,
  DEFAULT_REJECTION_VIEWS,
  DEFAULT_REJECTION_ZONES,
  DEFAULT_PART_NAME,
} = require("../constants/defaultRejectionMaster");

function normalizePartName(value) {
  return String(value || DEFAULT_PART_NAME).trim().toUpperCase() || DEFAULT_PART_NAME;
}

async function ensureDefaultsForPart(partName = DEFAULT_PART_NAME) {
  const normalizedPart = normalizePartName(partName);
  const existing = await RejectionCategory.count({ where: { part_name: normalizedPart } });
  if (existing > 0) return;

  for (let categoryIndex = 0; categoryIndex < DEFAULT_REJECTION_CATEGORIES.length; categoryIndex += 1) {
    const categorySeed = DEFAULT_REJECTION_CATEGORIES[categoryIndex];
    const category = await RejectionCategory.create({
      part_name: normalizedPart,
      code: categorySeed.code,
      name: categorySeed.name,
      sort_order: categoryIndex + 1,
      is_active: true,
    });

    for (let reasonIndex = 0; reasonIndex < categorySeed.reasons.length; reasonIndex += 1) {
      await RejectionReason.create({
        category_id: category.id,
        name: categorySeed.reasons[reasonIndex],
        sort_order: reasonIndex + 1,
        is_active: true,
      });
    }
  }

  for (let viewIndex = 0; viewIndex < DEFAULT_REJECTION_VIEWS.length; viewIndex += 1) {
    const viewSeed = DEFAULT_REJECTION_VIEWS[viewIndex];
    const view = await RejectionView.create({
      part_name: normalizedPart,
      code: viewSeed.code,
      name: viewSeed.name,
      image_url: viewSeed.image_url || null,
      sort_order: viewIndex + 1,
      is_active: true,
    });

    for (let zoneIndex = 0; zoneIndex < DEFAULT_REJECTION_ZONES.length; zoneIndex += 1) {
      const zoneSeed = DEFAULT_REJECTION_ZONES[zoneIndex];
      await RejectionZone.create({
        view_id: view.id,
        code: zoneSeed.code,
        name: zoneSeed.name,
        x_percent: zoneSeed.x_percent,
        y_percent: zoneSeed.y_percent,
        width_percent: zoneSeed.width_percent,
        height_percent: zoneSeed.height_percent,
        sort_order: zoneIndex + 1,
        is_active: true,
      });
    }
  }

  await applyAllCategoryReasonsToAllZones(normalizedPart);
}

async function applyAllCategoryReasonsToAllZones(partName = "DEFAULT") {
  const normalizedPart = normalizePartName(partName);
  const [categories, views] = await Promise.all([
    RejectionCategory.findAll({ where: { part_name: normalizedPart, is_active: true }, raw: true }),
    RejectionView.findAll({ where: { part_name: normalizedPart, is_active: true }, raw: true }),
  ]);
  const viewIds = views.map((view) => view.id);
  const zones = viewIds.length
    ? await RejectionZone.findAll({ where: { view_id: { [Op.in]: viewIds }, is_active: true }, raw: true })
    : [];

  for (const category of categories) {
    const reasons = await RejectionReason.findAll({
      where: { category_id: category.id, is_active: true },
      raw: true,
    });
    for (const view of views) {
      const viewZones = zones.filter((zone) => Number(zone.view_id) === Number(view.id));
      for (const zone of viewZones) {
        for (const reason of reasons) {
          const existing = await RejectionZoneReason.findOne({
            where: {
              part_name: normalizedPart,
              category_id: category.id,
              view_id: view.id,
              zone_id: zone.id,
              reason_id: reason.id,
            },
          });
          if (!existing) {
            await RejectionZoneReason.create({
              part_name: normalizedPart,
              category_id: category.id,
              view_id: view.id,
              zone_id: zone.id,
              reason_id: reason.id,
              is_active: true,
            });
          } else if (existing.is_active !== true) {
            existing.is_active = true;
            await existing.save();
          }
        }
      }
    }
  }
}

async function getOperatorConfig(partName = "DEFAULT") {
  const normalizedPart = normalizePartName(partName);

  const [categories, views] = await Promise.all([
    RejectionCategory.findAll({
      where: { part_name: normalizedPart, is_active: true },
      order: [["sort_order", "ASC"], ["id", "ASC"]],
      raw: true,
    }),
    RejectionView.findAll({
      where: { part_name: normalizedPart, is_active: true },
      order: [["sort_order", "ASC"], ["id", "ASC"]],
      raw: true,
    }),
  ]);

  const categoryIds = categories.map((row) => row.id);
  const viewIds = views.map((row) => row.id);
  const [reasons, zones, mappings] = await Promise.all([
    categoryIds.length
      ? RejectionReason.findAll({
        where: { category_id: { [Op.in]: categoryIds }, is_active: true },
        order: [["sort_order", "ASC"], ["id", "ASC"]],
        raw: true,
      })
      : [],
    viewIds.length
      ? RejectionZone.findAll({
        where: { view_id: { [Op.in]: viewIds }, is_active: true },
        order: [["sort_order", "ASC"], ["id", "ASC"]],
        raw: true,
      })
      : [],
    RejectionZoneReason.findAll({
      where: { part_name: normalizedPart, is_active: true },
      raw: true,
    }),
  ]);
  const zoneIds = zones.map((row) => row.id);
  const subZones = zoneIds.length
    ? await RejectionSubZone.findAll({
      where: { zone_id: { [Op.in]: zoneIds }, is_active: true },
      order: [["sort_order", "ASC"], ["id", "ASC"]],
      raw: true,
    })
    : [];

  return {
    partName: normalizedPart,
    categories: categories.map((category) => ({
      id: category.id,
      key: category.code,
      code: category.code,
      label: `${category.code} - ${category.name}`,
      name: category.name,
      reasons: reasons
        .filter((reason) => Number(reason.category_id) === Number(category.id))
        .map((reason) => ({ id: reason.id, name: reason.name })),
    })),
    views: views.map((view) => ({
      id: view.id,
      code: view.code,
      name: view.name,
      imageUrl: view.image_url || "",
      zones: zones
        .filter((zone) => Number(zone.view_id) === Number(view.id))
        .map((zone) => ({
          id: zone.id,
          code: zone.code,
          name: zone.name,
          xPercent: Number(zone.x_percent || 0),
          yPercent: Number(zone.y_percent || 0),
          widthPercent: Number(zone.width_percent || 10),
          heightPercent: Number(zone.height_percent || 10),
          subZones: subZones
            .filter((subZone) => Number(subZone.zone_id) === Number(zone.id))
            .map((subZone) => ({
              id: subZone.id,
              code: subZone.code,
              name: subZone.name,
              xPercent: Number(subZone.x_percent || 0),
              yPercent: Number(subZone.y_percent || 0),
              widthPercent: Number(subZone.width_percent || 10),
              heightPercent: Number(subZone.height_percent || 10),
            })),
        })),
    })),
    mappings: mappings.map((row) => ({
      categoryId: row.category_id,
      viewId: row.view_id,
      zoneId: row.zone_id,
      subZoneId: row.sub_zone_id || null,
      reasonId: row.reason_id,
    })),
  };
}

async function applyReasonsToAllZones({ partName = "DEFAULT", categoryId, reasonIds = [] }) {
  const normalizedPart = normalizePartName(partName);
  const category = await RejectionCategory.findOne({
    where: { id: categoryId, part_name: normalizedPart },
  });
  if (!category) {
    throw new Error("Category not found for selected part.");
  }
  const cleanReasonIds = [...new Set((reasonIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!cleanReasonIds.length) {
    throw new Error("At least one reason is required.");
  }
  const views = await RejectionView.findAll({ where: { part_name: normalizedPart, is_active: true }, raw: true });
  const zones = views.length
    ? await RejectionZone.findAll({ where: { view_id: { [Op.in]: views.map((view) => view.id) }, is_active: true }, raw: true })
    : [];
  await RejectionZoneReason.destroy({
    where: {
      part_name: normalizedPart,
      category_id: category.id,
    },
  });
  for (const view of views) {
    for (const zone of zones.filter((row) => Number(row.view_id) === Number(view.id))) {
      for (const reasonId of cleanReasonIds) {
        await RejectionZoneReason.create({
          part_name: normalizedPart,
          category_id: category.id,
          view_id: view.id,
          zone_id: zone.id,
          reason_id: reasonId,
          is_active: true,
        });
      }
    }
  }
}

async function listConfiguredParts() {
  const [categories, views] = await Promise.all([
    RejectionCategory.findAll({ attributes: ["part_name"], raw: true }),
    RejectionView.findAll({ attributes: ["part_name"], raw: true }),
  ]);
  return [...new Set([...categories, ...views]
    .map((row) => normalizePartName(row.part_name))
    .filter((partName) => partName && partName !== "DEFAULT"))]
    .sort();
}

async function renamePart({ oldPartName, newPartName }) {
  const oldName = normalizePartName(oldPartName);
  const nextName = normalizePartName(newPartName);
  if (!oldName || !nextName) throw new Error("Old part name and new part name are required.");
  if (oldName === nextName) return nextName;
  await RejectionCategory.update({ part_name: nextName }, { where: { part_name: oldName } });
  await RejectionView.update({ part_name: nextName }, { where: { part_name: oldName } });
  await RejectionZoneReason.update({ part_name: nextName }, { where: { part_name: oldName } });
  return nextName;
}

async function deletePart({ partName }) {
  const normalizedPart = normalizePartName(partName);
  const views = await RejectionView.findAll({ where: { part_name: normalizedPart }, raw: true });
  const viewIds = views.map((view) => view.id);
  const categories = await RejectionCategory.findAll({ where: { part_name: normalizedPart }, raw: true });
  const categoryIds = categories.map((category) => category.id);
  const zones = viewIds.length ? await RejectionZone.findAll({ where: { view_id: { [Op.in]: viewIds } }, raw: true }) : [];
  const zoneIds = zones.map((zone) => zone.id);
  await RejectionZoneReason.destroy({ where: { part_name: normalizedPart } });
  if (categoryIds.length) await RejectionReason.destroy({ where: { category_id: { [Op.in]: categoryIds } } });
  if (zoneIds.length) await RejectionSubZone.destroy({ where: { zone_id: { [Op.in]: zoneIds } } });
  if (viewIds.length) await RejectionZone.destroy({ where: { view_id: { [Op.in]: viewIds } } });
  await RejectionCategory.destroy({ where: { part_name: normalizedPart } });
  await RejectionView.destroy({ where: { part_name: normalizedPart } });
}

async function addCategoryWithReasons({ partName = "DEFAULT", code, name, reasons = [] }) {
  const normalizedPart = normalizePartName(partName);
  const cleanCode = String(code || name || "").trim().toUpperCase();
  const cleanName = String(name || code || "").trim();
  if (!cleanCode || !cleanName) throw new Error("Category code and name are required.");
  let category = await RejectionCategory.findOne({
    where: { part_name: normalizedPart, code: cleanCode },
  });
  if (!category) {
    const count = await RejectionCategory.count({ where: { part_name: normalizedPart } });
    category = await RejectionCategory.create({
      part_name: normalizedPart,
      code: cleanCode,
      name: cleanName,
      sort_order: count + 1,
      is_active: true,
    });
  } else {
    category.name = cleanName;
    category.is_active = true;
    await category.save();
  }
  await addReasons({ partName: normalizedPart, categoryId: category.id, reasons });
  return category;
}

async function updateCategory({ partName = "DEFAULT", categoryId, name }) {
  const normalizedPart = normalizePartName(partName);
  const category = await RejectionCategory.findOne({
    where: { id: Number(categoryId), part_name: normalizedPart },
  });
  if (!category) throw new Error("Category not found.");
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Category name is required.");
  category.name = cleanName;
  await category.save();
  return category;
}

async function deleteCategory({ partName = "DEFAULT", categoryId }) {
  const normalizedPart = normalizePartName(partName);
  const category = await RejectionCategory.findOne({
    where: { id: Number(categoryId), part_name: normalizedPart },
  });
  if (!category) throw new Error("Category not found.");
  await RejectionZoneReason.destroy({ where: { part_name: normalizedPart, category_id: category.id } });
  await RejectionReason.destroy({ where: { category_id: category.id } });
  await category.destroy();
}

async function addReasons({ partName = "DEFAULT", categoryId, reasons = [] }) {
  const normalizedPart = normalizePartName(partName);
  const category = await RejectionCategory.findByPk(categoryId);
  if (!category || normalizePartName(category.part_name) !== normalizedPart) {
    throw new Error("Category not found for selected part.");
  }
  const cleanReasons = [...new Set((reasons || []).map((reason) => String(reason || "").trim()).filter(Boolean))];
  if (!cleanReasons.length) throw new Error("At least one reason is required.");
  const existing = await RejectionReason.findAll({ where: { category_id: category.id }, raw: true });
  const existingNames = new Set(existing.map((row) => String(row.name || "").trim().toUpperCase()));
  let sortOrder = existing.length + 1;
  for (const reason of cleanReasons) {
    if (existingNames.has(reason.toUpperCase())) continue;
    await RejectionReason.create({
      category_id: category.id,
      name: reason,
      sort_order: sortOrder,
      is_active: true,
    });
    sortOrder += 1;
  }
}

async function updateReason({ partName = "DEFAULT", reasonId, name }) {
  const normalizedPart = normalizePartName(partName);
  const reason = await RejectionReason.findByPk(Number(reasonId));
  const category = reason ? await RejectionCategory.findByPk(reason.category_id) : null;
  if (!reason || normalizePartName(category?.part_name) !== normalizedPart) {
    throw new Error("Reason not found.");
  }
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Reason name is required.");
  reason.name = cleanName;
  await reason.save();
  return reason;
}

async function deleteReason({ partName = "DEFAULT", reasonId }) {
  const normalizedPart = normalizePartName(partName);
  const reason = await RejectionReason.findByPk(Number(reasonId));
  const category = reason ? await RejectionCategory.findByPk(reason.category_id) : null;
  if (!reason || normalizePartName(category?.part_name) !== normalizedPart) {
    throw new Error("Reason not found.");
  }
  await RejectionZoneReason.destroy({ where: { part_name: normalizedPart, reason_id: reason.id } });
  await reason.destroy();
}

async function addViewWithZones({ partName = "DEFAULT", code, name, imageUrl = "", zones = [] }) {
  const normalizedPart = normalizePartName(partName);
  const cleanCode = String(code || name || "").trim().toUpperCase().replace(/\s+/g, "_");
  const cleanName = String(name || code || "").trim();
  if (!cleanCode || !cleanName) throw new Error("View code and name are required.");
  let view = await RejectionView.findOne({ where: { part_name: normalizedPart, code: cleanCode } });
  if (!view) {
    const count = await RejectionView.count({ where: { part_name: normalizedPart } });
    view = await RejectionView.create({
      part_name: normalizedPart,
      code: cleanCode,
      name: cleanName,
      image_url: String(imageUrl || "").trim() || null,
      sort_order: count + 1,
      is_active: true,
    });
  } else {
    view.name = cleanName;
    view.image_url = String(imageUrl || "").trim() || view.image_url || null;
    view.is_active = true;
    await view.save();
  }
  await addZones({ partName: normalizedPart, viewId: view.id, zones });
  return view;
}

async function updateView({ partName = "DEFAULT", viewId, name, imageUrl }) {
  const normalizedPart = normalizePartName(partName);
  const view = await RejectionView.findOne({ where: { id: Number(viewId), part_name: normalizedPart } });
  if (!view) throw new Error("View not found.");
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("View name is required.");
  view.name = cleanName;
  view.code = cleanName.toUpperCase().replace(/\s+/g, "_");
  if (imageUrl !== undefined) view.image_url = String(imageUrl || "").trim() || null;
  await view.save();
  return view;
}

async function deleteView({ partName = "DEFAULT", viewId }) {
  const normalizedPart = normalizePartName(partName);
  const view = await RejectionView.findOne({ where: { id: Number(viewId), part_name: normalizedPart } });
  if (!view) throw new Error("View not found.");
  await RejectionZoneReason.destroy({ where: { part_name: normalizedPart, view_id: view.id } });
  const zones = await RejectionZone.findAll({ where: { view_id: view.id }, raw: true });
  const zoneIds = zones.map((zone) => zone.id);
  if (zoneIds.length) await RejectionSubZone.destroy({ where: { zone_id: { [Op.in]: zoneIds } } });
  await RejectionZone.destroy({ where: { view_id: view.id } });
  await view.destroy();
}

async function addZones({ partName = "DEFAULT", viewId, zones = [] }) {
  const normalizedPart = normalizePartName(partName);
  const view = await RejectionView.findByPk(viewId);
  if (!view || normalizePartName(view.part_name) !== normalizedPart) {
    throw new Error("View not found for selected part.");
  }
  const cleanZones = (zones || [])
    .map((zone) => typeof zone === "string" ? { code: zone, name: `Zone ${zone}` } : zone)
    .map((zone) => ({
      code: String(zone?.code || zone?.name || "").trim().toUpperCase(),
      name: String(zone?.name || zone?.code || "").trim(),
      x_percent: Number(zone?.x_percent ?? zone?.xPercent ?? 10),
      y_percent: Number(zone?.y_percent ?? zone?.yPercent ?? 10),
      width_percent: Number(zone?.width_percent ?? zone?.widthPercent ?? 10),
      height_percent: Number(zone?.height_percent ?? zone?.heightPercent ?? 10),
    }))
    .filter((zone) => zone.code && zone.name);
  if (!cleanZones.length) throw new Error("At least one zone is required.");
  const existing = await RejectionZone.findAll({ where: { view_id: view.id }, raw: true });
  const existingCodes = new Set(existing.map((row) => String(row.code || "").trim().toUpperCase()));
  let sortOrder = existing.length + 1;
  for (const zone of cleanZones) {
    if (existingCodes.has(zone.code)) continue;
    await RejectionZone.create({
      view_id: view.id,
      code: zone.code,
      name: zone.name,
      x_percent: Number.isFinite(zone.x_percent) ? zone.x_percent : 10,
      y_percent: Number.isFinite(zone.y_percent) ? zone.y_percent : 10,
      width_percent: Number.isFinite(zone.width_percent) ? zone.width_percent : 10,
      height_percent: Number.isFinite(zone.height_percent) ? zone.height_percent : 10,
      sort_order: sortOrder,
      is_active: true,
    });
    sortOrder += 1;
  }
}

async function updateZone({ partName = "DEFAULT", zoneId, patch = {} }) {
  const normalizedPart = normalizePartName(partName);
  const zone = await RejectionZone.findByPk(zoneId);
  const view = zone ? await RejectionView.findByPk(zone.view_id) : null;
  if (!zone || normalizePartName(view?.part_name) !== normalizedPart) {
    throw new Error("Zone not found for selected part.");
  }
  const fields = [
    ["code", "code"],
    ["name", "name"],
    ["x_percent", "xPercent"],
    ["y_percent", "yPercent"],
    ["width_percent", "widthPercent"],
    ["height_percent", "heightPercent"],
  ];
  for (const [dbKey, apiKey] of fields) {
    if (patch[apiKey] === undefined && patch[dbKey] === undefined) continue;
    const value = patch[apiKey] ?? patch[dbKey];
    if (dbKey.endsWith("_percent")) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) zone[dbKey] = Math.max(0, Math.min(100, numeric));
    } else {
      const text = String(value || "").trim();
      if (text) zone[dbKey] = dbKey === "code" ? text.toUpperCase() : text;
    }
  }
  await zone.save();
  return zone;
}

async function deleteZone({ partName = "DEFAULT", zoneId }) {
  const normalizedPart = normalizePartName(partName);
  const zone = await RejectionZone.findByPk(Number(zoneId));
  const view = zone ? await RejectionView.findByPk(zone.view_id) : null;
  if (!zone || normalizePartName(view?.part_name) !== normalizedPart) {
    throw new Error("Zone not found.");
  }
  await RejectionZoneReason.destroy({ where: { part_name: normalizedPart, zone_id: zone.id } });
  await RejectionSubZone.destroy({ where: { zone_id: zone.id } });
  await zone.destroy();
}

async function addSubZones({ partName = "DEFAULT", zoneId, subZones = [] }) {
  const normalizedPart = normalizePartName(partName);
  const zone = await RejectionZone.findByPk(Number(zoneId));
  const view = zone ? await RejectionView.findByPk(zone.view_id) : null;
  if (!zone || normalizePartName(view?.part_name) !== normalizedPart) {
    throw new Error("Zone not found for selected part.");
  }
  const cleanSubZones = (subZones || [])
    .map((subZone) => typeof subZone === "string" ? { code: subZone, name: `Sub Zone ${subZone}` } : subZone)
    .map((subZone) => ({
      code: String(subZone?.code || subZone?.name || "").trim().toUpperCase(),
      name: String(subZone?.name || subZone?.code || "").trim(),
      x_percent: Number(subZone?.x_percent ?? subZone?.xPercent ?? 10),
      y_percent: Number(subZone?.y_percent ?? subZone?.yPercent ?? 10),
      width_percent: Number(subZone?.width_percent ?? subZone?.widthPercent ?? 10),
      height_percent: Number(subZone?.height_percent ?? subZone?.heightPercent ?? 10),
    }))
    .filter((subZone) => subZone.code && subZone.name);
  if (!cleanSubZones.length) throw new Error("At least one sub-zone is required.");
  const existing = await RejectionSubZone.findAll({ where: { zone_id: zone.id }, raw: true });
  const existingCodes = new Set(existing.map((row) => String(row.code || "").trim().toUpperCase()));
  let sortOrder = existing.length + 1;
  for (const subZone of cleanSubZones) {
    if (existingCodes.has(subZone.code)) continue;
    await RejectionSubZone.create({
      zone_id: zone.id,
      code: subZone.code,
      name: subZone.name,
      x_percent: Number.isFinite(subZone.x_percent) ? subZone.x_percent : 10,
      y_percent: Number.isFinite(subZone.y_percent) ? subZone.y_percent : 10,
      width_percent: Number.isFinite(subZone.width_percent) ? subZone.width_percent : 10,
      height_percent: Number.isFinite(subZone.height_percent) ? subZone.height_percent : 10,
      sort_order: sortOrder,
      is_active: true,
    });
    sortOrder += 1;
  }
}

async function updateSubZone({ partName = "DEFAULT", subZoneId, patch = {} }) {
  const normalizedPart = normalizePartName(partName);
  const subZone = await RejectionSubZone.findByPk(Number(subZoneId));
  const zone = subZone ? await RejectionZone.findByPk(subZone.zone_id) : null;
  const view = zone ? await RejectionView.findByPk(zone.view_id) : null;
  if (!subZone || normalizePartName(view?.part_name) !== normalizedPart) {
    throw new Error("Sub-zone not found for selected part.");
  }
  const fields = [
    ["code", "code"],
    ["name", "name"],
    ["x_percent", "xPercent"],
    ["y_percent", "yPercent"],
    ["width_percent", "widthPercent"],
    ["height_percent", "heightPercent"],
  ];
  for (const [dbKey, apiKey] of fields) {
    if (patch[apiKey] === undefined && patch[dbKey] === undefined) continue;
    const value = patch[apiKey] ?? patch[dbKey];
    if (dbKey.endsWith("_percent")) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) subZone[dbKey] = Math.max(0, Math.min(100, numeric));
    } else {
      const text = String(value || "").trim();
      if (text) subZone[dbKey] = dbKey === "code" ? text.toUpperCase() : text;
    }
  }
  await subZone.save();
  return subZone;
}

async function deleteSubZone({ partName = "DEFAULT", subZoneId }) {
  const normalizedPart = normalizePartName(partName);
  const subZone = await RejectionSubZone.findByPk(Number(subZoneId));
  const zone = subZone ? await RejectionZone.findByPk(subZone.zone_id) : null;
  const view = zone ? await RejectionView.findByPk(zone.view_id) : null;
  if (!subZone || normalizePartName(view?.part_name) !== normalizedPart) {
    throw new Error("Sub-zone not found for selected part.");
  }
  await RejectionZoneReason.destroy({ where: { part_name: normalizedPart, sub_zone_id: subZone.id } });
  await subZone.destroy();
}

async function setZoneReasons({ partName = "DEFAULT", categoryId, viewId, zoneId, subZoneId = null, reasonIds = [] }) {
  const normalizedPart = normalizePartName(partName);
  const cleanReasonIds = [...new Set((reasonIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!categoryId || !viewId || !zoneId) {
    throw new Error("Category, view and zone are required.");
  }
  const [category, view, zone, subZone] = await Promise.all([
    RejectionCategory.findOne({ where: { id: Number(categoryId), part_name: normalizedPart } }),
    RejectionView.findOne({ where: { id: Number(viewId), part_name: normalizedPart } }),
    RejectionZone.findByPk(Number(zoneId)),
    subZoneId ? RejectionSubZone.findByPk(Number(subZoneId)) : null,
  ]);
  if (!category || !view || !zone || Number(zone.view_id) !== Number(view.id)) {
    throw new Error("Selected category, view and zone must belong to the selected part.");
  }
  if (subZoneId && (!subZone || Number(subZone.zone_id) !== Number(zone.id))) {
    throw new Error("Selected sub-zone must belong to the selected zone.");
  }
  if (cleanReasonIds.length) {
    const validReasons = await RejectionReason.count({
      where: {
        id: { [Op.in]: cleanReasonIds },
        category_id: category.id,
        is_active: true,
      },
    });
    if (validReasons !== cleanReasonIds.length) {
      throw new Error("One or more selected reasons do not belong to the selected category.");
    }
  }
  await RejectionZoneReason.destroy({
    where: {
      part_name: normalizedPart,
      category_id: Number(categoryId),
      view_id: Number(viewId),
      zone_id: Number(zoneId),
      sub_zone_id: subZoneId ? Number(subZoneId) : null,
    },
  });
  for (const reasonId of cleanReasonIds) {
    await RejectionZoneReason.create({
      part_name: normalizedPart,
      category_id: Number(categoryId),
      view_id: Number(viewId),
      zone_id: Number(zoneId),
      sub_zone_id: subZoneId ? Number(subZoneId) : null,
      reason_id: reasonId,
      is_active: true,
    });
  }
}

module.exports = {
  normalizePartName,
  ensureDefaultsForPart,
  getOperatorConfig,
  applyReasonsToAllZones,
  applyAllCategoryReasonsToAllZones,
  listConfiguredParts,
  renamePart,
  deletePart,
  addCategoryWithReasons,
  updateCategory,
  deleteCategory,
  addReasons,
  updateReason,
  deleteReason,
  addViewWithZones,
  updateView,
  deleteView,
  addZones,
  updateZone,
  deleteZone,
  addSubZones,
  updateSubZone,
  deleteSubZone,
  setZoneReasons,
};
