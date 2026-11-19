'use strict';
// TV remote (DESIGN-v3 section 5, UiApi 1.5, CRITIQUE findings 1 and 3): the spatial candidate picker, the row-band
// fallback that keeps a lone card reachable, Back order, the focus trap, the ?press= parser and the one-time prompt.
// Loads the pure TV CORE block of static/tv.js; no browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'static/tv.js'), 'utf8');
const block = src.match(/\/\/ ==== TV CORE BEGIN[^\n]*\n([\s\S]*?)\/\/ ==== TV CORE END ====/);
assert.ok(block, 'tv.js has the TV CORE markers');
const TvCore = vm.runInNewContext(block[1] + '\nTvCore;', {});

// a card grid: 100 x 80 cards, 20 px gaps, in one container; a coast strip of 14 segments below it in another
const card = (row, col, grid = 'spots') => ({ l: col * 120, t: row * 100, r: col * 120 + 100, b: row * 100 + 80, path: ['html', 'body', 'page', grid], name: `r${row}c${col}` });
const coast = (y) => Array.from({ length: 14 }, (_, i) => ({ l: i * 34, t: y, r: i * 34 + 30, b: y + 40, path: ['html', 'body', 'page', 'coast', 'ol'], name: `cs${i}` }));
const go = (dir, cur, cands) => { const i = TvCore.pick(dir, cur, cands); return i < 0 ? null : cands[i].name; };

test('4 plus 3 grid with a hole: every direction picks the neighbour, and Down over the hole lands on the lone row, not the coast', () => {
  const grid = [card(0, 0), card(0, 1), card(0, 2), card(0, 3), card(1, 0), card(1, 1), card(1, 2)];
  const all = grid.concat(coast(300));
  const at = (n) => all.find((c) => c.name === n);
  assert.equal(go('down', at('r0c1'), all), 'r1c1', 'Down in a column');
  assert.equal(go('down', at('r0c3'), all), 'r1c2', 'Down over the hole falls back to the next row band (CRITIQUE 3)');
  assert.equal(go('up', at('r1c2'), all), 'r0c2', 'Up in a column');
  assert.equal(go('right', at('r0c0'), all), 'r0c1');
  assert.equal(go('left', at('r1c2'), all), 'r1c1');
  assert.equal(go('right', at('r1c2'), all), null, 'Right at the hole stays in the row');
  assert.equal(go('right', at('r0c3'), all), null, 'Right at the row end stays');
  assert.equal(go('left', at('r1c0'), all), null);
  assert.equal(go('up', at('r0c2'), all), null, 'nothing above the first row');
  const below = go('down', at('r1c1'), all);
  assert.match(below, /^cs\d+$/, 'Down from the last row leaves the grid for the coast');
  const seg = at(below);
  assert.ok(seg.l < at('r1c1').r && seg.r > at('r1c1').l, 'into the segment under the card');
});

test('Surf home spots 3 + 3 + 1: Down from the middle and right columns reaches Huntington Pier alone in row 3', () => {
  const grid = [0, 1, 2].flatMap((c) => [card(0, c), card(1, c)]).concat([card(2, 0)]);
  const all = grid.concat(coast(400));
  const at = (n) => all.find((c) => c.name === n);
  assert.equal(go('down', at('r1c1'), all), 'r2c0');
  assert.equal(go('down', at('r1c2'), all), 'r2c0');
  assert.equal(go('down', at('r1c0'), all), 'r2c0');
  assert.match(go('down', at('r2c0'), all), /^cs/, 'then the coast');
});

test('the focused element is lifted 1.04: a neighbour 4 px away still counts as below, and the same row still counts as a row', () => {
  const a = { l: 0, t: 0, r: 100, b: 60 }, lift = { l: -2, t: -1.2, r: 102, b: 61.2 };
  const below = { l: 0, t: 64, r: 100, b: 124, name: 'below' }, right = { l: 104, t: 0, r: 204, b: 60, name: 'right' };
  assert.equal(go('down', lift, [below, right]), 'below');
  assert.equal(go('right', lift, [below, right]), 'right');
  assert.equal(TvCore.ahead('down', a, right), false);
});

