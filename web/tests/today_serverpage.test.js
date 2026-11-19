'use strict';
require('./setup-core.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync(require('node:path').join(__dirname, '../static/deck.js'), 'utf8');
const cut = (a,b) => src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
const D = new Function(cut('// ==== DECK V6 UI HELPERS BEGIN','// ==== DECK V6 UI HELPERS END ====')+';return DeckUI;')();
const NOW = 1800000000000;
const feed = () => ({t:NOW/1000,refresh:120,errors:[],gateway:{ok:true,state:'running',platforms_up:3,platforms_on:3,reply_ms:18,restarts:0,up:['telegram'],off:[],down:[],checks_failed:[]},mail:{next:{name:'Reply drafts',at:NOW/1000+600,kind:'drafts'},items:[{name:'Reply drafts',at:NOW/1000+600,kind:'drafts'}],paused_mail_crons:0}});
const text = h => h.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
test('B4: Today restores a compact server card and full detail without Gmail counts',()=>{
 const f=feed(),h=D.tdServerPage(f,NOW).html,s=D.tdServerSheet(f,NOW);
 assert.match(text(h),/Server page.*Hermes gateway/);
 assert.match(h,/data-open="today-server"/);
 assert.doesNotMatch(text(s),/platforms connected/,'detailed health waits for owner approval');
 assert.match(text(s),/18 ms/);assert.match(text(s),/0 restarts/);
 assert.match(text(s),/Reply drafts.*Leaves drafts only/);
 f.mail.gmail={count:42};assert.doesNotMatch(D.tdServerSheet(f,NOW),/Gmail|42|scheduled sends/);
 assert.deepEqual(D.TD_SECTIONS,['needs','dead','alerts','cal','home','clu','glance','mkt']);
});
test('B4: missing gateway and mail never become healthy or an empty queue',()=>{
 const f={...feed(),gateway:{ok:null,state:'unknown',reason:'health not read'},mail:{next:null,items:[],reason:'timers unavailable',paused_mail_crons:null}};
 const s=text(D.tdServerSheet(f,NOW));assert.match(s,/Not reported/);assert.match(s,/timers unavailable/);
 assert.doesNotMatch(s,/Healthy|No mail timer|0 restarts/);
 assert.match(text(D.tdServerPage({error:'missing'},NOW).html),/Not reporting/);
});
test('B4: hostile platform, readiness and scheduled-job strings are escaped',()=>{
 const f=feed(),x='\"><img src=x onerror=__X>';
 f.gateway.down=[{name:x,why:x}];f.gateway.off=[{name:x,since:x}];f.gateway.checks_failed=[x];f.mail.next.name=x;f.mail.items[0].name=x;
 for(const h of [D.tdServerPage(f,NOW).html,D.tdServerSheet(f,NOW)]){assert.doesNotMatch(h,/<img|onerror=__X>/);assert.match(h,/&lt;img/)}
});
test('B4: malformed successful refresh keeps the last card marked out of date; refusal clears it',async()=>{
 let body=feed(),status=200;
 const P=new Function('fetch','AbortController','setTimeout','clearTimeout','DeckUI',cut('// ==== DECK PAGES REGISTRY BEGIN','// ==== DECK PAGES REGISTRY END ====')+';return DeckPages;')(
 async()=>({ok:status===200,status,json:async()=>body,headers:{get:()=>null}}),AbortController,setTimeout,clearTimeout,D);
 const get=()=>P.get('serverpage',{shape:d=>D.tdShape('serverpage',d)}).then(D.keptFeed);
 const good=await get();assert.match(D.tdServerSheet(good,NOW),/Reply drafts/);
 for(const bad of [{gateway:[],mail:{}},{...feed(),mail:{items:'broken'}},{...feed(),gateway:{...feed().gateway,down:'broken'}}]){
 body=bad;const kept=await get();assert.match(D.tdServerPage(kept,NOW).html,/Out of date/);assert.match(D.tdServerSheet(kept,NOW),/Reply drafts/)}
 status=403;assert.ok((await get()).error);
});
test('B4: a collector-kept component is visibly old even without a legacy read time',()=>{
 const f=feed();f.mail.stale=true;f.mail.reason='A local timer could not be read';
 assert.match(text(D.tdServerPage(f,NOW).html),/Out of date/);
 assert.match(text(D.tdServerSheet(f,NOW)),/Out of date.*A local timer could not be read/);
 f.mail.read_at=NOW/1000-600;
 assert.match(text(D.tdServerSheet(f,NOW)),/Out of date · last read 10 min/);
});
test('review: detailed health and paused-job counts are not presented from legacy snapshots',()=>{
 const f=feed();f.gateway.down=[{name:'PRIVATE_HEALTH',why:'PRIVATE_HEALTH'}];f.gateway.checks_failed=['PRIVATE_HEALTH'];f.mail.paused_mail_crons=42;
 assert.doesNotMatch(D.tdServerSheet(f,NOW),/PRIVATE_HEALTH|Paused mail jobs|42/);
});
