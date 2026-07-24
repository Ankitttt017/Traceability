const sequelize = require("../config/db");
require("../models/Machine");
require("../models/Part");
require("../models/OperationLog");
require("../models/ProductionLog");
require("../models/PartCodeMapping");
require("../models/LeakTestReading");
require("../models/QrFormatRule");
require("../models/Shift");
require("../models/FinalProductionResult");

const { fetchProductionData } = require("../services/report/reportExportService");
const { upsertMaterializedReportRows } = require("../services/report/finalProductionResultService");

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

async function main() {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const dateFrom = new Date(getArg("from", defaultFrom.toISOString()));
  const dateTo = new Date(getArg("to", now.toISOString()));

  if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
    throw new Error("Invalid date range. Use --from=2026-07-01T00:00:00.000Z --to=2026-07-21T23:59:59.999Z");
  }

  await sequelize.authenticate();
  await sequelize.sync({ alter: false });

  console.log(`[FinalProductionResult] Rebuild started ${dateFrom.toISOString()} -> ${dateTo.toISOString()}`);
  const rows = await fetchProductionData({
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
  }, {
    includePlcReadings: true,
    includeLeaktest: true,
    includePlcSummary: false,
  });
  const result = await upsertMaterializedReportRows(rows);
  console.log(`[FinalProductionResult] Rebuild completed. reportRows=${rows.length} groupsUpserted=${result.upserted}`);
}

main()
  .catch((error) => {
    console.error(`[FinalProductionResult] Rebuild failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
