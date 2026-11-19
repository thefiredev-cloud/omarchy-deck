// Restore (2026-11-15, parity report rows 52, 53, 57, 58): what the redesign dropped from Real estate comes back one tap away.
// Residential: inventory, list and sale price per area (the Your markets area sheet and the ZIP sheet's Your market section) and the
// 15-yr rate under the 30-yr. Commercial: the national series and the comps by type in sheets behind the strip. Feed shapes are the
// live /api/realestate market block (house-feeds/realestate.json, 2026-11-14), trimmed.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const block=(file,a,b)=>{const s=fs.readFileSync(path.join(root,file),'utf8');return s.slice(s.indexOf(a),s.indexOf(b))};
const DeckUI=new Function(block('static/deck.js','// ==== DECK V6 UI HELPERS BEGIN','// ==== DECK V6 UI HELPERS END ====')+'\nreturn DeckUI;')();
const DeckCRE=new Function(block('static/cre.js','// ==== DECK CRE PURE BEGIN','// ==== DECK CRE PURE END ====')+'\nreturn DeckCRE;')();
const C=new Function('DeckUI','DeckCRE',block('static/pages/commercial.js','// ==== DECK COMMERCIAL PURE BEGIN','// ==== DECK COMMERCIAL PURE END ====')+'\nreturn DeckCom;')(DeckUI,DeckCRE);
const reSrc=fs.readFileSync(path.join(root,'static/pages/realestate.js'),'utf8');
const store=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
const R=new Function('localStorage','DeckUI',reSrc+'\nreturn DeckRE;')(store(),DeckUI);
const text=h=>h.replace(/<[^>]*>/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/\s+/g,' ');
const SOURCE_WORDS=/Zillow|Realtor|Redfin|FRED|Census|CoStar|Freddie|Realmo|ZHVI|\bas of\b|Sources?:|\.csv|\.json/;

const areas=[
 {slug:'zip-92629',name:'Dana Point',tier:'home',level:'zip',zip:'92629',zhvi:{value:1790154.98,as_of:'2026-09-30',yoy_pct:7.06},list_price:{value:2230833,as_of:'2026-09-30',yoy_pct:26.99},
  sale_price:{value:1856500,as_of:'2026-08-31'},days_to_pending:null,active_listings:77,days_on_market:68,realtor_list_price:2489000,realtor_as_of:'2026-10-01'},
 {slug:'zip-92624',name:'Capistrano Beach',tier:'south_oc',level:'zip',zip:'92624',zhvi:{value:1704699.15,as_of:'2026-09-30',yoy_pct:5.67},list_price:null,sale_price:null,days_to_pending:null,
  active_listings:22,days_on_market:95,realtor_list_price:2772500,realtor_as_of:'2026-10-01'},
 {slug:'orange-county-ca',name:'Orange County',tier:'oc',level:'county',zip:null,zhvi:{value:1174873.29,as_of:'2026-09-30',yoy_pct:3.2},inventory:{value:6728,as_of:'2026-09-30',yoy_pct:-0.41},
  list_price:{value:1218217,as_of:'2026-09-30',yoy_pct:-6.15},sale_price:{value:1150000,as_of:'2026-08-31',yoy_pct:2.22},days_to_pending:{value:25,as_of:'2026-09-30',yoy_pct:-7.41}},
 {slug:'united-states',name:'United States',tier:'us',level:'us',zip:null,zhvi:{value:366157.15,as_of:'2026-09-30',yoy_pct:1.19},inventory:{value:1406624,as_of:'2026-09-30',yoy_pct:2.44},
  list_price:{value:403300,as_of:'2026-09-30',yoy_pct:-2.19},sale_price:{value:375000,as_of:'2026-08-31',yoy_pct:2.18},days_to_pending:{value:27,as_of:'2026-09-30',yoy_pct:3.85}}];
