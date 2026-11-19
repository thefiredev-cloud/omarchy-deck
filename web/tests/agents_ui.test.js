// Agents page (owner feedback 2026-10-07, TestFlight build 11: "quick launch agents from here ... fix bugs, find bugs, security, product upgrades, polish, fix crons").
// A mission opens the run window's composer with a message to read; nothing is sent from this page. No DOM, no network.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const deck = read('static/deck.js');
const da = deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), db = deck.indexOf('// ==== DECK V6 UI HELPERS END ====');
assert.ok(da >= 0 && db > da);
const DeckUI = new Function(deck.slice(da, db) + '\nreturn DeckUI;')();
const src = read('static/agents.js');
const a = src.indexOf('// ==== AGENTS UI HELPERS BEGIN'), b = src.indexOf('// ==== AGENTS UI HELPERS END ====');
assert.ok(a >= 0 && b > a);
const A = new Function('DeckUI', src.slice(a, b) + '\nreturn AgentsUI;')(DeckUI);
const html = read('static/index.html'), sw = read('static/sw.js'), main = read('rust/src/main.rs');

const job = (o) => Object.assign({ id: 'x', name: 'Job', host: 'pc-desktop', kind: 'systemd', schedule: 'every 1h', enabled: true, last: 1, next: 2, result: 'ok', detail: '' }, o);
const SCHED = (jobs) => ({ t: 1, groups: [{ id: 'g', label: 'G', jobs }] });
const DEV = {
  github: { failing_main: [{ repo: 'thefiredev-cloud/meshchat', workflow: 'iOS build and unit tests' }, { repo: 'thefiredev-cloud/omarchy-deck-ios', workflow: 'CI' }],
    open_prs: [{ repo: 'thefiredev-cloud/meshchat', num: 5 }, { repo: 'thefiredev-cloud/JudgeBinder-iOS', num: 13 }] },
  vercel: { projects: [{ name: 'protocol-guide' }, { name: 'judgefinder' }, { name: 'bad name!' }, { name: '../etc' }] },
};

test('failing jobs: only failed and overdue, names and hosts kept, nothing else leaves', () => {
  const f = A.failingJobs(SCHED([job({ name: 'fleet-health-check', result: 'failed', detail: 'exit-code exit 1' }), job({ name: 'fine' }), job({ name: 'stale one', result: 'overdue', host: 'dell' }), job({ name: 'p', result: 'paused' })]));
  assert.deepEqual(f.map((x) => x.name), ['fleet-health-check', 'stale one']);
  assert.equal(f[0].detail, 'exit-code exit 1');
  assert.deepEqual(A.failingJobs(null), []);
  assert.deepEqual(A.failingJobs({ groups: 'x' }), []);
});

test('failing CI and targets come from the dev feed, names only, safe names only, failing repos first, at most ten', () => {
  assert.deepEqual(A.failingCi(DEV), [{ repo: 'meshchat', workflow: 'iOS build and unit tests' }, { repo: 'omarchy-deck-ios', workflow: 'CI' }]);
  assert.deepEqual(A.targets(DEV), ['meshchat', 'omarchy-deck-ios', 'JudgeBinder-iOS', 'protocol-guide', 'judgefinder']);
  const many = { github: { open_prs: Array.from({ length: 30 }, (_, i) => ({ repo: 'o/r' + i })) } };
  assert.equal(A.targets(many).length, 10);
  assert.deepEqual(A.targets(null), []);
  assert.deepEqual(A.failingCi({ github: 7 }), []);
});

test('the second line of a mission says what it will act on now, and says so when a feed is missing', () => {
  const m = (id) => A.MISSIONS.find((x) => x.id === id);
  const s1 = SCHED([job({ result: 'failed' }), job({ result: 'failed' })]);
  assert.equal(A.context(m('crons'), A.ALL, s1, DEV), '2 jobs need a look');
  assert.equal(A.context(m('crons'), A.ALL, SCHED([job({ result: 'failed' })]), DEV), '1 job needs a look');
  assert.equal(A.context(m('crons'), A.ALL, SCHED([job({})]), DEV), 'Nothing failing now');
  assert.equal(A.context(m('crons'), A.ALL, null, DEV), 'Job list not available');
  assert.equal(A.context(m('ci'), A.ALL, s1, DEV), '2 checks are failing');
  assert.equal(A.context(m('ci'), A.ALL, s1, { github: { failing_main: [] } }), 'Everything is green');
  assert.equal(A.context(m('ci'), A.ALL, s1, null), 'Checks not available');
  assert.equal(A.context(m('bugs'), 'meshchat', null, null), 'On meshchat');
  assert.equal(A.context(m('bugs'), A.ALL, null, null), 'On everything we ship');
});

