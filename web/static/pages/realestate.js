// Real estate > Residential (deck v3, 2026-11-14), its ZIP sheet, and DeckScope: the scope bar shared with Commercial.
// Data: /api/housing/national?part=, /api/housing/fields, /api/housing/rank, /api/housing/zip/<zip>, /api/housing/profile,
// /api/realestate/homes and /api/realestate (plan NationalApi.md). The page shows values, confidence dots on blended numbers
// and one freshness mark. Sources, coverage, weights and method live in the Data sheet (data()). Money stays masked until
// Show amounts. Model functions are pure and exported for tests; render and glue use DeckUI, DeckPages and DeckShell.

// ---- DeckScope (UiApi 4.x): one stored scope for both Real estate subs
const DeckScope=(()=>{
 const KEY='re:scope',HOME_STATE='CA',HOME_COUNTIES=['Orange','Los Angeles','San Diego'],HOME_METRO='Los Angeles-Long Beach-Anaheim, CA';
 const KINDS=[['mine','Your markets'],['state','State'],['metro','Metro'],['us','United States']];
 const STATES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',
  FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const store=()=>{try{return typeof localStorage!=='undefined'?localStorage:null}catch(e){return null}};
 // any input to a valid scope: an unknown kind is Your markets, a state scope without a state is California, a metro scope without a metro is the home metro
 function norm(v){const o=v&&typeof v==='object'?v:{};const kind=KINDS.some(k=>k[0]===o.kind)?o.kind:'mine';
  const st=typeof o.state==='string'&&/^[A-Za-z]{2}$/.test(o.state.trim())&&STATES[o.state.trim().toUpperCase()]?o.state.trim().toUpperCase():'';
  const mt=typeof o.metro==='string'?o.metro.trim().slice(0,80):'';
  return {kind,state:kind==='state'?(st||HOME_STATE):'',metro:kind==='metro'?(mt||HOME_METRO):''}}
 // the stored value; the old Housing page's choice (hstate:housing, scope markets|state|metro|us) carries over once
 function load(){const ls=store();if(!ls)return norm(null);
  try{const s=JSON.parse(ls.getItem(KEY)||'null');if(s&&typeof s==='object')return norm(s)}catch(e){}
  try{const o=JSON.parse(ls.getItem('hstate:housing')||'null');if(o&&typeof o==='object')return norm({kind:o.scope==='markets'?'mine':o.scope,state:o.state,metro:o.metro})}catch(e){}
  return norm(null)}
 let cur=null;const subs=new Set();let hand={};
 const get=()=>{if(!cur)cur=load();return Object.assign({},cur)};
 const same=(a,b)=>a.kind===b.kind&&a.state===b.state&&a.metro===b.metro;
 function set(p){const prev=get(),next=norm(Object.assign({},prev,p&&typeof p==='object'?p:{}));
  if(p&&p.kind&&p.kind!==prev.kind&&!('state' in p))next.state=norm({kind:next.kind}).state;
  if(p&&p.kind&&p.kind!==prev.kind&&!('metro' in p))next.metro=norm({kind:next.kind}).metro;
  cur=next;const ls=store();try{if(ls)ls.setItem(KEY,JSON.stringify(next))}catch(e){}
  if(!same(prev,next))subs.forEach(fn=>{try{fn(Object.assign({},next),prev)}catch(e){}});
  paintBars();return Object.assign({},next)}
 const onChange=fn=>{if(typeof fn!=='function')return ()=>{};subs.add(fn);return ()=>subs.delete(fn)};
 const metroShort=m=>{const s=String(m||''),i=s.lastIndexOf(', ');if(i<0)return s;return s.slice(0,i).split('-')[0]+', '+s.slice(i+2).split('-')[0]};
 function label(sc,o){const s=norm(sc||get()),short=!!(o&&o.short);
  return s.kind==='mine'?'Your markets':s.kind==='state'?(short?s.state:STATES[s.state]):s.kind==='metro'?(short?metroShort(s.metro):s.metro):(short?'US':'United States')}
 // route params for /api/housing/rank and /api/realestate/*: no scope= key, the server reads state, county and metro
 function query(sc){const s=norm(sc||get()),e=encodeURIComponent;
  return s.kind==='mine'?'state='+HOME_STATE+'&county='+e(HOME_COUNTIES.join(',')):s.kind==='state'?'state='+s.state:s.kind==='metro'?'metro='+e(s.metro):''}
 // five digits open that ZIP, two or more letters name a city; anything else is not a search yet
 function parseSearch(t){const s=String(t==null?'':t).trim();if(/^\d{5}$/.test(s))return {zip:s};
  if(/[A-Za-z]{2}/.test(s)&&s.length<=60&&!/\d{6}/.test(s))return {city:s.replace(/\s+/g,' ')};return null}
 // ---- markup: T and D get the segment and the search in .phead .pscope; P and L get the search in the page's filter row and the scope group in the Filters sheet
 const ICON='<svg class="i" aria-hidden="true"><use href="#i-search"/></svg>';
 // the field is a combobox: a page that gives hand.suggest lists up to five matching ZIPs under it while the owner types (SeeFlows F4)
 const searchBox=()=>'<label class="search re-search">'+ICON+'<input type="search" data-scope-q placeholder="ZIP or city" aria-label="ZIP or city" autocomplete="off" enterkeyhint="search" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="re-sugg"><kbd>/</kbd></label>';
 function seg(sc){const s=norm(sc||get());
  return '<div class="seg scope" role="group" aria-label="Scope">'+KINDS.map(([k,l])=>{const on=s.kind===k,txt=on&&(k==='state'||k==='metro')?label(s,{short:k==='metro'}):l;
   return '<button type="button" data-scope-k="'+k+'"'+(on?' class="on"':'')+' aria-pressed="'+on+'"'+(k==='state'||k==='metro'?' aria-haspopup="dialog"':'')+'>'+esc(txt)+'</button>'}).join('')+'</div>'}
 const bar=sc=>seg(sc)+searchBox().replace('re-search','re-search re-bar');
 const field=sc=>'<div class="field field-group fb-only re-scope-field" role="group" aria-label="Scope"><span class="fg-h">Scope</span>'+seg(sc)+'</div>';
 // lists for the State and Metro pickers, shared with the pages (one read per 10 minutes)
 const lists={};
 function rollup(part){const c=lists[part];if(c&&Date.now()-c.t<600000)return c.p;
  const p=(typeof DeckPages!=='undefined'&&DeckPages.get?DeckPages.get('housing/national?part='+part):Promise.resolve({ok:false,status:0}))
   .then(r=>r&&r.ok&&r.data&&Array.isArray(r.data[part])?r.data[part]:null).catch(()=>null);
  lists[part]={t:Date.now(),p};p.then(v=>{if(!v)delete lists[part]});return p}
 const metroStates=name=>{const s=String(name||''),i=s.lastIndexOf(', ');return i<0?[]:s.slice(i+2).split('-').map(x=>x.trim().toUpperCase())};
 function pickState(opener){const s=get(),rows=Object.keys(STATES).sort((a,b)=>STATES[a].localeCompare(STATES[b]));
  sheet({id:'re-pick-state',title:'Choose a state',body:'<div class="flist">'+rows.map(k=>'<button type="button" class="frow" data-scope-pick-state="'+k+'"'+(s.kind==='state'&&s.state===k?' aria-current="true"':'')+'><span class="fl"><b>'+esc(STATES[k])+'</b></span><span class="fr"><b>'+k+'</b></span></button>').join('')+'</div>'},opener)}
 function metroList(rows,q){const t=String(q||'').trim().toLowerCase(),r=(rows||[]).filter(x=>x&&typeof x.name==='string'&&(!t||x.name.toLowerCase().includes(t)))
   .sort((a,b)=>(+b.pop||0)-(+a.pop||0)).slice(0,40);
  return r.length?r.map(x=>'<button type="button" class="frow" data-scope-pick-metro="'+esc(x.name)+'"><span class="fl"><b>'+esc(x.name)+'</b></span></button>').join(''):'<p class="note">No metro matches.</p>'}
 async function pickMetro(opener){const d=sheet({id:'re-pick-metro',title:'Choose a metro',body:'<label class="field">Metro name<input type="search" data-scope-mq autocomplete="off" placeholder="Type a city"></label><div class="flist" data-scope-ml><p class="note">Reading metros…</p></div>'},opener);
  const rows=await rollup('metros');const ml=d&&d.querySelector('[data-scope-ml]');if(!ml)return;
  if(!rows){ml.innerHTML='<p class="note">Metros are not reporting.</p>';return}
  ml.innerHTML=metroList(rows,'');const inp=d.querySelector('[data-scope-mq]');if(inp)inp.addEventListener('input',()=>{ml.innerHTML=metroList(rows,inp.value)})}
 function sheet(o,opener){if(typeof DeckShell!=='undefined'&&DeckShell.sheet)return DeckShell.sheet.open(Object.assign({sub:'Real estate'},o,{opener}));return null}
 const close=()=>{if(typeof DeckShell!=='undefined'&&DeckShell.sheet)DeckShell.sheet.close()};
 function search(text,opener){const p=parseSearch(text);if(!p)return false;
  if(p.zip&&typeof hand.onZip==='function')hand.onZip(p.zip,opener);else if(p.city&&typeof hand.onCity==='function')hand.onCity(p.city,opener);return true}
 // ---- suggestions (F4): three to five digits are a ZIP prefix, two or more letters a city or county word; the list sits under the
 // field in the document (the filter row scrolls sideways on L and T and would clip it), a tap or Enter opens that ZIP's sheet
 const SUGG_MAX=5;
 function suggestQuery(t){const s=String(t==null?'':t).trim().replace(/\s+/g,' ');if(/^\d{3,5}$/.test(s))return s;
  return /[A-Za-z]{2}/.test(s)&&s.length<=40&&!/\d/.test(s)?s:null}
 function suggestRows(rows){return (Array.isArray(rows)?rows:[]).filter(r=>r&&typeof r==='object'&&/^\d{5}$/.test(String(r.zip))).slice(0,SUGG_MAX)
  .map(r=>({zip:String(r.zip),place:[r.city,r.state].filter(x=>typeof x==='string'&&x).join(', ').slice(0,60),score:typeof r.h_score==='number'&&isFinite(r.h_score)?Math.round(r.h_score):null}))}
 // every word goes through esc, attributes too: suggestRows checks the shape, but this builder never trusts its input
 function suggestHtml(items,active){const l=(Array.isArray(items)?items:[]).filter(x=>x&&typeof x==='object');if(!l.length)return '<p class="re-sugg-none" role="status">No ZIP matches.</p>';
  return l.map((x,i)=>'<div class="re-sugg-o" role="option" id="re-sugg-'+i+'" aria-selected="'+(i===active)+'" data-sugg-zip="'+esc(x.zip)+'"><b>'+esc(x.zip)+'</b><span>'+esc(x.place)+'</span>'+
   (x.score!=null?'<small>Score '+esc(x.score)+'</small>':'')+'</div>').join('')}
 const sg={inp:null,items:[],active:-1,tok:0,timer:0,open:false};
 function suggBox(){let b=document.getElementById('re-sugg');
  if(!b){b=document.createElement('div');b.id='re-sugg';b.className='re-sugg';b.setAttribute('role','listbox');b.setAttribute('aria-label','Matching ZIPs');b.hidden=true;document.body.appendChild(b)}return b}
 function suggPaint(){const t=sg.inp;if(!t||!t.isConnected){suggClose();return}const b=suggBox(),r=(t.closest('.search')||t).getBoundingClientRect();
  b.innerHTML=suggestHtml(sg.items,sg.active);const w=Math.min(Math.max(r.width,360),innerWidth-16),l=Math.max(8,Math.min(r.left,innerWidth-8-w));
  b.style.left=(l+scrollX)+'px';b.style.top=(r.bottom+scrollY+4)+'px';b.style.width=w+'px';b.hidden=false;sg.open=true;
  t.setAttribute('aria-expanded','true');if(sg.active>=0)t.setAttribute('aria-activedescendant','re-sugg-'+sg.active);else t.removeAttribute('aria-activedescendant')}
 function suggClose(){clearTimeout(sg.timer);sg.tok++;sg.open=false;sg.items=[];sg.active=-1;if(typeof document==='undefined'||!document.getElementById)return;const b=document.getElementById('re-sugg');if(b){b.hidden=true;b.innerHTML=''}
  if(sg.inp){sg.inp.setAttribute('aria-expanded','false');sg.inp.removeAttribute('aria-activedescendant')}}
 function suggest(t){const q=typeof hand.suggest==='function'?suggestQuery(t.value):null;clearTimeout(sg.timer);if(!q){suggClose();return}
  sg.timer=setTimeout(async()=>{const tok=++sg.tok;let rows=null;try{rows=await hand.suggest(q)}catch(e){}
   if(tok!==sg.tok||document.activeElement!==t)return;if(!Array.isArray(rows)){suggClose();return}sg.inp=t;sg.items=suggestRows(rows);sg.active=-1;suggPaint()},150)}
 function pick(zip,opener){suggClose();if(typeof hand.onZip==='function')hand.onZip(zip,opener)}
 // every scope control repaints from the stored value, wherever it sits (header, filter sheet)
 function paintBars(){if(typeof document==='undefined')return;
  document.querySelectorAll('.seg.scope').forEach(el=>{el.outerHTML=seg(get())})}
 let wired=false;
 function wire(){if(wired||typeof document==='undefined')return;wired=true;
  document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target:null;if(!t)return;let b;
   if((b=t.closest('[data-sugg-zip]'))){pick(b.dataset.suggZip,sg.inp);return}
   if((b=t.closest('[data-scope-k]'))){const k=b.dataset.scopeK;if(k==='state')pickState(b);else if(k==='metro')pickMetro(b);else set({kind:k});return}
   if((b=t.closest('[data-scope-pick-state]'))){set({kind:'state',state:b.dataset.scopePickState});close();return}
   if((b=t.closest('[data-scope-pick-metro]'))){set({kind:'metro',metro:b.dataset.scopePickMetro});close()}});
  // a press on a suggestion keeps the field's focus (and the phone's keyboard) until the tap lands
  document.addEventListener('pointerdown',e=>{if(e.target&&e.target.closest&&e.target.closest('#re-sugg'))e.preventDefault()});
  document.addEventListener('input',e=>{const t=e.target;if(t&&t.matches&&t.matches('input[data-scope-q]'))suggest(t)});
  document.addEventListener('focusout',e=>{const t=e.target;if(!t||!t.matches||!t.matches('input[data-scope-q]'))return;setTimeout(()=>{if(document.activeElement!==t)suggClose()},150)});
  document.addEventListener('keydown',e=>{const t=e.target;if(!t||!t.matches||!t.matches('input[data-scope-q]'))return;const n=sg.open&&sg.inp===t?sg.items.length:0;
   if((e.key==='ArrowDown'||e.key==='ArrowUp')&&n){e.preventDefault();const a=sg.active;sg.active=e.key==='ArrowDown'?(a<0?0:(a+1)%n):(a<=0?n-1:a-1);suggPaint();return}
   if(e.key==='Escape'&&sg.open){e.preventDefault();e.stopPropagation();suggClose();return}
   if(e.key!=='Enter')return;e.preventDefault();
   // the marked suggestion, then five digits or a city name as before, then the first match of a ZIP prefix
   if(n&&sg.active>=0){pick(sg.items[sg.active].zip,t);return}
   if(search(t.value,t)){suggClose();return}
   if(n&&/^\d{3,4}$/.test(t.value.trim())){pick(sg.items[0].zip,t);return}
   t.setCustomValidity('Type five digits or a city name');t.reportValidity();setTimeout(()=>t.setCustomValidity(''),1500)});
  document.addEventListener('keydown',e=>{if(e.key!=='/'||e.metaKey||e.ctrlKey||e.altKey)return;const a=document.activeElement;if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))return;
   const el=[...document.querySelectorAll('input[data-scope-q]')].find(x=>x.offsetParent!==null);if(el){e.preventDefault();el.focus()}})}
 // a sub calls mount in show(): it fills .pscope (T, D) and puts the search first in its filter row (P, L) when the page did not
 function mount(ctx,h){hand=h&&typeof h==='object'?h:{};wire();
  // a search the owner is typing in keeps its text: only the segment repaints then
  const ps=ctx&&ctx.head&&ctx.head.querySelector?ctx.head.querySelector('.pscope'):null,act=typeof document!=='undefined'?document.activeElement:null;
  if(ps){if(act&&ps.contains(act)&&ps.querySelector('.seg.scope'))paintBars();else ps.innerHTML=bar(get())}
  const top=ctx&&ctx.el&&ctx.el.querySelector?ctx.el.querySelector('.fbar-top'):null;
  if(top&&!top.querySelector('.re-search'))top.insertAdjacentHTML('afterbegin',searchBox())}
 return {get,set,onChange,query,label,parseSearch,suggestQuery,suggestRows,suggestHtml,mount,field,searchBox,rollup,norm,metroStates,metroShort,STATES,HOME_STATE,HOME_COUNTIES,HOME_METRO,KEY,
  close:suggClose,_reset(){cur=null;subs.clear();hand={}}}
})();

