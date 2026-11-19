const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const start = src.indexOf('// ==== CAMERA UI HELPERS BEGIN');
const end = src.indexOf('// ==== CAMERA UI HELPERS END ====');
const CameraUI = vm.runInNewContext(src.slice(start, end) + '\nCameraUI;', {}, { timeout: 1000 });

test('Cam 3 is upright by default without changing other camera rotations', () => {
  assert.equal(CameraUI.rotation(null, 2), 90);
  for (const i of [0, 1, 3]) assert.equal(CameraUI.rotation(null, i), 0);
  assert.equal(CameraUI.rotation('180', 2), 180);
  assert.equal(CameraUI.rotation('270', 0), 270);
  assert.equal(CameraUI.rotation('invalid', 2), 90);
});

test('quarter-turn video and JPEG viewports retain all edges in landscape and portrait', () => {
  for (const [w, h] of [[923, 411], [411, 923], [243, 130]]) {
    for (const turn of [90, 270]) {
      const box = CameraUI.frame(w, h, turn);
      assert.equal(box.w, h);
      assert.equal(box.h, w);
    }
    const box = CameraUI.frame(w, h, 180);
    assert.equal(box.w, w);
    assert.equal(box.h, h);
  }
});

test('missing or invalid snapshot age never appears as a fresh zero-second cache hit', () => {
  for (const age of [null, '', '-1', 'NaN', 'broken']) assert.equal(CameraUI.cacheAge(age), null);
  assert.equal(CameraUI.cacheAge('0'), 0);
  assert.equal(CameraUI.cacheAge('121'), 121);
});

test('snapshot fallback retries live video soon, backs off, and never waits past five minutes', () => {
  assert.equal(CameraUI.retryDelay(0), 15000);
  assert.equal(CameraUI.retryDelay(1), 30000);
  assert.equal(CameraUI.retryDelay(4), 240000);
  for (const fails of [5, 6, 50, Infinity]) assert.equal(CameraUI.retryDelay(fails), 300000);
  for (const fails of [-3, NaN, undefined]) assert.equal(CameraUI.retryDelay(fails), 15000);
});

test('viewer zoom stays between 1x and 6x and the frame never shows an edge gap', () => {
  const W = 430, H = 932;
  const one = { s: 1, x: 0, y: 0 };
  assert.deepEqual({ ...CameraUI.clampZoom({ s: 0.3, x: 50, y: -20 }, W, H) }, one);
  const big = CameraUI.zoomAt(one, 40, 215, 466, 215, 466, W, H);
  assert.equal(big.s, 6);
  // panned past any edge: clamped so content still covers the viewer
  const z = CameraUI.clampZoom({ s: 3, x: 500, y: -9999 }, W, H);
  assert.deepEqual({ ...z }, { s: 3, x: 0, y: H - 3 * H });
});

test('pinch keeps the content under the fingers in place, double tap toggles 1x and 2.5x', () => {
  const W = 430, H = 932, one = { s: 1, x: 0, y: 0 };
  const z = CameraUI.zoomAt(one, 2, 100, 200, 100, 200, W, H);
  assert.equal(z.s, 2);
  // the point (100,200) on screen still shows content point (100,200)
  assert.equal((100 - z.x) / z.s, 100);
  assert.equal((200 - z.y) / z.s, 200);
  const t = CameraUI.tapZoom(one, 300, 400, W, H);
  assert.equal(t.s, CameraUI.ZTAP);
  assert.equal((300 - t.x) / t.s, 300);
  assert.deepEqual({ ...CameraUI.tapZoom(t, 10, 10, W, H) }, one);
});

