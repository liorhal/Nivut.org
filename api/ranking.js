const { handler } = require('../lib/http');
const { getRanking } = require('../lib/nivut');

// Only known leagues and well-formed season / category names reach the source site.
module.exports = handler((url) => {
  const league = url.searchParams.get('league') || 'foot';
  const season = url.searchParams.get('season') || '';
  const category = url.searchParams.get('category') || '';
  if (!/^(foot|mtbo|local)$/.test(league)) return { status: 400, body: { error: 'bad league' } };
  if (season && !/^\d{4}-\d{4}$/.test(season)) return { status: 400, body: { error: 'bad season' } };
  if (category && !/^[\p{L}\d+ -]{1,24}$/u.test(category)) return { status: 400, body: { error: 'bad category' } };
  return getRanking({ league, season, category });
});
