// Real estate > Markets (owner order 2026-11-17): compare states and metros by property segment (Residential, Multifamily, Retail,
// Office, Industrial, People and jobs). Data: /api/housing/national?part=segments (the segments spec cut to the fields this build
// carries, with labels, units, direction and sources) and ?part=states|metros&fields=<row keys + segment fields> (Your markets adds
// state=CA). The page shows values and one freshness mark; sources and method live in the Data sheet. A missing value prints the
// table's dot, never 0. Pure models first (tests/markets_*.test.js load the block with DeckUI), then the live page.
// ==== DECK MARKETS PURE BEGIN (no DOM, no fetch) ====
const DeckMarkets=(()=>{
 const {esc,isObj,arr,num}=DeckCore;
 const F=()=>DeckUI.fmt;
 // Your markets: California and the three home metros (LA-Long Beach-Anaheim, San Diego, Riverside-San Bernardino), in this order
 const HOME_STATE='CA',HOME_METROS=['31080','41740','40140'];
 const LEVELS=[['states','States'],['metros','Metros'],['mine','Your markets']];
 const PAGE=50,MAX_KEYS=98;
 const levelOk=l=>LEVELS.some(x=>x[0]===l)?l:'states';
 const levelLabel=l=>(LEVELS.find(x=>x[0]===l)||LEVELS[0])[1];
 const segs=spec=>arr(isObj(spec)?spec.segments:null).filter(s=>isObj(s)&&typeof s.id==='string');
 const segOf=(spec,id)=>{const l=segs(spec);return l.find(s=>s.id===id)||l[0]||null};
 const fieldsOf=seg=>arr(seg&&seg.fields).filter(f=>typeof f==='string'&&/^[a-z0-9_]{1,40}$/.test(f)).slice(0,MAX_KEYS-2);
 const enc=encodeURIComponent;
 const listUrl=(part,keys,st)=>'housing/national?part='+part+(st?'&state='+st:'')+'&fields='+keys.map(enc).join(',');
 // the reads a level and segment need: one list (states or metros), or both cut to California for Your markets
 function listQueries(level,seg){const f=fieldsOf(seg),l=levelOk(level);
  if(l==='mine')return [{part:'states',q:listUrl('states',['state','name'].concat(f),HOME_STATE)},{part:'metros',q:listUrl('metros',['cbsa','name'].concat(f),HOME_STATE)}];
  return [{part:l,q:listUrl(l,(l==='states'?['state','name']:['cbsa','name']).concat(f))}]}
 // a metro name "San Diego-Chula Vista-Carlsbad, CA" splits into its place and its state codes
 const metroParts=n=>{const s=String(n||''),i=s.lastIndexOf(', ');return i<0?{place:s,st:''}:{place:s.slice(0,i),st:s.slice(i+2)}};
 const stateRow=r=>isObj(r)&&typeof r.state==='string'&&/^[A-Z]{2}$/.test(r.state.toUpperCase())?{key:r.state.toUpperCase(),kind:'state',name:typeof r.name==='string'&&r.name?r.name:r.state.toUpperCase(),sub:r.state.toUpperCase(),v:r}:null;
 const metroRow=r=>{if(!isObj(r)||!/^\d{5}$/.test(String(r.cbsa||'')))return null;const p=metroParts(r.name);return {key:String(r.cbsa),kind:'metro',name:p.place||String(r.cbsa),full:typeof r.name==='string'?r.name:'',sub:p.st,v:r}};
 // rows of a level from the lists read: {key, kind, name, sub, full, v (the row's values)}
 function rowsOf(level,data){const d=isObj(data)?data:{},l=levelOk(level);
  const st=arr(d.states).map(stateRow).filter(Boolean),me=arr(d.metros).map(metroRow).filter(Boolean);
  if(l==='states')return st;if(l==='metros')return me;
  return st.filter(r=>r.key===HOME_STATE).concat(HOME_METROS.map(c=>me.find(r=>r.key===c)).filter(Boolean))}
 // ---- formats by the catalog's unit. A percent that is a change (1-yr change, trend, forecast) carries its sign; an interest
 // rate, cap rate or yield reads with two decimals as it does on Residential (30-yr rate 7.11%); other shares keep one.
 const CHANGE=/(_yoy|_trend|trend_|change|growth|forecast)/;
 const RATE2=/^(mortgage_rate|gross_yield)$|treasury|_cap$|^crel_cap_/;
 const one=x=>(Math.round(x*10)/10).toFixed(1);
 function fmtField(meta,v,id){const x=num(v);if(x==null)return null;const f=F(),u=isObj(meta)?meta.unit:null;
  switch(u){case 'usd':return f.money(x);case 'usd_month':return f.rent(x);case 'usd_sqft':return f.psf(x,{cents:x<100});
   case 'pct':return CHANGE.test(String(id||''))?f.chg(x):RATE2.test(String(id||''))?f.rate(x):f.share(x);case 'pct_pts':return f.pt(x,2);
   case 'count':return f.count(x);case 'days':return f.count(Math.round(x));case 'sqft':return f.count(x)+'\u00a0SF';
   case 'score':case 'years':case 'year':return String(Math.round(x));case 'kwh_cents':return one(x)+'\u00a2';
   case 'ratio':case 'per_1k':case 'per_100k':case 'index':return one(x);
   default:return DeckCore.trim0(x.toFixed(2))}}
 const labelOf=(fields,id)=>{const m=isObj(fields)?fields[id]:null;return m&&typeof m.label==='string'&&m.label?m.label:String(id).replace(/_/g,' ')};
 const metaOf=(fields,id)=>isObj(fields)&&isObj(fields[id])?fields[id]:{};
 const lowerBetter=(fields,id)=>metaOf(fields,id).better==='lower';
 const has=(rows,id)=>rows.some(r=>num(r.v[id])!=null);
 // a column needs values in at least 3 rows and a tenth of a long list (20 rows or more); a field only a few places publish
 // (asking cap rates from the Southern California listings) stays in each row's sheet instead of an empty-looking column
 const count=(rows,id)=>rows.reduce((n,r)=>n+(num(r.v[id])!=null?1:0),0);
 const enough=(rows,id)=>{const n=count(rows,id);return rows.length<20?n>0:n>=Math.max(3,Math.ceil(rows.length/10))};
 // ---- levels: a field's geography from the catalog (the server gives a metro or state plugin's field its source's level).
 // metro, state, or null: a ZIP, tract or county field rolled up to any row, or a blend
 const LV={cbsa:'metro',metro:'metro',state:'state'};
 const levelOf=(fields,id)=>LV[metaOf(fields,id).level]||null;
 // States show no metro-only field and Metros no state-only field: such a column could never hold a value there
 const fitsLevel=(fields,id,l)=>{const v=levelOf(fields,id);return !(l==='states'&&v==='metro'||l==='metros'&&v==='state')};
 // the measure behind a level word: "Metro homes for sale (Redfin)" and "State homes for sale (Redfin)" are one measure
 const measure=l=>{const s=String(l||'').replace(/^(Metro|State)\s+/,'');return s.charAt(0).toUpperCase()+s.slice(1)};
 // Your markets mixes the state row with metro rows: a metro field and a state field of the same measure and unit share one
 // column (the metro field's id), the state row reading its state field. Map metro id -> state id
 function pairsOf(ids,fields){const out=new Map(),taken=new Set();
  for(const id of ids){if(levelOf(fields,id)!=='metro')continue;const k=measure(labelOf(fields,id)),u=metaOf(fields,id).unit;
   const s=ids.find(x=>!taken.has(x)&&levelOf(fields,x)==='state'&&measure(labelOf(fields,x))===k&&metaOf(fields,x).unit===u);if(s){out.set(id,s);taken.add(s)}}
  return out}
 // the labels of fields on one screen, unique: a label two fields share takes their level word, else their publisher
 // ("Median sale price, multifamily 2-4 units (ZIP data)"); a shared column names its measure without the level word
 const LEVEL_WORD={cbsa:'metro',metro:'metro',state:'state',zip:'ZIP data',tract:'ZIP data',county:'county data',us:'US'};
 function labelsFor(ids,fields,pairs){const p=pairs instanceof Map?pairs:new Map(),base=new Map(),groups=new Map(),out=new Map();
  for(const id of ids){const l=p.has(id)?measure(labelOf(fields,id)):labelOf(fields,id);base.set(id,l);groups.set(l,(groups.get(l)||[]).concat(id))}
  const word=id=>LEVEL_WORD[metaOf(fields,id).level]||'',pub=id=>{const s=arr(metaOf(fields,id).sources)[0];return isObj(s)?String(s.publisher||s.name||''):''};
  for(const [l,g] of groups){if(g.length<2){out.set(g[0],l);continue}
   const tags=[word,pub].map(fn=>g.map(fn)).find(t=>t.every(Boolean)&&new Set(t).size===g.length);
   g.forEach((id,i)=>out.set(id,l+' ('+(tags?tags[i]:(word(id)||pub(id)||'field')+' '+(i+1))+')'))}
  return out}
 // the columns: the segment's fields that fit the level and hold a value in these rows, the lead first; the rest are named once
 // as not reported. o: {level, fields}. rows: the level's rows, a state row's shared columns filled from its state field
 function columns(seg,rows,o){o=isObj(o)?o:{};const l=levelOk(o.level),fields=o.fields;
  const all=fieldsOf(seg).filter(id=>fitsLevel(fields,id,l)),pairs=l==='mine'?pairsOf(all,fields):new Map(),paired=new Set(pairs.values());
  const f=all.filter(id=>!paired.has(id)),lp=seg?[...pairs].find(x=>x[1]===seg.lead):null,lead=seg&&f.includes(seg.lead)?seg.lead:lp?lp[0]:f[0];
  const rs=pairs.size?arr(rows).map(r=>{if(r.kind!=='state')return r;const v=Object.assign({},r.v);for(const [m,s] of pairs)v[m]=r.v[s];return Object.assign({},r,{v})}):arr(rows);
  const shown=f.filter(id=>enough(rs,id)),hidden=f.filter(id=>!has(rs,id)),sparse=f.filter(id=>has(rs,id)&&!enough(rs,id));
  const cols=shown.includes(lead)?[lead].concat(shown.filter(x=>x!==lead)):shown;return {cols,hidden,sparse,lead:cols[0]||null,pairs,rows:rs}}
 // the sort: a column the reader picked while it is on screen, else the lead; direction from the catalog's better
 function sortOf(seg,fields,cols,want){const w=isObj(want)?want:{};
  if(w.key&&cols.includes(w.key))return {key:w.key,dir:w.dir==='ascending'?'ascending':'descending'};
  const k=cols[0]||null;return {key:k,dir:k&&lowerBetter(fields,k)?'ascending':'descending'}}
 // the next sort after a tap on a column head: the same column flips, a new one starts at its better end
 const nextSort=(cur,key,fields)=>isObj(cur)&&cur.key===key?{key,dir:cur.dir==='ascending'?'descending':'ascending'}:{key,dir:lowerBetter(fields,key)?'ascending':'descending'};
 const matches=(r,q)=>{const t=String(q||'').trim().toLowerCase();if(!t)return true;
  return r.name.toLowerCase().includes(t)||(r.full||'').toLowerCase().includes(t)||(r.kind==='state'&&r.key.toLowerCase()===t)};
 // the table model: rows ranked by the sort column over the whole level (a row with no value there has no rank and sits last), then
 // cut to the search. shown: rows on screen. labels: each column's label, unique on this screen
 function model(o){o=isObj(o)?o:{};const seg=o.seg,fields=isObj(o.fields)?o.fields:{},level=levelOk(o.level);
  const c=columns(seg,o.rows,{level,fields}),all=c.rows,sort=sortOf(seg,fields,c.cols,o.sort);
  const sorted=sort.key?DeckUI.sortRows(all,r=>num(r.v[sort.key]),sort.dir):all.slice();
  let n=0;const ranked=sorted.map(r=>Object.assign({},r,{rank:sort.key&&num(r.v[sort.key])!=null?++n:null}));
  const rows=ranked.filter(r=>matches(r,o.q)),shown=Math.max(PAGE,Math.round(num(o.shown)||PAGE));
  return {level,seg:seg?{id:seg.id,label:seg.label}:null,cols:c.cols,hidden:c.hidden,sparse:c.sparse,pairs:c.pairs,labels:labelsFor(c.cols,fields,c.pairs),
   sort,rows,total:rows.length,all:all.length,shown:Math.min(shown,rows.length),q:String(o.q||'').trim()}}
 const colLabel=(m,fields,id)=>m&&m.labels instanceof Map&&m.labels.has(id)?m.labels.get(id):labelOf(fields,id);
 const placeHead=l=>l==='metros'?'Metro':l==='mine'?'Market':'State';
 // a missing value: a quiet dash that says "No data" to a screen reader, never 0
 const NA_DASH='<span class="na" aria-label="No data">-</span>';
 function tableHtml(m,fields){if(!m.cols.length)return '';
  const cols=[{key:'name',label:placeHead(m.level),place:true}].concat(m.cols.map(id=>({key:id,label:colLabel(m,fields,id),num:true,sort:true})));
  const cell=(r,c)=>{if(c.key==='name')return '<span class="place mkt-pl"><b>'+(r.rank!=null?'<span class="mkt-rk">'+r.rank+'</span>':'')+esc(r.name)+'</b>'+(r.sub?'<small>'+esc(r.sub)+'</small>':'')+'</span>';
   const v=fmtField(fields[c.key],r.v[c.key],c.key);return v==null?NA_DASH:esc(v)};
  return DeckUI.table({cols,rows:m.rows.slice(0,m.shown),presorted:true,sorted:m.sort.key?m.sort:null,max:m.shown,cell,key:r=>r.key,open:'mkt',
   label:(m.seg?m.seg.label:'Markets')+' by '+placeHead(m.level).toLowerCase()}).replace('<div class="htw">','<div class="htw scroll mkt-tw">')}
 // the line over the table: what ranks it and how many rows there are. The label reads in the sentence with its first letter
 // lowered; an acronym (CMBS) and the publisher in brackets keep their case
 const lowerFirst=s=>/^[A-Z][a-z]/.test(s)?s.charAt(0).toLowerCase()+s.slice(1):s;
 function headLine(m,fields){if(!m.sort.key)return '';const n=m.q?m.total+' of '+m.all:String(m.all);
  return 'Ranked by '+lowerFirst(colLabel(m,fields,m.sort.key))+(m.sort.dir==='ascending'?', lowest first':', highest first')+' \u00b7 '+n+' '+(m.level==='metros'?'metros':m.level==='mine'?'markets':'states')}
 // ---- the row sheet: every segment for one geography (kind state or metro: only the fields that fit it), each field labelled
 // uniquely within its segment, values formatted, missing ones named once per segment
 const kindLevel=kind=>kind==='metro'?'metros':kind==='state'?'states':'mine';
 function sheetModel(spec,fields,row,kind){const out=[];if(!isObj(row))return {sections:out};
  for(const s of segs(spec)){const items=[],miss=[],ids=fieldsOf(s).filter(id=>fitsLevel(fields,id,kindLevel(kind))),lab=labelsFor(ids,fields);
   for(const id of ids){const v=fmtField(fields[id],row[id],id);if(v==null)miss.push(lab.get(id));else items.push({key:id,label:lab.get(id),value:v})}
   if(items.length||miss.length)out.push({id:s.id,label:typeof s.label==='string'?s.label:s.id,items,missing:miss})}
  return {sections:out}}
 function sheetHtml(sm,link){const secs=arr(sm&&sm.sections);
  const body=secs.map(s=>'<section class="sh-sec mkt-sh" data-seg="'+esc(s.id)+'"><h3>'+esc(s.label)+'</h3>'+
   (s.items.length?'<dl class="kv">'+s.items.map(i=>'<div><dt>'+esc(i.label)+'</dt><dd>'+esc(i.value)+'</dd></div>').join('')+'</dl>':'<p class="note">No values for this segment.</p>')+
   DeckUI.missing(s.missing)+'</section>').join('');
  return (link||'')+(body||DeckUI.empty({k:'idle',title:'No values for this market.'}))}
 // the reads behind a row sheet: every segment's fields (no repeats) in chunks the server takes, cut to the row's state
 function sheetQueries(spec,kind,key,name){const all=[],fc=isObj(spec)?spec.fields:null;
  for(const s of segs(spec))for(const f of fieldsOf(s))if(!all.includes(f)&&fitsLevel(fc,f,kindLevel(kind)))all.push(f);
  const part=kind==='metro'?'metros':'states',keys=kind==='metro'?['cbsa','name']:['state','name'];
  const st=kind==='metro'?(metroParts(name).st.split('-')[0]||'').toUpperCase():String(key||'').toUpperCase();
  const out=[];for(let i=0;i<all.length;i+=MAX_KEYS-2)out.push(listUrl(part,keys.concat(all.slice(i,i+MAX_KEYS-2)),/^[A-Z]{2}$/.test(st)?st:''));
  return out.length?out:[listUrl(part,keys,/^[A-Z]{2}$/.test(st)?st:'')]}
 // one row from the chunked reads: the matching row of each answer merged
 function sheetRow(kind,key,answers){const part=kind==='metro'?'metros':'states',id=kind==='metro'?'cbsa':'state';let row=null;
  for(const a of arr(answers)){const r=arr(isObj(a)?a[part]:null).find(x=>isObj(x)&&String(x[id]).toUpperCase()===String(key).toUpperCase());if(r)row=Object.assign(row||{},r)}
  return row}
 // a row key from the address (?mkt=CA or ?mkt=31080): its kind, or null
 const keyKind=k=>/^[A-Z]{2}$/.test(String(k||''))?'state':/^\d{5}$/.test(String(k||''))?'metro':null;
 // ---- the Data sheet: sources of the fields on screen (publisher, period, what they give), the method, and what this build lacks
 // pairs: Your markets' shared columns (metro id -> state id), whose state field's sources count too
 function dataModel(o){o=isObj(o)?o:{};const fields=isObj(o.fields)?o.fields:{},seg=o.seg,cols=arr(o.cols),by=new Map(),pairs=o.pairs instanceof Map?o.pairs:new Map();
  const lab=labelsFor(cols,fields,pairs);
  for(const id of cols)for(const fid of [id].concat(pairs.has(id)?[pairs.get(id)]:[])){const m=fields[fid];for(const s of arr(m&&m.sources)){if(!isObj(s)||typeof s.id!=='string')continue;
   const k=s.id,e=by.get(k)||{name:typeof s.name==='string'&&s.name?s.name:k==='derived'?'Computed in the national build from other fields':k,asOf:s.as_of==null?'':s.as_of,labels:[]};
   if(!e.labels.includes(lab.get(id)))e.labels.push(lab.get(id));by.set(k,e)}}
  const sources=[...by.values()].map(e=>({name:e.name,gives:e.labels.slice(0,3).join(', ')+(e.labels.length>3?' and '+(e.labels.length-3)+' more':''),asOf:e.asOf,state:'ok'}));
  const method=[['Segments','Each segment lists its fields best first. A field this build does not produce is left out, never shown as zero.'],
   ['Rank','Rows rank by the sorted column over the whole list. A row without that value has no rank and sits last. Tap a column head to sort by it.'],
   ['Your markets','California and the Los Angeles-Long Beach-Anaheim, San Diego and Riverside-San Bernardino metros.'],
   ['Levels','State rows are the published state figures or the median of the state\u2019s ZIPs; metro rows the same for the metro\u2019s ZIPs.']];
  const skipped=arr(seg&&seg.skipped).length;if(skipped)method.push(['Not in this build',skipped+' '+(skipped===1?'field':'fields')+' of the '+(seg.label||'segment')+' spec are not produced yet.']);
  const hidden=arr(o.hidden);if(hidden.length){const hl=labelsFor(hidden,fields);method.push(['No values here',hidden.map(id=>hl.get(id)).join(', ')])}
  const sparse=arr(o.sparse);if(sparse.length){const sl=labelsFor(sparse,fields);method.push(['In row sheets only','Too few places publish these for a column; open a row to see them: '+sparse.map(id=>sl.get(id)).join(', ')])}
  return {sources,blends:[],method,setup:[]}}
 const segChips=(spec,cur)=>'<div class="chips scroll mkt-segs" role="group" aria-label="Segment">'+segs(spec).map(s=>'<button type="button" data-mkt-seg="'+esc(s.id)+'" aria-pressed="'+(s.id===cur)+'"'+(s.id===cur?' class="on"':'')+'>'+esc(s.label||s.id)+'</button>').join('')+'</div>';
 // the sheet's link: sets Residential's scope to this state (its code) or metro (its full name) and goes there
 const goLink=(kind,key)=>key?'<p class="mkt-go"><button type="button" class="btn" data-mkt-scope="'+(kind==='metro'?'metro':'state')+'" data-key="'+esc(key)+'">Open in Residential</button></p>':'';
 const levelSeg=cur=>'<div class="seg keep mkt-lv" role="group" aria-label="Level">'+LEVELS.map(([k,l])=>'<button type="button" data-mkt-level="'+k+'" aria-pressed="'+(k===cur)+'"'+(k===cur?' class="on"':'')+'>'+l+'</button>').join('')+'</div>';
 return {HOME_STATE,HOME_METROS,LEVELS,PAGE,MAX_KEYS,levelOk,levelLabel,segs,segOf,fieldsOf,listQueries,metroParts,rowsOf,fmtField,labelOf,levelOf,fitsLevel,pairsOf,labelsFor,
  columns,sortOf,nextSort,model,tableHtml,headLine,sheetModel,sheetHtml,sheetQueries,sheetRow,keyKind,dataModel,segChips,levelSeg,goLink}})();