test('main-axis distance plus three times cross-axis distance: a near diagonal loses to a farther straight neighbour', () => {
  const cur = { l: 0, t: 0, r: 100, b: 50 };
  const straight = { l: 0, t: 160, r: 100, b: 210, name: 'straight' };   // cone, 110 away
  const diag = { l: 140, t: 60, r: 240, b: 110, name: 'diag' };            // no column overlap, 10 away
  assert.equal(go('down', cur, [diag, straight]), 'straight', 'the cone wins');
  const left = { l: -500, t: 0, r: -400, b: 50, name: 'far' }, near = { l: -120, t: 20, r: -20, b: 70, name: 'near' };
  assert.equal(go('left', cur, [left, near]), 'near', 'nearest in the row');
  // a legacy sheet: Close on top, the full-width body scroller, then a small action at the foot; Down from Close is the body
  const close = { l: 0, t: 0, r: 60, b: 60 }, body = { l: 0, t: 70, r: 1700, b: 900, name: 'body' }, act = { l: 0, t: 910, r: 120, b: 970, name: 'act' };
  assert.equal(go('down', close, [act, body]), 'body');
  assert.equal(go('down', body, [act, close]), 'act');
  assert.equal(go('up', act, [close, body]), 'body');
  // three pills under one wide tab row item: the one under the middle wins
  const wide = { l: 0, t: 0, r: 900, b: 60 }, p = (x, n) => ({ l: x, t: 80, r: x + 200, b: 140, name: n });
  assert.equal(go('down', wide, [p(0, 'a'), p(350, 'b'), p(700, 'c')]), 'b');
});

test('Back closes the open sheet first, then returns focus to the active tab', () => {
  assert.equal(TvCore.backAction(true), 'close');
  assert.equal(TvCore.backAction(false), 'tab');
  const back = [{ key: 'Escape' }, { key: 'Backspace' }, { key: 'GoBack' }, { key: 'BrowserBack', keyCode: 166 }, { key: 'XF86Back', keyCode: 10009 }, { key: 'Unidentified', keyCode: 10009 }, { keyCode: 461 }];
  for (const e of back) assert.equal(TvCore.keyOf(e), 'back', JSON.stringify(e));
  assert.equal(TvCore.keyOf({ key: 'ArrowDown', keyCode: 40 }), 'down');
  assert.equal(TvCore.keyOf({ key: 'Unidentified', keyCode: 39 }), 'right', 'old TV engines send only the key code');
  assert.equal(TvCore.keyOf({ key: 'Enter' }), 'enter');
  assert.equal(TvCore.keyOf({ key: 'a', keyCode: 65 }), null);
  assert.equal(TvCore.keyOf({ key: 'Tab', keyCode: 9 }), null);
});

