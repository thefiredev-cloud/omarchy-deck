// node --test tests/  (feedback release: detail sheet, cron and unit actions, Ask Hermes drafts, run thread, link rules; pure helpers, no DOM, no network)
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
const glue = src.slice(b);
const html = fs.readFileSync(path.join(__dirname, '../static/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, '../static/sw.js'), 'utf8');

const NOW = Date.UTC(2026, 9, 4, 18, 0, 0);
const iso = (agoS) => new Date(NOW - agoS * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
const job = (o) => Object.assign({ name: 'Morning brief', id: 'e795b782', schedule_display: '0 7 * * *', state: 'scheduled', enabled: true, provider: 'anthropic', model: 'claude-opus-5-5',
  lane: 'CLAUDE', last_run_at: iso(7200), last_status: 'error', next_run_at: iso(-3600) }, o);

// ---------------- run window and soft keyboard ----------------
test('run window pins to the visual viewport only when the keyboard shrinks or scrolls it', () => {
  assert.equal(D.vvFit(440, 440, 0), null, 'full screen: leave it alone');
  assert.equal(D.vvFit(440, 439.5, 0), null, 'sub-pixel rounding is not a keyboard');
  assert.deepEqual(D.vvFit(440, 210, 0), { height: 210, top: 0 }, 'landscape keyboard');
  assert.deepEqual(D.vvFit(956, 540.4, 12.6), { height: 540, top: 13 }, 'portrait keyboard, page scrolled');
  assert.deepEqual(D.vvFit(440, 440, 30), { height: 440, top: 30 }, 'scrolled without resizing still follows the visual viewport');
  assert.equal(D.vvFit(440, 0, 0), null);
  assert.equal(D.vvFit(NaN, 300, 0), null);
  assert.equal(D.vvFit(440, undefined, 0), null);
  assert.deepEqual(D.vvFit(440, 300, -5), { height: 300, top: 0 }, 'rubber-band negative offset clamps to 0');
});

// ---------------- sheet content builders ----------------
test('cron sheet: every field the feed has, Run now and Pause (two-tap) for an active job, Resume for a paused one', () => {
  const s = D.cronSheet(job(), false, NOW);
  assert.equal(s.title, 'Morning brief');
  assert.equal(s.sub, 'Scheduled job');
  const text = s.lines.join('\n'), details = s.log.join('\n');
  for (const re of [/Schedule: Daily at 7 AM/, /Lane: CLAUDE/, /State: Active/, /Last run: Failed \u00B7 2 h ago/, /Next run: in 60 min/]) assert.match(text, re);
  for (const re of [/ID e795b782/, /Schedule text 0 7 \* \* \*/, /Provider and model anthropic \/ claude-opus-5-5/]) assert.match(details, re);
  assert.equal(s.logTitle, 'Details');
  assert.deepEqual(s.actions.map((x) => [x.id, !!x.confirm]), [['run', true], ['pause', true], ['ask', false]]);
  assert.equal(s.actions[0].label, 'Run now');
  const p = D.cronSheet(job({ state: 'paused', enabled: false }), true, NOW);
  assert.deepEqual(p.actions.map((x) => x.id), ['run', 'resume', 'ask']);
  assert.match(p.lines.join('\n'), /State: Paused/);
  assert.match(p.lines.join('\n'), /Next run: Was due /);
});

test('cron sheet: never-run job, unpinned model and a job without a usable id (no actions that need the id)', () => {
  const s = D.cronSheet(job({ last_run_at: null, last_status: null, next_run_at: null, provider: null, model: null }), false, NOW);
  assert.match(s.lines.join('\n'), /Last run: Never run/);
  assert.match(s.lines.join('\n'), /Next run: Not scheduled/);
  // an older server sends no model_source: the sheet says only that nothing is pinned, never "No model" (L28)
  assert.match(s.log.join('\n'), /Provider and model No model pinned/);
  assert.match(s.lines.join('\n'), /^Model: No model pinned$/m);
  const noId = D.cronSheet(job({ id: 'not-hex!' }), false, NOW);
  assert.deepEqual(noId.actions.map((x) => x.id), ['ask']);
  assert.equal(noId.id, '');
  assert.equal(D.cronId({ id: 'E795B782' }), '');
  assert.equal(D.cronId({ id: 'e795b7823241abcd' }), 'e795b782');
});

test('cron sheet (L28): an unpinned job reads "Uses the fleet default model" with the model it resolves to, never "No model"', () => {
  const un = { provider: null, model: null, lane: 'CODEX', model_source: 'fleet default', effective_provider: 'custom:cluster', effective_model: 'cluster-current' };
  const s = D.cronSheet(job(un), false, NOW);
  assert.match(s.lines.join('\n'), /^Model: Uses the fleet default model \(custom:cluster \/ cluster-current\)$/m);
  assert.match(s.log.join('\n'), /Provider and model Uses the fleet default model \(custom:cluster \/ cluster-current\)/);
  assert.doesNotMatch(s.lines.join('\n') + s.log.join('\n'), /No model(?! pinned)|none pinned|NO MODEL/);
  assert.equal(D.cronModel(job({ provider: null, model: null, model_source: 'main default', effective_model: 'gpt-x' })), 'Uses the main Hermes model (gpt-x)');
  assert.equal(D.cronModel(job({ provider: null, model: null, model_source: 'none', effective_model: 'stale' })), 'No model set, and no default');
  assert.equal(D.cronModel(job({ provider: null, model: null, model_source: 'fleet default' })), 'Uses the fleet default model');
  // a pin wins over whatever the server resolved; hostile source words are not trusted
  assert.equal(D.cronModel(job({ model_source: 'pinned', effective_model: 'other' })), 'anthropic / claude-opus-5-5');
  assert.equal(D.cronModel(job({ provider: null, model: null, model_source: '<b>x</b>' })), 'No model pinned');
});

test('the Hermes job list finds a job by its 8 hex id, active or paused; anything else is no job', () => {
  const f = { t: NOW / 1000, file_t: NOW / 1000, counts: { active: 2, paused: 2, total: 4 }, active: [job(), job({ id: 'zz', name: 'Odd' })], paused: [job({ id: 'aaaa1111' }), job({ id: 'bbbb2222' })] };
  assert.equal(D.findCron(f, 'aaaa1111').paused, true);
  assert.equal(D.findCron(f, 'e795b782').paused, false);
  assert.equal(D.findCron(f, 'ffffffff'), null);
  assert.equal(D.findCron(null, 'e795b782'), null);
});

test('failing unit rows get data-unit only for names the server would accept', () => {
  const u = { src: 'x', t: NOW / 1000, stale: false, writer_ok: true, failed_units: ['mcp-liveness-sweep.service', 'bad name.service', 'x"onmouseover=1.service', 'broker@a.timer', 'nosuffix'] };
  const h = D.board({ units: u }, NOW)[4];
  assert.match(h, /data-unit="mcp-liveness-sweep\.service"/);
  assert.match(h, /data-unit="broker@a\.timer"/);
  assert.doesNotMatch(h, /data-unit="bad name/);
  assert.doesNotMatch(h, /data-unit="x"/);
  assert.doesNotMatch(h, /data-unit="nosuffix"/);
  assert.equal((h.match(/data-unit=/g) || []).length, 2);
  assert.equal(D.unitOk('a.service'), true);
  assert.equal(D.unitOk('a.socket'), false);
  assert.equal(D.unitOk('../x.service'), false);
  assert.equal(D.unitOk('x'.repeat(97) + '.service'), false);
});

test('unit sheet: loading placeholder, then state, result, exit status, since and the journal lines', () => {
  const s = D.unitSheet('mcp-liveness-sweep.service');
  assert.equal(s.title, 'mcp-liveness-sweep.service');
  assert.deepEqual(s.actions.map((x) => x.id), ['ask']);
  assert.equal(s.actions.some((x) => /restart|stop|start/i.test(x.label)), false);
  const v = D.unitView({ ok: true, unit: 'x.service', active: 'failed', sub: 'failed', result: 'exit-code', exit: 1, since: 'Sun 2026-10-04 07:00:01 PDT', lines: ['line one', '<b>two</b>', '', 'three'] });
  assert.deepEqual(v.lines, ['State: failed (failed)', 'Result: exit-code', 'Exit status: 1', 'Since: Sun 2026-10-04 07:00:01 PDT']);
  assert.deepEqual(v.log, ['line one', '<b>two</b>', 'three']);
  assert.equal(v.logTitle, 'Log, last 3 lines');
  const body = D.sheetBody(Object.assign({}, s, v));
  assert.match(body, /<div class="sl">State: failed \(failed\)<\/div>/);
  assert.match(body, /<div class="sl mono">&lt;b&gt;two&lt;\/b&gt;<\/div>/);
  assert.doesNotMatch(body, /<b>two/);
  const n = D.unitView({ ok: true, active: 'failed', exit: null, lines: [] });
  assert.match(n.lines.join('|'), /Exit status: unknown/);
  assert.equal(n.logTitle, 'The log is empty');
  assert.equal(D.unitView({ ok: true, lines: Array.from({ length: 80 }, (_, i) => 'l' + i) }).log.length, 25);
});

test('unit sheet: a failed or missing answer is said out loud, never blank', () => {
  assert.match(D.unitView({ ok: false, error: 'not a failing unit' }).lines[0], /Could not read this service/);
  assert.match(D.unitView(null).lines[0], /Could not read this service/);
  assert.match(D.unitView({ ok: true }).lines.join('|'), /State: unknown/);
});

test('generic card sheet: the card text split into lines, tags dropped, entities decoded, nothing left as markup', () => {
  const card = '<div class="tile bad"><div class="h"><i class="sd bad"></i>Engine &amp; proxy</div><div class="v">glm-5.3 &lt;img src=x onerror=1&gt; UP</div><div class="t">ctx 131072 \u00B7 :8080 \u00B7 up 3d</div><div class="bar"><i style="width:40%"></i></div></div>';
  const ls = D.htmlLines(card);
  assert.deepEqual(ls, ['Engine & proxy', 'glm-5.3 <img src=x onerror=1> UP', 'ctx 131072 \u00B7 :8080 \u00B7 up 3d']);
  const s = D.cardSheet(card, 'Cluster');
  assert.equal(s.title, 'Engine & proxy');
  assert.equal(s.sub, 'Cluster');
  assert.equal(s.lines.length, 2);
  assert.deepEqual(s.actions, []);
  const body = D.sheetBody(s);
  assert.doesNotMatch(body, /<img/);
  assert.match(body, /glm-5\.3 &lt;img src=x onerror=1&gt; UP/);
  assert.equal(D.cardSheet('', 'Fleet').title, 'Details');
  assert.deepEqual(D.cardSheet('<div>only</div>', 'x').lines, ['No more text on this card']);
  assert.equal(D.htmlLines('<b>' + 'x'.repeat(900) + '</b>')[0].length, 400);
  assert.equal(D.htmlLines(Array.from({ length: 100 }, (_, i) => '<b>' + i + '</b>').join('')).length, 40);
});

test('sheet link is only an http(s) anchor with the arrow mark', () => {
  assert.match(D.sheetLink('https://example.com/a?b=1'), /^<a class="b sact" href="https:\/\/example\.com\/a\?b=1" target="_blank" rel="noopener noreferrer">Open link/);
  assert.match(D.sheetLink('https://example.com/'), /class="lk"/);
  assert.equal(D.sheetLink('javascript:alert(1)'), '');
  assert.equal(D.sheetLink(null), '');
});

// ---------------- two-tap state ----------------
test('two-tap: the first tap arms, a second tap on the same action within 3 s runs it; other actions and late taps only arm', () => {
  const run = { id: 'run', confirm: true };
  let t = D.tapAction(null, 'run', 1000, true);
  assert.deepEqual([t.run, t.armed], [false, { id: 'run', t: 1000 }]);
  assert.equal(D.armedNow(t.armed, 'run', 3999), true);
  assert.equal(D.armedNow(t.armed, 'run', 4001), false);
  const fire = D.tapAction(t.armed, 'run', 3500, true);
  assert.deepEqual([fire.run, fire.armed], [true, null]);
  assert.equal(D.tapAction(t.armed, 'run', 4500, true).run, false, 'too late: arms again');
  const other = D.tapAction(t.armed, 'pause', 1500, true);
  assert.deepEqual([other.run, other.armed.id], [false, 'pause']);
  assert.deepEqual(D.tapAction(null, 'ask', 0, false), { armed: null, run: true });
  assert.equal(run.confirm, true);
});

test('action buttons: armed ones read Tap again, busy disables, labels are escaped, danger is a class', () => {
  const acts = [{ id: 'run', label: 'Run now', confirm: true }, { id: 'ask', label: '<Ask>' }, { id: 'x', label: 'Stop', confirm: true, danger: true }];
  const idle = D.sheetActions(acts, null, 0, false);
  assert.match(idle, /data-act="run">Run now</);
  assert.match(idle, /data-act="ask">&lt;Ask&gt;</);
  assert.match(idle, /class="b sact danger" data-act="x"/);
  assert.doesNotMatch(idle, /armed|disabled/);
  const armed = D.sheetActions(acts, { id: 'run', t: 0 }, 1000, false);
  assert.match(armed, /class="b sact armed" data-act="run" aria-label="Run now, tap again to confirm">Tap again</);
  assert.equal((armed.match(/Tap again</g) || []).length, 1);
  assert.equal((D.sheetActions(acts, null, 0, true).match(/disabled/g) || []).length, 3);
  assert.equal(D.sheetActions(null, null, 0, false), '');
});

test('action results: ok line names the job, errors say what happened and what to do, never a status code', () => {
  assert.deepEqual(D.actResult({ ok: true, act: 'pause', id: 'e795b782', name: 'Morning brief' }, 200, 'pause'), { k: 'ok', text: 'Paused \u00B7 Morning brief' });
  assert.equal(D.actResult({ ok: true, name: 'X' }, 200, 'run').text, 'Run started \u00B7 X');
  assert.equal(D.actResult({ ok: true }, 200, 'resume').text, 'Resumed');
  assert.deepEqual(D.actResult({ ok: false, error: 'already paused' }, 409, 'pause'), { k: 'bad', text: 'It is already paused.' });
  assert.equal(D.actResult({ ok: false, error: 'rate limited', retry_s: 1.2 }, 429, 'run').text, 'Too many tries. Wait 2 s, then try again.');
  assert.equal(D.actResult(null, 502, 'run').text, 'Hermes did not answer. Check that it is running, then try again.');
  assert.equal(D.actResult(null, 0, 'run').text, 'No answer from the deck. Check your connection, then try again.');
  for (const [j, s] of [[null, 502], [{ ok: false, error: 'hermes gateway unreachable' }, 502], [{ ok: false, error: 'boom' }, 500], [null, 0]]) assert.doesNotMatch(D.actResult(j, s, 'run').text, /http|\b50\d\b|gateway/i);
});

// ---------------- tap-to-open delegation rules ----------------
test('tap-to-open: cards open on the info pages; links, buttons, inputs, cameras, Launch rows and filter chips never do', () => {
  const chain = (...xs) => xs.map(([tag, cls]) => ({ tag, cls: cls || '' }));
  // a span inside a tile inside the list: the tile opens
  assert.equal(D.sheetPick('fleet', chain(['SPAN'], ['DIV', 'tile node stale'], ['DIV', 'mach'])), 1);
  assert.equal(D.sheetPick('crons', chain(['B'], ['SPAN', 'fl'], ['DIV', 'frow cronrow bad'], ['DIV', 'flist'])), 2);
  assert.equal(D.sheetPick('cluster', chain(['SMALL'], ['DIV', 'mt stale'])), 1);
  assert.equal(D.sheetPick('fleet', chain(['SPAN'], ['DIV', 'dk hot'])), 1);
  assert.equal(D.sheetPick('fleet', chain(['B'], ['DIV', 'chip sm'])), 1);
  assert.equal(D.sheetPick('cluster', chain(['SMALL'], ['SPAN', 'fl'], ['DIV', 'frow'])), 2);
  for (const p of ['crons', 'fleet', 'cluster', 'dev', 'life', 'house']) assert.ok(D.sheetPick(p, chain(['DIV', 'tile'])) === 0, p);
  // links keep navigating (the anchor is the card, or wraps it)
  assert.equal(D.sheetPick('dev', chain(['SPAN'], ['A', 'frow'], ['DIV', 'flist'])), -1);
  assert.equal(D.sheetPick('dev', chain(['B'], ['A', 'chip'])), -1);
  assert.equal(D.sheetPick('life', chain(['DIV', 'tile'], ['A', ''])), -1, 'a card inside a link is still the link');
  assert.equal(D.sheetPick('dev', chain(['SMALL'], ['SPAN', 'fl'], ['A', 'frow'])), -1);
  // controls
  assert.equal(D.sheetPick('life', chain(['BUTTON', 'b jchip on'], ['DIV', 'chips'])), -1);
  assert.equal(D.sheetPick('life', chain(['SPAN'], ['BUTTON', 'b'])), -1);
  assert.equal(D.sheetPick('house', chain(['INPUT'], ['DIV', 'tile'])), -1);
  assert.equal(D.sheetPick('house', chain(['TEXTAREA'])), -1);
  assert.equal(D.sheetPick('today', chain(['SUMMARY', 'secttl'], ['DETAILS', 'tcard'])), -1);
  // cameras, Launch rows, filters
  assert.equal(D.sheetPick('house', chain(['SPAN', 'nm'], ['BUTTON', 'cam'], ['DIV'])), -1);
  assert.equal(D.sheetPick('house', chain(['VIDEO'], ['SPAN', 'cam-media'], ['DIV', 'cam'])), -1);
  assert.equal(D.sheetPick('launch', chain(['DIV', 'lnrow tr-core'])), -1);
  assert.equal(D.sheetPick('launch', chain(['DIV', 'tile'])), -1, 'launch is not an info page');
  for (const c of ['lnk', 'lnt', 'lnw', 'lnb', 'jchip']) assert.equal(D.sheetPick('life', chain(['DIV', 'tile ' + c])), -1, c);
  // pages that are not in the list, and junk
  for (const p of ['pad', 'launch', '', null]) assert.equal(D.sheetPick(p, chain(['DIV', 'tile'])), -1, String(p));
  for (const p of ['home', 'keys']) assert.equal(D.sheetPick(p, chain(['DIV', 'tile'])), 0, p + ' shows its diagnostics in the detail sheet');
  assert.equal(D.sheetPick('fleet', chain(['DIV', 'flist'], ['DIV', 'fchips'])), -1);
  assert.equal(D.sheetPick('fleet', null), -1);
  assert.equal(D.sheetPick('fleet', []), -1);
});

test('shell: the sheet is a labelled modal dialog with close, body, result and action areas; glue closes it on Escape and backdrop and returns focus', () => {
  assert.match(html, /<div id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheett">/);
  for (const id of ['sheetbg', 'sheetp', 'sheetx', 'sheett', 'sheets', 'sheetb', 'sheetr', 'sheeta']) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /id="sheetx" aria-label="Close details"/);
  assert.match(html, /id="sheetr" role="status" aria-live="polite"/);
  assert.match(glue, /e\.key==='Escape'\)\{e\.preventDefault\(\);closeSheet\(\)\}/);
  assert.match(glue, /\$\('#sheetbg'\)\.addEventListener\('click'/);
  assert.match(glue, /\$\('#app'\)\.inert=true/);
  assert.match(glue, /\$\('#app'\)\.inert=false/);
  assert.match(glue, /\.focus\(\{preventScroll:true\}\)/);
  // Escape closes the sheet first, never the run window under it
  assert.match(glue, /RUN\.open&&!SHEET\.open&&e\.key==='Escape'/);
  // delegation goes through the pure picker and never swallows the click
  const del = glue.slice(glue.indexOf("$('#pager').addEventListener('click'"));
  assert.match(del, /DeckUI\.sheetPick\(pg\.dataset\.name,chain\)/);
  assert.doesNotMatch(del.slice(0, del.indexOf('// The iPhone shell')), /preventDefault|stopPropagation/);
});

// ---------------- Ask Hermes drafts ----------------
test('Ask Hermes draft for a cron: name, id, schedule, last status and age, and the plain question', () => {
  const d = D.cronDraft(job(), false, NOW);
  assert.match(d, /^Cron job "Morning brief" \(id e795b782\)/);
  assert.match(d, /Schedule: 0 7 \* \* \*\n/);
  assert.match(d, /Last run: error, 2 h ago/);
  assert.match(d, /Why did this fail, or what should I do about it\?$/);
  assert.match(D.cronDraft(job({ last_run_at: null, last_status: null }), true, NOW), /\(paused\)[^]*Last run: never run/);
  assert.equal(D.cronSheet(job(), false, NOW).draft, d);
});

test('Ask Hermes draft for a unit: name, state and result once they are known, always the question', () => {
  const bare = D.unitDraft('x.service', null);
  assert.match(bare, /^Systemd user unit x\.service is failing\./);
  assert.doesNotMatch(bare, /State:/);
  const full = D.unitDraft('x.service', { ok: true, active: 'failed', sub: 'failed', result: 'exit-code', exit: 203 });
  assert.match(full, /State: failed \(failed\)\nResult: exit-code\nExit status: 203/);
  assert.match(full, /Why is it failing, and what should I do about it\?$/);
  assert.equal(D.unitSheet('x.service').draft, bare);
});

test('drafts are plain text: control characters dropped, newline and tab kept, drafts capped, a message is never cut (over 2000 it is blocked instead)', () => {
  assert.equal(D.cleanText('a\u0000b\u0007c\td\r\ne\u2028f', 100), 'abc\td\nef');
  assert.equal(D.cleanText('  x  '), 'x');
  const long = D.cronDraft(job({ name: 'n'.repeat(500), schedule_display: 's'.repeat(500) }), false, NOW);
  assert.ok(long.length <= 1500);
  assert.equal(D.sendText('y'.repeat(5000)).length, 5000, 'sendText never cuts: the composer blocks Send over the limit');
  assert.equal(D.sendState('y'.repeat(5000)).ok, false);
  assert.equal(D.sendText('   \n\t '), '');
  assert.equal(D.sendText(null), '');
});

test('message text is counted by code points: an emoji pair is one, a lone surrogate would break the JSON body so lone halves are dropped', () => {
  const raw = 'a'.repeat(1999) + '\u{1F600}\u{1F600}';
  const t = D.cleanText(raw, 2000);
  assert.equal(Array.from(t).length, 2000);
  assert.ok(t.endsWith('\u{1F600}'));
  assert.doesNotMatch(t, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  // 2001 code points is over the limit: whole in the body, flagged, never cut
  assert.equal(Array.from(JSON.parse(JSON.stringify(D.sendBody(raw, null))).text).length, 2001);
  assert.equal(D.sendState(raw).tooLong, true);
  assert.equal(Array.from(D.sendText('\u{1F600}'.repeat(2500))).length, 2500);
  // ZWJ sequences keep their joiners: the server accepts them
  const fam = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
  assert.equal(D.cleanText('hi ' + fam), 'hi ' + fam);
  // lone surrogate halves (a broken paste) are dropped, whole pairs stay, and the body parses on the server
  const lone = 'x\uD83D y \uDE00 z \u{1F600} w\uD83D';
  const cleaned = D.cleanText(lone);
  assert.equal(cleaned, 'x y  z \u{1F600} w');
  assert.doesNotMatch(cleaned, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  assert.doesNotMatch(JSON.stringify({ text: cleaned }), /\\ud[89a-f][0-9a-f]{2}(?!\\ud[c-f])/i);
});

// ---------------- run thread ----------------
test('run thread: a new turn is appended in order and the thread keeps at most 8 turns, newest last', () => {
  let th = [];
  for (let i = 1; i <= 11; i++) th = D.threadAdd(th, { run_id: 'run_' + i, text: 'msg ' + i, mode: i === 1 ? 'new' : 'reply' });
  assert.equal(th.length, 8);
  assert.equal(D.THREAD_MAX, 8);
  assert.equal(th[0].run_id, 'run_4');
  assert.equal(th[7].run_id, 'run_11');
  assert.deepEqual(th[7], { run_id: 'run_11', text: 'msg 11', mode: 'reply' });
  // junk is refused, an unknown mode becomes new, text is cleaned
  assert.equal(D.threadAdd(th, { run_id: 'bad id!', text: 'x', mode: 'new' }).length, 8);
  assert.equal(D.threadAdd(th, { run_id: 'bad id!', text: 'x', mode: 'new' })[7].run_id, 'run_11');
  assert.equal(D.threadAdd([], { run_id: 'r', text: 'a\u0000b', mode: 'weird' })[0].mode, 'new');
  assert.equal(D.threadAdd([], { run_id: 'r', text: 'a\u0000b', mode: 'weird' })[0].text, 'ab');
  assert.deepEqual(D.threadAdd(null, { run_id: 'r', text: 't', mode: 'steer' }), [{ run_id: 'r', text: 't', mode: 'steer' }]);
});

test('run thread: the button says Add instruction for a queued or running run and Send otherwise, never Steer', () => {
  assert.equal(D.sendLabel('running'), 'Add instruction');
  assert.equal(D.sendLabel('queued'), 'Add instruction');
  for (const s of ['done', 'failed', '', undefined, 'bogus']) assert.equal(D.sendLabel(s), 'Send');
});

test('a run that waits for approval says so instead of looking stuck, and only while it is running', () => {
  const m = { ok: true, state: 'running', detail: 'waiting_for_approval', lines: [], elapsed_s: 5 };
  const v = D.runView({ run_id: 'run_1', model: m, got: NOW }, NOW);
  assert.equal(v.label, 'Waiting for your approval');
  assert.equal(v.state, 'running');
  assert.match(v.html, /waiting for your approval/i);
  assert.equal(D.runView({ run_id: 'run_1', model: { ...m, detail: 'running' }, got: NOW }, NOW).label, 'Working: getting started');
  assert.equal(D.runView({ run_id: 'run_1', model: { ...m, state: 'done', detail: 'waiting_for_approval' }, got: NOW }, NOW).label, 'Done');
  assert.equal(D.runView({ run_id: 'run_1' }, NOW).label, 'Queued');
});

test('run thread persists as run ids and your texts only, and a damaged store loads as an empty thread', () => {
  const th = [{ run_id: 'run_a', text: 'hello', mode: 'new' }, { run_id: 'run_a', text: 'also this', mode: 'steer' }, { run_id: 'run_b', text: '', mode: 'launch' }];
  const raw = D.threadSave(th);
  assert.deepEqual(D.threadLoad(raw), th);
  assert.deepEqual(Object.keys(JSON.parse(raw)), ['v', 'turns']);
  assert.deepEqual(Object.keys(JSON.parse(raw).turns[0]).sort(), ['mode', 'run_id', 'text']);
  for (const bad of [null, '', 'not json', '[]', '{"turns":"x"}', '{"turns":[1,null,{"run_id":5},{"run_id":"bad id"}]}']) assert.deepEqual(D.threadLoad(bad), []);
  const mixed = D.threadLoad(JSON.stringify({ turns: [{ run_id: 'ok_1', text: 'a', mode: 'bogus' }, { run_id: '../etc', text: 'b' }, { run_id: 'ok_2', text: 42 }] }));
  assert.deepEqual(mixed, [{ run_id: 'ok_1', text: 'a', mode: 'new' }, { run_id: 'ok_2', text: '', mode: 'new' }]);
  const many = D.threadLoad(JSON.stringify({ turns: Array.from({ length: 20 }, (_, i) => ({ run_id: 'r' + i, text: '', mode: 'reply' })) }));
  assert.equal(many.length, 8);
  assert.equal(many[0].run_id, 'r12');
  assert.equal(D.threadSave(Array.from({ length: 20 }, (_, i) => ({ run_id: 'r' + i, text: '', mode: 'reply' }))).match(/"run_id"/g).length, 8);
});

test('run thread view: your message is a right-aligned bubble, the run output sits under the last message of that run', () => {
  const th = [{ run_id: 'run_a', text: 'post this <now>', mode: 'new' }, { run_id: 'run_a', text: 'shorter', mode: 'steer' }, { run_id: 'run_b', text: 'and then?', mode: 'reply' }];
  const out = (id) => '<div class="rl">out ' + id + '</div>';
  const h = D.threadHtml(th, out);
  assert.match(h, /<div class="rb m-new">post this &lt;now&gt;<\/div><div class="rb m-steer">shorter<\/div><div class="rout" data-run="run_a"><div class="rl">out run_a<\/div><\/div>/);
  assert.match(h, /<div class="rb m-reply">and then\?<\/div><div class="rout" data-run="run_b"><div class="rl">out run_b<\/div><\/div>$/);
  assert.equal((h.match(/class="rout"/g) || []).length, 2);
  assert.doesNotMatch(h, /<now>/);
  // a launched run has no bubble, only its output
  assert.equal(D.threadHtml([{ run_id: 'run_c', text: '', mode: 'launch' }], out), '<div class="rout" data-run="run_c"><div class="rl">out run_c</div></div>');
  assert.equal(D.threadHtml([], out), '');
});

test('run thread always ends with the open run so its output is never missing', () => {
  const th = [{ run_id: 'run_a', text: 'x', mode: 'new' }];
  assert.equal(D.threadFor(th, { run_id: 'run_a' }), th);
  assert.deepEqual(D.threadFor(th, { run_id: 'run_z' }).map((t) => t.run_id), ['run_a', 'run_z']);
  assert.deepEqual(D.threadFor([], { run_id: 'run_z' }), [{ run_id: 'run_z', text: '', mode: 'launch' }]);
  assert.deepEqual(D.threadFor(th, null), th);
  const full = Array.from({ length: 8 }, (_, i) => ({ run_id: 'r' + i, text: '', mode: 'reply' }));
  assert.equal(D.threadFor(full, { run_id: 'new' }).length, 8);
});

test('send: body carries run_id only when a run is open, replies map to ok or an inline error', () => {
  assert.deepEqual(D.sendBody('  hi  ', null), { text: 'hi' });
  assert.deepEqual(D.sendBody('hi', { run_id: 'run_a' }), { text: 'hi', run_id: 'run_a' });
  assert.deepEqual(D.sendBody('hi', { run_id: 'bad id' }), { text: 'hi' });
  for (const mode of ['new', 'reply', 'steer']) assert.deepEqual(D.sendResult({ ok: true, mode, run_id: 'run_q', t: 1 }, 200), { ok: true, mode, run_id: 'run_q' });
  assert.deepEqual(D.sendResult({ ok: false, error: 'rate limited', retry_s: 2 }, 429), { ok: false, err: 'Too many messages in a row. Try again in 2 s' });
  assert.deepEqual(D.sendResult({ ok: false, error: 'hermes gateway unreachable' }, 502), { ok: false, err: 'Hermes is not reachable right now' });
  assert.equal(D.sendResult(null, 413).err, 'That message is too long');
  assert.equal(D.sendResult(null, 503).err, 'Hermes is not reachable right now');
  assert.equal(D.sendResult(null, 0).err, 'The deck did not answer');
  for (const e of [D.sendResult(null, 413), D.sendResult(null, 502), D.sendResult({ ok: false, error: 'unknown run' }, 404)]) assert.doesNotMatch(e.err, /http|\d{3}/);
  assert.equal(D.sendResult({ ok: true, mode: 'weird', run_id: 'r' }, 200).ok, false);
  assert.equal(D.sendResult({ ok: true, mode: 'new', run_id: 'bad id' }, 200).ok, false);
  assert.equal(D.canSend('', false), false);
  assert.equal(D.canSend('  \n ', false), false);
  assert.equal(D.canSend('hi', true), false);
  assert.equal(D.canSend('hi', false), true);
});

test('composer keys: Cmd or Ctrl+Enter sends, Shift+Enter is a newline, plain Enter sends only on a touch keyboard, never mid-composition', () => {
  const k = (o) => Object.assign({ key: 'Enter', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false }, o);
  assert.equal(D.enterSends(k({ ctrlKey: true }), false), true);
  assert.equal(D.enterSends(k({ metaKey: true }), false), true);
  assert.equal(D.enterSends(k({}), false), false);
  assert.equal(D.enterSends(k({}), true), true);
  assert.equal(D.enterSends(k({ shiftKey: true }), true), false);
  assert.equal(D.enterSends(k({ isComposing: true, ctrlKey: true }), true), false);
  assert.equal(D.enterSends(k({ key: 'a', ctrlKey: true }), true), false);
  assert.equal(D.enterSends(null, true), false);
});

test('composer grows with its text up to four lines, then scrolls', () => {
  const lh = 22, pad = 22;
  assert.equal(D.growHeight(0, lh, pad), 44);
  assert.equal(D.growHeight(44, lh, pad), 44);
  assert.equal(D.growHeight(66, lh, pad), 66);
  assert.equal(D.growHeight(110, lh, pad), 110);
  assert.equal(D.growHeight(400, lh, pad), 110);
  assert.equal(D.growHeight(400, lh, pad, 2), 66);
  assert.equal(D.growHeight(NaN, lh, pad), 44);
});

test('run window markup: composer textarea with the contract attributes, Send button disabled at rest, New chat, inline error area', () => {
  assert.match(html, /<textarea id="runin" rows="1" enterkeyhint="send" autocomplete="off" autocapitalize="sentences"/);
  assert.match(html, /id="runsend" disabled>Send</);
  assert.match(html, /id="runnew"[^>]*>New chat</);
  assert.match(html, /id="runerr" role="alert"/);
  const panel = glue.slice(glue.indexOf('const RUN='), glue.indexOf('// ---- feedback release detail sheet'));
  assert.match(panel, /DeckUI\.sendBody\(text,RUN\.r\)/);
  assert.match(panel, /setRunErr\('Not sent\. '\+out\.err\)/);
  assert.match(panel, /catch\(e\)\{setRunErr\('Not sent\. The deck did not answer'\);haptic\('error'\)\}/);
  assert.match(panel, /localStorage\.setItem\(THREAD_KEY/);
  assert.match(glue, /THREAD_KEY='deck-last-thread'/);
  assert.match(panel, /openRun\(r,fresh\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '../static/agents.js'), 'utf8'), /openRun\(\{run_id:j\.run_id,name:j\.name\|\|b\.dataset\.id,opened:Date\.now\(\)\/1000\},true\)/);
});

// ---------------- links ----------------
test('every kind of link shows the arrow: rows, chips and product tiles; plain ones do not', () => {
  // Dev pull request rows are links only with a safe url; ui.css draws the arrow on a._blank rows, so the markup carries none.
  // A Vercel row opens its sheet (a chevron row); its site link is the sheet's a.ext action, which ui.css gives the same arrow.
  const dd = { t: NOW / 1000, src: 'x/dev.json', github: { open_prs: [{ repo: 'a/b', num: 1, title: 'T', ci: 'pass', url: 'https://github.com/a/b/pull/1' }, { repo: 'a/b', num: 2, title: 'U', ci: 'pass' }], failing_main: [] },
    vercel: { projects: [{ name: 'p1', state: 'READY', url: 'https://p1.vercel.app/' }, { name: 'p2', state: 'READY' }] } };
  const dev = D.devPage(dd, NOW);
  assert.equal((dev.match(/<a /g) || []).length, 1);
  assert.match(dev, /<button type="button" class="frow go" data-dv="vercel" data-key="p1"><span class="fl"><b>p1<\/b>/);
  assert.match(D.devSheet('vercel', 'p1', dd, null, NOW).actions, /^<a class="btn btn-primary ext" href="https:\/\/p1\.vercel\.app\/" target="_blank" rel="noopener noreferrer">Open site<\/a>$/);
  assert.equal(D.devSheet('vercel', 'p2', dd, null, NOW).actions, '');
  // a product alone in its state is its own row (House groups the rest by state, each name its own link)
  const prod = D.products({ t: NOW / 1000, src: 'x', errors: [], stale: false, app_store: null, needs: [], products: [{ id: 'mv', name: 'meshvault.ai', url: 'https://meshvault.ai/', code: 200, ms: 5, state: 'up', monitor: null }, { id: 'n', name: 'nolink', url: null, code: null, ms: 5, state: 'down', monitor: null }] }, NOW);
  assert.equal((prod.grid.match(/class="lk"/g) || []).length, 1);
  assert.match(prod.grid, /<a class="frow"[^>]*href="https:\/\/meshvault\.ai\/"[^>]*>[^]*<span class="lk" aria-hidden="true">\u2197<\/span><\/a>/);
});

test('iOS shell: the target attribute is dropped only for _blank anchors, only when the user agent says OmarchyDeck', () => {
  const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 OmarchyDeck/6';
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Version/27.0 Mobile/15E148 Safari/604.1';
  const pixel = 'Mozilla/5.0 (Linux; Android 16; Pixel 10a) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';
  assert.equal(D.isDeckShell(ios), true);
  for (const ua of [safari, pixel, '', null, undefined, 'OmarchyDeck']) assert.equal(D.isDeckShell(ua), false, String(ua));
  assert.equal(D.dropsTarget(ios, 'A', '_blank'), true);
  assert.equal(D.dropsTarget(ios, 'a', '_BLANK'), true);
  assert.equal(D.dropsTarget(ios, 'A', '_self'), false);
  assert.equal(D.dropsTarget(ios, 'A', null), false);
  assert.equal(D.dropsTarget(ios, 'BUTTON', '_blank'), false);
  assert.equal(D.dropsTarget(safari, 'A', '_blank'), false, 'Safari tabs, Pixel web app and desktop keep target=_blank');
  assert.equal(D.dropsTarget(pixel, 'A', '_blank'), false);
  assert.match(glue, /document\.addEventListener\('click',e=>\{const a=e\.target&&e\.target\.closest&&e\.target\.closest\('a\[target\]'\);/);
  assert.match(glue, /a\.removeAttribute\('target'\)\},true\)/);
});

test('Crons and Fleet footers no longer claim read only; the glue stores the feed the sheet reads', () => {
  assert.doesNotMatch(src.slice(a, b), /read only \\u00B7 no pause, resume or run here/);
  assert.match(glue, /async function cronsReload\(\)\{const f=await feedGet\('crons'\);if\(f&&!f\.error\)V6\.crons=f;if\(typeof cronsRepaint==='function'\)cronsRepaint\(\)\}/);
  assert.match(glue, /cronsReload/);
  assert.match(glue, /fetch\('\/api\/cron-act\?id='\+encodeURIComponent\(s\.id\)\+'&act='\+encodeURIComponent\(act\),\{method:'POST'\}\)/);
  assert.match(glue, /fetch\('\/api\/unit\?name='\+encodeURIComponent\(name\)/);
  assert.doesNotMatch(glue, /\/api\/(restart|stop|unit-act)/);
});
