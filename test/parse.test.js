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
  assert.deepEqual(odem.disciplines, ['foot']); // popular (ammi) counts as foot
  assert.deepEqual(odem.tags, ['champ']);
  assert.deepEqual(h.closedAreas.map((a) => [a.date, a.discipline, a.name]), [
    ['2026-10-16', 'mtbo', 'בריכות מעגן מיכאל'], ['2026-10-17', 'foot', 'בית ענבה'], ['2026-11-14', 'foot', 'שער הכרמל']]);
  assert.deepEqual(h.clubs.map((c) => [c.id, c.name]), [['2', 'הפועל תל אביב'], ['11', 'השרון']]);
  assert.equal(h.clubs[1].logo, 'https://cdn.nivut.org.il/images/clubs/ramathasharon.jpg');
  assert.equal(h.clubs[0].logo, 'https://cdn.nivut.org.il/club-logos/club2.png'); // not seen yet: read from its club page
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
  assert.deepEqual(d.club, {
    name: 'השרון', url: 'https://nivut.org.il/Club/11', id: '11',
    logo: 'https://cdn.nivut.org.il/images/clubs/x.jpg', pageLogo: 'https://cdn.nivut.org.il/images/clubs/x.jpg',
  });
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
  assert.equal(t[0].authorClubId, '4');
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

test('parseParticipants reads the table by its headings, ignoring layout tables', () => {
  const html = `<table><tr><td><table class="layout"><tr><td>תפריט</td></tr></table>
    <table><tr><th>#</th><th>שם</th><th>מועדון</th><th>קטגוריה</th><th>מסלול</th><th>שעת זינוק</th></tr>
      <tr><td>1</td><td>דנה כהן</td><td>השרון</td><td>D21</td><td>בינוני (רמה 5)</td><td>09:12</td></tr>
      <tr><td>2</td><td>יואב לוי</td><td>כרמל</td><td>M35</td><td>ארוך</td><td>09:40</td></tr></table></td></tr></table>`;
  const p = L.parseParticipants(html);
  assert.deepEqual(p, [
    { name: 'דנה כהן', club: 'השרון', category: 'D21', course: 'בינוני (רמה 5)', start: '09:12' },
    { name: 'יואב לוי', club: 'כרמל', category: 'M35', course: 'ארוך', start: '09:40' },
  ]);
  const split = '<table><tr><td>שם פרטי</td><td>שם משפחה</td><td>מועדון</td></tr><tr><td>רפי</td><td>הימן</td><td>השרון</td></tr></table>';
  assert.equal(L.parseParticipants(split)[0].name, 'רפי הימן');
  assert.deepEqual(L.parseParticipants('<table><tr><td>אין משתתפים</td></tr></table>'), []);
});

test('start time comes from the start row, never from a midnight datetime', () => {
  const base = fx('event.html');
  // label "שעת זינוק" instead of "זינוקים", and a date-only datetime
  const other = base.replace('<tr><td>זינוקים\n</td><td colspan="2"><time itemprop="startDate" datetime="2026-10-17T09:00">09:00</time> עד 11:00</td></tr>',
    '<tr><td>שעת זינוק</td><td colspan="2"><time itemprop="startDate" datetime="2026-10-17T00:00">08:30</time> עד 10:30</td></tr>');
  assert.notEqual(other, base);
  let d = L.parseEventPage(other, 'https://nivut.org.il/3379/Info');
  assert.equal(d.startFrom, '08:30');
  assert.equal(d.startTo, '10:30');
  // no start row at all, only the <time> element in some cell
  const noLabel = base.replace(/<tr><td>זינוקים\n<\/td><td colspan="2">([\s\S]*?)<\/td><\/tr>/, '<tr><td>מועד</td><td colspan="2">$1</td></tr>');
  d = L.parseEventPage(noLabel, 'https://nivut.org.il/3379/Info');
  assert.equal(d.startFrom, '09:00');
  // only a date-only datetime: no time rather than 00:00
  const dateOnly = base.replace(/<tr><td>זינוקים\n<\/td>[\s\S]*?<\/tr>/, '<tr><td colspan="3"><meta itemprop="startDate" datetime="2026-10-17T00:00"></td></tr>');
  d = L.parseEventPage(dateOnly, 'https://nivut.org.il/3379/Info');
  assert.equal(d.startFrom, '');
});

