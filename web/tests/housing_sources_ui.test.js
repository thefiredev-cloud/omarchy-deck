// Offline fixtures. The actual API payload is rendered separately during verification.
// 2026-11-01 (owner order): the national housing price records block (per-source health rows, State and ZIP controls,
// per-source records) left the housing view. 2026-11-14: Today's homes list and its source summary tile left Today too (lane PgToday).
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
const NOW=Date.UTC(2026,9,10,8,0,0);
const feed=(sources)=>({t:NOW/1000,age:0,stale:false,refresh:21600,src:'fixture.json',homes:[],commercial:[],market:{feed_sources:{checked_at:NOW/1000,sources}}});
const source=(o)=>Object.assign({id:'fixture',name:'Fixture vendor',kind:'property_records',status:'ok',count:1,records:[],coverage:'NOT listings',checked_at:NOW/1000,data_as_of:'2024',docs:'https://example.invalid'},o);
const national=(records)=>{const f=feed([source({name:'Zillow',kind:'market_statistics',records})]);f.market.feed_sources.scope={country:'US',states:['AK','HI','NJ','TX'],districts:['DC']};f.market.legacy_inventory_scope='South Orange County legacy snapshot only; NOT nationwide inventory';return f;};

test('the summary separates responding enrichment from additional listing feeds',()=>{
 const f=feed([source({id:'parcel'}),source({id:'rentcast',kind:'listings',status:'needs_key',count:null})]);
 const html=D.housingSources(f,NOW);
 assert.match(html,/2 configured/);assert.match(html,/1 responding/);
 assert.match(html,/0 additional listing feeds/);assert.match(html,/1 enrichment sources/);
 assert.doesNotMatch(html,/2 live/);
});

test('stale and failed sources are not counted as responding',()=>{
 assert.match(D.housingSources(feed([source({status:'stale'}),source({status:'error'})]),NOW),/0 responding/);
});

test('the housing view carries no national records block, controls or per-source rows',()=>{
 const f=national([{zip:'77494',state:'TX',city:'Katy',metric:'ZHVI',value:123,currency:'USD',as_of:'2026-08-31'},{zip:'08701',state:'NJ',city:'Lakewood',metric:'ZHVI',value:456,currency:'USD',as_of:'2026-08-31'}]);
 for(const html of [D.homes(f,NOW)]){
  assert.doesNotMatch(html,/Whole United States|value="AK"|data-housing-state|data-housing-zip|data-housing-apply|matching records|Katy|Lakewood|Source health and coverage|Housing source adapters/);
  // the legacy note still says what the old inventory snapshot was
  assert.match(html,/NOT nationwide inventory/);
 }
});

test('the old Markets > Housing glue is gone (SeeCode C9): Real estate paints from pages/realestate.js',()=>{
 assert.doesNotMatch(src,/data-housing-apply|HOUSING\.state=|HOUSING\.zip=/);
 assert.doesNotMatch(src,/function hLoad\(|const HKINDS=|const HSG=|function hZipSheet\(|function hProForma\(/);
});

test('legacy feed without adapter data still renders',()=>{
 const html=D.homes({t:NOW/1000,stale:false,homes:[],commercial:[],market:{}},NOW);
 assert.doesNotMatch(html,/Housing source adapters/);assert.match(html,/Homes/);
 assert.equal(D.housingSources({t:NOW/1000,market:{}},NOW),'');
});
