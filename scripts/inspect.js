'use strict';
// Checks the parser against the live site: node scripts/inspect.js
const { PAGES, fetchHtml, parseEvents, parseForum, findForumUrl } = require('../lib/nivut');

(async () => {
  for (const url of [PAGES.calendar, PAGES.home, PAGES.english]) {
    try {
      const { html, url: final } = await fetchHtml(url);
      const events = parseEvents(html, final);
      console.log(`\n== ${final}  (${html.length} chars, ${events.length} events)`);
      events.slice(0, 8).forEach((e) => console.log(`  ${e.date} ${e.time || '     '} [${e.type}] ${e.title} | ${e.location} | ${e.url}`));
      if (url === PAGES.home) {
        const forum = process.env.NIVUT_FORUM_URL || findForumUrl(html, final);
        console.log(`\n  forum link: ${forum || '(not found)'}`);
        if (forum) {
          const f = await fetchHtml(forum);
          const topics = parseForum(f.html, f.url);
          console.log(`  ${topics.length} topics`);
          topics.slice(0, 8).forEach((t) => console.log(`   - ${t.title} (${t.replies ?? '?'}) ${t.lastActivity}`));
        }
      }
    } catch (err) {
      console.log(`\n== ${url}\n  ERROR: ${err.message}`);
    }
  }
})();
