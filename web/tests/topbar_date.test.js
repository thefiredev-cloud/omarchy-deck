// node --test tests/topbar_date.test.js  (the date beside the clock in the top bar: D and XL only; no DOM, no network)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../static/css/home.css'), 'utf8');
const a = app.indexOf('// the date beside the clock'), b = app.indexOf('// Fullscreen and orientation lock');
assert.ok(a >= 0 && b > a);

// the clock block against a tiny fake page: #clock, #ambclock and whatever is placed before #clock
function boot(withBefore = true) {
  const els = {}, placed = [];
  const el = (id) => ({ id, textContent: '' });
  els['#clock'] = el('clock'); els['#ambclock'] = el('ambclock');
  if (withBefore) els['#clock'].before = (n) => placed.push(n);
  const document = { createElement: (tag) => ({ tag, id: '', textContent: '' }) };
  const $ = (s) => els[s] || null;
  const run = new Function('$', 'document', app.slice(a, b) + '\nreturn {clock, tdate};');
  return Object.assign(run($, document), { els, placed });
}

test('the clock writes the time and, beside it, the date in plain words', () => {
  const t = boot();
  assert.equal(t.placed.length, 1, 'one date element, placed once before the clock');
  assert.equal(t.placed[0], t.tdate);
  assert.equal(t.tdate.tag, 'time');
  assert.equal(t.tdate.id, 'tdate');
  t.clock();
  assert.match(t.tdate.textContent, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}$/);
  assert.doesNotMatch(t.tdate.textContent, /\d{4}/, 'no year, no ISO date');
  assert.notEqual(t.els['#clock'].textContent, '');
  assert.equal(t.els['#ambclock'].textContent, t.els['#clock'].textContent, 'the ambient clock keeps the time alone');
});

test('a page without the clock slot (a test page, an old shell) still ticks', () => {
  const t = boot(false);
  assert.equal(t.tdate, null);
  assert.doesNotThrow(() => t.clock());
});

test('the date shows on D and XL only: P, L, T and TV keep the clock alone, so the L bar and its freshness mark do not move', () => {
  assert.match(css, /#tdate\{display:none\}/);
  const shown = [...css.matchAll(/([^{}]*#tdate[^{}]*)\{([^}]*)\}/g)].filter((m) => /display:inline/.test(m[2])).map((m) => m[1].trim());
  assert.deepEqual(shown, ['html[data-dc="D"] #tdate,html[data-dc="XL"] #tdate']);
  assert.doesNotMatch(css, /data-dc="(P|L|T|TV)"\][^{]*#tdate/);
  // the device class the selector reads is the shell's own
  assert.match(app, /document\.documentElement\.dataset\.dc=c/);
});
