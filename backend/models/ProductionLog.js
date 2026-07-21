const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ProductionLog = sequelize.define("ProductionLog", {
  part_id: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  machine_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM("OK", "NG"),
    allowNull: false,
  },
  ng_reason: {
    type: DataTypes.STRING,
    allowNull: true,
  },
});

function scheduleFinalProductionRefresh(instance) {
  const partId = instance?.part_id || instance?.get?.("part_id");
  if (!partId) return;
  setImmediate(() => {
    try {
      require("../services/report/finalProductionResultService").scheduleMaterializePart(partId);
    } catch (error) {
      console.warn(`[FinalProductionResult] production log hook skipped: ${error.message}`);
    }
  });
}

ProductionLog.addHook("afterCreate", scheduleFinalProductionRefresh);
ProductionLog.addHook("afterUpdate", scheduleFinalProductionRefresh);

module.exports = ProductionLog;
