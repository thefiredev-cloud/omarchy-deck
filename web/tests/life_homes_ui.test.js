// Offline fixtures for the Homes column: owner markets first, numbers with publishers and dates,
// explicit unavailability. The live API payload is rendered separately during verification.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../static/deck.js'),'utf8');
const a=src.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const b=src.indexOf('// ==== DECK V6 UI HELPERS END ====');
// Only trusted checkout JavaScript enters the function body. Fixture/API values remain arguments.
const D=new Function(src.slice(a,b)+'\nreturn DeckUI;')();
const NOW=Date.UTC(2026,10,28,9,0,0);
const T=Math.floor(NOW/1000);

const area=(o)=>Object.assign({slug:'x',name:'Area',tier:'oc',level:'county',zip:null,zhvi:null},o);
const feed=(market)=>Object.assign({
 t:T,refresh:3600,src:['fixture'],errors:[],homes:[],commercial:[],market:market||{},
},{});

const residential={
 generated_at:T,
 areas_with_zhvi:3,
 scope:{home:'Dana Point, CA',order:['Dana Point','Orange County','United States'],us_selectable:true},
 areas:[
  area({slug:'zip-92629',name:'Dana Point',tier:'home',level:'zip',zip:'92629',
   zhvi:{value:1780453.5,as_of:'2026-09-30',yoy_pct:4.12},
   list_price:{value:1800000,as_of:'2026-09-30'},
   sale_price:{value:1650000,as_of:'2026-08-31'},
   days_to_pending:{value:29,as_of:'2026-09-30'},
   active_listings:61,days_on_market:44}),
  area({slug:'zip-92624',name:'Capistrano Beach',tier:'south_oc',level:'zip',zip:'92624',
   active_listings:12,days_on_market:44}),
  area({slug:'orange-county-ca',name:'Orange County',tier:'oc',
   zhvi:{value:1174873.29,as_of:'2026-09-30',yoy_pct:3.2},
   inventory:{value:6728,as_of:'2026-09-30',yoy_pct:-0.41},
   list_price:{value:1218217,as_of:'2026-09-30'},
   sale_price:{value:1150000,as_of:'2026-08-31'},
   days_to_pending:{value:25,as_of:'2026-09-30'}}),
  area({slug:'united-states',name:'United States',tier:'us',level:'us',
   zhvi:{value:366157.15,as_of:'2026-09-30',yoy_pct:1.19}}),
 ]};
const mortgage={rate_30y:{value:7.32,as_of:'2026-10-22',series:'MORTGAGE30US'},
 rate_15y:{value:6.68,as_of:'2026-10-22',series:'MORTGAGE15US'},source:'FRED'};
const commercial_indicators={
 price_growth:{value:6.58,as_of:'2026-01-01',unit:'percent_annualized',series:'COMREPUSQ159N'},
 loan_balance_bn:{value:3139.98,as_of:'2026-09-01',unit:'billions_usd',series:'CREACBM027SBOG'},
 vacancy:{status:'unavailable',reason:'No free public metro office, industrial or retail vacancy series.'}};

// cluster_take stays in the fixture: older feeds still carry it, and the deck must not draw it (owner order 2026-11-11: data only, no AI prose)
const full=()=>feed({residential,mortgage,commercial_indicators,
 cluster_take:{t:T-3600,model:'DeepSeek-V4.1-Flash-1017-EXL3',text:'OC values are up 3.2 percent. Commercial prices are up 6.6 percent annualized.',cached:true}});

test('default scope lists Dana Point before Orange County and the United States',()=>{
 const html=D.homes(full(),NOW);
 const list=html.slice(html.indexOf('class="hm-list"'),html.indexOf('Zillow Research: value'));
 const iHome=list.indexOf('Dana Point'),iCounty=list.indexOf('Orange County'),iUS=list.indexOf('United States');
 assert.ok(iHome>0,'Dana Point rendered');
 assert.ok(iCounty>iHome,'Orange County after Dana Point');
 assert.ok(iUS>iCounty,'United States after Orange County');
});

test('ZHVI level and one year change carry publisher and date',()=>{
 const html=D.homes(full(),NOW);
 assert.match(html,/\$1\.17M<\/b><small>ZHVI \+3\.2% 1y/);
 assert.match(html,/\$1\.78M<\/b><small>ZHVI \+4\.1% 1y/);
 assert.match(html,/Zillow ZHVI as of 2026-09-30/);
});

test('inventory, list, sale and days on market render as real numbers',()=>{
 const html=D.homes(full(),NOW);
 assert.match(html,/inv 6,728/);
 assert.match(html,/list \$1\.80M/);
 assert.match(html,/sale \$1\.65M/);
 assert.match(html,/25d to pending/);
 assert.match(html,/44d on market/);
});

test('mortgage rates show both terms with the FRED date',()=>{
 const html=D.homes(full(),NOW);
 assert.match(html,/7\.32%/);assert.match(html,/6\.68%/);assert.match(html,/FRED 2026-10-22/);
});

test('the cluster take is gone: no block, no model name, no prose, whatever the feed carries',()=>{
 const f=full(),un=full();un.market.cluster_take={status:'unavailable',reason:'local cluster did not answer'};
 for(const html of [D.homes(f,NOW),D.homes(un,NOW)]){
  assert.doesNotMatch(html,/Cluster take|hm-take|DeepSeek|Commercial prices are up|local cluster did not answer/);
 }
 // Jobs keeps its own local cluster take on a posting's sheet (Life lane); Markets has none
 assert.doesNotMatch(src,/Cluster take|market\.cluster_take|marketTake|hm-take/);
});

test('United States scope hides the ZIP rows and My markets brings them back',()=>{
 const us=D.homes(full(),NOW,{scope:'us'});
 assert.doesNotMatch(us,/92629/);
 const mine=D.homes(full(),NOW,{scope:'markets'});
 assert.match(mine,/92629/);
});

test('a missing series prints -- and never a fabricated zero',()=>{
 const f=full();
 f.market.residential.areas[1].zhvi=null;
 f.market.residential.areas[1].inventory=null;
 const html=D.homes(f,NOW);
 assert.match(html,/no ZHVI/);
 assert.doesNotMatch(html,/inv 0\b/);
});

test('feed values cannot inject HTML',()=>{
 const f=full();
 f.market.residential.areas[0].name='<img src=x>';
 const html=D.homes(f,NOW,{});
 assert.doesNotMatch(html,/<img|<script>/);
 assert.match(html,/&lt;img/);
});

test('a feed without market series still renders the homes column',()=>{
 const html=D.homes(feed({}),NOW);
 assert.match(html,/Homes/);
});
