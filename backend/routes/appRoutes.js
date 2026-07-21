const express = require("express");
const { Op, fn, col, literal } = require("sequelize");
const Machine = require("../models/Machine");
const Part = require("../models/Part");
const OperationLog = require("../models/OperationLog");
const ProductionLog = require("../models/ProductionLog");
const { saveScan } = require("../services/scanService");

const router = express.Router();

router.get("/machines", async (req, res) => {
  try {
    const machines = await Machine.findAll({ order: [["id", "ASC"]] });
    res.json(machines);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/traceability/:partId", async (req, res) => {
  try {
    const { partId } = req.params;
    const part = await Part.findOne({ where: { part_id: partId } });
    const history = await OperationLog.findAll({
      where: { part_id: partId },
      order: [["createdAt", "DESC"]],
    });

    if (!part && history.length === 0) {
      return res.status(404).json({ error: "Part not found" });
    }

    res.json({
      part: part || { part_id: partId, status: "UNKNOWN", current_operation: null },
      history,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/scan/process", async (req, res) => {
  try {
    const { partId, operation, result, machineId } = req.body;
    if (!partId || !operation) {
      return res.status(400).json({ error: "partId and operation are required" });
    }

    const response = await saveScan(partId, operation, result, machineId || 0, null, {
      enforceQrFormatValidation: true,
      enforceSequenceValidation: true,
    });
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/dashboard/summary", async (req, res) => {
  try {
    const [machineTotal, machineActive, partsInProgress, partsCompleted, partsNg, okLogs, ngLogs, recentScans] =
      await Promise.all([
        Machine.count(),
        Machine.count({ where: { status: "ACTIVE" } }),
        Part.count({ where: { status: "IN_PROCESS" } }),
        Part.count({ where: { status: "COMPLETED" } }),
        Part.count({ where: { status: "NG" } }),
        ProductionLog.count({ where: { status: "OK" } }),
        ProductionLog.count({ where: { status: "NG" } }),
        ProductionLog.findAll({
          order: [["createdAt", "DESC"]],
          limit: 8,
        }),
      ]);

    res.json({
      machines: {
        total: machineTotal,
        active: machineActive,
        inactive: Math.max(machineTotal - machineActive, 0),
      },
      parts: {
        inProgress: partsInProgress,
        completed: partsCompleted,
        ng: partsNg,
      },
      quality: {
        ok: okLogs,
        ng: ngLogs,
      },
      recentScans,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/dashboard/trends", async (req, res) => {
  try {
    const trends = await ProductionLog.findAll({
      attributes: [
        [fn("DATE_FORMAT", col("createdAt"), "%Y-%m"), "month"],
        [fn("SUM", literal("CASE WHEN status = 'OK' THEN 1 ELSE 0 END")), "ok"],
        [fn("SUM", literal("CASE WHEN status = 'NG' THEN 1 ELSE 0 END")), "ng"],
      ],
      where: {
        createdAt: {
          [Op.gte]: new Date(new Date().setMonth(new Date().getMonth() - 5)),
        },
      },
      group: [fn("DATE_FORMAT", col("createdAt"), "%Y-%m")],
      order: [[fn("DATE_FORMAT", col("createdAt"), "%Y-%m"), "ASC"]],
      raw: true,
    });

    res.json(trends);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
