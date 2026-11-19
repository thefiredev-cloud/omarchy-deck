// ---- burn-in guard timings (ms). Test override: #t=<dimSec>,<ambientSec> in the URL hash ----
const DIM_MS=2*60*1000, AMBIENT_MS=10*60*1000, DRIFT_MS=60*1000, SHIFT_MS=3*60*1000, DIM_OPACITY=0.35, SHIFT_MAX_PX=3;
// the address is cleared at once (a ?t= token never stays on screen); the boot route writes the page back as /?p=<route> (F3, ShellRoute)
const HASH=location.hash,SEARCH=location.search;history.replaceState(null,'','/');
// TV view is opt-in (owner rule 2026-09-29): ?view=tv or the stored switch localStorage view=tv; ?view=std clears it. Never automatic.
{const v=new URLSearchParams(SEARCH).get('view');try{if(v==='tv')localStorage.setItem('view','tv');else if(v==='std')localStorage.removeItem('view')}catch(e){}
 let on=false;try{on=localStorage.getItem('view')==='tv'}catch(e){}document.documentElement.classList.toggle('tv',on)}
// ?p=<page> or ?p=<page>/<sub> opens one page on load (a link, a reload, a screenshot script); no query keeps the remembered page (ShellRoute.boot).
const _t=(HASH.match(/t=(\d+),(\d+)/)||[]);
const T_DIM=_t[1]?+_t[1]*1000:DIM_MS, T_AMB=_t[2]?+_t[2]*1000:AMBIENT_MS;
let booted=false,host=localStorage.getItem('host')||'pc-desktop',busy=0,page=0,keys=[],lastMedia={},ws=null,lastWs=null;
const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
// Guest deck (owner 2026-10-13): GET /api/whoami names the principal behind the cookie. A guest sees Home (the house part only) and Pad. Keys is a
// chip on Pad. This is cosmetic: the server's guest allowlist is the control.
// Role (item 9, decision 11): whoami never blocks first paint. The role stored from its last answer builds the pager and chooses only the first
// page (owner: the stored page, guest: House, none: the bar alone); the tabs stay hidden and no read leaves (q, pageVisible) until whoami
// answers. A different answer stores the new role, fires deck:role (the read guard forgets every kept answer) and, when the pager was built
// for the other role, reloads once (a guest lands on House). No answer in 6 s: the stored role's tabs with Offline in the bar, or with no
// stored role "Offline · Try again"; whoami is asked again on online and every 30 s until it answers. ShellCore.rolePlan decides.
const GUEST_PAGES=['home','pad'];
const ROLE=(()=>{let s='';try{s=localStorage.getItem('role')||''}catch(e){}s=s==='owner'||s==='guest'?s:'';let go=null;
 return {stored:s,known:false,offline:false,ready:new Promise(r=>{go=r}),open:()=>{if(go){go();go=null}}}})();
let GUEST=ROLE.stored==='guest';
function guestMode(){document.documentElement.classList.add('guest');$$('#pager>.page').forEach(p=>{if(!GUEST_PAGES.includes(p.dataset.name)){p.hidden=true;p.dataset.off='1'}});$$('#pg-home>.sub:not([data-sub=house]),#pg-home .subrow [data-sub]:not([data-sub=house])').forEach(e=>{e.hidden=true;e.dataset.off='1'});$$('#ptg [data-t=mini]').forEach(b=>b.remove())}
if(GUEST)guestMode();
// One call to the deck API for the host controls and readouts (C5): no call leaves before the role is known, each is bounded at 11 s (above
// the server's own 10 s to the host, main.rs, so an answer that worked is never called a failure) and none throws. The answer's JSON when the
// server said yes, else {error, failed:true, offline} (ShellCore.callResult); a caller that was tapped says a failure on the control (tapFail).
const Q_MS=11000;
async function q(p,post){await ROLE.ready;const ac=typeof AbortController==='function'?new AbortController():null;let late=false;
 const t=setTimeout(()=>{late=true;if(ac)ac.abort()},Q_MS);
 try{const r=await fetch('/api/'+p+(p.includes('?')?'&':'?')+'host='+encodeURIComponent(host),{method:post?'POST':'GET',credentials:'same-origin',signal:ac?ac.signal:undefined});
  let body=null;try{body=await r.json()}catch(e){}return ShellCore.callResult({status:r.status,body})}
 catch(e){return ShellCore.callResult({threw:true,timeout:late})}
 finally{clearTimeout(t)}}
// one call per control at a time: a tap while that control's call is out sends nothing (a second toggle of Lock, mute or play-pause would undo
// the first) and the control shows it waits (data-wait, ui.css) until the answer
async function oneCall(b,fn){if(!b||b.dataset.wait)return;b.dataset.wait='1';b.setAttribute('aria-busy','true');try{await fn()}finally{delete b.dataset.wait;b.removeAttribute('aria-busy')}}
const other=()=>host=='pc-desktop'?'Dell':'pc-desktop';
// one name per machine on every control (the server ids stay pc-desktop and Dell)
const HOSTNAME={'pc-desktop':'PC',Dell:'Dell'},hostName=h=>HOSTNAME[h]||h;
const esc=DeckCore.esc; // the one escape (static/ui-core.js): & < > " and '
// Haptics (shell contract 3): the iOS shell registers `deckHaptic`; in every other browser this does nothing.
// style: selection | light | medium | success | warning | error. The shell ignores unknown styles and rate-limits itself.
function haptic(style){try{window.webkit?.messageHandlers?.deckHaptic?.postMessage({style})}catch(e){}}
window.deckHaptic=haptic;
const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
let wxText='',errText='',errMsg='',wxParts=[],SVC=null;// SVC: the shell services (ShellServices below), made before the first route
// the bar's status slot: one mark and one word ("Not sent", "Offline"); the whole message opens in the Status sheet (ShellServices.slot)
function showSt(){if(!SVC)return;const st=$('#st'),box=$('#status'),mk=box.querySelector('.sd'),s=SVC.slot(stParts());
 st.textContent=s.word;box.className=s.k;if(mk)mk.className='sd'+(s.k?' '+s.k:'');box.title=s.title;box.setAttribute('aria-label',s.label);if(!s.k)fitSt()}
const stParts=()=>({offline:errText==='offline',err:errText==='offline'?'':errText,weather:wxText});
// weather never truncates: drop trailing parts whole, then the text itself; nothing is ever cut mid-word
function fitSt(){const st=$('#st');if(!wxParts.length)return;let parts=wxParts.slice();const put=()=>{st.textContent=parts.join(' \u00B7 ')};
 put();const over=()=>st.scrollWidth>st.clientWidth+1;
 while(over()&&parts.length>1){parts=parts.slice(0,-1);put()}
 if(over())st.textContent=''}
function flag(r){errMsg=(r&&r.error)?(typeof DeckUI==='object'?DeckUI.humanErr(r,0).split('. ')[0]:'That did not go through'):'';errText=errMsg?hostName(host)+': '+errMsg:'';showSt()}
// C5: a failed tap says so where the thumb is for 4 s, then the control is itself again. A control with a text label reads the words in that
// label when they fit it (the control's box keeps its size and nothing overflows); any other control gets one note pinned beside it
// (ShellCore.notePlace: above, below at the top edge, never over it, whole inside the window, fixed so nothing moves; .tapnote in ui.css).
// One at a time: a second failure replaces the first. The failure also goes to /api/client-error (guard.js deckReport); a guest never posts.
const TAP_MS=4000;let tapNow=null;
function tapEnd(){const t=tapNow;tapNow=null;if(!t)return;clearTimeout(t.timer);if(t.note)t.note.remove();
 if(t.lb&&t.lb.textContent===ShellCore.TAP_WORDS)t.lb.textContent=t.was}
// the control's own words: its .lb or a direct span, else its last direct text ("Terminal" beside an icon); none on an icon or a number
const hasWords=n=>!!n&&/[A-Za-z]{3}/.test(n.textContent||'');
function tapLabel(b){const l=b.querySelector('.lb')||b.querySelector(':scope>span');if(hasWords(l))return l;
 return [...(b.childNodes||[])].reverse().find(n=>n.nodeType===3&&hasWords(n))||null}
function tapFail(b,r,path){try{if(typeof deckReport==='function')deckReport('error','',{msg:'tap '+String(path||'').split('?')[0]+': '+String(r&&r.error||'failed')})}catch(e){}
 tapEnd();if(!b||!b.isConnected)return;const t={timer:0,note:null,lb:tapLabel(b),was:''};
 if(t.lb){const r0=b.getBoundingClientRect();t.was=t.lb.textContent;t.lb.textContent=ShellCore.TAP_WORDS;const r1=b.getBoundingClientRect();
  if(Math.abs(r1.width-r0.width)>0.5||Math.abs(r1.height-r0.height)>0.5||b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1){t.lb.textContent=t.was;t.lb=null}}
 if(!t.lb){const n=document.createElement('div');n.className='tapnote';n.setAttribute('role','status');n.textContent=ShellCore.TAP_WORDS;n.style.visibility='hidden';document.body.appendChild(n);
  const c=b.getBoundingClientRect(),p=ShellCore.notePlace({left:c.left,top:c.top,width:c.width,height:c.height},{w:n.offsetWidth,h:n.offsetHeight},{w:innerWidth,h:innerHeight});
  n.style.left=p.left+'px';n.style.top=p.top+'px';n.style.visibility='';t.note=n}
 haptic('error');tapNow=t;t.timer=setTimeout(tapEnd,TAP_MS)}
// House (Home's first sub), the Keys sub page and Pad show the host readouts (media, volume, workspaces); no other page polls them
const hostPage=()=>pname()==='pad'||onHouse();
function setHost(h){host=h;localStorage.setItem('host',h);$$('#hosts button').forEach(b=>b.classList.toggle('on',b.dataset.h==h));$('#swapl').textContent=hostName(other());booted=true;lastWs=null;if(hostPage()){refresh();if(onHouse())stats()}}
$$('#hosts button').forEach(b=>b.onclick=()=>setHost(b.dataset.h));
$('#swap').onclick=()=>setHost(other());
$$('button[data-a]').forEach(b=>b.onclick=()=>oneCall(b,async()=>{const p=b.dataset.a+'?v='+(b.dataset.v||''),r=await q(p,1);flag(r);if(r.failed)tapFail(b,r,p);refresh()}));
$('#lock').onclick=()=>{const l=$('#lock');if(l.dataset.wait)return;if(l.dataset.arm){delete l.dataset.arm;l.classList.remove('armed');l.querySelector('span').textContent='Lock';oneCall(l,async()=>{const r=await q('lock',1);flag(r);if(r.failed)tapFail(l,r,'lock')})}else{l.dataset.arm=1;l.classList.add('armed');l.querySelector('span').textContent='Tap again';setTimeout(()=>{delete l.dataset.arm;l.classList.remove('armed');l.querySelector('span').textContent='Lock'},3000)}};
// volume (home + focus sliders)
function showVol(v){$('#vs').value=v;$('#vs').style.setProperty('--p',v+'%');$('#vp').textContent=v+'%'}
// the level shows only once the server said yes (a dragged slider shows the thumb while it moves); a refused set goes back to the last level the
// server reported and the control that asked says so
let volNow=null;
function setVol(v,from){v=Math.max(0,Math.min(100,v));const go=async()=>{busy=Date.now();const r=await q('vol-set?v='+v,1);busy=Date.now();flag(r);
 if(r.failed){if(volNow!=null)showVol(volNow);tapFail(from||$('#vs'),r,'vol-set')}else{volNow=v;showVol(v)}};return from&&from.tagName==='BUTTON'?oneCall(from,go):go()}
{const s='#vs';$(s).oninput=()=>{busy=Date.now();showVol($(s).value)};$(s).onchange=()=>setVol(+$(s).value,$(s))}
$('#vdn').onclick=()=>setVol(+$('#vs').value-5,$('#vdn'));$('#vup').onclick=()=>setVol(+$('#vs').value+5,$('#vup'));
// presets: one tap to a common level instead of holding + or dragging the slider
$$('#volp button').forEach(b=>b.onclick=()=>setVol(+b.dataset.v,b));
// Workspaces: one row of numbers; the chip picks go-to or move-window. A tap is always a tap, the deck
// never switches workspace by itself and never touches workspace 1 on its own.
let wsMode=localStorage.getItem('ws-mode')=='move'?'move':'go';
function paintWsMode(){const b=$('#wsmd');if(!b)return;b.textContent=wsMode=='move'?'move':'go';$('#cc').classList.toggle('move',wsMode=='move');
 b.setAttribute('aria-label','Workspace buttons: '+(wsMode=='move'?'move the focused window':'switch workspace')+'. Tap to change.')}
$('#wsmd').onclick=()=>{wsMode=wsMode=='move'?'go':'move';localStorage.setItem('ws-mode',wsMode);paintWsMode()};
$('#wsrow').addEventListener('click',async e=>{const b=e.target.closest('button[data-n]');if(!b)return;
 oneCall(b,async()=>{const p=(wsMode=='move'?'mvws':'ws')+'?v='+b.dataset.n,r=await q(p,1);flag(r);if(r.failed)tapFail(b,r,p);setTimeout(refresh,400)})});
paintWsMode();
// ---- refresh (media, vol, ws-now) ----
function fmtSt(m){return m.player?(m.player+(m.status&&m.status!='Playing'?' · '+m.status.toLowerCase():'')):''}
// transport and mute are drawn icons, never colour emoji (they follow the text colour and the theme); innerHTML is rewritten only when the state changes
const IC=p=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+p+'</svg>';
const ICON_PLAY=IC('<path d="M7 4.8v14.4c0 .9 1 1.4 1.7.9l10.8-7.2c.6-.4.6-1.4 0-1.8L8.7 3.9C8 3.4 7 3.9 7 4.8z" fill="currentColor"/>');
const ICON_PAUSE=IC('<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor"/>');
const ICON_MUTE=IC('<path d="M4 9.5h3.5L12 5.8v12.4l-4.5-3.7H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>');
const ICON_SOUND=IC('<path d="M4 9.5h3.5L12 5.8v12.4l-4.5-3.7H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 010 6M18 6.8a7.5 7.5 0 010 10.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>');
let ppKey='',muteKey='';
// ==== SPACES UI HELPERS BEGIN (pure: no DOM, no fetch; tests/spaces_ui.test.js loads this block) ====
// Workspaces 1 to 5 with the apps open on each (GET /api/ws-list, window classes only, never a title). Anything off-shape reads as empty, never as a guess.
const SpacesUI=(()=>{
 const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const cnt=v=>Number.isInteger(v)&&v>=0?Math.min(v,99):0;
 const norm=w=>{const o=isObj(w)?w:{};return {n:cnt(o.n),apps:(Array.isArray(o.apps)?o.apps:[]).filter(a=>typeof a==='string'&&/^[A-Za-z0-9][A-Za-z0-9 .+]{0,19}$/.test(a)).slice(0,3),more:cnt(o.more)}};
 const parse=j=>{const ws={};if(!isObj(j)||j.ok!==true||!Array.isArray(j.ws))return {ok:false,active:null,ws,other:norm(null)};
  for(const w of j.ws){if(!isObj(w)||!Number.isInteger(w.id)||w.id<1||w.id>5)continue;ws[w.id]=norm(w)}
  return {ok:true,active:Number.isInteger(j.active)&&j.active>=1&&j.active<=5?j.active:null,ws,other:norm(j.other)}};
 // the tile line: the first app and how many windows are open besides it ("Chromium +4"), "Empty" for none, nothing while unknown
 const tile=w=>!w?'':!w.n?'Empty':(w.apps[0]||'Window')+(w.n>1?' +'+(w.n-1):'');
 // the same tile when it is too narrow for a name (landscape, 25 keys on one screen): a count, never a cut word ("5 open")
 const short=w=>!w?'':!w.n?'Empty':w.n+' open';
 // the whole list for a screen reader and the long press title
 const full=(id,w,on)=>'Workspace '+id+(!w?'':!w.n?', empty':': '+(w.apps.length?w.apps.join(', ')+(w.more?' and '+w.more+' more':''):w.n+' windows'))+(on?', current':'');
 return {parse,norm,tile,short,full};
})();
// ==== SPACES UI HELPERS END ====
// every workspace button (Home card and Keys tab) shows the apps on it and which one you are on. A Keys button's spoken name holds the
// words on the key in the order the eye reads them, then the whole list ("1 WS 1, Chromium +1, Workspace 1: Chromium, Ghostty").
// A narrow key (a phone in landscape, the TV) shows the count line instead ("5 open", css/pad.css container query), so the name takes
// the line on screen; it is read again when the Keys page shows and after a resize.
let spacesSeen=null; // the last [ws-list answer, ws-now id], so keys drawn later show the apps at once
const spaceLine=(b,w)=>{const ac=b.querySelector('.ap .ac');return ac&&getComputedStyle(ac).display!=='none'?SpacesUI.short(w):SpacesUI.tile(w)};
function paintSpaces(j,fallbackActive){spacesSeen=[j,fallbackActive];const p=SpacesUI.parse(j),active=p.ok?p.active:(Number.isInteger(fallbackActive)?fallbackActive:null);
 $$('[data-a=ws],[data-ws]').forEach(b=>{const id=+(b.dataset.v||b.dataset.ws),w=p.ok?(p.ws[id]||SpacesUI.norm(null)):null,on=active===id,full=SpacesUI.full(id,w,on),say=b.dataset.say,line=say?spaceLine(b,w):'';
  b.classList.toggle('on',on);b.setAttribute('aria-label',say?say+(line?', '+line:'')+', '+full:full);b.title=full;
  const af=b.querySelector('.ap .af'),ac=b.querySelector('.ap .ac');if(af&&af.textContent!==SpacesUI.tile(w))af.textContent=SpacesUI.tile(w);if(ac&&ac.textContent!==SpacesUI.short(w))ac.textContent=SpacesUI.short(w)})}
async function refresh(){
 try{
 const [m,v,w,wl]=await Promise.all([q('media'),q('vol'),q('ws-now'),q('ws-list')]);if(m.offline){errText='offline';errMsg='';showSt();return}flag(m.error?m:null);lastMedia=m;
 const t=m.title||(m.error?'Unreachable':'Nothing playing'),playing=!!m.title;
 $('#title').textContent=t;$('#artist').textContent=m.artist||'';$('#pl').textContent=fmtSt(m);
 {const ns=$('#npstate'),w=m.error?'Unreachable':!playing?'Idle':m.status&&m.status!='Playing'?'Paused':'Playing';if(ns.textContent!==w)ns.textContent=w;ns.classList.toggle('on',w==='Playing')}
  {const k=m.status=='Playing'?'pause':'play';if(ppKey!==k){ppKey=k;$('#pp').innerHTML=k==='pause'?ICON_PAUSE:ICON_PLAY}}
 $('#np').classList.toggle('idle',!playing);
 {const a=artSrc(m.art,location.origin),im=$('#art');if(a&&playing){im.src=a;im.hidden=false}else im.hidden=true}
 $('#ambtrk').textContent=playing?(m.title+(m.artist?' \u00B7 '+m.artist:'')):'';
 if(v.volume!=null){volNow=v.volume;if(Date.now()-busy>3000)showVol(v.volume)}
 {const k=v.muted?'sound':'mute';if(muteKey!==k){muteKey=k;$('#mute').innerHTML=k==='sound'?ICON_SOUND:ICON_MUTE}}$('#mute').classList.toggle('on',!!v.muted);
 ws=w.ws;paintSpaces(wl,w.ws);
 ctx();
}catch(e){errText='offline';errMsg='';showSt()}
}
// Focus mode removed by owner request 2026-09-29. No automatic layout switching. ctx() is a no-op kept for callers.
function ctx(){}
// a workspace key is named again after a resize and when Pad > Keys shows, so its name holds the apps line on screen (paintSpaces)
{let t=0;const again=()=>{t=0;if(spacesSeen)paintSpaces(spacesSeen[0],spacesSeen[1])};
 addEventListener('resize',()=>{if(!t)t=requestAnimationFrame(again)});
 document.addEventListener('deck:route',e=>{if(e.detail&&e.detail.route==='pad/keys')again()})}
// ---- stats ----
// the readings strip (House row 1, #hrd): CPU, RAM and GPU of the chosen host, one figure each (HouseUI.readings); a missing one says No reading
async function stats(){try{const s=await q('stats');
 HouseUI.readings(s).forEach(o=>{const el=$('#'+o.id);if(el)el.innerHTML=HouseUI.readTile(o)});
 const r=$('#hrd');if(r)r.setAttribute('aria-label',hostName(host)+' readings');
}catch(e){}}
async function wx(){try{const raw=String((await fetch('/api/weather').then(r=>r.json())).text||'');
 wxParts=raw.split('\u00B7').map(x=>x.trim().replace(/^Temp\s+/,'').replace(/Wind\s*(\S+?)\s*(\d+)\s*mph/,'Wind $1 $2 mph').replace(/\s{2,}/g,' ')).filter(Boolean);wxText=wxParts.join(' \u00B7 ');showSt()}catch(e){}}
// the date beside the clock ("Sun, Nov 15"): made once before #clock; css/home.css shows it on D and XL only, where the rail foot has room
const tdate=(()=>{const c=$('#clock');if(!c||typeof c.before!=='function')return null;const d=document.createElement('time');d.id='tdate';c.before(d);return d})();
function clock(){const d=new Date(),t=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});$('#clock').textContent=t;$('#ambclock').textContent=t;
 if(tdate)tdate.textContent=d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}
