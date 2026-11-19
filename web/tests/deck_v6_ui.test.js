// node --test tests/  (v6 page renderers from static/deck.js; no DOM, no network, fixed clock)
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const a = src.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const b = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
assert.ok(a >= 0 && b > a, 'helper block markers present');
// same realm as the test, so deepEqual compares plain arrays and objects; the block still sees no DOM
const D = new Function(src.slice(a, b) + '\nreturn DeckUI;')();

const NOW = Date.UTC(2026, 9, 1, 4, 0, 0);
const T = (agoS) => NOW / 1000 - agoS;
const feed = (o) => Object.assign({ src: '~/.meshvault/status/deck/x.json', t: T(30), age: 30, stale: false, refresh: 60, sources: [], errors: [] }, o);
const missing = (name) => ({ error: 'file missing', src: '~/.meshvault/status/deck/' + name + '.json', stale: true });

// what a person reads: diagnostic spans and tags removed
const vis = (h) => String(h).replace(/<span class="diag">[\s\S]*?<\/span>/g, ' ').replace(/<[^>]+>/g, ' ');
test('fmt: null is never zero, a measured zero stays zero', () => {
  for (const v of [null, undefined, NaN, Infinity, '5', {}]) assert.equal(D.fmt(v), '--');
  assert.equal(D.fmt(0), '0');
  assert.equal(D.fmt(0, 0, '%'), '0%');
  assert.equal(D.fmt(3.14159, 1, ' GB'), '3.1 GB');
});

test('line: source and age on every feed, STALE and failed parts named', () => {
  assert.equal(D.line(feed({ src: '~/.meshvault/status/deck/cluster.json' }), NOW), 'Updated just now');
  assert.equal(D.line(feed({ stale: true, t: T(7200) }), NOW), 'Out of date \u00B7 Updated 2 h ago');
  assert.equal(D.line(feed({ t: T(150) }), NOW), 'Updated 3 min ago');
  assert.equal(D.line(missing('dev'), NOW), 'Nothing has been collected yet. It fills in after the next refresh.');
  assert.equal(D.line(null, NOW), 'The deck did not answer. Check your connection, then try again.');
  assert.deepEqual([D.state(null), D.state(missing('x')), D.state(feed({ stale: true })), D.state(feed())], ['bad', 'bad', 'stale', 'ok']);
});

