const assert = require("assert");

const { normalizeLeaktestResult } = require("../services/leaktestLookupService");
const { generateIndustrialExcel } = require("../services/report/excelTemplateEngine");

async function testLeakRules() {
  assert.strictEqual(normalizeLeaktestResult("19279"), "OK");
  assert.strictEqual(normalizeLeaktestResult("18254"), "NG");
  assert.strictEqual(normalizeLeaktestResult("OK"), "OK");
  assert.strictEqual(normalizeLeaktestResult("NG"), "NG");
}

async function testExcelExportSmoke() {
  const chunks = [];
  const res = {
    setHeader() {},
    attachment(name) {
      this.name = name;
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk));
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
      this.ended = true;
    },
  };

  await generateIndustrialExcel(res, {
    rows: [
      {
        reportGroupKey: "R1",
        displayPartId: "0801",
        customerQrCode: "R437",
        operationNo: "OP160",
        machineName: "Final Inspection",
        industrialResult: "OK",
        partStatus: "PASSED",
      },
    ],
    stationPairs: [{ machineName: "Final Inspection", op: "OP160" }],
    filters: {
      dateFrom: "2026-08-01T00:30:00.000Z",
      dateTo: "2026-08-02T00:30:00.000Z",
    },
    reportConfig: { companyName: "Traceability" },
  });

  assert.strictEqual(res.ended, true);
  assert.ok(Buffer.concat(chunks).length > 1000, "Excel export should produce a workbook payload");
}

async function main() {
  await testLeakRules();
  await testExcelExportSmoke();
  console.log("Backend smoke tests passed");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Backend smoke tests failed:", error);
    process.exit(1);
  });
