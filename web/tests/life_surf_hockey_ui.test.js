// node --test tests/life_surf_hockey_ui.test.js
// The old Life surf and hockey cards are gone (2026-11-15); hockey lives on as Today's glance tile.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const a = src.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const b = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
assert.ok(a >= 0 && b > a, 'helper block markers present');
const D = new Function(src.slice(a, b) + '\nreturn DeckUI;')();

const NOW = Date.UTC(2026, 9, 1, 4, 0, 0);
const T = (agoS) => NOW / 1000 - agoS;
const feed = (o) => Object.assign({ src: '~/.meshvault/status/house-feeds/x.json', t: T(30), age: 30, stale: false, refresh: 60, sources: ['ndbc'], errors: [] }, o);

test('Today hockey tile: a live game leads with its score', () => {
  const h = feed({
    teams: [{ abbr: 'ANA', record: '3-1-0', points: 6, next_game: { opp: 'SJS', at: T(-86400), home: false } }],
    live: [{ home: 'ANA', away: 'VGK', score: '1-1', period: 2, clock: '10:05', gc: '/gamecenter/vgk-vs-ana/2026/10/01/2' }]
  });
  const today = D.tdGlance({ hockey: h }).html;
  assert.match(today, /Hockey · live/);
  assert.match(today, /1-1/);
  assert.match(today, /VGK at ANA · P2/);
  assert.doesNotMatch(today, /—|–/);
});
