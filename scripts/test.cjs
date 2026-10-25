const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts/e2e');
fs.mkdirSync(output, { recursive: true });
const started = Date.now();
const packagePath = require.resolve('playwright/package.json');
const cli = path.resolve(path.dirname(packagePath), require(packagePath).bin.playwright);
const child = spawn(process.execPath, [cli, 'test'], { cwd: root, stdio: 'inherit' });
let timedOut = false;
function stop() {
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {});
  else child.kill('SIGTERM');
}
const deadline = setTimeout(() => { timedOut = true; stop(); }, 180_000);
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.once('error', error => { clearTimeout(deadline); console.error(error); process.exitCode = 1; });
child.once('exit', code => {
  clearTimeout(deadline);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'execution.json'), JSON.stringify({ limitMs: 180000, elapsedMs: Date.now() - started, timedOut, exitCode: code }, null, 2));
  process.exitCode = timedOut ? 1 : (code ?? 1);
});
