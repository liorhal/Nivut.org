'use strict';
// Fixtures mirror the real nivut.org.il markup (home page, event page, forum) with made-up names.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../lib/nivut');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const REF = new Date('2026-10-14T08:00:00');

test('parseDate handles numeric and Hebrew formats', () => {
  assert.equal(L.parseDate('24/10/2026'), '2026-10-24');
  assert.equal(L.parseDate('16/10/26'), '2026-10-16');
  assert.equal(L.parseDate('שבת, 17 אוקטובר, 2026'), '2026-10-17');
  assert.equal(L.parseDate('99/99/2026'), null);
});

test('dates without a year resolve to the nearest season', () => {
  assert.equal(L.dateFromTitle('יער אודם 24/10 אליפות', REF), '2026-10-24');
  assert.equal(L.dateFromTitle('גימזו 16/1', REF), '2027-01-16');
  assert.equal(L.dateFromTitle('אודם 23-24.10.26', REF), '2026-10-23');
});

test('cleanTitle drops day names and dates', () => {
  assert.equal(L.cleanTitle('ניווט רכוב בריכות דגים מעגן מיכאל יום שישי 16/10'), 'ניווט רכוב בריכות דגים מעגן מיכאל');
  assert.equal(L.cleanTitle('ניווט מחניים-אליפות הגליל 2026-יום שבת 17/10'), 'ניווט מחניים-אליפות הגליל 2026');
});

test('tags ignore "כמו ליגה"', () => {
  assert.deepEqual(L.tagsOf('ניווט ענבה קטגוריות ומסלולים כמו ליגה'), []);
  assert.deepEqual(L.tagsOf('אימון עם מסלולים כמו בליגה'), ['training']);
  assert.deepEqual(L.tagsOf('מקצה 3 בליגה'), ['league']);
  assert.deepEqual(L.tagsOf('מודל ביער אודם לפני אליפות ישראל'), ['champ', 'training']);
});

test('parseHome reads featured events, closed areas and news', () => {
  const h = L.parseHome(fx('home.html'), 'https://nivut.org.il/', REF);
  assert.equal(h.featured.length, 3);
  const [mtbo, inbe, odem] = h.featured;
  assert.equal(mtbo.date, '2026-10-16');
  assert.deepEqual(mtbo.disciplines, ['mtbo']);
  assert.equal(mtbo.title, 'ניווט רכוב בריכות דגים מעגן מיכאל');
  assert.equal(mtbo.summary, 'ניווט מרתק בין בריכות הדגים');
  assert.equal(mtbo.image, 'https://nivut.org.il/images/a.jpg');
  assert.equal(mtbo.nivutId, '3333');
  assert.equal(inbe.date, '2026-10-17');
  assert.deepEqual(odem.disciplines, ['foot', 'ammi']);
  assert.deepEqual(odem.tags, ['champ']);
  assert.deepEqual(h.closedAreas.map((a) => [a.date, a.discipline, a.name]), [
    ['2026-10-16', 'mtbo', 'בריכות מעגן מיכאל'], ['2026-10-17', 'foot', 'בית ענבה'], ['2026-11-14', 'foot', 'שער הכרמל']]);
  assert.equal(h.news.length, 1);
  assert.equal(h.news[0].date, '2026-08-07');
  assert.equal(h.news[0].category, 'חדשות');
  assert.equal(h.news[0].summary, 'מאגר ידע חדש באתר האיגוד');
});

test('parseEventPage reads the event details', () => {
  const d = L.parseEventPage(fx('event.html'), 'https://nivut.org.il/3379/Info/x');
  assert.equal(d.nivutId, '3379');
  assert.equal(d.name, 'בית ענבה');
  assert.equal(d.eventType, 'ליגת ניווט רגלי (יער)');
  assert.equal(d.date, '2026-10-17');
  assert.equal(d.note, 'אימון עם מסלולים כמו בליגה');
  assert.equal(d.startFrom, '09:00');
  assert.equal(d.startTo, '11:00');
  assert.equal(d.cutoff, '12:30');
  assert.deepEqual(d.courses, [{ name: 'קצרצר', distance: '' }, { name: 'קצר (רמה 2)', distance: '3.1 ק"מ' }]);
  assert.equal(d.price, '25 שח (לחברי איגוד)');
  assert.equal(d.priceNonMember, '50 שח (לחצוניים)');
  assert.equal(d.registrationDeadline, '2026-10-16T18:00');
  assert.deepEqual(d.club, { name: 'השרון', url: 'https://nivut.org.il/Club/11' });
  assert.equal(d.director, 'מנהל לדוגמה');
  assert.equal(d.map.name, 'בית ענבה [ת]');
  assert.equal(d.map.image, 'https://nivut.org.il/maps/map052.gif');
  assert.equal(d.map.scale, '1:7500');
  assert.deepEqual(d.directions, ['מכביש 1 במחלף ענבה.']);
  assert.equal(d.attachments[0].name, 'פרפר דוגמא');
  assert.deepEqual(d.description, ['אימון ניווט מקומי.', 'הרשמה דרך https://www.nivutbekef.com/']);
  assert.equal(d.lat, 31.9056);
  assert.equal(d.wazeLL, '31.90455,34.95618');
  assert.equal(d.resultsAvailable, false);
});

