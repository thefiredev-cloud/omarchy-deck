// Listings in broker terms: $/SF and BR/BA/SF listing rows, the type select (pure functions). The old Markets > Housing page, its ZIP sheet
// and the single-unit pro forma left with the dead housing block (SeeCode C9, 2026-11-15): Real estate draws from pages/realestate.js.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'static/deck.js'),'utf8');
const a=src.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const b=src.indexOf('// ==== DECK V6 UI HELPERS END ====');
// Only trusted checkout JavaScript enters the function body. Fixture values remain arguments.
const D=new Function(src.slice(a,b)+'\nreturn DeckUI;')();

test('hPsf: values, and null for zero, negative, missing or non-numeric input',()=>{
 assert.equal(D.hPsf(450000,1282),351);assert.equal(D.hPsf(1250000,1440),868);assert.equal(D.hPsf(30000,100),300);assert.equal(D.hPsf(1000,3),null,'under 100 SF is an acreage, not a size');
 for(const [p,s] of [[0,1000],[450000,0],[-1,1000],[450000,-1],[null,1000],[450000,undefined],['450000',1000],[450000,'1000'],[NaN,1000],[450000,Infinity]])assert.equal(D.hPsf(p,s),null,p+' '+s);
});

test('listing detail line: type, BR, BA, SF, $/SF and cap rate, each left out when missing',()=>{
 assert.equal(D.hListMeta({type:'Condo',beds:2,baths:1.5,sqft:1282,price:450000,currency:'USD'}),'Condo \u00B7 2 BR \u00B7 1.5 BA \u00B7 1,282 SF \u00B7 $351/SF');
 assert.equal(D.hListMeta({type:'Condo',beds:2,baths:1.5,sqft:1282,price:450000,currency:'USD'},{type:false}),'2 BR \u00B7 1.5 BA \u00B7 1,282 SF \u00B7 $351/SF');
 assert.equal(D.hListMeta({beds:3,baths:2,sqft:1440,price:1250000,currency:'USD'}),'3 BR \u00B7 2 BA \u00B7 1,440 SF \u00B7 $868/SF');
 assert.equal(D.hListMeta({type:'Office',sqft:5000,cap_rate:5.2,price:2500000,currency:'USD'}),'Office \u00B7 5,000 SF \u00B7 $500/SF \u00B7 cap rate 5.2%');
 assert.equal(D.hListMeta({type:'Office',sqft:5000,cap_rate:6.25}),'Office \u00B7 5,000 SF \u00B7 cap rate 6.3%');
 assert.equal(D.hListMeta({beds:3}),'3 BR');assert.equal(D.hListMeta({sqft:900}),'900 SF');assert.equal(D.hListMeta({baths:2.5}),'2.5 BA');
 assert.equal(D.hListMeta({type:'Retail',price:900000}),'Retail');assert.equal(D.hListMeta({price:900000},{type:false}),'');
 assert.equal(D.hListMeta({}),'');assert.equal(D.hListMeta(null),'');assert.equal(D.hListMeta(undefined),'');
 assert.equal(D.hListMeta({beds:'3',baths:null,sqft:'x',cap_rate:'5'}),'');
 for(const x of [{beds:null,sqft:NaN,price:1},{type:'Condo',baths:undefined}])assert.doesNotMatch(D.hListMeta(x),/--|undefined|NaN/);
});

test('listing rows use the broker wording in the for sale and commercial lists',()=>{
 const re={t:1794000000,refresh:3600,src:['fixture'],errors:[],market:{},
  homes:[{addr:'1 Main St',city:'Huntington Beach',price:1250000,currency:'USD',beds:3,baths:2,sqft:1440,source:'redfin'}],commercial:[{addr:'2 Row',city:'Irvine',type:'Office',price:2500000,currency:'USD',sqft:5000,cap_rate:5.2,source:'crexi'}]};
 const p=D.homes(re,1794000000*1000);
 assert.match(p,/Huntington Beach \u00B7 3 BR \u00B7 2 BA \u00B7 1,440 SF \u00B7 \$868\/SF/);
 assert.match(p,/2 Row \u00B7 5,000 SF \u00B7 \$500\/SF \u00B7 cap rate 5\.2%/);
 assert.doesNotMatch(p,/ bd<| ba<| sqft</);
});

test('residential type select: shown only with two or more types, filters, and combines with city and budget',()=>{
 const hs=[{price:300000,currency:'USD',city:'A',type:'Condo'},{price:900000,currency:'USD',city:'B',type:'Single family'},{price:null,city:'A',type:'Condo'},{price:500000,currency:'USD',city:'A'}];
 const chips=D.listChips(hs,{},null,'homes');
 assert.match(chips,/<select data-lsel="homes">/);
 assert.match(chips,/<span>Type<\/span><select data-lsel="htype"><option value="">All<\/option><option value="Condo">Condo<\/option><option value="Single family">Single family<\/option><\/select>/);
 assert.match(D.listChips(hs,{htype:'Condo'},null,'homes'),/<select data-lsel="htype">[^]*<option value="Condo" selected>Condo<\/option>/);
 for(const few of [[{city:'A',type:'Condo'},{city:'B',type:'Condo'}],[{city:'A'},{city:'B'}],[{city:'A',type:'Condo'},{city:'B'}],[]])assert.ok(!D.listChips(few,{},null,'homes').includes('data-lsel="htype"'));
 assert.equal(D.listFilter(hs,{},null,'homes').length,4);
 assert.equal(D.listFilter(hs,{htype:''},null,'homes').length,4);
 assert.equal(D.listFilter(hs,{htype:'Condo'},null,'homes').length,2);
 assert.equal(D.listFilter(hs,{htype:'Single family'},null,'homes').length,1);
 assert.equal(D.listFilter(hs,{htype:'Duplex'},null,'homes').length,0);
 assert.equal(D.listFilter(hs,{city:'A',htype:'Condo'},null,'homes').length,2);
 assert.equal(D.listFilter(hs,{city:'B',htype:'Condo'},null,'homes').length,0);
 assert.equal(D.listFilter(hs,{city:'A'},null,'homes').length,3,'city alone still counts the untyped listing');
 assert.equal(D.listFilter(hs,{within:true,htype:'Condo'},400000,'homes').length,1,'an unpriced listing is never within budget');
 assert.equal(D.listFilter(hs,{within:true,htype:'Condo'},null,'homes').length,0);
 // commercial keeps its own Type select and ignores htype
 const cs=[{price:1,type:'Retail'},{price:1,type:'Office'}];
 assert.ok(!D.listChips(cs,{},null,'commercial').includes('data-lsel="htype"'));
 assert.match(D.listChips(cs,{},null,'commercial'),/<span>Type<\/span><select data-lsel="commercial">/);
 assert.equal(D.listFilter(cs,{htype:'Office'},null,'commercial').length,2);
 assert.equal(D.listFilter(cs,{ctype:'Office'},null,'commercial').length,1);
});
