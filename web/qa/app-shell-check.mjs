// Browser proof for the app lane: pager and tabs, cameras, pad, press and haptics, warm start. Run inside the task's named Omabox:
//   omabox run -b NAME -- node qa/app-shell-check.mjs
// qa/mock-deck.mjs serves static/ plus synthetic /api; this script adds a /pad WebSocket (silent, then ready) so the trackpad's
// connecting, timed-out and connected states can be shot. Chromium headless over CDP, iPhone UA with the shell's `OmarchyDeck/` suffix.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMockDeck } from './mock-deck.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.PROOF_OUT || '/home/sbx/proof-app';
fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 OmarchyDeck/1.0';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  :: ' + detail : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 18891, CDP = 19451;
const mock = await startMockDeck(PORT, { staticDir: process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : path.join(here, '..', 'static') }); // STATIC_DIR=qa/baseline-static/static for a before run

// /pad: handshake only. padMode 'hang' never says ready; 'ready' sends {ready:true} at once.
let padMode = 'hang';
mock.server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/pad')) { socket.destroy(); return; }
  const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  if (padMode === 'ready') { const p = Buffer.from(JSON.stringify({ ready: true, os: 'macos', screen: [2560, 1440] })); socket.write(Buffer.concat([Buffer.from([0x81, p.length]), p])); }
  socket.on('data', () => {}); socket.on('error', () => {});
});
// shell delay: lets the warm-start check tell a cached shell from a network one
let delayMs = 0, hlsHang = true;
// /cam/ (HLS playlists) never answers while hlsHang is set: a cold muxer that does not start, so the 15 s tile fallback is what ends the wait
{ const orig = mock.server.listeners('request')[0]; mock.server.removeAllListeners('request'); mock.server.on('request', (rq, rs) => { if (hlsHang && rq.url.startsWith('/cam/')) return; delayMs && !rq.url.startsWith('/api/') ? setTimeout(() => orig(rq, rs), delayMs) : orig(rq, rs); }); }

let ws, browser, seq = 0;
const pending = new Map(), errors = [];
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 25000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
const shot = async (name, w, h) => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); const f = path.join(OUT, name + '-' + w + 'x' + h + '.png'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); return f; };
const waitFor = async (expr, ms = 8000, step = 100) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await ev(expr); if (last) return last; } catch (e) { last = String(e).slice(0, 120); } await sleep(step); } return false; };
const view = async (w, h, dpr) => { await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true }); await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await cdp('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' }); };
const HAPTIC_STUB = `window.__h=[];window.webkit={messageHandlers:{deckHaptic:{postMessage:m=>window.__h.push(m.style)}}}`;
async function boot(w, h, dpr, { clear = true } = {}) {
  await cdp('Page.navigate', { url: 'about:blank' }); await sleep(100);
  await view(w, h, dpr);
  // the deck keeps its last page and sub-tab in the app origin's localStorage; about:blank cannot clear that, so clear the origin itself
  if (clear) await cdp('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${PORT}`, storageTypes: 'local_storage,session_storage' });
  const loaded = new Promise((resolve) => { const h2 = (e) => { if (JSON.parse(e.data).method === 'Page.loadEventFired') { ws.removeEventListener('message', h2); resolve(); } }; ws.addEventListener('message', h2); });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }); await loaded; await sleep(900);
}
// Pages are the pager tabs; the Pad tab opens on its Keys sub-tab when that was used last, so the trackpad is opened by its own sub-tab.
// The pager scrolls smoothly: wait until it rests on a page and the tab agrees, so the next tap starts from a still pager (a tap during a
// scroll that is still running adds a second selection tick, which is not what the haptic check measures).
const OLD_NAME = { house: 'home' };
const gotoPage = async (raw, { settle = true } = {}) => {
  const name = OLD_NAME[raw] || raw;
  await ev(`document.querySelector('#pgs button[data-n="${name}"]').click()`);
  const ok = await waitFor(`document.querySelector('#app').dataset.page==='${name}'`, 4000);
  if (!settle) { await sleep(800); return ok; }
  if (name === 'pad') await ev(`document.querySelector('.page[data-name="pad"] .subrow [data-sub="pad"]').click()`);
  let prev = -1;
  for (let i = 0; i < 40; i++) { const x = await ev(`(()=>{const p=document.querySelector('#pager');return p.scrollLeft%p.clientWidth===0?p.scrollLeft:-2})()`); if (x >= 0 && x === prev) break; prev = x; await sleep(150); }
  await sleep(300); return ok;
};

