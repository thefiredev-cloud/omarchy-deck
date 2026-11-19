// Housing feed quality (realestate feed): one listing counts once in the listing rows and on Homes,
// and a listing with no usable price is unknown: never $0 and never inside a budget.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../static/deck.js'),'utf8');
const a=src.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const b=src.indexOf('// ==== DECK V6 UI HELPERS END ====');
// Only trusted checkout JavaScript enters the function body. Fixture values remain data.
const D=new Function(src.slice(a,b)+'\nreturn DeckUI;')();
const NOW=Date.UTC(2026,10,13,9,0,0);
const T=Math.floor(NOW/1000);

const home=(o)=>Object.assign({addr:'100 Fixture Dr',price:1850000,currency:'USD',city:'Dana Point',type:'Single family',beds:4,baths:2.5,sqft:2359,
 source:'redfin',listed_at:T-7200,url:'https://www.redfin.com/CA/Dana-Point/100-Fixture-Dr/home/1'},o);
const com=(o)=>Object.assign({addr:'100 Harbor Blvd',price:2000000,currency:'USD',city:'Dana Point',type:'Office',sqft:4000,
 source:'commercialcafe',url:'https://www.commercialcafe.com/commercial-property/100-harbor/1'},o);
const feed=(o)=>Object.assign({t:T,refresh:3600,src:['redfin'],errors:[],market:{area:'Dana Point'},homes:[],commercial:[]},o);
// distinct listings after the merge, in the words the pages use ("2 homes · 1 commercial")
const counts=(r)=>{const H=D.homeRows(r);return [H.homes.length?H.homes.length+(H.homes.length===1?' home':' homes'):'',H.com.length?H.com.length+' commercial':''].filter(Boolean).join(' · ')};

test('a listing that comes back twice counts once in the rows and on Homes', () => {
  const again='https://www.redfin.com/CA/Dana-Point/100-Fixture-Dr/home/1?again';
  const cagain='https://www.commercialcafe.com/commercial-property/100-harbor/1?again';
  const r=feed({homes:[home(),home({url:again})],commercial:[com(),com({url:cagain})]});
  assert.equal(counts(r),'1 home · 1 commercial','totals count distinct listings');
  const page=D.homes(r,NOW,{page:'short'});
  assert.equal((page.match(/\$1\.85M/g)||[]).length,1);
  assert.equal((page.match(/\$2\.00M/g)||[]).length,1);
});

test('the same listing with a changed price counts once', () => {
  const r=feed({homes:[home(),home({price:1795000})],commercial:[com(),com({price:1950000})]});
  assert.equal(counts(r),'1 home · 1 commercial','totals count distinct listings');
  const page=D.homes(r,NOW,{page:'short'});
  assert.equal((page.match(/\$1\.85M|\$1\.80M/g)||[]).length,1);
  assert.equal((page.match(/\$2\.00M|\$1\.95M/g)||[]).length,1);
});

test('a non-USD listing price is unknown and never passes a USD budget', () => {
  const foreign=home({price:1850000,currency:'CAD',addr:'1 Foreign Ln'});
  assert.equal(D.listFilter([foreign],{within:true},2000000,'homes').length,0);
  const page=D.homes(feed({homes:[foreign]}),NOW,{page:'short'});
  assert.doesNotMatch(page,/\$1\.85M/);
  assert.match(page,/-- · 1 Foreign Ln/);
});

test('a listing with no usable price is unknown: never $0 and never inside a budget', () => {
  const unknown=home({price:0,addr:'1 Unpriced Ln',url:'https://www.redfin.com/CA/Dana-Point/1-Unpriced-Ln/home/2'});
  assert.equal(D.listFilter([unknown],{within:true},2000000,'homes').length,0);
  const page=D.homes(feed({homes:[unknown]}),NOW,{page:'short'});
  assert.doesNotMatch(page,/\$0/);
  assert.match(page,/-- · 1 Unpriced Ln/);
});

test('a price just under a million never rounds to $1000K (the one money form keeps its trailing zeros)', () => {
  assert.equal(D.usd(999600),'$1.00M');
  assert.equal(D.usd(999499),'$999K');
  assert.equal(D.usd(1850000),'$1.85M');
});

test('cross-source duplicates count once when the asking price differs', () => {
  const h=home({source:'zillow',addr:'100 FIXTURE DR.',price:1795000,url:'https://www.zillow.com/homedetails/100-Fixture-Dr/2_zpid/'});
  const c=com({source:'realmo',addr:'100  harbor blvd',price:1950000,url:'https://www.realmo.com/listing/9'});
  const page=D.homes(feed({homes:[home(),h],commercial:[com(),c]}),NOW,{page:'all'});
  assert.equal((page.match(/\$1\.85M|\$1\.80M/g)||[]).length,1,'one home price');
  assert.equal((page.match(/\$2\.00M|\$1\.95M/g)||[]).length,1,'one commercial price');
});

