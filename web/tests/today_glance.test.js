// Today glance (round "Better", lane DoToday, 2026-11-15). The owner asked on 2026-11-03: his Today was "dense and hard to scan" (PR #80, B1).
// These pin the rules on the v3 page: the owner's steps first, each name once, rows of one kind as one row whose every name is its own link
// (M4, G6: a group never costs a tap), four rows before "N more" on a phone, the weather fallback (L21) and the laptop's wide Needs you (W13).
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../static/css/today.css'), 'utf8');
const end = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
const D = new Function(src.slice(src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), end) + '\nreturn DeckUI;')();
const glue = src.slice(end);

const NOW = Date.UTC(2026, 10, 15, 22, 0);
const T = NOW / 1000;
const visible = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const ASC = (id) => 'https://appstoreconnect.apple.com/apps/' + id + '/distribution';

// the products feed as it read on 2026-11-15 (public app names only; owner null, so the deck's legacy rule decides who owns a row)
const products = { t: T - 300, refresh: 900, errors: [], needs: [
  { text: 'Answer App Review for Homelab Dictate 1.0', sev: 'high', owner: null, source: 'app store connect', why: 'review unresolved issues since 2026-10-16', url: ASC(6820002722) },
  { text: 'Answer App Review for JudgeFinder.io 1.0', sev: 'high', owner: null, source: 'app store connect', why: 'review unresolved issues since 2026-10-16', url: ASC(6753701850) },
  { text: 'Answer App Review for Shellboard: Terminal Keyboard 1.0', sev: 'high', owner: null, source: 'app store connect', why: 'review unresolved issues since 2026-11-02', url: ASC(6828332417) },
  { text: 'Attach build 17 to Homelab Dictate 1.0', sev: 'med', owner: null, source: 'app store connect', why: 'version still uses build 16', url: ASC(6820002722) },
  { text: 'Attach build 18 to JudgeFinder.io 1.0', sev: 'med', owner: null, source: 'app store connect', why: 'version still uses build 17', url: ASC(6753701850) },
  { text: 'Fleet check: 1 problem(s)', sev: 'med', owner: null, source: 'fleet-health-last.json', why: 'Mac Mini Macintosh HD low on free space', url: null }] };
// TestFlight reports the same JudgeFinder.io App Review answer the products feed already carries
const testflight = { t: T - 300, apps: [{ id: '6753701850', name: 'JudgeFinder.io', versions: [{ version: '1.0', state: 'UNRESOLVED_ISSUES', build: '17' }], latest_build: { number: 18, processing_state: 'VALID' } }] };
const today = { gateway: { ok: true }, mail: { mailboxes: [{ role: 'primary', ok: true }, { role: 'personal', ok: false, link: 'https://platform.composio.dev/' }] }, cron: { next: [], failing: [], briefings: [] } };
const day = { products, testflight, schedules: { t: T, counts: { sources_down: 0 }, groups: [{ jobs: [{ name: 'x', result: 'failed' }] }] }, today, replyblock: { counts: { drafted: 0 } } };

test('G6: three App Reviews are one row, each name its own link to its own App Store Connect page; the Now mark and word stay', () => {
  const n = D.tdNeeds(day);
  const h = D.tdNeedsHtml(n);
  const row = /<div class="frow need td-grp" data-k="review">[^]*?<\/div>/.exec(h)[0];
  assert.match(visible(row), /^3 App Reviews to answer since Oct 16 Now Homelab Dictate JudgeFinder\.io Shellboard$/);
  assert.match(row, /<span class="pill">Now<\/span><span class="td-chips">/, 'the names are their own full-width line under the head and its word');
  const links = [...row.matchAll(/<a class="td-chip" href="([^"]+)"[^>]*aria-label="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[3], m[1], m[2]]);
  assert.deepEqual(links.map((l) => l[0]), ['Homelab Dictate', 'JudgeFinder.io', 'Shellboard']);
  assert.deepEqual(links.map((l) => l[1]), [ASC(6820002722), ASC(6753701850), ASC(6828332417)], 'each member opens its own page: no extra tap');
  assert.match(links[2][2], /^Answer App Review for Shellboard: Terminal Keyboard 1\.0, review unresolved issues since Nov 2$/, 'the whole step stays in the accessible name');
  assert.match(row, /lead-mark sd wait/, 'the most urgent mark of its members');
  assert.match(row, /target="_blank" rel="noopener noreferrer"/);
});

