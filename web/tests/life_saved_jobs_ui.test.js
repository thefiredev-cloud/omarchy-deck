// node --test tests/life_saved_jobs_ui.test.js
// 2026-11-01 wave 2: the saved-jobs glue and server route, and the Today Almanac card. The Work > Jobs renderers (stars, Saved list,
// sheet tracker, by-category section) are tested in tests/work_jobs_ui.test.js since the design v3 rewrite (2026-11-14).
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const a = src.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const b = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
const D = new Function(src.slice(a, b) + '\nreturn DeckUI;')();
const glue = src.slice(b);
const app = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../rust/src/main.rs'), 'utf8');
const guest = fs.readFileSync(path.join(__dirname, '../rust/src/guest.rs'), 'utf8');

const NOW = Date.UTC(2026, 10, 1, 20, 0, 0);
const T = (agoS) => NOW / 1000 - agoS;
test('saved glue: never cached, same-origin JSON POST, star saves or opens, chip remembered, sheet state posts', () => {
  assert.match(glue, /fetch\('\/api\/saved-jobs\?person='\+encodeURIComponent\(p\),\{credentials:'same-origin',cache:'no-store'\}\)/);
  assert.match(glue, /fetch\('\/api\/saved-jobs',\{method:'POST',credentials:'same-origin',cache:'no-store',headers:\{'Content-Type':'application\/json'\}/);
  assert.match(glue, /if\(idx\.has\(key\)\)return savedOpen\(key\)/);
  assert.match(glue, /localStorage\.setItem\('job-saved-view',V6\.savedView\?'1':'0'\)/);
  assert.match(glue, /state:b\.dataset\.jstate/);
  assert.match(glue, /saved:V6\.saved\[V6\.person\],savedView:V6\.savedView/);
  // the client drops a link the store would refuse instead of failing the save
  const sjUrl = new Function(glue.slice(glue.indexOf('const sjUrl='), glue.indexOf('\n', glue.indexOf('const sjUrl='))) + '\nreturn sjUrl;')();
  assert.equal(sjUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  for (const bad of ['javascript:x', 'https://u@evil.com/', 'https://a b', 'https://x/"', '', null]) assert.equal(sjUrl(bad), '', String(bad));
});

test('server: saved-jobs is its own module, owner cookie only, and the guest table refuses it both ways', () => {
  assert.match(main, /^mod savedjobs;$/m);
  assert.match(main, /if a == "saved-jobs" \{\n\s+return saved_jobs_route\(/);
  assert.match(main, /let owner = !via_url && cookie_token\(h\)\.is_some_and\(\|c\| hosts::token_ok\(&c, &app\.token\)\);/);
  assert.match(guest, /\("GET", "\/api\/saved-jobs", "", "", false\),\n\s+\("POST", "\/api\/saved-jobs", "", "", false\),/);
});

// ---------------- Today > Almanac: the card left Today in design v3 (2026-11-14); Photos on this day is a glance tile now ----------------
test('Today reads no Almanac proxy and paints no Almanac card', () => {
  assert.doesNotMatch(glue, /\/almanac\/api\/today|tAlmanac/);
  assert.equal(D.tAlmanac, undefined);
});
