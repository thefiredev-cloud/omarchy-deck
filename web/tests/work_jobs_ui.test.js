// node --test tests/work_jobs_ui.test.js
// Work > Jobs (design v3, PgWork 2026-11-14): the row model, the one control row with the person picker as built, the Filters sheet,
// paging, the detail sheet, the Saved list, the side sections, the Data sheet input and the page glue. No DOM, no network.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const a = src.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const b = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
assert.ok(a >= 0 && b > a);
// Only trusted checkout JavaScript enters the function body. Fixture values stay arguments.
const D = new Function(src.slice(a, b) + '\nreturn DeckUI;')();
const glue = src.slice(b);
const css = fs.readFileSync(path.join(__dirname, '../static/css/work.css'), 'utf8');

const NOW = Date.UTC(2026, 9, 28, 17, 0, 0);
const T = (agoS) => NOW / 1000 - agoS;

const TAX = [
  { slug: 'ai_software', name: 'AI and software', definition: 'Building and running software, with or without models.',
    subs: [{ slug: 'ai_eng', name: 'AI engineering', definition: 'Agents, inference and data pipelines.' },
      { slug: 'platform', name: 'Platform and infra', definition: 'Servers, GPUs and reliability.' }] },
  { slug: 'fire_ems', name: 'Fire and EMS', definition: 'Emergency medical and fire service work.',
    subs: [{ slug: 'paramedic', name: 'Paramedic', definition: 'Advanced life support in the field.' }] },
];
// one listing, contract shape, every field overridable
const L = (o) => Object.assign({
  title: 'Job', company: 'Co', site: 'linkedin', url: 'https://example.com/job', score: 80, posted_at: T(7200),
  flags: [], flag_text: [], note: null, category: 'ai_software', subcategory: 'ai_eng', mode: 'in_person',
  metro: 'south_oc', pay_min: null, pay_max: null, pay_text: null, summary: null, why: [], cluster_take: null,
}, o);
const LISTINGS = () => [
  L({ title: 'AI platform engineer', company: 'Anduril Industries', subcategory: 'platform', pay_min: 150000, pay_max: 200000, score: 93,
    summary: 'Run the training cluster and the agent stack.', why: ['GPU cluster work you already run', 'Costa Mesa, 25 minutes up the 5'],
    cluster_take: 'Strong fit. Local, senior, and the stack matches the home lab.', site: 'ashby', url: 'https://example.com/a7' }),
  L({ title: 'Forward deployed engineer', company: 'OpenAI', mode: 'remote', metro: 'remote', pay_min: 185000, pay_max: 300000, score: 88,
    posted_at: T(14000), flags: ['login_for_match'], flag_text: ['Login needed for match'], site: 'himalayas', url: 'https://example.com/b2' }),
  L({ title: 'Paramedic', company: 'LA County Fire', category: 'fire_ems', subcategory: 'paramedic', metro: 'la', pay_text: '$38.50/hr', score: 71,
    posted_at: T(90000), note: 'Class 168 contact is the hiring captain.', site: 'governmentjobs', url: 'https://example.com/c3' }),
  L({ title: 'Ambulance operator', company: 'Care Ambulance', category: 'fire_ems', subcategory: 'paramedic', metro: 'oc', score: 64,
    posted_at: T(200000), site: 'governmentjobs', url: 'https://example.com/d4' }),
];
const MARKET = { generated_at: T(3600),
  by_category: { ai_software: { total: 2, by_metro: { south_oc: 1, oc: 0, la: 0, sd: 0, remote: 1 }, median_pay_max: 200000, delta_vs_prev: -4,
    remote_unknown_pay_dropped: 3, top_employers: [{ name: 'Anduril Industries', count: 1 }, { name: 'OpenAI', count: 1 }] } },
  by_metro: { south_oc: { total: 55, by_category: {} }, oc: 1, la: 1, sd: 0, remote: 1 } };
const INSIGHT = { t: T(10800), model: 'DeepSeek-V4.1-Flash-1017-EXL3', categories: { ai_software: 'Two strong fits. One local, one remote with real pay.' },
  takes: { 'https://example.com/b2': 'Remote, well paid, and it is the same agent work you already do.' } };
const FEED = () => ({ t: T(600), refresh: 3600, src: ['ashby', 'dice'], by_site: { linkedin: 182, ashby: 953 }, taxonomy: TAX,
  rules: { home: 'Huntington Beach, CA', in_person_metros: ['south_oc', 'oc', 'sd', 'la'], remote_min_pay: 100000, pay_normalization: 'annual USD, hourly x2080' },
  errors: [{ source: 'themuse', reason: 'HTTP 403 from www.themuse.com' }], disabled: [{ source: 'indeed', reason: 'Cloudflare challenge (HTTP 403)' }],
  market: MARKET, listings: LISTINGS() });
const SAVED = (items) => ({ person: 'tanner', items, cap: 500, states: D.SJ_STATES, t: NOW / 1000 });
const rowsOf = (h) => (h.match(/class="frow jitem"/g) || []).length;
const SITES = ['ashby', 'himalayas', 'governmentjobs', 'linkedin', 'themuse', 'indeed'];

