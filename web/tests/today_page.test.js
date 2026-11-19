// Today (design v3, lane PgToday): glance and decide. Pins what the owner sees: section order and cap, glance tiles with each feed missing,
// the one "Some checks did not report" row, the Search clicks tile, and no raw error text anywhere on the page.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const start = src.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const end = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
const DeckUI = new Function(src.slice(start, end) + '\nreturn DeckUI;')();
// V2: Today's markets strip reads its figures through Money > Markets' quote model (invest.js), as the page does in the browser
const inv = fs.readFileSync(path.join(__dirname, '../static/invest.js'), 'utf8');
globalThis.DeckInvest = new Function('DeckUI', inv.slice(inv.indexOf('// ==== DECK INVEST UI BEGIN'), inv.indexOf('// ==== DECK INVEST UI END ====')) + '\nreturn DeckInvest;')(DeckUI);

const NOW = Date.UTC(2026, 10, 15, 2, 0); // Nov 14, 6:00 pm Pacific
const T = NOW / 1000;
const text = html => String(html).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const visible = html => text(String(html).replace(/<span class="diag">.*?<\/span>/g, ''));

const SSH = 'dell-systemd: dell: ssh: connect to host 192.0.2.50 port 22: Connection timed out';
const products = {
  t: T - 360, refresh: 900,
  needs: [
    { owner: 'owner', sev: 'high', text: 'Answer App Review for JudgeFinder.io 1.0', why: 'review unresolved issues since 2026-10-16', url: 'https://appstoreconnect.apple.com/apps/1' },
    { owner: 'owner', sev: 'med', text: 'Fix CI on meshchat main', why: 'iOS build and unit tests', url: 'https://github.com/x/meshchat/actions' },
    { owner: 'agent', sev: 'high', text: 'Restart dell-systemd', why: SSH },
  ],
};
const schedules = {
  t: T - 60, refresh: 300,
  counts: { sources_down: 0 },
  groups: [{ jobs: [
    { name: 'broker-gov-deals', host: 'pc-desktop', result: 'failed' },
    { name: 'gmail-autolabel-personal', host: 'pc-desktop', result: 'failed' },
    { name: 'site-crawl', host: 'dell', result: 'overdue' },
    { name: 'gmail-relink', host: 'pc-desktop', result: 'waiting', owner_wait: { reason: 'Google link expired', mailbox: '' } },
  ] }],
};
const today = { gateway: { ok: true, t: T - 30 }, mail: { t: T - 30, mailboxes: [{ ok: true, role: 'personal' }] } };
const replyblock = { t: T - 600, counts: { drafted: 3, waiting: 4 }, mode: 'live', drafts_url: 'https://mail.google.com/mail/u/0/#drafts' };
const okNeeds = { products, testflight: { apps: [] }, schedules, today, replyblock };

test('the page has at most eight sections, in blueprint order', () => {
  assert.deepEqual([...DeckUI.TD_SECTIONS], ['needs', 'dead', 'alerts', 'cal', 'home', 'clu', 'glance', 'mkt'], 'At a glance above Markets at every size (W4-3)');
  assert.ok(DeckUI.TD_SECTIONS.length <= 8);
});

// ---- layout waves (2026-11-15): Today's flow opts in to the shared balancer (DeckBalance, data-balance); the planner's own tests are in
// tests/balance.test.js. These pin Today's numbers: the 932x430 day and a repaint with different row counts. ----
test('Today balances whole sections: Needs you and the calendar beside Renewals, home and cluster at 932x430; the laptop keeps Needs you alone', () => {
  assert.deepEqual(DeckUI.balanceColumns([720, 500, 270, 130, 330], 2), [0, 1, 0, 1, 1], 'Needs you + calendar | Renewals + home + cluster');
  const l = DeckUI.balanceColumns([900, 560, 300, 90, 360], 3);
  assert.equal(l[0], 0);
  assert.ok(!l.slice(1).includes(0), 'nothing joins the tallest');
});

test('Today: a repaint with different row counts gets a new split (heights from the kit probe, 932x430 and 834)', () => {
  // measured in Chromium and WebKitGTK 2.54 (RestoreToday lane report): load, then Renewals repainted with two rows, then Needs you with one
  const at = (hs, n) => { const p = DeckUI.balanceColumns(hs, n), col = new Array(n).fill(0); p.forEach((c, i) => { col[c] += hs[i]; }); return { p, col }; };
  const load = at([740, 520, 300, 150, 360], 2), fewer = at([740, 200, 300, 150, 360], 2), one = at([120, 200, 300, 150, 360], 2);
  assert.deepEqual(load.p, [0, 1, 0, 1, 1]);
  assert.notDeepEqual(fewer.p, load.p, 'a shorter Renewals moves a section across');
  for (const r of [load, fewer, one]) assert.ok(Math.abs(r.col[0] - r.col[1]) <= 200, JSON.stringify(r.col));
});

