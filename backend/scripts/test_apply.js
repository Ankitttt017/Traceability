const sequelize = require('../config/db');
async function run() {
  try {
    const controller = require('../controllers/traceabilityController');
    const req = {
      query: {
        qualityGate: 'OP130',
        status: 'NG',
        allTime: '1',
        pageSize: '50',
        category: 'CR'
      }
    };
    const t0 = Date.now();
    const res = {
      json: (data) => {
        console.log(`Success in ${Date.now() - t0}ms! Total: ${data.total}, Rows count: ${data.rows ? data.rows.length : 0}`);
        if (data.rows && data.rows.length > 0) {
          console.log('Sample row 0:', {
            id: data.rows[0].id,
            part_id: data.rows[0].part_id,
            customer_qr: data.rows[0].customer_qr,
            rejection_category: data.rows[0].rejection_category,
            rejection_reason: data.rows[0].rejection_reason,
            ng_reason: data.rows[0].ng_reason,
            rejection_view: data.rows[0].rejection_view,
            rejection_zone: data.rows[0].rejection_zone,
            rejection_sub_zone: data.rows[0].rejection_sub_zone,
            op130_status: data.rows[0].op130_status,
            machine_name: data.rows[0].machine_name
          });
        }
        process.exit(0);
      },
      status: (code) => {
        console.log('Status code:', code);
        return {
          json: (err) => {
            console.error('Error JSON:', err);
            process.exit(1);
          }
        };
      }
    };
    await controller.getRejectionRows(req, res);

    const parseTextField = (text, label) => {
      if (!text || typeof text !== 'string') return '';
      const m = text.match(new RegExp(label + ':\\s*([^|\\n]+)', 'i'));
      return m ? m[1].trim() : '';
    };
    const canonicalizeReasonHelper = (raw) => {
      if (!raw) return "";
      const s = String(raw).trim();
      const lower = s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ");
      if (lower.includes("non filling") || lower.includes("nonfilling")) return "Non-Filling";
      if (lower.includes("blow hole") || lower.includes("blowhole")) return "Blow Hole";
      if (lower.includes("pin hole") || lower.includes("pinhole")) return "Pin Hole";
      if (lower.includes("cold shut") || lower.includes("coldshut")) return "Cold Shut";
      if (lower.includes("leak") || lower.includes("leakage")) return "Pressure Leakage Fail";
      if (lower.includes("dent")) return "Dent / Handling Damage";
      if (lower.includes("crack")) return "Crack";
      if (lower.includes("porosity")) return "Porosity";
      if (lower.includes("gauging") || lower.includes("dimension")) return "Gauging Out of Spec";
      if (lower.includes("laser") || lower.includes("qr")) return "Laser Mark QR Fail";
      if (lower.includes("dcm casting")) return "DCM Casting Defect";
      if (lower.includes("casting visual") || lower.includes("visual ng")) return "Casting Visual NG";
      return s.replace(/\\w\\S*/g, (w) => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase());
    };

    const reasonMap = {};
    paretoRows.forEach(r => {
      const cnt = Number(r.cnt || 0);
      const partsInterlock = String(r.interlock_reason || '').trim();
      const srcText = String(r.ng_reason || r.rejection_reason || partsInterlock || '');
      const parsedReason = parseTextField(partsInterlock, 'Reason') || parseTextField(srcText, 'Reason');
      let rawReason = String(r.rejection_reason || '').trim() || parsedReason || '';
      if (!rawReason) rawReason = 'Pre-Inspection Defect';
      rawReason = canonicalizeReasonHelper(rawReason);
      reasonMap[rawReason] = (reasonMap[rawReason] || 0) + cnt;
    });
    console.log('Pareto reasons:', Object.entries(reasonMap).sort((a,b)=>b[1]-a[1]).slice(0, 15));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
