'use strict';
// Fixtures are hand-written in the style of ASP.NET sites; they are NOT copies of nivut.org.il.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseEvents, parseForum, findForumUrl, parseDate, classify } = require('../lib/nivut');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

test('parseDate handles common formats', () => {
  assert.equal(parseDate('24/10/2026'), '2026-10-24');
  assert.equal(parseDate('5.12.26'), '2026-12-05');
  assert.equal(parseDate('2027-01-09'), '2027-01-09');
  assert.equal(parseDate('99/99/2026'), null);
  assert.equal(parseDate('no date'), null);
});

test('classify picks the event type', () => {
  assert.equal(classify('ניווט לילה ירקון'), 'night');
  assert.equal(classify('אליפות ישראל MTBO'), 'mtbo');
  assert.equal(classify('ליגה ארצית'), 'league');
  assert.equal(classify('משהו'), 'other');
});

test('parseEvents maps a headed table and ignores scripts', () => {
  const ev = parseEvents(fx('calendar.html'), 'https://nivut.org.il/calendar.aspx');
  assert.equal(ev.length, 3);
  assert.deepEqual(ev.map((e) => e.date), ['2026-10-24', '2026-11-12', '2026-12-05']);
  assert.equal(ev[0].title, 'ליגה ארצית מקצה 1');
  assert.equal(ev[0].location, 'יער בן שמן');
  assert.equal(ev[0].club, 'מועדון האיגוד');
  assert.equal(ev[0].type, 'league');
  assert.equal(ev[0].url, 'https://nivut.org.il/Event.aspx?id=101');
  assert.equal(ev[1].title, 'ניווט לילה "ירקון"');
  assert.equal(ev[1].type, 'night');
  assert.equal(ev[2].title, 'אליפות ישראל MTBO');
  assert.equal(ev[2].registerUrl, 'https://nivut.org.il/Register.aspx?id=103');
  assert.equal(ev[2].url, 'https://nivut.org.il/Event.aspx?id=103');
});

test('parseEvents falls back to non-table blocks', () => {
  const html = '<ul><li><a href="/e/1">ספרינט עירוני חולון</a> – 03/03/2027</li><li>תפריט</li></ul>';
  const ev = parseEvents(html, 'https://nivut.org.il/');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].title, 'ספרינט עירוני חולון');
  assert.equal(ev[0].type, 'sprint');
});

test('forum link discovery and topic parsing', () => {
  assert.equal(findForumUrl(fx('calendar.html'), 'https://nivut.org.il/'), 'https://nivut.org.il/forum/default.aspx');
  const t = parseForum(fx('forum.html'), 'https://nivut.org.il/forum/default.aspx');
  assert.equal(t.length, 2);
  assert.equal(t[0].title, 'טרמפ לליגה ארצית מקצה 1 בבן שמן');
  assert.equal(t[0].author, 'דנה');
  assert.equal(t[0].replies, 4);
  assert.equal(t[0].lastActivity, '2026-10-13T20:14:00');
});
