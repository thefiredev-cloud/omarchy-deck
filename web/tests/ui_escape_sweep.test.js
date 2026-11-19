'use strict';
// node --test tests/ui_escape_sweep.test.js  (PlanEng item 10, SeeSecurity X10: nothing escapes unseen; no DOM, no network)
// Every exported function of every pure block gets every fixture with each string turned hostile, and plain hostile strings. What comes
// back may never hold the marker as markup: a raw <img src=x, an on...= attribute outside quotes, or a javascript: link. A builder that
// forgets esc or safeUrl fails here, not in review. A function that throws on odd input is counted, not failed.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };

// ---- the blocks, loaded the way their own tests load them
function blocks() {
  const deck = read('static/deck.js'), app = read('static/app.js');
  const DeckUI = new Function(cut(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
  const DeckCRE = new Function(cut(read('static/cre.js'), '// ==== DECK CRE PURE BEGIN', '// ==== DECK CRE PURE END ====') + '\nreturn DeckCRE;')();
  const withUI = (file, a, b, names) => new Function('DeckUI', cut(read(file), a, b) + '\nreturn {' + names + '};')(DeckUI);
  const appBlock = (a, b, name) => new Function('DeckUI', cut(app, a, b) + '\nreturn ' + name + ';')(DeckUI);
  const re = new Function('localStorage', 'DeckUI', read('static/pages/realestate.js') + '\nreturn {DeckScope,DeckRE};')(store(), DeckUI);
  return {
    DeckCore, DeckUI, DeckCRE,
    ...withUI('static/agents.js', '// ==== AGENTS UI HELPERS BEGIN', '// ==== AGENTS UI HELPERS END ====', 'AgentsUI,LaunchUI,AppsUI'),
    ...withUI('static/schedules.js', '// ==== SCHEDULES UI HELPERS BEGIN', '// ==== SCHEDULES UI HELPERS END ====', 'SchedUI'),
    ...withUI('static/invest.js', '// ==== DECK INVEST UI BEGIN', '// ==== DECK INVEST UI END ====', 'DeckInvest'),
    ...withUI('static/ops.js', '// ==== DECK OPS UI BEGIN', '// ==== DECK OPS UI END ====', 'DeckOps'),
    DeckCom: new Function('DeckUI', 'DeckCRE', cut(read('static/pages/commercial.js'), '// ==== DECK COMMERCIAL PURE BEGIN', '// ==== DECK COMMERCIAL PURE END ====') + '\nreturn DeckCom;')(DeckUI, DeckCRE),
    DeckScope: re.DeckScope, DeckRE: re.DeckRE,
    DeckShop: new Function('DeckUI', read('static/pages/shop.js') + '\nreturn DeckShop;')(DeckUI),
    DeckSurf: new Function('DeckUI', 'DeckPages', read('static/pages/surf.js') + '\nreturn DeckSurf;')(DeckUI, undefined),
    DeckWorld: new Function('DeckUI', 'DeckPages', read('static/pages/world.js') + '\nreturn DeckWorld;')(DeckUI, undefined),
    SpacesUI: appBlock('// ==== SPACES UI HELPERS BEGIN', '// ==== SPACES UI HELPERS END ====', 'SpacesUI'),
    KEYROWS: appBlock('// ==== KEY ROWS HELPERS BEGIN', '// ==== KEY ROWS HELPERS END ====', 'KEYROWS'),
    TodayUI: appBlock('// ==== TODAY UI HELPERS BEGIN', '// ==== TODAY UI HELPERS END ====', 'TodayUI'),
    HouseUI: appBlock('// ==== HOUSE UI HELPERS BEGIN', '// ==== HOUSE UI HELPERS END ====', 'HouseUI'),
    CameraUI: appBlock('// ==== CAMERA UI HELPERS BEGIN', '// ==== CAMERA UI HELPERS END ====', 'CameraUI'),
  };
}

// every function a block exports, and the functions hanging off an export one level down (DeckUI.fmt.money, DeckCRE.UI.x)
function exportsOf(mods) {
  const out = [];
  for (const [m, o] of Object.entries(mods)) {
    if (!o || (typeof o !== 'object' && typeof o !== 'function')) continue;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'function') out.push([m + '.' + k, v]);
      if (v && (typeof v === 'object' || typeof v === 'function') && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'function') out.push([m + '.' + k + '.' + k2, v2]);
      }
    }
  }
  return out;
}

