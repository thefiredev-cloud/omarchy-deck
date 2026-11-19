// Deal desk restore (2026-11-15, parity rows 63-66, 70, 71): filters and sort without saving a box, the market overview tables and
// charts, the "N new" count on box chips, ZIP facts in the /cre deal sheet, gross rent and the broker's pro forma cap. Synthetic deals
// that follow the cre-deals.json contract; no network.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {measure}=require('./speed.js');
const root=path.join(__dirname,'..');
const block=(file,a,b)=>{const s=fs.readFileSync(path.join(root,file),'utf8');return s.slice(s.indexOf(a),s.indexOf(b))};
const CRE=block('static/cre.js','// ==== DECK CRE PURE BEGIN','// ==== DECK CRE PURE END ====');
const DeckUI=new Function(block('static/deck.js','// ==== DECK V6 UI HELPERS BEGIN','// ==== DECK V6 UI HELPERS END ====')+'\nreturn DeckUI;')();
// /cre: no deck.js, so no DeckUI. Inside the deck: DeckUI is a global the desk finds when it draws.
const C=new Function(CRE+'\nreturn DeckCRE;')();
const CD=new Function('DeckUI',CRE+'\nreturn DeckCRE;')(DeckUI);
const text=h=>h.replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
const SOURCE_WORDS=/Zillow|ZORI|Census|ACS\b|HUD|FRED|IPEDS|County Health|Lee &amp; Associates|Matthews|cre-deals|\.json/;

const deal=(id,o)=>Object.assign({id,addr:id+' Main St, Irvine, CA 92614',city:'Irvine',state:'CA',zip:'92614',county:'Orange County',metro:'Los Angeles-Long Beach-Anaheim, CA',
 type:'Industrial',price:2000000,sqft:10000,ppsf:200,score:50,source:'lee-associates'},o);
const deals=[
 deal('aaaaaaaaaaa1',{type:'Multifamily',units:12,ppu:250000,cap:{value:6.1,kind:'listed'},score:72,county:'Los Angeles County',zip:'90001',city:'Los Angeles',dom:{days:40}}),
 deal('aaaaaaaaaaa2',{cap:{value:7.4,kind:'estimate'},score:64,dom:{days:200},sqft:24000,ppsf:150,price:3600000}),
 deal('aaaaaaaaaaa3',{type:'Office',price:900000,ppsf:300,score:null,dom:{days:5}}),
 deal('aaaaaaaaaaa4',{type:'Multifamily',units:4,price:1500000,county:'San Diego County',metro:'San Diego-Chula Vista-Carlsbad, CA',zip:'92101',city:'San Diego',score:58,dom:{days:90},listed_at:1794000000}),
 deal('aaaaaaaaaaa5',{type:'Retail',state:'TX',county:'Dallas County',metro:'Dallas-Fort Worth-Arlington, TX',zip:'75201',city:'Dallas',price:null,ppsf:null,score:40,dom:{days:12}})];
const ids=rs=>rs.map(d=>d.id.slice(-1)).join('');

test('filters: the sheet narrows the deals in view by every field the old desk had, and never reads a blank as 0',()=>{
 const run=(f,extra)=>ids(C.localRows(deals,Object.assign({data:{deals},f},extra)));
 assert.equal(run({types:['Multifamily']}),'14');
 assert.equal(run({counties:['Orange County']}),'23','county is the deal\'s own county');
 assert.equal(run({price_min:1000000,price_max:2500000}),'14','a deal with no price never passes a price bound');
 assert.equal(run({cap_min:7}),'2');
 assert.equal(run({units_min:5}),'1');
 assert.equal(run({sf_min:20000}),'2');
 assert.equal(run({dom_max:30}),'53');
 assert.equal(run({q:'san diego'}),'4');assert.equal(run({q:'921'}),'4','ZIP or city in one box');
 const f=C.readFilters({price_min:'$1,000,000',price_max:'',cap_min:'6.5%',units_min:'abc',sf_min:' ',dom_max:'-3',q:'  Irvine '},{types:['Retail',7,''],counties:[]});
 assert.deepEqual(f,{types:['Retail'],price_min:1000000,cap_min:6.5,q:'Irvine'},'junk and empty fields are left out, never 0');
 assert.equal(C.filterCount(f),4);assert.equal(C.filterCount({}),0);assert.equal(C.filterCount({sort:'cap'}),0,'the sort is not a filter');
});

