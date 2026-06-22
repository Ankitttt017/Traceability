const {
  normalizePartName,
  ensureDefaultsForPart,
  getOperatorConfig,
  applyReasonsToAllZones,
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
  setZoneReasons,
} = require("../services/rejectionConfigService");
const RejectionView = require("../models/RejectionView");

exports.getOperatorConfig = async (req, res) => {
  try {
    const requestedPartName = String(req.query.partName || req.query.partId || "").trim();
    if (!requestedPartName || requestedPartName.toUpperCase() === "DEFAULT") {
      return res.status(400).json({ error: "A configured part name is required." });
    }
    const partName = normalizePartName(requestedPartName);
    const config = await getOperatorConfig(partName);
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.listParts = async (_req, res) => {
  try {
    res.json({ parts: await listConfiguredParts() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updatePart = async (req, res) => {
  try {
    const oldPartName = normalizePartName(req.body?.oldPartName || req.body?.partName || "DEFAULT");
    const newPartName = normalizePartName(req.body?.newPartName || req.body?.name);
    await renamePart({ oldPartName, newPartName });
    res.json(await getOperatorConfig(newPartName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deletePart = async (req, res) => {
  try {
    const partName = normalizePartName(req.params?.name || req.body?.partName || req.query?.partName);
    await deletePart({ partName });
    const parts = await listConfiguredParts();
    res.json({ parts, nextPartName: parts[0] || "" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.ensureDefaults = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || req.query.partName || "DEFAULT");
    await ensureDefaultsForPart(partName);
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.applyReasonsToAllZones = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || "DEFAULT");
    const categoryId = Number(req.body?.categoryId);
    const reasonIds = Array.isArray(req.body?.reasonIds) ? req.body.reasonIds : [];
    if (!categoryId) {
      return res.status(400).json({ error: "categoryId is required" });
    }
    await applyReasonsToAllZones({ partName, categoryId, reasonIds });
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateViewImage = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || "DEFAULT");
    const viewId = Number(req.body?.viewId);
    const imageUrl = String(req.body?.imageUrl || "").trim();
    if (!viewId) {
      return res.status(400).json({ error: "viewId is required" });
    }
    const view = await RejectionView.findOne({ where: { id: viewId, part_name: partName } });
    if (!view) {
      return res.status(404).json({ error: "View not found for selected part." });
    }
    view.image_url = imageUrl || null;
    await view.save();
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.createCategory = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || "DEFAULT");
    await addCategoryWithReasons({
      partName,
      code: req.body?.code,
      name: req.body?.name,
      reasons: req.body?.reasons,
    });
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || "DEFAULT");
    const categoryId = Number(req.body?.categoryId);
    if (!categoryId) return res.status(400).json({ error: "categoryId is required" });
    await updateCategory({ partName, categoryId, name: req.body?.name });
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || req.query?.partName || "DEFAULT");
    const categoryId = Number(req.params?.id || req.body?.categoryId);
    if (!categoryId) return res.status(400).json({ error: "categoryId is required" });
    await deleteCategory({ partName, categoryId });
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.addReasons = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || "DEFAULT");
    const categoryId = Number(req.body?.categoryId);
    if (!categoryId) return res.status(400).json({ error: "categoryId is required" });
    await addReasons({ categoryId, reasons: req.body?.reasons });
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateReason = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || "DEFAULT");
    const reasonId = Number(req.body?.reasonId);
    if (!reasonId) return res.status(400).json({ error: "reasonId is required" });
    await updateReason({ partName, reasonId, name: req.body?.name });
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteReason = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || req.query?.partName || "DEFAULT");
    const reasonId = Number(req.params?.id || req.body?.reasonId);
    if (!reasonId) return res.status(400).json({ error: "reasonId is required" });
    await deleteReason({ partName, reasonId });
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.createView = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || "DEFAULT");
    await addViewWithZones({
      partName,
      code: req.body?.code,
      name: req.body?.name,
      imageUrl: req.body?.imageUrl,
      zones: req.body?.zones,
    });
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateView = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || "DEFAULT");
    const viewId = Number(req.body?.viewId);
    if (!viewId) return res.status(400).json({ error: "viewId is required" });
    await updateView({ partName, viewId, name: req.body?.name, imageUrl: req.body?.imageUrl });
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteView = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || req.query?.partName || "DEFAULT");
    const viewId = Number(req.params?.id || req.body?.viewId);
    if (!viewId) return res.status(400).json({ error: "viewId is required" });
    await deleteView({ partName, viewId });
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.addZones = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || "DEFAULT");
    const viewId = Number(req.body?.viewId);
    if (!viewId) return res.status(400).json({ error: "viewId is required" });
    await addZones({ viewId, zones: req.body?.zones });
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateZone = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || "DEFAULT");
    const zoneId = Number(req.body?.zoneId);
    if (!zoneId) return res.status(400).json({ error: "zoneId is required" });
    await updateZone({ zoneId, patch: req.body || {} });
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteZone = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || req.query?.partName || "DEFAULT");
    const zoneId = Number(req.params?.id || req.body?.zoneId);
    if (!zoneId) return res.status(400).json({ error: "zoneId is required" });
    await deleteZone({ partName, zoneId });
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.setZoneReasons = async (req, res) => {
  try {
    const partName = normalizePartName(req.body?.partName || "DEFAULT");
    await setZoneReasons({
      partName,
      categoryId: req.body?.categoryId,
      viewId: req.body?.viewId,
      zoneId: req.body?.zoneId,
      reasonIds: req.body?.reasonIds,
    });
    res.json(await getOperatorConfig(partName));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