test('Today opts in to the shared balancer; Markets and At a glance span under the columns', () => {
  const glue = src.slice(end);
  assert.match(glue, /flow=box\('flow td'\);flow\.setAttribute\('data-balance',''\)/);
  assert.doesNotMatch(glue, /tdBalance|TD_RO|td-cols/, 'one balancer, not a Today copy');
  assert.match(glue, /'<section class="sect'\+\(k==='mkt'\|\|k==='glance'\?' span-all':''\)/);
});

test('Needs you: owner decisions only, Now first, signal marks and no red', () => {
  const n = DeckUI.tdNeeds(okNeeds);
  const html = DeckUI.tdNeedsHtml(n, []);
  const words = visible(html);
  assert.match(words, /^Needs you Answer App Review for JudgeFinder\.io 1\.0/);
  assert.doesNotMatch(words, /Restart dell-systemd/, 'an agent-fixable check is not an owner decision');
  assert.match(words, /since Oct 16/, 'ISO dates read as blueprint dates');
  assert.doesNotMatch(words, /2026-10-16/);
  assert.doesNotMatch(html, /sd bad|pill bad/, 'nothing in Needs you is red');
  assert.match(html, /lead-mark sd wait/);
  assert.equal(n.items[0].sev, 'high');
  assert.ok(n.items.findIndex(x => x.sev === 'med') > n.items.findIndex(x => x.sev === 'high'));
});

test('failing jobs are one counted Alert row with the names in a sheet, never a comma list on the page, never in Needs you', () => {
  const n = DeckUI.tdNeeds(okNeeds);
  const needs = visible(DeckUI.tdNeedsHtml(n));
  assert.match(needs, /1 job waits on you/);
  assert.doesNotMatch(needs, /failing|overdue/, 'what an agent can fix is not an owner step (B1)');
  const words = visible(DeckUI.tdAlertsHtml(n, today, { count: 0, names: [] }, []).html);
  assert.match(words, /^Alerts 2 scheduled jobs failing 1 more is overdue/);
  assert.doesNotMatch(words, /broker-gov-deals|gmail-autolabel-personal|pc-desktop/);
  const sheet = visible(DeckUI.tdJobsSheet(n.jobs));
  assert.match(sheet, /Broker gov deals/);
  assert.match(sheet, /Failing/);
});

