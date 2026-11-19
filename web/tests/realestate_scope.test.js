// DeckScope (UiApi 4.x): the one stored Real estate scope shared by Residential and Commercial. Pure parts only:
// normalising, the route params it sends, labels, the search parser, storage and change events, and its markup.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','static/pages/realestate.js'),'utf8');
const store=init=>{const m=new Map(Object.entries(init||{}));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m}};
// the module body runs with no window, document, DeckPages or DeckShell: nothing registers or wires
const load=ls=>new Function('localStorage','DeckUI',src+'\nreturn DeckScope;')(ls||store(),{});

test('scope values normalise: unknown kinds are Your markets, a state or metro scope always names its place',()=>{
 const S=load();
 assert.deepEqual(S.norm(null),{kind:'mine',state:'',metro:''});
 assert.deepEqual(S.norm({kind:'galaxy'}),{kind:'mine',state:'',metro:''});
 assert.deepEqual(S.norm({kind:'state',state:' tx '}),{kind:'state',state:'TX',metro:''});
 assert.deepEqual(S.norm({kind:'state',state:'ZZ'}),{kind:'state',state:'CA',metro:''},'a code that is no state falls back to California');
 assert.deepEqual(S.norm({kind:'metro'}),{kind:'metro',state:'',metro:'Los Angeles-Long Beach-Anaheim, CA'});
 assert.deepEqual(S.norm({kind:'us',state:'TX',metro:'x'}),{kind:'us',state:'',metro:''},'parts of another kind never ride along');
});

test('query sends only the params the routes read (state, county, metro), never a scope key',()=>{
 const S=load();
 assert.equal(S.query({kind:'mine'}),'state=CA&county=Orange%2CLos%20Angeles%2CSan%20Diego');
 assert.equal(S.query({kind:'state',state:'tx'}),'state=TX');
 assert.equal(S.query({kind:'metro',metro:'Dallas-Fort Worth-Arlington, TX'}),'metro=Dallas-Fort%20Worth-Arlington%2C%20TX');
 assert.equal(S.query({kind:'us'}),'');
 for(const k of ['mine','state','metro','us'])assert.doesNotMatch(S.query({kind:k}),/scope=/);
});

test('labels: full words, short forms for a phone ("US", the metro\'s first city and state)',()=>{
 const S=load();
 assert.equal(S.label({kind:'us'}),'United States');
 assert.equal(S.label({kind:'us'},{short:true}),'US');
 assert.equal(S.label({kind:'state',state:'CA'}),'California');
 assert.equal(S.label({kind:'state',state:'CA'},{short:true}),'CA');
 assert.equal(S.label({kind:'metro',metro:'Los Angeles-Long Beach-Anaheim, CA'},{short:true}),'Los Angeles, CA');
 assert.equal(S.label({kind:'metro',metro:'New York-Newark-Jersey City, NY-NJ'},{short:true}),'New York, NY');
 assert.equal(S.label({kind:'mine'}),'Your markets');
});

test('search: five digits open a ZIP, a word lists a city\'s ZIPs, anything else is not a search yet',()=>{
 const S=load();
 assert.deepEqual(S.parseSearch('92629'),{zip:'92629'});
 assert.deepEqual(S.parseSearch(' 92629 '),{zip:'92629'});
 assert.deepEqual(S.parseSearch('  Dana   Point '),{city:'Dana Point'});
 assert.equal(S.parseSearch('9262'),null);
 assert.equal(S.parseSearch('926290'),null);
 assert.equal(S.parseSearch(''),null);
 assert.equal(S.parseSearch(null),null);
 assert.equal(S.parseSearch('x'),null,'one letter is not a city');
});

test('set stores one value for both subs and tells listeners once per real change; off() stops them',()=>{
 const ls=store(),S=load(ls),seen=[];
 assert.deepEqual(S.get(),{kind:'mine',state:'',metro:''});
 const off=S.onChange((sc,prev)=>seen.push([prev.kind,sc.kind,sc.state]));
 S.set({kind:'state',state:'TX'});
 assert.deepEqual(JSON.parse(ls.getItem('re:scope')),{kind:'state',state:'TX',metro:''});
 S.set({kind:'state',state:'TX'});
 assert.equal(seen.length,1,'the same scope again fires nothing');
 S.set({kind:'metro'});
 assert.deepEqual(S.get(),{kind:'metro',state:'',metro:'Los Angeles-Long Beach-Anaheim, CA'},'a new kind takes its own default place');
 off();S.set({kind:'us'});
 assert.deepEqual(seen,[['mine','state','TX'],['state','metro','']]);
 assert.deepEqual(load(ls).get(),{kind:'us',state:'',metro:''},'a reload reads the stored scope');
});

test('the old Housing page scope carries over once; a bad stored value reads as Your markets',()=>{
 assert.deepEqual(load(store({'hstate:housing':JSON.stringify({scope:'state',state:'az'})})).get(),{kind:'state',state:'AZ',metro:''});
 assert.deepEqual(load(store({'hstate:housing':JSON.stringify({scope:'markets'})})).get(),{kind:'mine',state:'',metro:''});
 assert.deepEqual(load(store({'re:scope':'{not json'})).get(),{kind:'mine',state:'',metro:''});
 assert.deepEqual(load(store({'re:scope':JSON.stringify({kind:'us'}),'hstate:housing':JSON.stringify({scope:'state',state:'TX'})})).get().kind,'us','the new value wins');
});

test('markup: four scope choices with the chosen one pressed, the search says ZIP or city, nothing removable',()=>{
 const S=load();S.set({kind:'state',state:'TX'});
 const f=S.field();
 assert.equal((f.match(/data-scope-k="/g)||[]).length,4);
 assert.match(f,/data-scope-k="state" class="on" aria-pressed="true"[^>]*>Texas</);
 assert.match(f,/class="field field-group fb-only re-scope-field"/,'a sheet field, hidden inline on D');
 assert.doesNotMatch(f,/fchip|\bx\b"|data-clear/,'the scope is never a removable chip (critique 16)');
 const s=S.searchBox();
 assert.match(s,/placeholder="ZIP or city"/);
 assert.match(s,/class="search re-search"/);
 assert.doesNotMatch(f+s,/style="(?!--)/,'no inline style');
});
