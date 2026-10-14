'use strict';
// Reads pages from the association's site (nivut.org.il) and turns them into clean JSON.
// Parsers for the home page, event pages and the forum follow the site's real markup
// (ASP.NET + Telerik). Calendar.aspx is parsed with a strict generic table parser.

const BASE = (process.env.NIVUT_BASE || 'https://nivut.org.il/').replace(/\/?$/, '/');

const PAGES = {
  home: BASE,
  calendar: new URL('calendar.aspx', BASE).href,
  forum: process.env.NIVUT_FORUM_URL || new URL('forums/', BASE).href,
  english: new URL('english/', BASE).href,
  maps: new URL('Maps/', BASE).href,
  school: new URL('school/Events.aspx', BASE).href,
  results: new URL('results/default.aspx', BASE).href,
  council: new URL('council/', BASE).href,
  contact: new URL('info/Contactform.aspx', BASE).href,
  starter: new URL('info/StarterGuide.aspx', BASE).href,
};

/* ---------- HTML helpers ---------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', shy: '' };

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
  return decodeEntities(String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Rich text → array of plain paragraphs (no markup is passed through). */
function paragraphs(html) {
  return decodeEntities(String(html || '')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(p|li|div|h\d|tr)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map((s) => s.replace(/[ \t\u00a0]+/g, ' ').trim()).filter((s) => s && s !== '•');
}

function absUrl(href, pageUrl) {
  try { return new URL(decodeEntities(href).trim(), pageUrl).href; } catch { return ''; }
}

function linksOf(html, pageUrl) {
  const out = [];
  const re = /<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = decodeEntities(m[2]).trim();
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) continue;
    const abs = absUrl(href, pageUrl);
    if (abs) out.push({ href: abs, text: textOf(m[3]) });
  }
  return out;
}

/** Inner HTML of the <fieldset> whose <legend> matches. */
function fieldsetByLegend(html, legendRe) {
  const re = /<legend\b[^>]*>([\s\S]*?)<\/legend>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (legendRe.test(textOf(m[1]))) {
      const end = html.indexOf('</fieldset>', re.lastIndex);
      return html.slice(re.lastIndex, end === -1 ? undefined : end);
    }
  }
  return '';
}

/** Splits HTML into chunks, each starting at a match of `re`. */
function chunksBy(html, re) {
  const idx = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m;
  while ((m = g.exec(html))) idx.push(m.index);
  return idx.map((start, i) => html.slice(start, idx[i + 1]));
}

const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/* ---------- Dates ---------- */

const DATE_RE = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?!\d)/;
const DM_RE = /(?<![\d./-])(\d{1,2})[./](\d{1,2})(?![\d./-]*\d{2,})/;
const ISO_RE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/;
const TIME_RE = /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/;
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const validDM = (d, m) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

function parseDate(text) {
  let m = ISO_RE.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Day range "23-24.10.26" → first day.
  m = /(?<!\d)(\d{1,2})-\d{1,2}[./](\d{1,2})[./](\d{2}|\d{4})(?!\d)/.exec(text);
  if (m && validDM(+m[1], +m[2])) return iso(m[3].length === 2 ? `20${m[3]}` : m[3], +m[2], +m[1]);
  for (const d of text.matchAll(new RegExp(DATE_RE.source, 'g'))) {
    if (validDM(+d[1], +d[2])) return iso(d[3].length === 2 ? `20${d[3]}` : d[3], +d[2], +d[1]);
  }
  // "שבת, 17 אוקטובר, 2026"
  m = new RegExp(`(\\d{1,2})\\s+(?:ב)?(${HE_MONTHS.join('|')}),?\\s+(\\d{4})`).exec(text);
  if (m) return iso(m[3], HE_MONTHS.indexOf(m[2]) + 1, +m[1]);
  return null;
}

/** dd/mm without a year → the nearest sensible year around `ref`. */
function inferYear(d, m, ref = new Date()) {
  let y = ref.getFullYear();
  const t = new Date(y, m - 1, d);
  if (t < new Date(ref.getTime() - 120 * 864e5)) y += 1;
  else if (t > new Date(ref.getTime() + 245 * 864e5)) y -= 1;
  return iso(y, m, d);
}

