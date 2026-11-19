// node --test tests/deck20261029_webshell.test.js
// Lane L1 WebShell (2026-10-29): layout, scrolling, keys UI, Home and traffic tiles.
// Pure helper blocks run in a vm; the markup and stylesheet rules are checked as source, the way the other UI tests do it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('static/app.js'), html = require('./shell_legacy_css.js')(), pad = read('static/pad.js');
const manifest = JSON.parse(read('static/manifest.webmanifest')), login = read('static/login.html');
const keysJson = JSON.parse(read('keys.json'));

const block = (src, from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to);
  assert.ok(a > 0 && b > a, 'block markers moved: ' + from);
  // the marker line carries a note after the words: start at the line after it
  return src.slice(src.indexOf('\n', a) + 1, b);
};
const runBlock = (from, to, extra, returns) => {
  const ctx = Object.assign({}, extra);
  vm.runInNewContext(block(app, from, to) + '\n;' + returns, ctx, { timeout: 2000 });
  return ctx.OUT;
};

const KEYROWS = runBlock('// ==== KEY ROWS HELPERS BEGIN', '// ==== KEY ROWS HELPERS END ====', {}, 'OUT=KEYROWS');
const TodayUI = runBlock('// ==== TODAY UI HELPERS BEGIN', '// ==== TODAY UI HELPERS END ====', {}, 'OUT=TodayUI');
const HouseUI = runBlock('// ==== HOUSE UI HELPERS BEGIN', '// ==== HOUSE UI HELPERS END ====', {}, 'OUT=HouseUI');

const NOW = 1_790_712_000_000; // 2026-10-29, seconds below are this / 1000
const tSec = (ms) => Math.round((NOW - ms) / 1000);

// ---------------- W19 polling gate and the L1 shell wiring ----------------
test('W19: the host readouts poll only on House and Pad; a page asks for its own feeds when it is shown', () => {
  // 2026-11-01: Home holds House and the old Fleet subs, so the gate is the House sub, not the Home page
  assert.match(app, /const hostPage=\(\)=>pname\(\)==='pad'\|\|onHouse\(\);/);
  assert.match(app, /function onHouse\(\)\{return pname\(\)==='home'&&leafOf\('home'\)==='home'\}/);
  assert.match(app, /setInterval\(gated\(\(\)=>hostPage\(\)\?refresh\(\):null\),3000\)/, 'media, volume and workspaces poll on House and Pad only');
  assert.match(app, /setInterval\(gated\(\(\)=>onHouse\(\)\?stats\(\):null\),5000\)/, 'stats poll on House only');
  assert.match(app, /setHost\(host\);clock\(\);wx\(\);wake\(\);loadKeys\(\);/, 'boot no longer drags Today\'s feeds onto every page');
  assert.doesNotMatch(app, /setHost\(host\);clock\(\);wx\(\);wake\(\);loadKeys\(\);if\(!GUEST\)/);
  // a lost connection still shows on every page: any fetch that never reaches the deck server marks the pill offline
  assert.match(app, /const netState=up=>/);
  assert.match(app, /catch\(e\)\{netState\(false\);throw e\}/);
  assert.match(app, /netState\(true\);if\(!r\.ok\)throw new Error\(r\.status\)/);
});



// ---------------- W6 jump strip and the Top button ----------------






test('Pad: Reconnect on the link line is a real button that starts a fresh attempt and never a gesture', () => {
  assert.match(pad, /\$\('#tprecon'\)\.onclick = \(\) => \{ tick\('light'\); backoff = 800; fails = 0; connect\(\) \}/);
  assert.match(pad, /\$\('#tprecon'\)\.addEventListener\('pointerdown', e => e\.stopPropagation\(\)\)/);
  assert.match(html, /<button type="button" id="tprecon" class="b" aria-label="Reconnect the input link">Reconnect<\/button>/);
});

