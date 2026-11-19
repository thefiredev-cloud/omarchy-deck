// S1: mixed Show more looks on Shop and Fleet; A1: the first new row keeps keyboard focus.
require('./setup-core.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '../static', f), 'utf8');
const deck = read('deck.js'), shop = read('pages/shop.js'), ops = read('ops.js');
const D = new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), deck.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const S = new Function('DeckUI', shop + '\nreturn DeckShop;')(D);
const O = new Function('DeckUI', ops.slice(ops.indexOf('// ==== DECK OPS UI BEGIN'), ops.indexOf('// ==== DECK OPS UI END ====')) + '\nreturn DeckOps;')(D);
const fixture = require('./shop_fixture.cjs');
const NOW = (fixture().market.t + 600) * 1000;
const trends = require('./trends_fixture.cjs');
const market = (cls, view = {}) => {
  const f = fixture(), tr = trends.trends();
  tr.products = Array.from({ length: 20 }, (_, i) => ({ ...tr.products[0], title: 'Trending product ' + i, rank: i + 1 }));
  f.market.platforms = Array.from({ length: 30 }, (_, i) => ({ ...f.market.platforms[0], domain: 'platform-' + i + '.test', rank: i + 1 }));
  return S.marketBody({ m: f.market, e: f.ecom, l: f.listings, tr, now: NOW, cls, view });
};
const controls = h => [...h.matchAll(/<button[^>]*class="([^"]*)"[^>]*>Show [\d,]+ more<\/button>/g)];
const keys = h => [...h.matchAll(/data-key="([^"]+)"/g)].map(m => m[1]);
const band = (h, cls) => h.slice(h.indexOf(' s-' + cls + '"'), h.indexOf('</section>', h.indexOf(' s-' + cls + '"')));
const stalled = n => ({ t: NOW / 1000, items: Array.from({ length: n }, (_, i) => ({ id: 'run' + i, name: 'Run ' + i, state: 'stalled', kind: 'omp' })) });
const units = n => ({ t: NOW / 1000, writer_ok: true, failed_units: Array.from({ length: n }, (_, i) => 'unit-' + i + '.service') });

