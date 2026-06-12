import apiClient from "./client";
import { ENDPOINTS } from "./endpoints";
import { loadReportConfig } from "../utils/reportConfig";

export const authApi = {
  login: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.auth.login, payload);
    return data;
  },
  register: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.auth.register, payload);
    return data;
  },
  verifyMfa: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.auth.verifyMfa, payload);
    return data;
  },
};

export const machineApi = {
  list: async (config = {}) => {
    const { data } = await apiClient.get(ENDPOINTS.machines, config);
    return data;
  },
  create: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.machines, payload);
    return data;
  },
  update: async (id, payload) => {
    const { data } = await apiClient.put(`${ENDPOINTS.machines}/${id}`, payload);
    return data;
  },
  updateTarget: async (id, payload) => {
    const { data } = await apiClient.patch(ENDPOINTS.machineTarget(id), payload);
    return data;
  },
  testConnection: async (payload, config = {}) => {
    const { data } = await apiClient.post(`${ENDPOINTS.machines}/test-connection`, payload, config);
    return data;
  },
  testPlc: async (payload, config = {}) => {
    const { data } = await apiClient.post(ENDPOINTS.machineTestPlc, payload, config);
    return data;
  },
  resetPlc: async (payload, config = {}) => {
    const { data } = await apiClient.post(ENDPOINTS.machineResetPlc, payload, config);
    return data;
  },
  sendPlcCommand: async (payload, config = {}) => {
    const { data } = await apiClient.post(ENDPOINTS.machinePlcCommand, payload, config);
    return data;
  },
  readPlcValue: async (payload, config = {}) => {
    const { data } = await apiClient.post(ENDPOINTS.machineReadPlcValue, payload, config);
    return data;
  },
  readPlcRegisters: async (payload, config = {}) => {
    const { data } = await apiClient.post(ENDPOINTS.machineReadPlcRegisters, payload, config);
    return data;
  },
  writePlcValue: async (payload, config = {}) => {
    const { data } = await apiClient.post(ENDPOINTS.machineWritePlcValue, payload, config);
    return data;
  },
  remove: async (id) => {
    await apiClient.delete(`${ENDPOINTS.machines}/${id}`);
  },
};

export const plcConfigApi = {
  listRanges: async () => {
    const { data } = await apiClient.get(ENDPOINTS.plcConfig.ranges);
    return data;
  },
  createRange: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.plcConfig.ranges, payload);
    return data;
  },
  updateRange: async (id, payload) => {
    const { data } = await apiClient.put(`${ENDPOINTS.plcConfig.ranges}/${id}`, payload);
    return data;
  },
  deleteRange: async (id) => {
    await apiClient.delete(`${ENDPOINTS.plcConfig.ranges}/${id}`);
  },
  rangeRegisters: async (rangeId, params = {}) => {
    const { data } = await apiClient.get(ENDPOINTS.plcConfig.rangeRegisters(rangeId), { params });
    return data;
  },
  exportPlan: async () => {
    const { data } = await apiClient.get(ENDPOINTS.plcConfig.export, { responseType: "blob" });
    return data;
  },
  // Endpoint APIs
  listEndpoints: async () => {
    const { data } = await apiClient.get(ENDPOINTS.plcConfig.endpoints);
    return data;
  },
  createEndpoint: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.plcConfig.endpoints, payload);
    return data;
  },
  updateEndpoint: async (id, payload) => {
    const { data } = await apiClient.put(`${ENDPOINTS.plcConfig.endpoints}/${id}`, payload);
    return data;
  },
  deleteEndpoint: async (id) => {
    await apiClient.delete(`${ENDPOINTS.plcConfig.endpoints}/${id}`);
  },
  testEndpoint: async (id) => {
    const { data } = await apiClient.post(ENDPOINTS.plcConfig.endpointTest(id));
    return data;
  },
};

