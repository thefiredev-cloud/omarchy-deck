'use strict';
// E11/E12: real registry, page models and read glue with scripted fetch; no browser or live routes.
require('./setup-core.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const deck = read('deck.js');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const helpers = cut(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====');
const registry = cut(deck, '// ==== DECK PAGES REGISTRY BEGIN', '// ==== DECK PAGES REGISTRY END ====');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const WRONG = { t: 'soon', generated_at: 'x', spots: 7, rows: 'x', homes: {}, items: 5, apps: 'x', regions: 3, groups: true, tiles: 1 };
// Model only the header node operations the real registry uses.
function box() {
  const b = { nodes: [], addEventListener() {},
    get innerHTML() { return this.nodes.map(n => n.html).join(''); },
    set innerHTML(h) { this.nodes = h ? [node(h)] : []; },
    querySelector(sel) { return this.nodes.find(n => n.classes().includes(sel.slice(1))) || null; },
    insertAdjacentHTML(where, h) { assert.equal(where, 'afterbegin'); this.nodes.unshift(node(h)); }
  };
  function node(h) { const n = { html: h, classes: () => ((/class="([^"]*)"/.exec(n.html) || [])[1] || '').split(' '),
    set outerHTML(v) { n.html = v; }, remove() { b.nodes.splice(b.nodes.indexOf(n), 1); },
    insertAdjacentHTML(where, v) { assert.equal(where, 'afterend'); b.nodes.splice(b.nodes.indexOf(n) + 1, 0, node(v)); }
  }; return n; }
  return b;
}
function boot(answers) {
  const pact = box(), page = box(), scope = box(), events = {};
  const head = { addEventListener() {}, querySelector: s => s === '.pact' ? pact : s === '.pscope' ? scope : null };
  let mode = 'ok', now = 1800000000000;
  const FakeDate = class extends Date { static now() { return now; } };
  const document = { hidden: false, documentElement: { dataset: { dc: 'P' }, classList: { contains: () => false } },
    getElementById: id => /^pg-[a-z]+$/.test(id) ? { querySelector: () => head } : page,
    addEventListener: (name, fn) => { (events[name] ||= []).push(fn); }, dispatchEvent() {} };
  const ctx = { console, document, Promise, Date: FakeDate, Math, JSON, URLSearchParams, AbortController,
    setTimeout: () => 1, clearTimeout() {}, localStorage: { getItem: () => null, setItem() {} },
    fetch: async url => {
      if (mode === 'offline') throw new TypeError('Failed to fetch');
      const data = mode === 'wrongtype' ? WRONG : answers[String(url).replace(/^\/api\//, '')];
      const status = mode === 'notmodified' ? 304 : mode === 'http500' ? 500 : 200;
      return { ok: status === 200, status,
        headers: { get: h => h === 'etag' ? '"kept-state-test"' : h === 'content-length' ? String(JSON.stringify(data).length) : null }, json: async () => data };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(helpers + '\n' + registry + '\nthis.DeckUI=DeckUI;this.DeckPages=DeckPages;', ctx);
  return { ctx, pact, page, events, fail(m) { mode = m; now += 60000; }, recover() { mode = 'ok'; } };
}
for (const mode of ['offline', 'http500', 'wrongtype']) test('E11: Shop keeps rows and its stale mark after ' + mode + ' and a repaint', async () => {
  const f = require('./shop_fixture.cjs')();
  const b = boot({ 'ecom-market': f.market, ecom: f.ecom, listings: f.listings, amazon: { t: f.market.t, watch: [], deals: [] }, trends: require('./trends_fixture.cjs').trends() });
  vm.runInContext(read('pages/shop.js'), b.ctx);
  b.ctx.DeckPages.dispatch('shop/market', false); await settle();
  const before = b.page.innerHTML;
  assert.match(before, /Trending/);
  assert.match(b.pact.innerHTML, /class="fresh/);
  b.fail(mode);
  b.ctx.DeckPages.dispatch('shop/market', false); await settle();
  assert.equal(b.page.innerHTML, before, 'all Shop rows stay');
  assert.match(b.pact.innerHTML, /class="fresh warn" data-kept/, 'a retained mark exposes its state to the header');
  assert.match(text(b.pact.innerHTML), /Out of date · last read 1 min Try again/);
  for (const fn of b.events['deck:class'] || []) fn({ detail: { cls: 'D' } });
  assert.match(text(b.pact.innerHTML), /Out of date · last read 1 min Try again/, 'repainting keeps the mark');
  assert.equal((b.pact.innerHTML.match(/Try again/g) || []).length, 1);
  b.recover(); b.ctx.DeckPages.dispatch('shop/market', false); await settle();
  assert.doesNotMatch(b.pact.innerHTML, /last read|Try again/);
});

test('E12: Today refuses a wrong-shaped 200 and keeps the previous good answer marked', async () => {
  const products = { t: 1799999940, refresh: 900, products: [], needs: [{ owner: 'owner', sev: 'high', text: 'Read the review', why: 'A reply is needed' }] };
  const b = boot({ products });
  const glue = cut(deck, 'const TDS=', '// the Almanac\'s day sits');
  vm.runInContext(glue + '\nthis.tdGet=tdGet;', b.ctx);
  b.ctx.DeckPages.register('today', { show() {} });
  b.ctx.DeckPages.dispatch('today', false);
  const good = await b.ctx.tdGet('products');
  assert.deepEqual(good, products);
  const before = b.ctx.DeckUI.tdNeedsHtml(b.ctx.DeckUI.tdNeeds({ products: good }));
  b.fail('wrongtype');
  const kept = await b.ctx.tdGet('products');
  assert.deepEqual(kept, products, 'the wrong-shaped body must not replace the good read');
  const after = b.ctx.DeckUI.tdNeedsHtml(b.ctx.DeckUI.tdNeeds({ products: kept }));
  assert.equal(after, before);
  assert.match(text(after), /Read the review/);
  b.ctx.DeckPages.mark(b.ctx.DeckPages.ctx(b.ctx.DeckPages.parse('today')), b.ctx.DeckUI.tdFresh({ products: kept }, [], 1800000060000));
  assert.match(text(b.pact.innerHTML), /Out of date · last read 1 min Try again/);
  b.recover();
  await b.ctx.tdGet('products');
  assert.doesNotMatch(b.pact.innerHTML, /last read|Try again/);
});

test('Today read shapes accept empty valid feeds but reject missing and mistyped containers', async () => {
  const answers = {
    products: { products: [], needs: [] }, testflight: { apps: [] }, schedules: { groups: [] },
    today: { gateway: { ok: true }, mail: { mailboxes: [] }, cron: { next: [], failing: [], briefings: [] }, markets: { items: [] } }, replyblock: { counts: {}, items: [] },
    deadlines: { renewals: [], paperwork: [] }, calendar: { days: [] }, cams: { cams: [] }, car: { battery: null, locked: null },
    ha: { entities: {} }, watch: { connected: false }, cluster: { engine: {}, nodes: [] }, markets: { board: [] },
    'surf-coast': { spots: [], regions: [] }, 'housing/national?part=summary': { mortgage: {} },
    'ecom-market': { watches: { items: [] } }, hockey: { teams: [] }, onthisday: { years: [], total: 0 },
    accounts: { apple: { events_today: [], bills_due: [] } },
    traffic: { status: 'ok', daily: {} }, health: { count: 0, names: [] }, weather: { text: 'Weather unavailable' },
    realestate: { market: { residential: { areas: [] } } }, 'housing/zip/92647': { zip: '92647' }, photoyears: { years: [] }
  };
  const b = boot(answers);
  vm.runInContext(cut(deck, 'const TDS=', '// the Almanac\'s day sits') + '\nthis.tdGet=tdGet;', b.ctx);
  assert.deepEqual(Object.values(vm.runInContext('TD_FEEDS', b.ctx)).filter(p => !(p in answers)), [], 'every load path covered');
  for (const [, p] of deck.matchAll(/tdGet\('([^']+)'\)/g)) assert.ok(p in answers, p + ': fallback or sheet read covered');
  for (const p of Object.keys(answers)) {
    assert.deepEqual(await b.ctx.tdGet(p), answers[p], p + ': valid empty or unavailable reading');
  }
  b.fail('wrongtype');
  for (const p of Object.keys(answers)) assert.deepEqual(await b.ctx.tdGet(p), answers[p], p + ': wrong-shaped body is not a good answer');
  const malformed = boot(Object.fromEntries(Object.keys(answers).map(p => [p, { ...WRONG, t: 1800000000 }])));
  vm.runInContext(cut(deck, 'const TDS=', '// the Almanac\'s day sits') + '\nthis.tdGet=tdGet;', malformed.ctx);
  for (const p of Object.keys(answers)) assert.equal((await malformed.ctx.tdGet(p)).error, 'wrong shape', p + ': a valid timestamp does not excuse broken containers');
  for (const bad of [{}, { t: 1, products: {}, needs: [] }, { t: 1, products: [], needs: 3 }, { t: 1, products: [], needs: [], errors: {} }]) {
    const first = boot({ products: bad });
    vm.runInContext(cut(deck, 'const TDS=', '// the Almanac\'s day sits') + '\nthis.tdGet=tdGet;', first.ctx);
    assert.equal((await first.ctx.tdGet('products')).error, 'wrong shape', JSON.stringify(bad));
  }
});

test('Shop keeps retained stale words as real text and its header visible while reading rows', () => {
  const css = read('css/shop.css');
  assert.match(css, /#pg-shop \.phead:has\(\.fresh\[data-kept\]\)[^{]*\{[^}]*position:sticky/);
  assert.match(css, /\.fresh\.warn\[data-kept\]>\.fw\{display:inline\}/);
  assert.match(css, /\.fresh\.warn\[data-kept\]::after\{content:none\}/);
});

test('E12 nested: individually broken jobs, mailboxes, cron lists and calendar events preserve rendered answers until recovery', async () => {
  const good = {
    products: { t: 1799999940, products: [], needs: [] },
    schedules: { t: 1799999940, groups: [{ jobs: [{ name: 'Waiting task', result: 'waiting', owner_wait: { reason: 'Keep this decision' } }, { name: 'Failed task', result: 'failed' }] }] },
    today: { t: 1799999940, gateway: { ok: true }, mail: { mailboxes: [{ role: 'personal', ok: false }] },
      cron: { next: [{ name: 'Next task', at: 1900000000 }], failing: ['Keep this automation'], briefings: [{ name: 'Keep this briefing', at: 1900000000 }] } },
    calendar: { t: 1799999940, days: [{ date: '2099-01-01', events: [{ title: 'Keep this event', all_day: true }] }], bills_due: [] }
  };
  const clone = x => JSON.parse(JSON.stringify(x));
  const cases = [
    ['schedules', d => { d.groups[0].jobs = 'broken'; }],
    ['today', d => { d.mail.mailboxes = 'broken'; }],
    ['today', d => { d.cron.next = 'broken'; }],
    ['today', d => { d.cron.failing = 'broken'; }],
    ['today', d => { d.cron.briefings = 'broken'; }],
    ['calendar', d => { d.days[0].events = {}; }],
    ['calendar', d => { d.bills_due = 'broken'; }]
  ];
  for (const [p, corrupt] of cases) {
    const answers = clone(good), b = boot(answers), feeds = {};
    vm.runInContext(cut(deck, 'const TDS=', '// the Almanac\'s day sits') + '\nthis.tdGet=tdGet;', b.ctx);
    b.ctx.DeckPages.register('today', { show() {} }); b.ctx.DeckPages.dispatch('today', false);
    for (const k of Object.keys(good)) feeds[k] = await b.ctx.tdGet(k);
    const render = () => {
      const D = b.ctx.DeckUI, n = D.tdNeeds(feeds);
      return D.tdNeedsHtml(n) + D.tdAlertsHtml(n, feeds.today, { count: 0, names: [] }, []).html +
        D.tdCal(feeds.calendar, null, 1800000000000, { briefing: feeds.today.cron.briefings }).html + D.tdStatusSheet(feeds.today, { count: 0, names: [] }, 1800000000000);
    };
    const before = render();
    assert.match(text(before), /Keep this decision/); assert.match(text(before), /Keep this event/);
    const broken = clone(good[p]); corrupt(broken); answers[p] = broken;
    feeds[p] = await b.ctx.tdGet(p);
    assert.equal(render(), before, p + ': malformed nested field cannot erase decisions or events');
    b.ctx.DeckPages.mark(b.ctx.DeckPages.ctx(b.ctx.DeckPages.parse('today')), b.ctx.DeckUI.tdFresh(feeds, [], 1800000000000));
    assert.match(text(b.pact.innerHTML), /Out of date · last read 1 min Try again/);
    answers[p] = clone(good[p]); feeds[p] = await b.ctx.tdGet(p);
    assert.doesNotMatch(b.pact.innerHTML, /last read|Try again/, p + ': a real successful read clears the retained mark');
  }
});

test('Pixel landscape keeps one visible real-text Shop mark and its retry, without spending tab-bar space', () => {
  const css = read('css/shop.css');
  const mobile = cut(css, '/* A kept read', '/* selling costs');
  assert.match(mobile, /@media[^{]*\(min-width:600px\) and \(max-height:499px\)/);
  assert.match(mobile, /\.phead:has\(\.fresh\[data-kept\]\)>\.pact\{display:flex/);
  assert.match(mobile, /\.phead:has\(\.fresh\[data-kept\]\) \.fresh\[data-kept\]\{display:inline-flex/);
  assert.match(mobile, /#pg-shop:not\(\[hidden\]\)[^}]+#tfresh\{display:none\}/);
});

test('shared Today shapes preserve explicit component errors and empty lists, but reject each consumed nested container', () => {
  const b = boot({}), D = b.ctx.DeckUI;
  assert.equal(D.tdShape('today', { gateway: { error: 'offline' }, mail: { error: 'no reading' }, cron: { error: 'no jobs' } }), true);
  assert.equal(D.tdShape('today', { gateway: { ok: true }, mail: { mailboxes: [] }, cron: { next: [], failing: [], briefings: [] } }), true);
  assert.equal(D.tdShape('schedules', { groups: [{ jobs: [] }, { error: 'host not reporting' }] }), true);
  assert.equal(D.tdShape('calendar', { days: [{ date: '2099-01-01', events: [] }], bills_due: [] }), true);
  const invalid = [
    ['products', { error: '' }], ['products', { products: [], needs: [], error: { message: 'broken' } }],
    ['today', { gateway: { ok: true }, mail: { error: '' }, cron: { next: [], failing: [] } }],
    ['products', { products: [7], needs: [] }], ['testflight', { apps: ['broken'] }],
    ['schedules', { groups: [{ jobs: [5] }] }], ['calendar', { days: [{ events: [5] }] }],
    ['replyblock', { counts: {}, items: [5] }], ['deadlines', { renewals: [5], paperwork: [] }],
    ['cams', { cams: [false] }], ['car', { battery: {}, locked: true }], ['ha', { entities: { sensor: 'broken' } }],
    ['accounts', { apple: { events_today: {} } }], ['accounts', { apple: { bills_due: 'broken' } }],
    ['cluster', { engine: {}, nodes: [7] }], ['markets', { board: [{ hist: 'broken' }] }],
    ['surf-coast', { spots: [{ now: { wave_ft: 'broken' } }], regions: [] }],
    ['surf-coast', { spots: [], regions: [{ wave_ft: {} }] }],
    ['ecom-market', { watches: { items: [{ best: 'broken' }] } }],
    ['hockey', { teams: [{ next_game: [] }] }], ['hockey', { teams: [], live: [5] }],
    ['traffic', { status: 'ok', daily: { sites: {} } }], ['traffic', { status: 'ok', vercel: { projects: 'broken' } }],
    ['onthisday', { total: 0, years: [5] }], ['photoyears', { years: ['broken'] }]
  ];
  for (const [p, d] of invalid) assert.equal(D.tdShape(p, d), false, p + ': ' + JSON.stringify(d));
});

test('integration: a 304 after a failed Shop refresh clears retained text and retry without dropping rows', async () => {
  const f = require('./shop_fixture.cjs')();
  const b = boot({ 'ecom-market': f.market, ecom: f.ecom, listings: f.listings, amazon: { t: f.market.t, watch: [], deals: [] }, trends: require('./trends_fixture.cjs').trends() });
  vm.runInContext(read('pages/shop.js'), b.ctx);
  b.ctx.DeckPages.dispatch('shop/market', false); await settle();
  const before = b.page.innerHTML;
  b.fail('offline'); b.ctx.DeckPages.dispatch('shop/market', false); await settle();
  assert.match(b.pact.innerHTML, /data-kept/);
  b.fail('notmodified'); b.ctx.DeckPages.dispatch('shop/market', false); await settle();
  assert.equal(b.page.innerHTML, before);
  assert.doesNotMatch(b.pact.innerHTML, /data-kept|last read|Try again/);
});

test('integration: amount routes, including commerce, are never retained', async () => {
  const paths = ['commerce', 'finance', 'finance-values', 'portfolio-values', 'housing/profile'];
  const b = boot(Object.fromEntries(paths.map(p => [p, { sample: true, amount: 10000 }])));
  for (const p of paths) assert.equal((await b.ctx.DeckPages.get(p)).ok, true);
  b.fail('offline');
  for (const p of paths) assert.equal((await b.ctx.DeckPages.get(p)).ok, false, p + ': no retained amount-bearing answer');
});
