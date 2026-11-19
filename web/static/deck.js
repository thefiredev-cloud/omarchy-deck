// Pixel Deck pages built from feeds: Cluster, Launch, Dev, Life (v6), Keys connections, Home products, Today (design v3).
// Loaded after app.js and uses its globals ($, $$, jget, esc, pname).
// ==== DECK V6 UI HELPERS BEGIN (pure: no DOM, no fetch, no globals; tests/deck_v6_ui.test.js loads this block) ====
const DeckUI=(()=>{
 // the leaf helpers and the formats live in static/ui-core.js (DeckCore, loaded before app.js); the names stay, so no call site changes
 const {esc,isObj,arr,num,str,fmt,toEpoch,lapse,ago,whole,dur,until,clock,usd,compass,safeUrl}=DeckCore;
 const SD=k=>'<i class="sd '+k+'"></i>';
 // ---- copy: no file names, endpoints, ports, raw ids or HTTP codes on screen. Anything technical rides in a hidden .diag span that the
 // detail sheet shows under "Details". Home folders read "~" and account flags are masked there too. ----
 // ONE home-folder rule for the whole deck (run prose, unit logs, tool arguments, Today diagnostics): /home/<user>, /Users/<user>, /root and $HOME become ~
 // wherever a path starts: at the start of the text, after a space or punctuation (, > | { ( [ = : " ' `), after file://, after a glued flag (-C/home/x) and when
 // JSON escapes the slashes (\/home\/x). Never the middle of a path (/opt/home/x, /mnt/home/x stay).
 const HOME_RE=/(^|[^A-Za-z0-9_.\/\\~-]|(?:^|\s)-[A-Za-z]|file:\/\/)(?:\\?\/home\\?\/[A-Za-z0-9._-]+|\\?\/Users\\?\/[A-Za-z0-9._-]+|\\?\/root(?![A-Za-z0-9_-])|\$(?:HOME(?![A-Za-z0-9_])|\{HOME\}))/g;
 const homeTilde=s=>String(s==null?'':s).replace(HOME_RE,'$1~');
 // ONE credential scanner for every line that can reach the screen. It is the same algorithm as rust/src/actions.rs `redact` and scripts/deck-launch
 // `redact_line`; tests/fixtures/redact-cases.json runs through all three. A credential name (a whole word: key, token, secret, password, session ...,
 // also inside API_SERVER_KEY or accessToken) takes its value (quoted values whole, JSON `"name":"value"`, Authorization and Cookie to the end of the line);
 // known token shapes, `Bearer x`, `Basic x`, `?k=x` and url userinfo go wherever they stand. opts.mark replaces what was cut (default [redacted]);
 // opts.query also cuts url query strings and fragments (tool arguments do; prose keeps its links).
 const SECRET_WORDS=new Set(['key','token','secret','password','passwd','passphrase','auth','authorization','cookie','credential','credentials','apikey','apitoken','authtoken','accesstoken','privatekey','session','sessionid','pdeck']);
 const REST_WORDS=new Set(['authorization','cookie']);
 const isUp=c=>c>='A'&&c<='Z',isLow=c=>c>='a'&&c<='z',isDig=c=>c>='0'&&c<='9',isAlnum=c=>isUp(c)||isLow(c)||isDig(c);
 function nameWords(name){const ch=Array.from(name),words=[];let cur='';
  for(let i=0;i<ch.length;i++){const c=ch[i];
   if(!isAlnum(c)){if(cur){words.push(cur);cur=''}continue}
   if(cur&&i>0){const p=ch[i-1],nextLow=i+1<ch.length&&isLow(ch[i+1]);
    if((isUp(c)&&isLow(p))||(isUp(c)&&isUp(p)&&nextLow)||isDig(c)!==isDig(p)){words.push(cur);cur=''}}
   cur+=c.toLowerCase()}
  if(cur)words.push(cur);return words}
 const secretName=n=>nameWords(n).some(w=>SECRET_WORDS.has(w));
 const restName=n=>nameWords(n).some(w=>REST_WORDS.has(w));
 // known credential shapes, on the lower-cased name-like run: prefix plus a body of at least n characters (al: letters and digits only)
 function secretShape(low){const body=(p,n,al)=>{if(!low.startsWith(p))return false;const r=low.slice(p.length);return r.length>=(n||8)&&(!al||/^[a-z0-9]+$/.test(r))};
  return ['sk-','sk_','pk_','rk_','rk-','ghp_','gho_','ghs_','ghu_','github_pat_','xoxb-','xoxa-','xoxp-','xoxr-','xoxs-','akia'].some(p=>body(p))||body('glpat-',16)||body('hf_',16,1)||body('npm_',16,1)||body('aiza',16)||(low.startsWith('eyj')&&low.length>=20)}
 const nameByte=c=>isAlnum(c)||c==='_'||c==='-'||c==='.';
 const valueEnd=c=>' ,;&)}]"\''.includes(c);
 // `Basic dXNlcjpwYXNz`: base64 of at least 8 characters that is not an ordinary word (a digit, = + / or a capital after the first letter)
 const b64Cred=c=>c.length>=8&&/^[A-Za-z0-9+\/=]+$/.test(c)&&(/[0-9+\/=]/.test(c)||/[A-Z]/.test(c.slice(1)));
 function redactLine(line,mark){const L=line.length;let out='',i=0;
  while(i<L){const ch=line[i];
   if(!nameByte(ch)){out+=ch;i++;continue}
   const start=i;while(i<L&&nameByte(line[i]))i++;
   const run=line.slice(start,i),low=run.toLowerCase();
   if(low==='bearer'){out+=run;let j=i;while(j<L&&line[j]===' ')j++;
    if(j>i&&j<L){let k=j;while(k<L&&line[k]!==' ')k++;out+=line.slice(i,j);const w=line.slice(j,k);
     // a name after a stray `Bearer` (`password:`, `KEY=`) is scanned as a name, not eaten as the token
     if(w.endsWith(':')||w.endsWith('='))i=j;else{out+=mark;i=k}}
    continue}
   if(low==='basic'){out+=run;let j=i;while(j<L&&line[j]===' ')j++;
    if(j>i){let k=j;while(k<L&&/[A-Za-z0-9+\/=]/.test(line[k]))k++;
     if(b64Cred(line.slice(j,k))&&(k>=L||valueEnd(line[k]))){out+=line.slice(i,j)+mark;i=k}}
    continue}
   if(secretShape(low)){out+=mark;continue}
   // NAME, an optional closing quote, optional spaces, then `=` or `:` (but not the `://` of a url)
   let k=i;if(k<L&&(line[k]==='"'||line[k]==="'"))k++;
   while(k<L&&line[k]===' ')k++;
   const sep=k<L&&(line[k]==='='||line[k]===':')&&!(line[k]===':'&&line[k+1]==='/');
   const camKey=low==='k'&&start>0&&(line[start-1]==='?'||line[start-1]==='&');
   if(!(sep&&(secretName(run)||camKey))){out+=run;continue}
   let v=k+1;while(v<L&&line[v]===' ')v++;
   out+=line.slice(start,k+1);if(v>k+1)out+=' ';out+=mark;
   let end;
   if(line.startsWith(mark,v))end=v+mark.length; // already cut (a second pass over a server-scrubbed line)
   else if(restName(run))end=L;
   else if(v<L&&(line[v]==='"'||line[v]==="'")){const q=line[v];let e=v+1;while(e<L&&line[e]!==q)e+=line[e]==='\\'?2:1;end=Math.min(e+1,L)}
   else{let e=v;while(e<L&&!valueEnd(line[e]))e++;
    // `Bearer x`, `Basic x`: the scheme word is not the secret, the word after it is
    if(['bearer','basic','digest'].includes(line.slice(v,e).toLowerCase())){let e2=e;while(e2<L&&line[e2]===' ')e2++;while(e2<L&&!valueEnd(line[e2]))e2++;end=e2}else end=e}
   i=end}
  return out}
 function scanSecrets(s,opts){const mark=opts&&opts.mark||'[redacted]';
  let t=String(s==null?'':s).replace(/[^\S ]/g,' ').replace(/([A-Za-z][A-Za-z0-9+.\-]*:\/\/)[^\s\/?#]*@/g,'$1'+mark+'@');
  if(opts&&opts.query)t=t.replace(/([A-Za-z][A-Za-z0-9+.\-]*:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g,'$1');
  return redactLine(t,mark)}
 const ACCT_RE=/(--account[= ]+|--user[= ]+|\baccount[=:] ?|\buser_id["']? ?[:=] ?)(["']?)[^\s"'}),;]+/gi;
 const redact=s=>homeTilde(scanSecrets(s)).replace(ACCT_RE,'$1$2\u2026');
 const diagHtml=ds=>arr(typeof ds==='string'?[ds]:ds).map(d=>str(typeof d==='string'?d:'',200)).filter(Boolean).map(d=>'<span class="diag">'+esc(redact(d))+'</span>').join('');
 const sentence=s=>{const t=String(s==null?'':s).replace(/[_-]+/g,' ').trim();return t?t.charAt(0).toUpperCase()+t.slice(1).toLowerCase():''};
 // "daily_digest.json" or "accounts.json" read as a name: "Daily digest", "Accounts"
 const friendly=s=>{const t=String(s==null?'':s).replace(/\.(json|db|tsv|md)$/i,'').replace(/[_-]+/g,' ').trim();return t?t.charAt(0).toUpperCase()+t.slice(1):''};
 const kilo=v=>{const n=num(v);return n==null?'--':n>=10000?Math.round(n/1000)+'K':n>=1000?(n/1000).toFixed(1).replace(/\.0$/,'')+'K':String(Math.round(n))};
 // repos read "name", not "org/name"; two repos that share a name keep their org. Long names are cut in the middle so the end stays readable.
 const midCut=(s,n)=>{s=String(s==null?'':s);return s.length<=n?s:s.slice(0,Math.ceil((n-1)*.6))+'\u2026'+s.slice(s.length-Math.floor((n-1)*.4))};
 function repoLabels(repos){const full=r=>str(r,80),short=r=>full(r).split('/').pop(),seen={},out={};
  for(const r of repos){const s=short(r);(seen[s]=seen[s]||new Set()).add(full(r))}
  for(const r of repos){const f=full(r),s=short(r);out[f]=midCut(seen[s]&&seen[s].size>1?f:s,28)}return out}
 const uniq=(xs,key)=>{const seen=new Set();return arr(xs).filter(x=>{const k=key(x);if(seen.has(k))return false;seen.add(k);return true})};
 // one sentence for a failed action; never "http 502" or a raw server word
 function humanErr(j,status){const e=isObj(j)?str(j.error,120).toLowerCase():'',s=num(status),m=/already (\w+)/.exec(e);
  if(isObj(j)&&num(j.retry_s)!=null)return 'Too many tries. Wait '+Math.ceil(j.retry_s)+' s, then try again.';
  if(s===429||/rate|too many/.test(e))return 'Too many tries. Wait a moment, then try again.';
  if(e==='gate blocked')return 'Jev did not approve this run. Nothing was started.';
  if(e==='gate unsure')return 'Jev was not sure about this run. Nothing was started.';
  if(e==='gate unavailable')return 'Jev and Clef did not answer. Nothing was started.';
  if(e==='route invalid')return 'The run model setting is not valid. Nothing was started.';
  if(m)return 'It is already '+m[1]+'.';
  if(s===401||s===403||/auth|forbid|token|csrf|sign/.test(e))return 'You are signed out. Reload the deck to sign in again.';
  if(s===404||/unknown|not found|no run/.test(e))return 'That item is gone. Refresh the page and try again.';
  if(s===502||s===503||s===504||/unreach|gateway|did not answer/.test(e))return 'Hermes did not answer. Check that it is running, then try again.';
  if(!isObj(j)&&!s)return 'No answer from the deck. Check your connection, then try again.';
  if(s>=500)return 'The deck had a problem. Try again in a moment.';
  return 'That did not go through. Try again.'}
 // what a feed that did not report says to a person, plus the raw cause for the detail sheet
 function problem(f){const raw=isObj(f)?str(f.error,120):'',src=isObj(f)?str(f.src,120):'';
  const line=!isObj(f)?'The deck did not answer. Check your connection, then try again.':/missing|not found|no such file|not written/i.test(raw)?'Nothing has been collected yet. It fills in after the next refresh.':
   /time(?:d)?[ _-]?out|too long/i.test(raw)?'The source took too long to answer. Try again in a moment.':'The source is not reporting. Try again in a moment.';
  return {line,diag:[raw||(isObj(f)?'':'no answer from the deck server'),src].filter(Boolean)}}
// the one empty-state component: icon, title, one line, optional 44 px Retry, optional action markup. k: idle (nothing to show), stale, bad, setup (needs a key), building. Static; never a spinner.
// The stale and failed icons are the deck's own mark shapes (DESIGN 6: warn triangle, bad crossed square, never a ring), drawn as outlines.
 const ES_ICON={idle:'<svg class="es-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13l2.6-7h10.8L20 13v5H4z"/><path d="M4 13h4.6l1 2h4.8l1-2H20"/></svg>',
  stale:'<svg class="es-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.8 21.2 19.8H2.8z"/><path d="M12 10v4.4M12 17.2v.1"/></svg>',
  bad:'<svg class="es-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8"/></svg>',
  setup:'<svg class="es-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/></svg>',
  building:'<svg class="es-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16M6 20V10h12v10M9 10V6h6v4"/></svg>'};
 function empty(o){o=isObj(o)?o:{};const k=Object.prototype.hasOwnProperty.call(ES_ICON,o.k)?o.k:'idle',key=/^[a-z0-9/-]{1,40}$/.test(o.retry||'')?o.retry:'';
  return '<div class="es es-'+k+'" role="status">'+ES_ICON[k]+'<b class="es-t">'+esc(str(o.title,80)||'Nothing here yet')+'</b>'+(o.line?'<span class="es-l">'+esc(str(o.line,160))+'</span>':'')+
   (key?'<button type="button" class="b es-retry" data-retry="'+key+'">Try again</button>':'')+(typeof o.action==='string'?o.action:'')+diagHtml(o.diag)+'</div>'}
 // "0 8,20 * * *" -> "Daily at 8 AM and 8 PM". Unusual expressions say so; the raw text stays in the detail sheet.
 const hour12=(h,m)=>{const n=+h;return ((n%12)||12)+(+m?':'+String(m).padStart(2,'0'):'')+' '+(n<12||n===24?'AM':'PM')};
 const DOWN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 function schedule(raw){const s=str(raw,60);if(!s)return 'Schedule unknown';
  let m=/^every (\d+) ?(m|h|d)/i.exec(s);
  if(m){const n=+m[1],u=m[2].toLowerCase();return n===1?(u==='m'?'Every minute':u==='h'?'Every hour':'Every day'):'Every '+n+(u==='m'?' min':u==='h'?' h':' days')}
  m=/^(\S+) (\S+) \* \* (\S+)$/.exec(s);if(!m)return 'Custom schedule';
  const mi=m[1],hr=m[2],dw=m[3];let st=null,r2;
  if(/^\*\/\d+$/.test(mi)&&hr==='*'&&dw==='*')return 'Every '+mi.slice(2)+' min';
  if(/^\d+$/.test(mi)&&hr==='*'&&dw==='*')return 'Hourly at :'+mi.padStart(2,'0');
  if(/^\d+$/.test(mi)&&/^\d+(,\d+)*$/.test(hr))st='at '+hr.split(',').map(h=>hour12(h,mi)).join(' and ');
  else if(/^\d+$/.test(mi)&&(r2=/^(\d+)-(\d+)\/(\d+)$/.exec(hr)))st='every '+r2[3]+' h, '+hour12(r2[1],mi)+' to '+hour12(r2[2],mi);
  if(st==null)return 'Custom schedule';
  let day;
  if(dw==='*')day='Daily';else if(dw==='1-5')day='Weekdays';else if(/^[0-7](,[0-7])*$/.test(dw))day=dw.split(',').map(d=>DOWN[+d%7]).join(', ');
  else return 'Custom schedule';
  return day+' '+st}
 // state of a whole feed: bad (no data), stale (old), ok
 function state(f){if(!isObj(f)||f.error)return 'bad';return f.stale?'stale':'ok'}
 // one short status line: "Updated 2 min ago", "Out of date \u00B7 Updated 3 h ago", or what is wrong when the feed did not report.
 // line({series, …}) alone is the v3 line chart (UiApi 3.7).
 function line(f,now){if(arguments.length===1&&isObj(f)&&Array.isArray(f.series))return V3.line(f);if(!isObj(f)||f.error)return problem(f).line;
  return (f.stale?'Out of date \u00B7 ':'')+(toEpoch(f.t)==null?'Update time unknown':'Updated '+ago(f.t,now))}
 const tile=(h,v,t,k,extra,dg)=>'<div class="tile'+(k=='bad'?' bad':k=='stale'||k=='warn'?' stale':'')+(extra?' '+extra:'')+'"><div class="h">'+(k?SD(k=='stale'?'warn':k):'')+esc(h)+'</div><div class="v">'+esc(v)+'</div>'+(t!=null?'<div class="t">'+esc(t)+'</div>':'')+diagHtml(dg)+'</div>';
 const head=(title,f,now)=>'<div class="secttl"><span>'+esc(title)+'</span><span>'+esc(isObj(f)&&!f.error?line(f,now):'Not reporting')+'</span></div>';
 const down=(title,f,retry)=>{const p=problem(f),t=str(title,60).replace(/ feed$/i,'');return empty({k:'bad',title:t+(/[^s]s$/i.test(t)?' are':' is')+' not reporting',line:p.line,retry,diag:p.diag})};
// failed parts of a feed collapse into ONE line per panel: the count, then the first three names in plain words; the reasons are in the detail sheet.
// A source id is drawn only when it already reads as a name ("ebay", "spark engine"). Ids with a colon, dot or slash ("fred:RSXFS", "sites.field-desk") and
// internal words (sqlite, json, api, gateway ...) stay in the hidden details: the deck draws no plumbing.
const PLUMB=/sqlite|json|\bdb\b|sql|\bapi\b|http|fred|wikipedia|pageview|shoptrends|gateway|rclone|\bmcp\b|\btsv\b|cache/i;
const errNames=es=>{const nm=[];es.forEach(e=>{const raw=redact(str(e.source,40));if(!/^[A-Za-z][A-Za-z0-9 _-]{1,28}$/.test(raw)||PLUMB.test(raw))return;const n=friendly(raw);if(n&&!nm.includes(n))nm.push(n)});
 return nm.length?nm.slice(0,3).join(', ')+(nm.length>3?' and '+(nm.length-3)+' more':''):''};
const errRows=f=>{const es=arr(isObj(f)&&f.errors).filter(isObj);if(!es.length)return '';const names=errNames(es);
  return '<div class="frow err"><span>'+(es.length===1?'One source is not reporting.':es.length+' sources are not reporting.')+'</span>'+(names?'<span class="errn">'+esc(names)+'</span>':'')+
   diagHtml(es.slice(0,8).map(e=>(str(e.source,40)||'source')+': '+(str(e.reason,120)||'no reason given')))+'</div>'};
 // every link shows a small trailing arrow so the owner can tell a link from a plain row (aria-hidden, the anchor keeps its own text)
 const LK='<span class="lk" aria-hidden="true">\u2197</span>';
 // attrs (already escaped, built by dattr) go before class so the class attribute stays directly before the first child
 const dattr=(n,v)=>' data-'+n+'="'+esc(v)+'"';
const row=(main,sub,right,k,url,attrs,dg,more)=>{const u=safeUrl(url),tag=u?'a':'div';
  return '<'+tag+(attrs||'')+' class="frow'+(k?' '+k:'')+'"'+(u?' href="'+esc(u)+'" target="_blank" rel="noopener noreferrer"':'')+'>'+'<span class="fl"><b>'+esc(main)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+(more||'')+'</span>'+(right!=null&&right!==''?'<span class="fr">'+right+'</span>':'')+(u?LK:'')+diagHtml(dg)+'</'+tag+'>'};
 const yes=(v,a,b,u)=>v===true?a:v===false?b:(u||'unknown');

// A bench is shown only for the model that produced it. The collector sets bench.stale (and ratchet.stale)
// when that model is not the served one: the card then names the served model and the last bench, no numbers.
// a feed date ("2026-11-12") in the deck's own format ("Nov 12"); empty when it does not read as a date
const cday=v=>{const s=str(v,30);return s&&fmt.date(s)||''};
const staleBench=(b,e)=>'No current benchmark for '+(str(e.served_name,60)||'the served model')+'; last bench was '+(str(b.model,60)||'an unknown model')+' on '+(cday(b.measured_at)||'an unknown date');
 // ---- cluster (design v3: one strip of engine tiles; titles carry no age, only "Out of date" when the feed is old) ----
 // stile: a strip cell; w=true for a word value (a model name), which wraps in the body face instead of the mono figure
 const stile=(h,v,t,k,dg,w)=>'<div class="tile'+(k=='bad'?' bad':k=='stale'?' stale':'')+'"><div class="h">'+(k?SD(k=='stale'?'warn':k):'')+esc(h)+'</div><div class="v'+(w?' w':'')+'">'+esc(v)+'</div>'+(t?'<div class="t">'+esc(t)+'</div>':'')+diagHtml(dg)+'</div>';
 // m: the fleet board's per-device model list (GET /api/fleet-board .models) for Models by machine, or {error} when that read failed; absent
 // (undefined), the section is left out. old: when those rows were last read, when they are kept from an earlier answer (DeckPages.get's last
 // good). inv: the model inventory (GET /api/models), the same way, for installed against resident and each model's GPU share. The section
 // stands on its own feeds, so it shows even when the cluster feed is down.
 function cluster(f,now,m,old,inv){const mods=ff=>m===undefined?'':clusterModels(m,ff,now,old,inv);
  if(state(f)=='bad')return [bhead('Engine',f,now)+down('Cluster',f,'cluster'),mods(null),''];
  const k=state(f),e=isObj(f.engine)?f.engine:{},p=isObj(f.proxy)?f.proxy:{},b=isObj(f.bench)?f.bench:{},r=isObj(f.ratchet)?f.ratchet:{};
  const est=str(e.status,12)||'unknown',ek=est=='up'?(k=='stale'?'stale':'ok'):est=='loading'?'stale':est=='down'?'bad':'off';
  const model=stile('Model',str(e.served_name,60)||'Model not reported',({up:'Running',loading:'Loading',down:'Down'}[est]||'Not reported')+(e.up_since==null?'':' \u00B7 up '+dur(e.up_since,now)),ek,
   [str(e.container,32)&&'Container '+str(e.container,32),num(e.port)!=null&&'Port '+e.port,str(e.lock_model,60)&&'Locked to '+str(e.lock_model,60)].filter(Boolean),true);
  const context=stile('Context',num(e.max_model_len)==null?'Not reported':kilo(e.max_model_len)+' tokens',e.up_since==null?'Start time not reported':'',num(e.max_model_len)==null?'stale':'');
  const models=arr(p.models).map(m=>str(m,40)).filter(Boolean),ps=okState(p.pc_desktop_8080_up);
  const proxy=stile('Proxy',opsWord(ps),models.length?models.join(', '):'No models listed',ps==='up'?(k=='stale'?'stale':'ok'):ps==='down'?'bad':'off',['Port 8080 on pc-desktop']);
  // the strip keeps one speed (writing); the four benchmarks are the figure list under it, the same words as Fleet's (V13)
  const bf=b.stale===true?[]:benchFigs(b),when=b.at==null?'':cday(b.at)||whole(ago(b.at,now));
  const speed=b.stale===true?stile('Speed','Not current',staleBench(b,e),'stale','',true):b.prose_tps==null&&b.code_tps==null?stile('Speed','Not measured','The next benchmark run fills this in.','stale','',true):
   stile('Speed',fmt(b.prose_tps,1)+' tok/s','Writing'+(when?' \u00B7 measured\u00A0'+when:''),k,[str(b.source,40)]);
  const strip='<div class="strip" data-n="4" data-nb="4">'+model+speed+context+proxy+'</div>';
  // the tuning card says the outcome in words; the step, with its candidate id, rides in the sheet (W10, G11)
  const step=str(r.last_step,200).replace(/_/g,' ');
  const ratchet=r.stale===true?tile('GLM history',outWord(r.last_outcome)||'No result','Last GLM run '+(cday(r.last_date)||'date not reported')+'. Not the served model.','stale','wrap',[step&&'Step: '+step]):
   tile('Tuning',outWord(r.last_outcome)||'No result yet','Last run '+(cday(r.last_date)||'date not reported')+' \u00B7 next '+(r.next_run==null?'not scheduled':until(r.next_run,now)),k,'wrap',[step&&'Step: '+step]);
  const col1=bhead('Engine',f,now)+strip+(bf.length?benchList(bf,'Benchmark',when,[str(b.source,60)]):'')+ratchet;
  // a node: the bar is memory and says so ("Memory 95%"), in GB as Fleet reads it (V12); GPU, temperature and power on the line under it
  const nodes=arr(f.nodes).map(n=>{const s=okState(n&&n.reachable),ok=s==='up',used=num(n&&n.mem_used_gb),tot=num(n&&n.mem_total_gb),pct=used!=null&&tot?pctOf(used/tot*100):null,hot=num(n&&n.gpu_temp_c)!=null&&n.gpu_temp_c>=85;
   const nk=s==='down'?'bad':s==='unknown'?'off':(k=='stale'||hot)?'stale':'ok',cs=arr(n&&n.containers).map(c=>str(c,32)).filter(Boolean);
   return '<div class="tile node'+(nk=='bad'?' bad':nk=='stale'?' stale':'')+'"><div class="h">'+SD(nk=='stale'?'warn':nk)+esc(str(n&&n.name,20)||'Node')+'</div>'+
    '<div class="v">'+(!ok?opsWord(s):pct==null?'Memory: no reading':'Memory '+Math.round(pct)+'%')+'</div>'+
    (ok&&pct!=null?'<div class="bar'+(pct>=99?' hot':'')+'"><i style="width:'+pct+'%"></i></div>':'')+
    // a figure keeps its unit on its line ("12 W", never "12" / "W")
    '<div class="t">'+(ok?esc([used!=null&&tot?fmt(used)+' of '+fmt(tot)+'\u00A0GB':'','GPU\u00A0'+fmt(n.gpu_util_pct,0,'%')+'\u00A0busy',fmt(n.gpu_temp_c,0,'\u00B0C'),fmt(n.power_w,0,'\u00A0W')].filter(Boolean).join(' \u00B7 ')):'Check that the machine is on and on the network.')+'</div>'+
    (ok?'<div class="t">'+esc('Up '+(num(n&&n.uptime_s)==null?'time not reported':Math.round(n.uptime_s/86400)+' d')+' \u00B7 '+(cs.length?cs.length+(cs.length>1?' services':' service')+' running':'No services listed'))+'</div>':'')+
    diagHtml([str(n&&n.lan_ip,20)&&'Address '+str(n&&n.lan_ip,20),num(n&&n.load1)!=null&&'Load '+fmt(n.load1,1),cs.length&&'Containers: '+cs.join(', ')].filter(Boolean))+'</div>'}).join('');
  const col2=bhead('Nodes',f,now)+(nodes||empty({k:'idle',title:'No machines reported',line:'They appear here after the next check.',retry:'cluster'}))+errRows(f)+mods(f);
  const cands=arr(f.candidates);
  const col3=bhead('Candidates',f,now)+(cands.length?'<div class="flist">'+cands.map(c=>{const s=str(c&&c.status,16);
   return row(str(c&&c.name,60)||'Model',(str(c&&c.format,16)||'Format not reported')+' \u00B7 '+fmt(c&&c.size_gb,1,'\u00A0GB'),'<span class="pill'+(s=='rejected'?' bad':'')+'">'+esc(s?sentence(s):'Not reported')+'</span>','')}).join('')+'</div>':
   empty({k:'idle',title:'No candidate models',line:'Models being considered for the cluster show up here.'}));
  return [col1,col2,col3]}
 // ---- Cluster TV board (lane PgHome, 2026-11-15): is the cluster up and how loaded is it, at ten feet. One strip (engine, each
 // node's memory and temperature, the tuning loop) and the error rows. Missing data reads "No data", never 0. TV only (css/home.css).
 // Error rows never vanish silently: the state rows (Cluster, Engine, Proxy, each node, Tuning loop) always show, in that order; the
 // feeds' own errors[] fill the rest up to CLUSTER_BOARD_ROWS (what fits under the strip at 1536x864, measured); when more remain,
 // the last row says how many: "N more not reporting". A name already listed is not listed twice.
 const CLUSTER_BOARD_ROWS=8;
 // f and pf may be answers kept from an earlier read (keptFeed: kept_at): the board says so on the tile ("Running at last read") and in a
 // warn row, since a feed that stopped answering is exactly when the engine may be down (review #390)
 function clusterBoard(f,pf,now){
  const ok=isObj(f)&&!f.error,e=ok&&isObj(f.engine)?f.engine:{},p=ok&&isObj(f.proxy)?f.proxy:{},est=str(e.status,12);
  const keptOf=x=>isObj(x)&&!x.error&&num(x.kept_at)!=null?'Out of date \u00B7 last read '+(lapse(toEpoch(x.kept_at),now)||'1 min'):'',fk=keptOf(f),pk=keptOf(pf),atLast=(w,k)=>k&&w!=='No data'?w+' at last read':w;
  const tiles=[],errs=[],err=(name,word,mark)=>errs.push({name,word,mark:mark||'bad'});
  tiles.push(V3.tile({label:'Engine',value:!ok?'No data':atLast({up:'Running',loading:'Loading',down:'Down'}[est]||'Unknown',fk),sub:ok?str(e.served_name,40)||'Model unknown':'Not reporting'}));
  if(!ok)err('Cluster','Not reporting');
  else{if(fk)err('Cluster',fk,'warn');if(est==='down')err('Engine','Down');if(p.pc_desktop_8080_up===false)err('Proxy','Down')}
  const nodes=ok?arr(f.nodes).filter(isObj).slice(0,4):[];
  nodes.forEach(n=>{const name=sentence(str(n.name,20))||'Node',used=num(n.mem_used_gb),tot=num(n.mem_total_gb),t=num(n.gpu_temp_c),u=num(n.gpu_util_pct);
   if(n.reachable!==true){tiles.push(V3.tile({label:name,value:n.reachable===false?'Not reachable':'No data'}));if(n.reachable===false)err(name,'Not reachable');return}
   tiles.push(V3.tile({label:name,value:used!=null&&tot?Math.round(used/tot*100)+'%':'No data',unit:used!=null&&tot?'memory':'',
    sub:[used!=null&&tot?Math.round(used)+' of '+Math.round(tot)+' GB':'',t!=null?Math.round(t)+'\u00B0C':'Temperature: no data',u!=null?Math.round(u)+'% busy':''].filter(Boolean).join(' \u00B7 ')}))});
  if(ok&&!nodes.length)tiles.push(V3.tile({label:'Nodes',value:'No data'}));
  const ret=retiredOn(pf),pok=isObj(pf)&&!pf.error,rt=pok&&isObj(pf.runs_today)?pf.runs_today:{};
  tiles.push(V3.tile({label:'Tuning',value:!pok?'No data':atLast(ret?'Retired':pf.stop===true?'Stopped':pf.enabled===true?'Running':pf.enabled===false?'Off':'Unknown',pk),
   sub:!pok?'Not reporting':ret?'Since '+ret:num(rt.total)!=null?rt.total+(rt.total===1?' run today':' runs today'):''}));
  if(!pok)err('Tuning loop','Not reporting');else if(pk)err('Tuning loop',pk,'warn');
  const seen=new Set(errs.map(x=>x.name.toLowerCase())),feed=[];let unnamed=0;
  [f,pf].forEach(x=>arr(isObj(x)&&x.errors).filter(isObj).forEach(y=>{const n=errNames([y]);if(!n){unnamed++;return}const k=n.toLowerCase();if(seen.has(k))return;seen.add(k);feed.push({name:n,word:'Not reporting'})}));
  const room=Math.max(0,CLUSTER_BOARD_ROWS-errs.length),all=feed.length+unnamed;
  const shown=all<=room&&!unnamed?feed:feed.slice(0,Math.max(0,room-1)),rest=all-shown.length;
  const rows=errs.concat(shown).map(r=>row(r.name,'','<span class="pill">'+SD(r.mark||'bad')+esc(r.word)+'</span>',''));
  if(rest>0)rows.push(row(rest+' more not reporting','',''));
  return V3.strip(tiles,{label:'Cluster now'})+(rows.length?'<div class="flist board-fill">'+rows.join('')+'</div>':'')}

 // ---- launch ----
 const KIND_ORDER=['command','skill','mcp','tool','plugin','automation'];
 const KIND_LABEL={command:'Commands',skill:'Skills',mcp:'MCPs',tool:'Tools',plugin:'Plugins',automation:'Automations'};
 // tier/score/where/why come from the LaunchAudit contract; a missing tier is "unrated" and sorts before dead
 const TIERS=['core','useful','niche','dead'];
 const TIER_ORDER=['core','useful','niche','unrated','dead'];
 const TIER_LABEL={core:'Core',useful:'Useful',niche:'Niche',unrated:'Unrated',dead:'Dead'};
 const WHERE_LABEL={omp:'OMP',hermes:'Hermes',quill:'Quill','pc-desktop':'pc-desktop','mac-mini':'Mac mini',dell:'Dell',spark:'Spark',ascent:'Ascent'};
 // label, does, area, ao (the area's place in the owner's list) and earns come from the launch feed; an old feed without them shows raw names, tiers and kinds as before
 function launchItems(f){return arr(isObj(f)&&f.items).filter(x=>isObj(x)&&typeof x.id==='string'&&KIND_ORDER.includes(x.kind)).map(x=>{
  const where=arr(x.where).map(w=>str(w,20).toLowerCase()).filter(w=>w&&w!=='omp').slice(0,8),why=str(x.why,90),label=str(x.label,32),does=str(x.does,90),area=str(x.area,24),ao=num(x.ao),earns=x.earns===true;
  return {id:x.id,kind:x.kind,name:str(x.name,80)||str(x.arg,80)||x.id,label,does,area,ao:area&&ao!=null?Math.max(0,Math.min(98,Math.round(ao))):null,earns,desc:str(x.desc,90),group:str(x.group,40),
  targets:arr(x.targets).filter(t=>t==='hermes'),tier:TIERS.includes(x.tier)?x.tier:'unrated',
  score:num(x.score)==null?null:Math.max(0,Math.min(100,Math.round(x.score))),where,why,
  hay:[label,does,area,x.name,x.desc,x.group,x.arg,x.kind,why,where.join(' ')].map(s=>String(s||'').toLowerCase()).join(' ')}})}
 function launchFavorites(f,items){const by=new Map(items.map(x=>[x.id,x]));
 return arr(isObj(f)&&f.favorites).map(x=>{if(!isObj(x))return null;const id=str(x.id,100),it=by.get(id),label=str(x.label,20);
  return id&&it&&it.targets.includes('hermes')?{id,label:label||it.name,name:it.name,tier:it.tier}:null}).filter(Boolean).slice(0,12)}
 // areas in the feed's own order, with how many items each holds
 function launchAreas(items){const m=new Map();for(const x of items){if(!x.area)continue;const e=m.get(x.area)||{area:x.area,ao:x.ao==null?99:x.ao,n:0,earns:false};e.n++;e.earns=e.earns||x.earns;if(x.ao!=null&&x.ao<e.ao)e.ao=x.ao;m.set(x.area,e)}
  return [...m.values()].sort((a,b)=>a.ao-b.ao||a.area.localeCompare(b.area))}
 // tier counts in tier order, where counts most common first, areas in feed order
 function launchFacets(items){const tier={all:items.length},w={};for(const t of TIER_ORDER)tier[t]=0;
  for(const x of items){tier[x.tier]++;for(const h of x.where)w[h]=(w[h]||0)+1}
  return {tier,area:launchAreas(items),where:Object.keys(w).sort((a,b)=>w[b]-w[a]||a.localeCompare(b)).map(h=>({w:h,n:w[h],label:WHERE_LABEL[h]||h}))}}
 function launchFilter(items,query,kind,limit,opt){const toks=String(query||'').toLowerCase().split(/\s+/).filter(Boolean),o=opt||{},tier=o.tier||'all',where=o.where||'all',area=o.area||'all';
  const hit=items.filter(x=>(!kind||kind==='all'||x.kind===kind)&&(tier==='all'||x.tier===tier)&&(area==='all'||x.area===area)&&(where==='all'||x.where.includes(where))&&toks.every(t=>x.hay.includes(t)));
  const score=x=>{const n=(x.label||x.name).toLowerCase();return toks.length&&toks.every(t=>n.includes(t))?(n.startsWith(toks[0])?0:1):2},ord=x=>x.ao==null?99:x.ao;
  // browsing: area first, then tier. Searching: how well it matches first, so the best hit is on top whatever its area
  const byArea=(a,b)=>ord(a)-ord(b)||(a.area||'').localeCompare(b.area||'');
  const rest=(a,b)=>TIER_ORDER.indexOf(a.tier)-TIER_ORDER.indexOf(b.tier)||score(a)-score(b)||(b.score==null?-1:b.score)-(a.score==null?-1:a.score)||KIND_ORDER.indexOf(a.kind)-KIND_ORDER.indexOf(b.kind)||(a.label||a.name).localeCompare(b.label||b.name);
  hit.sort(toks.length?(a,b)=>score(a)-score(b)||byArea(a,b)||rest(a,b):(a,b)=>byArea(a,b)||rest(a,b));
  const n=limit||120;return {rows:hit.slice(0,n),total:hit.length}}
 function launchResult(r,status){if(!isObj(r))return {k:'bad',text:humanErr(null,status)};
  if(!r.ok)return {k:'bad',text:humanErr(r,status)};
  return {k:'ok',text:(/queue/i.test(str(r.status,20))?'Queued in Hermes':'Started in Hermes')+(str(r.name,40)?' \u00B7 '+str(r.name,40):'')}}

 // ---- dev ----
// D2: a failed Vercel read says so and why; an empty list would read as "no projects". The reason is the collector's own text ("... expired 335200s ago").
function vercelEmpty(d){const e=arr(isObj(d)&&d.errors).filter(isObj).find(x=>/^vercel$/i.test(str(x.source,20)));
 if(!e)return empty({title:'No Vercel projects',line:'Projects show up here once Vercel is connected.'});
 const m=/expired\s+(\d+)\s*s\s+ago/i.exec(str(e.reason,200)),s=m?+m[1]:null,age=s==null?'':s<172800?Math.max(1,Math.round(s/3600))+' h':Math.round(s/86400)+' d';
 return empty({k:'bad',title:'Vercel not reporting',line:s==null?'The Vercel read failed. Projects show again once it works.':'Token expired '+age+' ago. Projects show again once it is refreshed.',diag:[str(e.reason,120)]})}
// ---- Home > Dev (2026-11-14): App builds, Pull requests, Vercel, Supabase, Rank watch and Workspace as whole sections in balanced columns
// (DeckBalance). A phone shows five rows a section, then Show more; T, D and XL show ten (CSS on .c5 and .c10, the glue keeps which sections
// are open), so no section is many screens tall. Source lines, reasons, ages per source and coverage are in the Data sheet (devData); the
// page has one freshness mark (devFresh). On TV the first three sections are the board.
// a commit title is cut at a word in the model (never by CSS), short enough for one line at a desk and two on a phone
const DEV_FIRST=5,DEV_WIDE=10,DEV_TITLE=56;
// the Show more button names the rows it opens: five shown on P and L, ten on T, D and XL (homeops.css picks the words). An open section
// carries data-bal-open (DeckBalance plans it at its closed height, so it opens in place) and Show fewer, as Markets has; homeops.css
// shows Show fewer only where Show more was shown.
const dsect=(key,title,body,o)=>{o=o||{};const more=(o.n||0)-DEV_FIRST,wide=(o.n||0)-DEV_WIDE;
 return '<section class="sect c5'+(wide>0?' c10':'')+(o.open?' open':'')+(o.cls?' '+o.cls:'')+'" data-k="'+key+'"'+(o.open?' data-bal-open':'')+'><h2 class="secttl"><span>'+esc(title)+'</span>'+(o.act||'')+'</h2>'+body+
  (more>0?'<div class="more-row more5"><button type="button" class="btn" data-more5="'+key+'"><span class="m-ph">Show '+more+' more</span>'+(wide>0?'<span class="m-wide">Show '+wide+' more</span>':'')+'</button></div>'+
   '<div class="more-row less5"><button type="button" class="btn btn-quiet" data-less="1" data-more5="'+key+'">Show fewer</button></div>':'')+'</section>'};
const dlist=rows=>'<div class="flist">'+rows.join('')+'</div>';
// a row is a link when the feed gives a safe url (ui.css draws the arrow), else plain text
const dlink=(u,cls,inner)=>{const s=safeUrl(u);return s?'<a class="frow'+cls+'" href="'+esc(s)+'" target="_blank" rel="noopener noreferrer">'+inner+'</a>':'<div class="frow'+cls+'">'+inner+'</div>'};
// the right cell: one inline span holding the mark and the word, an optional small line under it
const dfr=(k,w,sm)=>'<span class="fr"><span>'+(k?SD(k):'')+esc(w)+'</span>'+(sm?'<small>'+esc(sm)+'</small>':'')+'</span>';
const dfl=(b,sm)=>'<span class="fl"><b>'+esc(b)+'</b>'+(sm?'<small>'+esc(sm)+'</small>':'')+'</span>';
// a row that opens its detail sheet (devSheet, opened by the Home > Dev glue on [data-dv]): a chevron, as on every opener row (ui.css
// .frow.go); the outward link sits in that sheet
const dopen=(kind,key,cls,inner)=>'<button type="button" class="frow go'+cls+'" data-dv="'+kind+'" data-key="'+esc(key)+'">'+inner+'</button>';
const appKey=a=>str(a.id,20)||str(a.name,40);
const CI_WORD={fail:['bad','Failing'],pending:['warn','Running'],pass:['ok','Passing']};
function devGit(d){const g=isObj(d&&d.github)?d.github:null;if(!g)return null;
 const fm=uniq(arr(g.failing_main).filter(isObj),x=>str(x.repo,80)+'|'+str(x.workflow,60)),prs=uniq(arr(g.open_prs).filter(isObj),x=>str(x.repo,80)+'#'+fmt(x.num));
 return {g,fm,prs,fails:fm.length+prs.filter(x=>x.ci==='fail').length,rl:repoLabels(fm.concat(prs).map(x=>x.repo))}}
// the commit title leads (one line); the repo and number sit under it
function devPrRows(G){const nm=x=>G.rl[str(x.repo,80)]||'Repo';
 return G.fm.map(x=>dlink(x.url,' dvpr k-bad',dfl(str(x.workflow,60)||'Checks',nm(x)+' \u00B7 main')+dfr('bad','Failing'))).concat(
  G.prs.slice(0,40).map(x=>{const c=CI_WORD[str(x.ci,12)]||['','No checks'];return dlink(x.url,' dvpr'+(c[0]==='bad'?' k-bad':''),dfl(clip(str(x.title,200),DEV_TITLE)||'Untitled',nm(x)+' #'+fmt(x.num))+dfr(c[0],c[1]))}))}
// App builds: App Review trouble first, then builds that are not usable; an app that could not be read is a failed row with its reason
function devAppRows(f,now){return arr(isObj(f)&&f.apps).filter(isObj).slice(0,24).map((a,i)=>{let st;try{st=a.error?{k:'bad',word:'Not reporting'}:tfState(a)}catch(e){st={k:'bad',word:'Not reporting'}}return {a,i,st}})
 .sort((x,y)=>(x.st.k==='bad'?0:x.st.k==='warn'?1:2)-(y.st.k==='bad'?0:y.st.k==='warn'?1:2)||x.i-y.i).map(({a,st})=>{
  if(a.error)return '<div class="frow err k-bad">'+dfl(str(a.name,40)||'App',redact(str(a.error,120))||'App Store Connect did not answer')+dfr('bad','Not reporting')+'</div>';
  const b=isObj(a.latest_build)?a.latest_build:null,fb=isObj(a.feedback)?a.feedback:{},cr=num(fb.crashes_count),ver=str(b&&b.version,16),bn=str(b&&b.number,10);
  // the upload date, tester screenshots and last feedback are in the app's sheet (devSheet), not on the page
  // a number stays with its word ("build 18", never "build" / "18")
  const sm=b?[ver?'Version\u00A0'+ver:'',bn?'build\u00A0'+bn:'',cr>0?cr+(cr===1?'\u00A0crash':'\u00A0crashes'):''].filter(Boolean).join(' \u00B7 ')||'Build details not reported':'No build uploaded yet';
  return dopen('app',appKey(a),st.k==='bad'?' k-bad':'',dfl(str(a.name,40)||'App',sm)+'<span class="fr"><span class="pill'+(st.k?' '+st.k:'')+'">'+(st.k?SD(st.k==='bad'?'bad':'warn'):'')+esc(st.word)+'</span></span>')})}
const RW_KIND={jump:'Jump',new_entrant:'New entrant',own_entered:'Entered chart',own_dropped:'Dropped out',own_live:'Live',own_gone:'Gone',category_mismatch:'Category'};
// Rank watch: charts read and alerts as two rows, then the three newest alerts (warnings first). Missing counts are a not-reporting state, never zero.
function devRankRows(f){const run=isObj(f&&f.run)?f.run:{},c=isObj(f&&f.counts)?f.counts:{},ok=num(run.ok_charts),bad=num(run.failed_charts),a7=num(c.alerts_7d),a1=num(c.alerts_today);
 if(ok==null||a7==null)return null;
 const al=arr(f.alerts).filter(isObj).map((a,i)=>({a,i})).sort((x,y)=>(y.a.severity==='warn')-(x.a.severity==='warn')||x.i-y.i).slice(0,3).map(x=>x.a);
 return ['<div class="frow">'+dfl('App Store charts')+'<span class="fr"><b>'+cnt(ok)+' of '+cnt(ok+(bad||0))+'</b></span></div>',
  '<div class="frow">'+dfl('Alerts this week',a1!=null?cnt(a1)+' today':'')+'<span class="fr"><b>'+cnt(a7)+'</b></span></div>'].concat(
  // the alert text is shown whole and wraps: the row opens nothing, so an ellipsis would hide it
  al.map(a=>'<div class="frow'+(a.severity==='warn'?' k-warn':'')+'">'+dfl(clip(str(a.name,80),40)||'App',str(a.text,240))+dfr(a.severity==='warn'?'warn':'',RW_KIND[a.kind]||str(a.kind,30).replace(/_/g,' ')||'Alert')+'</div>'))}
// d = GET /api/dev, tf = /api/testflight, rw = /api/rankwatch; open = keys of the sections a phone opened with Show more
function devPage(d,now,tf,rw,open){const op=k=>!!(open&&(open.has?open.has(k):open[k])),S=[];
 const ar=devAppRows(tf,now);
 S.push(dsect('apps','App builds',state(tf)=='bad'?down('App builds',tf,'dev'):ar.length?dlist(ar):empty({k:'idle',title:'No apps listed',line:'App Store Connect has not reported an app yet.'}),{n:ar.length,open:op('apps')}));
 if(state(d)=='bad')S.push(dsect('dev','Pull requests',down('Dev',d,'dev')));
 else{const G=devGit(d),pr=G?devPrRows(G):[];
  S.push(dsect('prs','Pull requests',!G?empty({k:'bad',title:'GitHub did not report',line:'Pull requests show again once it answers.'}):pr.length?dlist(pr):empty({k:'idle',title:'No open pull requests',line:'Nothing is failing on main.'}),
   {n:pr.length,open:op('prs'),act:G&&G.fails>0?'<span class="act"><button type="button" class="btn btn-sm fix tv-hide" data-fix="ci" aria-label="Fix these: opens a message about '+G.fails+' failing '+(G.fails===1?'check':'checks')+'; nothing starts until you tap Send">Fix these</button></span>':''}));
  const V=arr(isObj(d.vercel)&&d.vercel.projects).filter(isObj).map((p,i)=>{const st=str(p.state,16)||'unknown';return {p,i,st,k:/error|fail/i.test(st)?'bad':p.paused?'warn':/ready/i.test(st)?'ok':'warn'}})
   .sort((x,y)=>(x.k==='bad'?0:x.k==='warn'?1:2)-(y.k==='bad'?0:y.k==='warn'?1:2)||x.i-y.i)
   .map(({p,i,st,k})=>dopen('vercel',vKey(p,i),k==='bad'?' k-bad':'',dfl(str(p.name,30)||'Project')+dfr(k,p.paused?'Paused':sentence(st))));
  S.push(dsect('vercel','Vercel',V.length?dlist(V):vercelEmpty(d),{n:V.length,open:op('vercel')}));
  const SB=arr(isObj(d.supabase)&&d.supabase.projects).filter(isObj).map((p,i)=>{const st=str(p.status,24)||'unknown',k=/HEALTHY|ACTIVE/i.test(st)?'ok':/PAUSE|INACTIVE/i.test(st)?'warn':'bad';
   return dopen('supabase',sKey(p,i),k==='bad'?' k-bad':'',dfl(str(p.name,30)||'Project')+dfr(k,sentence(st)))});
  S.push(dsect('supabase','Supabase',SB.length?dlist(SB):empty({title:'No Supabase projects',line:'Projects show up here once Supabase is connected.'}),{n:SB.length,open:op('supabase'),cls:'tv-hide'}))}
 if(rw!==undefined){const rr=state(rw)=='bad'?null:devRankRows(rw);
  S.push(dsect('rank','Rank watch',state(rw)=='bad'?down('Rank watch',rw,'dev'):rr?dlist(rr):empty({k:'bad',title:'Rank watch is not reporting charts',line:'The chart run or the alert counts are missing. Nothing is shown as zero.',retry:'dev'}),{n:rr?rr.length:0,open:op('rank'),cls:'tv-hide'}))}
 if(state(d)!='bad'){const h=isObj(d.herdr)?d.herdr:null,c=isObj(d.chromium)?d.chromium:{},gr=isObj(d.grok)?d.grok:{},ht=arr(h&&h.tabs);
  S.push(dsect('ws','Workspace',dlist([
   (h?dopen('herdr','herdr','',dfl('Herdr')+'<span class="fr"><b>'+ht.length+(ht.length===1?' tab':' tabs')+'</b>'+(num(h.agents_busy)!=null?'<small>'+fmt(h.agents_busy)+' busy</small>':'')+'</span>'):
    '<div class="frow">'+dfl('Herdr')+'<span class="fr"><b>No reading</b></span></div>'),
   '<div class="frow'+(c.cdp_up===false?' k-bad':'')+'">'+dfl('Browser')+dfr(c.cdp_up===true?'ok':c.cdp_up===false?'bad':'warn',yes(c.cdp_up,'Up','Down','Status unknown'),num(c.tabs)!=null?fmt(c.tabs)+' tabs':'')+'</div>',
   '<div class="frow">'+dfl('Grok')+dfr(gr.build_cli&&gr.logged_in===true?'ok':'warn',gr.build_cli?yes(gr.logged_in,'Signed in','Signed out','Sign-in unknown'):'Not installed',gr.build_cli?'Version '+str(gr.build_cli,24):'')+'</div>']),{cls:'tv-hide'}))}
 return devBoard(d,tf,rw)+'<div class="flow" id="hdev" data-balance>'+S.join('')+'</div>'}
// the keys a dev row carries to its sheet: a Vercel project by name, a Supabase project by its ref (else name), else its place in the list
const vKey=(p,i)=>str(p.name,30)||'#'+i,sKey=(p,i)=>str(p.ref,40)||str(p.name,30)||'#'+i;
// a feed time as a date, a clock time and an age ("Nov 15, 9:30 am · 2 h ago"); null when it does not read as a time
const dwhen=(t,now)=>{const e=toEpoch(t);return e==null?null:fmt.date(e)+', '+fmt.time(e)+' \u00B7 '+whole(ago(e,now))};
const dkv=rows=>'<dl class="kv">'+rows.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>';
const dext=(u,label)=>{const s=safeUrl(u);return s?'<a class="btn btn-primary ext" href="'+esc(s)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>':''};
// One dev row's sheet: what the row summarises, in full (an app's upload, crashes, tester screenshots and last feedback; a Vercel
// project's last deploy; a Supabase project's region; the Herdr tab names). A missing value says "No data", never 0. kind and key
// come from the row's data-dv and data-key; null when the feed no longer holds that row. -> options for DeckUI.detail.
function devSheet(kind,key,d,tf,now){const k=String(key==null?'':key),NO='No data',n=v=>num(v)==null?NO:String(Math.round(v));
 const okd=state(d)!='bad';
 if(kind==='app'){const a=arr(isObj(tf)&&tf.apps).filter(isObj).find(x=>!x.error&&appKey(x)===k);if(!a)return null;
  let st;try{st=tfState(a)}catch(e){st={word:'Not reporting'}}
  const b=isObj(a.latest_build)?a.latest_build:null,fb=isObj(a.feedback)?a.feedback:null,last=dwhen(fb&&fb.last_received_at,now);
  // no feedback time with no screenshots and no crashes is "None yet"; a missing block or counts without a time are "No data"
  const none=!!fb&&num(fb.screenshots_count)===0&&num(fb.crashes_count)===0;
  return {title:str(a.name,40)||'App',sub:'App build',body:'<section class="sh-sec">'+dkv([['State',st.word],['Version',str(b&&b.version,16)||NO],
   ['Build',b?str(b.number,10)||NO:'No build uploaded yet'],['Uploaded',dwhen(b&&b.uploaded_at,now)||NO],['Crashes',n(fb&&fb.crashes_count)],
   ['Tester screenshots',n(fb&&fb.screenshots_count)],['Last feedback',last||(none?'None yet':NO)]])+'</section>',actions:dext(tfLink(a),'Open in App Store Connect')}}
 if(kind==='vercel'&&okd){const p=arr(isObj(d.vercel)&&d.vercel.projects).filter(isObj).find((x,i)=>vKey(x,i)===k);if(!p)return null;
  const ld=toEpoch(p.last_deploy_at),pd=toEpoch(p.production_deploy_at);
  return {title:str(p.name,30)||'Project',sub:'Vercel project',body:'<section class="sh-sec">'+dkv([['State',p.paused?'Paused':sentence(str(p.state,16)||'unknown')],['Last deploy',dwhen(ld,now)||NO]]
   .concat(pd!=null&&pd!==ld?[['Production deploy',dwhen(pd,now)]]:[]))+'</section>',actions:dext(p.url,'Open site')}}
 if(kind==='supabase'&&okd){const p=arr(isObj(d.supabase)&&d.supabase.projects).filter(isObj).find((x,i)=>sKey(x,i)===k);if(!p)return null;
  return {title:str(p.name,30)||'Project',sub:'Supabase project',body:'<section class="sh-sec">'+dkv([['Status',sentence(str(p.status,24)||'unknown')],['Region',str(p.region,24)||NO]])+'</section>',actions:''}}
 // Herdr: the tab names lead (each with its panes; the list is what the row summarises); the count and the busy agents (when known, as on
 // the row) are the sheet's sub-line
 if(kind==='herdr'&&okd&&isObj(d.herdr)){const h=d.herdr,all=arr(h.tabs),tabs=all.filter(isObj).slice(0,40),busy=num(h.agents_busy);
  return {title:'Herdr',sub:all.length+(all.length===1?' tab':' tabs')+(busy==null?'':' \u00B7 '+busy+(busy===1?' agent busy':' agents busy')),
   body:'<section class="sh-sec">'+(tabs.length?dkv(tabs.map(t=>[redact(str(t.name,80))||'Untitled tab',num(t.panes)==null?NO:t.panes+(t.panes===1?' pane':' panes')])):'<p class="note">No tabs open.</p>')+'</section>',actions:''}}
 return null}
// TV: one calm read-only board of four tiles (what needs a look in each part); the sections sit one Down press below it. Hidden off TV.
function devBoard(d,tf,rw){const tiles=[];const t=(label,value,sub)=>tiles.push(V3.tile({label,value,sub}));
 if(state(tf)=='bad')t('App builds','Not reporting');else{const a=arr(tf.apps).filter(isObj),n=a.filter(x=>{try{return x.error||tfState(x).k}catch(e){return true}}).length;t('App builds',n?String(n):'OK',n?(n===1?'app needs a look':'apps need a look'):a.length+(a.length===1?' app':' apps'))}
 const G=state(d)=='bad'?null:devGit(d);if(!G)t('Pull requests','Not reporting');else t('Pull requests',String(G.prs.length),G.fails?G.fails+' failing':'open, none failing');
 if(state(d)=='bad')t('Vercel','Not reporting');else{const v=arr(isObj(d.vercel)&&d.vercel.projects).filter(isObj),b=v.filter(p=>/error|fail/i.test(str(p.state,16))).length;t('Vercel',b?String(b):v.length?'OK':'Not reporting',b?'failing':v.length?v.length+(v.length===1?' project':' projects'):'')}
 if(rw!==undefined){const rr=state(rw)=='bad'?null:isObj(rw.counts)?num(rw.counts.alerts_7d):null;t('Rank alerts',rr==null?'Not reporting':String(rr),rr==null?'':'this week')}
 return '<div class="dev-tv board">'+V3.strip(tiles,{label:'Dev at a glance'})+'</div>'}
// one freshness mark: the dev feed's age; every feed or source that did not report (a rate-limited GitHub included) is a part not reporting
function devFresh(d,now,tf,rw){const t=isObj(d)&&!d.error?toEpoch(d.t):null,G=state(d)=='bad'?null:devGit(d);
 const miss=(state(d)=='bad'?1:0)+(G&&G.g.stale===true?1:0)+(state(d)!='bad'&&!G?1:0)+arr(isObj(d)&&d.errors).filter(isObj).filter(e=>!/^github$/i.test(str(e.source,20))||G).length+
  (state(tf)=='bad'?1:arr(tf.apps).filter(x=>isObj(x)&&x.error).length)+(rw!==undefined&&(state(rw)=='bad'||devRankRows(rw)==null)?1:0);
 return {age:t==null?null:Math.max(0,Math.round(now/1000-t)),refresh:num(d&&d.refresh)||600,missing:miss}}
// the Data sheet: each source with what it gives and how old it is; failed parts with their reason under Setup
function devData(d,now,tf,rw){const okd=state(d)!='bad',G=okd?devGit(d):null,v=arr(okd&&isObj(d.vercel)&&d.vercel.projects),s=arr(okd&&isObj(d.supabase)&&d.supabase.projects);
 const st=f=>state(f)=='bad'?'never':state(f)=='stale'?'stale':'ok',asOf=f=>isObj(f)&&toEpoch(f.t)!=null?ago(f.t,now):'';
 const sources=[{name:'GitHub',gives:G?G.prs.length+' open pull requests, '+G.fm.length+' failing on main':'Not reporting',asOf:G&&G.g.at!=null?ago(G.g.at,now)+(G.g.stale===true?(G.g.stale_reason==='rate_limited'?', GitHub rate limit':', GitHub unreachable'):''):asOf(d),state:!G?'never':G.g.stale===true?'stale':st(d)},
  {name:'Vercel',gives:okd?v.length+(v.length===1?' project':' projects'):'Not reporting',asOf:asOf(d),state:okd&&v.length?st(d):'never'},
  {name:'Supabase',gives:okd?s.length+(s.length===1?' project':' projects'):'Not reporting',asOf:asOf(d),state:okd&&s.length?st(d):'never'},
  {name:'Workspace',gives:'Herdr tabs, the browser on debug port 9333 (page titles hidden) and the Grok CLI',asOf:asOf(d),state:okd?st(d):'never'},
  {name:'App Store Connect',gives:state(tf)=='bad'?'Not reporting':arr(tf.apps).length+' apps',asOf:asOf(tf),state:st(tf)}];
 if(rw!==undefined){const run=isObj(rw&&rw.run)?rw.run:{},c=isObj(rw&&rw.counts)?rw.counts:{};
  sources.push({name:'App Store rank watch',gives:num(run.ok_charts)==null?'Not reporting charts':cnt(run.ok_charts)+' charts read'+(num(c.apps)!=null?', '+cnt(c.apps)+' apps tracked':'')+(num(c.live)!=null?', '+cnt(c.live)+' live':''),asOf:asOf(rw),state:num(run.ok_charts)==null?'never':st(rw)})}
 const setup=[d,tf,rw].filter(isObj).flatMap(f=>arr(f.errors).filter(isObj).map(e=>({name:friendly(str(e.source,40))||'A source',line:redact(str(e.reason,120))||'No reason given',state:'blocked'})));
 return {sources,method:[['Fixing','The Fix these button opens a message to your AI assistant about the failing checks. Nothing starts until you tap Send.'],['Order','App Review trouble first, failing checks first, failed Vercel deploys first']],setup}}

 // ---- keys page: connections (accounts feed). v3: one title and one surface per section; no ages on titles, no per-row
 // source or diagnostic lines (device CLIs, vault names, remotes, readable-by notes). The page carries one freshness mark.
 const HOST_LABEL={mesh:'Dell','mac-mini':'Mac mini','pc-desktop':'pc-desktop'};
 const DRIVE_LABEL={gdrive:'Google Drive',onedrive:'OneDrive',icloud:'iCloud Drive'};
 const n0=v=>{const n=num(v);return n==null?'--':String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,',')};
 const mini=(h,v,t,k,dg)=>'<div class="mt'+(k=='bad'?' bad':k=='stale'?' stale':'')+'"><span>'+(k?SD(k=='stale'?'warn':k):'')+esc(h)+'</span><b>'+esc(v)+'</b>'+(t?'<small>'+esc(t)+'</small>':'')+diagHtml(dg)+'</div>';
 // the right side of a row: a calm value or state word when all is well, a status pill (mark and word) when it is not
 const cRight=(k,word)=>k&&k!=='ok'?'<span class="pill '+k+'">'+SD(k)+esc(word)+'</span>':'<b>'+esc(word)+'</b>';
 // a link row keeps target="_blank": ui.css draws the one external-link mark (a.frow[target="_blank"]::after), so the row adds none
 const cRow=(main,sub,k,word,url)=>{const u=safeUrl(url),tag=u?'a':'div';
  return '<'+tag+' class="frow"'+(u?' href="'+esc(u)+'" target="_blank" rel="noopener noreferrer"':'')+'><span class="fl"><b>'+esc(main)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</span><span class="fr">'+cRight(k,word)+'</span></'+tag+'>'};
 const cSect=(title,body,act)=>'<section class="sect"><h2 class="secttl"><span>'+esc(title)+'</span>'+(act?'<span class="act">'+esc(act)+'</span>':'')+'</h2>'+body+'</section>';
 const cList=rows=>'<div class="flist">'+rows.join('')+'</div>';
 function mcpRow(name,m){if(!isObj(m))return cRow(name+' tools','Settings could not be read','bad','Not reporting');
  const need=arr(m.auth_needed).map(x=>str(x,30)).filter(Boolean),down=arr(m.unreachable).map(x=>str(x,30)).filter(Boolean);
  const sub=fmt(m.enabled)+' of '+fmt(m.declared)+' on \u00B7 '+fmt(m.signed_in)+' of '+fmt(m.oauth)+' signed in'+(need.length?' \u00B7 Sign in: '+need.join(', '):'')+(down.length?' \u00B7 Not answering: '+down.join(', '):'');
  return cRow(name+' tools',sub,need.length||down.length?'warn':'ok',need.length?need.length+' need sign-in':down.length?down.length+' not answering':'OK')}
 function conn(a,now){
  if(state(a)=='bad')return [cSect('Connections',down('Connections',a,'keys')),''];
  const op=arr(isObj(a.onepassword)&&a.onepassword.hosts).filter(isObj),dr=arr(a.drives).filter(isObj),ap=isObj(a.apple)?a.apple:{},lib=isObj(ap.library)?ap.library:{};
  const co=isObj(a.composio)?a.composio:null,mc=isObj(a.mcp)?a.mcp:{},da=isObj(a.dev_auth)?a.dev_auth:{};
  const opc=cSect('1Password',op.length?cList(op.map(h=>cRow(HOST_LABEL[str(h.host,20)]||str(h.host,20)||'Device',n0(h.items)+' items',
   h.token_ok===true&&h.op_cli?'ok':h.token_ok===false?'bad':'warn',h.token_ok===false?'Needs sign-in':h.token_ok===true?(h.op_cli?'Signed in':'Needs setup'):'Unknown'))):empty({title:'No devices listed',line:'Devices that can reach 1Password show up here.'}));
  const dv=x=>isObj(x)?x:{},gh=dv(da.github),vc=dv(da.vercel),sb=dv(da.supabase);
  const api=(n,x)=>cRow(n,[x.projects!=null?fmt(x.projects)+' projects':'','Tools '+(x.mcp_signed_in===true?'signed in':x.mcp_signed_in===false?'signed out':'unknown')].filter(Boolean).join(' \u00B7 '),
   x.ok===false?'bad':x.ok===true&&x.mcp_signed_in!==false?'ok':'warn',x.ok===true?'Connected':x.ok===false?'Not connected':'Unknown');
  const account=str(gh.account,39),accountUrl=gh.ok===true&&/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(account)?'https://github.com/'+account:'';
  const dec=cSect('Developer sign-in',cList([cRow('GitHub','',gh.ok===true?'ok':gh.ok===false?'bad':'warn',gh.ok===true?'Signed in':gh.ok===false?'Signed out':'Unknown',accountUrl),api('Vercel',vc),api('Supabase',sb)]));
  const mcc=cSect('Tools',cList([mcpRow('OMP',mc.omp),mcpRow('Hermes',mc.hermes)]));
  const reach=ap.mini_reachable!==false,ak=reach?'ok':'bad';
  const ar=(name,v,sub,k)=>cRow(name,sub,k,v);
  const apc=cSect('Apple',reach?cList([
   ar('iMessage',n0(ap.imessage_unread)+' unread','',ak),
   ar('Notes',n0(lib.notes),n0(ap.notes_recent_7d)+' this week',ak),
   ar('Photos',n0(lib.photos),n0(ap.photos_recent_7d)+' added this week',ak),
   ar('Calendar',n0(ap.calendar_today)+' today',n0(lib.calendars)+' calendars',ak),
   ar('Reminders',n0(ap.reminders_open)+' open',n0(lib.reminder_stores)+' lists',ak),
   ar('Contacts',lib.contacts===true?'OK':lib.contacts===false?'Not available':'Unknown','',lib.contacts===true?'ok':'warn'),
   ar('Wallet',n0(lib.wallet_passes)+' passes','',lib.wallet===true?'ok':'warn'),
   ar('iCloud Drive',lib.icloud_drive===true?'OK':lib.icloud_drive===false?'Not available':'Unknown','',lib.icloud_drive===true?'ok':'warn')]):
   empty({k:'bad',title:'The Mac mini is not reachable',line:'Apple apps show up here when it answers.',retry:'keys'}),reach&&str(lib.account,60)?'iCloud connected':'');
  const kinds={};
  const drc=cSect('Drives',dr.length?cList(dr.map(x=>{const kd=str(x.kind,12),base=DRIVE_LABEL[kd]||kd||'Drive',n=kinds[base]=(kinds[base]||0)+1,name=n>1?base+'\u00A0'+n:base;
   return x.ok===false?cRow(name,'Could not check free space','bad','Not reachable'):cRow(name,fmt(x.used_gb,0,' GB')+' used','ok',fmt(x.free_gb,0,' GB')+' free')})):empty({title:'No drives listed',line:'Cloud drives you connect show up here.'}));
  let coc;
  if(!co)coc=cSect('Connected services',empty({k:'bad',title:'Connected services are not reporting',line:'The list could not be read. Try again.',retry:'keys'}));
  else{const kits=arr(co.toolkits).filter(isObj),live=kits.filter(t=>num(t.active)>0||arr(t.aliases).length),rest=kits.length-live.length;
   coc=cSect('Connected services',(live.length?cList(live.map(t=>{const al=arr(t.aliases),on=num(t.active)>0;
    return cRow(friendly(str(t.toolkit,30))||'Service',al.length?al.length+(al.length===1?' account':' accounts')+(num(t.expired)>0?' \u00B7 '+fmt(t.expired)+' expired':''):'',on?'ok':'bad',on?'Connected':'Reconnect')}).concat(
    rest>0?['<div class="frow"><span class="fl"><small>'+rest+' more service'+(rest>1?'s':'')+' with only expired links</small></span></div>']:[])):empty({title:'No connected services',line:'Services you connect show up here.'})),fmt(co.active)+' connected \u00B7 '+fmt(co.expired)+' expired')}
  return [opc+dec+mcc,apc+drc+coc]}

 // ---- life ----
 // list sizes. JOB_CAP is the server's listing cap (sources.rs keeps 1200 jobs since 2026-11-01), so Show more can reach every listing in a filter.
 // The job and gig lists run in one to six columns of rows (css/work.css), so every page size is a multiple of 12: rows come out even.
const JOB_SHORT=12,JOB_STEP=48,HOME_SHORT=8,COM_SHORT=5,JOB_CAP=1200,HOME_CAP=20,COM_CAP=20;
// the next jobs page size after a Show more (or Show fewer) tap. The glue keeps only this number; a missing or bad one restarts short.
// 2026-11-01: the glue read an unexported JOB_CAP, Math.min(62, undefined) was NaN and every tap fell back to the short 12.
const jobNext=(n,less)=>{const v=num(n);return less||v==null?JOB_SHORT:Math.max(JOB_SHORT,Math.min(Math.round(v)+JOB_STEP,JOB_CAP))};
// whose job search the Jobs column shows: the person picker's feeds, one file each (2026-11-02), same schema plus person, each with its
// own taxonomy. saved: whether the deck keeps a saved-jobs tracker for that person (a list without one is read-only here, no tracker).
const JOB_PEOPLE=[{id:'tanner',label:'Tanner',feed:'jobs',file:'jobs.json',saved:true,pron:'his'},{id:'riley',label:'Riley',feed:'jobs-riley',file:'jobs-riley.json',saved:true,pron:'his'},
 {id:'casey',label:'Casey',feed:'jobs-casey',file:'jobs-casey.json',saved:true,pron:'his'},{id:'morgan',label:'Morgan',feed:'jobs-morgan',file:'jobs-morgan.json',saved:false,pron:'her'}];
const jobPerson=id=>JOB_PEOPLE.find(p=>p.id===id)||JOB_PEOPLE[0];
// sv = the person's saved-jobs answer (GET /api/saved-jobs) when the page has one: the row then carries a "Saved N" chip that swaps the
// list for the saved one (svOn). An answer that failed still shows the chip, so the error is one tap away.
const jobPersonRow=(id,sv,svOn)=>'<div class="chips" id="jperson" role="group" aria-label="Whose job search">'+JOB_PEOPLE.map(p=>'<button type="button" class="b jchip jpers'+(p.id===id?' on':'')+'" data-person="'+p.id+'" aria-pressed="'+(p.id===id?'true':'false')+'">'+esc(p.label)+'</button>').join('')+
 (sv===undefined?'':'<button type="button" class="b jchip jsaved'+(svOn?' on':'')+'" data-saved="1" aria-pressed="'+(svOn?'true':'false')+'">Saved'+(isObj(sv)&&Array.isArray(sv.items)?' '+sv.items.length:'')+'</button>')+'</div>';
const jobKey=x=>[str(x&&x.title,90),str(x&&x.company,40),str(x&&x.location,40)].join('|').toLowerCase();
 const jobList=j=>uniq(arr(j&&j.listings).filter(isObj),jobKey);
// ---- saved jobs (GET/POST /api/saved-jobs, owner only): a star per row, a state per posting with the date of every change ----
const SJ_STATES=['saved','applied','interview','offer','passed'];
const SJ_WORD={saved:'Saved',applied:'Applied',interview:'Interview',offer:'Offer',passed:'Passed'};
const sjItems=s=>arr(isObj(s)&&s.items).filter(x=>isObj(x)&&str(x.key,200));
const sjIndex=s=>{const m=new Map();for(const x of sjItems(s))m.set(str(x.key,200),x);return m};
const sjDay=t=>{const e=toEpoch(t);return e==null?'':new Date(e*1000).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Los_Angeles'})};
// "Applied Oct 30 · Saved Oct 28": newest change first, at most three
const sjTrail=x=>arr(x&&x.history).filter(isObj).slice().reverse().slice(0,3).map(h=>(SJ_WORD[h.state]||'')+(sjDay(h.at)?' '+sjDay(h.at):'')).filter(Boolean).join(' \u00B7 ');
// the star on a row: an unsaved posting saves on tap; a saved one opens its sheet, where the state changes and Remove live
const jobStar=(key,t,sv)=>'<button type="button" class="jstar'+(sv?' on':'')+'" data-star="'+esc(key)+'" aria-pressed="'+(sv?'true':'false')+'" aria-label="'+esc(sv?'Saved, '+(SJ_WORD[sv.state]||'saved')+': '+t+'. Open to change':'Save job: '+t)+'">'+(sv?'\u2605':'\u2606')+'</button>';
// reading cues the feed writes per posting (deck-feed-jobs): `flags` ids, `flag_text` words and a one-line `note`. Shown as quiet pills and one line so a posting can be
// skipped without opening it. No flag means nothing was found in the text the source gave: it never reads as "clearance not required".
const JOB_FLAG_TEXT={clearance_required:'Clearance required',login_for_match:'Login needed for match'};
function jobCue(x){const ft=arr(x&&x.flag_text).map(s=>str(s,40)).filter(Boolean),ids=arr(x&&x.flags).map(f=>str(f,30)).filter(Boolean);
 const words=ft.length?ft:ids.map(f=>JOB_FLAG_TEXT[f]||'').filter(Boolean),note=str(x&&x.note,140);
 return (words.length?'<small class="jflags">'+words.slice(0,4).map(w=>'<span class="pill warn">'+esc(w)+'</span>').join(' ')+'</small>':'')+(note?'<small class="jnote">'+esc(note)+'</small>':'')}
 

 const JMETRO={south_oc:'South OC',oc:'OC',la:'LA',sd:'SD',remote:'Remote'};
 const JMETRO_CHIP={south_oc:'South OC',oc:'OC',la:'LA',sd:'SD',remote:'Remote'};
 // the feed's own remote pay floor (rules.remote_min_pay) is said once, under Pay in the Filters sheet: "Remote jobs show here only when they
 // pay $100K or more" (a rule of this person's search, not a fact about the market). The Remote chip is plain Remote; the reader's own floor
 // is the Pay chips (F7). A feed with no floor says nothing.
 function jobRemoteFloor(j){const r=isObj(j&&j.rules)?j.rules:null,n=r?num(r.remote_min_pay):null;return n>0?'Remote jobs show here only when they pay '+usd(n)+' or more.':''}
 const JSORT={fit:'Best fit',new:'Newest'};
 // posted within a day or a week (F7). A first-seen date is not a posting date: such a listing never counts as posted lately, and the page
 // says how many that leaves out (jobLeftOut).
 const JDAYS={'1':'Last 24 hours','7':'7 days'};
 const jobDated=x=>!!x&&x.posted_basis!=='first_seen'&&toEpoch(x.posted_at)!=null;
 const jobFresh=(x,days,now)=>jobDated(x)&&toEpoch(x.posted_at)>=(now==null?Date.now():now)/1000-days*86400;
 // the reader's pay floor (F7): the top of the stated range reaches it ("from $X" counts its floor). No stated pay never passes a floor, and
 // the page says how many that leaves out (jobLeftOut).
 const JPAY=[50000,100000,150000,200000,250000];
 const jobTop=x=>{const hi=num(x&&x.pay_max),lo=num(x&&x.pay_min);return hi!=null?hi:lo};
 // what a pay floor or a Posted window drops only because a listing lacks the field (no stated pay, no posting date), among the rows every
 // other filter keeps. Nothing is ever dropped unsaid (review of #365).
 function jobLeftOut(j,st,now){const o=isObj(st)?st:{},pay=JPAY.includes(+o.pay),days=!!JDAYS[o.days];
  return {pay:pay?jobFilter(j,Object.assign({},o,{pay:'all'}),now).filter(x=>jobTop(x)==null).length:0,
   date:days?jobFilter(j,Object.assign({},o,{days:'all'}),now).filter(x=>!jobDated(x)).length:0}}
 const jobLeftWords=l=>[l&&l.pay?jn(l.pay)+' with no stated pay left out':'',l&&l.date?jn(l.date)+' with no posting date left out':''].filter(Boolean);
 // the Filters search: every word must appear in the title, the employer or the place
 const jobQ=s=>String(s==null?'':s).toLowerCase().replace(/\s+/g,' ').trim().slice(0,60);
 const jobHit=(x,q)=>{if(!q)return true;const h=[x.title,x.company,x.location].map(v=>str(v,90).toLowerCase()).join(' ');return q.split(' ').every(w=>h.includes(w))};
 const JMETRO_ORDER=['south_oc','oc','la','sd','remote'];
 const JMODE={in_person:'in person',hybrid:'hybrid',remote:'remote'};
 // listings per site from the deduped rows: the Data sheet lists them as the page's sources (a site never shows on the page)
 function jobSites(j){const by={};for(const x of jobList(j)){const s=str(x.site,30);if(s)by[s]=(by[s]||0)+1}
  return Object.keys(by).map(s=>({site:s,n:by[s]})).sort((a,b)=>b.n-a.n||a.site.localeCompare(b.site))}
 const jdef=v=>({slug:str(v&&v.slug,40),name:str(v&&v.name,60)||str(v&&v.slug,40),definition:str(v&&v.definition,220)});
 function jobTax(j){return arr(isObj(j)&&j.taxonomy).filter(isObj).map(t=>{const d=jdef(t);
  return d.slug?{slug:d.slug,name:d.name,definition:d.definition,subs:arr(t.subs).filter(isObj).map(jdef).filter(s=>s.slug)}:null}).filter(Boolean)}
 function jobCat(tax,slug){const s=str(slug,40);return s&&Array.isArray(tax)?tax.find(t=>t.slug===s)||null:null}
 function jobSub(cat,slug){const s=str(slug,40);return cat&&s?cat.subs.find(x=>x.slug===s)||null:null}
 function jobCounts(list){const c={};for(const x of list){const k=str(x&&x.category,40);if(k)c[k]=(c[k]||0)+1}return c}
 // now: the clock for the Posted counts (Today, 7 days); pay: listings whose top of range reaches each floor in JPAY
 function jobFacets(j,now){const list=jobList(j),tax=jobTax(j),by=jobCounts(list),sub={};
  for(const x of list){const c=str(x&&x.category,40),s=str(x&&x.subcategory,40);if(c&&s){(sub[c]=sub[c]||{})[s]=(sub[c][s]||0)+1}}
  const cats=tax.map(t=>({slug:t.slug,name:t.name,n:by[t.slug]||0})).filter(t=>t.n>0);
  for(const k of Object.keys(by))if(!cats.some(c=>c.slug===k))cats.push({slug:k,name:k.replace(/_/g,' '),n:by[k]});
  const days={},pay={};for(const d of Object.keys(JDAYS))days[d]=list.filter(x=>jobFresh(x,+d,now)).length;
  for(const p of JPAY)pay[p]=list.filter(x=>{const t=jobTop(x);return t!=null&&t>=p}).length;
  return {cats,sub,days,pay,total:list.length,metro:list.some(x=>{const m=str(x&&x.metro,12);return m!==''&&JMETRO[m]!=null})}}
 // filter is {cat,sub,metro,days,pay,q,sort}. Best fit keeps the collector's curated order; Newest sorts by posted date, unknown dates last.
 function jobFilter(j,f,now){const o=isObj(f)?f:{},cat=str(o.cat,40),sub=str(o.sub,40),metro=str(o.metro,12),days=JDAYS[o.days]?+o.days:0,
  pay=JPAY.includes(+o.pay)?+o.pay:0,q=jobQ(o.q);
  const list=jobList(j).filter(x=>(!cat||cat==='all'||str(x.category,40)===cat)&&
   (!sub||sub==='all'||str(x.subcategory,40)===sub)&&(!metro||metro==='all'||str(x.metro,12)===metro)&&
   (!days||jobFresh(x,days,now))&&(!pay||jobTop(x)>=pay)&&jobHit(x,q));
  // the collector already emits a curated order (score inside each category, categories interleaved);
  // re-sorting here for Best fit stacked one category on top and hid the owner's mix.
  if(o.sort!=='new')return list;
  return list.map((x,i)=>({x,i,t:toEpoch(x.posted_at)})).sort((a,b)=>(b.t==null?-1:b.t)-(a.t==null?-1:a.t)||a.i-b.i).map(o=>o.x)}
 // annual pay: hourly text and unknown pay stay words; a known range reads $150K-$200K; a pay the source gives only as a floor ("Starting at",
 // pay_from from the collector, SeeData D14) reads "from $44K", never as an exact salary
 function jobPay(x){const lo=num(x&&x.pay_min),hi=num(x&&x.pay_max);
  if(lo!=null&&hi!=null)return lo===hi?usd(lo):usd(lo)+'-'+usd(hi);
  if(hi!=null)return 'up to '+usd(hi);if(lo!=null)return x.pay_from===true?'from '+usd(lo):usd(lo)+'+';
  return str(x&&x.pay_text,48)||str(x&&x.salary,40)}
 // a count read aloud: exact, with thousands commas ("1,200")
 const jn=v=>{const n=num(v);return n==null?'':String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,',')};
 // where a posting is: employer, metro (or the place the source gave) and how it is worked. A metro or mode name never breaks inside
 // itself ("in" / "person" read as two words at the end of a line).
 const jobWhere=x=>{const nb=s=>s?s.replace(/ /g,'\u00A0'):'';
  return [str(x&&x.company,40),nb(JMETRO[str(x&&x.metro,12)])||str(x&&x.location,40),nb(JMODE[str(x&&x.mode,12)])||(x&&x.remote===true?'remote':'')].filter(Boolean).join(' \u00B7 ')};
 // one posting as its row reads it (baseline problem 18): title, where, pay as a value of its own (null when the posting states none)
 // and the fit score as one number. No site and no age on the row: the sheet carries the date, the Data sheet the sites.
 function jobRowModel(x){const pay=jobPay(x);
  return {key:jobKey(x),title:str(x&&x.title,90)||'Untitled posting',where:jobWhere(x),pay:pay||null,score:num(x&&x.score),url:safeUrl(x&&x.url)}}
 // the row opens the detail sheet, the star beside it saves, the arrow opens the posting (a safe http(s) url only).
 // sv: undefined when the page has no saved-jobs answer (no star), else the saved item for this posting or null
 function jobRow(x,sv){const m=jobRowModel(x);
  return '<div class="frow jitem" data-key="'+esc(m.key)+'"><button type="button" class="jrow" data-jk="'+esc(m.key)+'" aria-label="'+esc('Job detail: '+m.title)+'"><span class="fl"><b>'+esc(m.title)+'</b>'+
   (m.where?'<small>'+esc(m.where)+'</small>':'')+(m.pay?'<span class="jpay">'+esc(m.pay)+'</span>':'')+jobCue(x)+'</span>'+
   (m.score==null?'':'<span class="fr"><b>'+Math.round(m.score)+'</b><small>Fit</small></span>')+'</button>'+
   (sv===undefined?'':jobStar(m.key,m.title,sv))+
   (m.url?'<a class="jopen" href="'+esc(m.url)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc('Open posting: '+m.title)+'">'+LK+'</a>':'')+'</div>'}
// per category, worked out from the listings the page loaded: how many, how many were posted this week (a first-seen date is not a
// posting date) and the median top of the stated pay range. All jobs first, the four biggest open, the rest one tap away. "Median top pay"
// is said once, as the head of its column (SeeViz V20); each figure keeps the words for a screen reader.
const jmed=a=>{const s=a.slice().sort((x,y)=>x-y),n=s.length;return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):null};
 function jobCats(j,now){const list=jobList(j);if(!list.length)return '';
  const tax=jobTax(j),wk=(now==null?Date.now():now)/1000-7*86400,by=new Map();
  const add=(k,x)=>{let e=by.get(k);if(!e){e={n:0,pay:[],fresh:0};by.set(k,e)}e.n++;const p=num(x.pay_max);if(p!=null&&p>0)e.pay.push(p);
   const t=toEpoch(x.posted_at);if(t!=null&&t>=wk&&x.posted_basis!=='first_seen')e.fresh++};
  for(const x of list){add('*',x);const c=str(x.category,40);if(c)add(c,x)}
  const name=k=>{const c=jobCat(tax,k);return c?c.name:sentence(k)};
  const cats=[...by.keys()].filter(k=>k!=='*').sort((a,b)=>by.get(b).n-by.get(a).n),top=cats.slice(0,4),rest=cats.slice(4);
  const r=(k,label)=>{const e=by.get(k),m=jmed(e.pay);
   return '<div class="frow"><span class="fl"><b>'+esc(label)+'</b><small>'+esc(jn(e.n)+(e.n===1?' job':' jobs')+(e.fresh?' \u00B7 '+jn(e.fresh)+' new this week':''))+'</small></span>'+
    (m==null?'':'<span class="fr"><b>'+esc(usd(m))+'</b><small class="vh">median top pay</small></span>')+'</div>'};
  const head=[...by.values()].some(e=>e.pay.length)?'<p class="jch" aria-hidden="true"><span>Category</span><span>Median top pay, jobs shown here</span></p>':'';
  return '<section class="sect jcats"><h2 class="secttl"><span>By category</span></h2>'+head+'<div class="flist">'+r('*','All jobs')+top.map(k=>r(k,name(k))).join('')+'</div>'+
   (rest.length?'<details class="jmore"><summary class="btn btn-quiet" tabindex="0">'+rest.length+(rest.length===1?' more category':' more categories')+'</summary><div class="flist">'+rest.map(k=>r(k,name(k))).join('')+'</div></details>':'')+'</section>'}
// the collector's market block for the chosen category (the whole market when none): one set of bars, the jobs its search found per area
// (a count, never the listed rows: the list holds at most the server cap), the median top pay of every job it found in that category (By
// category's column is the median of the listed rows only, so the two scopes are named apart), the change since its last run, who hires
// most and the owner's local cluster read. Only numbers the collector wrote; nothing is summed here.
 function jobMarket(j,slug,catName,opt){const mk=isObj(j&&j.market)?j.market:null;if(!mk)return '';
  const bc=slug&&isObj(mk.by_category)&&isObj(mk.by_category[slug])?mk.by_category[slug]:null;
  if(!bc&&!isObj(mk.by_metro))return '';
  // a metro entry is a count, or {total, by_category} in the whole-market block
  const bm=bc&&isObj(bc.by_metro)?bc.by_metro:mk.by_metro,mv=v=>num(v)!=null?num(v):isObj(v)?num(v.total):null,kv=[];
  const add=(k,v)=>{if(v)kv.push('<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>')};
  const area=bm?JMETRO_ORDER.map(m=>({label:JMETRO[m],value:mv(bm[m])})).filter(b=>b.value!=null).map(b=>Object.assign(b,{text:jn(b.value)})):[];
  const dv=num(bc&&bc.delta_vs_prev),drop=num(bc&&bc.remote_unknown_pay_dropped),med=num(bc&&bc.median_pay_max);
  if(med!=null&&med>0)add('Median top pay, every job found',usd(med));
  if(dv!=null)add('Since the last run',dv>0?'+'+jn(dv):dv<0?'\u2212'+jn(-dv):'No change');
  if(drop!=null&&drop>0)add('Remote left out, pay unknown',jn(drop));
  const emp=arr(bc&&bc.top_employers).filter(isObj).map(e=>str(e.name,26)).filter(Boolean).slice(0,3);
  const ins=isObj(opt&&opt.insight)?opt.insight:null,take=ins&&slug&&isObj(ins.categories)?str(ins.categories[slug],220):'';
  if(!area.length&&!kv.length&&!emp.length&&!take)return '';
  return '<section class="sect jmkt"><h2 class="secttl"><span>Market</span>'+(catName?'<span>'+esc(catName)+'</span>':'')+'</h2><div class="panel">'+
   (area.length?'<h3 class="jmh">Jobs found, by area</h3>'+V3.bars(area,{sort:false}):'')+(kv.length?'<dl class="kv">'+kv.join('')+'</dl>':'')+
   (emp.length?'<p class="note sm">Hiring most: '+esc(emp.join(', '))+'</p>':'')+(take?'<p class="jtake">'+esc(take)+'</p>':'')+'</div></section>'}
 // ['Posted', 'Nov 12'], or ['First seen', 'Nov 12'] when the feed only knows when it first saw the posting
 const jobPosted=x=>{const d=x&&x.posted_at!=null?sjDay(x.posted_at):'';return d?[x.posted_basis==='first_seen'?'First seen':'Posted',d]:null};
 // the detail sheet for DeckShell.sheet.open (through DeckUI.detail, which adds the Data button): where it is, the tracker, pay and date,
 // flags, why it fits, the summary, the local cluster take, the category with its definition and the owner's note. Open posting is the one
 // primary action. The site and the cluster model live in the Data sheet.
 function jobSheetOpts(x,j,opt){const o=isObj(opt)?opt:{};
  if(!isObj(x))return {title:'Job',sub:'',body:empty({title:'No listing selected'}),actions:''};
  const ins=isObj(o.insight)?o.insight:null,tax=jobTax(j),cat=jobCat(tax,x.category),sub=jobSub(cat,x.subcategory);
  const t=str(x.title,90)||'Untitled posting',u=safeUrl(x.url),pay=jobPay(x)||str(x.pay_text,60),sum=str(x.summary,280),when=jobPosted(x),note=str(x.note,200);
  // the date is in the key-value block, so a "Posted today" reason is not repeated under Why it fits
  const why=arr(x.why).map(w=>str(w,120)).filter(w=>w&&!/^(posted|first seen)\b/i.test(w)).slice(0,3),take=str(x.cluster_take,200)||(ins&&isObj(ins.takes)?str(ins.takes[str(x.url,400)],200):'');
  const ftxt=arr(x.flag_text).map(f=>str(f,80)).filter(Boolean),flags=ftxt.length?ftxt:arr(x.flags).map(f=>JOB_FLAG_TEXT[str(f,30)]||sentence(str(f,30))).filter(Boolean);
  const kv=[['Pay',pay]].concat(when?[when]:[]).filter(r=>r[1]);
  const sec=(h,b)=>'<section class="sh-sec"><h3>'+esc(h)+'</h3>'+b+'</section>';
  const body=(o.track?sec('Track',jobTrack(str(o.key,200)||jobKey(x),o.saved,o.trackErr)):'')+
   (kv.length?'<dl class="kv">'+kv.map(r=>'<div><dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd></div>').join('')+'</dl>':'')+
   (flags.length?'<p class="jflags">'+flags.slice(0,4).map(f=>'<span class="pill warn">'+esc(f)+'</span>').join(' ')+'</p>':'')+
   (why.length?sec('Why it fits','<ul class="jwhy">'+why.map(w=>'<li>'+esc(w)+'</li>').join('')+'</ul>'):'')+
   (sum?sec('Summary','<p class="prose">'+esc(sum)+'</p>'):'')+
   (take?sec('Local cluster take','<p class="prose">'+esc(take)+'</p>'):'')+
   (cat?sec(cat.name,(cat.definition?'<p class="note">'+esc(cat.definition)+'</p>':'')+(sub?'<p class="note"><b>'+esc(sub.name)+'.</b> '+esc(sub.definition||'')+'</p>':'')):'')+
   (note?sec('Your note','<p class="prose">'+esc(note)+'</p>'):'')+
   (u?'':'<p class="note sm">No link for this posting.</p>');
  return {title:t,sub:jobWhere(x),body:'<div class="wkj">'+body+'</div>',actions:u?'<a class="btn btn-primary" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">Open posting</a>':''}}
 // the tracker in the job sheet: one button per state (the current one on), Remove when saved, the dated trail, and the last error
 function jobTrack(key,sv,err){const cur=isObj(sv)?str(sv.state,12):'';
  return '<div class="chips jtrack" role="group" aria-label="Track this job" data-jkey="'+esc(key)+'">'+SJ_STATES.map(s=>'<button type="button"'+(cur===s?' class="on"':'')+' data-jstate="'+s+'" aria-pressed="'+(cur===s?'true':'false')+'">'+SJ_WORD[s]+'</button>').join('')+
   (cur?'<button type="button" class="jrm" data-jstate="remove">Remove</button>':'')+'</div>'+
   '<p class="note sm">'+esc(cur?(sjTrail(sv)||SJ_WORD[cur]||'Saved'):'Not saved. Pick a state to keep it on the Saved list.')+'</p>'+
   (err?'<p class="note sm jerr" role="status">'+esc(str(err,140))+'</p>':'')}
 // normalized filter state for one jobs feed: category, sub-category, metro, posted within, pay floor, search words and order. A metro filter
 // counts only when the feed has metros.
 function jobStateOf(j,facets,tax,f){const o=isObj(f)?f:{};
  const cat=facets.cats.some(c=>c.slug===str(o.cat,40))?str(o.cat,40):'all',catObj=jobCat(tax,cat);
  return {cat,catObj,sub:jobSub(catObj,o.sub)?str(o.sub,40):'all',metro:facets.metro&&JMETRO[str(o.metro,12)]?str(o.metro,12):'all',
   days:JDAYS[o.days]?String(o.days):'all',pay:JPAY.includes(+o.pay)?String(+o.pay):'all',q:jobQ(o.q),
   sort:JSORT[o.sort]?o.sort:'fit',all:jobList(j)}}
 // the list title says what the list is: "All jobs", or "AI and software · Platform and infra · Remote · Last 7 days · $150K+ · Newest"
 function jobFilterSummary(st){const p=[st.catObj?st.catObj.name:'All jobs'],s=st.catObj&&st.sub!=='all'?jobSub(st.catObj,st.sub):null;
  if(s)p.push(s.name);
  if(st.metro!=='all')p.push(JMETRO[st.metro]);
  if(st.days&&st.days!=='all')p.push(st.days==='1'?JDAYS['1']:'Last '+JDAYS[st.days]);
  if(st.pay&&st.pay!=='all')p.push(usd(+st.pay)+'+');
  if(st.q)p.push('"'+st.q+'"');
  if(st.sort==='new')p.push(JSORT.new);
  return p.join(' \u00B7 ')}
 // how many filters differ from the defaults: the count on the Filters button
 const jobActive=st=>(st.cat!=='all')+(st.sub!=='all')+(st.metro!=='all')+(!!st.days&&st.days!=='all')+(!!st.pay&&st.pay!=='all')+!!st.q+(st.sort!=='fit');
 // the Filters sheet groups, the short ones first so a phone sees them above the sheet's footer (F7): posted, order, where, pay, then the
 // search and the long category lists. A selected chip is bone on panel (ui.css), never signal.
 function jobChipGroups(j,facets,st){const g=[];
  const chip=(attr,v,on,label,n)=>'<button type="button" data-'+attr+'="'+esc(v)+'"'+(on?' class="on"':'')+' aria-pressed="'+(on?'true':'false')+'">'+esc(label)+(n!=null?' <small>'+jn(n)+'</small>':'')+'</button>';
  const days=facets.days||{},pay=facets.pay||{},dOn=st.days||'all',pOn=st.pay||'all';
  // what a chosen window or floor leaves out rides on its group's head line ("Posted · 11 with no posting date left out"), so the groups
  // below never move down past a phone's footer when a chip is tapped
  const left=isObj(st.left)?st.left:{};
  g.push({k:'days',label:'Posted',aside:jobLeftWords({date:left.date})[0]||'',html:'<div class="chips" id="jdays" role="group" aria-label="Posted">'+Object.keys(JDAYS).map(d=>chip('jdays',d,dOn===d,JDAYS[d],days[d])).join('')+chip('jdays','all',dOn==='all','Any time')+'</div>'});
  g.push({k:'sort',label:'Order',html:'<div class="seg" id="jsort" role="group" aria-label="Order">'+Object.keys(JSORT).map(k=>chip('jsort',k,st.sort===k,JSORT[k])).join('')+'</div>'});
  if(facets.metro)g.push({k:'metro',label:'Where',html:'<div class="chips" id="jmetro" role="group" aria-label="Where">'+chip('jmetro','all',st.metro==='all','Anywhere')+
   JMETRO_ORDER.map(m=>chip('jmetro',m,st.metro===m,JMETRO_CHIP[m])).join('')+'</div>'});
  const floors=JPAY.filter(p=>pay[p]>0||pOn===String(p)),rf=jobRemoteFloor(j);
  if(floors.length)g.push({k:'pay',label:'Pay at least',aside:jobLeftWords({pay:left.pay})[0]||'',html:'<div class="chips" id="jpay" role="group" aria-label="Pay at least">'+chip('jpay','all',pOn==='all','Any')+
   floors.map(p=>chip('jpay',String(p),pOn===String(p),usd(p)+'+',pay[p])).join('')+'</div>'+(rf?'<p class="note sm">'+esc(rf)+'</p>':'')});
  g.push({k:'q',label:'Search',html:'<input type="search" class="jq" name="jq" data-jq value="'+esc(st.q||'')+'" placeholder="Title or company" aria-label="Search jobs by title or company" autocomplete="off" enterkeyhint="search" maxlength="60">'});
  if(facets.cats.length){const cnt=facets.cats.find(c=>c.slug===st.cat);
   g.push({k:'cat',label:'Category',html:'<div class="chips" id="jcat" role="group" aria-label="Category">'+chip('jcat','all',st.cat==='all','All',st.all.length)+
    facets.cats.map(c=>chip('jcat',c.slug,st.cat===c.slug,c.name,c.n)).join('')+'</div>'});
   if(st.catObj){const bySub=facets.sub[st.catObj.slug]||{},subs=st.catObj.subs.filter(s=>bySub[s.slug]!=null).map(s=>({slug:s.slug,name:s.name,n:bySub[s.slug]}));
    for(const k of Object.keys(bySub))if(!subs.some(s=>s.slug===k))subs.push({slug:k,name:sentence(k),n:bySub[k]});
    if(subs.length)g.push({k:'sub',label:st.catObj.name,html:'<div class="chips" id="jsub" role="group" aria-label="'+esc(st.catObj.name)+'">'+chip('jsub','all',st.sub==='all','All',cnt?cnt.n:subs.reduce((a,b)=>a+b.n,0))+
     subs.map(s=>chip('jsub',s.slug,st.sub===s.slug,s.name,s.n)).join('')+'</div>'})}}
  return g}
// paging shared by the two Life lists: a number is how many rows to show, 'short' opens short,
// 'all' opens everything up to the cap, and no mode is the plain list. Every Show more count is
// exactly what that tap adds, and any list shown in part says "Showing N of M".
 const moreBtn=(k,label)=>'<button type="button" class="b more" data-more="'+k+'">'+esc(label)+'</button>';
 const fewerBtn=k=>'<button type="button" class="b more" data-less="1" data-more="'+k+'">Show fewer</button>';
const capNote=(shown,total)=>shown<total?'<div class="tnote">Showing '+shown+' of '+total+'</div>':'';
 function paged(mode,short,step,cap,total){const reach=Math.min(total,cap),
  n=typeof mode==='number'&&isFinite(mode)?Math.round(mode):mode==='short'?short:mode==='all'?cap:null,
  lim=n==null?cap:Math.max(short,Math.min(n,cap)),shown=Math.min(reach,lim);
  return {shown,reach,page:n!=null,fewer:n!=null&&shown>short,
   more:(k,label)=>n!=null&&reach>shown?moreBtn(k,'Show '+Math.min(step,reach-shown)+' more'+(label||'')):''}}
 // Work's own Show more and Show fewer: plain secondary buttons (signal stays for the one primary action)
 const wkMore=(k,n)=>'<button type="button" class="btn" data-more="'+k+'">Show '+jn(n)+' more</button>';
 const wkFewer=k=>'<button type="button" class="btn btn-quiet" data-less="1" data-more="'+k+'">Show fewer</button>';
 // the Filters button and dialog a Work page owns. The shell's [data-open-fbar] opens #fb-<id>; on L the shell moves the button into the bar
 // and the emptied row collapses. The dialog is not .fbar-panel, so it never shows inline: on every class it is a sheet.
 // the same button DeckUI.filters draws (mark, word, count). The word is its own span so the L bar can show only the mark and the count
 // (ui.css #tact); the spoken name starts with the word and carries the count
 const wkFbtn=(id,n)=>'<button type="button" class="btn fbar-open" data-open-fbar="'+id+'" aria-haspopup="dialog" aria-label="Filters'+(n?', '+n+' set':'')+'"><svg class="i" aria-hidden="true"><use href="#i-filter"/></svg><span class="fbw">Filters</span>'+(n?' <span class="cnt">'+n+'</span>':'')+'</button>';
 const wkDialog=(id,body,actions)=>'<dialog class="sheet wkdlg" id="fb-'+id+'" aria-label="Filters"><header class="sheet-h"><div><h2>Filters</h2></div><button type="button" class="sheet-x" aria-label="Close" data-close><svg class="i" aria-hidden="true"><use href="#i-x"/></svg></button></header>'+
  '<div class="sheet-b"><div class="wkf" data-wkf="'+id+'">'+body+'</div></div><footer class="sheet-a">'+actions+'</footer></dialog>';
 // the whole Jobs page (work/jobs), three parts the glue can swap one by one: [data-wk="ctl"] one control row (whose search exactly as before,
 // Saved, Filters), the Filters dialog, and [data-wk="body"] the list in a TV .board across the page, Market and By category under it.
 // The list has a title only when filters narrow it. P keeps the picker and Filters on one row (Saved moves into the sheet); L moves the
 // picker and Saved into the sheet (Main 2026-11-14). A feed missing for anyone but the owner is a calm "not set up yet", never red.
 // opt: {person, saved (the GET /api/saved-jobs answer; undefined: no stars, no Saved chip), savedView, page, insight}
 function jobs(j,filter,now,opt){const o=isObj(opt)?opt:{},who=jobPerson(o.person),me=who.id==='tanner',svOn=!!(o.savedView&&o.saved!==undefined),bad=state(j)=='bad';
  const facets=jobFacets(j,now),st=jobStateOf(j,facets,jobTax(j),filter),n=jobActive(st),list=bad?[]:jobFilter(j,st,now);
  st.left=bad?{pay:0,date:0}:jobLeftOut(j,st,now);const lw=jobLeftWords(st.left);
  const ctl='<div class="fbar jfbar" data-wk="ctl"><div class="fbar-top jctl">'+jobPersonRow(who.id,o.saved,svOn)+wkFbtn('jobs',n)+'</div></div>';
  const svN=isObj(o.saved)&&Array.isArray(o.saved.items)?o.saved.items.length:null;
  const sheet=wkDialog('jobs','<section class="sh-sec wk-who"><h3>Whose search</h3>'+jobPersonRow(who.id,undefined,false).replace(' id="jperson"','')+'</section>'+
   (o.saved===undefined?'':'<section class="sh-sec wk-sv"><h3>Saved</h3><div class="chips"><button type="button" data-saved="1"'+(svOn?' class="on"':'')+' aria-pressed="'+svOn+'">'+(svOn?'Showing saved':'Saved jobs')+(svN!=null?' <small>'+jn(svN)+'</small>':'')+'</button></div></section>')+
   (bad||svOn?'':jobChipGroups(j,facets,st).map(g=>'<section class="sh-sec"><h3>'+esc(g.label)+(g.aside?'<small> \u00B7 '+esc(g.aside)+'</small>':'')+'</h3>'+g.html+'</section>').join('')),
   (bad||svOn?'':'<button type="button" class="btn" data-jclear>Clear</button>')+'<button type="button" class="btn btn-primary" data-close>'+(svOn?'Show saved':bad?'Close':'Show '+jn(list.length)+(list.length===1?' job':' jobs'))+'</button>');
  const page=b=>ctl+sheet+'<div data-wk="body">'+b+'</div>';
  if(svOn)return page(jobSaved(j,o.saved,who));
  if(bad)return page(me?down('Jobs feed',j,'jobs'):empty({title:'No jobs feed for '+who.label+' yet',line:'Matches for '+who.label+' show up here after '+who.pron+' first search runs. It checks again on its own.'}));
  if(!st.all.length)return page(empty({title:me?'No job listings yet':'No jobs for '+who.label+' yet',line:'New matches show up after the next search.'}));
  const p=num(o.page),pg=paged(p==null||p<=JOB_SHORT?'short':p,JOB_SHORT,JOB_STEP,JOB_CAP,list.length),shown=list.slice(0,pg.shown);
  const idx=o.saved!==undefined?sjIndex(o.saved):null,more=(pg.reach>pg.shown?wkMore('jobs',Math.min(JOB_STEP,pg.reach-pg.shown)):'')+(pg.fewer?wkFewer('jobs'):'');
  const body=shown.length?'<div class="flist jlist">'+shown.map(x=>jobRow(x,idx?(idx.get(jobKey(x))||null):undefined)).join('')+'</div>'+
    '<p class="note sm jcount" role="status">'+esc(['Showing '+jn(pg.shown)+' of '+jn(list.length)].concat(lw).join(' \u00B7 '))+'</p>'+(more?'<div class="more-row">'+more+'</div>':''):
   empty({title:'No jobs match these filters',line:'Loosen a filter to see more.'+(lw.length?' '+lw.join(', ')+'.':''),action:'<button type="button" class="btn" data-jclear>Clear filters</button>'});
  const side=jobMarket(j,st.cat==='all'?'':st.cat,st.catObj?st.catObj.name:'',o)+jobCats(j,now);
  return page(jobProvisional(j)+'<div class="g12 jgrid"><section class="sect jmain board">'+(n?'<h2 class="secttl"><span>'+esc(jobFilterSummary(st))+'</span></h2>':'')+body+'</section>'+
   (side?'<div class="jside">'+side+'</div>':'')+'</div>')}
 // a person whose role areas are still a first draft (profile.provisional true in the feed) gets one calm line saying so
 const jobProvisional=j=>isObj(j)&&isObj(j.profile)&&j.profile.provisional===true?'<p class="note sm jprov">Role areas are a first draft and may change.</p>':'';
// ---- Work > Gigs: the owner's freelance gigs from gigs.json, best fit first, twelve before Show more (whole rows at one, two, three, four or six
// columns). A pitch is a draft in a closed <details>; nothing here sends or bids. Where the gigs came from lives in the Data sheet. ----
 const GIG_SHORT=12,GIG_STEP=24,GIG_CAP=500,GIG_KIND={gig:'Gigs',rfp:'RFPs',contract:'Contracts'},GIG_UNIT={hour:'/hr',year:'/yr',fixed:' fixed'};
 const gigList=g=>uniq(arr(isObj(g)&&(Array.isArray(g.gigs)?g.gigs:g.listings)).filter(isObj),x=>safeUrl(str(x.url,400))||(str(x.title,140)+'|'+str(x.site,40)).toLowerCase());
 // the feed's pay text is shown whole and wraps: a cut at a fixed length ended mid-figure ("(GBP 5,000 to GB"), so there is no cut.
 // A currency code stays on its figure ("GBP 5,000" never breaks after "GBP"). A feed's placeholder ("not stated") is no pay: no pay line.
 function gigPay(x){const p=x&&typeof x.pay==='string'?x.pay.trim().replace(/\b([A-Z]{3}) (?=\d)/g,'$1\u00A0'):'';if(p&&!/^(not stated|unknown|n\/a)$/i.test(p))return p;const lo=num(x&&x.pay_min),hi=num(x&&x.pay_max),u=GIG_UNIT[str(x&&x.pay_unit,8)]||'';
  if(lo==null&&hi==null)return '';const m=n=>n<1000?'$'+Math.round(n):usd(n);return (lo!=null&&hi!=null&&lo!==hi?m(lo)+' to '+m(hi):m(hi!=null?hi:lo))+u}
 function gigFilter(g,f){const st=isObj(f)?f:{},k=GIG_KIND[st.kind]?st.kind:'all',list=gigList(g).filter(x=>k==='all'||str(x.kind,12)===k);
  return st.sort==='new'?list.slice().sort((a,b)=>(toEpoch(b.posted_at)||toEpoch(b.t)||0)-(toEpoch(a.posted_at)||toEpoch(a.t)||0)):list.slice().sort((a,b)=>(num(b.fit)||0)-(num(a.fit)||0))}
// one gig as its row reads it: title, kind, category and its day, pay as its own value (null when unstated), an hourly estimate when the
// pay is not hourly, why it fits and the fit score. No site and no age on the row. The day says what it is, as the Jobs sheet does:
// "Posted Nov 12" only for a date the source gave (posted_basis source), "First seen Nov 12" when the search dates it by first sight
// (first_seen, SeeData D15), the bare day when the feed does not say which. No date, no date words.
 function gigRowModel(x){const pay=gigPay(x),est=num(x&&x.est_hourly),kind=GIG_KIND[str(x&&x.kind,12)],d=x&&x.posted_at!=null?sjDay(x.posted_at):'',
  dw=x&&x.posted_basis==='source'?'Posted ':x&&x.posted_basis==='first_seen'?'First seen ':'';
  return {key:str(x&&x.id,40)||safeUrl(str(x&&x.url,400))||str(x&&x.title,140),title:str(x&&x.title,120)||'Untitled gig',
   what:[kind?kind.replace(/s$/,''):'',sentence(str(x&&x.category,30)).replace(/\bai\b/i,'AI'),d?dw+d:''].filter(Boolean).join(' \u00B7 '),pay:pay||null,
   est:est!=null&&!/\/hr/.test(pay)?'About $'+Math.round(est)+'/hr':null,fit:num(x&&x.fit),url:safeUrl(str(x&&x.url,400)),
   why:arr(x&&x.why).map(w=>str(w,90)).filter(Boolean).slice(0,2).join(' \u00B7 '),below:!!x&&x.floor_ok===false,pitch:x&&typeof x.pitch==='string'?x.pitch.trim().slice(0,2000):''}}
 function gigRow(x){const m=gigRowModel(x);
  return '<div class="gitem" data-key="'+esc(m.key)+'"><div class="frow"><span class="fl"><b>'+esc(m.title)+'</b>'+(m.what?'<small>'+esc(m.what)+'</small>':'')+
   (m.pay||m.est?'<span class="jpay">'+esc(m.pay||'')+(m.est?'<small>'+esc(m.est)+'</small>':'')+'</span>':'')+
   (m.why?'<small>'+esc(m.why)+'</small>':'')+(m.below?'<small class="jnote">Below your pay floor</small>':'')+'</span>'+
   (m.fit==null?'':'<span class="fr"><b>'+Math.round(m.fit)+'</b><small>Fit</small></span>')+
   (m.url?'<a class="jopen" href="'+esc(m.url)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc('Open gig: '+m.title)+'">'+LK+'</a>':'')+'</div>'+
   (m.pitch?'<details class="gpitch"><summary tabindex="0">Draft pitch</summary><div class="gpt">'+esc(m.pitch)+'</div><p class="note sm">Draft only. Nothing is sent from the deck.</p></details>':'')+'</div>'}
// the whole Gigs page (work/gigs): one control row (kind chips, only with more than one kind, and a Newest toggle), the Filters dialog that
// carries the same choices on L (where the shell puts its button in the bar), then At a glance first, as every page puts its strip first,
// and the list in a TV .board across the page. Under the list the strip crossed the fold of a 2470x1286 window (SeeWs4 W4-11).
 function gigs(g,now,opt){const o=isObj(opt)?opt:{};
  // a missing or broken gigs feed is a fault, in the body as in the header's mark: "Gigs are not reporting", one Try again (SeeStates E10)
  if(state(g)=='bad')return down('Gigs feed',g,'gigs');
  const all=gigList(g),kinds={};for(const x of all){const k=str(x.kind,12);if(GIG_KIND[k])kinds[k]=(kinds[k]||0)+1}
  if(!all.length)return empty({title:'No gigs yet',line:'The gig search ran and found nothing that fits. It checks again on its own.'});
  const kind=GIG_KIND[o.kind]&&kinds[o.kind]?o.kind:'all',sort=o.sort==='new'?'new':'fit',list=gigFilter(g,{kind,sort}),
   n=num(o.page)!=null&&num(o.page)>GIG_SHORT?Math.min(Math.round(num(o.page)),GIG_CAP):GIG_SHORT,shown=list.slice(0,n);
  const on=b=>(b?' class="on"':'')+' aria-pressed="'+(b?'true':'false')+'"';
  const kindBtns=Object.keys(kinds).length>1?'<button type="button" data-gkind="all"'+on(kind==='all')+'>All <small>'+jn(all.length)+'</small></button>'+
    Object.keys(GIG_KIND).filter(k=>kinds[k]).map(k=>'<button type="button" data-gkind="'+k+'"'+on(kind===k)+'>'+GIG_KIND[k]+' <small>'+jn(kinds[k])+'</small></button>').join(''):'';
  const newest='<button type="button" class="gnew'+(sort==='new'?' on':'')+'" data-gsort="'+(sort==='new'?'fit':'new')+'" aria-pressed="'+(sort==='new')+'">Newest</button>';
  const ctl='<div class="fbar gfbar" data-wk="ctl"><div class="fbar-top gctl">'+wkFbtn('gigs',(kind!=='all')+(sort==='new'))+'<div class="chips" id="gkind" role="group" aria-label="Kind and order">'+kindBtns+newest+'</div></div></div>';
  const sheet=wkDialog('gigs',(kindBtns?'<section class="sh-sec"><h3>Kind</h3><div class="chips">'+kindBtns+'</div></section>':'')+
   '<section class="sh-sec"><h3>Order</h3><div class="seg" role="group" aria-label="Order"><button type="button" data-gsort="fit"'+on(sort==='fit')+'>Best fit</button><button type="button" data-gsort="new"'+on(sort==='new')+'>Newest</button></div></section>',
   '<button type="button" class="btn btn-primary" data-close>Show '+jn(list.length)+(list.length===1?' gig':' gigs')+'</button>');
  const more=(list.length>shown.length?wkMore('gigs',Math.min(GIG_STEP,list.length-shown.length)):'')+(shown.length>GIG_SHORT?wkFewer('gigs'):'');
  const day=(now==null?Date.now():now)/1000-86400,fresh=all.filter(x=>(toEpoch(x.t)||0)>=day).length,top=all.filter(x=>(num(x.fit)||0)>=80).length,pitched=all.filter(x=>typeof x.pitch==='string'&&x.pitch.trim()).length;
  // four figures are a strip of four tiles (two by two on P). The strip names itself to a screen reader; the page needs no heading for it.
  const kv=[['Gigs found',all.length],['Fit 80 or better',top],['New in the last day',fresh],['Draft pitches ready',pitched]];
  const glance='<section class="sect gglance">'+V3.strip(kv.map(r=>V3.tile({label:r[0],value:jn(r[1])})),{label:'At a glance'})+'</section>';
  return ctl+sheet+'<div data-wk="body" class="gbody">'+glance+'<div class="g12 jgrid"><section class="sect jmain board"><div class="flist glist">'+shown.map(gigRow).join('')+'</div>'+
   '<p class="note sm jcount" role="status">Showing '+jn(shown.length)+' of '+jn(list.length)+'</p>'+(more?'<div class="more-row">'+more+'</div>':'')+'</section></div></div>'}
 // the Saved list: every posting this person saved, newest change first, still here after it leaves the live feed. Rows open the sheet (data-sj).
 function jobSaved(j,s,who){const sec=b=>'<section class="sect jmain"><h2 class="secttl"><span>Saved</span></h2>'+b+'</section>';
  if(!isObj(s)||s.error)return sec(empty({k:'bad',title:'Saved jobs are not reporting',line:'The saved list could not be read. Try again.',retry:'jobs',diag:isObj(s)?[str(s.error,100)]:['no answer']}));
  const items=sjItems(s).slice().sort((a,b)=>(num(b.updated_at)||0)-(num(a.updated_at)||0)),live=new Map(jobList(j).map(x=>[jobKey(x),x])),cnt={};
  for(const x of items){const k=SJ_STATES.includes(x.state)?x.state:'saved';cnt[k]=(cnt[k]||0)+1}
  const sum=SJ_STATES.filter(k=>cnt[k]).map(k=>jn(cnt[k])+' '+SJ_WORD[k].toLowerCase()).join(' \u00B7 ');
  const rows=items.map(x=>{const k=str(x.key,200),l=live.get(k),t=str(x.title,140)||'Job',u=safeUrl(str(x.url,400)||(l&&l.url)),st=SJ_STATES.includes(x.state)?x.state:'saved';
   return '<div class="frow jitem" data-key="'+esc(k)+'"><button type="button" class="jrow" data-sj="'+esc(k)+'" aria-label="'+esc('Saved job: '+t)+'"><span class="fl"><b>'+esc(t)+'</b>'+(str(x.company,80)?'<small>'+esc(str(x.company,80))+'</small>':'')+
    '<small>'+esc(sjTrail(x)||SJ_WORD[st])+'</small>'+(l?'':'<small class="jnote">No longer in the live feed</small>')+'</span>'+
    '<span class="fr"><span class="pill">'+esc(SJ_WORD[st])+'</span></span></button>'+
    (u?'<a class="jopen" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc('Open posting: '+t)+'">'+LK+'</a>':'')+'</div>'}).join('');
  return sec(items.length?'<p class="note sm">'+esc(sum)+'</p><div class="flist jlist">'+rows+'</div>':empty({title:'Nothing saved for '+who.label+' yet',line:'Tap the star on a job to keep it here with its dates.'}))}
 // ---- the Data sheets for Work (DeckUI.dataSheet input): sources, method and setup, everything the pages no longer print ----
 const SITE_NAME={hn_hiring:'Hacker News hiring',ycombinator:'Y Combinator',usajobs:'USAJOBS',governmentjobs:'GovernmentJobs',linkedin:'LinkedIn',ziprecruiter:'ZipRecruiter',
  smartrecruiters:'SmartRecruiters',weworkremotely:'We Work Remotely',wwr:'We Work Remotely',remoteok:'Remote OK',teamworkonline:'TeamWork Online',github_bounties:'GitHub bounties',
  'freelancer-api':'Freelancer','uk-contracts-finder':'UK Contracts Finder',python_jobs:'Python jobs',sam:'SAM.gov'};
 const siteName=s=>{const k=str(s,40);return SITE_NAME[k]||friendly(k)};
 // the interest profile is still reading the owner's own sources: how many parts and their size, never their contents
 function jobProfileSetup(prof){const p=isObj(prof)?prof:{},pend=arr(p.pending),n=pend.length;
  if(!n&&p.partial!==true)return null;
  const bytes=pend.reduce((a,x)=>a+(num(isObj(x)?x.bytes:null)||0),0),gb=bytes>0?bytes/1073741824:null;
  return {name:'Your interest profile',line:n?n+' takeout part'+(n===1?'':'s')+' still loading'+(gb!=null?' ('+gb.toFixed(0)+' GB)':''):'Still reading your sources',state:'building'}}
 function jobsData(j,opt){const o=isObj(opt)?opt:{},who=jobPerson(o.person),fs=state(j),feedName='Job search for '+who.label;
  if(fs==='bad')return {sources:[{name:feedName,gives:'No listings read',state:who.id==='tanner'?'unavailable':'never'}],method:[],setup:[]};
  const list=jobList(j),k=fs==='stale'?'stale':'ok',t=j.t;
  const sources=[{name:feedName,gives:jn(list.length)+(list.length===1?' listing':' listings'),asOf:t,state:k}]
   .concat(jobSites(j).map(s=>({name:siteName(s.site),gives:jn(s.n)+(s.n===1?' listing':' listings'),asOf:t,state:k})))
   .concat(arr(j.errors).filter(isObj).map(e=>({name:siteName(e.source)||'A job site',gives:'Did not answer this run',asOf:t,state:'unavailable'})));
  const ins=isObj(o.insight)?o.insight:null;
  if(ins)sources.push({name:'Local cluster read',gives:str(ins.model,60)?'Model '+str(ins.model,60):'Model not reported',asOf:ins.t,state:'ok'});
  const r=isObj(j.rules)?j.rules:{},method=[['Best fit','The search\u2019s own order: fit inside each category, categories mixed'],['Newest','By posted date; a first-seen date counts when the site gives none'],['Fit','0 to 100, scored by the search'],
   ['Posted','Last 24 hours or 7 days by posting date; a first-seen date never counts, and the list says how many that leaves out'],['Pay at least','The top of the stated range; a job with no stated pay is left out, and the list says how many']];
  const metros=arr(r.in_person_metros).map(m=>JMETRO[str(m,12)]).filter(Boolean);
  if(metros.length)method.push(['In person',metros.join(', ')]);
  if(num(r.remote_min_pay)>0)method.push(['Remote','Only with pay of '+usd(r.remote_min_pay)+' or more']);
  if(/2080/.test(str(r.pay_normalization,80)))method.push(['Pay','Yearly; hourly pay times 2,080']);
  const setup=arr(j.disabled).filter(isObj).map(d=>({name:siteName(d.source)||'A job site',line:'Turned off for now',state:'blocked'})),p=jobProfileSetup(o.profile);
  if(p)setup.push(p);
  return {sources,method,setup}}
 function gigsData(g){const fs=state(g);
  if(fs==='bad')return {sources:[{name:'Gig search',gives:'No gigs read',state:'unavailable'}],method:[],setup:[]};
  const k=fs==='stale'?'stale':'ok',t=g.t,n=gigList(g).length;
  const by=isObj(g.by_site)?Object.keys(g.by_site).map(s=>[s,num(g.by_site[s])]).filter(r=>r[1]!=null&&r[1]>0).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])):[];
  const sources=[{name:'Gig search',gives:jn(n)+(n===1?' gig':' gigs'),asOf:t,state:k}]
   .concat(by.map(r=>({name:siteName(r[0]),gives:jn(r[1])+(r[1]===1?' gig':' gigs'),asOf:t,state:k})))
   .concat(arr(g.errors).filter(isObj).map(e=>({name:siteName(e.source)||'A gig site',gives:'Did not answer this run',asOf:t,state:'unavailable'})));
  const r=isObj(g.rules)?g.rules:{},sc=num(g.sites_checked),sr=num(g.sites_registry),method=[];
  if(sc!=null)method.push(['Sites',jn(sc)+(sr!=null?' of '+jn(sr):'')+' checked this run']);
  method.push(['Fit','0 to 100 from local rules']);
  const fh=num(r.floor_hourly_usd),ff=num(r.floor_fixed_usd);
  if(fh!=null||ff!=null)method.push(['Pay floor',[fh!=null?'$'+jn(fh)+'/hr':'',ff!=null?'$'+jn(ff)+' for a fixed job':''].filter(Boolean).join(', or ')]);
  method.push(['Pitches','Drafts only. The deck never sends, bids or signs up.']);
  return {sources,method,setup:[]}}
// Gmail links only: the Today reply-drafts row opens mail.google.com and nothing else
const gmailUrl=u=>/^https:\/\/mail\.google\.com\/mail\/u\/\d\/#[a-z]+(\/[\w-]+)?$/.test(u)?u:'';
 const hockeyLink=g=>isObj(g)&&typeof g.gc==='string'&&g.gc.startsWith('/gamecenter/')?'https://www.nhl.com'+g.gc:'';
 // Today's one-tile source summary under its homes rows. The full per-source records block (summary, state and ZIP controls,
 // per-source national price records) left the deck on 2026-11-01 at the owner's order; Markets > Housing shows the owner's markets instead.
 function housingSources(r,now){
  const f=isObj(r&&r.market)&&isObj(r.market.feed_sources)?r.market.feed_sources:null;
  if(!f)return '';
  const sources=arr(f.sources).filter(isObj),ok=sources.filter(s=>s.status==='ok'),listing=ok.filter(s=>s.kind==='listings').length;
  return tile('Housing source adapters',sources.length+' configured \u00B7 '+ok.length+' responding',
   listing+' additional listing feeds \u00B7 '+(ok.length-listing)+' enrichment sources \u00B7 checked '+ago(f.checked_at,now),ok.length?'ok':'stale')}
 // ---- Markets > Housing and Markets > Commercial (owner order 2026-11-11). National ZIP data from /api/housing/*, the budget from
 // /api/housing/profile, owner markets, homes and commercial listings from the realestate feed. Data and analytics only: labels, numbers,
 // units, source names, dates, coverage counts and one-line unavailable reasons. A missing value prints "--", never zero.
 const TIER_WORD={home:'Home ZIP',south_oc:'South OC',oc:'Orange County',la:'LA County',sd:'San Diego',us:'United States'};
 const mileage=v=>{const n=num(v);if(n==null)return '--';if(n>=1e6)return '$'+(n/1e6).toFixed(2)+'M';if(n>=1e3)return '$'+Math.round(n/1e3)+'K';return '$'+Math.round(n)};
 const bn=v=>{const n=num(v);if(n==null)return '--';return n>=1000?'$'+(n/1000).toFixed(2)+'T':'$'+Math.round(n)+'B'};
 const signed=v=>{const n=num(v);return n==null?'':' '+(n>0?'+':'')+n.toFixed(1)+'%'};
 const day=v=>str(v,10)||'no date';
 const hcnt=v=>{const n=num(v);return n==null?'--':String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,',')};
 // counts past a million read 15.4M, past a billion 1.3B (kilo stops at thousands)
 const big=v=>{const n=num(v);return n==null?'--':n>=1e9?(n/1e9).toFixed(1)+'B':n>=1e6?(n/1e6).toFixed(1)+'M':kilo(n)};
 const sect=(t,r)=>'<div class="secttl"><span>'+esc(t)+'</span><span>'+esc(r||'')+'</span></div>';
 const areaLine=(a)=>{
  const zhvi=isObj(a&&a.zhvi)?a.zhvi:null,parts=[];
  if(isObj(a&&a.inventory))parts.push('inv '+hcnt(a.inventory.value));
  else if(num(a&&a.active_listings)!=null)parts.push('inv '+cnt(a.active_listings));
  const list=isObj(a&&a.list_price)?a.list_price.value:num(a&&a.realtor_list_price);
  if(num(list)!=null)parts.push('list '+mileage(list));
  if(isObj(a&&a.sale_price))parts.push('sale '+mileage(a.sale_price.value));
  if(isObj(a&&a.days_to_pending))parts.push(fmt(a.days_to_pending.value)+'d to pending');
  else if(num(a&&a.days_on_market)!=null)parts.push(fmt(a.days_on_market)+'d on market');
  const right=zhvi?'<b>'+esc(mileage(zhvi.value))+'</b><small>ZHVI'+esc(signed(zhvi.yoy_pct))+(zhvi.yoy_pct!=null?' 1y':'')+'</small>':'<b>--</b><small>no ZHVI</small>';
  return '<div class="hm-area frow"><span class="fl"><b>'+esc(str(a&&a.name,40)||'area')+'<em class="hm-tier">'+esc((TIER_WORD[a&&a.tier]||'')+(a&&a.zip?' '+a.zip:''))+'</em></b>'+
   '<small>'+esc(parts.join(' \u00B7 ')||'no public numbers for this area')+'</small>'+
   '<small class="hm-asof">'+(zhvi?'Zillow ZHVI as of '+esc(day(zhvi.as_of)):'as of unavailable')+'</small></span><span class="fr">'+right+'</span></div>'};
 // Feeds written before the area series existed carry one headline median for the owner's area: that number with its publisher and date.
 const legacyMarkets=(m,now)=>{
  const lp=num(m&&m.median_list_price),rent=num(m&&m.median_rent),area=str(m&&m.area,40),src=str(m&&m.source,20),at=toEpoch(m&&m.at);
  if(lp==null&&rent==null)return '';
  const parts=[area?esc(area):'',lp!=null?'median list '+mileage(lp):'',rent!=null?'median rent '+usd(rent):'',src?esc(src):''].filter(Boolean).join(' \u00B7 ');
  return '<div class="hm-area frow"><span class="fl"><b>'+esc(area||'Median price')+'</b><small>'+parts+'</small>'+
   '<small class="hm-asof">'+(at!=null?'as of '+esc(ago(at,now)):'as of unavailable')+'</small></span>'+
   '<span class="fr"><b>'+esc(mileage(lp))+'</b><small>median list</small></span></div>'};
 // the owner's areas (Dana Point, South OC, then OC, LA, SD); the United States scope shows the national row only
 function marketAreas(m,filter,now){
  const res=isObj(m&&m.residential)?m.residential:null;
  if(!res||!arr(res.areas).length){const leg=legacyMarkets(m,now==null?Date.now()/1000:now);
   return {html:leg||tile('Your markets','No series yet','no public market series in the feed yet','stale'),note:''}}
  const areas=arr(res.areas).filter(isObj),shown=filter&&filter.scope==='us'?areas.filter(a=>a.tier==='us'):areas;
  return {html:'<div class="hm-list">'+shown.map(areaLine).join('')+'</div><div class="tnote">Zillow Research: value, inventory, list and sale price \u00B7 Realtor.com: days on market</div>',note:''}};
 function marketRates(m){
  const mo=isObj(m&&m.mortgage)?m.mortgage:{},r30=isObj(mo.rate_30y)?mo.rate_30y:null,r15=isObj(mo.rate_15y)?mo.rate_15y:null;
  if(!r30&&!r15)return tile('Mortgage rates','No reading','FRED did not answer','bad');
  return '<div class="hm-rates">'+mini('30y fixed',r30?fmt(r30.value,2,'%'):'No reading','FRED '+day(r30&&r30.as_of),r30?'ok':'bad')+
   mini('15y fixed',r15?fmt(r15.value,2,'%'):'No reading','FRED '+day(r15&&r15.as_of),r15?'ok':'bad')+'</div>'};
 // ---- broker terms: GRM, $/SF, listing detail lines and a single-unit pro forma from one ZIP's medians. The assumptions are named and printed beside the numbers.
 const pfPos=v=>{const n=num(v);return n!=null&&n>0?n:null};
// a size under 100 SF is an acreage or a unit slip (Redfin lands print 0.25 and 0.78 in sqft): unknown, never "0 SF" or "$21,666,667/SF"
const SQFT_MIN=100;
const listSqft=v=>{const n=pfPos(v);return n!=null&&n>=SQFT_MIN?n:null};
const hPsf=(price,sqft)=>{const p=pfPos(price),s=listSqft(sqft);if(p==null||s==null)return null;const v=Math.round(p/s);return v>0?v:null};
 // one listing's detail line as plain text (row() escapes it); a missing value leaves its part out
const hListMeta=(x,opt)=>{x=isObj(x)?x:{};const b=pfPos(x.baths),psf=isBid(x)?null:hPsf(listPrice(x),x.sqft);
 return [opt&&opt.type===false?'':str(x.type,20),isBid(x)?str(x.sale_kind,30)||str(x.kind,30):'',pfPos(x.beds)!=null?fmt(x.beds)+' BR':'',b!=null?fmt(b,b%1?1:0)+' BA':'',listSqft(x.sqft)!=null?hcnt(x.sqft)+' SF':'',psf!=null?'$'+hcnt(psf)+'/SF':'',pfPos(x.cap_rate)!=null?'cap rate '+fmt(x.cap_rate,1,'%'):''].filter(Boolean).join(' \u00B7 ')};

 // ---- homes and commercial listings from the realestate feed, with their filters.
 // f = {within: price <= budget, city, htype (homes), ctype (commercial)}; a listing with no price is never within a budget, one with no type never matches a chosen type.
// a listing's price is known only when it is plausible and explicitly reported as USD; never assume a missing currency is dollars.
// A sale under $10,000 is a rate or a parse slip (a collector row asks $162 for a 35,000 SF building), so it reads as unknown, never "$162" and never "$0/SF".
const LIST_PRICE_MIN=10000;
const listPrice=x=>{const c=str(x&&x.currency,8);if(!c||c.toUpperCase()!=='USD')return null;const p=num(x&&x.price);return p!=null&&p>=LIST_PRICE_MIN?p:null};
// a listing date is usable only when it is a real moment in the past: 0, a negative and a date in the future (a bad parse or a clock skew over five minutes) read as unknown, never "20770 d ago" or "just now"
const listedEpoch=(t,now)=>{const x=toEpoch(t);return x!=null&&x>0&&x<=now/1000+300?x:null};
const listedAgo=(t,now)=>listedEpoch(t,now)==null?'time unknown':ago(t,now);
// a row the collector could not refresh says stale; a fresh row never does (only stale === true counts)
const listStale=x=>(isObj(x)&&x.stale===true?' \u00B7 stale':'')+(isHeld(x)?' \u00B7 sale held':'');
// an auction.com row carries the auction's starting bid in `price`: a bid is not an asking price, so it is labelled, has no price per square foot and never counts as within a budget (the collector keeps it out of the market median too)
// a public-sector row (LA County tax sale, surplus land, state surplus: the collector tags each with `kind`) carries the sale's minimum bid the same way (cre_deals.py auction_row)
const isBid=x=>isObj(x)&&(str(x.source,40).toLowerCase()==='auction.com'||x.auction_at!=null||str(x.kind,40)!=='');
// a sale the collector says was held is over: its row says so and never reads as open for sale
const isHeld=x=>isObj(x)&&str(x.sale_status,20).toLowerCase()==='held';
// a commercial row with sale_or_lease "lease" carries its rent in rent_text and no sale price: it reads "For lease <rent>", never a for-sale row with an unknown price
const isLease=x=>isObj(x)&&str(x.sale_or_lease,10).toLowerCase()==='lease';
const listPriceText=x=>{if(isLease(x)){const t=str(x.rent_text,40);return 'For lease '+(t||'(rent not listed)')}const p=listPrice(x);return p!=null&&isBid(x)?(str(x.kind,40)?'Minimum bid ':'Opening bid ')+usd(p):usd(p)};
// one row per listing: the same home or lot can come back twice (a repeated card, two searches, two sources). Homes, commercial, the ZIP sheet and the Today card share these keys.
// A listing is a repeat when its url (fragment dropped, query kept: a broker index page shares one path across many listings and the query names the listing) or its normalised address (with city, price and the size fields) was already seen. With neither, the whole row is the key, so two different unpriced rows never collapse into one.
const addrNorm=s=>str(s,200).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
// the same street address spelled two ways ("Drive" and "Dr", "Unit 4" and "#4", "North" and "N") is one address
const ADDR_WORD={street:'st',drive:'dr',avenue:'ave',boulevard:'blvd',road:'rd',lane:'ln',court:'ct',place:'pl',circle:'cir',terrace:'ter',highway:'hwy',parkway:'pkwy',
 north:'n',south:'s',east:'e',west:'w',northeast:'ne',northwest:'nw',southeast:'se',southwest:'sw',apartment:'unit',apt:'unit',suite:'unit',ste:'unit',space:'unit',spc:'unit'};
// a source may print the unit in front of the street ("E110-24901 Dana Point Harbor Dr", "915-#C Buena Vis"): the unit moves behind the street, where the other sources print it. A plain number range ("1701-1721 N Main St") has no letters in front of its dash and no #, so it stays whole.
const addrUnitFirst=s=>{let m=/^([a-z]{1,2}-?\d{1,4}[a-z]?)\s*-\s*(\d+\s+\S.*)$/i.exec(s)||/^(\d+)\s*-\s*(#\s*[a-z0-9]{1,4})\s+(\S.*)$/i.exec(s);
 return !m?s:m.length===4?m[1]+' '+m[3]+' '+m[2]:m[2]+' '+m[1]};
const addrKey=s=>addrNorm(addrUnitFirst(str(s,200)).replace(/#/g,' unit ')).split(' ').map(w=>ADDR_WORD[w]||w).join(' ');
// a unit the address prints after its street, as a second comma part: "Unit 4", "#5", "Suite 200", "Bldg A", "Space 2", "E110", "A-202". Two units at one street stay two listings; a zip (CA92629) is no unit.
const ADDR_UNIT_RE=/^(#|unit\b|apt\b|apartment\b|suite\b|ste\b|bldg\b|building\b|space\b|spc\b|lot\b|pad\b|bay\b|fl\b|floor\b|rm\b|room\b|[a-z]{1,2}-?\d{1,4}[a-z]?$)/i;
// one feed row's address as {street, city}. A source may print "1 A St, Dana Point, CA 92629" in the address and leave the city field empty (or the reverse): the street part keys the row, the city comes from the city field, else from the address tail. State and ZIP parts are not a city.
// A city field may carry its state ("San Clemente, CA"): only the part before the first comma names the city. An address printed with no commas ("1 A St Dana Point CA 92629") loses its trailing ZIP, state and the row's own city, as long as a street of two words or more is left.
const addrSplit=x=>{const p=str(x&&x.addr,200).split(',').map(t=>t.trim()).filter(Boolean);let street=p.shift()||'';
 if(p.length&&ADDR_UNIT_RE.test(p[0]))street+=' '+p.shift();
 const tail=p.length&&!/^([a-z]{2}(\s+\d{5}(-\d{4})?)?|\d{5}(-\d{4})?)$/i.test(p[0])?p[0]:'',cityRaw=str(x&&x.city,80).split(',',1)[0];
 let key=addrKey(street);const words=k=>k.split(' ').length,zip=/ \d{5}( \d{4})?$/;
 if(zip.test(key)&&words(key.replace(zip,''))>1){key=key.replace(zip,'');if(/ [a-z]{2}$/.test(key)&&words(key.replace(/ [a-z]{2}$/,''))>1)key=key.replace(/ [a-z]{2}$/,'')}
 const ck=addrKey(cityRaw);if(ck&&key.endsWith(' '+ck)&&words(key.slice(0,key.length-ck.length-1))>1)key=key.slice(0,key.length-ck.length-1);
 return {street:key,city:addrNorm(cityRaw)||addrNorm(tail)}};
const listingKeys=x=>{const k=[],url=str(x&&x.url,1000),a=addrSplit(x).street;
if(url)k.push('url:'+url.split('#',1)[0]);
if(a)k.push('addr:'+a);
 if(!k.length)k.push('row:'+JSON.stringify([addrNorm(x&&x.city),x&&x.type,x&&x.beds,x&&x.baths,x&&x.sqft,x&&x.price,x&&x.source]));
 return k};
// a street address is a repeat when the same street was seen in the same city, or when either side has no city (a source that omits it cannot say it is a different place).
// A shared url is a repeat only when the addresses do not name two streets: a broker index page gives many listings one url, and the address tells them apart.
// One source gives each listing its own id: two rows from the same source with different ids at one street are two listings (four parcels on "Town Center Drive"), never an address or url repeat. Another source's row at that street still repeats.
const listingId=x=>{const s=str(x&&x.source,40),i=x&&x.id!=null&&(typeof x.id==='string'||num(x.id)!=null)?String(x.id).trim().slice(0,80):'';return s&&i?s+'#'+i:''};
// two rows at one street with a different bed or sqft count are two homes (a community's street address carries many); a missing count never conflicts
const sizesDiffer=(x,y)=>{const d=(k,g)=>{const p=g(x[k]),q=g(y[k]);return p!=null&&q!=null&&p!==q};return d('beds',pfPos)||d('sqft',listSqft)};
// two sources that give one street the same asking price and type name one listing even when they size it differently (a portal's building sqft against a broker's unit sqft; 600 Example St and 640 S Coast Hwy, live feed 2026-11-15)
const sameListing=(x,y)=>{const p=listPrice(x),t=str(x.type,20);return p!=null&&p===listPrice(y)&&t!==''&&t===str(y.type,20)&&str(x.source,40)!==str(y.source,40)};
// one source can print one listing under two ids (two Zillow ids, two Matthews ids at one street): the same asking price and at least one bed or size count both rows give and that agrees make them one listing despite the ids. A parcel list repeats prices but gives no size, so its rows stay apart.
// A numbered street address that a source prints with one title and one price under several ids (Lee & Associates 2777 E Cedar St, five ids at $52M, live feed 2026-11-18) is one listing too, as long as no bed or size count differs: a parcel list has no street number in front of its street word.
const numberedTwin=(x,y)=>{const t=str(x.title,120);return t!==''&&t===str(y.title,120)&&/^\d/.test(str(x.addr,200))&&/^\d/.test(str(y.addr,200))&&str(x.type,20)===str(y.type,20)};
const sameSourceTwin=(x,y)=>{const s=str(x.source,40),agree=(k,g)=>{const p=g(x[k]),q=g(y[k]);return p!=null&&q!=null&&p===q},p=listPrice(x);return s!==''&&s===str(y.source,40)&&p!=null&&p===listPrice(y)&&!sizesDiffer(x,y)&&(agree('beds',pfPos)||agree('sqft',listSqft)||numberedTwin(x,y))};
const dedupeInOrder=xs=>{const seen=new Set(),streets=new Map(),urlStreets=new Map(),streetIds=new Map(),kept=new Map();return arr(xs).filter(isObj).filter(x=>{const k=listingKeys(x),a=addrSplit(x),cs=a.street?streets.get(a.street):null,
 u=k.find(v=>v.startsWith('url:')),us=u?urlStreets.get(u):null,id=listingId(x),ids=a.street?streetIds.get(a.street):null,
 otherIds=id&&ids&&!ids.includes(id)&&ids.some(o=>o.split('#',1)[0]===id.split('#',1)[0]),
 atStreet=a.street?kept.get(a.street)||[]:[],ownIds=otherIds&&!atStreet.some(y=>sameSourceTwin(x,y)),sized=atStreet.some(y=>sizesDiffer(x,y)&&!sameListing(x,y));
const sameUrl=!ownIds&&!!u&&!!us&&seen.has(u)&&(!a.street?(us.size===1&&us.has('')):us.has(a.street));
if(sameUrl||k.some(v=>v.startsWith('row:')&&seen.has(v))||(cs&&!ownIds&&!sized&&(cs.has(a.city)||a.city===''||cs.has(''))))return false;
k.forEach(v=>seen.add(v));if(u){if(us)us.add(a.street);else urlStreets.set(u,new Set([a.street]))}
 if(a.street){atStreet.push(x);kept.set(a.street,atStreet);if(!cs)streets.set(a.street,new Set([a.city]));else cs.add(a.city);if(id){if(ids)ids.push(id);else streetIds.set(a.street,[id])}}return true})};
// a repeat is dropped, but a priced copy takes the place of an unpriced first copy: the kept row is the one the price and budget filter read
// between two priced copies the fresh one stays: a repeat another source still refreshes is not stale, whichever source came first in the feed
// feed order is kept for the rows that survive
const staleRank=x=>isObj(x)&&x.stale===true?1:0;
const copyOrder=(ix,a,b)=>(listPrice(b)!=null)-(listPrice(a)!=null)||(listPrice(a)!=null&&listPrice(b)!=null?staleRank(a)-staleRank(b):0)||ix.get(a)-ix.get(b);
const dedupeListings=xs=>{const list=arr(xs).filter(isObj),ix=new Map(list.map((x,i)=>[x,i]));
 return dedupeInOrder(list.slice().sort((a,b)=>copyOrder(ix,a,b))).sort((a,b)=>ix.get(a)-ix.get(b))};
// the feed can list one building under both homes and commercial (Multifamily, Mixed use: Redfin and Century 21 on one street): it counts once, in the list of the copy that has a price (homes win a tie)
const homeRows=r=>{const homes=dedupeListings(r&&r.homes),com=dedupeListings(r&&r.commercial),all=homes.concat(com),ix=new Map(all.map((x,i)=>[x,i]));
 const kept=new Set(dedupeInOrder(all.slice().sort((a,b)=>copyOrder(ix,a,b))));
 return {homes:homes.filter(x=>kept.has(x)),com:com.filter(x=>kept.has(x))}};
function listFilter(xs,f,budget,kind){const o=isObj(f)?f:{},b=num(budget);return arr(xs).filter(x=>isObj(x)&&(!o.within||(b!=null&&!isBid(x)&&listPrice(x)!=null&&listPrice(x)<=b))&&
  (kind==='commercial'?(!o.ctype||str(x.type,20)===o.ctype):((!o.city||str(x.city,24)===o.city)&&(!o.htype||str(x.type,20)===o.htype))))}
 function listChips(xs,f,budget,kind){const o=isObj(f)?f:{},key=kind==='commercial'?'type':'city',cur=kind==='commercial'?o.ctype:o.city;
  const opts=[...new Set(arr(xs).filter(isObj).map(x=>str(x[key],24)).filter(Boolean))].sort(),types=kind==='commercial'?[]:[...new Set(arr(xs).filter(isObj).map(x=>str(x.type,20)).filter(Boolean))].sort();
  const chip=(v,l,on,dis)=>'<button type="button" class="b'+(on?' on':'')+'" data-lwithin="'+v+'" data-lkind="'+kind+'" aria-pressed="'+on+'"'+(dis?' disabled':'')+'>'+esc(l)+'</button>';
  return '<div class="hctl">'+'<div class="chips hm-scope" role="group" aria-label="Price filter">'+chip('0','All',!o.within)+chip('1','Within budget',!!o.within,num(budget)==null)+'</div>'+
   (opts.length>1?'<label class="hc-f"><span>'+(kind==='commercial'?'Type':'City')+'</span><select data-lsel="'+kind+'"><option value="">All</option>'+opts.map(v=>'<option value="'+esc(v)+'"'+(v===cur?' selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>':'')+
   (types.length>1?'<label class="hc-f"><span>Type</span><select data-lsel="htype"><option value="">All</option>'+types.map(v=>'<option value="'+esc(v)+'"'+(v===o.htype?' selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>':'')+'</div>'}
 // the realestate feed's blocks: your markets (areas, rates), homes for sale, commercial (indicators and listings).
 // filter = {scope, page:'short'|'all'|n, home:{within,city,htype}, com:{within,ctype}, budget}. Each row names its source; listing ages come from the source's own date.
 function homeParts(r,now,filter){
  const mode=typeof filter==='string'?filter:(isObj(filter)&&(filter.page==='short'||filter.page==='all'||num(filter.page)!=null)?filter.page:null),flt=isObj(filter)?filter:{},m=isObj(r.market)?r.market:{},
   rows=homeRows(r),all=rows.homes,allC=rows.com,
   hs=listFilter(all,flt.home,flt.budget,'homes'),cs=listFilter(allC,flt.com,flt.budget,'commercial'),
   hp=paged(mode,HOME_SHORT,HOME_CAP,HOME_CAP,hs.length),cp=paged(mode,COM_SHORT,COM_CAP,COM_CAP,cs.length),
   mk=marketAreas(m,flt,now),when=x=>(x&&x.listed_at!=null?' \u00B7 '+esc(listedAgo(x.listed_at,now)):'')+listStale(x);
  const comList=(cs.length?'<div class="flist">'+cs.slice(0,cp.shown).map(x=>row([listPriceText(x),str(x&&x.type,20)||'type?',str(x&&x.city,24)].filter(Boolean).join(' \u00B7 '),
    [str(x&&x.addr,50),hListMeta(x,{type:false})].filter(Boolean).join(' \u00B7 '),'<small>'+esc(str(x&&x.source,16))+when(x)+'</small>','',x&&x.url)).join('')+'</div>'+
    capNote(cp.shown,cs.length)+(cp.page?cp.more('homes','')+(cp.fewer?fewerBtn('homes'):''):''):empty({title:allC.length?'No commercial listing matches':'No commercial listings in the feed'}));
  return {zhvi:num(m.residential&&m.residential.areas_with_zhvi)?m.residential.areas_with_zhvi+' with ZHVI':'public series',
   markets:mk.html+marketRates(m),
   homesN:all.length?(hs.length===all.length?all.length+(all.length===1?' home':' homes'):hs.length+' of '+all.length+' homes'):'no listing rows',
   homeChips:listChips(all,flt.home,flt.budget,'homes'),comChips:listChips(allC,flt.com,flt.budget,'commercial'),
   comN:allC.length?(cs.length===allC.length?allC.length+(allC.length===1?' listing':' listings'):cs.length+' of '+allC.length+' listings'):'no listing rows',
   forSale:'<div class="flist">'+hs.slice(0,hp.shown).map(x=>row(listPriceText(x)+' \u00B7 '+(str(x&&x.addr,50)||'address withheld'),[str(x&&x.city,24),hListMeta(x,{type:false})].filter(Boolean).join(' \u00B7 '),
     '<small>'+esc(str(x&&x.source,16))+when(x)+'</small>','',x&&x.url)).join('')+
    (hs.length?'':empty({title:all.length?'No home matches these filters':'No homes for sale in the feed'}))+'</div>'+
    capNote(hp.shown,hs.length)+(hp.page?hp.more('homes',' homes')+(hp.fewer?fewerBtn('homes'):''):''),
   comList,
   commercial:(cs.length?sect(cs.some(isLease)?'Commercial for sale and lease':'Commercial for sale',String(cs.length))+comList:'')+(m.legacy_inventory_scope?'<div class="tnote">'+esc(m.legacy_inventory_scope)+'</div>':''),
   scopeNote:m.legacy_inventory_scope?'<div class="tnote">'+esc(m.legacy_inventory_scope)+'</div>':''}}
 // one column (older callers and tests): your markets, homes for sale, commercial
 function homes(r,now,filter={}){if(state(r)=='bad')return head('Homes',r,now)+down('Real estate feed',r,'housing');
  const p=homeParts(r,now,filter);
  return head('Homes',r,now)+'<div class="secttl"><span>Your markets</span><span>'+esc(p.zhvi)+'</span></div>'+p.markets+
   '<div class="secttl"><span>For sale now</span><span>'+esc(p.homesN)+'</span></div>'+p.forSale+p.commercial+errRows(r)}
 // ---- cluster tuning loop (perfloop feed, written by PerfLoop) ----
// The tuning loop was retired on 2026-10-07 and its feed keeps the last stale reading, including "STOP file present".
// Say it is retired, in one card, not the held reasons.
const RET_MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const retiredOn=pf=>{if(!isObj(pf)||!(pf.retirement_date||/^retired/i.test(str(pf.status,40))))return null;const d=new Date(str(pf.retirement_date,30));
 return isNaN(d.getTime())?'earlier':RET_MON[d.getUTCMonth()]+' '+d.getUTCDate()};
 function perf(pf,now){if(state(pf)=='bad')return bhead('Tuning loop',pf,now)+down('Perf loop feed',pf,'cluster');
  const ret=retiredOn(pf);if(ret)return bhead('Tuning loop',pf,now)+tile('Status','Retired','Stopped on '+ret+'. Cluster tuning moved to Cluster Improve.','stale','wrap');
  const k=state(pf),ag=isObj(pf.agents)?pf.agents:{},ax=isObj(pf.active_experiment)?pf.active_experiment:null,lr=isObj(pf.last_result)?pf.last_result:null,
   q=isObj(pf.queue)?pf.queue:{},rt=isObj(pf.runs_today)?pf.runs_today:{},bl=isObj(pf.exec_blocked_by)?pf.exec_blocked_by:{},blk=Object.keys(bl).map(x=>str(x,30).replace(/_/g,' ')+': '+str(bl[x],80));
  const on=pf.stop===true?'Stopped':pf.enabled===true?'Running':pf.enabled===false?'Off':'Not reported';
  return bhead('Tuning loop',pf,now)+tile('Perf loop',on+' \u00B7 '+fmt(rt.total)+' runs today \u00B7 '+fmt(pf.experiments_today)+' experiments',
   'queue '+fmt(q.queued)+' queued, '+fmt(q.running)+' running \u00B7 last tick '+ago(pf.last_tick,now)+(pf.stop===true?' \u00B7 stopped by hand':''),pf.stop===true?'stale':k,'wrap')+
   '<div class="flist">'+Object.keys(ag).filter(n=>isObj(ag[n])).map(n=>{const a=ag[n];
    return row(str(a.label,40)||n,(a.running===true?'running since '+ago(a.since,now).replace(' ago',''):'idle')+' \u00B7 last '+(str(a.last_action,30).replace(/_/g,' ')||'--'),'<b>'+fmt(a.runs_today)+'</b><small>runs today</small>',a.last_action==='error'?'bad':'','')}).join('')+
   (ax?row('Now: '+(str(ax.title,80)||'experiment'),(str(ax.phase,30)||'phase not reported')+(ax.eta?' \u00B7 eta '+str(ax.eta,30):''),'','','','',[str(ax.id,80)&&'Experiment '+str(ax.id,80)]):'')+
   // the last result says its outcome in words with signed percents ("Rejected · gain −1.8%"; "Writing −3.8% · Coding +0.2%"); the id and the raw note ride in the sheet (V14, W10)
   (lr?row([outWord(lr.outcome)||'No outcome',gainOf(lr.gain)].filter(Boolean).join(' \u00B7 '),[str(lr.title,80)||'Last experiment'].concat(tuneDeltas(lr.note),lr.finished?[ago(lr.finished,now)]:[]).join(' \u00B7 '),'',/FAIL/i.test(str(lr.outcome,20))?'bad':'','','',
    [str(lr.id,80)&&'Experiment '+str(lr.id,80),str(lr.note,400)&&'Note: '+str(lr.note,400)]):'')+
   // what holds the loop: one row naming the reasons; their text, file paths included, rides in the sheet
   (blk.length?row('Held',Object.keys(bl).map(x=>sentence(str(x,30))).join(' \u00B7 '),'','','','',blk):'')+'</div>'+errRows(pf)}

 // ---- home: products and owner actions (products feed) ----
// ---- home: products and owner actions (products feed) ----
 const ASC_WORD={PREPARE_FOR_SUBMISSION:'in prep',READY_FOR_SALE:'live',WAITING_FOR_REVIEW:'waiting for review',IN_REVIEW:'in review',UNRESOLVED_ISSUES:'issues open',
  REJECTED:'rejected',READY_FOR_REVIEW:'ready for review',COMPLETE:'complete',VALID:'valid',PROCESSING:'processing',INVALID:'invalid',FAILED:'failed',
  DEVELOPER_REJECTED:'pulled back',PENDING_DEVELOPER_RELEASE:'approved, not released'};
 const ascWord=s=>{const k=str(s,40);return ASC_WORD[k]||k.toLowerCase().replace(/_/g,' ')||'unknown'};
 // k: ok | stale | bad | wait. `wait` (amber) is a state only Tanner can move, an App Review rejection or open issues; red stays for a real outage.
 // one product as data, so House can group it by state: {kind: 'app'|'site', h: name, v: state words, t1, t2, k, url}; a feed that did not
 // answer is {html} (its own empty state)
 function appItem(a,k,now){
  if(!isObj(a))return {html:empty({k:'bad',title:'App Store is not reporting',line:'App Store Connect did not answer. Try again.',retry:'home'})};
  if(a.withheld===true)return {kind:'app',h:'App Store',v:'Hidden',t1:'Details are not shown on this screen',t2:'',k:'stale',url:''};
  const name=str(a.name,60)||'App Store',v=isObj(a.version)?a.version:{},b=isObj(a.latest_build)?a.latest_build:{},r=isObj(a.review)?a.review:{},rs=str(r.state,30),live=str(a.live_version,12);
  return {kind:'app',h:name,v:rs?ascWord(rs).replace(/^./,c=>c.toUpperCase()):'Not submitted',t1:'Version '+(str(v.string,12)||'unknown')+', '+ascWord(v.state)+' \u00B7 build '+fmt(v.build)+' attached',
   t2:'Newest build '+fmt(b.number)+', '+ascWord(b.state)+(b.uploaded?' \u00B7 '+ago(b.uploaded,now):'')+(live?' \u00B7 live '+live:''),k:/UNRESOLVED|REJECT/.test(rs)?'wait':k,url:a.url}}
 // every App Store app the feed lists, at most eight. A feed without that list shows its single app_store as before.
 function appItems(p,k,now){const list=arr(isObj(p)?p.app_stores:null).filter(isObj).slice(0,8);
  return list.length?list.map(a=>appItem(a,k,now)):[appItem(isObj(p)?p.app_store:null,k,now)]}
 function siteItem(s,k){const st=str(s&&s.state,8),m=isObj(s&&s.monitor)?s.monitor:null,fails=m?arr(m.failing).length:0,
  code=num(s&&s.code),ep=s&&s.error_page===true,
  // An auth challenge (401/403) is the product refusing an anonymous read: "Up, sign-in required",
  // never an error page. Anything else at 400 or above, or a document the collector identified as
  // an error page, is Down. Up beside "Showing an error page" was the contradiction in
  // pixel-deck#35, where the Console's 10 ms proxy note was read as content.
  auth=code!=null&&(code===401||code===403),
  bad=code==null||ep||st=='down'||(code>=400&&!auth),
  // the word says the worst truth beside its mark: a site that answers while its checks fail reads "Up, checks failing" with the bad
  // mark, so it never joins the calm "Up" group (review #390)
  label=bad?'Down':fails?'Up, checks failing':auth||st=='gated'?'Up, sign-in required':st=='up'?'Up':'Down',
  t=code==null?'No answer':bad?'Showing an error page':'Responding',
  // a failed connect has no response time; printing one would read as a fast answer
  lat=code!=null&&num(s&&s.ms)!=null?' \u00B7 '+fmt(s.ms,0,' ms'):'';
  return {kind:'site',h:str(s&&s.name,30)||'Site',v:label,t1:t+lat,
   t2:m?fmt(m.ok)+' of '+fmt(m.checks)+' checks passing'+(fails?' \u00B7 failing: '+arr(m.failing).join(', '):''):auth||st=='gated'?'Private, needs sign-in':'',k:bad||fails?'bad':st?k:'stale',url:s&&s.url}}
 // House's Products grouped by state (PlanDesign section 3, decision 5): apps or sites in the same state are one row, the state and the count,
 // each name its own link (DeckUI.group, groupRow), so a product is still one tap away. One of a state keeps its own row with its details.
 const ITEM_MARK={ok:'ok',wait:'wait',bad:'bad',stale:'warn'};
 const itemPill=x=>'<span class="pill">'+SD(ITEM_MARK[x.k]||'ok')+esc(x.v)+'</span>';
 function productGroups(items){const all=arr(items).filter(isObj),errs=all.filter(x=>x.html!=null).map(x=>x.html).join('');
  const xs=all.filter(x=>x.html==null).map(x=>Object.assign({},x,{mark:ITEM_MARK[x.k]||'ok',name:x.h}));
  const rows=V3.group(xs,{key:x=>x.kind+'|'+x.v,sev:x=>x.k||''}).map(g=>{const x=g.row;if(x)return row(x.h,[x.t1,x.t2].filter(Boolean).join(' \u00B7 '),itemPill(x),'',x.url);
   const m0=g.members[0],noun=m0.kind==='site'?'sites':'apps';
   return V3.groupRow(g,{title:m0.v+' \u00B7 '+g.count+' '+noun})}).join('');
  return errs+(rows?'<div class="flist pgrp">'+rows+'</div>':'')}
 // Now, Soon, Later. Now is amber (`wait` mark, accent wash): these rows wait on Tanner, they are not outages, so they are never red.
 const SEV={high:'Now',med:'Soon',low:'Later'},SEV_MARK={high:'wait',med:'warn',low:'ok'};
 // Legacy feeds have no owner field. A failed check alone is never an owner decision.
 const ownerDecision=x=>isObj(x)&&(x.owner?x.owner==='owner':
  (/^(app store connect|asc)$/i.test(x.source||'')&&/^(Answer App Review|Reply to App Review|Attach build)\b/.test(str(x.text,120)))||
  (x.source==='accounts.json'&&/^(Sign in|Reconnect)\b/.test(str(x.text,120))));
 const decisionDataComplete=p=>state(p)==='ok'&&Array.isArray(p.needs)&&!arr(p.errors).length;
// a list of rows sits in one .flist card; an empty state is the one .es component and never sits inside a card of its own
const flist=body=>/^<div class="es\b/.test(body)?body:'<div class="flist">'+body+'</div>';
// "Your decisions" (and Maintenance): every row has its own Open button. It only opens the page in a new tab; it never approves, sends or changes anything.
// A row with no page says so instead of showing a dead button. A due date shows exactly (`due` or `deadline`: epoch or YYYY-MM-DD); a deadline text that only says
// "about" or "confirm date" is tagged for an owner check. No producer in this repo writes `due` yet [INFERENCE]: the tag keeps such a row honest until one does.
const DUE_TZ='America/Los_Angeles',DUE_WORDS=/\b(deadline|due|expires?|expired|expiry|redemption|redeem|renew(?:al)?)\b/i,DUE_FUZZY=/\b(about|around|approx(?:imately)?|roughly|est\.?)\b|confirm(?:\s+the)?\s+date/i;
function dueTag(x){if(!isObj(x))return null;const raw=x.due!=null?x.due:x.deadline;
 if(typeof raw==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw)){const d=new Date(raw+'T00:00:00Z');if(isFinite(d))return {k:'exact',text:'Due '+d.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'})}}
 const e=toEpoch(raw);if(e!=null&&e>1.5e9)return {k:'exact',text:'Due '+new Date(e*1000).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric',timeZone:DUE_TZ})};
 const words=str(x.text,120)+' '+str(x.why,160)+' '+str(x.due_note,80);
 return DUE_WORDS.test(words)&&DUE_FUZZY.test(words)?{k:'check',text:'Owner check: confirm date'}:null}
// feed prose carries ISO dates ("since 2026-10-16"); the row reads the deck's dates ("since Oct 16"), as Today does
const proseDates=s=>String(s==null?'':s).replace(/\b\d{4}-\d{2}-\d{2}\b/g,m=>fmt.date(m)||m);
function decisionRow(x,maint){const sv=['high','med','low'].includes(x.sev)?x.sev:'low',u=safeUrl(x.url),due=dueTag(x),name=proseDates(str(x.text,90));
 const sub=[proseDates(redact(str(x.why,120))),friendly(str(x.source,40))].filter(Boolean).join(' \u00B7 ');
 const open=x.noOpen===true?'':u?'<a class="b open" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc('Open '+name+' in a new tab')+'">Open</a>':'<small class="nolink">No page to open</small>';
 // a maintenance row sits under its own Maintenance title, so it carries no tag: a middle "Maintenance" word left the title 130 to 160 px on a phone
 const tag=maint?'':'<span class="pill sv-'+sv+'">'+SD(SEV_MARK[sv])+SEV[sv]+'</span>';
 return '<div class="frow'+(maint?(x.sev==='high'?' need sv-high':''):' need sv-'+sv)+'"><span class="fl"><b>'+esc(name)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+
  (due?'<small class="due"><span class="pill'+(due.k==='check'?' warn':'')+'">'+esc(due.text)+'</span></small>':'')+'</span><span class="fr">'+tag+open+'</span></div>'}
 // extra = rows from other feeds (renewals, deadlines, TestFlight): with extras the list is sorted Now, Soon, Later (stable, owner decisions first); without them the feed order stays
 const SEV_RANK={high:0,med:1,low:2};
 // House's "Your decisions" grouped by kind (PlanDesign section 3, decision 5): the owner's steps of one kind and one urgency are one row,
 // its count and words once (Today's kinds, TD_KINDS), then each item's name as its own link (DeckUI.group, groupRow), so every item is still
 // one tap away. A Now item never joins a Soon one. One of a kind keeps its own row with its Open button. limit counts rows, not items.
 const sevOf=x=>['high','med','low'].includes(x&&x.sev)?x.sev:'low';
 const needKind=x=>TD_KINDS.find(k=>k.re.test(str(x&&x.text,120)))||null;
 // the group's reason and age once, as Today's group rows do (tdGroupWhy): the shared words and the oldest "since" of its members, then the
 // shared source ("review unresolved issues since Oct 16 · App store connect"), so the row still says why he acts and for how long (review #390)
 const SINCE_RE=/\s*\bsince\s+(\d{4}-\d{2}-\d{2})\b/;
 function needGroupWhy(ms){const parts=ms.map(m=>{const w=redact(str(m.why,120)),s=SINCE_RE.exec(w);return {why:w.replace(SINCE_RE,'').trim(),since:str(m.since,10)||(s?s[1]:'')}});
  const w=tdGroupWhy(parts),ss=parts.map(p=>p.since),old=ss.every(Boolean)?ss.slice().sort()[0]:'',age=old?'since '+fmt.date(old):'';
  const reason=!w?age:/^since /.test(w)?w:[w,age].filter(Boolean).join(' '),srcs=ms.map(m=>friendly(str(m.source,40)));
  return [reason,srcs.every(s=>s===srcs[0])?srcs[0]:''].filter(Boolean).join(' \u00B7 ')}
 function needGroupRow(g){const K=TD_KINDS.find(k=>k.k===g.key),sv=sevOf(g.members[0]),why=needGroupWhy(g.members);
  const h=V3.groupRow(g,{title:K.head(g.count),name:m=>tdShort(K.name(K.re.exec(str(m.text,120))))});
  return h.replace('class="frow grp"','class="frow grp need sv-'+sv+'"').replace('</b>','</b>'+(why?'<small>'+esc(why)+'</small>':''))
   .replace(/<\/div>$/,'<span class="fr"><span class="pill sv-'+sv+'">'+SD(SEV_MARK[sv])+SEV[sv]+'</span></span></div>')}
 function needRows(p,limit,where,extra){const ns=arr(isObj(p)&&p.needs).filter(ownerDecision),ex=arr(extra).filter(isObj),n=limit||6;
  if(!ns.length&&!ex.length)return decisionDataComplete(p)?empty({title:'Nothing needs you',line:'Every source reported in.'}):empty({k:'stale',title:'Some decisions may be missing',line:'A source is out of date or not reporting.'});
  const all=ex.length?ns.concat(ex).map((x,i)=>({x,i,r:SEV_RANK[x.sev]==null?2:SEV_RANK[x.sev]})).sort((a,b)=>a.r-b.r||a.i-b.i).map(o=>o.x):ns;
  const gs=V3.group(all.map(x=>Object.assign({},x,{mark:SEV_MARK[sevOf(x)]})),{key:x=>{const K=needKind(x);return K?K.k:''},sev:sevOf});
  const left=gs.slice(n).reduce((s,g)=>s+(g.row?1:g.count),0);
  return gs.slice(0,n).map(g=>g.row?decisionRow(g.row,false):needGroupRow(g)).join('')+
   (left?'<div class="frow"><span class="fl"><small>'+left+' more'+(where?' '+esc(where):'')+'</small></span></div>':'')}
 function maintenanceRows(p,limit){const ns=arr(isObj(p)&&p.needs).filter(isObj).filter(x=>!ownerDecision(x)),n=limit||6;
  if(!ns.length)return decisionDataComplete(p)?none('No maintenance problems','Everything that was checked is fine.'):none('Maintenance data is incomplete','A source is out of date or not reporting.');
  return ns.slice(0,n).map(x=>decisionRow(x,true)).join('')+
   (ns.length>n?row((ns.length-n)+' more maintenance items','Open Dev or Fleet for details','',''):'')}
// ---- House: car, Apple Watch and printer ink. An empty card never stands alone: it says why, when it was last seen and the one next step (no invented values). ----
function emptyFacts(o){o=isObj(o)?o:{};const k=o.k==='bad'||o.k==='stale'?o.k:'idle';
 return '<div class="es es-'+k+'" role="status">'+ES_ICON[k]+'<b class="es-t">'+esc(str(o.title,80)||'Nothing here yet')+'</b>'+
  [['Why',o.cause],['Last seen',o.last],['Next step',o.step]].filter(x=>str(x[1],240)).map(x=>'<span class="es-l"><b class="es-w">'+x[0]+':</b> '+esc(str(x[1],240))+'</span>').join('')+
  (str(o.how,300)?'<span class="es-l how">'+esc(str(o.how,300))+'</span>':'')+diagHtml(o.diag)+'</div>'}
// printer ink: a missing value says why, when Home Assistant last changed it and what to do
function inkTile(l,s,now){const p=s&&!isNaN(+s.state)&&s.state!==''&&s.state!=null?+s.state:null,low=p!=null&&p<20,t=s&&s.updated!=null?toEpoch(s.updated):null;
 if(p==null&&s&&s.state==='unavailable')return '<div class="tile stale"><div class="h">'+SD('warn')+esc(l)+' ink</div><div class="v">Printer offline</div>'+
  '<div class="t">'+esc(t!=null?'Last seen '+ago(t,now):'Never seen')+'</div><div class="t">Next step: turn the printer on and wait for the next refresh.</div></div>';
 if(p==null)return '<div class="tile stale"><div class="h">'+SD('warn')+esc(l)+' ink</div><div class="v">No reading</div>'+
  '<div class="t">'+esc(s?'No value for this cartridge. The printer is usually off or asleep.':'No sensor for this cartridge yet.')+'</div>'+
  '<div class="t">'+esc(t!=null?'Last changed '+ago(t,now):'Never seen')+'</div><div class="t">Next step: turn the printer on and wait for the next refresh.</div></div>';
 return '<div class="tile'+(low?' bad':'')+'"><div class="h">'+SD(low?'bad':'ok')+esc(l)+' ink</div><div class="v">'+p+'%'+(low?' Low':'')+'</div><div class="bar"><i style="width:'+Math.max(0,Math.min(100,p))+'%"></i></div></div>'}
// the printer on House (W5): ink readings are two tiles; an offline or silent printer is one quiet row, never one card per cartridge.
// e: Home Assistant entities
function printer(e,now){e=isObj(e)?e:{};const ss=INK_IDS.map(([l,k])=>[l,e[k]]),val=s=>isObj(s)&&s.state!==''&&s.state!=null&&!isNaN(+s.state);
 if(ss.some(([,s])=>val(s)))return ss.map(([l,s])=>inkTile(l,s,now)).join('');
 const t=Math.max(0,...ss.map(([,s])=>isObj(s)?toEpoch(s.updated)||0:0)),off=ss.some(([,s])=>isObj(s)&&s.state==='unavailable');
 return '<div class="flist"><div class="frow"><span class="fl"><b>'+SD('off')+(off?'Printer offline':'Printer not reported')+'</b><small>'+esc(t>0?'Last seen '+ago(t,now):'Never seen')+'</small></span>'+
  diagHtml(['Turn the printer on; the ink shows after the next refresh.'])+'</div></div>'}
// the car as one reading in House's strip: the battery is the figure, the range its unit, one short line ("Last seen 43 min ago" when the values
// are cached), and the battery bar drawn to the percentage with a tick at the charge limit when the feed has one (review #353 item 5); a value
// outside 0 to 100 reads No reading and draws no bar or tick (decision 9). The rest rides in the sheet. The car's own reading time is `seen`
// (generatedAt minus ageSeconds in car.json, worked out by the server); the file time says only when the poller last ran, so it is never
// "Updated N min ago".
const carBar=(b,lim)=>'<div class="bar" role="img" aria-label="'+esc('Battery '+Math.round(b)+'%'+(lim!=null?', charge limit '+Math.round(lim)+'%':''))+'"><i style="width:'+Math.round(b)+'%"></i>'+
 (lim!=null?'<u style="left:'+Math.round(lim)+'%"></u>':'')+'</div>';
function carReading(c,now){
 if(!isObj(c)||c.error){const p=problem(c);return {k:'bad',html:'<span class="h">Car</span><b class="v"><span class="na">No reading</span></b><span class="t">Not reporting</span>'+diagHtml(p.diag)}}
 const b=pctOf(c.battery),rg=num(c.range),seen=toEpoch(c.seen),cached=c.fresh===false||c.stale===true,ch=/charg/i.test(c.charging||'')&&!/dis/i.test(c.charging||''),lim=pctOf(c.charge_limit),k=c.locked===false?'warn':cached?'stale':'ok';
 const line=[cached?'Last seen '+(seen==null?'time not reported':ago(seen,now)):'',ch?'Charging':'',c.locked===false?'Unlocked':''].filter(Boolean).join(' \u00B7 ');
 const asleep=/^(offline|asleep)$/i.test(str(c.awake,16))?'The car is '+str(c.awake,16).toLowerCase()+'. ':'';
 return {k,html:'<span class="h">'+(k==='warn'?SD('warn'):'')+'Car</span><b class="v">'+(b==null?'<span class="na">No reading</span>':Math.round(b)+'%')+(rg!=null?'<span class="u">'+Math.round(rg)+' mi</span>':'')+'</b>'+(b==null?'':carBar(b,lim))+(line?'<span class="t">'+esc(line)+'</span>':'')+
  diagHtml([ch?'Charging':/^disconnected$/i.test(str(c.charging,24))?'Cable not connected':str(c.charging,24),lim!=null&&'Charge limit '+Math.round(lim)+'%','Lock: '+(c.locked===true?'locked':c.locked===false?'unlocked':'not reported'),
   seen==null?'Last seen time not reported':'Last seen '+ago(seen,now),cached&&asleep+'These values are from the last time the car answered.',c.stale===true&&toEpoch(c.t)!=null&&'The car check last ran '+ago(c.t,now)+'.'])}}
 function products(p,now){
  if(state(p)=='bad')return {grid:down('Products',p,'home'),needs:down('Decisions',p,'home'),src:'',count:'--'};
  const k=state(p);
  return {grid:productGroups(appItems(p,k,now).concat(arr(p.products).filter(isObj).map(s=>siteItem(s,k)))),needs:flist(needRows(p,6)),maintenance:'<section class="tsec">'+bhead('Maintenance',p,now)+maintenanceRows(p)+errRows(p)+'</section>',src:bsrc(p),count:decisionDataComplete(p)?String(arr(p.needs).filter(ownerDecision).length):'--'}}

 const sec=(title,f,now,body)=>'<section class="tsec">'+head(title,f,now)+body+'</section>';
 const none=(title,line)=>empty({k:'idle',title,line});
// ---- 2026-10-29: Renewals and deadlines (GET /api/deadlines) and App builds (GET /api/testflight). Read only, no amounts, no evidence. A key a feed
// does not carry is "not reported", never a number. ----
const DL_WINDOW=60;
const DL_SOURCE={subsradar:'Subscription renewals',renewals:'Subscription renewals',paperwork:'Paperwork deadlines'};
// merged renewals and paperwork, expired first then by days, next DL_WINDOW days; the same vendor and date from both sources is one row
function dlItems(d){const out=[],seen=new Set(),add=x=>{const k=x.name.toLowerCase()+'|'+x.date;if(!seen.has(k)){seen.add(k);out.push(x)}};
 arr(isObj(d)&&d.paperwork).filter(isObj).forEach(p=>{const days=num(p.days_left);if(days==null||days>DL_WINDOW)return;
  add({src:'paperwork',name:str(p.thing,60)||friendly(str(p.kind,30))||'Paperwork',date:str(p.date,10),days,what:friendly(str(p.kind,30))||'Deadline'})});
 arr(isObj(d)&&d.renewals).filter(isObj).forEach(r=>{const days=num(r.days);if(days==null||days>DL_WINDOW)return;
  add({src:'renewal',name:str(r.vendor,60)||'Renewal',date:str(r.date,10),days,what:'Renews'})});
 return out.sort((a,b)=>a.days-b.days||a.name.localeCompare(b.name))}
const TF_BAD=['UNRESOLVED_ISSUES','REJECTED','DEVELOPER_REJECTED'];
const TF_ORDER=['IN_REVIEW','WAITING_FOR_REVIEW','PENDING_DEVELOPER_RELEASE','READY_FOR_REVIEW','PREPARE_FOR_SUBMISSION','READY_FOR_SALE','COMPLETE'];
const upFirst=s=>s.charAt(0).toUpperCase()+s.slice(1);
// the one state word of an app: App Review trouble first, then a build that is not usable, then the furthest version state
function tfState(a){const b=isObj(a&&a.latest_build)?a.latest_build:null,vs=arr(a&&a.versions).filter(isObj).reduce((o,v)=>o.concat(str(v.submission_state,40),str(v.state,40)),[]).filter(Boolean),ps=str(b&&b.processing_state,24);
 const issue=TF_BAD.find(s=>vs.includes(s));
 if(issue)return {k:'bad',word:upFirst(ascWord(issue)),issue};
 if(ps&&ps!=='VALID')return {k:ps==='PROCESSING'?'warn':'bad',word:upFirst(ascWord(ps)),issue:''};
 if(b&&b.expired===true)return {k:'warn',word:'Build expired',issue:''};
 const top=TF_ORDER.find(s=>vs.includes(s));
 return {k:'',word:top?upFirst(ascWord(top)):b?'In testing':'No build',issue:''}}
const tfLink=a=>/^\d{6,12}$/.test(str(a&&a.id,20))?'https://appstoreconnect.apple.com/apps/'+str(a.id,20)+'/testflight/ios':'';
// App Review trouble is a Now row in Today's Needs you, worded as the owner's step (B1, owner 2026-11-03: "dense and hard to scan"). `app`
// lets Today drop it when the products feed already carries a step for the same app: the same App Review answer, read from two feeds.
const TF_STEP={UNRESOLVED_ISSUES:['Answer App Review for ','','App Review has open issues'],REJECTED:['Reply to the App Review rejection for ','','App Review rejected it'],
 DEVELOPER_REJECTED:['Resubmit ',' for App Review','pulled back from review']};
function tfNeeds(f){return arr(isObj(f)&&f.apps).filter(isObj).filter(a=>!a.error&&tfState(a).issue).map(a=>{const st=tfState(a),b=isObj(a.latest_build)?a.latest_build:{},v=arr(a.versions).filter(isObj).find(x=>x.submission_state===st.issue||x.state===st.issue)||{},
  name=str(a.name,40)||'App',step=TF_STEP[st.issue]||TF_STEP.REJECTED;
  return {sev:'high',source:'testflight',app:str(a.name,40),url:tfLink(a).replace(/\/testflight\/ios$/,'/distribution'),text:step[0]+name+step[1],
   why:[step[2],str(v.version,16)?'Version '+str(v.version,16):'',(str(v.build,10)||str(b.number,10))?'submitted build '+(str(v.build,10)||str(b.number,10)):''].filter(Boolean).join(' \u00B7 ')}})}
 // ==== TODAY (lane PgToday, design v3, 2026-11-14): glance and decide ====
 // Pure models and markup for the Today tab; v7Today (page glue) reads the feeds. At most eight sections, in blueprint order: Needs you, Renewals and
 // deadlines, Alerts, Next on the calendar, Home and cameras, Cluster, Markets, then one row of glance tiles. B1 (owner 2026-11-03, "dense and hard
 // to scan"): what only Tanner can do comes first and says each name once; what an agent can fix (failing jobs, checks that did not report, the
 // Status row) is the Alerts strip under the renewals, "No alerts" when clean. A feed that did not report is never an empty card: its section or tile
 // is absent and its name joins the one "Some checks did not report" row. No source names, ages or raw errors on the page; raw reasons reach only
 // the checks sheet, through redact.
 const UI=()=>DeckUI;
 const TD_NAME={today:'Hermes and mail',gateway:'Hermes',mail:'Mail',products:'Your decisions',testflight:'App Review',schedules:'Scheduled jobs',replyblock:'Reply drafts',
  deadlines:'Renewals and deadlines',calendar:'Calendar',cams:'Cameras',car:'Car',ha:'Home Assistant',watch:'Apple Watch',cluster:'Cluster',markets:'Markets',
  surf:'Surf',housing:'Real estate',shop:'Shop',hockey:'Hockey',onthisday:'Photos on this day',traffic:'Website traffic'};
 // the eight-section cap, in blueprint order (section 7): never more, never reordered. At a glance comes before Markets at every size (Main,
 // 2026-11-15, W4-3: on his 2470x1286 window At a glance began below the fold; on a phone Markets alone is 0.63 of a screen); Markets stays whole
 const TD_SECTIONS=['needs','dead','alerts','cal','home','clu','glance','mkt'];
 // balanced columns, the planner behind DeckBalance (layout waves 2026-11-15): CSS columns keep each block whole in DOM order, so a
 // tall block left its neighbour 300 to 580 px short, and letting a list continue in the next column split cards and groups. This picks,
 // for n columns, the column of each block: every block stays whole and keeps its order inside its column, the columns open in order
 // (the first block opens the first column), no column is empty, and the tallest column is as short as it can be, then the shortest
 // as tall as it can be. Up to twelve blocks it tries every such split (pruned once a column is taller than the best so far); past
 // twelve, two columns take the best whole-block subset (sums to the pixel), and three or more take the blocks in reading order, as CSS
 // columns would, split where the tallest column is shortest. h: heights in order; returns a column per block.
 function balanceColumns(h,n){const hs=arr(h).map(x=>Math.max(0,Math.round(num(x)||0))),k=hs.length,N=Math.max(1,Math.min(Math.floor(num(n)||1),k));
  if(N<2)return hs.map(()=>0);
  const total=hs.reduce((s,x)=>s+x,0);
  if(k>12&&N===2){// reach[i][s]: the first i blocks can give the first column s pixels, block 0 always in it
   const reach=[new Uint8Array(total+1)];reach[0][0]=1;
   for(let i=0;i<k;i++){const r=reach[i],nx=new Uint8Array(total+1);for(let s=0;s<=total;s++)if(r[s]){if(i>0)nx[s]=1;if(s+hs[i]<=total)nx[s+hs[i]]=1}reach.push(nx)}
   let s=-1,bestMax=Infinity;for(let x=0;x<total;x++)if(reach[k][x]){const m=Math.max(x,total-x);if(m<bestMax){bestMax=m;s=x}}
   if(s<0)return hs.map(()=>0);
   const out=new Array(k).fill(1);for(let i=k-1;i>=0;i--){if(i>0&&reach[i][s])continue;out[i]=0;s-=hs[i]}return out}
  if(k>12){const pre=[0];hs.forEach(x=>pre.push(pre[pre.length-1]+x));const sum=(i,j)=>pre[j]-pre[i];
   // best[j][i]: the smallest tallest column for the first i blocks in j columns; cut[j][i]: where the last column starts
   const best=[],cut=[];for(let j=0;j<=N;j++){best.push(new Array(k+1).fill(Infinity));cut.push(new Array(k+1).fill(0))}best[0][0]=0;
   for(let j=1;j<=N;j++)for(let i=j;i<=k;i++)for(let s=j-1;s<i;s++){const v=Math.max(best[j-1][s],sum(s,i));if(v<best[j][i]){best[j][i]=v;cut[j][i]=s}}
   const out=new Array(k).fill(0);let i=k;for(let j=N;j>=1;j--){const s=cut[j][i];for(let x=s;x<i;x++)out[x]=j-1;i=s}return out}
  const a=new Array(k).fill(0),col=new Array(N).fill(0);let best=null,score=null;
  (function go(i,used){if(i===k){if(used<N)return;const mx=Math.max(...col),mn=Math.min(...col);if(!score||mx<score[0]||(mx===score[0]&&mn>score[1])){score=[mx,mn];best=a.slice()}return}
   if(N-used>k-i)return;
   for(let c=0;c<=Math.min(used,N-1);c++){if(i===0&&c>0)break;if(score&&col[c]+hs[i]>score[0])continue;a[i]=c;col[c]+=hs[i];go(i+1,Math.max(used,c+1));col[c]-=hs[i]}})(0,0);
  return best||hs.map(()=>0)}
 // the heights the planner gets for one balanced box (layout wave 3, 2026-11-15): the plan is made from closed heights, so a section
 // that opens or closes never changes any block's column; the open list pushes down what is under it and nothing else moves.
 // b: the blocks in order as {k: key, h: measured height, open: shown beyond its default (data-bal-open)}. mem: what this box
 // remembers ({sig, h: key -> height last measured while closed}), kept by the caller across repaints and updated here. view: the
 // viewport, device class and column count. A new view or another set of keys (first load, resize, rotation, a block added or gone)
 // forgets the old heights and plans afresh from what is measured; an open block with no remembered height plans with its measured one.
 function balanceHeights(mem,view,b){const l=arr(b).filter(isObj),sig=String(view)+'|'+l.map(x=>String(x.k)).join('|');
  if(!isObj(mem.h)||mem.sig!==sig){mem.sig=sig;mem.h={}}
  return l.map(x=>{const h=Math.max(0,Math.round(num(x.h)||0)),k=String(x.k);if(!x.open){if(h>0)mem.h[k]=h;return h}return h>0&&mem.h[k]>0?mem.h[k]:h})}
 const tdOk=f=>isObj(f)&&!f.error&&f.status!=='not_reporting';
 // one DeckPages.get answer (bounded: a fetch that never settles ends as "timed out") as a feed: the data, or an object with an error that
 // turns the section into a name in the checks row; never a throw, never a blank card
 const tdFeed=r=>isObj(r)&&r.ok&&isObj(r.data)?r.data:{error:isObj(r)&&str(r.error,80)||'no answer'};
 // Only containers Today consumes are checked. A successful component needs its lists; an explicit component error is still
 // an answer, and real empty arrays remain empty. Shared with the sliced reader so it cannot accept a looser envelope.
 const tdRows=(a,check=isObj)=>Array.isArray(a)&&a.every(check);
 const tdPart=(d,check)=>isObj(d)&&(d.error==null||typeof d.error==='string')&&(!!d.error||d.status==='not_reporting'||check(d));
 const tdBody=check=>d=>tdPart(d,check)&&(d.errors==null||tdRows(d.errors))&&(d.t==null||toEpoch(d.t)!=null);
 const tdMail=d=>tdPart(d,m=>tdRows(m.mailboxes));
 const tdCron=d=>tdPart(d,c=>tdRows(c.next)&&Array.isArray(c.failing)&&c.failing.every(x=>typeof x==='string')&&(c.briefings==null||tdRows(c.briefings)));
 const TD_SHAPE={
  products:tdBody(d=>tdRows(d.products)&&tdRows(d.needs)),
  testflight:tdBody(d=>tdRows(d.apps)),
  schedules:tdBody(d=>tdRows(d.groups,g=>tdPart(g,g=>tdRows(g.jobs,j=>isObj(j)&&(j.owner_wait==null||isObj(j.owner_wait)))))),
  today:tdBody(d=>tdPart(d.gateway,g=>typeof g.ok==='boolean')&&tdMail(d.mail)&&tdCron(d.cron)),
  replyblock:tdBody(d=>isObj(d.counts)&&tdRows(d.items)),
  serverpage:tdBody(d=>tdPart(d.gateway,g=>(g.ok==null||typeof g.ok==='boolean')&&typeof g.state==='string'&&
   ['up','off','down','checks_failed'].every(k=>g[k]==null||Array.isArray(g[k])&&g[k].every(x=>k==='up'||k==='checks_failed'?typeof x==='string':isObj(x))))&&
   tdPart(d.mail,m=>tdRows(m.items)&&('next' in m)&&(m.next===null||isObj(m.next)&&toEpoch(m.next.at)!=null))),
  deadlines:tdBody(d=>tdRows(d.renewals)&&tdRows(d.paperwork)),
  calendar:tdBody(d=>tdRows(d.days,day=>isObj(day)&&tdRows(day.events))&&(d.bills_due==null||tdRows(d.bills_due))),
  cams:tdBody(d=>tdRows(d.cams)),
  car:tdBody(d=>('battery' in d||'locked' in d)&&(d.battery==null||num(d.battery)!=null)&&(d.locked==null||typeof d.locked==='boolean')),
  ha:tdBody(d=>isObj(d.entities)&&Object.values(d.entities).every(x=>x==null||isObj(x))),
  watch:tdBody(d=>typeof d.connected==='boolean'),
  accounts:tdBody(d=>tdPart(d.apple,a=>(a.events_today==null||tdRows(a.events_today))&&(a.bills_due==null||tdRows(a.bills_due)))),
  cluster:tdBody(d=>isObj(d.engine)&&tdRows(d.nodes)),
  markets:tdBody(d=>tdRows(d.board,b=>isObj(b)&&(b.hist==null||Array.isArray(b.hist)&&b.hist.every(Array.isArray)))),
  'surf-coast':tdBody(d=>tdSurfShape(d)),
  'housing/national?part=summary':tdBody(d=>isObj(d.mortgage)),
  'ecom-market':tdBody(d=>tdShopShape(d)),
  hockey:tdBody(d=>tdRows(d.teams,t=>isObj(t)&&(t.last_game==null||isObj(t.last_game))&&(t.next_game==null||isObj(t.next_game)))&&(d.live==null||tdRows(d.live))),
  onthisday:tdBody(d=>tdRows(d.years)&&num(d.total)!=null),
  traffic:tdBody(d=>typeof d.status==='string'&&(isObj(d.daily)||isObj(d.vercel)||isObj(d.totals))&&
   (d.daily==null||isObj(d.daily)&&(d.daily.sites==null||tdRows(d.daily.sites))&&(d.daily.aggregate==null||isObj(d.daily.aggregate)))&&
   (d.vercel==null||tdPart(d.vercel,v=>v.projects==null||tdRows(v.projects)))&&(d.totals==null||isObj(d.totals))),
  health:tdBody(d=>Number.isInteger(d.count)&&d.count>=0&&Array.isArray(d.names)&&d.names.every(x=>typeof x==='string')),
  weather:tdBody(d=>typeof d.text==='string'),
  realestate:tdBody(d=>isObj(d.market)&&isObj(d.market.residential)&&tdRows(d.market.residential.areas)),
  'housing/zip':tdBody(d=>/^\d{5}$/.test(String(d.zip||''))),
  photoyears:tdBody(d=>tdRows(d.years))
 };
 const tdShape=(p,d)=>{const check=TD_SHAPE[p.startsWith('housing/zip/')?'housing/zip':p];return !!check&&check(d)};
 // one entry of the checks row: a plain name and line for the sheet, the raw cause redacted
 function tdMiss(key,f,line){const p=problem(isObj(f)?f:null);
  return {key,name:TD_NAME[key]||sentence(key),line:str(line,160)||p.line,diag:arr(p.diag).map(d=>redact(str(d,200))).filter(Boolean)}}
 const TD_SEV={high:{word:'Now',mark:'wait',r:0},med:{word:'Soon',mark:'warn',r:1},low:{word:'Later',mark:'off',r:2}};
 const tdSev=s=>TD_SEV[s]?s:'low';
 // feed text carries ISO dates ("since 2026-10-16"); the page reads blueprint dates ("since Oct 16")
 const tdDates=s=>String(s==null?'':s).replace(/\b\d{4}-\d{2}-\d{2}\b/g,m=>UI().fmt.date(m));
 const tdLocalKey=now=>{const d=new Date(now);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
 const tdCount=(n,one,many)=>n+' '+(n===1?one:many);

 // ---- Needs you: the owner's steps only (B1): decisions, App Review, mailbox relinks, jobs that wait on him, reply drafts. What an agent can fix
 // (failing and overdue jobs, checks that did not report) is n.jobs and n.miss, drawn by the Alerts strip. o = {products, testflight, schedules,
 // today, replyblock}. Deadlines stay in their own section below, never twice.
 const tdIso=s=>{const m=/\b\d{4}-\d{2}-\d{2}\b/.exec(String(s==null?'':s));return m?m[0]:''};
 function tdNeeds(o){const items=[],miss=[],p=o.products,t=tdOk(o.today)?o.today:null,sc=tdOk(o.schedules)?o.schedules:null;
  if(tdOk(p)){arr(p.needs).filter(ownerDecision).forEach(x=>items.push({sev:tdSev(x.sev),text:tdDates(str(x.text,90)),why:tdDates(redact(str(x.why,120))),since:tdIso(x.why),url:safeUrl(x.url)}));
   const es=arr(p.errors).filter(isObj);if(es.length)miss.push({key:'products',name:TD_NAME.products,line:tdCount(es.length,'source','sources')+' did not report, so a decision may be missing.',diag:es.slice(0,8).map(e=>redact((str(e.source,40)||'source')+': '+(str(e.reason,120)||'no reason given')))})}
  else miss.push(tdMiss('products',p));
  // the same App Review answer read from the products feed and from TestFlight is one row: a TestFlight step whose app the products feed names is dropped
  if(tdOk(o.testflight)){const seen=items.map(i=>i.text.toLowerCase());
   tfNeeds(o.testflight).forEach(x=>{const app=str(x.app,60).toLowerCase();if(!app||!seen.some(s=>s.includes(app)))items.push({sev:'high',text:x.text,why:tdDates(x.why),url:safeUrl(x.url)})})}
  else miss.push(tdMiss('testflight',o.testflight));
  if(!t)miss.push(tdMiss('today',o.today));
  else{const g=t.gateway,m=t.mail;
   if(!isObj(g)||g.error)miss.push(tdMiss('gateway',isObj(g)?g:null));
   if(!isObj(m)||m.error)miss.push(tdMiss('mail',isObj(m)?m:null))}
  const jobs=[];if(sc)arr(sc.groups).forEach(g=>arr(isObj(g)&&g.jobs).forEach(j=>{if(isObj(j))jobs.push(j)}));else miss.push(tdMiss('schedules',o.schedules));
  // a mailbox that needs a relink is its own row; its scheduled job is then not counted again under "jobs wait on you"
  const waits=jobs.filter(j=>j.result==='waiting'&&isObj(j.owner_wait)).map(j=>j.owner_wait),relinked=new Set();
  if(t&&isObj(t.mail)&&!t.mail.error)arr(t.mail.mailboxes).filter(b=>!isObj(b)||!b.ok).forEach(b=>{const x=isObj(b)?b:{},role=str(x.role,30),w=role?waits.find(v=>v.mailbox===role):null;if(role)relinked.add(role);
   items.push({sev:'high',text:(str(x.email,60)||'Gmail '+(role||'mailbox'))+' needs a relink',why:(w&&(str(w.action,130)||str(w.reason,130)))||'Mail cannot read it until the link is renewed',url:safeUrl(str(x.link,300))||safeUrl(w&&str(w.link,300))})});
  const wait=jobs.filter(j=>j.result==='waiting'&&!(isObj(j.owner_wait)&&relinked.has(j.owner_wait.mailbox))),failed=jobs.filter(j=>j.result==='failed'),over=jobs.filter(j=>j.result==='overdue');
  // the first waiting job's step (what to do, from `action`), else its reason, cut at a word with an ellipsis: a collector that clips its
  // own reason at 100 characters left "headless CDP 9333 cann" on the card, and the step is the part that needs the owner
  if(wait.length){const w=wait.map(j=>isObj(j.owner_wait)?str(j.owner_wait.action,300)||str(j.owner_wait.reason,300):'').find(Boolean)||'',why=clip(w,110);
   items.push({sev:'high',text:tdCount(wait.length,'job waits','jobs wait')+' on you',why:why&&wait.length>1?why+' and '+(wait.length-1)+' more':why,open:'today-jobs'})}
  if(sc&&num(isObj(sc.counts)?sc.counts.sources_down:null)>0)miss.push({key:'schedules',name:TD_NAME.schedules,line:tdCount(sc.counts.sources_down,'scheduler','schedulers')+' did not report.',
   diag:arr(sc.errors).filter(isObj).slice(0,4).map(e=>redact((str(e.source,40)||'source')+': '+(str(e.reason,120)||'no reason given')))});
  const rb=o.replyblock;
  if(tdOk(rb)){const n=num(isObj(rb.counts)?rb.counts.drafted:null);if(n>0&&rb.mode!=='dry-run')items.push({sev:'med',text:tdCount(n,'reply draft','reply drafts')+' ready',why:'For the 09:00 send block',open:'today-reply'})}
  else miss.push(tdMiss('replyblock',rb));
  const sorted=items.map((x,i)=>({x,i})).sort((a,b)=>TD_SEV[a.x.sev].r-TD_SEV[b.x.sev].r||a.i-b.i).map(v=>v.x);
  // "Nothing needs you" only from a current, complete decision read: a stale or partial one may hide a decision
  return {items:sorted,miss,complete:tdOk(p)&&p.stale!==true&&!!sc&&!miss.some(m=>m.key==='products'),jobs:{wait,failed,over}}}
 // ---- M4 / G6: rows of one kind become one row: the count and the shared words once, then each member's name as its own link to its action
 // (a chip, 44 px), so a group never costs a tap. Only rows of the same kind AND the same urgency group: a Now row never joins a Soon row, so
 // the group carries its members' one mark. One of a kind stays its own row, worded as before. Kinds are the owner's steps by their verb.
 const TD_KINDS=[
  {k:'review',re:/^Answer App Review for (.+?)(?:\s+v?\d+(?:\.\d+)+)?$/,name:m=>m[1],head:n=>tdCount(n,'App Review','App Reviews')+' to answer'},
  {k:'reject',re:/^Reply to the App Review rejection for (.+?)(?:\s+v?\d+(?:\.\d+)+)?$/,name:m=>m[1],head:n=>tdCount(n,'App Review rejection','App Review rejections')+' to reply to'},
  {k:'resubmit',re:/^Resubmit (.+?) for App Review$/,name:m=>m[1],head:n=>tdCount(n,'app','apps')+' to resubmit for App Review'},
  {k:'attach',re:/^Attach build (\d+) to (.+?)(?:\s+v?\d+(?:\.\d+)+)?$/,name:m=>tdShort(m[2])+' '+m[1],head:n=>tdCount(n,'build','builds')+' to attach'},
  {k:'relink',re:/^(.+) needs a relink$/,name:m=>m[1],head:n=>tdCount(n,'mailbox needs','mailboxes need')+' a relink'}];
 // an app's own name before its subtitle: "Shellboard: Terminal Keyboard" reads "Shellboard"
 const tdShort=s=>str(s,60).split(/:\s/)[0];
 function tdGroup(xs){const out=[],at=new Map();
  arr(xs).forEach(x=>{const K=x.open?null:TD_KINDS.find(k=>k.re.test(x.text));if(!K){out.push(x);return}
   const key=K.k+'|'+tdSev(x.sev),mem={name:tdShort(K.name(K.re.exec(x.text))),text:x.text,why:x.why,url:x.url,since:x.since};
   if(at.has(key)){at.get(key).members.push(mem);return}
   const g={kind:K,sev:tdSev(x.sev),members:[mem],one:x};at.set(key,g);out.push(g)});
  return out.map(g=>g.kind&&g.members.length<2?g.one:g)}
 // the words every member shares, once: the same line, or the oldest "since" when every member carries one; a date that does not read
 // (fmt.date gives null) says nothing, never "since null"
 function tdGroupWhy(ms){const ws=ms.map(m=>m.why||'');if(ws.every(w=>w===ws[0]))return ws[0];
  const ss=ms.map(m=>m.since||''),d=ss.every(Boolean)?UI().fmt.date(ss.slice().sort()[0]):null;return d?'since '+d:''}
 // mark: the first Now row carries the one signal square of the page; later Now rows a plain square with the word (shape and word, no hue)
function tdNeedRow(x,cls,mark){const s=TD_SEV[tdSev(x.sev)],mk='<span class="lead-mark sd'+((mark==null?s.mark:mark)?' '+(mark==null?s.mark:mark):'')+'" aria-hidden="true"></span>';
  // a group: the count and the shared words beside its word, then the names as one full-width line of links under them (css/today.css wraps the row)
  if(x.kind){const why=tdGroupWhy(x.members);
   const chip=m=>{const u=safeUrl(m.url);return u?'<a class="td-chip" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc(m.text+(m.why?', '+m.why:''))+'">'+esc(m.name)+'</a>':'<span class="td-chip">'+esc(m.name)+'</span>'};
   return '<div class="frow need td-grp'+(cls?' '+cls:'')+'" data-k="'+x.kind.k+'">'+mk+'<span class="fl"><b>'+esc(x.kind.head(x.members.length))+'</b>'+(why?'<small>'+esc(why)+'</small>':'')+'</span>'+
    '<span class="pill">'+s.word+'</span><span class="td-chips">'+x.members.map(chip).join('')+'</span></div>'}
  // every link passes safeUrl where it is drawn (SeeCode C10)
  const u=safeUrl(x.url),tag=x.open?'button':u?'a':'div',at=x.open?' type="button" data-open="'+esc(x.open)+'"':u?' href="'+esc(u)+'" target="_blank" rel="noopener noreferrer"':'';
  return '<'+tag+at+' class="frow need'+(cls?' '+cls:'')+'">'+mk+'<span class="fl"><b>'+esc(x.text)+'</b>'+(x.why?'<small>'+esc(x.why)+'</small>':'')+
   '</span><span class="pill">'+s.word+'</span></'+tag+'>'}
 // the one row for everything that did not report: plain names, the count past three; reasons open in a sheet
 const tdMissNames=miss=>miss.map(m=>m.name).filter((n,i,a)=>a.indexOf(n)===i);
 function tdChecksRow(miss){const ns=tdMissNames(arr(miss));if(!ns.length)return '';
  return '<button type="button" class="frow" data-open="today-checks"><span class="lead-mark sd warn" aria-hidden="true"></span><span class="fl"><b>Some checks did not report</b><small>'+
   esc(ns.slice(0,3).join(', ')+(ns.length>3?' and '+(ns.length-3)+' more':''))+'</small></span></button>'}
 // six rows on T, D and XL; four on a phone (P and L, DESIGN "P and L are both phones") and on the TV board. Rows past four carry td-ph and
 // tv-hide, and each size gets its own "N more" row (td-more-p on a phone, td-more-w wider), so the count always says what is out of sight.
 const TD_NEEDS_CAP=6,TD_NEEDS_PHONE=4;
 const tdMoreRow=(n,cls,open)=>'<button type="button" class="frow '+cls+'" data-open="'+open+'"><span class="fl"><b>'+n+' more</b></span></button>';
 function tdNeedsHtml(n){const xs=tdGroup(arr(n&&n.items)),cap=TD_NEEDS_CAP,ph=TD_NEEDS_PHONE;
  const firstNow=xs.findIndex(x=>TD_SEV[tdSev(x.sev)].mark==='wait');
  const rows=xs.slice(0,cap).map((x,i)=>tdNeedRow(x,i>=ph?'td-ph tv-hide':'',TD_SEV[tdSev(x.sev)].mark==='wait'&&i!==firstNow?'':null)).join('')+
   (xs.length>cap?tdMoreRow(xs.length-cap,'td-more-w tv-hide','today-needs'):'')+(xs.length>ph?tdMoreRow(xs.length-ph,'td-more-p tv-hide','today-needs'):'');
  const done=!!n&&n.complete&&!arr(n.miss).length;
  // nothing to show: "Nothing needs you" only from a complete read; a partial one says a decision may be missing and opens the reasons
  const body=rows||(!n?'':done?'<div class="frow"><span class="lead-mark sd ok" aria-hidden="true"></span><span class="fl"><b>Nothing needs you</b></span></div>':
   '<button type="button" class="frow" data-open="today-checks"><span class="lead-mark sd warn" aria-hidden="true"></span><span class="fl"><b>Some decisions may be missing</b><small>A source did not report</small></span></button>');
  return '<h2 class="secttl"><span>Needs you</span></h2><div class="flist">'+(body||'<div class="frow"><span class="fl"><b>Reading your sources</b></span></div>')+'</div>'}
 // ---- Alerts (B1): what an agent can fix, under the owner's steps. Failing jobs are red (an agent fixes them); overdue jobs and checks that did not
 // report are a warn triangle; the Status row (Hermes, mail, automations, the fleet check) closes the strip and opens its sheet. Clean is one row,
 // "No alerts", never "Nothing needs you": Needs you above may hold owner steps. n: tdNeeds (jobs), t: GET /api/today, h: GET /api/health,
 // miss: every part of the page that did not report.
 function tdAlertsHtml(n,t,h,miss){const j=isObj(n)&&isObj(n.jobs)?n.jobs:{},failed=arr(j.failed),over=arr(j.over),rows=[];
  const row=(k,b,s,open)=>'<button type="button" class="frow" data-open="'+open+'"'+(open==='today-status'?' data-key="status"':'')+'>'+(k?'<span class="lead-mark sd '+k+'" aria-hidden="true"></span>':'')+
   '<span class="fl"><b>'+esc(b)+'</b>'+(s?'<small>'+esc(s)+'</small>':'')+'</span></button>';
  if(failed.length)rows.push(row('bad',tdCount(failed.length,'scheduled job','scheduled jobs')+' failing',over.length?tdCount(over.length,'more is','more are')+' overdue':'','today-jobs'));
  else if(over.length)rows.push(row('warn',tdCount(over.length,'job','jobs')+' overdue','','today-jobs'));
  // a part the Status row already names (Hermes and mail) is not listed again in the checks row; it still counts in the page's freshness mark
  const checks=tdChecksRow(arr(miss).filter(m=>!['today','gateway','mail'].includes(isObj(m)&&m.key)));if(checks)rows.push(checks);
  const st=tdStatusWords(t,h,{jobsShown:failed.length>0});
  if(rows.length||st.length)rows.push(row(st.some(w=>w.k==='bad')?'bad':st.length?'warn':'','Status',tdStatusLine(t,h,{jobsShown:failed.length>0}),'today-status'));
  else rows.push(row('ok','No alerts','Hermes, mail, automations and the fleet check read clean','today-status'));
  return {miss:[],html:'<h2 class="secttl"><span>Alerts</span></h2><div class="flist">'+rows.join('')+'</div>'}}

 // ---- Renewals and deadlines: renewals, paperwork and bills (names and dates only, no amounts), soonest first, the rest in a sheet; one line on
 // the right ("2 days"). Six rows on T, D and XL, three on a phone (PlanDesign section 3: the top three reach screen one), each size with its own
 // "N more". A bill's days come from the phone's own date, so the list stays right across midnight. ----
 const TD_DEAD_CAP=6,TD_DEAD_PHONE=3;
 const tdDays=d=>d<0?tdCount(-d,'day','days')+' late':d===0?'Today':d===1?'Tomorrow':d+' days';
 // a one-word name (a domain: "countymedic.com") is kept whole (td-nb): at 1440 it broke at its dot; the day count gives way instead (css/today.css)
 const tdDeadRow=(x,i)=>'<div class="frow'+(i>=TD_DEAD_PHONE?' td-ph':'')+'"><span class="fl"><b'+(/^\S+$/.test(x.name)?' class="td-nb"':'')+'>'+esc(x.name)+'</b><small>'+esc(/^\d{4}-\d{2}-\d{2}$/.test(x.date)?UI().fmt.date(x.date):x.what)+'</small></span><span class="fr"><b>'+esc(tdDays(x.days))+'</b></span></div>';
 function tdBillDays(due,now){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(str(due,10));if(!m)return null;
  const d=new Date(+m[1],+m[2]-1,+m[3]),t=new Date(now),n=Math.round((d-new Date(t.getFullYear(),t.getMonth(),t.getDate()))/864e5);return isFinite(n)?n:null}
 // d: GET /api/deadlines; bills: the agenda's bills_due (or the Mac mini's), [{title, due}]
 function tdDeadlines(d,bills,now){const ok=tdOk(d),at=now==null?Date.now():now;
  const miss=ok?arr(d.errors).filter(isObj).map(e=>({key:'deadlines',name:DL_SOURCE[str(e.source,30).toLowerCase()]||TD_NAME.deadlines,line:'This source did not report.',diag:[redact(str(e.reason,160))].filter(Boolean)})):[tdMiss('deadlines',d)];
  const bs=arr(bills).filter(isObj).map(b=>({src:'bill',name:str(b.title,60)||'Bill',date:str(b.due,10),days:tdBillDays(b.due,at),what:'Bill'})).filter(x=>x.days!=null&&x.days<=DL_WINDOW);
  const items=(ok?dlItems(d):[]).concat(bs).sort((a,b)=>a.days-b.days||a.name.localeCompare(b.name));
  if(!items.length)return {html:'',miss,items};
  return {items,miss,html:'<h2 class="secttl"><span>Renewals and deadlines</span></h2><div class="flist">'+items.slice(0,TD_DEAD_CAP).map(tdDeadRow).join('')+
   (items.length>TD_DEAD_CAP?tdMoreRow(items.length-TD_DEAD_CAP,'td-more-w','today-dead'):'')+(items.length>TD_DEAD_PHONE?tdMoreRow(items.length-TD_DEAD_PHONE,'td-more-p','today-dead'):'')+'</div>'}}

 // ---- Next on the calendar: the next three events from the deck's agenda; the Mac mini list of today's events only when the agenda failed.
 // Every row opens the calendar sheet: each event of today and the coming days the feed carries, with its calendar. ----
 // the calendar's own name: "iCloud OC COAST" reads "OC COAST" (the account is not the calendar)
 const tdCalName=s=>str(s,60).replace(/^iCloud\s+/i,'');
 function tdCalEvents(cal,acc,now){const today=tdLocalKey(now),ev=(e,date,c)=>({title:str(e.title,80)||'Event',date,start:toEpoch(e.start),end:toEpoch(e.end),all:e.all_day===true,cal:tdCalName(c)});
  if(tdOk(cal)&&Array.isArray(cal.days)){const evs=[];cal.days.filter(isObj).forEach(d=>arr(d.events).filter(isObj).forEach(e=>evs.push(ev(e,str(d.date,10),e.source))));return evs}
  if(tdOk(acc)&&isObj(acc.apple)&&Array.isArray(acc.apple.events_today))return acc.apple.events_today.filter(isObj).map(e=>ev(e,today,e.calendar));
  return null}
 const tdEvSort=(a,b)=>a.date.localeCompare(b.date)||(b.all-a.all)||(a.start||0)-(b.start||0);
 function tdDayWord(k,now){if(k===tdLocalKey(now))return 'Today';if(k===tdLocalKey(now+864e5))return 'Tomorrow';const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(k);if(!m)return '';
  return new Date(+m[1],+m[2]-1,+m[3]).toLocaleDateString('en-US',{weekday:'short'})+', '+UI().fmt.date(k)}
 // o (optional): {bills: the bill titles Renewals lists (a bill is said there, never again as an event; W13 saw the bill split twice),
 // briefing: GET /api/today's cron.briefings}. The next briefing (L19: any job named "brief") is the list's first row, its time then the job's
 // name (PlanDesign 3a); it opens the Status sheet, which lists every briefing. Absent field, no row. Off the TV board (the next event stays).
 function tdCal(cal,acc,now,o){const evs=tdCalEvents(cal,acc,now),today=tdLocalKey(now),O=isObj(o)?o:{},bill=new Set(arr(O.bills).map(x=>str(x,80).toLowerCase()).filter(Boolean));
  if(!evs)return {html:'',miss:[tdMiss('calendar',isObj(cal)&&!cal.error?{error:'no agenda days'}:cal)]};
  const t=now/1000,next=evs.filter(e=>!bill.has(e.title.toLowerCase())&&e.date>=today&&(e.all||e.date>today||(e.end!=null?e.end:e.start!=null?e.start:t)>=t)).sort(tdEvSort).slice(0,3);
  const open=' type="button" data-open="today-cal"';
  const br=arr(O.briefing).filter(isObj).map(j=>({name:str(j.name,60),at:toEpoch(j.at)})).filter(j=>j.name&&j.at!=null&&j.at>=t).sort((a,b)=>a.at-b.at)[0];
  // three rows on a phone: with the briefing first, the third event waits in the calendar sheet one tap away (any row opens it)
  const rows=next.map((e,i)=>'<button'+open+' class="frow'+(i?' tv-hide':'')+(br&&i>=2?' td-ph':'')+'"><span class="fl"><b>'+esc(e.title)+'</b><small>'+esc(tdDayWord(e.date,now))+'</small></span><span class="fr"><b>'+esc(e.all?'All day':e.start!=null?UI().fmt.time(e.start):'')+'</b></span></button>').join('');
  const brief=br?'<button type="button" data-open="today-status" data-key="briefing" class="frow tv-hide"><span class="fl"><b>Next briefing</b><small>'+esc(tdAt(br.at,now)+' \u00B7 '+br.name)+'</small></span></button>':'';
  return {miss:[],html:'<h2 class="secttl"><span>Next on the calendar</span></h2><div class="flist">'+brief+(rows||'<button'+open+' class="frow"><span class="fl"><b>Nothing on the calendar</b></span></button>')+'</div>'}}

 // ---- Home and cameras: one row per reading that exists (a null never gets a row). On TV only the cameras row stays on the board. ----
 const tdRow=o=>'<button type="button" class="frow'+(o.cls?' '+o.cls:'')+'"'+(o.open?' data-open="'+esc(o.open)+'"':' data-go="'+esc(o.go)+'"')+' data-key="'+esc(o.key)+'">'+(o.mark?'<span class="lead-mark sd '+o.mark+'" aria-hidden="true"></span>':'')+
  '<span class="fl"><b>'+esc(o.b)+'</b>'+(o.s?'<small>'+esc(o.s)+'</small>':'')+'</span>'+(o.r!=null&&o.r!==''?'<span class="fr"><b>'+esc(o.r)+'</b>'+(o.rs?'<small>'+esc(o.rs)+'</small>':'')+'</span>':'')+'</button>';
 const TD_INK=['sensor.hp_envy_6400_series_black_cartridge','sensor.hp_envy_6400_series_tri_color_cartridge'];
 // L21: Home Assistant's weather entity goes unavailable when met.no answers 502 or 503; the deck's own weather line (GET /api/weather, the top
 // bar's "<place> · Temp 68°F · Wind 5 mph") still reads, so the row shows its temperature. No temperature in it, or "Weather unavailable": no row.
 function tdWxFall(wx){const t=isObj(wx)&&!wx.error?str(wx.text,120):'';if(!t||/unavailable/i.test(t))return null;
  const p=t.split('\u00B7').map(x=>x.trim()).filter(Boolean),tp=p.find(x=>/\d\s*\u00B0/.test(x));
  return tp?{r:tp.replace(/^Temp\s*/i,''),s:p.filter(x=>x!==tp).join(' \u00B7 ')}:null}
 // o = {cams, car, ha, watch, wx}
 function tdHome(o,now){const rows=[],miss=[],go='home/house';
  const cs=isObj(o.cams)&&!o.cams.error&&Array.isArray(o.cams.cams)&&o.cams.cams.length?o.cams.cams.filter(isObj):null;
  if(cs){const r=cs.filter(c=>c.ready===true).length;rows.push(tdRow({go,key:'cams',mark:r<cs.length?'warn':'',b:'Cameras',r:r+' of '+cs.length,rs:'online'}))}else miss.push(tdMiss('cams',o.cams));
  const car=o.car;
  // L22: the car's own reading time (`seen`, from readingAt when the poller leaves ageSeconds null) ends the line when the server sends it
  if(tdOk(car)){const b=num(car.battery);if(b!=null){const ch=/charg/i.test(str(car.charging,24))&&!/dis/i.test(str(car.charging,24)),cached=car.fresh===false||car.stale===true,seen=toEpoch(car.seen);
   rows.push(tdRow({go,key:'car',cls:'tv-hide',mark:car.locked===false?'warn':'',b:'Car',s:cached?(seen!=null?'Last seen '+ago(seen,now):'Last reading'):[num(car.range)!=null?Math.round(car.range)+' mi':'',ch?'Charging':car.locked===true?'Locked':car.locked===false?'Unlocked':'',seen!=null?'last seen '+ago(seen,now):''].filter(Boolean).join(' \u00B7 '),r:Math.round(b)+'%',rs:'battery'}))}}
  else miss.push(tdMiss('car',car));
  const e=isObj(o.ha)&&!o.ha.error&&isObj(o.ha.entities)?o.ha.entities:null;
  const we=e&&isObj(e['weather.forecast_home'])?e['weather.forecast_home']:null,ws=we?str(String(we.state==null?'':we.state),30):'',live=!!ws&&!/^(unavailable|unknown)$/i.test(ws),wf=live?null:tdWxFall(o.wx);
  if(live)rows.push(tdRow({go,key:'weather',cls:'tv-hide',b:'Weather',r:sentence(ws)}));
  else if(wf)rows.push(tdRow({go,key:'weather',cls:'tv-hide',b:'Weather',s:wf.s,r:wf.r}));
  if(e){
   const ink=TD_INK.map(id=>isObj(e[id])?Number(e[id].state):NaN).map((v,i)=>({v,l:i?'Color':'Black'})).filter(x=>isFinite(x.v)&&x.v<20);
   if(ink.length)rows.push(tdRow({go,key:'ink',cls:'tv-hide',mark:'warn',b:'Printer ink low',s:ink.map(x=>x.l+' '+Math.round(x.v)+'%').join(' \u00B7 ')}))}
  else miss.push(tdMiss('ha',o.ha));
  const w=o.watch;
  if(tdOk(w)){const hr=num(w.hr);if(hr!=null)rows.push(tdRow({go,key:'watch',cls:'tv-hide',b:'Apple Watch',s:num(w.battery)!=null?'Battery '+Math.round(w.battery)+'%':'',r:String(Math.round(hr)),rs:'bpm'}))}
  else miss.push(tdMiss('watch',w));
  // tv: false when nothing in the section shows on the TV board (only the cameras row does), so the board never shows a bare heading
  return {miss,tv:!!cs,html:rows.length?'<h2 class="secttl"><span>Home and cameras</span></h2><div class="flist">'+rows.join('')+'</div>':''}}

 // ---- Cluster: the engine and each node, one line each. The Status row closes the Alerts strip (B1), not this list. ----
 function tdCluster(c,now){
  if(!tdOk(c))return {html:'',miss:[tdMiss('cluster',c)]};
  const e=isObj(c.engine)?c.engine:{},st=str(e.status,12),word={up:'Up',loading:'Loading',down:'Down'}[st]||'Unknown',k=st==='up'?'ok':st==='loading'?'warn':'bad',
   up=toEpoch(e.up_since),tok=num(e.tokens_total),go='home/cluster';
  const sub=[st==='up'&&up!=null?'Up '+UI().fmt.age(Math.max(0,now/1000-up)):'',tok!=null?UI().fmt.count(tok)+' tokens served':''].filter(Boolean).join(' \u00B7 ');
  const eng='<button type="button" class="frow" data-go="'+go+'" data-key="engine"><span class="fl"><b>'+esc(str(e.served_name,60)||'Model unknown')+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</span><span class="pill '+k+'"><span class="sd '+k+'"></span>'+word+'</span></button>';
  const nodes=arr(c.nodes).filter(isObj).slice(0,4).map(n=>{const name=sentence(str(n.name,24))||'Node';
   if(n.reachable===false)return tdRow({go,key:'node-'+name,mark:'bad',b:name,s:'Not reachable'});
   const mu=num(n.mem_used_gb),mt=num(n.mem_total_gb),tc=num(n.gpu_temp_c),gu=num(n.gpu_util_pct);
   return tdRow({go,key:'node-'+name,b:name,s:[mu!=null&&mt!=null?Math.round(mu)+' of '+Math.round(mt)+' GB':'',tc!=null?Math.round(tc)+'\u00B0C':''].filter(Boolean).join(' \u00B7 '),r:gu!=null?Math.round(gu)+'%':'',rs:gu!=null?'GPU':''})});
  return {miss:[],html:'<h2 class="secttl"><span>Cluster</span></h2><div class="flist">'+eng+nodes.join('')+'</div>'}}

 // B4: a compact Server page card shares Cluster's block. Its sheet keeps every health and local schedule row.
 // Scheduled Gmail counts are deliberately absent: no new mailbox read without the owner's word.
 const SP_KIND={send:'Sends mail',drafts:'Leaves drafts only',cron:'Hermes cron'};
 const spStatus=g=>DeckCore.status(!isObj(g)||g.ok==null?'not_reported':g.ok===true?'up':g.state==='unreachable'?'not_reported':'degraded');
 const spOld=(f,now)=>{const at=['gateway','mail'].map(k=>isObj(f)&&isObj(f[k])&&f[k].stale===true?toEpoch(f[k].read_at):null).filter(x=>x!=null);
  return bsrc(f,now)||(at.length?'Out of date \u00B7 last read '+(DeckCore.lapse(Math.min(...at),now)||'1 min'):['gateway','mail'].some(k=>isObj(f)&&isObj(f[k])&&f[k].stale===true)?'Out of date':'')};
 function tdServerPage(f,now){const good=tdOk(f),g=good&&isObj(f.gateway)?f.gateway:null,m=good&&isObj(f.mail)?f.mail:null,n=m&&isObj(m.next)?m.next:null,s=spStatus(g);
  const old=spOld(f,now),sub=old||(n?str(n.name,80)+' \u00B7 '+DeckCore.clock(n.at):m&&m.reason?'Mail schedule not reported':'Health and local mail schedule');
  return {miss:good?[]:[tdMiss('serverpage',f)],html:'<h2 class="secttl"><span>Server page</span></h2><div class="flist">'+
   tdRow({open:'today-server',key:'serverpage',b:'Hermes gateway',s:sub,r:good?s.word:'Not reporting',mark:old?'warn':good?s.mark:'off'})+'</div>'}}
 function tdServerSheet(f,now){if(!tdOk(f))return UI().empty({k:'stale',title:'Server page is not reporting',retry:'today'});
  const g=isObj(f.gateway)?f.gateway:{},m=isObj(f.mail)?f.mail:{},s=spStatus(g),n=v=>num(v)==null?'No data':DeckCore.fmt.count(v),
   old=spOld(f,now);
  const health=[tdSRow('Hermes gateway',str(g.reason,160),s.word),
   tdSRow('Reply time','',num(g.reply_ms)!=null?n(g.reply_ms)+' ms':'No data'),
   tdSRow('Restarts',num(g.restarts)!=null?n(g.restarts)+' restarts':str(g.restarts_reason,160)||'Restart count not reported')];
  if(toEpoch(g.since)!=null)health.push(tdSRow('Running for',DeckCore.dur(g.since,now)));
  const items=arr(m.items).filter(isObj),mail=items.map(i=>tdSRow(str(i.name,120)||'Mail job',(SP_KIND[i.kind]||'Mail job')+' \u00B7 '+DeckCore.clock(i.at)));
  if(!items.length)mail.push(tdSRow('Next scheduled mail',str(m.reason,160)||'No local mail timer or cron is due'));
  if(str(m.reason,160)&&items.length)mail.push(tdSRow('Mail schedule not fully reported',str(m.reason,160)));
  return (old?'<p class="note">'+esc(old)+'</p>':'')+tdSec('Gateway health',health)+tdSec('Local mail schedule',mail)}

 // ---- Status: the last row of the Alerts strip: "Everything is running", or a few words for what is not, with the worst mark of them: red for
 // what an agent can fix (Hermes not healthy, automations failing, a critical fleet problem), the warn triangle for a part that did not report
 // and for a fleet check whose problems are all degraded (L20: a camera that needs power at the camera is not an outage). A mailbox that needs a
 // relink is an owner step in Needs you, so it is not said again here. Its sheet: mail unread per mailbox, automations, the next briefings,
 // Hermes and the fleet check. t: GET /api/today ({gateway, mail, cron}), h: GET /api/health ({count, names, critical?, degraded?}) ----
 const tdSRow=(b,s,r,rs)=>'<div class="frow"><span class="fl"><b>'+esc(b)+'</b>'+(s?'<small>'+esc(s)+'</small>':'')+'</span>'+(r?'<span class="fr"><b>'+esc(r)+'</b>'+(rs?'<small>'+esc(rs)+'</small>':'')+'</span>':'')+'</div>';
 const tdSec=(h,rows)=>'<section class="sh-sec"><h3>'+esc(h)+'</h3><div class="flist">'+arr(rows).join('')+'</div></section>';
 // "Today, 5:00 pm", "Tomorrow, 7:00 am", "Tue, Nov 18, 6:30 am"
 const tdAt=(at,now)=>tdDayWord(tdLocalKey(at*1000),now)+', '+UI().fmt.time(at);
 function tdStatusParts(t,h){const ok=tdOk(t),g=ok&&isObj(t.gateway)&&!t.gateway.error?t.gateway:null,m=ok&&isObj(t.mail)&&!t.mail.error&&Array.isArray(t.mail.mailboxes)?t.mail:null,
   c=ok&&isObj(t.cron)&&!t.cron.error&&Array.isArray(t.cron.next)?t.cron:null;
  return {ok,g,m,c,h:tdOk(h)&&Number.isInteger(h.count)&&h.count>=0?h:null}}
 // every problem is degraded, none critical: only when the server sends both counts (an older writer reads as before: all critical)
 const tdDegraded=h=>isObj(h)&&num(h.critical)===0&&num(h.degraded)>0;
 // o.jobsShown: the Alerts strip already has its "scheduled jobs failing" row, so failing automations are not said twice
 function tdStatusWords(t,h,o){const p=tdStatusParts(t,h),w=[],add=(x,k)=>w.push({w:x,k});
  if(!p.ok)add('Hermes and mail not reporting','warn');
  else{if(!p.g)add('Hermes not reporting','warn');else if(p.g.ok!==true)add('Hermes not healthy','bad');
   if(!p.m)add('Mail not reporting','warn');
   if(!p.c)add('Automations not reporting','warn');else{const f=arr(p.c.failing).length;if(f&&!(isObj(o)&&o.jobsShown))add(tdCount(f,'automation','automations')+' failing','bad')}}
  if(!p.h)add('Fleet check not reporting','warn');
  else if(p.h.count>0)add(tdDegraded(p.h)?tdCount(p.h.count,'fleet check','fleet checks')+' degraded':tdCount(p.h.count,'fleet problem','fleet problems'),tdDegraded(p.h)?'warn':'bad');
  return w}
 function tdStatusLine(t,h,o){const w=tdStatusWords(t,h,o).map(x=>x.w);
  return w.length?w.slice(0,2).join(' \u00B7 ')+(w.length>2?' and '+(w.length-2)+' more':''):'Everything is running'}
 function tdStatusSheet(t,h,now){const p=tdStatusParts(t,h),NR='Not reporting',n=v=>num(v)==null?TD_ND:UI().fmt.count(v),at=v=>toEpoch(v)!=null?tdAt(toEpoch(v),now):TD_ND;
  if(!p.ok&&!p.h)return UI().empty({k:'bad',title:'Status is not reporting'});
  const mail=!p.m?[tdSRow('Mail',NR)]:p.m.mailboxes.length?p.m.mailboxes.map(b=>{const x=isObj(b)?b:{},name=sentence(str(x.role,24))||'Mailbox';
   return x.ok?tdSRow(name,'',n(x.unread),'unread'):tdSRow(name,'Needs a relink','Offline')}):[tdSRow('No mailboxes listed')];
  const c=p.c,fl=c?arr(c.failing).map(x=>str(x,40)).filter(Boolean):[],next=c?arr(c.next).filter(isObj):[],br=c?arr(c.briefings).filter(isObj):[];
  const auto=!c?[tdSRow('Automations',NR)]:[tdSRow('On','',n(c.enabled)),tdSRow('Paused','',n(c.paused)),tdSRow('Failing',fl.join(', '),String(fl.length))]
   // a run's time sits on the line under its name: beside a mono "Today, 12:02 pm" a name wrapped to three lines (LayoutP 37)
   .concat(next.length?next.map(j=>tdSRow(str(j.name,40)||'Automation','Next run, '+at(j.at))):[tdSRow('Next run','Nothing scheduled')]);
  const brief=!c?[tdSRow('Briefings',NR)]:br.length?br.map(j=>tdSRow(str(j.name,40)||'Briefing',at(j.at))):[tdSRow('No briefing scheduled')];
  const gw=p.g?tdSRow('Gateway',str(p.g.version,20)?'Version '+str(p.g.version,20):'',p.g.ok===true?'Online':'Not healthy'):tdSRow('Gateway',NR);
  const hc=p.h,old=hc&&hc.stale===true?'Out of date':'';
  const fleet=!hc?[tdSRow('Fleet check',NR)]:hc.count===0?[tdSRow('Fleet check',old,'All clear')]:
   [tdSRow('Fleet check',[old,tdDegraded(hc)?'Degraded, not an outage':''].filter(Boolean).join(' \u00B7 '),tdDegraded(hc)?tdCount(hc.count,'degraded','degraded'):tdCount(hc.count,'problem','problems'))].concat(arr(hc.names).map(x=>str(x,80)).filter(Boolean).map(x=>tdSRow(x)));
  // the old status block's four figures lead the sheet: Hermes, unread mail, automations on, the fleet check
  const unread=p.m?p.m.mailboxes.filter(b=>isObj(b)&&b.ok&&num(b.unread)!=null):[];
  // the fleet figure is a bare count under "Fleet problems": "1 problem" read "1" / "problem" at 390 and overflowed when kept whole
  // (LayoutP 36); with nothing wrong the tile reads "Fleet check: All clear"
  const lead=UI().strip([UI().tile({label:'Hermes',value:p.g?(p.g.ok===true?'Online':'Not healthy'):TD_ND}),UI().tile({label:'Unread mail',value:unread.length?UI().fmt.count(unread.reduce((s,b)=>s+b.unread,0)):TD_ND}),
   UI().tile({label:'Automations on',value:c?n(c.enabled):TD_ND}),UI().tile({label:hc&&hc.count?'Fleet problems':'Fleet check',value:hc?(hc.count?n(hc.count):'All clear'):TD_ND,sub:tdDegraded(hc)?'Degraded':''})]);
  return lead+tdSec('Mail',mail)+tdSec('Automations',auto)+tdSec('Briefings',brief)+tdSec('Hermes',[gw])+tdSec('Fleet check',fleet)}

 // ---- Markets: one strip of eight quotes with a 30-day line; the TV board keeps four whole cells in one row. V2: a figure and its change read as
 // Money > Markets reads them, through its one quote model (DeckInvest.quote in invest.js): the 10-year yield in percent to three places and its
 // move in basis points ("5.311%", "+3.4 bp", never "+0.64%"), "$" on US prices, true minus, a change that rounds to zero flat. ----
 const TD_MKT=['spy','qqq','dia','iwm','us10y','wti','gold','btc'],TD_MKT_TV=['spy','qqq','us10y','btc'];
 const tdInvest=()=>typeof DeckInvest==='object'&&DeckInvest&&typeof DeckInvest.quote==='function'?DeckInvest:null;
function tdMarkets(m,now){if(!tdOk(m))return {html:'',miss:[tdMiss('markets',m)]};
  const I=tdInvest();if(!I)return {html:'',miss:[tdMiss('markets',{error:'the markets formatter did not load'})]};
  const at=num(now)!=null?now:Date.now(),open=isObj(m.session)&&m.session.state==='open';
  const by={};arr(m.board).filter(isObj).forEach(b=>{by[str(b.id,12)]=b});
  const tiles=TD_MKT.filter(id=>by[id]&&num(by[id].price)!=null).map(id=>{const b=by[id],q=I.quote(b);if(!q.price)return '';
   // the feed's label is kept whole: "S&P 500 (SPY)" is the SPY fund price, so the value never wears the index's name alone
   const label=str(b.label,40)||str(b.symbol,12)||id.toUpperCase(),sp=arr(b.hist).filter(Array.isArray).slice(-30).map(x=>num(x[1])),c=q.chgTxt.charAt(0);
   // a fresh quote prints no age; an old, untimed or future-dated one says so beside the change
   const note=I.quoteNote(b,at,open),line=(q.chgTxt?'<span class="delta '+(c==='+'?'up':c==='\u2212'?'dn':'flat')+'">'+esc(q.chgTxt)+'</span>':'')+(note?'<span class="sd warn"></span> '+esc(note):'');
   return '<button type="button" class="tile sm'+(TD_MKT_TV.includes(id)?'':' tv-hide')+'" data-go="money/markets" data-key="'+esc(id)+'"><span class="h">'+esc(label)+'</span><b class="v">'+esc(q.price)+'</b>'+
    (line?'<span class="t">'+line+'</span>':'')+(sp.filter(x=>x!=null).length>1?UI().spark(sp,{w:120,h:24}):'')+'</button>'}).filter(Boolean);
  if(!tiles.length)return {html:'',miss:[tdMiss('markets',{error:'no quotes in the feed'})]};
  return {miss:[],html:'<h2 class="secttl"><span>Markets</span></h2>'+UI().strip(tiles.join(''),{label:'Markets'})}}

 // ---- glance tiles: Surf (best home spot), Real estate, Shop (watch drops), Hockey, On this day, Search clicks. A tile is absent when its feed did
 // not report (its name joins the checks row) or when it has nothing to say; a tile opens its tab. ----
 // Decision 4 (`now.height_basis`): spot and sensor are the break's own height and print as the break's. region is the area's blend, so the tile
 // names the region and prints the region's height ("Surf · Orange County", "4-5 ft"), never as the break's; the break keeps its rating word
 // beside its name. A feed without the field is read as region (Main, 2026-11-15): an unmarked height is never claimed for one break.
 const tdHt=a=>{const w=arr(a).map(num);if(w[0]==null)return null;const lo=Math.round(w[0]),hi=w[1]==null?lo:Math.round(w[1]);return lo===hi?String(lo):lo+'-'+hi};
 function tdSurfTile(s){if(!tdOk(s))return null;
  const home=arr(s.spots).filter(x=>isObj(x)&&num(x.pinned)!=null&&isObj(x.now)&&num(arr(x.now.wave_ft)[0])!=null);if(!home.length)return null;
  const r=x=>num(x.now.rating)==null?-1:x.now.rating,best=home.slice().sort((a,b)=>r(b)-r(a)||a.pinned-b.pinned)[0],word=str(best.now.word,10),
   own=['spot','sensor'].includes(str(best.now.height_basis,12)),mo=x=>isObj(x.now)&&isObj(x.now.confidence)&&x.now.confidence.model_only===true,
   rg=own?null:arr(s.regions).find(x=>isObj(x)&&x.id===best.region),rh=rg?tdHt(rg.wave_ft):null;
  const pip=num(best.now.rating)!=null&&word?UI().pips(Math.max(0,Math.min(5,Math.round(best.now.rating/2))),word):'';
  // a region with no height of its own in the feed: no figure is claimed for the break, the tile is absent
  if(!own&&rh==null)return null;
  const ht=own?tdHt(best.now.wave_ft):rh,model=own?mo(best):arr(s.spots).filter(x=>isObj(x)&&x.region===best.region).every(mo);
  return {key:'surf',go:'surf',h:'Surf \u00B7 '+(own?(str(best.name,40)||'Home spot'):(str(rg.name,40)||str(rg.id,40))),v:(model?'<span class="model">'+esc(ht)+'</span>':esc(ht))+'<span class="u">ft</span>',
   t:own?pip:pip+'<span>'+esc(str(best.name,40))+'</span>'}}
 function tdEstateTile(sum,zr,place){const rate=tdOk(sum)&&isObj(sum.mortgage)?num(sum.mortgage.rate_30y):null,yoy=tdOk(zr)?num(zr.value_trend_1y):null;
  if(yoy!=null){const m=isObj(zr.x)&&isObj(zr.x.m)&&isObj(zr.x.m.value_trend_1y)?zr.x.m.value_trend_1y:null,c=m?num(m.c):null;
   return {key:'housing',go:'realestate/residential',h:'Real estate \u00B7 '+(str(place,40)||str(zr.city,40)||str(zr.zip,5)),v:esc(UI().fmt.chg(yoy))+'<span class="u">1-yr</span>'+(c!=null?UI().conf(c):''),t:rate!=null?esc('30-yr rate '+UI().fmt.rate(rate)):''}}
  if(rate!=null)return {key:'housing',go:'realestate/residential',h:'30-year rate',v:esc(UI().fmt.rate(rate)),t:''};
  return null}
 // "rtx 4080" reads "RTX 4080": a short all-letter word in front of a number is a model prefix
 const tdLabel=s=>{const w=str(s,40).split(/\s+/).filter(Boolean);return w.map((x,i)=>/^[a-z]{2,4}$/.test(x)&&/\d/.test(w[i+1]||'')?x.toUpperCase():i?x:x.charAt(0).toUpperCase()+x.slice(1)).join(' ')};
 // a listing's condition in Shop's words (static/pages/shop.js COND_WORD and offerOf; tests/today_glance.test.js keeps the two maps equal).
 // Only for the non-new listing (`best_used`): no condition there is "not new", never read as new.
 const TD_COND={used:'used',refurbished:'refurbished',open_box:'open box',unknown:'condition not stated'};
 const tdCond=s=>{const c=str(s,20).toLowerCase().replace(/[\s-]+/g,'_');return c&&c!=='new'?TD_COND[c]||c.replace(/_/g,' '):'not new'};
 function tdShopTile(e){if(!tdOk(e)||!isObj(e.watches))return null;const items=arr(e.watches.items).filter(isObj);if(!items.length)return null;
  const drops=items.filter(x=>num(x.change_7d)!=null&&x.change_7d<0).sort((a,b)=>a.change_7d-b.change_7d);
  if(!drops.length)return {key:'shop',go:'shop/market',h:'Shop \u00B7 watches',v:esc(UI().fmt.count(items.length)),
   t:items.every(x=>num(x.change_7d)!=null)?'No drops this week':items.some(x=>num(x.change_7d)!=null)?'No reported drops this week':'7-day changes not reported'};
  // the figure is what Shop leads with: the watch's best price (a new listing; else the lowest other one, with Shop's own condition word:
  // "refurbished", "used", "open box", "not new" when the feed gives none). The median follows in words with its 7-day change, as two whole
  // parts the tile wraps between (no "·" left at a line end). A watch with no listing keeps the median as its figure and says "median".
  const x=drops[0],med=num(x.median),nb=isObj(x.best)?num(x.best.price):null,ub=nb==null&&isObj(x.best_used)?num(x.best_used.price):null,best=nb!=null?nb:ub;
  const chg='<span class="td-nw"><span class="delta dn">'+esc(UI().fmt.chg(x.change_7d))+'</span> 7 days</span>',h='Shop \u00B7 '+(tdLabel(x.label)||'Watch');
  if(best!=null)return {key:'shop',go:'shop/market',h,v:esc(UI().fmt.money(best))+(nb==null?'<span class="u">'+esc(tdCond(x.best_used.condition))+'</span>':''),
   t:(med!=null?'<span class="td-nw">'+esc('median '+UI().fmt.money(med))+'</span>':'')+chg};
  return {key:'shop',go:'shop/market',h,v:med!=null?esc(UI().fmt.money(med))+'<span class="u">median</span>':'<span class="delta dn">'+esc(UI().fmt.chg(x.change_7d))+'</span>',
   t:med!=null?chg:'7 days'}}
 // ---- Hockey: one tile; every tracked team (and every live game) in its sheet ----
 // The tile shows, in this order: a live game of a tracked team; else the team whose next game is soonest; else the first team with a record.
 // It opens the sheet; the sheet keeps the official GameCenter links (hockeyLink: nhl.com /gamecenter/ paths only).
 // a time never breaks from its "am" or "pm" ("5:00" / "pm" in a narrow tile, LayoutT row 3)
 const tdWhen=at=>new Date(at*1000).toLocaleDateString('en-US',{weekday:'short'})+' '+UI().fmt.time(at).replace(' ','\u00A0');
 function tdHockeyTile(h,now){if(!tdOk(h))return null;const t0=(now==null?Date.now():now)/1000,g=arr(h.live).filter(isObj)[0];
  if(g)return {key:'hockey',open:'today-hockey',h:'Hockey \u00B7 live',v:esc(str(g.score,12)||'Live'),t:esc(str(g.away,6)+' at '+str(g.home,6)+(num(g.period)!=null?' \u00B7 P'+g.period:''))};
  const teams=arr(h.teams).filter(isObj),nextAt=x=>{const a=isObj(x.next_game)?toEpoch(x.next_game.at):null;return a!=null&&a>=t0?a:null};
  const soon=teams.filter(x=>nextAt(x)!=null).sort((a,b)=>nextAt(a)-nextAt(b))[0],tm=soon||teams.find(x=>str(x.record,16));if(!tm)return null;
  const n=isObj(tm.next_game)?tm.next_game:null,at=nextAt(tm),rec=str(tm.record,16);
  const next=at!=null?'Next '+(n.home===false?'at ':'')+(str(n.opp,6)||'game')+' '+tdWhen(at):str(tm.standing,24);
  return {key:'hockey',open:'today-hockey',h:'Hockey \u00B7 '+(str(tm.name,30)||str(tm.abbr,6)||'Team'),v:esc(rec||(at!=null?tdWhen(at):'No data')),t:esc(rec?next:'')}}
 const TD_ND='No data';
 function tdHockeySheet(h,now){if(!tdOk(h))return UI().empty({k:'bad',title:'Hockey is not reporting'});
  const t0=(now==null?Date.now():now)/1000;
  // the collector writes a live score home first ("1-2" is the home team's 1)
  const live=arr(h.live).filter(isObj).map(g=>{const u=hockeyLink(g),tag=u?'a':'div',sc=str(g.score,12);
   return '<'+tag+(u?' href="'+esc(u)+'" target="_blank" rel="noopener noreferrer"':'')+' class="frow"><span class="fl"><b>'+esc((str(g.away,6)||'Away')+' at '+(str(g.home,6)||'home'))+'</b><small>'+
    esc('Live'+(num(g.period)!=null?' \u00B7 Period '+g.period:'')+(str(g.clock,8)?' \u00B7 '+str(g.clock,8):''))+'</small></span><span class="fr"><b>'+esc(sc||TD_ND)+'</b>'+(sc?'<small>'+esc((str(g.home,6)||'Home')+' first')+'</small>':'')+'</span></'+tag+'>'});
  const teams=arr(h.teams).filter(isObj).map(t=>{const l=isObj(t.last_game)?t.last_game:null,n=isObj(t.next_game)?t.next_game:null,at=n?toEpoch(n.at):null,u=hockeyLink(n),tag=u?'a':'div',pts=num(t.points);
   const rec=[str(t.record,16)||'Record: '+TD_ND,str(t.standing,24)||'Standing: '+TD_ND,pts!=null?pts+(pts===1?' pt':' pts'):''].filter(Boolean).join(' \u00B7 ');
   const last=l&&(str(l.result,4)||str(l.score,12))?'Last: '+[str(l.result,4),str(l.score,12),str(l.opp,6)?'vs '+str(l.opp,6):''].filter(Boolean).join(' '):'Last: '+TD_ND;
   const next=n&&at!=null?'Next: '+(n.home===false?'at ':'vs ')+(str(n.opp,6)||'TBD')+' \u00B7 '+tdWhen(at):'Next: '+TD_ND;
   const form=str(t.form,24)?'<small>'+esc('Form '+str(t.form,24))+'</small>':'';
   return '<'+tag+(u?' href="'+esc(u)+'" target="_blank" rel="noopener noreferrer"':'')+' class="frow"><span class="fl"><b>'+esc(str(t.name,30)||str(t.abbr,6)||'Team')+'</b><small>'+esc(rec)+'</small><small>'+esc(last)+'</small><small>'+esc(next)+'</small>'+form+'</span></'+tag+'>'});
  if(!live.length&&!teams.length)return UI().empty({title:'No games or standings yet',line:'Team records and games show here after the next collection.'});
  return '<div class="flist">'+live.join('')+teams.join('')+'</div>'}
 // the On this day tile opens the On this day sheet (the Almanac's day, photos on this date, the years chart and the link into the Almanac)
 function tdPhotoTile(od){if(!tdOk(od))return null;const tot=num(od.total);if(tot==null||tot<=0)return null;
  const yrs=arr(od.years).filter(y=>isObj(y)&&num(y.count)>0).length;
  return {key:'onthisday',open:'today-day',h:'On this day',v:esc(UI().fmt.count(tot))+'<span class="u">'+(tot===1?'photo':'photos')+'</span>',t:yrs?esc('in '+tdCount(yrs,'earlier year','earlier years')):''}}
 // L23: Vercel Web Analytics page views (the traffic feed's `vercel` block): per Vercel project, so a row names every domain the project serves.
 // The figure is the sum over the owner's tracked projects that have a reading; a project without one is never counted as zero.
 function tdVercel(tr){const v=isObj(tr)&&!tr.error&&isObj(tr.vercel)&&tr.vercel.status==='ok'?tr.vercel:null;if(!v)return null;
  const ps=arr(v.projects).filter(p=>isObj(p)&&str(p.domain,253)),ok=p=>p.status==='ok'&&num(p.pageviews)!=null,mine=ps.filter(p=>p.tracked===true&&ok(p));if(!mine.length)return null;
  const d=x=>/^\d{4}-\d{2}-\d{2}$/.test(str(x,10))?str(x,10):'',s=d(v.start_date),e=d(v.end_date);
  return {views:mine.reduce((t,p)=>t+p.pageviews,0),visitors:mine.every(p=>num(p.visitors)!=null)?mine.reduce((t,p)=>t+p.visitors,0):null,
   days:s&&e?Math.round((new Date(e+'T12:00:00')-new Date(s+'T12:00:00'))/864e5)+1:null,start:s,end:e,tracked:ps.filter(p=>p.tracked===true),more:ps.filter(p=>p.tracked!==true),ok}}
 // One traffic tile (baseline problem 29: one number, one label, one qualifier at most). With page views the figure is page views and the small
 // line carries the search clicks ("Search clicks 56"), so both stay on Today; without the Vercel block it is the Search clicks tile. The goal,
 // sites, impressions, per-project views and the window totals are in the traffic sheet it opens; the method is in the Data sheet.
 function tdTrafficTile(tr){const vz=tdVercel(tr);if(!vz&&(!isObj(tr)||tr.error||String(tr.status||'').toLowerCase()==='unavailable'))return null;
  const d=isObj(tr.daily)?tr.daily:null,a=d&&isObj(d.aggregate)?d.aggregate:null,c=a?num(a.clicks):null,clicks=c!=null&&c>=0&&String(tr.status||'').toLowerCase()!=='unavailable'?c:null;
  const tracked=a?num(a.tracked):null,measured=a?num(a.measured)||0:0,part=!!a&&a.complete!==true&&!!tracked,day=d&&/^\d{4}-\d{2}-\d{2}$/.test(str(d.date,10))?UI().fmt.date(str(d.date,10)):'';
  // the clicks keep their "2 of 3 sites" qualifier under page views too: a partial count never reads as the whole
  if(vz)return {key:'traffic',open:'today-traffic',h:'Page views'+(vz.days?' \u00B7 '+vz.days+' days':''),v:esc(UI().fmt.count(vz.views)),
   t:clicks!=null?esc('Search clicks '+UI().fmt.count(clicks)+(part?' \u00B7 '+measured+' of '+tracked+' sites':'')):''};
  if(clicks==null)return null;
  return {key:'traffic',open:'today-traffic',h:'Search clicks',v:esc(UI().fmt.count(clicks)),t:esc(part?measured+' of '+tracked+' sites':day)}}
 const tdTrafficOk=tr=>isObj(tr)&&!tr.error&&(String(tr.status||'').toLowerCase()!=='unavailable'||!!tdVercel(tr));
 // the one same-origin page Today links to, by name: the href is always this fixed literal, never a value from a feed (safeUrl refuses relative paths)
 const TD_PATHS={almanac:'/almanac/'};
 // a tile opens its tab (go) or its sheet (open); nothing else
 function tdTile(t){const tag=t.go||t.open?'button':'div',at=t.go?' type="button" data-go="'+esc(t.go)+'"':t.open?' type="button" data-open="'+esc(t.open)+'"':'';
  return '<'+tag+at+' class="tile'+(t.key==='surf'?'':' tv-hide')+'" data-key="'+esc(t.key)+'"><span class="h">'+esc(t.h)+'</span><b class="v">'+t.v+'</b>'+(t.t?'<span class="t">'+t.t+'</span>':'')+'</'+tag+'>'}
 // the Almanac (owner-only /almanac/ proxy) is always one tap away through the On this day sheet: the tile opens it; on a day with no photos, or
 // when the photo feed did not report, one quiet row takes the tile's place and opens the same sheet. Never on the TV board.
 const tdAlmanacRow=()=>'<div class="flist tv-hide td-alm"><button type="button" class="frow" data-open="today-day"><span class="fl"><b>Almanac</b><small>Your history, 2006 to now</small></span></button></div>';
 // o = {surf, summary, zip, place, ecom, hockey, onthisday, traffic}
 function tdGlance(o){const miss=[],tiles=[],add=(key,f,ok,t)=>{if(!ok)miss.push(tdMiss(key,f));else if(t)tiles.push(t)};
  add('surf',o.surf,tdOk(o.surf),tdSurfTile(o.surf));
  const est=tdEstateTile(o.summary,o.zip,o.place);
  if(!est)miss.push(tdMiss('housing',tdOk(o.summary)?o.zip:o.summary));else tiles.push(est);
  add('shop',o.ecom,tdOk(o.ecom),tdShopTile(o.ecom));
  add('hockey',o.hockey,tdOk(o.hockey),tdHockeyTile(o.hockey,o.now));
  add('onthisday',o.onthisday,tdOk(o.onthisday),tdPhotoTile(o.onthisday));
  add('traffic',o.traffic,tdTrafficOk(o.traffic),tdTrafficTile(o.traffic));
  // tv: the board keeps only the home-spot tile; without it the glance row stays off the board
  const alm=tiles.some(t=>t.open==='today-day')?'':tdAlmanacRow();
  return {miss,tiles,tv:tiles.some(t=>t.key==='surf'),html:'<h2 class="secttl"><span>At a glance</span></h2>'+(tiles.length?UI().strip(tiles.map(tdTile).join(''),{label:'At a glance'}):'')+alm}}

 // ---- what the glance reads (SeePerf P2): /api/today carries three slices the server cuts from the same answers the full routes serve
 // (rust/src/todayslices.rs): surf_best (the pinned home spots), shop_moves (the watches) and home_area ({zip, name}, or {zip: null, reason}).
 // A malformed or absent slice reads the full feed. Explicit empty/null values stay distinct from omitted fields; a failed slice uses
 // the registry's same bounded, role-cleared last-good pool as a failed full route, without holding back fresh Needs you or Alerts.
 const TD_SLICE={surf:'surf_best',ecom:'shop_moves'};
 const tdHomeSpot=x=>isObj(x)&&num(x.pinned)!=null&&isObj(x.now)&&num(arr(x.now.wave_ft)[0])!=null;
 const tdMaybeNum=v=>v===null||typeof v==='number'&&Number.isFinite(v);
 const tdWave=v=>v===null||Array.isArray(v)&&v.length>0&&v.every(tdMaybeNum);
 const tdSurfShape=(v,slice)=>isObj(v)&&Array.isArray(v.spots)&&v.spots.every(s=>isObj(s)&&typeof s.region==='string'&&('pinned' in s)&&tdMaybeNum(s.pinned)&&
  (s.now==null||isObj(s.now))&&(s.pinned===null||typeof s.name==='string'&&isObj(s.now)&&
   ('wave_ft' in s.now)&&tdWave(s.now.wave_ft)&&(!slice||'rating' in s.now&&'word' in s.now&&'height_basis' in s.now&&'confidence' in s.now)&&
   (!('rating' in s.now)||tdMaybeNum(s.now.rating))&&(!('word' in s.now)||s.now.word===null||typeof s.now.word==='string')&&
   (!('height_basis' in s.now)||s.now.height_basis===null||typeof s.now.height_basis==='string'))&&
  (!s.now||s.now.confidence==null||isObj(s.now.confidence)&&(!slice||'model_only' in s.now.confidence)&&
   (!('model_only' in s.now.confidence)||s.now.confidence.model_only===null||typeof s.now.confidence.model_only==='boolean')))&&
  (v.regions===undefined||Array.isArray(v.regions)&&v.regions.every(r=>isObj(r)&&typeof r.id==='string'&&typeof r.name==='string'&&tdWave(r.wave_ft)));
 const tdOffer=(v,used)=>v===null||isObj(v)&&('price' in v)&&tdMaybeNum(v.price)&&(!used||'condition' in v)&&
  (!('condition' in v)||v.condition===null||typeof v.condition==='string');
 const tdShopShape=(v,slice)=>isObj(v)&&isObj(v.watches)&&Array.isArray(v.watches.items)&&v.watches.items.every(x=>isObj(x)&&
  typeof x.label==='string'&&('median' in x)&&tdMaybeNum(x.median)&&('change_7d' in x)&&tdMaybeNum(x.change_7d)&&
  ('best' in x)&&tdOffer(x.best)&&('best_used' in x)&&tdOffer(x.best_used,slice));
 function tdSlice(t,k){const v=isObj(t)&&!t.error&&TD_SLICE[k]?t[TD_SLICE[k]]:null;if(!isObj(v))return null;
  if(tdOk(v)&&!(k==='surf'?tdSurfShape(v,true):tdShopShape(v,true)))return null;
  // the Surf slice holds the pinned spots, and (when the server sends regions) the regions they sit in with every spot of those regions.
  // When a home spot has a height but the slice draws no tile (a region height the slice does not carry), the full feed is read.
  if(k==='surf'&&tdOk(v)&&!tdSurfTile(v)&&arr(v.spots).some(tdHomeSpot))return null;
  return v}
 // the home market from /api/today's home_area: {zip, name}; {error: reason} when the server names none; null when the field is absent
 function tdHomeOf(t){const a=isObj(t)&&!t.error?t.home_area:null;if(!isObj(a))return null;
  if(!tdOk(a))return {error:str(a.error,160)||str(a.reason,160)||'home market is not reporting'};
  if(a.zip===null&&typeof a.reason==='string'&&a.reason.trim())return {error:a.reason.slice(0,160)};
  const z=typeof a.zip==='string'||typeof a.zip==='number'?String(a.zip):'';
  return /^\d{5}$/.test(z)&&typeof a.name==='string'?{zip:z,name:a.name.slice(0,40)}:null}
 // P3: seconds between reads of a feed while Today sits open (the page refreshes every 30 s). Listed: what Today draws but never warns about
 // or acts on, read again at about a quarter of its writer's period, so a new write shows within a quarter period: markets and the watch
 // (written every 5 min), weather (the server keeps a line 10 to 30 min), hockey (15 min), traffic and the full Shop feed (hourly), the
 // full Surf feed (30 min), the national housing summary and the home ZIP (a weekly build), on this day (daily). Not listed, read every
 // time: Needs you and Alerts (products, testflight, schedules, today, replyblock, health), the rows with a warn mark (cameras, car, Home
 // Assistant, cluster, renewals) and the calendar's next event. Opening the page or Try again reads everything.
 const TD_EVERY={markets:75,watch:75,weather:150,hockey:225,surf:450,traffic:900,ecom:900,summary:3600,zip:3600,onthisday:3600};
 // whether this refresh reads feed k at path p again; last = {path, at, ok} of its last read (ok: answered fresh and passed)
 function tdDue(k,p,last,now,tick){return !tick||!(TD_EVERY[k]>0)||!isObj(last)||last.ok!==true||last.path!==p||!(num(last.at)!=null&&now-last.at<TD_EVERY[k]*1000)}

 // ---- On this day sheet: the Almanac's day (GET /almanac/api/today, owner only), the photos on this date per year (/api/onthisday), the years
 // chart with dated and undated totals (/api/photoyears; bright bars are years with a photo on this date), then the one link into the Almanac ----
 const tdHm=s=>{const m=/^(\d{1,2}):(\d{2})$/.exec(str(s,5));if(!m)return '';const h=+m[1];return ((h%12)||12)+':'+m[2]+' '+(h<12?'am':'pm')};
 function tdAlmDay(a){const c=UI().fmt.count;
  if(!isObj(a)||a.error||!isObj(a.now))return '<section class="sh-sec"><h3>Almanac</h3>'+UI().empty({title:'The Almanac is not answering',line:'This part fills in when the Almanac runs on this computer.'})+'</section>';
  const n=a.now,sun=isObj(a.sun)?a.sun:{},moon=isObj(a.moon)?a.moon:{},ev=isObj(a.events)?a.events:{},pl=isObj(a.places)?a.places:{},ymd=str(n.date,10);
  const day=[str(n.weekday,10),str(n.month,10)&&/^\d{4}-\d{2}-\d{2}$/.test(ymd)?str(n.month,10)+' '+parseInt(ymd.slice(8),10):''].filter(Boolean).join(', ')||'Today';
  const when=[num(n.day_of_year)!=null?'Day '+c(n.day_of_year)+(num(n.days_left_in_year)!=null?', '+c(n.days_left_in_year)+' left':''):'',num(n.iso_week)!=null?'week '+c(n.iso_week):''].filter(Boolean).join(' \u00B7 ');
  const rows=[tdSRow(day,when),tdSRow('Sun',sun.available===false?'Not available':[tdHm(sun.sunrise)?'Sunrise '+tdHm(sun.sunrise):'',tdHm(sun.sunset)?'sunset '+tdHm(sun.sunset):'',str(sun.day_length,20)?str(sun.day_length,20)+' of daylight':''].filter(Boolean).join(' \u00B7 ')||TD_ND)];
  if(str(moon.phase,24))rows.push(tdSRow('Moon',str(moon.phase,24)+(num(moon.illumination_percent)!=null?', '+Math.round(moon.illumination_percent)+'% lit':'')));
  const ys=arr(ev.years).filter(y=>isObj(y)&&num(y.year)!=null&&num(y.total)!=null);
  const journal=ev.available===false?[tdSRow('Journal','Not available')]:ys.length?ys.map(y=>tdSRow(String(y.year),num(y.years_ago)>0?tdCount(y.years_ago,'year ago','years ago'):'',c(y.total),y.total===1?'entry':'entries')):[tdSRow('Nothing recorded on this date')];
  const spots=[];arr(pl.years).filter(y=>isObj(y)&&num(y.year)!=null).forEach(y=>{[['exact','on this date'],['near','near this date']].forEach(([k,w])=>arr(y[k]).filter(isObj).forEach(p=>spots.push(tdSRow(str(p.place,40)||'A place',y.year+' \u00B7 '+w))))});
  const places=pl.available===false?[tdSRow('Places','Not available')]:spots.length?spots.slice(0,12):[tdSRow('No place recorded on this date')];
  return tdSec('The day',rows)+tdSec('Journal on this date',journal)+tdSec('Places on this date',places)}
 // a sheet has room for the whole number: "29,357", never "29.4K"
 const tdFull=v=>Math.round(v).toLocaleString('en-US');
 function tdOdSec(od){const c=tdFull,tot=tdOk(od)?num(od.total):null,md=tdOk(od)?str(od.month_day,5):'';
  const h='Photos on '+(/^\d{2}-\d{2}$/.test(md)?UI().fmt.date('2000-'+md):'this date');
  if(tot==null)return tdSec(h,[tdSRow('Photos on this date','Not reporting')]);
  if(tot===0)return tdSec(h,[tdSRow('None','No photo or video was taken on this date before.')]);
  const ys=arr(od.years).filter(y=>isObj(y)&&num(y.year)!=null&&num(y.count)!=null).sort((a,b)=>b.year-a.year);
  return '<section class="sh-sec"><h3>'+esc(h)+'</h3><p class="note">'+esc(c(tot)+(tot===1?' photo or video':' photos and videos')+' in '+tdCount(ys.length,'earlier year','earlier years'))+'</p>'+
   UI().bars(ys.map(y=>({label:String(y.year),value:y.count})),{sort:false})+'</section>'}
 function tdYearsSec(py,od){const c=tdFull,tot=tdOk(py)?num(py.dated_total):null;if(tot==null)return tdSec('Photos by year',[tdSRow('Photos by year','Not reporting')]);
  const und=num(py.undated),ys=arr(py.years).filter(y=>isObj(y)&&num(y.year)!=null).map(y=>({year:y.year,n:(num(y.image)||0)+(num(y.video)||0)})).sort((a,b)=>a.year-b.year).slice(-40);
  const hit=new Set(arr(tdOk(od)&&od.years).filter(y=>isObj(y)&&num(y.count)>0).map(y=>y.year)),max=ys.reduce((m,y)=>Math.max(m,y.n),0),big=ys.reduce((b,y)=>!b||y.n>b.n?y:b,null);
  const chart=ys.length&&max>0?'<div class="td-years" role="img" aria-label="'+esc('Photos and videos per year, '+ys[0].year+' to '+ys[ys.length-1].year+(big?', most in '+big.year:''))+'">'+
   ys.map(y=>'<i'+(hit.has(y.year)?' class="on"':'')+' style="--h:'+(y.n>0?Math.max(3,Math.round(100*y.n/max)):0)+'%" title="'+esc(y.year+': '+c(y.n))+'"></i>').join('')+'</div>'+
   '<div class="td-yax"><span>'+esc(ys[0].year)+'</span><span>'+esc(ys[ys.length-1].year)+'</span></div>':'';
  const note=[c(tot)+' dated',und!=null?c(und)+' without a date':'Without a date: '+TD_ND,big&&big.n>0?'most in '+big.year+' ('+c(big.n)+')':'',chart&&hit.size?'bright bars have a photo on this date':''].filter(Boolean).join(' \u00B7 ');
  return '<section class="sh-sec"><h3>Photos by year</h3>'+chart+'<p class="note sm">'+esc(note)+'</p></section>'}
 // the sheet opens on the photo figures (they come from the deck, so they show while the Almanac sleeps), then the Almanac's day, the years
 function tdDaySheet(a,od,py){const tot=tdOk(od)?num(od.total):null,yrs=tdOk(od)?arr(od.years).filter(y=>isObj(y)&&num(y.count)>0).length:null,dated=tdOk(py)?num(py.dated_total):null;
  return UI().strip([UI().tile({label:'Photos on this date',value:tot!=null?tdFull(tot):TD_ND}),UI().tile({label:'Earlier years',value:yrs!=null&&tot!=null?String(yrs):TD_ND}),UI().tile({label:'Dated photos',value:dated!=null?tdFull(dated):TD_ND})])+
   tdAlmDay(a)+tdOdSec(od)+tdYearsSec(py,od)+'<p><a class="btn" href="'+TD_PATHS.almanac+'" target="_blank" rel="noopener">Open the Almanac</a></p>'}

 // ---- Website traffic sheet: page views per Vercel project first when the feed has them (L23: the window's totals, then each tracked project
 // with every domain it serves; other projects fold under "N more projects"), then the latest complete day of search clicks against the goal,
 // each tracked site that day, and the window totals per site with impressions; other properties fold under "N more sites". A site or a project
 // without a reading says so in words, never zero. ----
 const tdSiteRow=s=>{const c=UI().fmt.count,v=num(s.value),im=num(s.impressions),d=str(s.domain,60)||'Site';
  return v!=null?tdSRow(d,'',c(v)+(v===1?' click':' clicks'),im!=null?c(im)+' impressions':''):tdSRow(d,String(s.reason||'').toLowerCase()==='no_access'?'No Search Console access':'No reading')};
 function tdViewsSec(vz){const c=UI().fmt.count,row=p=>{const also=arr(p.domains).map(x=>str(x,60)).filter(x=>x&&x!==str(p.domain,60));
   return vz.ok(p)?tdSRow(str(p.domain,60),also.length?'Also '+also.slice(0,3).join(', ')+(also.length>3?' and '+(also.length-3)+' more':''):'',c(p.pageviews)+' page views',num(p.visitors)!=null?c(p.visitors)+' visitors':''):tdSRow(str(p.domain,60),'No reading')};
  // the sheet opens on its figures (first data on a TV sheet): the window rides in the tiles' small line, not in a heading above them
  const win=(vz.days?'Last '+vz.days+' days':'')+(vz.start&&vz.end?(vz.days?', ':'')+UI().fmt.date(vz.start)+' to '+UI().fmt.date(vz.end):'');
  // visitors are counted per Vercel project, so the total says it is a sum: one person on two projects counts twice
  return UI().strip([UI().tile({label:'Page views',value:c(vz.views),sub:win}),UI().tile({label:'Visitors',value:vz.visitors!=null?c(vz.visitors):TD_ND,sub:vz.visitors!=null?'Summed across projects':''})])+
   '<div class="flist">'+vz.tracked.map(row).join('')+'</div>'+
   (vz.more.length?'<details class="td-more"><summary>'+esc(tdCount(vz.more.length,'more project','more projects'))+'</summary><div class="flist">'+vz.more.map(row).join('')+'</div></details>':'')}
 function tdTrafficSheet(tr){if(!tdTrafficOk(tr))return UI().empty({k:'bad',title:'Website traffic is not reporting'});
  const vz=tdVercel(tr);if(vz&&String(tr.status||'').toLowerCase()==='unavailable')return tdViewsSec(vz);
  const c=UI().fmt.count,d=isObj(tr.daily)?tr.daily:null,a=d&&isObj(d.aggregate)?d.aggregate:null,clicks=a?num(a.clicks):null,goal=d?num(d.goal):null,pct=a?num(a.pct):null,
   ymd=d?str(d.date,10):'',part=!!a&&a.complete!==true,tracked=a?num(a.tracked):null;
  const day=/^\d{4}-\d{2}-\d{2}$/.test(ymd)?UI().fmt.date(ymd):'';
  // the latest complete day leads the sheet with its figures, then each tracked site that day
  const daily=clicks==null?'<div class="flist">'+tdSRow('Latest complete day'+(day?', '+day:''),'No reading')+'</div>':
   UI().strip([UI().tile({label:'Clicks',value:c(clicks),sub:[day,part&&tracked?(num(a.measured)||0)+' of '+tracked+' sites':''].filter(Boolean).join(' \u00B7 ')}),UI().tile({label:'Daily goal',value:goal!=null?c(goal):TD_ND}),
    UI().tile({label:'Of goal',value:pct!=null?(Math.round(pct*10)/10)+'%':TD_ND,sub:part&&pct!=null?'at least':''})])+
   (pct!=null?UI().bars([{label:'Toward the goal',value:Math.min(100,Math.max(0,pct)),text:(Math.round(pct*10)/10)+'%'}],{max:100,sort:false}):'')+
   '<div class="flist">'+arr(d.sites).filter(s=>isObj(s)&&s.tracked!==false).map(tdSiteRow).join('')+'</div>';
  const all=arr(tr.sites).filter(isObj),mine=all.filter(s=>s.tracked!==false),more=all.filter(s=>s.tracked===false);
  const w=mine.concat(more).find(s=>/^\d{4}-\d{2}-\d{2}$/.test(str(s.start_date,10))&&/^\d{4}-\d{2}-\d{2}$/.test(str(s.end_date,10)));
  const days=w?Math.round((new Date(w.end_date+'T12:00:00')-new Date(w.start_date+'T12:00:00'))/864e5)+1:null;
  const read=mine.filter(s=>num(s.value)!=null),sum=k=>read.reduce((t,s)=>t+(num(s[k])||0),0),imps=read.filter(s=>num(s.impressions)!=null);
  const winH=(days>0?'Last '+days+' days':'Search totals')+(w?', '+UI().fmt.date(w.start_date)+' to '+UI().fmt.date(w.end_date):'');
  const totals=!all.length?'':'<section class="sh-sec"><h3>'+esc(winH)+'</h3>'+
   (read.length?UI().strip([UI().tile({label:'Clicks',value:c(sum('value')),sub:read.length<mine.length?read.length+' of '+mine.length+' sites':''}),UI().tile({label:'Impressions',value:imps.length?c(sum('impressions')):TD_ND})]):'')+
   '<div class="flist">'+mine.map(tdSiteRow).join('')+'</div>'+
   (more.length?'<details class="td-more"><summary>'+esc(tdCount(more.length,'more site','more sites'))+'</summary><div class="flist">'+more.map(tdSiteRow).join('')+'</div></details>':'')+'</section>';
  return vz?tdViewsSec(vz)+'<section class="sh-sec"><h3>Search clicks</h3>'+daily+'</section>'+totals:daily+totals}

 // ---- one freshness mark for the page (DeckPages.mark). The age is the oldest of the decision feeds. "Out of date" comes only from a feed
 // the server itself marked stale (its age over 2x its own refresh); otherwise no refresh is passed, so a missing part says what is missing
 // ("2 parts not reporting") instead of a fast feed's two-minute age reading as out of date. Cluster (60 s) is not a decision feed.
 const TD_CORE=['products','deadlines','calendar','schedules','markets'];
 function tdFresh(feeds,miss,now){const fs=TD_CORE.map(k=>isObj(feeds)?feeds[k]:null).filter(tdOk).map(f=>({age:toEpoch(f.t)==null?null:Math.max(0,now/1000-toEpoch(f.t)),refresh:num(f.refresh),stale:f.stale===true}))
   .filter(f=>f.age!=null);
  const old=fs.filter(f=>f.stale&&f.refresh).sort((a,b)=>b.age/b.refresh-a.age/a.refresh)[0],lead=old||fs.sort((a,b)=>b.age-a.age)[0];
  return {age:lead?lead.age:null,refresh:old?old.refresh:null,missing:tdMissNames(arr(miss)).length}}

 // ---- sheets: the reasons behind the checks row, the job list behind the job rows, the rest of a capped list ----
 function tdChecksSheet(miss){return '<div class="flist">'+arr(miss).map(m=>'<div class="frow"><span class="fl"><b>'+esc(m.name)+'</b><small>'+esc(m.line)+'</small>'+
  arr(m.diag).map(d=>'<small class="raw">'+esc(redact(d))+'</small>').join('')+'</span></div>').join('')+'</div>'}
function tdJobsSheet(j){const one=(x,word)=>'<div class="frow"><span class="fl"><b>'+esc(sentence(str(x.name,80))||'Job')+'</b><small>'+esc([word,str(x.host,30),isObj(x.owner_wait)?clip(str(x.owner_wait.action,300)||str(x.owner_wait.reason,300),160):''].filter(Boolean).join(' \u00B7 '))+'</small></span></div>';
  const J=isObj(j)?j:{};return '<div class="flist">'+arr(J.wait).map(x=>one(x,'Waits on you')).join('')+arr(J.failed).map(x=>one(x,'Failing')).join('')+arr(J.over).map(x=>one(x,'Overdue')).join('')+'</div>'}
 // every step on its own row with its own why line ("Version 1.0 · submitted build 17"), none capped: the page groups, the sheet spells out
 const tdNeedsSheet=n=>'<div class="flist">'+arr(n&&n.items).map(x=>tdNeedRow(x)).join('')+'</div>';
 const tdDeadSheet=items=>'<div class="flist">'+arr(items).map(x=>tdDeadRow(x,0)).join('')+'</div>';
 // the reply drafts row's sheet: the counts, the cap line when threads were held over it, then each thread (who, subject, Draft ready or Held,
 // its draft and its thread in Gmail: gmailUrl lets mail.google.com through and nothing else), then the drafts folder. No message text.
 function tdReplySheet(rb){if(!tdOk(rb))return UI().empty({k:'bad',title:'Reply drafts are not reporting'});
  const c=isObj(rb.counts)?rb.counts:{},n=v=>num(v)==null?TD_ND:UI().fmt.count(v),drafted=num(c.drafted),cap=num(c.cap),over=num(c.over_cap),after=num(c.gmail_drafts_after),
   items=arr(rb.items).filter(isObj),held=items.filter(i=>i.drafted!==true).length,dry=rb.mode==='dry-run';
  const lines=[dry?'Dry run: nothing was drafted.':drafted>0?(isObj(rb.model)&&rb.model.used===true?'Written by the local model.':'Plain templates; the local model was offline.'):'',
   over>0?'Up to '+n(cap)+' drafts a day; '+tdCount(over,'thread was','threads were')+' held over the cap.':''].filter(Boolean);
  const link=(u,w)=>u?'<a class="btn btn-sm" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+w+'</a>':'';
  const rows=items.map(i=>{const ok=i.drafted===true,links=(ok?link(gmailUrl(str(i.draft_url,200)),'Open draft'):'')+link(gmailUrl(str(i.thread_url,200)),'Open thread');
   return '<div class="frow"><span class="fl"><b>'+esc(str(i.name,80)||'Unknown sender')+'</b><small>'+esc(str(i.subject,160)||'No subject')+'</small>'+(links?'<span class="td-links">'+links+'</span>':'')+
    '</span><span class="fr"><b>'+(ok?'Draft ready':'Held')+'</b></span></div>'});
  const all=gmailUrl(str(rb.drafts_url,200));
  return UI().strip([UI().tile({label:'Drafts ready',value:n(drafted)}),UI().tile({label:'Waiting on you',value:n(c.waiting)}),UI().tile({label:'Held',value:String(held)})])+
   lines.map(l=>'<p class="note sm">'+esc(l)+'</p>').join('')+
   tdSec('Threads',rows.length?rows:[tdSRow('Nothing is waiting on you','The overnight pass found no thread that needs a reply.')])+
   (all?'<div class="flist"><a class="frow" href="'+esc(all)+'" target="_blank" rel="noopener noreferrer"><span class="fl"><b>Open Gmail drafts</b><small>'+esc(after!=null?tdCount(after,'draft','drafts')+' in Gmail':'Drafts folder')+'</small></span></a></div>':'')}
 // the calendar sheet: every event the feed carries from today on (today's earlier events too), by day, each with its calendar
 function tdCalSheet(cal,acc,now){const evs=tdCalEvents(cal,acc,now),today=tdLocalKey(now);if(!evs)return UI().empty({k:'bad',title:'The calendar is not reporting'});
  const by=new Map();evs.filter(e=>e.date>=today).sort(tdEvSort).forEach(e=>{if(!by.has(e.date))by.set(e.date,[]);by.get(e.date).push(e)});
  if(!by.size)return UI().empty({title:'Nothing on the calendar',line:'Your calendar is clear for the coming days.'});
  const t=e=>e.all?'All day':e.start!=null?UI().fmt.time(e.start):TD_ND,to=e=>!e.all&&e.end!=null&&e.start!=null&&e.end>e.start?'to '+UI().fmt.time(e.end):'';
  // one list, a quiet day line over each day's events, so the first event is the sheet's first row
  return '<div class="flist">'+[...by].map(([k,l])=>'<div class="frow td-day" role="heading" aria-level="3"><span class="fl"><b>'+esc(tdDayWord(k,now))+'</b></span></div>'+l.map(e=>tdSRow(e.title,e.cal,t(e),to(e))).join('')).join('')+'</div>'}

 // ---- the Data sheet for Today: one row per feed, the traffic method; nothing here reaches the page ----
 const TD_GIVES={products:'Needs you',testflight:'App Review in Needs you',schedules:'Jobs in Needs you and Alerts',today:'Hermes and mail, next briefing',replyblock:'Reply drafts',deadlines:'Renewals and deadlines',
  calendar:'Next on the calendar',cams:'Cameras',car:'Car',ha:'Weather and printer',watch:'Apple Watch',cluster:'Cluster',markets:'Markets',surf:'Surf tile',summary:'30-year rate',zip:'Your market, 1 year',
  ecom:'Shop tile',hockey:'Hockey tile',onthisday:'On this day tile',traffic:'Website traffic tile',health:'Status in Alerts',almanac:'On this day sheet',photoyears:'Photos by year',
  weather:'Weather when Home Assistant has none'};
 TD_GIVES.serverpage='Gateway health and local mail schedule';
 const TD_SRC={products:'Products and App Store',testflight:'App Store Connect',schedules:'Schedulers',today:'Hermes and Gmail',replyblock:'Reply block',deadlines:'Renewals and paperwork',
  calendar:'Calendar agenda',cams:'Cameras',car:'Car',ha:'Home Assistant',watch:'Apple Watch',cluster:'Spark cluster',markets:'Market quotes',surf:'Surf coast feed',summary:'National housing data',
  zip:'National housing data, your ZIP',ecom:'E-commerce market feed',hockey:'NHL schedule and standings',onthisday:'Photo catalog',traffic:'Search Console and Vercel Web Analytics',health:'Fleet health check',
  almanac:'Almanac',photoyears:'Photo catalog, by year',weather:'Deck weather line'};
 TD_SRC.serverpage='Hermes health, local timers and cron metadata';
 function tdData(feeds,now){const f=isObj(feeds)?feeds:{};
  const sources=Object.keys(TD_SRC).filter(k=>k in f).map(k=>{const x=f[k],ok=k==='traffic'?tdTrafficOk(x):tdOk(x),t=ok?toEpoch(x.t):null;
   return {name:TD_SRC[k],gives:TD_GIVES[k],asOf:t!=null?ago(t,now):ok?'':'Not reporting',state:!ok?'never':x.stale===true?'stale':'ok'}});
  const tr=f.traffic,d=tdTrafficOk(tr)&&isObj(tr.daily)?tr.daily:null,a=d&&isObj(d.aggregate)?d.aggregate:null,vz=tdVercel(tr),
   method=[['Needs you','Your steps only: Now first, then Soon, then Later; steps of one kind share a row, each name its own link. Signal marks what waits on you.'],
    ['Alerts','What an agent can fix: failing jobs are red, checks that did not report and a fleet check that is only degraded are a warn triangle.']];
  if(vz)method.push(['Page views','Vercel Web Analytics page views'+(vz.days?' for the last '+vz.days+' days':'')+', summed over your tracked projects. A project counts all the domains it serves. A project without a reading is not counted as zero.']);
  if(a)method.push(['Search clicks','Organic search clicks for the latest complete day'+(str(d.date,10)?' ('+UI().fmt.date(str(d.date,10))+')':'')+(num(d.goal)!=null?', against a goal of '+UI().fmt.count(d.goal)+' a day':'')+
   '. '+(num(a.tracked)!=null?(num(a.measured)||0)+' of '+a.tracked+' sites measured. ':'')+'A site without a reading is not counted as zero. Clicks are not visits.']);
  // one row per site in the monitoring scope (an explicit tracked:false stays out); no access and no reading are said in words, never zero
  if(d)arr(d.sites).filter(s=>isObj(s)&&s.tracked!==false).forEach(s=>{const v=num(s.value);method.push([str(s.domain,60)||'Site',v!=null?UI().fmt.count(v)+' clicks':String(s.reason||'').toLowerCase()==='no_access'?'No Search Console access':'No reading'])});
  return {sources,method,blends:[],setup:[]}}
 // ==== TODAY END ====

 const LANES=['CLAUDE','CODEX','NO MODEL','OTHER'];
 const laneOf=j=>{const l=str(j&&j.lane,12);return LANES.includes(l)?l:'OTHER'};

 // ---- one state set for the ops boards (R1, M7; 2026-11-15): Up, Degraded, Down, Not reported, Paused, one word each. Down needs a probe
 // that ran and failed and carries the crossed square; a missing or "unknown" reading is Not reported with the dash mark, never Down. ----
 const OPS={up:['Up','ok'],degraded:['Degraded','warn'],down:['Down','bad'],unknown:['Not reported','off'],paused:['Paused','nv']};
 const opsWord=s=>(OPS[s]||OPS.unknown)[0],opsMark=s=>(OPS[s]||OPS.unknown)[1];
 // a yes or no probe: true is up, false is down (it ran and failed), anything else was not reported
 const okState=v=>v===true?'up':v===false?'down':'unknown';
 // a unit from `systemctl is-active`: active is up; failed or inactive is down; starting, stopping or reloading is degraded; unknown or blank is not reported
 function unitState(x){if(!isObj(x))return 'unknown';const s=str(x.state,24).toLowerCase();
  if(s==='active'||(x.ok===true&&!s))return 'up';if(s==='failed'||s==='inactive'||s==='dead')return 'down';
  return /^(activating|deactivating|reloading|refreshing)$/.test(s)?'degraded':'unknown'}
 function opsCount(states){const c={up:0,degraded:0,down:0,unknown:0,paused:0,n:0};arr(states).forEach(s=>{c[OPS[s]?s:'unknown']++;c.n++});return c}
 const opsParts=c=>[c.down&&c.down+' down',c.degraded&&c.degraded+' degraded',c.unknown&&c.unknown+' not reported',c.paused&&c.paused+' paused'].filter(Boolean);
 // what is not up, weightiest first ("1 down · 6 not reported"), or "All up"
 const opsRest=c=>opsParts(c).join(' \u00B7 ')||'All up';
 // the board's one computed line: what needs a look, said once. Every part counts once by name (Dell as a machine and as a host is one
 // part, at its worst state), so "N down" is the number of down rows above it, and the down parts are named in the rows' order, three
 // at most ("4 down: Spark, pepgo.org, Hermes gateway and 1 more · 6 not reported"). Up counts stay in the tiles under it: a line that
 // led with "5 down" and ended in "... sites up" read as a contradiction (L18). parts: [{name, s}]; '' when everything reported is up
 const OPS_RANK={down:4,degraded:3,unknown:2,paused:1,up:0};
 function fleetLine(parts){const worst=new Map(),names=new Map();
  arr(parts).forEach(p=>{if(!isObj(p)||!p.name)return;const k=String(p.name).toLowerCase(),s=OPS[p.s]?p.s:'unknown',w=worst.get(k);if(!names.has(k))names.set(k,String(p.name));if(w==null||OPS_RANK[s]>OPS_RANK[w])worst.set(k,s)});
  const c=opsCount([...worst.values()]),dn=[...worst.keys()].filter(k=>worst.get(k)==='down').map(k=>names.get(k)),more=dn.length-3;
  const who=dn.length?': '+(more>0?dn.slice(0,3).join(', ')+' and '+more+' more':dn.length===1?dn[0]:dn.slice(0,-1).join(', ')+' and '+dn[dn.length-1]):'';
  const ps=opsParts(c);if(who)ps[0]+=who;return ps.join(' \u00B7 ')}
 // a percentage on its way into a style: a finite number from 0 to 100, else null ("No reading"), never pushed into range (X4, decision 9)
 const pctOf=v=>{const n=num(v);return n==null||n<0||n>100?null:n};
 // one compact state cell (Services, Hosts): the mark and the name, the state word under it; the detail rides into the sheet
 const opsChip=(name,word,s,dg)=>'<div class="chip sm'+(s==='down'?' bad':'')+'"><b>'+SD(opsMark(s))+esc(name)+'</b><small>'+esc(word)+'</small>'+diagHtml(dg)+'</div>';
 const opsPill=s=>'<span class="pill">'+SD(opsMark(s))+esc(opsWord(s))+'</span>';
 // Fleet's Services and Hosts (GET /api/fleet). A title says only what is not up; a host's address (the server's `via`) stays in the sheet
 function fleetServices(f){
  if(!isObj(f)||f.error)return '<div class="secttl"><span>Services and hosts</span><span>Not reporting</span></div>'+down('Services and hosts',f,'fleet');
  const sv=arr(isObj(f.services)&&f.services.items).filter(isObj),rc=arr(isObj(f.reach)&&f.reach.items).filter(isObj),ss=sv.map(unitState),rs=rc.map(x=>okState(x.ok));
  const rest=st=>{const c=opsCount(st);return c.up<c.n?opsRest(c):''};
  const svc=sv.length?'<div id="fsv">'+sv.map((x,i)=>opsChip(unitName(str(x.unit,96))||'Service',opsWord(ss[i]),ss[i],['Unit '+str(x.unit,96),str(x.state,24)&&'State '+str(x.state,24)])).join('')+'</div>':tile('Services','None reported','No services were listed','stale');
  const host=rc.length?'<div id="frc">'+rc.map((x,i)=>opsChip(str(x.name,30)||'Host',rs[i]==='up'&&num(x.ms)!=null?'Up \u00B7 '+Math.round(x.ms)+' ms':opsWord(rs[i]),rs[i],
   [str(x.via,60)&&'Answered at '+str(x.via,60),rs[i]==='down'&&num(x.tried)!=null&&'Tried '+x.tried+(x.tried===1?' route':' routes')])).join('')+'</div>':tile('Hosts','None reported','No host probes ran','stale');
  return '<div class="secttl"><span>Services</span>'+(rest(ss)?'<span>'+esc(rest(ss))+'</span>':'')+'</div>'+svc+'<div class="secttl"><span>Hosts</span>'+(rest(rs)?'<span>'+esc(rest(rs))+'</span>':'')+'</div>'+host}
 // Fleet's cluster nodes (GET /api/nodes). The feed's memory is GiB; the page reads GB, as Cluster does, and the bar says what it measures (V12)
 const GIB=1.073741824;
 function fleetNodes(nd){
  if(!isObj(nd)||nd.error){const p=problem(nd);return tile('Node check','Not reporting',p.line,'bad','',p.diag)}
  const ns=arr(nd.nodes).filter(isObj);if(!ns.length)return tile('No nodes','None reported','The nodes feed returned an empty list','stale');
  return '<div id="fnd">'+ns.map(x=>{const up=x.reachable===true,p=pctOf(x.mem_pct),t=num(x.temp_c),hot=t!=null&&t>=85,u=num(x.mem_used_gb),tot=num(x.mem_total_gb),k=!up?'bad':(nd.stale||hot)?'warn':'ok';
   return '<div class="tile'+(k=='bad'?' bad':k=='warn'?' stale':'')+'"><div class="h">'+SD(k)+esc(str(x.label,20)||'Node')+'</div><div class="v">'+(!up?'Down':p==null?'Memory: no reading':'Memory '+Math.round(p)+'%')+'</div>'+
    (up&&p!=null?'<div class="bar'+(p>=99?' hot':'')+'"><i style="width:'+p+'%"></i></div>':'')+
    '<div class="t">'+esc(up?[u!=null&&tot!=null?Math.round(u*GIB)+' of '+Math.round(tot*GIB)+' GB':'',t!=null?Math.round(t)+'\u00B0C':''].filter(Boolean).join(' \u00B7 '):'Not reachable. Check that it is on and on the network.')+'</div></div>'}).join('')+'</div>'}
 // Fleet's disk rows (GET /api/disks): a percentage that is not a number from 0 to 100 reads "--" and draws an empty bar (X4)
 function fleetDisks(dk){
  if(!isObj(dk)||dk.error){const p=problem(dk);return tile('Disk check','Not reporting',p.line,'bad','',p.diag)}
  const ds=arr(dk.drives).filter(isObj);if(!ds.length)return tile('Disks','None reported','The disks feed returned an empty list','stale');
  return ds.map(d=>{const p=pctOf(d.pct),hot=p!=null&&p>=90;return '<div class="dk'+(hot?' hot':'')+'"><span>'+(hot?'! ':'')+esc(str(d.host,30))+' <small>'+esc(str(d.label,30))+'</small></span><div class="bar"><i style="width:'+(p==null?0:p)+'%"></i></div><b>'+(p==null?'--':Math.round(p)+'%')+'</b></div>'}).join('')}
 // benchmarks as a short figure list with units, the same words on Cluster and Fleet (V13). o: the cluster bench object or the board's [{k,v}]
 const BENCH=[[/^prose/,'Writing','tok/s',1],[/^code/,'Coding','tok/s',1],[/^prefill/,'Prefill','tok/s',0],[/^conc6/,'6 at once','tok/s',1],[/^ttft/,'First token','s',2]];
 const figN=(v,d)=>v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
 function benchFigs(o){const fs=Array.isArray(o)?o.filter(isObj).map(x=>({k:str(x.k,40),v:num(x.v)})):isObj(o)?Object.keys(o).map(k=>({k,v:num(o[k])})):[];
  return BENCH.map(([re,label,unit,d])=>{const f=fs.find(x=>re.test(x.k)&&x.v!=null);return f?{label,unit,text:figN(f.v,d)}:null}).filter(Boolean)}
 const benchList=(fs,head,when,dg)=>'<div class="flist bench">'+(head?'<div class="frow bh"><span class="fl"><b>'+esc(head)+'</b></span>'+(when?'<span class="fr"><small>'+esc(when)+'</small></span>':'')+diagHtml(dg)+'</div>':'')+
  fs.map(x=>'<div class="frow"><span class="fl"><b>'+esc(x.label)+'</b></span><span class="fr"><b class="fig">'+esc(x.text)+'</b><small>'+esc(x.unit)+'</small></span></div>').join('')+'</div>';
 // a tuning outcome in words, and its changes as signed percents with a true minus (W10, G11, V14)
 const OUTCOME={applied:'Applied',kept:'Kept',accepted:'Accepted',rejected:'Rejected',reverted:'Reverted',failed:'Failed',superseded:'Superseded'};
 const outWord=s=>{const k=str(s,40).toLowerCase().replace(/_/g,' ');return OUTCOME[k]||sentence(k)};
 const spct=n=>{if(num(n)==null)return '';const r=(Math.round(Math.abs(n)*10+1e-9)/10).toFixed(1);return (Number(r)===0?'':n<0?'\u2212':'+')+r+'%'};
 // a gain as the loop writes it ("-1.8%", or a number of percent)
 const gainOf=g=>{const n=typeof g==='number'?g:parseFloat(String(g==null?'':g).replace('\u2212','-'));return isFinite(n)?'gain '+spct(n):''};
 // the per-benchmark changes in a result note ("deltas {'prose_tps': -0.0379, ...}", fractions) as "Writing −3.8%"; nothing when the note has none
 function tuneDeltas(note){const m=/deltas\s*\{([^}]*)\}/.exec(str(note,800));if(!m)return [];const o={};
  for(const x of m[1].matchAll(/['"]?([A-Za-z0-9_]+)['"]?\s*:\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)/g))o[x[1]]=Number(x[2])*100;
  return BENCH.map(([re,label])=>{const k=Object.keys(o).find(x=>re.test(x));return k&&isFinite(o[k])?label+' '+spct(o[k]):''}).filter(Boolean)}
 // ---- Fleet > Devices (L25, 2026-11-15; first built 2026-11-04 in 0e0b200): after Machines, one group a kind, each device its state word and one
 // reading, from feeds the page already reads. Two probes that disagree read Degraded with "Probes disagree" on the second line. Only the
 // owner's own phones are named; other tailnet devices are not listed. ----
 const DEV_PCS=[{label:'pc-desktop',ts:'pc-desktop',self:true,mach:'pc-desktop'},{label:'Dell',ts:'dell',reach:'Dell',mach:'Dell'},{label:'Spark',ts:'spark',reach:'Spark',mach:'Spark'},
  {label:'Ascent',ts:'ascent',reach:'Ascent',mach:'Ascent'},{label:'Mac mini',ts:'mac-mini',reach:'Mini',mach:'Mac Mini'}];
 const DEV_PHONES={'tanners-phone':'iPhone','ipad-gen-8':'iPad','pixel-10a':'Pixel 10a'};
 const INK_IDS=[['Black','sensor.hp_envy_6400_series_black_cartridge'],['Color','sensor.hp_envy_6400_series_tri_color_cartridge']];
 const offFor=n=>'Off the tailnet'+(num(n.last_seen_h)!=null?' for '+(n.last_seen_h<48?Math.max(1,Math.round(n.last_seen_h))+' h':Math.round(n.last_seen_h/24)+' d'):'');
 function fleetDevices(i,now){i=isObj(i)?i:{};
  const ts=isObj(i.ts)&&!i.ts.error?i.ts:null,nodes=ts?arr(ts.nodes).filter(isObj):[],reach=isObj(i.f)&&!i.f.error&&isObj(i.f.reach)?arr(i.f.reach.items).filter(isObj):[];
  const mb=isObj(i.bd)&&isObj(i.bd.machines)&&!i.bd.machines.error?arr(i.bd.machines.items).filter(isObj):[];
  const node=n=>nodes.find(x=>str(x.name,40)===n)||null,all=[],out=[];
  const add=(name,s,line,dg)=>{all.push(s);return row(name,line,opsPill(s),s==='down'?'bad':'','','',dg)};
  const group=(t,rows)=>rows.length?'<div class="frow dgh" role="heading" aria-level="2"><span class="fl"><b>'+esc(t)+'</b></span></div>'+rows.join(''):'';
  out.push(group('Computers',DEV_PCS.map(c=>{const r=c.reach?reach.find(x=>x.name===c.reach)||null:null,m=mb.find(x=>str(x.name,30)===c.mach)||null,n=node(c.ts);
   const pr=[r&&typeof r.ok==='boolean'?r.ok:null,m&&typeof m.reachable==='boolean'?m.reachable:null].filter(x=>x!==null),split=pr.length===2&&pr[0]!==pr[1];
   const s=c.self?'up':split?'degraded':pr.length?(pr.every(Boolean)?'up':'down'):n?okState(n.online):'unknown';
   const dr=m?arr(m.drives).filter(isObj).map(d=>pctOf(d.pct)).filter(x=>x!=null):[];
   const line=[split?'Probes disagree':'',c.self?'This computer':n?(n.online===true?'On the tailnet':offFor(n)):'',dr.length?'Disk '+Math.round(Math.max(...dr))+'% full':''].filter(Boolean).join(' \u00B7 ');
   return add(c.label,s,line,[r&&str(r.via,60)&&'Answered at '+str(r.via,60),split&&'Host probe '+(r.ok?'answered':'did not answer')+', disk check '+(m.reachable?'answered':'did not answer')])})));
  out.push(group('Phones and tablets',Object.keys(DEV_PHONES).map(k=>{const n=node(k);if(!n)return '';const s=n.online===true?'up':'unknown';
   return add(DEV_PHONES[k],s,n.online===true?'On the tailnet':offFor(n))}).filter(Boolean)));
  const cs=isObj(i.cams)&&!i.cams.error&&Array.isArray(i.cams.cams)?i.cams.cams.filter(isObj):null;
  out.push(group('Cameras',cs?cs.map((c,ix)=>{const s=okState(c.ready===true?true:c.ready===false?false:null);
   return add('Cam '+(ix+1),s,s==='up'?(num(c.readers)>0?num(c.readers)+' watching':'Streaming'):s==='down'?'Not streaming':'',[str(c.name,30)&&'Stream '+str(c.name,30)])}):[add('Cameras','unknown','The camera relay did not answer')]));
  const ent=isObj(i.ha)&&!i.ha.error&&isObj(i.ha.entities)?i.ha.entities:null,ink=ent?INK_IDS.map(([l,k])=>[l,ent[k]]).filter(x=>isObj(x[1])):[];
  const lv=ink.map(([l,s])=>[l,s.state===''||s.state==null||isNaN(+s.state)?null:Math.round(+s.state)]).filter(x=>x[1]!=null),seen=Math.max(0,...ink.map(([,s])=>toEpoch(s.updated)||0));
  out.push(group('Printer and Home Assistant',[!ent?add('Printer','unknown','Home Assistant did not answer'):lv.length?add('Printer',lv.some(x=>x[1]<20)?'degraded':'up',lv.map(([l,v])=>l+' '+v+'%').join(' \u00B7 ')):
   add('Printer','unknown','Printer offline \u00B7 '+(seen>0?'last seen '+ago(seen,now):'never seen')),
   ent?add('Home Assistant','up',Object.keys(ent).length+' entities read'):add('Home Assistant',isObj(i.ha)&&i.ha.error?'down':'unknown',isObj(i.ha)&&i.ha.error?'The deck could not read it':'')]));
  const c=opsCount(all),r=c.up<c.n?opsRest(c):'';
  return '<div class="secttl"><span>Devices</span>'+(r?'<span>'+esc(r)+'</span>':'')+'</div><div class="flist fdev">'+out.join('')+'</div>'}
 // ---- Cluster > Models by machine (L26, read only, no swap). Two sources: the fleet board's per-device list (device-models.json: the
 // machine and every model name on it, which the inventory does not carry whole) and the model inventory (GET /api/models, modeldeck.rs:
 // installed against resident per machine, and each model's own GPU share). A machine or a model the inventory does not know shows
 // neither, never a guessed word. A failed read says so in the section; old and inv.kept_at mean the rows are the last good answer, kept
 // by DeckPages.get: the title reads "Out of date · last read N min" and one line says which read did not answer, above the kept rows. ----
 // the inventory as Models by machine reads it: shape check for DeckPages.get (a host list), and a machine's row by its id or its label
 const modelInvShape=d=>isObj(d)&&Array.isArray(d.hosts);
 const invKey=s=>str(s,200).toLowerCase().split(/\s*[(,]/)[0].trim();
 const invHost=(inv,device)=>{const d=str(device,24).toLowerCase();return d?arr(isObj(inv)&&inv.hosts).filter(isObj).find(h=>str(h.id,24).toLowerCase()===d||str(h.label,24).toLowerCase()===d)||null:null};
 // the inventory's row for a name from the board: "DeepSeek-… (tensorfold-native, 1M ctx), engine up" is that one model
 function invModel(h,name){const k=invKey(name);if(!isObj(h)||k.length<3)return null;
  const ms=arr(h.services).filter(isObj).filter(s=>s.weights!==false).reduce((a,s)=>a.concat(arr(s.models).filter(isObj)),[]);
  return ms.find(m=>{const id=invKey(m.id);return id.length>=3&&(k.indexOf(id)===0||id.indexOf(k)===0)})||null}
 function clusterModels(m,f,now,old,inv){
  if(!isObj(m)||m.error){const p=problem(m);return bhead('Models by machine',m,now)+empty({k:'stale',title:'Models by machine are not reporting',line:p.line,retry:'cluster',diag:p.diag})}
  const iv=isObj(inv)?inv:{},ivAt=toEpoch(iv.kept_at),bAt=toEpoch(old),ats=[bAt,ivAt].filter(x=>x!=null),at=ats.length?Math.min(...ats):null;
  const kept=at!=null?'Out of date \u00B7 last read '+(lapse(at,now)||'1 min'):'';
  const why=[bAt!=null?'The fleet board did not answer':'',ivAt!=null?'The model inventory did not answer':''].filter(Boolean);
  const head=bhead('Models by machine',kept?null:m,now,kept)+(kept?empty({k:'stale',title:why.join(' and ')||'A source did not answer',line:'These rows are from the last time it did.',retry:'cluster'}):'');
  // an inventory that is not answering is said once, in plain words, instead of each row pretending to know: no pill and no GPU line
  const noInv=!isObj(inv)||!!iv.error;
  const note=noInv?'<div class="tnote">'+esc('Installed and GPU per model are not reported right now.')+diagHtml([str(iv.error,120)||'the model inventory did not answer'])+'</div>':'';
  const ds=arr(m.devices).filter(isObj);
  if(!ds.length)return head+note+empty({title:'No machines listed',line:'Models show up here once a machine reports in.'});
  const nodes=arr(isObj(f)&&f.nodes).filter(isObj),mem=d=>{const n=nodes.find(x=>str(x.name,20).toLowerCase()===str(d,24).toLowerCase());const u=n&&num(n.mem_used_gb),t=n&&num(n.mem_total_gb);return u!=null&&t?'Memory '+Math.round(u)+' of '+Math.round(t)+' GB':''};
  // Only the inventory's model row can establish residency; a served name says nothing about this machine.
  const mark=(h,im)=>{if(!im)return '';
   if(im.resident===true)return '<span class="pill">'+SD('ok')+'Resident</span>';
   return arr(isObj(h)&&h.installed).some(r=>str(r,120)===str(im.id,120))?'<span class="pill">'+SD('ok')+'Installed</span>':''};
  return head+note+'<div class="flist fmod">'+ds.map(d=>{const ms=arr(d.models).map(x=>str(x,200)).filter(Boolean),name=str(d.device,24)||'Machine',mm=mem(name),h=noInv?null:invHost(iv,name);
   return '<div class="frow dgh" role="heading" aria-level="2"><span class="fl"><b>'+esc(name)+'</b></span><span class="fr"><small>'+esc([mm,ms.length+(ms.length===1?' model':' models')].filter(Boolean).join(' \u00B7 '))+'</small></span></div>'+
    (ms.length?ms.map(x=>{const im=invModel(h,x),gpu=im?num(im.gpu_gib):null;
     return row(x,gpu!=null&&gpu>0?fmt(gpu,1)+'\u00A0GB on the GPU':'',mark(h,im))}).join(''):row('No models reported','','','stale'))}).join('')+'</div>'}
 // the fleet board answer as Cluster reads it: shape check for DeckPages.get (a board with no model list is a failed read, so the last good
 // one is kept), and [models, old] for clusterModels from get's {ok, stale, at, data, error}
 const boardHasModels=d=>isObj(d)&&isObj(d.models)&&!d.models.error;
 function boardModels(r){if(!isObj(r)||!r.ok)return [{error:isObj(r)&&str(r.error,120)||'no answer from the deck server'},null];
  const m=isObj(r.data)&&isObj(r.data.models)?r.data.models:{error:'the board sent no model list'};
  return [m,r.stale===true&&num(r.at)!=null?r.at:null]}
 // a feed as Cluster's sections read it, from DeckPages.get's answer: a failure is {error}; a last good answer kept after a failed
 // refresh is the old feed marked stale with kept_at (when it was read), so its section titles say "Out of date · last read N min"
 // and the rows stay, never a blank section
 function keptFeed(r){if(!isObj(r))return {error:'no answer from the deck server'};
  if(!r.ok)return Object.assign({},isObj(r.data)?r.data:{},{error:str(isObj(r.data)&&r.data.error,120)||str(r.error,120)||'no answer from the deck server'});
  const d=isObj(r.data)?r.data:{error:'wrong shape'};return r.stale===true&&num(r.at)!=null&&!d.error?Object.assign({},d,{stale:true,kept_at:r.at}):d}

 // ---- v8: Fleet board (GET /api/fleet-board). Missing data says so and is never shown as zero. Design v3: a section title carries no age
 // (the page has one freshness mark); it says "Out of date" when its feed is old, and nothing when the body already says it is not reporting ----
 const gbs=v=>{const n=num(v);if(n==null)return '--';return n>=1000?(n/1000).toFixed(2)+' TB':Math.round(n)+' GB'};
 const bsrc=(f,now)=>!isObj(f)||f.error?'':num(f.kept_at)!=null?'Out of date \u00B7 last read '+(lapse(toEpoch(f.kept_at),num(now)!=null?now:Date.now())||'1 min'):f.stale?'Out of date':'';
 const bhead=(title,f,now,count)=>{const s=[str(count,40),bsrc(f,now)].filter(Boolean).join(' \u00B7 ');return '<div class="secttl"><span>'+esc(title)+'</span>'+(s?'<span>'+esc(s)+'</span>':'')+'</div>'};
 const bdown=(title,f,retry)=>down(title,f,retry||'fleet');
 const bstate=f=>!isObj(f)||f.error?'bad':f.stale?'stale':'ok';
 // ---- Machines (Fleet, ~/.local/state/fleet-disks.json through the board). Disk true/false are answered checks:
 // Up with disks / Down. A probe that raised writes null with its reason, never false. Only an unanswered disk
 // check can borrow a current node answer ("Up · memory 62%", disk space not checked); neither answered is Not checked.
 // nd is the whole GET /api/nodes answer: a stale or failed one is no answer, as its own section warns (review Four). ----
 const MACH_ND='not checked';
 const machNodes=nd=>!isObj(nd)||nd.error||nd.stale===true?null:nd.nodes;
 const machineNode=(m,nodes)=>{const nm=str(m&&m.name,30).toLowerCase();return nm?arr(nodes).filter(isObj).find(n=>str(n.label,20).toLowerCase()===nm)||null:null};
 // up: a current check reached it · down: a current check did not reach it · unknown: neither answered recently.
 // A host's own check can lag behind a fresh file. Keep its disks, but never count or draw them as current.
 function machineState(m,nd,now,refresh){now=num(now)!=null?now:Date.now();refresh=num(refresh)>0?refresh:600;
  const checked=num(isObj(m)&&m.checked),s=okState(isObj(m)?m.reachable:null),nodes=machNodes(nd),n=machineNode(m,nodes),
   ndWhy=isObj(nd)&&(nd.error||nd.stale===true)?(nd.error?'The node check is not reporting.':'The node check is out of date.'):'';
  if(isObj(m)&&Object.prototype.hasOwnProperty.call(m,'checked')&&(checked==null||checked<=1500000000||checked>now/1000)&&s!=='unknown')
   return {s:'unknown',why:'Disk check time not reported.'};
  if(checked!=null&&now/1000-checked>2*refresh)return {s:'unknown',why:'Disks read '+ago(checked,now),diskStale:true};
  if(s==='up')return {s:'up',why:''};
  if(s==='down')return {s:'down',why:'The disk check answered that it is not reachable.'};
  const note=str(m&&m.note,120),diskWhy=!isObj(m)||note==='not in snapshot'?'This machine was left out of the last snapshot.':'The disk check did not answer.'+(note?' '+note:'');
  if(!isObj(n))return {s:'unknown',why:[diskWhy,ndWhy].filter(Boolean).join(' ')};
  if(n.reachable===true)return {s:'up',why:'Disk space not checked.'};
  if(n.reachable===false)return {s:'down',why:'The node check did not reach it.'};
  return {s:'unknown',why:'The node check did not report.'}}
 function bMachines(f,now,nd){
  if(state(f)=='bad')return bhead('Machines',f,now)+bdown('Machines',f);
  const k=bstate(f),nodes=machNodes(nd);let needsRetry=false;
  const html=bhead('Machines',f,now)+'<div class="mach">'+arr(f.items).filter(isObj).map(m=>{
   const st=machineState(m,nd,now,f.refresh),s=st.s,n=machineNode(m,nodes),nm=esc(str(m.name,20));
   if(s==='unknown'&&!st.diskStale)return '<div class="tile node"><div class="h">'+SD('off')+nm+'</div><div class="v">'+esc(sentence(MACH_ND))+'</div><div class="t">'+esc(st.why)+'</div></div>';
   if(st.diskStale)needsRetry=true;
   const mk=st.diskStale?'stale':s==='down'?'bad':k,via=!st.diskStale&&n&&s==='up'&&m.reachable!==true;
   const drv=arr(m.drives).filter(isObj).map(d=>{const p=pctOf(d.pct);return '<div class="bar'+(p!=null&&p>=90?' hot':'')+'"><i style="width:'+(p==null?0:p)+'%"></i></div><div class="t">'+esc(str(d.label,20)||'Disk')+' \u00B7 '+gbs(d.used_gb)+' used \u00B7 '+gbs(d.free_gb)+' free'+(p==null?'':' \u00B7 '+Math.round(p)+'%')+'</div>'}).join('');
   // a machine the node check reached, whose disk check did not answer: the node's own reading, and the missing part named
   const mem=num(n&&n.mem_pct),temp=num(n&&n.temp_c);
   const val=st.diskStale?'Out of date':via?'Up'+(mem!=null?' \u00B7 memory '+Math.round(mem)+'%':''):opsWord(s);
   const body=st.diskStale?'<div class="t">'+esc(st.why)+'</div>'+drv:via?'<div class="t">'+esc(['Disk space not checked',temp!=null?fmt(temp,0,'\u00B0C'):''].filter(Boolean).join(' \u00B7 '))+'</div>'
    :s==='up'?(drv||'<div class="t">No disks listed</div>'):'<div class="t">'+esc(st.why+' The disk sizes are unknown.')+'</div>';
   return '<div class="tile node'+(mk=='bad'?' bad':mk=='stale'?' stale':'')+'"><div class="h">'+SD(mk=='stale'?'warn':mk)+nm+'</div><div class="v">'+esc(val)+'</div>'+body+'</div>'}).join('')+'</div>';
  return html+(needsRetry?'<button type="button" class="b es-retry" data-retry="fleet">Try again</button>':'')}
 function bCluster(c,now){
  if(!isObj(c))return bhead('Cluster',c,now)+bdown('Cluster',c);
  const bn=isObj(c.bench)?c.bench:null,k=c.ok===true?'ok':'bad';
  const kv=num(c.kv_cache_pct);
  const live=c.ok===true?tile('Model \u00B7 '+(str(c.model,60)||'not reported'),'Running '+(num(c.running)==null?'--':fmt(c.running))+' \u00B7 waiting '+(num(c.waiting)==null?'--':fmt(c.waiting)),
   'Cache '+(kv==null?'not reported':fmt(kv,1,'%')+' full'),k,'wrap',[str(c.src,60)]):empty({k:'bad',title:'Cluster is not reachable',line:'Check that the machines are on, then try again.',retry:'fleet',diag:['No answer from the local proxy on port 8080']});
  let bt;
  if(!bn||bn.error)bt=empty({k:'stale',title:'No benchmark yet',line:'Results show up after the next benchmark run.',diag:[bn&&bn.error?str(bn.error,60):'no bench data',str(bn&&bn.src,60)].filter(Boolean)});
  // the same figure list as Cluster's (V13): Writing, Coding, Prefill, 6 at once, each with its unit; the file name rides in the sheet
  else{const fs=benchFigs(bn.fields),when=cday(bn.date)||str(bn.date,12);
   bt=fs.length?benchList(fs,'Latest benchmark',when,[str(bn.file,60),toEpoch(bn.t)!=null&&'Measured '+ago(bn.t,now)]):
    tile('Latest benchmark'+(when?' \u00B7 '+when:''),'No numbers recorded','Measured '+(toEpoch(bn.t)==null?'at an unknown time':ago(bn.t,now)),bn.stale?'stale':'ok','wrap',[str(bn.file,60)].filter(Boolean))}
  return '<div class="secttl"><span>Cluster</span>'+(c.ok===true?'':'<span>Not reachable</span>')+'</div>'+live+bt}
 function bModels(m,now){
  if(!isObj(m)||m.error){const p=problem(m);return bhead('Models by device',m,now)+empty({k:'stale',title:'Models by device are not reporting',line:p.line,retry:'fleet',diag:p.diag})}
  const ds=arr(m.devices).filter(isObj);
  if(!ds.length)return bhead('Models by device',m,now)+empty({title:'No devices listed',line:'Models show up here once a device reports in.'});
  // every model is listed whole and the row wraps (a cut at 60 characters ended mid-word: "1M ctx), e")
  return bhead('Models by device',m,now)+'<div class="flist">'+ds.map(d=>{const ms=arr(d.models).map(x=>str(x,200)).filter(Boolean);
   return row(str(d.device,24)||'Device',ms.length?ms.join(', '):'No models reported','<small>'+ms.length+'</small>',ms.length?'':'stale')}).join('')+'</div>'}
 // ---- Code backup: ~/.meshvault/status/deck/gitsync.json, one row per host. Counts of OUR repos only; a null count reads "unknown", never 0. ----
 const syncN=(n,w)=>fmt(n)+' '+w+(n===1?'':'s');
 const syncHosts=b=>isObj(b)&&!b.error?arr(b.hosts).filter(h=>isObj(h)&&str(h.host,40)):[];
const syncName=h=>redact(str(h.label,30)||str(h.host,30));
 // Counts describe local refs, never a verified remote backup.
 function syncLine(h){const r=num(h.own_repos),u=num(h.unpushed);
  if(r==null&&u==null)return 'Not checked yet';
  if(u==null)return 'Local commits ahead: unknown';
  return u===0?'No local commits ahead':syncN(u,'repo')+(u===1?' has':' have')+' local commits ahead'}
const syncKind=(h,b)=>b.stale||h.error||num(h.stale_s)==null||num(h.stale_s)>2*(num(b.refresh)||1800)||num(h.unknown)!==0||num(h.no_remote)!==0||num(h.unpushed)==null?'unknown':num(h.unpushed)>0?'ahead':'local';
const syncOld=(h,b)=>!!b.stale||num(h.stale_s)==null||num(h.stale_s)>2*(num(b.refresh)||1800);
// age since the last good scan; under a minute it reads "just now" (lapse() alone returns '' there)
function syncFresh(h,now){const s=num(h.stale_s),e=redact(str(h.error,30));
  return [e,s!=null&&s>0?'checked '+ago(now/1000-s,now):''].filter(Boolean).join(' \u00B7 ')}
// the row is ONE human line (counts, no-remote and unknown numbers live in the sheet); the pill says whether to trust it
function syncRowLine(h,k,b,now){const e=redact(str(h.error,30)),s=num(h.stale_s);
  const main=num(h.unpushed)===0&&k==='unknown'?(syncOld(h,b)?'Not checked recently':'Not every repo was checked'):syncLine(h);
  return [main,e,syncOld(h,b)&&s!=null&&s>0?'checked '+ago(now/1000-s,now):''].filter(Boolean).join(' \u00B7 ')}
 function bBackup(b,now){
  const hs=syncHosts(b);
  if(!hs.length)return '<div class="secttl"><span>Code backup</span></div>'+empty({title:'Backup status not reported yet',line:'Each machine shows up here after its first check.',diag:[isObj(b)&&str(b.error,60),isObj(b)&&str(b.src,80)].filter(Boolean)});
  return bhead('Code backup',b,now)+'<p class="muted">Local refs only. Remote backup is not verified.</p><div class="flist">'+hs.map(h=>{const k=syncKind(h,b);
   const pill=k==='local'?'<span class="pill">'+SD('ok')+'No commits ahead</span>':k==='ahead'?'<span class="pill warn">'+SD('warn')+'Ahead</span>':opsPill('unknown');
   return row(syncName(h),syncRowLine(h,k,b,now),pill,'','',dattr('sync',str(h.host,40)))}).join('')+'</div>'}
 // the sheet a backup row opens: local tracking information, not remote verification
 function syncSheet(b,host,now){const hs=syncHosts(b),h=hs.find(x=>str(x.host,40)===host);
  if(!h)return {kind:'card',title:'Code backup',sub:'Not reported yet',lines:['Backup status is not reported yet.'],log:[],logTitle:'',actions:[]};
  const c=(l,v)=>l+': '+(num(v)==null?'unknown':fmt(v)),list=arr(isObj(b)&&b.unpushed).filter(x=>isObj(x)&&str(x.host,40)===host).slice(0,40);
  const fresh=syncFresh(h,now);
  return {kind:'card',title:syncName(h),sub:'Local tracking refs only'+(fresh?' \u00b7 '+fresh:''),
   lines:[syncLine(h),c('Checkouts',h.checkouts),c('Unique repos',h.repos),c('Owner repos',h.own_repos),c('Repos with local commits ahead',h.unpushed),c('No remote',h.no_remote),c('Uncommitted changes',h.dirty),c('Third-party clones',h.third_party),c('Unknown',h.unknown)],
   log:list.map(x=>redact(str(x.repo,90))+' \u00b7 '+(redact(str(x.branch,40))||'branch unknown')+' \u00b7 '+(num(x.ahead)==null?'commits ahead unknown':fmt(x.ahead)+' ahead')),
   logTitle:list.length?(list.length===1?'Repo with local commits ahead':'Repos with local commits ahead'):(num(h.unpushed)===0?'No local commits ahead':''),actions:[]}}
 // systemd escapes (\x2d) and the .service suffix are plumbing, not names
 const unitLabel=n=>str(n,96).replace(/\\x([0-9a-f]{2})/gi,(m,x)=>String.fromCharCode(parseInt(x,16))).replace(/\.service$/,'');
 // a unit as a person names it (baseline problem 28): no suffix, no run ids, words in sentence case; the id goes to the detail sheet
 const UNIT_UP=new Set(['mcp','omp','ssh','gpu','cpu','dns','vpn','llm','api','tts','ocr','hls']);
 function unitName(n){const w=unitLabel(n).replace(/\.(service|scope|timer|socket|path|mount|slice|target)$/,'').split(/[-_@.\s]+/).filter(x=>x&&!/^\d{4,}$/.test(x)&&!/^[0-9a-f]{12,}$/i.test(x));
  if(!w.length)return 'Service';const s=w.map(x=>UNIT_UP.has(x.toLowerCase())?x.toUpperCase():x.toLowerCase()).join(' ');return s.charAt(0).toUpperCase()+s.slice(1)}
 // eight rows, then Show N more (as Agent runs does): 21 failed units were 1,100 px on a phone and the column that held them ran long
 const UNITS_FIRST=8;
 function bUnits(u,now,all){
  if(!isObj(u)||u.error){const p=problem(u),first=isObj(u)&&/missing/i.test(str(u.error,60));
   return bhead('Background services',u,now)+empty({k:'stale',title:'Background services are not reporting',line:first?'The first snapshot has not been taken yet.':p.line,retry:'fleet',diag:(first?['Run ~/ops/bin/deck-fleet-snapshot to take one']:[]).concat(p.diag)})}
  if(u.writer_ok===false)return bhead('Background services',u,now)+empty({k:'bad',title:'The snapshot could not check services',line:'Try again after the next snapshot.',retry:'fleet',diag:['The snapshot writer could not run systemctl']});
  const ns=arr(u.failed_units).map(x=>str(x,96)).filter(Boolean);
  // one calm row per failing unit: a mark and a word. The header carries the count; nothing here is filled red. Opened past eight the
  // list carries data-bal-open (DeckBalance plans its section at the closed height, so it opens in place) and Show fewer, as Markets has.
  const shown=all===true?ns:ns.slice(0,UNITS_FIRST),open=shown.length>UNITS_FIRST;
  return bhead('Background services',u,now,ns.length?ns.length+' need attention':'')+
   '<div class="flist"'+(open?' data-bal-open':'')+'>'+(ns.length?shown.map(x=>row(unitName(x),'','<span class="pill">'+SD('bad')+'Failed</span>','','',dattr('key',x)+(UNIT_RE.test(x)?dattr('unit',x):''),['Unit '+x])).join(''):row('All services are running','Nothing is failing','<span class="pill">'+SD(u.stale?'warn':'ok')+(u.stale?'Out of date':'OK')+'</span>'))+'</div>'+
   DeckCore.more({key:'fleetunits',shown:shown.length,total:ns.length,step:ns.length-shown.length,first:UNITS_FIRST})}
 const renderFail=t=>empty({k:'bad',title:'Could not show '+str(t,40),line:'Try again. If it keeps happening, reload the deck.',retry:'fleet'});
 // [machines, cluster, models, backup, units]; app.js fleet() places them in the three Fleet columns. o.allUnits: Show more was tapped.
 // o.nodes: GET /api/nodes, the page's own node check, so a machine whose disk check did not answer can still say what the node shows.
 function board(b,now,o){
  if(!isObj(b))return ['<div class="secttl"><span>Fleet board</span><span>Not reporting</span></div>'+down('Fleet board',null,'fleet'),'','','',''];
  const part=(fn,k,x)=>{try{return fn(b[k],now,x)}catch(e){return renderFail(k)}};
  return [(()=>{try{return bMachines(b.machines,now,isObj(o)?o.nodes:null)}catch(e){return renderFail('machines')}})(),part(bCluster,'cluster'),part(bModels,'models'),part(bBackup,'backup'),part(bUnits,'units',isObj(o)&&o.allUnits===true)]}
 // Fleet's first block (lane PgHome, Main 2026-11-14): the urgent rows first, then one strip of counters. On TV it is the board
 // (status plus every urgent row, cut by height); elsewhere the page shows the first row only, so the calm single-urgent rule holds.
// o = {f: /api/fleet, st: /api/sites, bd: /api/fleet-board, nd: /api/nodes}. A feed that did not answer counts as No data, never as zero. Only what
// is Down is an urgent row (R1): a part with no reading counts as Not reported in its tile and in the one computed line, never as down. A
// machine's state comes from machineState (a disk check that raised is Not checked, not Down), the same rule its tile draws.
 function fleetSummary(o){o=isObj(o)?o:{};const f=isObj(o.f)&&!o.f.error?o.f:null,st=isObj(o.st)&&!o.st.error?o.st:null,bd=isObj(o.bd)?o.bd:null;
  const mach=bd&&isObj(bd.machines)&&!bd.machines.error?arr(bd.machines.items).filter(isObj):null,sv=f&&isObj(f.services)?arr(f.services.items).filter(isObj):null,
   rc=f&&isObj(f.reach)?arr(f.reach.items).filter(isObj):null,si=st?arr(st.items).filter(isObj):null,un=bd&&isObj(bd.units)&&!bd.units.error?arr(bd.units.failed_units).map(x=>str(x,96)).filter(Boolean):[];
  const ms=mach&&mach.map(m=>machineState(m,o.nd,null,bd.machines.refresh).s),ss=sv&&sv.map(unitState),rs=rc&&rc.map(x=>okState(x.ok)),is=si&&si.map(x=>okState(x.ok));
  // every part by its shown name and state; the rows and the line read this one list, so they never disagree (review #353 item 1)
  const parts=[],put=(xs,ss,nm)=>(xs||[]).forEach((x,i)=>parts.push({name:nm(x),s:ss[i],unit:x&&x.unit?str(x.unit,96):''}));
  put(mach,ms,m=>str(m.name,30));put(rc,rs,x=>str(x.name,30));put(si,is,x=>str(x.name,40));put(sv,ss,x=>unitName(x.unit));
  un.forEach(x=>parts.push({name:unitName(x),s:'down',unit:x}));
  const rows=[],seen=new Set();
  parts.forEach(p=>{const k=String(p.name).toLowerCase();if(p.s!=='down'||!p.name||seen.has(k))return;seen.add(k);rows.push(p)});
  const more=rows.length-1;
  const list=rows.length?rows.map((r,i)=>row(r.name,i===0&&more>0?more+(more===1?' more is':' more are')+' down':'',opsPill('down'),'','',r.unit&&UNIT_RE.test(r.unit)?dattr('unit',r.unit):'',r.unit?['Unit '+r.unit]:[])).join(''):
   row('Nothing is down','Every machine, host, site and service that reported is up',opsPill('up'),'');
  // the tile: up of all, then what is not up ("0 of 6" over "6 not reported"); a feed that did not answer is No data, never zero. A machine
  // whose check did not run says "not checked", the same word its own tile draws (review Four)
  const count=(xs,word,alt)=>{if(xs==null)return V3.tile({label:word,value:'No data'});const c=opsCount(xs);return V3.tile({label:word,value:c.up+' of '+c.n,sub:c.n?opsRest(c).replace(/\bnot reported\b/,alt||'not reported'):'None listed'})};
  const strip=V3.strip([count(ms,'Machines',MACH_ND),count(ss,'Services'),count(rs,'Hosts'),count(is,'Sites')],{label:'Fleet counts'});
  const sum=fleetLine(parts);
  return {html:'<div class="flist board-fill fsum-rows">'+list+'</div>'+(sum?'<p class="fsum-line" role="status">'+esc(sum)+'</p>':'')+strip,urgent:rows.length,line:sum}}
 // Fleet check tiles (GET /api/fleet items, the fleet-facts lines). A check that failed prints an exception ("UNAVAILABLE
 // (CalledProcessError)"): that is never a tile value. All failed checks fold into ONE "Not reporting" line with Try again; the raw
 // text rides into the detail sheet only (review F3b). The cluster, node and disk lines have their own sections and are left out.
 const FACT_BROKEN=/^\s*unavailable\b|\b[A-Z][A-Za-z]*(?:Error|Exception)\b|Traceback/;
 function fleetFacts(items){
  const fs=arr(items).filter(isObj).filter(x=>!/^(cluster|node|disk)/i.test(str(x.head,60)));
  const val=x=>str(x.text,160)||str(x.raw,160),bad=fs.filter(x=>FACT_BROKEN.test(val(x))),ok=fs.filter(x=>!FACT_BROKEN.test(val(x)));
  const old=x=>/stale/i.test(str(x.tag,80))||/([2-9]\d|\d{3,})m old/.test(str(x.tag,80));
  return (ok.length?'<div id="fgrid">'+ok.map(x=>tile(sentence(str(x.head,60))||'Check',val(x)||'No reading',old(x)?'Out of date':null,old(x)?'stale':'','',[str(x.tag,80)].filter(Boolean))).join('')+'</div>':'')+
   (bad.length?empty({k:'bad',title:bad.length===1?(sentence(str(bad[0].head,60))||'A fleet check')+' is not reporting':bad.length+' fleet checks are not reporting',
    line:'It tries again on its own.',retry:'fleet',diag:bad.slice(0,8).map(x=>(str(x.head,60)||'check')+': '+val(x))}):'')}
 // Optional fleet signals share one compact section; no configured source is never a zero reading.
 function fleetSignals(f,now){
  const title=bhead('Fleet signals',f,now);
  if(!isObj(f)||f.error)return title+bdown('Fleet signals',f);
  const thermal=isObj(f.thermal)?f.thermal:{},hosts=isObj(thermal.hosts)?thermal.hosts:{};
  const total=Object.keys(hosts).length,measured=Object.values(hosts).filter(h=>num(h&&h.cpu_c)!=null||num(h&&h.soc_c)!=null||num(h&&h.skin_c)!=null||num(h&&h.gpu_c)!=null).length;
  const temp=Object.entries(hosts).slice(0,8).map(([name,h])=>{
   const label=num(h&&h.cpu_c)!=null?'CPU':num(h&&h.soc_c)!=null?'SoC':num(h&&h.skin_c)!=null?'Skin':'CPU';
   const value=num(h&&h.cpu_c)??num(h&&h.soc_c)??num(h&&h.skin_c),gpu=num(h&&h.gpu_c),sensor=str(h&&(h.cpu_sensor||h.soc_sensor),24);
   return row(str(name,24)||'Device',label+' '+fmt(value,0,'\u00B0C')+' \u00B7 GPU '+fmt(gpu,0,'\u00B0C'),'',value==null&&gpu==null?'stale':'','','',sensor?['Sensor '+sensor]:[])}).join('');
  const o=isObj(f.outbound)?f.outbound:{},h=isObj(f.hydra)?f.hydra:{},fl=isObj(f.flightradar)?f.flightradar:{},n=isObj(f.neighbors)?f.neighbors:{};
  const queue=x=>num(x&&x.files)==null?'unknown':fmt(x.files);
  const count=x=>num(x)==null?'unknown':fmt(x);
  return title+tile('Temperatures',thermal.error||!total?'Not reporting':measured+' of '+total+' machines reporting',
    thermal.error?'The sensors did not answer':thermal.stale?'Out of date':null,thermal.error?'bad':!total||thermal.stale||measured<total?'stale':'ok','',[thermal.error&&str(thermal.error,80),str(thermal.src,40)].filter(Boolean))+
   (temp?'<div class="flist">'+temp+'</div>':'')+
   tile('Outbound mail',queue(o.legacy_queue)+' waiting \u00B7 '+queue(o.quote_followup_queue)+' follow-ups',
    'Drafts '+count(o.drafts)+' \u00B7 agents '+count(o.outbound_agents),o.error?'bad':'stale','',[str(o.src,60)].filter(Boolean))+
   '<div class="flist">'+row('Hydra',h.installed===true?'Installed (not checked whether it is running)':h.installed===false?'Not installed':'Status unknown','','','','',[str(h.src,40)].filter(Boolean))+
    row('Flight radar',fl.installed===true?'Installed (live aircraft not checked)':fl.installed===false?'Not installed':'Status unknown','','','','',[str(fl.src,40)].filter(Boolean))+
    row('Network neighbors',num(n.cached_reachable_count)==null?'Status unknown':fmt(n.cached_reachable_count)+' known devices \u00B7 no new scan','','','','',[str(n.src,40)].filter(Boolean))+'</div>'}

 // ---- v8: Launch run window: safe markdown, one row per tool, human status line (all pure) ----
 const RUN_STATES=['queued','running','done','failed'];
 // The Run again button, without touching the DOM: no saved run and no item both mean disabled, never a crash.
 function againState(r,armed){const ok=!!(isObj(r)&&str(r.id,100)),on=ok&&armed===r.run_id;
  return {disabled:!ok,armed:on,text:!ok?'No item':on?'Tap again':'Run again',
   aria:on?'Tap again to run '+str(r.name,60):ok?'Run '+str(r.name,60)+' again':'Run again'}}
 function runClock(s){const n=num(s);if(n==null)return '--:--';const t=Math.max(0,Math.floor(n)),h=Math.floor(t/3600),m=Math.floor(t%3600/60),x=t%60,p=v=>String(v).padStart(2,'0');return h?h+':'+p(m)+':'+p(x):m+':'+p(x)}
// $HOME is never shown: see homeTilde and scanSecrets (top of this block)
// tool arguments are redacted by default: scanSecrets (url userinfo and query strings, credential names and shapes) plus long token-like strings
const LONG_TOKEN_RE=/(?=[A-Za-z0-9+\/_=-]*\d)[A-Za-z0-9+\/_=-]{32,}/g;
function scrubArg(s,n){let t=scanSecrets(s,{mark:'\u2026',query:true}).replace(LONG_TOKEN_RE,'\u2026');
  t=homeTilde(t).replace(/[\u0000-\u001F\u007F]/g,' ').replace(/\s+/g,' ').trim();const cap=n||48,c=Array.from(t);return c.length>cap?c.slice(0,cap-1).join('').trimEnd()+'\u2026':t}
// agent prose, line by line: credentials scrubbed, home folders read ~ (the server scrubs too; this is the same rule, never a different one)
const proseText=t=>String(t==null?'':t).split('\n').map(l=>homeTilde(scanSecrets(l))).join('\n');
 // a value that may arrive as plain text or as (possibly cut off) JSON: take the first of keys
 function jsonArg(v,keys){const t=String(v==null?'':v).trim();if(t[0]!=='{')return t;
  const m=new RegExp('"(?:'+keys.join('|')+')"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)').exec(t);return m?m[1].replace(/\\(.)/g,'$1'):''}
 function argFile(v){let t=jsonArg(v,['path','file_path','file','filename','target']).replace(/^\s*(?:path|file)\s*[=:]\s*/i,'').trim();
  if(/^["'`]/.test(t)){const q=t[0],j=t.indexOf(q,1);t=j>0?t.slice(1,j):t.slice(1)}else t=t.split(/\s+/)[0]||'';
  t=homeTilde(t);if(t==='~'||t==='~/')return '~';
  t=t.replace(/[?#].*$/,'').replace(/:\d+(?:[-,]\d+)?$/,'').replace(/\/+$/,'');const i=t.lastIndexOf('/');return scrubArg(i>=0?t.slice(i+1):t,40)}
 // a command shows its program only, never its arguments
 function argCmd(v){let t=jsonArg(v,['command','cmd']).trim().replace(/^cd\s+\S+\s*(?:&&|;)\s*/,'');
  const w=t.split(/\s+/);let k=0;while(k<w.length&&(/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[k])||/^(?:sudo|env|nice|time|nohup|timeout)$/.test(w[k])))k++;
  const p=String(w[k]||'').replace(/^\.\//,'').split('/').pop();return /^[A-Za-z0-9._+-]{1,32}$/.test(p)?p:''}
 function argUrl(v){const t=jsonArg(v,['url','uri','href']),m=/^\s*[a-z][a-z0-9+.-]*:\/\/(?:[^\/?#@\s]*@)?([^\/?#:\s]+)/i.exec(t);return m?m[1].replace(/^www\./i,'').slice(0,60):scrubArg(t,40)}
 const argText=v=>scrubArg(jsonArg(v,['query','q','text','prompt','name','input']),40);
 // [pattern, argument kind, status-line phrase, verb while running, verb when finished, whole label with no argument (running, finished)]
 const TOOL_SPECS=[
  [/^(?:read|read_file|view|view_file|cat|open_file)$/,'file','reading files','Reading','Read','Reading a file','Read a file'],
  [/^(?:write|write_file|create_file)$/,'file','writing files','Writing','Wrote','Writing a file','Wrote a file'],
  [/^(?:patch|edit|edit_file|replace|str_replace|apply_patch|multi_edit)$/,'file','editing files','Editing','Edited','Editing a file','Edited a file'],
  [/^(?:search_files|grep|glob|find|find_files|ripgrep|search_code)$/,'text','searching files','Searching for','Searched for','Searching files','Searched files'],
  [/^(?:terminal|bash|shell|process|execute|run_command|exec)$/,'cmd','running commands','Running','Ran','Running a command','Ran a command'],
  [/^(?:execute_code|python|run_code)$/,'','running code','Running code','Ran code','Running code','Ran code'],
  [/^web_search$/,'text','searching the web','Searching the web for','Searched the web for','Searching the web','Searched the web'],
  [/^(?:web_extract|web_fetch|fetch|http|browser_navigate)$/,'url','reading web pages','Reading','Read','Reading a web page','Read a web page'],
  [/^browser(?:_.*)?$/,'','browsing','Browsing the web','Browsed the web','Browsing the web','Browsed the web'],
  [/^(?:skill_view|skills_list|skill|skill_manage)$/,'text','loading a skill','Loading skill','Loaded skill','Loading a skill','Loaded a skill'],
  [/^(?:todo|todo_write|plan)$/,'','planning','Updating the plan','Updated the plan','Updating the plan','Updated the plan'],
  [/^memory$/,'','updating memory','Updating memory','Updated memory','Updating memory','Updated memory'],
  [/^delegate_task$/,'','delegating','Delegating a task','Delegated a task','Delegating a task','Delegated a task'],
  [/^session_search$/,'text','searching past chats','Searching past chats for','Searched past chats for','Searching past chats','Searched past chats'],
  [/^send_message$/,'','sending a message','Sending a message','Sent a message','Sending a message','Sent a message'],
  [/^cronjob$/,'','managing a scheduled job','Managing a scheduled job','Managed a scheduled job','Managing a scheduled job','Managed a scheduled job'],
  [/^(?:vision_analyze|image_analyze)$/,'','looking at an image','Looking at an image','Looked at an image','Looking at an image','Looked at an image'],
  [/^clarify$/,'','asking a question','Asking a question','Asked a question','Asking a question','Asked a question']];
 function toolSpec(tool){const n=String(tool==null?'':tool).toLowerCase().replace(/^mcp[_-]+/,'');
  for(const s of TOOL_SPECS)if(s[0].test(n))return {kind:s[1],say:s[2],run:s[3],done:s[4],bareRun:s[5],bareDone:s[6]};
  const h=n.split(/__|\./).pop().replace(/[_-]+/g,' ').replace(/[^a-z0-9 ]/g,'').trim().slice(0,28)||'a tool';
  return {kind:'',say:'using '+h,run:'Using '+h,done:'Used '+h,bareRun:'Using '+h,bareDone:'Used '+h}}
 // st: run (still going), ok, bad (the tool reported a failure), stop (the run ended before the tool reported back)
 function toolLabel(tool,preview,st){const sp=toolSpec(tool),fin=st==='ok'||st==='bad';let arg='';
  if(sp.kind==='file')arg=argFile(preview);else if(sp.kind==='cmd')arg=argCmd(preview);else if(sp.kind==='url')arg=argUrl(preview);else if(sp.kind==='text')arg=argText(preview);
  const t=arg?(fin?sp.done:sp.run)+' '+arg:(fin?sp.bareDone:sp.bareRun);
  return st==='bad'?t+' failed':st==='stop'?t+' stopped':t}
 // gateway lines -> items: "tool X: preview" and "tool X finished|failed" collapse into ONE row per tool call; other lines are prose
 const TOOL_DONE_RE=/^tool (\S+) (finished|failed)$/,TOOL_START_RE=/^tool ([^\s:]+):(?:\s+(.*))?$/,LINE_ERR_RE=/^(error|failed|cancelled|interrupted):\s*(.*)$/i;
 const ERR_WORD={error:'Error',failed:'Failed',cancelled:'Cancelled',interrupted:'Interrupted'};
 function runItems(lines,state){const items=[],pending=[],term=state==='done'||state==='failed';
  for(const raw of arr(lines)){const l=String(raw==null?'':raw);let m;
   if((m=TOOL_DONE_RE.exec(l))){const p=pending.findIndex(r=>r.tool===m[1]),st=m[2]==='failed'?'bad':'ok';
    if(p>=0){pending[p].st=st;pending.splice(p,1)}else items.push({k:'tool',tool:m[1],arg:'',st,n:1});continue}
   if((m=TOOL_START_RE.exec(l))){const r={k:'tool',tool:m[1],arg:m[2]||'',st:'run',n:1};items.push(r);pending.push(r);continue}
   if(state==='failed'&&(m=LINE_ERR_RE.exec(l))){items.push({k:'err',text:ERR_WORD[m[1].toLowerCase()]+(m[2]?': '+scrubArg(m[2],200):'')});continue}
   const last=items[items.length-1];if(last&&last.k==='md')last.text+='\n'+l;else items.push({k:'md',text:l})}
  if(term)for(const r of pending)r.st=state==='failed'?'stop':'ok';
  const out=[];for(const it of items){const p=out[out.length-1];
   if(p&&it.k==='tool'&&p.k==='tool'&&p.st!=='run'&&p.st===it.st&&p.tool===it.tool&&p.arg===it.arg)p.n+=it.n;else out.push(it)}
  return out}
 const GLYPH={ok:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  bad:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',run:'<i class="tspin"></i>'};
 const ST_WORD={run:'In progress',ok:'Done',bad:'Failed',stop:'Stopped'};
 function itemsHtml(items){let h='',open=false;
  for(const it of items){
   if(it.k==='tool'){if(!open){h+='<div class="rtools" role="list">';open=true}
    h+='<div class="rt '+it.st+'" role="listitem"><span class="tg" aria-hidden="true">'+(GLYPH[it.st]||GLYPH.bad)+'</span><span class="sr">'+ST_WORD[it.st]+'. </span><span class="tx">'+esc(toolLabel(it.tool,it.arg,it.st))+'</span>'+(it.n>1?'<span class="tn">\u00D7'+it.n+'</span>':'')+'</div>';continue}
   if(open){h+='</div>';open=false}
   h+=it.k==='err'?'<div class="rerr"><span class="tg" aria-hidden="true">'+GLYPH.bad+'</span><span>'+esc(it.text)+'</span></div>':'<div class="rmd">'+mdHtml(proseText(it.text))+'</div>'}
  return h+(open?'</div>':'')}
 // Markdown that cannot inject: nothing is ever passed through as HTML. Every literal piece goes through esc(); the only tags written are
 // the ones below; link targets must pass safeUrl (http or https, no quotes, angle brackets or spaces) or the link text stays as plain text.
 const MD_INLINE_RE=/`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\[([^\]\n]{1,200})\]\((\S{1,500}?)\)|(^|[\s(])\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?=[\s).,;:!?]|$)/g;
 function mdInline(s,d){let out='',i=0,m;const re=new RegExp(MD_INLINE_RE.source,'g');
  while((m=re.exec(s))){out+=esc(s.slice(i,m.index));i=m.index+m[0].length;
   if(m[1]!=null)out+='<code>'+esc(m[1])+'</code>';
   else if(m[2]!=null)out+='<strong>'+(d<2?mdInline(m[2],d+1):esc(m[2]))+'</strong>';
   else if(m[3]!=null){const u=safeUrl(m[4]),t=d<2?mdInline(m[3],d+1):esc(m[3]);out+=u?'<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+t+'</a>':t}
   else out+=esc(m[5])+'<em>'+esc(m[6])+'</em>'}
  return out+esc(s.slice(i))}
 function mdHtml(text){const L=String(text==null?'':text).replace(/\r\n?/g,'\n').split('\n').slice(0,400),out=[];let i=0,list=null;
  const flush=()=>{if(list){out.push('<'+list.t+'>'+list.items.map(x=>'<li>'+mdInline(x,0)+'</li>').join('')+'</'+list.t+'>');list=null}};
  const item=(t,x)=>{if(!list||list.t!==t){flush();list={t,items:[]}}list.items.push(x)};
  while(i<L.length){const l=L[i];let m;
   if((m=/^\s*(```|~~~)[A-Za-z0-9_+-]*\s*$/.exec(l))){flush();const f=m[1],buf=[];i++;while(i<L.length&&!L[i].trim().startsWith(f)){buf.push(L[i]);i++}
    out.push('<pre class="rcode"><code>'+esc(buf.join('\n'))+'</code></pre>')}
   else if(/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(l)){flush();out.push('<hr>')}
   else if((m=/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l))){flush();out.push('<div class="rh rh'+Math.min(m[1].length,3)+'" role="heading" aria-level="3">'+mdInline(m[2],0)+'</div>')}
   else if((m=/^\s*[-*+]\s+(.+)$/.exec(l)))item('ul',m[1]);
   else if((m=/^\s*\d{1,3}[.)]\s+(.+)$/.exec(l)))item('ol',m[1]);
   else if((m=/^\s*>\s?(.*)$/.exec(l))){flush();out.push('<blockquote>'+mdInline(m[1],0)+'</blockquote>')}
   else if(l.trim()==='')flush();
   else{flush();out.push('<p>'+mdInline(l.trim(),0)+'</p>')}
   i++}
  flush();return out.join('')}
 // run titles come from launch ids like "skill:morning-brief": show the name part, never the id syntax
 function runTitle(name){const s=cleanText(name,80).replace(/\s+/g,' '),m=/^[a-z]{3,8}:([A-Za-z0-9._\/-]{1,70})$/.exec(s),t=(m?m[1].replace(/[-_.]+/g,' ').trim():s);return str(t.charAt(0).toUpperCase()+t.slice(1),60)}
 // the model Hermes actually served (/api/run `route.served`, "openai-codex/gpt-6-luna"); a mismatch is shown by the run itself as a failure line
 function routeNote(m){const rt=isObj(m)&&isObj(m.route)?m.route:null,s=rt&&rt.ok!==false&&typeof rt.served==='string'?rt.served:'';return /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,79}$/.test(s)?'Model '+s:''}
 // r: {run_id,name,opened,model,got,err,fails,offline,beat}  model = last good /api/run answer, got = Date.now() when it arrived
 // Not finished + (gateway silent for RUN_OFFLINE_FAILS polls, or queued past RUN_QUEUE_TIMEOUT_S) reads offline with its reason.
 // A run that is not finished always prints a "last gateway heartbeat" line, so it never sits silent on "Working".
 const RUN_QUEUE_TIMEOUT_S=45,RUN_GIVEUP=20,RUN_OFFLINE_FAILS=2;
 function runView(r,now){const m=isObj(r&&r.model)?r.model:null,raw=m&&RUN_STATES.includes(m.state)?m.state:'queued',term=raw==='done'||raw==='failed';
  let el=null;
  if(m&&num(m.elapsed_s)!=null)el=term?m.elapsed_s:m.elapsed_s+Math.max(0,(now-(r.got||now))/1000);
  else if(num(r&&r.opened)!=null)el=Math.max(0,now/1000-r.opened);
  const fails=num(r&&r.fails)||0,gaveUp=!term&&fails>=RUN_GIVEUP,
   gwSilent=!term&&(fails>=RUN_OFFLINE_FAILS||(!!(r&&r.offline)&&fails>0)),
   deckSilent=gwSilent&&!(r&&r.offline),
   stalled=!term&&raw==='queued'&&(!!(m&&m.stalled)||(el!=null&&el>=RUN_QUEUE_TIMEOUT_S)),
   state=gwSilent||stalled?'offline':raw,
   reason=state!=='offline'?'':deckSilent?'Deck server not answering':gwSilent||!m?'Hermes offline':'Stuck in queue',
   beat=m&&num(m.t)!=null?m.t:m&&num(m.heartbeat)!=null?m.heartbeat:m&&num(r.got)?r.got/1000:num(r&&r.beat),
   hb=term?'':'<div class="rl dim hb">'+(beat!=null?'Last word from Hermes '+ago(beat,now):'No word from Hermes yet')+'</div>',
   give=gaveUp?'<div class="rl dim">Stopped retrying after '+fails+' failed polls. Tap Last run to try again.</div>':'';
  const lines=m?arr(m.lines).map(x=>str(x,240)).filter(Boolean):[];
  const wait=raw==='running'&&!!m&&m.detail==='waiting_for_approval';
  const empty=state==='offline'?reason+'. '+(!m?'Hermes has not answered yet':raw==='queued'?'Queued '+runClock(el)+(gwSilent?' and Hermes never started it':', Hermes answers but has not started it'):'Hermes stopped answering')
   :!m?'Waiting for Hermes to start':wait?'Hermes is waiting for your approval. Approve it in Hermes; this deck cannot approve':raw==='queued'?'Queued. No output yet':raw==='running'?'Running. Waiting for output':raw==='done'?'Finished with no output':'Failed with no output';
  const more=m&&num(m.more)>0?num(m.more):0,items=runItems(lines,raw),last=items[items.length-1];
  const say=!last?'getting started':last.k==='md'?'writing a reply':last.k==='tool'&&last.st==='run'?toolSpec(last.tool).say:'thinking';
  const note=state==='offline'?reason+(r&&r.err?' \u00B7 '+str(r.err,60):'')+(gaveUp?' \u00B7 stopped retrying':' \u00B7 retrying'):r&&r.err?(term?'Could not refresh this run':'Connection lost, trying again'):routeNote(m);
  return {state,label:state==='offline'?reason:wait?'Waiting for your approval':raw==='queued'?'Queued':raw==='running'?'Working: '+say:raw==='done'?'Done':'Failed',terminal:term,mark:raw==='done'?'ok':raw==='failed'||state==='offline'?'bad':'warn',elapsed:runClock(el),reason,gaveUp,
   title:runTitle(r&&r.name)||runTitle(m&&m.item)||'Hermes run',
   html:(more?'<div class="rl dim">'+more+' earlier line'+(more>1?'s':'')+' not shown</div>':'')+(items.length?itemsHtml(items):'<div class="rl dim">'+esc(empty)+'</div>')+hb+give,
   note,stale:!!(r&&r.err)||state==='offline'}}

 // ---- feedback release: detail sheet, cron and unit actions, Ask Hermes drafts, run thread, link rules (all pure) ----
 const UNIT_RE=/^[A-Za-z0-9@._-]{1,96}\.(service|timer)$/;
 const ID8_RE=/^[0-9a-f]{8}$/;
 const RUN_ID_RE=/^[A-Za-z0-9._-]{1,80}$/;
 // the browser only ever knows the first 8 hex chars of a job id; the server resolves the full id
 const cronId=j=>{const v=str(j&&j.id,8);return ID8_RE.test(v)?v:''};
// plain text for the API: printable characters plus newline and tab, trimmed, at most n code points (default 2000; Infinity keeps all). The server counts
// code points; a cut UTF-16 pair or a lone surrogate would make the JSON body invalid, so lone halves are dropped. Every Unicode space the server refuses
// (no-break, en/em/thin/ideographic and the rest of category Zs) becomes a plain U+0020, as the server (actions.rs clean_text, deck-launch send_text) does too.
const cleanText=(s,n)=>Array.from(String(s==null?'':s).replace(/\r\n?/g,'\n').replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g,' ').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g,'').replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g,'$1').replace(/[^\n\t\x20-\x7E\u00A0-\u2027\u202A-\uFFFF]/g,'').trim()).slice(0,n||2000).join('').trim();
 // tap-to-open: chain = [{tag,cls}] from the tapped element up to (not including) the page. Returns the index of the
 // card to open, or -1 when the tap belongs to a link, button, input, camera, Launch row or filter chip.
// Money is not listed: a tap must never copy a revealed amount into a sheet that outlives the 30 s hide
const SHEET_PAGES=['crons','fleet','today','cluster','dev','life','work','house','keys','home'];
const SHEET_OPEN=['tile','frow','mt','chip','node','dk','cronrow','hl','es','trow','tagg','wc'];
 const SHEET_BLOCK_TAG=['A','BUTTON','INPUT','TEXTAREA','SELECT','LABEL','SUMMARY','VIDEO','CANVAS'];
 const SHEET_BLOCK_CLS=['jchip','lnk','lnt','lnw','lnb','lnrow','cam','vb','key'];
 function sheetPick(page,chain){
  if(!SHEET_PAGES.includes(page)||!Array.isArray(chain))return -1;
  let hit=-1;
  for(let i=0;i<chain.length;i++){const n=chain[i]||{},tag=String(n.tag||'').toUpperCase(),cls=String(n.cls||'').split(/\s+/).filter(Boolean);
   if(SHEET_BLOCK_TAG.includes(tag)||cls.some(c=>SHEET_BLOCK_CLS.includes(c)))return -1;
   if(hit<0&&cls.some(c=>SHEET_OPEN.includes(c)))hit=i}
  return hit}
 // the card's own markup turned into plain lines; tags are dropped before entities are decoded, so decoded text is never markup
 const ENT={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&nbsp;':' '};
 function htmlLines(html,max){
  return String(html==null?'':html).replace(/<[^>]*>/g,'\n').replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g,m=>ENT[m])
   .split('\n').map(l=>l.replace(/[\u0000-\u001F\u007F]/g,' ').replace(/\s+/g,' ').trim()).filter(Boolean).map(l=>l.slice(0,400)).slice(0,max||40)}
 // diagnostics (.diag spans) leave the card text and show under "Details"; the card's own buttons are not text
 function cardSheet(html,label){const dg=[];
  const main=String(html==null?'':html).replace(/<button[\s\S]*?<\/button>/g,'').replace(/<span class="diag">([\s\S]*?)<\/span>/g,(m,t)=>{dg.push(t);return ''});
  const ls=htmlLines(main),log=htmlLines(dg.join('<i></i>'),30);
  return {kind:'card',title:ls[0]||'Details',sub:str(label,40),lines:ls.length>1?ls.slice(1):['No more text on this card'],log,logTitle:log.length?'Details':'',actions:[]}}
 const cronList=f=>isObj(f)?arr(f.active).filter(isObj).map(j=>({j,paused:false})).concat(arr(f.paused).filter(isObj).map(j=>({j,paused:true}))):[];
 const findCron=(f,id8)=>cronList(f).find(x=>cronId(x.j)===id8)||null;
 const cronActions=(paused,hasId)=>(hasId?[{id:'run',label:'Run now',confirm:true},paused?{id:'resume',label:'Resume',confirm:true}:{id:'pause',label:'Pause',confirm:true}]:[]).concat([{id:'ask',label:'Ask Hermes'}]);
 function cronDraft(j,paused,now){const ls=str(j&&j.last_status,24),last=j&&j.last_run_at;
  return cleanText('Cron job "'+(str(j&&j.name,80)||'unnamed')+'" (id '+(cronId(j)||str(j&&j.id,8)||'unknown')+')\nSchedule: '+(str(j&&j.schedule_display,60)||'unknown')+(paused?' (paused)':'')+
   '\nLast run: '+(last?(ls||'status unknown')+', '+ago(last,now):'never run')+'\n\nWhy did this fail, or what should I do about it?',1500)}
 // L28: a job that pins no model still runs. The server (crons.rs) sends model_source (pinned, fleet default, main default, none) and the
 // effective provider and model it resolved; an older server sends neither, and then the sheet says only what is known: nothing is pinned
 const MODEL_SRC={'fleet default':'Uses the fleet default model','main default':'Uses the main Hermes model',none:'No model set, and no default'};
 function cronModel(j){const pin=[str(j&&j.provider,40),str(j&&j.model,60)].filter(Boolean).join(' / ');if(pin)return pin;
  const w=MODEL_SRC[str(j&&j.model_source,16)],eff=[str(j&&j.effective_provider,40),str(j&&j.effective_model,60)].filter(Boolean).join(' / ');
  return w?w+(eff&&w!==MODEL_SRC.none?' ('+eff+')':''):'No model pinned'}
 function cronSheet(j,paused,now){const id8=cronId(j),ls=str(j&&j.last_status,24),last=j&&j.last_run_at,next=j&&j.next_run_at,nextT=toEpoch(next),failed=ls!==''&&ls.toLowerCase()!=='ok';
  const model=cronModel(j);
  return {kind:'cron',id:id8,title:str(j&&j.name,80)||'Unnamed job',sub:'Scheduled job',
   lines:['Schedule: '+schedule(j&&j.schedule_display),'Lane: '+laneOf(j),'Model: '+model,'State: '+(paused?'Paused':'Active'),
    'Last run: '+(last?(failed?'Failed':'OK')+' \u00B7 '+ago(last,now)+' \u00B7 '+clock(last):'Never run'),
    'Next run: '+(nextT==null?(paused?'None, paused':'Not scheduled'):paused?'Was due '+clock(next):until(next,now)+' \u00B7 '+clock(next))],
   log:[id8&&'ID '+id8,'Schedule text '+(str(j&&j.schedule_display,60)||'unknown'),str(j&&j.state,20)&&'State '+str(j.state,20),ls&&'Last status '+ls,'Provider and model '+model].filter(Boolean),logTitle:'Details',
   actions:cronActions(paused,!!id8),draft:cronDraft(j,paused,now)}}
 const unitOk=name=>typeof name==='string'&&UNIT_RE.test(name);
 function unitDraft(name,j){const ok=isObj(j)&&j.ok===true;
  return cleanText('Systemd user unit '+str(name,96)+' is failing.'+(ok?'\nState: '+(str(j.active,20)||'unknown')+(str(j.sub,20)?' ('+str(j.sub,20)+')':'')+'\nResult: '+(str(j.result,30)||'unknown')+(num(j.exit)==null?'':'\nExit status: '+j.exit):'')+
   '\n\nWhy is it failing, and what should I do about it?',1500)}
 const unitSheet=name=>({kind:'unit',id:str(name,96),title:str(name,96),sub:'Failing background service \u00B7 read only',lines:['Reading state and log'],actions:[{id:'ask',label:'Ask Hermes'}],draft:unitDraft(name,null)});
 // /api/unit reply -> sheet lines plus mono journal lines; any other answer is said out loud, never blank
 function unitView(j){
  if(!isObj(j)||j.ok!==true)return {lines:['Could not read this service. Check your connection, then open it again.'],log:[],logTitle:''};
  const log=arr(j.lines).map(x=>redact(String(x==null?'':x).slice(0,240))).filter(x=>x.trim()).slice(0,25);
  return {lines:['State: '+(str(j.active,20)||'unknown')+(str(j.sub,20)?' ('+str(j.sub,20)+')':''),'Result: '+(str(j.result,30)||'unknown'),'Exit status: '+(num(j.exit)==null?'unknown':j.exit),'Since: '+(str(j.since,60)||'unknown')],
   log,logTitle:log.length?'Log, last '+log.length+' line'+(log.length>1?'s':''):'The log is empty'}}
 // spec.html: markup a DeckUI builder already escaped (the ZIP detail sheet); lines and log follow it as plain text
 function sheetBody(spec){const s=isObj(spec)?spec:{};
  let h=(typeof s.html==='string'?s.html:'')+arr(s.lines).map(l=>'<div class="sl">'+esc(l)+'</div>').join('');
  const log=arr(s.log);
  if(log.length||s.logTitle)h+='<div class="sh">'+esc(s.logTitle||'Log')+'</div>'+log.map(l=>'<div class="sl mono">'+esc(l)+'</div>').join('');
  return h||'<div class="sl dim">No details</div>'}
 const sheetLink=url=>{const u=safeUrl(url);return u?'<a class="b sact" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">Open link'+LK+'</a>':''};
 // two-tap rule: a confirm action arms on the first tap and runs on a second tap on the same action within ARM_MS
 const ARM_MS=3000;
 const armedNow=(armed,id,now)=>!!(armed&&armed.id===id&&now-armed.t>=0&&now-armed.t<=ARM_MS);
 function tapAction(armed,id,now,confirm){
  if(!confirm)return {armed:null,run:true};
  if(armedNow(armed,id,now))return {armed:null,run:true};
  return {armed:{id,t:now},run:false}}
 const sheetActions=(actions,armed,now,busy)=>arr(actions).filter(isObj).map(a=>{const on=!!a.confirm&&armedNow(armed,a.id,now),label=str(a.label,30);
  return '<button type="button" class="b sact'+(a.danger?' danger':'')+(on?' armed':'')+'" data-act="'+esc(a.id)+'"'+(on?' aria-label="'+esc(label)+', tap again to confirm"':'')+(busy?' disabled':'')+'>'+esc(on?'Tap again':label)+'</button>'}).join('');
 const ACT_DONE={run:'Run started',pause:'Paused',resume:'Resumed'};
 function actResult(j,status,act){
  if(isObj(j)&&j.ok===true)return {k:'ok',text:(ACT_DONE[act]||'Done')+(str(j.name,60)?' \u00B7 '+str(j.name,60):'')};
  return {k:'bad',text:humanErr(j,status)}}
 // ---- run window thread: your messages, each agent turn's output under its message, at most 8 turns ----
 const THREAD_MAX=8,TURN_MODES=['new','reply','steer','launch'],SEND_MODES=['new','reply','steer'];
 function threadAdd(th,t){const turn={run_id:str(t&&t.run_id,80),text:cleanText(t&&t.text,2000),mode:TURN_MODES.includes(t&&t.mode)?t.mode:'new'};
  return RUN_ID_RE.test(turn.run_id)?arr(th).concat([turn]).slice(-THREAD_MAX):arr(th).slice(-THREAD_MAX)}
 const threadSave=th=>JSON.stringify({v:1,turns:arr(th).slice(-THREAD_MAX)});
 function threadLoad(raw){let o=null;try{o=JSON.parse(raw||'null')}catch(e){}
  return (isObj(o)?arr(o.turns):[]).filter(t=>isObj(t)&&typeof t.run_id==='string'&&RUN_ID_RE.test(t.run_id)).map(t=>({run_id:t.run_id,text:cleanText(typeof t.text==='string'?t.text:'',2000),mode:TURN_MODES.includes(t.mode)?t.mode:'new'})).slice(-THREAD_MAX)}
 // the thread always ends with the run that is open, so its output is never missing
 function threadFor(th,run){const t=arr(th),id=run&&typeof run.run_id==='string'?run.run_id:'';
  if(!id||(t.length&&t[t.length-1].run_id===id))return t;
  return t.concat([{run_id:id,text:'',mode:'launch'}]).slice(-THREAD_MAX)}
 // your message is a right-aligned bubble; a steer shares its run with the turn before it, so the agent's output sits under the last message of each run
 function threadHtml(turns,outHtml){return arr(turns).map((t,i,a)=>{const last=!a[i+1]||a[i+1].run_id!==t.run_id;
  return (t.text?'<div class="rb m-'+esc(t.mode)+'">'+esc(t.text)+'</div>':'')+
   (last?'<div class="rout" data-run="'+esc(t.run_id)+'">'+(typeof outHtml==='function'?outHtml(t.run_id):'')+'</div>':'')}).join('')}
 const sendLabel=state=>state==='running'||state==='queued'?'Add instruction':'Send';
// The text that would be sent, whole: a message is never cut. Over SEND_MAX the composer says so and Send stays off (sendState.tooLong).
const SEND_MAX=2000;
const sendText=raw=>cleanText(raw,Infinity);
const sendState=raw=>{const text=sendText(raw),n=Array.from(text).length;return {text,n,max:SEND_MAX,empty:n===0,tooLong:n>SEND_MAX,ok:n>0&&n<=SEND_MAX}};
const tooLongText=s=>'Too long: '+s.n+' of '+s.max;
const canSend=(raw,sending)=>!sending&&sendState(raw).ok;
const sendBody=(text,run)=>{const b={text:sendText(text)};if(run&&typeof run.run_id==='string'&&RUN_ID_RE.test(run.run_id))b.run_id=run.run_id;return b};
 // server words and statuses become one calm sentence; retry_s adds the wait
const SEND_ERR={'bad text':'That message cannot be sent','unknown run':'That run is gone. Start a new chat','too large':'That message is too long','rate limited':'Too many messages in a row','hermes gateway unreachable':'Hermes is not reachable right now','already active':'That run just ended',
 'gate blocked':'Jev did not approve that message. Nothing was sent','gate unsure':'Jev was not sure about that message. Nothing was sent. Reword it and try again','gate unavailable':'Jev and Clef did not answer. Nothing was sent','route invalid':'The run model setting is not valid. Nothing was sent'};
 function sendErr(j,status){const w=str(isObj(j)&&j.error,60),r=isObj(j)&&num(j.retry_s)!=null?'. Try again in '+Math.ceil(j.retry_s)+' s':'';
  if(SEND_ERR[w])return SEND_ERR[w]+r;
  if(status===429)return 'Too many messages in a row'+r;if(status===413)return SEND_ERR['too large'];
  if(status>=500||(status===0&&!w))return status?'Hermes is not reachable right now':'The deck did not answer';
  return w?w.charAt(0).toUpperCase()+w.slice(1)+r:'The deck did not answer'}
 function sendResult(j,status){
  if(isObj(j)&&j.ok===true&&SEND_MODES.includes(j.mode)&&typeof j.run_id==='string'&&RUN_ID_RE.test(j.run_id))return {ok:true,mode:j.mode,run_id:j.run_id};
  return {ok:false,err:sendErr(j,status)}}
 // Cmd or Ctrl+Enter always sends; on a touch keyboard plain Enter sends too (Shift+Enter is a newline)
 function enterSends(e,coarse){if(!isObj(e)||e.key!=='Enter'||e.isComposing)return false;if(e.ctrlKey||e.metaKey)return true;return !!coarse&&!e.shiftKey&&!e.altKey}
 // the composer grows with its text up to maxRows lines (scrollH includes the vertical padding)
 const growHeight=(scrollH,lineH,padV,maxRows)=>{const cap=lineH*(maxRows||4)+padV;return Math.round(Math.max(lineH+padV,Math.min(num(scrollH)==null?0:scrollH,cap)))};
// The iOS shell (user agent OmarchyDeck/) does not cancel target=_blank: it loads a same-origin _blank link in place and sends an off-origin _blank link to Safari (DeckModel.swift). The deck still drops the attribute on click in the shell, so every link there behaves as a plain one.
 const isDeckShell=ua=>/OmarchyDeck\//.test(String(ua==null?'':ua));
 // iPhone soft keyboard: the layout viewport keeps its full height while the keyboard covers the bottom of it. When the visual
 // viewport is shorter or scrolled, the run window is pinned to it (height and vertical offset); null means it fills the screen.
 const vvFit=(innerH,vvH,vvTop)=>{const ih=num(innerH),h=num(vvH),t=num(vvTop);if(ih==null||h==null||h<=0)return null;
 const top=Math.max(0,Math.round(t==null?0:t));return h>=ih-1&&top===0?null:{height:Math.round(h),top}};
 const dropsTarget=(ua,tag,target)=>isDeckShell(ua)&&String(tag||'').toUpperCase()==='A'&&String(target||'').toLowerCase()==='_blank';
 // ---- shared number words for the older panels (Money, Launch, Fleet). Unknown is a dash with the reason beside it, never 0.
 // Shop moved to static/pages/shop.js (Deck v3, 2026-11-14).
 const DASH='\u2014',MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 const money=v=>{const n=num(v);return n==null?DASH:(n<0?'\u2212$':'$')+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})};
 const cnt=v=>{const n=num(v);return n==null?DASH:Math.round(n).toLocaleString('en-US')};
 const share=v=>{const n=num(v);return n==null?DASH:Math.round(n*100)+'%'};
 // signed percent from a fraction; the sign follows the rounded figure so "+0.0%" never prints
 const pct=(v,d)=>{const n=num(v);if(n==null)return DASH;const s=(n*100).toFixed(d==null?1:d),z=+s===0;return (z?'':n>0?'+':'\u2212')+s.replace('-','')+'%'};
// ONE timestamp per feed: `generated_at` (FEEDS.md, 2026-10-21), else `t` for an older file. `as_of` is when the data was true: it is named in the same
// line only when it is clearly older than the file, so a panel never says "Updated 1 min ago" over a 23 day old snapshot. A number `as_of` is read as is;
// an object `as_of` ({quotes}, {positions, crypto, prices}, {balances, inventory}) is read at `key`.
const genAt=f=>{const g=isObj(f)?toEpoch(f.generated_at):null;return g!=null?g:isObj(f)?toEpoch(f.t):null};
const asOfAt=(f,key)=>{const a=isObj(f)?f.as_of:null;return toEpoch(isObj(a)?(key?a[key]:null):a)};
 // text cut at a word with a visible ellipsis, never mid-word (feed titles run to 200 chars)
 const clip=(v,n)=>{const s=typeof v==='string'?v.replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim():'';if(s.length<=n)return s;
  const cut=s.slice(0,n-1),sp=cut.lastIndexOf(' ');return (sp>n*.5?cut.slice(0,sp):cut).replace(/[\s,;:.\-\u2013\u2014]+$/,'')+'\u2026'};


 // ---- Money > Accounts. GET /api/finance = ids, kinds, routes, statuses and ages (no amounts, ever). GET /api/finance-values = the amounts,
 // asked for only on Show amounts. finPage never reads apps[].values or totals from the sanitised feed (a feed that carries them anyway is
 // ignored); amounts come only from `rev`, the view of finCtl, the one place that holds them: hidden by default, gone after 30 s, on Hide,
 // on a route change and when the page is hidden. The page is about money: capture status, the app inventory and the writer's explanations
 // live in the Data sheet (finData); a row shows a status only when its capture is out of date or blocked. Nothing here touches a URL or storage.
 const FIN_KINDS=['bank','brokerage','crypto','payments','wallet','networth','tax','shopping','receipts','other'];
 const FIN_LABEL={bank:'Bank',brokerage:'Brokerage',crypto:'Crypto',payments:'Payments',wallet:'Wallet',networth:'Net worth',tax:'Tax',shopping:'Shopping',receipts:'Receipts',other:'Other'};
 const FIN_ROUTE={iphone_screen:'iPhone screen',api:'Read-only API',none:'No read route'};
 const FIN_STATUS=['never','ok','stale','needs_owner','needs_unlock','blocked'];
 const FIN_WORD={stale:'Out of date',needs_owner:'Needs you',needs_unlock:'Needs unlock',blocked:'Blocked'};
 // Data sheet state per app status (UiApi 3.4 words)
 const FIN_DS={ok:'ok',stale:'stale',needs_owner:'blocked',needs_unlock:'blocked',blocked:'blocked',never:'never',unknown:'never'};
 const FIN_HIDE_MS=30000,FIN_MASK='$\u2022\u2022\u2022';
 const ownKey=(o,k)=>o!=null&&typeof o==='object'&&Object.prototype.hasOwnProperty.call(o,k);
 const finKind=a=>FIN_KINDS.includes(a&&a.kind)?a.kind:'other';
 const fcdText=(exp,now)=>'Hides in '+Math.max(0,Math.ceil((exp-now)/1000))+' s';
 // one app of the sanitised feed: status as the writer reported it. The writer's "ok" means the source answered on its last read; it
 // sends cadence_s (how often it reads that source: Kraken 5 min, IBKR and SimpleFIN 3 h, the tax sheet 30 days), so an "ok" whose last
 // read is older than twice its cadence is out of date (blueprint: twice its refresh). An app without cadence_s falls back to twice the
 // longer of the feed refresh and one day: a backstop that can show a day-old read as current, never the other way round.
 // name: what the page prints, without the writer's parenthetical source hint ("Bank cash (SimpleFIN)", "Tax (sheets in ~/x)"); full: the
 // writer's whole label, for the Data sheet
 const FIN_DAY=86400;
 function finApp(a,f,now){
  const id=str(a.id,40),t=toEpoch(a.last_ok),full=str(a.name,80)||id||'app';
  let st=FIN_STATUS.includes(a.status)?a.status:'unknown';
  const every=num(a.cadence_s)>0?a.cadence_s:Math.max(num(f.refresh)||0,FIN_DAY);
  if(st==='ok'&&t!=null&&now/1000-t>2*every)st='stale';
 return {id,name:full.replace(/\s*\([^()]*\)\s*$/,'').slice(0,48)||full.slice(0,48),full:redact(full),kind:finKind(a),route:FIN_ROUTE[a.route]?a.route:'none',st,t,has:a.has_values===true,why:redact(str(a.reason,160)),
  // how the source is read (live, end of day, a daily bank snapshot) and when its data was true; a card or loan account is a liability
  basis:FIN_BASES.includes(a.basis)?a.basis:'',dAt:toEpoch(a.data_as_of),dNew:toEpoch(a.data_newest),liab:a.sense==='liability',note:redact(str(a.note,160))}}
const FIN_BASES=['live','eod','daily'];
// how old an account's data is, in words (plan row L17): "Live, read 2 min ago", "End-of-day figures from 2 d ago", "Balances from 16 h to
// 2 d ago" (a bank snapshot: its newest and oldest balance), "Read 17 d ago" for a source that names no basis. A basis without a date says
// so, never "0 min". Never captured: nothing to say.
function finAge(m,now){if(m.st==='never')return '';
 const span=m.dNew!=null&&m.dAt!=null&&Math.abs(m.dNew-m.dAt)>3600?(lapse(Math.max(m.dNew,m.dAt),now)||'under a minute')+' to '+ago(Math.min(m.dNew,m.dAt),now):m.dAt!=null?ago(m.dAt,now):'';
 const s=m.basis==='live'?(m.t!=null?'Live, read '+ago(m.t,now):'Live, read time not given'):m.basis==='eod'?(m.dAt!=null?'End-of-day figures from '+ago(m.dAt,now):'End-of-day figures, date not given')
  :m.basis==='daily'?(span?'Balances from '+span:'Balances, date not given'):m.t!=null?'Read '+ago(m.t,now):'';
 return whole(s)}
// one row: the app name, a status only when something is wrong, how old its data is, the amount (masked until shown). Revealed items ride in
// a further line, three at most; the row opens the app's sheet (finSheet), which lists every item the values view carries. A card or loan
// account reads "Owed" before its figure, masked or shown, and a writer that stores a debt as a negative still reads as the amount owed.
function finRow(m,vals,shown,now,unavailable){
  const bad=m.st==='blocked',pill=FIN_WORD[m.st]?'<small><span class="pill'+(bad?' bad':' warn')+'"><span class="sd '+(bad?'bad':'warn')+'"></span>'+FIN_WORD[m.st]+'</span></small>':'';
  const age=finAge(m,now),items=shown&&isObj(vals)?arr(vals.items).filter(isObj).slice(0,3).map(i=>(str(i.label,40)||'item')+' '+money(i.usd)).join(' \u00B7 '):'';
  const ow=m.liab?'Owed ':'',bal=shown&&isObj(vals)?num(vals.balance_usd):null;
  const amt=shown?(bal!=null?'<b>'+ow+esc(money(m.liab?Math.abs(bal):bal))+'</b>':m.has?'<b class="na">No balance</b>':''):m.has?'<b>'+ow+FIN_MASK+'</b>':'';
  return '<button type="button" class="frow"'+(unavailable?' disabled':'')+' data-open="app" data-app="'+esc(m.id)+'"><span class="fl"><b>'+esc(m.name)+'</b>'+pill+(age?'<small class="fin-age">'+esc(age)+'</small>':'')+(items?'<small>'+esc(items)+'</small>':'')+'</span>'+(amt?'<span class="fr">'+amt+'</span>':'')+'</button>'}
 // the Show amounts control: Show, or Hide with its countdown, and the last error in words
 function finCtlRow(rev,now,can){const on=!!rev&&num(rev.exp)>0;
  if(rev&&rev.unavailable)return '';
  if(!can&&!on)return '';
  return '<div class="ivctl">'+(on?'<button type="button" class="btn" data-fin="hide">Hide</button><span class="fcd" data-exp="'+Math.round(rev.exp)+'">'+fcdText(rev.exp,now)+'</span>'
   :'<button type="button" class="btn" data-fin="show"'+(rev&&rev.busy?' disabled':'')+'>'+(rev&&rev.busy?'Loading':'Show amounts')+'</button>')+
   (rev&&rev.err?'<span class="ivctl-err"><span class="sd bad"></span>'+esc(str(rev.err,80))+'</span>':'')+'</div>'}
// one app's sheet, opened from its row: {title, sub, body, actions} for DeckShell.sheet, or null when the feed no longer lists the app.
// Masked it holds the app's status and capture date only; the values view is not read. After Show amounts it holds the balance, its date
// and every item the values view carries for the app (FIN_ITEMS_MAX at most). The glue repaints it from finCtl.view() on every change, so
// it masks again at Hide, at 30 s, on a route change and when the page is hidden, exactly like the page. Nothing here reaches finData.
const FIN_ITEMS_MAX=60;
function finSheet(f,id,now,rev){
 if(!isObj(f)||f.error||typeof id!=='string'||!id)return null;
 let m=null;for(const a of arr(f.apps).filter(isObj).slice(0,120)){try{const x=finApp(a,f,now);if(x.id===id){m=x;break}}catch(e){}}
 if(!m)return null;
 const shown=!!rev&&num(rev.exp)>0,v=shown&&isObj(rev.apps)&&ownKey(rev.apps,m.id)&&isObj(rev.apps[m.id])?rev.apps[m.id]:null;
 const bad=m.st==='blocked',state=FIN_WORD[m.st]?'<div class="flist"><div class="frow"><span class="fl"><b><span class="pill'+(bad?' bad':' warn')+'"><span class="sd '+(bad?'bad':'warn')+'"></span>'+FIN_WORD[m.st]+'</span></b>'+
  (m.why?'<small>'+esc(m.why)+'</small>':'')+'</span></div></div>':'';
 const bal=shown?(v&&num(v.balance_usd)!=null?money(m.liab?Math.abs(v.balance_usd):v.balance_usd):m.has||v?'No data':'None yet'):m.has?FIN_MASK:'None yet';
 const at=shown&&v&&toEpoch(v.as_of)!=null?'As of '+V3.FMT.date(toEpoch(v.as_of)):m.t!=null?'Captured '+V3.FMT.date(m.t):'Not captured yet';
 const tile='<section class="sect" aria-label="Balance">'+V3.strip([V3.tile({label:m.liab?'Owed':'Balance',value:bal,sub:at})],{label:'Balance'})+finCtlRow(rev,now,m.has)+'</section>';
 let items='';
 if(shown&&v){const it=arr(v.items).filter(isObj),list=it.slice(0,FIN_ITEMS_MAX);
  items=list.length?'<section class="sect"><h2 class="secttl"><span>Items</span><span class="act">'+esc(it.length+(it.length===1?' item':' items'))+'</span></h2><div class="flist">'+
   list.map(i=>'<div class="frow"><span class="fl"><b>'+esc(str(i.label,120)||'Item')+'</b></span><span class="fr">'+(num(i.usd)==null?'<b class="na">No data</b>':'<b>'+esc(money(i.usd))+'</b>')+'</span></div>').join('')+'</div>'+
   (it.length>list.length?'<p class="note">'+esc((it.length-list.length)+' more not shown')+'</p>':'')+'</section>'
   :'<p class="note">No items for this app.</p>'}
 else if(m.has)items='<p class="note">The balance and its items show after Show amounts, then hide again after 30 s.</p>';
 else items='<p class="note">'+(m.st==='never'?'Nothing captured for this app yet.':'This app has no amounts captured.')+'</p>';
 return V3.detail({title:m.name,sub:FIN_LABEL[m.kind],body:state+tile+items})}
 // Money > Accounts, the whole sub page. rev = finCtl.view() or null.
 function finPage(f,now,rev){
  if(!isObj(f)||f.error){
   if(isObj(f)&&/missing|not found|no such file|not written/i.test(str(f.error,120)))return empty({k:'idle',title:'Money is not set up',line:'Money needs a finance feed. It fills in after the first capture.'});
   // a failed read is the failed state every other page uses (crossed square, the cause in plain words, one Try again), never a warn wash
   return down('Money',f,'money/accounts')}
  const ms=[];arr(f.apps).filter(isObj).slice(0,120).forEach(a=>{try{ms.push(finApp(a,f,now))}catch(e){}});
  const shown=!!rev&&num(rev.exp)>0,vals=id=>shown&&isObj(rev.apps)&&ownKey(rev.apps,id)?rev.apps[id]:null;
  const can=ms.some(m=>m.has)||f.has_totals===true,t=shown&&isObj(rev.totals)?rev.totals:null;
  const sample=f.sample===true?'<div class="stale-bar"><span class="sd warn"></span>Sample data. Made-up numbers, not real money.</div>':'';
  // the Total is the page's strip (first data, and the TV board's first band), masked until Show amounts. Assets and Owed follow it on every
  // size (plan row L16: what he owns and what he owes, apart; a card or a loan is never netted into cash), each with its groups under it
  // after Show amounts. Each kind with an app beside it (Bank, Brokerage, Tax ...) is its own tile in the same strip from a laptop up (dx),
  // so on a wide window the Total never stands alone in a full-width panel (W4-6, the owner's 2470 px window); the kind headings below
  // carry the same sums. A strip figure is the deck's short money form ($27K, $1.23M), so it never runs out of its tile; rows keep the
  // cents. A figure the file does not give reads No data with the reason, never zero. A source whose read failed (not_counted, ids only)
  // is named on the Total, masked or shown.
  const fig=v=>V3.FMT.money(v)||'No data',byK=k=>t&&isObj(t.by_kind)&&ownKey(t.by_kind,k)?num(t.by_kind[k]):null;
  // the Total never prints a net the split does not back (review ReviewFive): with the money block, a missing side makes the Total No data
  // with that side's reason, and assets less owed must match the net within $1; without it the old total of the apps stands, said so
  const mo=shown&&isObj(rev.money)?rev.money:null,mA=mo?num(mo.assets_usd):null,mL=mo?num(mo.liabilities_usd):null,mN=mo?num(mo.net_usd):null;
  const tot=!shown?{v:null,why:''}:mo?(mA==null?{v:null,why:'Assets are not in the file'}:mL==null?{v:null,why:'Owed is not in the file'}:mN==null?{v:null,why:'No total in the file'}
   :Math.abs(mN-(mA-Math.abs(mL)))>1?{v:null,why:'The file\u2019s figures do not add up'}:{v:mN,why:''})
   :t&&num(t.net_usd)!=null?{v:t.net_usd,why:'Not split into assets and owed'}:{v:null,why:'No total in the file'};
  const totalV=shown?(tot.v!=null?fig(tot.v):'No data'):can?FIN_MASK:'None yet';
  const nc=arr(f.not_counted).map(x=>{const s=str(x,40),a=ms.find(m=>m.id===s);return a?a.name:s}).filter(Boolean).slice(0,8);
  const totSub=[shown?tot.why:can?'':'Nothing captured yet',nc.length?'Not counted: '+nc.join(', '):''].filter(Boolean).join(' \u00B7 ');
  // one side: its figure (what is owed as a positive amount) and its groups, without the writer's source hint in brackets
  const grp=cls=>arr(mo&&mo.groups).filter(g=>isObj(g)&&g.class===cls&&num(g.usd)!=null).slice(0,6).map(g=>(str(g.label,40).replace(/\s*\([^()]*\)\s*$/,'')||'Other')+' '+fig(Math.abs(g.usd))).join(' \u00B7 ');
  const side=(label,key,cls)=>{const v=mo?num(mo[key]):null;
   return V3.tile({label,value:shown?(v!=null?fig(cls==='liability'?Math.abs(v):v):'No data'):FIN_MASK,sub:shown?(v!=null?grp(cls):mo?'Not in the file':'Not split out in the file'):''})};
  const listedK=FIN_KINDS.filter(k=>ms.some(m=>m.kind===k&&(m.st!=='never'||m.has)));
  const kindT=k=>{const v=byK(k);return V3.tile({cls:'dx',label:FIN_LABEL[k],value:shown?(v!=null?fig(v):'No data'):FIN_MASK,sub:shown&&v==null?(t?'Not in the total':'No total in the file'):''})};
  const tiles=[V3.tile({label:'Total, net across your apps',value:totalV,sub:totSub})].concat(can||shown?[side('Assets','assets_usd','asset'),side('Owed','liabilities_usd','liability')].concat(listedK.map(kindT)):[]);
  const total='<section class="sect span-all fin-tot" aria-label="Total">'+V3.strip(tiles,{label:'Total'})+finCtlRow(rev,now,can)+'</section>';
  // a captured app (or one whose capture went wrong) is a row; apps never captured are one line that opens the Data sheet
  const listed=ms.filter(m=>m.st!=='never'||m.has),never=ms.filter(m=>m.st==='never'&&!m.has);
  let groups='';
  for(const k of FIN_KINDS){const rows=listed.filter(m=>m.kind===k);if(!rows.length)continue;
   const sub=t&&isObj(t.by_kind)&&ownKey(t.by_kind,k)&&num(t.by_kind[k])!=null?'<span class="act">'+esc(money(t.by_kind[k]))+'</span>':'';
   groups+='<section class="sect"><h2 class="secttl"><span>'+esc(FIN_LABEL[k])+'</span>'+sub+'</h2><div class="flist">'+rows.map(m=>finRow(m,vals(m.id),shown,now,rev&&rev.unavailable)).join('')+'</div></section>'}
  const kinds=FIN_KINDS.filter(k=>never.some(m=>m.kind===k)).map(k=>FIN_LABEL[k]);
  const rest=never.length?'<section class="sect"><h2 class="secttl"><span>Not captured yet</span></h2><div class="flist"><button type="button" class="frow" data-sheet="data"><span class="fl"><b>'+
   esc(never.length+(never.length===1?' app':' apps'))+'</b><small>'+esc(kinds.join(', '))+'</small></span></button></div></section>':'';
  // the TV board: the Total, then the app rows in a grid that tv.js cuts by height; nothing else sits below
  return sample+'<div class="board">'+total+'<div class="flow board-fill">'+groups+rest+'</div></div>'}
 // the page's one freshness mark: the feed's own age and the sources that did not report
 function finStatus(f,now){if(!isObj(f)||f.error)return {age:null,refresh:300,missing:1};
  const g=genAt(f);return {age:g==null?null:Math.max(0,now/1000-g),refresh:num(f.refresh)>0?f.refresh:300,missing:arr(f.errors).length}}
 // what GET /api/finance must look like before the page draws it (DeckPages.get opt.shape): an object with an app list, and the optional
 // blocks as objects or lists. A wrong-typed answer is a failed read, so the page says Money is not reporting with Try again instead of
 // "None yet" over apps it never got. (The guard never keeps this route: it is on its no-memory list with the amount routes.)
 const finShape=f=>isObj(f)&&Array.isArray(f.apps)&&(f.errors==null||Array.isArray(f.errors))&&(f.inventory==null||isObj(f.inventory))&&(f.not_counted==null||Array.isArray(f.not_counted));
 // the Data sheet: one source per captured app with its read route and last good capture, the iPhone inventory, the writer's notes, what needs you
 function finData(f,now){if(!isObj(f)||f.error)return {sources:[{name:'Finance feed',gives:'Not reporting',asOf:'',state:'never'}],method:[],setup:[]};
  const ms=[];arr(f.apps).filter(isObj).slice(0,120).forEach(a=>{try{ms.push(finApp(a,f,now))}catch(e){}});
  // read times go to the Data sheet as epoch seconds; DeckUI.dataSheet prints them as dates
  const when=t=>{const e=toEpoch(t);return e==null?'':Math.round(e)};
  // each source: its read route, then for a source that says how it is read (live, end of day, a bank snapshot) how old its data is (the
  // same words its row says). A source with no basis adds nothing here: its row's "Read N ago" is the read time asOf already gives.
  const sources=ms.filter(m=>m.st!=='never').map(m=>({name:m.full,gives:[FIN_ROUTE[m.route],m.basis?finAge(m,now):''].filter(Boolean).join(' \u00B7 '),asOf:when(m.t),state:FIN_DS[m.st]||'never'}));
  const inv=isObj(f.inventory)?f.inventory:null,ex=isObj(f.explain)?f.explain:{},scan=asOfAt(f,'inventory');
  if(inv)sources.push({name:'iPhone app list',gives:[num(inv.installed)!=null?cnt(inv.installed)+' apps':'',num(inv.finance_related)!=null?cnt(inv.finance_related)+' look financial':'',num(inv.covered)!=null?cnt(inv.covered)+' captured':''].filter(Boolean).join(', ')||'Counts not reported',asOf:when(scan!=null?scan:inv.t),state:'ok'});
  for(const e of arr(f.errors).filter(isObj))sources.push({name:str(e.source,40)||'A source',gives:'Not reporting',asOf:'',state:'never'});
  const method=[];
  if(str(ex.last_checked,200))method.push(['Last checked',str(ex.last_checked,200)]);
  method.push(['Amounts','Hidden until you tap Show amounts, then hidden again after 30 s. Nothing guesses a balance.']);
  method.push(['Assets and owed','Cards and loans are what you owe, never netted into cash. The total is what you own less what you owe.']);
  // the writer's own note per source ("SimpleFIN says: ..."), under the source's whole name
  for(const m of ms)if(m.note)method.push([m.full,m.note]);
  const setup=ms.filter(m=>FIN_WORD[m.st]).map(m=>({name:m.full,line:m.why||(m.st==='stale'?'The last capture is old.':m.st==='needs_unlock'?'The phone is locked.':m.st==='needs_owner'?'Needs you at the phone.':'The app blocked the read.'),state:FIN_DS[m.st]}));
  const never=ms.filter(m=>m.st==='never');
  if(never.length)setup.push({name:never.length+(never.length===1?' app':' apps')+' not captured yet',line:never.map(m=>m.name).join(', ')+'. '+(str(ex.never,200)||'Each fills in after you approve a capture on your phone.'),state:'never'});
  return {sources,method,setup}}
 // Show amounts controller. Holds the only copy of revealed amounts. env = {get(path)->Promise<json>, setT, clearT, now()->ms, onChange()}.
 // reveal() shows every app that has values, the totals and the assets and owed split (money) for FIN_HIDE_MS; hide() and expiry drop
 // them, then onChange() repaints masked.
 function finCtl(env,ms){
  const HIDE=ms||FIN_HIDE_MS;
  let apps=null,totals=null,money=null,exp=0,timer=null,gen=0,err='',busy=false;
  const clear=()=>{if(timer!=null){env.clearT(timer);timer=null}};
  function hide(){const was=busy||exp>0||err!=='';gen++;busy=false;err='';apps=null;totals=null;money=null;exp=0;clear();if(was)env.onChange()}
  function sweep(){if(exp>0&&env.now()>=exp){hide();return true}return false}
  async function reveal(){
   if(busy)return;busy=true;err='';const g=gen;env.onChange();
   let r=null;try{r=await env.get('/api/finance-values')}catch(e){r=null}
   if(g!==gen)return; // hidden while the request was in flight: the answer is dropped unread
   busy=false;
   if(!isObj(r)||r.error){err=isObj(r)&&r.error?'Could not load the amounts. Try again.':'The deck did not answer. Try again.';env.onChange();return}
   apps=Object.create(null);const av=isObj(r.apps)?r.apps:{};for(const id of Object.keys(av))apps[id]=isObj(av[id])?av[id]:null;
   totals=isObj(r.totals)?r.totals:null;money=isObj(r.money)?r.money:null;exp=env.now()+HIDE;clear();timer=env.setT(()=>{timer=null;hide()},HIDE);env.onChange()}
  return {reveal,hide,sweep,view:()=>({apps,totals,money,exp,err,busy})}}

 // ---- Fleet page: a blank body always says why ----
 // s: {f,nd,dk,st,mc,bd,err} = the /api/fleet, nodes, disks, sites, mcp, fleet-board answers (null or {error} when a read failed);
 // err = the message of a thrown read. blank=true when no part has anything to draw; reasons lists every part that failed or is empty.
 function fleetNotice(s){s=isObj(s)?s:{};const why=[],add=(k,o,key,none)=>{if(!isObj(o))why.push(k+': deck server did not answer');else if(o.error)why.push(k+': '+str(o.error,80));else if(!arr(o[key]).length)why.push(k+': '+none)};
  const f=isObj(s.f)?s.f:null,sv=f&&isObj(f.services)?f.services:null,rc=f&&isObj(f.reach)?f.reach:null;
  if(s.err)why.push('Fleet read failed: '+str(String(s.err),80));
  if(!f)why.push('Fleet facts: deck server did not answer');else if(f.error)why.push('Fleet facts: '+str(f.error,80));else if(f.empty_reason)why.push(str(f.empty_reason,100));
  add('GB10 nodes',s.nd,'nodes','none reported');add('Disks',s.dk,'drives','none reported');add('Sites',s.st,'items','none reported');
  if(isObj(s.mc)&&s.mc.error)why.push('MCP: '+str(s.mc.error,80));
  const bd=isObj(s.bd)?s.bd:null,okParts=bd?['machines','cluster','models','backup','units'].filter(k=>isObj(bd[k])&&!bd[k].error):[];
  if(!bd)why.push('Fleet board: deck server did not answer');else if(!okParts.length)why.push('Fleet board: every source is unavailable');
  const has=(o,k)=>isObj(o)&&!o.error&&arr(o[k]).length>0;
  const live=has(f,'items')||has(sv,'items')||has(rc,'items')||has(s.nd,'nodes')||has(s.dk,'drives')||has(s.st,'items')||okParts.length>0||!!(f&&isObj(f.cluster)&&f.cluster.ok===true);
  const reasons=why.slice(0,6),blank=!live;
  return {blank,reasons,html:'<div class="tile bad why" role="status"><div class="h"><i class="sd bad"></i>Fleet</div><div class="v">'+(blank?'Nothing to show':'Some sources are missing')+'</div>'+
   (reasons.length?reasons.map(x=>'<div class="t">'+esc(x)+'</div>').join(''):'<div class="t">No source reported anything</div>')+'</div>'}}
 // ==== v3 shared helpers (plan/design/UiApi.md §3 and §6.3; tests/ui_*.test.js). Pure: each returns text or HTML and escapes every value it did not build.
 // Inline style carries custom properties only (--v --x --y --h --q1 --q3 --md --cu --lo --hi --ar --n --days). No data: or blob: URLs.
 const V3=(()=>{
  // the v3 formats live in static/ui-core.js (DeckCore.fmt.money ...); the names stay, so no call site changes
  const {MINUS,DOT,NA,grp,neg,trim0,MON,COMPASS,toDate}=DeckCore;
  const {money,rent,psf,lease,rate,share,chg,pt,count,date,month,time,age,temp,ft,period,wind,na,compass}=DeckCore.fmt,FMT=DeckCore.fmt;
  const txt=v=>v==null?'':String(v);
  const keyAttr=k=>k==null||k===''?'':' data-key="'+esc(k)+'"';
  const openKind=k=>/^[a-z][a-z0-9-]{0,30}$/.test(String(k||''))?String(k):'';
  const pc=x=>Math.round(Math.max(0,Math.min(100,x))*10)/10+'%';
  // ---- confidence dots (blueprint 2.2): blended numbers only; none for a single source
  function conf(score,o){const s=num(score);o=isObj(o)?o:{};if(s==null)return '';const total=num(o.total);if(total!=null&&total<2)return '';
   const c=s>=.75?3:s>=.5?2:1,word=['Low','Medium','High'][c-1]+' confidence',agree=o.agree;
   const tail=typeof o.text==='string'&&o.text?o.text:typeof agree==='string'&&agree?agree+' sources agree':num(agree)!=null&&total!=null?agree+' of '+total+' sources agree':'';
   const label=word+(tail?': '+tail:'');
   return '<span class="conf" data-c="'+c+'" role="img" aria-label="'+esc(label)+'" title="'+esc(label)+'"><i></i><i></i><i></i></span>'}
  // ---- freshness mark and page status (blueprint 2.3): one per page; a status only when stale (over 2x refresh) or parts are missing
  // short: the figure the L bar keeps when it shows the mark compact (the count, or the age); the full words stay the accessible name.
  // none: the short word for a feed with no age at all ("No data"), shown beside the mark where the row has room (ui.css), so a lone
  // triangle never has to carry "Not reporting" by itself (L18 page issues)
  function freshState(o){o=isObj(o)?o:{};const a=num(o.age),r=num(o.refresh),miss=Math.max(0,Math.round(num(o.missing)||0));
   if(a==null)return {k:'warn',text:'Not reporting',short:'',none:'No data'};
   if(r!=null&&r>0&&a>2*r)return {k:'warn',text:'Out of date '+DOT+' '+age(a),short:age(a)};
   if(miss)return {k:'warn',text:miss+(miss===1?' part':' parts')+' not reporting',short:String(miss)};
   return {k:'',text:age(a)}}
  // a warning mark wraps its words in .fw and carries its figure in data-short (or data-none): on L the bar copy (#tfresh) hides the words
  // and shows the mark and the figure ("3", "15 days", "No data" where it fits), so the tab strip keeps its room; every other class shows
  // the words (ui.css)
  function fresh(o){const st=freshState(o);
   if(!st.k)return '<button type="button" class="fresh" data-sheet="data" aria-label="Updated '+esc(st.text)+' ago. Open the Data sheet">'+esc(st.text)+'</button>';
   return '<button type="button" class="fresh warn" data-sheet="data"'+(st.short?' data-short="'+esc(st.short)+'"':'')+(st.none?' data-none="'+esc(st.none)+'"':'')+' aria-label="'+esc(st.text)+'. Open the Data sheet"><span class="sd warn"></span><span class="fw">'+esc(st.text)+'</span></button>'}
  function staleBar(o){o=isObj(o)?o:{};const bad=o.k==='bad',st=bad?{text:'Not reporting'}:freshState(o),key=/^[a-z0-9/-]{1,40}$/.test(o.retry||'')?o.retry:'';
   return '<div class="stale-bar'+(bad?' bad':'')+'" role="status"><span class="sd '+(bad?'bad':'warn')+'"></span>'+esc(st.text||'Out of date')+(key?'<button type="button" class="btn btn-sm" data-retry="'+esc(key)+'">Try again</button>':'')+'</div>'}
  // ---- marks, pills, rating pips, cap-rate mark
  const MARKS=['ok','warn','bad','wait','off','nv'];
  const mark=k=>'<span class="sd '+(MARKS.includes(k)?k:'off')+'"></span>';
  const pill=(k,word)=>{const m=MARKS.includes(k)?k:'off';return '<span class="pill'+(['ok','warn','bad','wait'].includes(m)?' '+m:'')+'">'+mark(m)+esc(word)+'</span>'};
  function pips(q,word){const n=Math.max(0,Math.min(5,Math.round(num(q)||0)));return '<span class="pips" data-q="'+n+'"><span aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>'+esc(word)+'</span>'}
  const capMark=kind=>kind==='est'||kind==='estimated'?'<span class="capm est" role="img" aria-label="Estimated cap rate"></span>':'<span class="capm" role="img" aria-label="Listed cap rate"></span>';
  // ---- tiles and strip. A missing value never gets a tile. The confidence meter follows the value and its unit inside .v (design authority via Main, supersedes the label-row move).
  const TILE_CLS=['sm','lead','dx'];
  // model:true marks a model-only value (forecast, no buoy nearby): the hollow square comes from .model in ui.css. The words are visually
  // hidden text, not role="img" with aria-label, which would make a screen reader drop the value itself.
  const MODEL_WORDS='Model forecast, no buoy nearby';
  // chg (a number, or {v, kind:'pct'|'pt'|'bp', d}) and span (PlanDesign M1): one change line under the figure, the only line that rises
  // (.t.chg), with its shape mark and the span word after it ("+1.2% today"); the figure keeps its size. With a change, the spark sits on
  // that line, right of the change, so a strip does not grow.
  function tile(o){o=isObj(o)?o:{};const v=txt(o.value);if(!v)return '';
   const cls=String(o.cls||'').split(/\s+/).filter(c=>TILE_CLS.includes(c)),k=openKind(o.open),tag=k?'button':'div';
   const c=isObj(o.chg)?o.chg:num(o.chg)!=null?{v:o.chg}:null,d=c?DeckCore.delta(c.v,c):null,sp=txt(o.span);
   const chl=d&&d.html?'<span class="t chg">'+d.html+(sp?'<span class="sp">'+esc(sp)+'</span>':'')+(o.spark||'')+'</span>':'';
   return '<'+tag+(k?' type="button"':'')+' class="tile'+(cls.length?' '+cls.join(' '):'')+'"'+(k?' data-open="'+k+'"':'')+keyAttr(o.key)+'><span class="h">'+esc(o.label)+'</span>'+
    '<b class="v">'+(o.model?'<span class="model" title="'+MODEL_WORDS+'">'+esc(v)+'<span class="vh">, '+MODEL_WORDS.toLowerCase()+'</span></span>':esc(v))+
    (o.unit?'<span class="u">'+esc(o.unit)+'</span>':'')+(o.conf||'')+'</b>'+chl+(o.sub?'<span class="t">'+esc(o.sub)+'</span>':'')+(chl?'':o.spark||'')+'</'+tag+'>'}
  function strip(tiles,o){const h=(Array.isArray(tiles)?tiles.filter(Boolean).join(''):txt(tiles));if(!h)return '';o=isObj(o)?o:{};
   const n=(h.match(/class="tile[\s"]/g)||[]).length,dx=(h.match(/class="tile[^"]*\bdx\b/g)||[]).length;
   return '<div class="strip" data-n="'+n+'" data-nb="'+(n-dx)+'"'+(o.label?' role="group" aria-label="'+esc(o.label)+'"':'')+'>'+h+'</div>'}
  // ---- states: one empty-state component (idle, stale, bad, setup, building), skeletons, the one quiet "Not reported" line
  function skeleton(kind,n){const c=Math.max(1,Math.min(12,Math.round(num(n)||(kind==='row'?3:4))));
   if(kind==='row')return '<div class="flist" role="group" aria-busy="true" aria-label="Loading">'+'<div class="frow" aria-hidden="true"><span class="fl"><span class="skel t"></span><span class="skel t"></span></span></div>'.repeat(c)+'</div>';
   return '<div class="strip" data-n="'+c+'" data-nb="'+c+'" role="group" aria-busy="true" aria-label="Loading">'+'<div class="tile" aria-hidden="true"><span class="skel t"></span><span class="skel l"></span></div>'.repeat(c)+'</div>'}
  function missing(names){const l=arr(names).map(x=>txt(x).trim()).filter(Boolean);return l.length?'<p class="missing">Not reported: '+esc(l.join(', '))+'.</p>':''}
  // ---- table with priority columns and phone cards (blueprint 2.5). Every cell carries data-l (the phone card label); P2-P4 cells carry data-pri.
  const cmp=(a,b)=>{const x=num(a),y=num(b);if(x!=null&&y!=null)return x-y;return String(a).localeCompare(String(b),'en',{numeric:true,sensitivity:'base'})};
  function sortRows(rows,key,dir){const desc=dir!=='ascending',get=typeof key==='function'?key:r=>isObj(r)?r[key]:null,blank=v=>v==null||v===''||(typeof v==='number'&&!isFinite(v));
   return arr(rows).slice().sort((a,b)=>{const x=get(a),y=get(b);if(blank(x)||blank(y))return blank(x)-blank(y);return desc?cmp(y,x):cmp(x,y)})}
  function table(spec){spec=isObj(spec)?spec:{};const cols=arr(spec.cols).filter(c=>isObj(c)&&c.key!=null);if(!cols.length)return '';
   const sorted=isObj(spec.sorted)?spec.sorted:null,dir=sorted&&sorted.dir==='ascending'?'ascending':'descending';
   let rows=arr(spec.rows);if(sorted&&!spec.presorted)rows=sortRows(rows,sorted.key,dir);
   const max=Math.max(1,Math.round(num(spec.max)||50)),shown=rows.slice(0,max),k=openKind(spec.open);
   const pri=c=>{const p=Math.round(num(c.pri)||1);return p>=2&&p<=4?' data-pri="'+p+'"':''};
   const head=cols.map((c,i)=>{const lab=esc(c.label==null?c.key:c.label),on=sorted&&sorted.key===c.key,cls=c.num?' class="n"':'';
    const inner=c.sort?'<button type="button" class="sort" data-sort="'+esc(c.key)+'">'+lab+'</button>':lab;
    return '<th scope="col"'+cls+pri(c)+(on?' aria-sort="'+dir+'"':'')+'>'+inner+'</th>'}).join('');
   const plain=(row,c)=>{const raw=isObj(row)?row[c.key]:null,v=typeof c.fmt==='function'?c.fmt(raw,row):raw;
    if(v==null||v==='')return NA;
    if(c.place){const sub=typeof c.sub==='function'?txt(c.sub(row)):'';return '<span class="place"><b>'+esc(v)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</span>'}
    return esc(v)};
   const body=shown.map(row=>{const key=typeof spec.key==='function'?spec.key(row):null;
    const cells=cols.map((c,i)=>{let h=typeof spec.cell==='function'?spec.cell(row,c):undefined;if(h===undefined)h=plain(row,c);else if(h==null||h==='')h=NA;
     const lab=' data-l="'+esc(c.label==null?c.key:c.label)+'"';
     return i===0&&c.place?'<th scope="row"'+lab+'>'+h+'</th>':'<td'+(c.num?' class="n"':'')+pri(c)+lab+'>'+h+'</td>'}).join('');
    return '<tr'+(k?' tabindex="0" data-open="'+k+'"':'')+keyAttr(key)+'>'+cells+'</tr>'}).join('');
   const rest=rows.length-shown.length,more=rest>0?'<div class="more-row"><button type="button" class="btn" data-more="'+esc(spec.id||k||'rows')+'">Show '+grp(Math.min(50,rest))+' more</button></div>':'';
   return '<div class="htw"><table class="htbl"'+(spec.label?' aria-label="'+esc(spec.label)+'"':'')+'><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>'+more}
  // ---- charts: inline SVG plus HTML labels; no data: or blob: URLs, no library
  const runs=vals=>{const out=[];let cur=[];vals.forEach((v,i)=>{if(v==null){if(cur.length)out.push(cur);cur=[];return}cur.push([i,v])});if(cur.length)out.push(cur);return out};
  // options (PlanDesign M1, section 5): base (a number, or 'first') draws a hairline at the previous close or the first value; pct plots the
  // percent change from the first value; domain [lo, hi] is shared across a set; span ("today", "1 month") is the span of the change
  // beside it (data-span); label with fmt names the first and last values (SeeAccess A8)
  function spark(values,o){o=isObj(o)?o:{};const raw=arr(values).map(num),pts0=raw.filter(x=>x!=null);if(pts0.length<2)return '';
   const f0=pts0[0],rel=x=>x==null?null:100*(x-f0)/Math.abs(f0),pct=!!o.pct&&f0!==0,v=pct?raw.map(rel):raw,pts=v.filter(x=>x!=null);
   const b0=o.base==='first'?f0:num(o.base),base=b0==null?null:pct?rel(b0):b0;
   const dm=Array.isArray(o.domain)&&num(o.domain[0])!=null&&num(o.domain[1])!=null&&o.domain[1]>o.domain[0]?o.domain:null;
   const W=num(o.w)||120,H=num(o.h)||24,P=2,lo=dm?dm[0]:Math.min(...pts,...(base==null?[]:[base])),hi=dm?dm[1]:Math.max(...pts,...(base==null?[]:[base])),span=hi-lo,n=v.length;
   const X=i=>(W*i/Math.max(1,n-1)).toFixed(1),Y=x=>(span?Math.max(P,Math.min(H-P,H-P-(H-2*P)*(x-lo)/span)):H/2).toFixed(1);
   const lines=runs(v).map(r=>r.length>1?'<polyline class="ln" points="'+r.map(([i,x])=>X(i)+','+Y(x)).join(' ')+'"/>':'<circle class="dot" cx="'+X(r[0][0])+'" cy="'+Y(r[0][1])+'" r="1.4"/>').join('');
   let li=n-1;while(v[li]==null)li--;
   const bl=base==null?'':'<line class="base" x1="0" x2="'+W+'" y1="'+Y(base)+'" y2="'+Y(base)+'"/>',ds=txt(o.span)?' data-span="'+esc(o.span)+'"':'';
   const fv=typeof o.fmt==='function'?x=>txt(o.fmt(x)):null,aria=o.label&&fv?txt(o.label)+', '+fv(f0)+' to '+fv(pts0[pts0.length-1]):txt(o.label);
   return '<svg class="spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none"'+ds+' '+(aria?'role="img" aria-label="'+esc(aria)+'"':'aria-hidden="true"')+'>'+bl+lines+'<circle class="dot" cx="'+X(li)+'" cy="'+Y(v[li])+'" r="2.2"/></svg>'}
  // a nice axis: the smallest 1, 2, 2.5 or 5 step that holds every value in 2 to 4 steps; three ticks (bottom, middle, top), the top tick never under the line (CRITIQUE finding 25)
  const NICE=[1,2,2.5,5,10];
  const niceStep=x=>{if(!(x>0))return 1;const p=Math.pow(10,Math.floor(Math.log10(x))),f=x/p;return NICE.find(s=>s>=f-1e-9)*p};
  const nextNice=s=>{const p=Math.pow(10,Math.floor(Math.log10(s)+1e-9)),f=Math.round(s/p*1000)/1000;return (NICE.find(x=>x>f+1e-9)||10)*p};
  const tidy=x=>+x.toPrecision(12);
  function axis(lo,hi){if(lo===hi){const d=Math.abs(lo)*.1||1;lo-=d;hi+=d}let step=niceStep((hi-lo)/4),a=0,k=0;
   for(let g=0;g<40;g++){a=Math.floor(lo/step+1e-9)*step;k=Math.max(2,Math.ceil(hi/step-1e-9)-Math.floor(lo/step+1e-9));if(k<=4)break;step=nextNice(step)}
   const b=a+k*step;return {lo:tidy(a),hi:tidy(b),ticks:[tidy(a),tidy((a+b)/2),tidy(b)]}}
  function line(o){o=isObj(o)?o:{};const s=arr(o.series).filter(Array.isArray),vals=s.map(p=>num(p[1])),ref=arr(o.ref).filter(Array.isArray).map(p=>num(p[1]));
   const all=vals.concat(ref).filter(x=>x!=null);if(vals.filter(x=>x!=null).length<2)return '';
   const ax=axis(Math.min(...all),Math.max(...all)),n=s.length,X=i=>(100*i/Math.max(1,n-1)).toFixed(2),Y=v=>(100*(1-(v-ax.lo)/(ax.hi-ax.lo))).toFixed(2);
   const yf=typeof o.yfmt==='function'?o.yfmt:money,lab=v=>{const t=yf(v);return t==null?'':String(t)};
   // an area fill only when the axis starts at zero or below: filled down to a $250K floor, a 40% rise reads as fourfold (SeeViz V15)
   const area=ax.lo>0?'':runs(vals).filter(r=>r.length>1).map(r=>'<polygon class="ar" points="'+X(r[0][0])+',100 '+r.map(([i,v])=>X(i)+','+Y(v)).join(' ')+' '+X(r[r.length-1][0])+',100"/>').join('');
   const lns=runs(vals).filter(r=>r.length>1).map(r=>'<polyline class="ln" points="'+r.map(([i,v])=>X(i)+','+Y(v)).join(' ')+'"/>').join('');
   const refl=runs(ref).filter(r=>r.length>1).map(r=>'<polyline class="ref" points="'+r.map(([i,v])=>X(i)+','+Y(v)).join(' ')+'"/>').join('');
   const grid=ax.ticks.map(t=>'<line class="grid" x1="0" x2="100" y1="'+Y(t)+'" y2="'+Y(t)+'"/>').join('');
   const ni=num(o.now),nowm=ni!=null&&ni>=0&&ni<n?'<line class="now" x1="'+X(ni)+'" x2="'+X(ni)+'" y1="0" y2="100"/>':'';
   const yt=ax.ticks.map(t=>'<span class="yt" style="--y:'+Y(t)+'%">'+esc(lab(t))+'</span>').join('');
   const xl=Array.isArray(o.xlab)?o.xlab:[s[0][0],s[n-1][0]];
   const first=vals.find(x=>x!=null),last=vals.slice().reverse().find(x=>x!=null);
   // the spoken name carries the first and the last values with their dates, after the label (SeeAccess A8)
   const ends=txt(xl[0])+' '+lab(first)+', '+txt(xl[1])+' '+lab(last),aria=txt(o.label)?txt(o.label)+': '+ends:ends;
   const ar=/^\d+(\.\d+)?\/\d+(\.\d+)?$/.test(String(o.ar||''))?String(o.ar):'2.6/1';
   // .lc: the tick labels sit in a gutter left of the plot, never under the line (SeeViz V15)
   return '<div class="chart lc" style="--ar:'+ar+'" role="img" aria-label="'+esc(aria)+'"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'+area+grid+refl+lns+nowm+'</svg>'+yt+
    '<span class="xt l">'+esc(xl[0])+'</span><span class="xt r">'+esc(xl[1])+'</span></div>'}
  function bars(items,o){o=isObj(o)?o:{};let l=arr(items).filter(isObj);if(!l.length)return '';
   if(o.sort!==false)l=sortRows(l,'value','descending');
   const vs=l.map(x=>num(x.value)).filter(x=>x!=null),max=num(o.max)||Math.max(0,...vs);
   return '<div class="hbars">'+l.map(x=>{const v=num(x.value),t=v==null?null:(x.text!=null?txt(x.text):count(v));
    return '<div class="hbar'+(x.on?' on':'')+'"'+keyAttr(x.key)+'><span>'+esc(x.label)+'</span><div>'+(v==null?'':'<i style="--v:'+pc(max>0?100*Math.max(0,v)/max:0)+'"></i>')+'<b>'+(v==null?NA:esc(t))+'</b></div></div>'}).join('')+'</div>'}
  function range(o){o=isObj(o)?o:{};const lo=num(o.min),hi=num(o.max);if(lo==null||hi==null||!(hi>lo))return '';
   const f=typeof o.fmt==='function'?o.fmt:money,P=v=>pc(100*(v-lo)/(hi-lo)),q1=num(o.p25),q3=num(o.p75),md=num(o.med),cu=num(o.cur),lab=v=>txt(f(v));
   const vars=['--lo:0%','--hi:100%'].concat(q1!=null&&q3!=null?['--q1:'+P(q1),'--q3:'+P(q3)]:[],md!=null?['--md:'+P(md)]:[],cu!=null?['--cu:'+P(cu)]:[]).join(';');
   const aria=[md!=null?'Median '+lab(md):'',q1!=null&&q3!=null?'middle half '+lab(q1)+' to '+lab(q3):'',cu!=null?'now '+lab(cu):''].filter(Boolean).join(', ');
   return '<div class="range" style="'+vars+'" role="img" aria-label="'+esc(aria||lab(lo)+' to '+lab(hi))+'">'+(q1!=null&&q3!=null?'<span class="band"></span>':'')+(md!=null?'<span class="med"></span>':'')+(cu!=null?'<span class="cur"></span>':'')+'</div>'+
    '<div class="range-l"><span>'+esc(lab(lo))+'</span>'+(md!=null?'<span>'+esc(lab(md))+'</span>':'')+'<span>'+esc(lab(hi))+'</span></div>'}
  // ---- a bullet (PlanDesign M2, section 5): a bar from 0 to the value and one tick for what it is compared with (ref). max: the scale's
  // end (default 1.25 times the larger of value and ref). Both are named: "Gross yield 6.1%, 30-yr rate 7.0%"
  function bullet(o){o=isObj(o)?o:{};const v=num(o.v),ref=num(o.ref);if(v==null)return '';
   const f=typeof o.fmt==='function'?x=>txt(o.fmt(x)):x=>txt(count(x)),hi=num(o.max)>0?num(o.max):(Math.max(v,ref==null?0:ref)*1.25||1),P=x=>pc(100*Math.max(0,x)/hi);
   const lab=txt(o.label),rl=txt(o.refLabel),vt=f(v),rt=ref==null?'':(rl?rl+' ':'')+f(ref);
   return '<div class="range bullet" style="--v:'+P(v)+(ref==null?'':';--md:'+P(ref))+'" role="img" aria-label="'+esc((lab?lab+' ':'')+vt+(rt?', '+rt:''))+'"><span class="fill"></span>'+(ref==null?'':'<span class="med"></span>')+'</div>'+
    '<div class="range-l"><span>'+esc(vt)+'</span>'+(rt?'<span>'+esc(rt)+'</span>':'')+'</div>'}
  // ---- grouped rows (PlanDesign M4, section 5): rows that share a key and an urgency become one entry: the count, the most urgent mark of
  // its members and each member kept whole, so every name stays its own link or button. A Now row never groups with a Soon row.
  // o.key(row) gives the shared key ('' or null keeps the row alone); o.sev(row) its urgency (default row.sev). Order: first appearance.
  const MARK_RANK=['bad','wait','warn','nv','off','ok'];
  function group(rows,o){o=isObj(o)?o:{};const kf=typeof o.key==='function'?o.key:()=>'',sf=typeof o.sev==='function'?o.sev:r=>isObj(r)?r.sev:'',out=[],at=new Map();
   arr(rows).filter(isObj).forEach(r=>{const k=txt(kf(r));if(!k){out.push({row:r});return}const id=k+'\u0000'+txt(sf(r));
    if(!at.has(id)){const g={key:k,sev:sf(r),members:[]};at.set(id,g);out.push(g)}at.get(id).members.push(r)});
   return out.map(g=>!g.members?g:g.members.length===1?{row:g.members[0]}:Object.assign(g,{count:g.members.length,
    mark:g.members.map(m=>txt(m.mark)).sort((a,b)=>(MARK_RANK.indexOf(a)+99)%99-(MARK_RANK.indexOf(b)+99)%99)[0]||''}))}
  // one grouped row: the mark, the title the page words ("3 App Reviews to answer"), and the members' names as a row of 44 px chips, each
  // its own link (safeUrl, new tab) or its own button (data-open, data-key)
  function groupRow(g,o){if(!isObj(g)||!arr(g.members).length)return '';o=isObj(o)?o:{};const title=txt(o.title)||g.count+' '+g.key,mk=MARKS.includes(g.mark)?g.mark:'';
   const name=m=>{const n=txt(typeof o.name==='function'?o.name(m):m.name||m.text),u=safeUrl(m.url),k=openKind(m.open);
    return u?'<a class="gname" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(n)+'</a>':k?'<button type="button" class="gname" data-open="'+k+'"'+keyAttr(m.key)+'>'+esc(n)+'</button>':'<span class="gname">'+esc(n)+'</span>'};
   return '<div class="frow grp"'+keyAttr(g.key)+'><span class="lead-mark sd'+(mk?' '+mk:'')+'" aria-hidden="true"></span><span class="fl"><b>'+esc(title)+'</b><span class="chips grp-names">'+g.members.map(name).join('')+'</span></span></div>'}
  function scatter(points,o){o=isObj(o)?o:{};const pts=arr(points).filter(p=>isObj(p)&&num(p.x)!=null&&num(p.y)!=null);if(!pts.length)return '';
   const xa=isObj(o.x)?o.x:{},ya=isObj(o.y)?o.y:{},ln=num(o.line);
   const ext=(a,k,extra)=>{const v=pts.map(p=>p[k]).concat(extra);let lo=num(a.min),hi=num(a.max);if(lo==null)lo=Math.min(...v);if(hi==null)hi=Math.max(...v);if(lo===hi){lo-=1;hi+=1}return [lo,hi]};
   const [x0,x1]=ext(xa,'x',[]),yy=ext(ya,'y',ln!=null?[ln]:[]),y0=yy[0],y1=yy[1],X=v=>100*(v-x0)/(x1-x0),Y=v=>100*(1-(v-y0)/(y1-y0));
   const xf=typeof xa.fmt==='function'?xa.fmt:count,yf=typeof ya.fmt==='function'?ya.fmt:count;
   const dots=pts.map(p=>'<span class="pt'+(p.est?' est':'')+(p.sel?' sel':'')+'" style="--x:'+pc(X(p.x))+';--y:'+pc(Y(p.y))+'"'+keyAttr(p.key)+(p.label?' title="'+esc(p.label)+'"':'')+'></span>').join('');
   const refl=ln!=null?'<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line class="ref" x1="0" x2="100" y1="'+Y(ln).toFixed(2)+'" y2="'+Y(ln).toFixed(2)+'"/></svg>':'';
   const aria=txt(o.label)||(txt(ya.label)&&txt(xa.label)?txt(ya.label)+' by '+txt(xa.label):'Scatter chart')+', '+pts.length+(pts.length===1?' point':' points');
   return '<div class="chart" role="img" aria-label="'+esc(aria)+'">'+refl+dots+'<span class="yt" style="--y:0%">'+esc(txt(yf(y1)))+'</span><span class="yt" style="--y:100%">'+esc(txt(yf(y0)))+'</span>'+
    '<span class="xt l">'+esc(txt(xf(x0)))+'</span><span class="xt r">'+esc(txt(xf(x1)))+'</span></div>'}
  // outlook columns: as many columns as days (CRITIQUE finding 19), height --h, shade data-q, confidence dots per day
  function obars(days,o){const l=arr(days).filter(isObj);if(!l.length)return '';o=isObj(o)?o:{};const hs=l.map(d=>num(d.h)).filter(x=>x!=null),max=num(o.max)||Math.max(0,...hs);
   return '<div class="obars" style="--days:'+l.length+'">'+l.map(d=>{const h=num(d.h),q=Math.max(0,Math.min(5,Math.round(num(d.q)||0))),c=isObj(d.conf)?conf(d.conf.score,d.conf):'';
    return '<div data-q="'+q+'"'+keyAttr(d.key)+'><b>'+(h==null?NA:esc(txt(d.text)||String(h)))+'</b>'+c+'<i style="--h:'+pc(h==null||!(max>0)?0:100*h/max)+'"></i><span>'+esc(d.label)+'</span></div>'}).join('')+'</div>'}
  // ---- the 51-tile state map (blueprint 2.7): [row, col] from 0; DOM order is reading order so remote focus walks rows
  const USPOS={AK:[0,0],ME:[0,11],WI:[1,5],VT:[1,10],NH:[1,11],WA:[2,0],ID:[2,1],MT:[2,2],ND:[2,3],MN:[2,4],IL:[2,5],MI:[2,6],NY:[2,9],MA:[2,10],
   OR:[3,0],NV:[3,1],WY:[3,2],SD:[3,3],IA:[3,4],IN:[3,5],OH:[3,6],PA:[3,7],NJ:[3,8],CT:[3,9],RI:[3,10],CA:[4,0],UT:[4,1],CO:[4,2],NE:[4,3],MO:[4,4],KY:[4,5],WV:[4,6],VA:[4,7],MD:[4,8],DE:[4,9],
   AZ:[5,1],NM:[5,2],KS:[5,3],AR:[5,4],TN:[5,5],NC:[5,6],SC:[5,7],DC:[5,8],OK:[6,3],LA:[6,4],MS:[6,5],AL:[6,6],GA:[6,7],HI:[7,0],TX:[7,3],FL:[7,8]};
  const USNAME={AK:'Alaska',AL:'Alabama',AR:'Arkansas',AZ:'Arizona',CA:'California',CO:'Colorado',CT:'Connecticut',DC:'District of Columbia',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',IA:'Iowa',ID:'Idaho',IL:'Illinois',IN:'Indiana',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',MA:'Massachusetts',MD:'Maryland',ME:'Maine',MI:'Michigan',MN:'Minnesota',MO:'Missouri',MS:'Mississippi',MT:'Montana',NC:'North Carolina',ND:'North Dakota',NE:'Nebraska',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NV:'Nevada',NY:'New York',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VA:'Virginia',VT:'Vermont',WA:'Washington',WI:'Wisconsin',WV:'West Virginia',WY:'Wyoming'};
  const US_ORDER=Object.keys(USPOS).sort((a,b)=>USPOS[a][0]-USPOS[b][0]||USPOS[a][1]-USPOS[b][1]);
  // five bins from four inner edges; without edges, quintiles of the values present
  function quintiles(values){const v=values.filter(x=>num(x)!=null).sort((a,b)=>a-b);if(!v.length)return [];return [1,2,3,4].map(k=>v[Math.min(v.length-1,Math.floor(v.length*k/5))])}
  const binOf=(v,edges,low)=>{if(num(v)==null||!edges.length)return 'x';const b=1+edges.filter(e=>v>=e).length;return String(low?6-b:b)};
  function usmap(states,o){o=isObj(o)?o:{};const by={};arr(states).filter(s=>isObj(s)&&USPOS[s.st]).forEach(s=>{by[s.st]=s});
   const edges=Array.isArray(o.bins)&&o.bins.length===4&&o.bins.every(x=>num(x)!=null)?o.bins:quintiles(Object.values(by).map(s=>s.value));
   const f=typeof o.fmt==='function'?o.fmt:v=>(Math.round(v*10)/10).toFixed(1),metric=txt(o.metric),low=o.better==='lower';
   // brighter is always better: better:'lower' (days to sell) puts the lowest values in the brightest bin
   const cells=US_ORDER.map(st=>{const s=by[st]||{},v=num(s.value),q=binOf(v,edges,low),name=txt(s.name)||USNAME[st],on=o.selected===st;
    const label=name+': '+(v==null?'no data':(metric?metric+' ':'')+(txt(s.text)||f(v)));
    return '<button type="button" class="st'+(on?' on':'')+'" data-st="'+st+'" data-q="'+q+'" data-key="'+st+'" aria-pressed="'+on+'" aria-label="'+esc(label)+'"><b>'+st+'</b>'+(v==null?'':'<small>'+esc(txt(s.short)||f(v))+'</small>')+'</button>'}).join('');
   // the legend names each bin as a range of the values in it ("44-49"; money reads "$350K to $420K"), the end bins open (SeeViz V17)
   const vals=Object.values(by).map(s=>num(s.value)).filter(x=>x!=null),join=(a,b)=>a===b?a:a+(/\$/.test(a+b)?' to ':'-')+b;
   const labs=edges.length?[1,2,3,4,5].map(b=>{const xs=vals.filter(x=>binOf(x,edges,false)===String(b));
    if(xs.length)return join(f(Math.min(...xs)),f(Math.max(...xs)));return b===1?'< '+f(edges[0]):b===5?f(edges[3])+'+':join(f(edges[b-2]),f(edges[b-1]))}):[],shown=low?labs.slice().reverse():labs;
   const lg=shown.map((t,i)=>'<span data-q="'+(i+1)+'"><i></i>'+esc(t)+'</span>').join('');
   return '<div class="usmap" role="group" aria-label="'+esc(metric?'States by '+metric:'States')+'">'+cells+'</div><div class="legend"><span>'+(low?'Higher':'Lower')+'</span>'+lg+'<span>'+(low?'Lower':'Higher')+'</span><span data-q="x"><i></i>No data</span></div>'}
  // ---- the coast strip: 14 regions, Cabo (south, left) to the Columbia River (north, right)
  const COAST=['baja-sur','baja-norte','san-diego','orange-county','los-angeles','ventura','santa-barbara','san-luis-obispo','monterey-santa-cruz','san-francisco-marin','sonoma-del-norte','oregon-south','oregon-central','oregon-north'];
  function coast(regions,o){o=isObj(o)?o:{};const l=arr(regions).filter(isObj).map((r,i)=>({r,i,k:COAST.indexOf(r.id)}));if(!l.length)return '';
   l.sort((a,b)=>(a.k<0||b.k<0)?a.i-b.i:a.k-b.k);let sel='';
   const items=l.map(({r})=>{const on=o.selected!=null&&(o.selected===r.id||o.selected===r.name),q=r.none?0:Math.max(0,Math.min(5,Math.round(num(r.q)||0))),h=r.none?'':txt(r.height);if(on)sel=txt(r.name);
    const label=txt(r.name)+': '+(r.none?'no reading':[txt(r.word),h].filter(Boolean).join(', ')+(r.model?', model only':''));
    return '<li><button type="button" class="cs'+(r.model&&!r.none?' model':'')+(r.none?' none':'')+(on?' on':'')+'" data-q="'+q+'"'+keyAttr(r.id)+' aria-pressed="'+on+'" aria-label="'+esc(label)+'"><i></i>'+(h?'<b>'+esc(h)+'</b>':'')+'<small>'+esc(r.name)+'</small></button></li>'}).join('');
   return '<div class="coast panel"><ol style="--n:'+l.length+'" aria-label="Coast, south to north">'+items+'</ol><div class="coast-ends"><span>Cabo</span>'+(sel?'<span class="sel">'+esc(sel)+'</span>':'')+'<span>Columbia River</span></div></div>'}
  // ---- Filters: one Filters button with the active count; the fields open as a sheet on P and L and sit inline on wider screens (CSS). No chip row in any class (CRITIQUE 6, 11, 16).
  // The word is its own span so the L bar can show only the mark and the count (ui.css #tact); the spoken name carries both
  function filters(o){o=isObj(o)?o:{};const id=/^[a-z0-9-]{1,30}$/.test(o.id||'')?o.id:'f',n=Math.max(0,Math.round(num(o.count)||0));
   return '<div class="fbar" data-fbar="'+id+'"><div class="fbar-top"><button type="button" class="btn fbar-open" data-open-fbar="'+id+'" aria-haspopup="dialog" aria-label="Filters'+(n?', '+n+' set':'')+'"><svg class="i" aria-hidden="true"><use href="#i-filter"/></svg><span class="fbw">Filters</span>'+(n?' <span class="cnt">'+n+'</span>':'')+'</button>'+(o.lead||'')+'</div>'+
    '<dialog class="sheet fbar-panel" id="fb-'+id+'" aria-label="Filters"><header class="sheet-h"><div><h2>Filters</h2></div><button type="button" class="sheet-x" aria-label="Close" data-close><svg class="i" aria-hidden="true"><use href="#i-x"/></svg></button></header>'+
    '<div class="sheet-b"><div class="fbar-fields">'+(o.fields||'')+'</div></div><footer class="sheet-a"><button type="button" class="btn" data-clear="*">Clear</button><button type="button" class="btn btn-primary" data-close>'+esc(txt(o.show)||'Show results')+'</button></footer></dialog></div>'}
  // ---- money: masked until the owner taps Show amounts; the 30 s hold lives in DeckShell.money. A masked amount never carries a digit.
  function amount(v,o){o=isObj(o)?o:{};if(!o.revealed)return '$\u2022\u2022\u2022';const m=money(v,{cents:!!o.cents});return m==null?'No data':m}
  const amountsBtn=rev=>rev?'<button type="button" class="btn btn-sm btn-quiet" data-money="hide">Hide amounts</button>':'<button type="button" class="btn btn-sm" data-money="show">Show amounts</button>';
  // ---- Data sheet (blueprint 2.1): Sources, Blends, Method, Setup, Display
  const SRC_STATE={ok:['ok','OK'],stale:['warn','Out of date'],needs_key:['off','Needs a key'],blocked:['bad','Blocked'],never:['nv','Never read'],unavailable:['bad','Not reporting'],not_reporting:['bad','Not reporting'],building:['wait','Building']};
  const srcPill=s=>{const p=SRC_STATE[s]||['off','Unknown'];return pill(p[0],p[1])};
  function asOf(v,now){if(v==null||v==='')return '';if(typeof v==='string'&&/^\d{4}-\d{2}$/.test(v.trim()))return month(v);const d=toDate(v);if(!d)return txt(v);
   const y=new Date(num(now)!=null?now:Date.now()).getFullYear();return date(d,{year:d.getFullYear()!==y})}
  function dataSheet(o,opt){o=isObj(o)?o:{};const now=isObj(opt)?opt.now:null,seen=new Set();
   const src=arr(o.sources).filter(s=>isObj(s)&&txt(s.name)).filter(s=>{const k=txt(s.name)+'|'+txt(s.gives);if(seen.has(k))return false;seen.add(k);return true});
   const sec=(h,body,cls)=>'<section class="sh-sec'+(cls?' '+cls:'')+'"><h3>'+h+'</h3>'+body+'</section>';
   const srcRows=src.length?'<div class="flist">'+src.map(s=>'<div class="frow"><span class="fl"><b>'+esc(s.name)+'</b>'+(s.gives?'<small>'+esc(s.gives)+'</small>':'')+'</span><span class="fr"><b>'+esc(asOf(s.asOf,now)||'No date')+'</b><small>'+srcPill(s.state)+'</small></span></div>').join('')+'</div>':'<p class="note">No sources listed.</p>';
   const bl=arr(o.blends).filter(b=>isObj(b)&&txt(b.label));
   const blRows=bl.length?bl.map(b=>'<div class="ds-blend"><header><b>'+esc(b.label)+'</b><span>'+esc(b.value)+conf(b.score,{agree:b.agree})+'</span></header>'+
    arr(b.parts).filter(isObj).map(p=>'<div class="ds-part"><span>'+esc(p.name)+'</span><b>'+(p.value==null||p.value===''?'No data':esc(p.value))+'</b><span>'+esc(p.weight)+'</span></div>').join('')+(b.note?'<p class="note sm">'+esc(b.note)+'</p>':'')+'</div>').join(''):'<p class="note">No blended numbers here.</p>';
   const me=arr(o.method).filter(r=>Array.isArray(r)&&r.length>=2);
   // Method values are sentences: .kv.prose sets each under its label at full width, in the body face (LayoutP 41)
   const meRows=me.length?'<dl class="kv prose">'+me.map(r=>'<div><dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd></div>').join('')+'</dl>':'<p class="note">Nothing to explain here.</p>';
   const su=arr(o.setup).filter(s=>isObj(s)&&(txt(s.name)||txt(s.line)));
   const suRows=su.length?'<div class="flist">'+su.map(s=>'<div class="frow"><span class="fl"><b>'+esc(s.name)+'</b>'+(s.line?'<small>'+esc(s.line)+'</small>':'')+'</span><span class="fr">'+srcPill(s.state)+'</span></div>').join('')+'</div>':'<p class="note">Nothing needs setup.</p>';
   const d=isObj(o.display)?o.display:{},ck=b=>b?' checked':'',metric=d.units==='metric';
   // a switch is its whole 44 px row: the words are its label, so a tap anywhere on the row toggles it (LayoutP 42)
   const disp='<label class="toggle-row"><span>TV view</span><input type="checkbox" data-display="tv"'+ck(d.tv)+'></label>'+
    '<label class="toggle-row"><span>Always-on display</span><input type="checkbox" data-display="always-on"'+ck(d.alwaysOn)+'></label>'+
    '<div class="toggle-row"><span>Units</span><div class="seg" role="group" aria-label="Units"><button type="button" data-display="units" data-v="us" aria-pressed="'+!metric+'"'+(metric?'':' class="on"')+'>US</button><button type="button" data-display="units" data-v="metric" aria-pressed="'+metric+'"'+(metric?' class="on"':'')+'>Metric</button></div></div>'+
    // a hardware keyboard class (the shell sets display.keys on D and XL): the shortcuts, also on ?
    (d.keys?'<div class="toggle-row"><span>Keyboard shortcuts</span><button type="button" class="btn btn-sm" data-keys>Show</button></div>':'');
   return sec('Sources',srcRows,'ds-src')+sec('Blends',blRows)+sec('Method',meRows)+sec('Setup',suRows)+sec('Display',disp)}
  // options for DeckShell.sheet.open: every detail sheet ends with a Data button scoped to its item ('zip:92629')
  function detail(o){o=isObj(o)?o:{};const sc=txt(o.scope);
   return {title:txt(o.title),sub:txt(o.sub),body:txt(o.body),wide:!!o.wide,actions:txt(o.actions)+'<button type="button" class="btn" data-sheet="data"'+(sc?' data-scope="'+esc(sc)+'"':'')+'>Data</button>'}}
  return {FMT,conf,fresh,freshState,staleBar,mark,pill,pips,capMark,tile,strip,skeleton,missing,sortRows,table,spark,line,axis,bars,range,bullet,group,groupRow,scatter,obars,USPOS,USNAME,usmap,quintiles,COAST,coast,filters,amount,amountsBtn,dataSheet,detail,NA}
 })();
 return {
  esc,
  redact,
  humanErr,
  problem,
  empty,
  down,
  diagHtml,
  schedule,
  dur,
  repoLabels,
  midCut,
  uniq,
  friendly,
  sentence,
  fmt,
  toEpoch,
  ago,
  until,
  usd,
  compass,
  safeUrl,
  state,
  line,
  cluster,
  clusterBoard,
  JOB_SHORT,
  JOB_STEP,
  JOB_CAP,
  jobNext,
  JOB_PEOPLE,
  jobPerson,
  jobPersonRow,
  jobRemoteFloor,
  JSORT,
  JDAYS,
  JPAY,
  jobLeftOut,
  launchItems,
  launchAreas,
  launchFacets,
  launchFilter,
  launchResult,
  devPage,
  devFresh,
  devData,
  devSheet,
  DEV_FIRST,
  DEV_WIDE,
  DEV_TITLE,
  conn,
  products,
  needRows,
  maintenanceRows,
  appItem,
  productGroups,
  ascWord,
  perf,
  jobSites,
  jobs,
  jobTax,
  jobCat,
  jobSub,
  jobFacets,
  jobFilter,
  jobPay,
  jobRow,
  jobRowModel,
  jobMarket,
  jobSheetOpts,
  jobStateOf,
  jobChipGroups,
  jobFilterSummary,
  jobActive,
  jobsData,
  jobProfileSetup,
  siteName,
  JMETRO,
  JMETRO_CHIP,
  JMETRO_ORDER,
  JMODE,
  homes,
  housingSources,
  homeRows,
  launchFavorites,
  againState,
  laneOf,
  board,
  fleetSignals,
  fleetFacts,
  fleetSummary,
  OPS,
  opsWord,
  opsMark,
  okState,
  unitState,
  opsCount,
  opsRest,
  fleetLine,
  pctOf,
  fleetServices,
  fleetNodes,
  fleetDisks,
  fleetDevices,
  benchFigs,
  tuneDeltas,
  clusterModels,
  modelInvShape,
  boardHasModels,
  boardModels,
  keptFeed,
  machineState,
  bMachines,
  bCluster,
  bModels,
  bBackup,
  bUnits,
  syncLine,
  syncSheet,
  unitLabel,
  unitName,
  runView,
  runClock,
  fleetNotice,
  RUN_GIVEUP,
  RUN_QUEUE_TIMEOUT_S,
  KIND_ORDER,
  KIND_LABEL,
  TIER_ORDER,
  TIER_LABEL,
  WHERE_LABEL,
  errNames,
  sheetPick,
  htmlLines,
  cardSheet,
  cronId,
  cronList,
  findCron,
  cronActions,
  cronDraft,
  cronSheet,
  cronModel,
  unitOk,
  unitDraft,
  unitSheet,
  unitView,
  sheetBody,
  sheetLink,
  tapAction,
  armedNow,
  sheetActions,
  actResult,
  ARM_MS,
  listFilter,
  listChips,
  jobKey,
  jobList,
  jobStar,
  jobTrack,
  jobSaved,
  jobCats,
  jobProvisional,
  sjIndex,
  sjItems,
  sjTrail,
  SJ_STATES,
  SJ_WORD,
  gigs,
  gigList,
  gigFilter,
  gigPay,
  gigRow,
  gigRowModel,
  gigsData,
  GIG_SHORT,
  GIG_STEP,
  GIG_CAP,
  GIG_KIND,
  threadAdd,
  threadSave,
  threadLoad,
  threadFor,
  threadHtml,
  sendLabel,
  sendText,
  sendState,
  tooLongText,
  canSend,
  sendBody,
  sendResult,
  enterSends,
  growHeight,
  isDeckShell,
  dropsTarget,
  cleanText,
  vvFit,
  THREAD_MAX,
  SEND_MAX,
  hPsf,
  hListMeta,
  mdHtml,
  homeTilde,
  scanSecrets,
  scrubArg,
  toolLabel,
  runItems,
  runTitle,
  routeNote,
  emptyFacts,
  inkTile,
  printer,
  carReading,
  dueTag,
  decisionRow,
  jobCue,
  clip,
  money,
  pct,
  genAt,
  asOfAt,
  finPage,
  finSheet,
  finStatus,
  finData,
  finCtl,
  finApp,
  finShape,
  fcdText,
  FIN_HIDE_MS,
  FIN_MASK,
  gmailUrl,
  vercelEmpty,
  dlItems,
  tfState,
  tfNeeds,
  spark:V3.spark,
  conf:V3.conf,
  fresh:V3.fresh,
  freshState:V3.freshState,
  staleBar:V3.staleBar,
  mark:V3.mark,
  pill:V3.pill,
  pips:V3.pips,
  capMark:V3.capMark,
  tile:V3.tile,
  strip:V3.strip,
  skeleton:V3.skeleton,
  missing:V3.missing,
  sortRows:V3.sortRows,
  table:V3.table,
  bars:V3.bars,
  range:V3.range,
  scatter:V3.scatter,
  obars:V3.obars,
  usmap:V3.usmap,
  coast:V3.coast,
  filters:V3.filters,
  amount:V3.amount,
  amountsBtn:V3.amountsBtn,
  dataSheet:V3.dataSheet,
  detail:V3.detail,
  axis:V3.axis,
  quintiles:V3.quintiles,
  USPOS:V3.USPOS,
  USNAME:V3.USNAME,
  COAST:V3.COAST,
  // PlanDesign section 5: one form, one control per role (the shared core and the v3 charts)
  bullet:V3.bullet,
  group:V3.group,
  groupRow:V3.groupRow,
  delta:DeckCore.delta,
  more:DeckCore.more,
  moreFocus:DeckCore.moreFocus,
  linkRow:DeckCore.linkRow,
  status:DeckCore.status,
  rollup:DeckCore.rollup,
  label:DeckCore.label,
  TD_SECTIONS,
  balanceColumns,
  balanceHeights,
  tdMiss,
  tdNeeds,
  tdNeedsHtml,
  tdGroup,
  tdAlertsHtml,
  tdChecksRow,
  tdDeadlines,
  tdCal,
  tdHome,
  tdCluster,
  tdServerPage,
  tdServerSheet,
  tdMarkets,
  tdTrafficTile,
  tdGlance,
  tdSlice,
  tdHomeOf,
  TD_SHAPE,
  TD_EVERY,
  tdDue,
  tdFresh,
  tdChecksSheet,
  tdJobsSheet,
  tdNeedsSheet,
  tdDeadSheet,
  tdHockeySheet,
  tdReplySheet,
  tdCalSheet,
  tdStatusLine,
  tdStatusSheet,
  tdDaySheet,
  tdTrafficSheet,
  TD_PATHS,
  tdData,
  tdFeed,
  tdShape,
 }
})();
// ==== DECK V6 UI HELPERS END ====
// ==== DECK PAGES REGISTRY BEGIN (pages register {show, refresh, hide} by route; tests/ui_registry.test.js runs this block in a sandbox) ====
// A route is 'tab' or 'tab/sub', optional query ('realestate/residential?zip=92629'). Lookup: the exact route, then the sub alone
// (old leaf names such as 'commercial' or 'markets'), or the tab when there is no sub or the sub is 'main'.
// A page with neither show nor refresh (a stub) never claims a route, so it cannot hide an old page that still lives there.
// hook(route, page) adds behaviour after a route's own page (invest.js, ops.js); hooks never get a late show.
// Guests reach only pages registered with guest:true.
const DeckPages=(()=>{
 const pages=new Map(),hooks=new Map(),ran=new WeakMap();
 let cur=null;// {route, key, r}: the route on screen and the key it resolved to
 const dec=s=>{try{return decodeURIComponent(s.replace(/\+/g,' '))}catch(e){return s}};
 function parse(route){const s=String(route==null?'':route).trim(),i=s.indexOf('?'),path=(i<0?s:s.slice(0,i)).replace(/^\/+|\/+$/g,''),query=i<0?'':s.slice(i+1);
  const j=path.indexOf('/'),tab=j<0?path:path.slice(0,j),sub=j<0?'':path.slice(j+1),params={};
  for(const kv of query.split('&')){if(!kv)continue;const e=kv.indexOf('='),k=dec(e<0?kv:kv.slice(0,e));if(k)params[k]=e<0?'':dec(kv.slice(e+1))}
  return {route:path,tab,sub,params}}
 const live=p=>!!p&&(typeof p.show==='function'||typeof p.refresh==='function');
 const keysOf=r=>!r.route?[]:[r.route].concat(r.sub&&r.sub!=='main'?[r.sub]:r.sub?[r.tab]:[]);
 function resolve(route){const r=typeof route==='string'?parse(route):route;return keysOf(r).find(k=>live(pages.get(k))||(hooks.get(k)||[]).length)||null}
 const isGuest=()=>typeof GUEST!=='undefined'&&!!GUEST;
 const list=route=>(Array.isArray(route)?route:[route]).map(x=>parse(x).route).filter(Boolean);
 function ctx(r){const doc=typeof document!=='undefined'?document:null,root=doc&&doc.documentElement,sub=r.sub||'main';
  const sec=doc&&doc.getElementById?doc.getElementById('pg-'+r.tab):null;
  return {route:r.route,tab:r.tab,sub,params:r.params,el:doc&&doc.getElementById?doc.getElementById('pg-'+r.tab+'-'+sub):null,head:sec&&sec.querySelector?sec.querySelector('.phead'):null,
   cls:cls(),tv:!!(root&&root.classList&&root.classList.contains('tv')),guest:isGuest(),now:Date.now()}}
 // what runs for a key: its own page, then its hooks; a guest gets only entries marked guest:true
 const entries=k=>{if(!k)return [];const p=pages.get(k),g=isGuest();return (p?[p]:[]).concat(hooks.get(k)||[]).filter(e=>!g||e.guest===true)};
 // ---- the guard (PlanEng item 1, mechanism B): a page or part that throws, or a read that fails, never leaves a blank or an all clear.
 // report(kind, err): one client error through the shell's deckReport (app.js: whitelisted fields, deduplicated, 10 a load).
 function report(kind,err){try{if(typeof deckReport==='function')deckReport(kind,err,{route:cur?cur.route:''})}catch(x){}}
 // "Out of date · last read 29 min": the deck's one stale wording (PRODUCT.md 2026-10-29); at is when the data was last read
 function lastRead(at){if(!(typeof at==='number'&&at>0)||typeof DeckUI==='undefined')return {text:'Out of date',short:''};
  const s=DeckUI.freshState({age:Math.max(60,(Date.now()-at)/1000),refresh:1}).short||'';return {text:'Out of date \u00B7 last read '+s,short:s}}
 const okKey=k=>/^[a-z0-9/-]{1,40}$/.test(k||'')?k:'page';
 function bar(at,key,attr){const t=lastRead(at);return '<div class="stale-bar"'+(attr||'')+' role="status"><span class="sd warn"></span>'+DeckUI.esc(t.text)+
  '<button type="button" class="btn btn-sm" data-retry="'+okKey(key)+'">Try again</button></div>'}
 const okAt=new WeakMap();// entry -> when its show or refresh last finished without a throw
 const drawn=x=>!/(^|\s)(skel|es|stale-bar)(\s|$)/.test(typeof x.className==='string'?x.className:'');
 // a thrown or rejected show/refresh: reported once; a blank container gets the failed state, a good render stays under a stale bar
 function failed(e,c,fn,err){report('render',err);if(fn==='hide'||!c||!c.el||typeof DeckUI==='undefined')return;const el=c.el;
  try{if(!Array.prototype.some.call(el.children||[],drawn)){el.innerHTML=DeckUI.empty({k:'bad',title:'Could not show this page',line:'Try again. If it keeps happening, reload the deck.',retry:'page'});return}
   const old=el.querySelector('.stale-bar[data-guard]');if(old)old.remove();el.insertAdjacentHTML('afterbegin',bar(okAt.get(e),'page',' data-guard'))}catch(x){}}
 const call=(e,fn,args)=>{if(typeof e[fn]!=='function')return false;const done=()=>{if(fn!=='hide')okAt.set(e,Date.now())};let out;
  try{out=e[fn].apply(e,args)}catch(err){failed(e,args[0],fn,err);return true}
  if(out&&typeof out.then==='function')out.then(done,err=>failed(e,args[0],fn,err));else done();return true};
 function run(e,c,tick){const now=c.now;
  if(tick){if(num(e.every)&&now-(ran.get(e)||0)<e.every)return;if(call(e,'refresh',[c,true]))ran.set(e,now);return}
  if(call(e,'show',[c])||call(e,'refresh',[c,false]))ran.set(e,now)}
 const num=x=>typeof x==='number'&&isFinite(x)&&x>0;
 // the shell calls this when a route comes on screen (tick false) and every 15 s while it stays (tick true)
 function dispatch(route,tick){const r=parse(route),key=resolve(r);
  if(cur&&cur.r.route!==r.route){const old=cur;cur=null;const c=ctx(old.r);entries(old.key).forEach(e=>call(e,'hide',[c]))}
  cur={route:r.route,key,r};
  if(!key)return key;const c=ctx(r);entries(key).forEach(e=>run(e,c,!!tick));return key}
 function register(route,page){const p=page&&typeof page==='object'?page:{};
  const ks=list(route);ks.forEach(k=>pages.set(k,p));
  // a page that loads after the route is already on screen paints at once (page modules load after deck.js)
  if(cur&&live(p)&&cur.key!==resolve(cur.r)&&ks.includes(resolve(cur.r))){cur.key=resolve(cur.r);if(!(isGuest()&&p.guest!==true)&&!(typeof document!=='undefined'&&document.hidden))run(p,ctx(cur.r),false)}
  return p}
 function hook(route,page){const p=page&&typeof page==='object'?page:{};list(route).forEach(k=>{if(!hooks.has(k))hooks.set(k,[]);hooks.get(k).push(p)});if(cur)cur.key=resolve(cur.r);return p}
 // GET /api/<path>: {ok, status, data, age, error}; never throws. Failures: a 403, an {error} body (a missing feed), a body that is not
 // a JSON object (every page reads objects), a body that says status:"not_reporting", a false opt.shape(data), a timeout, no answer. A failure keeps the body in data (pages read its reason).
 // Last good (Main's decision 2026-11-15): the last answer that passed is kept per path, in page memory only (never localStorage, never
 // the service worker). A failed read with one hands it back marked stale, {ok:true, stale:true, at, data, error}, so rows stay; the page's
 // one mark then says "Out of date · last read N min" with Try again. A first read that fails stays a failure; opt.fresh:true never takes
 // old data. Amounts and the budget (the answers a page holds 30 s by rule) are never kept; a 401 or 403, a role change or a
 // deck:role event drops everything. No answer at all fires deck:net {up:false}; the next answer {up:true} (app.js netState: Offline).
 function ageOf(d,now){const t=d&&typeof d==='object'?(d.t!=null?d.t:d.generated_at):null;let s=null;
  if(typeof t==='number'&&isFinite(t))s=t>1e12?t/1000:t;else if(typeof t==='string'&&t){const ms=Date.parse(t);if(!isNaN(ms))s=ms/1000;else if(/^\d+(\.\d+)?$/.test(t))s=+t}
  return s==null?null:Math.max(0,Math.round(now/1000-s))}
 // memory bound: each kept answer weighs its decoded JSON text length (or Content-Length, or GUESS); oldest go first above BUDGET, and an
 // answer heavier than BUDGET is never kept (housing/national?part=metros is about 7 MB: a page that holds it keeps it, the map does not)
 // never kept: the amount and budget routes, and any read whose query carries an amount (a budget or price cap: the key itself would
 // hold the figure, e.g. housing/rank?…&max_price=…)
 // NEVER names the same routes as the server's amount routes (the amount_gate callers and the housing profile in rust/src/main.rs, which
 // carry no ETag); tests/ui_guard.test.js reads both lists so they cannot drift.
 const BUDGET=4e6,GUESS=262144,NEVER=/^(commerce|finance|finance-values|portfolio-values|housing\/profile)(?:[/?#]|$)/,AMOUNT=/[?&](budget|max_price|min_price|price_max|price_min)=/i;
 const good=new Map(),stale=new Map(),marks=new Map();// path -> {data, at, w, tag}; route -> Map(path -> at); route -> {c, o}
 let netUp=true,role=null,held=0;
 function forget(){good.clear();stale.clear();held=0}
 function drop(p){const e=good.get(p);if(e){held-=e.w;good.delete(p)}}
 function keep(p,data,w,tag,at){drop(p);if(NEVER.test(p)||AMOUNT.test(p)||!(w<=BUDGET))return;
  while(held+w>BUDGET&&good.size)drop(good.keys().next().value);good.set(p,{data,at:typeof at==='number'&&at>0?at:Date.now(),w,tag:tag||''});held+=w}
 const roleNow=()=>{let r='';try{r=typeof localStorage!=='undefined'&&localStorage?String(localStorage.getItem('role')||''):''}catch(e){}return (isGuest()?'guest':'owner')+':'+r};
 if(typeof document!=='undefined'&&document.addEventListener)document.addEventListener('deck:role',forget);
 if(typeof addEventListener==='function')addEventListener('storage',e=>{if(!e||e.key==null||e.key==='role')forget()});
 function net(up){if(up&&netUp)return;netUp=up;
  try{if(typeof document!=='undefined'&&document.dispatchEvent&&typeof CustomEvent==='function')document.dispatchEvent(new CustomEvent('deck:net',{detail:{up}}))}catch(e){}}
 // tag: the ETag of the kept answer, sent as If-None-Match (the server answers 304 with no body when the feed has not changed)
 async function read(url,ms,shape,tag){if(typeof fetch!=='function')return {ok:false,status:0,data:null,age:null,error:'no answer'};
  const c=typeof AbortController==='function'?new AbortController():null;let timer=0,late=false,res=null,data=null,w=0,et='';
  try{
   try{const go=fetch(url,{credentials:'same-origin',cache:'no-store',signal:c?c.signal:undefined,headers:tag?{'If-None-Match':tag}:undefined}),
     cut=new Promise((_,no)=>{timer=setTimeout(()=>{late=true;if(c)c.abort();no(new Error('timeout'))},ms)});
    res=await Promise.race([go,cut])}
   catch(e){if(!late)net(false);return {ok:false,status:0,data:null,age:null,error:late?'timed out':'no answer'}}
   net(true);
   if(res.status===304)return {ok:false,status:304,data:null,age:null,error:'not modified'};
   et=res.headers&&typeof res.headers.get==='function'?String(res.headers.get('etag')||''):'';
   const cl=res.headers&&typeof res.headers.get==='function'?Number(res.headers.get('content-length'))||0:0;
   if(typeof res.text==='function'){try{const t=await res.text();w=Math.max(cl,t.length);data=JSON.parse(t)}catch(e){}}
   else{w=cl||GUESS;try{data=await res.json()}catch(e){}}}
  finally{clearTimeout(timer)}
  const o=data&&typeof data==='object'&&!Array.isArray(data)?data:null;
  let err=o&&typeof o.error==='string'&&o.error?o.error:!res.ok?'http '+res.status:!o?'wrong shape':o.status==='not_reporting'?'not reporting':'';
  if(!err&&typeof shape==='function'){let s=false;try{s=!!shape(data)}catch(e){}if(!s)err='wrong shape'}
  return {ok:!err,status:res.status,data,age:ageOf(data,Date.now()),error:err,w:w||GUESS,tag:et}}
 // Revalidation (PlanEng item 8): a kept answer's tag rides along as If-None-Match, never for a NEVER or amount read (never kept, so it
 // has no tag). A 304 means the kept answer is current: the same object comes back as {ok:true, same:true} (a page may skip its
 // repaint), its read time is now. A 304 with nothing kept (dropped meanwhile) is a fault: read once more without the header; a 304 to
 // that read too is "no answer". Every ok answer's data may be the one kept object, shared with the next stale or 304 answer: a page reads
 // it and never changes it in place.
 async function get(path,opt){const o=opt&&typeof opt==='object'?opt:{},ms=num(o.timeout)?o.timeout:15000,p=String(path==null?'':path).replace(/^\/+/,''),route=cur?cur.route:'';
  const had=good.get(p);let r=await read('/api/'+p,ms,o.shape,had?had.tag:''),who=roleNow();
  // On purpose, not a bug: one 401 or 403 on any path forgets every kept answer. A refused read is how a role change (sign-out, owner to
  // guest, a new token) first shows in this tab, so no answer read under the old role may survive it. Do not narrow it to that path.
  if(r.status===401||r.status===403||(role!==null&&role!==who))forget();role=who;
  if(r.status===304){const k=good.get(p);
   if(k){k.at=Date.now();good.delete(p);good.set(p,k);note(route,p,0);return {ok:true,same:true,status:304,data:k.data,age:ageOf(k.data,Date.now()),error:''}}
   r=await read('/api/'+p,ms,o.shape,'');if(r.status===304)r={ok:false,status:304,data:null,age:null,error:'no answer'}}
  return remember(p,r,o,route)}
 // A validated part of a successful route uses exactly the same pool and freshness notes as a full read. Stale parts never advance at.
 function remember(p,r,opt,route){const o=opt||{},w=r.w||GUESS,tag=r.tag,who=roleNow();delete r.w;delete r.tag;if(route===undefined)route=cur?cur.route:'';
  if(r.status===401||r.status===403||(role!==null&&role!==who))forget();role=who;
  if(o.replaces)note(route,o.replaces,0);
  if(r.ok&&!r.stale){keep(p,r.data,w,tag,r.at);note(route,p,0);return r}
  const last=o.fresh?null:good.get(p);if(!last){if(r.stale&&r.at)note(route,p,r.at);else note(route,p,0);return r}
  note(route,p,last.at);return {ok:true,stale:true,status:r.status,data:last.data,age:ageOf(last.data,Date.now()),at:last.at,error:r.error}}
 // which paths of a route came back from last good; the page's mark is drawn again when that changes
 function note(route,p,at){if(!route)return;let m=stale.get(route);const had=!!(m&&m.size);
  if(at){if(!m)stale.set(route,m=new Map());m.set(p,at)}else if(m)m.delete(p);
  if(at||(had&&!(m&&m.size))){const s=marks.get(route);if(s&&cur&&cur.route===route)paint(s.c,s.o)}}
 const current=()=>cur?{route:cur.route,key:cur.key}:null;
 const page=route=>pages.get(parse(route).route)||null;
 const routes=()=>[...pages.keys()].filter(k=>live(pages.get(k)));
 // device class (UiApi 1.2): the shell's value, else html[data-dc], else from the window size with the tokens.css rules
 const CLASSES=['P','L','T','D','XL','TV'];
 function classOf(w,h,tv){if(tv)return 'TV';if(!(w>0))return 'D';if(w<600)return 'P';if(h>0&&h<500)return 'L';if(w<1100)return 'T';return w>=1600?'XL':'D'}
 function cls(){const sh=typeof DeckShell!=='undefined'?DeckShell:null;try{const c=sh&&typeof sh.cls==='function'?sh.cls():null;if(CLASSES.includes(c))return c}catch(e){}
  const root=typeof document!=='undefined'&&document.documentElement,dc=root&&root.dataset&&root.dataset.dc;if(CLASSES.includes(dc))return dc;
  const w=typeof innerWidth==='number'?innerWidth:0,h=typeof innerHeight==='number'?innerHeight:0;return classOf(w,h,!!(root&&root.classList&&root.classList.contains('tv')))}
 function onClass(fn){if(typeof fn!=='function'||typeof document==='undefined'||!document.addEventListener)return ()=>{};
  const h=e=>{try{fn(e&&e.detail?e.detail:{cls:cls(),prev:null})}catch(err){if(typeof console!=='undefined')console.error('DeckPages onClass',err)}};
  document.addEventListener('deck:class',h);return ()=>document.removeEventListener('deck:class',h)}
 // the page's one freshness mark: first in ctx.head .pact, replacing the earlier one. Returns false when the page has no header yet.
 // When a read of this route came back from last good, the mark says so with the oldest read time and one Try again, unless the page
 // already says Not reporting (nothing answered). The last {c, o} per route is kept so a later stale or fresh read redraws it.
 function mark(c,o){if(c&&c.route)marks.set(c.route,{c,o});return paint(c,o)}
 function paint(c,o){const pact=c&&c.head&&c.head.querySelector?c.head.querySelector('.pact'):null;if(!pact||typeof DeckUI==='undefined')return false;
  const m=stale.get(c.route),at=m&&m.size?Math.min(...m.values()):0,st=at&&o&&o.age!=null?lastRead(at):null;
  const html=st?'<button type="button" class="fresh warn" data-kept data-sheet="data" data-short="'+DeckUI.esc(st.short)+'" aria-label="'+DeckUI.esc(st.text)+'. Open the Data sheet"><span class="sd warn"></span><span class="fw">'+DeckUI.esc(st.text)+'</span></button>'
   :DeckUI.fresh(o),old=pact.querySelector('.fresh'),rt=pact.querySelector('.fresh-retry');
  if(old)old.outerHTML=html;else pact.insertAdjacentHTML('afterbegin',html);
  if(rt&&!st)rt.remove();else if(st&&!rt){const f=pact.querySelector('.fresh');if(f)f.insertAdjacentHTML('afterend','<button type="button" class="btn btn-sm fresh-retry" data-retry="'+okKey(c.route)+'">Try again</button>')}
  return true}
 // part({key,title,res,draw,empty,retry}): one section with its own feed, as HTML (Lane BHelpers moves it to DeckCore). ok: draw(data);
 // a stale answer: draw(data) under the stale bar with Try again; failed with nothing kept: the failed state; a throwing draw: the failed
 // state and one report. empty({k}) may give the section's own markup for 'bad' (failed) and 'idle' (draw gave nothing).
 function part(o){o=o&&typeof o==='object'?o:{};const r=o.res&&typeof o.res==='object'?o.res:null,key=okKey(o.retry||o.key),title=String(o.title==null?'':o.title).slice(0,60)||'This part';
  const state=k=>{if(typeof o.empty==='function'){try{const h=o.empty({k});if(typeof h==='string'&&h)return h}catch(e){report('render',e)}}
   return k==='bad'?DeckUI.empty({k:'bad',title:title+': not reporting',line:'Try again in a moment.',retry:key}):DeckUI.empty({k:'idle',title:'Nothing here yet'})};
  if(!r||!r.ok)return state('bad');
  let h='';try{h=typeof o.draw==='function'?o.draw(r.data):''}catch(e){report('render',e);return DeckUI.empty({k:'bad',title:'Could not show '+title,line:'Try again. If it keeps happening, reload the deck.',retry:key})}
  return (r.stale?bar(r.at,key):'')+(typeof h==='string'&&h?h:state('idle'))}
 // after a repaint: the shell keeps remote focus on the same item (matched by data-key)
 function tv(){const sh=typeof DeckShell!=='undefined'?DeckShell:null;try{if(sh&&sh.tv&&typeof sh.tv.refresh==='function'){sh.tv.refresh();return true}}catch(e){}return false}
 // one page load that always settles: resolve, reject, or ONCE_MS (75 s, past the 60 s fetch bound) with onTimeout. A load that never
 // settles is what once() used to keep busy for the rest of the session: a blank page with no error until a reload.
 const ONCE_MS=75000;
 async function load(fn,opt){const o=opt&&typeof opt==='object'?opt:{},ms=typeof o.ms==='number'&&isFinite(o.ms)&&o.ms>0?o.ms:ONCE_MS;
  const work=Promise.resolve().then(()=>fn());work.catch(()=>{});
  let timer=0,out=null;
  const cut=new Promise(go=>{timer=setTimeout(()=>go({timeout:true}),ms)});
  try{out=await Promise.race([work.then(v=>({ok:true,value:v}),e=>({ok:false,error:e})),cut])}
  finally{clearTimeout(timer)}
  if(out.timeout){if(typeof o.onTimeout==='function'){try{o.onTimeout()}catch(e){if(typeof console!=='undefined')console.error('DeckPages load timeout',e)}}
   return {ok:false,timeout:true}}
  return out}
 return {register,hook,dispatch,resolve,parse,ctx,get,remember,ageOf,current,page,routes,cls,classOf,onClass,mark,tv,load,ONCE_MS,part,report,forget}
})();
if(typeof window!=='undefined')window.DeckPages=DeckPages;
// ==== DECK PAGES REGISTRY END ====
// ---- page glue (DOM + fetch) ----
const V6={busy:{},t:{},jobs:null,jobsBy:{},person:jobWho(),jobInsight:null,profile:null,job:jobState(jobWho()),jobsN:DeckUI.JOB_SHORT,results:[],
 saved:{},savedView:localStorage.getItem('job-saved-view')==='1',sheet:null,fsheet:null,trackErr:''};
// whose job search Work > Jobs shows, remembered in this browser: any id in DeckUI.JOB_PEOPLE (the person picker's feeds); anything else reads the owner's.
// Function declarations, not consts: V6 above calls them while it is built, and a const there is still in its dead zone.
function jobPersonOk(p){return DeckUI.JOB_PEOPLE.some(x=>x.id===p)}
function jobWho(){const p=localStorage.getItem('job-person');return jobPersonOk(p)?p:'tanner'}
function jobFilterKey(p){return p==='tanner'?'job-filter':'job-filter:'+p}
// Work > Jobs filter state per person: category, sub-category, metro, posted within, pay floor and order, remembered in this browser (the
// owner keeps the old key). The search words are not remembered: a word typed once never hides listings on a later visit.
// A site remembered from the old site chips is dropped: no site filter remains, so it can never hide listings unseen.
function jobState(person){const p=jobPersonOk(person)?person:'tanner',d={cat:'all',sub:'all',metro:'all',days:'all',pay:'all',sort:'fit'},ok=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(v)&&v!=='';
 try{const s=JSON.parse(localStorage.getItem(jobFilterKey(p))||'null');if(s&&typeof s==='object')for(const k of ['cat','sub','metro','days','pay','sort'])if(ok(s[k]))d[k]=s[k]}catch(e){}
 return d}
const feedGet=p=>jget('/api/'+p).catch(()=>null);
const renderFail=t=>DeckUI.empty({k:'bad',title:'Could not show '+t,line:'Try again. If it keeps happening, reload the deck.',retry:'page'});
// a light tick on tab and chip taps and on every action result; window.haptic (app.js) is a no-op outside the iOS shell
const buzz=s=>{try{if(typeof haptic==='function')haptic(s)}catch(e){}};
function fillCols(ids,html,title){ids.forEach((id,i)=>{const el=$('#'+id);if(el)el.innerHTML=html[i]||''});if(!html[0]&&title)$('#'+ids[0]).innerHTML=renderFail(title)}
// every fetch in this file goes through bfetch: one abort bound (FETCH_MS, 60 s, the same as jget in app.js and DeckPages.get), so no
// await can hang. A request that is still pending after that is aborted and rejects, which every caller already turns into an error state.
const FETCH_MS=60000;
function bfetch(url,init,ms){
 const opt=Object.assign({},init||{});
 if(typeof AbortController!=='function'||opt.signal)return fetch(url,opt);
 const ms2=typeof ms==='number'&&isFinite(ms)&&ms>0?ms:FETCH_MS;
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),ms2);
 opt.signal=ac.signal;
 return fetch(url,opt).finally(()=>clearTimeout(timer))}
// the honest state for a page whose load timed out or threw: a Not reporting bar with one Try again at the top of its container.
// The page keeps its header; nothing is left blank and nothing pretends to be fresh.
function onceFail(name){
 if(typeof document==='undefined'||!document.querySelector)return;
 const key=/^[a-z0-9/-]{1,40}$/.test(String(name||''))?String(name):'';
 if(!key)return;
 const host=document.querySelector('#pg-'+key)||document.querySelector('#pager>.page[data-name="'+key+'"]')||document.getElementById('pager');
 if(!host)return;
 const old=host.querySelector?host.querySelector('.stale-bar'):null;
 if(old&&old.parentElement===host)old.remove();
 const html=DeckUI.staleBar({k:'bad',retry:key});
 if(host.insertAdjacentHTML)host.insertAdjacentHTML('afterbegin',html)}
// once(): one load per page at a time. The busy flag is always cleared (resolve, reject, or DeckPages.load's ONCE_MS timeout), and a
// load that times out or throws paints the Not reporting bar, so a hung answer can never leave the page unpaintable for the session.
async function once(name,fn,opt){if(V6.busy[name])return false;V6.busy[name]=true;V6.t[name]=Date.now();
 const ms=opt&&typeof opt==='object'&&typeof opt.ms==='number'&&isFinite(opt.ms)&&opt.ms>0?opt.ms:undefined;
 try{const r=await DeckPages.load(fn,{ms,onTimeout:()=>onceFail(name)});
  if(!r.ok&&!r.timeout)onceFail(name);return !!r.ok}
 finally{V6.busy[name]=false}}
// Home's one freshness mark per page (design v3, lane PgHome): House, Fleet and Cluster hand {age, refresh, missing} here; DeckPages.mark
// draws it in the Home header. Only the sub on screen draws; off screen nothing happens and nothing throws.
// The route on screen may be the new one (home/cluster) or an old leaf the shell still dispatches (home, fleet, cluster): either
// way the mark goes into the Home tab's header. The last mark per sub is kept and drawn again when the shell shows that sub
// (deck:route), so a page whose load finished before the route settled still shows its mark (review F3a).
const HOME_MARK={},HOME_SUBS=['house','fleet','cluster'];
const homeSubOf=route=>{const r=DeckPages.parse(route);return r.tab==='home'?(r.sub||'house'):HOME_SUBS.includes(r.tab)?r.tab:''};
function homeDraw(sub){try{const o=HOME_MARK[sub];if(o)DeckPages.mark(DeckPages.ctx(DeckPages.parse('home/'+sub)),o)}catch(e){}}
function homeMark(sub,o){try{if(typeof DeckPages!=='object'||typeof DeckPages.mark!=='function')return;HOME_MARK[sub]=o;const c=DeckPages.current();
 if(c&&homeSubOf(c.route)===sub)homeDraw(sub)}catch(e){}}
if(typeof document!=='undefined'&&document.addEventListener)document.addEventListener('deck:route',e=>{const d=e&&e.detail||{};
 if(d.tab==='home'&&typeof DeckPages==='object')homeDraw(d.sub&&d.sub!=='main'?d.sub:'house')});
// Models by machine (L26) reads two sources: the fleet board's per-device model list and the model inventory (GET /api/models), for installed
// against resident and each model's GPU share. Both go through DeckPages.get, so a failed read after a good one keeps the last rows marked
// out of date, and a failed first read says so in that section (review #353 item 3, SeeLostSweep L26)
const v6Cluster=()=>once('cluster',async()=>{const [cr,pr,bd,mi]=await Promise.all([DeckPages.get('cluster'),DeckPages.get('perfloop'),DeckPages.get('fleet-board',{shape:DeckUI.boardHasModels}),DeckPages.get('models',{shape:DeckUI.modelInvShape})]),now=Date.now();
 // the engine and the tuning loop keep their last rows through a failed refresh too, marked out of date (Main 2026-11-15)
 const f=DeckUI.keptFeed(cr),pf=DeckUI.keptFeed(pr),inv=DeckUI.keptFeed(mi);
 const [bm,bold]=DeckUI.boardModels(bd);
 try{const h=DeckUI.cluster(f,now,bm,bold,inv);h[0]+=DeckUI.perf(pf,now);fillCols(['cl1','cl2','cl3'],h,'Cluster')}catch(e){$('#cl1').innerHTML=renderFail('Cluster')}
 // the TV board (#clboard, shown on TV only): inserted once before the columns, which sit one Down press below it
 try{let b=$('#clboard');const c=$('#cluster');if(!b&&c){c.insertAdjacentHTML('beforebegin','<div id="clboard" class="board"></div>');b=$('#clboard')}if(b)b.innerHTML=DeckUI.clusterBoard(f,pf,now);
  // on TV the three columns are the one-Down-press stops below the board (their rows are plain text, so nothing else takes focus);
  // off TV they stay out of the tab order
  const tv=document.documentElement.classList.contains('tv');[['cl1','Engine and tuning'],['cl2','Nodes'],['cl3','Candidates']].forEach(([id,l])=>{const el=$('#'+id);if(!el)return;
   if(tv){el.tabIndex=0;el.setAttribute('aria-label',l);el.dataset.key=id}else{el.removeAttribute('tabindex');el.removeAttribute('aria-label')}});
  if(typeof DeckPages.tv==='function')DeckPages.tv()}catch(e){}
 // the page's one freshness mark: the cluster feed's age; the perf loop counts as a part when it does not report
 if(typeof homeMark==='function')homeMark('cluster',{age:DeckPages.ageOf(f,now),refresh:f&&typeof f.refresh==='number'&&f.refresh>0?f.refresh:300,missing:[f,pf].filter(x=>!x||x.error).length+(bm.error?1:0)})});
// ---- Home > Dev: three feeds, one page (DeckUI.devPage). A phone shows five rows a section; Show more opens the rest and stays open across refreshes.
const DEV={d:null,tf:null,rw:null,ctx:null,open:new Set()};
function devPaint(){const c=DEV.ctx;if(!c||!c.el)return;try{c.el.innerHTML=DeckUI.devPage(DEV.d,Date.now(),DEV.tf,DEV.rw,DEV.open)}catch(e){c.el.innerHTML=renderFail('Dev')}
 DeckPages.mark(c,DeckUI.devFresh(DEV.d,Date.now(),DEV.tf,DEV.rw));if(typeof DeckShell!=='undefined'&&DeckShell.tv)DeckShell.tv.refresh()}
const devLoad=()=>once('dev',async()=>{[DEV.d,DEV.tf,DEV.rw]=await Promise.all([feedGet('dev'),feedGet('testflight'),feedGet('rankwatch')]);devPaint()});
DeckPages.register('home/dev',{every:60000,show(ctx){DEV.ctx=ctx;if(DEV.d)devPaint();devLoad()},refresh(ctx){DEV.ctx=ctx;devLoad()},hide(){DEV.ctx=null},
 data(){return DeckUI.devData(DEV.d,Date.now(),DEV.tf,DEV.rw)}});
// Show more opens a section in place (data-bal-open: DeckBalance keeps its column); Show fewer closes it and brings its title back into view
document.addEventListener('click',e=>{const b=e.target&&e.target.closest&&e.target.closest('[data-more5]');if(!b)return;const k=b.dataset.more5,s=b.closest('.c5'),less=!!b.dataset.less;
 if(less)DEV.open.delete(k);else DEV.open.add(k);if(!s)return;s.classList.toggle('open',!less);if(less){s.removeAttribute('data-bal-open');DeckBalance.fewer(s)}else s.setAttribute('data-bal-open','')});
// a dev row opens its detail sheet (DeckUI.devSheet) through the shell's sheet host; the sheet's Data button opens the page's Data sheet
document.addEventListener('click',e=>{const b=e.target&&e.target.closest&&e.target.closest('#hdev [data-dv]');if(!b||typeof DeckShell==='undefined'||!DeckShell.sheet)return;
 const s=DeckUI.devSheet(b.dataset.dv,b.dataset.key,DEV.d,DEV.tf,Date.now());if(!s)return;buzz('selection');
 DeckShell.sheet.open(Object.assign({id:'dev-'+b.dataset.dv,opener:b},DeckUI.detail(s)))});
// ---- v7: Keys connections, Home products, Today sections ----
const v7Keys=()=>once('keys',async()=>{const a=await feedGet('accounts');
 try{fillCols(['conn1','conn2'],DeckUI.conn(a,Date.now()),'Connections')}catch(e){$('#conn1').innerHTML=renderFail('Connections')}});
// Pad > Keys: the macro keys paint from app.js (loadKeys); this route keeps Connections current, at most once a minute on ticks
DeckPages.register('pad/keys',{show:()=>v7Keys(),refresh:()=>v7Keys(),every:60000});
// House's products and decisions read through DeckPages.get: a failed refresh keeps the last rows, the Products title saying "Out of date ·
// last read N min" (keptFeed), never a blank card (review #390)
const v7Home=()=>once('home',async()=>{const p=DeckUI.keptFeed(await DeckPages.get('products'));
 try{const r=DeckUI.products(p,Date.now());$('#prodg').innerHTML=r.grid;$('#needl').innerHTML=(r.needs||renderFail('Needs you'))+(r.maintenance||'');$('#prodt').textContent=r.src||'';$('#needt').textContent=r.count==='--'?'':r.count;prodMore()}
 catch(e){$('#prodg').innerHTML=renderFail('Products');prodMore()}});
// P and L show five product rows, then Show more (css/home.css); the button names how many it opens and stays open for the visit
function prodMore(){const g=$('#prodg');if(!g)return;let m=$('#prodmore');
 if(!m){g.insertAdjacentHTML('afterend','<div class="more-row" id="prodmore"><button type="button" class="btn" data-prodmore="1"></button></div>');m=$('#prodmore')}
 const n=g.querySelectorAll('.pgrp>.frow').length;m.hidden=n<=5;m.firstChild.textContent='Show '+Math.max(0,n-5)+' more'}
document.addEventListener('click',e=>{const b=e.target&&e.target.closest&&e.target.closest('[data-prodmore]');if(!b)return;const p=$('#prod');if(p)p.classList.add('open')});
// ---- Today (design v3, lane PgToday): one read path. Each section paints as its own feeds answer; when all have answered, the Alerts strip gains
// the one "Some checks did not report" row and the header its one freshness mark. The page fills #pg-today-main: one balanced flow; on D (laptop)
// Needs you and Alerts take the left 5/12 and the other lists balance in the right 7/12 (W13); on TV the board (Needs you, next event, cameras,
// home spot, markets) with Renewals, Alerts and Cluster one Down press below. Feeds stay in memory for the sheets and the Data sheet; the browser
// keeps only the home market's ZIP and place name (no amounts).
const TDS={feeds:{},got:{},miss:{},needs:null,dead:[],place:'',ctx:null};
const TD_BOARD=['needs','cal','home','mkt','glance'];
// health (the fleet check) feeds only the Status row and its sheet; it never joins the checks row. weather (GET /api/weather, the top bar's line)
// stands in for Home Assistant's weather when that has none.
// The Surf and Shop tiles read /api/today's slices; TD_FULL is read only when the server sends no slice (an older server) or the slice
// cannot draw the tile (DeckUI.tdSlice). Neither tile opens a sheet, so no sheet needs the full feed.
const TD_FEEDS={products:'products',testflight:'testflight',schedules:'schedules',today:'today',replyblock:'replyblock',deadlines:'deadlines',calendar:'calendar',
 cams:'cams',car:'car',ha:'ha',watch:'watch',cluster:'cluster',markets:'markets',summary:'housing/national?part=summary',
 hockey:'hockey',onthisday:'onthisday',traffic:'traffic',health:'health',weather:'weather'};
const TD_FULL={surf:'surf-coast',ecom:'ecom-market'};
const tdGet=p=>DeckPages.get(p,{shape:d=>DeckUI.tdShape(p,d)}).then(DeckUI.tdFeed,()=>({error:'no answer'}));
const tdServerGet=()=>DeckPages.get('serverpage',{shape:d=>DeckUI.tdShape('serverpage',d)}).then(DeckUI.keptFeed,()=>({error:'no answer'}));
// one feed of the page: read now, or (on the idle refresh, DeckUI.tdDue) the answer the page holds; TDS.got keeps each read's path, time and
// whether it answered fresh, so a failed or out-of-date read is tried again on the next refresh
function tdRead(k,p,tick,was){const t=Date.now();if(!DeckUI.tdDue(k,p,TDS.got[k],t,tick)&&k in was)return Promise.resolve(was[k]);
 return DeckPages.get(p,{shape:d=>DeckUI.tdShape(p,d)}).then(r=>{TDS.got[k]={path:p,at:t,ok:!!(r&&r.ok&&!r.stale&&!(r.data&&r.data.stale)),keptAt:r&&r.at};return DeckUI.tdFeed(r)},()=>{TDS.got[k]=null;return {error:'no answer'}})}
 // Remember the validated slice separately from /api/today, whose other parts may have changed. No extra HTTP request or second cache.
 function tdRemember(k,v,from){const g=TDS.got[from],stale=!!(g&&!g.ok),r=DeckPages.remember('today#'+k,
  {ok:!!v&&!v.error&&v.status!=='not_reporting',data:v,stale,at:g&&(g.keptAt||g.at),error:v&&(v.error||v.reason)||'not reporting'},{replaces:TD_FULL[k]});
  return DeckUI.tdFeed(r)}
// the Almanac's day sits behind the owner-only /almanac/ proxy (DeckPages.get reads /api/ only), with the same 15 s bound through bfetch. It is
// read when the On this day sheet opens, never on page load: a read wakes the sleeping Almanac.
const tdAlmGet=()=>bfetch(DeckUI.TD_PATHS.almanac+'api/today',{credentials:'same-origin',cache:'no-store'},15000)
 .then(r=>r.json().then(d=>DeckUI.tdFeed({ok:r.ok,data:d}),()=>({error:'http '+r.status})),()=>({error:'no answer'}));
// ==== balanced columns, shared (layout waves 2026-11-15). A box with data-balance (a .flow, or any box CSS draws in columns) keeps each
// child whole: when its CSS draws two or more columns, the children move into that many column boxes (.bal-col) picked by height
// (DeckUI.balanceColumns), each child whole and in order inside its column; a .span-all child spans the width under them and starts
// a new run. A list, group or card never continues in another column. It runs again when the box or a child changes size
// (ResizeObserver: repaint, rotation, font load, row count), when the box's children change and when a new box appears
// (MutationObserver). Off on the TV and at one column. If it is off or throws, the box is its plain CSS columns (ui.css).
// A page that rewrites a box's children in place calls DeckBalance.reset(box) first, so no child is left inside a column box.
// The plan is made from closed heights (DeckUI.balanceHeights, layout wave 3): a block that is, or holds, a list open beyond its default
// carries data-bal-open (the page that draws it sets it) and plans with the height it had closed, remembered per box and block key in
// MEM, so Show more, Show fewer and a repaint while open move no block to another column. After Show fewer the page calls
// DeckBalance.fewer(section): the title comes back into view when it is above the viewport.
const DeckBalance=(()=>{
 if(typeof document==='undefined')return {soon(){},reset(){},run(){},fewer(){}};
 const IDX=new WeakMap(),MEM=new Map(),pend=new Set(),isCol=e=>e.classList.contains('bal-col');let raf=0;
 // a box keeps its memory across a repaint that rebuilds it: by its id, its data-balance value, else the nearest id above it
 const keyOf=c=>{if(c.id)return c.id;const v=c.getAttribute('data-balance');if(v)return v;const p=c.parentElement&&c.parentElement.closest('[id]');
  return p?p.id+' '+[...p.querySelectorAll('[data-balance]')].indexOf(c):''};
 const memOf=c=>{const k=keyOf(c);if(!k)return {};if(!MEM.has(k))MEM.set(k,{});return MEM.get(k)};
 const isOpen=e=>e.hasAttribute('data-bal-open')||!!e.querySelector('[data-bal-open]');
 const boxOf=e=>e&&e.nodeType===1?e.closest('[data-balance]'):null;
 const RO=typeof ResizeObserver==='function'?new ResizeObserver(es=>es.forEach(e=>{const c=boxOf(e.target);if(c)soon(c)})):null;
 // the children in their own order: numbered by their place whenever the box holds no column box
 const items=c=>{const out=[];[...c.children].forEach(e=>{if(isCol(e))out.push(...e.children);else out.push(e)});
  return out.sort((a,b)=>(IDX.has(a)?IDX.get(a):1e9)-(IDX.has(b)?IDX.get(b):1e9))};
 function reset(c){if(!c)return;c.classList.remove('bal');c.style.removeProperty('--bal-n');const cols=[...c.children].filter(isCol);if(!cols.length)return;
  items(c).forEach(e=>c.appendChild(e));cols.forEach(x=>x.remove())}
 // the column count CSS draws: column-count, capped by how many column-width columns fit
 function count(c){const cs=getComputedStyle(c),cw=parseFloat(cs.columnWidth),cc=parseInt(cs.columnCount,10),gap=parseFloat(cs.columnGap)||0;
  return cw>0?Math.min(cc>0?cc:99,Math.max(1,Math.floor((c.clientWidth+gap)/(cw+gap)))):cc>0?cc:1}
 function run(c){if(!c||!c.isConnected)return;
  if(![...c.children].some(isCol))[...c.children].forEach((e,i)=>IDX.set(e,i));
  c.classList.remove('bal');
  const n=document.documentElement.classList.contains('tv')?1:count(c),l=items(c);
  if(RO){RO.observe(c);l.forEach(e=>RO.observe(e))}
  // one column (TV, a narrow box, a page off screen) plans nothing and leaves the remembered heights alone
  const hs=n<2?l.map(()=>0):DeckUI.balanceHeights(memOf(c),innerWidth+' '+(document.documentElement.dataset.dc||'')+' '+n,
   l.map((e,i)=>({k:e.dataset.k||e.dataset.g||e.id||'#'+i,h:e.offsetHeight,open:isOpen(e)}))),H=new Map(l.map((e,i)=>[e,hs[i]]));
  // runs of children between full-width ones; a child that draws nothing rides with the drawn one before it
  const runs=[];let cur=[];l.forEach(e=>{if(e.classList.contains('span-all')){runs.push({l:cur,tail:e});cur=[]}else cur.push(e)});runs.push({l:cur,tail:null});
  const plans=runs.map(r=>{const h=r.l.map(e=>H.get(e)),vis=h.filter(x=>x>0),p=DeckUI.balanceColumns(vis,n),k=p.length?Math.max(...p)+1:1;
   const cols=Array.from({length:k},()=>[]);let j=0,at=0;r.l.forEach((e,i)=>{if(h[i]>0)at=p[j++]||0;cols[at].push(e)});return {k,cols,l:r.l,tail:r.tail}});
  if(plans.every(p=>p.k<2)){reset(c);return}
  const old=[...c.children].filter(isCol),want=[];let wi=0,most=1;
  plans.forEach(p=>{if(p.k<2)want.push(...p.l);else{most=Math.max(most,p.k);p.cols.forEach((list,i)=>{let w=old[wi++];if(!w){w=document.createElement('div');w.className='bal-col'}
   w.classList.toggle('bal-first',i===0);if(list.length!==w.children.length||list.some((e,x)=>w.children[x]!==e))list.forEach(e=>w.appendChild(e));want.push(w)})}
   if(p.tail)want.push(p.tail)});
  if(want.length!==c.children.length||want.some((e,i)=>c.children[i]!==e))want.forEach(e=>c.appendChild(e));
  old.slice(wi).forEach(w=>w.remove());
  c.style.setProperty('--bal-n',String(most));c.classList.add('bal')}
 function soon(c){pend.add(c);if(!raf)raf=requestAnimationFrame(()=>{raf=0;const l=[...pend];pend.clear();l.forEach(c=>{try{run(c)}catch(e){try{reset(c)}catch(x){}}})})}
 // after Show fewer: plan the box now (nothing moves: the plan is the closed one), then bring the section's title into view when it
 // sits above the viewport or under the sticky header (html scroll-padding-top), so a long list that closes never leaves the reader in
 // empty space below the page's end. A title already in view stays where it is.
 function fewer(sec){if(!sec||!sec.isConnected)return;const c=boxOf(sec);if(c){try{run(c)}catch(e){try{reset(c)}catch(x){}}}
  const t=sec.querySelector('.secttl')||sec,pad=parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)||0;
  if(t.getBoundingClientRect().top<pad)t.scrollIntoView({block:'start'})}
 const found=nd=>{if(nd.nodeType!==1)return;if(nd.matches('[data-balance]'))soon(nd);nd.querySelectorAll('[data-balance]').forEach(soon)};
 if(typeof MutationObserver==='function')new MutationObserver(rs=>rs.forEach(r=>{const c=boxOf(r.target);if(c)soon(c);r.addedNodes.forEach(found)}))
  .observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
 document.addEventListener('deck:class',()=>document.querySelectorAll('[data-balance]').forEach(soon));
 return {soon,reset,run,fewer}})();
// ---- the one Show more control keeps the reader's place (SeeAccess A1, PlanEng item 19). DeckUI.more() draws
// .more-row[data-more-row=<key>] with [data-more=<key>] buttons and the page repaints on the tap. After Show more, focus goes to the first
// row whose data-key is new (DeckUI.moreFocus); after Show fewer, to the list's Show more, and DeckBalance.fewer brings the title back.
// Focus moves without a scroll, and only when it was lost or still sits on the tapped button; it never leaves where the reader went.
if(typeof document!=='undefined')document.addEventListener('click',e=>{const b=e.target&&e.target.closest&&e.target.closest('.more-row[data-more-row]>[data-more]');if(!b)return;
 const k=b.dataset.more,less=!!b.dataset.less,secOf=x=>x&&(x.closest('section,.sect,.panel,[data-balance]')||x.parentElement&&x.parentElement.parentElement),
  keysIn=s=>s?[...s.querySelectorAll('[data-key]')].filter(x=>x.offsetParent!==null).map(x=>x.dataset.key):[],root=b.closest('[id]'),rootId=root&&root.id,before=keysIn(root||secOf(b));let tries=0;
 // Column balancing reparents sections on the next frame, which would discard focus assigned before it.
 const schedule=()=>{if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>requestAnimationFrame(settle));else settle()};
 const settle=()=>{const a=document.activeElement;if(a&&a!==document.body&&a!==b&&a.isConnected)return;
  const row=[...document.querySelectorAll('.more-row[data-more-row]')].find(r=>r.dataset.moreRow===k&&r.offsetParent!==null),sec=row?secOf(row):rootId?document.getElementById(rootId):secOf(b);
  if(less){const m=row&&row.querySelector('[data-more]:not([data-less])');if(sec&&sec.isConnected)DeckBalance.fewer(sec);if(m){m.focus({preventScroll:true});return}}
  else{const nk=sec?DeckCore.moreFocus(before,keysIn(sec)):null,el=nk==null?null:sec.querySelector('[data-key="'+CSS.escape(nk)+'"]');
   if(el){const f=el.matches('a[href],button,input,select,textarea,summary,[tabindex]')?el:el.querySelector('a[href],button:not([disabled]),summary,[tabindex]');
    if(!f)el.setAttribute('tabindex','-1');(f||el).focus({preventScroll:true});return}}
  if(++tries<4)setTimeout(schedule,tries*150)};
 setTimeout(schedule,0)},true);
// Today's flow opts in to DeckBalance (data-balance): Needs you, Renewals, Alerts, the calendar, home and cluster balance as whole sections;
// Markets and At a glance span the width under them. W13: on D the laptop's three columns left Needs you a 365 px column whose rows wrapped to
// three and four lines, so there Needs you and Alerts take the left 5/12 (the owner's steps, then what an agent can fix) and the other lists
// balance in two columns in the right 7/12 (css/today.css); the two sides hold about the same height. The TV board is not a balanced box.
function tdArrange(root){const S=DeckUI.TD_SECTIONS;
 if(!root.querySelector('#td-needs'))root.innerHTML=S.map(k=>'<section class="sect'+(k==='mkt'||k==='glance'?' span-all':'')+'" id="td-'+k+'" hidden></section>').join('');
 const tv=document.documentElement.classList.contains('tv'),want=tv?'tv':document.documentElement.dataset.dc==='D'?'split':'flow';if(root.dataset.layout===want)return;root.dataset.layout=want;
 const el={},box=c=>{const d=document.createElement('div');d.className=c;return d},flow=box('flow td');flow.setAttribute('data-balance','');S.forEach(k=>{el[k]=root.querySelector('#td-'+k)});
 root.textContent='';
 // TV board (tv.css .board): a .board-fill holding Needs you on the left and next event, cameras and the home spot stacked on the right,
 // then the markets row across the foot. tv.js cuts list rows that would cross the fill's bottom, so nothing paints over the section under it.
 if(tv){const b=box('board td-board'),f=box('board-fill td-top'),l=box('td-col'),r=box('td-col');l.appendChild(el.needs);['cal','home','glance'].forEach(k=>r.appendChild(el[k]));
  f.append(l,r);b.append(f,el.mkt);root.appendChild(b)}
 if(want==='split'){const g=box('td-split'),l=box('td-col');l.append(el.needs,el.alerts);g.append(l,flow);
  S.filter(k=>!['needs','alerts','mkt','glance'].includes(k)).forEach(k=>flow.appendChild(el[k]));root.append(g,el.glance,el.mkt);return}
 S.filter(k=>!tv||!TD_BOARD.includes(k)).forEach(k=>flow.appendChild(el[k]));root.appendChild(flow)}
document.addEventListener('deck:class',()=>{const r=$('#pg-today-main');if(r&&r.querySelector('#td-needs'))tdArrange(r)});
const tdList=x=>Array.isArray(x)?x:[];
const tdAllMiss=()=>DeckUI.TD_SECTIONS.flatMap(k=>tdList(TDS.miss[k]));
function tdPaint(k,fn){const el=$('#td-'+k);if(!el)return;let r;
 try{r=fn()}catch(e){r={html:'',miss:[{key:k,name:'Part of Today',line:'This part could not be shown. Reload the deck to try again.',diag:[String(e&&e.message||e).slice(0,120)]}]}}
 TDS.miss[k]=tdList(r&&r.miss);el.innerHTML=r&&r.html||'';el.hidden=!(r&&r.html);el.classList.toggle('tv-hide',!!r&&r.tv===false);if(TDS.ctx)DeckPages.tv(TDS.ctx)}
// the home market (the owner's area with tier "home"): /api/today's home_area. An older server sends none: then from the realestate feed, kept a
// day in this browser so Today skips that big read. The ZIP and the place name come from the server and this device's storage, never the script
function tdHomeArea(){try{const s=JSON.parse(localStorage.getItem('today-home-area')||'null');if(s&&/^\d{5}$/.test(s.zip)&&Date.now()-s.at<864e5)return Promise.resolve(s)}catch(e){}
 return tdGet('realestate').then(re=>{const m=re&&re.market&&re.market.residential,a=Array.isArray(m&&m.areas)?m.areas:[],h=a.find(x=>x&&x.tier==='home')||a[0];
  if(!h||!/^\d{5}$/.test(String(h.zip||'')))return null;const s={zip:String(h.zip),name:String(h.name||'').slice(0,40),at:Date.now()};
  try{localStorage.setItem('today-home-area',JSON.stringify(s))}catch(e){}return s})}
// tick: the idle refresh, which reads a feed of DeckUI.TD_EVERY only when its period has passed; opening the page or Try again reads every feed
const v7Today=tick=>once('today',async()=>{const root=$('#pg-today-main');if(!root)return;tdArrange(root);
 const was=TDS.feeds,F=TDS.feeds={},P={},now=()=>Date.now();
 Object.keys(TD_FEEDS).forEach(k=>{P[k]=tdRead(k,TD_FEEDS[k],tick,was).then(v=>(F[k]=v))});
 P.serverpage=tdServerGet().then(f=>(F.serverpage=f));
 // the Surf and Shop tiles: the slice in /api/today, else the full feed
 Object.keys(TD_FULL).forEach(k=>{P[k]=P.today.then(t=>{const s=DeckUI.tdSlice(t,k);if(s)return tdRemember(k,s,'today');
  return tdRead(k,TD_FULL[k],tick,was).then(v=>tdRemember(k,v,k))}).then(v=>(F[k]=v))});
 P.zip=P.today.then(async t=>{const s=DeckUI.tdHomeOf(t),a=s||await tdHomeArea().catch(()=>null),
   // home_area has no status field: its producer distinguishes a read failure from no selection through this reason prefix.
   absent=!!(t&&t.home_area&&t.home_area.zip===null&&typeof t.home_area.reason==='string'&&t.home_area.reason.trim()&&
    !t.home_area.reason.startsWith('the Real estate feed is not reporting')),
   r=DeckPages.remember('today#home_area',{ok:absent||!!a&&!a.error,data:a||{error:'no home market in the realestate feed'},
    stale:!!(s&&TDS.got.today&&!TDS.got.today.ok),at:s?TDS.got.today&&(TDS.got.today.keptAt||TDS.got.today.at):a&&a.at,error:a&&a.error||'no home market in the realestate feed'},{replaces:s?'realestate':null});
   return DeckUI.tdFeed(r)})
  .then(a=>{const ok=!!a&&!a.error;TDS.place=ok?a.name:'';return ok?tdRead('zip','housing/zip/'+a.zip,tick,was):{error:a&&a.error||'no home market in the realestate feed'}}).then(v=>(F.zip=v));
 // the Mac mini's events and bills are read only when the agenda did not answer
 P.cal=P.calendar.then(c=>c&&!c.error&&Array.isArray(c.days)?null:tdGet('accounts').then(a=>(F.accounts=a)));
 const bills=()=>{const c=F.calendar,a=F.accounts;return c&&!c.error&&Array.isArray(c.bills_due)?c.bills_due:a&&a.apple&&Array.isArray(a.apple.bills_due)?a.apple.bills_due:null};
 const briefs=()=>{const t=F.today;return t&&!t.error&&t.cron&&Array.isArray(t.cron.briefings)?t.cron.briefings:null};
 const alerts=()=>tdPaint('alerts',()=>DeckUI.tdAlertsHtml(TDS.needs,F.today,F.health,tdAllMiss()));
 await Promise.all([
  Promise.all([P.products,P.testflight,P.schedules,P.today,P.replyblock]).then(()=>tdPaint('needs',()=>{const n=TDS.needs=DeckUI.tdNeeds(F);return {html:DeckUI.tdNeedsHtml(n),miss:n.miss}})),
  Promise.all([P.deadlines,P.cal]).then(()=>tdPaint('dead',()=>{const r=DeckUI.tdDeadlines(F.deadlines,bills(),now());TDS.dead=r.items;return r})),
  // the calendar waits for the agenda and Hermes (the next briefing); a bill Renewals lists is not repeated as an event
  Promise.all([P.cal,P.today]).then(()=>tdPaint('cal',()=>DeckUI.tdCal(F.calendar,F.accounts,now(),{bills:(bills()||[]).map(b=>b&&b.title),briefing:briefs()}))),
  Promise.all([P.cams,P.car,P.ha,P.watch,P.weather]).then(()=>tdPaint('home',()=>DeckUI.tdHome({cams:F.cams,car:F.car,ha:F.ha,watch:F.watch,wx:F.weather},now()))),
  Promise.all([P.cluster,P.serverpage]).then(()=>tdPaint('clu',()=>{const c=DeckUI.tdCluster(F.cluster,now()),s=DeckUI.tdServerPage(F.serverpage,now());return {html:c.html+s.html,miss:c.miss.concat(s.miss)}})),
  // the Alerts strip paints once the jobs, Hermes, mail and the fleet check have answered; the checks row joins it when everything has
  Promise.all([P.products,P.testflight,P.schedules,P.today,P.replyblock,P.health]).then(alerts),
  P.markets.then(m=>tdPaint('mkt',()=>DeckUI.tdMarkets(m))),
  Promise.all([P.surf,P.summary,P.zip,P.ecom,P.hockey,P.onthisday,P.traffic]).then(()=>tdPaint('glance',()=>DeckUI.tdGlance({surf:F.surf,summary:F.summary,zip:F.zip,place:TDS.place,ecom:F.ecom,hockey:F.hockey,onthisday:F.onthisday,traffic:F.traffic,now:now()})))
 ]);
 if(TDS.needs)alerts();
 if(TDS.ctx)DeckPages.mark(TDS.ctx,DeckUI.tdFresh(F,tdAllMiss(),now()))});
// a tile or row opens its tab; a counted row, a summary row or a tile opens its sheet, each with the Data button at its foot. A sheet whose
// feeds are read on open shows "Reading" until they answer.
const TD_SHEETS={'today-checks':['Some checks did not report',()=>DeckUI.tdChecksSheet(tdAllMiss())],'today-jobs':['Scheduled jobs',()=>DeckUI.tdJobsSheet(TDS.needs&&TDS.needs.jobs)],
 'today-needs':['Needs you',()=>DeckUI.tdNeedsSheet(TDS.needs)],'today-dead':['Renewals and deadlines',()=>DeckUI.tdDeadSheet(TDS.dead)],
 'today-hockey':['Hockey',()=>DeckUI.tdHockeySheet(TDS.feeds.hockey,Date.now())],
 'today-reply':['Reply drafts',()=>DeckUI.tdReplySheet(TDS.feeds.replyblock)],
 'today-server':['Server page',()=>DeckUI.tdServerSheet(TDS.feeds.serverpage,Date.now())],
 'today-cal':['Calendar',()=>DeckUI.tdCalSheet(TDS.feeds.calendar,TDS.feeds.accounts,Date.now())],
 'today-status':['Status',()=>DeckUI.tdStatusSheet(TDS.feeds.today,TDS.feeds.health,Date.now())],
 'today-traffic':['Website traffic',()=>DeckUI.tdTrafficSheet(TDS.feeds.traffic)],
 'today-day':['On this day',()=>Promise.all([tdAlmGet(),tdGet('photoyears')]).then(([a,py])=>{const F=TDS.feeds;F.almanac=a;F.photoyears=py;return DeckUI.tdDaySheet(a,F.onthisday,py)})]};
document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target.closest('#pg-today [data-go],#pg-today [data-open^="today-"],.td-sheet [data-open^="today-"]'):null;if(!t)return;
 buzz('selection');if(t.dataset.go)return DeckShell.go(t.dataset.go);
 const s=TD_SHEETS[t.dataset.open];if(!s)return;let b;try{b=s[1]()}catch(err){b='<p class="note">This could not be shown. Close the sheet and try again.</p>'}
 const wrap=h=>'<div class="td-sheet">'+h+'</div>',pend=!!b&&typeof b.then==='function';
 const dlg=DeckShell.sheet.open(Object.assign(DeckUI.detail({title:s[0],body:wrap(pend?'<p class="note">Reading\u2026</p>':b)}),{opener:t}));
 if(pend)b.then(h=>h,()=>'<p class="note">This could not be read. Close the sheet and try again.</p>').then(h=>{const x=dlg&&dlg.isConnected&&dlg.open?dlg.querySelector('.td-sheet'):null;if(x)x.innerHTML=h})});
// ---- Work > Jobs and Work > Gigs (design v3, PgWork 2026-11-14): registered under work/jobs and work/gigs, painted into the route's
// container (ctx.el). Each page owns one Filters dialog (#fb-jobs, #fb-gigs) opened by the shell's [data-open-fbar] wiring; on L the shell
// moves the Filters button into the bar. The job detail opens through DeckShell.sheet. WK holds each page's ctx while it is on screen. ----
const WK={jobs:null,gigs:null};
// one click listener per element and handler, even when the shell hands back the same container or dialog again
function workBind(el,fn,type){if(!el||!el.addEventListener)return;fn.bound=fn.bound||new WeakSet();if(fn.bound.has(el))return;fn.bound.add(el);el.addEventListener(type||'click',fn)}
// paint a Work page. With its Filters dialog open, only the parts are swapped so the dialog stays open; the Filters button the shell moved
// into the bar (L) is swapped for the new one, so its count is never stale.
// While the reader types in the sheet's search field, the new field takes the focus and the caret back.
function workPaint(el,html,id){const dlg=el.querySelector?el.querySelector('#fb-'+id):null;
 if(dlg&&dlg.open&&typeof document!=='undefined'){const t=document.createElement('template');t.innerHTML=html;const n=t.content;
  const a0=document.activeElement,typed=a0&&a0.name&&a0.tagName==='INPUT'&&dlg.contains(a0)?{name:a0.name,s:a0.selectionStart,e:a0.selectionEnd}:null;
  for(const k of ['ctl','body']){const a=el.querySelector('[data-wk="'+k+'"]'),b=n.querySelector('[data-wk="'+k+'"]');if(a&&b)a.replaceWith(b)}
  const nd=n.querySelector('#fb-'+id);if(nd)for(const s of ['.sheet-b','.sheet-a']){const a=dlg.querySelector(s),b=nd.querySelector(s);if(a&&b)a.replaceWith(b)}
  const f=typed&&dlg.querySelector('input[name="'+typed.name+'"]');if(f){f.focus();try{f.setSelectionRange(typed.s,typed.e)}catch(e){}}}
 else el.innerHTML=html;
 const bar=typeof document!=='undefined'&&document.querySelector?document.querySelector('#tact [data-open-fbar="'+id+'"]'):null,nb=el.querySelector?el.querySelector('[data-open-fbar="'+id+'"]'):null;
 if(bar&&nb&&bar!==nb)bar.replaceWith(nb)}
// leaving the page: its Filters button leaves the bar with it (the next page's button takes the slot)
function workUnbar(id){const b=typeof document!=='undefined'&&document.querySelector?document.querySelector('#tact [data-open-fbar="'+id+'"]'):null;if(b)b.remove()}
// the page's one freshness mark, from the feed's own time and refresh; a source that did not answer counts as a part not reporting
function workMark(c,f){if(!c)return;const ok=f&&typeof f==='object'&&!f.error;
 DeckPages.mark(c,ok?{age:DeckPages.ageOf(f,Date.now()),refresh:typeof f.refresh==='number'&&f.refresh>0?f.refresh:3600,missing:Array.isArray(f.errors)?f.errors.length:0}:{age:null})}
// ---- saved jobs (owner only): GET /api/saved-jobs?person= and POST one change. Never cached; a failure keeps the last list and says so ----
const sjGet=p=>bfetch('/api/saved-jobs?person='+encodeURIComponent(p),{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():{error:'http '+r.status}).catch(()=>({error:'deck server did not answer'}));
// only people with a tracker (DeckUI.JOB_PEOPLE saved:true) ask the store; a read-only list gets no stars and no Saved chip
const sjFor=p=>DeckUI.jobPerson(p).saved?sjGet(p):Promise.resolve(undefined);
async function savedLoad(p){if(!DeckUI.jobPerson(p).saved)return;V6.saved[p]=await sjGet(p);if(V6.person===p){paintJobs();jobSheetPaint()}}
async function savedPost(p,change){try{const r=await bfetch('/api/saved-jobs',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({person:p},change))});
  const j=await r.json().catch(()=>null);if(r.ok&&j&&j.ok){V6.saved[p]={person:p,items:j.items,cap:j.cap,states:j.states,t:j.t};return ''}return (j&&j.error)||('http '+r.status)}
 catch(e){return 'deck server did not answer'}}
// a link the store accepts (savedjobs.rs url_ok): http(s), no spaces, quotes or angle brackets, no user part; anything else is saved without a link
const sjUrl=u=>{const s=String(u||'');return s.length<=400&&/^https?:\/\/[^\s"'<>\\`@/?#]+([/?#][^\s"'<>\\`]*)?$/.test(s)?s:''};
// the open job sheet: {x: the posting (live, or rebuilt from the saved row), key, dlg}. The tracker in it reads the person's saved list.
// The cluster take is the owner's own; the other lists in the picker never show it.
const jobSheetNow=()=>{const s=V6.sheet,t=V6.person==='tanner';return DeckUI.jobSheetOpts(s.x,V6.jobs,{insight:t?V6.jobInsight:null,track:DeckUI.jobPerson(V6.person).saved,key:s.key,saved:DeckUI.sjIndex(V6.saved[V6.person]).get(s.key)||null,trackErr:V6.trackErr})};
function jobSheetPaint(){const s=V6.sheet,box=s&&s.dlg&&s.dlg.open?s.dlg.querySelector('.wkj'):null;if(!box)return;
 try{const tmp=document.createElement('div');tmp.innerHTML=jobSheetNow().body;box.replaceWith(tmp.firstChild)}catch(e){box.innerHTML=renderFail('Job detail')}}
function sheetShow(x,key){const sh=typeof DeckShell!=='undefined'&&DeckShell.sheet;if(!sh||!x)return;V6.sheet={x,key,dlg:null};V6.trackErr='';
 const d=sh.open(Object.assign({id:'job'},DeckUI.detail(Object.assign({scope:'job'},jobSheetNow()))));V6.sheet.dlg=d||null;workBind(d,jobSheetClick)}
async function jobSheetClick(e){const b=e.target.closest&&e.target.closest('.wkj [data-jstate]'),g=b&&b.closest('[data-jkey]');if(!b||!g||!V6.sheet||b.disabled)return;
 const x=V6.sheet.x,p=V6.person;b.disabled=true;buzz('light');
 V6.trackErr=await savedPost(p,{key:g.dataset.jkey,title:String(x.title||'').slice(0,140)||'job',company:String(x.company||'').slice(0,80),url:sjUrl(x.url),state:b.dataset.jstate});
 if(V6.trackErr)V6.trackErr='Not saved: '+V6.trackErr;buzz(V6.trackErr?'error':'success');jobSheetPaint();paintJobs()}
function jobOpen(key){const x=DeckUI.jobList(V6.jobs).find(y=>DeckUI.jobKey(y)===key);if(x)sheetShow(x,key)}
function savedOpen(key){const sv=DeckUI.sjIndex(V6.saved[V6.person]).get(key),live=DeckUI.jobList(V6.jobs).find(x=>DeckUI.jobKey(x)===key);
 if(live||sv)sheetShow(live||{title:sv.title,company:sv.company,url:sv.url},key)}
// a star on an unsaved row saves it at once; on a saved row it opens the sheet, where the state changes and Remove live
async function starTap(key){const p=V6.person,idx=DeckUI.sjIndex(V6.saved[p]);if(idx.has(key))return savedOpen(key);
 const x=DeckUI.jobList(V6.jobs).find(y=>DeckUI.jobKey(y)===key);if(!x)return;buzz('light');
 const err=await savedPost(p,{key,title:String(x.title||'').slice(0,140)||'job',company:String(x.company||'').slice(0,80),url:sjUrl(x.url),state:'saved'});
 buzz(err?'error':'success');if(err&&typeof flag==='function')flag({error:'Could not save the job: '+err});paintJobs()}
const jobOpt=()=>({insight:V6.person==='tanner'?V6.jobInsight:null,page:V6.jobsN,person:V6.person,saved:V6.saved[V6.person],savedView:V6.savedView});
function paintJobs(){const c=WK.jobs;if(!c||!c.el)return;
 let html;try{html=DeckUI.jobs(V6.jobs,V6.job,Date.now(),jobOpt())}catch(e){c.el.innerHTML=renderFail('Jobs');return}
 workPaint(c.el,html,'jobs');workMark(c,V6.jobs);DeckPages.tv(c)}
function jobFilterSet(change){Object.assign(V6.job,change);V6.jobsN=DeckUI.JOB_SHORT;try{const k=Object.assign({},V6.job);delete k.q;localStorage.setItem(jobFilterKey(V6.person),JSON.stringify(k))}catch(err){}buzz('light');paintJobs()}
const JOB_CLEAR={cat:'all',sub:'all',metro:'all',days:'all',pay:'all',q:'',sort:'fit'};
// the Filters search narrows the list as the reader types (no tick per key); `/` on D lands here (app.js searchField)
function jobsInput(e){const t=e.target;if(!t||!t.matches||!t.matches('input[data-jq]'))return;V6.job.q=String(t.value||'').slice(0,60);V6.jobsN=DeckUI.JOB_SHORT;paintJobs()}
// switching person shows the list already read at once and reads the feed only when this browser has none for that person yet
async function jobsLoad(p){const f=await feedGet(DeckUI.jobPerson(p).feed);V6.jobsBy[p]=f;if(V6.person===p){V6.jobs=f;paintJobs()}}
function jobPersonSet(p){if(!jobPersonOk(p)||p===V6.person)return;V6.person=p;try{localStorage.setItem('job-person',p)}catch(e){}
 V6.job=jobState(p);V6.jobsN=DeckUI.JOB_SHORT;V6.jobs=V6.jobsBy[p]||null;paintJobs();if(!V6.jobsBy[p])jobsLoad(p);if(V6.saved[p]===undefined)savedLoad(p)}
// one listener on the page container: the list, the control row and the Filters dialog (it lives inside the container)
function jobsClick(e){const t=e.target;if(!t.closest)return;
 const m=t.closest('[data-more="jobs"]');if(m){V6.jobsN=DeckUI.jobNext(V6.jobsN,!!m.dataset.less);paintJobs();return}
 const p=t.closest('[data-person]');if(p){jobPersonSet(p.dataset.person);return}
 const st=t.closest('[data-star]');if(st){starTap(st.dataset.star);return}
 const sj=t.closest('[data-sj]');if(sj){savedOpen(sj.dataset.sj);return}
 if(t.closest('[data-saved]')){V6.savedView=!V6.savedView;try{localStorage.setItem('job-saved-view',V6.savedView?'1':'0')}catch(err){}
  if(V6.saved[V6.person]===undefined)savedLoad(V6.person);paintJobs();return}
 if(t.closest('[data-jclear]')){jobFilterSet(Object.assign({},JOB_CLEAR));return}
 const b=t.closest('[data-jcat],[data-jsub],[data-jmetro],[data-jdays],[data-jpay],[data-jsort]');
 if(b){const d=b.dataset;if(d.jcat!=null)jobFilterSet({cat:d.jcat,sub:'all'});else if(d.jsub!=null)jobFilterSet({sub:d.jsub});else if(d.jmetro!=null)jobFilterSet({metro:d.jmetro});
  else if(d.jdays!=null)jobFilterSet({days:d.jdays});else if(d.jpay!=null)jobFilterSet({pay:d.jpay});else jobFilterSet({sort:d.jsort==='new'?'new':'fit'});return}
 const r=t.closest('.jrow[data-jk]');if(r)jobOpen(r.dataset.jk)}
// each load reads the owner's feed, the shown person's feed, the cluster read and the profile; another person's list loads only when picked
// every feed read is bounded (jget and bfetch abort at 60 s and the row paints Not reporting); the whole load is bounded by once(), which paints
// the Not reporting bar into #pg-work-jobs if it still has not settled
const jobsLoadAll=()=>once('work-jobs',async()=>{const pf=V6.person==='tanner'?null:DeckUI.jobPerson(V6.person).feed;
 const [[j,ji,ip],pj,sv]=await Promise.all([Promise.all(['jobs','jobs-insight','interest-profile'].map(feedGet)),pf?feedGet(pf):Promise.resolve(null),sjFor(V6.person)]);
 V6.saved[V6.person]=sv;V6.jobsBy={tanner:j};if(pf)V6.jobsBy[V6.person]=pj;V6.jobs=V6.jobsBy[V6.person];V6.jobInsight=ji&&!ji.error?ji:null;V6.profile=ip&&!ip.error?ip:null;paintJobs();jobSheetPaint()});
const workStale=k=>Date.now()-(V6.t[k]||0)>60000;
DeckPages.register('work/jobs',{
 show(c){WK.jobs=c;workBind(c.el,jobsClick);workBind(c.el,jobsInput,'input');if(V6.jobsBy.tanner!==undefined)paintJobs();else if(c.el)c.el.innerHTML=DeckUI.skeleton('row',6);jobsLoadAll()},
 refresh(c,tick){WK.jobs=c;if(!tick||workStale('work-jobs'))jobsLoadAll()},
 hide(){WK.jobs=null;workUnbar('jobs')},
 data(){const t=V6.person==='tanner';return DeckUI.jobsData(V6.jobs,{person:V6.person,insight:t?V6.jobInsight:null,profile:t?V6.profile:null})}});
// ---- Work > Gigs (GET /api/gigs): kind and order remembered in this browser; Show more grows by GIG_STEP. Chips repaint from the feed already read. ----
const GIGV={feed:undefined,kind:/^(all|gig|rfp|contract)$/.test(localStorage.getItem('gig-kind')||'')?localStorage.getItem('gig-kind'):'all',sort:localStorage.getItem('gig-sort')==='new'?'new':'fit',page:DeckUI.GIG_SHORT};
function paintGigs(){const c=WK.gigs;if(!c||!c.el)return;
 let html;try{html=DeckUI.gigs(GIGV.feed,Date.now(),{kind:GIGV.kind,sort:GIGV.sort,page:GIGV.page})}catch(e){c.el.innerHTML=renderFail('Gigs');return}
 workPaint(c.el,html,'gigs');workMark(c,GIGV.feed);DeckPages.tv(c)}
const gigsLoad=()=>once('work-gigs',async()=>{GIGV.feed=await feedGet('gigs');paintGigs()});
function gigsClick(e){const t=e.target;if(!t.closest)return;
 const m=t.closest('[data-more="gigs"]');if(m){GIGV.page=m.dataset.less?DeckUI.GIG_SHORT:Math.min(Math.max(GIGV.page,DeckUI.GIG_SHORT)+DeckUI.GIG_STEP,DeckUI.GIG_CAP);paintGigs();return}
 const k=t.closest('[data-gkind]');if(k){GIGV.kind=k.dataset.gkind;GIGV.page=DeckUI.GIG_SHORT;try{localStorage.setItem('gig-kind',GIGV.kind)}catch(err){}buzz('light');paintGigs();return}
 const s=t.closest('[data-gsort]');if(s){GIGV.sort=s.dataset.gsort==='new'?'new':'fit';GIGV.page=DeckUI.GIG_SHORT;try{localStorage.setItem('gig-sort',GIGV.sort)}catch(err){}buzz('light');paintGigs()}}
DeckPages.register('work/gigs',{
 show(c){WK.gigs=c;workBind(c.el,gigsClick);if(GIGV.feed!==undefined)paintGigs();else if(c.el)c.el.innerHTML=DeckUI.skeleton('row',6);gigsLoad()},
 refresh(c,tick){WK.gigs=c;if(!tick||workStale('work-gigs'))gigsLoad()},
 hide(){WK.gigs=null;workUnbar('gigs')},
 data(){return DeckUI.gigsData(GIGV.feed)}});
// ---- end Work ----
// ---- launch results: the last three launch lines, drawn in the Launch page's results column (agents.js builds it); the run window's Run again uses them too ----
function paintResults(){const m=$('#lnmsg');if(m)m.innerHTML=V6.results.map(r=>'<div class="lnres '+r.k+'"><i class="sd '+(r.k==='pending'?'warn':r.k)+'"></i><span>'+esc(r.text)+'</span><small>'+esc(r.at)+'</small></div>').join('')}
function addResult(r){buzz(r.k==='ok'?'success':r.k==='bad'?'error':'');V6.results.unshift({k:r.k,text:r.text,at:new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'})});V6.results=V6.results.slice(0,3);paintResults()}
// ---- v8 run panel: state, elapsed, output lines. Polls /api/run every 1.5 s while open and not finished. Close keeps the run;
// "Last run" reopens it (stored in this browser, with the deck's own launch log as the fallback).
// RUN.r is the run being watched (null = compose mode, nothing sent yet). RUN.thread keeps your messages and run ids (8 turns,
// saved in localStorage); RUN.models holds the last status of every run in the thread so earlier outputs stay on screen.
const RUN_KEY='deck-last-run',THREAD_KEY='deck-last-thread';
const RUN={r:null,open:false,timer:0,tick:0,busy:false,thread:DeckUI.threadLoad(localStorage.getItem(THREAD_KEY)),models:{},prior:{},sending:false,opener:null,html:''};
function runSave(){try{localStorage.setItem(RUN_KEY,JSON.stringify({run_id:RUN.r.run_id,name:RUN.r.name,opened:RUN.r.opened,id:RUN.r.id||null}))}catch(e){}}
function runLoad(){try{const o=JSON.parse(localStorage.getItem(RUN_KEY)||'null');if(o&&typeof o.run_id==='string'&&/^[A-Za-z0-9._-]{1,80}$/.test(o.run_id))return {run_id:o.run_id,name:String(o.name||'').slice(0,60),opened:+o.opened||null,id:typeof o.id==='string'?o.id.slice(0,100):null}}catch(e){}return null}
function threadPersist(){try{localStorage.setItem(THREAD_KEY,DeckUI.threadSave(RUN.thread))}catch(e){}}
// repaint only when the markup changed: the 1 s clock must not rebuild the thread (it would drop a text selection and restart the tool spinners)
function runBody(html,force){const body=$('#runo');if(RUN.html===html&&!force)return;RUN.html=html;const stick=force||body.scrollHeight-body.scrollTop-body.clientHeight<40;body.innerHTML=html;if(stick)body.scrollTop=body.scrollHeight}
function setHtmlOnce(el,html){if(el&&el.dataset.h!==html){el.dataset.h=html;el.innerHTML=html}}
function priorHtml(id,now){const m=RUN.models[id];
 if(m)return DeckUI.runView({run_id:id,model:m,got:now},now).html;
 return '<div class="rl dim">'+(RUN.prior[id]==='fail'?'Output not available':'Loading output')+'</div>'}
function setRunErr(msg){$('#runerr').innerHTML=msg?'<i class="sd bad"></i>'+esc(msg):''}
function paintComposer(state){const ta=$('#runin'),b=$('#runsend');if(!ta||!b)return;
 const st=state!==undefined?state:(RUN.r?DeckUI.runView(RUN.r,Date.now()).state:''),live=st==='running'||st==='queued';
 b.textContent=RUN.sending?'Sending':DeckUI.sendLabel(st);b.disabled=!DeckUI.canSend(ta.value,RUN.sending);
 // a message over the limit is never cut: Send stays off and an inline line says how long it is
 const ss=DeckUI.sendState(ta.value);if(ss.tooLong){setRunErr(DeckUI.tooLongText(ss));RUN.limit=true}else if(RUN.limit){RUN.limit=false;setRunErr('')}
 ta.placeholder=live?'Add an instruction for this run':'Message Hermes';
 b.setAttribute('aria-label',RUN.sending?'Sending':live?'Add an instruction to the running turn':RUN.r?'Send a reply in this session':'Send, starts a new chat')}
function runPaint(){const el=$('#runp');if(!el)return;const now=Date.now();
 if(!RUN.r){el.dataset.state='new';$('#runt').textContent='Ask Hermes';setHtmlOnce($('#runs'),'<i class="sd warn"></i>Ready');$('#runs').className='rs queued';
  $('#rune').textContent='';$('#runf').textContent='';
  runBody('<div class="rl dim">Ask Hermes anything. Nothing starts until you tap Send.</div>');el.classList.remove('err');paintComposer('');paintAgain();return}
 const v=DeckUI.runView(RUN.r,now);
 el.dataset.state=v.state;$('#runt').textContent=v.title;setHtmlOnce($('#runs'),'<i class="sd '+v.mark+'"></i>'+esc(v.label));$('#runs').className='rs '+v.state;
 $('#rune').textContent=v.elapsed;$('#runf').textContent=v.note;
 runBody(DeckUI.threadHtml(DeckUI.threadFor(RUN.thread,RUN.r),id=>id===RUN.r.run_id?v.html:priorHtml(id,now)));
 el.classList.toggle('err',v.stale);paintComposer(v.state);paintAgain()}
async function runPoll(){if(RUN.busy||!RUN.r)return;RUN.busy=true;const r=RUN.r;
 try{const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),14000);
  try{const res=await fetch('/api/run?id='+encodeURIComponent(r.run_id),{signal:ac.signal,cache:'no-store'});const j=await res.json().catch(()=>null);
   if(RUN.r!==r)return;
   if(res.ok&&j&&j.ok){const was=r.model&&r.model.state;r.model=j;RUN.models[r.run_id]=j;r.got=Date.now();r.err='';r.fails=0;r.offline=false;
    if((was==='queued'||was==='running'||(!was&&r.live))&&(j.state==='done'||j.state==='failed'))haptic(j.state==='done'?'success':'error')}
   else{r.fails=(r.fails||0)+1;r.err=((j&&j.error)||('http '+res.status)).slice(0,60);r.offline=!!(j&&j.offline);if(j&&typeof j.last_heartbeat==='number')r.beat=j.last_heartbeat}}
  finally{clearTimeout(tm)}}
 catch(e){if(RUN.r===r){r.fails=(r.fails||0)+1;r.offline=false;r.err=e&&e.name==='AbortError'?'timed out':'deck server did not answer'}}
 finally{RUN.busy=false;if(RUN.r===r){runPaint();runSavePaintLast();
  const done=r.model&&(r.model.state==='done'||r.model.state==='failed');
  if(done||!RUN.open||(r.fails||0)>=DeckUI.RUN_GIVEUP){clearInterval(RUN.timer);RUN.timer=0}}}}
function runSavePaintLast(){const b=$('#lnlast');if(!b)return;const r=RUN.r||runLoad();
 if(!r){b.disabled=true;b.textContent='No run yet';return}b.disabled=false;
 const st=RUN.r?DeckUI.runView(RUN.r,Date.now()).state:'';b.textContent='Last run'+(r.name?' \u00B7 '+DeckUI.runTitle(r.name).slice(0,22):'')+(st?' \u00B7 '+st:'')}
async function postLaunchItem(id,target){const res=await bfetch('/api/launch-item?id='+encodeURIComponent(id)+'&target='+(target||'hermes'),{method:'POST'});
 const json=await res.json().catch(()=>null);return {json,status:res.status}}
// Home > Launch Apps: wake one sleeping app (POST /api/apps/wake?id=, the catalog id; the server allowlists it). agents.js arms it first.
async function postAppWake(id){const res=await bfetch('/api/apps/wake?id='+encodeURIComponent(id),{method:'POST'});
 const json=await res.json().catch(()=>null);return {json,status:res.status}}
const AGAIN={armed:'',t:0,busy:false};
function paintAgain(){const b=$('#runagain');if(!b)return;const v=DeckUI.againState(RUN.r||runLoad(),AGAIN.armed);
 b.disabled=v.disabled;b.classList.toggle('armed',v.armed);b.textContent=v.text;b.setAttribute('aria-label',v.aria)}
// relaunch the same saved item through the allowlisted launch route the list row uses; two taps, then it starts
async function runAgain(){const r=RUN.r||runLoad();if(!r||!r.id||AGAIN.busy)return;
 if(AGAIN.armed!==r.run_id){AGAIN.armed=r.run_id;clearTimeout(AGAIN.t);AGAIN.t=setTimeout(()=>{AGAIN.armed='';paintAgain()},3000);paintAgain();return}
 AGAIN.armed='';clearTimeout(AGAIN.t);paintAgain();AGAIN.busy=true;
 addResult({k:'pending',text:'Starting Hermes \u00B7 '+r.id});
 try{const res=await postLaunchItem(r.id);
  const j=res.json;V6.results.shift();addResult(DeckUI.launchResult(j||{ok:false,error:'http '+res.status}));
  if(j&&j.ok&&typeof j.run_id==='string')openRun({run_id:j.run_id,name:j.name||r.name,id:r.id,opened:Date.now()/1000},true)}
 catch(e){V6.results.shift();addResult({k:'bad',text:'deck server did not answer'})}
 finally{AGAIN.busy=false}}
// polling and the 1 s clock; force = keep polling even if the last status was terminal (a message was just sent)
function runTimers(force){clearInterval(RUN.timer);RUN.timer=0;clearInterval(RUN.tick);
 const done=!force&&RUN.r&&RUN.r.model&&(RUN.r.model.state==='done'||RUN.r.model.state==='failed');
 if(RUN.r){runPoll();if(!done)RUN.timer=setInterval(runPoll,1500)}
 RUN.tick=setInterval(()=>{if(RUN.open)runPaint()},1000)}
// focus returns to the control that opened a window; a card that was repainted meanwhile falls back to the active page tab
function focusBack(o){const t=o&&o.isConnected?o:$('#pgs button.on');if(!t)return;
 if(t===o&&!/^(BUTTON|A|INPUT|TEXTAREA)$/.test(t.tagName))t.setAttribute('tabindex','-1');try{t.focus({preventScroll:true})}catch(e){}}
function showRun(opener){if(!RUN.open)RUN.opener=opener||document.activeElement;RUN.open=true;$('#runp').classList.add('on')}
// fetch every earlier run in the thread once, so its output shows under its message after a reload
// one at a time: every /api/run answer starts a deck-launch status process on the server
async function loadPriors(){const cur=RUN.r&&RUN.r.run_id;
 const ids=[...new Set(RUN.thread.map(t=>t.run_id))].filter(id=>id!==cur&&!RUN.models[id]&&!RUN.prior[id]);
 for(const id of ids)RUN.prior[id]='pending';
 for(const id of ids){
  try{const res=await bfetch('/api/run?id='+encodeURIComponent(id),{cache:'no-store'});const j=await res.json().catch(()=>null);
   if(res.ok&&j&&j.ok){RUN.models[id]=j;RUN.prior[id]='ok'}else RUN.prior[id]='fail'}
  catch(e){RUN.prior[id]='fail'}
  if(RUN.open)runPaint()}}
// fresh = a run just launched from the Launch list: it starts a new thread
function openRun(r,fresh){if(!r)return;if(!RUN.r||RUN.r.run_id!==r.run_id)RUN.r=Object.assign({model:null,got:0,err:'',fails:0,offline:false,beat:null},r);
 else if((RUN.r.fails||0)>=DeckUI.RUN_GIVEUP)RUN.r.fails=0;
 if(fresh){RUN.r.live=true;RUN.thread=[{run_id:r.run_id,text:'',mode:'launch'}];RUN.models={};RUN.prior={}}
 else if(!RUN.thread.some(t=>t.run_id===r.run_id)){const st=DeckUI.threadLoad(localStorage.getItem(THREAD_KEY));RUN.thread=st.some(t=>t.run_id===r.run_id)?st:[{run_id:r.run_id,text:'',mode:'launch'}]}
 runSave();threadPersist();showRun();setRunErr('');runPaint();runSavePaintLast();runTimers();loadPriors();$('#runx').focus()}
// Ask Hermes: a new chat with an editable draft; nothing is sent until Send is tapped
function openCompose(draft,opener){RUN.r=null;RUN.thread=[];RUN.models={};RUN.prior={};
 const ta=$('#runin');ta.value=draft||'';setRunErr('');showRun(opener);growIn();runPaint();runTimers();runSavePaintLast();
 // a long message (an agent mission) opens from its first line with the keyboard down, so it can be read before Send; a short draft opens ready to type
 if(ta.value.length>300){ta.scrollTop=0;try{ta.setSelectionRange(0,0)}catch(e){}}else{ta.focus();try{ta.setSelectionRange(ta.value.length,ta.value.length)}catch(e){}}}
function closeRun(){RUN.open=false;$('#runp').classList.remove('on');clearInterval(RUN.timer);RUN.timer=0;clearInterval(RUN.tick);RUN.tick=0;runSavePaintLast();
 fitRunVv();const o=RUN.opener;RUN.opener=null;focusBack(o)}
// keep the run window inside the visible area while the soft keyboard is up (visualViewport shrinks, the layout viewport does not)
function fitRunVv(){const vv=window.visualViewport,p=$('#runp');if(!vv||!p)return;
 const f=RUN.open?DeckUI.vvFit(innerHeight,vv.height,vv.offsetTop):null;
 p.style.height=f?f.height+'px':'';p.style.transform=f?'translateY('+f.top+'px)':'';p.classList.toggle('kbd',!!f);
 if(f){const o=$('#runo');if(o)o.scrollTop=o.scrollHeight}}
if(window.visualViewport){visualViewport.addEventListener('resize',fitRunVv);visualViewport.addEventListener('scroll',fitRunVv);
 $('#runin').addEventListener('blur',()=>setTimeout(fitRunVv,80))}
function growIn(){const ta=$('#runin'),long=ta.value.length>300;$('#runp').classList.toggle('long',long);ta.style.height='auto';const cs=getComputedStyle(ta),lh=parseFloat(cs.lineHeight)||20,
  pv=['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].reduce((a,k)=>a+(parseFloat(cs[k])||0),0);
 ta.style.height=DeckUI.growHeight(ta.scrollHeight,lh,pv,long?12:4)+'px'}
function runSent(out,text){const prev=RUN.r;if(prev&&prev.model)RUN.models[prev.run_id]=prev.model;
 RUN.thread=DeckUI.threadAdd(RUN.thread,{run_id:out.run_id,text,mode:out.mode});
 if(out.mode==='steer'&&prev&&prev.run_id===out.run_id){prev.err='';prev.fails=0}
 else RUN.r={run_id:out.run_id,name:text.slice(0,40),opened:Date.now()/1000,model:null,got:0,err:'',fails:0,live:true};
 runSave();threadPersist();runTimers(true);runPaint();runSavePaintLast();const o=$('#runo');o.scrollTop=o.scrollHeight}
async function runSend(){const ta=$('#runin'),st=DeckUI.sendState(ta.value),text=st.text;if(!st.ok||RUN.sending)return;
 RUN.sending=true;setRunErr('');paintComposer();haptic('light');
 try{const res=await bfetch('/api/run-send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(DeckUI.sendBody(text,RUN.r))});
  const j=await res.json().catch(()=>null),out=DeckUI.sendResult(j,res.status);
  if(!out.ok){setRunErr('Not sent. '+out.err);haptic('error');return}
  runSent(out,text);ta.value='';growIn()}
 catch(e){setRunErr('Not sent. The deck did not answer');haptic('error')}
 finally{RUN.sending=false;paintComposer()}}
$('#runsend').addEventListener('click',runSend);
$('#runin').addEventListener('input',()=>{growIn();paintComposer()});
$('#runin').addEventListener('keydown',e=>{if(DeckUI.enterSends(e,matchMedia('(pointer:coarse)').matches)){e.preventDefault();runSend()}});
$('#runnew').addEventListener('click',()=>{RUN.r=null;RUN.thread=[];RUN.models={};RUN.prior={};clearInterval(RUN.timer);RUN.timer=0;
 try{localStorage.removeItem(THREAD_KEY);localStorage.removeItem(RUN_KEY)}catch(e){}setRunErr('');runPaint();runSavePaintLast();$('#runin').focus()});
async function reopenRun(){const have=RUN.r||runLoad();if(have)return openRun(have);
 try{const j=await jget('/api/run-last');if(j&&j.ok&&j.run_id)return openRun({run_id:j.run_id,name:String(j.id||'').slice(0,60),opened:j.launched_at||null})}catch(e){}
 addResult({k:'bad',text:'No run to reopen'})}
$('#runx').addEventListener('click',closeRun);$('#runagain').addEventListener('click',runAgain);
addEventListener('keydown',e=>{if(RUN.open&&!SHEET.open&&e.key==='Escape')closeRun()});
runSavePaintLast();paintAgain();
// ---- feedback release detail sheet: tap a card to read it whole. Cron sheets carry Run now / Pause / Resume, failing units read /api/unit,
// both end in Ask Hermes (opens the run window with an editable draft). Links are never intercepted.
const SHEET={open:false,spec:null,armed:null,armT:0,opener:null,busy:false,res:null,tok:0};
function paintSheet(){const s=SHEET.spec;if(!s)return;const was=document.activeElement&&document.activeElement.dataset?document.activeElement.dataset.act:'';
 $('#sheett').textContent=s.title;$('#sheets').textContent=s.sub||'';$('#sheetb').innerHTML=DeckUI.sheetBody(s);
 const r=SHEET.res;$('#sheetr').innerHTML=r?'<i class="sd '+(r.k==='ok'?'ok':r.k==='pending'?'warn':'bad')+'"></i>'+esc(r.text):'';
 $('#sheeta').innerHTML=DeckUI.sheetActions(s.actions,SHEET.armed,Date.now(),SHEET.busy)+DeckUI.sheetLink(s.url);
 if(was){const b=[...$$('#sheeta [data-act]')].find(x=>x.dataset.act===was);if(b&&!b.disabled)b.focus()}}
function openSheet(spec,opener){if(!spec)return;if(!SHEET.open)SHEET.opener=opener||document.activeElement;
 clearTimeout(SHEET.armT);SHEET.tok++;SHEET.spec=spec;SHEET.armed=null;SHEET.busy=false;SHEET.res=null;SHEET.open=true;
 $('#sheet').classList.add('on');$('#app').inert=true;paintSheet();$('#sheetb').scrollTop=0;$('#sheetx').focus()}
function closeSheet(skipFocus){if(!SHEET.open)return;SHEET.open=false;SHEET.tok++;clearTimeout(SHEET.armT);SHEET.armed=null;SHEET.spec=null;
 $('#sheet').classList.remove('on');$('#app').inert=false;const o=SHEET.opener;SHEET.opener=null;if(!skipFocus)focusBack(o);return o}
const ACT_WORD={run:'Starting the run',pause:'Pausing',resume:'Resuming'};
// after Run now, Pause or Resume: the Hermes list again (the sheet's next state), then the Crons page repaints (schedules.js)
async function cronsReload(){const f=await feedGet('crons');if(f&&!f.error)V6.crons=f;if(typeof cronsRepaint==='function')cronsRepaint()}
async function cronAct(s,act){const tok=SHEET.tok;SHEET.busy=true;SHEET.res={k:'pending',text:(ACT_WORD[act]||'Working')+'\u2026'};paintSheet();let out;
 try{const res=await bfetch('/api/cron-act?id='+encodeURIComponent(s.id)+'&act='+encodeURIComponent(act),{method:'POST'});
  out=DeckUI.actResult(await res.json().catch(()=>null),res.status,act)}
 catch(e){out=DeckUI.actResult(null,0,act)}
 if(out.k==='ok')await cronsReload();
 if(tok!==SHEET.tok)return;
 SHEET.busy=false;SHEET.res=out;buzz(out.k==='ok'?'success':'error');
 if(out.k==='ok'){const hit=DeckUI.findCron(V6.crons,s.id);if(hit)SHEET.spec=DeckUI.cronSheet(hit.j,hit.paused,Date.now())}
 paintSheet()}
async function openUnit(name,opener){const spec=DeckUI.unitSheet(name);openSheet(spec,opener);const tok=SHEET.tok;let j=null;
 try{const r=await bfetch('/api/unit?name='+encodeURIComponent(name),{cache:'no-store'});j=await r.json().catch(()=>null);if(!r.ok&&!(j&&j.error))j={ok:false,error:'http '+r.status}}catch(e){j=null}
 if(tok!==SHEET.tok||SHEET.spec!==spec)return;
 Object.assign(spec,DeckUI.unitView(j),{draft:DeckUI.unitDraft(name,j)});paintSheet()}
$('#sheeta').addEventListener('click',e=>{const b=e.target.closest('button[data-act]');if(!b||SHEET.busy||!SHEET.spec)return;
 const s=SHEET.spec,a=s.actions.find(x=>x.id===b.dataset.act);if(!a)return;
 const t=DeckUI.tapAction(SHEET.armed,a.id,Date.now(),!!a.confirm);SHEET.armed=t.armed;clearTimeout(SHEET.armT);
 if(t.armed)SHEET.armT=setTimeout(()=>{SHEET.armed=null;paintSheet()},DeckUI.ARM_MS);
 paintSheet();
 if(!t.run)return;
 if(a.id==='ask'){const op=closeSheet(true);openCompose(s.draft,op)}
 // Data (Home > Crons and Launch detail sheets): this sheet closes and the shell opens the page's Data sheet
 else if(a.id==='data'){const op=closeSheet(true);if(typeof DeckShell!=='undefined'&&DeckShell.sheet&&typeof DeckShell.sheet.data==='function')DeckShell.sheet.data(s.scope||'',op)}
 else if(s.kind==='cron'&&s.id)cronAct(s,a.id)});
$('#sheetx').addEventListener('click',()=>closeSheet());$('#sheetbg').addEventListener('click',()=>closeSheet());
addEventListener('keydown',e=>{if(SHEET.open&&e.key==='Escape'){e.preventDefault();closeSheet()}});
// keep Tab inside the dialog
$('#sheet').addEventListener('keydown',e=>{if(e.key!=='Tab')return;const f=[...$$('#sheetp button:not([disabled]),#sheetp a[href],#sheetb[tabindex]')];if(!f.length)return;
 const i=f.indexOf(document.activeElement);
 if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1].focus()}else if(!e.shiftKey&&(i<0||i===f.length-1)){e.preventDefault();f[0].focus()}});
// tap a card on the info pages: sheetPick refuses links, buttons, inputs, cameras, Launch rows and filter chips
$('#pager').addEventListener('click',e=>{if(SHEET.open||RUN.open||vOpen||!e.target||!e.target.closest)return;
 const pg=e.target.closest('.page');if(!pg)return;
 const chain=[];for(let n=e.target;n&&n!==pg;n=n.parentElement)chain.push({tag:n.tagName,cls:typeof n.className==='string'?n.className:''});
 const i=DeckUI.sheetPick(pg.dataset.name,chain);if(i<0)return;
 let el=e.target;for(let k=0;k<i;k++)el=el.parentElement;
 if(el.dataset.cron){const hit=DeckUI.findCron(V6.crons,el.dataset.cron);if(hit)return openSheet(DeckUI.cronSheet(hit.j,hit.paused,Date.now()),el)}
 if(el.dataset.unit&&DeckUI.unitOk(el.dataset.unit))return openUnit(el.dataset.unit,el);
 if(el.dataset.sync)return openSheet(DeckUI.syncSheet(typeof fleetLast!=='undefined'&&fleetLast?fleetLast.backup:null,el.dataset.sync,Date.now()),el);
 openSheet(DeckUI.cardSheet(el.innerHTML,pg.dataset.label),el)});
// The iPhone shell (user agent OmarchyDeck/) loads same-origin target=_blank links in place and opens off-origin ones in Safari; the attribute is dropped on click so a link there behaves as a plain one.
if(DeckUI.isDeckShell(navigator.userAgent))document.addEventListener('click',e=>{const a=e.target&&e.target.closest&&e.target.closest('a[target]');
 if(a&&DeckUI.dropsTarget(navigator.userAgent,a.tagName,a.getAttribute('target')))a.removeAttribute('target')},true);
// ---- feel and recovery: a tick on tab and chip taps; every empty state's Try again button reloads its own page ----
const RETRY={page:()=>deckPage(leafOf(pname()),false),cluster:()=>v6Cluster(),dev:()=>devLoad(),keys:()=>v7Keys(),home:()=>v7Home(),jobs:()=>jobsLoadAll(),crons:()=>typeof cronsRepaint==='function'?cronsRepaint():null,money:()=>v9Money(),invest:()=>typeof v10Invest==='function'?v10Invest():null,launch:()=>typeof RETRY_LAUNCH==='function'?RETRY_LAUNCH():null,
 gigs:()=>gigsLoad(),today:()=>v7Today(),fleet:()=>typeof fleet=='function'?fleet():null};
document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target:null;if(!t)return;
 const r=t.closest('.es-retry');
 if(r){buzz('selection');r.disabled=true;r.textContent='Trying\u2026';setTimeout(()=>{if(r.isConnected){r.disabled=false;r.textContent='Try again'}},6000);
  try{Promise.resolve((RETRY[r.dataset.retry]||RETRY.page)()).catch(()=>{})}catch(err){}return}
 if(t.closest('#pgs button,.chips button,#hosts button,#ptg button'))buzz('selection')});
{const h=$('#lnhelp');if(h)h.textContent='Tap Hermes, then tap again within 3 seconds to confirm. The run window opens so you can follow along. Closing it keeps the run; Last run brings it back.'}

// ---- Money > Accounts (route money/accounts). /api/finance carries statuses only and loads with the page. Amounts come from
// /api/finance-values, asked for only on Show amounts, held in FINC (DeckUI.finCtl) alone, hidden after 30 s, when the page is hidden and
// when the route changes. Nothing financial goes into a URL, browser storage or a log; both routes are fetched with cache:'no-store'.
const FIN={f:null,loaded:false,ctx:null,bound:null,app:'',dlg:null,masked:'',at:0,failed:false,epoch:0};
const finGet=p=>bfetch(p,{cache:'no-store',credentials:'same-origin'}).then(r=>r.ok?r.json():{error:'http '+r.status});
const FINC=DeckUI.finCtl({get:finGet,setT:(fn,ms)=>setTimeout(fn,ms),clearT:t=>clearTimeout(t),now:()=>Date.now(),onChange:()=>paintMoney()});
// until the feed first answers the page is a skeleton, never an empty frame; a feed that answered badly (or timed out at 60 s) is Not reporting
function paintMoney(){finSheetPaint();const c=FIN.ctx;if(!c||!c.el)return;const now=Date.now();
 try{c.el.innerHTML=FIN.failed&&FIN.masked?DeckPages.part({key:'money/accounts',res:{ok:true,stale:true,at:FIN.at,data:FIN.masked},draw:h=>h}):
  FIN.loaded?DeckUI.finPage(FIN.f,now,FINC.view()):DeckUI.skeleton('tile',1)+DeckUI.skeleton('row',4)}catch(e){c.el.innerHTML=renderFail('Money')}
 if(FIN.loaded)DeckPages.mark(c,FIN.failed&&FIN.masked?{age:Math.max(60,(now-FIN.at)/1000),refresh:1,missing:1}:DeckUI.finStatus(FIN.f,now));
 DeckPages.tv()}
// the open app sheet (DeckShell.sheet, id fin-app) repaints in place from FINC on every change, so it masks with the page; a remote's focus on
// Show amounts or Hide moves to the button that replaced it. A feed that no longer lists the app closes it.
const finShell=()=>typeof DeckShell!=='undefined'&&DeckShell.sheet?DeckShell.sheet:null;
// a closed or detached sheet is dropped at once: its body is emptied and FIN lets go of it, so no revealed text outlives Hide or the 30 s
function finDrop(d){if(!d)return;const b=d.querySelector&&d.querySelector('.sheet-b');if(b)b.innerHTML='';if(FIN.dlg===d){FIN.dlg=null;FIN.app=''}}
function finSheetPaint(){const d=FIN.dlg;if(!d)return;if(!d.isConnected||!d.open||!FIN.app){finDrop(d);return}
 let sp=null;try{sp=DeckUI.finSheet(FIN.f,FIN.app,Date.now(),FINC.view())}catch(e){sp=null}if(!sp){FIN.app='';FIN.dlg=null;d.close();return}
 const b=d.querySelector('.sheet-b');if(!b)return;const had=b.contains(document.activeElement)&&document.activeElement.matches('[data-fin]');
 b.innerHTML=sp.body;if(had){const n=b.querySelector('button[data-fin]');if(n)n.focus()}}
function finOpen(id,opener){const sh=finShell(),sp=DeckUI.finSheet(FIN.f,id,Date.now(),FINC.view());if(!sh||!sp)return;
 FIN.app=id;const d=sh.open(Object.assign({id:'fin-app',opener},sp))||null;FIN.dlg=d;if(d&&d.addEventListener)d.addEventListener('close',()=>finDrop(d))}
function finTap(b){if(!b||b.disabled||FIN.failed)return;if(b.dataset.fin==='hide')FINC.hide();else if(!tvArm(b,FIN.ctx))FINC.reveal()}
// the statuses read through the page registry with their shape check (a wrong-typed answer is Not reporting, and an unanswered read sets
// Offline); the amounts stay on finGet, inside the controller
const finRead=()=>DeckPages.get('finance',{timeout:60000,shape:DeckUI.finShape});
// Keep only the renderer's masked HTML, never the response or a revealed view. A failed read clears the reveal before repainting.
const v9Money=()=>once('money',async()=>{const epoch=FIN.epoch,r=await finRead().catch(()=>null);if(epoch!==FIN.epoch)return;
 FIN.failed=!(r&&r.ok);FIN.f=FIN.failed?{error:r&&r.error||'no answer'}:r.data;FIN.loaded=true;
 if(FIN.failed){if(r&&(r.status===401||r.status===403)){FIN.masked='';FIN.at=0}FINC.hide()}
 else{FIN.masked=DeckUI.finPage(FIN.f,Date.now(),{unavailable:true});FIN.at=Date.now()}
 paintMoney()});
function finForget(){FIN.epoch++;FIN.f=null;FIN.masked='';FIN.at=0;FIN.failed=true;FINC.hide();paintMoney()}
document.addEventListener('deck:role',finForget);
addEventListener('storage',e=>{if(!e||e.key==null||e.key==='role')finForget()});
function finBind(el){if(!el||FIN.bound===el)return;FIN.bound=el;
 el.addEventListener('click',e=>{if(e.target.closest('button[data-retry="money/accounts"]')){v9Money();return}
  const b=e.target.closest('button[data-fin]');if(b){finTap(b);return}
  const r=e.target.closest('button[data-app]');if(r)finOpen(r.dataset.app,r)})}
// the app sheet lives outside the page: its Show amounts and Hide answer here
document.addEventListener('click',e=>{const d=FIN.dlg,t=e.target;if(!d||!t||!t.closest||!d.contains(t))return;finTap(t.closest('button[data-fin]'))});
// on TV, Show amounts needs a second press within 3 s (blueprint 1.4); true when this press only armed the button. invest.js uses it too.
function tvArm(b,c){if(!c||!c.tv||b.classList.contains('armed'))return false;const was=b.textContent;b.classList.add('b','armed');b.textContent='Press again';
 setTimeout(()=>{b.classList.remove('armed');b.textContent=was},3000);return true}
document.addEventListener('visibilitychange',()=>{if(document.hidden)FINC.hide()});
addEventListener('pagehide',()=>FINC.hide());
// one-second tick: expire a reveal even if a timer was throttled, hide in ambient mode, keep the countdown honest without repainting
setInterval(()=>{const v=FINC.view();if(!v.exp)return;
 if(typeof mode!=='undefined'&&mode==='ambient'){FINC.hide();return}
 if(FINC.sweep())return;
 const now=Date.now();for(const r of [FIN.ctx&&FIN.ctx.el,FIN.dlg&&FIN.dlg.isConnected?FIN.dlg:null])if(r)r.querySelectorAll('.fcd[data-exp]').forEach(el=>{el.textContent=DeckUI.fcdText(+el.dataset.exp,now)})},1000);
// called by app.js when a page comes on screen (tick=false) and every 15 s while it stays (tick=true), through the registry.
// Old pages, registered with their current functions and age gates (ms since the page's last load). One line per page:
// the lane that replaces a page deletes its line here and registers its route from its own file. Guests reach none of these.
const pageAge=n=>Date.now()-(V6.t[n]||0);
function oldPage(route,load,stale,hide){return DeckPages.register(route,{show:()=>load(),refresh:()=>{if(stale())load()},hide})}
// Home > Cluster (lane PgHome): the new route and the old leaf name; repaints on every 15 s tick, as before
DeckPages.register(['home/cluster','cluster'],{show:()=>v6Cluster(),refresh:()=>v6Cluster()});

DeckPages.register('money/accounts',{show(c){FIN.ctx=c;finBind(c.el);paintMoney();v9Money()},refresh(c){FIN.ctx=c;if(pageAge('money')>60000)v9Money()},
 hide(){FINC.hide()},data(){return DeckUI.finData(FIN.f,Date.now())}});
oldPage(['home','house'],()=>v7Home(),()=>pageAge('home')>60000);
DeckPages.register('today',{show:ctx=>{TDS.ctx=ctx;v7Today()},refresh:(ctx,tick)=>{TDS.ctx=ctx;if(!tick||pageAge('today')>30000)v7Today(!!tick)},data:()=>DeckUI.tdData(TDS.feeds,Date.now())});
// the shell's entry: the registry does the rest
function deckPage(name,tick){return DeckPages.dispatch(name,tick)}
// app.js boots before this file exists, so the page the deck opens on gets its first deck.js render here, once whoami has answered (decision 11:
// no read before the role is known; app.js dispatches through pageVisible when it answers later)
if(!document.hidden&&(typeof ROLE==='undefined'||ROLE.known))deckPage(leafOf(pname()),false);
