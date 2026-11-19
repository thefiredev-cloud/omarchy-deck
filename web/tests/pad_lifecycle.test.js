// The Pad's lifecycle in the v3 shell, run against a stub DOM: the shell starts and stops the Pad through the page registry
// (route pad/pad, guests included), the agent link opens only while the route is on screen, and TV view never opens it.
// No real socket is opened: WebSocket is a recording stand-in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'static', 'pad.js'), 'utf8');

function el() {
  const cls = new Set();
  const e = {
    classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), toggle: (c, on) => { (on === undefined ? !cls.has(c) : on) ? cls.add(c) : cls.delete(c) }, contains: (c) => cls.has(c) },
    style: { setProperty(k, v) { this[k] = v } }, dataset: {}, children: [], textContent: '', value: '', placeholder: '', offsetParent: {},
    setAttribute() {}, appendChild(c) { e.children.push(c); return c }, append(...c) { e.children.push(...c) }, replaceChildren() { e.children = [] },
    addEventListener() {}, querySelector: () => el(), closest: () => null, setPointerCapture() {}, scrollIntoView() {}, setSelectionRange() {}, focus() {},
    getBoundingClientRect: () => ({ top: 120, left: 0, width: 800, height: 600 }),
  };
  return e;
}

function boot({ tv = false, guest = false } = {}) {
  const els = new Map(), sockets = [], timers = [], registered = {};
  const root = el();
  if (tv) root.classList.add('tv');
  if (guest) root.classList.add('guest');
  const document = {
    documentElement: root, hidden: false,
    querySelector: (s) => { if (!els.has(s)) els.set(s, el()); return els.get(s) },
    querySelectorAll: () => [],
    createElement: () => el(),
    addEventListener() {},
  };
  class WebSocket { constructor(url) { this.url = url; this.readyState = 0; sockets.push(this) } send() {} close() { this.closed = true } }
  const store = { getItem(k) { return this[k] == null ? null : this[k] }, setItem(k, v) { this[k] = String(v) } };
  const ctx = {
    document, WebSocket, localStorage: store, location: { protocol: 'https:', host: 'deck.test' }, navigator: {},
    performance: { now: () => 0 }, requestAnimationFrame: (f) => { f(); return 1 }, scrollY: 0,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length }, clearTimeout() {}, setInterval() { return 0 },
    fetch: () => Promise.reject(new Error('offline')), addEventListener() {}, console,
    DeckPages: { register(route, page) { registered[route] = page; return page }, hook(route, page) { registered['hook:' + route] = page; return page } },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { registered, sockets, timers, els };
}

test('the Pad registers pad/pad with the registry, guests included', () => {
  const { registered } = boot();
  const p = registered['pad/pad'];
  assert.ok(p, 'pad/pad is registered');
  assert.equal(p.guest, true);
  assert.equal(typeof p.show, 'function');
  assert.equal(typeof p.hide, 'function');
});

test('no link before the route is shown; show opens one link to the stored computer; hide lets it go after 8 s', () => {
  const b = boot();
  assert.equal(b.sockets.length, 0, 'loading the page opens nothing');
  b.registered['pad/pad'].show();
  assert.equal(b.sockets.length, 1);
  assert.equal(b.sockets[0].url, 'wss://deck.test/pad?target=mini');
  assert.equal(b.els.get('#padpg').style['--pad-top'], '120px', 'the Pad is fitted under the header');
  b.registered['pad/pad'].hide();
  const later = b.timers.filter((t) => t.ms === 8000);
  assert.ok(later.length, 'a hide schedules the disconnect');
  later.at(-1).f();
  assert.equal(b.sockets[0].closed, true, 'the link closes once the Pad has been away 8 s');
});

// Before the v3 shell the link lived while the Pad tab (#p5) was on screen, Pad or Keys sub, and went 8 s after the tab left.
test('switching from Pad to Keys keeps the link (same lifetime as before); leaving the Pad tab lets it go after 8 s', () => {
  const b = boot();
  const keys = b.registered['hook:pad/keys'];
  assert.ok(keys, 'Keys is hooked');
  assert.equal(keys.guest, true);
  b.registered['pad/pad'].show();
  const from = b.timers.length; // the connect watchdog (also 8 s) is not the hide timer
  b.registered['pad/pad'].hide(); keys.show(); // the registry hides the old route, then shows the new one
  for (const t of b.timers.slice(from).filter((x) => x.ms === 8000)) t.f();
  assert.equal(b.sockets.length, 1, 'no second link');
  assert.notEqual(b.sockets[0].closed, true, 'the link stays while Keys is on screen');
  keys.hide();
  b.timers.filter((x) => x.ms === 8000).at(-1).f();
  assert.equal(b.sockets[0].closed, true, 'leaving the Pad tab closes it after 8 s');
});

test('TV view never opens the link, even when the route is shown', () => {
  const b = boot({ tv: true });
  b.registered['pad/pad'].show();
  assert.equal(b.sockets.length, 0);
});

test('a guest deck drives pc-desktop, never the Mac mini', () => {
  const b = boot({ guest: true });
  b.registered['pad/pad'].show();
  assert.equal(b.sockets[0].url, 'wss://deck.test/pad?target=pc-desktop');
});

test('the machine line names the computer the Pad drives', () => {
  const b = boot();
  const tp = b.els.get('#tp');
  const who = tp.children.find((c) => c.id === 'padwho');
  assert.ok(who, 'the line sits on the trackpad');
  assert.equal(who.textContent, 'This Pad controls Mini.');
});
