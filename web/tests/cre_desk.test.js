// Commercial deal desk (owner order 2026-11-12, design v3 2026-11-14): buy box filters and alerts, the cards and their cap marks,
// the coverage and empty states, the buy box save payload, the deal sheet, the scatter and the /cre page. Synthetic deals that follow
// the cre-deals.json contract; no network.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const csrc=fs.readFileSync(path.join(root,'static/cre.js'),'utf8');
const C=new Function(csrc.slice(csrc.indexOf('// ==== DECK CRE PURE BEGIN'),csrc.indexOf('// ==== DECK CRE PURE END ===='))+'\nreturn DeckCRE;')();

const deal=(id,o)=>Object.assign({id,addr:id+' Main St, Irvine, CA 92614',city:'Irvine',state:'CA',zip:'92614',county:'Orange County',type:'Industrial',price:2000000,sqft:10000,ppsf:200,score:50,source:'lee-associates'},o);
const deals=[
 deal('aaaaaaaaaaa1',{type:'Multifamily',units:12,ppu:250000,cap:{value:6.1,kind:'listed',src:'listed by matthews'},score:72,county:'Los Angeles County',zip:'90001',city:'Los Angeles',addr:'1 Gage Ave, Los Angeles, CA 90001',dom:{days:40}}),
 deal('aaaaaaaaaaa2',{cap:{value:7.4,kind:'estimate',src:'estimated NOI / asking price'},score:64,dom:{days:200},sqft:24000}),
 deal('aaaaaaaaaaa3',{type:'Office',price:900000,score:null,dom:{days:5}}),
 deal('aaaaaaaaaaa4',{type:'Multifamily',units:4,price:1500000,county:'San Diego County',zip:'92101',city:'San Diego',addr:'4 Market St, San Diego, CA 92101',score:58,dom:{days:90},listed_at:1794000000})];
