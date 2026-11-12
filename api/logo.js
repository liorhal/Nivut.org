const { logoUrl, getLogo } = require('../lib/nivut');

// A club logo relayed from the association's hosts, so the page can read its pixels (to even out logo margins).
module.exports = async (req, res) => {
  const file = logoUrl(new URL(req.url, 'http://localhost').searchParams.get('url') || '');
  if (!file) { res.statusCode = 400; return res.end('bad url'); }
  try {
    const { type, body } = await getLogo(file);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=86400, s-maxage=21600', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
    res.end(body);
  } catch (err) {
    res.statusCode = 502; res.end(String(err.message || err));
  }
};
