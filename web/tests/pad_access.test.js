// Pad and Keys, what a screen reader and voice control get (round Better, lane DoPad, 2026-11-15).
// A13: #kblist is a list whose children are all list items (axe aria-required-children, the access audit's one critical node).
// A5: a control's spoken name starts with the words on it, and holds them in order (axe label-content-name-mismatch).
// S13: the Pad's retry button says "Try again", the deck's one retry word.
// The DOM half runs static/pad.js against a small recording DOM; no socket is opened and no key is sent.
require('./setup-core.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const src = read('pad.js'), app = read('app.js'), html = read('index.html');
const P = require('../static/pad.js');

// axe's test, word for word: the visible words appear in the name as one run (curateTokens + isContiguousSubsequence)
const tokens = (s) => String(s || '').normalize('NFKD').replace(/\([^()]*\)/g, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const contains = (name, visible) => { const n = tokens(name), v = tokens(visible); if (!v.length) return true; for (let i = 0; i + v.length <= n.length; i++) if (v.every((w, j) => n[i + j] === w)) return true; return false };
// the stricter rule of this round: the name starts with the visible words
const startsWith = (name, visible) => { const n = tokens(name), v = tokens(visible); return v.every((w, i) => n[i] === w) };

test('spoken(): the words on the control first, then the detail; symbols alone read the detail; no word said twice', () => {
  assert.equal(P.spoken('Ctrl', 'Control'), 'Ctrl, Control');
  assert.equal(P.spoken('Back', 'Backspace'), 'Back, Backspace');
  assert.equal(P.spoken('PgUp', 'Page up'), 'PgUp, Page up');
  assert.equal(P.spoken('Right Alt', 'Right Alt, tap to dictate'), 'Right Alt, tap to dictate');
  assert.equal(P.spoken('Close', 'Close window'), 'Close window');
  assert.equal(P.spoken('\u2318', 'Command'), 'Command');
  assert.equal(P.spoken('Shift', ''), 'Shift');
  assert.equal(P.spoken('Shift', 'Shift'), 'Shift');
});

test('A5: every key cap on every key page says its own words first, for Mac and Omarchy', () => {
  for (const os of ['macos', 'linux']) for (const name of P.PAGES) for (const k of P.page(name, os)) {
    const shown = k.icon ? '' : k.label;
    assert.ok(startsWith(k.aria, shown), `${os} ${name} ${k.id}: "${k.aria}" does not start with "${shown}"`);
    assert.ok(contains(k.aria, shown), `${os} ${name} ${k.id}`);
  }
  const k = Object.fromEntries(P.page('keys', 'linux').concat(P.page('fn', 'linux'), P.page('media', 'linux')).map((x) => [x.id, x.aria]));
  assert.equal(k.ctrl, 'Ctrl, Control');
  assert.equal(k.backspace, 'Back, Backspace');
  assert.equal(k.ralt, 'Right Alt, tap to dictate');
  assert.equal(k.up, 'Arrow up', 'an arrow drawn as an icon keeps its name');
  assert.equal(k.voldown, 'Vol \u2212, Volume down');
});

test('a bind row and its pin read the same words in the order the row shows them', () => {
  assert.equal(P.bindLine('Super+Shift+Q', true), 'hold to send \u00B7 Super+Shift+Q');
  assert.equal(P.bindName('Log out', 'Super+Shift+Q', true), 'Log out, hold to send, Super+Shift+Q');
  assert.equal(P.bindLine('Super+F4', false), 'Super+F4');
  assert.equal(P.bindName('Overview', 'Super+F4', false), 'Overview, Super+F4');
  assert.ok(contains(P.bindName('Log out', 'Super+Shift+Q', true), 'Log out ' + P.bindLine('Super+Shift+Q', true)));
});

// ---------- a recording DOM, enough for pad.js ----------
function el(tag = 'div') {
  const cls = new Set(), attrs = {};
  const e = {
    tagName: tag.toUpperCase(), id: '', type: '', hidden: false, children: [], dataset: {}, style: { setProperty() {} }, _text: '', value: '', placeholder: '', offsetParent: {},
    classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), toggle: (c, on) => { (on === undefined ? !cls.has(c) : on) ? cls.add(c) : cls.delete(c) }, contains: (c) => cls.has(c) },
    get className() { return [...cls].join(' ') }, set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => cls.add(x)) },
    get textContent() { return e.children.length ? e.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('') : e._text }, set textContent(v) { e.children = []; e._text = String(v) },
    set innerHTML(v) { e.children = []; e._text = ''; e._html = String(v) }, get innerHTML() { return e._html || '' },
    setAttribute(k, v) { attrs[k] = String(v) }, getAttribute: (k) => (k in attrs ? attrs[k] : null), attrs,
    appendChild(c) { e.children.push(c); return c }, append(...c) { e.children.push(...c) }, replaceChildren(...c) { e.children = c },
    addEventListener() {}, querySelector: () => null, closest: () => null, setPointerCapture() {}, scrollIntoView() {}, setSelectionRange() {}, focus() {},
    getBoundingClientRect: () => ({ top: 120, left: 0, width: 800, height: 600 }),
  };
  return e;
}
const kids = (e) => e.children.filter((c) => typeof c !== 'string');
function boot({ target = 'pc-desktop', binds, favs = [], fail = false } = {}) {
  const els = new Map();
  const get = (s) => { if (!els.has(s)) { const x = el(); x.id = s.startsWith('#') ? s.slice(1) : ''; els.set(s, x) } return els.get(s) };
  const mcmd = get('#mcmd'); mcmd.dataset.m = 'cmd';
  const kpages = get('#kpages');
  const desc = (e) => kids(e).flatMap((c) => [c, ...desc(c)]);
  const document = {
    documentElement: el('html'), hidden: false,
    querySelector: get,
    querySelectorAll: (s) => s.includes('[data-m]') ? [...desc(kpages).filter((x) => x.dataset.m), mcmd] : s === '#kpages .kp' ? kids(kpages) : [],
    createElement: (t) => el(t), addEventListener() {},
  };
  const store = { padt: target, ['padfav:v1:' + target]: JSON.stringify(favs), getItem(k) { return this[k] == null ? null : this[k] }, setItem(k, v) { this[k] = String(v) } };
  const ctx = {
    document, localStorage: store, location: { protocol: 'https:', host: 'deck.test' }, navigator: {}, console, scrollY: 0,
    WebSocket: class { constructor() { this.readyState = 0 } send() {} close() {} },
    performance: { now: () => 0 }, requestAnimationFrame: (f) => 1, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 0, addEventListener() {},
    fetch: async () => { if (fail) throw new Error('offline'); return { ok: true, json: async () => ({ os: 'linux', binds }) } },
    DeckPages: { register() {}, hook() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { get, mcmd, kpages };
}
const BINDS = [
  { label: 'Workspace overview', modifiers: ['super'], key: 'f4', group: 'Workspaces', confirm: false },
  { label: 'Mission control', modifiers: ['ctrl'], key: 'up', group: 'Workspaces', confirm: false },
  { label: 'Log out', modifiers: ['super', 'shift'], key: 'q', group: 'System', confirm: true },
];
const settle = () => new Promise((r) => setImmediate(r));

test('A13: #kblist keeps its id and list role; every child is a list item, each group a heading over its own list', async () => {
  assert.match(html, /<div id="kblist" role="list" aria-label="Keybinds"><\/div>/, 'the iOS contract id and the list stay as they are');
  const d = boot({ binds: BINDS, favs: ['super+shift:q'] });
  await settle(); await settle();
  const list = d.get('#kblist'), items = kids(list);
  assert.ok(items.length >= 2, 'Workspaces and System');
  for (const it of items) assert.equal(it.getAttribute('role'), 'listitem', 'child ' + it.className + ' of a list is a list item');
  const groups = items.filter((x) => x.className === 'kbgrp');
  assert.deepEqual(groups.map((g) => kids(g)[0].textContent), ['Workspaces', 'System']);
  for (const g of groups) {
    const [h, ul] = kids(g);
    assert.equal(h.getAttribute('role'), 'heading');
    assert.equal(h.getAttribute('aria-level'), '2', 'the level under the page h1, never a skipped level');
    assert.equal(ul.getAttribute('role'), 'list');
    assert.ok(kids(ul).length > 0);
    for (const r of kids(ul)) { assert.equal(r.className, 'kbr'); assert.equal(r.getAttribute('role'), 'listitem') }
  }
});

test('A13: with the live binds unavailable, the note and the fallback groups are list items too', async () => {
  const d = boot({ fail: true });
  await settle(); await settle();
  const items = kids(d.get('#kblist'));
  assert.equal(items[0].textContent, 'Live keybinds unavailable');
  assert.ok(items.length >= 2, 'the note and the clipboard group');
  for (const it of items) assert.equal(it.getAttribute('role'), 'listitem', it.className);
});

test('A5: each bind row and pinned chip is named by its own words first, in the order the row shows them', async () => {
  const d = boot({ binds: BINDS, favs: ['super+shift:q', 'super:f4'] });
  await settle(); await settle();
  const rows = kids(d.get('#kblist')).filter((x) => x.className === 'kbgrp').flatMap((g) => kids(kids(g)[1]));
  assert.equal(rows.length, 3);
  for (const r of rows) {
    const go = kids(r).find((x) => x.className.startsWith('go'));
    const shown = go.textContent, name = go.getAttribute('aria-label');
    assert.match(shown, /\S \S/, 'name and chord never run together: ' + shown);
    assert.ok(startsWith(name, shown) && contains(name, shown), `"${name}" vs shown "${shown}"`);
  }
  const hold = rows.map((r) => kids(r).find((x) => x.className.startsWith('go'))).find((g) => g.className.includes('hold'));
  assert.equal(hold.getAttribute('aria-label'), 'Log out, hold to send, Super+Shift+Q');
  for (const chip of kids(d.get('#kbfav'))) assert.ok(startsWith(chip.getAttribute('aria-label'), chip.textContent), chip.textContent);
});

test('A5: the Super cap says the words it shows, latched or not; the speed chip starts with its number', async () => {
  const d = boot({ binds: BINDS });
  await settle(); await settle();
  assert.equal(d.mcmd.dataset.m, 'super', 'an Omarchy target');
  assert.equal(d.mcmd.textContent, 'Super');
  assert.equal(d.mcmd.getAttribute('aria-label'), 'Super');
  const spd = d.get('#tpspd');
  assert.ok(startsWith(spd.getAttribute('aria-label'), spd.textContent), spd.getAttribute('aria-label'));
  assert.match(spd.getAttribute('aria-label'), /pointer speed/);
});

test('S13: the trackpad never says Retry', () => {
  assert.doesNotMatch(src, /'Retry'|"Retry"|>Retry</);
  for (const k of ['timeout', 'closed']) assert.equal(P.connectCopy(k, 'Mini', '', 1).label, 'Try again');
});

test('owner phone: keys open and the link down, the 7rem trackpad keeps the state and Try again in one row under the switch', () => {
  const css = read('css/pad.css'), p = css.slice(css.indexOf('@media (max-width:599px){'), css.indexOf('@media (max-width:599px) and (max-height:640px)'));
  assert.match(p, /#padpg\.kb-open\{grid-template-rows:7rem /);
  assert.match(p, /#padpg\.kb-open #tpoff\{flex-direction:row;[^}]*padding:calc\(var\(--s-3\) \+ var\(--hit\) \+ var\(--s-1\)\) var\(--s-3\) var\(--s-1\)\}/, 'one row below the switch row');
  assert.match(p, /#padpg\.kb-open #tpoff b\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/, 'the state never wraps under the switch');
  assert.match(p, /#padpg\.kb-open #tpoff small\{display:none\}/);
});

// ---------- Pad > Keys (app.js): the macro keys ----------
const block = (from, to) => { const a = app.indexOf(from), b = app.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return app.slice(a, b) };

const KEYROWS = vm.runInNewContext(block('// ==== KEY ROWS HELPERS BEGIN', '// ==== KEY ROWS HELPERS END ====') + '\nKEYROWS;', {}, { timeout: 1000 });

test('A5 on Keys: a key\'s name holds the words on it in reading order, the drawn digit first', () => {
  assert.equal(KEYROWS.say({ label: 'WS 1', icon: '1' }), '1 WS 1');
  assert.equal(KEYROWS.say({ label: 'To 1', icon: '\u27A11' }), '1 To 1', 'the arrow is a picture, the digit is read');
  assert.equal(KEYROWS.say({ label: 'Terminal', icon: '\u2328\uFE0F' }), 'Terminal', 'an emoji adds nothing');
  assert.equal(KEYROWS.say({ label: 'TV power', icon: '\uD83D\uDCFA' }), 'TV power');
  const doc = { createElement: (t) => el(t) };
  const keyBtn = new Function('document', 'esc', 'KEYROWS', 'fire', block('function keyBtn(', '// A confirm key fires') + 'return keyBtn;')(doc, (s) => String(s), KEYROWS, () => {});
  const b = keyBtn({ label: 'WS 1', icon: '1', action: 'ws', arg: '1' }, 0);
  assert.match(b.innerHTML, /<\/span> <span class="lb">WS 1<\/span> <span class="ap">/, 'icon, label and apps line are separate words');
  assert.equal(b.getAttribute('aria-label'), '1 WS 1');
  assert.ok(contains(b.getAttribute('aria-label'), '1 WS 1'));
  const mv = keyBtn({ label: 'To 3', icon: '\u27A13', action: 'mvws', arg: '3' }, 1);
  assert.ok(startsWith(mv.getAttribute('aria-label'), '\u27A13 To 3') && contains(mv.getAttribute('aria-label'), '\u27A13 To 3'), mv.getAttribute('aria-label'));

  const keysBtn = wsKey('1'), full = wsKey('2');
  const homeBtn = el('button'); homeBtn.dataset.v = '3';
  const { paint } = spaces([keysBtn, full, homeBtn]);
  paint({ ok: true, active: 2, ws: [{ id: 1, n: 0, apps: [] }, { id: 2, n: 2, apps: ['Chromium', 'Ghostty'] }, { id: 3, n: 0, apps: [] }] });
  // what the key shows, in order: the digit, the label, the apps line
  assert.equal(keysBtn.getAttribute('aria-label'), '1 WS 1, Empty, Workspace 1, empty');
  assert.ok(contains(keysBtn.getAttribute('aria-label'), '1 WS 1 Empty'));
  assert.equal(full.getAttribute('aria-label'), '2 WS 2, Chromium +1, Workspace 2: Chromium, Ghostty, current');
  assert.ok(startsWith(full.getAttribute('aria-label'), '2 WS 2 Chromium +1') && contains(full.getAttribute('aria-label'), '2 WS 2 Chromium +1'));
  assert.equal(keysBtn.title, 'Workspace 1, empty', 'the long press title keeps the plain words');
  assert.equal(homeBtn.getAttribute('aria-label'), 'Workspace 3, empty', 'the Home card is unchanged');
});

// a Keys workspace button as keyBtn draws it; `narrow` stands for the container query that swaps the apps line for the count line
function wsKey(id) {
  const b = el('button'), ac = { narrow: false };
  b.dataset.ws = id; b.dataset.say = id + ' WS ' + id;
  b.querySelector = (s) => (s === '.ap .ac' ? ac : null);
  b.ac = ac;
  return b;
}
function spaces(buttons) {
  const on = { resize: [], route: [] }, frames = [];
  const env = {
    $$: () => buttons, getComputedStyle: (e) => ({ display: e.narrow ? 'inline' : 'none' }),
    addEventListener: (k, f) => { if (k === 'resize') on.resize.push(f) }, requestAnimationFrame: (f) => { frames.push(f); return frames.length },
    document: { addEventListener: (k, f) => { if (k === 'deck:route') on.route.push(f) } },
  };
  const paint = new Function(...Object.keys(env), block('// ==== SPACES UI HELPERS BEGIN', '// ==== SPACES UI HELPERS END') + block('let spacesSeen=null', 'async function refresh(){') + block('// a workspace key is named again', '// ---- stats ----') + 'return paintSpaces;')(...Object.values(env));
  return { paint, resize: () => { on.resize.forEach((f) => f()); frames.splice(0).forEach((f) => f()) }, route: (r) => on.route.forEach((f) => f({ detail: { route: r } })) };
}

test('A5 on Keys: a narrow key (phone landscape, TV) shows "5 open", and its name holds "5 open" too, read again on resize and on show', () => {
  const k = wsKey('1'), s = spaces([k]);
  const ws = { ok: true, active: 1, ws: [{ id: 1, n: 5, apps: ['Chromium', 'Ghostty'] }] };
  k.ac.narrow = true;
  s.paint(ws);
  assert.equal(k.getAttribute('aria-label'), '1 WS 1, 5 open, Workspace 1: Chromium, Ghostty, current');
  assert.ok(contains(k.getAttribute('aria-label'), '1 WS 1 5 open'));
  k.ac.narrow = false; s.resize();
  assert.equal(k.getAttribute('aria-label'), '1 WS 1, Chromium +4, Workspace 1: Chromium, Ghostty, current', 'a wider window: the apps line again');
  k.ac.narrow = true; s.route('home/house');
  assert.match(k.getAttribute('aria-label'), /Chromium \+4/, 'another page showing changes nothing');
  s.route('pad/keys');
  assert.match(k.getAttribute('aria-label'), /^1 WS 1, 5 open, /, 'Keys on screen: read again');
});
