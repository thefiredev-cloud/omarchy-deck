// Which player a camera tile starts, and what it does when the element refuses the stream.
// Field report 2026-10-06 (owner, TestFlight build 9): every tile black and CONNECTING. The iPhone shell blocks blob: URLs with its default-deny content rule
// list, hls.js plays through a blob: MediaSource, so inside the shell it never attached; native HLS is a plain same-origin URL and is allowed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const camStart = src.indexOf("const CAMS=[1,2,3,4]");
const camEnd = src.indexOf('function syncCameras');
assert.ok(camStart > 0 && camEnd > camStart, 'camera block markers moved');
const block = src.slice(camStart, camEnd);

// A stand-in for any DOM node: every property is a function returning another stand-in, every assignment is kept.
function fakeNode() {
  const store = {};
  const fn = function () { return fakeNode(); };
  return new Proxy(fn, {
    get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : k in store ? store[k] : (store[k] = fakeNode())),
    set: (_, k, v) => { store[k] = v; return true; },
    apply: () => fakeNode(),
  });
}

function fakeVideo({ native }) {
  const listeners = {};
  return {
    src: '', calls: [], listeners,
    canPlayType: (t) => (native && t === 'application/vnd.apple.mpegurl' ? 'maybe' : ''),
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    play() { this.calls.push('play'); return Promise.resolve(); },
    pause() { this.calls.push('pause'); },
    removeAttribute(a) { this.calls.push('remove:' + a); if (a === 'src') this.src = ''; },
    load() { this.calls.push('load'); },
    emit(ev, extra) { Object.assign(this, extra || {}); (listeners[ev] || []).forEach((f) => f()); },
    playsInline: true, classList: fakeNode().classList,
  };
}

function env({ shell, native, hls }) {
  const log = { hlsCreated: 0, hlsDestroyed: 0, fetched: [], beacons: [] };
  class FakeHls {
    static isSupported() { return hls; }
    static get Events() { return { ERROR: 'e' }; }
    constructor() { log.hlsCreated++; this.handlers = {}; }
    on() {} attachMedia() {} loadSource() {} destroy() { log.hlsDestroyed++; }
  }
  const ctx = {
    IN_SHELL: shell, $: () => fakeNode(), localStorage: { getItem: () => null }, document: fakeNode(),
    Image: class { set src(_) {} }, ResizeObserver: class { observe() {} },
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {}, AbortSignal,
    fetch: (u, o) => {
      if (String(u) === '/api/cam-diag') { log.beacons.push(JSON.parse(o.body)); return Promise.resolve({ ok: true }); }
      log.fetched.push(String(u));
      return Promise.resolve({ ok: true, json: () => ({ k: 'ck0123456789abcdef' }) });
    },
  };
  if (hls) ctx.Hls = FakeHls;
  ctx.window = ctx;
  vm.createContext(ctx);
  const api = vm.runInContext(block + '\n({startCamera,makeCamera,CameraUI,camDiag})', ctx, { timeout: 2000 });
  const video = fakeVideo({ native });
  const s = api.makeCamera(0, fakeNode(), fakeNode(), video, fakeNode());
  s.hls = null;
  return { api, s, video, log, ctx };
}
const tick = () => new Promise((r) => setImmediate(r));

test('pickEngine: the shell goes native when HLS plays natively, everything else keeps hls.js first', () => {
  const { api } = env({ shell: true, native: true, hls: true });
  const P = api.CameraUI.pickEngine;
  assert.equal(P(true, true, true), 'native');      // iPhone shell: hls.js is present but its blob: MediaSource is blocked
  assert.equal(P(true, true, false), 'native');
  assert.equal(P(true, false, true), 'hlsjs');      // shell without native HLS: nothing better to try
  assert.equal(P(false, true, true), 'hlsjs');      // Safari, Pixel Chromium: hls.js stays first
  assert.equal(P(false, true, false), 'native');    // no MSE at all
  assert.equal(P(false, false, false), 'snap');
  assert.equal(P(true, false, false), 'snap');
});

test('shell with native HLS: the video gets the playlist URL and hls.js is never created', async () => {
  const e = env({ shell: true, native: true, hls: true });
  await e.api.startCamera(e.s);
  await tick();
  assert.equal(e.log.hlsCreated, 0);
  assert.equal(e.video.src, '/cam/eufy_cam1/index.m3u8?k=ck0123456789abcdef');
  assert.ok(e.video.calls.includes('play'));
  assert.deepEqual(e.log.fetched.filter((u) => u.startsWith('/api/camkey')), ['/api/camkey']);
  const engine = e.log.beacons.find((b) => b.e === 'engine');
  assert.ok(engine && engine.mode === 'native' && engine.d.shell === true, JSON.stringify(e.log.beacons));
  const boot = e.log.beacons.find((b) => b.e === 'boot');
  assert.ok(boot && boot.d.engine === 'native' && boot.d.shell === true && boot.d.native === 'yes');
});

test('shell: the master playlist still loads when the camera key is unavailable', async () => {
  const e = env({ shell: true, native: true, hls: true });
  e.ctx.fetch = (u) => (String(u).startsWith('/api/camkey') ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: true }));
  await e.api.startCamera(e.s);
  await tick();
  assert.equal(e.video.src, '/cam/eufy_cam1/index.m3u8');
});

test('outside the shell hls.js starts first and the element never gets a native src', async () => {
  const e = env({ shell: false, native: true, hls: true });
  await e.api.startCamera(e.s);
  await tick();
  assert.equal(e.log.hlsCreated, 1);
  assert.equal(e.video.src, '');
  assert.equal(e.log.fetched.length, 0, 'no camera key fetch for hls.js');
});