test('portrait 16:9 video: zoom never pans into the black bars, rotation swaps the picture box', () => {
  const W = 430, H = 932, box = CameraUI.contentBox(W, H, 1920, 1080, 0);
  assert.deepEqual({ ...box }, { x: 0, y: (H - 430 * 1080 / 1920) / 2, w: 430, h: 430 * 1080 / 1920 });
  // 3x: the picture is 1290 wide (covers W) but only 726 tall (shorter than H), so it stays centered vertically
  const z = CameraUI.clampZoom({ s: 3, x: 999, y: -5000 }, W, H, box);
  assert.equal(z.x, 0);
  assert.equal(z.y + 3 * box.y + 3 * box.h / 2, H / 2);
  // 6x: tall enough to cover H; the top bar edge can never move below the viewer top
  const z6 = CameraUI.clampZoom({ s: 6, x: 0, y: 0 }, W, H, box);
  assert.ok(z6.y + 6 * box.y <= 0 && z6.y + 6 * (box.y + box.h) >= H);
  const turned = CameraUI.contentBox(W, H, 1920, 1080, 90);
  assert.equal(turned.w, W);
  assert.equal(Math.round(turned.h), Math.round(W * 1920 / 1080));
  assert.equal(CameraUI.contentBox(W, H, 0, 0, 0), null);
});

// ---------------- feedback release: same-origin snapshots, give-up delays, hls config, beacons ----------------
test('snapshot frames are same-origin URLs with a changing counter: never blob: or data:', () => {
  const u1 = CameraUI.snapUrl('camera.eufy_cam_1', 1), u2 = CameraUI.snapUrl('camera.eufy_cam_1', 2);
  assert.equal(u1, '/api/cam?e=camera.eufy_cam_1&live=1&_=1');
  assert.notEqual(u1, u2);
  for (const u of [u1, u2, CameraUI.snapUrl('camera.eufy_cam_4', 999), CameraUI.snapUrl('a b&c', 7), CameraUI.snapUrl(null, -5), CameraUI.snapUrl('x', NaN)]) {
    assert.match(u, /^\/api\/cam\?e=[^&\s]*&live=1&_=\d+$/);
    assert.doesNotMatch(u, /blob:|data:|https?:/);
  }
  assert.equal(CameraUI.snapUrl('a b&c', 7), '/api/cam?e=a%20b%26c&live=1&_=7');
  assert.equal(CameraUI.snapUrl('x', 3.9), '/api/cam?e=x&live=1&_=3');
});

test('no blob URL anywhere in the camera snapshot path', () => {
  assert.doesNotMatch(src, /createObjectURL|revokeObjectURL|\.blob\(\)/);
  const cam = src.slice(src.indexOf('async function snapshot('), src.indexOf('function makeCamera('));
  assert.match(cam, /CameraUI\.snapUrl\(camEntity\(s\.i\),\+\+snapSeq\)/);
  assert.doesNotMatch(cam, /blob|data:/);
});

test('HLS gets 15 s on a tile and 20 s in the viewer before snapshot polling takes over (a cold muxer needs 6.4 to 8.6 s), and a stalled video gets 5 s / 6 s', () => {
  assert.equal(CameraUI.giveUpMs(false), 15000);
  assert.equal(CameraUI.giveUpMs(true), 20000);
  assert.equal(CameraUI.giveUpMs(undefined), 15000);
  for (const cold of [6400, 7100, 8600]) assert.ok(CameraUI.giveUpMs(false) > cold + 5000, 'every measured cold first frame lands well inside the tile window');
  assert.equal(CameraUI.stallMs(false), 5000);
  assert.equal(CameraUI.stallMs(true), 6000);
});

test('status words are human: Live, Snapshot with a relative age, Camera offline; never BUFFERING or an engineering state', () => {
  assert.equal(CameraUI.statusText('live'), 'Live');
  assert.equal(CameraUI.statusText('snap', 8), 'Snapshot, 8 s ago');
  assert.equal(CameraUI.statusText('snap', 0.4), 'Snapshot, just now');
  assert.equal(CameraUI.statusText('snap', 125), 'Snapshot, 2 min ago');
  assert.equal(CameraUI.statusText('snap', 7300), 'Snapshot, 2 h ago');
  assert.equal(CameraUI.statusText('snap', -5), 'Snapshot, just now');
  assert.equal(CameraUI.statusText('snap', NaN), 'Snapshot, just now');
  assert.equal(CameraUI.statusText('offline'), 'Camera offline');
  assert.equal(CameraUI.statusText('dark'), 'Dark image');
  assert.equal(CameraUI.statusText('reconnecting'), 'Reconnecting');
  assert.equal(CameraUI.statusText('connecting'), 'Connecting');
  for (const st of ['live', 'snap', 'offline', 'dark', 'reconnecting', 'connecting', 'BUFFERING', '', undefined]) assert.doesNotMatch(CameraUI.statusText(st, 3), /BUFFERING|NO FEED|SNAP\b|CONNECTING/);
});

