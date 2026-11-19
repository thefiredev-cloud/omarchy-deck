// Layout wave 2 on the Real estate tab (2026-11-15; LayoutD 16, 17, 30 and LayoutP 19, 22, 23, 39). A deal card tells the
// stylesheet how many figures it holds, so four go two by two; the comps sheet's cards and Best ZIP cards go two a row on a
// phone; the desk chips are one sideways row there; a sort header sets its words on the plain headers' line; the phone map
// stays tappable (P19 left on purpose).
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
const css=f=>fs.readFileSync(path.join(root,'static',f),'utf8');
const phone=s=>{const i=s.indexOf('@media (max-width:599px)');assert.ok(i>=0);return s.slice(i)};

test('a deal card names its figure count; four figures never draw three and one',()=>{
 const d={id:'a1b2c3d4e5f6',title:'Walgreens',type:'Retail',city:'Apple Valley',state:'CA',price:2900000,sqft:15000,cap_rate:11.17,cap_kind:'listed',dscr:1.96,score:79};
 const h=DeckCRE.card(d,{});const n=(h.match(/<dl class="dg" data-n="(\d)">/)||[])[1];
 assert.ok(n,'the grid carries data-n');assert.equal(+n,(h.match(/<dt>/g)||[]).length,'data-n is the number of figures');
 assert.match(css('css/commercial.css'),/\.dg\[data-n="4"\]\{grid-template-columns:repeat\(auto-fit,minmax\(max\(min\(100%,7\.5em\),calc\(50% - var\(--s-4\)\)\),1fr\)\)\}/,
  'each column of a four-figure card is at least half the card');
});

test('phone: comps and Best ZIP cards two fields a row, desk chips one sideways row, the map stays tappable',()=>{
 const re={market:{commercial_indicators:{asking_sale:{status:'ok',comps:[{type:'Office',median_psf:404,n:214,low:10,high:7127}]}}}};
 assert.match(C.compsHtml(C.compsModel(re)),/^<div class="com-comps">/);
 const p=phone(css('css/commercial.css'));
 assert.match(p,/\.com-comps \.htw:not\(\.scroll\) \.htbl tr\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
 assert.match(DeckCRE.chips({data:{profile:{boxes:[]}},counts:{}}),/^<div class="chips scroll cre-boxes"/,'one sideways row on a phone');
 assert.match(css('css/commercial.css'),/@media \(min-width:600px\) and \(min-height:500px\)\{\.chips\.scroll\.cre-who,\.chips\.scroll\.cre-boxes\{flex-wrap:wrap;overflow-x:visible\}\}/,'whole rows from tablet up (G10: one scrolling row at phone landscape)');
 // P19 left on purpose: 26 to 29 px tiles clear the 24 px minimum (WCAG 2.2, 2.5.8), so the phone map stays tappable
 assert.doesNotMatch(css('css/realestate.css'),/\.usmap \.st\{[^}]*pointer-events:none/,'phone map tiles stay tappable');
});

test('a sort header keeps its touch height and sets its words at the foot of the header row',()=>{
 const rule=(css('ui.css').match(/\.htbl \.sort\{[^}]+\}/)||[''])[0];
 assert.match(rule,/align-items:flex-end/);assert.match(rule,/min-height:calc\(var\(--hit\) - 8px\)/);
});
