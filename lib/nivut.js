'use strict';
// Fetches pages from the association's site and turns them into clean JSON.
// The source HTML is not under our control, so parsing is deliberately tolerant:
// it looks for table rows that contain a date and maps columns by header text.

const BASE = (process.env.NIVUT_BASE || 'https://nivut.org.il/').replace(/\/?$/, '/');

const PAGES = {
  home: BASE,
  calendar: new URL('calendar.aspx', BASE).href,
  english: new URL('english/', BASE).href,
  maps: new URL('Maps/', BASE).href,
  school: new URL('school/Events.aspx', BASE).href,
  council: new URL('council/', BASE).href,
  contact: new URL('info/Contactform.aspx', BASE).href,
};

/* ---------- HTML helpers ---------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function stripScripts(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '');
}

function textOf(html) {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function linksOf(html, pageUrl) {
  const out = [];
  const re = /<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = decodeEntities(m[2]).trim();
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) continue;
    try { out.push({ href: new URL(href, pageUrl).href, text: textOf(m[3]) }); } catch { /* bad URL */ }
  }
  return out;
}

/** Splits HTML into table rows → cells (with text and links). */
function tableRows(html, pageUrl) {
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(html))) {
    const cells = [];
    const tdRe = /<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi;
    let td;
    while ((td = tdRe.exec(tr[1]))) cells.push({ th: td[1].toLowerCase() === 'h', text: textOf(td[2]), links: linksOf(td[2], pageUrl) });
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/** Fallback for layouts without tables: list items / divs that contain a date. */
function blockRows(html, pageUrl) {
  const rows = [];
  const re = /<(li|div|article|p)\b[^>]*>((?:(?!<\/?\1\b)[\s\S])*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = textOf(m[2]);
    if (text.length > 6 && text.length < 400 && DATE_RE.test(text)) {
      rows.push([{ th: false, text, links: linksOf(m[2], pageUrl) }]);
    }
  }
  return rows;
}

/* ---------- Dates & classification ---------- */

const DATE_RE = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?!\d)/;
const ISO_RE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/;
const TIME_RE = /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/;

