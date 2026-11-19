// Browser proof for the feedback release. Run inside the task's named Omabox:
//   omabox run -b NAME -- node qa/mock-deck-pages-check.mjs [baseline|current] [scenario,scenario]
// A mock deck (qa/mock-deck.mjs) serves static/ plus synthetic /api. Chromium headless is driven over CDP with an
// iPhone landscape viewport and an iPhone user agent that carries the shell's `OmarchyDeck/` suffix.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMockDeck } from './mock-deck.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const which = process.argv[2] || 'current';
const only = (process.argv[3] || '').split(',').filter(Boolean);
const OUT = process.env.PROOF_OUT || '/home/sbx/proof-' + which;
fs.mkdirSync(OUT, { recursive: true });
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 OmarchyDeck/1.0';
const PIXEL_UA = 'Mozilla/5.0 (Linux; Android 16; Pixel 10a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  :: ' + detail : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = 18890, CDP = 19450;
const mock = await startMockDeck(PORT, { staticDir: which === 'baseline' ? path.join(here, 'baseline-static') : path.join(here, '..', 'static') });
let ws, browser, seq = 0;
const pending = new Map(), errors = [], consoleErrors = [];
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 20000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
const shot = async (name) => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); const f = path.join(OUT, name + '.png'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); return f; };
const waitFor = async (expr, ms = 8000, step = 100) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await ev(expr); if (last) return last; } catch (e) { last = String(e).slice(0, 120); } await sleep(step); } return false; };
const view = async (w, h, dpr, mobile, ua) => { await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile }); await cdp('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 }); await cdp('Emulation.setUserAgentOverride', { userAgent: ua, platform: mobile ? 'iPhone' : 'Linux' }); };
// real touch tap at the centre of the first element matching `sel` (or whose text matches `re` inside `sel`)
async function rectOf(sel, re) {
  return ev(`(()=>{const els=[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'});
    const el=${re ? `els.find(e=>new RegExp(${JSON.stringify(re)},'i').test((e.innerText||e.textContent||'').trim()))` : 'els[0]'};if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}})()`);
}
// The pages scroll smoothly, so a rect read right after scrollIntoView is still moving: wait until two reads 150 ms apart agree before the touch.
async function tap(sel, re) {
  let r = await rectOf(sel, re); if (!r) throw Error('tap target not found: ' + sel + ' ' + (re || ''));
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    const next = await rectOf(sel, re); if (!next) throw Error('tap target vanished: ' + sel + ' ' + (re || ''));
    const still = Math.abs(next.x - r.x) < 1 && Math.abs(next.y - r.y) < 1; r = next; if (still) break;
  }
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] });
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return r;
}
// The pager tabs are the pages (today, home, markets, life, shop, commerce, money, fleet, pad). Launch, Agents, Cluster, Dev, Crons
// and All crons are sub-tabs of Fleet, Keys is a sub-tab of Pad: open the tab, then the sub-tab. Old names still resolve (house is home, invest is markets).
const OLD_NAME = { house: 'home', invest: 'markets' }, SUB_OF = { fleet: 'fleet', launch: 'fleet', agents: 'fleet', cluster: 'fleet', dev: 'fleet', crons: 'fleet', schedules: 'fleet', pad: 'pad', keys: 'pad' };
const gotoPage = async (raw) => {
  const name = OLD_NAME[raw] || raw, tab = SUB_OF[name] || name;
  await ev(`document.querySelector('#pgs button[data-n="${tab}"]').click()`);
  let ok = await waitFor(`document.querySelector('#app').dataset.page==='${tab}'`, 4000);
  if (SUB_OF[name]) {
    const sub = `#pager>.page[data-name="${tab}"] .subrow button[data-sub="${name}"]`;
    ok = ok && await waitFor(`!!document.querySelector(${JSON.stringify(sub)})`, 3000);
    if (ok) { await ev(`document.querySelector(${JSON.stringify(sub)}).click()`); ok = await waitFor(`!!document.querySelector(${JSON.stringify(sub + '.on')})`, 3000); }
  }
  await sleep(700); return ok;
};
const typeInto = async (sel, text) => { await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.focus();e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`); };
const visible = (sel) => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;const r=e.getBoundingClientRect(),c=getComputedStyle(e);return r.width>0&&r.height>0&&c.display!=='none'&&c.visibility!=='hidden'&&c.opacity!=='0'})()`;

async function boot(ua, w, h, dpr, mobile = true) {
  await cdp('Page.navigate', { url: 'about:blank' }); await sleep(100);
  await view(w, h, dpr, mobile, ua);
  // the deck keeps its last page and sub-tab in the app origin's localStorage; about:blank cannot clear that, so clear the origin itself
  await cdp('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${PORT}`, storageTypes: 'local_storage,session_storage' });
  const loaded = new Promise((resolve) => { const h2 = (e) => { if (JSON.parse(e.data).method === 'Page.loadEventFired') { ws.removeEventListener('message', h2); resolve(); } }; ws.addEventListener('message', h2); });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }); await loaded; await sleep(900);
}

