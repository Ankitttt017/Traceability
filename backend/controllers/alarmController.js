const Alarm = require("../models/Alarm");

const alarmController = {
  getRecentAlarms: async (req, res) => {
    try {
      const { limit = 20 } = req.query;
      const alarms = await Alarm.findAll({
        where: { resolvedAt: null },
        order: [["createdAt", "DESC"]],
        limit: parseInt(limit, 10),
      });
      res.json({ success: true, data: alarms });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  resolveAlarm: async (req, res) => {
    try {
      const { id } = req.params;
      const { resolvedBy } = req.body;
      const alarm = await Alarm.findByPk(id);
      if (!alarm) {
        return res.status(404).json({ success: false, message: "Alarm not found" });
      }

      alarm.resolvedAt = new Date();
      alarm.resolvedBy = resolvedBy || "Admin";
      await alarm.save();

      res.json({ success: true, message: "Alarm resolved" });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },

  resolveAllAlarms: async (req, res) => {
    try {
      const { resolvedBy } = req.body;
      await Alarm.update(
        { resolvedAt: new Date(), resolvedBy: resolvedBy || "Admin" },
        { where: { resolvedAt: null } }
      );
      res.json({ success: true, message: "All alarms resolved" });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = alarmController;
