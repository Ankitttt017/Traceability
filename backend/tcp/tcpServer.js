const net = require("net");
const Scanner = require("../models/Scanner");
const Machine = require("../models/Machine");
const Part = require("../models/Part");
const OperationLog = require("../models/OperationLog");
const ProductionLog = require("../models/ProductionLog");
const { saveScan } = require("../services/scanService");
const { executePlcHandshake } = require("../services/plcSocketService");
const { emitRealtime } = require("../services/realtimeService");
const { packPart, createSessionIfMissing } = require("../services/packingService");

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
  if (scanResult.reason === "SCAN_RESULT_NG") {
    return "ERROR";
  }
  return "WARNING";
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

async function markInterlock({ operationLogId, partId, stationNo, machineId, reason }) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (opLog) {
    await opLog.update({
      plc_status: "INTERLOCKED",
      interlock_reason: reason || "PLC_COMMUNICATION_FAILED",
      plc_end_time: new Date(),
      plc_end_at: new Date(),
    });
  }

  const part = await Part.findOne({ where: { part_id: partId } });
  if (part) {
    part.current_station = normalizeStation(stationNo);
    part.current_operation = normalizeStation(stationNo);
    part.status = "INTERLOCKED";
    part.is_interlocked = true;
    part.interlock_reason = reason || "PLC_COMMUNICATION_FAILED";
    await part.save();
  }

  await ProductionLog.create({
    part_id: partId,
    machine_id: machineId,
    status: "NG",
    ng_reason: reason || "PLC_COMMUNICATION_FAILED",
  });
}

async function startPlcFlow({ operationLogId, partId, stationNo, machine }) {
  const plcIp = machine.plc_ip || machine.machine_ip;
  const plcPort = machine.plc_port || machine.machine_port;

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
        message: "Operation Failed (NG)",
      });
      emitRealtime("dashboard_refresh", { reason: "PLC_END_NG" });
    },
    onFailure: async (error) => {
      await markInterlock({
        operationLogId,
        partId,
        stationNo,
        machineId: machine.id,
        reason: `PLC_TIMEOUT_${String(error.message || "").slice(0, 120)}`,
      });
      emitRealtime("operator_popup", {
        type: "WARNING",
        partId,
        stationNo,
        machineId: machine.id,
        machineName: machine.machine_name,
        status: "INTERLOCKED",
        message: "PLC timeout/interruption - part interlocked",
      });
      emitRealtime("dashboard_refresh", { reason: "PLC_FAILURE" });
    },
  });
}

const server = net.createServer((socket) => {
  const scannerIp = normalizeIp(socket.remoteAddress);
  console.log("Scanner Connected:", scannerIp);

  socket.on("data", async (buffer) => {
    try {
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

      const stationNo = getMachineOperationStage(machine);
      const scanResult = await saveScan(partId, stationNo, "OK", machine.id);
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
        status: scanResult.decision === "ALLOW" ? "PENDING" : "INTERLOCKED",
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
