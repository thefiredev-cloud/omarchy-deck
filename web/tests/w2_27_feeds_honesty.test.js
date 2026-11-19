'use strict';
// node --test tests/w2_27_feeds_honesty.test.js  (no DOM, no network, fixed clock)
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(src.slice(src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), src.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const NOW = Date.parse('2026-10-09T17:00:00Z');

test('Money not set up: one line, no Try again, no old copy', () => {
  const html = D.finPage({error: 'file missing', src: '~/.meshvault/status/deck/finance.json', stale: true}, NOW, null);
  assert.match(html, /Money needs a finance feed\./);
  assert.doesNotMatch(html, /Try again|data-retry|Money is not reporting|None is set up/);
});

test('Money with a broken feed (not a missing one) still offers Try again', () => {
  const html = D.finPage({error: 'bad json'}, NOW, null);
  assert.match(html, /Money is not reporting/);
  assert.match(html, /data-retry="money\/accounts"/);
  assert.equal((D.finPage(null, NOW, null).match(/data-retry=/g) || []).length, 1);
});

const prod = extra => ({t: NOW / 1000, refresh_s: 300, stale: false, errors: [], products: [], needs: [], ...extra});
const app = (name, extra) => ({name, version: {string: '1.0', state: 'READY_FOR_SALE', build: 3},
  latest_build: {number: 3, state: 'VALID', uploaded: new Date(NOW - 3600e3).toISOString()},
  review: {state: 'READY_FOR_SALE'}, live_version: '1.0', url: 'https://appstoreconnect.apple.com/apps/1/distribution', ...extra});
// apps shown: a row of its own (class="frow") or a name inside a group by state (class="gname"); House groups Products since PR b
const tiles = html => (html.match(/class="frow"|class="gname"/g) || []).length;

test('every listed App Store app gets its own tile, in feed order', () => {
  const grid = D.products(prod({app_store: app('Alpha'), app_stores: [app('Alpha'), app('Beta'), app('Gamma')]}), NOW).grid;
  assert.equal(tiles(grid), 3);
  assert.ok(grid.indexOf('Alpha') < grid.indexOf('Beta') && grid.indexOf('Beta') < grid.indexOf('Gamma'));
});

test('no more than eight App Store tiles', () => {
  const many = Array.from({length: 9}, (_, i) => app('App ' + i));
  assert.equal(tiles(D.products(prod({app_stores: many}), NOW).grid), 8);
});

test('a withheld app stays a neutral Hidden tile beside the others', () => {
  const grid = D.products(prod({app_stores: [app('Visible'), {withheld: true}]}), NOW).grid;
  assert.match(grid, /Visible/);
  assert.match(grid, /Hidden/);
  assert.equal(tiles(grid), 2);
});

test('a feed without the app list still shows its single app', () => {
  const grid = D.products(prod({app_store: app('Solo')}), NOW).grid;
  assert.equal(tiles(grid), 1);
  assert.match(grid, /Solo/);
});
