// Real estate > Residential layout (layout audit 2026-11-15, rows L41 to L46 and T27 to T29): the board names the blocks it
// holds so T and L pair them without a hole, homes sit in the first column (D and XL balance Best ZIPs), and a Your markets
// figure never breaks from its words.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const deck=fs.readFileSync(path.join(root,'static/deck.js'),'utf8');
const D=new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'),deck.indexOf('// ==== DECK V6 UI HELPERS END ===='))+'\nreturn DeckUI;')();
const src=fs.readFileSync(path.join(root,'static/pages/realestate.js'),'utf8');
const store=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
const fx=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/realestate-page',p),'utf8'));
const css=fs.readFileSync(path.join(root,'static/css/realestate.css'),'utf8');

test('the board names its blocks; homes sit in the first column, Best ZIPs alone in the second',()=>{
 const {DeckRE:R,DeckScope:S}=new Function('localStorage','DeckUI',src+'\nreturn {DeckScope,DeckRE};')(store(),D);
 const sum=fx('summary.json'),states=fx('states.json').states,metros=fx('metros.json').metros,rank=fx('rank.json'),re=fx('realestate.json');
 const st={f:R.filtersLoad(),hf:{type:'',beds:0,q:''},sum,states,metros,rank:{ok:true,data:rank},rows:rank.rows,homes:{ok:true,data:{total:1,rows:re.homes}},homeRows:re.homes,
  re,mine:fx('rank-mine.json').rows,mapK:'score',sel:'',prof:null};
 S.set({kind:'mine'});const h=R.pageHtml(st,Date.now());
 assert.match(h,/class="re-board re-w-areas re-w-mine"/);
 const a=h.indexOf('class="re-col re-a"'),b=h.indexOf('class="re-col re-b"');
 for(const s of ['re-map','re-areas','re-mine','re-homes'])assert.ok(h.indexOf('sect '+s)>a&&h.indexOf('sect '+s)<b,s+' in the first column');
 assert.ok(h.indexOf('sect re-best')>b,'Best ZIPs alone in the second column');
 S.set({kind:'metro',metro:S.HOME_METRO});assert.match(R.pageHtml(st,Date.now()),/class="re-board">/,'a metro scope has no ranked areas and no Your markets');
 // every template the classes select names only areas the board can hold
 for(const t of css.match(/grid-template-areas:[^;}]+/g))for(const n of t.match(/"[^"]+"/g).join(' ').replace(/"/g,'').split(/\s+/))
  assert.ok(['strip','map','areas','mine','best','homes'].includes(n),n);
});

test('Your markets: "39 days to sell" and "$4,234/mo rent" never break inside; the line breaks between them',()=>{
 const {DeckRE:R}=new Function('localStorage','DeckUI',src+'\nreturn {DeckScope,DeckRE};')(store(),D);
 const h=R.mineHtml([{name:'92647 Huntington Beach',zip:'92647',value:1790000,chg:7.1,rent:4234,days:39}]);
 assert.match(h,/<small>\$4,234\/mo\u00a0rent \u00b7 39\u00a0days\u00a0to\u00a0sell<\/small>/);
});
