// Home > Crons: every scheduled job Tanner owns in one list (GET /api/schedules, written by deck-feed-crons): Hermes jobs, systemd user timers
// (hosts that answered), Mac mini launchd and GitHub Actions schedules. All crons folded in here on 2026-11-14 as the All filter.
// Filters: Active (default: enabled, running, failing or waiting on you), Failing, Overdue, All (paused, finished and retired included).
// Search on top, 50 rows, then Show more. A Hermes row opens the Hermes job sheet, whose Run now, Pause and Resume keep their second tap
// (deck.js cronAct, POST /api/cron-act). Other rows open a read-only sheet. Sources, coverage and counts live in the Data sheet.
// Loaded after deck.js; uses DeckUI and the page glue (feedGet, jget, openSheet, paintSheet, SHEET, V6, DeckPages, DeckShell, $).
// ==== SCHEDULES UI HELPERS BEGIN (pure: no DOM, no fetch; tests load this block with DeckUI injected) ====
const SchedUI=(()=>{
const {esc,ago,until,toEpoch,state,down,schedule,redact,empty}=DeckUI;
 const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const arr=x=>Array.isArray(x)?x:[];
 const num=v=>typeof v==='number'&&isFinite(v)?v:null;
 const str=(v,n)=>typeof v==='string'?v.trim().slice(0,n||120):'';
 // waiting: a failed job that only Tanner can clear (deck-feed-crons owner waits): the needs-you mark with its reason, never counted as failing
 const RESULTS=['ok','failed','waiting','running','never','paused','skipped','overdue','unknown'];
 const MSTATUS=['ok','failed','skipped','running','unknown','pending'];
 const LABEL={ok:'OK',failed:'Failed',waiting:'Waits on you',running:'Running',never:'Never ran',paused:'Paused',skipped:'Skipped',overdue:'Overdue',unknown:'Unknown'};
 const PAGE=50;
 const FILTERS=[['active','Active'],['failing','Failing'],['overdue','Overdue'],['all','All']];
 const TITLE={active:'Active jobs',failing:'Failing jobs',overdue:'Overdue jobs',all:'All jobs'};
 const memBad=j=>arr(j.members).some(m=>m.status==='failed');
 const isFailing=j=>j.result==='failed'||memBad(j);
 const isOverdue=j=>j.result==='overdue'||arr(j.members).some(m=>m.overdue);
 // needs a look: failed, overdue or a failed batch member (what "Fix these" hands to the assistant)
 const isBad=j=>isFailing(j)||j.result==='overdue';
 const isWait=j=>j.result==='waiting'&&!isBad(j);
 const isActive=j=>j.enabled||j.result==='running'||isBad(j)||isWait(j);
 const clock=t=>{const x=toEpoch(t);if(x==null)return '';const d=new Date(x*1000);return d.toLocaleDateString([],{weekday:'short'})+' '+d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})};
 // the filter a route or a stored choice asks for: ?f= wins, then the stored chip; old All crons views map onto the new four
 const OLD={problem:'failing',history:'all'};
 function filterOf(param,stored){for(const v of [param,stored]){const s=str(v,20).toLowerCase(),m=OLD[s]||s;if(FILTERS.some(f=>f[0]===m))return m}return 'active'}
 // a job from the feed, with every field forced to a known type; the result word is trusted only from the fixed list
 function norm(j,g){
  const r=str(j&&j.result,12);
  return {name:str(j&&j.name,90)||'unnamed',host:str(j&&j.host,20)||str(g&&g.host,20)||'host?',kind:str(j&&j.kind,12),schedule:str(j&&j.schedule,90),
   enabled:!!(j&&j.enabled),lifecycle:str(j&&j.lifecycle,12),last:toEpoch(j&&j.last),started:toEpoch(j&&j.started),triggered:toEpoch(j&&j.triggered),next:toEpoch(j&&j.next),approx:!!(j&&j.approx_next),
   result:RESULTS.includes(r)?r:'unknown',detail:str(j&&j.detail,120),about:str(j&&j.about,90),gid:str(g&&g.id,40),glabel:str(g&&g.label,40),
   wait:isObj(j&&j.owner_wait)?{reason:str(j.owner_wait.reason,100),action:str(j.owner_wait.action,160),until:str(j.owner_wait.until,25)}:null,
   members:arr(j&&j.members).filter(isObj).slice(0,120).map(m=>({name:str(m.name,60)||'member',status:MSTATUS.includes(str(m.status,12))?str(m.status,12):'unknown',
    started:toEpoch(m.started),finished:toEpoch(m.finished),due:toEpoch(m.due),deferred:toEpoch(m.deferred_since),overdue:m.overdue===true,overrun:m.overrun===true,exit:typeof m.exit==='number'&&isFinite(m.exit)?m.exit:null}))}}
 function groups(f){return isObj(f)?arr(f.groups).filter(isObj):[]}
 function flatten(f){const out=[];groups(f).forEach(g=>arr(g.jobs).filter(isObj).forEach(j=>out.push(norm(j,g))));return out}
 // rows merged away by consolidation: kept as history under All, never counted as active
 function retiredOf(f){const out=[];groups(f).forEach(g=>arr(g.retired).filter(isObj).forEach(r=>out.push({name:str(r.name,90)||'unnamed',host:str(r.host,20)||str(g.host,20),kind:'retired',schedule:'',
  enabled:false,lifecycle:'retired',last:null,started:null,next:null,approx:false,result:'paused',detail:(str(r.outcome,90)||'merged into '+(str(r.merged_into,60)||'another job'))+(toEpoch(r.at)!=null?' \u00B7 '+clock(toEpoch(r.at)):''),
  about:'',gid:str(g.id,40),glabel:str(g.label,40),wait:null,members:[]})));return out}
 // needs a look first, then what waits on Tanner, then the Hermes jobs (the ones he can run, pause and resume here), then running,
 // then the soonest next run, then never-run, then paused
 const rank=j=>isBad(j)?0:isWait(j)?1:j.result==='paused'?6:isHermes(j)?2:j.result==='running'?3:j.next!=null?4:5;
 function sorted(list){return list.slice().sort((a,b)=>{const ra=rank(a),rb=rank(b);if(ra!==rb)return ra-rb;
  if(ra===0)return (b.last||0)-(a.last||0)||a.name.localeCompare(b.name);
  if(ra===2||ra===4)return (a.next==null)-(b.next==null)||(a.next||0)-(b.next||0)||a.name.localeCompare(b.name);
  return a.name.localeCompare(b.name)})}
 function matches(j,q){q=str(q,60).toLowerCase();if(!q)return true;return q.split(/\s+/).every(t=>(j.name+' '+j.host+' '+j.kind+' '+j.schedule+' '+j.detail+' '+j.about+' '+j.result+' '+arr(j.members).map(m=>m.name).join(' ')).toLowerCase().includes(t))}
 function pick(j,filter){if(filter==='failing')return isFailing(j);if(filter==='overdue')return isOverdue(j);if(filter==='all')return true;return isActive(j)}
 // the rows a filter and a search show, in row order; the detail sheet opens by index into this same list
 function listOf(f,filter,q){const shown=sorted(flatten(f).filter(j=>pick(j,filter)&&matches(j,q)));
  return filter==='all'?shown.concat(retiredOf(f).filter(j=>matches(j,q))):shown}
 function counts(f){const all=flatten(f);return {active:all.filter(isActive).length,failing:all.filter(isFailing).length,overdue:all.filter(isOverdue).length,all:all.length+retiredOf(f).length,bad:all.filter(isBad).length}}
 // the row's parts: the small line is the host (and a batch note), the right column is one time in text-1 plus a status pill when the job is not OK.
 // A failed, waiting, overdue or unknown job shows when it last ran; running shows when it started; a healthy job shows its next run.
 function rowParts(j,now){
  const fail=isFailing(j),od=!fail&&j.result==='overdue',wait=isWait(j);
  const bad=j.members.filter(m=>m.status==='failed').length,odm=j.members.filter(m=>m.overdue).length;
  const mem=bad?bad+' of '+j.members.length+' members failed':odm?odm+' of '+j.members.length+' members overdue':'';
  const next=!j.enabled||j.result==='paused'?'':j.next==null?'not scheduled':(j.approx?'about ':'')+until(j.next,now);
  const time=j.lifecycle==='retired'||j.result==='paused'?'':j.result==='running'?(j.started!=null?ago(j.started,now):'now'):
   fail||od||wait||j.result==='unknown'?(j.last!=null?ago(j.last,now):'time unknown'):next;
  const word=j.lifecycle==='retired'?'Retired':j.lifecycle==='done'&&j.result!=='running'?'Finished':fail?'Failed':j.result==='ok'?'':LABEL[j.result];
  const k=fail?'bad':od?'warn':wait?'wait':j.result==='running'?'ok':'';
  return {line:[j.host,mem,wait&&j.wait?j.wait.reason:''].filter(Boolean).join(' \u00B7 '),time,word,k,hermes:isHermes(j)}}
 // a row is a button: tap or Enter opens the sheet. Status is a mark plus a word; waiting uses the needs-you mark, never red.
 // A Hermes job (Run now, Pause and Resume live in its sheet) says so first on its second line, in bone, so it reads apart from the timers.
 function row(j,now,i){const p=rowParts(j,now);
  return '<button type="button" class="frow scrow'+(p.k?' k-'+p.k:'')+(p.hermes?' hj':'')+(j.result==='paused'&&p.k!=='bad'?' off':'')+'" data-sched="'+i+'" data-key="'+esc(j.host+'|'+j.name)+'">'+
   '<span class="fl"><b>'+esc(j.name)+'</b><small>'+(p.hermes?'<span class="kd">Hermes job</span>'+(p.line?' \u00B7 ':''):'')+esc(p.line)+'</small></span>'+
   '<span class="fr">'+(p.time?'<b>'+esc(p.time)+'</b>':'')+(p.word?'<span class="pill'+(p.k?' '+p.k:'')+'">'+(p.k?'<span class="sd '+p.k+'"></span>':'')+esc(p.word)+'</span>':'')+'</span></button>'}
 // the filter as chips (T, D) and as one select (P, L: four chips do not fit beside the search); CSS shows one of them
 function chips(c,filter){return '<div class="chips" id="scf" role="group" aria-label="Show jobs">'+FILTERS.map(([k,l])=>{const on=filter===k;
  return '<button type="button" class="scf'+(on?' on':'')+'" data-f="'+k+'" aria-pressed="'+on+'">'+esc(l)+' <small>'+c[k]+'</small></button>'}).join('')+'</div>'+
  '<select class="btn scsel" id="scsel" aria-label="Show jobs">'+FILTERS.map(([k,l])=>'<option value="'+k+'"'+(filter===k?' selected':'')+'>'+esc(l)+' ('+c[k]+')</option>').join('')+'</select>'}
 // the control row: the filter, then "Fix these" while something needs a look (never under All)
 // G7: below 1100 px and on L the filter is one select ("Active (233)"), so the failing count left the first screen. While jobs fail, a
 // "Failing N" chip (it opens Failing) stands beside the select with Fix these. A phone has no room for both beside the search, so there
 // they sit in a second row under the bar (need), drawn only while something needs a look: both one tap from the first screen. Where the
 // four chips show, their counts carry it (homeops.css). The page never opens on Failing by itself: the list would change under the reader
 // once the feed answers, and Active already puts failing jobs first.
 function failChip(c,filter){if(!(c.failing>0)||filter==='failing')return '';
  return '<button type="button" class="btn btn-sm scf scfail" data-f="failing" aria-label="Failing: '+c.failing+(c.failing===1?' job':' jobs')+'. Show them"><span class="sd bad"></span>Failing <b>'+c.failing+'</b></button>'}
 const fixBtn=c=>'<button type="button" class="btn btn-sm fix" data-fix="crons" aria-label="Fix these: opens a message about '+c.bad+' failing jobs; nothing starts until you tap Send">Fix these</button>';
 const needs=(c,filter)=>failChip(c,filter)+(c.bad>0&&filter!=='all'?fixBtn(c):'');
 function bar(f,filter){const c=counts(f);return chips(c,filter)+needs(c,filter)}
 function need(f,filter){const h=needs(counts(f),filter);return h?'<div class="scneed" role="group" aria-label="Needs a look">'+h+'</div>':''}
 const EMPTY={active:['No active jobs','Jobs you turn on show up here.'],failing:['No failing jobs','Every job ran fine the last time.'],overdue:['No overdue jobs','Every job ran on time.'],all:['No jobs','The scheduler list is empty.']};
 // the job list: up to n rows, then Show more. The control row names the filter, so the list carries its title as a label only.
 function section(f,now,o){const filter=o.filter,list=listOf(f,filter,o.q),n=Math.max(PAGE,num(o.n)||PAGE);
  const e=str(o.q,60)?['No job matches','Try fewer words or another filter.']:EMPTY[filter];
  const more=list.length-n;
  return list.length?'<div class="flist" id="sclist" role="group" aria-label="'+TITLE[filter]+'">'+list.slice(0,n).map((j,i)=>row(j,now,i)).join('')+'</div>'+
    (more>0?'<div class="more-row"><button type="button" class="btn" data-sched-more>Show '+Math.min(PAGE,more)+' more</button></div>':'')
   :empty({k:'idle',title:e[0],line:e[1]})}
