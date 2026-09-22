const sequelize = require('../config/db');

async function test() {
  const start = Date.now();
  const rows = await sequelize.query(`
    SELECT TOP 10000
      pr.[id],
      CASE WHEN pr.[part_id] IS NOT NULL AND pr.[part_id] NOT LIKE 'R437%' AND pr.[part_id] <> '' THEN pr.[part_id] ELSE COALESCE(pr_cast.[part_id], pr.[part_id]) END as [part_id],
      pr.[customer_qr], pr.[part_name], pr.[die_name], pr.[machine_name], pr.[shift_code],
      pr.[overall_status], pr.[first_scan_at], pr.[final_scan_at], pr.[ng_reason], pr.[rejection_category],
      pr.[rejection_reason], 
      COALESCE(pr.[cycle_time], pr_cast.[cycle_time]) as [cycle_time], 
      pr.[createdAt], pr.[updatedAt],
      pr.[op100_status], pr.[op110_status], pr.[op120_status], pr.[op130_status], pr.[op140_status], pr.[op150_status], pr.[op160_status],
      COALESCE(pr.[shot_number], pr_cast.[shot_number]) as [shot_number], 
      COALESCE(pr.[plc_cycle_time], pr_cast.[plc_cycle_time]) as [plc_cycle_time],
      COALESCE(pr.[metal_pressure], pr_cast.[metal_pressure]) as [metal_pressure], 
      COALESCE(pr.[furnace_metal_temp], pr_cast.[furnace_metal_temp]) as [furnace_metal_temp],
      COALESCE(pr.[biscuit_thickness], pr_cast.[biscuit_thickness]) as [biscuit_thickness],
      pr.[leak_body_leak_value],
      p.[interlock_reason] as parts_interlock_reason
    FROM [RICO_IOT].[dbo].[ProductionReports] pr
    LEFT JOIN [RICO_IOT].[dbo].[Parts] p ON p.part_id = pr.part_id
    OUTER APPLY (
      SELECT TOP 1 c.part_id, c.cycle_time, c.shot_number, c.plc_cycle_time, c.metal_pressure, c.furnace_metal_temp, c.biscuit_thickness
      FROM [RICO_IOT].[dbo].[ProductionReports] c
      WHERE ((c.customer_qr IS NOT NULL AND c.customer_qr <> '' AND c.customer_qr <> '-' AND (c.customer_qr = pr.customer_qr OR c.customer_qr = pr.part_id))
          OR (c.part_id IS NOT NULL AND c.part_id <> '' AND c.part_id <> '-' AND (c.part_id = pr.customer_qr OR c.part_id = pr.part_id)))
        AND c.metal_pressure IS NOT NULL
      ORDER BY c.id DESC
    ) pr_cast
    WHERE (
      pr.overall_status IN ('NG', 'FAILED')
      OR pr.op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR pr.op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR pr.op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR pr.op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR pr.op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR pr.op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR pr.op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR pr.machine_name LIKE '%Leak%'
      OR pr.rejection_reason LIKE '%Leak%'
      OR pr.ng_reason LIKE '%Leak%'
      OR JSON_VALUE(pr.leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
    )
    ORDER BY pr.first_scan_at DESC
  `, { type: sequelize.QueryTypes.SELECT });
  const duration = Date.now() - start;
  console.log(`Fetched ${rows.length} NG rows in ${duration}ms`);

  const chipOff = rows.filter(r => (r.rejection_reason || '').includes('Chip') || (r.ng_reason || '').includes('Chip'));
  console.log(`Chip-off rows in NG query: ${chipOff.length}`);

  const biscuit = rows.filter(r => (r.rejection_reason || '').includes('Biscuit') || (r.ng_reason || '').includes('Biscuit'));
  console.log(`Biscuit rows in NG query: ${biscuit.length}`);

  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
