// Best ZIPs (owner order 2026-11-17): the nine data points in his order, the 30-yr rate once in the table head, sortable columns,
// a dash with its reason for a missing value, More columns for the old score columns, and the Multifamily lens (columns whose
// field the build lacks are hidden). The ZIP sheet leads with the nine and adds a Multifamily section. Pure models and render
// on the route-shaped fixtures of tests/fixtures/realestate-page; no DOM, no network.
require('./setup-core.js');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const deck=fs.readFileSync(path.join(root,'static/deck.js'),'utf8');
const a=deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'),b=deck.indexOf('// ==== DECK V6 UI HELPERS END ====');
const D=new Function(deck.slice(a,b)+'\nreturn DeckUI;')();
const src=fs.readFileSync(path.join(root,'static/pages/realestate.js'),'utf8');
const css=fs.readFileSync(path.join(root,'static/css/realestate.css'),'utf8');
const store=init=>{const m=new Map(Object.entries(init||{}));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
const load=ls=>new Function('localStorage','DeckUI',src+'\nreturn {DeckScope,DeckRE};')(ls||store(),D).DeckRE;
const fx=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/realestate-page',p),'utf8'));
const sum=fx('summary.json'),fields=fx('fields.json'),rank=fx('rank.json'),z92647=fx('zip-92647.json');
const qs=s=>Object.fromEntries(s.split('&').map(p=>p.split('=').map(decodeURIComponent)));
// keeps the no-break space that joins a figure to its unit (\s would fold it)
const text=h=>h.replace(/<[^>]*>/g,' ').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/[ \t\n]+/g,' ');
const NINE_COLS=['Home value','1-yr change','Rent','Gross yield','Days to sell','Price cuts','Inventory','Payment to income'];
// a live-shaped v2 answer: the columns the live zips.json carries for the page (2026-11-17), CA rows with every data point
const COLS=['zip','city','state','area_grade','h_score','home_value','gross_yield','typical_rent','value_trend_1y','days_on_market','price_cuts','population','income',
 'value_trend_5y','affordability','climate_risk','inventory','rent_trend_1y','multifamily_score','home_value_conf','typical_rent_conf','h_conf','multifamily_conf','cbsa'];
const row=(zip,o)=>Object.assign({zip,city:'Anaheim',state:'CA',area_grade:'B',h_score:61.2,home_value:812345,gross_yield:4.1,typical_rent:2777,value_trend_1y:2.3,
 days_on_market:41,price_cuts:28.4,population:51234,income:98765,value_trend_5y:31.2,affordability:48.2,climate_risk:22,inventory:87,rent_trend_1y:3.4,
 multifamily_score:66,home_value_conf:.8,typical_rent_conf:.6,h_conf:.7,multifamily_conf:.5,cbsa:'31080',rank:1},o);
const answer=(rows,o)=>({ok:true,data:Object.assign({dataset:'v2',cols:COLS,total:rows.length,sort:'h_score',sort_dir:'desc',rows},o)});
const st=(rows,o)=>Object.assign({rank:answer(rows),rows,f:{grade:'',within:false,max:null,minPop:null,sort:'score'},cls:'D',sum,lens:'res',more:false},o);
const heads=h=>[...h.matchAll(/<th scope="col"[^>]*>(?:<button[^>]*>)?([^<]+)/g)].map(m=>m[1]);

test('the nine data points are the columns, in the owner\'s order; the 30-yr rate shows once, in the head line, with its date',()=>{
 const R=load(),h=R.bestHtml(st([row('92801')]));
 assert.deepEqual(heads(h),['ZIP'].concat(NINE_COLS));
 assert.match(h,/<span class="act">30-yr rate 7\.11% \u00b7 Nov 12, 2026<\/span>/);
 assert.equal((h.match(/7\.11%/g)||[]).length,1,'once, never per row');
 assert.equal(R.rateLine({mortgage:{rate_30y:null}}),'','no rate, no line');
 const cells=text(h);for(const v of ['$812K','+2.3%','$2,777/mo','4.10%','41\u00a0days','28.4%','87\u00a0homes','48.2%'])assert.ok(cells.includes(v),v);
 // the first four are P1; the rest are P2 (phone cards and wide tables keep them, TV and a narrow column drop them)
 const pri=[...h.matchAll(/<td class="n"( data-pri="(\d)")? data-l="([^"]+)"/g)].map(m=>[m[3],m[2]||'1']);
 assert.deepEqual(pri.map(x=>x[1]),['1','1','1','1','2','2','2','2']);
});