// ---------------- W8 Keys page (v3: css/pad.css sizes the key grid; tests/pad_keys.test.js has the confirm rule) ----------------
test('W8: every key has an aria-label and a title, and a confirm key says what the second press does', () => {
  assert.match(app, /b\.dataset\.say=KEYROWS\.say\(k\);b\.setAttribute\('aria-label',b\.dataset\.say\);b\.title=String\(k\.label\|\|''\)/);
  assert.match(app, /b\.setAttribute\('aria-label',again\+' to confirm: '\+k\.label\)/, 'a confirm key says what the second press does');
});

test('W8 and C4: rows come from the served group, named from the served groups list, so the house keys get their own rows', () => {
  const served = [
    { label: 'Terminal', action: 'launch', arg: 'terminal', group: 'apps' },
    { label: 'Living TV power', action: 'ha-script', arg: 'living_tv_power', group: 'tv', confirm: true },
    { label: 'PS5 rest', action: 'ha-script', arg: 'living_ps5_standby', group: 'games', confirm: true },
    { label: 'Rain delay', action: 'ha-script', arg: 'rain_delay_2_days', group: 'sprinklers' },
    { label: 'Status to my iPhone', action: 'ha-script', arg: 'house_status_to_phone', group: 'house' },
  ];
  const groups = [{ id: 'apps', name: 'Apps' }, { id: 'tv', name: 'Television' }, { id: 'games', name: 'Games' }, { id: 'sprinklers', name: 'Sprinklers' }, { id: 'house', name: 'House' }];
  const rows = KEYROWS.rows(served, groups);
  assert.deepEqual(Array.from(rows, (r) => r.id), ['apps', 'tv', 'games', 'sprinklers', 'house']);
  assert.deepEqual(Array.from(rows, (r) => r.name), ['Apps', 'Television', 'Games', 'Sprinklers', 'House']);
  assert.deepEqual(Array.from(rows).flatMap((r) => Array.from(r.keys, (x) => x.i)), [0, 1, 2, 3, 4], 'each key keeps its served index');
  // a served group with no name falls back to the LANE's own list, then the id
  assert.equal(KEYROWS.rows([{ action: 'x', group: 'sprinklers' }])[0].name, 'Sprinklers');
  assert.equal(KEYROWS.rows([{ action: 'x', group: 'garden' }])[0].name, 'garden');
  // no served group: the action still decides, exactly as before
  assert.equal(KEYROWS.group({ action: 'ws', arg: '3' }), 'workspaces');
  assert.equal(KEYROWS.group({ action: 'lock' }), 'system');
  assert.equal(KEYROWS.group({ action: 'ha-script', arg: 'x' }), 'apps');
  // a group id that is not a plain word is ignored rather than trusted
  assert.equal(KEYROWS.group({ action: 'lock', group: '<b>x</b>' }), 'system');
  // 43 keys (26 today plus L3's 17 house keys) still fit: eight rows, every key reachable
  const many = keysJson.keys.concat(Array.from({ length: 17 }, () => ({ label: 'House', action: 'ha-script', arg: 'x', group: 'house' })));
  assert.ok(KEYROWS.rows(many).reduce((n, r) => n + r.keys.length, 0) === many.length);
});

test('W8: the Keys page labels its rows as headings and no provenance note sits under them', () => {
  assert.match(app, /row\.innerHTML='<h2 class="klab">'\+esc\(grp\.name\)\+'<\/h2><div class="kgrid cards" role="group" aria-label="'\+esc\(grp\.name\)\+'"><\/div>'/);
  assert.doesNotMatch(html, /Dead keys removed/);
  // the provenance note under the keys is gone (design v3: sources live in the Data sheet)
  assert.doesNotMatch(html, /id="keynote"/);
});

