(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const DAYS_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  const parseDate = (d, t = '00:00') => {
    const [y, m, day] = d.split('-').map(Number);
    const [hh, mm] = t.split(':').map(Number);
    return new Date(y, m - 1, day, hh || 0, mm || 0);
  };
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 864e5);
  const fmtLong = (d) => `יום ${DAYS[d.getDay()]}, ${d.getDate()} ב${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const state = {
    config: null, types: {}, events: [], forum: null,
    filter: { q: '', region: '', types: new Set() },
    forumCat: '', annualMode: 'year', monthCursor: null,
  };

  /* ---------- Accessibility & display preferences ---------- */
  function initPrefs() {
    const root = document.documentElement;
    let scale = store.get('scale', 1);
    const applyScale = () => root.style.setProperty('--scale', scale);
    applyScale();
    $('#fontUp').addEventListener('click', () => { scale = Math.min(1.5, +(scale + 0.1).toFixed(2)); applyScale(); store.set('scale', scale); });
    $('#fontDown').addEventListener('click', () => { scale = Math.max(0.8, +(scale - 0.1).toFixed(2)); applyScale(); store.set('scale', scale); });

    const contrastBtn = $('#contrastToggle');
    const setContrast = (on) => {
      if (on) root.dataset.contrast = 'high'; else delete root.dataset.contrast;
      contrastBtn.setAttribute('aria-pressed', String(on));
    };
    setContrast(store.get('contrast', false));
    contrastBtn.addEventListener('click', () => { const on = !root.dataset.contrast; setContrast(on); store.set('contrast', on); });

    const themeBtn = $('#themeToggle');
    const saved = store.get('theme', null);
    if (saved) root.dataset.theme = saved;
    const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const syncThemeBtn = () => { themeBtn.textContent = isDark() ? '☀' : '☾'; themeBtn.setAttribute('aria-label', isDark() ? 'עבור למצב בהיר' : 'עבור למצב כהה'); };
    syncThemeBtn();
    themeBtn.addEventListener('click', () => { root.dataset.theme = isDark() ? 'light' : 'dark'; store.set('theme', root.dataset.theme); syncThemeBtn(); });
  }

  /* ---------- Routing ---------- */
  const VIEWS = ['upcoming', 'annual', 'forum'];
  function route() {
    const hash = location.hash.slice(1);
    const view = VIEWS.includes(hash) ? hash : 'upcoming';
    VIEWS.forEach((v) => { $(`#view-${v}`).hidden = v !== view; });
    $$('.tabs a').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.view === view)));
    const titles = { upcoming: 'ניווטים קרובים', annual: 'תוכנית שנתית', forum: 'פורום' };
    document.title = `${titles[view]} – ניווט ישראל`;
    if (hash && VIEWS.includes(hash)) $('#main').focus({ preventScroll: true });
  }

  /* ---------- Shared bits ---------- */
  const typeOf = (e) => state.types[e.type] || { label: e.type, color: '#64748b' };
  const evDate = (e) => parseDate(e.date, e.time);

  function mapsUrl(e) {
    const q = e.lat && e.lng ? `${e.lat},${e.lng}` : e.location;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  function wazeUrl(e) {
    return e.lat && e.lng
      ? `https://waze.com/ul?ll=${e.lat},${e.lng}&navigate=yes`
      : `https://waze.com/ul?q=${encodeURIComponent(e.location)}&navigate=yes`;
  }

  function icsFor(events) {
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const clean = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const now = new Date();
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//nivut-wrapper//HE', 'CALSCALE:GREGORIAN'];
    events.forEach((e) => {
      const s = evDate(e);
      const end = new Date(s.getTime() + 4 * 3600e3);
      lines.push('BEGIN:VEVENT', `UID:${e.id}@nivut-wrapper`, `DTSTAMP:${stamp(now)}`,
        `DTSTART;TZID=Asia/Jerusalem:${stamp(s)}`, `DTEND;TZID=Asia/Jerusalem:${stamp(end)}`,
        `SUMMARY:${clean(e.title)}`, `LOCATION:${clean(e.location)}`,
        `DESCRIPTION:${clean([typeOf(e).label, e.club, e.description].filter(Boolean).join(' · '))}`, 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }
  function downloadIcs(events, name) {
    const url = URL.createObjectURL(new Blob([icsFor(events)], { type: 'text/calendar;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- Event dialog ---------- */
  function openEvent(id, opener) {
    const e = state.events.find((x) => x.id === id);
    if (!e) return;
    const t = typeOf(e);
    const d = evDate(e);
    const left = daysBetween(new Date(), d);
    const deadline = e.registrationDeadline ? parseDate(e.registrationDeadline) : null;
    $('#dlgBody').innerHTML = `
      <span class="tag" style="--c:${esc(t.color)}"><span class="dot"></span>${esc(t.label)}</span>
      <h2 id="dlgTitle">${esc(e.title)}</h2>
      ${e.description ? `<p>${esc(e.description)}</p>` : ''}
      <dl>
        <dt>מועד</dt><dd>${fmtLong(d)}${e.time ? `, ${esc(e.time)}` : ''}${left >= 0 ? ` <span class="muted">(${left === 0 ? 'היום' : `בעוד ${left} ימים`})</span>` : ''}</dd>
        <dt>מיקום</dt><dd>${esc(e.location)}${e.region ? ` · ${esc(e.region)}` : ''}</dd>
        ${e.club ? `<dt>מארגן</dt><dd>${esc(e.club)}</dd>` : ''}
        ${e.courses?.length ? `<dt>מסלולים</dt><dd>${e.courses.map(esc).join(' · ')}</dd>` : ''}
        ${deadline ? `<dt>סגירת הרשמה</dt><dd>${fmtLong(deadline)}</dd>` : ''}
      </dl>
      <div class="dlg-actions">
        <a class="btn" href="${esc(e.url || state.config.links.calendar)}" rel="noopener" target="_blank">פרטים והרשמה באתר האיגוד ↗</a>
        <button type="button" class="btn ghost" data-ics="${esc(e.id)}">הוסף ליומן</button>
        <a class="btn ghost" href="${esc(wazeUrl(e))}" rel="noopener" target="_blank">Waze</a>
        <a class="btn ghost" href="${esc(mapsUrl(e))}" rel="noopener" target="_blank">מפה</a>
      </div>`;
    const dlg = $('#eventDialog');
    dlg.showModal();
    dlg.addEventListener('close', () => opener?.focus(), { once: true });
  }

  document.addEventListener('click', (ev) => {
    const openBtn = ev.target.closest('[data-open]');
    if (openBtn) { openEvent(openBtn.dataset.open, openBtn); return; }
    const icsBtn = ev.target.closest('[data-ics]');
    if (icsBtn) {
      const e = state.events.find((x) => x.id === icsBtn.dataset.ics);
      if (e) downloadIcs([e], `${e.date}-${e.id}.ics`);
    }
  });

  /* ---------- Upcoming ---------- */
  function upcoming() {
    const today = startOfDay(new Date());
    return state.events.filter((e) => parseDate(e.date) >= today);
  }

  function renderNext() {
    const next = upcoming()[0];
    const box = $('#nextEvent');
    if (!next) { box.innerHTML = '<p>אין אירועים מתוכננים כרגע.</p>'; return; }
    const d = evDate(next);
    box.innerHTML = `
      <div style="flex:1 1 260px">
        <h2>${esc(next.title)}</h2>
        <p>${fmtLong(d)} · ${esc(next.location)}</p>
      </div>
      <div class="countdown" role="timer" aria-label="זמן שנותר לאירוע"></div>
      <button type="button" class="btn" data-open="${esc(next.id)}">לפרטים</button>`;
    const cd = $('.countdown', box);
    const tick = () => {
      const ms = Math.max(0, d - new Date());
      const parts = [[Math.floor(ms / 864e5), 'ימים'], [Math.floor(ms / 36e5) % 24, 'שעות'], [Math.floor(ms / 6e4) % 60, 'דקות']];
      cd.innerHTML = parts.map(([n, l]) => `<div><strong>${n}</strong><span>${l}</span></div>`).join('');
    };
    tick();
    clearInterval(renderNext.timer);
    renderNext.timer = setInterval(tick, 30000);
  }

  function renderFilters() {
    const chips = $('#typeChips');
    Object.entries(state.types).forEach(([key, t]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.type = key;
      b.setAttribute('aria-pressed', 'false');
      b.style.setProperty('--c', t.color);
      b.innerHTML = `<span class="dot"></span>${esc(t.label)}`;
      b.addEventListener('click', () => {
        const on = !state.filter.types.has(key);
        on ? state.filter.types.add(key) : state.filter.types.delete(key);
        b.setAttribute('aria-pressed', String(on));
        renderList();
      });
      chips.append(b);
    });
    const regions = [...new Set(state.events.map((e) => e.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
    $('#region').insertAdjacentHTML('beforeend', regions.map((r) => `<option>${esc(r)}</option>`).join(''));
    $('#q').addEventListener('input', (e) => { state.filter.q = e.target.value.trim(); renderList(); });
    $('#region').addEventListener('change', (e) => { state.filter.region = e.target.value; renderList(); });
  }

  function renderList() {
    const { q, region, types } = state.filter;
    const ql = q.toLowerCase();
    const list = upcoming().filter((e) =>
      (!types.size || types.has(e.type)) &&
      (!region || e.region === region) &&
      (!ql || [e.title, e.location, e.club, e.region].join(' ').toLowerCase().includes(ql)));
    $('#resultCount').textContent = `${list.length} אירועים קרובים`;
    const el = $('#eventList');
    if (!list.length) { el.innerHTML = '<li class="empty">לא נמצאו אירועים התואמים לסינון.</li>'; return; }
    const now = new Date();
    let lastMonth = '';
    el.innerHTML = list.map((e) => {
      const t = typeOf(e);
      const d = evDate(e);
      const mKey = `${d.getFullYear()}-${d.getMonth()}`;
      const sep = mKey !== lastMonth ? `<li class="month-sep" aria-hidden="true">${MONTHS[d.getMonth()]} ${d.getFullYear()}</li>` : '';
      lastMonth = mKey;
      const left = daysBetween(now, d);
      const deadline = e.registrationDeadline ? daysBetween(now, parseDate(e.registrationDeadline)) : null;
      return `${sep}<li>
        <article class="event-card" style="--c:${esc(t.color)}" aria-labelledby="t-${esc(e.id)}">
          <div class="date-badge" aria-hidden="true"><span class="d">${d.getDate()}</span><span class="m">${MONTHS[d.getMonth()]}</span><span class="w">יום ${DAYS_SHORT[d.getDay()]}</span></div>
          <div>
            <span class="tag"><span class="dot"></span>${esc(t.label)}</span>
            ${left <= 7 ? `<span class="soon">${left === 0 ? 'היום' : `בעוד ${left} ימים`}</span>` : ''}
            <h3 id="t-${esc(e.id)}"><button type="button" data-open="${esc(e.id)}">${esc(e.title)}</button></h3>
            <ul class="meta">
              <li><span class="sr-only">מועד: </span>${fmtLong(d)}${e.time ? ` · ${esc(e.time)}` : ''}</li>
              <li>📍 ${esc(e.location)}</li>
              ${e.club ? `<li>${esc(e.club)}</li>` : ''}
              ${deadline !== null && deadline >= 0 ? `<li><strong>הרשמה נסגרת ${deadline === 0 ? 'היום' : `בעוד ${deadline} ימים`}</strong></li>` : ''}
            </ul>
          </div>
          <div class="card-actions">
            <button type="button" class="btn ghost" data-ics="${esc(e.id)}" aria-label="הוסף ליומן: ${esc(e.title)}">📅 ליומן</button>
            <a class="btn ghost" href="${esc(wazeUrl(e))}" target="_blank" rel="noopener" aria-label="ניווט ב-Waze אל ${esc(e.location)}">🚗 Waze</a>
          </div>
        </article></li>`;
    }).join('');
  }

  /* ---------- Annual ---------- */
  function seasonRange() {
    // Season runs September–August; pick the one containing today.
    const now = new Date();
    const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return Array.from({ length: 12 }, (_, i) => new Date(startYear, 8 + i, 1));
  }

  function renderLegend() {
    $('#legend').innerHTML = Object.values(state.types)
      .map((t) => `<span style="--c:${esc(t.color)}"><span class="dot"></span>${esc(t.label)}</span>`).join('');
  }

  function eventsIn(y, m) {
    return state.events.filter((e) => { const d = parseDate(e.date); return d.getFullYear() === y && d.getMonth() === m; });
  }

  function renderYear() {
    const now = new Date();
    $('#yearView').innerHTML = seasonRange().map((m) => {
      const evs = eventsIn(m.getFullYear(), m.getMonth());
      const past = new Date(m.getFullYear(), m.getMonth() + 1, 0) < startOfDay(now);
      return `<section class="month-card${past ? ' past' : ''}" aria-label="${MONTHS[m.getMonth()]} ${m.getFullYear()}">
        <h2>${MONTHS[m.getMonth()]} <small>${m.getFullYear()} · ${evs.length} אירועים</small></h2>
        ${evs.length ? `<ul>${evs.map((e) => {
          const t = typeOf(e);
          return `<li><button type="button" data-open="${esc(e.id)}" style="--c:${esc(t.color)}">
            <strong>${parseDate(e.date).getDate()}</strong><span class="dot"></span><span>${esc(e.title)}<span class="sr-only"> (${esc(t.label)})</span></span></button></li>`;
        }).join('')}</ul>` : '<p class="none">אין אירועים</p>'}
      </section>`;
    }).join('');
  }

  function renderMonth() {
    const c = state.monthCursor;
    const y = c.getFullYear(), m = c.getMonth();
    $('#monthLabel').textContent = `${MONTHS[m]} ${y}`;
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    const today = startOfDay(new Date()).getTime();
    let html = `<caption class="sr-only">לוח אירועים ל${MONTHS[m]} ${y}</caption><thead><tr>${DAYS.map((d, i) => `<th scope="col" abbr="${d}">${DAYS_SHORT[i]}</th>`).join('')}</tr></thead><tbody>`;
    const weeks = Math.ceil((first.getDay() + new Date(y, m + 1, 0).getDate()) / 7);
    for (let w = 0; w < weeks; w++) {
      html += '<tr>';
      for (let i = 0; i < 7; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const evs = state.events.filter((e) => e.date === iso);
        const cls = [d.getMonth() !== m && 'out', d.getTime() === today && 'today'].filter(Boolean).join(' ');
        html += `<td class="${cls}"${d.getTime() === today ? ' aria-current="date"' : ''}><span class="num">${d.getDate()}</span>${evs.map((e) => `<button type="button" data-open="${esc(e.id)}" style="--c:${esc(typeOf(e).color)}" title="${esc(e.title)}">${esc(e.title)}</button>`).join('')}</td>`;
      }
      html += '</tr>';
    }
    $('#monthTable').innerHTML = html + '</tbody>';
  }

  function initAnnual() {
    renderLegend();
    renderYear();
    const now = new Date();
    state.monthCursor = new Date(now.getFullYear(), now.getMonth(), 1);
    renderMonth();
    $$('.seg button').forEach((b) => b.addEventListener('click', () => {
      state.annualMode = b.dataset.mode;
      $$('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#yearView').hidden = state.annualMode !== 'year';
      $('#monthView').hidden = state.annualMode !== 'month';
    }));
    const shift = (n) => { state.monthCursor = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth() + n, 1); renderMonth(); };
    $('#prevMonth').addEventListener('click', () => shift(-1));
    $('#nextMonth').addEventListener('click', () => shift(1));
    $('#downloadIcs').addEventListener('click', (e) => { e.preventDefault(); downloadIcs(upcoming(), 'nivut-season.ics'); });
  }

  /* ---------- Forum ---------- */
  function relTime(iso) {
    const diff = (Date.now() - new Date(iso)) / 1000;
    const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });
    if (diff < 3600) return rtf.format(-Math.max(1, Math.round(diff / 60)), 'minute');
    if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
    return rtf.format(-Math.round(diff / 86400), 'day');
  }

  function renderForum() {
    const f = state.forum;
    if (!f) { $('#topicList').innerHTML = '<li class="empty">לא ניתן לטעון את הפורום.</li>'; return; }
    const cats = Object.fromEntries(f.categories.map((c) => [c.id, c.label]));
    const topics = f.topics
      .filter((t) => !state.forumCat || t.category === state.forumCat)
      .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
    $('#topicList').innerHTML = topics.length ? topics.map((t) => {
      const ev = t.eventId && state.events.find((e) => e.id === t.eventId);
      return `<li class="topic">
        <div>
          <span class="cat">${esc(cats[t.category] || t.category)}</span>
          <h2><a href="${esc(t.url || state.config.links.forum)}" target="_blank" rel="noopener">${esc(t.title)}</a></h2>
          <p class="meta"><span>${esc(t.author)}</span><span>פעילות אחרונה ${relTime(t.lastActivity)}</span>
          ${ev ? `<span>קשור ל: <button type="button" class="chip" data-open="${esc(ev.id)}">${esc(ev.title)}</button></span>` : ''}</p>
        </div>
        <div class="replies"><strong>${Number(t.replies) || 0}</strong><span>תגובות</span></div>
      </li>`;
    }).join('') : '<li class="empty">אין נושאים בקטגוריה זו.</li>';
  }

  function initForum() {
    $('#forumLink').href = state.config.links.forum;
    if (!state.forum) { renderForum(); return; }
    const wrap = $('#forumChips');
    const all = [{ id: '', label: 'הכל' }, ...state.forum.categories];
    wrap.innerHTML = all.map((c) => `<button type="button" class="chip" data-cat="${esc(c.id)}" aria-pressed="${c.id === ''}">${esc(c.label)}</button>`).join('');
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      state.forumCat = b.dataset.cat;
      $$('[data-cat]', wrap).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderForum();
    });
    renderForum();
  }

  /* ---------- Boot ---------- */
  async function loadJson(path) {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }

  async function boot() {
    initPrefs();
    window.addEventListener('hashchange', route);
    route();
    try {
      const [config, ev, forum] = await Promise.all([
        loadJson('data/config.json'), loadJson('data/events.json'), loadJson('data/forum.json').catch(() => null),
      ]);
      state.config = config;
      state.types = ev.types;
      state.events = ev.events.slice().sort((a, b) => evDate(a) - evDate(b));
      state.forum = forum;
    } catch (err) {
      $('#eventList').innerHTML = `<li class="empty">שגיאה בטעינת הנתונים. <a href="https://nivut.org.il/calendar.aspx">ללוח האירועים באתר האיגוד</a></li>`;
      console.error(err);
      return;
    }
    const L = state.config.links;
    $('#sampleBanner').hidden = !state.config.sampleData;
    $('#sourceLink').href = L.calendar;
    $('#footSource').href = state.config.sourceSite;
    const footer = [['לוח אירועים רשמי', L.calendar], ['מפות ניווט', L.maps], ['ליגת בתי ספר', L.school], ['הנהלת האיגוד', L.council], ['English', L.english], ['צור קשר', L.contact]];
    $('#footerLinks').innerHTML = footer.map(([t, h]) => `<li><a href="${esc(h)}" rel="noopener">${esc(t)}</a></li>`).join('');

    renderNext();
    renderFilters();
    renderList();
    initAnnual();
    initForum();
  }

  boot();
})();
