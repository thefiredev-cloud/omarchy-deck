// The compact Pad (P and L) hides the key pages; arrows, Esc, Tab and the modifiers sit in the "Keys and binds" block (#kbnav, #kbmods).
// Owner defect, 2026-10-29: Up sat over Right instead of over Down, and the block said esc tab ctrl alt while the key page says Esc Tab Ctrl Alt.
// The iOS shell (PadKeyboardFocusTests) reads #kin #kpages #kbmods #kbnav #kbfav #kblist and the order of #kbnav and #kbmods.
// Layout rules live in static/css/pad.css on the v3 device classes (tokens.css): P width < 600, L height < 500 and width >= 600,
// T 600-1099 with height >= 500, D >= 1100 with height >= 500, TV html.tv. Never on orientation alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const html = read('index.html'), css = read('css/pad.css');
const buttons = (id) => {
  const m = html.match(new RegExp(`<div id="${id}">([\\s\\S]*?)</div>`));
  assert.ok(m, `#${id} exists`);
  return [...m[1].matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map((b) => ({ attrs: b[1], text: b[2].trim(), key: (b[1].match(/data-(?:k|m)="([^"]+)"/) || [])[1] }));
};
// the body of every @media block with exactly this query, joined
const mediaBlocks = (query) => {
  const out = [];
  let i = css.indexOf(`@media ${query}{`);
  while (i >= 0) {
    let depth = 0;
    const j = css.indexOf('{', i);
    for (let k = j; k < css.length; k++) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}' && --depth === 0) { out.push(css.slice(j + 1, k)); break; }
    }
    i = css.indexOf(`@media ${query}{`, i + 1);
  }
  return out.join('\n');
};
const P_OR_L = '(max-width:599px),(min-width:600px) and (max-height:499px)';
const L = '(min-width:600px) and (max-height:499px)';
const T_OR_D = '(min-width:600px) and (min-height:500px)';
const D = '(min-width:1100px) and (min-height:500px)';

test('the shell contract ids are in index.html once each', () => {
  for (const id of ['kin', 'kpages', 'kbmods', 'kbnav', 'kbfav', 'kblist']) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `#${id} appears once`);
  }
});

