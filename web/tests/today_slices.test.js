// Today reads slices, not whole feeds (round "Better", lane DoToday2, 2026-11-15; SeePerf P2 and P3). /api/today carries surf_best,
// shop_moves and home_area, cut on the server (rust/src/todayslices.rs) from the same answers /api/surf-coast, /api/ecom-market and
// /api/realestate serve. Each glance tile drawn from its slice must be the tile the full feed draws; an older server (no slice) and a slice
// that cannot draw its tile fall back to the full feed; a slice that says why it is missing prints the missing form with that reason. On the
// idle refresh, feeds nothing on Today warns about or acts on are read at their own pace; the rest every time.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const rs = fs.readFileSync(path.join(__dirname, '../rust/src/todayslices.rs'), 'utf8');
const block = (b, e) => deck.slice(deck.indexOf(b), deck.indexOf(e));
const helpers = block('// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====');
const registry = block('// ==== DECK PAGES REGISTRY BEGIN', '// ==== DECK PAGES REGISTRY END ====');
const D = new Function(helpers + '\nreturn DeckUI;')();
const surfFx = require('./surf_fixture.js');
const shopFx = require('./shop_fixture.cjs');
const visible = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// ---- the server's cuts, mirrored from rust/src/todayslices.rs (its key lists are read from the Rust source, so the two cannot drift) ----
const keys = (name) => { const m = new RegExp('const ' + name + ': \\[&str; \\d+\\] =\\s*\\[([^\\]]*)\\]').exec(rs); assert.ok(m, name + ' in todayslices.rs'); return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]); };
const SPOT = keys('SPOT_KEYS'), WATCH = keys('WATCH_KEYS'), KEEP = keys('KEEP_LISTS');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = (o, ks) => Object.fromEntries(ks.filter((k) => k in o).map((k) => [k, o[k]]));
const head = (o, skip) => Object.fromEntries(Object.entries(o).filter(([k, v]) => !skip.includes(k) && (!Array.isArray(v) || KEEP.includes(k))));
const wire = (v) => JSON.parse(JSON.stringify(v));
// complete: the shape agreed with BServerA for the #392 reader: `regions` {id, name, wave_ft} of the regions holding a pinned spot, then every
// other spot of those regions as {id, region, pinned: null, now: {confidence: {model_only}}} (model_only only when the feed has it)
function surfBest(o, complete) {
  if (!isObj(o)) return { status: 'not_reporting', reason: 'no surf overview' };
  const out = head(o, ['water']);
  if (!('spots' in o)) return wire(out);
  const pin = (Array.isArray(o.spots) ? o.spots : []).filter((s) => isObj(s) && s.pinned != null).map((s) => pick(s, SPOT));
  if (!complete) return wire(Object.assign(out, { spots: pin }));
  const regs = new Set(pin.map((s) => s.region));
  out.regions = (o.regions || []).filter((r) => isObj(r) && regs.has(r.id)).map((r) => pick(r, ['id', 'name', 'wave_ft']));
  const others = o.spots.filter((s) => isObj(s) && s.pinned == null && regs.has(s.region)).map((s) => {
    const c = isObj(s.now) && isObj(s.now.confidence) && 'model_only' in s.now.confidence ? { now: { confidence: { model_only: s.now.confidence.model_only } } } : {};
    return Object.assign({ id: s.id, region: s.region, pinned: null }, c);
  });
  out.spots = pin.concat(others);
  return wire(out);
}
function shopMoves(o) {
  if (!isObj(o)) return { status: 'not_reporting', reason: 'no shop market feed' };
  const out = head(o, ['watches']);
  if (isObj(o.watches)) out.watches = Object.assign(head(o.watches, ['items']), { items: (Array.isArray(o.watches.items) ? o.watches.items : []).filter(isObj).map((x) => pick(x, WATCH)) });
  return wire(out);
}
function homeArea(re) {
  const none = (why) => ({ zip: null, reason: why });
  if (typeof re.error === 'string') return none('the Real estate feed is not reporting: ' + re.error.slice(0, 80));
  if (re.status === 'not_reporting') return none('the Real estate feed is not reporting');
  const areas = ((((re.market || {}).residential || {}).areas) || []).filter(isObj);
  const a = areas.find((x) => x.tier === 'home') || areas[0];
  if (!a) return none('the Real estate feed names no home market');
  const zip = typeof a.zip === 'string' ? a.zip : typeof a.zip === 'number' ? String(a.zip) : '';
  if (!/^\d{5}$/.test(zip)) return none('the home market has no five-digit ZIP');
  return { zip, name: typeof a.name === 'string' ? a.name.slice(0, 40) : '' };
}