const mortgage={rate_30y:{value:7.11,as_of:'2026-11-12',series:'MORTGAGE30US'},rate_15y:{value:6.45,as_of:'2026-11-12',series:'MORTGAGE15US'},source:'FRED (St. Louis Fed) fredgraph.csv'};
const ci={
 price_growth:{value:6.58,as_of:'2026-01-01',series:'COMREPUSQ159N'},loan_balance_bn:{value:3153.92,as_of:'2026-10-01',series:'CREACBM027SBOG'},
 delinquency:{value:1.53,as_of:'2026-04-01'},chargeoff:{value:0.14,as_of:'2026-04-01'},rental_vacancy:{value:7.6,as_of:'2026-07-01'},homeowner_vacancy:{value:1.2,as_of:'2026-07-01'},
 multifamily_starts:{value:349,as_of:'2026-09-01'},treasury_10y:{value:5.1,as_of:'2026-11-12'},
 vacancy:{status:'unavailable',reason:'No free public metro office, industrial or retail vacancy series for OC, LA or SD.'},
 cap_rate:{status:'unavailable',reason:'No free public cap rate series.'},source:'FRED (St. Louis Fed) fredgraph.csv',
 lease_comps:{status:'ok',source:'Realmo asking rents, Orange County cities',as_of:'2026-11-14',listings:793,priced:123,
  comps:[{type:'Office',median_psf_yr:35.4,n:21,low:8.23,high:85.05},{type:'Industrial',median_psf_yr:15.55,n:4,low:8,high:19.11}],
  monthly:[{type:'Office',median_mo:4975,n:83},{type:'Industrial',median_mo:2825,n:4},{type:'Other',median_mo:4980,n:3}]},
 asking_sale:{status:'ok',source:'asking prices on the for-sale listings in this feed',as_of:'2026-11-14',
  comps:[{type:'Industrial',median_psf:296,n:336,low:0,high:4145},{type:'Office',median_psf:404,n:214,low:10,high:7127},{type:'<img src=x onerror=alert(1)>',median_psf:463,n:168,low:51,high:3428}]}};
const re={market:{residential:{areas},mortgage,commercial_indicators:ci}};
const sum={us:{home_value:362000,value_trend_1y:0.4,typical_rent:2100,days_on_market:44,home_value_conf:0.6,home_value_n:30000},mortgage:{rate_30y:7.11}};

test('15-yr rate: rides under the 30-yr on the strip, never as an extra tile; TV keeps its board as it was',()=>{
 const base=R.stripModel(sum.us,sum),withRate=R.stripModel(sum.us,sum,{rate15:R.rate15Of(re),known:true});
 assert.equal(withRate.length,base.length,'no new tile, so the D strip keeps whole rows');
 const t=withRate.find(x=>x.key==='mortgage_rate');assert.equal(t.label,'30-yr rate');assert.equal(t.value,'7.11%');assert.equal(t.sub,'15-yr 6.45%');
 const html=R.stripHtml(withRate,'United States',false);assert.match(html,/15-yr 6\.45%/);
 assert.doesNotMatch(R.stripHtml(withRate,'United States',true),/15-yr/,'nothing new on the TV board');
 assert.equal(R.stripModel(sum.us,sum).find(x=>x.key==='mortgage_rate').sub,'','before the feed answers the tile says nothing more');
 assert.equal(R.stripModel(sum.us,sum,{rate15:null,known:true}).find(x=>x.key==='mortgage_rate').sub,'15-yr: No data','a missing rate says so, never 0');
 const only15=R.stripModel({home_value:1},{mortgage:null},{rate15:mortgage.rate_15y,known:true}).find(x=>x.key==='mortgage_rate');
 assert.deepEqual([only15.label,only15.value,only15.sub],['15-yr rate','6.45%',''],'without a 30-yr rate the 15-yr still shows');
 assert.equal(R.rate15Of({market:{mortgage:{rate_15y:'6.4'}}}),null,'a hostile feed is no rate');
});