export const scannerApi = {
  list: async () => {
    const { data } = await apiClient.get(ENDPOINTS.scanners);
    return data;
  },
  listConnections: async () => {
    const { data } = await apiClient.get(ENDPOINTS.scannerConnections);
    return data;
  },
  testRead: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.scannerTestRead, payload, { timeout: 30000 });
    return data;
  },
  testConnection: async (id) => {
    const { data } = await apiClient.post(ENDPOINTS.scannerTestConnection(id), {}, { timeout: 30000 });
    return data;
  },
  markUsbActivity: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.scannerUsbActivity, payload);
    return data;
  },
  create: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.scanners, payload);
    return data;
  },
  update: async (id, payload) => {
    const { data } = await apiClient.put(`${ENDPOINTS.scanners}/${id}`, payload);
    return data;
  },
  remove: async (id) => {
    await apiClient.delete(`${ENDPOINTS.scanners}/${id}`);
  },
};

export const userApi = {
  list: async () => {
    const { data } = await apiClient.get(ENDPOINTS.users);
    return data;
  },
  create: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.users, payload);
    return data;
  },
  update: async (id, payload) => {
    const { data } = await apiClient.put(`${ENDPOINTS.users}/${id}`, payload);
    return data;
  },
  remove: async (id) => {
    await apiClient.delete(`${ENDPOINTS.users}/${id}`);
  },
};

export const shiftApi = {
  list: async () => {
    const { data } = await apiClient.get(ENDPOINTS.shifts);
    return data;
  },
  create: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.shifts, payload);
    return data;
  },
  update: async (id, payload) => {
    const { data } = await apiClient.put(`${ENDPOINTS.shifts}/${id}`, payload);
    return data;
  },
  remove: async (id) => {
    await apiClient.delete(`${ENDPOINTS.shifts}/${id}`);
  },
};

export const stationSettingsApi = {
  list: async () => {
    const { data } = await apiClient.get(ENDPOINTS.stationSettings);
    return data;
  },
  save: async (settings) => {
    const { data } = await apiClient.put(ENDPOINTS.stationSettings, { settings });
    return data;
  },
};

export const roleAccessApi = {
  list: async () => {
    const { data } = await apiClient.get(ENDPOINTS.roleAccessSettings);
    return data;
  },
  save: async (settings) => {
    const { data } = await apiClient.put(ENDPOINTS.roleAccessSettings, { settings });
    return data;
  },
};

export const traceabilityApi = {
  operations: async () => {
    const { data } = await apiClient.get(ENDPOINTS.traceability.operations);
    return data;
  },
  processFlow: async (params) => {
    const { data } = await apiClient.get(ENDPOINTS.traceability.processFlow, { params });
    return data;
  },
  partCatalog: async (params) => {
    const { data } = await apiClient.get(ENDPOINTS.traceability.parts, { params });
    return data;
  },
  historyByPart: async (partId) => {
    const { data } = await apiClient.get(ENDPOINTS.traceability.byPart(partId));
    return data;
  },
  journeyByPart: async (partId) => {
    const { data } = await apiClient.get(ENDPOINTS.traceability.journeyByPart(partId));
    return data;
  },
  liveState: async (machineId) => {
    const { data } = await apiClient.get(ENDPOINTS.traceability.liveState, { params: { machineId } });
    return data;
  },
  ioSnapshot: async ({ machineId, plcIp, force } = {}, config = {}) => {
    const params = {};
    if (machineId) {
      params.machineId = machineId;
    }
    if (plcIp) {
      params.plcIp = plcIp;
    }
    if (force) {
      params.force = 1;
    }
    const { data } = await apiClient.get(ENDPOINTS.traceability.ioSnapshot, {
      params,
      timeout: 30000,
      ...config,
    });
    return data;
  },
  machineStats: async (machineId, params = {}) => {
    const { data } = await apiClient.get(ENDPOINTS.traceability.machineStats, {
      params: { ...params, machineId },
    });
    return data;
  },
  plcHealth: async (machineId) => {
    const { data } = await apiClient.get(ENDPOINTS.traceability.plcHealth, {
      params: machineId ? { machineId } : undefined,
    });
    return data;
  },
  scannerHealth: async (machineId) => {
    const { data } = await apiClient.get(ENDPOINTS.traceability.scannerHealth, {
      params: machineId ? { machineId } : undefined,
    });
    return data;
  },
  process: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.process, payload);
    return data;
  },
  verify: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.verify, payload, {
      timeout: 8000,
    });
    return data;
  },
  mapCustomerQr: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.mapCustomerQr, payload, {
      timeout: 10000,
    });
    return data;
  },
  plcStart: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.plcStart, payload);
    return data;
  },
  plcEnd: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.plcEnd, payload);
    return data;
  },
  rework: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.rework, payload);
    return data;
  },
  resetInterlock: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.resetInterlock, payload);
    return data;
  },
  resetStation: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.resetStation, payload);
    return data;
  },
  resetOperation: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.resetOperation, payload);
    return data;
  },
  resetPlcOnly: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.resetPlcOnly, payload);
    return data;
  },
  deletePart: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.deletePart, payload);
    return data;
  },
  bypass: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.bypass, payload);
    return data;
  },
  submitManualResult: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.submitManualResult, payload);
    return data;
  },
  testPlcCycle: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.testPlcCycle, payload);
    return data;
  },
};

