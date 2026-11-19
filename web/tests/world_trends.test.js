// node --test tests/*.test.js  (World tab and Trending, 2026-11-17)
// The world's eye view (static/pages/world.js): the scored gaps lead, each with its demand, supply, evidence and next step; then one
// compact panel per domain, each with its own age and the deck's "is not reporting" state when its feed is missing. Shop's Trending (static/pages/shop.js)
// and Markets' Trending tickers (static/invest.js) read the same trends feed. Every renderer is tested with the contract fixtures
// (tests/fixtures/trends.sample.json, gaps.sample.json), with nothing yet (undefined), a missing file and a malformed answer.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const cut = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b));
const deck = read('static/deck.js');
const D = new Function(cut(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const W = new Function('DeckUI', 'DeckPages', read('static/pages/world.js') + '\nreturn DeckWorld;')(D, undefined);
const S = new Function('DeckUI', read('static/pages/shop.js') + '\nreturn DeckShop;')(D);
const inv = read('static/invest.js');
const I = new Function('DeckUI', cut(inv, '// ==== DECK INVEST UI BEGIN', '// ==== DECK INVEST UI END ====') + '\nreturn DeckInvest;')(D);
const TR = require('./trends_fixture.cjs');
const NOW = (1794927600 + 3600) * 1000;
const vis = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const MISSING = { error: 'file missing', src: '~/.meshvault/status/deck/gaps.json', stale: true };
const WRONG = { t: 'soon', items: 5, products: {}, tickers: 'x', searches: 3, spots: 7, rows: 'x' };

// the other World reads, in the shapes the deck serves them (trimmed)
const SURF = { t: 1794927000, refresh: 1800, stale: false, spots: [
  { id: 'strands', name: 'Strands', pinned: 2, best: { day: 'today', label: '7-9 am', rating: 8, word: 'Good', reason: '6 ft at 12 s' } },
  { id: 'salt-creek', name: 'Salt Creek', pinned: 1, best: { day: 'today', label: '7-9 am', rating: 9, word: 'Good', reason: '8 ft at 13 s' } },
  { id: 'rincon', name: 'Rincon', best: { day: 'today', rating: 6, word: 'Fair' } }] };
const HOUSE = { generated_at: '2026-11-17T12:00:00Z', mortgage: { rate_30y: 7.11, as_of: '2026-11-12', source: 'FRED MORTGAGE30US' },
  us: { zhvi: 367798, zhvi_yoy: 1.63, redfin_inventory_yoy: 13.63, days_on_market: 49 } };
const HOMES = { generated_at: '2026-11-17T14:00:00Z', total: 1566, rows: [{ type: 'Condo', beds: 1, city: 'Huntington Beach', price: 435000, url: 'https://www.redfin.com/x', addr: '1 Sample St' }] };
const CRE = { generated_at: '2026-11-17T14:13:00Z', total: 1730, rows: [{ id: 'd1', type: 'Retail', city: 'Apple Valley', state: 'CA', price: 2900000, cap: { kind: 'listed', value: 11.17 } }] };
const JOBS = { t: 1794925974, refresh: 3600, stale: false, taxonomy: [{ slug: 'ai_software', name: 'AI and software' }, { slug: 'real_estate', name: 'Real estate' }],
  market: { by_category: { real_estate: { total: 88, delta_vs_prev: -3, median_pay_max: 150000 }, ai_software: { total: 1736, delta_vs_prev: 12, median_pay_max: 233000 } } } };
const ALL = () => ({ g: TR.gaps(), tr: TR.trends(), surf: SURF, house: HOUSE, homes: HOMES, cre: CRE, jobs: JOBS, now: NOW, view: {} });

test('gaps: best score first, an unscored item last; evidence keeps only rows that name a source, with its as-of as a day', () => {
  const g = TR.gaps();
  g.items.push({ id: 'x', title: 'No source', domain: 'local', gap_score: 10, evidence: [{ metric: 'm', value: '1' }] });
  const rows = W.gapsModel(g);
  // the server drops an unknown domain; the page still orders what it is given and draws no chip for it
  assert.deepEqual(rows.map((r) => r.key), ['bad-domain', 'ai-smb-local', 'ecom-home-battery', 'cre-small-nnn', 'x', 'jobs-ai-oc', 'surf-lessons']);
  assert.equal(rows[1].score, 85);
  assert.equal(rows[rows.length - 1].score, null, 'an unscored gap sorts last');
  assert.equal(rows.find((r) => r.key === 'jobs-ai-oc').score, null, 'a score past 100 is not a score');
  assert.deepEqual(rows.find((r) => r.key === 'ecom-home-battery').evidence.map((e) => [e.source, e.value, e.asOf]),
    [['google-trends', '+180%', 'Nov 17'], ['amazon-bestsellers', '3', 'Nov 17']]);
  assert.equal(rows.find((r) => r.key === 'x').evidence.length, 0);
  assert.equal(rows.find((r) => r.key === 'bad-domain').word, '', 'an unknown domain gets no chip');
});

test('gap card: score, title, domain chip, a visible Why handle and the next step; a tap opens what the score weighs, demand against supply and each source with its as-of', () => {
  const h = W.gapsHtml(TR.gaps(), NOW, {});
  const card = h.slice(h.indexOf('data-key="ecom-home-battery"'), h.indexOf('</details>', h.indexOf('data-key="ecom-home-battery"')));
  assert.match(card, /<span class="wg-sc" data-band="hi" aria-label="Gap score 78 of 100"><b>78<\/b><small>of 100<\/small><\/span>/);
  assert.match(card, /<span class="pill wg-dom" data-domain="ecom">E-commerce<\/span><span class="wg-why">Why \u00B7 2 evidence rows<\/span>/);
  // closed, a card is the score, the title, the chip with its Why handle and the next step; demand and supply are behind the tap
  const summary = card.slice(0, card.indexOf('</summary>'));
  assert.match(vis(summary), /78 of 100 Home battery backup kits under \$500 E-commerce Why \u00B7 2 evidence rows Next: Price 3 LiFePO4 kits/);
  assert.doesNotMatch(summary, /Demand|Supply/);
  assert.match(vis(card), /Demand Searches up 180% in 30 days \(US-CA\) Supply 3 of top 20 best sellers under \$500/);
  assert.match(vis(card), /search growth, 30 d google-trends · as of Nov 17 \+180%/);
  assert.match(h, /<h2 class="secttl"><span>Gaps<\/span><span>2\u00a0h\u00a0ago<\/span><\/h2>/);
  // an as-of that did not parse says so instead of a date
  assert.match(vis(h), /median cap rate loopnet-public · no as-of date 7\.5%/);
  assert.match(h, /<p class="note sm">No evidence rows in the feed\.<\/p>/);
});

test('gap score: the Why line states the weights the feed publishes, never ones it did not; a source list past three members is a count', () => {
  const m = 'gap_score = round(clamp(100 * (0.55 * demand + 0.45 * (1 - supply)) * confidence + 8 * fit, 0, 100)). confidence = 0.7 + 0.1 per evidence row.';
  assert.equal(W.whyText(m), 'Demand counts 55% and thin supply 45%, scaled down when fewer evidence rows back it. Higher is a bigger gap.');
  assert.equal(W.whyText('gap_score = round(clamp(100 * (0.6 * demand + 0.4 * (1 - supply)), 0, 100))'), 'Demand counts 60% and thin supply 40%. Higher is a bigger gap.');
  for (const x of ['', undefined, null, 'a different method']) assert.equal(W.whyText(x), 'A higher score means more demand and less supply.');
  const g = TR.gaps();
  g.method = m;
  g.items[0].evidence = [{ source: 'public job boards (ashby, dice, governmentjobs, greenhouse, himalayas, hn_hiring, lever, linkedin)', metric: 'Open postings', value: 1736, as_of: '2026-11-18T06:54:40+00:00' },
    { source: 'BLS (JOLTS, 2026)', metric: 'm', value: '1' }];
  const rows = W.gapsModel(g), first = rows.find((r) => r.key === g.items[0].id);
  assert.deepEqual(first.evidence.map((e) => e.source), ['public job boards (8 sources)', 'BLS (JOLTS, 2026)']);
  assert.match(vis(W.gapHtml(first)), /Demand counts 55% and thin supply 45%/);
  assert.match(vis(W.gapHtml(W.gapsModel(Object.assign(TR.gaps(), { items: [{ id: 'u', title: 'No score', domain: 'jobs', evidence: [] }] }))[0])), /--\s*unscored.*Why\b.*This gap has no score yet\./);
});

test('gaps: nothing yet is a skeleton; a missing file or a malformed answer is the not-reporting state; no items is one quiet line', () => {
  assert.match(W.gapsHtml(undefined, NOW, {}), /aria-busy="true"/);
  for (const g of [MISSING, WRONG, null]) {
    const h = W.gapsHtml(g, NOW, {});
    assert.match(h, /<div class="es es-bad" role="status">.*<b class="es-t">Gaps are not reporting<\/b>.*data-retry="world"/, JSON.stringify(g));
    assert.doesNotMatch(h, /of 100|wg-sc/);
  }
  assert.match(vis(W.gapsHtml(MISSING, NOW, {})), /Gaps are not reporting Nothing has been collected yet/);
  assert.match(vis(W.gapsHtml({ t: 1, items: [] }, NOW, {})), /No gaps scored yet/);
});

test('gaps: six open with Show more; Show fewer once more are open; every title escaped', () => {
  const g = TR.gaps();
  g.items = Array.from({ length: 8 }, (_, i) => ({ id: 'g' + i, title: '<img src=x onerror=alert(1)> gap ' + i, domain: 'local', gap_score: 50 + i, evidence: [] }));
  const h = W.gapsHtml(g, NOW, {});
  assert.equal((h.match(/<details class="wg"/g) || []).length, 6);
  assert.match(h, /data-more="gaps">Show 2 more<\/button>/);
  const all = W.gapsHtml(g, NOW, { gaps: 12 });
  assert.equal((all.match(/<details class="wg"/g) || []).length, 8);
  assert.match(all, /data-less="1" data-more="gaps">Show fewer/);
});

test('World page: the gaps lead, then Surf, Residential, Commercial, Jobs demand and Trending searches, each with its own age', () => {
  const h = W.page(ALL()), v = vis(h);
  const order = [...h.matchAll(/<section class="sect (?:wd-gaps|wd-p)" id="wd-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['gaps', 'surf', 'res', 'com', 'jobs', 'search']);
  assert.match(v, /Surf 70 min ago Salt Creek Today 7-9 am · 8 ft at 13 s Good 9 of 10 Strands/);
  assert.doesNotMatch(v, /Rincon/, 'only the pinned home spots');
  assert.match(v, /30-yr rate 7\.11% Nov 12/);
  assert.match(v, /US home value \$368K \+1\.6% 1 yr/);
  assert.match(v, /1,566 homes listed near home Condo, 1 bd Huntington Beach \$435K/);
  assert.doesNotMatch(v, /Sample St/, 'no street address on the World page');
  assert.match(v, /1,730 public deals, best scored first Retail Apple Valley, CA \$2\.90M 11\.17% cap, listed/);
  assert.match(v, /Jobs demand 87 min ago AI and software Median top of range \$233K 1,736 \+12 since last read Real estate/);
  // fastest growing first; unknown growth last and never a zero
  const s = h.slice(h.indexOf('id="wd-search"'));
  assert.deepEqual([...s.matchAll(/<b>([a-z][^<]*)<\/b>/g)].map((m) => m[1]).slice(0, 4), ['local ai assistant for small business', 'home battery backup', 'surf lessons huntington beach', 'duplex for sale orange county']);
  assert.match(s, /<span class="delta up">\+240%<\/span>/);
  assert.doesNotMatch(s, />0%</);
});

test('World page: before any answer every panel is a skeleton; a failed read is one not-reporting state under the panel title, with its cause and Try again', () => {
  const wait = W.page({ now: NOW });
  assert.equal((wait.match(/aria-busy="true"/g) || []).length, 6);
  const down = W.page({ g: MISSING, tr: WRONG, surf: MISSING, house: { error: 'timed out' }, homes: { error: 'http 500' }, cre: MISSING, jobs: WRONG, now: NOW });
  for (const [t, verb] of [['Gaps', 'are'], ['Surf', 'is'], ['Residential', 'is'], ['Commercial', 'is'], ['Jobs demand', 'is'], ['Trending searches', 'are']]) {
    assert.match(down, new RegExp('<span>' + t + '</span></h2><div class="es es-bad" role="status">.*?<b class="es-t">' + t + ' ' + verb + ' not reporting</b>.*?data-retry="world">Try again</button></div></section>'), t);
  }
  // the figure-step "Unavailable" tile is gone: it was wider than its cell on a phone and offered no way to ask again
  assert.doesNotMatch(down, /Unavailable|class="tile"|class="strip"/);
  assert.equal(vis(W.page({ g: MISSING, now: NOW })).includes('Nothing has been collected yet. It fills in after the next refresh.'), true);
  assert.match(vis(W.page({ surf: { error: 'time out' }, now: NOW })), /Surf is not reporting The source took too long to answer/);
  // one half of Residential down: the other half stays, the down half says so
  const half = vis(W.page(Object.assign(ALL(), { homes: MISSING })));
  assert.match(half, /30-yr rate 7\.11%/);
  assert.match(half, /Nearby homes are not reporting Nothing has been collected yet/);
  assert.doesNotMatch(down, /\$0|>0 homes|NaN|undefined/);
});

test('World: one freshness mark from the gaps feed with every failed read counted; the Data sheet lists each read and each failed trends source', () => {
  const f = W.fresh(ALL());
  assert.deepEqual(f, { age: 5400, refresh: 3600, missing: 0 });
  assert.equal(W.fresh(Object.assign(ALL(), { cre: MISSING, jobs: { error: 'wrong shape' } })).missing, 2);
  assert.equal(W.fresh({ now: NOW }).age, null);
  const d = W.dataModel(Object.assign(ALL(), { cre: MISSING }));
  assert.deepEqual(d.sources.map((s) => [s.name, s.state]), [['Market gaps', 'ok'], ['Trends', 'ok'], ['Surf coast', 'ok'], ['National housing', 'ok'], ['Homes near you', 'ok'], ['Commercial deals', 'never'], ['Jobs', 'ok']]);
  assert.match(d.method[0][1], /^gap_score = /);
  assert.deepEqual(d.setup.map((s) => [s.name, s.line]), [['ebay-trending', 'HTTP 429'], ['reddit-buyitforlife', 'timeout']]);
});

test('World shapes: the served answers pass; the chaos wrongtype body fails every read; an error body is judged by its error', () => {
  const ok = { gaps: TR.gaps(), trends: TR.trends(), 'surf-coast': SURF, 'housing/national?part=summary': HOUSE, 'realestate/homes?limit=3': HOMES, 'cre/deals?limit=3': CRE, jobs: JOBS };
  for (const [k, v] of Object.entries(ok)) assert.equal(W.SHAPE[k](v), true, k);
  for (const k of Object.keys(W.SHAPE)) {
    assert.equal(W.SHAPE[k]({ t: 1, items: 5, products: {}, tickers: 'x', searches: 3, feeds: {}, spots: 7, rows: 'x', us: [], market: 'x' }), false, k);
    assert.equal(W.SHAPE[k](MISSING), true, k);
  }
});

test('shell: World is the second tab, a section with its one container, linked CSS and script, embedded and cached', () => {
  const html = read('static/index.html'), app = read('static/app.js'), main = read('rust/src/main.rs'), sw = read('static/sw.js');
  assert.match(app, /const TABS=\['today','world','home',/);
  assert.match(app, /world:'i-world'/);
  assert.match(html, /<symbol id="i-world"/);
  assert.match(html, /<section class="page" id="pg-world" data-name="world" data-label="World" hidden>\n<header class="phead"><h1 class="ptitle">World<\/h1>/);
  assert.match(html, /<div class="sub" id="pg-world-main" data-sub="main" hidden><\/div>/);
  assert.match(html, /<script src="\/pages\/shop\.js"><\/script><script src="\/pages\/world\.js"><\/script>/);
  for (const f of ['/pages/world.js', '/css/world.css']) { assert.ok(sw.includes("'" + f + "'"), f); assert.ok(main.includes('"' + f + '" => Some(('), f); }
});

test('World layout: one column on P; gaps in two and panels in three on L; two and two on T; three and three on D; five panels on XL', () => {
  const css = read('static/css/world.css');
  assert.match(css, /#pg-world \.wg-list,#pg-world \.wd-grid\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /html\[data-dc="L"\] #pg-world \.wg-list,html\[data-dc="T"\] #pg-world \.wg-list\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css, /html\[data-dc="T"\] #pg-world \.wd-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css, /html\[data-dc="L"\] #pg-world \.wd-grid,html\[data-dc="D"\] #pg-world \.wd-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);
  assert.match(css, /html\[data-dc="XL"\] #pg-world \.wd-grid\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}/);
  // the gap summary is the tap target: at least the touch height, with a visible focus ring
  assert.match(css, /details\.wg>summary\{[^}]*min-height:var\(--hit\)/);
  assert.match(css, /details\.wg>summary:focus-visible\{outline:/);
});

test('Shop Trending: rank, title, signal, source with its age, median price and the rank move; a failed source says so on its row', () => {
  const rows = S.trendingList(TR.trends(), 'all');
  assert.equal(rows.length, 4, 'a row with no title is not a row');
  const h = S.trendRow(rows[0]);
  assert.match(h, /<span class="rank-n">3<\/span>/);
  assert.match(h, /<span class="delta up" aria-label="Up 41 places">41<\/span>/);
  assert.match(vis(h), /Up 41 places in Electronics in 24 h · Amazon bestsellers, 20 min ago \$449/);
  assert.match(S.trendRow(rows[1]), /<span class="delta dn" aria-label="Down 4 places">4<\/span>/);
  assert.match(S.trendRow(rows[2]), /<span class="delta flat" aria-label="Same place">0<\/span>/);
  const air = S.trendRow(rows[3]);
  assert.doesNotMatch(air, /javascript:|<a |delta/);
  assert.match(air, /class="na"/, 'an unknown median is the no-data mark, never $0');
  const tr = TR.trends();
  tr.products[0].source = 'ebay-trending';
  assert.match(S.trendRow(S.trendingList(tr, 'all')[0]), /class="frow trow stl"[^]*<span class="sd warn"><\/span>[^<]*source\u00a0not\u00a0reporting/);
  // a display name is printed as written; source_id names the feeds[] row whose age and health the row carries
  const tr2 = TR.trends();
  Object.assign(tr2.products[1], { source: 'Amazon Best Sellers (sporting goods)', source_id: 'google-trends' });
  assert.match(vis(S.trendRow(S.trendingList(tr2, 'all')[1])), /Amazon Best Sellers \(sporting goods\), 15 min ago/);
  // the collector's id in parentheses is not a word to read, and a source the signal already names is not said twice; the long signal wraps at
  // spaces (only "up 16" and "14 min ago" stay whole)
  const row = { key: 'x', title: 'Desk Lamp', source: 'Etsy best sellers (etsy_api)', signal: '#17 on Etsy best sellers, up 16', age: 840, rank: 17, move: 16, median: 19.99 };
  const line = S.trendRow(row);
  assert.match(vis(line), /#17 on Etsy best sellers, up 16 · 14 min ago \$19\.99/);
  assert.doesNotMatch(line, /etsy_api/);
  assert.match(line, /#17 on Etsy best sellers, up\u00a016 \u00B7 14\u00a0min\u00a0ago/);
  assert.match(vis(S.trendRow(Object.assign({}, row, { signal: 'Trending up' }))), /Trending up · Etsy best sellers, 14 min ago/);
});

test('Shop Trending: nothing yet is a skeleton; missing or malformed is not reporting with Try again; none is one quiet line', () => {
  assert.match(S.trendingBody(undefined, 'all'), /aria-busy="true"/);
  assert.match(vis(S.trendingBody({ error: 'file missing' }, 'all')), /Trending is not reporting Nothing has been collected yet/);
  for (const bad of [WRONG, { t: 1 }, null]) {
    const h = S.trendingBody(bad, 'all');
    assert.match(h, /Trending is not reporting/, JSON.stringify(bad));
    assert.match(h, /data-retry="shop"/);
  }
  assert.match(vis(S.trendingBody({ t: 1, products: [] }, 'all')), /Nothing trending right now\./);
  assert.equal(S.trendsSource({ error: 'file missing' }).state, 'never');
  assert.match(S.trendsSource(TR.trends()).gives, /^5 products, not reporting: Ebay trending, Reddit buyitforlife$/);
});

test('Markets Trending tickers: price, change, volume against average and the reason; unknown is no quote; failed or malformed is not reporting', () => {
  const closed = { session: { state: 'closed' }, board: [] };
  const h = I.trendingTickers(TR.trends(), NOW, closed, {});
  // no session in the markets feed: the session is unknown, so a day-old quote takes the open-session limit and says its date
  assert.match(vis(I.trendingTickers(TR.trends(), NOW, null, {})), /SMCI 3\.4× volume · As of Nov 17/);
  assert.match(vis(h), /SMCI 3\.4× volume · Volume 3\.4x its 30-day average \$41\.22 \+9\.80%/);
  assert.match(vis(h), /RIVN 2\.2× volume · Most active, down on guidance \$13\.05 −6\.10%/);
  assert.match(vis(h), /BTC-USD Time unknown · Search interest up 60% week over week No quote/);
  assert.doesNotMatch(h, /bad symbol/);
  for (const bad of [undefined, { error: 'file missing' }, WRONG]) assert.match(I.trendingTickers(bad, NOW, null, {}), /Trending tickers are not reporting/, JSON.stringify(bad));
  assert.match(vis(I.trendingTickers({ t: 1, tickers: [] }, NOW, null, {})), /Nothing trending right now/);
  // the page draws a skeleton while trends are still loading, and the Data sheet names the failed trends sources
  assert.match(I.page(null, null, null, null, NOW, {}, { m: 'done', p: 'done', t: 'done', tr: 'loading' }, { cls: 'P' }), /<span>Trending tickers<\/span>[^]*data-skel="1"/);
  const src = I.data(null, null, null, NOW, TR.trends()).sources.find((s) => s.name === 'Trending tickers');
  assert.deepEqual([src.gives, src.state], ['4 tickers, not reporting: ebay-trending, reddit-buyitforlife', 'stale']);
});
