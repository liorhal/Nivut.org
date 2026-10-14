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

  // Preferred disciplines persist in a cookie for a year (empty = all).
  const COOKIE = 'nivut_disc';
  const cookies = {
    get(name) {
      try { return decodeURIComponent((document.cookie.split('; ').find((c) => c.startsWith(`${name}=`)) || '').split('=')[1] || ''); } catch { return ''; }
    },
    set(name, value) {
      try { document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${value ? 31536000 : 0}; path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch { /* blocked */ }
    },
  };

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  // The site's own disciplines (icons on nivut.org.il) set an event's color.
  const DISCIPLINES = {
    foot: { label: 'ניווט רגלי', color: '#15803d' },
    mtbo: { label: 'ניווט רכוב', color: '#1d6fd8' },
    ammi: { label: 'ניווט עממי', color: '#c2410c' },
  };
  // Line icons (24×24, drawn with currentColor): runner, bicycle, adult and child walking.
  const ICONS = {
    foot: '<circle cx="15" cy="4" r="2.2" fill="currentColor" stroke="none"/><path d="M7.5 11.5 10.5 8l4 1 2 3h3M10.5 8 13 13l-1.2 3.5L9 20.5H5.5M13 13l3.5 2.5L15.5 21"/>',
    mtbo: '<circle cx="5.5" cy="16" r="3.8"/><circle cx="18.5" cy="16" r="3.8"/><path d="M5.5 16 9.3 9.5h5.9L18.5 16M5.5 16H11l4.2-6.5M11 16 8.8 7.2M7.4 7.2h3M15.2 9.5l-1-3h2.6"/>',
    ammi: '<circle cx="8" cy="3.8" r="2" fill="currentColor" stroke="none"/><path d="M8 7v7.5M8 14.5 6 21M8 14.5l2 6.5M5 10.5l3-2 4.5 4"/><circle cx="17" cy="9.2" r="1.7" fill="currentColor" stroke="none"/><path d="M17 11.8v4.4M17 16.2 15.6 21M17 16.2l1.4 4.8M12.5 12.5l4.5 1.2 2.6-1"/>',
  };
  /** Discipline icon in a coloured disc (decorative: the label is always present as text). */
  const discIcon = (k, cls = '') => (ICONS[k]
    ? `<span class="di ${cls}" style="--c:${DISCIPLINES[k].color}" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg></span>`
    : '<span class="dot" aria-hidden="true"></span>');
  // Tags are inferred from the event title and type.
  const TAGS = {
    champ: 'אליפות', league: 'ליגה', sprint: 'ספרינט', training: 'אימון / מודל',
    night: 'לילה', rogaine: 'רוגיין', school: 'בתי ספר', relay: 'שליחים',
  };

  const state = {
    links: {}, events: [], forum: null, news: null, meta: null,
    filter: { q: '', club: '', disciplines: new Set(), tags: new Set() },
    forumQ: '', annualMode: 'year', monthCursor: null,
    people: [], participants: new Map(), clubs: [], myClub: '',
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
  const disc = (e) => DISCIPLINES[e.disciplines?.[0]] || { label: 'ניווט', color: '#64748b' };
  const evDate = (e) => parseDate(e.date, e.time);
  const discBadges = (e) => (e.disciplines || []).filter((k) => DISCIPLINES[k])
    .map((k) => `<span class="tag" style="--c:${DISCIPLINES[k].color}">${discIcon(k)}${esc(DISCIPLINES[k].label)}</span>`).join('');
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

  /* ---------- Clubs: logos, "my club", league highlight ---------- */
  const clubOf = (id) => state.clubs.find((c) => c.id === String(id || ''));
  /** Club from a free-text name, e.g. a participant's "מועדון השרון". */
  const clubByName = (text) => {
    const words = new Set(nameTokens(text));
    return state.clubs.find((c) => { const t = nameTokens(c.name); return t.length && t.every((w) => words.has(w)); });
  };
  /** Logo with a fallback image and, if both fail, the club's initial. Decorative: the name is always in text. */
  function logoHtml({ id = '', name = '', src = '', fallback = '' }, cls = '') {
    const club = clubOf(id) || (name ? clubByName(name) : null);
    const primary = src || club?.logo || fallback;
    const label = name || club?.name || '';
    const initial = label.replace(/^(מועדון|אס"?א|הפועל)\s+/, '').trim()[0] || '•';
    const alt = fallback && fallback !== primary ? ` data-fallback="${esc(fallback)}"` : '';
    return `<span class="club-logo ${cls}" aria-hidden="true"><span class="mono">${esc(initial)}</span>${primary ? `<img src="${esc(primary)}" alt="" loading="lazy"${alt} onerror="nivutLogoFail(this)">` : ''}</span>`;
  }
  window.nivutLogoFail = (img) => {
    const next = img.dataset.fallback;
    if (next) { img.removeAttribute('data-fallback'); img.src = next; } else img.remove();
  };
  const eventClubId = (e) => e.clubId || e.details?.club?.id || clubByName(e.clubName || '')?.id || '';
  const eventLogo = (e, cls) => logoHtml({ id: eventClubId(e), name: e.clubName, fallback: e.details?.club?.pageLogo }, cls);
  const isMine = (e) => !!state.myClub && eventClubId(e) === state.myClub;
  const isLeague = (e) => (e.tags || []).includes('league');
  const mineBadge = (e) => (isMine(e) ? '<span class="pill mine-pill">★ המועדון שלי</span>' : '');
  const leagueBadge = (e) => (isLeague(e) ? '<span class="pill league-pill"><span aria-hidden="true">🏆</span> ליגה</span>' : '');
  /** Participant's club name matches my club. */
  const inMyClub = (p) => { const c = clubOf(state.myClub); return !!c && !!p.club && clubByName(p.club)?.id === c.id; };

  function updateTrackButtons() {
    const c = clubOf(state.myClub);
    $$('.track-ico').forEach((el) => { el.innerHTML = c ? logoHtml({ id: c.id, name: c.name }, 'cl-btn') : '👥'; });
    $$('.people-count').forEach((el) => { el.textContent = state.people.length ? `(${state.people.length})` : ''; });
  }
  function fillClubSelect() {
    const sel = $('#myClubSel');
    sel.innerHTML = `<option value="">ללא</option>${state.clubs.map((c) => `<option value="${esc(c.id)}"${c.id === state.myClub ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}`;
    sel.disabled = !state.clubs.length;
    $('#myClubPreview').innerHTML = clubOf(state.myClub) ? logoHtml({ id: state.myClub }, 'cl-lg') : '';
  }
  function initMyClub() {
    state.myClub = cookies.get('nivut_club').replace(/\D/g, '');
    $('#myClubSel').addEventListener('change', (ev) => {
      state.myClub = ev.target.value;
      cookies.set('nivut_club', state.myClub);
      fillClubSelect();
      updateTrackButtons();
      $('#mineField').hidden = !state.myClub;
      if (!state.myClub) state.filter.mine = false;
      if (state.events.length) { renderTop4(); renderList(); renderYear(); }
      if (location.hash.startsWith('#event/')) showEvent(decodeURIComponent(location.hash.slice(7)));
      if (state.forum) renderForum();
      toast(state.myClub ? `המועדון שלך: ${clubOf(state.myClub)?.name}` : 'לא נבחר מועדון');
    });
  }

  /* ---------- My people: who is registered (names stay in this browser) ---------- */
  const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  const nameTokens = (s) => String(s).normalize('NFKD').replace(/[\u0591-\u05C7]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c]).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  /** Every word of the followed name appears in the participant's name, in any order. */
  const sameName = (person, participant) => {
    const p = new Set(nameTokens(participant));
    const want = nameTokens(person);
    return want.length > 0 && want.every((t) => p.has(t));
  };

  function loadPeople() {
    state.people = store.get('people', []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 100);
    updateTrackButtons();
  }
  function savePeople() {
    store.set('people', state.people);
    loadPeople();
    renderPeopleList();
    renderTop4();
    if (location.hash.startsWith('#event/')) renderMyPeople(decodeURIComponent(location.hash.slice(7)));
  }
  function renderPeopleList() {
    $('#peopleList').innerHTML = state.people.length
      ? state.people.map((n, i) => `<li><span>${esc(n)}</span><button type="button" class="icon-btn" data-remove-person="${i}" aria-label="הסרת ${esc(n)}">✕</button></li>`).join('')
      : '<li class="muted">עדיין לא הוספתם אף אחד.</li>';
  }
  function initPeople() {
    loadPeople();
    const dlg = $('#peopleDialog');
    let opener = null;
    const open = (btn) => { opener = btn; renderPeopleList(); dlg.showModal(); $('#personName').focus(); };
    $('#peopleBtn').addEventListener('click', (e) => open(e.currentTarget));
    document.addEventListener('click', (e) => { const b = e.target.closest('[data-open-people]'); if (b) open(b); });
    dlg.addEventListener('close', () => opener?.isConnected && opener.focus());
    $('#peopleForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#personName').value.trim().replace(/\s+/g, ' ');
      if (!name) return;
      if (!state.people.some((p) => nameTokens(p).join(' ') === nameTokens(name).join(' '))) state.people.push(name);
      $('#personName').value = '';
      savePeople();
      toast(`${name} נוסף/ה לרשימה`);
    });
    $('#peopleList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove-person]');
      if (!b) return;
      state.people.splice(+b.dataset.removePerson, 1);
      savePeople();
      $('#personName').focus();
    });
  }

  /** Participants of an event, fetched once per page view. */
  function participantsOf(e) {
    if (!e.nivutId) return Promise.resolve(null);
    if (!state.participants.has(e.nivutId)) {
      state.participants.set(e.nivutId, loadJson(`api/participants?id=${encodeURIComponent(e.nivutId)}`).catch((err) => ({ error: err.message })));
    }
    return state.participants.get(e.nivutId);
  }
  const startListUrl = (e) => (e.nivutId ? `${(state.links.home || 'https://nivut.org.il/').replace(/\/?$/, '/')}${e.nivutId}/Start` : e.url);
  const matchesIn = (list) => state.people.map((name) => ({ name, hit: (list || []).find((p) => sameName(name, p.name)) }));

  async function renderMyPeople(id) {
    const box = $('#myPeople');
    const e = state.events.find((x) => x.id === id);
    if (!box || !e) return;
    const club = clubOf(state.myClub);
    const title = club ? 'המעקב שלי' : 'האנשים שלי';
    if (!state.people.length && !club) {
      box.innerHTML = `<h2 id="mypl-h">המעקב שלי</h2><p class="muted">בחרו את המועדון שלכם והוסיפו אנשים שמעניינים אתכם, ונראה בכל אירוע מי רשום.</p>
        <button type="button" class="btn ghost" data-open-people>👥 הגדרת המעקב</button>`;
      return;
    }
    box.innerHTML = `<h2 id="mypl-h">${title}</h2><p class="muted" role="status">בודק את רשימת המשתתפים…</p>`;
    const data = await participantsOf(e);
    if (!$('#myPeople')) return;
    if (!data || data.error) {
      box.innerHTML = `<h2 id="mypl-h">${title}</h2><p class="muted">לא ניתן לקרוא כרגע את רשימת המשתתפים. <a href="${esc(startListUrl(e))}" target="_blank" rel="noopener">לרשימה באתר האיגוד ↗</a></p>`;
      return;
    }
    if (!data.participants.length) {
      box.innerHTML = `<h2 id="mypl-h">${title}</h2><p class="muted">רשימת המשתתפים ריקה, או שלא הצלחנו לקרוא אותה. <a href="${esc(startListUrl(e))}" target="_blank" rel="noopener">לרשימה באתר האיגוד ↗</a></p>
        ${data.diag ? `<details class="diag"><summary>פרטים טכניים</summary><pre dir="ltr">${esc(JSON.stringify(data.diag, null, 2))}</pre></details>` : ''}`;
      return;
    }
    const detail = (p) => [p.category, p.course, p.start && `זינוק ${p.start}`].filter(Boolean).map(esc).join(' · ');
    let html = `<h2 id="mypl-h">${title}</h2>`;
    if (club) {
      const mates = data.participants.filter(inMyClub);
      html += `<div class="myclub-row">${logoHtml({ id: club.id, name: club.name }, 'cl-md')}
        <p><strong>${mates.length ? `${mates.length} מ${esc(club.name)} רשומים` : `עדיין אין רשומים מ${esc(club.name)}`}</strong></p></div>
        ${mates.length ? `<details class="mates"><summary>הצגת הרשומים מהמועדון</summary><ul class="mypl">${mates.map((p) => `<li class="in"><span class="mark" aria-hidden="true">✓</span><div><strong>${esc(p.name)}</strong><span class="muted small">${detail(p)}</span></div></li>`).join('')}</ul></details>` : ''}`;
    }
    if (state.people.length) {
      const m = matchesIn(data.participants);
      const yes = m.filter((x) => x.hit), no = m.filter((x) => !x.hit);
      html += `<h3 class="mypl-sub">האנשים שלי <span class="muted">${yes.length} מתוך ${m.length} רשומים</span></h3>
      <ul class="mypl">
        ${yes.map(({ hit }) => `<li class="in"><span class="mark" aria-hidden="true">✓</span><div><strong>${esc(hit.name)}</strong><span class="sr-only"> – רשום/ה</span>
          <span class="muted small">${hit.club ? `${logoHtml({ name: hit.club }, 'cl-xs')} ${esc(hit.club)} · ` : ''}${detail(hit)}</span></div></li>`).join('')}
        ${no.map(({ name }) => `<li class="out"><span class="mark" aria-hidden="true">–</span><div><span>${esc(name)}</span><span class="sr-only"> – </span><span class="muted small">לא ברשימה</span></div></li>`).join('')}
      </ul>`;
    }
    html += `<p class="muted small">ברשימה כרגע <a href="${esc(startListUrl(e))}" target="_blank" rel="noopener">${data.count} משתתפים ↗</a> · <button type="button" class="linklike" data-open-people>עריכת המעקב</button></p>`;
    box.innerHTML = html;
  }

  /** "👥 registered: …" line on the top cards. */
  async function decorateTopPeople() {
    if (!state.people.length) return; // the top cards mark people only; club mates show on the event page
    for (const e of topEvents()) {
      if (!e.nivutId) continue;
      participantsOf(e).then((data) => {
        if (!data?.participants?.length) return;
        const hits = matchesIn(data.participants).filter((x) => x.hit).map((x) => x.name);
        const card = document.querySelector(`.top-card [href="#event/${CSS.escape(encodeURIComponent(e.id))}"]`)?.closest('.top-card');
        if (!card || !hits.length || card.querySelector('.people-chip')) return;
        const names = hits.length > 2 ? `${hits.slice(0, 2).join(', ')} ועוד ${hits.length - 2}` : hits.join(' ו');
        card.querySelector('.top-meta').insertAdjacentHTML('beforeend', `<p class="people-chip"><span aria-hidden="true">👥</span> רשומים: ${esc(names)}</p>`);
      });
    }
  }

  /* ---------- Early-registration countdown ---------- */
  const regDeadline = (e) => (e.details?.registrationDeadline ? parseDate(e.details.registrationDeadline) : null);

  /** Live countdown markup; refreshed by tickCountdowns(). */
  function countdownHtml(until, size = '') {
    return `<div class="cd ${size}" data-until="${until.toISOString()}" role="timer"></div>`;
  }
  function tickCountdowns() {
    const now = Date.now();
    $$('.cd[data-until]').forEach((el) => {
      const ms = new Date(el.dataset.until) - now;
      if (ms <= 0) { el.innerHTML = '<span class="cd-done">ההרשמה המוקדמת נסגרה</span>'; el.removeAttribute('aria-label'); return; }
      el.setAttribute('aria-label', `ההרשמה המוקדמת נסגרת בעוד ${spokenCountdown(ms)}`);
      el.innerHTML = countdownParts(ms).map(([n, l]) => `<div aria-hidden="true"><strong>${n}</strong><span>${l}</span></div>`).join('');
    });
  }
  setInterval(tickCountdowns, 30000);

  /** Registration block for cards: countdown when open, otherwise a short status line. */
  /** Registration can still be done online: early deadline ahead, or not known (no details yet). */
  const regOpen = (e) => {
    if (e.source === 'closed-area' || daysBetween(new Date(), evDate(e)) < 0) return false;
    const dl = regDeadline(e);
    return dl ? dl > new Date() : true;
  };

  function regBlock(e, size) {
    const dl = regDeadline(e);
    if (e.source === 'closed-area') return '<p class="reg-line reg-soon"><span aria-hidden="true">⏳</span> הרשמה טרם נפתחה</p>';
    if (!dl) return e.details ? '<p class="reg-line">הרשמה באתר האיגוד</p>' : '';
    if (dl <= new Date()) return `<p class="reg-line reg-closed"><span aria-hidden="true">🔒</span> ההרשמה המוקדמת נסגרה${e.details.onsite ? ' · <strong>אפשר להירשם במקום</strong>' : ''}</p>`;
    return `<div class="reg-cd"><p class="reg-cd-label">הרשמה מוקדמת נסגרת בעוד</p>${countdownHtml(dl, size)}</div>`;
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
    // Evenly spaced, not to scale, so labels never collide when times are close together.
    const anchors = [[s, 0]];
    if (t !== null) anchors.push([t, 0]);
    if (c !== null) anchors.push([c, 0]);
    const slots = { 1: [50], 2: [16, 84], 3: [14, 50, 86] }[anchors.length];
    anchors.forEach((a, i) => { a[1] = slots[i]; });
    const lo = s, hi = anchors[anchors.length - 1][0];
    const at = (n) => {
      for (let i = 1; i < anchors.length; i++) {
        const [m0, p0] = anchors[i - 1], [m1, p1] = anchors[i];
        if (n <= m1) return p0 + ((n - m0) / Math.max(1, m1 - m0)) * (p1 - p0);
      }
      return anchors[anchors.length - 1][1];
    };
    const pos = (n) => `${at(n).toFixed(1)}%`;
    const points = [
      { at: s, label: 'זינוק ראשון', cls: 'start' },
      t !== null && { at: t, label: 'זינוק אחרון', cls: 'start' },
      c !== null && { at: c, label: 'שעת גג', cls: 'cutoff' },
    ].filter(Boolean);
    const now = new Date();
    const isToday = daysBetween(now, evDate(e)) === 0;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return `<div class="tl" role="group" aria-label="לוח הזמנים של יום התחרות">
        <div class="tl-track" aria-hidden="true">
          ${t !== null ? `<div class="tl-window" style="inset-inline-start:${pos(s)};width:calc(${pos(t)} - ${pos(s)})"></div>` : ''}
          ${c !== null ? `<div class="tl-run" style="inset-inline-start:${pos(t ?? s)};width:calc(${pos(c)} - ${pos(t ?? s)})"></div>` : ''}
          ${isToday && nowMin > lo && nowMin < hi ? `<div class="tl-now" style="inset-inline-start:${pos(nowMin)}"><span>עכשיו</span></div>` : ''}
        </div>
        <ol class="tl-points">${points.map((p) => `<li class="${p.cls}" style="--pos:${pos(p.at)}"><time>${fromMin(p.at)}</time><span>${p.label}</span></li>`).join('')}</ol>
      </div>`;
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
    const tl = timelineHtml(d, e);
    const hasGeo = d.lat && d.lng;
    const bbox = hasGeo ? [d.lng - 0.03, d.lat - 0.018, d.lng + 0.03, d.lat + 0.018].map((n) => n.toFixed(5)).join(',') : '';

    return `
    <header class="ev-hero${isLeague(e) ? ' is-league' : ''}" style="--c:${dc.color}">
      <div class="container">
        <a class="ev-back" href="#${esc(state.lastView || 'upcoming')}">→ חזרה</a>
        <div class="ev-hero-grid">
          <div class="ev-date" aria-hidden="true">
            <span class="dow">יום ${DAYS[date.getDay()]}</span>
            <span class="day">${date.getDate()}</span>
            <span class="mon">${MONTHS[date.getMonth()]} ${date.getFullYear()}</span>
          </div>
          <div class="ev-head">
            <div class="badges">${leagueBadge(e)}${mineBadge(e)}${discBadges(e)}${tagBadges({ ...e, tags: (e.tags || []).filter((t) => t !== 'league') })}
              ${e.clubName ? `<span class="tag club-tag">${eventLogo(e, 'cl-sm')}${esc(e.clubName)}</span>` : ''}</div>
            <h1 id="evTitle" tabindex="-1">${esc(e.title)}</h1>
            ${d.eventType || d.note ? `<p class="ev-sub">${[d.eventType, d.note].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
            <p class="sr-only">${fmtLong(date)}${e.location ? `, ${esc(e.location)}` : ''}</p>
          </div>
          <div class="ev-count">
            ${left < 0 ? '<span class="ev-count-big">✓</span><span>התקיים</span>'
              : reg.state === 'open' && reg.deadline ? `<span class="ev-count-label">הרשמה מוקדמת נסגרת בעוד</span>${countdownHtml(reg.deadline, 'cd-hero')}`
              : `<span class="ev-count-label">${esc(reg.title)}</span>`}
          </div>
        </div>
      </div>
      <svg class="ev-contours" viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.2">
        <path d="M-20 160 C60 120 120 180 200 140 S340 90 420 130"/><path d="M-20 130 C70 90 130 150 210 110 S330 60 420 100"/>
        <path d="M-20 100 C80 60 140 120 220 80 S320 30 420 70"/><path d="M-20 70 C90 30 150 90 230 50 S310 0 420 40"/></g></svg>
    </header>

    <div class="container ev-body">
      <ul class="ev-facts${tl ? ' has-tl' : ''}" aria-label="עיקרי האירוע">
        <li class="fact-when"><span class="ev-ico" aria-hidden="true">🕘</span><span class="k">מתי</span>
          <strong>${d.startFrom ? esc(d.startFrom) : fmtShort(date)}</strong>
          <span>${d.startFrom ? 'תחילת זינוקים · ' : ''}${DAYS[date.getDay()]} ${date.getDate()}.${date.getMonth() + 1}${left >= 0 ? ` · ${inDays(left)}` : ''}</span>
          ${tl}</li>
        <li><span class="ev-ico" aria-hidden="true">📍</span><span class="k">איפה</span>
          <strong>${esc(e.location || d.name || 'יפורסם')}</strong>
          ${canNavigate(e) ? `<a href="${esc(wazeUrl(e))}" target="_blank" rel="noopener">ניווט לכינוס ב-Waze</a>` : '<span>&nbsp;</span>'}</li>
        <li><span class="ev-ico" aria-hidden="true">₪</span><span class="k">כמה</span>
          <strong class="${price || d.price ? '' : 'tbd'}">${price ? `${price} ₪` : d.price ? esc(d.price) : 'יפורסם'}</strong>
          <span>${price ? `לחברי איגוד${priceOut ? ` · ${priceOut} ₪ לחיצוניים` : ''}` : '&nbsp;'}</span></li>
        <li class="reg-${reg.state}"><span class="ev-ico" aria-hidden="true">${reg.state === 'open' ? '✍️' : reg.state === 'past' ? '🏁' : '⏳'}</span><span class="k">הרשמה</span>
          <strong>${reg.state === 'open' && reg.deadline ? `עד ${DAYS[reg.deadline.getDay()]} ${reg.deadline.getDate()}.${reg.deadline.getMonth() + 1}` : esc(reg.title)}</strong>
          <span>${reg.state === 'open' && reg.deadline ? `הרשמה מוקדמת${d.registrationDeadline.length > 10 ? ` · עד ${esc(d.registrationDeadline.slice(11, 16))}` : ''}` : '&nbsp;'}</span></li>
      </ul>

      <div class="ev-grid">
        <div class="ev-main">
          ${loading ? '<section class="ev-card" role="status"><p class="muted">טוען את פרטי התחרות מאתר האיגוד…</p></section>' : ''}
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
            ${reg.text ? `<p>${esc(reg.text)}</p>` : ''}
            ${d.onsite && reg.state === 'open' ? `<p class="muted small">הרשמה במקום: ${esc(d.onsite)}</p>` : ''}
            <a class="btn btn-xl" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(reg.cta)} ↗</a>
            <div class="ev-actions">
              <button type="button" class="btn ghost" data-ics="${esc(e.id)}">📅 ליומן</button>
              <button type="button" class="btn ghost" data-share="${esc(e.id)}">🔗 שיתוף</button>
              ${e.nivutId ? `<a class="btn ghost" href="${esc(startListUrl(e))}" target="_blank" rel="noopener">👥 רשימת משתתפים</a>` : ''}
            </div>
          </section>

          ${e.nivutId ? '<section class="ev-card" id="myPeople" aria-labelledby="mypl-h" aria-live="polite"></section>' : ''}

          ${d.map ? `<section class="ev-card" aria-labelledby="mp-h"><h2 id="mp-h">מפת הניווט</h2>
            ${d.map.image ? `<a class="ev-mapimg" href="${esc(d.map.image)}" target="_blank" rel="noopener"><img src="${esc(d.map.image)}" alt="תצוגה מקדימה של מפת ${esc(d.map.name)}" loading="lazy" onerror="this.parentNode.remove()"></a>` : ''}
            <p><strong>${d.map.url ? `<a href="${esc(d.map.url)}" target="_blank" rel="noopener">${esc(d.map.name)}</a>` : esc(d.map.name)}</strong></p>
            <ul class="chips-static">${[d.map.terrain && `שטח ${d.map.terrain}`, d.map.scale && `קנ"מ ${d.map.scale}`, d.map.year && `מופה ${d.map.year}`].filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          </section>` : ''}

          ${d.club || d.planner || d.director || d.contact ? `<section class="ev-card" aria-labelledby="pp-h"><h2 id="pp-h">מי מארגן</h2><dl class="ev-people">
            ${d.club ? `<dt>מועדון</dt><dd class="club-dd">${eventLogo(e, 'cl-md')}${d.club.url ? `<a href="${esc(d.club.url)}" target="_blank" rel="noopener">${esc(d.club.name)}</a>` : esc(d.club.name)}${isMine(e) ? ' <span class="pill mine-pill">★ המועדון שלי</span>' : ''}</dd>` : ''}
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
    tickCountdowns();
    renderMyPeople(id);
    $('#evTitle')?.focus({ preventScroll: true });
    if (!e.details && e.nivutId) {
      try {
        e.details = await loadJson(`api/event?id=${encodeURIComponent(e.nivutId)}`);
        if (e.details.startFrom && e.details.startFrom !== '00:00' && !e.time) e.time = e.details.startFrom;
      } catch { e.details = null; e.nivutId = null; }
      if (location.hash === `#event/${id}`) { box.innerHTML = eventPageHtml(e); tickCountdowns(); renderMyPeople(id); }
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

  /** The nearest published events (closed-area placeholders only fill gaps). */
  /** The saved discipline filter; events of any selected discipline pass. */
  const discOk = (e) => !state.filter.disciplines.size || (e.disciplines || []).some((k) => state.filter.disciplines.has(k));

  function renderDiscFilter() {
    $('#discFilter').innerHTML = `<span class="df-label" aria-hidden="true">הצג:</span>${Object.entries(DISCIPLINES).map(([k, d]) => {
      const on = !state.filter.disciplines.size || state.filter.disciplines.has(k); // pressed = shown
      return `<button type="button" class="df-btn" data-disc="${k}" aria-pressed="${on}" style="--c:${d.color}">${discIcon(k)}<span class="df-text">${esc(d.label)}</span></button>`;
    }).join('')}`;
  }
  function initDiscFilter() {
    const saved = cookies.get(COOKIE).split(',').filter((k) => DISCIPLINES[k]);
    state.filter.disciplines = new Set(saved);
    renderDiscFilter();
    $('#discFilter').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-disc]');
      if (!b) return;
      const all = Object.keys(DISCIPLINES);
      const shown = new Set(state.filter.disciplines.size ? state.filter.disciplines : all);
      const k = b.dataset.disc;
      if (shown.has(k) && shown.size === 1) { toast('צריך להציג לפחות סוג ניווט אחד'); return; }
      shown.has(k) ? shown.delete(k) : shown.add(k);
      const set = state.filter.disciplines;
      set.clear();
      if (shown.size < all.length) shown.forEach((x) => set.add(x)); // everything shown = no filter
      cookies.set(COOKIE, [...set].join(','));
      renderDiscFilter();
      $(`#discFilter [data-disc="${b.dataset.disc}"]`).focus();
      if (!state.events.length) return;
      renderTop4(); renderList(); renderLegend(); renderYear(); renderMonth();
      const n = upcoming().filter(discOk).length;
      toast(set.size ? `מוצגים ${n} ניווטים מהסוגים שבחרת` : 'מוצגים כל סוגי הניווט');
    });
  }

  function topEvents(n = 4) {
    const up = upcoming().filter(discOk);
    const real = up.filter((e) => e.source !== 'closed-area');
    return [...real, ...up.filter((e) => e.source === 'closed-area')].slice(0, n).sort((a, b) => evDate(a) - evDate(b));
  }

  function renderTop4() {
    const box = $('#top4');
    const list = topEvents();
    if (!list.length) {
      box.innerHTML = `<li class="top4-loading">${state.filter.disciplines.size ? 'אין ניווטים קרובים מהסוגים שבחרת.' : 'אין אירועים מתוכננים כרגע.'}</li>`;
      return;
    }
    const now = new Date();
    box.innerHTML = list.map((e, i) => {
      const d = evDate(e);
      const left = daysBetween(now, d);
      const lead = i === 0;
      return `<li class="top-card${lead ? ' lead' : ''}${isLeague(e) ? ' is-league' : ''}${isMine(e) ? ' is-mine' : ''}" style="--c:${disc(e).color}">
        ${lead ? `<div class="lead-band" aria-hidden="true">
          <span class="lb-day">${d.getDate()}</span>
          <span class="lb-mon">${MONTHS[d.getMonth()]}<br>יום ${DAYS[d.getDay()]}</span>
          <span class="lb-icons">${(e.disciplines || []).map((k) => discIcon(k, 'di-xl')).join('')}</span>
        </div>` : ''}
        <div class="top-bar">
          <div class="badges">${leagueBadge(e)}${mineBadge(e)}${discBadges(e)}</div>
          ${e.clubName ? `<span class="top-club">${eventLogo(e, 'cl-sm')}<span>${esc(e.clubName)}</span></span>` : ''}
        </div>
        <div class="top-head">
          <div class="top-date" aria-hidden="true"><span class="day">${d.getDate()}</span><span class="mon">${MONTHS[d.getMonth()]}</span>
            <span class="top-di">${(e.disciplines || []).map((k) => discIcon(k, 'di-sm')).join('')}</span>
            ${e.clubName ? `<span class="date-club">${eventLogo(e, 'cl-xs')}</span>` : ''}</div>
          <div class="top-meta">
            <h2><a href="#event/${encodeURIComponent(e.id)}"><span class="title-flags" aria-hidden="true">${isLeague(e) ? '🏆' : ''}${isMine(e) ? '★' : ''}</span>${esc(e.title)}</a></h2>
            <p class="top-when">${DAYS[d.getDay()]}${e.time ? ` · <strong class="start-time">זינוק ${esc(e.time)}</strong>` : ''}${e.location && e.location !== e.title ? ` · <span class="top-loc">${esc(e.location)}</span>` : ''}<span class="sr-only">, ${fmtLong(d)}</span></p>
          </div>
        </div>
        ${lead && e.summary ? `<p class="lead-summary">${esc(e.summary)}</p>` : ''}
        ${regBlock(e, 'cd-card')}
        ${regOpen(e) ? `<p class="top-foot"><span>${inDays(left)}</span><a class="top-cta" href="${esc(e.url)}" target="_blank" rel="noopener" aria-label="הרשמה ל${esc(e.title)} באתר האיגוד">הרשמה ↗</a></p>` : ''}
      </li>`;
    }).join('');
    tickCountdowns();
    decorateTopPeople();
  }

  function chipGroup(container, entries, set) {
    container.hidden = entries.length < 2;
    entries.forEach(([key, label, color]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip';
      b.setAttribute('aria-pressed', 'false');
      if (color) b.style.setProperty('--c', color);
      b.innerHTML = `${DISCIPLINES[key] ? discIcon(key) : color ? '<span class="dot"></span>' : ''}${esc(label)}`;
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
    const tags = new Set(evs.flatMap((e) => e.tags || []));
    chipGroup($('#tagChips'), Object.entries(TAGS).filter(([k]) => tags.has(k)).map(([k, l]) => [k, l]), state.filter.tags);
    const clubs = [...new Set(evs.map((e) => e.clubName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
    $('#clubField').hidden = clubs.length < 2;
    $('#club').insertAdjacentHTML('beforeend', clubs.map((r) => `<option>${esc(r)}</option>`).join(''));
    $('#q').addEventListener('input', (e) => { state.filter.q = e.target.value.trim(); renderList(); });
    const toggle = $('#searchToggle');
    const setOpen = (open) => {
      $('#filters').hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) $('#q').focus();
    };
    toggle.addEventListener('click', () => setOpen($('#filters').hidden));
    document.addEventListener('keydown', (ev) => {
      if (ev.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && !$('#view-upcoming').hidden) {
        ev.preventDefault(); setOpen(true);
      }
      if (ev.key === 'Escape' && !$('#filters').hidden && $('#filters').contains(document.activeElement)) { setOpen(false); toggle.focus(); }
    });
    $('#clearFilters').addEventListener('click', () => {
      state.filter.q = ''; state.filter.club = ''; state.filter.mine = false; $('#mineOnly').checked = false;
      state.filter.disciplines.clear(); state.filter.tags.clear();
      $('#q').value = ''; $('#club').value = '';
      $$('#filters .chip').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      renderList();
      $('#q').focus();
    });
    $('#club').addEventListener('change', (e) => { state.filter.club = e.target.value; renderList(); });
    $('#mineField').hidden = !state.myClub;
    $('#mineOnly').addEventListener('change', (e) => { state.filter.mine = e.target.checked; renderList(); });
  }

  function eventCard(e, now) {
    const d = evDate(e);
    const left = daysBetween(now, d);
    const det = e.details;
    const when = det?.startFrom ? `תחילת זינוקים ${esc(det.startFrom)}` : '';
    const closed = e.source === 'closed-area';
    return `<li>
      <article class="event-card${closed ? ' compact' : ''}${isLeague(e) ? ' is-league' : ''}${isMine(e) ? ' is-mine' : ''}" style="--c:${disc(e).color}" aria-labelledby="t-${esc(e.id)}">
        <div class="date-badge" aria-hidden="true"><span class="d">${d.getDate()}</span><span class="m">${MONTHS[d.getMonth()]}</span><span class="w">יום ${DAYS_SHORT[d.getDay()]}</span></div>
        <div class="card-main">
          <div class="badges">${leagueBadge(e)}${mineBadge(e)}${discBadges(e)}${tagBadges({ ...e, tags: (e.tags || []).filter((t) => t !== 'league') })}</div>
          <h3 id="t-${esc(e.id)}"><button type="button" data-open="${esc(e.id)}">${esc(e.title)}</button></h3>
          <ul class="meta">
            <li><span class="sr-only">מועד: </span>${fmtLong(d)}</li>
            ${when ? `<li>⏱ ${when}</li>` : ''}
            ${e.location && e.location !== e.title ? `<li>📍 ${esc(e.location)}</li>` : ''}
            ${e.clubName ? `<li class="club-li">${eventLogo(e, 'cl-sm')}מועדון ${esc(e.clubName)}</li>` : ''}
            ${closed ? '<li class="muted">שטח סגור לקראת תחרות · פרטים בקרוב</li>' : ''}
          </ul>
          ${e.summary ? `<p class="summary">${esc(e.summary)}</p>` : ''}
          ${regDeadline(e) ? regBlock(e, 'cd-inline') : ''}
        </div>
        ${e.image ? `<img class="thumb" src="${esc(e.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
        <div class="card-actions">
          <button type="button" class="btn ghost" data-ics="${esc(e.id)}" aria-label="הוסף ליומן: ${esc(e.title)}">📅 ליומן</button>
          ${canNavigate(e) ? `<a class="btn ghost" href="${esc(wazeUrl(e))}" target="_blank" rel="noopener" aria-label="ניווט ב-Waze אל ${esc(e.location || e.title)}">🚗 Waze</a>` : ''}
          ${regOpen(e) ? `<a class="btn ghost" href="${esc(e.url)}" target="_blank" rel="noopener" aria-label="הרשמה ל${esc(e.title)} באתר האיגוד">↗ הרשמה</a>` : ''}
        </div>
      </article></li>`;
  }

  // The saved discipline filter is a preference, not a search: it does not count here.
  const filtering = () => !!(state.filter.q || state.filter.club || state.filter.tags.size || state.filter.mine);

  function renderList() {
    const { q, club, disciplines, tags } = state.filter;
    const ql = q.toLowerCase();
    const active = [q, club].filter(Boolean).length + tags.size + (state.filter.mine ? 1 : 0);
    $('#filterCount').hidden = !active;
    $('#filterCount').textContent = active ? `(${active})` : '';
    const top = filtering() ? new Set() : new Set(topEvents().map((e) => e.id));
    $('#all-title').textContent = filtering() ? 'תוצאות חיפוש' : 'עוד ניווטים';
    const list = upcoming().filter((e) => !top.has(e.id)).filter((e) =>
      (!disciplines.size || (e.disciplines || []).some((k) => disciplines.has(k))) &&
      (!tags.size || (e.tags || []).some((k) => tags.has(k))) &&
      (!club || e.clubName === club) &&
      (!state.filter.mine || isMine(e)) &&
      (!ql || [e.fullTitle, e.title, e.location, e.clubName, e.eventType, e.summary].join(' ').toLowerCase().includes(ql)));
    $('#resultCount').textContent = filtering() ? `${list.length} אירועים נמצאו` : '';
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
    tickCountdowns();
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
    $('#legend').innerHTML = Object.entries(DISCIPLINES)
      .map(([k, t]) => `<span style="--c:${t.color}" class="${state.filter.disciplines.size && !state.filter.disciplines.has(k) ? 'off' : ''}">${discIcon(k)}${esc(t.label)}${state.filter.disciplines.size && !state.filter.disciplines.has(k) ? '<span class="sr-only"> (מוסתר)</span>' : ''}</span>`).join('')
      + '<span class="muted">· מסגרת מקווקוות = שטח סגור, פרטים בקרוב</span>';
  }

  function eventsIn(y, m) {
    return state.events.filter((e) => { const d = parseDate(e.date); return discOk(e) && d.getFullYear() === y && d.getMonth() === m; });
  }

  function renderYear() {
    const now = new Date();
    $('#yearView').innerHTML = seasonRange().map((m) => {
      const evs = eventsIn(m.getFullYear(), m.getMonth());
      const past = new Date(m.getFullYear(), m.getMonth() + 1, 0) < startOfDay(now);
      return `<section class="month-card${past ? ' past' : ''}" aria-label="${MONTHS[m.getMonth()]} ${m.getFullYear()}">
        <h2>${MONTHS[m.getMonth()]} <small>${m.getFullYear()} · ${evs.length} אירועים</small></h2>
        ${evs.length ? `<ul>${evs.map((e) => `<li><button type="button" data-open="${esc(e.id)}" style="--c:${disc(e).color}" class="${e.source === 'closed-area' ? 'tentative' : ''}">
            <strong>${parseDate(e.date).getDate()}</strong>${discIcon(e.disciplines?.[0], 'di-sm')}<span>${isLeague(e) ? '<span class="league-dot" aria-hidden="true">🏆</span>' : ''}${esc(e.title)}${isLeague(e) ? '<span class="sr-only"> (ליגה)</span>' : ''}<span class="sr-only"> (${esc(disc(e).label)})</span></span></button></li>`).join('')}</ul>`
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
        const evs = state.events.filter((e) => e.date === isoD && discOk(e));
        const cls = [d.getMonth() !== m && 'out', d.getTime() === today && 'today'].filter(Boolean).join(' ');
        html += `<td class="${cls}"${d.getTime() === today ? ' aria-current="date"' : ''}><span class="num">${d.getDate()}</span>${evs.map((e) => `<button type="button" data-open="${esc(e.id)}" style="--c:${disc(e).color}" class="${e.source === 'closed-area' ? 'tentative' : ''}" title="${esc(e.title)}${isLeague(e) ? ' (ליגה)' : ''}">${discIcon(e.disciplines?.[0], 'di-xs')}${isLeague(e) ? '🏆 ' : ''}${esc(e.title)}</button>`).join('')}</td>`;
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
    if (!f.threads.length) {
      $('#topicList').innerHTML = `<li class="empty">לא נמצאו כרגע הודעות בפורום.
        <a href="${esc(f.source || state.links.forum || '#')}" target="_blank" rel="noopener">לפורום באתר האיגוד ↗</a>
        ${f.diag ? `<details class="diag"><summary>פרטים טכניים</summary><pre dir="ltr">${esc(JSON.stringify(f.diag, null, 2))}</pre></details>` : ''}</li>`;
      return;
    }
    $('#topicList').innerHTML = threads.length ? threads.map((t) => {
      const ev = matchEvent(t.title);
      return `<li class="topic${t.announcement || t.pinned ? ' featured' : ''}">
        <details id="thread-${esc(t.id)}">
          <summary>
            <div class="topic-head">
              <div class="badges">${t.announcement ? '<span class="pill strong">הכרזה</span>' : ''}${t.pinned ? '<span class="pill">📌 נעוץ</span>' : ''}</div>
              <h2>${esc(t.title)}</h2>
              <p class="meta"><span class="author${state.myClub && t.authorClubId === state.myClub ? ' mine-author' : ''}">${t.authorLogo || t.authorClubId ? logoHtml({ id: t.authorClubId, fallback: t.authorLogo }, 'cl-xs') : ''}${esc(t.author)}</span>${t.lastActivity ? `<span>פעילות אחרונה ${relTime(t.lastActivity)}</span>` : ''}</p>
            </div>
            <div class="replies" aria-label="${t.replyCount} תגובות"><strong>${t.replyCount}</strong><span>תגובות</span></div>
          </summary>
          <div class="thread">
            ${msgBody(t) || '<p class="muted">(הודעה ללא תוכן)</p>'}
            ${ev ? `<p class="related">אירוע קשור: <button type="button" class="chip" data-open="${esc(ev.id)}">${esc(ev.title)} · ${fmtShort(evDate(ev))}</button></p>` : ''}
            ${t.replies.length ? `<ol class="reply-list" aria-label="תגובות">${t.replies.map((r) => `<li>
              <p class="meta"><strong class="author${state.myClub && r.authorClubId === state.myClub ? ' mine-author' : ''}">${r.authorLogo || r.authorClubId ? logoHtml({ id: r.authorClubId, fallback: r.authorLogo }, 'cl-xs') : ''}${esc(r.author)}</strong><span>${relTime(r.postedAt)}</span></p>${msgBody(r) || `<p>${esc(r.title)}</p>`}</li>`).join('')}</ol>` : ''}
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
      s.textContent = !f.threads.length ? statusText(f) : `${statusText(f)} · ${f.threads.length} נושאים${f.via === 'rss' ? ' (מעדכוני ה-RSS של הפורום)' : ' מהשבוע האחרון'}`;
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
    initMyClub();
    initPeople();
    initDiscFilter();
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
      $('#top4').innerHTML = `<li class="top4-loading">לא ניתן לקרוא כרגע את האירועים מאתר האיגוד. <a href="${off}" rel="noopener">ללוח האירועים הרשמי ↗</a></li>`;
      $('#searchToggle').hidden = true;
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
    state.clubs = events.clubs || [];
    fillClubSelect();
    updateTrackButtons();
    state.events = events.events.map((e) => (e.time === '00:00' ? { ...e, time: '' } : e)).sort((a, b) => evDate(a) - evDate(b));
    const status = $('#liveStatus');
    status.textContent = statusText(events);
    status.classList.toggle('warn', !!events.stale);
    status.hidden = false;

    renderTop4();
    renderFilters();
    renderList();
    initAnnual();
    initForum();
    if (/^#(event|forum)\//.test(location.hash)) route();
  }

  boot();
})();
