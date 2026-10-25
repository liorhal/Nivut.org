const { handler } = require('../lib/http');
const { getParticipants } = require('../lib/nivut');

// Only numeric event ids on the source site: never an open proxy.
module.exports = handler((url) => {
  const id = url.searchParams.get('id') || '';
  if (!/^\d{1,7}$/.test(id)) return { status: 400, body: { error: 'bad id' } };
  return getParticipants(id);
}, { cache: 'public, max-age=30, s-maxage=60, stale-while-revalidate=300' }); // registrations change by the minute
