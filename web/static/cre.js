// Commercial deal desk (owner order 2026-11-12, design v3 2026-11-14). Real estate > Commercial mounts it for Tanner, Jordan or Riley;
// /cre is the same desk on its own page for a viewer token (Jordan or Riley), which pins the person to their own desk and boxes.
// Data: GET /api/cre?person= (profile, buy boxes, people, rates, assumptions and every deal; frozen for iOS) and
// GET /api/cre/deals (the cards, paged and filtered by type, scope and buy box on the server). Writes: POST /api/cre (buy boxes,
// mark seen), the same payloads as before. /cre loads no deck.js, so this file carries its own formatters (blueprint 2.4, the
// same output as DeckUI.fmt) and its own sheet host; inside the deck it uses DeckShell.sheet. Sources and method live in the
// Data sheet, never on the desk.
// ==== DECK CRE PURE BEGIN (no DOM, no fetch: tests/cre_*.test.js load this block) ====
const DeckCRE=(()=>{
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const arr=x=>Array.isArray(x)?x:[];
 const num=v=>typeof v==='number'&&isFinite(v)?v:null;
 const str=(v,n)=>typeof v==='string'?v.trim().slice(0,n||120):'';
 const safeUrl=u=>typeof u==='string'&&/^https?:\/\/[^\s"'<>\\@]+$/i.test(u)?u:'';
 const MINUS='\u2212',MASK='$\u2022\u2022\u2022';
 // ---- number formats, blueprint 2.4 (same output as DeckUI.fmt; a missing value returns null, never 0 or a dash)
 const fmt={
  // money is the deck's one form (static/ui-core.js, loaded first on /cre and in the deck): "$1.24M", "$1.70M", "$845K", "$9,450"
  money:v=>DeckCore.fmt.money(v),
  psf:v=>{const n=num(v);return n==null?null:'$'+Math.round(n).toLocaleString('en-US')+'/SF'},
  rate:v=>{const n=num(v);return n==null?null:n.toFixed(2)+'%'},
  share:v=>{const n=num(v);return n==null?null:n.toFixed(1)+'%'},
  chg:v=>{const n=num(v);return n==null?null:(n>0?'+':n<0?MINUS:'')+Math.abs(n).toFixed(1)+'%'},
  pt:v=>{const n=num(v);return n==null?null:(n>0?'+':n<0?MINUS:'')+Math.abs(n).toFixed(1)+' pt'},
  count:v=>{const n=num(v);if(n==null)return null;const a=Math.abs(n);return a>=1e6?(n/1e6).toFixed(1)+'M':a>=1e4?(n/1e3).toFixed(1)+'K':Math.round(n).toLocaleString('en-US')},
  ratio:v=>{const n=num(v);return n==null?null:n.toFixed(2)},
  date:t=>{const n=num(t);if(n==null)return null;const d=new Date(n*1000),now=new Date();
   return d.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})+(d.getUTCFullYear()!==now.getUTCFullYear()?', '+d.getUTCFullYear():'')},
  days:v=>{const n=num(v);return n==null?null:Math.round(n)===1?'1 day':Math.round(n).toLocaleString('en-US')+' days'}};
 const TYPES_ALL=['Multifamily','Industrial','Office','Retail','Mixed use','Land','Hospitality','Special purpose','Residential'];
 const COUNTIES=['Los Angeles County','Orange County','San Diego County','Riverside County','San Bernardino County','Ventura County'];
 const SHORT={'Los Angeles County':'Los Angeles','Orange County':'Orange','San Diego County':'San Diego','Riverside County':'Riverside','San Bernardino County':'San Bernardino','Ventura County':'Ventura'};
 // states the listing feed covers while the national broker fetch is held on site terms (PageLanes 4.3); "national" covers all
 const LISTING_STATES=['CA'];
 const covers=(dataset,st)=>dataset==='national'||LISTING_STATES.includes(st);
 const SRC={matthews:'Matthews','lee-associates':'Lee & Associates',svn:'SVN',commercialcafe:'CommercialCafe',century21:'Century 21 Commercial',realmo:'Realmo',zillow:'Zillow','auction.com':'Auction.com',redfin:'Redfin','realtor.com':'Realtor.com'};
 const srcName=s=>SRC[s]||str(s,30)||'Unnamed source';
 const cap=d=>isObj(d.cap)?num(d.cap.value):null;
 const capKind=d=>!isObj(d.cap)||cap(d)==null?null:d.cap.kind==='listed'?'listed':'est';
 const dom=d=>isObj(d.dom)?num(d.dom.days):null;
 // units: the listed count, else the desk's estimate (units_est: a residential 2-4 unit listing, or SF / 850), which always shows as est.
 const units=d=>num(d.units)!=null?d.units:isObj(d.units_est)?num(d.units_est.value):null;
 const unitsEst=d=>num(d.units)==null&&units(d)!=null;
 const isLease=d=>!!d&&d.sale_or_lease==='lease';
 // ---- buy box filters: f = {types[], counties[], zips[], price_min, price_max, cap_min, units_min, units_max, sf_min, dom_max, score_min,
 // dscr_min, sale_or_lease, q, sort}. dscr_min is a floor on the DSCR at the assumed commercial rate (dscr_cre); a deal with no DSCR fails
 // a box that sets one. units_min and units_max read units() above; a deal that does not say sale or lease is a sale.
 // The server applies a saved box with the same rules (rust/src/listings.rs box_match mirrors match).
 function match(d,f){if(!isObj(d))return false;const o=isObj(f)?f:{};
  const types=arr(o.types);if(types.length&&!types.includes(d.type||'Other'))return false;
  const cs=arr(o.counties);if(cs.length&&!cs.includes(str(d.county,40)))return false;
  const zs=arr(o.zips);if(zs.length&&!zs.some(z=>str(d.zip,5).startsWith(z)))return false;
  const p=num(d.price);
  if(num(o.price_min)!=null&&(p==null||p<o.price_min))return false;
  if(num(o.price_max)!=null&&(p==null||p>o.price_max))return false;
  if(num(o.cap_min)!=null&&(cap(d)==null||cap(d)<o.cap_min))return false;
  const u=units(d);
  if(num(o.units_min)!=null&&(u==null||u<o.units_min))return false;
  if(num(o.units_max)!=null&&(u==null||u>o.units_max))return false;
  if((o.sale_or_lease==='sale'||o.sale_or_lease==='lease')&&(d.sale_or_lease||'sale')!==o.sale_or_lease)return false;
  if(num(o.sf_min)!=null&&(num(d.sqft)==null||d.sqft<o.sf_min))return false;
  if(num(o.dom_max)!=null&&(dom(d)==null||dom(d)>o.dom_max))return false;
  if(num(o.score_min)!=null&&(num(d.score)==null||d.score<o.score_min))return false;
  if(num(o.dscr_min)!=null&&(num(d.dscr_cre)==null||d.dscr_cre<o.dscr_min))return false;
  const q=str(o.q,60).toLowerCase();
  if(q&&![d.zip,d.city,d.county,d.metro,d.addr,d.title,d.subtype,d.broker].some(v=>str(v,200).toLowerCase().includes(q)))return false;
  return true}
 // missing values sort last whatever the direction
 const KEYS={score:[d=>num(d.score),-1],cap:[cap,-1],price:[d=>num(d.price),1],ppsf:[d=>num(d.ppsf),1],dom:[dom,-1],newest:[d=>num(d.listed_at)!=null?d.listed_at:-(dom(d)==null?1e9:dom(d)),-1]};
 function sortDeals(xs,sort){const [k,dir]=KEYS[sort]||KEYS.score;
  return arr(xs).map((d,i)=>({d,i,v:k(d)})).sort((a,b)=>(a.v==null)-(b.v==null)||(a.v==null?0:(a.v-b.v)*dir)||a.i-b.i).map(o=>o.d)}
 // new-match alerts: matches of a box not in the box's seen list. A box with no seen list yet has no baseline (null).
 function newIds(deals,box,seen){if(!isObj(box))return null;const s=isObj(seen)&&isObj(seen[box.id])?seen[box.id]:null;if(!s)return null;
  const old=new Set(arr(s.ids));return arr(deals).filter(d=>match(d,box.f)&&!old.has(d.id)).map(d=>d.id)}
 // ---- ad hoc filters and sort (2026-11-15, parity row 64): the Filters sheet narrows the deals in view on this device and never
 // writes a buy box. f takes match()'s keys; the sort is its own control. SORTS are /api/cre/deals' sort names.
 const SORTS=[['score','Best score'],['cap','Highest cap rate'],['price','Lowest price'],['ppsf','Lowest $/SF'],['dom','Longest on market'],['newest','Newest']];
 const FKEYS=['types','counties','price_min','price_max','cap_min','units_min','units_max','sf_min','dom_max','q'];
 function filterCount(f){const o=isObj(f)?f:{};return FKEYS.filter(k=>k==='types'||k==='counties'?arr(o[k]).length>0:k==='q'?!!str(o.q,60):num(o[k])!=null).length}
 // the Filters sheet's fields into f: a value that is not a number is left out, never read as 0
 function readFilters(vals,toggles){const v=isObj(vals)?vals:{},T=isObj(toggles)?toggles:{},f={};
  for(const k of ['types','counties']){const a=arr(T[k]).filter(x=>typeof x==='string'&&x).slice(0,12);if(a.length)f[k]=a}
  for(const k of ['price_min','price_max','cap_min','units_min','units_max','sf_min','dom_max']){const t=String(v[k]==null?'':v[k]).replace(/[$,%\s]/g,'');if(t==='')continue;const n=Number(t);if(isFinite(n)&&n>=0)f[k]=n}
  const q=str(v.q,60);if(q)f.q=q;
  return f}
 // the page's own narrowing, read the way /api/cre/deals reads it: type, max price and the scope string (state, county list, metro)
 const ckey=c=>str(c,60).toLowerCase().replace(/ county$/,'').trim();
 function scopeOf(s){const o={};String(s||'').split('&').forEach(p=>{const i=p.indexOf('=');if(i<1)return;let v=p.slice(i+1);try{v=decodeURIComponent(v.replace(/\+/g,' '))}catch(e){}o[p.slice(0,i)]=v});return o}
 // the scope is read once per page object, not once per deal
 function pageKey(o){const sc=scopeOf(o.scope);return {type:o.type?String(o.type).toLowerCase():'',max:num(o.price_max),state:sc.state?sc.state.toUpperCase():'',
  counties:sc.county?sc.county.split(',').map(ckey).filter(Boolean):[],metro:sc.metro?sc.metro.trim().toLowerCase():''}}
 function inPage(d,p){if(!isObj(d))return false;const o=isObj(p)?p:{},k=o._k||(o._k=pageKey(o));
  if(k.type&&str(d.type,40).toLowerCase()!==k.type)return false;
  if(k.max!=null&&!(num(d.price)!=null&&d.price<=k.max))return false;
  if(k.state&&str(d.state,2).toUpperCase()!==k.state)return false;
  if(k.counties.length&&!k.counties.includes(ckey(d.county)))return false;
  if(k.metro&&str(d.metro,120).toLowerCase()!==k.metro)return false;
  return true}
 // the deals in view, worked out here: the page's narrowing, then the buy box or investor view, then the Filters sheet, then the sort.
 // s = {data, typeName, scope, price_max, boxId, view, cap, f, sort}
 function localRows(deals,s){const o=isObj(s)?s:{},data=isObj(o.data)?o.data:{},prof=isObj(data.profile)?data.profile:{};
  const view=o.view&&o.view!=='all'?o.view:null,box=!view&&o.boxId?arr(prof.boxes).find(b=>isObj(b)&&b.id===o.boxId):null,page={type:o.typeName,scope:o.scope,price_max:o.price_max};
  return sortDeals(arr(deals).filter(d=>inPage(d,page)&&(view?inView(d,view,o):!box||match(d,box.f))&&match(d,o.f)),o.sort)}
 // ---- Tanner as a smaller investor (owner 2026-11-12): a stake sized to his equity cap, the Housing budget. Deal equity = price x
 // (1 - loan to value) + closing, at the 30-year scenario for 2-4 units and the commercial one otherwise; his share = min(1, cap /
 // deal equity); cash flow is pro rata at the deal's cash-on-cash; DSCR is the deal's. A stake fits when the cap clears an assumed
 // LP minimum and the deal covers its debt. Amounts that follow from the budget stay masked until Show amounts.
 const LP_MIN=25000;
 function isSmall(d){const p=num(d&&d.price),t=d&&d.type,txt=[d&&d.subtype,d&&d.title,d&&d.tenancy,d&&d.desc].map(x=>str(x,300).toLowerCase()).join(' ');
  if(t==='Multifamily'){const u=units(d);return u!=null&&u>=2&&u<=4}
  if(t==='Mixed use')return p!=null&&p<=3000000;
  if(t==='Retail')return p!=null&&p<=3000000&&/net lease|nnn|single tenant|absolute/.test(txt);
  return false}
 function stake(d,c0,a){const c=num(c0),p=num(d&&d.price);if(c==null||c<=0||p==null)return null;
  const A=isObj(a)?a:{},cre=isObj(A.cre)?A.cre:{},res=isObj(A.res)?A.res:{},close=num(A.closing)!=null?A.closing:0.02;
  // the desk's own loan pick (cre_deals `loan`: 30-year terms for 2-4 units) when it has one
  const u=units(d),useRes=d.loan?d.loan==='res':d.type==='Multifamily'&&u!=null&&u<=4,ltv=useRes?(num(res.ltv)||0.75):(num(cre.ltv)||0.65);
  const need=p*(1-ltv)+p*close,share=Math.min(1,c/need),equity=share*need;
  const coc=num(useRes?d.coc_res:d.coc_cre),dscr=num(useRes?d.dscr_res:d.dscr_cre);
  return {need,share,equity,cash_flow:coc!=null?equity*coc/100:null,coc,dscr,whole:need<=c,small:isSmall(d),scenario:useRes?'res':'cre',
   fits:c>=LP_MIN&&dscr!=null&&dscr>=1}}
 // Tanner's views: deals in Jordan's or Riley's buy boxes that a Tanner stake fits, small deals he could buy whole
 function inView(d,view,s){if(!view||view==='all')return true;const data=isObj(s&&s.data)?s.data:{},k=stake(d,s.cap,data.assumptions);if(!k)return false;
  if(view==='small')return k.small&&k.whole;
  const boxes=arr((isObj(data.boxes_of)?data.boxes_of:{})[view]).filter(isObj);return k.fits&&boxes.some(b=>match(d,b.f))}
 const VIEWS=[['jordan','Co-invest with Jordan'],['riley','Co-invest with Riley'],['small','Small deals you could buy whole']];
 const slug=s=>str(s,40).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,24)||'box';
 const ownerDesk=s=>!!(s&&s.data&&s.data.person==='tanner'&&!s.data.viewer&&!s.viewer);
 // the desk's budget read failed (not: the owner never set one): the stake figures and the stake views come from it, so the page
 // says it rather than reading the stake views as "No deals match" or dropping the stake without a word (ReviewSix, #399)
 const capLost=s=>!!(s&&s.capFail&&ownerDesk(s));
 // ---- query for GET /api/cre/deals: person (owner only; the server pins a viewer), box, type, the scope string, sort, paging
 function dealsQuery(o){const q=[];if(!o.viewer&&o.person)q.push('person='+encodeURIComponent(o.person));
  if(o.box)q.push('box='+encodeURIComponent(o.box));if(o.type)q.push('type='+encodeURIComponent(o.type));
  if(o.price_max!=null&&num(o.price_max)!=null)q.push('max_price='+Math.round(o.price_max));
  if(o.scope)q.push(String(o.scope).replace(/^&+|&+$/g,''));
  q.push('sort='+(o.sort||'score'),'limit='+(o.limit||12),'offset='+(o.offset||0));return 'cre/deals?'+q.filter(Boolean).join('&')}
 // ---- marks and small markup (ui.css classes)
 // the figure (mark and rate) and its word are two spans, so a narrow card can put "listed" under the figure and never inside it
 const capHtml=d=>{const k=capKind(d);if(!k)return null;return '<span class="capf"><span class="capm'+(k==='est'?' est':'')+'" aria-hidden="true"></span>'+esc(fmt.rate(cap(d)))+'</span> <span class="capk">'+(k==='listed'?'listed':'est.')+'</span>'};
 const kv=rows=>{const r=rows.filter(x=>x&&x[1]!=null);return r.length?'<dl class="kv">'+r.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+v+'</dd></div>').join('')+'</dl>':''};
 const missing=names=>names.length?'<p class="missing">Not reported: '+esc(names.join(', '))+'.</p>':'';
 const empty=(k,title,line,act)=>'<div class="es'+(k==='bad'?' es-bad':k==='stale'?' es-stale':'')+'"><b class="es-t">'+esc(title)+'</b>'+(line?'<p class="es-l">'+esc(line)+'</p>':'')+(act||'')+'</div>';
 const where=d=>[str(d.city,30),str(d.state,2)].filter(Boolean).join(', ');
 // ---- one deal card (2026-11-17, L14): the open area (name or address, never cut; a score pill; type, units and place; the numbers it
 // has) is one button, and under it a foot line with days listed, the source and the listing link, which a button cannot hold.
 // A figure the desk worked out from public rents and assumed loan terms carries "est." in its own span (the cap's pattern), so an
 // estimate never reads as a listed figure. A lease listing shows its asking rent and size instead of a price.
 const estHtml=v=>v==null?null:'<span class="capf">'+esc(v)+'</span> <span class="capk">est.</span>';
 const unitsText=d=>{const u=units(d);return u==null?'':fmt.count(u)+(u===1?' unit':' units')+(unitsEst(d)?' est.':'')};
 function cardModel(d,o){const st=o||{},k=st.stakeCap!=null?stake(d,st.stakeCap,st.assumptions):null,cells=[];
  if(isLease(d)){
   cells.push(['Asking rent',num(d.rent_psf_yr)!=null?esc('$'+d.rent_psf_yr.toFixed(2)+'/SF/yr'):esc(str(d.rent_text,40))],['Size',num(d.sqft)!=null?esc(fmt.count(d.sqft)+' SF'):null]);
  }else{
   const u=units(d),p=num(d.price),ppu=num(d.ppu)!=null?d.ppu:u&&p!=null?p/u:null,ds=num(d.dscr)!=null?d.dscr:num(d.dscr_cre),cf=isObj(d.cf_mo)?num(d.cf_mo.value):null;
   cells.push(['Price',esc(fmt.money(p))]);
   // per unit for a building with units (an estimated count makes it an estimate), else per SF
   cells.push(ppu!=null?['$/unit',unitsEst(d)?estHtml(fmt.money(ppu)):esc(fmt.money(ppu))]:['$/SF',esc(fmt.psf(d.ppsf))]);
   cells.push(['Cap',capHtml(d)],['GRM',num(d.grm)!=null?estHtml(d.grm.toFixed(1)):null],['DSCR',esc(fmt.ratio(ds))],['Cash flow/mo',cf!=null?estHtml(fmt.money(cf)):null]);
  }
  const shown=cells.filter(c=>c[1]);
  if(k)shown.push(['Your stake',st.revealed?esc(fmt.money(k.equity)):MASK]);
  const days=dom(d),foot=[days==null?'':days<1?'New today':fmt.days(days)+' listed',srcName(d.source)].filter(Boolean);
  return {id:str(d.id,12),title:str(d.title,90)||str(d.addr,120)||'Address withheld',
   sub:[(d.type||'Type unknown')+(isLease(d)?' for lease':''),unitsText(d),where(d)].filter(Boolean).join(' \u00b7 '),
   score:num(d.score),cut:arr(d.cuts).length>0,cells:shown,foot,url:safeUrl(d.url),src:srcName(d.source)}}
 function card(d,o){const m=cardModel(d,o);
  return '<article class="card deal"><button type="button" class="deal-open" data-open="deal" data-cre-open="'+esc(m.id)+'" data-key="'+esc(m.id)+'">'+
   '<h3><span class="dt">'+esc(m.title)+'</span>'+(m.score!=null?'<span class="pill">Score '+Math.round(m.score)+'</span>':'')+'</h3>'+
   '<p class="note sm">'+esc(m.sub)+(m.cut?' \u00b7 Price cut':'')+'</p>'+
   (m.cells.length?'<dl class="dg" data-n="'+m.cells.length+'">'+m.cells.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+v+'</dd></div>').join('')+'</dl>':'')+'</button>'+
   '<p class="deal-foot"><span>'+esc(m.foot.join(' \u00b7 '))+'</span>'+
   (m.url?'<a class="deal-link ext" href="'+esc(m.url)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc('Open the listing on '+m.src)+'">Listing</a>':'')+'</p></article>'}
 // ---- buy box chips: "All deals" first with its count, each box with its count and its new matches, Tanner's investor views, "New buy box" last
 function chips(s){const data=isObj(s.data)?s.data:{},prof=isObj(data.profile)?data.profile:{},boxes=arr(prof.boxes).filter(isObj),c=isObj(s.counts)?s.counts:{};
  const n=v=>num(v)!=null?'<small>'+esc(fmt.count(v))+'</small>':'';
  // "N new": matches not in the box's seen list (row 63); a box with no baseline yet, or nothing new, shows no mark
  const fresh=b=>{const ids=newIds(arr(data.deals),b,prof.seen);return ids&&ids.length?'<small class="cre-new">'+esc(fmt.count(ids.length))+' new</small>':''};
  const ch=(on,attr,val,label,extra)=>'<button type="button" aria-pressed="'+(on?'true':'false')+'"'+(on?' class="on"':'')+' '+attr+'="'+esc(val)+'">'+esc(label)+(extra||'')+'</button>';
  const view=s.view||'all';
  let h=ch(view==='all'&&!s.boxId,'data-cre-box','','All deals',n(c['']));
  h+=boxes.map(b=>ch(view==='all'&&s.boxId===b.id,'data-cre-box',b.id,str(b.name,40),n(c[b.id])+fresh(b))).join('');
  if(ownerDesk(s)&&num(s.cap)!=null)h+=VIEWS.map(([k,l])=>ch(view===k,'data-cre-view',k,l,n(isObj(s.viewCounts)?s.viewCounts[k]:null))).join('');
  h+='<button type="button" data-cre-newbox="1">New buy box</button>';
  return '<div class="chips scroll cre-boxes" role="group" aria-label="Buy boxes">'+h+'</div>'}
 // ---- the desk's tools: Filters (with the count of what is set), the market overview. Nothing here writes a buy box.
 const sortOf=s=>SORTS.some(x=>x[0]===s)?s:'score';
 // S2: one Filters control on every filtered page: the filter icon, the word Filters and the standard button (DeckUI.filters' look). The
 // icon is inline because /cre has no sprite. "Filters for deals" tells it from the ZIP filters on Commercial; the visible word comes first
 const FICON='<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4"/></svg>';
 const filtersBtn=k=>'<button type="button" class="btn" data-cre-filters="1" aria-haspopup="dialog" aria-label="Filters for deals'+(k?', '+k+' set':'')+'">'+FICON+'Filters'+(k?' <span class="cnt">'+k+'</span>':'')+'</button>';
 function tools(s){const n=filterCount(s.f),k=n+(sortOf(s.sort)!=='score'?1:0);
  return '<div class="cre-tools">'+filtersBtn(k)+
   '<button type="button" class="btn" data-cre-ov="1" aria-haspopup="dialog">Market overview</button>'+
   (k?'<button type="button" class="btn btn-quiet" data-cre-fclear="1">Clear</button>':'')+'</div>'}
 const showLabel=n=>num(n)==null?'Show deals':n===1?'Show 1 deal':'Show '+fmt.count(n)+' deals';
 // ---- the count line over the cards (2026-11-17): how many deals are in view and, for a buy box with a baseline, how many are new,
 // beside the sort. Both pages carry it; the sort here and the one in the Filters sheet are the same setting
 function countText(s){const data=isObj(s.data)?s.data:{},prof=isObj(data.profile)?data.profile:{},n=num(s.total);if(n==null)return '';
  const t=n===1?'1 deal':fmt.count(n)+' deals';if(filterCount(s.f))return t+' match your filters';
  const box=s.boxId&&(!s.view||s.view==='all')?arr(prof.boxes).find(b=>isObj(b)&&b.id===s.boxId):null,fresh=box?newIds(arr(data.deals),box,prof.seen):null;
  return t+(fresh&&fresh.length?', '+fmt.count(fresh.length)+' new':'')}
 const sortSelect=s=>'<label class="cre-sort">Sort<select data-cre-sort="1" data-key="cre-sort" aria-label="Sort deals">'+SORTS.map(([v,l])=>'<option value="'+v+'"'+(v===sortOf(s.sort)?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select></label>';
 function countLine(s){const t=countText(s);return t?'<div class="cre-count"><p class="cre-cnt" role="status">'+esc(t)+'</p>'+sortSelect(s)+'</div>':''}
 // outside listing coverage the boxes (all Southern California) would only offer zeros: the coverage line stands alone
 const outsideOf=s=>{const c=isObj(s.counts)?s.counts:{};return s.dataset!=='national'&&num(c[''])===0&&!!s.scopeKind&&s.scopeKind!=='us'};
 const deskBad=s=>{const data=isObj(s.data)?s.data:{};return !s.data||s.status==='bad'||!!data.error||data.status==='not_reporting'};
 // /cre puts the two tools in its head row beside Data (no row of their own, 2026-11-15 Main): the same Filters button as everywhere,
 // then Overview as a quiet text button. "Filters 2" is the one mark that the list is narrowed or re-sorted.
 function headTools(s){if(deskBad(s)||outsideOf(s))return '';const k=filterCount(s.f)+(sortOf(s.sort)!=='score'?1:0);
  return filtersBtn(k)+'<button type="button" class="btn btn-quiet" data-cre-ov="1" aria-haspopup="dialog" aria-label="Market overview">Overview</button>'}
 // ---- how many cards to hold after the next page: twelve or more, ending on a whole grid row of `cols` (W4-4: 15 at five columns, not
 // 5, 5 and an orphan 2). A page that started mid-row (the window changed width) is topped up to the row's end first
 const PAGE=12;
 function nextCount(have,cols){const h=Math.max(0,Math.round(num(have)||0)),c=Math.min(PAGE,Math.max(1,Math.round(num(cols)||1)));return Math.ceil((h+PAGE)/c)*c}
 // ---- the desk: chips, then one state or the cards with "Show 12 more"
 function render(s){const data=isObj(s.data)?s.data:{};
  if(s.status==='loading'&&!s.data)return '<div class="cre-desk">'+empty('idle','Reading the deal desk','')+'</div>';
  // E9: one fixed sentence; the server's own reason is for the Data sheet (dataParts), never the page
  if(s.status==='bad'||data.error||data.status==='not_reporting'){const retry='<button type="button" class="btn btn-sm es-retry" data-cre-retry="1">Try again</button>';
   // /cre has no top bar for the deck's offline word: no answer at all (not a timeout, not an HTTP error) says Offline here
   return '<div class="cre-desk">'+(s.offline?empty('bad','Offline','The desk reads again when the connection is back.',retry):empty('bad','Deal desk is not reporting.','',retry))+'</div>'}
  const people=arr(data.people).filter(isObj),rows=arr(s.rows).filter(isObj),c=isObj(s.counts)?s.counts:{};
  let h='<div class="cre-desk">';
  if(people.length>1&&!data.viewer&&!s.viewer)h+='<div class="chips scroll cre-who" role="group" aria-label="Whose desk">'+people.map(p=>'<button type="button" data-cre-person="'+esc(p.id)+'"'+(p.id===s.person?' class="on" aria-pressed="true"':' aria-pressed="false"')+'>'+esc(str(p.label,30))+'</button>').join('')+'</div>';
  const outside=outsideOf(s);
  // the buy box chips and the tools share one wrapping row; where the page has a head row for them (s.headTools) the chips stand alone
  if(!outside)h+='<div class="cre-bar">'+chips(s)+(s.headTools?'':tools(s))+'</div>';
  if(s.boxId&&!outside)h+='<div class="cre-boxact"><button type="button" class="btn btn-quiet btn-sm" data-cre-edit="1">Edit buy box</button></div>';
  const cmp=arr(s.compare).map(id=>(arr(data.deals).find(d=>d.id===id)||arr(s.rows).find(d=>d.id===id))).filter(Boolean);
  if(cmp.length)h+='<div class="chips cre-tray" role="group" aria-label="Compare"><button type="button" class="on" data-cre-compare="1"'+(cmp.length<2?' disabled':'')+'>Compare '+cmp.length+'</button>'+
   cmp.map(d=>'<button type="button" data-cre-cmp="'+esc(d.id)+'" aria-pressed="true">'+esc(str(d.title,28)||str(d.addr,28))+'</button>').join('')+'</div>';
  // a budget the read did not bring is named once, where the desk would use it; a stake view shows the wait instead of the
  // "No deals match this buy box" that an uncomputed narrowing would otherwise print
  const lost=capLost(s),stakeView=!!(s.view&&s.view!=='all');
  if(lost&&!stakeView)h+='<div class="stale-bar" role="status"><span class="sd warn"></span>Budget not loaded, so Your stake and the stake views wait.'+
   '<button type="button" class="btn btn-sm" data-cre-capretry="1">Try again</button></div>';
  // the loading cards use the deck's card grid, so the desk can read its live column count before the first page is asked for (W4-4)
  if(s.status==='loading')h+='<div class="cards cre-cards">'+'<div class="card skel-card"><span class="skel l"></span><span class="skel t"></span></div>'.repeat(4)+'</div>';
  else if(lost&&stakeView)h+=empty('stale','Budget not loaded','The stake views need your budget, so the list waits.','<button type="button" class="btn btn-sm" data-cre-capretry="1">Try again</button>');
  else if(!rows.length){
   const box=s.boxId?arr((isObj(data.profile)?data.profile:{}).boxes).find(b=>isObj(b)&&b.id===s.boxId):null;
   if(outside)h+=empty('idle','No listings tracked here yet. Deals cover Southern California for now.','');
   else if(filterCount(s.f))h+=empty('idle','No deals match these filters.','Clear a filter or two to see more.','<button type="button" class="btn btn-sm" data-cre-fclear="1">Clear filters</button>');
   else if(box&&isObj(box.f)&&box.f.sale_or_lease==='lease')h+=empty('idle','No deals match this buy box.','No lease listings have come in yet. They show here once a feed lists them.','<button type="button" class="btn btn-sm" data-cre-edit="1">Edit buy box</button>');
   else if(s.boxId||(s.view&&s.view!=='all'))h+=empty('idle','No deals match this buy box.',s.boxId?'Widen the price, place or size, or check back after the next listing run.':'',s.boxId?'<button type="button" class="btn btn-sm" data-cre-edit="1">Edit buy box</button>':'');
   else h+=empty('idle','No deals of this type right now.','');
  }else{
   const o={stakeCap:s.view&&s.view!=='all'&&ownerDesk(s)?num(s.cap):null,assumptions:data.assumptions,revealed:!!s.revealed};
   h+=countLine(s)+'<div class="cards cre-cards">'+rows.map(d=>card(d,o)).join('')+'</div>';
   const left=(num(s.total)||rows.length)-rows.length;
   if(left>0)h+='<div class="more-row"><button type="button" class="btn" data-cre-more="1">Show '+Math.min(nextCount(rows.length,s.cols)-rows.length,left)+' more</button></div>';
  }
  if(s.msg)h+='<p class="note sm" role="status">'+esc(s.msg)+'</p>';
  return h+'</div>'}
 // ---- cap rate charts (V11, V21): one shape for the desk's cap rate by price and the overview's price per SF against cap rate. Prices span
 // ten times and more, so x is log with its ticks on the 1, 2, 5 steps inside the range (2, 5 and 10 million on the desk), at most four;
 // y has a tick at its foot; the loan rate is a dashed line named at its right end, and one sentence says what the line means.
 // pts = [{id, x (a positive amount), y (the cap), est}], xf formats an x tick. Returns null under three points.
 function capModel(pts0,rate,xf){const pts=arr(pts0).filter(p=>isObj(p)&&num(p.x)!=null&&p.x>0&&num(p.y)!=null);
  if(pts.length<3)return null;
  const lp=pts.map(p=>Math.log10(p.x)),xlo=Math.min(...lp),xhi=Math.max(...lp),r=num(rate);
  const ys=pts.map(p=>p.y).concat(r!=null?[r]:[]),ylo=Math.max(0,Math.floor(Math.min(...ys))-1),yhi=Math.ceil(Math.max(...ys))+1;
  // points stay 2% inside the plot so a dot on the edge never spills past the panel
  const X=v=>xhi===xlo?50:2+(Math.log10(v)-xlo)/(xhi-xlo)*96,Y=c=>2+(1-(c-ylo)/(yhi-ylo))*96;
  const step=yhi-ylo>8?4:2,ticks=[ylo];for(let t=Math.ceil(ylo/step)*step;t<=yhi&&ticks.length<4;t+=step)if(t-ylo>=step/2)ticks.push(t);
  // x ticks well inside the plot (a label at the edge would be cut); thinned to the 1 and 5 steps, then the 1 steps, past four
  const xt=ms=>{const o=[];for(let e=Math.floor(xlo);e<=Math.ceil(xhi);e++)for(const m of ms){const v=m*Math.pow(10,e),p=X(v);if(xhi>xlo&&p>=6&&p<=94)o.push({x:p,label:xf(v)})}return o};
  let xticks=xt([1,2,5]);if(xticks.length>4)xticks=xt([1,5]);if(xticks.length>4)xticks=xt([1]);
  return {pts:pts.map(p=>({id:p.id,x:X(p.x),y:Y(p.y),est:!!p.est})),ticks:ticks.map(t=>({y:Y(t),label:t+'%'})),xticks,
   line:r!=null?{y:Y(r),label:'Loan rate '+fmt.rate(r)}:null,xl:xf(Math.pow(10,xlo)),xr:xf(Math.pow(10,xhi)),n:pts.length,listed:pts.filter(p=>!p.est).length}}
 // the chart: o = {label (the chart's accessible name), panel}. Fewer than two round ticks inside the range: the two ends are labelled instead
 function capChart(m,o){const f=v=>v.toFixed(2),c=isObj(o)?o:{},ends=m.xticks.length<2;
  return '<div class="'+(c.panel?'panel ':'')+'cre-sc"><div class="chart" style="--ar:2.4/1" role="img" aria-label="'+esc(c.label+': '+m.listed+' listed caps, '+(m.n-m.listed)+' estimated'+(m.line?'; '+m.line.label:''))+'">'+
   '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'+m.ticks.map(t=>'<line class="grid" x1="0" x2="100" y1="'+f(t.y)+'" y2="'+f(t.y)+'"/>').join('')+
   (ends?'':m.xticks.map(t=>'<line class="grid" x1="'+f(t.x)+'" x2="'+f(t.x)+'" y1="0" y2="100"/>').join(''))+
   (m.line?'<line class="loan" x1="0" x2="100" y1="'+f(m.line.y)+'" y2="'+f(m.line.y)+'"/>':'')+'</svg>'+
   m.ticks.map(t=>'<span class="yt" style="--y:'+f(t.y)+'%">'+esc(t.label)+'</span>').join('')+
   m.pts.map(p=>'<i class="pt'+(p.est?' est':'')+'" style="--x:'+f(p.x)+'%;--y:'+f(p.y)+'%"></i>').join('')+
   (ends?'<span class="xt l">'+esc(m.xl)+'</span><span class="xt r">'+esc(m.xr)+'</span>':m.xticks.map(t=>'<span class="xt" style="left:'+f(t.x)+'%">'+esc(t.label)+'</span>').join(''))+
   (m.line?'<span class="lbl end'+(m.line.y<14?' lo':'')+'" style="top:'+f(m.line.y)+'%">'+esc(m.line.label)+'</span>':'')+'</div>'+
   '<p class="legend"><span><i class="lg-pt"></i>Listed cap</span><span><i class="lg-pt est"></i>Estimated cap</span></p>'+
   (m.line?'<p class="note sm cre-sc-cap">Above the line pays more than the loan costs.</p>':'')+'</div>'}
 // the desk's chart: asking price against cap rate (caps over 15% are left out as listing errors)
 function scatterModel(rows,rate){return capModel(arr(rows).filter(d=>isObj(d)&&cap(d)!=null&&num(d.price)!=null&&d.price>0&&cap(d)>0&&cap(d)<=15)
  .map(d=>({id:d.id,x:d.price,y:cap(d),est:capKind(d)==='est'})),rate,fmt.money)}
 function scatter(rows,rate){const m=scatterModel(rows,rate);if(!m)return empty('idle','Too few deals with a cap rate to chart.','');
  return capChart(m,{label:m.n+' deals by asking price and cap rate',panel:true})}
 // ---- one deal in full. ctx = {data, myCap, revealed, compare[], zipLink}. Returns {title, sub, body, actions}.
 // ---- the lean deals file (2026-11-17): a ZIP's facts sit once in data.zips, and a nearby comp is {id, mi} whose address and
 // prices are that deal's own. A deal that still carries zip_f or full comp rows (the national file) reads as before
 const IDX=typeof WeakMap==='function'?new WeakMap():null;
 function dealById(data,id){const ds=arr(isObj(data)?data.deals:null);if(!IDX||!ds.length)return ds.find(x=>isObj(x)&&x.id===id)||null;
  let m=IDX.get(ds);if(!m){m=new Map(ds.filter(isObj).map(x=>[x.id,x]));IDX.set(ds,m)}return m.get(id)||null}
 function withZip(d,data){if(!isObj(d)||isObj(d.zip_f))return d;const z=isObj(data)&&isObj(data.zips)?data.zips[str(d.zip,5)]:null;return isObj(z)?Object.assign({},d,{zip_f:z}):d}
 function dealSheet(d0,ctx){if(!isObj(d0))return null;const c=isObj(ctx)?ctx:{},data=isObj(c.data)?c.data:{},r=isObj(data.rates)?data.rates:{},a=isObj(data.assumptions)?data.assumptions:{};
  const d=withZip(d0,data);
  const sec=(t,b)=>b?'<section class="sh-sec"><h3>'+esc(t)+'</h3>'+b+'</section>':'';
  const tiles=[['Asking price',fmt.money(d.price)],['Cap',capKind(d)?fmt.rate(cap(d)):null,capKind(d)],['$/SF',fmt.psf(d.ppsf)],['Score',num(d.score)!=null?String(Math.round(d.score)):null]].filter(t=>t[1]!=null);
  let h=tiles.length?'<div class="strip cre-dhead" data-n="'+tiles.length+'" data-nb="'+tiles.length+'">'+tiles.map(([l,v,k])=>'<div class="tile"><span class="h">'+esc(l)+'</span><b class="v">'+(k?'<span class="capm'+(k==='est'?' est':'')+'" aria-hidden="true"></span>':'')+esc(v)+'</b>'+(k?'<span class="t">'+(k==='listed'?'Listed':'Estimated')+'</span>':'')+'</div>').join('')+'</div>':'';
  const flags=arr(d.flags).map(x=>str(x,240)).filter(Boolean);
  if(flags.length)h+=sec('Check before relying','<ul class="cre-flags">'+flags.map(x=>'<li><span class="sd warn" aria-hidden="true"></span>'+esc(x)+'</li>').join('')+'</ul>');
  const sp=isObj(d.score_parts)?d.score_parts:{},PARTS=[['yield','Yield over debt'],['price','Price against comps'],['market','Market'],['motion','Seller motion']].filter(([k])=>num(sp[k])!=null);
  if(PARTS.length)h+=sec('Score parts','<div class="hbars">'+PARTS.map(([k,l])=>{const v=Math.max(0,Math.min(100,sp[k]));return '<div class="hbar"><span>'+esc(l)+'</span><div>'+(Math.round(v)>0?'<i style="--v:'+v+'%"></i>':'')+'<b>'+Math.round(v)+'</b></div></div>'}).join('')+'</div>');
  const noi=isObj(d.noi_v)&&num(d.noi_v.value)!=null?d.noi_v:null,noiK=noi?(String(noi.kind||'').indexOf('listed')===0?'listed':'est'):null;
  const gr=isObj(d.gross)&&num(d.gross.value)!=null?d.gross:null,grK=gr?(String(gr.kind||'').indexOf('listed')===0?'listed':'est'):null;
  // the 4th field marks an optional number: gross rent comes with NOI and the pro forma cap is rare, so neither is named as missing
  const N=[['NOI','NOI',noi?'<span class="capm'+(noiK==='est'?' est':'')+'" aria-hidden="true"></span>'+esc(fmt.money(noi.value))+' '+(noiK==='listed'?'listed':'est.'):null],
   ['Gross rent, yearly','gross rent',gr?'<span class="capm'+(grK==='est'?' est':'')+'" aria-hidden="true"></span>'+esc(fmt.money(gr.value))+' '+(grK==='listed'?'listed':'est.'):null,1],
   ['Cap rate','cap rate',capHtml(d)],['Pro forma cap','pro forma cap',num(d.proforma_cap)!=null?esc(fmt.rate(d.proforma_cap))+' (broker\u2019s figure)':null,1],
   ['Asking rent','asking rent',isLease(d)?(num(d.rent_psf_yr)!=null?esc('$'+d.rent_psf_yr.toFixed(2)+'/SF/yr'):str(d.rent_text,60)?esc(str(d.rent_text,60)):null):null,1],
   ['GRM','GRM',num(d.grm)!=null?esc(d.grm.toFixed(1)):null],['Price per SF','price per SF',esc(fmt.psf(d.ppsf))||null],
   ['Price per unit','price per unit',num(d.ppu)!=null?esc(fmt.money(d.ppu)):unitsEst(d)&&num(d.price)!=null?esc(fmt.money(d.price/units(d)))+' est.':null],
   ['Units','units',units(d)!=null?esc(fmt.count(units(d)))+(unitsEst(d)?' est.':''):null],
   ['Rent per unit, monthly','rent per unit',isObj(d.unit_rent)&&num(d.unit_rent.value)!=null?esc(fmt.money(d.unit_rent.value))+' est.'+(num(d.unit_rent.br)!=null?esc(', '+(d.unit_rent.br===0?'studio':d.unit_rent.br+' bedroom')):''):null,1],
   ['Building size','building size',num(d.sqft)!=null?esc(fmt.count(d.sqft))+' SF':null],
   ['Lot','lot size',num(d.lot_acres)!=null?esc(d.lot_acres.toFixed(2))+' acres':null],['Year built','year built',num(d.year_built)!=null?esc(String(d.year_built)):null],
   ['Occupancy','occupancy',esc(fmt.share(d.occupancy))||null],['Tenancy','tenancy',str(d.tenancy,40)?esc(str(d.tenancy,40)):null],['Lease term','lease term',str(d.lease_term,40)?esc(str(d.lease_term,40)):null]];
  h+=sec('Numbers',kv(N.map(([l,,v])=>[l,v]))+missing(N.filter(x=>x[2]==null&&!x[3]).map(x=>x[1])));
  const rr=k=>isObj(r[k])?num(r[k].value):null,F=[];
  if(num(d.dscr_res)!=null||num(d.coc_res)!=null)F.push(['At the 30-year rate'+(rr('mortgage_30y')!=null?' of '+fmt.rate(rr('mortgage_30y')):''),d.dscr_res,d.coc_res]);
  if(num(d.dscr_cre)!=null||num(d.coc_cre)!=null)F.push(['At the commercial rate'+(rr('commercial')!=null?' of '+fmt.rate(rr('commercial'))+(isObj(r.commercial)&&r.commercial.kind==='assumption'?', est.':''):''),d.dscr_cre,d.coc_cre]);
  // the loan the card reads (cre_deals `loan`): its monthly cash flow after debt sits under its heading
  const cfm=isObj(d.cf_mo)&&num(d.cf_mo.value)!=null?d.cf_mo:null;
  let fin=F.map(([t,ds,cc],i)=>{const tag=F.length===2?(i?'cre':'res'):num(d.dscr_res)!=null?'res':'cre';
   return '<h4 class="sub-h">'+esc(t)+(d.loan===tag?', used on the card':'')+'</h4>'+kv([['DSCR',esc(fmt.ratio(ds))||null],['Cash-on-cash',esc(fmt.share(cc))||null],
    ['Cash flow, monthly',cfm&&(cfm.loan||d.loan)===tag?esc(fmt.money(cfm.value))+' est.':null]])}).join('');
  const k=num(c.myCap)!=null?stake(d,c.myCap,a):null;
  if(k){const M=v=>c.revealed?esc(v):MASK;
   fin+='<h4 class="sub-h">Your stake</h4>'+kv([['Deal equity needed',esc(fmt.money(k.need))],['Your share',c.revealed?esc((k.share*100).toFixed(k.share<0.1?2:1)+'%'):'\u2022\u2022\u2022'],['Your equity',M(fmt.money(k.equity))],
    ['Your cash flow, yearly',k.cash_flow==null?null:M(fmt.money(k.cash_flow))],['Whole deal inside your budget',k.whole?'Yes':'No']])+
    '<p class="note sm">'+esc(k.fits?'A stake fits: your budget clears the usual LP minimum and the deal covers its debt.':'No stake fit: '+(k.dscr==null?'the deal has no income figure to check its debt.':k.dscr<1?'the deal does not cover its debt at this rate.':'your budget is under the usual LP minimum.'))+'</p>'+
    (c.revealed||!c.canReveal?'':'<button type="button" class="btn btn-sm" data-cre-reveal="1">Show amounts</button>')}
  else if(c.capFail)fin+='<h4 class="sub-h">Your stake</h4><p class="note" role="status">Budget not loaded, so your stake could not be calculated.</p>';
  h+=sec('Financing',fin);
  const cuts=arr(d.cuts).filter(isObj),hist=arr(d.history).filter(x=>Array.isArray(x)&&num(x[0])!=null&&num(x[1])!=null),alt=arr(d.price_alt).filter(isObj);
  const P=[['Listed',esc(fmt.date(d.listed_at))||null],['Days listed',esc(fmt.days(dom(d)))||null]];
  cuts.forEach(x=>P.push(['Price cut'+(fmt.date(x.at)?', '+fmt.date(x.at):''),esc([fmt.money(x.from),fmt.money(x.to)].filter(Boolean).join(' to '))+(num(x.pct)!=null?' ('+esc(fmt.chg(-Math.abs(x.pct)))+')':'')]));
  if(hist.length>1)hist.forEach(x=>P.push(['Asking, '+fmt.date(x[0]),esc(fmt.money(x[1]))]));
  alt.forEach(x=>{if(num(x.price)!=null)P.push(['Also asking elsewhere',esc(fmt.money(x.price))])});
  h+=sec('Price history',kv(P));
  const pc=isObj(d.parcel)?d.parcel:null;
  if(pc)h+=sec('Parcel and zoning',kv([['APN',str(pc.apn,20)?'<span class="code">'+esc(str(pc.apn,20))+'</span>':null],['Parcel size',num(pc.acres)!=null?esc(String(pc.acres))+' acres':null],
   ['Land use',str(pc.land_use,90)?esc(str(pc.land_use,90).replace(/\s*\(SCAG code \d+\)$/,'')):null],['Zoning',str(pc.zoning,30)?esc(str(pc.zoning,30)):null],
   ['General plan',str(pc.general_plan,30)?esc(str(pc.general_plan,30)):null],['Density limit',num(pc.density_max)!=null?esc(pc.density_max+' units per acre'):null],['Floor area ratio',num(pc.far_max)!=null?esc(String(pc.far_max)):null]]));
  const cp=isObj(d.comps)?d.comps:null,near=cp?arr(cp.near).filter(isObj).map(n=>Object.assign({},dealById(data,n.id)||{},n)):[];
  if(near.length)h+=sec('Comps',(num(cp.median_ppsf)!=null?'<p class="note sm">'+esc('Median '+fmt.psf(cp.median_ppsf)+' across '+(num(cp.n)||near.length)+' nearby listings of the same type.')+'</p>':'')+
   '<div class="htw"><table class="htbl"><thead><tr><th scope="col">Address</th><th scope="col" class="n">Price</th><th scope="col" class="n">$/SF</th><th scope="col" class="n" data-pri="2">Distance</th></tr></thead><tbody>'+
   near.map(n=>'<tr tabindex="0" data-cre-open="'+esc(str(n.id,12))+'" data-key="'+esc(str(n.id,12))+'"><th scope="row"><span class="place"><b class="cre-addr">'+esc(str(n.addr,90)||'Address withheld')+'</b></span></th>'+
    [['Price',fmt.money(n.price)],['$/SF',fmt.psf(n.ppsf)]].map(([l,v])=>'<td class="n" data-l="'+l+'">'+(v==null?'<span class="na" aria-label="No data">\u00b7</span>':esc(v))+'</td>').join('')+
    '<td class="n" data-pri="2" data-l="Distance">'+esc(num(n.mi)==null?'Same ZIP':n.mi<0.05?'Same block':n.mi.toFixed(1)+' mi')+'</td></tr>').join('')+'</tbody></table></div>');
  if(c.zipLink&&/^\d{5}$/.test(str(d.zip,5)))h+=sec('Area','<p><button type="button" class="btn" data-open="zip" data-cre-zip="'+esc(d.zip)+'" data-key="'+esc(d.zip)+'"><span class="code">'+esc(d.zip)+'</span>'+esc(where(d))+'</button></p>');
  // /cre has no ZIP sheet to open (row 71): the ZIP's own facts sit here
  else if(!c.zipLink&&/^\d{5}$/.test(str(d.zip,5)))h+=sec('Area',zipFacts(d));
  if(str(d.broker,60))h+=sec('Broker',kv([['Listed by',esc(str(d.broker,60))]]));
  h+='<p class="note sm">Asking prices. Confirm every number with the offering memo.</p>';
  const url=safeUrl(d.url),inCmp=arr(c.compare).includes(d.id);
  const actions='<button type="button" class="btn" data-sheet="data" data-scope="deal:'+esc(str(d.id,12))+'">Data</button>'+
   '<button type="button" class="btn" data-cre-cmp="'+esc(str(d.id,12))+'" aria-pressed="'+inCmp+'">'+(inCmp?'Remove from compare':'Compare')+'</button>'+
   (url?'<a class="btn btn-primary ext" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open listing</a>':'');
  return {title:str(d.title,90)||str(d.addr,120)||'Address withheld',sub:[str(d.title,90)?str(d.addr,120):'',[d.type,d.subtype&&d.subtype!==d.type?d.subtype:''].filter(Boolean).join(', ')].filter(Boolean).join(' \u00b7 '),body:h,actions}}
 // ---- the ZIP's facts for a deal sheet with no ZIP sheet to open (/cre). Values only; where they come from is in the Data sheet.
 function zipFacts(d){const z=isObj(d&&d.zip_f)?d.zip_f:null,head='<p class="note sm"><span class="code">'+esc(str(d.zip,5))+'</span> '+esc(where(d))+'</p>';
  if(!z||!Object.keys(z).length)return head+'<p class="note sm">No area facts for this ZIP yet.</p>';
  // a value keeps its unit on its line: a word joiner on each side of "/" and no-break spaces in "65 of 100"
  const per=(v,u)=>{const m=fmt.money(v);return m==null?null:m+u.replace('/','\u2060/\u2060')};
  const R=[['Typical rent','typical rent',per(z.rent,'/mo')],['Rent, 1-yr change','rent change',fmt.chg(z.rent_yoy)],['Fair market rent, 1 to 2 bedrooms','fair market rent',per(z.fmr_1_2br,'/mo')],
   ['Population','population',fmt.count(z.pop)],['Household income','household income',fmt.money(z.hh_income)],['Housing vacancy','housing vacancy',fmt.share(z.vacancy)],
   ['Renter share','renter share',fmt.share(z.renter_share)],['Homicides per 100K, county','homicide rate',num(z.homicide_rate)!=null?z.homicide_rate.toFixed(1):null],
   ['Colleges within 10 miles','colleges',fmt.count(z.colleges_10mi)],['Businesses, 5-yr change','business change',fmt.chg(z.biz_estabs_5y)],
   ['Area grade','area grade',str(z.area_grade,3)||null],['Commercial score','commercial score',num(z.c_score)!=null?Math.round(z.c_score)+'\u00a0of\u00a0100':null]];
  return head+kv(R.map(([l,,v])=>[l,v==null?null:esc(v)]))+missing(R.filter(x=>x[2]==null).map(x=>x[1]))}
 // ---- the Filters sheet (row 64): the sort, then every filter. Every change applies at once; "Show N deals" closes the sheet; Clear
 // empties it and puts the sort back to the best score.
 function filterSheet(s,total){const f=isObj(s&&s.f)?s.f:{};
  const tog=(name,val,on,label)=>'<button type="button" data-cre-ftog="'+name+'" data-v="'+esc(val)+'" aria-pressed="'+(on?'true':'false')+'"'+(on?' class="on"':'')+'>'+esc(label)+'</button>';
  const field=(name,label,ph,mode)=>'<label class="field">'+esc(label)+'<input data-cre-f="'+name+'" inputmode="'+(mode||'decimal')+'" value="'+esc(num(f[name])==null?'':f[name])+'" placeholder="'+esc(ph||'Any')+'" autocomplete="off"></label>';
  const sort=sortOf(s&&s.sort),body='<form class="cre-boxform" data-cre-fsheet="1" novalidate>'+
   '<label class="field">Sort<select data-cre-fsort="1">'+SORTS.map(([v,l])=>'<option value="'+v+'"'+(v===sort?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select></label>'+
   '<div class="field"><span>Types</span><div class="chips">'+TYPES_ALL.map(t=>tog('types',t,arr(f.types).includes(t),t)).join('')+'</div></div>'+
   '<div class="field"><span>Counties</span><div class="chips">'+COUNTIES.map(c=>tog('counties',c,arr(f.counties).includes(c),SHORT[c])).join('')+'</div></div>'+
   '<div class="fbar-fields">'+field('price_min','Price from','$ any','numeric')+field('price_max','Price to','$ any','numeric')+field('cap_min','Min cap, %')+
   field('units_min','Min units','Any','numeric')+field('units_max','Max units','Any','numeric')+field('sf_min','Min building SF','Any','numeric')+field('dom_max','Max days listed','Any','numeric')+'</div>'+
   '<label class="field">ZIP or city<input data-cre-f="q" value="'+esc(str(f.q,60))+'" placeholder="92614, Irvine" autocomplete="off" enterkeyhint="done"></label>'+
   '<p class="note sm">Filters narrow the deals you see. A saved buy box stays as it is.</p></form>';
  return {title:'Filter and sort',sub:'',body,actions:'<button type="button" class="btn" data-cre-fclear="1">Clear</button><button type="button" class="btn btn-primary" data-close data-cre-fshow="1">'+esc(showLabel(total))+'</button>'}}
 // ---- shared chart and table helpers: DeckUI's inside the deck. /cre loads no deck.js, so LOCAL carries the same functions
 // (DeckUI.sortRows, table, bars, range, line for line; tests/cre_restore.test.js holds them to the same output). The cap rate
 // charts are the desk's own (capChart), on both pages.
 const LOCAL=(()=>{
  const DOT='\u00B7',NA='<span class="na" aria-label="No data">'+DOT+'</span>',MIN='\u2212';
  const grp=s=>String(s).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const txt=v=>v==null?'':String(v);
  const keyAttr=k=>k==null||k===''?'':' data-key="'+esc(k)+'"';
  const openKind=k=>/^[a-z][a-z0-9-]{0,30}$/.test(String(k||''))?String(k):'';
  const pc=x=>Math.round(Math.max(0,Math.min(100,x))*10)/10+'%';
  function count(v){const n=num(v);if(n==null)return null;const a=Math.abs(n);let s;
   if(a>=999.95e6)s=(a/1e9).toFixed(1)+'B';else if(a>=999.95e3)s=(a/1e6).toFixed(1)+'M';else if(a>=9999.5)s=(a/1e3).toFixed(1)+'K';else s=grp(Math.round(a));
   return (n<0?MIN:'')+s}
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
  function bars(items,o){o=isObj(o)?o:{};let l=arr(items).filter(isObj);if(!l.length)return '';
   if(o.sort!==false)l=sortRows(l,'value','descending');
   const vs=l.map(x=>num(x.value)).filter(x=>x!=null),max=num(o.max)||Math.max(0,...vs);
   return '<div class="hbars">'+l.map(x=>{const v=num(x.value),t=v==null?null:(x.text!=null?txt(x.text):count(v));
    return '<div class="hbar'+(x.on?' on':'')+'"'+keyAttr(x.key)+'><span>'+esc(x.label)+'</span><div>'+(v==null?'':'<i style="--v:'+pc(max>0?100*Math.max(0,v)/max:0)+'"></i>')+'<b>'+(v==null?NA:esc(t))+'</b></div></div>'}).join('')+'</div>'}
  function range(o){o=isObj(o)?o:{};const lo=num(o.min),hi=num(o.max);if(lo==null||hi==null||!(hi>lo))return '';
   const f=typeof o.fmt==='function'?o.fmt:fmt.money,P=v=>pc(100*(v-lo)/(hi-lo)),q1=num(o.p25),q3=num(o.p75),md=num(o.med),cu=num(o.cur),lab=v=>txt(f(v));
   const vars=['--lo:0%','--hi:100%'].concat(q1!=null&&q3!=null?['--q1:'+P(q1),'--q3:'+P(q3)]:[],md!=null?['--md:'+P(md)]:[],cu!=null?['--cu:'+P(cu)]:[]).join(';');
   const aria=[md!=null?'Median '+lab(md):'',q1!=null&&q3!=null?'middle half '+lab(q1)+' to '+lab(q3):'',cu!=null?'now '+lab(cu):''].filter(Boolean).join(', ');
   return '<div class="range" style="'+vars+'" role="img" aria-label="'+esc(aria||lab(lo)+' to '+lab(hi))+'">'+(q1!=null&&q3!=null?'<span class="band"></span>':'')+(md!=null?'<span class="med"></span>':'')+(cu!=null?'<span class="cur"></span>':'')+'</div>'+
    '<div class="range-l"><span>'+esc(lab(lo))+'</span>'+(md!=null?'<span>'+esc(lab(md))+'</span>':'')+'<span>'+esc(lab(hi))+'</span></div>'}
  return {sortRows,table,bars,range}})();
 const UI=()=>{const u=typeof DeckUI!=='undefined'?DeckUI:null;return u&&['sortRows','table','bars','range'].every(k=>typeof u[k]==='function')?u:LOCAL};
 // ---- market overview (rows 65, 66): every deal on the desk summed up by asset class, county and ZIP, and the old desk's six charts
 const med=xs=>{const v=xs.filter(x=>num(x)!=null).sort((a,b)=>a-b);if(!v.length)return null;const m=v.length>>1;return v.length%2?v[m]:(v[m-1]+v[m])/2};
 const quart=(v,p)=>{const i=(v.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return v[lo]+(v[hi]-v[lo])*(i-lo)};
 const listedCap=d=>capKind(d)==='listed'?cap(d):null;
 const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 const OV_GROUPS=[['type','By asset class','Asset class',d=>str(d.type,30)||'Other'],['county','By county','County',d=>SHORT[str(d.county,40)]||str(d.county,40).replace(/ County$/,'')||null],
  ['zip','By ZIP','ZIP',d=>/^\d{5}$/.test(str(d.zip,5))?str(d.zip,5):null]];
 const OV_MAX=12;
 function summarize(deals,keyOf){const g=new Map();for(const d of arr(deals)){if(!isObj(d))continue;const k=keyOf(d);if(!k)continue;if(!g.has(k))g.set(k,[]);g.get(k).push(d)}
  return [...g].map(([k,xs])=>({k,city:str(xs[0].city,30),n:xs.length,price:med(xs.map(d=>num(d.price))),ppsf:med(xs.map(d=>num(d.ppsf))),ppu:med(xs.map(d=>num(d.ppu))),
   cap:med(xs.map(listedCap)),dom:med(xs.map(dom)),cuts:100*xs.filter(d=>arr(d.cuts).length).length/xs.length}))}
 function overviewModel(deals,data){const ds=arr(deals).filter(isObj),D=isObj(data)?data:{},r=isObj(D.rates)?D.rates:{},rv=k=>isObj(r[k])?num(r[k].value):null;
  const tables={};for(const [id,,,key] of OV_GROUPS){const rows=summarize(ds,key);tables[id]=id==='zip'?rows.filter(x=>x.n>=3):rows}
  const byT={};for(const d of ds){const c=cap(d);if(c!=null&&c>0&&c<=30&&str(d.type,30))(byT[d.type]=byT[d.type]||[]).push(c)}
  const caps=Object.entries(byT).filter(([,v])=>v.length>=3).map(([t,v])=>{v.sort((a,b)=>a-b);return {label:t,n:v.length,hi:v[v.length-1],p25:quart(v,.25),med:quart(v,.5),p75:quart(v,.75)}}).sort((a,b)=>b.n-a.n).slice(0,7);
  const pts=ds.filter(d=>cap(d)!=null&&cap(d)>0&&cap(d)<=14&&num(d.ppsf)!=null&&d.ppsf>0&&d.ppsf<2500).map(d=>({id:str(d.id,12),x:d.ppsf,y:cap(d),est:capKind(d)==='est'}));
  const days=ds.map(dom).filter(x=>x!=null&&x>=0),B=[[0,8,'0 to 7 days'],[8,31,'8 to 30 days'],[31,91,'31 to 90 days'],[91,181,'91 to 180 days'],[181,366,'181 to 365 days'],[366,Infinity,'Over a year']];
  const byC={};for(const d of ds){const c=OV_GROUPS[1][3](d);if(c)byC[c]=(byC[c]||0)+1}
  // month first listed: the deal's days on market counted back from when the desk was built; the last twelve months
  const t=num(D.generated_at)||Date.now()/1000,ym=s=>{const x=new Date(s*1000);return x.getUTCFullYear()*12+x.getUTCMonth()},end=ym(t);
  const months=Array.from({length:12},(_,i)=>{const k=end-11+i;return {label:MON[k%12]+' '+Math.floor(k/12),value:0}});
  for(const x of days){const i=ym(t-x*86400)-(end-11);if(i>=0&&i<12)months[i].value++}
  const ct=isObj(r.commercial)&&r.commercial.kind==='assumption'?'Commercial loan, est.':'Commercial loan';
  return {n:ds.length,head:[['Deals',fmt.count(ds.length)],['Median price',fmt.money(med(ds.map(d=>num(d.price))))],['Median $/SF',fmt.psf(med(ds.map(d=>num(d.ppsf))))],['Median listed cap',fmt.rate(med(ds.map(listedCap)))]].filter(x=>x[1]!=null),
   tables,caps,pts,loan:rv('commercial'),dom:B.map(([a,b,l])=>({label:l,value:days.filter(x=>x>=a&&x<b).length})),
   county:Object.entries(byC).sort((a,b)=>b[1]-a[1]).slice(0,7).map(([label,value])=>({label,value})),months,fresh:days.filter(x=>x<30).length,stale:days.filter(x=>x>=90).length,
   rates:[['30-year mortgage',rv('mortgage_30y')],['10-year Treasury',rv('treasury_10y')],[ct,rv('commercial')],['Median listed cap',med(ds.map(listedCap))]].filter(x=>x[1]!=null).map(([label,value])=>({label,value,text:fmt.rate(value)}))}}
 const OVCOLS=first=>[{key:'k',label:first,place:true,sort:true},{key:'n',label:'Listings',num:true,sort:true,fmt:v=>fmt.count(v)},{key:'price',label:'Median price',num:true,sort:true,fmt:v=>fmt.money(v)},
  {key:'ppsf',label:'Median $/SF',num:true,sort:true,fmt:v=>fmt.psf(v)},{key:'cap',label:'Median listed cap',num:true,sort:true,fmt:v=>fmt.rate(v)},
  {key:'dom',label:'Median days listed',num:true,sort:true,fmt:v=>num(v)==null?null:fmt.count(Math.round(v))},{key:'ppu',label:'Median $/unit',num:true,sort:true,fmt:v=>fmt.money(v)},
  {key:'cuts',label:'With price cuts',num:true,sort:true,fmt:v=>fmt.share(v)}];
 // one summary table, sorted by any column (st = {key, dir}); a header tap re-sorts it in place (data-cre-ovt names the table). It scrolls
 // sideways with the first column held (like Compare), so every column and its sort button stay in reach on a phone too.
 function ovTable(id,m,st){const g=OV_GROUPS.find(x=>x[0]===id);if(!g||!isObj(m)||!isObj(m.tables))return '';const U=UI(),s=isObj(st)&&st.key?st:{key:'n',dir:'descending'};
  const cols=OVCOLS(g[2]);if(id==='zip')cols[0].sub=r=>r.city;
  const rows=U.sortRows(arr(m.tables[id]),s.key,s.dir),shown=rows.slice(0,OV_MAX);
  if(!rows.length)return '<div class="cre-ovt" data-cre-ovt="'+id+'">'+empty('idle',id==='zip'?'No ZIP has 3 or more deals yet.':'No deals to sum up yet.','')+'</div>';
  return '<div class="cre-ovt" data-cre-ovt="'+id+'">'+U.table({cols,rows:shown,presorted:true,sorted:{key:s.key,dir:s.dir},label:g[1],max:OV_MAX,key:r=>r.k}).replace('<div class="htw">','<div class="htw scroll">')+
   (rows.length>shown.length?'<p class="note sm">'+esc('First '+shown.length+' of '+rows.length+(id==='zip'?' ZIPs with 3 or more deals':'')+'.')+'</p>':'')+'</div>'}
 function overviewSheet(m,st){const U=UI(),o=isObj(st)?st:{},sec=(t,b)=>'<section class="sh-sec"><h3>'+esc(t)+'</h3>'+b+'</section>';
  const data='<button type="button" class="btn" data-sheet="data">Data</button>';
  if(!isObj(m)||!m.n)return {title:'Market overview',sub:'',body:empty('idle','No deals on the desk yet.',''),actions:data};
  let h='<div class="cre-ov">'+(m.head.length?'<div class="strip" data-n="'+m.head.length+'" data-nb="'+m.head.length+'">'+m.head.map(([l,v])=>'<div class="tile"><span class="h">'+esc(l)+'</span><b class="v">'+esc(v)+'</b></div>').join('')+'</div>':'');
  for(const [id,title] of OV_GROUPS)h+=sec(title,ovTable(id,m,o[id]));
  if(m.caps.length){const hi=Math.min(14,Math.ceil(Math.max(...m.caps.map(c=>c.hi)))),cl=v=>Math.min(v,hi);
   h+=sec('Cap rate by asset class','<div class="cre-caps">'+m.caps.map(c=>'<div class="cre-capr"><p><span>'+esc(c.label)+'</span><b>'+esc('Median '+fmt.rate(c.med))+'</b><small>'+esc(fmt.count(c.n)+' caps')+'</small></p>'+
    U.range({min:0,max:hi,p25:cl(c.p25),p75:cl(c.p75),med:cl(c.med),fmt:v=>fmt.share(v)})+'</div>').join('')+'<div class="range-l"><span>0%</span><span>'+esc(hi+'%')+'</span></div></div>'+
    '<p class="note sm">The band is the middle half of the caps, the tick the median. Listed and estimated caps.</p>')}
  else h+=sec('Cap rate by asset class',empty('idle','Too few cap rates per class to chart.',''));
  // the same chart as the desk's cap rate by price (V21): log x, the loan line named at its end, one sentence under it
  const pm=capModel(m.pts,m.loan,v=>fmt.psf(v));
  h+=sec('Price per SF against cap rate',pm?capChart(pm,{label:pm.n+' deals by price per SF and cap rate'}):empty('idle','Too few deals with both numbers to chart.',''));
  const n=v=>fmt.count(v);
  h+=sec('Days on market',U.bars(m.dom.map(b=>({label:b.label,value:b.value,text:n(b.value)})),{sort:false}));
  h+=sec('Listings by county',m.county.length?U.bars(m.county.map(b=>({label:b.label,value:b.value,text:n(b.value)}))):empty('idle','No county on these deals.',''));
  h+=sec('Listings by month first listed',U.bars(m.months.map(b=>({label:b.label,value:b.value,text:n(b.value)})),{sort:false})+
   '<p class="note sm">'+esc(n(m.fresh)+' new in the last 30 days. '+n(m.stale)+' listed 90 days or more.')+'</p>');
  if(m.rates.length)h+=sec('Rates against cap rates',U.bars(m.rates,{sort:false}));
  h+='<p class="note sm">Asking prices, not sales. A median leaves out deals that do not show the number.</p>';
  return {title:'Market overview',sub:fmt.count(m.n)+(m.n===1?' deal':' deals'),body:h+'</div>',actions:data,wide:true}}
 // ---- compare up to four deals side by side (the one sheet table that scrolls sideways, with a frozen first column)
 const CMP=[['Asking price',d=>fmt.money(d.price)],['Type',d=>str(d.type,20)||null],['Units',d=>units(d)!=null?fmt.count(units(d))+(unitsEst(d)?' est.':''):null],['Price per SF',d=>fmt.psf(d.ppsf)],['Price per unit',d=>fmt.money(d.ppu)],
  ['Cap rate',d=>capKind(d)?fmt.rate(cap(d))+(capKind(d)==='listed'?' listed':' est.'):null],['NOI',d=>isObj(d.noi_v)?fmt.money(d.noi_v.value):null],['GRM',d=>num(d.grm)!=null?d.grm.toFixed(1):null],
  ['DSCR, 30-year',d=>fmt.ratio(d.dscr_res)],['Cash-on-cash, 30-year',d=>fmt.share(d.coc_res)],['DSCR, commercial',d=>fmt.ratio(d.dscr_cre)],['Cash-on-cash, commercial',d=>fmt.share(d.coc_cre)],
  ['Cash flow, monthly',d=>isObj(d.cf_mo)&&num(d.cf_mo.value)!=null?fmt.money(d.cf_mo.value)+' est.':null],
  ['Days listed',d=>fmt.days(dom(d))],['Price cuts',d=>arr(d.cuts).length?String(arr(d.cuts).length):null],['Zoning',d=>isObj(d.parcel)&&str(d.parcel.zoning,20)||null],
  ['Comps median $/SF',d=>isObj(d.comps)?fmt.psf(d.comps.median_ppsf):null],['ZIP rent change, 1-yr',d=>fmt.chg(isObj(d.zip_f)?d.zip_f.rent_yoy:null)],['ZIP household income',d=>fmt.money(isObj(d.zip_f)?d.zip_f.hh_income:null)],
  ['Score',d=>num(d.score)!=null?String(Math.round(d.score)):null]];
 function compareSheet(ds,data){const xs=arr(ds).filter(isObj).map(d=>withZip(d,data));if(!xs.length)return null;
  return {title:'Compare '+xs.length+' deals',sub:'',wide:true,body:'<div class="htw scroll"><table class="htbl"><thead><tr><th scope="col">Deal</th>'+xs.map(d=>'<th scope="col">'+esc(str(d.title,40)||str(d.addr,60))+'</th>').join('')+'</tr></thead><tbody>'+
   CMP.map(([l,f])=>'<tr><th scope="row">'+esc(l)+'</th>'+xs.map(d=>{const v=f(d);return '<td>'+(v==null?'<span class="na" aria-label="No data">\u00b7</span>':esc(v))+'</td>'}).join('')+'</tr>').join('')+'</tbody></table></div>',actions:''}}
 // ---- buy box editor (sheet). Save is one tap (it changes only this person's profile); Delete needs a second tap.
 const parsePlaces=t=>{const parts=String(t||'').split(',').map(x=>x.trim()).filter(Boolean),zips=parts.filter(x=>/^\d{3}(\d{2})?$/.test(x)),cities=parts.filter(x=>!/^\d+$/.test(x));
  return {zips:zips.slice(0,40),q:cities[0]?cities[0].slice(0,60):'',extra:cities.length>1}};
 function boxSheet(box,s){const data=isObj(s&&s.data)?s.data:{},prof=isObj(data.profile)?data.profile:{},f=isObj(box&&box.f)?box.f:{};
  const types=arr(data.types).filter(t=>t!=='Other');const T=types.length?types:TYPES_ALL;
  const tog=(name,val,on,label)=>'<button type="button" data-cre-tog="'+name+'" data-v="'+esc(val)+'" aria-pressed="'+(on?'true':'false')+'"'+(on?' class="on"':'')+'>'+esc(label)+'</button>';
  const field=(name,label,v,ph,mode)=>'<label class="field">'+esc(label)+'<input name="'+name+'" inputmode="'+(mode||'decimal')+'" value="'+esc(num(v)==null?'':v)+'" placeholder="'+esc(ph||'Any')+'" autocomplete="off"></label>';
  const places=arr(f.zips).concat(str(f.q,60)?[str(f.q,60)]:[]).join(', ');
  const fresh=box?newIds(arr(data.deals),box,prof.seen):null,hits=box?arr(data.deals).filter(d=>match(d,box.f)).length:0;
  const body='<form class="cre-boxform" data-cre-form="1" novalidate>'+
   '<label class="field">Name<input name="name" maxlength="40" value="'+esc(box?str(box.name,40):'')+'" autocomplete="off" required></label>'+
   '<div class="field"><span>Types</span><div class="chips">'+T.map(t=>tog('types',t,arr(f.types).includes(t),t)).join('')+'</div></div>'+
   '<div class="fbar-fields">'+field('price_min','Price from',f.price_min,'$ any','numeric')+field('price_max','Price to',f.price_max,'$ any','numeric')+field('cap_min','Min cap, %',f.cap_min)+field('dscr_min','Min DSCR',f.dscr_min)+field('dom_max','Max days listed',f.dom_max,'Any','numeric')+'</div>'+
   '<div class="field"><span>Counties</span><div class="chips">'+COUNTIES.map(c=>tog('counties',c,arr(f.counties).includes(c),SHORT[c])).join('')+'</div></div>'+
   '<label class="field">Cities or ZIPs<input name="places" value="'+esc(places)+'" placeholder="92614, 926, Irvine" autocomplete="off"></label>'+
   (box?'<p class="note sm">'+esc(fresh==null?hits+' deals match. New-match alerts start once you mark them seen.':fresh.length+' new since you last marked this box seen.')+'</p>':'')+
   (s&&s.boxMsg?'<p class="note sm" role="status">'+esc(s.boxMsg)+'</p>':'')+'</form>';
  const actions=(box?'<button type="button" class="b'+(s&&s.armDel?' armed':'')+'" data-cre-del="'+esc(box.id)+'">'+(s&&s.armDel?'Tap again to delete':'Delete')+'</button>'+
   '<button type="button" class="btn" data-cre-seen="'+esc(box.id)+'">Mark '+hits+' seen</button>':'')+'<button type="button" class="btn btn-primary" data-cre-save="1">Save</button>';
  return {title:box?'Edit buy box':'New buy box',sub:'',body,actions}}
 // the POST body for a save: the form's fields replace theirs; keys the form does not show (units, SF, score, sort) carry over
 function boxPayload(person,form,box,boxes){const o=isObj(form)?form:{},old=isObj(box&&box.f)?box.f:{},name=str(o.name,40);
  if(!name)return {error:'Name the buy box first.'};
  const f={};for(const k of ['units_min','units_max','sf_min','score_min','sale_or_lease','sort'])if(old[k]!=null)f[k]=old[k];
  for(const k of ['types','counties'])if(arr(o[k]).length)f[k]=arr(o[k]).slice(0,12);
  const LBL={price_min:'Price from',price_max:'Price to',cap_min:'Min cap',dscr_min:'Min DSCR',dom_max:'Max days listed'};
  for(const k of ['price_min','price_max','cap_min','dscr_min','dom_max']){const v=String(o[k]==null?'':o[k]).replace(/[$,%\s]/g,'');if(v==='')continue;const n=Number(v);if(!isFinite(n)||n<0)return {error:'Numbers only in '+LBL[k]+'.'};f[k]=n}
  const p=parsePlaces(o.places);if(p.extra)return {error:'One city per buy box; add ZIPs for more places.'};
  if(p.zips.length)f.zips=p.zips;if(p.q)f.q=p.q;
  let id=box&&box.id?box.id:slug(name);if(!(box&&box.id)){const ids=new Set(arr(boxes).filter(isObj).map(x=>x.id));let i=2;const base=id.slice(0,20);while(ids.has(id))id=base+'-'+(i++)}
  return {person,op:'box',box:{id,name,f}}}
 // ---- the desk's part of the Data sheet: listing sources, the deal score method, the loan assumptions. reason: the server's own words
 // when the desk is not reporting (E9): they go here, in the Setup list, never on the desk
 // deal: the deal a sheet's Data button names (data-scope="deal:<id>"); its own bases (rent source, unit estimate, income, cash flow) lead
 function dataParts(data,reason,deal){const d=isObj(data)?data:{},c=isObj(d.counts)?d.counts:{},r=isObj(d.rates)?d.rates:{},a=isObj(d.assumptions)?d.assumptions:{},m=isObj(d.method)?d.method:{};
  const sources=Object.entries(isObj(c.by_source)?c.by_source:{}).sort((x,y)=>y[1]-x[1]).map(([k,v])=>({name:srcName(k),gives:fmt.count(v)+' listings',asOf:fmt.date(d.generated_at)||'',state:'ok'}));
  const method=arr(m.weights).filter(isObj).map(w=>[str(w.label,120),Math.round((num(w.weight)||0)*100)+'%']);
  if(isObj(a.cre)&&str(a.cre.label,160))method.push(['Commercial loan',str(a.cre.label,160)]);
  if(isObj(a.res)&&str(a.res.label,160))method.push(['30-year loan',str(a.res.label,160)]);
  if(str(a.loan_by_units,240))method.push(['Loan by size',str(a.loan_by_units,240)]);
  if(str(a.rent,400))method.push(['Multifamily rent',str(a.rent,400)]);
  if(str(a.res_mf_units,300))method.push(['Units on residential listings',str(a.res_mf_units,300)]);
  const rs=Object.entries(isObj(c.by_rent_src)?c.by_rent_src:{}).filter(([k])=>/^(HUD|Census)/.test(k)).sort((x,y)=>y[1]-x[1]);
  if(rs.length)method.push(['Rent sources used',rs.map(([k,v])=>k+': '+fmt.count(v)+(v===1?' deal':' deals')).join('; ')]);
  // a deal's yearly gross rent in words, from the figures the file keeps (units, unit_rent) and the assumptions
  function incomeWords(D,a){const er=isObj(a.expense_ratio)?num(a.expense_ratio[D.type])??num(a.expense_ratio._):null,vac=num(a.vacancy),u=units(D),ur=isObj(D.unit_rent)?num(D.unit_rent.value):null;
   const less=er!=null&&vac!=null?', less '+Math.round(vac*100)+'% vacancy and '+Math.round(er*100)+'% expenses (assumptions)':'';
   if(u!=null&&ur!=null)return fmt.count(u)+(unitsEst(D)?' estimated':' listed')+' units x '+fmt.money(ur)+'/mo per unit x 12'+less;
   if(isObj(D.noi_v)&&String(D.noi_v.kind||'').indexOf('listed')===0)return 'Listed NOI grossed up by the expense and vacancy assumptions';
   return ''}
  if(isObj(deal)){const D=deal,own=[['This deal, rent',str(D.rent_src,200)],['This deal, units',isObj(D.units_est)?str(D.units_est.basis,200):''],
    ['This deal, income',isObj(D.gross)?str(D.gross.src,300)||incomeWords(D,a):''],
    // the lean file keeps no per-deal sentences (2026-11-17): the loan the card used names its terms
    ['This deal, cash flow',isObj(D.cf_mo)&&isObj(a[D.loan])?'NOI less yearly debt service, '+str(a[D.loan].label,160)+', shown monthly':'']].filter(x=>x[1]);method.unshift(...own)}
  if(isObj(r.commercial)&&str(r.commercial.src,120))method.push(['Loan rate',str(r.commercial.src,120)]);
  if(num(c.listed_cap)!=null)method.push(['Cap rates',fmt.count(c.listed_cap)+' listed by brokers, '+fmt.count(c.estimated_cap)+' estimated from public rents']);
  method.push(['Prices','Asking, not sold'],['Listings','California for now; listings elsewhere are held on site terms']);
  if(str(m.note,400))method.push(['Score',str(m.note,400)]);
  const why=str(reason,160),setup=why?[{name:'Deal desk',line:why.charAt(0).toUpperCase()+why.slice(1),state:'not_reporting'}]:[];
  return {sources,method,setup:setup.concat([{name:'LoopNet, Crexi and other CoStar sites',line:'Not read, by rule',state:'blocked'}])}}
 // the same parts as sheet markup, for /cre where no DeckUI.dataSheet exists
 function dataSheetHtml(p){const pill=k=>k==='ok'?'<span class="pill ok"><span class="sd ok"></span>OK</span>':k==='blocked'?'<span class="pill bad"><span class="sd bad"></span>Blocked</span>':k==='not_reporting'?'<span class="pill bad"><span class="sd bad"></span>Not reporting</span>':'<span class="pill warn"><span class="sd warn"></span>Out of date</span>';
  return '<section class="sh-sec ds-src"><h3>Sources</h3><div class="flist">'+arr(p.sources).map(x=>'<div class="frow"><div class="fl"><b>'+esc(x.name)+'</b><small>'+esc(x.gives)+'</small></div><div class="fr"><b>'+esc(x.asOf)+'</b><small>'+pill(x.state)+'</small></div></div>').join('')+'</div></section>'+
   '<section class="sh-sec"><h3>Method</h3>'+kv(arr(p.method).map(([k,v])=>[k,esc(v)]))+'</section>'+
   '<section class="sh-sec"><h3>Setup</h3><div class="flist">'+arr(p.setup).map(x=>'<div class="frow"><div class="fl"><b>'+esc(x.name)+'</b><small>'+esc(x.line)+'</small></div><div class="fr">'+pill(x.state)+'</div></div>').join('')+'</div></section>'}
 // ---- every desk request is bounded (PageLanes 13): a fetch that never settles resolves {ok:false, status:0, error:'timed out'}
 // after ms, aborts, and the desk paints its not-reporting state instead of a blank slot. Used on /cre (no deck.js) and for POSTs.
 const TIMEOUT_MS=60000;
 async function request(fetchImpl,url,init,ms){const f=typeof fetchImpl==='function'?fetchImpl:null;if(!f)return {ok:false,status:0,data:null,error:'no answer'};
  const c=typeof AbortController==='function'?new AbortController():null;let timer=0;
  try{const cut=new Promise((_,no)=>{timer=setTimeout(()=>{if(c)c.abort();no(new Error('timed out'))},num(ms)||TIMEOUT_MS)});
   const r=await Promise.race([f(url,Object.assign({credentials:'same-origin',cache:'no-store'},init||{},c?{signal:c.signal}:{})),cut]);
   let data=null;try{data=await Promise.race([r.json(),cut])}catch(e){if(String(e&&e.message)==='timed out')throw e}
   return {ok:!!r.ok&&!(isObj(data)&&(data.status==='not_reporting'||data.error)),status:r.status,data,error:''}}
  catch(e){return {ok:false,status:0,data:null,error:String(e&&e.message)==='timed out'?'timed out':'no answer'}}
  finally{clearTimeout(timer)}}
 return {request,TIMEOUT_MS,esc,fmt,match,sortDeals,newIds,stake,isSmall,inView,slug,LP_MIN,VIEWS,COUNTIES,LISTING_STATES,covers,cap,capKind,units,unitsEst,isLease,countText,countLine,dealsQuery,cardModel,card,chips,render,nextCount,
  capModel,capChart,scatterModel,scatter,dealSheet,compareSheet,boxSheet,boxPayload,parsePlaces,dataParts,dataSheetHtml,srcName,
  SORTS,filterCount,readFilters,scopeOf,inPage,localRows,tools,headTools,showLabel,filterSheet,zipFacts,LOCAL,UI,summarize,overviewModel,ovTable,overviewSheet}})();
// ==== DECK CRE PURE END ====

// ---- the live desk. creMount(el, {person, viewer, scatterEl, toolsEl, type, scope, scopeKind, onZip}) returns {load, set, state, dataParts}.
// Inside the deck it opens sheets through DeckShell.sheet; on /cre it uses its own <dialog class="sheet">.
function creMount(el,opts){if(!el)return null;if(el._cre)return el._cre;
 const o=opts||{},D=DeckCRE;
 const S={data:null,status:'loading',person:o.person||'tanner',viewer:!!o.viewer,boxId:null,view:'all',type:o.type||null,scope:o.scope||'',scopeKind:o.scopeKind||null,
  price_max:null,rows:[],total:0,offset:0,dataset:null,counts:{},viewCounts:{},scatterRows:[],compare:[],msg:'',cap:null,capFail:false,revealed:false,armDel:false,boxMsg:'',open:null,tok:0,
  f:{},sort:'score',ov:{},ms:null,headTools:!!o.toolsEl,reason:'',cols:1};
 const shell=typeof DeckShell!=='undefined'&&DeckShell&&DeckShell.sheet?DeckShell:null;
 let dlg=null;
 function openSheet(sp){if(!sp)return;
  if(shell){shell.sheet.open({id:'cre-'+(sp.id||'sheet'),title:sp.title,sub:sp.sub,body:sp.body,actions:sp.actions,wide:!!sp.wide});return}
  if(!dlg){dlg=document.createElement('dialog');dlg.className='sheet';dlg.setAttribute('aria-labelledby','cre-sh-t');document.body.appendChild(dlg);
   dlg.addEventListener('click',e=>{if(e.target===dlg||(e.target.closest&&e.target.closest('.sheet-x,[data-close]'))){dlg.close();return}onClick(e)})}
  dlg.className='sheet'+(sp.wide?' wide':'');
  dlg.innerHTML='<header class="sheet-h"><div><h2 id="cre-sh-t" tabindex="-1">'+D.esc(sp.title)+'</h2>'+(sp.sub?'<p>'+D.esc(sp.sub)+'</p>':'')+'</div><button type="button" class="sheet-x" aria-label="Close"><svg class="i" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>'+
   '<div class="sheet-b">'+sp.body+'</div>'+(sp.actions?'<footer class="sheet-a">'+sp.actions+'</footer>':'');
  if(!dlg.open)dlg.showModal();const t=dlg.querySelector('#cre-sh-t');if(t)t.focus()}
 const sheetEl=()=>shell?(typeof shell.sheet.current==='function'&&shell.sheet.current())||document.querySelector('dialog.sheet[open]'):dlg;
 const closeSheet=()=>{if(shell)shell.sheet.close();else if(dlg&&dlg.open)dlg.close();S.open=null};
 async function get(path){if(typeof DeckPages!=='undefined'&&DeckPages.get)return DeckPages.get(path,{timeout:D.TIMEOUT_MS});
  return D.request(typeof fetch==='function'?fetch:null,'/api/'+path)}
 const TL={multifamily:'Multifamily',retail:'Retail',office:'Office',industrial:'Industrial'};
 const typeName=()=>S.type?(TL[S.type]||S.type):null;
 const allDeals=()=>S.data&&Array.isArray(S.data.deals)?S.data.deals:[];
 const boxes=()=>S.data&&S.data.profile&&Array.isArray(S.data.profile.boxes)?S.data.profile.boxes:[];
 const q=x=>D.dealsQuery(Object.assign({person:S.person,viewer:S.viewer,type:typeName(),scope:S.scope,price_max:S.price_max,sort:S.sort},x));
 function paint(){const a=document.activeElement,key=a&&el.contains(a)&&a.dataset?a.dataset.key||a.dataset.creBox||a.dataset.creView:null;
  el.innerHTML=D.render(S);if(o.toolsEl)o.toolsEl.innerHTML=D.headTools(S);if(o.scatterEl)o.scatterEl.innerHTML=S.status==='bad'?'':D.scatter(S.scatterRows,S.data&&S.data.rates&&S.data.rates.commercial?S.data.rates.commercial.value:null);
  if(key){const n=el.querySelector('[data-key="'+key+'"],[data-cre-box="'+key+'"],[data-cre-view="'+key+'"]');if(n)n.focus()}
  if(typeof DeckShell!=='undefined'&&DeckShell.tv&&DeckShell.tv.refresh)DeckShell.tv.refresh();
  if(typeof o.onPaint==='function')o.onPaint(S)}
 // the investor views and the Filters sheet work on every deal here (the stake needs the budget, which never leaves this browser);
 // S.ms keeps how long the last pass took
 const local=()=>S.view!=='all'||D.filterCount(S.f)>0;
 const now=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
 function localRows(){const t0=now(),rows=D.localRows(allDeals(),Object.assign({},S,{typeName:typeName()}));S.ms=now()-t0;return rows}
 // W4-4: the cards come a whole number of grid rows at a time (12, or 15 at five columns), Show more too, so no row ends short of its
 // neighbours. The column count is read from the grid on screen (the loading cards share it)
 function colsOf(){const g=el.querySelector('.cre-cards');if(!g||typeof getComputedStyle!=='function')return S.cols;
  // a laid-out grid answers its tracks in px; a hidden one answers the declared template (repeat(...)), which is not a count
  const n=String(getComputedStyle(g).gridTemplateColumns||'').trim().split(/\s+/).filter(x=>/px$/.test(x)).length;return n||S.cols}
 async function cards(reset){const t=++S.tok;if(reset){S.offset=0;S.rows=[];S.status='loading';paint()}
  S.cols=colsOf();const want=D.nextCount(S.offset,S.cols);
  if(local()){const all=localRows();S.rows=all.slice(0,want);S.total=all.length;S.status='ok';paint();return}
  const r=await get(q({box:S.boxId,offset:S.offset,limit:want-S.offset}));if(t!==S.tok)return;
  // the server's reason is kept for the Data sheet only (E9)
  if(!r.ok||!r.data||!Array.isArray(r.data.rows)){S.status='bad';S.reason=r.data&&(r.data.reason||r.data.error)||r.error||'';S.offline=offlineOf(r);paint();return}
  S.rows=S.offset?S.rows.concat(r.data.rows):r.data.rows;S.total=r.data.total;S.dataset=r.data.dataset||null;S.status='ok';S.reason='';paint()}
 async function counts(){const t=S.tok,ids=[''].concat(boxes().map(b=>b.id));
  const rs=await Promise.all(ids.map(id=>get(q({box:id||null,limit:1,offset:0}))));if(t!==S.tok)return;
  S.counts={};ids.forEach((id,i)=>{const r=rs[i];if(r.ok&&r.data&&typeof r.data.total==='number')S.counts[id]=r.data.total});
  const page={type:typeName(),scope:S.scope,price_max:S.price_max};S.viewCounts={};if(S.cap!=null)for(const [k] of D.VIEWS)S.viewCounts[k]=allDeals().filter(d=>D.inPage(d,page)&&D.inView(d,k,S)).length;
  const sc=await get(q({limit:100,offset:0}));if(t!==S.tok)return;S.scatterRows=sc.ok&&sc.data?sc.data.rows||[]:[];paint()}
 async function load(){S.status='loading';S.reason='';S.data=S.data||null;paint();
  const r=await get('cre'+(S.viewer?'':'?person='+encodeURIComponent(S.person)));
  if(!r.ok||!r.data||r.data.error||!Array.isArray(r.data.deals)){S.status='bad';S.data=null;S.reason=r.data&&(r.data.reason||r.data.error)||r.error||'';S.offline=offlineOf(r);paint();return}
  S.offline=false;
  S.data=r.data;if(r.data.person)S.person=r.data.person;S.viewer=S.viewer||!!r.data.viewer;
  S.cap=null;S.capFail=false;
  if(!S.viewer&&S.person==='tanner'){const p=await get('housing/profile');const b=p.ok&&p.data&&p.data.budget;
   if(b&&typeof b.budget==='number'&&b.budget>0)S.cap=b.budget;else if(!(p.ok&&p.data))S.capFail=true}
  try{const v=JSON.parse(localStorage.getItem('cre:compare:'+S.person)||'[]');S.compare=Array.isArray(v)?v.filter(x=>typeof x==='string'&&/^[0-9a-f]{12}$/.test(x)).slice(0,4):[]}catch(e){S.compare=[]}
  if(S.boxId&&!boxes().some(b=>b.id===S.boxId))S.boxId=null;
  await cards(true);counts()}
 // the desk's own Try again for the budget: the read once more, then the list under it, with no reload (ReviewSix, #399)
 async function capRetry(){const p=await get('housing/profile');const b=p.ok&&p.data&&p.data.budget;
  if(b&&typeof b.budget==='number'&&b.budget>0)S.cap=b.budget;else S.cap=null;
  S.capFail=!(p.ok&&p.data);await cards(true);counts()}
 async function post(body){let j=null;
  const r=await D.request(typeof fetch==='function'?fetch:null,'/api/cre',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});j=r.data;
  if(j&&j.ok&&S.data){S.data.profile=j.profile;return true}
  S.boxMsg='Not saved: '+(j&&j.error?String(j.error).slice(0,60):'the desk did not answer');return false}
 const findDeal=id=>allDeals().find(d=>d.id===id)||S.rows.find(d=>d.id===id)||S.scatterRows.find(d=>d.id===id);
 const canReveal=()=>!!(typeof DeckShell!=='undefined'&&DeckShell.money);
 function openDeal(id){const d=findDeal(id);if(!d)return;S.open='deal:'+id;
  const sp=D.dealSheet(d,{data:S.data,myCap:S.person==='tanner'&&!S.viewer?S.cap:null,capFail:S.capFail&&S.person==='tanner'&&!S.viewer,revealed:S.revealed,canReveal:canReveal(),compare:S.compare,zipLink:typeof o.onZip==='function'});
  sp.id='deal';openSheet(sp)}
 function openBox(box){S.open='box:'+(box?box.id:'');S.armDel=false;openSheet(Object.assign({id:'box'},D.boxSheet(box,S)))}
 // ---- Filters sheet and market overview
 function openFilters(){S.open='filters';openSheet(Object.assign({id:'filters'},D.filterSheet(S,S.status==='ok'?S.total:null)))}
 const filterForm=()=>{const sh=sheetEl();return sh&&sh.open?sh.querySelector('form[data-cre-fsheet]'):null};
 function readFilterForm(){const f=filterForm();if(!f)return null;const vals={},tg={};
  f.querySelectorAll('input[data-cre-f]').forEach(i=>{vals[i.dataset.creF]=i.value});
  for(const k of ['types','counties'])tg[k]=[...f.querySelectorAll('[data-cre-ftog="'+k+'"][aria-pressed="true"]')].map(b=>b.dataset.v);
  return D.readFilters(vals,tg)}
 function showCount(){const sh=sheetEl(),b=sh&&sh.querySelector('[data-cre-fshow]');if(b)b.textContent=D.showLabel(S.status==='ok'?S.total:null)}
 function applyFilters(f){S.f=f||{};S.offset=0;return cards(true).then(showCount)}
 let ovm=null;
 function openOverview(){if(!S.data)return;if(!ovm||ovm.src!==S.data)ovm={src:S.data,m:D.overviewModel(allDeals(),S.data)};S.open='overview';openSheet(Object.assign({id:'overview'},D.overviewSheet(ovm.m,S.ov)))}
 // a header tap sorts that table again in place: same column flips the direction, a new one starts high to low (names A to Z)
 function sortOv(b){const w=b.closest('[data-cre-ovt]'),id=w&&w.dataset.creOvt,k=b.dataset.sort;if(!id||!ovm)return;const cur=S.ov[id]||{key:'n',dir:'descending'};
  S.ov[id]={key:k,dir:cur.key===k?(cur.dir==='ascending'?'descending':'ascending'):(k==='k'?'ascending':'descending')};
  const host=w.parentNode;w.outerHTML=D.ovTable(id,ovm.m,S.ov[id]);const n=host&&host.querySelector('[data-cre-ovt="'+id+'"] [data-sort="'+k+'"]');if(n)n.focus()}
 function readForm(){const sh=sheetEl(),f=sh&&sh.querySelector('form[data-cre-form]');if(!f)return null;const fd=new FormData(f),out={};
  for(const k of ['name','price_min','price_max','cap_min','dscr_min','dom_max','places'])out[k]=fd.get(k)||'';
  for(const k of ['types','counties'])out[k]=[...f.querySelectorAll('[data-cre-tog="'+k+'"][aria-pressed="true"]')].map(b=>b.dataset.v);return out}
 function saveCmp(){try{localStorage.setItem('cre:compare:'+S.person,JSON.stringify(S.compare))}catch(e){}}
 let armT=0;
 function onClick(e){const t=e.target&&e.target.closest?e.target:null;if(!t)return;let b;
  if((b=t.closest('[data-cre-open]'))){openDeal(b.dataset.creOpen);return}
  if((b=t.closest('[data-cre-zip]'))){closeSheet();o.onZip(b.dataset.creZip);return}
  if((b=t.closest('[data-cre-cmp]'))){const id=b.dataset.creCmp,i=S.compare.indexOf(id);if(i>=0)S.compare.splice(i,1);else{if(S.compare.length>=4)S.compare.shift();S.compare.push(id)}
   saveCmp();paint();if(S.open==='deal:'+id)openDeal(id);return}
  if((b=t.closest('[data-cre-compare]'))){const ds=S.compare.map(findDeal).filter(Boolean);if(ds.length>1){S.open='compare';openSheet(Object.assign({id:'compare'},D.compareSheet(ds,S.data)))}return}
  if((b=t.closest('[data-cre-reveal]'))){if(canReveal())DeckShell.money.reveal();return}
  if((b=t.closest('[data-cre-ovt] [data-sort]'))){sortOv(b);return}
  if((b=t.closest('[data-cre-ftog]'))){const on=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',on?'true':'false');b.classList.toggle('on',on);const f=readFilterForm();if(f)applyFilters(f);return}
  if((b=t.closest('[data-cre-fclear]'))){S.f={};S.sort='score';if(filterForm())openFilters();applyFilters({});return}
  if((b=t.closest('[data-cre-filters]'))){openFilters();return}
  if((b=t.closest('[data-cre-ov]'))){openOverview();return}
  if((b=t.closest('[data-cre-tog]'))){const on=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',on?'true':'false');b.classList.toggle('on',on);return}
  if((b=t.closest('[data-cre-save]'))){const form=readForm();if(!form)return;const box=boxes().find(x=>x.id===(S.open||'').slice(4));
   const body=D.boxPayload(S.person,form,box,boxes());if(body.error){S.boxMsg=body.error;openBox(box);S.boxMsg='';return}
   b.disabled=true;post(body).then(ok=>{if(ok){S.boxMsg='';S.boxId=body.box.id;S.view='all';closeSheet();cards(true).then(counts)}else{openBox(box);S.boxMsg=''}});return}
  if((b=t.closest('[data-cre-del]'))){const id=b.dataset.creDel;
   if(!S.armDel){S.armDel=true;b.classList.add('armed');b.textContent='Tap again to delete';clearTimeout(armT);armT=setTimeout(()=>{S.armDel=false;if(b.isConnected){b.classList.remove('armed');b.textContent='Delete'}},3000);return}
   S.armDel=false;post({person:S.person,op:'delete',id}).then(ok=>{if(ok){if(S.boxId===id)S.boxId=null;closeSheet();cards(true).then(counts)}else openBox(boxes().find(x=>x.id===id))});return}
  if((b=t.closest('[data-cre-seen]'))){const box=boxes().find(x=>x.id===b.dataset.creSeen);if(!box)return;
   const ids=allDeals().filter(d=>D.match(d,box.f)).map(d=>d.id).slice(0,6000);b.disabled=true;
   post({person:S.person,op:'seen',id:box.id,ids}).then(()=>openBox(boxes().find(x=>x.id===box.id)));return}
  if((b=t.closest('[data-sheet="data"]'))&&!shell&&(S.data||S.reason)){const sc=String(b.dataset.scope||''),dd=sc.indexOf('deal:')===0?findDeal(sc.slice(5)):null;
   openSheet({id:'data',title:'Data',sub:dd?String(dd.title||dd.addr||'Deal desk').slice(0,80):'Deal desk',body:D.dataSheetHtml(D.dataParts(S.data,S.status==='bad'?S.reason:'',dd))});return}
  if(!el.contains(t))return;
  if((b=t.closest('[data-cre-person]'))){S.person=b.dataset.crePerson;S.boxId=null;S.view='all';S.data=null;try{localStorage.setItem('cre:person',S.person)}catch(_){}load();return}
  if((b=t.closest('[data-cre-box]'))){S.boxId=b.dataset.creBox||null;S.view='all';cards(true);return}
  if((b=t.closest('[data-cre-view]'))){S.view=b.dataset.creView;S.boxId=null;cards(true);return}
  if((b=t.closest('[data-cre-newbox]'))){openBox(null);return}
  if((b=t.closest('[data-cre-edit]'))){openBox(boxes().find(x=>x.id===S.boxId)||null);return}
  if((b=t.closest('[data-cre-more]'))){S.offset=S.rows.length;cards(false);return}
  if((b=t.closest('[data-cre-capretry]'))){capRetry();return}
  if((b=t.closest('[data-cre-retry]'))){load();return}}
 el.addEventListener('click',onClick);if(o.scatterEl)o.scatterEl.addEventListener('click',onClick);if(o.toolsEl)o.toolsEl.addEventListener('click',onClick);
 // the Filters sheet applies as you type (a short pause first; the sort at once) and never submits. The count line's sort (on the
 // desk) is the same setting and applies at once; it rides this one listener so the desk element keeps a single click handler
 let fT=0;
 document.addEventListener('input',e=>{const t=e.target;
  if(t&&t.matches&&t.matches('select[data-cre-sort]')&&el.contains(t)){S.sort=t.value;S.offset=0;cards(true);return}
  const f=t&&t.closest&&t.closest('form[data-cre-fsheet]');if(!f)return;
  if(t.matches('select[data-cre-fsort]')){S.sort=t.value;S.offset=0;cards(true).then(showCount);return}
  clearTimeout(fT);fT=setTimeout(()=>{const v=readFilterForm();if(v)applyFilters(v)},200)});
 document.addEventListener('submit',e=>{if(e.target&&e.target.matches&&e.target.matches('form[data-cre-fsheet],form[data-cre-form]'))e.preventDefault()});
 if(!shell)document.addEventListener('click',e=>{const t=e.target;if(t&&t.closest&&t.closest('[data-sheet="data"]')&&!el.contains(t)&&!(dlg&&dlg.contains(t)))onClick(e)});
 if(shell)document.addEventListener('click',e=>{const sh=e.target&&e.target.closest&&e.target.closest('dialog.sheet[open]');if(sh&&String(S.open||'')&&sh.querySelector('[data-cre-open],[data-cre-save],[data-cre-cmp],[data-cre-zip],[data-cre-del],[data-cre-fsheet],[data-cre-ovt]'))onClick(e)});
 document.addEventListener('keydown',e=>{if(e.key!=='Enter')return;const r=e.target&&e.target.closest&&e.target.closest('tr[data-cre-open]');if(r){e.preventDefault();openDeal(r.dataset.creOpen)}});
 document.addEventListener('deck:money',e=>{S.revealed=!!(e.detail&&e.detail.revealed);paint();if(S.open&&S.open.indexOf('deal:')===0)openDeal(S.open.slice(5))});
 // /cre: no answer at all is Offline (inside the deck the shell's status says it); the desk reads again once the browser is back online
 function offlineOf(r){return !shell&&!!r&&r.status===0&&r.error==='no answer'}
 if(!shell&&typeof addEventListener==='function')addEventListener('online',()=>{if(S.offline)load()});
 el._cre={load,state:S,dataParts:scope=>{const sc=String(scope||'');return D.dataParts(S.data,S.status==='bad'?S.reason:'',sc.indexOf('deal:')===0?findDeal(sc.slice(5)):null)},
  set(p){const n=p||{};let ch=false;for(const k of ['type','scope','scopeKind','price_max'])if(k in n&&n[k]!==S[k]){S[k]=n[k];ch=true}
   if(!ch)return;if(!S.data){load();return}cards(true).then(counts)},
  hide(){S.revealed=false;closeSheet()}};
 load();return el._cre}
if(typeof window!=='undefined'){window.DeckCRE=DeckCRE;window.creMount=creMount}
if(typeof module!=='undefined')module.exports={DeckCRE};
