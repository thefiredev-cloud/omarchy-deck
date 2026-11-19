// Real estate > Commercial (design v3, 2026-11-14): the type switch drives the rank query, the market strip says "Not published"
// for a missing series, Best ZIPs rows are cards with labels and never hold escaped markup, the commercial ZIP sheet drops empty
// sections and names missing values once, listings stay absent outside coverage, and no source name reaches the page.
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
const qs=q=>{const u=new URLSearchParams(q.split('?')[1]);return {get:k=>u.get(k),all:k=>u.getAll(k)}};
const text=h=>h.replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
const SOURCE_WORDS=/Zillow|Census|FRED|CoStar|LODES|QCEW|FDIC|SBA |HMDA|Realtor|ACS\b|ZORI|ZHVI|\bas of\b|Sources?:/;
// one ZIP record as the route serves it: the shard row as an object plus its x block (staged fixture, 92629)
const shard=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/housing-national-v2/zip/926.json'),'utf8'));
const rec=zip=>Object.assign(Object.fromEntries(shard.cols.map((c,i)=>[c,shard.rows[zip][i]])),shard.x[zip],{zip,dataset:'v2'});

test('type switch: each type asks the rank route for its own score, sector jobs and confidence, with cols= every time',()=>{
 for(const t of C.TYPE_KEYS){const q=qs(C.rankQuery({type:t,f:{}}));
  assert.equal(q.get('kind'),'commercial');assert.equal(q.get('type'),t);assert.equal(q.get('sort'),'score');
  const cols=q.get('cols').split(',');for(const c of ['zip','city','state','population',t+'_score',t+'_conf',C.SECTOR[t][0],'asking_cap','com_listings'])assert.ok(cols.includes(c),t+': '+c);
  assert.deepEqual(q.all('f'),[t+'_score:ge:0','biz_estabs:ge:50'],'a ZIP that cannot be scored stays out of the list; the business floor is on by default');
  assert.equal(q.get('limit'),'12')}
 const q=qs(C.rankQuery({type:'industrial',f:{minScore:60,minListings:2,sort:'jobs'},scope:'state=TX',offset:12}));
 assert.deepEqual(q.all('f'),['industrial_score:ge:60','biz_estabs:ge:50','com_listings:ge:2']);
 assert.equal(q.get('sort'),'jobs_industrial');assert.equal(q.get('state'),'TX');assert.equal(q.get('offset'),'12');
 assert.equal(qs(C.rankQuery({type:'nope',f:{}})).get('type'),'retail','an unknown type never reaches the server');
 assert.match(C.rankQuery({type:'retail',f:{},scope:'state=CA&county=Orange%2CLos%20Angeles%2CSan%20Diego'}),/&state=CA&county=Orange%2CLos%20Angeles%2CSan%20Diego$/);
 assert.equal(C.filterCount({minScore:50,sort:'cap'}),3,'the default business floor counts as a set filter');assert.equal(C.filterCount({sort:'score',minBiz:0}),0);
});

// decision 3 (2026-11-15): office ZIPs with no residents are real business districts, so the floor is businesses, never residents. Office
// top 20 on the staged national data before the floor: Upton NY (5 businesses, 48 residents) and 10103 (37 businesses) ranked; after: gone
test('rank floor: Min businesses 50 by default, clearable, a typed floor wins; never a resident floor',()=>{
 const f=q=>qs(C.rankQuery({type:'office',f:q})).all('f');
 assert.deepEqual(f({}),['office_score:ge:0','biz_estabs:ge:50']);
 assert.deepEqual(f({minBiz:0}),['office_score:ge:0'],'cleared: any count');
 assert.deepEqual(f({minBiz:120.4}),['office_score:ge:0','biz_estabs:ge:120']);
 assert.equal(qs(C.rankQuery({type:'office',f:{}})).get('min_pop'),null,'no resident floor');
 assert.equal(C.MIN_BIZ_DEFAULT,50);assert.equal(C.minBizOf({}),50);assert.equal(C.minBizOf({minBiz:0}),null);assert.equal(C.minBizOf({minBiz:-3}),50);
 // review (ReviewTwo): P, L and T draw no filter chips, so the floor is named on the Best ZIPs head where the ranking is read
 assert.equal(C.sortLine({}),'Sort: Type score \u00b7 50+ businesses');
 assert.equal(C.sortLine({sort:'cap',minBiz:120}),'Sort: Asking cap rate \u00b7 120+ businesses');
 assert.equal(C.sortLine({minBiz:0}),'Sort: Type score','cleared: no floor named');
 assert.match(fs.readFileSync(path.join(root,'static/pages/commercial.js'),'utf8'),/\$\('\.com-sort'\)\.textContent=C\.sortLine\(S\.f,S\.q\)/);
 // the staged rows the server answers (kit SeeData, 2026-11-15): who passes the floor
 const staged=[{zip:'11973',city:'Upton',state:'NY',population:48,biz_estabs:5},{zip:'10103',city:'New York',state:'NY',population:0,biz_estabs:37},
  {zip:'10020',city:'New York',state:'NY',population:0,biz_estabs:733},{zip:'02109',city:'Boston',state:'MA',population:3612,biz_estabs:1309}];
 const floor=Number(f({})[1].split(':')[2]);
 assert.deepEqual(staged.filter(r=>r.biz_estabs>=floor).map(r=>r.zip),['10020','02109'],'Upton and the 37-business tower leave; Rockefeller Center and Boston stay');
});

