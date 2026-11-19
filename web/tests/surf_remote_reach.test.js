'use strict';
require('./setup-core.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { S, feed } = require('./surf_fixture.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const tv = read('static/tv.js');
const core = tv.match(/\/\/ ==== TV CORE BEGIN[^\n]*\n([\s\S]*?)\/\/ ==== TV CORE END ====/)[1];
const T = new Function(core + '\nreturn TvCore;')();
const css = read('static/css/surf.css');
const mineOf = f => { const h = S.page(f, { region: 'orange-county', good: false, sort: 'rating', more: 50 }); return h.slice(h.indexOf('class="sect sf-mine'), h.indexOf('class="sect sf-coast"')); };

// The real fold can put a region group between two ordinary cards. CSS grid's auto-placement starts a new row for
// its old 1/-1 span, then another row for later cards. Model those rows in unit cells; TvCore is the page's actual
// directional picker. Three home bands push the coast beyond the board, where tv.js's clipped guard excludes it.
function walk(f) {
  const h = mineOf(f);
  const spansRegion = /html\.tv \.sf-mine \.cards>\.sf-rhd\{grid-column:span var\(--sf-spots,1\)\}/.test(css);
  const spansGroup = /html\.tv \.sf-mine \.cards>\.sf-grp\{grid-column:span var\(--sf-spots,1\)\}/.test(css);
  const cards = [...h.matchAll(/<(?:button|div) class="spot(?: ([^"]+))?"([^>]*)>/g)];
  let row = 0, col = 0;
  const homes = cards.map((m, i) => {
    const region = /\bsf-rhd\b/.test(m[1] || '');
    const n = Number((m[2].match(/--sf-spots:(\d+)/) || [])[1] || 1);
    const span = region ? spansRegion ? n : 7 : /\bsf-grp\b/.test(m[1] || '') && spansGroup ? n : 1;
    if (col + span > 7) { row++; col = 0; }
    const r = { l: col * 20, r: (col + span) * 20 - 2, t: row * 100, b: row * 100 + 80, name: 'home' + i, path: ['page', 'board', 'mine'] };
    col += span;
    return r;
  });
  const top = (row + 1) * 100 + 20;
  const coast = Array.from({ length: 14 }, (_, i) => ({ l: i * 10, r: i * 10 + 8, t: top, b: top + 40, name: 'coast' + i, path: ['page', 'board', 'coast'] }));
  const usable = homes.concat(coast).filter(r => r.t < 300 - 1);
  const seen = new Set([0]), queue = [0];
  while (queue.length) {
    const i = queue.shift();
    for (const dir of ['down', 'right', 'up', 'left']) {
      const next = T.pick(dir, usable[i], usable);
      if (next >= 0 && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return { reached: [...seen].filter(i => usable[i].name.startsWith('coast')).length, rows: row + 1, h };
}

test('mixed spot and region home cards leave all fourteen coast stops reachable by the page spatial picker', () => {
  const f = feed();
  f.spots.filter(s => s.region === 'orange-county').forEach((s, i) => { s.now.height_basis = s.id === 'doheny' ? 'region' : 'spot'; s.now.wave_ft = [i + 2, i + 3]; });
  const r = walk(f);
  assert.equal(r.reached, 14, 'a region-only break must not push the entire coast below the clipped TV board');
  assert.equal(r.rows, 1, 'the seven home cells stay in one band');
});

test('a region group carries its own break count for its TV span and inner columns', () => {
  const f = feed();
  f.spots.filter(s => s.region === 'orange-county').forEach(s => { s.now.height_basis = 'region'; });
  assert.match(mineOf(f), /class="spot sf-rhd" style="--sf-spots:7"/);
  assert.match(css, /html\.tv \.sf-rhd \.sf-rrows\{grid-template-columns:repeat\(var\(--sf-spots,1\),minmax\(0,1fr\)\)/);
  assert.equal(walk(f).reached, 14);
});

test('identical spot groups also take their break count, so long names do not grow the home band', () => {
  assert.match(mineOf(feed()), /class="spot sf-grp" style="--sf-spots:3"/);
  assert.match(css, /html\.tv \.sf-mine \.cards>\.sf-grp\{grid-column:span var\(--sf-spots,1\)\}/);
  assert.equal(walk(feed()).reached, 14);
});
