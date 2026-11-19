// Real estate > Residential, round "Better" (2026-11-15, lane DoEstate): bars that mean a value (SeeViz V1), plain risk meters
// (V16), Best ZIPs under the strip on P and L (G8), suggestions under "ZIP or city" (F4), a filter row that keeps focus through a
// repaint (F13), the 1.3 MB metros list read only when it is needed (SeePerf P1) and Max price and Sort on Homes for sale (L13).
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
const css=fs.readFileSync(path.join(root,'static/css/realestate.css'),'utf8');
const store=init=>{const m=new Map(Object.entries(init||{}));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
const load=ls=>new Function('localStorage','DeckUI',src+'\nreturn {DeckScope,DeckRE};')(ls||store(),D);
const fx=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/realestate-page',p),'utf8'));
const sum=fx('summary.json'),states=fx('states.json').states,metros=fx('metros.json').metros,fields=fx('fields.json'),rank=fx('rank.json'),
 z92629=fx('zip-92629.json'),re=fx('realestate.json'),mine=fx('rank-mine.json'),sources=fx('sources.json').sources;
const qs=s=>Object.fromEntries(s.split('&').map(p=>p.split('=').map(decodeURIComponent)));
const tick=ms=>new Promise(r=>setTimeout(r,ms||0));

test('V1: ranked bars run from zero, a score out of 100; 52 against 44 reads 52% against 44%, never full against a sliver',()=>{
 const {DeckRE:R}=load();
 const rows=[['AA',52],['BB',47],['CC',44]].map(([st,v])=>({state:st,name:st,h_score:v,gross_yield:v/10,value_trend_1y:v-50}));
 const m=R.areasModel({kind:'us'},rows,undefined,'score');
 assert.deepEqual(m.rows.map(r=>r.bar),[52,47,44]);assert.equal(m.scale,100);
 const h=R.areasHtml(m);assert.match(h,/data-max="100"><i style="--v:52%">/);assert.match(h,/--v:44%/);
 // other metrics run from zero to the largest value in the list; a value at or under zero draws no bar
 assert.deepEqual(R.areasModel({kind:'us'},rows,undefined,'yield').rows.map(r=>r.bar),[100,90,85]);
 const chg=R.areasModel({kind:'us'},rows,undefined,'value_1y');assert.equal(chg.rows.find(r=>r.key==='CC').bar,0);
 // metro names read short on one line; the full name is the row's title
 const ca=R.areasModel({kind:'mine'},states,metros,'score');assert.equal(ca.title,'Metros in California');
 const long=ca.rows.find(r=>/-/.test(r.full));assert.ok(long,'a hyphenated metro in the list');
 assert.equal(long.name,long.full.split(', ')[0].split('-')[0]+', CA');
 assert.ok(R.areasHtml(ca).includes('title="'+long.full+'"><span class="rank-n">'+long.n+'</span><span class="rank-t"><b>'+long.name+'</b>'));
});

test('P1 page side: the Metros list holds its place while the metros are unread, and says so in that section when they fail',()=>{
 const {DeckRE:R}=load();
 const wait=R.areasModel({kind:'mine'},states,undefined,'score');assert.equal(wait.loading,true);
 const h=R.areasHtml(wait);assert.match(h,/class="sect re-areas" aria-busy="true"/);assert.match(h,/Metros in California/);
 assert.equal((h.match(/class="rank-row re-ph"/g)||[]).length,R.AREA_ROWS,'ten rows of the real row shape');assert.doesNotMatch(h,/data-re-area/);
 const bad=R.areasHtml(R.areasModel({kind:'state',state:'TX'},states,null,'score'));
 assert.match(bad,/Metros in Texas/);assert.match(bad,/Metros are not reporting\./);assert.doesNotMatch(bad,/aria-busy/);
 assert.equal(R.areasModel({kind:'us'},null,undefined,'score'),null,'the States list needs the states, which every load reads');
 // the board names the areas block from the first paint, so the layout does not change when the list lands
 R.filtersLoad();const st={f:R.filtersLoad(),hf:{type:'',beds:0,q:''},sum,states,metros:undefined,rank:null,rows:[],homes:null,homeRows:[],re,mine:mine.rows,mapK:'score',sel:'',prof:null};
 assert.match(R.boardHtml(st,Date.now()),/class="re-board re-w-areas re-w-mine"/);
});

test('V16: each hazard is a plain 0 to 100 meter with its value named; no invented band or median tick',()=>{
 const {DeckRE:R}=load();
 const z=R.zipModel(Object.assign({},z92629,{nri_flood_score:96.4,nri_heat_score:12}),{summary:sum,cat:new Map()});
 const body=R.zipBody(z,{find:''},Date.now()),risk=body.slice(body.indexOf('data-sec="risk"'));
 assert.match(risk,/<span>Flood <b>96<\/b><\/span><span class="bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="96" aria-label="Flood risk 96 of 100"><i style="--v:96%">/);
 assert.match(risk,/Heat <b>12<\/b>/);
 assert.doesNotMatch(risk.slice(0,risk.indexOf('</section>')),/class="band"|class="med"|--q1|--md/);
 assert.equal((risk.slice(0,risk.indexOf('</section>')).match(/class="range-l"/g)||[]).length,1,'one 0 and 100 scale under the bars');
 // a value outside 0 to 100 is no score: "No data" and no bar, never a bar moved to a bound (decision 9)
 const odd=R.riskHtml([{label:'Flood',v:140},{label:'Fire',v:-3},{label:'Heat',v:100}]);
 assert.match(odd,/<span>Flood <b>No data<\/b><\/span><span><\/span>/);assert.match(odd,/<span>Fire <b>No data<\/b><\/span><span><\/span>/);
 assert.doesNotMatch(odd,/aria-valuenow="(0|100)"[^>]*aria-label="(Flood|Fire)/);assert.equal((odd.match(/role="meter"/g)||[]).length,1,'only the in-range value draws');
 assert.match(odd,/Heat <b>100<\/b>/);
});

test('G8: on P and L Best ZIPs comes right after the market strip, the map after it',()=>{
 const p=css.slice(css.indexOf('@media (max-width:599px){\n  .re-cols>.re-col'));
 const order=k=>+(p.match(new RegExp('\\.re-'+k+'\\{order:(\\d)\\}'))||[])[1];
 assert.ok(order('best')<order('map')&&order('map')<order('areas'),'P: best, map, areas');
 const l=css.slice(css.indexOf('@media (min-width:600px) and (max-height:499px){\n  .re-board{'));
 for(const v of ['re-board{','re-board.re-w-areas{','re-board.re-w-mine{','re-board.re-w-areas.re-w-mine{']){
  const t=l.slice(l.indexOf(v)).match(/grid-template-areas:([^;}]+)/)[1];assert.match(t,/^"strip map" "best best"/,v)}
});

test('L13: Homes for sale gains Max price (public steps, never a typed amount) and Sort; the query carries both',()=>{
 const {DeckRE:R}=load();
 const q=qs(R.homesQuery({kind:'mine'},{type:'Condo',beds:3,q:'',max:1500000,sort:'price'},12));
 assert.equal(q.max_price,'1500000');assert.equal(q.sort,'price');assert.equal(q.offset,'12');assert.equal(q.type,'Condo');
 assert.equal(qs(R.homesQuery({kind:'mine'},{sort:'bogus',max:0},0)).sort,'feed');assert.equal(qs(R.homesQuery({kind:'mine'},{max:0},0)).max_price,undefined);
 const h=R.homesHtml({hf:{type:'',beds:0,q:'',max:1000000,sort:'newest'},homes:null,homeRows:[]},Date.now());
 assert.match(h,/<label class="field re-hsel">Max price<select data-re-hmax>/);assert.match(h,/<option value="1000000" selected>\$1M</);
 assert.match(h,/<label class="field re-hsel">Sort<select data-re-hsort>/);assert.match(h,/<option value="newest" selected>Newest</);
 assert.doesNotMatch(h,/<input[^>]*data-re-hmax/,'no typed amount');
 const none=R.homesHtml({hf:{type:'',beds:0,q:'',max:500000,sort:'feed'},homes:{ok:true,data:{total:0,rows:[]}},homeRows:[]},Date.now());
 assert.match(none,/No homes match\. Loosen a filter\./);
});

// a small document: listeners by type, one search field, the suggestion box made by createElement
function fakeDoc(){const L={},made={};const doc={activeElement:null,body:{appendChild:e=>{made[e.id]=e}},
 addEventListener:(t,f)=>{(L[t]=L[t]||[]).push(f)},querySelectorAll:()=>[],getElementById:id=>made[id]||null,
 createElement:()=>({style:{},attrs:{},hidden:false,innerHTML:'',setAttribute(k,v){this.attrs[k]=v}}),
 fire:(t,ev)=>(L[t]||[]).forEach(f=>f(ev)),made};return doc}
function field(doc,value){const attrs={};const el={value,isConnected:true,attrs,dataset:{scopeQ:''},matches:s=>s==='input[data-scope-q]'||s==='input,select,textarea',
 closest:()=>({getBoundingClientRect:()=>({left:16,bottom:120,width:398})}),getBoundingClientRect:()=>({left:16,bottom:120,width:398}),
 setAttribute:(k,v)=>{attrs[k]=v},removeAttribute:k=>{delete attrs[k]},setCustomValidity(){},reportValidity(){}};doc.activeElement=el;return el}
const key=(t,k)=>({target:t,key:k,preventDefault(){},stopPropagation(){}});

test('F4: typing in "ZIP or city" lists up to five ZIPs under the field; Enter or a tap opens the ZIP sheet',async()=>{
 const doc=fakeDoc();
 const S=new Function('localStorage','DeckUI','document','innerWidth','scrollX','scrollY',src+'\nreturn DeckScope;')(store(),D,doc,430,0,0);
 assert.match(S.searchBox(),/role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="re-sugg"/);
 assert.equal(S.suggestQuery('926'),'926');assert.equal(S.suggestQuery(' dana  point '),'dana point');assert.equal(S.suggestQuery('92'),null);assert.equal(S.suggestQuery('9a'),null);
 const bad='<img src=x onerror=__X>',h=S.suggestHtml([{zip:bad,place:bad,score:bad}],0);
 assert.doesNotMatch(h,/<img|onerror=__X>/);assert.match(h,/data-sugg-zip="&lt;img src=x onerror=__X&gt;"/,'attributes go through esc too');
 assert.equal(S.suggestRows([{zip:bad,city:'X'},{zip:'92629',city:bad,state:'CA',h_score:57.4}]).length,1,'a row whose ZIP is not five digits is dropped');
 const asked=[],opened=[],many=Array.from({length:8},(_,i)=>Object.assign({},rank.rows[0],{zip:String(92620+i),city:'Town '+i,state:'CA',h_score:60-i}));
 S.mount({},{onZip:(z,o)=>opened.push(z),onCity:()=>{},suggest:q=>{asked.push(q);return Promise.resolve(many)}});
 const t=field(doc,'926');doc.fire('input',{target:t});await tick(220);
 assert.deepEqual(asked,['926']);
 const box=doc.made['re-sugg'];assert.ok(box&&!box.hidden,'the list shows');
 assert.equal((box.innerHTML.match(/role="option"/g)||[]).length,5,'five at most');
 assert.match(box.innerHTML,new RegExp('data-sugg-zip="'+many[0].zip+'"><b>'+many[0].zip+'</b><span>'));
 assert.equal(t.attrs['aria-expanded'],'true');assert.equal(box.style.top,'124px');
 // Enter on a three-digit prefix opens the first match; ArrowDown then Enter opens the marked one
 doc.fire('keydown',key(t,'Enter'));assert.deepEqual(opened,[many[0].zip]);assert.ok(box.hidden,'opening closes the list');
 doc.fire('input',{target:t});await tick(220);doc.fire('keydown',key(t,'ArrowDown'));doc.fire('keydown',key(t,'ArrowDown'));
 assert.equal(t.attrs['aria-activedescendant'],'re-sugg-1');doc.fire('keydown',key(t,'Enter'));assert.equal(opened[1],many[1].zip);
 // a tap on a row opens it
 doc.fire('input',{target:t});await tick(220);
 doc.fire('click',{target:{closest:s=>s==='[data-sugg-zip]'?{dataset:{suggZip:many[2].zip}}:null}});assert.equal(opened[2],many[2].zip);
 // nothing matches: one quiet line; a failed read closes the list
 S.mount({},{onZip:()=>{},suggest:()=>Promise.resolve([])});doc.fire('input',{target:t});await tick(220);assert.match(box.innerHTML,/No ZIP matches\./);
 S.mount({},{onZip:()=>{},suggest:()=>Promise.resolve(null)});doc.fire('input',{target:t});await tick(220);assert.ok(box.hidden);
});

test('F13: a repaint while a field in the filter row has focus replaces only the board; the row and its field stay',()=>{
 const doc=fakeDoc();
 const {DeckRE:R}=new Function('localStorage','DeckUI','document',src+'\nreturn {DeckScope,DeckRE};')(store(),D,doc);
 const t=field(doc,'926'),main={innerHTML:''},bar={contains:a=>a===t,querySelector:()=>null};let pageWrites=0,html='';
 const el={contains:()=>true,querySelector:s=>s==='.re-main'?main:s==='.re-fbar'?bar:null,set innerHTML(v){pageWrites++;html=v},get innerHTML(){return html}};
 Object.assign(R._S,{ctx:{el,head:null,cls:'P'},f:R.filtersLoad(),sum,states,rank:{ok:true,data:rank},rows:rank.rows,re});
 R._paint();assert.equal(pageWrites,0,'the row with the focused field is not rebuilt');assert.match(main.innerHTML,/re-board/);assert.equal(R._S.barStale,true);
 doc.activeElement=null;R._paint();assert.equal(pageWrites,1,'without focus in it the whole page repaints');assert.equal(R._S.barStale,false);
 assert.equal(R.barHeld(bar,{matches:()=>false}),false,'a button in the row does not hold it');
});

test('P1: the default scope reads states for the map but never the metros until the list nears the screen; a state scope reads them at once',async()=>{
 const answer=u=>u.includes('part=metros')?{metros}:u.includes('part=states')?{states}:u.includes('part=summary')?sum:u.includes('part=sources')?{sources}:
  u.includes('/fields')?fields:u.includes('/rank')?(u.includes('zip=')?mine:rank):u.includes('/zip/')?z92629:u.includes('/homes')?{total:0,rows:[]}:u.endsWith('/realestate')?re:{};
 async function run(ls,failMetros){const seen=[];let io=null;
  const fetch=u=>{seen.push(u);const bad=failMetros&&u.includes('part=metros');return Promise.resolve({ok:!bad,status:bad?500:200,json:async()=>bad?{error:'boom'}:answer(u)})};
  const P=new Function('fetch','AbortController','setTimeout','clearTimeout','DeckUI',REG+'\nreturn DeckPages;')(fetch,AbortController,setTimeout,clearTimeout,D);
  const IO=function(cb,o){io={cb,o,el:null};this.observe=e=>{io.el=e};this.disconnect=()=>{}};
  const doc={activeElement:null,addEventListener(){},querySelectorAll:()=>[],getElementById:()=>null};
  const el={html:'',set innerHTML(v){this.html=v},get innerHTML(){return this.html},contains:()=>false,
   querySelector(s){return s==='.re-areas[aria-busy="true"]'&&/class="sect re-areas" aria-busy="true"/.test(this.html)?{busy:true}:null}};
  const mod=new Function('localStorage','DeckUI','DeckPages','document','fetch','IntersectionObserver',src+'\nreturn {DeckRE,DeckScope};')(ls,D,P,doc,fetch,IO);
  mod.DeckRE.page.show({el,head:null,tv:false,cls:'D'});for(let i=0;i<40;i++)await tick(5);
  return {seen,el,io:()=>io,mod}}
 const a=await run(store());
 assert.ok(a.seen.some(u=>u.includes('part=states')),'the map still reads the states');
 assert.ok(!a.seen.some(u=>u.includes('part=metros')),'no metros on open');
 assert.match(a.el.html,/class="usmap"/,'the map and its legend draw');assert.match(a.el.html,/aria-busy="true"/);
 assert.equal(a.io().o.rootMargin,'100% 0px 100% 0px','asks one screen before the list is in view');
 a.io().cb([{isIntersecting:true}]);for(let i=0;i<20;i++)await tick(5);
 assert.equal(a.seen.filter(u=>u.includes('part=metros')).length,1);assert.match(a.el.html,/data-re-area="metro"/);assert.doesNotMatch(a.el.html,/aria-busy="true"/);
 a.mod.DeckRE.page.hide();
 const b=await run(store({'re:scope':JSON.stringify({kind:'state',state:'TX'})}));
 assert.equal(b.seen.filter(u=>u.includes('part=metros')).length,1,'a state scope reads them at once');b.mod.DeckRE.page.hide();
 const c=await run(store(),true);c.io().cb([{isIntersecting:true}]);for(let i=0;i<20;i++)await tick(5);
 assert.match(c.el.html,/Metros are not reporting\./);assert.match(c.el.html,/class="usmap"/);assert.match(c.el.html,/re-best/,'the rest of the page stands');
 c.mod.DeckRE.page.hide();
});
