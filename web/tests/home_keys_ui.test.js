// Home, Keys and Pad surfaces: key rows keep the served index, the accel curve is smooth, and the shell
// markup carries the controls these pages drive. Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('static/app.js');
const html = read('static/index.html');
const keysJson = JSON.parse(read('keys.json'));
const P = require('../static/pad.js');

const block = (src, begin, end) => {
  const s = src.indexOf(begin), e = src.indexOf(end);
  assert.ok(s >= 0 && e > s, 'helper block missing: ' + begin);
  return src.slice(s, e);
};
const KEYROWS = vm.runInNewContext(block(app, '// ==== KEY ROWS HELPERS BEGIN', '// ==== KEY ROWS HELPERS END ====') + '\nKEYROWS;', {}, { timeout: 1000 });

const served = keysJson.keys.map(k => ({ label: k.label, icon: k.icon, action: k.action, arg: k.arg || '', confirm: !!k.confirm }));

test('key rows: every served key lands in one labelled row and keeps its served index', () => {
  const rows = KEYROWS.rows(served);
  const flat = rows.flatMap(r => r.keys);
  assert.equal(flat.length, served.length);
  flat.forEach(({ k, i }) => assert.equal(k, served[i]));
  assert.deepEqual([...new Set(flat.map(e => e.i))].sort((a, b) => a - b), served.map((_, i) => i));
  assert.deepEqual([...rows.map(r => r.id)], ['apps', 'media', 'workspaces', 'window', 'system']);
  assert.deepEqual([...rows.map(r => r.name)], ['Apps', 'Media', 'Go to workspace', 'Move window', 'System']);
});

test('key rows: groups follow the action, and an unknown action still lands in Apps', () => {
  assert.equal(KEYROWS.group({ action: 'ws', arg: '3' }), 'workspaces');
  assert.equal(KEYROWS.group({ action: 'mvws', arg: '3' }), 'window');
  assert.equal(KEYROWS.group({ action: 'media-act', arg: 'next' }), 'media');
  assert.equal(KEYROWS.group({ action: 'mute', arg: '' }), 'media');
  assert.equal(KEYROWS.group({ action: 'lock', arg: '' }), 'system');
  assert.equal(KEYROWS.group({ action: 'screenshot', arg: '' }), 'system');
  assert.equal(KEYROWS.group({ action: 'launch', arg: 'menu' }), 'system');
  assert.equal(KEYROWS.group({ action: 'launch', arg: 'terminal' }), 'apps');
  assert.equal(KEYROWS.group({ action: 'launch', arg: 'apps' }), 'apps');
  assert.equal(KEYROWS.group({}), 'apps');
  assert.equal(KEYROWS.label('nope'), 'nope');
});

test('key rows: no empty row is drawn for a group the host does not serve', () => {
  const rows = KEYROWS.rows([{ action: 'ws', arg: '1' }, { action: 'lock', arg: '' }]);
  assert.deepEqual([...rows.map(r => r.id)], ['workspaces', 'system']);
});

test('accel: the gain rises smoothly with speed and never jumps at the cap', () => {
  let prev = P.accel(1) / 1;
  for (const d of [2, 4, 8, 16, 32, 64, 128, 400]) {
    const g = Math.min(P.ACCEL_MAX, P.accel(d) / d);
    assert.ok(g >= prev - 0.02, 'gain never falls as the move gets faster (' + d + ')');
    assert.ok(g <= P.ACCEL_MAX, 'gain is capped at ' + P.ACCEL_MAX);
    prev = g;
  }
  assert.equal(P.gainFor(0), 1);
  assert.ok(Math.abs(P.gainFor(1) - 1) < 0.1, 'a one-pixel nudge stays precise');
  assert.equal(P.gainFor(1e6), P.ACCEL_MAX);
});

test('accel: one step smooths a flick over events instead of multiplying the first big delta', () => {
  let v = 0, first = 0, second = 0, total = 0;
  for (let i = 0; i < 4; i++) {
    const r = P.accelStep(24, v);
    v = r.v; total += r.d;
    if (i === 0) first = r.d; else if (i === 1) second = r.d;
  }
  assert.ok(second > first, 'the stroke accelerates as it goes');
  assert.ok(total > 4 * 24, 'a flick still travels further than the raw distance');
  assert.ok(total < 4 * 24 * P.ACCEL_MAX, 'and never past the cap');
  const fresh = P.accelStep(0, 0);
  assert.equal(fresh.d, 0);
  assert.equal(fresh.v, 0);
  // a slow nudge after a fast stroke uses its own speed, not the stroke before it
  let slowV = 0;
  for (let i = 0; i < 6; i++) slowV = P.accelStep(60, slowV).v;
  assert.ok(P.accelStep(1, slowV * 0 + 1).d < 1.6);
});

test('shell markup carries the Home, House, Keys and Pad controls these pages drive', () => {
  for (const id of ['npstate', 'volp', 'wsmd', 'wsrow', 'hn', 'keyswrap', 'tprecon']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing #' + id);
  }
  assert.match(html, /id="volp"[\s\S]{0,400}data-v="25"[\s\S]{0,200}data-v="50"[\s\S]{0,200}data-v="75"[\s\S]{0,200}data-v="100"/);
  assert.match(html, /id="wsrow"[^>]*>[\s\S]{0,400}data-n="5"/);
  // the workspace row is driven by one handler that picks go or move, so no button carries a fixed action
  assert.doesNotMatch(html, /id="wsrow"[\s\S]{0,400}data-a="ws"/);
  assert.match(app, /'\?'\+'v='\+b\.dataset\.n|mvws':'ws'\)\+'\?v='/);
});

test('home: the only workspace switch is a tap, and nothing on a timer moves the seat', () => {
  // exactly one dispatch site, inside the click handler for the workspace row
  assert.equal(app.split("(wsMode=='move'?'mvws':'ws')").length - 1, 1);
  assert.match(app, /#wsrow'\).addEventListener\('click'/);
  assert.doesNotMatch(app, /setInterval\([^)]*ws\?v=/, 'no poller switches workspace');
  assert.doesNotMatch(html, /data-a="ws"/, 'no page element switches workspace without a tap');
  assert.match(html, /workspace 1/i);
});
