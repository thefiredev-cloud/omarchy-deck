// Home > Launch, with Missions as its first section (Missions was the Agents sub until 2026-11-14; home/agents lands on home/launch#missions).
// Search first. A mission opens its message in the run window's composer (openCompose; POST /api/run-send only on Send), so nothing starts
// until Send (owner feedback 2026-10-07). A launch row's Hermes button arms on the first tap and starts on a second tap within 3 s through
// deck.js postLaunchItem (POST /api/launch-item, unchanged). Groups show five items, then Show more. The results column sits beside the list on D.
// An Apps section follows Missions; an asleep app's Wake also arms first, then goes through deck.js postAppWake (POST /api/apps/wake).
// Loaded after deck.js; uses DeckUI and the page glue (feedGet, openCompose, openSheet, postLaunchItem, postAppWake, addResult, paintResults,
// openRun, runSavePaintLast, buzz, DeckPages, DeckShell, $). This file only reads feeds (GET) and builds text; the two POSTs live in deck.js.
// ==== AGENTS UI HELPERS BEGIN (pure: no DOM, no fetch; tests load this block with DeckUI injected) ====
const AgentsUI=(()=>{
 const {esc,cleanText}=DeckUI;
 const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const arr=x=>Array.isArray(x)?x:[];
 const str=(v,n)=>typeof v==='string'?v.trim().slice(0,n||80):'';
 const MAX=1500,ALL='all';
 // A message is plain text: the rules at the end say what the agent may and may not do, so a short list never loses them.
 const RULES='Rules: work in your own worktree, prove each change by running it, never push main, never deploy, never spend money, and ask me before anything that sends or posts outside. Reply with five short bullets at most.';
 const MISSIONS=[
  {id:'crons',label:'Fix failing crons',does:'Reads each failing job\u2019s log, fixes the cause and runs it again',kind:'crons'},
  {id:'ci',label:'Fix failing CI',does:'Reads the failing checks on main and fixes them on a branch',kind:'ci'},
  {id:'bugs',label:'Find bugs',does:'Reads and runs the code, lists real defects, fixes the safe ones',kind:'target'},
  {id:'security',label:'Security review',does:'Looks for exposed secrets, open ports and unsafe code',kind:'target'},
  {id:'upgrades',label:'Product upgrades',does:'Builds the changes a person would use most',kind:'target'},
  {id:'polish',label:'Polish and taste',does:'Fixes rough edges in layout, copy and feel',kind:'target'},
  {id:'profit',label:'Marketplace profit',does:'Finds what we can sell on Facebook Marketplace, eBay, Amazon, Walmart, OfferUp and Etsy',kind:'plain'}];
 const BAD={failed:1,overdue:1};
 // jobs the schedules feed calls failed or overdue, worst first as the feed lists them
 function failingJobs(sf){const out=[];
  arr(isObj(sf)&&sf.groups).filter(isObj).forEach(g=>arr(g.jobs).filter(isObj).forEach(j=>{if(BAD[str(j.result,12)]||arr(j.members).some(m=>isObj(m)&&m.status==='failed'))out.push({name:str(j.name,70)||'unnamed',host:str(j.host,24),result:BAD[str(j.result,12)]?str(j.result,12):'failed',detail:str(j.detail,60)})}));
  return out}
 // jobs that wait on Tanner (deck-feed-crons owner waits): never counted as failing, named so an agent leaves them alone
 function waitingJobs(sf){const out=[];
  arr(isObj(sf)&&sf.groups).filter(isObj).forEach(g=>arr(g.jobs).filter(isObj).forEach(j=>{if(str(j.result,12)==='waiting')out.push({name:str(j.name,70)||'unnamed',host:str(j.host,24),reason:str(isObj(j.owner_wait)?j.owner_wait.reason:'',100)})}));
  return out}
 const waitTail=w=>w&&w.length?'These wait on me, leave them: '+w.slice(0,6).map(x=>x.name+(x.reason?' ('+x.reason+')':'')).join('; ')+'.\n\n':'';
 const repoName=r=>{const s=str(r,80),i=s.lastIndexOf('/');return i>=0?s.slice(i+1):s};
 // failing workflows on main, then open pull requests whose own checks fail, from the dev feed
 function failingCi(df){const g=isObj(df)&&isObj(df.github)?df.github:{};
  const main=arr(g.failing_main).filter(isObj).map(x=>({repo:repoName(x.repo),workflow:str(x.workflow,60)})).filter(x=>x.repo);
  const prs=arr(g.open_prs).filter(isObj).filter(x=>str(x.ci,12)==='fail'&&Number.isFinite(x.num)).map(x=>({repo:repoName(x.repo),workflow:'pull request #'+x.num+(str(x.title,50)?': '+str(x.title,50):'')})).filter(x=>x.repo);
  return main.concat(prs)}
 const NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
 // what an agent can be pointed at: repos with a failing main first, then repos with open pull requests, then Vercel projects; names only
 function targets(df){const g=isObj(df)&&isObj(df.github)?df.github:{},v=isObj(df)&&isObj(df.vercel)?df.vercel:{},seen=new Set(),out=[];
  const add=(n,repo)=>{n=repo?repoName(n):str(n,80);if(NAME.test(n)&&!seen.has(n)&&out.length<10){seen.add(n);out.push(n)}};
  arr(g.failing_main).filter(isObj).forEach(x=>add(x.repo,1));arr(g.open_prs).filter(isObj).forEach(x=>add(x.repo,1));arr(v.projects).filter(isObj).forEach(x=>add(x.name));
  return out}
 const cur=(sf,df)=>({crons:isObj(sf)?failingJobs(sf):null,wait:isObj(sf)?waitingJobs(sf):null,ci:isObj(df)&&isObj(df.github)?failingCi(df):null});
 // the short line beside a mission: what it will act on right now
 function context(m,t,sf,df){const c=cur(sf,df);
  if(m.kind==='crons'){const w=c.wait&&c.wait.length?' \u00B7 '+c.wait.length+(c.wait.length===1?' waits':' wait')+' on you':'';
   return c.crons==null?'Job list not available':(c.crons.length?c.crons.length+(c.crons.length===1?' job needs':' jobs need')+' a look':'Nothing failing now')+w}
  if(m.kind==='ci')return c.ci==null?'Checks not available':c.ci.length?c.ci.length+(c.ci.length===1?' check is':' checks are')+' failing':'Everything is green';
  if(m.kind==='target')return 'On '+(t===ALL?'everything we ship':t);
  return 'Reads prices before it posts anything'}
 // list lines are cut whole, from the end, until the message fits; the rules are always the last paragraph
 function fit(head,lines,total,tail){let n=lines.length;
  for(;;){const more=total-n,body=head+'\n\n'+lines.slice(0,n).join('\n')+(more>0?'\n+ '+more+' more, in the same order the deck lists them':'')+'\n\n'+tail;
   if(Array.from(body).length<=MAX||n===0)return cleanText(body,MAX);n--}}
 function draft(id,t,sf,df){const m=MISSIONS.find(x=>x.id===id);if(!m)return '';const c=cur(sf,df),what=t===ALL||!NAME.test(String(t))?'everything we ship (the repos and sites on my Dev tab)':t;
  if(id==='crons'){const j=c.crons||[];
   return j.length?fit('Fix the scheduled jobs that are failing right now ('+j.length+'). For each one read its log, find the cause, fix the source, run it once and confirm it passes. Skip any that need me present and say which.',
     j.slice(0,12).map(x=>'- '+x.name+(x.host?' ('+x.host+')':'')+', '+x.result+(x.detail?': '+x.detail:'')),j.length,waitTail(c.wait)+RULES)
    :cleanText('Check every scheduled job on my Crons tab. None showed as failing when I opened this, so look for jobs that report ok but have not really run lately, and fix the cause of any you find.\n\n'+waitTail(c.wait)+RULES,MAX)}
  if(id==='ci'){const x=c.ci||[];
   return x.length?fit('Fix the checks failing right now ('+x.length+'): workflows on main and open pull requests. For each one read the failing log and fix the cause on a branch; a pull request uses its own branch, anything else gets a new pull request. Do not merge.',
     x.slice(0,10).map(r=>'- '+r.repo+(r.workflow?': '+r.workflow:'')),x.length,RULES)
    :cleanText('No checks showed as failing when I opened this. Read the latest runs on my repos, confirm they are green, and fix anything that is flaky or slow.\n\n'+RULES,MAX)}
  if(id==='bugs')return cleanText('Find bugs in '+what+'. Read the code and run it. List the real defects with a way to reproduce each, then fix the ones that are safe to fix and say what is left.\n\n'+RULES,MAX);
  if(id==='security')return cleanText('Review the security of '+what+'. Look for exposed secrets, open ports, unsafe input handling, weak auth and risky dependencies. Fix what is safe to fix and list the rest with the worst case for each.\n\n'+RULES,MAX);
  if(id==='upgrades')return cleanText('Find and build the three upgrades to '+what+' that a person would use most. Judge by real use, not by what sounds impressive. Show me a before and an after for each.\n\n'+RULES,MAX);
  if(id==='polish')return cleanText('Polish '+what+'. Fix rough edges in layout, copy and feel: anything cut off, crowded, inconsistent or generic. Keep what already works and show me a before and an after.\n\n'+RULES,MAX);
  return cleanText('Find ways for us to make money from what we already have. Search listings and prices on Facebook Marketplace, eBay, Amazon, Walmart, OfferUp and Etsy with the read-only tools first, rank the best opportunities by profit after fees, and draft the listings. Do not post, buy or message anyone without asking me.\n\n'+RULES,MAX)}
 const hit=(m,q)=>{const toks=String(q||'').toLowerCase().split(/\s+/).filter(Boolean),h=(m.label+' '+m.does).toLowerCase();return toks.every(t=>h.includes(t))};
 const chip=(on,val,label)=>'<button type="button" class="agt'+(on?' on':'')+'" data-t="'+esc(val)+'" aria-pressed="'+on+'">'+esc(label)+'</button>';
 // a mission: what it is and does on the left, what it will act on right now on the right (in bone: it is the reason to tap)
 const mission=(m,t,sf,df)=>'<button type="button" class="frow agm" data-m="'+m.id+'" data-key="m:'+m.id+'"><span class="fl"><b>'+esc(m.label)+'</b><small>'+esc(m.does)+'</small></span><span class="fr"><small class="cx">'+esc(context(m,t,sf,df))+'</small></span></button>';
 // the Missions section: the missions first (five, then Show more), then the target chips under them. A search shows only the missions it matches, and none hides the section.
 // Opened past five it carries data-bal-open (DeckBalance plans it at its closed height, so it opens in place) and Show fewer, as Markets has.
 function missions(sf,df,target,o){o=isObj(o)?o:{};const list=targets(df),t=target===ALL||list.includes(target)?target:ALL,q=str(o.q,60);
  const ms=MISSIONS.filter(m=>hit(m,q));if(!ms.length)return {t,html:''};
  const n=q?ms.length:Math.max(5,o.open||5),more=ms.length-n,open=!q&&Math.min(n,ms.length)>5;
  return {t,html:'<section class="sect"'+(open?' data-bal-open':'')+'><h2 class="secttl"><span>Missions</span></h2>'+
   '<div class="flist">'+ms.slice(0,n).map(m=>mission(m,t,sf,df)).join('')+'</div>'+
   (more>0||open?'<div class="more-row">'+(more>0?'<button type="button" class="btn" data-lmore="missions">Show '+more+' more</button>':'')+
    (open?'<button type="button" class="btn btn-quiet" data-less="1" data-lmore="missions">Show fewer</button>':'')+'</div>':'')+
   '<div class="chips scroll agtgt" role="group" aria-label="Aim missions at">'+chip(t===ALL,ALL,'Everything')+list.map(x=>chip(t===x,x,x)).join('')+'</div></section>'}}
 return {MISSIONS,ALL,MAX,RULES,failingJobs,waitingJobs,failingCi,targets,context,draft,missions};
})();
// The launch list: the feed's items (DeckUI.launchItems, launchFilter, launchFacets stay in deck.js), drawn as groups of five with Show more.
const LaunchUI=(()=>{
 const {esc,empty,launchFilter,launchFacets,KIND_ORDER,KIND_LABEL,TIER_ORDER,TIER_LABEL}=DeckUI;
 const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const arr=x=>Array.isArray(x)?x:[];
 const FIRST=5,STEP=20;
 const WHERE={hermes:'Hermes',quill:'Quill','pc-desktop':'pc-desktop','mac-mini':'Mac mini',dell:'Dell',spark:'Spark',ascent:'Ascent'};
 // browsing: one group per area in the feed's order; one area chosen: groups by tier; searching: one Results group, best match first
 function groupsOf(items,o){o=isObj(o)?o:{};const q=String(o.q||'').trim(),area=o.area||'all';
  const res=launchFilter(items,q,o.kind||'all',items.length||1,{tier:o.tier,where:o.where,area});
  if(q)return res.rows.length?[{key:'q',title:'Results',rows:res.rows}]:[];
  const byArea=area==='all'&&res.rows.some(x=>x.area),byTier=!byArea&&res.rows.some(x=>x.tier!=='unrated');
  const key=x=>byArea?'a:'+(x.area||'Other'):byTier?'t:'+x.tier:'k:'+x.kind,title=x=>byArea?(x.area||'Other'):byTier?TIER_LABEL[x.tier]:KIND_LABEL[x.kind];
  const out=[];let g=null;for(const x of res.rows){const k=key(x);if(!g||g.key!==k){g={key:k,title:title(x),rows:[]};out.push(g)}g.rows.push(x)}return out}
 // a row: the plain label (a tap opens what it does, its tier and hosts), then the earns marker and the Hermes button with its second-tap state
 function row(x,armed){const title=x.label||x.name,on=armed===x.id+'|hermes';
  const btn=x.targets.includes('hermes')?'<button type="button" class="btn btn-sm lnb'+(on?' armed':'')+'" data-id="'+esc(x.id)+'" data-target="hermes" aria-label="'+(on?'Tap again to run in Hermes: ':'Run in Hermes: ')+esc(title)+'">'+(on?'Tap again':'Hermes')+'</button>':'<span class="pill">View only</span>';
  return '<div class="frow lnrow" data-key="'+esc(x.id)+'"><button type="button" class="fl lninfo" data-lninfo="'+esc(x.id)+'"><b>'+esc(title)+'</b></button>'+
   '<span class="fr">'+(x.earns?'<span class="pill">Earns money</span>':'')+btn+'</span></div>'}
 // a group opened past its first page carries data-bal-open (it opens in place) and Show fewer beside Show more, as Markets has
 function group(g,armed,open){const base=g.key==='q'?STEP:FIRST,n=Math.max(base,open||base),more=g.rows.length-n,wide=Math.min(n,g.rows.length)>base;
  return '<section class="sect lgrp" data-g="'+esc(g.key)+'"'+(wide?' data-bal-open':'')+'><h2 class="secttl"><span>'+esc(g.title)+'</span></h2><div class="flist">'+g.rows.slice(0,n).map(x=>row(x,armed)).join('')+'</div>'+
   (more>0||wide?'<div class="more-row">'+(more>0?'<button type="button" class="btn" data-lmore="'+esc(g.key)+'">Show '+Math.min(STEP,more)+' more</button>':'')+
    (wide?'<button type="button" class="btn btn-quiet" data-less="1" data-lmore="'+esc(g.key)+'">Show fewer</button>':'')+'</div>':'')+'</section>'}
 // the curated row: the same .lnb button and the same second-tap arming as a list row
 function favs(fs,armed){if(!arr(fs).length)return '';
  return '<section class="sect" id="lnfav"><h2 class="secttl"><span>Favorites</span></h2><div class="chips scroll lnfavs">'+fs.map(x=>{const on=armed===x.id+'|hermes';
   return '<button type="button" class="lnb'+(on?' armed':'')+'" data-id="'+esc(x.id)+'" data-target="hermes" aria-label="'+(on?'Tap again to run in Hermes: ':'Run in Hermes: ')+esc(x.name)+'">'+(on?'Tap again':esc(x.label))+'</button>'}).join('')+'</div></section>'}
 // the same favorites as rows for the desk side column, above Launches: the item's own row (label tap opens its sheet, Hermes arms then
 // runs), named by the favorite's short label. On a desk the chip row above is hidden (homeops.css): under the eight Apps tiles it fell
 // off the first screen (reviewer, PR #362). Phones, tablets and the TV keep the chip row.
 function favRows(fs,items,armed){const by=new Map(arr(items).map(x=>[x.id,x])),rs=arr(fs).map(f=>{const it=by.get(f.id);return it?row(Object.assign({},it,{label:f.label}),armed):''}).filter(Boolean);
  return rs.length?'<section class="sect" id="lnfavside"><h2 class="secttl"><span>Favorites</span></h2><div class="flist">'+rs.join('')+'</div></section>':''}
 function list(items,o,armed,open){const gs=groupsOf(items,o);
  if(!gs.length)return '<section class="sect">'+empty({k:'idle',title:'No match',line:'Try fewer words or another filter.'})+'</section>';
  return gs.map(g=>group(g,armed,(open||{})[g.key])).join('')}
 // filter chips: area, kind, tier, works on. Shown beside the list on L and D, in a sheet from the Filters button elsewhere; none on TV
 const fchip=(cls,attr,val,on,label,n)=>'<button type="button" class="'+cls+(on?' on':'')+'" data-'+attr+'="'+esc(val)+'" aria-pressed="'+on+'">'+esc(label)+(n!=null?' <small>'+n+'</small>':'')+'</button>';
 function filters(items,o){o=isObj(o)?o:{};const f=launchFacets(items),c={all:items.length};KIND_ORDER.forEach(k=>c[k]=0);items.forEach(x=>c[x.kind]++);
  const grp=(t,body)=>'<div class="lnfg"><h3 class="sub-h">'+t+'</h3><div class="chips wrap">'+body+'</div></div>';
  return (f.area.length?grp('Area',fchip('lna','area','all',(o.area||'all')==='all','All areas',items.length)+f.area.map(a=>fchip('lna','area',a.area,o.area===a.area,a.area,a.n)).join('')):'')+
   grp('Kind',['all'].concat(KIND_ORDER).filter(k=>k==='all'||c[k]>0).map(k=>fchip('lnk','kind',k,(o.kind||'all')===k,k==='all'?'All':KIND_LABEL[k],c[k])).join(''))+
   grp('Tier',['all'].concat(TIER_ORDER).filter(t=>t==='all'||f.tier[t]>0||o.tier===t).map(t=>fchip('lnt','tier',t,(o.tier||'all')===t,t==='all'?'All tiers':TIER_LABEL[t],f.tier[t])).join(''))+
   (f.where.length?grp('Works on',fchip('lnw','where','all',(o.where||'all')==='all','Anywhere')+f.where.map(w=>fchip('lnw','where',w.w,o.where===w.w,w.label,w.n)).join('')):'')}
 const active=o=>['area','kind','tier','where'].filter(k=>isObj(o)&&o[k]&&o[k]!=='all').length;
 // the detail sheet of one item: what was on the old row (tier, score, raw name, hosts) moves here
 function info(x){if(!isObj(x))return null;const title=x.label||x.name;
  return {kind:'card',title,sub:KIND_LABEL[x.kind].replace(/s$/,''),
   lines:[x.does||x.desc||'No description',x.area?'Area: '+x.area:'','Tier: '+TIER_LABEL[x.tier]+(x.score!=null?' \u00B7 score '+x.score:''),x.why?'Why: '+x.why:'',
    x.where.length?'Works on: '+x.where.map(w=>WHERE[w]||w).join(', '):'',x.earns?'Earns money':'',x.targets.includes('hermes')?'Runs in Hermes: tap Hermes, then tap again within 3 s':'View only: no Hermes run for this item'].filter(Boolean),
   log:['ID '+x.id,'Name '+x.name].concat(x.group?['Group '+x.group]:[]),logTitle:'Details',actions:[{id:'data',label:'Data'}]}}
 // the Data sheet: the launch list as a source, and the words that used to sit in the side column
 function data(f,items,now){const ok=isObj(f)&&!f.error,t=ok?DeckUI.toEpoch(f.t):null;
  return {sources:[{name:'Launch list',gives:ok?items.length+' items':'Not reporting',asOf:t==null?'':DeckUI.ago(t,now),state:!ok?'never':f.stale?'stale':'ok'},
    {name:'Missions',gives:'Failing jobs from the scheduler list, failing checks from the dev feed',asOf:'',state:'ok'}],
   method:[['Run','Tap Hermes, then tap again within 3 s to start it. The run window shows state, time and output. Close keeps the run; Last run reopens it.'],
    ['Missions','The message opens for you to read and change. Nothing starts until you tap Send.'],
    ['Tiers','Core, Useful, Niche, Unrated and Dead come from the launch audit; a group lists core items first.']],setup:[]}}
 // the three reads, each bounded: get(path) resolves a feed or {error}; a read still pending after ms becomes {error:'timed out'},
 // so a hung request paints "Launch list is not reporting" with Try again instead of a blank page. need=false skips the cached list.
 const TIMEOUT_MS=60000;
 function bounded(p,ms){let t=0;return Promise.race([Promise.resolve(p).catch(()=>null),new Promise(go=>{t=setTimeout(()=>go({error:'timed out'}),ms||TIMEOUT_MS)})]).finally(()=>clearTimeout(t))}
 function load(get,need,ms){return Promise.all([need?bounded(get('launch'),ms):null,bounded(get('schedules'),ms),bounded(get('dev'),ms)]).then(([f,sf,df])=>({f:need?(isObj(f)?f:{error:'no answer'}):null,sf,df}))}
 return {FIRST,STEP,TIMEOUT_MS,groupsOf,row,group,favs,favRows,list,filters,active,info,data,bounded,load};
})();
// Apps on this computer (L30, owner sweep a6f30fe and 79d2be1; server restored in #349): GET /api/apps, owner only, one item per app the
// server probed ({t, items:[{id,name,host,area,does,status,why,frame,url,wake}]}; a `dell.needs_setup` marker is one quiet line). The
// section is drawn only when the route answers with apps on this PC: no route, a guest's 403, not_reporting or an empty list draws nothing.
// Dell apps are left out: their routes are the owner's to make, and a tile that only says a state reads as broken (Main, 2026-11-15).
// An app that is up opens in a new tab (opening starts nothing). An asleep app's link gives an error page (its tailnet route skips the
// on-demand gateway), so Wake asks the server: POST /api/apps/wake?id= through deck.js postAppWake, armed on the first tap and sent on a
// second within 3 s (PRODUCT principle 3); the tile then turns Up with Open, or says Starting. A tile is not a .tile: a tap never opens a sheet.
const AppsUI=(()=>{
 const {esc}=DeckUI;
 const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const arr=x=>Array.isArray(x)?x:[];
 const str=(v,n)=>typeof v==='string'?v.trim().slice(0,n||80):'';
 const FIRST=8;
 // the ops state words (PlanDesign M7): unknown is "Not reported", never down; asleep and not started are calm, never red
 const STATE={up:['ok','Up'],'sign-in':['ok','Sign-in'],down:['bad','Down'],asleep:['off','Asleep'],off:['off','Not started'],unknown:['nv','Not reported']};
 const RANK={up:0,'sign-in':1,down:2,asleep:3,unknown:4,off:5};
 const safe=u=>DeckCore.safeUrl(u);
 // a catalog row (status) or an already cleaned model (st): the state word comes only from the fixed list
 const stOf=x=>{const s=str(x.st,12)||str(x.status,12);return Object.prototype.hasOwnProperty.call(STATE,s)?s:'unknown'};
 // one app as the tiles draw it: every word cut and typed, the address through safeUrl (http or https, no quotes, brackets or spaces)
 const model=(x,i)=>({id:str(x.id,40),name:str(x.name,40),does:str(x.does,80),st:stOf(x),why:str(x.why,40),url:safe(x.url),wake:x.wake===true,frame:x.frame===true,i});
 // this computer's apps: what can be opened now first, then down, asleep, not reported, not started; catalog order inside a state
 function items(d){if(!isObj(d))return [];
  return arr(d.items).filter(x=>isObj(x)&&x.host==='PC'&&str(x.id,40)&&str(x.name,40)).map(model).sort((a,b)=>RANK[a.st]-RANK[b.st]||a.i-b.i)}
 const OPEN_LINK='<span class="lk" aria-hidden="true">\u2197</span>';
 const note=t=>t?'<small class="apnote">'+esc(String(t).charAt(0).toUpperCase()+String(t).slice(1))+'</small>':'';
 // wk: the wake in flight or just answered for one app, {id, k:'busy'|'up'|'starting'|'bad', text}
 // no address: an app that is up opens only on this computer; any other state says the server's reason ("not running", "no answer")
 function action(x,armed,wk){const w=isObj(wk)&&wk.id===x.id?wk:null;
  if(x.st==='asleep'&&x.wake){const on=armed==='app:'+x.id,busy=!!w&&w.k==='busy';
   return '<button type="button" class="btn btn-sm apwake'+(on?' armed':'')+'" data-app="'+esc(x.id)+'"'+(busy?' disabled':'')+' aria-label="'+(busy?'Waking ':on?'Tap again to wake ':'Wake ')+esc(x.name)+'">'+(busy?'Waking\u2026':on?'Tap again':'Wake')+'</button>'+(w&&!busy?note(w.text):'')}
  if(!x.url)return note(x.st==='up'||x.st==='sign-in'?'opens on this computer only':x.why);
  // Open here (PRODUCT.md, 2026-11-04): only an app the server's probe saw allow framing (no X-Frame-Options, no CSP frame-ancestors)
  // opens in a panel inside the deck; every other app opens a new tab
  if((x.st==='up'||x.st==='sign-in')&&x.frame)return '<button type="button" class="btn btn-sm apframe" data-app="'+esc(x.id)+'" aria-label="Open '+esc(x.name)+' here">Open here</button>';
  if(x.st==='up'||x.st==='sign-in')return '<a class="btn btn-sm apopen" href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer" aria-label="Open '+esc(x.name)+'">Open'+OPEN_LINK+'</a>';
  return note(x.why)}
 // an app the deck just woke reads Starting until the next probe sees it up
 // every renderer takes the cleaned model (model() is idempotent): names, words and the address are cut, typed and passed through safeUrl
 // once more here, so a caller that hands a raw catalog row still cannot write markup or a script link
 function tile(x,armed,wk){if(!isObj(x))return '';x=model(x);const s=isObj(wk)&&wk.id===x.id&&wk.k==='starting'&&x.st==='asleep'?['nv','Starting']:STATE[x.st];
  return '<div class="appt" role="listitem" data-key="app:'+esc(x.id)+'"><b class="apn">'+esc(x.name)+'</b><span class="aps"><span class="sd '+s[0]+'"></span>'+s[1]+'</span>'+
   (x.does?'<small class="apd">'+esc(x.does)+'</small>':'')+action(x,armed,wk)+'</div>'}
 // POST /api/apps/wake answer -> what the tile says: up (Open follows on the next read), starting, or the reason it did not wake
 function wakeView(j,status){if(isObj(j)&&j.ok===true)return j.state==='starting'?{k:'starting',text:'starting; Open shows when it is up'}:{k:'up',text:'awake'};
  const e=isObj(j)?str(j.error,80):'';
  if(status===429||e==='rate limited')return {k:'bad',text:'one wake at a time: try again in '+(Number.isFinite(j&&j.retry_s)?j.retry_s:4)+' s'};
  return {k:'bad',text:e?'did not wake: '+e:status?'did not wake (error '+status+')':'no answer from the deck; try again'}}
 const FRAME_SANDBOX='allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';
 // the panel for Open here: a wide sheet (its Close and the browser's Back are the way back) holding the app, and "Open in a new tab" beside
 // it; null for an app that may not be framed
 function frameSheet(x){if(!isObj(x))return null;x=model(x);if(!x.frame||!x.url||!(x.st==='up'||x.st==='sign-in'))return null;
  // sandboxed (review of #388): the app keeps its own scripts, forms, popups and downloads, but the list never grants top navigation,
  // so a page from another origin cannot move the deck's own window from inside the panel
  return {id:'appframe',wide:true,title:x.name,sub:'Inside the deck',
   body:'<iframe class="appfrm" title="'+esc(x.name)+'" src="'+esc(x.url)+'" sandbox="'+FRAME_SANDBOX+'" referrerpolicy="same-origin"></iframe>',
   actions:'<a class="btn" href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">Open in a new tab'+OPEN_LINK+'</a>'}}
 // the head's count: what is up, what is down, what sleeps
 function count(xs){const n=k=>xs.filter(x=>x.st===k).length,up=n('up')+n('sign-in');
  return [up+' up',n('down')?n('down')+' down':'',n('asleep')?n('asleep')+' asleep':''].filter(Boolean).join(' \u00B7 ')}
 // after a failed read the tiles stay under the page's one stale line (PRODUCT 2026-10-29): "Out of date · last read N min"
 function lastRead(t,now){const m=Math.max(1,Math.round((now-t)/60000));return 'Out of date \u00B7 last read '+(m<90?m+' min':Math.round(m/60)+' h')}
 // o: {armed, wake, open (true once Show more is tapped), stale: ms of the last good read when the latest read failed, now}.
 // Eight tiles, then Show more with the rest, and Show fewer once open (data-bal-open)
 function section(d,o){o=isObj(o)?o:{};const xs=items(d);if(!xs.length)return '';
  const open=!!o.open&&xs.length>FIRST,shown=open?xs:xs.slice(0,FIRST),more=xs.length-shown.length;
  const head=typeof o.stale==='number'&&isFinite(o.stale)?lastRead(o.stale,typeof o.now==='number'?o.now:Date.now()):count(xs);
  const dl=isObj(d.dell)&&d.dell.needs_setup===true?'<small class="apdell">Dell apps need a route on the tailnet</small>':'';
  return '<section class="sect" id="lnapps"'+(open?' data-bal-open':'')+'><h2 class="secttl"><span>Apps</span><span>'+esc(head)+'</span></h2>'+
   '<div class="appgr" role="list">'+shown.map(x=>tile(x,o.armed,o.wake)).join('')+'</div>'+
   (more>0||open?'<div class="more-row">'+(more>0?'<button type="button" class="btn" data-lmore="apps">Show '+more+' more</button>':'')+
    (open?'<button type="button" class="btn btn-quiet" data-less="1" data-lmore="apps">Show fewer</button>':'')+'</div>':'')+dl+'</section>'}
 // the Data sheet's line for the apps: how many were checked and when; a route that did not answer is not listed
 function source(d,now){const xs=items(d);if(!xs.length)return null;const t=DeckUI.toEpoch(d.t);
  return {name:'Apps on this computer',gives:xs.length+' apps, each checked by the deck server',asOf:t==null?'':DeckUI.ago(t,now),state:'ok'}}
 return {FIRST,STATE,FRAME_SANDBOX,items,tile,wakeView,frameSheet,lastRead,section,source};
})();
// ==== AGENTS UI HELPERS END ====
// ---- page glue (DOM + fetch) ----
(()=>{
 if(typeof document==='undefined')return;
 const LN={f:null,items:[],favs:[],err:null,t:0,sf:null,df:null,apps:null,appsT:0,appsStale:false,wake:null,wakeT:0,ctx:null,q:'',open:{},armed:'',armT:0,sending:false,
  target:localStorage.getItem('agent-target')||AgentsUI.ALL,kind:'all',tier:localStorage.getItem('launch-tier')||'all',area:localStorage.getItem('launch-area')||'all',
  where:(w=>!w||w==='omp'?'all':w)(localStorage.getItem('launch-where'))};
 const el=()=>LN.ctx&&LN.ctx.el;
 const SEARCH='<label class="search"><svg class="i" aria-hidden="true"><use href="#i-search"/></svg><input id="lnq" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Search" aria-label="Search missions and the launch list"></label>';
 // built once: the search field and the results column survive every repaint (the run window writes #lnmsg and #lnlast).
 // #missions exists from the first show, so the shell's scroll for home/launch#missions (the old Agents link) finds it before the feeds answer.
 // #lnmain opts in to the shared balancer (data-balance): missions, apps, favorites and each group are whole blocks in its columns.
 // W11: the filters sit behind the one Filters button in every class; on a desk the side column (sticky, scrolling inside itself) holds the
 // favorites as rows, then the launch results. At 1440x900 the filter chips took the right 40% of the first screen.
 function frame(){const e=el();if(!e||e.querySelector('#hlaunch'))return;
  e.innerHTML='<div class="hops" id="hlaunch"><div class="hops-bar">'+SEARCH+'<button type="button" class="btn" id="lnfo">Filters</button></div>'+
   '<div class="lgrid"><div class="lmain" id="lnmain" data-balance><div class="lmis board" id="missions"></div></div><aside class="lside"><div id="lnfavd"></div>'+
   '<section class="sect" id="lnrun"><h2 class="secttl"><span>Launches</span></h2><div id="lnmsg" role="status" aria-live="polite"></div><button type="button" class="btn" id="lnlast" disabled>No run yet</button></section></aside></div></div>';
  e.querySelector('#lnq').value=LN.q;paintResults();runSavePaintLast()}
 const opts=()=>({q:LN.q,kind:LN.kind,tier:LN.tier,where:LN.where,area:LN.area});
 function paint(){const e=el();if(!e)return;frame();
  try{if(LN.items.length&&LN.area!=='all'&&!DeckUI.launchFacets(LN.items).area.some(a=>a.area===LN.area))LN.area='all'; // a saved area the feed no longer has
   const m=AgentsUI.missions(LN.sf,LN.df,LN.target,{q:LN.q,open:LN.open.missions});LN.target=m.t;
   const body=!LN.f?DeckUI.empty({k:LN.err?'bad':'idle',title:LN.err?'Launch list is not reporting':'Reading the launch list',line:LN.err?DeckUI.problem(LN.err).line:'',retry:LN.err?'launch':''}):
    (LN.q?'':LaunchUI.favs(LN.favs,LN.armed))+LaunchUI.list(LN.items,opts(),LN.armed,LN.open);
   // the Apps section comes right after Missions and is not searched: a search shows only missions and launch items
   const apps=LN.q?'':AppsUI.section(LN.apps,{armed:LN.armed,wake:LN.wake,open:!!LN.open.apps,stale:LN.appsStale?LN.appsT:null,now:Date.now()});
   e.querySelector('#missions').innerHTML=m.html;blocks(e,apps+body);
   e.querySelector('#lnfavd').innerHTML=LN.f&&!LN.q?LaunchUI.favRows(LN.favs,LN.items,LN.armed):'';
   const n=LaunchUI.active(opts()),fo=e.querySelector('#lnfo');fo.innerHTML='Filters'+(n?' <small>'+n+'</small>':'');fo.hidden=!LN.f}
  catch(err){blocks(e,renderFail('Launch'))}
  if(LN.ctx)DeckPages.mark(LN.ctx,mark());if(typeof DeckShell!=='undefined'&&DeckShell.tv)DeckShell.tv.refresh()}
 // the list's blocks sit beside #missions in the balanced box: put every block back in order (DeckBalance.reset), drop the old ones, add the new
 function blocks(e,html){const main=e.querySelector('#lnmain'),mis=e.querySelector('#missions');if(!main)return;
  if(typeof DeckBalance!=='undefined')DeckBalance.reset(main);[...main.children].forEach(x=>{if(x!==mis)x.remove()});main.insertAdjacentHTML('beforeend',html)}
 function mark(){const now=Date.now(),t=LN.f?DeckUI.toEpoch(LN.f.t):null,miss=(LN.f?0:1)+(LN.sf&&!LN.sf.error?0:1)+(LN.df&&!LN.df.error?0:1);
  return {age:t==null?null:Math.max(0,Math.round(now/1000-t)),refresh:3600,missing:miss}}
 // the launch list is cached five minutes (it is large); the two mission feeds and the apps are read on every show. Every read is bounded at 60 s.
 // The apps are read on their own and paint when they answer, so a slow probe never holds the missions and the list back. A failed read after
 // a good one keeps the tiles under "Out of date · last read N min"; a 401 or 403 (a role change) drops them; no good read yet draws nothing.
 const get=p=>DeckPages.get(p,{timeout:LaunchUI.TIMEOUT_MS}).then(r=>r.ok?r.data:{error:r.error||'no answer',status:r.status});
 let busy=false,appsBusy=false;
 function appsLoad(){if(appsBusy)return;appsBusy=true;
  LaunchUI.bounded(get('apps')).then(a=>{
   if(AppsUI.items(a).length){LN.apps=a;LN.appsT=Date.now();LN.appsStale=false}else if(a&&(a.status===401||a.status===403)){LN.apps=null;LN.appsStale=false}else if(LN.apps)LN.appsStale=true;
   if(LN.ctx)paint()}).finally(()=>{appsBusy=false})}
 async function load(force){appsLoad();if(busy)return;busy=true;try{const need=force||!LN.f||Date.now()-LN.t>300000,{f,sf,df}=await LaunchUI.load(get,need);
  if(need){if(f&&!f.error){LN.f=f;LN.items=DeckUI.launchItems(f);LN.favs=DeckUI.launchFavorites(f,LN.items);LN.t=Date.now();LN.err=null}else LN.err=f||{error:'no answer'}}
  LN.sf=sf;LN.df=df;paint()}finally{busy=false}}
 function filterSheet(){if(typeof DeckShell==='undefined')return;DeckShell.sheet.open({id:'lnfilters',title:'Filters',body:'<div class="lnflt">'+LaunchUI.filters(LN.items,opts())+'</div>',actions:'<button type="button" class="btn" data-lnclear>Clear filters</button>'})}
 function setFilter(k,v){LN[k]=v;if(k!=='kind')localStorage.setItem('launch-'+k,v);LN.open={};buzz('selection');paint();
  const d=document.querySelector('dialog[open] .lnflt');if(d)d.innerHTML=LaunchUI.filters(LN.items,opts())}
 let qT=0;
 document.addEventListener('input',e=>{if(!e.target||e.target.id!=='lnq')return;clearTimeout(qT);qT=setTimeout(()=>{LN.q=e.target.value;LN.open={};paint()},120)});
 // one delegated handler: filter chips live in the Filters sheet, so they are matched anywhere on the page
 document.addEventListener('click',async e=>{const t=e.target&&e.target.closest?e.target:null;if(!t)return;
  const f=t.closest('.lna,.lnk,.lnt,.lnw');if(f&&f.closest('.lnflt')){const k=f.classList.contains('lna')?'area':f.classList.contains('lnk')?'kind':f.classList.contains('lnt')?'tier':'where';return setFilter(k,f.dataset[k])}
  if(t.closest('[data-lnclear]')){['area','kind','tier','where'].forEach(k=>{LN[k]='all';if(k!=='kind')localStorage.setItem('launch-'+k,'all')});LN.open={};paint();const d=document.querySelector('dialog[open] .lnflt');if(d)d.innerHTML=LaunchUI.filters(LN.items,opts());return}
  if(t.closest('#lnlast')){if(typeof reopenRun==='function')reopenRun();return}
  if(!t.closest('#hlaunch'))return;
  if(t.closest('#lnfo'))return filterSheet();
  const more=t.closest('[data-lmore]');if(more){const k=more.dataset.lmore;
   if(more.dataset.less){delete LN.open[k];paint();const r=el(),s=r&&(k==='missions'?r.querySelector('#missions>.sect'):k==='apps'?r.querySelector('#lnapps'):[...r.querySelectorAll('.lgrp')].find(x=>x.dataset.g===k));if(s&&typeof DeckBalance!=='undefined')DeckBalance.fewer(s);return}
   if(k==='apps'){LN.open.apps=true;return paint()}
   LN.open[k]=(LN.open[k]||(k==='q'?LaunchUI.STEP:LaunchUI.FIRST))+LaunchUI.STEP;return paint()}
  const wk=t.closest('button.apwake');if(wk)return wake(wk);
  // Open here: the app in a wide sheet inside the deck; its Close or Back returns, "Open in a new tab" sits beside it
  const fr=t.closest('button.apframe');if(fr){const s=AppsUI.frameSheet(AppsUI.items(LN.apps).find(i=>i.id===fr.dataset.app));if(s&&typeof DeckShell!=='undefined'){buzz('light');DeckShell.sheet.open(Object.assign({opener:fr},s))}return}
  const tg=t.closest('.agt');if(tg){LN.target=tg.dataset.t;localStorage.setItem('agent-target',LN.target);buzz('selection');return paint()}
  const m=t.closest('.agm');if(m){buzz('light');return openCompose(AgentsUI.draft(m.dataset.m,LN.target,LN.sf,LN.df),m)}
  const inf=t.closest('.lninfo');if(inf){const x=LN.items.find(i=>i.id===inf.dataset.lninfo),s=LaunchUI.info(x);if(s)openSheet(s,inf);return}
  const b=t.closest('.lnb');if(b)launch(b)});
 // Wake starts an app: the first tap arms it (3 s), the second sends POST /api/apps/wake (deck.js postAppWake). The tile says Waking, then
 // the answer; the apps are read again at once (up) or after 5 s (starting), so Open appears when the probe sees the app.
 async function wake(b){const id=b.dataset.app,key='app:'+id;if(!id||(LN.wake&&LN.wake.k==='busy'))return;
  if(LN.armed!==key){LN.armed=key;clearTimeout(LN.armT);LN.armT=setTimeout(()=>{LN.armed='';paint()},3000);buzz('light');paint();return}
  LN.armed='';clearTimeout(LN.armT);clearTimeout(LN.wakeT);LN.wake={id,k:'busy'};buzz('light');paint();
  let v;try{const {json:j,status}=await postAppWake(id);v=AppsUI.wakeView(j,status)}catch(err){v=AppsUI.wakeView(null,0)}
  LN.wake=Object.assign({id},v);buzz(v.k==='bad'?'error':'success');paint();
  if(v.k!=='bad')setTimeout(appsLoad,v.k==='starting'?5000:0);
  LN.wakeT=setTimeout(()=>{LN.wake=null;paint()},30000)}
 // second tap within 3 s starts it: the same allowlisted route and the same result line and run window as before
 async function launch(b){if(b.dataset.target!=='hermes')return;const key=b.dataset.id+'|hermes';
  if(LN.armed!==key){LN.armed=key;clearTimeout(LN.armT);LN.armT=setTimeout(()=>{LN.armed='';paint()},3000);buzz('light');paint();return}
  LN.armed='';clearTimeout(LN.armT);paint();if(LN.sending)return;LN.sending=true;
  const nm=(b.getAttribute('aria-label')||'').replace(/^(Tap again to run|Run) in Hermes: /,'')||'the item';addResult({k:'pending',text:'Starting '+nm+' in Hermes'});
  try{const {json:j,status}=await postLaunchItem(b.dataset.id,'hermes');V6.results.shift();addResult(DeckUI.launchResult(j,status));
   if(j&&j.ok&&typeof j.run_id==='string')openRun({run_id:j.run_id,name:j.name||b.dataset.id,opened:Date.now()/1000},true)}
  catch(err){V6.results.shift();addResult({k:'bad',text:DeckUI.humanErr(null,0)})}
  finally{LN.sending=false}}
 // "Fix these" on the Crons and Dev pages: read the feed again, open the message in the run window's composer. It sends nothing; Send is the second tap.
 document.addEventListener('click',async e=>{const b=e.target.closest&&e.target.closest('button.fix[data-fix]');if(!b||b.disabled)return;
  const kind=b.dataset.fix;if(kind!=='crons'&&kind!=='ci')return;b.disabled=true;buzz('light');
  try{const read=p=>DeckPages.get(p,{timeout:LaunchUI.TIMEOUT_MS}).then(r=>r.ok?r.data:null);
   const [sf,df]=await Promise.all([kind==='crons'?read('schedules'):null,kind==='ci'?read('dev'):null]);openCompose(AgentsUI.draft(kind,AgentsUI.ALL,sf,df),b)}
  catch(err){}finally{b.disabled=false}});
 DeckPages.register('home/launch',{every:30000,
  show(ctx){LN.ctx=ctx;if(LN.f)paint();else frame();load(false)},
  refresh(ctx){LN.ctx=ctx;load(false)},
  hide(){clearTimeout(qT);clearTimeout(LN.armT);LN.armed='';if(!LN.wake||LN.wake.k!=='busy'){clearTimeout(LN.wakeT);LN.wake=null}LN.ctx=null},
  data(){const d=LaunchUI.data(LN.f,LN.items,Date.now()),s=AppsUI.source(LN.apps,Date.now());if(s)d.sources.push(s);return d}});
 window.RETRY_LAUNCH=()=>load(true);
})();
