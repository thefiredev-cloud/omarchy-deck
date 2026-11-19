// Commercial market strip at eight tiles a row (XL, 2026-11-15): ui.css sizes a strip figure so eight mono characters fill a
// cell (4.8em). "$27/SF/yr" (nine) overflowed its tile by 14 px at 1920. A figure stays within eight characters; a price's
// per-SF unit rides as the small unit suffix, never inside the figure.
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

test('strip figures: eight characters at most, wide values included; the per-SF units are suffixes',()=>{
 const wide={type:'office',row:{crel_cap_office:12.345,crel_sale_psf:1250,crel_lease_psf_yr:127.4,cmbs_office_delinq:12.55},
  us:{fred_treasury_10y:10.25,fred_cre_price_yoy:-12.34},desk:{rates:{commercial:{value:10.5}}}};
 const tiles=C.stripModel(wide);
 for(const t of tiles)if(t.value!=null)assert.ok(String(t.value).length<=8,t.label+': '+t.value+' is wider than a cell holds');
 const by=Object.fromEntries(tiles.map(t=>[t.label,t]));
 assert.deepEqual([by['Asking $/SF'].value,by['Asking $/SF'].unit],['$1,250','/SF']);
 assert.deepEqual([by['Lease $/SF/yr'].value,by['Lease $/SF/yr'].unit],['$127','/SF/yr']);
 const h=C.stripHtml(tiles,'Market');
 assert.match(h,/<b class="v">\$127<span class="u">\/SF\/yr<\/span><\/b>/,'the unit is the small suffix inside the figure line');
 assert.doesNotMatch(h,/class="v">[^<]*\/SF/,'no unit inside the figure text');
});
