'use strict';
require('./setup-core.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const deck = read('static/deck.js');
const U = new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), deck.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();

test('loading strips and rows expose their Loading name on a group, not a generic div', () => {
  for (const kind of ['tile', 'row']) {
    const h = U.skeleton(kind, 4);
    assert.match(h, /<div[^>]*role="group"[^>]*aria-label="Loading"/);
    assert.match(h, /aria-busy="true"/);
  }
});

test('middle-ramp map figures keep the same full-contrast ink as the state code', () => {
  const css = read('static/ui.css');
  assert.match(css, /\.usmap \.st\[data-q="3"\] small\{opacity:1\}/);
});

test('Fleet and Cluster group headings follow the page heading without skipping a level', () => {
  for (const html of [U.fleetDevices({}, Date.now()), U.clusterModels({ devices: [{ device: 'Test machine', models: ['Test model'] }] }, {}, Date.now())]) {
    assert.match(html, /class="frow dgh" role="heading" aria-level="2"/);
    assert.doesNotMatch(html, /class="frow dgh" role="heading" aria-level="3"/);
  }
});