test('a missing value is a dash with its reason, never a zero; a column whose field the build lacks is hidden, not empty',()=>{
 const R=load(),h=R.bestHtml(st([row('92801',{price_cuts:null,affordability:0})]));
 assert.match(h,/<td class="n" data-pri="2" data-l="Price cuts"><span class="na re-na" title="Price cuts: not reported for this ZIP\. Open the ZIP to see why\." aria-label="[^"]+">-<\/span><\/td>/);
 assert.match(h,/data-l="Payment to income">0\.0%</,'a real zero stays a zero');
 const thin=answer([row('92801')],{cols:COLS.filter(c=>c!=='inventory')}),t=R.bestHtml(Object.assign(st([row('92801')]),{rank:thin}));
 assert.ok(!heads(t).includes('Inventory'),'no inventory column when the answer has none');
 assert.ok(!/Inventory: not reported/.test(t));
});

test('every column header sorts on the server; the sorted one carries the direction the server used',()=>{
 const R=load(),cat={dataset:'v2',fields:fields.fields.concat(['inventory','multifamily_score','cbsa'].map(name=>({name,in_zips:true,rankable:true})))};
 const h=R.bestHtml(Object.assign(st([row('92801')],{rank:answer([row('92801')],{sort:'days_on_market',sort_dir:'asc'})}),{f:{sort:'days'},fields:cat}));
 for(const l of NINE_COLS)assert.match(h,new RegExp('<button type="button" class="sort" data-sort="[a-z]+">'+l.replace(/[$/]/g,'\\$&')+'<'),l);
 assert.match(h,/<th scope="col" class="n" data-pri="2" aria-sort="ascending"><button type="button" class="sort" data-sort="days">Days to sell/);
 assert.match(h,/Sort: Days to sell/);
 // the sort ids reach the server as the columns it ranks on; Home value is the price sort (lowest first)
 const q=s=>qs(R.rankQuery({kind:'us'},{sort:s},{fields:cat})).sort;
 assert.deepEqual(['value','change_1y','rent','yield','days','cuts','inventory','afford','mf','rent_1y'].map(q),
  ['price','value_trend_1y','typical_rent','gross_yield','days_on_market','price_cuts','inventory','affordability','multifamily_score','rent_trend_1y']);
 // a second tap flips it with dir= (v2 only; v1 data would answer 400)
 assert.equal(qs(R.rankQuery({kind:'us'},{sort:'days',dir:'desc'},{fields:cat})).dir,'desc');
 assert.equal(qs(R.rankQuery({kind:'us'},{sort:'days'},{fields:cat})).dir,undefined);
 assert.equal(qs(R.rankQuery({kind:'us'},{sort:'days',dir:'desc'},{fields:{dataset:'v1',fields:[]}})).dir,undefined);
 // the answer's own sort wins when it differs from the one asked
 assert.equal(R.sortUsed({sort:'cuts'},{sort:'h_score'},cat),'score');assert.equal(R.sortUsed({sort:'value'},{sort:'price'},cat),'value');
});

test('More columns keeps the old score columns one tap away; the view is stored',()=>{
 const ls=store(),R=load(ls);
 const more=R.bestHtml(st([row('92801')],{more:true}));
 assert.deepEqual(heads(more).slice(9),['Score','Rental grade','Population','Household income','5-yr change','Climate risk']);
 assert.match(more,/data-re-morecols aria-pressed="true">More columns</);
 assert.match(more,/<span class="grade g-B">B<\/span>/);
 assert.match(R.bestHtml(st([row('92801')])),/data-re-morecols aria-pressed="false"/);
 R.viewSave({lens:'mf',more:true});assert.deepEqual(load(ls).viewLoad(),{lens:'mf',more:true});
 assert.deepEqual(load(store({'re:res:view':'{"lens":"x","more":"yes"}'})).viewLoad(),{lens:'res',more:false});
});

