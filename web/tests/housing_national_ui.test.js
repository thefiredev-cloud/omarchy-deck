// Real estate > Residential (deck v3): the national data's provenance lives in the Data sheet, never on the page; the budget
// is never cached and the max price never stored. Fixtures: tests/fixtures/realestate-page (trimmed staged national v2 build).
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
const store=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m}};
const fx=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/realestate-page',p),'utf8'));
const sum=fx('summary.json'),fields=fx('fields.json'),sources=fx('sources.json').sources,z=fx('zip-92629.json');

test('Data sheet: sources with what they give and their date, the score weights, the ZIP\'s blend parts',()=>{
 const R=new Function('localStorage','DeckUI',src+'\nreturn DeckRE;')(store(),D),cat=new Map(fields.fields.map(f=>[f.name,f]));
 const model=R.dataModel({sources,summary:sum,cat,zip:z}),html=D.dataSheet(model);
 const res=sources.filter(s=>s.side!=='commercial');
 for(const s of res)assert.ok(html.includes(s.name.replace(/&/g,'&amp;').slice(0,40)),'source listed: '+s.name);
 assert.match(html,/of 39\.2K ZIPs|of [\d,.K]+ ZIPs/,'coverage reads as ZIPs of the national total');
 for(const x of sum.scores.h_score.inputs)assert.ok(model.method.some(m=>/better/.test(m[1])),x.key);
 assert.ok(model.blends.length>0&&model.blends[0].parts.length>0,'the ZIP scope names each blend\'s parts');
});

test('the page never prints sources, coverage, weights or dates of data; those live in the Data sheet only',()=>{
 const pageSrc=src.slice(src.indexOf('// ================= render'),src.indexOf('// ================= glue'));
 assert.doesNotMatch(pageSrc,/Sources?:|Coverage:|Score weights|tnote|hsrc|as of/,'render code builds no provenance line');
});

test('the budget is never cached and the max price is never stored',()=>{
 const sw=fs.readFileSync(path.join(root,'static/sw.js'),'utf8');
 assert.match(sw,/if\(u\.pathname==='\/api\/housing\/profile'\)return;/);
 assert.match(src,/const profGet=\(\)=>get\('housing\/profile'\)/,'the profile read goes through the bounded DeckPages.get (cache: no-store)');
 assert.doesNotMatch(src,/[^.\w]fetch\('\/api\/housing\/profile'/,'never a bare fetch');
 const ls=store(),R=new Function('localStorage','DeckUI',src+'\nreturn DeckRE;')(ls,D);
 R.filtersSave({grade:'A',within:true,max:712345,minPop:1000,sort:'score'});
 const saved=ls.getItem(R.FILTER_KEY);assert.ok(saved);assert.doesNotMatch(saved,/712345|max/);
 assert.equal(R.filtersLoad().max,null);
});
