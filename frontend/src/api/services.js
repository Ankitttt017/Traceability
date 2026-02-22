import apiClient from "./client";
import { ENDPOINTS } from "./endpoints";

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
  list: async () => {
    const { data } = await apiClient.get(ENDPOINTS.machines);
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
  remove: async (id) => {
    await apiClient.delete(`${ENDPOINTS.machines}/${id}`);
  },
};

export const scannerApi = {
  list: async () => {
    const { data } = await apiClient.get(ENDPOINTS.scanners);
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

export const traceabilityApi = {
  operations: async () => {
    const { data } = await apiClient.get(ENDPOINTS.traceability.operations);
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
  machineStats: async (machineId, params = {}) => {
    const { data } = await apiClient.get(ENDPOINTS.traceability.machineStats, {
      params: { ...params, machineId },
    });
    return data;
  },
  process: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.process, payload);
    return data;
  },
  verify: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.verify, payload);
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
  bypass: async (payload) => {
    const { data } = await apiClient.post(ENDPOINTS.traceability.bypass, payload);
    return data;
  },
};

export const dashboardApi = {
  summary: async (params) => {
    const { data } = await apiClient.get(ENDPOINTS.dashboard.summary, { params });
    return data;
  },
  trends: async (params) => {
    const { data } = await apiClient.get(ENDPOINTS.dashboard.trends, { params });
    return data;
  },
  report: async (params) => {
    const { data } = await apiClient.get(ENDPOINTS.dashboard.report, { params });
    return data;
  },
  exportReport: async (params) => {
    const { data } = await apiClient.get(ENDPOINTS.dashboard.exportReport, {
      params,
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
};
