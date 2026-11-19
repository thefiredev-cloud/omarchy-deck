// TV view: the opt-in 10-foot deck driven by a remote (DESIGN-v3 section 5, UiApi 1.5). Owner: lane ShellTv.
// app.js sets html.tv (?view=tv or the stored switch) and calls DeckTV.refresh() after every route change. This file owns
// the remote keys (arrows, Enter, Back) while html.tv is set, the focus trap inside an open sheet, the .board fit, the
// ?press= test hook and the one-time "Use TV view?" prompt on a TV browser (never an automatic switch).
'use strict';
// ==== TV CORE BEGIN (pure: rectangles and strings in, decisions out; tests/shell_tv.test.js loads this block) ====
const TvCore = (() => {
  const DIRS = { ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right', Down: 'down', Up: 'up', Left: 'left', Right: 'right' };
  const CODES = { 40: 'down', 38: 'up', 37: 'left', 39: 'right', 13: 'enter' };
  // Back: Escape, Backspace, GoBack and BrowserBack (Android TV, 166), Tizen XF86Back (10009), webOS (461)
  const BACK_KEYS = ['Escape', 'Esc', 'Backspace', 'GoBack', 'BrowserBack', 'XF86Back'];
  const BACK_CODES = [10009, 461, 166];
  const TV_UA = /SMART-TV|SmartTV|Tizen|Web0S|webOS|NetCast|BRAVIA|GoogleTV|Google TV|Android TV|AFT[A-Z]|HbbTV|CrKey|Roku|VIDAA/i;
  function keyOf(e) {
    if (!e) return null;
    const k = e.key || '', c = Number(e.keyCode || e.which || 0);
    if (DIRS[k]) return DIRS[k];
    if (k === 'Enter' || k === 'Select') return 'enter';
    if (BACK_KEYS.includes(k) || BACK_CODES.includes(c)) return 'back';
    return k && k !== 'Unidentified' ? null : CODES[c] || null;
  }
  // ?press=DDRE: D down, U up, L left, R right, E Enter, B Back; anything else is ignored, at most 64 presses
  const PRESS = { D: 'down', U: 'up', L: 'left', R: 'right', E: 'enter', B: 'back' };
  function parsePress(s) {
    const out = [];
    for (const ch of String(s == null ? '' : s).toUpperCase()) if (PRESS[ch] && out.length < 64) out.push(PRESS[ch]);
    return out;
  }
  // One headline a board (PlanDesign M8): the figure and the words that answer the board's question, read from across a
  // room. n is the count the page itself shows (tv.js reads it from the page); null or a non-count means no headline,
  // never a guessed zero.
  const LEAD_WORDS = {
    needs: ['needs you', 'need you'],
    failing: ['failing', 'failing'],
    returns: ['return window open', 'return windows open'],
    jobs: ['job matches', 'jobs match'],
    gigs: ['gig', 'gigs'],
    look: ['needs a look', 'need a look'],
  };
  function leadText(kind, n) {
    const w = LEAD_WORDS[kind];
    if (!w || typeof n !== 'number' || !Number.isFinite(n) || n < 0 || Math.floor(n) !== n) return null;
    return { v: n.toLocaleString('en-US'), w: w[n === 1 ? 0 : 1] };
  }
  // the first whole number in a page's own words ("Show 3 more" gives 3); with after = 'of', the first number after that
  // word ("Showing 12 of 1,200 · 418 with no stated pay left out" gives 1200, never the 418 a filter left out)
  function countIn(s, after) {
    let t = String(s == null ? '' : s).replace(/(\d),(?=\d{3}\b)/g, '$1');
    if (after) { const i = t.search(new RegExp('\\b' + after + '\\s+\\d')); if (i < 0) return null; t = t.slice(i + after.length); }
    const m = t.match(/\d+/);
    return m ? Number(m[0]) : null;
  }
  // the prompt shows once, only on a TV user agent, only when TV view is off; answering is never required
  function shouldAsk(ua, tvOn, asked) { return !tvOn && !asked && TV_UA.test(String(ua || '')); }
  // Back closes the open sheet first; with nothing open it returns focus to the active tab
  function backAction(modalOpen) { return modalOpen ? 'close' : 'tab'; }
  // A Back key waits BACK_WAIT ms: when the browser took the same press as history back, a popstate lands inside that
  // window and the sheet host has already closed one level, so the key does nothing more (one level per press, never two).
  const BACK_WAIT = 200;
  function backTaken(popAt, keyAt, wait) { return popAt >= keyAt && popAt - keyAt <= (wait == null ? BACK_WAIT : wait); }
  // popstate on TV: a null state is the boot entry under tv.js's guard, so browser Back popped the guard; tv.js puts the
  // guard back and runs one Back level. Any other state belongs to the sheet host (FoundationShell2), which closes its own.
  function popAction(state, modalOpen) { return state != null ? 'none' : modalOpen ? 'close' : 'tab'; }
  // Game controller, the convention of the owner's own TV page (Mesh OS): standard-mapping buttons 12 13 14 15 = up down
  // left right, 0 = OK (Enter), 1 = Back; left stick axes 0 and 1 past a 0.55 deadzone count as a direction (the d-pad
  // wins over the stick); a held direction repeats after 420 ms, then every 130 ms. OK and Back fire once per press.
  const PAD = { up: 12, down: 13, left: 14, right: 15, ok: 0, back: 1, dead: 0.55, delay: 420, every: 130 };
  const pressed = (b) => b === true || (typeof b === 'number' ? b > 0.5 : !!b && (b.pressed === true || Number(b.value) > 0.5));
  function padRead(pads) {
    const list = (pads || []).filter((p) => p && p.connected !== false);
    if (!list.length) return null;
    const out = { dir: null, ok: false, back: false };
    for (const p of list) {
      const b = p.buttons || [], a = p.axes || [];
      const dpad = ['up', 'down', 'left', 'right'].find((k) => pressed(b[PAD[k]]));
      let stick = null;
      const x = Number(a[0]) || 0, y = Number(a[1]) || 0;
      if (Math.max(Math.abs(x), Math.abs(y)) > PAD.dead) stick = Math.abs(x) >= Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
      if (!out.dir) out.dir = dpad || stick;
      out.ok = out.ok || pressed(b[PAD.ok]);
      out.back = out.back || pressed(b[PAD.back]);
    }
    return out;
  }
  const padInit = () => ({ dir: null, next: 0, ok: false, back: false });
  // one poll: state and the reading (null when no pad is present) in, new state and the actions to run out
  function padStep(state, input, now) {
    const s = state || padInit(), fire = [];
    if (!input) return { state: padInit(), fire };
    const next = { dir: input.dir, next: s.next, ok: input.ok, back: input.back };
    if (input.dir && input.dir !== s.dir) { fire.push(input.dir); next.next = now + PAD.delay; }
    else if (input.dir && now >= s.next) { fire.push(input.dir); next.next = now + PAD.every; }
    if (!input.dir) next.next = 0;
    if (input.ok && !s.ok) fire.push('enter');
    if (input.back && !s.back) fire.push('back');
    return { state: next, fire };
  }
  // Tab inside an open sheet cycles through its focusables and never leaves it
  function trapNext(count, index, back) {
    if (!count) return -1;
    if (index < 0) return back ? count - 1 : 0;
    return (index + (back ? -1 : 1) + count) % count;
  }
  const horiz = (d) => d === 'left' || d === 'right';
  const span = (r, h) => (h ? r.r - r.l : r.b - r.t);
  const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
  // c lies past a in direction d; the tolerance absorbs the 1.04 lift of the focused element and hairline overlaps
  function ahead(d, a, c) {
    const h = horiz(d), tol = 0.3 * Math.min(span(a, h), span(c, h));
    const ac = h ? (a.l + a.r) / 2 : (a.t + a.b) / 2, cc = h ? (c.l + c.r) / 2 : (c.t + c.b) / 2;
    if (d === 'down') return c.t >= a.b - tol && cc > ac;
    if (d === 'up') return c.b <= a.t + tol && cc < ac;
    if (d === 'right') return c.l >= a.r - tol && cc > ac;
    return c.r <= a.l + tol && cc < ac;
  }
  // main-axis distance edge to edge; cross-axis distance edge to edge (0 when they share the column or row), plus a tenth
  // of the centre offset so the stop under the middle wins a tie and a wide scroller beside a small button is not punished
  function gap(d, a, c) { return Math.max(0, d === 'down' ? c.t - a.b : d === 'up' ? a.t - c.b : d === 'right' ? c.l - a.r : a.l - c.r); }
  function cross(d, a, c) {
    const h = horiz(d), lo = h ? 't' : 'l', hi = h ? 'b' : 'r';
    return Math.max(0, -overlap(a[lo], a[hi], c[lo], c[hi])) + 0.1 * Math.abs((c[lo] + c[hi]) / 2 - (a[lo] + a[hi]) / 2);
  }
  const crossOverlap = (d, a, c) => (horiz(d) ? overlap(a.t, a.b, c.t, c.b) : overlap(a.l, a.r, c.l, c.r));
  const shared = (p, q) => { let i = 0; const n = Math.min(p.length, q.length); while (i < n && p[i] === q[i]) i++; return i; };
  function best(d, a, list) {
    let win = null, ws = Infinity;
    for (const c of list) { const s = gap(d, a, c) + 3 * cross(d, a, c); if (s < ws) { ws = s; win = c; } }
    return win;
  }
  // The candidate the remote moves to from rectangle `cur` in direction d, as an index into `cands`, or -1.
  // Rectangles are {l, t, r, b}; `path` (optional) lists the element's ancestors from the root, so cards in one grid
  // finish their grid before the remote leaves it.
  // Left and Right stay in the row. Up and Down: the nearest candidate in the cone (sharing the column) wins, by
  // main-axis distance plus three times cross-axis distance; when no candidate lies in the cone, the nearest one in
  // the next row band wins, so no card is skipped (CRITIQUE 3: Huntington Pier alone under a three-card row).
  function pick(d, cur, cands) {
    const list = [];
    cands.forEach((c, i) => { if (c && c !== cur && ahead(d, cur, c)) list.push(Object.assign({ i }, c)); });
    if (!list.length) return -1;
    if (horiz(d)) {
      const row = list.filter((c) => crossOverlap(d, cur, c) > 0);
      const w = best(d, cur, row);
      return w ? w.i : -1;
    }
    const cp = cur.path || [];
    let deep = -1;
    for (const c of list) { c.depth = shared(cp, c.path || []); if (c.depth > deep) deep = c.depth; }
    const inner = list.filter((c) => c.depth === deep);
    const cone = inner.filter((c) => crossOverlap(d, cur, c) > 0);
    if (cone.length) return best(d, cur, cone).i;
    let n0 = inner[0];
    for (const c of inner) if (gap(d, cur, c) < gap(d, cur, n0)) n0 = c;
    const band = inner.filter((c) => overlap(c.t, c.b, n0.t, n0.b) > 0.3 * Math.min(c.b - c.t, n0.b - n0.t));
    return best(d, cur, band.length ? band : [n0]).i;
  }
  return { keyOf, parsePress, shouldAsk, backAction, backTaken, popAction, trapNext, pick, ahead, padRead, padStep, padInit, leadText, countIn, PAD, BACK_WAIT, TV_UA };
})();
// ==== TV CORE END ====

const DeckTV = (() => {
  const d = document, html = d.documentElement;
  const isTv = () => html.classList.contains('tv');
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; };
  // summary: a <details> toggle (Gigs' "Draft pitch", Jobs' "5 more categories") is a stop like a button (SeeAccess A16)
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
  const MODALS = 'dialog[open],#sheet.on,#viewer.on,[role="dialog"][aria-modal="true"]';
  const CLOSERS = '.sheet-x,#sheetx,#vclose,[data-cre-close],[data-close],button[aria-label^="Close"]';
  const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  // a stop the board clips away (it starts below the board's bottom edge) is not a stop: the remote never lands off screen
  const clipped = (el) => { const b = isTv() && el.closest('.board'); return !!b && el.getBoundingClientRect().top >= b.getBoundingClientRect().bottom - 1; };
  const usable = (el) => visible(el) && !el.closest('[hidden],[inert],[data-tv-skip],[aria-hidden="true"]') && !clipped(el);
  const typing = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const focusables = (scope) => (scope ? [...scope.querySelectorAll(FOCUSABLE)].filter(usable) : []);
  const modal = () => {
    const open = [...d.querySelectorAll(MODALS)].filter(visible);
    return open.find((m) => m.contains(d.activeElement)) || open[open.length - 1] || null;
  };
  const activePage = () => [...d.querySelectorAll('#pager>.page,.page')].find((p) => !p.hidden && visible(p)) || null;
  const activeTab = () => d.querySelector('#pgs button[data-p].on') || d.querySelector('#pgs button[data-p]');
  const head = () => { const p = activePage(); return p && p.querySelector('.phead'); };
  const activeSub = () => { const h = head(); return h ? [...h.querySelectorAll('.subrow button')].filter(usable).find((b) => b.classList.contains('on') || b.getAttribute('aria-selected') === 'true') || null : null; };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  const path = (el) => { const p = []; for (let n = el.parentElement; n; n = n.parentElement) p.unshift(n); return p; };
  const zoneOf = (el) => {
    if (!el || el === d.body) return 'none';
    if (el.closest('#top')) return 'top';
    const h = head();
    if (h && h.contains(el)) return 'head';
    const p = activePage();
    return p && p.contains(el) ? 'content' : 'none';
  };
  const zone = (z) => {
    if (z === 'top') return focusables(d.getElementById('top'));
    const h = head();
    if (z === 'head') return focusables(h);
    return focusables(activePage()).filter((el) => !(h && h.contains(el)));
  };
  let lastKey = '';
  function put(el, from) {
    if (!el) return false;
    try { el.focus({ preventScroll: true, focusVisible: true }); } catch (e) { el.focus(); }
    const board = el.closest('.board'), fromBoard = from && from.closest && from.closest('.board');
    if (board && !modal() && (!fromBoard || scrollY > 0) && el.getBoundingClientRect().bottom <= innerHeight) scrollTo(0, 0);
    else if (fromBoard && !board) el.scrollIntoView({ block: 'start', inline: 'nearest' });
    else el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }
  function choose(dir, cur, list) {
    const c = rect(cur);
    c.path = path(cur);
    const cands = list.map((el) => { const r = rect(el); r.path = path(el); return r; });
    const i = TvCore.pick(dir, c, cands);
    return i < 0 ? null : list[i];
  }
  // a sheet's sections are remote stops, so a chart under the action bar can be reached and scrolled into view
  function markSections(m) {
    if (!m) return;
    for (const s of m.querySelectorAll('.sh-sec,.sheet-b>section')) if (!s.hasAttribute('tabindex')) { s.tabIndex = 0; s.dataset.tvSec = ''; }
  }
  // a focused scroller (the legacy #sheetb, a long sheet body) scrolls by 60% before Up or Down leaves it
  function scrollStep(n, dir) {
    if (!n || n.scrollHeight <= n.clientHeight + 1 || !/(auto|scroll)/.test(getComputedStyle(n).overflowY)) return false;
    const before = n.scrollTop;
    n.scrollTop += (dir === 'down' ? 1 : -1) * n.clientHeight * 0.6;
    return n.scrollTop !== before;
  }
  function move(dir) {
    const m = modal();
    let cur = d.activeElement && d.activeElement !== d.body && usable(d.activeElement) ? d.activeElement : null;
    if (m) {
      markSections(m);
      const list = focusables(m);
      if (!cur || !m.contains(cur)) return put(list[0] || m);
      if ((dir === 'up' || dir === 'down') && scrollStep(cur, dir)) return true;
      const next = choose(dir, cur, list);
      if (next) return put(next, cur);
      if (dir === 'up' || dir === 'down') scrollStep(cur.closest('.sheet-b,#sheetb'), dir);
      return false;
    }
    if (!cur) { if (restore()) return true; return put(activeTab()); }
    const z = zoneOf(cur);
    if (z === 'none') return put(activeTab());
    if (z === 'top') {
      if (dir === 'up') return false;
      if (dir === 'down') return put(activeSub() || choose(dir, cur, zone('content')), cur);
      return put(choose(dir, cur, zone('top')), cur);
    }
    if (z === 'head') {
      if (dir === 'up') return put(activeTab(), cur);
      return put(choose(dir, cur, dir === 'down' ? zone('content') : zone('head')), cur);
    }
    const next = choose(dir, cur, zone('content'));
    if (next) return put(next, cur);
    if (dir === 'up') return put(activeSub() || choose(dir, cur, zone('head')) || activeTab(), cur);
    // past the last stop Down still scrolls to show what is below it, but never so far that the focused stop leaves the
    // screen: at most until it reaches the top inset (SeeAccess A18: Fleet's Show more went off the top after one press)
    if (dir === 'down') {
      const room = cur.getBoundingClientRect().top - (parseFloat(getComputedStyle(cur).scrollMarginTop) || 0);
      if (room > 1) scrollBy(0, Math.min(innerHeight * 0.6, room));
    }
    return false;
  }
  // a legacy sheet with no close button closes on its own Escape listener; synth keeps onKey out of that replay
  let synth = false;
  // the v3 sheet host owns a history entry per level ({deckSheet: n}); its close() pops that entry itself
  const hostSheet = () => !!(history.state && typeof history.state.deckSheet === 'number' && window.DeckShell && DeckShell.sheet && typeof DeckShell.sheet.close === 'function');
  let popAt = -1, selfPopUntil = 0;
  function closeTop(m) {
    if (hostSheet()) { selfPopUntil = performance.now() + 600; DeckShell.sheet.close(); }
    else {
      const x = [...m.querySelectorAll(CLOSERS)].find(usable);
      if (x) x.click();
      else if (typeof m.close === 'function') m.close();
      else { synth = true; try { m.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); } finally { synth = false; } }
    }
    requestAnimationFrame(() => { if (!modal() && (d.activeElement === d.body || !usable(d.activeElement))) restore() || put(activeTab()); });
  }
  function back() {
    const m = modal();
    if (TvCore.backAction(!!m) === 'close') return closeTop(m);
    scrollTo(0, 0);
    put(activeTab());
  }
  // a Back key or pad press: one level, unless the browser already took the press as history back (popstate inside the wait)
  function requestBack() {
    const at = performance.now();
    setTimeout(() => { if (!TvCore.backTaken(popAt, at)) back(); }, TvCore.BACK_WAIT);
  }
  // browser Back on TV: the host closes its own level on a non-null state; a null state means the guard went, so put it
  // back and run one Back level after the host's own popstate listener has run
  function onPop(e) {
    if (!isTv()) return;
    // a link to a fragment (href="#…") pushes a new entry and fires popstate with a null state at a new address: that is
    // not Back, so that entry simply becomes the guard
    if (e.state == null && location.href !== guardAt) { try { history.replaceState({ deckTv: 1 }, ''); guardAt = location.href; } catch (err) {} return; }
    const now = performance.now();
    if (now > selfPopUntil) popAt = now;
    if (e.state != null) return;
    setTimeout(() => {
      guard();
      const m = modal();
      const act = TvCore.popAction(null, !!m && !(m.matches('dialog.sheet') && window.DeckShell && DeckShell.sheet));
      if (act === 'close') closeTop(m); else if (act === 'tab' && !m) back();
    }, 0);
  }
  // one guard entry above the boot entry, so browser Back on a TV never leaves the deck
  let guardAt = '';
  function guard() { try { if (history.state == null) { history.pushState({ deckTv: 1 }, ''); guardAt = location.href; } } catch (err) {} }
  // one action from a key or a pad: the same handlers for both
  function act(k, e) {
    if (k === 'enter') return enter(e);
    if (k === 'back') { requestBack(); return true; }
    move(k);
    return true;
  }
  // controller: polled only while html.tv, a pad is present and the page is visible
  let padRaf = 0, padState = TvCore.padInit();
  const pads = () => { try { return navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; } catch (err) { return []; } };
  function padTick(now) {
    padRaf = 0;
    const list = isTv() && !d.hidden ? pads() : [];
    const r = TvCore.padStep(padState, TvCore.padRead(list), now);
    padState = r.state;
    if (!list.length) return;
    for (const k of r.fire) act(k, null);
    padRaf = requestAnimationFrame(padTick);
  }
  function padStart() { if (!padRaf && isTv() && !d.hidden && pads().length) padRaf = requestAnimationFrame(padTick); }
  function padStop() { if (padRaf) cancelAnimationFrame(padRaf); padRaf = 0; padState = TvCore.padInit(); }
  // Enter activates the focused stop, a row that opens a sheet (tr[data-open]) included. tv.js clicks it itself because
  // some TV engines (and CDP key events) send keydown without the keypress that activates a button natively.
  function enter(e) {
    const t = d.activeElement;
    if (e && e.repeat) return false; // a held OK repeats keydown: one press is one activation (Home's second-tap lock, RevTodayHome)
    if (!t || t === d.body || typing(t) || t.dataset.tvSec !== undefined) return false;
    if (e) e.preventDefault();
    t.click();
    return true;
  }
  // the one-time prompt: its two buttons take Left, Right, Enter and Back even before TV view is on
  let ask = null;
  function askKey(k, e) {
    if (!ask || !ask.isConnected) return false;
    const bs = [...ask.querySelectorAll('button')];
    if (k === 'left' || k === 'right') { const i = bs.indexOf(d.activeElement); (bs[TvCore.trapNext(bs.length, i, k === 'left')] || bs[0]).focus(); }
    else if (k === 'back') ask.remove();
    else if (k === 'enter' && bs.includes(d.activeElement)) d.activeElement.click();
    else return false;
    e.preventDefault(); e.stopPropagation();
    return true;
  }
  function maybeAsk() {
    if (!TvCore.shouldAsk(navigator.userAgent, isTv(), store('tvAsked') === '1')) return;
    store('tvAsked', '1');
    ask = d.createElement('div');
    ask.className = 'tv-ask';
    ask.setAttribute('role', 'dialog');
    ask.setAttribute('aria-label', 'TV view');
    ask.innerHTML = '<p>Use TV view?</p><button type="button" class="btn btn-primary" data-tv-ask="1">Use TV view</button><button type="button" class="btn" data-tv-ask="0">Not now</button>';
    ask.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-tv-ask]');
      if (!b) return;
      if (b.dataset.tvAsk === '1') {
        store('view', 'tv');
        const r = window.DeckShell && DeckShell.route ? DeckShell.route().route : '';
        location.replace('/?view=tv' + (/^[a-z]{2,16}(\/[a-z]{2,16})?$/.test(r || '') ? '&p=' + r : ''));
      }
      ask.remove();
      ask = null;
    });
    d.body.appendChild(ask);
    ask.querySelector('button').focus();
  }
  function onKey(e) {
    if (synth || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = TvCore.keyOf(e);
    if (k && askKey(k, e)) return;
    if (!isTv()) return;
    if (e.key === 'Tab') {
      const m = modal();
      if (!m) return;
      const list = focusables(m), i = TvCore.trapNext(list.length, list.indexOf(d.activeElement), e.shiftKey);
      if (i >= 0) { e.preventDefault(); put(list[i]); }
      return;
    }
    if (!k) return;
    // a held OK or Back is one press: a repeat never arms a confirm action or closes a second level (only arrows repeat)
    if (e.repeat && (k === 'enter' || k === 'back')) { e.preventDefault(); e.stopPropagation(); return; }
    const t = e.target, m = modal();
    // text fields keep Left, Right, Enter and Backspace; the camera viewer keeps Left and Right to change camera
    if (typing(t) && (k === 'left' || k === 'right' || k === 'enter' || e.key === 'Backspace')) return;
    if (m && m.id === 'viewer' && (k === 'left' || k === 'right')) return;
    if (k === 'enter') {
      if (enter(e)) e.stopPropagation();
      return;
    }
    // preventDefault at once: a modal <dialog> closes itself on Escape keydown, which would be a second level
    e.preventDefault();
    e.stopPropagation();
    act(k, e);
  }
  // a stop outside an open sheet never keeps focus
  function onFocusIn(e) {
    const t = e.target;
    if (t && t.closest) { const k = t.closest('[data-key]'); if (k && !modal()) lastKey = k.getAttribute('data-key'); }
    if (!isTv()) return;
    const m = modal();
    if (m && t && !m.contains(t)) { markSections(m); put(focusables(m)[0] || m); }
  }
  // the same logical item (data-key) after a repaint, else nothing
  function restore() {
    if (!lastKey) return false;
    const p = activePage();
    if (!p) return false;
    const esc = window.CSS && CSS.escape ? CSS.escape(lastKey) : lastKey.replace(/["\\]/g, '\\$&');
    for (const k of p.querySelectorAll('[data-key="' + esc + '"]')) {
      const el = usable(k) && k.matches(FOCUSABLE) ? k : focusables(k)[0];
      if (el) return put(el);
    }
    return false;
  }
  // boards: their top edge feeds the height rule, then list rows that would cross the bottom edge are cut
  const LISTS = '.flist,.rank,.htbl tbody,.cards,.tv-list';
  const GRIDS = '.board-fill,.board .flow,.board .g12';
  // A coast segment is ~82 px at 1536, so a long region name sets the whole strip's height (four name lines made the panel
  // 285 px, RevSurfShop). A page may hand its own TV label with data-tv-short; these are the blueprint's long names, whose
  // two lines still locate the region. The full name stays in the title and the region card.
  const TV_SHORT = { 'Monterey and Santa Cruz': 'Monterey', 'San Francisco and Marin': 'SF and Marin', 'Sonoma to Del Norte': 'Sonoma Norte' };
  function shortCoast() {
    if (!isTv()) return;
    for (const s of d.querySelectorAll('.cs small')) {
      const full = s.dataset.tvFull || (s.dataset.tvFull = s.textContent.trim());
      const want = s.dataset.tvShort || TV_SHORT[full] || full;
      if (s.textContent.trim() !== want) s.textContent = want;
      const btn = s.closest('.cs');
      if (btn && !btn.title) btn.title = full;
    }
  }
  // ---- one headline a board (PlanDesign M8, SeeGlanceWide W7 and top five 4): a count the page already shows, set at the
  // display step at the head of the section it sums up, so the board answers its question from across a room. tv.js reads
  // the page's own words; when the page shows no count (still reading, not reporting) there is no headline, never a zero.
  // A board whose answer is already a figure (Money, Shop, Surf, Real estate, Fleet, Cluster, Dev) gets none; Pad keys has
  // no reading to give.
  const count = (el, last) => (el ? TvCore.countIn(el.textContent, last) : null);
  const LEADS = [
    // Today: the Needs you rows plus the "N more" row; zero only when the page itself says "Nothing needs you"
    { at: '#td-needs', kind: () => 'needs', read: (s) => {
      // a grouped row ("3 App Reviews to answer" with one chip per app, DeckUI.group) counts each member, not one
      const n = [...s.querySelectorAll('.frow.need')].reduce((a, r) => a + (r.querySelectorAll('.td-chips>*').length || 1), 0);
      if (n) return n + (count(s.querySelector('[data-open="today-needs"]')) || 0);
      return /Nothing needs you/.test(s.textContent) ? 0 : null;
    } },
    // Crons: the Failing filter's own count (the filter chips are a desk control, hidden on TV)
    { at: '#scsec', kind: () => 'failing', read: (s) => (s.closest('.broken') ? null : count(d.querySelector('#scf [data-f="failing"] small'))) },
    // Launch: what needs him, as the missions say it ("22 jobs need a look", "1 check is failing"; none: "Nothing failing
    // now", "Everything is green"); a part that is not available adds nothing, and both missing means no headline
    { at: '#missions', kind: () => 'look', read: (s) => {
      const part = (k) => { const c = s.querySelector('[data-m="' + k + '"] .cx'); if (!c) return null; const t = c.textContent; return /Nothing failing|Everything is green/.test(t) ? 0 : /not available/.test(t) ? null : count(c); };
      const a = part('crons'), b = part('ci');
      return a == null && b == null ? null : (a || 0) + (b || 0);
    } },
    // Shop > Orders: open return windows; zero only when the page says so
    { at: '.s-open', kind: () => 'returns', read: (s) => {
      const f = s.querySelector('.flist');
      if (!f) return null;
      if (/No open return windows/.test(f.textContent)) return 0;
      return f.querySelectorAll(':scope>.frow:not(.ostat)').length || null;
    } },
    // Work > Jobs and Gigs: the list's own total, the number after "of" ("Showing 12 of 1,200 · 418 with no stated pay left out")
    { at: '.jmain', kind: (s) => (s.querySelector('.glist') ? 'gigs' : 'jobs'), read: (s) => count(s.querySelector(':scope>.jcount'), 'of') },
  ];
  function placeLeads() {
    const p = isTv() && activePage();
    if (!p) return;
    for (const L of LEADS) for (const s of p.querySelectorAll(L.at)) {
      let el = s.firstElementChild && s.firstElementChild.classList.contains('tv-lead') ? s.firstElementChild : null;
      const t = s.closest('.board') ? TvCore.leadText(L.kind(s), L.read(s)) : null;
      if (!t) { if (el) el.remove(); continue; }
      const say = t.v + ' ' + t.w;
      if (el && el.dataset.lead === say) continue;
      if (!el) { el = d.createElement('p'); el.className = 'tv-lead'; s.prepend(el); }
      el.dataset.lead = say;
      const b = d.createElement('b'), w = d.createElement('span');
      b.textContent = t.v; w.textContent = t.w;
      el.replaceChildren(b, ' ', w);
    }
  }
  // Cluster: the board's strip says whether the engine runs and how loaded the nodes are; speed (with its last benchmark),
  // context and the proxy sit in the Engine column one Down press below. A second row copies those three tiles onto the
  // board, so the screen is not 80% black (W9). The copy only reads: no ids, no stops, hidden from the accessibility tree.
  const ROW2 = { board: '#clboard', from: '#cl1 .strip', labels: ['Speed', 'Context', 'Proxy'] };
  function copyRow() {
    const b = d.querySelector(ROW2.board), src = d.querySelector(ROW2.from);
    let row = b && b.querySelector(':scope>.tv-row2');
    const tiles = isTv() && b && src ? [...src.children].filter((t) => { const h = t.querySelector('.h'); return !!h && ROW2.labels.includes(h.textContent.trim()); }) : [];
    if (!tiles.length) { if (row) row.remove(); return; }
    const sig = tiles.map((t) => t.textContent).join('|');
    if (row && row.dataset.sig === sig) return;
    if (!row) {
      row = d.createElement('div');
      row.className = 'strip tv-row2';
      row.setAttribute('aria-hidden', 'true');
      const first = b.querySelector(':scope>.strip');
      if (first) first.after(row); else b.prepend(row);
    }
    row.dataset.sig = sig;
    row.dataset.n = row.dataset.nb = String(tiles.length);
    row.replaceChildren(...tiles.map((t) => {
      const c = t.cloneNode(true);
      for (const x of [c, ...c.querySelectorAll('[id]')]) x.removeAttribute('id');
      for (const x of c.querySelectorAll(FOCUSABLE + ',.diag')) x.remove();
      c.removeAttribute('tabindex');
      return c;
    }));
  }
  function fitBoards() {
    shortCoast();
    // the headline and Cluster's second row first: they take their room before rows are cut to the board's height
    placeLeads();
    copyRow();
    const boards = [...d.querySelectorAll('.board')];
    for (const b of boards) for (const x of b.querySelectorAll('[data-tv-cut]')) x.removeAttribute('data-tv-cut');
    if (!isTv()) { for (const b of boards) b.style.removeProperty('--tv-board-top'); return; }
    for (const b of boards) {
      if (!visible(b)) continue;
      b.style.setProperty('--tv-board-top', Math.round(b.getBoundingClientRect().top + scrollY) + 'px');
      const lim = b.getBoundingClientRect().bottom + 0.5;
      const end = (el) => { const box = el.closest('.board-fill'); return box && b.contains(box) ? Math.min(lim, box.getBoundingClientRect().bottom + 0.5) : lim; };
      const cut = (parents) => { for (const p of parents) { const e = end(p); for (const row of p.children) if (row.getBoundingClientRect().bottom > e) row.setAttribute('data-tv-cut', ''); } };
      // list rows first, then the sections of a board grid that still cross the bottom edge
      cut(b.querySelectorAll(LISTS));
      // a heading whose list lost every row says nothing on the board: it goes with its rows (Accounts: "Not captured
      // yet" with no row under it)
      for (const l of b.querySelectorAll(LISTS)) {
        const rows = [...l.children];
        if (!rows.length || rows.some((r) => !r.hasAttribute('data-tv-cut'))) continue;
        for (let h = l.previousElementSibling; h && h.matches('.secttl,h2,h3,h4'); h = h.previousElementSibling) h.setAttribute('data-tv-cut', '');
      }
      cut(b.querySelectorAll(GRIDS));
    }
  }
  function refresh() {
    fitBoards();
    if (!isTv()) return;
    const m = modal(), a = d.activeElement;
    if (m) { markSections(m); if (!m.contains(a)) put(focusables(m)[0] || m); return; }
    if (a && a !== d.body && usable(a)) return;
    restore() || put(activeTab());
  }
  async function replay(list) {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (const k of list) {
      await frame();
      if (k === 'back') back(); else if (k === 'enter') enter(null); else move(k);
    }
  }
  function boot() {
    addEventListener('keydown', onKey, true);
    d.addEventListener('focusin', onFocusIn);
    addEventListener('resize', () => { if (isTv()) fitBoards(); });
    // a page repaint drops the cut marks, and not every page calls DeckPages.tv() after it; re-fit once per 200 ms instead
    // of trusting every page, so a board never shows a half band or a stop it has clipped away
    if (isTv() && typeof MutationObserver === 'function') {
      let t = 0;
      new MutationObserver(() => {
        if (t) return;
        t = setTimeout(() => { t = 0; if (isTv()) fitBoards(); }, 200);
      }).observe(d.body, { childList: true, subtree: true });
    }
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(() => { if (isTv()) fitBoards(); });
    maybeAsk();
    addEventListener('gamepadconnected', padStart);
    addEventListener('gamepaddisconnected', () => { if (!pads().length) padStop(); });
    d.addEventListener('visibilitychange', () => { if (d.hidden) padStop(); else padStart(); });
    addEventListener('popstate', onPop);
    if (!isTv()) return;
    guard();
    padStart();
    requestAnimationFrame(() => {
      fitBoards();
      put(activeTab());
      const q = (window.DeckShell && typeof DeckShell.query === 'string' && DeckShell.query) || location.search;
      const presses = TvCore.parsePress(new URLSearchParams(q).get('press'));
      if (presses.length) replay(presses);
    });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
  return { refresh, move, back, core: TvCore };
})();
window.DeckTV = DeckTV;
