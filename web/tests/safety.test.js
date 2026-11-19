// node --test tests/  (safety lane: ONE redaction rule, now-playing art, long messages, Unicode spaces; pure helpers and the real composer glue under vm fakes)
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const deckSrc = read('deck.js');
const a = deckSrc.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const b = deckSrc.indexOf('// ==== DECK V6 UI HELPERS END ====');
assert.ok(a >= 0 && b > a);
const D = new Function(deckSrc.slice(a, b) + '\nreturn DeckUI;')();
const appSrc = read('app.js');
const ta = appSrc.indexOf('// ==== TODAY UI HELPERS BEGIN');
const tb = appSrc.indexOf('// ==== TODAY UI HELPERS END ====');
const todayWith = (ctx) => vm.runInNewContext(appSrc.slice(ta, tb) + '\nTodayUI;', ctx, { timeout: 1000 });
const T = todayWith({ DeckUI: D });

// tests/fixtures/redact-cases.json is the same list the Rust scrub and scripts/deck-launch clean_line are tested with
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'redact-cases.json'), 'utf8'));
const load = (s) => s.replace(/\u0001/g, '');

test('redaction corpus: every reviewer repro is cut, a second pass changes nothing, plain lines survive', () => {
  assert.ok(corpus.cases.length >= 40);
  for (const c of corpus.cases) {
    const line = load(c.in);
    const out = D.scanSecrets(line);
    for (const s of c.secrets) assert.ok(!out.includes(load(s)), `${line} -> ${out} still holds ${s}`);
    assert.ok(out.includes(corpus.mark), `${line} -> ${out}`);
    for (const k of c.keep || []) assert.ok(out.includes(load(k)), `${line} -> ${out} lost ${k}`);
    assert.equal(D.scanSecrets(out), out, `second pass over ${line}`);
    assert.ok(!D.redact(line).includes(load(c.secrets[0])), `redact(${line})`);
  }
  for (const p of corpus.plain) assert.equal(D.scanSecrets(p), p);
});

test('redaction: a url keeps its links in prose and loses its query string in tool arguments', () => {
  assert.equal(D.scanSecrets('see https://example.com/watch?v=abc123 for more'), 'see https://example.com/watch?v=abc123 for more');
  assert.equal(D.scrubArg('https://u:p4ss@internal.example.com/a/b?token=abcdef1234567890&x=1#frag', 80), 'https://\u2026@internal.example.com/a/b');
  assert.equal(D.scrubArg('password=hunter2hunter2 login', 80), 'password=\u2026 login');
  assert.equal(D.scrubArg('x'.repeat(40) + '1', 80), '\u2026');
});

test('run window prose: JSON config dumps, tokens, cookies and home folders in agent text never reach the screen', () => {
  const lines = [
    // credential-shaped literals are assembled at run time: whole ones in source would trip gitleaks
    ['{"pass', 'word":"hunter2', 'hunter2"}'].join(''),
    ['{"access_', 'token":"abcdef12', '3456789"}'].join(''),
    ['"api_', 'key": "abcdefgh', 'ijkl"'].join(''),
    ['ses', 'sion=abcdef', '123456'].join(''),
    ['Cookie: pd', 'eck=abcdef', '123456'].join(''),
    'postgres://user:pass@db/x',
    ['https://host/x?tok', 'en=abc'].join(''),
    ['Basic dXNlcjpwYXNz', 'd29yZA=='].join(''),
    ['h', 'f_'].join('') + 'abcdefghijklmnopqrstuvwx',
    ['np', 'm_'].join('') + 'abcdefghijklmnopqrstuvwx',
    ['glp', 'at-'].join('') + 'abcdefghijklmnopqrst',
    ['AI', 'zaSyA-'].join('') + 'abcdefghijklmnopqrstuvwxyz0123456',
    'saved to file:///home/alice/work/out.md and \\/home\\/alice\\/x',
  ];
  const now = Date.UTC(2026, 10, 5, 12, 0, 0);
  const view = D.runView({ run_id: 'run_1', name: 'x', opened: now / 1000 - 5, got: now, err: '', fails: 0, model: { ok: true, state: 'done', elapsed_s: 9, lines } }, now);
  for (const leak of ['hunter2hunter2', 'abcdef123456789', 'abcdefghijkl', 'abcdef123456', 'user:pass', 'token=abc', 'dXNlcjpwYXNzd29yZA', 'abcdefghijklmnopqrst', 'alice']) {
    assert.ok(!view.html.includes(leak), `${leak} reached the run window`);
  }
  assert.match(view.html, /saved to file:\/\/~\/work\/out\.md/);
  // an error line goes through the same rule
  const failed = D.runView({ run_id: 'run_1', name: 'x', opened: now / 1000 - 5, got: now, err: '', fails: 0, model: { ok: true, state: 'failed', elapsed_s: 9, lines: [['error: {"access_', 'token":"abcdef12', '3456789"} at /home/alice/x'].join('')] } }, now);
  assert.ok(!failed.html.includes('abcdef123456789') && !failed.html.includes('alice'));
});