test('Your markets: county and US rows open their area sheet; ZIP rows keep the ZIP sheet; a bad slug opens nothing',()=>{
 const rows=R.mineModel(re,null,sum),h=R.mineHtml(rows);
 assert.match(h,/data-open="zip" data-key="92629"/);
 assert.match(h,/data-open="area" data-key="orange-county-ca"/);assert.match(h,/data-open="area" data-key="united-states"/);
 const bad=R.mineModel({market:{residential:{areas:[{slug:'"><b>x',name:'Bad <b>County</b>',level:'county',zhvi:{value:1}}]}}},null,null);
 assert.equal(bad[0].slug,'');const bh=R.mineHtml(bad);assert.doesNotMatch(bh,/data-open="area"/);assert.doesNotMatch(bh,/<b>County/);
 assert.deepEqual(R.mineModel({},null,null),[],'an empty feed is no rows, never a broken page');
});

test('area sheet: homes for sale, list and sale price, days to pending, each with its 1-yr change and month',()=>{
 const m=R.areaModel(R.areaBySlug(re,'orange-county-ca'));
 assert.deepEqual(m.items.map(x=>x.label),['Home value','Homes for sale','List price','Sale price','Days to pending']);
 const by=Object.fromEntries(m.items.map(x=>[x.key,x]));
 assert.equal(by.inventory.value,'6,728');assert.equal(by.inventory.line,'\u22120.4% 1-yr \u00b7 Sep 2026');
 assert.equal(by.list_price.value,DeckUI.fmt.money(1218217));assert.equal(by.sale_price.line,'+2.2% 1-yr \u00b7 Aug 2026','the sale price keeps its own month');
 assert.equal(m.title,'Orange County');assert.equal(m.sub,'County');
 const body=R.areaBody(m);assert.doesNotMatch(text(body),SOURCE_WORDS);assert.doesNotMatch(body,/Not reported/);
 assert.equal(R.areaModel(R.areaBySlug(re,'united-states')).sub,'Nationwide');
 // a ZIP row carries listing counts, a list price and days on market from its second source; a missing sale price is named once
 const z=R.areaModel(R.areaByZip(re,'92624'));const zb=Object.fromEntries(z.items.map(x=>[x.key,x]));
 assert.equal(zb.inventory.value,'22');assert.equal(zb.inventory.line,'Oct 2026');assert.equal(zb.list_price.value,DeckUI.fmt.money(2772500));
 assert.equal(zb.days_to_pending.label,'Days on market');assert.deepEqual(z.missing,['Sale price']);
 assert.match(R.areaBody(z),/Not reported: Sale price\./);
 assert.match(R.areaBody(null),/not reporting/,'an area the feed lost says so');
 assert.equal(R.areaModel({name:'X',level:'county',inventory:{value:0,as_of:'2026-09-30'}}).items[0].value,'0','a real zero count is a value');
});

test('ZIP sheet: one of the owner\'s ZIPs leads with its own market numbers; any other ZIP has no such section',()=>{
 const rec={zip:'92629',city:'Dana Point',state:'CA',home_value:1790155,typical_rent:5200,gross_yield:2.8,value_trend_1y:7};
 const z=R.zipModel(rec,{summary:sum,area:R.areaByZip(re,'92629')});
 assert.equal(z.sections[0].id,'mine');assert.equal(z.sections[0].title,'Your market');
 assert.deepEqual(z.sections[0].area.items.map(x=>x.label),['Homes for sale','List price','Sale price','Days on market'],'the value is the headline\'s, not repeated');
 const body=R.zipBody(z,{find:''},Date.now());assert.match(body,/data-sec="mine"/);assert.match(body,/Homes for sale/);assert.doesNotMatch(text(body),SOURCE_WORDS);
 assert.ok(!R.zipModel(rec,{summary:sum,area:null}).sections.some(s=>s.id==='mine'));
});

