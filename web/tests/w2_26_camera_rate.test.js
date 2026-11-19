// Lane 26: camera tiles show the measured frame rate, a stall with its last frame time and a Retry that reloads only that stream,
// and an offline tile names the engine's reason. Runs the real camera block of static/app.js against fake timers, a fake Image and a fake <video>.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const start = src.indexOf('// ==== CAMERA UI HELPERS BEGIN');
const end = src.indexOf('// ==== CAMERA UI HELPERS END ====');
const CameraUI = vm.runInNewContext(src.slice(start, end) + '\nCameraUI;', {}, { timeout: 1000 });

test('frame rate: frames over the window; null when the counter goes back, the window is empty or a value is missing', () => {
  assert.equal(CameraUI.frameRate(100, 130, 2000), 15);
  assert.equal(CameraUI.frameRate(100, 100, 2000), 0);
  assert.equal(CameraUI.frameRate(130, 100, 2000), null);
  assert.equal(CameraUI.frameRate(100, 130, 0), null);
  assert.equal(CameraUI.frameRate(NaN, 130, 2000), null);
  assert.equal(CameraUI.frameRate(100, undefined, 2000), null);
});

test('rate line: measured fps and size, labelled "measured now"; unknown says "rate unknown", never a guess', () => {
  assert.equal(CameraUI.rateText(14.96, 1920, 1080), '15 fps \u00B7 1920\u00D71080 \u00B7 measured now');
  assert.equal(CameraUI.rateText(8, 0, 0), '8 fps \u00B7 size unknown \u00B7 measured now');
  assert.equal(CameraUI.rateText(null, 1920, 1080), 'rate unknown \u00B7 1920\u00D71080');
  assert.equal(CameraUI.rateText(null, 0, 0), 'rate unknown');
});

test('stall: more than 5 s with no new frame; a stream that never played is never a stall', () => {
  assert.equal(CameraUI.stalledFor(10000, 15000, CameraUI.FRAME_STALL_MS), false);
  assert.equal(CameraUI.stalledFor(10000, 15001, CameraUI.FRAME_STALL_MS), true);
  assert.equal(CameraUI.stalledFor(0, 999999, CameraUI.FRAME_STALL_MS), false);
  assert.equal(CameraUI.stalledFor(undefined, 999999, 5000), false);
});

test('stall text carries the last frame time as local HH:MM', () => {
  const t = new Date(2026, 9, 9, 7, 5, 30).getTime();
  assert.equal(CameraUI.hhmm(t), '07:05');
  assert.equal(CameraUI.stallText(t), 'Stalled \u00B7 last frame 07:05');
});

test('offline reason comes from the engine; an unknown or inherited key never leaks', () => {
  assert.equal(CameraUI.reasonText('timeout'), 'Reason: The camera did not answer');
  assert.equal(CameraUI.reasonText('load'), 'Reason: The frame did not load');
  assert.equal(CameraUI.reasonText(''), 'Reason: unknown');
  assert.equal(CameraUI.reasonText('constructor'), 'Reason: unknown');
});

// ---------------- behaviour ----------------
function harness() {
  let now = 1000000, seq = 0;
  const timers = new Map(), images = [], cfg = { latency: 120, fail: false }, dom = {};
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
      tag, dataset: {}, style: { setProperty() {} }, children: [], _kids: {}, _attrs: {}, handlers: {}, textContent: '', clientWidth: 320, clientHeight: 180, parentNode: null,
      classList: { add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c), toggle: (c, f) => { const on = f === undefined ? !set.has(c) : !!f; if (on) set.add(c); else set.delete(c); return on } },
      querySelector(sel) { return this._kids[sel] || (this._kids[sel] = el(sel)) },
      appendChild(c) { c.parentNode = this; if (!this.children.includes(c)) this.children.push(c); return c },
      removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c },
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
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(now) } static now() { return now } }
  const box = {
    $, $$: () => [], ...T, Image: FakeImage, Date: FakeDate, mode: 'awake', pname: () => 'house',
    document: { hidden: false, head: { appendChild() {} }, createElement: t => el(t) },
    window: {}, localStorage: { getItem: () => null, setItem() {} }, ResizeObserver: class { observe() {} },
    fetch: () => Promise.resolve({ ok: false }), AbortSignal: { timeout: () => ({}) }, resetZoom() {}, IN_SHELL: false,
  };
  const code = src.slice(src.indexOf('const CAMS='), src.indexOf('function openViewer(')) +
    '\n({ensureCameras,startCamera,stopCamera,sampleRate,paintRate,retryStream,get tiles(){return tiles},get viewer(){return viewer}})';
  const api = vm.runInNewContext(code, box, { timeout: 2000 });
  return { api, advance, now: () => now, cfg, dom, images };
}
const status = s => s.root.querySelector('.cam-status').textContent;
const rate = s => s.root.querySelector('.cam-rate').textContent;

// A started tile (or viewer) that has reported `playing`, with a 1280x720 picture.
async function playingStream(h, s) {
  s.video.videoWidth = 1280; s.video.videoHeight = 720;
  s.video.fire('playing');
  return s;
}

