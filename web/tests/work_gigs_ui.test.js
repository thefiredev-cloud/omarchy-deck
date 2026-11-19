// node --test tests/work_gigs_ui.test.js
// Work > Gigs (design v3, PgWork 2026-11-14): Tanner's freelance gigs from gigs.json. The row model, kind and order, paging to about three
// phone screens, empty states, At a glance and the Data sheet input (where the gigs came from). No DOM, no network.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const a = src.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const b = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
assert.ok(a >= 0 && b > a);
const D = new Function(src.slice(a, b) + '\nreturn DeckUI;')();
const glue = src.slice(b);

const NOW = Date.UTC(2026, 10, 2, 18, 0, 0);
const T = (agoS) => NOW / 1000 - agoS;
const G = (o) => Object.assign({
  id: 'g1', title: 'Build a local AI agent for a dental office', site: 'upwork', url: 'https://example.com/g1', pay: '$90/hr',
  pay_min: 80, pay_max: 100, pay_unit: 'hour', fit: 88, posted_at: T(7200), summary: 'Agent on their own box.', why: ['Local AI agents', 'Pay clears your floor'],
  pitch: 'Hi, I build private AI agents that run on your own hardware.\nHappy to scope this in a short call.', t: T(3600), kind: 'gig', category: 'ai_agents', est_hourly: 90, floor_ok: true,
}, o);
const FEED = () => ({ t: T(600), refresh: 7200, errors: [{ source: 'sam', reason: 'sequence item 2: expected str instance' }], sites_checked: 85, sites_registry: 282,
  rules: { floor_hourly_usd: 150, floor_fixed_usd: 500 }, by_site: { upwork: 2, contra: 1, 'freelancer-api': 1, empty: 0 },
  gigs: [G({}), G({ id: 'g2', title: 'Fixed price RAG prototype', site: 'contra', url: 'https://example.com/g2', pay: null, pay_min: 2000, pay_max: 4000, pay_unit: 'fixed', fit: 74, posted_at: T(86400 * 3), t: T(86400 * 2), est_hourly: 60, pitch: '' }),
    G({ id: 'g3', title: 'County RFP: AI records search', site: 'sam.gov', url: 'https://example.com/g3', kind: 'rfp', pay: null, pay_min: null, pay_max: null, pay_unit: null, fit: 81, posted_at: T(600), est_hourly: null, floor_ok: null }),
    G({ id: 'g4', title: 'Cheap chatbot', url: 'https://example.com/g4', fit: 30, pay: '$15/hr', floor_ok: false, pitch: null })] });
const rowsOf = (h) => (h.match(/class="gitem"/g) || []).length;

test('row model: title, kind and category, pay as its own value or null, an hourly estimate only when pay is not hourly, fit', () => {
  const [g1, g2, g3, g4] = FEED().gigs;
  const m = D.gigRowModel(g1);
  assert.equal(m.title, 'Build a local AI agent for a dental office');
  assert.equal(m.what, 'Gig \u00B7 AI agents \u00B7 Nov 2', 'a feed that does not say which kind of date gets the bare day');
  assert.equal(m.pay, '$90/hr');
  assert.equal(m.est, null, 'hourly pay needs no estimate');
  assert.equal(m.fit, 88);
  assert.equal(D.gigRowModel(g2).pay, '$2,000 to $4,000 fixed');
  assert.equal(D.gigRowModel(g2).est, 'About $60/hr');
  assert.equal(D.gigRowModel(g3).pay, null);
  assert.equal(D.gigRowModel(g3).what, 'RFP \u00B7 AI agents \u00B7 Nov 2');
  assert.equal(D.gigRowModel(g4).below, true);
  const r = D.gigRow(g2);
  assert.match(r, /<span class="jpay">\$2,000 to \$4,000 fixed<small>About \$60\/hr<\/small><\/span>/);
  assert.match(r, /<span class="fr"><b>74<\/b><small>Fit<\/small><\/span>/);
  assert.doesNotMatch(D.gigRow(g3), /jpay|not stated/, 'no pay, no pay line');
  assert.match(D.gigRow(g4), /<small class="jnote">Below your pay floor<\/small>/);
  for (const x of FEED().gigs) assert.doesNotMatch(D.gigRow(x), /upwork|contra|sam\.gov| ago\b/, 'no site and no age on a row');
});

