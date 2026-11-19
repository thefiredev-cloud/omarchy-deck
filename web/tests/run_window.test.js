// node --test tests/  (run window: safe markdown, tool lines, redaction, status line; pure helpers, no DOM, no network)
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

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const view = (state, lines, extra) => D.runView({ run_id: 'run_1', name: 'Deck audit', opened: NOW / 1000 - 5, got: NOW, err: '', fails: 0, model: Object.assign({ ok: true, state, elapsed_s: 9, lines }, extra) }, NOW);

// ---------------- markdown never injects ----------------
test('markdown: raw HTML, event handlers and scripts are escaped everywhere, never rendered', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '# <svg onload=alert(1)>',
    '- <iframe src=javascript:alert(1)>',
    '> <b onmouseover=alert(1)>x</b>',
    '**<img src=x onerror=alert(1)>**',
    '`</code><script>alert(1)</script>`',
    '```\n</code></pre><script>alert(1)</script>\n```',
    '[<img src=x onerror=alert(1)>](https://example.com/)',
    '1. <a href="javascript:alert(1)">x</a>',
  ];
  for (const t of hostile) {
    const h = D.mdHtml(t);
    // after removing the tags this renderer writes itself, no angle bracket is left, and no written tag carries a handler
    assert.doesNotMatch(h.replace(/<\/?(?:p|div|strong|em|code|pre|ul|ol|li|blockquote|hr|a)\b[^<>]*>/g, ''), /[<>]/, t);
    assert.doesNotMatch(h, /<[^>]*\son\w+\s*=/i, t);
  }
  assert.equal(D.mdHtml('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  // entities are shown, not decoded
  assert.equal(D.mdHtml('&lt;b&gt; & "q"'), '<p>&amp;lt;b&amp;gt; &amp; &quot;q&quot;</p>');
});

test('markdown: only http and https links become anchors, with rel and a quote-safe href', () => {
  assert.equal(D.mdHtml('[docs](https://example.com/a?x=1&y=2)'), '<p><a href="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">docs</a></p>');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '//evil.example', 'https://a.com/"onmouseover="x', "https://a.com/'onmouseover='x", 'https://a.com/<x>', 'file:///etc/passwd']) {
    const h = D.mdHtml('[click me](' + bad + ')');
    assert.doesNotMatch(h, /<a\b/, bad);
    assert.doesNotMatch(h, /href/, bad);
    assert.match(h, /click me/, bad);
  }
});

