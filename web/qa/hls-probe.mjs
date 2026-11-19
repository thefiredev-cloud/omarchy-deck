// Which hls.js configuration plays the LIVE MediaMTX stream? Runs inside your own isolated Omabox (Blink, not iOS WebKit),
// loads /hls.min.js from the deck, attaches one camera to a bare <video> per configuration and reports the time to the first
// `playing` event plus hls.js error counts. Read-only; prints counts only, never frames.
//   export DECK_TOKEN=$(cat ~/.config/pixel-deck/token)
//   omabox run -b NAME --pass DECK_TOKEN -- node qa/hls-probe.mjs
import { selectProbeOptions } from './hls-probe-options.mjs';
import { spawn } from 'node:child_process';
const TOKEN = process.env.DECK_TOKEN || '';
if (!/^[A-Za-z0-9_-]{16,}$/.test(TOKEN)) { console.error('DECK_TOKEN missing'); process.exit(2); }
const DECK = 'http://127.0.0.1:8796', CDP = 19461;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const t = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 60000); pending.set(id, { resolve, reject, t }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };

const CONFIGS = {
  'LL on (the Pixel config)': { lowLatencyMode: true, liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 4, maxBufferLength: 3, backBufferLength: 0 },
  'LL off, my iOS config': { lowLatencyMode: false, liveSyncDurationCount: 3, maxBufferLength: 8, backBufferLength: 0 },
  'LL off, hls.js defaults': { lowLatencyMode: false, backBufferLength: 0 },
  'LL on, hls.js defaults': { lowLatencyMode: true, backBufferLength: 0 },
};
const probe = (cfg, cam) => `(async()=>{
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.autoplay=true;document.body.appendChild(video);
  const errs={};let firstPlay=null;const t0=performance.now();
  const h=new Hls(${JSON.stringify(cfg)});
  h.on(Hls.Events.ERROR,(_,d)=>{const k=(d.fatal?'FATAL ':'')+d.details;errs[k]=(errs[k]||0)+1});
  video.addEventListener('playing',()=>{if(firstPlay==null)firstPlay=Math.round(performance.now()-t0)});
  h.attachMedia(video);h.loadSource('/cam/eufy_cam${cam}/index.m3u8');
  const fr=()=>{const q=video.getVideoPlaybackQuality?video.getVideoPlaybackQuality():null;return q?q.totalVideoFrames:null};
  await new Promise(r=>setTimeout(r,15000));const f0=fr();
  await new Promise(r=>setTimeout(r,5000));const f1=fr();
  const out={firstPlayMs:firstPlay,currentTime:Math.round(video.currentTime*10)/10,videoWidth:video.videoWidth,fps:f0==null||f1==null?null:Math.round((f1-f0)/5*10)/10,errs};
  h.destroy();video.remove();return out})()`;

const browser = spawn('/usr/bin/chromium', ['--headless=new', '--disable-gpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + CDP, '--user-data-dir=/home/sbx/.cache/hls-probe-' + Date.now(), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
try {
  await new Promise((res, rej) => { const t = setTimeout(() => rej(Error('Chromium readiness timeout')), 20000); browser.stderr.on('data', (b) => { if (b.toString().includes('DevTools listening')) { clearTimeout(t); res(); } }); });
  const target = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).find((x) => x.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  ws.addEventListener('message', (e) => { const r = JSON.parse(e.data); if (r.id && pending.has(r.id)) { const p = pending.get(r.id); pending.delete(r.id); clearTimeout(p.t); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result || {}); } });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Network.setCookie', { name: 'pdeck', value: TOKEN, url: DECK + '/', httpOnly: true });
  await cdp('Page.navigate', { url: DECK + '/healthz' }); await sleep(800);
  await ev(`new Promise((res,rej)=>{const s=document.createElement('script');s.src='/hls.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s)})`);
  console.log('hls.js', await ev('Hls.version'), 'supported', await ev('Hls.isSupported()'));
  // Default (warm): request the playlists once so every configuration starts from the same state, then run all four configs on one camera.
  // COLD=1: no warm-up and 75 s of silence before every trial, so MediaMTX has closed its idle HLS muxers and each trial pays the real
  // first-view cost (the owner's phone sees this on most visits). Cold mode runs configs 0 and 1 unless CFG says otherwise.
  //   CFG=0,1,2,3   which configs, by index in the list above      CAMS=1,2,3,4   cameras started at the same moment (the House page starts four)
  //   TRIALS=3      repeat the whole set (cold mode idles before each one)
  const { cold: COLD, picked, cams, trials } = selectProbeOptions(process.env);
  if (!picked.length || !cams.length) throw Error('CFG or CAMS selects nothing');
  if (!COLD) {
    await ev(`Promise.all([1,2,3,4].map(i=>fetch('/cam/eufy_cam'+i+'/index.m3u8').then(r=>r.status)))`);
    await sleep(4000);
  }
  for (let trial = 1; trial <= trials; trial++) {
    for (const idx of picked) {
      if (COLD) { console.log('  (idle 75 s so the muxers close)'); await sleep(75000); }
      const rs = await Promise.all(cams.map((cam) => ev(probe(CONFIGS[names[idx]], cam))));
      rs.forEach((r, k) => console.log(`t${trial} cam${cams[k]}`, names[idx].padEnd(28), r.firstPlayMs == null ? 'NEVER PLAYED' : 'first frame ' + r.firstPlayMs + ' ms', '| currentTime', r.currentTime, '| width', r.videoWidth, '| fps', r.fps == null ? 'unknown' : r.fps, '| errors', JSON.stringify(r.errs)));
      await sleep(COLD ? 500 : 2500);
    }
  }
} catch (e) { console.error('PROBE ERROR', String(e).slice(0, 300)); process.exitCode = 1; }
finally { try { ws?.close(); } catch {} try { browser.kill('SIGTERM'); } catch {} setTimeout(() => process.exit(process.exitCode || 0), 300); }
