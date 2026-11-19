'use strict';
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(src.slice(src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), src.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const NOW = Date.parse('2026-10-03T22:10:00Z');
const feed = extra => ({t: NOW / 1000, refresh_s: 300, stale: false, errors: [], products: [], ...extra});

test('operational failures never become owner decisions', () => {
  const p = feed({needs: [
    {sev:'med', text:'Fix CI on JudgeBinder-iOS main', why:'CI failed', source:'dev.json'},
    {sev:'med', text:'Fleet check: 1 problem(s)', why:'M.2 96% used', source:'fleet-health-last.json'},
    {sev:'high', text:'Answer App Review for MeshVault 1.3', why:'review issues open', source:'app store connect'},
  ]});
  const r = D.products(p, NOW);
  assert.doesNotMatch(r.needs, /Fix CI|Fleet check/);
  assert.match(r.needs, /Answer App Review/);
});

test('maintenance stays visible outside owner decisions', () => {
  const p = feed({needs: [
    {sev:'med', text:'Fix CI on JudgeBinder-iOS main', why:'CI failed', source:'dev.json'},
    {sev:'high', text:'Fleet check: 1 problem(s)', why:'M.2 96% used', source:'fleet-health-last.json'},
  ]});
  assert.match(D.maintenanceRows(p), /Fix CI/);
  assert.match(D.maintenanceRows(p), /M\.2 96% used/);
  assert.equal(D.products(p, NOW).count, '0');
});

test('a withheld App Store record cannot render its private name or link', () => {
  const grid=D.products(feed({needs:[],app_store:{withheld:true,name:'Private specimen',url:'https://private.example/'}}),NOW).grid;
  assert.doesNotMatch(grid,/Private specimen|private\.example|href=/);
  assert.match(grid,/App Store/);
});


test('Apple waiting status is separate from owner decisions', () => {
  const p = feed({needs: [], app_store: {review:{state:'WAITING_FOR_REVIEW'}, version:{string:'1.3',state:'WAITING_FOR_REVIEW',build:36}}});
  assert.doesNotMatch(D.tdNeedsHtml(D.tdNeeds({ products: p }), []), /waiting for review/i);
  assert.doesNotMatch(D.products(p, NOW).grid, /Review waiting for review/);
});

test('provider errors appear only in maintenance on Home, and on Today only in the checks sheet', () => {
  const p = feed({needs: [], errors: [{source:'app_store', reason:'synthetic provider failure'}]});
  const home = D.products(p, NOW);
  assert.doesNotMatch(home.needs, /synthetic provider failure/);
  assert.match(home.maintenance, /synthetic provider failure/);
  const n = D.tdNeeds({ products: p });
  assert.doesNotMatch(D.tdNeedsHtml(n, n.miss), /synthetic provider failure/);
  assert.match(D.tdChecksSheet(n.miss), /synthetic provider failure/);
});

test('incomplete maintenance data never gets an all-clear', () => {
  for (const p of [feed({needs:[],stale:true}),feed({needs:[],errors:[{source:'app_store',reason:'no reading'}]}),feed({})]) {
    assert.doesNotMatch(D.maintenanceRows(p), /No maintenance problems reported/);
    assert.match(D.maintenanceRows(p), /incomplete|unavailable/i);
  }
});

test('a server-withheld scoped decision is not reconstructed by the browser', () => {
  const p=feed({needs:[],errors:[{source:'scope filter',reason:'Mixed-scope status withheld; owner decision coverage is incomplete'}]});
  const rendered=D.products(p,NOW);
  assert.equal(rendered.count,'--');
  assert.match(rendered.maintenance,/coverage is incomplete/);
});

test('stale or partial data never claims that nothing needs the owner', () => {
  for (const p of [feed({needs: [], stale:true}),feed({needs:[],errors:[{source:'app_store',reason:'no reading'}]}),feed({})]) {
    assert.doesNotMatch(D.needRows(p), /Nothing needs you|no open action/);
    assert.equal(D.products(p, NOW).count, '--');
  }
});