// ---------------- W9 small targets ----------------
test('W9: volume, workspace mode, decisions, Commerce, Pad and the region chips are all 44 px', () => {
  // Home volume and workspace targets: tests/home_v3_layout.test.js (44 px on every class); the rest of the deck as before
  assert.match(html, /a\.b\.open\{[^}]*min-height:var\(--touch\)/);
  assert.match(html, /button\.b\.cpy\{flex:none;align-self:flex-start;min-height:var\(--touch\)/);
  assert.match(html, /button\.b\.cmt,a\.b\.cmt\{min-height:72px/, 'Commerce launch tiles');
  assert.match(read('static/ui.css'), /\.chips button\.b,\.chips>button,\.fchip\{flex:none;min-height:var\(--ctl-h\)/, 'every chip row');
});

// ---------------- W14 and I4 the top bar ----------------

test('I4: the reveal margin is wider than the edge fade, so the active tab never sits under a fade', () => {
  const m = /const TAB_FADE=(\d+),TAB_M=TAB_FADE\+(\d+)/.exec(app);
  assert.ok(m, 'the fade width is a named constant');
  const fade = +m[1], margin = fade + +m[2];
  assert.ok(margin > fade + 8, 'the margin clears the 32 px fade with room to spare');
  assert.ok(margin > 32);
  // the full margin whenever the strip is wide enough (the bottom bar always is); a narrow sub-tab row centres the active one instead
  assert.match(app, /M=Math\.min\(TAB_M,Math\.max\(0,\(sr\.width-br\.width\)\/2\)\);let d=0;/);
});

// ---------------- W24 one name per machine ----------------
test('W24: pc-desktop reads "PC" in the top bar and in the Pad switch', () => {
  assert.match(html, /<button type="button" data-h="pc-desktop" class="on" aria-label="Control PC">PC<\/button>/);
  assert.match(html, /<button type="button" data-t="pc-desktop">PC<\/button>/);
  assert.doesNotMatch(html, />pc-desktop</, 'no control shows the server id');
  assert.match(app, /const HOSTNAME=\{'pc-desktop':'PC',Dell:'Dell'\},hostName=h=>HOSTNAME\[h\]\|\|h/);
  assert.match(app, /\$\('#swapl'\)\.textContent=hostName\(other\(\)\)/);
  // the System card is gone: the readings strip names the host it reads in its accessible name
  assert.match(app, /r\.setAttribute\('aria-label',hostName\(host\)\+' readings'\)/);
  assert.match(app, /errText=errMsg\?hostName\(host\)\+': '\+errMsg/);
  // the Pad has always labelled it PC; the server id stays the wire value
  assert.match(pad, /const LABEL = \{ l: 'Left', m: 'Middle', r: 'Right', mini: 'Mini', 'pc-desktop': 'PC', Dell: 'Dell' \}/);
});

// ---------------- W16 the sidewalk camera fills its tile ----------------
test('W16: camera 3 turns 90 degrees by default, and a turned tile fills (the viewer still shows the whole frame)', () => {
  const cam = app.slice(app.indexOf('const rotation=(raw,i)=>'), app.indexOf('// ==== CAMERA UI HELPERS END'));
  assert.match(cam, /if\(raw==null\)return i==2\?90:0/, 'cam 3 defaults to a 90 degree turn');
  assert.match(app, /s\.media\.style\.setProperty\('--rotation',r\+'deg'\);if\(s!==viewer\)s\.root\.classList\.toggle\('rot',r%180!==0\)/);
  assert.match(html, /\.cam\.rot \.cam-media video,\.cam\.rot \.cam-media img\{object-fit:cover\}/);
  // the viewer keeps contain: a zoomed picture is never cropped to its frame
  assert.match(html, /\.cam-media video,\.cam-media img,#vmedia video,#vmedia img\{[^}]*object-fit:contain/);
});

// ---------------- I20 the camera key after a restart ----------------
test('I20: a 401 or a media error drops the remembered camera key, and the next start asks for a new one', async () => {
  const KEY = runBlock('// ==== CAM KEY BEGIN', '// ==== CAM KEY END ====', {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ k: 'abcdefgh1234' }) }),
    AbortSignal: { timeout: () => undefined },
  }, 'OUT={camKey,camKeyReset}');
  assert.equal(await KEY.camKey(), 'abcdefgh1234');
  assert.equal(await KEY.camKey(), 'abcdefgh1234');
  // justcss: one fetch is cached
  let calls = 0;
  const ctx = {
    fetch: async () => { calls++; return { ok: true, status: 200, json: async () => ({ k: 'zyxwvuts9876' }) } },
    AbortSignal: { timeout: () => undefined },
  };
  vm.runInNewContext(block(app, '// ==== CAM KEY BEGIN', '// ==== CAM KEY END ====') + '\n;OUT={camKey,camKeyReset}', ctx, { timeout: 1000 });
  assert.equal(await ctx.OUT.camKey(), 'zyxwvuts9876');
  assert.equal(await ctx.OUT.camKey(), 'zyxwvuts9876');
  assert.equal(calls, 1, 'the key is fetched once per page load');
  ctx.OUT.camKeyReset();
  assert.equal(await ctx.OUT.camKey(), 'zyxwvuts9876');
  assert.equal(calls, 2, 'after a reset the next start fetches a fresh key');
  // a key that does not look like a key is never kept
  const bad = { fetch: async () => ({ ok: true, status: 200, json: async () => ({ k: 'short' }) }), AbortSignal: { timeout: () => undefined } };
  vm.runInNewContext(block(app, '// ==== CAM KEY BEGIN', '// ==== CAM KEY END ====') + '\n;OUT=camKey', bad, { timeout: 1000 });
  assert.equal(await bad.OUT(), '');
  // the two places a stale key shows up
  assert.match(app, /const r=await fetch\(camPath\(s\.i\),\{cache:'no-store',signal:AbortSignal\.timeout\(5000\)\}\);ok=r\.ok;if\(r\.status===401\)camKeyReset\(\)/);
  assert.match(app, /if\(s\.native\)camKeyReset\(\);/, 'a native player error drops the key');
});

