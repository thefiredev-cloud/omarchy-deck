// Real estate > Residential, round "Better" PR b (lane DoEstate): a metric the national build rejected
// (m[k] = {v: null, reason, from}) reads with its reason in plain words on the ZIP sheet, its raw member rows never print their
// number, no history line sits beside it, list rows show the missing-value form, and a bar that is not a 0 to 100 score says
// its scale once. part=metrics (the members) is read when a ZIP sheet opens, never with the page.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const deck=fs.readFileSync(path.join(root,'static/deck.js'),'utf8');
const D=new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'),deck.indexOf('// ==== DECK V6 UI HELPERS END ===='))+'\nreturn DeckUI;')();
const REG=deck.slice(deck.indexOf('// ==== DECK PAGES REGISTRY BEGIN'),deck.indexOf('// ==== DECK PAGES REGISTRY END ===='));
const src=fs.readFileSync(path.join(root,'static/pages/realestate.js'),'utf8');
const store=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
const load=()=>new Function('localStorage','DeckUI',src+'\nreturn {DeckScope,DeckRE};')(store(),D);
const fx=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/realestate-page',p),'utf8'));
const sum=fx('summary.json'),states=fx('states.json').states,metros=fx('metros.json').metros,z92629=fx('zip-92629.json'),rank=fx('rank.json');
const text=h=>h.replace(/<[^>]*>/g,' ').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/\s+/g,' ');
const series=n=>Array.from({length:n},(_,i)=>['2025-'+String(i+1).padStart(2,'0'),40+i]);
const tick=ms=>new Promise(r=>setTimeout(r,ms||0));
// a ZIP whose days to sell the build rejected for too few listings (3 homes for sale), with the raw Realtor column still in the record
const rejected=()=>Object.assign({},z92629,{days_on_market:null,dom:9581,home_value:null,inventory:3,
 m:Object.assign({},z92629.m,{days_on_market:{v:null,reason:'too few listings'},home_value:{v:null,reason:'placeholder value'}}),
 hist:Object.assign({},z92629.hist,{redfin_dom:series(12),zhvi:series(12)})});
const MEMBERS=new Map([['redfin_dom','days_on_market'],['zillow_days_to_pending','days_on_market'],['dom','days_on_market'],['zhvi','home_value'],
 ['rent_zori','typical_rent'],['safmr_2br','typical_rent']]);
// the manifest's metrics[id].limits, as the live build wrote them (2026-11-15 17:30)
const LIMITS=new Map([['days_on_market',[{min_listings:5,reason:'too few listings',reason_unknown:'no listing count'},{min:0,max:365,reason:'out of range'}]],
 ['home_value',[{min:20000,reason:'placeholder value'}]],['typical_rent',[{max:20000,reason:'seasonal rentals'}]]]);

test('the Not reported line gives the build\'s reason in plain words; no history line beside it',()=>{
 const {DeckRE:R}=load(),z=R.zipModel(rejected(),{summary:sum,cat:new Map(),members:MEMBERS,limits:LIMITS});
 const mk=z.sections.find(s=>s.id==='market');
 assert.ok(mk.missing.includes('Days to sell (too few listings)'),mk.missing.join('|'));
 assert.equal(mk.line2,undefined,'no days to sell history beside its Not reported line');
 const val=z.sections.find(s=>s.id==='value');assert.equal(val&&val.line,undefined,'no home value history either');
 assert.deepEqual(z.headWhy,['Home value (placeholder value)','Days to sell (too few listings)'],'a missing data point is named under the strip, with the build\'s reason');
 const body=text(R.zipBody(z,{find:''},Date.now()));
 assert.match(body,/Not reported: [^.]*Days to sell \(too few listings\)/);assert.match(body,/Not reported: Home value \(placeholder value\)/);
});

test('a raw member row of a rejected metric shows the missing form with the metric\'s reason, never its raw number',()=>{
 const {DeckRE:R}=load();
 const z=R.zipModel(rejected(),{summary:sum,cat:new Map(),members:MEMBERS,limits:LIMITS}),mk=z.sections.find(s=>s.id==='market');
 assert.ok(!mk.items.some(x=>x.key==='dom'),'Days listed is not a row');assert.ok(mk.missing.includes('Days listed (too few listings)'));
 const body=text(R.zipBody(z,{find:''},Date.now()));assert.doesNotMatch(body,/9,581/);
 // without the members (part=metrics not read yet) the sheet still draws with what it has
 const bare=R.zipModel(rejected(),{summary:sum,cat:new Map()});assert.equal(bare.state,'ok');assert.ok(bare.sections.find(s=>s.id==='market'));
});