const T = surfFx.NOV;
const today = (o) => Object.assign({ t: T, gateway: { ok: true }, mail: { mailboxes: [] }, cron: { next: [], failing: [], briefings: [] } }, o);
const tileOf = (g, key) => g.tiles.find((t) => t.key === key) || null;
const glance = (o) => D.tdGlance(Object.assign({ now: T * 1000 }, o));
// the glance as the page draws it with the slice in /api/today (or the full feed when tdSlice sends it there)
const viaSlice = (t, k, full) => D.tdSlice(t, k) || full;

test('the mirror reads the server\'s key lists, and those hold every field the three tiles read', () => {
  for (const k of ['id', 'name', 'region', 'pinned', 'now']) assert.ok(SPOT.includes(k), 'spot ' + k);
  for (const k of ['label', 'median', 'change_7d', 'best', 'best_used']) assert.ok(WATCH.includes(k), 'watch ' + k);
  assert.deepEqual(KEEP.slice().sort(), ['errors', 'gaps', 'src']);
});

// Surf: each case drawn from the full feed and from the slice cut from it, short (the server before the regions change) and complete
function surfCases() {
  const base = surfFx.feed(), cases = { fixture: base };
  const set = (f, fn) => { const c = wire(f); c.spots.forEach(fn); return c; };
  for (const b of ['spot', 'sensor', 'region']) cases['basis ' + b] = set(base, (s) => { s.now.height_basis = b; });
  // the region case where the model mark differs between pinned spots alone and the whole region
  cases['region, pinned model only'] = set(base, (s) => { s.now.height_basis = 'region'; if (s.pinned != null) s.now.confidence = { model_only: true }; });
  cases['region missing from regions'] = (() => { const c = set(base, (s) => { s.now.height_basis = 'region'; }); c.regions = c.regions.filter((r) => r.id !== 'orange-county'); return c; })();
  cases['no pinned spot'] = set(base, (s) => { s.pinned = null; });
  cases['not reporting'] = { status: 'not_reporting', reason: 'surf is not reporting yet' };
  cases['error body'] = { error: 'file missing' };
  return cases;
}

test('Surf tile: the slice draws the tile the full feed draws, short slice or complete, in every height basis', () => {
  let used = 0;
  for (const [name, full] of Object.entries(surfCases())) {
    for (const complete of [false, true]) {
      const t = today({ surf_best: surfBest(full, complete) });
      const want = glance({ surf: full }), got = glance({ surf: viaSlice(t, 'surf', full) });
      assert.deepEqual(tileOf(got, 'surf'), tileOf(want, 'surf'), name + (complete ? ' (complete)' : ' (short)'));
      assert.deepEqual(got.miss.filter((m) => m.key === 'surf'), want.miss.filter((m) => m.key === 'surf'), name + ': the same missing form');
      if (complete && D.tdSlice(t, 'surf')) used++;
    }
  }
  assert.ok(used >= 6, 'a complete slice draws the tile itself: ' + used);
  // a complete slice is small: no hourly days, buoys, tides or water
  const full = surfFx.feed(), cut = surfBest(full, true);
  assert.ok(JSON.stringify(cut).length < JSON.stringify(full).length / 2, 'the slice is a fraction of the feed');
  for (const gone of ['buoys', 'tides', 'water']) assert.equal(cut[gone], undefined, gone);
});