function dateFromTitle(text, ref) {
  const full = parseDate(text);
  if (full) return full;
  const m = DM_RE.exec(text);
  return m && validDM(+m[1], +m[2]) ? inferYear(+m[1], +m[2], ref) : null;
}

/** Removes "יום שבת 17/10" style fragments from a title. */
function cleanTitle(t) {
  return t
    .replace(/(?:יום\s+)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)\s+(?=\d{1,2}[./]\d{1,2})/g, '')
    .replace(/\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?/g, '')
    .replace(/\s*[-–]\s*(?=[-–]|$)/g, '')
    .replace(/^[\s\-–|:,]+|[\s\-–|:,]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ---------- Classification ---------- */

const DISCIPLINES = { Foot: 'foot', Mbo: 'mtbo', Ammi: 'ammi' };

const TAGS = [
  ['champ', /אליפות/],
  ['league', /(?<!כמו\s[בה]?)(?:ליגה|ליגת)/],
  ['sprint', /ספרינט|מאוץ|sprint/i],
  ['night', /לילה|לילי/],
  ['training', /אימון|מודל|סדנ|הדרכ|קורס/],
  ['rogaine', /רוגיין|rogain|סקור/i],
  ['school', /בתי\s?ספר|בית\s?ספר|בי"ס/],
  ['relay', /שליחים|relay/i],
];
const tagsOf = (text) => TAGS.filter(([, re]) => re.test(text)).map(([k]) => k);

/* ---------- Home page ---------- */

function parseFeatured(html, pageUrl, ref) {
  const section = fieldsetByLegend(html, /^ארועים$|^אירועים$/);
  return chunksBy(section, /<div class="title">/).map((chunk) => {
    const link = /<a\b[^>]*href="([^"]+)"[^>]*>\s*<span>([\s\S]*?)<\/span>\s*<\/a>/.exec(chunk);
    if (!link) return null;
    const url = absUrl(link[1], pageUrl);
    const rawTitle = textOf(link[2]);
    const disciplines = [...chunk.matchAll(/_img(Foot|Mbo|Ammi)"/g)].map((m) => DISCIPLINES[m[1]]);
    const descM = /<div class="msgBody">\s*([^<]+?)\s*<\/div>/.exec(chunk);
    const imgM = /<img\b[^>]*class="boxed"[^>]*\bsrc="([^"]+)"/.exec(chunk) || /<img\b[^>]*class="boxed"[^>]*\blsrc="([^"]+)"/.exec(chunk);
    const slug = /(\d{1,2})-(\d{1,2})-(\d{4})(?:$|[/?#])/.exec(decodeURIComponent(url));
    const date = dateFromTitle(rawTitle, ref) || (slug && validDM(+slug[1], +slug[2]) ? iso(slug[3], +slug[2], +slug[1]) : null);
    const id = /\/(\d+)\/info/i.exec(url)?.[1] || hash(url);
    return {
      id: `n${id}`,
      nivutId: /^\d+$/.test(id) ? id : null,
      date,
      time: '',
      title: cleanTitle(rawTitle) || rawTitle,
      fullTitle: rawTitle,
      disciplines: [...new Set(disciplines)],
      tags: tagsOf(rawTitle),
      summary: descM ? textOf(descM[1]) : '',
      image: imgM ? absUrl(imgM[1], pageUrl) : '',
      url,
      source: 'featured',
    };
  }).filter((e) => e && e.date);
}

function parseClosedAreas(html, pageUrl) {
  const section = fieldsetByLegend(html, /שטחים סגורים/);
  const out = [];
  for (const tr of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (cells.length < 3) continue;
    const date = parseDate(textOf(cells[1]));
    const name = textOf(cells[2]);
    if (!date || !name) continue;
    const icon = /src="([^"]+)"/.exec(cells[0])?.[1] || '';
    out.push({ date, name, discipline: /mbo|bike/i.test(icon) ? 'mtbo' : 'foot' });
  }
  return out;
}

function parseNews(html, pageUrl) {
  const start = html.search(/<legend\b[^>]*>\s*חדשות/);
  if (start === -1) return [];
  const end = html.indexOf('</fieldset>', start);
  const section = html.slice(start, end === -1 ? undefined : end);
  return chunksBy(section, /<div class="title">/).map((chunk) => {
    const link = /<a\b[^>]*href="([^"]+)"[^>]*>\s*<span>([\s\S]*?)<\/span>/.exec(chunk);
    if (!link) return null;
    const head = /class="eventsTypeImage"[^>]*>([\s\S]*?)<\/div>/.exec(chunk)?.[1] || '';
    const summary = /<\/a>\s*<\/div>\s*<div>\s*<div>([\s\S]*?)<\/div>/.exec(chunk)?.[1] || '';
    return {
      id: hash(link[1]),
      date: parseDate(textOf(head)),
      category: textOf(head).split(/קטגוריה:/)[1]?.trim() || '',
      title: textOf(link[2]),
      summary: textOf(summary),
      url: absUrl(link[1], pageUrl),
    };
  }).filter(Boolean);
}