// Fullscreen and orientation lock exist on the Pixel (Brave/Chrome) but not on iPhone Safari. The iPhone home-screen app and the
// OmarchyDeck shell are already full screen, and the shell keeps its own control in the top-right corner (--shell-reserve-top-right):
// there the button hides and nothing is requested.
const IN_SHELL=/OmarchyDeck\//.test(navigator.userAgent||'');
const canFS=!IN_SHELL&&!!(document.fullscreenEnabled&&document.documentElement.requestFullscreen);
if(!canFS)document.documentElement.classList.add('nofs');
async function goFull(){if(!canFS)return;try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen({navigationUI:'hide'});if(screen.orientation&&screen.orientation.lock)await screen.orientation.lock('landscape')}catch(e){}}
$('#fs').onclick=()=>document.fullscreenElement?document.exitFullscreen():goFull();
if(canFS)document.addEventListener('pointerdown',()=>{if(!document.fullscreenElement&&!localStorage.getItem('nofs'))goFull()},{once:true});
// ---- secure context + wake lock ----
let wl=null;
async function wake(){try{if(window.isSecureContext&&navigator.wakeLock&&!document.hidden&&(!wl||wl.released)){wl=await navigator.wakeLock.request('screen');wl.addEventListener('release',()=>{wl=null})}}catch(e){}}
document.addEventListener('visibilitychange',()=>{syncCameras();if(document.hidden){saveScroll();if(SVC)SVC.onHidden();return}wl=null;wake();pageVisible();if(swReg)swReg.update().catch(()=>{})});
// ==== SHELL UPDATE BEGIN (mechanism A; tests/shell_reload.test.js runs this block with fakes) ====
// The server stamps sw.js from the bytes it caches, so every merged shell change brings a new worker, and that worker
// waits (sw.js). applyShell() lets it in and reloads only when ShellCore.reloadOk says the reader is idle. It runs on a
// new waiting worker (also one found at boot), on hide, on a route change, on a sheet or dialog close and every 15 s
// (a cheap check, so a quiet minute is caught within 15 s of its end).
// The browser checks sw.js on each load and return (updateViaCache none); update() also runs hourly in every mode and
// on online, so the wall Pixel, which never hides, finds a new shell within the hour.
let swReg=null;
const SHU={since:0,due:false,done:false,acted:false,seen:Date.now(),boot:Date.now(),typed:new Map()};
// a search filter (type=search: Crons, Launch, Keys, Residential) keeps its value after it applies, so it holds the shell only while it has focus
function shellState(){const now=Date.now(),fs=[];
 SHU.typed.forEach((v,el)=>{const box=el.closest&&el.closest('#runp,#sheet,#viewer,dialog'),open=!box||(box.tagName==='DIALOG'?box.open:box.classList.contains('on'));
  if(!el.isConnected||!open||el.value!==v||el.value===''||(el.type==='search'&&document.activeElement!==el)){SHU.typed.delete(el);return}fs.push({value:el.value,typed:v,open:true})});
 return {hidden:document.hidden,mode,route:SH.route,idleMs:now-SHU.seen,waitMs:SHU.since?now-SHU.since:0,modal:modalOpen(),viewer:vOpen,
  playing:mediaPlaying(),typed:ShellCore.typedBusy(fs),fresh:now-SHU.boot<5000&&!SHU.acted}}
// a cam on screen: a video that plays (a House tile, the viewer) or a live cam frame on Surf (pages/surf.js adds iframe.sf-camf while it plays)
function mediaPlaying(){return !!document.querySelector('iframe.sf-camf')||[...document.querySelectorAll('video')].some(v=>v.isConnected&&!v.paused&&!v.ended)}
// the burn-in mode rides the reload, so a Pixel reloaded in ambient comes back in ambient (see the boot line at the end)
function keepMode(){try{sessionStorage.setItem('shell:mode',mode)}catch(e){}}
function applyShell(){const w=swReg&&swReg.waiting;if(SHU.done||(!SHU.due&&!w))return;if(!SHU.since)SHU.since=Date.now();
 let s=null;try{s=shellState()}catch(e){}if(!ShellCore.reloadOk(s))return;
 if(SHU.due){SHU.done=true;keepMode();location.reload()}else w.postMessage('skip')}
if('serviceWorker' in navigator&&window.isSecureContext){const sw=navigator.serviceWorker;let ctl=sw.controller;
 const watch=r=>{const i=r.installing;if(i)i.addEventListener('statechange',()=>{if(i.state==='installed')applyShell()})};
 sw.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(r=>{swReg=r;r.addEventListener('updatefound',()=>watch(r));watch(r);applyShell()}).catch(()=>{});
 // a new worker took over (this page sent skip, or another tab did): reload under the same test, else at the next idle moment;
 // a page the first worker just claimed was loaded from the network and needs no reload
 sw.addEventListener('controllerchange',()=>{const was=ctl;ctl=sw.controller;if(!was)return;SHU.due=true;applyShell()});
 // activity: pointer, touch, key, wheel and scroll (a reader scrolling with the wheel is reading); a page's own scroll is not an act
 for(const t of ['pointerdown','touchstart','keydown','wheel','scroll'])document.addEventListener(t,()=>{SHU.seen=Date.now();if(t!=='scroll')SHU.acted=true},{capture:true,passive:true});
 document.addEventListener('input',e=>{const t=e.target;if(t&&(t.tagName==='TEXTAREA'||(t.tagName==='INPUT'&&/^(text|search|email|url|tel|number|password)$/.test(t.type))))SHU.typed.set(t,t.value)},true);
 // on hide, after the pages' own listeners have run (the Surf cam stops on hide), so a stopped cam no longer holds the shell
 document.addEventListener('visibilitychange',()=>setTimeout(applyShell,0));document.addEventListener('deck:route',applyShell);document.addEventListener('close',applyShell,true);
 const check=()=>{if(swReg)swReg.update().catch(()=>{})};
 setInterval(applyShell,15000);setInterval(check,3600000);addEventListener('online',check)}