test('an address duplicate still counts once when one source omits listing details', () => {
  const incomplete=home({source:'zillow',addr:'100 FIXTURE DR.',beds:null,sqft:null,price:1795000,url:'https://www.zillow.com/homedetails/100-Fixture-Dr/2_zpid/'});
  const page=D.homes(feed({homes:[home(),incomplete]}),NOW,{page:'all'});
  assert.equal((page.match(/100 Fixture Dr/gi)||[]).length,1);
  assert.match(page,/<span>1 home<\/span>/);
});
test('the same home from two sources counts once, whatever the url, case or punctuation of the address', () => {
  const zillow=home({source:'zillow',addr:'100 FIXTURE DR.',url:'https://www.zillow.com/homedetails/100-Fixture-Dr/2_zpid/'});
  const r=feed({homes:[home(),zillow],commercial:[com(),com({source:'realmo',addr:'100  harbor blvd',url:'https://www.realmo.com/listing/9'})]});
  assert.equal(counts(r),'1 home · 1 commercial');
  const page=D.homes(r,NOW,{page:'short'});
  assert.equal((page.match(/\$1\.85M/g)||[]).length,1);
  assert.match(page,/<span>1 home<\/span>/);
});

test('listings with no address and no url are not merged into one when they differ', () => {
  const a=home({addr:'',url:'',price:900000,beds:3,sqft:1500}),b=home({addr:'',url:'',price:1200000,beds:3,sqft:1500});
  assert.equal(counts(feed({homes:[a,b]})),'2 homes');
  const pg=D.homes(feed({homes:[a,b]}),NOW,{page:'all'});
  assert.match(pg,/\$900K/);
  assert.match(pg,/\$1\.20M/);
  assert.match(D.homes(feed({homes:[a,a]}),NOW,{page:'short'}),/<span>1 home<\/span>/);
});

test('broker index pages: listings that share one generic url but have their own addresses all count', () => {
  const idx='https://www.lee-associates.com/properties/';
  const a=com({source:'lee-associates',addr:'200 Sample Avenue',price:4475000,url:idx+'?propertyId=435479-sale'});
  const b=com({source:'lee-associates',addr:'1520 N. El Camino Real',price:1200000,url:idx+'?propertyId=435480-sale'});
  const r=feed({commercial:[a,b]});
  assert.equal(counts(r),'2 commercial');
  const page=D.homes(r,NOW,{page:'all'});
  assert.match(page,/200 Sample Avenue/);
  assert.match(page,/1520 N\. El Camino Real/);
});

test('listings that share one url but name different addresses all count', () => {
  const idx='https://www.lee-associates.com/properties/';
  const a=com({source:'lee-associates',addr:'200 Sample Avenue',price:4475000,url:idx});
  const b=com({source:'lee-associates',addr:'1520 N. El Camino Real',price:1200000,url:idx});
  const r=feed({commercial:[a,b]});
  assert.equal(counts(r),'2 commercial','two listings on one shared url');
  const page=D.homes(r,NOW,{page:'all'});
  assert.match(page,/200 Sample Avenue/);
  assert.match(page,/1520 N\. El Camino Real/);
});

test('the same address repeated under one shared url still counts once', () => {
  const idx='https://www.lee-associates.com/properties/';
  const a=com({source:'lee-associates',addr:'200 Sample Avenue',price:4475000,url:idx});
  const again=com({source:'lee-associates',addr:'200 Sample Ave.',price:4475000,url:idx});
  assert.equal(counts(feed({commercial:[a,again]})),'1 commercial');
});

test('a short list that hides rows says how many it shows of how many it has', () => {
  const hs=Array.from({length:12},(_,i)=>home({addr:i+' Oak Ln',url:'https://www.redfin.com/x/'+i}));
  const cs=Array.from({length:12},(_,i)=>com({addr:i+' Pine Ct',url:'https://www.commercialcafe.com/x/'+i}));
  const p=D.homes(feed({homes:hs,commercial:cs}),NOW,{page:'short'});
  assert.equal((p.match(/ Oak Ln/g)||[]).length,8);
  assert.match(p,/Showing 8 of 12</);
  assert.equal((p.match(/ Pine Ct/g)||[]).length,5);
  assert.match(p,/Showing 5 of 12</);
});

test('the same address spelled two ways (Drive/Dr, Unit/#, North/N) counts once', () => {
  const zillow=home({source:'zillow',addr:'100 Fixture Drive',url:'https://www.zillow.com/homedetails/100-Fixture-Drive/2_zpid/'});
  const u1=home({addr:'10 Main St Unit 4',url:'https://www.redfin.com/CA/Dana-Point/10-Main-St-4/unit/1'});
  const u2=home({source:'zillow',addr:'10 Main Street #4',url:'https://www.zillow.com/homedetails/10-Main-St-4/3_zpid/'});
  const n1=com({addr:'200 North Coast Highway',url:'https://www.commercialcafe.com/commercial-property/200/1'});
  const n2=com({source:'realmo',addr:'200 N. Coast Hwy',url:'https://www.realmo.com/listing/200'});
  const r=feed({homes:[home(),zillow,u1,u2],commercial:[n1,n2]});
  assert.equal(counts(r),'2 homes · 1 commercial');
  assert.match(D.homes(r,NOW,{page:'all'}),/<span>2 homes<\/span>/);
});