test('unit log lines (the failing-unit sheet) go through the same rule: npm, glpat, hf, AIza, rk, Basic, session, pdeck, ?k=', () => {
  const split = (x, y) => x + y;
  const lines = [
    split('np', 'm_') + 'abcdefghijklmnopqrstuvwx', split('glp', 'at-') + 'abcdefghijklmnopqrst', split('h', 'f_') + 'abcdefghijklmnopqrstuvwx',
    split('AI', 'zaSyA-') + 'abcdefghijklmnopqrstuvwxyz0123456', split('r', 'k_live_') + '0123abcd0123abcd', 'Basic dXNlcjpwYXNzd29yZA==',
    ['ses', 'sion=abcdef', '123456'].join(''), ['pd', 'eck=AbCdEf', '0123456789'].join(''), '/cam/eufy_cam1/index.m3u8?k=0123456789ABCDEF', 'ok line at /home/alice/.hermes/x',
  ];
  const v = D.unitView({ ok: true, active: 'failed', sub: 'failed', result: 'exit-code', exit: 1, since: 'x', lines });
  const text = v.log.join('\n');
  for (const leak of ['abcdefghijklmnopqrst', '0123abcd' + '0123abcd', 'dXNlcjpwYXNz' + 'd29yZA', 'abcdef' + '123456', 'AbCdEf' + '0123456789', '0123456789' + 'ABCDEF', 'alice']) {
    assert.ok(!text.includes(leak), `${leak} reached the unit log`);
  }
  assert.match(text, /ok line at ~\/\.hermes\/x/);
  assert.match(text, /\/cam\/eufy_cam1\/index\.m3u8/);
});

test('home folders: every shape the review found reads ~, the middle of a path stays', () => {
  const cases = [
    ['Failed to load /home/alice/.hermes/.env', 'Failed to load ~/.hermes/.env'],
    ['file:///home/alice/x/y.txt', 'file://~/x/y.txt'],
    ['at /home/alice/work/x.js:12', 'at ~/work/x.js:12'],
    ['PATH=/usr/bin:/home/alice/.cargo/bin', 'PATH=/usr/bin:~/.cargo/bin'],
    ['{"path":"/home/alice/a"}', '{"path":"~/a"}'],
    ['a,/home/alice/a', 'a,~/a'],
    ['-C/home/alice/a', '-C~/a'],
    ['cd /home/alice', 'cd ~'],
    ['/home/alice', '~'],
    ['>/home/alice/log', '>~/log'],
    ['|/home/alice/log', '|~/log'],
    ['{/home/alice/log}', '{~/log}'],
    ['\\/home\\/alice\\/x', '~\\/x'],
    ['/Users/alice/Library/x', '~/Library/x'],
    ['~/x and $HOME/y and ${HOME}/z', '~/x and ~/y and ~/z'],
    ['$HOME', '~'],
    ['HOME=/home/alice', 'HOME=~'],
    ['/home/alice/.local/state; /home/morgan/x', '~/.local/state; ~/x'],
    ['/root/.ssh/id_rsa', '~/.ssh/id_rsa'],
    // the middle of a path is not a home folder
    ['x /var/home/alice/y', 'x /var/home/alice/y'],
    ['/mnt/disk/home/alice/y', '/mnt/disk/home/alice/y'],
    ['/mnt/home/alice/x', '/mnt/home/alice/x'],
    ['/homestead/x and /rootfs/y and $HOMEWARD', '/homestead/x and /rootfs/y and $HOMEWARD'],
  ];
  for (const [input, want] of cases) {
    assert.equal(D.homeTilde(input), want, input);
    assert.ok(!/alice|morgan|tanner/.test(D.redact(input).replace(/\u2026/g, '')) || /^(x |\/mnt)/.test(input), 'redact: ' + input);
  }
});