test('Surf tile: a slice whose spots cannot draw the tile sends the page to the full feed; one that can is used', () => {
  const f = wire(surfFx.feed());
  f.spots.forEach((s) => { s.now.height_basis = 'spot'; });
  assert.ok(D.tdSlice(today({ surf_best: surfBest(f, false) }), 'surf'), 'pinned spots with their own height: the slice draws the tile');
  // a home spot with a height that draws nothing from the slice is read whole (a region height the slice does not carry)
  const bare = { t: T, spots: [{ id: 'x', name: 'X', region: 'r', pinned: 1, now: { wave_ft: [3, 4], height_basis: 'region' } }] };
  const draws = !!D.tdGlance({ surf: bare, now: T * 1000 }).tiles.find((t) => t.key === 'surf');
  assert.equal(!!D.tdSlice(today({ surf_best: bare }), 'surf'), draws, 'used exactly when its own tile draws');
  // no home spot at all: the full feed would draw nothing either, so the slice stands
  assert.ok(D.tdSlice(today({ surf_best: { t: T, spots: [] } }), 'surf'));
});

// Shop: the fixture is a staged ecom-market run; variants cover every branch of the tile
function shopCases() {
  const m = shopFx().market, cases = { fixture: m };
  m.watches.items.forEach((x) => { x.best_used = null; });
  const v = (fn) => { const c = wire(m); fn(c); return c; };
  cases['no drops'] = v((c) => c.watches.items.forEach((x) => { x.change_7d = 1; }));
  cases['best used only'] = v((c) => c.watches.items.forEach((x) => { x.best = null; x.best_used = { price: 80, condition: 'refurbished' }; }));
  cases['no listing'] = v((c) => c.watches.items.forEach((x) => { x.best = null; x.best_used = null; }));
  cases['no median'] = v((c) => c.watches.items.forEach((x) => { x.best = null; x.best_used = null; x.median = null; }));
  cases['no watches'] = v((c) => { delete c.watches; });
  cases['empty watches'] = v((c) => { c.watches.items = []; });
  cases['not reporting'] = { status: 'not_reporting', reason: 'the market feed is not reporting' };
  cases['error body'] = { error: 'feed missing' };
  return cases;
}

test('Shop tile: the slice draws the tile the full feed draws, and is a fraction of it', () => {
  for (const [name, full] of Object.entries(shopCases())) {
    const t = today({ shop_moves: shopMoves(full) });
    const cut = D.tdSlice(t, 'ecom');
    if (name !== 'no watches') assert.ok(cut, name + ': a complete slice is used');
    const want = glance({ ecom: full }), got = glance({ ecom: cut || full });
    assert.deepEqual(tileOf(got, 'shop'), tileOf(want, 'shop'), name);
    assert.deepEqual(got.miss.filter((m) => m.key === 'shop'), want.miss.filter((m) => m.key === 'shop'), name + ': the same missing form');
  }
  const m = shopFx().market;
  assert.ok(JSON.stringify(shopMoves(m)).length < JSON.stringify(m).length / 2);
});

// Real estate: the page's own fallback (tdHomeArea, run in a sandbox on the full feed) against home_area
function oldHome(re) {
  const src = deck.slice(deck.indexOf('function tdHomeArea(){'), deck.indexOf('// tick: the idle refresh'));
  const ctx = { JSON, Date, String, Array, Promise, localStorage: { getItem: () => null, setItem() {} }, tdGet: () => Promise.resolve(re) };
  vm.createContext(ctx);
  return vm.runInContext(src + ';tdHomeArea()', ctx);
}
test('Real estate tile: home_area names the market the full feed names; no market prints the missing form with the server\'s reason', async () => {
  const summary = { t: T, mortgage: { rate_30y: 6.31 } };
  const zip = { zip: '92629', city: 'Dana Point', value_trend_1y: 2.1, x: { m: { value_trend_1y: { v: 2.1, c: 0.7 } } } };
  const areas = (a) => ({ t: T, market: { residential: { areas: a } }, homes: [] });
  const cases = {
    home: areas([{ zip: '92672', name: 'San Clemente' }, { zip: '92629', name: 'Dana Point', tier: 'home' }]),
    first: areas([{ zip: 92629, name: 'Dana Point' }]),
    'long name': areas([{ zip: '92629', name: 'A place name that runs on well past forty characters', tier: 'home' }]),
    'bad zip': areas([{ zip: '9262', tier: 'home' }]),
    none: areas([]),
    'error body': { error: 'file missing' },
  };
  for (const [name, re] of Object.entries(cases)) {
    const o = await oldHome(re), n = D.tdHomeOf(today({ home_area: homeArea(re) }));
    assert.ok(n, name + ': a sent home_area is always used');
    if (o) {
      assert.deepEqual([n.zip, n.name], [o.zip, o.name], name);
      assert.deepEqual(tileOf(glance({ summary, zip, place: n.name }), 'housing'), tileOf(glance({ summary, zip, place: o.name }), 'housing'), name);
    } else {
      assert.ok(n.error, name + ': no market');
      // the tile falls back to the 30-year rate exactly as before
      assert.deepEqual(tileOf(glance({ summary, zip: { error: n.error } }), 'housing'), tileOf(glance({ summary, zip: { error: 'no home market in the realestate feed' } }), 'housing'), name);
    }
  }
  // with neither the ZIP nor the summary, the missing row carries the server's reason in its detail
  const why = D.tdHomeOf(today({ home_area: { zip: null, reason: 'the Real estate feed names no home market' } }));
  const miss = glance({ summary: { error: 'x' }, zip: why }).miss.find((m) => m.key === 'housing');
  assert.ok(miss);
});

