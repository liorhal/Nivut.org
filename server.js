'use strict';
// Serves the wrapper site and a small JSON API that reads live from nivut.org.il.
// No dependencies: Node 18+.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { PAGES, getEvents, getNews, getForum, getEventPage } = require('./lib/nivut');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const PUBLIC = new Set(['/index.html', '/assets/app.js', '/assets/styles.css']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/events') return sendJson(res, 200, await getEvents());
    if (url.pathname === '/api/forum') return sendJson(res, 200, await getForum());
    if (url.pathname === '/api/news') return sendJson(res, 200, await getNews());
    if (url.pathname === '/api/event') {
      // Only numeric event ids on the source site: never an open proxy.
      const id = url.searchParams.get('id') || '';
      if (!/^\d{1,7}$/.test(id)) return sendJson(res, 400, { error: 'bad id' });
      return sendJson(res, 200, await getEventPage(new URL(`${id}/Info`, PAGES.home).href));
    }
    if (url.pathname === '/api/links') return sendJson(res, 200, PAGES);
  } catch (err) {
    console.error(err);
    return sendJson(res, 502, { error: String(err.message || err), tried: err.tried, links: PAGES });
  }

  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  if (req.method !== 'GET' || !PUBLIC.has(file)) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(path.join(ROOT, file), (err, data) => {
    if (err) { res.writeHead(500); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)], 'cache-control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`nivut wrapper on http://localhost:${PORT}`));