test('D15: a gig row says its day and what kind of day it is: "Posted" only from the source, "First seen" when the search\'s first sight dates it', () => {
  const what = (o) => D.gigRowModel(G(Object.assign({ posted_at: T(86400 * 3) }, o))).what;
  assert.equal(what({ posted_basis: 'source' }), 'Gig \u00B7 AI agents \u00B7 Posted Oct 30');
  assert.equal(what({ posted_basis: 'first_seen' }), 'Gig \u00B7 AI agents \u00B7 First seen Oct 30', 'as the Jobs sheet says it; never a bare "Seen", which reads as last seen');
  assert.equal(what({}), 'Gig \u00B7 AI agents \u00B7 Oct 30', 'no basis, no word claimed');
  for (const b of ['toString', '__proto__', 'constructor', 'SOURCE', 9]) assert.equal(what({ posted_basis: b }), 'Gig \u00B7 AI agents \u00B7 Oct 30', 'an unknown basis claims nothing: ' + b);
  assert.equal(D.gigRowModel(G({ posted_at: null, posted_basis: 'source' })).what, 'Gig \u00B7 AI agents', 'no date, no date words');
  const first = D.gigRow(G({ posted_basis: 'first_seen' })), src = D.gigRow(G({ posted_basis: 'source' }));
  assert.match(first, /<small>Gig \u00B7 AI agents \u00B7 First seen Nov 2<\/small>/);
  assert.doesNotMatch(first, /Posted/);
  assert.match(src, /<small>Gig \u00B7 AI agents \u00B7 Posted Nov 2<\/small>/);
  assert.doesNotMatch(src, /[Ss]een/);
});

test('pay: the feed text is shown whole, never cut mid-figure, and a currency code stays on its figure (layout audit 2026-11-15)', () => {
  const long = G({ pay: '$1,590 to $2,651 fixed (INR 150,000 to INR 250,000)', pay_unit: 'fixed' });
  assert.equal(D.gigPay(long), '$1,590 to $2,651 fixed (INR\u00A0150,000 to INR\u00A0250,000)');
  assert.equal(D.gigPay(G({ pay: '  $6,610 to $13,220 fixed (GBP 5,000 to GBP 10,000) ' })), '$6,610 to $13,220 fixed (GBP\u00A05,000 to GBP\u00A010,000)');
  assert.match(D.gigRow(long), /<span class="jpay">\$1,590 to \$2,651 fixed \(INR\u00A0150,000 to INR\u00A0250,000\)<small>About \$90\/hr<\/small><\/span>/);
  assert.equal(D.gigPay(G({ pay: '$90/hr' })), '$90/hr');
  assert.equal(D.gigPay(G({ pay: 'not stated', pay_min: null, pay_max: null })), '', 'a feed placeholder is no pay');
  assert.doesNotMatch(D.gigRow(G({ pay: 'Not stated', pay_min: null, pay_max: null, est_hourly: null })), /jpay|not stated/i);
  const fn = src.slice(src.indexOf('function gigPay'), src.indexOf('function gigFilter'));
  assert.doesNotMatch(fn, /str\(x&&x\.pay,/, 'no fixed-length cut on the pay text');
});

test('work.css: the gig and job lists run across the page in columns of rows off TV; their side blocks follow under them', () => {
  const css = fs.readFileSync(path.join(__dirname, '../static/css/work.css'), 'utf8');
  assert.match(css, /html:not\(\.tv\) \.jlist,html:not\(\.tv\) \.glist\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,20rem\),1fr\)\);/);
  assert.match(css, /html:not\(\.tv\) \.jlist>\.frow,html:not\(\.tv\) \.glist>\.gitem\{border-top:0;box-shadow:0 -1px 0 var\(--c-line\)\}/, 'one hairline under every column');
  assert.match(css, /\.jmkt \.kv\{max-width:none\}/, 'the Market figures end at the card edge, as By category does beside it');
  assert.match(css, /html:not\(\.tv\) \.jside\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,20rem\),1fr\)\);/);
  assert.doesNotMatch(src.slice(src.indexOf('function jobs('), src.indexOf('function jobSaved')), /c-8|c-4/, 'no half-width span beside a long list');
});

