const net = require("net");
const Scanner = require("../models/Scanner");
const Machine = require("../models/Machine");
const Part = require("../models/Part");
const OperationLog = require("../models/OperationLog");
const ProductionLog = require("../models/ProductionLog");
const { saveScan } = require("../services/scanService");
const { executePlcHandshake } = require("../services/plcSocketService");
const { emitRealtime } = require("../services/realtimeService");
const { markScannerHeartbeat } = require("../services/scannerHealthService");
const { packPart, createSessionIfMissing } = require("../services/packingService");
const { tryAcquireMachineLock, clearMachineLock } = require("../services/machineLockService");

const tcpPort = Number(process.env.TCP_PORT || 5000);

function normalizeIp(ip) {
  return String(ip || "").replace("::ffff:", "").trim();
}

function normalizeStation(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getMachineOperationStage(machine) {
  return normalizeStation(machine?.operation_no);
}

function uniqueStages(stages) {
  const seen = new Set();
  const output = [];
  for (const stage of stages) {
    if (!stage || seen.has(stage)) {
      continue;
    }
    seen.add(stage);
    output.push(stage);
  }
  return output;
}

function parsePackingPayload(message) {
  const text = String(message || "").trim();
  if (!text) {
    return null;
  }

  const cleaned = text.replace(/^PACK\|?/i, "");
  const tokens = cleaned.split(/[|,;]/).map((token) => token.trim()).filter(Boolean);
  if (!tokens.length) {
    return null;
  }

  const keyValues = {};
  for (const token of tokens) {
    const [rawKey, ...rest] = token.split(/[:=]/);
    if (!rawKey || !rest.length) {
      continue;
    }
    keyValues[String(rawKey).trim().toUpperCase()] = rest.join(":").trim();
  }

  const boxNumber = keyValues.BOX || keyValues.BOXNO || keyValues.BOX_NUMBER;
  const partId = keyValues.PART || keyValues.PARTID || keyValues.PART_ID;
  const capacity = keyValues.CAPACITY || keyValues.CAP || keyValues.BOXCAP || keyValues.SLOTS;

  if (!boxNumber && !partId) {
    return null;
  }
  return { boxNumber, partId, capacity };
}

function mapScanDecisionToPopupType(scanResult) {
  if (scanResult.decision === "ALLOW") {
    return "INFO";
  }
  return "ERROR";
}

async function getActiveStationSequence() {
  const machines = await Machine.findAll({
    where: { is_active: true },
    order: [["sequence_no", "ASC"]],
  });
  return uniqueStages(machines.map((machine) => getMachineOperationStage(machine)));
}

async function markStart(operationLogId, machineId) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (!opLog) {
    return;
  }
  await opLog.update({
    plc_status: "STARTED",
    machine_id: machineId,
    plc_start_time: new Date(),
    plc_start_at: new Date(),
  });
}

async function markEndOk({ operationLogId, partId, stationNo, machineId }) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (opLog) {
    await opLog.update({
      plc_status: "ENDED_OK",
      machine_id: machineId,
      result: "OK",
      plc_end_time: new Date(),
      plc_end_at: new Date(),
    });
  }

  const part = await Part.findOne({ where: { part_id: partId } });
  if (part) {
    const sequence = await getActiveStationSequence();
    const isLastStation = sequence.length > 0 && normalizeStation(stationNo) === sequence[sequence.length - 1];
    part.current_station = normalizeStation(stationNo);
    part.current_operation = normalizeStation(stationNo);
    part.status = isLastStation ? "COMPLETED" : "IN_PROGRESS";
    part.is_interlocked = false;
    part.interlock_reason = null;
    part.is_rework = false;
    await part.save();
  }

  await ProductionLog.create({
    part_id: partId,
    machine_id: machineId,
    status: "OK",
    ng_reason: "PLC_END_OK",
  });
}

async function markEndNg({ operationLogId, partId, stationNo, machineId, reason }) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (opLog) {
    await opLog.update({
      plc_status: "ENDED_NG",
      machine_id: machineId,
      result: "NG",
      plc_end_time: new Date(),
      plc_end_at: new Date(),
      interlock_reason: reason || "PLC_END_NG",
    });
  }

  const part = await Part.findOne({ where: { part_id: partId } });
  if (part) {
    part.current_station = normalizeStation(stationNo);
    part.current_operation = normalizeStation(stationNo);
    part.status = "NG";
    part.is_interlocked = true;
    part.interlock_reason = reason || "PLC_END_NG_INTERLOCK";
    await part.save();
  }

  await ProductionLog.create({
    part_id: partId,
    machine_id: machineId,
    status: "NG",
    ng_reason: reason || "PLC_END_NG",
  });
}