// visible text of a fragment: tags dropped, entities decoded
const text=h=>h.replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
const cells=h=>[...h.matchAll(/<(dd|td)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(m=>m[2]);

test('filters: asset class, county, units, SF, cap, price, DOM and free text',()=>{
 const ids=f=>deals.filter(d=>C.match(d,f)).map(d=>d.id.slice(-1));
 assert.deepEqual(ids({types:['Multifamily']}),['1','4']);
 assert.deepEqual(ids({types:['Multifamily'],units_min:5}),['1']);
 assert.deepEqual(ids({counties:['Orange County']}),['2','3']);
 assert.deepEqual(ids({cap_min:7}),['2'],'a listing with no cap never passes a cap floor');
 assert.deepEqual(ids({sf_min:20000}),['2']);
 assert.deepEqual(ids({price_max:1000000}),['3']);
 assert.deepEqual(ids({dom_max:60}),['1','3']);
 assert.deepEqual(ids({zips:['921']}),['4']);
 assert.deepEqual(ids({q:'irvine'}),['2','3']);
});

test('sort: score, cap, price and days on market; missing values go last',()=>{
 const ord=s=>C.sortDeals(deals,s).map(d=>d.id.slice(-1)).join('');
 assert.equal(ord('score'),'1243');assert.equal(ord('cap'),'2134');assert.equal(ord('price'),'3412');assert.equal(ord('dom'),'2413');
});

test('new-match alerts: none until a baseline, then matches not seen before',()=>{
 const box={id:'mf',name:'MF',f:{types:['Multifamily']}};
 assert.equal(C.newIds(deals,box,{}),null);
 assert.deepEqual(C.newIds(deals,box,{mf:{ids:['aaaaaaaaaaa1']}}),['aaaaaaaaaaa4']);
 assert.deepEqual(C.newIds(deals,box,{mf:{ids:['aaaaaaaaaaa1','aaaaaaaaaaa4']}}),[]);
});

test('deals query: the type switch, the scope, the box and paging reach /api/cre/deals; a viewer never names a person',()=>{
 const q=C.dealsQuery({person:'tanner',type:'Retail',scope:'state=CA&county=Orange%2CLos%20Angeles',box:'south-oc',offset:12});
 assert.equal(q,'cre/deals?person=tanner&box=south-oc&type=Retail&state=CA&county=Orange%2CLos%20Angeles&sort=score&limit=12&offset=12');
 const v=C.dealsQuery({person:'jordan',viewer:true,type:'Multifamily',scope:''});
 assert.doesNotMatch(v,/person=/,'the server pins a viewer to their own desk');
 assert.match(C.dealsQuery({person:'tanner',price_max:3000000}),/max_price=3000000/);
});

test('deal card: a solid mark for a listed cap and a hollow mark for an estimate; empty fields are left out; addresses are never cut',()=>{
 const listed=C.card(deals[0]),est=C.card(deals[1]);
 // the figure and its word are two spans, so the word can wrap under the figure and never break into it (laptop overflow, 2026-11-15)
 assert.match(listed,/<dd><span class="capf"><span class="capm" aria-hidden="true"><\/span>6\.10%<\/span> <span class="capk">listed<\/span><\/dd>/);
 assert.match(est,/<dd><span class="capf"><span class="capm est" aria-hidden="true"><\/span>7\.40%<\/span> <span class="capk">est\.<\/span><\/dd>/);
 const css=fs.readFileSync(path.join(root,'static/css/commercial.css'),'utf8');
 assert.match(css,/\.dg dd\{[^}]*white-space:nowrap;[^}]*display:flex;flex-wrap:wrap/,'the dd breaks only between its spans');
 assert.equal(C.cardModel(deals[0]).cells.find(c=>c[0]==='Cap')[1].includes('capm est'),false);
 const none=C.cardModel(deals[2]);
 assert.deepEqual(none.cells.map(c=>c[0]),['Price','$/SF'],'no cap or DSCR cell when the deal has none');
 assert.deepEqual(C.cardModel(deals[0]).cells.map(c=>c[0]),['Price','$/unit','Cap'],'a building with units reads per unit; only the numbers it has');
 const long='12345 Very Long Industrial Park Boulevard, Building C, Units 101 through 118, Rancho Cucamonga, CA 91730';
 assert.ok(text(C.card(deal('bbbbbbbbbbb1',{title:'',addr:long}))).includes(long),'the whole address prints');
 assert.match(listed,/<span class="pill">Score 72<\/span>/,'the deal score is labelled');
 assert.match(listed,/data-open="deal" data-cre-open="aaaaaaaaaaa1" data-key="aaaaaaaaaaa1"/);
});

// 2026-11-17 (L14): the friendlier card. Type, units, price, $/unit or $/SF, cap, GRM, DSCR and monthly cash flow, then days listed,
// the source and a link. Everything the desk worked out says est.; nothing estimated reads as listed
test('deal card: units, per unit, GRM, DSCR and cash flow, estimates marked; days listed, source and a 44 px link in the foot',()=>{
 const mf=deal('fffffffffff1',{type:'Multifamily',price:1600000,units_est:{value:4,kind:'estimate',basis:'4 units, estimated'},grm:13.3,dscr:1.08,loan:'res',dscr_res:1.08,dscr_cre:1.2,
  cf_mo:{value:-412,kind:'estimate',loan:'res'},cap:{value:4.31,kind:'estimate'},dom:{days:12},source:'redfin',url:'https://www.redfin.com/CA/x/home/1',feed:'homes'});
 const m=C.cardModel(mf);
 assert.deepEqual(m.cells.map(c=>c[0]),['Price','$/unit','Cap','GRM','DSCR','Cash flow/mo']);
 const cell=k=>text(m.cells.find(c=>c[0]===k)[1]);
 assert.equal(cell('$/unit'),'$400K est.','an estimated unit count makes the per unit figure an estimate');
 assert.equal(cell('Cap'),'4.31% est.');assert.equal(cell('GRM'),'13.3 est.');assert.equal(cell('DSCR'),'1.08');assert.equal(cell('Cash flow/mo'),'\u2212$412 est.');
 assert.equal(m.sub,'Multifamily \u00b7 4 units est. \u00b7 Irvine, CA');
 const h=C.card(mf);
 assert.match(h,/^<article class="card deal"><button type="button" class="deal-open" data-open="deal" data-cre-open="fffffffffff1" data-key="fffffffffff1">/);
 assert.match(h,/<p class="deal-foot"><span>12 days listed \u00b7 Redfin<\/span><a class="deal-link ext" href="https:\/\/www\.redfin\.com\/CA\/x\/home\/1" target="_blank" rel="noopener noreferrer" aria-label="Open the listing on Redfin">Listing<\/a><\/p><\/article>$/);
 assert.doesNotMatch(h.slice(0,h.indexOf('</button>')),/<a /,'no link inside the button');
 assert.doesNotMatch(m.cells.map(c=>text(c[1])).join(' '),/listed/,'nothing on an all-estimate card reads as listed');
 // listed units: a plain per unit figure; a listed cap says listed
 const listed=C.cardModel(deals[0]);assert.equal(text(listed.cells.find(c=>c[0]==='$/unit')[1]),'$250K');
 // the commercial DSCR stands in when the desk picked no loan; no cash flow figure, no cell
 assert.equal(text(C.cardModel(deal('fffffffffff2',{dscr_cre:1.31})).cells.find(c=>c[0]==='DSCR')[1]),'1.31');
 // a lease listing: asking rent and size, never a price
 const ls=C.cardModel(deal('fffffffffff3',{sale_or_lease:'lease',price:undefined,ppsf:undefined,rent_psf_yr:16.8,sqft:12000}));
 assert.deepEqual(ls.cells.map(c=>[c[0],text(c[1])]),[['Asking rent','$16.80/SF/yr'],['Size','12.0K SF']]);assert.match(ls.sub,/^Industrial for lease/);
 // a URL that is not http(s) gets no link
 assert.doesNotMatch(C.card(deal('fffffffffff4',{url:'javascript:alert(1)'})),/deal-link/);
 const css=fs.readFileSync(path.join(root,'static/css/commercial.css'),'utf8');
 assert.match(css,/\.deal-link\{[^}]*min-height:44px;min-width:44px/);
 assert.match(css,/\.cre-sort select,\.cre-tools \.btn,\.cre-htools \.btn,\.chips\.cre-boxes>button[^{]*\{min-height:44px\}/,'sort and filter controls are 44 px');
});

test('count line: deals in view, new matches of the box, the sort beside it; empty and lease boxes say what to do in plain words',()=>{
 const box={id:'mf',name:'MF',f:{types:['Multifamily']}};
 const data={person:'jordan',profile:{boxes:[box],seen:{mf:{ids:['aaaaaaaaaaa1']}}},deals};
 const h=C.render({data,status:'ok',rows:[deals[0],deals[3]],total:2,counts:{'':4,mf:2},boxId:'mf',sort:'cap'});
 assert.match(h,/<p class="cre-cnt" role="status">2 deals, 1 new<\/p>/);
 assert.match(h,/<select data-cre-sort="1" data-key="cre-sort" aria-label="Sort deals"><option value="score">Best score<\/option><option value="cap" selected>/);
 assert.equal(C.countText({data,total:1}),'1 deal');assert.equal(C.countText({data,total:1734}),'1,734 deals');assert.equal(C.countText({data}),'');
 assert.equal(C.countText({data:{profile:{boxes:[box]},deals}, total:2,boxId:'mf'}),'2 deals','no baseline yet: no new count');
 const empty=C.render({data,status:'ok',rows:[],total:0,counts:{'':4,mf:0},boxId:'mf'});
 assert.match(empty,/No deals match this buy box\.<\/b><p class="es-l">Widen the price, place or size, or check back after the next listing run\.<\/p>/);
 assert.doesNotMatch(empty,/cre-count/,'no count line over an empty list');
 const lease={id:'ind-lease',name:'Industrial for lease',f:{types:['Industrial'],sale_or_lease:'lease'}};
 const le=C.render({data:{person:'riley',profile:{boxes:[lease]},deals},status:'ok',rows:[],total:0,counts:{'':4,'ind-lease':0},boxId:'ind-lease'});
 assert.match(le,/No lease listings have come in yet\. They show here once a feed lists them\./);
 assert.match(C.render({data,status:'ok',rows:[],total:0,counts:{'':4},f:{cap_min:30}}),/No deals match these filters\.<\/b><p class="es-l">Clear a filter or two to see more\./);
});

test('units ceiling and sale or lease: listed units, else the estimate; a deal that does not say is a sale; saves keep both keys',()=>{
 const est=deal('ggggggggggg1',{type:'Multifamily',units_est:{value:3,kind:'estimate'}}),big=deal('ggggggggggg2',{type:'Multifamily',units:20});
 const none=deal('ggggggggggg3',{type:'Multifamily'}),lease=deal('ggggggggggg4',{sale_or_lease:'lease'}),both=deal('ggggggggggg5',{type:'Multifamily',units:9,units_est:{value:3}});
 const ids=(xs,f)=>xs.filter(d=>C.match(d,f)).map(d=>d.id.slice(-1));
 assert.deepEqual(ids([est,big,none,both],{units_min:2,units_max:4}),['1'],'the listed count wins over an estimate; no count never passes');
 assert.deepEqual(ids([est,big,none,both],{units_min:5}),['2','5']);
 assert.deepEqual(ids([deals[1],lease],{sale_or_lease:'lease'}),['4']);assert.deepEqual(ids([deals[1],lease],{sale_or_lease:'sale'}),['2']);
 assert.deepEqual(ids([deals[1],lease],{}),['2','4'],'no key, both');
 assert.equal(C.units(est),3);assert.equal(C.unitsEst(est),true);assert.equal(C.unitsEst(big),false);
 const box={id:'mf-small',name:'Small multifamily 2-4 units',f:{types:['Multifamily'],units_min:2,units_max:4,price_max:2500000,sale_or_lease:'sale',sort:'score'}};
 const p=C.boxPayload('jordan',{name:'Small multifamily 2-4 units',types:['Multifamily'],price_max:'2,500,000',counties:[]},box,[box]);
 assert.deepEqual(p.box.f,{units_min:2,units_max:4,sale_or_lease:'sale',sort:'score',types:['Multifamily'],price_max:2500000},'an edit keeps the keys the form does not show');
 assert.deepEqual(C.readFilters({units_max:'4',units_min:'x'},{}),{units_max:4},'not a number is left out');
 assert.equal(C.filterCount({units_max:4}),1);
 // Tanner's small deals view and the stake read the estimated count and the desk's loan pick
 assert.equal(C.isSmall(est),true);
 const k=C.stake(Object.assign({},est,{price:1000000,loan:'res',dscr_res:1.1,coc_res:2}),100000,{res:{ltv:0.75},cre:{ltv:0.65},closing:0.02});
 assert.equal(k.scenario,'res');
});

test('cells hold text or real elements, never escaped markup (baseline problem 7)',()=>{
 const s={data:{person:'tanner',profile:{boxes:[]},deals},status:'ok',rows:deals,total:4,counts:{'':4}};
 const h=C.render(s)+C.dealSheet(Object.assign({},deals[1],{comps:{n:3,median_ppsf:310,near:[{id:'aaaaaaaaaaa9',addr:'9 Elm',price:3000000,ppsf:300,mi:1.2}]}}),{data:s.data}).body;
 const cs=cells(h);assert.ok(cs.length>10);
 for(const c of cs)assert.doesNotMatch(text(c),/[<>]/,'escaped markup in a cell: '+c);
 const evil=C.render(Object.assign({},s,{rows:[deal('ccccccccccc1',{title:'<img src=x onerror=alert(1)>'})]}));
 assert.doesNotMatch(evil,/<img/);assert.match(evil,/&lt;img src=x/);
});

test('desk states: coverage line outside California, an empty buy box, a failed desk',()=>{
 const data={person:'tanner',profile:{boxes:[{id:'mf',name:'MF 5+',f:{types:['Multifamily'],units_min:5}}]},deals};
 const out=C.render({data,status:'ok',rows:[],total:0,counts:{'':0},dataset:'ca',scopeKind:'state'});
 assert.match(out,/No listings tracked here yet\. Deals cover Southern California for now\./);
 assert.doesNotMatch(out,/No deals match/);
 const us=C.render({data,status:'ok',rows:[],total:0,counts:{'':0},dataset:'ca',scopeKind:'us'});
 assert.doesNotMatch(us,/No listings tracked here/,'the national scope is not "outside coverage"');
 const box=C.render({data,status:'ok',rows:[],total:0,counts:{'':40,mf:0},dataset:'ca',scopeKind:'state',boxId:'mf'});
 assert.match(box,/No deals match this buy box\./);assert.match(box,/data-cre-edit="1">Edit buy box/);
 const bad=C.render({data:{status:'not_reporting',reason:'the realestate collector has not written cre-deals.json'},status:'bad'});
 assert.match(bad,/Deal desk is not reporting\./);assert.match(bad,/data-cre-retry="1">Try again/);
 assert.doesNotMatch(bad,/collector|cre-deals|<p class="es-l">/,'E9: one fixed sentence; the server\'s reason is never on the page');
 const nat=C.render({data,status:'ok',rows:[],total:0,counts:{'':0},dataset:'national',scopeKind:'state'});
 assert.doesNotMatch(nat,/Southern California/,'a national listings file covers every state');
 assert.equal(C.covers('ca','CA'),true);assert.equal(C.covers('ca','TX'),false);assert.equal(C.covers('national','TX'),true);
});

// W4-4 (2026-11-15, the owner's 2470x1286 window): twelve cards in five columns left an orphan row of two before Show 12 more
test('cards come in whole grid rows: 12, or 15 at five columns; Show more tops up to a row end; the column count is read off the grid',()=>{
 assert.deepEqual([1,2,3,4,5,6,7,8].map(c=>C.nextCount(0,c)),[12,12,12,12,15,12,14,16]);
 assert.equal(C.nextCount(15,5),30,'Show more at five columns: 15 more');
 assert.equal(C.nextCount(12,5),25,'twelve on screen after a resize to five columns: the next page ends on a row');
 assert.equal(C.nextCount(12,null),24,'no grid read yet: twelve at a time');
 assert.equal(C.nextCount(0,40),12,'never more than a page of columns');
 const data={person:'tanner',profile:{boxes:[]},deals};
 const rows=n=>Array.from({length:n},(_,i)=>deal('e000000000'+String(i).padStart(2,'0'),{}));
 assert.match(C.render({data,status:'ok',rows:rows(15),total:40,counts:{'':40},cols:5}),/data-cre-more="1">Show 15 more<\/button>/);
 assert.match(C.render({data,status:'ok',rows:rows(15),total:20,counts:{'':20},cols:5}),/>Show 5 more</,'never more than are left');
 assert.match(C.render({data,status:'ok',rows:rows(12),total:40,counts:{'':40},cols:4}),/>Show 12 more</);
 assert.match(C.render({data,status:'loading',rows:[],counts:{}}),/<div class="cards cre-cards"><div class="card skel-card">/,'the loading cards sit in the same grid');
 const live=csrc.slice(csrc.indexOf('// ==== DECK CRE PURE END'));
 assert.match(live,/S\.cols=colsOf\(\);const want=D\.nextCount\(S\.offset,S\.cols\)/);
 assert.match(live,/all\.slice\(0,want\)/);assert.match(live,/limit:want-S\.offset/);
 assert.match(live,/getComputedStyle\(g\)\.gridTemplateColumns/);
 assert.match(live,/\.filter\(x=>\/px\$\/\.test\(x\)\)\.length;return n\|\|S\.cols/,'a hidden grid answers repeat(...), which is not a column count');
});

test('chips: All deals first with its count, each box with its count, New buy box last; 12 cards then Show 12 more',()=>{
 const data={person:'tanner',profile:{boxes:[{id:'mf',name:'MF 5+',f:{}},{id:'oc',name:'Orange County',f:{}}]},deals};
 const rows=Array.from({length:12},(_,i)=>deal('d000000000'+String(i).padStart(2,'0'),{}));
 const h=C.render({data,status:'ok',rows,total:30,counts:{'':1734,mf:125,oc:9}});
 const order=[...h.matchAll(/<button type="button"[^>]*>([^<]+)(?:<small>([^<]+)<\/small>)?<\/button>/g)].map(m=>m[1]+(m[2]?' '+m[2]:''));
 assert.deepEqual(order.slice(0,4),['All deals 1,734','MF 5+ 125','Orange County 9','New buy box']);
 assert.equal((h.match(/class="card deal"/g)||[]).length,12);
 assert.match(h,/data-cre-more="1">Show 12 more<\/button>/);
 assert.match(C.render({data,status:'ok',rows,total:17,counts:{}}),/Show 5 more/);
});

test('viewer: only their own boxes, no other desks, no co-invest views',()=>{
 const data={person:'jordan',viewer:true,profile:{label:'Jordan',boxes:[{id:'mf',name:'MF 5+',f:{}}]},people:undefined,deals};
 const h=C.render({data,status:'ok',viewer:true,rows:deals,total:4,counts:{'':4,mf:2},cap:60000});
 assert.doesNotMatch(h,/data-cre-person/);assert.doesNotMatch(h,/Co-invest|Small deals/);
 assert.deepEqual([...h.matchAll(/data-cre-box="([^"]*)"/g)].map(m=>m[1]),['','mf']);
 // the owner sees the desk switch and, with a budget, the co-invest views
 const own=C.render({data:{person:'tanner',profile:{boxes:[]},people:[{id:'tanner',label:'Tanner'},{id:'jordan',label:'Jordan Example'}],deals},status:'ok',rows:deals,total:4,counts:{},cap:60000,person:'tanner'});
 assert.match(own,/data-cre-person="jordan"/);assert.match(own,/Co-invest with Jordan/);
});

test('buy box save: the same POST body as before; unknown keys never sent; carried keys kept; ids never collide',()=>{
 const boxes=[{id:'retail',name:'Retail',f:{types:['Retail'],units_min:5,sort:'cap'}}];
 const edit=C.boxPayload('tanner',{name:'Retail',types:['Retail','Office'],price_max:'$3,000,000',cap_min:'6.5',dom_max:'',counties:[],places:'92647, 926, Huntington Beach'},boxes[0],boxes);
 assert.deepEqual(edit,{person:'tanner',op:'box',box:{id:'retail',name:'Retail',f:{units_min:5,sort:'cap',types:['Retail','Office'],price_max:3000000,cap_min:6.5,zips:['92647','926'],q:'Huntington Beach'}}});
 const allowed=['types','counties','zips','price_min','price_max','cap_min','units_min','sf_min','dom_max','score_min','dscr_min','q','sort'];
 for(const k of Object.keys(edit.box.f))assert.ok(allowed.includes(k),'the server refuses unknown filter keys: '+k);
 const fresh=C.boxPayload('tanner',{name:'Retail',types:[],places:''},null,boxes);
 assert.equal(fresh.box.id,'retail-2');assert.deepEqual(fresh.box.f,{});
 assert.deepEqual(C.boxPayload('tanner',{name:' '},null,[]),{error:'Name the buy box first.'});
 assert.match(C.boxPayload('tanner',{name:'X',places:'Irvine, Tustin'},null,[]).error,/One city per buy box/);
 assert.match(C.boxPayload('tanner',{name:'X',cap_min:'abc'},null,[]).error,/Numbers only/);
});

test('buy box sheet: Save is one tap, Delete arms for a second tap, alerts say where they stand',()=>{
 const data={person:'tanner',types:['Multifamily','Retail','Other'],profile:{boxes:[],seen:{mf:{ids:['aaaaaaaaaaa1']}}},deals};
 const box={id:'mf',name:'MF',f:{types:['Multifamily'],price_max:2000000}};
 const s=C.boxSheet(box,{data});
 assert.match(s.actions,/data-cre-save="1">Save<\/button>/);assert.match(s.actions,/data-cre-del="mf">Delete<\/button>/);
 assert.match(C.boxSheet(box,{data,armDel:true}).actions,/class="b armed" data-cre-del="mf">Tap again to delete/);
 assert.match(s.body,/1 new since you last marked this box seen\./);
 assert.match(s.body,/data-cre-tog="types" data-v="Multifamily" aria-pressed="true"/);
 assert.doesNotMatch(s.body,/data-v="Other"/);
 assert.doesNotMatch(C.boxSheet(null,{data}).actions,/data-cre-del/,'a new box has nothing to delete');
});

test('deal sheet: numbers it has, missing ones named once, two financing rates, the foot line, an outside listing link',()=>{
 const d=Object.assign(deal('aaaaaaaaaaa2',{cap:{value:7.4,kind:'estimate'}}),{noi_v:{value:148000,kind:'estimate'},grm:11.1,dscr_res:1.2,coc_res:3.1,dscr_cre:1.1,coc_cre:2.2,
  flags:['Price per SF is under a third of nearby comps.'],parcel:{apn:'12345678',zoning:'M1',land_use:'Light industrial (SCAG code 1310)'},score_parts:{yield:70,price:80,market:60,motion:0},
  url:'https://example.com/listing/1',broker:'Fixture Brokerage',cuts:[{at:1794000000,from:2100000,to:1900000,pct:9.5}]});
 const data={rates:{mortgage_30y:{value:7.11},commercial:{value:7.35,kind:'assumption'}},assumptions:{}};
 const s=C.dealSheet(d,{data,zipLink:true});
 assert.match(s.body,/<p class="missing">Not reported: price per unit, units, lot size, year built, occupancy, tenancy, lease term\.<\/p>/);
 assert.equal((s.body.match(/class="missing"/g)||[]).length,1,'missing values named once');
 assert.ok(s.body.indexOf('Check before relying')<s.body.indexOf('Numbers'));
 assert.match(s.body,/At the 30-year rate of 7\.11%/);assert.match(s.body,/At the commercial rate of 7\.35%, est\./);
 assert.match(s.body,/Asking prices\. Confirm every number with the offering memo\./);
 assert.match(s.actions,/<a class="btn btn-primary ext" href="https:\/\/example\.com\/listing\/1" target="_blank" rel="noopener noreferrer">Open listing<\/a>/);
 assert.match(s.actions,/data-sheet="data"/);
 assert.match(s.body,/Light industrial</,'the land-use code is method, not a page word');
 assert.match(s.body,/data-cre-zip="92614"/,'Area links to the ZIP sheet');
 assert.doesNotMatch(C.dealSheet(d,{data}).body,/data-cre-zip/,'no ZIP link on /cre');
 assert.doesNotMatch(s.body,/Lee &amp; Associates|SCAG|FRED|ZORI/,'no source names on the sheet');
 assert.doesNotMatch(s.body+s.actions,/\d{4}-\d{2}-\d{2}/,'no ISO dates');
 assert.match(s.body,/Price cut, Nov \d+(, \d{4})?<\/dt><dd>\$2\.10M to \$1\.90M \(\u22129\.5%\)/);
});

test('your stake: budget-derived amounts stay masked until Show amounts, and never leak a digit',()=>{
 const a={closing:0.02,res:{ltv:0.75},cre:{ltv:0.65}};
 const big=deal('bbbbbbbbbbb1',{type:'Multifamily',units:12,price:3000000,coc_cre:6,dscr_cre:1.3});
 const k=C.stake(big,60000,a);
 assert.equal(Math.round(k.need),1110000);assert.equal(Math.round(k.equity),60000);assert.equal(Math.round(k.cash_flow),3600);assert.equal(k.fits,true);
 const masked=C.dealSheet(big,{data:{assumptions:a},myCap:60000,revealed:false,canReveal:true}).body;
 const part=masked.slice(masked.indexOf('Your stake'));
 assert.match(part,/Your equity<\/dt><dd>\$\u2022\u2022\u2022/);assert.doesNotMatch(part,/\$60K|\$3,600|\$4K|5\.4/);
 assert.match(part,/data-cre-reveal="1">Show amounts/);
 const shown=C.dealSheet(big,{data:{assumptions:a},myCap:60000,revealed:true}).body;
 assert.match(shown,/Your equity<\/dt><dd>\$60K/);
 // co-invest views on the owner's desk
 const s={cap:60000,data:{assumptions:a,boxes_of:{jordan:[{id:'mf',f:{types:['Multifamily'],units_min:5}}],riley:[{id:'ind',f:{types:['Industrial']}}]}}};
 assert.equal(C.inView(big,'jordan',s),true);assert.equal(C.inView(big,'riley',s),false);
 assert.equal(C.stake(big,null,a),null);
});

test('cap rate by price: solid listed, hollow estimated, a dashed loan-rate line named at its end, a legend for the dots',()=>{
 const rows=[deals[0],deals[1],deal('ccccccccccc2',{price:5000000,cap:{value:5.5,kind:'listed'}}),deal('ccccccccccc3',{price:800000,cap:{value:9.1,kind:'estimate'}}),deals[2]];
 const m=C.scatterModel(rows,7.35);
 assert.equal(m.n,4,'deals without a cap are left out');assert.equal(m.listed,2);
 assert.equal(m.pts.filter(p=>p.est).length,2);
 for(const p of m.pts){assert.ok(p.x>=0&&p.x<=100&&p.y>=0&&p.y<=100)}
 assert.ok(m.ticks.length<=4);
 const h=C.scatter(rows,7.35);
 assert.equal((h.match(/class="pt est"/g)||[]).length,2);assert.equal((h.match(/class="pt"/g)||[]).length,2);
 assert.match(h,/class="loan"/);assert.match(h,/Listed cap.*Estimated cap/s);
 assert.doesNotMatch(h,/class="now"/,'signal stays off chart series (critique 14)');
 assert.match(C.scatter(rows.slice(0,2),7.35),/Too few deals with a cap rate to chart\./);
});

// V11, V21 (2026-11-15): the desk read as linear (only the two ends labelled on a log axis), the loan line floated unlabelled under the
// lowest tick, nothing said what the line means, and the overview drew the same kind of chart on a linear scale
test('cap rate charts: log price axis with ticks at 2, 5 and 10 million, a foot tick, the loan line named at its right end, one sentence',()=>{
 const at=(p,c,k)=>deal('dddddddd'+String(p).slice(0,4).padStart(4,'0'),{price:p,cap:{value:c,kind:k||'listed'}});
 const rows=[at(1290000,6.2),at(2400000,8.1,'estimate'),at(4100000,5.4),at(9000000,7.9),at(15500000,6.6)];
 const m=C.scatterModel(rows,7.35);
 assert.deepEqual(m.xticks.map(t=>t.label),['$2.00M','$5.00M','$10.00M']);
 // log: 2M to 5M and 5M to 10M sit at the distance their ratios give, not their differences
 const [a,b,c]=m.xticks.map(t=>t.x);assert.ok(Math.abs((b-a)/(c-b)-Math.log10(2.5)/Math.log10(2))<1e-9);
 assert.equal(m.ticks[0].label,'4%','a tick at the foot of the rate axis');assert.ok(m.ticks[0].y>95);
 assert.deepEqual(m.ticks.map(t=>t.label),['4%','6%','8%','10%']);
 const h=C.scatter(rows,7.35);
 assert.match(h,/<span class="xt" style="left:[\d.]+%">\$2\.00M<\/span><span class="xt" style="left:[\d.]+%">\$5\.00M<\/span><span class="xt" style="left:[\d.]+%">\$10\.00M<\/span>/);
 assert.doesNotMatch(h,/class="xt l"|\$1\.29M|\$15\.50M/,'round ticks replace the end values');
 assert.match(h,/<span class="lbl end" style="top:[\d.]+%">Loan rate 7\.35%<\/span>/);
 assert.match(h,/<p class="note sm cre-sc-cap">Above the line pays more than the loan costs\.<\/p><\/div>$/);
 assert.doesNotMatch(h,/lg-ln/,'the line is named on the chart, not in the legend');
 assert.match(h,/aria-label="5 deals by asking price and cap rate: 4 listed caps, 1 estimated; Loan rate 7\.35%"/);
 assert.doesNotMatch(C.scatter(rows,null),/cre-sc-cap|class="loan"/,'no loan rate, no line and no sentence');
 // a narrow range with fewer than two round values inside labels its two ends
 const near=[at(2100000,6),at(2500000,7),at(2900000,8)];
 assert.match(C.scatter(near,7),/<span class="xt l">\$2\.10M<\/span><span class="xt r">\$2\.90M<\/span>/);
 // a wide range keeps at most four ticks
 assert.ok(C.scatterModel([at(150000,6),at(900000,7),at(40000000,8)],7).xticks.length<=4);
 // the market overview draws price per SF against cap rate with the same chart
 const ov=C.overviewSheet(C.overviewModel(rows.map((d,i)=>Object.assign({},d,{ppsf:[80,180,260,420,1300][i]})),{rates:{commercial:{value:7.35}}}),{}).body;
 const sc=ov.slice(ov.indexOf('<h3>Price per SF against cap rate</h3>'));
 assert.match(sc,/<div class="cre-sc"><div class="chart" style="--ar:2\.4\/1" role="img" aria-label="5 deals by price per SF and cap rate/);
 assert.match(sc,/>\$100\/SF<\/span>.*>\$200\/SF<\/span>.*>\$500\/SF<\/span>.*>\$1,000\/SF<\/span>/s);
 assert.match(sc,/Loan rate 7\.35%<\/span>/);assert.match(sc,/Above the line pays more than the loan costs\./);
});

test('Data sheet parts carry the sources and method; the desk names only the listing site of each card (owner 2026-11-17)',()=>{
 const data={generated_at:1794600000,counts:{by_source:{'lee-associates':1034,matthews:188},listed_cap:114,estimated_cap:527},rates:{commercial:{value:7.35,kind:'assumption',src:'10-year Treasury 5.10% + 2.25% assumed spread'}},
  assumptions:{cre:{label:'10-year Treasury + 2.25%, 65% loan to value'}},method:{weights:[{part:'yield',weight:0.35,label:'Cap rate minus the commercial loan rate'}]},profile:{boxes:[]},deals};
 const p=C.dataParts(data);
 assert.deepEqual(p.sources.map(s=>s.name),['Lee & Associates','Matthews']);assert.equal(p.sources[0].gives,'1,034 listings');
 assert.ok(p.method.some(([k,v])=>k==='Listings'&&/California for now/.test(v)));
 assert.ok(p.method.some(([k,v])=>/Cap rate minus/.test(k)&&v==='35%'));
 assert.equal(p.setup[0].state,'blocked');
 const desk=C.render({data,status:'ok',rows:deals,total:4,counts:{'':4}});
 assert.doesNotMatch(desk,/FRED|HUD|Census|Listings by source|Desk built|Top \d+ of/);
 // each card's foot names the site its Listing link opens, and nothing else about where numbers come from
 assert.match(desk,/<p class="deal-foot"><span>40 days listed \u00b7 Lee &amp; Associates<\/span><\/p>/);
 assert.match(C.dataSheetHtml(p),/Lee &amp; Associates/);
});

test('formats follow blueprint 2.4: money, rates, changes with a true minus, counts; null is never zero',()=>{
 const f=C.fmt;
 assert.equal(f.money(1240000),'$1.24M');assert.equal(f.money(2900000),'$2.90M');assert.equal(f.money(845000),'$845K');assert.equal(f.money(9450),'$9,450');
 assert.equal(f.rate(7.183),'7.18%');assert.equal(f.share(17.14),'17.1%');assert.equal(f.chg(-1.3),'\u22121.3%');assert.equal(f.pt(-1.5),'\u22121.5 pt');
 assert.equal(f.count(12400),'12.4K');assert.equal(f.count(9450),'9,450');assert.equal(f.psf(412),'$412/SF');
 for(const k of ['money','rate','share','chg','count','psf','ratio','date','days'])assert.equal(f[k](null),null,k);
});

test('/cre: the viewer page uses the shared design files, not cre.css, and starts from a served file, not an inline script (X1)',()=>{
 const html=fs.readFileSync(path.join(root,'static/cre.html'),'utf8');
 for(const href of ['/tokens.css','/ui.css','/css/commercial.css'])assert.match(html,new RegExp('<link rel="stylesheet" href="'+href.replace(/\//g,'\\/').replace('.','\\.')+'">'));
 assert.doesNotMatch(html,/cre\.css|theme\.css|<style/);
 assert.match(html,/<link rel="preload" href="\/fonts\/Geist-Variable\.woff2" as="font" type="font\/woff2" crossorigin>/);
 assert.match(html,/viewport-fit=cover/);
 assert.deepEqual([...html.matchAll(/<script\b[^>]*>/g)].map(m=>m[0]),['<script src="/ui-core.js">','<script src="/guard.js">','<script src="/cre.js">','<script src="/cre-boot.js">'],'no inline script: the helpers, the guard, cre.js, then the start-up');
 assert.doesNotMatch(html,/\son[a-z]+=/i,'no inline handlers');
 assert.ok(!fs.existsSync(path.join(root,'static/cre.css')),'cre.css is gone');
});

test('Min DSCR: the floor reads the DSCR at the commercial rate; a deal with no DSCR fails a box that sets one; empty sends nothing',()=>{
 const a=deal('ddddddddddd1',{dscr_cre:1.4}),b=deal('ddddddddddd2',{dscr_cre:1.1}),none=deal('ddddddddddd3',{});
 assert.deepEqual([a,b,none].filter(d=>C.match(d,{dscr_min:1.25})).map(d=>d.id),['ddddddddddd1']);
 assert.deepEqual([a,b,none].filter(d=>C.match(d,{dscr_min:0})).map(d=>d.id),['ddddddddddd1','ddddddddddd2'],'a floor of 0 still drops a deal with no DSCR');
 assert.deepEqual([a,b,none].filter(d=>C.match(d,{})).map(d=>d.id).length,3,'no floor, no filter');
 const set=C.boxPayload('jordan',{name:'Covers debt',types:['Multifamily'],dscr_min:'1.2'},null,[]);
 assert.deepEqual(set,{person:'jordan',op:'box',box:{id:'covers-debt',name:'Covers debt',f:{types:['Multifamily'],dscr_min:1.2}}});
 const empty=C.boxPayload('jordan',{name:'Any',types:['Multifamily'],dscr_min:''},null,[]);
 assert.deepEqual(empty,{person:'jordan',op:'box',box:{id:'any',name:'Any',f:{types:['Multifamily']}}},'the saved payload is unchanged when the field is empty');
 assert.match(C.boxPayload('jordan',{name:'X',dscr_min:'-1'},null,[]).error,/Numbers only in Min DSCR/);
 assert.match(C.boxSheet({id:'mf',name:'MF',f:{dscr_min:1.25}},{data:{deals:[],profile:{}}}).body,/Min DSCR<input name="dscr_min" inputmode="decimal" value="1.25"/);
});

test('review fixes: a zero score part shows its number and no bar; outside coverage no California box is offered; box chips wrap',()=>{
 const d=Object.assign(deal('eeeeeeeeeee1',{}),{score_parts:{yield:70,price:100,market:60,motion:0}});
 const h=C.dealSheet(d,{data:{}}).body;
 assert.match(h,/<span>Seller motion<\/span><div><b>0<\/b><\/div>/,'zero: the number, no bar');
 assert.match(h,/<span>Price against comps<\/span><div><i style="--v:100%"><\/i><b>100<\/b>/);
 const data={person:'tanner',profile:{boxes:[{id:'all-oc',name:'Orange County, any type',f:{counties:['Orange County']}}]},deals};
 const tx=C.render({data,status:'ok',rows:[],total:0,counts:{'':0,'all-oc':0},dataset:'ca',scopeKind:'state'});
 assert.doesNotMatch(tx,/Orange County, any type|data-cre-box/,'no Southern California box under a Texas scope');
 assert.match(tx,/No listings tracked here yet\. Deals cover Southern California for now\./);
 const ca=C.render({data,status:'ok',rows:deals,total:4,counts:{'':4,'all-oc':2},dataset:'ca',scopeKind:'mine'});
 // layout audit P22 (2026-11-15): on a phone the chips are one sideways row with a fade at its end; from tablet up they wrap as whole labels
 assert.match(ca,/<div class="chips scroll cre-boxes"/,'one sideways row on a phone');
 // G10 (2026-11-15): at phone landscape two wrapped chip rows left room for one deal card; now one scrolling row there too
 const css=fs.readFileSync(path.join(__dirname,'../static/css/commercial.css'),'utf8');
 for(const [w,h,wrap] of [[390,844,false],[430,932,false],[932,430,false],[908,411,false],[834,1194,true],[1440,900,true],[1920,1080,true]])
  assert.equal(boxesWrap(css,w,h),wrap,w+'x'+h+(wrap?': whole labels from tablet up':': one sideways row'));
});

// does a rule of the sheet make the buy box chips wrap at w x h? Reads every @media block (min/max width/height, commas as or) and the
// rules outside them; .chips.scroll is one row unless such a rule applies
function boxesWrap(css,w,h){const on=q=>q.split(',').some(alt=>[...alt.matchAll(/\((min|max)-(width|height):(\d+)px\)/g)].every(([,mm,dim,v])=>{const x=dim==='width'?w:h;return mm==='min'?x>=+v:x<=+v}));
 const RULE=/\.chips\.scroll\.cre-boxes\{flex-wrap:wrap/;let out='',i=0,hit=false;
 for(const m of css.matchAll(/@media([^{]+)\{/g)){if(m.index<i)continue;let d=1,j=m.index+m[0].length;while(d&&j<css.length){if(css[j]==='{')d++;else if(css[j]==='}')d--;j++}
  out+=css.slice(i,m.index);if(RULE.test(css.slice(m.index,j))&&on(m[1]))hit=true;i=j}
 return hit||RULE.test(out+css.slice(i))}

test('E9: a desk that is not reporting says one fixed sentence; the server\'s reason is in the Data sheet\'s Setup list',()=>{
 const why='the realestate collector has not written cre-deals.json';
 const p=C.dataParts(null,why);
 assert.deepEqual(p.setup[0],{name:'Deal desk',line:'The realestate collector has not written cre-deals.json',state:'not_reporting'});
 assert.match(C.dataSheetHtml(p),/<b>Deal desk<\/b><small>The realestate collector has not written cre-deals\.json<\/small><\/div><div class="fr"><span class="pill bad"><span class="sd bad"><\/span>Not reporting<\/span>/);
 assert.equal(C.dataParts({deals:[]}).setup.length,1,'a desk that reports carries no not-reporting row');
 const src=fs.readFileSync(path.join(root,'static/cre.js'),'utf8'),live=src.slice(src.indexOf('// ==== DECK CRE PURE END'));
 assert.doesNotMatch(live,/S\.data=\{reason:|S\.data=Object\.assign\(\{\},S\.data,\{reason/,'the reason never rides in the desk data the page draws from');
 assert.match(live,/dataParts:scope=>\{const sc=String\(scope\|\|''\);return D\.dataParts\(S\.data,S\.status==='bad'\?S\.reason:'',/,'the deck\'s Data sheet gets the reason, and a deal\'s own bases when it names one');
});

// /cre and the guard (2026-11-15, after #378): the desk page loads the shared /guard.js, so its client errors reach the same report as the
// deck's; with no top bar on /cre, no answer at all reads Offline on the desk, and the desk reads again when the browser is back online
test('/cre loads the guard: a script error on the desk page is reported, with no DeckPages on the page',()=>{
 const vm=require('node:vm');
 const on={},posts=[];
 const ctx={URL,console,fetch:(u,o)=>{posts.push([u,JSON.parse(o.body)]);return Promise.resolve({ok:true})},addEventListener:(k,f)=>{on[k]=f}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'static/guard.js'),'utf8'),ctx);
 on.error({message:'boom',filename:'https://deck.example/cre.js?v=1',lineno:12,colno:3,error:Object.assign(new Error('boom'),{stack:'Error: boom\n    at f (https://deck.example/cre.js:12:3)'})});
 assert.deepEqual(posts,[['/api/client-error',{e:'error',route:'',src:'cre.js',line:12,col:3,msg:'boom'}]]);
 const html=fs.readFileSync(path.join(root,'static/cre.html'),'utf8');
 assert.ok(html.indexOf('/ui-core.js')<html.indexOf('/guard.js')&&html.indexOf('/guard.js')<html.indexOf('/cre.js'),'the guard runs before the desk, so an error in cre.js is caught');
});

test('/cre offline: no answer at all says Offline with Try again; a timeout or an HTTP error stays "not reporting"',()=>{
 const off=C.render({data:null,status:'bad',offline:true});
 assert.match(off,/<b class="es-t">Offline<\/b><p class="es-l">The desk reads again when the connection is back\.<\/p><button type="button" class="btn btn-sm es-retry" data-cre-retry="1">Try again<\/button>/);
 assert.doesNotMatch(off,/not reporting/);
 assert.match(C.render({data:null,status:'bad'}),/Deal desk is not reporting\.<\/b><button type="button" class="btn btn-sm es-retry" data-cre-retry="1">Try again/);
 const live=csrc.slice(csrc.indexOf('// ==== DECK CRE PURE END'));
 assert.match(live,/function offlineOf\(r\)\{return !shell&&!!r&&r\.status===0&&r\.error==='no answer'\}/,'only /cre, only no answer at all');
 assert.match(live,/if\(!shell&&typeof addEventListener==='function'\)addEventListener\('online',\(\)=>\{if\(S\.offline\)load\(\)\}\)/);
 assert.equal((live.match(/S\.offline=offlineOf\(r\)/g)||[]).length,2,'the desk read and the cards read');
});

test('a desk request that never settles ends in the not-reporting state, not a blank slot',async()=>{
 const never=()=>new Promise(()=>{});
 const r=await C.request(never,'/api/cre/deals',{},30);
 assert.deepEqual([r.ok,r.status,r.error],[false,0,'timed out']);
 assert.equal(C.TIMEOUT_MS,60000);
 assert.match(C.render({data:{reason:''},status:'bad'}),/Deal desk is not reporting\./);
 const ok=await C.request(async()=>({ok:true,status:200,json:async()=>({rows:[]})}),'/api/cre/deals',{},30);
 assert.deepEqual([ok.ok,ok.status],[true,200]);
 const nr=await C.request(async()=>({ok:true,status:200,json:async()=>({status:'not_reporting',reason:'x'})}),'/api/cre',{},30);
 assert.equal(nr.ok,false,'a not-reporting body is not ok');
 const src=fs.readFileSync(path.join(root,'static/cre.js'),'utf8');
 const live=src.slice(src.indexOf('// ==== DECK CRE PURE END'));
 assert.doesNotMatch(live,/[^.]fetch\(/,'the live desk never calls fetch directly: every call goes through request() or DeckPages.get');
 const page=fs.readFileSync(path.join(root,'static/pages/commercial.js'),'utf8');
 assert.doesNotMatch(page,/\bfetch\(/);
 const calls=(page.match(/DeckPages\.get\(/g)||[]).length;assert.ok(calls>=8);
 assert.equal((page.match(/\{timeout:60000\}\)/g)||[]).length,calls,'every DeckPages.get on the page carries the 60 s bound');
});

// the lean deals file (2026-11-17): ZIP facts once in data.zips, a comp is {id, mi}, no per-deal source sentences
test('lean file: the sheet reads ZIP facts from data.zips and comp rows from their own deals; old full rows still read',()=>{
 const near=deal('hhhhhhhhhhh2',{addr:'9 Elm St, Irvine, CA 92614',price:3000000,ppsf:300});
 const d=deal('hhhhhhhhhhh1',{type:'Multifamily',units:3,unit_rent:{value:2500,kind:'estimate',br:2},rent_src:'HUD FY2027 Small Area FMR for the ZIP, 2 bedroom',
  gross:{value:90000,kind:'estimate'},cf_mo:{value:-300,kind:'estimate'},loan:'res',dscr_res:0.9,coc_res:-1,comps:{n:3,median_ppsf:310,near:[{id:'hhhhhhhhhhh2',mi:1.2},{id:'gone00000000'}]}});
 const data={deals:[d,near],zips:{'92614':{rent:3100,pop:30000}},assumptions:{res:{label:'FRED 30-year fixed, 75% loan to value'},vacancy:0.05,expense_ratio:{Multifamily:0.4,_:0.3}}};
 const b=C.dealSheet(d,{data}).body;
 assert.match(b,/<b class="cre-addr">9 Elm St, Irvine, CA 92614<\/b>/,'the comp\'s address comes from its own deal');
 assert.match(b,/data-l="Distance">1\.2 mi<\/td>/);assert.match(b,/Address withheld/,'a comp no longer on the desk says so');
 assert.ok(b.includes('<dt>Typical rent</dt><dd>$3,100\u2060/\u2060mo</dd>'),'the ZIP facts come from data.zips');
 assert.match(b,/<dt>Cash flow, monthly<\/dt><dd>\u2212\$300 est\.<\/dd>/,'the cash flow sits under the deal\'s own loan');
 const own=new Map(C.dataParts(data,'',d).method);
 assert.equal(own.get('This deal, income'),'3 listed units x $2,500/mo per unit x 12, less 5% vacancy and 40% expenses (assumptions)');
 assert.equal(own.get('This deal, cash flow'),'NOI less yearly debt service, FRED 30-year fixed, 75% loan to value, shown monthly');
 assert.equal(own.get('This deal, rent'),'HUD FY2027 Small Area FMR for the ZIP, 2 bedroom');
 assert.match(C.compareSheet([d,near],data).body,/<th scope="row">ZIP household income<\/th>/);
 // a deal that still carries its own zip_f and full comp rows (the national file) reads as before
 const old=deal('hhhhhhhhhhh3',{zip_f:{rent:1800},comps:{n:3,median_ppsf:200,near:[{id:'x0000000000x',addr:'1 Old Rd',price:1000000,ppsf:150,mi:0.4}]},gross:{value:1,kind:'estimate',src:'listed NOI grossed up'}});
 const ob=C.dealSheet(old,{data}).body;
 assert.match(ob,/1 Old Rd/);assert.ok(ob.includes('$1,800\u2060/\u2060mo'));
 assert.equal(new Map(C.dataParts(data,'',old).method).get('This deal, income'),'listed NOI grossed up');
});