test('page: one control row (kind chips only with more than one kind, a Newest toggle), best fit first, a closed draft pitch, At a glance', () => {
  const h = D.gigs(FEED(), NOW, {});
  assert.match(h, /^<div class="fbar gfbar" data-wk="ctl"><div class="fbar-top gctl"><button type="button" class="btn fbar-open" data-open-fbar="gigs" aria-haspopup="dialog" aria-label="Filters"><svg class="i" aria-hidden="true"><use href="#i-filter"\/><\/svg><span class="fbw">Filters<\/span><\/button><div class="chips" id="gkind" role="group" aria-label="Kind and order"><button type="button" data-gkind="all" class="on" aria-pressed="true">All <small>4<\/small><\/button><button type="button" data-gkind="gig" aria-pressed="false">Gigs <small>3<\/small><\/button><button type="button" data-gkind="rfp" aria-pressed="false">RFPs <small>1<\/small><\/button><button type="button" class="gnew" data-gsort="new" aria-pressed="false">Newest<\/button><\/div><\/div><\/div>/);
  const body = h.slice(h.indexOf('data-wk="body"'));
  const order = [...body.matchAll(/<span class="fl"><b>([^<]+)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(order, ['Build a local AI agent for a dental office', 'County RFP: AI records search', 'Fixed price RAG prototype', 'Cheap chatbot']);
  assert.equal((h.match(/<details class="gpitch">/g) || []).length, 2, 'only gigs with a pitch get one, closed');
  assert.match(h, /Draft only\. Nothing is sent from the deck\./);
  // At a glance leads the page, as every page's strip does: under twelve cards it crossed the fold of his 2470x1286 window (SeeWs4 W4-11)
  assert.match(h, /<div data-wk="body" class="gbody"><section class="sect gglance"><div class="strip" data-n="4" data-nb="4" role="group" aria-label="At a glance">[\s\S]*?<\/div><\/section><div class="g12 jgrid"><section class="sect jmain board"><div class="flist glist">/);
  // TV: the board keeps the top of the screen as before (three gigs, not the strip and two); the strip follows it by flex order, on TV only
  const wcss = fs.readFileSync(path.join(__dirname, '../static/css/work.css'), 'utf8');
  assert.match(wcss, /html\.tv \.gbody\{display:flex;flex-direction:column\}/);
  assert.match(wcss, /html\.tv \.gbody>\.gglance\{order:1;margin:0\}/);
  assert.equal((wcss.match(/\.gbody/g) || []).length, 2, 'no .gbody rule outside the TV class');
  assert.ok(h.indexOf('gglance') < h.indexOf('class="flist glist"'), 'the strip before the first gig');
  assert.doesNotMatch(h, /jside|<h2 class="secttl"><span>At a glance/, 'no side block after the list, no heading over the strip');
  assert.match(h, /<div class="tile"><span class="h">Gigs found<\/span><b class="v">4<\/b><\/div>/);
  assert.doesNotMatch(h, /\bfeed\b/i, 'no feed jargon on the page (review W8)');
  assert.match(h, /<span class="h">Fit 80 or better<\/span><b class="v">2<\/b>/);
  assert.match(h, /<span class="h">New in the last day<\/span><b class="v">3<\/b>/);
  assert.match(h, /<span class="h">Draft pitches ready<\/span><b class="v">2<\/b>/);
  assert.doesNotMatch(h, /class="kv"/);
  assert.match(h, /Showing 4 of 4/);
  // where they came from moved to the Data sheet
  assert.doesNotMatch(h, /Where they came from|sites checked|upwork|contra|sam\.gov|freelancer|Updated| ago/i);
  // the Filters dialog carries the same choices for L, where the row collapses into the bar
  const dlg = h.slice(h.indexOf('<dialog'), h.indexOf('</dialog>'));
  assert.match(dlg, /id="fb-gigs"/);
  assert.match(dlg, /<h3>Kind<\/h3>[\s\S]*data-gkind="rfp"/);
  assert.match(dlg, /<h3>Order<\/h3><div class="seg" role="group" aria-label="Order"><button type="button" data-gsort="fit" class="on" aria-pressed="true">Best fit<\/button>/);
  assert.match(dlg, /data-close>Show 4 gigs<\/button>/);
  // a kind filters the list; a kind the feed lacks falls back to all; Newest orders by posted date and toggles back
  const rfp = D.gigs(FEED(), NOW, { kind: 'rfp' });
  assert.equal(rowsOf(rfp), 1);
  assert.match(rfp, /data-open-fbar="gigs" aria-haspopup="dialog" aria-label="Filters, 1 set"><svg[^]*?<\/svg><span class="fbw">Filters<\/span> <span class="cnt">1<\/span>/);
  assert.equal(rowsOf(D.gigs(FEED(), NOW, { kind: 'contract' })), 4);
  assert.deepEqual(D.gigFilter(FEED(), { sort: 'new' }).map((x) => x.id), ['g3', 'g1', 'g4', 'g2']);
  assert.match(D.gigs(FEED(), NOW, { sort: 'new' }), /<button type="button" class="gnew on" data-gsort="fit" aria-pressed="true">Newest<\/button>/);
  const one = FEED();one.gigs = one.gigs.filter((g) => g.kind === 'gig');
  assert.doesNotMatch(D.gigs(one, NOW, {}), /data-gkind/);
});

test('paging: twelve, so rows come out whole at one, two, three, four or six columns; Show 24 more as a secondary button, Show fewer, capped at 500; duplicates by url collapse', () => {
  const f = { t: T(60), gigs: Array.from({ length: 60 }, (_, i) => G({ id: 'x' + i, title: 'Gig ' + i, url: 'https://example.com/x' + i, fit: 100 - i })) };
  f.gigs.push(G({ id: 'dup', title: 'Gig 0 again', url: 'https://example.com/x0' }));
  assert.equal(D.gigList(f).length, 60);
  const p1 = D.gigs(f, NOW, {});
  assert.equal(rowsOf(p1), 12);
  assert.equal(D.GIG_SHORT % 12, 0);
  assert.equal(D.GIG_STEP % 12, 0, 'every page size a multiple of 12 (layout audit D 28)');
  assert.match(p1, /Showing 12 of 60/);
  assert.match(p1, /<button type="button" class="btn" data-more="gigs">Show 24 more<\/button>/);
  assert.doesNotMatch(p1, /Show fewer/);
  const p2 = D.gigs(f, NOW, { page: 36 });
  assert.equal(rowsOf(p2), 36);
  assert.match(p2, /Show 24 more/);
  assert.match(p2, /data-less="1" data-more="gigs">Show fewer/);
  assert.match(D.gigs(f, NOW, { page: 60 }), /Showing 60 of 60/);
  assert.doesNotMatch(D.gigs(f, NOW, { page: 60 }), /Show \d+ more/);
  const big = { t: T(60), gigs: Array.from({ length: 600 }, (_, i) => G({ id: 'y' + i, url: 'https://example.com/y' + i })) };
  assert.equal(rowsOf(D.gigs(big, NOW, { page: 9999 })), D.GIG_CAP);
  assert.match(glue, /GIGV\.page=m\.dataset\.less\?DeckUI\.GIG_SHORT:Math\.min\(Math\.max\(GIGV\.page,DeckUI\.GIG_SHORT\)\+DeckUI\.GIG_STEP,DeckUI\.GIG_CAP\)/);
});

test('states: a missing feed says the same as the header\'s mark, not reporting, with one Try again; an empty run says so; junk is escaped', () => {
  for (const f of [null, { error: 'http 404' }, { error: 'file missing', stale: true }]) {
    const h = D.gigs(f, NOW, {});
    // one word for one cause (SeeStates E10): the header's mark says "Not reporting", so the body never reads as a setup step
    assert.match(h, /<b class="es-t">Gigs are not reporting<\/b>/);
    assert.match(h, /es-bad/);
    assert.doesNotMatch(h, /feed yet|es-idle|es-setup/);
    assert.equal((h.match(/data-retry="gigs"/g) || []).length, 1);
    assert.doesNotMatch(h.replace(/<span class="diag">[^<]*<\/span>/g, ''), /http 404|file missing/, 'the raw error rides only in the hidden diagnostics');
  }
  assert.match(D.gigs({ t: T(60), gigs: [] }, NOW, {}), /No gigs yet/);
  const f = FEED();f.gigs = [G({ title: '<img src=x onerror=alert(1)>', pitch: '<script>alert(1)</script>', url: 'javascript:alert(1)', category: '"><b>' })];
  const h = D.gigs(f, NOW, {});
  assert.doesNotMatch(h, /<img|<script>|javascript:|<b>"/);
  assert.match(h, /&lt;img/);
  assert.match(h, /&lt;script&gt;/);
  assert.doesNotThrow(() => D.gigs({ gigs: [null, 3, { title: 7, why: 'x', pitch: 9 }] }, NOW, { page: 'x' }));
});

test('Data sheet input: the gig search, every site with gigs, sites that did not answer, how many were checked, the pay floor', () => {
  const d = D.gigsData(FEED());
  assert.deepEqual(d.sources[0], { name: 'Gig search', gives: '4 gigs', asOf: T(600), state: 'ok' });
  assert.deepEqual(d.sources.slice(1, 4).map((s) => [s.name, s.gives]), [['Upwork', '2 gigs'], ['Contra', '1 gig'], ['Freelancer', '1 gig']]);
  assert.ok(!d.sources.some((s) => s.name === 'Empty'), 'a site with no gigs is not a source');
  assert.ok(d.sources.some((s) => s.name === 'SAM.gov' && s.state === 'unavailable'));
  const m = Object.fromEntries(d.method);
  assert.equal(m.Sites, '85 of 282 checked this run');
  assert.equal(m['Pay floor'], '$150/hr, or $500 for a fixed job');
  assert.match(m.Pitches, /never sends, bids or signs up/);
  assert.equal(D.gigsData(Object.assign(FEED(), { stale: true })).sources[0].state, 'stale');
  assert.deepEqual(D.gigsData(null).sources, [{ name: 'Gig search', gives: 'No gigs read', state: 'unavailable' }]);
});

test('glue: kind and order are remembered, nothing on the Gigs page posts anywhere, the page data is gigsData', () => {
  const g = glue.slice(glue.indexOf('// ---- Work > Gigs'), glue.indexOf('// ---- end Work ----'));
  assert.match(g, /localStorage\.setItem\('gig-kind',GIGV\.kind\)/);
  assert.match(g, /localStorage\.setItem\('gig-sort',GIGV\.sort\)/);
  assert.match(g, /data\(\)\{return DeckUI\.gigsData\(GIGV\.feed\)\}/);
  assert.doesNotMatch(g, /method:'POST'|fetch\(/);
});