async function markCommunicationError({ operationLogId, partId, stationNo, reason }) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (opLog) {
    await opLog.update({
      plc_status: "PLC_COMM_ERROR",
      interlock_reason: reason || "PLC_COMMUNICATION_FAILED",
      plc_end_time: new Date(),
      plc_end_at: new Date(),
    });
  }

  const part = await Part.findOne({ where: { part_id: partId } });
  if (part) {
    part.current_operation = normalizeStation(stationNo);
    part.status = part.is_rework ? "REWORK" : "IN_PROGRESS";
    part.is_interlocked = false;
    part.interlock_reason = reason || "PLC_COMMUNICATION_FAILED";
    await part.save();
  }
}

async function rollbackPendingOperation({ partId, operationLogId }) {
  if (operationLogId) {
    await OperationLog.destroy({ where: { id: operationLogId } });
  }

  const part = await Part.findOne({ where: { part_id: partId } });
  if (!part) {
    return;
  }

  part.current_operation = normalizeStation(part.current_station || null);
  if (!part.current_operation) {
    part.current_operation = null;
  }
  await part.save();
}

async function startPlcFlow({ operationLogId, partId, stationNo, machine }) {
  const plcIp = machine.plc_ip || machine.machine_ip;
  const plcPort = machine.plc_port || machine.machine_port;

  try {
    await executePlcHandshake({
      ip: plcIp,
      port: plcPort,
      partId,
      stationNo,
      machineId: machine.id,
      machine,
      onAckStart: async () => {
        await markStart(operationLogId, machine.id);
        emitRealtime("operator_popup", {
          type: "INFO",
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "STARTED",
          plcStatus: "STARTED",
          qrResult: "PASS",
          message: "PLC start acknowledged",
        });
      },
      onAckEndOk: async () => {
        await markEndOk({ operationLogId, partId, stationNo, machineId: machine.id });
        emitRealtime("operator_popup", {
          type: "SUCCESS",
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "ENDED_OK",
          plcStatus: "ENDED_OK",
          qrResult: "PASS",
          message: "Operation Passed",
        });
        emitRealtime("dashboard_refresh", { reason: "PLC_END_OK" });
      },
      onAckEndNg: async () => {
        await markEndNg({ operationLogId, partId, stationNo, machineId: machine.id, reason: "PLC_END_NG" });
        emitRealtime("operator_popup", {
          type: "ERROR",
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "ENDED_NG",
          plcStatus: "ENDED_NG",
          qrResult: "PASS",
          message: "Operation Failed (NG)",
        });
        emitRealtime("dashboard_refresh", { reason: "PLC_END_NG" });
      },
      onFailure: async (error) => {
        await markCommunicationError({
          operationLogId,
          partId,
          stationNo,
          reason: `PLC_TIMEOUT_${String(error.message || "").slice(0, 120)}`,
        });
        emitRealtime("operator_popup", {
          type: "WARNING",
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "PLC_COMM_ERROR",
          plcStatus: "PLC_COMM_ERROR",
          qrResult: "PASS",
          message: "PLC communication issue. Use Reset Operation, then scan again.",
        });
        emitRealtime("dashboard_refresh", { reason: "PLC_COMM_ERROR" });
      },
    });
  } finally {
    await clearMachineLock(machine.id);
  }
}

