'use strict';
// A small PDF text reader (no dependencies): enough for results lists printed to PDF.
// Reads the pages' content streams (Flate), maps glyph codes to Unicode through each font's ToUnicode CMap,
// and returns the text as lines, each a list of cells ({ x, text }) in page order, top to bottom.
// Not a general PDF parser: no encryption, no object streams for page content, no Type3 fonts.

const zlib = require('zlib');

function parseObjects(buf) {
  const src = buf.toString('latin1');
  const objs = new Map();
  for (const m of src.matchAll(/(\d+)\s+0\s+obj\b/g)) {
    const start = m.index + m[0].length;
    const end = src.indexOf('endobj', start);
    if (end < 0) continue;
    objs.set(+m[1], { start, end, body: src.slice(start, end) });
  }
  return { src, objs };
}

/** A stream's bytes, inflated when Flate-encoded. */
function streamOf(pdf, num) {
  const o = pdf.objs.get(num);
  if (!o) return null;
  const s = /stream\r?\n/.exec(o.body);
  if (!s) return null;
  const dict = o.body.slice(0, s.index);
  let len = /\/Length\s+(\d+)(\s+0\s+R)?/.exec(dict);
  let n = len ? +len[1] : -1;
  if (len?.[2]) n = +(/^\s*(\d+)/.exec(pdf.objs.get(n)?.body || '')?.[1] || -1);
  const from = o.start + s.index + s[0].length;
  const raw = Buffer.from(pdf.src.slice(from, n >= 0 ? from + n : o.start + o.body.lastIndexOf('endstream')), 'latin1');
  if (!/\/FlateDecode/.test(dict)) return raw;
  try { return zlib.inflateSync(raw); } catch { try { return zlib.inflateRawSync(raw.subarray(2)); } catch { return null; } }
}

const ref = (s, key) => +(new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(s)?.[1] || 0) || null;
const hex = (h) => parseInt(h, 16);

/** ToUnicode CMap: code → string, and how many bytes a code takes. */
function parseCMap(text) {
  const map = new Map();
  const bytes = (/<([0-9a-f]+)>\s*<[0-9a-f]+>\s*endcodespacerange/i.exec(text)?.[1].length || 4) / 2;
  const u16 = (h) => { let s = ''; for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(hex(h.slice(i, i + 4))); return s; };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) map.set(hex(m[1]), u16(m[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(?:<([0-9a-f]+)>|\[([^\]]*)\])/gi)) {
      const lo = hex(m[1]), hi = hex(m[2]);
      if (m[3]) { const base = hex(m[3]); for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(base + (c - lo))); }
      else [...m[4].matchAll(/<([0-9a-f]+)>/gi)].forEach((x, i) => map.set(lo + i, u16(x[1])));
    }
  }
  return { map, bytes };
}

/** The page objects in reading order (following /Kids from the root /Pages). */
function pageList(pdf) {
  const root = [...pdf.objs.entries()].find(([, o]) => /\/Type\s*\/Pages\b/.test(o.body) && !/\/Parent\s/.test(o.body));
  const out = [];
  const walk = (num, depth = 0) => {
    const body = pdf.objs.get(num)?.body || '';
    if (depth > 20) return;
    if (/\/Type\s*\/Page\b/.test(body)) { out.push(num); return; }
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(body)?.[1] || '';
    for (const k of kids.matchAll(/(\d+)\s+0\s+R/g)) walk(+k[1], depth + 1);
  };
  if (root) walk(root[0]);
  if (!out.length) for (const [n, o] of pdf.objs) if (/\/Type\s*\/Page\b/.test(o.body)) out.push(n);
  return out;
}

/** Fonts of a page: resource name → CMap (fonts without ToUnicode read their bytes as Latin-1). */
function pageFonts(pdf, pageBody, cache) {
  let res = /\/Resources\s*(<<[\s\S]*?>>\s*>>|<<[\s\S]*?>>)/.exec(pageBody)?.[1] || '';
  const resRef = ref(pageBody, 'Resources');
  if (resRef) res = pdf.objs.get(resRef)?.body || '';
  let fontDict = /\/Font\s*<<([\s\S]*?)>>/.exec(res)?.[1] || '';
  const fontRef = ref(res, 'Font');
  if (fontRef) fontDict = pdf.objs.get(fontRef)?.body || '';
  const fonts = {};
  for (const m of fontDict.matchAll(/\/([\w.+-]+)\s+(\d+)\s+0\s+R/g)) {
    const num = +m[2];
    if (!cache.has(num)) {
      const tu = ref(pdf.objs.get(num)?.body || '', 'ToUnicode');
      const data = tu && streamOf(pdf, tu);
      cache.set(num, data ? parseCMap(data.toString('latin1')) : { map: null, bytes: 1 });
    }
    fonts[m[1]] = cache.get(num);
  }
  return fonts;
}

