// Minimal local preview server for dist/ with the same rewrites the host applies.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(process.env.DIST || join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
const port = Number(process.env.PORT || 8080);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};

createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let rel = pathname;
  if (/^\/brand\/[^/]+\/?$/.test(rel)) rel = '/index.html';
  else if (rel === '/admin' || rel === '/admin/') rel = '/admin/index.html';
  else if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(dist, rel));
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
  if (rel.startsWith('/admin')) headers['X-Robots-Tag'] = 'noindex, nofollow';
  res.writeHead(200, headers).end(readFileSync(file));
}).listen(port, () => console.log(`Preview: http://localhost:${port}  (admin: /admin)`));
