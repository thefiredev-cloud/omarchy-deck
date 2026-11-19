// node --test tests/homeops_crons.test.js  (Home > Crons: filters, paging, rows, sheet, Data sheet; no DOM, no network)
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const deck = read('static/deck.js');
const DeckUI = new Function(cut(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const src = read('static/schedules.js');
const S = new Function('DeckUI', cut(src, '// ==== SCHEDULES UI HELPERS BEGIN', '// ==== SCHEDULES UI HELPERS END ====') + '\nreturn SchedUI;')(DeckUI);

const NOW = Date.UTC(2026, 10, 14, 20, 0, 0);
const T = (d) => NOW / 1000 + d;
const J = (o) => Object.assign({ id: 'x', name: 'Job', host: 'pc-desktop', kind: 'systemd', schedule: 'every 1h', enabled: true, last: T(-600), next: T(1800), result: 'ok', detail: '' }, o);
const G = (id, label, jobs, o) => Object.assign({ id, label, host: 'pc-desktop', kind: 'systemd', ok: true, error: null, n: jobs.length, jobs }, o);
const FEED = (groups, o) => Object.assign({ t: T(-20), age: 20, refresh: 300, stale: false, errors: [], sources: [], counts: {}, groups }, o);
const rows = (h) => (h.match(/class="frow scrow/g) || []).length;
const vis = (h) => h.replace(/<span class="diag">[^]*?<\/span>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const sect = (f, filter, q, n) => S.section(f, NOW, { filter, q: q || '', n });

const MIX = FEED([G('hermes', 'Hermes jobs', [J({ name: 'Brief', kind: 'hermes' }), J({ name: 'Bad', result: 'failed' }),
  J({ name: 'Late', result: 'overdue', last: T(-86400 * 3) }), J({ name: 'Mine', result: 'waiting', owner_wait: { reason: 'needs a sign-in', action: 'sign in to Gmail' } }),
  J({ name: 'Off', result: 'paused', enabled: false, next: null })], { retired: [{ name: 'merged-away', merged_into: 'batch-a', at: T(-3600) }] }),
G('dell-systemd', 'dell timers', [], { host: 'dell', ok: false, error: 'ssh: connect timed out', last_known: { n: 12, active: 9, t: T(-7200) } })]);

test('filters: Active by default, Failing is real failures only, Overdue, All includes paused and retired rows', () => {
  assert.deepEqual(S.FILTERS.map((f) => f[1]), ['Active', 'Failing', 'Overdue', 'All']);
  const c = S.counts(MIX);
  assert.deepEqual([c.active, c.failing, c.overdue, c.all], [4, 1, 1, 6]);
  assert.equal(rows(sect(MIX, 'active')), 4);
  assert.deepEqual(S.listOf(MIX, 'failing', '').map((j) => j.name), ['Bad']);
  assert.deepEqual(S.listOf(MIX, 'overdue', '').map((j) => j.name), ['Late']);
  const all = S.listOf(MIX, 'all', '').map((j) => j.name);
  assert.equal(all.length, 6);
  assert.ok(all.includes('Off') && all.includes('merged-away'));
  // waiting on you is never a failure: it stays in Active and out of Failing
  assert.ok(!S.listOf(MIX, 'failing', '').some((j) => j.name === 'Mine'));
  assert.ok(S.listOf(MIX, 'active', '').some((j) => j.name === 'Mine'));
});

test('chips: one row, a count in each, the chosen one pressed; no signal fill words, no group chips', () => {
  const h = S.chips(S.counts(MIX), 'failing');
  assert.equal((h.match(/<button/g) || []).length, 4);
  assert.match(h, /class="scf" data-f="active" aria-pressed="false">Active <small>4<\/small>/);
  assert.match(h, /class="scf on" data-f="failing" aria-pressed="true">Failing <small>1<\/small>/);
  assert.match(h, /data-f="all" aria-pressed="false">All <small>6<\/small>/);
  assert.doesNotMatch(h, /dell timers|Hermes jobs|History|Needs a look/);
});

test('routes: ?f=all opens All, plain crons keeps the stored or default filter, old All crons views map onto the four', () => {
  assert.equal(S.filterOf('all', 'failing'), 'all');
  assert.equal(S.filterOf(undefined, null), 'active');
  assert.equal(S.filterOf(undefined, 'overdue'), 'overdue');
  assert.equal(S.filterOf(undefined, 'problem'), 'failing');
  assert.equal(S.filterOf(undefined, 'history'), 'all');
  assert.equal(S.filterOf(undefined, 'g:hermes'), 'active');
  assert.equal(S.filterOf('<script>', 'zzz'), 'active');
});

test('paging: 50 rows, then Show more with the next count; the sheet index matches the drawn row', () => {
  const many = FEED([G('a', 'A', Array.from({ length: 123 }, (_, i) => J({ name: 'job ' + String(i).padStart(3, '0'), next: T(60 + i) })))]);
  const first = sect(many, 'active');
  assert.equal(rows(first), 50);
  assert.match(first, /data-sched-more>Show 50 more</);
  assert.equal(rows(sect(many, 'active', '', 100)), 100);
  const last = sect(many, 'active', '', 150);
  assert.equal(rows(last), 123);
  assert.doesNotMatch(last, /data-sched-more/);
  assert.match(sect(many, 'active', '', 100), /Show 23 more/);
  const list = S.listOf(many, 'active', '');
  assert.match(first, new RegExp('data-sched="7" data-key="pc-desktop\\|' + list[7].name + '"'));
});

test('search narrows the list by name, host and member; every word must match; no match is an empty state', () => {
  assert.deepEqual(S.listOf(MIX, 'all', 'BAD').map((j) => j.name), ['Bad']);
  assert.equal(S.listOf(MIX, 'all', 'pc-desktop brief').length, 1);
  const none = sect(MIX, 'all', 'zzz');
  assert.match(vis(none), /No job matches Try fewer words or another filter\./);
  assert.match(none, /class="es es-idle"/);
});

test('an empty filter is an empty state, never a blank list', () => {
  const ok = FEED([G('a', 'A', [J({})])]);
  assert.match(vis(sect(ok, 'failing')), /No failing jobs Every job ran fine the last time\./);
  assert.match(vis(sect(ok, 'overdue')), /No overdue jobs/);
  assert.doesNotMatch(sect(ok, 'failing'), /class="frow/);
});

test('rows: name, host, one time and a status; a failed job is red with a crossed mark, a waiting job uses the needs-you mark', () => {
  const okRow = S.row(S.norm(J({ name: 'asc-queue-run', schedule: '*-*-* *:00/30:00' }), G('p', 'pc', [])), NOW, 0);
  assert.match(okRow, /^<button type="button" class="frow scrow" data-sched="0"/);
  assert.match(okRow, /<b>asc-queue-run<\/b><small>pc-desktop<\/small>/);
  assert.match(okRow, /<span class="fr"><b>in 30 min<\/b><\/span>/);
  assert.doesNotMatch(okRow, /\*-\*-\*|pill/); // the schedule text is in the sheet; a healthy job carries no pill
  const bad = S.row(S.norm(J({ result: 'failed', detail: 'exit-code exit 1' })), NOW, 1);
  assert.match(bad, /scrow k-bad/);
  assert.match(bad, /<b>10 min ago<\/b><span class="pill bad"><span class="sd bad"><\/span>Failed<\/span>/);
  assert.doesNotMatch(bad, /exit-code/);
  const wait = S.row(S.norm(J({ result: 'waiting', owner_wait: { reason: 'needs a sign-in' } })), NOW, 2);
  assert.match(wait, /scrow k-wait/);
  assert.match(wait, /<span class="pill wait"><span class="sd wait"><\/span>Waits on you<\/span>/);
  assert.doesNotMatch(wait, /bad/);
  const od = S.row(S.norm(J({ result: 'overdue', last: T(-86400 * 3) })), NOW, 3);
  assert.match(od, /<b>3 d ago<\/b><span class="pill warn"><span class="sd warn"><\/span>Overdue/);
});

test('rows: running, never, paused, retired and unknown say what they are; a null time is never zero', () => {
  assert.match(S.row(S.norm(J({ result: 'running', next: null, started: T(-600) })), NOW, 0), /<b>10 min ago<\/b><span class="pill ok"><span class="sd ok"><\/span>Running/);
  assert.match(S.row(S.norm(J({ result: 'running', next: null, started: null })), NOW, 0), /<b>now<\/b>/);
  assert.match(S.row(S.norm(J({ result: 'never', last: null })), NOW, 0), /<b>in 30 min<\/b><span class="pill">Never ran/);
  const p = S.row(S.norm(J({ result: 'paused', enabled: false, next: null })), NOW, 0);
  assert.match(p, /scrow off/);
  assert.match(p, /<span class="fr"><span class="pill">Paused<\/span>/);
  assert.match(S.row(S.norm(J({ result: 'unknown', last: null, next: null })), NOW, 0), /<b>time unknown<\/b><span class="pill">Unknown/);
  assert.match(S.row(S.norm(J({ result: 'ok', enabled: true, next: null })), NOW, 0), /<b>not scheduled<\/b>/);
  const ret = S.listOf(MIX, 'all', 'merged');
  assert.match(S.row(ret[0], NOW, 0), /<span class="pill">Retired<\/span>/);
});

test('a batch row names how many members failed, and a stopped timer with a failed member stays in Active and Failing', () => {
  const members = [{ name: 'alpha', status: 'ok' }, { name: 'beta', status: 'failed', exit: 3, finished: T(-640) }, { name: 'gamma', status: 'unknown' }];
  const r = S.row(S.norm(J({ name: 'batch', result: 'paused', enabled: false, next: null, members })), NOW, 0);
  assert.match(r, /<small>pc-desktop \u00B7 1 of 3 members failed<\/small>/);
  assert.match(r, /pill bad/);
  const f = FEED([G('a', 'A', [J({ name: 'batch', result: 'paused', enabled: false, next: null, members })])]);
  assert.equal(S.listOf(f, 'active', '').length, 1);
  assert.equal(S.listOf(f, 'failing', '').length, 1);
});

test('order: failing first (newest first), waiting, running, soonest next, never, paused last', () => {
  const jobs = [J({ name: 'later', next: T(3600) }), J({ name: 'soon', next: T(60) }), J({ name: 'old fail', result: 'failed', last: T(-5000) }),
    J({ name: 'new fail', result: 'failed', last: T(-100) }), J({ name: 'paused', result: 'paused', enabled: false, next: null }),
    J({ name: 'run', result: 'running', next: null }), J({ name: 'never', result: 'never', next: null }), J({ name: 'mine', result: 'waiting' })];
  assert.deepEqual(S.sorted(jobs.map((j) => S.norm(j))).map((j) => j.name), ['new fail', 'old fail', 'mine', 'run', 'soon', 'later', 'never', 'paused']);
});

test('Hermes jobs, the ones with Run now, Pause and Resume, come right after what needs a look and say "Hermes job" on the row', () => {
  const timers = Array.from({ length: 80 }, (_, i) => J({ name: 'timer ' + i, next: T(30 + i) }));
  const hermes = Array.from({ length: 10 }, (_, i) => J({ name: 'Brief ' + i, kind: 'hermes', next: T(86400 + i) }));
  const f = FEED([G('pc', 'pc-desktop timers', timers.concat([J({ name: 'broken', result: 'failed' }), J({ name: 'mine', result: 'waiting' })])),
    G('hermes', 'Hermes jobs', hermes.concat([J({ name: 'Brief off', kind: 'hermes', result: 'paused', enabled: false, next: null }), J({ name: 'Brief bad', kind: 'hermes', result: 'failed' })]))]);
  const list = S.listOf(f, 'active', '').map((j) => j.name);
  assert.deepEqual(list.slice(0, 13), ['Brief bad', 'broken', 'mine'].concat(hermes.map((j) => j.name)));
  assert.ok(!list.includes('Brief off'), 'a paused Hermes job stays under All');
  const first = sect(f, 'active');
  assert.equal((first.match(/<span class="kd">Hermes job<\/span>/g) || []).length, 11, 'every Hermes job on the first page is marked');
  assert.match(S.row(S.norm(hermes[0]), NOW, 0), /class="frow scrow hj"[^>]*><span class="fl"><b>Brief 0<\/b><small><span class="kd">Hermes job<\/span> \u00B7 pc-desktop<\/small>/);
  assert.doesNotMatch(S.row(S.norm(timers[0]), NOW, 0), /Hermes|hj/);
});

test('hostile text and unknown result words are neutralised and escaped', () => {
  const n = S.norm(J({ result: '<script>', name: '<img src=x onerror=1>', host: '"><b>' }));
  assert.equal(n.result, 'unknown');
  const r = S.row(n, NOW, 0);
  assert.doesNotMatch(r, /<img|<script/);
  assert.match(r, /&lt;img src=x/);
  assert.match(r, /<small>&quot;&gt;&lt;b&gt;<\/small>/);
});

test('the page carries no source text: no group names, no Observed on, no history or truncation paragraphs; the list title is for screen readers', () => {
  const v = S.page(MIX, NOW, { filter: 'active', q: '' });
  const t = vis(v.bar + v.sect);
  assert.doesNotMatch(t, /Observed on|Not observed|in history|retired by consolidation|showing \d+ of|could not be read|dell timers|Hermes, timers|Updated/);
  assert.match(v.sect, /^(<div class="scneed"[^]*?<\/div>)?<div class="flist" id="sclist" role="group" aria-label="Active jobs">/);
  assert.doesNotMatch(v.sect, /<h2|class="secttl"/);
});

test('the control row: four chips and one select with the same counts, then Fix these while something needs a look (never under All)', () => {
  const b = S.bar(MIX, 'active');
  assert.match(b, /<div class="chips" id="scf" role="group" aria-label="Show jobs">/);
  assert.match(b, /<select class="btn scsel" id="scsel" aria-label="Show jobs"><option value="active" selected>Active \(4\)<\/option><option value="failing">Failing \(1\)<\/option><option value="overdue">Overdue \(1\)<\/option><option value="all">All \(6\)<\/option><\/select>/);
  // MIX has a failing job: the "Failing 1" chip, then Fix these, after the select (CSS shows the chip only where the select stands in)
  assert.match(b, /<\/select><button type="button" class="btn btn-sm scf scfail"[^]*<button type="button" class="btn btn-sm fix" data-fix="crons" aria-label="Fix these: opens a message about 2 failing jobs; nothing starts until you tap Send">Fix these<\/button>$/);
  assert.match(S.bar(MIX, 'failing'), /<\/select><button type="button" class="btn btn-sm fix" data-fix="crons" aria-label="Fix these: opens a message about 2 failing jobs; nothing starts until you tap Send">Fix these<\/button>$/);
  assert.doesNotMatch(S.bar(MIX, 'all'), /data-fix/);
  assert.doesNotMatch(S.bar(FEED([G('a', 'A', [J({})])]), 'active'), /data-fix/);
  assert.match(S.bar(MIX, 'overdue'), /<option value="overdue" selected>/);
});

test('a read that never settles ends in "Crons are not reporting" with Try again, never a blank page', async () => {
  const never = () => new Promise(() => {});
  const r = await S.load(never, 20);
  assert.deepEqual(r.f, { error: 'timed out' });
  const v = S.page(r.f, NOW, { filter: 'active', q: '' });
  assert.equal(v.broken, true);
  assert.match(vis(v.sect), /Crons are not reporting/);
  assert.match(v.sect, /data-retry="crons"/);
  // a read that rejects is the same not-reporting state; a good read passes through
  assert.equal((await S.load(() => Promise.reject(new Error('x')), 20)).f.error, 'no answer');
  const ok = await S.load((p) => Promise.resolve(p === 'schedules' ? MIX : { active: [] }), 20);
  assert.equal(ok.f, MIX);
  assert.equal(S.TIMEOUT_MS, 60000);
});

test('freshness: one mark from the feed age; a host that could not be read is a part not reporting; a missing feed is one part', () => {
  assert.deepEqual(S.fresh(MIX, NOW), { age: 20, refresh: 300, stale: false, missing: 1 });
  assert.equal(S.fresh(FEED([G('a', 'A', [J({})])], { stale: true }), NOW).stale, true);
  assert.equal(S.fresh(null, NOW).missing, 1);
});

test('Data sheet: groups as sources with coverage, the counts and rules that left the page, the unreadable host under Setup', () => {
  const d = S.data(FEED(MIX.groups.concat([G('github', 'GitHub Actions', [J({})], { n: 250 })])), NOW);
  assert.deepEqual(d.sources.map((s) => s.name), ['Hermes jobs', 'dell timers', 'GitHub Actions']);
  assert.equal(d.sources[1].state, 'blocked');
  assert.match(d.sources[1].gives, /Last seen 12 jobs, 2 h ago/);
  assert.equal(d.sources[2].gives, '1 of 250 jobs shown');
  const m = Object.fromEntries(d.method);
  assert.match(m.History, /^2 paused, finished or retired, never counted as active; 1 retired by consolidation$/);
  assert.match(m.Failing, /batch member failed/);
  assert.equal(d.setup.length, 1);
  assert.match(d.setup[0].line, /^Unknown, not zero\. ssh: connect timed out$/);
  assert.equal(S.data(null, NOW).sources[0].state, 'never');
});

test('a feed that did not report is one empty state with Try again; the bar is empty and the frame knows it is broken', () => {
  for (const f of [null, { error: 'file missing', src: '~/.kodros/status/deck/schedules.json' }]) {
    const v = S.page(f, NOW, { filter: 'all', q: '' });
    assert.equal(v.broken, true);
    assert.equal(v.bar, '');
    assert.match(vis(v.sect), /Crons are not reporting/);
    assert.match(v.sect, /data-retry="crons"/);
    assert.doesNotMatch(vis(v.sect), /schedules\.json|file missing/);
  }
});

test('detail sheet: plain words, host instead of source text, batch members, waits-on-you with how to clear it', () => {
  const n = S.norm(J({ name: 'Digest', kind: 'hermes', schedule: '0 7 * * *', last: T(-7200), next: T(3600) }), G('hermes', 'Hermes jobs', []));
  const sp = S.sheet(n, NOW, undefined, null);
  assert.equal(sp.kind, 'card');
  assert.equal(sp.sub, 'Scheduled job \u00B7 read only');
  const text = sp.lines.join('\n');
  assert.match(text, /^Schedule: Daily at 7 AM$/m);
  assert.match(text, /^Last run: OK \u00B7 2 h ago \u00B7 /m);
  assert.match(text, /^Next run: in 60 min \u00B7 /m);
  assert.match(text, /^Host: pc-desktop$/m);
  assert.match(text, /^Last output: reading\u2026$/m);
  assert.doesNotMatch(text, /Source:|list checked/);
  assert.deepEqual(sp.actions, [{ id: 'data', label: 'Data' }], 'a read-only sheet ends in Data');
  const w = S.sheet(S.norm(J({ result: 'waiting', owner_wait: { reason: 'needs a sign-in', action: 'sign in to Gmail' } })), NOW, null, null).lines.join('\n');
  assert.match(w, /^Waits on you: needs a sign-in\. To clear: sign in to Gmail$/m);
  const members = [{ name: 'p1', status: 'pending' }, { name: 'u1', status: 'unknown' }, { name: 'beta', status: 'failed', exit: 3, finished: T(-640) }];
  const b = S.sheet(S.norm(J({ members })), NOW, null, null).lines;
  assert.ok(b.indexOf('Batch members (3):') >= 0);
  assert.ok(b.findIndex((l) => l.startsWith('beta: failed \u00B7 exit 3 \u00B7 ended 11 min ago')) < b.findIndex((l) => l.startsWith('p1')));
});

test('a Hermes row that is exactly one Hermes job gets Run now, Pause or Resume (each a second tap) and Ask Hermes', () => {
  const hj = { id: 'e795b78200aa', name: 'Digest', schedule_display: '0 7 * * *', last_status: 'ok', last_run_at: new Date(NOW - 7200e3).toISOString() };
  const list = { active: [hj], paused: [{ id: 'aaaa1111ffff', name: 'Twin' }, { id: 'bbbb2222ffff', name: 'Twin' }] };
  assert.deepEqual(S.cronIds(list, 'Digest'), ['e795b782']);
  assert.deepEqual(S.cronIds(list, 'Twin'), ['aaaa1111', 'bbbb2222']);
  assert.deepEqual(S.cronIds(list, 'Nope'), []);
  const hit = DeckUI.findCron(list, 'e795b782');
  const sp = S.sheet(S.norm(J({ name: 'Digest', kind: 'hermes' })), NOW, undefined, hit);
  assert.equal(sp.kind, 'cron');
  assert.equal(sp.id, 'e795b782');
  assert.deepEqual(sp.actions.map((a) => [a.id, !!a.confirm]), [['run', true], ['pause', true], ['ask', false], ['data', false]]);
  assert.match(sp.draft, /Cron job "Digest" \(id e795b782\)/);
  const paused = S.sheet(S.norm(J({ name: 'Digest', kind: 'hermes' })), NOW, undefined, { j: hj, paused: true });
  assert.deepEqual(paused.actions.map((a) => a.id), ['run', 'resume', 'ask', 'data']);
});

test('output: the first 3 lines of the last run, redacted; reading, none, failed and non-Hermes states say so', () => {
  const v = S.outputView({ last_output: { t: T(-60), lines: ['a', 'tok' + 'en=abcdefghijklmnop1234', 'c', 'd'] } }, true);
  assert.equal(v.lines.length, 3);
  assert.doesNotMatch(v.lines.join(' '), /abcdefghijklmnop1234/);
  assert.deepEqual(S.outputView(null, false), { fail: true });
  assert.deepEqual(S.outputView({}, true), { none: true });
  const h = S.norm(J({ kind: 'hermes' }));
  assert.match(S.outputPart(h, { fail: true }, NOW)[0], /could not be read/);
  assert.match(S.outputPart(h, { none: true }, NOW)[0], /none yet/);
  assert.match(S.outputPart(S.norm(J({})), undefined, NOW)[0], /only Hermes jobs/);
});

test('output: Hermes markdown reads as plain words in the sheet (headings, bold, code, bullets, links and rules go)', () => {
  const v = S.outputView({ last_output: { t: T(-60), lines: ['# Cron Job: Apple Photos intake', '---', '**Job ID:** c0ff721f08e4', '- `photos-sync` ran [log](https://x.y/z)'] } }, true);
  assert.deepEqual(v.lines, ['Cron Job: Apple Photos intake', 'Job ID: c0ff721f08e4', 'photos-sync ran log']);
  assert.equal(S.plain('a *b* and __c__'), 'a b and c');
  assert.equal(S.plain('3 * 4 = 12'), '3 * 4 = 12', 'a lone star is not markup');
});

// GET /api/crons (rust/src/crons.rs): active and paused Hermes jobs with their lane, counts, and halt when every job is paused
const HJ = (name, lane, o) => Object.assign({ name, id: 'aaaaaaaa', lane, enabled: true, state: 'scheduled', last_status: 'ok' }, o);
const CR = (o) => Object.assign({ active: [HJ('A', 'CODEX'), HJ('B', 'CODEX'), HJ('C', 'CLAUDE'), HJ('D', 'weird')], paused: [HJ('P', 'CODEX', { enabled: false })],
  counts: { active: 4, paused: 1, total: 5, last_failed: 0 }, halt: null, t: T(-10) }, o);

test('status: the Hermes jobs on, tallied by lane in lane order, with last-run failures; no mark, never an alarm', () => {
  const h = S.hermesLine(CR());
  assert.equal(h, '<div class="flist sc-st"><div class="frow" role="status"><span class="fl"><b>Hermes jobs</b><small>Claude 1 \u00B7 Codex 2 \u00B7 Other 1</small></span><span class="fr"><b>4 of 5 on</b></span></div></div>');
  assert.match(vis(S.hermesLine(CR({ counts: { active: 4, paused: 1, total: 5, last_failed: 2 } }))), /Codex 2 \u00B7 Other 1 \u00B7 2 failed last time 4 of 5 on/);
  assert.doesNotMatch(h, /class="sd|pill|k-bad/);
});

test('status (L28): an unpinned job counts under the fleet default the server resolved, and the line says so; NO MODEL is "No model pinned"', () => {
  const fd = (n) => HJ(n, 'CODEX', { provider: null, model: null, model_source: 'fleet default', effective_model: 'cluster-current' });
  const h = vis(S.hermesLine(CR({ active: [HJ('A', 'CODEX'), fd('B'), fd('C'), fd('D')], counts: { active: 4, paused: 1, total: 5, last_failed: 0 } })));
  assert.match(h, /^Hermes jobs Codex 4 \u00B7 3 use the fleet default model 4 of 5 on$/);
  // an older server: an unpinned job stays in the NO MODEL lane, which never reads as "No model"
  const old = vis(S.hermesLine(CR({ active: [HJ('A', 'NO MODEL'), HJ('B', 'CODEX')], counts: { active: 2, paused: 1, total: 3 } })));
  assert.match(old, /Codex 1 \u00B7 No model pinned 1 /);
  assert.doesNotMatch(old, /No model(?! pinned)/);
  assert.match(vis(S.hermesLine(CR({ active: [fd('B')], counts: { active: 1, paused: 1, total: 2 } }))), /Codex 1 \u00B7 1 uses the fleet default model /);
});

test('Hermes job sheet (L28): a Model line after the host; an unpinned job "Uses the fleet default model", a pinned one its pair', () => {
  const base = { id: 'e795b78200aa', name: 'Digest', schedule_display: '0 7 * * *' };
  const sp = (j) => S.sheet(S.norm(J({ name: 'Digest', kind: 'hermes' })), NOW, undefined, { j: Object.assign({}, base, j), paused: false }).lines;
  const un = sp({ provider: null, model: null, model_source: 'fleet default', effective_provider: 'custom:cluster', effective_model: 'cluster-current' });
  assert.equal(un[un.indexOf('Host: pc-desktop') + 1], 'Model: Uses the fleet default model (custom:cluster / cluster-current)');
  assert.ok(sp({ provider: 'anthropic', model: 'claude-opus-5-5' }).includes('Model: anthropic / claude-opus-5-5'));
  assert.ok(sp({}).includes('Model: No model pinned'));
  // a timer row (no Hermes job behind it) has no model line
  assert.ok(!S.sheet(S.norm(J({ name: 'tick' })), NOW, null, null).lines.some((l) => /^Model:/.test(l)));
});

test('G7: the failing count and Fix these are one tap from the first screen: beside the select, or on a phone in a row under the bar', () => {
  const chip = /<button type="button" class="btn btn-sm scf scfail" data-f="failing" aria-label="Failing: 1 job\. Show them"><span class="sd bad"><\/span>Failing <b>1<\/b><\/button>/;
  for (const f of ['active', 'overdue', 'all']) assert.match(S.bar(MIX, f), chip, f);
  // on Failing the select already says it
  assert.doesNotMatch(S.bar(MIX, 'failing'), /scfail/);
  // nothing failing: no chip, and an overdue-only page keeps Fix these as before
  const od = FEED([G('a', 'A', [J({ name: 'Late', result: 'overdue' })])]);
  assert.doesNotMatch(S.bar(od, 'active'), /scfail/);
  assert.match(S.bar(od, 'active'), /class="btn btn-sm fix" data-fix/);
  const many = FEED([G('a', 'A', Array.from({ length: 16 }, (_, i) => J({ name: 'F' + i, result: 'failed' })))]);
  assert.match(S.bar(many, 'active'), /aria-label="Failing: 16 jobs\. Show them"><span class="sd bad"><\/span>Failing <b>16<\/b>/);
  // the phone row: the same chip and Fix these, first in the section, only while something needs a look; none under All without a failure
  const n = S.need(MIX, 'active');
  assert.match(n, /^<div class="scneed" role="group" aria-label="Needs a look"><button type="button" class="btn btn-sm scf scfail" data-f="failing"[^]*<button type="button" class="btn btn-sm fix" data-fix="crons"[^]*<\/div>$/);
  assert.ok(S.page(MIX, NOW, { filter: 'active', q: '' }).sect.startsWith(n));
  assert.equal(S.need(FEED([G('a', 'A', [J({})])]), 'active'), '');
  assert.doesNotMatch(S.need(MIX, 'failing'), /scfail/);
  assert.match(S.need(MIX, 'failing'), /data-fix="crons"/);
  assert.doesNotMatch(S.need(MIX, 'all'), /data-fix/);
  // the chip is a filter chip: the page's own .scf click handler sets data-f, in the bar or in the row
  assert.match(src, /const c=t\.closest\('\.scf'\);if\(c\)return setFilter\(c\.dataset\.f\)/);
  // CSS: the chip shows only where the select stands in; a phone moves both to the row; the desk keeps Fix these in the bar
  const css = read('static/css/homeops.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.scneed,\.hops-bar \.scfail\{display:none\}/);
  assert.match(css, /@media \(max-width:1099px\),\(max-height:499px\)\{\.hops-bar \.scfail\{display:inline-flex\}\}/);
  assert.match(css, /@media \(max-width:599px\)\{\.hops-bar \.scfail,#hcrons \.hops-bar \.fix\{display:none\}#scsec>\.scneed\{display:flex;/);
  assert.match(css, /@media \(max-width:1099px\),\(max-height:499px\)\{#scf\{display:none\}#scsel\{display:inline-flex\}/);
});

test('status: every job paused is the halt notice with when and why, never "nothing is running"', () => {
  const halt = { all_paused: true, counts: { removed: 3, merged: 2, stopped: 1, other: 1, unknown: 1 }, since: '2026-10-03T12:00:00Z', t: T(-10) };
  const h = S.hermesLine(CR({ active: [], counts: { active: 0, paused: 8, total: 8, last_failed: 0 }, halt }));
  assert.equal(vis(h), 'Everything is paused because you stopped it Since Oct 3 \u00B7 3 removed, 2 merged, 1 stopped, 2 other. Turn one back on from its sheet under All. 8 paused');
  assert.doesNotMatch(h, /2026-10-03|Nothing is running|No active jobs/);
  // no pause time and no reasons: the notice still says who stopped them
  assert.equal(vis(S.hermesLine(CR({ active: [], counts: { active: 0, paused: 2, total: 2 }, halt: { all_paused: true, counts: {}, since: '' } }))),
    'Everything is paused because you stopped it Turn one back on from its sheet under All. 2 paused');
});

test('status: a Hermes list that did not report, is empty or is hostile draws nothing or escaped text; the page keeps its list', () => {
  for (const c of [undefined, null, { error: 'timed out' }, { active: [], paused: [], counts: { total: 0 } }, 'x', []]) assert.equal(S.hermesLine(c), '');
  assert.doesNotMatch(S.hermesLine(CR({ halt: { all_paused: true, counts: { removed: '<b>' }, since: '<img src=x>' }, active: [] })), /<img|removed|Since/, 'a count or a time that is not one is left out');
  const v = S.page(MIX, NOW, { filter: 'active', q: '', c: CR() });
  assert.match(v.sect, /^(<div class="scneed"[^]*?<\/div>)?<div class="flist sc-st">[^]*<div class="flist" id="sclist"/);
  assert.equal(rows(v.sect), 4, 'the status line is not a job row');
  assert.match(S.page(MIX, NOW, { filter: 'active', q: '' }).sect, /^(<div class="scneed"[^]*?<\/div>)?<div class="flist" id="sclist"/);
  assert.equal(S.page(null, NOW, { filter: 'active', q: '', c: CR() }).sect.indexOf('sc-st'), -1, 'a broken page is one empty state');
  // the glue keeps the Hermes list for the status line
  assert.match(src, /SC\.f=r\.f;SC\.c=r\.c;/);
  // nothing new on the TV board: the status line is a desk and phone row
  assert.match(read('static/css/homeops.css'), /html\.tv #scsec>\.sc-st\{display:none\}/);
});

test('glue: one registered route, reads are GET only, actions stay on the deck.js cron sheet path', () => {
  const glue = src.slice(src.indexOf('// ==== SCHEDULES UI HELPERS END ===='));
  assert.match(glue, /DeckPages\.register\('home\/crons',\{every:30000,/);
  assert.match(glue, /DeckPages\.get\(p,\{timeout:SchedUI\.TIMEOUT_MS\}\)/);
  assert.match(glue, /await SchedUI\.load\(get\)/);
  assert.match(glue, /DeckPages\.mark\(SC\.ctx,SchedUI\.fresh\(/);
  assert.match(glue, /readJson\('\/api\/crons\/'\+ids\[0\]\)/);
  assert.doesNotMatch(src, /method:\s*'POST'|XMLHttpRequest|fetch\(/);
  assert.doesNotMatch(src, /v10Schedules|#sclist'\)\.addEventListener/);
});

test('the Crons filter select (and every select) is drawn by the deck: no platform look, a CSS chevron, no data: image', () => {
  const css = read('static/ui.css');
  const rule = /select,select\.btn\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'one select rule that also beats .btn');
  assert.match(rule[1], /-webkit-appearance:none;appearance:none/);
  assert.match(rule[1], /background-image:linear-gradient\(/);
  assert.match(rule[1], /background-repeat:no-repeat/);
  assert.doesNotMatch(css, /url\(\s*['"]?(data|blob):/i);
  // the page rule leaves the chevron room: no padding-right (nor the shorthand) on #scsel; the phone rule trims only the left side
  assert.doesNotMatch(read('static/css/homeops.css'), /#scsel\{[^}]*padding(?:-right)?:/);
});
