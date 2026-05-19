require('dotenv').config();
const { getIoSnapshot } = require('./controllers/traceabilityController');

// Mock req, res
const req = {
  query: {
    machineId: '9',
    force: '1'
  }
};

const res = {
  status(code) {
    console.log('HTTP Status:', code);
    return this;
  },
  json(data) {
    console.log('JSON Data:', JSON.stringify(data, null, 2));
  }
};

(async () => {
  console.log('Running getIoSnapshot mock...');
  try {
    await getIoSnapshot(req, res);
  } catch (e) {
    console.error('Error:', e);
  }
  process.exit(0);
})();
