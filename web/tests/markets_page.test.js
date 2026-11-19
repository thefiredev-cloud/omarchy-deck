// Real estate > Markets (owner order 2026-11-17): states and metros by segment. The reads ask only for the segment's fields (capped),
// Your markets is California plus the three home metros, the table ranks by the lead column in its better direction with missing
// values last and printed as a dash (never 0), a tap on a column head flips or moves the sort, the row sheet lists every segment, and
// the page is registered as the third Real estate sub. Fixture: tests/fixtures/housing-markets (a real excerpt of the live v2 manifest).
require('./setup-core.js');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const block=(file,a,b)=>{const s=read(file);return s.slice(s.indexOf(a),s.indexOf(b))};
const DeckUI=new Function(block('static/deck.js','// ==== DECK V6 UI HELPERS BEGIN','// ==== DECK V6 UI HELPERS END ====')+'\nreturn DeckUI;')();
const M=new Function('DeckUI',block('static/pages/markets.js','// ==== DECK MARKETS PURE BEGIN','// ==== DECK MARKETS PURE END ====')+'\nreturn DeckMarkets;')(DeckUI);
const man=JSON.parse(read('tests/fixtures/housing-markets/manifest.json'));
const specFile=JSON.parse(read('scripts/national/segments.json'));
const text=h=>h.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
// the spec as /api/housing/national?part=segments serves it: each segment cut to the catalog's fields, the catalog alongside
const spec={segments:specFile.segments.map(s=>{const f=s.fields.filter(x=>man.fields[x]);return {id:s.id,label:s.label,lead:f.includes(s.lead)?s.lead:f[0]||null,fields:f,skipped:s.fields.filter(x=>!man.fields[x])}}),
 fields:Object.fromEntries(Object.entries(man.fields).map(([k,e])=>[k,{label:e.label,unit:e.unit,better:e.better,sources:e.sources.map(s=>({id:s.id,name:(man.sources.find(x=>x.id===s.id)||{}).name||null,as_of:s.as_of}))}]))};
const F=spec.fields;
const seg=id=>M.segOf(spec,id);
const qp=q=>new URLSearchParams(q.split('?')[1]);

test('reads: one list per level with the row keys first and only the segment fields; Your markets is two reads cut to CA',()=>{
 const [s]=M.listQueries('states',seg('residential'));
 assert.equal(s.part,'states');const p=qp(s.q);assert.equal(p.get('part'),'states');assert.equal(p.get('state'),null);
 assert.deepEqual(p.get('fields').split(','),['state','name'].concat(seg('residential').fields));
 const [m]=M.listQueries('metros',seg('multifamily'));assert.deepEqual(qp(m.q).get('fields').split(',').slice(0,2),['cbsa','name']);
 const mine=M.listQueries('mine',seg('office'));assert.deepEqual(mine.map(x=>x.part),['states','metros']);
 assert.ok(mine.every(x=>qp(x.q).get('state')==='CA'));
 assert.equal(M.listQueries('nope',seg('retail'))[0].part,'states','an unknown level reads states');
 // the widest segment in the spec still fits the server's 100-key cap with its row keys
 const wide={id:'w',fields:specFile.segments[1].fields.concat(Array.from({length:80},(_,i)=>'x'+i))};
 assert.ok(qp(M.listQueries('metros',wide)[0].q).get('fields').split(',').length<=M.MAX_KEYS);
 assert.equal(M.fieldsOf({fields:['ok_1','Bad','x'.repeat(41),'']}).join(),'ok_1','only clean field ids go on the wire');
});

test('Your markets: California, then LA-Long Beach-Anaheim, San Diego, Riverside-San Bernardino in that order',()=>{
 const rows=M.rowsOf('mine',{states:man.states,metros:man.metros});
 assert.deepEqual(rows.map(r=>r.key),['CA','31080','41740','40140']);
 assert.equal(rows[0].name,'California');assert.equal(rows[1].name,'Los Angeles-Long Beach-Anaheim');assert.equal(rows[1].sub,'CA');
 assert.equal(rows[1].full,'Los Angeles-Long Beach-Anaheim, CA');
 assert.equal(M.rowsOf('states',{states:[{state:'x'},null,{state:'TX',name:'Texas'}]}).length,1,'a row without a state code is dropped');
});