test('cluster: missing feed is one unavailable tile, live data renders with units', () => {
  const down = D.cluster(missing('cluster'), NOW);
  assert.match(down[0], /es es-bad/);
  assert.match(down[0], /Nothing has been collected yet/);
  assert.match(down[0], /class="diag">file missing</);
  const f = feed({
    src: '~/.meshvault/status/deck/cluster.json',
    engine: { served_name: 'glm-5.3-flash', status: 'up', max_model_len: 1048576, port: 8000, container: 'vllm_glm53', up_since: T(3600), lock_model: 'glm' },
    nodes: [{ name: 'spark', lan_ip: '198.51.100.12', reachable: true, mem_used_gb: 120, mem_total_gb: 128, gpu_temp_c: 61, gpu_util_pct: 0, power_w: null, load1: 1.5, uptime_s: 864000, containers: ['vllm_glm53'] },
      { name: 'ascent', lan_ip: '198.51.100.11', reachable: false }],
    bench: { prose_tps: 23, code_tps: 34, conc6_tps: 70, prefill_tps: null, at: '2026-09-30', source: 'RESULTS.md' },
    ratchet: { last_date: '2026-09-30', last_step: 'mnbt 4096', last_outcome: 'accepted', next_run: T(-3600) },
    candidates: [{ name: 'qwen-uncensored', path: '/x', size_gb: 61.2, format: 'gguf', status: 'downloaded' }, { name: 'bad', status: 'rejected' }],
    proxy: { pc_desktop_8080_up: true, models: ['glm'] },
  });
  const [c1, c2, c3] = D.cluster(f, NOW);
  assert.match(c1, /<div class="h"><i class="sd ok"><\/i>Model<\/div><div class="v w">glm-5\.3-flash<\/div><div class="t">Running \u00B7 up 60 min<\/div>/);
  // the benchmarks are a figure list with units under the strip (V13); an unmeasured one is left out, never 0
  assert.match(c1, /<b>Coding<\/b><\/span><span class="fr"><b class="fig">34\.0<\/b><small>tok\/s<\/small>/);
  assert.doesNotMatch(c1, /Prefill/);
  assert.match(c1, /next in 60 min/);
  // the bar is memory and says so (V12); GPU, temperature and power on the line under it, 0% stays 0 and unknown power is --
  assert.match(c2, /<div class="v">Memory 94%<\/div><div class="bar"><i style="width:93\.75%"><\/i><\/div>/);
  assert.match(c2, /120 of 128\u00A0GB \u00B7 GPU\u00A00%\u00A0busy \u00B7 61\u00B0C \u00B7 --/);
  assert.match(D.cluster(feed({ engine: { status: 'up' }, nodes: [{ name: 's', reachable: true, gpu_temp_c: 60, gpu_util_pct: 5, power_w: 12 }] }), NOW)[1], /GPU\u00A05%\u00A0busy \u00B7 60\u00B0C \u00B7 12\u00A0W/, '"12" never breaks from "W"');
  // a node whose probe failed is Down with the crossed square; one with no reading is Not reported with the dash (R1)
  assert.match(c2, /<i class="sd bad"><\/i>ascent<\/div><div class="v">Down<\/div>/);
  assert.match(D.cluster(feed({ engine: { status: 'up' }, nodes: [{ name: 'n' }] }), NOW)[1], /<i class="sd off"><\/i>n<\/div><div class="v">Not reported<\/div>/);
  assert.match(c3, /61\.2\u00A0GB/);
  assert.match(c3, /pill bad">Rejected/);
});

const LAUNCH = feed({
  src: '~/.meshvault/status/deck/launch.json',
  items: [
    { id: 'skill:fleet-audit', kind: 'skill', name: 'fleet-audit', desc: 'Read-only fleet audit', group: 'fleet', targets: ['omp', 'hermes'], arg: 'fleet-audit' },
    { id: 'command:deck-audit', kind: 'command', name: 'Deck audit', desc: 'Audit the deck', group: 'Deck', targets: ['hermes', 'evil'], arg: 'deck-audit' },
    { id: 'automation:deck-feed-jobs.timer', kind: 'automation', name: 'deck-feed-jobs.timer', targets: [], arg: 'deck-feed-jobs.timer' },
    { id: 'mcp:<b>x', kind: 'mcp', name: '<img src=x onerror=alert(1)>', targets: ['omp'], arg: 'x' },
    { id: 'junk', kind: 'weird', name: 'drop me' },
    'not an object',
  ],
});

test('launch: items keep known kinds only, targets limited to hermes (OMP retired in v8)', () => {
  const items = D.launchItems(LAUNCH);
  assert.equal(items.length, 4);
  assert.deepEqual(items.find((x) => x.kind === 'command').targets, ['hermes']);
  assert.deepEqual(items.find((x) => x.id === 'skill:fleet-audit').targets, ['hermes']);
  assert.deepEqual(items.find((x) => x.kind === 'mcp').targets, []); // was OMP only: stays listed, view only
  assert.deepEqual(D.launchItems(missing('launch')), []);
  // a feed from before plain names: no label, no area, nothing earns, nothing breaks
  const old = items.find((x) => x.id === 'skill:fleet-audit');
  assert.deepEqual([old.label, old.does, old.area, old.ao, old.earns], ['', '', '', null, false]);
  assert.deepEqual(D.launchFacets(items).area, []);
});

test('launch filter: commands first, every word must match, kind chip narrows, limit reports total', () => {
  const items = D.launchItems(LAUNCH);
  assert.deepEqual(D.launchFilter(items, '', 'all').rows.map((x) => x.kind), ['command', 'skill', 'mcp', 'automation']);
  assert.deepEqual(D.launchFilter(items, 'AUDIT', 'all').rows.map((x) => x.id), ['command:deck-audit', 'skill:fleet-audit']);
  assert.deepEqual(D.launchFilter(items, 'audit fleet', 'all').rows.map((x) => x.id), ['skill:fleet-audit']);
  assert.deepEqual(D.launchFilter(items, 'audit', 'skill').rows.map((x) => x.id), ['skill:fleet-audit']);
  const r = D.launchFilter(items, '', 'all', 2);
  assert.equal(r.rows.length, 2);
  assert.equal(r.total, 4);
});
test('launch result: run id for Hermes, plain error otherwise', () => {
  assert.deepEqual(D.launchResult({ ok: true, target: 'hermes', run_id: 'run_abc', status: 'started', name: 'Deck audit' }),
    { k: 'ok', text: 'Started in Hermes \u00B7 Deck audit' });
  assert.doesNotMatch(D.launchResult({ ok: true, target: 'hermes', run_id: 'run_abc', name: 'x' }).text, /OMP|Herdr|run_abc/);
  assert.deepEqual(D.launchResult({ ok: false, error: 'rate limited', retry_s: 4 }), { k: 'bad', text: 'Too many tries. Wait 4 s, then try again.' });
  assert.equal(D.launchResult(null).k, 'bad');
});

// ---- plain names, one-line descriptions and areas (feed fields label, does, area, ao, earns) ----
const NAMED = feed({
  src: '~/.meshvault/status/deck/launch.json',
  items: [
    { id: 'skill:mkt', kind: 'skill', name: 'deck-feed-markets', label: 'Market prices', does: 'Updates stock and crypto prices on your Deck every 5 minutes.', area: 'Behind the scenes', ao: 6, earns: false, tier: 'core', score: 90, targets: ['hermes'], where: ['hermes'] },
    { id: 'skill:cold', kind: 'skill', name: 'meshvault-cold-email-pipeline', label: 'Cold email outreach', does: 'Finds prospects and drafts cold emails for you to approve.', area: 'Revenue', ao: 0, earns: true, tier: 'useful', score: 60, targets: ['hermes'], where: ['hermes'] },
    { id: 'skill:bills', kind: 'skill', name: 'finance-alerts-ops', label: 'Bill and money alerts', does: 'Warns you before bills are due.', area: 'Money', ao: 2, earns: false, tier: 'core', score: 80, targets: ['hermes'], where: ['hermes'] },
    { id: 'skill:gig', kind: 'skill', name: 'gig-lead-sweep', label: 'Gig lead search', does: 'Looks over public job boards for work you can bid on.', area: 'Revenue', ao: 0, earns: true, tier: 'core', score: 70, targets: ['hermes'], where: ['hermes'] },
    { id: 'skill:cam', kind: 'skill', name: 'eufy-cam', label: 'Camera check', does: 'Shows what the cameras saw.', area: 'Home', ao: 4, tier: 'niche', score: 30, targets: ['hermes'], where: ['hermes'] },
    { id: 'skill:odd', kind: 'skill', name: 'odd-thing', desc: 'Does a thing', tier: 'useful', score: 40, targets: ['hermes'], where: [] },
  ],
});

test('launch names: label, does, area, ao and earns come through, trimmed to their limits', () => {
  const items = D.launchItems(NAMED);
  const m = items.find((x) => x.id === 'skill:mkt');
  assert.deepEqual([m.label, m.does, m.area, m.ao, m.earns], ['Market prices', 'Updates stock and crypto prices on your Deck every 5 minutes.', 'Behind the scenes', 6, false]);
  assert.equal(items.find((x) => x.id === 'skill:cold').earns, true);
  const long = D.launchItems({ items: [{ id: 'skill:l', kind: 'skill', name: 'l', label: 'L'.repeat(60), does: 'D'.repeat(200), area: 'A'.repeat(60), ao: 3, earns: 'yes' }] })[0];
  assert.deepEqual([long.label.length, long.does.length, long.area.length, long.earns], [32, 90, 24, false]); // earns is true only when the feed says true
  assert.equal(D.launchItems({ items: [{ id: 'skill:n', kind: 'skill', name: 'n', ao: 2 }] })[0].ao, null); // an order with no area name means nothing
});

test('launch areas: shown in the feed order whatever order the items arrive in (regression: Revenue first)', () => {
  const items = D.launchItems(NAMED);
  assert.deepEqual(D.launchAreas(items).map((a) => a.area + ':' + a.n), ['Revenue:2', 'Money:1', 'Home:1', 'Behind the scenes:1']);
  assert.deepEqual(D.launchAreas(items.slice().reverse()).map((a) => a.area), ['Revenue', 'Money', 'Home', 'Behind the scenes']);
  assert.deepEqual(D.launchFacets(items).area.map((a) => a.earns), [true, false, false, false]);
  // a renamed or replaced set follows its own order: nothing is special about a name
  const mine = D.launchItems({ items: [
    { id: 'skill:a', kind: 'skill', name: 'a', area: 'Garage', ao: 1 }, { id: 'skill:b', kind: 'skill', name: 'b', area: 'Sales', ao: 0, earns: true },
    { id: 'skill:c', kind: 'skill', name: 'c', area: 'Extra' }] });
  assert.deepEqual(D.launchAreas(mine).map((a) => a.area), ['Sales', 'Garage', 'Extra']);
});

test('launch list: one chosen area is filtered and groups by tier again', () => {
  const items = D.launchItems(NAMED);
  const r = D.launchFilter(items, '', 'all', 0, { area: 'Revenue' });
  assert.deepEqual(r.rows.map((x) => x.id), ['skill:gig', 'skill:cold']);
  assert.deepEqual(D.launchFilter(items, '', 'all', 0, { area: 'Nowhere' }).rows, []);
});
test('launch search: matches the label, what it does, the raw name and the area; every word must hit', () => {
  const items = D.launchItems(NAMED);
  const ids = (q, o) => D.launchFilter(items, q, 'all', 0, o).rows.map((x) => x.id).sort();
  assert.deepEqual(ids('market prices'), ['skill:mkt']);          // the label
  assert.deepEqual(ids('MONEY ALERTS'), ['skill:bills']);         // another case, words apart
  assert.deepEqual(ids('bid on'), ['skill:gig']);                 // what it does
  assert.deepEqual(ids('deck-feed-markets'), ['skill:mkt']);      // the raw name still works
  assert.deepEqual(ids('revenue'), ['skill:cold', 'skill:gig']);  // the area
  assert.deepEqual(ids('earns money'), []);                      // the marker is a pill, not search text: "money" does not find every revenue row
  assert.deepEqual(ids('money'), ['skill:bills']);               // only the Money area's own rows (label and area say money)
  assert.deepEqual(ids('revenue outreach'), ['skill:cold']);
  assert.deepEqual(ids('revenue cameras'), []);
  // a hit on the label ranks above a hit only in the sentence, inside the same area and tier
  const two = D.launchItems({ items: [
    { id: 'skill:s', kind: 'skill', name: 'zeta', label: 'Zeta tracker', does: 'Keeps your alpha numbers in one place.', area: 'Home', ao: 4, tier: 'useful', score: 50 },
    { id: 'skill:l', kind: 'skill', name: 'yota', label: 'Alpha tracker', does: 'Keeps your numbers in one place.', area: 'Home', ao: 4, tier: 'useful', score: 50 }] });
  assert.deepEqual(D.launchFilter(two, 'alpha', 'all').rows.map((x) => x.id), ['skill:l', 'skill:s']);
});

test('launch search: best match first whatever the area, one flat list with no group headers; browsing keeps areas in order', () => {
  const items = D.launchItems({ items: [
    { id: 'skill:r', kind: 'skill', name: 'r', label: 'Weekly email report', does: 'Sends the weekly report.', area: 'Sales', ao: 0, tier: 'core', score: 90 },
    { id: 'skill:h', kind: 'skill', name: 'h', label: 'Email', does: 'Reads your mail.', area: 'Personal', ao: 1, tier: 'niche', score: 10 },
    { id: 'skill:q', kind: 'skill', name: 'q', label: 'Quick email check', does: 'Checks mail.', area: 'Personal', ao: 1, tier: 'useful', score: 20 }] });
  const res = D.launchFilter(items, 'email', 'all');
  assert.deepEqual(res.rows.map((x) => x.id), ['skill:h', 'skill:r', 'skill:q']); // exact start of the label first, then the rest by area and tier
  assert.deepEqual(res.rows.map((x) => x.area), ['Personal', 'Sales', 'Personal'], 'search ranks by match, not by area');
  // two areas that share an order do not interleave: the name breaks the tie
  const tie = D.launchItems({ items: [
    { id: 'skill:1', kind: 'skill', name: '1', area: 'Beta', ao: 3 }, { id: 'skill:2', kind: 'skill', name: '2', area: 'Alpha', ao: 3 },
    { id: 'skill:3', kind: 'skill', name: '3', area: 'Beta', ao: 3 }, { id: 'skill:4', kind: 'skill', name: '4', area: 'Alpha', ao: 3 }] });
  assert.deepEqual(D.launchFilter(tie, '', 'all').rows.map((x) => x.area), ['Alpha', 'Alpha', 'Beta', 'Beta']);
});

test('launch: the shipped front end names no owner, business or area of its own', () => {
  const js = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../static/index.html'), 'utf8');
  const block = js.slice(js.indexOf('// label, does, area, ao'), js.indexOf('function launchResult'));
  const ag = fs.readFileSync(path.join(__dirname, '../static/agents.js'), 'utf8');
  const page = ag.slice(ag.indexOf('const LaunchUI='));
  assert.ok(block.length > 1500 && page.length > 3000, 'slices found');
  for (const [name, text] of [['launch helpers', block], ['launch page', page]]) {
    assert.doesNotMatch(text, /Revenue|Business|Money|Life|Home lab|Behind the scenes|Tanner|Osterkamp|FireDev|MeshVault|Kodros|Hermes Desktop/, name);
  }
  assert.match(page, /data-'\+attr\+'="/);
});
test('launch tiers: core first, unrated before dead, filters by tier and host, grouped by tier', () => {
  const f = { items: [
    { id: 'skill:a', kind: 'skill', name: 'Alpha', targets: ['omp'], tier: 'niche', score: 40, where: ['omp', 'Spark'], why: 'rare' },
    { id: 'skill:b', kind: 'skill', name: 'Bravo', targets: ['omp'], tier: 'core', score: 95, where: ['omp', 'hermes'], why: 'daily driver' },
    { id: 'command:c', kind: 'command', name: 'Charlie', targets: ['hermes'], tier: 'dead', score: 3, where: [] },
    { id: 'mcp:d', kind: 'mcp', name: 'Delta', targets: [], tier: 'bogus', score: 'x' },
    { id: 'skill:e', kind: 'skill', name: 'Echo', targets: ['omp'], tier: 'core', score: 70, where: ['hermes'] } ] };
  const items = D.launchItems(f);
  assert.equal(items.find((x) => x.id === 'mcp:d').tier, 'unrated');
  assert.equal(items.find((x) => x.id === 'mcp:d').score, null);
  assert.deepEqual(D.launchFilter(items, '', 'all').rows.map((x) => x.id), ['skill:b', 'skill:e', 'skill:a', 'mcp:d', 'command:c']);
  assert.deepEqual(D.launchFilter(items, '', 'all', 0, { tier: 'core' }).rows.map((x) => x.id), ['skill:b', 'skill:e']);
  assert.deepEqual(D.launchFilter(items, '', 'all', 0, { where: 'spark' }).rows.map((x) => x.id), ['skill:a']);
  assert.deepEqual(D.launchFilter(items, 'daily', 'all').rows.map((x) => x.id), ['skill:b']);
  const fac = D.launchFacets(items);
  assert.deepEqual(fac.tier, { all: 5, core: 2, useful: 0, niche: 1, unrated: 1, dead: 1 });
  assert.deepEqual(fac.where.map((w) => w.w + ':' + w.n), ['hermes:2', 'spark:1']); // v8: OMP is retired, never a facet
  assert.ok(!items.some((x) => x.where.includes('omp')));
});

test('products render supplied app name and already scoped feed without owner-specific defaults', () => {
  const p = feed({ src: '~/.meshvault/status/deck/products.json',
    products: [{ id: 'public', name: 'Public site', url: 'https://example.org/', code: 200, ms: 120, state: 'up', monitor: { checks: 4, ok: 4, failing: [] } },
      { id: 'internal', name: 'Internal dashboard', url: null, code: 401, ms: 6, state: 'gated', monitor: null },
      { id: 'down', name: 'Down site', url: 'javascript:x', code: null, ms: 9000, state: 'down', monitor: null }],
    app_store: { name: 'Sample iOS', version: { string: '1.2', state: 'PREPARE_FOR_SUBMISSION', build: 23 }, latest_build: { number: 29, state: 'VALID', uploaded: new Date(NOW - 7200e3).toISOString() },
      review: { state: 'UNRESOLVED_ISSUES' }, url: 'https://appstoreconnect.apple.com/apps/1/distribution' },
    needs: [{ owner: 'owner', sev: 'high', text: 'Answer App Review', why: 'review issues open', source: 'app store connect', url: 'https://appstoreconnect.apple.com/x' },
      { owner: 'owner', sev: 'low', text: 'Reconnect 2 links', why: 'provider offline', source: 'accounts.json' }] });
  const r = D.products(p, NOW);
  assert.match(r.grid, /<b>Sample iOS<\/b><small>[^<]*<\/small><\/span><span class="fr"><span class="pill"><i class="sd wait"><\/i>Issues open<\/span>/, 'an app alone in its state: its row, its details and its state word');
  assert.match(r.grid, /Version 1\.2, in prep \u00B7 build 23 attached/);
  assert.match(r.grid, /Newest build 29, valid \u00B7 2 h ago/);
  assert.match(r.grid, /Internal dashboard/);
  assert.match(r.grid, /Down site/);
  assert.doesNotMatch(r.grid, /javascript:/);
  assert.equal(r.count, '2');
  assert.match(r.needs, /need sv-high/);
  assert.match(D.needRows(feed({ needs: [] }), 3), /Nothing needs you/);
  assert.match(D.products(missing('products'), NOW).grid, /Products are not reporting/);
});

test('GitHub account link comes from the account feed, not a pinned owner organization', () => {
  const a = feed({ dev_auth: { github: { ok: true, account: 'sample-org' } } });
  assert.match(D.conn(a, NOW)[0], /href="https:\/\/github.com\/sample-org"/);
  assert.doesNotMatch(D.conn(feed({ dev_auth: { github: { ok: true, account: 'bad/path' } } }), NOW)[0], /href="https:\/\/github.com\/bad/);
});

test('bills join Renewals and deadlines by the phone date, soonest first, names and dates only, a bad date dropped', () => {
  const LOCAL_NOON = new Date(2026, 9, 3, 12).getTime(); // local noon so the result does not depend on the host zone
  const bills = [{ title: 'Tesla insurance (monthly debit)', due: '2026-10-07' }, { title: 'Gardener Venmo', due: '2026-10-04' },
    { title: 'Card window', due: '2026-10-03' }, { title: 'Stale <b>x</b>', due: '2026-10-02' }, { title: 'Bad date', due: 'soon' }];
  const r = D.tdDeadlines({ renewals: [], paperwork: [] }, bills, LOCAL_NOON);
  const due = r.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(due.indexOf('Stale') < due.indexOf('Card window') && due.indexOf('Card window') < due.indexOf('Gardener') && due.indexOf('Gardener') < due.indexOf('Tesla'));
  assert.match(due, /1 day late/); assert.match(due, /Today/); assert.match(due, /Tomorrow/); assert.match(due, /4 days/);
  assert.doesNotMatch(r.html, /Bad date|\$|<b>x<\/b>/);
  assert.equal(D.tdDeadlines({ renewals: [], paperwork: [] }, [], LOCAL_NOON).html, '', 'nothing due is no section');
  // a failed deadlines feed still shows the bills and names the feed once in the checks row
  const f = D.tdDeadlines({ error: 'file missing' }, bills, LOCAL_NOON);
  assert.match(f.html, /Card window/);
  assert.deepEqual(f.miss.map((m) => m.name), ['Renewals and deadlines']);
});

test('today sections: the Mac mini calendar fallback, home rows and the cluster, unknown never zero', () => {
  const acc = feed({ apple: { mini_reachable: true, events_today: [{ title: 'Shift', calendar: 'LOTO', all_day: true }] } });
  assert.match(D.tdCal(null, acc, NOW).html, /Shift[\s\S]*All day/);
  assert.deepEqual(D.tdCal(null, feed({ apple: { mini_reachable: false } }), NOW).miss.map((m) => m.name), ['Calendar']);
  const h = D.tdHome({ car: { battery: 33, range: 92.1, locked: true, charging: 'Disconnected', stale: false },
    ha: { entities: { 'weather.forecast_home': { state: 'clear-night' }, 'sensor.hp_envy_6400_series_black_cartridge': { state: 'unavailable', unit: '%' } } },
    cams: { cams: [{ ready: true }, { ready: false }] } }, NOW).html;
  assert.match(h, /<b>Car<\/b><small>92 mi \u00B7 Locked<\/small><\/span><span class="fr"><b>33%<\/b>/);
  assert.match(h, /Clear night/);
  assert.match(h, /1 of 2/);
  assert.doesNotMatch(h, /Printer|No reading/);
  assert.deepEqual(D.tdHome({ car: { error: 'file missing' }, ha: { error: 'HA down' } }, NOW).miss.map((m) => m.name), ['Cameras', 'Car', 'Home Assistant', 'Apple Watch']);
  const c = feed({ engine: { status: 'loading', served_name: 'glm' }, nodes: [{ name: 'spark', reachable: true, mem_used_gb: 124, mem_total_gb: 130.7, gpu_temp_c: 72, gpu_util_pct: null }, { name: 'ascent', reachable: false }] });
  const ch = D.tdCluster(c, NOW).html;
  assert.match(ch, /pill warn[^]*Loading/);
  assert.match(ch, /Spark<\/b><small>124 of 131 GB \u00B7 72\u00B0C/);
  assert.doesNotMatch(ch, /--|null|NaN/);
  assert.match(ch, /Ascent<\/b><small>Not reachable/);
});

test('cluster: a stale bench names the served model and the last bench, never a dash speed', () => {
  const sentence = 'No current benchmark for DeepSeek-V4.1-Flash-1017-EXL3; last bench was glm-5.3-flash on Oct 2';
  const c = feed({ engine: { status: 'up', served_name: 'DeepSeek-V4.1-Flash-1017-EXL3' },
    bench: { stale: true, reason: 'bench is for glm-5.3-flash, served is DeepSeek-V4.1-Flash-1017-EXL3', measured_at: '2026-10-02',
      model: 'glm-5.3-flash', served_model: 'DeepSeek-V4.1-Flash-1017-EXL3', prose_tps: null, code_tps: null, conc6_tps: null,
      prefill_tps: null, at: '2026-10-02', source: 'spark:~/ops/state/glm-ratchet/RESULTS.md' },
    ratchet: { last_date: '2026-10-02', last_step: 'pl-20261002-183720-max-seqs-32-to-16', last_outcome: 'ACCEPTED', next_run: null, model: 'glm-5.3-flash', stale: true },
    proxy: { pc_desktop_8080_up: true, models: ['DeepSeek-V4.1-Flash-1017-EXL3'] } });
  const col = D.cluster(c, NOW).join(' ');
  assert.ok(col.includes(sentence), col);
  assert.doesNotMatch(col, /tok\/s writing|The next benchmark run fills this in/);
  assert.match(col, /GLM history/);
  assert.match(col, /Last GLM run Oct 2\. Not the served model/);
  assert.doesNotMatch(col, /\d{4}-\d{2}-\d{2}/, 'feed dates read in the deck format, never ISO');
  assert.doesNotMatch(col, /Tuning/);
  // Today's cluster section shows the engine and nodes only: no bench numbers to go stale
  assert.doesNotMatch(D.tdCluster(c, NOW).html, /tok\/s|Coding|bench/i);
});

test('cluster: a current bench keeps its numbers and the Tuning tile', () => {
  const c = feed({ engine: { status: 'up', served_name: 'glm-5.3-flash-uncensored' },
    bench: { stale: false, prose_tps: 38.85, code_tps: 64.92, conc6_tps: 91.21, prefill_tps: 1502.2, at: '2026-10-02', model: 'glm-5.3-flash', source: 'x' },
    ratchet: { last_date: '2026-10-02', last_step: 's', last_outcome: 'ACCEPTED', next_run: null, stale: false },
    proxy: { pc_desktop_8080_up: true, models: ['glm-5.3-flash-uncensored'] } });
  const col = D.cluster(c, NOW).join(' ');
  assert.match(col, /Speed<\/div><div class="v">38\.9 tok\/s<\/div><div class="t">Writing \u00B7 measured\u00A0Oct 2/);
  assert.match(col, /<b>Prefill<\/b><\/span><span class="fr"><b class="fig">1,502<\/b><small>tok\/s<\/small>/);
  assert.match(col, /Tuning/);
  assert.match(col, /Last run Oct 2 \u00B7 next not scheduled/);
  assert.doesNotMatch(col, /GLM history|No current benchmark|2026-10-02/);
  // a date that does not read as a date is unknown, never the raw text
  const odd = D.cluster(feed({ engine: { status: 'up' }, bench: {}, ratchet: { last_date: 'soon', stale: false }, proxy: {} }), NOW).join(' ');
  assert.match(odd, /Last run date not reported/);
});

test('jobs: rows carry no site, a fit of 0 shows as 0, only safe links open, and a missing feed says so', () => {
  const j = feed({ src: '~/.meshvault/status/deck/jobs.json', by_site: { linkedin: 3, indeed: 5 }, queries: ['ems'],
    listings: [{ title: 'Paramedic', company: 'A', site: 'indeed', url: 'https://indeed.com/x', score: 0, posted_at: T(7200), remote: null, salary: null },
      { title: 'Ops lead', company: 'B', site: 'linkedin', url: 'data:text/html,x', score: 88 }] });
  assert.deepEqual(D.jobSites(j).map((s) => s.site), ['indeed', 'linkedin']); // the Data sheet's sources, counted from the rows
  const all = D.jobs(j, {}, NOW, { person: 'tanner' });
  assert.doesNotMatch(all, /data-site|>indeed|>linkedin|meshvault|jobs\.json/);
  assert.match(all, /<b>0<\/b>/); // a fit score of 0 is shown as 0
  assert.doesNotMatch(all, /data:text/);
  assert.match(D.jobs(missing('jobs'), {}, NOW, { person: 'tanner' }), /Jobs are not reporting/);
});

test('homes and markets render truthfully', () => {
  const r = feed({ market: { area: 'Huntington Beach', median_list_price: 1850000, source: 'redfin', at: T(86400) },
    homes: [{ addr: '1 Main St', city: 'Huntington Beach', price: 1250000, currency: 'USD', beds: 3, baths: 2.5, sqft: 1800, source: 'redfin' }],
    commercial: [{ city: 'Irvine', type: 'Office', price: null, sqft: 5000, cap_rate: 6.25 }] });
  const rh = D.homes(r, NOW);
  assert.match(rh, /\$1\.85M/);
  assert.match(rh, /\$1\.25M \u00B7 1 Main St/);
  assert.match(rh, /2\.5 BA/);
  assert.match(rh, /-- \u00B7 Office/);
  assert.match(rh, /cap rate 6\.3%/);
});

test('small formatters', () => {
  assert.deepEqual([D.usd(null), D.usd(950), D.usd(850000), D.usd(12500000)], ['--', '$950', '$850K', '$12.50M']);
  assert.deepEqual([D.compass(0), D.compass(359), D.compass(225), D.compass(null)], ['N', 'N', 'SW', '']);
  assert.equal(D.safeUrl('https://a.example/x?y=1'), 'https://a.example/x?y=1');
  for (const u of ['javascript:alert(1)', 'data:text/html,1', '//evil', 'https://a" onclick="x', null]) assert.equal(D.safeUrl(u), '');
  assert.equal(D.toEpoch('2026-10-01T04:00:00Z'), NOW / 1000);
  assert.equal(D.toEpoch(NOW), NOW / 1000);
});

test('hockey next and live games link to official NHL GameCenter; the Today hockey sheet keeps both links', () => {
  const next = '/gamecenter/ana-vs-vgk/2026/10/02/2026020010';
  const live = '/gamecenter/lak-vs-sjs/2026/10/03/2026020011';
  const h = feed({ teams: [{ abbr: 'ANA', record: '1-0-0', next_game: { opp: 'VGK', at: T(-3600), gc: next } }],
    live: [{ home: 'SJS', away: 'LAK', score: '1-2', period: 2, clock: '10:05', gc: live }] });
  const sheet = D.tdHockeySheet(h, NOW);
  assert.ok(sheet.includes('href="https://www.nhl.com' + live + '"'));
  assert.ok(sheet.includes('href="https://www.nhl.com' + next + '"'));
  assert.match(sheet, /target="_blank" rel="noopener noreferrer"/);
  assert.match(D.tdGlance({ hockey: h, now: NOW }).html, /<button type="button" data-open="today-hockey" class="tile tv-hide" data-key="hockey">/);
  h.teams[0].next_game.gc = 'https://example.com/unofficial-stream';
  h.live[0].gc = null;
  for (const out of [D.tdHockeySheet(h, NOW), D.tdGlance({ hockey: h, now: NOW }).html]) {
    // no off-site link survives an unofficial or missing GameCenter path (Today's own /almanac/ row is same-origin and stays)
    assert.doesNotMatch(out, /href="(?!\/almanac\/")/);
  }
});
