// Source validation only: no game execution, generated app, or test fixture.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
const lock = JSON.parse(fs.readFileSync(path.join(root, 'gamekit.lock.json')));
function requireCondition(value, message) { if (!value) throw Error(message); }
const used = new Set();
for (const directory of ['src', 'scripts', 'tests']) {
  for (const name of fs.readdirSync(path.join(root, directory), { recursive: true })) {
    if (!/\.(?:js|cjs|mjs)$/.test(name)) continue;
    const file = path.join(root, directory, name);
    execFileSync(process.execPath, ['--check', file]);
    if (directory !== 'src') continue;
    const code = fs.readFileSync(file, 'utf8');
    for (const match of code.matchAll(/(?:from\s+|import\()['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('.')) requireCondition(fs.existsSync(path.resolve(path.dirname(file), specifier)), `Missing ${specifier} from ${file}`);
      else { requireCondition(map[specifier], `Unmapped import ${specifier}`); used.add(specifier); }
    }
  }
}
for (const match of html.matchAll(/(?:src|href)="(\.\/[^"?#]+)"/g)) requireCondition(fs.existsSync(path.resolve(root, match[1])), `Missing HTML resource ${match[1]}`);
for (const [name, entry] of Object.entries(lock.modules)) {
  const alias = '@bloom-gamekit/' + name;
  requireCondition(map[alias] === entry.url && entry.url.includes('@' + lock.distCommit + '/'), `GameKit link drift: ${name}`);
  requireCondition(/^[a-f0-9]{64}$/.test(entry.sha256), `Missing digest: ${name}`);
  requireCondition(used.has(alias), `Unused dependency: ${name}`);
}
for (const [name, url] of Object.entries(lock.external)) requireCondition(map[name] === url, `External link drift: ${name}`);
execFileSync(process.execPath, ['--check', path.join(root, 'playwright.config.js')]);
console.log('Source syntax, native import paths, and pinned dependency links are valid.');