const S = {};
S.crons = async () => {
  await boot(IPHONE_UA, 956, 440, 3);
  check('crons: tab exists', await gotoPage('crons'));
  check('crons: rows render', await waitFor(`document.querySelectorAll('.cronrow').length>=8`, 6000), 'rows=' + await ev(`document.querySelectorAll('.cronrow').length`));
  await shot('01-crons-page');
  await tap('.cronrow', 'engagement watch');
  check('crons: tap opens sheet', await waitFor(visible('#sheet'), 3000));
  const txt = await ev(`document.querySelector('#sheet')?.innerText||''`);
  check('crons: sheet names job and shows id8', /engagement watch/i.test(txt) && /2b23e296/.test(txt), txt.slice(0, 120).replace(/\n/g, ' | '));
  check('crons: sheet has Run now, Pause, Ask Hermes', /Run now/i.test(txt) && /Pause/i.test(txt) && /Ask Hermes/i.test(txt));
  check('crons: no prompt text leaks', !/SYNTHETIC PROMPT/.test(txt));
  await shot('02-cron-sheet');
  await tap('#sheet button', '^Pause');
  await sleep(250);
  const armed = await ev(`[...document.querySelectorAll('#sheet button')].map(b=>b.innerText.trim()).join('|')`);
  check('crons: first tap arms (Tap again), no POST yet', /Tap again/i.test(armed) && !mock.st.log.some((l) => l.path === '/api/cron-act'), armed);
  await shot('03-cron-armed');
  await tap('#sheet button', 'Tap again');
  check('crons: second tap POSTs pause', await waitFor(`1`, 100) && await (async () => { const end = Date.now() + 4000; while (Date.now() < end) { if (mock.st.log.some((l) => l.path === '/api/cron-act' && l.query.act === 'pause' && l.query.id === '2b23e296')) return true; await sleep(100); } return false; })(), JSON.stringify(mock.st.log.filter((l) => l.path === '/api/cron-act').map((l) => l.query)));
  await sleep(900);
  await shot('04-cron-after-pause');
  const pausedNow = await ev(`[...document.querySelectorAll('#cr2 .cronrow, #cr3 .cronrow')].some(e=>/engagement watch/i.test(e.innerText))`);
  check('crons: job moved to Paused list after refresh', pausedNow);
  // close sheet by Escape and make sure the page still works
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(300);
  check('crons: Escape closes sheet', !(await ev(visible('#sheet'))));
  // failing cron: error row, Ask Hermes draft
  await tap('.cronrow', 'network security');
  await waitFor(visible('#sheet'), 3000);
  await tap('#sheet button', 'Ask Hermes');
  check('ask: run window opens in compose mode', await waitFor(`document.querySelector('#runp.on')&&${visible('#runin')}`, 3000));
  const draft = await ev(`document.querySelector('#runin')?.value||''`);
  check('ask: draft names the job and id8, nothing sent yet', /network security/i.test(draft) && /54c3bc8e/.test(draft) && !mock.st.log.some((l) => l.path === '/api/run-send'), draft.slice(0, 160).replace(/\n/g, ' '));
  await shot('05-ask-hermes-draft');
  await tap('#runp button', '^(Send|Add instruction)$');
  check('ask: Send POSTs new run (no run_id)', await waitFor(`1`, 50) && await (async () => { const end = Date.now() + 3000; while (Date.now() < end) { const l = mock.st.log.find((x) => x.path === '/api/run-send'); if (l) return !l.body.run_id && /network security/i.test(l.body.text) && l.ct && /application\/json/.test(l.ct); await sleep(80); } return false; })());
  check('ask: user bubble and agent output appear', await waitFor(`/network security/i.test(document.querySelector('#runo')?.innerText||'')&&/Mock reply \\(new\\)/.test(document.querySelector('#runo')?.innerText||'')`, 8000), (await ev(`document.querySelector('#runo')?.innerText||''`)).slice(0, 200).replace(/\n/g, ' | '));
  await shot('06-run-thread-new');
  // reply to a finished run
  await waitFor(`/DONE/i.test(document.querySelector('#runs')?.innerText||'')`, 6000);
  await typeInto('#runin', 'yes, go ahead and fix it');
  const lbl = await ev(`[...document.querySelectorAll('#runp button')].map(b=>b.innerText.trim()).join('|')`);
  check('reply: button says Send on a finished run', /Send/.test(lbl) && !/Add instruction|Steer/.test(lbl), lbl);
  await tap('#runp button', '^(Send|Add instruction)$');
  check('reply: POST carries run_id of the first run', await (async () => { const end = Date.now() + 3000; while (Date.now() < end) { const ls = mock.st.log.filter((x) => x.path === '/api/run-send'); if (ls.length >= 2) return !!ls[1].body.run_id && /go ahead/.test(ls[1].body.text); await sleep(80); } return false; })());
  check('reply: thread shows both turns', await waitFor(`(()=>{const t=document.querySelector('#runo')?.innerText||'';return /Mock reply \\(new\\)/.test(t)&&/Mock reply \\(reply\\)/.test(t)&&/go ahead/.test(t)})()`, 8000));
  await shot('07-run-thread-reply');
  await ev(`document.querySelector('#runx').click()`);
  await sleep(300);
  check('reply: Close hides the window', !(await ev(`!!document.querySelector('#runp.on')`)));
};

