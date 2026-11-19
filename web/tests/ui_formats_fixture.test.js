'use strict';
// node --test tests/ui_formats_fixture.test.js  (PlanEng item 5, PlanDesign section 5: one form per value; no DOM, no network)
// tests/fixtures/formats.json is a byte copy of the iOS app's Shared/Fixtures/formats.json: the web and the app print the same words.
// DeckCore.fmt prints every case's `out`; `web_before` is history (what the web printed before this round), never a target.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/formats.json'), 'utf8'));
const F = DeckCore.fmt;
// the fixture's function names, on the web's formatters ("missing" in a cell is the muted dot's text; its aria name is "No data")
const RUN = {
  money: (v, o) => F.money(v, o),
  age: (v) => F.age(v),
  time: (v) => F.time(v),
  date: (v, o) => F.date(v, o),
  change: (v, o) => (o && o.kind === 'pt' ? F.pt(v, o.d) : F.chg(v, o && o.d)),
  missing: (v, o) => String(F.na(o && o.mode)).replace(/<[^>]*>/g, ''),
};

test('the fixture is version 1 and every case names a function the web runs', () => {
  assert.equal(FX.version, 1);
  assert.ok(FX.cases.length >= 58, 'cases: ' + FX.cases.length);
  for (const c of FX.cases) assert.ok(RUN[c.fn], 'unknown fn ' + c.fn);
});

test('DeckCore.fmt prints the agreed form for every case', () => {
  const bad = [];
  for (const c of FX.cases) {
    const got = RUN[c.fn](c.in, c.opt);
    if (got !== c.out) bad.push(c.fn + '(' + JSON.stringify(c.in) + (c.opt ? ', ' + JSON.stringify(c.opt) : '') + ') = ' + JSON.stringify(got) + ', want ' + JSON.stringify(c.out));
  }
  assert.deepEqual(bad, []);
});

test('a missing cell keeps its spoken name, and the old money names print the same form', () => {
  assert.match(F.na(), /aria-label="No data"/);
  for (const c of FX.cases.filter((x) => x.fn === 'money' && !x.opt && x.in != null)) assert.equal(DeckCore.usd(c.in), c.out, 'usd ' + c.in);
  assert.equal(DeckCore.usd(null), '--');
});