test('Your market\'s feed numbers that feed a rejected metric go to the line with its reason',()=>{
 const {DeckRE:R}=load(),re=fx('realestate.json'),area=R.areaByZip(re,'92629');assert.ok(area,'fixture has 92629 in Your markets');
 const plain=R.zipModel(z92629,{summary:sum,area}).sections.find(s=>s.id==='mine');
 const days=plain.area.items.find(x=>x.key==='days_to_pending');assert.ok(days,'the fixture shows a days item when nothing is rejected');
 const z=R.zipModel(rejected(),{summary:sum,area,members:MEMBERS,limits:LIMITS}),mine=z.sections.find(s=>s.id==='mine');
 assert.ok(!mine.area.items.some(x=>x.key==='days_to_pending'));assert.ok(mine.missing.includes(days.label+' (too few listings)'),mine.missing.join('|'));
 assert.ok(mine.area.items.some(x=>x.key==='sale_price'),'a sane sale price beside a rejected home value keeps its number');
});

test('a member whose own value is sane keeps its number: 11930 hides the Zillow rent with its reason and shows HUD\'s',()=>{
 const {DeckRE:R}=load();
 const rec=Object.assign({},z92629,{zip:'11930',city:'Amagansett',state:'NY',typical_rent:null,gross_yield:null,rent_zori:103750,safmr_2br:3270,
  m:Object.assign({},z92629.m,{typical_rent:{v:null,reason:'seasonal rentals'},gross_yield:{v:null,reason:'seasonal rentals',from:'typical_rent'}})});
 const z=R.zipModel(rec,{summary:sum,cat:new Map(),members:MEMBERS,limits:LIMITS}),val=z.sections.find(s=>s.id==='value');
 assert.deepEqual(z.headWhy,['Rent (seasonal rentals)','Gross yield (seasonal rentals)'],'the Zillow rent is hidden with its reason');
 assert.deepEqual(val.items.find(x=>x.key==='safmr_2br'),{key:'safmr_2br',label:'Fair market rent, 2 BR',value:'$3,270/mo',conf:null},'HUD keeps its number');
 assert.ok(!val.missing.some(x=>/Fair market rent/.test(x)));
 // the member named in `from`, or one over the limit, is hidden with the reason
 const it=list=>R.zipModel(Object.assign({},rec,{m:Object.assign({},rec.m,{typical_rent:{v:null,reason:'seasonal rentals',from:'safmr_2br'}})}),{members:MEMBERS,limits:LIMITS}).sections.find(s=>s.id==='value');
 assert.ok(it().missing.includes('Fair market rent, 2 BR (seasonal rentals)'),'the from input');
 const over=R.zipModel(Object.assign({},rec,{safmr_2br:25000}),{members:MEMBERS,limits:LIMITS}).sections.find(s=>s.id==='value');
 assert.ok(over.missing.includes('Fair market rent, 2 BR (seasonal rentals)'),'over the limit');
});

test('a rental grade factor that arrives null with a reason prints the missing form with it, never the raw column',()=>{
 const {DeckRE:R}=load(),summary=Object.assign({},sum,{grade_method:{factors:[{key:'rent_to_income',weight:.1},{key:'renter_share',weight:.15}]}});
 const rec=Object.assign({},z92629,{area_grade:'D',rent_to_income:1010.1,grade_parts:{rent_to_income:{value:null,points:null,weight:.1,reason:'seasonal rentals'},renter_share:{value:17.43,points:0,weight:.15}}});
 const z=R.zipModel(rec,{summary,cat:new Map()}),g=z.sections.find(s=>s.id==='grade');
 assert.equal(g.factors[0].value,null);assert.equal(g.factors[0].why,'seasonal rentals');
 const body=text(R.zipBody(z,{find:''},Date.now()));assert.match(body,/No data \(seasonal rentals\)/);assert.doesNotMatch(body,/1,010|1010/);
 assert.match(body,/17\.4/,'a factor with a value keeps it');
});

