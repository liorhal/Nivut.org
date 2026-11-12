'use strict';
// A start list attached to an event ("זמני זינוק", an HTML page or a PDF), read into rows of
// { text: everything on the row, start: "10:24" } – enough to find a person on it by name and read their start.

const { decodePage } = require('./results');

const HEB = /[֐-׿]/;
/** The PDF stores Hebrew in visual order: each word back, and the words in reading order. */
const logical = (s) => (HEB.test(s) ? s.split(/\s+/).filter(Boolean).reverse().map((w) => (HEB.test(w) ? [...w].reverse().join('') : w)).join(' ') : s.trim());
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const text = (h) => String(h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m))
  .replace(/\s+/g, ' ').trim();
// a start time: 9:12, 09:12, 10:24:30 (seconds dropped); not a running time like 0:43:41
const START = /(?:^|[^\d:])((?:[0-1]?\d|2[0-3]):[0-5]\d)(?::[0-5]\d)?(?![\d:])/;

function rowsOf(lines) {
  return lines.map((t) => {
    const m = START.exec(t);
    if (!m || !/\p{L}{2}/u.test(t)) return null;
    const [h, mm] = m[1].split(':');
    if (+h < 5) return null; // 0:43 is a running time, not a start
    return { text: t, start: `${h.padStart(2, '0')}:${mm}` };
  }).filter(Boolean);
}

/** Rows of a start list from an HTML page (a table row, or a line of text) or a PDF's bytes. */
function parseStartList(input) {
  if (Buffer.isBuffer(input) && input.subarray(0, 5).toString('latin1') === '%PDF-') {
    const { pdfLines } = require('./pdftext');
    return rowsOf(pdfLines(input).map((cells) => logical(cells.map((c) => c.text.trim()).join(' ').replace(/\s+/g, ' '))));
  }
  const h = Buffer.isBuffer(input) ? decodePage(input) : String(input || '');
  const body = h.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const trs = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => text(c[1])).filter(Boolean).join(' '));
  const rows = rowsOf(trs);
  if (rows.length) return rows;
  // no table: lines of text (pre, divs, paragraphs)
  return rowsOf(body.replace(/<(?:br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '\n').split('\n').map(text));
}

module.exports = { parseStartList };