// ---------------- W20, W21, W22 copy and head ----------------
test('W20: nothing playing reads "Idle", never a dash', () => {
  assert.match(html, /<span id="npstate" class="pill">Idle<\/span>/);
  assert.match(app, /const ns=\$\('#npstate'\),w=m\.error\?'Unreachable':!playing\?'Idle':m\.status&&m\.status!='Playing'\?'Paused':'Playing'/);
  assert.match(app, /ns\.classList\.toggle\('on',w==='Playing'\)/);
  const css = html.slice(html.indexOf('#npstate{'), html.indexOf('#npstate.on{'));
  assert.doesNotMatch(css, /text-transform:uppercase/, 'the pill is not an eyebrow');
});

test('W21, W22: no "Dead keys" note, lang="en" on both documents, and the manifest takes any orientation', () => {
  assert.doesNotMatch(html, /Dead keys removed/);
  assert.match(html, /^<!doctype html><html lang="en"><head>/);
  assert.match(login, /^<!doctype html><html lang="en"><head>/);
  assert.equal(manifest.orientation, 'any');
  assert.equal(manifest.display, 'fullscreen', 'the deck still opens full screen');
});

// ---------------- W4 the House now headline ----------------
const ent = (state, unit, updated) => ({ state, unit: unit || '', name: '', updated: updated == null ? null : updated });
const cams = (...ready) => ({ cams: ready.map((r, i) => ({ name: 'eufy_cam' + (i + 1), ready: r })) });
const ts = (own, online) => ({ counts: { own_devices: own, own_online: online }, t: tSec(120000) });

