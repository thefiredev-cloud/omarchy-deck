// Real estate > Residential and its ZIP sheet (deck v3): models and render on route-shaped fixtures trimmed from the staged
// national v2 build (tests/fixtures/realestate-page: 92629, a thin rural ZIP, states, summary, rank and sources answers).
// Pins consumer-visible behaviour: rank queries from filters, strips per scope, ZIP sheet sections, confidence dots, masked money,
// empty and stale states, and no source text on the page.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const deck=fs.readFileSync(path.join(root,'static/deck.js'),'utf8');
const a=deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'),b=deck.indexOf('// ==== DECK V6 UI HELPERS END ====');
const D=new Function(deck.slice(a,b)+'\nreturn DeckUI;')();
const src=fs.readFileSync(path.join(root,'static/pages/realestate.js'),'utf8');
const store=init=>{const m=new Map(Object.entries(init||{}));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
const load=ls=>new Function('localStorage','DeckUI',src+'\nreturn {DeckScope,DeckRE};')(ls||store(),D);
const fx=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/realestate-page',p),'utf8'));
const sum=fx('summary.json'),states=fx('states.json').states,metros=fx('metros.json').metros,fields=fx('fields.json'),rank=fx('rank.json'),
 z92629=fx('zip-92629.json'),rural=fx('zip-rural.json'),sources=fx('sources.json').sources,re=fx('realestate.json'),mine=fx('rank-mine.json');
const qs=s=>Object.fromEntries(s.split('&').map(p=>p.split('=').map(decodeURIComponent)));
const NOW=(sum.generated_at+3600)*1000;
const textOf=h=>h.replace(/<[^>]+>/g,' ').replace(/&[a-z#0-9]+;/g,' ');
const SOURCE_WORDS=/Sources?:|Coverage:|Score weights|Zillow|Realtor\.com|Redfin|Census|ACS|FRED|HUD|IPEDS|NCES|FHFA|ZHVI|as of \d|\.json/;

test('rank query: Within budget is off by default, so the budget never narrows Best ZIPs until asked',()=>{
 const {DeckRE:R}=load(),f=R.filtersLoad(),prof={budget:{budget:845000}};
 assert.deepEqual(f,{grade:'',within:false,max:null,minPop:null,sort:'score'});
 const q=qs(R.rankQuery({kind:'mine'},f,{budget:R.budgetOf(prof),fields}));
 assert.equal(q.kind,'housing');assert.equal(q.max_price,undefined);assert.equal(q.limit,'50');assert.equal(q.offset,'0');
 assert.equal(qs(R.rankQuery({kind:'us'},Object.assign({},f,{within:true}),{budget:845000,fields})).max_price,'845000');
 assert.equal(qs(R.rankQuery({kind:'us'},Object.assign({},f,{within:true,max:600000}),{budget:845000,fields})).max_price,'600000','the lower of budget and max');
 assert.equal(qs(R.rankQuery({kind:'us'},Object.assign({},f,{within:true}),{budget:null,fields})).max_price,undefined,'no budget, no cap');
});

test('rank query: scope, grade, population, sort and the columns the table shows (only columns zips.json has)',()=>{
 const {DeckRE:R}=load();
 const q=qs(R.rankQuery({kind:'state',state:'TX'},{grade:'AB',minPop:5000,sort:'yield'},{fields,offset:50}));
 assert.equal(q.state,'TX');assert.equal(q.grade,'A,B');assert.equal(q.min_pop,'5000');assert.equal(q.sort,'gross_yield');assert.equal(q.offset,'50');
 const cols=q.cols.split(',');
 for(const c of ['h_score','home_value','gross_yield','typical_rent','value_trend_1y','area_grade','h_conf','home_value_conf','typical_rent_conf'])assert.ok(cols.includes(c),c);
 const cat=new Set(fields.fields.filter(x=>x.in_zips).map(x=>x.name).concat(['city','state','area_grade']));
 for(const c of cols)assert.ok(cat.has(c),'every column is a zips.json column: '+c);
 assert.ok(!cols.includes('gross_yield_conf'),'a confidence column the build lacks is not asked for (it would answer 400)');
 const mineQ=qs(R.rankQuery({kind:'mine'},{sort:'score'},{fields}));assert.equal(mineQ.state,'CA');assert.equal(mineQ.county,'Orange,Los Angeles,San Diego');
 const v1=qs(R.rankQuery({kind:'us'},{sort:'yield'},{fields:{dataset:'v1',fields:[]}}));
 assert.equal(v1.sort,'yield');assert.equal(v1.cols,undefined,'v1 data: old aliases, no cols');
 assert.equal(qs(R.rankQuery({kind:'us'},{sort:'score'},{fields,zips:['92629','92624']})).zip,'92629,92624');
});

test('min population: 5,000 by default on State, Metro and US (the national top was bases and tiny towns), none on Your markets; clearable',()=>{
 const {DeckRE:R}=load(),f=R.filtersLoad();
 for(const sc of [{kind:'us'},{kind:'state',state:'TX'},{kind:'metro'}])assert.equal(qs(R.rankQuery(sc,f,{fields})).min_pop,'5000',sc.kind);
 assert.equal(qs(R.rankQuery({kind:'mine'},f,{fields})).min_pop,undefined,'Your markets keeps every owner ZIP');
 assert.deepEqual(R.filterChips(f,{scope:{kind:'us'}}).map(c=>[c.id,c.label]),[['minPop','Min population 5,000']],'shown as an active filter');
 assert.equal(R.filterCount(f,{kind:'us'}),1,'counted on the Filters button');assert.equal(R.filterCount(f,{kind:'mine'}),0);
 const cleared=Object.assign({},f,{minPop:0});
 assert.equal(qs(R.rankQuery({kind:'us'},cleared,{fields})).min_pop,undefined,'cleared means any size');assert.equal(R.filterCount(cleared,{kind:'us'}),0);
 assert.equal(qs(R.rankQuery({kind:'mine'},Object.assign({},f,{minPop:20000}),{fields})).min_pop,'20000','a typed floor applies everywhere');
 const {DeckRE:R2,DeckScope:S2}=load();S2.set({kind:'us'});
 const h=R2.filtersHtml({f:R2.filtersLoad(),prof:null});
 assert.match(h,/data-re-ff="minPop"[^>]*value="5000"/,'the field shows the floor; emptying it clears it');assert.match(h,/class="cnt">1</);
});

test('filters: chips are words only, so a masked budget or max price never leaks a digit',()=>{
 const {DeckRE:R}=load(),f={grade:'A',within:true,max:712345,minPop:2500,sort:'score'};
 assert.deepEqual(R.filterChips(f,{prof:{budget:{budget:845000}}}).map(c=>c.label),['A only','Within budget','Max price','Min population 2,500']);
 assert.equal(R.filterChips({within:true},{prof:{}})[0].label,'Set budget');
 const h=R.filtersHtml({f,prof:{budget:{budget:845000}}});
 assert.doesNotMatch(h,/845|712|\$\d/,'no budget or max price digits on the page');
 assert.match(h,/\$\u2022\u2022\u2022/);
 assert.match(h,/placeholder="ZIP or city"/,'the phone row starts with the search');
 assert.match(h,/re-scope-field/,'scope is the first group in the Filters sheet');
 assert.equal(R.filterCount(f,{kind:'us'}),4);
 const none=R.filtersHtml({f:{grade:'',within:false,max:null,minPop:null,sort:'score'},prof:null});
 assert.match(none,/data-re-budget[^>]*>Set budget</);
 assert.doesNotMatch(none,/class="cnt"/,'no count with no filters');
 // the scope is the sheet's first group, Budget is a two-way choice (never a bare checkbox), Set budget when none
 assert.ok(h.indexOf('re-scope-field')<h.indexOf('data-re-ff="grade"'),'scope first');
 assert.doesNotMatch(h,/type="checkbox"/);
 assert.match(h,/data-re-within="0" aria-pressed="false">Any price<\/button><button type="button" data-re-within="1" class="on" aria-pressed="true">Within <span class="re-amt">\$\u2022\u2022\u2022<\/span>/);
 assert.match(R.filtersHtml({f:{grade:'',within:false,max:null,minPop:null,sort:'score'},prof:{budget:{budget:845000}}}),/data-re-within="0" class="on" aria-pressed="true">Any price/);
});

test('phone and landscape: the top 3, then 10, then the rest of the read page, then the server\'s next 50; the full-width table elsewhere opens at 20',()=>{
 const {DeckRE:R}=load(),many=Array.from({length:50},(_,i)=>Object.assign({},rank.rows[0],{zip:String(20000+i),rank:i+1}));
 const st={rank:{ok:true,data:Object.assign({},rank,{total:200})},rows:many,f:R.filtersLoad()};
 for(const cls of ['P','L']){
  const p=R.bestHtml(Object.assign({cls},st));
  assert.equal((p.match(/<tr tabindex/g)||[]).length,3,cls);assert.match(p,/data-re-more="cards" data-n="10">Show 7 more/);assert.doesNotMatch(p,/Show 50 more|Show fewer/);
  const ten=R.bestHtml(Object.assign({cls,bestN:10},st));
  assert.equal((ten.match(/<tr tabindex/g)||[]).length,10);assert.match(ten,/data-n="50">Show 40 more/);assert.match(ten,/data-re-less="cards">Show fewer/);
  const all=R.bestHtml(Object.assign({cls,bestN:0},st));
  assert.equal((all.match(/<tr tabindex/g)||[]).length,50);assert.match(all,/data-re-more="zips">Show 50 more/);assert.match(all,/Show fewer/);
 }
 for(const cls of ['T','D','XL']){const h=R.bestHtml(Object.assign({cls},st));assert.equal((h.match(/<tr tabindex/g)||[]).length,20,cls);assert.match(h,/data-n="50">Show 30 more/,cls);
  const all=R.bestHtml(Object.assign({cls,bestN:0},st));assert.equal((all.match(/<tr tabindex/g)||[]).length,50);assert.match(all,/Show 50 more/);assert.match(all,/Show fewer/)}
 assert.match(R.cellHtml({zip:'1',typical_rent:2738,typical_rent_conf:.6},{key:'rent'},true,1),/^<span class="re-nw">\$2,738\/mo<span class="conf"/,'value, unit and meter stay together');
});

test('a read that never settles ends in the not-reporting state at the bound, never a blank page',async()=>{
 // the real DeckPages.get from deck.js, a fetch that never answers, and timers that fire at once
 const reg=deck.slice(deck.indexOf('// ==== DECK PAGES REGISTRY BEGIN'),deck.indexOf('// ==== DECK PAGES REGISTRY END ===='));
 const seen=[];const env={fetch:(u,o)=>{seen.push([u,o&&o.signal?'signal':'none']);return new Promise(()=>{})},AbortController,setTimeout:(f,ms)=>{seen.push(['timer',ms]);return setTimeout(f,0)},clearTimeout};
 const P=new Function('fetch','AbortController','setTimeout','clearTimeout','DeckUI',reg+'\nreturn DeckPages;')(env.fetch,env.AbortController,env.setTimeout,env.clearTimeout,D);
 const el={innerHTML:'',querySelector:()=>null,contains:()=>false};
 const doc={activeElement:null,addEventListener(){},querySelectorAll:()=>[]};
 const mod=new Function('localStorage','DeckUI','DeckPages','document','fetch',src+'\nreturn {DeckRE,DeckScope};')(store(),D,P,doc,env.fetch);
 mod.DeckRE.page.show({el,head:null,tv:false,cls:'D'});
 for(let i=0;i<20&&!/not reporting/.test(el.innerHTML);i++)await new Promise(r=>setTimeout(r,5));
 assert.match(el.innerHTML,/Real estate data is not reporting\./);
 assert.ok(seen.some(x=>x[0]==='timer'&&x[1]===60000),'every read is bounded at 60 s');
 assert.ok(seen.filter(x=>typeof x[0]==='string'&&x[0].startsWith('/api/')).every(x=>x[1]==='signal'),'every request can be aborted');
 assert.ok(seen.some(x=>x[0]==='/api/housing/profile'),'the profile read is one of them');
 mod.DeckRE.page.hide();
});

test('strip per scope: rollups give values, the ZIP gives dots; missing values get no tile; the rate never has dots',()=>{
 const {DeckRE:R}=load();
 const us=R.stripModel(sum.us,sum);
 assert.deepEqual(us.slice(0,6).map(t=>t.label),['Home value','1-yr change','Rent','Gross yield','Days to sell','30-yr rate']);
 assert.equal(us.find(t=>t.key==='mortgage_rate').conf,null);
 assert.ok(us.filter(t=>t.dx).length>=1,'D-only tiles are marked');
 const ca=R.stripModel(states.find(s=>s.state==='CA'),sum);
 assert.equal(ca.find(t=>t.key==='home_value').value,D.fmt.money(states.find(s=>s.state==='CA').home_value));
 const home=R.stripModel(z92629,sum),hv=home.find(t=>t.key==='home_value');
 assert.equal(hv.conf.c,z92629.m.home_value.c);assert.ok(hv.spark&&hv.spark.length>1,'ZIP history draws a sparkline');
 assert.equal(home.find(t=>t.key==='typical_rent').unit,'/mo');
 assert.deepEqual(R.stripModel({home_value:null,gross_yield:5.1},{mortgage:null}).map(t=>t.key),['gross_yield']);
 const html=R.stripHtml(home,'Your markets \u00b7 Dana Point',false);
 assert.match(html,/class="strip"/);assert.match(html,/Your markets \u00b7 Dana Point/,'the strip caption names the scope');
 assert.equal((R.stripHtml(home,'x',true).match(/class="tile[\s"]/g)||[]).length,Math.min(6,home.filter(t=>!t.dx).length),'TV keeps the first six');
});

test('confidence: blended ZIP values, rank rows and scope rollups carry the meter; no key, no meter',()=>{
 const {DeckRE:R}=load();
 assert.deepEqual(R.confOf(z92629,'home_value'),{c:z92629.m.home_value.c,n:z92629.m.home_value.n});
 assert.deepEqual(R.confOf({h_score:50,h_conf:.8},'h_score'),{c:.8,zips:null});
 assert.equal(R.confOf({home_value:1},'home_value'),null);
 // rollups carry <metric>_conf and <metric>_n (ZIPs): the strip shows the meter for state, metro and US values
 const ca=states.find(s=>s.state==='CA');assert.ok(ca.home_value_conf!=null&&ca.home_value_n>1,'fixture rollup has confidence');
 const caStrip=R.stripModel(ca,sum),hv=caStrip.find(t=>t.key==='home_value');
 assert.deepEqual(hv.conf,{c:ca.home_value_conf,zips:ca.home_value_n});
 assert.match(R.stripHtml(caStrip,'California',false),/class="conf"[^>]*aria-label="[^"]*median of [\d.,K]+ ZIPs/);
 assert.ok(R.stripModel(sum.us,sum).find(t=>t.key==='home_value').conf,'US strip too');
 assert.equal(R.stripModel({home_value:1},sum)[0].conf,null,'no key, no meter');
 const one={home_value:2,m:{home_value:{v:2,c:.9,n:1}}},cell=R.cellHtml(Object.assign({zip:'1'},{home_value:2,home_value_conf:.9}),{key:'value'},true,1);
 assert.match(cell,/class="conf" data-c="3"/,'a rank row\'s conf column draws dots');
 assert.equal(D.conf(.9,{total:1}),'');assert.equal(R.stripModel(one,{}).find(t=>t.key==='home_value').conf.n,1);
});

test('Best ZIPs: a table with cards on a phone, labels on every cell, no markup inside cell text, 50 then Show 50 more',()=>{
 const {DeckRE:R}=load(),st={rank:{ok:true,data:rank},rows:rank.rows,f:R.filtersLoad()};
 const h=R.bestHtml(st);
 assert.match(h,/<table class="htbl"/);assert.equal((h.match(/<tr tabindex="0" data-open="zip"/g)||[]).length,rank.rows.length);
 for(const td of h.match(/<t[dh][^>]*scope="row"[^>]*>|<td[^>]*>/g))assert.match(td,/data-l="/,'every cell has its phone card label');
 assert.ok((h.match(/data-pri="[234]"/g)||[]).length>0);
 for(const cell of h.match(/<td[^>]*>([\s\S]*?)<\/td>/g))assert.doesNotMatch(textOf(cell),/[<>]/,'no escaped markup in a cell');
 assert.match(h,/data-re-more="zips">Show 50 more/,'the server has more rows');
 assert.match(h,/Sort: Score/);
 const tv=R.bestHtml(Object.assign({},st,{tv:true,rows:Array.from({length:12},(_,i)=>Object.assign({},rank.rows[0],{zip:String(10000+i)}))}));
 assert.equal((tv.match(/<tr tabindex/g)||[]).length,8,'TV shows the top eight');assert.doesNotMatch(tv,/Show 50 more/);
});

test('empty and failed states: no match offers Clear filters, a missing feed says not reporting, loading is a skeleton',()=>{
 const {DeckRE:R}=load();
 const none=R.bestHtml({rank:{ok:true,data:{dataset:'v2',total:0,rows:[]}},rows:[],f:{grade:'A',within:false,max:null,minPop:null,sort:'score'}});
 assert.match(none,/No ZIPs match\. Loosen a filter\./);assert.match(none,/data-re-clear>Clear filters/);
 assert.doesNotMatch(R.bestHtml({rank:{ok:true,data:{rows:[]}},rows:[],f:R.filtersLoad()}),/Clear filters/,'nothing to clear');
 assert.match(R.bestHtml({rank:{ok:false,status:403,data:null},rows:[],f:R.filtersLoad()}),/Real estate data is not reporting\./);
 assert.match(R.bestHtml({rank:{ok:true,data:{status:'not_reporting',reason:'x'}},rows:[],f:R.filtersLoad()}),/not reporting/);
 assert.match(R.bestHtml({rank:null,rows:[],f:R.filtersLoad()}),/skel/);
 assert.match(R.homesHtml({hf:{type:'',beds:0,q:''},homes:{ok:true,data:{total:0,rows:[]}},homeRows:[]},NOW),/No homes for sale tracked here yet\./);
 // the mark reads the server's age, cadence and stale flag (part=summary), never a cadence guessed here
 const fresh=R.pageStatus({age:3*86400,refresh:604800,stale:false},NOW,0);assert.deepEqual([fresh.age,fresh.refresh,fresh.stale],[3*86400,604800,false]);
 assert.doesNotMatch(D.fresh(fresh),/warn/);assert.match(D.fresh(fresh),/3 days/);
 const old=R.pageStatus({age:15*86400,refresh:604800,stale:true},NOW,0);assert.equal(old.stale,true);assert.match(D.fresh(old),/Out of date · 15 days/);
 assert.equal(R.pageStatus({age:3*86400,refresh:86400,stale:true},NOW,0).stale,true,'a server cadence wins');
 assert.equal(R.pageStatus(null,NOW,2).age,null);assert.match(D.fresh(R.pageStatus(null,NOW,2)),/Not reporting/);
});

test('map and ranked areas: quantile bins, lower-is-better flips, no data is hatched, the state scope lists its metros',()=>{
 const {DeckRE:R,DeckScope:S}=load();
 const m=R.mapModel(states,'score');assert.equal(m.items.length,states.length);assert.equal(m.edges.length,4);
 const best=m.items.reduce((x,y)=>(y.value>x.value?y:x));assert.equal(best.q,'5');
 const days=R.mapModel(states,'days'),fast=days.items.filter(x=>x.value!=null).reduce((x,y)=>(y.value<x.value?y:x));assert.equal(fast.q,'5','fewest days to sell is brightest');
 assert.equal(R.mapModel([{state:'CA',name:'California',h_score:null}].concat(states.slice(0,6)),'score').items[0].q,'x');
 const h=R.mapHtml(m,'CA');assert.match(h,/class="usmap"/);assert.match(h,/data-st="CA"[^>]*class|class="st on" data-st="CA"/);assert.match(h,/data-re-view-st="CA">View ZIPs/);
 const us=R.areasModel({kind:'us'},states,metros,'score');assert.equal(us.title,'States');assert.ok(us.rows.length<=10);
 assert.ok(us.rows[0].fig&&us.rows.every(r=>r.bar===Math.max(4,Math.round(+r.fig))),'a score bar is its value out of 100');
 const tx=R.areasModel({kind:'state',state:'TX'},states,metros,'yield');assert.equal(tx.title,'Metros in Texas');
 assert.ok(tx.rows.every(r=>S.metroStates(r.key).includes('TX')));
 assert.equal(R.areasModel({kind:'metro',metro:'x'},states,metros,'score'),null,'hidden in a metro scope');
 assert.equal(R.areasModel({kind:'mine'},states,metros,'score').title,'Metros in California');
});

test('Your markets: the owner\'s ZIPs in order with national values, then the counties, then the US',()=>{
 const {DeckRE:R}=load(),rows=R.mineModel(re,mine.rows,sum);
 const zips=re.market.residential.areas.filter(x=>x.level==='zip').map(x=>x.zip);
 assert.deepEqual(rows.filter(r=>r.zip).map(r=>r.zip),zips);
 assert.equal(rows[0].value,mine.rows.find(r=>r.zip==='92629').home_value,'92629 reads the blended national value');
 assert.equal(rows[rows.length-1].name,'United States');
 assert.ok(rows.some(r=>/County/.test(r.name)));
 const fb=R.mineModel(re,null,sum);assert.equal(fb[0].value,re.market.residential.areas[0].zhvi.value,'without national rows the feed value stands');
 const h=R.mineHtml(rows);assert.match(h,/data-open="zip" data-key="92629"/);assert.doesNotMatch(h,/ZHVI|as of/);
});

test('ZIP sheet 92629: headline, eleven sections in order, blended items with dots, missing names said once',()=>{
 const {DeckRE:R}=load(),z=R.zipModel(z92629,{summary:sum,prof:null,cat:new Map(fields.fields.map(f=>[f.name,f]))});
 assert.equal(z.state,'ok');assert.equal(z.title,'92629 Dana Point, CA');
 assert.equal(z.tiles.map(t=>t.label).join(),'Home value,1-yr change,Rent,Gross yield,Days to sell,30-yr rate,Price cuts,Inventory,Payment to income','the nine data points, in the owner\'s order');
 assert.equal(z.tiles.find(t=>t.key==='mortgage_rate').value,'7.11%','the national rate from the summary');
 const ids=z.sections.map(s=>s.id),order=['value','market','mf','people','jobs','schools','risk','costs','lending','grade','proforma','homes'];
 assert.deepEqual(ids,order.filter(i=>ids.includes(i)),'blueprint order');
 for(const i of ['value','market','people','grade','proforma','homes'])assert.ok(ids.includes(i),i);
 const val=z.sections.find(s=>s.id==='value');assert.ok(val.line&&val.line.series.length>1,'a value line');
 assert.ok(z.sections.find(s=>s.id==='market').items.find(x=>x.key==='days_on_market').conf);
 for(const s of z.sections){const names=s.missing;assert.equal(new Set(names).size,names.length);for(const it of s.items)assert.ok(!names.includes(it.label))}
 const body=R.zipBody(z,{find:''},NOW);
 assert.doesNotMatch(textOf(body),SOURCE_WORDS,'no source names in the sheet body');
 assert.match(body,/Not reported:/);assert.match(body,/data-sec="grade"/);
 for(const cell of body.match(/<td[^>]*>([\s\S]*?)<\/td>/g)||[])assert.match(cell,/data-l="/,'factor table cells carry card labels');
});

test('ZIP sheet, thin rural ZIP: sections without data are absent, never drawn as empty tiles',()=>{
 const {DeckRE:R}=load(),z=R.zipModel(rural,{summary:sum,cat:new Map()});
 assert.equal(z.state,'ok');
 assert.ok(!z.tiles.some(t=>t.value==null||t.value===''));
 assert.ok(!z.sections.some(s=>s.id==='proforma'),'no price or rent, no pro forma');
 for(const s of z.sections)if(!['grade','homes'].includes(s.id))assert.ok(s.items.length||s.line||(s.bars&&s.bars.length),s.id+' has something to show');
 const body=R.zipBody(z,{},NOW);assert.doesNotMatch(body,/<dd>\s*(\u00b7|--|No data)?\s*<\/dd>/,'no empty value rows (a real zero count is a value)');
 if(!z.score)assert.match(body,/Not enough data to score this ZIP\./);
 assert.equal(R.zipModel({error:'unknown zip'},{}).line,'No record for this ZIP.');
 assert.equal(R.zipModel({status:'not_reporting',reason:'x'},{}).line,'Real estate data is not reporting.');
 assert.equal(R.zipModel(null,{}).state,'bad');
});

test('pro forma: budget-driven amounts stay masked until Show amounts; the profile form saves fractions',()=>{
 const {DeckRE:R}=load(),prof={profile:{down_pct:0.2,closing_pct:0.03},budget:{rate:{rate_used:7}}};
 const pf=R.proForma(z92629,prof,sum);assert.ok(pf.noi>0&&pf.ads>0);
 const z=R.zipModel(z92629,{summary:sum,prof,cat:new Map()}),body=R.zipBody(z,{},NOW);
 const sec=body.slice(body.indexOf('data-sec="proforma"'));
 const ads=String(Math.round(pf.ads)),cash=D.fmt.money(Math.round(pf.cash_in));
 assert.ok(!sec.includes(cash),'cash in hidden');assert.match(sec,/data-money="show">Show amounts/);
 assert.match(sec,/5% vacancy \u00b7 40% costs \u00b7 7\.00% rate \u00b7 20% down/);
 assert.ok(!sec.includes(ads));
 assert.deepEqual(R.pfBody({down_pct:'25',income_annual:'',monthly_debt:'500'}).body,{down_pct:0.25,income_annual:null,monthly_debt:500});
 assert.equal(R.pfBody({monthly_debt:'lots'}).error,'Check monthly debt payments');
});

test('homes for sale: scope query, 12 a page, honest prices and dates, outside links only over https',()=>{
 const {DeckRE:R}=load();
 const q=qs(R.homesQuery({kind:'mine'},{type:'Condo',beds:2,q:' Dana Point '},12));
 assert.deepEqual([q.state,q.type,q.beds,q.q,q.limit,q.offset,q.sort],['CA','Condo','2','Dana Point','12','12','feed']);
 const r=R.homeRow({price:435000,currency:'USD',beds:1,baths:1,sqft:490,city:'Dana Point',type:'Condo',url:'https://example.test/x',listed_at:NOW/1000-3*86400},NOW);
 assert.equal(r.title,'$435K \u00b7 1 BR 1 BA');assert.match(r.sub,/490 SF \u00b7 \$888\/SF \u00b7 3 days listed/);
 assert.equal(R.homeRow({price:162,url:'http://x'},NOW).title,'Price not listed');
 assert.equal(R.homeRow({price:500000,url:'http://x'},NOW).url,'');
 assert.doesNotMatch(R.homeRow({price:500000,listed_at:NOW/1000+86400},NOW).sub,/listed/,'a future date is not a listing age');
 const bid=R.homeRow({price:70000,currency:'USD',sqft:957,beds:2,baths:1,city:'Lake Forest',type:'Condo',source:'auction.com',sale_kind:'Foreclosure auction',auction_at:'2027-01-11T17:00:00Z',url:'https://example.test/a'},NOW);
 assert.equal(bid.title,'Opening bid $70K \u00b7 2 BR 1 BA');assert.match(bid.sub,/Foreclosure auction/);assert.doesNotMatch(bid.sub,/\/SF/,'a starting bid is not a price per square foot');
});

test('homes for sale: the feed writes price_cut as the dollar amount cut, and any positive amount marks the row',()=>{
 const {DeckRE:R}=load();
 // live rows from Redfin and Zillow carry price_cut: 50000, never true
 assert.equal(R.homeRow({price:900000,source:'redfin',price_cut:50000},NOW).cut,true);
 assert.equal(R.homeRow({price:900000,price_cut:true},NOW).cut,true);
 for(const none of [null,0,undefined,false,'']){assert.equal(R.homeRow({price:900000,price_cut:none},NOW).cut,false,String(none))}
 const html=R.homesHtml({hf:{type:'',beds:0,q:''},homes:{ok:true,data:{total:1,rows:[]}},homeRows:[{price:900000,city:'Dana Point',source:'redfin',price_cut:50000,url:'https://example.test/c'}]},NOW);
 assert.match(html,/aria-label="Price cut"/);
});

test('homes for sale: a stale row says stale, a repeat counts once, and a partial list says how many of how many',()=>{
 const {DeckRE:R}=load();
 assert.match(R.homeRow({price:500000,city:'Dana Point',stale:true,url:'https://example.test/s'},NOW).sub,/stale/,'a row the collector could not refresh says stale');
 assert.doesNotMatch(R.homeRow({price:500000,city:'Dana Point',stale:false,url:'https://example.test/f'},NOW).sub,/stale/,'only stale === true counts');
 const h=(o)=>Object.assign({addr:'100 Fixture Dr',city:'Dana Point',price:1850000,beds:4,baths:2.5,sqft:2359,source:'redfin',url:'https://www.redfin.com/h/1'},o);
 const rows=[h(),h({source:'zillow',url:'https://www.zillow.com/h/1',price:1849000}),h({addr:'1 A St',url:'https://www.redfin.com/h/2'})];
 const html=R.homesHtml({hf:{type:'',beds:0,q:''},homes:{ok:true,data:{total:30,rows}},homeRows:rows},NOW);
 assert.equal((html.match(/class="frow"/g)||[]).length,2,'the same address from two sources is one row');
 assert.match(html,/Showing 2 of 30</,'a partial list says how many of how many');
 assert.match(html,/data-re-more="homes"/,'the server has more rows, so the button stays');
 const raw=Array.from({length:12},(_,i)=>h({addr:(100+i)+' B St',url:'https://www.redfin.com/h/b'+i}));
 const done=R.homesHtml({hf:{type:'',beds:0,q:''},homes:{ok:true,data:{total:12,rows:raw}},homeRows:raw},NOW);
 assert.doesNotMatch(done,/Showing/,'a list that shows everything has no count note');assert.doesNotMatch(done,/data-re-more/);
 const dup=raw.concat([h({addr:'100 B St',source:'zillow',url:'https://www.zillow.com/h/b0'})]);
 const dh=R.homesHtml({hf:{type:'',beds:0,q:''},homes:{ok:true,data:{total:13,rows:dup}},homeRows:dup},NOW);
 assert.equal((dh.match(/class="frow"/g)||[]).length,12,'the repeat is hidden');
 assert.doesNotMatch(dh,/data-re-more/,'nothing left to load once every server row is in hand: a hidden repeat is not a missing row');
 assert.doesNotMatch(dh,/Showing/);
});

test('homes for sale: the feed behind the list says out of date when it is stale, and says nothing when fresh',()=>{
 const {DeckRE:R}=load();
 const row={price:900000,city:'Dana Point',source:'redfin',listed_at:NOW/1000-7200,url:'https://example.test/o'};
 const page=(re)=>R.homesHtml({hf:{type:'',beds:0,q:''},homes:{ok:true,data:{total:1,rows:[row]}},homeRows:[row],re},NOW);
 assert.match(page({stale:true,age:3*86400,refresh:3600}),/re-stale[^>]*>Out of date · 3 days</,'a feed two refreshes old is out of date');
 assert.match(page({stale:true}),/Out of date</,'stale with no age still says so');
 assert.doesNotMatch(page({stale:false,age:600,refresh:3600}),/Out of date/,'a fresh feed carries no mark');
 assert.doesNotMatch(page(undefined),/Out of date/,'no feed read, no mark');
});

test('Data sheet: sources with coverage and plain dates, ZIP blends with parts and weights, method, setup',()=>{
 const {DeckRE:R}=load(),cat=new Map(fields.fields.map(f=>[f.name,f]));
 const keyed=sources.concat([{id:'x',name:'Key source',side:'residential',status:'needs_key',key_env:'X_KEY'}]);
 const d=R.dataModel({sources:keyed,summary:sum,cat,zip:z92629});
 assert.ok(d.sources.length>0&&d.sources.every(s=>s.name));
 assert.ok(!d.sources.some(s=>/commercial/i.test(s.side||'')),'commercial-only sources stay on Commercial');
 assert.ok(d.sources.every(s=>!/^\d{4}-\d{2}(-\d{2})?$/.test(s.asOf)),'dates read as Sep 2026, not ISO');
 const hv=d.blends.find(x=>x.label.startsWith((cat.get('home_value')||{}).label||'home value'));
 assert.ok(hv&&hv.parts.length===z92629.m.home_value.p.length&&hv.parts.every(p=>/%$/.test(p.weight)));
 assert.ok(d.method.some(m=>/higher is better|lower is better/.test(m[1])));
 assert.deepEqual(d.setup.map(s=>s.state),keyed.filter(s=>s.status==='needs_key').map(()=>'needs_key'));assert.ok(d.setup.length>=1);
 const page=R.dataModel({sources,summary:sum,cat,strip:R.stripModel(z92629,sum),where:'Dana Point'});
 assert.ok(page.blends.every(x=>x.parts.length===0),'page scope lists the strip\'s blended values');
});

test('the page: no source text anywhere, the scope as the strip caption, TV board of strip, map and eight ZIPs',()=>{
 const {DeckRE:R,DeckScope:S}=load();S.set({kind:'us'});
 const st={f:R.filtersLoad(),hf:{type:'',beds:0,q:''},sum,states,metros,rank:{ok:true,data:rank},rows:rank.rows,homes:{ok:true,data:{total:1,rows:re.homes}},homeRows:re.homes,
  re,mine:mine.rows,mapK:'score',sel:'',prof:null};
 const h=R.pageHtml(st,NOW),t=textOf(h);
 assert.doesNotMatch(t,SOURCE_WORDS,'source names, coverage and file names live in the Data sheet');
 assert.match(h,/<span>United States<\/span>/);
 for(const s of ['re-strip','re-map','re-areas','re-best','re-homes'])assert.match(h,new RegExp('class="sect '+s));
 assert.ok(h.indexOf('re-strip')<h.indexOf('re-map')&&h.indexOf('re-map')<h.indexOf('re-best'));
 assert.doesNotMatch(h,/re-mine/,'Your markets shows in its own scope only');
 const tv=R.pageHtml(Object.assign({},st,{tv:true}),NOW);
 assert.match(tv,/class="board re-board re-tv"/);assert.doesNotMatch(tv,/re-fbar|re-areas/,'no filters on TV');
 S.set({kind:'mine'});const mh=R.pageHtml(Object.assign({},st,{home:z92629}),NOW);
 assert.match(mh,/Your markets \u00b7 Dana Point/);assert.match(mh,/class="sect re-mine"/);
});

test('homes for sale: a tax-sale minimum bid is labelled a bid with no price per square foot, and a held sale says so',()=>{
 const {DeckRE:R}=load();
 const r=R.homeRow({price:43000,currency:'USD',sqft:900,city:'Santa Monica',type:'Condo',source:'la_ttc',kind:'Tax sale',sale_status:'held',url:'https://ttc.lacounty.gov/x'},NOW);
 assert.equal(r.title,'Minimum bid $43K');assert.doesNotMatch(r.sub,/\/SF/);assert.match(r.sub,/Tax sale/);assert.match(r.sub,/sale held/);
 assert.doesNotMatch(R.homeRow({price:500000,currency:'USD',city:'Dana Point',url:'https://example.test/n'},NOW).sub,/sale held/);
});
