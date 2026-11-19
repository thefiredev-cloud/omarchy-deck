// node --test tests/deck_copy.test.js  (human copy, redaction and the one empty state; pure helpers from static/deck.js, no DOM, no network)
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const a = src.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const b = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
assert.ok(a >= 0 && b > a);
const D = new Function(src.slice(a, b) + '\nreturn DeckUI;')();

const NOW = Date.UTC(2026, 9, 5, 18, 0, 0);
const T = (agoS) => NOW / 1000 - agoS;
// what a person reads: hidden diagnostics and tags removed
const vis = (h) => String(h).replace(/<span class="diag">[\s\S]*?<\/span>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const PLUMBING = /\b[\w*-]+\.(?:json|tsv|db|md)\b|\/api\/|127\.0\.0\.1|localhost|~\/|\/home\/|\bhttps?:\/\/(?!www|github)|\bHTTP \d{3}\b|\bhttp \d{3}\b|gateway|systemctl|tailnet|MediaMTX|\bCDP\b|\bHA\b|\bkv\b|:\d{4}\b/i;

test('relative times read the way a person says them', () => {
  const at = (s) => D.ago(T(s), NOW);
  assert.deepEqual([at(5), at(44), at(60), at(150), at(3600), at(5000), at(7200), at(86400 * 3)], ['just now', 'just now', '1 min ago', '3 min ago', '60 min ago', '83 min ago', '2 h ago', '3 d ago']);
  assert.equal(D.ago(null, NOW), 'time unknown');
  assert.equal(D.ago('junk', NOW), 'time unknown');
  assert.equal(D.until(T(-120), NOW), 'in 2 min');
  assert.equal(D.until(T(-3 * 3600), NOW), 'in 3 h');
  assert.equal(D.until(T(10), NOW), 'due');
  assert.equal(D.dur(T(20), NOW), 'under a minute');
  assert.equal(D.dur(T(7200), NOW), '2 h');
  assert.equal(D.dur(null, NOW), '');
  for (const s of [5, 600, 7200, 86400 * 4]) assert.doesNotMatch(D.ago(T(s), NOW), /\d(s|m|h|d) ago/, 'no 12s or 5m shorthand');
});

test('redact: home folders read ~, account flags are masked, ordinary text is untouched', () => {
  assert.equal(D.redact('/home/alice/.hermes/scripts/social_inbox.py scan'), '~/.hermes/scripts/social_inbox.py scan');
  assert.equal(D.redact('/Users/someone/Library/x'), '~/Library/x');
  assert.equal(D.redact('cat $HOME/notes.txt and ${HOME}/x'), 'cat ~/notes.txt and ~/x');
  assert.equal(D.redact("composio execute GMAIL_GET_PROFILE --account tanner -d '{}'"), "composio execute GMAIL_GET_PROFILE --account \u2026 -d '{}'");
  assert.equal(D.redact('{"user_id": "me"}'), '{"user_id": "\u2026"}');
  assert.equal(D.redact('Fix CI on the main branch'), 'Fix CI on the main branch');
  assert.equal(D.redact(null), '');
});

test('errors say what happened and what to do, never a status code or a server word', () => {
  const cases = [
    [[null, 0], /^No answer from the deck\. Check your connection/],
    [[null, 502], /^Hermes did not answer\. Check that it is running/],
    [[{ ok: false, error: 'hermes gateway unreachable' }, 502], /^Hermes did not answer/],
    [[{ ok: false, error: 'rate limited', retry_s: 2.2 }, 429], /^Too many tries\. Wait 3 s/],
    [[{ ok: false, error: 'already active' }, 409], /^It is already active\./],
    [[{ ok: false, error: 'unknown job' }, 404], /^That item is gone\./],
    [[{ ok: false, error: 'csrf' }, 403], /^You are signed out\./],
    [[{ ok: false, error: 'boom' }, 500], /^The deck had a problem\./],
    [[{ ok: false, error: 'weird' }, 400], /^That did not go through\./],
  ];
  for (const [args, re] of cases) {
    const t = D.humanErr(...args);
    assert.match(t, re);
    assert.doesNotMatch(t, /http|\b[45]\d\d\b|gateway|csrf|boom/i, t);
    assert.ok(/[.]$/.test(t) && t.split('. ').length <= 2, 'one or two short sentences');
  }
});

test('problem: a feed that did not report becomes one sentence, the raw cause goes to the details', () => {
  const p = D.problem({ error: 'file missing', src: '~/.meshvault/status/deck/cluster.json', stale: true });
  assert.equal(p.line, 'Nothing has been collected yet. It fills in after the next refresh.');
  assert.deepEqual(p.diag, ['file missing', '~/.meshvault/status/deck/cluster.json']);
  assert.match(D.problem({ error: 'request timed out' }).line, /took too long/);
  assert.match(D.problem({ error: 'sqlite3: database is locked' }).line, /not reporting/);
  assert.match(D.problem(null).line, /did not answer\. Check your connection/);
  for (const f of [null, { error: 'HTTP 503' }, { error: 'file missing', src: '/home/x/jobs.json' }]) assert.doesNotMatch(D.problem(f).line, PLUMBING);
});

test('empty state: one component, title and one line, a 44 px Try again only when it can retry, details hidden, never a spinner', () => {
  const h = D.empty({ k: 'bad', title: 'Cluster is not reporting', line: 'Try again in a moment.', retry: 'cluster', diag: ['file missing', '/home/alice/.hermes/x.json'] });
  assert.match(h, /^<div class="es es-bad" role="status">/);
  assert.match(h, /<b class="es-t">Cluster is not reporting<\/b><span class="es-l">Try again in a moment\.<\/span>/);
  assert.match(h, /<button type="button" class="b es-retry" data-retry="cluster">Try again<\/button>/);
  assert.match(h, /<span class="diag">~\/\.hermes\/x\.json<\/span>/, 'diagnostics keep ~ and stay hidden');
  assert.equal(vis(h), ' Cluster is not reporting Try again in a moment. Try again ');
  assert.doesNotMatch(h, /spin|loading|animate|class="sd /i, 'a terminal state never carries a spinner or a status ring');
  // no retry key, no button; a hostile key is dropped, not echoed
  assert.doesNotMatch(D.empty({ title: 'No match', line: 'Try fewer words.' }), /button/);
  assert.doesNotMatch(D.empty({ title: 'x', retry: '"><img src=x onerror=1>' }), /button|<img/);
  // text is escaped; a missing title still says something
  assert.doesNotMatch(D.empty({ title: '<b>x</b>' }), /<b>x/);
  assert.match(D.empty({}), /Nothing here yet/);
  assert.match(D.empty({ k: 'weird', title: 't' }), /es-idle/);
});

test('failed feed parts collapse into one line per panel, naming no source on the card', () => {
  const f = { t: T(5), errors: [{ source: 'a.json', reason: 'HTTP 500' }, { source: 'b', reason: 'timeout' }, { source: 'c', reason: 'x' }] };
  const out = D.cluster(f, NOW).join('');
  assert.equal((out.match(/frow err/g) || []).length, 1);
  assert.match(vis(out), /3 sources are not reporting\./);
  assert.doesNotMatch(vis(out), /a\.json|HTTP 500/);
  assert.match(out, /class="diag">a\.json: HTTP 500</);
  assert.match(vis(D.cluster({ t: T(5), errors: [{ source: 's', reason: 'r' }] }, NOW).join('')), /One source is not reporting\./);
  assert.equal(D.devPage({ t: T(5), github: { open_prs: [], failing_main: [] }, errors: [] }, NOW).includes('frow err'), false);
});

test('repo names drop the org, keep it only when two repos share a name, and cut long names in the middle', () => {
  const l = D.repoLabels(['thefiredev-cloud/protocol-guide', 'thefiredev-cloud/meshvault-site', 'a/dup', 'b/dup', 'org/' + 'x'.repeat(40) + '-tail']);
  assert.equal(l['thefiredev-cloud/protocol-guide'], 'protocol-guide');
  assert.equal(l['a/dup'], 'a/dup');
  assert.equal(l['b/dup'], 'b/dup');
  const long = l['org/' + 'x'.repeat(40) + '-tail'];
  assert.ok(long.length <= 28 && long.includes('\u2026') && long.endsWith('-tail'), long);
  assert.equal(D.midCut('short', 28), 'short');
  assert.equal(D.midCut('abcdefghijklmnopqrstuvwxyz0123456789', 10).length, 10);
});

test('dev list: org prefixes are gone and duplicate rows appear once', () => {
  const pr = { repo: 'thefiredev-cloud/protocol-guide', num: 12, title: 'Fix nav', ci: 'pass', url: 'https://github.com/x/y/pull/12' };
  const d = { t: T(5), github: { open_prs: [pr, pr, Object.assign({}, pr, { num: 13 })], failing_main: [{ repo: pr.repo, workflow: 'CI' }, { repo: pr.repo, workflow: 'CI' }] }, vercel: { projects: [] }, supabase: { projects: [] } };
  const html = D.devPage(d, NOW);
  assert.equal((html.match(/protocol-guide #12/g) || []).length, 1);
  assert.equal((html.match(/protocol-guide #13/g) || []).length, 1);
  assert.equal((html.match(/protocol-guide \u00B7 main/g) || []).length, 1);
  assert.doesNotMatch(html, /thefiredev-cloud/);
});

test('job listings: identical rows appear once, and site totals from the feed never reach the page', () => {
  const l = (title, site) => ({ title, company: 'Acme', location: 'Irvine', site, score: 80, posted_at: T(3600) });
  const j = { t: T(5), by_site: { ashby: 158, greenhouse: 136 }, listings: [l('Staff Engineer', 'ashby'), l('Staff Engineer', 'ashby'), l('Infra Lead', 'greenhouse')] };
  const html = D.jobs(j, {}, NOW, { person: 'tanner' });
  assert.equal((html.match(/class="frow jitem"/g) || []).length, 2);
  assert.doesNotMatch(html, /158|136|ashby|greenhouse/);
  assert.match(vis(D.jobs({ t: T(5), listings: [] }, {}, NOW, { person: 'tanner' })), /No job listings yet/);
});

test('schedules read as words; anything unusual says so and keeps the raw text for the details', () => {
  const cases = { 'every 30m': 'Every 30 min', 'every 60m': 'Every 60 min', 'every 1h': 'Every hour', '0 21 * * *': 'Daily at 9 PM', '0 8,20 * * *': 'Daily at 8 AM and 8 PM', '50 6 * * 1-5': 'Weekdays at 6:50 AM',
    '50 10 * * 0': 'Sun at 10:50 AM', '13 * * * *': 'Hourly at :13', '*/15 * * * *': 'Every 15 min', '0 8-20/3 * * *': 'Daily every 3 h, 8 AM to 8 PM', '0 0 1 * *': 'Custom schedule', '': 'Schedule unknown', 'weird': 'Custom schedule' };
  for (const [raw, want] of Object.entries(cases)) assert.equal(D.schedule(raw), want, raw);
  assert.equal(D.schedule(null), 'Schedule unknown');
});

test('detail sheet: a card keeps its readable lines and moves diagnostics under Details', () => {
  const html = D.down('Cluster', { error: 'file missing', src: '~/.meshvault/status/deck/cluster.json' }, 'cluster');
  const s = D.cardSheet(html, 'Cluster');
  assert.equal(s.title, 'Cluster is not reporting');
  assert.deepEqual(s.lines, ['Nothing has been collected yet. It fills in after the next refresh.']);
  assert.deepEqual(s.log, ['file missing', '~/.meshvault/status/deck/cluster.json']);
  assert.equal(s.logTitle, 'Details');
  assert.doesNotMatch(s.lines.join('|'), /Try again/, 'the retry button is not sheet text');
  const body = D.sheetBody(s);
  assert.match(body, /<div class="sh">Details<\/div>/);
  assert.match(body, /<div class="sl mono">file missing<\/div>/);
  assert.deepEqual(D.cardSheet('<div class="tile"><div class="h">A</div><div class="v">B</div></div>', 'x').log, []);
});

test('launch results name the item, never a run id', () => {
  assert.equal(D.launchResult({ ok: true, run_id: 'run_8b0f1234deadbeef64df4', status: 'started', name: 'x-posting' }).text, 'Started in Hermes \u00B7 x-posting');
  assert.equal(D.launchResult({ ok: true, run_id: 'run_1', status: 'queued', name: 'x' }).text, 'Queued in Hermes \u00B7 x');
  assert.equal(D.launchResult(null, 0).text, 'No answer from the deck. Check your connection, then try again.');
  assert.equal(D.launchResult({ ok: false, error: 'overloaded' }, 503).text, 'Hermes did not answer. Check that it is running, then try again.');
});

// ---- the sweep: every page renderer, healthy and broken, shows no plumbing to a person ----
test('no file name, endpoint, port, path, run id or HTTP code is visible on any page, healthy or broken', async () => {
  const F = await import('../qa/fixtures.mjs');
  const feeds = F.FEEDS;
  const board = F.fleetBoard();
  const broken = [null, { error: 'file missing', src: '~/.meshvault/status/deck/x.json', stale: true }, { error: 'HTTP 503', src: 'http://127.0.0.1:8080/v1/models' }, { error: 'bad json', src: '/home/alice/.hermes/cache/y.json' }];
  const sweeps = [];
  const ok = {
    cluster: D.cluster(feeds.cluster(), NOW).join(''), dev: D.devPage(feeds.dev(), NOW), conn: D.conn(feeds.accounts(), NOW).join(''), jobs: D.jobs(feeds.jobs(), 'all', NOW),
    homes: D.homes(feeds.realestate(), NOW), perf: D.perf(feeds.perfloop(), NOW),
    products: Object.values(D.products(feeds.products(), NOW)).join(''),
    today: [D.tdNeedsHtml(D.tdNeeds({ products: feeds.products() }), []), D.tdCluster(feeds.cluster(), NOW).html, D.tdCal(null, feeds.accounts(), NOW).html,
      D.tdHome({ car: feeds.car(), ha: { entities: {} }, cams: { cams: [{ ready: true }] } }, NOW).html, D.tdGlance({ hockey: feeds.hockey() }).html].join(''),
    money: D.finPage({ t: T(5), refresh: 300, errors: [], apps: [{ id: 'a', name: 'A', kind: 'bank', route: 'api', status: 'ok', last_ok: T(5), has_values: true }, { id: 'b', name: 'B', status: 'blocked', reason: 'blocked by ~/x.json' }] }, NOW, null), board: D.board(board, NOW).join(''), signals: D.fleetSignals({ t: T(5), thermal: { src: 'fleet-temps.json', hosts: { a: { cpu_c: 50 } } }, outbound: { src: '~/q/outbound.json' }, hydra: { src: 'pkgs.db' }, flightradar: {}, neighbors: { src: '/proc/net/arp' } }, NOW),
  };
  for (const [k, v] of Object.entries(ok)) sweeps.push([k, v]);
  for (const f of broken) {
    const g = (fn) => { try { return fn(f); } catch (e) { return 'THROW ' + e.message; } };
    sweeps.push(['cluster bad', g((x) => D.cluster(x, NOW).join(''))], ['dev bad', g((x) => D.devPage(x, NOW, x, x))], ['conn bad', g((x) => D.conn(x, NOW).join(''))], ['jobs bad', g((x) => D.jobs(x, 'all', NOW))],
      ['homes bad', g((x) => D.homes(x, NOW))], ['perf bad', g((x) => D.perf(x, NOW))], ['products bad', g((x) => Object.values(D.products(x, NOW)).join(''))],
      ['today bad', g((x) => { const n = D.tdNeeds({ products: x, testflight: x, schedules: x, today: x, replyblock: x }); return [D.tdNeedsHtml(n, n.miss), D.tdDeadlines(x).html, D.tdCal(x, x, NOW).html, D.tdHome({ cams: x, car: x, ha: x, watch: x }, NOW).html, D.tdCluster(x, NOW).html, D.tdMarkets(x).html, D.tdGlance({ surf: x, summary: x, zip: x, ecom: x, hockey: x, onthisday: x, traffic: x }).html].join(''); })],
      ['money bad', g((x) => D.finPage(x, NOW, null))], ['signals bad', g((x) => D.fleetSignals(x, NOW))],
      ['board bad', g((x) => D.board({ machines: x, cluster: x, models: x, backup: x, units: x }, NOW).join(''))]);
  }
  sweeps.push(['board null', D.board(null, NOW).join('')]);
  for (const [name, html] of sweeps) {
    assert.doesNotMatch(html, /^THROW/, name);
    assert.doesNotMatch(html, /undefined|NaN|\[object/, name);
    const text = vis(html);
    assert.doesNotMatch(text, PLUMBING, name + ': ' + (text.match(PLUMBING) || [''])[0]);
    assert.doesNotMatch(text, /\b\d+s ago\b|\b\d+m ago\b|\bSTALE\b|\bUnavailable\b/, name + ': old wording');
  }
  // broken feeds always offer a way out: a line plus a Try again button on the panels that own a page reload
  assert.match(D.cluster(null, NOW)[0], /data-retry="cluster"/);
  assert.match(D.devPage(null, NOW), /data-retry="dev"/);
  assert.match(D.board(null, NOW)[0], /data-retry="fleet"/);
  assert.match(D.jobs(null, {}, NOW, { person: 'tanner' }), /data-retry="jobs"/);
});