test('Residential Data sheet: the feed\'s sources for Your markets and the 15-yr rate, with plain dates',()=>{
 const d=R.dataModel({sources:[],summary:sum,cat:new Map(),re});
 const names=d.sources.map(s=>s.name);
 for(const n of ['Zillow Research','Realtor.com','Freddie Mac mortgage survey'])assert.ok(names.includes(n),n);
 assert.equal(d.sources.find(s=>s.name==='Freddie Mac mortgage survey').asOf,'Nov 12, 2026');
 assert.equal(d.sources.find(s=>s.name==='Zillow Research').asOf,'Sep 2026');
 assert.ok(d.sources.every(s=>!/^\d{4}-\d{2}/.test(s.asOf)));
 assert.deepEqual(R.dataModel({sources:[],summary:sum,cat:new Map(),re:null}).sources.map(s=>s.gives),['30-yr fixed rate, national'],'no feed, no feed rows: only the national 30-yr rate the summary carries');
 assert.ok(!R.dataModel({sources:[{id:'fred_mortgage_rates',name:'Freddie Mac Primary Mortgage Market Survey'}],summary:sum,cat:new Map(),re:null}).sources.some(s=>s.gives==='30-yr fixed rate, national'),'never twice');
});

test('Commercial strip: the national and the comps tiles open their sheet, a Not published one included; no new tile',()=>{
 const m=C.stripModel({type:'office',row:{asking_cap:5.58},us:{fred_treasury_10y:5.1,fred_cre_delinquency:1.53,fred_cre_price_yoy:6.58},desk:{}});
 assert.equal(m.length,8);
 const h=C.stripHtml(m,'Market');
 for(const l of ['10-yr Treasury','Delinquency','Price index 1-yr'])assert.match(h,new RegExp('<button type="button" class="tile[^"]*" data-open="cnat"><span class="h">'+l.replace(/[$/]/g,'\\$&')));
 assert.match(h,/<button type="button" data-open="ccomps" class="tile np"><span class="h">Asking \$\/SF<\/span><span class="t">Not published/,'a missing series still opens the comps');
 assert.match(h,/data-open="ccomps" class="tile np dx"><span class="h">Lease/);
 assert.doesNotMatch(h,/data-open="[^"]*"[^>]*><span class="h">(Asking cap rate|Loan rate|Cap spread)/,'tiles with nothing behind them stay plain');
});