// the page's status (GET /api/crons, the Hermes job list): when every Hermes job is paused, the halt notice says the owner stopped them,
// since when and why (removed, merged, stopped); otherwise how many are on, tallied by lane. Not an alarm: no mark, no colour.
// L28: a job that pins no model runs on the fleet default; crons.rs files it under the default's lane and says so in model_source. NO MODEL
// is left for a job the server could not resolve (or an older server), so it reads "No model pinned", never "No model".
const LANE_WORD={CLAUDE:'Claude',CODEX:'Codex','NO MODEL':'No model pinned',OTHER:'Other'};
function hermesLine(c){if(!isObj(c)||c.error)return '';
 const act=arr(c.active).filter(isObj),n=isObj(c.counts)?c.counts:{},total=num(n.total)!=null?n.total:act.length+arr(c.paused).filter(isObj).length;
 if(!total)return '';
 const ht=isObj(c.halt)&&c.halt.all_paused===true?c.halt:null;let b,sm,r;
 if(ht){const hc=isObj(ht.counts)?ht.counts:{},since=DeckUI.fmt.date(str(ht.since,30)),other=(num(hc.other)||0)+(num(hc.unknown)||0);
  const mix=['removed','merged','stopped'].filter(k=>num(hc[k])>0).map(k=>hc[k]+' '+k).concat(other>0?[other+' other']:[]).join(', ');
  b='Everything is paused because you stopped it';sm=[since?'Since '+since:'',mix].filter(Boolean).join(' \u00B7 ')+(since||mix?'. ':'')+'Turn one back on from its sheet under All.';r=total+' paused'}
 else{const by={};act.forEach(j=>{const l=DeckUI.laneOf(j);by[l]=(by[l]||0)+1});
  const fl=num(n.last_failed)||0,fd=act.filter(j=>str(j.model_source,16)==='fleet default').length;
  b='Hermes jobs';sm=[Object.keys(LANE_WORD).filter(l=>by[l]).map(l=>LANE_WORD[l]+' '+by[l]).join(' \u00B7 ')||'None on',fd>0?fd+(fd===1?' uses':' use')+' the fleet default model':'',fl>0?fl+' failed last time':''].filter(Boolean).join(' \u00B7 ');r=act.length+' of '+total+' on'}
 return '<div class="flist sc-st"><div class="frow" role="status"><span class="fl"><b>'+esc(b)+'</b><small>'+esc(sm)+'</small></span><span class="fr"><b>'+esc(r)+'</b></span></div></div>'}
