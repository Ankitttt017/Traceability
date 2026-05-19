const { execSync } = require('child_process');

try {
  const show = execSync('git show 88ba57a').toString();
  const lines = show.split('\n');
  const startIdx = lines.findIndex(l => l.includes('getSlmpRouteCandidates'));
  if (startIdx !== -1) {
    console.log(lines.slice(startIdx - 5, startIdx + 35).join('\n'));
  } else {
    console.log('Not found');
  }
} catch (e) {
  console.error(e.message);
}