test('poster first: a snapshot starts at once while HLS connects, and the poster is dropped only once video plays', () => {
  const start = src.slice(src.indexOf('async function startCamera('), src.indexOf('function makeCamera('));
  assert.ok(start.indexOf('snapshot(s,g,true)') > 0 && start.indexOf('snapshot(s,g,true)') < start.indexOf('await loadHls()'));
  const make = src.slice(src.indexOf('function makeCamera('));
  assert.match(make, /video\.addEventListener\('playing',\(\)=>\{[^]*root\.classList\.remove\('poster'\)/);
  assert.doesNotMatch(make.slice(make.indexOf("'loadedmetadata'"), make.indexOf("'error'")), /remove\('poster'\)/);
});

test('every client gets the low-latency HLS config; hls.js is tried first outside the shell, native HLS first inside it (the shell blocks hls.js blob: media)', () => {
  const a = CameraUI.hlsConfig(), b = CameraUI.hlsConfig();
  assert.deepEqual({ ...a }, { lowLatencyMode: true, liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 4, maxBufferLength: 3, backBufferLength: 0 });
  assert.notEqual(a, b, 'each Hls instance gets its own object');
  const start = src.slice(src.indexOf('async function startCamera('), src.indexOf('function makeCamera('));
  assert.match(start, /CameraUI\.pickEngine\(IN_SHELL,can,!s\.hlsBlocked\)/);
  assert.ok(start.indexOf("if(eng=='hlsjs')") < start.indexOf('await loadHls()'), 'the shell never waits for hls.js to load');
  assert.ok(start.indexOf('CameraUI.pickEngine(IN_SHELL,can,!!(window.Hls') < start.indexOf('new Hls('));
});

test('cam-diag body: whitelisted event, camera 0..4, known mode, at most 12 scalar fields, strings cut to 120, 2 KB cap', () => {
  const ok = JSON.parse(CameraUI.diagBody('hls_error', 2, 'hls', { type: 'networkError', fatal: true, code: 404, nested: { a: 1 }, list: [1], nul: null, fn: () => 1, bad_Key: 1, 'a-b': 2, long: 'x'.repeat(500) }));
  assert.deepEqual(Object.keys(ok).sort(), ['cam', 'd', 'e', 'mode']);
  assert.deepEqual(Object.keys(ok.d).sort(), ['code', 'fatal', 'long', 'type']);
  assert.equal(ok.d.long.length, 120);
  assert.equal(ok.d.fatal, true);
  assert.equal(ok.cam, 2);
  const many = JSON.parse(CameraUI.diagBody('boot', 0, 'boot', Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['k' + i, i]))));
  assert.equal(Object.keys(many.d).length, 12);
  assert.equal(CameraUI.diagBody('x', 0, 'boot', { a: Infinity, b: NaN }), JSON.stringify({ e: 'x', cam: 0, mode: 'boot', d: {} }));
  for (const e of ['', 'Bad', 'has space', 'a'.repeat(33), 'x/y', null, 5]) assert.equal(CameraUI.diagBody(e, 1, 'hls', {}), null, String(e));
  for (const cam of [-1, 5, 1.5, 'x', NaN]) assert.equal(CameraUI.diagBody('playing', cam, 'hls', {}), null, String(cam));
  for (const mode of ['', 'blob', 'HLS', undefined]) assert.equal(CameraUI.diagBody('playing', 1, mode, {}), null, String(mode));
  for (const mode of ['hls', 'snap', 'native', 'boot']) assert.ok(CameraUI.diagBody('playing', 1, mode, null));
  assert.ok(CameraUI.diagBody('e.v_1', 4, 'snap', undefined).length < 2000);
  const heavy = Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['key_' + 'a'.repeat(18) + i, '"'.repeat(120)]));
  assert.equal(CameraUI.diagBody('x', 1, 'hls', heavy), null, 'a body over 2 KB is dropped, not sent');
});