test('different units at one street address stay separate', () => {
  const a=home({addr:'10 Main St Unit 4',url:'https://x/4'}),b=home({addr:'10 Main St Unit 5',url:'https://x/5'});
  assert.equal(counts(feed({homes:[a,b]})),'2 homes');
});

test('a listing date of 0 or in the future reads as unknown, never "20770 d ago" or "just now"', () => {
  const page=D.homes(feed({homes:[home({listed_at:T+86400*5})]}),NOW,{page:'short'});
  assert.match(page,/redfin · time unknown/);
});

test('an address printed with city, state and ZIP counts once beside the plain street row, with or without a city field', () => {
  const full=home({source:'zillow',addr:'100 Fixture Dr, Dana Point, CA 92629',city:'',url:'https://www.zillow.com/homedetails/100-Fixture-Dr/2_zpid/'});
  const nocity=home({source:'realtor',addr:'100 Fixture Dr',city:'',url:'https://www.realtor.com/realestateandhomes-detail/100-Fixture-Dr/9'});
  assert.equal(counts(feed({homes:[home(),full,nocity]})),'1 home','one row for one home');
  assert.match(D.homes(feed({homes:[home(),full,nocity]}),NOW,{page:'short'}),/<span>1 home<\/span>/);
});

test('the same street address in two different cities stays two listings', () => {
  const a=home({addr:'100 Main St',city:'Dana Point',url:'https://x.test/a'}),b=home({addr:'100 Main St, Irvine, CA 92614',city:'',url:'https://x.test/b'});
  assert.equal(counts(feed({homes:[a,b]})),'2 homes');
});

test('a size or cap rate of 0 is unknown: never "0 sqft", "0 SF" or "cap 0.0%"', () => {
  const r=feed({homes:[home({sqft:0})],commercial:[com({sqft:0,cap_rate:0})]});
  const page=D.homes(r,NOW,{page:'short'});
  assert.doesNotMatch(page,/\b0 SF|cap rate 0\.0|\$\d+\/SF/);
});

test('a bed or bath count of 0 is unknown: never "0 BR", "0 BA", "0 bd" or "0 ba"', () => {
  const r=feed({homes:[home({beds:0,baths:0})]});
  const page=D.homes(r,NOW,{page:'short'});
  assert.doesNotMatch(page,/\b0 (BR|BA)\b/);
  assert.match(page,/2,359 SF/, 'the known size still shows');
});

test('a commercial listing with no city does not end its title on a bare separator', () => {
  const r=feed({commercial:[com({city:''})]});
  const page=D.homes(r,NOW,{page:'short'});
  assert.match(page,/<b>\$2\.00M · Office<\/b>/);
  assert.doesNotMatch(page,/Office · <\/b>/);
});

test('a city field that carries the state still counts the same street once', () => {
  const a=home({addr:'12 Calle Amanecer',city:'San Clemente',url:'https://x.test/a'}),b=home({source:'zillow',addr:'12 Calle Amanecer',city:'San Clemente, CA',url:'https://x.test/b'});
  assert.equal(counts(feed({homes:[a,b]})),'1 home');
});

test('an address printed with its own city, state and ZIP but no commas counts once beside the plain street row', () => {
  const a=home(),b=home({source:'zillow',addr:'100 Fixture Dr Dana Point CA 92629',city:'Dana Point',url:'https://x.test/b'});
  assert.equal(counts(feed({homes:[a,b]})),'1 home');
});

test('a street name is never cut for a city that the row does not name', () => {
  const a=home({addr:'10 Ocean View',city:''}),b=home({addr:'10 Ocean',city:'',url:'https://x.test/o'});
  assert.match(D.homes(feed({homes:[a,b]}),NOW,{page:'short'}),/<span>2 homes<\/span>/);
});

test('two units under one street address, named by a building, space or letter-number code, stay two listings', () => {
  const e110=com({addr:'24901 Dana Point Harbor, E110, Dana Point, CA 92629',url:'https://x.test/e110'}),e120=com({addr:'24901 Dana Point Harbor, E120, Dana Point, CA 92629',url:'https://x.test/e120'});
  assert.equal(counts(feed({commercial:[e110,e120]})),'2 commercial');
  const a=home({addr:'700 Fixture Dr, A-202, Murrieta, CA 92563',city:'Murrieta',url:'https://x.test/a202'}),b=home({addr:'700 Fixture Dr, A-203, Murrieta, CA 92563',city:'Murrieta',url:'https://x.test/a203'});
  assert.equal(counts(feed({homes:[a,b]})),'2 homes');
  const c=home({addr:'800 Sample St, Building A',city:'Costa Mesa',url:'https://x.test/ba'}),d=home({addr:'800 Sample St, Building B',city:'Costa Mesa',url:'https://x.test/bb'});
  assert.equal(counts(feed({homes:[c,d]})),'2 homes');
});

