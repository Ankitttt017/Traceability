const { Op } = require("sequelize");
const ProductionReport = require("../../models/ProductionReport");
const reportController = require("../../controllers/reportController");
const { normalizeResult } = require("./reportMetricsService");

// Use exported private methods to ensure 100% logic parity with the live UI
const { getLegacyReportBundle, formatCleanReportResponse, paginateReportRowsByPart } = reportController._private;

/**
 * Syncs a specific date range of production data into the Master Table.
 * @param {Date} dateFrom - Start of range
 * @param {Date} dateTo - End of range
 */
async function syncDateRange(dateFrom, dateTo) {
  // console.log(`[HistoricalSync] Starting sync for range: ${dateFrom.toISOString()} to ${dateTo.toISOString()}`);
  
  const filters = {
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
    fast: false, // Ensure full processing
  };

  try {
    // 1. Fetch raw data exactly as the UI would
    const { rows, shifts, plcColumnSet, metrics } = await getLegacyReportBundle(filters, {
      includePlcReadings: true,
      includeLeaktest: true,
      includePlcSummary: true,
      maxAnchorParts: null,
      maxBaseLogs: null,
    });

    if (!rows || rows.length === 0) {
      console.log(`[HistoricalSync] No rows found for range.`);
      return;
    }

    // 2. Paginate to group them by part (fetch all at once for the sync chunk)
    const paginationParams = { page: 1, pageSize: 1000000 };
    const paged = paginateReportRowsByPart(rows, paginationParams);

    // 3. Format exactly as the UI receives it
    const payload = {
      rows: paged.rows,
      metrics: metrics,
      pagination: paged.pagination,
      plcColumns: [...plcColumnSet],
      reportMode: "FULL",
      availableShifts: shifts.map((shift) => ({
        id: shift.id,
        shiftName: shift.shift_name,
        shiftCode: shift.shift_code,
        startTime: shift.start_time,
        endTime: shift.end_time,
      })),
    };
    
    // Group the raw OperationLog rows by part
    const grouped = new Map();
    for (const row of paged.rows) {
       const key = String(row.__reportPageGroupKey || row.traceabilityPartId || row.partId || row.barcode || `row_${Math.random()}`).trim();
       if (!grouped.has(key)) grouped.set(key, []);
       grouped.get(key).push(row);
    }

    // Create exactly one Master record per part, and store the raw rows in `raw_logs` so the UI logic works perfectly
    const bulkRecords = Array.from(grouped.values()).map(entries => {
      // 1. Deduplicate entries by log ID so First Scan doesn't show multiple times
      const uniqueEntriesMap = new Map();
      entries.forEach(entry => {
        if (entry.id) uniqueEntriesMap.set(entry.id, entry);
        else uniqueEntriesMap.set(JSON.stringify(entry), entry);
      });
      const uniqueEntries = Array.from(uniqueEntriesMap.values());

      const first = uniqueEntries[0] || {};
      const last = uniqueEntries[uniqueEntries.length - 1] || {};
      const plcData = first.plcReadings || first.plcReading || first.plc_data || {};
      const leakData = first.leakTestReadings || first.leakTestReading || first.leak_data || null;
      
      const partKey = String(first.__reportPageGroupKey || first.traceabilityPartId || first.partId || first.barcode).trim();

      // 2. Extract station keys for extremely fast SQL filtering
      const stationKeysSet = new Set();
      uniqueEntries.forEach(row => {
        if (row.operationNo) stationKeysSet.add(row.operationNo.toUpperCase());
        if (row.stationNo) stationKeysSet.add(row.stationNo.toUpperCase());
        if (row.machineId) stationKeysSet.add(String(row.machineId));
      });
      const stationKeys = Array.from(stationKeysSet).filter(Boolean).join(",");

      // 3. Perfect Overall Status (If Final Status is PASSED, it counts as PASSED regardless of intermediate rework)
      let overallStatus = "IN_PROGRESS";
      let hasNg = false;
      let hasFinalOk = false;

      for (const row of uniqueEntries) {
        const rowStatusRaw = row.industrialResult || row.statusLabel || row.result || row.plc_status || "";
        const rowStatus = normalizeResult(rowStatusRaw, row.reason || row.interlock_reason, row);
        
        if (rowStatus === "NG") {
          hasNg = true;
        }
        
        const op = String(row.operationNo || row.stationNo || row.operation_no || row.station_no || "").trim().toUpperCase();
        if (rowStatus === "OK" && (op === "OP160" || op === "OP150" || row.isFinalInspection === true)) {
          hasFinalOk = true;
        }
      }

      if (hasNg) {
        overallStatus = "NG";
      } else if (hasFinalOk) {
        overallStatus = "PASSED";
      } else {
        overallStatus = "IN_PROGRESS";
      }

      // `uniqueEntries` are ordered DESC by createdAt (newest first).
      // So `first` (index 0) is the newest log, `last` (index length-1) is the oldest log.
      let firstScan = last.createdAt || first.createdAt || null;
      let finalScan = first.createdAt || last.createdAt || null;

      // Map Stations
      const opStatuses = {
        op100_status: null, op110_status: null, op120_status: null, op130_status: null,
        op140_status: null, op150_status: null, op160_status: null
      };
      for (const row of uniqueEntries) {
        const rowStatusRaw = row.industrialResult || row.statusLabel || row.result || row.plc_status || "";
        const rowStatus = normalizeResult(rowStatusRaw, row.reason || row.interlock_reason, row);
        const op = String(row.operationNo || row.stationNo || row.operation_no || row.station_no || "").trim().toUpperCase();
        if (op === "OP100") opStatuses.op100_status = rowStatus;
        if (op === "OP110") opStatuses.op110_status = rowStatus;
        if (op === "OP120") opStatuses.op120_status = rowStatus;
        if (op === "OP130") opStatuses.op130_status = rowStatus;
        if (op === "OP140") opStatuses.op140_status = rowStatus;
        if (op === "OP150") opStatuses.op150_status = rowStatus;
        if (op === "OP160") opStatuses.op160_status = rowStatus;
      }

      const pData = plcData || {};
      const lData = leakData && Array.isArray(leakData) && leakData.length > 0 ? leakData[0] : (leakData || {});

      return {
        part_id: partKey,
        customer_qr: String(first.customerCode || first.customerQr || pData.customerCode || "").trim(),
        part_name: String(first.partName || pData.partName || "").trim(),
        die_name: String(first.dieName || pData.dieName || "").trim(),
        machine_name: String(first.machineName || pData.machine_name || "").trim(),
        shift_code: String(first.shiftCode || "").trim(),
        overall_status: overallStatus,
        first_scan_at: firstScan ? new Date(firstScan) : null,
        final_scan_at: finalScan ? new Date(finalScan) : null,
        ng_reason: String(last.reason || last.interlock_reason || "").trim(),
        rejection_category: String(last.rejectionCategory || "").trim(),
        rejection_reason: String(last.rejectionReason || "").trim(),
        cycle_time: String(last.cycleTimeValue || pData.cycle_time || lData.Cycle_Time || "").trim(),
        station_keys: stationKeys,
        station_data: {},
        plc_data: pData,
        leak_data: lData,
        raw_logs: JSON.stringify(uniqueEntries), // Clean, deduplicated JSON array
        ...opStatuses,
        shot_number: pData.shot_number || null,
        plc_cycle_time: pData.cycle_time || null,
        die_close_core_in_time: pData.die_close_core_in_time || null,
        pouring_time: pData.pouring_time || null,
        shot_fwd_time: pData.shot_fwd_time || null,
        curing_time: pData.curing_time || null,
        die_open_core_out_time: pData.die_open_core_out_time || null,
        ejector_time: pData.ejector_time || null,
        extract_time: pData.extract_time || null,
        spray_time: pData.spray_time || null,
        v1_speed: pData.v1_speed || null,
        v2_speed: pData.v2_speed || null,
        v3_speed: pData.v3_speed || null,
        v4_speed: pData.v4_speed || null,
        metal_pressure: pData.metal_pressure || null,
        furnace_metal_temp: pData.furnace_metal_temp || null,
        cooling_water_mov: pData.cooling_water_mov || null,
        cooling_water_sta: pData.cooling_water_sta || null,
        accel_point: pData.accel_point || null,
        deaccel_point: pData.deaccel_point || null,
        intensification_time: pData.intensification_time || null,
        biscuit_thickness: pData.biscuit_thickness || null,
        jet_cooling_pressure: pData.jet_cooling_pressure || null,
        clamp_tonnage_he_low_pct: pData.clamp_tonnage_he_low_pct || null,
        clamp_tonnage_he_low_mn: pData.clamp_tonnage_he_low_mn || null,
        clamp_tonnage_op_up_pct: pData.clamp_tonnage_op_up_pct || null,
        clamp_tonnage_op_low_pct: pData.clamp_tonnage_op_low_pct || null,
        clamp_tonnage_he_up_pct: pData.clamp_tonnage_he_up_pct || null,
        vacuum_pressure: pData.vacuum_pressure || null,
        clamp_force_pct: pData.clamp_force_pct || null,
        clamp_tonnage: pData.clamp_tonnage || null,
        shot_acc_pressure: pData.shot_acc_pressure || null,
        intensification_acc_pressure: pData.intensification_acc_pressure || null,
        fixed_die_temp_f1: pData.fixed_die_temp_f1 || null,
        fixed_die_temp_f2: pData.fixed_die_temp_f2 || null,
        moving_die_temp_m1: pData.moving_die_temp_m1 || null,
        moving_die_temp_m2: pData.moving_die_temp_m2 || null,
        slide_temp_s1: pData.slide_temp_s1 || null,
        fix_1_flow: pData.fix_1_flow || null,
        fix_2_flow: pData.fix_2_flow || null,
        fix_3_flow: pData.fix_3_flow || null,
        mov_1_flow: pData.mov_1_flow || null,
        mov_2_flow: pData.mov_2_flow || null,
        mov_3_flow: pData.mov_3_flow || null,
        vacuum_pressure_mmhg: pData.vacuum_pressure_mmhg || null,
        average_die_clamp_tonnage_count: pData.average_die_clamp_tonnage_count || null,
        time_for_stroke: pData.time_for_stroke || null,
        stroke: pData.stroke || null,
        shot_status: pData.shot_status || null,
        leak_body_leak_value: lData.Body_Leak_Value || null,
        leak_gall_1: lData.Gall_1 || null,
        leak_gall_2: lData.Gall_2 || null,
        leak_cycle_time: lData.Cycle_Time || null,
        leak_running_mode: lData.Running_Mode || null,
        leak_dry_wey_both: lData.Dry_Wey_Both || lData["Dry/Wey"] || null,
      };
    });

    // We filter out any rows without a part_id or first_scan_at
    const validRecords = bulkRecords.filter(r => r.part_id && r.first_scan_at && !Number.isNaN(r.first_scan_at.getTime()));

    // 5. Upsert into database
    if (validRecords.length > 0) {
      const partIds = validRecords.map(r => r.part_id);
      
      // Process in batches of 500 to avoid MSSQL parameter limits
      const BATCH_SIZE = 500;
      for (let i = 0; i < partIds.length; i += BATCH_SIZE) {
        const batchPartIds = partIds.slice(i, i + BATCH_SIZE);
        const batchRecords = validRecords.slice(i, i + BATCH_SIZE);

        await ProductionReport.destroy({ 
          where: { part_id: { [Op.in]: batchPartIds } } 
        });

        await ProductionReport.bulkCreate(batchRecords);
      }
      // console.log(`[HistoricalSync] Upserted ${validRecords.length} records in batches.`);
    }

  } catch (error) {
    console.error(`[HistoricalSync] Error syncing range ${dateFrom} - ${dateTo}:`, error);
  }
}

module.exports = {
  syncDateRange
};
