const { handler } = require('../lib/http');
const { resultFileUrl, getResultFile } = require('../lib/nivut');

// A results file attached to an event, read into courses and splits (only the association's own hosts).
module.exports = handler((url) => {
  const file = resultFileUrl(url.searchParams.get('url') || '');
  if (!file) return { status: 400, body: { error: 'bad url' } };
  return getResultFile(file);
});
