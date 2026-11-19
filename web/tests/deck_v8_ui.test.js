// node --test tests/deck_v8_ui.test.js (Crons, Launch run window, Fleet board and feed-scoped Home; no DOM or network)
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

const NOW = Date.UTC(2026, 9, 1, 23, 0, 0);
const iso = (agoS) => new Date(NOW - agoS * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
const T = (agoS) => NOW / 1000 - agoS;
const job = (o) => Object.assign({ name: 'Job', id: 'abcd1234', schedule_display: 'every 2h', state: 'scheduled', enabled: true, provider: 'anthropic', model: 'claude-opus-5-5', lane: 'CLAUDE', last_run_at: iso(3600), last_status: 'ok', next_run_at: iso(-3600) }, o);

// ---------------- Crons: the Hermes job sheet's lane (the page itself moved to schedules.js, tests/homeops_crons.test.js) ----------------
test('crons: lane label is trusted only from the fixed word list', () => {
  assert.equal(D.laneOf({ lane: 'CLAUDE' }), 'CLAUDE');
  assert.equal(D.laneOf({ lane: 'NO MODEL' }), 'NO MODEL');
  assert.equal(D.laneOf({ lane: '<img src=x>' }), 'OTHER');
  assert.equal(D.laneOf(null), 'OTHER');
  assert.match(D.cronSheet(job({ lane: '<b>' }), false, NOW).lines.join('\n'), /^Lane: OTHER$/m);
});


// ---------------- Launch run window ----------------
const run = (m, o) => Object.assign({ run_id: 'run_1', name: 'Deck audit', opened: NOW / 1000 - 10, model: m, got: NOW - 2000, err: '', fails: 0 }, o);

test('run window: queued, running, done, failed each get a sentence, mark and elapsed clock', () => {
  const q = D.runView(run({ state: 'queued', elapsed_s: 0, lines: [] }), NOW);
  assert.deepEqual([q.state, q.label, q.mark, q.terminal], ['queued', 'Queued', 'warn', false]);
  assert.match(q.html, /Queued\. No output yet/);
  const r = D.runView(run({ state: 'running', elapsed_s: 5, lines: ['tool read_file: SKILL.md'] }), NOW);
  assert.deepEqual([r.state, r.label, r.terminal], ['running', 'Working: reading files', false]);
  assert.equal(r.elapsed, '0:07');
  assert.match(r.html, /<span class="tx">Reading SKILL\.md<\/span>/);
  const d = D.runView(run({ state: 'done', elapsed_s: 75.4, lines: ['Final answer'] }), NOW);
  assert.deepEqual([d.label, d.mark, d.terminal, d.elapsed], ['Done', 'ok', true, '1:15']);
  assert.match(d.html, /<p>Final answer<\/p>/);
  const f = D.runView(run({ state: 'failed', elapsed_s: 3725, lines: ['error: provider said no'] }), NOW);
  assert.deepEqual([f.label, f.mark, f.elapsed], ['Failed', 'bad', '1:02:05']);
  assert.match(f.html, /class="rerr"[^]*Error: provider said no/);
});

test('run window: before the first poll it shows queued and counts from the tap', () => {
  const v = D.runView({ run_id: 'run_1', name: 'X', opened: NOW / 1000 - 12, model: null, got: 0 }, NOW);
  assert.deepEqual([v.state, v.elapsed], ['queued', '0:12']);
  assert.match(v.html, /Waiting for Hermes to start/);
  assert.equal(v.note, '');
  assert.doesNotMatch(JSON.stringify(v), /run_1|gateway|\/v1\/runs/);
});

test('run window: output is escaped, empty states are explained, long output says how much is hidden', () => {
  const v = D.runView(run({ state: 'done', elapsed_s: 1, lines: ['<img src=x onerror=alert(1)>'], more: 7 }), NOW);
  assert.doesNotMatch(v.html, /<img/);
  assert.match(v.html, /&lt;img src=x/);
  assert.match(v.html, /7 earlier lines not shown/);
  assert.match(D.runView(run({ state: 'done', elapsed_s: 1, lines: [] }), NOW).html, /Finished with no output/);
  assert.match(D.runView(run({ state: 'failed', elapsed_s: 1, lines: [] }), NOW).html, /Failed with no output/);
  assert.match(D.runView(run({ state: 'running', elapsed_s: 1, lines: [] }), NOW).html, /Running\. Waiting for output/);
});

test('run window: a poll error keeps the last output and says so in words; an unknown state never reads as done', () => {
  const v = D.runView(run({ state: 'running', elapsed_s: 2, lines: ['still here'] }, { err: 'http 502', fails: 1 }), NOW);
  assert.match(v.html, /still here/);
  assert.equal(v.note, 'Connection lost, trying again');
  assert.doesNotMatch(v.note, /502/);
  assert.equal(v.stale, true);
  assert.equal(D.runView(run({ state: 'done', elapsed_s: 2, lines: [] }, { err: 'timed out' }), NOW).note, 'Could not refresh this run');
  assert.equal(D.runView(run({ state: 'bogus', lines: [] }), NOW).state, 'queued');
});


// ---------------- Launch: OMP retired ----------------
test('launch: OMP is not a button, a tag, a facet or a saved filter', () => {
  const it = D.launchItems({ items: [{ id: 'skill:a', kind: 'skill', name: 'A', targets: ['hermes'], where: ['omp', 'hermes', 'dell'] }] });
  assert.deepEqual(it[0].where, ['hermes', 'dell']);
  assert.deepEqual(D.launchFacets(it).where.map((w) => w.w), ['dell', 'hermes']);
  // the rows themselves: tests/homeops_launch.test.js (LaunchUI)
  const items = D.launchItems({ items: [{ id: 'skill:a', kind: 'skill', name: 'A', targets: ['omp', 'hermes'], arg: 'a' }, { id: 'skill:b', kind: 'skill', name: 'B', targets: ['omp'], arg: 'b' }] });
  assert.deepEqual(items.map((x) => x.targets), [['hermes'], []]);
});


// ---------------- Fleet board ----------------
const board = (o) => Object.assign({
  machines: { src: '~/.local/state/fleet-disks.json', t: T(30), age: 30, stale: false, items: [
    { name: 'pc-desktop', reachable: true, drives: [{ label: 'System', used_gb: 626.2, free_gb: 310.9, total_gb: 951.8, pct: 67 }] },
    { name: 'Spark', reachable: false, drives: [] },
    { name: 'Ascent', reachable: null, drives: [], note: 'not in snapshot' },
    { name: 'Dell', reachable: true, drives: [{ label: 'System', used_gb: 320.2, free_gb: 149.4, total_gb: 474.9, pct: 95 }] },
    { name: 'Mac Mini', reachable: true, drives: [{ label: 'WD 1TB', used_gb: 403.9, free_gb: 527.2, total_gb: 931.3, pct: 43 }] }] },
  cluster: { ok: true, model: 'glm-5.3-flash-uncensored', running: 0, waiting: 0, kv_cache_pct: 12.3, src: 'live http://127.0.0.1:8080/v1/models + /metrics', t: T(4),
    bench: { file: 'cluster-bench-20261001.json', date: '2026-10-01', t: T(600), stale: false, src: '~/.hermes/cache/scratch/cluster-bench-20261001.json', fields: [{ k: 'prose_tps', v: 42.5 }, { k: 'code_tps', v: 40 }] } },
  models: { src: '~/.meshvault/status/deck/device-models.json', t: T(100), stale: false, devices: [{ device: 'Spark', models: ['glm-5.3-flash'] }, { device: 'Dell', models: [] }] },
  backup: { src: '~/.meshvault/status/deck/gitsync.json', t: T(900), stale: false, refresh: 1800, basis: 'local tracking refs; no fetch or GitHub verification', hosts: [
    { host: 'pc-desktop', label: 'Desktop', checkouts: 250, repos: 190, own_repos: 152, clean: 140, unpushed: 0, no_remote: 0, dirty: 3, third_party: 38, unknown: 0, stale_s: 0 },
    { host: 'mac-mini', label: 'Mac mini', checkouts: 31, repos: 27, own_repos: 23, clean: 20, unpushed: 3, no_remote: 0, dirty: 0, third_party: 4, unknown: 0, stale_s: 0 },
    { host: 'dell', label: 'Dell', checkouts: null, repos: null, own_repos: null, clean: null, unpushed: null, no_remote: null, dirty: null, third_party: null, unknown: null, stale_s: null, error: 'unreachable' }],
    unpushed: [{ host: 'mac-mini', repo: 'projects/meshvault/ios-app', branch: 'premium/deck', ahead: 4 }, { host: 'mac-mini', repo: 'work/notes', branch: 'main', ahead: 1 }, { host: 'pc-desktop', repo: 'work/other', branch: 'main', ahead: 9 }] },
  units: { src: '~/.meshvault/status/deck/fleet.json', t: T(60), stale: false, ok: true, writer_ok: true, count: 2, failed_units: ['mcp-liveness-sweep.service', 'broker-gov-deals.service'] },
}, o);

test('fleet signals carry no age in their title and show unavailable values without inventing a live flight or outbound count', () => {
  const feed = { t: T(12), thermal: { src: 'fleet-temps', t: T(30), hosts: {
    'pc-desktop': { cpu_c: 61, cpu_sensor: 'Tctl', gpu_c: 57 },
    spark: { soc_c: 50, gpu_c: 55 },
  }, findings: [] }, outbound: { src: 'queue files', legacy_queue: { files: 3 }, quote_followup_queue: { files: 1 }, drafts: null, outbound_agents: null },
  flightradar: { installed: true, live_state_observed: false },
  neighbors: { cached_reachable_count: 2, src: '/proc/net/arp', discovery: false } };
  const h = D.fleetSignals(feed, NOW);
  assert.match(h, /^<div class="secttl"><span>Fleet signals<\/span><\/div>/, 'design v3: no "Updated" in the title');
  assert.match(h, /pc-desktop[^]*61\u00B0C[^]*Tctl/);
  assert.match(h, /Drafts unknown[^]*agents unknown/);
  assert.match(h, /live aircraft not checked/);
  assert.match(h, /2 known devices \u00B7 no new scan/);
  assert.match(D.fleetSignals(null, NOW), /not reporting/);
  assert.doesNotMatch(D.fleetSignals(null, NOW), /0 flights|0 agents|0 drafts/);
});

test('thermal signals preserve CPU, SoC and skin sensor identities', () => {
  const h = D.fleetSignals({ thermal: { hosts: {
    cpu: { cpu_c: 67, cpu_sensor: 'k10temp/Tctl' },
    soc: { soc_c: 92, soc_sensor: 'acpitz/max zone', gpu_c: 80 },
    skin: { skin_c: 34, thermal_status: 0 },
  } } }, NOW);
  assert.match(h, /CPU 67\u00B0C/);
  assert.match(h, /SoC 92\u00B0C[^]*acpitz\/max zone/);
  assert.match(h, /Skin 34\u00B0C/);
  assert.doesNotMatch(h, /CPU (?:92|34)\u00B0C/);
});

test('fleet board: machines show reachability, disk used and free; unreachable and unknown are not zero', () => {
  const h = D.board(board(), NOW)[0];
  assert.match(h, /^<div class="secttl"><span>Machines<\/span><\/div>/);
  assert.match(h, /pc-desktop<\/div><div class="v">Up/);
  assert.match(h, /System \u00B7 626 GB used \u00B7 311 GB free \u00B7 67%/);
  assert.match(h, /<i class="sd bad"><\/i>Spark<\/div><div class="v">Down/);
  assert.match(h, /disk sizes are unknown/);
  // A machine left out of the snapshot is Not checked with its own cause, never down.
  assert.match(h, /<i class="sd off"><\/i>Ascent<\/div><div class="v">Not checked/);
  assert.match(h, /This machine was left out of the last snapshot\./);
  assert.match(h, /bar hot/);
});

test('fleet board: cluster has model, running, waiting, KV cache percent and the latest bench with its date', () => {
  const h = D.board(board(), NOW)[1];
  assert.match(h, /glm-5\.3-flash-uncensored/);
  assert.match(h, /Running 0 \u00B7 waiting 0/);
  assert.match(h, /Cache 12\.3% full/);
  assert.match(h, /<b>Latest benchmark<\/b><\/span><span class="fr"><small>Oct 1<\/small>/, 'the bench date in the deck format, never ISO');
  // the same figure list as Cluster's (V13): a label, the figure, its unit
  assert.match(h, /<b>Writing<\/b><\/span><span class="fr"><b class="fig">42\.5<\/b><small>tok\/s<\/small>/);
  assert.match(h, /<b>Coding<\/b><\/span><span class="fr"><b class="fig">40\.0<\/b><small>tok\/s<\/small>/);
  assert.match(D.board(board({ cluster: { ok: true, model: 'm', running: 0, waiting: 0, kv_cache_pct: 1, t: T(1), bench: { file: 'f.json', date: '2026-10-01', t: T(5), fields: [{ k: 'prose_median', v: 21.74 }, { k: 'model', v: 'x' }] } } }), NOW)[1], /<b>Writing<\/b><\/span><span class="fr"><b class="fig">21\.7<\/b>/);
  assert.match(h, /class="diag">Measured 10 min ago</);
  assert.match(h, /class="diag">cluster-bench-20261001\.json</);
});

test('fleet board: missing bench, missing KV and a dead cluster read unavailable, never zero', () => {
  let h = D.board(board({ cluster: { ok: true, model: 'm', running: 1, waiting: null, kv_cache_pct: null, t: T(1), bench: { error: 'no bench file', src: '~/.hermes/cache/scratch/cluster-bench-*.json' } } }), NOW)[1];
  assert.match(h, /waiting --/);
  assert.match(h, /Cache not reported/);
  assert.match(h, /No benchmark yet[^]*no bench file/);
  h = D.board(board({ cluster: { ok: false, model: null, running: null, waiting: null } }), NOW)[1];
  assert.match(h, /not reachable/i);
  assert.doesNotMatch(h, /running 0|waiting 0/);
});

test('fleet board: models by device says unknown when the file is missing or empty', () => {
  let m = D.board(board({ models: { error: 'file missing', src: '~/.meshvault/status/deck/device-models.json' } }), NOW)[2];
  assert.match(m, /Models by device are not reporting/);
  assert.match(m, /Nothing has been collected yet/);
  m = D.board(board({ models: { src: 'x', t: T(1), stale: false, devices: [] } }), NOW)[2];
  assert.match(m, /No devices listed/);
  m = D.board(board(), NOW)[2];
  assert.match(m, /Spark<\/b><small>glm-5\.3-flash/);
  assert.match(m, /Dell<\/b><small>No models reported/);
});

test('fleet board: Code backup presents local estimates, unknowns and missing sources honestly', () => {
  const h = D.board(board(), NOW)[3];
  assert.match(h, /<span>Code backup<\/span>/);
  assert.match(h, /<b>Desktop<\/b><small>No local commits ahead<\/small>/);
  assert.match(h, /<b>Mac mini<\/b><small>3 repos have local commits ahead/);
  assert.match(h, /data-sync="mac-mini"/);
  assert.match(h, /Local refs only\. Remote backup is not verified\./);
  assert.match(h, /<b>Dell<\/b><small>Not checked yet \u00b7 unreachable<\/small>/);
  assert.doesNotMatch(h, /frow bad|tile bad|pill bad|unavailable|All \d+ repos pushed|\bPushed\b|\bTo push\b/i);
  for (const missing of [undefined, { error: 'file missing', src: '~/.meshvault/status/deck/gitsync.json' }, { src: 'x', hosts: [] }]) {
    const m = D.board(board({ backup: missing }), NOW)[3];
    assert.match(m, /Backup status not reported yet/);
    assert.doesNotMatch(m, /unavailable|es-bad|class="frow/i);
  }
  const s = D.syncSheet(board().backup, 'mac-mini', NOW);
  assert.equal(s.title, 'Mac mini');
  assert.match(s.lines.join('\n'), /3 repos have local commits ahead[^]*Unique repos: 27[^]*Owner repos: 23[^]*Repos with local commits ahead: 3/);
  assert.deepEqual(s.log, ['projects/meshvault/ios-app \u00B7 premium/deck \u00B7 4 ahead', 'work/notes \u00B7 main \u00B7 1 ahead']);
  const d = D.syncSheet(board().backup, 'dell', NOW);
  assert.match(d.lines.join('\n'), /Repos with local commits ahead: unknown/);
  assert.equal(D.syncSheet(null, 'dell', NOW).lines[0], 'Backup status is not reported yet.');
  assert.equal(D.syncLine({ own_repos: 1, unpushed: 0 }), 'No local commits ahead');
  assert.equal(D.syncLine({ own_repos: 9, unpushed: 1 }), '1 repo has local commits ahead');
});

test('fleet board: failing units are calm rows (a mark and a word), the header carries the count, an empty list is a real all-clear, a failed writer is unavailable', () => {
  let h = D.board(board(), NOW)[4];
  assert.match(h, /<span>Background services<\/span><span>2 need attention<\/span>/);
  assert.match(h, /data-unit="mcp-liveness-sweep\.service"[^>]*class="frow"><span class="fl"><b>MCP liveness sweep<\/b>/);
  assert.equal((h.match(/class="frow"/g) || []).length, 2, 'one row per unit');
  assert.equal((h.match(/<span class="pill"><i class="sd bad"><\/i>Failed<\/span>/g) || []).length, 2);
  assert.doesNotMatch(h, /frow bad|tile bad|pill bad/, 'no red fill on a failing unit');
  assert.equal(D.unitLabel('app-remmina\\x2dapplet@autostart.service'), 'app-remmina-applet@autostart');
  h = D.board(board({ units: { src: 'x', t: T(5), stale: false, ok: true, writer_ok: true, count: 0, failed_units: [] } }), NOW)[4];
  assert.match(h, /All services are running/);
  assert.doesNotMatch(h, /need attention/);
  h = D.board(board({ units: { src: 'x', t: T(5), stale: false, writer_ok: false, failed_units: [] } }), NOW)[4];
  assert.match(h, /could not check services[^]*systemctl/);
  assert.doesNotMatch(h, /All services are running/);
  h = D.board(board({ units: { error: 'file missing', src: 'x' } }), NOW)[4];
  assert.match(h, /deck-fleet-snapshot/);
  assert.doesNotMatch(h, /All services are running/);
});

test('fleet board: stale data says Out of date in its title, without an age; a dead board reports unavailable', () => {
  const old = board({ machines: { src: 'x', t: T(5000), stale: true, items: [{ name: 'pc-desktop', reachable: true, drives: [] }] } });
  assert.match(D.board(old, NOW)[0], /<span>Machines<\/span><span>Out of date<\/span>/);
  const d = D.board(null, NOW);
  assert.match(d[0], /not reporting/);
});

// ---------------- Run window: offline, heartbeat, give-up (video review A12) ----------------

test('run window: a run that is not finished says when Hermes last answered; a finished run does not', () => {
  const v = D.runView(run({ state: 'running', elapsed_s: 1, lines: [], t: T(120) }), NOW);
  assert.equal(v.state, 'running');
  assert.match(v.html, /Running\. Waiting for output/);
  assert.match(v.html, /<div class="rl dim hb">Last word from Hermes 2 min ago<\/div>/);
  assert.match(D.runView({ run_id: 'run_1', name: 'X', opened: NOW / 1000 - 5, model: null, got: 0 }, NOW).html, /No word from Hermes yet/);
  for (const state of ['done', 'failed']) {
    const d = D.runView(run({ state, elapsed_s: 30, lines: ['x'] }, { err: 'hermes gateway unreachable', fails: 25, offline: true }), NOW);
    assert.equal(d.state, state);
    assert.equal(d.gaveUp, false);
    assert.doesNotMatch(d.html, /Last word|No word|Stopped retrying/);
  }
});

test('run window: queued past 45 s while Hermes answers reads Stuck in queue with how long it waited', () => {
  assert.equal(D.RUN_QUEUE_TIMEOUT_S, 45);
  const fresh = D.runView(run({ state: 'queued', elapsed_s: 10, lines: [] }), NOW);
  assert.deepEqual([fresh.state, fresh.reason], ['queued', '']);
  const v = D.runView(run({ state: 'queued', elapsed_s: 44, lines: [] }, { got: NOW - 2000 }), NOW);
  assert.deepEqual([v.state, v.label, v.mark, v.terminal, v.reason, v.stale], ['offline', 'Stuck in queue', 'bad', false, 'Stuck in queue', true]);
  assert.match(v.html, /Stuck in queue\. Queued 0:46, Hermes answers but has not started it/);
  assert.match(v.note, /^Stuck in queue \u00B7 retrying$/);
  // a queued run whose gateway also went silent is Hermes offline, not stuck
  const g = D.runView(run({ state: 'queued', elapsed_s: 50, lines: [] }, { err: 'hermes gateway unreachable', fails: 2, offline: true }), NOW);
  assert.deepEqual([g.reason, g.label], ['Hermes offline', 'Hermes offline']);
  assert.match(g.html, /Queued \d+:\d\d and Hermes never started it/);
  // before the first poll the clock runs from the tap; the server can flag a stall too
  assert.equal(D.runView({ run_id: 'run_1', name: 'X', opened: NOW / 1000 - 60, model: null, got: 0 }, NOW).state, 'offline');
  assert.equal(D.runView(run({ state: 'queued', elapsed_s: 1, stalled: true, reason: 'Hermes offline', lines: [] }), NOW).state, 'offline');
});

test('run window: a silent gateway reads Hermes offline, a silent deck server says so, polling never stops silently', () => {
  const g = D.runView(run({ state: 'running', elapsed_s: 9, lines: ['still here'] }, { err: 'hermes gateway unreachable', fails: 1, offline: true }), NOW);
  assert.deepEqual([g.state, g.reason, g.stale], ['offline', 'Hermes offline', true]);
  assert.match(g.html, /still here/);
  const d = D.runView(run({ state: 'running', elapsed_s: 9, lines: [] }, { err: 'deck server did not answer', fails: 3 }), NOW);
  assert.deepEqual([d.state, d.reason, d.label], ['offline', 'Deck server not answering', 'Deck server not answering']);
  assert.equal(D.runView(run({ state: 'running', elapsed_s: 9, lines: [] }, { err: 'timed out', fails: 1 }), NOW).state, 'running');
  const q = D.runView(run({ state: 'running', elapsed_s: 9, lines: [] }, { err: 'hermes gateway unreachable', fails: D.RUN_GIVEUP, offline: true }), NOW);
  assert.equal(q.gaveUp, true);
  assert.match(q.html, /Stopped retrying after 20 failed polls\. Tap Last run to try again\./);
  assert.match(q.note, /stopped retrying$/);
  assert.equal(D.runView(run({ state: 'running', elapsed_s: 9, lines: [] }, { err: 'x', fails: 19, offline: true }), NOW).gaveUp, false);
});


// ---------------- Fleet page: never a blank body (A20) ----------------
const okFleet = () => ({ items: [{ head: 'disk', text: 'x', tag: '' }], stamp: 'x', cluster: { ok: true }, services: { items: [{ unit: 'u', state: 'active', ok: true }] }, reach: { items: [{ name: 'Spark', ok: true, ms: 3 }] } });
const okParts = () => ({ f: okFleet(), nd: { nodes: [{ label: 'Spark' }] }, dk: { drives: [{ host: 'pc' }] }, st: { items: [{ name: 'a-b', ok: true }] }, mc: { up: 1, down: 0 }, bd: board() });

test('fleet notice: all sources failing is one tile that names every reason', () => {
  const dead = { error: 'deck server did not answer' };
  const n = D.fleetNotice({ f: { error: 'http 500', items: [] }, nd: dead, dk: dead, st: dead, mc: dead, bd: null });
  assert.equal(n.blank, true);
  assert.match(n.html, /<div class="tile bad why" role="status">/);
  assert.match(n.html, /Nothing to show/);
  assert.deepEqual(n.reasons.slice(0, 3), ['Fleet facts: http 500', 'GB10 nodes: deck server did not answer', 'Disks: deck server did not answer']);
  assert.ok(n.reasons.length <= 6);
});

test('fleet notice: empty lists say why, a thrown read says why, nothing is blank, text is escaped', () => {
  const e = D.fleetNotice({ f: { items: [], empty_reason: 'fleet-facts exited 2 and printed no facts' }, nd: { nodes: [] }, dk: { drives: [] }, st: { items: [] }, mc: { up: 0, down: 0 }, bd: { machines: { error: 'file missing' } } });
  assert.equal(e.blank, true);
  assert.match(e.html, /fleet-facts exited 2 and printed no facts/);
  assert.match(e.html, /GB10 nodes: none reported/);
  assert.match(e.html, /Fleet board: every source is unavailable/);
  const t = D.fleetNotice({ err: 'http 502' });
  assert.equal(t.blank, true);
  assert.match(t.html, /Fleet read failed: http 502/);
  assert.match(D.fleetNotice(null).html, /Nothing to show/);
  assert.doesNotMatch(D.fleetNotice({ err: '<img src=x>' }).html, /<img/);
});

test('fleet notice: any real data keeps the normal page; a partial read is not blank', () => {
  assert.equal(D.fleetNotice(okParts()).blank, false);
  assert.equal(D.fleetNotice(okParts()).reasons.length, 0);
  const p = okParts();
  p.nd = { error: 'nodes.json missing' };
  p.bd = null;
  const n = D.fleetNotice(p);
  assert.equal(n.blank, false);
  assert.ok(n.reasons.includes('GB10 nodes: nodes.json missing'));
});