test('sort: score, cap, price, $/SF, days on market and newest; a missing value goes last',()=>{
 const run=s=>ids(C.localRows(deals,{data:{deals},f:{},sort:s}));
 assert.equal(run('score'),'12453');assert.equal(run('cap'),'21345');assert.equal(run('price'),'34125');
 assert.equal(run('ppsf'),'21435');assert.equal(run('dom'),'24153');assert.equal(run('newest').charAt(0),'4','a listing date is the newest');
 assert.deepEqual(C.SORTS.map(s=>s[0]),['score','cap','price','ppsf','dom','newest'],'the same sort names /api/cre/deals takes');
 assert.match(C.dealsQuery({person:'tanner',sort:'ppsf'}),/sort=ppsf/,'a sort alone still pages on the server');
});

test('filters stack on the page scope, the buy box and the investor view; the page scope reads state, counties and metro',()=>{
 const base={data:{deals,profile:{boxes:[{id:'mf',name:'MF',f:{types:['Multifamily']}}]}},f:{}};
 assert.equal(ids(C.localRows(deals,Object.assign({},base,{scope:'state=TX'}))),'5');
 assert.equal(ids(C.localRows(deals,Object.assign({},base,{scope:'state=CA&county=Orange%2CLos%20Angeles'}))),'123');
 assert.equal(ids(C.localRows(deals,Object.assign({},base,{scope:'metro=San%20Diego-Chula%20Vista-Carlsbad%2C%20CA'}))),'4');
 assert.equal(ids(C.localRows(deals,Object.assign({},base,{typeName:'Office'}))),'3','the page type switch');
 assert.equal(ids(C.localRows(deals,Object.assign({},base,{price_max:1600000}))),'43','the page max price drops a deal with no price');
 assert.equal(ids(C.localRows(deals,Object.assign({},base,{boxId:'mf',f:{units_min:5}}))),'1','the Filters sheet narrows a buy box further');
 assert.equal(ids(C.localRows(deals,Object.assign({},base,{boxId:'gone'}))),'12453','an unknown box id narrows nothing');
 for(const bad of [null,'x',[1],{},undefined])assert.doesNotThrow(()=>C.localRows([bad,deals[0]],{data:{},f:{types:['Multifamily']}}));
 assert.equal(C.localRows([null,'x',deals[0]],{f:{}}).length,1,'a hostile row is skipped');
});

test('Filter and sort sheet: the sort and every filter, applied at once, one Show button with the count; nothing in it saves a buy box',()=>{
 const sp=C.filterSheet({f:{types:['Office'],cap_min:6,q:'<b>x</b>'},sort:'dom'},37);
 assert.equal(sp.title,'Filter and sort');
 assert.match(sp.body,/<select data-cre-fsort="1">.*<option value="dom" selected>Longest on market<\/option>/);
 assert.deepEqual([...sp.body.matchAll(/<option value="([a-z]+)"/g)].map(m=>m[1]),['score','cap','price','ppsf','dom','newest']);
 assert.match(C.filterSheet({sort:'nope'},1).body,/<option value="score" selected>Best score/,'an unknown sort reads as the best score');
 for(const k of ['price_min','price_max','cap_min','units_min','sf_min','dom_max','q'])assert.match(sp.body,new RegExp('data-cre-f="'+k+'"'),k);
 assert.match(sp.body,/data-cre-ftog="types" data-v="Office" aria-pressed="true"/);assert.match(sp.body,/data-cre-ftog="counties" data-v="Ventura County"/);
 assert.match(sp.body,/data-cre-f="cap_min" inputmode="decimal" value="6"/);
 assert.doesNotMatch(sp.body,/<b>x<\/b>/);assert.match(sp.body,/value="&lt;b&gt;x&lt;\/b&gt;"/);
 assert.match(sp.actions,/data-close data-cre-fshow="1">Show 37 deals<\/button>/);assert.match(sp.actions,/data-cre-fclear="1">Clear/);
 assert.doesNotMatch(sp.body+sp.actions,/data-cre-save|data-cre-form|op:|POST/,'the sheet never writes a box');
 assert.equal(C.showLabel(1),'Show 1 deal');assert.equal(C.showLabel(1736),'Show 1,736 deals');assert.equal(C.showLabel(null),'Show deals');
});

