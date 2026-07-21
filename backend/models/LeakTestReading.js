const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const LeakTestReading = sequelize.define("LeakTestReading", {
  part_id: { type: DataTypes.STRING, allowNull: false },
  machine_id: { type: DataTypes.INTEGER, allowNull: false },
  station_no: { type: DataTypes.STRING, allowNull: true },
  operation_log_id: { type: DataTypes.INTEGER, allowNull: true },
  payload_json: { type: DataTypes.TEXT, allowNull: false },
});

function scheduleFinalProductionRefresh(instance) {
  const partId = instance?.part_id || instance?.get?.("part_id");
  if (!partId) return;
  setImmediate(() => {
    try {
      require("../services/report/finalProductionResultService").scheduleMaterializePart(partId);
    } catch (error) {
      console.warn(`[FinalProductionResult] leak-test hook skipped: ${error.message}`);
    }
  });
}

LeakTestReading.addHook("afterCreate", scheduleFinalProductionRefresh);
LeakTestReading.addHook("afterUpdate", scheduleFinalProductionRefresh);

module.exports = LeakTestReading;
