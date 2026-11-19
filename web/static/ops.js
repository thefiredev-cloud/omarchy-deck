// Pixel Deck Fleet extras: the stall watch strip on top of Fleet. Loaded after app.js and deck.js.
// Feed: GET /api/stalls (deck-feed-stalls, every 2 min). Read-only.
// Wording rules: unknown is "--" never 0, a setup step is calm (not red), red means a real failure. Design v3: titles carry counts, never an age;
// a feed that is old says "Out of date" once in its title (the page has one freshness mark), and no source name reaches the page.
// The block below takes DeckUI (deck.js) as a free variable for the shared empty state and diagnostics.
// ==== DECK OPS UI BEGIN (pure: no DOM, no fetch, no globals; tests/deck_ops_ui.test.js loads this block) ====
const DeckOps=(()=>{
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const arr=x=>Array.isArray(x)?x:[];
 const num=v=>typeof v==='number'&&isFinite(v)?v:null;
 const str=(v,n)=>typeof v==='string'?v.trim().slice(0,n||120):'';
 const SD=k=>'<i class="sd '+k+'"></i>';
 const LK='<span class="lk" aria-hidden="true">\u2197</span>';
 const safeUrl=u=>typeof u==='string'&&/^https:\/\/[^\s"'<>\\@]+$/i.test(u)?u:'';
 const diag=ds=>DeckUI.diagHtml(arr(ds).filter(Boolean));
 // "22 min", "3 h", "2 d"
 function span(s){s=Math.max(0,Math.round(s));return s<5400?Math.max(1,Math.round(s/60))+' min':s<172800?Math.round(s/3600)+' h':Math.round(s/86400)+' d'}
 const ago=(t,now)=>num(t)==null?'time unknown':(now/1000-t<45?'just now':span(now/1000-t)+' ago');
 // a clock time the owner can match with his own logs: "10:42 PM", or "Tue 10:42 PM" when it is over a day old
 function clock(t,now){const d=new Date(t*1000),hm=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  return now/1000-t>=86400?d.toLocaleDateString([],{weekday:'short'})+' '+hm:hm}
 const row=(main,sub,right,k,url,dg,more,key)=>{const u=safeUrl(url),tag=u?'a':'div';
  return '<'+tag+' class="frow'+(k?' '+k:'')+'"'+(key==null?'':' data-key="'+esc(key)+'"')+(u?' href="'+esc(u)+'" target="_blank" rel="noopener noreferrer"':'')+'><span class="fl"><b>'+esc(main)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+(more||'')+'</span>'+
   (right?'<span class="fr">'+right+'</span>':'')+(u?LK:'')+diag(dg)+'</'+tag+'>'};
 const tile=(h,v,t,k,dg)=>'<div class="tile'+(k==='bad'?' bad':k==='stale'?' stale':'')+'"><div class="h">'+(k?SD(k==='stale'?'warn':k):'')+esc(h)+'</div><div class="v">'+esc(v)+'</div>'+(t?'<div class="t">'+esc(t)+'</div>':'')+diag(dg)+'</div>';
 const head=(title,right)=>'<div class="secttl"><span>'+esc(title)+'</span>'+(right?'<span>'+esc(right)+'</span>':'')+'</div>';
 const age=f=>isObj(f)&&f.stale?'Out of date':'';
 const errLine=f=>{const es=arr(f.errors).filter(isObj);if(!es.length)return '';
  return '<div class="frow err"><span>'+(es.length===1?'One source is not reporting.':es.length+' sources are not reporting.')+'</span>'+diag(es.slice(0,8).map(e=>(str(e.source,40)||'source')+': '+(str(e.reason,120)||'no reason given')))+'</div>'};
 const down=(title,f,line)=>head(title,'')+DeckUI.empty({k:'bad',title:title+' is not reporting',line:line,diag:[isObj(f)?str(f.error,80):'no answer from the deck server',isObj(f)?str(f.src,80):'']});

 // ---- stall watch ----
 const PROBLEM=['stalled','rate_limited','erroring','failed','ended_without_done'];
 const KIND={omp:'OMP session',lane:'Swarm lane',cron:'Hermes cron',unit:'Service'};
 const WORD={stalled:'Stalled',rate_limited:'Rate limited',erroring:'Failing',failed:'Failed',ended_without_done:'Ended without DONE'};
 // the badge says what and since when, so nobody has to open a log to know how long it has been stuck
 function badge(i,now){const w=WORD[i.state]||'Problem',t=num(i.since),bad=i.state==='failed'||i.state==='erroring'||i.state==='ended_without_done';
  return '<span class="pill '+(bad?'bad':'warn')+'" data-since="'+(t==null?'':t)+'">'+SD(bad?'bad':'warn')+esc(t==null||i.state==='ended_without_done'?w:w+' since '+clock(t,now)+' ('+span(now/1000-t)+')')+'</span>'}
 function stallModel(s){const items=arr(isObj(s)&&s.items).filter(isObj),probs=items.filter(i=>PROBLEM.includes(i.state));
  const by={};items.forEach(i=>{const k=KIND[i.kind]?i.kind:'other';by[k]=(by[k]||0)+1});return {items,probs,by}}
 function stalls(s,now,limit){
  if(!isObj(s)||s.error)return down('Agent runs',s,'The stall watch did not answer. It checks again every 2 minutes.');
  const m=stallModel(s),c=isObj(s.counts)?s.counts:{},n=num(c.watched)==null?m.items.length:c.watched,a=isObj(s.alerts)?s.alerts:{};
  const lim=num(limit)==null?8:limit,shown=m.probs.slice(0,lim);
  const what=['omp','lane','cron','unit'].filter(k=>m.by[k]).map(k=>m.by[k]+' '+(k==='omp'?'OMP':k==='lane'?'lanes':k==='cron'?'cron':'services')).join(' \u00B7 ');
  const alertLine='Alerts: desktop '+(a.desktop===false?'off':'on')+' \u00B7 phone '+(a.phone===true?'on':'off')+(num(a.last_sent_at)!=null?' \u00B7 last alert '+ago(a.last_sent_at,now):'');
  // the badge sits on its own line under the reason, so a phone-width row never hides the reason behind it
  const body=m.probs.length?'<div class="flist" id="stlist"'+(shown.length>8?' data-bal-open':'')+'>'+shown.map((i,index)=>row(i.kind==='unit'&&typeof DeckUI.unitName==='function'?DeckUI.unitName(i.name):str(i.name,60)||'Run',[str(i.reason,160),KIND[i.kind]||''].filter(Boolean).join(' \u00B7 '),'',
     i.state==='failed'||i.state==='erroring'||i.state==='ended_without_done'?'bad':'stale','',[str(i.hint,120),str(i.where,120),i.kind==='unit'&&str(i.name,96)?'Unit '+str(i.name,96):''],'<small class="stb">'+badge(i,now)+'</small>','ops:'+(i.id||index))).join('')+'</div>'+
    DeckCore.more({key:'opsruns',shown:shown.length,total:m.probs.length,step:m.probs.length-shown.length,first:shown.length})
   :tile('No stalled runs',n+' watched',what||'Nothing running right now','ok');
  return head('Agent runs',[m.probs.length?m.probs.length+(m.probs.length===1?' needs a look':' need a look'):'',age(s)].filter(Boolean).join(' \u00B7 '))+body+
   '<div class="tnote">'+esc(alertLine)+'</div>'+(a.phone!==true&&str(a.phone_setup,140)?diag(['Phone alerts: '+str(a.phone_setup,140)]):'')+errLine(s)}

 // ---- network (GET /api/tailscale + the internet and router rows of GET /api/ha). Read only: it shows, it never switches anything. ----
 // own devices online, devices that are off, internet and router, and every Funnel path that is open to the public internet. No IPs, no traffic numbers.
 const NET_HA=[['binary_sensor.internet_reachable','Internet'],['binary_sensor.router_reachable','Router']];
 const haRow=(ha,id)=>{const e=isObj(ha)&&!ha.error&&isObj(ha.entities)&&isObj(ha.entities[id])?ha.entities[id]:null,s=e?str(e.state,16).toLowerCase():'';
  return s==='on'?'up':s==='off'?'down':null};
 const plural=(n,w)=>n+' '+w+(n===1?'':'s');
 function network(ts,ha,now){
  const nets=NET_HA.map(([id,name])=>[name,haRow(ha,id)]),haWord=nets.map(([n,s])=>n+' '+(s==null?'not reported':s)).join(' \u00B7 '),haBad=nets.some(x=>x[1]==='down'),haNone=nets.every(x=>x[1]==null);
  const house=tile('House network',haWord,haNone?'No reading for either yet. It tries again on its own.':'',haBad?'bad':haNone?'off':'ok');
  if(!isObj(ts)||ts.error)return head('Network','')+house+DeckUI.empty({k:'bad',title:'Tailnet snapshot is not reporting',line:'The device and Funnel check did not answer. It tries again on its own.',diag:[isObj(ts)?str(ts.error,80):'no answer from the deck server',isObj(ts)?str(ts.src,80):'']});
  const c=isObj(ts.counts)?ts.counts:{},own=num(c.own_devices),on=num(c.own_online),fun=num(c.funnel_public),crit=num(c.crit);
  const nodes=arr(ts.nodes).filter(isObj),off=nodes.filter(n=>n.online===false).sort((a,b)=>(num(b.last_seen_h)||0)-(num(a.last_seen_h)||0));
  const offName=n=>(str(n.name,30)||'device')+(num(n.last_seen_h)!=null?' ('+(n.last_seen_h<48?Math.round(n.last_seen_h)+' h':Math.round(n.last_seen_h/24)+' d')+')':'');
  const k=ts.stale?'stale':crit>0?'bad':'ok';
  const devices=tile('Tailnet devices',own==null||on==null?'Not reported':on+' of '+own+' online',off.length?plural(off.length,'device')+' off: '+off.slice(0,4).map(offName).join(', ')+(off.length>4?' and '+(off.length-4)+' more':''):(nodes.length?'None are off':'Device list not reported'),k);
  const ex=arr(ts.exposures).filter(isObj).filter(x=>x.funnel===true||x.funnel===1);
  const paths=ex.slice(0,8).map(x=>'<small>'+esc((str(x.host,30)||'host')+' port '+str(String(x.port==null?'':x.port),8)+' '+(str(x.path,60)||'/'))+'</small>').join('');
  const fn=fun==null&&!ex.length?row('Funnel paths not reported','The snapshot has no Funnel count.','','stale'):
   (fun||ex.length)?row((fun!=null?fun:ex.length)+' public Funnel '+((fun!=null?fun:ex.length)===1?'path':'paths')+': confirm with Tanner','These are open to the public internet, not only the tailnet.','<span class="pill warn">'+SD('warn')+'Check</span>','stale','','',paths):
   row('No public Funnel paths','Nothing on the tailnet is open to the public internet.','<span class="pill">'+SD('ok')+'None</span>','');
  const bad=arr(ts.alerts).filter(isObj).filter(a=>a.severity==='crit'||(a.severity==='warn'&&a.kind!=='funnel_public')).slice(0,4)
   .map(a=>row((str(a.host,30)||'Device')+': '+(a.severity==='crit'?'needs a look':'warning'),str(a.msg,140),'',a.severity==='crit'?'bad':'stale')).join('');
  return head('Network',age(ts))+house+devices+'<div class="flist">'+fn+bad+'</div>'+errLine(ts)}

 return {stalls,stallModel,badge,span,clock,PROBLEM,network}
})();
// ==== DECK OPS UI END ====
// ---- glue (DOM + fetch). Skipped where there is no document (node tests). ----
if(typeof document!=='undefined'&&document.getElementById('fleet')){
 const OP={s:null,t:null,h:null,ts:0,lim:8};
 // app.js fleet() waits for the first paint of this strip before it places the board, so the strip never grows under a painted column
 // (P5), and it reads the network snapshot and the house entities from OPS_LAST for the Devices section instead of fetching them again
 let firstDone=null;window.STALLS_FIRST=new Promise(r=>{firstDone=r});
 const opGet=p=>jget(p).catch(e=>({error:/^\d+$/.test(String(e&&e.message))?'http '+e.message:'deck server did not answer'}));
 // the strip lives at the top of the first Fleet column (Network first, then the stall watch); app.js fleet() repaints that column, so it reads window.STALLS_HTML too
 function paintStalls(){let h='';try{h=DeckOps.network(OP.t,OP.h,Date.now())}catch(e){h=renderFail('Network')}try{h+=DeckOps.stalls(OP.s,Date.now(),OP.lim)}catch(e){h+=renderFail('Agent runs')}window.STALLS_HTML=h;const el=document.getElementById('stalls');if(el)el.innerHTML=h}
 async function stallTick(force){if(!force&&Date.now()-OP.ts<30000)return;OP.ts=Date.now();[OP.s,OP.t,OP.h]=await Promise.all([opGet('/api/stalls'),opGet('/api/tailscale'),opGet('/api/ha')]);
  window.OPS_LAST={t:OP.t,h:OP.h};paintStalls();if(firstDone){firstDone();firstDone=null}}
 document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('#stalls [data-more="opsruns"]');if(!b)return;OP.lim=200;paintStalls()});
 const guest=()=>typeof GUEST!=='undefined'&&GUEST;
 DeckPages.hook('fleet',{show(){stallTick(true)},refresh(c,tick){stallTick(!tick)}});
 if(!guest()&&!document.hidden&&typeof pname==='function'&&typeof leafOf==='function'&&leafOf(pname())==='fleet')stallTick(true);
}