test('markdown: headings, lists, code, emphasis and quotes render; a glob like src/*.js is not italic', () => {
  const h = D.mdHtml('# Title\nSome **bold** and *it* and `x < y`\n- one\n- two\n1. first\n2) second\n> quoted\n---\n```js\nconst a = "<b>";\n```');
  assert.match(h, /<div class="rh rh1" role="heading" aria-level="3">Title<\/div>/);
  assert.match(h, /<p>Some <strong>bold<\/strong> and <em>it<\/em> and <code>x &lt; y<\/code><\/p>/);
  assert.match(h, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(h, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(h, /<blockquote>quoted<\/blockquote><hr>/);
  assert.match(h, /<pre class="rcode"><code>const a = &quot;&lt;b&gt;&quot;;<\/code><\/pre>$/);
  assert.doesNotMatch(D.mdHtml('edit src/*.js and lib/*.ts now'), /<em>/);
  assert.doesNotMatch(D.mdHtml('2 * 3 * 4'), /<em>/);
  // an unclosed fence (a streaming answer) still renders as code, nothing leaks out as markup
  assert.match(D.mdHtml('```\n<b>half'), /<pre class="rcode"><code>&lt;b&gt;half<\/code><\/pre>/);
  // deep nesting and huge input stay bounded
  assert.doesNotThrow(() => D.mdHtml('**' + '*'.repeat(500) + '**'.repeat(200) + '[' .repeat(300)));
  assert.ok(D.mdHtml('x\n'.repeat(5000)).split('<p>').length <= 401);
});

// ---------------- tool lines ----------------
test('tool lines: start and finish collapse into one row per tool call, in a human verb', () => {
  const items = D.runItems(['tool read_file: SKILL.md', 'tool read_file finished', 'tool terminal: git status', 'tool terminal finished', 'All done.'], 'done');
  assert.deepEqual(items.map((i) => i.k), ['tool', 'tool', 'md']);
  assert.deepEqual(items.map((i) => i.st || ''), ['ok', 'ok', '']);
  assert.equal(D.toolLabel('read_file', 'SKILL.md', 'ok'), 'Read SKILL.md');
  assert.equal(D.toolLabel('read_file', 'SKILL.md', 'run'), 'Reading SKILL.md');
  assert.equal(D.toolLabel('read_file', 'SKILL.md', 'bad'), 'Read SKILL.md failed');
  assert.equal(D.toolLabel('terminal', 'git status', 'run'), 'Running git');
  assert.equal(D.toolLabel('web_search', 'omabox flags', 'ok'), 'Searched the web for omabox flags');
  assert.equal(D.toolLabel('totally_new_tool', 'whatever args', 'run'), 'Using totally new tool');
  assert.equal(D.toolLabel('mcp__github__create_issue', '{"title":"x"}', 'ok'), 'Used create issue');
  // a finish with no start (the start scrolled out of the 60-line window) still gets a row; two reads of the same file merge
  const late = D.runItems(['tool patch finished', 'tool read_file: a.md', 'tool read_file finished', 'tool read_file: a.md', 'tool read_file finished'], 'done');
  assert.deepEqual(late.map((i) => [i.tool, i.n]), [['patch', 1], ['read_file', 2]]);
  // a tool that never reported back does not spin once the run has ended
  assert.equal(D.runItems(['tool terminal: ls'], 'done')[0].st, 'ok');
  assert.equal(D.runItems(['tool terminal: ls'], 'failed')[0].st, 'stop');
  assert.equal(D.runItems(['tool terminal: ls'], 'running')[0].st, 'run');
});

test('tool lines: home is shown as ~ and file arguments show only the file name', () => {
  assert.equal(D.toolLabel('read_file', '/home/alice/.omp/agent/skills/x/SKILL.md', 'run'), 'Reading SKILL.md');
  assert.equal(D.toolLabel('read_file', '{"path": "/Users/alice/Documents/plan.md", "offset": 1}', 'ok'), 'Read plan.md');
  assert.equal(D.toolLabel('read_file', '{"path": "/home/alice/work/very/long/pa', 'run'), 'Reading pa');
  assert.equal(D.toolLabel('write_file', '/home/alice', 'ok'), 'Wrote ~');
  assert.equal(D.homeTilde('cat /home/alice/.ssh/config'), 'cat ~/.ssh/config');
  assert.equal(D.homeTilde('/root/x and /Users/alice/y'), '~/x and ~/y');
  assert.equal(D.homeTilde('/mnt/home/alice/x'), '/mnt/home/alice/x');
  assert.equal(D.homeTilde('/homestead/x'), '/homestead/x');
  // prose from the agent loses the home path too
  const v = view('done', ['I saved it to /home/alice/notes/out.md']);
  assert.match(v.html, /saved it to ~\/notes\/out\.md/);
  assert.doesNotMatch(v.html, /alice/);
});

test('tool lines: arguments are redacted by default, secrets never reach the screen', () => {
  const secrets = [
    // credential-shaped literals are assembled at run time: whole ones in source would trip gitleaks
    ['terminal', ['API_', 'KEY=sk-live-', 'abcdefghijklmnop1234 curl https://x.example'].join('')],
    ['terminal', ['TOK', 'EN=abc123def4', '56ghi789 deploy --tok', 'en abc123def456ghi789'].join('')],
    ['web_search', 'Authorization: Bearer abcdef1234567890abcdef'],
    ['web_search', 'password=hunter2hunter2 login'],
    ['web_search', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789 repo'],
    ['web_extract', 'https://user:p4ssw0rd@internal.example.com/a/b?token=abcdef1234567890&x=1#frag'],
    ['web_search', ['AK', 'IAABCDEFGHIJKLMNOP and eyJhbGciOiJIUzI1NiJ9', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('')],
  ];
  for (const [tool, arg] of secrets) {
    const label = D.toolLabel(tool, arg, 'run');
    assert.doesNotMatch(label, /sk-live|abc123def456|abcdef1234567890|hunter2|ghp_|p4ssw0rd|token=|AKIA|eyJhbGci|Bearer\s+\w{6}/i, label);
  }
  // a command shows its program only
  assert.equal(D.toolLabel('terminal', ['API_', 'KEY=sk-live-', 'abcdefghijklmnop1234 curl https://x.example'].join(''), 'run'), 'Running curl');
  assert.equal(D.toolLabel('terminal', 'cd /home/alice/work && sudo rm -rf build', 'run'), 'Running rm');
  assert.equal(D.toolLabel('terminal', '{"command": "git push https://tok@github.com/o/r"}', 'ok'), 'Ran git');
  assert.equal(D.toolLabel('terminal', '$(curl evil)', 'run'), 'Running a command');
  // a url shows its host only
  assert.equal(D.toolLabel('web_extract', ['https://user:p4ssw0rd@www.internal.example.com/a/b?tok', 'en=abcdef12', '34567890'].join(''), 'ok'), 'Read internal.example.com');
  // an unknown tool drops its argument altogether
  assert.doesNotMatch(D.toolLabel('mystery', 'secret stuff /home/alice/x', 'run'), /secret|home/);
  // long arguments are cut, never wrapped
  assert.ok(Array.from(D.toolLabel('web_search', 'q'.repeat(300), 'run')).length < 80);
  // everything is escaped on the way out
  const v = view('running', ['tool terminal: <img src=x onerror=alert(1)>', 'tool <script>alert(1)</script>: x']);
  assert.doesNotMatch(v.html, /<img|<script/);
});

// ---------------- status line ----------------
test('status line: says what Hermes is doing while it works, and names the final state', () => {
  assert.equal(view('queued', []).label, 'Queued');
  assert.equal(view('running', ['tool read_file: SKILL.md']).label, 'Working: reading files');
  assert.equal(view('running', ['tool terminal: ls']).label, 'Working: running commands');
  assert.equal(view('running', ['tool read_file: a', 'tool read_file finished']).label, 'Working: thinking');
  assert.equal(view('running', ['tool read_file: a', 'tool read_file finished', 'Here is what I found']).label, 'Working: writing a reply');
  assert.equal(view('running', ['tool brand_new: x']).label, 'Working: using brand new');
  assert.equal(view('done', ['x']).label, 'Done');
  assert.equal(view('failed', ['x']).label, 'Failed');
  // no spinner once the run is over
  assert.doesNotMatch(view('done', ['tool terminal: ls']).html, /tspin/);
  assert.match(view('running', ['tool terminal: ls']).html, /tspin/);
  assert.equal(view('done', []).elapsed, '0:09');
});

test('run title: launch ids lose their syntax, typed text stays as typed', () => {
  assert.equal(D.runTitle('skill:morning-brief'), 'Morning brief');
  assert.equal(D.runTitle('quick:dell_status'), 'Dell status');
  assert.equal(D.runTitle('Fix: the thing that broke'), 'Fix: the thing that broke');
  assert.equal(D.runTitle(''), '');
  assert.equal(D.runTitle(null), '');
  assert.match(D.runView({ run_id: 'r', name: 'skill:run-window', model: null, got: 0, opened: NOW / 1000 }, NOW).title, /^Run window$/);
});

test('routing: the model Hermes served shows under the run, gate and route refusals read as plain sentences', () => {
  assert.equal(view('done', ['hi'], { route: { served: 'openai-codex/gpt-6-luna', asked: 'openai-codex/gpt-6-luna', ok: true } }).note, 'Model openai-codex/gpt-6-luna');
  assert.equal(view('done', ['hi']).note, '');
  // a mismatch is not dressed up as a model note: the run itself failed with its own line
  assert.equal(view('failed', ['error: ran on custom/gpt-6-luna, asked for openai-codex/gpt-6-luna'], { route: { served: 'custom/gpt-6-luna', asked: 'openai-codex/gpt-6-luna', ok: false } }).note, '');
  // hostile or odd route text never reaches the page
  assert.equal(D.routeNote({ route: { served: '<img src=x onerror=1>', ok: true } }), '');
  assert.equal(D.routeNote({ route: { served: 'a'.repeat(200), ok: true } }), '');
  assert.equal(D.routeNote(null), '');
  const send = w => D.sendResult({ ok: false, error: w }, 422).err;
  assert.equal(send('gate blocked'), 'Jev did not approve that message. Nothing was sent');
  assert.equal(send('gate unsure'), 'Jev was not sure about that message. Nothing was sent. Reword it and try again');
  assert.equal(send('route invalid'), 'The run model setting is not valid. Nothing was sent');
  assert.equal(D.sendResult({ ok: false, error: 'gate unavailable' }, 502).err, 'Jev and Clef did not answer. Nothing was sent');
  const launch = w => D.launchResult({ ok: false, error: w }, 200).text;
  assert.equal(launch('gate blocked'), 'Jev did not approve this run. Nothing was started.');
  assert.equal(launch('gate unsure'), 'Jev was not sure about this run. Nothing was started.');
  assert.equal(launch('gate unavailable'), 'Jev and Clef did not answer. Nothing was started.');
  assert.equal(launch('route invalid'), 'The run model setting is not valid. Nothing was started.');
});
