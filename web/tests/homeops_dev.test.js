// node --test tests/homeops_dev.test.js  (Home > Dev: App builds, Pull requests, Vercel, Supabase, Rank watch, Workspace; no DOM, no network)
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const a = deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), b = deck.indexOf('// ==== DECK V6 UI HELPERS END ====');
assert.ok(a >= 0 && b > a);
const D = new Function(deck.slice(a, b) + '\nreturn DeckUI;')();

const NOW = Date.UTC(2026, 10, 14, 20, 0, 0);
const T = (agoS) => NOW / 1000 - agoS;
const vis = (h) => String(h).replace(/<span class="diag">[^]*?<\/span>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const sect = (h, k) => { const i = h.indexOf('data-k="' + k + '"'); if (i < 0) return ''; const j = h.indexOf('<section ', i); return h.slice(i, j < 0 ? h.length : j); };
const rows = (h) => (h.match(/class="frow/g) || []).length;
const PR = (n, o) => Object.assign({ repo: 'thefiredev-cloud/Protocol-Guide', num: n, title: 'feat(web): round ' + n + ' polish', ci: 'pass', url: 'https://github.com/x/y/pull/' + n }, o);
const DEV = (o) => Object.assign({ src: '~/.kodros/status/deck/dev.json', t: T(30), refresh: 300, stale: false, errors: [],
  github: { open_prs: [PR(1)], failing_main: [], at: T(60) }, vercel: { projects: [{ name: 'pepgo', state: 'READY', last_deploy_at: T(900), url: 'https://pepgo.vercel.app/' }] },
  supabase: { projects: [{ name: 'MeshVault', status: 'ACTIVE_HEALTHY', region: 'us-east-1' }] }, herdr: { tabs: [{ name: 'omp' }, { name: 'andrl' }], agents_busy: 2 },
  chromium: { cdp_up: true, tabs: 7, titles: ['private subject'] }, grok: { build_cli: '1.0.70', logged_in: true } }, o);
const app = (o) => Object.assign({ id: '6786588606', name: 'Mesh for Small Business', error: null,
  latest_build: { number: '72', version: '1.3.1', uploaded_at: new Date(NOW - 7200e3).toISOString(), processing_state: 'VALID', expired: false },
  feedback: { screenshots_count: 114, crashes_count: 7, last_received_at: null },
  versions: [{ version: '1.3.1', state: 'PREPARE_FOR_SUBMISSION', submission_state: 'UNRESOLVED_ISSUES', build: '71' }] }, o);
const okApp = (n, o) => app(Object.assign({ id: '68' + String(n).padStart(8, '0'), name: 'App ' + n, feedback: { crashes_count: 0 }, versions: [{ version: '1.0', state: 'WAITING_FOR_REVIEW' }] }, o || {}));
const TF = (apps, o) => Object.assign({ t: T(60), refresh: 300, stale: false, errors: [], apps }, o);
const RW = (o) => Object.assign({ t: T(60), stale: false, run: { ok_charts: 14, failed_charts: 1 }, counts: { apps: 9, live: 3, alerts_today: 1, alerts_7d: 5 },
  alerts: [{ name: 'Old', text: 'moved', kind: 'jump', severity: 'info' }, { name: 'Hot app', text: 'jumped 40 places', kind: 'jump', severity: 'warn' }, { name: 'C', text: 'c', kind: 'own_live' }, { name: 'D', text: 'd', kind: 'x' }] }, o);

test('one page of sections in the brief order: App builds, Pull requests, Vercel, Supabase, Rank watch, Workspace; titles carry no counts or ages', () => {
  const h = D.devPage(DEV(), NOW, TF([app()]), RW());
  assert.match(h, /^<div class="dev-tv board"><div class="strip"[^>]*>[^]*<\/div><\/div><div class="flow" id="hdev" data-balance>/);
  const titles = [...h.matchAll(/<h2 class="secttl"><span>([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['App builds', 'Pull requests', 'Vercel', 'Supabase', 'Rank watch', 'Workspace']);
  for (const t of titles) assert.doesNotMatch(t, /\d/);
  assert.doesNotMatch(vis(h), /Updated|Checked|ago \u00B7 Updated|Debug port|Page titles hidden|us-east-1|private subject/);
});

test('a pull request row leads with its commit title on one line, the repo and number under it, CI as one mark and word', () => {
  const h = sect(D.devPage(DEV({ github: { at: T(60), failing_main: [], open_prs: [PR(7, { ci: 'fail' }), PR(8, { ci: 'pending' }), PR(9, { ci: null })] } }), NOW, TF([])), 'prs');
  assert.match(h, /<a class="frow dvpr k-bad" href="https:\/\/github\.com\/x\/y\/pull\/7" target="_blank" rel="noopener noreferrer"><span class="fl"><b>feat\(web\): round 7 polish<\/b><small>Protocol-Guide #7<\/small><\/span><span class="fr"><span><i class="sd bad"><\/i>Failing<\/span><\/span><\/a>/);
  assert.match(h, /<span class="fr"><span><i class="sd warn"><\/i>Running<\/span>/);
  assert.match(h, /<span class="fr"><span>No checks<\/span>/);
  // failing main leads with the workflow and is red
  const m = sect(D.devPage(DEV({ github: { at: T(60), failing_main: [{ repo: 'o/JudgeFinder', workflow: 'Preview Deployment' }], open_prs: [] } }), NOW, TF([])), 'prs');
  assert.match(m, /<div class="frow dvpr k-bad"><span class="fl"><b>Preview Deployment<\/b><small>JudgeFinder \u00B7 main<\/small>/);
});

test('a long commit title is cut at a word in the model with an ellipsis, never by CSS; a short one is whole', () => {
  const long = 'feat(web): round 2 polish: hero fact grid, one header, bone install colours and a calmer footer for the store';
  const h = sect(D.devPage(DEV({ github: { at: T(60), failing_main: [], open_prs: [PR(1, { title: long })] } }), NOW, TF([])), 'prs');
  const b = /<span class="fl"><b>([^<]+)<\/b>/.exec(h)[1];
  assert.ok(b.length <= D.DEV_TITLE && b.endsWith('\u2026') && long.startsWith(b.slice(0, -1)), b);
  assert.doesNotMatch(b, / \u2026$/, 'never a space before the ellipsis');
  assert.match(sect(D.devPage(DEV(), NOW, TF([])), 'prs'), /<b>feat\(web\): round 1 polish<\/b>/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../static/css/homeops.css'), 'utf8'), /text-overflow:\s*ellipsis/);
});

test('a phone shows five rows a section, T, D and XL ten, then Show more with the rest; an opened section stays open', () => {
  const many = DEV({ github: { at: T(60), failing_main: [], open_prs: Array.from({ length: 12 }, (_, i) => PR(i + 1)) } });
  const h = sect(D.devPage(many, NOW, TF([])), 'prs');
  assert.equal(rows(h), 12, 'every row is drawn; CSS hides rows past five on a phone and past ten from T up');
  assert.match(h, /^data-k="prs"/);
  assert.match(h, /data-more5="prs"><span class="m-ph">Show 7 more<\/span><span class="m-wide">Show 2 more<\/span><\/button>/);
  assert.match(D.devPage(many, NOW, TF([]), undefined, new Set(['prs'])), /<section class="sect c5 c10 open" data-k="prs" data-bal-open>/);
  const eight = sect(D.devPage(DEV({ github: { at: T(60), failing_main: [], open_prs: Array.from({ length: 8 }, (_, i) => PR(i + 1)) } }), NOW, TF([])), 'prs');
  assert.doesNotMatch(eight, /c10|m-wide/, 'eight rows: Show more on a phone only');
  assert.doesNotMatch(sect(D.devPage(DEV(), NOW, TF([])), 'prs'), /data-more5/);
  assert.equal(D.DEV_FIRST, 5);
  assert.equal(D.DEV_WIDE, 10);
});

test('phone landscape is a phone too: five rows a section until Show more; from T up ten, so no section is many screens tall', () => {
  const css = fs.readFileSync(path.join(__dirname, '../static/css/homeops.css'), 'utf8');
  assert.match(css, /@media \(max-width:599px\),\(min-width:600px\) and \(max-height:499px\)\{\.c5:not\(\.open\) \.flist>:nth-child\(n\+6\)\{display:none\}\.c5:not\(\.open\) \.more5\{display:flex\}/);
  assert.match(css, /@media \(min-width:600px\) and \(min-height:500px\)\{html:not\(\.tv\) \.c10:not\(\.open\) \.flist>:nth-child\(n\+11\)\{display:none\}/);
  assert.doesNotMatch(css, /break-inside:auto/, 'a section never continues in another column');
});

test('Fix these: one button in the Pull requests title for failing main and failing pull requests, hidden on TV, none when clean', () => {
  const bad = D.devPage(DEV({ github: { at: T(60), failing_main: [{ repo: 'o/JudgeFinder', workflow: 'Ingest daily' }], open_prs: [PR(556, { ci: 'fail' }), PR(555, { ci: 'fail' }), PR(1)] } }), NOW, TF([]));
  assert.equal((bad.match(/data-fix="ci"/g) || []).length, 1);
  assert.match(bad, /<span class="act"><button type="button" class="btn btn-sm fix tv-hide" data-fix="ci" aria-label="Fix these: opens a message about 3 failing checks; nothing starts until you tap Send">Fix these<\/button><\/span>/);
  assert.doesNotMatch(D.devPage(DEV(), NOW, TF([])), /data-fix/);
});

test('GitHub: no block is an empty state, never "0 open"; a rate-limited block keeps its rows and counts as a part not reporting', () => {
  const none = D.devPage(DEV({ github: undefined, errors: [{ source: 'github', reason: 'gh exit 1: rate limit' }] }), NOW, TF([]));
  assert.match(vis(sect(none, 'prs')), /GitHub did not report Pull requests show again once it answers\./);
  assert.doesNotMatch(vis(none), /0 open/);
  const limited = DEV({ github: { open_prs: [PR(504)], failing_main: [], at: T(1800), stale: true, stale_reason: 'rate_limited' } });
  assert.equal(rows(sect(D.devPage(limited, NOW, TF([])), 'prs')), 1);
  assert.equal(D.devFresh(limited, NOW, TF([])).missing, 1);
  assert.equal(D.devFresh(DEV(), NOW, TF([])).missing, 0);
  const src = D.devData(limited, NOW, TF([])).sources.find((s) => s.name === 'GitHub');
  assert.deepEqual([src.state, src.asOf], ['stale', '30 min ago, GitHub rate limit']);
  assert.match(D.devData(DEV({ github: { open_prs: [], failing_main: [], at: T(600), stale: true, stale_reason: 'unavailable' } }), NOW, TF([])).sources[0].asOf, /GitHub unreachable$/);
});

test('Vercel: failed deploys first, each opens its sheet with a mark and a word; an expired token says so with its age; none is an empty state', () => {
  const v = sect(D.devPage(DEV({ vercel: { projects: [{ name: 'ok-site', state: 'READY', last_deploy_at: T(600) }, { name: 'broken', state: 'ERROR', url: 'https://b.vercel.app/' }, { name: 'held', state: 'READY', paused: true }] } }), NOW, TF([])), 'vercel');
  const order = [...v.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(order, ['broken', 'held', 'ok-site']);
  assert.match(v, /<button type="button" class="frow go k-bad" data-dv="vercel" data-key="broken"><span class="fl"><b>broken<\/b><\/span><span class="fr"><span><i class="sd bad"><\/i>Error<\/span>/);
  assert.match(v, /<span class="fr"><span><i class="sd warn"><\/i>Paused<\/span>/);
  assert.match(v, /<span class="fr"><span><i class="sd ok"><\/i>Ready<\/span><\/span>/);
  assert.doesNotMatch(vis(v), /ago/, 'a deploy age is not page content: it is in the sheet');
  const exp = sect(D.devPage(DEV({ vercel: { projects: [] }, errors: [{ source: 'vercel', reason: 'vercel OAuth access token expired 335200s ago (keepalive not refreshing)' }] }), NOW, TF([])), 'vercel');
  assert.match(vis(exp), /Vercel not reporting Token expired 4 d ago\. Projects show again once it is refreshed\./);
  assert.match(vis(sect(D.devPage(DEV({ vercel: { projects: [] } }), NOW, TF([])), 'vercel')), /No Vercel projects/);
});

test('App builds: review trouble first, version and build on one line, crashes only when there are any, a state pill, no ages; errors are a failed row', () => {
  const h = sect(D.devPage(DEV(), NOW, TF([okApp(1), app(), okApp(2, { latest_build: { number: '3', version: '2.0', processing_state: 'PROCESSING' } })])), 'apps');
  const order = [...h.matchAll(/<span class="fl"><b>([^<]+)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(order, ['Mesh for Small Business', 'App 2', 'App 1']);
  // a number keeps its word on one line (no-break space): "build 72", never "build" / "72"
  assert.match(h, /<button type="button" class="frow go k-bad" data-dv="app" data-key="6786588606"><span class="fl"><b>Mesh for Small Business<\/b><small>Version\u00A01\.3\.1 \u00B7 build\u00A072 \u00B7 7\u00A0crashes<\/small>/);
  assert.match(h, /<span class="pill bad"><i class="sd bad"><\/i>Issues open<\/span>/);
  assert.match(h, /<b>App 1<\/b><small>Version\u00A01\.3\.1 \u00B7 build\u00A072<\/small>/);
  assert.doesNotMatch(h, /screenshots|feedback|0 crashes| ago|appstoreconnect/, 'the upload, tester feedback and the App Store Connect link are in the sheet');
  const err = sect(D.devPage(DEV(), NOW, TF([app({ name: 'Shellboard', error: 'ASC 429 rate limited tok' + 'en=abcdefghijklmnop1234' })])), 'apps');
  assert.match(err, /<div class="frow err k-bad"><span class="fl"><b>Shellboard<\/b><small>ASC 429 rate limited/);
  assert.doesNotMatch(err, /abcdefghijklmnop1234/);
  assert.match(vis(sect(D.devPage(DEV(), NOW, null), 'apps')), /App builds are not reporting/);
  assert.match(sect(D.devPage(DEV(), NOW, { error: 'x' }), 'apps'), /data-retry="dev"/);
  assert.match(vis(sect(D.devPage(DEV(), NOW, TF([])), 'apps')), /No apps listed/);
});

test('Rank watch: charts read and this week\'s alerts as figures, three alerts with warnings first; missing counts are not zero', () => {
  const h = sect(D.devPage(DEV(), NOW, TF([]), RW()), 'rank');
  assert.match(h, /<b>App Store charts<\/b><\/span><span class="fr"><b>14 of 15<\/b>/);
  assert.match(h, /<b>Alerts this week<\/b><small>1 today<\/small><\/span><span class="fr"><b>5<\/b>/);
  const names = [...h.matchAll(/<span class="fl"><b>([^<]+)<\/b>/g)].map((m) => m[1]).slice(2);
  assert.deepEqual(names, ['Hot app', 'Old', 'C']);
  const miss = sect(D.devPage(DEV(), NOW, TF([]), RW({ run: null })), 'rank');
  assert.match(vis(miss), /Rank watch is not reporting charts/);
  assert.doesNotMatch(vis(miss), /0 of/);
  assert.match(sect(D.devPage(DEV(), NOW, TF([]), { error: 'file missing' }), 'rank'), /data-retry="dev"/);
  assert.equal(sect(D.devPage(DEV(), NOW, TF([])), 'rank'), '', 'no rank feed passed: no section');
});

test('Workspace: Herdr, the browser and Grok as rows; browser page titles never render; unknown is said, never zero', () => {
  const h = sect(D.devPage(DEV(), NOW, TF([])), 'ws');
  assert.match(h, /<b>Herdr<\/b><\/span><span class="fr"><b>2 tabs<\/b><small>2 busy<\/small>/);
  assert.match(h, /<b>Browser<\/b><\/span><span class="fr"><span><i class="sd ok"><\/i>Up<\/span><small>7 tabs<\/small>/);
  assert.match(h, /<b>Grok<\/b><\/span><span class="fr"><span><i class="sd ok"><\/i>Signed in<\/span><small>Version 1\.0\.70<\/small>/);
  assert.doesNotMatch(h, /private subject|omp|andrl/);
  const down = sect(D.devPage(DEV({ herdr: undefined, chromium: { cdp_up: false }, grok: {} }), NOW, TF([])), 'ws');
  assert.match(down, /No reading/);
  assert.match(down, /class="frow k-bad"><span class="fl"><b>Browser<\/b><\/span><span class="fr"><span><i class="sd bad"><\/i>Down<\/span>/);
  assert.match(down, /Not installed/);
});

test('a dev feed that did not report is one empty state with Try again; App builds still show from their own feed', () => {
  for (const d of [null, { error: 'file missing', src: '~/.kodros/status/deck/dev.json' }]) {
    const h = D.devPage(d, NOW, TF([okApp(1)]), RW());
    assert.match(vis(h), /Dev is not reporting/);
    assert.match(h, /data-retry="dev"/);
    assert.doesNotMatch(vis(h), /dev\.json|file missing/);
    assert.equal(rows(sect(h, 'apps')), 1);
    assert.equal(sect(h, 'ws'), '');
    assert.ok(D.devFresh(d, NOW, TF([okApp(1)]), RW()).missing >= 1);
  }
});

test('TV: four read-only tiles are the board (what needs a look in each part); the sections sit below; Fix these is hidden', () => {
  const h = D.devPage(DEV({ github: { at: T(60), failing_main: [], open_prs: [PR(1, { ci: 'fail' }), PR(2)] } }), NOW, TF([app(), okApp(1)]), RW());
  const board = /^<div class="dev-tv board">([^]*?)<\/div><\/div><div class="flow"/.exec(h)[1];
  const tiles = [...board.matchAll(/<span class="h">([^<]+)<\/span><b class="v">([^<]+)<\/b>(?:<span class="t">([^<]*)<\/span>)?/g)].map((m) => [m[1], m[2], m[3] || '']);
  assert.deepEqual(tiles, [['App builds', '1', 'app needs a look'], ['Pull requests', '2', '1 failing'], ['Vercel', 'OK', '1 project'], ['Rank alerts', '5', 'this week']]);
  assert.doesNotMatch(board, /<button/, 'the board is read only');
  assert.match(D.devPage(null, NOW, null, { error: 'x' }), /<span class="h">Pull requests<\/span><b class="v">Not reporting<\/b>/);
  for (const k of ['supabase', 'rank', 'ws']) assert.match(h, new RegExp('<section class="sect c5 tv-hide" data-k="' + k + '"'));
  assert.match(h, /class="btn btn-sm fix tv-hide" data-fix="ci"/);
});

test('freshness and the Data sheet: one mark from the dev feed age; sources with what they give; failed parts and their reasons under Setup', () => {
  const d = DEV({ errors: [{ source: 'supabase', reason: 'HTTP 401 tok' + 'en=abcdefghijklmnop1234' }] });
  const f = D.devFresh(d, NOW, TF([app({ name: 'X', error: 'ASC 429' })]), RW());
  assert.deepEqual(f, { age: 30, refresh: 300, missing: 2 });
  const m = D.devData(d, NOW, TF([])).method;
  assert.deepEqual(m.map((r) => r[0]), ['Fixing', 'Order'], 'short labels: the old "Fix these" label ran into its text');
  assert.doesNotMatch(m.map((r) => r.join(' ')).join(' '), /\b(\w+) \1\b/, 'no doubled word');
  const ds = D.devData(d, NOW, TF([app()], { errors: [{ source: 'Shellboard', reason: 'ASC 429' }] }), RW());
  assert.deepEqual(ds.sources.map((s) => s.name), ['GitHub', 'Vercel', 'Supabase', 'Workspace', 'App Store Connect', 'App Store rank watch']);
  assert.equal(ds.sources[0].gives, '1 open pull requests, 0 failing on main');
  assert.match(ds.sources[3].gives, /debug port 9333/);
  assert.equal(ds.sources[5].gives, '14 charts read, 9 apps tracked, 3 live');
  assert.deepEqual(ds.setup.map((s) => s.name), ['Supabase', 'Shellboard']);
  assert.doesNotMatch(ds.setup[0].line, /abcdefghijklmnop1234/);
  assert.equal(D.devData(null, NOW, null).sources[0].state, 'never');
});

test('hostile feed text is escaped and unsafe links are plain rows', () => {
  const h = D.devPage(DEV({ github: { at: T(60), failing_main: [], open_prs: [PR(1, { title: '<img src=x onerror=1>', url: 'javascript:alert(1)' })] }, vercel: { projects: [{ name: '"><script>', state: 'READY', url: 'https://ex"onmouseover=1' }] } }), NOW, TF([app({ name: '<b>x</b>' })]));
  assert.doesNotMatch(h, /<img|<script|javascript:|onmouseover|<b>x<\/b>/);
  assert.match(h, /&lt;img src=x onerror=1&gt;/);
});

const kv = (h) => Object.fromEntries([...String(h).matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g)].map((m) => [m[1], m[2]]));

test('App builds sheet: state, version, build, upload, crashes, tester screenshots and last feedback; the App Store Connect link is the one action', () => {
  const tf = TF([app({ feedback: { screenshots_count: 114, crashes_count: 7, last_received_at: new Date(NOW - 3 * 86400e3).toISOString() } })]);
  const s = D.devSheet('app', '6786588606', DEV(), tf, NOW);
  assert.equal(s.title, 'Mesh for Small Business');
  const m = kv(s.body);
  assert.deepEqual(Object.keys(m), ['State', 'Version', 'Build', 'Uploaded', 'Crashes', 'Tester screenshots', 'Last feedback']);
  assert.deepEqual([m.State, m.Version, m.Build, m.Crashes, m['Tester screenshots']], ['Issues open', '1.3.1', '72', '7', '114']);
  assert.match(m.Uploaded, /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d\d [ap]m \u00B7 2\u00A0h\u00A0ago$/, 'the age keeps itself whole (LayoutP 40)');
  assert.match(m['Last feedback'], /^[A-Z][a-z]{2} \d{1,2}, .* \u00B7 3\u00A0d\u00A0ago$/);
  assert.doesNotMatch(s.body, /\d{4}-\d{2}-\d{2}/, 'dates in the deck format, never ISO');
  assert.equal(s.actions, '<a class="btn btn-primary ext" href="https://appstoreconnect.apple.com/apps/6786588606/testflight/ios" target="_blank" rel="noopener noreferrer">Open in App Store Connect</a>');
  // through DeckUI.detail the sheet ends with the Data button
  assert.match(D.detail(s).actions, /data-sheet="data">Data<\/button>$/);
});

test('App builds sheet: no feedback yet is "None yet"; a missing block or count is "No data", never 0; no build says so', () => {
  const none = kv(D.devSheet('app', '6800000001', DEV(), TF([okApp(1, { feedback: { screenshots_count: 0, crashes_count: 0, last_received_at: null } })]), NOW).body);
  assert.deepEqual([none.Crashes, none['Tester screenshots'], none['Last feedback']], ['0', '0', 'None yet']);
  const miss = kv(D.devSheet('app', '6800000001', DEV(), TF([okApp(1, { feedback: undefined, latest_build: { number: '4' } })]), NOW).body);
  assert.deepEqual([miss.Crashes, miss['Tester screenshots'], miss['Last feedback'], miss.Uploaded, miss.Version], ['No data', 'No data', 'No data', 'No data', 'No data']);
  const half = kv(D.devSheet('app', '6800000001', DEV(), TF([okApp(1, { feedback: { screenshots_count: 3, last_received_at: null } })]), NOW).body);
  assert.equal(half['Last feedback'], 'No data', 'screenshots without a time are not "None yet"');
  assert.equal(kv(D.devSheet('app', '6800000001', DEV(), TF([okApp(1, { latest_build: null })]), NOW).body).Build, 'No build uploaded yet');
  // an app the feed no longer carries, an errored app or another kind: no sheet
  assert.equal(D.devSheet('app', 'gone', DEV(), TF([okApp(1)]), NOW), null);
  assert.equal(D.devSheet('app', '6786588606', DEV(), TF([app({ error: 'ASC 429' })]), NOW), null);
  assert.equal(D.devSheet('app', '6786588606', DEV(), null, NOW), null);
  assert.equal(D.devSheet('nope', 'x', DEV(), TF([]), NOW), null);
});

test('Vercel sheet: the last deploy with its date and age, a production deploy when it differs; the site link is safe or absent', () => {
  const d = DEV({ vercel: { projects: [{ name: 'pepgo', state: 'READY', last_deploy_at: T(900), production_deploy_at: T(86400 * 2), url: 'https://pepgo.vercel.app/' }, { name: 'bad', state: 'ERROR', url: 'javascript:alert(1)' }, { state: 'BUILDING' }] } });
  const s = D.devSheet('vercel', 'pepgo', d, TF([]), NOW), m = kv(s.body);
  assert.equal(s.sub, 'Vercel project');
  assert.equal(m.State, 'Ready');
  assert.match(m['Last deploy'], /\u00B7 15\u00A0min\u00A0ago$/);
  assert.match(m['Production deploy'], /\u00B7 2\u00A0d\u00A0ago$/);
  assert.match(s.actions, /^<a class="btn btn-primary ext" href="https:\/\/pepgo\.vercel\.app\/" target="_blank" rel="noopener noreferrer">Open site<\/a>$/);
  const bad = D.devSheet('vercel', 'bad', d, TF([]), NOW);
  assert.equal(bad.actions, '', 'an unsafe url is no link');
  assert.equal(kv(bad.body)['Last deploy'], 'No data');
  assert.equal(kv(D.devSheet('vercel', 'pepgo', DEV({ vercel: { projects: [{ name: 'pepgo', state: 'READY', last_deploy_at: T(60), production_deploy_at: T(60) }] } }), TF([]), NOW).body)['Production deploy'], undefined);
  // a project with no name keeps its place in the list as its key, on the row and in the sheet
  assert.match(sect(D.devPage(d, NOW, TF([])), 'vercel'), /data-key="#2"/);
  assert.equal(D.devSheet('vercel', '#2', d, TF([]), NOW).title, 'Project');
  assert.equal(D.devSheet('vercel', 'pepgo', null, TF([]), NOW), null);
});

test('Supabase and Herdr: the rows open sheets with the region and the tab names; neither reaches the page', () => {
  const d = DEV({ supabase: { projects: [{ name: 'MeshVault', ref: 'abcd1234', status: 'ACTIVE_HEALTHY', region: 'us-east-1' }, { name: 'Old', status: 'INACTIVE' }] },
    herdr: { tabs: [{ name: 'omp: fix kernel audit', panes: 2 }, { name: '<img src=x>', panes: 1 }, { panes: 3 }], agents_busy: 2 } });
  const page = D.devPage(d, NOW, TF([]));
  assert.match(sect(page, 'supabase'), /<button type="button" class="frow go" data-dv="supabase" data-key="abcd1234">/);
  assert.match(sect(page, 'supabase'), /data-key="Old"/);
  assert.match(sect(page, 'ws'), /<button type="button" class="frow go" data-dv="herdr" data-key="herdr"><span class="fl"><b>Herdr<\/b><\/span><span class="fr"><b>3 tabs<\/b><small>2 busy<\/small>/);
  assert.doesNotMatch(vis(page), /us-east-1|omp: fix|img/);
  const sb = D.devSheet('supabase', 'abcd1234', d, TF([]), NOW);
  assert.deepEqual(kv(sb.body), { Status: 'Active healthy', Region: 'us-east-1' });
  assert.equal(kv(D.devSheet('supabase', 'Old', d, TF([]), NOW).body).Region, 'No data');
  const h = D.devSheet('herdr', 'herdr', d, TF([]), NOW);
  assert.equal(h.sub, '3 tabs \u00B7 2 agents busy');
  assert.match(h.body, /^<section class="sh-sec"><dl class="kv">/, 'the tab names lead the sheet');
  assert.deepEqual(kv(h.body), { 'omp: fix kernel audit': '2 panes', '&lt;img src=x&gt;': '1 pane', 'Untitled tab': '3 panes' });
  assert.equal(kv(D.devSheet('herdr', 'herdr', DEV({ herdr: { tabs: [{ name: 'x' }] } }), TF([]), NOW).body).x, 'No data');
  const empty = D.devSheet('herdr', 'herdr', DEV({ herdr: { tabs: [] } }), TF([]), NOW);
  assert.match(empty.body, /No tabs open\./);
  assert.equal(empty.sub, '0 tabs', 'an unknown busy count is left out, as on the row; never 0');
  // no herdr block: the row is plain text and there is no sheet
  assert.doesNotMatch(sect(D.devPage(DEV({ herdr: undefined }), NOW, TF([])), 'ws'), /data-dv="herdr"/);
  assert.equal(D.devSheet('herdr', 'herdr', DEV({ herdr: undefined }), TF([]), NOW), null);
});

test('glue: home/dev registers with a 60 s gate, reads three feeds, marks freshness, Show more opens a section, a row opens its sheet', () => {
  const glue = deck.slice(deck.indexOf('// ---- Home > Dev: three feeds'));
  assert.match(glue, /DeckPages\.register\('home\/dev',\{every:60000,/);
  assert.match(glue, /Promise\.all\(\[feedGet\('dev'\),feedGet\('testflight'\),feedGet\('rankwatch'\)\]\)/);
  assert.match(glue, /DeckPages\.mark\(c,DeckUI\.devFresh\(/);
  assert.match(glue, /closest\('\[data-more5\]'\)/);
  assert.match(glue, /closest\('#hdev \[data-dv\]'\)[^]*DeckUI\.devSheet\(b\.dataset\.dv,b\.dataset\.key,DEV\.d,DEV\.tf,Date\.now\(\)\)[^]*DeckShell\.sheet\.open\(Object\.assign\(\{id:'dev-'\+b\.dataset\.dv,opener:b\},DeckUI\.detail\(s\)\)\)/);
  assert.doesNotMatch(deck, /^oldPage\('dev',/m);
});