test('Today diagnostics (dgH) use the same rule: $HOME, /root, tokens and accounts never show', () => {
  const html = T.dgH(['$HOME/.hermes/.env', '/root/.ssh/id_rsa', 'Authorization: Bearer abcdefgh12345678', 'file:///home/alice/x', 'account: tanner@meshvault.ai', 'PATH=/usr/bin:/home/alice/bin']);
  assert.ok(!/HOME|\/root|abcdefgh12345678|alice|tanner/.test(html), html);
  assert.equal((html.match(/<span class="diag">/g) || []).length, 6);
  assert.match(html, /<span class="diag">~\/\.hermes\/\.env<\/span>/);
  assert.match(html, /<span class="diag">~\/\.ssh\/id_rsa<\/span>/);
  // it is DeckUI.redact, not a copy: the same input gives the same text from both
  for (const s of ['x', '/home/alice/a b', ['tok', 'en=abcdef', '123456'].join('')]) assert.equal(T.dgH([s]), '<span class="diag">' + D.esc(D.redact(s)) + '</span>');
  // hostile text is escaped, non-strings and empty strings are dropped
  assert.equal(T.dgH(['<b>"x"</b>', '', 5, null]), '<span class="diag">&lt;b&gt;&quot;x&quot;&lt;/b&gt;</span>');
  assert.equal(T.dgH('nope'), '');
  // without the rule (deck.js not loaded) nothing is written: a diagnostic is never shown unredacted
  assert.equal(todayWith({}).dgH(['/home/alice/x', ['tok', 'en=abcdef', '123456'].join('')]), '');
});

