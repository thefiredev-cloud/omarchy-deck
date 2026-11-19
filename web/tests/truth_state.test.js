// Real page models and loaders, with synthetic answers only. No network or amounts are cached by the registry.
require('./setup-core.js');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const deck=read('static/deck.js'),re=read('static/pages/realestate.js'),shop=read('static/pages/shop.js'),cre=read('static/cre.js');
const block=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b));
const helpers=block(deck,'// ==== DECK V6 UI HELPERS BEGIN','// ==== DECK V6 UI HELPERS END ===='),registry=block(deck,'// ==== DECK PAGES REGISTRY BEGIN','// ==== DECK PAGES REGISTRY END ====');
const D=new Function(helpers+';return DeckUI;')();
const fixture=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/realestate-page',p),'utf8'));
const settle=async()=>{for(let i=0;i<50;i++)await new Promise(r=>setImmediate(r))};
function sandbox(answer){
 const listeners={},el={innerHTML:'',querySelector:()=>null,contains:()=>true,addEventListener(){}},marks=[];
 const doc={hidden:false,activeElement:null,documentElement:{dataset:{dc:'P'},classList:{contains:()=>false}},querySelectorAll:()=>[],getElementById:()=>null,addEventListener:(k,f)=>{(listeners[k]??=[]).push(f)},dispatchEvent(){},body:{appendChild(){}},createElement:()=>({})};
 const ctx={DeckCore,DeckUI:D,document:doc,console,Date,Promise,Map,Set,WeakMap,URLSearchParams,AbortController,encodeURIComponent,decodeURIComponent,
  setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,addEventListener(){},localStorage:{getItem:()=>null,setItem(){}},innerWidth:430,innerHeight:932,
  fetch:async url=>{const a=await answer(String(url).replace(/^\/api\//,''));if(a instanceof Error)throw a;const status=a&&a.http||200;return {ok:status<400,status,json:async()=>a,text:async()=>JSON.stringify(a),headers:{get:()=>null}}}};
 vm.createContext(ctx);vm.runInContext(registry+';this.DeckPages=DeckPages;',ctx);ctx.DeckPages.mark=(c,o)=>marks.push(o);
 return {ctx,el,marks,listeners};
}
const residential=p=>p==='housing/profile'?{}:p.startsWith('housing/national?part=summary')?fixture('summary.json'):p==='housing/national?part=states'?fixture('states.json'):p==='housing/national?part=sources'?fixture('sources.json'):p==='housing/fields'?fixture('fields.json'):p.startsWith('housing/rank?')?fixture('rank.json'):p==='realestate'?fixture('realestate.json'):{rows:[],total:0};
test('E1: a missing homes feed is failed, never an empty market under a clean mark',async()=>{
 const s=sandbox(p=>p.startsWith('realestate/homes?')?{status:'not_reporting',rows:[],reason:'missing'}:residential(p));
 vm.runInContext(re+';this.RE=DeckRE;this.Scope=DeckScope;',s.ctx);s.ctx.Scope.set({kind:'us'});s.ctx.RE.page.show({el:s.el,cls:'P'});await settle();
 assert.match(s.el.innerHTML,/Homes for sale are not reporting/);assert.doesNotMatch(s.el.innerHTML,/No homes for sale tracked here yet/);
 assert.ok(s.marks.at(-1).missing>0);
});
test('E2: a broken market feed preserves the Shop sections that answered and names the broken part',async()=>{
 const f=require('./shop_fixture.cjs')(),s=sandbox(p=>p==='ecom-market'?{status:'not_reporting'}:p==='ecom'?f.ecom:p==='listings'?f.listings:{watch:[],deals:[]});
 vm.runInContext(shop,s.ctx);await s.ctx.DeckPages.page('shop/market').show({el:s.el,cls:'P'});await settle();
 assert.match(s.el.innerHTML,/Market prices are not reporting/);for(const k of ['s-local','s-deal','s-lst'])assert.match(s.el.innerHTML,new RegExp(k));
});
function money(answer){const s=sandbox(answer);Object.assign(s.ctx,{bfetch:s.ctx.fetch,once:(_k,fn)=>fn(),renderFail:()=>'',buzz(){},tvArm:()=>false});
 const glue=block(deck,'// ---- Money > Accounts (route money/accounts).','// called by app.js when a page comes on screen');
 vm.runInContext(glue+';this.moneyLoad=v9Money;this.moneyState=FIN;this.moneyCtl=FINC;',s.ctx);s.ctx.moneyState.ctx={el:s.el,route:'money/accounts'};return s;}
const finance={t:1794790000,refresh:300,apps:[{id:'bank',name:'Test bank',kind:'bank',status:'ok',last_ok:1794790000,has_values:true},{id:'card',name:'Test card',kind:'payments',sense:'liability',status:'ok',has_values:true}],has_totals:true};
for(const [mode,failure] of [['HTTP error',{http:500}],['offline',new Error('offline')],['wrong shape',{apps:'wrong'}]]){
test('E13: '+mode+' keeps only the masked Accounts structure, with last-read words and retry',async()=>{
 let failed=false;const s=money(()=>failed?failure:finance);await s.ctx.moneyLoad();failed=true;await s.ctx.moneyLoad();
 const h=s.el.innerHTML;for(const label of ['Assets','Owed','Total, net across your apps','Bank','Payments'])assert.ok(h.includes(label),label);
 assert.match(h,/Out of date[^]*last read/);assert.match(h,/Try again/);assert.doesNotMatch(h,/data-fin="show"/);
 assert.match(h,/class="frow" disabled data-open="app"/,'the failed read cannot open a retained account as current');
 assert.equal(s.ctx.moneyCtl.view().exp,0);
 failed=false;await s.ctx.moneyLoad();assert.doesNotMatch(s.el.innerHTML,/Out of date[^]*last read/);assert.match(s.el.innerHTML,/data-fin="show"/);
});
}
test('E13: a failed refresh erases a reveal and a 401 drops even the masked copy',async()=>{
 let status=200;const amounts={apps:{bank:{balance_usd:987654.32}},totals:{net_usd:987654.32},money:{assets_usd:987654.32,liabilities_usd:0,net_usd:987654.32}};
 const s=money(p=>p==='finance-values'?amounts:status===200?finance:{http:status});await s.ctx.moneyLoad();await s.ctx.moneyCtl.reveal();assert.ok(s.ctx.moneyCtl.view().exp>0);
 status=500;await s.ctx.moneyLoad();assert.equal(s.ctx.moneyCtl.view().apps,null);assert.doesNotMatch(JSON.stringify(s.ctx.moneyState),/987654/);
 status=401;await s.ctx.moneyLoad();assert.doesNotMatch(s.el.innerHTML,/Total, net across your apps/);
});
test('E13: cold failure invents no structure and role change clears a previously masked copy',async()=>{
 let up=false;const s=money(()=>up?finance:{http:500});await s.ctx.moneyLoad();assert.doesNotMatch(s.el.innerHTML,/Total, net across your apps/);
 up=true;await s.ctx.moneyLoad();s.listeners['deck:role'].forEach(f=>f());assert.equal(s.ctx.moneyState.masked,'');assert.equal(s.ctx.moneyState.f,null);
 assert.doesNotMatch(s.el.innerHTML,/Total, net across your apps/);
});
test('E13: a read started before a role change cannot repopulate the masked copy',async()=>{
 let finish;const pending=new Promise(r=>{finish=r}),s=money(()=>pending),load=s.ctx.moneyLoad();
 s.listeners['deck:role'].forEach(f=>f());finish(finance);await load;
 assert.equal(s.ctx.moneyState.masked,'');assert.equal(s.ctx.moneyState.f,null);
});
// The failed-budget sheets run their real loaders; the dialog is a minimal DOM seam, not a replacement renderer.
function shellCapture(s){const bodies=[];const dlg={open:true,isConnected:true,querySelector:sel=>sel==='.sheet-b'?{set innerHTML(h){bodies.push(h)}}:{},contains:()=>true};
 s.ctx.DeckShell={sheet:{open:sp=>{bodies.push(sp.body);return dlg},close(){}},money:{revealed:()=>false}};return bodies;}
test('ZIP pro forma says default terms when the budget read failed',async()=>{
 const s=sandbox(p=>p==='housing/profile'?{http:500}:p==='housing/zip/92647'?{zip:'92647',zhvi:600000,rent:3000,hist:{}}:residential(p)),bodies=shellCapture(s);
 vm.runInContext(re+';this.RE=DeckRE;this.Scope=DeckScope;',s.ctx);s.ctx.Scope.set({kind:'us'});s.ctx.RE.page.show({el:s.el,cls:'P'});await settle();
 const t={dataset:{key:'92647'},closest:sel=>sel==='[data-open="zip"]'?t:null};s.listeners.click.forEach(f=>f({target:t}));await settle();
 assert.match(bodies.join(' '),/Default terms[^]*your budget did not load/);
});
test('/cre deal sheet keeps Your stake with a budget-not-loaded line',async()=>{
 const d={id:'aaaaaaaaaaaa',addr:'Test deal',price:2000000,dscr_cre:1.4,coc_cre:6},s=sandbox(p=>p==='housing/profile'?{http:500}:p.startsWith('cre?')?{person:'tanner',deals:[d],profile:{boxes:[]}}:{rows:[d],total:1}),bodies=shellCapture(s);
 s.el.addEventListener=(k,f)=>{s.el[k]=f};vm.runInContext(cre+';this.mount=creMount;',s.ctx);s.ctx.mount(s.el,{person:'tanner'});await settle();
 const t={dataset:{creOpen:d.id},closest:sel=>sel==='[data-cre-open]'?t:null};s.el.click({target:t});await settle();
 assert.match(bodies.join(' '),/Your stake/);assert.match(bodies.join(' '),/Budget not loaded/);
});
