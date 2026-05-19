const { execSync } = require('child_process');

try {
  const hashes = execSync('git log --format=%H -- backend/services/plcIoService.js').toString().split('\n').filter(Boolean);
  for (const hash of hashes) {
    const content = execSync(`git show ${hash}:backend/services/plcIoService.js`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
    if (content.includes('getSlmpRouteCandidates')) {
      const lines = content.split('\n');
      const startIdx = lines.findIndex(l => l.includes('function getSlmpRouteCandidates'));
      if (startIdx !== -1) {
        console.log(`Hash: ${hash}`);
        console.log(lines.slice(startIdx, startIdx + 30).join('\n'));
        console.log('-------------------------------------------');
      }
    }
  }
} catch (e) {
  console.error(e.message);
}