test('an older server, or a slice that is not an object, sends the page to the full feeds', () => {
  for (const t of [today(), { error: 'no answer' }, today({ surf_best: 'x', shop_moves: [1], home_area: 5 }), today({ home_area: { name: 'no zip key' } }), null]) {
    assert.equal(D.tdSlice(t, 'surf'), null);
    assert.equal(D.tdSlice(t, 'ecom'), null);
    assert.equal(D.tdHomeOf(t), null);
  }
  assert.equal(D.tdSlice(today({ surf_best: {} }), 'other'), null, 'only the two tiles have slices');
});

test('shapes: Today\'s answer must carry its three blocks; the full feeds keep their lists typed; an error body passes', () => {
  const S = D.TD_SHAPE;
  assert.equal(S.today(today()), true);
  for (const bad of [{ gateway: 'x', mail: {}, cron: {} }, { t: 1 }, { gateway: {}, mail: {}, cron: 5 }]) assert.equal(S.today(bad), false, JSON.stringify(bad));
  assert.equal(S['surf-coast']({ spots: [] }), true);
  assert.equal(S['surf-coast']({ spots: 7 }), false);
  assert.equal(S['ecom-market']({ watches: 'x' }), false);
  assert.equal(S['ecom-market']({ error: 'down' }), true);
});

test('P3: the idle refresh reads a slow feed at its own pace; never what an alert or a control reads; opening the page reads all', () => {
  const E = D.TD_EVERY, now = 1e9;
  for (const k of ['products', 'testflight', 'schedules', 'today', 'replyblock', 'health', 'cams', 'car', 'ha', 'cluster', 'deadlines', 'calendar'])
    assert.equal(E[k], undefined, k + ' is read every time');
  for (const k of Object.keys(E)) assert.ok(E[k] >= 30 && E[k] <= 3600, k);
  const last = { path: 'markets', at: now - 10000, ok: true };
  assert.equal(D.tdDue('markets', 'markets', last, now, true), false, 'within its period: kept');
  assert.equal(D.tdDue('markets', 'markets', last, now + E.markets * 1000, true), true, 'past it: read');
  assert.equal(D.tdDue('markets', 'markets', last, now, false), true, 'opening the page or Try again: read');
  assert.equal(D.tdDue('markets', 'markets', Object.assign({}, last, { ok: false }), now, true), true, 'a failed or out-of-date read is tried again');
  assert.equal(D.tdDue('zip', 'housing/zip/92648', { path: 'housing/zip/92629', at: now, ok: true }, now, true), true, 'a new home ZIP is read at once');
  assert.equal(D.tdDue('products', 'products', { path: 'products', at: now, ok: true }, now, true), true);
  assert.equal(D.tdDue('markets', 'markets', null, now, true), true);
});

