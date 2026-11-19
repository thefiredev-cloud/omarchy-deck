// A budget the read did not bring is not "no budget" (ReviewSix, #399). With Within budget on, a failed profile read used to
// drop the cap from the rank query, so Best ZIPs silently widened to every priced area under a control reading "Set budget";
// the commercial desk lost its stake cap the same way. Both page bodies run here (the page's own glue for Residential, the
// desk's own render and mount for /cre) against a stub registry, so the checks are the reads that were and were not sent.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const deck=fs.readFileSync(path.join(root,'static/deck.js'),'utf8');
const D=new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'),deck.indexOf('// ==== DECK V6 UI HELPERS END ===='))+'\nreturn DeckUI;')();
const reSrc=fs.readFileSync(path.join(root,'static/pages/realestate.js'),'utf8');
const creSrc=fs.readFileSync(path.join(root,'static/cre.js'),'utf8');
const fx=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/realestate-page',p),'utf8'));
const sum=fx('summary.json'),states=fx('states.json').states,fields=fx('fields.json'),rank=fx('rank.json'),
 re=fx('realestate.json'),sources=fx('sources.json').sources;
const store=init=>{const m=new Map(Object.entries(init||{}));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
const tick=()=>new Promise(r=>setTimeout(r,0));
const settle=async(ok)=>{for(let i=0;i<200;i++){if(ok())return true;await tick()}return false};
// Within budget is on in the stored filters: the one setting under which a lost budget widens the list
const WITHIN=store({'re:res:f':JSON.stringify({grade:'',within:true,minPop:null,sort:'score'})});

// the registry the page reads through: the profile answers or fails, every other route answers its fixture, and every path is kept
function registry(prof){
 const calls=[];
 const get=p=>{calls.push(p);
  const u=p.split('?')[0],part=p.split('?')[1]||'';
  if(u==='housing/profile')return Promise.resolve(prof());
  if(u==='housing/national')return Promise.resolve(part==='part=states'?{ok:true,data:{states}}:part==='part=sources'?{ok:true,data:{sources}}:{ok:true,data:sum});
  if(u==='housing/fields')return Promise.resolve({ok:true,data:fields});
  if(u==='housing/rank')return Promise.resolve({ok:true,data:rank});
  if(u==='realestate')return Promise.resolve({ok:true,data:re});
  if(u==='realestate/homes')return Promise.resolve({ok:true,data:{rows:[],total:0}});
  return Promise.resolve({ok:false,status:404})};
 return {calls,DeckPages:{get}};
}
function mountPage(reg,ls){
 const L={};
 const doc={activeElement:null,documentElement:null,addEventListener:(k,f)=>{(L[k]=L[k]||[]).push(f)},querySelectorAll:()=>[],getElementById:()=>null,body:{appendChild(){}},createElement:()=>({})};
 const el={innerHTML:'',querySelector:()=>null,contains:()=>true};
 const mod=new Function('localStorage','DeckUI','DeckPages','document',reSrc+'\nreturn {DeckScope,DeckRE};')(ls||WITHIN,D,reg.DeckPages,doc);
 mod.DeckScope.set({kind:'us'}); // a state or metro scope would read its own lists; the capital no budget is the same at every scope
 mod.DeckRE.page.show({el,head:null,tv:false,cls:'D'});
 return {mod,el,L};
}
const click=(L,sel)=>{(L.click||[]).forEach(f=>{const t={dataset:{},closest:s=>s===sel?t:null};f({target:t,defaultPrevented:false})})};

test('a failed profile read sends no rank query at all: the list waits, it is not widened to every priced area',async()=>{
 const reg=registry(()=>({ok:false,status:500}));
 const {el}=mountPage(reg);
 assert.ok(await settle(()=>/Budget not loaded/.test(el.innerHTML)),'the board says the budget did not load');
 assert.deepEqual(reg.calls.filter(p=>p.startsWith('housing/rank')),[],'not one rank read: the cap was never dropped');
 assert.match(el.innerHTML,/data-re-profretry="1"/,'the budget can be read again from where the list would be');
 assert.doesNotMatch(el.innerHTML,/Set budget/,'the control never claims the owner has no budget');
 assert.doesNotMatch(el.innerHTML,/No ZIPs match/,'an empty list is not read as "nothing matches"');
});

test('a profile the owner never set is still no budget: no cap asked for, Set budget offered, today\'s behaviour kept',async()=>{
 const reg=registry(()=>({ok:true,data:{}}));
 const {el}=mountPage(reg);
 assert.ok(await settle(()=>/data-open="zip"/.test(el.innerHTML)),'the list is read and drawn');
 const ranks=reg.calls.filter(p=>p.startsWith('housing/rank'));
 assert.equal(ranks.length,1,'one rank read');
 assert.doesNotMatch(ranks[0],/max_price=/,'no budget, no cap: exactly what main does for an empty profile');
 assert.match(el.innerHTML,/Set budget/,'the control still offers to set one');
 assert.doesNotMatch(el.innerHTML,/Budget not loaded/);
});

test('a budget that reads keeps its cap on the rank query',async()=>{
 const reg=registry(()=>({ok:true,data:{budget:{budget:845000}}}));
 const {el}=mountPage(reg);
 assert.ok(await settle(()=>/data-open="zip"/.test(el.innerHTML)));
 const ranks=reg.calls.filter(p=>p.startsWith('housing/rank'));
 assert.equal(ranks.length,1);
 assert.match(ranks[0],/max_price=845000/);
 assert.doesNotMatch(el.innerHTML,/Budget not loaded/);
});

test('Try again reads the budget once more and draws the list under it, with no page reload',async()=>{
 let up=false;
 const reg=registry(()=>up?{ok:true,data:{budget:{budget:845000}}}:{ok:false,status:500});
 const {el,L}=mountPage(reg);
 assert.ok(await settle(()=>/Budget not loaded/.test(el.innerHTML)));
 up=true;click(L,'[data-re-profretry]');
 assert.ok(await settle(()=>/data-open="zip"/.test(el.innerHTML)),'the list comes back under the budget');
 const ranks=reg.calls.filter(p=>p.startsWith('housing/rank'));
 assert.equal(ranks.length,1);assert.match(ranks[0],/max_price=845000/);
 assert.doesNotMatch(el.innerHTML,/Budget not loaded/);
});

// ---- /cre: the stake cap and the stake views come from the same profile
const C=new Function(creSrc.slice(creSrc.indexOf('// ==== DECK CRE PURE BEGIN'),creSrc.indexOf('// ==== DECK CRE PURE END ===='))+'\nreturn DeckCRE;')();
const deal=(id,o)=>Object.assign({id,addr:id+' Main St, Irvine, CA 92614',city:'Irvine',state:'CA',zip:'92614',county:'Orange County',type:'Industrial',
 price:2000000,sqft:10000,ppsf:200,score:50,source:'lee-associates',dscr_cre:1.4,coc_cre:6},o);
const desk=o=>Object.assign({status:'ok',person:'tanner',viewer:false,revealed:false,view:'all',cap:null,capFail:false,f:{},sort:'score',cols:1,compare:[],msg:'',cols1:1,
 data:{person:'tanner',viewer:false,people:[],deals:[deal('a')],profile:{boxes:[]}},rows:[deal('a')],total:1,counts:{'':1},viewCounts:{} },o);
const words=h=>h.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');

test('/cre: a failed profile read is named, and a stake view waits instead of reading as no deals',()=>{
 const lost=desk({capFail:true,view:'jordan',rows:[]});
 const h=C.render(lost);
 assert.match(h,/Budget not loaded/,'the desk says the budget did not load');
 assert.match(h,/data-cre-capretry="1"/,'with a read again');
 assert.doesNotMatch(words(h),/No deals match this buy box/,'an uncomputed narrowing is not reported as nothing matching');
 // the deals themselves are not budget-derived: the desk keeps them under the one line
 const all=C.render(desk({capFail:true}));
 assert.match(all,/Budget not loaded/);assert.match(all,/data-cre-open="a"/,'the deals stay on screen');
 assert.equal((all.match(/Budget not loaded/g)||[]).length,1,'said once, not once per card');
});

test('/cre: an empty profile is still no stake, as main has it; a budget that reads shows the stake views',()=>{
 const none=C.render(desk({view:'jordan',rows:[]}));
 assert.doesNotMatch(none,/Budget not loaded/,'nothing failed');
 assert.match(words(none),/No deals match this buy box/,'today\'s words for a view with no cap to size it');
 assert.doesNotMatch(none,/Co-invest with Jordan/,'no cap, no stake views');
 const ok=C.render(desk({cap:845000}));
 assert.match(ok,/Co-invest with Jordan/);assert.doesNotMatch(ok,/Budget not loaded/);
});

test('/cre: Try again reads the budget once more and the stake views come back, with no reload',async()=>{
 let up=false;
 const listeners={};
 const doc={activeElement:null,documentElement:null,addEventListener:(k,f)=>{(listeners[k]=listeners[k]||[]).push(f)},querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,createElement:()=>({}),body:{appendChild(){}}};
 const el={innerHTML:'',contains:()=>true,querySelector:()=>null,addEventListener:(k,f)=>{el.click=f}};
 const calls=[];
 const P={get:p=>{calls.push(p);
  if(p.startsWith('housing/profile'))return Promise.resolve(up?{ok:true,data:{budget:{budget:845000}}}:{ok:false,status:500});
  if(p==='cre?person=tanner')return Promise.resolve({ok:true,data:{person:'tanner',viewer:false,people:[],deals:[deal('a')],profile:{boxes:[]}}});
  if(p.startsWith('cre/deals'))return Promise.resolve({ok:true,data:{rows:[deal('a')],total:1}});
  return Promise.resolve({ok:false,status:404})}};
 const mount=new Function('localStorage','DeckUI','DeckPages','document',creSrc+'\nreturn creMount;')(store(),{},P,doc);
 mount(el,{person:'tanner'});
 assert.ok(await settle(()=>/Budget not loaded/.test(el.innerHTML)),'the desk names the failed budget');
 up=true;
 el.click({target:{dataset:{},closest:s=>s==='[data-cre-capretry]'?el:null}});
 assert.ok(await settle(()=>/Co-invest with Jordan/.test(el.innerHTML)),'the stake views come back under the budget');
 assert.doesNotMatch(el.innerHTML,/Budget not loaded/);
 assert.equal(calls.filter(p=>p.startsWith('housing/profile')).length,2,'the read again is one more profile read, not a reload');
});