// ---- Residential: pure models first, then render, then glue
const DeckRE=(()=>{
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num=v=>typeof v==='number'&&isFinite(v)?v:null;
 const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const arr=v=>Array.isArray(v)?v:[];
 const F=()=>DeckUI.fmt;
 const PAGE=50,HOMES=12,FILTER_KEY='re:res:f',MIN_POP_DEFAULT=5000;
 // ---- filters: Grade, Within budget (off by default), Max price (memory only: an amount), Min population, Sort
 const GRADES=[['','All grades'],['AB','A and B'],['A','A only']];
 // [key, label, v2 column, v1 alias]: on v2 data the table's own blended columns sort; v1 data falls back to the old aliases.
 // Home value sorts lowest first (the server's price sort); every other key is the server's best first unless dir= asks otherwise
 const SORTS=[['score','Score','h_score','score'],['yield','Gross yield','gross_yield','yield'],['value','Home value, lowest first','price','price'],['change_1y','1-yr change','value_trend_1y','change_1y'],
  ['rent','Rent','typical_rent','rent'],['days','Days to sell','days_on_market',null],['cuts','Price cuts','price_cuts',null],['inventory','Inventory','inventory',null],
  ['afford','Payment to income','affordability',null],['grade','Rental grade','area_score','grade'],['pop','Population','population','pop'],['income','Household income','income','income'],
  ['change_5y','5-yr change','value_trend_5y','change_5y'],['mf','Multifamily score','multifamily_score',null],['rent_1y','Rent 1-yr','rent_trend_1y',null]];
 // minPop: null = the default (5,000 outside Your markets: the national top by score was bases and towns of about 1,100 people),
 // 0 = cleared by the owner (any size), a number = typed
 function filtersLoad(){const d={grade:'',within:false,max:null,minPop:null,sort:'score'};
  try{const s=JSON.parse(localStorage.getItem(FILTER_KEY)||'null');if(isObj(s)){if(GRADES.some(g=>g[0]===s.grade))d.grade=s.grade;d.within=s.within===true;
   if(num(s.minPop)!=null&&s.minPop>=0)d.minPop=Math.round(s.minPop);if(SORTS.some(x=>x[0]===s.sort))d.sort=s.sort}}catch(e){}
  return d}
 // the max price is never stored: it is an amount
 function filtersSave(f){try{localStorage.setItem(FILTER_KEY,JSON.stringify({grade:f.grade,within:!!f.within,minPop:f.minPop,sort:f.sort}))}catch(e){}}
 // the population floor in force for a scope: the default applies to State, Metro and United States only
 function minPopOf(f,sc){const v=isObj(f)?f.minPop:null;if(v===0)return null;if(num(v)!=null&&v>0)return Math.round(v);return DeckScope.norm(sc).kind==='mine'?null:MIN_POP_DEFAULT}
 const catalog=fields=>{const m=new Map();for(const x of arr(fields&&fields.fields))if(isObj(x)&&typeof x.name==='string')m.set(x.name,x);return m};
 const v2=fields=>!!fields&&fields.dataset==='v2'&&arr(fields.fields).length>0;
 const inZips=(cat,c)=>{const x=cat.get(c);return !!x&&x.in_zips===true};
 function sortParam(key,fields){const s=SORTS.find(x=>x[0]===key)||SORTS[0];if(v2(fields)&&inZips(catalog(fields),s[2]))return s[2];return s[3]||'score'}
 // rank columns: every Best ZIPs column of both lenses plus each one's confidence, only when zips.json carries it (a missing
 // column would answer 400), and the metro code the multifamily lens joins its metro context on
 const BASE_COLS=['city','state','h_score','home_value','gross_yield','typical_rent','value_trend_1y','area_grade','days_on_market','price_cuts','population','income','value_trend_5y','affordability','climate_risk'];
 const CONF_COLS=['h_conf','home_value_conf','gross_yield_conf','typical_rent_conf','value_trend_1y_conf','days_on_market_conf','price_cuts_conf','affordability_conf','value_trend_5y_conf','income_conf','climate_risk_conf'];
 const confName=c=>/_score$/.test(c)?c.slice(0,-6)+'_conf':c+'_conf';
 function rankCols(fields){if(!v2(fields))return null;const cat=catalog(fields),out=['city','state','area_grade'];
  const add=c=>{if(c&&!out.includes(c)&&inZips(cat,c))out.push(c)};
  BASE_COLS.forEach(add);for(const d of BEST_ALL)for(const x of arr(d.f)){add(x);add(confName(x))}
  CONF_COLS.forEach(add);add('cbsa');return out}
 // ---- Best ZIPs columns (owner order 2026-11-17): the nine data points in his order, the old score columns behind More columns,
 // and the multifamily lens. f: the fields a column reads, the first one the answer carries wins (alt relabels a fallback);
 // v1: the old column on v1 data; ctx: a metro context field joined on the row's cbsa; pri 2 cells drop on TV and narrow tables
 const BEST_RES=[
  {key:'value',label:'Home value',help:'Typical home value in this ZIP.',f:['home_value'],v1:'price',fmt:'money',sort:'value'},
  {key:'chg',label:'1-yr change',help:'Change in home value over the last 12 months.',f:['value_trend_1y'],v1:'zhvi_yoy',fmt:'chg',sort:'change_1y'},
  {key:'rent',label:'Rent',help:'Typical rent per month.',f:['typical_rent'],v1:'rent',fmt:'rent',sort:'rent'},
  {key:'yield',label:'Gross yield',help:'A year of rent divided by the home value, before costs.',f:['gross_yield'],v1:'yield_gross',fmt:'rate',sort:'yield'},
  {key:'days',label:'Days to sell',help:'Typical days from listing to sale.',f:['days_on_market'],v1:'dom',fmt:'ndays',sort:'days',pri:2},
  {key:'cuts',label:'Price cuts',help:'Share of homes for sale with a price cut.',f:['price_cuts'],v1:'price_cut_share',fmt:'share',sort:'cuts',pri:2},
  {key:'inv',label:'Inventory',help:'Homes for sale now.',f:['inventory'],v1:'active',fmt:'homes',sort:'inventory',pri:2},
  {key:'afford',label:'Payment to income',help:'Monthly payment on a typical home as a share of typical income.',f:['affordability'],fmt:'share',sort:'afford',pri:2}];
 const BEST_MORE=[
  {key:'score',label:'Score',help:'Overall residential score, 0 to 100.',f:['h_score'],v1:'h_score',fmt:'score',sort:'score',pri:2},
  {key:'grade',label:'Rental grade',help:'A to D for buying rental houses. A is best.',f:['area_grade'],v1:'area_grade',fmt:'grade',sort:'grade',pri:2},
  {key:'pop',label:'Population',help:'People who live in this ZIP.',f:['population'],v1:'pop',fmt:'people',sort:'pop',pri:3},
  {key:'income',label:'Household income',help:'Median household income per year.',f:['income'],v1:'hh_income',fmt:'money',sort:'income',pri:3},
  {key:'chg5',label:'5-yr change',help:'Change in home value over 5 years.',f:['value_trend_5y'],v1:'zhvi_5y',fmt:'chg',sort:'change_5y',pri:4},
  {key:'risk',label:'Climate risk',help:'Climate and hazard risk, 0 to 100. Lower is better.',f:['climate_risk'],fmt:'score',pri:4}];
 const BEST_MF=[
  {key:'mf',label:'Multifamily score',help:'Score for apartment buildings, 0 to 100.',f:['multifamily_score'],fmt:'score',sort:'mf'},
  BEST_RES[2],
  // a non-breaking hyphen: a narrow header wraps between words, never "1-" over "yr"
  {key:'rent1y',label:'Rent 1\u2011yr',help:'Change in typical rent over the last 12 months.',f:['rent_trend_1y'],fmt:'chg',sort:'rent_1y'},
  {key:'r5',label:'Renters in 5+ unit buildings',help:'Renter homes in buildings with 5 or more units.',f:['acsmf_renter_5plus_share','acs_units_5plus_share'],
   alt:{acs_units_5plus_share:['Homes in 5+ unit buildings','All homes in buildings with 5 or more units.']},fmt:'share',pri:2},
  {key:'u24',label:'2-4 unit share',help:'Homes in buildings with 2 to 4 units.',f:['acs_units_2_4_share'],fmt:'share',pri:2},
  {key:'vac',label:'Vacant for rent',help:'Homes empty and offered for rent.',f:['acs_vacant_for_rent_share'],fmt:'share',pri:2},
  {key:'p5',label:'Units permitted 5+',help:'Units in 5+ unit buildings permitted in the last 12 months.',f:['bps_units_5plus_12m'],fmt:'units',pri:2},
  {key:'cap',label:'MF cap spread',help:'Asking apartment cap rate minus the 10-year Treasury.',f:['cap_spread_multifamily'],fmt:'pt',pri:2},
  {key:'mmf',label:'Metro MF rent 1\u2011yr',help:'Apartment rent change for the whole metro over 12 months.',ctx:'zm_zori_mf_yoy',fmt:'chg',pri:2}];
 const BEST_ALL=BEST_RES.concat(BEST_MORE,BEST_MF.filter(d=>!BEST_RES.includes(d)));
 const LENSES=[['res','Residential'],['mf','Multifamily']],VIEW_KEY='re:res:view';
 // the lens and More columns are a view choice, stored; anything odd is the Residential lens with the nine columns
 function viewLoad(){const d={lens:'res',more:false};try{const s=JSON.parse(localStorage.getItem(VIEW_KEY)||'null');if(isObj(s)){if(s.lens==='mf')d.lens='mf';d.more=s.more===true}}catch(e){}return d}
 function viewSave(v){try{localStorage.setItem(VIEW_KEY,JSON.stringify({lens:v.lens==='mf'?'mf':'res',more:!!v.more}))}catch(e){}}
 // the columns one answer can fill: a v2 answer names its columns (cols), else the catalog's zips.json columns; a column whose
 // field the build lacks is left out, never drawn empty. A context column shows once any metro carries its value.
 // o: {lens, more, isV2, have: Set of row columns, ctx: Map cbsa -> value}. Returns [{...def, field, label, help}] after the ZIP column
 function bestCols(o){o=isObj(o)?o:{};const mf=o.lens==='mf',defs=mf?BEST_MF:BEST_RES.concat(o.more?BEST_MORE:[]),have=o.have instanceof Set?o.have:new Set(),out=[];
  for(const d of defs){if(d.ctx){if(o.isV2&&o.ctx instanceof Map&&[...o.ctx.values()].some(v=>num(v)!=null))out.push(Object.assign({},d,{field:null}));continue}
   const field=o.isV2?arr(d.f).find(x=>have.has(x)):d.v1&&(!have.size||have.has(d.v1))?d.v1:null;if(!field)continue;
   const a=d.alt&&d.alt[field];out.push(Object.assign({},d,{field},a?{label:a[0],help:a[1]}:{}))}
  return out}
 // the sort a lens ranks by: the saved sort when one of that lens's columns sorts by it, else the lens's lead
 function lensSort(lens,sort){const keys=(lens==='mf'?BEST_MF:BEST_RES.concat(BEST_MORE)).map(d=>d.sort).filter(Boolean);
  return keys.includes(sort)?sort:lens==='mf'?'mf':'score'}
 // the sort a column header asks for: its sort id when the data can rank on it (a v1 answer only on the old aliases)
 const colSort=(c,isV2)=>{const s=c&&c.sort?SORTS.find(x=>x[0]===c.sort):null;return s&&(isV2||s[3])?s[0]:null};
 // the sort id the answer really used: the server echoes the sort it was asked (a column name or alias)
 function sortUsed(f,d,fields){const want=isObj(f)&&f.sort?f.sort:'score',echo=isObj(d)?d.sort:null;if(!echo||echo===sortParam(want,fields))return want;
  const s=SORTS.find(x=>sortParam(x[0],fields)===echo||x[2]===echo||x[3]===echo);return s?s[0]:want}
 const budgetOf=prof=>{const b=isObj(prof)&&isObj(prof.budget)?num(prof.budget.budget):null;return b!=null&&b>0?Math.round(b):null};
 // a budget the read did not bring is not "no budget": with Within budget on, the rank query would lose its cap and the list
 // would widen to every priced area under a control that says a budget is set. The list waits for the budget instead (ReviewSix, #399)
 const budgetUnloaded=st=>!!(st&&st.f&&st.f.within&&budgetOf(st.prof)==null&&st.profFail);
 // the rank query from scope and filters: max price is the lower of the budget (Within budget on) and the typed max
 function rankQuery(sc,f,o){o=o||{};f=f||{};const q=['kind=housing'],sq=DeckScope.query(sc);if(sq)q.push(sq);
  const caps=[f.within?num(o.budget):null,num(f.max)].filter(v=>v!=null&&v>0);if(caps.length)q.push('max_price='+Math.round(Math.min(...caps)));
  const mp=minPopOf(f,sc);if(mp!=null)q.push('min_pop='+mp);
  if(f.grade==='AB')q.push('grade='+encodeURIComponent('A,B'));else if(f.grade==='A')q.push('grade=A');
  q.push('sort='+encodeURIComponent(sortParam(f.sort,o.fields)));
  // a second tap on a sorted header flips it (dir=, v2 only; the server echoes what it used in sort_dir)
  if((f.dir==='asc'||f.dir==='desc')&&v2(o.fields))q.push('dir='+f.dir);
  const cols=rankCols(o.fields);if(cols)q.push('cols='+encodeURIComponent(cols.join(',')));
  if(arr(o.zips).length)q.push('zip='+encodeURIComponent(o.zips.join(',')));
  q.push('limit='+(num(o.limit)||PAGE),'offset='+Math.max(0,Math.round(num(o.offset)||0)));
  return q.join('&')}
 // active filters, as words (never an amount, so the masked budget and max price leak no digit); their number is the
 // Filters button count. The population floor is a filter like any other, the default included: counted and clearable.
 function filterChips(f,o){o=o||{};const c=[];f=f||{};
  if(f.grade)c.push({id:'grade',label:(GRADES.find(g=>g[0]===f.grade)||[])[1]});
  if(f.within)c.push({id:'within',label:o.profFail?'Within budget, not loaded':budgetOf(o.prof)==null?'Set budget':'Within budget'});
  if(num(f.max)!=null)c.push({id:'max',label:'Max price'});
  const mp=minPopOf(f,o.scope);if(mp!=null)c.push({id:'minPop',label:'Min population '+F().count(mp)});
  return c}
 const filterCount=(f,sc)=>filterChips(f,{scope:sc}).length;
 // ZIP: m[metric].c with n sources; rank row: <metric>_conf (a score <x>_score: <x>_conf); rollup (state, metro, US): <metric>_conf,
 // the median ZIP confidence over <metric>_n ZIPs
 function confOf(src,key){if(!isObj(src))return null;const m=isObj(src.m)&&isObj(src.m[key])?src.m[key]:null;
  if(m&&num(m.c)!=null)return {c:m.c,n:num(m.n)};
  const alt=/_score$/.test(key)?key.slice(0,-6)+'_conf':null,c=num(src[key+'_conf'])!=null?src[key+'_conf']:alt&&num(src[alt])!=null?src[alt]:null;
  return c==null?null:{c,zips:num(src[key+'_n'])}}
 const dots=cf=>!cf?'':cf.zips!=null?DeckUI.conf(cf.c,{text:'median of '+F().count(cf.zips)+' ZIPs'}):DeckUI.conf(cf.c,cf.n!=null?{total:cf.n}:{});
 // an area value (blend.area_fallback): the ZIP has no figure of its own, so its county's or metro's stands in. A ZIP record says so
 // in m[k].from, a rank row in from[k]. 'county', 'metro' or ''. It is never shown as the ZIP's own figure: a small tag follows it
 function fromOf(src,k){if(!isObj(src))return '';const m=isObj(src.m)&&isObj(src.m[k])?src.m[k]:null;
  const a=m?(num(m.v)!=null?m.from:''):isObj(src.from)?src.from[k]:'';return a==='county'||a==='metro'?a:''}
 const FROM_TIP={county:'Not this ZIP\u2019s own figure. The ZIP has none, so this is the value for its county.',
  metro:'Not this ZIP\u2019s own figure. The ZIP has none, so this is the value for its metro.'};
const fromTag=a=>a==='county'||a==='metro'?'<small class="re-from" title="'+esc(FROM_TIP[a])+'">'+a+' value</small>':'';
 // ---- strip: one tile per value present; six for every class, four more on D and XL (.dx); TV keeps the first six
 const STRIP=[{k:'home_value',label:'Home value',f:'money',spark:'zhvi'},{k:'value_trend_1y',label:'1-yr change',f:'chg'},{k:'typical_rent',label:'Rent',f:'rent',spark:'rent'},
  {k:'gross_yield',label:'Gross yield',f:'rate'},{k:'days_on_market',label:'Days to sell',f:'days',spark:'redfin_dom'},{k:'mortgage_rate',label:'30-yr rate',f:'rate',single:true},
  {k:'price_cuts',label:'Price cuts',f:'share',dx:true,spark:'redfin_active_price_drop_share'},{k:'redfin_inventory_yoy',label:'Inventory',f:'chg',dx:true,single:true,sub:'1-yr change'},
  {k:'affordability',label:'Payment to income',f:'share',dx:true},{k:'value_forecast_1y',label:'12-mo outlook',f:'chg',dx:true}];
 // the owner's nine best-ZIP data points (2026-11-17), in his order: the ZIP sheet's top strip; a missing one is named once under it
 const NINE=[['home_value','Home value','money'],['value_trend_1y','1-yr change','chg'],['typical_rent','Rent','rent'],['gross_yield','Gross yield','rate'],
  ['days_on_market','Days to sell','ndays'],['mortgage_rate','30-yr rate','rate'],['price_cuts','Price cuts','share'],['inventory','Inventory','homes'],['affordability','Payment to income','share']];
 function fmtVal(kind,v){const x=num(v);if(x==null)return null;const f=F();
  // a count names what it counts, joined to the figure with a no-break space so the two never part; one of a thing is singular
  const n=(word,y)=>({value:f.count(y),unit:'\u00a0'+(y===1?word:word+'s')});
  switch(kind){case 'money':return {value:f.money(x)};case 'rent':return {value:f.money(x),unit:'/mo'};case 'rate':return {value:f.rate(x)};case 'share':return {value:f.share(x)};
   case 'chg':return {value:f.chg(x)};case 'days':return {value:f.count(Math.round(x))};case 'count':return {value:f.count(x)};case 'score':return {value:String(Math.round(x))};
   case 'num1':return {value:(Math.round(x*10)/10).toLocaleString('en-US')};case 'cents':return {value:(Math.round(x*10)/10)+'\u00a2',unit:'/kWh'};case 'pctile':return {value:String(Math.round(x))};
   case 'ndays':return n('day',Math.round(x));case 'homes':return n('home',x);
   case 'units':return n('unit',x);case 'loans':return n('loan',x);case 'people':return {value:f.count(x),unit:'\u00a0'+(x===1?'person':'people')};
   case 'households':return n('household',x);case 'contracts':return n('contract',x);case 'pt':return {value:f.pt(x)};
   default:return {value:String(x)}}}
 // src: {row} a rollup (state, metro, US) or a ZIP record (with m and hist); summary gives the 30-yr rate when the row has none.
 // o.rate15 is /api/realestate market.mortgage.rate_15y: it rides under the 30-yr rate (an eleventh tile would leave the D strip's
 // last row short); o.known says that feed has answered, so a missing 15-yr rate reads "No data" instead of nothing.
 function stripModel(src,summary,o){const row=isObj(src)?src:{},tiles=[];o=isObj(o)?o:{};
  const r15=isObj(o.rate15)?num(o.rate15.value):null,f15=fmtVal('rate',r15);
  for(const t of STRIP){let v=num(row[t.k]),label=t.label,sub=t.sub||'';
   if(v==null&&t.k==='mortgage_rate'&&isObj(summary)&&isObj(summary.mortgage))v=num(summary.mortgage.rate_30y);
   if(t.k==='mortgage_rate'){if(v==null&&f15){v=r15;label='15-yr rate'}else if(f15)sub='15-yr '+f15.value;else if(o.known)sub='15-yr: No data'}
   const fv=fmtVal(t.f,v);if(!fv)continue;
   const h=t.spark&&isObj(row.hist)?arr(row.hist[t.spark]).filter(p=>Array.isArray(p)&&p.length>1).slice(-24).map(p=>num(p[1])):null;
   tiles.push(Object.assign({key:t.k,label,value:fv.value,unit:fv.unit||'',conf:t.single?null:confOf(row,t.k),dx:!!t.dx,sub,spark:h&&h.filter(x=>x!=null).length>1?h:null},fromOf(row,t.k)?{from:fromOf(row,t.k)}:{}))}
  return tiles}
 const rate15Of=re=>isObj(re)&&isObj(re.market)&&isObj(re.market.mortgage)&&isObj(re.market.mortgage.rate_15y)?re.market.mortgage.rate_15y:null;
 // ---- the state map: five quantile bins, brighter is better (a lower-is-better metric flips the ramp), hatched without data
 const MAP=[['score','Score','h_score','score','higher'],['value_1y','Value 1-yr','value_trend_1y','chg','higher'],['yield','Gross yield','gross_yield','rate','higher'],
  ['rent_1y','Rent 1-yr','rent_trend_1y','chg','higher'],['days','Days to sell','days_on_market','days','lower']];
 const mapDef=k=>MAP.find(m=>m[0]===k)||MAP[0];
 function quantEdges(vals){const v=vals.filter(x=>x!=null).sort((a,b)=>a-b);if(v.length<5)return null;return [.2,.4,.6,.8].map(p=>v[Math.min(v.length-1,Math.floor(p*v.length))])}
 // the tile's small figure and the legend edges: one decimal for rates and changes, whole numbers for scores and days
 const SHORT={score:v=>String(Math.round(v)),chg:v=>(v>0?'+':v<0?'\u2212':'')+Math.abs(v).toFixed(1),rate:v=>v.toFixed(1),days:v=>String(Math.round(v))};
 function mapModel(states,key){const d=mapDef(key),rows=arr(states).filter(s=>isObj(s)&&typeof s.state==='string'),vals=rows.map(s=>num(s[d[2]])),edges=quantEdges(vals),sh=SHORT[d[3]];
  const bin=v=>{if(v==null||!edges)return 'x';let q=1;for(const e of edges)if(v>=e)q++;return String(d[4]==='lower'?6-q:q)};
  const items=rows.map(s=>{const v=num(s[d[2]]),fv=fmtVal(d[3],v);return {st:s.state.toUpperCase(),name:String(s.name||DeckScope.STATES[s.state]||s.state),value:v,
   text:fv?fv.value:'',short:v==null?'':sh(v),q:bin(v)}});
  return {key:d[0],label:d[1],col:d[2],better:d[4],edges,fmt:sh,items}}
 // ---- ranked areas: States (US scope), Metros in the state (state scope, Your markets in California), none in a metro scope.
 // metros: undefined = not read yet (the list holds its place with ten loading rows), null = the read failed, else the rows.
 // A bar means a value (SeeViz V1): it runs from zero to 100 for the score, else to the largest value in the list; a value of
 // zero or less draws no bar. Metro names read short ("Los Angeles, CA", the scope button's form) so a row is one line at every
 // size and the loading rows hold the list's real height; the full name is the row's title.
 const AREA_ROWS=10;
 function areasModel(sc,states,metros,key){const d=mapDef(key),s=DeckScope.norm(sc);if(s.kind==='metro')return null;
  const st=s.kind==='state'?s.state:s.kind==='mine'?DeckScope.HOME_STATE:'';
  const head={title:st?'Metros in '+DeckScope.STATES[st]:'States',kind:st?'metro':'state',metric:d[1]};
  if(st&&metros===undefined)return Object.assign(head,{loading:true,rows:[]});
  if(st&&metros===null)return Object.assign(head,{failed:true,rows:[]});
  if(!st&&!Array.isArray(states))return null;
  const src=st?arr(metros).filter(m=>isObj(m)&&DeckScope.metroStates(m.name).includes(st)):arr(states).filter(isObj);
  const dir=d[4]==='lower'?1:-1,rows=src.filter(r=>num(r[d[2]])!=null).sort((a,b)=>dir*(r0(a,d)-r0(b,d))).slice(0,AREA_ROWS);
  const top=d[0]==='score'?100:Math.max(0,...rows.map(r=>r0(r,d)));
  // a bar that is not a 0 to 100 score says its scale once, in the list's head ("Gross yield · bars 0 to 9.54%")
  const scaleText=d[0]==='score'||!(top>0)?'':fmtVal(d[3],top).value+(d[3]==='days'?' days':'');
  return Object.assign(head,{scale:top,scaleText,
   rows:rows.map((r,i)=>{const v=num(r[d[2]]),hv=fmtVal('money',r.home_value),ch=fmtVal('chg',r.value_trend_1y),y=fmtVal('rate',r.gross_yield);
    const bar=v>0&&top>0?Math.max(4,Math.round(100*Math.min(v,top)/top)):0,full=st?String(r.name):String(r.name||r.state);
    return {n:i+1,key:st?String(r.name):String(r.state),name:st?DeckScope.metroShort(full):full,full,fig:fmtVal(d[3],v).value,
     sub:[hv&&hv.value,ch&&ch.value+' 1-yr',y&&y.value+' yield'].filter(Boolean).join(' \u00b7 '),bar}})})}
 const r0=(r,d)=>num(r[d[2]]);
 // ---- Your markets: the owner's ZIPs (national values from rank zip=), then the three counties and the US. A county or the US row
 // carries its feed slug: it opens that area's sheet (a ZIP row opens the ZIP sheet, which shows the same area numbers)
 const areasOf=re=>arr(isObj(re)&&isObj(re.market)&&isObj(re.market.residential)?re.market.residential.areas:null).filter(isObj);
 const slugOk=s=>typeof s==='string'&&/^[a-z0-9-]{1,60}$/.test(s)?s:'';
 function mineModel(re,zipRows,summary){const areas=areasOf(re);
  const byZip=new Map(arr(zipRows).filter(isObj).map(r=>[String(r.zip),r])),rows=[];
  for(const a of areas){if(a.level==='zip'&&/^\d{5}$/.test(String(a.zip))){const r=byZip.get(String(a.zip));
    rows.push(r?{zip:a.zip,name:a.zip+' '+(r.city||a.name||''),value:r.home_value,chg:r.value_trend_1y,rent:r.typical_rent,days:r.days_on_market,conf:confOf(r,'home_value'),
     daysWord:fromOf(r,'days_on_market')?'days to sell, '+fromOf(r,'days_on_market')+' value':''}
     // without its national row the feed's own number stands, with its own word: Realtor's days listed, never "days to sell"
     :{zip:a.zip,name:a.zip+' '+(a.name||''),value:isObj(a.zhvi)?a.zhvi.value:null,chg:isObj(a.zhvi)?a.zhvi.yoy_pct:null,rent:null,days:num(a.days_on_market),daysWord:'days listed'})}
   else if(a.level==='county')rows.push({name:String(a.name||''),slug:slugOk(a.slug),value:isObj(a.zhvi)?a.zhvi.value:null,chg:isObj(a.zhvi)?a.zhvi.yoy_pct:null,rent:null,
    days:isObj(a.days_to_pending)?a.days_to_pending.value:null,daysWord:'days to pending'})}
  const us=isObj(summary)&&isObj(summary.us)?summary.us:null,usA=areas.find(a=>a.level==='us');
  if(us)rows.push({name:'United States',slug:usA?slugOk(usA.slug):'',value:us.home_value,chg:us.value_trend_1y,rent:us.typical_rent,days:us.days_on_market,conf:confOf(us,'home_value')});
  return rows}
 // one area's own numbers from the feed: value, homes for sale, list and sale price, days to pending, each with its 1-yr change and
 // month. A ZIP's feed row has listing counts, a list price and days on market from a second source when the first has none.
 const AREA_ITEMS=[['zhvi','Home value','money'],['inventory','Homes for sale','count',['active_listings','realtor_as_of']],['list_price','List price','money',['realtor_list_price','realtor_as_of']],
  ['sale_price','Sale price','money'],['days_to_pending','Days to pending','days',['days_on_market','realtor_as_of','Days on market']]];
 function areaModel(a,o){if(!isObj(a))return null;o=isObj(o)?o:{};const f=F(),items=[],missing=[];
  const mo=s=>/^\d{4}-\d{2}/.test(String(s||''))?f.month(String(s).slice(0,7)):'';
  for(const [k,label,kind,alt] of AREA_ITEMS){if(k==='zhvi'&&o.value===false)continue;
   const s=isObj(a[k])?a[k]:null;let v=s?num(s.value):null,when=s?mo(s.as_of):'',chg=s?num(s.yoy_pct):null,lab=label;
   if(v==null&&alt&&num(a[alt[0]])!=null){v=a[alt[0]];when=mo(a[alt[1]]);chg=null;if(alt[2])lab=alt[2]}
   const fv=fmtVal(kind,v);if(!fv){missing.push(label);continue}
   const c=fmtVal('chg',chg);items.push({key:k,label:lab,value:fv.value,line:[c?c.value+' 1-yr':'',when].filter(Boolean).join(' \u00b7 ')})}
  const lv={zip:'ZIP '+String(a.zip||''),county:'County',us:'Nationwide'}[a.level]||'';
  return {slug:slugOk(a.slug),title:String(a.name||'').slice(0,60)||'Area',sub:lv,items,missing}}
 const areaBySlug=(re,slug)=>areasOf(re).find(a=>slugOk(a.slug)&&a.slug===slug)||null;
 const areaByZip=(re,zip)=>areasOf(re).find(a=>a.level==='zip'&&String(a.zip)===String(zip))||null;
 // ---- homes for sale: scope, type, beds, a city word, a max price step and a sort; 12 rows, then 12 more
 function homesQuery(sc,hf,offset){const q=[],sq=DeckScope.query(sc);if(sq)q.push(sq);hf=hf||{};
  if(hf.type)q.push('type='+encodeURIComponent(hf.type));if(num(hf.beds)!=null&&hf.beds>0)q.push('beds='+Math.round(hf.beds));
  if(typeof hf.q==='string'&&hf.q.trim())q.push('q='+encodeURIComponent(hf.q.trim().slice(0,60)));
  if(num(hf.max)!=null&&hf.max>0)q.push('max_price='+Math.round(hf.max));
  const so=['feed','price','newest','ppsf'].includes(hf.sort)?hf.sort:'feed';
  q.push('sort='+so,'limit='+HOMES,'offset='+Math.max(0,Math.round(num(offset)||0)));return q.join('&')}
 const postedEpoch=v=>{if(num(v)!=null)return v>1e12?v/1000:v;if(typeof v==='string'&&v.trim()){const p=Date.parse(v);return isFinite(p)?p/1000:null}return null};
function homeRow(x,now){if(!isObj(x))return null;const f=F(),p=num(x.price),sq=num(x.sqft)>=100?x.sqft:null,beds=num(x.beds)>0?x.beds:null,baths=num(x.baths)>0?x.baths:null;
  // a price is known only when the row says USD (deck.js listPrice): a missing currency is unknown, never dollars
  const price=p!=null&&p>=10000&&String(x.currency||'').toUpperCase()==='USD'?p:null;
  // an auction.com row's price is the auction's starting bid: labelled, and never turned into a price per square foot
  // a public-sector row (`kind`: Tax sale, Surplus land, State surplus) carries a minimum bid the same way; a sale the collector says was held is over
  const bid=String(x.source||'').toLowerCase()==='auction.com'||x.auction_at!=null||String(x.kind||'').trim()!=='',held=String(x.sale_status||'').toLowerCase()==='held';
  // listed_at is a source's own posted time: epoch seconds, epoch milliseconds or an ISO string (Alexandria's publishedAt); anything else is unknown (same reading as ui-core toEpoch)
  const t=postedEpoch(x.listed_at),days=t!=null&&t>0&&t<=now/1000+300?Math.floor((now/1000-t)/86400):null;
  return {title:[price!=null?(bid?(String(x.kind||'').trim()?'Minimum bid ':'Opening bid '):'')+f.money(price):'Price not listed',[beds!=null?beds+' BR':'',baths!=null?baths+' BA':''].filter(Boolean).join(' ')].filter(Boolean).join(' \u00b7 '),
   sub:[String(x.city||'').slice(0,30),bid?String(x.sale_kind||x.kind||'').slice(0,30):'',sq!=null?f.count(sq)+' SF':'',price!=null&&sq!=null&&!bid?f.money(Math.round(price/sq))+'/SF':'',days!=null?(days===1?'1 day listed':days+' days listed'):'',String(x.type||'').slice(0,20),x.stale===true?'stale':'',held?'sale held':''].filter(Boolean).join(' \u00b7 '),
   cut:x.price_cut===true||x.price_reduced===true||num(x.price_cut)>0,url:typeof x.url==='string'&&/^https:\/\//.test(x.url)?x.url:''}}
 // ---- pro forma at ZIP medians (moved from the old Housing page; math unchanged): price and rent from the ZIP, financing from the profile
 const PF_VAC=0.05,PF_OPEX=0.40;
 const pos=v=>{const n=num(v);return n!=null&&n>0?n:null};
 function proForma(rec,prof,summary){rec=isObj(rec)?rec:{};const v2r=rec.dataset==='v2';
  const price=v2r?pos(rec.home_value):(pos(rec.zhvi)!=null?pos(rec.zhvi):pos(rec.list_price)!=null&&num(rec.active)!=null&&rec.active>=10?pos(rec.list_price):null),rent=v2r?pos(rec.typical_rent):pos(rec.rent);
  if(price==null||rent==null)return null;
  const p=isObj(prof)&&isObj(prof.profile)?prof.profile:{},d=num(p.down_pct),c=num(p.closing_pct),down_pct=d!=null&&d>0&&d<=1?d:0.25,closing_pct=c!=null&&c>=0&&c<1?c:0.03;
  const r1=isObj(prof)&&isObj(prof.budget)&&isObj(prof.budget.rate)?pos(prof.budget.rate.rate_used):null,r2=isObj(summary)&&isObj(summary.mortgage)?pos(summary.mortgage.rate_30y):null,rate=r1!=null?r1:r2;
  const gsr=12*rent,vacancy=gsr*PF_VAC,egi=gsr-vacancy,opex=egi*PF_OPEX,noi=egi-opex,loan=price*(1-down_pct),cash_in=price*down_pct+price*closing_pct;
  let ads=null,dscr=null,cash_flow=null,coc=null;
  if(rate!=null){const r=rate/1200,k=r/(1-Math.pow(1+r,-360));ads=loan*k*12;dscr=ads>0?noi/ads:null;cash_flow=noi-ads;coc=100*cash_flow/cash_in}
  return {price,rent,down_pct,closing_pct,rate,gsr,vacancy,egi,opex,noi,cap:100*noi/price,loan,ads,dscr,cash_flow,cash_in,coc,grm:price/gsr}}
 // ---- the budget profile form (moved from the old Housing page): [field, label, kind]; pct shows a percent and saves a fraction
 const PF=[['income_annual','Income per year','usd'],['co_income_annual','Co-borrower income per year','usd'],['monthly_debt','Monthly debt payments','usd'],
  ['down_pct','Down payment','pct'],['closing_pct','Closing costs','pct'],['dti_max','Max debt to income','pct'],['tax_ins_rate','Tax and insurance per year','pct'],
  ['rate_adj','Rate adjustment','pt'],['cash_manual','Cash entered by hand','usd'],['income_src','Income source','text'],['income_asof','Income as of','date']];
 const PF_UNIT={usd:' ($)',pct:' (%)',pt:' (points)'};
 function pfBody(vals){const v=isObj(vals)?vals:{},out={};
  for(const [k,label,t] of PF){if(!(k in v))continue;const raw=String(v[k]==null?'':v[k]).trim();
   if(t==='text'||t==='date'){out[k]=raw===''?null:raw;continue}
   if(raw===''){if(k==='income_annual'||k==='cash_manual')out[k]=null;continue}
   const n=Number(raw);if(!isFinite(n))return {error:'Check '+label.toLowerCase()};out[k]=t==='pct'?Math.round(n*1e4)/1e6:n}
  if(v.cash_mode==='auto'||v.cash_mode==='manual')out.cash_mode=v.cash_mode;
  return {body:out}}
 function pfForm(prof){const p=isObj(prof&&prof.profile)?prof.profile:{},mode=p.cash_mode==='manual'?'manual':'auto';
  const val=(k,t)=>{const v=p[k];if(t==='pct')return num(v)==null?'':String(+(v*100).toFixed(3));if(t==='usd'||t==='pt')return num(v)==null?'':String(v);return typeof v==='string'?v:''};
  return '<form class="re-pf" data-re-pf>'+PF.map(([k,l,t])=>'<label class="field">'+esc(l+(PF_UNIT[t]||''))+'<input name="'+k+'" '+(t==='text'?'type="text" maxlength="300"':t==='date'?'type="date"':'type="number" inputmode="decimal" step="any"')+' value="'+esc(val(k,t))+'"></label>').join('')+
   '<label class="field">Cash source<select name="cash_mode"><option value="auto"'+(mode==='auto'?' selected':'')+'>Money feed: cash and brokerage</option><option value="manual"'+(mode==='manual'?' selected':'')+'>Entered by hand</option></select></label>'+
   '<p class="note" role="status" data-re-pf-msg></p></form>'}
 // ---- ZIP sheet model: eleven sections; an item with no value is named once in its section's missing line; a section with nothing is absent
 // [field, label, format, blended]: blended items carry their dots from m
 const SECTIONS=[
  ['value','Value and rent',[['value_trend_5y','Value, 5-yr','chg',1],['value_forecast_1y','12-mo outlook','chg',1],['rent_trend_1y','Rent, 1-yr','chg',1],['safmr_2br','Fair market rent, 2 BR','rent'],
   ['zillow_zhvi_bottom','Low tier value','money'],['zillow_zhvi_top','High tier value','money'],['zillow_zhvi_condo','Condo value','money'],['zillow_zhvi_3br','3 BR value','money']]],
  ['market','Market',[['inventory','Homes for sale','count',1],['redfin_new_listings','New listings, 3 months','count'],['days_on_market','Days to sell','days',1],['dom','Days listed','days'],
   ['sale_to_list','Sale to list','share',1],['redfin_sold_above_list','Sold above list','share'],['price_cuts','Price cuts','share',1],['redfin_price_drop_size','Size of a price cut','share'],
   ['redfin_cancel_rate','Cancellations','share'],['market_heat','Market heat','score',1]]],
  // multifamily (owner order 2026-11-17): unit mix, renters, rent by bedrooms, vacancy, new supply, cap spread, assisted homes and
  // loan maturity signals. Fields the build does not carry are left out entirely (zipModel), so the line names real gaps only
  ['mf','Multifamily',[['multifamily_score','Multifamily score','score',1],['acs_units_2_4_share','Homes in 2 to 4 unit buildings','share'],['acs_units_5plus_share','Homes in 5+ unit buildings','share'],
   ['acsmf_units_50plus_share','Homes in 50+ unit buildings','share'],['renter_share','Renters','share'],['acsmf_renter_5plus_share','Renters in 5+ unit buildings','share'],['acsmf_renter_hh','Renter households','households'],
   ['acsmf_rent_0br','Rent, studio','rent'],['acsmf_rent_1br','Rent, 1 BR','rent'],['acsmf_rent_2br','Rent, 2 BR','rent'],['acsmf_rent_3br','Rent, 3 BR','rent'],
   ['acs_vacant_for_rent_share','Vacant for rent','share'],['bps_units_5plus_12m','Units permitted in 5+ unit buildings, 12 months','units'],['bps_units_2_4_12m','Units permitted in 2 to 4 unit buildings, 12 months','units'],
   ['cap_spread_multifamily','Apartment cap spread','pt'],['crel_cap_multifamily','Apartment asking cap rate','rate'],
   ['fha_mf_units','FHA-insured apartment homes','homes'],['hud_assisted_units','Federally assisted apartment homes','homes'],['lihtc_units','Tax credit affordable homes','homes'],
   ['hud_contracts_expiring_5y','Assistance contracts ending within 5 years','contracts'],['lihx_units_expiring_5y','Tax credit homes leaving 15-year rules within 5 years','homes'],
   ['lihx_units_year30_5y','Tax credit homes ending 30-year use within 5 years','homes'],['fham_loans_maturing_2y','FHA apartment loans maturing within 2 years','loans'],
   ['fham_loans_maturing_5y','FHA apartment loans maturing within 5 years','loans'],['fham_units_maturing_5y','Homes under FHA loans maturing within 5 years','homes'],
   ['fham_upb_maturing_5y','FHA loan balance maturing within 5 years','money'],['fhae_units_5y','Homes in new FHA apartment loans, 5 years','homes'],['fhae_refi_loans_5y','FHA apartment refinance loans, 5 years','loans']]],
  ['people','People',[['population','Population','count',1],['median_age','Median age','num1'],['income','Household income','money',1],['owner_share','Owners','share'],['renter_share','Renters','share'],
   ['acs_moved_1y_share','Moved in last year','share'],['pep_domestic_mig_per_1k','Net moves per 1,000 people','num1'],['acs_bachelor_plus','Bachelor\u2019s or higher','share'],['acs_commute_45plus_share','Commute 45 min or more','share']]],
  ['jobs','Jobs',[['unemployment','Unemployment','share',1],['jobs_trend','Jobs, 1-yr','chg',1],['qcew_avg_wkly_wage','Weekly wage','money'],['jobs_total','Jobs in this ZIP','count',1],
   ['estabs_per_1k','Businesses per 1,000 people','num1']]],
  ['schools','Schools',[['schools','School score','score',1],['school_score','School quality score','score'],['schools_5mi','Public schools within 5 mi','count'],['colleges_5mi','Colleges within 5 mi','count'],
   ['college_enroll_5mi','College students within 5 mi','count'],['colleges_10mi','Colleges within 10 mi','count'],['college_enroll_10mi','College students within 10 mi','count']]],
  ['risk','Risk',[['nri_eal_rate_bldg','Expected loss per $100 of value','rate'],['nfip_claims_10y','Flood claims, 10 years','count'],['nfip_premium_avg','Flood premium','money'],
   ['fema_disasters_10y','Disasters, 10 years (county)','count'],['homicide_rate','Homicides per 100,000 (county)','num1'],['health','Health index','score',1],['aqi_median','Air quality index (county)','num1']]],
  ['costs','Costs',[['acs_re_tax_median','Property tax','money'],['property_tax_rate','Effective tax rate','rate',1],['affordability','Payment to income','share',1],['acs_owner_cost_pct_income','Owner costs share of income','share'],
   ['openei_res_cents','Electricity rate','cents']]],
  ['lending','Lending',[['hmda_purchase_loans','Home loans','count'],['hmda_avg_loan','Average loan','money'],['hmda_denial_rate','Denial rate','share'],['acs_mortgage_share','Owners with a mortgage','share']]]];
 // risk meters: national percentile scores, each a plain bar from 0 to 100 with its value named ("Flood 96"); no band or median
 // tick, which were fixed numbers and read as data (SeeViz V16). One 0 and 100 scale sits under the bars. A value outside 0 to
 // 100 is not a score: it reads "No data" and draws no bar, never a bar moved to a bound (decision 9)
 const RISK_BARS=[['nri_flood_score','Flood'],['nri_wildfire_score','Fire'],['nri_heat_score','Heat'],['nri_quake_score','Quake'],['nri_wind_score','Wind']];
 function riskHtml(bars){const l=arr(bars).filter(x=>isObj(x)&&num(x.v)!=null);if(!l.length)return '';
  return '<div class="re-risks">'+l.map(x=>{if(x.v<0||x.v>100)return '<div class="re-risk"><span>'+esc(x.label)+' <b>'+esc(F().na('sheet'))+'</b></span><span></span></div>';const v=Math.round(x.v);
   return '<div class="re-risk"><span>'+esc(x.label)+' <b>'+v+'</b></span><span class="bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+v+'" aria-label="'+esc(x.label+' risk '+v+' of 100')+'"><i style="--v:'+v+'%"></i></span></div>'}).join('')+
   '<div class="re-risk re-risk-l" aria-hidden="true"><span></span><span class="range-l"><span>0</span><span>100</span></span></div></div>'}
 // a metric the national build rejected arrives as m[k] = {v: null, reason, from}; its reason reads in plain words on the
 // "Not reported" line ("Days to sell (too few listings)"). Only the build's own five reasons print; anything else is a plain missing.
 const WHY=['too few listings','no listing count','placeholder value','seasonal rentals','out of range'];
 function whyOf(rec,k){const m=isObj(rec)&&isObj(rec.m)&&isObj(rec.m[k])?rec.m[k]:null;if(!m||m.v!=null||typeof m.reason!=='string')return '';
  const r=m.reason.trim().toLowerCase();return WHY.includes(r)?r:''}
 const missName=(rec,k,label)=>{const w=whyOf(rec,k);return w?label+' ('+w+')':label};
 // a raw member row (Days listed from dom) behind a rejected metric never prints its number: it joins the line with the metric's
 // reason only when that member's own value fails the metric's limits (manifest metrics[id].limits) or it is the input named in
 // `from`: HUD's 2 BR fair market rent beside a rejected Zillow rent is sound and keeps its number. members maps a field to its
 // metric and limits a metric to its checks (part=metrics, read when a ZIP sheet opens); without them the rows draw as they are
 const reasonWord=r=>{const s=typeof r==='string'?r.trim().toLowerCase():'';return WHY.includes(s)?s:''};
 // the blend's own checks (blend.py invalid()): a population scope, the least homes for sale, then the range
 function failsLimits(lims,v,rec){const x=num(v);if(x==null)return false;const inv=num(rec.inventory),pop=num(rec.population)!=null?rec.population:(num(rec.pop)||0);
  for(const c of arr(lims).filter(isObj)){if(pop<(num(c.if_pop_at_least)||0)||(num(c.if_pop_below)!=null&&pop>=c.if_pop_below))continue;
   if(num(c.min_listings)!=null&&(inv==null||inv<c.min_listings))return true;
   if((num(c.min)!=null&&x<c.min)||(num(c.max)!=null&&x>c.max))return true}
  return false}
 // without the limits (members not read yet, or the read failed) a member of a rejected metric is hidden: it cannot be checked
 function memberWhy(rec,mid,k,v,limits){const w=mid&&mid!==k?whyOf(rec,mid):'';if(!w)return '';const m=rec.m[mid];
  if(m.from===k||!(limits instanceof Map))return w;const L=limits.get(mid);return !L||failsLimits(L,v,rec)?w:''}
 // the sheet's rows that are members of a metric (v2 manifest, ReviewFour B1): used until part=metrics lands, or when it never does,
 // so no raw figure shows beside a rejected metric even then
 const MEMBERS_KNOWN=new Map([['dom','days_on_market'],['safmr_2br','typical_rent'],['zhvi_yoy','value_trend_1y'],['zhvi_5y','value_trend_5y'],
  ['price_cut_share','price_cuts'],['redfin_cancel_rate','market_heat'],['pop','population'],['hh_income','income'],['homicide_rate','safety'],
  ['school_score','schools'],['aqi_median','health'],['nri_flood_score','flood_risk'],['nfip_premium_avg','insurance_cost'],['nri_eal_rate_bldg','insurance_cost'],
  ['fema_disasters_10y','climate_risk'],['pep_domestic_mig_per_1k','migration'],['qcew_avg_wkly_wage','wages']]);
 function itemsOf(rec,list,members,limits){const items=[],missing=[],mm=members instanceof Map?members:MEMBERS_KNOWN;
  for(const [k,label,f,bl] of list){const mid=mm.get(k),mw=memberWhy(rec,mid,k,rec[k],limits);
   if(mw){missing.push(label+' ('+mw+')');continue}
   const fv=fmtVal(f,rec[k]);if(fv)items.push(Object.assign({key:k,label,value:fv.value+(fv.unit||''),conf:bl?confOf(rec,k):null},fromOf(rec,k)?{from:fromOf(rec,k)}:{}));else missing.push(missName(rec,k,label))}
  return {items,missing}}
 // a history line sits only beside a value the sheet shows: a v2 record whose metric is not reported draws no line for it
 // (2,203 ZIPs had days to sell nulled for too few listings and still drew a year of it)
 const LINE_OF={zhvi:'home_value',rent:'typical_rent',inventory:'inventory',dom:'days_on_market'};
 const lineOk=(rec,k)=>!(isObj(rec)&&isObj(rec.m)&&num(rec[LINE_OF[k]])==null);
 // Your market's feed items, the national metric each one stands beside, and the feed's second-source column an item falls back to
 const AREA_METRIC={inventory:'inventory',sale_price:'home_value',days_to_pending:'days_on_market'};
 const AREA_ALT={inventory:'active_listings',days_to_pending:'days_on_market'};
 function zipModel(rec,o){o=o||{};if(!isObj(rec))return {state:'bad',line:'The deck did not answer.'};
  if(rec.error)return {state:rec.error==='unknown zip'?'unknown':'bad',line:rec.error==='unknown zip'?'No record for this ZIP.':'That did not load.'};
  if(rec.status==='not_reporting')return {state:'stale',line:'Real estate data is not reporting.'};
  const zip=String(rec.zip||'').slice(0,5),place=[rec.city,rec.state].filter(Boolean).join(', ');
  const score=num(rec.h_score),grade=/^[ABCD]$/.test(String(rec.area_grade||''))?rec.area_grade:null;
  // the owner's nine data points lead the sheet in his order; the 30-yr rate is national (the summary's when the record has none)
  const mr=num(rec.mortgage_rate)!=null?rec.mortgage_rate:isObj(o.summary)&&isObj(o.summary.mortgage)?num(o.summary.mortgage.rate_30y):null;
  const tiles=[],headWhy=[];
  for(const [k,l,f] of NINE){const v=k==='mortgage_rate'?mr:rec[k],fv=fmtVal(f,v);
   if(fv)tiles.push(Object.assign({key:k,label:l,value:fv.value,unit:fv.unit||'',conf:k==='mortgage_rate'?null:confOf(rec,k)},fromOf(rec,k)?{from:fromOf(rec,k)}:{}));else headWhy.push(missName(rec,k,l))}
  const sections=[];const h=isObj(rec.hist)?rec.hist:isObj(o.hist)?o.hist:{};
  // one of the owner's ZIPs: its own feed numbers (homes for sale, list and sale price, days) lead the sheet; the value is the headline's
  // the same rule holds for the feed's own numbers: days to pending and Realtor days on market feed days to sell, the sale price
  // feeds the home value, homes for sale is its own metric; a rejected metric takes them to the line with its reason
  const am=areaModel(o.area,{value:false});
  if(am){const out=[];am.items=am.items.filter(x=>{const area=isObj(o.area)?o.area:{},s=isObj(area[x.key])?area[x.key]:null,v=s?num(s.value):null;
    const w=AREA_METRIC[x.key]?memberWhy(rec,AREA_METRIC[x.key],x.key,v!=null?v:num(area[(AREA_ALT[x.key]||'')]),o.limits):'';if(w)out.push(x.label+' ('+w+')');return !w});am.missing=am.missing.concat(out)}
  if(am&&am.items.length)sections.push({id:'mine',title:'Your market',area:am,items:[],missing:am.missing});
  // the multifamily rows: a field the build carries (catalog or record) only; the metro's apartment rent change rides on the row's metro
  const known=k=>(o.cat instanceof Map&&o.cat.has(k))||Object.prototype.hasOwnProperty.call(rec,k);
  for(const [id,title,list0] of SECTIONS){const list=id==='mf'?list0.filter(([k])=>known(k)):list0,{items,missing}=itemsOf(rec,list,o.members,o.limits),s={id,title,items,missing};
   if(id==='mf'&&o.mfCtx instanceof Map&&rec.cbsa!=null){const fv=fmtVal('chg',o.mfCtx.get(String(rec.cbsa)));if(fv)items.push({key:'metro_mf_rent_1y',label:'Metro apartment rent, 1-yr',value:fv.value,conf:null})}
   if(id==='value'){const ser=arr(h.zhvi).filter(p=>Array.isArray(p)&&num(p[1])!=null);if(ser.length>1&&lineOk(rec,'zhvi'))s.line={label:'Home value',series:ser,f:'money'};
    const rs=arr(h.rent).filter(p=>Array.isArray(p)&&num(p[1])!=null);if(rs.length>1&&lineOk(rec,'rent'))s.line2={label:'Rent',series:rs,f:'rent'}}
   if(id==='market'){const inv=arr(h.redfin_inventory).length>1?h.redfin_inventory:h.active,ser=arr(inv).filter(p=>Array.isArray(p)&&num(p[1])!=null);
    if(ser.length>1&&lineOk(rec,'inventory'))s.line={label:'Homes for sale',series:ser,f:'count'};const ds=arr(h.redfin_dom).filter(p=>Array.isArray(p)&&num(p[1])!=null);if(ds.length>1&&lineOk(rec,'dom'))s.line2={label:'Days to sell',series:ds,f:'days'}}
   if(id==='risk'){s.bars=RISK_BARS.filter(([k])=>num(rec[k])!=null).map(([k,l])=>({key:k,label:l,v:rec[k]}));s.missing=s.missing.concat(RISK_BARS.filter(([k])=>num(rec[k])==null).map(x=>x[1]+' risk'))}
   if(s.items.length||s.line||(s.bars&&s.bars.length))sections.push(s)}
  // rental grade: factor, value, points, weight; an unscored factor says so
  const gm=isObj(o.summary)&&isObj(o.summary.grade_method)?o.summary.grade_method:null,gp=isObj(rec.grade_parts)?rec.grade_parts:{},cat=o.cat||new Map();
  const factors=arr(gm&&gm.factors).filter(x=>isObj(x)&&x.key);
  // a grade factor reads its own part: a part that arrives null with a reason prints the missing form with it, never the raw column
  if(grade||factors.some(x=>isObj(gp[x.key]))){const rows=factors.map(x=>{const p=isObj(gp[x.key])?gp[x.key]:{},v='value' in p?p.value:rec[x.key],c=cat.get(x.key);
    const fv=fmtVal(c&&c.unit==='usd'?'money':c&&/pct/.test(c.unit||'')?'num1':'num1',v);
    return {key:x.key,label:c&&c.label?c.label:String(x.key).replace(/_/g,' '),value:fv?fv.value+(c&&c.unit==='pct'?'%':''):null,why:fv?'':reasonWord(p.reason),points:num(p.points)==null?null:Math.round(p.points),weight:num(x.weight)==null?null:Math.round(x.weight*1000)/10}});
   sections.push({id:'grade',title:'Rental grade',grade,areaScore:num(rec.area_score),factors:rows,items:[],missing:[]})}
  const pf=proForma(rec,o.prof,o.summary);if(pf)sections.push({id:'proforma',title:'Pro forma',pf,items:[],missing:[]});
  const L=rec.listings;sections.push({id:'homes',title:'Homes for sale here',listings:isObj(L)&&L.status!=='unavailable'?arr(L.homes||L.listings||L.items).filter(isObj):null,items:[],missing:[]});
  return {state:'ok',zip,title:zip+(place?' '+place:''),place:[rec.county,rec.metro].filter(Boolean),
   coord:num(rec.lat)!=null&&num(rec.lon)!=null?Math.abs(rec.lat).toFixed(3)+(rec.lat>=0?' N ':' S ')+Math.abs(rec.lon).toFixed(3)+(rec.lon<0?' W':' E'):'',
   score:score==null?null:{v:Math.round(score),conf:confOf(rec,'h_score')},grade,tiles,headWhy,sections,
   // part=metrics failed: the sheet says once that the detail behind a rejected figure did not load, with Try again
   membersFail:!!o.membersFail&&!(o.members instanceof Map)&&isObj(rec.m)&&Object.keys(rec.m).some(k=>whyOf(rec,k))}}
 // ---- Data sheet content (helper renders it): sources from part=sources, blends from the strip or one ZIP's m, method from the summary
 const STATE_WORD={ok:'ok',stale:'stale',needs_key:'needs_key',unavailable:'blocked',invalid:'blocked'};
 const RES_BLENDS=['home_value','value_trend_1y','value_trend_5y','value_forecast_1y','typical_rent','rent_trend_1y','gross_yield','inventory','days_on_market','sale_to_list','price_cuts',
  'market_heat','affordability','schools','flood_risk','climate_risk','health','broadband','walkability','safety','property_tax_rate','population','income'];
 function dataModel(o){o=o||{};const cat=o.cat||new Map(),f=F(),zt=isObj(o.summary)&&isObj(o.summary.coverage)?num(o.summary.coverage.zips_total):null;
  const month=s=>{const t=String(s||'');return /^\d{4}-\d{2}(-\d{2})?$/.test(t)?f.month(t.slice(0,7)):t.slice(0,20)};
  const src=arr(o.sources).filter(s=>isObj(s)&&s.side!=='commercial');
  const sources=src.map(s=>({name:String(s.name||s.id||'').slice(0,90),gives:num(s.coverage)!=null&&zt?f.count(s.coverage)+' of '+f.count(zt)+' ZIPs':num(s.rows)!=null?f.count(s.rows)+' rows':'',
   asOf:month(s.as_of),state:STATE_WORD[s.status]||'never'}));
  const setup=src.filter(s=>s.status==='needs_key').map(s=>({name:String(s.name||s.id),line:String(s.name||s.id)+' needs a free key'+(s.key_env?' ('+String(s.key_env).slice(0,40)+')':''),state:'needs_key'}));
  const blends=[];
  // the residential blends (blueprint 3), in its order; a ZIP lists each with its parts and weights
  if(isObj(o.zip)&&isObj(o.zip.m)){for(const k of RES_BLENDS){const m=o.zip.m[k];if(!isObj(m)||num(m.v)==null)continue;
    const c=cat.get(k),lbl=(c&&c.label)||k.replace(/_/g,' ');
    blends.push({label:lbl+', '+o.zip.zip,value:fmtGuess(c,m.v),score:num(m.c),agree:num(m.n)!=null?m.n+(m.n===1?' source':' sources'):'',
     parts:arr(m.p).filter(Array.isArray).map(([fk,w])=>{const fc=cat.get(fk);return {name:(fc&&fc.label)||String(fk).replace(/_/g,' '),value:fmtGuess(fc,o.zip[fk]),weight:num(w)==null?'':Math.round(w*100)+'%'}})})}}
  else for(const t of arr(o.strip))if(t.conf)blends.push({label:t.label+', '+(o.where||''),value:t.value+(t.unit||''),score:t.conf.c,agree:'',parts:[]});
  const method=[];const sm=isObj(o.summary)&&isObj(o.summary.scores)&&isObj(o.summary.scores.h_score)?o.summary.scores.h_score:null;
  for(const x of arr(sm&&sm.inputs).filter(isObj)){const c=cat.get(x.key);method.push([(c&&c.label)||String(x.key).replace(/_/g,' '),(num(x.weight)==null?'':Math.round(x.weight*100)+'% \u00b7 ')+(x.direction==='lower'?'lower is better':'higher is better')])}
  const gm=isObj(o.summary)&&isObj(o.summary.grade_method)?o.summary.grade_method:null;
  if(gm&&arr(gm.grades).length)method.push(['Rental grade',arr(gm.grades).filter(Array.isArray).map(g=>g[0]+' '+g[1]+'+').join(', ')+', else D']);
  method.push(['Confidence dots','Three: 0.75 or more. Two: 0.5 or more. One: under 0.5.'],['Pro forma','5% vacancy, 40% operating costs, 30-year loan'],['Within budget','Off by default. The budget comes from your profile.'],
   ['Best ZIPs','A dash is a value the build did not report for that ZIP, never a zero. The 30-yr rate is the national weekly average.']);
  // Your markets and the 15-yr rate come from the real estate feed, not the national build
  const areas=areasOf(o.re),newest=k=>areas.map(a=>isObj(a[k])?String(a[k].as_of||''):'').filter(s=>/^\d{4}-\d{2}/.test(s)).sort().pop()||'';
  if(areas.length)sources.push({name:'Zillow Research',gives:'Your markets: value, homes for sale, list and sale price, days to pending',asOf:month(newest('zhvi')),state:'ok'});
  if(areas.some(a=>num(a.active_listings)!=null))sources.push({name:'Realtor.com',gives:'Your markets: ZIP listings, list price, days on market',asOf:month(String((areas.find(a=>a.realtor_as_of)||{}).realtor_as_of||'')),state:'ok'});
  const r15=rate15Of(o.re);if(r15)sources.push({name:'Freddie Mac mortgage survey',gives:'15-yr fixed rate',asOf:/^\d{4}-\d{2}-\d{2}$/.test(String(r15.as_of||''))?f.date(r15.as_of,{year:true}):month(r15.as_of),state:num(r15.value)!=null?'ok':'never'});
  // the 30-yr rate in the Best ZIPs head and the ZIP strip comes from the summary's mortgage block, with its own publisher and week;
  // skipped when the national source list already names a mortgage survey
  const mg=isObj(o.summary)&&isObj(o.summary.mortgage)?o.summary.mortgage:null;
  if(mg&&num(mg.rate_30y)!=null&&!arr(o.sources).some(s=>isObj(s)&&(/mortgage_rate/i.test(String(s.id||''))||/mortgage market survey/i.test(String(s.name||'')))))sources.push({name:String(mg.source||'Freddie Mac mortgage survey (30-yr)').slice(0,90),
   gives:'30-yr fixed rate, national',asOf:/^\d{4}-\d{2}-\d{2}$/.test(String(mg.as_of||''))?f.date(mg.as_of,{year:true}):month(mg.as_of),state:'ok'});
  const age=isObj(o.re)&&isObj(o.re.market)&&isObj(o.re.market.age_restricted)?num(o.re.market.age_restricted.hidden):null;
  if(age)method.push(['Homes for sale',f.count(age)+' age-restricted homes (55+) are left out']);
  return {sources,blends,method,setup}}
 function fmtGuess(c,v){const u=c&&c.unit,x=num(v);if(x==null)return '';const f=F();
  return u==='usd'?f.money(x):u==='usd_month'?f.money(x)+'/mo':u==='pct'?f.share(x):u==='count'?f.count(x):u==='days'?f.count(Math.round(x)):String(Math.round(x*100)/100)}
 // ---- page status: one freshness mark; stale past two weekly builds
 // ---- page status: one freshness mark from the server's own age, cadence and stale flag (part=summary)
 function pageStatus(summary,now,failed){const s=isObj(summary)?summary:{},age=num(s.age),refresh=num(s.refresh);
  return {age,refresh,missing:num(failed)||0,stale:s.stale===true||age==null}}

 // ================= render (DeckUI helpers) =================
 // TV keeps the first six with nothing new on them: the 15-yr line under the 30-yr rate stays off the board
 function stripHtml(tiles,where,tv){const t=tv?tiles.filter(x=>!x.dx).slice(0,6):tiles;if(!t.length)return '';
  return '<section class="sect re-strip" aria-label="'+esc('Market, '+where)+'"><h2 class="secttl"><span>'+esc(where)+'</span></h2>'+
   DeckUI.strip(t.map(x=>DeckUI.tile({label:x.label,value:x.value,unit:x.unit,conf:(x.conf?dots(x.conf):'')+fromTag(x.from),sub:tv&&x.key==='mortgage_rate'?'':x.sub,cls:x.dx?'dx':'',spark:x.spark?DeckUI.spark(x.spark,{}):''})).join(''),{label:where})+'</section>'}
 // metric chips wrap as whole words (a sideways seg cut "Rent 1-yr" and hid "Days to sell"); selected is bone on panel
 function mapHtml(model,sel,tv){const chips='<div class="chips re-mapk" role="group" aria-label="Map metric">'+MAP.map(m=>'<button type="button" data-re-map="'+m[0]+'"'+(m[0]===model.key?' class="on" aria-pressed="true"':' aria-pressed="false"')+'>'+esc(m[1])+'</button>').join('')+'</div>';
  const card=sel?model.items.find(x=>x.st===sel):null;
  return '<section class="sect re-map">'+(tv?'':'<h2 class="secttl"><span>Map</span></h2>'+chips)+'<div class="panel">'+
   DeckUI.usmap(model.items.map(x=>({st:x.st,name:x.name,value:x.value,text:x.text,short:x.short})),{metric:model.label.toLowerCase(),bins:model.edges,better:model.better,fmt:model.fmt,selected:sel||''})+
   (card?'<div class="re-stcard" role="status"><span><b>'+esc(card.name)+'</b><small>'+esc(model.label+' '+(card.text||'no data'))+'</small></span><button type="button" class="btn" data-re-view-st="'+esc(card.st)+'">View ZIPs</button></div>':'')+'</div></section>'}
 // loading: ten rows of the real row's shape hold the list's height, so nothing below moves when the metros land (P1);
 // failed: the not-reporting state in this section only
 const PH_ROW='<li><div class="rank-row re-ph"><span class="rank-n">\u00a0</span><span class="rank-t"><b>\u00a0</b><small>\u00a0</small></span><span class="rank-f"><b>\u00a0</b></span><span class="rank-s"><span class="bar"></span></span></div></li>';
 function areasHtml(m){if(!m||!(m.loading||m.failed||m.rows.length))return '';
  const head='<h2 class="secttl"><span>'+esc(m.title)+'</span><span class="act">'+esc(m.metric+(m.scaleText?' \u00b7 bars 0 to '+m.scaleText:''))+'</span></h2>';
  if(m.loading)return '<section class="sect re-areas" aria-busy="true">'+head+'<ol class="rank" aria-hidden="true">'+PH_ROW.repeat(AREA_ROWS)+'</ol></section>';
  if(m.failed)return '<section class="sect re-areas">'+head+DeckUI.empty({k:'bad',title:'Metros are not reporting.'})+'</section>';
  return '<section class="sect re-areas">'+head+'<ol class="rank">'+m.rows.map(r=>
   '<li><button type="button" class="rank-row" data-re-area="'+esc(m.kind)+'" data-key="'+esc(r.key)+'"'+(r.full!==r.name?' title="'+esc(r.full)+'"':'')+'><span class="rank-n">'+esc(r.n)+'</span><span class="rank-t"><b>'+esc(r.name)+'</b><small>'+esc(r.sub)+'</small></span>'+
   '<span class="rank-f"><b>'+esc(r.fig)+'</b></span><span class="rank-s"><span class="bar" data-max="'+esc(m.scale)+'"><i style="--v:'+esc(r.bar)+'%"></i></span></span></button></li>').join('')+'</ol></section>'}
 // ---- Best ZIPs: the ZIP column, then the lens's columns (bestCols). A cell is its value with its unit and confidence meter on one
 // line. A missing value is a dash, never a zero: its title and accessible name say it is not reported, and the ZIP sheet the row
 // opens names the build's own reason
 const ZIP_COL={key:'zip',label:'ZIP',place:true,help:'ZIP code and place. Tap a row for everything on that ZIP.'};
 const defOf=key=>BEST_ALL.find(d=>d.key===key)||null;
 function naCell(label){const t=String(label)+': not reported for this ZIP. Open the ZIP to see why.';return '<span class="na re-na" title="'+esc(t)+'" aria-label="'+esc(t)+'">-</span>'}
 // col: a bestCols column, or {key} alone (the default field of that key); ctx: the metro context Map for a context column
 function cellHtml(row,col,isV2,rank,ctx){
  if(col.key==='zip')return '<span class="place"><b>'+esc((rank?rank+'. ':'')+String(row.zip||''))+'</b><small>'+esc([row.city,row.state].filter(Boolean).join(', '))+'</small></span>';
  const d=Object.assign({},defOf(col.key)||{},col),label=d.label||col.key;
  if(d.ctx){const fv=ctx instanceof Map&&row.cbsa!=null?fmtVal(d.fmt,ctx.get(String(row.cbsa))):null;return fv?esc(fv.value+(fv.unit||'')):naCell(label)}
  const k=d.field!==undefined?d.field:isV2?arr(d.f)[0]:d.v1;
  if(d.fmt==='grade'){const g=k&&/^[ABCD]$/.test(String(row[k]||''))?row[k]:null;return g?'<span class="grade g-'+g+'">'+g+'</span>':naCell(label)}
  const fv=k?fmtVal(d.fmt,row[k]):null;if(!fv)return naCell(label);
  // value, unit and meter stay on one line (the meter follows the value and its unit)
  let h=esc(fv.value+(fv.unit||''));const cf=isV2&&k?confOf(row,k):null;if(cf)h='<span class="re-nw">'+h+dots(cf)+'</span>';
  return h+(isV2&&k?fromTag(fromOf(row,k)):'')}
 // the 30-yr rate is national: once, in the table's head line, with its date
 function rateLine(sum){const m=isObj(sum)&&isObj(sum.mortgage)?sum.mortgage:null,r=m?fmtVal('rate',m.rate_30y):null;if(!r)return '';
  const d=/^\d{4}-\d{2}-\d{2}$/.test(String(m.as_of||''))?F().date(m.as_of,{year:true}):'';return '30-yr rate '+r.value+(d?' \u00b7 '+d:'')}
 // above the table: the lens (v2 data only), More columns (Residential lens) and the sort in words (the sorted column may be hidden)
 function bestTools(st,isV2,used){if(st.tv)return '';const lens=st.lens==='mf'?'mf':'res',s=SORTS.find(x=>x[0]===used)||SORTS[0];
  const seg=isV2?'<div class="seg re-lens" role="group" aria-label="Lens">'+LENSES.map(([k,l])=>'<button type="button" data-re-lens="'+k+'"'+(lens===k?' class="on" aria-pressed="true"':' aria-pressed="false"')+'>'+esc(l)+'</button>').join('')+'</div>':'';
  const more=lens==='res'?'<button type="button" class="btn btn-quiet re-morecols" data-re-morecols aria-pressed="'+(st.more?'true':'false')+'">More columns</button>':'';
  return '<div class="re-btools">'+seg+more+'<span class="re-sortw">Sort: '+esc(s[1])+'</span></div>'}
 // one plain line per column, under the table, one tap open
 function helpHtml(cols,rate){const rows=[ZIP_COL].concat(cols).map(c=>[c.label,c.help]);
  if(rate)rows.push(['30-yr rate','National average for a 30-year fixed loan. The same for every ZIP.']);
  rows.push(['Meter after a value','How sure the value is: three segments high, one low.'],['A dash','Not reported for this ZIP. Never counted as zero.']);
  return '<details class="re-colhelp"><summary>What the columns mean</summary><dl class="re-help">'+rows.map(r=>'<div><dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd></div>').join('')+'</dl></details>'}
 // P and L (G8): Best ZIPs sits right under the market strip and opens at its top 3; Show more gives 10, then every row read.
 // T, D and XL (the table takes the full width there) open at 20, then every row read. Show fewer goes back to the first step.
 // The server's next 50 come after.
 const BEST_STEPS=[3,10],BEST_WIDE=20;
 const phoneCls=cls=>cls==='P'||cls==='L';
 function bestShown(cls,n,len){const k=num(n);if(k!=null&&k<=0)return len;return Math.min(len,k!=null?k:phoneCls(cls)?BEST_STEPS[0]:BEST_WIDE)}
 const bestNext=(n,cls)=>(phoneCls(cls)?BEST_STEPS:[BEST_WIDE]).find(x=>x>n)||Infinity;
 function bestHtml(st){const res=st.rank,f=st.f,d=res&&isObj(res.data)?res.data:{},isV2=d.dataset==='v2'||v2(st.fields),used=sortUsed(f,d,st.fields),rate=rateLine(st.sum);
  const head='<h2 class="secttl"><span>Best ZIPs</span>'+(rate?'<span class="act">'+esc(rate)+'</span>':'')+'</h2>'+bestTools(st,isV2,used);
  if(!res)return '<section class="sect re-best">'+head+DeckUI.skeleton('row')+'</section>';
  // a budget the read did not bring holds the list: with Within budget on, asking anyway would widen it to every priced area
  if(res.held)return '<section class="sect re-best">'+head+DeckUI.empty({k:'bad',title:'Budget not loaded',line:'Best ZIPs waits for your budget, so the list is not widened.',
   action:'<button type="button" class="btn" data-re-profretry="1">Try again</button>'})+'</section>';
  // a part that failed says so once here; the page's one Try again lives in the freshness status (blueprint 2.3)
  if(!res.ok)return '<section class="sect re-best">'+head+DeckUI.empty({k:'bad',title:'Real estate data is not reporting.'})+'</section>';
  if(d.status==='not_reporting')return '<section class="sect re-best">'+head+DeckUI.empty({k:'stale',title:'Real estate data is not reporting.'})+'</section>';
  const rows=st.rows;if(!rows.length)return '<section class="sect re-best">'+head+DeckUI.empty({title:'No ZIPs match. Loosen a filter.',action:filterCount(f,DeckScope.get())?'<button type="button" class="btn" data-re-clear>Clear filters</button>':''})+'</section>';
  const v2rows=d.dataset==='v2',total=num(d.total)||rows.length;
  // the columns this answer can fill: a v2 answer names them; a v1 answer has every column on each row
  const have=new Set(v2rows&&Array.isArray(d.cols)?d.cols:Object.keys(rows[0]||{}));
  const cols=bestCols({lens:st.lens,more:st.more,isV2:v2rows,have,ctx:st.mfCtx}),by=new Map(cols.map(c=>[c.key,c]));
  // the server sorts and pages; the table keeps that order and marks the sorted column with the direction the server used
  const sk=(cols.find(c=>colSort(c,v2rows)===used)||{}).key||'';
  const short=!st.tv&&phoneCls(st.cls),cut=st.tv?Math.min(8,rows.length):bestShown(st.cls,st.bestN,rows.length);
  const shown=rows.slice(0,cut),nx=Math.min(rows.length,bestNext(cut,st.cls)),first=short?BEST_STEPS[0]:BEST_WIDE;
  const tbl=DeckUI.table({cols:[ZIP_COL].concat(cols).map(c=>({key:c.key,label:c.label,num:!c.place,place:!!c.place,pri:c.pri,sort:!st.tv&&!!colSort(c,v2rows)})),rows:shown,key:r=>String(r.zip),open:'zip',label:'Best ZIPs',
   cell:(r,c)=>cellHtml(r,by.get(c.key)||c,v2rows,num(r.rank),st.mfCtx),max:shown.length,presorted:true,sorted:sk?{key:sk,dir:d.sort_dir==='asc'?'ascending':'descending'}:null});
  const btns=st.tv?[]:[cut<rows.length?'<button type="button" class="btn" data-re-more="cards" data-n="'+nx+'">Show '+(nx-cut)+' more</button>'
   :total>rows.length?'<button type="button" class="btn" data-re-more="zips">Show 50 more</button>':'',cut>first?'<button type="button" class="btn btn-quiet" data-re-less="cards">Show fewer</button>':''].filter(Boolean);
  const more=btns.length?'<div class="more-row">'+btns.join('')+'</div>':'';
  return '<section class="sect re-best'+(st.lens==='mf'?' re-lens-mf':'')+'">'+head+tbl+more+(st.tv?'':helpHtml(cols,rate))+'</section>'}
 function mineHtml(rows){if(!rows.length)return '';const f=F();
  return '<section class="sect re-mine"><h2 class="secttl"><span>Your markets</span></h2><div class="flist">'+rows.map(r=>{const v=fmtVal('money',r.value),c=fmtVal('chg',r.chg),rt=fmtVal('money',r.rent),dy=num(r.days);
   // a figure keeps its words ("39 days to sell"): the line breaks only between its parts
   const sub=[rt?rt.value+'/mo rent':'',dy!=null?Math.round(dy)+' '+(r.daysWord||'days to sell'):''].filter(Boolean).map(s=>s.replace(/ /g,'\u00a0')).join(' \u00b7 ');
   const inner='<span class="fl"><b>'+esc(r.name)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</span><span class="fr"><b>'+(v?esc(v.value)+(r.conf?dots(r.conf):''):f.na())+'</b>'+(c?'<small>'+esc(c.value)+' 1-yr</small>':'')+'</span>';
   return r.zip?'<button type="button" class="frow" data-open="zip" data-key="'+esc(r.zip)+'">'+inner+'</button>'
    :r.slug?'<button type="button" class="frow" data-open="area" data-key="'+esc(r.slug)+'">'+inner+'</button>':'<div class="frow">'+inner+'</div>'}).join('')+'</div></section>'}
 // the area sheet: a county's or the country's own numbers with their months; missing ones named once (the ZIP sheet names them itself)
 function areaBody(m,quiet){if(!m)return DeckUI.empty({k:'bad',title:'Real estate data is not reporting.'});
  return (m.items.length?'<dl class="kv re-akv">'+m.items.map(x=>'<div><dt>'+esc(x.label)+'</dt><dd>'+esc(x.value)+(x.line?'<small>'+esc(x.line)+'</small>':'')+'</dd></div>').join('')+'</dl>':'<p class="note">No data</p>')+
   (quiet?'':DeckUI.missing(m.missing))}
 const HTYPES=[['','All'],['House','House'],['Condo','Condo'],['Townhouse','Townhouse']],BEDS=[[0,'Any beds'],[2,'2+ BR'],[3,'3+ BR'],[4,'4+ BR']];
 // Max price is a set of public price steps, never a typed amount (it stays out of storage like the rest of these controls);
 // Sort is the server's listing sorts (SeeLostSweep L13): the feed's city order, lowest price, newest, lowest price per square foot
 const HPRICES=[[0,'Any price'],[500000,'$500K'],[750000,'$750K'],[1000000,'$1M'],[1500000,'$1.5M'],[2000000,'$2M'],[3000000,'$3M']];
 const HSORTS=[['feed','City order'],['price','Lowest price'],['newest','Newest'],['ppsf','Lowest $/SF']];
 const hfActive=hf=>!!(hf&&(hf.type||num(hf.beds)>0||num(hf.max)>0||(typeof hf.q==='string'&&hf.q.trim())));
 function homesHtml(st,now){const hf=st.hf,r=st.homes;
  const sel=(attr,label,opts,cur)=>'<label class="field re-hsel">'+esc(label)+'<select '+attr+'>'+opts.map(([v,l])=>'<option value="'+esc(v)+'"'+(String(v)===String(cur)?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select></label>';
  const ctl='<div class="re-hctl"><div class="chips scroll" role="group" aria-label="Home type">'+HTYPES.map(([k,l])=>'<button type="button" data-re-htype="'+esc(k)+'"'+(hf.type===k?' class="on" aria-pressed="true"':' aria-pressed="false"')+'>'+esc(l)+'</button>').join('')+'</div>'+
   '<div class="chips scroll" role="group" aria-label="Bedrooms">'+BEDS.map(([k,l])=>'<button type="button" data-re-beds="'+k+'"'+((hf.beds||0)===k?' class="on" aria-pressed="true"':' aria-pressed="false"')+'>'+esc(l)+'</button>').join('')+'</div>'+
   '<label class="field re-hcity">City<input type="search" data-re-hq value="'+esc(hf.q||'')+'" autocomplete="off" placeholder="Any city"></label>'+
   sel('data-re-hmax','Max price',HPRICES,num(hf.max)||0)+sel('data-re-hsort','Sort',HSORTS,HSORTS.some(s=>s[0]===hf.sort)?hf.sort:'feed')+'</div>';
  const head='<h2 class="secttl"><span>Homes for sale</span></h2>';
  // the homes come from realestate.json (/api/realestate): its own stale flag and age make the list say out of date, as the feed does
  const reOld=isObj(st.re)&&st.re.stale===true,reAge=reOld?F().age(num(st.re.age)):null;
  const reStale=reOld?'<p class="note sm re-stale" role="status">Out of date'+(reAge?' \u00b7 '+reAge:'')+'</p>':'';
  if(!r)return '<section class="sect re-homes">'+head+ctl+DeckUI.skeleton('row')+'</section>';
  if(!r.ok)return '<section class="sect re-homes">'+head+DeckUI.empty({k:'bad',title:'Homes for sale are not reporting.'})+'</section>';
  // one row per listing: the same address from two sources is one home. The offset and the "more" test count the server's rows, not the rows shown.
  const got=st.homeRows.length,rows=DeckUI.homeRows({homes:st.homeRows}).homes.map(x=>homeRow(x,now)).filter(Boolean);
  if(!rows.length)return '<section class="sect re-homes">'+head+reStale+ctl+DeckUI.empty({title:hfActive(hf)?'No homes match. Loosen a filter.':'No homes for sale tracked here yet.'})+'</section>';
  const total=num(r.data&&r.data.total)||got,more=total>got;
  return '<section class="sect re-homes">'+head+reStale+ctl+'<div class="flist">'+rows.map(x=>(x.url?'<a class="frow" href="'+esc(x.url)+'" target="_blank" rel="noopener">':'<div class="frow">')+
   '<span class="fl"><b>'+esc(x.title)+(x.cut?' <span class="re-cut" role="img" aria-label="Price cut">\u2193</span>':'')+'</b><small>'+esc(x.sub)+'</small></span>'+(x.url?'</a>':'</div>')).join('')+'</div>'+
   (more?'<p class="note sm jcount" role="status">Showing '+rows.length+' of '+total+'</p><div class="more-row"><button type="button" class="btn" data-re-more="homes">Show 12 more</button></div>':'')+'</section>'}
 // the filter bar: scope group and search come from DeckScope; Within budget never shows the amount
 function filtersHtml(st){const f=st.f,b=budgetOf(st.prof),rev=moneyShown(),fm=F(),sc=DeckScope.get(),mp=minPopOf(f,sc);
  const n=filterChips(f,{prof:st.prof,profFail:st.profFail,scope:sc}).length;
  const sel=(name,label,opts,cur)=>'<label class="field">'+esc(label)+'<select data-re-ff="'+name+'">'+opts.map(([v,l])=>'<option value="'+esc(v)+'"'+(String(v)===String(cur)?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select></label>';
  // Within budget is a two-way choice, never a bare checkbox; with no budget set it is one button to the profile form, and a
  // budget the read did not bring says so with the read again, never "Set budget" over one the owner may already have
  const within=b!=null?'<div class="field re-within" role="group" aria-label="Budget"><span>Budget</span><div class="seg"><button type="button" data-re-within="0"'+(f.within?' aria-pressed="false"':' class="on" aria-pressed="true"')+'>Any price</button>'+
    '<button type="button" data-re-within="1"'+(f.within?' class="on" aria-pressed="true"':' aria-pressed="false"')+'>Within <span class="re-amt">'+esc(rev?fm.money(b):fm.money(b,{masked:true}))+'</span></button></div></div>'
   :st.profFail?'<div class="field re-within"><span>Budget</span><span class="note sm" role="status">Not loaded</span><button type="button" class="btn btn-sm" data-re-profretry="1">Try again</button></div>'
   :'<div class="field re-within"><span>Budget</span><button type="button" class="btn" data-re-budget>Set budget</button></div>';
  const max='<label class="field">Max price<input data-re-ff="max" inputmode="numeric" autocomplete="off" placeholder="Any" value="'+esc(num(f.max)==null?'':rev?String(f.max):fm.money(f.max,{masked:true}))+'"'+(num(f.max)!=null&&!rev?' aria-label="Max price, hidden"':'')+'></label>';
  const fields=DeckScope.field()+sel('grade','Grade',GRADES,f.grade)+within+max+
   '<label class="field">Min population<input data-re-ff="minPop" inputmode="numeric" autocomplete="off" placeholder="Any" value="'+esc(mp==null?'':String(mp))+'"></label>'+
   sel('sort','Sort',SORTS.map(s=>[s[0],s[1]]),f.sort);
  return DeckUI.filters({id:'re-res',lead:DeckScope.searchBox(),count:n,fields,show:'Show ZIPs'})}
 // the board below the filter bar; a repaint while the Filters sheet is open replaces only this part
 function boardHtml(st,now){const sc=DeckScope.get(),where=DeckScope.label(sc),tv=!!st.tv;
  if(st.fatal)return DeckUI.empty({k:'bad',title:'Real estate data is not reporting.',line:'Try again in a moment.',retry:'page'});
  const stripSrc=sc.kind==='mine'?st.home:sc.kind==='state'?arr(st.states).find(s=>isObj(s)&&s.state===sc.state):sc.kind==='metro'?arr(st.metros).find(m=>isObj(m)&&m.name===sc.metro):(isObj(st.sum)&&st.sum.us);
  // the strip's caption names the scope (on a phone it is the only place the scope shows)
  const stripWhere=sc.kind==='mine'?'Your markets'+(isObj(st.home)&&st.home.city?' \u00b7 '+st.home.city:''):where;
  const tiles=stripModel(stripSrc,st.sum,{rate15:rate15Of(st.re),known:!!st.reDone});st.tiles=tiles;st.where=stripWhere;
  const map=st.states?mapHtml(mapModel(st.states,st.mapK),st.sel||(sc.kind==='state'?sc.state:'')):'<section class="sect re-map">'+DeckUI.skeleton('tile')+'</section>';
  const strip=stripHtml(tiles,stripWhere,tv)||'<section class="sect re-strip"><h2 class="secttl"><span>'+esc(stripWhere)+'</span></h2>'+(st.sum?DeckUI.empty({title:'No market values here yet.'}):DeckUI.skeleton('tile'))+'</section>';
  const mine=sc.kind==='mine'?mineHtml(mineModel(st.re,st.mine,st.sum)):'';
  // TV: one board inside the overscan (strip of six, then the map beside the top ZIPs filling what is left); the rest one Down press below
  if(tv)return '<div class="board re-board re-tv">'+strip+'<div class="re-cols board-fill"><div class="re-col re-a">'+mapHtml(mapModel(st.states||[],st.mapK),'',true)+'</div><div class="re-col re-b">'+bestHtml(st)+'</div></div></div>'+
   '<div class="re-cols re-below"><div class="re-col re-a">'+mine+'</div><div class="re-col re-b">'+homesHtml(st,now)+'</div></div>';
  // homes sit in the first column under Your markets: on D and XL that column then runs about as long as Best ZIPs beside it.
  // The board names which blocks it holds, so T and L can pair the short blocks without a hole (realestate.css)
  const areas=areasHtml(areasModel(sc,st.states,st.metros,st.mapK));
  return '<div class="re-board'+(areas?' re-w-areas':'')+(mine?' re-w-mine':'')+'">'+strip+'<div class="re-cols"><div class="re-col re-a">'+map+areas+mine+homesHtml(st,now)+
   '</div><div class="re-col re-b">'+bestHtml(st)+'</div></div></div>'}
 function pageHtml(st,now){return (st.tv||st.fatal?'':'<div class="re-fbar">'+filtersHtml(st)+'</div>')+'<div class="re-main">'+boardHtml(st,now)+'</div>'}
 // ---- ZIP sheet render
 const lineHtml=(l)=>{const f=F(),pts=l.series.map(p=>[String(p[0]),num(p[1])]),mo=x=>f.month(String(x).slice(0,7))||String(x);
  return '<figure class="re-line"><figcaption>'+esc(l.label)+'</figcaption>'+DeckUI.line({series:pts,yfmt:v=>l.f==='money'||l.f==='rent'?f.money(v):f.count(Math.round(v)),xlab:[mo(pts[0][0]),mo(pts[pts.length-1][0])],ar:'2.6/1',label:l.label})+'</figure>'};
const kvHtml=items=>items.length?'<dl class="kv">'+items.map(x=>'<div><dt>'+esc(x.label)+'</dt><dd>'+esc(x.value)+(x.conf?dots(x.conf):'')+fromTag(x.from)+'</dd></div>').join('')+'</dl>':'';
 function pfHtml(pf,rev){const f=F(),m=v=>num(v)==null?f.na('sheet'):f.money(Math.round(v)),hide=v=>rev?v:'\u2022\u2022\u2022',hm=v=>rev?m(v):f.money(v,{masked:true});
  const rows=[['Gross rent',m(pf.gsr)+'/yr'],['Vacancy','\u2212'+m(pf.vacancy)],['Operating costs','\u2212'+m(pf.opex)],['NOI',m(pf.noi)],['Cap rate',f.rate(pf.cap)],['GRM',(Math.round(pf.grm*10)/10).toString()],
   ['Debt service',pf.ads==null?f.na('sheet'):hm(pf.ads)],['DSCR',pf.dscr==null?f.na('sheet'):hide((Math.round(pf.dscr*100)/100).toFixed(2))],['Cash flow',pf.cash_flow==null?f.na('sheet'):hm(pf.cash_flow)],
   ['Cash in',hm(pf.cash_in)],['Cash-on-cash',pf.coc==null?f.na('sheet'):hide(f.rate(pf.coc))]];
  const asm=[Math.round(PF_VAC*100)+'% vacancy',Math.round(PF_OPEX*100)+'% costs',pf.rate!=null?f.rate(pf.rate)+' rate':'',Math.round(pf.down_pct*100)+'% down'].filter(Boolean).join(' \u00b7 ');
  return '<dl class="kv">'+rows.map(r=>'<div><dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd></div>').join('')+'</dl><p class="note re-asm">'+esc(asm)+'</p>'+
   '<div class="re-pfa">'+DeckUI.amountsBtn(rev)+'<button type="button" class="btn btn-sm btn-quiet" data-re-budget>Edit</button></div>'}
 function zipBody(z,st,now){const f=F(),rev=moneyShown();
  if(z.state!=='ok')return DeckUI.empty({k:z.state==='unknown'?'idle':z.state==='stale'?'stale':'bad',title:z.line});
  const head='<div class="sh-head">'+(z.coord?'<p class="coord">'+esc(z.coord)+'</p>':'')+(z.place.length?'<p class="re-place">'+z.place.map(p=>'<span>'+esc(p)+'</span>').join(' \u00b7 ')+'</p>':'')+
   '<div class="chips">'+(z.score?'<span class="pill">Score '+z.score.v+dots(z.score.conf)+'</span>':'<span class="pill">Not enough data to score this ZIP.</span>')+(z.grade?'<span class="pill">Rental grade <span class="grade g-'+z.grade+'">'+z.grade+'</span></span>':'')+'</div>'+
   (z.tiles.length?DeckUI.strip(z.tiles.map(t=>DeckUI.tile({label:t.label,value:t.value,unit:t.unit,conf:(t.conf?dots(t.conf):'')+fromTag(t.from),cls:'sm'})).join(''),{label:'Headline values'}):'')+DeckUI.missing(arr(z.headWhy))+
   (z.membersFail?'<p class="note re-mfail" role="status">Could not load the detail behind a rejected figure. <button type="button" class="btn btn-sm btn-quiet" data-re-members>Try again</button></p>':'')+'</div>';
  const secs=z.sections.map(s=>{let b='';
   if(s.line)b+=lineHtml(s.line);if(s.line2)b+=lineHtml(s.line2);
   if(s.bars&&s.bars.length)b+=riskHtml(s.bars);
   b+=kvHtml(s.items);
   if(s.id==='grade')b+=(s.factors.length?DeckUI.table({cols:[{key:'label',label:'Factor',place:true},{key:'value',label:'Value',num:true},{key:'points',label:'Points',num:true},{key:'weight',label:'Weight',num:true,pri:2}],
    rows:s.factors,key:r=>r.key,cell:(r,c)=>c.key==='label'?esc(r.label):c.key==='value'?(r.value==null?(r.why?esc(f.na('sheet')+' ('+r.why+')'):f.na()):esc(r.value)):c.key==='points'?(r.points==null?'Not scored':String(r.points)):(r.weight==null?f.na():r.weight+'%'),max:s.factors.length}):'');
   if(s.id==='mine')b+=areaBody(s.area,true);
   if(s.id==='proforma')b+=(st.profFail?'<p class="note" role="status">Default terms, your budget did not load. Using 25% down and 3% closing.</p>':'')+pfHtml(s.pf,rev);
   if(s.id==='homes'){const all=DeckUI.homeRows({homes:arr(s.listings)}).homes.map(x=>homeRow(x,now)).filter(Boolean),rows=all.slice(0,12);
    b+=rows.length?'<div class="flist">'+rows.map(x=>(x.url?'<a class="frow" href="'+esc(x.url)+'" target="_blank" rel="noopener">':'<div class="frow">')+'<span class="fl"><b>'+esc(x.title)+'</b><small>'+esc(x.sub)+'</small></span>'+(x.url?'</a>':'</div>')).join('')+'</div>'+
     (all.length>rows.length?'<p class="note sm jcount" role="status">Showing '+rows.length+' of '+all.length+'</p>':'')
     :'<p class="note">No homes for sale tracked here yet.</p>';
    b+=st.find?'<p class="note" role="status">'+esc(st.find)+'</p>':''}
   if(s.missing.length)b+=DeckUI.missing(s.missing);
   const title=s.id==='grade'&&s.grade?s.title+' '+s.grade:s.title;
   return '<section class="sh-sec" tabindex="-1" data-sec="'+s.id+'"><h3>'+esc(title)+'</h3>'+b+'</section>'}).join('');
  return head+secs}

 // ================= glue =================
 // metros: undefined until read (P1: only a state or metro scope, the metro picker, or the Metros list within a screen of view asks
 // for the 1.3 MB list), null when the read failed. bestN: Best ZIPs rows shown on P and L (null = the first 3, 0 = every row read)
 const S={ctx:null,sum:null,states:null,metros:undefined,metrosP:null,io:null,members:null,limits:null,membersP:null,membersFail:false,fields:null,cat:new Map(),rank:null,rows:[],homes:null,homeRows:[],re:null,prof:null,profFail:false,home:null,mine:null,sources:null,
  f:null,hf:{type:'',beds:0,q:'',max:0,sort:'feed'},mapK:'score',sel:'',tok:0,htok:0,loaded:0,wave:false,ready:false,fatal:false,failed:0,zip:null,find:'',unsub:null,wired:false,bestN:null,barStale:false,cls:'',reP:null,reDone:false,
  // the Best ZIPs view (lens, More columns) and the metro context the multifamily lens joins on: undefined until read, null on failure
  lens:'res',more:false,viewDone:false,mfCtx:undefined,mfP:null};
 const moneyShown=()=>typeof DeckShell!=='undefined'&&DeckShell.money&&DeckShell.money.revealed?!!DeckShell.money.revealed():false;
 // every read is bounded: DeckPages.get aborts at 60 s and resolves ok:false, which paints the not-reporting state
 const TIMEOUT=60000;
 const get=p=>typeof DeckPages!=='undefined'&&DeckPages.get?DeckPages.get(p,{timeout:TIMEOUT}):Promise.resolve({ok:false,status:0});
 // the budget profile is owner-only and never cached (sw.js skips it), so a failure is never answered from a copy: the read
 // says which it was, and profFail keeps "did not load" apart from a profile the owner never set
 const profGet=()=>get('housing/profile').then(r=>r&&r.ok&&isObj(r.data)?r.data:null);
 const profRead=()=>profGet().then(d=>({ok:isObj(d),data:d}));
 // writes get the same 60 s bound; no answer is "That did not go through"
 async function post(url,body){const c=typeof AbortController==='function'?new AbortController():null,t=setTimeout(()=>{if(c)c.abort()},TIMEOUT);
  try{const r=await fetch(url,Object.assign({method:'POST',credentials:'same-origin',cache:'no-store',signal:c?c.signal:undefined},body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
   return await r.json().catch(()=>null)}catch(e){return null}finally{clearTimeout(t)}}
 // a repaint keeps the focused control, its typed text and caret (filter fields, the city word, the search)
 function focusKey(a){if(!a||!a.dataset)return '';return a.dataset.reFf?'[data-re-ff="'+a.dataset.reFf+'"]':a.dataset.reHq!=null?'[data-re-hq]':a.dataset.scopeQ!=null?'.re-search:not(.re-bar) input[data-scope-q]':''}
 // a field in the filter row that holds focus keeps it (F13): the page coming back on screen, the 10-minute refresh or a late part
 // repaints the board under the row only, so the phone's keyboard stays up and the suggestions stay under the field; the row
 // catches up when focus leaves it
 function barHeld(bar,a){return !!(bar&&a&&bar.contains(a)&&a.matches&&a.matches('input,select,textarea'))}
 // the class and TV view are read live: the shell can switch to TV (or rotate) after show() handed over its ctx
 function paint(){const c=S.ctx;if(!c||!c.el)return;S.cls=typeof DeckPages!=='undefined'&&DeckPages.cls?DeckPages.cls():c.cls||'';
  const root=typeof document!=='undefined'&&document.documentElement,tv=S.cls==='TV'||!!(root&&root.classList&&root.classList.contains('tv'))||!!c.tv;
  // the Filters sheet stays open across the repaint its own change caused: only the board below it is replaced
  const main=c.el.querySelector('.re-main'),open=c.el.querySelector('.fbar-panel[open]'),a=document.activeElement,held=!tv&&!!main&&barHeld(c.el.querySelector('.re-fbar'),a);
  const inside=!held&&a&&c.el.contains(a),sel=inside?focusKey(a):'',val=sel?a.value:'',pos=sel&&typeof a.selectionStart==='number'?a.selectionStart:null;
  try{if((open||held)&&main&&!tv){main.innerHTML=boardHtml(Object.assign(S,{tv:false}),Date.now());if(held)S.barStale=true}else{c.el.innerHTML=pageHtml(Object.assign(S,{tv}),Date.now());S.barStale=false}}
  catch(e){c.el.innerHTML=DeckUI.empty({k:'bad',title:'Could not show Real estate.',retry:'page'})}
  if(sel){const el=c.el.querySelector(sel);if(el){el.value=val;el.focus();if(pos!=null&&el.setSelectionRange)try{el.setSelectionRange(pos,pos)}catch(e){}}}
  freshPaint();DeckScope.mount(c,{onZip:openZip,onCity:openCity,suggest});watchAreas();
  if(tv&&typeof DeckPages!=='undefined'&&DeckPages.tv)DeckPages.tv(c)}
 // up to five ZIPs for the search's suggestion list (national, best score first); null when the read fails
 const suggest=q=>typeof DeckPages!=='undefined'&&DeckPages.get?DeckPages.get('housing/rank?kind=housing&q='+encodeURIComponent(q)+'&limit=5',{timeout:8000})
  .then(r=>r&&r.ok&&r.data?arr(r.data.rows):null):Promise.resolve(null);
 // ---- metros on demand (P1): read once per load and shared with the metro picker (DeckScope.rollup keeps it 10 minutes)
 function loadMetros(){if(S.metrosP)return S.metrosP;
  S.metrosP=DeckScope.rollup('metros').then(v=>{S.metros=Array.isArray(v)?v:null;S.metrosP=null;paint()});return S.metrosP}
 // the Metros list's loading rows ask for the metros once they come within one screen of the viewport; a list already on screen asks
 // at once. The watch starts when the page's first load has settled: skeletons above the list are shorter than their data, so a list
 // watched earlier sits on screen for a moment on every phone open
 function watchAreas(){if(S.io){S.io.disconnect();S.io=null}if(!S.ready||S.metros!==undefined||S.metrosP||!S.ctx||!S.ctx.el)return;
  const el=S.ctx.el.querySelector('.re-areas[aria-busy="true"]');if(!el)return;
  if(typeof IntersectionObserver!=='function'){loadMetros();return}
  S.io=new IntersectionObserver(es=>{if(!es.some(x=>x.isIntersecting))return;if(S.io){S.io.disconnect();S.io=null}loadMetros()},{rootMargin:'100% 0px 100% 0px'});S.io.observe(el)}
 // the one freshness mark: weekly build, a status only when stale or a part is missing (DeckPages.mark owns .pact). Before the first
 // answers land nothing is known, and unknown is not down: the loading paint sets no mark. A held list is no failed part: it waits
 function freshPaint(){const c=S.ctx;if(!c||!S.wave||typeof DeckPages==='undefined'||!DeckPages.mark)return;
  const missing=S.failed+(S.rank&&!S.rank.ok&&!S.rank.held?1:0)+(S.homes&&!S.homes.ok?1:0),ps=pageStatus(S.sum,Date.now(),missing);
  DeckPages.mark(c,{age:ps.age,refresh:ps.refresh,missing:ps.missing})}
 async function loadRank(append){const t=++S.tok,sc=DeckScope.get(),off=append?S.rows.length:0;
  // no budget, no widening: a failed profile read holds the list instead of asking for every priced area (budgetUnloaded)
  if(budgetUnloaded(S)){S.rank={ok:false,held:true};S.rows=[];paint();return}
  const r=await get('housing/rank?'+rankQuery(sc,S.f,{budget:budgetOf(S.prof),fields:S.fields,offset:off}));if(t!==S.tok)return;
  S.rank=r;const rows=r&&r.ok&&r.data&&Array.isArray(r.data.rows)?r.data.rows.filter(isObj):[];S.rows=append?S.rows.concat(rows):rows;paint()}
 async function loadHomes(append){const t=++S.htok,off=append?S.homeRows.length:0;const r=await get('realestate/homes?'+homesQuery(DeckScope.get(),S.hf,off));if(t!==S.htok)return;
  S.homes=r;const rows=r&&r.ok&&r.data&&Array.isArray(r.data.rows)?r.data.rows:[];S.homeRows=append?S.homeRows.concat(rows):rows;paint()}
 // the scope's own parts: metros (a state or metro scope reads them at once), the home ZIP and the owner's markets (Your markets)
 async function loadScope(){const sc=DeckScope.get(),jobs=[];
  if(sc.kind==='state'||sc.kind==='metro')jobs.push(loadMetros());
  if(sc.kind==='mine'){jobs.push(reLoad().then(()=>{const home=homeZip(S.re);
    const zips=arr(S.re&&S.re.market&&S.re.market.residential&&S.re.market.residential.areas).filter(a=>isObj(a)&&a.level==='zip'&&/^\d{5}$/.test(String(a.zip))).map(a=>String(a.zip)).slice(0,40);
    return Promise.all([get('housing/zip/'+home).then(z=>{S.home=z&&z.ok&&isObj(z.data)&&!z.data.error?z.data:null}),
     zips.length?get('housing/rank?'+rankQuery({kind:'us'},{sort:'score'},{fields:S.fields,zips,limit:40})).then(x=>{S.mine=x&&x.ok&&x.data?arr(x.data.rows):null}):null])}))}
  await Promise.all(jobs);paint()}
 const homeZip=re=>{const a=arr(re&&re.market&&re.market.residential&&re.market.residential.areas).find(x=>isObj(x)&&x.tier==='home'&&/^\d{5}$/.test(String(x.zip)));return a?String(a.zip):'92629'};
 // /api/realestate: Your markets, the area sheets and the 15-yr rate. Read once per page load (every scope needs the rate) and shared
 // by the scope parts; a failure is no feed, so the strip says the 15-yr rate has no data and no area row opens a sheet
 function reLoad(force){if(force||!S.reP)S.reP=get('realestate').then(r=>{S.re=r&&r.ok&&isObj(r.data)?r.data:null;S.reDone=true;return S.re});return S.reP}
 // the first open paints the designed loading state at once (skeleton strip, map and Best ZIPs, the Metros list's loading rows):
 // a cold server takes seconds to parse the national files, and the page was blank until the first answers landed
async function load(){S.loaded=Date.now();if(!S.f)S.f=filtersLoad();if(!S.viewDone){Object.assign(S,viewLoad());S.viewDone=true;lensSortApply()}const reP=reLoad(true);if(S.metros===null)S.metros=undefined;if(!S.sum&&!S.states&&!S.fatal)paint();
  const [sum,states,fields,prof,srcs]=await Promise.all([get('housing/national?part=summary'),DeckScope.rollup('states'),S.fields?Promise.resolve({ok:true,data:S.fields}):get('housing/fields'),profRead(),get('housing/national?part=sources')]);
  S.sum=sum&&sum.ok&&isObj(sum.data)&&sum.data.status!=='not_reporting'?sum.data:null;S.states=states;S.prof=prof.data;S.profFail=!prof.ok;
  S.sources=srcs&&srcs.ok&&isObj(srcs.data)?arr(srcs.data.sources):null;
  if(fields&&fields.ok&&isObj(fields.data)){S.fields=fields.data;S.cat=catalog(S.fields)}
  S.failed=[S.sum,S.states].filter(x=>!x).length;S.fatal=!S.sum&&!S.states;S.wave=true;paint();
  await Promise.all([loadRank(false),loadHomes(false),loadScope(),mfLoad(),reP.then(()=>{paint();if(sheetOpen('zip'))zipPaint()})]);S.ready=true;watchAreas()}
 // the metro apartment rent change (a cbsa context field) for the multifamily lens and the ZIP sheet: read once, only when the build
 // has the field, as two keys a metro (cbsa and the value), joined on each row's cbsa
 const MF_CTX='zm_zori_mf_yoy';
 function mfLoad(){if(S.mfCtx!==undefined&&S.mfCtx!==null||S.mfP||!S.cat.has(MF_CTX))return S.mfP||Promise.resolve();
  S.mfP=get('housing/national?part=metros&fields=cbsa,'+MF_CTX).then(r=>{const rows=r&&r.ok&&r.data?arr(r.data.metros):null;
   S.mfCtx=rows?new Map(rows.filter(m=>isObj(m)&&m.cbsa!=null&&num(m[MF_CTX])!=null).map(m=>[String(m.cbsa),m[MF_CTX]])):null;S.mfP=null;paint();if(sheetOpen('zip'))zipPaint()});
  return S.mfP}
 function rerank(){filtersSave(S.f);S.rows=[];S.rank=null;S.bestN=null;paint();loadRank(false)}
 // a lens keeps the sort when its column is in that lens, else the lens's own lead (Score, Multifamily score); the read stays when
 // the sort stays, since one answer carries both lenses' columns. A lens saved from an earlier visit applies the same rule on load
 function lensSortApply(){const s=lensSort(S.lens,S.f.sort);if(s===S.f.sort)return false;S.f.sort=s;S.f.dir=null;return true}
 function setLens(l){const lens=l==='mf'?'mf':'res';if(lens===S.lens)return;S.lens=lens;viewSave(S);
  if(lensSortApply())rerank();else paint();if(lens==='mf')mfLoad()}
 // a header tap sorts by that column best first; a second tap on the sorted column flips the direction the server used
 function sortBy(key){const d=defOf(key),id=d&&colSort(d,true);if(!id)return;const data=S.rank&&S.rank.data;
  if(id===S.f.sort&&isObj(data)&&(data.sort_dir==='asc'||data.sort_dir==='desc'))S.f.dir=data.sort_dir==='asc'?'desc':'asc';else{S.f.sort=id;S.f.dir=null}
  rerank()}
 // the budget's own Try again: the read once more, then the list under it, with no page reload (ReviewSix, #399)
 async function profRetry(){const p=await profRead();S.prof=p.data;S.profFail=!p.ok;rerank()}
 // ---- sheets: one open dialog at a time; a repaint of the same sheet updates it in place
 function sheet(kind,o,opener){if(typeof DeckShell==='undefined'||!DeckShell.sheet)return null;const d=S.dlg;
  if(d&&d.isConnected&&d.open&&S.dlgKind===kind){const h=d.querySelector('.sheet-h h2'),p=d.querySelector('.sheet-h p'),b=d.querySelector('.sheet-b'),ac=d.querySelector('.sheet-a');
   if(h&&o.title!=null)h.textContent=o.title;if(p&&o.sub!=null)p.textContent=o.sub;if(b)b.innerHTML=o.body||'';if(ac&&o.actions!=null)ac.innerHTML=o.actions;return d}
  S.dlg=DeckShell.sheet.open(Object.assign({opener},o));S.dlgKind=kind;return S.dlg}
 const sheetOpen=kind=>!!(S.dlg&&S.dlg.isConnected&&S.dlg.open&&S.dlgKind===kind);
 const closeSheet=()=>{if(typeof DeckShell!=='undefined'&&DeckShell.sheet)DeckShell.sheet.close();S.dlg=null;S.dlgKind=''};
 // ---- ZIP sheet: the record carries its history; the hist route fills in when it does not. part=metrics (each metric's member
 // fields) is read once, when the first sheet opens and never with the page. A record with no rejected metric draws at once; one
 // with a rejected metric waits at most 1.5 s for the members (so a member row never flashes its raw number), then draws with
 // what it has and redraws when they arrive
 function membersLoad(){if(S.members)return Promise.resolve(S.members);
  if(!S.membersP)S.membersP=get('housing/national?part=metrics').then(r=>{const ms=r&&r.ok&&r.data&&isObj(r.data.metrics)?r.data.metrics:null;S.membersP=null;S.membersFail=!ms;if(!ms)return null;
   const m=new Map(),lim=new Map();for(const id of Object.keys(ms)){if(!isObj(ms[id]))continue;for(const f of arr(ms[id].members))if(typeof f==='string'&&!m.has(f))m.set(f,id);
    if(arr(ms[id].limits).length)lim.set(id,arr(ms[id].limits).filter(isObj))}
   S.members=m;S.limits=lim;return m});
  return S.membersP}
 async function openZip(zip,opener){if(!/^\d{5}$/.test(String(zip)))return;S.find='';S.finding=false;S.zip=null;
  sheet('zip',DeckUI.detail({title:zip,sub:'Residential',body:DeckUI.skeleton('row'),wide:true,scope:'zip:'+zip}),opener);const mp=membersLoad();
  const r=await get('housing/zip/'+zip);let rec=r&&isObj(r.data)?r.data:null;if(!rec&&r&&r.status===404)rec={error:'unknown zip'};
  if(rec&&!rec.hist&&!rec.error&&rec.status!=='not_reporting'){const h=await get('housing/zip/'+zip+'/hist');if(h&&h.ok&&isObj(h.data))rec.hist=h.data.hist}
  const rejected=isObj(rec)&&isObj(rec.m)&&Object.keys(rec.m).some(k=>whyOf(rec,k));
  if(rejected&&!S.members)await Promise.race([mp,new Promise(res=>setTimeout(res,1500))]);
  if(!sheetOpen('zip'))return;S.zip=rec||{error:'no answer',zip};zipPaint();if(!S.members)mp.then(()=>{if(sheetOpen('zip'))zipPaint()})}
 function zipPaint(){if(!sheetOpen('zip'))return;const rec=S.zip,rz=isObj(rec)?String(rec.zip||''):'',z=zipModel(rec,{summary:S.sum,prof:S.prof,cat:S.cat,members:S.members,limits:S.limits,membersFail:S.membersFail,area:rz?areaByZip(S.re,rz):null,mfCtx:S.mfCtx}),zip=z.zip||rz;
  const hs=z.state==='ok'?z.sections.find(s=>s.id==='homes'):null,find=hs&&!arr(hs.listings).length;
  const act=find?'<button type="button" class="btn btn-primary" data-re-find="'+esc(zip)+'"'+(S.finding?' disabled':'')+'>'+(S.finding?'Finding homes\u2026':'Find homes for sale')+'</button>':'';
  sheet('zip',DeckUI.detail({title:z.state==='ok'?z.title:zip||'ZIP',sub:'Residential',body:zipBody(z,S,Date.now()),actions:act,wide:true,scope:'zip:'+zip}))}
 async function findHomes(zip){if(S.finding)return;S.finding=true;S.find='';zipPaint();let j=null;
  j=await post('/api/housing/zip/'+encodeURIComponent(zip)+'/listings');
  S.finding=false;S.find=j&&j.ok?'':j&&num(j.retry_s)!=null?'Try again in '+F().age(j.retry_s)+'.':'That did not go through. Try again.';
  if(j&&j.ok){const r=await get('housing/zip/'+zip);if(r&&r.ok&&isObj(r.data))S.zip=Object.assign(r.data,{hist:r.data.hist||(S.zip&&S.zip.hist)})}zipPaint()}
 // a county's or the country's row in Your markets opens its own numbers from the feed
 function openArea(slug,opener){const m=areaModel(areaBySlug(S.re,slug));
  sheet('area',DeckUI.detail({title:m?m.title:'Your markets',sub:m?['Your markets',m.sub].filter(Boolean).join(' \u00b7 '):'',body:areaBody(m),scope:'area:'+slugOk(slug)}),opener)}
 // a city name lists its ZIPs, best score first; a tap opens the ZIP sheet
 async function openCity(q,opener){sheet('city',{id:'re-city',title:q,sub:'ZIPs',body:DeckUI.skeleton('row')},opener);
  const r=await get('housing/rank?kind=housing&q='+encodeURIComponent(q)+'&limit=50');if(!sheetOpen('city'))return;const rows=r&&r.ok&&r.data?arr(r.data.rows).filter(isObj):[];
  sheet('city',{title:q,sub:'ZIPs',body:rows.length?'<div class="flist">'+rows.map(x=>{const s=fmtVal('score',x.h_score);
   return '<button type="button" class="frow" data-open="zip" data-key="'+esc(x.zip)+'"><span class="fl"><b>'+esc(x.zip+' '+(x.city||''))+'</b><small>'+esc(x.state||'')+'</small></span>'+(s?'<span class="fr"><b>'+esc(s.value)+'</b><small>score</small></span>':'')+'</button>'}).join('')+'</div>'
   :DeckUI.empty({title:'No ZIP matches that city.'})})}
 // the budget form sits behind Within budget and the pro forma's Edit; its amounts need Show amounts. A budget the read did not
 // bring has no form: the fields would be empty and Save would write them over the owner's own profile
 function budgetSheet(opener){const rev=moneyShown();
  if(S.profFail){sheet('budget',{id:'re-budget',title:'Budget',sub:'Not loaded',actions:'',
   body:'<p class="note" role="status">The budget did not load, so there is no form to fill yet. <button type="button" class="btn btn-sm" data-re-profretry="1">Try again</button></p>'},opener);return}
  sheet('budget',{id:'re-budget',title:'Budget',sub:'Within budget uses these',body:rev?pfForm(S.prof):'<p class="note">Amounts are hidden.</p>',
   actions:rev?'<button type="button" class="btn btn-primary" data-re-pf-save>Save</button>':DeckUI.amountsBtn(false)},opener)}
 async function budgetSave(){const f=S.dlg&&S.dlg.querySelector('form[data-re-pf]');if(!f)return;const msg=f.querySelector('[data-re-pf-msg]');
  const vals={};for(const el of f.elements)if(el.name)vals[el.name]=el.value;const out=pfBody(vals);if(out.error){if(msg)msg.textContent=out.error;return}
  if(msg)msg.textContent='Saving\u2026';let j=null;
  j=await post('/api/housing/profile',out.body);
  if(j&&j.ok){S.prof=j;S.profFail=false;closeSheet();rerank()}else if(msg)msg.textContent='Not saved. Try again.'}
 function wire(){if(S.wired||typeof document==='undefined')return;S.wired=true;
  // sheets live outside the page container: clicks count when they are in the page, or in a sheet this page opened
  document.addEventListener('click',e=>{const t=e.target&&e.target.closest?e.target:null;if(!t||!S.ctx)return;
   const inPage=!!(S.ctx.el&&S.ctx.el.contains(t)),inSheet=!!(S.dlg&&S.dlg.contains(t));if(!inPage&&!inSheet)return;let b;
   if((b=t.closest('[data-open="zip"]'))){openZip(b.dataset.key,b);return}
   if((b=t.closest('[data-open="area"]'))){openArea(b.dataset.key,b);return}
   if((b=t.closest('[data-re-find]'))){findHomes(b.dataset.reFind);return}
   if((b=t.closest('[data-re-pf-save]'))){budgetSave();return}
   if((b=t.closest('[data-re-budget]'))){budgetSheet(b);return}
   if((b=t.closest('[data-re-members]'))){S.membersFail=false;zipPaint();membersLoad().then(()=>{if(sheetOpen('zip'))zipPaint()});return}
   if((b=t.closest('[data-re-profretry]'))){profRetry();return}
   if(!inPage)return;
   if((b=t.closest('[data-re-map]'))){S.mapK=b.dataset.reMap;paint();return}
   if((b=t.closest('[data-re-lens]'))){const l=b.dataset.reLens;setLens(l);const n=S.ctx.el.querySelector('[data-re-lens="'+(l==='mf'?'mf':'res')+'"]');if(n)n.focus();return}
   if((b=t.closest('[data-re-morecols]'))){S.more=!S.more;viewSave(S);paint();const m=S.ctx.el.querySelector('[data-re-morecols]');if(m)m.focus();return}
   if((b=t.closest('.re-best th [data-sort]'))){sortBy(b.dataset.sort);return}
   if((b=t.closest('.usmap .st[data-st]'))){S.sel=S.sel===b.dataset.st?'':b.dataset.st;paint();const c=S.ctx.el.querySelector('[data-re-view-st]');if(c)c.focus();return}
   if((b=t.closest('[data-re-view-st]'))){S.sel='';DeckScope.set({kind:'state',state:b.dataset.reViewSt});return}
   if((b=t.closest('[data-re-area]'))){if(b.dataset.reArea==='state')DeckScope.set({kind:'state',state:b.dataset.key});else DeckScope.set({kind:'metro',metro:b.dataset.key});return}
   if((b=t.closest('[data-re-more="zips"]'))){loadRank(true);return}
   if((b=t.closest('[data-re-more="cards"]'))){const n=+b.dataset.n||0;S.bestN=n>=S.rows.length?0:n;paint();return}
   if((b=t.closest('[data-re-less="cards"]'))){S.bestN=null;paint();const sec=S.ctx.el.querySelector('.re-best');if(sec&&sec.getBoundingClientRect().top<0)sec.scrollIntoView({block:'start'});
    const m=sec&&sec.querySelector('[data-re-more]');if(m)m.focus();return}
   if((b=t.closest('[data-re-within]'))){S.f.within=b.dataset.reWithin==='1';rerank();return}
   if((b=t.closest('[data-re-more="homes"]'))){loadHomes(true);return}
   if((b=t.closest('[data-re-htype]'))){S.hf.type=b.dataset.reHtype;S.homeRows=[];S.homes=null;paint();loadHomes(false);return}
   if((b=t.closest('[data-re-beds]'))){S.hf.beds=+b.dataset.reBeds||0;S.homeRows=[];S.homes=null;paint();loadHomes(false);return}
   if((b=t.closest('[data-re-clear]'))){Object.assign(S.f,{grade:'',within:false,max:null,minPop:0});rerank();return}
   // removable chips and the sheet's Clear (DeckUI.filters: data-clear="<key>" or "*")
   if((b=t.closest('[data-clear]'))){const k=b.dataset.clear;if(k==='*')Object.assign(S.f,{grade:'',within:false,max:null,minPop:0});else if(k==='grade')S.f.grade='';else if(k==='within')S.f.within=false;else if(k==='max')S.f.max=null;else if(k==='minPop')S.f.minPop=0;else return;rerank()}});
  document.addEventListener('change',e=>{const t=e.target;if(!t||!t.dataset||!S.ctx||!(S.ctx.el&&S.ctx.el.contains(t))&&!t.closest('.fbar-panel'))return;
   if(t.dataset.reHq!=null){S.hf.q=t.value;S.homeRows=[];S.homes=null;loadHomes(false);return}
   if(t.dataset.reHmax!=null||t.dataset.reHsort!=null){if(t.dataset.reHmax!=null)S.hf.max=Math.max(0,+t.value||0);else S.hf.sort=HSORTS.some(s=>s[0]===t.value)?t.value:'feed';
    S.homeRows=[];S.homes=null;paint();loadHomes(false);return}
   const k=t.dataset.reFf;if(!k)return;const n=Number(String(t.value).replace(/[$,\s]/g,''));
   if(k==='grade')S.f.grade=GRADES.some(g=>g[0]===t.value)?t.value:'';else if(k==='sort'){S.f.sort=SORTS.some(s=>s[0]===t.value)?t.value:'score';S.f.dir=null}
   else if(k==='within')S.f.within=!!t.checked;else if(k==='minPop')S.f.minPop=isFinite(n)&&n>0?Math.round(n):0;
   else if(k==='max'){if(/\u2022/.test(t.value))return;S.f.max=t.value!==''&&isFinite(n)&&n>0?Math.round(n):null}else return;rerank()});
  // typing a new max price replaces the masked one
  document.addEventListener('focusin',e=>{const t=e.target;if(t&&t.dataset&&t.dataset.reFf==='max'&&/\u2022/.test(t.value))t.value=''});
  // the filter bar's chips and count catch up when the Filters sheet closes
  document.addEventListener('close',e=>{const t=e.target;if(S.ctx&&S.ctx.el&&t&&t.classList&&t.classList.contains('fbar-panel')&&S.ctx.el.contains(t))paint()},true);
  // a filter row held through a repaint (F13) catches up once focus has left it
  document.addEventListener('focusout',e=>{if(!S.barStale||!S.ctx||!S.ctx.el)return;const bar=S.ctx.el.querySelector('.re-fbar');if(!bar||!bar.contains(e.target))return;
   setTimeout(()=>{if(!S.barStale||!S.ctx||!S.ctx.el)return;const b=S.ctx.el.querySelector('.re-fbar');if(!b||barHeld(b,document.activeElement)||b.querySelector('.fbar-panel[open]'))return;
    S.barStale=false;b.innerHTML=filtersHtml(S);DeckScope.mount(S.ctx,{onZip:openZip,onCity:openCity,suggest})},0)});
  // Show amounts and Hide repaint the page and the open sheet; nothing revealed is kept after Hide
  document.addEventListener('deck:money',()=>{if(!S.ctx)return;paint();if(sheetOpen('zip'))zipPaint();else if(sheetOpen('budget'))budgetSheet()})}
 const page={
  // a new scope brings the population default back unless the owner typed a floor
  show(ctx){S.ctx=ctx;wire();if(!S.unsub)S.unsub=DeckScope.onChange(()=>{S.sel='';S.rows=[];S.rank=null;S.bestN=null;S.homeRows=[];S.homes=null;if(S.f&&S.f.minPop===0){S.f.minPop=null;filtersSave(S.f)}paint();loadRank(false);loadHomes(false);loadScope()});
   // a rotation or resize that changes the class repaints (phone cards against the table, TV board)
   if(!S.offCls&&typeof DeckPages!=='undefined'&&DeckPages.onClass)S.offCls=DeckPages.onClass(d=>{if(S.ctx&&d&&d.cls&&d.cls!==S.cls)paint()});
   if(!S.loaded||S.fatal||S.failed||Date.now()-S.loaded>600000)load();else paint()},
  refresh(ctx){S.ctx=ctx;load()},
  every:600000,
  hide(){if(S.unsub){S.unsub();S.unsub=null}if(S.offCls){S.offCls();S.offCls=null}if(S.io){S.io.disconnect();S.io=null}DeckScope.close();S.ctx=null},
  data(ctx,scope){const z=typeof scope==='string'&&/^zip:\d{5}$/.test(scope)&&isObj(S.zip)&&String(S.zip.zip)===scope.slice(4)?S.zip:null;
   return dataModel({sources:S.sources,summary:S.sum,cat:S.cat,zip:z,strip:S.tiles,where:S.where,re:S.re})}};
 if(typeof window!=='undefined'&&typeof DeckPages!=='undefined'&&DeckPages.register)DeckPages.register('realestate/residential',page);
 return {GRADES,SORTS,MAP,STRIP,NINE,BEST_RES,BEST_MORE,BEST_MF,LENSES,VIEW_KEY,PAGE,HOMES,FILTER_KEY,MIN_POP_DEFAULT,AREA_ROWS,BEST_STEPS,BEST_WIDE,HPRICES,HSORTS,filtersLoad,filtersSave,viewLoad,viewSave,minPopOf,sortParam,sortUsed,colSort,rankCols,rankQuery,budgetOf,budgetUnloaded,filterChips,filterCount,confOf,
  stripModel,rate15Of,mapModel,areasModel,mineModel,areaModel,areaBody,areaBySlug,areaByZip,homesQuery,homeRow,proForma,pfBody,pfForm,zipModel,dataModel,pageStatus,fmtVal,bestCols,cellHtml,rateLine,lensSort,fromOf,
  stripHtml,mapHtml,areasHtml,bestHtml,bestShown,mineHtml,homesHtml,riskHtml,filtersHtml,boardHtml,pageHtml,zipBody,barHeld,page,_S:S,_paint:paint}
})();
if(typeof window!=='undefined'){window.DeckScope=DeckScope;window.DeckRE=DeckRE}
