// node --test tests/*.test.js  (video review A08, A27, A28, A39: empty House cards say why, the car says when it was last seen,
// decisions have an Open button, jobs show reading cues)
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(src.slice(src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), src.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const NOW = Date.UTC(2026, 9, 21, 20);
const T = (s) => NOW / 1000 - s;
const vis = (h) => h.replace(/<span class="diag">[^]*?<\/span>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------- A27: car (since 2026-11-15 one reading in House's strip, DeckUI.carReading; the details ride in its sheet) ----------------
const car = (o) => Object.assign({ t: T(60), stale: false, age: 60, battery: 35, charging: 'Disconnected', locked: true, range: 97.5, charge_limit: 80, age_s: 36882, seen: T(60 + 36882), fresh: false, awake: 'offline' }, o);
const sheet = (h) => [...h.matchAll(/<span class="diag">([^<]*)<\/span>/g)].map((m) => m[1]).join(' | ');

test('car: last seen comes from the car reading time when the values are cached, and "Updated 1 min ago" is gone', () => {
  const r = D.carReading(car(), NOW);
  assert.equal(vis(r.html), 'Car 35% 98 mi Last seen 10 h ago');
  assert.equal(r.k, 'stale');
  assert.match(sheet(r.html), /Cable not connected \| Charge limit 80% \| Lock: locked \| Last seen 10 h ago \| The car is offline\. These values are from the last time the car answered\./);
  assert.doesNotMatch(r.html, /Updated|1 min ago/);
});

test('car: a fresh reading shows only its figures; charging and an unlocked car say so; the stalled poller rides in the sheet', () => {
  const h = D.carReading(car({ fresh: true, awake: 'online', seen: T(120), age_s: 5, charging: 'Charging' }), NOW);
  assert.equal(vis(h.html), 'Car 35% 98 mi Charging');
  assert.match(sheet(h.html), /Last seen 2 min ago/);
  const open = D.carReading(car({ fresh: true, locked: false }), NOW);
  assert.equal(open.k, 'warn');
  assert.match(vis(open.html), /Unlocked$/);
  const stalled = D.carReading(car({ fresh: true, stale: true, t: T(3 * 3600) }), NOW);
  assert.match(vis(stalled.html), /Last seen/);
  assert.match(sheet(stalled.html), /The car check last ran 3 h ago\./);
});

test('car: no ageSeconds means the last-seen time is not reported, never the file time; a missing car reads No reading, never 0', () => {
  const old = D.carReading({ t: T(60), stale: false, battery: 59, charging: 'Charging', locked: true, range: 160, charge_limit: 50 }, NOW);
  assert.match(sheet(old.html), /Last seen time not reported/);
  assert.doesNotMatch(old.html, /Updated|Cached/);
  const e = D.carReading({ error: 'file missing', src: '~/.meshvault/status/tesla/car.json' }, NOW);
  assert.equal(vis(e.html), 'Car No reading Not reporting');
  assert.match(sheet(e.html), /file missing/);
  assert.equal(D.carReading(null, NOW).k, 'bad');
  // X4: a battery that is not a number from 0 to 100 never reaches the page as a figure
  assert.equal(vis(D.carReading(car({ battery: 'x' }), NOW).html).split(' ').slice(0, 3).join(' '), 'Car No reading');
  assert.match(vis(D.carReading(car({ battery: 140 }), NOW).html), /^Car No reading/);
});

// review #353 item 5: the strip tile lost the old card's bar and its charge-limit tick
test('car: the battery bar is drawn to the percentage with a tick at the charge limit; a bad value draws no bar and no tick, never a capped one', () => {
  const r = D.carReading(car(), NOW).html;
  assert.match(r, /<div class="bar" role="img" aria-label="Battery 35%, charge limit 80%"><i style="width:35%"><\/i><u style="left:80%"><\/u><\/div>/);
  assert.ok(r.indexOf('class="bar"') > r.indexOf('class="v"'), 'the bar sits under the figure, as on CPU, RAM and GPU');
  const noLim = D.carReading(car({ charge_limit: null }), NOW).html;
  assert.match(noLim, /<div class="bar" role="img" aria-label="Battery 35%"><i style="width:35%"><\/i><\/div>/, 'no limit in the feed: no tick');
  for (const battery of [140, -5, 'x', null]) {
    const h = D.carReading(car({ battery }), NOW).html;
    assert.doesNotMatch(h, /class="bar"|width:100%|width:0%/, 'battery ' + battery + ': no bar at all');
    assert.match(vis(h), /^Car No reading/);
  }
  const badLim = D.carReading(car({ charge_limit: 120 }), NOW).html;
  assert.doesNotMatch(badLim, /<u |left:100%|Charge limit 1\d\d%/, 'a limit outside 0 to 100 draws no tick and is not printed');
  assert.match(badLim, /<i style="width:35%"><\/i><\/div>/);
});

// ---------------- A08: ink (the watch fixture still feeds the Today home rows below) ----------------
const watch = (o) => Object.assign({ t: T(120), connected: false, near: true, rssi: -70, metrics_t: null, hr: null, hrv: null, sleep_h: null, battery: null }, o);
test('ink: a missing value says why, when it last changed and what to do; a real value keeps the bar and carries no per-tile age', () => {
  const none = D.inkTile('Black', { state: 'unavailable', updated: T(5 * 3600) }, NOW);
  assert.match(vis(none), /Black ink Printer offline Last seen 5 h ago Next step: turn the printer on/);
  assert.doesNotMatch(vis(none), /No reading/);
  // a cartridge with a value that is not unavailable but not a number keeps the older wording
  assert.match(vis(D.inkTile('Black', { state: '', updated: T(5 * 3600) }, NOW)), /Black ink No reading No value for this cartridge\. The printer is usually off or asleep\. Last changed 5 h ago Next step: turn the printer on/);
  assert.match(vis(D.inkTile('Color', undefined, NOW)), /No sensor for this cartridge yet\. Never seen/);
  const ok = D.inkTile('Black', { state: '12', updated: T(120) }, NOW);
  assert.match(ok, /<div class="tile bad">/);
  assert.match(vis(ok), /^Black ink 12% Low$/);
  assert.match(ok, /<i style="width:12%">/);
});

test('printer (W5): an offline printer is one quiet row with when it was last seen, never one card per cartridge', () => {
  const B = 'sensor.hp_envy_6400_series_black_cartridge', C = 'sensor.hp_envy_6400_series_tri_color_cartridge';
  const off = D.printer({ [B]: { state: 'unavailable', updated: T(5 * 3600) }, [C]: { state: 'unavailable', updated: T(6 * 3600) } }, NOW);
  assert.equal((off.match(/class="frow"/g) || []).length, 1, 'one row');
  assert.doesNotMatch(off, /class="tile/, 'no card per cartridge');
  assert.equal(vis(off), 'Printer offline Last seen 5 h ago');
  assert.match(off, /<i class="sd off"><\/i>/, 'quiet: the dash mark, never the bad mark');
  assert.equal(vis(D.printer({}, NOW)), 'Printer not reported Never seen');
  // while it reports, each cartridge keeps its own tile and bar
  const on = D.printer({ [B]: { state: '62' }, [C]: { state: '12' } }, NOW);
  assert.equal((on.match(/<div class="tile/g) || []).length, 2);
  assert.match(vis(on), /Black ink 62% Color ink 12% Low/);
});

// ---------------- A28: decisions ----------------
const need = (o) => Object.assign({ text: 'Attach build 67 to Mesh for Small Business 1.3.1', why: 'version still uses build 60', source: 'app store connect', sev: 'med', url: 'https://appstoreconnect.apple.com/apps/1/distribution' }, o);
const prod = (needs) => ({ t: T(60), refresh: 300, stale: false, errors: [], needs, products: [], app_store: null });

test('decisions: every row has an Open button that only opens a new tab; a row with no page says so', () => {
  const html = D.products(prod([need(), need({ text: 'Reconnect 7 named Composio link(s)', source: 'accounts.json', url: null, sev: 'low' })]), NOW).needs;
  assert.equal((html.match(/<a class="b open"/g) || []).length, 1);
  assert.match(html, /<a class="b open" href="https:\/\/appstoreconnect\.apple\.com\/apps\/1\/distribution" target="_blank" rel="noopener noreferrer" aria-label="Open Attach build 67 to Mesh for Small Business 1\.3\.1 in a new tab">Open<\/a>/);
  assert.match(html, /<small class="nolink">No page to open<\/small>/);
  assert.equal((html.match(/class="frow need/g) || []).length, 2);
  assert.doesNotMatch(html, /<button|approve|onclick/i, 'Open never approves anything');
  assert.doesNotMatch(html, /<a [^>]*class="frow/, 'the row itself is no longer a link, so the Open button is the one target');
});

test('decisions: hostile urls do not link and hostile text is escaped', () => {
  const html = D.decisionRow(need({ url: 'javascript:alert(1)', text: '<img src=x onerror=alert(1)>' }), false);
  assert.doesNotMatch(html, /href="javascript/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /No page to open/);
});

test('decisions: an exact due date shows as a date; an approximate one is an owner-check tag; a plain row has neither', () => {
  assert.equal(D.dueTag({ due: '2026-10-28' }).text, 'Due Oct 28, 2026');
  assert.equal(D.dueTag({ deadline: Date.UTC(2026, 9, 29, 12) / 1000 }).text, 'Due Oct 29, 2026');
  assert.equal(D.dueTag({ text: 'Renew judgefinder.io', why: 'redemption deadline about Oct 30, confirm date' }).text, 'Owner check: confirm date');
  assert.equal(D.dueTag({ text: 'Attach build 67', why: 'version still uses build 60' }), null);
  assert.equal(D.dueTag({ text: 'Fix CI', why: 'about 3 jobs failing' }), null, 'about alone is not a deadline');
  const html = D.decisionRow(need({ text: 'Renew judgefinder.io', why: 'domain expires, about a week left, confirm date', url: null }), false);
  assert.match(html, /<small class="due"><span class="pill warn">Owner check: confirm date<\/span><\/small>/);
  assert.match(D.decisionRow(need({ due: '2026-10-28' }), false), /<span class="pill">Due Oct 28, 2026<\/span>/);
});

test('maintenance: a failing site check links to its site with an Open button', () => {
  const m = D.products(prod([need({ text: 'meshvault.ai: 1 check(s) failing', why: 'home', source: 'product-monitor', sev: 'high', url: 'https://meshvault.ai/', owner: 'none' })]), NOW).maintenance;
  assert.match(m, /href="https:\/\/meshvault\.ai\/" target="_blank" rel="noopener noreferrer" aria-label="Open meshvault\.ai: 1 check\(s\) failing in a new tab">Open<\/a>/);
  assert.doesNotMatch(m, /<small>Maintenance<\/small>/, 'a row under the Maintenance title carries no Maintenance tag (it squeezed the title on a phone)');
});

// PlanDesign section 3 and decision 5 (PR b): House groups "Your decisions" by kind and Products by state with DeckUI.group; every item
// stays one tap away (its name is its own link), a Now item never joins a Soon one, and one of a kind keeps its own row with Open.
test('decisions: steps of one kind and one urgency are one row with each name its own link; a lone step keeps its Open row', () => {
  const SINCE = { 1: '2026-10-20', 2: '2026-10-16', 3: '2026-11-02', 4: '2026-11-01' };
  const asc = (n, app, sev) => need({ text: 'Answer App Review for ' + app + ' 1.0', why: 'review unresolved issues since ' + SINCE[n], sev, url: 'https://appstoreconnect.apple.com/apps/' + n + '/distribution', owner: 'owner' });
  const ns = [asc(1, 'Homelab Dictate', 'high'), asc(2, 'JudgeFinder.io', 'high'), asc(3, 'Shellboard: Terminal Keyboard', 'high'),
    need({ text: 'Attach build 17 to Homelab Dictate 1.0', owner: 'owner', url: 'https://a.example/17' }), need({ text: 'Attach build 18 to JudgeFinder.io 1.0', owner: 'owner', url: 'https://a.example/18' }),
    asc(4, 'Mesh', 'med'), need({ text: 'Reconnect 7 named Composio link(s)', source: 'accounts.json', url: null, sev: 'low' })];
  const html = D.products(prod(ns), NOW).needs;
  const rows = html.split('<div class="frow').slice(1);
  assert.equal(rows.length, 4, 'three reviews, two builds, the lone Soon review and the lone relink: four rows for seven steps');
  // review #390: a group keeps the reason and the age, once: the shared words and the oldest "since" (Oct 16 of Oct 20, Oct 16, Nov 2)
  assert.match(vis(html), /^3 App Reviews to answer review unresolved issues since Oct 16 · App store connect Homelab Dictate JudgeFinder\.io Shellboard Now /);
  assert.match(html, /<b>3 App Reviews to answer<\/b><small>review unresolved issues since Oct 16 · App store connect<\/small>/);
  assert.match(vis(html), /2 builds to attach version still uses build 60 · App store connect Homelab Dictate 17 JudgeFinder\.io 18 Soon/);
  const mixed = D.needRows(prod([asc(1, 'A', 'high'), need({ text: 'Answer App Review for B 1.0', why: 'reply to Apple since 2026-10-10', sev: 'high', owner: 'owner' })]), 6);
  assert.match(vis(mixed), /^2 App Reviews to answer since Oct 10 · App store connect A B Now/, 'different reasons: the oldest age alone, never one member\'s words for all');
  assert.match(vis(html), /Answer App Review for Mesh 1\.0 .*Soon Open/, 'a Soon review never joins the Now group');
  for (const n of [1, 2, 3]) assert.equal((html.match(new RegExp('href="https://appstoreconnect\\.apple\\.com/apps/' + n + '/distribution"', 'g')) || []).length, 1, 'each review is its own link, one tap');
  assert.match(html, /href="https:\/\/a\.example\/17"/);
  assert.match(html, /class="frow grp need sv-high"/);
  assert.match(html, /<span class="pill sv-high"><i class="sd wait"><\/i>Now<\/span>/, 'the group keeps its word beside its mark');
  assert.match(html, /<small class="nolink">No page to open<\/small>/);
  assert.match(vis(D.needRows(prod(ns), 1, 'on Home')), /4 more on Home$/, 'the more line counts the steps left (2 builds, 1 review, 1 relink), not the rows');
  assert.doesNotMatch(D.needRows(prod([need({ text: '<img src=x onerror=1>', owner: 'owner' })]), 6), /<img/);
});

test('products: apps or sites in one state are one row with each name its own link; one alone keeps its row and its details', () => {
  const app = (n, name, state) => ({ name, url: 'https://appstoreconnect.apple.com/apps/' + n, version: { string: '1.0', state: 'PREPARE_FOR_SUBMISSION', build: 16 }, latest_build: { number: 17, state: 'VALID' }, review: { state } });
  const p = Object.assign(prod([]), { app_stores: [app(1, 'Homelab Dictate', 'UNRESOLVED_ISSUES'), app(2, 'JudgeFinder.io', 'UNRESOLVED_ISSUES'), app(3, 'Mesh', 'WAITING_FOR_REVIEW')],
    products: [{ name: 'meshvault.ai', url: 'https://meshvault.ai/', code: 200, ms: 210, state: 'up' }, { name: 'pepgo.org', url: 'https://pepgo.org/', code: 200, ms: 120, state: 'up' }] });
  const g = D.products(p, NOW).grid;
  assert.match(g, /^<div class="flist pgrp">/);
  assert.equal((g.match(/<div class="frow|<a [^>]*class="frow/g) || []).length, 3, 'issues open, waiting for review, two sites up');
  assert.match(vis(g), /^Issues open · 2 apps Homelab Dictate JudgeFinder\.io /);
  assert.match(vis(g), /Mesh Version 1\.0, in prep · build 16 attached · Newest build 17, valid Waiting for review/, 'one alone keeps its details and its state');
  assert.match(vis(g), /Up · 2 sites meshvault\.ai pepgo\.org$/);
  for (const u of ['https://appstoreconnect.apple.com/apps/1', 'https://appstoreconnect.apple.com/apps/2', 'https://meshvault.ai/', 'https://pepgo.org/'])
    assert.equal(g.split('href="' + u + '"').length - 1, 1, u + ': one link');
  assert.match(g, /<span class="lead-mark sd wait"/, 'issues open carry the wait mark beside their words');
  assert.doesNotMatch(D.products(Object.assign(prod([]), { products: [{ name: 'x', url: 'javascript:alert(1)', code: 200, state: 'up' }] }), NOW).grid, /javascript:/);
  const css = fs.readFileSync(path.join(__dirname, '../static/css/home.css'), 'utf8');
  assert.match(css, /#prod:not\(\.open\) #prodg \.pgrp>:nth-child\(n\+6\)\{display:none\}/, 'P and L: five rows, then Show more');
  assert.match(src, /const n=g\.querySelectorAll\('\.pgrp>\.frow'\)\.length;/, 'Show more counts rows');
});

// review #390: House's products went blank on a failed refresh (feedGet). They read through DeckPages.get now; a kept answer keeps its rows
// and the Products title says how old the read is
test('products: a failed refresh keeps the last rows with "Out of date · last read N min"; a first failure says not reporting', () => {
  const p = Object.assign(prod([need({ owner: 'owner' })]), { products: [{ name: 'pepgo.org', url: 'https://pepgo.org/', code: 200, ms: 120, state: 'up' }] });
  const kept = D.products(D.keptFeed({ ok: true, stale: true, at: Date.now() - 9 * 60 * 1000, data: p, error: 'http 500' }), NOW);
  assert.equal(kept.src, 'Out of date · last read 9 min');
  assert.match(kept.grid, /pepgo\.org/);
  assert.match(vis(kept.needs), /Attach build 67/);
  assert.match(D.products(D.keptFeed({ ok: false, status: 500, data: null, error: 'http 500' }), NOW).grid, /Products are not reporting/);
  assert.equal(D.products(D.keptFeed({ ok: true, data: p }), NOW).src, '', 'a fresh read says nothing');
  assert.match(src, /const v7Home=\(\)=>once\('home',async\(\)=>\{const p=DeckUI\.keptFeed\(await DeckPages\.get\('products'\)\);/);
});

// ---------------- A39: jobs ----------------
const job = (o) => Object.assign({ title: 'Platform Engineer', company: 'Acme', location: 'Remote', remote: true, salary: null, site: 'ashby', url: 'https://jobs.example/1', posted_at: T(3600), score: 90, flags: [], flag_text: [], note: null }, o);
const jobs = (ls) => ({ t: T(60), refresh: 21600, stale: false, errors: [], listings: ls });

test('jobs: flags, their words and the one-line note show on the row; a clean row shows none', () => {
  const h = D.jobs(jobs([
    job({ flags: ['clearance_required', 'login_for_match'], flag_text: ['Clearance required', 'Login needed for match'], note: 'Recruiter said onsite only <b>' }),
    job({ title: 'Clean', url: 'https://jobs.example/2' })]), 'all', NOW);
  assert.match(h, /<small class="jflags"><span class="pill warn">Clearance required<\/span> <span class="pill warn">Login needed for match<\/span><\/small>/);
  assert.match(h, /<small class="jnote">Recruiter said onsite only &lt;b&gt;<\/small>/);
  assert.equal((h.match(/class="jflags"/g) || []).length, 1);
  assert.equal((h.match(/class="jnote"/g) || []).length, 1);
});

test('jobs: flag ids without words fall back to the known words; unknown ids and an older feed show nothing', () => {
  assert.match(D.jobCue({ flags: ['clearance_required'] }), /Clearance required/);
  assert.equal(D.jobCue({ flags: ['mystery'] }), '');
  assert.equal(D.jobCue({ title: 'x' }), '');
  assert.equal(D.jobCue({ note: '   ' }), '');
  assert.match(D.jobCue({ note: 'x'.repeat(300) }), /<small class="jnote">x{140}<\/small>/);
});

// ---------------- Today v3 (2026-11-14): Home and cameras is one row per reading that exists; the full story stays on Home > House ----------------
test('Today car row: last seen from the car reading when cached, never the file time; a missing reading is no row', () => {
  const words = vis(D.tdHome({ car: car(), cams: { cams: [{ ready: true }] }, ha: { entities: {} }, watch: watch() }, NOW).html);
  assert.match(words, /Car Last seen 10 h ago 35% battery/);
  assert.doesNotMatch(words, /Updated|1 min ago/);
  // L22 (PlanDesign 3a): a current reading says when the car read it, once, on the same line
  const fresh = vis(D.tdHome({ car: car({ fresh: true, seen: T(90) }), cams: { cams: [{ ready: true }] }, ha: { entities: {} }, watch: watch() }, NOW).html);
  assert.match(fresh, /Car 98 mi · Locked · last seen 2 min ago 35% battery/);
  assert.equal((fresh.match(/last seen/gi) || []).length, 1);
  assert.doesNotMatch(fresh, /cached/i);
  // without the car's own reading time (an older poller, a server before readingAt) the line has no time, never the file's
  assert.match(vis(D.tdHome({ car: car({ fresh: true, seen: null }), cams: { cams: [{ ready: true }] }, ha: { entities: {} }, watch: watch() }, NOW).html), /Car 98 mi · Locked 35% battery/);
  // a watch with no health reading and an offline printer add no row on Today
  const ha = { entities: { 'sensor.hp_envy_6400_series_black_cartridge': { state: 'unavailable', updated: T(5 * 3600) } } };
  const quiet = vis(D.tdHome({ car: car(), cams: { cams: [{ ready: true }] }, ha, watch: watch() }, NOW).html);
  assert.doesNotMatch(quiet, /Apple Watch|Printer|No reading/);
  const live = vis(D.tdHome({ car: car(), cams: { cams: [{ ready: true }] }, ha, watch: watch({ hr: 61, battery: 80, connected: true }) }, NOW).html);
  assert.match(live, /Apple Watch Battery 80% 61 bpm/);
  const low = vis(D.tdHome({ car: car(), cams: null, ha: { entities: { 'sensor.hp_envy_6400_series_black_cartridge': { state: '12' } } }, watch: watch() }, NOW).html);
  assert.match(low, /Printer ink low Black 12%/);
});