test('a listing the collector could not refresh says stale on its row; a fresh row never does', () => {
  const fresh=home({addr:'3 Fresh Ct',url:'https://x.test/fresh3',stale:false}),old=home({addr:'4 Old Ct',url:'https://x.test/old4',stale:true});
  const oldC=com({addr:'9 Old Blvd',url:'https://x.test/oc9',stale:true});
  const page=D.homes(feed({homes:[fresh,old]}),NOW,{page:'short'});
  assert.equal((page.match(/ · stale\b/g)||[]).length,1);
  assert.match(page,/4 Old Ct[\s\S]*? · stale/);
});

test('one source lists four parcels under one street name: each id is its own listing, a repeated id and another source still count once', () => {
  const lot=(id,price)=>com({source:'lee-associates',id,addr:'Town Center Drive, Apple Valley, CA 92308',city:'Apple Valley',type:'Office',price,sqft:null,
   url:'https://www.lee-associates.com/properties/?propertyId='+id+'-sale&address=Town-Center-Drive&officeId=1946'});
  const lots=[lot('2617480',150000),lot('2617471',150000),lot('2617465',220000),lot('2617463',380000)];
  const other=com({source:'realmo',id:'9',addr:'Town Center Dr, Apple Valley, CA 92308',city:'Apple Valley',type:'Office',price:150000,url:'https://www.realmo.com/listing/9'});
  const r=feed({market:{area:'Apple Valley'},commercial:lots.concat([lot('2617480',150000),other])});
  assert.equal(counts(r),'4 commercial');
  const page=D.homes(r,NOW,{page:'all'});
  assert.match(page,/Commercial for sale<\/span><span>4</);
  assert.equal((page.match(/\$380K/g)||[]).length,1);
  assert.equal((page.match(/\$220K/g)||[]).length,1);
  assert.equal((page.match(/\$150K/g)||[]).length,2);
});

test('tax-sale parcels share one auction index url and one street word: each id is its own listing, a repeated id still counts once', () => {
  const parcel=(id,apn,price)=>com({source:'la_ttc',id:'la_ttc-2026B-'+id,addr:'Vacant land, APN '+apn+', Los Angeles, CA',city:'Los Angeles',type:'Land',price,kind:'Tax sale',sqft:null,
   url:'https://ttc.lacounty.gov/schedule-of-upcoming-auctions/'});
  const lots=[parcel('3355','5302-007-007',1676),parcel('3356','5302-007-008',23000),parcel('3357','5302-007-009',41000)];
  const r=feed({commercial:lots.concat([parcel('3355','5302-007-007',1676)])});
  assert.equal(counts(r),'3 commercial');
  const page=D.homes(r,NOW,{page:'all'});
  assert.match(page,/Commercial for sale<\/span><span>3</);
  assert.match(page,/\$23K/);
  assert.match(page,/\$41K/);
});

test('one source printing one listing under two ids counts once; a different price, a different size or a parcel list with no size stays apart', () => {
  // live feed 2026-11-18: Zillow lists 400 Fixture Dr under two ids, Matthews lists 300 Example Blvd under two ids, each pair with one price, bed count and size
  const zil=(id,url)=>home({source:'zillow',id,addr:'400 Fixture Dr, Trabuco Canyon, CA 92679',city:'Trabuco Canyon',price:52000000,beds:12,sqft:47044,url});
  assert.equal(counts(feed({homes:[zil('25617156','https://x.test/z1'),zil('325857537','https://x.test/z2')]})),'1 home');
  const mat=(id)=>com({source:'matthews',id,addr:'300 Example Blvd, Fremont, CA 94539',city:'Fremont',type:'Retail',price:7200000,sqft:3500,url:'https://x.test/m/'+id});
  assert.equal(counts(feed({commercial:[mat('63039'),mat('63001')]})),'1 commercial');
  // one source, two ids, one size but two prices (SVN 330 S Garfield Ave): two units, never merged
  const svn=(id,price)=>com({source:'svn',id,addr:'330 S Garfield Ave, Unit 120, Alhambra, CA 91801',city:'Alhambra',type:'Retail',price,sqft:1537,url:'https://x.test/s/'+id});
  assert.equal(counts(feed({commercial:[svn('2237403',548000),svn('2237367',685000)]})),'2 commercial');
  // one source, two ids, one price, two sizes: two homes
  assert.equal(counts(feed({homes:[zil('1','https://x.test/a'),Object.assign(zil('2','https://x.test/b'),{beds:11,sqft:40000})]})),'2 homes');
  // one source, two ids, one price and no size on either row: parcels, never merged
  const lot=(id)=>com({source:'lee-associates',id,addr:'Town Center Dr, Apple Valley, CA 92308',city:'Apple Valley',type:'Office',price:150000,sqft:null,url:'https://x.test/l/'+id});
  assert.equal(counts(feed({commercial:[lot('2617480'),lot('2617471')]})),'2 commercial');
});

