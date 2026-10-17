'use strict';
// Results files that events attach on nivut.org.il (HTML exports of the timing software), read into one shape:
//   { format, title, date, courses: [{ name, info, controls: ['1 (31)', …, 'Finish'], runners: [
//       { pos, name, club, time (seconds | null), status ('OK' | 'MP' | 'DNF' | …), splits: [cumulative seconds | null],
//         and from a LapCombat analysis: speed: [leg speed index | null], mistake: [leg mistake seconds | null],
//         speedAvg, mistakeTotal, cruise (cruising speed index), mistakeRatio (%), ideal (seconds without mistakes) }] }] }
// Formats seen so far:
//   sidroid-results  SI-Droid Event "Results" (a table per course, no splits)
//   sidroid-splits   SI-Droid Event "Split times" (per course: cumulative and leg times at every control)
//   analysis         a transposed "splits analysis" (a column per runner; "Elapse time" rows per control)
//   pdf              a results PDF converted by pdf2htmlEX (text lines: category, then "* 1 (card) name time club")

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
  return ENTITIES[e.toLowerCase()] ?? m;
});
const text = (h) => decode(String(h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const cellsOf = (tr) => [...tr.matchAll(/<t([hd])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)].map((m) => ({ tag: `t${m[1].toLowerCase()}`, attrs: m[2], html: m[3], text: text(m[3]) }));
const classOf = (attrs) => /class="([^"]*)"/i.exec(attrs)?.[1] || '';

const STATUS = /^(MP|DNF|DSQ|DNS|OT|OVT|DISQ|NC)$/i;

/** "17:07", "0:43:41", "103:34" → seconds; anything else (MP, -:--, empty) → null. */
function seconds(t) {
  const m = /^(-)?(\d+):(\d\d)(?::(\d\d))?$/.exec(String(t || '').trim());
  if (!m) return null;
  const v = m[4] !== undefined ? +m[2] * 3600 + +m[3] * 60 + +m[4] : +m[2] * 60 + +m[3];
  return m[1] ? -v : v;
}

function runner(pos, name, club, timeText) {
  const t = String(timeText || '').trim();
  const status = STATUS.test(t) ? t.toUpperCase() : seconds(t) !== null ? 'OK' : t || 'OK';
  return { pos: String(pos || '').trim(), name: String(name || '').trim(), club: String(club || '').trim(), time: status === 'OK' ? seconds(t) : null, status, splits: [] };
}

/* ---------- SI-Droid "Results" ---------- */
function parseSidroidResults(h) {
  return [...h.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)].map(([, sec]) => {
    const name = text(/class="category"[^>]*>([\s\S]*?)<\/span>/i.exec(sec)?.[1]);
    if (!name) return null;
    const info = text(/class="controls"[^>]*>([\s\S]*?)<\/span>/i.exec(sec)?.[1]);
    const runners = [...sec.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, tr]) => {
      const pick = (c) => text(new RegExp(`class="${c}"[^>]*>([\\s\\S]*?)</td>`, 'i').exec(tr)?.[1]);
      return pick('name') ? runner(pick('pos'), pick('name'), pick('club'), pick('time')) : null;
    }).filter(Boolean);
    return { name, info, controls: [], runners };
  }).filter(Boolean);
}

/* ---------- SI-Droid "Split times" ---------- */
function parseSidroidSplits(h) {
  return [...h.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(([, table]) => {
    const rows = [...table.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)].map((m) => ({ cls: classOf(m[1]), cells: cellsOf(m[2]) }));
    const head = rows.find((r) => r.cls === 'head1');
    if (!head) return null;
    const name = head.cells[0]?.text.replace(/\s*\(\d+\)\s*$/, '') || '';
    const info = head.cells[1]?.text || '';
    const controls = rows.filter((r) => /^codes\d/.test(r.cls)).flatMap((r) => r.cells.slice(1).map((c) => c.text).filter((t) => t && t !== ' '));
    const runners = [];
    let cur = null;
    for (const r of rows) {
      if (/^rr1a/.test(r.cls) && r.cells.some((c) => classOf(c.attrs) === 'name')) {
        const get = (k) => r.cells.find((c) => classOf(c.attrs) === k)?.text;
        cur = runner(get('pos'), get('name'), '', get('time'));
        runners.push(cur);
      } else if (!cur) continue;
      if (/^rr1b/.test(r.cls)) cur.club = r.cells.find((c) => classOf(c.attrs) === 'club')?.text || '';
      // rows "rrNa" hold the cumulative times; "rrE…" are extra punches and "rIdeal" the course's ideal legs
      if (/^rr\d+a/.test(r.cls)) for (const c of r.cells) if (/\bc_tt\b/.test(classOf(c.attrs))) cur.splits.push(seconds(c.text));
      if (r.cls === 'rIdeal') cur = null;
    }
    return { name, info, controls, runners };
  }).filter((c) => c && c.runners.length);
}