test('Multifamily lens: its columns where the build has them, metro apartment rent from the row\'s metro, hidden otherwise',()=>{
 const R=load();
 const lens=h=>[...h.matchAll(/data-re-lens="(\w+)"( class="on")?/g)].map(m=>m[1]+(m[2]?'*':''));
 assert.deepEqual(lens(R.bestHtml(st([row('92801')]))),['res*','mf']);
 // a build whose zips.json lacks the ACS, permit and cap columns (base 8f0e501): those columns are hidden
 const mf=R.bestHtml(st([row('92801')],{lens:'mf'}));
 assert.deepEqual(lens(mf),['res','mf*']);assert.deepEqual(heads(mf),['ZIP','Multifamily score','Rent','Rent 1\u2011yr']);
 assert.doesNotMatch(mf,/data-re-morecols/,'More columns belongs to the Residential lens');
 assert.match(mf,/data-l="Multifamily score"><span class="re-nw">66<span class="conf"/,'the score keeps its meter (multifamily_conf)');
 // once the build adds them (L20: zips_json_cols), every column shows; the ACS renter field wins over the all-homes fallback
 const all=COLS.concat(['acs_units_5plus_share','acs_units_2_4_share','acs_vacant_for_rent_share','bps_units_5plus_12m','cap_spread_multifamily']);
 const r=row('92801',{acs_units_5plus_share:19.6,acs_units_2_4_share:18.3,acs_vacant_for_rent_share:1.7,bps_units_5plus_12m:24,cap_spread_multifamily:-0.4});
 const ctx=new Map([['31080',2.9]]);
 const full=R.bestHtml(Object.assign(st([r],{lens:'mf',mfCtx:ctx}),{rank:answer([r],{cols:all})}));
 assert.deepEqual(heads(full),['ZIP','Multifamily score','Rent','Rent 1\u2011yr','Homes in 5+ unit buildings','2-4 unit share','Vacant for rent','Units permitted 5+','MF cap spread','Metro MF rent 1\u2011yr']);
 const t=text(full);for(const v of ['19.6%','18.3%','1.7%','24\u00a0units','\u22120.4 pt','+2.9%'])assert.ok(t.includes(v),v);
 const acs=R.bestCols({lens:'mf',isV2:true,have:new Set(all.concat('acsmf_renter_5plus_share')),ctx});
 assert.equal(acs.find(c=>c.key==='r5').field,'acsmf_renter_5plus_share');assert.equal(acs.find(c=>c.key==='r5').label,'Renters in 5+ unit buildings');
 // no metro value anywhere: no metro column; a row whose metro has none reads the dash
 assert.ok(!R.bestCols({lens:'mf',isV2:true,have:new Set(all),ctx:new Map()}).some(c=>c.key==='mmf'));
 assert.match(R.cellHtml(row('1',{cbsa:'99999'}),{key:'mmf'},true,1,ctx),/re-na/);
 // the rank query asks for every column of both lenses that zips.json has, and the metro code
 const cat={dataset:'v2',fields:fields.fields.concat(['inventory','multifamily_score','multifamily_conf','cbsa'].map(name=>({name,in_zips:true})))};
 const cols=qs(R.rankQuery({kind:'mine'},{sort:'mf'},{fields:cat})).cols.split(',');
 for(const c of ['inventory','multifamily_score','multifamily_conf','cbsa','rent_trend_1y','days_on_market','affordability'])assert.ok(cols.includes(c),c);
 assert.ok(!cols.includes('acs_units_5plus_share'),'never a column the build lacks (400)');
});