test('hls.js whose MediaSource blob was refused (element error 4, nothing playing) switches once to native HLS', async () => {
  const e = env({ shell: false, native: true, hls: true });
  await e.api.startCamera(e.s);
  await tick();
  assert.equal(e.log.hlsCreated, 1);
  e.video.emit('error', { error: { code: 4 } });
  await tick();
  assert.equal(e.log.hlsDestroyed, 1);
  assert.equal(e.video.src, '/cam/eufy_cam1/index.m3u8?k=ck0123456789abcdef');
  assert.equal(e.s.triedNative, true);
  assert.equal(e.s.hls, null);
  assert.ok(e.log.beacons.some((b) => b.e === 'engine' && b.d.after === 'blocked'));
});

test('hls.js refused and no native HLS: falls straight to snapshots, no black wait', async () => {
  const e = env({ shell: true, native: false, hls: true });
  await e.api.startCamera(e.s);
  await tick();
  assert.equal(e.log.hlsCreated, 1);
  e.video.emit('error', { error: { code: 4 } });
  await tick();
  assert.equal(e.s.mode, 'snap');
  assert.ok(e.log.beacons.some((b) => b.e === 'fallback' && b.d.reason === 'src_blocked'));
});

test('native element error falls to snapshots at once; a decode error on a playing hls.js stream does not restart it', async () => {
  const n = env({ shell: true, native: true, hls: true });
  await n.api.startCamera(n.s);
  await tick();
  n.video.emit('error', { error: { code: 4 } });
  await tick();
  assert.equal(n.s.mode, 'snap');
  const h = env({ shell: false, native: false, hls: true });
  await h.api.startCamera(h.s);
  await tick();
  h.video.emit('playing');
  h.video.emit('error', { error: { code: 3 } });
  await tick();
  assert.equal(h.s.mode, 'hls');
  assert.equal(h.log.hlsDestroyed, 0);
});

test('hls.js refused on a tile (error 4) and no native HLS: that tile stays on snapshots and stops probing; its own restarts never construct hls.js again', async () => {
  const e = env({ shell: true, native: false, hls: true });
  await e.api.startCamera(e.s);
  await tick();
  assert.equal(e.log.hlsCreated, 1);
  e.video.emit('error', { error: { code: 4 } });
  await tick();
  assert.equal(e.s.mode, 'snap');
  assert.equal(e.s.hlsBlocked, true);
  assert.equal(e.s.retry, 0, 'no live probe is scheduled: hls.js can never play on this tile');
  await e.api.startCamera(e.s);
  await tick();
  assert.equal(e.log.hlsCreated, 1, 'the same tile never constructs hls.js again');
  assert.equal(e.s.mode, 'snap');
  assert.equal(e.s.retry, 0);
  assert.ok(e.log.beacons.some((b) => b.e === 'fallback' && b.d.reason === 'hls_blocked'), JSON.stringify(e.log.beacons.map((b) => b.e + ':' + (b.d && b.d.reason))));
});

test('the refusal is per tile: another tile (or the viewer) that never saw it still tries hls.js once', async () => {
  const e = env({ shell: true, native: false, hls: true });
  await e.api.startCamera(e.s);
  await tick();
  e.video.emit('error', { error: { code: 4 } });
  await tick();
  const v2 = fakeVideo({ native: false });
  const s2 = e.api.makeCamera(1, fakeNode(), fakeNode(), v2, fakeNode());
  s2.hls = null;
  assert.equal(s2.hlsBlocked, false);
  await e.api.startCamera(s2);
  await tick();
  assert.equal(e.log.hlsCreated, 2, 'the second tile tries hls.js itself');
  v2.emit('error', { error: { code: 4 } });
  await tick();
  assert.equal(s2.hlsBlocked, true);
  assert.equal(s2.mode, 'snap');
});

test('a blocked tile that can play native HLS goes native on every restart and a native failure still re-probes for live', async () => {
  const e = env({ shell: false, native: true, hls: true });
  await e.api.startCamera(e.s);
  await tick();
  e.video.emit('error', { error: { code: 4 } });
  await tick();
  assert.equal(e.s.hlsBlocked, true);
  assert.equal(e.video.src, '/cam/eufy_cam1/index.m3u8?k=ck0123456789abcdef');
  // the native element fails: snapshots now, and the live probe is scheduled as before
  e.video.emit('error', { error: { code: 4 } });
  await tick();
  assert.equal(e.s.mode, 'snap');
  assert.notEqual(e.s.retry, 0);
  // the next live start uses native HLS straight away and never hls.js
  await e.api.startCamera(e.s);
  await tick();
  assert.equal(e.log.hlsCreated, 1);
  assert.equal(e.video.src, '/cam/eufy_cam1/index.m3u8?k=ck0123456789abcdef');
});

test('a decode error on a playing hls.js stream does not mark the tile blocked', async () => {
  const e = env({ shell: false, native: false, hls: true });
  await e.api.startCamera(e.s);
  await tick();
  e.video.emit('playing');
  e.video.emit('error', { error: { code: 3 } }); // not the refusal
  await tick();
  assert.equal(e.s.hlsBlocked, false);
});

test('the camera key route is only fetched when native HLS is used, with the page cookie, never cached when empty', () => {
  assert.match(src, /fetch\('\/api\/camkey',\{cache:'no-store',credentials:'same-origin'/);
  assert.match(src, /if\(!k\)camKeyP=null/);
});
