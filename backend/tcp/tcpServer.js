const net = require("net");
const scannerConnectionService = require("../services/scannerConnectionService");
const { markScannerHeartbeat } = require("../services/scannerHealthService");
const Scanner = require("../models/Scanner");
const Machine = require("../models/Machine");
const { saveScan } = require("../services/scanService");
const { emitRealtime } = require("../services/realtimeService");

async function processIncomingScannerPayload({ scannerIp, payload }) {
  const partId = String(payload || "").trim();
  if (!partId) return;

  const scanner = await Scanner.findOne({
    where: { scanner_ip: scannerIp, is_active: true },
    order: [["updatedAt", "DESC"]],
  });
  if (!scanner) {
    const msg = `No active scanner mapping found for IP ${scannerIp}.`;
    console.warn(`[TCP] ${msg} Payload ignored: ${partId}`);
    emitRealtime("operator_popup", {
      type: "ERROR",
      partId,
      stationNo: null,
      machineId: null,
      machineName: null,
      scannerIp,
      qrStatus: "FAILED",
      operationStatus: "BLOCKED",
      status: "BLOCKED",
      plcStatus: "BLOCKED",
      reason: "SCANNER_NOT_MAPPED",
      message: msg,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const machine = await Machine.findByPk(scanner.mapped_machine_id);
  if (!machine || machine.is_active === false) {
    const msg = `Scanner ${scanner.id} mapped machine is missing/inactive.`;
    console.warn(`[TCP] ${msg} Payload ignored: ${partId}`);
    emitRealtime("operator_popup", {
      type: "ERROR",
      partId,
      stationNo: null,
      machineId: scanner.mapped_machine_id || null,
      machineName: null,
      scannerIp,
      qrStatus: "FAILED",
      operationStatus: "BLOCKED",
      status: "BLOCKED",
      plcStatus: "BLOCKED",
      reason: "MACHINE_INACTIVE",
      message: msg,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const stationNo = String(machine.operation_no || "").trim().toUpperCase();
  if (!stationNo) {
    const msg = `Machine ${machine.id} has no operation/station mapping.`;
    console.warn(`[TCP] ${msg} Payload ignored: ${partId}`);
    emitRealtime("operator_popup", {
      type: "ERROR",
      partId,
      stationNo: null,
      machineId: machine.id,
      machineName: machine.machine_name,
      scannerIp,
      qrStatus: "FAILED",
      operationStatus: "BLOCKED",
      status: "BLOCKED",
      plcStatus: "BLOCKED",
      reason: "STATION_NOT_CONFIGURED",
      message: msg,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  console.log(`[TCP] Routing payload to scanner=${scanner.id} machine=${machine.id} station=${stationNo} partId=${partId}`);
  const response = await saveScan(partId, stationNo, "OK", machine.id, null, {
    resultSource: "TCP_PUSH_SCANNER",
    resultInput: "OK",
  });

  emitRealtime("scan_event", {
    sourceEvent: "scan_event",
    partId,
    stationNo,
    machineId: machine.id,
    machineName: machine.machine_name,
    scannerIp,
    decision: response?.decision || "BLOCK",
    reason: response?.reason || null,
    status: response?.decision === "ALLOW" ? "SCANNED" : "BLOCKED",
    qrStatus: response?.qrStatus || (response?.decision === "ALLOW" ? "PASSED" : "FAILED"),
    operationStatus: response?.operationStatus || (response?.decision === "ALLOW" ? "WAITING" : "BLOCKED"),
    message: response?.message || "",
    timestamp: new Date().toISOString(),
  });

  console.log(
    `[TCP] Scan decision machine=${machine.id} station=${stationNo} partId=${partId} decision=${response?.decision || "BLOCK"} reason=${response?.reason || "NA"}`
  );
  emitRealtime("operator_popup", {
    type: response?.decision === "ALLOW" ? "INFO" : "ERROR",
    partId,
    stationNo,
    machineId: machine.id,
    machineName: machine.machine_name,
    scannerIp,
    qrStatus: response?.qrStatus || (response?.decision === "ALLOW" ? "PASSED" : "FAILED"),
    operationStatus: response?.operationStatus || (response?.decision === "ALLOW" ? "WAITING" : "BLOCKED"),
    status: response?.decision === "ALLOW" ? "SCANNED" : "BLOCKED",
    plcStatus: response?.decision === "ALLOW" ? "WAITING_PLC" : "BLOCKED",
    reason: response?.reason || null,
    message: response?.message || "",
    timestamp: new Date().toISOString(),
  });
}

let tcpServer = null;
let running = false;

function getTcpPort() {
  const parsed = Number(process.env.TCP_SERVER_PORT || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function startTcpServer() {
  if (running) {
    return;
  }

  const port = getTcpPort();
  if (!port) {
    console.log("[TCP] TCP server disabled (set TCP_SERVER_PORT to enable).");
    running = true;
    return;
  }

  tcpServer = net.createServer((socket) => {
    const remoteIp = String(socket.remoteAddress || "").replace(/^::ffff:/, "");
    console.log(`[TCP] Client connected: ${remoteIp}:${socket.remotePort || "-"}`);
    scannerConnectionService.markScannerConnected({ scannerIp: remoteIp });

    let pending = "";
    let flushTimer = null;

    const clearFlushTimer = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    };

    const consumeMessage = (raw) => {
      const data = String(raw || "").trim();
      if (!data) return;
      console.log(`[TCP] Received from ${remoteIp}: ${data}`);
      scannerConnectionService.markScannerData({ scannerIp: remoteIp });
      markScannerHeartbeat({ scannerIp: remoteIp });
      processIncomingScannerPayload({ scannerIp: remoteIp, payload: data }).catch((error) => {
        console.error(`[TCP] Scanner payload processing failed (${remoteIp}): ${error.message}`);
      });
    };

    const schedulePendingFlush = () => {
      clearFlushTimer();
      flushTimer = setTimeout(() => {
        if (pending.trim()) {
          consumeMessage(pending);
          pending = "";
        }
      }, 250);
    };

    socket.on("data", (buffer) => {
      const chunk = buffer.toString("utf8");
      console.log(`[TCP] Raw chunk from ${remoteIp}: ${JSON.stringify(chunk)}`);
      pending += chunk;

      const parts = pending.split(/\r?\n|\0/);
      pending = parts.pop() || "";

      for (const raw of parts) {
        consumeMessage(raw);
      }
      schedulePendingFlush();
    });

    socket.on("close", () => {
      clearFlushTimer();
      if (pending.trim()) {
        consumeMessage(pending);
      }
      scannerConnectionService.markScannerDisconnected({ scannerIp: remoteIp });
      console.log(`[TCP] Client disconnected: ${remoteIp}`);
    });

    socket.on("error", (error) => {
      clearFlushTimer();
      console.error("[TCP] Client socket error:", error.message);
    });
  });

  tcpServer.on("error", (error) => {
    console.error("[TCP] Server error:", error.message);
  });

  tcpServer.listen(port, () => {
    console.log(`[TCP] Server listening on port ${port}`);
  });

  running = true;
}

function shutdownTcpServer() {
  return new Promise((resolve) => {
    if (!tcpServer) {
      running = false;
      resolve();
      return;
    }

    tcpServer.close(() => {
      running = false;
      tcpServer = null;
      resolve();
    });
  });
}

module.exports = {
  startTcpServer,
  shutdownTcpServer,
};
