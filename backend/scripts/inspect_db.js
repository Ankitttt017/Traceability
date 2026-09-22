const { getOperatorConfig } = require('../services/rejectionConfigService');

async function test() {
  const cfg1 = await getOperatorConfig("OIL PAN K-12");
  console.log('cfg1 views:', cfg1.views?.length);

  const cfg2 = await getOperatorConfig({ partName: "OIL PAN K-12" });
  console.log('cfg2 views:', cfg2.views?.length);
  process.exit(0);
}
test().catch(e => { console.error(e); process.exit(1); });