test('only the build\'s five reasons print; anything else is a plain missing and never reaches the page',()=>{
 const {DeckRE:R}=load();
 for(const why of ['too few listings','no listing count','placeholder value','seasonal rentals','out of range']){
  const rec=Object.assign({},z92629,{days_on_market:null,m:{days_on_market:{v:null,reason:why}}});
  assert.ok(R.zipModel(rec,{}).sections.find(s=>s.id==='market').missing.includes('Days to sell ('+why+')'),why)}
 const odd=Object.assign({},z92629,{days_on_market:null,m:{days_on_market:{v:null,reason:'<img src=x onerror=__X>'}}});
 const mk=R.zipModel(odd,{}).sections.find(s=>s.id==='market');assert.ok(mk.missing.includes('Days to sell'));assert.doesNotMatch(mk.missing.join(),/img/);
 // a record without m (older data) keeps its history lines
 const old=Object.assign({},z92629,{m:undefined,days_on_market:null,hist:{redfin_dom:series(6)}});
 assert.ok(R.zipModel(old,{}).sections.find(s=>s.id==='market').line2,'no m, no rule');
});

test('a list row shows the missing-value form for a rejected metric, never the raw column',()=>{
 const {DeckRE:R}=load(),row=Object.assign({},rank.rows[0],{days_on_market:null,dom:9581,home_value:null,price:1});
 for(const k of ['days','value']){const h=R.cellHtml(row,{key:k},true,1);assert.match(h,/^<span class="na re-na" title="[^"]+: not reported for this ZIP\. Open the ZIP to see why\." aria-label="[^"]+">-<\/span>$/,k);assert.doesNotMatch(h,/9581|9,581|\$1\b/)}
 const mine=R.mineModel({market:{residential:{areas:[{level:'zip',zip:'92629',name:'Dana Point',days_on_market:9581}]}}},[Object.assign({},row,{zip:'92629'})],null);
 assert.equal(mine[0].days,null,'Your markets reads the national row, not the feed column, when the row exists');
 assert.doesNotMatch(R.mineHtml(mine),/9581|9,581/);
 // without its national row the feed's own Realtor number reads as what it is: days listed, never days to sell
 const fb=R.mineModel({market:{residential:{areas:[{level:'zip',zip:'92629',name:'Dana Point',days_on_market:68}]}}},null,null);
 assert.equal(fb[0].daysWord,'days listed');assert.match(R.mineHtml(fb),/68\u00a0days\u00a0listed/);assert.doesNotMatch(R.mineHtml(fb),/days to sell|days\u00a0to\u00a0sell/);
});

test('the first open paints the designed loading state at once, never a blank page while the server is slow',()=>{
 const P=new Function('fetch','AbortController','setTimeout','clearTimeout','DeckUI',REG+'\nreturn DeckPages;')(()=>new Promise(()=>{}),AbortController,()=>0,()=>{},D);
 const doc={activeElement:null,addEventListener(){},querySelectorAll:()=>[],getElementById:()=>null};
 const el={html:'',set innerHTML(v){this.html=v},get innerHTML(){return this.html},contains:()=>false,querySelector:()=>null};
 const mod=new Function('localStorage','DeckUI','DeckPages','document','fetch',src+'\nreturn {DeckRE};')(store(),D,P,doc,()=>new Promise(()=>{}));
 const marks=[],pact={querySelector:()=>null,insertAdjacentHTML:(w,h)=>marks.push(h)},head={querySelector:s=>s==='.pact'?pact:null};
 mod.DeckRE.page.show({el,head,tv:false,cls:'P'});
 assert.match(el.html,/re-board/);assert.match(el.html,/skel/);assert.match(el.html,/Best ZIPs/);assert.match(el.html,/aria-busy="true"/);
 assert.deepEqual(marks,[],'unknown is not down: no freshness mark before the first answers');
 mod.DeckRE.page.hide();
});

test('a bar that is not a 0 to 100 score states its scale once, in the list head',()=>{
 const {DeckRE:R}=load();
 const y=R.areasModel({kind:'us'},states,metros,'yield');assert.match(R.areasHtml(y),/class="act">Gross yield \u00b7 bars 0 to [\d.]+%<\/span>/);
 assert.equal((R.areasHtml(y).match(/bars 0 to/g)||[]).length,1,'once, not per row');
 assert.match(R.areasHtml(R.areasModel({kind:'us'},states,metros,'days')),/Days to sell \u00b7 bars 0 to \d+ days/);
 assert.match(R.areasHtml(R.areasModel({kind:'us'},states,metros,'score')),/class="act">Score<\/span>/,'a score needs no scale words');
});

