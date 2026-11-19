// node --test tests/no_red_owner_waits.test.js
// Owner 2026-11-02 ("get rid of the red"): red means broken and an agent can fix it. What waits on Tanner (an expired mail link,
// a consent, a missing repo secret, an App Review rejection, a Now decision or deadline) is amber or yellow, never red, and it stays visible.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const block = (src, begin, end) => { const a = src.indexOf(begin), b = src.indexOf(end); assert.ok(a >= 0 && b > a, begin); return src.slice(a, b); };
const D = new Function(block(read('static/deck.js'), '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const S = new Function('DeckUI', block(read('static/schedules.js'), '// ==== SCHEDULES UI HELPERS BEGIN', '// ==== SCHEDULES UI HELPERS END ====') + '\nreturn SchedUI;')(D);
const A = new Function('DeckUI', block(read('static/agents.js'), '// ==== AGENTS UI HELPERS BEGIN', '// ==== AGENTS UI HELPERS END ====') + '\nreturn AgentsUI;')(D);

const NOW = Date.UTC(2026, 10, 2, 19, 0, 0);
const T = (d) => NOW / 1000 + d;
const LINK = 'https://connect.example.test/link/lk_test';
const wait = (reason, o) => Object.assign({ job: 'x', host: 'pc-desktop', reason, action: 'Do the owner step', until: '2026-11-09' }, o);
const J = (o) => Object.assign({ id: 'g:job', name: 'job', host: 'pc-desktop', kind: 'systemd', schedule: 'every 5min', enabled: true, last: T(-300), next: T(300), result: 'ok', detail: '' }, o);
const FEED = (jobs, counts) => ({ t: T(-20), stale: false, errors: [], counts: Object.assign({ total: jobs.length }, counts), groups: [{ id: 'pc-desktop-systemd', label: 'pc-desktop timers', host: 'pc-desktop', kind: 'systemd', ok: true, error: null, n: jobs.length, jobs }] });
const LIVE = FEED([
  J({ name: 'gmail-autolabel-personal', result: 'waiting', detail: 'Waiting on you: Gmail personal link expired', owner_wait: wait('Gmail personal link expired', { mailbox: 'personal', link: LINK, action: 'Relink Gmail personal in Composio' }) }),
  J({ name: 'nest-bridge', result: 'waiting', detail: 'Waiting on you: Nest consent expired', owner_wait: wait('Nest consent expired') }),
  J({ name: 'ok-job' }),
], { failing: 0, waiting: 2 });

// Today v3 (2026-11-14): Needs you rows come from DeckUI.tdNeeds; every row carries the signal (wait) or warn mark, never red.
const needs = (mail, sc) => D.tdNeeds({ products: { t: T(-20), errors: [], needs: [] }, testflight: { apps: [] }, schedules: sc, today: { gateway: { ok: true }, mail }, replyblock: { counts: { drafted: 0 } } });
test('Needs you: an offline mailbox is a relink row with the owner-wait link, never red', () => {
  const n = needs({ status: 'partial', mailboxes: [{ ok: true, role: 'primary' }, { ok: false, role: 'personal' }] }, LIVE);
  const mail = n.items.find((r) => /relink/.test(r.text));
  assert.deepEqual({ sev: mail.sev, text: mail.text, why: mail.why, url: mail.url }, { sev: 'high', text: 'Gmail personal needs a relink', why: 'Relink Gmail personal in Composio', url: LINK });
  const h = D.tdNeedsHtml(n, []);
  assert.match(h, new RegExp('<a href="' + LINK.replace(/[.]/g, '\\.') + '" target="_blank" rel="noopener noreferrer" class="frow need">'));
  assert.doesNotMatch(h, /sd bad|pill bad/);
  // without an owner wait it still says what to do, and still is not red
  const bare = needs({ mailboxes: [{ ok: false, role: 'personal' }] }, null).items;
  assert.equal(bare.length, 1);
  assert.equal(bare[0].url, '');
});

test('Needs you: jobs that wait on Tanner are one row with the first step (else its reason); the relinked mailbox is not counted twice; a failing job is an Alert, red, never in Needs you', () => {
  assert.deepEqual(needs({ mailboxes: [] }, LIVE).items.map((r) => [r.sev, r.text, r.why]), [['high', '2 jobs wait on you', 'Relink Gmail personal in Composio and 1 more']]);
  // the step is cut at a word with an ellipsis, never mid-word, and a job with no step falls back to its reason
  const long = 'Close the desktop Chromium once so the headless profile can start, then confirm the next tick restarted it cleanly';
  const clipped = needs({ mailboxes: [] }, FEED([J({ name: 'a', result: 'waiting', owner_wait: wait('r1', { action: long }) }), J({ name: 'b', result: 'waiting', owner_wait: wait('Nest consent expired', { action: '' }) })], { failing: 0, waiting: 2 })).items[0].why;
  assert.match(clipped, /^Close the desktop Chromium once so the headless profile can start, then confirm the next tick restarted it\u2026 and 1 more$/);
  assert.equal(needs({ mailboxes: [] }, FEED([J({ name: 'b', result: 'waiting', owner_wait: wait('Nest consent expired', { action: '' }) })], { failing: 0, waiting: 1 })).items[0].why, 'Nest consent expired');
  assert.deepEqual(needs({ mailboxes: [{ ok: false, role: 'personal' }] }, LIVE).items.map((r) => r.text), ['Gmail personal needs a relink', '1 job waits on you']);
  const mixed = FEED(LIVE.groups[0].jobs.concat([J({ name: 'asc-watch', result: 'failed', detail: 'exit 1' })]), { failing: 1, waiting: 2 });
  const n = needs({ mailboxes: [] }, mixed);
  // B1 (owner 2026-11-03): Needs you holds the owner's steps; a failing job is for an agent, so it is the Alerts strip's red row
  assert.deepEqual(n.items.map((r) => [r.sev, r.text]), [['high', '2 jobs wait on you']]);
  assert.doesNotMatch(D.tdNeedsHtml(n), /sd bad|asc-watch|failing/);
  const al = D.tdAlertsHtml(n, { gateway: { ok: true }, mail: { mailboxes: [] }, cron: { next: [], failing: [] } }, { count: 0, names: [] }, []).html;
  assert.match(al, /lead-mark sd bad[^]*1 scheduled job failing/);
  assert.doesNotMatch(al, /asc-watch/);
});

test('a Needs you link that is not http(s) is dropped; the row stays as plain text', () => {
  const n = D.tdNeeds({ products: { errors: [], needs: [{ owner: 'owner', sev: 'high', text: 't', url: 'javascript:alert(1)' }] } });
  const h = D.tdNeedsHtml(n, []);
  assert.doesNotMatch(h, /href=/);
  assert.match(h, /<div class="frow need">/);
});

test('Now decisions keep their words and order but use the signal wait mark, not the red diamond', () => {
  const now = D.decisionRow({ text: 'Answer App Review for Mesh', source: 'asc', sev: 'high', url: 'https://appstoreconnect.apple.com/x' }, false);
  assert.match(now, /<span class="pill sv-high"><i class="sd wait"><\/i>Now<\/span>/);
  assert.doesNotMatch(now, /sd bad/);
  assert.match(D.decisionRow({ text: 's', sev: 'med' }, false), /<span class="pill sv-med"><i class="sd warn"><\/i>Soon<\/span>/);
  const today = D.tdNeedsHtml(D.tdNeeds({ products: { errors: [], needs: [{ owner: 'owner', sev: 'high', text: 'Answer App Review for Mesh' }, { owner: 'owner', sev: 'med', text: 'Attach build 72' }] } }), []);
  assert.match(today, /lead-mark sd wait[^]*Now[^]*lead-mark sd warn[^]*Soon/);
  assert.doesNotMatch(today, /sd bad/);
});

test('App Review "Issues open" or rejected is an amber wait row; the not-reporting state stays red', () => {
  const app = (o) => ({ t: NOW / 1000, stale: false, errors: [], needs: [], products: [], app_store: o });
  const g = D.products(app({ name: 'Mesh for Small Business', review: { state: 'UNRESOLVED_ISSUES' }, version: { string: '1.3.1', state: 'PREPARE_FOR_SUBMISSION', build: 74 }, latest_build: { number: 74, state: 'VALID' } }), NOW).grid;
  assert.match(g, /<b>Mesh for Small Business<\/b>/);
  assert.match(g, /<span class="pill"><i class="sd wait"><\/i>Issues open<\/span>/);
  assert.doesNotMatch(g, /sd bad|pill bad/);
  assert.equal(D.appItem({ name: 'X', review: { state: 'REJECTED' } }, 'ok', NOW).k, 'wait');
  assert.match(D.appItem(null, 'ok', NOW).html, /bad/);
});

test('CSS: Now and wait states use the tint wash; red stays on .pill.bad and .tile.bad only', () => {
  // design v3: waits on you is the signal square and the signal wash (ui.css); old names point at the same tokens
  const ui = read('static/ui.css'), tokens = read('static/tokens.css'), app = read('static/app.css');
  assert.match(ui, /\.pill\.wait\{background:var\(--c-signal-wash\)/);
  assert.match(ui, /\.sd\.wait\{background:var\(--c-signal\)/);
  assert.match(tokens, /--wait:var\(--c-signal\);--wait-wash:var\(--c-signal-wash\)/);
  assert.doesNotMatch(ui + app, /sv-high[^{]*\{[^}]*--(c-)?bad/);
});

test('Crons: a waiting job uses the needs-you mark with its reason, is never red and is not counted as failing', () => {
  const c = S.counts(LIVE);
  assert.equal(c.failing, 0);
  assert.equal(c.bad, 0);
  assert.equal(c.active, 3);
  assert.match(S.chips(c, 'active'), /data-f="failing" aria-pressed="false">Failing <small>0<\/small>/);
  assert.doesNotMatch(S.bar(LIVE, 'active'), /data-fix="crons"/);
  const row = S.row(S.norm(LIVE.groups[0].jobs[0], LIVE.groups[0]), NOW, 0);
  assert.match(row, /class="frow scrow k-wait"/);
  assert.match(row, /<b>gmail-autolabel-personal<\/b><small>[^<]*Gmail personal link expired<\/small>/);
  assert.match(row, /<span class="pill wait"><span class="sd wait"><\/span>Waits on you<\/span>/);
  assert.doesNotMatch(row, /k-bad|sd bad|pill bad/);
  // waiting sorts after real failures and before running work; how to clear it is in the sheet
  const f = FEED([J({ name: 'b-run', result: 'running', started: T(-30) }), J({ name: 'w', result: 'waiting', owner_wait: wait('r') }), J({ name: 'f', result: 'failed' })]);
  assert.deepEqual(S.listOf(f, 'active', '').map((j) => j.name), ['f', 'w', 'b-run']);
  assert.deepEqual(S.listOf(f, 'failing', '').map((j) => j.name), ['f']);
  assert.match(S.sheet(S.flatten(f)[1], NOW, null, null).lines.join('\n'), /Waits on you: r\. To clear: Do the owner step \(marked until 2026-11-09\)/);
});

test('Agents: waiting jobs are not failing; the crons mission names them so an agent leaves them alone', () => {
  assert.deepEqual(A.failingJobs(LIVE), []);
  const m = A.MISSIONS.find((x) => x.kind === 'crons');
  assert.equal(A.context(m, A.ALL, LIVE, null), 'Nothing failing now \u00B7 2 wait on you');
  const draft = A.draft(m.id, A.ALL, LIVE, null);
  assert.match(draft, /These wait on me, leave them: gmail-autolabel-personal \(Gmail personal link expired\); nest-bridge \(Nest consent expired\)\./);
  assert.match(draft, /Rules: /);
});