test('Needs you caps at six rows and puts the rest behind one row', () => {
  const many = { ...okNeeds, products: { ...products, needs: Array.from({ length: 9 }, (_, i) => ({ owner: 'owner', sev: 'low', text: 'Decision ' + i })) } };
  const n = DeckUI.tdNeeds(many);
  const html = DeckUI.tdNeedsHtml(n, []);
  assert.equal((html.match(/class="frow need/g) || []).length, 6);
  assert.match(visible(html), /\b\d+ more\b/);
  assert.match(html, /data-open="today-needs"/);
});

test('one Alerts row lists what did not report in plain words; the raw reason reaches only the sheet', () => {
  const miss = [
    DeckUI.tdMiss('calendar', { error: SSH }),
    DeckUI.tdMiss('hockey', null),
    DeckUI.tdMiss('cams', { error: 'camera status unavailable' }),
    DeckUI.tdMiss('car', { error: 'timed out' }),
  ];
  const html = DeckUI.tdAlertsHtml(DeckUI.tdNeeds(okNeeds), today, { count: 0, names: [] }, miss).html;
  const words = visible(html);
  assert.match(words, /Some checks did not report Calendar, Hockey, Cameras and 1 more/);
  assert.equal((html.match(/Some checks did not report/g) || []).length, 1, 'one row, never one card per feed');
  assert.doesNotMatch(html, /ssh|192\.0|port 22|Connection timed out|Try again/);
  assert.doesNotMatch(visible(DeckUI.tdNeedsHtml(DeckUI.tdNeeds(okNeeds))), /Some checks did not report/, 'Needs you holds owner steps only');
  const sheet = DeckUI.tdChecksSheet(miss);
  assert.match(visible(sheet), /Calendar/);
  assert.match(sheet, /class="raw"/);
});

test('no raw error strings in any rendered section when every feed failed', () => {
  const bad = { error: SSH, src: '/home/alice/.kodros/status/deck/x.json' };
  const parts = [
    (() => { const n = DeckUI.tdNeeds({ products: bad, testflight: bad, schedules: bad, today: bad, replyblock: bad }); return DeckUI.tdNeedsHtml(n) + DeckUI.tdAlertsHtml(n, bad, bad, n.miss.concat([DeckUI.tdMiss('cluster', bad)])).html; })(),
    DeckUI.tdDeadlines(bad).html, DeckUI.tdCal(bad, bad, NOW, { briefing: bad }).html, DeckUI.tdHome({ cams: bad, car: bad, ha: bad, watch: bad, wx: bad }, NOW).html,
    DeckUI.tdCluster(bad, NOW).html, DeckUI.tdMarkets(bad).html,
    DeckUI.tdGlance({ surf: bad, summary: bad, zip: bad, ecom: bad, hockey: bad, onthisday: bad, traffic: bad }).html,
  ].join('');
  assert.doesNotMatch(parts, /ssh|192\.0|alice|\.json|status\/deck|<span class="diag">/);
  assert.match(visible(parts), /Some checks did not report/);
});

// each break here has its own height (height_basis spot), so the tile names the break; the region case is in tests/today_glance.test.js
const surf = { t: T - 900, refresh: 1800, spots: [
  { id: 'salt-creek', name: 'Salt Creek', pinned: 1, now: { wave_ft: [3, 4], rating: 4, word: 'Fair', height_basis: 'spot', confidence: { model_only: false } } },
  { id: 'san-clemente-pier', name: 'San Clemente Pier', pinned: 4, now: { wave_ft: [5, 6], rating: 7, word: 'Good', height_basis: 'spot', confidence: { model_only: false } } },
  { id: 'rincon', name: 'Rincon', pinned: null, now: { wave_ft: [8, 10], rating: 9, word: 'Great', height_basis: 'spot' } },
] };
const summary = { mortgage: { rate_30y: 7.11 } };
const zip = { zip: '92647', city: 'Huntington Beach', value_trend_1y: 7.06, x: { m: { value_trend_1y: { v: 7.06, c: 0.62 } } } };
const ecom = { watches: { items: [
  { label: 'rtx 4080', median: 900, change_7d: -14.29 },
  { label: 'sony wh-1000xm5', median: 549, change_7d: 2.1 },
] } };
const hockey = { teams: [{ abbr: 'ANA', name: 'Anaheim Ducks', record: '10-8-1', standing: '3rd Pacific', next_game: { opp: 'NYI', at: T + 3600, home: true } }], live: [] };
const onthisday = { total: 34, years: [{ year: 2024, count: 14 }, { year: 2019, count: 9 }] };
const traffic = { t: T - 600, daily: { date: '2026-11-12', goal: 2000, aggregate: { clicks: 24, measured: 2, tracked: 3, complete: false, pct: 1.2 },
  sites: [{ domain: 'meshvault.ai', value: 0 }, { domain: 'protocol-guide.com', value: 24 }, { domain: 'pepgo.org', value: null, reason: 'no_access' }] } };
const glanceAll = { surf, summary, zip, place: 'Huntington Beach', ecom, hockey, onthisday, traffic, now: NOW };

test('glance row: six tiles in order, the best home spot, the owner market, the biggest watch drop', () => {
  const g = DeckUI.tdGlance(glanceAll);
  assert.deepEqual(g.miss, []);
  assert.deepEqual(g.tiles.map(t => t.key), ['surf', 'housing', 'shop', 'hockey', 'onthisday', 'traffic']);
  const words = visible(g.html);
  assert.match(words, /Surf · San Clemente Pier 5-6 ft/, 'the best pinned spot, never an out-of-area spot');
  assert.doesNotMatch(words, /Rincon/);
  assert.match(words, /Real estate · Huntington Beach \+7\.1% /);
  assert.match(words, /30-yr rate 7\.11%/);
  assert.match(words, /Shop · RTX 4080 \$900 median \u221214\.3% 7 days/);
  assert.match(words, /Hockey · Anaheim Ducks 10-8-1 Next NYI/);
  assert.match(words, /On this day 34 photos in 2 earlier years/);
  assert.match(g.html, /data-go="surf"/);
  assert.match(g.html, /data-go="realestate\/residential"/);
  assert.match(g.html, /data-go="shop\/market"/);
});

test('a glance tile whose feed is missing is absent from the row and named once in the checks', () => {
  const cases = { surf: 'Surf', ecom: 'Shop', hockey: 'Hockey', onthisday: 'Photos on this day', traffic: 'Website traffic' };
  for (const [k, name] of Object.entries(cases)) {
    const g = DeckUI.tdGlance({ ...glanceAll, [k]: k === 'surf' ? { status: 'not_reporting', reason: 'missing' } : { error: 'file missing' } });
    assert.equal(g.tiles.length, 5, k);
    assert.deepEqual(g.miss.map(m => m.name), [name], k);
    assert.doesNotMatch(visible(g.html), /not reporting|No data|missing/i, k + ': no empty card');
  }
  const noEstate = DeckUI.tdGlance({ ...glanceAll, summary: { status: 'not_reporting' }, zip: null });
  assert.ok(!noEstate.tiles.some(t => t.key === 'housing'));
  assert.deepEqual(noEstate.miss.map(m => m.name), ['Real estate']);
  const rateOnly = DeckUI.tdGlance({ ...glanceAll, zip: { status: 'not_reporting' } });
  assert.match(visible(rateOnly.html), /30-year rate 7\.11%/);
  const none = DeckUI.tdGlance({});
  assert.equal(visible(none.html), 'At a glance Almanac Your history, 2006 to now', 'with every feed gone only the Almanac way in remains');
  assert.equal(none.tiles.length, 0);
});

test('the Search clicks tile: one number, one label, one qualifier at most', () => {
  const t = DeckUI.tdTrafficTile(traffic);
  assert.equal(t.h, 'Search clicks');
  assert.equal(text(t.v), '24');
  assert.equal(text(t.t), '2 of 3 sites');
  const done = DeckUI.tdTrafficTile({ daily: { date: '2026-11-12', aggregate: { clicks: 1240, measured: 3, tracked: 3, complete: true } } });
  assert.equal(text(done.v), '1,240');
  assert.equal(text(done.t), 'Nov 12');
  assert.equal(DeckUI.tdTrafficTile({ status: 'unavailable', sites: [] }), null);
  assert.equal(DeckUI.tdTrafficTile({ daily: { aggregate: { clicks: null } } }), null);
  const tile = visible(DeckUI.tdGlance(glanceAll).html);
  assert.doesNotMatch(tile, /not visits|Checked|organic|Partial|unmeasured|Search Console|goal/i);
  const data = DeckUI.tdData({ traffic }, NOW);
  assert.ok(data.method.some(([k, v]) => k === 'Search clicks' && /not counted as zero/.test(v) && /Clicks are not visits/.test(v)), 'the method lives in the Data sheet');
});

test('markets: one strip of eight quotes, true minus, no source; a fund price keeps its symbol in the label', () => {
  const grp = { spy: 'us', qqq: 'us', dia: 'us', iwm: 'us', us10y: 'rates', wti: 'commodity', gold: 'commodity', btc: 'crypto', vix: 'vol' };
  const board = ['spy', 'qqq', 'dia', 'iwm', 'us10y', 'wti', 'gold', 'btc', 'vix'].map((id, i) => ({ id, group: grp[id], label: id === 'spy' ? 'S&P 500 (SPY)' : id === 'us10y' ? '10-year yield' : id.toUpperCase(), price: id === 'btc' ? 62290.4 : 100 + i, pct: i % 2 ? -0.363 : 0.13, chg: 0.051, src: 'yahoo', hist: [[1, 1], [2, 2], [3, 1.5]] }));
  const r = DeckUI.tdMarkets({ board });
  assert.equal((r.html.match(/class="tile sm/g) || []).length, 8);
  const words = visible(r.html);
  assert.match(words, /\u22120\.36%/);
  assert.match(words, /\$62,290/);
  assert.doesNotMatch(words, /yahoo|VIX/);
  // 754.37 is the SPY fund, not the S&P 500 index (about 6,880): the label must still name SPY
  const spy = DeckUI.tdMarkets({ board: [{ id: 'spy', group: 'us', label: 'S&P 500 (SPY)', price: 754.37, pct: -0.36 }] }).html;
  assert.match(visible(spy), /S&P 500 \(SPY\) \$754\.37/);
  assert.match(words, /10-year yield 104\.000% \+5\.1 bp/, 'a yield moves in basis points, never in percent');
  // a change that rounds to zero is flat, never an up arrow beside 0.00%
  assert.match(DeckUI.tdMarkets({ board: [{ id: 'qqq', group: 'us', label: 'QQQ', price: 500, pct: 0.001 }] }).html, /<span class="delta flat">0\.00%<\/span>/);
});

// V2 (SeeViz, 2026-11-15): Today said the 10-year moved "+1.00%" where Money > Markets said "+5.1 bp" for the same reading. One fixture quote,
// printed by both pages, must read the same: the figure and the change, character for character.
test('V2: the 10-year yield on Today reads as Money > Markets reads it, from the same fixture quote', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'markets.sample.json'), 'utf8'));
  // the figure and the change printed after a tile's label (labels are escaped in the markup: "S&amp;P 500")
  const tile = (html, label) => { const i = html.indexOf('>' + label + '<'); assert.ok(i > 0, label); const t = html.slice(i, i + 600);
    return [/<b class="v">([^<]*)/.exec(t)[1], /<span class="delta [a-z]+">([^<]*)/.exec(t)[1]]; };
  const today = DeckUI.tdMarkets(m).html, markets = globalThis.DeckInvest.board(m, 'lead');
  for (const label of ['10-year yield', 'S&amp;P 500', 'BTC']) assert.deepEqual(tile(today, label), tile(markets, label), label);
  assert.deepEqual(tile(today, '10-year yield'), ['5.311%', '+3.4 bp']);
  assert.doesNotMatch(visible(today), /0\.64%/, 'the old percent form of a yield move is gone');
});

// Stale-quote honesty: the strip prints no source or age for a fresh quote, but an old, untimed or future-dated one must not read as live.
test('markets strip: an old, untimed or future-dated quote says so; a fresh one stays quiet', () => {
  const row = (id, t) => ({ id, group: 'us', label: id.toUpperCase(), price: 100, pct: 0.5, t });
  const board = [row('spy', T - 3600), row('qqq', T - 9 * 86400), row('dia', undefined), row('iwm', T + 7200)];
  const html = DeckUI.tdMarkets({ session: { state: 'closed' }, board }, NOW).html;
  const tile = id => text(html.split('<button').find(s => s.includes('data-key="' + id + '"')));
  assert.doesNotMatch(tile('spy'), /Time unknown|As of/);
  assert.match(tile('qqq'), /As of Nov 5/);
  assert.match(tile('dia'), /Time unknown/);
  assert.match(tile('iwm'), /Time unknown/);
  // an open session is stale after half an hour, not five days
  const open = DeckUI.tdMarkets({ session: { state: 'open' }, board: [row('spy', T - 2400), row('qqq', T - 600)] }, NOW).html;
  const o = id => text(open.split('<button').find(s => s.includes('data-key="' + id + '"')));
  assert.match(o('spy'), /As of Nov 14/);
  assert.doesNotMatch(o('qqq'), /As of|Time unknown/);
  // the note shows even where there is no change to print beside it
  const flat = DeckUI.tdMarkets({ session: { state: 'closed' }, board: [{ id: 'spy', group: 'us', label: 'SPY', price: 100, t: T - 9 * 86400 }] }).html;
  assert.match(text(flat), /As of/);
});

test('next on the calendar: the next three events with plain day words', () => {
  const day = d => new Date(NOW + d * 864e5);
  const key = d => { const x = day(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const cal = { t: T - 60, days: [
    { date: key(0), events: [{ title: 'Past', start: new Date(NOW - 7200e3).toISOString(), end: new Date(NOW - 3600e3).toISOString() }, { title: 'Dinner', start: new Date(NOW + 3600e3).toISOString() }] },
    { date: key(1), events: [{ title: 'Surf check', all_day: true }, { title: 'Dentist', start: new Date(NOW + 864e5).toISOString() }, { title: 'Lunch', start: new Date(NOW + 864e5 + 7200e3).toISOString() }] },
  ] };
  const words = visible(DeckUI.tdCal(cal, null, NOW).html);
  assert.match(words, /^Next on the calendar Dinner Today/);
  assert.match(words, /Surf check Tomorrow All day/);
  assert.match(words, /Dentist Tomorrow/);
  assert.doesNotMatch(words, /Past|Lunch/, 'a finished event is gone and the list stops at three');
  const r = DeckUI.tdCal({ error: 'file missing' }, { error: 'mini unreachable' }, NOW);
  assert.equal(r.html, '');
  assert.deepEqual(r.miss.map(m => m.name), ['Calendar']);
});

test('home and cameras: a missing reading never gets a row; only cameras stay on the TV board', () => {
  const r = DeckUI.tdHome({ cams: { cams: [{ ready: true }, { ready: true }, { ready: false }] }, car: { battery: 82.4, range: 240, locked: true },
    ha: { entities: { 'weather.forecast_home': { state: 'unavailable' } } }, watch: { connected: false, hr: null } }, NOW);
  const words = visible(r.html);
  assert.match(words, /Cameras 2 of 3 online/);
  assert.match(words, /Car 240 mi · Locked 82% battery/);
  assert.doesNotMatch(words, /Weather|Apple Watch|No reading/);
  assert.match(r.html, /data-key="cams"(?![^>]*tv-hide)/);
  assert.match(r.html, /class="frow tv-hide" data-go="home\/house" data-key="car"/);
});

test('renewals: six rows (three on a phone), one line on the right, the rest behind one row per size', () => {
  const renewals = Array.from({ length: 8 }, (_, i) => ({ vendor: 'Vendor ' + i, date: '2026-11-' + String(16 + i).padStart(2, '0'), days: i + 2 }));
  const r = DeckUI.tdDeadlines({ renewals, paperwork: [] });
  assert.equal((r.html.match(/<div class="frow(?: td-ph)?">/g) || []).length, 6);
  assert.equal((r.html.match(/<div class="frow td-ph">/g) || []).length, 3, 'rows four to six are off a phone: the top three reach screen one');
  assert.match(r.html, /class="frow td-more-w" data-open="today-dead"><span class="fl"><b>2 more<\/b>/);
  assert.match(r.html, /class="frow td-more-p" data-open="today-dead"><span class="fl"><b>5 more<\/b>/);
  assert.match(visible(r.html), /Vendor 0 Nov 16 2 days/);
  assert.doesNotMatch(DeckUI.tdDeadSheet(r.items), /td-ph/, 'the sheet shows every row at every size');
  assert.equal(DeckUI.tdDeadlines({ renewals: [], paperwork: [] }).html, '', 'nothing due is no section');
});

test('Data sheet: one row per tracked site; no access and no reading are words, never zero; untracked sites stay out', () => {
  const tr = { daily: { date: '2026-11-12', aggregate: { clicks: 24, measured: 1, tracked: 3, complete: false }, sites: [
    { domain: 'protocol-guide.com', value: 24, tracked: true },
    { domain: 'pepgo.org', value: null, reason: 'no_access', error: 'siteUnverifiedUser' },
    { domain: 'thefiredev.com', value: null, reason: 'failed', error: 'HTTP 500' },
    { domain: 'sandboxmentoloop.online', value: 3, tracked: false }] } };
  const m = Object.fromEntries(DeckUI.tdData({ traffic: tr }, NOW).method);
  assert.equal(m['protocol-guide.com'], '24 clicks');
  assert.equal(m['pepgo.org'], 'No Search Console access');
  assert.equal(m['thefiredev.com'], 'No reading');
  assert.equal(m['sandboxmentoloop.online'], undefined);
  assert.doesNotMatch(JSON.stringify(m), /siteUnverifiedUser|HTTP 500/);
});

test('stale or partial decisions never read "Nothing needs you"', () => {
  for (const p of [{ stale: true, errors: [], needs: [] }, { errors: [{ source: 'app_store', reason: 'no reading' }], needs: [] }, { error: 'file missing' }]) {
    const n = DeckUI.tdNeeds({ ...okNeeds, products: p, replyblock: { counts: { drafted: 0 } }, schedules: { groups: [] } });
    assert.doesNotMatch(visible(DeckUI.tdNeedsHtml(n, n.miss)), /Nothing needs you/);
  }
});

test('Today registers its own route with a Data sheet; the old switch line is gone', () => {
  const glue = src.slice(end);
  assert.match(glue, /^DeckPages\.register\('today',\{show:ctx=>\{TDS\.ctx=ctx;v7Today\(\)\},refresh:\(ctx,tick\)=>\{TDS\.ctx=ctx;if\(!tick\|\|pageAge\('today'\)>30000\)v7Today\(!!tick\)\},data:\(\)=>DeckUI\.tdData\(TDS\.feeds,Date\.now\(\)\)\}\);$/m);
  assert.doesNotMatch(glue, /^oldPage\('today',/m);
  assert.match(glue, /DeckPages\.mark\(TDS\.ctx,DeckUI\.tdFresh\(/, 'one freshness mark through the registry');
});

// ---- review RevTodayHome (2026-11-14): F1 signal budget, F2 TV board, F3 freshness mark, F5 unit order, section 13 fetch bound ----
test('F1: one signal square in Needs you however many Now rows; later Now rows keep a plain square and the word', () => {
  // three decisions plus "1 job waits on you" are four Now rows (the reviewed day had four), then two Soon rows
  const needs = Array.from({ length: 3 }, (_, i) => ({ owner: 'owner', sev: 'high', text: 'Decision ' + i }));
  const h = DeckUI.tdNeedsHtml(DeckUI.tdNeeds({ ...okNeeds, products: { ...products, needs } }), []);
  assert.equal((h.match(/sd wait/g) || []).length, 1, 'the page spends one signal mark here');
  assert.ok(h.indexOf('sd wait') < h.indexOf('Decision 1'), 'the first Now row carries it');
  assert.equal((h.match(/<span class="lead-mark sd" aria-hidden="true"><\/span>/g) || []).length, 3, 'the other Now rows: plain square');
  assert.equal((visible(h).match(/\bNow\b/g) || []).length, 4, 'every Now row keeps its word');
  assert.match(h, /lead-mark sd warn[^]*Soon/, 'Soon keeps its triangle');
});

test('F2: the TV board never shows a bare heading; four whole market cells; the board keeps the home spot only', () => {
  const noCams = DeckUI.tdHome({ car: { battery: 80, range: 200, locked: true }, cams: { error: 'camera status unavailable' } }, NOW);
  assert.ok(noCams.html, 'the section still shows on the page');
  assert.equal(noCams.tv, false, 'and leaves the board');
  assert.equal(DeckUI.tdHome({ cams: { cams: [{ ready: true }] } }, NOW).tv, true);
  const board = ['spy', 'qqq', 'dia', 'iwm', 'us10y', 'wti', 'gold', 'btc'].map((id) => ({ id, label: id, price: 1000 + id.length, pct: 0.1 }));
  const m = DeckUI.tdMarkets({ board }).html;
  assert.equal((m.match(/class="tile sm"/g) || []).length, 4, 'four quotes stay on the board');
  assert.equal((m.match(/class="tile sm tv-hide"/g) || []).length, 4);
  assert.match(m, /data-key="spy"[^]*data-key="qqq"/);
  assert.equal(DeckUI.tdGlance(glanceAll).tv, true);
  assert.equal(DeckUI.tdGlance({ ...glanceAll, surf: { error: 'file missing' } }).tv, false);
});

test('F3: the page status names what is missing; "Out of date" needs a source the server marked stale', () => {
  const f = (age, refresh, o) => ({ t: T - age, refresh, ...(o || {}) });
  const miss = [DeckUI.tdMiss('gateway', { error: 'x' }), DeckUI.tdMiss('cams', { error: 'y' })];
  // a 60 s feed two minutes old is not a decision feed and never makes the page out of date
  const a = DeckUI.tdFresh({ products: f(360, 900), cluster: f(120, 60), markets: f(200, 300) }, miss, NOW);
  assert.equal(a.refresh, null);
  assert.equal(a.missing, 2);
  assert.equal(DeckUI.fresh(a).includes('2 parts not reporting'), true);
  assert.equal(DeckUI.fresh(a).includes('Out of date'), false);
  // a feed the server marked stale is out of date
  const s = DeckUI.tdFresh({ products: f(3 * 3600, 900, { stale: true }), markets: f(200, 300) }, [], NOW);
  assert.match(DeckUI.fresh(s), /Out of date/);
  // all fresh and nothing missing: the age only
  const ok = DeckUI.tdFresh({ products: f(360, 900), markets: f(200, 300) }, [], NOW);
  assert.doesNotMatch(DeckUI.fresh(ok), /Out of date|not reporting/);
});

test('F5: the confidence meter follows the value and its unit on the Real estate tile', () => {
  const t = DeckUI.tdGlance(glanceAll).tiles.find((x) => x.key === 'housing');
  assert.ok(t.v.indexOf('<span class="u">1-yr</span>') < t.v.indexOf('class="conf"'));
});

test('a fetch that never settles ends as a named not-reporting part, never a blank card', async () => {
  const A = '// ==== DECK PAGES REGISTRY BEGIN', B = '// ==== DECK PAGES REGISTRY END ====';
  const reg = src.slice(src.indexOf(A), src.indexOf(B));
  const never = (url, o) => new Promise((_, no) => { if (o && o.signal) o.signal.addEventListener('abort', () => no(new Error('aborted'))); });
  const fast = (fn) => setTimeout(fn, 0); // the 15 s bound, run at once
  const P = new Function('fetch', 'setTimeout', 'clearTimeout', 'AbortController', reg + '\nreturn DeckPages;')(never, fast, clearTimeout, AbortController);
  const r = await P.get('cluster');
  assert.equal(r.error, 'timed out');
  const feed = DeckUI.tdFeed(r);
  assert.deepEqual(feed, { error: 'timed out' });
  const c = DeckUI.tdCluster(feed, NOW);
  assert.equal(c.html, '');
  assert.deepEqual(c.miss.map((m) => m.name), ['Cluster']);
  const words = visible(DeckUI.tdAlertsHtml(DeckUI.tdNeeds(okNeeds), today, { count: 0, names: [] }, c.miss).html);
  assert.match(words, /Some checks did not report Cluster/);
  assert.match(src.slice(end), /const tdGet=p=>DeckPages\.get\(p,\{shape:d=>DeckUI\.tdShape\(p,d\)\}\)\.then\(DeckUI\.tdFeed,/, 'every Today read goes through the bounded, shared shape-checked get');
  assert.match(src.slice(end), /function tdRead\(k,p,tick,was\)\{[^\n]*\n return DeckPages\.get\(p,\{shape:d=>DeckUI\.tdShape\(p,d\)\}\)\.then\(r=>\{[^\n]*DeckUI\.tdFeed\(r\)\},\(\)=>\{TDS\.got\[k\]=null;return \{error:'no answer'\}\}\)\}/, 'the sliced reader uses the same nested validators');
});

// ---- the Almanac way in (2026-11-15): Life's Almanac tile left with the redesign; Today keeps exactly one way in on every day. Since the
// restore the way in is the On this day sheet (the tile, or the quiet row on a day without photos), and the sheet holds the one link. ----
const almHrefs = (html) => (html.match(/href="[^"]*"/g) || []).filter((h) => /almanac/i.test(h));
const openers = (html) => (html.match(/data-open="today-day"/g) || []).length;
test('Almanac: the On this day tile opens the On this day sheet; no extra row beside it', () => {
  const g = DeckUI.tdGlance(glanceAll);
  assert.match(g.html, /<button type="button" data-open="today-day" class="tile tv-hide" data-key="onthisday">/);
  assert.equal(openers(g.html), 1, 'one way in, not two');
  assert.doesNotMatch(g.html, /href=/, 'the page itself never leaves the deck');
  assert.doesNotMatch(g.html, /Your history, 2006 to now/);
});

test('Almanac: with zero photos or the photo feed missing, one quiet row opens the same sheet and never reaches the TV board', () => {
  for (const od of [{ total: 0, years: [] }, { error: 'file missing' }, null, { status: 'not_reporting' }]) {
    const g = DeckUI.tdGlance({ ...glanceAll, onthisday: od });
    assert.ok(!g.tiles.some((t) => t.key === 'onthisday'), JSON.stringify(od));
    assert.equal(openers(g.html), 1, JSON.stringify(od));
    assert.match(g.html, /<div class="flist tv-hide td-alm"><button type="button" class="frow" data-open="today-day"><span class="fl"><b>Almanac<\/b><small>Your history, 2006 to now<\/small>/);
    assert.equal(g.tv, true, 'the board itself does not change: the home spot stays');
  }
});

test('Almanac: the sheet holds the one link, a fixed same-origin path, never a host, a port or a feed value', () => {
  const hostile = { total: 3, years: [{ year: 2020, count: 3 }], path: 'https://evil.example:8795/', url: 'http://127.0.0.1:8795/almanac/', link: '//evil.example/' };
  const alm = { now: { date: '2026-11-14', weekday: 'Saturday', month: 'November', day_of_year: 318 }, url: 'https://evil.example/', link: 'http://127.0.0.1:8795/' };
  for (const html of [DeckUI.tdDaySheet(alm, hostile, null), DeckUI.tdDaySheet({ error: 'http 502' }, null, null), DeckUI.tdDaySheet(null, { error: 'x' }, { error: 'y' })]) {
    assert.deepEqual(almHrefs(html), ['href="/almanac/"'], 'one link, the fixed literal');
    assert.match(html, /<a class="btn" href="\/almanac\/" target="_blank" rel="noopener">Open the Almanac<\/a>/);
    assert.doesNotMatch(html, /8795|http:|evil\.example|\/\/evil/);
  }
  assert.equal(DeckUI.TD_PATHS.almanac, '/almanac/');
  for (const html of [DeckUI.tdGlance({ ...glanceAll, onthisday: hostile }).html, DeckUI.tdGlance({}).html]) assert.doesNotMatch(html, /href=|8795|evil/);
});

// ---- Hockey (2026-11-15): Life's card for every tracked team left with the redesign; the Today tile now opens a sheet with all of them ----
const team = (abbr, name, o) => ({ abbr, name, record: '10-9-1', standing: '3rd Pacific', points: 21, form: 'W-W-L',
  last_game: { opp: 'NYI', score: '2-6', result: 'L', gc: '/gamecenter/nyi-vs-ana/1' }, next_game: { opp: 'CGY', at: T + 86400, home: true, gc: '/gamecenter/cgy-vs-ana/2' }, ...(o || {}) });
const three = { teams: [team('ANA', 'Anaheim Ducks', { next_game: { opp: 'CGY', at: T + 86400, home: true } }), team('LAK', 'Los Angeles Kings', { next_game: { opp: 'SEA', at: T + 3600, home: false, gc: '/gamecenter/lak-vs-sea/3' } }),
  team('SDG', 'San Diego Gulls', { record: '', standing: '', points: null, form: '', last_game: null, next_game: null })], live: [] };
test('Hockey tile: a live game first, else the soonest next game, else the first team with a record; it opens the sheet', () => {
  const soon = DeckUI.tdGlance({ hockey: three, now: NOW }).tiles.find((t) => t.key === 'hockey');
  assert.equal(soon.h, 'Hockey · Los Angeles Kings', 'LAK plays first');
  assert.equal(soon.open, 'today-hockey');
  const live = { ...three, live: [{ home: 'SJS', away: 'LAK', score: '1-2', period: 2, clock: '10:05' }] };
  assert.equal(DeckUI.tdGlance({ hockey: live, now: NOW }).tiles.find((t) => t.key === 'hockey').h, 'Hockey · live');
  const past = { teams: three.teams.map((x) => ({ ...x, next_game: null })), live: [] };
  assert.equal(DeckUI.tdGlance({ hockey: past, now: NOW }).tiles.find((t) => t.key === 'hockey').h, 'Hockey · Anaheim Ducks', 'first team with a record');
  assert.match(DeckUI.tdGlance({ hockey: three, now: NOW }).html, /<button type="button" data-open="today-hockey" class="tile tv-hide" data-key="hockey">/);
});

test('Hockey sheet: every tracked team in feed order, live games first, missing parts say No data, never 0', () => {
  const live = { ...three, live: [{ home: 'SJS', away: 'LAK', score: '1-2', period: 2, clock: '10:05', gc: '/gamecenter/lak-vs-sjs/9' }] };
  const h = DeckUI.tdHockeySheet(live, NOW), w = visible(h);
  assert.ok(w.indexOf('LAK at SJS') < w.indexOf('Anaheim Ducks'), 'live first');
  assert.ok(w.indexOf('Anaheim Ducks') < w.indexOf('Los Angeles Kings') && w.indexOf('Los Angeles Kings') < w.indexOf('San Diego Gulls'), 'feed order');
  assert.match(w, /LAK at SJS Live · Period 2 · 10:05 1-2 SJS first/);
  assert.match(w, /Anaheim Ducks 10-9-1 · 3rd Pacific · 21 pts Last: L 2-6 vs NYI Next: vs CGY · \w{3} \d{1,2}:\d{2} [ap]m Form W-W-L/);
  assert.match(w, /Los Angeles Kings [^]*Next: at SEA/);
  assert.match(w, /San Diego Gulls Record: No data · Standing: No data Last: No data Next: No data/);
  assert.doesNotMatch(w.slice(w.indexOf('San Diego Gulls')), /\b0 pts|Form/);
  assert.ok(h.includes('href="https://www.nhl.com/gamecenter/lak-vs-sea/3"'));
  assert.ok(h.includes('href="https://www.nhl.com/gamecenter/lak-vs-sjs/9"'));
  assert.doesNotMatch(h, /source|nhl schedule|standings/i, 'no source words in the sheet body');
});

test('Hockey: one team, no teams, and the feed missing', () => {
  const one = { teams: [three.teams[0]], live: [] };
  assert.equal((DeckUI.tdHockeySheet(one, NOW).match(/class="frow"/g) || []).length, 1);
  assert.match(visible(DeckUI.tdHockeySheet({ teams: [], live: [] }, NOW)), /No games or standings yet/);
  assert.ok(!DeckUI.tdGlance({ hockey: { teams: [], live: [] }, now: NOW }).tiles.some((t) => t.key === 'hockey'), 'no teams: no tile');
  const g = DeckUI.tdGlance({ hockey: { error: 'file missing' }, now: NOW });
  assert.ok(!g.tiles.some((t) => t.key === 'hockey'));
  assert.deepEqual(g.miss.map((m) => m.name), ['Surf', 'Real estate', 'Shop', 'Hockey', 'Photos on this day', 'Website traffic']);
  assert.match(visible(DeckUI.tdHockeySheet({ error: 'file missing' }, NOW)), /Hockey is not reporting/);
});
