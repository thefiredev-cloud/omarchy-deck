// Deck core helpers: the one escape, the one link rule and the shared formats, under one name (DeckCore).
// Loaded before every other deck script: index.html before app.js, cre.html before cre.js. A module keeps its own names as aliases
// (const esc=DeckCore.esc), so no call site changes. Pure: no DOM, no fetch, no globals. tests/setup-core.js gives every global a test
// builds its DeckCore, the way the page loads this file first.
// ==== DECK CORE BEGIN ====
const DeckCore=(()=>{
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const arr=x=>Array.isArray(x)?x:[];
 const num=v=>typeof v==='number'&&isFinite(v)?v:null;
 const str=(v,n)=>typeof v==='string'?v.trim().slice(0,n||120):'';
 // null is never zero: unknown prints "--", a measured 0 prints "0"
 const fmt=(v,d,unit)=>{const n=num(v);if(n==null)return '--';return (d?n.toFixed(d):String(Math.round(n)))+(unit||'')};
 const toEpoch=v=>{if(num(v)!=null)return v>1e12?v/1000:v;if(typeof v==='string'&&v){const p=Date.parse(v);return isFinite(p)?p/1000:null}return null};
 // relative times a person says out loud: "just now", "2 min ago", "3 h ago", "4 d ago"
 function lapse(x,now){const s=Math.max(0,Math.round(now/1000-x));return s<45?'':s<5400?Math.max(1,Math.round(s/60))+' min':s<172800?Math.round(s/3600)+' h':Math.round(s/86400)+' d'}
 function ago(t,now){const x=toEpoch(t);if(x==null)return 'time unknown';const p=lapse(x,now);return p?p+' ago':'just now'}
 // an age drawn where it can wrap keeps itself whole ("3 h ago" never splits to "3" / "h ago"; LayoutP 40, LayoutD 9). ago() keeps plain
 // spaces, because every page's text, aria-label and test reads it; the line that draws an age beside other words runs it through whole()
 const whole=s=>String(s).replace(/(\d) (min|h|d)\b/g,'$1\u00A0$2').replace(/(min|h|d) ago\b/g,'$1\u00A0ago');
 // how long something has been going on, without the word "ago"
 function dur(t,now){const x=toEpoch(t);return x==null?'':lapse(x,now)||'under a minute'}
 function until(t,now){const x=toEpoch(t);if(x==null)return 'time unknown';const s=Math.round(x-now/1000);if(s<=0)return 'due';
  return s<5400?'in '+Math.max(1,Math.round(s/60))+' min':s<172800?'in '+Math.round(s/3600)+' h':'in '+Math.round(s/86400)+' d'}
 // a weekday and a clock: "Sun 4:10 pm" (the one clock form, PlanDesign section 5)
 function clock(t){const x=toEpoch(t);if(x==null)return '--';const d=new Date(x*1000);return V3.DOW[d.getDay()]+' '+V3.FMT.time(d)}
 // the old short money name: the one money form, "--" where the value is missing
 const usd=v=>{const m=V3.FMT.money(v);return m==null?'--':m};
 const compass=d=>{const n=num(d);if(n==null)return '';return ['N','NE','E','SE','S','SW','W','NW'][Math.round(((n%360)+360)%360/45)%8]};
const safeUrl=u=>typeof u==='string'&&/^https?:\/\/[^\s"'<>\\@]+$/i.test(u)?u:'';
 // ---- the v3 formats (moved from DeckUI's V3 block; plan/design/UiApi.md §3). fmt carries them as fmt.money, fmt.age ...
 const V3=(()=>{
  const MINUS='\u2212',DOT='\u00B7',NA='<span class="na" aria-label="No data">'+DOT+'</span>';
  const grp=s=>String(s).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const neg=(n,s)=>(n<0?MINUS:'')+s;
  const trim0=s=>s.indexOf('.')<0?s:s.replace(/0+$/,'').replace(/\.$/,'');
  const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const COMPASS=['N','NE','E','SE','S','SW','W','NW'],DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  // ---- number formats (blueprint 2.4, PlanDesign section 5, tests/fixtures/formats.json). A missing value returns null; the page decides
  // between na() in a table and na('sheet') in a sheet. Money: "$9,450" under $10K, "$845K", "$1.24M" with its trailing zero ("$1.70M"),
  // "$2.0B"; opt cents, masked, plus ("$100K+", an open end), to (a range: "$150K to $200K").
  function money(v,o){o=isObj(o)?o:{};if(o.masked)return '$\u2022\u2022\u2022';const n=num(v);if(n==null)return null;const a=Math.abs(n);let s;
   if(o.to!=null&&num(o.to)!=null){const lo=money(n,{cents:o.cents}),hi=money(o.to,{cents:o.cents,plus:o.plus});return lo===hi?hi:lo+' to '+hi}
   if(a>=999.95e6)s=(a/1e9).toFixed(1)+'B';
   else if(a>=999.5e3)s=(a/1e6).toFixed(2)+'M';
   else if(a>=9999.5||(!o.cents&&Math.round(a)>=1e4))s=grp(Math.round(a/1e3))+'K';
   else if(o.cents){const t=a.toFixed(2).split('.');s=grp(t[0])+'.'+t[1]}
   else s=grp(Math.round(a));
   return neg(n,'$'+s)+(o.plus?'+':'')}
  const per=(v,o,unit)=>{const m=money(v,o);return m==null?null:m+unit};
  const rent=(v,o)=>per(v,o,'/mo'),psf=(v,o)=>per(v,o,'/SF'),lease=(v,o)=>per(v,o,'/SF/yr');
  const fixed=(v,d,unit)=>{const n=num(v);if(n==null)return null;const s=Math.abs(n).toFixed(d);return (+s===0?'':n<0?MINUS:'')+s+unit};
  const rate=(v,d)=>fixed(v,d==null?2:d,'%'),share=(v,d)=>fixed(v,d==null?1:d,'%');
  // a change carries its sign, a true minus, and no sign once it rounds to zero ("0.0%")
  const signed=(v,d,unit)=>{const n=num(v);if(n==null)return null;const s=Math.abs(n).toFixed(d);return (+s===0?'':n>0?'+':MINUS)+s+unit};
  const chg=(v,d)=>signed(v,d==null?1:d,'%'),pt=(v,d)=>signed(v,d==null?1:d,' pt'),bp=(v,d)=>signed(v,d==null?1:d,' bp');
  function count(v){const n=num(v);if(n==null)return null;const a=Math.abs(n);let s;
   if(a>=999.95e6)s=(a/1e9).toFixed(1)+'B';else if(a>=999.95e3)s=(a/1e6).toFixed(1)+'M';else if(a>=9999.5)s=(a/1e3).toFixed(1)+'K';else s=grp(Math.round(a));
   return neg(n,s)}
  // dates: 'YYYY-MM-DD' and 'YYYY-MM' read as calendar dates (no time-zone shift); numbers are epoch seconds or ms, shown in local time
  const toDate=v=>{if(v instanceof Date)return isNaN(v)?null:v;if(typeof v==='string'){const m=/^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v.trim());if(m)return new Date(+m[1],+m[2]-1,m[3]?+m[3]:1);const p=Date.parse(v);return isNaN(p)?null:new Date(p)}
   const n=num(v);return n==null?null:new Date(n>1e12?n:n*1000)};
  // "Nov 14"; opt year "Nov 14, 2026", weekday "Tue, Nov 17", month "Sep 2026"
  function date(v,o){o=isObj(o)?o:{};if(o.month)return month(v);const d=toDate(v);if(!d)return null;
   return (o.weekday?DOW[d.getDay()]+', ':'')+MON[d.getMonth()]+' '+d.getDate()+(o.year?', '+d.getFullYear():'')}
  function month(v){const d=toDate(v);return d?MON[d.getMonth()]+' '+d.getFullYear():null}
  function time(v){const d=toDate(v);if(!d)return null;const h=d.getHours(),m=d.getMinutes();return ((h%12)||12)+':'+String(m).padStart(2,'0')+' '+(h<12?'am':'pm')}
  function age(sec){const s=num(sec);if(s==null||s<0)return null;const m=Math.round(s/60);if(m<60)return Math.max(1,m)+' min';const h=Math.round(s/3600);if(h<48)return h+' h';return Math.round(s/86400)+' days'}
  const temp=v=>{const n=num(v);return n==null?null:neg(Math.round(n),Math.abs(Math.round(n))+'\u00B0F')};
  function ft(lo,hi){const a=num(lo),b=num(hi);if(a==null&&b==null)return null;const x=Math.round(a==null?b:a),y=Math.round(b==null?a:b);return (x===y?x:Math.min(x,y)+'-'+Math.max(x,y))+' ft'}
  const period=v=>{const n=num(v);return n==null?null:Math.round(n)+' s'};
  const compass=d=>{const n=num(d);return n==null?'':COMPASS[Math.floor((((n%360)+360)%360+22.5)/45)%8]};
  function wind(kt,deg){const n=num(kt);if(n==null)return null;const c=compass(deg);return Math.round(n)+' kt'+(c?' '+c:'')}
  const na=mode=>mode==='sheet'?'No data':NA;
  // a figure with its unit word, joined by a no-break space so the two never part on a wrap (DESIGN layout rule 3: "39 days to sell"):
  // days(39) "39 days", days(1) "1 day"; months(4.25) "4.3 months", months(1) "1 month" (d places, default 1, trailing zeros dropped);
  // unit(12,0,'W') "12 W", unit(1.25,1,'x') "1.3 x". A missing value returns null, as every format here does; the page picks na().
  const NB='\u00A0';
  function days(v){const n=num(v);if(n==null)return null;const r=Math.round(n),a=Math.abs(r);return neg(r,grp(a))+NB+(a===1?'day':'days')}
  function months(v,d){const n=num(v);if(n==null)return null;const s=trim0(Math.abs(n).toFixed(d==null?1:d));return (+s===0?'':n<0?MINUS:'')+s+NB+(s==='1'?'month':'months')}
  const unit=(v,d,u)=>fixed(v,d==null?0:d,u?NB+String(u):'');
  // the span a change or a sparkline covers, spelled after it: "today", "7 days", "1 year". Table heads keep "1-yr"; chips keep "1D 1M 3M".
  const SPANS={'1d':'today',today:'today','7d':'7 days','1w':'7 days','30d':'30 days','1m':'1 month','3m':'3 months','6m':'6 months','1y':'1 year','5y':'5 years'};
  const span=k=>SPANS[String(k==null?'':k).trim().toLowerCase()]||'';
  const FMT={money,rent,psf,lease,rate,share,chg,pt,bp,count,date,month,time,age,temp,ft,period,wind,na,compass,span,days,months,unit};
  return {MINUS,DOT,NA,grp,neg,trim0,MON,DOW,COMPASS,toDate,FMT,signed}
 })();
 Object.assign(fmt,V3.FMT);
 // ---- one signed change (PlanDesign M1, section 5): sign, true minus and a shape mark (.delta up|dn|flat), flat once the printed value
 // rounds to zero ("0.00%"). kind 'pct' (default), 'pt' (points: "+0.8 pt") or 'bp' (the value in basis points: "+5.1 bp"); d places
 // (default 1). dir is up, down or flat; text is null and html '' for a missing value.
 function delta(v,o){o=isObj(o)?o:{};const n=num(v),kind=o.kind==='pt'||o.kind==='bp'?o.kind:'pct';if(n==null)return {text:null,dir:'',html:''};
  const text=V3.FMT[kind==='pct'?'chg':kind](n,o.d),dir=/^[0-9]/.test(text)?'flat':n>0?'up':'down';
  return {text,dir,html:'<span class="delta '+(dir==='down'?'dn':dir)+'">'+esc(text)+'</span>'}}
 // ---- Show more and Show fewer (section 5 controls): one .more-row with "Show 12 more" and a quiet "Show fewer", both data-more="<key>"
 // (Show fewer adds data-less). shown: rows on screen; total: rows there are; step: rows a tap adds; first: rows the list opens with
 // (default step). The page handles the tap by its key and repaints; deck.js DeckMore keeps the focus (moreFocus below, SeeAccess A1).
 function more(o){o=isObj(o)?o:{};const key=String(o.key==null?'':o.key);if(!/^[A-Za-z0-9_:.-]{1,40}$/.test(key))return '';
  const int=(v,d)=>{const n=num(v);return n==null?d:Math.max(0,Math.round(n))},shown=int(o.shown,0),total=int(o.total,0),step=Math.max(1,int(o.step,12)),first=int(o.first,step),left=total-shown;
  const b=left>0?'<button type="button" class="btn" data-more="'+key+'">Show '+V3.grp(Math.min(step,left))+' more</button>':'';
  const f=shown>first&&total>first?'<button type="button" class="btn btn-quiet" data-less="1" data-more="'+key+'">Show fewer</button>':'';
  return b||f?'<div class="more-row" data-more-row="'+key+'">'+b+f+'</div>':''}
 // after Show more: the first row key that was not on screen before the tap (focus goes there); null when there is none
 const moreFocus=(before,after)=>{const was=new Set(arr(before).map(String)),k=arr(after).map(String).find(x=>!was.has(x));return k==null?null:k};
 // ---- a link row (section 5): the visible words first, then the meta and the site's host, safeUrl, a new tab with no opener and no
 // referrer, a trailing arrow. A url that fails safeUrl draws the same row without a link (never a dead or unsafe href).
 const hostOf=u=>{const m=/^https?:\/\/([^/?#:]+)/i.exec(String(u||''));return m?m[1].replace(/^www\./i,'').toLowerCase():''};
 function linkRow(o){o=isObj(o)?o:{};const url=safeUrl(o.url),label=str(o.label,200)||hostOf(url);if(!label)return '';
  const meta=[str(o.meta,200),hostOf(url)].filter(Boolean).join(' \u00B7 '),cls=typeof o.cls==='string'&&/^[a-z0-9 -]{1,60}$/.test(o.cls)?' '+o.cls:'';
  const key=o.key==null||o.key===''?'':' data-key="'+esc(o.key)+'"',fig=o.fig==null||o.fig===''?'':'<span class="fr"><b>'+esc(o.fig)+'</b></span>';
  const inner='<span class="fl"><b>'+esc(label)+'</b>'+(meta?'<small>'+esc(meta)+'</small>':'')+'</span>'+fig;
  return url?'<a class="frow lrow'+cls+'" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer"'+key+'>'+inner+'<span class="lk" aria-hidden="true">\u2197</span></a>'
   :'<div class="frow lrow'+cls+'"'+key+'>'+inner+'</div>'}
 // ---- one state set (section 5, PlanDesign M7): ops states Up, Degraded, Down, Not reported, Paused, Asleep; feed states OK, Out of date,
 // Not reporting, Needs a key, Blocked, Building. Each is a mark (.sd kind) and one word. An unknown state is "Not reported", never Down.
 const STATES={up:['ok','Up'],degraded:['warn','Degraded'],down:['bad','Down'],not_reported:['off','Not reported'],paused:['off','Paused'],asleep:['off','Asleep'],
  ok:['ok','OK'],stale:['warn','Out of date'],not_reporting:['bad','Not reporting'],needs_key:['off','Needs a key'],blocked:['bad','Blocked'],building:['wait','Building'],
  unknown:['off','Not reported'],unavailable:['bad','Not reporting']};
 function status(k){const s=STATES[String(k==null?'':k).trim().toLowerCase().replace(/[\s-]+/g,'_')]||STATES.not_reported;return {mark:s[0],word:s[1]}}
 // a count of ops states said once: "4 of 6 up · 1 down · 1 not reported" ("0 of 6 up · 6 not reported" when nothing reported)
 function rollup(states){const l=arr(states).map(s=>status(s).word),n=w=>l.filter(x=>x===w).length;if(!l.length)return '';
  return [n('Up')+' of '+l.length+' up'].concat(['Down','Degraded','Not reported','Paused','Asleep'].filter(w=>n(w)).map(w=>n(w)+' '+w.toLowerCase())).join(' \u00B7 ')}
 // a spoken name that starts with the visible words (PlanEng item 22): "AK, Alaska, score 49"
 const label=(visible,detail)=>[str(visible,200),str(detail,300)].filter(Boolean).join(', ');
 return {esc,isObj,arr,num,str,fmt,toEpoch,lapse,ago,whole,dur,until,clock,usd,compass,safeUrl,delta,more,moreFocus,linkRow,hostOf,status,rollup,label,
  MINUS:V3.MINUS,DOT:V3.DOT,NA:V3.NA,grp:V3.grp,neg:V3.neg,trim0:V3.trim0,MON:V3.MON,DOW:V3.DOW,COMPASS:V3.COMPASS,toDate:V3.toDate}
})();
// ==== DECK CORE END ====
