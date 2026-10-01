require("dotenv").config();
const sequelize = require("../config/db");

async function testFullFix() {
  const [rows] = await sequelize.query(`
    SELECT TOP 10 
      pr.id, pr.part_id, pr.customer_qr, pr.machine_name, pr.overall_status, 
      pr.op100_status, pr.op110_status, pr.op120_status, pr.op130_status, pr.op140_status, pr.op150_status, pr.op160_status,
      pr.rejection_category, pr.rejection_reason, pr.ng_reason, pr.leak_data,
      p.interlock_reason as parts_interlock_reason
    FROM [RICO_IOT].[dbo].[ProductionReports] pr
    LEFT JOIN [RICO_IOT].[dbo].[Parts] p ON p.part_id = pr.part_id
    WHERE pr.part_id IN ('R437111511-54T00290926C0099', 'R437111511-54T00290926C0081', 'R437111511-54T00290926C0078', 'R437111511-54T00290926C0057', 'R437111511-54T00290926C0020')
    ORDER BY pr.id DESC
  `);

  const parseTextField = (text, label) => {
    if (!text || typeof text !== 'string') return '';
    const m = text.match(new RegExp(label + ':\\s*([^|\\n]+)', 'i'));
    return m ? m[1].trim() : '';
  };

  const results = rows.map(row => {
    let parsedLeak = null;
    if (row.leak_data) {
      try { parsedLeak = typeof row.leak_data === 'string' ? JSON.parse(row.leak_data) : row.leak_data; } catch(e){}
    }
    const isLeakResultNg = parsedLeak && ['NG', 'FAIL', 'FAILED'].includes(String(parsedLeak.result || parsedLeak.Raw_Result || '').trim().toUpperCase());
    const leakMachine = parsedLeak?.matchedMachineName || parsedLeak?.machineName || (String(row.machine_name || '').toLowerCase().includes('leak') ? row.machine_name : 'Leak-Test-01');

    const isOp150Ng = ['NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'].includes(String(row.op150_status || '').trim().toUpperCase())
      || isLeakResultNg
      || (String(row.machine_name || '').toLowerCase().includes('leak') && ['NG', 'FAILED'].includes(String(row.overall_status || '').trim().toUpperCase()))
      || (String(row.rejection_reason || '').toLowerCase().includes('leak') && ['NG', 'FAILED'].includes(String(row.overall_status || '').trim().toUpperCase()))
      || (String(row.ng_reason || '').toLowerCase().includes('leak') && ['NG', 'FAILED'].includes(String(row.overall_status || '').trim().toUpperCase()));

    const isOp130Ng = ['NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'].includes(String(row.op130_status || '').trim().toUpperCase());
    const isOp120Ng = ['NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'].includes(String(row.op120_status || '').trim().toUpperCase());

    let ngGate = '';
    let ngStation = '';
    let category = '';
    let reason = '';
    let view = '';
    let zone = '';

    const partsInterlock = String(row.parts_interlock_reason || '').trim();
    const srcText = String(row.ng_reason || row.rejection_reason || partsInterlock || '');

    if (isOp120Ng) {
      ngGate = 'OP120';
      ngStation = 'Casting PDi (OP120)';
      category = row.rejection_category || parseTextField(srcText, 'Category') || 'CR';
      reason = row.rejection_reason || parseTextField(srcText, 'Reason') || 'Casting Visual NG';
      view = parseTextField(srcText, 'View') || 'Front';
      zone = parseTextField(srcText, 'Zone') || 'Zone General';
    } else if (isOp130Ng) {
      ngGate = 'OP130';
      ngStation = 'Pre Inspection (OP130)';
      category = row.rejection_category || parseTextField(srcText, 'Category') || 'CRAM';
      reason = row.rejection_reason || parseTextField(srcText, 'Reason') || 'Pre-Inspection Defect';
      view = parseTextField(srcText, 'View') || 'Front';
      zone = parseTextField(srcText, 'Zone') || 'Zone General';
    } else if (isOp150Ng) {
      ngGate = 'OP150';
      ngStation = `${leakMachine} (OP150)`;
      category = 'MR';
      const bodyLeak = parsedLeak?.bodyLeakValue || parsedLeak?.Body_Leak_Value || parsedLeak?.body_leak_value;
      reason = bodyLeak ? `Body Leak Fail (${bodyLeak} bar)` : 'Pressure Leakage Fail';
      view = 'Leak Testing';
      zone = 'Zone Leak';
    }

    return {
      part_id: row.part_id,
      ngGate,
      ngStation,
      category,
      reason,
      view,
      zone
    };
  });

  console.table(results);
}

testFullFix().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
