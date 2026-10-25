const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
function createServer(directory = root) {
  const base = path.resolve(directory);
  return http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.split(/[\\/]/).some(part => part.startsWith('.') || part === 'node_modules')) { res.writeHead(403).end(); return; }
      let file = path.resolve(base, '.' + pathname);
      const relative = path.relative(base, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403).end(); return; }
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch (error) { res.writeHead(error instanceof URIError ? 400 : 404).end(); }
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || 8766);
  createServer(process.env.SERVE_DIR || root).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
}
module.exports = { root, createServer };