export const dashboardApi = {
  oee: async (config = {}) => {
    const { data } = await apiClient.get(ENDPOINTS.dashboard.oee, config);
    return data;
  },
  summary: async (params, config = {}) => {
    const { data } = await apiClient.get(ENDPOINTS.dashboard.summary, { ...config, params });
    return data;
  },
  trends: async (params) => {
    const { data } = await apiClient.get(ENDPOINTS.dashboard.trends, { params });
    return data;
  },
  report: async (params, config = {}) => {
    const { data } = await apiClient.get(ENDPOINTS.dashboard.report, { ...config, params });
    return data;
  },
  exportReport: async (params) => {
    const { data } = await apiClient.post(ENDPOINTS.dashboard.exportFullReport, {
      filters: params || {},
      reportConfig: loadReportConfig(),
    }, {
      responseType: "blob",
    });
    return data;
  },
  exportFullReport: async (params) => {
    const { data } = await apiClient.post(ENDPOINTS.dashboard.exportFullReport, {
      filters: params || {},
      reportConfig: loadReportConfig(),
    }, {
      responseType: "blob",
    });
    return data;
  },
  exportPartsReport: async (params) => {
    const { data } = await apiClient.post(ENDPOINTS.dashboard.exportPartsReport, {
      filters: params || {},
      reportConfig: loadReportConfig(),
    }, {
      responseType: "blob",
    });
    return data;
  },
  exportAuditReport: async (params) => {
    const { data } = await apiClient.post(ENDPOINTS.dashboard.exportAuditReport, {
      filters: params || {},
      reportConfig: loadReportConfig(),
    }, {
      responseType: "blob",
    });
    return data;
  },
};

export const qrFormatApi = {
  list: async () => {
    const { data } = await apiClient.get(ENDPOINTS.qrFormatRules);
    return data;
  },
  create: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.qrFormatRules, payload);
    return data;
  },
  update: async (id, payload) => {
    const { data } = await apiClient.put(`${ENDPOINTS.qrFormatRules}/${id}`, payload);
    return data;
  },
  remove: async (id) => {
    await apiClient.delete(`${ENDPOINTS.qrFormatRules}/${id}`);
  },
};

function isNotFoundError(error) {
  return Number(error?.response?.status || 0) === 404;
}

export const packingApi = {
  overview: async () => {
    const { data } = await apiClient.get(ENDPOINTS.packing.overview);
    return data;
  },
  startBox: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.packing.startBox, payload);
    return data;
  },
  scan: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.packing.scan, payload);
    return data;
  },
  boxByNumber: async (boxNumber) => {
    const { data } = await apiClient.get(ENDPOINTS.packing.boxByNumber(boxNumber));
    return data;
  },
  updateBox: async (sessionId, payload) => {
    const { data } = await apiClient.put(ENDPOINTS.packing.updateBox(sessionId), payload);
    return data;
  },
  deleteBox: async (sessionId) => {
    const { data } = await apiClient.delete(ENDPOINTS.packing.deleteBox(sessionId));
    return data;
  },
  managementSettings: async () => {
    try {
      const { data } = await apiClient.get(ENDPOINTS.packing.managementSettings);
      return data;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      const { data } = await apiClient.get(ENDPOINTS.packing.managementSettingsLegacy);
      return data;
    }
  },
  updateManagementSettings: async (payload) => {
    try {
      const { data } = await apiClient.put(ENDPOINTS.packing.managementSettings, payload);
      return data;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      const { data } = await apiClient.put(ENDPOINTS.packing.managementSettingsLegacy, payload);
      return data;
    }
  },
  managementBoxes: async (params = {}) => {
    try {
      const { data } = await apiClient.get(ENDPOINTS.packing.managementBoxes, { params });
      return data;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      const { data } = await apiClient.get(ENDPOINTS.packing.managementBoxesLegacy, { params });
      return data;
    }
  },
  generateNext: async () => {
    try {
      const { data } = await apiClient.post(ENDPOINTS.packing.generateNext);
      return data;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      const { data } = await apiClient.post(ENDPOINTS.packing.generateNextLegacy);
      return data;
    }
  },
};

