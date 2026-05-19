const { execSync } = require('child_process');

try {
  const output = execSync('git log -S getSlmpRouteCandidates --oneline').toString();
  console.log(output);
} catch (e) {
  console.error(e.message);
}
