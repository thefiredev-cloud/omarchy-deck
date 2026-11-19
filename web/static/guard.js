// guard.js: the deck's one client error report, shared by every page that loads it (index.html and cre.html, after ui-core.js and
// before any other script, so an error in a later script is caught). Not pure: it adds three window listeners and posts.
// ==== CLIENT ERRORS BEGIN (pure: no DOM, no fetch; tests/ui_guard.test.js loads this block) ====
// One report for every client failure (PlanEng item 1, layer 4): a script error, an unhandled rejection, a page or part that threw
// (DeckPages.report) and a policy violation. Whitelisted fields only (kind, route, script name, line, column, a 120-character message
// without query strings), at most 10 a page load, one per distinct error. Lane BHelpers moves it to DeckCore.report.
const ClientErr=(()=>{
 const KINDS=['error','rejection','render','csp'],MAX=10,ROUTE=/^[a-z]{2,16}(\/[a-z]{2,16})?$/,seen=new Set();let sent=0;
 const int=n=>{const x=Number(n);return Number.isFinite(x)&&x>0?Math.min(1e7,Math.floor(x)):0};
 const base=s=>{const m=/([A-Za-z0-9_.-]{1,64}\.js)(?:[?#][^\s]*)?$/.exec(String(s==null?'':s));return m?m[1]:''};
 const clean=s=>String(s==null?'':s).replace(/\?[^\s'")]*/g,'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
 // the first script frame of a stack, Chromium ("at f (https://h/deck.js:12:3)") or WebKit ("f@https://h/deck.js:12:3")
 function frame(stack){const m=/([A-Za-z0-9_.-]{1,64}\.js)(?:\?[^\s:)]*)?:(\d+):(\d+)/.exec(String(stack==null?'':stack));return m?{src:m[1],line:+m[2],col:+m[3]}:{}}
 // anything thrown or rejected: its message and where it came from
 function info(err){if(err&&typeof err==='object'){const f=frame(err.stack);return {msg:String(err.message||err.name||'error'),src:f.src,line:f.line,col:f.col}}return {msg:String(err)}}
 function body(e,o){if(!KINDS.includes(e))return null;o=o&&typeof o==='object'?o:{};const r=String(o.route||'').split('?')[0];
  return {e,route:ROUTE.test(r)?r:'',src:base(o.src),line:int(o.line),col:int(o.col),msg:clean(o.msg)}}
 // post(json) sends it; a post that fails (the route not there yet, offline) fails silently
 function report(e,o,post){const b=body(e,o);if(!b)return false;const k=[b.e,b.src,b.line,b.col,b.msg].join('|');
  if(sent>=MAX||seen.has(k))return false;seen.add(k);sent++;
  try{const p=post(JSON.stringify(b));if(p&&typeof p.catch==='function')p.catch(()=>{})}catch(x){}return true}
 return {frame,info,body,report,MAX}})();
// ==== CLIENT ERRORS END ====
// deckReport(kind, err, extra): DeckPages.report and the window listeners below. A guest never posts (the route refuses guests).
// The desk page (/cre, #cre-root) may be a desk viewer's, whose reports the server refuses and audits as denials: there the first
// report asks /api/whoami once and posts only when the answer is the owner; a viewer, a failure or no answer posts nothing.
let deckOwner=null;
function deckPost(b){const send=()=>fetch('/api/client-error',{method:'POST',keepalive:true,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:b});
 if(typeof document==='undefined'||!document.getElementById||!document.getElementById('cre-root'))return send();
 if(!deckOwner)deckOwner=fetch('/api/whoami',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).then(w=>!!w&&typeof w==='object'&&w.role==='owner',()=>false);
 return deckOwner.then(ok=>ok?send():null)}
function deckReport(e,err,x){try{let g=false;try{g=!!GUEST}catch(t){}if(g)return;let route='';
 try{const c=typeof DeckPages!=='undefined'&&DeckPages.current();route=c?c.route:''}catch(t){}
 ClientErr.report(e,Object.assign({route},ClientErr.info(err),x&&typeof x==='object'?x:{}),deckPost)}catch(t){}}
addEventListener('error',ev=>{if(!ev||!ev.message)return;deckReport('error',ev.error&&typeof ev.error==='object'?ev.error:ev.message,{msg:ev.message,src:ev.filename,line:ev.lineno,col:ev.colno})});
addEventListener('unhandledrejection',ev=>deckReport('rejection',ev?ev.reason:''));
addEventListener('securitypolicyviolation',ev=>{if(!ev)return;const u=String(ev.blockedURI||'');let b=u;try{b=/^(inline|eval|data|blob)$/.test(u)?u:new URL(u).origin}catch(t){b=u.split(/[?#]/)[0]}
 deckReport('csp','',{msg:String(ev.effectiveDirective||ev.violatedDirective||'')+' '+b,src:ev.sourceFile,line:ev.lineNumber,col:ev.columnNumber})});