test('G6: a Now row never joins a Soon row; builds group on their own; one of a kind stays its own row', () => {
  const h = D.tdNeedsHtml(D.tdNeeds(day)), w = visible(h);
  assert.match(w, /^Needs you 3 App Reviews to answer [^]*Now [^]*Gmail personal needs a relink [^]*Now 2 builds to attach Soon Homelab Dictate 17 JudgeFinder\.io 18/);
  assert.match(h, /<a href="https:\/\/platform\.composio\.dev\/" target="_blank" rel="noopener noreferrer" class="frow need">/, 'a single relink keeps its full-row link');
  const mixed = D.tdGroup([{ sev: 'high', text: 'Answer App Review for A 1.0', url: 'https://a.example/' }, { sev: 'med', text: 'Answer App Review for B 1.0', url: 'https://b.example/' }]);
  assert.equal(mixed.length, 2, 'Now and Soon of the same kind stay apart');
  assert.ok(mixed.every((x) => !x.kind));
});

test('B1: each name once: the App Review answer from TestFlight is dropped when the products feed carries it; agent work leaves Needs you', () => {
  const n = D.tdNeeds(day), w = visible(D.tdNeedsHtml(n));
  assert.equal((w.match(/JudgeFinder\.io/g) || []).length, 2, 'once as an App Review, once as a build to attach, never twice as a review');
  assert.doesNotMatch(w, /Fleet check|failing|Some checks/, 'the fleet check and failing jobs are for an agent');
  const a = visible(D.tdAlertsHtml(n, today, { count: 1, names: ['disk'] }, n.miss).html);
  assert.match(a, /^Alerts 1 scheduled job failing Status 1 fleet problem$/);
  assert.doesNotMatch(a, /mailbox/, 'the relink is said once, in Needs you');
});

test('B1: a part the Status row already names is not listed again in the checks row, but still counts as missing for the page', () => {
  const miss = [D.tdMiss('gateway', { error: 'gateway unreachable' }), D.tdMiss('cams', { error: 'x' })];
  const w = visible(D.tdAlertsHtml(null, { mail: { mailboxes: [] }, cron: { next: [], failing: [] } }, { count: 0, names: [] }, miss).html);
  assert.match(w, /Some checks did not report Cameras Status Hermes not reporting/);
  assert.equal((w.match(/Hermes/g) || []).length, 1);
  assert.equal(D.tdFresh({}, miss, NOW).missing, 2);
});