test('tile: measured fps from the frame counter, "measured now", resolution from the video', async () => {
  const h = harness();
  h.api.ensureCameras();
  const t = h.api.tiles[0];
  h.api.startCamera(t);
  await playingStream(h, t);
  let frames = 300;
  t.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames });
  h.api.sampleRate(t, h.now());
  assert.equal(rate(t), 'rate unknown \u00B7 1280\u00D7720', 'the first sample has no window yet');
  frames += 30;
  await h.advance(2000);
  h.api.sampleRate(t, h.now());
  assert.equal(rate(t), '15 fps \u00B7 1280\u00D7720 \u00B7 measured now');
  assert.equal(status(t), 'Live', 'the status word is unchanged');
});

test('tile: no frame counter means "rate unknown" and never a stall', async () => {
  const h = harness();
  h.api.ensureCameras();
  const t = h.api.tiles[0];
  h.api.startCamera(t);
  await playingStream(h, t);
  for (let i = 0; i < 5; i++) { await h.advance(2000); h.api.sampleRate(t, h.now()); }
  assert.equal(rate(t), 'rate unknown \u00B7 1280\u00D7720');
  assert.equal(t.stalled, false);
});

test('tile stall: no new frame for more than 5 s shows "Stalled · last frame HH:MM"; Retry restarts only that stream', async () => {
  const h = harness();
  h.api.ensureCameras();
  const t = h.api.tiles[0], other = h.api.tiles[1];
  h.api.startCamera(t);
  await playingStream(h, t);
  const playAt = h.now();
  let frames = 300;
  t.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames });
  h.api.sampleRate(t, h.now());
  await h.advance(4000);
  h.api.sampleRate(t, h.now());
  assert.equal(t.stalled, false, 'at 4 s the stream is not yet a stall');
  await h.advance(2000);
  h.api.sampleRate(t, h.now());
  assert.equal(t.stalled, true);
  assert.equal(rate(t), CameraUI.stallText(playAt));
  assert.equal(status(t), 'Live');

  const gen = t.gen, otherGen = other.gen;
  h.api.retryStream(t);
  assert.equal(t.gen, gen + 1, 'the stalled stream restarts');
  assert.equal(t.stalled, false);
  assert.equal(other.gen, otherGen, 'the other tile is untouched');
  assert.equal(other.active, false);

  frames = 400;
  h.api.startCamera(t);
  await playingStream(h, t);
  await h.advance(2000);
  h.api.sampleRate(t, h.now());
  assert.doesNotMatch(rate(t), /Stalled/);
});

test('retry on a tile that is not on screen does nothing', () => {
  const h = harness();
  h.api.ensureCameras();
  const t = h.api.tiles[2];
  const gen = t.gen;
  h.api.retryStream(t);
  assert.equal(t.gen, gen);
  assert.equal(t.active, false);
});

test('viewer stall: the message line shows the last frame time with a Retry that restarts only the viewer', async () => {
  const h = harness();
  h.api.ensureCameras();
  const v = h.api.viewer, t = h.api.tiles[0];
  v.i = 0;
  h.api.startCamera(v);
  await playingStream(h, v);
  const playAt = h.now();
  let frames = 10;
  v.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames });
  h.api.sampleRate(v, h.now());
  await h.advance(6000);
  h.api.sampleRate(v, h.now());
  const msg = h.dom['#vmsg'];
  assert.equal(msg.textContent, CameraUI.stallText(playAt));
  const btn = msg.children.find(c => c.id === 'vretry');
  assert.ok(btn, 'Retry button is in the message line');
  assert.equal(btn.textContent, 'Retry');
  assert.equal(btn.getAttribute('aria-label'), 'Retry this camera stream');

  const gen = v.gen, tileGen = t.gen;
  btn.onclick();
  assert.equal(v.gen, gen + 1, 'the viewer stream restarts');
  assert.equal(t.gen, tileGen, 'the tile stream is untouched');
  assert.doesNotMatch(msg.textContent, /Stalled/, 'the restarting viewer says Connecting, not the stall');
  assert.equal(msg.children.includes(btn), false);
});

test('viewer: a stall that clears on new frames leaves the message line empty', async () => {
  const h = harness();
  h.api.ensureCameras();
  const v = h.api.viewer;
  v.i = 0;
  h.api.startCamera(v);
  await playingStream(h, v);
  let frames = 10;
  v.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames });
  h.api.sampleRate(v, h.now());
  await h.advance(6000);
  h.api.sampleRate(v, h.now());
  assert.match(h.dom['#vmsg'].textContent, /^Stalled/);
  frames = 20;
  await h.advance(2000);
  h.api.sampleRate(v, h.now());
  assert.equal(h.dom['#vmsg'].textContent, '');
});

test('offline tile says why on its rate line: the engine could not load a frame', async () => {
  const h = harness();
  h.api.ensureCameras();
  const t = h.api.tiles[0];
  h.api.startCamera(t);
  await h.advance(150);
  h.cfg.fail = true;
  await h.advance(15500);
  assert.equal(status(t), 'Camera offline');
  assert.equal(rate(t), 'Reason: The frame did not load');
});
