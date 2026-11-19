// node --test tests/guest_ui.test.js
// Guest deck (owner 2026-10-13). The server allowlist (rust/src/guest.rs) is the control; these check that a guest deck
// shows Home and Pad only. Keys is a chip on Pad. House content sits inside Home. No Mac mini. Never requests an owner route.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('static/app.js'), deck = read('static/deck.js'), pad = read('static/pad.js'), html = require('./shell_legacy_css.js')(), sw = read('static/sw.js');

// the role block of app.js: from GUEST_PAGES to the line that applies the stored guest view, run against a fake page. Nothing is asked here:
// whoami is asked after first paint and its answer is tested in tests/shell_taps.test.js (decision 11)
const a = app.indexOf('const GUEST_PAGES='), b = app.indexOf('\n', app.indexOf('if(GUEST)guestMode();'));
assert.ok(a > 0 && b > a, 'guest block markers moved');
const block = app.slice(a, b);

function run({ stored = null }) {
  const store = new Map(stored ? [['role', stored]] : []);
  const pages = ['today', 'home', 'money', 'markets', 'shop', 'life', 'fleet', 'pad']
    .map((name) => ({ dataset: { name }, hidden: false }));
  const mini = { removed: false, remove() { this.removed = true } };
  const cls = new Set();
  const calls = [];
  const ctx = {
    fetch: (...x) => { calls.push(x); return new Promise(() => {}); },
    XMLHttpRequest: class { open(...x) { calls.push(x) } send() {} },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    document: { documentElement: { classList: { add: (c) => cls.add(c), contains: (c) => cls.has(c) } } },
    $$: (s) => (s === '#pager>.page' ? pages : s === '#ptg [data-t=mini]' ? [mini] : []),
  };
  const GUEST = vm.runInNewContext(block + '\nGUEST;', ctx, { timeout: 1000 });
  return { GUEST, calls, pages, mini, cls, store };
}

test('stored guest: guest class, only Home and Pad, no Mac mini button, and no request before first paint', () => {
  const r = run({ stored: 'guest' });
  assert.equal(r.GUEST, true);
  assert.deepEqual(r.calls, [], 'whoami is not asked while the page is built');
  assert.ok(r.cls.has('guest'));
  assert.deepEqual(r.pages.filter((p) => !p.hidden).map((p) => p.dataset.name), ['home', 'pad']);
  assert.equal(r.mini.removed, true);
});

test('stored owner, or no stored role: nothing hidden, nothing removed', () => {
  for (const stored of ['owner', null]) {
    const r = run({ stored });
    assert.equal(r.GUEST, false);
    assert.ok(!r.cls.has('guest'));
    assert.equal(r.pages.filter((p) => p.hidden).length, 0);
    assert.equal(r.mini.removed, false);
  }
});

test('an odd stored value counts as no role; a role is never guessed from nothing', () => {
  assert.equal(run({ stored: 'admin' }).GUEST, false);
  assert.equal(run({ stored: 'Guest' }).GUEST, false);
});
test('the pager is built after the role and from visible pages only', () => {
  assert.ok(app.indexOf('let GUEST=') > 0 && app.indexOf('let GUEST=') < app.indexOf(',PAGES=[...'));
  // a guest's pages and Home's owner subs are marked off before the tabs are built; the tabs skip them
  assert.match(app, /PAGES=\[\.\.\.\$\$\('#pager>\.page'\)\]\.filter\(p=>!p\.dataset\.off\)/);
  assert.match(app, /if\(!GUEST_PAGES\.includes\(p\.dataset\.name\)\)\{p\.hidden=true;p\.dataset\.off='1'\}/);
  assert.match(app, /if\(GUEST&&t==='home'\)s='house';/);
});

test('a guest deck never asks for an owner route', () => {
  // boot no longer fetches Today's feeds for every deck: the first page asks for its own feeds (W19), and a guest only reaches Home and Pad
  assert.match(app, /setHost\(host\);clock\(\);wx\(\);wake\(\);loadKeys\(\);/);
  assert.doesNotMatch(app, /wake\(\);loadKeys\(\);today\(\)/);
  assert.match(app, /async function ha\(\)\{if\(GUEST\)return;/);
  // the registry runs a page for a guest only when it is registered with guest:true (tests/ui_registry.test.js); no old deck.js page is
  assert.match(deck, /function deckPage\(name,tick\)\{return DeckPages\.dispatch\(name,tick\)\}/);
  assert.doesNotMatch(deck.slice(deck.indexOf('// ==== DECK PAGES REGISTRY END')), /guest:\s*true/);
  // key macros fire by their index in the full list, which the guest list carries as `i`
  assert.match(app, /const p='key\?v='\+\(Number\.isInteger\(k\.i\)\?k\.i:i\),r=await q\(p,1\)/);
});

test('pad: a guest page has no Mac mini target and starts on pc-desktop', () => {
  assert.match(pad, /if \(document\.documentElement\.classList\.contains\('guest'\)\) delete NAMES\.mini;/);
  assert.match(pad, /const FIRST = NAMES\.mini \? 'mini' : 'pc-desktop';/);
  assert.match(pad, /if \(!NAMES\[target\]\) target = FIRST;/);
});

test('guest CSS hides owner cards and the hidden pages', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '../static/ui.css'), 'utf8'), /\[hidden\]\{display:none!important\}/);
  for (const sel of ['#grid', '#prod', '#needs', '#lock', '.apps [data-v=hermes]', '#conn1', '#conn2', '#hal']) {
    assert.ok(html.includes('.guest ' + sel), sel);
  }
});
