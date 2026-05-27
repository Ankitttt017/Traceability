export const REPORT_CONFIG_STORAGE_KEY = "traceability-report-config-v1";

export const DEFAULT_REPORT_CONFIG = {
  companyName: "BMW Group",
  plantName: "Gen-6 Bawal Plant",
  projectTitle: "Traceability System",
  reportTitle: "Production Report",
  logoUrl: "",
  headerLine1: "BMW India Private Limited",
  headerLine2: "Quality & Production Traceability",
  footerText: "Confidential - Internal Use Only",
  location: "Bawal, Haryana, India",
  preparedBy: "",
  approvedBy: "",
  department: "Quality Engineering",
  showLogo: true,
  showDate: true,
  showShift: true,
  showMachine: true,
  reportAccentColor: "#1A3A7C",
  reportHeaderBgColor: "#EAF0F8",
  columns: [
    { id: "srNo", label: "SR NO", enabled: true },
    { id: "partId", label: "Part Serial No", enabled: true },
    { id: "createdAt", label: "Timestamp", enabled: true },
    { id: "shiftCode", label: "Shift", enabled: true },
    { id: "operationNo", label: "Operation No", enabled: true },
    { id: "machineName", label: "Machine Name", enabled: true },
    { id: "modelCode", label: "Model Code", enabled: true },
    { id: "qrFormatName", label: "Model Name", enabled: true },
    { id: "status", label: "Result (OK/NG)", enabled: true },
    { id: "reason", label: "Reason", enabled: true },
    { id: "lineName", label: "Line No", enabled: true },
    { id: "cycleTime", label: "Cycle Time (s)", enabled: true },
    { id: "stationNo", label: "Station", enabled: false },
    { id: "result", label: "Raw Result", enabled: false },
    { id: "plcStatus", label: "PLC Status", enabled: false },
    { id: "operatorId", label: "Operator ID", enabled: false },
  ],
};

function deepClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeColumns(rawColumns) {
  const defaultById = new Map(DEFAULT_REPORT_CONFIG.columns.map((column) => [column.id, column]));
  const incoming = Array.isArray(rawColumns) ? rawColumns : [];
  const merged = [];
  const used = new Set();

  for (const column of incoming) {
    if (!column || typeof column !== "object") continue;
    const id = String(column.id || "").trim();
    if (!id || used.has(id)) continue;
    used.add(id);
    const defaults = defaultById.get(id);
    merged.push({
      id,
      label: String(column.label || defaults?.label || id),
      enabled: column.enabled !== false,
    });
  }

  for (const fallback of DEFAULT_REPORT_CONFIG.columns) {
    if (used.has(fallback.id)) continue;
    merged.push({ ...fallback });
  }

  return merged;
}

function normalizeReportConfig(rawConfig = {}) {
  const source = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  return {
    ...deepClone(DEFAULT_REPORT_CONFIG),
    ...source,
    columns: normalizeColumns(source.columns),
  };
}

export function loadReportConfig() {
  if (typeof window === "undefined") {
    return deepClone(DEFAULT_REPORT_CONFIG);
  }

  try {
    const raw = localStorage.getItem(REPORT_CONFIG_STORAGE_KEY);
    if (!raw) {
      return deepClone(DEFAULT_REPORT_CONFIG);
    }
    return normalizeReportConfig(JSON.parse(raw));
  } catch {
    return deepClone(DEFAULT_REPORT_CONFIG);
  }
}

export function saveReportConfig(config) {
  if (typeof window === "undefined") return;
  const normalized = normalizeReportConfig(config);
  localStorage.setItem(REPORT_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function prependCsvReportHeader(csvBody, options = {}) {
  const config = normalizeReportConfig(options.config || loadReportConfig());
  const generatedAt = options.generatedAt || new Date().toLocaleString("en-IN");
  const periodLabel = options.periodLabel || "-";
  const reportTitle = options.reportTitle || config.reportTitle || "Production Report";
  const topLine = config.headerLine1 || config.companyName || "Traceability Report";
  const subLine = config.headerLine2 || config.projectTitle || "";
  const rows = [
    [topLine],
    [subLine],
    [reportTitle],
    [],
    ["Plant", config.plantName || "-"],
    ["Department", config.department || "-"],
    ["Location", config.location || "-"],
    ["Period", periodLabel],
    ["Generated", generatedAt],
    [],
  ];

  const header = rows
    .map((row) => {
      if (!Array.isArray(row) || row.length === 0) return "";
      if (row.length === 1) return csvEscape(row[0]);
      return `${csvEscape(row[0])},${csvEscape(row[1])}`;
    })
    .join("\n");

  return `${header}\n${String(csvBody || "").trimStart()}`;
}