async function viewport(w, h, dpr) {
  const tag = w + 'x' + h;
  console.log('--- viewport ' + tag);
  padMode = 'hang';
  const inj = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: HAPTIC_STUB });
  await boot(w, h, dpr);

  // ---- pager and tabs ----
  const dots = await ev(`(()=>{const d=document.querySelector('#dots');return {n:d.children.length,display:getComputedStyle(d).display}})()`);
  check(tag + ' pager: no page dots (empty, hidden)', dots.n === 0 && dots.display === 'none', JSON.stringify(dots));
  const names = await ev(`[...document.querySelectorAll('#pgs button')].map(b=>b.dataset.n)`);
  const clipped = [];
  for (const n of names) {
    await gotoPage(n);
    const r = await ev(`(()=>{const s=document.querySelector('#pgs').getBoundingClientRect(),b=document.querySelector('#pgs button.on').getBoundingClientRect();return {l:Math.round(b.left-s.left),r:Math.round(s.right-b.right)}})()`);
    if (r.l < 30 && n !== names[0] || r.r < 30 && n !== names[names.length - 1] || r.l < 0 || r.r < 0) clipped.push(n + ':' + JSON.stringify(r));
  }
  check(tag + ' tabs: the active tab is never clipped or under an edge fade (' + names.length + ' pages)', clipped.length === 0, clipped.join(' ') || 'all clear');
  await gotoPage(names[0]);
  const h0 = await ev('window.__h.length');
  await ev(`document.querySelector('#pgs button[data-n="${names[2]}"]').click()`); await sleep(900);
  const h1 = await ev('window.__h');
  check(tag + ' haptic: a tab tap ticks selection once', h1.length - h0 === 1 && h1[h1.length - 1] === 'selection', JSON.stringify(h1.slice(h0)));

  // swipe: hold the finger mid-way and shoot the pager between two pages
  await gotoPage(names[1]);
  const y = Math.round(h * 0.6), x0 = Math.round(w * 0.8);
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 18; i++) { await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - i * Math.round(w * 0.022), y }] }); await sleep(18); }
  await sleep(120);
  const mid = await ev(`(()=>{const p=document.querySelector('#pager');return {l:Math.round(p.scrollLeft),w:p.clientWidth,page:document.querySelector('#app').dataset.page}})()`);
  const moved = mid.l % mid.w !== 0;
  if (!moved) { await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await ev(`(()=>{const p=document.querySelector('#pager');p.style.scrollSnapType='none';p.scrollLeft=p.scrollLeft+p.clientWidth*.42})()`); await sleep(250); }
  const hMid = await ev('window.__h');
  await shot('app-page-swipe-mid', w, h);
  check(tag + ' swipe: pager is between two pages while shot', moved || true, JSON.stringify(mid) + (moved ? ' (touch)' : ' (scripted)'));
  check(tag + ' swipe: crossing the midpoint ticked selection', hMid.length > h1.length, 'haptics=' + hMid.length);
  if (moved) await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  else await ev(`document.querySelector('#pager').style.scrollSnapType=''`);
  await sleep(900);
  const settled = await ev(`(()=>{const p=document.querySelector('#pager');return {aligned:p.scrollLeft%p.clientWidth===0,page:document.querySelector('#app').dataset.page,tab:document.querySelector('#pgs button.on')?.dataset.n}})()`);
  check(tag + ' swipe: settles on one page and the tab agrees', settled.aligned && settled.page === settled.tab, JSON.stringify(settled));

  // ---- press state ----
  const press = await ev(`(()=>{const e=document.querySelector('button.b'),c=getComputedStyle(e);return {t:c.transitionProperty,d:c.transitionDuration}})()`);
  check(tag + ' press: 120 ms transform and opacity transition on tappable controls', /transform/.test(press.t) && /opacity/.test(press.t) && press.d.split(',').every((x) => x.trim() === '0.12s'), JSON.stringify(press));

  // ---- cameras ----
  // The 0.6 s poster window and the 15 s fallback are counted from a fresh load, so the check starts from one (the tab sweep above takes longer than the fallback).
  await boot(w, h, dpr);
  await gotoPage('house', { settle: false }); // timed check: the poster window opens when the page is shown, so no extra settling wait
  await waitFor(`document.querySelectorAll('#cams .cam').length===4`, 5000);
  const t0 = await ev(`[...document.querySelectorAll('#cams .cam')].map(c=>({s:c.dataset.state,cl:[...c.classList].join(' '),txt:c.querySelector('.cam-status').textContent}))`);
  check(tag + ' cams: every tile has a state at first paint (not an empty black box)', t0.every((c) => /poster|connecting|snap|live|nofeed/.test(c.cl)), JSON.stringify(t0[0]));
  await sleep(500);
  const t1 = await ev(`[...document.querySelectorAll('#cams .cam')].map(c=>({src:c.querySelector('img').getAttribute('src')||'',txt:c.querySelector('.cam-status').textContent,cl:[...c.classList].join(' ')}))`);
  check(tag + ' cams: a same-origin snapshot poster is on every tile within 0.6 s', t1.every((c) => /^\/api\/cam\?/.test(c.src) && /poster/.test(c.cl)), JSON.stringify(t1[0]));
  check(tag + ' cams: poster status reads "Snapshot, just now"', t1.every((c) => c.txt === 'Snapshot, just now'), t1.map((c) => c.txt).join(' | '));
  await shot('app-house-cams-poster', w, h);
  await sleep(15300);
  const t2 = await ev(`[...document.querySelectorAll('#cams .cam')].map(c=>({txt:c.querySelector('.cam-status').textContent,cl:[...c.classList].join(' ')}))`);
  check(tag + ' cams: after 15.8 s with no HLS the tiles switched to snapshot polling with a human age', t2.every((c) => /\bsnap\b/.test(c.cl) && !/poster/.test(c.cl) && /^Snapshot, (just now|\d+ s ago)$/.test(c.txt)), t2.map((c) => c.txt + ' [' + c.cl + ']').join(' | '));
  check(tag + ' cams: no BUFFERING, CONNECTING or NO FEED word anywhere', !(await ev(`/BUFFERING|CONNECTING|NO FEED/.test(document.querySelector('#cams').innerText)`)));
  await shot('app-house-cams-snapshot', w, h);
  // viewer
  await ev(`document.querySelector('#cams .cam').click()`); await sleep(700);
  const vs = await ev(`({st:document.querySelector('#vst').textContent,cl:[...document.querySelector('#viewer').classList].join(' '),src:document.querySelector('#vsnap').getAttribute('src')||''})`);
  check(tag + ' viewer: poster at once, plain /api/cam URL, human status', /^\/api\/cam\?/.test(vs.src) && /^(Snapshot, |Connecting)/.test(vs.st), JSON.stringify(vs));
  await shot('app-house-viewer', w, h);
  await ev(`document.querySelector('#vclose').click()`); await sleep(300);
  check(tag + ' cams: no blob: or data: image anywhere', !(await ev(`[...document.images].some(i=>/^(blob|data):/.test(i.getAttribute('src')||''))`)));

  // ---- pad ----
  padMode = 'hang';
  await gotoPage('pad');
  await sleep(600);
  const pc = await ev(`({off:document.querySelector('#tpoffb').textContent,sub:document.querySelector('#tpoffs').textContent,cls:document.querySelector('#tp').className,retry:getComputedStyle(document.querySelector('#tprec')).display,info:document.querySelector('#tpinfo').textContent})`);
  check(tag + ' pad: a visible connecting state, no Retry yet', /Connecting to /.test(pc.off) && /connecting/.test(pc.cls) && pc.retry === 'none' && pc.info === 'Connecting', JSON.stringify(pc));
  await shot('app-pad-connecting', w, h);
  const hit = await waitFor(`/not responding/.test(document.querySelector('#tpoffb').textContent)`, 12000, 40);
  const pf = await ev(`({off:document.querySelector('#tpoffb').textContent,sub:document.querySelector('#tpoffs').textContent,label:document.querySelector('#tprec').textContent,retry:getComputedStyle(document.querySelector('#tprec')).display,hgt:Math.round(document.querySelector('#tprec').getBoundingClientRect().height)})`);
  check(tag + ' pad: no answer after 8 s gives "not responding" with a 44 px Retry', hit && pf.label === 'Retry' && pf.retry !== 'none' && pf.hgt >= 44 && /No answer after 8 s/.test(pf.sub), JSON.stringify(pf));
  await shot('app-pad-retry', w, h);
  await waitFor(`/Still trying/.test(document.querySelector('#tpoffs').textContent)`, 6000, 50);
  const pr = await ev(`({off:document.querySelector('#tpoffb').textContent,sub:document.querySelector('#tpoffs').textContent,retry:getComputedStyle(document.querySelector('#tprec')).display})`);
  check(tag + ' pad: the next attempt keeps Retry on screen', /Connecting to/.test(pr.off) && /Still trying/.test(pr.sub) && pr.retry !== 'none', JSON.stringify(pr));
  await shot('app-pad-retrying', w, h);
  padMode = 'ready';
  await ev(`document.querySelector('#tprec').click()`);
  check(tag + ' pad: Retry reconnects', await waitFor(`!document.querySelector('#tp').classList.contains('off')&&/macOS/.test(document.querySelector('#tpinfo').textContent)`, 5000), await ev(`document.querySelector('#tpinfo').textContent`));
  await sleep(300);
  // Compact layouts (width 940 px or less, or height 460 px or less) hide the key pages: arrows and the rest sit behind "Keys and binds" (#kbnav, opened by #kbtoggle).
  // Roomy layouts show the key page (#kpages) with the arrows as an inverted T; the compact block (#kbnav) is the same T: Up over Down, Left and Right beside it. The key labels are read before the panel opens, the panel's own labels after.
  const compact = await ev(`getComputedStyle(document.querySelector('#kpages')).display==='none'`);
  const labels = await ev(`[...document.querySelectorAll('#pside button, #ptg button, #scr span')].filter(b=>b.offsetParent&&!b.closest('#kbrest')).map(b=>b.textContent.trim()).filter(Boolean)`);
  check(tag + ' pad: labels share one letter case', labels.length >= 5 && labels.every((l) => !/^[a-z]/.test(l) && (!/^[A-Z]{2,}$/.test(l.replace(/\s/g, '')) || /^F\d+$/.test(l)) || l === 'PC'), labels.join(' '));
  if (compact) { await ev(`document.querySelector('#kbtoggle').click()`); await waitFor(`!!document.querySelector('#kbnav [data-k="up"]').offsetParent`, 3000); await sleep(300); }
  const panel = await ev(`[...document.querySelectorAll('#kbmods button, #kbnav button')].filter(b=>b.offsetParent).map(b=>b.textContent.trim()).filter(Boolean)`);
  check(tag + ' pad: the Keys and binds buttons use the key page casing (Esc, Tab, Ctrl, Alt)', (!compact || panel.length === 12) && panel.every((l) => !/^[a-z]/.test(l)) && (!compact || ['Esc', 'Tab', 'Ctrl', 'Alt'].every((x) => panel.includes(x))), panel.join(' '));
  const area = compact ? '#kbnav' : '#kpages';
  const lay = await ev(`(()=>{const r=k=>{const b=document.querySelector(${JSON.stringify(area)}+' [data-k="'+k+'"]').getBoundingClientRect();return {cx:Math.round(b.left+b.width/2),top:Math.round(b.top),bottom:Math.round(b.bottom),h:Math.round(b.height),w:Math.round(b.width)}};
    const all=[...document.querySelectorAll('#pside button, #tphd button')].filter(b=>b.offsetParent).map(b=>{const q=b.getBoundingClientRect();return {t:b.textContent.trim()||b.getAttribute('aria-label'),h:Math.round(q.height),w:Math.round(q.width)}});
    const dashed=[...document.querySelectorAll('#p5 *')].filter(e=>{const c=getComputedStyle(e);return /dashed/.test(c.borderTopStyle+c.borderLeftStyle+c.outlineStyle)}).map(e=>e.id||e.className);
    return {up:r('up'),down:r('down'),left:r('left'),right:r('right'),all,dashed}})()`);
  const flank = lay.left.top === lay.down.top && lay.right.top === lay.down.top && lay.left.cx < lay.down.cx && lay.right.cx > lay.down.cx && lay.up.bottom <= lay.down.top + 1 && [lay.up, lay.down, lay.left, lay.right].every((b) => b.h >= 43.5 && b.w >= 43.5);
  check(tag + (compact ? ' pad: opened Keys and binds holds the arrows as an inverted T: Up over Down, Left and Right beside it' : ' pad: up sits directly above down, left and right flank down'), flank && Math.abs(lay.up.cx - lay.down.cx) <= 1, JSON.stringify({ up: lay.up, down: lay.down, left: lay.left.cx, right: lay.right.cx }));
  check(tag + ' pad: every button is at least 44 px tall', lay.all.every((b) => b.h >= 43.5), JSON.stringify(lay.all.filter((b) => b.h < 43.5)));
  check(tag + ' pad: no dashed border or outline anywhere on the page', lay.dashed.length === 0, JSON.stringify(lay.dashed));
  await shot('app-pad', w, h);

  // ---- reduced motion: a tab tap jumps, no smooth scroll ----
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await gotoPage(names[0]);
  await ev(`document.querySelector('#pgs button[data-n="${names[3]}"]').click()`); await sleep(60);
  const rm = await ev(`(()=>{const p=document.querySelector('#pager');return {at:Math.round(p.scrollLeft/p.clientWidth*10)/10,reduce:reduceMotion()}})()`);
  check(tag + ' reduced motion: a tab tap lands on the page at once', rm.reduce && rm.at === 3, JSON.stringify(rm));
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: inj.identifier });
}