test('Back is one level per press: a popstate inside the wait means the browser took the press, and a null state means the guard went', () => {
  const W = TvCore.BACK_WAIT;
  assert.equal(W, 200);
  assert.equal(TvCore.backTaken(1050, 1000), true, 'the browser popped a level 50 ms after the key: the key does nothing more');
  assert.equal(TvCore.backTaken(1000 + W + 1, 1000), false, 'a later popstate is another press');
  assert.equal(TvCore.backTaken(900, 1000), false, 'a popstate before the key does not swallow it');
  assert.equal(TvCore.backTaken(-1, 1000), false, 'no popstate yet');
  // popstate: a sheet entry ({deckSheet: n}) or the guard is the host's business; the boot entry (null) means browser Back
  // popped the guard: close a non-host sheet, else go to the tabs
  assert.equal(TvCore.popAction({ deckSheet: 1 }, true), 'none');
  assert.equal(TvCore.popAction({ deckTv: 1 }, false), 'none');
  assert.equal(TvCore.popAction(null, true), 'close');
  assert.equal(TvCore.popAction(null, false), 'tab');
  assert.equal(TvCore.popAction(undefined, false), 'tab');
  // the key handler cancels the key at once (a modal <dialog> would close itself on Escape: a second level)
  assert.match(src, /e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*act\(k, e\);/);
  // Close stays reachable by arrows: the closer selector covers the v3 host's button.sheet-x[data-close][aria-label=Close]
  assert.match(src, /const CLOSERS = '\.sheet-x,/);
});

test('focus trap: Tab and Shift+Tab cycle inside the sheet and never leave it', () => {
  assert.equal(TvCore.trapNext(3, 2, false), 0, 'past the last wraps to the first');
  assert.equal(TvCore.trapNext(3, 0, true), 2, 'before the first wraps to the last');
  assert.equal(TvCore.trapNext(3, 1, false), 2);
  assert.equal(TvCore.trapNext(3, -1, false), 0, 'focus outside the sheet comes back to its first stop');
  assert.equal(TvCore.trapNext(3, -1, true), 2);
  assert.equal(TvCore.trapNext(0, 0, false), -1, 'nothing to focus');
});

test('?press= replays remote presses: D U L R, E for Enter, B for Back, anything else ignored, capped at 64', () => {
  const press = (s) => [...TvCore.parsePress(s)]; // the block runs in its own realm
  assert.deepEqual(press('DDDR'), ['down', 'down', 'down', 'right']);
  assert.deepEqual(press('dUl r-e!b'), ['down', 'up', 'left', 'right', 'enter', 'back']);
  assert.deepEqual(press(null), []);
  assert.deepEqual(press(''), []);
  assert.equal(TvCore.parsePress('D'.repeat(200)).length, 64);
});

test('the "Use TV view?" prompt shows once, only on a TV browser with TV view off; desktops never see it', () => {
  const tizen = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36';
  // the owner's bedroom S95B (beacon from the TV, vault 01-Memory/2026-11-02-tv-os-flash-verdict.md), as reported and in full
  const samsung = 'SamsungBrowser/5.0 Chrome/108 Tizen 6.5';
  const samsungFull = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/5.0 Chrome/108.0.5359.1 TV Safari/537.36';
  const webos = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager';
  const desk = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 OmarchyDeck/1.0';
  const phoneSamsung = 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
  assert.equal(TvCore.shouldAsk(tizen, false, false), true);
  assert.equal(TvCore.shouldAsk(samsung, false, false), true, 'the owner\'s Samsung TV browser');
  assert.equal(TvCore.shouldAsk(samsungFull, false, false), true);
  assert.equal(TvCore.shouldAsk(webos, false, false), true);
  assert.equal(TvCore.shouldAsk(samsung, false, true), false, 'asked once already');
  assert.equal(TvCore.shouldAsk(samsung, true, false), false, 'TV view already on');
  assert.equal(TvCore.shouldAsk(desk, false, false), false);
  assert.equal(TvCore.shouldAsk(ios, false, false), false, 'the iOS shell is not a TV');
  assert.equal(TvCore.shouldAsk(phoneSamsung, false, false), false, 'Samsung Internet on a phone is not a TV');
  // the stored mark is written when the prompt is shown, so a reload never asks again; nothing switches by itself
  assert.match(src, /store\('tvAsked', '1'\);\s*ask = /);
  assert.doesNotMatch(src.replace(/ask\.addEventListener\('click'[\s\S]*?\n    \}\);/, ''), /store\('view', 'tv'\)/, 'only the Use TV view button stores the switch');
});

