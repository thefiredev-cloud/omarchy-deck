// Real estate > Commercial (design v3, 2026-11-14; PageBlueprints section 4). Sections: the property-type switch, the market strip
// for type and scope, Best ZIPs for the type, the deal desk (static/cre.js) and cap rate by price. The scope bar is Residential's
// (window.DeckScope in pages/realestate.js). Data: /api/housing/national?part=summary|states|metros|metrics,
// /api/housing/rank?kind=commercial&type=, /api/housing/zip/<zip>, and the desk's /api/cre and /api/cre/deals. Sources, coverage
// and method go to the Data sheet only; the page shows values, one freshness mark and a status when something is missing.
// ==== DECK COMMERCIAL PURE BEGIN (no DOM, no fetch: tests/commercial_*.test.js load this block with DeckUI and DeckCRE) ====
const DeckCom=(()=>{
 const ui=()=>DeckUI,F=()=>DeckUI.fmt;
 const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const arr=x=>Array.isArray(x)?x:[];
 const num=v=>typeof v==='number'&&isFinite(v)?v:null;
 const TYPES=[['multifamily','Multifamily'],['retail','Retail'],['office','Office'],['industrial','Industrial']];
 const TYPE_KEYS=TYPES.map(t=>t[0]);
 const typeOk=t=>TYPE_KEYS.includes(t)?t:'retail';
 const typeLabel=t=>(TYPES.find(x=>x[0]===t)||TYPES[1])[1];
 const lower=t=>typeLabel(t).toLowerCase();
 // the sector-jobs column for each type
 const SECTOR={multifamily:['jobs_total','Jobs here'],retail:['jobs_retail','Retail jobs'],office:['jobs_office','Office jobs'],industrial:['jobs_industrial','Industrial jobs']};
 const SORTS=[['score','Type score'],['jobs','Jobs in this type'],['cap','Asking cap rate'],['jobs1y','Job change, all sectors'],['biz5y','Business growth, 5 yr'],['listings','Listings']];
 const sortCol=(k,t)=>({score:'score',jobs:SECTOR[t][0],cap:'asking_cap',jobs1y:'jobs_trend',biz5y:'biz_estabs_5y',listings:'com_listings'}[k]||'score');
 const sortLabel=k=>(SORTS.find(s=>s[0]===k)||SORTS[0])[1];
 const PAGE=12;
 // each type in plain words, and where its own numbers live. The rank route serves only the all-types columns; a type's own figures
 // (CMBS occupancy and cap, asking cap, cap spread, sector job change and businesses) come from the ZIP record, read for the rows on
 // screen. Where a type has no figure of its own an all-types one stands in and the cell says so (ALL below).
 const TC={
  multifamily:{blurb:'Apartment buildings. The score rewards rising rents, many renters, few empty homes, job growth and little new supply.',
   jobsWhat:'People who work in the ZIP, all sectors.',chg:'qcew_emp_yoy',chgWhat:'Change in all jobs in the county over the last year. Apartments follow overall job growth.',
   est:['bldg_multifamily_count'],estL:'Apartment buildings',estOne:'building',estMany:'buildings',estWhat:'Multifamily buildings counted in the ZIP.',
   occ:'cmbs_multifamily_occ',cap:'cmbs_multifamily_cap',ask:'crel_cap_multifamily',spr:'cap_spread_multifamily',word:'apartment'},
  retail:{blurb:'Stores, shopping centers and strip malls. The score rewards income, foot and car traffic, and a cap rate that pays above Treasuries.',
   jobsWhat:'People who work in retail in the ZIP.',chg:'qcew_retail_emp_yoy',chgWhat:'Change in retail jobs in the county over the last year.',
   est:['zbpd_estabs_retail','retail_estabs'],estL:'Retail businesses',estOne:'business',estMany:'businesses',estWhat:'Stores and other retail businesses in the ZIP.',
   occ:'cmbs_retail_occ',cap:'cmbs_retail_cap',ask:'crel_cap_retail',spr:'cap_spread_retail',word:'retail'},
  office:{blurb:'Office buildings. The score rewards office jobs, rising pay, high-wage workers and full buildings nearby.',
   jobsWhat:'People who work in office-using jobs in the ZIP.',chg:'qcew_office_emp_yoy',chgWhat:'Change in office-sector jobs in the county over the last year.',
   est:['zbpd_estabs_office','office_estabs'],estL:'Office businesses',estOne:'business',estMany:'businesses',estWhat:'Office-using businesses in the ZIP.',
   occ:'cmbs_office_occ',cap:'cmbs_office_cap',ask:'crel_cap_office',spr:'cap_spread_office',word:'office'},
  industrial:{blurb:'Warehouses, factories and flex space. The score rewards industrial jobs, truck traffic, cheap power and a cap rate that pays.',
   jobsWhat:'People who work in industrial jobs in the ZIP.',chg:'qcew_industrial_emp_yoy',chgWhat:'Change in industrial jobs in the county over the last year.',
   est:['zbpd_estabs_industrial','industrial_estabs'],estL:'Industrial businesses',estOne:'business',estMany:'businesses',estWhat:'Industrial and logistics businesses in the ZIP.',
   occ:'cmbs_industrial_occ',cap:'cmbs_industrial_cap',ask:'crel_cap_industrial',spr:'cap_spread_industrial',word:'industrial'}};
 const ALL={occ:['cmbs_occ_median','cmbs_occupancy'],cap:['cmbs_cap_rate'],ask:['com_median_cap','asking_cap'],spr:['cap_spread']};
 const typeBlurb=t=>TC[typeOk(t)].blurb;
 // the rank floor (decision 3, 2026-11-15): businesses, not residents. An office ZIP with no residents is a real business district, so
 // residents are the wrong floor; a ZIP with a handful of establishments (Upton NY, 5) is not a market. minBiz: null = the default 50,
 // 0 = cleared by the owner (any count), a number = typed. Remembered per device with the other filters.
 const MIN_BIZ_DEFAULT=50;
 function minBizOf(f){const v=isObj(f)?f.minBiz:null;if(v===0)return null;if(num(v)!=null&&v>0)return Math.round(v);return MIN_BIZ_DEFAULT}
 // under 100 residents: a business district (one tower in Manhattan, an office park); the place line says so after the city
 const bizDistrict=r=>isObj(r)&&num(r.population)!=null&&r.population<100;
 const placeOf=r=>{const p=[r.city,r.state].filter(Boolean).join(', ');return bizDistrict(r)?(p?p+' \u00b7 ':'')+'Business district':p};
 const cols=t=>['zip','city','state','population','biz_estabs',t+'_score',t+'_conf',SECTOR[t][0],'asking_cap','com_median_cap','cap_spread','cmbs_occupancy','jobs_trend','com_listings','daytime_pop','biz_estabs_5y','commercial_risk'].concat(t==='multifamily'?[]:[t+'_estabs']);
 // a city search finds every scored ZIP of that name: the business floor shapes the ranking, never what a search can find (review of #361)
 const searching=q=>typeof q==='string'&&!!q.trim();
 // GET /api/housing/rank for the type. A ZIP that cannot be scored is kept out of the list (its sheet says why): f=<type>_score:ge:min.
 function rankQuery(o){const t=typeOk(o&&o.type),f=isObj(o&&o.f)?o.f:{},q=['kind=commercial','type='+t];
  const sort=f.sort&&f.sort!=='score'?sortCol(f.sort,t):'score';q.push('sort='+sort);
  const fs=[t+'_score:ge:'+(num(f.minScore)!=null?Math.max(0,f.minScore):0)];
  const mb=searching(o.q)?null:minBizOf(f);if(mb!=null)fs.push('biz_estabs:ge:'+mb);
  if(num(f.minListings)!=null&&f.minListings>0)fs.push('com_listings:ge:'+Math.round(f.minListings));
  fs.forEach(x=>q.push('f='+encodeURIComponent(x)));
  if(num(f.minConf)!=null&&sort==='score')q.push('min_conf='+f.minConf);
  if(typeof o.q==='string'&&o.q.trim())q.push('q='+encodeURIComponent(o.q.trim().slice(0,60)));
  q.push('cols='+cols(t).join(','),'limit='+(o.limit||PAGE),'offset='+(o.offset||0));
  if(o.scope)q.push(String(o.scope).replace(/^&+|&+$/g,''));
  return 'housing/rank?'+q.join('&')}
 // the one freshness mark: the stalest part wins (a part the server calls stale, or older than twice its refresh); a stale part
 // is passed with age above 2 x refresh so DeckUI.fresh shows "Out of date"
 function freshMark(ages,missing){const xs=arr(ages).filter(a=>Array.isArray(a)&&num(a[0])!=null);
  const st=xs.find(a=>a[2]===true||a[0]>2*a[1]),pick=st||xs.slice().sort((a,b)=>b[0]-a[0])[0];
  if(!pick)return {age:null,refresh:86400,missing:num(missing)||0};
  return {age:pick[0],refresh:pick[2]===true&&pick[0]<=2*pick[1]?pick[0]/2.01:pick[1],missing:num(missing)||0}}
 // q: a search ignores the floor, so the floor is not counted as a set filter while one is on (ReviewSix)
 const filterCount=(f,q)=>{const o=isObj(f)?f:{};return [num(o.minScore)>0,!searching(q)&&minBizOf(o)!=null,num(o.minListings)>0,num(o.maxPrice)>0,o.sort&&o.sort!=='score'].filter(Boolean).length};
 // the list's head names what it shows: the ranking, or the matches of a search
 const zipsHead=(t,q)=>searching(q)?'Matches for \u201c'+q.trim().slice(0,60)+'\u201d':'Best ZIPs for '+lower(typeOk(t));
 // the Best ZIPs head's right side: the sort, and the business floor where it is set, so the floor is named where the ranking is read
 // on every class (P, L and T draw no filter chips; the Filters button only counts)
 const sortLine=(f,q)=>{const o=isObj(f)?f:{},mb=searching(q)?null:minBizOf(o);return 'Sort: '+sortLabel(o.sort)+(mb!=null?' \u00b7 '+mb+'+ businesses':'')};
 // a row a search found under the floor carries no rank and says why: "Not ranked: 5 businesses, under 50"
 function unranked(r,mb){if(mb==null||!isObj(r))return '';const b=num(r.biz_estabs);
  return b!=null&&b>=mb?'':'Not ranked: '+(b==null?'no business count':F().count(b)+(b===1?' business':' businesses')+', under '+mb)}
 // ---- market strip for type and scope. row = the scope's rollup (US, state or metro), us = the US rollup, desk = /api/cre (rates)
 function stripModel(o){const t=typeOk(o.type),row=isObj(o.row)?o.row:{},us=isObj(o.us)?o.us:{},desk=isObj(o.desk)?o.desk:{},r=isObj(desk.rates)?desk.rates:{},a=isObj(desk.assumptions)?desk.assumptions:{},m=isObj(o.metrics)?o.metrics:{};
  const f=F(),pick=(...vs)=>{for(const v of vs)if(num(v)!=null)return v;return null};
  const capT=num(row['crel_cap_'+t]),capAll=num(row.asking_cap),capV=capT!=null?capT:capAll;
  const conf=id=>{const x=isObj(m[id])?m[id]:null;return x&&num(x.median_conf)!=null?ui().conf(x.median_conf,{total:arr(x.members).length}):''};
  const loan=isObj(r.commercial)?num(r.commercial.value):null,est=isObj(r.commercial)&&r.commercial.kind==='assumption';
  const cre=isObj(a.cre)?a.cre:{},tsy=pick(us.fred_treasury_10y,isObj(r.treasury_10y)?r.treasury_10y.value:null);
  const dl=pick(row['cmbs_'+t+'_delinq']),dlAll=pick(row.cmbs_delinq_share),dlBank=pick(us.fred_cre_delinquency);
  return [
   {label:'Asking cap rate',value:f.rate(capV),sub:capV!=null&&capT==null?'All types':'',conf:capV!=null?conf('asking_cap'):''},
   // a strip figure holds at most eight characters at eight tiles a row (ui.css 4.8em): a price's per-SF unit rides as the small suffix.
   // The scope's asking price and rent per SF are one median over every property type (no per-type series): the tile says so
   {label:'Asking $/SF',value:f.money(pick(row.crel_sale_psf)),unit:'/SF',sub:num(row.crel_sale_psf)!=null?'All types':'',open:'ccomps'},
   {label:'Loan rate',value:f.rate(loan),sub:loan!=null&&est?'est. 10-yr plus '+(num(cre.spread)!=null?cre.spread:'spread'):''},
   {label:'10-yr Treasury',value:f.rate(tsy),open:'cnat'},
   {label:'Cap spread',value:capV!=null&&loan!=null?f.pt(capV-loan):null,sub:capV!=null&&loan!=null?'Cap minus loan rate':''},
   {label:'Delinquency',value:f.share(pick(dl,dlAll,dlBank)),sub:dl!=null?'CMBS, '+lower(t):dlAll!=null?'CMBS, all types':dlBank!=null?'Bank CRE loans, US':'',open:'cnat'},
   {label:'Price index 1-yr',value:f.chg(pick(us.fred_cre_price_yoy)),sub:num(us.fred_cre_price_yoy)!=null?'US':'',dx:true,open:'cnat'},
   {label:'Lease $/SF/yr',value:f.money(pick(row.crel_lease_psf_yr)),unit:'/SF/yr',sub:num(row.crel_lease_psf_yr)!=null?'All types':'',dx:true,open:'ccomps'}]}
 // a tile with no published series says so; it never shows 0 or a dash. A tile with `open` opens the sheet behind it: the national
 // series behind the national tiles, the comps by type behind the asking price and rent (Restore, report rows 57 and 58)
 function stripHtml(tiles,label,none){const U=ui(),word=none||'Not published';
  return U.strip(tiles.map(x=>{const k=/^[a-z]{1,20}$/.test(x.open||'')?x.open:'';
   if(x.value!=null)return U.tile({label:x.label,value:x.value,unit:x.unit||'',sub:x.sub||'',conf:x.conf||'',cls:x.dx?'dx':'',open:k});
   const tag=k?'button':'div';
   return '<'+tag+(k?' type="button" data-open="'+k+'"':'')+' class="tile np'+(x.dx?' dx':'')+'"><span class="h">'+esc(x.label)+'</span><span class="t">'+esc(word)+'</span></'+tag+'>'}),{label})}
 // ---- the national series behind the strip: /api/realestate market.commercial_indicators, every series the old page drew, each with
 // its period (quarterly series by quarter, monthly by month, the daily Treasury by day). A missing series says No data.
 const bnUsd=v=>num(v)==null?null:v>=1000?'$'+(v/1000).toFixed(2)+'T':'$'+Math.round(v).toLocaleString('en-US')+'B';
 const NATIONAL=[['price_growth','Commercial prices','q',v=>({value:F().chg(v),unit:'a year'})],['loan_balance_bn','Bank CRE loans','m',v=>({value:bnUsd(v)})],
  ['delinquency','CRE loan delinquency','q',v=>({value:F().rate(v)})],['chargeoff','CRE loan charge-offs','q',v=>({value:F().rate(v)})],
  ['rental_vacancy','Rental vacancy','q',v=>({value:F().share(v)})],['homeowner_vacancy','Homeowner vacancy','q',v=>({value:F().share(v)})],
  ['multifamily_starts','Starts, 5+ units','m',v=>({value:Math.round(v).toLocaleString('en-US')+'K',unit:'a year'})],['treasury_10y','10-yr Treasury','d',v=>({value:F().rate(v)})]];
 function periodOf(s,kind){const m=/^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(s||''));if(!m)return '';
  if(kind==='q')return 'Q'+(Math.floor((+m[2]-1)/3)+1)+' '+m[1];if(kind==='d'&&m[3])return F().date(m[0],{year:true});return F().month(m[1]+'-'+m[2])}
 const indicators=re=>isObj(re)&&isObj(re.market)&&isObj(re.market.commercial_indicators)?re.market.commercial_indicators:null;
 function nationalModel(re){const c=indicators(re);if(!c)return null;
  return NATIONAL.map(([k,label,kind,fmt])=>{const s=isObj(c[k])?c[k]:null,v=s?num(s.value):null,fv=v==null?null:fmt(v);
   return {key:k,label,value:fv?fv.value:null,unit:fv&&fv.unit||'',sub:v==null?'':periodOf(s.as_of,kind)}})}
 function nationalHtml(m){if(!m)return ui().empty({k:'bad',title:'National series are not reporting.'});return stripHtml(m,'National series','No data')}
 // ---- comps by type: asking sale prices ($/SF median, count, low, high) and asking rents ($/SF a year, the monthly median and counts)
 const pos=v=>num(v)!=null&&v>0?v:null;
 function compsModel(re){const c=indicators(re);if(!c)return null;const a=isObj(c.asking_sale)?c.asking_sale:null,l=isObj(c.lease_comps)?c.lease_comps:null;
  const typ=x=>String(x&&x.type||'').trim().slice(0,30);
  // a price of 0 or less is a bad listing, not a price: left out of the cell and named under the table, never printed as $0
  const bad=[],badLease=[],price=(x,k,word,to)=>{const v=num(x[k]);if(v!=null&&v<=0)(to||bad).push(typ(x)+' '+word);return pos(v)};
  const sale=a&&a.status==='ok'?arr(a.comps).filter(x=>isObj(x)&&typ(x)).map(x=>({type:typ(x),median:price(x,'median_psf','median'),n:pos(x.n),low:price(x,'low','low'),high:price(x,'high','high')})):[];
  let lease=[];if(l&&l.status==='ok'){const by=new Map();
   for(const x of arr(l.comps).filter(x=>isObj(x)&&typ(x)))by.set(typ(x),{type:typ(x),psf:price(x,'median_psf_yr','per SF',badLease),n:pos(x.n),mo:null,nmo:null});
   for(const x of arr(l.monthly).filter(x=>isObj(x)&&typ(x))){const r=by.get(typ(x))||{type:typ(x),psf:null,n:null};by.set(typ(x),Object.assign(r,{mo:price(x,'median_mo','a month',badLease),nmo:pos(x.n)}))}
   lease=[...by.values()]}
  return {sale,saleAsOf:a&&a.as_of,bad,lease,leaseAsOf:l&&l.as_of,badLease,priced:l?num(l.priced):null,listings:l?num(l.listings):null}}
 function compsHtml(m){const U=ui(),f=F();if(!m)return U.empty({k:'bad',title:'Comps are not reporting.'});
  const day=s=>/^\d{4}-\d{2}-\d{2}/.test(String(s||''))?f.date(String(s).slice(0,10),{year:true}):'';
  // a missing cell says No data in words: the table's own dot reads as a stray mark under a phone card's label
  const cell=fm=>(r,c)=>{if(c.key==='type')return '<span class="place"><b>'+esc(r.type)+'</b></span>';const s=r[c.key]==null?null:fm[c.key](r[c.key]);return s==null?f.na('sheet'):esc(s)};
  const usd=v=>f.money(v),cents=v=>f.money(v,{cents:true}),n=v=>f.count(v),note=xs=>{const t=xs.filter(Boolean).join(' ');return t?'<p class="note sm">'+esc(t)+'</p>':''},
   zero=xs=>arr(xs).length?'Left out as a $0 price: '+xs.join(', ')+'.':'';
  const sale=m.sale.length?U.table({label:'Asking sale prices by type',cols:[{key:'type',label:'Type',place:true},{key:'median',label:'Median $/SF',num:true},{key:'n',label:'Listings',num:true},{key:'low',label:'Low $/SF',num:true},{key:'high',label:'High $/SF',num:true}],
   rows:m.sale,key:r=>r.type,max:m.sale.length,cell:cell({median:usd,n,low:usd,high:usd})})+
   note([day(m.saleAsOf)?'Listings on '+day(m.saleAsOf)+'.':'',zero(m.bad)]):'<p class="note">No data</p>';
  const lease=m.lease.length?U.table({label:'Asking rents by type',cols:[{key:'type',label:'Type',place:true},{key:'psf',label:'Median $/SF/yr',num:true},{key:'n',label:'Listings',num:true},{key:'mo',label:'Median a month',num:true},{key:'nmo',label:'Listings, monthly',num:true}],
   rows:m.lease,key:r=>r.type,max:m.lease.length,cell:cell({psf:cents,n,mo:usd,nmo:n})})+
   note([m.priced!=null&&m.listings!=null?f.count(m.priced)+' of '+f.count(m.listings)+' lease listings show a price.':'','Asking rents, not signed leases.',day(m.leaseAsOf)?'Listings on '+day(m.leaseAsOf)+'.':'',zero(m.badLease)]):'<p class="note">No data</p>';
  return '<div class="com-comps"><section class="sh-sec"><h3>Asking sale prices</h3>'+sale+'</section><section class="sh-sec"><h3>Asking rents</h3>'+lease+'</section></div>'}
 // ---- Best ZIPs: cards on a phone, priority columns elsewhere. Each type has its own columns. The ones a type keeps always stay (a cell
 // with no value says No data; a phone card leaves it out); the optional ones go when no row has a value (critique 15). Every column
 // carries one line of help, shown under the list.
 const K={count:v=>F().count(v),money:v=>F().money(v),share:v=>F().share(v),rate:v=>F().rate(v),chg:v=>F().chg(v),psf:v=>F().psf(v),lease:v=>F().lease(v),pt:v=>F().pt(v),
  ratio:v=>num(v)==null?null:v.toFixed(2),per1k:v=>num(v)==null?null:v.toFixed(1)+' per 1,000 people',score:v=>num(v)==null?null:Math.round(v)+' of 100',
  sqft:v=>num(v)==null?null:F().count(v)+' SF',flag:v=>v==null?null:v?'Yes':'No',cents:v=>num(v)==null?null:v.toFixed(1)+'\u00a2/kWh',year:v=>num(v)==null?null:String(Math.round(v)),
  people:v=>num(v)==null?null:F().count(v)+' people',jobs:v=>num(v)==null?null:F().count(v)+(Math.round(v)===1?' job':' jobs'),cars:v=>num(v)==null?null:F().count(v)+' cars a day',
  trucks:v=>num(v)==null?null:F().count(v)+' trucks a day',apps:v=>num(v)==null?null:F().count(v)+(Math.round(v)===1?' application':' applications')};
 const many=(n,one,more)=>F().count(n)+' '+(Math.round(n)===1?one:more);
 function zipCols(t){t=typeOk(t);const c=TC[t],S=SECTOR[t],f=F();return [
  {key:'zip',label:'ZIP',place:true,help:'The ZIP code and its city. Tap a row for the full sheet.'},
  {key:t+'_score',label:'Score of 100',num:true,sort:true,help:'How well the ZIP fits '+c.word+' property, from 0 to 100. The mark beside it shows how complete the data is.'},
  {key:S[0],label:S[1],num:true,keep:true,fmt:v=>many(v,'job','jobs'),help:c.jobsWhat},
  {key:'job_chg',keys:[c.chg],label:'Job change, 1 yr',num:true,pri:2,keep:true,fmt:v=>f.chg(v),help:c.chgWhat},
  {key:'estabs',keys:c.est,label:c.estL,num:true,pri:2,keep:true,fmt:v=>many(v,c.estOne,c.estMany),help:c.estWhat},
  {key:'occ',keys:[c.occ],all:ALL.occ,label:'CMBS occupancy',num:true,pri:2,keep:true,fmt:v=>f.share(v),help:'Share of space filled in nearby '+c.word+' buildings with bond-financed (CMBS) loans. Fuller is safer.'},
  {key:'ask',keys:[c.ask],all:ALL.ask,label:'Asking cap rate',num:true,pri:2,fmt:v=>f.rate(v),help:'Middle cap rate on '+c.word+' listings for sale here. Yearly income over price.'},
  {key:'com_listings',label:'Listings',num:true,pri:2,keep:true,fmt:v=>many(v,'listing','listings'),help:'Commercial properties for sale in the ZIP, all types. Counted only where listings are tracked.'},
  {key:'cap',keys:[c.cap],all:ALL.cap,label:'CMBS cap rate',num:true,pri:3,keep:true,fmt:v=>f.rate(v),help:'Income over appraised value on nearby '+c.word+' buildings with CMBS loans.'},
  {key:'spr',keys:[c.spr],all:ALL.spr,label:'Cap spread',num:true,pri:3,fmt:v=>f.pt(v),help:'Asking cap rate minus the 10-year Treasury yield, in points. Higher pays more for the risk.'},
  {key:'daytime_pop',label:'Daytime people',num:true,pri:3,fmt:v=>K.people(v),help:'People in the ZIP on a workday, residents plus commuters in.'},
  {key:'biz_estabs_5y',label:'Business growth, 5 yr',num:true,pri:3,fmt:v=>f.chg(v),help:'Change in business count over five years.'}].concat(t==='multifamily'?[
  {key:'acs_units_5plus_share',label:'Homes in 5+ unit buildings',num:true,pri:4,fmt:v=>f.share(v),help:'Share of the ZIP\u2019s homes that sit in buildings of five or more units.'},
  {key:'bps_units_5plus_12m',label:'New 5+ unit homes, 12 mo',num:true,pri:4,fmt:v=>many(v,'home','homes'),help:'Homes in buildings of five or more units permitted in the last 12 months. More means more supply.'}]:[]).concat([
  {key:'commercial_risk',label:'Property risk',num:true,pri:4,fmt:v=>K.score(v),help:'Hazards and local risk that cost owners money, 0 to 100. Lower is better.'}])}
 // rows outside listing coverage carry no listings count: absent, never zero
 const rowVal=(r,k,dataset)=>k==='com_listings'&&!DeckCRE.covers(dataset,r.state)?null:r[k];
 // one cell's number: the column's own field first, then an all-types stand-in that says so
 function colVal(r,c,dataset){const ks=c.keys||[c.key],row=isObj(r)?r:{};
  for(const k of ks){const v=num(rowVal(row,k,dataset));if(v!=null)return {v,all:false}}
  for(const k of arr(c.all)){const v=num(row[k]);if(v!=null)return {v,all:true}}
  return {v:null,all:false}}
 function zipsModel(rows,o){const t=typeOk(o&&o.type),ds=o&&o.dataset,rs=arr(rows).filter(isObj);
  const all=zipCols(t),keep=all.filter(c=>c.place||c.sort||c.keep||!rs.length||rs.some(r=>colVal(r,c,ds).v!=null));
  return {cols:keep,rows:rs,dropped:all.filter(c=>!keep.includes(c)).map(c=>c.key)}}
 // no listing in any row: said once under the list, the columns still stand
 function listNote(rows,ds){if(arr(rows).some(r=>num(rowVal(r,'com_listings',ds))>0))return '';
  const cov=arr(rows).some(r=>DeckCRE.covers(ds,r.state));
  return '<p class="note com-nolist-z">'+(cov?'No listings in these ZIPs right now.':'Listings are not tracked in this state yet.')+' The scores and market columns still apply.</p>'}
 function zipsHtml(rows,o){const t=typeOk(o&&o.type),m=zipsModel(rows,o),U=ui(),f=F(),ds=o&&o.dataset;
  const named=o&&o.search&&searching(o.q)?'No ZIP named \u201c'+o.q.trim().slice(0,60)+'\u201d '+(num(o.filters)>0?'matches these filters.':'has a score for '+lower(t)+'.'):'';
  if(!m.rows.length)return U.empty({k:'idle',title:named||(num(o&&o.filters)>0?'No ZIPs match. Loosen a filter.':'Not enough data to score ZIPs for '+lower(t)+' yet.')});
  // a search's rows are matches, not the ranking: no numbers there (a match under the floor would leave gaps: 2, 3, 5)
  const cell=(r,c)=>{if(c.place){const nr=unranked(r,num(o&&o.minBiz)),n=num(r.rank)!=null&&!nr&&!(o&&o.search);
    return '<span class="place"><b>'+(n?esc(r.rank)+'. ':'')+esc(r.zip)+'</b><small>'+esc(placeOf(r))+'</small>'+(nr?'<small class="com-nr">'+esc(nr)+'</small>':'')+'</span>'}
   if(c.sort){const v=num(r[t+'_score']);return v==null?f.na():esc(String(Math.round(v)))+U.conf(r[t+'_conf'],{total:2})}
   const p=colVal(r,c,ds);return p.v==null?f.na():esc(c.fmt(p.v))+(p.all?' <small class="com-all">all types</small>':'')};
  // the server's order stands (the chosen sort, then Show more); the score column is marked only while the list is by score
  const byScore=!(o&&o.sort&&o.sort!=='score');
  return U.table({cols:m.cols,rows:m.rows,cell,key:r=>r.zip,open:'czip',presorted:true,sorted:byScore?{key:t+'_score',dir:'descending'}:null,label:'Best ZIPs for '+lower(t)})+listNote(m.rows,ds)}
 // one line of help per column, under the list: a term list a phone can read, since a hover title does not exist on touch
 function helpHtml(t,cols){const hs=arr(cols).filter(c=>c&&c.help);if(!hs.length)return '';
  return '<details class="com-help"><summary>What each column means</summary><dl>'+hs.map(c=>'<div><dt>'+esc(c.label)+'</dt><dd>'+esc(c.help)+'</dd></div>').join('')+'</dl></details>'}
 // market facts for a type in a scope (a state or metro rollup), for the moment a type has no listing there: whatever the rollup holds, never a zero
 function scopeFacts(t,row){const c=TC[typeOk(t)],r=isObj(row)?row:{},f=F(),out=[],add=(l,s)=>{if(s!=null)out.push([l,s])};
  const first=ks=>{for(const k of ks){const v=num(r[k]);if(v!=null)return v}return null};
  const e=first(c.est);add(c.estL,e==null?null:many(e,c.estOne,c.estMany));
  add('Job change, 1 yr',f.chg(first([c.chg])));add('CMBS occupancy',f.share(first([c.occ])));add('CMBS cap rate',f.rate(first([c.cap])));
  const askT=num(r['crel_cap_'+typeOk(t)]),ask=askT!=null?askT:num(r.asking_cap);add('Asking cap rate'+(askT==null&&ask!=null?' (all types)':''),f.rate(ask));add('Cap spread',f.pt(first([c.spr])));
  return out}
 // the deal desk (cre.js) holds no deals for this type and scope, with no filter, buy box or price cap in the way: say so with the type and the
 // place, and keep the market facts on screen. covered: the scope lies inside the listing coverage (DeckCRE.covers); outside it the desk's own
 // sentence stands ("Deals cover Southern California for now"). The desk cannot tell the two apart itself: it reads zero deals for both.
 function noListings(s,t,place,facts,covered){const d=isObj(s)?s:{};
  if(covered!==true||d.status!=='ok'||arr(d.rows).length||(num(d.total)||0)>0||DeckCRE.filterCount(d.f)>0||d.boxId||(d.view&&d.view!=='all')||num(d.price_max)!=null)return '';
  const fs=arr(facts);
  return '<div class="com-nolist" role="status"><p><b>No '+lower(t)+' listings in '+esc(place)+' right now.</b> '+(fs.length?'The market facts for '+lower(t)+' there still apply.':'The ZIP table above still shows '+lower(t)+' scores and market figures.')+'</p>'+
   (fs.length?'<dl class="dg">'+fs.map(([l,v])=>'<div><dt>'+esc(l)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>':'')+'</div>'}
 const SECTIONS=[
  ['biz','Business base',[['biz_estabs','Businesses','count'],['biz_estabs_5y','Businesses, 5-yr change','chg'],['biz_emp','Employees','count'],['biz_pay_per_emp','Pay per employee','money'],
   ['zbpd_small_share','Small-business share','share'],['nes_firms_per_1k','Solo businesses','per1k'],['bfs_apps','Business applications','count'],['bfs_apps_yoy','Applications, 1-yr','chg'],
   ['bds_estab_entry_rate','Openings','share'],['bds_estab_exit_rate','Closings','share']]],
  ['jobs','Jobs',[['lodes_jobs_high_wage_share','High-wage share','share'],['lodes_daytime_pop','Daytime population','count'],['lodes_daytime_ratio','Daytime people per resident','ratio'],
   ['qcew_emp_yoy','County jobs, 1-yr','chg'],['qcew_wage_yoy','County wage, 1-yr','chg'],['laus_unemployment','Unemployment','share'],['bea_gdp_5y','County GDP, 5-yr','chg']],
   [['lodes_jobs_office','Office'],['lodes_jobs_retail','Retail'],['lodes_jobs_industrial','Industrial'],['lodes_jobs_health','Health'],['lodes_jobs_hotel_food','Hotel and food']]],
  ['lend','Lending',[['sba504_loans_5y','SBA 504 loans, 5 years','count'],['sba7a_loans_5y','SBA 7(a) loans, 5 years','count'],['sba_dollars_per_estab','SBA lending per business','money'],
   ['fdiccre_pct_equity','Local bank CRE loans to equity','share']]],
  ['dep','Deposits',[['sod_deposits','Deposits','money'],['sod_deposits_yoy','Deposits, 1-yr','chg'],['sod_branches','Branches','count']]],
  ['stock','Building stock',[['bldg_commercial_count','Commercial buildings','count'],['bldg_industrial_count','Industrial buildings','count'],['com_sqft_per_job','Commercial SF per job','sqft'],
   ['ind_sqft_per_job','Industrial SF per industrial job','sqft'],['retail_sqft_per_cap','Commercial SF per person','sqft']],
   [['bldg_commercial_sqft','Commercial'],['bldg_industrial_sqft','Industrial']]],
  ['cmbs','CMBS',[['cmbs_props','Loans nearby','count'],['cmbs_occ_median','Occupancy','share'],['cmbs_noi_psf','NOI per SF','money'],['cmbs_implied_cap','Implied cap','rate'],
   ['cmbs_dscr_median','DSCR','ratio'],['cmbs_delinquent_share','Behind on payments','share'],['gsa_expiring_24m_share','Federal leases ending within 2 years','share']]],
  ['inc','Incentives',[['oz_share','Opportunity Zone share','share'],['qct_share','Qualified Census Tract share','share'],['dda_flag','Difficult Development Area','flag'],
   ['lihtc_units','Tax credit homes','count'],['fha_mf_units','HUD-insured apartments','count']]],
  ['risk','Risk',[['nfip_nonres_claims_10y','Non-residential flood claims, 10 years','count'],['nri_risk_score','Hazard rating','score'],['nfip_sfha_share','Policies in flood zones','share'],
   ['epa_facilities','EPA-regulated facilities','count'],['epa_brownfields','Brownfields','count'],['epa_tri_sites','Toxic release sites','count']]],
  ['traffic','Traffic and inputs',[['hpms_aadt_max','Busiest road, cars per day','count'],['hpms_truck_aadt_max','Busiest truck route, trucks per day','count'],['power_cost','Power price, business','cents']]],
  ['list','Listings here',[['com_listings','Listings','count'],['crel_sale_psf','Asking $/SF','psf'],['com_median_cap','Median asking cap','rate'],['crel_cap_multifamily','Asking cap, multifamily','rate'],
   ['crel_cap_retail','Asking cap, retail','rate'],['crel_cap_office','Asking cap, office','rate'],['crel_cap_industrial','Asking cap, industrial','rate'],['crel_lease_psf_yr','Asking lease','lease']]]];
 const labelOf=(k,o)=>{const m=isObj(o&&o.metrics)?o.metrics:{},fl=isObj(o&&o.fields)?o.fields:{};return isObj(m[k])&&m[k].label||isObj(fl[k])&&fl[k].label||k.replace(/_/g,' ')};
 // each score part in plain words: [label, the record field behind it, how it prints, why it moves the score]. A part with no entry here
 // keeps its catalog label and prints no value.
 const risk='Hazards and local risk cost owners money. Lower is better.',spread='A cap rate above the 10-year Treasury pays more for the risk.';
 const PARTS={
  retail:{income:['Household income','hh_income','money','Higher incomes mean shoppers have more to spend.'],daytime_pop:['Daytime population','daytime_pop','people','More people nearby on workdays means more foot traffic.'],
   business_growth:['Business growth, 5 yr','biz_estabs_5y','chg','More businesses than five years ago points to demand for space.'],traffic:['Traffic on the busiest road','hpms_aadt_max','cars','Retail lives on cars passing by.'],
   retail_sqft_per_cap:['Retail space per person','retail_sqft_per_cap','sqft','Less space per person means less risk of too many stores. Lower is better.'],cap_spread_retail:['Cap spread','cap_spread_retail','pt',spread],
   pop_trend:['Population growth','pop_trend','chg','More residents over time means more customers.'],business_formation:['New business starts','bfs_apps','apps','New applications show people betting on the area.'],
   commercial_risk:['Property risk','commercial_risk','score',risk],nes_firms_per_1k:['Solo businesses','nes_firms_per_1k','per1k','Many one-person firms show active small business.'],
   sb_lending:['Small-business lending','sba_dollars_per_estab','money','Bank loans per business show lenders back the area.']},
  office:{jobs_office:['Office jobs','lodes_jobs_office','jobs','More office workers nearby fill more office space.'],lodes_jobs_office_share:['Office share of jobs','lodes_jobs_office_share','share','A larger share means the area leans on office tenants.'],
   qcew_office_wage_yoy:['Office pay change, 1 yr','qcew_office_wage_yoy','chg','Rising pay means tenants can afford rent.'],lodes_jobs_high_wage_share:['High-wage jobs','lodes_jobs_high_wage_share','share','High-wage employers pay higher rents.'],
   lodes_daytime_ratio:['Daytime people per resident','lodes_daytime_ratio','ratio','Over 1.00 means more people work here than live here, as in an office district.'],
   cmbs_office_occ:['Office occupancy nearby','cmbs_office_occ','share','Fuller bond-financed office buildings nearby mean steadier rents.'],gsa_expiring_24m_share:['Federal leases ending in 2 years','gsa_expiring_24m_share','share','Federal leases that end soon can leave space empty. Lower is better.'],
   cap_spread_office:['Cap spread','cap_spread_office','pt',spread],com_sqft_per_job:['Commercial space per job','com_sqft_per_job','sqft','Less space per job means tighter supply. Lower is better.'],commercial_risk:['Property risk','commercial_risk','score',risk]},
  industrial:{jobs_industrial:['Industrial jobs','lodes_jobs_industrial','jobs','Factory and warehouse workers show demand for industrial space.'],qcew_industrial_emp_yoy:['Industrial job change, 1 yr','qcew_industrial_emp_yoy','chg','Growing industrial jobs in the county point to growing demand.'],
   hpms_truck_aadt_max:['Truck traffic on the busiest route','hpms_truck_aadt_max','trucks','Trucks show that freight moves through here.'],ind_sqft_per_job:['Industrial space per industrial job','ind_sqft_per_job','sqft','Less space per worker means tighter supply. Lower is better.'],
   power_cost:['Business power price','power_cost','cents','Power is a big cost for plants and cold storage. Lower is better.'],cmbs_industrial_occ:['Industrial occupancy nearby','cmbs_industrial_occ','share','Fuller bond-financed industrial buildings nearby mean steadier rents.'],
   cap_spread_industrial:['Cap spread','cap_spread_industrial','pt',spread],flood_risk:['Flood risk','flood_risk','score','Floods and insurance cost owners money. Lower is better.'],business_formation:['New business starts','bfs_apps','apps','New applications show people betting on the area.']},
  multifamily:{rent_trend_1y:['Rent change, 1 yr','rent_trend_1y','chg','Rising rents lift the income from apartments.'],renter_share:['Renter share of homes','renter_share','share','More renters means more demand for apartments.'],
   vacancy_rate:['Vacant homes','vacancy_rate','share','Fewer empty homes means tenants are easy to find. Lower is better.'],jobs_trend:['Job change, 1 yr','jobs_trend','chg','Job growth brings renters.'],
   migration:['People moving in','migration','score','More people arriving than leaving means more renters.'],new_supply:['New homes permitted','new_supply','per1k','Many new buildings compete for tenants. Lower is better.'],
   cmbs_multifamily_occ:['Apartment occupancy nearby','cmbs_multifamily_occ','share','Fuller bond-financed apartments nearby mean steadier rents.'],cap_spread_multifamily:['Cap spread','cap_spread_multifamily','pt',spread],
   gross_yield:['Gross yield','gross_yield','share','Yearly rent as a share of price. Higher pays more.'],acs_rent_burden_50_share:['Renters paying half their income on rent','acs_rent_burden_50_share','share','Stretched renters are harder to raise rents on. Lower is better.'],
   affordable_units_per_1k:['Subsidized homes','affordable_units_per_1k','per1k','Many subsidized homes compete with market rents. Lower is better.'],income:['Household income','income','money','Higher incomes support higher rents.']}};
 const band=v=>v>=75?['Strong','strong']:v>=50?['Good','good']:v>=25?['Fair','fair']:['Weak','weak'];
 // the score's parts as plain reasons: heaviest first, each with its band, the ZIP's own figure and one line on why it counts
 function reasons(z,t,o){const sp=isObj(z.score_parts)&&isObj(z.score_parts[t])?z.score_parts[t]:{},defs=PARTS[t]||{},sc=isObj(o&&o.scores)?o.scores[t+'_score']:null,w={};
  if(isObj(sc))arr(sc.inputs).forEach(i=>{if(isObj(i)&&num(i.weight)!=null)w[i.key]=Math.round(i.weight*100)});
  return Object.keys(sp).filter(k=>num(sp[k])!=null).map(k=>{const d=defs[k],s=sp[k],b=band(s),fv=d?z[d[1]]:null,vt=d&&K[d[2]]&&num(fv)!=null?K[d[2]](fv):null;
   return {key:k,label:d?d[0]:labelOf(k,o),score:s,band:b[0],bandKey:b[1],value:vt,why:d?d[3]:'',weight:w[k]==null?null:w[k]}}).sort((a,b)=>(b.weight||0)-(a.weight||0)||b.score-a.score)}
 function zipModel(rec,o){const z=isObj(rec)?rec:{},t=typeOk(o&&o.type),ds=o&&o.dataset;
  const score=num(z[t+'_score']),c=num(z[t+'_conf']),rs=reasons(z,t,o);
  const secs=[];
  // this type's own facts first: the same columns as the list, so the sheet and the row agree
  {const kv=zipCols(t).filter(x=>!x.place&&!x.sort).map(x=>{const p=colVal(z,x,ds);return {k:x.key,label:x.label,text:p.v==null?null:x.fmt(p.v)+(p.all?' (all types)':'')}}),present=kv.filter(x=>x.text!=null);
   if(present.length)secs.push({id:'type',title:typeLabel(t)+' in this ZIP',kv:present,bars:[],line:null,missing:kv.filter(x=>x.text==null).map(x=>x.label.charAt(0).toLowerCase()+x.label.slice(1))})}
  for(const [id,title,kvs,bars] of SECTIONS){if(id==='list'&&!DeckCRE.covers(ds,z.state))continue;
   const kv=kvs.map(([k,l,fk])=>({k,label:l,text:K[fk](z[k])})),present=kv.filter(x=>x.text!=null);
   const br=arr(bars).map(([k,l])=>({label:l,value:num(z[k]),key:k})).filter(b=>b.value!=null&&b.value>0);
   let line=null;if(id==='dep'&&isObj(z.hist)&&arr(z.hist.sod_deposits).length>=3)line=arr(z.hist.sod_deposits);
   if(!present.length&&!br.length&&!line)continue;
   secs.push({id,title,kv:present,bars:br,line,missing:kv.filter(x=>x.text==null).map(x=>x.label.charAt(0).toLowerCase()+x.label.slice(1))})}
  const hi=rs.length>1?rs.reduce((a,b)=>b.score>a.score?b:a):null,lo=rs.length>1?rs.reduce((a,b)=>b.score<a.score?b:a):null;
  return {zip:String(z.zip||''),place:placeOf(z),type:t,score,conf:c,reasons:rs,
   summary:hi&&lo&&hi!==lo?'Strongest: '+hi.label+'. Weakest: '+lo.label+'.':'',sections:secs,
   unscored:score==null?'Not enough data to score this ZIP for '+lower(t)+'.':''}}
 function zipSheet(m){const U=ui(),f=F();let h='';
  h+='<div class="sh-head">'+(m.score!=null?U.strip([U.tile({label:typeLabel(m.type)+' score',value:String(Math.round(m.score)),unit:'of 100',conf:U.conf(m.conf,{total:2})})]):'<p class="note">'+esc(m.unscored)+'</p>')+'</div>';
  if(arr(m.reasons).length)h+='<section class="sh-sec com-why-s"><h3>Why this score</h3>'+(m.summary?'<p class="note">'+esc(m.summary)+'</p>':'')+'<ul class="com-why">'+m.reasons.map(r=>
   '<li><div class="com-why-h"><b>'+esc(r.label)+'</b><span class="com-band" data-band="'+r.bandKey+'">'+r.band+'</span><span class="com-wn">'+Math.round(r.score)+' of 100</span></div>'+
   '<p>'+esc([r.value?r.value+'.':'',r.why,r.weight!=null?'Counts '+r.weight+'% of the score.':''].filter(Boolean).join(' '))+'</p></li>').join('')+'</ul></section>';
  for(const s of m.sections){h+='<section class="sh-sec"><h3>'+esc(s.title)+'</h3>';
   if(s.bars.length)h+=U.bars(s.bars.map(b=>({label:b.label,value:b.value,text:s.id==='stock'?f.count(b.value)+' SF':f.count(b.value),key:b.key})),{});
   if(s.line)h+=U.line({series:s.line,yfmt:v=>f.money(v),xlab:[f.month(String(s.line[0][0]).slice(0,7))||String(s.line[0][0]),f.month(String(s.line[s.line.length-1][0]).slice(0,7))||String(s.line[s.line.length-1][0])],label:'Deposits over time'});
   if(s.kv.length)h+='<dl class="kv">'+s.kv.map(x=>'<div><dt>'+esc(x.label)+'</dt><dd>'+esc(x.text)+'</dd></div>').join('')+'</dl>';
   h+=U.missing(s.missing)+'</section>'}
  return h}
 // ---- the page's Data sheet: commercial sources with status and coverage, the blends on screen, score weights and method
 const STATE_WORD={ok:'ok',stale:'stale',unavailable:'never',needs_key:'needs_key',invalid:'blocked'};
 function dataModel(o){const srcs=arr(o&&o.sources).filter(s=>isObj(s)&&(s.side==='commercial'||s.group==='commercial'));
  const f=F(),t=typeOk(o&&o.type),sc=isObj(o&&o.scores)?o.scores[t+'_score']:null,desk=isObj(o&&o.deskParts)?o.deskParts:{sources:[],method:[],setup:[]};
  const sources=srcs.map(s=>({name:String(s.name||s.id),gives:num(s.coverage)!=null?f.count(s.coverage)+' ZIPs':(s.level?String(s.level):''),asOf:/^\d{4}-\d{2}$/.test(String(s.as_of||''))?f.month(s.as_of):/^\d{4}-\d{2}-\d{2}/.test(String(s.as_of||''))?f.date(String(s.as_of).slice(0,10)):String(s.as_of||''),state:STATE_WORD[s.status]||'stale'})).concat(arr(desk.sources));
  const method=[];
  if(isObj(sc)&&arr(sc.inputs).length)arr(sc.inputs).forEach(i=>method.push([typeLabel(t)+' score: '+labelOf(i.key,o),Math.round((num(i.weight)||0)*100)+'%'+(i.direction==='lower'?', lower is better':'')]));
  method.push(['Cap spread','Asking cap minus the loan rate']);
  const mb=minBizOf(isObj(o)?o.f:null);
  method.push(['Best ZIPs',(mb!=null?'ZIPs with at least '+mb+' business establishments (Census ZIP Business Patterns), ':'Every scored ZIP, ')+'by the type score. A ZIP with under 100 residents reads Business district.']);
  // the national series and the comps by type (/api/realestate) once a sheet behind the strip has read them
  const ci=indicators(o&&o.re);if(ci){const day=s=>/^\d{4}-\d{2}-\d{2}/.test(String(s||''))?f.date(String(s).slice(0,10),{year:true}):'';
   const have=NATIONAL.filter(n=>isObj(ci[n[0]])&&num(ci[n[0]].value)!=null),newest=have.map(n=>String(ci[n[0]].as_of||'')).sort().pop();
   sources.push({name:'Federal Reserve Economic Data',gives:'National series: '+have.length+' of '+NATIONAL.length,asOf:day(newest),state:have.length?'ok':'never'});
   const a=isObj(ci.asking_sale)?ci.asking_sale:null,l=isObj(ci.lease_comps)?ci.lease_comps:null;
   if(a)sources.push({name:'For-sale listings in the real estate feed',gives:'Asking sale prices by type',asOf:day(a.as_of),state:a.status==='ok'?'ok':'never'});
   if(l)sources.push({name:String(l.source||'Lease listings').slice(0,90),gives:'Asking rents by type',asOf:day(l.as_of),state:l.status==='ok'?'ok':'never'});
   for(const [k,label] of [['vacancy','Office and industrial vacancy'],['cap_rate','Cap rate series']])if(isObj(ci[k])&&ci[k].status==='unavailable')method.push([label,String(ci[k].reason||'No free public series').slice(0,240)])}
  const setup=srcs.filter(s=>s.status==='needs_key'||s.status==='invalid'||s.status==='unavailable').map(s=>({name:String(s.name||s.id),line:s.status==='needs_key'?'Needs a key'+(s.key_env?' in '+s.key_env:''):String(s.reason||'Not reporting').slice(0,120),state:STATE_WORD[s.status]}));
  const blends=[];const z=isObj(o&&o.zip)?o.zip:null;
  if(z&&isObj(z.m))for(const id of ['asking_cap','jobs_total','jobs_'+t,'daytime_pop','cmbs_occupancy','incentives','commercial_risk'])if(isObj(z.m[id])&&num(z.m[id].v)!=null){const b=z.m[id];
   blends.push({label:labelOf(id,o)+', '+z.zip,value:String(b.v),score:b.c,agree:(num(b.n)||0)+' parts',parts:arr(b.p).map(p=>({name:labelOf(p[0],o),value:'',weight:Math.round((num(p[1])||0)*100)+'%'}))})}
  return {sources,blends,method:method.concat(arr(desk.method)),setup:setup.concat(arr(desk.setup))}}
 // ---- one page-level state (L21): the market strip, Best ZIPs and the deal desk read the same real estate data, so when it is down the
 // page says so once, under the type switch, with one Try again, and the failed sections step aside (three panels of the same failure
 // filled a phone screen before any content, L18). One part down names that part; two or three name the data. o: {sumDone (the
 // national rollups answered or failed at least once), summary, rates (the desk's rates, which also feed the strip), rank (the last rank
 // read), desk (the desk's state)}. A part still loading is not down.
 const DOWN={market:'Market data is not reporting.',zips:'Best ZIPs are not reporting.',desk:'Deal desk is not reporting.'};
 function downParts(o){o=isObj(o)?o:{};const out=[],d=isObj(o.desk)?o.desk:null,dd=d&&isObj(d.data)?d.data:null;
  if(o.sumDone&&!o.summary&&!o.rates)out.push('market');
  if(isObj(o.rank)&&o.rank.ok===false)out.push('zips');
  if(d&&(d.status==='bad'||!!(dd&&(dd.error||dd.status==='not_reporting'))))out.push('desk');
  return out}
 function downHtml(parts){const p=arr(parts).filter(k=>DOWN[k]);if(!p.length)return '';
  return ui().empty({k:'bad',title:p.length===1?DOWN[p[0]]:'Real estate data is not reporting.',line:'Try again in a moment.',retry:'commercial'})}
 return {freshMark,TYPES,TYPE_KEYS,SECTOR,SORTS,PAGE,MIN_BIZ_DEFAULT,minBizOf,bizDistrict,placeOf,searching,unranked,zipsHead,typeOk,typeLabel,typeBlurb,sortCol,sortLabel,sortLine,cols,rankQuery,filterCount,stripModel,stripHtml,NATIONAL,periodOf,nationalModel,nationalHtml,compsModel,compsHtml,
  zipCols,colVal,zipsModel,zipsHtml,helpHtml,scopeFacts,noListings,reasons,PARTS,TC,SECTIONS,zipModel,zipSheet,dataModel,DOWN,downParts,downHtml}})();
// ==== DECK COMMERCIAL PURE END ====

// ---- the live page: registered under realestate/commercial. State remembered per device: type and filters.
(()=>{if(typeof window==='undefined'||typeof DeckPages==='undefined'||typeof DeckCRE==='undefined')return;
 const C=DeckCom,K='re:commercial';
 const load=()=>{try{const v=JSON.parse(localStorage.getItem(K)||'{}');return {type:C.typeOk(v.type),f:v.f&&typeof v.f==='object'?v.f:{sort:'score'}}}catch(e){return {type:'retail',f:{sort:'score'}}}};
 const S=Object.assign(load(),{ctx:null,built:false,rank:null,rankRows:[],offset:0,q:'',summary:null,sumDone:false,states:null,metros:null,metrics:null,sources:null,desk:null,deskApi:null,zip:null,tok:0,off:null,last:0,re:null,reP:null,zr:new Map(),down:''});
 const save=()=>{try{localStorage.setItem(K,JSON.stringify({type:S.type,f:S.f}))}catch(e){}};
 const scope=()=>window.DeckScope?window.DeckScope.get():{kind:'us'};
 const scopeStr=()=>window.DeckScope?window.DeckScope.query(scope()):'';
 const scopeLabel=()=>window.DeckScope?window.DeckScope.label(scope()):'United States';
 const $=s=>S.ctx&&S.ctx.el.querySelector(s);
 const typeSeg=()=>'<div class="seg keep com-type" role="group" aria-label="Property type">'+C.TYPES.map(([k,l])=>'<button type="button" data-com-type="'+k+'" aria-pressed="'+(k===S.type)+'"'+(k===S.type?' class="on"':'')+'>'+l+'</button>').join('')+'</div>';
 const num=v=>{const n=Number(String(v==null?'':v).replace(/[$,\s]/g,''));return String(v==null?'':v).trim()!==''&&isFinite(n)&&n>=0?n:null};
 function fields(){const f=S.f,inp=(k,l,v)=>'<label class="field">'+l+'<input data-com-f="'+k+'" inputmode="numeric" value="'+(v==null?'':DeckCRE.esc(v))+'" placeholder="Any" autocomplete="off"></label>';
  return (window.DeckScope&&window.DeckScope.field?window.DeckScope.field(scope()):'')+inp('minScore','Lowest score',f.minScore)+inp('minBiz','Fewest businesses',C.minBizOf(f))+inp('minListings','Fewest listings',f.minListings)+inp('maxPrice','Highest price per deal, $',f.maxPrice)+
   '<label class="field">Sort by<select data-com-f="sort">'+C.SORTS.map(([k,l])=>'<option value="'+k+'"'+((f.sort||'score')===k?' selected':'')+'>'+l+'</option>').join('')+'</select></label>'}
 function chipList(){const f=S.f,c=[],mb=C.minBizOf(f);if(f.minScore>0)c.push({key:'minScore',label:'Score '+f.minScore+'+'});if(mb!=null)c.push({key:'minBiz',label:mb+'+ businesses'});if(f.minListings>0)c.push({key:'minListings',label:f.minListings+'+ listings'});
  if(f.maxPrice>0)c.push({key:'maxPrice',label:'Up to '+DeckUI.fmt.money(f.maxPrice)});if(f.sort&&f.sort!=='score')c.push({key:'sort',label:'Sort: '+C.sortLabel(f.sort)});return c}
 function fbar(){return DeckUI.filters({id:'com-fb',lead:typeSeg(),chips:chipList(),count:C.filterCount(S.f,S.q),fields:fields(),show:'Show ZIPs'})}
 // a city search on, or off again: the Filters count and the list follow it (an emptied field ends the search, ReviewSix)
 function setQ(q){S.q=q;paintFbar();rank(true)}
 // F8: the desk on its own page (/cre), for the desk shown here; off the TV board (css/commercial.css), /cre has no TV view
 function creHref(){const p=S.deskApi&&S.deskApi.state?S.deskApi.state.person:null;return /^(jordan|riley)$/.test(p||'')?'/cre?person='+p:'/cre'}
 function build(ctx){const el=ctx.el;
  // the TV board (fits one screen): the type switch, the strip, Best ZIPs and the desk; the scatter is off the TV board
  el.innerHTML='<div class="com board">'+'<div class="com-fbar">'+fbar()+'</div><div class="com-down"></div>'+
   '<section class="sect com-market"><h2 class="secttl"><span>Market</span><span class="act com-cap"></span></h2><div class="com-strip"></div></section>'+
   '<div class="com-main"><section class="sect com-zips"><h2 class="secttl"><span class="com-zt"></span><span class="act com-sort"></span></h2><p class="com-intro"></p><div class="com-zips-b"></div><div class="com-zips-more more-row"></div><div class="com-zips-help"></div></section>'+
   '<section class="sect com-desk"><h2 class="secttl"><span>Deal desk</span><a class="btn com-cre" href="'+creHref()+'">Open deal desk</a></h2><div class="com-desk-note"></div><div class="com-desk-b"></div></section>'+
   '<section class="sect com-sc"><h2 class="secttl"><span>Cap rate by price</span></h2><div class="com-sc-b"></div></section></div></div>';
  el.addEventListener('click',onClick);el.addEventListener('change',onChange);el.addEventListener('keydown',e=>{if(e.key!=='Enter')return;const r=e.target.closest&&e.target.closest('tr[data-open="czip"]');if(r){e.preventDefault();openZip(r.dataset.key,r)}});
  // F13: typed text in the "ZIP or city" field (emptying it clears the mark)
  el.addEventListener('input',e=>{const t=e.target;if(t&&t.matches&&t.matches('.com-fbar input[data-scope-q]'))typed=t.value!==''});
  // emptying the field (typing it away or its clear button) brings the ranked list back; the header's field on T and D counts too
  document.addEventListener('input',e=>{const t=e.target,c=S.ctx;if(!S.q||!c||!t||!t.matches||!t.matches('input[data-scope-q]')||t.value.trim())return;
   if((c.el&&c.el.contains(t))||(c.head&&c.head.contains(t)))setQ('')});
  S.built=true}
 // F13: the filter row holds the "ZIP or city" field. While the reader is in it, or it holds text they typed, a repaint (the phone coming
 // back on screen, the refresh, a type switch) redraws everything around the field and keeps the field itself, so focus, text, caret and
 // the phone keyboard stay. Typed text is a flag set by the input event, never a value comparison (red team, row 19). force: a new scope
 // clears the search on purpose.
 let typed=false;
 function paintFbar(force){const w=$('.com-fbar');if(!w)return;const open=w.querySelector('dialog[open]');if(open)return;
  if(force)typed=false;
  const a=document.activeElement,keep=w.querySelector('.fbar-top>.re-search'),busy=!!keep&&(typed||!!(a&&keep.contains(a)));
  if(busy){const t=document.createElement('template');t.innerHTML=fbar();const top=w.querySelector('.fbar-top'),nt=t.content.querySelector('.fbar-top');
   [...top.children].forEach(c=>{if(c!==keep)c.remove()});top.append(...nt.children);
   const d=w.querySelector('dialog.fbar-panel'),nd=t.content.querySelector('dialog.fbar-panel');if(d&&nd)d.replaceWith(nd);return}
  w.innerHTML=fbar();
  if(window.DeckScope&&window.DeckScope.searchBox){const top=w.querySelector('.fbar-top');if(top&&!top.querySelector('.re-search'))top.insertAdjacentHTML('afterbegin',window.DeckScope.searchBox())}}
 function scopeRow(){const sc=scope(),sum=S.summary&&S.summary.us;
  if(sc.kind==='us')return sum;
  if(sc.kind==='metro'){const m=(S.metros||[]).find(r=>r&&(r.name===sc.metro||r.metro===sc.metro));return m||null}
  const st=sc.kind==='mine'?'CA':sc.state;return (S.states||[]).find(r=>r&&r.state===st)||null}
 // the desk's answer when it carries rates (the strip's loan rate and Treasury); a desk that failed feeds nothing
 function deskRates(){const d=S.desk&&S.desk.state&&S.desk.state.data;return d&&typeof d==='object'&&!d.error&&d.status!=='not_reporting'?d:null}
 // the one page-level state (C.downParts): drawn under the type switch, and every section whose part is down steps aside. Redrawn only
 // when the set of failed parts changes, so a focused Try again is never replaced under the reader
 function paintDown(){const el=$('.com-down');if(!el)return;
  const parts=C.downParts({sumDone:S.sumDone,summary:S.summary,rates:deskRates(),rank:S.rank,desk:S.desk&&S.desk.state}),key=parts.join();
  if(key!==S.down){S.down=key;el.innerHTML=C.downHtml(parts)}
  const hide=(sel,on)=>{const s=$(sel);if(s)s.hidden=on};
  hide('.com-market',parts.includes('market'));hide('.com-zips',parts.includes('zips'));hide('.com-desk',parts.includes('desk'));hide('.com-sc',parts.includes('desk'))}
 function paintStrip(){const el=$('.com-strip');if(!el)return;$('.com-cap').textContent=scopeLabel();
  const rates=deskRates();
  if(!S.summary&&!rates){el.innerHTML='';paintDown();return}
  el.innerHTML=C.stripHtml(C.stripModel({type:S.type,row:scopeRow()||{},us:S.summary&&S.summary.us,desk:rates,metrics:S.metrics&&S.metrics.metrics}),'Market for '+C.typeLabel(S.type).toLowerCase()+', '+scopeLabel());paintDown()}
 function paintZips(){const b=$('.com-zips-b');if(!b)return;$('.com-zt').textContent=C.zipsHead(S.type,S.q);$('.com-sort').textContent=C.sortLine(S.f,S.q);$('.com-intro').textContent=C.typeBlurb(S.type);
  const r=S.rank,more=$('.com-zips-more'),help=$('.com-zips-help');more.innerHTML='';help.innerHTML='';paintDown();
  if(!r){b.innerHTML=DeckUI.skeleton?DeckUI.skeleton('row',6):'';return}
  if(!r.ok){b.innerHTML='';return}
  const ds=S.desk&&S.desk.state?S.desk.state.dataset:null,rows=viewRows();
  // a search ignores the floor, so its rows under it say why they carry no rank
  b.innerHTML=C.zipsHtml(rows,{type:S.type,dataset:ds,sort:S.f.sort,filters:C.filterCount(S.f,S.q),search:C.searching(S.q),q:S.q,minBiz:C.searching(S.q)?C.minBizOf(S.f):null});
  if(rows.length)help.innerHTML=C.helpHtml(S.type,C.zipsModel(rows,{type:S.type,dataset:ds}).cols);
  const total=r.data&&typeof r.data.total==='number'?r.data.total:S.rankRows.length;
  if(total>S.rankRows.length)more.innerHTML='<button type="button" class="btn" data-com-more="1">Show '+Math.min(C.PAGE,total-S.rankRows.length)+' more</button>'}
 // the rank route serves the all-types columns; each type's own figures live in the ZIP record. The twelve rows on screen read theirs once
 // (kept until the next refresh) and are merged under the rank row, so a rank value always wins
 const viewRows=()=>S.rankRows.map(r=>{const z=S.zr.get(r&&r.zip);if(!z)return r;const m=Object.assign({},z);for(const k in r)if(r[k]!=null||!(k in m))m[k]=r[k];return m});
 async function enrich(rows){const need=rows.filter(r=>r&&/^\d{5}$/.test(String(r.zip))&&!S.zr.has(r.zip));
  await Promise.all(need.map(r=>DeckPages.get('housing/zip/'+r.zip,{timeout:60000}).then(x=>{S.zr.set(r.zip,x&&x.ok&&x.data&&!x.data.error?x.data:null)},()=>{S.zr.set(r.zip,null)})))}
 async function rank(reset){const t=++S.tok;if(reset){S.offset=0;S.rankRows=[];S.rank=null;paintZips()}
  const r=await DeckPages.get(C.rankQuery({type:S.type,f:S.f,scope:scopeStr(),q:S.q,offset:S.offset}),{timeout:60000});if(t!==S.tok)return;
  const fresh=r.ok&&r.data&&Array.isArray(r.data.rows)?r.data.rows:null;
  if(fresh){await enrich(fresh);if(t!==S.tok)return}
  S.rank=r;if(fresh)S.rankRows=S.offset?S.rankRows.concat(fresh):fresh;paintZips();mark();tv()}
 async function rollups(){const sc=scope(),jobs=[];
  if(!S.summary)jobs.push(DeckPages.get('housing/national?part=summary',{timeout:60000}).then(r=>{S.summary=r.ok?r.data:null}));
  if(sc.kind!=='us'&&sc.kind!=='metro'&&!S.states)jobs.push(DeckPages.get('housing/national?part=states',{timeout:60000}).then(r=>{S.states=r.ok&&r.data?r.data.states:null}));
  if(sc.kind==='metro'&&!S.metros)jobs.push(DeckPages.get('housing/national?part=metros',{timeout:60000}).then(r=>{S.metros=r.ok&&r.data?r.data.metros:null}));
  if(!S.metrics)jobs.push(DeckPages.get('housing/national?part=metrics',{timeout:60000}).then(r=>{S.metrics=r.ok?r.data:null}));
  await Promise.all(jobs);S.sumDone=true;paintStrip();paintNote();mark()}
 function mark(){if(!S.ctx||!DeckPages.mark)return;const ages=[],miss=[];
  if(S.rank&&!S.rank.ok)miss.push('rank');
  // the national data says its own age and refresh (part=summary); a missing summary is a part not reporting
  const sm=S.summary;if(sm&&typeof sm.age==='number')ages.push([sm.age,typeof sm.refresh==='number'&&sm.refresh>0?sm.refresh:86400,sm.stale===true]);else if(sm?sm.stale===true:S.last)miss.push('market');
  const ds=S.desk&&S.desk.state;if(ds&&ds.status==='bad')miss.push('desk');else if(ds&&ds.data&&typeof ds.data.generated_at==='number')ages.push([Date.now()/1000-ds.data.generated_at,3600]);
  DeckPages.mark(S.ctx,C.freshMark(ages,miss.length))}
 const tv=()=>{if(DeckPages.tv&&S.ctx)DeckPages.tv(S.ctx)};
 async function openZip(zip,opener){if(!/^\d{5}$/.test(String(zip||'')))return;
  const r=await DeckPages.get('housing/zip/'+zip,{timeout:60000});
  const fields=S.fieldsMap;
  if(!r.ok||!r.data||r.data.error){DeckShell.sheet.open(DeckUI.detail({title:zip,sub:'',body:DeckUI.empty({k:r.status===404?'idle':'bad',title:r.status===404?'This ZIP is not in the national data.':'Real estate data is not reporting.'})}));return}
  S.zip=r.data;const ds=S.desk&&S.desk.state?S.desk.state.dataset:null;
  const m=C.zipModel(r.data,{type:S.type,dataset:ds,metrics:S.metrics&&S.metrics.metrics,scores:S.metrics&&S.metrics.scores,fields});
  const sh=DeckUI.detail({title:m.zip,sub:m.place,body:C.zipSheet(m),actions:''});sh.data='zip:'+m.zip;DeckShell.sheet.open(sh)}
 // the sheets behind the strip read /api/realestate on the first tap (one read per refresh, shared by both): the national series behind
 // the national tiles, the comps by type behind the asking price and rent
 function reGet(){if(S.re)return Promise.resolve(S.re);if(!S.reP)S.reP=DeckPages.get('realestate',{timeout:60000}).then(r=>{S.re=r.ok&&r.data&&typeof r.data==='object'?r.data:null;S.reP=null;return S.re});return S.reP}
 const MORE={cnat:['com-nat','National series','United States','national',re=>C.nationalHtml(C.nationalModel(re))],ccomps:['com-comps','Comps by type','','comps',re=>C.compsHtml(C.compsModel(re))]};
 async function openMore(kind,opener){const m=MORE[kind];if(!m)return;
  const one=body=>DeckShell.sheet.open(Object.assign(DeckUI.detail({title:m[1],sub:m[2],body,scope:m[3]}),{id:m[0],opener}));
  if(S.re){one(m[4](S.re));return}
  const d=one(DeckUI.skeleton('row'));const re=await reGet();
  if(d&&d.isConnected&&d.open)one(re?m[4](re):DeckUI.empty({k:'bad',title:'Real estate data is not reporting.'}))}
 // the state a scope sits in, for the listing coverage: Your markets is California, a metro takes its first state ("Los Angeles-Long Beach-Anaheim, CA")
 function scopeState(){const sc=scope();if(sc.kind==='mine')return 'CA';if(sc.kind==='state')return sc.state||'';
  if(sc.kind==='metro'){const m=/, ([A-Z]{2})(?:-|$)/.exec(sc.metro||'');return m?m[1]:''}return ''}
 // no deals of this type here: say so with the type and the place and keep the market facts on screen (the desk's own empty line steps aside)
 function paintNote(){const n=$('.com-desk-note'),d=$('.com-desk');if(!n||!d)return;
  const html=C.noListings(S.deskApi&&S.deskApi.state,S.type,scopeLabel(),C.scopeFacts(S.type,scopeRow()),DeckCRE.covers(S.desk&&S.desk.state?S.desk.state.dataset:null,scopeState()));
  n.innerHTML=html;if(html)d.setAttribute('data-nolist','1');else d.removeAttribute('data-nolist')}
 function setType(t){if(t===S.type)return;S.type=C.typeOk(t);save();paintFbar();paintStrip();paintNote();rank(true);if(S.deskApi)S.deskApi.set({type:S.type})}
 // Min businesses: an empty field or 0 clears the floor (any count), as Residential's Min population does
 function setF(k,v){if(k==='sort')S.f.sort=v||'score';else if(k==='minBiz'){const n=num(v);S.f.minBiz=n!=null&&n>0?Math.round(n):0}else S.f[k]=num(v);save();
  if(k==='maxPrice'){if(S.deskApi)S.deskApi.set({price_max:S.f.maxPrice})}else rank(true);
  paintFbar();paintZips()}
 function onClick(e){const t=e.target&&e.target.closest?e.target:null;if(!t)return;let b;
  if((b=t.closest('[data-com-type]'))){setType(b.dataset.comType);return}
  if((b=t.closest('tr[data-open="czip"]'))){openZip(b.dataset.key,b);return}
  if((b=t.closest('.com-strip [data-open]'))){openMore(b.dataset.open,b);return}
  if((b=t.closest('[data-com-more]'))){S.offset=S.rankRows.length;rank(false);return}
  if((b=t.closest('.com-fbar [data-clear]'))){const k=b.dataset.clear,all=!k||k==='all'||k==='*',had=S.f.maxPrice;
   if(all)S.f={sort:'score',minBiz:0};else if(k==='sort')S.f.sort='score';else if(k==='minBiz')S.f.minBiz=0;else delete S.f[k];save();paintFbar();rank(true);
   if((all||k==='maxPrice')&&had&&S.deskApi)S.deskApi.set({price_max:null});return}
  if((b=t.closest('[data-retry="commercial"]'))){refreshAll();return}}
 function onChange(e){const t=e.target;if(!t||!t.dataset||!t.dataset.comF)return;setF(t.dataset.comF,t.value)}
 function mountDesk(){if(S.deskApi)return;let p='tanner';try{p=localStorage.getItem('cre:person')||'tanner'}catch(e){}
  S.deskApi=creMount($('.com-desk-b'),{person:/^(tanner|jordan|riley)$/.test(p)?p:'tanner',type:S.type,scope:scopeStr(),scopeKind:scope().kind,price_max:S.f.maxPrice,
   scatterEl:$('.com-sc-b'),onZip:z=>openZip(z),onPaint:()=>{paintStrip();paintNote();mark();const a=$('.com-cre');if(a&&a.getAttribute('href')!==creHref())a.setAttribute('href',creHref())}});
  S.desk=S.deskApi;if(S.f.maxPrice)S.deskApi.set({price_max:S.f.maxPrice})}
 function refreshAll(){S.summary=null;S.sumDone=false;S.states=null;S.metros=null;S.re=null;S.zr.clear();rollups();rank(true);if(S.deskApi)S.deskApi.load();S.last=Date.now()}
 DeckPages.register('realestate/commercial',{every:600000,
  show(ctx){S.ctx=ctx;if(!S.built)build(ctx);paintFbar();
   if(window.DeckScope){window.DeckScope.mount(ctx,{onZip:z=>openZip(z),onCity:q=>setQ(q)});
    if(!S.off)S.off=window.DeckScope.onChange(()=>{S.q='';paintFbar(true);rollups();rank(true);if(S.deskApi)S.deskApi.set({scope:scopeStr(),scopeKind:scope().kind})})}
   if(!S.fieldsMap)DeckPages.get('housing/fields',{timeout:60000}).then(r=>{const m={};if(r.ok&&r.data)for(const f of (r.data.fields||[]))if(f&&f.name)m[f.name]=f;S.fieldsMap=m});
   if(!S.sources)DeckPages.get('housing/national?part=sources',{timeout:60000}).then(r=>{S.sources=r.ok&&r.data?r.data.sources:[]});
   mountDesk();rollups();rank(true);S.last=Date.now();
   const z=ctx.params&&ctx.params.zip;if(z)openZip(z)},
  refresh(ctx,tick){S.ctx=ctx;if(!tick||Date.now()-S.last>600000)refreshAll()},
  hide(){if(S.deskApi)S.deskApi.hide()},
  data(ctx,scopeKey){const z=String(scopeKey||'').indexOf('zip:')===0&&S.zip&&String(S.zip.zip)===scopeKey.slice(4)?S.zip:null;
   return C.dataModel({type:S.type,f:S.f,sources:S.sources||[],scores:S.metrics&&S.metrics.scores,metrics:S.metrics&&S.metrics.metrics,fields:S.fieldsMap,zip:z,re:S.re,deskParts:S.deskApi?S.deskApi.dataParts():null})}});
})();
if(typeof module!=='undefined')module.exports={DeckCom};