test('every message is plain text under 1500, ends with the rules, and names its target', () => {
  const s = SCHED([job({ name: 'fleet-health-check', result: 'failed', detail: 'exit-code exit 1' })]);
  for (const mission of A.MISSIONS) {
    for (const t of [A.ALL, 'meshchat']) {
      const d = A.draft(mission.id, t, s, DEV);
      assert.ok(Array.from(d).length <= A.MAX && d.length > 80, mission.id);
      assert.ok(d.endsWith(A.RULES), mission.id + ' keeps its rules');
      assert.ok(!/[\u0000-\u0008\u000B-\u001F]/.test(d));
      assert.match(d, /never push main/);
      assert.match(d, /never deploy/);
      assert.match(d, /never spend money/);
    }
  }
  assert.match(A.draft('bugs', 'meshchat', s, DEV), /^Find bugs in meshchat\./);
  assert.match(A.draft('bugs', A.ALL, s, DEV), /^Find bugs in everything we ship/);
  assert.match(A.draft('security', 'protocol-guide', s, DEV), /^Review the security of protocol-guide\./);
  assert.match(A.draft('upgrades', 'judgefinder', s, DEV), /three upgrades to judgefinder/);
  assert.match(A.draft('polish', 'meshchat', s, DEV), /^Polish meshchat\./);
  assert.match(A.draft('profit', A.ALL, s, DEV), /Facebook Marketplace, eBay, Amazon, Walmart, OfferUp and Etsy/);
  assert.match(A.draft('profit', A.ALL, s, DEV), /without asking me/);
  assert.equal(A.draft('nope', A.ALL, s, DEV), '');
});

test('a hostile target name is never put in a message', () => {
  const d = A.draft('bugs', 'x; rm -rf /', null, null);
  assert.match(d, /^Find bugs in everything we ship/);
  assert.ok(!d.includes('rm -rf'));
});

test('cron message lists the failing jobs with host, result and detail; a long list is cut whole and says how many more', () => {
  const s = SCHED([job({ name: 'fleet-health-check', result: 'failed', detail: 'exit-code exit 1' }), job({ name: 'asc-watch', host: 'dell', result: 'overdue' })]);
  const d = A.draft('crons', A.ALL, s, DEV);
  assert.match(d, /failing right now \(2\)/);
  assert.match(d, /- fleet-health-check \(pc-desktop\), failed: exit-code exit 1/);
  assert.match(d, /- asc-watch \(dell\), overdue/);
  const big = SCHED(Array.from({ length: 40 }, (_, i) => job({ name: 'job-number-' + i + '-' + 'x'.repeat(50), result: 'failed', detail: 'd'.repeat(60) })));
  const longMsg = A.draft('crons', A.ALL, big, DEV);
  assert.ok(Array.from(longMsg).length <= A.MAX);
  assert.match(longMsg, /\(40\)/);
  assert.match(longMsg, /\n\+ \d+ more, in the same order the deck lists them\n/);
  assert.ok(longMsg.endsWith(A.RULES));
  const lines = longMsg.split('\n').filter((l) => l.startsWith('- '));
  assert.ok(lines.length >= 5 && lines.every((l) => l.includes('failed')), 'whole lines only');
  const shown = lines.length, more = +/\+ (\d+) more/.exec(longMsg)[1];
  assert.equal(shown + more, 40);
});

