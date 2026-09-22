const sequelize = require('../config/db');

async function test() {
  const start = Date.now();
  const rows = await sequelize.query(`
    SELECT TOP 6000
      pr.[id],
      pr.[part_id],
      pr.[customer_qr],
      pr.[part_name],
      pr.[die_name],
      pr.[machine_name],
      pr.[shift_code],
      pr.[overall_status],
      pr.[first_scan_at],
      pr.[final_scan_at],
      pr.[ng_reason],
      pr.[rejection_category],
      pr.[rejection_reason],
      pr.[cycle_time],
      pr.[createdAt],
      pr.[updatedAt],
      pr.[op100_status],
      pr.[op110_status],
      pr.[op120_status],
      pr.[op130_status],
      pr.[op140_status],
      pr.[op150_status],
      pr.[op160_status],
      pr.[shot_number],
      pr.[plc_cycle_time],
      pr.[metal_pressure],
      pr.[furnace_metal_temp],
      pr.[biscuit_thickness],
      pr.[leak_body_leak_value],
      p.[interlock_reason] as parts_interlock_reason
    FROM [RICO_IOT].[dbo].[ProductionReports] pr
    LEFT JOIN [RICO_IOT].[dbo].[Parts] p ON p.part_id = pr.part_id
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
  console.log(`Fetched ${rows.length} NG rows WITHOUT outer apply in ${duration}ms`);

  const chipOff = rows.filter(r => (r.rejection_reason || '').includes('Chip') || (r.ng_reason || '').includes('Chip'));
  console.log(`Chip-off rows in query: ${chipOff.length}`);

  const biscuit = rows.filter(r => (r.rejection_reason || '').includes('Biscuit') || (r.ng_reason || '').includes('Biscuit'));
  console.log(`Biscuit rows in query: ${biscuit.length}`);

  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