test('the lens and the help line: one plain line per shown column, units on every number, no source names',()=>{
 const R=load(),h=R.bestHtml(st([row('92801')]));
 const help=h.slice(h.indexOf('re-colhelp'));
 assert.match(help,/<summary>What the columns mean<\/summary>/);
 for(const l of ['ZIP'].concat(NINE_COLS,['30-yr rate','A dash']))assert.match(help,new RegExp('<dt>'+l+'</dt><dd>[^<]{10,120}</dd>'),l);
 assert.doesNotMatch(text(help),/Zillow|Redfin|Realtor|Census|ACS|FRED|HUD/);
 assert.doesNotMatch(R.bestHtml(st([row('92801')],{tv:true})),/re-colhelp|re-btools/,'TV keeps the board bare');
 assert.doesNotMatch(src,/\u2014/,'no em dash in the page');
});

test('ZIP sheet: the nine lead in a strip; a Multifamily section with unit mix, renters, rent by bedrooms and maturity',()=>{
 const R=load(),cat=new Map(fields.fields.map(f=>[f.name,f]));
 const rec=Object.assign({},z92647,{cbsa:'31080',acs_units_2_4_share:18.31,acs_units_5plus_share:19.56,acs_vacant_for_rent_share:1.69,bps_units_5plus_12m:24,
  acsmf_renter_5plus_share:41.2,acsmf_rent_0br:1890,acsmf_rent_1br:2210,acsmf_rent_2br:2875,acsmf_rent_3br:null,hud_assisted_units:120,fham_loans_maturing_5y:3,fham_upb_maturing_5y:41000000});
 const z=R.zipModel(rec,{summary:sum,cat,mfCtx:new Map([['31080',2.9]])}),mf=z.sections.find(s=>s.id==='mf');
 assert.equal(z.tiles.length,9);assert.equal(z.tiles.find(t=>t.key==='inventory').unit,'\u00a0homes');
 const it=Object.fromEntries(mf.items.map(x=>[x.label,x.value]));
 assert.equal(it['Homes in 2 to 4 unit buildings'],'18.3%');assert.equal(it['Renters in 5+ unit buildings'],'41.2%');
 assert.equal(it['Rent, studio'],'$1,890/mo');assert.equal(it['Rent, 2 BR'],'$2,875/mo');assert.equal(it['Units permitted in 5+ unit buildings, 12 months'],'24\u00a0units');
 assert.equal(it['FHA apartment loans maturing within 5 years'],'3\u00a0loans');assert.equal(it['FHA loan balance maturing within 5 years'],'$41.00M');
 assert.equal(it['Metro apartment rent, 1-yr'],'+2.9%');
 assert.ok(mf.missing.includes('Rent, 3 BR'),'a field in the record but null is named');
 assert.ok(!mf.missing.some(x=>/50\+ unit|refinance/.test(x)),'a field the build does not have is not named');
 const body=text(R.zipBody(z,{find:''},Date.now()));
 assert.match(body,/Multifamily/);assert.doesNotMatch(body,/HUD|Census|ACS/,'no source names in the sheet');
 // a record without any multifamily field draws no section
 const bare=Object.fromEntries(Object.entries(z92647).filter(([k])=>!/^(acs|bps|hud|fha|lihtc|lihx|crel|cap_spread|multifamily|renter_share)/.test(k)));
 assert.ok(!R.zipModel(bare,{summary:sum,cat:new Map()}).sections.some(s=>s.id==='mf'));
});