test('table model: lead column first, ranked best first over the whole list, missing values last with no rank, search keeps ranks',()=>{
 const rows=M.rowsOf('metros',{metros:man.metros});
 const m=M.model({level:'metros',seg:seg('residential'),fields:F,rows});
 assert.equal(m.cols[0],'gross_yield');assert.deepEqual(m.sort,{key:'gross_yield',dir:'descending'});
 const ys=m.rows.map(r=>r.v.gross_yield);assert.deepEqual(ys,ys.slice().sort((a,b)=>b-a));
 assert.deepEqual(m.rows.map(r=>r.rank),[1,2,3,4,5]);
 // a row without the sort value: no rank, last
 const gap=rows.map(r=>r.key==='35620'?Object.assign({},r,{v:Object.assign({},r.v,{gross_yield:null})}):r);
 const g=M.model({level:'metros',seg:seg('residential'),fields:F,rows:gap});
 assert.equal(g.rows[g.rows.length-1].key,'35620');assert.equal(g.rows[g.rows.length-1].rank,null);
 // search: the matches keep their rank in the whole list
 const sd=M.model({level:'metros',seg:seg('residential'),fields:F,rows,q:'san diego'});
 assert.equal(sd.rows.length,1);assert.equal(sd.rows[0].key,'41740');assert.equal(sd.rows[0].rank,m.rows.find(r=>r.key==='41740').rank);
 assert.match(M.headLine(sd,F),/^Ranked by gross rent yield, highest first · 1 of 5 metros$/);
 // a field with no value in any row is hidden and named once
 const h=M.model({level:'states',seg:{id:'t',lead:'zz_none',fields:['zz_none','pop']},fields:F,rows:M.rowsOf('states',{states:man.states})});
 assert.deepEqual(h.cols,['pop']);assert.deepEqual(h.hidden,['zz_none']);assert.equal(h.sort.key,'pop');
});

test('a field only a few places publish stays out of the table on a long list, sits in the row sheet and is named in the Data sheet',()=>{
 // 40 synthetic metros, an asking cap rate on 3 of them (the Southern California listings): too few for a column of 40
 const rows=Array.from({length:40},(_,i)=>({kind:'metro',key:String(10000+i),name:'Metro '+i,full:'Metro '+i+', CA',v:{pop:1000+i,crel_cap_office:i<3?6+i/10:null}}));
 const sg={id:'t',lead:'pop',fields:['pop','crel_cap_office']};
 const m=M.model({level:'metros',seg:sg,fields:F,rows});
 assert.deepEqual(m.cols,['pop']);assert.deepEqual(m.sparse,['crel_cap_office']);assert.deepEqual(m.hidden,[]);
 const dm=M.dataModel({fields:F,seg:sg,cols:m.cols,hidden:m.hidden,sparse:m.sparse});
 assert.ok(dm.method.some(([k,v])=>k==='In row sheets only'&&/open a row/.test(v)));
 // a short list (Your markets, 4 rows) keeps any field with a value
 const short=M.model({level:'metros',seg:sg,fields:F,rows:rows.slice(0,4)});
 assert.deepEqual(short.cols,['pop','crel_cap_office']);assert.deepEqual(short.sparse,[]);
});

test('sort: better lower starts ascending, a tap on the same head flips it, a picked column survives only while on screen',()=>{
 const rows=M.rowsOf('states',{states:man.states});
 const sg={id:'t',lead:'days_on_market',fields:['days_on_market','gross_yield']};
 const m=M.model({level:'states',seg:sg,fields:F,rows});assert.deepEqual(m.sort,{key:'days_on_market',dir:'ascending'});
 assert.ok(m.rows[0].v.days_on_market<=m.rows[1].v.days_on_market);
 assert.deepEqual(M.nextSort(m.sort,'days_on_market',F),{key:'days_on_market',dir:'descending'});
 assert.deepEqual(M.nextSort(m.sort,'gross_yield',F),{key:'gross_yield',dir:'descending'});
 assert.deepEqual(M.nextSort({key:'gross_yield',dir:'descending'},'days_on_market',F),{key:'days_on_market',dir:'ascending'});
 const picked=M.model({level:'states',seg:sg,fields:F,rows,sort:{key:'gross_yield',dir:'ascending'}});
 assert.deepEqual(picked.sort,{key:'gross_yield',dir:'ascending'});
 assert.equal(M.model({level:'states',seg:sg,fields:F,rows,sort:{key:'pop',dir:'ascending'}}).sort.key,'days_on_market','a column not on screen falls back to the lead');
});