test('a numbered street one source prints under five ids with one title and price counts once; a size, price or title that differs stays apart', () => {
  // live feed 2026-11-18: Lee & Associates prints 2777 E Cedar St, Ontario five times at $52M with no type or size
  const cedar=(id,o)=>com(Object.assign({source:'lee-associates',id,addr:'2777 E Cedar St, Ontario, CA 91761',city:'Ontario',title:'2777 E Cedar St',type:null,price:52000000,sqft:null,
   url:'https://www.lee-associates.com/properties/?propertyId='+id+'-sale&address=2777-E-Cedar-St&officeId=2404'},o));
  const five=['2199278','2199285','2199312','2199316','2199318'].map(id=>cedar(id));
  assert.equal(counts(feed({commercial:five})),'1 commercial');
  assert.equal(counts(feed({commercial:[cedar('1',{sqft:5000}),cedar('2',{sqft:9000})]})),'2 commercial');
  assert.equal(counts(feed({commercial:[cedar('1'),cedar('2',{price:48000000})]})),'2 commercial');
  assert.equal(counts(feed({commercial:[cedar('1'),cedar('2',{title:'Cedar St Industrial Park'})]})),'2 commercial');
});

test('rows with no id stay merged by address, and two ids from two sources are one listing', () => {
  const a=home({id:'a1'}),b=home({source:'zillow',id:'z9',url:'https://www.zillow.com/homedetails/100-Fixture-Dr/2_zpid/'});
  assert.equal(counts(feed({homes:[a,b]})),'1 home');
});

test('a sale price under $10,000 is a rate or a parse slip: unknown, never "$162" and never "$0/SF"', () => {
  const rate=com({addr:'500 Sample Ave',city:'Lynwood',type:'Industrial',price:162,sqft:35000,url:'https://x.test/norton'});
  const tiny=com({addr:'205 Market Pl',city:'Escondido',type:'Industrial',price:1234,sqft:5196,url:'https://x.test/market'});
  const r=feed({commercial:[rate,tiny]});
  const page=D.homes(r,NOW,{page:'all'});
  assert.doesNotMatch(page,/\$162\b|\$1K|\$0\/SF|\$1\/SF/);
  assert.match(page,/-- · Industrial · Lynwood/);
  assert.equal(D.listFilter([rate],{within:true},5000000,'commercial').length,0);
});

test('a non-USD price never prints a dollar $/SF figure', () => {
  const foreign=home({currency:'CAD',price:1850000,sqft:2000});
  assert.doesNotMatch(D.homes(feed({homes:[foreign]}),NOW,{page:'short'}),/\/SF/);
  assert.match(D.homes(feed({homes:[home({sqft:2000})]}),NOW,{page:'short'}),/\$925\/SF/);
});

test('one unit written "Space 74" or "APT C", or with its code in front ("E110-24901 ...", "915-#C ..."), counts once beside the plain row from another source', () => {
  // live 2026-11-14: redfin "1880 N El Camino Real #74" and zillow "... Space 74"; redfin "915-#C Buena Vis" and zillow "915 Buena Vis APT C"; century21 "24901 Dana Point Harbor Dr, E110" and realmo "E110-24901 Dana Point Harbor Dr"
  const a1=home({addr:'1880 N El Camino Real #74, San Clemente, CA 92672',city:'San Clemente',url:'https://www.redfin.com/CA/San-Clemente/unit-74/home/1'});
  const a2=home({source:'zillow',addr:'1880 N El Camino Real Space 74, San Clemente, CA 92672',city:'San Clemente',url:'https://www.zillow.com/homedetails/1880-74/1_zpid/'});
  const b1=home({addr:'915-#C Buena Vis, San Clemente, CA 92672',city:'San Clemente',url:'https://www.redfin.com/CA/San-Clemente/unit-c/home/2'});
  const b2=home({source:'zillow',addr:'915 Buena Vis APT C, San Clemente, CA 92672',city:'San Clemente',url:'https://www.zillow.com/homedetails/915-c/2_zpid/'});
  const c1=com({source:'century21',addr:'24901 Dana Point Harbor Dr, E110, Dana Point, CA 92629',url:'https://commercial.century21.com/listing/e110'});
  const c2=com({source:'realmo',addr:'E110-24901 Dana Point Harbor Dr, Dana Point, CA 92629',url:'https://www.realmo.com/listing/13191118'});
  const r=feed({homes:[a1,a2,b1,b2],commercial:[c1,c2]});
  assert.equal(counts(r),'2 homes · 1 commercial');
  assert.match(D.homes(r,NOW,{page:'all'}),/<span>2 homes<\/span>/);
  // a different unit behind the same prefix form stays its own listing
  const d1=home({addr:'E120-24901 Dana Point Harbor Dr, Dana Point, CA 92629',url:'https://x.test/e120'}),d2=home({addr:'E110-24901 Dana Point Harbor Dr, Dana Point, CA 92629',url:'https://x.test/e110'});
  assert.equal(counts(feed({homes:[d1,d2]})),'2 homes');
  // a number range is not a unit code
  const e1=com({addr:'1700-1720 North Main Street, Los Angeles, CA 90012',city:'Los Angeles',url:'https://x.test/r1'}),e2=com({addr:'1700 North Main Street, Los Angeles, CA 90012',city:'Los Angeles',source:'realmo',url:'https://x.test/r2'});
  assert.equal(counts(feed({commercial:[e1,e2]})),'2 commercial');
});