test('focus look: every TV focus rule that changes the background also sets the text colour; map tiles and coast segments keep their fill', () => {
  const css = fs.readFileSync(path.join(ROOT, 'static/tv.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const focus = rules.filter((r) => /:focus/.test(r.sel) && /background:var\(--c-panel-2\)/.test(r.body));
  assert.ok(focus.length >= 2, 'the fill rules exist');
  for (const r of focus) {
    assert.match(r.body, /(^|;)color:var\(--c-text-1\)/, r.sel + ' sets the text colour with the fill');
    assert.doesNotMatch(r.sel, /\.st\b|\.cs\b/, r.sel + ' leaves map tiles and coast segments on their ramp');
  }
  assert.ok(rules.some((r) => /html\.tv :focus:not\(\[tabindex="-1"\]\)$/.test(r.sel) && /outline:var\(--focus\)/.test(r.body)), 'the 4 px ring');
  assert.ok(rules.some((r) => /\.st,\.cs\):focus$/.test(r.sel) && /scale\(1\.04\)/.test(r.body)), 'tiles get the lift');
  // :focus, not :focus-visible: controller-driven focus after a mouse click would lose the ring in Chrome
  assert.doesNotMatch(css.replace(/\.tv-ask[^{]*\{[^}]*\}/g, ''), /html\.tv[^{]*:focus-visible/);
});

test('controller: standard buttons 12-15 move, 0 is OK, 1 is Back, the left stick counts past 0.55', () => {
  const btn = (on) => Array.from({ length: 17 }, (_, i) => ({ pressed: on.includes(i), value: on.includes(i) ? 1 : 0 }));
  const pad = (on, axes = [0, 0, 0, 0]) => ({ connected: true, mapping: 'standard', buttons: btn(on), axes });
  const read = (p) => { const r = TvCore.padRead(p); return r && { dir: r.dir, ok: r.ok, back: r.back }; };
  assert.deepEqual(read([pad([12])]), { dir: 'up', ok: false, back: false });
  assert.equal(read([pad([13])]).dir, 'down');
  assert.equal(read([pad([14])]).dir, 'left');
  assert.equal(read([pad([15])]).dir, 'right');
  assert.deepEqual(read([pad([0])]), { dir: null, ok: true, back: false });
  assert.deepEqual(read([pad([1])]), { dir: null, ok: false, back: true });
  assert.equal(read([pad([], [0.54, 0])]).dir, null, 'inside the deadzone');
  assert.equal(read([pad([], [0.56, 0])]).dir, 'right');
  assert.equal(read([pad([], [-0.9, 0.3])]).dir, 'left');
  assert.equal(read([pad([], [0.2, -0.8])]).dir, 'up', 'the dominant axis wins');
  assert.equal(read([pad([], [0, 0.7])]).dir, 'down');
  assert.equal(read([pad([13], [0, -0.9])]).dir, 'down', 'the d-pad wins over the stick');
  assert.equal(read([pad([], [0, 0, 0.9, 0.9])]).dir, null, 'the right stick does nothing');
  assert.equal(read([pad([0], [0, 0]), pad([15])]).dir, 'right', 'two pads read together');
  assert.equal(TvCore.padRead([]), null, 'no pad');
  assert.equal(TvCore.padRead([null, null]), null, 'Chrome lists empty slots as null');
  assert.equal(TvCore.padRead([{ connected: false, buttons: btn([12]), axes: [] }]), null);
  assert.equal(read([{ buttons: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], axes: [] }]).dir, 'up', 'numeric button values');
});

test('controller repeat: a held direction fires at once, again after 420 ms, then every 130 ms; OK and Back fire once per press', () => {
  const steps = (inputs) => { let s = TvCore.padInit(); const out = []; for (const [t, inp] of inputs) { const r = TvCore.padStep(s, inp, t); s = r.state; out.push([t, [...r.fire].join(',')]); } return out; };
  const down = { dir: 'down', ok: false, back: false }, none = { dir: null, ok: false, back: false };
  const held = steps([[0, down], [100, down], [419, down], [420, down], [549, down], [550, down], [680, down], [700, none], [710, down]]);
  assert.deepEqual(held, [[0, 'down'], [100, ''], [419, ''], [420, 'down'], [549, ''], [550, 'down'], [680, 'down'], [700, ''], [710, 'down']]);
  const turn = steps([[0, down], [200, { dir: 'right', ok: false, back: false }], [500, { dir: 'right', ok: false, back: false }], [620, { dir: 'right', ok: false, back: false }]]);
  assert.deepEqual(turn, [[0, 'down'], [200, 'right'], [500, ''], [620, 'right']], 'a new direction starts its own delay');
  const ok = { dir: null, ok: true, back: false }, back = { dir: null, ok: false, back: true };
  assert.deepEqual(steps([[0, ok], [16, ok], [600, ok], [616, none], [632, ok]]), [[0, 'enter'], [16, ''], [600, ''], [616, ''], [632, 'enter']]);
  assert.deepEqual(steps([[0, back], [16, back], [32, none], [48, back]]), [[0, 'back'], [16, ''], [32, ''], [48, 'back']]);
});

test('controller disconnect: no reading fires nothing, resets the state, so focus stays where it was and a held key does not repeat on return', () => {
  const down = { dir: 'down', ok: false, back: false };
  let r = TvCore.padStep(TvCore.padInit(), down, 0);
  r = TvCore.padStep(r.state, null, 300);
  assert.equal(r.fire.length, 0, 'disconnect moves nothing');
  assert.equal(r.state.dir, null);
  r = TvCore.padStep(r.state, down, 310);
  assert.deepEqual([...r.fire], ['down'], 'a fresh press after reconnect');
  // polling runs only while html.tv, a pad is present and the page is visible
  assert.match(src, /addEventListener\('gamepadconnected', padStart\)/);
  assert.match(src, /addEventListener\('gamepaddisconnected', \(\) => \{ if \(!pads\(\)\.length\) padStop\(\); \}\)/);
  assert.match(src, /visibilitychange', \(\) => \{ if \(d\.hidden\) padStop\(\); else padStart\(\); \}/);
  assert.match(src, /function padStart\(\) \{ if \(!padRaf && isTv\(\) && !d\.hidden && pads\(\)\.length\)/);
});

test('TV view never hides a page that has not adopted .board: every hiding rule is scoped to a board or to its own control', () => {
  const css = fs.readFileSync(path.join(ROOT, 'static/tv.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  // allowed hide list on TV: the page title, no filter UI, the dx (D/XL-only) tiles, P2-P4 table columns, tv-hide opt-in
  const allowed = [/\.ptitle/, /\.data-btn/, /\.pscope/, /\.fbar/, /\.tv-hide/, /\.tile\.dx/, /\[data-pri\]/, /\.coast-ends \.sel/, /#hosts/, /#pgs button svg/, /#pgs \.rsub/, /\.sheet-h::before/];
  const hides = rules.filter((r) => /display:\s*none/.test(r.body));
  for (const r of hides) {
    if (allowed.some((a) => a.test(r.sel))) continue;
    assert.match(r.sel, /\.board/, r.sel + ' may only hide inside a .board (a boardless page shows everything and scrolls)');
  }
  // no row cap by index anywhere: rows are cut by height inside a board, by tv.js
  assert.doesNotMatch(css, /nth-child\(n\+/, 'no row cap by count outside the board');
  assert.doesNotMatch(css, /\.more-row/);
  // tv.js marks rows only inside a board, and a stop clipped by a board only counts when it is inside one
  assert.match(src, /const boards = \[\.\.\.d\.querySelectorAll\('\.board'\)\]/);
  assert.match(src, /const clipped = \(el\) => \{ const b = isTv\(\) && el\.closest\('\.board'\)/);
});

test('nothing in tv.js or tv.css needs an engine newer than Chrome 108 (the owner\'s Samsung TV browser)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'static/tv.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // color-mix 111, nesting 112, text-wrap 114, @scope 118, @starting-style 117, subgrid 117, light-dark 123, field-sizing 123
  for (const re of [/color-mix\(/, /text-wrap/, /@scope/, /@starting-style/, /subgrid/, /light-dark\(/, /field-sizing/, /&/]) assert.doesNotMatch(css, re, String(re));
  const js = src.replace(/\/\/[^\n]*/g, '');
  // toSorted/toReversed/with 110, Object.groupBy 117, Promise.withResolvers 119, Array.fromAsync 121, Set methods 122
  for (const re of [/\.toSorted\(/, /\.toReversed\(/, /\.toSpliced\(/, /\.with\(/, /groupBy\(/, /withResolvers/, /fromAsync/, /\.union\(|\.intersection\(/, /checkVisibility/]) assert.doesNotMatch(js, re, String(re));
});

test('the TV strip figure pin applies to the six-cell strip only, so a wider strip keeps the shared step-down', () => {
  const css = fs.readFileSync(path.join(ROOT, 'static/tv.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const pins = [...css.matchAll(/([^{}]+)\{([^{}]*font-size:var\(--fs-fig\)[^{}]*)\}/g)].map((m) => m[1].trim());
  assert.ok(pins.length, 'the six-cell pin exists');
  for (const sel of pins) assert.match(sel, /\.strip\[data-nb="6"\]/, sel + ' must not pin the figure size on a strip of any other width');
  assert.doesNotMatch(css, /html\.tv \.strip>\.tile \.v\{font-size/, 'no bare strip figure pin');
});

test('a held OK activates once: a repeated Enter keydown never reaches the stop (RevTodayHome, RevWorkPad, Main)', () => {
  // enter() refuses a repeat for every caller, and onKey swallows a repeated Enter or Back so no native activation follows
  assert.match(src, /function enter\(e\) \{\s*const t = d\.activeElement;\s*if \(e && e\.repeat\) return false;/);
  assert.match(src, /if \(e\.repeat && \(k === 'enter' \|\| k === 'back'\)\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); return; \}/);
  const enterBody = src.slice(src.indexOf('function enter(e) {'), src.indexOf('// the one-time prompt'));
  assert.match(enterBody, /t\.click\(\)/);
  assert.equal((enterBody.match(/\.click\(\)/g) || []).length, 1, 'one activation per call');
  // the synthetic pad: a HELD OK over a burst is one 'enter', two distinct presses are two, and the page's 3 s window
  // decides whether those two arm then fire
  const ok = { dir: null, ok: true, back: false }, none = { dir: null, ok: false, back: false };
  const run = (inputs) => { let s = TvCore.padInit(); const fire = []; for (const [t, inp] of inputs) { const r = TvCore.padStep(s, inp, t); s = r.state; fire.push(...r.fire); } return fire.filter((f) => f === 'enter'); };
  assert.deepEqual(run([[0, ok], [16, ok], [32, ok], [48, ok], [64, ok], [80, ok]]), ['enter'], 'one hold, one activation');
  assert.deepEqual(run([[0, ok], [16, none], [1000, ok], [1016, none]]), ['enter', 'enter'], 'two presses, two activations, inside the 3 s arm window');
  const held = { dir: null, ok: false, back: true };
  assert.deepEqual(run([[0, held], [16, held], [32, none]]).length, 0, 'no Enter from Back');
  let s = TvCore.padInit(); const backs = [];
  for (const [t, inp] of [[0, held], [16, held], [32, held], [48, none], [64, held]]) { const r = TvCore.padStep(s, inp, t); s = r.state; backs.push(...r.fire); }
  assert.deepEqual(backs.filter((f) => f === 'back'), ['back', 'back'], 'a held Back is one level, a new press is another');
});

test('a board refits after a page repaint, so the cut rows and the clipped stops never go stale', () => {
  assert.match(src, /new MutationObserver\(\(\) => \{[\s\S]{0,160}?if \(isTv\(\)\) fitBoards\(\);\s*\}, 200\)/);
  assert.match(src, /\.observe\(d\.body, \{ childList: true, subtree: true \}\)/);
  // the refit is TV only, and a boardless page still has nothing to cut
  const boot = src.slice(src.indexOf('function boot()'), src.indexOf("if (d.readyState === 'loading')"));
  assert.match(boot, /if \(isTv\(\) && typeof MutationObserver === 'function'\)/);
  assert.match(src, /const boards = \[\.\.\.d\.querySelectorAll\('\.board'\)\]/);
});

test('the TV coast strip lays out by width and never breaks a value mid-number', () => {
  const css = fs.readFileSync(path.join(ROOT, 'static/tv.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // one row of 14 at every size: 229 px at 1536 with 7 of 7 spot cards, against 285 or 314 for the forms with a painted value
  // at every width, or two rows
  assert.match(css, /html\.tv \.coast ol\{grid-template-columns:repeat\(14,minmax\(0,1fr\)\);row-gap:0\}/);
  // the value is painted from 1600 up and assistive-only below it, the panel padding and the ends row are trimmed
  assert.match(css, /@media \(max-width:1599px\)\{html\.tv \.cs b\{[^}]*clip:rect\(0 0 0 0\)/);
  assert.doesNotMatch(css, /html\.tv \.cs b\{display:none/, 'no value is removed from the page');
  assert.match(css, /html\.tv \.coast\{padding:var\(--s-2\) var\(--s-3\)\}/);
  assert.match(css, /html\.tv \.coast-ends\{margin-top:0;font-size:var\(--fs-micro\)/);
  // both labels stay painted and wrap; nothing is nowrap, which is what collided
  assert.match(css, /html\.tv \.cs b\{[^}]*white-space:normal/, 'the value wraps where it is painted');
  assert.match(css, /html\.tv \.cs small\{[^}]*overflow-wrap:break-word/, 'names break on a space first, never mid-word when a space fits');
  assert.match(css, /html\.tv \.cs small\{[^}]*word-break:normal/, 'no break anywhere inside a word');
  assert.doesNotMatch(css, /html\.tv \.cs small\{[^}]*white-space:nowrap/, 'the painted name wraps instead of colliding');
  // a compact segment bar: the strip is a ribbon, not a panel
  assert.match(css, /html\.tv \.cs>i\{height:1\.4rem\}/);
});

test('TV coast names: a page label wins, the two blueprint-long names get a TV label, the full name is kept', () => {
  // the map is data, and the page overrides it with data-tv-short; the full name survives in the attribute and the title
  assert.match(src, /const TV_SHORT = \{ 'Monterey and Santa Cruz': 'Monterey', 'San Francisco and Marin': 'SF and Marin', 'Sonoma to Del Norte': 'Sonoma Norte' \}/);
  assert.match(src, /const want = s\.dataset\.tvShort \|\| TV_SHORT\[full\] \|\| full;/);
  assert.match(src, /const full = s\.dataset\.tvFull \|\| \(s\.dataset\.tvFull = s\.textContent\.trim\(\)\)/);
  assert.match(src, /if \(btn && !btn\.title\) btn\.title = full;/);
  // TV only: a phone or desk keeps the page's own wording
  const body = src.slice(src.indexOf('function shortCoast()'), src.indexOf('function fitBoards()'));
  assert.match(body, /if \(!isTv\(\)\) return;/);
  // and it runs before the board is measured, so the strip's height is the short form's height
  assert.match(src, /function fitBoards\(\) \{\s*shortCoast\(\);/);
});
