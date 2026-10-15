'use strict';
// Reads pages from the association's site (nivut.org.il) and turns them into clean JSON.
// Parsers for the home page, event pages and the forum follow the site's real markup
// (ASP.NET + Telerik). Calendar.aspx is parsed with a strict generic table parser.

const BASE = (process.env.NIVUT_BASE || 'https://nivut.org.il/').replace(/\/?$/, '/');

const CDN = (process.env.NIVUT_CDN || 'https://cdn.nivut.org.il/').replace(/\/?$/, '/');
/** Club logos live on the association's CDN by club id (e.g. club-logos/club2.png). */
const altLogo = (id) => (id ? `${CDN}club-logos/club${id}.png` : '');
// Logos seen on the site (images/clubs/…, as on the club pages /Club/{id}); the club pages are read too.
const KNOWN_LOGOS = { 4: 'galilee.jpg', 5: 'izrael.jpg', 6: 'emeq-hefer.gif', 9: 'modiin.jpg', 11: 'ramathasharon.jpg', 12: 'jerusalem_150.jpg' };
const clubLogo = (id) => (KNOWN_LOGOS[id] ? `${CDN}images/clubs/${KNOWN_LOGOS[id]}` : altLogo(id));
const LEGACY_LOGOS = { galilee: '4', izrael: '5', 'emeq-hefer': '6', modiin: '9', ramathasharon: '11', jerusalem: '12' };
const clubIdFromLogo = (src = '') => /club-logos\/club(\d+)\./i.exec(src)?.[1]
  || LEGACY_LOGOS[/images\/clubs\/([a-z-]+?)(?:_\d+)?\.\w+$/i.exec(src)?.[1]?.toLowerCase()] || '';

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
  ranking: new URL('results/ranking.aspx', BASE).href,
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

// "ניווט עממי" (popular) is foot orienteering.
const DISCIPLINES = { Foot: 'foot', Mbo: 'mtbo', Ammi: 'foot' };

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

function parseClubs(html, pageUrl) {
  const seen = new Map();
  for (const l of linksOf(html, pageUrl)) {
    const id = /\/Club\/(\d+)\/?$/i.exec(l.href)?.[1];
    if (id && l.text && !seen.has(id)) seen.set(id, { id, name: l.text, url: l.href, logo: clubLogo(id), logoAlt: altLogo(id) });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

function parseHome(html, pageUrl, ref = new Date()) {
  const clean = stripScripts(html);
  return {
    clubs: parseClubs(clean, pageUrl),
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

const START_LABELS = ['זינוקים', 'זינוק', 'שעת זינוק', 'שעות זינוק', 'זינוק ראשון', 'שעת התחלה', 'התחלה', 'זינוק המוני'];
const timesIn = (text) => (text.match(new RegExp(TIME_RE.source, 'g')) || [])
  .map((t) => t.padStart(5, '0')).filter((t) => t !== '00:00'); // midnight means "no time given"

/** First and last start: the start-time row, else the cell holding <time itemprop="startDate">, else its datetime. */
function startTimes(h, datetime) {
  for (const label of START_LABELS) {
    const t = timesIn(textOf(labelCell(h, label) || ''));
    if (t.length) return t;
  }
  const cell = /<time\b[^>]*itemprop="startDate"[^>]*>([\s\S]*?)<\/time>([\s\S]*?)<\/td>/i.exec(h);
  if (cell) {
    const t = timesIn(textOf(cell[1] + ' ' + cell[2]));
    if (t.length) return t;
  }
  return timesIn((datetime || '').slice(11, 16));
}

const DEADLINE_LABELS = ['הרשמה מוקדמת עד', 'סיום הרשמה מוקדמת', 'סיום ההרשמה המוקדמת', 'מועד אחרון להרשמה מוקדמת', 'מועד אחרון להרשמה',
  'הרשמה מוקדמת', 'הרשמה מקוונת עד', 'הרשמה עד', 'סגירת הרשמה', 'סגירת ההרשמה'];

/** "16/10/2026 18:00" (or dd/mm near the event date) → "2026-10-16T18:00"; a date alone means the end of that day. */
function deadlineFrom(text, eventDate) {
  const t = String(text || '');
  let day = parseDate(t);
  if (!day) {
    const m = DM_RE.exec(t);
    if (m && validDM(+m[1], +m[2])) day = inferYear(+m[1], +m[2], eventDate ? new Date(`${eventDate}T12:00:00`) : new Date());
  }
  if (!day) return '';
  const time = TIME_RE.exec(t);
  return `${day}T${time ? `${time[1].padStart(2, '0')}:${time[2]}` : '23:59'}`;
}

/** Early-registration deadline: schema.org field, a labelled row, the deadline box, or a sentence about it. */
function registrationDeadline(h, eventDate) {
  const meta = /itemprop="availabilityEnds"\s+content="([^"]+)"/i.exec(h)?.[1];
  if (meta && /^\d{4}-\d{2}-\d{2}/.test(meta)) return meta.length > 10 ? meta.slice(0, 16) : `${meta}T23:59`;
  for (const label of DEADLINE_LABELS) {
    const d = deadlineFrom(textOf(labelCell(h, label) || ''), eventDate);
    if (d) return d;
  }
  const box = /id="dvDeadLine"[^>]*>([\s\S]*?)<\/div>/i.exec(h)?.[1];
  if (box) { const d = deadlineFrom(textOf(box), eventDate); if (d) return d; }
  const sentence = /הרשמ[הת]?\s*(?:ה?מוקדמת|מקוונת)?[^.\n]{0,40}?(?:עד|נסגרת|תיסגר)[^.\n\d]{0,20}(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)(?:[^.\n\d]{0,12}(\d{1,2}:\d{2}))?/.exec(textOf(h));
  return sentence ? deadlineFrom(`${sentence[1]} ${sentence[2] || ''}`, eventDate) : '';
}

/** Fixes parentheses that the site stores reversed for RTL, e.g. ")יער(". */
const fixParens = (s) => s.replace(/\)([^()]*)\(/g, '($1)');

/** The site fills empty fields with "אין מידע" (no information): treat those as empty. */
const NO_INFO = /^(?:אין\s+מידע|לא\s+ידוע)\.?$/;
function withoutNoInfo(v) {
  if (typeof v === 'string') return NO_INFO.test(v.trim()) ? '' : v;
  if (Array.isArray(v)) return v.map(withoutNoInfo).filter((x) => x !== '');
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutNoInfo(x)]));
  return v;
}

/**
 * What a file is, from its name and address: the planner's notes and start times matter before the event,
 * results ("LIVE RESULTS" too) on the day and after, and results analysis (Livelox, LapCombat…) after it.
 */
function fileKind(name, url) {
  const t = `${name} ${decodeURIComponent(String(url || '').replace(/%(?![0-9a-f]{2})/gi, '%25'))}`.toLowerCase();
  if (/livelox|lap\s*combat|splits?\s*browser|winsplits|route\s*gadget|ניתוח|לפקומבט|splits/.test(t)) return 'analysis';
  if (/תוצאות|results?\b|live\s*result|liveresult/.test(t)) return 'results';
  if (/זמני\s*זינוק|רשימת\s*זינוק|זינוקים|start\s*(?:list|times?)/.test(t)) return 'starts';
  if (/מתכנ|planner|bulletin|הנחיות|עלון/.test(t)) return 'planner';
  return 'other';
}

/** "קבצים ונספחים": the box on the event page (or a table row), plus the site's results page when it is open. */
function eventFiles(h, pageUrl, resultsOpen) {
  const box = /id="[^"]*dvAttachments"[\s\S]*?<\/fieldset>/.exec(h)?.[0] || labelCell(h, 'קבצים ונספחים') || '';
  const files = linksOf(box, pageUrl).filter((l) => l.text).map((l) => ({ name: l.text, url: l.href, kind: fileKind(l.text, l.href) }));
  const id = /\/(\d+)\/info/i.exec(pageUrl)?.[1];
  if (resultsOpen && id && !files.some((f) => f.kind === 'results')) {
    files.unshift({ name: 'תוצאות', url: new URL(`/${id}/Results`, pageUrl).href, kind: 'results' });
  }
  return files;
}