test('league: from the title or the category, unless it is only like a league', () => {
  assert.deepEqual(L.eventTags('ליגה ארצית מקצה 3', null), ['league']);
  assert.deepEqual(L.eventTags('יער ביריה', { eventType: 'ליגת ניווט רגלי (יער)', note: '' }), ['league']);
  assert.deepEqual(L.eventTags('ניווט ענבה', { eventType: 'ליגת ניווט רגלי (יער)', note: 'אימון עם מסלולים כמו בליגה' }), ['training']);
});

test('parseParticipants: one table per category, category taken from the heading', () => {
  const html = `<h3>M21 – ארוך</h3><table><tr><th>שם</th><th>מועדון</th><th>זינוק</th></tr>
      <tr><td>יואב לוי</td><td>כרמל</td><td>09:40</td></tr></table>
    <h3>W21 – בינוני</h3><table><tr><th>שם</th><th>מועדון</th><th>זינוק</th></tr>
      <tr><td>דנה כהן</td><td>השרון</td><td>09:12</td></tr><tr><td>מיכל רז</td><td>מנשה</td><td>09:20</td></tr></table>`;
  const p = L.parseParticipants(html);
  assert.deepEqual(p.map((x) => [x.name, x.category, x.club, x.start]), [
    ['יואב לוי', 'M21 – ארוך', 'כרמל', '09:40'],
    ['דנה כהן', 'W21 – בינוני', 'השרון', '09:12'],
    ['מיכל רז', 'W21 – בינוני', 'מנשה', '09:20'],
  ]);
});

test('parseParticipants: group rows inside one table', () => {
  const html = `<table><tr><th>שם</th><th>מועדון</th><th>שעת זינוק</th></tr>
    <tr><td colspan="3">קצר (רמה 2)</td></tr><tr><td>רפי הימן</td><td>השרון</td><td>10:02</td></tr>
    <tr><td colspan="3">ארוך</td></tr><tr><td>יואב לוי</td><td>כרמל</td><td>09:40</td></tr></table>`;
  assert.deepEqual(L.parseParticipants(html).map((x) => [x.name, x.category]), [['רפי הימן', 'קצר (רמה 2)'], ['יואב לוי', 'ארוך']]);
});

test('club logos: from the club page, with known ids for the site logo files', () => {
  assert.equal(L.clubLogo('9'), 'https://cdn.nivut.org.il/images/clubs/modiin.jpg');
  const page = '<div><img src="/images/logo.png"><img src="https://cdn.nivut.org.il/images/clubs/modiin.jpg" alt="חבל מודיעין"></div>';
  assert.equal(L.parseClubLogo(page, 'https://nivut.org.il/Club/9'), 'https://cdn.nivut.org.il/images/clubs/modiin.jpg');
  assert.equal(L.parseClubLogo("<img src='../images/clubs/tec.jpg'>", 'https://nivut.org.il/Club/7'), 'https://nivut.org.il/images/clubs/tec.jpg');
  assert.equal(L.parseClubLogo('<img src="/x.png">', 'https://nivut.org.il/Club/7'), '');
});

test('early-registration deadline: meta, other labels, free text', () => {
  const base = fx('event.html');
  assert.equal(L.parseEventPage(base, 'https://nivut.org.il/3379/Info').registrationDeadline, '2026-10-16T18:00');
  const noMeta = base.replace(/<meta itemprop="availabilityEnds"[^>]*>/, '');
  const withRow = noMeta.replace('<tr><td>הרשמה במקום', '<tr><td>סיום הרשמה מוקדמת</td><td colspan="2">15/10/2026 20:00</td></tr><tr><td>הרשמה במקום');
  assert.equal(L.parseEventPage(withRow, 'https://nivut.org.il/3379/Info').registrationDeadline, '2026-10-15T20:00');
  const dateOnly = noMeta.replace('<tr><td>הרשמה במקום', '<tr><td>הרשמה עד</td><td colspan="2">14/10/2026</td></tr><tr><td>הרשמה במקום');
  assert.equal(L.parseEventPage(dateOnly, 'https://nivut.org.il/3379/Info').registrationDeadline, '2026-10-14T23:59');
  const sentence = noMeta.replace('<p>אימון ניווט מקומי.</p>', '<p>ההרשמה המוקדמת עד יום רביעי 14/10 בשעה 20:00.</p>');
  assert.equal(L.parseEventPage(sentence, 'https://nivut.org.il/3379/Info').registrationDeadline, '2026-10-14T20:00');
  assert.equal(L.parseEventPage(noMeta, 'https://nivut.org.il/3379/Info').registrationDeadline, '');
});

