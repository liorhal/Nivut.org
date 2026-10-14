(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Escapes text, then turns bare URLs into links.
  const linkify = (t) => esc(t).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

  const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const DAYS_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  const parseDate = (d, t = '00:00') => {
    const [y, m, day] = d.slice(0, 10).split('-').map(Number);
    const [hh, mm] = (t || d.slice(11, 16) || '00:00').split(':').map(Number);
    return new Date(y, m - 1, day, hh || 0, mm || 0);
  };
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 864e5);
  const fmtLong = (d) => `יום ${DAYS[d.getDay()]}, ${d.getDate()} ב${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const fmtShort = (d) => `${d.getDate()}.${d.getMonth() + 1}`;
  const inDays = (n) => (n === 0 ? 'היום' : n === 1 ? 'מחר' : `בעוד ${n} ימים`);

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  // The site's own disciplines (icons on nivut.org.il) set an event's color.
  const DISCIPLINES = {
    foot: { label: 'ניווט רגלי', color: '#15803d', icon: '🏃' },
    mtbo: { label: 'ניווט רכוב', color: '#1d6fd8', icon: '🚵' },
    ammi: { label: 'ניווט עממי', color: '#c2410c', icon: '👨‍👩‍👧' },
  };
  // Tags are inferred from the event title and type.
  const TAGS = {
    champ: 'אליפות', league: 'ליגה', sprint: 'ספרינט', training: 'אימון / מודל',
    night: 'לילה', rogaine: 'רוגיין', school: 'בתי ספר', relay: 'שליחים',
  };

  const state = {
    links: {}, events: [], forum: null, news: null, meta: null,
    filter: { q: '', club: '', disciplines: new Set(), tags: new Set() },
    forumQ: '', annualMode: 'year', monthCursor: null,
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
  const VIEWS = ['upcoming', 'annual', 'forum', 'event'];
  function route() {
    const [name, ...rest] = location.hash.slice(1).split('/');
    const param = decodeURIComponent(rest.join('/'));
    const view = VIEWS.includes(name) ? name : 'upcoming';
    VIEWS.forEach((v) => { $(`#view-${v}`).hidden = v !== view; });
    $$('.tabs a').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.view === view)));
    const titles = { upcoming: 'ניווטים קרובים', annual: 'תוכנית שנתית', forum: 'פורום', event: 'אירוע' };
    document.title = `${titles[view]} – ניווט ישראל`;
    if (view !== 'event') state.lastView = view;
    window.scrollTo(0, 0);
    if (view === 'event') { showEvent(param); return; }
    if (view === 'forum' && param) { openThread(param); return; }
    if (name) $('#main').focus({ preventScroll: true });
  }

  /* ---------- Shared bits ---------- */
  const disc = (e) => DISCIPLINES[e.disciplines?.[0]] || { label: 'ניווט', color: '#64748b', icon: '🧭' };
  const evDate = (e) => parseDate(e.date, e.time);
  const discBadges = (e) => (e.disciplines || []).map((k) => DISCIPLINES[k])
    .filter(Boolean).map((d) => `<span class="tag" style="--c:${d.color}"><span class="dot"></span>${esc(d.label)}</span>`).join('');
  const tagBadges = (e) => (e.tags || []).map((t) => (TAGS[t] ? `<span class="pill">${esc(TAGS[t])}</span>` : '')).join('');

  function mapsUrl(e) {
    const d = e.details;
    const q = d?.lat && d?.lng ? `${d.lat},${d.lng}` : e.location;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  function wazeUrl(e) {
    const ll = e.details?.wazeLL;
    return ll ? `https://waze.com/ul?ll=${encodeURIComponent(ll)}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(e.location)}&navigate=yes`;
  }
  const canNavigate = (e) => !!(e.details?.wazeLL || e.location);

  function icsFor(events) {
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const clean = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const now = new Date();
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//nivut-wrapper//HE', 'CALSCALE:GREGORIAN'];
    events.forEach((e) => {
      const s = evDate(e);
      const when = e.time
        ? [`DTSTART;TZID=Asia/Jerusalem:${stamp(s)}`, `DTEND;TZID=Asia/Jerusalem:${stamp(new Date(s.getTime() + 4 * 3600e3))}`]
        : [`DTSTART;VALUE=DATE:${stamp(s).slice(0, 8)}`, `DTEND;VALUE=DATE:${stamp(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1)).slice(0, 8)}`];
      const d = e.details;
      lines.push('BEGIN:VEVENT', `UID:${e.id}@nivut-wrapper`, `DTSTAMP:${stamp(now)}`, ...when,
        `SUMMARY:${clean(e.title)}`, `LOCATION:${clean(e.location)}`, `URL:${clean(e.url)}`,
        ...(d?.lat && d?.lng ? [`GEO:${d.lat};${d.lng}`] : []),
        `DESCRIPTION:${clean([disc(e).label, e.eventType, e.clubName, e.url].filter(Boolean).join(' · '))}`, 'END:VEVENT');
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

  /* ---------- Event page (#event/<id>) ---------- */
  const toMin = (t) => { const m = /(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const shekel = (s) => { const m = /(\d+(?:\.\d+)?)\s*(?:שח|ש"ח|₪)/.exec(s || ''); return m ? m[1] : null; };
  const phoneLink = (s) => esc(s).replace(/(0\d{1,2}-?\d{3}-?\d{4}|05\d-?\d{7})/g, (p) => `<a href="tel:${p.replace(/-/g, '')}">${p}</a>`);

  function countdownParts(ms) {
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
    return [[d, d === 1 ? 'יום' : 'ימים'], [h, 'שעות'], [m, 'דקות']];
  }
  function spokenCountdown(ms) {
    const [[d], [h]] = countdownParts(ms);
    if (d > 0) return `${d} ${d === 1 ? 'יום' : 'ימים'}${h ? ` ו-${h} שעות` : ''}`;
    if (h > 0) return `${h} שעות`;
    return `${Math.max(1, Math.floor(ms / 6e4))} דקות`;
  }

  /** Registration state, the single most important fact on the page. */
  function registration(e) {
    const d = e.details || {};
    const now = new Date();
    const end = evDate(e);
    if (daysBetween(now, end) < 0) {
      return { state: 'past', title: 'האירוע התקיים', text: d.resultsAvailable ? 'התוצאות פורסמו באתר האיגוד.' : 'התוצאות יפורסמו באתר האיגוד.', cta: d.resultsAvailable ? 'לתוצאות' : 'לדף האירוע' };
    }
    if (e.source === 'closed-area') {
      return { state: 'soon', title: 'ההרשמה טרם נפתחה', text: 'השטח סגור לנווטים עד יום התחרות. פרטים והרשמה יפורסמו באתר האיגוד.', cta: 'ללוח האירועים' };
    }
    if (d.registrationDeadline) {
      const dl = parseDate(d.registrationDeadline);
      if (dl > now) {
        return { state: 'open', title: 'ההרשמה המוקדמת פתוחה', deadline: dl, ms: dl - now,
          text: `נסגרת ${fmtLong(dl)}${d.registrationDeadline.length > 10 ? ` בשעה ${d.registrationDeadline.slice(11, 16)}` : ''}`, cta: 'להרשמה באתר האיגוד' };
      }
      return { state: d.onsite ? 'onsite' : 'closed', title: 'ההרשמה המוקדמת נסגרה', text: d.onsite ? `עדיין אפשר: ${d.onsite}` : 'אפשר לבדוק באתר האיגוד אם נותרו מקומות.', cta: 'לדף האירוע' };
    }
    return { state: 'open', title: 'הרשמה באתר האיגוד', text: d.onsite || '', cta: 'להרשמה באתר האיגוד' };
  }

  function timelineHtml(d, e) {
    const s = toMin(d.startFrom), t = toMin(d.startTo), c = toMin(d.cutoff);
    if (s === null) return '';
    const lo = s - 30, hi = Math.max(c ?? 0, t ?? 0, s) + 30;
    const pos = (n) => `${(((n - lo) / (hi - lo)) * 100).toFixed(1)}%`;
    const points = [
      { at: s, label: 'זינוק ראשון', cls: 'start' },
      t !== null && { at: t, label: 'זינוק אחרון', cls: 'start' },
      c !== null && { at: c, label: 'שעת גג', cls: 'cutoff' },
    ].filter(Boolean);
    const now = new Date();
    const isToday = daysBetween(now, evDate(e)) === 0;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return `<section class="ev-card ev-span" aria-labelledby="tl-h">
      <h2 id="tl-h">יום התחרות</h2>
      <div class="tl">
        <div class="tl-track" aria-hidden="true">
          ${t !== null ? `<div class="tl-window" style="inset-inline-start:${pos(s)};width:calc(${pos(t)} - ${pos(s)})"></div>` : ''}
          ${c !== null ? `<div class="tl-run" style="inset-inline-start:${pos(t ?? s)};width:calc(${pos(c)} - ${pos(t ?? s)})"></div>` : ''}
          ${isToday && nowMin > lo && nowMin < hi ? `<div class="tl-now" style="inset-inline-start:${pos(nowMin)}"><span>עכשיו</span></div>` : ''}
        </div>
        <ol class="tl-points">${points.map((p) => `<li class="${p.cls}" style="--pos:${pos(p.at)}"><time>${fromMin(p.at)}</time><span>${p.label}</span></li>`).join('')}</ol>
      </div>
      <ul class="tl-legend">
        ${t !== null ? `<li><span class="sw start"></span><span>חלון הזינוקים: אפשר לצאת לדרך בכל רגע בין ${fromMin(s)} ל-${fromMin(t)}</span></li>` : ''}
        ${c !== null && t !== null ? `<li><span class="sw run"></span><span>מהזינוק האחרון ועד שעת הגג: הזמן שנותר לנווטים האחרונים בשטח</span></li>` : ''}
        ${c !== null ? `<li><span class="sw cutoff"></span><span><strong>שעת גג ${fromMin(c)}:</strong> כל המשתתפים חייבים לחזור לנקודת הסיום עד השעה הזו, גם אם לא סיימו את המסלול</span></li>` : ''}
      </ul>
    </section>`;
  }

  function coursesHtml(courses) {
    if (!courses?.length) return '';
    const parsed = courses.map((c) => {
      const level = +(/רמה\s*(\d+)/.exec(c.name)?.[1] || 0);
      const km = parseFloat((c.distance || '').replace(',', '.')) || null;
      return { name: c.name.replace(/\s*\(רמה\s*\d+\)\s*/, '').trim(), level, km };
    });
    const maxKm = Math.max(...parsed.map((c) => c.km || 0), 1);
    const maxLevel = Math.max(5, ...parsed.map((c) => c.level));
    const beginner = (c) => (c.level && c.level <= 2) || /קצרצר|משפחות|עממי|מתחילים/.test(c.name);
    return `<section class="ev-card ev-span" aria-labelledby="co-h">
      <h2 id="co-h">בחרו מסלול <span class="muted">${parsed.length} מסלולים</span></h2>
      <ul class="courses-viz">${parsed.map((c) => `<li class="${beginner(c) ? 'easy' : ''}">
        <div class="cv-name"><strong>${esc(c.name)}</strong>${beginner(c) ? '<span class="pill easy-pill">מתאים למתחילים</span>' : ''}</div>
        <div class="cv-level" ${c.level ? `aria-label="רמת קושי ${c.level} מתוך ${maxLevel}"` : ''}>${c.level ? Array.from({ length: maxLevel }, (_, i) => `<span class="${i < c.level ? 'on' : ''}"></span>`).join('') : '<span class="muted small">—</span>'}</div>
        <div class="cv-bar" aria-hidden="true"><span style="width:${c.km ? Math.max(6, (c.km / maxKm) * 100) : 4}%"></span></div>
        <div class="cv-km">${c.km ? `${c.km} ק"מ` : '<span class="muted">קצר מאוד</span>'}</div>
      </li>`).join('')}</ul>
      <p class="muted small">הקושי מדורג לפי רמות האיגוד: רמה נמוכה = ניווט על שבילים וקווים ברורים, רמה גבוהה = ניווט בשטח פתוח ובחירת מסלול עצמאית.</p>
    </section>`;
  }

  // Generic words that would link unrelated threads (a thread needs a shared place or name).
  const RELATED_STOP = new Set(['ניווט', 'ניווטי', 'נווט', 'אליפות', 'ישראל', 'יער', 'ביער', 'ליגה', 'ליגת', 'ליגה', 'מסלול', 'מסלולים',
    'קטגוריות', 'כמו', 'רגלי', 'רכוב', 'עממי', 'אימון', 'מודל', 'ספרינט', 'היום', 'תחרות', 'אירוע', 'ארוע', 'אירועי', 'ארועי', '2026', '2027',
    'יום', 'ביום', 'שבת', 'בשבת', 'שישי', 'בשישי', 'הקרובה', 'הקרוב', 'מזנקת', 'מזנק']);

  function relatedThreads(e) {
    const threads = state.forum?.threads;
    if (!threads?.length) return [];
    const words = (s) => new Set(String(s).split(/[\s\-–,|:()"'.]+/).map((w) => w.replace(/^[בהלמו](?=\S{3,})/, '')).filter((w) => w.length > 2 && !RELATED_STOP.has(w)));
    const ew = words(`${e.title} ${e.location} ${e.details?.name || ''}`);
    return threads.map((t) => ({ t, score: [...words(t.title)].filter((w) => ew.has(w)).length }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score || (b.t.lastActivity > a.t.lastActivity ? 1 : -1)).slice(0, 4).map((x) => x.t);
  }

  function eventPageHtml(e) {
    const d = e.details || {};
    const date = evDate(e);
    const now = new Date();
    const left = daysBetween(now, date);
    const reg = registration(e);
    const dc = disc(e);
    const price = shekel(d.price), priceOut = shekel(d.priceNonMember);
    const loading = !e.details && e.nivutId;
    const threads = relatedThreads(e);
    const hasGeo = d.lat && d.lng;
    const bbox = hasGeo ? [d.lng - 0.03, d.lat - 0.018, d.lng + 0.03, d.lat + 0.018].map((n) => n.toFixed(5)).join(',') : '';

    return `
    <header class="ev-hero" style="--c:${dc.color}">
      <div class="container">
        <a class="ev-back" href="#${esc(state.lastView || 'upcoming')}">→ חזרה</a>
        <div class="ev-hero-grid">
          <div class="ev-date" aria-hidden="true">
            <span class="dow">יום ${DAYS[date.getDay()]}</span>
            <span class="day">${date.getDate()}</span>
            <span class="mon">${MONTHS[date.getMonth()]} ${date.getFullYear()}</span>
          </div>
          <div class="ev-head">
            <div class="badges">${discBadges(e)}${tagBadges(e)}</div>
            <h1 id="evTitle" tabindex="-1">${esc(e.title)}</h1>
            ${d.eventType || d.note ? `<p class="ev-sub">${[d.eventType, d.note].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
            <p class="sr-only">${fmtLong(date)}${e.location ? `, ${esc(e.location)}` : ''}</p>
          </div>
          <div class="ev-count" ${left >= 0 ? 'role="timer"' : ''} aria-label="${left < 0 ? 'האירוע התקיים' : left === 0 ? 'האירוע היום' : `האירוע בעוד ${spokenCountdown(date - now)}`}">
            ${left < 0 ? '<span class="ev-count-big">✓</span><span>התקיים</span>'
              : left === 0 ? '<span class="ev-count-big">היום!</span>'
              : `<span class="ev-count-big">${left}</span><span>${left === 1 ? 'יום' : 'ימים'} לזינוק</span>`}
          </div>
        </div>
      </div>
      <svg class="ev-contours" viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.2">
        <path d="M-20 160 C60 120 120 180 200 140 S340 90 420 130"/><path d="M-20 130 C70 90 130 150 210 110 S330 60 420 100"/>
        <path d="M-20 100 C80 60 140 120 220 80 S320 30 420 70"/><path d="M-20 70 C90 30 150 90 230 50 S310 0 420 40"/></g></svg>
    </header>

    <div class="container ev-body">
      <ul class="ev-facts" aria-label="עיקרי האירוע">
        <li><span class="ev-ico" aria-hidden="true">🕘</span><span class="k">מתי</span>
          <strong>${d.startFrom ? `${esc(d.startFrom)}${d.startTo ? `–${esc(d.startTo)}` : ''}` : fmtShort(date)}</strong>
          <span>${d.startFrom ? 'חלון זינוקים · ' : ''}${DAYS[date.getDay()]} ${date.getDate()}.${date.getMonth() + 1}</span></li>
        <li><span class="ev-ico" aria-hidden="true">📍</span><span class="k">איפה</span>
          <strong>${esc(e.location || d.name || 'יפורסם')}</strong>
          ${canNavigate(e) ? `<a href="${esc(wazeUrl(e))}" target="_blank" rel="noopener">ניווט לכינוס ב-Waze</a>` : '<span>&nbsp;</span>'}</li>
        <li><span class="ev-ico" aria-hidden="true">₪</span><span class="k">כמה</span>
          <strong class="${price || d.price ? '' : 'tbd'}">${price ? `${price} ₪` : d.price ? esc(d.price) : 'יפורסם'}</strong>
          <span>${price ? `לחברי איגוד${priceOut ? ` · ${priceOut} ₪ לחיצוניים` : ''}` : '&nbsp;'}</span></li>
        <li class="reg-${reg.state}"><span class="ev-ico" aria-hidden="true">${reg.state === 'open' ? '✍️' : reg.state === 'past' ? '🏁' : '⏳'}</span><span class="k">הרשמה</span>
          <strong>${reg.state === 'open' && reg.ms ? `נסגרת בעוד ${spokenCountdown(reg.ms)}` : esc(reg.title)}</strong>
          <span>${reg.state === 'open' && reg.ms ? 'הרשמה מוקדמת' : '&nbsp;'}</span></li>
      </ul>

      <div class="ev-grid">
        <div class="ev-main">
          ${loading ? '<section class="ev-card" role="status"><p class="muted">טוען את פרטי התחרות מאתר האיגוד…</p></section>' : ''}
          ${timelineHtml(d, e)}
          ${coursesHtml(d.courses)}
          ${d.description?.length || e.summary ? `<section class="ev-card" aria-labelledby="ab-h"><h2 id="ab-h">על האירוע</h2>
            ${(d.description?.length ? d.description : [e.summary]).map((p) => `<p>${linkify(p)}</p>`).join('')}</section>` : ''}
          ${hasGeo || d.directions?.length ? `<section class="ev-card" aria-labelledby="go-h"><h2 id="go-h">איך מגיעים</h2>
            ${hasGeo ? `<iframe class="ev-osm" title="מפת נקודת הכינוס של ${esc(e.title)}" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${d.lat},${d.lng}"></iframe>` : ''}
            ${(d.directions || []).map((p) => `<p>${linkify(p)}</p>`).join('')}
            <div class="ev-actions">${canNavigate(e) ? `<a class="btn" href="${esc(wazeUrl(e))}" target="_blank" rel="noopener">🚗 Waze</a><a class="btn ghost" href="${esc(mapsUrl(e))}" target="_blank" rel="noopener">Google Maps</a>` : ''}</div>
          </section>` : ''}
        </div>

        <aside class="ev-side" aria-label="הרשמה ופרטים נוספים">
          <section class="ev-card ev-reg reg-${reg.state}" aria-labelledby="rg-h">
            <h2 id="rg-h">${esc(reg.title)}</h2>
            ${reg.ms ? `<div class="reg-count" role="timer" aria-label="ההרשמה המוקדמת נסגרת בעוד ${spokenCountdown(reg.ms)}">${countdownParts(reg.ms).map(([n, l]) => `<div><strong>${n}</strong><span>${l}</span></div>`).join('')}</div>` : ''}
            ${reg.text ? `<p>${esc(reg.text)}</p>` : ''}
            ${d.onsite && reg.state === 'open' ? `<p class="muted small">הרשמה במקום: ${esc(d.onsite)}</p>` : ''}
            <a class="btn btn-xl" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(reg.cta)} ↗</a>
            <div class="ev-actions">
              <button type="button" class="btn ghost" data-ics="${esc(e.id)}">📅 ליומן</button>
              <button type="button" class="btn ghost" data-share="${esc(e.id)}">🔗 שיתוף</button>
            </div>
          </section>

          ${d.map ? `<section class="ev-card" aria-labelledby="mp-h"><h2 id="mp-h">מפת הניווט</h2>
            ${d.map.image ? `<a class="ev-mapimg" href="${esc(d.map.image)}" target="_blank" rel="noopener"><img src="${esc(d.map.image)}" alt="תצוגה מקדימה של מפת ${esc(d.map.name)}" loading="lazy" onerror="this.parentNode.remove()"></a>` : ''}
            <p><strong>${d.map.url ? `<a href="${esc(d.map.url)}" target="_blank" rel="noopener">${esc(d.map.name)}</a>` : esc(d.map.name)}</strong></p>
            <ul class="chips-static">${[d.map.terrain && `שטח ${d.map.terrain}`, d.map.scale && `קנ"מ ${d.map.scale}`, d.map.year && `מופה ${d.map.year}`].filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          </section>` : ''}

          ${d.club || d.planner || d.director || d.contact ? `<section class="ev-card" aria-labelledby="pp-h"><h2 id="pp-h">מי מארגן</h2><dl class="ev-people">
            ${d.club ? `<dt>מועדון</dt><dd>${d.club.url ? `<a href="${esc(d.club.url)}" target="_blank" rel="noopener">${esc(d.club.name)}</a>` : esc(d.club.name)}</dd>` : ''}
            ${d.director ? `<dt>ניהול</dt><dd>${esc(d.director)}</dd>` : ''}
            ${d.planner ? `<dt>תכנון מסלולים</dt><dd>${esc(d.planner)}</dd>` : ''}
            ${d.contact ? `<dt>יצירת קשר</dt><dd>${phoneLink(d.contact)}</dd>` : ''}
          </dl></section>` : ''}

          ${d.attachments?.length ? `<section class="ev-card" aria-labelledby="fl-h"><h2 id="fl-h">קבצים</h2><ul class="ev-files">
            ${d.attachments.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a></li>`).join('')}</ul></section>` : ''}

          ${threads.length ? `<section class="ev-card" aria-labelledby="fr-h"><h2 id="fr-h">מדברים על זה בפורום</h2><ul class="ev-threads">
            ${threads.map((t) => `<li><a href="#forum/${esc(t.id)}">${esc(t.title)}</a><span class="muted small">${esc(t.author)} · ${t.replyCount} תגובות · ${relTime(t.lastActivity)}</span></li>`).join('')}</ul></section>` : ''}
        </aside>
      </div>
    </div>

    <nav class="ev-dock" aria-label="פעולות מהירות">
      <a class="dock-main" href="${esc(e.url)}" target="_blank" rel="noopener">${reg.state === 'open' ? 'להרשמה' : 'לאתר האיגוד'}</a>
      ${canNavigate(e) ? `<a href="${esc(wazeUrl(e))}" target="_blank" rel="noopener" aria-label="ניווט ב-Waze">🚗</a>` : ''}
      <button type="button" data-ics="${esc(e.id)}" aria-label="הוסף ליומן">📅</button>
      <button type="button" data-share="${esc(e.id)}" aria-label="שיתוף">🔗</button>
    </nav>`;
  }

  async function showEvent(id) {
    const box = $('#eventPage');
    const e = state.events.find((x) => x.id === id);
    if (!e) {
      box.innerHTML = state.events.length
        ? '<div class="container"><p class="empty">האירוע לא נמצא. <a href="#upcoming">לכל האירועים</a></p></div>'
        : '<div class="container"><p class="muted" role="status">טוען…</p></div>';
      return;
    }
    document.title = `${e.title} – ניווט ישראל`;
    box.innerHTML = eventPageHtml(e);
    $('#evTitle')?.focus({ preventScroll: true });
    if (!e.details && e.nivutId) {
      try {
        e.details = await loadJson(`api/event?id=${encodeURIComponent(e.nivutId)}`);
        if (e.details.startFrom && !e.time) e.time = e.details.startFrom;
      } catch { e.details = null; e.nivutId = null; }
      if (location.hash === `#event/${id}`) box.innerHTML = eventPageHtml(e);
    }
  }

  async function shareEvent(e) {
    const url = `${location.origin}${location.pathname}#event/${encodeURIComponent(e.id)}`;
    const text = `${e.title} · ${fmtLong(evDate(e))}`;
    try {
      if (navigator.share) { await navigator.share({ title: e.title, text, url }); return; }
      await navigator.clipboard.writeText(url);
      toast('הקישור הועתק');
    } catch { /* cancelled */ }
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2500);
  }

  document.addEventListener('click', (ev) => {
    const openBtn = ev.target.closest('[data-open]');
    if (openBtn) { location.hash = `event/${encodeURIComponent(openBtn.dataset.open)}`; return; }
    const icsBtn = ev.target.closest('[data-ics]');
    if (icsBtn) {
      const e = state.events.find((x) => x.id === icsBtn.dataset.ics);
      if (e) { downloadIcs([e], `${e.date}-${e.id}.ics`); toast('קובץ היומן ירד'); }
      return;
    }
    const shareBtn = ev.target.closest('[data-share]');
    if (shareBtn) {
      const e = state.events.find((x) => x.id === shareBtn.dataset.share);
      if (e) shareEvent(e);
    }
  });

  /* ---------- Upcoming ---------- */
  function upcoming() {
    const today = startOfDay(new Date());
    return state.events.filter((e) => parseDate(e.date) >= today);
  }

  function renderNext() {
    const next = upcoming().find((e) => e.source !== 'closed-area') || upcoming()[0];
    const box = $('#nextEvent');
    if (!next) { box.innerHTML = '<p>אין אירועים מתוכננים כרגע.</p>'; return; }
    const d = evDate(next);
    box.innerHTML = `
      <div style="flex:1 1 260px">
        <h2>${esc(next.title)}</h2>
        <p>${fmtLong(d)}${next.time ? `, ${esc(next.time)}` : ''}${next.location ? ` · ${esc(next.location)}` : ''}</p>
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

  function chipGroup(container, entries, set) {
    container.hidden = entries.length < 2;
    entries.forEach(([key, label, color]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip';
      b.setAttribute('aria-pressed', 'false');
      if (color) b.style.setProperty('--c', color);
      b.innerHTML = `${color ? '<span class="dot"></span>' : ''}${esc(label)}`;
      b.addEventListener('click', () => {
        const on = !set.has(key);
        on ? set.add(key) : set.delete(key);
        b.setAttribute('aria-pressed', String(on));
        renderList();
      });
      container.append(b);
    });
  }

  function renderFilters() {
    const evs = upcoming();
    const discs = new Set(evs.flatMap((e) => e.disciplines || []));
    const tags = new Set(evs.flatMap((e) => e.tags || []));
    chipGroup($('#discChips'), Object.entries(DISCIPLINES).filter(([k]) => discs.has(k)).map(([k, d]) => [k, d.label, d.color]), state.filter.disciplines);
    chipGroup($('#tagChips'), Object.entries(TAGS).filter(([k]) => tags.has(k)).map(([k, l]) => [k, l]), state.filter.tags);
    const clubs = [...new Set(evs.map((e) => e.clubName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
    $('#clubField').hidden = clubs.length < 2;
    $('#club').insertAdjacentHTML('beforeend', clubs.map((r) => `<option>${esc(r)}</option>`).join(''));
    $('#q').addEventListener('input', (e) => { state.filter.q = e.target.value.trim(); renderList(); });
    $('#club').addEventListener('change', (e) => { state.filter.club = e.target.value; renderList(); });
  }

  function eventCard(e, now) {
    const d = evDate(e);
    const left = daysBetween(now, d);
    const det = e.details;
    const dl = det?.registrationDeadline ? daysBetween(now, parseDate(det.registrationDeadline)) : null;
    const when = det?.startFrom ? `זינוקים ${esc(det.startFrom)}${det.startTo ? `–${esc(det.startTo)}` : ''}` : '';
    const closed = e.source === 'closed-area';
    return `<li>
      <article class="event-card${closed ? ' compact' : ''}" style="--c:${disc(e).color}" aria-labelledby="t-${esc(e.id)}">
        <div class="date-badge" aria-hidden="true"><span class="d">${d.getDate()}</span><span class="m">${MONTHS[d.getMonth()]}</span><span class="w">יום ${DAYS_SHORT[d.getDay()]}</span></div>
        <div class="card-main">
          <div class="badges">${discBadges(e)}${tagBadges(e)}${left <= 7 ? `<span class="soon">${inDays(left)}</span>` : ''}</div>
          <h3 id="t-${esc(e.id)}"><button type="button" data-open="${esc(e.id)}">${esc(e.title)}</button></h3>
          <ul class="meta">
            <li><span class="sr-only">מועד: </span>${fmtLong(d)}</li>
            ${when ? `<li>⏱ ${when}</li>` : ''}
            ${e.location && e.location !== e.title ? `<li>📍 ${esc(e.location)}</li>` : ''}
            ${e.clubName ? `<li>מועדון ${esc(e.clubName)}</li>` : ''}
            ${dl !== null && dl >= 0 ? `<li><strong class="deadline">הרשמה מוקדמת נסגרת ${inDays(dl)}</strong></li>` : ''}
            ${closed ? '<li class="muted">שטח סגור לקראת תחרות · פרטים בקרוב</li>' : ''}
          </ul>
          ${e.summary ? `<p class="summary">${esc(e.summary)}</p>` : ''}
        </div>
        ${e.image ? `<img class="thumb" src="${esc(e.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
        <div class="card-actions">
          <button type="button" class="btn ghost" data-ics="${esc(e.id)}" aria-label="הוסף ליומן: ${esc(e.title)}">📅 ליומן</button>
          ${canNavigate(e) ? `<a class="btn ghost" href="${esc(wazeUrl(e))}" target="_blank" rel="noopener" aria-label="ניווט ב-Waze אל ${esc(e.location || e.title)}">🚗 Waze</a>` : ''}
          ${closed ? '' : `<a class="btn ghost" href="${esc(e.url)}" target="_blank" rel="noopener" aria-label="הרשמה ל${esc(e.title)} באתר האיגוד">↗ הרשמה</a>`}
        </div>
      </article></li>`;
  }

  function renderList() {
    const { q, club, disciplines, tags } = state.filter;
    const ql = q.toLowerCase();
    const list = upcoming().filter((e) =>
      (!disciplines.size || (e.disciplines || []).some((k) => disciplines.has(k))) &&
      (!tags.size || (e.tags || []).some((k) => tags.has(k))) &&
      (!club || e.clubName === club) &&
      (!ql || [e.fullTitle, e.title, e.location, e.clubName, e.eventType, e.summary].join(' ').toLowerCase().includes(ql)));
    $('#resultCount').textContent = `${list.length} אירועים קרובים`;
    const el = $('#eventList');
    if (!list.length) { el.innerHTML = '<li class="empty">לא נמצאו אירועים התואמים לסינון.</li>'; return; }
    const now = new Date();
    let lastMonth = '';
    el.innerHTML = list.map((e) => {
      const d = evDate(e);
      const mKey = `${d.getFullYear()}-${d.getMonth()}`;
      const sep = mKey !== lastMonth ? `<li class="month-sep" aria-hidden="true">${MONTHS[d.getMonth()]} ${d.getFullYear()}</li>` : '';
      lastMonth = mKey;
      return sep + eventCard(e, now);
    }).join('');
  }

  function renderNews() {
    const n = state.news;
    const box = $('#newsList');
    if (!n?.news?.length) { $('#newsSection').hidden = true; return; }
    $('#newsSection').hidden = false;
    box.innerHTML = n.news.map((x) => `<li class="news-item">
      <p class="muted">${x.date ? fmtLong(parseDate(x.date)) : ''}${x.category ? ` · ${esc(x.category)}` : ''}</p>
      <h3><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></h3>
      ${x.summary ? `<p>${esc(x.summary)}</p>` : ''}</li>`).join('');
  }

  /* ---------- Annual ---------- */
  function seasonRange() {
    // Season runs September–August; pick the one containing today.
    const now = new Date();
    const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return Array.from({ length: 12 }, (_, i) => new Date(startYear, 8 + i, 1));
  }

  function renderLegend() {
    $('#legend').innerHTML = Object.values(DISCIPLINES)
      .map((t) => `<span style="--c:${t.color}"><span class="dot"></span>${esc(t.label)}</span>`).join('')
      + '<span class="muted">· מסגרת מקווקוות = שטח סגור, פרטים בקרוב</span>';
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
        ${evs.length ? `<ul>${evs.map((e) => `<li><button type="button" data-open="${esc(e.id)}" style="--c:${disc(e).color}" class="${e.source === 'closed-area' ? 'tentative' : ''}">
            <strong>${parseDate(e.date).getDate()}</strong><span class="dot"></span><span>${esc(e.title)}<span class="sr-only"> (${esc(disc(e).label)})</span></span></button></li>`).join('')}</ul>`
          : `<p class="none">${past ? 'אין אירועים' : 'טרם פורסמו אירועים'}</p>`}
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
    const weeks = Math.ceil((first.getDay() + new Date(y, m + 1, 0).getDate()) / 7);
    let html = `<caption class="sr-only">לוח אירועים ל${MONTHS[m]} ${y}</caption><thead><tr>${DAYS.map((d, i) => `<th scope="col" abbr="${d}">${DAYS_SHORT[i]}</th>`).join('')}</tr></thead><tbody>`;
    for (let w = 0; w < weeks; w++) {
      html += '<tr>';
      for (let i = 0; i < 7; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
        const isoD = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const evs = state.events.filter((e) => e.date === isoD);
        const cls = [d.getMonth() !== m && 'out', d.getTime() === today && 'today'].filter(Boolean).join(' ');
        html += `<td class="${cls}"${d.getTime() === today ? ' aria-current="date"' : ''}><span class="num">${d.getDate()}</span>${evs.map((e) => `<button type="button" data-open="${esc(e.id)}" style="--c:${disc(e).color}" class="${e.source === 'closed-area' ? 'tentative' : ''}" title="${esc(e.title)}">${esc(e.title)}</button>`).join('')}</td>`;
      }
      html += '</tr>';
    }
    $('#monthTable').innerHTML = `${html}</tbody>`;
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
  function relTime(isoStr) {
    if (!isoStr) return '';
    const diff = (Date.now() - new Date(isoStr)) / 1000;
    const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });
    if (diff < 3600) return rtf.format(-Math.max(1, Math.round(diff / 60)), 'minute');
    if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
    if (diff < 86400 * 45) return rtf.format(-Math.round(diff / 86400), 'day');
    return rtf.format(-Math.round(diff / (86400 * 30)), 'month');
  }

  // Links a forum thread to an upcoming event whose title or location it mentions.
  function matchEvent(title) {
    const words = (str) => String(str).split(/[\s\-–,|:()"'.]+/).filter((w) => w.length > 2);
    const tw = new Set(words(title));
    let best = null, bestScore = 1;
    upcoming().forEach((e) => {
      const score = new Set(words(`${e.title} ${e.location}`).filter((w) => tw.has(w))).size;
      if (score > bestScore || (score === bestScore && best && e.source !== 'closed-area' && best.source === 'closed-area')) { best = e; bestScore = score; }
    });
    return best;
  }

  const msgBody = (m) => (m.body.length ? m.body.map((p) => `<p>${linkify(p)}</p>`).join('') : '')
    + (m.hasImage ? '<p class="muted">📷 מצורפת תמונה – לצפייה בפורום</p>' : '');

  function renderForum() {
    const f = state.forum;
    if (!f || f.error) {
      $('#topicList').innerHTML = `<li class="empty">לא ניתן לטעון כרגע את הפורום. <a href="${esc(state.links.forum || '#')}" target="_blank" rel="noopener">לפורום באתר האיגוד</a></li>`;
      return;
    }
    const q = state.forumQ.toLowerCase();
    const threads = f.threads.filter((t) => !q || [t.title, t.author, ...t.body, ...t.replies.flatMap((r) => [r.author, ...r.body])].join(' ').toLowerCase().includes(q));
    $('#topicList').innerHTML = threads.length ? threads.map((t) => {
      const ev = matchEvent(t.title);
      return `<li class="topic${t.announcement || t.pinned ? ' featured' : ''}">
        <details id="thread-${esc(t.id)}">
          <summary>
            <div class="topic-head">
              <div class="badges">${t.announcement ? '<span class="pill strong">הכרזה</span>' : ''}${t.pinned ? '<span class="pill">📌 נעוץ</span>' : ''}</div>
              <h2>${esc(t.title)}</h2>
              <p class="meta"><span>${esc(t.author)}</span>${t.lastActivity ? `<span>פעילות אחרונה ${relTime(t.lastActivity)}</span>` : ''}</p>
            </div>
            <div class="replies" aria-label="${t.replyCount} תגובות"><strong>${t.replyCount}</strong><span>תגובות</span></div>
          </summary>
          <div class="thread">
            ${msgBody(t) || '<p class="muted">(הודעה ללא תוכן)</p>'}
            ${ev ? `<p class="related">אירוע קשור: <button type="button" class="chip" data-open="${esc(ev.id)}">${esc(ev.title)} · ${fmtShort(evDate(ev))}</button></p>` : ''}
            ${t.replies.length ? `<ol class="reply-list" aria-label="תגובות">${t.replies.map((r) => `<li>
              <p class="meta"><strong>${esc(r.author)}</strong><span>${relTime(r.postedAt)}</span></p>${msgBody(r) || `<p>${esc(r.title)}</p>`}</li>`).join('')}</ol>` : ''}
            <p><a class="btn ghost" href="${esc(t.url)}" target="_blank" rel="noopener">להגיב בפורום ↗</a></p>
          </div>
        </details>
      </li>`;
    }).join('') : `<li class="empty">${q ? 'לא נמצאו נושאים.' : 'אין נושאים להצגה.'}</li>`;
  }

  function openThread(id) {
    const el = document.getElementById(`thread-${id}`);
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ block: 'start' });
    el.querySelector('summary').focus({ preventScroll: true });
  }

  function initForum() {
    const f = state.forum;
    $('#forumLink').href = f?.source || state.links.forum || '#';
    $('#forumQ').addEventListener('input', (e) => { state.forumQ = e.target.value.trim(); renderForum(); });
    if (f && !f.error) {
      const s = $('#forumStatus');
      s.textContent = `${statusText(f)} · ${f.threads.length} נושאים מהשבוע האחרון`;
      s.classList.toggle('warn', !!f.stale);
    }
    renderForum();
  }

  /* ---------- Boot ---------- */
  async function loadJson(path) {
    const r = await fetch(path, { cache: 'no-cache' });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `${path}: ${r.status}`);
    return body;
  }

  function statusText(d) {
    const t = new Date(d.fetchedAt);
    const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    return d.stale ? `אתר האיגוד לא זמין כרגע – מוצג מידע מ-${hm}` : `מתעדכן ישירות מאתר האיגוד · עודכן ב-${hm}`;
  }

  async function boot() {
    initPrefs();
    window.addEventListener('hashchange', route);
    route();
    const [links, events, forum, news] = await Promise.all([
      loadJson('api/links').catch(() => ({})),
      loadJson('api/events').catch((err) => ({ error: err.message })),
      loadJson('api/forum').catch((err) => ({ error: err.message })),
      loadJson('api/news').catch(() => null),
    ]);
    state.links = links;
    state.forum = forum;
    state.news = news;

    const footer = [['לוח אירועים רשמי', links.calendar], ['תוצאות', links.results], ['מפות ניווט', links.maps], ['ליגת בתי ספר', links.school], ['מדריך למתחילים', links.starter], ['הנהלת האיגוד', links.council], ['English', links.english], ['צור קשר', links.contact]];
    $('#footerLinks').innerHTML = footer.filter(([, h]) => h).map(([t, h]) => `<li><a href="${esc(h)}" rel="noopener">${esc(t)}</a></li>`).join('');
    if (links.home) $('#footSource').href = links.home;
    if (links.calendar) $('#officialCalendar').href = links.calendar;
    renderNews();

    if (events.error || !events.events) {
      const off = esc(links.calendar || 'https://nivut.org.il/calendar.aspx');
      $('#nextEvent').innerHTML = `<p>לא ניתן לקרוא כרגע את האירועים מאתר האיגוד.</p><a class="btn" href="${off}" rel="noopener">ללוח האירועים הרשמי ↗</a>`;
      $('#eventList').innerHTML = `<li class="empty">לא ניתן לטעון את האירועים. <a href="${off}" rel="noopener">ללוח הרשמי</a></li>`;
      $('#filters').hidden = true;
      $('#yearView').innerHTML = '';
      initForum();
      if (location.hash.startsWith('#event/')) {
        $('#eventPage').innerHTML = `<div class="container"><p class="empty">לא ניתן לטעון כרגע את האירוע. <a href="${off}" rel="noopener">ללוח הרשמי</a></p></div>`;
      }
      return;
    }
    state.meta = events;
    state.events = events.events.slice().sort((a, b) => evDate(a) - evDate(b));
    const status = $('#liveStatus');
    status.textContent = statusText(events);
    status.classList.toggle('warn', !!events.stale);
    status.hidden = false;

    renderNext();
    renderFilters();
    renderList();
    initAnnual();
    initForum();
    if (/^#(event|forum)\//.test(location.hash)) route();
  }

  boot();
})();