test('market strip: a missing series says Not published; the loan rate is marked as an estimate; nothing becomes 0',()=>{
 const desk={rates:{commercial:{value:7.35,kind:'assumption'},treasury_10y:{value:5.1}},assumptions:{cre:{spread:2.25}}};
 const m=C.stripModel({type:'office',row:{asking_cap:5.58},us:{fred_treasury_10y:5.1,fred_cre_delinquency:1.53,fred_cre_price_yoy:6.58},desk});
 const by=Object.fromEntries(m.map(x=>[x.label,x]));
 assert.equal(m.length,8);assert.equal(m.filter(x=>!x.dx).length,6,'TV and phones keep the first six');
 assert.ok(!by['Vacancy'],'no permitted source has commercial vacancy, so it gets no tile');
 assert.equal(by['Asking cap rate'].value,'5.58%');assert.equal(by['Asking cap rate'].sub,'All types','an all-type value is never passed off as the type');
 assert.equal(by['Asking $/SF'].value,null);assert.equal(by['Lease $/SF/yr'].value,null);
 assert.equal(by['Loan rate'].sub,'est. 10-yr plus 2.25');assert.equal(by['Cap spread'].value,'\u22121.8 pt');
 assert.equal(by['Delinquency'].value,'1.5%');assert.equal(by['Delinquency'].sub,'Bank CRE loans, US');
 const h=C.stripHtml(m,'Market');
 assert.equal((h.match(/Not published/g)||[]).length,2);
 assert.equal((h.match(/class="tile np/g)||[]).length,2,'the words, not a figure');
 assert.match(h,/data-n="8"/);assert.match(h,/data-nb="6"/);assert.doesNotMatch(h,/>0<|>0%|\$0\b|NaN|undefined/);
 // a per-type series and CMBS delinquency for the type win when published
 const t=Object.fromEntries(C.stripModel({type:'retail',row:{crel_cap_retail:6.4,asking_cap:5.58,cmbs_retail_delinq:3.2,crel_sale_psf:412},us:{},desk:{}}).map(x=>[x.label,x]));
 assert.equal(t['Asking cap rate'].value,'6.40%');assert.equal(t['Asking cap rate'].sub,'');assert.equal(t['Delinquency'].sub,'CMBS, retail');
 assert.equal(t['Asking $/SF'].value,'$412');assert.equal(t['Asking $/SF'].unit,'/SF');assert.equal(t['Loan rate'].value,null);assert.equal(t['Cap spread'].value,null,'no spread without a loan rate');
 // the scope's asking price and rent per SF are one median over every type: the same on every type chip, so they say so
 assert.equal(t['Asking $/SF'].sub,'All types');
 assert.equal(C.stripModel({type:'office',row:{crel_lease_psf_yr:26.75},us:{},desk:{}}).find(x=>x.label==='Lease $/SF/yr').sub,'All types');
 assert.equal(by['Asking $/SF'].sub,'','no figure, no note');
});

const row=(zip,o)=>Object.assign({zip,city:'Irvine',state:'CA',rank:1,retail_score:96,retail_conf:0.62,jobs_retail:13080,asking_cap:null,jobs_trend:1.2,com_listings:42,daytime_pop:120000,biz_estabs_5y:22.5,deposit_growth:null,cmbs_occupancy:null,commercial_risk:31,incentives:0},o);

test('a ZIP with under 100 residents reads Business district after its city, in the list and on the ZIP sheet',()=>{
 const rows=[row('10020',{rank:1,city:'New York',state:'NY',population:0}),row('02109',{rank:2,city:'Boston',state:'MA',population:3612}),row('92618',{rank:3,population:null})];
 const h=C.zipsHtml(rows,{type:'office',dataset:'ca'});
 assert.match(h,/<b>1\. 10020<\/b><small>New York, NY \u00b7 Business district<\/small>/);
 assert.match(h,/<small>Boston, MA<\/small>/);assert.doesNotMatch(h.slice(h.indexOf('92618')),/Business district/,'an unknown count is not a district');
 assert.equal(C.zipModel({zip:'10020',city:'New York',state:'NY',population:0},{type:'office',dataset:'ca'}).place,'New York, NY \u00b7 Business district');
 assert.equal(C.zipModel({zip:'11973',city:'Upton',state:'NY',population:100},{type:'office'}).place,'Upton, NY');
 assert.match(C.dataModel({type:'office',f:{},sources:[]}).method.map(m=>m.join(' ')).join('\n'),/at least 50 business establishments/);
});

// review of #361: Upton NY (5 businesses) was found by its ZIP but not by "Upton" while the floor was on
test('a city search ignores the business floor, and a row under it says why it carries no rank',()=>{
 const q=o=>qs(C.rankQuery(Object.assign({type:'office',f:{}},o)));
 assert.deepEqual(q({q:'Upton'}).all('f'),['office_score:ge:0'],'the search reaches every scored ZIP of that name');
 assert.equal(q({q:'Upton'}).get('q'),'Upton');
 assert.deepEqual(q({q:'  '}).all('f'),['office_score:ge:0','biz_estabs:ge:50'],'blank is no search');
 assert.ok(C.cols('office').includes('biz_estabs'),'the count comes with the row');
 assert.equal(C.sortLine({},'Upton'),'Sort: Type score','no floor is claimed for a search');
 const rows=[row('11973',{rank:1,city:'Upton',state:'NY',population:48,biz_estabs:5}),row('11974',{rank:2,city:'Upton',state:'NY',biz_estabs:null}),
  row('11975',{rank:3,city:'Upton',state:'NY',biz_estabs:1}),row('11976',{rank:4,city:'Upton',state:'NY',biz_estabs:80})];
 const h=C.zipsHtml(rows,{type:'office',dataset:'ca',minBiz:50});
 assert.match(h,/<b>11973<\/b><small>Upton, NY \u00b7 Business district<\/small><small class="com-nr">Not ranked: 5 businesses, under 50<\/small>/,'no rank number, the reason');
 assert.match(h,/<b>11974<\/b><small>Upton, NY<\/small><small class="com-nr">Not ranked: no business count<\/small>/);
 assert.match(h,/Not ranked: 1 business, under 50/);
 assert.match(h,/<b>4\. 11976<\/b><small>Upton, NY<\/small><\/span>/,'a ZIP over the floor says nothing more');
 assert.match(C.zipsHtml(rows,{type:'office',dataset:'ca',minBiz:50,search:true}),/<b>11976<\/b>/,'a search shows matches, not rank numbers with gaps');
 assert.doesNotMatch(C.zipsHtml(rows,{type:'office',dataset:'ca'}),/Not ranked/,'outside a search the rows are the ranking');
 const page=fs.readFileSync(path.join(root,'static/pages/commercial.js'),'utf8');
 assert.match(page,/search:C\.searching\(S\.q\),q:S\.q,minBiz:C\.searching\(S\.q\)\?C\.minBizOf\(S\.f\):null/);assert.match(page,/C\.sortLine\(S\.f,S\.q\)/);
 // ReviewSix: while a search is on, the page says what is true for a search
 assert.equal(C.filterCount({},'Upton'),0,'the floor is not a set filter during a search');assert.equal(C.filterCount({},''),1);
 assert.equal(C.zipsHead('office','Upton'),'Matches for \u201cUpton\u201d');assert.equal(C.zipsHead('office',''),'Best ZIPs for office');
 assert.match(C.zipsHtml([],{type:'office',search:true,q:'Nowhere',filters:0}),/No ZIP named \u201cNowhere\u201d has a score for office\./);
 assert.match(C.zipsHtml([],{type:'office',search:true,q:'Nowhere',filters:1}),/No ZIP named \u201cNowhere\u201d matches these filters\./);
 assert.doesNotMatch(C.zipsHtml([],{type:'office',search:true,q:'Nowhere',filters:1}),/Loosen/);
 // an emptied field ends the search (typed away or its clear button), from the filter row or the header's field
 assert.match(page,/function setQ\(q\)\{S\.q=q;paintFbar\(\);rank\(true\)\}/);assert.match(page,/onCity:q=>setQ\(q\)/);
 assert.match(page,/document\.addEventListener\('input',e=>\{const t=e\.target,c=S\.ctx;if\(!S\.q\|\|!c\|\|!t\|\|!t\.matches\|\|!t\.matches\('input\[data-scope-q\]'\)\|\|t\.value\.trim\(\)\)return;/);
 assert.match(page,/\(c\.head&&c\.head\.contains\(t\)\)\)setQ\(''\)/);
 assert.match(page,/\$\('\.com-zt'\)\.textContent=C\.zipsHead\(S\.type,S\.q\)/);assert.match(page,/filters:C\.filterCount\(S\.f,S\.q\)/);
});

test('Best ZIPs: every cell labelled for the phone card, P2-P4 marked, no escaped markup, optional empty columns dropped',()=>{
 const rows=[row('92618',{daytime_pop:null,commercial_risk:null}),row('75024',{rank:2,city:'Plano',state:'TX',com_listings:7,daytime_pop:null,commercial_risk:null}),row('92130',{rank:3,city:'<b>San Diego</b>',daytime_pop:null,commercial_risk:null})];
 const h=C.zipsHtml(rows,{type:'retail',dataset:'ca'});
 const tds=[...h.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)];assert.ok(tds.length>=rows.length*5);
 for(const [,attrs,body] of tds){assert.match(attrs,/data-l="[^"]+"/);assert.doesNotMatch(text(body),/[<>]/,'escaped markup in a cell: '+body)}
 assert.match(h,/data-pri="2" data-l="Listings"|data-l="Listings"[^>]*data-pri="2"/);
 assert.match(h,/data-open="czip"/);assert.match(h,/data-key="92618"/);
 assert.doesNotMatch(h,/Daytime people|Property risk/,'an optional column with no value in any row is dropped (critique 15)');
 assert.match(h,/&lt;b&gt;San Diego/);
 // columns the type keeps stay even when no row has a value (the cell says No data, the phone card leaves it out); the asking cap and spread go like the other optional ones
 assert.match(h,/CMBS occupancy/);assert.match(h,/CMBS cap rate/);assert.doesNotMatch(h,/Asking cap rate|Cap spread/);
 assert.deepEqual(C.zipsModel(rows,{type:'retail',dataset:'ca'}).dropped,['ask','spr','daytime_pop','commercial_risk']);
 // the Texas row has a listings value in the data, but listings outside coverage are absent, never shown
 const tx=h.slice(h.indexOf('75024'),h.indexOf('92130'));
 assert.match(tx,/data-l="Listings"[^>]*><span class="na"/);assert.doesNotMatch(text(tx),/\b7\b/);
 assert.doesNotMatch(text(h),SOURCE_WORDS);
});

test('Best ZIPs states: thin types say they cannot be scored yet; filters that match nothing offer to loosen',()=>{
 assert.match(C.zipsHtml([],{type:'office',dataset:'ca'}),/Not enough data to score ZIPs for office yet\./);
 assert.match(C.zipsHtml([],{type:'industrial',dataset:'ca',filters:2}),/No ZIPs match\. Loosen a filter\./);
});

test('commercial ZIP sheet: only sections with data, missing values named once each, the unscored line, listings only inside coverage',()=>{
 const r=rec('92629');
 const m=C.zipModel(r,{type:'retail',dataset:'ca'});
 assert.equal(m.score,97);assert.equal(m.unscored,'');
 for(const s of m.sections){assert.ok(s.kv.length||s.bars.length||s.line,'no empty section: '+s.id)}
 const ids=m.sections.map(s=>s.id);assert.ok(ids.includes('biz'));assert.ok(ids.includes('list'));
 const h=C.zipSheet(m);
 assert.doesNotMatch(h,/>\s*0\s*</);assert.doesNotMatch(h,/NaN|undefined|null/);
 for(const s of m.sections){const n=(h.slice(h.indexOf('<h3>'+s.title+'</h3>')).split('</section>')[0].match(/class="missing"/g)||[]).length;assert.ok(n<=1,s.id)}
 assert.doesNotMatch(text(h),SOURCE_WORDS);
 // the same ZIP with no office score says so in the sheet head
 const off=C.zipModel(Object.assign({},r,{office_score:null,office_conf:null}),{type:'office',dataset:'ca'});
 assert.equal(off.unscored,'Not enough data to score this ZIP for office.');assert.match(C.zipSheet(off),/Not enough data to score this ZIP for office\./);
 // outside listing coverage the Listings here section is absent
 assert.ok(!C.zipModel(Object.assign({},r,{state:'TX'}),{type:'retail',dataset:'ca'}).sections.some(s=>s.id==='list'));
 assert.ok(C.zipModel(Object.assign({},r,{state:'TX'}),{type:'retail',dataset:'national'}).sections.some(s=>s.id==='list'));
 // a record with nothing commercial has no sections at all
 assert.deepEqual(C.zipModel({zip:'99999',state:'AK'},{type:'retail'}).sections,[]);
});

test('ZIP sheet parts bar and sector jobs bars come from the record; labels from the catalog when it is loaded',()=>{
 const r={zip:'92618',city:'Irvine',state:'CA',retail_score:88,retail_conf:0.8,score_parts:{retail:{income:96.9,daytime_pop:70,traffic:null}},lodes_jobs_retail:5000,lodes_jobs_office:12000,lodes_jobs_health:0};
 const m=C.zipModel(r,{type:'retail',dataset:'ca',metrics:{income:{label:'Household income'}}});
 assert.deepEqual(m.reasons.map(p=>[p.label,Math.round(p.score)]),[['Household income',97],['Daytime population',70]]);
 const jobs=m.sections.find(s=>s.id==='jobs');assert.deepEqual(jobs.bars.map(b=>b.label),['Office','Retail'],'zero and null sectors draw no bar');
 const h=C.zipSheet(m);assert.match(h,/class="hbars"/);assert.match(h,/Retail score/);
});

test('Data sheet: commercial sources with their state, score weights and the desk parts; the page itself names none',()=>{
 const sources=[{id:'census_cbp',name:'County Business Patterns',side:'commercial',status:'ok',coverage:34954,as_of:'2023'},{id:'zillow',name:'Zillow ZHVI',side:'residential',status:'ok'},
  {id:'bls_qcew',name:'BLS QCEW',side:'commercial',status:'needs_key',key_env:'BLS_KEY'}];
 const scores={retail_score:{inputs:[{key:'income',weight:0.1,direction:'higher'},{key:'retail_sqft_per_cap',weight:0.1,direction:'lower'}]}};
 const d=C.dataModel({type:'retail',sources,scores,metrics:{income:{label:'Household income'}},deskParts:DeckCRE.dataParts({counts:{by_source:{matthews:188}},generated_at:1794600000})});
 assert.deepEqual(d.sources.map(s=>s.name),['County Business Patterns','BLS QCEW','Matthews']);
 assert.equal(d.sources[0].gives,'35.0K ZIPs');assert.equal(d.sources[1].state,'needs_key');
 assert.ok(d.method.some(([k,v])=>k==='Retail score: Household income'&&v==='10%'));
 assert.ok(d.method.some(([,v])=>/lower is better/.test(v)));
 assert.ok(d.setup.some(s=>/Needs a key in BLS_KEY/.test(s.line)));assert.ok(d.setup.some(s=>s.state==='blocked'));
 assert.match(DeckUI.dataSheet(d),/County Business Patterns/);
});

test('the page registers its route; the old Markets > Commercial page is gone from deck.js',()=>{
 const page=fs.readFileSync(path.join(root,'static/pages/commercial.js'),'utf8'),deck=fs.readFileSync(path.join(root,'static/deck.js'),'utf8');
 assert.match(page,/DeckPages\.register\('realestate\/commercial',/);
 assert.doesNotMatch(deck,/oldPage\('commercial'/);
 for(const f of ['function commercial(','function creIndicators(','function creComps(','const v14Commercial'])assert.ok(!deck.includes(f),f);
 assert.match(page,/window\.DeckScope/,'the scope bar is Residential\'s, read, never copied');
 assert.doesNotMatch(page,/function (scopeQuery|parseSearch)\b/);
});

// F8 (2026-11-15): nothing in the deck linked to /cre, the desk on its own page
test('the deal section head opens the deal desk page, for the desk on screen; the TV board leaves it out',()=>{
 const page=fs.readFileSync(path.join(root,'static/pages/commercial.js'),'utf8'),css=fs.readFileSync(path.join(root,'static/css/commercial.css'),'utf8');
 assert.match(page,/<section class="sect com-desk"><h2 class="secttl"><span>Deal desk<\/span><a class="btn com-cre" href="'\+creHref\(\)\+'">Open deal desk<\/a><\/h2>/);
 const href=new Function('S',page.match(/function creHref\(\)\{[^\n]*\}/)[0]+'\nreturn creHref;');
 const at=p=>href({deskApi:p===undefined?null:{state:{person:p}}})();
 assert.deepEqual([at(),at('tanner'),at('jordan'),at('riley'),at('morgan')],['/cre','/cre','/cre?person=jordan','/cre?person=riley','/cre']);
 assert.match(css,/\nhtml\.tv \.com-cre\{display:none\}/);
});

// F13 (2026-11-15): the phone coming back on screen rebuilt the "ZIP or city" field, focus fell to the body and the keyboard closed. The
// behaviour is proven in Chromium by SeeFlows' field.mjs (lane report); this pins the two rules the red team set for it
test('the filter row keeps a field the reader is in or typed into; typed text is an input-event flag, never a value comparison',()=>{
 const page=fs.readFileSync(path.join(root,'static/pages/commercial.js'),'utf8'),live=page.slice(page.indexOf('// ==== DECK COMMERCIAL PURE END'));
 assert.match(live,/addEventListener\('input',e=>\{const t=e\.target;if\(t&&t\.matches&&t\.matches\('\.com-fbar input\[data-scope-q\]'\)\)typed=t\.value!==''\}\)/);
 assert.doesNotMatch(live,/defaultValue/);
 const pf=live.slice(live.indexOf('function paintFbar('),live.indexOf('function scopeRow('));
 assert.match(pf,/busy=!!keep&&\(typed\|\|!!\(a&&keep\.contains\(a\)\)\)/,'busy: focus inside the field or typed text');
 assert.match(pf,/if\(c!==keep\)c\.remove\(\)/,'the field node itself stays in the document');
 assert.ok(pf.indexOf('return}')<pf.indexOf('w.innerHTML=fbar()'),'a busy row is never rebuilt with innerHTML');
});

test('the desk formats match the shared formats (the desk runs on /cre without deck.js)',()=>{
 const F=DeckUI.fmt;
 for(const v of [1240000,845000,9450,2900000,18950000,-1200000])assert.equal(DeckCRE.fmt.money(v),F.money(v),'money '+v);
 for(const v of [7.183,5.1,0.5])assert.equal(DeckCRE.fmt.rate(v),F.rate(v),'rate '+v);
 for(const v of [17.14,100])assert.equal(DeckCRE.fmt.share(v),F.share(v),'share '+v);
 for(const v of [4.2,-1.3,0])assert.equal(DeckCRE.fmt.chg(v),F.chg(v),'chg '+v);
 for(const v of [12400,1200000,9450])assert.equal(DeckCRE.fmt.count(v),F.count(v),'count '+v);
 assert.equal(DeckCRE.fmt.psf(412),F.psf(412));
 for(const v of [0.4,-1.5])assert.equal(DeckCRE.fmt.pt(v),F.pt(v),'pt '+v);
});

test('freshness mark: the server\'s own age, refresh and stale flag from part=summary drive the one mark',()=>{
 const fresh=C.freshMark([[3600,86400,false],[600,3600]],0);
 assert.deepEqual(fresh,{age:3600,refresh:86400,missing:0},'the oldest part, fresh');
 assert.doesNotMatch(DeckUI.fresh(fresh),/Out of date/);
 const flagged=C.freshMark([[3600,86400,true],[600,3600]],0);
 assert.equal(flagged.age,3600);assert.match(DeckUI.fresh(flagged),/Out of date/,'the server calls it stale even inside 2 x refresh');
 const old=C.freshMark([[200000,86400,false]],1);
 assert.match(DeckUI.fresh(old),/Out of date/);assert.equal(old.missing,1);
 const page=fs.readFileSync(path.join(root,'static/pages/commercial.js'),'utf8');
 assert.match(page,/sm\.age.*sm\.refresh.*sm\.stale/s,'the page reads age, refresh and stale from the summary');
 assert.deepEqual(C.freshMark([],2),{age:null,refresh:86400,missing:2});
});

test('ZIP sheet reasons: a zero part prints its number and reads Weak, with no bar',()=>{
 const m=C.zipModel({zip:'92618',state:'CA',retail_score:70,retail_conf:0.8,score_parts:{retail:{income:96,traffic:0}}},{type:'retail',dataset:'ca'});
 const h=C.zipSheet(m);
 assert.doesNotMatch(h,/--v:/);assert.match(h,/<span class="com-wn">0 of 100<\/span>/);assert.match(h,/data-band="weak">Weak</);assert.match(h,/<span class="com-wn">96 of 100<\/span>/);
});

// L17 (2026-11-17): the type chips drive the columns. Records as the ZIP route serves them for California (live shard shape).
const caRec=(zip,o)=>Object.assign({zip,city:'Los Angeles',state:'CA',population:40000,biz_estabs:666,biz_estabs_5y:4.1,jobs_total:10475,jobs_retail:1564,jobs_office:891,jobs_industrial:3405,
 retail_score:67.7,retail_conf:0.7,office_score:42.9,office_conf:0.6,industrial_score:65.7,industrial_conf:0.6,multifamily_score:54.9,multifamily_conf:0.5,
 qcew_emp_yoy:1,qcew_retail_emp_yoy:-2.1,qcew_office_emp_yoy:2.3,qcew_industrial_emp_yoy:-2.4,zbpd_estabs_retail:124,zbpd_estabs_office:102,zbpd_estabs_industrial:225,bldg_multifamily_count:1181,
 cmbs_retail_occ:100,cmbs_office_occ:88.5,cmbs_industrial_occ:58.8,cmbs_multifamily_occ:91.2,cmbs_retail_cap:5.94,cmbs_office_cap:14.25,cmbs_industrial_cap:4.12,cmbs_multifamily_cap:4.97,
 crel_cap_retail:4.5,crel_cap_office:null,crel_cap_industrial:null,crel_cap_multifamily:8.19,com_median_cap:5.1,cap_spread_retail:-0.6,cap_spread_office:null,cap_spread_industrial:null,cap_spread_multifamily:1.2,cap_spread:-0.1,
 cmbs_occupancy:80,cmbs_occ_median:82,cmbs_cap_rate:6.1,com_listings:5,acs_units_5plus_share:8.77,bps_units_5plus_12m:103,commercial_risk:39},o);

test('each type shows its own columns with its own values; an all-types stand-in says so; the phone card carries every label',()=>{
 const rows=[caRec('90001',{rank:1})];
 const by=t=>{const h=C.zipsHtml(rows.map(r=>Object.assign({rank:1},r)),{type:t,dataset:'ca'});return {h,t:text(h)}};
 const r=by('retail');assert.match(r.t,/1,564 jobs/);assert.match(r.t,/[\u2212-]2\.1%/);assert.match(r.t,/124 businesses/);assert.match(r.t,/100\.0%/);assert.match(r.t,/4\.50%/);assert.match(r.t,/5\.94%/);assert.match(r.t,/[\u2212-]0\.6 pt/);assert.match(r.t,/5 listings/);
 assert.doesNotMatch(r.h,/Apartment buildings/);
 const o=by('office');assert.match(o.t,/891 jobs/);assert.match(o.t,/\+2\.3%/);assert.match(o.t,/102 businesses/);assert.match(o.t,/88\.5%/);assert.match(o.t,/14\.25%/);
 assert.match(o.t,/5\.10% all types/,'office has no asking cap of its own: the all-types one stands in and says so, as its own word');assert.match(o.t,/[\u2212-]0\.1 pt all types/);
 const i=by('industrial');assert.match(i.t,/3,405 jobs/);assert.match(i.t,/225 businesses/);assert.match(i.t,/58\.8%/);assert.match(i.t,/4\.12%/);
 const m=by('multifamily');assert.match(m.t,/10\.5K jobs/);assert.match(m.t,/1,181 buildings/);assert.match(m.t,/91\.2%/);assert.match(m.t,/8\.19%/);assert.match(m.t,/8\.8%/,'homes in 5+ unit buildings');assert.match(m.t,/103 homes/);assert.match(m.t,/\+1\.2 pt/);
 for(const t of C.TYPE_KEYS){const h=by(t).h;assert.match(h,new RegExp('data-l="'+C.SECTOR[t][1]+'"'));for(const l of ['Job change, 1 yr','CMBS occupancy','Asking cap rate','Cap spread','Listings'])assert.match(h,new RegExp('data-l="'+l+'"'),t+': '+l)}
 // a cap spread of its own shows with no stand-in tag
 assert.match(by('retail').h,/data-l="Cap spread">[\u2212-]0\.6 pt<\/td>/);
});

test('the list keeps the server order and marks the score column only while it is sorted by score; the list says when it holds no listing',()=>{
 const rows=[row('92618',{rank:1,retail_score:80,com_listings:0}),row('92619',{rank:2,retail_score:90,com_listings:0})];
 const byScore=C.zipsHtml(rows,{type:'retail',dataset:'ca'}),byJobs=C.zipsHtml(rows,{type:'retail',dataset:'ca',sort:'jobs'});
 assert.ok(byJobs.indexOf('92618')<byJobs.indexOf('92619'),'the server order stands: no client re-sort');assert.doesNotMatch(byJobs,/aria-sort/);assert.match(byScore,/aria-sort="descending"/);
 assert.match(text(byScore),/No listings in these ZIPs right now\. The scores and market columns still apply\./);
 assert.match(text(C.zipsHtml([row('75024',{state:'TX',com_listings:null})],{type:'retail',dataset:'ca'})),/Listings are not tracked in this state yet\./);
 assert.doesNotMatch(text(C.zipsHtml([row('92618',{com_listings:3})],{type:'retail',dataset:'ca'})),/No listings in these ZIPs/);
});

test('one line of help per column, in plain words, under the list; every rank column exists in the zips table so the route never refuses cols=',()=>{
 for(const t of C.TYPE_KEYS){const cs=C.zipCols(t);for(const c of cs)assert.ok(c.help&&c.help.length>10&&!/\u2014/.test(c.help),t+': '+c.key+' has a help line');
  const h=C.helpHtml(t,cs);assert.match(h,/<summary>What each column means<\/summary>/);assert.equal((h.match(/<dt>/g)||[]).length,cs.length);assert.doesNotMatch(text(h),SOURCE_WORDS)}
 assert.equal(C.helpHtml('retail',[]),'');
 const zips=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/housing-national-v2/zips.json'),'utf8')).cols;
 for(const t of C.TYPE_KEYS)for(const c of C.cols(t))assert.ok(zips.includes(c),t+': '+c+' is not a zips.json column, so the rank route would answer bad cols');
 for(const t of C.TYPE_KEYS)assert.ok(C.typeBlurb(t).length>30);assert.equal(C.typeBlurb('nope'),C.typeBlurb('retail'));
});

test('no listings of a type in the scope: the page says so with the type and place and keeps the market facts; filters and a buy box keep the desk\'s own words',()=>{
 const idle={status:'ok',rows:[],total:0,f:{},counts:{'':0},dataset:'national',scopeKind:'state'};
 const facts=C.scopeFacts('retail',{retail_estabs:106130,cmbs_retail_occ:93.2,cap_spread_retail:-0.4,qcew_retail_emp_yoy:1.2});
 assert.deepEqual(facts.map(f=>f[0]),['Retail businesses','Job change, 1 yr','CMBS occupancy','Cap spread']);
 const h=C.noListings(idle,'retail','California',facts,true);
 assert.match(text(h),/No retail listings in California right now\. The market facts for retail there still apply\./);assert.match(h,/<dt>CMBS occupancy<\/dt><dd>93\.2%<\/dd>/);
 assert.match(text(C.noListings(idle,'office','Texas',[],true)),/No office listings in Texas right now\. The ZIP table above still shows office scores and market figures\./);
 assert.equal(C.noListings(Object.assign({},idle,{total:4,rows:[{}]}),'retail','California',facts,true),'','deals on the desk: no note');
 assert.equal(C.noListings(Object.assign({},idle,{status:'loading'}),'retail','California',facts,true),'');
 assert.equal(C.noListings(Object.assign({},idle,{f:{types:['Retail']}}),'retail','California',facts,true),'','a filter that matches nothing is the desk\'s own message');
 assert.equal(C.noListings(Object.assign({},idle,{boxId:'mf'}),'retail','California',facts,true),'');assert.equal(C.noListings(Object.assign({},idle,{price_max:500000}),'retail','California',facts,true),'');
 assert.equal(C.noListings(idle,'retail','Texas',facts,false),'','outside the listing coverage the desk says so itself');assert.equal(C.noListings(idle,'retail','Texas',facts),'','coverage unknown: the desk\'s own words');
 assert.equal(C.scopeFacts('multifamily',{}).length,0,'no fact is invented');assert.ok(!C.scopeFacts('retail',{cmbs_retail_occ:0}).some(f=>/Asking/.test(f[0])));
});

test('ZIP sheet: the type\'s own section first, score parts as plain reasons with band, figure, why and weight',()=>{
 const parts={retail:{income:94.8,daytime_pop:77.6,traffic:98.9,retail_sqft_per_cap:12,commercial_risk:71.9},office:{jobs_office:76.8,cmbs_office_occ:30,gsa_expiring_24m_share:5},
  industrial:{power_cost:0.4,hpms_truck_aadt_max:99.3},multifamily:{rent_trend_1y:81.5,vacancy_rate:20,mystery_part:60}};
 const z=caRec('92629',{hh_income:142807,daytime_pop:45287,hpms_aadt_max:386600,retail_sqft_per_cap:54.5,score_parts:parts,power_cost:39.7,hpms_truck_aadt_max:12000,rent_trend_1y:5.51,vacancy_rate:4.5});
 const scores={retail_score:{inputs:[{key:'daytime_pop',weight:0.15,direction:'higher'},{key:'income',weight:0.1,direction:'higher'},{key:'traffic',weight:0.1,direction:'higher'},{key:'retail_sqft_per_cap',weight:0.1,direction:'lower'}]}};
 const m=C.zipModel(z,{type:'retail',dataset:'ca',scores});
 assert.equal(m.sections[0].id,'type');assert.equal(m.sections[0].title,'Retail in this ZIP');
 assert.deepEqual(m.reasons.map(r=>r.key).slice(0,4),['daytime_pop','traffic','income','retail_sqft_per_cap'],'heaviest weight first, then the stronger part');
 const d=m.reasons[0];assert.equal(d.label,'Daytime population');assert.equal(d.band,'Strong');assert.equal(d.value,'45.3K people');assert.equal(d.weight,15);assert.match(d.why,/foot traffic/);
 assert.equal(m.reasons.find(r=>r.key==='retail_sqft_per_cap').band,'Weak');
 assert.equal(m.summary,'Strongest: Traffic on the busiest road. Weakest: Retail space per person.');
 const h=C.zipSheet(m);assert.match(h,/<h3>Why this score<\/h3>/);assert.match(text(h),/45\.3K people\. More people nearby on workdays means more foot traffic\. Counts 15% of the score\./);assert.match(h,/data-band="strong">Strong</);
 assert.doesNotMatch(h,/NaN|undefined|null/);assert.doesNotMatch(text(h),SOURCE_WORDS);
 const sec=m.sections[0].kv.map(x=>x.label+': '+x.text).join(' | ');assert.match(sec,/Retail jobs: 1,564 jobs/);assert.match(sec,/CMBS occupancy: 100\.0%/);assert.match(sec,/Asking cap rate: 4\.50%/);
 for(const t of ['office','industrial','multifamily']){const mm=C.zipModel(z,{type:t,dataset:'ca'});assert.equal(mm.sections[0].title,C.typeLabel(t)+' in this ZIP');assert.ok(mm.reasons.length>0);
  for(const r of mm.reasons)assert.ok(r.why||r.key==='mystery_part',t+': '+r.key+' has a plain reason')}
 assert.equal(C.zipModel(z,{type:'office',dataset:'ca'}).reasons.find(r=>r.key==='gsa_expiring_24m_share').band,'Weak');
 // the all-types stand-in is named on the sheet too
 assert.match(C.zipModel(z,{type:'office',dataset:'ca'}).sections[0].kv.map(x=>x.label+': '+x.text).join(' | '),/Asking cap rate: 5\.10% \(all types\)/);
 // a record with no score parts has no reasons section; the part with no entry keeps its catalog label and prints no figure
 assert.doesNotMatch(C.zipSheet(C.zipModel({zip:'99999',state:'AK',retail_score:50},{type:'retail'})),/Why this score/);
 const my=C.zipModel(z,{type:'multifamily',dataset:'ca',metrics:{mystery_part:{label:'Mystery part'}}}).reasons.find(r=>r.key==='mystery_part');assert.deepEqual([my.label,my.value,my.why],['Mystery part',null,'']);
});

test('the page: enrichment reads each ZIP record once, the table never waits on a missing record, the help and the intro are drawn, every get keeps its bound',()=>{
 const page=fs.readFileSync(path.join(root,'static/pages/commercial.js'),'utf8');
 assert.match(page,/async function enrich\(rows\)/);assert.match(page,/S\.zr\.set\(r\.zip,x&&x\.ok&&x\.data&&!x\.data\.error\?x\.data:null\)/);assert.match(page,/S\.zr\.clear\(\)/);
 assert.match(page,/if\(fresh\)\{await enrich\(fresh\);if\(t!==S\.tok\)return\}/,'a stale answer is dropped after the records arrive');
 assert.match(page,/C\.helpHtml\(S\.type,C\.zipsModel\(rows,/);assert.match(page,/\$\('\.com-intro'\)\.textContent=C\.typeBlurb\(S\.type\)/);
 assert.match(page,/function paintNote\(\)/);assert.match(page,/onPaint:\(\)=>\{paintStrip\(\);paintNote\(\)/);assert.match(page,/setType\(t\)\{[^}]*paintNote\(\)/);
 const css=fs.readFileSync(path.join(root,'static/css/commercial.css'),'utf8');assert.match(css,/\.com-desk\[data-nolist\] \.cre-desk>\.es\{display:none\}/);assert.match(css,/\.com-help>summary\{[^}]*min-height:var\(--hit\)/);
});