/* ---------- transposed "splits analysis" ---------- */
function parseAnalysis(h) {
  const title = text(/<h2>([\s\S]*?)<\/h2>/i.exec(h)?.[1]);
  const rows = [...h.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => cellsOf(m[1]));
  const label = (r) => (r[0]?.tag === 'th' ? r[0].text : '');
  const values = (row) => row.slice(1).map((c) => c.text);
  const nameRow = rows.find((r) => label(r) === 'name');
  if (!nameRow) return [];
  const names = values(nameRow);
  const pickRow = (k) => values(rows.find((r) => label(r) === k) || []);
  const clubs = pickRow('club'), results = pickRow('result'), places = pickRow('place');
  const runners = names.map((n, i) => runner(places[i], n, clubs[i], results[i]));
  // the "Elapse time" section: a row per control ("- 1" … "- F"), each runner as a (time, rank) pair
  const start = rows.findIndex((r) => r.length === 1 && /elaps/i.test(r[0].text));
  const controls = [];
  for (let i = start + 1; start >= 0 && i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 || label(r) === 'name') break;
    const ctl = label(r).replace(/^-\s*/, '');
    controls.push(/^F$/i.test(ctl) ? 'Finish' : ctl);
    values(r).filter((_, k) => k % 2 === 0).forEach((t, k) => runners[k]?.splits.push(seconds(t)));
  }
  // LapCombat's further sections: per leg a single value per runner, and a few per-runner summaries
  const section = (re) => {
    const at = rows.findIndex((r) => r.length === 1 && re.test(r[0].text));
    const out = [];
    for (let i = at + 1; at >= 0 && i < rows.length && rows[i].length > 1 && label(rows[i]) !== 'name'; i++) out.push(rows[i]);
    return out;
  };
  const num = (t) => (/^-?\d+(\.\d+)?$/.test(String(t).trim()) ? +t : null);
  // rows "S - 1" … "23 - F", then a closing "average" / "total" row
  const perLeg = (re, conv, key, totalKey) => {
    const rs = section(re);
    const legs = rs.filter((r) => label(r).includes('-')).map(values);
    if (legs.length !== controls.length) return false;
    const total = rs.find((r) => !label(r).includes('-'));
    runners.forEach((r, k) => {
      r[key] = legs.map((row) => conv(row[k] ?? ''));
      if (total) r[totalKey] = conv(values(total)[k] ?? '');
    });
    return true;
  };
  const lap = { speed: perLeg(/leg speed index/i, num, 'speed', 'speedAvg'), mistake: perLeg(/leg mistake time/i, seconds, 'mistake', 'mistakeTotal') };
  const summary = (re, conv, key) => { const row = section(re)[0]; if (row) runners.forEach((r, k) => { r[key] = conv(values(row)[k] ?? ''); }); };
  summary(/cruising speed index/i, num, 'cruise');
  summary(/mistake ratio/i, num, 'mistakeRatio');
  summary(/ideal finishing time/i, seconds, 'ideal');
  return [{ name: title || 'מסלול', info: '', controls, runners, ...(lap.speed || lap.mistake ? { lap } : {}) }];
}

/* ---------- a results PDF converted to HTML (pdf2htmlEX) ---------- */
const HEB = /[\u0590-\u05FF]/;
/** The PDF stores Hebrew in visual order: put each word back, and the words in reading order. */
const logical = (s) => (HEB.test(s) ? s.split(/\s+/).filter(Boolean).reverse().map((w) => (HEB.test(w) ? [...w].reverse().join('') : w)).join(' ') : s.trim());
const PDF_LINE = /^([*?X])\s+(?:(\d+)\s+)?\(\s*(\d*)\)?\s+(.*?)\s+(\d{1,2}:\d\d:\d\d|\d+:\d\d|MP|DNF|DSQ|DNS|OT)(?:\s+(.*))?$/;

/**
 * Lines of an OE-style results list (as printed to PDF, Hebrew in visual order): a header line with the event and
 * its date on every page, the category, then "* 1 (card) name time club" rows and a "( D12 , Not finish … )" footer.
 */