// Auction.com rows carry the auction's starting bid in `price`, not an asking price (the collector keeps them out of the market median too).
const auction=(o)=>home(Object.assign({source:'auction.com',addr:'22276 Redwood Point',city:'Lake Forest',price:70000,value_est:238001,beds:2,baths:1,sqft:957,
 type:'Condo',sale_kind:'Foreclosure auction',auction_at:'2027-01-11T17:00:00Z',listed_at:null,url:'https://www.auction.com/details/22276-redwood-pointe-lake-forest-ca-2241578'},o));

test('an auction starting bid reads as a bid, never as an asking price or a price per square foot', () => {
  const page=D.homes(feed({homes:[auction()]}),NOW,{page:'short'});
  assert.match(page,/Opening bid \$70K · 22276 Redwood Point/);
  assert.match(page,/Foreclosure auction/);
  assert.doesNotMatch(page,/\/SF/,'a bid over the square footage is not a price per square foot');
  assert.equal(D.hListMeta(home(),{type:false}).includes('/SF'),true,'an asking price still gets its price per square foot');
});

test('an auction starting bid never passes the within-budget filter', () => {
  assert.equal(D.listFilter([auction()],{within:true},500000,'homes').length,0);
  assert.equal(D.listFilter([auction(),home({price:450000,addr:'2 Asking Ln',url:'https://www.redfin.com/x/2'})],{within:true},500000,'homes').length,1);
  assert.equal(D.listFilter([auction()],{},500000,'homes').length,1,'it is still listed without the budget filter');
});

test('an auction row with no starting bid stays unknown, not a bid of --', () => {
  const page=D.homes(feed({homes:[auction({price:null,addr:'3 Nobid Way',url:'https://www.auction.com/details/3'})]}),NOW,{page:'short'});
  assert.match(page,/-- · 3 Nobid Way/);
  assert.doesNotMatch(page,/Opening bid/);
});

// The live feed (2026-11-15) lists 10 buildings in both `homes` (Redfin, Zillow) and `commercial` (Century 21, Realmo) under one street address.
test('a building the feed lists under both homes and commercial counts once', () => {
  const h=home({addr:'34244 Via Santa Rosa',city:'Dana Point',type:'Multifamily',price:1290000,url:'https://www.redfin.com/CA/Dana-Point/34244-Via-Santa-Rosa-92624/home/22143597'});
  const c=com({source:'century21',addr:'34244 Via Santa Rosa, Dana Point, CA 92624',city:'Dana Point',type:'Multifamily',price:1290000,sqft:null,url:'https://www.century21commercial.com/listing/REN036062828'});
  assert.equal(counts({homes:[h,home({addr:'2 Other Ln',url:'https://www.redfin.com/x/2'})],commercial:[c,com()]}),'2 homes · 1 commercial');
  const R=D.homeRows({homes:[h],commercial:[c]});
  assert.equal(R.homes.length+R.com.length,1);
});

test('a listing in both lists keeps the copy that has a price', () => {
  const h=home({addr:'7 Both Way',price:null,url:'https://www.redfin.com/b/7'});
  const c=com({addr:'7 Both Way',price:2400000,sqft:null,url:'https://www.commercialcafe.com/b/7'});
  const R=D.homeRows({homes:[h],commercial:[c]});
  assert.equal(R.homes.length+R.com.length,1);
  const row=[].concat(R.homes,R.com);
  assert.equal(D.listFilter(row,{within:true},3000000,'homes').length,1,'the priced copy is the one the budget filter reads');
});