function parseEventPage(html, pageUrl) {
  const h = stripScripts(html);
  const nameM = /itemprop="name">\s*<span\b[^>]*>([\s\S]*?)<\/span>([\s\S]*?)<\/div>/.exec(h);
  const startM = /itemprop="startDate"\s+datetime="([^"]+)"/.exec(h);
  const boldLines = [...h.matchAll(/<tr class="boldLine">\s*<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => textOf(m[1]));
  const date = startM ? startM[1].slice(0, 10) : parseDate(boldLines.join(' '));
  const times = startTimes(h, startM?.[1]);

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
  // Some pages have only the map script: the "כינוס" marker, or else the map's centre.
  const marker = /\[\s*['"]כינוס['"]\s*,\s*(\d{2}\.\d+)\s*,\s*(\d{2}\.\d+)/.exec(html) || /myMapLocation\s*=\s*\[\s*(\d{2}\.\d+)\s*,\s*(\d{2}\.\d+)/.exec(html);
  const ll = lat && lng ? [+lat, +lng] : waze ? [+waze[1], +waze[2]] : marker ? [+(+marker[1]).toFixed(6), +(+marker[2]).toFixed(6)] : null;
  const deadlineIso = registrationDeadline(h, date);
  const resultsBtn = /<button\b[^>]*name="ctl00\$ContentPlaceHolder1\$rbResults"[^>]*>/.exec(h)?.[0] || '';

  const out = withoutNoInfo({
    nivutId: /\/(\d+)\/info/i.exec(pageUrl)?.[1] || null,
    url: pageUrl,
    name: nameM ? textOf(nameM[1]) : '',
    eventType: nameM ? fixParens(textOf(nameM[2])) : '',
    date,
    note: boldLines.filter((l) => !parseDate(l)).join(' · '),
    startFrom: times[0] || '',
    startTo: times[1] || '',
    cutoff: textOf(labelCell(h, 'שעת גג')),
    courses,
    price: textOf(priceCell.replace(/<div\b[\s\S]*$/, '')).replace(/\s+\(/g, ' ('),
    priceNonMember: textOf(/dvNonMemberPrice"[^>]*>([\s\S]*?)<\/div>/.exec(priceCell)?.[1] || ''),
    registrationDeadline: deadlineIso,
    onsite: textOf(labelCell(h, 'הרשמה במקום')),
    club: clubLink ? (() => {
      const id = /\/Club\/(\d+)/i.exec(clubLink.href)?.[1] || '';
      const pageLogo = /<img\b[^>]*itemprop="image"[^>]*\bsrc="([^"]+)"/i.exec(h)?.[1] || /<img\b[^>]*\bsrc="([^"]*\/(?:images\/clubs|club-logos)\/[^"]+)"/i.exec(h)?.[1];
      const own = pageLogo ? absUrl(pageLogo, pageUrl) : '';
      return { name: clubLink.text, url: clubLink.href, id, logo: own || clubLogo(id), pageLogo: own };
    })() : (textOf(clubCell) ? { name: textOf(clubCell), url: '', id: '', logo: '', pageLogo: '' } : null),
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
    attachments: eventFiles(h, pageUrl, !!resultsBtn && !/rbDisabled|disabled/.test(resultsBtn)),
    // "מידע נוסף": the itemprop cell, or the cell next to the label when the markup has no itemprop.
    description: paragraphs(/<td\b[^>]*itemprop=["']?description["']?[^>]*>([\s\S]*?)<\/td>/.exec(h)?.[1] || labelCell(h, 'מידע נוסף')),
    lat: ll ? ll[0] : null,
    lng: ll ? ll[1] : null,
    wazeLL: waze ? `${waze[1]},${waze[2]}` : (ll ? ll.join(',') : ''),
    resultsAvailable: !!resultsBtn && !/rbDisabled|disabled/.test(resultsBtn),
  });
  if (out.map && !out.map.name && !out.map.image) out.map = null; // "אין מידע" map
  return out;
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

/** Normalises markup the way a browser serialises it: double-quoted attributes. */
function normalizeAttrs(html) {
  return html.replace(/(\s[\w:-]+)\s*=\s*'([^']*)'/g, (m, name, v) => `${name}="${v.replace(/"/g, '&quot;')}"`);
}

const AGE_RE = /\d+\s*(?:ימים|יום|שבועות|שבוע|חודשים|חודש|ש'|שעות|שעה|דק'|דקות|דקה)(?:\s*\d+\s*(?:ש'|שעות|דק'|דקות))?/;

const IMG_EXT = /\.(?:jpe?g|png|gif|webp|bmp)(?:[?#].*)?$/i;
const PLACEHOLDER = /LoadImage\.png|Plus\.png|down\.png|spacer|blank\.|\/icons\/|\/smil|emoticon/i; // not attachments

/**
 * Images attached to a message. The forum swaps them in with a script, so look everywhere:
 * lazy-image attributes and links in the message, then (in the raw page) a script mentioning the message id.
 */
function messageImages(chunk, body, id, rawHtml) {
  const out = new Set();
  const add = (u) => { const abs = absUrl(u, PAGES.forum); if (abs && IMG_EXT.test(abs) && !PLACEHOLDER.test(abs)) out.add(abs); };
  const imgBox = new RegExp(`id="dvImg${id}"[^>]*>([\\s\\S]*?)</div>`, 'i').exec(chunk)?.[1] || '';
  for (const m of imgBox.matchAll(/\b(?:src|lsrc|data-src|data-original|data-url|data-full|href)\s*=\s*"([^"]+)"/gi)) add(decodeEntities(m[1]));
  for (const m of body.matchAll(/<img\b[^>]*\bsrc\s*=\s*"([^"]+)"/gi)) add(decodeEntities(m[1]));
  for (const l of linksOf(body, PAGES.forum)) add(l.href);
  if (!out.size && rawHtml) {
    const near = new RegExp(`(?:Image_|dvImg|["'\\s,:(\\[])${id}\\b[\\s\\S]{0,400}?((?:https?:)?\\/{0,2}[^"'\\s<>()]*\\/uploads\\/[^"'\\s<>()]+?\\.(?:jpe?g|png|gif|webp))`, 'i').exec(rawHtml);
    if (near) add(near[1].replace(/\\\//g, '/'));
  }
  return [...out];
}

/** Files linked from a message (results, PDFs, …), other than its images. */
function messageFiles(body, images) {
  return linksOf(body, PAGES.forum)
    .filter((l) => /^https?:/.test(l.href) && !images.includes(l.href))
    .map((l) => {
      // A file name only for uploaded files (uploads/<guid>_name.ext); other links keep their text.
      const isFile = /\/uploads\//i.test(l.href);
      const file = isFile ? decodeURIComponent(l.href.split(/[?#]/)[0].split('/').pop() || '').replace(/^[0-9a-f]{8}-[0-9a-f-]{27}_/i, '') : '';
      const label = l.text && !/^https?:/.test(l.text) ? l.text : file || new URL(l.href).hostname.replace(/^www\./, '');
      return { url: l.href, name: label, file };
    })
    .filter((f, i, arr) => arr.findIndex((x) => x.url === f.url) === i);
}

function parseMessage(chunk, id, now, rawHtml = '') {
  const headline = textOf((/class="MsgHeadline"[^>]*>\s*<span\b[^>]*>([\s\S]*?)<\/span>/i.exec(chunk)
    || /id="[^"]*lblHeadline"[^>]*>([\s\S]*?)<\/span>/i.exec(chunk) || [])[1]);
  const author = /<a\b[^>]*class="RegUser"[^>]*>([\s\S]*?)<\/a>/i.exec(chunk)
    || /<a\b[^>]*href="[^"]*\/User\/\d+\.htm"[^>]*>([\s\S]*?)<\/a>/i.exec(chunk);
  const meta = /class="forum-msg-meta"[^>]*>([\s\S]*?)<\/div>/i.exec(chunk)?.[1] || '';
  const authorEnd = author ? chunk.indexOf(author[0]) + author[0].length : -1;
  const logoSrc = authorEnd > -1 ? /^\s*<img\b[^>]*\bsrc="([^"]+)"/i.exec(chunk.slice(authorEnd, authorEnd + 400))?.[1] : '';
  const ageText = (AGE_RE.exec(textOf(meta)) || AGE_RE.exec(textOf(chunk.slice(0, chunk.search(/class="MsgBody"|id="Text\d/i) >>> 0))) || [''])[0];
  const mins = ageMinutes(ageText);
  // Body: from the tx<id> element to the actions bar (or the end of the message block).
  const start = new RegExp(`id="tx${id}"[^>]*>`, 'i').exec(chunk);
  let body = '';
  if (start) {
    const rest = chunk.slice(start.index + start[0].length);
    const end = rest.search(/class="forum-msg-actions"|<hr\b|id="ChildGroup\d|class="childMsg"/i);
    body = (end === -1 ? rest : rest.slice(0, end)).replace(/<\/div>\s*<div\b[^>]*$/i, '').replace(/<\/div>\s*$/i, '');
  }
  return {
    id,
    title: headline,
    author: author ? textOf(author[1]) : '',
    authorClubId: clubIdFromLogo(logoSrc || ''),
    authorLogo: logoSrc ? absUrl(logoSrc, PAGES.forum) : '',
    ageText,
    postedAt: mins === null ? '' : new Date(now - mins * 60000).toISOString(),
    body: paragraphs(body).filter((l) => !/^הודעה זו נערכה/.test(l)),
    hasImage: new RegExp(`id="Image_${id}"`, 'i').test(chunk),
    images: messageImages(chunk, body, id, rawHtml),
    files: messageFiles(body, messageImages(chunk, body, id, '')),
    links: linksOf(body, PAGES.forum).filter((l) => /^https?:/.test(l.href)).map((l) => l.href),
  };
}

function parseForum(html, pageUrl, now = Date.now()) {
  const h = normalizeAttrs(stripScripts(html));
  const raw = html.replace(/\\\//g, '/'); // scripts may hold image addresses with JSON-escaped slashes
  // Threads are found by their stable ids, whatever the class or attribute order.
  return chunksBy(h, /<div\b[^>]*\bid="Parent\d+"/i).map((chunk) => {
    const id = /id="Parent(\d+)"/i.exec(chunk)?.[1];
    if (!id) return null;
    const childStart = chunk.search(new RegExp(`id="ChildGroup${id}"`, 'i'));
    const head = childStart === -1 ? chunk : chunk.slice(0, childStart);
    const headlineAt = head.search(/class="MsgHeadline"|lblHeadline/i);
    const lead = textOf(head.slice(0, headlineAt === -1 ? 400 : headlineAt));
    const msg = parseMessage(head, id, now, raw);
    const replies = childStart === -1 ? [] : chunksBy(chunk.slice(childStart), /<div\b[^>]*class="childMsg"/i).map((c) => {
      const cid = /id="(?:Icon|Text|tx)(\d+)"/i.exec(c)?.[1];
      return cid ? parseMessage(c, cid, now, raw) : null;
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
  }).filter((t) => t && (t.title || t.body.length));
}

/** RSS fallback: items become threads; "תגובה: X" items are grouped under thread X. */
function parseForumRss(xml, now = Date.now()) {
  const field = (item, tag) => {
    const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(item);
    return m ? m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1') : '';
  };
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(([item]) => {
    const link = decodeEntities(textOf(field(item, 'link')) || '');
    const title = textOf(decodeEntities(field(item, 'title')));
    const date = Date.parse(textOf(field(item, 'pubDate')) || '');
    const html = decodeEntities(field(item, 'description') || field(item, 'content:encoded'));
    return {
      id: /(\d{4,})/.exec(link)?.[1] || hash(link + title),
      title,
      author: textOf(decodeEntities(field(item, 'dc:creator') || field(item, 'author'))),
      ageText: '',
      postedAt: Number.isFinite(date) ? new Date(date).toISOString() : '',
      body: paragraphs(html).filter((l) => !/^הודעה זו נערכה/.test(l)),
      hasImage: /<img\b/i.test(html),
      links: [],
      url: /^https?:/.test(link) ? link : PAGES.forum,
    };
  });
  const threads = new Map();
  const base = (t) => t.replace(/^\s*(?:תגובה|re)\s*:\s*/i, '').trim();
  const posts = [...items].sort((a, b) => (a.postedAt > b.postedAt ? 1 : -1));
  for (const it of posts) {
    const key = base(it.title);
    const isReply = key !== it.title.trim();
    if (!threads.has(key) && !isReply) threads.set(key, { ...it, announcement: false, pinned: false, replies: [] });
    else if (threads.has(key)) threads.get(key).replies.push(it);
    else threads.set(key, { ...it, title: key, announcement: false, pinned: false, replies: [] });
  }
  return [...threads.values()].map((t) => {
    const times = [t.postedAt, ...t.replies.map((r) => r.postedAt)].filter(Boolean).sort();
    return { ...t, replyCount: t.replies.length, lastActivity: times[times.length - 1] || '' };
  }).sort((a, b) => (b.lastActivity > a.lastActivity ? 1 : -1));
}

/** What the forum page looked like, to diagnose an empty result. */
function forumDiag(html, url, status) {
  return {
    url, status, length: html.length,
    title: textOf(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || ''),
    markers: Object.fromEntries(['clsParent', 'id="Parent', 'MsgHeadline', 'childMsg', 'id="tx', 'rptMessages', 'RadAjaxPanel1', '__VIEWSTATE']
      .map((k) => [k, html.split(k).length - 1])),
  };
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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 nivut-wrapper/1.0';

function decodeBody(buf, contentType) {
  const headerCs = /charset=([\w-]+)/i.exec(contentType || '')?.[1];
  const metaCs = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.toString('latin1'))?.[1];
  let charset = (headerCs || metaCs || 'utf-8').toLowerCase();
  if (charset === 'iso-8859-8' || charset === 'iso-8859-8-i') charset = 'windows-1255';
  try { return new TextDecoder(charset).decode(buf); } catch { return buf.toString('utf8'); }
}

/** One HTTP request with an optional cookie jar; redirects are reported, not followed, when redirect: 'manual'. */
async function request(url, opts = {}) {
  // With a cookie jar, follow redirects here: fetch would drop the cookies a redirect sets (a session cookie
  // that the page's ViewState is tied to, for one).
  if (!opts.jar || opts.redirect === 'manual') return requestOnce(url, opts);
  const hops = [];
  let res = await requestOnce(url, { ...opts, redirect: 'manual' });
  for (let hop = 0; hop < 6 && res.status >= 300 && res.status < 400 && res.location; hop++) {
    hops.push({ status: res.status, to: res.location });
    const keep = res.status === 307 || res.status === 308;
    res = await requestOnce(absUrl(res.location, res.url), { ...opts, redirect: 'manual', ...(keep ? {} : { method: 'GET', form: null }) });
  }
  return hops.length ? { ...res, hops } : res;
}

async function requestOnce(url, { method = 'GET', form = null, jar = null, redirect = 'follow', referer, retried = false, headers: extraHeaders = null } = {}) {
  const headers = {
    // A mainstream browser UA: ASP.NET/Telerik can render a reduced page for unknown agents.
    'user-agent': UA,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'he,en;q=0.8',
  };
  if (jar?.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  if (referer) headers.referer = referer;
  if (extraHeaders) Object.assign(headers, extraHeaders);
  let body;
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  const res = await fetch(url, { method, headers, body, redirect, signal: AbortSignal.timeout(15000) });
  if (jar) for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const k = kv.indexOf('='); if (k > 0) jar.set(kv.slice(0, k).trim(), kv.slice(k + 1).trim()); }
  const location = res.headers.get('location');
  // A redirect's body is not needed (and some servers cut it off): skip it.
  if (res.status >= 300 && res.status < 400 && location) {
    await res.body?.cancel().catch(() => {});
    return { status: res.status, url: res.url || url, location, html: '' };
  }
  let buf;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    // "terminated": the connection dropped mid-body; ask once more
    if (retried) throw err;
    return requestOnce(url, { method, form, jar, redirect, referer, retried: true, headers: extraHeaders });
  }
  return { status: res.status, url: res.url || url, location, html: decodeBody(buf, res.headers.get('content-type')) };
}

async function fetchHtml(url) {
  const res = await request(url);
  if (res.status < 200 || res.status >= 300) throw new Error(`${url} → HTTP ${res.status}`);
  return { html: res.html, url: res.url };
}

const TTL = Number(process.env.CACHE_SECONDS || 600) * 1000;
const cache = new Map();
const inflight = new Map();

/** Cached loader: refreshes after TTL, serves stale data when the source is down, shares in-flight requests. */
async function cached(key, loader, ttl = TTL) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
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

/** The logo on a club page (/Club/{id}): the first image under images/clubs/ or club-logos/. */
function parseClubLogo(html, pageUrl) {
  const src = /<img\b[^>]*\bsrc\s*=\s*["']([^"']*\/(?:images\/clubs|club-logos)\/[^"']+)["']/i.exec(html)?.[1];
  return src ? absUrl(src, pageUrl) : '';
}

const getClubLogos = (clubs) => cached('club-logos', async () => {
  const found = await Promise.allSettled(clubs.map(async (c) => [c.id, parseClubLogo((await fetchHtml(c.url)).html, c.url)]));
  return Object.fromEntries(found.filter((r) => r.status === 'fulfilled' && r.value[1]).map((r) => r.value));
}, 24 * 3600 * 1000);

async function withLogos(clubs) {
  if (!clubs.length) return clubs;
  const logos = await getClubLogos(clubs).catch(() => ({}));
  return clubs.map((c) => (logos[c.id] && logos[c.id] !== c.logo ? { ...c, logo: logos[c.id], logoAlt: c.logo } : c));
}

const getHome = () => cached('home', async () => {
  const page = await fetchHtml(PAGES.home);
  return { ...parseHome(page.html, page.url), source: page.url, fetchedAt: new Date().toISOString() };
});

const getEventPage = (url) => cached(`event:${url}`, async () => {
  const page = await fetchHtml(url);
  return parseEventPage(page.html, page.url);
});

// Words every other title has ("ניווט", "ליגת", "אליפות") say nothing about which event it is.
const GENERIC = new Set(['ניווט', 'ניווטים', 'ליגה', 'ליגת', 'אליפות', 'אימון', 'תחרות', 'רגלי', 'רכוב', 'עממי', 'ישראל', 'היום', 'מסלולים']);
const words = (s) => new Set(String(s).split(/[\s\-–,|:()"'./]+/).map((w) => (GENERIC.has(w) ? '' : w.replace(/^[בהלמו](?=\S{3,})/, ''))).filter((w) => w.length > 2 && !GENERIC.has(w)));
const overlap = (a, b) => { const B = words(b); return [...words(a)].some((w) => B.has(w)); };

/**
 * Tags from the title, the note and the event-page category. The category ("ליגת ניווט רגלי")
 * marks a league round unless the event says it is only like one, a training or a model event.
 */
function eventTags(title, d) {
  const own = `${title} ${d?.note || ''}`;
  const notLeague = /כמו\s*ב?ליג|אימון|מודל|לא\s*ליג/.test(own);
  const fromType = tagsOf(d?.eventType || '').filter((t) => t !== 'league' || !notLeague);
  return [...new Set([...tagsOf(own), ...fromType])];
}

/** An event with its event-page details folded in (place, start, club, category, tags). */
function withDetails(e, d, closedAreas = []) {
  const area = closedAreas.find((a) => a.date === (d?.date || e.date) && overlap(a.name, `${e.fullTitle || e.title} ${d?.name || ''}`));
  return {
    ...e,
    date: d?.date || e.date,
    time: d?.startFrom || e.time || '',
    location: d?.map?.name?.replace(/\s*\[[^\]]*\]\s*$/, '') || area?.name || e.location || d?.name || '',
    clubName: d?.club?.name || e.clubName || '',
    clubId: d?.club?.id || e.clubId || '',
    eventType: d?.eventType || e.eventType || '',
    // The event-page category (e.g. "ליגת ניווט רגלי") names the discipline, not a league round.
    tags: d ? eventTags(e.fullTitle || e.title, d) : e.tags || [],
    details: d || null,
  };
}

// What the organisers wrote decides: "אין הרשמה באתר" in "מידע נוסף", and "אירוע סגור" there or in the
// line under the event name (category / note, e.g. "- אירוע סגור -").
const CLOSED_RE = /(?:אירוע|ארוע)\s*סגור/;
const NO_SITE_REG_RE = /אין\s*(?:אפשרות\s*)?(?:ה)?רשמה\s*(?:ב|דרך\s*ה)אתר/;
// Direction marks, zero-width characters and no-break spaces sometimes sit between the words.
const plain = (t) => String(t || '').replace(/[​-‏‪-‮⁦-⁩﻿]/g, '').replace(/[\s ]+/g, ' ');
function eventFlags(e) {
  const d = e.details || {};
  const info = plain((d.description || []).join(' '));
  const line = plain([d.note, d.eventType].join(' '));
  return { closed: CLOSED_RE.test(info) || CLOSED_RE.test(line), noSiteRegistration: NO_SITE_REG_RE.test(info) };
}

/** Merges featured events (with event-page details), calendar rows and closed areas. */
function mergeEvents({ featured, closedAreas }, details, calendar) {
  const events = featured.map((e) => withDetails(e, details.get(e.url), closedAreas));
  const sameEvent = (a, b) => a.date === b.date && !(a.nivutId && b.nivutId && a.nivutId !== b.nivutId) && overlap(a.title, `${b.fullTitle || b.title} ${b.location || ''}`);
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
    // Calendar-only events are checked in the browser, a few at a time, as more months are shown.
    const events = mergeEvents(home, details, calendar).map((e) => ({ ...e, ...eventFlags(e) }));
    return {
      source: home.source,
      fetchedAt: new Date().toISOString(),
      events,
      clubs: await withLogos(home.clubs),
      counts: { featured: home.featured.length, details: details.size, calendar: calendar.length, closedAreas: home.closedAreas.length },
    };
  });
}

const getNews = async () => {
  const home = await getHome();
  return { source: home.source, fetchedAt: home.fetchedAt, news: home.news, stale: home.stale };
};

/* ---------- Participants (event page → "רשימת משתתפים") ---------- */

const PCOLS = {
  name: /^(שם|שם מלא|שם הנווט|נווט|משתתף|מתחרה|name|competitor)$/i,
  first: /^(שם פרטי|first ?name)$/i,
  last: /^(שם משפחה|last ?name|surname)$/i,
  club: /מועדון|קבוצה|club|team/i,
  category: /קטגורי|category|class/i,
  course: /מסלול|course/i,
  start: /זינוק|שעת|start/i,
  chip: /שבב|צ'יפ|chip|si/i,
};

/**
 * Participants from a start list: every table with a name heading counts (lists are often one table per
 * category). A category comes from its column, else from a one-cell group row or the heading just before
 * the table. Returns [{name, club, category, course, start}].
 */
function parseParticipants(html) {
  const h = normalizeAttrs(stripScripts(html));
  const out = [];
  let last = 0;
  let group = '';
  const groupFrom = (text) => {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const cand = lines[lines.length - 1] || '';
    return cand.length && cand.length <= 50 && !TIME_RE.test(cand) ? cand : '';
  };
  for (const table of h.matchAll(/<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table>/gi)) { // innermost tables
    const before = h.slice(Math.max(last, table.index - 600), table.index);
    last = table.index + table[0].length;
    const heading = groupFrom(decodeEntities(before.replace(/<\/(h\d|p|div|b|strong|span|caption|tr)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')));
    if (heading) group = heading;
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((r) => [...r[1].matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map((c) => textOf(c[2])));
    const caption = textOf(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(table[1])?.[1] || '');
    if (caption) group = caption;
    let map = null;
    let width = 0;
    for (const cells of rows) {
      if (cells.some((c) => PCOLS.name.test(c) || PCOLS.last.test(c))) {
        map = {};
        width = cells.length;
        cells.forEach((c, i) => { for (const [k, re] of Object.entries(PCOLS)) if (map[k] === undefined && c.length < 25 && re.test(c)) { map[k] = i; break; } });
        continue;
      }
      const filled = cells.filter(Boolean);
      if (filled.length === 1 && cells.length < Math.max(2, width - 1) && filled[0].length <= 50) { group = filled[0]; continue; } // group row
      if (!map || cells.length < width - 1) continue;
      const pick = (k) => (map[k] !== undefined ? cells[map[k]] || '' : '');
      const name = pick('name') || [pick('first'), pick('last')].filter(Boolean).join(' ');
      if (!name || !/\p{L}{2}/u.test(name) || PCOLS.name.test(name)) continue;
      out.push({ name, club: pick('club'), category: pick('category') || group, course: pick('course'), start: TIME_RE.exec(pick('start'))?.[0] || '' });
    }
  }
  const seen = new Set();
  return out.filter((p) => { const k = `${p.name}|${p.category}`; return !seen.has(k) && seen.add(k); });
}

const hiddenInputs = (html) => Object.fromEntries([...normalizeAttrs(html).matchAll(/<input\b[^>]*type="hidden"[^>]*>/gi)]
  .map(([tag]) => [/name="([^"]+)"/.exec(tag)?.[1], decodeEntities(/value="([^"]*)"/.exec(tag)?.[1] || '')]).filter(([k]) => k));

/** Presses the event page's "participants" button (an ASP.NET postback) and returns the page it leads to. */
async function fetchParticipantsPage(eventUrl) {
  const jar = new Map();
  const steps = [];
  const page = await request(eventUrl, { jar });
  steps.push({ get: page.url, status: page.status });
  if (page.status !== 200) throw new Error(`${eventUrl} → HTTP ${page.status}`);
  const html = normalizeAttrs(page.html);
  const action = absUrl(/<form\b[^>]*action="([^"]+)"/i.exec(html)?.[1] || page.url, page.url);
  const btn = /<(?:button|input)\b[^>]*name="([^"]*rbStartList)"[^>]*value="([^"]*)"/i.exec(html)
    || /<(?:button|input)\b[^>]*value="([^"]*)"[^>]*name="([^"]*rbStartList)"/i.exec(html);
  if (!btn) return { html: page.html, url: page.url, steps, note: 'no participants button on the event page' };
  const [btnName, btnValue] = /rbStartList$/.test(btn[1]) ? [btn[1], btn[2]] : [btn[2], btn[1]];
  const form = { ...hiddenInputs(html), __EVENTTARGET: '', __EVENTARGUMENT: '', [btnName]: decodeEntities(btnValue) };
  let res = await request(action, { method: 'POST', form, jar, redirect: 'manual', referer: page.url });
  steps.push({ post: action, status: res.status, location: res.location });
  for (let hop = 0; hop < 4 && res.status >= 300 && res.status < 400 && res.location; hop++) {
    const next = absUrl(res.location, res.url);
    res = await request(next, { jar, redirect: 'manual', referer: page.url });
    steps.push({ get: next, status: res.status, location: res.location });
  }
  // Some pages answer the postback with a script that opens the list in a new window.
  const opened = /window\.open\(\s*['"]([^'"]+)['"]|location\.href\s*=\s*['"]([^'"]+)['"]/i.exec(res.html);
  if (!parseParticipants(res.html).length && opened) {
    const next = absUrl(opened[1] || opened[2], res.url);
    res = await request(next, { jar, referer: page.url });
    steps.push({ get: next, status: res.status });
  }
  return { html: res.html, url: res.url, steps };
}

const getParticipants = (id) => cached(`participants:${id}`, async () => {
  // The start list has its own address (/{id}/Start); the button postback is the fallback.
  const direct = new URL(`${id}/Start`, PAGES.home).href;
  const steps = [];
  try {
    const res = await request(direct);
    steps.push({ get: res.url, status: res.status });
    const participants = res.status === 200 ? parseParticipants(res.html) : [];
    if (participants.length) {
      return { eventId: id, source: res.url, fetchedAt: new Date().toISOString(), count: participants.length, participants };
    }
    if (res.status === 200) steps.push({ note: 'no participants table found', length: res.html.length, tables: (res.html.match(/<table\b/gi) || []).length });
  } catch (err) {
    steps.push({ get: direct, error: String(err.message || err) });
  }
  const eventUrl = new URL(`${id}/Info`, PAGES.home).href;
  const page = await fetchParticipantsPage(eventUrl);
  page.steps = [...steps, ...page.steps];
  const participants = parseParticipants(page.html);
  return {
    eventId: id, source: page.url, fetchedAt: new Date().toISOString(), count: participants.length, participants,
    ...(participants.length ? {} : { diag: { steps: page.steps, note: page.note, length: page.html.length, title: textOf(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(page.html)?.[1] || ''), tables: (page.html.match(/<table\b/gi) || []).length } }),
  };
});

const FORUM_RSS = process.env.NIVUT_FORUM_RSS || 'https://feeds.feedburner.com/org/Nivut/Forum';

const getForum = () => cached('forum', async () => {
  const fetchedAt = new Date().toISOString();
  let diag = null;
  try {
    const page = await fetchHtml(PAGES.forum);
    const threads = parseForum(page.html, page.url);
    if (threads.length) return { source: page.url, via: 'html', fetchedAt, threads };
    diag = forumDiag(page.html, page.url, 200);
  } catch (err) {
    diag = { url: PAGES.forum, error: String(err.message || err) };
  }
  try {
    const rss = await fetchHtml(FORUM_RSS);
    const threads = parseForumRss(rss.html);
    if (threads.length) return { source: PAGES.forum, via: 'rss', fetchedAt, threads, diag };
    diag.rss = { url: FORUM_RSS, length: rss.html.length, items: 0 };
  } catch (err) {
    diag.rss = { url: FORUM_RSS, error: String(err.message || err) };
  }
  return { source: PAGES.forum, via: 'none', fetchedAt, threads: [], diag };
});


/* ---------- Rankings (/results/ranking.aspx) ---------- */

/**
 * The leagues on the ranking page: each has a season and a category drop-down (Telerik RadComboBox)
 * and one or more result grids. The foot league also carries the sprint league ("ליגת מאוץ").
 */
const LEAGUES = {
  foot: { title: 'ליגת ניווט רגלי', season: 'ddlSeason', category: 'DropDownList1', grids: [['RadGrid1', 'ליגה'], ['rGridSprint', 'ליגת מאוץ']] },
  mtbo: { title: 'ליגת ניווט רכוב', season: 'rcbSeason', category: 'rcbCategory', grids: [['rGridMtbo', 'ליגה']] },
};
const CP = 'ctl00_ContentPlaceHolder1_';

/** A RadComboBox: its current text and its items. */
function parseCombo(html, id) {
  // a plain ASP.NET DropDownList (<select>) instead of a RadComboBox
  const sel = new RegExp(`<select\\b[^>]*name="ctl00\\$ContentPlaceHolder1\\$${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  if (sel) {
    const opts = [...sel[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)]
      .map((m) => ({ text: textOf(m[2]), value: decodeEntities(/value="([^"]*)"/.exec(m[1])?.[1] ?? textOf(m[2])), selected: /\bselected\b/.test(m[1]) }));
    const cur = (opts.find((o) => o.selected) || opts[0] || { text: '' }).text;
    return { value: /^בחר/.test(cur) ? '' : cur, options: opts.map((o) => o.text).filter((t) => t && !/^בחר/.test(t)), select: opts };
  }
  const value = new RegExp(`id="${CP}${id}_Input"[^>]*value="([^"]*)"`).exec(html)?.[1]
    || new RegExp(`name="ctl00\\$ContentPlaceHolder1\\$${id}"[^>]*value="([^"]*)"`).exec(html)?.[1] || '';
  const drop = new RegExp(`id="${CP}${id}_DropDown"[\\s\\S]*?</ul>`).exec(html)?.[0] || '';
  let options = [...drop.matchAll(/<li\b[^>]*class="rcb(?:Item|Hovered)[^"]*"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1])).filter(Boolean);
  // items rendered by the client script only (no <li> in the HTML)
  if (!options.length) options = comboClientData(html, id).texts.filter((t) => t && !/^בחר/.test(t));
  const v = decodeEntities(value).trim();
  return { value: /^בחר/.test(v) ? '' : v, options };
}

const num = (t) => { const s = textOf(t).replace(/,/g, ''); return s === '' ? null : Number(s); };

/** One RadGrid: the events (column headers that link to an event) and a row per competitor. */
function parseRankGrid(html, gridId) {
  const start = html.indexOf(`id="${CP}${gridId}"`);
  if (start < 0) return null;
  // the grid's own table (an empty grid has none; never run on into the next grid)
  const own = new RegExp(`<table\\b[^>]*id="${CP}${gridId}_ctl00"`).exec(html.slice(start));
  if (!own) return null;
  const from = start + own.index;
  // Header cells hold small nested tables, so cut at </thead> and at the first </tbody> after it.
  const headEnd = html.indexOf('</thead>', from);
  const bodyEnd = html.indexOf('</tbody>', headEnd);
  if (headEnd < 0 || bodyEnd < 0) return null;
  const table = html.slice(from, bodyEnd + 8);
  const head = table.slice(table.indexOf('<thead>') + 7, table.indexOf('</thead>'));
  // top-level header cells only (event headers hold a small nested table)
  const ths = [...head.matchAll(/<th\b[^>]*class="rgHeader"[^>]*>([\s\S]*?)<\/th>(?=\s*<th\b[^>]*class="rgHeader"|\s*<\/tr>\s*$)/g)].map((m) => m[1]);
  const cols = ths.map((c) => {
    const a = /<a\b[^>]*href="([^"]*\/(\d+)\/Info[^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(c);
    return a ? { event: true, id: a[2], name: textOf(a[3]), url: decodeEntities(a[1]) } : { event: false, name: textOf(c) };
  });
  const idx = (re) => cols.findIndex((c) => !c.event && re.test(c.name));
  const iRank = idx(/^#$/), iName = idx(/^שם/), iClub = idx(/מועדון/), iTotal = idx(/^דירוג$/), iAge = idx(/מקדם/), iWeighted = idx(/משוקלל/);
  const events = cols.map((c, i) => ({ ...c, i })).filter((c) => c.event);
  const body = table.slice(table.indexOf('</thead>'));
  const rows = [...body.matchAll(/<tr\b[^>]*class="rg(?:Alt)?Row"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => {
    const td = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
    const total = iTotal >= 0 ? num(td[iTotal]) : null;
    return {
      rank: iRank >= 0 ? num(td[iRank]) : null,
      name: iName >= 0 ? textOf(td[iName]) : '',
      club: iClub >= 0 ? textOf(td[iClub]) : '',
      scores: events.map((e) => num(td[e.i])),
      total,
      ageFactor: iAge >= 0 ? num(td[iAge]) : null,
      weighted: iWeighted >= 0 ? num(td[iWeighted]) : total,
    };
  }).filter((r) => r.name);
  return { events: events.map(({ id, name, url }) => ({ id, name, url })), rows };
}

/** All leagues on a ranking page: selections, options, "best N results" and the grids. */
function parseRanking(html, pageUrl) {
  const h = normalizeAttrs(html);
  const leagues = {};
  for (const [key, L] of Object.entries(LEAGUES)) {
    const season = parseCombo(h, L.season), category = parseCombo(h, L.category);
    // a league whose lists are still empty (its tab not opened yet) is there as long as its combos are
    if (!season.options.length && !category.options.length && !h.includes(`id="${CP}${L.season}_Input"`)) continue;
    // "הדירוג מחושב לפי N התוצאות הטובות ביותר" just before each grid
    const grids = L.grids.map(([id, title]) => {
      const at = h.indexOf(`id="${CP}${id}"`);
      const before = at > 0 ? h.slice(Math.max(0, at - 1500), at) : '';
      const best = [...before.matchAll(/לפי\s*(\d+)\s*התוצאות/g)].pop()?.[1];
      const g = parseRankGrid(h, id);
      return g && g.rows.length ? { id, title, best: best ? +best : null, ...g } : null;
    }).filter(Boolean);
    leagues[key] = { key, title: L.title, season, category, grids };
  }
  return { url: pageUrl, leagues };
}

/**
 * A RadComboBox's client data from its $create(...) script: item values (in item order) and its postback call.
 * Saved pages drop these scripts, but the page the server fetches has them.
 */
function comboClientData(html, id) {
  for (const seg of html.split('$create(Telerik.Web.UI.RadComboBox').slice(1)) {
    const body = seg.slice(0, 20000);
    if (!body.includes(`"${CP}${id}_ClientState"`) && !body.includes(`ctl00$ContentPlaceHolder1$${id}"`)) continue;
    let values = [], texts = [];
    const items = /"itemData":(\[[\s\S]*?\])\s*[,}]/.exec(body)?.[1];
    try {
      const list = JSON.parse(items);
      values = list.map((it) => (it && it.value !== undefined ? String(it.value) : ''));
      texts = list.map((it) => (it && it.text !== undefined ? String(it.text) : ''));
    } catch { /* keep [] */ }
    const postBack = /"_postBackReference":"((?:[^"\\]|\\.)*)"/.exec(body)?.[1] || '';
    return { values, texts, postBack, found: true };
  }
  return { values: [], texts: [], postBack: '', found: false };
}

/** Every field a browser posts with the form: hidden inputs, the combos' text boxes and the selects. */
function formFields(h) {
  const out = hiddenInputs(h);
  for (const [tag] of h.matchAll(/<input\b[^>]*type="text"[^>]*>/gi)) {
    const name = /name="([^"]+)"/.exec(tag)?.[1];
    // a combo showing its "choose…" placeholder posts an empty text
    if (name) out[decodeEntities(name)] = /rcbEmptyMessage/.test(tag) ? '' : decodeEntities(/value="([^"]*)"/.exec(tag)?.[1] || '');
  }
  return { ...out, ...selectValues(h) };
}

/**
 * The form exactly as a browser with Telerik's scripts posts it: every named input as it stands (a combo's
 * "choose…" text too), the selects, and each combo's client state.
 */
function browserForm(h) {
  const out = {};
  for (const [tag] of h.matchAll(/<input\b[^>]*>/gi)) {
    const name = /name="([^"]+)"/.exec(tag)?.[1];
    const type = (/type="([^"]+)"/i.exec(tag)?.[1] || 'text').toLowerCase();
    if (!name || /^(submit|button|image|file|reset)$/.test(type)) continue;
    if (/^(checkbox|radio)$/.test(type) && !/\bchecked\b/.test(tag)) continue;
    out[decodeEntities(name)] = decodeEntities(/value="([^"]*)"/.exec(tag)?.[1] || (/^(checkbox|radio)$/.test(type) ? 'on' : ''));
  }
  Object.assign(out, selectValues(h));
  for (const m of h.matchAll(new RegExp(`id="${CP}([\\w]+?)_Input"[^>]*>`, 'g'))) {
    const id = m[1];
    const text = /rcbEmptyMessage/.test(m[0]) ? '' : decodeEntities(/value="([^"]*)"/.exec(m[0])?.[1] || '');
    out[`${CP}${id}_ClientState`] = JSON.stringify({ logEntries: [], value: '', text, enabled: true, checkedIndices: [], checkedItemsTextOverflows: false });
  }
  return out;
}

/** Headers a browser sends with a form post. */
const BROWSER_POST = (origin) => ({
  'user-agent': UA.replace(/\s*nivut-wrapper\/[\d.]+/, ''), origin, 'cache-control': 'max-age=0',
  'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin', 'sec-fetch-user': '?1', 'upgrade-insecure-requests': '1',
});

const formAction = (h, page) => absUrl(/<form\b[^>]*action="([^"]+)"/i.exec(h)?.[1] || page.url, page.url);

/** A short account of a postback's answer: its title, and the message of an error page. */
const answerOf = (res) => {
  const title = textOf(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(res.html)?.[1] || '').slice(0, 120);
  const small = res.html.length < 20000;
  return { status: res.status, length: res.html.length, title, ...(res.hops ? { hops: res.hops } : {}),
    ...(small ? { text: textOf(res.html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')).replace(/\s+/g, ' ').slice(0, 400) } : {}) };
};

/** Which inner tab holds each league on the ranking page. */
const LEAGUE_TAB = { foot: /רגלי/, mtbo: /רכוב/ };

/**
 * Opens a league's tab (the site fills that league's season and category lists only once its tab is clicked).
 */
async function openLeagueTab(page, jar, league, steps) {
  const h = normalizeAttrs(page.html);
  const at = h.indexOf(`id="${CP}RadTabStrip1"`);
  const tabs = at < 0 ? [] : [...h.slice(at, h.indexOf('</ul>', at)).matchAll(/class="rtsTxt"[^>]*>([^<]*)</g)].map((m) => textOf(m[1]));
  let index = tabs.findIndex((t) => LEAGUE_TAB[league].test(t));
  if (index < 0) index = Object.keys(LEAGUES).indexOf(league);
  const state = {
    [`${CP}RadTabStrip1_ClientState`]: JSON.stringify({ selectedIndexes: [String(index)], logEntries: [], scrollState: {} }),
    [`${CP}RadMultiPage1_ClientState`]: JSON.stringify({ selectedIndex: index, changeLog: [] }),
  };
  // From the leanest form (hidden fields only, as the participants button needs) to a browser's full form.
  const forms = [
    () => ({ ...hiddenInputs(h), __EVENTTARGET: 'ctl00$ContentPlaceHolder1$RadTabStrip1', __EVENTARGUMENT: String(index) }),
    () => ({ ...hiddenInputs(h), ...state, __EVENTTARGET: 'ctl00$ContentPlaceHolder1$RadTabStrip1', __EVENTARGUMENT: String(index) }),
    () => ({ ...formFields(h), ...state, __EVENTTARGET: 'ctl00$ContentPlaceHolder1$RadTabStrip1', __EVENTARGUMENT: String(index) }),
    // as a browser posts it, with a browser's headers
    () => ({ ...browserForm(h), ...state, __EVENTTARGET: 'ctl00$ContentPlaceHolder1$RadTabStrip1', __EVENTARGUMENT: String(index) }),
  ];
  const action = formAction(h, page);
  const browserHeaders = BROWSER_POST(new URL(action).origin);
  for (const [variant, make] of forms.entries()) {
    const res = await request(action, { method: 'POST', form: make(), jar, referer: page.url, ...(variant === 3 ? { headers: browserHeaders } : {}) });
    const ah = res.status === 200 ? normalizeAttrs(res.html) : '';
    const after = ah ? parseCombo(ah, LEAGUES[league].season) : null;
    steps.push({ tab: tabs[index] ?? index, index, variant, ...answerOf(res), seasons: after?.options.length ?? null,
      selectedView: /id="ctl00_ContentPlaceHolder1_(rpv\w+)" class="rmpView"/.exec(ah)?.[1] || null });
    if (after?.options.length) return res;
  }
  // Diagnosis: does a bare postback (the page as it is, nothing clicked) also fail? Then any postback does.
  const bare = await request(action, { method: 'POST', form: { ...browserForm(h), __EVENTTARGET: '', __EVENTARGUMENT: '' }, jar, referer: page.url, headers: browserHeaders });
  steps.push({ bare: true, ...answerOf(bare), combos: (bare.html.match(/class="RadComboBox /g) || []).length });
  // and is the page itself still served to this session?
  const again = await request(page.url, { jar });
  steps.push({ getAgain: true, ...answerOf(again) });
  return null;
}

/** The current value of every <select> in the form (a postback sends them all). */
function selectValues(html) {
  const out = {};
  for (const m of html.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const opts = [...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
    const pick = opts.find((o) => /\bselected\b/.test(o[1])) || opts[0];
    if (pick) out[decodeEntities(m[1])] = decodeEntities(/value="([^"]*)"/.exec(pick[1])?.[1] ?? textOf(pick[2]));
  }
  return out;
}

/** Short raw snippets of html around each marker (null when missing); for diagnostics. */
function rawAround(html, markers, size = 900) {
  return Object.fromEntries(markers.map((m) => {
    const at = html.indexOf(m);
    return [m, at < 0 ? null : html.slice(Math.max(0, at - 150), at + size).replace(/\s+/g, ' ')];
  }));
}

/** What controls the ranking page has, for a league that could not be found. */
function rankingPageDiag(html) {
  const h = normalizeAttrs(html);
  const ids = (re) => [...new Set([...h.matchAll(re)].map((m) => m[1]))].slice(0, 30);
  return {
    length: html.length,
    title: textOf(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').slice(0, 120),
    radCombos: ids(new RegExp(`id="${CP}([\\w$]+?)_Input"`, 'g')),
    selects: ids(/<select\b[^>]*name="ctl00\$ContentPlaceHolder1\$([^"]+)"/g),
    grids: ids(new RegExp(`<table\\b[^>]*id="${CP}(\\w+?)_ctl00"`, 'g')),
    tabs: [...h.matchAll(/class="rtsTxt"[^>]*>([^<]*)</g)].map((m) => textOf(m[1])).slice(0, 12),
  };
}

/**
 * Selects an item in a RadComboBox the way its auto-postback does. variant 0 sends the select command
 * as the event argument (Telerik's own call); variant 1 relies on the client state alone.
 */
async function selectCombo(page, jar, id, text, variant = 0) {
  const h = normalizeAttrs(page.html);
  const combo = parseCombo(h, id);
  const client = comboClientData(page.html, id);
  // The list in the HTML, or else the item texts in the combo's client script; spaces and case do not count.
  const norm = (t) => String(t).replace(/\s+/g, '').toLowerCase();
  const names = combo.options.length ? combo.options : client.texts;
  const index = names.findIndex((o) => norm(o) === norm(text));
  if (index < 0) {
    const err = new Error(`"${text}" is not an option of ${id}`);
    err.diag = {
      combo: id, listed: combo.options.length, listedSample: combo.options.slice(0, 8), current: combo.value,
      script: client.found, scriptItems: client.values.length, scriptTexts: client.texts.slice(0, 8), scriptValues: client.values.slice(0, 8),
      dropDownInHtml: h.includes(`${CP}${id}_DropDown`), comboInHtml: h.includes(`${CP}${id}`), pageLength: page.html.length,
      rcbItems: (h.match(/class="rcb(?:Item|Hovered)/g) || []).length,
      raw: rawAround(page.html, [`${CP}${id}_DropDown`, `"${CP}${id}_ClientState"`]),
    };
    throw err;
  }
  const action = formAction(h, page);
  const field = `ctl00$ContentPlaceHolder1$${id}`;
  if (combo.select) {
    // DropDownList auto-postback: the form with every select's current value and this one changed
    const form = { ...formFields(h), __EVENTTARGET: field, __EVENTARGUMENT: '',
      [field]: combo.select.find((o) => norm(o.text) === norm(text)).value };
    const res = await request(action, { method: 'POST', form, jar, referer: page.url });
    const step = { combo: id, kind: 'select', text, value: form[field], status: res.status, length: res.html.length,
      after: res.status === 200 ? parseCombo(normalizeAttrs(res.html), id).value : null };
    return { res, step };
  }
  const value = client.values[index] ?? '';
  // variant 0: hidden fields only (lean, as the participants button); 1: a browser's full form; 2: lean, no command
  const form = {
    ...(variant === 1 ? formFields(h) : hiddenInputs(h)),
    __EVENTTARGET: `ctl00$ContentPlaceHolder1$${id}`,
    __EVENTARGUMENT: variant === 2 ? '' : JSON.stringify({ Command: 'Select', Index: index }),
    [`ctl00$ContentPlaceHolder1$${id}`]: text,
    [`${CP}${id}_ClientState`]: JSON.stringify({ logEntries: [], value, text, enabled: true, checkedIndices: [], checkedItemsTextOverflows: false }),
  };
  const res = await request(action, { method: 'POST', form, jar, referer: page.url });
  const after = normalizeAttrs(res.html);
  const step = { combo: id, text, index, value, variant, ...answerOf(res),
    // an ASP.NET error page names its problem in the first heading
    error: textOf(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(res.html)?.[1] || /<b>\s*Exception Details:[\s\S]{0,300}/i.exec(res.html)?.[0] || '').slice(0, 300),
    combosAfter: (after.match(/class="RadComboBox/g) || []).length,
    viewState: 'VIEWSTATE' in Object.fromEntries(Object.keys(form).map((k) => [k.replace(/^__/, ''), 1])), items: client.values.length,
    after: res.status === 200 ? parseCombo(after, id).value : null };
  return { res, step };
}

/** Selects text in a combo; if the first postback form leaves the selection unchanged, tries the second. */
async function chooseInCombo(page, jar, id, text, steps) {
  for (const variant of [0, 1, 2]) {
    try {
      const { res, step } = await selectCombo(page, jar, id, text, variant);
      steps.push(step);
      if (res.status === 200 && step.after === text) return res;
    } catch (err) {
      steps.push({ combo: id, text, variant, error: err.message, ...(err.diag ? { diag: err.diag } : {}) });
      return null;
    }
  }
  return null;
}

/** One league's ranking for a season and category (the site's defaults when not given). */
const getRanking = async ({ league = 'foot', season = '', category = '' } = {}) => {
  const key = `ranking:${league}:${season}:${category}`;
  const r = await loadRanking({ league, season, category }, key);
  if (r.notApplied || r.empty) cache.delete(key); // a failed switch is retried next time, not served for an hour
  return r;
};
const loadRanking = ({ league, season, category }, key) => cached(key, async () => {
  const L = LEAGUES[league];
  if (!L) throw new Error(`unknown league ${league}`);
  const jar = new Map();
  const steps = [];
  let page = await request(PAGES.ranking, { jar });
  if (page.status !== 200) throw new Error(`${PAGES.ranking} → HTTP ${page.status}`);
  const first = page;
  const current = () => parseRanking(page.html, page.url).leagues[league];
  let parsed = current();
  // The site fills a league's lists when its tab is opened, its categories once a season is chosen and the
  // table once a category is chosen: walk the same steps. With nothing asked, the site's choice or the first item.
  if (parsed && !parsed.season.options.length) {
    const next = await openLeagueTab(page, jar, league, steps);
    if (next) { page = next; parsed = current(); }
  }
  const norm = (t) => String(t).replace(/\s+/g, '').toLowerCase();
  const notApplied = [];
  for (const [asked, comboId, field] of [[season, L.season, 'season'], [category, L.category, 'category']]) {
    const c = parsed?.[field];
    if (!c) break;
    let want = asked && c.options.find((o) => norm(o) === norm(asked));
    if (asked && !want && c.options.length) notApplied.push({ [field]: asked, reason: 'not in this season' });
    if (!want) want = c.value || c.options[0];
    // a season already shown still needs choosing when its categories have not been filled in yet
    if (!want || (norm(c.value) === norm(want) && (field !== 'season' || parsed.category.options.length))) continue;
    const next = await chooseInCombo(page, jar, comboId, want, steps);
    if (!next) { notApplied.push({ [field]: want }); break; }
    page = next;
    parsed = current();
  }
  if (!parsed) {
    const err = new Error('the ranking page has no such league');
    err.diag = { league, wanted: [L.season, L.category], ...rankingPageDiag(page.html), steps,
      // the raw markup around the controls, to see how the live page renders them
      raw: rawAround(page.html, [`${CP}${L.season}_DropDown`, `${CP}${L.category}_DropDown`, `"${CP}${L.season}_ClientState"`, `id="${CP}${L.grids[0][0]}"`, 'RadGrid', `${CP}${LEAGUES.foot.season}_DropDown`]) };
    throw err;
  }
  return {
    source: PAGES.ranking, fetchedAt: new Date().toISOString(),
    leagues: Object.fromEntries(Object.entries(LEAGUES).map(([k, v]) => [k, v.title])), ...parsed,
    // the site did not switch to what was asked: say so, with what was tried
    ...(notApplied.length ? { notApplied } : {}),
    // a failed switch or an empty answer carries what was tried and what the page held, for a bug report
    ...(notApplied.length || !parsed.season.options.length || !parsed.grids.length ? { empty: !parsed.grids.length, diag: {
      steps, hidden: Object.keys(hiddenInputs(normalizeAttrs(page.html))).filter((k) => /^__/.test(k)), page: rankingPageDiag(page.html),
      get: { url: page.url, hops: first.hops || null, action: formAction(normalizeAttrs(first.html), first), cookies: [...jar.keys()],
        viewState: (hiddenInputs(normalizeAttrs(first.html)).__VIEWSTATE || '').length },
      raw: rawAround(page.html, [`${CP}${L.season}_DropDown`, `${CP}${L.category}_DropDown`, `id="${CP}RadTabStrip1"`], 700),
    } } : {}),
  };
}, 60 * 60 * 1000);

module.exports = {
  PAGES, fetchHtml, getEvents, getNews, getForum, getEventPage, getParticipants, parseParticipants,
  parseHome, parseEventPage, parseRanking, getRanking, comboClientData, parseForum, parseForumRss, parseCalendar, mergeEvents, eventFlags, fileKind,
  parseDate, dateFromTitle, cleanTitle, tagsOf, eventTags, ageMinutes, paragraphs, clubLogo, parseClubLogo,
};
