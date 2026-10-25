const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { root } = require('./dev-server.cjs');
const dist = path.join(root, 'dist');
if (fs.existsSync(dist) && fs.lstatSync(dist).isSymbolicLink()) throw Error('dist must not be a symlink');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const item of ['index.html', 'src', 'styles', '.nojekyll']) fs.cpSync(path.join(root, item), path.join(dist, item), { recursive: true });
const files = {};
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else { const bytes = fs.readFileSync(file); files[path.relative(dist, file).replaceAll('\\', '/')] = { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }; }
  }
}
walk(dist);
fs.writeFileSync(path.join(dist, 'build-manifest.json'), JSON.stringify({ format: 'native-esm', files }, null, 2) + '\n');
console.log(`Built ${Object.keys(files).length} files without bundling or copying GameKit.`);
