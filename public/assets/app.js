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
  };
  // Line icons (24×24, drawn with currentColor): runner, bicycle, adult and child walking.
  const ICONS = {
    foot: '<circle cx="15" cy="4" r="2.2" fill="currentColor" stroke="none"/><path d="M7.5 11.5 10.5 8l4 1 2 3h3M10.5 8 13 13l-1.2 3.5L9 20.5H5.5M13 13l3.5 2.5L15.5 21"/>',
    mtbo: '<circle cx="5.5" cy="16" r="3.8"/><circle cx="18.5" cy="16" r="3.8"/><path d="M5.5 16 9.3 9.5h5.9L18.5 16M5.5 16H11l4.2-6.5M11 16 8.8 7.2M7.4 7.2h3M15.2 9.5l-1-3h2.6"/>',
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
    listMonths: 2, // "more navigations" window; grows by two months per "show more"
    links: {}, events: [], forum: null, news: null, meta: null,
    filter: { q: '', club: '', disciplines: new Set(), tags: new Set() },
    forumQ: '', annualMode: 'year', monthCursor: null,
    people: [], participants: new Map(), clubs: [], myClub: '', home: null,
  };

  /* ---------- Accessibility & display preferences ---------- */
  function initPrefs() {
    const root = document.documentElement;
    let scale = store.get('scale', 1);
    const applyScale = () => root.style.setProperty('--scale', scale);
    applyScale();
    // The tools fold into one button; Escape or a click elsewhere closes them.
    const a11yBtn = $('#a11yToggle'), a11yBox = $('#a11yTools');
    const setA11y = (open) => { a11yBox.hidden = !open; a11yBtn.setAttribute('aria-expanded', String(open)); };
    a11yBtn.addEventListener('click', () => { setA11y(a11yBox.hidden); if (!a11yBox.hidden) a11yBox.querySelector('button')?.focus(); });
    document.addEventListener('click', (ev) => { if (!a11yBox.hidden && !ev.target.closest('.a11y-menu')) setA11y(false); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !a11yBox.hidden) { setA11y(false); a11yBtn.focus(); } });
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
  const VIEWS = ['upcoming', 'annual', 'forum', 'ranking', 'event', 'results'];
  function route() {
    const [name, ...rest] = location.hash.slice(1).split('/');
    const param = decodeURIComponent(rest.join('/'));
    const view = VIEWS.includes(name) ? name : 'upcoming';
    VIEWS.forEach((v) => { $(`#view-${v}`).hidden = v !== view; });
    // Each screen fades in as it is opened (CSS skips it when motion is reduced).
    const shown = $(`#view-${view}`);
    shown.classList.remove('view-in'); void shown.offsetWidth; shown.classList.add('view-in');
    $$('.tabs a').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.view === view)));
    const titles = { upcoming: 'ניווטים קרובים', annual: 'תוכנית שנתית', forum: 'פורום', ranking: 'דירוג', event: 'אירוע', results: 'תוצאות' };
    document.title = `${titles[view]} – ניווט ישראל`;
    if (view !== 'event') state.lastView = view;
    window.scrollTo(0, 0);
    if (view === 'event') { showEvent(param); return; }
    if (view === 'forum') markForumSeen();
    if (view === 'forum' && param) { openThread(param); return; }
    if (view === 'ranking') showRanking();
    if (view === 'results') { showResultFile(param); return; }
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
  const wazeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C7 3 3.5 6.4 3.5 10.6c0 1.6.5 3 1.4 4.2-.2 1-.8 1.9-1.6 2.5 1.6.3 3.1-.1 4.2-.9 1.3.6 2.8 1 4.5 1 5 0 8.5-3.4 8.5-7.6S17 3 12 3z" fill="#fff" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="1.1" fill="currentColor"/><circle cx="15" cy="10" r="1.1" fill="currentColor"/><path d="M9 13.2c1.6 1.4 4.4 1.4 6 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  /** Waze button: small on the cards (above the card-wide link), larger with a label on the event page. */
  const wazeLink = (e, label = 'Waze', cls = '') => (e.source !== 'closed-area' && canNavigate(e)
    ? `<a class="waze-link ${cls}" href="${esc(wazeUrl(e))}" target="_blank" rel="noopener" aria-label="ניווט ב-Waze אל ${esc(e.location || e.title)}">${wazeIcon}${label}</a>` : '');


  /* ---------- My location & distance (kept in this browser only) ---------- */
  const CITIES = [
    ['אופקים', 31.31, 34.62], ['אילת', 29.558, 34.952], ['אריאל', 32.104, 35.17], ['אשדוד', 31.804, 34.655], ['אשקלון', 31.669, 34.571],
    ['באר שבע', 31.252, 34.791], ['בית שאן', 32.497, 35.497], ['בית שמש', 31.747, 34.988], ['בני ברק', 32.084, 34.834], ['בת ים', 32.017, 34.75],
    ['גבעתיים', 32.072, 34.81], ['דימונה', 31.069, 35.033], ['הוד השרון', 32.15, 34.888], ['הרצליה', 32.166, 34.843], ['זכרון יעקב', 32.571, 34.952],
    ['חדרה', 32.434, 34.919], ['חולון', 32.011, 34.774], ['חיפה', 32.794, 34.989], ['טבריה', 32.795, 35.531], ['יבנה', 31.877, 34.739],
    ['יקנעם', 32.659, 35.11], ['ירושלים', 31.778, 35.235], ['כפר סבא', 32.175, 34.907], ['כרמיאל', 32.919, 35.296], ['לוד', 31.951, 34.895],
    ['מגדל העמק', 32.676, 35.241], ['מודיעין', 31.899, 35.01], ['מעלה אדומים', 31.777, 35.298], ['מצפה רמון', 30.61, 34.8], ['נהריה', 33.006, 35.098],
    ['נס ציונה', 31.929, 34.798], ['נצרת', 32.7, 35.3], ['נתניה', 32.321, 34.853], ['עכו', 32.927, 35.083], ['עפולה', 32.607, 35.289],
    ['ערד', 31.258, 35.213], ['פתח תקווה', 32.087, 34.887], ['צפת', 32.965, 35.496], ['קצרין', 32.993, 35.69], ['קריית אתא', 32.809, 35.104],
    ['קריית גת', 31.61, 34.764], ['קריית שמונה', 33.207, 35.571], ['ראש העין', 32.096, 34.957], ['ראשון לציון', 31.964, 34.804], ['רחובות', 31.894, 34.811],
    ['רמלה', 31.929, 34.866], ['רמת גן', 32.068, 34.824], ['רעננה', 32.185, 34.871], ['שדרות', 31.524, 34.596], ['שוהם', 31.999, 34.946], ['תל אביב-יפו', 32.085, 34.781],
  ];
  const round2 = (n) => Math.round(n * 100) / 100; // ~1 km: enough for distances, kinder to privacy
  function haversineKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  /** Straight-line km from my location, or null when either end is unknown. */
  const distKm = (e) => {
    const d = e.details;
    if (!state.home || !(d?.lat && d?.lng)) return null;
    return haversineKm(state.home, { lat: d.lat, lng: d.lng });
  };
  const fmtKm = (km) => (km < 10 ? km.toFixed(1) : Math.round(km)) + ' ק"מ';
  /** " (26 ק"מ)" after a place name; empty when the distance is unknown. */
  /** Hue for a distance: green (120) when close, through yellow and orange, to red (0) from 150 km. */
  const distHue = (km) => Math.round(120 * (1 - Math.min(km, 150) / 150));
  const distParen = (e) => {
    const km = distKm(e);
    return km === null ? '' : ` <span class="dist" style="--dh:${distHue(km)}"><span class="dist-dot" aria-hidden="true"></span>${fmtKm(km)} ממך<span class="sr-only"> בקו אווירי</span></span>`;
  };

  function loadHome() {
    const h = store.get('home', null);
    state.home = h && Number.isFinite(h.lat) && Number.isFinite(h.lng) ? h : null;
  }
  function renderHomePref() {
    const sel = $('#homeCity');
    sel.innerHTML = `<option value="">בחירת יישוב…</option>${CITIES.map(([n]) => `<option${state.home?.label === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}`;
    $('#homeNow').textContent = state.home ? `המיקום שלך: ${state.home.label}` : 'לא נקבע מיקום';
    $('#homeClear').hidden = !state.home;
    $('#distField').hidden = !state.home;
  }
  function setHome(h) {
    state.home = h;
    store.set('home', h);
    renderHomePref();
    if (!h) { state.filter.maxKm = 0; $('#maxKm').value = ''; }
    if (state.events.length) { renderTop4(); renderList(); }
    if (location.hash.startsWith('#event/')) showEvent(decodeURIComponent(location.hash.slice(7)));
  }
  function initHome() {
    loadHome();
    renderHomePref();
    $('#homeCity').addEventListener('change', (ev) => {
      const c = CITIES.find(([n]) => n === ev.target.value);
      if (c) { setHome({ lat: c[1], lng: c[2], label: c[0] }); toast(`המיקום שלך: ${c[0]}`); }
    });
    $('#homeGeo').addEventListener('click', () => {
      if (!navigator.geolocation) { toast('הדפדפן לא תומך באיתור מיקום'); return; }
      $('#homeNow').textContent = 'מאתר מיקום…';
      navigator.geolocation.getCurrentPosition(
        (pos) => { setHome({ lat: round2(pos.coords.latitude), lng: round2(pos.coords.longitude), label: 'המיקום הנוכחי' }); toast('המיקום נשמר'); },
        () => { renderHomePref(); toast('לא ניתן לאתר מיקום. אפשר לבחור יישוב מהרשימה.'); },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
      );
    });
    $('#homeClear').addEventListener('click', () => { setHome(null); toast('המיקום נמחק'); });
    $('#maxKm').addEventListener('change', (ev) => { state.filter.maxKm = +ev.target.value || 0; renderList(); });
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
    fallback = fallback && fallback !== primary ? fallback : (club?.logoAlt && club.logoAlt !== primary ? club.logoAlt : '');
    if (!primary) return '';
    const alt = fallback && fallback !== primary ? ` data-fallback="${esc(fallback)}"` : '';
    return `<span class="club-logo ${cls}" aria-hidden="true"><img src="${esc(primary)}" alt="" loading="lazy"${alt} onerror="nivutLogoFail(this)"></span>`;
  }
  window.nivutLogoFail = (img) => {
    const next = img.dataset.fallback;
    // No logo at all: remove the whole logo element (no placeholder).
    if (next) { img.removeAttribute('data-fallback'); img.src = next; } else (img.closest('.club-logo, .hud-logo') || img).remove();
  };
  const eventClubId = (e) => e.clubId || e.details?.club?.id || clubByName(e.clubName || '')?.id || '';
  /** Large faded club logo for the card's left edge; vanishes if no image loads. */
  function watermarkHtml(e) {
    const club = clubOf(eventClubId(e)) || clubByName(e.clubName || '');
    const primary = club?.logo || e.details?.club?.pageLogo || '';
    if (!primary) return '';
    const alt = [e.details?.club?.pageLogo, club?.logoAlt].find((x) => x && x !== primary) || '';
    return `<span class="hud-logo" aria-hidden="true"><img src="${esc(primary)}" alt="" loading="lazy"${alt ? ` data-fallback="${esc(alt)}"` : ''} onerror="nivutLogoFail(this)"></span>`;
  }
  const eventLogo = (e, cls) => logoHtml({ id: eventClubId(e), name: e.clubName, fallback: e.details?.club?.pageLogo }, cls);
  const isMine = (e) => !!state.myClub && eventClubId(e) === state.myClub;
  const isLeague = (e) => (e.tags || []).includes('league');
  const mineBadge = (e) => (isMine(e) ? '<span class="pill mine-pill">⚑<span class="mine-tx"> המועדון שלי</span></span>' : '');
  /** League / championship, under the date on the ticket card's stub. */
  // Championship, sprint and relay only when the description ("מידע נוסף") says so; the event's name does not count.
  const ownText = (e) => [...(e.details?.description || []), e.calDesc || ''].join(' ');
  const kindBadges = (e) => {
    const t = ownText(e);
    const kinds = [
      isLeague(e) && ['league', 'ליגה'],
      // championship: only what the events calendar's description says
      /אליפו?ת/.test(e.calDesc || '') && ['champ', 'אליפות'],
      /ספרינט|מאוץ/.test(t) && ['sprint', 'ספרינט'],
      /שליחים/.test(t) && ['relay', 'שליחים'],
    ].filter(Boolean);
    return kinds.length ? `<div class="tk-kind">${kinds.map(([k, label]) => `<span class="tk-kind-${k}">${label}</span>`).join('')}</div>` : '';
  };
  const leagueBadge = (e) => (isLeague(e) ? '<span class="pill league-pill">ליגה</span>' : '');

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
    state.regIds = null;
    renderRegFilter();
    if (rk.data) { rememberStars(rk.data); renderRkCategories(); renderRanking(); }
    if (state.filter.registered) findRegistered().then(() => { renderTop4(); renderList(); });
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
  /** My people who are on the list, earliest start first. */
  const registeredPeople = (list) => state.people.map((name) => (list || []).find((p) => sameName(name, p.name))).filter(Boolean)
    .filter((p, i, arr) => arr.indexOf(p) === i)
    .sort((a, b) => (a.start || '99:99').localeCompare(b.start || '99:99'));
  const matchesIn = (list) => state.people.map((name) => ({ name, hit: (list || []).find((p) => sameName(name, p.name)) }));

  /**
   * My registrations on the event page: compact at the top (#regMine: names and start times),
   * full in the registration section (#myPeople: list size, and each of my people with club, category, course).
   */
  async function renderMyPeople(id) {
    const box = $('#myPeople'), mine = $('#regMine');
    const e = state.events.find((x) => x.id === id);
    if (!e || (!box && !mine)) return;
    const set = (el, html) => { if (el) el.innerHTML = html; };
    const listLink = (n) => `<a href="${esc(startListUrl(e))}" target="_blank" rel="noopener">${n ? `${n} משתתפים` : 'לרשימה באתר האיגוד'} ↗</a>`;
    const head = '<h3>משתתפים</h3>';
    if (!state.people.length) {
      set(mine, '');
      set(box, `${head}<p class="muted small">${listLink(0)}</p>`);
    } else {
      set(mine, '');
      set(box, `${head}<p class="muted small" role="status">בודק את רשימת המשתתפים…</p>`);
    }
    const data = await participantsOf(e);
    const box2 = $('#myPeople'), mine2 = $('#regMine');
    if (!data || data.error || !data.participants?.length) {
      set(mine2, '');
      set(box2, `${head}<p class="muted small">${data && !data.error ? 'רשימת המשתתפים ריקה, או שלא הצלחנו לקרוא אותה.' : 'לא ניתן לקרוא כרגע את רשימת המשתתפים.'} ${listLink(0)}</p>
        ${data?.diag ? `<details class="diag"><summary>פרטים טכניים</summary><pre dir="ltr">${esc(JSON.stringify(data.diag, null, 2))}</pre></details>` : ''}`);
      return;
    }
    const yes = state.people.length ? registeredPeople(data.participants) : [];
    // Registered: the top box shows my registrations instead of the countdown and the register button.
    $('#ev-reg')?.classList.toggle('is-registered', yes.length > 0);
    if (state.people.length) {
      set(mine2, yes.length
        ? `<span class="reg-mine-k"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.4l-6.1 3.4 1.4-6.8-5.1-4.7 6.9-.8z"/></svg>ההרשמות שלי</span>
          <ul>${yes.map((p) => `<li><strong>${esc(p.name)}</strong>${p.start ? ` <span class="pstart">${esc(p.start)}</span>` : ''}</li>`).join('')}</ul>`
        : '');
    }
    set(box2, `${head}<p class="muted small">ברשימה כרגע ${listLink(data.count)}</p>
      ${state.people.length ? `<h4>האנשים שלי</h4>${yes.length ? `<ul class="mypl">
        ${yes.map((hit) => `<li class="in"><span class="mark" aria-hidden="true">✓</span><div>
          <span class="mypl-line"><strong>${esc(hit.name)}</strong>${hit.start ? `<span class="pstart">זינוק ${esc(hit.start)}</span>` : ''}</span>
          <span class="muted small">${[hit.club, hit.category, hit.course].filter(Boolean).map(esc).join(' · ')}</span></div></li>`).join('')}
      </ul>` : '<p class="muted small">אף אחד מהאנשים שלך עדיין לא רשום.</p>'}` : ''}
      <p class="muted small"><button type="button" class="linklike" data-open-people>${state.people.length ? 'עריכת האנשים שלי' : 'הוספת האנשים שלי'}</button></p>`);
  }

  /** "👥 registered: …" line on the top cards. */
  /** Gold star with the number of my registered people; the tooltip lists them with start times. */
  function peopleStarHtml(hits) {
    const lines = hits.map((p) => `${p.name}${p.start ? ` · זינוק ${p.start}` : ''}`);
    const label = `${hits.length === 1 ? 'אחד מהאנשים שלך רשום' : `${hits.length} מהאנשים שלך רשומים`}: ${lines.join(', ')}`;
    return `<button type="button" class="ppl-star" data-tip="${esc(['רשומים:', ...hits.map((p) => `${p.name}\t${(p.start || '').replace(/^0(?=\d:)/, '')}`)].join('\n'))}" aria-label="${esc(label)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.4l-6.1 3.4 1.4-6.8-5.1-4.7 6.9-.8z"/></svg>
      <span class="n" aria-hidden="true">${hits.length}</span></button>`;
  }

  /* One floating tooltip for [data-tip] (outside the cards, so it is never clipped). */
  function initTooltip() {
    const tip = $('#tip');
    let owner = null;
    let shownAt = 0;
    const show = (el) => {
      if (owner !== el) shownAt = Date.now();
      owner = el;
      // rich tooltips (built by us from escaped values) carry their own markup; the rest are "name\tvalue" lines
      tip.classList.toggle('tip-wide', !!el.dataset.tipHtml);
      tip.innerHTML = el.dataset.tipHtml || el.dataset.tip.split('\n').map((l) => {
        const [name, time] = l.split('\t');
        if (time === undefined && name.endsWith(':')) return `<span class="tip-head">${esc(name)}</span>`;
        return `<span class="tip-row"><span>${esc(name)}</span>${time ? `<b>${esc(time)}</b>` : ''}</span>`;
      }).join('');
      tip.hidden = false;
      const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
      const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
      const below = r.bottom + 8 + t.height < innerHeight;
      tip.style.left = `${left}px`;
      tip.style.top = `${below ? r.bottom + 8 : r.top - t.height - 8}px`;
      tip.dataset.side = below ? 'below' : 'above';
    };
    const hide = () => { tip.hidden = true; owner = null; };
    document.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-tip]'); if (el && el !== owner) show(el); else if (!el && owner && !owner.matches(':focus')) hide(); });
    document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el) show(el); else if (owner) hide(); });
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-tip]');
      // A tap focuses (which shows the tip) and then clicks: only a later click on the same star closes it.
      if (el) { e.preventDefault(); e.stopPropagation(); if (owner === el && !tip.hidden && Date.now() - shownAt > 400) hide(); else show(el); }
      else if (owner) hide();
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && owner) hide(); });
    addEventListener('scroll', () => owner && hide(), { passive: true });
  }

  /** Marks my registered people on the home page cards (top four and the list). */
  function decorateTopPeople() {
    if (!state.people.length) return;
    const cards = $$('.top-card').map((c) => [c, decodeURIComponent(c.querySelector('[href^="#event/"]')?.getAttribute('href').slice(7) || '')]);
    for (const id of new Set(cards.map(([, id]) => id))) {
      const e = state.events.find((x) => x.id === id);
      if (!e?.nivutId) continue;
      participantsOf(e).then((data) => {
        const hits = registeredPeople(data?.participants);
        if (!hits.length) return;
        cards.filter(([c, cid]) => cid === id && c.isConnected && !c.querySelector('.ppl-star')).forEach(([c]) => {
          c.classList.add('has-people', 'is-registered');
          (c.querySelector('.tk-star') || c.querySelector('.top-bar'))?.insertAdjacentHTML('afterbegin', peopleStarHtml(hits));
        });
      });
    }
  }

  /* ---------- Early-registration countdown ---------- */
  const regDeadline = (e) => (e.details?.registrationDeadline ? parseDate(e.details.registrationDeadline) : null);

  /** Live countdown markup; refreshed by tickCountdowns(). */
  function countdownHtml(until, size = '') {
    // Cards show one unit only: days, or hours on the last day, or minutes in the last hour.
    return `<div class="cd ${size}" data-until="${until.toISOString()}"${size === 'cd-card' ? ' data-one="1"' : ''} role="timer"></div>`;
  }
  function tickCountdowns() {
    const now = Date.now();
    $$('.cd[data-until]').forEach((el) => {
      const ms = new Date(el.dataset.until) - now;
      if (ms <= 0) { el.innerHTML = '<span class="cd-done">ההרשמה המוקדמת נסגרה</span>'; el.removeAttribute('aria-label'); return; }
      el.setAttribute('aria-label', `ההרשמה המוקדמת נסגרת בעוד ${spokenCountdown(ms)}`);
      el.classList.toggle('urgent', ms < 864e5); // the last day: the chip pulses
      const parts = el.dataset.one ? [oneUnit(ms)] : countdownParts(ms);
      el.innerHTML = parts.map(([n, l]) => `<div aria-hidden="true"><strong>${n}</strong><span>${l}</span></div>`).join('');
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

  /** Registration status; with a countdown, the register button (cta) sits inside it. */
  function regBlock(e, size, cta = '') {
    const dl = regDeadline(e);
    if (e.source === 'closed-area') return '<p class="reg-line reg-soon"><span aria-hidden="true">⏳</span> הרשמה טרם נפתחה</p>';
    if (!dl) return ''; // no early-registration date: the card shows just the register button
    if (dl <= new Date()) return `<p class="reg-line reg-closed"><span aria-hidden="true">🔒</span> ההרשמה המוקדמת נסגרה${e.details.onsite ? ' · <strong>אפשר להירשם במקום</strong>' : ''}</p>`;
    const label = size === 'cd-card' ? 'הרשמה מוקדמת עוד' : 'הרשמה מוקדמת נסגרת בעוד';
    return `<div class="reg-cd${cta ? ' has-cta' : ''}"><div class="reg-cd-main"><p class="reg-cd-label">${label}</p>${countdownHtml(dl, size)}</div>${cta}</div>`;
  }

  /* ---------- Event page (#event/<id>) ---------- */
  const toMin = (t) => { const m = /(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const shekel = (s) => { const m = /(\d+(?:\.\d+)?)\s*(?:שח|ש"ח|₪)/.exec(s || ''); return m ? m[1] : null; };
  const phoneLink = (s) => esc(s).replace(/(0\d{1,2}-?\d{3}-?\d{4}|05\d-?\d{7})/g, (p) => `<a href="tel:${p.replace(/-/g, '')}">${p}</a>`);

  /** The single largest unit: "3 ימים", or "5 שעות" on the last day, or "12 דקות" in the last hour. */
  function oneUnit(ms) {
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5), m = Math.max(1, Math.floor(ms / 6e4));
    if (d >= 1) return [d, d === 1 ? 'יום' : 'ימים'];
    if (h >= 1) return [h, h === 1 ? 'שעה' : 'שעות'];
    return [m, m === 1 ? 'דקה' : 'דקות'];
  }
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
    if (noSiteRegistration(e)) {
      return { state: 'none', title: 'אין הרשמה באתר', text: 'פרטים במידע הנוסף של האירוע.', cta: 'לדף האירוע' };
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

  /** Race-day diagram; mini = the card version: times only, no "now" marker. */
  function timelineHtml(d, e, { mini = false } = {}) {
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
    if (mini) {
      const said = `זינוקים ${t !== null ? `בין ${fromMin(s)} ל-${fromMin(t)}` : `מ-${fromMin(s)}`}${c !== null ? `, שעת גג ${fromMin(c)}` : ''}`;
      // Spans only: it sits inside the card's <p class="top-when">.
      return `<span class="tlm" role="img" aria-label="${said}"><span class="tlm-track" aria-hidden="true">${t !== null ? `<span class="tlm-win" style="inset-inline-start:${pos(s)};width:calc(${pos(t)} - ${pos(s)})"></span>` : ''}${c !== null ? `<span class="tlm-run" style="inset-inline-start:${pos(t ?? s)};width:calc(${pos(c)} - ${pos(t ?? s)})"></span>` : ''}${points.map((p) => `<span class="tlm-tick ${p.cls}" style="inset-inline-start:${pos(p.at)}"></span>`).join('')}</span><span class="tlm-pts" aria-hidden="true">${points.map((p) => `<time class="${p.cls}" style="inset-inline-start:${pos(p.at)}">${fromMin(p.at)}</time>`).join('')}</span></span>`;
    }
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
      <h2 id="co-h">מסלולים <span class="muted">${parsed.length}</span></h2>
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

  /* ---------- Files and results ---------- */
  const FILE_KINDS = {
    planner: { label: 'דבר המתכנן', icon: '📝' },
    starts: { label: 'זמני זינוק', icon: '⏱️' },
    results: { label: 'תוצאות', icon: '🏁' },
    analysis: { label: 'ניתוח תוצאות', icon: '📈' },
    other: { label: 'קובץ', icon: '📎' },
  };
  /** Before the event the planner's notes and start times lead; from the day itself, results and analysis. */
  function fileOrder(e) {
    const started = daysBetween(new Date(), evDate(e)) <= 0;
    return started ? ['results', 'analysis', 'starts', 'planner', 'other'] : ['planner', 'starts', 'results', 'analysis', 'other'];
  }
  /** Results and splits files on the association's hosts open in our own viewer (#results/<event>/<file>). */
  const viewable = (f) => (f.kind === 'results' || f.kind === 'analysis') && /^https?:\/\/(?:cdn\.|www\.)?nivut\.org\.il\/[^?#]*\.(?:html?|pdf)(?:[?#]|$)/i.test(f.url);
  const fileHref = (f, e) => (e && viewable(f) ? `#results/${encodeURIComponent(e.id)}/${encodeURIComponent(f.url)}` : f.url);
  const fileLink = (f, key = false, e = null) => `<a class="ev-file kind-${f.kind}${key ? ' key' : ''}" href="${esc(fileHref(f, e))}"${fileHref(f, e) === f.url ? ' target="_blank" rel="noopener"' : ''}${isImageUrl(f.url) ? ` data-lightbox="${esc(f.name)}"` : ''}>
      <span class="fi" aria-hidden="true">${FILE_KINDS[f.kind]?.icon || '📎'}</span><span class="fn">${esc(f.name)}</span>${f.kind !== 'other' && f.name !== FILE_KINDS[f.kind].label ? `<span class="fk">${FILE_KINDS[f.kind].label}</span>` : ''}</a>`;
  /**
   * A run of files named "<prefix>-<category>" (LapCombat-Long, LapCombat-MediumA, …) is one row with a category picker.
   * The last category picked for that prefix is remembered.
   */
  function groupFiles(files) {
    const prefixOf = (f) => /^(.{2,40}?)\s*[-–_:]\s*(\S.{0,40})$/.exec(f.name.trim());
    const count = new Map();
    files.forEach((f) => { const m = prefixOf(f); if (m) count.set(`${f.kind}|${m[1].toLowerCase()}`, (count.get(`${f.kind}|${m[1].toLowerCase()}`) || 0) + 1); });
    const out = [], seen = new Map();
    for (const f of files) {
      const m = prefixOf(f), key = m && `${f.kind}|${m[1].toLowerCase()}`;
      if (!m || count.get(key) < 3) { out.push(f); continue; }
      if (!seen.has(key)) { const g = { group: true, kind: f.kind, prefix: m[1], items: [] }; seen.set(key, g); out.push(g); }
      seen.get(key).items.push({ label: m[2], f });
    }
    return out;
  }
  /** A group of files: one link to its page, where the category is chosen. */
  const groupHref = (g, e) => `#results/${encodeURIComponent(e?.id || '')}/group:${encodeURIComponent(g.prefix)}`;
  const fileGroupHtml = (g, key, e) => `<a class="ev-file file-group kind-${g.kind}${key ? ' key' : ''}" href="${esc(groupHref(g, e))}">
      <span class="fi" aria-hidden="true">${FILE_KINDS[g.kind]?.icon || '📎'}</span><span class="fn">${esc(g.prefix)}</span>
      <span class="fg-count">${g.items.length} קטגוריות</span><span class="fk">${FILE_KINDS[g.kind]?.label || ''}</span></a>`;
  const filesListHtml = (files, keyOf, e) => groupFiles(files).map((x) => `<li>${x.group ? fileGroupHtml(x, keyOf(x), e) : fileLink(x, keyOf(x), e)}</li>`).join('');

  function filesHtml(e) {
    const files = e.details?.attachments || [];
    if (!files.length) return '';
    const order = fileOrder(e);
    const sorted = [...files].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    const lead = order.slice(0, 2); // what matters now
    return `<section class="ev-card ev-files-card" id="ev-files" aria-labelledby="fl-h"><h2 id="fl-h">קבצים ונספחים</h2>
      <ul class="ev-files">${filesListHtml(sorted, (x) => lead.includes(x.kind), e)}</ul></section>`;
  }

  /** Home page: the three latest events (today included), with only their results and results analysis. */
  async function renderRecentResults() {
    const box = $('#recentResults');
    const end = startOfDay(new Date()); end.setDate(end.getDate() + 1);
    const recent = state.events.filter((e) => e.nivutId && e.source !== 'closed-area' && !isClosedEvent(e) && parseDate(e.date) < end)
      .sort((a, b) => evDate(b) - evDate(a)).slice(0, 3);
    if (!recent.length) { box.hidden = true; return; }
    await Promise.all(recent.filter((e) => !e.details).map((e) => loadJson(`api/event?id=${encodeURIComponent(e.nivutId)}`)
      .then((d) => applyDetails(e, d)).catch(() => {})));
    box.hidden = false;
    $('#rrList').innerHTML = recent.map((e) => {
      const d = evDate(e);
      const files = (e.details?.attachments || []).filter((f) => f.kind === 'results' || f.kind === 'analysis')
        .sort((a, b) => (a.kind === 'results' ? 0 : 1) - (b.kind === 'results' ? 0 : 1));
      return `<li class="rr-card" style="--c:${disc(e).color}">
        <div class="rr-date" aria-hidden="true"><span class="day">${d.getDate()}</span><span class="mon">${MONTHS[d.getMonth()]}</span></div>
        <div class="rr-main">
          <h3><a href="#event/${encodeURIComponent(e.id)}" title="${esc(e.title)}">${esc(e.title)}</a></h3>
          <p class="sr-only">${fmtLong(d)}</p>
          ${files.length ? `<ul class="rr-files">${filesListHtml(files, () => true, e)}</ul>`
            : `<p class="muted small">${daysBetween(new Date(), d) === 0 ? 'האירוע מתקיים היום – התוצאות יופיעו כאן' : 'התוצאות טרם פורסמו'}</p>`}
        </div></li>`;
    }).join('');
  }

  /** Top of the event page: just the countdown, the register button and my registrations. */
  function regTopHtml(e, reg) {
    const dl = reg.deadline;
    const open = reg.state === 'open';
    return `<li class="fact-reg reg-${reg.state}" id="ev-reg"><span class="ev-ico" aria-hidden="true">${open ? '✍️' : reg.state === 'past' ? '🏁' : reg.state === 'none' ? 'ℹ️' : '⏳'}</span><span class="k">הרשמה</span>
      ${e.nivutId && reg.state !== 'none' ? '<div class="reg-mine" id="regMine" aria-live="polite"></div>' : ''}
      ${open && dl ? `<div class="reg-when"><span class="reg-cd-label">הרשמה מוקדמת נסגרת בעוד</span>${countdownHtml(dl, 'cd-reg')}</div>` : `<strong>${esc(reg.title)}</strong>`}
      <div class="reg-actions">
        ${open ? `<a class="btn btn-xl" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(reg.cta)} ↗</a>` : ''}
        <button type="button" class="linklike" data-scroll="ev-reg-full">${reg.state === 'none' ? 'פרטים' : 'כל פרטי ההרשמה'} ↓</button>
      </div>
</li>`;
  }

  /** Lower on the page: every registration detail – deadline, prices, on-site, participants and my people. */
  function regFullHtml(e, reg) {
    const d = e.details || {};
    const price = shekel(d.price), priceOut = shekel(d.priceNonMember);
    const dl = reg.deadline;
    const rows = [
      reg.state === 'open' && dl && ['הרשמה מוקדמת עד', `יום ${DAYS[dl.getDay()]} ${dl.getDate()}.${dl.getMonth() + 1}${d.registrationDeadline.length > 10 ? ` בשעה ${esc(d.registrationDeadline.slice(11, 16))}` : ''}`],
      reg.state !== 'none' && (price || d.price) && ['חברי איגוד', price ? `<b>${price} ₪</b>` : esc(d.price)],
      reg.state !== 'none' && priceOut && ['שאינם חברי איגוד', `<b>${priceOut} ₪</b>`],
      reg.state !== 'none' && d.onsite && ['הרשמה במקום', esc(d.onsite)],
    ].filter(Boolean);
    return `<section class="ev-card ev-reg-full reg-${reg.state}" id="ev-reg-full" aria-labelledby="rgf-h"><h2 id="rgf-h" tabindex="-1">הרשמה</h2>
      <p class="reg-status"><strong>${esc(reg.title)}</strong>${reg.text && !(reg.state === 'open' && dl) ? ` · ${esc(reg.text)}` : ''}</p>
      ${rows.length ? `<dl class="reg-rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
      ${reg.state === 'none' && moreInfo(e).length ? '<button type="button" class="btn ghost" data-scroll="ev-info">למידע הנוסף</button>' : ''}
      ${e.nivutId && reg.state !== 'none' ? '<div class="reg-people" id="myPeople" aria-live="polite"></div>' : ''}
      ${reg.state !== 'none' ? `<div class="ev-actions"><a class="btn${reg.state === 'open' ? '' : ' ghost'}" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(reg.cta)} ↗</a></div>` : ''}
    </section>`;
  }

  function eventPageHtml(e) {
    const d = e.details || {};
    const date = evDate(e);
    const now = new Date();
    const left = daysBetween(now, date);
    const reg = registration(e);
    const dc = disc(e);
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
            <button type="button" class="ev-share" data-share="${esc(e.id)}">🔗 שיתוף</button>
          </div>
        </div>
      </div>
      <svg class="ev-contours" viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.2">
        <path d="M-20 160 C60 120 120 180 200 140 S340 90 420 130"/><path d="M-20 130 C70 90 130 150 210 110 S330 60 420 100"/>
        <path d="M-20 100 C80 60 140 120 220 80 S320 30 420 70"/><path d="M-20 70 C90 30 150 90 230 50 S310 0 420 40"/></g></svg>
    </header>

    <div class="container ev-body">
      <ul class="ev-facts ev-facts3" aria-label="עיקרי האירוע">
        <li class="fact-when"><span class="ev-ico" aria-hidden="true">🕘</span><span class="k">מתי</span>
          <strong class="when-top">${DAYS[date.getDay()]} ${date.getDate()}.${date.getMonth() + 1}${left >= 0 ? ` <span class="when-in">${inDays(left)}</span>` : ''}</strong>
          ${tl || (e.time ? `<span>זינוק ראשון ${esc(e.time)}</span>` : '')}</li>
        <li><span class="ev-ico" aria-hidden="true">📍</span><span class="k">איפה</span>
          <strong>${esc(e.location || d.name || 'יפורסם')}${distParen(e)}</strong>
          ${!state.home && d.lat ? '<button type="button" class="linklike dist-set" data-open-people>📍 קבעו מיקום כדי לראות מרחק</button>' : ''}
          ${wazeLink(e, 'ניווט לכינוס ב-Waze', 'waze-lg') || '<span>&nbsp;</span>'}</li>
        ${regTopHtml(e, reg)}
      </ul>

      <div class="ev-grid">
        <div class="ev-main">
          ${loading ? '<section class="ev-card" role="status"><p class="muted">טוען את פרטי התחרות מאתר האיגוד…</p></section>' : ''}
          ${moreInfo(e).length ? `<section class="ev-card ev-info" id="ev-info" aria-labelledby="ab-h"><h2 id="ab-h" tabindex="-1">מידע נוסף</h2>
            ${moreInfo(e).map((p) => `<p>${linkify(p)}</p>`).join('')}</section>` : ''}
          ${filesHtml(e)}
          ${regFullHtml(e, reg)}
          ${coursesHtml(d.courses)}
          ${hasGeo || d.directions?.length ? `<section class="ev-card" aria-labelledby="go-h"><h2 id="go-h">איך מגיעים</h2>
            ${hasGeo ? `<iframe class="ev-osm" title="מפת נקודת הכינוס של ${esc(e.title)}" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${d.lat},${d.lng}"></iframe>` : ''}
            ${(d.directions || []).map((p) => `<p>${linkify(p)}</p>`).join('')}
            <div class="ev-actions">${canNavigate(e) ? `${wazeLink(e, 'ניווט ב-Waze', 'waze-lg')}<a class="btn ghost" href="${esc(mapsUrl(e))}" target="_blank" rel="noopener">Google Maps</a>` : ''}</div>
          </section>` : ''}
        </div>

        <aside class="ev-side" aria-label="פרטים נוספים">


          ${d.map ? `<section class="ev-card" aria-labelledby="mp-h"><h2 id="mp-h">מפת הניווט</h2>
            ${d.map.image ? `<a class="ev-mapimg" href="${esc(d.map.image)}" target="_blank" rel="noopener" data-lightbox="${esc(`מפת ${d.map.name}`)}"><img src="${esc(d.map.image)}" alt="תצוגה מקדימה של מפת ${esc(d.map.name)}" loading="lazy" onerror="this.parentNode.remove()"></a>` : ''}
            <p><strong>${d.map.url ? `<a href="${esc(d.map.url)}" target="_blank" rel="noopener">${esc(d.map.name)}</a>` : esc(d.map.name)}</strong></p>
            <ul class="chips-static">${[d.map.terrain && `שטח ${d.map.terrain}`, d.map.scale && `קנ"מ ${d.map.scale}`, d.map.year && `מופה ${d.map.year}`].filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          </section>` : ''}

          ${d.club || d.planner || d.director || d.contact ? `<section class="ev-card" aria-labelledby="pp-h"><h2 id="pp-h">מי מארגן</h2><dl class="ev-people">
            ${d.club ? `<dt>מועדון</dt><dd class="club-dd">${eventLogo(e, 'cl-md')}${d.club.url ? `<a href="${esc(d.club.url)}" target="_blank" rel="noopener">${esc(d.club.name)}</a>` : esc(d.club.name)}${isMine(e) ? ' <span class="pill mine-pill">⚑ המועדון שלי</span>' : ''}</dd>` : ''}
            ${d.director ? `<dt>ניהול</dt><dd>${esc(d.director)}</dd>` : ''}
            ${d.planner ? `<dt>תכנון מסלולים</dt><dd>${esc(d.planner)}</dd>` : ''}
            ${d.contact ? `<dt>יצירת קשר</dt><dd>${phoneLink(d.contact)}</dd>` : ''}
          </dl></section>` : ''}


          ${threads.length ? `<section class="ev-card" aria-labelledby="fr-h"><h2 id="fr-h">מדברים על זה בפורום</h2><ul class="ev-threads">
            ${threads.map((t) => `<li><a href="#forum/${esc(t.id)}">${esc(t.title)}</a><span class="muted small">${esc(t.author)} · ${t.replyCount} תגובות · ${relTime(t.lastActivity)}</span></li>`).join('')}</ul></section>` : ''}
        </aside>
      </div>
    </div>

    <nav class="ev-dock" aria-label="פעולות מהירות">
      <a class="dock-main" href="${esc(e.url)}" target="_blank" rel="noopener">${reg.state === 'open' ? 'להרשמה' : 'לאתר האיגוד'}</a>
      ${canNavigate(e) ? `<a class="dock-waze" href="${esc(wazeUrl(e))}" target="_blank" rel="noopener" aria-label="ניווט ב-Waze">${wazeIcon}</a>` : ''}
      <button type="button" data-share="${esc(e.id)}" aria-label="שיתוף">🔗</button>
    </nav>`;
  }

  /** An event page loaded in the browser fills the card fields, like the server does for home-page events. */
  function applyDetails(e, d) {
    e.details = d;
    if (!d) return;
    if (d.startFrom && d.startFrom !== '00:00' && !e.time) e.time = d.startFrom;
    e.location = e.location || d.map?.name?.replace(/\s*\[[^\]]*\]\s*$/, '') || d.name || '';
    e.clubName = e.clubName || d.club?.name || '';
    e.clubId = e.clubId || d.club?.id || '';
    e.eventType = e.eventType || d.eventType || '';
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
    const goto = state.gotoSection; // e.g. "ev-info" from a card's "מידע נוסף"
    state.gotoSection = null;
    box.innerHTML = eventPageHtml(e);
    tickCountdowns();
    renderMyPeople(id);
    $('#evTitle')?.focus({ preventScroll: true });
    gotoSection(goto);
    if (!e.details && e.nivutId) {
      try {
        applyDetails(e, await loadJson(`api/event?id=${encodeURIComponent(e.nivutId)}`));
      } catch { e.details = null; e.nivutId = null; }
      if (location.hash === `#event/${id}`) { box.innerHTML = eventPageHtml(e); tickCountdowns(); renderMyPeople(id); gotoSection(goto); }
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
    const shareBtn = ev.target.closest('[data-share]');
    if (shareBtn) {
      const e = state.events.find((x) => x.id === shareBtn.dataset.share);
      if (e) shareEvent(e);
    }
  });

  /* ---------- Image lightbox (attached images open here, not as downloads) ---------- */
  const isImageUrl = (u) => /\.(?:jpe?g|png|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(u || '');
  const lightbox = { items: [], i: 0, opener: null };
  function showLightbox() {
    const it = lightbox.items[lightbox.i];
    const img = $('#lbImg');
    img.removeAttribute('src');
    img.alt = it.caption;
    img.src = it.src;
    $('#lbCaption').textContent = it.caption;
    const many = lightbox.items.length > 1;
    $('#lbNav').hidden = !many;
    $('#lbCount').textContent = many ? `${lightbox.i + 1} / ${lightbox.items.length}` : '';
  }
  function openLightbox(link) {
    const group = link.closest('.msg-images, .ev-files, .ev-card, .thread') || link.parentElement;
    const links = [...group.querySelectorAll('a[data-lightbox]')];
    lightbox.items = links.map((a) => ({ src: a.href, caption: a.dataset.lightbox || '' }));
    lightbox.i = Math.max(0, links.indexOf(link));
    lightbox.opener = link;
    showLightbox();
    const dlg = $('#lightbox');
    if (!dlg.open) dlg.showModal();
    $('#lbClose').focus();
  }
  function stepLightbox(n) {
    if (lightbox.items.length < 2) return;
    lightbox.i = (lightbox.i + n + lightbox.items.length) % lightbox.items.length;
    showLightbox();
  }
  function initLightbox() {
    const dlg = $('#lightbox');
    document.addEventListener('click', (ev) => {
      const a = ev.target.closest('a[data-lightbox]');
      if (!a || ev.ctrlKey || ev.metaKey || ev.shiftKey) return; // modified clicks keep the browser's behaviour
      ev.preventDefault();
      openLightbox(a);
    });
    $('#lbPrev').addEventListener('click', () => stepLightbox(-1));
    $('#lbNext').addEventListener('click', () => stepLightbox(1));
    dlg.addEventListener('keydown', (ev) => {
      // RTL: the left arrow moves forward
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); stepLightbox(1); }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); stepLightbox(-1); }
    });
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); }); // backdrop
    dlg.addEventListener('close', () => { $('#lbImg').removeAttribute('src'); if (lightbox.opener?.isConnected) lightbox.opener.focus(); });
    $('#lbImg').addEventListener('error', () => { $('#lbCaption').textContent = 'לא ניתן להציג את התמונה.'; });
  }

  /* ---------- Upcoming ---------- */
  /** "מידע נוסף" from the event page (falls back to the home-page blurb). */
  const moreInfo = (e) => (e.details?.description?.length ? e.details.description : e.summary ? [e.summary] : []);
  /** The additional info says registration is not on the site ("*אין הרשמה באתר", "ללא הרשמה", "אין צורך בהרשמה"). */
  // Hidden when the organisers wrote "אין הרשמה באתר" in "מידע נוסף", or "אירוע סגור" there or under the name.
  // Direction marks and zero-width characters sometimes sit between the words.
  const plain = (t) => String(t || '').replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/[\s\u00a0]+/g, ' ');
  const infoText = (e) => plain((e.details?.description || []).join(' '));
  const noSiteRegistration = (e) => !!e.noSiteRegistration || /אין\s*(?:אפשרות\s*)?(?:ה)?רשמה\s*(?:ב|דרך\s*ה)אתר/.test(infoText(e));
  /** "ⓘ מידע נוסף": opens the event page at its "מידע נוסף" section. */
  const infoBtnHtml = (e) => (moreInfo(e).length
    ? `<a class="info-btn" href="#event/${encodeURIComponent(e.id)}" data-goto="ev-info" aria-label="מידע נוסף על ${esc(e.title)}"><span aria-hidden="true">i</span><span class="info-text">מידע נוסף</span></a>` : '');
  function initInfo() {
    document.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-goto]');
      if (a) state.gotoSection = a.dataset.goto;
      const b = ev.target.closest('[data-scroll]');
      if (b) gotoSection(b.dataset.scroll);
    });
  }
  /** After the event page renders: jump to the section a card link asked for. */
  function gotoSection(id) {
    const el = id && document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    el.querySelector('h2')?.focus({ preventScroll: true });
  }

  /** Has an event page on the association site, where you register (closed areas and calendar-only items do not). */
  /** "אירוע סגור" (a private event) in the title, category, the event-page note ("- אירוע סגור -") or additional info. */
  /** "אירוע סגור" in "מידע נוסף" or in the line under the event name (category / note). */
  // Navigation trips abroad ("ניווט חו"ל") are not events here either.
  const isAbroad = (e) => /חו["״׳']ל/.test(`${e.title} ${e.homeTitle || ''}`);
  const isClosedEvent = (e) => !!e.closed || isAbroad(e)
    || /(?:אירוע|ארוע)\s*סגור/.test(`${infoText(e)} ${plain(e.details?.note)} ${plain(e.details?.eventType)}`);
  const hasRegistration = (e) => !!e.nivutId && e.source !== 'closed-area' && !noSiteRegistration(e) && !isClosedEvent(e);
  /** Upcoming events you can register for; the annual plan shows everything except closed events. */
  function upcoming() {
    const today = startOfDay(new Date());
    return state.events.filter((e) => hasRegistration(e) && parseDate(e.date) >= today);
  }

  /** The saved discipline filter; events of any selected discipline pass. */
  /** Quick filter: only events where my people are registered (state.regIds is filled on demand). */
  const regOk = (e) => !state.filter.registered || !!state.regIds?.has(e.id);
  async function findRegistered() {
    const ids = new Set();
    await Promise.all(upcoming().filter((e) => e.nivutId).map((e) => participantsOf(e)
      .then((data) => { if (registeredPeople(data?.participants).length) ids.add(e.id); })));
    state.regIds = ids;
  }
  function renderRegFilter() {
    const b = $('#regFilter');
    b.hidden = !state.people.length;
    if (!state.people.length) state.filter.registered = false;
    b.setAttribute('aria-pressed', String(state.filter.registered));
  }
  function initRegFilter() {
    renderRegFilter();
    $('#regFilter').addEventListener('click', async () => {
      const b = $('#regFilter');
      state.filter.registered = !state.filter.registered;
      renderRegFilter();
      if (state.filter.registered && !state.regIds) {
        b.setAttribute('aria-busy', 'true');
        toast('מחפש את הניווטים שלי ברשימות המשתתפים…');
        await findRegistered();
        b.removeAttribute('aria-busy');
      }
      renderTop4(); renderList();
      const n = upcoming().filter((e) => discOk(e) && regOk(e)).length;
      toast(state.filter.registered ? (n === 1 ? 'הניווטים שלי: ניווט אחד' : n ? `הניווטים שלי: ${n} ניווטים` : 'האנשים שלי לא רשומים לאף ניווט קרוב') : 'מוצגים כל הניווטים');
    });
  }
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
    const up = upcoming().filter(discOk).filter(regOk);
    return [...up].sort((a, b) => evDate(a) - evDate(b)).slice(0, n);
  }

  /** One event card (the "HUD"): attributes and club on top, date, title, start and place, registration. */
  /**
   * One event card, a "ticket": a date stub in the discipline's colour (with the star for my people) and,
   * past the perforation, tags and club, the name, distance + Waze, the start diagram and registration.
   */
  const seenCards = new Set(); // cards whose entrance has finished
  const enterStart = new Map(); // card id -> when its entrance began
  /**
   * Staggers the entrance of the cards just drawn (capped, so a long list does not trickle in).
   * A redraw in the middle of an entrance (details arriving) continues it instead of restarting.
   */
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function staggerNew(box) {
    const now = performance.now();
    if (reducedMotion.matches) {
      $$('.top-card.is-new', box).forEach((c) => { c.classList.remove('is-new'); seenCards.add(decodeURIComponent(c.querySelector('a[href^="#event/"]')?.getAttribute('href').slice(7) || '')); });
      return;
    }
    $$('.top-card.is-new', box).forEach((c, i) => {
      const id = decodeURIComponent(c.querySelector('a[href^="#event/"]')?.getAttribute('href').slice(7) || '');
      if (!enterStart.has(id)) enterStart.set(id, { t: now, i: Math.min(i, 8) });
      const st = enterStart.get(id);
      c.style.setProperty('--i', st.i);
      c.style.setProperty('--t0', `${Math.round(now - st.t)}ms`);
      c.addEventListener('animationend', (ev) => {
        if (ev.target !== c) return;
        seenCards.add(id); enterStart.delete(id); c.classList.remove('is-new');
      });
    });
  }
  function hudCardHtml(e, { lead = false, now = new Date(), tag = 'h2' } = {}) {
    const d = evDate(e);
    const tlMini = e.details && e.source !== 'closed-area' ? timelineHtml(e.details, e, { mini: true }) : '';
    const left = daysBetween(now, d);
    const where = `${distParen(e).trim()} ${wazeLink(e)}`.trim();
    const cta = `<a class="top-cta" href="${esc(e.url)}" target="_blank" rel="noopener" aria-label="הרשמה ל${esc(e.title)} באתר האיגוד"><span class="cta-tx">הרשמה </span>↗</a>`;
    const counting = regDeadline(e) && regDeadline(e) > now;
    const reg = counting ? regBlock(e, 'cd-card', cta)
      : `${regBlock(e, 'cd-card')}${regOpen(e) ? `<p class="top-foot">${regDeadline(e) ? `<span>${inDays(left)}</span>` : ''}${cta}</p>` : ''}`;
    // A card rises in the first time it appears (load, "show more", a new filter result), not on redraws.
    const fresh = !seenCards.has(e.id);
    const enter = fresh ? ' is-new' : '';
    return `<li class="top-card tk${enter}${lead ? ' lead' : ''}${isLeague(e) ? ' is-league' : ''}${isMine(e) ? ' is-mine' : ''}" style="--c:${disc(e).color}">
        <div class="tk-stub"><div class="top-date" aria-hidden="true"><span class="dow">${DAYS[d.getDay()]}</span><span class="day">${d.getDate()}</span><span class="mon">${MONTHS[d.getMonth()]}</span></div><div class="tk-star"></div></div>
        <span class="tk-notch t" aria-hidden="true"></span><span class="tk-notch b" aria-hidden="true"></span>
        <div class="tk-body">
          ${watermarkHtml(e)}
          <div class="tk-head">${kindBadges(e)}<${tag}><a href="#event/${encodeURIComponent(e.id)}" title="${esc(e.title)}">${
            // the calendar's place and description, one line each
            e.calPlace && e.calDesc ? `<span class="tk-place">${esc(e.calPlace)}</span><span class="sr-only"> – </span><span class="tk-desc">${esc(e.calDesc)}</span>` : esc(e.title)}</a></${tag}></div>
          ${e.clubName || isMine(e) ? `<div class="tk-club">${e.clubName ? `<span class="tk-club-name">${esc(e.clubName)}</span>` : ''}${mineBadge(e)}</div>` : ''}
          <hr class="tk-sep" aria-hidden="true">
          <p class="top-when">${[!tlMini && e.time && `<strong class="start-time">זינוק ${esc(e.time)}</strong>`,
            // Phones hide the diagram in the four nearest; this short line takes its place there.
            tlMini && e.details?.startFrom && `<strong class="start-time start-alt">זינוק <bdi dir="ltr">${esc(e.details.startFrom)}${e.details.startTo ? `–${esc(e.details.startTo)}` : ''}</bdi></strong>`,
            where].filter(Boolean).join(' ')}<span class="sr-only">${e.time || where ? ', ' : ''}${fmtLong(d)}, ${esc(disc(e).label)}${e.location ? `, ${esc(e.location)}` : ''}</span></p>
          ${tlMini ? `<p class="top-tl">${tlMini}</p>` : ''}
          ${lead && e.summary ? `<p class="lead-summary">${esc(e.summary)}</p>` : ''}
          ${reg}
        </div>
      </li>`;
  }

  function renderTop4() {
    const box = $('#top4');
    const list = topEvents();
    if (!list.length) {
      box.innerHTML = `<li class="top4-loading">${state.filter.registered ? 'אין ניווטים קרובים שהאנשים שלי רשומים אליהם.' : state.filter.disciplines.size ? 'אין ניווטים קרובים מהסוגים שבחרת.' : 'אין אירועים מתוכננים כרגע.'}</li>`;
      return;
    }
    const now = new Date();
    box.innerHTML = list.map((e) => hudCardHtml(e, { now })).join('');
    box.removeAttribute('aria-busy');
    staggerNew(box);
    tickCountdowns();
    decorateTopPeople();
  }

  /* ---------- Help: a sample card with every field, explained with arrows ---------- */
  const SAMPLE_LOGO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#0b3d2e"/><path d="M50 12 62 50 50 88 38 50z" fill="#f26a1b"/><path d="M50 12 62 50H38z" fill="#fff"/><circle cx="50" cy="50" r="6" fill="#0b3d2e"/></svg>');
  const HELP_NOTES = [
    ['.top-date', 'תאריך וסוג הניווט: ירוק = רגלי, כחול = רכוב.'],
    ['.ppl-star', 'האם אני רשום, וזמני הזינוק.'],
    ['.tk-kind', 'מאפייני התחרות – ליגה, אליפות, ספרינט, שליחים.'],
    ['.tk-club-name', 'המועדון המארגן.'],
    ['.top-when .waze-link', 'המרחק ממך, ו־Waze לנקודת הכינוס.', 'left'],
    ['.tlm', 'זינוק ראשון, זינוק אחרון ושעת גג.', 'left'],
    ['.reg-cd', 'הרשמה: הזמן שנשאר להרשמה מוקדמת. ההרשמה עצמה מתבצעת באתר הרשמי של האיגוד.'],
  ];
  function sampleEvent() {
    const day = new Date(); day.setDate(day.getDate() + 9);
    const reg = new Date(); reg.setDate(reg.getDate() + 4); reg.setHours(23, 59, 0, 0);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
      id: 'help-sample', title: 'יער בן שמן – ליגה מחזור 3', calPlace: 'יער בן שמן', calDesc: 'ליגה מחזור 3', location: 'יער בן שמן', time: '09:00', date: iso(day),
      disciplines: ['foot'], tags: ['league'], clubName: 'חבל מודיעין', clubId: 'help-sample', url: '#',
      details: { description: ['אימון לכל הרמות, מתאים גם למתחילים.'], registrationDeadline: `${iso(reg)}T23:59`, startFrom: '09:00', startTo: '11:00', cutoff: '13:30', lat: 31.95, lng: 34.93, club: { pageLogo: SAMPLE_LOGO } },
    };
  }
  function renderHelpCard() {
    // The sample shows every field, so it borrows a location just for this render.
    const saved = { home: state.home };
    state.home = state.home || { lat: 32.085, lng: 34.781 };
    try { $('#hhCard').innerHTML = hudCardHtml(sampleEvent(), { tag: 'h3' }); } finally { Object.assign(state, saved); }
    $('#hhCard .tk-star').insertAdjacentHTML('afterbegin', peopleStarHtml([{ name: 'נועה כהן', start: '09:12' }, { name: 'דני לוי', start: '09:40' }]));
    tickCountdowns();
    const card = $('#hhCard .top-card');
    card.classList.add('has-people');
    // the star's tooltip, shown open
    const star = $('#hhCard .ppl-star');
    $('#hhStage .hh-tip')?.remove();
    $('#hhCard').insertAdjacentHTML('afterend', `<div class="tip hh-tip" aria-hidden="true">${star.dataset.tip.split('\n').map((l) => {
      const [name, time] = l.split('\t');
      return time === undefined ? `<span class="tip-head">${esc(name)}</span>` : `<span class="tip-row"><span>${esc(name)}</span><b>${esc(time)}</b></span>`;
    }).join('')}</div>`);
    $('#hhNotes').innerHTML = HELP_NOTES.map(([sel, text, side]) => ({ el: [...card.querySelectorAll(sel)].find((x) => x.offsetWidth > 2), text, side }))
      .filter((n) => n.el && n.el.offsetWidth > 2).map((n, i) => {
        n.el.dataset.hhNum = i + 1;
        return `<li data-n="${i + 1}"${n.side ? ` data-side="${n.side}"` : ''}><span class="hh-num" aria-hidden="true">${i + 1}</span>${esc(n.text)}</li>`;
      }).join('');
    $$('#hhCard img').forEach((img) => img.addEventListener('load', layoutHelp));
    layoutHelp();
    requestAnimationFrame(layoutHelp);
  }
  /** Pins on the card; on wide screens the notes sit beside it with an arrow to each pin. */
  function layoutHelp() {
    const stage = $('#hhStage'), svg = $('#hhArrows');
    if (!stage?.isConnected || !$('#helpDialog').open) return;
    $$('.hh-pin', stage).forEach((p) => p.remove());
    const sr = stage.getBoundingClientRect();
    const wide = stage.clientWidth >= 820;
    stage.classList.toggle('wide', wide);
    const cardBox = $('#hhCard').getBoundingClientRect();
    // the open tooltip just below the star
    const hhTip = $('.hh-tip', stage), starEl = $('#hhCard .ppl-star');
    if (hhTip) hhTip.style.cssText = '';
    if (hhTip && starEl && wide) {
      const st = starEl.getBoundingClientRect();
      // under the card, beside the star (clear of the notes and their arrows)
      hhTip.style.top = `${Math.max(st.bottom, cardBox.bottom) - sr.top + 10}px`;
      hhTip.style.left = `${Math.max(0, Math.min(st.left - sr.left - hhTip.offsetWidth - 4, stage.clientWidth - hhTip.offsetWidth))}px`;
    }
    const items = $$('#hhNotes li').map((li) => {
      const el = $(`#hhCard [data-hh-num="${li.dataset.n}"]`);
      const r = el.getBoundingClientRect();
      // The watermark logo is clipped by the card: aim at its visible part.
      const b = el.matches('.hud-logo') ? { left: Math.max(r.left, cardBox.left), right: Math.min(r.right, cardBox.right), top: Math.max(r.top, cardBox.top), bottom: Math.min(r.bottom, cardBox.bottom) } : r;
      const box = { left: b.left - sr.left, right: b.right - sr.left, top: b.top - sr.top, bottom: b.bottom - sr.top };
      if (!wide) {
        const pin = document.createElement('span');
        pin.className = 'hh-pin'; pin.textContent = li.dataset.n; pin.setAttribute('aria-hidden', 'true');
        pin.style.left = `${box.right}px`; pin.style.top = `${box.top}px`;
        stage.append(pin);
      }
      return { li, box, x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    });
    svg.innerHTML = '';
    if (!wide) { items.forEach(({ li }) => { li.style.cssText = ''; }); return; }
    const cx = (cardBox.left + cardBox.right) / 2 - sr.left;
    const colW = Math.min(250, (stage.clientWidth - cardBox.width) / 2 - 36);
    const sides = { right: [], left: [] };
    items.forEach((it) => sides[it.li.dataset.side || (it.x >= cx ? 'right' : 'left')].push(it));
    let paths = '';
    for (const [side, list] of Object.entries(sides)) {
      list.sort((a, b) => a.y - b.y);
      let bottom = -Infinity;
      for (const it of list) {
        it.li.style.width = `${colW}px`;
        it.li.style[side === 'right' ? 'right' : 'left'] = '0px';
        it.li.style[side === 'right' ? 'left' : 'right'] = 'auto';
        const h = it.li.offsetHeight;
        const top = Math.max(it.y - h / 2, bottom + 8, 0);
        it.li.style.top = `${top}px`;
        bottom = top + h;
        const lx = side === 'right' ? stage.clientWidth - colW - 6 : colW + 6;
        const ly = top + h / 2;
        const tx = side === 'right' ? it.box.right + 2 : it.box.left - 2, ty = it.y; // the element's near edge
        const mx = side === 'right' ? (cardBox.right - sr.left) + 14 : (cardBox.left - sr.left) - 14;
        paths += `<path d="M${lx} ${ly} L${mx} ${ly} L${tx} ${ty}" marker-end="url(#hhHead)"/>`;
      }
    }
    stage.style.minHeight = `${Math.max(cardBox.height, ...items.map((it) => it.li.offsetTop + it.li.offsetHeight))}px`;
    svg.setAttribute('viewBox', `0 0 ${stage.clientWidth} ${stage.clientHeight}`);
    svg.innerHTML = `<defs><marker id="hhHead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>${paths}`;
  }
  function initHelp() {
    const dlg = $('#helpDialog');
    let opener = null;
    $('#helpBtn').addEventListener('click', (e) => { opener = e.currentTarget; dlg.showModal(); renderHelpCard(); });
    dlg.addEventListener('close', () => opener?.isConnected && opener.focus());
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
    addEventListener('resize', () => dlg.open && layoutHelp());
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
      state.filter.maxKm = 0; $('#maxKm').value = '';
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

  // The saved discipline filter is a preference, not a search: it does not count here.
  const filtering = () => !!(state.filter.q || state.filter.club || state.filter.tags.size || state.filter.mine || state.filter.maxKm);

  function renderList() {
    const { q, club, disciplines, tags } = state.filter;
    const ql = q.toLowerCase();
    const active = [q, club].filter(Boolean).length + tags.size + (state.filter.mine ? 1 : 0) + (state.filter.maxKm ? 1 : 0);
    $('#filterCount').hidden = !active;
    $('#filterCount').textContent = active ? `(${active})` : '';
    const top = filtering() ? new Set() : new Set(topEvents().map((e) => e.id));
    $('#all-title').textContent = filtering() ? 'תוצאות חיפוש' : 'עוד ניווטים';
    const list = upcoming().filter((e) => !top.has(e.id)).filter((e) =>
      (!disciplines.size || (e.disciplines || []).some((k) => disciplines.has(k))) && regOk(e) &&
      (!tags.size || (e.tags || []).some((k) => tags.has(k))) &&
      (!club || e.clubName === club) &&
      (!state.filter.mine || isMine(e)) &&
      (!state.filter.maxKm || (distKm(e) !== null && distKm(e) <= state.filter.maxKm)) &&
      (!ql || [e.fullTitle, e.title, e.location, e.clubName, e.eventType, e.summary].join(' ').toLowerCase().includes(ql)));
    const noPlace = state.filter.maxKm ? upcoming().filter((e) => distKm(e) === null).length : 0;
    $('#resultCount').textContent = filtering()
      ? `${list.length} אירועים נמצאו${noPlace ? ` · ${noPlace} אירועים בלי מיקום ידוע לא נכללו` : ''}` : '';
    const el = $('#eventList');
    const more = $('#moreEvents');
    more.hidden = true;
    if (!list.length) { el.innerHTML = '<li class="empty">לא נמצאו אירועים התואמים לסינון.</li>'; return; }
    // Without a search: the next two months, two more on each "show more".
    let shown = list;
    if (!filtering()) {
      const until = (n) => { const d = startOfDay(new Date()); d.setMonth(d.getMonth() + n); return d; };
      while (list.some((e) => evDate(e) >= until(state.listMonths)) && !list.some((e) => evDate(e) < until(state.listMonths))) state.listMonths += 2;
      shown = list.filter((e) => evDate(e) < until(state.listMonths));
      const rest = list.length - shown.length;
      if (rest) {
        more.hidden = false;
        more.textContent = `הצג עוד – חודשיים נוספים (${rest === 1 ? 'עוד ניווט אחד' : `עוד ${rest} ניווטים`} בהמשך)`;
      }
    }
    const now = new Date();
    let lastMonth = '';
    el.innerHTML = shown.map((e) => {
      const d = evDate(e);
      const mKey = `${d.getFullYear()}-${d.getMonth()}`;
      const sep = mKey !== lastMonth ? `<li class="month-sep" aria-hidden="true">${MONTHS[d.getMonth()]} ${d.getFullYear()}</li>` : '';
      lastMonth = mKey;
      return sep + hudCardHtml(e, { now, tag: 'h3' });
    }).join('');
    staggerNew(el);
    el.removeAttribute('aria-busy');
    tickCountdowns();
    decorateTopPeople();
  }

  function initMoreEvents() {
    $('#moreEvents').addEventListener('click', async () => {
      const btn = $('#moreEvents');
      const before = $$('#eventList > .top-card').length;
      state.listMonths += 2;
      if (uncheckedInView().length) {
        btn.setAttribute('aria-busy', 'true');
        btn.textContent = 'בודק את הניווטים בחודשים הבאים…';
        await checkEvents(uncheckedInView());
        btn.removeAttribute('aria-busy');
      }
      renderList();
      // Keyboard and screen-reader users continue from the first newly added event.
      const first = $$('#eventList > .top-card')[before];
      first?.querySelector('a[href^="#event/"]')?.focus();
      if (!first) $('#moreEvents').hidden || $('#moreEvents').focus();
    });
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


  /* ---------- Ranking (#ranking) ---------- */
  // League ranking from the association's ranking page: a bar per competitor (weighted ranking),
  // my people in the brand colour and named, everyone else muted; the full table below.
  const RK_LEAGUES = { foot: 'ניווט רגלי', mtbo: 'ניווט רכוב' };
  const rk = { sel: store.get('rank', { league: 'foot', season: '', category: '' }), data: null, around: true, busy: false, inited: false };
  if (!RK_LEAGUES[rk.sel.league]) rk.sel = { league: 'foot', season: '', category: '' }; // a league no longer offered
  // Categories where my people were found, remembered per league: { foot: { H21A: ['דנה כהן'] } }
  const rkStars = store.get('rkStars', {});
  /** Remembers (or forgets) the shown category by whether any of my people are in it. */
  function rememberStars(d) {
    const names = [...new Set((d.grids || []).flatMap((g) => g.rows.filter((r) => state.people.some((p) => sameName(p, r.name))).map((r) => r.name)))];
    const lg = (rkStars[d.key] ||= {});
    if (names.length) lg[d.category.value] = names; else delete lg[d.category.value];
    store.set('rkStars', rkStars);
  }
  function renderRkCategories() {
    const d = rk.data;
    const stars = rkStars[d.key] || {};
    $('#rkCategory').innerHTML = d.category.options.map((o) => `<option value="${esc(o)}"${o === d.category.value ? ' selected' : ''}>${stars[o] ? '★ ' : ''}${esc(o)}</option>`).join('');
    // Quick picks: the categories of my people
    const picks = Object.entries(stars).filter(([c]) => d.category.options.includes(c));
    $('#rkQuick').innerHTML = picks.length ? `<span class="rk-quick-k">הקטגוריות של האנשים שלי:</span>${picks.map(([c, names]) =>
      `<button type="button" class="chip" data-rk-cat="${esc(c)}" aria-pressed="${c === d.category.value}" title="${esc(names.join(', '))}">★ ${esc(c)}<span class="sr-only"> (${esc(names.join(', '))})</span></button>`).join('')}` : '';
    $('#rkQuick').hidden = !picks.length;
  }

  function showRanking() {
    if (!rk.inited) {
      rk.inited = true;
      $('#rkLeagues').innerHTML = Object.entries(RK_LEAGUES).map(([k, t]) => `<button type="button" data-league="${k}" aria-pressed="${rk.sel.league === k}">${t}</button>`).join('');
      $('#rkLeagues').addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-league]');
        if (!b || b.dataset.league === rk.sel.league) return;
        rk.sel = { league: b.dataset.league, season: '', category: '' };
        $$('#rkLeagues [data-league]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        loadRanking();
      });
      $('#rkSeason').addEventListener('change', (ev) => { rk.sel.season = ev.target.value; loadRanking(); });
      $('#rkCategory').addEventListener('change', (ev) => { rk.sel.category = ev.target.value; loadRanking(); });
      $('#rkQuick').addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-rk-cat]');
        if (!b || b.dataset.rkCat === rk.sel.category) return;
        rk.sel.category = b.dataset.rkCat; loadRanking();
      });
      $('#rkBody').addEventListener('click', (ev) => {
        const t = ev.target.closest('[data-rk-around]');
        if (t) { rk.around = t.dataset.rkAround === '1'; renderRanking(); }
      });
      // an event in the colour key (or a segment of it): its segments stand out in every bar of that section, the rest fade
      const highlight = (ev) => {
        const li = ev.target.closest?.('.rk-evkey [data-ev], .rk-seg[data-ev], .rk-spare[data-ev]');
        $$('.rk-section.rk-hl').forEach((sec) => { sec.classList.remove('rk-hl'); sec.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); });
        if (!li) return;
        const sec = li.closest('.rk-section');
        sec.classList.add('rk-hl');
        sec.querySelectorAll(`[data-ev="${li.dataset.ev}"]`).forEach((x) => x.classList.add('on'));
      };
      ['mouseover', 'focusin'].forEach((t) => $('#rkBody').addEventListener(t, highlight));
      $('#rkBody').addEventListener('mouseleave', highlight);
    }
    if (!rk.data) loadRanking();
  }

  async function loadRanking() {
    const st = $('#rkStatus');
    st.hidden = false; st.classList.remove('warn');
    st.textContent = 'טוען את הדירוג מאתר האיגוד…';
    $('#rkBody').setAttribute('aria-busy', 'true');
    if (!rk.data) $('#rkBody').innerHTML = `<div class="rk-skeleton" aria-hidden="true">${'<i class="sk-line"></i>'.repeat(8)}</div>`;
    const q = new URLSearchParams(Object.entries(rk.sel).filter(([, v]) => v));
    try {
      const d = await loadJson(`api/ranking?${q}`);
      rk.data = d;
      rk.sel = { league: d.key || rk.sel.league, season: d.season.value, category: d.category.value };
      store.set('rank', rk.sel);
      const opts = (sel, c) => { sel.innerHTML = c.options.map((o) => `<option${o === c.value ? ' selected' : ''}>${esc(o)}</option>`).join(''); };
      opts($('#rkSeason'), d.season);
      rememberStars(d);
      renderRkCategories();
      const t = new Date(d.fetchedAt);
      st.textContent = `מתעדכן מאתר האיגוד · עודכן ב-${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      const failed = (d.notApplied || []).filter((x) => !x.reason);
      const missing = (d.notApplied || []).find((x) => x.reason && x.category);
      if (missing && !failed.length) {
        // the category is not run in this season: the site's first one is shown instead
        st.textContent = `הקטגוריה ${missing.category} לא קיימת בעונת ${d.season.value} – מוצגת ${d.category.value}.`;
      } else if (d.notApplied) {
        // The association's site did not switch: say so plainly (with the technical details for a bug report).
        const want = (failed.length ? failed : d.notApplied).map((x) => Object.values(x)[0]).join(', ');
        st.classList.add('warn');
        st.innerHTML = `אתר האיגוד לא החליף ל-${esc(want)} – מוצג ${esc(d.category.value || 'ברירת המחדל')} ${esc(d.season.value)}.
          <a href="${esc(d.source)}" target="_blank" rel="noopener">לדירוג באתר האיגוד ↗</a>
          <details class="diag"><summary>פרטים טכניים</summary><pre dir="ltr">${esc(JSON.stringify(d.diag, null, 2))}</pre></details>`;
      }
      renderRanking();
    } catch (err) {
      st.classList.add('warn');
      st.innerHTML = `לא ניתן לקרוא כרגע את הדירוג מאתר האיגוד.
        <details class="diag"><summary>פרטים טכניים</summary><pre dir="ltr">${esc(`GET api/ranking?${q}\n${err.message}${err.diag ? `\n${JSON.stringify(err.diag, null, 2)}` : ''}`)}</pre></details>`;
      if (!rk.data) $('#rkBody').innerHTML = '';
    } finally {
      $('#rkBody').removeAttribute('aria-busy');
    }
  }

  /** Indexes of a runner's results that count toward the ranking: the best N (all when N is unknown). */
  const bestIdx = (r, g) => r.scores.map((v, k) => [v, k]).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0]).slice(0, g.best || Infinity).map(([, k]) => k);
  const RK_COLORS = 10;
  /** The "full marks" line of a grid: 1000 in most seasons, 100 in seasons scored out of 100. */
  const topMark = (g) => (Math.max(0, ...g.rows.flatMap((r) => r.scores)) <= 200 ? 100 : 1000);

  /**
   * "By event": a column per event of the season (first on the right). Everyone's points are small
   * grey dots, the field's median a short line, and up to three highlighted people (mine, else the top
   * three) larger coloured dots: filled when the result counts toward the ranking (best N), hollow when not.
   */
  function eventStripHtml(g, mineNames) {
    const ev = g.events;
    if (!ev.length) return '';
    const top = topMark(g);
    const rows = g.rows;
    const mineRows = rows.filter((r) => mineNames.has(r.name));
    const focus = (mineRows.length ? mineRows : rows.slice(0, 3)).slice(0, 3);
    const extra = mineRows.slice(3); // more than three of mine: one neutral colour
    const pos = rows.flatMap((r) => r.scores).filter((v) => v > 0);
    if (!pos.length) return '';
    // The scale follows the bulk of the results; stray scores (a "1" for a non-finish) sit on the bottom edge.
    const sortedPos = [...pos].sort((a, b) => a - b);
    const mid = sortedPos[sortedPos.length >> 1];
    const core = sortedPos.filter((v) => v >= mid * 0.4); // real results; "1"s and the like fall below
    const lo = core[0] ?? sortedPos[0], hi = sortedPos[sortedPos.length - 1];
    const pad = Math.max(10, (hi - lo) * 0.06);
    const min = Math.max(0, lo - pad), max = hi + pad;
    const y = (v) => Math.max(0, ((v - min) / (max - min)) * 100).toFixed(1);
    const ticks = [0, 0.5, 1].map((t) => Math.round((min + (max - min) * t) / 10) * 10);
    const counted = (r) => new Set(bestIdx(r, g));
    const series = [...focus.map((r, i) => ({ r, cls: `s${i + 1}` })), ...extra.map((r) => ({ r, cls: 's-more' }))].map((x) => ({ ...x, counted: counted(x.r) }));
    const median = (vals) => { const a = [...vals].sort((x, z) => x - z); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
    const cols = ev.map((e, k) => {
      const vals = rows.map((r) => r.scores[k]).filter((v) => v > 0);
      const field = rows.map((r, i) => ({ v: r.scores[k], i })).filter(({ v }) => v > 0)
        .map(({ v, i }) => `<i class="es-dot" style="bottom:${y(v)}%;--jx:${((i % 5) - 2) * 4}px"></i>`).join('');
      const med = vals.length ? median(vals) : null;
      const sorted = [...vals].sort((a, b) => b - a);
      const me = series.map(({ r, cls, counted: c }, si) => {
        const v = r.scores[k];
        if (!(v > 0)) return '';
        const place = sorted.indexOf(v) + 1;
        const tip = [`${r.name}:`, `${e.name}\t${fmtPts(v)}`, `מקום בתחרות\t${place} מתוך ${vals.length}`, `נספר בדירוג\t${c.has(k) ? 'כן' : 'לא'}`, ...(v > top ? [`★ מעל ${top} נקודות`] : [])].join('\n');
        return `<span class="es-me ${cls}${c.has(k) ? ' counted' : ''}${v > top ? ' k1000' : ''}" style="--c:var(--e${k % RK_COLORS});bottom:${y(v)}%;--jx:${(si - (series.length - 1) / 2) * 11}px" data-tip="${esc(tip)}" tabindex="0" role="img" aria-label="${esc(`${r.name}, ${e.name}: ${fmtPts(v)} נקודות, מקום ${place} מתוך ${vals.length}${c.has(k) ? '' : ', לא נספר בדירוג'}`)}"></span>`;
      }).join('');
      return `<div class="es-col e${k % RK_COLORS}" data-ev="${k}" role="group" aria-label="${esc(`${e.name}: ${vals.length} מתחרים${med ? `, חציון ${fmtPts(Math.round(med))}` : ''}`)}">
          <div class="es-track">${field}${med ? `<b class="es-med" style="bottom:${y(med)}%" title="חציון ${fmtPts(Math.round(med))}"></b>` : ''}${me}</div>
          <a class="es-lbl" href="${esc(e.url)}" target="_blank" rel="noopener" title="${esc(e.name)}"><i aria-hidden="true"></i>${esc(e.name)}</a>
        </div>`;
    }).join('');
    const legend = [...series.filter((x) => x.cls !== 's-more').map(({ r, cls }) => `<li><span class="es-key ${cls} counted"></span>${esc(r.name)}</li>`),
      extra.length ? `<li><span class="es-key s-more counted"></span>עוד מהאנשים שלי (${extra.length})</li>` : '',
      '<li class="muted"><span class="es-key s-hollow"></span>לא נספר בדירוג</li>', `<li class="muted"><span class="es-key s-1000">★</span>מעל ${top}</li>`,
      '<li class="muted"><span class="es-key s-field"></span>שאר המתחרים</li>', '<li class="muted"><span class="es-key s-med"></span>חציון</li>'].join('');
    return `<figure class="es">
      <figcaption><h3>פירוט לפי תחרות</h3><span class="muted small">${mineRows.length ? 'האנשים שלי' : 'שלושת הראשונים'} מול כל המתחרים בכל תחרות בעונה${g.best ? ` · נספרות ${g.best} התוצאות הטובות` : ''}</span></figcaption>
      <ul class="es-legend">${legend}</ul>
      <div class="es-scroll"><div class="es-plot" style="--n:${ev.length}">
        <div class="es-axis" aria-hidden="true">${ticks.map((t) => `<span style="bottom:${y(t)}%">${fmtPts(t)}</span>`).join('')}</div>
        <div class="es-grid" aria-hidden="true">${ticks.map((t) => `<i style="bottom:${y(t)}%"></i>`).join('')}${min < top && max > top ? `<b class="es-1000" style="bottom:${y(top)}%"><span>${top}</span></b>` : ''}</div>
        <div class="es-cols">${cols}</div>
      </div></div>
    </figure>`;
  }

  const fmtPts = (n) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('he-IL'));

  function renderRanking() {
    const d = rk.data;
    if (!d) return;
    const grids = d.grids || [];
    const mineAll = [];
    const sections = grids.map((g, gi) => {
      const rows = g.rows;
      const top = topMark(g);
      const max = Math.max(1, ...rows.map((r) => r.weighted || 0));
      const mine = new Set(rows.filter((r) => state.people.some((p) => sameName(p, r.name))).map((r) => r.name));
      rows.filter((r) => mine.has(r.name)).forEach((r) => mineAll.push({ r, g, n: rows.length, leader: rows[0], above: rows[rows.indexOf(r) - 1] }));
      // With my people in a long list, show the top three and the neighbourhood of each of mine.
      const near = new Set();
      rows.forEach((r, i) => { if (mine.has(r.name)) for (let k = i - 3; k <= i + 3; k++) if (rows[k]) near.add(rows[k]); });
      const compact = rk.around && mine.size > 0 && rows.length > 15;
      const shown = compact ? rows.filter((r, i) => i < 3 || near.has(r)) : rows;
      // place in one event among this grid's runners who scored there
      const evPlace = (k, v) => { const all = rows.map((x) => x.scores[k]).filter((x) => x > 0); return `${1 + all.filter((x) => x > v).length} מתוך ${all.length}`; };
      let prev = -1;
      const bars = shown.map((r) => {
        const i = rows.indexOf(r);
        const gap = prev >= 0 && i > prev + 1 ? `<li class="rk-gap" aria-hidden="true">⋯ ${i - prev - 1} נוספים</li>` : '';
        prev = i;
        const isMine = mine.has(r.name);
        const tip = ['נקודות לפי אירוע:', ...g.events.map((e, k) => `${e.name}\t${fmtPts(r.scores[k])}`), `מקדם גיל\t${r.ageFactor ?? '–'}`].join('\n');
        const pct = ((r.weighted || 0) / max) * 100;
        // the bar is built from the counted results, an event colour each, in season order; then the age factor's share
        const best = bestIdx(r, g);
        const sum = best.reduce((t, k) => t + r.scores[k], 0);
        const scale = sum > (r.weighted || 0) && sum ? (r.weighted || 0) / sum : 1;
        const age = Math.max(0, (r.weighted || 0) - sum);
        const whole = r.weighted || sum || 1;
        const segs = [...best].sort((a, b) => a - b).map((k) => `<span class="rk-seg e${k % RK_COLORS}${r.scores[k] > top ? ' k1000' : ''}" data-ev="${k}" style="width:${((r.scores[k] * scale) / whole * 100).toFixed(2)}%" data-tip="${esc(`${g.events[k].name}:\nנקודות\t${fmtPts(r.scores[k])}\nמקום באירוע\t${evPlace(k, r.scores[k])}${r.scores[k] > top ? `\n★ מעל ${top} נקודות` : ''}`)}"></span>`).join('')
          + (age >= 1 ? `<span class="rk-seg rk-age" style="width:${(age / whole * 100).toFixed(2)}%" data-tip="${esc(`תוספת מקדם גיל (${r.ageFactor ?? '–'}):\nנקודות\t+${fmtPts(age)}`)}"></span>` : '');
        // fewer results than the ranking counts: an empty slot for each one missing
        const have = r.scores.filter((v) => v > 0).length;
        const missing = g.best && have < g.best ? g.best - have : 0;
        const holes = missing ? `<span class="rk-holes" data-tip="${esc(`חסרות ${missing === 1 ? 'תוצאה אחת' : `${missing} תוצאות`}:\nיש\t${have} מתוך ${g.best}`)}">${'<i></i>'.repeat(missing)}</span>` : '';
        const spare = r.scores.map((v, k) => [v, k]).filter(([v, k]) => v > 0 && !best.includes(k))
          .map(([v, k]) => `<span class="rk-spare e${k % RK_COLORS}${v > top ? ' k1000' : ''}" data-ev="${k}" data-tip="${esc(`${g.events[k].name} (לא נספר):\nנקודות\t${fmtPts(v)}\nמקום באירוע\t${evPlace(k, v)}${v > top ? `\n★ מעל ${top} נקודות` : ''}`)}"></span>`).join('');
        return `${gap}<li class="rk-row${isMine ? ' mine' : ''}">
          <span class="rk-rank">${r.rank ?? i + 1}</span>
          <span class="rk-who"><span class="rk-name">${isMine ? '<span class="rk-star" aria-hidden="true">★</span>' : ''}${esc(r.name)}</span><span class="rk-club">${esc(r.club)}${missing ? ` <span class="rk-few">${have}/${g.best} תוצאות</span>` : ''}</span></span>
          <span class="rk-bar" data-tip="${esc(tip)}" tabindex="0" role="img" aria-label="${esc(`${r.name}: ${fmtPts(r.weighted)} נקודות, מקום ${r.rank ?? i + 1} מתוך ${rows.length}`)}"><span class="rk-stack" style="width:${pct.toFixed(1)}%">${segs}</span>${holes}${spare ? `<span class="rk-spares">${spare}</span>` : ''}</span>
          <span class="rk-val">${fmtPts(r.weighted)}</span>
        </li>`;
      }).join('');
      const toggle = mine.size && rows.length > 15 ? `<div class="seg rk-view" role="group" aria-label="מה להציג">
          <button type="button" data-rk-around="1" aria-pressed="${rk.around}">סביב האנשים שלי</button>
          <button type="button" data-rk-around="0" aria-pressed="${!rk.around}">כל ${rows.length}</button></div>` : '';
      const table = `<details class="rk-table"><summary>טבלה מלאה (${rows.length} מתחרים)</summary><div class="table-wrap"><table>
          <caption class="sr-only">${esc(d.title)} · ${esc(d.category.value)} · ${esc(d.season.value)}${grids.length > 1 ? ` · ${esc(g.title)}` : ''}</caption>
          <thead><tr><th scope="col">#</th><th scope="col">שם</th><th scope="col" class="club">מועדון</th>${g.events.map((e) => `<th scope="col"><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.name)}</a></th>`).join('')}<th scope="col">דירוג</th><th scope="col">מקדם גיל</th><th scope="col">משוקלל</th></tr></thead>
          <tbody>${rows.map((r) => `<tr${mine.has(r.name) ? ' class="mine"' : ''}><td>${r.rank ?? ''}</td><th scope="row">${esc(r.name)}</th><td>${esc(r.club)}</td>${r.scores.map((v) => (v > top ? `<td class="k1000" title="מעל ${top}"><span class="k1000-k" aria-hidden="true">★</span>${fmtPts(v)}<span class="sr-only"> (מעל ${top})</span></td>` : `<td>${fmtPts(v)}</td>`)).join('')}<td>${fmtPts(r.total)}</td><td>${r.ageFactor ?? '–'}</td><td><b>${fmtPts(r.weighted)}</b></td></tr>`).join('')}</tbody>
        </table></div></details>`;
      return `<section class="rk-section" aria-labelledby="rk-h${gi}">
        <div class="rk-sec-head"><h2 id="rk-h${gi}">${grids.length > 1 ? esc(g.title) : `${esc(d.category.value)} · ${esc(d.season.value)}`}</h2>
          ${g.best ? `<p class="muted small">דירוג משוקלל, לפי ${g.best} התוצאות הטובות ביותר ומקדם גיל</p>` : ''}${toggle}</div>
        ${g.events.length ? `<ul class="rk-evkey" aria-label="צבע לכל אירוע">${g.events.map((e, k) => `<li data-ev="${k}" tabindex="0"><i class="e${k % RK_COLORS}" aria-hidden="true"></i>${esc(e.name)}</li>`).join('')}
          <li class="rk-evkey-x"><i class="rk-age" aria-hidden="true"></i>מקדם גיל</li><li class="rk-evkey-x"><i class="rk-spare-k" aria-hidden="true"></i>לא נספר</li>${g.best ? '<li class="rk-evkey-x"><i class="rk-hole-k" aria-hidden="true"></i>חסרה תוצאה</li>' : ''}<li class="rk-evkey-x"><b class="k1000-k" aria-hidden="true">★</b>מעל ${top}</li></ul>` : ''}
        <ol class="rk-chart" aria-label="דירוג משוקלל">${bars}</ol>
        ${eventStripHtml(g, mine)}
        ${table}
      </section>`;
    });
    $('#rkBody').innerHTML = sections.length ? sections.join('')
      : `<p class="empty">${d.season.options.length ? 'אין עדיין דירוג לקטגוריה הזו בעונה הזו. נסו קטגוריה או עונה אחרת.' : 'לא הצלחנו לקרוא את רשימות הליגה מאתר האיגוד.'}
          <a href="${esc(d.source)}" target="_blank" rel="noopener">לדירוג באתר האיגוד ↗</a></p>
        ${d.diag && !d.notApplied ? `<details class="diag"><summary>פרטים טכניים</summary><pre dir="ltr">${esc(JSON.stringify(d.diag, null, 2))}</pre></details>` : ''}`;
    // My people first: place, points and the gap to the leader and to the one above.
    $('#rkMine').innerHTML = !state.people.length
      ? '<p class="muted small">הוסיפו את <button type="button" class="linklike" data-open-people>האנשים שלכם</button> כדי לראות אותם מודגשים בדירוג.</p>'
      : mineAll.length ? `<ul class="rk-mine-list">${mineAll.map(({ r, g, n, leader, above }) => `<li>
          <span class="rk-mine-name">★ ${esc(r.name)}</span>
          <span class="rk-mine-place"><b>${r.rank}</b> מתוך ${n}${grids.length > 1 ? ` · ${esc(g.title)}` : ''}</span>
          <span class="rk-mine-pts"><b>${fmtPts(r.weighted)}</b> נק׳</span>
          <span class="muted small">${r === leader ? 'במקום הראשון' : `${fmtPts(leader.weighted - r.weighted)} מאחורי הראשון${above && above !== leader ? ` · ${fmtPts(above.weighted - r.weighted)} מאחורי מקום ${above.rank}` : ''}`}</span>
        </li>`).join('')}</ul>`
      : `<p class="muted small">אף אחד מהאנשים שלך לא מופיע ב${esc(d.category.value)} בעונה ${esc(d.season.value)}. בחרו את הקטגוריה שלהם.</p>`;
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
    return state.events.filter((e) => { const d = parseDate(e.date); return discOk(e) && !isClosedEvent(e) && d.getFullYear() === y && d.getMonth() === m; });
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
        const evs = state.events.filter((e) => e.date === isoD && discOk(e) && !isClosedEvent(e));
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

  /** Message text, its attached images (open full size) and linked files. */
  const msgBody = (m, threadUrl) => {
    const images = m.images || [];
    let html = m.body.length ? m.body.map((p) => `<p>${linkify(p)}</p>`).join('') : '';
    if (images.length) {
      html += `<div class="msg-images">${images.map((src, i) => `<a href="${esc(src)}" target="_blank" rel="noopener" class="msg-img" data-lightbox="${esc(`תמונה מצורפת${images.length > 1 ? ` ${i + 1}` : ''} – ${m.author}`)}">
        <img src="${esc(src)}" alt="תמונה מצורפת${images.length > 1 ? ` ${i + 1}` : ''} להודעה של ${esc(m.author)}" loading="lazy">
        <span class="msg-img-open" aria-hidden="true">🔍 הגדלה</span></a>`).join('')}</div>`;
    } else if (m.hasImage) {
      html += `<p><a class="msg-img-link" href="${esc(threadUrl || state.links.forum || '#')}" target="_blank" rel="noopener">📷 מצורפת תמונה – לצפייה בפורום ↗</a></p>`;
    }
    if (m.files?.length) {
      html += `<ul class="msg-files" aria-label="קבצים מצורפים">${m.files.map((f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}${f.file && f.file !== f.name ? ` <span class="muted small">(${esc(f.file)})</span>` : ''}</a></li>`).join('')}</ul>`;
    }
    return html;
  };

  /* New in the forum since the last visit: threads and replies after the time the forum was last opened. */
  const forumSeen = { prev: store.get('forumSeen', null), onlyNew: false };
  const isNewAt = (t) => !!(forumSeen.prev && t && t > forumSeen.prev);
  const newReplies = (t) => t.replies.filter((r) => isNewAt(r.postedAt)).length;
  const isNewThread = (t) => isNewAt(t.postedAt) || newReplies(t) > 0 || (!t.replies.length && isNewAt(t.lastActivity));
  function forumBadge() {
    const tab = $('.tabs a[data-view="forum"]');
    const f = state.forum;
    const n = f?.threads && location.hash.split('/')[0] !== '#forum' ? f.threads.filter(isNewThread).length : 0;
    let b = $('.tab-new', tab);
    if (!n) { b?.remove(); tab.removeAttribute('aria-label'); return; }
    if (!b) { b = document.createElement('span'); b.className = 'tab-new'; b.dir = 'ltr'; b.setAttribute('aria-hidden', 'true'); tab.append(b); }
    b.textContent = n > 9 ? '9+' : n;
    tab.setAttribute('aria-label', `פורום – ${n} נושאים עם הודעות חדשות`);
  }
  /** Opening the forum: what is new is shown against the previous visit, and this visit becomes the last one. */
  function markForumSeen() {
    const now = new Date().toISOString();
    if (!forumSeen.marked) { forumSeen.prev = store.get('forumSeen', null); forumSeen.marked = true; }
    store.set('forumSeen', now);
    forumBadge();
  }

  function renderForum() {
    const f = state.forum;
    if (!f || f.error) {
      $('#topicList').innerHTML = `<li class="empty">לא ניתן לטעון כרגע את הפורום. <a href="${esc(state.links.forum || '#')}" target="_blank" rel="noopener">לפורום באתר האיגוד</a></li>`;
      return;
    }
    const q = state.forumQ.toLowerCase();
    const fresh = f.threads.filter(isNewThread);
    const bar = $('#forumNew');
    bar.hidden = !fresh.length;
    if (!fresh.length) forumSeen.onlyNew = false;
    if (fresh.length) {
      const since = new Date(forumSeen.prev);
      bar.innerHTML = `<span><span class="new-dot" aria-hidden="true"></span><strong>${fresh.length}</strong> ${fresh.length === 1 ? 'נושא עם הודעות חדשות' : 'נושאים עם הודעות חדשות'} מאז הביקור הקודם (<bdi>${since.getDate()}.${since.getMonth() + 1}</bdi> בשעה <bdi>${since.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</bdi>)</span>
        <button type="button" class="chip" id="forumOnlyNew" aria-pressed="${forumSeen.onlyNew}">${forumSeen.onlyNew ? 'הצג הכול' : 'הצג רק חדשות'}</button>`;
    }
    const threads = f.threads.filter((t) => !forumSeen.onlyNew || isNewThread(t)).filter((t) => !q || [t.title, t.author, ...t.body, ...t.replies.flatMap((r) => [r.author, ...r.body])].join(' ').toLowerCase().includes(q));
    if (!f.threads.length) {
      $('#topicList').innerHTML = `<li class="empty">לא נמצאו כרגע הודעות בפורום.
        <a href="${esc(f.source || state.links.forum || '#')}" target="_blank" rel="noopener">לפורום באתר האיגוד ↗</a>
        ${f.diag ? `<details class="diag"><summary>פרטים טכניים</summary><pre dir="ltr">${esc(JSON.stringify(f.diag, null, 2))}</pre></details>` : ''}</li>`;
      return;
    }
    $('#topicList').innerHTML = threads.length ? threads.map((t) => {
      const ev = matchEvent(t.title);
      const nr = newReplies(t), nt = isNewAt(t.postedAt);
      const fresh1 = nt || nr > 0 || isNewThread(t);
      return `<li class="topic${t.announcement || t.pinned ? ' featured' : ''}${fresh1 ? ' is-new' : ''}">
        <details id="thread-${esc(t.id)}">
          <summary>
            <div class="topic-head">
              <div class="badges">${nt ? '<span class="pill new">חדש</span>' : nr ? `<span class="pill new">${nr === 1 ? 'תגובה חדשה' : `${nr} תגובות חדשות`}</span>` : fresh1 ? '<span class="pill new">עדכון</span>' : ''}${t.announcement ? '<span class="pill strong">הכרזה</span>' : ''}${t.pinned ? '<span class="pill">📌 נעוץ</span>' : ''}</div>
              <h2>${esc(t.title)}</h2>
              <p class="meta"><span class="author${state.myClub && t.authorClubId === state.myClub ? ' mine-author' : ''}">${t.authorLogo || t.authorClubId ? logoHtml({ id: t.authorClubId, fallback: t.authorLogo }, 'cl-xs') : ''}${esc(t.author)}</span>${t.lastActivity ? `<span>פעילות אחרונה ${relTime(t.lastActivity)}</span>` : ''}</p>
            </div>
            <div class="replies" aria-label="${t.replyCount} תגובות"><strong>${t.replyCount}</strong><span>תגובות</span></div>
          </summary>
          <div class="thread">
            ${msgBody(t, t.url) || '<p class="muted">(הודעה ללא תוכן)</p>'}
            ${ev ? `<p class="related">אירוע קשור: <button type="button" class="chip" data-open="${esc(ev.id)}">${esc(ev.title)} · ${fmtShort(evDate(ev))}</button></p>` : ''}
            ${t.replies.length ? `<ol class="reply-list" aria-label="תגובות">${t.replies.map((r) => `<li${isNewAt(r.postedAt) ? ' class="new-reply"' : ''}>
              <p class="meta"><strong class="author${state.myClub && r.authorClubId === state.myClub ? ' mine-author' : ''}">${r.authorLogo || r.authorClubId ? logoHtml({ id: r.authorClubId, fallback: r.authorLogo }, 'cl-xs') : ''}${esc(r.author)}</strong><span>${relTime(r.postedAt)}</span>${isNewAt(r.postedAt) ? '<span class="pill new">חדש</span>' : ''}</p>${msgBody(r, t.url) || `<p>${esc(r.title)}</p>`}</li>`).join('')}</ol>` : ''}
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
    $('#forumNew').addEventListener('click', (e) => {
      if (!e.target.closest('#forumOnlyNew')) return;
      forumSeen.onlyNew = !forumSeen.onlyNew;
      renderForum();
      $('#forumOnlyNew')?.focus();
    });
    // the very first visit has nothing "new": start counting from now
    if (!store.get('forumSeen', null)) store.set('forumSeen', new Date().toISOString());
    forumBadge();
    if (f && !f.error) {
      const s = $('#forumStatus');
      s.textContent = !f.threads.length ? statusText(f) : `${statusText(f)} · ${f.threads.length} נושאים${f.via === 'rss' ? ' (מעדכוני ה-RSS של הפורום)' : ' מהשבוע האחרון'}`;
      s.classList.toggle('warn', !!f.stale);
    }
    renderForum();
  }

  /* ---------- Results files: a readable table per course, and splits as a SplitsBrowser-style chart ---------- */
  const RS_PARSER = 4; // bumped when the results parser learns a format, so cached "unknown" answers are not reused
  const RS_COLORS = 6; // categorical slots (validated: light #2a78d6… / dark #3987e5…), in fixed order
  const rs = { key: '', data: null, event: null, course: 0, picked: new Map(), q: '', refMode: store.get('rsRefMode', 'fastest'), legRows: store.get('rsLegRows', ['cum', 'leg']) };
  const fmtSec = (v, plus = false) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '–';
    const neg = v < 0, a = Math.abs(Math.round(v));
    const h = Math.floor(a / 3600), m = Math.floor((a % 3600) / 60), sec = String(a % 60).padStart(2, '0');
    const body = h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
    return `${neg ? '−' : plus ? '+' : ''}${body}`;
  };
  const STATUS_HE = { MP: 'פספוס נקודה', DNF: 'לא סיים', DSQ: 'נפסל', DNS: 'לא זינק', OT: 'חריגת זמן' };
  const rsKey = (r) => `${r.name}|${r.club}|${r.pos}`;
  const isMinePerson = (name) => state.people.some((p) => sameName(p, name));

  /** Where the viewer draws: inside a group page (#rsBody), else the whole results page. */
  const rsTarget = () => (rs.inGroup && $('#rsBody')) || $('#resultsPage');

  async function showResultFile(param) {
    const cut = param.indexOf('/');
    const evId = cut >= 0 ? param.slice(0, cut) : '', url = cut >= 0 ? param.slice(cut + 1) : param;
    if (url.startsWith('group:')) { showFileGroup(evId, url.slice(6)); return; }
    rs.inGroup = false;
    rs.event = state.events.find((x) => x.id === evId) || null;
    loadResult(url);
    $('#main').focus({ preventScroll: true });
  }

  /** A group of files ("LapCombat-Long", "LapCombat-MediumA", …): a button per category, the chosen one below. */
  async function showFileGroup(evId, prefix) {
    rs.inGroup = true;
    const page = $('#resultsPage');
    let e = state.events.find((x) => x.id === evId) || null;
    rs.event = e;
    const back = e ? `<a class="btn ghost" href="#event/${encodeURIComponent(e.id)}">→ לעמוד התחרות</a>` : '';
    if (e && !e.details && e.nivutId) {
      page.innerHTML = '<p class="live-status" role="status">טוען…</p>';
      await loadJson(`api/event?id=${encodeURIComponent(e.nivutId)}`).then((d) => applyDetails(e, d)).catch(() => {});
    }
    const g = groupFiles(e?.details?.attachments || []).find((x) => x.group && x.prefix.toLowerCase() === prefix.toLowerCase());
    if (!g) {
      page.innerHTML = `<div class="section-head"><h1 id="rsTitle">${esc(prefix)}</h1>${back}</div><p class="empty">לא מצאנו את הקבצים. ${e ? `<a href="#event/${encodeURIComponent(e.id)}">לעמוד התחרות</a>` : ''}</p>`;
      return;
    }
    const title = e ? (e.calPlace && e.calDesc ? `${e.calPlace} – ${e.calDesc}` : e.title) : '';
    const remembered = store.get('fileGroups', {})[g.prefix.toLowerCase()];
    const sel = Math.max(0, g.items.findIndex((it) => it.label === remembered));
    page.innerHTML = `<div class="section-head"><div><h1 id="rsTitle">${esc(g.prefix)}</h1>${title ? `<p class="muted">${esc(title)}${e ? ` · ${esc(fmtLong(evDate(e)))}` : ''}</p>` : ''}</div><div class="rs-actions">${back}</div></div>
      ${categoryBar(g.items.map((it, i) => ({ name: it.label, html: `<button type="button" data-gitem="${i}" aria-pressed="${i === sel}">${esc(it.label)}</button>` })), 'קטגוריה', 'rs-group-bar')}
      <div id="rsBody"></div>`;
    rs.group = g;
    openGroupItem(sel);
    $('#main').focus({ preventScroll: true });
  }
  function openGroupItem(i) {
    const g = rs.group, it = g.items[i];
    store.set('fileGroups', { ...store.get('fileGroups', {}), [g.prefix.toLowerCase()]: it.label });
    $$('[data-gitem]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.gitem === i)));
    if (viewable(it.f)) { loadResult(it.f.url); return; }
    // an outside analysis (LapCombat, Livelox…): shown here when the site allows it, always one click away
    $('#rsBody').innerHTML = `<div class="rs-ext"><p class="muted small">${esc(`${g.prefix} – ${it.label}`)} נפתח מאתר חיצוני. אם הוא לא נטען כאן:</p>
        <a class="btn" href="${esc(it.f.url)}" target="_blank" rel="noopener">פתיחה בחלון חדש ↗</a></div>
      <iframe class="rs-frame" src="${esc(it.f.url)}" title="${esc(`${g.prefix} – ${it.label}`)}" loading="lazy" referrerpolicy="no-referrer"></iframe>`;
  }

  async function loadResult(url) {
    const page = rsTarget();
    const back = rs.event && !rs.inGroup ? `<a class="btn ghost" href="#event/${encodeURIComponent(rs.event.id)}">→ לעמוד התחרות</a>` : '';
    if (rs.key !== url || !rs.data) {
      rs.key = url; rs.data = null; rs.picked = new Map(); rs.q = '';
      page.innerHTML = `${rs.inGroup ? '' : `<div class="section-head"><h1 id="rsTitle">תוצאות</h1>${back}</div>`}<p class="live-status" role="status">טוען את קובץ התוצאות…</p>
        <div class="rk-skeleton" aria-hidden="true">${'<i class="sk-line"></i>'.repeat(8)}</div>`;
      try {
        rs.data = await loadJson(`api/resultfile?url=${encodeURIComponent(url)}&v=${RS_PARSER}`);
      } catch (err) {
        page.innerHTML = `${rs.inGroup ? '' : `<div class="section-head"><h1 id="rsTitle">תוצאות</h1>${back}</div>`}
          <p class="empty">לא הצלחנו לקרוא את הקובץ. <a href="${esc(url)}" target="_blank" rel="noopener">לפתיחת הקובץ המקורי ↗</a></p>
          <details class="diag"><summary>פרטים טכניים</summary><pre dir="ltr">${esc(err.message)}</pre></details>`;
        return;
      }
      if (rs.key !== url) return;
      const cs = rs.data.courses || [];
      // the course with my people first, else the first one
      const mine = cs.findIndex((c) => c.runners.some((r) => isMinePerson(r.name)));
      rs.course = mine >= 0 ? mine : 0;
      pickDefaults();
    }
    renderResultFile();
  }

  const course = () => rs.data?.courses?.[rs.course];
  const hasSplits = (c) => c && c.controls.length > 0;
  /** Default lines: the winner and my people, else the top three. */
  function pickDefaults() {
    rs.picked = new Map();
    const c = course();
    if (!hasSplits(c)) return;
    const ok = c.runners.filter((r) => r.status === 'OK' && r.splits.some((v) => v !== null));
    const mine = c.runners.filter((r) => isMinePerson(r.name));
    // my people are picked first (they get the first colours), then the winner for comparison; without them, the top three
    const want = [...new Set(mine.length ? [...mine, ok[0]] : ok.slice(0, 3))].filter(Boolean).slice(0, RS_COLORS);
    want.forEach((r) => togglePick(r));
  }
  /** Colour follows the runner: a picked runner keeps its slot until unpicked. */
  function togglePick(r) {
    const k = rsKey(r);
    if (rs.picked.has(k)) { rs.picked.delete(k); return true; }
    const used = new Set(rs.picked.values());
    const slot = [...Array(RS_COLORS).keys()].find((i) => !used.has(i));
    if (slot === undefined) return false;
    rs.picked.set(k, slot);
    return true;
  }

  /** Leg times and, per leg, ranks among everyone with a time there. */
  function legStats(c) {
    const legs = c.runners.map((r) => r.splits.map((v, i) => {
      const prev = i === 0 ? 0 : r.splits[i - 1];
      return v === null || prev === null || prev === undefined ? null : v - prev;
    }));
    const best = c.controls.map((_, i) => Math.min(...legs.map((l) => l[i]).filter((v) => v !== null && v > 0)));
    const rank = (i, v) => (v === null ? null : 1 + legs.filter((l) => l[i] !== null && l[i] < v).length);
    // overall at each control: place among the valid finishers' times to that point, and the gap to the first there
    // (a mispunch or non-competitor who skipped controls would otherwise "lead" with a short time)
    const cum = (i) => c.runners.filter((r) => r.status === 'OK').map((r) => r.splits[i]).filter((v) => v !== null && v !== undefined && v > 0);
    const cumBest = c.controls.map((_, i) => Math.min(...cum(i)));
    const cumRank = (i, v) => (v === null || v === undefined ? null : 1 + cum(i).filter((x) => x < v).length);
    return { legs, best, rank, cumBest, cumRank };
  }
  /** The reference for "time behind", by the chosen mode:
   *  'fastest' – the fastest leg at every leg, added up, so whoever was fastest on a leg draws a flat line there
   *  (legs from valid finishers; a leg none of them has falls back to anyone's best);
   *  'winner' – the winner's cumulative times (the fastest finisher with all splits), so the winner is the flat line. */
  function referenceOf(c, st, mode) {
    if (mode === 'winner') {
      const win = c.runners.filter((r) => r.status === 'OK' && r.time && r.splits.length === c.controls.length && r.splits.every((v) => v !== null))
        .sort((a, b) => a.time - b.time)[0];
      if (win) return { name: win.name, splits: win.splits, mode };
    }
    const ok = c.runners.map((r, k) => (r.status === 'OK' ? st.legs[k] : null)).filter(Boolean);
    let at = 0;
    const splits = [];
    for (let i = 0; i < c.controls.length; i++) {
      const fast = Math.min(...ok.map((l) => l[i]).filter((v) => v !== null && v > 0));
      const leg = Number.isFinite(fast) ? fast : st.best[i];
      if (!Number.isFinite(leg)) return null;
      splits.push(at += leg);
    }
    return { name: 'הטוב ביותר בכל מקטע', splits, mode: 'fastest' };
  }
  // LapCombat's extra per-leg numbers: the speed index (100 = the average of the best three on that leg; lower is faster)
  // and the time lost to mistakes (negative = better than the runner's own pace)
  const speedCls = (v) => (v === null || v === undefined ? '' : v <= 100 ? 'good' : v <= 115 ? '' : v <= 140 ? 'warn' : 'bad');
  const mistakeCls = (v) => (v === null || v === undefined ? '' : v < 0 ? 'good' : v < 15 ? '' : v < 45 ? 'warn' : 'bad');
  const fmtSpeed = (v) => (v === null || v === undefined ? '–' : v.toFixed(1));
  const fmtMistake = (v) => (v === null || v === undefined ? '–' : v === 0 ? '0:00' : fmtSec(v, true));
  /** Course / category buttons; with both women's (D…) and men's (H…) categories, in rows: women, men, the rest. */
  const CAT_GROUPS = [['נשים', /^(D|W)\s?\d/i], ['גברים', /^(H|M)\s?\d/i]];
  function categoryBar(items, label, cls = '') {
    const bar = (list, aria) => `<div class="seg rs-courses ${cls}" role="group" aria-label="${esc(aria)}">${list.map((x) => x.html).join('')}</div>`;
    const groups = CAT_GROUPS.map(([name, re]) => [name, items.filter((x) => re.test(x.name))]);
    const rest = items.filter((x) => !CAT_GROUPS.some(([, re]) => re.test(x.name)));
    if (groups.some(([, list]) => !list.length)) return bar(items, label);
    return `<div class="rs-cgroups">${[...groups, ['כללי', rest]].filter(([, list]) => list.length).map(([name, list]) => `<div class="rs-cgroup"><span class="rs-cg-k" aria-hidden="true">${name}</span>${bar(list, `${label}: ${name}`)}</div>`).join('')}</div>`;
  }
  const shortCtl = (label) => (/^finish$/i.test(label) ? 'F' : String(label).split(/\s/)[0]);

  /** The legs table under the chart: per picked runner a row for each chosen measure – overall time, leg time,
   *  and from a LapCombat analysis the leg speed index and mistake time (several can be shown together). */
  const LEG_ROWS = [['cum', 'זמן כללי'], ['leg', 'זמן מקטע'], ['speed', 'מדד מהירות', 'Leg speed index'], ['mistake', 'זמן טעות', 'Leg mistake time']];
  function legsTableHtml(c, st, picked) {
    const avail = LEG_ROWS.filter(([k]) => k === 'cum' || k === 'leg' || c.lap?.[k]);
    let rows = avail.filter(([k]) => rs.legRows.includes(k));
    if (!rows.length) rows = avail.slice(0, 2);
    const on = new Set(rows.map(([k]) => k));
    const toggle = `<div class="seg rs-legview" role="group" aria-label="מה להציג בטבלה (אפשר כמה)">${avail.map(([k, t, en]) => `<button type="button" data-legrow="${k}" aria-pressed="${on.has(k)}"${en ? ` title="${en}"` : ''}>${t}</button>`).join('')}</div>`;
    const keys = {
      time: 'זמן: <b>זמן</b> · פער מהראשון · <span class="rs-pl">מקום</span>',
      speed: 'מדד מהירות: 100 = ממוצע שלושת הטובים במקטע, נמוך = מהיר – <span class="lapk good">עד 100</span> <span class="lapk">עד 115</span> <span class="lapk warn">עד 140</span> <span class="lapk bad">מעל 140</span>',
      mistake: 'זמן טעות: ביחס לקצב של המתחרה עצמו, שלילי = מצוין – <span class="lapk good">שלילי</span> <span class="lapk">עד 0:15</span> <span class="lapk warn">עד 0:45</span> <span class="lapk bad">מעל 0:45</span>',
    };
    const key = [(on.has('cum') || on.has('leg')) && keys.time, on.has('speed') && keys.speed, on.has('mistake') && keys.mistake].filter(Boolean).join('<br>');
    const lapVals = (r, k) => r[k] || [];
    // LapCombat place on the leg among everyone with a value (lower is better for both)
    const lapPlace = (k, i, v) => 1 + c.runners.filter((x) => { const w = lapVals(x, k)[i]; return w !== null && w !== undefined && w < v; }).length;
    const timeCell = (v, best, place, label) => {
      if (v === null || v === undefined) return '<td class="none">–</td>';
      const top = place === 1;
      return `<td class="${top ? 'best' : ''}" aria-label="${esc(`${label}: ${fmtSec(v)}, ${top ? 'ראשון' : `פער ${fmtSec(v - best, true)}, מקום ${place ?? '–'}`}`)}"><span class="lt">${fmtSec(v)}</span><span class="lg"><bdi dir="ltr">${top ? '' : fmtSec(v - best, true)}</bdi></span><span class="rs-pl">${place ?? '–'}</span></td>`;
    };
    const lapCell = (k, i, v) => {
      if (v === null || v === undefined) return '<td class="none">–</td>';
      const p = lapPlace(k, i, v), txt = k === 'speed' ? fmtSpeed(v) : fmtMistake(v);
      return `<td class="lapc ${k === 'speed' ? speedCls(v) : mistakeCls(v)}" aria-label="${esc(`${k === 'speed' ? 'מדד מהירות' : 'זמן טעות'}: ${txt}, מקום ${p}`)}"><span class="lt"><bdi dir="ltr">${txt}</bdi></span><span class="lg"></span><span class="rs-pl">${p}</span></td>`;
    };
    const lap = on.has('speed') || on.has('mistake');
    const summary = (r, k) => {
      if (!lap) return '';
      if (k === 'speed') return `<td class="tot">${fmtSpeed(r.speedAvg)}${r.cruise != null ? `<small>שיוט ${fmtSpeed(r.cruise)}</small>` : ''}</td>`;
      if (k === 'mistake') return `<td class="tot"><bdi dir="ltr">${fmtMistake(r.mistakeTotal)}</bdi>${r.mistakeRatio != null || r.ideal ? `<small>${[r.mistakeRatio != null && `${r.mistakeRatio}%`, r.ideal && `אידיאלי ${fmtSec(r.ideal)}`].filter(Boolean).join(' · ')}</small>` : ''}</td>`;
      return '<td class="tot"></td>';
    };
    const body = picked.map((r) => {
      const legs = st.legs[c.runners.indexOf(r)];
      const cells = {
        cum: () => r.splits.map((v, i) => timeCell(v, st.cumBest[i], st.cumRank(i, v), 'זמן כללי')).join(''),
        leg: () => legs.map((v, i) => timeCell(v, st.best[i], st.rank(i, v), 'זמן מקטע')).join(''),
        speed: () => c.controls.map((_, i) => lapCell('speed', i, lapVals(r, 'speed')[i])).join(''),
        mistake: () => c.controls.map((_, i) => lapCell('mistake', i, lapVals(r, 'mistake')[i])).join(''),
      };
      return `<tbody class="rs-runner">${rows.map(([k, t], n) => `<tr class="${k}">${n ? '' : `<th scope="rowgroup" rowspan="${rows.length}" class="rs-who"><i class="rs-sw s${rs.picked.get(rsKey(r))}" aria-hidden="true"></i>${esc(r.name)}</th>`}<th scope="row" class="rs-kind">${t}</th>${cells[k]()}${summary(r, k)}</tr>`).join('')}</tbody>`;
    }).join('');
    return `<div class="rs-legs-top"><p class="muted small rs-legs-key">${key}</p>${toggle}</div>
      <div class="rs-legs-wrap"><table class="rs-legs${picked.some((r) => r.splits.some((v) => v >= 3600)) ? ' long' : ''}"><caption class="sr-only">לכל מתחרה מסומן שורה לכל נתון שנבחר: ${rows.map(([, t]) => t).join(', ')}</caption>
        <thead><tr><th scope="col" colspan="2">מתחרה</th>${c.controls.map((ctl) => `<th scope="col">${esc(shortCtl(ctl))}</th>`).join('')}${lap ? '<th scope="col">סיכום</th>' : ''}</tr></thead>${body}</table></div>`;
  }

  function chartSvg(c, ref, st) {
    const picked = c.runners.filter((r) => rs.picked.has(rsKey(r)));
    if (!picked.length) return '<p class="muted small rs-chart-empty">סמנו מתחרים בטבלה כדי לראות את הגרף.</p>';
    const W = 860, H = 340, L = 62, R = picked.length <= 4 ? 84 : 18, T = 16, B = 34;
    const xs = [0, ...ref.splits];
    const maxX = xs[xs.length - 1] || 1;
    const behind = picked.map((r) => [0, ...r.splits].map((v, i) => (v === null || (i > 0 && r.splits[i - 1] === undefined) ? null : v - xs[i])));
    const vals = behind.flat().filter((v) => v !== null);
    const maxY = Math.max(60, ...vals), minY = Math.min(0, ...vals);
    const x = (t) => L + (t / maxX) * (W - L - R);
    const y = (v) => T + ((v - minY) / (maxY - minY || 1)) * (H - T - B);
    // nice y ticks every 1, 2, 5, 10… minutes
    const steps = [30, 60, 120, 300, 600, 900, 1200, 1800, 3600];
    const step = steps.find((s) => (maxY - minY) / s <= 6) || 3600;
    const yt = [];
    for (let v = Math.ceil(minY / step) * step; v <= maxY; v += step) yt.push(v);
    const grid = yt.map((v) => `<line class="rs-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="rs-ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? '0' : fmtSec(v, true)}</text>`).join('');
    // control numbers under the axis; one that would touch the last one shown is skipped (the finish always shows)
    let lastLabel = -Infinity;
    const cols = xs.map((t, i) => {
      const lx = x(t), isFinish = i === xs.length - 1;
      const show = i === 0 || isFinish ? lx - lastLabel >= 12 || isFinish : lx - lastLabel >= 16 && x(maxX) - lx >= 16;
      if (show) lastLabel = lx;
      return `<line class="rs-vgrid" x1="${lx}" x2="${lx}" y1="${T}" y2="${H - B}"/>${show ? `<text class="rs-ax" x="${lx}" y="${H - B + 16}" text-anchor="middle">${esc(i ? shortCtl(c.controls[i - 1]) : 'S')}</text>` : ''}`;
    }).join('');
    const lines = picked.map((r, k) => {
      const slot = rs.picked.get(rsKey(r));
      const pts = behind[k];
      let d = '', pen = false;
      pts.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(xs[i]).toFixed(1)} ${y(v).toFixed(1)} `; pen = true; });
      const last = pts.map((v, i) => [v, i]).filter(([v]) => v !== null).pop();
      const label = picked.length <= 4 && last ? `<text class="rs-end" x="${x(xs[last[1]]) + 8}" y="${y(last[0]) + 4}">${esc(r.name.split(' ')[0])}</text>` : '';
      const dots = pts.map((v, i) => (v === null ? '' : `<circle class="rs-dot" cx="${x(xs[i]).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5"/>`)).join('');
      return `<g class="rs-line s${slot}"><path d="${d}"/>${dots}${label}</g>`;
    }).join('');
    // hover: one band per control with every picked runner's time behind, leg time and leg rank
    const bands = xs.map((t, i) => {
      if (!i) return '';
      const x0 = x((xs[i - 1] + t) / 2), x1 = i < xs.length - 1 ? x((t + xs[i + 1]) / 2) : W - R;
      const j = i - 1;
      const rows = picked.map((r) => {
        const leg = st.legs[c.runners.indexOf(r)][j], at = r.splits[j];
        return { r, slot: rs.picked.get(rsKey(r)), at, leg, cr: st.cumRank(j, at), lr: st.rank(j, leg),
          cg: at !== null && at !== undefined ? at - st.cumBest[j] : null, lg: leg !== null ? leg - st.best[j] : null };
      }).sort((a, b) => (a.cr ?? 1e9) - (b.cr ?? 1e9));
      const gap = (v) => (v === null ? '–' : v === 0 ? '<span class="tt-top">ראשון</span>' : `<bdi dir="ltr">${fmtSec(v, true)}</bdi>`);
      const ctl = c.controls[j];
      const html = `<div class="tt-head">נקודה ${esc(shortCtl(ctl))}${/\((\d+)\)/.test(ctl) ? ` <span>(${esc(/\((\d+)\)/.exec(ctl)[1])})</span>` : ''}</div>
        <table class="tt"><thead><tr><th></th><th colspan="3">כללי</th><th colspan="3">מקטע</th>${c.lap ? '<th colspan="2">LapCombat</th>' : ''}</tr>
        <tr class="sub"><th></th><th>זמן</th><th>מקום</th><th>פער</th><th>זמן</th><th>מקום</th><th>פער</th>${c.lap ? '<th title="Leg speed index">מהירות</th><th title="Leg mistake time">טעות</th>' : ''}</tr></thead><tbody>${rows.map((x) => `<tr>
          <th><i class="tt-sw s${x.slot}"></i>${esc(x.r.name)}</th>
          <td class="n">${x.at === null || x.at === undefined ? '–' : `<bdi dir="ltr">${fmtSec(x.at)}</bdi>`}</td><td class="n">${x.cr ?? '–'}</td><td class="n">${gap(x.cg)}</td>
          <td class="n">${x.leg === null ? '–' : `<bdi dir="ltr">${fmtSec(x.leg)}</bdi>`}</td><td class="n">${x.lr ?? '–'}</td><td class="n">${gap(x.lg)}</td>${c.lap ? `<td class="n lap ${speedCls(x.r.speed?.[j])}">${fmtSpeed(x.r.speed?.[j])}</td><td class="n lap ${mistakeCls(x.r.mistake?.[j])}"><bdi dir="ltr">${fmtMistake(x.r.mistake?.[j])}</bdi></td>` : ''}</tr>`).join('')}</tbody></table>`;
      const tip = [`נקודה ${shortCtl(ctl)}:`, ...rows.map((x) => `${x.r.name}\tכללי ${x.at === null || x.at === undefined ? '–' : fmtSec(x.at)} – ${x.cr ?? '–'} (${x.cg === null ? '–' : fmtSec(x.cg, true)}) · מקטע ${fmtSec(x.leg)} – ${x.lr ?? '–'} (${x.lg === null ? '–' : fmtSec(x.lg, true)})${c.lap ? ` · מהירות ${fmtSpeed(x.r.speed?.[j])} · טעות ${fmtMistake(x.r.mistake?.[j])}` : ''}`)].join('\n');
      return `<rect class="rs-band" x="${x0}" y="${T}" width="${Math.max(2, x1 - x0)}" height="${H - T - B}" data-tip="${esc(tip)}" data-tip-html="${esc(html)}" tabindex="-1"/>`;
    }).join('');
    return `<svg class="rs-chart" viewBox="0 0 ${W} ${H}" role="img" dir="ltr" aria-label="${esc(`${ref.mode === 'winner' ? `פער מהמנצח (${ref.name}) בכל נקודה` : 'פער מהזמן הטוב ביותר בכל נקודה (סכום המקטעים המהירים)'}, ל-${picked.length} מתחרים. הנתונים בטבלת המקטעים שמתחת.`)}">
      <g>${grid}${cols}</g><line class="rs-zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>${lines}<g>${bands}</g></svg>`;
  }

  function renderResultFile() {
    const d = rs.data, page = rsTarget();
    const ev = rs.event;
    const back = ev ? `<a class="btn ghost" href="#event/${encodeURIComponent(ev.id)}">→ לעמוד התחרות</a>` : '';
    const title = ev ? (ev.calPlace && ev.calDesc ? `${ev.calPlace} – ${ev.calDesc}` : ev.title) : d.title || 'תוצאות';
    const date = ev ? fmtLong(evDate(ev)) : d.date;
    if (!d.courses?.length) {
      page.innerHTML = `${rs.inGroup ? '' : `<div class="section-head"><h1 id="rsTitle">${esc(title)}</h1>${back}</div>`}
        <p class="empty">את הקובץ הזה עוד לא אנחנו יודעים להציג. <a href="${esc(rs.key)}" target="_blank" rel="noopener">לפתיחת הקובץ המקורי ↗</a></p>
        ${d.diag ? `<details class="diag"><summary>פרטים טכניים</summary><pre dir="ltr">${esc(JSON.stringify({ url: rs.key, ...d.diag }, null, 2))}</pre></details>` : ''}`;
      return;
    }
    const c = course();
    const st = hasSplits(c) ? legStats(c) : null;
    const ref = st ? referenceOf(c, st, rs.refMode) : null;
    const lead = c.runners.find((r) => r.status === 'OK' && r.time);
    const q = rs.q.trim().toLowerCase();
    const shown = c.runners.filter((r) => !q || `${r.name} ${r.club}`.toLowerCase().includes(q));
    const picked = c.runners.filter((r) => rs.picked.has(rsKey(r)));
    const legend = picked.map((r) => `<button type="button" class="rs-chip s${rs.picked.get(rsKey(r))}" data-unpick="${esc(rsKey(r))}" aria-label="${esc(`הסרת ${r.name} מהגרף`)}"><i aria-hidden="true"></i>${esc(r.name)} <span aria-hidden="true">×</span></button>`).join('');
    page.innerHTML = `
      ${rs.inGroup ? `<p class="rs-orig"><a href="${esc(rs.key)}" target="_blank" rel="noopener">הקובץ המקורי ↗</a></p>` : `<div class="section-head"><div><h1 id="rsTitle">${esc(title)}</h1><p class="muted">${esc(date || '')}</p></div>
        <div class="rs-actions">${back}<a class="btn ghost" href="${esc(rs.key)}" target="_blank" rel="noopener">הקובץ המקורי ↗</a></div></div>`}
      ${categoryBar(d.courses.map((x, i) => ({ name: x.name, html: `<button type="button" data-course="${i}" aria-pressed="${i === rs.course}">${esc(x.name)}${x.runners.some((r) => isMinePerson(r.name)) ? ' ★' : ''}</button>` })), 'מסלול / קטגוריה')}
      <p class="muted small rs-info">${[c.info && `<bdi dir="ltr">${esc(c.info)}</bdi>`, `סיימו ${c.runners.filter((r) => r.status === 'OK').length} מתוך ${c.runners.length}`].filter(Boolean).join(' · ')}</p>
      ${hasSplits(c) && ref ? `<section class="ev-card rs-graph" aria-labelledby="rsg-h">
        <div class="rs-graph-head"><h2 id="rsg-h">${ref.mode === 'winner' ? 'פער מהמנצח בכל נקודה' : 'פער מהמהיר ביותר בכל מקטע'}</h2>
          <div class="seg rs-refmode" role="group" aria-label="קו הייחוס של הגרף">${[['fastest', 'מול המהיר בכל מקטע'], ['winner', 'מול המנצח']].map(([m, t]) => `<button type="button" data-refmode="${m}" aria-pressed="${ref.mode === m}">${t}</button>`).join('')}</div></div>
        <p class="muted small">${ref.mode === 'winner'
          ? `קו הייחוס (0) – ${esc(ref.name)}. קו שטוח – אותו קצב כמוהו; קו שיורד – הפסד זמן מולו באותו מקטע; קו שעולה – רווח.`
          : 'קו הייחוס (0) – הזמן המהיר ביותר בכל מקטע. קו שטוח – המהיר ביותר באותו מקטע; קו שיורד – הזמן שהפסיד לו.'} ריחוף על נקודה מציג זמן, מקום ופער כלליים ובמקטע.</p>
        <div class="rs-legend">${legend}</div>
        <div class="rs-chart-wrap">${chartSvg(c, ref, st)}</div>
        ${picked.length ? legsTableHtml(c, st, picked) : ''}
      </section>` : ''}
      <section class="ev-card rs-table-card" aria-labelledby="rst-h">
        <div class="rs-table-head"><h2 id="rst-h">תוצאות – ${esc(c.name)}</h2>
          <label class="rs-search"><span class="sr-only">חיפוש מתחרה או מועדון</span><input type="search" id="rsQ" placeholder="חיפוש שם או מועדון" value="${esc(rs.q)}"></label></div>
        <div class="rs-table-wrap"><table class="rs-table">
          <thead><tr>${hasSplits(c) ? '<th scope="col"><span class="sr-only">בגרף</span></th>' : ''}<th scope="col">מקום</th><th scope="col">שם</th><th scope="col">מועדון</th><th scope="col">זמן</th><th scope="col">פער</th></tr></thead>
          <tbody>${shown.map((r) => {
            const mine = isMinePerson(r.name);
            const k = rsKey(r);
            const slot = rs.picked.get(k);
            return `<tr class="${mine ? 'mine' : ''}${r.status !== 'OK' ? ' out' : ''}">
              ${hasSplits(c) ? `<td><label class="rs-pick${slot !== undefined ? ` s${slot}` : ''}"><input type="checkbox" data-pick="${esc(k)}" ${slot !== undefined ? 'checked' : ''} aria-label="${esc(`הצגת ${r.name} בגרף`)}"><i aria-hidden="true"></i></label></td>` : ''}
              <td class="num">${esc(r.pos || '')}</td>
              <td>${mine ? '<span class="rs-star" aria-label="מהאנשים שלי">★</span> ' : ''}${esc(r.name)}</td>
              <td class="muted club">${esc(r.club)}</td>
              <td class="num"><bdi>${r.status === 'OK' ? fmtSec(r.time) : `<span class="rs-status" title="${esc(STATUS_HE[r.status] || r.status)}">${esc(r.status)}</span>`}</bdi></td>
              <td class="num muted"><bdi>${r.status === 'OK' && lead && r !== lead ? fmtSec(r.time - lead.time, true) : ''}</bdi></td></tr>`;
          }).join('') || '<tr><td colspan="6" class="muted">אין תוצאות לחיפוש.</td></tr>'}</tbody></table></div>
      </section>`;
  }

  function initResultsView() {
    const page = $('#resultsPage');
    page.addEventListener('click', (ev) => {
      const gi = ev.target.closest('[data-gitem]');
      if (gi) { openGroupItem(+gi.dataset.gitem); return; }
      const b = ev.target.closest('[data-course]');
      if (b) { rs.course = +b.dataset.course; rs.q = ''; pickDefaults(); renderResultFile(); $(`[data-course="${rs.course}"]`)?.focus(); return; }
      const lr = ev.target.closest('[data-legrow]');
      if (lr) {
        const k = lr.dataset.legrow, shown = [...document.querySelectorAll('[data-legrow][aria-pressed="true"]')].map((x) => x.dataset.legrow);
        const next = shown.includes(k) ? shown.filter((x) => x !== k) : [...shown, k];
        if (!next.length) return; // keep at least one row
        rs.legRows = LEG_ROWS.map(([x]) => x).filter((x) => next.includes(x));
        store.set('rsLegRows', rs.legRows); renderResultFile(); $(`[data-legrow="${k}"]`)?.focus(); return;
      }
      const m = ev.target.closest('[data-refmode]');
      if (m) { rs.refMode = m.dataset.refmode; store.set('rsRefMode', rs.refMode); renderResultFile(); $(`[data-refmode="${rs.refMode}"]`)?.focus(); return; }
      const u = ev.target.closest('[data-unpick]');
      if (u) { rs.picked.delete(u.dataset.unpick); renderResultFile(); }
    });
    page.addEventListener('change', (ev) => {
      const cb = ev.target.closest('[data-pick]');
      if (!cb) return;
      const r = course().runners.find((x) => rsKey(x) === cb.dataset.pick);
      if (r && !togglePick(r)) { cb.checked = false; alert(`אפשר להשוות עד ${RS_COLORS} מתחרים בגרף. הסירו אחד קודם.`); return; }
      const y = scrollY; renderResultFile(); scrollTo(0, y);
      $(`[data-pick="${CSS.escape(cb.dataset.pick)}"]`)?.focus();
    });
    page.addEventListener('input', (ev) => {
      if (ev.target.id !== 'rsQ') return;
      rs.q = ev.target.value; const pos = ev.target.selectionStart;
      renderResultFile(); const i = $('#rsQ'); i.focus(); i.setSelectionRange(pos, pos);
    });
  }

  /* ---------- Boot ---------- */
  async function loadJson(path) {
    const r = await fetch(path, { cache: 'no-cache' });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.error || `${path}: ${r.status}`), { diag: body.diag });
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
    initHome();
    initLightbox();
    initTooltip();
    initPeople();
    initHelp();
    initInfo();
    initMoreEvents();
    initDiscFilter();
    initRegFilter();
    initResultsView();
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
    renderRecentResults();
    if (/^#(event|forum)\//.test(location.hash)) route();
    // a results page opened before the events arrived: draw it again with the event (its title, its files)
    if (/^#results\//.test(location.hash) && (rs.inGroup || !rs.event)) route();
    checkInView();
  }

  /* ---------- Checking events as they come into view ---------- */
  // Events from the calendar arrive without their page. Their "מידע נוסף" is checked only when they
  // enter the shown months (the first two, then two more per "show more"), and the answer is kept here.
  const FLAGS_KEY = 'evflags2', FLAGS_TTL = 12 * 3600e3;
  const flagCache = (() => {
    let all = store.get(FLAGS_KEY, {});
    const now = Date.now();
    all = Object.fromEntries(Object.entries(all || {}).filter(([, v]) => v && now - v.t < FLAGS_TTL));
    return {
      get: (id) => all[id],
      set: (id, v) => { all[id] = { ...v, t: Date.now() }; store.set(FLAGS_KEY, all); },
    };
  })();
  const listUntil = () => { const d = startOfDay(new Date()); d.setMonth(d.getMonth() + state.listMonths); return d; };
  /** Upcoming events within the shown months whose "מידע נוסף" was not checked yet. */
  function uncheckedInView() {
    const today = startOfDay(new Date()), until = listUntil();
    return state.events.filter((e) => e.nivutId && !e.details && !e.checked && e.source !== 'closed-area'
      && parseDate(e.date) >= today && parseDate(e.date) < until);
  }
  async function checkEvents(list) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => {
      while (i < list.length) {
        const e = list[i++];
        e.checked = true;
        // A remembered "hide it" needs no request; everything else loads its page for the card's details.
        const cached = flagCache.get(e.nivutId);
        if (cached && (cached.c || cached.n)) { e.closed = cached.c; e.noSiteRegistration = cached.n; continue; }
        try {
          applyDetails(e, await loadJson(`api/event?id=${encodeURIComponent(e.nivutId)}`));
          flagCache.set(e.nivutId, { c: isClosedEvent(e), n: noSiteRegistration(e) });
        } catch { /* shown as is */ }
      }
    }));
  }
  /** Loads the pages of the events now in view, then redraws the cards with their details. */
  async function checkInView() {
    const todo = uncheckedInView();
    if (!todo.length) return false;
    await checkEvents(todo);
    // Redraw always: besides hiding events, the cards now have their start times, place, distance and countdown.
    renderTop4(); renderList(); renderYear(); renderMonth();
    return true;
  }

  boot();
})();