test('W4: House now reads internet, router, cameras, tailnet, the car and you, each from its own source', () => {
  const ha = { entities: { 'binary_sensor.internet_reachable': ent('on', '', tSec(60000)), 'binary_sensor.router_reachable': ent('on', '', tSec(30000)), 'person.mesh': ent('not_home', '', tSec(240000)) } };
  const h = HouseUI.headline(ha, { battery: 63, locked: true, charging: 'Not charging', seen: tSec(3600000) / 1 }, cams(true, true, true, true), NOW, ts(12, 11));
  assert.equal(h.mark, 'warn', 'one device offline is a look, not a calm house');
  assert.equal(h.word, 'Check the house');
  assert.match(h.line, /^Internet up · Router up · 4 of 4 cameras live · Tailnet 11 of 12 online · Car locked · Away$/);
  assert.match(h.src, /Home Assistant just now/);
  assert.match(h.src, /MediaMTX/);
  assert.match(h.src, /tailnet 2 min ago/);
  assert.match(h.src, /car seen 60 min ago/, 'an hour is named in minutes until the feed is a day old');
});

test('W4: a missing input says "not reported", and nothing answering is the honest empty state', () => {
  const h = HouseUI.headline({ error: 'ha unreachable' }, null, { error: 'x' }, NOW, null);
  assert.equal(h.mark, 'bad');
  assert.equal(h.word, 'House not reporting');
  assert.match(h.line, /Home Assistant, the cameras, the tailnet and the car did not answer/);
  assert.equal(h.src, '');
  // one input missing: the line names it instead of guessing
  const part = HouseUI.headline({ entities: { 'binary_sensor.internet_reachable': ent('off') } }, { locked: false, seen: tSec(0) }, cams(true, false), NOW, ts(3, 3));
  assert.equal(part.mark, 'bad');
  assert.match(part.line, /Internet down/);
  assert.match(part.line, /Router not reported/);
  assert.match(part.line, /Tailnet 3 of 3 online/);
  assert.match(part.line, /Car unlocked/);
  assert.match(part.line, /Presence not reported/);
  assert.match(part.line, /1 of 2 cameras live/);
});

test('W4: a cached car says so, and the house facts ride after the network facts', () => {
  const ha = { entities: {
    'binary_sensor.internet_reachable': ent('on'), 'binary_sensor.router_reachable': ent('on'), 'person.mesh': ent('home'),
    'lock.front_door': ent('locked'), 'binary_sensor.garage_door': ent('off'),
  } };
  const h = HouseUI.headline(ha, { locked: true, stale: true, seen: tSec(6 * 3600000) }, cams(true, true, true, true), NOW, ts(4, 4));
  assert.match(h.line, /Car locked \(cached\)/);
  assert.match(h.line, / · Home · /, 'presence reads as a word, in its place in the line');
  assert.match(h.line, /Locks all locked/);
  assert.match(h.line, /Doors all closed/);
  assert.equal(h.mark, 'ok');
});

test('W4: the Home page paints it into #hn with a mark and a word, and the placeholder is only until the first answer', () => {
  assert.match(app, /paintHouseNow\(HouseUI\.headline\(val\(hr\),val\(cr\),val\(cm\),Date\.now\(\),val\(tr\)\)\)/);
  assert.match(app, /el\.dataset\.mark=h\.mark;el\.title=h\.title\|\|''/);
  assert.match(app, /const \[hr,cr,cm,tr\]=await Promise\.allSettled\(\[jget\('\/api\/ha'\),car\(\),jget\('\/api\/cams'\),jget\('\/api\/tailscale'\)\]\)/);
  // the look of #hn (a wash with words, never a red slab) is v3 CSS: tests/home_v3_layout.test.js
});

// ---------------- W13: the traffic card left Today in design v3 (2026-11-14); Search clicks per site live in the Data sheet (tests/today_page.test.js) ----------------

// ---------------- the lane's own shell contract ----------------
test('the shell keeps the ids the other pages hang their cards on', () => {
  for (const id of ['stalls', 'hn', 'keys', 'tprecon']) {
    assert.ok(html.includes('id="' + id + '"') || app.includes('id="' + id + '"') || read('static/deck.js').includes("'" + id + "'"), id);
  }
});