test('G6: four rows on a phone and six wider, each with its own "N more" row; the TV keeps four', () => {
  const many = { ...day, testflight: { apps: [] }, products: { ...products, needs: Array.from({ length: 9 }, (_, i) => ({ owner: 'owner', sev: 'low', text: 'Decision ' + i })) } };
  const h = D.tdNeedsHtml(D.tdNeeds(many));
  // 9 decisions plus the relink row: 10 rows
  assert.equal((h.match(/class="frow need/g) || []).length, 6);
  assert.equal((h.match(/class="frow need td-ph tv-hide"/g) || []).length, 2, 'rows five and six are off a phone and the TV');
  assert.match(h, /class="frow td-more-w tv-hide" data-open="today-needs"><span class="fl"><b>4 more<\/b>/);
  assert.match(css, /html\[data-dc="P"\] #pg-today \.td-ph,html\[data-dc="L"\] #pg-today \.td-ph,html\[data-dc="P"\] #pg-today \.td-more-w,html\[data-dc="L"\] #pg-today \.td-more-w\{display:none\}/);
  assert.match(css, /#pg-today \.td-more-p\{display:none\}/);
  assert.match(css, /html\[data-dc="P"\] #pg-today \.td-more-p,html\[data-dc="L"\] #pg-today \.td-more-p\{display:flex\}/);
  // four or fewer rows: no "more" row at any size
  assert.doesNotMatch(D.tdNeedsHtml(D.tdNeeds(day)), /td-more/);
  // the sheet holds every step, grouped as on the page
  const sheet = visible(D.tdNeedsSheet(D.tdNeeds(many)));
  assert.match(sheet, /Decision 8/);
  // review of #356: the page groups, the sheet spells every step out with its own why line
  const sheetDay = D.tdNeedsSheet(D.tdNeeds(day));
  assert.doesNotMatch(sheetDay, /class="frow need [0-9]|lead-mark sd [^"]*[\[,]|td-grp/, 'a sheet row never carries a list index as a class or an array as its mark, and never groups');
  assert.match(visible(sheetDay), /Answer App Review for Homelab Dictate 1\.0 review unresolved issues since Oct 16 Now Answer App Review for JudgeFinder\.io 1\.0 review unresolved issues since Oct 16 Now/);
  assert.match(visible(sheetDay), /Attach build 17 to Homelab Dictate 1\.0 version still uses build 16 Soon/);
});

test('G6: a name chip is a full touch target, and the names line never leaves its row (ws4z90 --check: 9 px outside at 2744 px)', () => {
  assert.match(css, /#pg-today \.td-chip\{display:inline-flex;align-items:center;min-height:var\(--hit\);/);
  const rule = /#pg-today \.td-grp>\.td-chips\{([^}]*)\}/.exec(css)[1];
  assert.match(rule, /flex:1 1 100%;min-width:0;/);
  assert.match(rule, /flex-wrap:wrap/);
  assert.doesNotMatch(rule, /margin:[^;]*-/, 'no negative margin pulls the line past the row edge');
  assert.match(css, /#pg-today \.td-chip\{[^}]*max-width:100%;min-width:0\}/);
});

test('Needs you: an empty read says what it knows: nothing needs you only when complete, else a decision may be missing', () => {
  const clean = { ...day, products: { ...products, needs: [] }, testflight: { apps: [] }, today: { ...today, mail: { mailboxes: [] } } };
  assert.match(visible(D.tdNeedsHtml(D.tdNeeds(clean))), /^Needs you Nothing needs you$/);
  const partial = { ...clean, testflight: { error: 'timed out' } };
  const h = D.tdNeedsHtml(D.tdNeeds(partial));
  assert.match(visible(h), /^Needs you Some decisions may be missing A source did not report$/);
  assert.match(h, /data-open="today-checks"/);
});

// L21: Home Assistant's weather entity goes unavailable when met.no answers 502 or 503; the deck's own weather line still reads
test('L21: the weather row falls back to the deck weather line when Home Assistant has none; nothing either way, no row', () => {
  const wx = { text: 'Dana Point  \u00B7  Temp 68\u00B0F  \u00B7  Wind 5 mph' };
  const down = { entities: { 'weather.forecast_home': { state: 'unavailable' } } };
  assert.match(visible(D.tdHome({ ha: down, wx }, NOW).html), /Weather Dana Point · Wind 5 mph 68°F/);
  assert.match(visible(D.tdHome({ ha: { error: 'no answer' }, wx }, NOW).html), /Weather Dana Point · Wind 5 mph 68°F/, 'Home Assistant down too');
  assert.match(visible(D.tdHome({ ha: { entities: { 'weather.forecast_home': { state: 'sunny' } } }, wx }, NOW).html), /Weather Sunny/, 'a live entity wins');
  for (const w of [{ text: 'Weather unavailable' }, { error: 'no answer' }, null, { text: 'Dana Point' }])
    assert.doesNotMatch(visible(D.tdHome({ ha: down, wx: w }, NOW).html), /Weather/);
  assert.match(glue, /Promise\.all\(\[P\.cams,P\.car,P\.ha,P\.watch,P\.weather\]\)\.then\(\(\)=>tdPaint\('home',\(\)=>DeckUI\.tdHome\(\{cams:F\.cams,car:F\.car,ha:F\.ha,watch:F\.watch,wx:F\.weather\},now\(\)\)\)\)/);
});

// W13: at laptop width Needs you was a 365 px column whose rows wrapped to three and four lines
test('W13: on D Needs you and Alerts take the left 5/12; the other lists balance in two columns in the right 7/12; other sizes keep one flow', () => {
  assert.match(glue, /want=tv\?'tv':document\.documentElement\.dataset\.dc==='D'\?'split':'flow'/);
  assert.match(glue, /if\(want==='split'\)\{const g=box\('td-split'\),l=box\('td-col'\);l\.append\(el\.needs,el\.alerts\);g\.append\(l,flow\);/);
  assert.match(glue, /S\.filter\(k=>!\['needs','alerts','mkt','glance'\]\.includes\(k\)\)\.forEach\(k=>flow\.appendChild\(el\[k\]\)\);root\.append\(g,el\.glance,el\.mkt\)/, 'At a glance before Markets on D too');
  assert.match(css, /\.td-split\{display:grid;grid-template-columns:minmax\(0,5fr\) minmax\(0,7fr\);/);
  assert.match(css, /\.td-split>\.flow\.td\{--col-w:13rem;--col-max:2\}/);
});

// W4-3 (his 2470x1286 window): At a glance began 1,363 px down, below the fold, under Markets; Main 2026-11-15: At a glance above Markets at every size
test('W4-3: At a glance comes before Markets in every layout; Markets stays whole below it', () => {
  const S = [...D.TD_SECTIONS];
  assert.ok(S.indexOf('glance') === S.indexOf('mkt') - 1, 'glance right above markets');
  assert.match(glue, /root\.innerHTML=S\.map\(k=>'<section class="sect'\+\(k==='mkt'\|\|k==='glance'\?' span-all':''\)/, 'both span the width under the balanced columns');
});

// Shop leads a watch with its best price; Today's Shop tile says the same figure first and the median second (review of #356)
test('Shop tile: the best price is the figure, said with Shop\'s condition word; the median second with its 7-day change; no listing keeps the median', () => {
  const w = (o) => ({ watches: { items: [{ label: 'rtx 4080', median: 1100, change_7d: -14.29, ...o }] } });
  const shop = (o) => D.tdGlance({ ecom: w(o) }).tiles.find((x) => x.key === 'shop');
  const t = shop({ best: { price: 880, platform: 'Newegg', condition: 'new' } });
  assert.deepEqual([t.h, visible(t.v), visible(t.t)], ['Shop · RTX 4080', '$880', 'median $1,100 \u221214.3% 7 days']);
  // ReviewFive: the kit's best price is a refurbished listing; Shop says "refurbished", so Today says the same word (shop.js COND_WORD)
  assert.equal(visible(shop({ best: null, best_used: { price: 880, condition: 'refurbished' } }).v), '$880 refurbished');
  assert.equal(visible(shop({ best: null, best_used: { price: 640, condition: 'used' } }).v), '$640 used');
  assert.equal(visible(shop({ best: null, best_used: { price: 700, condition: 'open-box' } }).v), '$700 open box');
  assert.equal(visible(shop({ best: null, best_used: { price: 700 } }).v), '$700 not new', 'a used-side listing with no condition is never read as new');
  assert.equal(visible(shop({}).v), '$1,100 median', 'no listing: the median stays the figure and says so');
  // the small line is two whole parts the tile wraps between (#td-glance .tile .t is a wrapping flex row): no "·" left at a line end
  assert.match(t.t, /^<span class="td-nw">median \$1,100<\/span><span class="td-nw"><span class="delta dn">\u221214\.3%<\/span> 7 days<\/span>$/);
  assert.doesNotMatch(t.t, /\u00B7/);
  assert.match(css, /#td-glance \.td-nw\{white-space:nowrap\}/);
});

test('Shop tile: Today\'s condition words are Shop\'s, word for word', () => {
  const shopSrc = fs.readFileSync(path.join(__dirname, '../static/pages/shop.js'), 'utf8');
  const lit = (s, re) => { const m = re.exec(s); assert.ok(m, String(re)); return Function('return (' + m[1] + ')')(); };
  assert.deepEqual(lit(src, /const TD_COND=(\{[^}]*\})/), lit(shopSrc, /const COND_WORD = (\{[^}]*\})/));
});

test('traffic sheet: summed visitors say they are a sum across projects', () => {
  const vercel = { status: 'ok', start_date: '2026-10-19', end_date: '2026-11-15', projects: [
    { domain: 'a.com', domains: ['a.com'], pageviews: 10, visitors: 4, status: 'ok', tracked: true },
    { domain: 'b.com', domains: ['b.com'], pageviews: 5, visitors: 3, status: 'ok', tracked: true }] };
  assert.match(visible(D.tdTrafficSheet({ status: 'unavailable', sites: [], vercel })), /^Page views 15 Last 28 days, Oct 19 to Nov 15 Visitors 7 Summed across projects a\.com/);
});

test('calendar: with the next briefing first, a phone shows three rows; the third event stays one tap away in the calendar sheet', () => {
  const k = (d) => { const x = new Date(NOW + d * 864e5); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const cal = { t: T, days: [{ date: k(1), events: ['A', 'B', 'C'].map((title, i) => ({ title, start: new Date(NOW + 864e5 + i * 3600e3).toISOString() })) }] };
  const h = D.tdCal(cal, null, NOW, { briefing: [{ name: 'Morning brief', at: T + 3600 }] }).html;
  assert.equal((h.match(/class="frow tv-hide td-ph"/g) || []).length, 1);
  assert.match(h, /td-ph"><span class="fl"><b>C<\/b>/);
  assert.doesNotMatch(D.tdCal(cal, null, NOW).html, /td-ph/, 'without a briefing the three events show');
  assert.match(visible(D.tdCalSheet(cal, null, NOW)), /A[^]*B[^]*C/);
});

// Main's review of #356: at 1440 Renewals broke "countymedic.com" at its dot; a domain name never breaks, the day count gives way
test('renewals: a one-word name (a domain) is kept whole; the day count beside it may wrap instead; names with spaces wrap as before', () => {
  const r = D.tdDeadlines({ renewals: [{ vendor: 'countymedic.com', date: '2026-11-05', days: -10 }, { vendor: 'Utilities: bill split with Riley', date: '2026-11-16', days: 1 }], paperwork: [] }, null, NOW).html;
  assert.match(r, /<b class="td-nb">countymedic\.com<\/b>/);
  assert.match(r, /<b>Utilities: bill split with Riley<\/b>/);
  assert.match(css, /#td-dead \.frow \.fl b\.td-nb\{white-space:nowrap;overflow-wrap:normal\}/);
  assert.match(css, /#td-dead \.frow:has\(b\.td-nb\) \.fl\{min-width:auto\}/);
  assert.match(css, /#td-dead \.frow:has\(b\.td-nb\) \.fr b\{white-space:normal\}/);
});

// Decision 4 (Surf reviewer, 2026-11-15): with per-spot heights on, a break marked height_basis region has no wave data of its own, so Today's
// Surf tile names the region and prints the region's height, never as the break's; spot and sensor print as the break's; no field reads as region.
test('Surf tile: region basis names the region and its height; spot and sensor name the break; a feed without the field reads as region', () => {
  const sp = (basis, o) => ({ id: 'salt-creek', name: 'Salt Creek', region: 'orange-county', pinned: 1, now: { wave_ft: [3.6, 4.4], rating: 6, word: 'Good', ...(basis ? { height_basis: basis } : {}), confidence: { model_only: false } }, ...(o || {}) });
  const feed = (spots, regions) => ({ t: T, spots, regions: regions || [{ id: 'orange-county', name: 'Orange County', wave_ft: [4, 5] }] });
  const tile = (f) => D.tdGlance({ surf: f }).tiles.find((x) => x.key === 'surf');
  const reg = tile(feed([sp('region')]));
  assert.deepEqual([reg.h, visible(reg.v)], ['Surf · Orange County', '4-5 ft'], 'the region height under the region name');
  assert.match(visible(reg.t), /Good Salt Creek/, 'the break keeps its rating word beside its own name');
  assert.doesNotMatch(reg.h, /Salt Creek/);
  for (const b of ['spot', 'sensor']) assert.deepEqual([tile(feed([sp(b)])).h, visible(tile(feed([sp(b)])).v)], ['Surf · Salt Creek', '4 ft'], b + ': the break\'s own height, rounded as Surf rounds it');
  const old = tile(feed([sp(null)]));
  assert.equal(old.h, 'Surf · Orange County', 'no height_basis (an older feed) reads as region');
  assert.equal(tile(feed([sp('region')], [])), undefined, 'a region with no height in the feed: no figure is claimed for the break');
  // the region's hollow model mark only when every break in it is model only
  const m = (o) => sp('region', { now: { wave_ft: [4, 5], rating: 6, word: 'Good', height_basis: 'region', confidence: { model_only: o } } });
  assert.match(tile(feed([m(true)])).v, /class="model"/);
  assert.doesNotMatch(tile(feed([m(true), { ...m(false), id: 'b', pinned: 2 }])).v, /class="model"/);
});

// review of #390 (ReviewSeven): a member whose date does not read (fmt.date gives null) printed "since null"; the "since" part is left out
test('grouped row: an unreadable "since" date leaves the since words out; a readable one stays', () => {
  const it = (n, s) => ({ sev: 'high', text: 'Answer App Review for ' + n + ' 1.0', why: 'review ' + n, since: s, url: ASC(1) });
  const row = (s) => visible(D.tdNeedsHtml({ items: [it('A', s), it('B', s)], miss: [], complete: true, jobs: { wait: [], failed: [], over: [] } }));
  assert.match(row('2026-10-16'), /2 App Reviews to answer since Oct 16 Now A B/);
  for (const bad of ['x', 'soon', 'null']) {
    assert.doesNotMatch(row(bad), /since|null/, bad);
    assert.match(row(bad), /2 App Reviews to answer Now A B/, bad);
  }
});