test('formats follow the catalog unit; a change carries its sign; missing is null, never 0',()=>{
 const f=(unit,v,id)=>M.fmtField({unit},v,id);
 assert.equal(f('usd',777102),'$777K');assert.equal(f('usd_month',2691),'$2,691/mo');
 assert.equal(f('pct',4.14,'gross_yield'),'4.14%');assert.equal(f('pct',0.83,'value_trend_1y'),'+0.8%');assert.equal(f('pct',-1.24,'jobs_trend'),'\u22121.2%');
 // rates read with two decimals, as on Residential (7.11%): the 30-yr rate, cap rates, yields; other shares keep one
 assert.equal(f('pct',7.11,'mortgage_rate'),'7.11%');assert.equal(f('pct',5.8,'crel_cap_industrial'),'5.80%');assert.equal(f('pct',6.43,'cmbs_office_cap'),'6.43%');
 assert.equal(f('pct',3.71,'unemployment'),'3.7%');assert.equal(f('pct',4.1,'cap_spread_pct'),'4.1%');
 assert.equal(f('pct_pts',0.76),'+0.76 pt');assert.equal(f('count',50739),'50.7K');assert.equal(f('sqft',2.5e6),'2.5M\u00a0SF');
 assert.equal(f('kwh_cents',12.34),'12.3\u00a2');assert.equal(f('score',61.6),'62');assert.equal(f('ratio',3.98),'4.0');assert.equal(f('days',41.2),'41');
 for(const v of [null,undefined,'',NaN,'12'])assert.equal(f('usd',v),null);
 assert.equal(f('pct',0,'vacancy_rate'),'0.0%','a measured zero prints');
});

test('table markup: rank and place frozen first, sortable heads, a dash for missing values, rows open the sheet, text escaped',()=>{
 const rows=M.rowsOf('states',{states:man.states.concat([{state:'ZZ',name:'<b>x</b>'}])});
 const m=M.model({level:'states',seg:seg('residential'),fields:F,rows});
 const h=M.tableHtml(m,F);
 assert.match(h,/^<div class="htw scroll mkt-tw"><table class="htbl" aria-label="Residential by state">/);
 assert.match(h,/<th scope="col" class="n" aria-sort="descending"><button type="button" class="sort" data-sort="gross_yield">Gross rent yield<\/button><\/th>/);
 assert.match(h,/<tr tabindex="0" data-open="mkt" data-key="CA">/);
 assert.match(h,/<span class="mkt-rk">\d<\/span>California<\/b><small>CA<\/small>/);
 assert.ok(!h.includes('<b>x</b>'));assert.match(h,/&lt;b&gt;x&lt;\/b&gt;/);
 assert.match(h,/<span class="na" aria-label="No data">-<\/span>/,'ZZ has no values');
 assert.doesNotMatch(text(h),/Zillow|Census|Redfin|as of/i,'no source names on the page');
 assert.equal(M.tableHtml(M.model({level:'states',seg:{id:'e',fields:[]},fields:F,rows}),F),'','no columns, no table');
});

test('all six segments render real columns for states and metros from the live manifest excerpt',()=>{
 for(const s of spec.segments)for(const level of ['states','metros','mine']){
  const m=M.model({level,seg:s,fields:F,rows:M.rowsOf(level,{states:man.states,metros:man.metros})});
  assert.ok(m.cols.length>0,s.id+' '+level);assert.ok(m.rows.length>0,s.id+' '+level);
  assert.ok(m.rows.some(r=>r.rank===1),s.id+' '+level+' has a leader')}
 assert.deepEqual(M.segs(spec).map(s=>s.label),['Residential','Multifamily','Retail','Office','Industrial','People and jobs']);
});