test('beacons: at most 40 per page load, at most 5 per event and camera, and the sender never throws or waits', () => {
  const ok = CameraUI.diagBudget(40, 5);
  let sent = 0;
  for (let i = 0; i < 200; i++) if (ok('e' + (i % 20) + ':' + (i % 4))) sent++;
  assert.equal(sent, 40);
  assert.equal(ok('anything'), false);
  const per = CameraUI.diagBudget(40, 5);
  const got = Array.from({ length: 12 }, () => per('hls_error:1')).filter(Boolean).length;
  assert.equal(got, 5);
  assert.equal(per('hls_error:2'), true, 'another camera still has its own allowance');
  const send = src.slice(src.indexOf('function camDiag('), src.indexOf('function camDiagFirst('));
  assert.match(send, /try\{/);
  assert.match(send, /keepalive:true/);
  assert.match(send, /\.catch\(\(\)=>\{\}\)/);
  assert.doesNotMatch(send, /await /);
  assert.match(send, /CameraUI\.diagBody\(e,cam,mode,d\)/);
  assert.match(src, /CameraUI\.diagBudget\(40,5\)/);
});

test('beacon events: boot once with the capability fields, snap_ok and snap_fail first per tile, fallback with a reason', () => {
  const boot = src.slice(src.indexOf('function camBoot('), src.indexOf('function camHlsErr('));
  assert.match(boot, /if\(bootSent\)return;bootSent=true/);
  for (const f of ['hls:', 'supported:', 'mms:', 'ms:', 'native:', 'inline:', 'hlsjs:']) assert.ok(boot.includes(f), f);
  assert.match(boot, /ManagedMediaSource/);
  assert.match(boot, /canPlayType\('application\/vnd\.apple\.mpegurl'\)/);
  assert.match(boot, /video\.playsInline/);
  for (const e of ['hls_error', 'video_error', 'playing', 'stalled', 'fallback', 'snap_ok', 'snap_fail', 'engine']) assert.match(src, new RegExp("camDiag(First)?\\('" + e + "'"), e);
  assert.match(src, /function camDiagFirst\(e,s,d\)\{const k=e\+':'\+s\.i\+':'\+\(s===viewer\?'v':'t'\);if\(DIAG_FIRST\.has\(k\)\)return;DIAG_FIRST\.add\(k\)/);
  assert.match(src, /camDiag\('fallback',s\.i\+1,s\.native\?'native':'hls',\{reason:reason\|\|'unknown'/);
  // the viewer is one object reused for four cameras: beacons use the live camera index, not the one it was built with
  const make = src.slice(src.indexOf('function makeCamera('));
  assert.doesNotMatch(make, /camDiag\('[a-z_]+',i\+1/);
});

test('every boot beacon field survives the whitelist (a camelCase key was silently dropped once)', () => {
  const boot = src.slice(src.indexOf('function camBoot('), src.indexOf('function camHlsErr('));
  const open = "camDiag('boot',0,'boot',{";
  const obj = boot.slice(boot.indexOf(open) + open.length, boot.lastIndexOf('})}'));
  const keys = [...obj.matchAll(/(?:^|[,{\s])([A-Za-z_][A-Za-z0-9_]*):/g)].map((m) => m[1]);
  assert.ok(keys.length >= 7, keys.join(','));
  const kept = Object.keys(JSON.parse(CameraUI.diagBody('boot', 0, 'boot', Object.fromEntries(keys.map((k) => [k, 1])))).d);
  assert.deepEqual(kept.sort(), [...new Set(keys)].sort());
});

// ---------------- behaviour: the camera state machine against fake timers, a fake Image and a fake <video> ----------------
// Runs the real camera block of app.js (`const CAMS=` up to `function openViewer(`). Time is a manual clock, so 6 s and 10 s are exact.
function harness() {
  let now = 1000, seq = 0;
  const timers = new Map(), images = [], cfg = { latency: 120, fail: false }, dom = {}, ctx = { pageName: 'house' };
  const T = { setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + (ms || 0) }); return id }, clearTimeout: id => { timers.delete(id) }, setInterval: () => 0 };
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)) };
  const advance = async ms => {
    const end = now + ms;
    for (;;) {
      let best = null;
      for (const [id, t] of timers) if (t.at <= end && (!best || t.at < best.t.at)) best = { id, t };
      if (!best) break;
      now = Math.max(now, best.t.at); timers.delete(best.id); best.t.fn(); await flush();
    }
    now = end; await flush();
  };
  function el(tag) {
    const set = new Set();
    return {
      tag, dataset: {}, style: { setProperty() {} }, children: [], _kids: {}, _attrs: {}, handlers: {}, textContent: '', clientWidth: 320, clientHeight: 180,
      classList: { add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c), toggle: (c, f) => { const on = f === undefined ? !set.has(c) : !!f; if (on) set.add(c); else set.delete(c); return on } },
      querySelector(sel) { return this._kids[sel] || (this._kids[sel] = el(sel)) },
      addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn) },
      fire(t) { (this.handlers[t] || []).forEach(f => f()) },
      setAttribute(k, v) { this._attrs[k] = v }, getAttribute(k) { return this._attrs[k] },
      removeAttribute(k) { delete this._attrs[k]; if (k === 'src') this.src = undefined },
      pause() {}, load() {}, play() { return Promise.resolve() }, canPlayType() { return '' }, focus() {},
    };
  }
  const $ = sel => dom[sel] || (dom[sel] = el(sel));
  Object.defineProperty($('#cams'), 'innerHTML', { set() { this.children = [0, 1, 2, 3].map(() => el('button')) } });
  class FakeImage {
    constructor() { images.push(this); this.naturalWidth = 640; this.naturalHeight = 360 }
    set src(v) { this._src = v; if (v) T.setTimeout(() => (cfg.fail ? this.onerror && this.onerror() : this.onload && this.onload()), cfg.latency) }
    get src() { return this._src }
  }
  const box = {
    $, ...T, Image: FakeImage, Date: { now: () => now }, mode: 'awake', pname: () => ctx.pageName,
    // House is Home's first sub since 2026-11-01: app.js asks onHouse(), not the page name
    onHouse: () => ctx.pageName === 'home' || ctx.pageName === 'house',
    document: { hidden: false, head: { appendChild() {} }, createElement: t => { if (t === 'script') return el('script'); throw new Error('no canvas') } },
    window: {}, localStorage: { getItem: () => null, setItem() {} }, ResizeObserver: class { observe() {} },
    fetch: () => Promise.resolve({ ok: false }), AbortSignal: { timeout: () => ({}) }, resetZoom() {}, IN_SHELL: false,
  };
  const code = src.slice(src.indexOf('const CAMS='), src.indexOf('function openViewer(')) +
    '\n({ensureCameras,startCamera,stopCamera,syncCameras,get tiles(){return tiles},get viewer(){return viewer}})';
  const api = vm.runInNewContext(code, box, { timeout: 2000 });
  return { api, advance, images, cfg, ctx, dom };
}
// "never black": a tile always shows a frame, a live video, or a words-only state (never an empty box)
const shows = s => s.root.classList.contains('live') || ((s.root.classList.contains('poster') || s.root.classList.contains('snap')) && !!s.image.src) ||
  s.root.classList.contains('connecting') || s.root.classList.contains('nofeed');
