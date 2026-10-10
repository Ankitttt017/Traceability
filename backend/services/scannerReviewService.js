/**
 * scannerReviewService (SCANNER-FIX)
 *
 * READ-ONLY review list of traceability records that are probably wrong
 * because of scanner framing / mapping problems at the laser (customer QR)
 * station. Nothing here writes to the database.
 *
 * Types (each record gets exactly one type, first match wins):
 *  - MAPPING_ERROR_OR_CONCATENATED : mapping value contains a scanner status
 *                                    word (ERROR…) or several glued codes
 *  - MAPPING_DPM_TO_DPM            : customer_qr is itself a DPM part id
 *  - MAPPING_BAD_CUSTOMER_QR       : customer_qr fails the customer-QR rule
 *  - MAPPING_BAD_OLD_PART_ID       : old_part_id fails the DPM rule and the row
 *                                    is not a deliberate QR-only self-map
 *  - FRAGMENT_PART_LOG_OK          : OperationLog accepted OK whose part_id is
 *                                    a fragment (< 13 chars, matches no rule)
 *  - REPORT_MISSING_CUSTOMER_QR    : ProductionReports row with customer_qr '-'
 *                                    / empty while a valid mapping exists
 *  - DPM_START_WITHOUT_MAPPING     : DPM part started OK at the customer-QR
 *                                    station but has no active mapping
 *                                    ("missing part id")
 *  - SUSPECTED_LOST_DPM_LINK       : QR-only start (customer QR self-mapped)
 *                                    within N s after a DPM event at the same
 *                                    station that went wrong (DUPLICATE block
 *                                    caused by a garbage read, or a DPM whose
 *                                    mapping is garbage) — the customer QR most
 *                                    likely belonged to that DPM part
 */
const sequelize = require("../config/db");
const {
  isDpmCode,
  isCustomerQrCode,
  containsScannerStatusWord,
  looksLikeConcatenatedCodes,
} = require("../tcp/scannerFlowUtils");

const REVIEW_TYPES = [
  "MAPPING_ERROR_OR_CONCATENATED",
  "MAPPING_DPM_TO_DPM",
  "MAPPING_BAD_CUSTOMER_QR",
  "MAPPING_BAD_OLD_PART_ID",
  "FRAGMENT_PART_LOG_OK",
  "REPORT_MISSING_CUSTOMER_QR",
  "DPM_START_WITHOUT_MAPPING",
  "SUSPECTED_LOST_DPM_LINK",
];

function classifyMapping(row) {
  const oldPartId = String(row.old_part_id || "").trim();
  const customerQr = String(row.customer_qr || "").trim();
  const isSelfMap = oldPartId && oldPartId === customerQr;
  const values = [oldPartId, customerQr];
  if (values.some((value) => containsScannerStatusWord(value) || looksLikeConcatenatedCodes(value))) {
    return "MAPPING_ERROR_OR_CONCATENATED";
  }
  if (!isSelfMap && isDpmCode(customerQr)) return "MAPPING_DPM_TO_DPM";
  if (!isCustomerQrCode(customerQr)) return "MAPPING_BAD_CUSTOMER_QR";
  if (!isSelfMap && !isDpmCode(oldPartId)) return "MAPPING_BAD_OLD_PART_ID";
  return null;
}

async function getCustomerQrStations() {
  // Stations whose feature config requires a customer QR (the laser station).
  const [rows] = await sequelize.query(
    "SELECT station_no, config FROM StationFeatureSettings"
  );
  const stations = [];
  for (const row of rows) {
    try {
      const config = JSON.parse(row.config || "{}");
      if (config.customerQrRequired === true) stations.push(String(row.station_no || "").trim().toUpperCase());
    } catch (_error) {
      // ignore malformed config
    }
  }
  return stations.length ? stations : ["OP110"];
}