test('row sheet: every segment for one market, values labelled, missing ones named once; reads chunked and cut to its state',()=>{
 const ca=man.states.find(r=>r.state==='CA');
 const sm=M.sheetModel(spec,F,ca);assert.deepEqual(sm.sections.map(s=>s.id),spec.segments.map(s=>s.id));
 const res=sm.sections.find(s=>s.id==='residential');assert.deepEqual(res.items.find(i=>i.key==='home_value'),{key:'home_value',label:'Typical home value',value:'$777K'});
 const h=M.sheetHtml(sm,M.goLink('state','CA'));
 assert.match(h,/<button type="button" class="btn" data-mkt-scope="state" data-key="CA">Open in Residential<\/button>/);
 assert.match(h,/<section class="sh-sec mkt-sh" data-seg="multifamily"><h3>Multifamily<\/h3><dl class="kv">/);
 assert.match(M.sheetHtml(M.sheetModel(spec,F,{state:'CA',pop:1}),''),/Not reported: /);
 assert.match(M.goLink('metro','Los Angeles-Long Beach-Anaheim, CA'),/data-mkt-scope="metro" data-key="Los Angeles-Long Beach-Anaheim, CA"/);
 assert.equal(M.goLink('state',''),'');
 // reads: a metro reads metros in its first state; a long field list splits under the cap
 const big={segments:[{id:'a',fields:Array.from({length:80},(_,i)=>'f'+i)},{id:'b',fields:Array.from({length:80},(_,i)=>'g'+i)}]};
 const qs=M.sheetQueries(big,'metro','35620','New York-Newark-Jersey City, NY-NJ');
 assert.equal(qs.length,2);for(const q of qs){const p=qp(q);assert.equal(p.get('part'),'metros');assert.equal(p.get('state'),'NY');assert.ok(p.get('fields').split(',').length<=M.MAX_KEYS)}
 assert.equal(qp(M.sheetQueries(spec,'state','CA','California')[0]).get('state'),'CA');
 const row=M.sheetRow('metro','31080',[{metros:[{cbsa:'31080',name:'LA',a:1}]},null,{metros:[{cbsa:'41740'},{cbsa:'31080',b:2}]}]);
 assert.deepEqual(row,{cbsa:'31080',name:'LA',a:1,b:2});
 assert.equal(M.sheetRow('state','TX',[{states:[{state:'CA'}]}]),null);
 assert.equal(M.keyKind('CA'),'state');assert.equal(M.keyKind('31080'),'metro');assert.equal(M.keyKind('ca'),null);assert.equal(M.keyKind('x'),null);
});

test('Data sheet: the sources behind the columns on screen with their periods, the method, and what this build lacks',()=>{
 const s=seg('multifamily'),rows=M.rowsOf('states',{states:man.states}),m=M.model({level:'states',seg:s,fields:F,rows});
 const d=M.dataModel({fields:F,seg:s,cols:m.cols,hidden:m.hidden});
 assert.ok(d.sources.length>0&&d.sources.every(x=>x.name&&x.gives&&x.state==='ok'));
 assert.ok(d.sources.some(x=>x.asOf),'periods ride along');
 assert.ok(d.method.some(r=>r[0]==='Not in this build'&&/fields of the Multifamily spec/.test(r[1])));
 assert.ok(d.method.some(r=>r[0]==='Your markets'));
 for(const r of d.method)assert.doesNotMatch(r[1],/\u2014/,'no em dashes');
});

