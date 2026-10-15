'use strict';
// Local server: serves public/ and the same API functions that run on Vercel (api/*.js).
// No dependencies: Node 18+.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, 'public');
const API = Object.fromEntries(['events', 'event', 'forum', 'news', 'links', 'participants', 'ranking']
  .map((n) => [`/api/${n}`, require(`./api/${n}`)]));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (API[pathname]) return API[pathname](req, res);

  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (req.method !== 'GET' || !file.startsWith(PUBLIC_DIR + path.sep) || !TYPES[path.extname(file)]) {
    res.writeHead(404);
    return res.end('Not found');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)], 'cache-control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`nivut wrapper on http://localhost:${PORT}`));
