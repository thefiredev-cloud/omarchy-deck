'use strict';
// The wide step (W4-1, SeeWs4): above 2200 px the page fills the owner's workspace 4 window (2470x1286) and the full 3440 monitor
// instead of stopping at the 96rem XL cap. One token, --wide-cols, picks the form. Nothing below 2200 px and nothing on TV changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tokens = fs.readFileSync(path.join(__dirname, '..', 'static', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const block = (q) => { const i = tokens.indexOf(q + '{'); assert.ok(i >= 0, q); const b = tokens.slice(i + q.length + 1); return b.slice(0, b.indexOf('\n}')); };
const decls = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+):([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));

test('a wide step above 2200 px sets only the column count and the content cap, from one token', () => {
  const w = decls(block('@media (min-width:2200px) and (min-height:500px)'));
  assert.deepEqual(Object.keys(w).sort(), ['--col-max', '--content-max', '--wide-cols']);
  assert.ok(['4', '5'].includes(w['--wide-cols']), 'four wider columns or a fifth column');
  assert.equal(w['--col-max'], 'var(--wide-cols)');
  // the cap is the window (100%) for four columns and 120rem for five: evaluate the one formula for both forms
  const cap = (n) => w['--content-max'].replace(/var\(--wide-cols\)/g, String(n));
  for (const [n, want] of [[4, { pct: 100, rem: 0 }], [5, { pct: 0, rem: 120 }]]) {
    const m = cap(n).match(/^calc\(100% \* \((\d+) - (\d+)\) \+ 120rem \* \((\d+) - (\d+)\)\)$/);
    assert.ok(m, cap(n));
    assert.deepEqual({ pct: 100 * (m[1] - m[2]), rem: 120 * (m[3] - m[4]) }, want, n + ' columns');
  }
});

test('the wide step comes after XL and leaves every smaller class and the TV view alone', () => {
  const steps = [...tokens.matchAll(/@media \(min-width:(\d+)px\) and \(min-height:500px\)\{/g)].map((m) => +m[1]);
  assert.deepEqual(steps, [1100, 1600, 2200], 'D, XL, then the wide step');
  // XL keeps its own cap and four columns below 2200 px
  const xl = decls(block('@media (min-width:1600px) and (min-height:500px)'));
  assert.equal(xl['--content-max'], '96rem');
  assert.equal(xl['--col-max'], '4');
  // TV sets both tokens on html.tv, which outranks :root at any width
  const tv = decls(tokens.slice(tokens.indexOf('html.tv{'), tokens.indexOf('}', tokens.indexOf('html.tv{'))));
  assert.equal(tv['--col-max'], '2');
  assert.equal(tv['--content-max'], '100%');
  // no other stylesheet keys anything to the wide step
  for (const f of ['ui.css', 'tv.css', 'app.css']) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8'), /2200px/, f);
});
