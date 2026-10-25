import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import server from '../scripts/dev-server.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'gamekit.lock.json')));
const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
const sources = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(name => name.endsWith('.js'));

test('native module graph resolves to local files or pinned GameKit links', () => {
  assert.match(html, /<script type="module" src="\.\/src\/main\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\.\/styles\/app\.css">/);
  assert.doesNotMatch(html, /<style>|<script type="module">|chatgpt\.site/);
  const used = new Set();
  for (const relative of sources) {
    const file = path.join(root, 'src', relative);
    execFileSync(process.execPath, ['--check', file]);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\()['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('.')) assert.ok(fs.existsSync(path.resolve(path.dirname(file), specifier)), `${file}: ${specifier}`);
      else { assert.ok(map[specifier], specifier); used.add(specifier); }
    }
  }
  for (const [name, module] of Object.entries(lock.modules)) {
    const alias = '@bloom-gamekit/' + name;
    assert.equal(map[alias], module.url);
    assert.ok(module.url.includes('@' + lock.distCommit + '/'));
    assert.match(module.sha256, /^[a-f0-9]{64}$/);
    assert.ok(used.has(alias), `${name} must be used, not a dead dependency`);
  }
  for (const [name, url] of Object.entries(lock.external)) assert.equal(map[name], url);
});

test('HTTP server serves modules and CSS with correct MIME and blocks private paths', async () => {
  const http = server.createServer(root);
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${http.address().port}`;
  try {
    for (const [file, type] of [['src/main.js', 'text/javascript'], ['styles/app.css', 'text/css'], ['index.html', 'text/html']]) {
      const response = await fetch(`${base}/${file}`);
      assert.equal(response.status, 200); assert.ok(response.headers.get('content-type').startsWith(type));
    }
    for (const file of ['.git/config', 'node_modules/playwright/package.json', '%2e%2e%5cpackage.json']) assert.equal((await fetch(`${base}/${file}`)).status, 403);
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
  } finally { await new Promise(resolve => http.close(resolve)); }
});

test('deployment output preserves native imports and contains no tools or vendored GameKit', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/build.cjs')]);
  const dist = path.join(root, 'dist');
  assert.equal(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'), html);
  for (const file of sources) assert.deepEqual(fs.readFileSync(path.join(dist, 'src', file)), fs.readFileSync(path.join(root, 'src', file)));
  for (const name of ['tests', 'docs', 'scripts', 'node_modules', 'reference']) assert.equal(fs.existsSync(path.join(dist, name)), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dist, 'build-manifest.json'))).format, 'native-esm');
});