/** Content stream tokens: numbers, names, strings (literal and hex), arrays, operators. */
function* tokens(s) {
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '(') {
      let depth = 1, out = '';
      i++;
      while (i < n && depth) {
        const ch = s[i];
        if (ch === '\\') {
          const nx = s[i + 1];
          const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
          if (esc[nx] !== undefined) { out += esc[nx]; i += 2; continue; }
          const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4));
          if (oct) { out += String.fromCharCode(parseInt(oct[0], 8)); i += 1 + oct[0].length; continue; }
          i += 2; continue;
        }
        if (ch === '(') depth++;
        if (ch === ')' && !--depth) { i++; break; }
        out += ch; i++;
      }
      yield { t: 'str', v: out };
      continue;
    }
    if (c === '<' && s[i + 1] !== '<') {
      const end = s.indexOf('>', i);
      const h = s.slice(i + 1, end).replace(/\s+/g, '');
      let out = '';
      for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(hex((h.slice(k, k + 2) + '0').slice(0, 2)));
      yield { t: 'str', v: out };
      i = end + 1;
      continue;
    }
    if (c === '[' || c === ']') { yield { t: c }; i++; continue; }
    if (c === '<' || c === '>') { i += 2; yield { t: c + c }; continue; }
    if (c === '/') { const m = /^\/[^\s/<>[\]()%]*/.exec(s.slice(i, i + 128)); yield { t: 'name', v: m[0].slice(1) }; i += m[0].length; continue; }
    const m = /^[^\s/<>[\]()%]+/.exec(s.slice(i, i + 64));
    i += m[0].length;
    yield /^[-+]?(\d+\.?\d*|\.\d+)$/.test(m[0]) ? { t: 'num', v: +m[0] } : { t: 'op', v: m[0] };
  }
}

const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];

/** The text pieces of one page: { x, y (top = larger), text }. */
function pageCells(content, fonts) {
  const cells = [];
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0], tm = [1, 0, 0, 1, 0, 0], lm = [1, 0, 0, 1, 0, 0], font = null, size = 1, leading = 0;
  let operands = [], arr = null;
  const decode = (str) => {
    if (!font?.map) return str;
    let out = '';
    for (let k = 0; k + font.bytes <= str.length; k += font.bytes) {
      let code = 0;
      for (let b = 0; b < font.bytes; b++) code = code * 256 + str.charCodeAt(k + b);
      out += font.map.get(code) ?? '';
    }
    return out;
  };
  const show = (parts) => {
    // a large negative adjustment inside TJ is a gap between words or columns
    let text = '';
    for (const p of parts) text += typeof p === 'number' ? (p < -180 ? ' ' : '') : decode(p);
    const m = mul(tm, ctm);
    if (text.trim()) cells.push({ x: m[4], y: m[5], text });
  };
  for (const tk of tokens(content)) {
    if (tk.t === '[') { arr = []; continue; }
    if (tk.t === ']') { operands.push(arr); arr = null; continue; }
    if (arr) { if (tk.t === 'num') arr.push(tk.v); else if (tk.t === 'str') arr.push(tk.v); continue; }
    if (tk.t !== 'op') { operands.push(tk.t === 'num' || tk.t === 'str' || tk.t === 'name' ? tk.v : null); continue; }
    const o = operands;
    switch (tk.v) {
      case 'q': stack.push(ctm); break;
      case 'Q': ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; break;
      case 'cm': if (o.length >= 6) ctm = mul(o.slice(-6), ctm); break;
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; lm = tm; break;
      case 'Tf': font = fonts[o[o.length - 2]] || null; size = o[o.length - 1] || 1; break;
      case 'TL': leading = o[0] || 0; break;
      case 'Tm': if (o.length >= 6) { tm = o.slice(-6); lm = tm; } break;
      case 'Td': case 'TD': lm = mul([1, 0, 0, 1, o[0] || 0, o[1] || 0], lm); tm = lm; if (tk.v === 'TD') leading = -(o[1] || 0); break;
      case 'T*': lm = mul([1, 0, 0, 1, 0, -leading], lm); tm = lm; break;
      case 'Tj': show([o[o.length - 1] || '']); break;
      case 'TJ': show(o[o.length - 1] || []); break;
      case "'": lm = mul([1, 0, 0, 1, 0, -leading], lm); tm = lm; show([o[o.length - 1] || '']); break;
      case '"': lm = mul([1, 0, 0, 1, 0, -leading], lm); tm = lm; show([o[o.length - 1] || '']); break;
      default: break;
    }
    operands = [];
    void size;
  }
  return cells;
}

/**
 * The PDF's text, page by page and line by line: [[{ x, text }, …], …] (cells left to right).
 * Throws when the file is not a PDF it can read.
 */
function pdfLines(buf) {
  if (!buf || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('not a PDF');
  const pdf = parseObjects(buf);
  const cache = new Map();
  const lines = [];
  for (const num of pageList(pdf)) {
    const body = pdf.objs.get(num).body;
    const fonts = pageFonts(pdf, body, cache);
    const contents = /\/Contents\s*\[([^\]]*)\]/.exec(body)?.[1] || /\/Contents\s+(\d+\s+0\s+R)/.exec(body)?.[1] || '';
    const content = [...contents.matchAll(/(\d+)\s+0\s+R/g)].map((m) => streamOf(pdf, +m[1])).filter(Boolean).map((b) => b.toString('latin1')).join('\n');
    const cells = pageCells(content, fonts);
    // rows: cells whose baselines are within 2 points, top to bottom; cells in a row left to right
    cells.sort((a, b) => b.y - a.y || a.x - b.x);
    let row = null;
    for (const c of cells) {
      if (!row || Math.abs(row.y - c.y) > 2) { row = { y: c.y, cells: [] }; lines.push(row); }
      row.cells.push({ x: c.x, text: c.text });
    }
  }
  return lines.map((r) => r.cells.sort((a, b) => a.x - b.x));
}

module.exports = { pdfLines };
