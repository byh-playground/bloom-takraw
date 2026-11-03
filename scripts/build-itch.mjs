// itch.io 업로드용 zip을 만든다(docs/itch.md). 원본은 바꾸지 않는 별도 산출물이다.
// 원본 파일을 그대로 복사하고, import map의 CDN 의존을 내려받아 vendor/에 넣은 뒤 주소만 ./vendor/로 바꾼다.
// 실행: npm run build:itch → dist/itch/(압축 전 폴더), dist/bloom-takraw-itch-<버전>.zip
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist/itch');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'gamekit.lock.json'), 'utf8'));
const pinned = new Map(Object.values(lock.modules).map(entry => [entry.url, entry.sha256]));
// 게임이 실행 중에 읽는 원본만 담는다. 문서·시험·스크립트·자료 원본은 넣지 않는다.
const SOURCES = ['index.html', 'manifest.webmanifest', 'sw.js', 'src', 'styles', 'assets', 'pwa'];
const CDN = 'https://cdn.jsdelivr.net/';

fs.rmSync(out, { recursive: true, force: true });
for (const source of SOURCES) fs.cpSync(path.join(root, source), path.join(out, source), { recursive: true });

// CDN 주소 → vendor/ 아래 같은 경로. 경로를 그대로 두면 three.module.js의 './three.core.js' 같은 상대 import도 그대로 풀린다.
const vendored = new Map();
async function vendor(url) {
  if (vendored.has(url)) return vendored.get(url);
  if (!url.startsWith(CDN)) throw Error(`CDN 밖의 의존: ${url}`);
  const local = 'vendor/' + url.slice(CDN.length);
  vendored.set(url, local);
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (pinned.has(url) && pinned.get(url) !== hash) throw Error(`${url}: gamekit.lock.json sha256 불일치`);
  fs.mkdirSync(path.dirname(path.join(out, local)), { recursive: true });
  fs.writeFileSync(path.join(out, local), bytes);
  const text = bytes.toString('utf8');
  const code = text.replace(/\/\*[\s\S]*?\*\//g, ''); // JSDoc의 import('./x.js') 타입 표기는 의존이 아니다
  for (const [, specifier] of code.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) await vendor(new URL(specifier, url).href);
  if (/https:\/\/cdn\.jsdelivr\.net\//.test(text)) throw Error(`${url}: 안에 다른 CDN 주소가 있다`);
  return local;
}

const htmlPath = path.join(out, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const [block, json] = html.match(/<script type="importmap">([\s\S]*?)<\/script>/) ?? [];
if (!block) throw Error('index.html에 import map이 없다');
const map = JSON.parse(json);
for (const [name, url] of Object.entries(map.imports)) map.imports[name] = './' + await vendor(url);
fs.writeFileSync(htmlPath, html.replace(block, `<script type="importmap">\n${JSON.stringify(map, null, 2)}\n  </script>`));

// zip(외부 압축 도구 없이 node만으로): 로컬 헤더 + 중앙 디렉터리 + 끝 레코드, 항목은 deflate.
const files = [];
(function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full); else files.push(full);
  }
})(out);
const parts = [], central = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(path.relative(out, file).split(path.sep).join('/'), 'utf8');
  if (name.length > 240) throw Error(`itch 경로 길이 240자 초과: ${name}`);
  const data = fs.readFileSync(file), packed = zlib.deflateRawSync(data, { level: 9 }), crc = zlib.crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8); header.writeUInt16LE(8, 10);
  header.writeUInt32LE(crc, 16); header.writeUInt32LE(packed.length, 20); header.writeUInt32LE(data.length, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(offset, 42);
  parts.push(local, name, packed); central.push(header, name);
  offset += local.length + name.length + packed.length;
}
const directorySize = central.reduce((sum, buffer) => sum + buffer.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(offset, 16);
const zipPath = path.join(root, `dist/bloom-takraw-itch-${version}.zip`);
fs.writeFileSync(zipPath, Buffer.concat([...parts, ...central, end]));

const unpacked = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
if (files.length > 1000 || unpacked > 500 * 1024 * 1024) throw Error('itch 한도(파일 1,000개, 500MB) 초과');
console.log(`${path.relative(root, zipPath)}: 파일 ${files.length}개, 압축 전 ${(unpacked / 1048576).toFixed(2)}MB, zip ${(fs.statSync(zipPath).size / 1048576).toFixed(2)}MB, vendor ${vendored.size}개`);