test('layout: Best ZIPs takes the full width on D and XL; the landscape phone keeps the nine; 44 px help target',()=>{
 assert.match(css,/@media \(min-width:1100px\) and \(min-height:500px\)\{\s*html:not\(\.tv\) \.re-cols\{display:flex;flex-direction:column\}\s*html:not\(\.tv\) \.re-cols>\.re-b\{order:-1\}/);
 assert.match(css,/\.re-cols>\.re-a>\.sect\{break-inside:avoid/,'a section never splits across the two columns');
 assert.match(css,/max-height:499px\)\{html:not\(\.tv\) \.re-best \.htbl \[data-pri="2"\]\{display:table-cell\}/);
 assert.match(css,/\.re-colhelp>summary\{[^}]*min-height:var\(--hit\)/);
 assert.doesNotMatch(css,/re-pcard/,'the phone-only grade pill left with More columns');
});

// verifier 2026-11-17: thin ZIPs take their county's or metro's days to sell and price cuts (blend.area_fallback); the page showed
// those as the ZIP's own figures
test('area values: a rank row\'s from and a ZIP record\'s m[k].from tag the cell, the strip tile and the sheet row "county value"',()=>{
 const R=load();
 assert.equal(R.fromOf({from:{days_on_market:'county'}},'days_on_market'),'county');
 assert.equal(R.fromOf({from:{days_on_market:'city'}},'days_on_market'),'','only county and metro');
 assert.equal(R.fromOf({m:{price_cuts:{v:22.8,from:'metro'}}},'price_cuts'),'metro');
 assert.equal(R.fromOf({m:{days_on_market:{v:null,reason:'too few listings',from:'dom'}}},'days_on_market'),'','a rejected metric is no area value');
 assert.equal(R.fromOf(null,'x'),'');
 const h=R.bestHtml(st([row('92801',{from:{days_on_market:'county'}}),row('92802',{rank:2})]));
 const r1=h.slice(h.indexOf('data-key="92801"'),h.indexOf('data-key="92802"')),r2=h.slice(h.indexOf('data-key="92802"'));
 assert.match(r1,/41\u00a0days(<[^>]+>)*<small class="re-from" title="Not this ZIP\u2019s own figure\. The ZIP has none, so this is the value for its county\.">county value<\/small>/);
 assert.doesNotMatch(r2,/re-from/,'a ZIP\'s own figure carries no tag');
 const rec=Object.assign({},z92647,{m:Object.assign({},z92647.m,{days_on_market:{v:39,c:.29,n:101,p:[['days_on_market',.6,2]],from:'county',area:'06059'}}),days_on_market:39});
 const z=R.zipModel(rec,{summary:sum,cat:new Map()});
 assert.equal(z.tiles.find(t=>t.key==='days_on_market').from,'county');
 assert.ok(!('from' in z.tiles.find(t=>t.key==='home_value')),'own figures keep their shape');
 assert.equal(z.sections.find(s=>s.id==='market').items.find(i=>i.key==='days_on_market').from,'county');
 const body=R.zipBody(z,{},Date.now());
 assert.ok((body.match(/>county value<\/small>/g)||[]).length>=2,'head strip and Market section both say so');
 assert.match(css,/\.re-from\{[^}]*border:1px solid var\(--c-line\)/);
 const mine=R.mineModel({market:{residential:{areas:[{level:'zip',zip:'92647',name:'Huntington Beach'}]}}},[row('92647',{from:{days_on_market:'county'}})],sum);
 assert.equal(mine[0].daysWord,'days to sell, county value');
});

test('a saved Multifamily lens ranks by the multifamily score on load; a lens keeps a sort its own columns use',()=>{
 const R=load();
 assert.equal(R.lensSort('mf','score'),'mf','the residential score is no multifamily column');
 assert.equal(R.lensSort('mf','rent'),'rent');assert.equal(R.lensSort('res','mf'),'score');assert.equal(R.lensSort('res','days'),'days');
 // the live load applies it before the first read: a saved mf view with the default sort asks for multifamily_score
 assert.match(src,/if\(!S\.viewDone\)\{Object\.assign\(S,viewLoad\(\)\);S\.viewDone=true;lensSortApply\(\)\}/);
 assert.match(src,/function setLens\(l\)\{[^}]*\n?[^}]*lensSortApply\(\)/);
});

test('a count of one is singular: 1 home, 1 day, 1 unit; the rest stay plural',()=>{
 const R=load(),u=(k,v)=>R.fmtVal(k,v).unit;
 assert.equal(u('homes',1),'\u00a0home');assert.equal(u('homes',77),'\u00a0homes');assert.equal(u('ndays',1.2),'\u00a0day');assert.equal(u('ndays',39),'\u00a0days');
 assert.equal(u('units',1),'\u00a0unit');assert.equal(u('loans',1),'\u00a0loan');assert.equal(u('people',1),'\u00a0person');assert.equal(u('people',2),'\u00a0people');
 assert.equal(u('households',1),'\u00a0household');assert.equal(u('contracts',0),'\u00a0contracts');
});