test('Shop: all expansion bands use the shared bordered control, preserving every first-page cap', () => {
  for (const cls of ['P', 'L', 'T', 'D', 'XL']) {
    const h = market(cls);
    assert.ok(controls(h).length > 1);
    assert.ok(controls(h).every(m => m[1] === 'btn'), cls + ': no grey bar mixed with a bordered button');
    assert.equal((h.match(/data-more-row=/g) || []).length, controls(h).length);
    assert.equal((band(h, 'trending').match(/class="frow trow/g) || []).length, 6);
    assert.equal((band(h, 'move').match(/class="frow prow/g) || []).length, ['D', 'XL'].includes(cls) ? 4 : 6);
    if (cls === 'P' || cls === 'L') assert.equal((band(h, 'plat').match(/class="rank-n"/g) || []).length, 10);
  }
  // The distinct phone-five cap belongs to Dev and remains unchanged on both phone orientations.
  assert.match(read('css/homeops.css'), /max-width:599px[\s\S]*max-height:499px[\s\S]*nth-child\(n\+6\)/);
});

test('Shop: each band expands by its own step and every newly exposed row has a focus key', () => {
  for (const [key, cls, step] of [['trend', 'P', 12], ['product', 'D', 12], ['plat', 'P', 20], ['plat', 'D', 20]]) {
    const h = market(cls), b = key === 'product' ? 'move' : key === 'trend' ? 'trending' : key;
    const old = keys(band(h, b)), base = key === 'plat' ? (cls === 'P' ? 10 : 24) : key === 'trend' ? 6 : 4;
    const next = keys(band(market(cls, { [key]: base + step }), b));
    assert.ok(next.length > old.length, key + ': its own band opens');
    assert.ok(DeckCore.moreFocus(old, next), key + ': first new row can receive focus');
  }
});

test('Shop: each expansion band has its own stable focus root when the final control disappears', () => {
  for (const cls of ['P', 'L', 'T', 'D', 'XL']) {
    const closed = market(cls), open = market(cls, { trend: 100, product: 100, plat: 100, deal: 100, lst: 100 });
    for (const key of ['trending', 'move', 'plat', 'deal', 'lst']) {
      for (const h of [closed, open]) assert.equal((h.match(new RegExp('id="shop-band-' + key + '"', 'g')) || []).length, 1);
    }
  }
});

test('Shop: a listing repeated in Deals cannot hide the first new Listings row from focus', () => {
  const f = fixture(), url = 'https://item.test/same';
  f.ecom.deals = [{ title: 'Repeated listing', price: 10, site: 'ebay', url }];
  f.listings = { listings: [{ title: 'Repeated listing', price: 10, source: 'ebay', url }], groups: [] };
  const h = S.marketBody({ m: f.market, e: f.ecom, l: f.listings, now: NOW, cls: 'D', view: { deal: 100 } });
  const deal = keys(band(h, 'deal')), listing = keys(band(h, 'lst'));
  assert.ok(deal.length && listing.length);
  assert.equal(listing.filter(k => deal.includes(k)).length, 0, 'keys identify a row in its own band');
});

test('Fleet: Agent runs and Background services share one look, keep eight rows, and key every new row', () => {
  const a = O.stalls(stalled(21), NOW), b = D.bUnits(units(21), NOW);
  assert.equal(controls(a + b).length, 2);
  assert.ok(controls(a + b).every(m => m[1] === 'btn'));
  for (const [closed, open] of [[a, O.stalls(stalled(21), NOW, 200)], [b, D.bUnits(units(21), NOW, true)]]) {
    assert.equal((closed.match(/class="frow/g) || []).length, 8);
    assert.equal(keys(closed).length, 8);
    assert.equal(keys(open).length, 21);
    assert.match(open, /data-bal-open/, 'the expanded band keeps its closed column plan');
    assert.equal(DeckCore.moreFocus(keys(closed), keys(open)), keys(open)[8]);
  }
  assert.match(b, /data-more-row="fleetunits"/);
  assert.match(a, /data-more-row="opsruns"/);
});

test('Fleet: opening Background services uses the cached band and makes no page read', () => {
  const app = read('app.js'), start = app.indexOf("document.addEventListener('click',e=>{const b=e.target&&e.target.closest&&e.target.closest('[data-more=\"fleetunits\"]')");
  const src = app.slice(start, app.indexOf('// #fsum', start));
  let click, reads = 0;
  const replaced = [], head = { replaceWith: n => replaced.push(n) }, list = { previousElementSibling: head, replaceWith: n => replaced.push(n) };
  const row = { previousElementSibling: list, replaceWith: n => replaced.push(n) };
  const button = { dataset: {}, closest: () => row };
  const document = { addEventListener: (_, fn) => { click = fn; }, createElement: () => ({ content: { querySelector: selector => ({ selector }) } }) };
  const u = units(21), html = D.bUnits(u, NOW);
  const state = new Function('document', 'DeckUI', 'fleet', 'data', 'html',
    'let fleetCols=["prefix"+html+"suffix"],fleetGood=fleetCols.slice(),fleetUnitsAll=false,fleetUnitsData=data,fleetUnitsHtml=html;\n' +
    src + '\nreturn ()=>({fleetCols,fleetGood,fleetUnitsAll});')(document, D, () => { reads++; return Promise.resolve(); }, u, html);
  click({ target: { closest: () => button } });
  assert.equal(reads, 0, 'Show more must not fetch Fleet again');
  assert.equal(state().fleetUnitsAll, true);
  assert.equal(keys(state().fleetCols[0]).length, 21);
  assert.equal(state().fleetGood[0], state().fleetCols[0], 'the cached fallback keeps the expanded band too');
  assert.deepEqual(replaced.map(n => n.selector), ['.secttl', '.flist', '.more-row']);
});

for (const failure of ['mcp-null', 'placement']) test('Fleet: ' + failure + ' failure retains matched rows and unit caches for the next expansion', async () => {
  const app = read('app.js'), start = app.indexOf("document.addEventListener('click',e=>{const b=e.target&&e.target.closest&&e.target.closest('[data-more=\"fleetunits\"]')");
  const listener = app.slice(start, app.indexOf('// #fsum', start));
  const refresh = app.slice(app.indexOf('async function fleet(){'), app.indexOf('let fleetLast=null;'));
  const oldData = units(21), oldHtml = D.bUnits(oldData, NOW);
  const newData = { ...units(3), failed_units: ['new-a.service', 'new-b.service', 'new-c.service'] };
  let click, placements = 0;
  const head = { replaceWith() {} }, list = { previousElementSibling: head, replaceWith() {} }, row = { previousElementSibling: list, replaceWith() {} };
  const document = { addEventListener: (_, fn) => { click = fn; }, createElement: () => ({ content: { querySelector: selector => ({ selector }) } }) };
  const feeds = {
    '/api/fleet': { items: [], stamp: '2026-11-16T00:00:00Z' }, '/api/nodes': {}, '/api/disks': {},
    '/api/sites': { items: [] }, '/api/mcp': failure === 'mcp-null' ? null : {},
    '/api/fleet-widgets': {}, '/api/cams': {}, '/api/fleet-board': { units: newData }
  };
  const ui = { ...D, fleetNotice: () => ({ blank: false }), board: bd => ['', '', '', '', D.bUnits(bd.units, NOW)],
    fleetNodes: () => '', fleetServices: () => '', fleetSignals: () => '', fleetDisks: () => '', fleetDevices: () => '', fleetFacts: () => '' };
  const api = new Function('document', 'DeckUI', 'oldData', 'oldHtml', 'jget', 'place',
    'let fleetCols=["old network","prefix"+oldHtml+"suffix","old devices"],fleetGood=fleetCols.slice(),fleetUnitsAll=false,' +
    'fleetUnitsData=oldData,fleetUnitsHtml=oldHtml,fleetLast=null;\n' +
    'const window={},fsumBox=()=>null,deckReady=async()=>{},fleetWhy=()=>"render failed",homeMark=()=>{},T=()=>\'<div class="tile">Retained</div>\';\n' +
    'const fleetPlace=c=>{place(c);fleetCols=c};\n' + listener + refresh +
    '\nreturn {refresh:fleet,state:()=>({fleetCols,fleetGood,fleetUnitsData,fleetUnitsHtml})};')(
      document, ui, oldData, oldHtml, async p => feeds[p], () => { if (++placements === 1 && failure === 'placement') throw Error('layout failed'); });
  await api.refresh();
  assert.equal(api.state().fleetUnitsData, oldData, 'failed rendering cannot publish the new unit snapshot');
  assert.equal(api.state().fleetUnitsHtml, oldHtml);
  assert.equal(api.state().fleetGood[1], 'prefix' + oldHtml + 'suffix');
  assert.equal(api.state().fleetCols[1], api.state().fleetGood[1], 'the visible retained band and saved band agree');
  click({ target: { closest: () => ({ dataset: {}, closest: () => row }) } });
  assert.equal(keys(api.state().fleetCols[1]).length, 21, 'the retained 21-unit snapshot still opens, not the newer three-unit snapshot');
  assert.equal(api.state().fleetCols[1], api.state().fleetGood[1]);
});

// Execute the real capture listener against a minimal DOM: a page rebuild destroys its section and its last Show more.
// The page's stable root remains. This covers the final tap, which cannot find a replacement control row.
for (const name of ['Shop', 'Fleet', 'Grouped listing']) test(name + ': final expansion focuses the first new row after its control disappears', () => {
  let capture, focused = null, current;
  const root = { id: 'page', querySelectorAll: () => current.rows, isConnected: true };
  const makeRow = key => ({ dataset: { key }, attributes: {}, matches: selector => name === 'Grouped listing' && key === 'b' && selector.split(',').includes('summary'),
    querySelector: () => null, setAttribute(k, v) { this.attributes[k] = v; }, focus(o) { focused = [key, o]; } });
  const old = { rows: [makeRow('a')], querySelectorAll() { return this.rows; }, isConnected: false };
  current = { rows: [makeRow('a'), makeRow('b'), makeRow('c')], querySelectorAll() { return this.rows; }, querySelector: () => current.rows[1], isConnected: true };
  const button = { dataset: { more: 'band' }, closest: sel => sel === '[id]' ? root : old, parentElement: old };
  const timers = [], frames = [];
  const document = { body: {}, activeElement: null, addEventListener: (_, fn) => { capture = fn; }, querySelectorAll: () => [], getElementById: () => root };
  root.querySelector = () => current.rows[1];
  const src = deck.slice(deck.indexOf("if(typeof document!=='undefined')document.addEventListener('click',e=>{const b=e.target&&e.target.closest&&e.target.closest('.more-row[data-more-row]"), deck.indexOf('// Today\'s flow opts in'));
  new Function('document', 'DeckCore', 'CSS', 'setTimeout', 'requestAnimationFrame', src)(document, DeckCore, { escape: x => x }, fn => timers.push(fn), fn => frames.push(fn));
  root.querySelectorAll = () => old.rows;
  capture({ target: { closest: () => button } });
  root.querySelectorAll = () => current.rows;
  while (timers.length) timers.shift()();
  assert.equal(focused, null, 'do not focus before the queued column balancer runs');
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(focused, null, 'the first frame lets the balancer finish reparenting sections');
  frames.shift()();
  assert.deepEqual(focused, ['b', { preventScroll: true }]);
  assert.equal(current.rows[1].attributes.tabindex, name === 'Grouped listing' ? undefined : '-1', 'a native summary keeps its normal Tab stop');
});