// ---- the page glue in a sandbox: the real registry, Today's reads, every answer at once ----
function sandbox(answers) {
  let now = T * 1000;
  const FakeDate = class extends Date { static now() { return now; } };
  // A successful empty feed still carries its real containers. Bare {t} is malformed, not an empty reading.
  const empty = {
    products: { products: [], needs: [] }, testflight: { apps: [] }, schedules: { groups: [] },
    replyblock: { counts: {}, items: [] }, deadlines: { renewals: [], paperwork: [] }, calendar: { days: [] },
    cams: { cams: [] }, car: { battery: null, locked: null }, ha: { entities: {} }, cluster: { engine: {}, nodes: [] },
    markets: { board: [] }, watch: { connected: false }, weather: { text: 'Weather unavailable' }, hockey: { teams: [] },
    traffic: { status: 'ok', daily: {} }, onthisday: { total: 0, years: [] }, 'housing/national': { mortgage: {} },
    accounts: { apple: { events_today: [], bills_due: [] } }
  };
  const urls = [], paints = {};
  const listeners = {};
  const ctx = {
    console, Promise, Math, JSON, String, Array, Object, Number, URLSearchParams, encodeURIComponent, decodeURIComponent, AbortController, Date: FakeDate,
    setTimeout: () => 1, clearTimeout() {},
    fetch: (url) => { const p = String(url).replace(/^\/api\//, ''); urls.push(p); const k = p.replace(/\?.*$/, '');
      const a = k in answers ? answers[k] : Object.assign({ t: T }, empty[k] || (k.startsWith('housing/zip/') ? { zip: k.split('/').pop() } : {}));
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(a) }); },
    localStorage: { getItem: () => null, setItem() {} },
    document: { hidden: false, addEventListener: (k, fn) => { (listeners[k] ||= []).push(fn); },
      dispatchEvent: (e) => { (listeners[e.type] || []).forEach((fn) => fn(e)); },
      documentElement: { dataset: { dc: 'P' }, classList: { contains: () => false } } },
    innerWidth: 430, innerHeight: 932,
  };
  vm.createContext(ctx);
  vm.runInContext(helpers + '\n' + registry + '\nthis.DeckUI=DeckUI;this.DeckPages=DeckPages;', ctx);
  const glue = deck.slice(deck.indexOf('const TDS='), deck.indexOf('const TD_BOARD=')) +
    deck.slice(deck.indexOf('// The Surf and Shop tiles read'), deck.indexOf('// the Almanac\'s day sits behind')) +
    deck.slice(deck.indexOf('function tdHomeArea(){'), deck.indexOf('// a tile or row opens its tab'));
  Object.assign(ctx, { once: (n, fn) => fn(), $: () => ({}), tdArrange() {}, tdAllMiss: () => [], tdPaint: (k, fn) => { paints[k] = fn(); } });
  vm.runInContext(glue + '\nthis.v7Today=v7Today;this.TDS=TDS;', ctx);
  return { ctx, urls, paints, at: (ms) => { now = ms; }, now: () => now };
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };
const fullAnswers = () => {
  const surf = wire(surfFx.feed()); surf.spots.forEach((s) => { s.now.height_basis = 'spot'; });
  const shop = shopFx().market; shop.watches.items.forEach((x) => { x.best_used = null; });
  return { surf, shop, re: { t: T, market: { residential: { areas: [{ zip: '92629', name: 'Dana Point', tier: 'home' }] } } } };
};

test('glue: with the slices the page never reads surf-coast, ecom-market or realestate, and the glance equals the one drawn from the full feeds', async () => {
  const f = fullAnswers();
  const answers = { 'surf-coast': f.surf, 'ecom-market': f.shop, realestate: f.re, 'housing/zip/92629': { t: T, zip: '92629', city: 'Dana Point', value_trend_1y: 2 } };
  const withSlices = sandbox(Object.assign({ today: today({ surf_best: surfBest(f.surf, true), shop_moves: shopMoves(f.shop), home_area: homeArea(f.re) }) }, answers));
  await withSlices.ctx.v7Today(); await settle();
  for (const p of ['surf-coast', 'ecom-market', 'realestate']) assert.ok(!withSlices.urls.includes(p), p + ' is not read');
  assert.ok(withSlices.urls.includes('housing/zip/92629'));
  // an older server: no slice, so the full feeds are read, and the glance reads the same
  const old = sandbox(Object.assign({ today: today() }, answers));
  await old.ctx.v7Today(); await settle();
  for (const p of ['surf-coast', 'ecom-market', 'realestate']) assert.ok(old.urls.includes(p), p + ' is read');
  assert.equal(withSlices.paints.glance.html, old.paints.glance.html, 'the same markup');
  assert.ok(/Surf/.test(visible(old.paints.glance.html)) && /Shop/.test(visible(old.paints.glance.html)) && /Real estate/.test(visible(old.paints.glance.html)));
  assert.deepEqual(wire(withSlices.paints.glance.miss), wire(old.paints.glance.miss));
  assert.deepEqual(wire(withSlices.ctx.DeckUI.tdData(withSlices.ctx.TDS.feeds, T * 1000).sources), wire(old.ctx.DeckUI.tdData(old.ctx.TDS.feeds, T * 1000).sources));
});