function parseDate(text) {
  let m = ISO_RE.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = DATE_RE.exec(text);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = `20${y}`;
  d = +d; mo = +mo;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const TYPES = [
  ['school', /בית\s?ספר|בתי\s?ספר|בי"ס|ביה"ס|school/i],
  ['mtbo', /אופני|MTB|mtbo/i],
  ['night', /לילה|night/i],
  ['rogaine', /רוגיין|rogain|סקור|score|מרתון|אולטרה/i],
  ['sprint', /ספרינט|sprint|עירוני/i],
  ['champ', /אליפות|champion/i],
  ['league', /ליגה|league|מקצה/i],
  ['training', /אימון|הדרכה|סדנ|קורס|training|clinic/i],
];
function classify(text) {
  for (const [key, re] of TYPES) if (re.test(text)) return key;
  return 'other';
}

/* ---------- Column mapping ---------- */

const COLS = {
  date: /תאריך|date|מועד/i,
  day: /^יום$|day/i,
  title: /שם|אירוע|תחרות|event|name|title|כותרת/i,
  location: /מקום|מיקום|אתר|אזור|location|place|venue|site/i,
  club: /מארגן|מועדון|club|organi[sz]er/i,
  type: /סוג|type|קטגורי|category|format/i,
  time: /שעה|time|זינוק|start/i,
};

function mapHeader(cells) {
  const map = {};
  cells.forEach((c, i) => {
    for (const [key, re] of Object.entries(COLS)) {
      if (map[key] === undefined && re.test(c.text) && c.text.length < 30) { map[key] = i; break; }
    }
  });
  return map;
}

const isHeaderRow = (cells) => cells.every((c) => c.th || !DATE_RE.test(c.text)) && Object.keys(mapHeader(cells)).length >= 2;

function rowToEvent(cells, header, pageUrl) {
  const all = cells.map((c) => c.text).join(' | ');
  const dateCell = header?.date !== undefined ? cells[header.date]?.text : null;
  const date = parseDate(dateCell || '') || parseDate(all);
  if (!date) return null;

  const pick = (k) => (header && header[k] !== undefined ? cells[header[k]]?.text || '' : '');
  const links = cells.flatMap((c) => c.links);
  const isDateLike = (t) => DATE_RE.test(t) || ISO_RE.test(t) || /^(יום\s)?[א-ש]['׳]?$/.test(t) || TIME_RE.test(t) && t.length < 8;

  let title = pick('title');
  const titleCell = header?.title !== undefined ? cells[header.title] : null;
  const mainLink = titleCell?.links.find((l) => l.text && !/register|הרשמ|result|תוצא/i.test(l.text));
  if (mainLink) title = mainLink.text;
  if (!title) {
    // Prefer link text, then the longest non-date cell.
    title = links.map((l) => l.text).filter((t) => t && !isDateLike(t)).sort((a, b) => b.length - a.length)[0]
      || cells.map((c) => c.text).filter((t) => t && !isDateLike(t)).sort((a, b) => b.length - a.length)[0] || '';
  }
  if (cells.length === 1) {
    // Free-text block: drop the date to get a title.
    title = title.replace(DATE_RE, '').replace(ISO_RE, '').replace(TIME_RE, '').replace(/^[\s\-–|:,]+|[\s\-–|:,]+$/g, '');
  }
  if (!title) return null;

  const timeM = TIME_RE.exec(pick('time') || all);
  const others = cells.map((c) => c.text).filter((t) => t && t !== title && !isDateLike(t));
  const location = pick('location') || (header ? '' : others[0] || '');
  const club = pick('club');
  const typeLabel = pick('type');
  const details = links.find((l) => !/register|הרשמ|result|תוצא/i.test(l.text + l.href)) || links[0];
  const register = links.find((l) => /register|הרשמ|registration/i.test(l.text + l.href));
  const results = links.find((l) => /result|תוצא/i.test(l.text + l.href));

  return {
    id: `${date}-${hash(title + location)}`,
    date,
    time: timeM ? `${timeM[1].padStart(2, '0')}:${timeM[2]}` : '',
    title,
    type: classify(`${typeLabel} ${title} ${all}`),
    typeLabel,
    location,
    club,
    url: details?.href || pageUrl,
    registerUrl: register?.href || '',
    resultsUrl: results?.href || '',
    raw: cells.map((c) => c.text).filter(Boolean),
  };
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Parses any page of the site into a list of events. */
function parseEvents(html, pageUrl) {
  const clean = stripScripts(html);
  let rows = tableRows(clean, pageUrl);
  const events = [];
  let header = null;
  for (const cells of rows) {
    if (isHeaderRow(cells)) { header = mapHeader(cells); continue; }
    // Header mapping only applies to rows with the same column count.
    const h = header && Object.values(header).every((i) => i < cells.length) ? header : null;
    const ev = rowToEvent(cells, h, pageUrl);
    if (ev) events.push(ev);
  }
  if (!events.length) {
    rows = blockRows(clean, pageUrl);
    for (const cells of rows) { const ev = rowToEvent(cells, null, pageUrl); if (ev) events.push(ev); }
  }
  // De-duplicate (nested tables/blocks can repeat rows) and sort.
  const seen = new Map();
  for (const e of events) {
    const key = `${e.date}|${e.title}`;
    const prev = seen.get(key);
    if (!prev || e.raw.length > prev.raw.length) seen.set(key, e);
  }
  return [...seen.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/* ---------- Forum ---------- */

function findForumUrl(html, pageUrl) {
  const links = linksOf(stripScripts(html), pageUrl);
  const hit = links.find((l) => /פורום|forum/i.test(l.text)) || links.find((l) => /forum/i.test(l.href));
  return hit?.href || null;
}

function parseForum(html, pageUrl) {
  const clean = stripScripts(html);
  const forumHost = new URL(pageUrl).host;
  const topics = [];
  const consider = (cells) => {
    const links = cells.flatMap((c) => c.links).filter((l) => l.text && new URL(l.href).host === forumHost);
    const main = links.filter((l) => l.text.length > 3).sort((a, b) => b.text.length - a.text.length)[0];
    if (!main || /^(הבא|הקודם|next|prev|\d+|»|«)$/i.test(main.text)) return;
    const texts = cells.map((c) => c.text);
    const all = texts.join(' | ');
    const nums = texts.filter((t) => /^\d{1,6}$/.test(t)).map(Number);
    const date = parseDate(all);
    const timeM = TIME_RE.exec(all);
    const authorLink = links.find((l) => l !== main && !/^\d+$/.test(l.text) && l.text.length < 40);
    topics.push({
      id: hash(main.href),
      title: main.text,
      url: main.href,
      author: authorLink?.text || '',
      replies: nums.length ? nums[0] : null,
      views: nums.length > 1 ? nums[1] : null,
      lastActivity: date ? `${date}${timeM ? `T${timeM[1].padStart(2, '0')}:${timeM[2]}:00` : ''}` : '',
      category: '',
    });
  };
  tableRows(clean, pageUrl).forEach((cells) => { if (!cells.every((c) => c.th)) consider(cells); });
  if (!topics.length) {
    const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    let m;
    while ((m = re.exec(clean))) consider([{ text: textOf(m[1]), links: linksOf(m[1], pageUrl) }]);
  }
  const seen = new Set();
  return topics.filter((t) => !seen.has(t.url) && seen.add(t.url));
}

/* ---------- Fetching with cache ---------- */

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; nivut-wrapper/1.0)', accept: 'text/html,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const headerCs = /charset=([\w-]+)/i.exec(res.headers.get('content-type') || '')?.[1];
  const metaCs = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.toString('latin1'))?.[1];
  let charset = (headerCs || metaCs || 'utf-8').toLowerCase();
  if (charset === 'iso-8859-8' || charset === 'iso-8859-8-i') charset = 'windows-1255';
  let html;
  try { html = new TextDecoder(charset).decode(buf); } catch { html = buf.toString('utf8'); }
  return { html, url: res.url || url };
}

const TTL = Number(process.env.CACHE_SECONDS || 600) * 1000;
const cache = new Map();

/** Returns cached value; refreshes after TTL, serves stale data if the source is down. */
async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  try {
    const value = await loader();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    if (hit) return { ...hit.value, stale: true, error: String(err.message || err) };
    throw err;
  }
}

async function getEvents() {
  return cached('events', async () => {
    const tried = [];
    for (const url of [PAGES.calendar, PAGES.home, PAGES.english]) {
      try {
        const page = await fetchHtml(url);
        const events = parseEvents(page.html, page.url);
        tried.push({ url, count: events.length });
        if (events.length) return { source: page.url, fetchedAt: new Date().toISOString(), events, tried };
      } catch (err) {
        tried.push({ url, error: String(err.message || err) });
      }
    }
    const e = new Error('No events could be read from the source site');
    e.tried = tried;
    throw e;
  });
}

async function getForum() {
  return cached('forum', async () => {
    const forumUrl = process.env.NIVUT_FORUM_URL || findForumUrl((await fetchHtml(PAGES.home)).html, PAGES.home);
    if (!forumUrl) return { source: null, fetchedAt: new Date().toISOString(), topics: [] };
    const page = await fetchHtml(forumUrl);
    return { source: page.url, fetchedAt: new Date().toISOString(), topics: parseForum(page.html, page.url) };
  });
}

module.exports = { PAGES, getEvents, getForum, parseEvents, parseForum, findForumUrl, parseDate, classify, fetchHtml };
