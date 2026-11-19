// /cre start-up (2026-11-15): X1, the inline script of cre.html is a served file (a policy that forbids inline scripts is coming, report-only
// first); W12, the desk has no TV view, so ?view=tv never sticks to its address; the viewer pin and the owner's ?person= preview stay.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'static/cre-boot.js'),'utf8');
const B=new Function(src.slice(src.indexOf('// ==== CRE BOOT PURE BEGIN'),src.indexOf('// ==== CRE BOOT PURE END ===='))+'\nreturn CreBoot;')();
const viewer={role:'viewer',person:'jordan'},owner={role:'owner'};

test('whose desk: a viewer token pins its own; the owner previews a named desk; anything else is the owner\'s',()=>{
 assert.equal(B.person(viewer,'riley'),'jordan','a viewer never reads another desk by query');
 assert.equal(B.person(owner,'riley'),'riley');
 assert.equal(B.person(owner,'morgan'),'tanner','no desk outside the three');
 assert.equal(B.person(null,null),'tanner');
});

test('W12: the address drops ?view=tv and the ?t= token; the owner\'s ?person= preview is kept',()=>{
 assert.equal(B.cleanUrl('/cre','?view=tv',''),'/cre');
 assert.equal(B.cleanUrl('/cre','?view=tv&person=riley','',owner),'/cre?person=riley');
 assert.equal(B.cleanUrl('/','?t=x&person=riley','',viewer),'/','a viewer\'s address names nobody');
 assert.equal(B.cleanUrl('/cre','?person=nobody','#a',owner),'/cre#a');
});

// the page as a browser runs it: cre-boot.js after a stand-in cre.js, the stored TV switch on, ?view=tv in the address
test('the boot script mounts the desk without touching TV view, and leaves the address clean',async()=>{
 const calls=[],replaced=[],cls=new Set();
 const el=id=>({id});
 const ctx={URLSearchParams,console,
  location:{pathname:'/cre',search:'?view=tv&person=riley&t=tok',hash:''},
  history:{replaceState:(a,b,u)=>replaced.push(u)},
  localStorage:{getItem:k=>k==='view'?'tv':null},
  document:{getElementById:el,documentElement:{classList:{add:c=>cls.add(c),toggle:(c,on)=>on&&cls.add(c),remove:c=>cls.delete(c),contains:c=>cls.has(c)}}},
  fetch:async()=>({json:async()=>owner}),
  creMount:(root,o)=>calls.push([root.id,o])};
 ctx.window=ctx;
 vm.runInNewContext(src,ctx);
 await new Promise(r=>setImmediate(r));
 assert.equal(calls.length,1);
 const [rootId,o]=calls[0];
 assert.deepEqual([rootId,o.person,o.viewer,o.scatterEl.id,o.toolsEl.id],['cre-root','riley',false,'cre-sc','cre-tools']);
 assert.deepEqual(replaced,['/cre?person=riley']);
 assert.equal(cls.has('tv'),false,'the desk never turns on TV view');
 assert.doesNotMatch(src.slice(src.indexOf('// ==== CRE BOOT PURE END')),/localStorage|classList/,'the stored TV switch is never read here');
});

test('X1: cre.html carries no inline script; the server serves the boot file with the shell files',()=>{
 const html=fs.readFileSync(path.join(root,'static/cre.html'),'utf8');
 assert.equal((html.match(/<script>/g)||[]).length,0);
 assert.ok(html.indexOf('<script src="/cre.js">')<html.indexOf('<script src="/cre-boot.js">'),'cre.js defines creMount first');
 const main=fs.readFileSync(path.join(root,'rust/src/main.rs'),'utf8');
 assert.match(main,/"\/cre-boot\.js" => Some\(\(CRE_BOOT_JS, "text\/javascript"\)\)/);
});