test('parseForum reads threads, replies and ages', () => {
  const now = Date.parse('2026-10-14T08:00:00Z');
  const t = L.parseForum(fx('forum.html'), 'https://nivut.org.il/forums/', now);
  assert.equal(t.length, 2);
  assert.equal(t[0].title, 'אליפות ישראל ביער אודם');
  assert.equal(t[0].author, 'משתמש א');
  assert.equal(t[0].announcement, true);
  assert.deepEqual(t[0].body, ['בוקר טוב,', '• האליפות תתקיים ב-23.10']);
  assert.equal(t[0].replyCount, 1);
  assert.equal(t[0].replies[0].author, 'משתמש ב');
  assert.deepEqual(t[0].replies[0].body, ['עדכון', 'נוסף']);
  assert.equal(t[0].replies[0].hasImage, true);
  assert.equal(t[0].replies[0].postedAt, '2026-10-14T05:30:00.000Z');
  assert.equal(t[0].lastActivity, '2026-10-14T05:30:00.000Z');
  assert.equal(t[1].pinned, true);
  assert.deepEqual(t[1].body, []);
  assert.equal(L.ageMinutes("17 ש' 15 דק'"), 17 * 60 + 15);
});

test('mergeEvents enriches featured events and adds unmatched closed areas', () => {
  const home = L.parseHome(fx('home.html'), 'https://nivut.org.il/', REF);
  const detail = L.parseEventPage(fx('event.html'), 'https://nivut.org.il/3379/Info/');
  const events = L.mergeEvents(home, new Map([['https://nivut.org.il/3379/Info/', detail]]), []);
  const inbe = events.find((e) => e.nivutId === '3379');
  assert.equal(inbe.time, '09:00');
  assert.equal(inbe.location, 'בית ענבה');
  assert.equal(inbe.clubName, 'השרון');
  assert.deepEqual(inbe.tags, ['training']);
  assert.equal(events.find((e) => e.nivutId === '3333').location, 'בריכות מעגן מיכאל');
  const closed = events.filter((e) => e.source === 'closed-area');
  assert.deepEqual(closed.map((e) => e.title), ['שער הכרמל']);
});

test('parseCalendar ignores sidebar boxes and needs a header row', () => {
  assert.deepEqual(L.parseCalendar(fx('home.html'), 'https://nivut.org.il/calendar.aspx'), []);
  const html = '<table><tr><th>תאריך</th><th>שם הארוע</th><th>מקום</th></tr><tr><td>14/11/2026</td><td><a href="/3500/Info">ליגה ארצית</a></td><td>שער הכרמל</td></tr></table>';
  const ev = L.parseCalendar(html, 'https://nivut.org.il/calendar.aspx');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].nivutId, '3500');
  assert.equal(ev[0].location, 'שער הכרמל');
  assert.deepEqual(ev[0].tags, ['league']);
});

test('parseForum tolerates single quotes, attribute order and plain age spans', () => {
  const html = fx('forum.html')
    .replace(/<div class="clsParent" style="padding-right: 12px" id="Parent(\d+)">/g, "<div id='Parent$1' class='clsParent'>")
    .replace(/<span class="">/g, '<span>');
  const t = L.parseForum(html, 'https://nivut.org.il/forums/', Date.parse('2026-10-14T08:00:00Z'));
  assert.equal(t.length, 2);
  assert.equal(t[0].title, 'אליפות ישראל ביער אודם');
  assert.equal(t[0].ageText, '117 ימים');
  assert.equal(t[0].replies.length, 1);
  assert.deepEqual(t[0].body, ['בוקר טוב,', '• האליפות תתקיים ב-23.10']);
});

test('parseForumRss groups replies under their thread', () => {
  const xml = `<rss><channel>
    <item><title>לוח שנה</title><link>https://nivut.org.il/forums/?m=96191</link><pubDate>Tue, 13 Oct 2026 20:04:00 GMT</pubDate>
      <dc:creator>משתמש א</dc:creator><description><![CDATA[<p>חברים</p><p>לוח חדש</p>]]></description></item>
    <item><title>תגובה: לוח שנה</title><link>https://nivut.org.il/forums/?m=96194</link><pubDate>Wed, 14 Oct 2026 02:00:00 GMT</pubDate>
      <description>&lt;p&gt;מעולה&lt;/p&gt;</description></item>
  </channel></rss>`;
  const t = L.parseForumRss(xml);
  assert.equal(t.length, 1);
  assert.equal(t[0].author, 'משתמש א');
  assert.deepEqual(t[0].body, ['חברים', 'לוח חדש']);
  assert.equal(t[0].replyCount, 1);
  assert.deepEqual(t[0].replies[0].body, ['מעולה']);
  assert.equal(t[0].lastActivity, '2026-10-14T02:00:00.000Z');
  assert.equal(t[0].url, 'https://nivut.org.il/forums/?m=96191');
});