test('now-playing art: same-origin only, never off-origin and never data: or blob:', () => {
  const src = appSrc.slice(appSrc.indexOf('const artSrc='), appSrc.indexOf('\n', appSrc.indexOf('const artSrc=')));
  const artSrc = new Function(src + '\nreturn artSrc;')();
  const O = 'https://deck.example.ts.net:8796';
  assert.equal(artSrc('/api/art?id=1', O), '/api/art?id=1');
  assert.equal(artSrc(O + '/art.png', O), '/art.png');
  for (const bad of ['https://i.scdn.co/image/ab67616d00001e02', 'http://deck.example.ts.net:8796/x', '//evil.example/x.png', 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=', 'blob:https://deck.example.ts.net:8796/1', 'javascript:alert(1)', 'https://deck.example.ts.net:8796@evil.example/x', '', null, undefined, 5, {}]) {
    assert.equal(artSrc(bad, O), '', String(bad));
  }
  assert.equal(artSrc('/x', ''), '');
  assert.equal(artSrc('/x', undefined), '');
  // the shell ships no data: placeholder and no off-origin default: the picture starts hidden on a same-origin file
  const html = read('index.html');
  assert.match(html, /<img id="art" alt="" src="\/icon\.svg" hidden>/);
  assert.ok(!/<img id="art"[^>]*src="(?:data:|blob:|https?:)/.test(html));
});

test('now playing: the real refresh() hides off-origin art and never lets it reach the img src; same-origin art shows', async () => {
  const code = appSrc.slice(appSrc.indexOf('const artSrc='), appSrc.indexOf('\n', appSrc.indexOf('const artSrc='))) + '\n' +
    appSrc.slice(appSrc.indexOf('function fmtSt'), appSrc.indexOf('// Focus mode removed')) + '\nthis.__t={refresh};';
  const run = async (media) => {
    const els = {};
    const el = (sel) => els[sel] || (els[sel] = { sel, hidden: true, src: '/icon.svg', textContent: '', value: '', style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} } });
    const requested = [];
    const ctx = {
      $: el, $$: () => [], location: { origin: 'https://deck.test' }, URL, Date, busy: 0, ws: 0,
      q: async (p) => (p === 'media' ? media : p === 'vol' ? { volume: 30, muted: false } : { ws: 1 }),
      flag() {}, ctx() {}, showSt() {}, showVol() {}, lastMedia: null,
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    await ctx.__t.refresh();
    return { art: el('#art'), requested };
  };
  const off = await run({ title: 'Song', artist: 'A', status: 'Playing', player: 'spotify', art: 'https://i.scdn.co/image/ab67616d00001e02' });
  assert.equal(off.art.hidden, true);
  assert.equal(off.art.src, '/icon.svg', 'an off-origin picture is never assigned');
  const data = await run({ title: 'Song', status: 'Playing', art: 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=' });
  assert.equal(data.art.hidden, true);
  assert.equal(data.art.src, '/icon.svg');
  const same = await run({ title: 'Song', status: 'Playing', art: '/api/art?id=7' });
  assert.equal(same.art.hidden, false);
  assert.equal(same.art.src, '/api/art?id=7');
  const idle = await run({ title: '', status: 'Stopped', art: '/api/art?id=7' });
  assert.equal(idle.art.hidden, true, 'nothing playing: no picture');
});

// ---------------- long messages ----------------
const words = (n) => Array.from({ length: n }, (_, i) => 'word' + i).join(' ');

test('a long message is never cut: sendText keeps all of it, sendState says how long, Send is off over 2000', () => {
  const long = words(400).slice(0, 2289);
  const st = D.sendState(long);
  assert.equal(st.n, 2289);
  assert.equal(st.text, long.trim());
  assert.deepEqual([st.max, st.tooLong, st.ok, st.empty], [2000, true, false, false]);
  assert.equal(D.sendText(long), long.trim());
  assert.equal(D.canSend(long, false), false);
  assert.equal(D.tooLongText(st), 'Too long: 2289 of 2000');
  const exact = 'x'.repeat(2000);
  assert.deepEqual([D.sendState(exact).tooLong, D.sendState(exact).ok, D.canSend(exact, false)], [false, true, true]);
  assert.equal(D.sendState(exact + 'y').n, 2001);
  assert.equal(D.sendState(exact + 'y').ok, false);
  // counts code points, like the server: 1500 emoji is 1500, not 3000
  assert.equal(D.sendState('\u{1F600}'.repeat(1500)).n, 1500);
  assert.equal(D.sendState('\u{1F600}'.repeat(2001)).tooLong, true);
  assert.equal(D.sendState('   ').empty, true);
  assert.equal(D.sendState(null).ok, false);
  // sendBody never shortens the text either
  assert.equal(D.sendBody(long, null).text.length, 2289);
  // names and drafts that ask for a cap still get one
  assert.equal(D.cleanText('x'.repeat(500), 80).length, 80);
});

// the real composer glue (paintComposer, setRunErr, runSend) under fakes
function composer(initial) {
  const els = {};
  const el = (sel) => els[sel] || (els[sel] = { sel, value: '', innerHTML: '', textContent: '', disabled: false, placeholder: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const posted = [];
  const sent = [];
  const RUN = { sending: false, r: null };
  const glue = deckSrc.slice(b);
  const code = glue.slice(glue.indexOf('function setRunErr'), glue.indexOf('function runPaint')) +
    '\n' + glue.slice(glue.indexOf('async function runSend'), glue.indexOf("$('#runsend').addEventListener")) +
    '\nthis.__t={paintComposer,runSend,setRunErr};';
  const ctx = {
    $: el, DeckUI: D, esc: D.esc, RUN, haptic() {}, growIn() {}, runSent: (out, text) => sent.push([out, text]),
    fetch: async (url, init) => { posted.push([url, JSON.parse(init.body)]); return { status: 200, json: async () => ({ ok: true, mode: 'new', run_id: 'run_1', t: 1 }) }; },
    // runSend posts through bfetch, the file's one abort-bounded fetch wrapper
    bfetch: (url, init) => ctx.fetch(url, init),
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  el('#runin').value = initial || '';
  return { ctx, els, el, posted, sent, RUN, ...ctx.__t };
}

test('composer: a 2289 character message shows "Too long: 2289 of 2000", Send is off and nothing is posted or cleared', async () => {
  const long = words(400).slice(0, 2289);
  const c = composer(long);
  c.paintComposer('');
  assert.equal(c.el('#runsend').disabled, true);
  assert.match(c.el('#runerr').innerHTML, /Too long: 2289 of 2000/);
  await c.runSend();
  assert.equal(c.posted.length, 0, 'an over-long message is never sent, cut or not');
  assert.equal(c.el('#runin').value, long, 'the text stays in the box');
  // trim it under the limit: the message clears itself and Send comes back
  c.el('#runin').value = long.slice(0, 1990);
  c.paintComposer('');
  assert.equal(c.el('#runerr').innerHTML, '');
  assert.equal(c.el('#runsend').disabled, false);
  // exactly 2000: sent whole, tail intact
  const exact = (words(400) + ' tail').slice(0, 1995) + ' tail';
  assert.equal(Array.from(exact).length, 2000);
  c.el('#runin').value = exact;
  c.paintComposer('');
  await c.runSend();
  assert.equal(c.posted.length, 1);
  assert.equal(c.posted[0][1].text, exact);
  assert.ok(c.posted[0][1].text.endsWith(' tail'));
});

test('composer: a send error is not wiped by typing, and an under-limit box leaves other errors alone', () => {
  const c = composer('short message');
  c.setRunErr('Not sent. The deck did not answer');
  c.paintComposer('');
  assert.match(c.el('#runerr').innerHTML, /Not sent\. The deck did not answer/);
});

// ---------------- Unicode spaces ----------------
test('Unicode spaces become U+0020 on the client, like U+00A0, and the message is accepted by the server rule', () => {
  for (const sp of ['\u00A0', '\u1680', '\u2000', '\u2002', '\u2003', '\u2009', '\u200A', '\u202F', '\u205F', '\u3000']) {
    assert.equal(D.cleanText('a' + sp + 'b'), 'a b', sp.codePointAt(0).toString(16));
    assert.equal(D.sendText(sp + 'hi' + sp + 'there' + sp), 'hi there');
    assert.equal(D.sendState(sp + sp).empty, true);
  }
  // what the server still refuses is dropped, not turned into a space
  assert.equal(D.cleanText('a\u2028b\u2029c\u0085d'), 'abcd');
  // ZWJ sequences keep their joiners
  const fam = '\u{1F468}\u200D\u{1F469}';
  assert.equal(D.cleanText('hi ' + fam), 'hi ' + fam);
  // nothing the client keeps is a whitespace character other than U+0020, \n and \t (those are what the server refuses)
  const kept = D.cleanText(Array.from({ length: 0x3100 }, (_, i) => String.fromCharCode(i)).join('').replace(/[\uD800-\uDFFF]/g, ''), 100000);
  assert.ok(!/[^\S \n\t]/.test(kept.replace(/[\n\t]/g, '')), 'no other whitespace survives cleanText');
});