test('forum: attached images and files', () => {
  const base = fx('forum.html');
  // a lazy-image attribute on the message's image
  const lazy = base.replace('<img id="Image_101" src="LoadImage.png" class="imgThumbnail">',
    '<img id="Image_101" src="LoadImage.png" lsrc="https://cdn.nivut.org.il/uploads/64dddd82-45dc-4e47-9768-4bac6592ace5_calendar-mockup2.jpg" class="imgThumbnail">');
  let t = L.parseForum(lazy, 'https://nivut.org.il/forums/');
  assert.deepEqual(t[0].replies[0].images, ['https://cdn.nivut.org.il/uploads/64dddd82-45dc-4e47-9768-4bac6592ace5_calendar-mockup2.jpg']);
  // only a script knows the image: found by the message id
  const scripted = base.replace('</main>', `</main><script>var imgs = {"101": "https:\\/\\/cdn.nivut.org.il\\/uploads\\/abc_photo.png"};</script>`);
  t = L.parseForum(scripted, 'https://nivut.org.il/forums/');
  assert.deepEqual(t[0].replies[0].images, ['https://cdn.nivut.org.il/uploads/abc_photo.png']);
  assert.deepEqual(t[0].images, []);
  // linked files keep their address
  const withFile = base.replace('<p>בוקר טוב,</p>', '<p>בוקר טוב, <a href="https://cdn.nivut.org.il/uploads/c22af5d5-4d48-4146-81b4-cb2b257593b1_TelMichal-results.html">תוצאות</a></p>');
  t = L.parseForum(withFile, 'https://nivut.org.il/forums/');
  assert.deepEqual(t[0].files, [{ url: 'https://cdn.nivut.org.il/uploads/c22af5d5-4d48-4146-81b4-cb2b257593b1_TelMichal-results.html', name: 'תוצאות', file: 'TelMichal-results.html' }]);
});

test('event page: "מידע נוסף", closed-event note and "אין מידע" fields', () => {
  // Modelled on the "פרדסי עין ורד" page: a closed event, empty fields read "אין מידע".
  const html = fx('event.html')
    .replace('<td colspan="3">אימון עם מסלולים כמו בליגה</td>', '<td colspan="3"> - אירוע סגור - </td>')
    .replace('<td colspan="2">הרשמה מקוונת עד גמר המפות</td>', '<td colspan="2"> אין מידע </td>')
    .replace('<td colspan="2">מכביש 1 במחלף ענבה.</td>', '<td colspan="2"> אין מידע </td>')
    .replace(/<td>שם המפה\s*<\/td><td>[\s\S]*?<\/td>\s*<td rowspan="4">[\s\S]*?<\/td><\/tr>/, '<td>שם המפה</td><td> אין מידע </td></tr>')
    .replace(/(itemprop="description">)[\s\S]*?(<\/td>)/, '$1<p>אירוע לתושבי היישוב, חברים ומשפחות.</p>\n<p>מסלול תחרותי למרחק 4 ק"מ</p>$2');
  const d = L.parseEventPage(html, 'https://nivut.org.il/3400/Info');
  assert.deepEqual(d.description, ['אירוע לתושבי היישוב, חברים ומשפחות.', 'מסלול תחרותי למרחק 4 ק"מ']);
  assert.match(d.note, /אירוע סגור/);
  assert.equal(d.onsite, '');
  assert.deepEqual(d.directions, []);
  assert.equal(d.map, null);
});