test('with nothing failing the cron and CI messages still work and say so', () => {
  assert.match(A.draft('crons', A.ALL, SCHED([job({})]), DEV), /None showed as failing/);
  assert.match(A.draft('crons', A.ALL, null, null), /None showed as failing/);
  assert.match(A.draft('ci', A.ALL, null, { github: { failing_main: [] } }), /No checks showed as failing/);
  const ci = A.draft('ci', A.ALL, null, DEV);
  assert.match(ci, /- meshchat: iOS build and unit tests/);
  assert.match(ci, /Do not merge\./);
});

test('Missions: the missions first (five, then Show more), the target chips under them (saved one pressed), no intro paragraph', () => {
  const v = A.missions(SCHED([job({ result: 'failed' })]), DEV, 'meshchat', {});
  assert.equal(v.t, 'meshchat');
  assert.match(v.html, /^<section class="sect"><h2 class="secttl"><span>Missions<\/span><\/h2>/);
  assert.match(v.html, /class="agt on" data-t="meshchat" aria-pressed="true"/);
  assert.match(v.html, /class="agt" data-t="all" aria-pressed="false">Everything</);
  assert.equal((v.html.match(/class="agt/g) || []).length, 1 + 5);
  assert.deepEqual(v.html.match(/data-m="[a-z]+"/g), ['data-m="crons"', 'data-m="ci"', 'data-m="bugs"', 'data-m="security"', 'data-m="upgrades"']);
  assert.match(v.html, /data-lmore="missions">Show 2 more</);
  assert.match(v.html, /<button type="button" class="frow agm" data-m="crons" data-key="m:crons"><span class="fl"><b>Fix failing crons<\/b><small>[^<]+<\/small><\/span><span class="fr"><small class="cx">1 job needs a look<\/small>/);
  assert.ok(v.html.indexOf('data-m="crons"') < v.html.indexOf('class="chips scroll agtgt"'), 'the first data is a mission, the target chips follow');
  assert.doesNotMatch(v.html, /Nothing starts until|Hermes runs them/);
  const open = A.missions(null, DEV, A.ALL, { open: 25 });
  assert.equal((open.html.match(/data-m="/g) || []).length, 7);
  assert.doesNotMatch(open.html, /data-lmore="missions">Show \d+ more/);
  assert.equal(A.missions(null, DEV, 'gone-repo', {}).t, 'all');
  assert.equal(A.missions(null, null, 'meshchat', {}).t, 'all');
  assert.ok(!/<script|onerror|javascript:/i.test(v.html));
});

test('Missions under search: only the missions that match, all of them; no match hides the section', () => {
  const v = A.missions(null, DEV, A.ALL, { q: 'fix' });
  assert.deepEqual(v.html.match(/data-m="[a-z]+"/g), ['data-m="crons"', 'data-m="ci"', 'data-m="bugs"', 'data-m="polish"']);
  assert.equal(A.missions(null, DEV, A.ALL, { q: 'zzzz' }).html, '');
});

test('glue: missions open the composer, the page itself never POSTs, launches go through deck.js postLaunchItem', () => {
  const glue = src.slice(src.indexOf('// ==== AGENTS UI HELPERS END ===='));
  assert.match(glue, /DeckPages\.get\(p,\{timeout:LaunchUI\.TIMEOUT_MS\}\)/);
  // the launch reads wait together; the apps read (GET /api/apps, bounded like the rest) goes on its own and never holds them
  assert.match(glue, /async function load\(force\)\{appsLoad\(\);if\(busy\)return;busy=true;try\{const need=force\|\|!LN\.f\|\|Date\.now\(\)-LN\.t>300000,\{f,sf,df\}=await LaunchUI\.load\(get,need\);/);
  assert.match(glue, /function appsLoad\(\)\{if\(appsBusy\)return;appsBusy=true;\s*LaunchUI\.bounded\(get\('apps'\)\)\.then\(a=>\{/);
  assert.match(glue, /openCompose\(AgentsUI\.draft\(m\.dataset\.m,LN\.target,LN\.sf,LN\.df\),m\)/);
  assert.match(glue, /await postLaunchItem\(b\.dataset\.id,'hermes'\)/);
  assert.match(glue, /DeckPages\.register\('home\/launch',/);
  assert.doesNotMatch(src, /method:\s*'POST'|fetch\(|XMLHttpRequest/);
});