const status = s => s.root.querySelector('.cam-status').textContent;

test('tile: a same-origin poster appears at once, stays until video plays, and snapshot polling starts at exactly 15 s', async () => {
  const h = harness();
  h.api.syncCameras();
  const [t0] = h.api.tiles;
  assert.ok(shows(t0), 'black before the first frame');
  assert.equal(status(t0), 'Connecting');
  assert.equal(t0.root.querySelector('em').textContent, 'Connecting');
  await h.advance(150);
  assert.ok(t0.root.classList.contains('poster'));
  assert.match(t0.image.src, /^\/api\/cam\?e=camera\.eufy_cam_1&live=1&_=\d+$/);
  assert.equal(status(t0), 'Snapshot, just now');
  await h.advance(14700);
  assert.equal(t0.mode, 'hls');
  assert.ok(t0.root.classList.contains('poster') && !t0.root.classList.contains('snap'));
  assert.ok(shows(t0));
  await h.advance(160);
  assert.equal(t0.mode, 'snap', 'falls back at 15 s');
  assert.ok(t0.root.classList.contains('snap') && !t0.root.classList.contains('poster'));
  assert.match(status(t0), /^Snapshot, \d+ s ago$/);
  assert.ok(shows(t0));
  const before = h.images.length;
  await h.advance(5000);
  assert.ok(h.images.length >= before + 2, 'snapshots keep polling');
  assert.ok(h.images.every(i => !/^(blob|data):/.test(i.src || '')));
});

