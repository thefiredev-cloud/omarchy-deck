// Offline shell cache. Never touches /api/ or non-GET.
// Stale while revalidate: the cached shell answers at once (no blank or spinner first paint), the network copy
// refreshes the cache for the next open. First visits and the ?t= cookie bootstrap always use the network.
// Nobody edits V: the server stamps its name with a hash of this file and every SHELL file (rust/src/shell.rs),
// so any change to a cached byte installs a new worker. install precaches fresh files; activate deletes every other cache.
// A new worker takes over at once only when no earlier stamped shell is cached (a first visit, or the hop from a
// numbered cache such as pdeck-shell-v113, whose pages reload on their own). Otherwise it waits for 'skip', which app.js
// sends only when ShellCore.reloadOk says the reader is idle. One script URL, no query: a second URL would install twice.
const V='pdeck-shell-__SHELL_HASH__',SHELL=['/','/app.js','/cre.js','/deck.js','/schedules.js','/agents.js','/pad.js','/invest.js','/ops.js','/house.js','/manifest.webmanifest','/icon-192.png','/icon-512.png','/icon.svg','/apple-touch-icon.png',
 '/ui-core.js',
 '/guard.js',
 '/cre-boot.js',
 '/tokens.css',
 '/ui.css',
 '/app.css',
 '/tv.css',
 '/tv.js',
 '/css/today.css',
 '/css/home.css',
 '/css/homeops.css',
 '/css/realestate.css',
 '/css/commercial.css',
 '/css/markets.css',
 '/css/surf.css',
 '/css/shop.css',
 '/css/money.css',
 '/css/work.css',
 '/css/pad.css',
 '/css/world.css',
 '/pages/realestate.js',
 '/pages/commercial.js',
 '/pages/markets.js',
 '/pages/surf.js',
 '/pages/shop.js',
 '/pages/world.js',
 '/fonts/Geist-Variable.woff2',
 '/fonts/GeistMono-Variable.woff2'];
const STAMPED=/^pdeck-shell-[0-9a-f]{16}$/;
const waits=()=>caches.keys().then(ks=>ks.some(k=>k!==V&&STAMPED.test(k)));
// every SHELL file or none: one failed fetch rejects the install and drops its half-filled cache, so the old worker and cache stay
// and the browser tries again at the next check (never a worker that activates over holes)
const fill=c=>Promise.all(SHELL.map(u=>fetch(u,{credentials:'same-origin',cache:'reload'}).then(r=>{if(!r.ok)throw Error(u+' '+r.status);return c.put(u,r)})));
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(fill).catch(err=>caches.delete(V).then(()=>{throw err})).then(waits).then(w=>{if(!w)return self.skipWaiting()}))});
self.addEventListener('message',e=>{if(e.data==='skip')self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
 const r=e.request,u=new URL(r.url);
 // Finance (v9 Money tab): never cached, never answered by the worker. The generic /api/ rule below already covers it;
 // this one is explicit so a later edit of that rule cannot start caching amounts. Tested in tests/deck_v9_money.test.js.
 if(u.pathname==='/api/finance'||u.pathname==='/api/finance-values')return;
 // Invest tab amounts (v10): same rule, never answered or cached by the worker.
 if(u.pathname==='/api/portfolio-values')return;
 // Housing budget (2026-11-11): the household budget and its inputs, same rule.
 if(u.pathname==='/api/housing/profile')return;
 if(r.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
 if(!SHELL.includes(u.pathname)||u.searchParams.has('t'))return;
 e.respondWith(caches.open(V).then(async c=>{
  const hit=await c.match(u.pathname);
  const net=fetch(r).then(res=>{
   if(res.ok)c.put(u.pathname,res.clone());
   else if(res.status===401&&u.pathname==='/')c.delete('/');
   return res}).catch(()=>null);
  if(hit){e.waitUntil(net);return hit}
  return (await net)||new Response('offline',{status:503});
 }));
});
