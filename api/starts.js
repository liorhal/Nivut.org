const { handler } = require('../lib/http');
const { resultFileUrl, getStartList } = require('../lib/nivut');

// A start list attached to an event (only the association's own hosts, HTML or PDF): rows of name text and start time.
module.exports = handler((url) => {
  const file = resultFileUrl(url.searchParams.get('url') || '');
  if (!file) return { status: 400, body: { error: 'bad url' } };
  return getStartList(file);
});
