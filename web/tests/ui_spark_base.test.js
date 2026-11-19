// node --test tests/*.test.js  (DeckUI.spark option base, 2026-11-15: a hairline at the previous close or the first value)
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../static/ui.css'), 'utf8');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const U = new Function(cut(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();

test('spark without base: byte for byte what main (a046b6d) drew', () => {
  assert.equal(U.spark([3, 1, null, 4, 1, 5], { w: 120, h: 24, label: 'A <b>' }),
    '<svg class="spark" viewBox="0 0 120 24" preserveAspectRatio="none" role="img" aria-label="A &lt;b&gt;"><polyline class="ln" points="0.0,12.0 24.0,22.0"/><polyline class="ln" points="72.0,7.0 96.0,22.0 120.0,2.0"/><circle class="dot" cx="120.0" cy="2.0" r="2.2"/></svg>');
  assert.equal(U.spark([2, 2], {}),
    '<svg class="spark" viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden="true"><polyline class="ln" points="0.0,12.0 120.0,12.0"/><circle class="dot" cx="120.0" cy="12.0" r="2.2"/></svg>');
  assert.equal(U.spark([10, 12, 11], { w: 64, h: 20 }),
    '<svg class="spark" viewBox="0 0 64 20" preserveAspectRatio="none" aria-hidden="true"><polyline class="ln" points="0.0,18.0 32.0,2.0 64.0,10.0"/><circle class="dot" cx="64.0" cy="10.0" r="2.2"/></svg>');
  assert.equal(U.spark([1], { base: 1 }), '', 'one point is still no line, base or not');
});

test('spark with base: the hairline is drawn first, at the base, and the scale takes the base in', () => {
  // inside the range: the line keeps its own scale, the hairline sits at the value's height
  const a = U.spark([10, 12, 11], { w: 64, h: 20, base: 11 });
  assert.match(a, /^<svg class="spark"[^>]*><line class="base" x1="0" x2="64" y1="10\.0" y2="10\.0"\/><polyline class="ln" points="0\.0,18\.0 32\.0,2\.0 64\.0,10\.0"\/>/);
  // below the range: the domain stretches to hold it, so the hairline is at the bottom and the line rises off it
  const b = U.spark([10, 12, 11], { w: 64, h: 20, base: 8 });
  assert.match(b, /<line class="base" x1="0" x2="64" y1="18\.0" y2="18\.0"\/>/);
  assert.match(b, /<polyline class="ln" points="0\.0,10\.0 32\.0,2\.0 64\.0,6\.0"\/>/);
  assert.equal(U.spark([10, 12, 11], { base: 'x' }), U.spark([10, 12, 11], {}), 'a base that is not a number draws nothing');
  assert.match(css, /\.spark \.base\{stroke:var\(--c-line-strong\);stroke-width:1;vector-effect:non-scaling-stroke\}/);
});