// ---- inputs: every JSON fixture, the Shop and Surf fixtures, trimmed (three items a list, forty keys an object) so the sweep stays fast
function fixtures() {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.json')) { try { out.push([path.relative(__dirname, p), JSON.parse(fs.readFileSync(p, 'utf8'))]); } catch (err) { /* not JSON: not an input */ } } } };
  walk(path.join(__dirname, 'fixtures'));
  const shop = require('./shop_fixture.cjs')();
  for (const k of Object.keys(shop)) out.push(['shop_fixture.' + k, shop[k]]);
  out.push(['surf_fixture.feed', require('./surf_fixture.js').feed()]);
  return out;
}
const trim = (v, d = 0) => {
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => trim(x, d + 1));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).slice(0, 40)) o[k] = d > 8 ? null : trim(v[k], d + 1); return o; }
  return v;
};
// each string replaced by the marker; keys stay, so shapes stay
const poison = (v, m) => Array.isArray(v) ? v.map((x) => poison(x, m)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, poison(x, m)])) : typeof v === 'string' ? m : v;
// the root and the objects and lists one and two levels down (what a builder for one section takes)
function parts(root) {
  const out = [root];
  const add = (v) => { if (v && typeof v === 'object' && out.length < 9 && !out.includes(v)) out.push(v); };
  if (root && typeof root === 'object') for (const v of Object.values(root)) { add(v); if (v && typeof v === 'object') for (const w of Object.values(v)) add(w); }
  return out;
}

// the markers: markup, a script link, and markup behind a link that passes a weak "starts with https://" rule
const MARKS = ['"><img src=x onerror=__X>', 'javascript:__X', 'https://__X.test/"><img src=x onerror=__X>'];
const NOW = 1794708090000;