test('part=metrics is read when a ZIP sheet opens, never when the page opens',async()=>{
 const seen=[],L={};
 const answer=u=>u.includes('part=metrics')?{metrics:{days_on_market:{members:['redfin_dom','dom']}}}:u.includes('part=states')?{states}:u.includes('part=summary')?sum:
  u.includes('/rank')?rank:u.includes('/zip/')?rejected():u.includes('/homes')?{total:0,rows:[]}:{};
 const fetch=u=>{seen.push(u);return Promise.resolve({ok:true,status:200,json:async()=>answer(u)})};
 const P=new Function('fetch','AbortController','setTimeout','clearTimeout','DeckUI',REG+'\nreturn DeckPages;')(fetch,AbortController,setTimeout,clearTimeout,D);
 const doc={activeElement:null,addEventListener:(t,f)=>{(L[t]=L[t]||[]).push(f)},querySelectorAll:()=>[],getElementById:()=>null};
 const el={html:'',set innerHTML(v){this.html=v},get innerHTML(){return this.html},contains:()=>true,querySelector:()=>null};
 const mod=new Function('localStorage','DeckUI','DeckPages','document','fetch',src+'\nreturn {DeckRE};')(store(),D,P,doc,fetch);
 mod.DeckRE.page.show({el,head:null,tv:false,cls:'D'});for(let i=0;i<30;i++)await new Promise(r=>setTimeout(r,5));
 assert.ok(!seen.some(u=>u.includes('part=metrics')),'not on open');
 (L.click||[]).forEach(f=>f({target:{closest:s=>s==='[data-open="zip"]'?{dataset:{key:'92629'}}:null}}));
 for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(seen.filter(u=>u.includes('part=metrics')).length,1,'once, when the sheet opens');
 mod.DeckRE.page.hide();
});

test('part=metrics failing: no raw member figure beside the rejection, one plain line with Try again, and Try again reads it',async()=>{
 const L={};let metricsOk=false;const sheetBody={innerHTML:''};
 const answer=u=>u.includes('part=metrics')?{metrics:{days_on_market:{members:['redfin_dom','dom'],limits:[{min_listings:5,reason:'too few listings'}]}}}:u.includes('part=states')?{states}:
  u.includes('part=summary')?sum:u.includes('/rank')?rank:u.includes('/zip/')?rejected():u.includes('/homes')?{total:0,rows:[]}:{};
 const fetch=u=>{const bad=u.includes('part=metrics')&&!metricsOk;return Promise.resolve({ok:!bad,status:bad?500:200,json:async()=>bad?{error:'boom'}:answer(u)})};
 const P=new Function('fetch','AbortController','setTimeout','clearTimeout','DeckUI',REG+'\nreturn DeckPages;')(fetch,AbortController,setTimeout,clearTimeout,D);
 const doc={activeElement:null,addEventListener:(t,f)=>{(L[t]=L[t]||[]).push(f)},querySelectorAll:()=>[],getElementById:()=>null};
 const el={html:'',set innerHTML(v){this.html=v},get innerHTML(){return this.html},contains:()=>true,querySelector:()=>null};
 const dlg={isConnected:true,open:true,querySelector:s=>s==='.sheet-b'?sheetBody:null,contains:()=>false};
 const DeckShell={sheet:{open:o=>{sheetBody.innerHTML=o.body||'';return dlg},close(){}}};
 const mod=new Function('localStorage','DeckUI','DeckPages','document','fetch','DeckShell',src+'\nreturn {DeckRE};')(store(),D,P,doc,fetch,DeckShell);
 const tap=sel=>(L.click||[]).forEach(f=>f({target:{closest:s=>s===sel?{dataset:{key:'92629'}}:null}}));
 mod.DeckRE.page.show({el,head:null,tv:false,cls:'D'});for(let i=0;i<20;i++)await tick(5);
 tap('[data-open="zip"]');for(let i=0;i<40&&!/Not reported/.test(sheetBody.innerHTML);i++)await tick(10);
 const failed=text(sheetBody.innerHTML);
 assert.match(failed,/Could not load the detail behind a rejected figure\. Try again/);assert.match(sheetBody.innerHTML,/data-re-members>Try again/);
 assert.match(failed,/Days listed \(too few listings\)/,'the static member map hides the raw figure');assert.doesNotMatch(failed,/9,581/);
 metricsOk=true;tap('[data-re-members]');for(let i=0;i<20;i++)await tick(10);
 const ok=text(sheetBody.innerHTML);assert.doesNotMatch(ok,/Could not load the detail/);assert.doesNotMatch(ok,/9,581/);
 mod.DeckRE.page.hide();
});
