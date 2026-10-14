'use strict';
// Shared JSON responses for the API functions (Vercel) and the local server.

/** Successful data is cached at the CDN for 10 minutes and served stale for up to a day while refreshing. */
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', status === 200
    ? 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400'
    : 'no-store');
  res.end(JSON.stringify(body));
}

/** Wraps a data loader as a (req, res) handler. */
const handler = (load) => async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const result = await load(url);
    if (result && result.status) return sendJson(res, result.status, result.body);
    return sendJson(res, 200, result);
  } catch (err) {
    console.error(err);
    return sendJson(res, 502, { error: String(err.message || err) });
  }
};

module.exports = { sendJson, handler };