function parseResultLines(lines) {
  const courses = [];
  let cur = null, title = '', date = '';
  for (const line of lines) {
    if (!line || line.startsWith('(')) continue;
    const d = /\b(\d{1,2})[-./](\d{1,2})[-./](\d{4})\b/.exec(line);
    if (d) { // the page header: the event and its date
      if (!date) date = `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
      if (!title) title = logical(line.replace(d[0], ' ')).trim();
      continue;
    }
    const m = PDF_LINE.exec(line);
    if (m) {
      if (cur) cur.runners.push(runner(m[1] === 'X' ? '-' : m[2] || '', logical(m[4]), logical(m[6] || ''), m[5]));
    } else if (/^[A-Za-z\u0590-\u05FF0-9][\w\u0590-\u05FF+\- ]{0,20}$/.test(line)) {
      const name = logical(line);
      if (cur?.name === name) continue; // the category repeated at a page break
      cur = courses.find((c) => c.name === name) || null;
      if (!cur) { cur = { name, info: '', controls: [], runners: [] }; courses.push(cur); }
    }
  }
  return { title, date, courses: courses.filter((c) => c.runners.length) };
}
const parsePdfHtml = (h) => parseResultLines([...h.matchAll(/<div class="t [^"]*"[^>]*>([\s\S]*?)<\/div>/gi)].map((m) => text(m[1])));

/** Cumulative times only grow: a value below an earlier one (a DNF's 0:00 at the finish) is no time. */
function tidy(courses) {
  for (const c of courses) for (const r of c.runners) {
    let last = -1;
    r.splits = r.splits.map((v) => (v === null || v < last || v === 0 ? null : (last = v)));
    if (r.status === 'OK' && r.time && c.controls.length && r.splits.length === c.controls.length) r.splits[r.splits.length - 1] ??= r.time;
  }
  return courses;
}

/** Reads a results file; format 'unknown' when none of the known layouts fits. */
function parseResultFile(input) {
  // a PDF itself: its text lines, read like the converted ones
  if (Buffer.isBuffer(input) && input.subarray(0, 5).toString('latin1') === '%PDF-') {
    const { pdfLines } = require('./pdftext');
    const r = parseResultLines(pdfLines(input).map((cells) => cells.map((c) => c.text.trim()).join(' ').replace(/\s+/g, ' ').trim()));
    return { format: r.courses.length ? 'pdf' : 'unknown', title: r.title, date: r.date, courses: tidy(r.courses) };
  }
  // A browser's "save as" quotes every attribute; the file as published may not (class=c_tt, class='c_tt').
  const h = String(input || '')
    .replace(/(<[a-z][^>]*?\s[\w:-]+)='([^']*)'/gi, '$1="$2"')
    .replace(/(\s[\w:-]+)=([^\s"'>]+)(?=[\s>])/g, '$1="$2"');
  const title = text(/<title>([\s\S]*?)<\/title>/i.exec(h)?.[1]).replace(/,?\s*(Results|Split times)$/i, '');
  const date = /\b(\d{4})[-/](\d{2})[-/](\d{2})\b/.exec(text(/<h[1-4]\b[^>]*>[\s\S]*?<\/h[1-4]>/i.exec(h)?.[0]) + ' ' + text(h.slice(0, 20000)))?.slice(1).join('-') || '';
  let format = 'unknown', courses = [];
  if (/class="c_tt/.test(h)) { format = 'sidroid-splits'; courses = parseSidroidSplits(h); }
  else if (/class="cat-title"/.test(h)) { format = 'sidroid-results'; courses = parseSidroidResults(h); }
  else if (/Elapse\s*time/i.test(h)) { format = 'analysis'; courses = parseAnalysis(h); }
  else if (/name="generator" content="pdf2htmlEX"/i.test(h)) {
    const r = parsePdfHtml(h);
    return { format: r.courses.length ? 'pdf' : 'unknown', title: r.title || title, date: r.date || date, courses: tidy(r.courses) };
  }
  const event = text(/<h4>([\s\S]*?)<br/i.exec(h)?.[1]) || title;
  // not recognised: say what arrived, for a bug report
  const diag = courses.length ? null : {
    length: h.length, title, start: text(h.slice(0, 600)).slice(0, 300),
    marks: ['c_tt', 'cat-title', 'Elapse', 'pdf2htmlEX', '<table', '<pre'].filter((m) => h.includes(m)),
  };
  return { format: courses.length ? format : 'unknown', title: event, date, courses: tidy(courses), ...(diag ? { diag } : {}) };
}

module.exports = { parseResultFile, seconds, logical };