// ---------------- the row ----------------
test('row model: title, where, pay as its own value or null, the fit score as one number, and no site or age', () => {
  const [ai, , medic, amb] = LISTINGS();
  assert.deepEqual(D.jobRowModel(ai), { key: 'ai platform engineer|anduril industries|', title: 'AI platform engineer',
    where: 'Anduril Industries \u00B7 South\u00A0OC \u00B7 in\u00A0person', pay: '$150K-$200K', score: 93, url: 'https://example.com/a7' });
  // a metro or mode name never breaks inside itself (layout audit D 24: "in" / "person" at a line end); a source's own place stays plain
  assert.equal(D.jobRowModel(L({ metro: null, location: 'San Juan Capistrano', mode: 'hybrid' })).where.split(' \u00B7 ').slice(1).join('|'), 'San Juan Capistrano|hybrid');
  assert.equal(D.jobRowModel(medic).pay, '$38.50/hr', 'hourly text stays words');
  assert.equal(D.jobRowModel(amb).pay, null, 'no pay stated is null, never a placeholder');
  assert.equal(D.jobRowModel(L({ score: null })).score, null);
  assert.equal(D.jobRowModel(L({ url: 'javascript:alert(1)' })).url, '');
  const r = D.jobRow(ai);
  assert.match(r, /<span class="fl"><b>AI platform engineer<\/b><small>Anduril Industries \u00B7 South\u00A0OC \u00B7 in\u00A0person<\/small><span class="jpay">\$150K-\$200K<\/span><\/span>/);
  assert.match(r, /<span class="fr"><b>93<\/b><small>Fit<\/small><\/span>/);
  assert.match(r, /data-jk="ai platform engineer\|anduril industries\|"/);
  assert.doesNotMatch(r, /ashby|ago|seen|jm"/, 'the site and the repeated age left the row (baseline problem 18)');
  const none = D.jobRow(amb);
  assert.doesNotMatch(none, /jpay|not reported/, 'a row without pay has no pay line');
  assert.doesNotMatch(D.jobRow(L({ score: null })), /class="fr"/, 'no score, no score cell (never "--")');
  assert.match(D.jobRow(L({ score: 0 })), /<b>0<\/b>/, 'a fit of 0 is shown as 0');
  // the reading cues ride inside the row
  assert.match(D.jobRow(LISTINGS()[1]), /<small class="jflags"><span class="pill warn">Login needed for match<\/span><\/small>/);
  // stars only once the saved answer is known
  assert.doesNotMatch(r, /jstar/);
  assert.match(D.jobRow(ai, null), /class="jstar" data-star="ai platform engineer\|anduril industries\|" aria-pressed="false" aria-label="Save job: AI platform engineer"/);
});

test('rows and names are escaped, and only http(s) links open', () => {
  const h = D.jobs({ t: T(60), listings: [L({ title: '<img src=x onerror=alert(1)>', company: '"><b>', url: 'javascript:alert(1)' })] }, {}, NOW, { person: 'tanner' });
  assert.doesNotMatch(h, /<img|javascript:|<b>"/);
  assert.match(h, /&lt;img/);
  assert.match(h, /&quot;&gt;&lt;b&gt;/);
});

// ---------------- the control row ----------------
test('control row: the person picker exactly as built (four people, Morgan included), then Saved, then one Filters button the shell can move', () => {
  const t = D.jobs(FEED(), {}, NOW, { person: 'tanner', page: 12, saved: SAVED([]) });
  assert.match(t, /^<div class="fbar jfbar" data-wk="ctl"><div class="fbar-top jctl"><div class="chips" id="jperson" role="group" aria-label="Whose job search"><button type="button" class="b jchip jpers on" data-person="tanner" aria-pressed="true">Tanner<\/button><button type="button" class="b jchip jpers" data-person="riley" aria-pressed="false">Riley<\/button><button type="button" class="b jchip jpers" data-person="casey" aria-pressed="false">Casey<\/button><button type="button" class="b jchip jpers" data-person="morgan" aria-pressed="false">Morgan<\/button><button type="button" class="b jchip jsaved" data-saved="1" aria-pressed="false">Saved 0<\/button><\/div><button type="button" class="btn fbar-open" data-open-fbar="jobs" aria-haspopup="dialog" aria-label="Filters"><svg class="i" aria-hidden="true"><use href="#i-filter"\/><\/svg><span class="fbw">Filters<\/span><\/button><\/div><\/div>/);
  assert.deepEqual(D.JOB_PEOPLE.map((p) => p.id), ['tanner', 'riley', 'casey', 'morgan']);
  // Morgan's list is read-only: no Saved chip, no stars, the picker otherwise the same
  const l = D.jobs(FEED(), {}, NOW, { person: 'morgan' });
  assert.match(l, /data-person="morgan" aria-pressed="true">Morgan</);
  assert.doesNotMatch(l, /data-saved|jstar/);
  assert.equal(D.jobPerson('morgan').saved, false);
  // no site chips anywhere on the page
  assert.doesNotMatch(t, /data-site|jsites|Site filter/);
  // the Filters button counts what differs from the defaults
  assert.match(D.jobs(FEED(), { cat: 'fire_ems', metro: 'la', sort: 'new' }, NOW, { person: 'tanner' }), /data-open-fbar="jobs" aria-haspopup="dialog" aria-label="Filters, 3 set"><svg[^]*?<\/svg><span class="fbw">Filters<\/span> <span class="cnt">3<\/span><\/button>/);
  // the three parts the glue swaps while the dialog is open
  assert.match(t, /<\/div><\/div><dialog class="sheet wkdlg" id="fb-jobs" aria-label="Filters">[\s\S]*<\/dialog><div data-wk="body">/);
});

test('page: the list comes first in a TV board across the page, untitled until a filter narrows it; Market and By category follow it; no source text', () => {
  const h = D.jobs(FEED(), {}, NOW, { person: 'tanner', page: 12, insight: INSIGHT });
  assert.ok(h.indexOf('class="flist jlist"') < h.indexOf('jmkt'), 'jobs before the side sections');
  assert.match(h, /<div data-wk="body"><div class="g12 jgrid"><section class="sect jmain board"><div class="flist jlist">/, 'no title row above the first job');
  assert.match(h, /<\/section><div class="jside"><section class="sect jmkt">/, 'the side blocks follow the list, never a half column beside it');
  assert.equal(rowsOf(h), 4);
  assert.match(h, /<p class="note sm jcount" role="status">Showing 4 of 4<\/p>/);
  const body = h.slice(h.indexOf('data-wk="body"'));
  for (const s of SITES) assert.doesNotMatch(body, new RegExp(s, 'i'), 'no site name on the page: ' + s);
  assert.doesNotMatch(h, /\.json|computed from|model|DeepSeek| ago\b|Updated|Not reporting/i);
  assert.doesNotMatch(h, /almanac|surf|hockey|photo/i, 'the page opens on jobs (baseline problem 17)');
  assert.match(D.jobs(FEED(), { cat: 'fire_ems', sub: 'paramedic', metro: 'la', sort: 'new' }, NOW, { person: 'tanner' }), /<section class="sect jmain board"><h2 class="secttl"><span>Fire and EMS \u00B7 Paramedic \u00B7 LA \u00B7 Newest<\/span><\/h2>/);
  // Show more is a secondary button, never the signal-filled primary (review W9)
  const many = D.jobs({ t: T(60), listings: Array.from({ length: 20 }, (_, i) => L({ title: 'J' + i })) }, {}, NOW, { person: 'tanner', page: 12 });
  assert.match(many, /<div class="more-row"><button type="button" class="btn" data-more="jobs">Show 8 more<\/button><\/div>/);
  assert.doesNotMatch(many.slice(many.indexOf('data-wk="body"')), /btn-primary/);
});

test('market and categories: only the collector\'s numbers, the cluster read for the chosen category, no ages or labels about the feed', () => {
  const m = D.jobMarket(FEED(), 'ai_software', 'AI and software', { insight: INSIGHT });
  assert.match(m, /<h2 class="secttl"><span>Market<\/span><span>AI and software<\/span><\/h2>/);
  // one set of bars from zero with a head that says what is counted (SeeViz V20); Remote is plain Remote, its floor lives in Filters
  assert.match(m, /<h3 class="jmh">Jobs found, by area<\/h3><div class="hbars"><div class="hbar"><span>South OC<\/span><div><i style="--v:100%"><\/i><b>1<\/b><\/div><\/div>/);
  assert.deepEqual([...m.matchAll(/<div class="hbar"><span>([^<]+)<\/span>/g)].map((x) => x[1]), ['South OC', 'OC', 'LA', 'SD', 'Remote']);
  assert.match(m, /<span>Remote<\/span><div><i style="--v:100%"><\/i><b>1<\/b>/);
  assert.doesNotMatch(m, /\$100k|<dt>(South OC|OC|LA|SD|Remote)</, 'no bare counts in a list, no pay floor inside a place name');
  // the collector's median of every job it found in the category is back, named apart from By category's median of the listed rows
  assert.match(m, /<dl class="kv"><div><dt>Median top pay, every job found<\/dt><dd>\$200K<\/dd><\/div><div><dt>Since the last run/);
  assert.equal((m.match(/Median top pay/g) || []).length, 1, 'once in Market, never per area');
  assert.doesNotMatch(D.jobMarket(FEED(), '', '', {}), /Median top pay/, 'the whole market carries no median from the collector, so none is shown');
  assert.match(m, /<dt>Since the last run<\/dt><dd>\u22124<\/dd>/);
  assert.match(m, /<dt>Remote left out, pay unknown<\/dt><dd>3<\/dd>/);
  assert.match(m, /Hiring most: Anduril Industries, OpenAI/);
  assert.match(m, /<p class="jtake">Two strong fits/);
  assert.doesNotMatch(m, /DeepSeek|ago/);
  // whole-market metro entries given as {total, by_category} still draw a bar; a zero is a bar of zero, never "--"
  const all = D.jobMarket(FEED(), '', '', {});
  assert.match(all, /<span>South OC<\/span><div><i style="--v:100%"><\/i><b>55<\/b>/);
  assert.match(all, /<span>SD<\/span><div><i style="--v:0%"><\/i><b>0<\/b>/);
  assert.doesNotMatch(all, /--"|>--</);
  assert.equal(D.jobMarket({ listings: [] }, '', '', {}), '');
  const c = D.jobCats(FEED(), NOW);
  assert.equal((c.match(/median top pay/gi) || []).length, 1 + 2, 'one visible column head; each figure keeps the words only for a screen reader');
  assert.match(c, /<h2 class="secttl"><span>By category<\/span><\/h2><p class="jch" aria-hidden="true"><span>Category<\/span><span>Median top pay, jobs shown here<\/span><\/p><div class="flist">/);
  assert.match(c, /<b>All jobs<\/b><small>4 jobs \u00B7 4 new this week<\/small><\/span><span class="fr"><b>\$250K<\/b><small class="vh">median top pay<\/small>/);
  assert.match(c, /<b>Fire and EMS<\/b><small>2 jobs \u00B7 2 new this week<\/small><\/span><\/div>/, 'no stated pay, no pay cell');
  assert.doesNotMatch(D.jobCats({ listings: [L({})] }, NOW), /jch/, 'no pay anywhere, no pay column head');
  assert.match(D.jobCats({ listings: [L({ posted_at: T(86400 * 10) })] }, NOW), /<small>1 job<\/small>/, 'an older posting is not new this week');
  // a first-seen date is not a posting date
  assert.match(D.jobCats({ listings: [L({ posted_basis: 'first_seen' })] }, NOW), /<small>1 job<\/small>/);
  const many = { listings: ['a', 'a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => L({ title: 'J' + i, category: 'cat_' + k })) };
  assert.match(D.jobCats(many, NOW), /<summary class="btn btn-quiet" tabindex="0">2 more categories<\/summary>/);
});

// ---------------- filters ----------------
test('filters sheet: whose search (shown on L), Saved (P and L), category, sub-category, where and order with counts; Clear; Show N jobs', () => {
  const all = D.jobs(FEED(), { cat: 'ai_software' }, NOW, { person: 'tanner', saved: SAVED([]) });
  const f = all.slice(all.indexOf('<dialog'), all.indexOf('</dialog>'));
  assert.match(f, /<section class="sh-sec wk-who"><h3>Whose search<\/h3><div class="chips" role="group" aria-label="Whose job search"><button type="button" class="b jchip jpers on" data-person="tanner"[^>]*>Tanner<\/button>[\s\S]*data-person="morgan"[^>]*>Morgan<\/button><\/div><\/section>/);
  assert.doesNotMatch(f, /id="jperson"/, 'the sheet copy of the picker carries no duplicate id');
  assert.match(f, /<section class="sh-sec wk-sv"><h3>Saved<\/h3><div class="chips"><button type="button" data-saved="1" aria-pressed="false">Saved jobs <small>0<\/small><\/button><\/div><\/section>/);
  assert.match(f, /<h3>Category<\/h3><div class="chips" id="jcat" role="group" aria-label="Category"><button type="button" data-jcat="all" aria-pressed="false">All <small>4<\/small><\/button><button type="button" data-jcat="ai_software" class="on" aria-pressed="true">AI and software <small>2<\/small><\/button>/);
  assert.match(f, /<h3>AI and software<\/h3><div class="chips" id="jsub"/);
  assert.match(f, /data-jsub="platform" aria-pressed="false">Platform and infra <small>1<\/small>/);
  assert.match(f, /<h3>Where<\/h3>[\s\S]*data-jmetro="remote" aria-pressed="false">Remote</);
  assert.match(f, /<h3>Pay at least<\/h3>[\s\S]*<\/div><p class="note sm">Remote jobs show here only when they pay \$100K or more\.<\/p><\/section>/);
  assert.match(f, /<div class="seg" id="jsort" role="group" aria-label="Order"><button type="button" data-jsort="fit" class="on"/);
  assert.match(f, /<footer class="sheet-a"><button type="button" class="btn" data-jclear>Clear<\/button><button type="button" class="btn btn-primary" data-close>Show 2 jobs<\/button><\/footer>/);
  assert.doesNotMatch(f, /data-site|Site|jobs\.json|listings/);
  assert.doesNotMatch(f, /data-(cat|sub|metro)=/, 'filter attributes never collide with the shell\'s data-sub tabs');
  assert.match(D.jobs(FEED(), { cat: 'fire_ems', metro: 'la' }, NOW, { person: 'tanner' }), /data-close>Show 1 job<\/button>/);
  assert.doesNotMatch(D.jobs(FEED(), {}, NOW, { person: 'morgan' }), /wk-sv/, 'no Saved section without a tracker');
  const down = D.jobs(null, {}, NOW, { person: 'tanner' });
  assert.doesNotMatch(down.slice(down.indexOf('<dialog'), down.indexOf('</dialog>')), /jcat|data-jclear/);
  assert.match(down, /data-close>Close<\/button>/);
});

test('filters: a remembered site, a stale sub-category or a metro the feed lacks never hides listings unseen', () => {
  const st = D.jobStateOf(FEED(), D.jobFacets(FEED()), D.jobTax(FEED()), { site: 'ashby', cat: 'ai_software', sub: 'paramedic' });
  assert.equal(st.sub, 'all', 'a sub-category from another category is ignored');
  assert.equal('site' in st, false);
  assert.equal(D.jobFilter(FEED(), { site: 'ashby' }).length, 4, 'the site filter is gone');
  const noMetro = { t: T(60), listings: [L({ metro: '' }), L({ title: 'B', metro: '' })] };
  assert.equal(D.jobStateOf(noMetro, D.jobFacets(noMetro), [], { metro: 'la' }).metro, 'all');
  assert.equal(rowsOf(D.jobs(noMetro, { metro: 'la' }, NOW, { person: 'tanner' })), 2);
  assert.deepEqual(D.jobFilter(FEED(), { sort: 'new' }).map((x) => x.title), ['AI platform engineer', 'Forward deployed engineer', 'Paramedic', 'Ambulance operator']);
  assert.deepEqual(D.jobFilter(FEED(), { cat: 'fire_ems' }).map((x) => x.title), ['Paramedic', 'Ambulance operator'], 'Best fit keeps the collector order');
});

// ---------------- posted, pay floor, search (round "Better": SeeFlows F7, SeeAccess A14) ----------------
// two more listings: a remote one posted ten days ago, and a remote one the search only first saw (no posting date)
const F7FEED = () => { const f = FEED(); f.listings.push(
  L({ title: 'Old remote', company: 'Old Co', metro: 'remote', mode: 'remote', pay_min: 120000, pay_max: 160000, posted_at: T(86400 * 10) }),
  L({ title: 'Seen remote', company: 'Seen Co', metro: 'remote', mode: 'remote', pay_min: 200000, pay_max: 260000, posted_at: T(600), posted_basis: 'first_seen' })); return f; };

test('F7: Posted (Last 24 hours, 7 days, Any time) and Pay at least narrow the list; a first-seen date never counts; no stated pay never passes a floor', () => {
  const titles = (f) => D.jobFilter(F7FEED(), f, NOW).map((x) => x.title);
  assert.equal(titles({}).length, 6);
  assert.deepEqual(titles({ days: '1' }), ['AI platform engineer', 'Forward deployed engineer'], 'today is the last 24 hours');
  assert.deepEqual(titles({ days: '7' }), ['AI platform engineer', 'Forward deployed engineer', 'Paramedic', 'Ambulance operator']);
  assert.deepEqual(titles({ pay: '150000' }), ['AI platform engineer', 'Forward deployed engineer', 'Old remote', 'Seen remote'], 'the top of the range reaches the floor');
  assert.deepEqual(titles({ pay: '250000' }), ['Forward deployed engineer', 'Seen remote']);
  // the owner's task (SeeFlows T8): a remote job posted this week above a pay floor, newest first
  assert.deepEqual(titles({ metro: 'remote', days: '7', pay: '150000', sort: 'new' }), ['Forward deployed engineer']);
  assert.equal(titles({ days: '3', pay: '99' }).length, 6, 'a value the sheet never offers filters nothing');
  assert.equal(D.jobFilter({ listings: [L({ pay_min: 60000, pay_max: null, pay_from: true })] }, { pay: '50000' }, NOW).length, 1, 'a "from" pay counts its floor');

  const h = D.jobs(F7FEED(), { metro: 'remote', days: '7', pay: '150000' }, NOW, { person: 'tanner' });
  assert.equal(rowsOf(h), 1);
  assert.match(h, /data-open-fbar="jobs" aria-haspopup="dialog" aria-label="Filters, 3 set"><svg[^]*?<\/svg><span class="fbw">Filters<\/span> <span class="cnt">3<\/span>/);
  assert.match(h, /<h2 class="secttl"><span>All jobs \u00B7 Remote \u00B7 Last 7 days \u00B7 \$150K\+<\/span><\/h2>/);
  const f = h.slice(h.indexOf('<dialog'), h.indexOf('</dialog>'));
  assert.match(f, /<h3>Posted<small> \u00B7 1 with no posting date left out<\/small><\/h3><div class="chips" id="jdays" role="group" aria-label="Posted"><button type="button" data-jdays="1" aria-pressed="false">Last 24 hours <small>2<\/small><\/button><button type="button" data-jdays="7" class="on" aria-pressed="true">7 days <small>4<\/small><\/button><button type="button" data-jdays="all" aria-pressed="false">Any time<\/button><\/div>/);
  assert.match(f, /<h3>Pay at least<\/h3><div class="chips" id="jpay" role="group" aria-label="Pay at least"><button type="button" data-jpay="all" aria-pressed="false">Any<\/button><button type="button" data-jpay="50000" aria-pressed="false">\$50K\+ <small>4<\/small><\/button>/);
  assert.match(f, /data-jpay="150000" class="on" aria-pressed="true">\$150K\+ <small>4<\/small>[\s\S]*data-jpay="250000" aria-pressed="false">\$250K\+ <small>2<\/small>/);
  assert.match(f, /data-close>Show 1 job<\/button>/);
  // the short groups lead the sheet, so a phone reaches the task's controls above the sheet's footer, before the long category lists
  const heads = [...f.matchAll(/<h3>([^<]+)/g)].map((x) => x[1]).filter((x) => x !== 'Whose search' && x !== 'Saved');
  assert.deepEqual(heads, ['Posted', 'Order', 'Where', 'Pay at least', 'Search', 'Category']);
  // a floor no listing reaches is not offered; a feed with no stated pay has no Pay group
  const low = D.jobs({ t: T(60), listings: [L({ pay_min: 40000, pay_max: 60000 })] }, {}, NOW, { person: 'tanner' });
  assert.match(low, /data-jpay="50000"/);
  assert.doesNotMatch(low, /data-jpay="100000"/);
  assert.doesNotMatch(D.jobs({ t: T(60), listings: [L({})] }, {}, NOW, { person: 'tanner' }), /Pay at least/);
  // the Data sheet says what the two filters mean
  const m = Object.fromEntries(D.jobsData(FEED(), { person: 'tanner' }).method);
  assert.match(m.Posted, /^Last 24 hours[\s\S]*first-seen date never counts, and the list says how many that leaves out$/);
  assert.match(m['Pay at least'], /no stated pay is left out, and the list says how many/);
  assert.match(D.jobs(F7FEED(), { days: '1' }, NOW, { person: 'tanner' }), /<h2 class="secttl"><span>All jobs \u00B7 Last 24 hours<\/span><\/h2>/);
  // glue: the chips set and remember days and pay; Clear resets them; the search words are never remembered
  assert.match(glue, /else if\(d\.jdays!=null\)jobFilterSet\(\{days:d\.jdays\}\);else if\(d\.jpay!=null\)jobFilterSet\(\{pay:d\.jpay\}\)/);
  assert.match(glue, /const JOB_CLEAR=\{cat:'all',sub:'all',metro:'all',days:'all',pay:'all',q:'',sort:'fit'\};/);
  assert.match(glue, /delete k\.q;localStorage\.setItem\(jobFilterKey\(V6\.person\)/);
  const js = new Function('localStorage', 'DeckUI', glue.slice(glue.indexOf('function jobPersonOk'), glue.indexOf('const feedGet=')) + '\nreturn jobState;');
  const store = { 'job-filter': JSON.stringify({ metro: 'remote', days: '7', pay: '150000', q: 'agent', sort: 'new' }) };
  assert.deepEqual(js({ getItem: (k) => store[k] || null }, D)('tanner'), { cat: 'all', sub: 'all', metro: 'remote', days: '7', pay: '150000', sort: 'new' });
});

test('review of #365: a pay floor or a Posted window never drops rows unsaid; the count line and the sheet say how many', () => {
  // a floor: the two rows with no stated pay (one with only hourly words) are named as left out, in the count line and under Pay
  const pay = D.jobs(F7FEED(), { pay: '50000' }, NOW, { person: 'tanner' });
  assert.equal(rowsOf(pay), 4);
  assert.match(pay, /<p class="note sm jcount" role="status">Showing 4 of 4 \u00B7 2 with no stated pay left out<\/p>/);
  assert.match(pay, /<h3>Pay at least<small> \u00B7 2 with no stated pay left out<\/small><\/h3>/);
  assert.match(pay, /<h3>Posted<\/h3>/, 'no window, nothing said under Posted');
  // a window: the row that only has a first-seen date (Newest ranks it by that date) is named as left out, in the count line and under Posted
  const day = D.jobs(F7FEED(), { days: '1' }, NOW, { person: 'tanner' });
  assert.match(day, /Showing 2 of 2 \u00B7 1 with no posting date left out<\/p>/);
  assert.match(day, /<h3>Posted<small> \u00B7 1 with no posting date left out<\/small><\/h3>/);
  // counted among the rows the other filters keep
  const both = D.jobs(F7FEED(), { metro: 'remote', days: '7', pay: '150000' }, NOW, { person: 'tanner' });
  assert.match(both, /Showing 1 of 1 \u00B7 1 with no posting date left out<\/p>/);
  assert.deepEqual(D.jobLeftOut(F7FEED(), { metro: 'remote', days: '7', pay: '150000' }, NOW), { pay: 0, date: 1 });
  assert.deepEqual(D.jobLeftOut(F7FEED(), { days: '7', pay: '150000' }, NOW), { pay: 2, date: 1 });
  // no floor and no window: nothing is said
  const none = D.jobs(F7FEED(), {}, NOW, { person: 'tanner' });
  assert.match(none, /Showing 6 of 6<\/p>/);
  assert.doesNotMatch(none, /left out/);
  // nothing matches: the empty state still says what was left out
  assert.match(D.jobs(F7FEED(), { metro: 'la', pay: '250000' }, NOW, { person: 'tanner' }), /No jobs match these filters<\/b><span class="es-l">Loosen a filter to see more\. 1 with no stated pay left out\.<\/span>/);
});

test('D14: a pay the source gives only as a floor reads "from", never as an exact salary; without the mark nothing changes', () => {
  assert.equal(D.jobPay(L({ pay_min: 43680, pay_max: null, pay_from: true, pay_text: 'Starting at $21.00 per hour' })), 'from $44K');
  assert.equal(D.jobRowModel(L({ pay_min: 43680, pay_max: null, pay_from: true })).pay, 'from $44K');
  assert.equal(D.jobPay(L({ pay_min: 43680, pay_max: null })), '$44K+');
  assert.equal(D.jobPay(L({ pay_min: 150000, pay_max: 200000, pay_from: true })), '$150K-$200K', 'a full range is a range');
});

test('A14: the Filters sheet searches title, employer and place, and `/` opens Filters and lands in that field', () => {
  assert.deepEqual(D.jobFilter(FEED(), { q: 'openai' }).map((x) => x.title), ['Forward deployed engineer']);
  assert.deepEqual(D.jobFilter(FEED(), { q: '  County   PARAMEDIC ' }).map((x) => x.title), ['Paramedic'], 'every word, any case, any spacing');
  assert.equal(D.jobFilter(FEED(), { q: 'engineer anduril' }).length, 1);
  const h = D.jobs(FEED(), { q: 'x"><b>' }, NOW, { person: 'tanner' });
  assert.match(h, /<h3>Search<\/h3><input type="search" class="jq" name="jq" data-jq value="x&quot;&gt;&lt;b&gt;" placeholder="Title or company" aria-label="Search jobs by title or company"/);
  assert.match(h, /No jobs match these filters/);
  assert.match(h, /<span class="fbw">Filters<\/span> <span class="cnt">1<\/span>/);
  // the glue narrows as the reader types, and the repaint gives the field its focus and caret back
  assert.match(glue, /function jobsInput\(e\)\{[^}]*matches\('input\[data-jq\]'\)/);
  assert.match(glue, /workBind\(c\.el,jobsInput,'input'\)/);
  assert.match(glue, /const f=typed&&dlg\.querySelector\('input\[name="'\+typed\.name\+'"\]'\);if\(f\)\{f\.focus\(\)/);
  // app.js searchField, run on stand-in elements: inline field first; else the search inside the page's Filters dialog
  const app = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
  const at = app.indexOf('function searchField'), fn = app.slice(at, app.indexOf("document.addEventListener('keydown'", at));
  assert.ok(at > 0 && fn.length > 100);
  const Q = '.search input,input[type="search"]';
  const node = (o) => Object.assign({ shown: true, getClientRects() { return this.shown ? [1] : []; }, closest: () => null }, o);
  const world = ({ inline, inlineDialog }) => {
    const dlg = node({ id: 'fb-jobs', open: false }), inp = node({ shown: !!inlineDialog, closest: (s) => (s === 'dialog' ? dlg : null) });
    dlg.querySelector = (s) => (s === Q ? inp : null);
    const btn = node({ clicks: 0, click() { this.clicks++; dlg.open = true; inp.shown = true; } });
    const own = inline ? [node({})] : [];
    const pg = { querySelectorAll: (s) => (s === Q ? own.concat([inp]) : s === 'dialog[id^="fb-"]' ? [dlg] : []) };
    const doc = { querySelectorAll: (s) => (s === '[data-open-fbar="jobs"]' ? [btn] : []) };
    return { run: new Function('PAGES', 'page', 'document', fn + '\nreturn searchField();')([pg], 0, doc), inp, btn, own };
  };
  const a = world({ inline: true });
  assert.equal(a.run, a.own[0], 'an inline search wins');
  assert.equal(a.btn.clicks, 0);
  const b = world({});
  assert.equal(b.run, b.inp, 'no inline search: the Filters search');
  assert.equal(b.btn.clicks, 1, 'opened through its own Filters button');
  const c = world({ inlineDialog: true });
  assert.equal(c.run, c.inp, 'a Filters panel shown inline is used as it is');
  assert.equal(c.btn.clicks, 0);
  const none = new Function('PAGES', 'page', 'document', fn + '\nreturn searchField();')([{ querySelectorAll: () => [] }], 0, { querySelectorAll: () => [] });
  assert.equal(none, null);
});

test('TV: "5 more categories" and "Draft pitch" are stops for the remote (SeeAccess A16)', () => {
  const tv = fs.readFileSync(path.join(__dirname, '../static/tv.js'), 'utf8');
  const sel = /const FOCUSABLE = '([^']+)'/.exec(tv)[1];
  assert.ok(sel.split(',').includes('[tabindex]:not([tabindex="-1"])'), 'the remote takes any element with a tabindex of 0');
  const many = { listings: ['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => L({ title: 'J' + i, category: 'cat_' + k })) };
  assert.match(D.jobCats(many, NOW), /<details class="jmore"><summary class="btn btn-quiet" tabindex="0">/);
  const gig = { t: T(60), gigs: [{ id: 'g', title: 'Gig', url: 'https://example.com/g', pitch: 'Hello' }] };
  assert.match(D.gigs(gig, NOW, {}), /<details class="gpitch"><summary tabindex="0">Draft pitch<\/summary>/);
});

// ---------------- paging ----------------
test('paging: opens on 12, Show more reaches every listing up to the cap 48 at a time, and the count line is right at every step', () => {
  assert.equal(D.JOB_CAP, 1200, 'the cap is the server cap');
  assert.deepEqual([D.JOB_SHORT % 12, D.JOB_STEP % 12], [0, 0], 'every page size a multiple of 12, so rows come out whole at one to six columns');
  for (const n of [9, 13, 62, 400, 1200, 1300]) {
    const feed = { t: T(30), listings: Array.from({ length: n }, (_, i) => L({ title: 'Job ' + i })) };
    let page = D.JOB_SHORT, taps = 0;
    const reach = Math.min(n, D.JOB_CAP), num = (x) => x.toLocaleString('en-US');
    for (;;) {
      const h = D.jobs(feed, {}, NOW, { person: 'tanner', page });
      const shown = rowsOf(h);
      assert.equal(shown, Math.min(n, page), 'jobs ' + n + ' at ' + page);
      assert.match(h, new RegExp('Showing ' + num(shown) + ' of ' + num(n) + '<'));
      const m = /data-more="jobs">Show (\d+) more/.exec(h);
      if (!m) break;
      const next = D.jobNext(page, false);
      assert.equal(+m[1], Math.min(next, reach) - shown, 'the button says exactly what the tap adds');
      page = next;
      taps++;
    }
    assert.equal(taps, Math.ceil(Math.max(0, reach - D.JOB_SHORT) / D.JOB_STEP));
    if (page > D.JOB_SHORT) assert.match(D.jobs(feed, {}, NOW, { person: 'tanner', page }), /data-less="1" data-more="jobs">Show fewer/);
  }
  assert.equal(D.jobNext(312, true), D.JOB_SHORT);
  assert.equal(D.jobNext(NaN, false), D.JOB_SHORT);
});

// ---------------- empty and stale states ----------------
test('states: Tanner\'s feed down says so with one Try again; anyone else is a calm not set up yet; empty and filtered-out lists say what to do', () => {
  for (const f of [null, { error: 'http 404' }, { error: 'file missing', stale: true }]) {
    const t = D.jobs(f, {}, NOW, { person: 'tanner' });
    assert.match(t, /Jobs are not reporting/);
    assert.equal((t.match(/data-retry="jobs"/g) || []).length, 1);
    assert.match(t, /data-person="tanner" aria-pressed="true"/, 'the picker stays so another list is one tap away');
    assert.doesNotMatch(t.replace(/<span class="diag">[^<]*<\/span>/g, ''), /http 404|file missing/, 'the raw error rides only in the hidden diagnostics');
    for (const [id, label, pron] of [['riley', 'Riley', 'his'], ['casey', 'Casey', 'his'], ['morgan', 'Morgan', 'her']]) {
      const p = D.jobs(f, {}, NOW, { person: id });
      assert.match(p, new RegExp('No jobs feed for ' + label + ' yet'));
      assert.match(p, new RegExp('after ' + pron + ' first search runs'));
      assert.match(p, /es-idle/);
      assert.doesNotMatch(p, /es-bad|not reporting/i);
    }
  }
  assert.match(D.jobs({ t: T(60), listings: [] }, {}, NOW, { person: 'tanner' }), /No job listings yet/);
  assert.match(D.jobs({ t: T(60), listings: [] }, {}, NOW, { person: 'casey' }), /No jobs for Casey yet/);
  const none = D.jobs(FEED(), { cat: 'fire_ems', metro: 'remote' }, NOW, { person: 'tanner' });
  assert.match(none, /No jobs match these filters/);
  assert.match(none, /<button type="button" class="btn" data-jclear>Clear filters<\/button>/);
  // a stale feed still lists its jobs; the page's one mark carries the state (glue: workMark)
  assert.equal(rowsOf(D.jobs(Object.assign(FEED(), { stale: true }), {}, NOW, { person: 'tanner' })), 4);
  // junk never throws and never injects markup
  for (const j of [{ listings: 'x' }, { listings: [null, 3, 'x', { title: 7 }] }, { taxonomy: 'x', listings: [L({ category: { a: 1 } })] }])
    assert.doesNotThrow(() => D.jobs(j, { cat: '<b>' }, NOW, { person: 'tanner', saved: { items: 'x' } }));
  assert.doesNotThrow(() => D.jobSheetOpts(L({ why: 'x', flags: 'x', flag_text: [1] }), { taxonomy: 7 }, { track: true, saved: { state: 9 } }));
});

// ---------------- the detail sheet ----------------
test('sheet: where, pay and date, why it fits, summary, cluster take, category, note; Open posting is the primary action; no site or model', () => {
  const s = D.jobSheetOpts(LISTINGS()[0], FEED(), { insight: INSIGHT });
  assert.equal(s.title, 'AI platform engineer');
  assert.equal(s.sub, 'Anduril Industries \u00B7 South\u00A0OC \u00B7 in\u00A0person');
  assert.equal(s.actions, '<a class="btn btn-primary" href="https://example.com/a7" target="_blank" rel="noopener noreferrer">Open posting</a>');
  assert.match(s.body, /<dl class="kv"><div><dt>Pay<\/dt><dd>\$150K-\$200K<\/dd><\/div><div><dt>Posted<\/dt><dd>Oct 28<\/dd><\/div><\/dl>/);
  assert.match(s.body, /<h3>Why it fits<\/h3><ul class="jwhy"><li>GPU cluster work you already run<\/li>/);
  assert.match(s.body, /<h3>Summary<\/h3><p class="prose">Run the training cluster/);
  assert.match(s.body, /<h3>Local cluster take<\/h3><p class="prose">Strong fit\./);
  assert.match(s.body, /<h3>AI and software<\/h3><p class="note">Building and running software[^<]*<\/p><p class="note"><b>Platform and infra\.<\/b> Servers, GPUs and reliability\.<\/p>/);
  assert.doesNotMatch(s.body + s.sub, /ashby|DeepSeek| ago/);
  // the sheet formats pay like the row, not the feed's raw string, and says the date once (review W7)
  const raw = D.jobSheetOpts(L({ pay_min: 165000, pay_max: 200000, pay_text: '$165000 - $200000 per annum', posted_at: T(3600), why: ['Orange County', 'Posted today'] }), FEED(), {}).body;
  assert.match(raw, /<dt>Pay<\/dt><dd>\$165K-\$200K<\/dd>/);
  assert.doesNotMatch(raw, /per annum|Posted today/);
  assert.equal((raw.match(/Posted/g) || []).length, 1);
  assert.match(D.jobSheetOpts(L({ pay_text: '$38.50/hr' }), FEED(), {}).body, /<dd>\$38\.50\/hr<\/dd>/, 'hourly words stay');
  // the take comes from jobs-insight when the listing has none
  assert.match(D.jobSheetOpts(LISTINGS()[1], FEED(), { insight: INSIGHT }).body, /Remote, well paid/);
  assert.match(D.jobSheetOpts(LISTINGS()[1], FEED(), {}).body, /<p class="jflags"><span class="pill warn">Login needed for match<\/span><\/p>/);
  assert.match(D.jobSheetOpts(LISTINGS()[2], FEED(), {}).body, /<h3>Your note<\/h3><p class="prose">Class 168/);
  assert.match(D.jobSheetOpts(L({ posted_basis: 'first_seen' }), FEED(), {}).body, /<dt>First seen<\/dt><dd>Oct 28<\/dd>/);
  const bare = D.jobSheetOpts({ title: 'Closer' }, null, {});
  assert.equal(bare.actions, '');
  assert.match(bare.body, /No link for this posting\./);
  assert.match(D.jobSheetOpts(null, null, {}).body, /No listing selected/);
});

test('sheet tracker: one button per state, the current one on, Remove only when saved, the dated trail and the last error', () => {
  const item = { key: 'k', title: 'SDR', state: 'applied', history: [{ state: 'saved', at: T(86400 * 3) }, { state: 'applied', at: T(86400) }] };
  const off = D.jobSheetOpts(L({}), FEED(), { track: true, saved: null }).body;
  assert.match(off, /<h3>Track<\/h3><div class="chips jtrack" role="group" aria-label="Track this job" data-jkey="job\|co\|">/);
  assert.equal((off.match(/data-jstate="/g) || []).length, 5);
  assert.match(off, /Not saved\. Pick a state/);
  const on = D.jobSheetOpts(L({}), FEED(), { track: true, key: 'k', saved: item, trackErr: 'Not saved: bad url' }).body;
  assert.match(on, /<button type="button" class="on" data-jstate="applied" aria-pressed="true">Applied<\/button>/);
  assert.match(on, /data-jstate="remove">Remove</);
  assert.match(on, /Applied Oct 27 \u00B7 Saved Oct 25/);
  assert.match(on, /<p class="note sm jerr" role="status">Not saved: bad url<\/p>/);
  assert.doesNotMatch(D.jobSheetOpts(L({}), FEED(), {}).body, /jtrack/, 'no tracker unless asked');
});

// ---------------- saved ----------------
test('Saved list: every saved posting newest change first, with its trail, even one gone from the feed; errors and empty say so', () => {
  const keep = { key: D.jobKey(LISTINGS()[0]), title: 'AI platform engineer', company: 'Anduril Industries', state: 'applied', updated_at: T(86400), history: [{ state: 'applied', at: T(86400) }] };
  const gone = { key: 'closer|gone co|remote', title: 'Closer', company: 'Gone Co', state: 'interview', updated_at: T(60), url: 'https://example.com/g', history: [{ state: 'saved', at: T(86400 * 5) }, { state: 'interview', at: T(60) }] };
  const h = D.jobs(FEED(), {}, NOW, { person: 'tanner', saved: SAVED([keep, gone]), savedView: true });
  assert.match(h, /class="b jchip jsaved on" data-saved="1" aria-pressed="true">Saved 2</);
  assert.doesNotMatch(h, /data-jfilters/, 'no Filters in the Saved view');
  assert.match(h, /<h2 class="secttl"><span>Saved<\/span><\/h2><p class="note sm">1 applied \u00B7 1 interview<\/p>/);
  assert.ok(h.indexOf('Closer') < h.indexOf('>AI platform engineer<'), 'newest change first');
  assert.match(h, /Interview Oct 28 \u00B7 Saved Oct 23/);
  assert.equal((h.match(/No longer in the live feed/g) || []).length, 1);
  assert.match(h, /<span class="fr"><span class="pill">Interview<\/span><\/span>/);
  assert.doesNotMatch(h, /of 500|kept on this deck/);
  assert.match(D.jobs(null, {}, NOW, { person: 'tanner', saved: SAVED([gone]), savedView: true }), /Closer/, 'the feed being down does not hide the list');
  assert.match(D.jobs(FEED(), {}, NOW, { person: 'tanner', saved: SAVED([]), savedView: true }), /Nothing saved for Tanner yet/);
  const err = D.jobs(FEED(), {}, NOW, { person: 'tanner', saved: { error: 'http 500' }, savedView: true });
  assert.match(err, /Saved jobs are not reporting/);
  assert.doesNotMatch(err.replace(/<span class="diag">[^<]*<\/span>/g, ''), /http 500/, 'the raw error rides only in the hidden diagnostics');
  assert.match(err, /data-saved="1" aria-pressed="true">Saved</, 'the chip stays so the list can be closed');
  const evil = D.jobs(FEED(), {}, NOW, { person: 'tanner', saved: SAVED([{ key: 'x"><img', title: '<b>Evil</b>', company: '<script>', url: 'javascript:alert(1)', state: 'saved' }]), savedView: true });
  assert.doesNotMatch(evil, /<img|<b>Evil|<script>|javascript:/);
});

// ---------------- the Data sheet ----------------
test('Data sheet input: the job sites and their counts, sources that failed, sites turned off, the cluster model, the profile and the method', () => {
  const d = D.jobsData(FEED(), { person: 'tanner', insight: INSIGHT, profile: { pending: [{ bytes: 12 * 1024 ** 3 }, { bytes: 14 * 1024 ** 3 }] } });
  assert.deepEqual(d.sources[0], { name: 'Job search for Tanner', gives: '4 listings', asOf: T(600), state: 'ok' });
  assert.deepEqual(d.sources.slice(1, 4).map((s) => [s.name, s.gives]), [['GovernmentJobs', '2 listings'], ['Ashby', '1 listing'], ['Himalayas', '1 listing']]);
  assert.ok(d.sources.some((s) => s.name === 'Themuse' && s.state === 'unavailable' && s.gives === 'Did not answer this run'));
  assert.ok(d.sources.some((s) => s.name === 'Local cluster read' && s.gives === 'Model DeepSeek-V4.1-Flash-1017-EXL3'));
  assert.deepEqual(d.setup, [{ name: 'Indeed', line: 'Turned off for now', state: 'blocked' }, { name: 'Your interest profile', line: '2 takeout parts still loading (26 GB)', state: 'building' }]);
  const method = Object.fromEntries(d.method);
  assert.equal(method.Remote, 'Only with pay of $100K or more');
  assert.equal(method['In person'], 'South OC, OC, SD, LA');
  assert.equal(method.Pay, 'Yearly; hourly pay times 2,080');
  assert.equal(D.jobsData(Object.assign(FEED(), { stale: true }), {}).sources[0].state, 'stale');
  assert.deepEqual(D.jobsData(null, { person: 'casey' }).sources, [{ name: 'Job search for Casey', gives: 'No listings read', state: 'never' }]);
  assert.equal(D.jobsData(null, { person: 'tanner' }).sources[0].state, 'unavailable');
  assert.equal(D.jobProfileSetup({ pending: [] }), null);
});

// ---------------- glue and CSS ----------------
test('glue: Work registers work/jobs and work/gigs, the old Life lines are gone, and the page loads no surf, hockey, photos or almanac', () => {
  assert.match(glue, /DeckPages\.register\('work\/jobs',\{/);
  assert.match(glue, /DeckPages\.register\('work\/gigs',\{/);
  assert.doesNotMatch(glue, /^oldPage\('(life|gigs)'/m);
  assert.doesNotMatch(glue, /v6Life|v14Gigs|phHtml|#lf[123]|#gg[123]|#jsh|#jfl/);
  const w = glue.slice(glue.indexOf('// ---- Work > Jobs and Work > Gigs'), glue.indexOf('// ---- end Work ----'));
  assert.ok(w.length > 1000);
  assert.doesNotMatch(w, /'surf'|'hockey'|'onthisday'|'photoyears'|almanac/i);
  assert.match(w, /\['jobs','jobs-insight','interest-profile'\]\.map\(feedGet\)/);
  // sheets through the shell, data through the page's data()
  assert.match(w, /DeckShell\.sheet/);
  assert.match(w, /DeckUI\.detail\(/);
  assert.match(w, /data\(\)\{const t=V6\.person==='tanner';return DeckUI\.jobsData\(/);
  assert.match(w, /DeckPages\.mark\(c,/);
  // the person switch is remembered and resets paging; Casey never gets Tanner's cluster take
  assert.match(w, /localStorage\.setItem\('job-person',p\)/);
  assert.match(w, /V6\.job=jobState\(p\);V6\.jobsN=DeckUI\.JOB_SHORT;V6\.jobs=V6\.jobsBy\[p\]\|\|null;paintJobs\(\)/);
  assert.match(w, /insight:V6\.person==='tanner'\?V6\.jobInsight:null/);
  assert.match(w, /const sjFor=p=>DeckUI\.jobPerson\(p\)\.saved\?sjGet\(p\):Promise\.resolve\(undefined\);/);
  // the remembered filter drops the old site key
  const js = new Function('localStorage', 'DeckUI', glue.slice(glue.indexOf('function jobPersonOk'), glue.indexOf('const feedGet=')) + '\nreturn jobState;');
  const store = { 'job-filter': JSON.stringify({ cat: 'fire_ems', site: 'ashby', sort: 'new' }), 'job-site': 'dice' };
  const jobState = js({ getItem: (k) => store[k] || null }, D);
  assert.deepEqual(jobState('tanner'), { cat: 'fire_ems', sub: 'all', metro: 'all', days: 'all', pay: 'all', sort: 'new' });
  // Try again reloads this page
  assert.match(glue, /jobs:\(\)=>jobsLoadAll\(\)/);
  assert.match(glue, /gigs:\(\)=>gigsLoad\(\)/);
});

test('X7: deck.js is served before sign-in, so no comment names the people in the picker; their labels on the page stay as built', () => {
  const comments = src.split('\n').filter((l) => /^\s*\/\//.test(l));
  for (const l of comments) assert.doesNotMatch(l, /\b(Riley|Casey|Morgan)\b|\bbrother\b/, l.trim().slice(0, 100));
  assert.deepEqual(D.JOB_PEOPLE.map((p) => p.label), ['Tanner', 'Riley', 'Casey', 'Morgan'], 'the person picker as built');
});

test('work.css: v3 only; no legacy weights, tiny chips, tracked capitals, orientation rules, fixed heights or inner scrollers', () => {
  assert.doesNotMatch(css, /font-weight:\s*(7|8)\d\d/);
  assert.doesNotMatch(css, /9\.5px|letter-spacing|text-transform/);
  assert.doesNotMatch(css, /orientation|overflow-y|(?<![a-z-])height:\s*\d+(px|vh|dvh)|#life|#gigs|#lf\d|#gg\d/);
  assert.doesNotMatch(css, /var\(--(touch|fg|dim|pa|hair2|surf|lift|accent|raised)\)/, 'no alias tokens from the old deck');
  assert.match(css, /\.jstar,\.jopen\{[^}]*width:var\(--hit\);height:var\(--hit\)/, 'star and open link keep full touch targets');
});