// verifier 2026-11-17: in Markets the Redfin metro, state and ZIP versions of one measure sat side by side under one label, and the
// state and metro versions sat half empty in Your markets
const LF={
 rfm_mf_median_sale:{label:'Metro median sale price, multifamily 2-4 units (Redfin)',unit:'usd',level:'cbsa',sources:[{id:'redfin_metro_market',publisher:'Redfin'}]},
 rfs_mf_median_sale:{label:'State median sale price, multifamily 2-4 units (Redfin)',unit:'usd',level:'state',sources:[{id:'redfin_state_market',publisher:'Redfin'}]},
 rfmf_median_sale:{label:'Median sale price, multifamily 2-4 units',unit:'usd',level:'zip',sources:[{id:'redfin_mf_zip',publisher:'Redfin'}]},
 a1m_rental_vacancy:{label:'Rental vacancy rate (ACS 1-year)',unit:'pct',level:'cbsa',sources:[{id:'acs1_metro',publisher:'Census'}]},
 a1s_rental_vacancy:{label:'Rental vacancy rate (ACS 1-year)',unit:'pct',level:'state',sources:[{id:'acs1_state',publisher:'Census'}]},
 dup_a:{label:'Typical rent',unit:'usd_month',level:'zip',sources:[{id:'zillow_zori',publisher:'Zillow'}]},
 dup_b:{label:'Typical rent',unit:'usd_month',level:'zip',sources:[{id:'hud_safmr',publisher:'HUD'}]}};
const LSEG={id:'multifamily',label:'Multifamily',lead:'rfs_mf_median_sale',fields:Object.keys(LF)};
const lrow=(kind,key,v)=>({key,kind,name:key,sub:'',v});
const LROWS={states:[lrow('state','CA',{rfs_mf_median_sale:1000000,a1s_rental_vacancy:4.1,rfmf_median_sale:990000,dup_a:2500,dup_b:2400})],
 metros:[lrow('metro','31080',{rfm_mf_median_sale:1083938,a1m_rental_vacancy:4.3,rfmf_median_sale:1060000,dup_a:2700,dup_b:2600}),lrow('metro','41740',{rfm_mf_median_sale:900000,a1m_rental_vacancy:3.9})]};

test('levels: States show no metro-only field, Metros no state-only field; ZIP fields and blends show on both',()=>{
 const st=M.model({level:'states',seg:LSEG,fields:LF,rows:LROWS.states}),me=M.model({level:'metros',seg:LSEG,fields:LF,rows:LROWS.metros});
 assert.ok(!st.cols.includes('rfm_mf_median_sale')&&!st.hidden.includes('rfm_mf_median_sale')&&!st.cols.includes('a1m_rental_vacancy'),'a metro field is not even named missing on States');
 assert.ok(!me.cols.includes('rfs_mf_median_sale')&&!me.hidden.includes('rfs_mf_median_sale'),'a state field is not even named missing on Metros');
 assert.ok(st.cols.includes('rfmf_median_sale')&&me.cols.includes('rfmf_median_sale'));
 assert.equal(me.cols[0],'rfm_mf_median_sale','a state lead off this level gives way to the first metro field');
 assert.equal(M.levelOf(LF,'rfm_mf_median_sale'),'metro');assert.equal(M.levelOf(LF,'rfmf_median_sale'),null);assert.equal(M.levelOf({},'x'),null);
});

test('labels: two fields with one label take their level word, else their publisher; a column label is never repeated',()=>{
 const me=M.model({level:'metros',seg:LSEG,fields:LF,rows:LROWS.metros}),labels=me.cols.map(id=>me.labels.get(id));
 assert.equal(new Set(labels).size,labels.length,'unique: '+labels.join(' | '));
 assert.equal(me.labels.get('dup_a'),'Typical rent (Zillow)');assert.equal(me.labels.get('dup_b'),'Typical rent (HUD)');
 assert.equal(me.labels.get('rfmf_median_sale'),'Median sale price, multifamily 2-4 units','unique labels stay as they are');
 const h=M.tableHtml(me,LF);assert.match(h,/data-sort="dup_a">Typical rent \(Zillow\)</);
 assert.deepEqual([...M.labelsFor(['a1m_rental_vacancy','a1s_rental_vacancy'],LF).values()],['Rental vacancy rate (ACS 1-year) (metro)','Rental vacancy rate (ACS 1-year) (state)']);
 assert.match(M.headLine(me,LF),/^Ranked by metro median sale price, multifamily 2-4 units \(Redfin\), highest first/,'the publisher keeps its capital');
});