// 2026-11-15 live feed: one Multifamily building at one street and one price, listed by Realtor.com as a home (5001 sqft, 3 beds) and by Zillow as commercial (1445 sqft, no beds). The portals size it differently; price, type and street name one listing.
test('one building at one street and price from two sources counts once when their sizes differ', () => {
  const h=home({addr:'600 Example St, Laguna Beach, CA 92651',city:'Laguna Beach',type:'Multifamily',price:2700000,sqft:5001,beds:3,source:'realtor.com',url:'https://www.realtor.com/realestateandhomes-detail/382-Thalia-St_Laguna-Beach_CA_92651_M26943-37383'});
  const c=com({addr:'600 Example St, Laguna Beach, CA 92651',city:'Laguna Beach',type:'Multifamily',price:2700000,sqft:1445,beds:null,source:'zillow',url:'https://www.zillow.com/homedetails/382-Thalia-St-Laguna-Beach-CA-92651/25556983_zpid/'});
  const R=D.homeRows({homes:[h],commercial:[c]});
  assert.equal(R.homes.length+R.com.length,1);
});

// 2026-11-15 live feed: 640 S Coast Hwy, the same pattern (Realtor.com 6643 sqft against Zillow 4612 sqft, same price and type).
test('a second building priced the same way across two sources also counts once', () => {
  const h=home({addr:'640 S Coast Hwy, Laguna Beach, CA 92651',city:'Laguna Beach',type:'Multifamily',price:7275000,sqft:6643,beds:4,source:'realtor.com',url:'https://www.realtor.com/realestateandhomes-detail/640-S-Coast-Hwy_Laguna-Beach_CA_92651_M99293-66860'});
  const c=com({addr:'640 S Coast Hwy, Laguna Beach, CA 92651',city:'Laguna Beach',type:'Multifamily',price:7275000,sqft:4612,beds:null,source:'zillow',url:'https://www.zillow.com/homedetails/640-S-Coast-Hwy-Laguna-Beach-CA-92651/2110420749_zpid/'});
  const R=D.homeRows({homes:[h],commercial:[c]});
  assert.equal(R.homes.length+R.com.length,1);
});

// Guard: one source's own rows at one street with different sizes are a community's homes, and stay separate even at one price.
test('one source lists two homes at one street and one price with different sizes: both stay', () => {
  const a=home({addr:'Plan 1 Plan, Sunflower at Rienda',city:'',type:'House',price:1000000,sqft:1500,beds:2,source:'zillow',url:'https://www.zillow.com/homedetails/a/1_zpid/'});
  const b=home({addr:'Plan 1 Plan, Sunflower at Rienda',city:'',type:'House',price:1000000,sqft:2400,beds:4,source:'zillow',url:'https://www.zillow.com/homedetails/b/2_zpid/'});
  assert.equal(D.homeRows({homes:[a,b],commercial:[]}).homes.length,2);
});

// 2026-11-16 live feed: Redfin lands print their acreage in sqft (14 Fixture Cove Dr 0.78, 500 E Sample Way 0.25, 3900 Fixture Way 0.32).
test('a size under 100 SF is an acreage: unknown, never "1 SF" and never an absurd price per square foot', () => {
  const lot=home({addr:'14 Fixture Cove Dr',city:'Dana Point',type:'Land',price:16900000,sqft:0.78,beds:null,baths:null,url:'https://www.redfin.com/CA/Dana-Point/14-Ritz-Cove-Dr/home/9'});
  assert.equal(D.hListMeta(lot,{type:false}),'');
  assert.doesNotMatch(D.homes(feed({homes:[lot]}),NOW,{page:'short'}),/ SF|\/SF/);
  assert.equal(D.hListMeta(home({sqft:100}),{type:false}).includes('100 SF'),true,'a real small unit still shows its size');
});

test('an acreage in the sqft field does not split one listing from the same lot at another source', () => {
  // Redfin 0.25 (acres) against Realmo 10,829 SF: the same price and street, one lot
  const a=home({addr:'500 E Sample Way, San Clemente, CA 92672',city:'San Clemente',type:'Land',price:670000,sqft:0.25,beds:null,baths:null,url:'https://www.redfin.com/CA/San-Clemente/524-E-Avenida-Pico/home/3'});
  const b=com({source:'realmo',addr:'500 E Sample Way, San Clemente, CA 92672',city:'San Clemente',type:'Land',price:670000,sqft:10829,url:'https://www.realmo.com/listing/20153084'});
  const R=D.homeRows({homes:[a],commercial:[b]});
  assert.equal(R.homes.length+R.com.length,1);
});
test('a shared generic URL does not merge a listing just because the earlier row has no address', () => {
  const index='https://broker.example/listings';
  const noAddress=com({addr:'',url:index});
  const addressed=com({addr:'100 Harbor Blvd',url:index});
  assert.equal(D.homeRows({homes:[],commercial:[noAddress,addressed]}).com.length,2);
});