test('glue: every Today read passes a shape; the idle refresh skips a slow feed inside its period and reads the rest', async () => {
  const f = fullAnswers();
  const s = sandbox({ today: today({ surf_best: surfBest(f.surf, true), shop_moves: shopMoves(f.shop), home_area: homeArea(f.re) }) });
  const seen = {};
  const get = s.ctx.DeckPages.get;
  s.ctx.DeckPages.get = (p, o) => { seen[p] = o; return get(p, o); };
  await s.ctx.v7Today(); await settle();
  assert.equal(typeof seen.today.shape, 'function', 'the answer that carries the slices is shape-checked');
  const first = s.urls.length;
  s.at(s.now() + 40000); s.urls.length = 0;
  await s.ctx.v7Today(true); await settle();
  const again = new Set(s.urls);
  for (const p of ['products', 'testflight', 'schedules', 'today', 'replyblock', 'health', 'cams', 'car', 'ha', 'cluster', 'deadlines', 'calendar']) assert.ok(again.has(p), p + ' read on every refresh');
  for (const p of ['markets', 'watch', 'weather', 'hockey', 'traffic', 'onthisday', 'housing/national?part=summary', 'housing/zip/92629']) assert.ok(!again.has(p), p + ' kept inside its period');
  assert.ok(s.urls.length < first);
  // past the markets period, markets is read again; opening the page reads every feed
  s.at(s.now() + 80000); s.urls.length = 0; await s.ctx.v7Today(true); await settle();
  assert.ok(s.urls.includes('markets'));
  s.urls.length = 0; await s.ctx.v7Today(); await settle();
  assert.equal(s.urls.length, first);
});