test('Your markets: a state field and a metro field of one measure share a column, the state row reading its own field',()=>{
 const m=M.model({level:'mine',seg:LSEG,fields:LF,rows:LROWS.states.concat(LROWS.metros)});
 assert.ok(!m.cols.includes('rfs_mf_median_sale')&&!m.cols.includes('a1s_rental_vacancy'),'the state half folds into the metro column');
 assert.equal(m.labels.get('rfm_mf_median_sale'),'Median sale price, multifamily 2-4 units (Redfin)','the shared column names the measure, no level word');
 assert.equal(m.labels.get('a1m_rental_vacancy'),'Rental vacancy rate (ACS 1-year)');
 const ca=m.rows.find(r=>r.key==='CA');assert.equal(ca.v.rfm_mf_median_sale,1000000);assert.equal(ca.v.a1m_rental_vacancy,4.1);
 assert.equal(m.rows[0].key,'31080','the state row ranks in the shared column');
 assert.deepEqual([...M.pairsOf(Object.keys(LF),LF)],[['rfm_mf_median_sale','rfs_mf_median_sale'],['a1m_rental_vacancy','a1s_rental_vacancy']]);
 const d=M.dataModel({fields:LF,seg:LSEG,cols:m.cols,hidden:m.hidden,pairs:m.pairs});
 const names=d.sources.map(s=>s.name);
 assert.ok(['redfin_metro_market','redfin_state_market','acs1_metro','acs1_state'].every(x=>names.includes(x)),'both halves of a shared column name their sources: '+names.join(','));
});

test('row sheet: a metro sheet leaves state fields out, labels are unique per segment, the reads skip state fields',()=>{
 const sp={segments:[LSEG],fields:LF};
 const sm=M.sheetModel(sp,LF,Object.assign({cbsa:'31080'},LROWS.metros[0].v),'metro'),s=sm.sections[0];
 const all=s.items.map(i=>i.label).concat(s.missing);
 assert.ok(!s.items.some(i=>i.key==='rfs_mf_median_sale')&&!all.some(l=>/^State /.test(l)),'no state field on a metro sheet');
 assert.equal(new Set(all).size,all.length,'unique labels: '+all.join(' | '));
 const q=M.sheetQueries(sp,'metro','31080','Los Angeles-Long Beach-Anaheim, CA')[0];
 assert.ok(!qp(q).get('fields').split(',').includes('rfs_mf_median_sale')&&qp(q).get('fields').split(',').includes('rfm_mf_median_sale'));
 assert.ok(M.sheetModel(sp,LF,{state:'CA',rfs_mf_median_sale:1},'state').sections[0].items.some(i=>i.key==='rfs_mf_median_sale'));
});

test('the ranked-by line wraps on a phone: markets.css lets .act break inside the section head',()=>{
 const css=read('static/css/markets.css');
 assert.match(css,/\.mkt-main>\.secttl \.act\{[^}]*white-space:normal[^}]*\}/);
 assert.match(css,/\.mkt-main>\.secttl \.act\{[^}]*overflow-wrap:anywhere[^}]*\}/);
});

test('registration: the third Real estate sub with its container, style sheet and script; the page registers with show',()=>{
 const html=read('static/index.html'),app=read('static/app.js'),js=read('static/pages/markets.js');
 assert.match(app,/realestate:\['residential','commercial','markets'\]/);
 assert.match(html,/data-sub="commercial" aria-selected="false">Commercial<\/button><button type="button" role="tab" data-sub="markets" aria-selected="false">Markets<\/button>/);
 assert.match(html,/<div class="sub" id="pg-realestate-markets" data-sub="markets" hidden><\/div>/);
 assert.ok(html.indexOf('href="/css/markets.css"')>html.indexOf('href="/css/commercial.css"'));
 assert.ok(html.indexOf('<script src="/pages/markets.js">')>html.indexOf('<script src="/pages/commercial.js">'));
 assert.match(js,/DeckPages\.register\('realestate\/markets',\{every:600000,\n  async show\(ctx\)/);
 assert.doesNotMatch(js,/\u2014/,'no em dashes');
});
