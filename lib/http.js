'use strict';
// Shared JSON responses for the API functions (Vercel) and the local server.

/** Successful data is cached at the CDN for 10 minutes and served stale for up to a day while refreshing
 *  (or as the handler says: fresher for data that changes by the minute, like a start list). */
const CACHE = 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400';
function sendJson(res, status, body, cache = CACHE) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', status === 200 ? cache : 'no-store');
  res.end(JSON.stringify(body));
}

/** Wraps a data loader as a (req, res) handler. */
const handler = (load, { cache } = {}) => async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const result = await load(url);
    if (result && result.status) return sendJson(res, result.status, result.body);
    return sendJson(res, 200, result, cache);
  } catch (err) {
    console.error(err);
    return sendJson(res, 502, { error: String(err.message || err), ...(err.diag ? { diag: err.diag } : {}) });
  }
};

module.exports = { sendJson, handler };