// what comes back, as text: strings, and strings inside the objects and lists a builder returns (sheet options, rows)
function texts(v, out = [], d = 0) {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object' && d < 4 && typeof v.then !== 'function') for (const x of Object.values(v)) texts(x, out, d + 1);
  return out;
}
const TAG = /<[A-Za-z][^<>]*>/g;
function holes(s) {
  const found = [];
  if (/<img src=x/i.test(s)) found.push('raw <img');
  for (const t of s.match(TAG) || []) {
    const bare = t.replace(/"[^"]*"|'[^']*'/g, '""');
    if (/\son[a-z]+\s*=/i.test(bare)) found.push('on...= attribute: ' + t.slice(0, 80));
    const m = /\s(?:href|src|action|formaction|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let x;
    while ((x = m.exec(t))) { const url = (x[2] ?? x[3] ?? x[4] ?? '').replace(/&#0*58;|&colon;/gi, ':').trim(); if (/^javascript:/i.test(url)) found.push('javascript: link: ' + t.slice(0, 80)); }
  }
  return found;
}
// only markup is judged: a string with an element a builder writes (a helper that hands text back, like arr, str or a sentence-case
// rewrite, is not a sink; the page escapes its answer where it draws it). A marker cut short ("><im) is text, not an element.
const ELEMENT = /<\/?(?:a|abbr|article|aside|b|br|button|code|dd|details|dialog|div|dl|dt|em|figure|footer|h[1-6]|header|i|input|label|li|mark|meter|nav|ol|optgroup|option|p|path|pre|progress|section|select|small|span|strong|summary|svg|table|tbody|td|th|thead|time|tr|ul|use|video)\b/i;
const isMarkup = (s) => ELEMENT.test(MARKS.reduce((t, m) => t.split(m).join(''), s));

// markup by contract: these arguments and fields take HTML another builder made (a tile's confidence dots and sparkline, a strip's tiles,
// the Filters bar's fields, the Today cluster list's Status row). The sweep hands them safe markup, and judges everything else.
const SLOTS = {
  'DeckUI.tile': { keys: ['conf', 'spark'] },
  'DeckUI.strip': { args: [0] },
  'DeckUI.filters': { keys: ['lead', 'fields'] },
  'DeckUI.tdCluster': { args: [2] },
};
const slotted = (fname, args) => {
  const s = SLOTS[fname];
  if (!s) return args;
  return args.map((a, i) => (s.args || []).includes(i) ? '<i></i>' : a && typeof a === 'object' && !Array.isArray(a) && s.keys ? Object.assign({}, a, Object.fromEntries(s.keys.map((k) => [k, '<i></i>']))) : a);
};
// renderers of a model their own module builds, never of a feed: the model is where the rule runs. Each names the model that guards it.
// The two link renderers (Today's needs rows, Shop's listing rows) left this list in the helpers' second PR: they pass every url through
// safeUrl where they draw it, as DeckCore.linkRow does.
const MODEL_RENDERERS = {
  'DeckRE.areasHtml': 'the kind, rank and bar come from areasModel, which sets them itself',
  'SchedUI.chips': 'the counts come from counts(), which counts',
};

function sweep(mods) {
  const fns = exportsOf(mods), inputs = [];
  for (const [name, fx] of fixtures()) {
    const t = trim(fx);
    for (const m of MARKS) for (const p of parts(poison(t, m))) inputs.push([name, p]);
  }
  // a record with every key a fixture uses, each value the marker; the same in a list. Builders that take ({label, value, url ...}) get it.
  const keys = new Set();
  const keysOf = (v) => { if (Array.isArray(v)) v.forEach(keysOf); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); keysOf(x); } };
  for (const [, p] of inputs) keysOf(p);
  for (const m of MARKS) {
    const rec = Object.fromEntries([...keys].map((k) => [k, m]));
    inputs.push(['record', rec], ['record list', [rec, rec]], ['record in items', Object.assign({}, rec, { items: [rec], rows: [rec], sources: [rec], parts: [rec], list: [rec] })]);
  }
  const strs = MARKS.flatMap((m) => [[m], [m, m], [m, m, m], [{ label: m, value: m, sub: m, title: m, text: m, url: m, href: m }]]);
  const bad = new Map(), threw = new Set();
  let ran = 0;
  // a function that schedules work (a debounce, a repaint) schedules nothing here: the sweep reads what comes back, and only that
  const timers = [globalThis.setTimeout, globalThis.setInterval];
  globalThis.setTimeout = globalThis.setInterval = () => 0;
  try { for (const [fname, f] of fns) {
    const run = (args, from) => {
      let r;
      try { r = f(...slotted(fname, args)); ran++; } catch (e) { threw.add(fname); return; }
      if (r && typeof r.then === 'function') { r.then(() => {}, () => {}); return; }
      if (MODEL_RENDERERS[fname]) return;
      for (const s of texts(r)) if (isMarkup(s)) for (const h of holes(s)) { const k = fname + ': ' + h.split(':')[0]; if (!bad.has(k)) bad.set(k, k + ' (input ' + from + ') ' + h); }
    };
    for (const a of strs) run(a, 'strings');
    // three call shapes: (data), (data, now) and (data, options, now)
    for (const [from, x] of inputs) for (const a of [[x], [x, NOW], [x, x, NOW]]) run(a, from);
  } } finally { [globalThis.setTimeout, globalThis.setInterval] = timers; }
  return { fns: fns.length, inputs: inputs.length, ran, threw: [...threw], bad: [...bad.values()] };
}

test('the sweep reaches every pure block and a real number of builders', () => {
  const mods = blocks(), fns = exportsOf(mods);
  for (const m of ['DeckCore', 'DeckUI', 'DeckCRE', 'AgentsUI', 'LaunchUI', 'SchedUI', 'DeckInvest', 'DeckOps', 'DeckCom', 'DeckRE', 'DeckScope', 'DeckShop', 'DeckSurf', 'TodayUI', 'HouseUI']) {
    assert.ok(fns.some(([n]) => n.startsWith(m + '.')), m + ' has exports in the sweep');
  }
  assert.ok(fns.length > 300, 'functions swept: ' + fns.length);
  assert.ok(fixtures().length > 40, 'fixtures: ' + fixtures().length);
  for (const n of [...Object.keys(SLOTS), ...Object.keys(MODEL_RENDERERS)]) assert.ok(fns.some(([m]) => m === n), n + ' is still exported: drop it from the list');
  assert.ok(Object.keys(MODEL_RENDERERS).length <= 2, 'the model renderer list only shrinks');
});

test('no builder lets a hostile string through as markup or as a javascript: link (X10)', (t) => {
  const r = sweep(blocks());
  t.diagnostic('functions ' + r.fns + ', inputs ' + r.inputs + ', calls that returned ' + r.ran + ', functions that threw on odd input ' + r.threw.length);
  assert.ok(r.ran > 100000, 'calls that returned: ' + r.ran);
  assert.deepEqual(r.bad, []);
});

test('the detector itself: escaped text passes, raw markup, a broken-out attribute and a script link fail', () => {
  const esc = DeckCore.esc;
  assert.deepEqual(holes('<b>' + esc(MARKS[0]) + '</b><a href="' + esc('https://x.test/') + '" title="' + esc(MARKS[2]) + '">x</a>'), []);
  assert.ok(holes('<b>' + MARKS[0] + '</b>').length);
  assert.ok(holes('<span title="' + 'x" onerror="__X' + '">').length);
  assert.ok(holes('<a href="' + esc(MARKS[1]) + '">').length);
  assert.ok(holes("<a href='javascript&#58;__X'>").length);
});