test('compact Pad: Up sits directly over Down and Left and Right flank Down (standard arrow cluster)', () => {
  const keys = buttons('kbnav').map((b) => b.key);
  assert.deepEqual(keys, ['esc', 'up', 'tab', 'backspace', 'left', 'down', 'right', 'enter'], '#kbnav order is the iOS contract');
  assert.match(css, /#kbnav\{[^}]*grid-template-columns:repeat\(4,/, 'a four-column grid, filled row by row');
  const col = (k) => keys.indexOf(k) % 4, row = (k) => Math.floor(keys.indexOf(k) / 4);
  assert.equal(col('up'), col('down'), 'Up is in the column of Down');
  assert.equal(row('up') + 1, row('down'), 'Up is on the row above Down');
  assert.equal(row('left'), row('down'));
  assert.equal(row('right'), row('down'));
  assert.equal(col('left') + 1, col('down'));
  assert.equal(col('right') - 1, col('down'));
});

test('compact Pad: the Keys and binds block says Esc, Tab, Ctrl and Alt like the key page, in the contract order', () => {
  const nav = buttons('kbnav'), mods = buttons('kbmods');
  assert.deepEqual(mods.map((b) => b.key), ['cmd', 'ctrl', 'alt', 'shift'], '#kbmods order is the iOS contract');
  assert.equal(nav.find((b) => b.key === 'esc').text, 'Esc');
  assert.equal(nav.find((b) => b.key === 'tab').text, 'Tab');
  assert.equal(mods.find((b) => b.key === 'ctrl').text, 'Ctrl');
  assert.equal(mods.find((b) => b.key === 'alt').text, 'Alt');
  for (const b of [...nav, ...mods]) assert.doesNotMatch(b.text, /^[a-z]/, `${b.key} label starts with a capital or a symbol`);
});

test('the key page labels the same keys with the same words', () => {
  const pad = read('pad.js');
  for (const word of ['Esc', 'Tab', 'Ctrl', 'Alt']) assert.ok(pad.includes(`'${word}'`), `pad.js labels ${word}`);
});

test('pad.css switches on device classes, never on orientation', () => {
  assert.doesNotMatch(css, /orientation\s*:/, 'no orientation media query');
  for (const q of [P_OR_L, L, T_OR_D, D]) assert.ok(mediaBlocks(q), `has a ${q} block`);
});

test('P and L: the compact Pad hides the key pages and shows the click row and the Keys and binds toggle', () => {
  const c = mediaBlocks(P_OR_L);
  assert.match(c, /#scr,#mrow,#ppg,#kpages\{display:none\}/);
  assert.match(c, /#kbtoggle\{display:flex/);
  assert.match(c, /#kbrest\{display:none\}/);
  assert.match(c, /#padpg\.kb-open #kbrest\{display:flex/);
  assert.match(c, /#kin\{position:sticky;bottom:0/, 'the type field stays in reach while the binds scroll');
});

// TestFlight ANELZ1_IlK96c_opgW01OlM (2026-10-19): in landscape the workspace list showed as a sliver under the click row.
test('L: with Keys and binds open the click row steps aside and the keys column takes the full height', () => {
  const c = mediaBlocks(L);
  assert.match(c, /#padpg\.kb-open\{grid-template-areas:"pad keys" "pad keys"\}/);
  assert.match(c, /#padpg\.kb-open #kbmouse\{display:none\}/);
  assert.match(css, /#kbfav:has\(>\.hint:only-child\)\{min-height:0\}/, 'the empty pin row is only as tall as its hint');
});

test('T and D: the compact-only blocks give way to the key pages', () => {
  assert.match(mediaBlocks(T_OR_D), /#kbmouse,#kbmods,#kbnav\{display:none\}/);
});

// Baseline problem 25 (2026-11-14): at 1920 the trackpad was an empty 1340 x 940 box and the keys sat squeezed in 475 px at 12-13 px.
test('D: a wide side column with readable keys, one scroller for the binds, and the machine line', () => {
  const d = mediaBlocks(D);
  assert.match(css, /--pad-side:clamp\(22rem,40%,36rem\)/, 'the side column takes 40% between 22rem and 36rem');
  assert.match(d, /#padpg\{grid-template-columns:minmax\(0,1fr\) 3rem var\(--pad-side\)/);
  assert.match(d, /#padwho\{display:block\}/, 'the machine line shows on desk screens');
  assert.match(css, /#padwho\{display:none;/, 'and nowhere else');
  assert.match(d, /#pside\{overflow-y:auto/);
  assert.match(d, /#kblist\{flex:none;max-height:none;overflow:visible\}/, 'the bind list scrolls with the side column, not nested inside it');
  assert.match(d, /#kin\{position:sticky;bottom:0/);
  assert.match(mediaBlocks(T_OR_D), /\.kc\{font-size:var\(--fs-body\)\}/, 'key labels use the body step (18 px on D)');
});

test('TV: the Pad is not offered and the Keys page is a focus grid', () => {
  assert.match(css, /html\.tv #padpg,html\.tv \[data-sub="pad"\]\{display:none!important\}/, 'Pad > Pad and its sub-tab are gone on TV');
  assert.match(css, /html\.tv #keys \.key:focus-visible\{[^}]*transform:scale\(1\.04\)/);
  assert.match(css, /html\.tv #conn1,html\.tv #conn2\{display:none\}/);
});

// Layout audit by eye, 2026-11-15 (LayoutL rows 80-85, LayoutT rows 56-58)
test('L: the three clicks are even, and with keys closed they fill the column beside the trackpad', () => {
  assert.match(css, /#kbmouse\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);
  assert.match(mediaBlocks(L), /#padpg\{[^}]*grid-template-rows:minmax\(0,1fr\) auto;grid-template-areas:"pad clicks" "pad keys"\}/);
});

test('Keys: Connections flow as balanced columns, never one fixed stack per half; the TV board keeps its grid', () => {
  const lt = mediaBlocks('(min-width:600px)'), d = mediaBlocks(D);
  assert.match(lt, /html:not\(\.tv\) #keyspg\{display:block;height:auto;columns:2/);
  assert.match(lt, /html:not\(\.tv\) #keyswrap\{column-span:all/);
  assert.match(lt, /#conn1,#conn2\{display:contents\}/);
  assert.match(lt, /#conn1>\*,#conn2>\*\{break-inside:avoid/);
  assert.match(d, /html:not\(\.tv\) #keys\{display:block;columns:3/, 'D and XL: the key groups as three columns across the top');
  assert.doesNotMatch(css, /#keyspg\{grid-template-columns:minmax\(0,1(\.\d)?fr\) minmax\(0,1fr\)/, 'no fixed column per connection stack');
});

// Layout wave 2 (LayoutT-2 N5): at 834 the groups wrapped at four or five keys of 104 px and left the right third empty
test('Keys: a group fills its row evenly like a keypad, and no key sits alone on a row', () => {
  assert.match(css, /html:not\(\.tv\) #keys \.krow\{container:keyrow\/inline-size\}/, 'TV keeps its own grid (no container there)');
  assert.match(css, /#keys \.kgrid>\.key\{flex:1 0 calc\(\(100% - \(var\(--k,var\(--c\)\) - 1\) \* var\(--s-2\)\) \/ var\(--k,var\(--c\)\) - 1px\)\}/,
    'one C-th (or K-th) of the row, one pixel short, growing to fill');
  assert.doesNotMatch(css, /#keys \.key[^{]*\{margin-right/, 'no early row end that leaves a blank beside the keys');
  const tiers = [...css.matchAll(/@container keyrow \(([\d.]+)rem<=width(?:<([\d.]+)rem)?\)\{#keys \.kgrid\{--c:(\d+)\}([^\n]*)\}/g)];
  assert.equal(tiers.length, 9, 'C = 3 to 11 bounded tiers');
  for (const [, lo, hi, c, body] of tiers) {
    const C = +c, k = Math.ceil((C + 1) / 2), q = `#keys .key:first-child:nth-last-child(${C + 1})`;
    assert.equal(+lo, 6 * C - 0.5, `C=${C} starts where C keys of 5.5rem and their gaps fit`);
    assert.equal(+hi, 6 * (C + 1) - 0.5);
    assert.ok(body.includes(`${q},${q}~.key{--k:${k}}`), `C=${C}: ${C + 1} keys split ${k} and ${C + 1 - k}`);
  }
  assert.match(css, /@container keyrow \(width>=71\.5rem\)\{#keys \.kgrid\{--c:12\}/);
});

test('pad.css uses v3 tokens only: no old token names, no remote assets, no font under 13 px', () => {
  assert.doesNotMatch(css, /var\(--(fg|dim|lighter-bg|dark-bg|pa|tint|raised|edge|text-[123]|sp-[1-6]|touch|r-md|r-card|fs-age)\)/, 'no legacy token');
  assert.doesNotMatch(css, /url\(/, 'no url() at all');
  for (const m of css.matchAll(/font(?:-size)?:[^;}]*?(\d+(?:\.\d+)?)px/g)) assert.ok(Number(m[1]) >= 13, `font size ${m[1]}px`);
});

test('a latched modifier is bone on ground, never the signal colour', () => {
  assert.match(css, /\.kc\.on,#pside button\.b\.mod\.on,#pside button\.b\.mod\.lock\{background:var\(--c-text-1\)/);
  assert.doesNotMatch(css, /\.kc\.on[^{]*\{[^}]*--c-signal/);
});