// ==== DECK MARKETS PURE END ====

// ---- the live page: registered under realestate/markets. Level, segment and sort are remembered per device.
(()=>{if(typeof window==='undefined'||typeof DeckPages==='undefined'||typeof DeckUI==='undefined')return;
 const M=DeckMarkets,K='re:markets';
 const load=()=>{try{const v=JSON.parse(localStorage.getItem(K)||'{}');return {level:M.levelOk(v.level),seg:typeof v.seg==='string'?v.seg:'residential',sort:v.sort&&typeof v.sort==='object'?v.sort:{}}}catch(e){return {level:'states',seg:'residential',sort:{}}}};
 const S=Object.assign(load(),{ctx:null,built:false,spec:null,specRes:null,lists:{},tok:0,q:'',shown:M.PAGE,last:0,sheetRow:null,sheetKey:''});
 const save=()=>{try{localStorage.setItem(K,JSON.stringify({level:S.level,seg:S.seg,sort:S.sort[S.seg]?{[S.seg]:S.sort[S.seg]}:{}}))}catch(e){}};
 const $=s=>S.ctx&&S.ctx.el.querySelector(s);
 const fields=()=>S.spec&&S.spec.fields&&typeof S.spec.fields==='object'?S.spec.fields:{};
 const seg=()=>M.segOf(S.spec,S.seg);
 const listKey=()=>S.level+'|'+(seg()?seg().id:'');
 function build(ctx){const el=ctx.el;
  el.innerHTML='<div class="mkt board"><div class="mkt-ctl"><div class="mkt-lvw"></div><label class="search mkt-search"><svg class="i" aria-hidden="true"><use href="#i-search"/></svg>'+
   '<input type="search" data-mkt-q placeholder="Find a state or metro" aria-label="Find a state or metro" autocomplete="off" enterkeyhint="search" spellcheck="false"></label></div>'+
   '<div class="mkt-segw"></div><section class="sect mkt-main"><h2 class="secttl"><span class="mkt-t"></span><span class="act mkt-line"></span></h2><div class="mkt-b"></div><div class="mkt-more"></div><div class="mkt-miss"></div></section></div>';
  el.addEventListener('click',onClick);
  el.addEventListener('keydown',e=>{if(e.key!=='Enter')return;const r=e.target.closest&&e.target.closest('tr[data-open="mkt"]');if(r){e.preventDefault();openRow(r.dataset.key,r)}});
  el.addEventListener('input',e=>{const t=e.target;if(t&&t.matches&&t.matches('input[data-mkt-q]')){S.q=t.value.slice(0,60);S.shown=M.PAGE;paintTable()}});
  S.built=true}
 function paintCtl(){const lv=$('.mkt-lvw'),sg=$('.mkt-segw');if(lv)lv.innerHTML=M.levelSeg(S.level);if(sg)sg.innerHTML=S.spec?M.segChips(S.spec,seg()?seg().id:''):''}
 function current(){const sg=seg();if(!sg)return null;const r=S.lists[listKey()];if(!r||r.pending)return {pending:true};if(!r.ok)return {bad:true};
  return M.model({level:S.level,seg:sg,fields:fields(),rows:M.rowsOf(S.level,r.data),sort:S.sort[sg.id],q:S.q,shown:S.shown})}
 function paintTable(){const b=$('.mkt-b');if(!b)return;const more=$('.mkt-more'),miss=$('.mkt-miss'),t=$('.mkt-t'),line=$('.mkt-line');more.innerHTML='';miss.innerHTML='';
  const sg=seg();t.textContent=sg?(sg.label||sg.id)+' \u00b7 '+M.levelLabel(S.level):'Markets';line.textContent='';
  if(S.specRes&&!S.specRes.ok){b.innerHTML=DeckUI.empty({k:'bad',title:'Markets data is not reporting.',retry:'markets'});return}
  if(!S.spec){b.innerHTML=DeckUI.skeleton('row',6);return}
  if(!sg){b.innerHTML=DeckUI.empty({k:'idle',title:'No segments in the national data yet.'});return}
  const m=current();if(!m||m.pending){b.innerHTML=DeckUI.skeleton('row',6);return}
  if(m.bad){b.innerHTML=DeckUI.empty({k:'bad',title:'Markets data is not reporting.',retry:'markets'});return}
  if(!m.cols.length){b.innerHTML=DeckUI.empty({k:'idle',title:'No '+(sg.label||'').toLowerCase()+' values for these markets yet.'});return}
  line.textContent=M.headLine(m,fields());
  b.innerHTML=m.rows.length?M.tableHtml(m,fields()):DeckUI.empty({k:'idle',title:'Nothing matches \u201c'+m.q+'\u201d.'});
  more.innerHTML=DeckCore.more({key:'mkt',shown:m.shown,total:m.total,step:M.PAGE,first:M.PAGE});
  miss.innerHTML=DeckUI.missing((l=>m.hidden.map(id=>l.get(id)))(M.labelsFor(m.hidden,fields())));
  tv()}
 async function readSpec(){const r=await DeckPages.get('housing/national?part=segments',{timeout:60000});S.specRes=r;
  S.spec=r.ok&&r.data&&Array.isArray(r.data.segments)?r.data:null;if(S.spec&&!M.segOf(S.spec,S.seg))S.seg=M.segs(S.spec)[0]?M.segs(S.spec)[0].id:S.seg}
 async function readList(force){const sg=seg();if(!sg)return;const k=listKey();if(!force&&S.lists[k]&&(S.lists[k].pending||S.lists[k].ok))return;
  S.lists[k]={pending:true};const t=++S.tok;paintTable();
  const qs=M.listQueries(S.level,sg),res=await Promise.all(qs.map(x=>DeckPages.get(x.q,{timeout:60000})));
  const ok=res.every(r=>r&&r.ok&&r.data&&!r.data.status),data={};qs.forEach((x,i)=>{if(ok)data[x.part]=res[i].data[x.part]});
  S.lists[k]={ok,data,at:Date.now()};if(t===S.tok||listKey()===k)paintTable();mark()}
 async function refreshAll(){S.lists={};await readSpec();paintCtl();paintTable();await readList(true);S.last=Date.now()}
 function mark(){if(!S.ctx||!DeckPages.mark)return;const sp=S.spec,miss=(S.specRes&&!S.specRes.ok?1:0)+(S.lists[listKey()]&&S.lists[listKey()].ok===false?1:0);
  const age=sp&&typeof sp.age==='number'?sp.age:null,refresh=sp&&typeof sp.refresh==='number'&&sp.refresh>0?sp.refresh:604800;
  DeckPages.mark(S.ctx,{age:age!=null&&sp.stale===true&&age<=2*refresh?2.01*refresh:age,refresh,missing:miss})}
 const tv=()=>{if(DeckPages.tv&&S.ctx)DeckPages.tv(S.ctx)};
 // the row sheet: every segment for that state or metro, and a link that sets Residential's scope there
 async function openRow(key,opener){const kind=M.keyKind(key);if(!kind||!S.spec)return;
  const cached=M.rowsOf(S.level,(S.lists[listKey()]||{}).data||{}).find(r=>r.key===key)||null;
  const name=cached?(cached.full||cached.name):kind==='state'&&window.DeckScope?window.DeckScope.STATES[key]||key:key;
  const subOf=r=>kind==='metro'?(r&&r.sub?r.sub+' metro':'Metro'):'State';
  let title=cached?cached.name:name,sub=subOf(cached);
  const one=body=>DeckShell.sheet.open(Object.assign(DeckUI.detail({title,sub,body,scope:'mkt:'+key}),{id:'mkt-geo',opener,wide:true}));
  const d=one(DeckUI.skeleton('row',6));S.sheetKey=key;S.sheetRow=null;
  const res=await Promise.all(M.sheetQueries(S.spec,kind,key,name).map(q=>DeckPages.get(q,{timeout:60000})));
  if(!d||!d.isConnected||!d.open||S.sheetKey!==key)return;
  const row=M.sheetRow(kind,key,res.map(r=>r&&r.ok?r.data:null));S.sheetRow=row;
  if(!row){one(DeckUI.empty({k:res.every(r=>r&&r.ok)?'idle':'bad',title:res.every(r=>r&&r.ok)?'This market is not in the national data.':'Markets data is not reporting.'}));return}
  // opened from a link: the row names the market once it has read
  const own=M.rowsOf(kind==='metro'?'metros':'states',{[kind==='metro'?'metros':'states']:[row]})[0];if(own){title=own.name;sub=subOf(own)}
  const full=kind==='metro'?String(row.name||(cached&&cached.full)||''):key;
  one(M.sheetHtml(M.sheetModel(S.spec,fields(),row,kind),M.goLink(kind,full)))}
 function toResidential(kind,key){if(!window.DeckScope||!key)return;
  if(kind==='state')window.DeckScope.set({kind:'state',state:key});else window.DeckScope.set({kind:'metro',metro:key});
  if(window.DeckShell&&DeckShell.go)DeckShell.go('realestate/residential')}
 function setLevel(l){l=M.levelOk(l);if(l===S.level)return;S.level=l;S.shown=M.PAGE;save();paintCtl();paintTable();readList(false)}
 function setSeg(id){const sg=M.segOf(S.spec,id);if(!sg||sg.id===S.seg)return;S.seg=sg.id;S.shown=M.PAGE;save();paintCtl();paintTable();readList(false)}
 function onClick(e){const t=e.target&&e.target.closest?e.target:null;if(!t)return;let b;
  if((b=t.closest('[data-mkt-level]'))){setLevel(b.dataset.mktLevel);return}
  if((b=t.closest('[data-mkt-seg]'))){setSeg(b.dataset.mktSeg);return}
  if((b=t.closest('.mkt-tw [data-sort]'))){const sg=seg();if(!sg)return;S.sort[sg.id]=M.nextSort((current()||{}).sort,b.dataset.sort,fields());save();paintTable();
   const h=$('.mkt-tw [data-sort="'+b.dataset.sort+'"]');if(h)h.focus({preventScroll:true});return}
  if((b=t.closest('tr[data-open="mkt"]'))){openRow(b.dataset.key,b);return}
  if((b=t.closest('[data-more="mkt"]'))){S.shown=b.dataset.less?M.PAGE:S.shown+M.PAGE;paintTable();return}
  if((b=t.closest('[data-retry="markets"]'))){refreshAll()}}
 // the sheet lives outside the page: its Residential link is handled on the document
 document.addEventListener('click',e=>{const b=e.target&&e.target.closest&&e.target.closest('[data-mkt-scope]');if(b)toResidential(b.dataset.mktScope,b.dataset.key)});
 DeckPages.register('realestate/markets',{every:600000,
  async show(ctx){S.ctx=ctx;if(!S.built)build(ctx);
   // Markets has its own level control: the scope bar Residential and Commercial share leaves the header while this sub is on screen
   const ps=ctx.head&&ctx.head.querySelector?ctx.head.querySelector('.pscope'):null;if(ps)ps.innerHTML='';
   paintCtl();paintTable();
   if(!S.spec||Date.now()-S.last>600000){await refreshAll()}else{await readList(false)}mark();
   // a link's ?mkt=CA or ?mkt=31080 opens that sheet, whatever level is on screen (the shell's own reopen taps only a visible row)
   const rp=window.DeckShell&&DeckShell.route?DeckShell.route().params||{}:{},k=(ctx.params&&ctx.params.mkt)||rp.mkt;
   if(k&&M.keyKind(k)&&S.sheetKey!==k)openRow(k)},
  refresh(ctx,tick){S.ctx=ctx;if(!tick||Date.now()-S.last>600000)refreshAll()},
  data(ctx,scopeKey){const m=current()||{},sg=seg();
   const dm=M.dataModel({fields:fields(),seg:sg,cols:String(scopeKey||'').indexOf('mkt:')===0&&S.sheetRow?M.segs(S.spec).flatMap(s=>M.fieldsOf(s)).filter(id=>S.sheetRow[id]!=null):arr(m.cols),hidden:m.hidden,sparse:m.sparse,pairs:m.pairs});
   return dm}});
 function arr(x){return Array.isArray(x)?x:[]}
})();
if(typeof module!=='undefined')module.exports={DeckMarkets};