S.steer = async () => {
  await boot(IPHONE_UA, 956, 440, 3);
  await gotoPage('launch');
  await waitFor(`document.querySelectorAll('.lnb').length>0`, 5000);
  await tap('.lnb', 'Hermes');
  await sleep(200);
  await tap('.lnb', 'Tap again');
  check('steer: run window opens after launch', await waitFor(`document.querySelector('#runp.on')`, 4000));
  await typeInto('#runin', 'actually post about the TestFlight build');
  const lbl = await ev(`[...document.querySelectorAll('#runp button')].map(b=>b.innerText.trim()).join('|')`);
  check('steer: button says Add instruction while running', /Add instruction/.test(lbl) && !/Steer/.test(lbl), lbl);
  await shot('08-steer-running');
  await tap('#runp button', '^(Send|Add instruction)$');
  check('steer: POST carries run_id', await (async () => { const end = Date.now() + 3000; while (Date.now() < end) { const l = mock.st.log.filter((x) => x.path === '/api/run-send').pop(); if (l) return !!l.body.run_id; await sleep(80); } return false; })());
  check('steer: line shows in output', await waitFor(`/steer: actually post/.test(document.querySelector('#runo')?.innerText||'')`, 6000));
  await ev(`document.querySelector('#runx').click()`);
};

