// L2 WebPages (2026-10-29): truthful pages and the new integration tiles. Pure helpers only: no DOM, no network.
// Feeds are fixtures in the shapes of GET /api/testflight, /api/tailscale, /api/deadlines and /api/commerce.monitor (BACKLOG C1, C2).
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '../static', f), 'utf8');
const deck = read('deck.js');
const cut = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b));
const load = () => new Function(cut(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const D = load();
const ops = read('ops.js');
const O = new Function('DeckUI', cut(ops, '// ==== DECK OPS UI BEGIN', '// ==== DECK OPS UI END ====') + '\nreturn DeckOps;')(D);
const sched = read('schedules.js');
const S = new Function('DeckUI', cut(sched, '// ==== SCHEDULES UI HELPERS BEGIN', '// ==== SCHEDULES UI HELPERS END ====') + '\nreturn SchedUI;')(D);

const NOW = Date.UTC(2026, 9, 29, 20, 0, 0);
const T = (s) => NOW / 1000 - s;
const vis = (h) => h.replace(/<span class="diag">[^]*?<\/span>/g, '').replace(/<span class="moreinfo">[^]*?<\/span><\/span>/g, '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const all = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- G3, G4: renewals and deadlines
const dl = (o) => Object.assign({ t: T(120), refresh: 3600, stale: false, src: ['subsradar card', 'paperwork due'], errors: [], renewals: [], paperwork: [] }, o);
const FIX = dl({
  renewals: [{ vendor: 'Figma', date: '2026-10-29', days: 0 }, { vendor: 'Google Cloud billing', date: '2026-11-01', days: 3 }, { vendor: 'Tailscale', date: '2026-11-02', days: 4 }, { vendor: 'Far away', date: '2027-03-01', days: 123 }],
  paperwork: [
    { id: 'pw-a', kind: 'domain', thing: 'velliq.io', date: '2026-10-02', days_left: -27, status: 'expired' },
    { id: 'pw-b', kind: 'domain', thing: 'countymedic.com', date: '2026-11-05', days_left: 7, status: 'due' },
    { id: 'pw-c', kind: 'domain', thing: 'nursebuddy.io', date: '2026-11-24', days_left: 26, status: 'due' },
    { id: 'pw-d', kind: 'insurance', thing: 'Tesla auto insurance', date: '2026-12-07', days_left: 39, status: 'due' },
  ],
});

test('G3/G4: one merged list, expired first then by days, only the next 60 days, no amounts', () => {
  const items = D.dlItems(FIX);
  assert.deepEqual(items.map((x) => x.name), ['velliq.io', 'Figma', 'Google Cloud billing', 'Tailscale', 'countymedic.com', 'nursebuddy.io', 'Tesla auto insurance']);
  assert.ok(!items.some((x) => x.name === 'Far away'), '123 days is outside the window');
  const h = D.tdDeadlines(FIX).html, t = vis(h);
  assert.match(t, /^Renewals and deadlines velliq\.io Oct 2 27 days late Figma Oct 29 Today Google Cloud billing Nov 1 3 days/);
  assert.match(t, /nursebuddy\.io Nov 24 26 days 1 more 4 more$/, 'six rows, then one row for the rest; a phone shows three and its own count');
  assert.doesNotMatch(h, /\$|usd|amount/i);
  assert.doesNotMatch(t, /Updated|ago|Now|Soon|Later/, 'no age and no severity words in the section');
});

test('G3/G4: the same vendor and date from both sources is one row; a long list says how many more', () => {
  const dup = dl({ renewals: [{ vendor: 'Velliq.io', date: '2026-10-02', days: -27 }], paperwork: [{ id: 'x', kind: 'domain', thing: 'velliq.io', date: '2026-10-02', days_left: -27, status: 'expired' }] });
  assert.equal(D.dlItems(dup).length, 1);
  const many = dl({ renewals: Array.from({ length: 15 }, (_, i) => ({ vendor: 'V' + i, date: '2026-11-0' + (1 + (i % 9)), days: 3 + i })) });
  const h = D.tdDeadlines(many).html;
  assert.match(vis(h), /\b9 more 12 more$/);
  assert.match(h, /data-open="today-dead"/);
});

test('G3/G4 (v3): renewals stay in their own section; Needs you never repeats them', () => {
  const n = D.tdNeeds({ products: { t: T(60), refresh: 300, errors: [], needs: [] }, testflight: { apps: [] }, schedules: { groups: [] }, today: { gateway: { ok: true }, mail: { mailboxes: [] } }, replyblock: { counts: { drafted: 0 } } });
  assert.deepEqual(n.items, []);
  assert.match(vis(D.tdNeedsHtml(n, [])), /Nothing needs you/);
  assert.ok(D.tdDeadlines(FIX).items.some((x) => x.name === 'velliq.io'));
});

test('G3/G4: a failed source joins the checks row with its plain name; the other source keeps its rows; a missing feed is no section', () => {
  const bad = dl({ paperwork: [], errors: [{ source: 'paperwork', reason: 'paperwork due timed out after 30 s' }, { source: 'subsradar', reason: 'card.json missing' }], renewals: [{ vendor: 'Figma', date: '2026-10-29', days: 0 }] });
  const r = D.tdDeadlines(bad);
  assert.deepEqual(r.miss.map((m) => m.name), ['Paperwork deadlines', 'Subscription renewals']);
  assert.doesNotMatch(r.html, /timed out|card\.json|frow err/);
  assert.match(vis(r.html), /Figma/);
  assert.equal(D.tdDeadlines(dl({})).html, '');
  assert.equal(D.tdDeadlines(null).html, '');
  assert.deepEqual(D.tdDeadlines({ error: 'file missing' }).miss.map((m) => m.name), ['Renewals and deadlines']);
});

test('Your decisions with extras sorts Now before Soon before Later, owner decisions first inside a level; without extras the feed order stays', () => {
  const p = { t: T(60), refresh: 300, stale: false, errors: [], needs: [
    { text: 'Reconnect 7 links', sev: 'low', source: 'accounts.json' },
    { text: 'Answer App Review', sev: 'high', source: 'app store connect', owner: 'owner' }, { text: 'Attach build 72', sev: 'med', source: 'app store connect', owner: 'owner' }] };
  const base = vis(D.needRows(p, 6));
  assert.ok(base.indexOf('Answer App Review') < base.indexOf('Attach build 72'));
  const h = vis(D.needRows(p, 6, 'on Home', [{ text: 'velliq.io expired 27 d ago', sev: 'high', noOpen: true, source: 'paperwork' }]));
  assert.ok(h.indexOf('Answer App Review') < h.indexOf('velliq.io expired'), 'owner decision first at the same level');
  assert.ok(h.indexOf('velliq.io expired') < h.indexOf('Attach build 72'));
  assert.match(vis(D.needRows(p, 2, 'on Home', [{ text: 'x', sev: 'high', noOpen: true }])), /2 more on Home/);
});

// ---------------------------------------------------------------- G1: App builds
const app = (o) => Object.assign({ id: '6786588606', name: 'Mesh for Small Business', checked_at: '2026-10-29T20:00:00.000Z', error: null,
  latest_build: { number: '72', version: '1.3.1', uploaded_at: '2026-10-29T17:45:02+00:00', processing_state: 'VALID', expired: false, internal_state: 'IN_BETA_TESTING', external_state: 'IN_BETA_TESTING' },
  feedback: { screenshots_count: 114, crashes_count: 7, last_received_at: '2026-10-28T03:22:32.685Z' },
  versions: [{ version: '1.3.1', state: 'PREPARE_FOR_SUBMISSION', submission_state: 'UNRESOLVED_ISSUES', build: '71', submitted_at: '2026-10-25T07:20:26Z' }] }, o);
const okApp = (n, o) => app(Object.assign({ id: '68' + String(n).padStart(8, '0'), name: 'App ' + n, feedback: { screenshots_count: 0, crashes_count: 0, last_received_at: null },
  versions: [{ version: '1.0', state: 'WAITING_FOR_REVIEW', submission_state: 'WAITING_FOR_REVIEW', build: '4', submitted_at: null }] }, o || {}));
const TF = (apps, o) => Object.assign({ t: T(60), refresh: 300, stale: false, src: ['app store connect api'], errors: [], apps }, o);

test('G1: processing, a bad build and an expired build read as their own state words', () => {
  const st = (b, vs) => D.tfState(okApp(1, { latest_build: Object.assign({ number: '1', version: '1.0', processing_state: 'VALID' }, b), versions: vs || [] }));
  assert.equal(st({ processing_state: 'PROCESSING' }).word, 'Processing');
  assert.equal(st({ processing_state: 'INVALID' }).k, 'bad');
  assert.equal(st({ expired: true }).word, 'Build expired');
  assert.equal(st({}, [{ state: 'IN_REVIEW' }]).word, 'In review');
  assert.equal(st({}, [{ state: 'PREPARE_FOR_SUBMISSION', submission_state: 'COMPLETE' }]).word, 'In prep');
  assert.equal(st({}, [{ state: 'REJECTED' }]).issue, 'REJECTED');
  assert.equal(D.tfState({ latest_build: null, versions: [] }).word, 'No build');
});

test('G1: UNRESOLVED_ISSUES is a Now row in Your decisions, worded as the owner step (B1), once per app, with the App Store Connect page', () => {
  const tf = TF([app(), app({ id: '6753701850', name: 'JudgeFinder.io' }), okApp(1), okApp(2, { error: 'x', versions: [] })]);
  const n = D.tfNeeds(tf);
  assert.deepEqual(n.map((x) => x.text), ['Answer App Review for Mesh for Small Business', 'Answer App Review for JudgeFinder.io']);
  assert.ok(n.every((x) => x.sev === 'high'));
  assert.equal(n[0].url, 'https://appstoreconnect.apple.com/apps/6786588606/distribution');
  assert.equal(n[0].why, 'App Review has open issues \u00B7 Version 1.3.1 \u00B7 submitted build 71');
  assert.equal(n[0].app, 'Mesh for Small Business');
  // a rejection and a pulled-back version name their own step
  assert.equal(D.tfNeeds(TF([app({ versions: [{ version: '1.0', state: 'REJECTED', build: '4' }] })]))[0].text, 'Reply to the App Review rejection for Mesh for Small Business');
  assert.equal(D.tfNeeds(TF([app({ versions: [{ version: '1.0', state: 'DEVELOPER_REJECTED', build: '4' }] })]))[0].text, 'Resubmit Mesh for Small Business for App Review');
  // Today v3: a products decision that names the app is not repeated; the app it does not name is its own step with the App Store Connect page
  const needs = { products: { t: T(60), refresh: 300, errors: [], needs: [{ owner: 'owner', sev: 'high', text: 'Answer App Review for JudgeFinder.io 1.0' }] }, testflight: tf, schedules: { groups: [] }, today: { gateway: { ok: true }, mail: { mailboxes: [] } }, replyblock: { counts: { drafted: 0 } } };
  const nn = D.tdNeeds(needs);
  assert.deepEqual(nn.items.map((x) => x.text), ['Answer App Review for JudgeFinder.io 1.0', 'Answer App Review for Mesh for Small Business']);
  const h = D.tdNeedsHtml(nn);
  assert.equal((vis(h).match(/JudgeFinder\.io/g) || []).length, 1);
  assert.match(h, /href="https:\/\/appstoreconnect\.apple\.com\/apps\/6786588606\/distribution"/);
  assert.deepEqual(D.tfNeeds(null), []);
});

// ---------------------------------------------------------------- G2, WG4, D6: Network
const ts = (o) => Object.assign({ t: T(90), refresh: 300, stale: false, errors: [], counts: { own_devices: 14, own_online: 9, funnel_public: 4, warn: 4, crit: 0 },
  alerts: [{ host: 'pc-desktop', kind: 'funnel_public', msg: 'PUBLIC internet via Funnel', severity: 'warn' }],
  exposures: [{ host: 'pc-desktop', port: '10452', path: '/', proto: 'https', funnel: true }, { host: 'pc-desktop', port: '443', path: '/', proto: 'https', funnel: true }, { host: 'pc-desktop', port: '443', path: '/gt', proto: 'https', funnel: true },
    { host: 'pc-desktop', port: '443', path: '/p/review', proto: 'https', funnel: true }, { host: 'pc-desktop', port: '10443', path: '/', proto: 'https', funnel: false }],
  nodes: [{ name: 'dell', host: 'mesh', online: true, last_seen_h: null, os: 'linux', kind: 'own' }, { name: 'grok-bot-box', host: 'grok-bot-box', online: false, last_seen_h: 69.5, os: 'linux', kind: 'own' },
    { name: 'mac-pro', host: 'desktop', online: false, last_seen_h: 70.1, os: 'macOS', kind: 'own' }, { name: 'grok-bot-box-2', host: 'grok-bot-box', online: false, last_seen_h: 0.6, os: 'linux', kind: 'own' }] }, o);
const ha = (a, b) => ({ entities: { 'binary_sensor.internet_reachable': { state: a, unit: '', updated: 1 }, 'binary_sensor.router_reachable': { state: b, unit: '', updated: 1 } } });

test('G2/WG4/D6: online count, stale nodes, internet and router, and every public Funnel path as a warn row', () => {
  const h = O.network(ts(), ha('on', 'on'), NOW), t = text(h);
  assert.match(t, /^Network House network/, 'design v3: the title carries no age');
  assert.match(t, /House network Internet up \u00B7 Router up Tailnet devices/);
  assert.match(t, /Tailnet devices 9 of 14 online 3 devices off: mac-pro \(3 d\), grok-bot-box \(3 d\), grok-bot-box-2 \(1 h\)/);
  assert.match(t, /4 public Funnel paths: confirm with Tanner/);
  assert.match(t, /pc-desktop port 10452 \//);
  assert.match(t, /pc-desktop port 443 \/gt/);
  assert.match(t, /pc-desktop port 443 \/p\/review/);
  assert.doesNotMatch(t, /10443/, 'a tailnet-only exposure is not listed as public');
  assert.match(h, /class="frow stale"/);
  assert.match(h, /pill warn/);
  assert.doesNotMatch(h, /<button|<a |onclick|\d+\.\d+\.\d+\.\d+/, 'read only: no controls, no IPs');
});
function text(h) { return h.replace(/<span class="diag">[^]*?<\/span>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

test('G2/WG4/D6: down internet is a failure, missing router or Home Assistant is "not reported", a failed snapshot says so', () => {
  assert.match(O.network(ts(), ha('off', 'on'), NOW), /tile bad/);
  assert.match(text(O.network(ts(), ha('off', 'on'), NOW)), /Internet down \u00B7 Router up/);
  assert.match(text(O.network(ts(), { entities: { 'binary_sensor.internet_reachable': { state: 'unavailable' } } }, NOW)), /Internet not reported \u00B7 Router not reported No reading for either yet/);
  assert.match(text(O.network(ts(), { error: 'HA down' }, NOW)), /Internet not reported/);
  const failed = O.network({ error: 'http 405' }, ha('on', 'on'), NOW);
  assert.match(text(failed), /^Network House network/);
  assert.match(text(failed), /Tailnet snapshot is not reporting/);
  assert.match(text(failed), /Internet up/, 'the house half still reads');
  assert.match(text(O.network(null, null, NOW)), /Tailnet snapshot is not reporting/);
});

test('G2/WG4/D6: zero Funnel paths says none; a snapshot without the count says it is not reported; a crit alert is a red row', () => {
  assert.match(text(O.network(ts({ counts: { own_devices: 3, own_online: 3, funnel_public: 0, warn: 0, crit: 0 }, exposures: [], alerts: [], nodes: [] }), ha('on', 'on'), NOW)), /No public Funnel paths Nothing on the tailnet is open to the public internet\./);
  assert.match(text(O.network(ts({ counts: {}, exposures: undefined }), ha('on', 'on'), NOW)), /Tailnet devices Not reported .*Funnel paths not reported/);
  const crit = O.network(ts({ counts: { own_devices: 3, own_online: 2, funnel_public: 0, warn: 0, crit: 1 }, exposures: [], alerts: [{ host: 'dell', kind: 'x', msg: 'key expired', severity: 'crit' }] }), ha('on', 'on'), NOW);
  assert.match(crit, /frow bad/);
  assert.match(text(crit), /dell: needs a look key expired/);
  assert.ok(typeof O.stalls === 'function', 'the stall watch is still exported');
});

// ---------------------------------------------------------------- D3: honest empty states
test('D3: an unavailable cartridge reads Printer offline with the last-seen age; the Today tile agrees', () => {
  const h = D.inkTile('Black', { state: 'unavailable', updated: T(5 * 3600) }, NOW);
  assert.match(vis(h), /Black ink Printer offline Last seen 5 h ago/);
  assert.doesNotMatch(vis(h), /No reading/);
  assert.match(vis(D.inkTile('Color', { state: 'unavailable' }, NOW)), /Printer offline Never seen/);
  assert.match(D.inkTile('Black', { state: '40', updated: T(60) }, NOW), /<div class="v">40%<\/div>/);
});

// ---------------------------------------------------------------- W6: collapse repeats (Money > Accounts, deck v3)
const finApp = (i, o) => Object.assign({ id: 'app' + i, name: 'App ' + i, kind: ['bank', 'shopping', 'other'][i % 3], route: 'iphone_screen', status: 'never', last_ok: null, age: null, has_values: false }, o);
const finFeed = (apps) => ({ t: T(60), refresh: 3600, stale: false, errors: [], sample: false, has_totals: false, apps, inventory: { installed: 185, finance_related: 14, covered: 0, t: T(60) } });

test('W6: never-captured apps are one line that opens the Data sheet; captured apps stay rows; the page stays short', () => {
  const apps = Array.from({ length: 34 }, (_, i) => finApp(i)).concat([finApp(100, { status: 'ok', last_ok: T(600), has_values: true, kind: 'bank' })]);
  const h = D.finPage(finFeed(apps), NOW, null);
  assert.equal((h.match(/data-app="/g) || []).length, 1, 'only the captured app is a row');
  assert.match(h, /<button type="button" class="frow" data-sheet="data"><span class="fl"><b>34 apps<\/b><small>Bank, Shopping, Other<\/small>/);
  assert.ok(h.length < 2500, 'one line for 34 apps, not 34 cards');
  const setup = D.finData(finFeed(apps), NOW).setup;
  assert.match(setup.find((s) => /not captured yet/.test(s.name)).line, /^App 0, App 1, App 2/);
  // a never app that has values is a row, never folded
  const withValues = D.finPage(finFeed(Array.from({ length: 25 }, (_, i) => finApp(i, i < 3 ? { has_values: true } : {}))), NOW, null);
  assert.equal((withValues.match(/data-app="/g) || []).length, 3);
  assert.match(vis(withValues), /22 apps/);
});

// ---------------------------------------------------------------- W6: Homes caps (now Markets > Housing), W10
const src = (name, n, o) => Object.assign({ name, kind: 'market_statistics', status: 'ok', coverage: 'c', checked_at: T(60), records: Array.from({ length: n }, (_, i) => ({ zip: String(90000 + i), state: 'CA', city: 'C' + i, metric: 'ZHVI', value: 1000 + i, currency: 'USD', as_of: '2026-09-30' })) }, o || {});
const homesFeed = (sources) => ({ t: T(30), src: 'x', stale: false, errors: [], homes: [], commercial: [], market: { feed_sources: { checked_at: T(60), scope: { country: 'US', states: ['CA', 'TX'], districts: ['DC'] }, sources } } });

// 2026-11-01, owner order: the national housing price records block (source summary, State and ZIP controls, per-source records) is gone
// from the housing view. This replaces the W6 records-paging and W11 filter-control tests that pinned it.
test('Housing: the national price records block, its controls and its records toggle are gone', () => {
  const f = homesFeed([src('A', 20), src('B', 20), src('C', 20), src('D', 20), src('E', 5)]);
  for (const h of [D.homes(f, NOW, { page: 'short' }), D.homes(f, NOW, { page: 'all' }), D.homes(f, NOW)]) {
    assert.doesNotMatch(h, /matching records|housing-filters|data-housing-state|data-housing-zip|data-housing-apply|Show more records|Source health and coverage|Housing source adapters/);
  }
});

test('W10: market area rows are .frow so the name sits left and the numbers right', () => {
  const area = { slug: 'zip-92629', name: 'Dana Point', tier: 'home', level: 'zip', zip: '92629', zhvi: { value: 1780453.5, as_of: '2026-09-30', yoy_pct: 4.12 }, active_listings: 61 };
  const h = D.homes({ t: T(30), src: 'x', stale: false, errors: [], homes: [], commercial: [], market: { residential: { areas_with_zhvi: 1, scope: { home: 'Dana Point, CA' }, areas: [area] } } }, NOW);
  assert.match(h, /<div class="hm-area frow"><span class="fl"><b>Dana Point/);
  assert.match(h, /<span class="fr"><b>\$1\.78M<\/b>/);
  const legacy = D.homes({ t: T(30), src: 'x', stale: false, errors: [], homes: [], commercial: [], market: { area: 'Dana Point', median_list_price: 1900000, at: T(100) } }, NOW);
  assert.match(legacy, /<div class="hm-area frow">/);
});

// ---------------------------------------------------------------- W15, W25, I19
test('W15: Market news lives in Money > Markets Headlines, not in deck.js', () => {
  assert.equal(D.markets, undefined);
  assert.match(read('invest.js'), /sect\('Headlines'/);
});

test('I19: the comments state the real shell rule for target=_blank', () => {
  assert.doesNotMatch(deck, /cancels every target=_blank navigation|cancels target=_blank links/);
  assert.match(deck, /loads a same-origin _blank link in place and sends an off-origin _blank link to Safari/);
  assert.match(deck, /loads same-origin target=_blank links in place and opens off-origin ones in Safari/);
});

// ---------------------------------------------------------------- glue wiring (the page reads the new feeds)
test('glue: Today reads deadlines, testflight and the reply block, Dev reads testflight and rank watch, Fleet reads tailscale and ha', () => {
  assert.match(deck, /testflight:'testflight'.*deadlines:'deadlines'/s);
  assert.match(deck, /replyblock:'replyblock'/);
  assert.match(deck, /const devLoad=\(\)=>once\('dev',async\(\)=>\{\[DEV\.d,DEV\.tf,DEV\.rw\]=await Promise\.all\(\[feedGet\('dev'\),feedGet\('testflight'\),feedGet\('rankwatch'\)\]\)/);
  assert.match(ops, /opGet\('\/api\/tailscale'\),opGet\('\/api\/ha'\)/);
  assert.match(ops, /DeckOps\.network\(OP\.t,OP\.h,Date\.now\(\)\)/);
  // no markup or CSS lives in this lane: the section titles stay as .secttl first spans (C6)
  assert.match(D.tdDeadlines(FIX).html, /<h2 class="secttl"><span>Renewals and deadlines<\/span>/);
  assert.match(O.network(ts(), ha('on', 'on'), NOW), /<div class="secttl"><span>Network<\/span>/);
});