// A row the collector could not refresh is stale; the same listing at another source that did refresh is not.
test('a repeat that one source still refreshes is not stale, whichever copy comes first in the feed', () => {
  const stale=home({stale:true});
  const fresh=home({source:'zillow',url:'https://www.zillow.com/homedetails/100-fixture/1_zpid/'});
  for(const rows of [[stale,fresh],[fresh,stale]]){
    const R=D.homeRows({homes:rows,commercial:[]});
    assert.equal(R.homes.length,1,'one listing');
    assert.equal(R.homes[0].source,'zillow','the fresh copy stays');
    assert.equal(D.homes(feed({homes:rows}),NOW,{page:'short'}).includes(' \u00B7 stale'),false,'no stale mark on a listing another source refreshed');
  }
  const only=D.homeRows({homes:[stale,home({source:'zillow',url:'https://www.zillow.com/homedetails/100-fixture/1_zpid/',stale:true})],commercial:[]});
  assert.equal(only.homes.length,1);
  assert.equal(only.homes[0].stale,true,'both copies stale: still marked');
});

// Live feed 2026-11-17: 8 commercial rows are leases (sale_or_lease "lease", price null, the rent in rent_text). They read "-- · Office · Inglewood",
// the look of a for-sale row whose price is unknown. A lease says so, with its rent, and never counts as a priced sale.
test('a commercial lease row says lease with its rent, never an unknown sale price', () => {
  const lease=com({addr:'660 E Regent St, Inglewood, CA 90301',city:'Inglewood',type:'Office',price:null,sqft:null,sale_or_lease:'lease',rent:2.95,rent_unit:'sf_mo',rent_text:'$2.95/RSF NNN monthly',url:'https://x.test/regent'});
  const r=feed({commercial:[lease,com()]});
  const page=D.homes(r,NOW,{page:'all'});
  assert.match(page,/For lease \$2\.95\/RSF NNN monthly · Office · Inglewood/);
  assert.doesNotMatch(page,/-- · Office · Inglewood/);
  assert.match(page,/Commercial for sale and lease<\/span><span>2</);
  assert.equal(D.listFilter([lease],{within:true},50000000,'commercial').length,0,'a lease is never inside a purchase budget');
  assert.match(D.homes(feed({commercial:[com()]}),NOW,{page:'all'}),/Commercial for sale<\/span><span>1</,'a feed with no lease keeps its title');
});

test('a lease row with no rent text says lease, and a stale lease still says stale', () => {
  const lease=com({addr:'9 Lease Way, Irvine, CA 92618',city:'Irvine',type:'Retail',price:null,sale_or_lease:'lease',rent_text:'',stale:true,url:'https://x.test/lease9'});
  const page=D.homes(feed({commercial:[lease]}),NOW,{page:'all'});
  assert.match(page,/For lease \(rent not listed\) · Retail · Irvine/);
  assert.match(page,/9 Lease Way[\s\S]*? · stale/);
});

// Live feed 2026-11-18: 1,251 LA County tax-sale rows (source la_ttc, kind "Tax sale", sale_status "held") carry the sale's minimum bid in `price`;
// 847 of them are $10,000 or more and read as asking prices. The collector (cre_deals.py auction_row) already treats every row with a `kind` as a bid.
const taxSale=(o)=>com(Object.assign({id:'la_ttc-2026B-3626',source:'la_ttc',addr:'1127 15Th St A, Santa Monica, CA 90403',city:'Santa Monica',type:'Condo',price:43000,sqft:900,
 kind:'Tax sale',sale_status:'held',sale_at:T-86400*28,url:'https://ttc.lacounty.gov/schedule-of-upcoming-auctions/'},o));

test('a tax-sale minimum bid reads as a bid, never as an asking price or a price per square foot', () => {
  const page=D.homes(feed({commercial:[taxSale()]}),NOW,{page:'all'});
  assert.match(page,/Minimum bid \$43K · Condo · Santa Monica/);
  assert.doesNotMatch(page,/\/SF/,'a minimum bid over the size is not a price per square foot');
  assert.equal(D.listFilter([taxSale()],{within:true},500000,'commercial').length,0,'a bid is never inside a purchase budget');
  assert.equal(D.listFilter([taxSale()],{},500000,'commercial').length,1,'it is still listed without the budget filter');
});

test('a sale the collector says was held reads as held, never as open for sale; an open notice does not', () => {
  const held=D.homes(feed({commercial:[taxSale()]}),NOW,{page:'all'});
  assert.match(held,/1127 15Th St A[\s\S]*? · sale held/);
  const open=D.homes(feed({commercial:[taxSale({addr:'SE Corner of Oak Glen Rd, Yucaipa, CA 92399',city:'Yucaipa',price:null,source:'hcd_noa',kind:'Surplus land',sale_status:'notice open',url:'https://data.ca.gov/x'})]}),NOW,{page:'all'});
  assert.doesNotMatch(open,/sale held/);
});
