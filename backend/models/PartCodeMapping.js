const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PartCodeMapping = sequelize.define("PartCodeMapping", {
  old_part_id: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  customer_qr: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  machine_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  station_no: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: "PartCodeMappings",
});

function scheduleFinalProductionRefresh(instance) {
  const partIds = [
    instance?.old_part_id || instance?.get?.("old_part_id"),
    instance?.customer_qr || instance?.get?.("customer_qr"),
  ].map((value) => String(value || "").trim()).filter(Boolean);
  if (!partIds.length) return;
  setImmediate(() => {
    try {
      const { scheduleMaterializePart } = require("../services/report/finalProductionResultService");
      partIds.forEach((partId) => scheduleMaterializePart(partId));
    } catch (error) {
      console.warn(`[FinalProductionResult] QR mapping hook skipped: ${error.message}`);
    }
  });
}

PartCodeMapping.addHook("afterCreate", scheduleFinalProductionRefresh);
PartCodeMapping.addHook("afterUpdate", scheduleFinalProductionRefresh);

module.exports = PartCodeMapping;