S.keyboard = async () => {
  // fake VisualViewport: the soft keyboard shrinks it while the layout viewport keeps its height
  const inj = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const t=new EventTarget();Object.assign(t,{height:innerHeight,offsetTop:0,width:innerWidth});window.__vv=t;Object.defineProperty(window,'visualViewport',{value:t,configurable:true})})()` });
  try {
    await boot(IPHONE_UA, 956, 440, 3);
    await gotoPage('crons'); await waitFor(`document.querySelectorAll('.cronrow').length>=8`, 5000);
    await tap('.cronrow', 'network security'); await waitFor(visible('#sheet'), 3000); await tap('#sheet button', 'Ask Hermes');
    check('keyboard: composer open', await waitFor(visible('#runin'), 3000));
    const before = await ev(`(()=>{const r=document.querySelector('#runin').getBoundingClientRect();return {bottom:Math.round(r.bottom),vh:innerHeight}})()`);
    check('keyboard: before, the composer sits at the bottom of the screen', before.bottom > before.vh - 40, JSON.stringify(before));
    await ev(`window.__vv.height=210;window.__vv.dispatchEvent(new Event('resize'))`); await sleep(200);
    const after = await ev(`(()=>{const p=document.querySelector('#runp'),r=document.querySelector('#runin').getBoundingClientRect(),o=document.querySelector('#runo').getBoundingClientRect();return {h:p.style.height,kbd:p.classList.contains('kbd'),inBottom:Math.round(r.bottom),outH:Math.round(o.height),footer:getComputedStyle(document.querySelector('#runf')).display}})()`);
    check('keyboard: window shrinks to the visible 210 px, composer stays inside it, footer hidden', after.h === '210px' && after.kbd && after.inBottom <= 212 && after.footer === 'none' && after.outH >= 40, JSON.stringify(after));
    await shot('16-run-keyboard');
    await ev(`window.__vv.height=440;window.__vv.dispatchEvent(new Event('resize'))`); await sleep(200);
    check('keyboard: closing the keyboard restores the full window', await ev(`document.querySelector('#runp').style.height===''&&!document.querySelector('#runp').classList.contains('kbd')`));
    await ev(`document.querySelector('#runx').click()`);
  } finally { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: inj.identifier }); }
};

S.links = async () => {
  await boot(IPHONE_UA, 956, 440, 3);
  await gotoPage('life');
  check('links: life page renders markets', await waitFor(`document.querySelectorAll('#lf2 .frow').length>=3`, 6000));
  const info = await ev(`(()=>{const rows=[...document.querySelectorAll('#lf2 .frow')].slice(0,3);return rows.map(r=>({tag:r.tagName,href:r.getAttribute('href'),t:r.getAttribute('target'),txt:r.innerText.slice(0,80)}))})()`);
  check('links: markets rows with url are anchors, row without url is not', info[0].tag === 'A' && info[1].tag === 'A' && info[2].tag !== 'A', JSON.stringify(info.map((i) => i.tag + ':' + (i.href || '-'))));
  check('links: link rows show an arrow mark', /\u2197/.test(await ev(`document.querySelector('#lf2 a.frow')?.innerText||''`)) || (await ev(`getComputedStyle(document.querySelector('#lf2 a.frow'),'::after').content`)).includes('\u2197'));
  await shot('09-life-links');
  // iOS shell UA: target is removed before the default action
  await ev(`window.__t=[];document.addEventListener('click',e=>{const a=e.target.closest('a');if(a){window.__t.push(a.getAttribute('target'));e.preventDefault()}},false)`);
  await tap('#lf2 a.frow');
  await sleep(200);
  check('links: iOS app UA removes target=_blank on tap', JSON.stringify(await ev('window.__t')) === '[null]', JSON.stringify(await ev('window.__t')));
  // Pixel UA keeps _blank
  await boot(PIXEL_UA, 908, 411, 2.6);
  await gotoPage('life'); await waitFor(`document.querySelectorAll('#lf2 a.frow').length>0`, 6000);
  await ev(`window.__t=[];document.addEventListener('click',e=>{const a=e.target.closest('a');if(a){window.__t.push(a.getAttribute('target'));e.preventDefault()}},false)`);
  await tap('#lf2 a.frow');
  await sleep(200);
  check('links: non-app UA keeps target=_blank', JSON.stringify(await ev('window.__t')) === '["_blank"]', JSON.stringify(await ev('window.__t')));
};

S.fleet = async () => {
  await boot(IPHONE_UA, 956, 440, 3);
  await gotoPage('fleet');
  // the deck shows unitLabel(): systemd escapes and the .service suffix are plumbing, never on screen
  check('fleet: failing units render', await waitFor(`document.body.innerText.includes('glm-recipes-daily')&&!document.body.innerText.includes('glm-recipes-daily.service')`, 6000), await ev(`(()=>{const t=document.body.innerText,i=t.indexOf('glm-recipes-daily');return 'page='+document.querySelector('#app').dataset.page+' sub='+(document.querySelector('.page[data-name=fleet] .subrow .on')||{}).textContent+' at='+i+' '+(i<0?t.slice(0,200):t.slice(Math.max(0,i-60),i+60)).replace(/\\n/g,' | ')})()`));
  await shot('10-fleet-page');
  await tap('.frow, .tile', 'glm-recipes-daily');
  check('fleet: tap opens sheet', await waitFor(visible('#sheet'), 3000));
  check('fleet: sheet shows journal lines from /api/unit', await waitFor(`/fixture error: example failure line/.test(document.querySelector('#sheet')?.innerText||'')`, 4000), (await ev(`document.querySelector('#sheet')?.innerText||''`)).slice(0, 160).replace(/\n/g, ' | '));
  check('fleet: sheet offers Ask Hermes and no restart', await ev(`(()=>{const t=document.querySelector('#sheet').innerText;return /Ask Hermes/i.test(t)&&!/restart|start now|run again/i.test(t)})()`));
  await shot('11-fleet-unit-sheet');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(250);
  // generic card tap: machine card opens a sheet with its full text
  await tap('.tile.node', 'Spark');
  check('fleet: machine card opens sheet', await waitFor(visible('#sheet'), 3000));
  await shot('12-fleet-card-sheet');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
};

S.cams = async () => {
  await boot(IPHONE_UA, 956, 440, 3);
  await ev(`window.__blob=[];const o=URL.createObjectURL;URL.createObjectURL=function(b){window.__blob.push(b instanceof Blob?String(b.type||'blob'):'mediasource');return o.apply(this,arguments)}`);
  await gotoPage('house');
  check('cams: four tiles exist', await waitFor(`document.querySelectorAll('#cams .cam').length===4`, 5000));
  check('cams: every tile shows an image within 5 s with HLS failing', await waitFor(`[...document.querySelectorAll('#cams .cam img')].every(i=>i.complete&&i.naturalWidth>0)`, 5000), await ev(`[...document.querySelectorAll('#cams .cam img')].map(i=>(i.getAttribute('src')||'none').slice(0,60)).join(' ; ')`));
  const srcs = await ev(`[...document.querySelectorAll('#cams .cam img')].map(i=>i.getAttribute('src')||'')`);
  check('cams: snapshot src is same-origin /api/cam, never blob: or data:', srcs.every((s) => /^\/api\/cam\?/.test(s) || /^http:\/\/127\.0\.0\.1:18890\/api\/cam\?/.test(s)), JSON.stringify(srcs.map((s) => s.slice(0, 40))));
  const blobTypes = await ev('window.__blob');
  check('cams: no image blob: URL is ever created (hls.js MediaSource and worker blobs are not ours)', !blobTypes.some((t) => /^image\//.test(t) || t === 'blob'), 'types=' + JSON.stringify(blobTypes));
  await shot('13-house-cams');
  await sleep(3200);
  const s2 = await ev(`[...document.querySelectorAll('#cams .cam img')].map(i=>i.getAttribute('src')||'')`);
  check('cams: snapshots refresh with a changing counter', s2.some((s, i) => s !== srcs[i]), JSON.stringify(s2.map((s) => s.slice(-12))));
  check('cams: boot beacon reached the server, capped', mock.st.diag.some((d) => d && d.e === 'boot') && mock.st.diag.length <= 40, 'beacons=' + mock.st.diag.length + ' events=' + [...new Set(mock.st.diag.map((d) => d && d.e))].join(','));
  check('cams: beacons carry no URL or token', !JSON.stringify(mock.st.diag).match(/pdeck|token|\?t=|http:\/\//i));
};

S.agents = async () => { // owner feedback 2026-10-07: quick launch agents; a mission opens a message to read, nothing is sent until Send
  await boot(IPHONE_UA, 402, 874, 3);
  const subs = await ev(`[...document.querySelectorAll('.page[data-name="fleet"] .subrow [data-sub]')].map(b=>b.dataset.sub)`);
  check('agents: the Agents sub-tab of Fleet sits right after Launch', subs.indexOf('agents') === subs.indexOf('launch') + 1 && subs.indexOf('launch') >= 0, subs.join(','));
  check('agents: the page opens', await gotoPage('agents'));
  check('agents: seven missions and the target chips draw', await waitFor(`document.querySelectorAll('#agents .agm').length===7&&document.querySelectorAll('#agents .agt').length>=2`, 5000), await ev(`document.querySelector('#agents').innerText.slice(0,200)`));
  const ctx = await ev(`[...document.querySelectorAll('#agents .agc')].slice(0,2).map(e=>e.textContent).join(' | ')`);
  check('agents: the crons mission counts the failing jobs from the schedules feed', /^2 jobs need a look/.test(ctx), ctx);
  const boxes = await ev(`[...document.querySelectorAll('#agents .agm,#agents .agt')].map(b=>{const r=b.getBoundingClientRect();return {h:Math.round(r.height),l:Math.round(r.left),r:Math.round(r.right)}})`);
  check('agents: every button is 44 px tall or more and inside the screen', boxes.length >= 9 && boxes.every((b) => b.h >= 44 && b.l >= 0 && b.r <= 402), JSON.stringify(boxes.filter((b) => b.h < 44 || b.l < 0 || b.r > 402)));
  await shot('20-agents-page');
  await tap('#agents .agm', 'Fix failing crons');
  check('agents: a mission opens the composer', await waitFor(`document.querySelector('#runp.on')&&${visible('#runin')}`, 3000));
  const d = await ev(`document.querySelector('#runin')?.value||''`);
  check('agents: the message names the failing jobs and carries the rules, and nothing is sent yet', /network security/.test(d) && /asc-watch/.test(d) && /never push main/.test(d) && !mock.st.log.some((l) => l.path === '/api/run-send'), d.slice(0, 140).replace(/\n/g, ' '));
  const box = await ev(`(()=>{const t=document.querySelector('#runin'),r=t.getBoundingClientRect();return {h:Math.round(r.height),top:t.scrollTop,focus:document.activeElement===t,inside:r.bottom<=innerHeight&&r.top>=0,chars:t.value.length}})()`);
  check('agents: a long message opens tall, from its first line, keyboard down, inside the screen', box.chars > 300 && box.h >= 200 && box.top === 0 && !box.focus && box.inside, JSON.stringify(box));
  await shot('21-agents-compose');
  await tap('#runp button', '^(Send|Add instruction)$');
  check('agents: Send POSTs one new run with exactly that text', await (async () => { const end = Date.now() + 3000; while (Date.now() < end) { const ls = mock.st.log.filter((x) => x.path === '/api/run-send'); if (ls.length) return ls.length === 1 && !ls[0].body.run_id && ls[0].body.text === d; await sleep(80); } return false; })());
  await ev(`document.querySelector('#runx').click()`); await sleep(300);
  await tap('#agents .agt', '^repo$');
  check('agents: a chosen target is marked and remembered', await waitFor(`document.querySelector('#agents .agt.on')?.dataset.t==='repo'&&localStorage.getItem('agent-target')==='repo'`, 2000));
  await tap('#agents .agm', 'Find bugs');
  await waitFor(`document.querySelector('#runp.on')`, 3000);
  const d2 = await ev(`document.querySelector('#runin')?.value||''`);
  check('agents: the target is in the next message', /^Find bugs in repo\./.test(d2), d2.slice(0, 80));
  await shot('22-agents-target-compose');
  await ev(`document.querySelector('#runx').click()`); await sleep(300);
};

S.spaces = async () => { // owner feedback 2026-10-07: a place to switch workspaces and see the apps on them
  await boot(IPHONE_UA, 402, 874, 3);
  check('spaces: the Keys page draws', await gotoPage('keys'));
  check('spaces: five workspace keys fill in', await waitFor(`document.querySelectorAll('#keys .key[data-ws]').length===5&&[...document.querySelectorAll('#keys .key[data-ws] .ap .af')].every(e=>e.textContent)`, 6000));
  const t = await ev(`[...document.querySelectorAll('#keys .key[data-ws]')].map(b=>b.dataset.ws+':'+b.querySelector('.ap .af').textContent+(b.classList.contains('on')?'*':''))`);
  check('spaces: each key names its apps and the current one is lit', JSON.stringify(t) === JSON.stringify(['1:Chromium +4', '2:Spotify +1*', '3:Empty', '4:Nautilus', '5:Empty']), JSON.stringify(t));
  const names = await ev(`[...document.querySelectorAll('#keys .key[data-ws]')].map(b=>b.getAttribute('aria-label'))`);
  check('spaces: a screen reader gets the whole list', names[0] === 'Workspace 1: Chromium, Ghostty, Firefox and 1 more' && names[1] === 'Workspace 2: Spotify, Obsidian, current', JSON.stringify(names.slice(0, 2)));
  const sz = await ev(`[...document.querySelectorAll('#keys .key')].map(b=>{const r=b.getBoundingClientRect();return Math.round(Math.min(r.width,r.height))})`);
  check('spaces: every key is 44 px or more', sz.length >= 25 && sz.every((x) => x >= 44), sz.join(','));
  await shot('23-keys-spaces');
  for (const [label, arg] of [['Apps', 'apps'], ['Spaces', 'spaces']]) {
    const i = await ev(`keys.findIndex(k=>k.action==='launch'&&k.arg===${JSON.stringify(arg)})`);
    await tap('#keys .key', label + '$');
    check('spaces: the ' + label + ' key asks the server for its own launch', i >= 0 && await (async () => { const end = Date.now() + 3000; while (Date.now() < end) { if (mock.st.log.some((l) => l.path === '/api/key' && l.query.v === String(i))) return true; await sleep(80); } return false; })(), 'index ' + i);
  }
  // The Home Workspaces card is a plain row of five numbered buttons (apps live on the Keys page only); one tap asks the server to go to that workspace.
  await gotoPage('home');
  const home = await ev(`[...document.querySelectorAll('#wsrow button')].map(b=>{const r=b.getBoundingClientRect();return {t:b.textContent.trim(),h:Math.round(r.height),cut:b.scrollWidth>b.clientWidth+1,apps:!!b.querySelector('.ap')}})`);
  check('spaces: the Home card is five numbered buttons, tall enough, no app line', JSON.stringify(home.map((x) => x.t)) === '["1","2","3","4","5"]' && home.every((x) => x.h >= 38 && !x.cut && !x.apps), JSON.stringify(home));
  mock.st.log.length = 0;
  await tap('#wsrow button', '^3$');
  check('spaces: tapping 3 on the Home card asks the server for workspace 3, once', await (async () => { const end = Date.now() + 3000; while (Date.now() < end) { if (mock.st.log.some((l) => /\/ws$/.test(l.path) && l.query.v === '3')) return mock.st.log.filter((l) => /\/ws$/.test(l.path)).length === 1; await sleep(80); } return false; })(), JSON.stringify(mock.st.log.map((l) => l.path + JSON.stringify(l.query))));
  await shot('24-home-workspaces');
  // landscape: 25 keys on one screen make each tile about 58 px wide; the line must switch to the count and never cut a word
  for (const [w, h, name] of [[956, 440, 'landscape phone'], [402, 874, 'portrait phone']]) {
    await boot(IPHONE_UA, w, h, 3); await gotoPage('keys'); await waitFor(`document.querySelectorAll('#keys .key[data-ws] .ap .af')[0]?.textContent`, 5000); await sleep(400);
    const fit = await ev(`[...document.querySelectorAll('#keys .key[data-ws] .ap')].map(a=>{const v=[...a.children].find(c=>getComputedStyle(c).display!=='none');return {t:v?v.textContent:'',cut:a.scrollWidth>a.clientWidth+1,kind:v?v.className:''}})`);
    check('spaces: ' + name + ': no key line is cut', fit.length === 5 && fit.every((x) => x.t && !x.cut), JSON.stringify(fit));
    if (w === 956) check('spaces: landscape phone shows the count form on a narrow tile', fit.every((x) => x.kind === 'ac'), JSON.stringify(fit.map((x) => x.t)));
    else check('spaces: portrait phone shows the names', fit.every((x) => x.kind === 'af'), JSON.stringify(fit.map((x) => x.t)));
    if (w === 956) await shot('25-keys-spaces-landscape');
    await gotoPage('home'); await sleep(400);
    const hf = await ev(`[...document.querySelectorAll('#wsrow button')].map(b=>{const r=b.getBoundingClientRect();return {t:b.textContent.trim(),w:Math.round(r.width),h:Math.round(r.height),cut:b.scrollWidth>b.clientWidth+1}})`);
    check('spaces: ' + name + ': no Home workspace button is cut and each is at least 38 px', hf.length === 5 && hf.every((x) => x.t && !x.cut && x.w >= 38 && x.h >= 38), JSON.stringify(hf));
    if (w === 956) await shot('26-home-workspaces-landscape');
  }
};

S.sweep = async () => {
  for (const [name, w, h, d, m, ua] of [['landscape', 956, 440, 3, true, IPHONE_UA], ['portrait', 440, 956, 3, true, IPHONE_UA], ['pixel', 908, 411, 2.6, true, PIXEL_UA]]) {
    await boot(ua, w, h, d, m);
    const tabs = await ev(`[...document.querySelectorAll('#pgs button')].map(b=>b.dataset.n)`);
    const subs = await ev(`[...document.querySelectorAll('.page .subrow [data-sub]')].map(b=>b.closest('.page').dataset.name+'/'+b.dataset.sub)`);
    const names = [...tabs, ...subs.map((s) => s.split('/')[1])]; let opened = 0;
    for (const n of names) { if (await gotoPage(n)) opened++; await sleep(500); await shot('sweep-' + name + '-' + n.replace('/', '-')); }
    check('sweep ' + name + ': all ' + tabs.length + ' tabs and ' + subs.length + ' sub-tabs open', tabs.length >= 9 && subs.length >= 9 && opened === names.length, opened + '/' + names.length + ' opened; ' + tabs.join(',') + ' | ' + subs.join(','));
  }
  await boot(IPHONE_UA, 956, 440, 3);
  await gotoPage('crons'); await waitFor(`document.querySelectorAll('.cronrow').length>=8`, 5000);
  await tap('.cronrow', 'engagement watch'); await waitFor(visible('#sheet'), 3000); await shot('14-cron-sheet-landscape');
  const fits = await ev(`(()=>{const s=document.querySelector('#sheet');const r=s.getBoundingClientRect();return {h:Math.round(r.height),w:Math.round(r.width),vh:innerHeight,vw:innerWidth,overflow:r.bottom>innerHeight+1||r.right>innerWidth+1}})()`);
  check('sheet fits the 956x440 viewport', !fits.overflow, JSON.stringify(fits));
  const btn = await ev(`[...document.querySelectorAll('#sheet button')].map(b=>{const r=b.getBoundingClientRect();return Math.round(r.height)})`);
  check('sheet buttons are at least 44 px tall', btn.length > 0 && btn.every((h) => h >= 43), JSON.stringify(btn));
  await boot(IPHONE_UA, 440, 956, 3);
  await gotoPage('crons'); await waitFor(`document.querySelectorAll('.cronrow').length>=8`, 5000);
  await tap('.cronrow', 'engagement watch'); await waitFor(visible('#sheet'), 3000); await shot('15-cron-sheet-portrait');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
};

try {
  const browserArgs = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + CDP, '--user-data-dir=/home/sbx/.cache/mock-deck-pages-check-' + Date.now(), 'about:blank'];
  browser = spawn('/usr/bin/chromium', browserArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(Error('Chromium readiness timeout')), 20000); browser.stderr.on('data', (b) => { if (b.toString().includes('DevTools listening')) { clearTimeout(t); resolve(); } }); browser.on('exit', (c) => { clearTimeout(t); reject(Error('Chromium exited ' + c)); }); });
  const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const target = targets.find((t) => t.type === 'page'); if (!target) throw Error('no page target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  ws.addEventListener('message', (e) => { const r = JSON.parse(e.data); if (r.id && pending.has(r.id)) { const p = pending.get(r.id); pending.delete(r.id); clearTimeout(p.timer); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result || {}); }
    if (r.method === 'Runtime.exceptionThrown') errors.push((r.params.exceptionDetails.exception?.description || r.params.exceptionDetails.text || '').split('\n')[0].slice(0, 200));
    if (r.method === 'Log.entryAdded' && r.params.entry.level === 'error' && !/\/cam\/|favicon|manifest|\/pad\?target/.test(r.params.entry.url || '') && !/\/pad\?target|\/cam\//.test(r.params.entry.text || '')) consoleErrors.push((r.params.entry.text || '').slice(0, 160) + ' ' + (r.params.entry.url || '')); });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');
  const names = Object.keys(S).filter((k) => !only.length || only.includes(k));
  for (const n of names) {
    console.log('--- scenario ' + n);
    mock.st.log.length = 0; mock.st.diag.length = 0;
    try { await S[n](); } catch (e) { check('scenario ' + n + ' ran to the end', false, String(e).slice(0, 300)); }
  }
  check('no uncaught page exceptions', errors.length === 0, errors.slice(0, 3).join(' || '));
  check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '));
} catch (e) { console.error('HARNESS ERROR', String(e)); results.push({ name: 'harness', ok: false, detail: String(e) }); }
finally {
  try { ws?.close(); } catch {}
  try { browser?.kill('SIGTERM'); } catch {}
  mock.close();
  const bad = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\nRESULT ${results.length - bad.length}/${results.length} passed (${which}) out=${OUT}`);
  process.exitCode = bad.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
}