test('viewer: falls back at 20 s, not before', async () => {
  const h = harness();
  h.api.ensureCameras();
  const v = h.api.viewer;
  h.api.startCamera(v);
  await h.advance(19800);
  assert.equal(v.mode, 'hls');
  assert.ok(shows(v));
  await h.advance(300);
  assert.equal(v.mode, 'snap');
  assert.ok(shows(v));
});

test('playing drops the poster, says Live and cancels the fallback; a stall says Reconnecting for 5 s, then drops to snapshots', async () => {
  const h = harness();
  h.api.syncCameras();
  const t = h.api.tiles[1];
  await h.advance(300);
  assert.ok(t.root.classList.contains('poster'));
  t.video.fire('playing');
  assert.ok(!t.root.classList.contains('poster') && t.root.classList.contains('live'));
  assert.equal(status(t), 'Live');
  await h.advance(30000);
  assert.equal(t.mode, 'hls');
  assert.equal(status(t), 'Live');
  t.video.fire('waiting');
  assert.equal(status(t), 'Reconnecting');
  await h.advance(4900);
  t.video.fire('playing');
  assert.equal(status(t), 'Live');
  await h.advance(20000);
  assert.equal(t.mode, 'hls', 'a recovered stall never falls back');
  t.video.fire('waiting');
  await h.advance(5100);
  assert.equal(t.mode, 'snap');
  assert.doesNotMatch(status(t), /Reconnecting|BUFFERING/);
  assert.ok(shows(t));
});

test('a camera that cannot be reached says "Camera offline" (never a black box) and recovers when frames return', async () => {
  const h = harness();
  h.cfg.fail = true;
  h.api.syncCameras();
  const t = h.api.tiles[2];
  await h.advance(15200);
  await h.advance(3000);
  assert.equal(status(t), 'Camera offline');
  assert.equal(t.root.querySelector('em').textContent, 'Camera offline');
  assert.ok(shows(t));
  h.cfg.fail = false;
  await h.advance(3000);
  assert.match(status(t), /^Snapshot, /);
  assert.ok(!t.root.classList.contains('nofeed'));
});

test('a tile that stops keeps its last frame and comes back with an honest age instead of black', async () => {
  const h = harness();
  h.api.syncCameras();
  const t = h.api.tiles[0];
  await h.advance(300);
  const frame = t.image.src;
  assert.ok(frame);
  h.api.stopCamera(t);
  await h.advance(61000);
  h.api.startCamera(t);
  assert.ok(t.root.classList.contains('poster'));
  assert.equal(t.image.src, frame);
  assert.equal(status(t), 'Snapshot, 1 min ago');
});