test('glue: the registration hands the idle tick to the page; the bounded get stays the one road for sheets', () => {
  assert.match(deck, /^DeckPages\.register\('today',\{show:ctx=>\{TDS\.ctx=ctx;v7Today\(\)\},refresh:\(ctx,tick\)=>\{TDS\.ctx=ctx;if\(!tick\|\|pageAge\('today'\)>30000\)v7Today\(!!tick\)\}/m);
  const feeds = deck.slice(deck.indexOf('const TD_FEEDS='), deck.indexOf('};', deck.indexOf('const TD_FEEDS=')));
  assert.doesNotMatch(feeds, /surf-coast|ecom-market|realestate'/, 'the whole feeds are not read with the page');
});

test('malformed slices fall back to complete feeds, repeatedly, without losing or weakening a tile', async (t) => {
  const f = fullAnswers();
  f.shop.watches.items[0].best = null;
  f.shop.watches.items[0].best_used = { price: 70, condition: 'used' };
  const valid = { surf_best: surfBest(f.surf, true), shop_moves: shopMoves(f.shop), home_area: homeArea(f.re) };
  const damaged = [
    { surf_best: {} }, { surf_best: { spots: 'wrong' } },
    ...['rating', 'word', 'height_basis', 'confidence'].map((key) => {
      const surf_best = wire(valid.surf_best); surf_best.spots.filter((s) => s.pinned != null).forEach((s) => { delete s.now[key]; }); return { surf_best };
    }),
    (() => { const surf_best = wire(valid.surf_best); surf_best.spots.filter((s) => s.pinned != null).forEach((s) => { delete s.now.confidence.model_only; }); return { surf_best }; })(),
    { surf_best: { spots: [{ pinned: 1, name: 'Home', region: 'r' }] } },
    { surf_best: { spots: [{ pinned: 1, name: 'Home', region: 'r', now: { wave_ft: '3-4' } }] } },
    { shop_moves: {} }, { shop_moves: { watches: { items: 'wrong' } } },
    ...['change_7d', 'best', 'best_used', 'median'].map((key) => {
      const shop_moves = wire(valid.shop_moves); delete shop_moves.watches.items[0][key]; return { shop_moves };
    }),
    (() => { const shop_moves = wire(valid.shop_moves); delete shop_moves.watches.items[0].best_used.condition; return { shop_moves }; })(),
    { shop_moves: { watches: { items: [{ label: 'Watch', median: 10, change_7d: {}, best: null, best_used: null }] } } },
    { home_area: { zip: {} } }, { home_area: { zip: 'bad', name: 'Home' } },
    { home_area: { zip: '92629', name: {} } }, { home_area: { zip: null } },
  ];
  const feeds = { 'surf-coast': f.surf, 'ecom-market': f.shop, realestate: f.re,
    'housing/zip/92629': { t: T, zip: '92629', value_trend_1y: 2 } };
  const base = sandbox(Object.assign({ today: today(valid) }, feeds));
  await base.ctx.v7Today(); await settle();
  for (const bad of damaged) await t.test(JSON.stringify(bad), async () => {
    const answers = Object.assign({ today: today(Object.assign({}, valid, bad)) }, feeds), s = sandbox(answers);
    for (let i = 0; i < 2; i++) {
      await s.ctx.v7Today(); await settle();
      assert.equal(s.paints.glance.html, base.paints.glance.html, JSON.stringify(bad));
      assert.ok(s.urls.includes('surf_best' in bad ? 'surf-coast' : 'shop_moves' in bad ? 'ecom-market' : 'realestate'));
    }
  });
});

test('empty lists and explicit unavailable home markets are valid, not malformed slices', () => {
  assert.ok(D.tdSlice(today({ surf_best: { spots: [] } }), 'surf'));
  assert.ok(D.tdSlice(today({ shop_moves: { watches: { items: [] } } }), 'ecom'));
  assert.match(D.tdHomeOf(today({ home_area: { zip: null, reason: 'No home market selected' } })).error, /No home market/);
});

test('registered Today keeps each failed slice stale while fresh alerts update, then recovers and forgets on role change', async () => {
  const f = fullAnswers(), valid = { surf_best: surfBest(f.surf, true), shop_moves: shopMoves(f.shop), home_area: homeArea(f.re) };
  const answers = { today: today(valid), 'housing/zip/92629': { t: T, zip: '92629', value_trend_1y: 2 } };
  const s = sandbox(answers), html = [];
  const pact = { querySelector: () => null, insertAdjacentHTML: (where, h) => html.push(h) };
  const header = { querySelector: () => pact };
  s.ctx.DeckPages.register('today', { show: () => s.ctx.v7Today(), refresh: () => s.ctx.v7Today() });
  // Use the real registered route so registry freshness notes belong to Today.
  s.ctx.DeckPages.dispatch('today', false); await settle();
  s.ctx.TDS.ctx = { route: 'today', head: header };
  const good = wire(s.paints.glance.tiles);
  for (const [failure, home] of [[{ error: 'feed failed' }, homeArea({ error: 'feed failed' })],
    [{ status: 'not_reporting', reason: 'not written' }, homeArea({ status: 'not_reporting' })]]) {
    s.at(s.now() + 120000); html.length = 0;
    answers.today = today({ surf_best: failure, shop_moves: failure, home_area: home, gateway: { ok: false } });
    await s.ctx.v7Today(); await settle();
    assert.deepEqual(wire(s.paints.glance.tiles), good, 'all three previous tiles stay');
    assert.equal(s.ctx.TDS.feeds.today.gateway.ok, false, 'fresh Hermes state is not rolled back');
    assert.match(visible(s.paints.alerts.html), /Hermes/, 'new alert is painted');
    assert.match(visible(html.join('')), /Out of date · last read [24] min/, 'the original read time is not advanced');
  }
  // Malformed slice AND broken fallback must keep the same last tile.
  answers.today = today({ surf_best: {}, shop_moves: {}, home_area: { zip: 'bad' } });
  answers['surf-coast'] = { error: 'down' }; answers['ecom-market'] = { watches: { items: 'wrong' } }; answers.realestate = { error: 'down' };
  await s.ctx.v7Today(); await settle();
  assert.deepEqual(wire(s.paints.glance.tiles), good);
  answers.today = today(valid); html.length = 0;
  await s.ctx.v7Today(); await settle();
  assert.deepEqual(wire(s.paints.glance.tiles), good);
  assert.doesNotMatch(visible(html.join('')), /Out of date/);
  s.ctx.document.dispatchEvent({ type: 'deck:role' });
  answers.today = today({ surf_best: { error: 'down' }, shop_moves: { error: 'down' }, home_area: { error: 'down' } });
  await s.ctx.v7Today(); await settle();
  assert.equal(s.paints.glance.tiles.length, 0, 'retained slice data shares registry clearing');
});

test('Shop never calls an unknown seven-day change no drops', () => {
  const f = fullAnswers().shop;
  f.watches.items.forEach((x) => { x.change_7d = null; });
  assert.equal(tileOf(glance({ ecom: f }), 'shop').t, '7-day changes not reported');
  f.watches.items[0].change_7d = 2;
  assert.equal(tileOf(glance({ ecom: f }), 'shop').t, 'No reported drops this week');
});

test('slice recovery clears failed fallback marks and a whole Today failure does not advance the saved read', async () => {
  const f = fullAnswers(), valid = { surf_best: surfBest(f.surf, true), shop_moves: shopMoves(f.shop), home_area: homeArea(f.re) };
  const answers = { today: today(), 'surf-coast': f.surf, 'ecom-market': f.shop, realestate: f.re,
    'housing/zip/92629': { t: T, zip: '92629', value_trend_1y: 2 } };
  const s = sandbox(answers), html = [], pact = { querySelector: () => null, insertAdjacentHTML: (p, h) => html.push(h) };
  s.ctx.DeckPages.register('today', { show: () => s.ctx.v7Today() });
  s.ctx.DeckPages.dispatch('today', false); await settle();
  s.ctx.TDS.ctx = { route: 'today', head: { querySelector: () => pact } };
  const good = wire(s.paints.glance.tiles);
  s.at(s.now() + 120000);
  answers['surf-coast'] = { error: 'down' }; answers['ecom-market'] = { error: 'down' };
  await s.ctx.v7Today(); await settle();
  assert.deepEqual(wire(s.paints.glance.tiles), good);
  assert.match(visible(html.join('')), /Out of date/);
  answers.today = today(valid); html.length = 0;
  await s.ctx.v7Today(); await settle();
  assert.doesNotMatch(visible(html.join('')), /Out of date/);
  s.at(s.now() + 180000); answers.today = { error: 'outer failed' }; html.length = 0;
  await s.ctx.v7Today(); await settle();
  assert.deepEqual(wire(s.paints.glance.tiles), good);
  assert.match(visible(html.join('')), /Out of date · last read 3 min/);
});

test('idle full-feed reuse preserves the actual last-read time until a due refresh fails', async () => {
  const f = fullAnswers(), answers = { today: today(), 'surf-coast': f.surf, 'ecom-market': f.shop, realestate: f.re };
  const s = sandbox(answers), html = [], pact = { querySelector: () => null, insertAdjacentHTML: (p, h) => html.push(h) };
  s.ctx.DeckPages.register('today', { show: () => s.ctx.v7Today() });
  s.ctx.DeckPages.dispatch('today', false); await settle();
  s.ctx.TDS.ctx = { route: 'today', head: { querySelector: () => pact } };
  const original = s.now(), surf = tileOf(s.paints.glance, 'surf');
  for (let i = 1; i <= 3; i++) {
    s.at(original + i * 120000); s.urls.length = 0;
    await s.ctx.v7Today(true); await settle();
    assert.ok(!s.urls.includes('surf-coast'), 'no full read during its hold');
  }
  s.at(original + 480000); answers['surf-coast'] = { error: 'down' }; html.length = 0;
  await s.ctx.v7Today(true); await settle();
  assert.ok(s.urls.includes('surf-coast'), 'the due read was attempted');
  assert.deepEqual(tileOf(s.paints.glance, 'surf'), surf);
  assert.match(visible(html.join('')), /Out of date · last read 8 min/, 'not two minutes since the last idle reuse');
});