test('event page: coordinates from the map script when there is no geo markup', () => {
  const html = fx('event.html')
    .replace(/<span itemprop="geo">[\s\S]*?<\/span>/, '')
    .replace(/<a href="waze:[^"]*">Waze<\/a>/, '')
    .replace('</body>', `<script>function initialize(){ var myMapLocation = [32.2654914855957,34.9321823120117,17];
var eMarkers = [\n['כינוס',32.2655410766602,34.932056427002,false,1],]; }</script></body>`);
  const d = L.parseEventPage(html, 'https://nivut.org.il/3400/Info');
  assert.equal(d.lat, 32.265541);
  assert.equal(d.lng, 34.932056);
  assert.equal(d.wazeLL, '32.265541,34.932056');
});

test('eventFlags: "אין הרשמה באתר" in מידע נוסף; "אירוע סגור" there or under the name', () => {
  assert.deepEqual(L.eventFlags({ title: 'פרדסי עין ורד', details: { description: ['אירוע סגור לתושבי היישוב'] } }), { closed: true, noSiteRegistration: false });
  assert.deepEqual(L.eventFlags({ title: 'מרכז מצוינות', details: { description: ['למי מיועד?', '*אין הרשמה באתר*'] } }), { closed: false, noSiteRegistration: true });
  // "אירוע סגור" also counts in the line under the name; the title and the home-page blurb do not
  assert.deepEqual(L.eventFlags({ title: 'פרדסים', details: { note: '- אירוע סגור -', description: [] } }), { closed: true, noSiteRegistration: false });
  assert.deepEqual(L.eventFlags({ title: 'אירוע סגור', summary: 'אין הרשמה באתר', details: { description: [] } }), { closed: false, noSiteRegistration: false });
  // direction marks and no-break spaces between the words
  assert.equal(L.eventFlags({ details: { description: ['*אין\u200f הרשמה\u00a0באתר*'] } }).noSiteRegistration, true);
  assert.deepEqual(L.eventFlags({ title: 'ליגה', details: { description: ['אין הרשמה במקום', 'ללא הרשמה מראש'] } }), { closed: false, noSiteRegistration: false });
});

test('event page: "מידע נוסף" found by its label when the cell has no itemprop', () => {
  const html = fx('event.html').replace(/<td colspan="2" itemprop="description">/, '<td colspan="2">')
    .replace(/(<td>מידע נוסף<\/td><td colspan="2">)[\s\S]*?(<\/td>)/, '$1<p>מרכז מצוינות</p><p>*אין הרשמה באתר*</p>$2');
  const d = L.parseEventPage(html, 'https://nivut.org.il/3600/Info');
  assert.deepEqual(d.description, ['מרכז מצוינות', '*אין הרשמה באתר*']);
  assert.equal(L.eventFlags({ details: d }).noSiteRegistration, true);
});

test('event page: "קבצים ונספחים" box, file kinds and the results page', () => {
  const box = `<div id="ctl00_ContentPlaceHolder1_dvAttachments"><fieldset><h3 class="tight">קבצים ונספחים</h3><ul class="tight">
    <li><a href="https://cdn.nivut.org.il/uploads/a_Planner%20Notes.pdf" target="_blank"> דבר המתכנן</a><br></li>
    <li><a href="https://cdn.nivut.org.il/uploads/b_starts.pdf" target="_blank">זמני זינוק</a></li>
    <li><a href="https://www.livelox.com/Viewer/x" target="_blank">Livelox</a></li></ul></fieldset></div>`;
  // the fixture's results button is disabled; here the results are out
  const html = fx('event.html').replace('class="RadButton rbDisabled" disabled="disabled">', 'class="RadButton">').replace('</body>', `${box}</body>`);
  const d = L.parseEventPage(html, 'https://nivut.org.il/3110/Info');
  assert.deepEqual(d.attachments.map((f) => [f.name, f.kind]), [['תוצאות', 'results'], ['דבר המתכנן', 'planner'], ['זמני זינוק', 'starts'], ['Livelox', 'analysis']]);
  assert.equal(d.attachments[0].url, 'https://nivut.org.il/3110/Results');
  assert.equal(L.fileKind('LIVE RESULTS', 'https://x'), 'results');
  assert.equal(L.fileKind('LapCombat', 'x.html'), 'analysis');
  assert.equal(L.fileKind('מפת הגעה', 'x.pdf'), 'other');
});