// S2 (2026-11-15): Filters was drawn four ways; the desk's control is now the deck's one: the filter icon, the word Filters, the standard button
const FBTN=/<button type="button" class="btn" data-cre-filters="1" aria-haspopup="dialog" aria-label="Filters for deals(, \d set)?"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4"\/><\/svg>Filters/;
test('desk tools: one Filters control with the count of what is set, Market overview; a filtered desk with no match says so',()=>{
 const data={person:'tanner',profile:{boxes:[]},deals};
 const h=C.render({data,status:'ok',rows:deals.slice(0,2),total:2,counts:{'':5},f:{types:['Multifamily'],units_min:5},sort:'cap'});
 assert.match(h,FBTN);assert.match(h,/aria-label="Filters for deals, 3 set">.*Filters <span class="cnt">3<\/span><\/button>/,'two filters and a sort');
 assert.doesNotMatch(h,/Filter and sort<\/button>|btn-sm" data-cre-filters/,'not the old small "Filter and sort" button');
 assert.match(h,/<button type="button" class="btn" data-cre-ov="1" aria-haspopup="dialog">Market overview/);
 // 2026-11-17: the count of what is in view moved from the tools row to the count line over the cards, beside the sort
 assert.match(h,/data-cre-fclear="1">Clear<\/button><\/div>/);assert.doesNotMatch(h,/class="cre-n"/);
 assert.match(h,/<div class="cre-count"><p class="cre-cnt" role="status">2 deals match your filters<\/p><label class="cre-sort">Sort<select data-cre-sort="1"/);
 const sorted=C.render({data,status:'ok',rows:deals,total:5,counts:{'':5},f:{},sort:'price'});
 assert.match(sorted,/Filters <span class="cnt">1<\/span>/);assert.doesNotMatch(sorted,/class="cre-n"/,'a sort alone narrows nothing');
 const none=C.render({data,status:'ok',rows:[],total:0,counts:{'':5},f:{cap_min:20}});
 assert.match(none,/No deals match these filters\./);assert.doesNotMatch(none,/No deals match this buy box/);
 const plain=C.render({data,status:'ok',rows:deals,total:5,counts:{'':5}});
 assert.match(plain,/<\/svg>Filters<\/button>/);assert.doesNotMatch(plain,/data-cre-fclear|class="cre-n"/);
 const tx=C.render({data,status:'ok',rows:[],total:0,counts:{'':0},dataset:'ca',scopeKind:'state'});
 assert.doesNotMatch(tx,/cre-tools/,'outside coverage the coverage line stands alone');
 const viewer=C.render({data:{person:'jordan',viewer:true,profile:{boxes:[]},deals},status:'ok',viewer:true,rows:deals,total:5,counts:{}});
 assert.match(viewer,/cre-tools/,'a desk viewer filters too');assert.doesNotMatch(viewer,/data-cre-person/,'and still sees only the own desk');
 const css=fs.readFileSync(path.join(root,'static/css/commercial.css'),'utf8');
 assert.match(css,/html\.tv[^{]*\.cre-tools[^{]*\{display:none\}/,'nothing new on the TV board');
});

test('box chips: "N new" once a box has a baseline; none before it, none when nothing is new',()=>{
 const box={id:'mf',name:'MF',f:{types:['Multifamily']}};
 const chip=seen=>{const h=C.chips({data:{person:'tanner',profile:{boxes:[box],seen},deals},counts:{'':5,mf:2}});return h.slice(h.indexOf('data-cre-box="mf"'),h.indexOf('</button>',h.indexOf('data-cre-box="mf"')))};
 assert.match(chip({mf:{ids:['aaaaaaaaaaa1']}}),/<small>2<\/small><small class="cre-new">1 new<\/small>/);
 assert.doesNotMatch(chip({}),/new/,'no baseline yet');
 assert.doesNotMatch(chip({mf:{ids:['aaaaaaaaaaa1','aaaaaaaaaaa4']}}),/cre-new/,'nothing new');
});

test('overview model: medians by asset class, county and ZIP; listed caps only; ZIPs with 3 or more deals; the six charts',()=>{
 const many=deals.concat([deal('bbbbbbbbbbb1',{price:1000000,ppsf:100,cap:{value:5,kind:'listed'},cuts:[{at:1,from:2,to:1,pct:5}],dom:{days:400}}),deal('bbbbbbbbbbb2',{price:3000000,ppsf:250,dom:{days:0}})]);
 const m=C.overviewModel(many,{generated_at:1794600000,rates:{mortgage_30y:{value:7.11},treasury_10y:{value:5.1},commercial:{value:7.35,kind:'assumption'}}});
 const ind=m.tables.type.find(r=>r.k==='Industrial');
 assert.deepEqual([ind.n,ind.price,ind.ppsf,ind.cap,ind.dom],[3,3000000,150,5,200],'medians; the estimated 7.4% cap is not a listed cap');
 assert.equal(Math.round(ind.cuts),33);
 assert.deepEqual(m.tables.county.map(r=>r.k).sort(),['Dallas','Los Angeles','Orange','San Diego']);
 assert.deepEqual(m.tables.zip.map(r=>r.k),['92614'],'a ZIP needs 3 or more deals');
 assert.equal(m.dom.reduce((a,b)=>a+b.value,0),7,'every dated deal lands in one bucket');
 assert.equal(m.dom[0].value,2);assert.equal(m.dom[5].value,1);
 assert.equal(m.months.length,12);assert.equal(m.months[11].label,'Nov 2026');assert.equal(m.months.reduce((a,b)=>a+b.value,0),6,'the 400-day deal is older than a year');
 assert.deepEqual(m.rates.map(r=>r.label),['30-year mortgage','10-year Treasury','Commercial loan, est.','Median listed cap']);
 assert.equal(m.rates[3].text,'5.55%');
 assert.equal(m.pts.length,3);assert.equal(m.pts.filter(p=>p.est).length,1);
 assert.equal(C.overviewModel([],{}).n,0);
 assert.doesNotThrow(()=>C.overviewModel([null,'x',{},{dom:{days:'x'},cap:{value:'7'}}],{rates:'bad'}));
});

test('overview sheet: three sortable tables, a re-sort keeps its column and flips its direction, no source names, an empty desk says so',()=>{
 const m=C.overviewModel(deals,{generated_at:1794600000,rates:{commercial:{value:7.35}}});
 const sp=C.overviewSheet(m,{});
 assert.equal(sp.title,'Market overview');assert.equal(sp.sub,'5 deals');assert.equal(sp.wide,true);
 for(const t of ['By asset class','By county','By ZIP','Cap rate by asset class','Price per SF against cap rate','Days on market','Listings by county','Listings by month first listed','Rates against cap rates'])
  assert.match(sp.body,new RegExp('<h3>'+t.replace(/\$/g,'\\$')+'</h3>'),t);
 assert.equal((sp.body.match(/data-cre-ovt="/g)||[]).length,3);
 assert.match(sp.body,/^<div class="cre-ov"><div class="strip" data-n="4" data-nb="4"><div class="tile"><span class="h">Deals<\/span><b class="v">5<\/b>/,'the overview opens on a strip of headline medians');
 assert.match(sp.body,/<span class="h">Median listed cap<\/span><b class="v">6\.10%<\/b>/);
 assert.match(sp.body,/<div class="htw scroll">/,'the tables scroll sideways so the sort buttons stay on a phone');
 assert.match(sp.body,/<th scope="col" class="n" aria-sort="descending"><button type="button" class="sort" data-sort="n">Listings<\/button>/);
 assert.doesNotMatch(sp.body,SOURCE_WORDS);assert.doesNotMatch(sp.body,/\d{4}-\d{2}-\d{2}/);
 assert.match(sp.actions,/data-sheet="data"/,'sources are one tap away in the Data sheet');
 const byPrice=C.ovTable('county',m,{key:'price',dir:'ascending'});
 assert.match(byPrice,/aria-sort="ascending"><button type="button" class="sort" data-sort="price">/);
 const order=[...byPrice.matchAll(/<th scope="row"[^>]*><span class="place"><b>([^<]+)/g)].map(x=>x[1]);
 assert.deepEqual(order,['San Diego','Los Angeles','Orange','Dallas'],'by median price low to high; no price sorts last');
 assert.match(byPrice,/<span class="na" aria-label="No data">/,'a missing median is No data, never 0');
 assert.match(C.overviewSheet(C.overviewModel([],{}),{}).body,/No deals on the desk yet\./);
 const evil=C.overviewSheet(C.overviewModel([deal('ccccccccccc1',{type:'<img src=x onerror=alert(1)>'})],{}),{}).body;
 assert.doesNotMatch(evil,/<img/);
});

test('inside the deck the overview draws with DeckUI; /cre draws the same markup with its own copy; the cap rate chart is the desk\'s own',()=>{
 assert.equal(CD.UI(),DeckUI,'inside the deck the shared helpers are DeckUI\'s');
 assert.equal(C.UI(),C.LOCAL,'/cre has no DeckUI');
 const m=C.overviewModel(deals,{generated_at:1794600000,rates:{mortgage_30y:{value:7.11}}});
 assert.equal(CD.overviewSheet(m,{zip:{key:'k',dir:'ascending'}}).body,C.overviewSheet(m,{zip:{key:'k',dir:'ascending'}}).body,'the same sheet on both');
 const L=C.LOCAL,cols=[{key:'k',label:'Name',place:true,sort:true,sub:r=>r.s},{key:'v',label:'Value',num:true,sort:true,fmt:v=>v==null?null:v+'%'},{key:'w',label:'W',num:true,pri:3}];
 const rows=[{k:'b',v:2,s:'x',w:1},{k:'a',v:null,w:2},{k:'<c>',v:9}];
 for(const spec of [{cols,rows,sorted:{key:'v',dir:'descending'}},{cols,rows,max:2,id:'t',open:'zip',key:r=>r.k,label:'L'},{cols,rows,presorted:true,sorted:{key:'k',dir:'ascending'}}])
  assert.equal(L.table(spec),DeckUI.table(spec));
 for(const [items,o] of [[[{label:'A',value:3},{label:'B',value:null},{label:'<C>',value:12,text:'12 x',key:'c',on:true}],{}],[[{label:'A',value:0}],{sort:false}],[[],{}]])
  assert.equal(L.bars(items,o),DeckUI.bars(items,o));
 const r={min:0,max:14,p25:5.2,p75:7.9,med:6.4,fmt:v=>v.toFixed(1)+'%'};assert.equal(L.range(r),DeckUI.range(r));assert.equal(L.range({min:1,max:1}),DeckUI.range({min:1,max:1}));
 assert.deepEqual(L.sortRows(rows,'v','ascending'),DeckUI.sortRows(rows,'v','ascending'));
});

test('deal sheet: gross rent is marked an estimate, the pro forma cap is the broker\'s figure, neither is named missing',()=>{
 const d=deal('ddddddddddd1',{cap:{value:7.4,kind:'estimate'},noi_v:{value:148000,kind:'estimate'},gross:{value:205000,kind:'estimate'},proforma_cap:6.5});
 const b=C.dealSheet(d,{data:{}}).body;
 assert.match(b,/<dt>Gross rent, yearly<\/dt><dd><span class="capm est" aria-hidden="true"><\/span>\$205K est\.<\/dd>/);
 assert.match(b,/<dt>Pro forma cap<\/dt><dd>6\.50% \(broker\u2019s figure\)<\/dd>/);
 const none=C.dealSheet(deal('ddddddddddd2',{}),{data:{}}).body;
 assert.doesNotMatch(none,/Gross rent|Pro forma/);
 assert.doesNotMatch(none.slice(none.indexOf('class="missing"')),/gross rent|pro forma/,'optional numbers are not named as missing');
});

test('/cre deal sheet: the ZIP facts the viewers have no ZIP sheet for; the deck keeps its Area button',()=>{
 const z={rent:1870,rent_src:'zori',rent_yoy:3.71,pop:41180,hh_income:77106,vacancy:2.5,renter_share:29.26,homicide_rate:7.5,colleges_10mi:0,biz_estabs_5y:-8.57,area_grade:'C',c_score:65.1,fmr_1_2br:1795,fmr_year:'FY2027'};
 const d=deal('eeeeeeeeeee1',{zip:'92307',city:'Apple Valley',zip_f:z});
 const cre=C.dealSheet(d,{data:{}}).body,area=cre.slice(cre.indexOf('<h3>Area</h3>'));
 for(const [k,v] of [['Typical rent','$1,870\u2060/\u2060mo'],['Rent, 1-yr change','+3.7%'],['Fair market rent, 1 to 2 bedrooms','$1,795\u2060/\u2060mo'],['Population','41.2K'],['Household income','$77K'],
  ['Housing vacancy','2.5%'],['Renter share','29.3%'],['Homicides per 100K, county','7.5'],['Colleges within 10 miles','0'],['Businesses, 5-yr change','\u22128.6%'],['Area grade','C'],['Commercial score','65\u00a0of\u00a0100']])
  assert.ok(area.includes('<dt>'+k+'</dt><dd>'+v+'</dd>'),k+' '+v);
 assert.match(area,/<span class="code">92307<\/span> Apple Valley, CA/);
 assert.doesNotMatch(cre,SOURCE_WORDS,'no source names on the sheet');assert.doesNotMatch(cre,/FY2027|zori/);
 const part=C.dealSheet(deal('eeeeeeeeeee2',{zip_f:{rent:2000}}),{data:{}}).body;
 assert.match(part,/Not reported: rent change, fair market rent, population/,'missing facts are named once');
 assert.match(C.dealSheet(deal('eeeeeeeeeee3',{}),{data:{}}).body,/No area facts for this ZIP yet\./);
 assert.doesNotMatch(C.dealSheet(deal('eeeeeeeeeee4',{zip:''}),{data:{}}).body,/<h3>Area<\/h3>/,'no ZIP, no Area section');
 const deck=C.dealSheet(d,{data:{},zipLink:true}).body;
 assert.match(deck,/data-cre-zip="92307"/);assert.doesNotMatch(deck,/Typical rent/,'inside the deck the ZIP sheet carries the facts');
});

test('a phone-sized pass over 1,736 deals stays well inside one frame',()=>{
 const T=['Industrial','Office','Retail','Multifamily','Land'],CO=['Orange County','Los Angeles County','San Diego County','Riverside County'];
 const big=Array.from({length:1736},(_,i)=>deal(('f'+i).padStart(12,'0'),{type:T[i%5],county:CO[i%4],price:i%7?500000+i*3000:null,cap:i%3?{value:4+(i%60)/10,kind:i%2?'listed':'estimate'}:undefined,
  units:i%11?null:4+i%30,sqft:i%5?2000+i*10:null,ppsf:i%5?150+i%400:null,dom:{days:i%500},score:i%9?i%100:null,zip:String(90000+i%900),city:'City '+(i%40),
  zip_f:{rent:1500+i},cuts:i%50?[]:[{at:1,from:2,to:1,pct:3}]}));
 const s={data:{deals:big,profile:{boxes:[{id:'b',f:{counties:['Orange County']}}]}},boxId:'b',typeName:'Retail',scope:'state=CA',f:{cap_min:5,price_max:3000000,dom_max:300,q:'city 1'},sort:'cap'};
 // CPU per call against a calibration timed just before (tests/speed.js), so a loaded or throttled runner cannot fail it. On pc-desktop
 // a unit is 2.2 to 3 ms; filter and sort read 0.02 to 0.03 units, overview model and sheet 1.3 to 1.7 units, calm or throttled to a
 // tenth of a core (2026-11-15).
 const filt=measure(()=>C.localRows(big,s)),ov=measure(()=>C.overviewSheet(C.overviewModel(big,{generated_at:1794600000}),{}));
 const sp=C.overviewSheet(C.overviewModel(big,{generated_at:1794600000}),{});
 console.log('# filter+sort 1,736 deals: '+filt.took.toFixed(2)+' ms ('+filt.units.toFixed(2)+' units); overview model+sheet: '+ov.took.toFixed(1)+' ms ('+ov.units.toFixed(2)+' units); unit '+filt.unit.toFixed(2)+' ms; sheet '+sp.body.length+' chars');
 // 1 unit (2 to 3 ms here, a sixth of a 60 Hz frame) is 30 times the slowest pass seen. A second pass over the deals for each deal
 // (quadratic) read 8 to 12 units in a scratch copy: it fails.
 assert.ok(filt.units<1,'filter and sort well inside one frame: '+filt.units.toFixed(2)+' units of '+filt.unit.toFixed(2)+' ms');
 // 6 units (13 to 18 ms here) is 3.6 times the slowest overview seen (2.2 on Node 26, 1.7 on Node 22). The same quadratic pass in
 // the overview read 10 to 15 units: it still fails.
 assert.ok(ov.units<6,'overview well under a quarter second: '+ov.units.toFixed(2)+' units of '+ov.unit.toFixed(2)+' ms');
});

test('/cre: Filters and Overview sit in the head row beside Data; the desk draws no tools row of its own there',()=>{
 const data={person:'tanner',profile:{boxes:[]},deals};
 const head=C.headTools({data,status:'ok',rows:deals,total:5,counts:{'':5},f:{cap_min:6},sort:'price'});
 assert.match(head,FBTN,'the deck\'s one Filters control');
 assert.match(head,/aria-label="Filters for deals, 2 set">.*Filters <span class="cnt">2<\/span><\/button>/,'the one mark that the list is narrowed');
 assert.match(head,/data-cre-ov="1" aria-haspopup="dialog" aria-label="Market overview">Overview<\/button>$/);
 assert.match(C.headTools({data,status:'ok',counts:{'':5},f:{}}),/aria-label="Filters for deals">.*<\/svg>Filters<\/button>/);
 assert.equal(C.headTools({data:{status:'not_reporting'},status:'bad'}),'','a desk that is not reporting offers no tools');
 assert.equal(C.headTools({status:'loading'}),'');
 assert.equal(C.headTools({data,status:'ok',counts:{'':0},dataset:'ca',scopeKind:'state'}),'','outside coverage');
 const desk=C.render({data,status:'ok',rows:deals,total:5,counts:{'':5},f:{cap_min:6},headTools:true});
 assert.doesNotMatch(desk,/cre-tools|data-cre-filters|data-cre-ov/,'no row of its own on /cre');
 assert.match(C.render({data,status:'ok',rows:deals,total:5,counts:{'':5}}),/class="cre-tools"/,'inside the deck the tools stay with the desk');
 const html=fs.readFileSync(path.join(root,'static/cre.html'),'utf8');
 assert.match(html,/<div class="pact"><span class="cre-htools" id="cre-tools"><\/span><button type="button" class="btn btn-quiet" data-sheet="data">Data<\/button><\/div>/);
 assert.match(fs.readFileSync(path.join(root,'static/cre-boot.js'),'utf8'),/toolsEl:document\.getElementById\('cre-tools'\)/);
});

test('layout: the desk never sits beside a short block, and /cre keeps its head row on phone landscape',()=>{
 const css=fs.readFileSync(path.join(root,'static/css/commercial.css'),'utf8');
 // Commercial: one column at every size; only the TV board pairs ZIPs and desk
 assert.match(css,/\n\.com-main\{display:grid;grid-template-columns:minmax\(0,1fr\);grid-template-areas:"zips" "desk" "sc"/);
 assert.deepEqual([...css.matchAll(/([^}\n]*)\.com-main\{grid-template-columns:repeat\(2/g)].map(m=>m[1].trim()),['html.tv'],'two columns on the TV board only');
 assert.doesNotMatch(css,/"zips desk" "sc desk"/,'the old pairing left a 1,300 to 1,500 px hole');
 // /cre: one column at every size, and the head row (title, Filters, Overview, Data) is never handed to a bar it does not have
 assert.match(css,/\n\.cre-solo \.com-main\{grid-template-columns:minmax\(0,1fr\);grid-template-areas:"desk" "sc"\}/);
 assert.match(css,/\.cre-solo \.phead \.ptitle\{display:block\}/);assert.match(css,/\.cre-solo \.phead>\.pact\{display:flex\}/);
 const ui=fs.readFileSync(path.join(root,'static/ui.css'),'utf8');
 assert.match(ui,/\.phead>\.pact,\.phead \.fresh\{display:none\}/,'the deck hides the head row on L; /cre must win over it');
 assert.match(ui,/#pager \.phead \.ptitle\{position:absolute;/,'the deck title hides visually on L only inside the deck pager, never on /cre');
});