function parseHome(html, pageUrl, ref = new Date()) {
  const clean = stripScripts(html);
  return {
    featured: parseFeatured(clean, pageUrl, ref),
    closedAreas: parseClosedAreas(clean, pageUrl),
    news: parseNews(clean, pageUrl),
  };
}

/* ---------- Event page (/{id}/Info) ---------- */

function labelCell(html, label) {
  const l = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/"/g, '(?:"|&quot;)');
  const m = new RegExp(`<td\\b[^>]*>\\s*${l}\\s*</td>\\s*<td\\b[^>]*>([\\s\\S]*?)</td>`).exec(html);
  return m ? m[1] : null;
}

/** Fixes parentheses that the site stores reversed for RTL, e.g. ")יער(". */
const fixParens = (s) => s.replace(/\)([^()]*)\(/g, '($1)');

function parseEventPage(html, pageUrl) {
  const h = stripScripts(html);
  const nameM = /itemprop="name">\s*<span\b[^>]*>([\s\S]*?)<\/span>([\s\S]*?)<\/div>/.exec(h);
  const startM = /itemprop="startDate"\s+datetime="([^"]+)"/.exec(h);
  const boldLines = [...h.matchAll(/<tr class="boldLine">\s*<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => textOf(m[1]));
  const date = startM ? startM[1].slice(0, 10) : parseDate(boldLines.join(' '));
  const starts = textOf(labelCell(h, 'זינוקים'));
  const times = starts.match(new RegExp(TIME_RE.source, 'g')) || [];

  // Course table: rows of (name, distance) inside the "מסלולים" cell.
  const coursesHtml = /<td>\s*מסלולים\s*<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>\s*<tr>\s*<td>\s*הרשמה/.exec(h)?.[1] || '';
  const courses = [...coursesHtml.matchAll(/<tr>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/g)]
    .map((m) => ({ name: textOf(m[1]), distance: textOf(m[2]).replace(/'/g, '"') }))
    .filter((c) => c.name && c.name !== 'מסלול');

  const clubCell = labelCell(h, 'מועדון מארגן') || '';
  const clubLink = linksOf(clubCell, pageUrl)[0];
  const mapCell = labelCell(h, 'שם המפה') || '';
  const mapLink = linksOf(mapCell, pageUrl)[0];
  const mapImg = /<a\b[^>]*href="([^"]+\.(?:gif|png|jpe?g))"[^>]*target="_blank"><img\b[^>]*id="Image2"/i.exec(h)?.[1];
  const priceCell = labelCell(h, 'הרשמה מראש') || '';
  const lat = /itemprop="latitude"\s+content="([\d.]+)"/.exec(h)?.[1];
  const lng = /itemprop="longitude"\s+content="([\d.]+)"/.exec(h)?.[1];
  const waze = /href="waze:\/\/\?ll=([\d.]+),([\d.]+)/.exec(h);
  const deadlineIso = /itemprop="availabilityEnds"\s+content="([^"]+)"/.exec(h)?.[1] || '';
  const resultsBtn = /<button\b[^>]*name="ctl00\$ContentPlaceHolder1\$rbResults"[^>]*>/.exec(h)?.[0] || '';

  return {
    nivutId: /\/(\d+)\/info/i.exec(pageUrl)?.[1] || null,
    url: pageUrl,
    name: nameM ? textOf(nameM[1]) : '',
    eventType: nameM ? fixParens(textOf(nameM[2])) : '',
    date,
    note: boldLines.filter((l) => !parseDate(l)).join(' · '),
    startFrom: times[0] || (startM?.[1].slice(11, 16) ?? ''),
    startTo: times[1] || '',
    cutoff: textOf(labelCell(h, 'שעת גג')),
    courses,
    price: textOf(priceCell.replace(/<div\b[\s\S]*$/, '')).replace(/\s+\(/g, ' ('),
    priceNonMember: textOf(/dvNonMemberPrice"[^>]*>([\s\S]*?)<\/div>/.exec(priceCell)?.[1] || ''),
    registrationDeadline: deadlineIso || (parseDate(textOf(labelCell(h, 'הרשמה מוקדמת עד'))) ?? ''),
    onsite: textOf(labelCell(h, 'הרשמה במקום')),
    club: clubLink ? { name: clubLink.text, url: clubLink.href } : (textOf(clubCell) ? { name: textOf(clubCell), url: '' } : null),
    planner: textOf(labelCell(h, 'תכנון מסלולים')),
    controller: textOf(labelCell(h, 'בקרת מסלולים')),
    director: textOf(labelCell(h, 'ניהול ארוע')),
    contact: textOf(labelCell(h, 'פרטי התקשרות')),
    map: mapLink || mapCell ? {
      name: mapLink?.text || textOf(mapCell),
      url: mapLink?.href || '',
      image: mapImg ? absUrl(mapImg, pageUrl) : '',
      terrain: textOf(labelCell(h, 'סוג שטח')),
      scale: textOf(labelCell(h, 'קנ"מ')),
      year: textOf(labelCell(h, 'תאריך מיפוי')),
    } : null,
    directions: paragraphs(labelCell(h, 'הוראות הגעה')),
    attachments: linksOf(labelCell(h, 'קבצים ונספחים') || '', pageUrl).map((l) => ({ name: l.text, url: l.href })),
    description: paragraphs(/<td\b[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/td>/.exec(h)?.[1]),
    lat: lat ? +lat : (waze ? +waze[1] : null),
    lng: lng ? +lng : (waze ? +waze[2] : null),
    wazeLL: waze ? `${waze[1]},${waze[2]}` : (lat && lng ? `${lat},${lng}` : ''),
    resultsAvailable: !!resultsBtn && !/rbDisabled|disabled/.test(resultsBtn),
  };
}

/* ---------- Forum (/forums/) ---------- */

/** "117 ימים" / "17 ש' 15 דק'" → minutes ago. */
function ageMinutes(text) {
  let min = 0;
  let any = false;
  const add = (re, k) => { const m = re.exec(text); if (m) { min += +m[1] * k; any = true; } };
  add(/(\d+)\s*(?:ימים|יום)/, 1440);
  add(/(\d+)\s*(?:שבועות|שבוע)/, 10080);
  add(/(\d+)\s*(?:חודשים|חודש)/, 43200);
  add(/(\d+)\s*(?:ש'|שעות|שעה)/, 60);
  add(/(\d+)\s*(?:דק'|דקות|דקה)/, 1);
  return any ? min : null;
}

function parseMessage(chunk, id, now) {
  const headline = textOf(/class="MsgHeadline">\s*<span\b[^>]*>([\s\S]*?)<\/span>/.exec(chunk)?.[1]);
  const author = /<a class="RegUser" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(chunk);
  const meta = /class="forum-msg-meta">([\s\S]*?)<\/div>/.exec(chunk)?.[1] || '';
  const ageText = textOf([...meta.matchAll(/<span class="">([\s\S]*?)<\/span>/g)].pop()?.[1] || '');
  const mins = ageMinutes(ageText);
  const bodyStart = chunk.indexOf(`id="tx${id}">`);
  let body = '';
  if (bodyStart !== -1) {
    const from = bodyStart + `id="tx${id}">`.length;
    const to = chunk.indexOf('class="forum-msg-actions"', from);
    body = chunk.slice(from, to === -1 ? undefined : to).replace(/<\/div>\s*<div\s*$/, '');
  }
  return {
    id,
    title: headline,
    author: author ? textOf(author[2]) : '',
    ageText,
    postedAt: mins === null ? '' : new Date(now - mins * 60000).toISOString(),
    body: paragraphs(body).filter((l) => !/^הודעה זו נערכה/.test(l)),
    hasImage: new RegExp(`id="Image_${id}"`).test(chunk),
    links: linksOf(body, PAGES.forum).filter((l) => /^https?:/.test(l.href)).map((l) => l.href),
  };
}

function parseForum(html, pageUrl, now = Date.now()) {
  const h = stripScripts(html);
  return chunksBy(h, /<div class="clsParent"/).map((chunk) => {
    const id = /id="Parent(\d+)"/.exec(chunk)?.[1];
    if (!id) return null;
    const childStart = chunk.indexOf(`id="ChildGroup${id}"`);
    const head = childStart === -1 ? chunk : chunk.slice(0, childStart);
    const lead = textOf(head.slice(0, head.indexOf('class="MsgHeadline"')));
    const msg = parseMessage(head, id, now);
    const replies = childStart === -1 ? [] : chunksBy(chunk.slice(childStart), /<div class="childMsg"/).map((c) => {
      const cid = /id="Icon(\d+)"/.exec(c)?.[1];
      return cid ? parseMessage(c, cid, now) : null;
    }).filter(Boolean);
    const times = [msg.postedAt, ...replies.map((r) => r.postedAt)].filter(Boolean).sort();
    return {
      ...msg,
      url: pageUrl,
      announcement: /\[הכרזה\]/.test(lead),
      pinned: /\[דביק\]/.test(lead),
      replyCount: replies.length || +(/\[(\d+)\]/.exec(lead)?.[1] || 0),
      lastActivity: times[times.length - 1] || '',
      replies,
    };
  }).filter(Boolean);
}

/* ---------- Calendar.aspx (structure not yet verified: strict generic parser) ---------- */

const COLS = {
  date: /תאריך|date|מועד/i,
  title: /שם|אירוע|ארוע|תחרות|event|name/i,
  location: /מקום|מיקום|אתר|אזור|location|place|venue/i,
  club: /מארגן|מועדון|club|organi[sz]er/i,
  type: /סוג|type|קטגורי|category/i,
};

function parseCalendar(html, pageUrl) {
  // Remove sidebar boxes so their small tables can't be mistaken for the calendar.
  const h = stripScripts(html).replace(/<fieldset\b[\s\S]*?<\/fieldset>/gi, '');
  const events = [];
  let header = null;
  for (const tr of h.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map((c) => ({ html: c[2], text: textOf(c[2]) }));
    if (!cells.length) continue;
    const map = {};
    cells.forEach((c, i) => {
      for (const [k, re] of Object.entries(COLS)) if (map[k] === undefined && c.text.length < 25 && re.test(c.text)) { map[k] = i; break; }
    });
    if (map.date !== undefined && map.title !== undefined && !cells.some((c) => DATE_RE.test(c.text))) { header = map; continue; }
    if (!header || Math.max(...Object.values(header)) >= cells.length) continue;
    const date = parseDate(cells[header.date].text);
    const titleCell = cells[header.title];
    if (!date || !titleCell.text) continue;
    const link = linksOf(titleCell.html, pageUrl)[0] || linksOf(tr[1], pageUrl)[0];
    const pick = (k) => (header[k] !== undefined ? cells[header[k]].text : '');
    const id = link && /\/(\d+)\/info/i.exec(link.href)?.[1];
    events.push({
      id: id ? `n${id}` : `c${hash(date + titleCell.text)}`,
      nivutId: id || null,
      date,
      time: TIME_RE.exec(tr[1])?.[0] || '',
      title: titleCell.text,
      fullTitle: titleCell.text,
      location: pick('location'),
      clubName: pick('club'),
      eventType: pick('type'),
      disciplines: /רכוב|אופני|mtbo/i.test(pick('type') + titleCell.text) ? ['mtbo'] : ['foot'],
      tags: tagsOf(`${pick('type')} ${titleCell.text}`),
      url: link?.href || pageUrl,
      source: 'calendar',
    });
  }
  return events;
}

/* ---------- Fetching with cache ---------- */

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; nivut-wrapper/1.0)', accept: 'text/html,*/*', 'accept-language': 'he,en;q=0.8' },
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
const inflight = new Map();

/** Cached loader: refreshes after TTL, serves stale data when the source is down, shares in-flight requests. */
async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const value = await loader();
      cache.set(key, { at: Date.now(), value });
      return value;
    } catch (err) {
      if (hit) return { ...hit.value, stale: true, error: String(err.message || err) };
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

const getHome = () => cached('home', async () => {
  const page = await fetchHtml(PAGES.home);
  return { ...parseHome(page.html, page.url), source: page.url, fetchedAt: new Date().toISOString() };
});

const getEventPage = (url) => cached(`event:${url}`, async () => {
  const page = await fetchHtml(url);
  return parseEventPage(page.html, page.url);
});

const words = (s) => new Set(String(s).split(/[\s\-–,|:()"'./]+/).map((w) => w.replace(/^[בהלמו](?=\S{3,})/, '')).filter((w) => w.length > 2));
const overlap = (a, b) => { const B = words(b); return [...words(a)].some((w) => B.has(w)); };

/** Merges featured events (with event-page details), calendar rows and closed areas. */
function mergeEvents({ featured, closedAreas }, details, calendar) {
  const events = featured.map((e) => {
    const d = details.get(e.url);
    const area = closedAreas.find((a) => a.date === (d?.date || e.date) && overlap(a.name, `${e.fullTitle} ${d?.name || ''}`));
    return {
      ...e,
      date: d?.date || e.date,
      time: d?.startFrom || '',
      location: d?.map?.name?.replace(/\s*\[[^\]]*\]\s*$/, '') || area?.name || d?.name || '',
      clubName: d?.club?.name || '',
      eventType: d?.eventType || '',
      // The event-page category (e.g. "ליגת ניווט רגלי") names the discipline, not a league round.
      tags: [...new Set([...tagsOf(`${e.fullTitle} ${d?.note || ''}`), ...tagsOf(d?.eventType || '').filter((t) => t !== 'league')])],
      details: d || null,
    };
  });
  const sameEvent = (a, b) => a.date === b.date && overlap(a.title, `${b.fullTitle || b.title} ${b.location || ''}`);
  for (const c of calendar) if (!events.some((e) => (c.nivutId && c.nivutId === e.nivutId) || sameEvent(c, e))) events.push(c);
  for (const a of closedAreas) {
    if (events.some((e) => e.date === a.date && overlap(a.name, `${e.fullTitle || e.title} ${e.location || ''}`))) continue;
    events.push({
      id: `a${hash(a.date + a.name)}`, nivutId: null, date: a.date, time: '', title: a.name, fullTitle: a.name,
      location: a.name, disciplines: [a.discipline], tags: [], url: PAGES.calendar, source: 'closed-area',
    });
  }
  return events.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

async function getEvents() {
  return cached('events', async () => {
    const home = await getHome();
    const [detailResults, calendar] = await Promise.all([
      Promise.allSettled(home.featured.map((e) => getEventPage(e.url))),
      fetchHtml(PAGES.calendar).then((p) => parseCalendar(p.html, p.url)).catch(() => []),
    ]);
    const details = new Map();
    detailResults.forEach((r, i) => { if (r.status === 'fulfilled') details.set(home.featured[i].url, r.value); });
    return {
      source: home.source,
      fetchedAt: new Date().toISOString(),
      events: mergeEvents(home, details, calendar),
      counts: { featured: home.featured.length, details: details.size, calendar: calendar.length, closedAreas: home.closedAreas.length },
    };
  });
}

const getNews = async () => {
  const home = await getHome();
  return { source: home.source, fetchedAt: home.fetchedAt, news: home.news, stale: home.stale };
};

const getForum = () => cached('forum', async () => {
  const page = await fetchHtml(PAGES.forum);
  return { source: page.url, fetchedAt: new Date().toISOString(), threads: parseForum(page.html, page.url) };
});

module.exports = {
  PAGES, fetchHtml, getEvents, getNews, getForum, getEventPage,
  parseHome, parseEventPage, parseForum, parseCalendar, mergeEvents,
  parseDate, dateFromTitle, cleanTitle, tagsOf, ageMinutes, paragraphs,
};