// ==== SHELL UPDATE END ====
// ---- shell (design v3): nine tabs from the <section class="page"> order in index.html, sub-pages from their .sub[data-sub].
// A route is 'tab' or 'tab/sub' (UiApi 1.1). The document is the one scroller; a page shows by un-hiding its section. ----
// ==== SHELL CORE BEGIN (pure: no DOM; tests/shell_core.test.js loads this block) ====
const ShellCore=(()=>{
 const TABS=['today','world','home','realestate','surf','shop','money','work','pad'];
 const SUBS={home:['house','fleet','cluster','dev','crons','launch'],realestate:['residential','commercial','markets'],shop:['market','orders'],money:['accounts','markets'],work:['jobs','gigs'],pad:['pad','keys']};
 // old ?p= values, PAGE_OLD names and stored page names (PageBlueprints 1.1)
 const OLD={housing:'realestate/residential','markets/housing':'realestate/residential',commercial:'realestate/commercial','markets/commercial':'realestate/commercial',
  markets:'money/markets','markets/markets':'money/markets',invest:'money/markets','money/money':'money/accounts',
  allcrons:'home/crons?f=all','home/allcrons':'home/crons?f=all',schedules:'home/crons?f=all','home/schedules':'home/crons?f=all',crons:'home/crons',
  agents:'home/launch#missions','home/agents':'home/launch#missions',commerce:'shop/orders','shop/commerce':'shop/orders','shop/shop':'shop/market',
  life:'work/jobs','life/life':'work/jobs','life/jobs':'work/jobs',jobs:'work/jobs',gigs:'work/gigs','life/gigs':'work/gigs',
  house:'home/house','home/home':'home/house',fleet:'home/fleet',cluster:'home/cluster',dev:'home/dev',launch:'home/launch',keys:'pad/keys'};
 // the old page a new route paints with until its lane registers the route (DeckPages lookup misses it by name)
 const LEGACY={'home/house':'home','realestate/residential':'housing','shop/market':'shop','shop/orders':'commerce','money/accounts':'money','work/jobs':'life'};
 // a route for any old or new name; '' for something that names no page
 function redirect(raw){const s=String(raw==null?'':raw).trim().replace(/^[#/]+/,'').toLowerCase();if(!s)return '';
  const q=s.indexOf('?'),path=(q<0?s:s.slice(0,q)).replace(/\/+$/,''),rest=q<0?'':s.slice(q);
  if(OLD[path])return /[?#]/.test(OLD[path])?OLD[path]:OLD[path]+rest;
  const parts=path.split('/'),t=parts[0],sub=parts[1]||'';if(!TABS.includes(t))return '';
  return (sub&&(SUBS[t]||[]).includes(sub)?t+'/'+sub:t)+rest}
 // device class from width, height and the TV switch, never orientation (PageBlueprints 1.2)
 function classOf(w,h,tv){return tv?'TV':w<600?'P':h<500?'L':w<1100?'T':w>=1600?'XL':'D'}
 // the document title for a route's words ("Surf · Deck", "Real estate · Residential · Deck"): a sub named like its tab says it once (SeeAccess A3)
 function pageTitle(parts){const p=[];for(const x of parts||[]){const s=String(x==null?'':x).trim();if(s&&p[p.length-1]!==s)p.push(s)}p.push('Deck');return p.join(' \u00B7 ')}
 // a page swipe on P and L: horizontal, dominant, at least 60 px. 1 next tab, -1 previous, 0 none
 function swipe(dx,dy){return Math.abs(dx)>=60&&Math.abs(dx)>1.5*Math.abs(dy)?(dx<0?1:-1):0}
 // the next route for a step through tabs (d=±1) or subs, clamped at the ends (no wrap: a swipe past Pad does nothing)
 function step(list,cur,d){const i=list.indexOf(cur),j=i<0?-1:i+d;return j>=0&&j<list.length?list[j]:''}
 // D keyboard map (DESIGN-v3 5): [ ] tab, { } sub-tab, 1-9 jump, / search, j k row focus, ? the list of keys, Esc leaves a field. Enter is native.
 // s: {cls, field (typing in a field), modal (a sheet or dialog is open), tabs, tab, subs, sub}. Returns an action or null.
 function deskKey(e,s){if(!e||e.ctrlKey||e.metaKey||e.altKey||e.defaultPrevented||!s||(s.cls!=='D'&&s.cls!=='XL'))return null;const k=e.key;
  if(s.field)return k==='Escape'?{blur:true}:null;
  if(s.modal)return null;
  if(k===']'||k==='['){const t=step(s.tabs,s.tab,k===']'?1:-1);return t?{go:t}:null}
  if(k==='}'||k==='{'){const u=step(s.subs||[],s.sub,k==='}'?1:-1);return u?{go:s.tab+'/'+u}:null}
  if(/^[1-9]$/.test(k)){const t=s.tabs[+k-1];return t&&t!==s.tab?{go:t}:null}
  if(k==='/')return {search:true};
  if(k==='?')return {help:true};
  if(k==='j'||k==='k')return {row:k==='j'?1:-1};
  return null}
 // A new shell (mechanism A) reloads the page only when the reader is idle. s: {hidden, mode, route, idleMs, waitMs, modal, viewer, playing, typed, fresh}.
 // Never over a cam that plays (a video, the Surf cam frame); every cam stops when the page hides, so this never holds forever.
 // Never over an open sheet, dialog or camera viewer, text the reader typed and has not sent, or Pad (a held session); then only when
 // the page is hidden, ambient, just opened, or 60 s without pointer, key, wheel or scroll on any route but House (its tiles are live).
 // After 24 h of waiting only hidden or 10 quiet minutes count, so a new shell never waits forever.
 const IDLE_MS=60000,WAIT_MAX_MS=86400000,LATE_IDLE_MS=600000;
 function reloadOk(s){if(!s||typeof s!=='object')return false;
  if(s.playing)return false;
  if(s.waitMs>=WAIT_MAX_MS)return !!s.hidden||s.idleMs>=LATE_IDLE_MS;
  if(s.modal||s.viewer||s.typed||/^pad(\/|$)/.test(String(s.route||'')))return false;
  return !!s.hidden||s.mode==='ambient'||!!s.fresh||(s.idleMs>=IDLE_MS&&s.route!=='home/house')}
 // Typed text: a field counts while its value is what the reader's last input event left (a value set by code, such as a composer
 // draft, never counts), is not empty (sent or cleared) and its run window, sheet or dialog is open. fs: [{value, typed, open}]
 function typedBusy(fs){return (Array.isArray(fs)?fs:[]).some(f=>!!f&&f.open!==false&&typeof f.value==='string'&&f.value!==''&&f.value===f.typed)}
 // C5: the honest result of one control call (app.js q). x: {status, body} for an answer, {threw, timeout} for none. Yes is a 2xx JSON object
 // with no error and no ok:false; anything else is {error, failed:true, offline} (offline: no answer at all, so the bar says Offline).
 const TAP_WORDS='Did not work \u00B7 Tap again';
 function callResult(x){x=x&&typeof x==='object'?x:{};
  if(x.threw)return {error:x.timeout?'The computer did not answer in time':'The deck did not answer',failed:true,offline:!x.timeout};
  const b=x.body&&typeof x.body==='object'&&!Array.isArray(x.body)?x.body:null,st=Number(x.status)||0,e=b&&typeof b.error==='string'?b.error:'';
  if(st<200||st>=300)return Object.assign({},b||{},{error:e||'HTTP '+st,failed:true,offline:false,status:st});
  if(!b)return {error:'The answer was not readable',failed:true,offline:false,status:st};
  if(e||b.ok===false)return Object.assign({},b,{error:e||'Refused',failed:true,offline:false});
  return b}
 // where a failed tap's note goes: above the control, below it when there is no room above, never over it; whole inside the window.
 // c: the control's box {left, top, width, height}; n: the note's size {w, h}; v: the window {w, h}
 function notePlace(c,n,v){const m=4,gap=6;let top=c.top-n.h-gap;if(top<m)top=c.top+c.height+gap;
  top=Math.max(m,Math.min(top,v.h-n.h-m));const left=Math.max(m,Math.min(c.left+c.width/2-n.w/2,v.w-n.w-m));return {left:Math.round(left),top:Math.round(top)}}
 // decision 11: what a whoami answer does. stored: the role kept from the last answer; answer: 'owner', 'guest' or '' (no answer). A known
 // role shows its tabs and lets reads go; a new one is stored and fires deck:role; a pager built for the other role (guest or not) reloads once.
 function rolePlan(stored,answer){const s=stored==='owner'||stored==='guest'?stored:'',a=answer==='owner'||answer==='guest'?answer:'';
  if(!a)return {known:!!s,role:s,offline:true,tabs:!!s,store:'',changed:false,reload:false};
  return {known:true,role:a,offline:false,tabs:true,store:a,changed:a!==s,reload:a!==s&&(a==='guest'||s==='guest')}}
 return {TABS,SUBS,OLD,LEGACY,redirect,classOf,pageTitle,swipe,step,deskKey,reloadOk,typedBusy,IDLE_MS,WAIT_MAX_MS,LATE_IDLE_MS,TAP_WORDS,callResult,notePlace,rolePlan}
})();
// ==== SHELL CORE END ====
// ==== SHELL ROUTE BEGIN (pure: no DOM; tests/shell_route.test.js loads this block) ====
// F3, F9: the address names the route and the open sheet, always on "/" (the iOS shell shows "Back to deck" off "/"): /?p=surf&spot=salt-creek.
// A load reads it back, so a reload and a pasted link come back to the same place. An installed app's launch (standalone and not a reload)
// reads nothing from its address: it reopens on the page used last (PRODUCT), never on the ?p= it was installed or bookmarked from.
const ShellRoute=(()=>{
 const P=/^[a-z]{2,16}(\/[a-z]{2,16})?$/,K=/^[a-z][a-z0-9-]{0,23}$/,V=/^[A-Za-z0-9._:-]{1,80}$/,DROP=['p','view','t'];
 const dec=s=>{try{return decodeURIComponent(String(s).replace(/\+/g,' '))}catch(e){return ''}};
 const pairs=q=>String(q||'').replace(/^[?#]/,'').split('&').filter(Boolean).map(kv=>{const i=kv.indexOf('=');return [dec(i<0?kv:kv.slice(0,i)),i<0?'':dec(kv.slice(i+1))]});
 // {route, params, from}: route '' keeps the stored page. #home/crons (older links) wins over ?p= and #p=; params are the link's own
 // (a sheet's key among them); the token, the TV switch and the route itself are never params
 function boot(search,hash,o){o=o||{};if(o.launch)return {route:'',params:{},from:'launch'};
  const h=String(hash||'').replace(/^#/,''),sp=pairs(search),p=(sp.find(x=>x[0]==='p')||pairs(h).find(x=>x[0]==='p')||[])[1]||'';
  const route=h&&!/^(t|p)=/.test(h)?dec(h.split('&')[0]):P.test(p)?p:'';
  if(!route)return {route:'',params:{},from:'stored'};
  const params={};for(const [k,v] of sp)if(!DROP.includes(k)&&K.test(k)&&V.test(v))params[k]=v;
  return {route,params,from:'link'}}
 // the address for a route, its parameters and the open sheet's key ([kind, key] from the row that opened it), always on "/"
 function query(route,params,sheet){const q=['p='+String(route||'').split('/').map(encodeURIComponent).join('/')];
  for(const [k,v] of Object.entries(params||{}))if(!DROP.includes(k)&&K.test(k)&&!(sheet&&k===sheet[0]))q.push(encodeURIComponent(k)+(v===''?'':'='+encodeURIComponent(v)));
  if(sheet)q.push(sheet[0]+'='+encodeURIComponent(sheet[1]));return '/?'+q.join('&')}
 // the key a row gives the sheet it opens: data-open names the kind, data-key the record; anything else gives none
 const sheetKey=(open,key)=>K.test(String(open||''))&&V.test(String(key||''))?[String(open),String(key)]:null;
 return {boot,query,sheetKey}})();
// ==== SHELL ROUTE END ====
// ==== SHELL SERVICES BEGIN (sheet host, Data sheet, status slot, money hold, attribute wiring; every DOM and timer call goes through env; tests/shell_services.test.js loads this block) ====
// UiApi 1.3 and 1.4. A <dialog class="sheet"> is made per open and removed on close, so a page that kept the element of an earlier sheet sees
// it disconnected. Opening with the id of the sheet on top replaces it in place (a repaint); any other open from inside a sheet stacks one
// level deeper. Focus moves to the title (tabindex -1, so the ring shows only for keyboard or remote focus, critique 14) and returns to that
// sheet's opener, found again by its row's data-open and data-key when the page repainted it meanwhile (A2). Back closes a sheet on every device:
// each level owns one history entry, its address carrying the sheet's key (F9); a popstate (system or browser Back) closes the top sheet, and a
// close by the UI (Close, Escape, TV Back key, backdrop) gives its entry back, so history never grows. Tab stays inside an open sheet (A12),
// and a sheet body that scrolls is a keyboard stop (A11). The route's own entry is written here too (navigate), so the two never cross.
const ShellServices=env=>{
 const doc=env.doc,HOLD=30000;
 const esc=DeckCore.esc;
 const txt=v=>v==null?'':String(v);
 const fire=(name,detail)=>doc.dispatchEvent(new env.CustomEvent(name,{detail}));
 const mk=(tag,cls)=>{const e=doc.createElement(tag);if(cls)e.className=cls;return e};
 // quiet: focus moved for a screen reader after a touch or a click, so no ring is drawn (Mobile Safari showed one on every sheet title)
 const focus=(el,quiet)=>{try{el.focus({preventScroll:true,focusVisible:!quiet})}catch(e){}};
 const byPointer=()=>!!(env.pointer&&env.pointer());
 const outside=(d,e)=>{if(!d.getBoundingClientRect||typeof e.clientX!=='number')return false;const r=d.getBoundingClientRect();
  return r.width>0&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)};
 // ---- sheet host
 let stack=[],seq=0,entries=0,expect=0,syncT=0,want=null,hintKey=null;// stack: [{dlg, opener, id, quiet, gone, key, find}]; entries: our history entries in place
 const top=()=>stack.length?stack[stack.length-1]:null;
 // the address of history entry n: the route with the key of the nearest sheet at or below it that has one
 const keyed=n=>{for(let i=Math.min(n,stack.length)-1;i>=0;i--)if(stack[i].key)return stack[i].key;return null};
 const url=n=>env.url?env.url(keyed(n)):undefined;
 function back(o,find){let t=o&&o.isConnected&&typeof o.focus==='function'?o:null;
  if(!t&&find&&env.refind)t=env.refind(find);
  if(!t&&env.fallbackFocus)t=env.fallbackFocus();if(t)focus(t)}
 // history follows the stack after the current task, so close-then-open in one tick (a page reopening its sheet) costs nothing
 function sync(){syncT=0;const h=env.history;if(!h)return;
  if(entries>stack.length){const n=entries-stack.length;entries=stack.length;expect++;h.go(-n)}
  while(entries<stack.length){entries++;h.push({deckSheet:entries},url(entries))}}
 const later=()=>{if(!syncT)syncT=env.setT(sync,0)};
 function done(rec){if(rec.gone)return;rec.gone=true;stack=stack.filter(r=>r!==rec);if(rec.watch)rec.watch();if(rec.dlg.parentNode)rec.dlg.parentNode.removeChild(rec.dlg);if(!rec.quiet)back(rec.opener,rec.find);later()}
 function shut(rec,quiet){if(quiet)rec.quiet=true;try{if(rec.dlg.open)rec.dlg.close()}catch(e){}done(rec)}
 function open(o){o=o&&typeof o==='object'?o:{};
  const prev=top(),same=!!(prev&&o.id&&prev.id===txt(o.id)),opener=same?prev.opener:(o.opener||doc.activeElement||null);
  if(same)shut(prev,true);
  const dlg=mk('dialog','sheet'+(o.wide?' wide':'')),tid='sheet-t'+(++seq);
  if(o.id)dlg.dataset.id=txt(o.id);
  dlg.setAttribute('aria-labelledby',tid);
  const h=mk('header','sheet-h'),hd=mk('div'),t=mk('h2'),p=mk('p'),x=mk('button','sheet-x');
  t.id=tid;t.tabIndex=-1;t.setAttribute('autofocus','');t.textContent=txt(o.title);if(byPointer())t.dataset.pointer='1';
  p.textContent=txt(o.sub);p.hidden=!p.textContent;
  x.type='button';x.setAttribute('aria-label','Close');x.setAttribute('data-close','');x.innerHTML='<svg class="i" aria-hidden="true"><use href="#i-x"/></svg>';
  hd.appendChild(t);hd.appendChild(p);h.appendChild(hd);h.appendChild(x);dlg.appendChild(h);
  const b=mk('div','sheet-b');b.innerHTML=txt(o.body);dlg.appendChild(b);
  let acts=txt(o.actions);
  if(o.data!=null&&o.data!==false&&!/data-sheet="data"/.test(acts))acts+='<button type="button" class="btn" data-sheet="data"'+(typeof o.data==='string'&&o.data?' data-scope="'+esc(o.data)+'"':'')+'>Data</button>';
  if(acts){const a=mk('footer','sheet-a');a.innerHTML=acts;dlg.appendChild(a)}
  // the row that opened the sheet: its key goes in the address when the row is on the page (a row inside another sheet cannot be reopened
  // from a link), and finds the row again for focus. A sheet a page opens from its link's own key (no row) takes the boot's hint.
  const ds=opener&&opener.dataset?opener.dataset:{},inPage=!!(opener&&!(opener.closest&&opener.closest('dialog')));
  const own=inPage&&env.sheetKey?env.sheetKey(ds.open,ds.key):null,key=same?prev.key:(own||hintKey);if(!same&&!own)hintKey=null;
  const rec={dlg,opener,id:txt(o.id),quiet:false,gone:false,key,find:same?prev.find:(ds.open&&ds.key?[txt(ds.open),txt(ds.key)]:null),watch:null};
  dlg.addEventListener('close',()=>done(rec));
  doc.body.appendChild(dlg);stack.push(rec);
  try{dlg.showModal()}catch(e){dlg.setAttribute('open','')}
  if(doc.activeElement!==t)focus(t,t.dataset.pointer==='1');
  roll(dlg);if(env.watch)rec.watch=env.watch(b,()=>roll(dlg));
  later();return dlg}
 function close(){const r=top();if(!r)return false;shut(r);return true}
 // every sheet, top first; focus goes back to the first opener only
 function closeAll(){if(!stack.length)return false;const first=stack[0];[...stack].reverse().forEach(r=>shut(r,r!==first));return true}
 // system or browser Back: the browser already left our entry; close sheets down to the entries still in place. -1: the move was our own
 // (a give-back), and the route it asked for is written on the entry it landed on
 function onPop(e){const st=e&&e.state&&typeof e.state.deckSheet==='number'?e.state.deckSheet:0;entries=Math.min(st,entries);
  if(expect>0){expect--;const w=want;want=null;if(w&&env.history&&env.history.replace)env.history.replace(w.s,w.u);return -1}
  let n=0;while(stack.length>entries){shut(top());n++}return n}
 // F3: the route's own entry. A tab or sub change the reader made pushes one, so Back returns to the page before; a boot, a redirect, a
 // parameter or a refresh replaces the address on screen and keeps its state (the TV's guard entry stays a guard). A route change closes every
 // sheet first: the entry of the one sheet it closed becomes the new route's, so Back from there is the page the sheet was on.
 function navigate(push){const h=env.history;if(!h||!h.replace)return;const n=entries-stack.length;
  if(n>0){if(syncT){env.clearT(syncT);syncT=0}entries=stack.length;
   if(push&&n===1){h.replace({deckRoute:1},url(entries));return}
   expect++;want={s:push?{deckRoute:1}:undefined,u:url(entries)};h.go(push?1-n:-n);return}
  if(push&&!stack.length){h.push({deckRoute:1},url(0));return}
  h.replace(undefined,url(Math.max(0,Math.min(entries,stack.length))))}
 // one key for the next sheet opened without a row of its own (a page that opens its sheet from the link's parameter); null clears it
 function hint(k){hintKey=k||null}
 // A11: a body that scrolls is a keyboard stop named by the sheet's title; one that does not is no stop at all
 function roll(dlg){const b=dlg&&dlg.querySelector?dlg.querySelector('.sheet-b'):null;if(!b)return;const s=b.scrollHeight>b.clientHeight+1;
  if(s&&b.getAttribute('tabindex')!=='0'){b.setAttribute('tabindex','0');b.setAttribute('role','region');b.setAttribute('aria-labelledby',dlg.getAttribute('aria-labelledby')||'')}
  else if(!s&&b.getAttribute('tabindex')==='0'){b.removeAttribute('tabindex');b.removeAttribute('role');b.removeAttribute('aria-labelledby')}}
 // A12: Tab and Shift Tab wrap inside the open sheet (a native modal lets focus leave for the browser once a cycle)
 const STOPS='a[href],button,input,select,textarea,summary,[tabindex]';
 function trap(e){const r=top(),a=doc.activeElement,d=(a&&a.closest&&a.closest('dialog[open]'))||(r&&r.dlg);if(!d||!d.open)return false;
  roll(d);
  const list=[];for(const x of d.querySelectorAll(STOPS))if(!x.disabled&&!x.hidden&&x.tabIndex>=0&&(!x.getClientRects||x.getClientRects().length))list.push(x);
  const inside=!!(a&&a.closest&&a.closest('dialog')===d),i=list.indexOf(a);
  if(!list.length){e.preventDefault();return true}
  if(e.shiftKey?(i<=0):(!inside||i===list.length-1)){e.preventDefault();focus(e.shiftKey?list[list.length-1]:list[0]);return true}
  return false}
 // ---- Data sheet: the route's registry entry gives {sources, blends, method, setup}; DeckUI.dataSheet draws it with the Display toggles
 const units=()=>env.store.get('units')==='metric'?'metric':'us';
 // keys: a hardware keyboard class (D, XL) adds a Keyboard row to Display, so the shortcuts are one tap from every page's Data sheet
 const display=()=>Object.assign({tv:!!env.tv(),alwaysOn:!!env.alwaysOn(),units:units()},env.keyboard&&env.keyboard()?{keys:true}:{});
 // the keyboard sheet (? on D and XL, or Keyboard in the Data sheet): every shortcut ShellCore.deskKey knows, the number keys named by their
 // pages. Words in the body face; each key a bordered cap (L18: the map existed but nothing on screen said so)
 function keys(opener){const kb=k=>'<kbd>'+esc(k)+'</kbd>',tabs=(env.tabs?env.tabs():[]).filter(Boolean).slice(0,8);
  const rows=[[kb('[')+' '+kb(']'),'Previous or next page'],[kb('{')+' '+kb('}'),'Previous or next sub-page'],
   [kb('1')+' to '+kb(String(tabs.length||8)),tabs.length?tabs.map((t,i)=>(i+1)+' '+t).join(', '):'A page by its place in the list'],
   [kb('/'),'Search this page'],[kb('j')+' '+kb('k'),'Next or previous row'],[kb('Enter'),'Open the row'],[kb('Esc'),'Close the sheet, or leave a field'],[kb('?'),'This list']];
  return open({id:'keys',title:'Keyboard',body:'<dl class="kv keys">'+rows.map(r=>'<div><dt>'+r[0]+'</dt><dd>'+esc(r[1])+'</dd></div>').join('')+'</dl>',opener})}
 function displaySec(ui,disp){if(!ui||typeof ui.dataSheet!=='function')return '';const all=ui.dataSheet({display:disp}),i=all.lastIndexOf('<section class="sh-sec"><h3>Display</h3>');return i<0?'':all.slice(i)}
 function plain(ui,disp,failed){return '<section class="sh-sec"><p class="note">'+(failed?'This page could not list its sources just now. Close the sheet and try again.':'This page does not list its sources yet.')+'</p></section>'+displaySec(ui,disp)}
 function dataBody(d,ui,disp){if(!d||typeof d!=='object'||!ui||typeof ui.dataSheet!=='function')return plain(ui,disp,d===false);
  try{return ui.dataSheet(Object.assign({},d,{display:disp}),{now:env.now()})}catch(e){return plain(ui,disp,true)}}
 function entryOf(r){const pages=env.pages();if(!pages||typeof pages.resolve!=='function')return null;const key=pages.resolve(r.route),e=key?pages.page(key):null;
  if(!e||typeof e.data!=='function'||(env.guest()&&e.guest!==true))return null;return e}
 // a scope that names a section instead of a record ('setup', not 'zip:92647') opens on that section: its heading is scrolled clear, so a
 // reader who taps "8 stores need setup" does not land on the sources. An unknown word stays at the top.
 function section(dlg,sc){if(!sc||sc.indexOf(':')>=0)return;const b=dlg.querySelector('.sheet-b');if(!b)return;
  const want=sc.trim().toLowerCase(),heads=b.querySelectorAll('.sh-sec>h3');
  for(const h of heads)if(h.textContent.trim().toLowerCase()===want){h.scrollIntoView({block:'start'});return}}
 function data(scope,opener){const r=env.route(),ui=env.ui(),pages=env.pages(),sc=typeof scope==='string'?scope:'',disp=display(),e=entryOf(r);
  const sub=[r.label,sc.indexOf(':')>0?sc.slice(sc.indexOf(':')+1):sc].filter(Boolean).join(' \u00B7 ');
  let res=null;if(e){try{res=e.data(pages.ctx(pages.parse(r.full||r.route)),sc)}catch(err){res=false}}
  const pend=!!res&&typeof res.then==='function';
  const dlg=open({id:'data',title:'Data',sub,body:pend?'<p class="note">Reading the sources\u2026</p>':dataBody(res,ui,disp),opener});
  if(!pend)section(dlg,sc);
  if(pend)res.then(d=>d,()=>false).then(d=>{if(dlg.isConnected&&dlg.open){const b=dlg.querySelector('.sheet-b');if(b)b.innerHTML=dataBody(d,env.ui(),disp);section(dlg,sc)}});
  return dlg}
 function setDisplay(t){const k=t.dataset.display;
  if(k==='units'){const v=t.dataset.v==='metric'?'metric':'us';env.store.set('units',v);const seg=t.closest('.seg');
   if(seg)seg.querySelectorAll('[data-display="units"]').forEach(x=>{const on=x.dataset.v===v;x.classList.toggle('on',on);x.setAttribute('aria-pressed',on?'true':'false')});
   fire('deck:units',{units:v});return true}
  if(k==='tv'){env.reload({view:t.checked?'tv':'std'});return true}
  if(k==='always-on'){env.store.set('alwaysOn',t.checked?'1':'0');env.reload({});return true}
  return false}
 // ---- status slot: one mark and one word; the page's status wins over a host reply and the weather, the offline mark wins over all
 let pst=null;
 function status(o){if(o&&typeof o==='object'&&txt(o.word).trim()){pst={k:o.k==='warn'?'warn':'bad',word:txt(o.word).trim().split(/\s+/).slice(0,2).join(' '),detail:txt(o.detail).trim()}}else pst=null;
  if(env.paintStatus)env.paintStatus();return pst?Object.assign({},pst):null}
 // a spoken name starts with the words the slot shows, so voice control can say them ("Not sent"); the detail follows (SeeAccess A4)
 const said=t=>{t=String(t).trim();return /[.!?]$/.test(t)?t:t+'.'};
 function slot(s){s=s||{};
  if(s.offline)return {k:'bad',word:'Offline',title:'The deck server did not answer',label:'Offline. The deck server did not answer. Open the details'};
  if(pst)return {k:pst.k,word:pst.word,title:pst.detail||pst.word,label:said(pst.word)+(pst.detail&&pst.detail!==pst.word?' '+said(pst.detail):'')+' Open the details'};
  if(s.err)return {k:'bad',word:'Not sent',title:s.err,label:'Not sent. '+said(s.err)+' Open the details'};
  return {k:'',word:txt(s.weather),title:txt(s.weather),label:txt(s.weather).trim()?said(txt(s.weather))+' Open the status':'Status'}}
 function statusSheet(s,opener){s=s||{};const row=(k,b,line)=>'<div class="frow"><span class="fl"><b>'+(k?'<span class="sd '+k+'"></span> ':'')+esc(b)+'</b>'+(line?'<small>'+esc(line)+'</small>':'')+'</span></div>';
  let rows='';if(s.offline)rows+=row('bad','Offline','The deck server did not answer. It tries again on its own.');
  if(pst)rows+=row(pst.k,pst.word,pst.detail);if(s.err)rows+=row('bad','Not sent',s.err);
  if(s.weather)rows+=row('','Weather',s.weather);
  return open({id:'status',title:'Status',body:'<div class="flist">'+(rows||row('ok','All clear','Nothing needs you right now.'))+'</div>',opener})}
 // ---- money: amounts show only for 30 s after the owner asks; Hide, a route change or a hidden page drops them at once
 let rev=false,until=0,timer=0,tok=0;
 function hide(why){tok++;if(timer)env.clearT(timer);timer=0;if(!rev)return false;rev=false;until=0;fire('deck:money',{revealed:false,why:why||'hide'});return true}
 async function reveal(){const my=++tok;let ok=false;try{ok=!!(await env.ownerOk())}catch(e){ok=false}
  if(my!==tok||!ok)return false;
  if(timer)env.clearT(timer);until=env.now()+HOLD;timer=env.setT(()=>{timer=0;hide('time')},HOLD);
  if(!rev){rev=true;fire('deck:money',{revealed:true,until})}return true}
 const money={revealed:()=>rev,reveal,hide:()=>hide('hide'),until:()=>rev?until:0};
 // ---- retry: one Try again per page asks the route's page to read again (a page that handles it itself calls preventDefault)
 function retry(btn){const pages=env.pages(),r=env.route();if(!pages||typeof pages.resolve!=='function')return false;const key=pages.resolve(r.route),e=key?pages.page(key):null;if(!e)return false;
  btn.disabled=true;const was=btn.textContent;btn.textContent='Trying\u2026';env.setT(()=>{if(btn.isConnected){btn.disabled=false;btn.textContent=was}},6000);
  const c=pages.ctx(pages.parse(r.full||r.route));try{if(typeof e.refresh==='function')e.refresh(c,false);else if(typeof e.show==='function')e.show(c)}catch(err){}return true}
 // ---- page-owned filter sheets (DeckUI.filters): [data-open-fbar] opens #fb-<id>; focus returns to its button on close
 function openFbar(b){const d=doc.getElementById('fb-'+b.dataset.openFbar);if(!d||d.open||typeof d.showModal!=='function')return false;
  d.addEventListener('close',()=>back(b),{once:true});try{d.showModal()}catch(e){return false}
  const h=d.querySelector('.sheet-h h2');if(h){h.tabIndex=-1;const q=byPointer();h.dataset.pointer=q?'1':'0';focus(h,q)}return true}
 // ---- document wiring by attribute (UiApi 1.3, 1.4, 3.3, 3.12)
 function onClick(e){const t=e.target&&e.target.closest?e.target:null;if(!t)return false;let b;
  if(t.tagName==='DIALOG'&&t.classList.contains('sheet')&&t.open&&outside(t,e)){const r=top();if(r&&r.dlg===t)close();else t.close();return true}
  if((b=t.closest('[data-sheet]'))){if(b.dataset.sheet==='data'){data(b.dataset.scope||'',b);return true}return false}
  if((b=t.closest('[data-money]'))){if(b.dataset.money==='hide')hide('hide');else reveal();return true}
  if((b=t.closest('[data-open-fbar]')))return openFbar(b);
  if((b=t.closest('button[data-display="units"]')))return setDisplay(b);
  if((b=t.closest('button[data-keys]'))){keys(b);return true}
  if((b=t.closest('[data-close]'))){const d=b.closest('dialog'),r=top();if(r&&(!d||d===r.dlg))return close();if(d&&d.open){d.close();return true}return false}
  if((b=t.closest('[data-retry]'))&&!b.classList.contains('es-retry')&&!e.defaultPrevented)return retry(b);
  return false}
 function onChange(e){const t=e.target;return !!(t&&t.matches&&t.matches('input[data-display]'))&&setDisplay(t)}
 // Enter on a focused table row that opens a sheet clicks it (a <tr> has no native activation); Tab wraps inside an open sheet
 function onKey(e){if(e.defaultPrevented)return false;if(e.key==='Tab')return !e.altKey&&!e.ctrlKey&&!e.metaKey&&trap(e);
  if(e.key!=='Enter')return false;const t=e.target;if(!t||!t.matches||!t.matches('tr[data-open]'))return false;e.preventDefault();t.click();return true}
 function onRoute(){closeAll();status(null);hide('route')}
 function onHidden(){hide('hidden')}
 return {sheet:{open,close,data,current:()=>{const r=top();return r?r.dlg:null},key:()=>{const r=top();return r&&r.key?r.key.slice():null}},status,slot,statusSheet,keys,money,units,onClick,onChange,onKey,onRoute,onHidden,onPop,navigate,hint}
};
// ==== SHELL SERVICES END ====
const ICON={today:'i-today',world:'i-world',home:'i-home',realestate:'i-estate',surf:'i-surf',shop:'i-shop',money:'i-money',work:'i-work',pad:'i-pad'};
const pager=$('#pager'),PAGES=[...$$('#pager>.page')].filter(p=>!p.dataset.off);
// B2: the strip is a tab list (role from index.html): one tab stop, the arrows move between pages (tabKey), each page a tab panel the skip link focuses
$('#pgs').innerHTML=PAGES.map((p,i)=>'<button type="button" role="tab" id="tab-'+esc(p.dataset.name)+'" aria-controls="'+esc(p.id)+'" aria-selected="false" tabindex="-1" class="press" data-p="'+i+'" data-n="'+esc(p.dataset.name)+'" data-t="'+esc(p.dataset.label||p.dataset.name)+'"><svg class="i" aria-hidden="true"><use href="#'+(ICON[p.dataset.name]||'i-data')+'"/></svg><span>'+esc(p.dataset.label||p.dataset.name)+'</span></button>').join('');
PAGES.forEach(p=>{p.setAttribute('role','tabpanel');p.setAttribute('aria-labelledby','tab-'+p.dataset.name);p.tabIndex=-1;
 const row=p.querySelector('.phead .subrow');if(!row)return;row.addEventListener('keydown',tabKey);
 row.querySelectorAll('[data-sub]').forEach(b=>{const panel=p.querySelector(':scope>.sub[data-sub="'+b.dataset.sub+'"]');b.id='tab-'+p.dataset.name+'-'+b.dataset.sub;b.tabIndex=-1;
  if(panel){b.setAttribute('aria-controls',panel.id);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',b.id)}})});
$('#pgs').addEventListener('keydown',tabKey);
{const sk=$('.skiplink');if(sk)sk.addEventListener('click',e=>{const pg=PAGES[page];if(!pg)return;e.preventDefault();try{pg.focus({preventScroll:true})}catch(err){pg.focus()}})}
// ==== TAB KEYBOARD BEGIN (B2; tests/shell_route.test.js loads this block) ====
// in a tab list the arrows along its direction, Home and End move to that tab and show it, as a tap does (the sub-pages nested in the D rail
// are their own list); the moved tab keeps focus even when the route rebuilt it. Tab leaves the list; modifiers stay the browser's.
function tabKey(e){if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.defaultPrevented)return false;
 // the TV remote's arrows move focus (tv.js), they never change the page
 if(typeof document!=='undefined'&&document.documentElement.classList.contains('tv'))return false;
 const t=e.target&&e.target.closest?e.target.closest('[role=tab]'):null,box=t&&t.parentElement;if(!box)return false;
 const list=[...box.children].filter(x=>x.getAttribute('role')==='tab'&&!x.hidden&&!x.disabled),at=list.indexOf(t),n=list.length;if(at<0)return false;
 const v=(e.currentTarget&&e.currentTarget.getAttribute&&e.currentTarget.getAttribute('aria-orientation'))==='vertical',k=e.key;let j=-1;
 if(k===(v?'ArrowDown':'ArrowRight'))j=(at+1)%n;else if(k===(v?'ArrowUp':'ArrowLeft'))j=(at+n-1)%n;else if(k==='Home')j=0;else if(k==='End')j=n-1;else return false;
 e.preventDefault();const b=list[j],sel=b.dataset.p!=null?'[data-p="'+b.dataset.p+'"]':'[data-sub="'+b.dataset.sub+'"]';b.click();
 const f=b.isConnected?b:(e.currentTarget&&e.currentTarget.querySelector?e.currentTarget.querySelector('[role=tab]'+sel):null);if(f)f.focus({preventScroll:true});return true}
// ==== TAB KEYBOARD END ====
const SH={tab:'',sub:'',params:{},route:''};
const pageEl=t=>PAGES.find(p=>p.dataset.name===t)||null;
const subsOf=pg=>pg?[...pg.querySelectorAll(':scope>.sub')].filter(s=>!s.dataset.off):[];
const subOf=pg=>pg&&pg.querySelector(':scope>.sub:not([hidden])');
const pname=()=>SH.tab;
// the name a page registers under: its own route once a lane registered it, else the old leaf it still paints with
function leafOf(t){const pg=pageEl(t),s=t===SH.tab?SH.sub:((subOf(pg)||{dataset:{}}).dataset.sub||'');const r=s&&s!=='main'?t+'/'+s:t;
 const k=typeof DeckPages!=='undefined'&&DeckPages.resolve?DeckPages.resolve(r):null;if(k===r)return r;
 return ShellCore.LEGACY[r]||k||(s&&s!=='main'?s:t)}
function onHouse(){return pname()==='home'&&leafOf('home')==='home'}
const qparams=q=>{const o={};for(const kv of String(q||'').split('&')){if(!kv)continue;const e=kv.indexOf('=');o[decodeURIComponent(e<0?kv:kv.slice(0,e))]=e<0?'':decodeURIComponent(kv.slice(e+1))}return o};
// D: the active tab's sub-pages nested under it in the rail (clones carry no data-p, so DeckPageNav ignores them)
function railSubs(pg){$$('#pgs .rsub').forEach(n=>n.remove());const row=pg&&pg.querySelector('.phead .subrow'),tab=$('#pgs button.on');if(!row||!tab)return;
 const r=document.createElement('div');r.className='rsub';r.setAttribute('role','none');
 row.querySelectorAll('button[data-sub]').forEach(b=>{if(b.hidden)return;const c=document.createElement('button'),on=b.classList.contains('on');c.type='button';c.setAttribute('role','tab');c.textContent=b.textContent;c.dataset.sub=b.dataset.sub;c.setAttribute('aria-selected',on?'true':'false');c.tabIndex=on?0:-1;if(b.getAttribute('aria-controls'))c.setAttribute('aria-controls',b.getAttribute('aria-controls'));if(on){c.className='on';c.setAttribute('aria-current','page')}r.append(c)});
 tab.after(r)}
const scrollKey=()=>'scroll:'+SH.route;
function saveScroll(){if(!SH.route)return;try{sessionStorage.setItem(scrollKey(),String(Math.round(scrollY)))}catch(e){}}
addEventListener('pagehide',saveScroll);
function restoreScroll(){let y=0;try{y=+sessionStorage.getItem(scrollKey())||0}catch(e){}scrollTo(0,0);if(y>0){const until=Date.now()+15000;const t=()=>{if(document.documentElement.scrollHeight-innerHeight>=y-2)scrollTo(0,y);else if(Date.now()<until)setTimeout(t,250)};requestAnimationFrame(t)}}
// an old link that ends in #section lands on that section once its page has painted it; the retry stops as soon as it is found
let hashT=0;
function waitHash(id){clearTimeout(hashT);const until=Date.now()+4000;
 const look=()=>{const el=document.getElementById(id);if(el){el.scrollIntoView({block:'start'});return true}return false};
 if(look())return;
 const step=()=>{if(look()||Date.now()>until)return;hashT=setTimeout(step,250)};
 step()}
// show a route: old names pass the redirect table first; the remembered sub of a tab is kept; guests see House and Pad only; TV shows Keys for Pad
function go(raw,opt){opt=opt||{};const full=ShellCore.redirect(raw),hi=full.indexOf('#'),hash=hi<0?'':full.slice(hi+1),r=hi<0?full:full.slice(0,hi),qi=r.indexOf('?'),path=qi<0?r:r.slice(0,qi);let [t,s]=path.split('/');
 if(!pageEl(t))t=PAGES[0].dataset.name;const pg=pageEl(t),subs=subsOf(pg);
 if(!s){const st=localStorage.getItem('sub:'+t),m=st?ShellCore.redirect(t+'/'+st).split('?')[0].split('/'):[];s=m[0]===t?m[1]:''}
 if(GUEST&&t==='home')s='house';
 if(document.documentElement.classList.contains('tv')&&t==='pad')s='keys';
 if(!subs.some(x=>x.dataset.sub===s))s=subs[0]?subs[0].dataset.sub:'main';
 const changed=t!==SH.tab||s!==SH.sub;if(changed)saveScroll();
 PAGES.forEach(p=>{p.hidden=p!==pg});subs.forEach(x=>{x.hidden=x.dataset.sub!==s});
 pg.querySelectorAll('.phead .subrow [data-sub]').forEach(b=>{const on=b.dataset.sub===s;b.classList.toggle('on',on);b.setAttribute('aria-selected',on?'true':'false');b.tabIndex=on?0:-1});
 // the title carries the sub-page's name for the D header ("Real estate · Commercial", ui.css); a sub named like its tab (Pad) adds nothing
 {const tt=pg.querySelector('.phead .ptitle'),sb=s!=='main'?pg.querySelector('.phead .subrow [data-sub="'+s+'"]'):null,w=sb?sb.textContent.trim():'';
  if(tt){if(w&&w!==tt.textContent.trim())tt.dataset.sub=w;else delete tt.dataset.sub}}
 page=PAGES.indexOf(pg);Object.assign(SH,{tab:t,sub:s,params:qparams(qi<0?'':r.slice(qi+1)),route:s==='main'?t:t+'/'+s});
 $$('#pgs button[data-p]').forEach(b=>{const on=+b.dataset.p===page;b.classList.toggle('on',on);b.setAttribute('aria-selected',on?'true':'false');b.tabIndex=on?0:-1;if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
 railSubs(pg);$('#app').dataset.page=t;
 try{localStorage.setItem('page',SH.route);localStorage.setItem('sub:'+t,s)}catch(e){}
 if(changed){restoreScroll();revealTab(page,opt.instant);revealSub(opt.instant);if(SVC)SVC.onRoute()}
 // the address follows (F3): a tab or sub the reader chose pushes an entry, everything else replaces; the iPhone app and the TV view replace
 // only (their own Back is not the browser's, and is untested with route entries)
 if(SVC)SVC.navigate(changed&&!!opt.push&&routeEntries());
 // a link hash names a section the page may build only on its first show (#missions under Home > Launch), so keep looking for it while the
 // page paints instead of giving up after one frame; the wait is short and nothing else changes
 if(hash)waitHash(hash);
 settle();
 document.dispatchEvent(new CustomEvent('deck:route',{detail:{tab:t,sub:s,route:SH.route,params:Object.assign({},SH.params)}}));
 if(window.DeckTV&&typeof DeckTV.refresh==='function')DeckTV.refresh();
 if(!opt.quiet)pageVisible()}
document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target:null;if(!t)return;
 const tab=t.closest('#pgs button[data-p]');if(tab){const pg=PAGES[+tab.dataset.p];if(pg){if(pg.dataset.name!==SH.tab)haptic('selection');go(pg.dataset.name,{push:true})}return}
 const rs=t.closest('#pgs .rsub button[data-sub]');if(rs){go(SH.tab+'/'+rs.dataset.sub,{push:true});return}
 const sb=t.closest('.phead .subrow [data-sub]');if(sb){const pg=sb.closest('.page');if(pg){haptic('selection');go(pg.dataset.name+'/'+sb.dataset.sub,{push:true})}}});
// L and T: keep the active tab clear of the edge fades in a strip that scrolls, and the active sub-tab in view in a sideways sub-tab row (T);
// never animates under Reduce Motion. P holds every tab and sub-tab whole, so nothing scrolls there.
const TAB_FADE=32,TAB_M=TAB_FADE+12;
function revealIn(s,b,instant){if(!s||!b)return;const sr=s.getBoundingClientRect(),br=b.getBoundingClientRect(),M=Math.min(TAB_M,Math.max(0,(sr.width-br.width)/2));let d=0;
 const max=s.scrollWidth-s.clientWidth,x=s.scrollLeft;if(max<=2)return;
 if(br.left<sr.left+M)d=br.left-sr.left-M;else if(br.right>sr.right-M)d=br.right-sr.right+M;
 const to=Math.max(0,Math.min(max,Math.round(x+d)));
 if(d&&to!=Math.round(x))s.scrollTo({left:to,behavior:instant||reduceMotion()?'instant':'smooth'})}
function revealTab(i,instant){const s=$('#pgs');revealIn(s,s&&$('#pgs button[data-p="'+i+'"]'),instant);tabEdges()}
// the sub-tab row narrows when the page's freshness mark arrives, after the route revealed the active sub-tab: reveal it again then
function revealSub(instant){const pg=PAGES[page],row=pg&&pg.querySelector('.phead .subrow');revealIn(row,row&&row.querySelector('[data-sub].on'),instant);
 if(row&&typeof ResizeObserver==='function'){const o=revealSub.ro||(revealSub.ro=new ResizeObserver(()=>revealSub(true)));if(o.row!==row){o.disconnect();o.observe(row);o.row=row}}}
function tabEdges(){const s=$('#pgs');s.classList.toggle('less',s.scrollLeft>2);s.classList.toggle('more',s.scrollLeft+s.clientWidth<s.scrollWidth-2)}
$('#pgs').addEventListener('scroll',tabEdges,{passive:true});
// the strip changes size after a rotation, a font load or a status change: keep the active tab in view (a landscape iPhone once showed Pad off the right edge)
if(typeof ResizeObserver==='function'){let sig='';new ResizeObserver(()=>{const s=$('#pgs'),g=s.clientWidth+':'+s.scrollWidth;if(g===sig)return;sig=g;revealTab(page,true)}).observe($('#pgs'))}
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{revealTab(page,true);revealSub(true);settle()});
// device class on the root element and a deck:class event when it changes (width, height, TV switch; never orientation)
let dclass='';
function setClass(){const c=ShellCore.classOf(innerWidth,innerHeight,document.documentElement.classList.contains('tv'));if(c===dclass)return;const prev=dclass;dclass=c;document.documentElement.dataset.dc=c;
 document.dispatchEvent(new CustomEvent('deck:class',{detail:{cls:c,prev}}))}
setClass();
// B2: the D rail lists its tabs top to bottom, so its arrows are Up and Down; every other class is a row
function tabAxis(){$('#pgs').setAttribute('aria-orientation',dclass==='D'||dclass==='XL'?'vertical':'horizontal')}
tabAxis();document.addEventListener('deck:class',tabAxis);
// sticky table headers sit under the sticky page header; a table that still overflows after dropping columns scrolls sideways
function settle(){const pg=PAGES[page],ph=pg&&pg.querySelector('.phead');if(ph){const cs=getComputedStyle(ph),top=cs.position==='sticky'?parseFloat(cs.top)||0:0;
  document.documentElement.style.setProperty('--sticky-top',cs.position==='sticky'?Math.round(top+ph.offsetHeight)+'px':'0px');ph.classList.toggle('stuck',scrollY>4)}
 if(pg)pg.querySelectorAll('.htw').forEach(w=>{const tb=w.querySelector('table');if(!tb)return;w.classList.remove('scroll');if(getComputedStyle(tb).display==='table'&&tb.scrollWidth>w.clientWidth+1)w.classList.add('scroll')})}
addEventListener('scroll',()=>{const pg=PAGES[page],ph=pg&&pg.querySelector('.phead');if(ph)ph.classList.toggle('stuck',scrollY>4)},{passive:true});
addEventListener('resize',()=>{setClass();ctx();revealTab(page,true);revealSub(true);showSt();settle()});
// the run window's thread scrolls between its bar and composer (--rtop, --rbot)
function fitUnder(){const rp=$('#runp'),rb=$('#runbar'),rc=$('#runc');if(rp&&rb&&rc&&rp.clientHeight>0){rp.style.setProperty('--rtop',Math.ceil(rb.offsetTop+rb.offsetHeight+8)+'px');rp.style.setProperty('--rbot',Math.ceil(rp.clientHeight-rc.offsetTop+8)+'px')}}
if(typeof ResizeObserver==='function'){const ro=new ResizeObserver(fitUnder);['#runp','#runbar','#runc'].forEach(s=>{const e=$(s);if(e)ro.observe(e)})}
addEventListener('resize',fitUnder);fitUnder();
// the route on screen with its query, and its words for sheet headers ("Real estate · Residential")
// a link's parameters as the query a route string carries ("?spot=salt-creek"), for go()
const linkQuery=p=>{const q=Object.entries(p||{}).map(([k,v])=>encodeURIComponent(k)+(v===''?'':'='+encodeURIComponent(v))).join('&');return q?'?'+q:''};
const routeFull=()=>SH.route+linkQuery(SH.params);
function routeLabel(){const pg=pageEl(SH.tab);if(!pg)return '';const b=SH.sub&&SH.sub!=='main'?pg.querySelector('.phead .subrow [data-sub="'+SH.sub+'"]'):null;return [pg.dataset.label||pg.dataset.name,b?b.textContent.trim():''].filter(Boolean).join(' \u00B7 ')}
document.addEventListener('deck:route',()=>{document.title=ShellCore.pageTitle(routeLabel().split(' \u00B7 '))});
const shStore={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}}};
let lastPointer=0;addEventListener('pointerdown',()=>{lastPointer=Date.now()},true);addEventListener('keydown',()=>{lastPointer=0},true);
SVC=ShellServices({doc:document,CustomEvent,store:shStore,now:()=>Date.now(),setT:(f,ms)=>setTimeout(f,ms),clearT:t=>clearTimeout(t),
 route:()=>({route:SH.route,full:routeFull(),label:routeLabel()}),pages:()=>typeof DeckPages!=='undefined'?DeckPages:null,ui:()=>typeof DeckUI==='object'?DeckUI:null,
 guest:()=>GUEST,tv:()=>document.documentElement.classList.contains('tv'),alwaysOn:()=>document.documentElement.classList.contains('always-on'),
 // the owner-only check behind Show amounts: the server names the principal; a guest or a desk viewer never reveals
 ownerOk:()=>GUEST?Promise.resolve(false):fetch('/api/whoami',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>!!j&&j.role==='owner').catch(()=>false),
 paintStatus:()=>showSt(),fallbackFocus:()=>$('#pgs button.on'),
 // the keyboard sheet: a hardware keyboard class, and the tabs in the order the number keys follow (visTabs, the list deskKey steps through)
 keyboard:()=>dclass==='D'||dclass==='XL',tabs:()=>PAGES.map(p=>p.dataset.label||p.dataset.name),
 // a sheet opened by a touch or a click draws no ring on its title (a pointer press in the last 3 s, a sheet that waited for its data
 // included; a key since clears it)
 pointer:()=>Date.now()-lastPointer<3000,
 // A2: the row that opened a sheet, painted again by its page meanwhile: the one on screen with the same data-open and data-key
 refind:f=>{try{return [...document.querySelectorAll('[data-open="'+CSS.escape(f[0])+'"][data-key="'+CSS.escape(f[1])+'"]')].find(x=>x.getClientRects().length&&!x.disabled)||null}catch(e){return null}},
 // A11: a sheet body whose content a page replaces later is measured again
 watch:(el,fn)=>{if(typeof MutationObserver!=='function')return null;const m=new MutationObserver(()=>fn());m.observe(el,{childList:true,subtree:true});return ()=>m.disconnect()},
 // F3, F9: the address of the route on screen with a sheet's key: /?p=surf&spot=salt-creek
 url:k=>ShellRoute.query(SH.route,SH.params,k),sheetKey:(o,k)=>ShellRoute.sheetKey(o,k),
 // TV view and Always-on apply on a fresh load of the same route (TV stays opt-in: ?view=tv or the stored switch)
 reload:o=>location.replace('/?'+(o&&o.view?'view='+o.view+'&':'')+'p='+encodeURIComponent(SH.route).replace(/%2F/g,'/')),
 // one history entry per open sheet level, so Back (Android, a TV browser, the desktop button) closes a sheet instead of leaving the deck, and
 // one per page the reader chose; a replace keeps the entry's own state unless it is given one
 history:{push:(s,u)=>{try{history.pushState(s,'',u)}catch(e){}},replace:(s,u)=>{try{history.replaceState(s===undefined?history.state:s,'',u)}catch(e){}},go:n=>{try{history.go(n)}catch(e){}}}});
// Back and Forward: the shell closes the sheets above the entry; a different page in the address is shown (and replaces, never pushes), the
// same page has its address written again (an entry a sheet or a parameter left stale). Our own give-back (-1) needs nothing more.
// The iPhone app and the TV view keep one entry for the deck: Back there closes a sheet or (TV) returns to the tab, never to another page.
const routeEntries=()=>!IN_SHELL&&!document.documentElement.classList.contains('tv');
addEventListener('popstate',e=>{if(SVC.onPop(e)<0)return;const b=ShellRoute.boot(location.search,'',{});
 if(routeEntries()&&b.route&&ShellCore.redirect(b.route).split(/[?#]/)[0]!==SH.route&&b.route!==SH.tab)go(b.route+linkQuery(b.params),{pop:true});else SVC.navigate(false)});
document.addEventListener('click',e=>{if(SVC.onClick(e))haptic('selection')});
document.addEventListener('change',e=>SVC.onChange(e));
document.addEventListener('keydown',e=>SVC.onKey(e));
$('#status').addEventListener('click',e=>{e.stopPropagation();SVC.statusSheet(stParts(),e.currentTarget)});
// go(route, {push:false}) replaces the address instead of adding an entry (a redirect or a timer); a page's own tap pushes like a tab tap
window.DeckShell={go:(r,o)=>go(r,Object.assign({push:true},o)),route:()=>({tab:SH.tab,sub:SH.sub,route:SH.route,params:Object.assign({},SH.params)}),cls:()=>dclass,query:SEARCH,
 tv:{refresh(){if(window.DeckTV&&typeof DeckTV.refresh==='function')DeckTV.refresh()}},
 sheet:SVC.sheet,status:o=>SVC.status(o),money:SVC.money,units:SVC.units};
// ---- navigation helpers for the D keyboard and the page swipe: the tabs and subs a viewer can reach (guests: House and Pad)
const visTabs=()=>PAGES.map(p=>p.dataset.name);
const visSubs=()=>subsOf(pageEl(SH.tab)).map(x=>x.dataset.sub).filter(x=>x!=='main');
const inField=t=>!!(t&&t.closest&&t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]'));
const modalOpen=()=>!!document.querySelector('dialog[open],#sheet.on,#runp.on,#viewer.on');
// D: [ ] tab, { } sub-tab, 1-8 jump, / search, j k row focus (rows that open a sheet or a page), Esc leaves a field; Enter is native
const ROWS='button.frow,a.frow,button.rank-row,tr[data-open],button.card,a.card,button.spot,button.tile,button[data-open]';
function rowStep(d){const sub=subOf(PAGES[page]);if(!sub)return;const rs=[...sub.querySelectorAll(ROWS)].filter(x=>!x.disabled&&x.getClientRects().length&&!x.closest('dialog'));if(!rs.length)return;
 const i=rs.indexOf(document.activeElement);let j=i>=0?Math.max(0,Math.min(rs.length-1,i+d)):rs.findIndex(x=>x.getBoundingClientRect().bottom>0);if(j<0)j=0;
 const el=rs[j];try{el.focus({preventScroll:true,focusVisible:true})}catch(e){el.focus()}el.scrollIntoView({block:'nearest'})}
// `/` goes to the page's inline search; with none, to the search inside the page's Filters dialog: shown inline (D) it is used as it is,
// a closed sheet is opened through its own Filters button first (Work > Jobs, SeeAccess A14)
function searchField(){const pg=PAGES[page];if(!pg)return null;const shown=x=>x.getClientRects().length>0,Q='.search input,input[type="search"]';
 const f=[...pg.querySelectorAll(Q)].find(x=>shown(x)&&!x.closest('dialog'));if(f)return f;
 for(const d of pg.querySelectorAll('dialog[id^="fb-"]')){const i=d.querySelector(Q);if(!i)continue;if(shown(i))return i;
  const b=[...document.querySelectorAll('[data-open-fbar="'+d.id.slice(3)+'"]')].find(shown);if(!b)continue;b.click();if(d.open&&shown(i))return i}
 return null}
document.addEventListener('keydown',e=>{const a=ShellCore.deskKey(e,{cls:dclass,field:inField(e.target),modal:modalOpen(),tabs:visTabs(),tab:SH.tab,subs:visSubs(),sub:SH.sub});if(!a)return;
 if(a.blur){e.target.blur();return}
 if(a.search){const f=searchField();if(!f)return;e.preventDefault();f.focus();if(f.select)f.select();return}
 if(a.help){e.preventDefault();SVC.keys(document.activeElement);return}
 e.preventDefault();if(a.go){haptic('selection');go(a.go,{push:true})}else if(a.row)rowStep(a.row)});
// P and L: a page swipe moves one tab. Horizontal and dominant, 60 px, under 0.8 s; never from a screen edge (the system Back gesture), a
// table, a sideways scroller, a control strip, a chart, the Pad, or while a sheet is open
const NOSWIPE='table,.htw,.chips,.seg,.subrow,input,textarea,select,.usmap,.coast,.chart,.spark,.range,#pgs,#padpg,#keyspg,[data-noswipe]';
let sw0=null;
pager.addEventListener('touchstart',e=>{sw0=null;if(e.touches.length!==1||(dclass!=='P'&&dclass!=='L')||modalOpen()||SH.tab==='pad')return;const p=e.touches[0],el=e.target;
 if(p.clientX<24||p.clientX>innerWidth-24||(el.closest&&el.closest(NOSWIPE)))return;
 for(let n=el;n&&n!==pager;n=n.parentElement)if(n.scrollWidth>n.clientWidth+1&&/auto|scroll/.test(getComputedStyle(n).overflowX))return;
 sw0={x:p.clientX,y:p.clientY,t:Date.now()}},{passive:true});
pager.addEventListener('touchend',e=>{const s=sw0;sw0=null;if(!s||Date.now()-s.t>800||modalOpen())return;const p=e.changedTouches[0],d=ShellCore.swipe(p.clientX-s.x,p.clientY-s.y);if(!d)return;
 const n=ShellCore.step(visTabs(),SH.tab,d);if(n){haptic('selection');go(n,{push:true})}},{passive:true});
pager.addEventListener('touchcancel',()=>{sw0=null},{passive:true});
// L: the page's freshness mark sits in the bar (#tfresh, critique 11). The page keeps writing it into its header (DeckPages.mark); the bar
// shows a copy, which opens the Data sheet through the same data-sheet wiring. ui.css shows #tfresh and hides the header copy on L only.
// L: the page's own Filters button moves into the bar (#tact) too, as the same element, so its [data-open-fbar] behaviour is unchanged and
// page code does not change, but only when that saves a row: its filter row holds nothing else (Gigs: the button and its chips; Jobs: the
// person picker, which the Filters sheet carries on L), so the emptied row collapses. In the bar it shows its mark and count (ui.css). A
// button beside a search or a type switch stays there (Residential, Commercial, and Launch's own button), so the bar keeps room for all
// eight tabs (LayoutL 1, 2, 42, 47, 73, 75). Nothing else moves. Every other class moves it back into its .fbar-top.
let barObs=null;
function mirrorFresh(){const slot=$('#tfresh');if(!slot)return;const f=PAGES[page]&&PAGES[page].querySelector('.phead .pact>.fresh'),h=f?f.outerHTML:'';if(slot.innerHTML!==h)slot.innerHTML=h}
function moveFilters(){const pg=PAGES[page],slot=$('#tact');if(!slot||!pg)return;
 // the bar holds the Filters button of the sub-page on screen only (Residential and Commercial share one page). A button an earlier
 // view moved there (its #fb-<id> dialog lives with it) goes back to its own filter row first, or leaves the bar when that row is gone:
 // on L, Surf showed Commercial's button and Residential's own never reached the bar (WebKit lane, 2026-11-15).
 const sc=subOf(pg)||pg,was=slot.querySelector('.fbar-open'),dlg=was&&document.getElementById('fb-'+was.dataset.openFbar);
 if(was&&!(dlg&&sc.contains(dlg))){const t=dlg&&dlg.closest('.fbar')&&dlg.closest('.fbar').querySelector('.fbar-top');if(t&&!t.querySelector('.fbar-open'))t.insertBefore(was,t.querySelector('.chips')||null);else was.remove()}
 // one Filters control, in every class: a page that repaints its filter row draws a new button (its count is current), so a button the
 // bar still holds is a stale copy and goes. On L, Residential showed both, one in the bar and one beside the search (LayoutL 42, 47).
 let inBar=slot.querySelector('.fbar-open');const box=sc.querySelector('.fbar .fbar-open'),top=sc.querySelector('.fbar-top');
 if(inBar&&box){inBar.remove();inBar=null}
 const alone=!!top&&![...top.children].some(c=>!c.matches('.fbar-open,.chips'));
 if(dclass==='L'&&alone){if(!inBar&&box)slot.appendChild(box);return}
 if(inBar){if(top)top.insertBefore(inBar,top.querySelector('.chips')||null);else inBar.remove()}}
function syncBar(){mirrorFresh();moveFilters()}
document.addEventListener('deck:route',()=>{syncBar();if(typeof MutationObserver!=='function')return;barObs=barObs||new MutationObserver(()=>{if(!barObs.t)barObs.t=requestAnimationFrame(()=>{barObs.t=0;syncBar()})});barObs.disconnect();
 const pg=PAGES[page];if(!pg)return;const pact=pg.querySelector('.phead .pact'),sub=subOf(pg);
 [pact,sub].forEach(el=>{if(el)barObs.observe(el,{childList:true,subtree:true,characterData:true,attributes:true})})});
document.addEventListener('deck:class',()=>syncBar());
// no page read leaves before whoami answered (decision 11): a refused read would paint an error on a device whose cookie turned guest
function pageVisible(){if(!ROLE.known)return;syncCameras();if(document.hidden||mode=='ambient')return;const n=pname(),leaf=leafOf(n);
 if(leaf==='home'){ha();cams();stats()}
 if(hostPage())refresh();
 if(leaf==='fleet')fleet();
 if(typeof deckPage==='function')deckPage(leaf,false)}
// ---- deck keys ----
let keyGroups=[];
async function loadKeys(){try{const j=await fetch('/api/keys').then(r=>r.json());keys=Array.isArray(j.keys)?j.keys:[];keyGroups=Array.isArray(j.groups)?j.groups:[]}catch(e){}renderKeys()}
// A key is one button. On a TV remote a held OK repeats Enter: a repeat never presses a key again (KEYROWS.freshEnter).
// The key is a flex column, so a space between its parts draws nothing and keeps the words on the key apart for whatever reads them
// ("1 WS 1 Empty", never "1WS 1Empty").
function keyBtn(k,i){const b=document.createElement('button');b.className='key press';b.innerHTML='<span class="ic" aria-hidden="true">'+esc(k.icon)+'</span> <span class="lb">'+esc(k.label)+'</span>'+(k.action==='ws'?' <span class="ap"><span class="af"></span><span class="ac"></span></span>':'');
 b.dataset.say=KEYROWS.say(k);b.setAttribute('aria-label',b.dataset.say);b.title=String(k.label||'');
 if(k.action==='ws')b.dataset.ws=String(k.arg);
 b.addEventListener('keydown',e=>{if(!KEYROWS.freshEnter(e))e.preventDefault()});
 b.onclick=()=>fire(b,k,i);return b}
// A confirm key fires on the second press inside KEYROWS.ARM_MS (3 s); the first press arms it and says so.
function keyDisarm(b,k){clearTimeout(b.armT);delete b.dataset.arm;b.classList.remove('armed');b.querySelector('.lb').textContent=k.label;b.setAttribute('aria-label',KEYROWS.say(k))}
async function fire(b,k,i){if(b.dataset.wait)return;
 if(k.confirm){const now=Date.now();
  if(KEYROWS.confirmStep(b.dataset.arm?Number(b.dataset.arm):null,now)==='arm'){
   const again=document.documentElement.classList.contains('tv')?'Press again':'Tap again';
   b.dataset.arm=String(now);b.classList.add('armed');b.querySelector('.lb').textContent=again;b.setAttribute('aria-label',again+' to confirm: '+k.label);
   clearTimeout(b.armT);b.armT=setTimeout(()=>keyDisarm(b,k),KEYROWS.ARM_MS);return}
  keyDisarm(b,k)}
 return oneCall(b,async()=>{const p='key?v='+(Number.isInteger(k.i)?k.i:i),r=await q(p,1);flag(r);if(r.failed)tapFail(b,r,'key');setTimeout(refresh,500)})}
// ==== KEY ROWS HELPERS BEGIN (pure: no DOM, no fetch, no globals; tests/home_keys_ui.test.js loads this block) ====
// A key's row is its served `group` (keys.json); a key without one is grouped by its action, so the rows stay right for
// whatever keys.json the host serves. Row names come from the served `groups` list, else the names below.
const KEYROWS=(()=>{
 const GROUPS=[['apps','Apps'],['media','Media'],['workspaces','Go to workspace'],['window','Move window'],['system','System'],['tv','TV'],['games','Games'],['music','Music'],['sprinklers','Sprinklers'],['house','House']];
 const GID=/^[a-z][a-z0-9_-]{0,23}$/;
 const label=(id,served)=>{const s=Array.isArray(served)?served.find(x=>x&&x.id===id&&typeof x.name==='string'&&x.name.trim()):null;if(s)return s.name.trim().slice(0,40);const g=GROUPS.find(x=>x[0]===id);return g?g[1]:id};
 function group(k){if(k&&typeof k.group==='string'&&GID.test(k.group))return k.group;
  const a=(k&&k.action)||'',v=(k&&k.arg)||'';
  if(a=='ws')return 'workspaces';
  if(a=='mvws')return 'window';
  if(a=='media-act'||a=='mute')return 'media';
  if(a=='screenshot'||a=='lock')return 'system';
  if(a=='launch'&&(v=='menu'||v=='nightlight'))return 'system';
  return 'apps'}
 // Rows in page order; a group with no keys is not drawn at all. Each entry keeps its served index, which
 // is what POST /api/key?v= takes, so grouping can never shift a key onto the wrong action.
 function rows(keys,served){const out=[];
  (keys||[]).forEach((k,i)=>{const g=group(k);let r=out.find(x=>x.id===g);if(!r){r={id:g,name:label(g,served),keys:[]};out.push(r)}r.keys.push({k,i})});
  return out}
 // Confirm keys (Lock, TV power, Stop water): armed at armedAt, a press inside ARM_MS fires, anything else arms (again).
 const ARM_MS=3000;
 const confirmStep=(armedAt,now)=>typeof armedAt==='number'&&now>=armedAt&&now-armedAt<ARM_MS?'fire':'arm';
 // a held Enter repeats keydown; only a fresh press may activate a key
 const freshEnter=e=>!(e&&e.key==='Enter'&&e.repeat);
 // a key's spoken name: the words on it in the order the eye reads them. The icon is drawn first, so a letter or digit in it comes
 // first ("1 WS 1", "1 To 1" for the arrow-and-1 icon); a picture icon (an emoji, an arrow alone) adds nothing
 const say=k=>{const ic=String((k&&k.icon)||'').replace(/[^\p{L}\p{N}]+/gu,''),lb=String((k&&k.label)||'').trim();return ic&&lb?ic+' '+lb:lb||ic};
 return {GROUPS,label,group,rows,ARM_MS,confirmStep,freshEnter,say};
})();
// ==== KEY ROWS HELPERS END ====
// Keys page: one labelled grid per group. css/pad.css sizes the grid (whole keys, as many columns as fit), so nothing here measures.
function renderKeys(){const c=$('#keys');c.innerHTML='';
 KEYROWS.rows(keys,keyGroups).forEach(grp=>{
  const row=document.createElement('div');row.className='krow';row.dataset.g=grp.id;
  row.innerHTML='<h2 class="klab">'+esc(grp.name)+'</h2><div class="kgrid cards" role="group" aria-label="'+esc(grp.name)+'"></div>';
  c.appendChild(row);
  const grid=row.querySelector('.kgrid');
  grp.keys.forEach(({k,i})=>grid.appendChild(keyBtn(k,i)))});
 if(typeof spacesSeen!=='undefined'&&spacesSeen&&typeof paintSpaces==='function')paintSpaces(spacesSeen[0],spacesSeen[1])}
// ---- shared ----
const ago=t=>{if(t==null)return 'time unknown';const s=Math.max(0,Math.round(Date.now()/1000-t));return s<45?'just now':s<5400?Math.max(1,Math.round(s/60))+' min ago':s<172800?Math.round(s/3600)+' h ago':Math.round(s/86400)+' d ago'};
const hhmm=t=>t==null?'':new Date(t*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const SD=k=>'<i class="sd '+k+'"></i>';
const stOf=c=>/\bbad\b/.test(c||'')?'bad':/\bstale\b/.test(c||'')?'warn':/\bok\b/.test(c||'')?'ok':'';
const wxWord=s=>{if(!s||!s.state)return 'No reading';const w=String(s.state).replace(/[-_]+/g,' ');return w.charAt(0).toUpperCase()+w.slice(1)};
const T=(h,v,t,cls,dg)=>{const k=stOf(cls);return '<div class="tile '+(cls||'')+'"><div class="h">'+(k?SD(k):'')+esc(h)+'</div><div class="v">'+esc(v)+'</div>'+(t?'<div class="t">'+esc(t)+'</div>':'')+(typeof TodayUI==='object'?TodayUI.dgH(dg):'')+'</div>'};
// a request that never answers is cut off after 60 s: it must not leave a page blank or hold its "busy" flag (deck.js once()) forever
// A fetch that never reaches the deck server marks the status pill offline on every page (the host pollers only run on Home and Pad); the next answer clears it.
const netState=up=>{if(up){if(errText==='offline'){errText='';showSt()}}else if(errText!=='offline'){errText='offline';errMsg='';showSt()}};
// every page's reads (DeckPages.get) say the same: deck:net {up} from the registry (PlanEng item 1, E6)
document.addEventListener('deck:net',e=>netState(!!(e&&e.detail&&e.detail.up)));
const jget=async p=>{const c=typeof AbortController==='function'?new AbortController():null,t=c?setTimeout(()=>c.abort(),60000):0;try{let r;try{r=await fetch(p,c?{signal:c.signal}:undefined)}catch(e){netState(false);throw e}netState(true);if(!r.ok)throw new Error(r.status);return await r.json()}finally{clearTimeout(t)}};
// Now-playing art shows only when it is same-origin: the shell blocks every other host, and nothing may fetch off-origin under the OmarchyDeck/ user agent.
// Returns the path to use, or '' (hide the picture) for any other origin, scheme, data: or blob: URL.
const artSrc=(u,origin)=>{try{if(typeof u!=='string'||!u||typeof origin!=='string')return '';const x=new URL(u,origin);return /^https?:$/.test(x.protocol)&&x.origin===origin?x.pathname+x.search:''}catch(e){return ''}};
// ==== TODAY UI HELPERS BEGIN (pure: no DOM, no fetch; the only global it reads is DeckUI.redact, looked up per call) ====
// Design v3 (2026-11-14): Today's models and markup live in deck.js (DeckUI.td*); what stays here is the hidden-detail span that the
// shared tile T() and Fleet's chip() write.
const TodayUI=(()=>{
 const escH=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // technical detail rides in a hidden .diag span; the detail sheet shows it under "Details". It goes through the deck's ONE redaction rule (DeckUI.redact in
 // deck.js, looked up when a span is written, so nothing here can drift from it): home folders read "~", credentials and account flags are masked. Without
 // that rule (deck.js not loaded yet) a span is not written at all.
 const redactor=()=>{try{return typeof DeckUI==='object'&&DeckUI&&typeof DeckUI.redact==='function'?DeckUI.redact:null}catch(e){return null}};
 const dgH=ds=>{const r=redactor();return r?(Array.isArray(ds)?ds:[]).filter(x=>typeof x==='string'&&x).map(x=>'<span class="diag">'+escH(r(x))+'</span>').join(''):''};
 return {escH,dgH};
})();
// ==== TODAY UI HELPERS END ====
// deck.js (loaded after this file) owns the shared wording; wait for it, but never hang if it did not load
const deckReady=()=>typeof DeckUI==='object'?Promise.resolve():new Promise(r=>{addEventListener('DOMContentLoaded',r,{once:true});setTimeout(r,3000)});
const probOf=x=>typeof DeckUI==='object'?DeckUI.problem(x):{line:'Not reporting. It tries again on its own.',diag:[]};
// ---- fleet ----
function chip(b,s,ok,cls,dg){return '<div class="chip'+(ok?'':' bad')+(cls?' '+cls:'')+'"><b>'+SD(ok?'ok':'bad')+esc(b)+'</b><small>'+esc(s)+'</small>'+TodayUI.dgH(dg)+'</div>'}
const grp=n=>{const w=n.split('-')[0];return w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()};
// A blank Fleet body is never shown: loading, a failed read and an all-empty read each say what is going on (DeckUI.fleetNotice in deck.js).
const fleetWhy=e=>/^\d+$/.test(String(e&&e.message))?'http '+e.message:'deck server did not answer';
// Fleet's three column bodies. On the TV they fill #fl1, #fl2 and #fl3, the three columns under the board. Elsewhere each section (a title
// and every block up to the next title) is one whole child of #fleet, so a title never ends one column while its blocks open the next
// (layout second pass, 2026-11-15), and DeckBalance (data-balance on #fleet) balances the sections into the columns CSS draws. data-fc
// keeps each block's column for markUrgent; on L and T the third column's sections span the width under the balanced two.
let fleetCols=null,fleetGood=null,fleetUnitsAll=false,fleetUnitsHtml='',fleetUnitsData=null;
function fleetPlace(c){const box=$('#fleet');if(!box)return;fleetCols=c;const root=document.documentElement;
 if(root.classList.contains('tv')){box.innerHTML=c.map((h,i)=>'<div id="fl'+(i+1)+'" data-fc="'+(i+1)+'">'+h+'</div>').join('');return}
 const wide=/^[LT]$/.test(root.dataset.dc||''),t=document.createElement('template'),out=document.createDocumentFragment();
 c.forEach((h,i)=>{t.innerHTML=h;let s=null;[...t.content.childNodes].forEach(n=>{
  if(n.nodeType===1&&(!s||n.classList.contains('secttl'))){s=document.createElement('section');s.className='fsec'+(i===2&&wide?' span-all':'');s.dataset.fc=String(i+1);out.appendChild(s)}
  if(s)s.appendChild(n)})});
 box.textContent='';box.appendChild(out)}
document.addEventListener('deck:class',()=>{if(fleetCols)fleetPlace(fleetCols)});
// Background services opens at eight rows, as Agent runs does; Show more opens the rest until the page reloads or Show fewer. The opened
// list carries data-bal-open, so its section keeps its column (DeckBalance); after Show fewer the section's title comes back into view.
document.addEventListener('click',e=>{const b=e.target&&e.target.closest&&e.target.closest('[data-more="fleetunits"]');if(!b)return;const less=!!b.dataset.less;fleetUnitsAll=!less;
 const next=DeckUI.bUnits(fleetUnitsData,Date.now(),fleetUnitsAll),t=document.createElement('template');t.innerHTML=next;
 const m=b.closest('.more-row'),list=m.previousElementSibling,head=list.previousElementSibling,section=b.closest('.fsec');
 head.replaceWith(t.content.querySelector('.secttl'));list.replaceWith(t.content.querySelector('.flist'));m.replaceWith(t.content.querySelector('.more-row'));
 fleetCols=fleetCols.map(h=>h.replace(fleetUnitsHtml,next));if(fleetGood)fleetGood=fleetGood.map(h=>h.replace(fleetUnitsHtml,next));fleetUnitsHtml=next;
 if(less)DeckBalance.fewer(section)});
// #fsum, the page's first block: the urgent rows, the one computed line, then one strip of counters (DeckUI.fleetSummary). It sits in the
// Fleet container before #fleet and is the TV board (.board: tv.css gives it the screen, the rest is one Down press below). It is made before
// any read and holds the loading line, and #fleet stays empty until the reads land and the stall strip (ops.js) has painted once, so nothing
// above the board or inside its first column grows after the columns paint (P5: the board dropped 325 px a second after a cold load).
function fsumBox(){let s=$('#fsum');if(!s&&$('#fleet')){$('#fleet').insertAdjacentHTML('beforebegin','<div id="fsum" class="board"></div>');s=$('#fsum')}return s}
async function fleet(){try{
 const fsum=fsumBox();
 if(!fleetCols&&fsum&&!fsum.firstChild)fsum.innerHTML=T('Fleet','Loading','Reading the fleet checks and the fleet board','stale');
 await deckReady();
 if(typeof DeckUI!=='object')throw new Error('deck.js did not load');
 const [f,nd,dk,st,mc,signals,cm]=await Promise.all([jget('/api/fleet').catch(e=>({error:fleetWhy(e),items:[]})),...['nodes','disks','sites','mcp'].map(x=>jget('/api/'+x).catch(()=>({error:'deck server did not answer'}))),
  jget('/api/fleet-widgets').catch(()=>null),jget('/api/cams').catch(()=>null)]);
 let bd=null;try{bd=await jget('/api/fleet-board')}catch(e){}fleetLast=bd;
 // the stall strip and the network snapshot (ops.js) arrive with the board, never after it: three seconds at most
 if(window.STALLS_FIRST)await Promise.race([window.STALLS_FIRST,new Promise(r=>setTimeout(r,3000))]);
 const N=DeckUI.fleetNotice({f,nd,dk,st,mc,bd}),now=Date.now();
 if(N.blank){if(fsum)fsum.innerHTML='';fleetGood=null;fleetPlace([N.html,'','']);homeMark('fleet',{age:null,refresh:300,missing:1});return}
 if(fsum)fsum.innerHTML=DeckUI.fleetSummary({f,st,bd,nd}).html;
 const B=DeckUI.board(bd,now,{allUnits:fleetUnitsAll,nodes:nd});
 const fOk=!!f&&!f.error,it=fOk?(f.items||[]):[];
 const gone=(name,x)=>{const p=probOf(x);return T(name,'Not reporting',p.line,'bad',p.diag)};
 const none=(h,why)=>T(h,'None reported',why,'stale');
 // design v3: a section title says "Out of date" when its feed is old and carries no age; the page has one freshness mark
 const fr=x=>x&&x.stale?'Out of date':'';
 // the stall watch strip (ops.js) sits on top of the first column; it keeps its own last render in window.STALLS_HTML
 const c1='<div id="stalls">'+(window.STALLS_HTML||'')+'</div>'+(B[1]||'')+
  '<div class="secttl"><span>Cluster nodes</span><span>'+fr(nd)+'</span></div>'+DeckUI.fleetNodes(nd)+
  (mc.error?gone('Tools',mc):T('Tools',mc.up+' up \u00B7 '+mc.down+' down',mc.stale?'Out of date':'',mc.down>0?'bad':mc.stale?'stale':'ok'));
 const by={};(st.items||[]).forEach(x=>{(by[grp(x.name)]=by[grp(x.name)]||[]).push(x)});
 const sites=st.error?gone('Site check',st):!(st.items||[]).length?none('Product sites','The sites feed returned an empty list'):'<div id="fst">'+Object.keys(by).map(g=>{const a=by[g],dn=a.filter(x=>!x.ok),mx=Math.max(...a.map(x=>x.ms||0));return chip(g+' '+(a.length-dn.length)+'/'+a.length,dn.length?'Down: '+dn.map(x=>x.name.replace(/^\w+-/,'')).join(', '):'Up \u00B7 slowest '+mx+' ms',!dn.length,'sm'+(st.stale?' stale':''))}).join('')+'</div>';
 // Services and Hosts in the ops state words (R1): a service with no reading is Not reported, never down; a host's address rides in the sheet
 const c2=DeckUI.fleetServices(f)+
  '<div class="secttl"><span>Product sites</span><span>'+fr(st)+'</span></div>'+sites+(B[3]||'')+(B[4]||'')+DeckUI.fleetSignals(signals,now);
 const ops=window.OPS_LAST||{},stamp=fOk?Date.parse(f.stamp)/1000:NaN;
 // Machines (or the disk rows), then Devices (L25), then models and the fleet check tiles: a failed check is one Not reporting line with Try again
 const c3=(B[0]||('<div class="secttl"><span>Disks</span><span>'+fr(dk)+'</span></div>'+DeckUI.fleetDisks(dk)))+DeckUI.fleetDevices({ts:ops.t,ha:ops.h,f,bd,cams:cm},now)+(B[2]||'')+
  DeckUI.fleetFacts(it)+(fOk&&f.rc?'<p class="tnote">A source is out of date.</p>':'');
 const next=[c1,c2,c3];fleetPlace(next);fleetGood=next;fleetUnitsData=bd&&bd.units;fleetUnitsHtml=B[4]||'';
 homeMark('fleet',{age:isFinite(stamp)?Math.max(0,Math.round(Date.now()/1000-stamp)):null,refresh:300,missing:[f,nd,dk,st,mc].filter(x=>!x||x.error).length+(bd?0:1)})
}catch(e){const why=fleetWhy(e);
 if(fleetGood)fleetPlace([T('Fleet refresh failed',why,'Showing the last good read','bad').replace('class="tile','id="fnote" class="tile')+fleetGood[0],fleetGood[1],fleetGood[2]]);
 else{fleetPlace([(typeof DeckUI=='object'&&DeckUI.fleetNotice)?DeckUI.fleetNotice({err:why}).html:T('Fleet','Not reachable',why,'bad'),'','']);{const s=$('#fsum');if(s)s.innerHTML=''}homeMark('fleet',{age:null,refresh:300,missing:1})}}}
let fleetLast=null;
// Fleet is not a red wall: a failing item reads from its mark and its word. The single most urgent one (a machine first, then a host, then a site) carries the fill.
function markUrgent(){document.querySelectorAll('#fleet .urgent').forEach(e=>e.classList.remove('urgent'));
 // Machines tiles (.tile.node) are built by DeckUI.bMachines into the third column; the older cluster-node tiles sit in the first (#fnd). Both are machines,
 // so both come before a device row, a host or a site. Only Down carries .bad (R1), so a part with no reading is never the filled one.
 for(const s of ['#fleet [data-fc="3"] .node.bad','#fleet #fnd .tile.bad','#fleet .fdev .frow.bad','#fleet #frc .chip.bad','#fleet #fst .chip.bad','#fleet [data-fc="1"] .tile.bad','#fleet [data-fc="2"] .chip.bad']){const e=document.querySelector(s);if(e){e.classList.add('urgent');return}}}
// fleetPlace replaces #fleet's children (and DeckBalance moves the sections into column boxes): each change marks the one urgent item again
if(typeof MutationObserver==='function'){const e=$('#fleet');if(e)new MutationObserver(markUrgent).observe(e,{childList:true})}
// ---- house ----
// ==== HOUSE UI HELPERS BEGIN (pure: no DOM, no fetch, no globals; tests/house_ui.test.js loads this block) ====
const HouseUI=(()=>{
 const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const num=v=>typeof v==='number'&&isFinite(v)?v:null;
 const chargingOf=s=>/charg/i.test(s||'')&&!/not |dis|stop|complete|idle|done/i.test(s||'');
 const on=s=>typeof s==='string'&&s!=='unavailable'&&s!=='unknown'&&s!=='';
 // One calm line of what the house is doing now. Every fact names the entity it came from, and a fact is
 // only printed when its source answered: no lock sensors means no lock claim, never "all locked".
 function facts(ha,car,cams){
  const e=isObj(ha)&&isObj(ha.entities)&&!ha.error?ha.entities:{},ids=Object.keys(e),out=[];
  const st=id=>isObj(e[id])?e[id]:null;
  const locks=ids.filter(id=>/^lock\./.test(id)&&on(e[id].state));
  const doors=ids.filter(id=>/^binary_sensor\..*(door|garage|window|entry)/.test(id)&&on(e[id].state));
  const temps=ids.filter(id=>/^sensor\..*temperature/.test(id)&&on(e[id].state)&&isFinite(Number(e[id].state)));
  if(locks.length){const open=locks.filter(id=>e[id].state!=='locked').length;
   out.push({k:'Locks',v:open?open+' unlocked':'all locked',mark:open?'bad':'ok',src:locks.length+' lock entities'})}
  if(doors.length){const open=doors.filter(id=>e[id].state==='on').length;
   out.push({k:'Doors',v:open?open+' open':'all closed',mark:open?'bad':'ok',src:doors.length+' door sensors'})}
  if(temps.length){const vals=temps.map(id=>Number(e[id].state)),t=Math.round(Math.max(...vals));
   out.push({k:'Warmest room',v:t+' '+(e[temps[0]].unit||'\u00B0F'),mark:t>=82?'bad':t>=78?'warn':'ok',src:temps.length+' temperature sensors'})}
  const cs=isObj(cams)&&Array.isArray(cams.cams)?cams.cams.filter(x=>x&&typeof x.ready==='boolean'):null;
  const ready=cs?cs.filter(x=>x.ready).length:null;
  if(ready!=null)out.push({k:'Cameras',v:ready+' of '+cs.length+' live',mark:ready===cs.length?'ok':ready?'warn':'bad',src:'MediaMTX paths'});
  if(isObj(car)&&!car.error){
   const b=num(car.battery),ch=chargingOf(String(car.charging||''));
   if(b!=null)out.push({k:'Car',v:Math.round(b)+'%'+(ch?' charging':'')+(car.locked===true?' \u00B7 locked':car.locked===false?' \u00B7 UNLOCKED':''),
    mark:car.locked===false||car.stale?'warn':'ok',src:'car.json'})}
  const wc=st('binary_sensor.whoop_local_connected'),wb=st('sensor.whoop_local_battery');
  if(wc)out.push({k:'WHOOP',v:wc.state==='on'?'on the wrist':'off',mark:wc.state==='on'?'ok':'warn',
   src:wb&&on(wb.state)?'strap '+Math.round(Number(wb.state))+'%':'strap'});
  return out}
 // The line keeps four facts; the rest stay available as the tooltip so nothing is invented or dropped silently.
 function nowLine(ha,car,cams){
  const fs=facts(ha,car,cams),hasHa=isObj(ha)&&!ha.error;
  const miss=[];
  if(!hasHa)miss.push('Home Assistant');
  if(hasHa&&!fs.some(f=>f.k==='Locks'))miss.push('lock sensors');
  if(hasHa&&!fs.some(f=>f.k==='Doors'))miss.push('door sensors');
  return {facts:fs,shown:fs.slice(0,4),text:fs.slice(0,4).map(f=>f.k.toLowerCase()+' '+f.v).join(' \u00B7 '),
   title:fs.map(f=>f.k+': '+f.v+' ('+f.src+')').join('\n'),
   mark:!fs.length?'bad':fs.some(f=>f.mark==='bad')?'bad':fs.some(f=>f.mark==='warn')?'warn':'ok',
   note:miss.length?'not reported: '+miss.join(', '):''}}
 // A live tile that stops advancing is dead even when the element still looks fine: 5 s without a frame
 // counts as a stall, and the tile drops to snapshots instead of waiting for its 9 s timer.
 const STALL_MS=5000;
 function stalled(now,lastFrameAt){const a=num(now),b=num(lastFrameAt);if(a==null||b==null)return false;return a-b>=STALL_MS}
 // Home Assistant weather states arrive as one word ("partlycloudy"); the tile says it like a person would.
 const WEATHER={clear:'Clear',sunny:'Sunny',partlycloudy:'Partly cloudy',cloudy:'Cloudy',fog:'Fog',hail:'Hail',
  lightning:'Lightning',lightning_rainy:'Lightning and rain',rainy:'Rain',pouring:'Heavy rain',snowy:'Snow',
  'snowy-rainy':'Snow and rain',windy:'Windy',windy_variant:'Windy',exceptional:'Severe'};
 const weatherWord=s=>{if(!s||!s.state)return '--';const k=String(s.state).toLowerCase();
  return WEATHER[k]||(k.charAt(0).toUpperCase()+k.slice(1).replace(/[-_]+/g,' '))};
 // House now (Home's first line). Internet and router (HA reachability sensors), cameras (MediaMTX ready), tailnet (own devices online),
 // the car's lock and whether you are home (person.mesh). Each fact comes from its own source; a missing one says "not reported", never a guess.
 // The house facts above (locks, doors, warmest room, WHOOP) ride after them when Home Assistant serves those entities.
 const ageOf=(t,now)=>{const x=num(t),n=num(now);if(x==null||n==null)return '';const s=Math.max(0,Math.round(n/1000-x));return s<45?'just now':s<5400?Math.max(1,Math.round(s/60))+' min ago':s<172800?Math.round(s/3600)+' h ago':Math.round(s/86400)+' d ago'};
 function headline(ha,car,cams,now,ts){
  const haOk=isObj(ha)&&!ha.error&&isObj(ha.entities),e=haOk?ha.entities:{};
  const st=id=>isObj(e[id])&&on(e[id].state)?e[id]:null;
  const parts=[];let bad=0,warn=0,miss=0,seen=0;
  const reach=(id,label)=>{const s=st(id);if(!s){miss++;parts.push(label+' not reported');return}seen++;const up=s.state==='on';if(!up)bad++;parts.push(label+(up?' up':' down'))};
  reach('binary_sensor.internet_reachable','Internet');reach('binary_sensor.router_reachable','Router');
  const cs=isObj(cams)&&!cams.error&&Array.isArray(cams.cams)?cams.cams.filter(x=>x&&typeof x.ready==='boolean'):[];
  if(cs.length){seen++;const r=cs.filter(x=>x.ready).length;if(!r)bad++;else if(r<cs.length)warn++;parts.push(r+' of '+cs.length+' cameras live')}else{miss++;parts.push('Cameras not reported')}
  const tc=isObj(ts)&&!ts.error&&isObj(ts.counts)?ts.counts:null,own=tc?num(tc.own_devices):null,up=tc?num(tc.own_online):null;
  if(own!=null&&up!=null&&own>0){seen++;if(up<own)warn++;parts.push('Tailnet '+up+' of '+own+' online')}else{miss++;parts.push('Tailnet not reported')}
  const cached=isObj(car)&&(car.stale===true||car.fresh===false);
  if(isObj(car)&&!car.error&&typeof car.locked==='boolean'){seen++;if(!car.locked)warn++;parts.push('Car '+(car.locked?'locked':'unlocked')+(cached?' (cached)':''))}else{miss++;parts.push('Car not reported')}
  const p=st('person.mesh');if(p){seen++;parts.push(p.state==='home'?'Home':p.state==='not_home'?'Away':p.state.charAt(0).toUpperCase()+p.state.slice(1).replace(/_/g,' '))}else{miss++;parts.push('Presence not reported')}
  if(haOk)facts(ha,null,null).slice(0,2).forEach(f=>parts.push(f.k+' '+f.v));
  if(!seen)return {mark:'bad',word:'House not reporting',line:'Home Assistant, the cameras, the tailnet and the car did not answer. It tries again on its own.',src:'',title:''};
  const upd=['binary_sensor.internet_reachable','binary_sensor.router_reachable','person.mesh'].map(id=>isObj(e[id])?num(e[id].updated):null).filter(x=>x!=null);
  const src=[haOk?'Home Assistant'+(upd.length?' '+ageOf(Math.max(...upd),now):''):'Home Assistant not reporting',cs.length?'MediaMTX':'',tc?'tailnet'+(num(ts.t)!=null?' '+ageOf(ts.t,now):''):'',
   isObj(car)&&!car.error?'car'+(num(car.seen)!=null?' seen '+ageOf(car.seen,now):''):''].filter(Boolean).join(' \u00B7 ');
  // unknown is not down (R1): a part that did not report gives the dash mark; amber is for a part that answered and is partly up
  return {mark:bad?'bad':warn?'warn':miss?'off':'ok',word:bad?'Needs a look':warn?'Check the house':miss?'Partly reported':'All good',line:parts.join(' \u00B7 '),src,title:parts.join('\n')}}
 // The status card line (design v3, review F2): what is there reads as itself, everything "not reported" folds into one count.
 // The full list stays in the card's title (headline().title), so nothing is dropped.
 function shortLine(line){const ps=String(line||'').split(' \u00B7 ').map(s=>s.trim()).filter(Boolean),miss=ps.filter(p=>/ not reported$/.test(p));
  return ps.filter(p=>!/ not reported$/.test(p)).concat(miss.length===1?miss:miss.length?[miss.length+' not reported']:[]).join(' \u00B7 ')}
 // An Apple Watch with no readings is one row, not a card: one word, one short line; the how-to rides into the detail sheet.
 function watchRow(w){const o=isObj(w)?w:{};
  if(!isObj(w)||o.error)return {word:'Not reporting',line:o.error==='file missing'?'No watch file yet':'The watch feed did not answer'};
  const unlinked=o.near===false&&o.connected===false;
  return {word:unlinked?'Not linked':'No readings',line:typeof o.reason==='string'&&o.reason.trim()?o.reason.trim().slice(0,120):unlinked?'Not linked to the Mac mini':'Nothing has arrived yet'}}
 // ---- the readings strip (House row 1, #hrd): what changes during the day, one figure each with its unit beside it ----
 // a percentage from a feed: a finite number from 0 to 100, else null ("No reading"); never pushed into range (X4, decision 9)
 const pct=v=>{const n=num(v);return n==null||n<0||n>100?null:n};
 // s = GET /api/stats of the chosen host. A part with no figure reads No reading and draws no bar; hot means the warn shade on its bar
 function readings(s){s=isObj(s)?s:{};const ld=Array.isArray(s.load)?num(s.load[0]):null,ct=num(s.cpu_temp),gt=num(s.gpu_temp),gb=num(s.ram_gb),cpu=pct(s.cpu_pct),ram=pct(s.ram_pct),gpu=pct(s.gpu_util);
  return [{id:'rcpu',label:'CPU',pct:cpu,sub:ct!=null&&ct>0?Math.round(ct)+'\u00B0C':ld!=null?'load '+ld:'',hot:ct!=null&&ct>=85},
   {id:'rram',label:'RAM',pct:ram,sub:gb!=null?'of '+Math.round(gb)+' GB':'',hot:ram!=null&&ram>=95},
   {id:'rgpu',label:'GPU',pct:gpu,sub:gt!=null?Math.round(gt)+'\u00B0C':'',hot:gt!=null&&gt>=85}]}
 // one strip cell's inside, from readings(): the label, the figure with its unit beside it, the bar under it. The label is fixed text and
 // the sub is built from checked numbers; txt keeps only letters, digits, spaces and "%.°", so nothing can open a tag (no escape copy)
 function readTile(o){o=isObj(o)?o:{};const p=pct(o.pct),txt=s=>String(s==null?'':s).replace(/[^\w %.°]/g,'');
  return '<span class="h">'+txt(o.label)+'</span><b class="v">'+(p==null?'<span class="na">No reading</span>':Math.round(p)+'%'+(o.sub?'<span class="u">'+txt(o.sub)+'</span>':''))+'</b>'+
   (p==null?'':'<div class="bar'+(o.hot?' hot':'')+'"><i style="width:'+Math.round(p)+'%"></i></div>')}
 // the inside temperature when Home Assistant has one: a room or thermostat sensor, never an outdoor, weather, chip or battery one
 const NOT_INSIDE=/outdoor|outside|exterior|weather|forecast|cpu|gpu|nvme|ssd|disk|battery|cartridge|car_|tesla|whoop|watch|pool|freezer|fridge/;
 function insideTemp(ha){const e=isObj(ha)&&!ha.error&&isObj(ha.entities)?ha.entities:{};
  const ids=Object.keys(e).filter(id=>/^sensor\..*temperature/.test(id)&&!NOT_INSIDE.test(id)&&isObj(e[id])&&on(e[id].state)&&isFinite(Number(e[id].state)));
  const id=ids.find(x=>/inside|indoor|living|thermostat|house|home|hall/.test(x))||ids[0];if(!id)return null;
  return {v:Math.round(Number(e[id].state)),unit:typeof e[id].unit==='string'&&e[id].unit?e[id].unit:'\u00B0F'}}
 return {facts,nowLine,headline,shortLine,watchRow,weatherWord,stalled,chargingOf,STALL_MS,readings,readTile,insideTemp};
})();
// ==== HOUSE UI HELPERS END ====

// ==== HOUSE HEALTH BEGIN (pure: no DOM, no fetch; tests/house_health.test.js loads this block) ====
// null = the watch has no reading for it; the House page says "No data" (one empty state when none of the health sensors report).
// Move, exercise and stand are the Activity rings (/api/watch move_kcal, exercise_min, stand_h).
const HEALTH_SENSORS=[['Heart rate','hr',' bpm'],['HRV','hrv',' ms'],['Sleep','sleep_h',' h'],['Watch battery','battery','%'],['Move','move_kcal',' kcal'],['Exercise','exercise_min',' min'],['Stand','stand_h',' h']];
const nm=(s,d)=>{const v=s&&s.state!=null&&s.state!=='unavailable'&&s.state!=='unknown'?s.state:null;return v==null?null:(isNaN(+v)?String(v):(+v).toFixed(d??0))+(s.unit?' '+s.unit:'')};
const healthRows=w=>{if(!w||typeof w!=='object')return HEALTH_SENSORS.map(([l])=>({label:l,value:null}));
 return HEALTH_SENSORS.map(([l,k,u])=>{const n=w[k];const ok=typeof n==='number'&&isFinite(n);return {label:l,value:ok?(Number.isInteger(n)?String(n):n.toFixed(1))+u:null}})};
// ==== HOUSE HEALTH END ====
// the car is one reading in House's strip (#car, DeckUI.carReading): battery, range, "Last seen" when the values are cached; the rest in its sheet
async function car(){let c=null;try{c=await jget('/api/car')}catch(e){c={error:'deck did not answer'}}
 const el=$('#car');if(el&&typeof DeckUI==='object'){const r=DeckUI.carReading(c,Date.now());el.innerHTML=r.html;el.classList.toggle('stale',r.k==='stale'||r.k==='warn')}return c}
// the inside temperature joins the strip only while Home Assistant has one; the strip's count follows, so its rows stay full
function paintInside(t){const s=$('#hrd');if(!s)return;let el=$('#rtmp');
 if(t&&!el){el=document.createElement('div');el.className='tile';el.id='rtmp';s.appendChild(el)}
 if(t)el.innerHTML='<span class="h">Inside</span><b class="v">'+esc(t.v)+'<span class="u">'+esc(t.unit)+'</span></b>';else if(el)el.remove();
 const n=String(s.querySelectorAll(':scope>.tile').length);s.dataset.n=n;s.dataset.nb=n}
// the status line is House's first data (R1): one mark and one line; the word ("Partly reported") is read out but the header mark carries it on screen
function paintHouseNow(h){const el=$('#hn');if(!el)return;el.dataset.mark=h.mark;el.title=h.title||'';el.classList.add('flist');
 el.innerHTML='<div class="hnl">'+SD(h.mark)+'<span class="vh">'+esc(h.word)+': </span><span class="hnf">'+esc(HouseUI.shortLine(h.line)||h.word)+'</span></div>'}
// the Home Assistant block under House (#hax) is house.js (window.DeckHouse); it paints on every House refresh and stays empty until that file loads
function houseExtra(){const el=$('#hax');if(!el||!window.DeckHouse||typeof DeckHouse.render!=='function')return;try{Promise.resolve(DeckHouse.render(el,Date.now())).catch(()=>{})}catch(e){}}
document.addEventListener('DOMContentLoaded',()=>{if(ROLE.known&&!GUEST&&onHouse())houseExtra()});
// a guest House is cameras and the bedroom speaker button: Home Assistant states, Apple Watch, car and ink are owner reads
async function ha(){if(GUEST)return;houseExtra();
 const [hr,cr,cm,tr]=await Promise.allSettled([jget('/api/ha'),car(),jget('/api/cams'),jget('/api/tailscale')]);
 const val=x=>x.status==='fulfilled'?x.value:{error:'deck did not answer'};
 try{paintHouseNow(HouseUI.headline(val(hr),val(cr),val(cm),Date.now(),val(tr)))}catch(err){}
 try{if(hr.status!=='fulfilled')throw hr.reason;const r=hr.value||{},e=r.entities||{};
 let watch=null;try{watch=await jget('/api/watch')}catch(err){watch={error:'deck did not answer'}}
 if(r.error){$('#vit').innerHTML=typeof DeckUI==='object'?DeckUI.empty({k:'bad',title:'House is not reporting',line:'No answer yet. It tries again on its own.',diag:[String(r.error).slice(0,80)]}):T('House','Not reporting','No answer yet. It tries again on its own.','bad',[String(r.error).slice(0,80)]);homeMark('house',{age:null,refresh:60,missing:1});return}
 // design v3: no per-tile age and no source name on the page; the House header carries the one freshness mark (homeMark, deck.js)
 const upd=Object.keys(e).map(k=>e[k]&&typeof e[k].updated==='number'?e[k].updated:null).filter(x=>x!=null);
 const health=healthRows(watch&&!watch.error?watch:null);
 const why=watch&&watch.error?(watch.error==='file missing'?'No watch file yet. It shows up after the next hourly check.':'The watch feed did not answer. It tries again on its own.'):(watch&&watch.reason)||'';
 const wr=HouseUI.watchRow(watch),wrow='<div class="flist"><div class="frow"><span class="fl"><b>Apple Watch</b><small>'+esc(wr.line)+'</small></span><span class="fr"><b>'+esc(wr.word)+'</b></span>'+TodayUI.dgH([why,watch&&watch.error?String(watch.error).slice(0,80):''].filter(Boolean))+'</div></div>';
 const readings=!(watch&&watch.error)&&health.some(x=>x.value!=null)?health.map(x=>T(x.label,x.value==null?'No data':x.value,'')).join(''):wrow;
 $('#vit').innerHTML=readings+T('Weather',wxWord(e['weather.forecast_home']),'','wxt');
 // the printer (W5): two ink tiles while it reports, one quiet row while it is offline
 $('#ink').innerHTML=DeckUI.printer(e,Date.now());
 paintInside(HouseUI.insideTemp(r));
const b=e['media_player.main_bedroom'];$('#bedst').textContent=b?b.state:'No reading';$('#bedsrc').textContent='';
 homeMark('house',{age:upd.length?Math.max(0,Math.round(Date.now()/1000-Math.max(...upd))):null,refresh:60,missing:[cr,cm,tr].filter(x=>x.status!=='fulfilled'||!x.value||x.value.error).length+(watch&&watch.error?1:0)})}catch(e){$('#vit').innerHTML=typeof DeckUI==='object'?DeckUI.empty({k:'bad',title:'House is not reporting',line:'The deck did not answer. It tries again on its own.'}):T('House','Not reporting','The deck did not answer. It tries again on its own.','bad')}}
$('#bedpp').onclick=()=>{const b=$('#bedpp');oneCall(b,async()=>{const r=await q('ha-media?v=play-pause',1);flag(r);if(r.failed)tapFail(b,r,'ha-media');setTimeout(ha,800)})};
// ---- cameras: visible House tiles use native HLS media, with sequential JPEG fallback ----
const CAMS=[1,2,3,4],vw=$('#viewer'),vmedia=$('#vmedia'),vv=$('#vv'),vs=$('#vsnap');
const vname=i=>'Cam '+(i+1),camPath=i=>'/cam/eufy_cam'+(i+1)+'/index.m3u8';
const camEntity=i=>'camera.eufy_cam_'+(i+1);
// ==== CAMERA UI HELPERS BEGIN (pure dimensions, rotation and snapshot age) ====
const CameraUI=(()=>{
 const rotation=(raw,i)=>{if(raw==null)return i==2?90:0;const n=Number(raw);return Number.isInteger(n)&&n>=0&&n<=270&&n%90==0?n:(i==2?90:0)};
 const frame=(w,h,r)=>r%180?{w:h,h:w}:{w,h};
 const cacheAge=raw=>raw==null||raw===''||!Number.isFinite(Number(raw))||Number(raw)<0?null:Number(raw);
 // Snapshot fallback re-probes live video: 15 s, 30 s, 60 s ... capped at 5 min; reset once video plays.
 const retryDelay=fails=>Math.min(15000*2**Math.min(Math.max(0,Math.floor(fails)||0),5),300000);
 // Viewer zoom: translate(x,y) scale(s) with origin top-left, 1x to 6x. `box` is the picture inside the
 // W x H viewer (object-fit:contain leaves black bars). Along an axis where the zoomed picture is wider
 // than the viewer it must cover the viewer edge to edge; where it is narrower it stays centered, so a
 // pan never drags the picture into the bars. zoomAt keeps the content under (px,py) at (qx,qy).
 const ZMIN=1,ZMAX=6,ZTAP=2.5;
 const axis=(t,s,b0,bl,L)=>(s*bl>=L?Math.min(-s*b0,Math.max(L-s*(b0+bl),t)):(L-s*bl)/2-s*b0)+0;
 const clampZoom=(z,W,H,box)=>{const s=Math.min(ZMAX,Math.max(ZMIN,Number(z.s)||1)),b=box||{x:0,y:0,w:W,h:H};
  if(s<=ZMIN)return {s:1,x:0,y:0};return {s,x:axis(z.x||0,s,b.x,b.w,W),y:axis(z.y||0,s,b.y,b.h,H)}};
 const zoomAt=(z,s,px,py,qx,qy,W,H,box)=>{const cx=(px-z.x)/z.s,cy=(py-z.y)/z.s,t=Math.min(ZMAX,Math.max(ZMIN,s));return clampZoom({s:t,x:qx-t*cx,y:qy-t*cy},W,H,box)};
 // double tap: zoomed in goes back to 1x, 1x goes to 2.5x around the tap point
 const tapZoom=(z,px,py,W,H,box)=>zoomAt(z,z.s>1.05?1:ZTAP,px,py,px,py,W,H,box);
 // where object-fit:contain puts a sw x sh source (turned by rot degrees) inside W x H
 const contentBox=(W,H,sw,sh,rot)=>{if(!(sw>0&&sh>0))return null;const a=rot%180?sh/sw:sw/sh;
  const w=W/H>a?H*a:W,h=W/H>a?H:W/a;return {x:(W-w)/2,y:(H-h)/2,w,h}};
 // A snapshot frame is a plain same-origin URL with a changing counter: never blob: or data: (the iPhone shell blocks both).
 const snapUrl=(entity,n)=>'/api/cam?e='+encodeURIComponent(String(entity==null?'':entity))+'&live=1&_='+(Math.max(0,Math.floor(Number(n)))||0);
// A tile gives HLS 15 s and the viewer 20 s to start playing, then falls back to snapshot polling. A cold MediaMTX muxer needs 6.4 to 8.6 s for its
// first frame (12 trials, median 7.1 s; docs/release-feedback-20261004.md), so a shorter window tears hls.js down before it can ever play. The snapshot
// poster is on screen from the first frame, so waiting is never black. A muxer that needs longer is picked up by the live probe (15 s, 30 s, 60 s ...).
const giveUpMs=viewer=>viewer?20000:15000;
 // Live video that stops (waiting) and does not resume within this long drops to snapshots instead of showing a stuck state.
 const stallMs=viewer=>viewer?6000:5000;
 // Human status words only; the badge never shows engineering states. state: live | snap | reconnecting | dark | offline | connecting.
 const ageLabel=sec=>{const s=Math.max(0,Math.floor(Number(sec)||0));return s<3?'just now':s<60?s+' s ago':s<3600?Math.floor(s/60)+' min ago':Math.floor(s/3600)+' h ago'};
 const statusText=(state,ageSec)=>state=='live'?'Live':state=='snap'?'Snapshot, '+ageLabel(ageSec):state=='dark'?'Dark image':state=='offline'?'Camera offline':state=='reconnecting'?'Reconnecting':'Connecting';
 // The low-latency config plays a cold stream (first frame 6.4 to 8.6 s) and a warm one (0.3 s). A plain-segment config never played
 // within 20 s on a cold stream (hls.js logged fragGap and level playlist time-outs), so no client gets it.
 const hlsConfig=()=>({lowLatencyMode:true,liveSyncDurationCount:2,liveMaxLatencyDurationCount:4,maxBufferLength:3,backBufferLength:0});
// Which player starts. The iPhone shell (OmarchyDeck/) blocks every non-deck URL with its default-deny content rule list, blob: included, and hls.js hands the
// video a blob: MediaSource, so there it never attaches: the element fails with MEDIA_ERR_SRC_NOT_SUPPORTED at once and hls.js raises no event (reproduced in WebKitGTK
// with the same rule list, qa/webkit-hls-probe.mjs RULES=1). Native HLS is a plain same-origin URL the rule allows, so the shell goes native first; hls.js
// stays first everywhere else (Android Chromium reports native HLS but never fetched the stream on the Pixel). native: canPlayType says HLS plays; hlsjs: hls.js can attach.
const pickEngine=(shell,native,hlsjs)=>shell&&native?'native':hlsjs?'hlsjs':native?'native':'snap';
 // cam-diag beacon body: whitelisted event, camera, mode and at most 12 scalar fields, 2 KB at most; anything else yields null
 const DIAG_EVENT=/^[a-z0-9_.]{1,32}$/,DIAG_KEY=/^[a-z0-9_]{1,24}$/,DIAG_MODES=['hls','snap','native','boot'];
 function diagBody(e,cam,mode,d){
  if(typeof e!=='string'||!DIAG_EVENT.test(e)||!DIAG_MODES.includes(mode))return null;
  const c=Number(cam);if(!Number.isInteger(c)||c<0||c>4)return null;
  const o={};let n=0;
  if(d&&typeof d==='object'&&!Array.isArray(d))for(const k of Object.keys(d)){if(n>=12)break;if(!DIAG_KEY.test(k))continue;const v=d[k];
   if(typeof v==='string')o[k]=v.slice(0,120);else if(typeof v==='boolean')o[k]=v;else if(typeof v==='number'&&Number.isFinite(v))o[k]=v;else continue;n++}
  const body=JSON.stringify({e,cam:c,mode,d:o});
  return body.length<=2000?body:null}
 // at most `total` beacons per page load and `perKey` per key (event and camera); returns true when one may be sent
 function diagBudget(total,perKey){let used=0;const seen={};
  return key=>{const k=String(key);if(used>=total||(seen[k]||0)>=perKey)return false;seen[k]=(seen[k]||0)+1;used++;return true}}
 // Measured rate and stall. The frame counter is getVideoPlaybackQuality (WebKit: webkitDecodedFrameCount). No counter means no rate, never a guess.
 const FRAME_STALL_MS=5000;
 const frameRate=(prev,cur,dtMs)=>Number.isFinite(prev)&&Number.isFinite(cur)&&Number.isFinite(dtMs)&&dtMs>0&&prev>=0&&cur>=prev?(cur-prev)*1000/dtMs:null;
 const rateText=(f,w,h)=>{const size=w>0&&h>0?Math.round(w)+'\u00D7'+Math.round(h):'';return f==null?['rate unknown',size].filter(Boolean).join(' \u00B7 '):[(Math.round(f*10)/10)+' fps',size||'size unknown','measured now'].join(' \u00B7 ')};
 const stalledFor=(lastAt,now,limit)=>Number.isFinite(lastAt)&&lastAt>0&&now-lastAt>limit;
 const hhmm=ms=>{const d=new Date(ms);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};
 const stallText=lastAt=>'Stalled \u00B7 last frame '+hhmm(lastAt);
 const REASONS={timeout:'The camera did not answer',load:'The frame did not load',hls_fatal:'The live stream stopped',stall:'The live stream stopped',video_error:'The video failed',src_blocked:'This browser cannot play the live stream',hls_blocked:'This browser cannot play the live stream',no_support:'This browser cannot play the live stream',start_error:'The live stream did not start'};
 const reasonText=r=>'Reason: '+(Object.prototype.hasOwnProperty.call(REASONS,r)?REASONS[r]:'unknown');
 return {rotation,frame,cacheAge,retryDelay,clampZoom,zoomAt,tapZoom,contentBox,ZMIN,ZMAX,ZTAP,snapUrl,giveUpMs,stallMs,ageLabel,statusText,hlsConfig,pickEngine,diagBody,diagBudget,frameRate,rateText,stalledFor,hhmm,stallText,reasonText,FRAME_STALL_MS};
})();
// ==== CAMERA UI HELPERS END ====
const camRotation=i=>CameraUI.rotation(localStorage.getItem('cam-rotation-'+(i+1)),i);
let vi=0,vOpen=false,hlsP=null,tiles=[],viewer=null;
function loadHls(){if(window.Hls)return Promise.resolve();return hlsP||(hlsP=new Promise((ok,no)=>{const s=document.createElement('script');s.src='/hls.min.js';s.onload=ok;s.onerror=()=>{hlsP=null;s.remove();no()};document.head.appendChild(s)}))}
// The rotated element gets the *swapped viewport* before object-fit. The viewer uses contain (no edge cropped); a tile turned sideways uses cover (.rot) so it fills without side bars.
function fitCamera(s){const r=camRotation(s.i),frame=CameraUI.frame(s.media.clientWidth,s.media.clientHeight,r);
 s.media.style.setProperty('--media-w',frame.w+'px');s.media.style.setProperty('--media-h',frame.h+'px');
 s.media.style.setProperty('--rotation',r+'deg');if(s!==viewer)s.root.classList.toggle('rot',r%180!==0)}
function updateRotation(){tiles.forEach(fitCamera);if(viewer){fitCamera(viewer);$('#vrotate').textContent='Rotate '+camRotation(vi)+'°';$('#vrotate').setAttribute('aria-label','Rotate '+vname(vi)+' clockwise, currently '+camRotation(vi)+' degrees')}}
function rotateViewer(){const next=(camRotation(vi)+90)%360;localStorage.setItem('cam-rotation-'+(vi+1),next);resetZoom();updateRotation()}
function judge(im){try{const c=document.createElement('canvas');c.width=32;c.height=18;const x=c.getContext('2d');x.drawImage(im,0,0,32,18);const d=x.getImageData(0,0,32,18).data;let sum=0;for(let i=0;i<d.length;i+=4)sum+=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];return sum/(d.length/4)}catch(e){return 99}}
function paintStatus(s){paintRate(s);const b=s.root.querySelector('.cam-status');if(!b)return;const t=CameraUI.statusText(s.state||'connecting',s.snapAt?(Date.now()-s.snapAt)/1000:0);if(b.textContent!==t)b.textContent=t}
// Measured rate and stall. A frame counter that advances is a frame shown; one that stops for FRAME_STALL_MS is a stall. No counter, no rate.
function frameCount(v){try{if(v.getVideoPlaybackQuality){const q=v.getVideoPlaybackQuality();if(q&&Number.isFinite(q.totalVideoFrames))return q.totalVideoFrames}if(Number.isFinite(v.webkitDecodedFrameCount))return v.webkitDecodedFrameCount}catch(e){}return null}
function sampleRate(s,now){const n=s.active&&s.mode=='hls'&&s.playing?frameCount(s.video):null;
 if(n==null){s.fps=null;s.rateN=null;s.stalled=false;paintRate(s);return}
 if(s.rateN!=null&&n>s.rateN)s.lastFrameAt=now;
 s.fps=s.rateN==null?null:CameraUI.frameRate(s.rateN,n,now-s.rateT);
 s.rateN=n;s.rateT=now;
 s.stalled=CameraUI.stalledFor(s.lastFrameAt,now,CameraUI.FRAME_STALL_MS);
 paintRate(s)}
function paintRate(s){
 const m=s.video,stalled=!!s.stalled&&!!s.playing;
 const t=stalled?CameraUI.stallText(s.lastFrameAt):s.state=='offline'?CameraUI.reasonText(s.reason):s.state=='live'?CameraUI.rateText(s.fps,m.videoWidth,m.videoHeight):'';
 const el=s.root.querySelector('.cam-rate');if(el&&el.textContent!==t)el.textContent=t;
 if(s===viewer)viewerStall(stalled,t)}
// The viewer shows the stall in its message line with a Retry button; the tile shows the same words on its rate line.
let stallShown=false,vRetry=null;
function viewerStall(on,t){const msg=$('#vmsg');if(!msg)return;
 if(!on){if(stallShown){stallShown=false;msg.textContent='';if(vRetry&&vRetry.parentNode)vRetry.parentNode.removeChild(vRetry)}return}
 if(!vRetry){vRetry=document.createElement('button');vRetry.id='vretry';vRetry.className='vb';vRetry.textContent='Retry';vRetry.setAttribute('aria-label','Retry this camera stream');vRetry.onclick=()=>retryStream(viewer)}
 stallShown=true;msg.textContent=t;msg.appendChild(vRetry)}
// Retry reloads only this stream; the other tiles keep playing.
function retryStream(s){if(!s.active)return;s.stalled=false;s.fps=null;s.reason='';s.fails=0;paintRate(s);startCamera(s)}
function cameraState(s,state){s.state=state;const d=s.root,has=!!s.url;d.dataset.state=state;
 d.classList.toggle('live',state=='live');d.classList.toggle('black',state=='dark');d.classList.toggle('nofeed',state=='offline');d.classList.toggle('old',state=='offline'&&has);
 d.classList.toggle('connecting',!has&&(state=='connecting'||state=='reconnecting'));
 paintStatus(s);
 if(s===viewer){d.classList.toggle('wait',state=='offline'||(!has&&state!='live'&&state!='dark'));d.classList.toggle('blk',state=='dark');
  $('#vmsg').textContent=state=='dark'?'Dark image from '+vname(s.i)+'. The sensor may be covered.':state=='offline'?vname(s.i)+' is offline. Trying again.':'Connecting to '+vname(s.i)}
 else d.querySelector('em').textContent=state=='dark'?'Dark image':state=='offline'?'Camera offline':'Connecting'}
// A tile keeps its last frame when it stops (it comes back with an honest "Snapshot, 3 min ago" instead of black); the viewer shows other cameras, so it clears.
function stopCamera(s,keep){if(!s)return;s.active=false;s.gen++;clearTimeout(s.timer);s.timer=0;clearTimeout(s.retry);s.retry=0;clearTimeout(s.stall);s.stall=0;
 if(s.hls){s.hls.destroy();s.hls=null}
 s.video.pause();s.video.removeAttribute('src');s.video.load();
 if(s===viewer&&!keep){s.image.removeAttribute('src');s.url=null;s.snapAt=0;s.root.classList.remove('poster');vw.classList.remove('snap','wait','blk','old','connecting')}
 s.playing=false;s.root.classList.remove('live')}
function snapshotMode(s,g,reason){if(!s.active||s.gen!=g||s.mode=='snap')return;
 clearTimeout(s.timer);clearTimeout(s.stall);if(s.hls){s.hls.destroy();s.hls=null}s.video.pause();s.video.removeAttribute('src');s.video.load();
 s.reason=reason||'unknown';camDiag('fallback',s.i+1,s.native?'native':'hls',{reason:reason||'unknown',viewer:s===viewer});
 s.mode='snap';s.playing=false;s.root.classList.remove('poster','live');s.root.classList.add('snap');cameraState(s,s.url?'snap':'connecting');snapshot(s,g);scheduleLive(s,g)}
// Keep the last snapshot on screen; only tear it down for HLS once the playlist answers.
function scheduleLive(s,g){clearTimeout(s.retry);s.retry=0;
 // hls.js was refused its MediaSource blob once on this tile (the iPhone shell's content rules): it never works for it, so with no native HLS the tile stays on snapshots and stops probing
 if(s.hlsBlocked&&!canNative(s.video))return;
 s.retry=setTimeout(()=>probeLive(s,g),CameraUI.retryDelay(s.fails++))}
async function probeLive(s,g){if(!s.active||s.gen!=g||s.mode!='snap')return;let ok=false;
 try{const r=await fetch(camPath(s.i),{cache:'no-store',signal:AbortSignal.timeout(5000)});ok=r.ok;if(r.status===401)camKeyReset()}catch(e){}
 if(!s.active||s.gen!=g||s.mode!='snap')return;
 if(ok)startCamera(s);else scheduleLive(s,g)}
// Beacons: fire and forget, never awaited, never throw. At most 40 per page load (5 per event and camera), whitelisted fields only.
const camDiagOk=CameraUI.diagBudget(40,5),DIAG_FIRST=new Set();
function camDiag(e,cam,mode,d){try{const body=CameraUI.diagBody(e,cam,mode,d);if(!body||!camDiagOk(e+':'+cam))return;
 fetch('/api/cam-diag',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body}).catch(()=>{})}catch(err){}}
// snap_ok and snap_fail: the first of each per tile (and per viewer camera) only
function camDiagFirst(e,s,d){const k=e+':'+s.i+':'+(s===viewer?'v':'t');if(DIAG_FIRST.has(k))return;DIAG_FIRST.add(k);camDiag(e,s.i+1,'snap',Object.assign({viewer:s===viewer},d))}
let bootSent=false;
function camBoot(video,eng){if(bootSent)return;bootSent=true;
 camDiag('boot',0,'boot',{hls:typeof Hls!=='undefined',supported:typeof Hls!=='undefined'&&!!Hls.isSupported(),mms:typeof ManagedMediaSource!=='undefined',ms:typeof MediaSource!=='undefined',
  native:canNative(video)?'yes':'no',inline:!!video.playsInline,shell:IN_SHELL,engine:String(eng||''),hlsjs:typeof Hls!=='undefined'&&Hls.version?String(Hls.version):'none'})}
function canNative(video){try{return !!video.canPlayType('application/vnd.apple.mpegurl')}catch(e){return false}}
// The /cam/ key (scoped to /cam/ only) lets the native player's very first request, the master playlist, authorize without relying on the web view's cookie jar;
// every playlist line below it already carries the key. One fetch per page load; an empty answer is not remembered.
// ==== CAM KEY BEGIN (tests/deck20261029_webshell.test.js loads this block with a stub fetch) ====
// A deck server restart mints a new key: a 401 or a media error on the native player drops the remembered key, so the next start fetches the new one.
let camKeyP=null;
function camKey(){return camKeyP||(camKeyP=fetch('/api/camkey',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(4000)}).then(r=>r.ok?r.json():null)
 .then(j=>j&&typeof j.k==='string'&&/^[A-Za-z0-9_-]{8,64}$/.test(j.k)?j.k:'').catch(()=>'').then(k=>{if(!k)camKeyP=null;return k}))}
function camKeyReset(){camKeyP=null}
// ==== CAM KEY END ====
// Point the element at the HLS playlist itself. False when the tile was stopped or moved on while the key was fetched.
async function useNative(s,g){s.native=true;const k=await camKey();if(!s.active||s.gen!=g||s.mode!='hls')return false;
 s.video.src=camPath(s.i)+(k?'?k='+encodeURIComponent(k):'');return true}
function camHlsErr(s,d){camDiag('hls_error',s.i+1,'hls',{type:String(d&&d.type||''),details:String(d&&d.details||''),fatal:!!(d&&d.fatal),code:d&&d.response&&Number.isFinite(d.response.code)?d.response.code:0,viewer:s===viewer})}
// A frame is a plain same-origin URL, never blob: or data: (the iPhone shell blocks both). Load it off screen, then swap, so there is no flicker.
// poster=true: one frame shown while HLS connects; the snapshot loop (poster falsy) polls until HLS plays again.
let snapSeq=0;
function snapLoad(url){return new Promise((ok,no)=>{const im=new Image(),t=setTimeout(()=>{im.onload=im.onerror=null;im.src='';no(Error('timeout'))},8000);
 im.onload=()=>{clearTimeout(t);(im.decode?im.decode():Promise.resolve()).catch(()=>{}).then(()=>ok(im))};im.onerror=()=>{clearTimeout(t);no(Error('load'))};im.src=url})}
async function snapshot(s,g,poster){if(!s.active||s.gen!=g||(!poster&&s.mode!='snap'))return;
 const url=CameraUI.snapUrl(camEntity(s.i),++snapSeq);
 try{const im=await snapLoad(url);if(!s.active||s.gen!=g)return;
  if(poster&&(s.mode=='snap'||s.playing))return;
  s.image.src=url;s.url=url;s.snapAt=Date.now();
  if(poster){s.root.classList.add('poster');if(s.state!='live')cameraState(s,'snap')}
  else cameraState(s,judge(im)<6?'dark':'snap');
  camDiagFirst('snap_ok',s,{poster:!!poster,w:im.naturalWidth||0,h:im.naturalHeight||0})
 }catch(e){if(s.active&&s.gen==g){if(!poster){s.reason=String(e&&e.message||'load');cameraState(s,'offline')}camDiagFirst('snap_fail',s,{poster:!!poster,reason:String(e&&e.message||'error')})}}
 finally{if(!poster&&s.active&&s.gen==g&&s.mode=='snap')s.timer=setTimeout(()=>snapshot(s,g),s===viewer?1000:2500)}}
async function startCamera(s){stopCamera(s,true);s.active=true;s.mode='hls';s.native=false;s.triedNative=false;s.playing=false;const g=s.gen;
 s.root.classList.remove('snap');fitCamera(s);
 // the last frame we hold is on screen at once (a stale one says how old it is); the fresh poster replaces it a moment later
 s.root.classList.toggle('poster',!!s.url);cameraState(s,s.url?'snap':'connecting');
 s.timer=setTimeout(()=>snapshotMode(s,g,'timeout'),CameraUI.giveUpMs(s===viewer));
 snapshot(s,g,true);
 const video=s.video,url=camPath(s.i),can=canNative(video);
 try{
  let eng=CameraUI.pickEngine(IN_SHELL,can,!s.hlsBlocked);
  if(eng=='hlsjs'){
   await loadHls().catch(()=>{});
   if(!s.active||s.gen!=g||s.mode!='hls')return;
   eng=CameraUI.pickEngine(IN_SHELL,can,!!(window.Hls&&Hls.isSupported()))}
  camBoot(video,eng);
  camDiag('engine',s.i+1,eng=='hlsjs'?'hls':eng,{viewer:s===viewer,shell:IN_SHELL});
  if(eng=='hlsjs'){
   const h=new Hls(CameraUI.hlsConfig());
   s.hls=h;h.on(Hls.Events.ERROR,(_,d)=>{camHlsErr(s,d);if(d.fatal)snapshotMode(s,g,'hls_fatal')});
   h.attachMedia(video);h.loadSource(url);
  }else if(eng=='native'){if(!await useNative(s,g))return}
  else return snapshotMode(s,g,s.hlsBlocked?'hls_blocked':'no_support');
  video.play().catch(()=>{});
 }catch(e){snapshotMode(s,g,'start_error')}}
function makeCamera(i,root,media,video,image){const s={i,root,media,video,image,active:false,gen:0,hls:null,timer:0,retry:0,stall:0,fails:0,url:null,snapAt:0,state:'',mode:'',native:false,playing:false,hlsBlocked:false,fps:null,rateN:null,rateT:0,lastFrameAt:0,stalled:false,reason:''};
 video.addEventListener('playing',()=>{if(!s.active||s.mode!='hls')return;clearTimeout(s.timer);clearTimeout(s.stall);s.fails=0;s.playing=true;s.lastFrameAt=Date.now();s.rateN=null;s.stalled=false;root.classList.remove('poster');root.classList.add('live');cameraState(s,'live');camDiag('playing',s.i+1,s.native?'native':'hls',{viewer:s===viewer,w:video.videoWidth||0,h:video.videoHeight||0})});
 video.addEventListener('stalled',()=>{if(s.active&&s.mode=='hls')camDiag('stalled',s.i+1,s.native?'native':'hls',{viewer:s===viewer,ready:video.readyState,net:video.networkState})});
 // Live video that stalls says "Reconnecting" for a few seconds, then drops to snapshots. No state outlives the stall window.
 video.addEventListener('waiting',()=>{if(!s.active||s.mode!='hls'||!s.playing)return;cameraState(s,'reconnecting');clearTimeout(s.stall);const g=s.gen;s.stall=setTimeout(()=>snapshotMode(s,g,'stall'),CameraUI.stallMs(s===viewer))});
 video.addEventListener('error',()=>{if(!s.active||s.mode!='hls')return;const code=video.error&&Number.isFinite(video.error.code)?video.error.code:0;camDiag('video_error',s.i+1,s.native?'native':'hls',{code,viewer:s===viewer});
  if(s.native)camKeyReset();
  if(!s.hls){snapshotMode(s,s.gen,'video_error');return}
  // hls.js element refused its MediaSource blob before any frame (MEDIA_ERR_SRC_NOT_SUPPORTED): it cannot recover, so try the platform player once, else snapshots
  if(code==4&&!s.playing){const g=s.gen;s.hlsBlocked=true;s.hls.destroy();s.hls=null;s.video.removeAttribute('src');s.video.load();
   if(canNative(s.video)&&!s.triedNative){s.triedNative=true;camDiag('engine',s.i+1,'native',{viewer:s===viewer,shell:IN_SHELL,after:'blocked'});
    useNative(s,g).then(ok=>{if(ok)s.video.play().catch(()=>{})})}
   else snapshotMode(s,g,'src_blocked')}});
 new ResizeObserver(()=>{if(s.active)fitCamera(s)}).observe(media);
 return s}
// One watchdog tick for every tile: a live picture that stops advancing for 5 s drops to snapshots at once
// instead of waiting out the 9 s live timer, so a frozen tile is never left frozen until the next page visit.
setInterval(()=>{const now=Date.now();
 for(const s of tiles.concat(viewer?[viewer]:[])){
  if(!s.active||s.mode!='hls'||s.video.paused)continue;
  if(s.video.currentTime!==s.clock){s.clock=s.video.currentTime;s.frameAt=now}
  else if(HouseUI.stalled(now,s.frameAt||now))snapshotMode(s,s.gen)}},2000);
function ensureCameras(){if(tiles.length)return;const c=$('#cams');
 c.innerHTML=CAMS.map(i=>'<button class="cam press" data-i="'+(i-1)+'" aria-label="Open camera '+i+' live"><span class="cam-media"><video muted playsinline autoplay preload="none"></video><img alt=""></span><em>Connecting</em><span class="nm"><span>Cam '+i+'</span><i class="cam-status">Connecting</i><i class="cam-rate"></i></span></button>').join('');
 tiles=Array.from(c.children,(d,i)=>{d.onclick=()=>openViewer(i);const m=d.querySelector('.cam-media');return makeCamera(i,d,m,m.querySelector('video'),m.querySelector('img'))});
 viewer=makeCamera(vi,vw,vmedia,vv,vs)}
function syncCameras(){const active=!document.hidden&&mode!='ambient',onHome=onHouse(),house=active&&onHome;
 if(!house||vOpen)tiles.forEach(s=>{if(s.active)stopCamera(s)});
 else{ensureCameras();tiles.forEach(s=>{if(!s.active)startCamera(s)})}
 if(viewer){if(!active||!vOpen||!onHome){if(viewer.active)stopCamera(viewer)}
  else if(!viewer.active){viewer.i=vi;startCamera(viewer)}}}
// cams() runs whenever House is shown (guests too): it also marks #ha as the TV board (tv.css sizes a .board to the screen)
function cams(){const b=$('#ha');if(b&&!b.classList.contains('board'))b.classList.add('board');syncCameras()}
// the "Snapshot, 8 s ago" words keep counting while a snapshot is on screen
setInterval(()=>{if(document.hidden)return;tiles.forEach(s=>{if(s.active&&s.state=='snap')paintStatus(s)});if(viewer&&viewer.active&&viewer.state=='snap')paintStatus(viewer)},1000);
// frame sampler: every 2 s, the measured rate and any stall, for every open stream (never while the page is hidden)
setInterval(()=>{if(document.hidden)return;const now=Date.now();tiles.forEach(s=>sampleRate(s,now));if(viewer)sampleRate(viewer,now)},2000);
function openViewer(i){ensureCameras();vi=((i%4)+4)%4;vOpen=true;resetZoom();vw.classList.add('on');$('#vname').textContent=vname(vi);
 $$('#vdots i').forEach((d,k)=>d.classList.toggle('on',k==vi));viewer.i=vi;updateRotation();syncCameras();$('#vclose').focus()}
function closeViewer(){vOpen=false;resetZoom();vw.classList.remove('on','snap','wait','blk','old','live','poster','connecting');syncCameras();document.querySelector('.cam[data-i="'+vi+'"]').focus()}
function stepViewer(d){if(!vOpen)return;vi=((vi+d)%4+4)%4;if(viewer.active)stopCamera(viewer);viewer.i=vi;resetZoom();
 $('#vname').textContent=vname(vi);$$('#vdots i').forEach((dot,k)=>dot.classList.toggle('on',k==vi));updateRotation();syncCameras()}
$('#vclose').onclick=closeViewer;$('#vprev').onclick=()=>stepViewer(-1);$('#vnext').onclick=()=>stepViewer(1);$('#vrotate').onclick=rotateViewer;
// ---- viewer zoom: two-finger pinch (1x to 6x), one-finger pan while zoomed, double tap 1x / 2.5x.
// At 1x a one-finger swipe still changes camera (left/right) or closes (down). Pointer events with
// touch-action:none on #viewer, so iPhone Safari never turns a pinch into page zoom.
let vz={s:1,x:0,y:0};
function applyZoom(z){vz=z;const on=z.s>1.001;$('#vzoom').style.transform=on?'translate('+z.x.toFixed(1)+'px,'+z.y.toFixed(1)+'px) scale('+z.s.toFixed(3)+')':'';
 vw.dataset.zoom=z.s.toFixed(2);vw.classList.toggle('zoomed',on);$('#vzl').textContent=(Math.round(z.s*10)/10)+'\u00D7';$('#vzl').setAttribute('aria-label','Zoom '+(Math.round(z.s*10)/10)+' times, tap to reset')}
function resetZoom(){applyZoom({s:1,x:0,y:0})}
$('#vzl').onclick=resetZoom;
// the picture's place inside the viewer: live video size, else the snapshot size, else the whole viewer
function vgeom(){const r=vmedia.getBoundingClientRect(),m=vw.classList.contains('snap')?vs:vv;
 return {W:r.width,H:r.height,box:CameraUI.contentBox(r.width,r.height,m.videoWidth||m.naturalWidth,m.videoHeight||m.naturalHeight,camRotation(vi))}}
function zoomTo(s,px,py,qx,qy,z0){const g=vgeom();applyZoom(CameraUI.zoomAt(z0||vz,s,px,py,qx,qy,g.W,g.H,g.box))}
{const P=new Map();let g=null,tap=null;
 const rel=e=>{const r=vmedia.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top}};
 const two=()=>{const [a,b]=[...P.values()];return {m:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},d:Math.hypot(a.x-b.x,a.y-b.y)||1}};
 vw.addEventListener('pointerdown',e=>{if(!vOpen||e.target.closest('.vb'))return;P.set(e.pointerId,rel(e));try{vw.setPointerCapture(e.pointerId)}catch(_){}
  if(P.size>=2){const t=two();g={k:'pinch',z0:vz,m0:t.m,d0:t.d}}else g={k:'one',z0:vz,p0:P.get(e.pointerId),t0:e.timeStamp,moved:false,multi:false}});
 vw.addEventListener('pointermove',e=>{if(!g||!P.has(e.pointerId))return;const p=rel(e);P.set(e.pointerId,p);
  if(g.k=='pinch'&&P.size>=2){const t=two();zoomTo(g.z0.s*t.d/g.d0,g.m0.x,g.m0.y,t.m.x,t.m.y,g.z0)}
  else if(g.k=='one'){const dx=p.x-g.p0.x,dy=p.y-g.p0.y;if(Math.hypot(dx,dy)>8)g.moved=true;
   if(g.z0.s>1.001){const q=vgeom();applyZoom(CameraUI.clampZoom({s:g.z0.s,x:g.z0.x+dx,y:g.z0.y+dy},q.W,q.H,q.box))}}});
 const end=e=>{if(!P.has(e.pointerId))return;const p=rel(e);P.delete(e.pointerId);if(!g)return;
  // one finger left after a pinch keeps panning from where the pinch stopped; it never changes camera
  if(g.k=='pinch'){if(P.size==1){const [q]=[...P.values()];g={k:'one',z0:vz,p0:q,t0:e.timeStamp,moved:true,multi:true}}else if(!P.size)g=null;tap=null;return}
  if(P.size)return;const was=g;g=null;if(e.type=='pointercancel')return;
  const dx=p.x-was.p0.x,dy=p.y-was.p0.y;
  if(!was.moved&&e.timeStamp-was.t0<300){
   if(tap&&e.timeStamp-tap.t<320&&Math.hypot(p.x-tap.x,p.y-tap.y)<40){tap=null;zoomTo(vz.s>1.05?1:CameraUI.ZTAP,p.x,p.y,p.x,p.y)}else tap={t:e.timeStamp,x:p.x,y:p.y};return}
  tap=null;if(was.multi||was.z0.s>1.001)return;
  if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5)stepViewer(dx<0?1:-1);else if(dy>90&&Math.abs(dy)>Math.abs(dx)*1.5)closeViewer()};
 vw.addEventListener('pointerup',end);vw.addEventListener('pointercancel',end);
 // WebKit gesture events: cancel them while the viewer is open so the page itself never zooms
 for(const t of ['gesturestart','gesturechange','gestureend'])document.addEventListener(t,e=>{if(vOpen)e.preventDefault()},{passive:false});
 // desktop: ctrl+wheel (trackpad pinch) and plain wheel zoom around the cursor
 vw.addEventListener('wheel',e=>{if(!vOpen)return;e.preventDefault();const p=rel(e);zoomTo(vz.s*Math.exp(-e.deltaY*(e.ctrlKey?0.01:0.002)),p.x,p.y,p.x,p.y)},{passive:false});
 addEventListener('resize',()=>{if(vOpen&&vz.s>1.001)resetZoom()})}
addEventListener('keydown',e=>{if(!vOpen)return;if(e.key=='Escape')closeViewer();if(e.key=='ArrowRight')stepViewer(1);if(e.key=='ArrowLeft')stepViewer(-1);
 const cx=innerWidth/2,cy=innerHeight/2;if(e.key=='+'||e.key=='=')zoomTo(vz.s*1.5,cx,cy,cx,cy);if(e.key=='-')zoomTo(vz.s/1.5,cx,cy,cx,cy);if(e.key=='0')resetZoom()});
// ---- burn-in guard: only on a device with the Always-on display flag (default: the installed fullscreen web app with a coarse
// pointer in landscape, the Pixel under the monitor); stored per device as alwaysOn=1|0; never on TV (PageBlueprints 1.4) ----
const ALWAYS_ON=(()=>{if(document.documentElement.classList.contains('tv'))return false;let v=null;try{v=localStorage.getItem('alwaysOn')}catch(e){}
 if(v==='1'||v==='0')return v==='1';return matchMedia('(display-mode: fullscreen)').matches&&matchMedia('(pointer: coarse)').matches&&matchMedia('(orientation: landscape)').matches})();
document.documentElement.classList.toggle('always-on',ALWAYS_ON);
let last=Date.now(),mode='awake',swallow=false,swT=0,ox=0,oy=0;
function setMode(m){mode=m;$('#app').style.opacity=m=='dim'?DIM_OPACITY:1;$('#amb').classList.toggle('on',m=='ambient');if(m=='ambient')drift();syncCameras()}
function drift(){const a=$('#ambin'),W=innerWidth-a.offsetWidth,H=innerHeight-a.offsetHeight;a.style.transform='translate('+Math.round(Math.random()*Math.max(0,W))+'px,'+Math.round(Math.random()*Math.max(0,H))+'px)'}
function shiftGrid(){ox=Math.floor(Math.random()*(SHIFT_MAX_PX+1));oy=Math.floor(Math.random()*(SHIFT_MAX_PX+1));$('#app').style.transform='translate('+ox+'px,'+oy+'px)'}
const guard=e=>{
 if(e.type=='pointerdown'||e.type=='touchstart'){
  last=Date.now();
  if(mode!='awake'){swallow=true;clearTimeout(swT);swT=setTimeout(()=>swallow=false,700);setMode('awake');if(hostPage())refresh()}
 }
 if(swallow){e.stopPropagation();e.preventDefault()}
};
for(const t of ['pointerdown','pointerup','pointercancel','touchstart','touchend','touchmove','click','mousedown','mouseup','contextmenu'])
 addEventListener(t,guard,{capture:true,passive:false});
if(ALWAYS_ON){
 setInterval(()=>{if(vOpen)last=Date.now();const idle=Date.now()-last;
  if(idle>=T_AMB){if(mode!='ambient')setMode('ambient')}
  else if(idle>=T_DIM){if(mode!='dim')setMode('dim')}
 },1000);
 setInterval(()=>{if(mode=='ambient')drift()},DRIFT_MS);
 setInterval(()=>{if(mode=='awake')shiftGrid()},SHIFT_MS);
}
// ---- boot ----
// (focus pill removed)
setHost(host);clock();wx();wake();loadKeys();
const kbt=$('#kbtoggle');if(kbt)kbt.addEventListener('click',()=>{const pad=$('#padpg');if(!pad)return;const open=pad.classList.toggle('kb-open');kbt.setAttribute('aria-expanded',open?'true':'false')});
// F9: a link's sheet key (?p=surf&spot=salt-creek) reopens that sheet once its row has painted. The row on the page on screen is tapped as the
// reader would, so a link opens only what that page shows its viewer; a page that opens the sheet from the parameter itself (Commercial's zip)
// is left to it. The wait ends at the first sheet, a tap or key of the reader's, a route change or 12 s; the key then lives in the sheet's entry.
function reopen(keys){if(!keys.length)return;const route=SH.route,until=Date.now()+12000;let over=false,tapped=false;
 const quit=()=>end(null);
 function end(k){if(over)return;over=true;SVC.hint(null);removeEventListener('pointerdown',quit,true);removeEventListener('keydown',quit,true);
  if(k&&SH.route===route&&String(SH.params[k[0]]||'').toLowerCase()===k[1].toLowerCase()){delete SH.params[k[0]];SVC.navigate(false)}}
 addEventListener('pointerdown',quit,true);addEventListener('keydown',quit,true);
 (function step(){if(over)return;if(SH.route!==route||Date.now()>until)return end(null);
  if(SVC.sheet.current())return end(SVC.sheet.key());
  const pg=subOf(PAGES[page])||PAGES[page];
  for(const [k,v] of tapped?[]:keys){let r=null;try{r=[...pg.querySelectorAll('[data-open="'+CSS.escape(k)+'"][data-key="'+CSS.escape(v)+'"]')].find(x=>!x.closest('dialog')&&x.getClientRects().length&&!x.disabled)}catch(e){}
   if(r){tapped=true;r.click();break}}
  if(SVC.sheet.current())return end(SVC.sheet.key());
  setTimeout(step,200)})()}
// Reopen on the page used last, unless the address names one (a pasted link or a reload: ?p=, #fleet, #p=); a pasted link wins over the stored
// page. An installed app's launch reads nothing from its address (PRODUCT: it reopens on the page used last). A guest's link to a page the guest
// does not have lands on the guest's first page with its parameters dropped.
{const nav=(typeof performance!=='undefined'&&performance.getEntriesByType&&performance.getEntriesByType('navigation')[0])||{},mm=q=>!!(window.matchMedia&&matchMedia(q).matches);
 const b=ShellRoute.boot(SEARCH,HASH,{launch:(navigator.standalone===true||mm('(display-mode: standalone)')||mm('(display-mode: fullscreen)'))&&nav.type==='navigate'});
 const raw=b.route||localStorage.getItem('page')||'',a=raw.split('/')[0],st=a&&!raw.includes('/')&&!ShellCore.SUBS[a]?localStorage.getItem('sub:'+a):'',route=st?a+'/'+st:raw||'today';
 const [wt,ws]=ShellCore.redirect(route).split(/[?#]/)[0].split('/'),ok=b.from==='link'&&!!pageEl(wt)&&!(GUEST&&wt==='home'&&ws&&ws!=='house');
 const keys=ok?Object.entries(b.params):[];
 if(keys.length)SVC.hint(ShellRoute.sheetKey(keys[keys.length-1][0],keys[keys.length-1][1]));
 go(route+(ok?linkQuery(b.params):''),{instant:true});reopen(keys)}
// ---- role (item 9, decision 11): the bar and the stored role's first page are up; whoami decides the rest and never blocks a paint. The tabs
// stay invisible (no layout shift) and inert until it answers; with no stored role no page shows either. ShellCore.rolePlan says what an
// answer does; a pager built for the other role reloads once a session (sessionStorage role:reload), else the guest view applies in place.
{const tabs=$('#pgs');let off=null,retry=0;
 const tabsOn=on=>{if(!tabs)return;tabs.style.visibility=on?'':'hidden';if(on)tabs.removeAttribute('inert');else tabs.setAttribute('inert','')};
 tabsOn(false);if(!ROLE.stored)PAGES.forEach(p=>{p.hidden=true});
 // the panel in place of a page: offline (no answer and no stored role) or signed out (whoami answered 401: the cookie is gone; /?t= skips
 // the worker's cached page, so the server answers its sign-in page). The deck's own failed state (crossed square, title, one line, one
 // filled action) inside the page margins: it was a bare "Offline · Try again" line flush against the left edge (L18, 2026-11-17).
 const OFFS={off:{k:'bad',t:'The deck server did not answer',l:'Check the connection. The deck asks again every 30 seconds.',b:'Try again',
   i:'<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8"/>'},
  out:{k:'setup',t:'Signed out',l:'This device is no longer signed in to the deck.',b:'Sign in',i:'<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>'}};
 const offNote=kind=>{if(off&&off.dataset.k!==kind){off.remove();off=null}if(!kind||off)return;const o=OFFS[kind==='out'?'out':'off'];
  off=document.createElement('div');off.className='roleoff';off.id='roleoff';off.dataset.k=kind;off.setAttribute('role','status');
  off.innerHTML='<div class="es es-'+o.k+'"><svg class="es-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+o.i+'</svg><b class="es-t">'+o.t+'</b><span class="es-l">'+o.l+'</span><button type="button" class="btn btn-primary">'+o.b+'</button></div>';
  off.querySelector('button').onclick=kind==='out'?()=>location.assign('/?t='):()=>ask();pager.before(off)};
 // signed out: the bar and the sign-in line, never a dead deck. Every page stays hidden, so no control is tappable, the tabs stay off, and
 // ROLE stays unknown (q keeps waiting, pageVisible and the deck.js dispatch stay off) until an answer names a principal; the 30 s ask goes on.
 function apply(answer){if(answer==='#out'){PAGES.forEach(p=>{p.hidden=true});tabsOn(false);ROLE.known=false;offNote('out');errText='';errMsg='';showSt();return}
  const cur=ROLE.role||ROLE.stored,p=ShellCore.rolePlan(cur,answer);
  if(p.store){try{localStorage.setItem('role',p.store)}catch(e){}}
  if(p.changed)document.dispatchEvent(new CustomEvent('deck:role',{detail:{role:p.role,was:cur||null}}));
  if(!p.offline&&retry){clearInterval(retry);retry=0}
  if(p.reload){let done='';try{done=sessionStorage.getItem('role:reload')||''}catch(e){}
   if(done!==p.role){try{sessionStorage.setItem('role:reload',p.role)}catch(e){}location.replace(p.role==='guest'?'/?p=home/house':'/');return}
   if(p.role==='guest'){GUEST=true;guestMode();$$('#pgs button[data-n]').forEach(b=>{if(!GUEST_PAGES.includes(b.dataset.n))b.hidden=true});go('home/house',{instant:true,quiet:true})}}
  else if(!p.offline){try{sessionStorage.removeItem('role:reload')}catch(e){}}
  if(!p.known){offNote('off');errText='offline';errMsg='';showSt();return}
  offNote('');const first=!ROLE.known,wasOff=ROLE.offline;ROLE.known=true;ROLE.role=p.role;ROLE.offline=p.offline;tabsOn(true);
  if(p.offline){errText='offline';errMsg='';showSt()}else if(wasOff&&errText==='offline'){errText='';showSt()}
  if(first){const pg=PAGES[page];if(pg)pg.hidden=false;revealTab(page,true);ROLE.open();pageVisible()}}
 function ask(){const c=typeof AbortController==='function'?new AbortController():null,t=setTimeout(()=>{if(c)c.abort()},6000);
  return fetch('/api/whoami',{credentials:'same-origin',cache:'no-store',signal:c?c.signal:undefined}).then(r=>r.status===401?{role:'#out'}:r.ok?r.json():null)
   .then(j=>j&&typeof j.role==='string'?j.role:'',()=>'').then(a=>{clearTimeout(t);apply(a);if(!(a==='owner'||a==='guest')&&!retry)retry=setInterval(ask,30000)})}
 addEventListener('online',()=>{if(!ROLE.known||ROLE.offline)ask()});
 ask()}
// pages/*.js and the old page scripts load after deck.js: once every script has run, the route on screen is dispatched again if a
// module took it over, and the folded old pages (All crons under Crons, Agents under Launch) ride along as hooks of their new home
document.addEventListener('DOMContentLoaded',()=>{if(typeof DeckPages==='undefined')return;
 for(const [home,old] of [['crons','schedules'],['launch','agents']]){const p=DeckPages.page(old);if(p&&p.show){DeckPages.hook(home,{show:c=>p.show(c),refresh:(c,t)=>p.refresh&&p.refresh(c,t),hide:c=>p.hide&&p.hide(c)});
  if(ROLE.known&&!document.hidden&&pname()==='home'&&leafOf('home')===home)p.show()}}
 const c=DeckPages.current();if(!document.hidden&&(!c||c.route!==DeckPages.parse(leafOf(pname())).route))pageVisible()});
addEventListener('keydown',()=>{last=Date.now()},{capture:true});
// Poll only while the deck is visible and awake, one call in flight per poller (Dell calls ride ssh).
const gated=(fn)=>{let busy=false;return async()=>{if(busy||document.hidden||mode=='ambient')return;busy=true;try{await fn()}finally{busy=false}}};
setInterval(clock,10000);setInterval(gated(()=>hostPage()?refresh():null),3000);setInterval(gated(()=>onHouse()?stats():null),5000);setInterval(wx,600000);
setInterval(()=>{if(!ROLE.known||document.hidden||mode=='ambient')return;const n=pname(),leaf=leafOf(n);if(leaf==='home'){ha();cams()}if(leaf==='fleet')fleet();if(typeof deckPage=='function')deckPage(leaf,true)},15000);
// Every open tab also refreshes on its own at least once an hour, and again when the deck comes back on screen.
setInterval(()=>{if(document.hidden||mode=='ambient')return;pageVisible()},3600000);
// a shell reload in dim or ambient (mechanism A) comes back in that mode, never awake at full brightness in the night
{let m=null;try{m=sessionStorage.getItem('shell:mode');sessionStorage.removeItem('shell:mode')}catch(e){}
 if(ALWAYS_ON&&(m==='ambient'||m==='dim')){last=Date.now()-(m==='ambient'?T_AMB:T_DIM);setMode(m)}}
