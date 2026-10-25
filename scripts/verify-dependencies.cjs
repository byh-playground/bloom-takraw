const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../gamekit.lock.json')));
(async () => {
  for (const [name, entry] of Object.entries(lock.modules)) {
    const response = await fetch(entry.url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`${name}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (hash !== entry.sha256) throw Error(`${name}: upstream hash mismatch`);
    console.log('PASS', name, bytes.length, hash);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
