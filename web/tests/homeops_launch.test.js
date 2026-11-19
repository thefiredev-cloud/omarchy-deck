// node --test tests/homeops_launch.test.js  (Home > Launch: groups of five with Show more, search, filters, favorites, second tap; no DOM, no network)
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const DeckUI = new Function(cut(read('static/deck.js'), '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const src = read('static/agents.js');
const { L, A } = new Function('DeckUI', cut(src, '// ==== AGENTS UI HELPERS BEGIN', '// ==== AGENTS UI HELPERS END ====') + '\nreturn {L: LaunchUI, A: AppsUI};')(DeckUI);

const NOW = Date.UTC(2026, 10, 14, 20, 0, 0);
const item = (i, o) => Object.assign({ id: 'skill:s' + i, kind: 'skill', name: 'slug-' + i, label: 'Helper ' + String(i).padStart(2, '0'), does: 'Does thing ' + i, area: 'Revenue', ao: 0, tier: 'useful', score: 60, targets: ['hermes'], where: ['pc-desktop', 'dell'] }, o);
const FEED = (items, o) => Object.assign({ t: NOW / 1000 - 600, items }, o);
const ITEMS = DeckUI.launchItems(FEED([
  ...Array.from({ length: 12 }, (_, i) => item(i)),
  ...Array.from({ length: 3 }, (_, i) => item(20 + i, { area: 'Home', ao: 2 })),
  item(30, { area: 'Money', ao: 1, tier: 'core', earns: true, label: 'Stripe payments', does: 'Connects Stripe' }),
  item(31, { area: '', ao: null, label: 'Loose one', targets: [] }),
]));
const sections = (h) => [...h.matchAll(/<section class="sect lgrp" data-g="([^"]+)"><h2 class="secttl"><span>([^<]*)</g)].map((m) => [m[1], m[2]]);
const rowsIn = (h, key) => { const s = h.split('<section ').find((x) => x.includes('data-g="' + key + '"')) || ''; return (s.match(/class="frow lnrow"/g) || []).length; };

test('browsing: one group per area in the feed order, five rows each, Show more with the next count', () => {
  const h = L.list(ITEMS, {}, '', {});
  assert.deepEqual(sections(h), [['a:Revenue', 'Revenue'], ['a:Money', 'Money'], ['a:Home', 'Home'], ['a:Other', 'Other']]);
  assert.equal(rowsIn(h, 'a:Revenue'), 5);
  assert.match(h, /data-lmore="a:Revenue">Show 7 more</);
  assert.equal(rowsIn(h, 'a:Home'), 3);
  assert.doesNotMatch(h, /data-lmore="a:Home"/);
  // Show more adds up to 20; the whole group then has no button
  const open = L.list(ITEMS, {}, '', { 'a:Revenue': 25 });
  assert.equal(rowsIn(open, 'a:Revenue'), 12);
  assert.doesNotMatch(open, /data-lmore="a:Revenue">Show \d+ more/);
  // titles carry no counts or ages
  for (const [, t] of sections(h)) assert.doesNotMatch(t, /\d/);
});

test('one area chosen: groups by tier; search: one Results group, best match first, 20 then Show more', () => {
  const tier = L.list(ITEMS, { area: 'Money' }, '', {});
  assert.deepEqual(sections(tier).map((s) => s[1]), ['Core']);
  const many = DeckUI.launchItems(FEED(Array.from({ length: 30 }, (_, i) => item(i, { label: 'Email helper ' + i }))));
  const q = L.list(many, { q: 'email' }, '', {});
  assert.deepEqual(sections(q), [['q', 'Results']]);
  assert.equal(rowsIn(q, 'q'), 20);
  assert.match(q, /data-lmore="q">Show 10 more</);
  assert.match(L.list(ITEMS, { q: 'zzzz' }, '', {}), /class="es es-idle"[^]*No match/);
});

test('a row: the label alone is one tap target (what it does is in the sheet), the Hermes button with its second-tap state, view only, earns', () => {
  const x = ITEMS.find((i) => i.id === 'skill:s30');
  const r = L.row(x, '');
  assert.match(r, /^<div class="frow lnrow" data-key="skill:s30"><button type="button" class="fl lninfo" data-lninfo="skill:s30"><b>Stripe payments<\/b><\/button>/);
  assert.doesNotMatch(r, /<small>|Connects Stripe/, 'no grey second line on the row');
  assert.match(r, /<span class="pill">Earns money<\/span><button type="button" class="btn btn-sm lnb" data-id="skill:s30" data-target="hermes" aria-label="Run in Hermes: Stripe payments">Hermes<\/button>/);
  assert.match(L.row(x, 'skill:s30|hermes'), /class="btn btn-sm lnb armed"[^>]*aria-label="Tap again to run in Hermes: Stripe payments">Tap again</);
  assert.match(L.row(ITEMS.find((i) => i.id === 'skill:s31'), ''), /<span class="pill">View only<\/span>/);
  // the tier, score, raw name and host list left the row for the detail sheet
  assert.doesNotMatch(r, /Core|slug-30|pc-desktop|Dell|tier/);
});

test('detail sheet: tier, score, area, hosts and the raw id; plain words', () => {
  const s = L.info(ITEMS.find((i) => i.id === 'skill:s30'));
  assert.equal(s.title, 'Stripe payments');
  assert.equal(s.sub, 'Skill');
  const t = s.lines.join('\n');
  assert.match(t, /^Tier: Core \u00B7 score 60$/m);
  assert.match(t, /^Works on: pc-desktop, Dell$/m);
  assert.match(t, /^Earns money$/m);
  assert.match(t, /^Runs in Hermes: tap Hermes, then tap again within 3 s$/m);
  assert.deepEqual(s.log.slice(0, 2), ['ID skill:s30', 'Name slug-30']);
  assert.equal(L.info(undefined), null);
});

test('favorites: a chip row of the same second-tap launch buttons, none when the feed has none', () => {
  const favs = DeckUI.launchFavorites({ favorites: [{ id: 'skill:s30', label: 'Stripe' }, { id: 'skill:s31', label: 'Loose' }] }, ITEMS);
  const h = L.favs(favs, 'skill:s30|hermes');
  assert.match(h, /^<section class="sect" id="lnfav"><h2 class="secttl"><span>Favorites<\/span><\/h2>/);
  assert.match(h, /class="lnb armed" data-id="skill:s30" data-target="hermes"[^>]*>Tap again</);
  assert.doesNotMatch(h, /skill:s31/); // view-only items are not favorites
  assert.equal(L.favs([], ''), '');
});

test('filters: area, kind, tier and works-on chips with counts, the chosen ones pressed; the active count for the Filters button', () => {
  const h = L.filters(ITEMS, { area: 'Home', tier: 'all' });
  assert.match(h, /<h3 class="sub-h">Area<\/h3>/);
  assert.match(h, /class="lna on" data-area="Home" aria-pressed="true">Home <small>3<\/small>/);
  assert.match(h, /class="lna" data-area="all" aria-pressed="false">All areas <small>17<\/small>/);
  assert.match(h, /class="lnk on" data-kind="all" aria-pressed="true">All <small>17<\/small>/);
  assert.match(h, /class="lnt" data-tier="core" aria-pressed="false">Core <small>1<\/small>/);
  assert.match(h, /class="lnw" data-where="dell" aria-pressed="false">Dell <small>17<\/small>/);
  assert.doesNotMatch(h, /data-kind="mcp"/); // a kind with no items has no chip
  assert.equal(L.active({ area: 'Home', tier: 'all', kind: 'all', where: 'dell' }), 2);
  assert.equal(L.active({}), 0);
});

test('hostile feed text is escaped everywhere it is drawn', () => {
  const [x] = DeckUI.launchItems({ items: [{ id: 'skill:x', kind: 'skill', name: '<b>slug</b>', label: '<img src=x onerror=alert(1)>', does: '"><script>alert(1)</script>', area: '<i>Area</i>', ao: 0, targets: ['hermes'] }] });
  const h = L.list([x], {}, '', {}) + L.filters([x], {});
  assert.doesNotMatch(h, /<img|<script|<i>Area|<b>slug/);
  assert.match(h, /&lt;img src=x/);
});

test('OMP is never a button, a tag or a filter: an OMP-only item is view only', () => {
  const items = DeckUI.launchItems({ items: [{ id: 'skill:a', kind: 'skill', name: 'A', targets: ['omp', 'hermes'], where: ['omp', 'dell'], arg: 'a' }, { id: 'skill:b', kind: 'skill', name: 'B', targets: ['omp'], arg: 'b' }] });
  const h = L.list(items, {}, '', {}) + L.filters(items, {});
  assert.doesNotMatch(h, /data-target="omp"|>OMP<|data-where="omp"/);
  assert.match(h, /View only/);
  assert.match(h, /data-target="hermes"/);
});

test('Data sheet: the launch list as a source with its size and age, the side-column help as Method; a missing feed says so', () => {
  const d = L.data(FEED([]), ITEMS, NOW);
  assert.deepEqual(d.sources[0], { name: 'Launch list', gives: '17 items', asOf: '10 min ago', state: 'ok' });
  assert.match(Object.fromEntries(d.method).Run, /tap again within 3 s/);
  for (const [label] of d.method) assert.ok(label.length <= 8, 'short Method labels do not collide with their text: ' + label);
  assert.match(Object.fromEntries(d.method).Missions, /Nothing starts until you tap Send/);
  assert.equal(L.data(null, [], NOW).sources[0].state, 'never');
});

test('the item sheet ends in Data', () => {
  assert.deepEqual(L.info(ITEMS[0]).actions, [{ id: 'data', label: 'Data' }]);
});

test('phone landscape: the filters sit behind the Filters button and the list takes both columns; the side column is a desk layout', () => {
  const css = read('static/css/homeops.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const side = /@media ([^{]*)\{\s*\.lgrid\{grid-template-columns:minmax\(0,1fr\) minmax\(15rem,21rem\)/.exec(css);
  assert.ok(side, 'the side column rule exists');
  assert.equal(side[1], '(min-width:1100px) and (min-height:500px)', 'L has no side column beside an empty half');
  assert.match(css, /@media \(min-width:600px\) and \(max-height:499px\)\{#lnmain\{columns:2;/);
  assert.doesNotMatch(css, /break-inside:auto/, 'a group never continues in another column (layout second pass, 2026-11-15)');
  assert.match(src, /<div class="lmain" id="lnmain" data-balance>/, 'its whole blocks balance through the shared helper');
});

test('a read that never settles ends in "Launch list is not reporting", never a blank list; the cached list skips its read', async () => {
  const never = () => new Promise(() => {});
  const r = await L.load(never, true, 20);
  assert.deepEqual([r.f, r.sf, r.df], [{ error: 'timed out' }, { error: 'timed out' }, { error: 'timed out' }]);
  const asked = [];
  const c = await L.load((p) => { asked.push(p); return Promise.resolve({ t: 1 }); }, false, 20);
  assert.deepEqual(asked, ['schedules', 'dev']);
  assert.equal(c.f, null);
  assert.equal(L.TIMEOUT_MS, 60000);
  assert.match(src, /LN\.err=f\|\|\{error:'no answer'\}/);
  assert.match(src, /title:LN\.err\?'Launch list is not reporting'/);
});

test('the old Agents link lands on Missions: #missions exists from the first show so the shell scroll for home/launch#missions finds it', () => {
  assert.match(src, /<div class="lmain" id="lnmain" data-balance><div class="lmis board" id="missions"><\/div><\/div>/);
  assert.match(src, /show\(ctx\)\{LN\.ctx=ctx;if\(LN\.f\)paint\(\);else frame\(\);load\(false\)\}/);
  assert.equal((src.match(/id="missions"/g) || []).length, 1, 'one #missions on the page');
  // the results column survives repaints; the run window writes into it
  assert.match(src, /<div id="lnmsg" role="status" aria-live="polite"><\/div><button type="button" class="btn" id="lnlast" disabled>No run yet<\/button>/);
});

test('W11: the filters fold behind the one Filters button at every size; the desk side column holds favorites and the launch results, still sticky', () => {
  const css = read('static/css/homeops.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // no filter panel in the side column and nothing hides the Filters button on a desk
  assert.doesNotMatch(src, /id="lnflt"|id="lnfb"/);
  assert.doesNotMatch(css, /#lnflt|#lnfo\{display:none\}/);
  assert.match(src, /<aside class="lside"><div id="lnfavd"><\/div>'\+\s*'<section class="sect" id="lnrun">/);
  // the third layout pass's side column stays: under the header, never taller than the screen, scrolling inside itself
  assert.match(css, /@media \(min-width:1100px\) and \(min-height:500px\)\{html:not\(\.tv\) \.lside\{top:calc\(var\(--sticky-top\) \+ var\(--s-3\)\);max-height:calc\(100vh - var\(--sticky-top\) - var\(--s-3\) - var\(--s-8\)\);[^}]*overflow-y:auto/);
  // the chips open in the Filters sheet, where the page's handler still finds them
  assert.match(src, /body:'<div class="lnflt">'\+LaunchUI\.filters\(LN\.items,opts\(\)\)\+'<\/div>'/);
});

test('favorites on a desk: rows in the side column above Launches (the item row, the favorite label, the same second tap); chips elsewhere', () => {
  const favs = DeckUI.launchFavorites({ favorites: [{ id: 'skill:s30', label: 'Stripe' }, { id: 'skill:s31', label: 'Loose' }, { id: 'skill:none', label: 'Gone' }] }, ITEMS);
  const h = L.favRows(favs, ITEMS, '');
  assert.match(h, /^<section class="sect" id="lnfavside"><h2 class="secttl"><span>Favorites<\/span><\/h2><div class="flist"><div class="frow lnrow" data-key="skill:s30"><button type="button" class="fl lninfo" data-lninfo="skill:s30"><b>Stripe<\/b><\/button>/);
  assert.equal((h.match(/class="frow lnrow"/g) || []).length, 1, 'view-only and unknown items are not favorites');
  assert.match(L.favRows(favs, ITEMS, 'skill:s30|hermes'), /class="btn btn-sm lnb armed" data-id="skill:s30" data-target="hermes"[^>]*>Tap again</);
  assert.equal(L.favRows([], ITEMS, ''), '');
  assert.match(src, /e\.querySelector\('#lnfavd'\)\.innerHTML=LN\.f&&!LN\.q\?LaunchUI\.favRows\(LN\.favs,LN\.items,LN\.armed\):''/);
  const css = read('static/css/homeops.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /#lnfavd\{display:none\}/);
  assert.match(css, /@media \(min-width:1100px\) and \(min-height:500px\)\{html:not\(\.tv\) #lnfavd\{display:block\}html:not\(\.tv\) #lnfav\{display:none\}\}/);
});

test('W4-5: on a desk the target chips wrap as whole words instead of a sideways row cut at the column edge; phones keep the swipe row', () => {
  const css = read('static/css/homeops.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /@media \(min-width:1100px\) and \(min-height:500px\)\{html:not\(\.tv\) \.agtgt\{flex-wrap:wrap;overflow:visible\}\}/);
  assert.match(read('static/agents.js'), /<div class="chips scroll agtgt"/);
});

// GET /api/apps (rust/src/apps.rs, #349): {t, items:[{id,name,host,area,does,status,why,frame,url,wake}]}; no Dell rows
const APP = (id, status, o) => Object.assign({ id, name: 'App ' + id, host: 'PC', area: 'Tools', does: 'Does ' + id, status, why: '', frame: false, url: 'https://pc-desktop.example.ts.net:10' + id.length + '01/', wake: false }, o);
const APPS = (items, o) => Object.assign({ t: NOW / 1000 - 300, items }, o);
const tiles = (h) => [...h.matchAll(/<div class="appt" role="listitem" data-key="app:([^"]+)">/g)].map((m) => m[1]);

test('Apps (L30): drawn only when the route answers with apps on this computer; no route, a refusal, not_reporting or Dell rows draw nothing', () => {
  const nr = { status: 'not_reporting', reason: 'the probe client could not start', t: NOW / 1000 };
  for (const d of [undefined, null, { error: 'http 404' }, { error: 'timed out' }, nr, APPS([]), APPS([APP('d1', 'up', { host: 'Dell', url: null })]), 'x', []]) assert.equal(A.section(d, {}), '');
  const h = A.section(APPS([APP('a', 'up'), APP('d', 'up', { host: 'Dell', url: null })]), {});
  assert.match(h, /^<section class="sect" id="lnapps"><h2 class="secttl"><span>Apps<\/span><span>1 up<\/span><\/h2>/);
  assert.deepEqual(tiles(h), ['a'], 'Dell apps wait for the owner: no Dell tile');
  assert.doesNotMatch(h, /Dell/);
  // if the server ever says the Dell needs routes: one quiet line, no tiles
  assert.match(A.section(APPS([APP('a', 'up')], { dell: { ok: true, needs_setup: true } }), {}), /<small class="apdell">Dell apps need a route on the tailnet<\/small><\/section>$/);
});

test('Apps: Up opens in a new tab, Asleep has Wake (a second tap), Down and unknown say so, Not started is calm', () => {
  const d = APPS([APP('off', 'off', { url: null, why: 'not running' }), APP('zz', 'unknown', { why: 'no answer' }), APP('sl', 'asleep', { why: 'wakes on request', wake: true }),
    APP('dn', 'down', { why: 'error page' }), APP('si', 'sign-in'), APP('up', 'up'), APP('lo', 'up', { url: null })]);
  const h = A.section(d, {});
  // what can be opened now first, then down, asleep, not reported, not started
  assert.deepEqual(tiles(h), ['up', 'lo', 'si', 'dn', 'sl', 'zz', 'off']);
  assert.match(h, /<span>3 up \u00B7 1 down \u00B7 1 asleep<\/span>/);
  const t = Object.fromEntries(A.items(d).map((x) => [x.id, A.tile(x, '')]));
  assert.match(t.up, /<span class="aps"><span class="sd ok"><\/span>Up<\/span>[^]*<a class="btn btn-sm apopen" href="https:\/\/pc-desktop\.example\.ts\.net:10201\/" target="_blank" rel="noopener noreferrer" aria-label="Open App up">Open/);
  assert.match(t.si, /<span class="sd ok"><\/span>Sign-in<\/span>[^]*apopen/);
  assert.match(t.lo, /Up<\/span>[^]*<small class="apnote">Opens on this computer only<\/small>/);
  assert.doesNotMatch(t.lo, /<a /);
  // an asleep app's link is an error page (its route skips the gateway): Wake is a button, never a link
  assert.match(t.sl, /<span class="sd off"><\/span>Asleep<\/span>[^]*<button type="button" class="btn btn-sm apwake" data-app="sl" aria-label="Wake App sl">Wake<\/button><\/div>$/);
  assert.doesNotMatch(t.sl, /<a /);
  const sl = A.items(d).find((x) => x.id === 'sl');
  assert.match(A.tile(sl, 'app:sl'), /class="btn btn-sm apwake armed" data-app="sl" aria-label="Tap again to wake App sl">Tap again</);
  assert.match(A.tile(sl, '', { id: 'sl', k: 'busy' }), /class="btn btn-sm apwake" data-app="sl" disabled aria-label="Waking App sl">Waking\u2026</);
  assert.match(A.tile(sl, '', { id: 'sl', k: 'starting', text: 'starting; Open shows when it is up' }), /<span class="sd nv"><\/span>Starting<\/span>[^]*<small class="apnote">Starting; Open shows when it is up<\/small>/);
  assert.match(A.tile(sl, '', { id: 'other', k: 'bad', text: 'x' }), /aria-label="Wake App sl">Wake</, 'a wake of another app leaves this tile alone');
  // an asleep app the deck cannot wake (no gateway door) says the reason, no button
  assert.doesNotMatch(A.tile(A.items(APPS([APP('s2', 'asleep', { why: 'wakes on request' })]))[0], ''), /apwake/);
  assert.match(t.dn, /<span class="sd bad"><\/span>Down<\/span>[^]*<small class="apnote">Error page<\/small>/);
  assert.doesNotMatch(t.dn, /<a /);
  // unknown is "Not reported", never Down
  assert.match(t.zz, /<span class="sd nv"><\/span>Not reported<\/span>[^]*No answer/);
  assert.match(t.off, /<span class="sd off"><\/span>Not started<\/span>[^]*<small class="apnote">Not running<\/small>/);
  for (const k of ['off', 'zz', 'sl', 'lo']) assert.doesNotMatch(t[k], /sd bad/, k + ' is never red');
});

test('Apps: the wake answer in words: awake, starting, rate limited with its wait, a refusal, no answer', () => {
  assert.deepEqual(A.wakeView({ ok: true, state: 'up', id: 'almanac' }, 200), { k: 'up', text: 'awake' });
  assert.deepEqual(A.wakeView({ ok: true, state: 'starting' }, 202), { k: 'starting', text: 'starting; Open shows when it is up' });
  assert.deepEqual(A.wakeView({ ok: false, error: 'rate limited', retry_s: 3 }, 429), { k: 'bad', text: 'one wake at a time: try again in 3 s' });
  assert.deepEqual(A.wakeView({ ok: false, error: 'the app gateway is not running' }, 502), { k: 'bad', text: 'did not wake: the app gateway is not running' });
  assert.deepEqual(A.wakeView(null, 403), { k: 'bad', text: 'did not wake (error 403)' });
  assert.deepEqual(A.wakeView(null, 0), { k: 'bad', text: 'no answer from the deck; try again' });
});

test('Apps: eight tiles, then Show more with the rest; opened, all of them, Show fewer and the closed-height mark', () => {
  const d = APPS(Array.from({ length: 30 }, (_, i) => APP('a' + i, 'asleep')));
  const h = A.section(d, {});
  assert.equal(tiles(h).length, 8);
  assert.match(h, /<div class="more-row"><button type="button" class="btn" data-lmore="apps">Show 22 more<\/button><\/div><\/section>$/);
  const o = A.section(d, { open: true });
  assert.equal(tiles(o).length, 30);
  assert.match(o, /^<section class="sect" id="lnapps" data-bal-open>/);
  assert.match(o, /<button type="button" class="btn btn-quiet" data-less="1" data-lmore="apps">Show fewer<\/button>/);
  assert.doesNotMatch(A.section(APPS([APP('a', 'up')]), { open: true }), /more-row|data-bal-open/, 'eight or fewer: no paging');
  // after a failed read the tiles stay under the one stale line, with when the last good read was
  assert.match(A.section(APPS([APP('a', 'up')]), { stale: NOW - 29 * 60000, now: NOW }), /<span>Out of date \u00B7 last read 29 min<\/span>/);
  assert.equal(A.lastRead(NOW - 10e3, NOW), 'Out of date \u00B7 last read 1 min');
  assert.equal(A.lastRead(NOW - 3 * 3600e3, NOW), 'Out of date \u00B7 last read 3 h');
  assert.match(A.section(APPS([APP('a', 'up')]), { stale: null }), /<span>1 up<\/span>/);
});

test('Apps: hostile names, words and addresses are escaped or dropped; a tile never opens a tap-to-open sheet', () => {
  const h = A.section(APPS([APP('x', 'up', { name: '<img src=x onerror=alert(1)>', does: '"><script>', url: 'javascript:alert(1)' }),
    APP('y', 'up', { url: '"><img src=x>' }), APP('z', '<b>', { why: '<i>' })]), {});
  assert.doesNotMatch(h, /<img|<script|javascript:|<i>|<b>/);
  assert.match(h, /&lt;img src=x/);
  assert.match(h, /data-key="app:z"><b class="apn">App z<\/b><span class="aps"><span class="sd nv"><\/span>Not reported/);
  // the shell's card tap walks up from the tap: nothing in a tile is a card class, so no sheet opens on Home
  const chain = [{ tag: 'SMALL', cls: 'apd' }, { tag: 'DIV', cls: 'appt' }, { tag: 'DIV', cls: 'appgr' }, { tag: 'SECTION', cls: 'sect' }, { tag: 'DIV', cls: 'bal-col' }, { tag: 'DIV', cls: 'lmain' }];
  assert.equal(DeckUI.sheetPick('home', chain), -1);
});

test('Apps glue: Wake arms on the first tap and posts through deck.js on the second; Show more opens every tile', () => {
  assert.match(src, /const wk=t\.closest\('button\.apwake'\);if\(wk\)return wake\(wk\);/);
  assert.match(src, /if\(LN\.armed!==key\)\{LN\.armed=key;clearTimeout\(LN\.armT\);LN\.armT=setTimeout\(\(\)=>\{LN\.armed='';paint\(\)\},3000\);buzz\('light'\);paint\(\);return\}/);
  assert.match(src, /const \{json:j,status\}=await postAppWake\(id\);v=AppsUI\.wakeView\(j,status\)/);
  assert.match(read('static/deck.js'), /async function postAppWake\(id\)\{const res=await bfetch\('\/api\/apps\/wake\?id='\+encodeURIComponent\(id\),\{method:'POST'\}\);/);
  assert.match(src, /if\(k==='apps'\)\{LN\.open\.apps=true;return paint\(\)\}/);
  assert.match(src, /blocks\(e,apps\+body\)/, 'Apps come right after Missions');
  assert.match(src, /if\(AppsUI\.items\(a\)\.length\)\{LN\.apps=a;LN\.appsT=Date\.now\(\);LN\.appsStale=false\}else if\(a&&\(a\.status===401\|\|a\.status===403\)\)\{LN\.apps=null;LN\.appsStale=false\}else if\(LN\.apps\)LN\.appsStale=true/,
    'a failed read keeps the tiles as out of date; a 401 or 403 (a role change) drops them');
  assert.match(src, /r\.ok\?r\.data:\{error:r\.error\|\|'no answer',status:r\.status\}/);
  // the apps paint when they answer; a wake reads only them again
  assert.match(src, /if\(LN\.ctx\)paint\(\)\}\)\.finally\(\(\)=>\{appsBusy=false\}\)/);
  assert.match(src, /if\(v\.k!=='bad'\)setTimeout\(appsLoad,v\.k==='starting'\?5000:0\)/);
  const s = A.source(APPS([APP('a', 'up'), APP('b', 'asleep')]), NOW);
  assert.deepEqual(s, { name: 'Apps on this computer', gives: '2 apps, each checked by the deck server', asOf: '5 min ago', state: 'ok' });
  assert.equal(A.source(null, NOW), null);
});

test('Open here: only an app the server marks frame-safe, up or sign-in, gets a panel inside the deck; every other app opens a new tab', () => {
  const d = APPS([APP('fr', 'up', { frame: true }), APP('nf', 'up'), APP('sl', 'asleep', { frame: true, wake: true }), APP('nu', 'up', { frame: true, url: null })]);
  const t = Object.fromEntries(A.items(d).map((x) => [x.id, A.tile(x, '')]));
  assert.match(t.fr, /<button type="button" class="btn btn-sm apframe" data-app="fr" aria-label="Open App fr here">Open here<\/button>/);
  assert.doesNotMatch(t.fr, /<a /);
  assert.match(t.nf, /class="btn btn-sm apopen"/);
  assert.doesNotMatch(t.nf + t.sl + t.nu, /apframe/);
  const s = A.frameSheet(A.items(d).find((x) => x.id === 'fr'));
  assert.deepEqual(Object.keys(s), ['id', 'wide', 'title', 'sub', 'body', 'actions']);
  assert.equal(s.wide, true);
  assert.equal(s.title, 'App fr');
  assert.equal(s.body, '<iframe class="appfrm" title="App fr" src="https://pc-desktop.example.ts.net:10201/" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" referrerpolicy="same-origin"></iframe>');
  // the frame may never steer the deck's own window (review of #388)
  assert.doesNotMatch(s.body, /allow-top-navigation/);
  assert.doesNotMatch(src, /allow-top-navigation/);
  assert.equal(A.FRAME_SANDBOX, 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
  assert.match(s.actions, /^<a class="btn" href="https:\/\/pc-desktop\.example\.ts\.net:10201\/" target="_blank" rel="noopener noreferrer">Open in a new tab/);
  for (const id of ['nf', 'sl', 'nu']) assert.equal(A.frameSheet(A.items(d).find((x) => x.id === id)), null, id);
  assert.equal(A.frameSheet(undefined), null);
  // a hostile name stays text: escaped in the body and footer markup; the title is plain text the sheet host sets as textContent
  const hs = A.frameSheet(A.items(APPS([APP('h', 'up', { frame: true, name: '"><img src=x>' })]))[0]);
  assert.doesNotMatch(hs.body + hs.actions, /<img/);
  assert.match(read('static/app.js'), /t\.textContent=txt\(o\.title\)/);
  // glue: the sheet opens from the tile, with the tile as the place focus returns to
  assert.match(src, /const fr=t\.closest\('button\.apframe'\);if\(fr\)\{const s=AppsUI\.frameSheet\(AppsUI\.items\(LN\.apps\)\.find\(i=>i\.id===fr\.dataset\.app\)\);if\(s&&typeof DeckShell!=='undefined'\)\{buzz\('light'\);DeckShell\.sheet\.open\(Object\.assign\(\{opener:fr\},s\)\)\}return\}/);
  assert.match(read('static/css/homeops.css'), /dialog\.sheet \.appfrm\{display:block;width:100%;/);
});