const server = net.createServer((socket) => {
  const scannerIp = normalizeIp(socket.remoteAddress);
  console.log("Scanner Connected:", scannerIp);
  markScannerHeartbeat({ scannerIp });

  socket.on("data", async (buffer) => {
    try {
      markScannerHeartbeat({ scannerIp });

      const rawMessage = String(buffer.toString() || "").trim();
      if (!rawMessage) {
        socket.write("BLOCK\n");
        emitRealtime("operator_popup", {
          type: "WARNING",
          message: "Empty scanner payload received",
          scannerIp,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const packingPayload = parsePackingPayload(rawMessage);
      if (packingPayload) {
        if (packingPayload.boxNumber && !packingPayload.partId) {
          await createSessionIfMissing(packingPayload.boxNumber, packingPayload.capacity);
          socket.write("BOX_READY\n");
          emitRealtime("operator_popup", {
            type: "INFO",
            message: `Packing box ${String(packingPayload.boxNumber).toUpperCase()} ready`,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        if (packingPayload.partId) {
          const packed = await packPart({
            boxNumber: packingPayload.boxNumber,
            partId: packingPayload.partId,
            capacity: packingPayload.capacity,
          });
          socket.write("PACK_OK\n");
          emitRealtime("operator_popup", {
            type: "SUCCESS",
            message: `Packed ${packingPayload.partId} in box ${packed.session.box_number} slot ${packed.item.slot_no}`,
            partId: packingPayload.partId,
            stationNo: "PACKING",
            timestamp: new Date().toISOString(),
          });
          return;
        }
      }

      const partId = rawMessage;

      const scanner = await Scanner.findOne({
        where: { scanner_ip: scannerIp, is_active: true },
      });
      if (!scanner) {
        console.log("Active scanner mapping not found for IP:", scannerIp);
        socket.write("BLOCK\n");
        emitRealtime("operator_popup", {
          type: "ERROR",
          message: "Scanner IP not mapped or inactive",
          scannerIp,
          status: "INTERLOCKED",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const machine = await Machine.findByPk(scanner.mapped_machine_id);
      if (!machine || !machine.is_active) {
        console.log("Mapped machine not available for scanner:", scannerIp);
        socket.write("BLOCK\n");
        emitRealtime("operator_popup", {
          type: "ERROR",
          message: "Mapped machine unavailable for scanner",
          scannerIp,
          scannerName: scanner.scanner_name,
          status: "INTERLOCKED",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      markScannerHeartbeat({
        scannerId: scanner.id,
        scannerIp: scanner.scanner_ip || scannerIp,
        scannerName: scanner.scanner_name,
        machineId: machine.id,
      });

      const stationNo = getMachineOperationStage(machine);
      const scanResult = await saveScan(partId, stationNo, "OK", machine.id);

      if (scanResult.decision === "ALLOW" && scanResult.operationLogId) {
        const lock = await tryAcquireMachineLock({
          machineId: machine.id,
          partId,
          stationNo,
        });
        if (!lock.acquired) {
          await rollbackPendingOperation({
            partId,
            operationLogId: scanResult.operationLogId,
          });
          scanResult.decision = "BLOCK";
          scanResult.reason = "MACHINE_RUNNING";
          scanResult.message = lock.runningPartId
            ? `Machine busy. Current part ${lock.runningPartId} is in operation.`
            : "Machine busy with another cycle. Retry after current operation completes.";
          scanResult.operationLogId = null;
          scanResult.currentStatus = "IN_PROGRESS";
        }
      }
      socket.write(`${scanResult.decision}\n`);

      emitRealtime("operator_popup", {
        type: mapScanDecisionToPopupType(scanResult),
        message: scanResult.message || scanResult.reason || "Scan processed",
        partId,
        stationNo,
        machineId: machine.id,
        machineName: machine.machine_name,
        scannerName: scanner.scanner_name,
        scannerIp,
        status: scanResult.decision === "ALLOW" ? "PENDING" : "WAIT",
        plcStatus: scanResult.decision === "ALLOW" ? "PENDING" : "WAIT",
        qrResult: scanResult.decision === "ALLOW" || scanResult.reason === "MACHINE_RUNNING" ? "PASS" : "FAIL",
        reason: scanResult.reason || null,
        expectedStation: scanResult.expectedStation || null,
        qrReason: scanResult.reason || null,
        timestamp: new Date().toISOString(),
      });

      if (scanResult.decision === "ALLOW" && scanResult.operationLogId) {
        startPlcFlow({
          operationLogId: scanResult.operationLogId,
          partId,
          stationNo,
          machine,
        }).catch((error) => {
          console.error("TCP PLC flow failed:", error.message);
        });
      }

      console.log(
        `Part: ${partId} | Station: ${stationNo} | Outcome: ${scanResult.decision} | Reason: ${scanResult.reason} | Status: ${scanResult.currentStatus}`
      );
    } catch (error) {
      console.error("TCP scan handling failed:", error.message);
      socket.write("BLOCK\n");
    }
  });
});

server.listen(tcpPort, () => {
  console.log(`TCP Server Running on Port ${tcpPort}`);
});