test('National series sheet: every series the old page drew, each with its period; a missing one says No data',()=>{
 const m=C.nationalModel(re);assert.equal(m.length,8);
 const by=Object.fromEntries(m.map(x=>[x.key,x]));
 assert.deepEqual([by.loan_balance_bn.value,by.loan_balance_bn.sub],['$3.15T','Oct 2026']);
 assert.deepEqual([by.chargeoff.value,by.chargeoff.sub],['0.14%','Q2 2026']);
 assert.deepEqual([by.rental_vacancy.value,by.homeowner_vacancy.value],['7.6%','1.2%']);
 assert.deepEqual([by.multifamily_starts.value,by.multifamily_starts.unit],['349K','a year']);
 assert.deepEqual([by.price_growth.value,by.price_growth.unit,by.price_growth.sub],['+6.6%','a year','Q1 2026']);
 assert.equal(by.treasury_10y.sub,'Nov 12, 2026');
 const h=C.nationalHtml(m);assert.doesNotMatch(text(h),SOURCE_WORDS);assert.equal((h.match(/class="tile/g)||[]).length,8);
 const gone=C.nationalModel({market:{commercial_indicators:{chargeoff:{value:null},rental_vacancy:'x'}}});
 assert.equal(gone.filter(x=>x.value==null).length,8);assert.equal((C.nationalHtml(gone).match(/>No data</g)||[]).length,8);
 assert.doesNotMatch(C.nationalHtml(gone),/>0(\.0+)?%?</,'never a zero for a missing series');
 assert.equal(C.nationalModel({}),null);assert.match(C.nationalHtml(null),/not reporting/);
});

test('Comps by type: sale and lease tables with labelled cells for phone cards, the monthly-only type kept, hostile text escaped',()=>{
 const m=C.compsModel(re);
 assert.deepEqual(m.sale.map(r=>r.type),['Industrial','Office','<img src=x onerror=alert(1)>']);
 assert.equal(m.sale[0].low,null,'a $0 asking price per SF is no data, never 0');
 assert.deepEqual(m.lease.map(r=>r.type),['Office','Industrial','Other']);
 assert.deepEqual(m.lease.find(r=>r.type==='Other'),{type:'Other',psf:null,n:null,mo:4980,nmo:3});
 const h=C.compsHtml(m);
 assert.doesNotMatch(h,/<img/);assert.match(h,/&lt;img src=x/);
 assert.match(h,/Median \$\/SF<\/th>/);assert.match(h,/Median \$\/SF\/yr<\/th>/);assert.match(h,/Median a month<\/th>/);
 assert.match(h,/\$35\.40/);assert.match(h,/\$4,975/);assert.match(h,/\$7,127/);
 for(const cell of h.match(/<td[^>]*>/g))assert.match(cell,/data-l="/,'every cell carries its phone card label');
 assert.doesNotMatch(h,/data-pri=/,'every column shows on a phone card');
 assert.match(text(h),/123 of 793 lease listings show a price\. Asking rents, not signed leases\. Listings on Nov 14, 2026\./);
 assert.doesNotMatch(text(h),SOURCE_WORDS);
 const none=C.compsHtml(C.compsModel({market:{commercial_indicators:{asking_sale:{status:'unavailable',reason:'x'},lease_comps:null}}}));
 assert.equal((none.match(/No data/g)||[]).length,2);assert.match(C.compsHtml(null),/not reporting/);
});

test('Comps by type: a missing cell says No data in words; a $0 price is never printed and is named, not hidden',()=>{
 // the live feed holds low:0 for Industrial (2026-11-14): a bad listing, not a price
 const h=C.compsHtml(C.compsModel(re)),ind=h.match(/<tr[^>]*data-key="Industrial"[\s\S]*?<\/tr>/g)[0];
 assert.match(ind,/data-l="Low \$\/SF">No data<\/td>/,'card and table both read No data, not the lone dot');
 assert.doesNotMatch(h,/class="na"/);assert.doesNotMatch(h,/>\$0</);
 assert.match(text(h),/Left out as a \$0 price: Industrial low\./);
 const lz=C.compsModel({market:{commercial_indicators:{lease_comps:{status:'ok',comps:[{type:'Retail',median_psf_yr:0,n:2}],monthly:[{type:'Retail',median_mo:null,n:1}]}}}});
 assert.deepEqual([lz.lease[0].psf,lz.lease[0].mo,lz.badLease],[null,null,['Retail per SF']],'a null is No data; only the zero is named');
});

test('Commercial Data sheet: the national series and both comps sources once read, and why vacancy and cap rate are absent',()=>{
 const d=C.dataModel({type:'office',sources:[],re});
 const fred=d.sources.find(s=>s.name==='Federal Reserve Economic Data');assert.equal(fred.gives,'National series: 8 of 8');assert.equal(fred.asOf,'Nov 12, 2026');
 assert.ok(d.sources.some(s=>s.gives==='Asking sale prices by type'&&s.asOf==='Nov 14, 2026'));
 assert.ok(d.sources.some(s=>s.name==='Realmo asking rents, Orange County cities'&&s.state==='ok'));
 assert.ok(d.method.some(r=>r[0]==='Office and industrial vacancy'));assert.ok(d.method.some(r=>r[0]==='Cap rate series'));
 assert.equal(C.dataModel({type:'office',sources:[]}).sources.length,0,'before a sheet reads the feed, nothing is claimed');
});