// the page: the control row (search, filter, Fix these), the Hermes status line, then the job list. A feed that did not report is one empty
// state. o.c is the Hermes job list (GET /api/crons) or undefined.
function page(f,now,o){if(state(f)==='bad')return {broken:true,bar:'',sect:down('Crons',f,'crons')};
 return {broken:false,bar:bar(f,o.filter),sect:need(f,o.filter)+hermesLine(o.c)+section(f,now,o)}}
 // both reads, bounded: get(path) resolves a feed or {error}; a read that has not settled after ms becomes {error:'timed out'},
 // so a hung request paints "Crons are not reporting" with Try again instead of a blank page
 const TIMEOUT_MS=60000;
 function bounded(p,ms){let t=0;return Promise.race([Promise.resolve(p).catch(()=>null),new Promise(go=>{t=setTimeout(()=>go({error:'timed out'}),ms||TIMEOUT_MS)})]).finally(()=>clearTimeout(t))}
 function load(get,ms){return Promise.all([bounded(get('schedules'),ms),bounded(get('crons'),ms)]).then(([f,c])=>({f:isObj(f)?f:{error:'no answer'},c}))}
 // one freshness mark for the page; a host that could not be read is a part not reporting
 function fresh(f,now){if(!isObj(f)||f.error)return {missing:1,age:null,refresh:300};
  const t=toEpoch(f.t);return {age:t==null?null:Math.max(0,Math.round(now/1000-t)),refresh:num(f.refresh)||300,stale:f.stale===true,missing:groups(f).filter(g=>g.ok===false).length}}
 const agoT=(t,now)=>num(t)==null?'time unknown':ago(t,now);
 // Data sheet: every scheduler group as a source, the counts and rules that used to sit above the first job, and the hosts that did not answer
 function data(f,now){if(!isObj(f)||f.error)return {sources:[{name:'Scheduled jobs',gives:'Not reporting',asOf:'',state:'never'}],method:[],setup:[]};
  const all=flatten(f),act=all.filter(isActive),pseudo=retiredOf(f).length,hist=all.length-act.length+pseudo,ret=all.filter(j=>j.lifecycle==='retired').length+pseudo;
  const unk=all.filter(j=>j.result==='running'&&j.started==null).length;
  const sources=groups(f).map(g=>{const lab=str(g.label,40)||str(g.id,40)||'Scheduler',jn=arr(g.jobs).length,n=num(g.n),k=isObj(g.last_known)?g.last_known:null;
   if(g.ok===false)return {name:lab,gives:'Could not be read'+(k&&num(k.n)!=null?'. Last seen '+k.n+' jobs, '+agoT(k.t,now):'. No earlier reading'),asOf:'',state:'blocked'};
   return {name:lab,gives:(n!=null&&n>jn?jn+' of '+n+' jobs shown':jn+(jn===1?' job':' jobs')),asOf:toEpoch(f.t)==null?'':ago(f.t,now),state:f.stale?'stale':'ok'}});
  const method=[['Active','Turned on, running, failing or waiting on you'],['Failing','The last run failed, or a batch member failed'],['Overdue','A run or a batch member did not start on time'],
   ['Hermes','Hermes jobs come right after what needs a look; their sheet has Run now, Pause and Resume, each on a second tap'],
   ['History',hist+' paused, finished or retired, never counted as active'+(ret?'; '+ret+' retired by consolidation':'')]];
  if(unk)method.push(['No start time',unk+(unk===1?' running job has':' running jobs have')+' no start time, so no age is shown']);
  groups(f).forEach(g=>arr(g.notes).forEach(x=>method.push([str(g.label,40)||'Note',str(x,120)])));
  const setup=groups(f).filter(g=>g.ok===false).map(g=>({name:str(g.label,40)||str(g.id,40),line:'Unknown, not zero. '+(redact(str(g.error,120))||'The source failed'),state:'blocked'}));
  return {sources,method,setup}}
 // detail sheet: plain words first. Hermes jobs add their last output once it is read.
 function isHermes(j){return !!j&&j.kind==='hermes'}
 function lastWords(j,now){if(j.result==='running')return 'Running now \u00B7 '+(j.started==null?'start time unknown':'started '+ago(j.started,now)+' \u00B7 '+clock(j.started));
  // paused is a schedule state, not an outcome: a paused row shows its last actual run time (and outcome when the feed knows it) or unknown
  if(j.result==='paused'){const o=(j.detail.match(/last (\w+)/)||[])[1];
   return 'Last run: '+(j.last==null?'time unknown':ago(j.last,now)+' \u00B7 '+clock(j.last))+(o&&o!=='unknown'?' \u00B7 outcome '+o:'')}
  if(j.last==null)return 'Last run: '+(j.result==='never'?'never ran':'time unknown'+(j.result==='unknown'?', completion not recorded':'')+(j.triggered!=null?' \u00B7 timer last fired '+ago(j.triggered,now):''));
  return 'Last run: '+(j.result==='waiting'?'Failed, waits on you':LABEL[j.result])+' \u00B7 '+ago(j.last,now)+' \u00B7 '+clock(j.last)}
 function nextWords(j,now){if(j.result==='paused'||!j.enabled)return 'Next run: none, paused';
  if(j.result==='running')return 'Next run: running now';
  if(j.next==null)return 'Next run: not scheduled';
  return 'Next run: '+(j.approx?'about ':'')+until(j.next,now)+' \u00B7 '+clock(j.next)}
 // out: undefined while the output is read, null when none is asked for, else {lines,t} | {none} | {fail} | {note}
 function outputPart(j,out,now){
  if(!isHermes(j))return ['Last output: only Hermes jobs keep output here.'];
  if(out===undefined)return ['Last output: reading\u2026'];
  if(!out)return ['Last output: not read.'];
  if(out.fail)return ['Last output: could not be read. Close and open the job to try again.'];
  if(out.note)return ['Last output: '+out.note];
  if(out.none||!arr(out.lines).length)return ['Last output: none yet. The job has not written a run.'];
  return ['Last output, '+(num(out.t)==null?'time unknown':ago(out.t,now))+':'].concat(arr(out.lines).map(String))}
 const memAttn=m=>m.status==='failed'||m.status==='unknown'||m.overdue;
 function memberLines(j,now){if(!j.members.length)return [];
  const out=['Batch members ('+j.members.length+'):'],ms=j.members.slice().sort((a,b)=>(memAttn(b)?1:0)-(memAttn(a)?1:0));
  ms.slice(0,14).forEach(m=>out.push(m.name+': '+m.status+(m.overdue?' \u00B7 overdue'+(m.due!=null?', due '+ago(m.due,now):''):'')+(m.deferred!=null?' \u00B7 deferred since '+ago(m.deferred,now):'')+(m.overrun?' \u00B7 still running past its wait':'')+(m.exit!=null&&m.exit!==0?' \u00B7 exit '+m.exit:'')+(m.finished!=null?' \u00B7 ended '+ago(m.finished,now):m.started!=null?' \u00B7 started '+ago(m.started,now):'')));
  if(ms.length>14)out.push('+ '+(ms.length-14)+' more members');return out}
 // hit = {j,paused} from the Hermes job list (DeckUI.findCron) when this row is exactly one Hermes job: the sheet then carries Run now, Pause or
 // Resume (each arms on the first tap and runs on the second) and Ask Hermes, through the same deck.js cron sheet path the old Crons tab used
 function sheet(j,now,out,hit){
  const sw=j.schedule?schedule(j.schedule):'unknown';
  const spec={kind:'card',title:j.name,sub:hit?'Hermes job':'Scheduled job \u00B7 read only',
   lines:['Schedule: '+sw,lastWords(j,now),nextWords(j,now)].concat(j.wait?['Waits on you: '+(j.wait.reason||'owner action')+(j.wait.action?'. To clear: '+j.wait.action:'')+(j.wait.until?' (marked until '+j.wait.until+')':'')]:[],
    ['Host: '+j.host],memberLines(j,now),outputPart(j,out,now)),
   log:['Host '+j.host,'Kind '+j.kind,'Group '+(j.glabel||'unknown'),'Enabled '+(j.enabled?'yes':'no'),'Schedule text '+(j.schedule||'unknown')].concat(j.detail?['Detail '+redact(j.detail)]:[]),
   logTitle:'Details',actions:[{id:'data',label:'Data'}]};
  // a Hermes job names the model it runs on: pinned, or "Uses the fleet default model" when it pins none (L28), after its host line
  if(hit&&isObj(hit.j)){const id8=DeckUI.cronId(hit.j),hi=spec.lines.indexOf('Host: '+j.host);spec.lines.splice(hi+1,0,'Model: '+DeckUI.cronModel(hit.j));
   if(id8)Object.assign(spec,{kind:'cron',id:id8,actions:DeckUI.cronActions(hit.paused,true).concat([{id:'data',label:'Data'}]),draft:DeckUI.cronDraft(hit.j,hit.paused,now)})}
  return spec}
 // GET /api/crons: the 8-char ids of Hermes jobs with exactly this name (active or paused)
 function cronIds(list,name){const L=isObj(list)?arr(list.active).concat(arr(list.paused)).filter(isObj):[];
  return L.filter(x=>str(x.name,80)===str(name,80)).map(x=>str(x.id,8)).filter(id=>/^[0-9a-f]{8}$/.test(id))}
 // Hermes writes its run output as markdown; the sheet shows plain words: headings, bold, code marks and list bullets go
 const plain=s=>String(s).replace(/^\s{0,3}#{1,6}\s+/,'').replace(/^\s*[-*+]\s+/,'').replace(/\*\*([^*]+)\*\*|__([^_]+)__/g,'$1$2').replace(/`([^`]*)`/g,'$1').replace(/(^|\s)[*_]([^*_\s][^*_]*)[*_](?=\s|[.,;:!?]|$)/g,'$1$2').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').trim();
 // GET /api/crons/<id8> reply -> output state for the sheet; lines are redacted and turned into plain words
 function outputView(reply,ok){if(!ok||!isObj(reply)||reply.error)return {fail:true};
  const lo=isObj(reply.last_output)?reply.last_output:null;if(!lo)return {none:true};
  const lines=arr(lo.lines).map(x=>plain(redact(str(x,200)))).filter(x=>x&&!/^[-*_=]{3,}$/.test(x)).slice(0,3);
  return lines.length?{lines,t:num(lo.t)}:{none:true}}
 return {PAGE,FILTERS,LABEL,RESULTS,TIMEOUT_MS,filterOf,norm,flatten,retiredOf,sorted,matches,pick,listOf,counts,rowParts,row,chips,bar,need,section,hermesLine,page,fresh,data,bounded,load,plain,
  rank,isBad,isFailing,isOverdue,isWait,isActive,isHermes,lastWords,nextWords,outputPart,sheet,cronIds,outputView}
})();
// ==== SCHEDULES UI HELPERS END ====
// ---- page glue (DOM + fetch) ----
(()=>{
 if(typeof document==='undefined')return;
 const SC={f:null,c:undefined,ctx:null,filter:'active',q:'',n:SchedUI.PAGE};
 const SEARCH='<label class="search"><svg class="i" aria-hidden="true"><use href="#i-search"/></svg><input id="scq" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Search" aria-label="Search scheduled jobs"></label>';
 const el=()=>SC.ctx&&SC.ctx.el;
 function setFresh(){if(SC.ctx)DeckPages.mark(SC.ctx,SchedUI.fresh(SC.f,Date.now()))}
 // the frame (search, chips slot, section) is built once so typing never loses the field; chips and the section repaint
 function frame(){const e=el();if(!e||e.querySelector('#hcrons'))return;
  e.innerHTML='<div class="hops" id="hcrons"><div class="hops-bar tv-hide">'+SEARCH+'<div id="scfw"></div></div><section class="sect board" id="scsec"></section></div>';
  e.querySelector('#scq').value=SC.q}
 function paint(){const e=el();if(!e)return;frame();
  try{const v=SchedUI.page(SC.f,Date.now(),SC);e.querySelector('#hcrons').classList.toggle('broken',v.broken);e.querySelector('#scfw').innerHTML=v.bar;e.querySelector('#scsec').innerHTML=v.sect}
  catch(err){e.querySelector('#scsec').innerHTML=renderFail('Crons')}
  setFresh();if(typeof DeckShell!=='undefined'&&DeckShell.tv)DeckShell.tv.refresh()}
 // both lists at once, each bounded at 60 s: the scheduler list draws the page, the Hermes job list gives a Hermes row its actions
 // (deck.js keeps it in V6.crons for cronAct). A read that fails or times out paints "Crons are not reporting" with Try again.
 const get=p=>DeckPages.get(p,{timeout:SchedUI.TIMEOUT_MS}).then(r=>r.ok?r.data:{error:r.error||'no answer'});
 let busy=false;
 async function load(){if(busy)return;busy=true;try{const r=await SchedUI.load(get);SC.f=r.f;SC.c=r.c;if(r.c&&!r.c.error)V6.crons=r.c;paint()}finally{busy=false}}
 window.cronsRepaint=()=>{if(SC.ctx)load()};
 const setFilter=v=>{SC.filter=SchedUI.filterOf(v);SC.n=SchedUI.PAGE;localStorage.setItem('sched-view',SC.filter);buzz('selection');paint()};
 let qT=0;
 document.addEventListener('input',e=>{if(!e.target||e.target.id!=='scq')return;clearTimeout(qT);qT=setTimeout(()=>{SC.q=e.target.value;SC.n=SchedUI.PAGE;paint()},120)});
 document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target:null;if(!t||!t.closest('#hcrons'))return;
  const c=t.closest('.scf');if(c)return setFilter(c.dataset.f);
  if(t.closest('[data-sched-more]')){SC.n+=SchedUI.PAGE;return paint()}
  const r=t.closest('.scrow[data-sched]');if(r)openDetail(r)});
 document.addEventListener('change',e=>{if(e.target&&e.target.id==='scsel')setFilter(e.target.value)});
 async function readJson(url){return jget(url).then(j=>({ok:true,j}),()=>({ok:false,j:null}))}
 // a Hermes job's output: its name on the Hermes list picks the 8-char id, then GET /api/crons/<id8> returns its last run
 async function lastOutput(ids){if(ids.length===0)return {note:'this job is not on the Hermes job list, so it has no saved output here.'};
  if(ids.length>1)return {note:'more than one Hermes job has this name.'};
  const r=await readJson('/api/crons/'+ids[0]);return SchedUI.outputView(r.j,r.ok)}
 async function openDetail(r){
  const j=SchedUI.listOf(SC.f,SC.filter,SC.q)[+r.dataset.sched];if(!j)return;
  const ids=SchedUI.isHermes(j)?SchedUI.cronIds(V6.crons,j.name):[],hit=ids.length===1?DeckUI.findCron(V6.crons,ids[0]):null;
  const spec=SchedUI.sheet(j,Date.now(),undefined,hit);openSheet(spec,r);
  if(!SchedUI.isHermes(j))return;
  const tok=SHEET.tok;let out;
  try{out=await lastOutput(ids)}catch(err){out={fail:true}}
  if(tok!==SHEET.tok||SHEET.spec!==spec)return;
  Object.assign(spec,SchedUI.sheet(j,Date.now(),out,hit));paintSheet()}
 DeckPages.register('home/crons',{every:30000,
  show(ctx){const p=ctx.params||{};SC.ctx=ctx;SC.filter=SchedUI.filterOf(p.f,localStorage.getItem('sched-view'));if(p.f)localStorage.setItem('sched-view',SC.filter);SC.n=SchedUI.PAGE;
   if(SC.f)paint();load()},
  refresh(ctx){SC.ctx=ctx;load()},
  hide(){clearTimeout(qT);SC.ctx=null},
  data(){return SchedUI.data(SC.f,Date.now())}});
})();