export const alarmApi = {
  list: async () => {
    try {
      const { data } = await apiClient.get(ENDPOINTS.alarms.base, { timeout: 5000 });
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.data)) return data.data;
      return [];
    } catch (_error) {
      return [];
    }
  },
  resolve: async (id) => {
    const { data } = await apiClient.patch(ENDPOINTS.alarms.resolve(id));
    return data;
  },
  resolveAll: async () => {
    const { data } = await apiClient.post(ENDPOINTS.alarms.resolveAll);
    return data;
  },
};

export const industrialApi = {
  health: async () => {
    const { data } = await apiClient.get(ENDPOINTS.industrial.health);
    return data;
  },
  metrics: async () => {
    const { data } = await apiClient.get(ENDPOINTS.industrial.metrics);
    return data;
  },
  watchdog: async () => {
    const { data } = await apiClient.get(ENDPOINTS.industrial.watchdog);
    return data;
  },
  sockets: async () => {
    const { data } = await apiClient.get(ENDPOINTS.industrial.sockets);
    return data;
  },
  queues: async () => {
    const { data } = await apiClient.get(ENDPOINTS.industrial.queues);
    return data;
  },
  timelineByOperation: async (operationId) => {
    const { data } = await apiClient.get(ENDPOINTS.industrial.timelineByOperation(operationId));
    return data;
  },
  queryTimelines: async (params = {}) => {
    const { data } = await apiClient.get(ENDPOINTS.industrial.timelines, { params });
    return data;
  },
};

function normalizeReportFilters(params = {}) {
  const source = params && typeof params === "object" ? params : {};
  const out = { ...source };
  const shiftToken = String(out.shiftCode || "").trim();
  if (!shiftToken || ["ALL", "ANY", "ALL_SHIFTS", "ALL SHIFT", "ALL SHIFTS"].includes(shiftToken.toUpperCase())) {
    delete out.shiftCode;
  } else {
    out.shiftCode = shiftToken;
  }
  const partSearch = String(out.partId || out.barcode || "").trim();
  if (partSearch) {
    out.partId = partSearch;
    out.barcode = partSearch;
  }
  return out;
}

export const reportApi = {
  getData: async (params) => {
    const cleanParams = normalizeReportFilters(params);
    const { data } = await apiClient.get(ENDPOINTS.reports.data, { params: cleanParams });
    return data;
  },
  exportFull: async (params, reportConfig) => {
    const cleanParams = normalizeReportFilters(params);
    const { data } = await apiClient.post(ENDPOINTS.reports.exportFull, {
      filters: cleanParams,
      reportConfig: reportConfig || loadReportConfig(),
    }, {
      responseType: "blob",
    });
    return data;
  },
  exportNG: async (params, reportConfig) => {
    const cleanParams = normalizeReportFilters(params);
    const { data } = await apiClient.post(ENDPOINTS.reports.exportNG, {
      filters: cleanParams,
      reportConfig: reportConfig || loadReportConfig(),
    }, {
      responseType: "blob",
    });
    return data;
  },
  exportParts: async (params, reportConfig) => {
    const cleanParams = normalizeReportFilters(params);
    const { data } = await apiClient.post(ENDPOINTS.reports.exportParts, {
      filters: cleanParams,
      reportConfig: reportConfig || loadReportConfig(),
    }, {
      responseType: "blob",
    });
    return data;
  },
  exportAudit: async (params, reportConfig) => {
    const cleanParams = normalizeReportFilters(params);
    const { data } = await apiClient.post(ENDPOINTS.reports.exportAudit, {
      filters: cleanParams,
      reportConfig: reportConfig || loadReportConfig(),
    }, {
      responseType: "blob",
    });
    return data;
  },
};