async function collectReviewItems({ days = 14, lostLinkWindowSec = 120 } = {}) {
  const items = [];
  const replacements = { negDays: -Math.abs(Number(days) || 14) };

  // 1. Mappings created in the window.
  const [mappings] = await sequelize.query(
    `SELECT id, old_part_id, customer_qr, machine_id, station_no, is_active, createdAt
       FROM PartCodeMappings
      WHERE is_active = 1 AND createdAt >= DATEADD(day, :negDays, GETDATE())`,
    { replacements }
  );
  for (const row of mappings) {
    const type = classifyMapping(row);
    if (!type) continue;
    items.push({
      type,
      source: "PartCodeMappings",
      id: row.id,
      partId: row.old_part_id,
      customerQr: row.customer_qr,
      stationNo: row.station_no,
      machineId: row.machine_id,
      at: row.createdAt,
    });
  }

  // 2. Fragment part ids accepted OK.
  const [fragments] = await sequelize.query(
    `SELECT id, part_id, station_no, machine_id, plc_status, result, createdAt
       FROM OperationLogs
      WHERE result = 'OK' AND LEN(part_id) < 13
        AND createdAt >= DATEADD(day, :negDays, GETDATE())`,
    { replacements }
  );
  for (const row of fragments) {
    if (isDpmCode(row.part_id) || isCustomerQrCode(row.part_id)) continue;
    items.push({
      type: "FRAGMENT_PART_LOG_OK",
      source: "OperationLogs",
      id: row.id,
      partId: row.part_id,
      stationNo: row.station_no,
      machineId: row.machine_id,
      detail: `${row.plc_status}/${row.result}`,
      at: row.createdAt,
    });
  }

  // 3. Reports missing the customer QR although a mapping exists.
  const [reports] = await sequelize.query(
    `SELECT r.id, r.part_id, r.customer_qr AS report_customer_qr, m.customer_qr, r.createdAt
       FROM ProductionReports r
       JOIN PartCodeMappings m ON m.old_part_id = r.part_id AND m.is_active = 1
      WHERE (r.customer_qr IS NULL OR LTRIM(RTRIM(r.customer_qr)) IN ('', '-'))
        AND m.customer_qr <> m.old_part_id
        AND r.createdAt >= DATEADD(day, :negDays, GETDATE())`,
    { replacements }
  );
  for (const row of reports) {
    if (!isCustomerQrCode(row.customer_qr)) continue;
    items.push({
      type: "REPORT_MISSING_CUSTOMER_QR",
      source: "ProductionReports",
      id: row.id,
      partId: row.part_id,
      customerQr: row.customer_qr,
      detail: `report customer_qr='${row.report_customer_qr ?? ""}'`,
      at: row.createdAt,
    });
  }

  // 4 + 5. Customer-QR station analysis (DPM starts without mapping, lost links).
  const stations = await getCustomerQrStations();
  const stationList = stations.map((station) => `'${station.replace(/'/g, "")}'`).join(",");
  const [stationLogs] = await sequelize.query(
    `SELECT o.id, o.part_id, o.station_no, o.machine_id, o.result, o.plc_status, o.interlock_reason, o.createdAt,
            m.customer_qr AS mapped_customer_qr
       FROM OperationLogs o
       LEFT JOIN PartCodeMappings m ON m.old_part_id = o.part_id AND m.is_active = 1
      WHERE o.station_no IN (${stationList})
        AND o.createdAt >= DATEADD(day, :negDays, GETDATE())`,
    { replacements }
  );
  const dpmStartsWithoutMapping = new Map();
  for (const row of stationLogs) {
    if (row.result !== "OK" || !isDpmCode(row.part_id) || row.mapped_customer_qr) continue;
    if (!dpmStartsWithoutMapping.has(row.part_id)) dpmStartsWithoutMapping.set(row.part_id, row);
  }
  for (const row of dpmStartsWithoutMapping.values()) {
    items.push({
      type: "DPM_START_WITHOUT_MAPPING",
      source: "OperationLogs",
      id: row.id,
      partId: row.part_id,
      stationNo: row.station_no,
      machineId: row.machine_id,
      detail: `${row.plc_status}/${row.result}`,
      at: row.createdAt,
    });
  }

  const suspiciousDpmEvents = stationLogs
    .filter((row) => isDpmCode(row.part_id))
    .filter((row) => {
      const mappedBad = row.mapped_customer_qr && !isCustomerQrCode(row.mapped_customer_qr);
      const duplicateBlock = String(row.interlock_reason || "").toUpperCase() === "DUPLICATE_SCAN";
      return (duplicateBlock && mappedBad) || (row.result === "OK" && mappedBad);
    })
    .map((row) => ({ ...row, t: new Date(row.createdAt).getTime() }))
    .sort((a, b) => a.t - b.t);
  const qrOnlyStarts = mappings
    .filter((row) => String(row.old_part_id || "").trim() === String(row.customer_qr || "").trim())
    .filter((row) => stations.includes(String(row.station_no || "").trim().toUpperCase()));
  const windowMs = lostLinkWindowSec * 1000;
  for (const row of qrOnlyStarts) {
    const t = new Date(row.createdAt).getTime();
    // binary-search-free scan is fine for the bounded window sizes used here
    const trigger = suspiciousDpmEvents.find((event) => event.t <= t && event.t >= t - windowMs);
    if (!trigger) continue;
    items.push({
      type: "SUSPECTED_LOST_DPM_LINK",
      source: "PartCodeMappings",
      id: row.id,
      partId: row.old_part_id,
      customerQr: row.customer_qr,
      stationNo: row.station_no,
      machineId: row.machine_id,
      detail: `QR-only start ${Math.round((t - trigger.t) / 1000)}s after ${trigger.interlock_reason || "DPM start"} of ${trigger.part_id} (mapped to '${trigger.mapped_customer_qr}')`,
      relatedPartId: trigger.part_id,
      at: row.createdAt,
    });
  }

  return items;
}

async function getScannerReview({ type = "", page = 1, pageSize = 100, days = 14, lostLinkWindowSec = 120 } = {}) {
  const safeDays = Math.min(Math.max(Number(days) || 14, 1), 90);
  const safePageSize = Math.min(Math.max(Number(pageSize) || 100, 1), 500);
  const safePage = Math.max(Number(page) || 1, 1);
  const safeWindow = Math.min(Math.max(Number(lostLinkWindowSec) || 120, 10), 900);
  const all = await collectReviewItems({ days: safeDays, lostLinkWindowSec: safeWindow });
  const counts = Object.fromEntries(REVIEW_TYPES.map((key) => [key, 0]));
  for (const item of all) counts[item.type] = (counts[item.type] || 0) + 1;
  const wanted = String(type || "").trim().toUpperCase();
  const filtered = (wanted ? all.filter((item) => item.type === wanted) : all)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const start = (safePage - 1) * safePageSize;
  return {
    days: safeDays,
    lostLinkWindowSec: safeWindow,
    counts,
    total: filtered.length,
    page: safePage,
    pageSize: safePageSize,
    items: filtered.slice(start, start + safePageSize),
  };
}

module.exports = {
  getScannerReview,
  classifyMapping,
  REVIEW_TYPES,
};