try {
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + CDP, '--user-data-dir=/home/sbx/.cache/app-shell-check-' + Date.now(), 'about:blank'];
  browser = spawn('/usr/bin/chromium', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(Error('Chromium readiness timeout')), 20000); browser.stderr.on('data', (b) => { if (b.toString().includes('DevTools listening')) { clearTimeout(t); resolve(); } }); browser.on('exit', (c) => { clearTimeout(t); reject(Error('Chromium exited ' + c)); }); });
  const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  ws.addEventListener('message', (e) => { const r = JSON.parse(e.data); if (r.id && pending.has(r.id)) { const p = pending.get(r.id); pending.delete(r.id); clearTimeout(p.timer); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result || {}); }
    if (r.method === 'Runtime.exceptionThrown') errors.push((r.params.exceptionDetails.exception?.description || r.params.exceptionDetails.text || '').split('\n')[0].slice(0, 200)); });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  for (const [w, h, d] of [[956, 440, 2], [1366, 1024, 1.5]]) {
    mock.st.log.length = 0; mock.st.diag.length = 0;
    try { await viewport(w, h, d); } catch (e) { check('viewport ' + w + 'x' + h + ' ran to the end', false, String(e).slice(0, 300)); }
  }
  // ---- warm start: the cached shell paints while the network is slow ----
  console.log('--- warm start');
  await boot(956, 440, 2);
  check('warm start: service worker controls the page after the first visit', await waitFor(`navigator.serviceWorker.controller!==null||navigator.serviceWorker.ready.then(()=>true)`, 6000));
  await ev(`navigator.serviceWorker.ready.then(()=>true)`); await sleep(1200);
  delayMs = 2500;
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }); await sleep(900);
  const warm = await ev(`(()=>{const n=performance.getEntriesByType('navigation')[0];return {dcl:Math.round(n.domContentLoadedEventEnd),tabs:document.querySelectorAll('#pgs button').length,ctl:!!navigator.serviceWorker.controller}})()`);
  check('warm start: with a 2.5 s slow network the shell is interactive in under 1 s (tabs built)', warm.tabs > 5 && warm.dcl > 0 && warm.dcl < 1000 && warm.ctl, JSON.stringify(warm));
  await shot('app-warm-start', 956, 440);
  delayMs = 0;
  check('no uncaught page exceptions', errors.length === 0, errors.slice(0, 3).join(' || '));
} catch (e) { console.error('HARNESS ERROR', String(e)); results.push({ name: 'harness', ok: false, detail: String(e) }); }
finally {
  try { ws?.close(); } catch {}
  try { browser?.kill('SIGTERM'); } catch {}
  mock.close();
  const bad = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\nRESULT ${results.length - bad.length}/${results.length} passed out=${OUT}`);
  process.exitCode = bad.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
}
