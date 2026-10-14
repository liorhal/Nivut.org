'use strict';
// Checks the parsers against the live site: npm run inspect
const L = require('../lib/nivut');

const show = (label, fn) => fn().catch((err) => console.log(`\n== ${label}\n  ERROR: ${err.message}`));

(async () => {
  await show('home', async () => {
    const { html, url } = await L.fetchHtml(L.PAGES.home);
    const h = L.parseHome(html, url);
    console.log(`\n== ${url}`);
    console.log(`  featured events: ${h.featured.length}`);
    h.featured.forEach((e) => console.log(`   ${e.date} [${e.disciplines}] [${e.tags}] ${e.title} → ${e.url}`));
    console.log(`  closed areas: ${h.closedAreas.length}`);
    h.closedAreas.forEach((a) => console.log(`   ${a.date} [${a.discipline}] ${a.name}`));
    console.log(`  news: ${h.news.length}`);
    h.news.forEach((n) => console.log(`   ${n.date} ${n.title}`));
    if (h.featured[0]) {
      const d = await L.getEventPage(h.featured[0].url);
      console.log(`\n  first event page: ${d.name} | ${d.eventType} | ${d.date} ${d.startFrom}-${d.startTo} | ${d.courses.length} courses | club ${d.club?.name} | ${d.lat},${d.lng}`);
    }
  });
  await show('calendar', async () => {
    const { html, url } = await L.fetchHtml(L.PAGES.calendar);
    const ev = L.parseCalendar(html, url);
    console.log(`\n== ${url}  (${ev.length} rows parsed${ev.length ? '' : ' – calendar layout not recognised yet'})`);
    ev.slice(0, 10).forEach((e) => console.log(`   ${e.date} ${e.title} | ${e.location} → ${e.url}`));
  });
  await show('forum', async () => {
    const { html, url } = await L.fetchHtml(L.PAGES.forum);
    const t = L.parseForum(html, url);
    console.log(`\n== ${url}  (${t.length} threads)`);
    t.slice(0, 10).forEach((x) => console.log(`   ${x.ageText.padEnd(14)} [${x.replyCount}] ${x.title} — ${x.author}`));
  });
})();
