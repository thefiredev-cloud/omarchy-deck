// Today restore (lane RestoreToday, 2026-11-15): what the redesign dropped comes back one tap away, in sheets. The page keeps its first
// screen; a summary row or tile opens the sheet that holds the detail: reply threads, status, the whole calendar, the day in the Almanac
// with the photo years, and search traffic. Each sheet lists what the feed carries, keeps links safe, and says so when a feed is missing.
// The page draws times in the zone of the device it runs on, and the owner's devices are on Pacific time: every expected time here
// ("Next run, Today, 10:30 am") is Pacific. Pin that zone before any Date is made, so the file passes on a machine in any zone.
process.env.TZ = 'America/Los_Angeles';
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const start = src.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const end = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
const D = new Function(src.slice(start, end) + '\nreturn DeckUI;')();
const glue = src.slice(end);

const NOW = Date.UTC(2026, 10, 15, 18, 0); // Nov 15, 10:00 am Pacific
const T = NOW / 1000;
const text = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const visible = (html) => text(String(html).replace(/<span class="diag">.*?<\/span>/g, ''));
const hrefs = (html) => (String(html).match(/href="[^"]*"/g) || []).map((h) => h.slice(6, -1));
const key = (d) => { const x = new Date(NOW + d * 864e5); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };

// ---- #3 Reply block ----
const G = 'https://mail.google.com/mail/u/0/';
const replyblock = { t: T - 600, date: '2026-11-15', card_for: '09:00', mode: 'run', model: { used: true },
  counts: { drafted: 2, waiting: 4, cap: 2, over_cap: 1, gmail_drafts_after: 210 }, drafts_url: G + '#drafts',
  items: [
    { rank: 1, name: 'Casey Harbor', subject: 'Quote for 12 seats', drafted: true, draft_url: G + '#drafts/r-1', thread_url: G + '#inbox/1a0b' },
    { rank: 2, name: 'Lane Quill', subject: 'Re: Dinner plans', drafted: true, draft_url: G + '#drafts/r-2', thread_url: G + '#inbox/1a0c' },
    { rank: 3, name: 'Pat <b>Evil</b>', subject: '<img src=x onerror=alert(1)>', drafted: false, draft_url: 'https://evil.example/d', thread_url: 'javascript:alert(1)' },
  ] };
const needsWith = (rb) => D.tdNeeds({ products: { t: T - 60, errors: [], needs: [] }, testflight: { apps: [] }, schedules: { groups: [] }, today: { gateway: { ok: true }, mail: { mailboxes: [] } }, replyblock: rb });

test('reply drafts: the Needs you row opens the reply sheet instead of leaving the deck', () => {
  const n = needsWith(replyblock);
  assert.deepEqual(n.items.map((x) => [x.text, x.open, x.url]), [['2 reply drafts ready', 'today-reply', undefined]]);
  const html = D.tdNeedsHtml(n, []);
  assert.match(html, /<button type="button" data-open="today-reply" class="frow need">/);
  assert.doesNotMatch(html, /Casey|Quote|href=/, 'the page shows the count only');
  assert.match(glue, /'today-reply':\['Reply drafts',\(\)=>DeckUI\.tdReplySheet\(TDS\.feeds\.replyblock\)\]/);
});

test('reply sheet: every thread with who, subject, Draft ready or Held, and Gmail-only links to its draft and its thread', () => {
  const h = D.tdReplySheet(replyblock), w = visible(h);
  assert.match(w, /Drafts ready 2 Waiting on you 4 Held 1/);
  assert.match(w, /Written by the local model\./);
  assert.match(w, /Up to 2 drafts a day; 1 thread was held over the cap\./);
  assert.match(w, /Casey Harbor Quote for 12 seats Open draft Open thread Draft ready/);
  assert.match(w, /Lane Quill Re: Dinner plans Open draft Open thread Draft ready/);
  assert.match(w, /Pat <b>Evil<\/b> <img src=x onerror=alert\(1\)> Held/, 'hostile text is shown as text');
  assert.doesNotMatch(h, /<b>Evil|<img/);
  assert.deepEqual(hrefs(h), [G + '#drafts/r-1', G + '#inbox/1a0b', G + '#drafts/r-2', G + '#inbox/1a0c', G + '#drafts'], 'only mail.google.com, and no draft link on a held thread');
  assert.equal((h.match(/target="_blank" rel="noopener noreferrer"/g) || []).length, 5);
  assert.match(w, /Open Gmail drafts 210 drafts in Gmail/);
});

test('reply sheet: no cap line under the cap, an empty block says so, missing counts say No data, a missing feed says it is not reporting', () => {
  const under = D.tdReplySheet({ ...replyblock, counts: { drafted: 2, waiting: 2, cap: 15, over_cap: 0 } });
  assert.doesNotMatch(visible(under), /held over the cap/);
  const none = visible(D.tdReplySheet({ counts: { drafted: 0, waiting: 0 }, items: [] }));
  assert.match(none, /Nothing is waiting on you/);
  assert.match(visible(D.tdReplySheet({ counts: {}, items: [] })), /Drafts ready No data Waiting on you No data/);
  assert.match(visible(D.tdReplySheet({ ...replyblock, mode: 'dry-run' })), /Dry run: nothing was drafted\./);
  for (const bad of [{ error: 'file missing' }, null, { status: 'not_reporting' }]) assert.match(visible(D.tdReplySheet(bad)), /Reply drafts are not reporting/);
});

// ---- #7 and #8 Status ----
const today = { gateway: { ok: true, version: '0.9.4', t: T - 30 },
  mail: { status: 'ok', t: T - 60, mailboxes: [{ role: 'primary', unread: 12, ok: true }, { role: 'personal', unread: 176, ok: true }] },
  cron: { t: T, enabled: 41, paused: 29, failing: [], next: [{ at: T + 1800, name: 'Inbox sweep' }, { at: T + 86400, name: 'Markets Daily Brief' }],
    briefings: [{ at: T + 86400, name: 'Markets Daily Brief' }, { at: T + 86400 + 3600, name: 'Morning Inbox and Briefing' }] } };
const health = { t: T - 100, count: 0, names: [] };

// B1 (owner 2026-11-03): the Status row closes the Alerts strip under Renewals; Cluster is the engine and its nodes only
const alerts = (t, h, miss, n) => D.tdAlertsHtml(n || null, t, h, miss || []).html;
test('Alerts: a clean read is one "No alerts" row that opens the Status sheet, never "Nothing needs you"', () => {
  const h = alerts(today, health);
  assert.equal(visible(h), 'Alerts No alerts Hermes, mail, automations and the fleet check read clean');
  assert.match(h, /<button type="button" class="frow" data-open="today-status" data-key="status"><span class="lead-mark sd ok"/);
  assert.doesNotMatch(visible(h), /Nothing needs you/);
  const c = D.tdCluster({ engine: { status: 'up', served_name: 'Model' }, nodes: [] }, NOW);
  assert.doesNotMatch(c.html, /Status|today-status/, 'Cluster no longer carries the Status row');
  assert.equal(D.tdCluster({ error: 'file missing' }, NOW).html, '', 'a missing cluster is no card');
});

test('Alerts: what is not fine in a few words, two at most and a count for the rest; red for what an agent can fix', () => {
  const bad = { gateway: { ok: false }, mail: { mailboxes: [{ role: 'personal', ok: false }] }, cron: { next: [], failing: ['A', 'B'], enabled: 2, paused: 0 } };
  // a mailbox that needs a relink is an owner step in Needs you, so the Status row does not say it again
  assert.equal(D.tdStatusLine(bad, { count: 2, names: ['disk', 'mcp'] }), 'Hermes not healthy · 2 automations failing and 1 more');
  assert.match(alerts(bad, { count: 2, names: ['disk', 'mcp'] }), /lead-mark sd bad[^]*Status/);
  assert.equal(D.tdStatusLine(today, { count: 1, names: ['disk'] }), '1 fleet problem');
  assert.equal(D.tdStatusLine({ error: 'no answer' }, health), 'Hermes and mail not reporting');
  assert.match(alerts({ error: 'no answer' }, health), /lead-mark sd warn[^]*Hermes and mail not reporting/, 'unknown is not down: a triangle, not red');
  assert.equal(D.tdStatusLine(today, { error: 'bad json' }), 'Fleet check not reporting');
  // with the failing jobs row already in the strip, failing automations are not said twice
  const n = { jobs: { failed: [{ name: 'x' }], over: [], wait: [] } };
  assert.equal(visible(alerts(bad, health, [], n)), 'Alerts 1 scheduled job failing Status Hermes not healthy');
});

// L20: the fleet check writer splits critical from degraded (a camera that needs power at the camera is not an outage)
test('Alerts: a degraded-only fleet check is amber, a critical one red; an older writer without the split reads as before', () => {
  const deg = { t: T - 100, count: 1, names: ['eufy_cam2 offline: needs power at the camera'], critical: 0, degraded: 1 };
  assert.equal(D.tdStatusLine(today, deg), '1 fleet check degraded');
  assert.match(alerts(today, deg), /lead-mark sd warn[^]*1 fleet check degraded/);
  assert.doesNotMatch(alerts(today, deg), /sd bad/);
  const crit = { ...deg, critical: 1, degraded: 0 };
  assert.match(alerts(today, crit), /lead-mark sd bad[^]*1 fleet problem/);
  const old = { t: T - 100, count: 1, names: ['disk'] };
  assert.match(alerts(today, old), /lead-mark sd bad[^]*1 fleet problem/);
  const sheet = visible(D.tdStatusSheet(today, deg, NOW));
  assert.match(sheet, /Fleet problems 1 Degraded/);
  assert.match(sheet, /Fleet check Fleet check Degraded, not an outage 1 degraded eufy_cam2 offline: needs power at the camera$/);
  assert.match(visible(D.tdStatusSheet(today, old, NOW)), /Fleet check Fleet check 1 problem disk$/);
});

test('status sheet: unread per mailbox, automations on, paused, failing and next, the briefings, Hermes and its version, the fleet check', () => {
  const w = visible(D.tdStatusSheet({ ...today, cron: { ...today.cron, failing: ['Inbox sweep'] }, mail: { mailboxes: [...today.mail.mailboxes, { role: 'work', ok: false }, { role: 'spare', ok: true, unread: null }] } },
    { count: 2, names: ['disk pc-desktop 91%', 'backup late'], stale: true }, NOW));
  assert.match(w, /^Hermes Online Unread mail 188 Automations on 41 Fleet problems 2 Mail Primary 12 unread Personal 176 unread Work Needs a relink Offline Spare No data unread/, 'the old block\'s four figures lead');
  assert.match(w, /Automations On 41 Paused 29 Failing Inbox sweep 1 Inbox sweep Next run, Today, 10:30 am Markets Daily Brief Next run, Tomorrow, 10:00 am/);
  assert.match(w, /Briefings Markets Daily Brief Tomorrow, 10:00 am Morning Inbox and Briefing Tomorrow, 11:00 am/);
  assert.match(w, /Hermes Gateway Version 0\.9\.4 Online/);
  assert.match(w, /Fleet check Fleet check Out of date 2 problems disk pc-desktop 91% backup late$/);
  const ok = visible(D.tdStatusSheet(today, health, NOW));
  assert.match(ok, /Failing 0/);
  assert.match(ok, /Fleet check Fleet check All clear$/);
});

test('status sheet: a part that did not report says so, never zero; nothing at all is one not-reporting state', () => {
  const w = visible(D.tdStatusSheet({ gateway: { error: 'gateway unreachable' }, mail: { error: 'no reading' }, cron: { error: 'jobs file not readable' } }, health, NOW));
  assert.match(w, /Mail Mail Not reporting Automations Automations Not reporting Briefings Briefings Not reporting Hermes Gateway Not reporting/);
  assert.doesNotMatch(w, /\b0 unread|On 0/);
  assert.match(visible(D.tdStatusSheet(today, null, NOW)), /Fleet check Fleet check Not reporting$/);
  assert.match(visible(D.tdStatusSheet({ error: 'no answer' }, { error: 'x' }, NOW)), /^Status is not reporting$/);
  const quiet = visible(D.tdStatusSheet({ ...today, cron: { ...today.cron, next: [], briefings: [] } }, health, NOW));
  assert.match(quiet, /Next run Nothing scheduled/);
  assert.match(quiet, /No briefing scheduled/);
});

test('status glue: the page reads /api/health with Today and paints the Alerts strip once the jobs, Hermes, mail and the fleet check answered', () => {
  assert.match(glue, /traffic:'traffic',health:'health',weather:'weather'\}/);
  assert.match(glue, /Promise\.all\(\[P\.products,P\.testflight,P\.schedules,P\.today,P\.replyblock,P\.health\]\)\.then\(alerts\)/);
  assert.match(glue, /const alerts=\(\)=>tdPaint\('alerts',\(\)=>DeckUI\.tdAlertsHtml\(TDS\.needs,F\.today,F\.health,tdAllMiss\(\)\)\)/);
  assert.match(glue, /if\(TDS\.needs\)alerts\(\);/, 'the checks row joins once every part has answered');
  assert.match(glue, /'today-status':\['Status',\(\)=>DeckUI\.tdStatusSheet\(TDS\.feeds\.today,TDS\.feeds\.health,Date\.now\(\)\)\]/);
  // the fleet check never joins the checks row: it has its own words on the Status row
  const n = D.tdNeeds({ products: { t: T, errors: [], needs: [] }, testflight: { apps: [] }, schedules: { groups: [] }, today, replyblock: { counts: { drafted: 0 } } });
  assert.ok(!n.miss.some((m) => /fleet/i.test(m.name)));
});

// L19: the next briefing is the first row of Next on the calendar, its time then the job's name, whatever the job is called now
test('calendar: the next briefing is the first row when Hermes sends one; no briefing field, no row', () => {
  const ev = { t: T - 60, days: [{ date: key(0), events: [{ title: 'Dinner', start: new Date(NOW + 3600e3).toISOString() }] }] };
  const with1 = D.tdCal(ev, null, NOW, { briefing: [{ at: T + 86400 + 3600, name: 'Morning Inbox and Briefing' }, { at: T + 86400, name: 'Tower - Commander brief' }, { at: T - 60, name: 'Past brief' }] }).html;
  assert.match(visible(with1), /^Next on the calendar Next briefing Tomorrow, 10:00 am · Tower - Commander brief Dinner Today/);
  assert.match(with1, /data-open="today-status" data-key="briefing" class="frow tv-hide"/, 'it opens the Status sheet and stays off the TV board');
  for (const none of [undefined, { briefing: [] }, { briefing: null }, { briefing: [{ name: 'Past brief', at: T - 60 }] }])
    assert.doesNotMatch(D.tdCal(ev, null, NOW, none).html, /Next briefing/);
  // W13: a bill Renewals lists is not repeated as an event
  const bill = { t: T - 60, days: [{ date: key(1), events: [{ title: 'Utilities: bill split', all_day: true }, { title: 'Dentist', start: new Date(NOW + 864e5).toISOString() }] }] };
  assert.doesNotMatch(visible(D.tdCal(bill, null, NOW, { bills: ['Utilities: bill split'] }).html), /bill split/);
  assert.match(visible(D.tdCal(bill, null, NOW).html), /bill split/);
});

// ---- #5 Calendar ----
const cal = { t: T - 60, days: [
  { date: key(0), events: [{ title: 'Standup', start: new Date(NOW - 7200e3).toISOString(), end: new Date(NOW - 5400e3).toISOString(), source: 'iCloud Work' },
    { title: 'Dinner', start: new Date(NOW + 3600e3).toISOString(), end: new Date(NOW + 7200e3).toISOString(), source: 'iCloud' },
    { title: 'Pay rent', all_day: true, source: 'iCloud Finances' }] },
  { date: key(1), events: [{ title: 'Dentist', start: new Date(NOW + 864e5).toISOString(), source: 'iCloud OC COAST' }, { title: '<b>Lunch</b>', start: new Date(NOW + 864e5 + 7200e3).toISOString(), source: 'Google' }] },
  { date: key(3), events: [{ title: 'Flight', start: new Date(NOW + 3 * 864e5).toISOString(), source: '' }] },
] };

test('calendar: each "Next on the calendar" row opens the calendar sheet; the page still shows the next three', () => {
  const r = D.tdCal(cal, null, NOW);
  assert.equal((r.html.match(/<button type="button" data-open="today-cal" class="frow/g) || []).length, 3);
  assert.match(visible(r.html), /^Next on the calendar Pay rent Today All day Dinner Today/);
  assert.doesNotMatch(visible(r.html), /Standup|Lunch|Work|Finances/, 'no calendar names and no past events on the page');
  assert.match(D.tdCal({ days: [] }, null, NOW).html, /<button type="button" data-open="today-cal" class="frow"><span class="fl"><b>Nothing on the calendar/);
});

test('calendar sheet: every event of today and the coming days, by day, each with its calendar and its times', () => {
  const h = D.tdCalSheet(cal, null, NOW), w = visible(h);
  assert.match(w, /^Today Pay rent Finances All day Standup Work 8:00 am to 8:30 am Dinner iCloud 11:00 am to 12:00 pm/, 'earlier events of today stay; the account prefix goes');
  assert.match(w, /Tomorrow Dentist OC COAST 10:00 am <b>Lunch<\/b> Google 12:00 pm/);
  assert.match(w, /\w{3}, Nov 18 Flight 10:00 am/);
  assert.doesNotMatch(h, /<b>Lunch/);
  const mini = visible(D.tdCalSheet({ error: 'file missing' }, { apple: { events_today: [{ title: 'Call', start: new Date(NOW + 600e3).toISOString(), calendar: 'Home' }] } }, NOW));
  assert.match(mini, /^Today Call Home 10:10 am$/, 'the Mac mini list when the agenda did not answer');
  assert.match(visible(D.tdCalSheet({ days: [{ date: key(-1), events: [{ title: 'Old' }] }] }, null, NOW)), /Nothing on the calendar/);
  assert.match(visible(D.tdCalSheet({ error: 'file missing' }, { error: 'mini unreachable' }, NOW)), /The calendar is not reporting/);
});

// ---- #13, #91, #92 On this day ----
const almanac = { now: { date: '2026-11-15', time: '10:00', tz_abbr: 'PST', weekday: 'Sunday', month: 'November', day_of_year: 319, days_left_in_year: 46, iso_week: 46 },
  location: { label: 'Huntington Beach, California' }, sun: { available: true, sunrise: '06:24', sunset: '16:46', day_length: '10 h 22 min' },
  moon: { phase: 'Waxing crescent', illumination_percent: 23 },
  events: { available: true, total: 5, years: [{ year: 2024, years_ago: 2, total: 3 }, { year: 2019, years_ago: 7, total: 1 }, { year: 2012, years_ago: 14, total: 1 }] },
  places: { available: true, years: [{ year: 2019, exact: [{ place: 'San Clemente' }], near: [] }, { year: 2015, exact: [], near: [{ place: '<i>Big Sur</i>' }] }] },
  milestones: {}, rhythm: {}, photos: {} };
const onthisday = { t: T - 600, month_day: '11-15', total: 34, years: [{ year: 2019, count: 9 }, { year: 2024, count: 14 }, { year: 2011, count: 11 }] };
const photoyears = { t: T - 600, dated_total: 29357, undated: 27, other_media: 0,
  years: [2009, 2010, 2011, 2012, 2019, 2024].map((year, i) => ({ year, image: [5, 0, 300, 120, 4012, 900][i], video: [0, 0, 10, 5, 100, 50][i] })) };

test('on this day sheet: the Almanac day (day of year, week, sun, moon, journal per year, places) as the old card drew it', () => {
  const w = visible(D.tdDaySheet(almanac, onthisday, photoyears));
  assert.match(w, /^Photos on this date 34 Earlier years 3 Dated photos 29,357 The day Sunday, November 15 Day 319, 46 left · week 46 Sun Sunrise 6:24 am · sunset 4:46 pm · 10 h 22 min of daylight Moon Waxing crescent, 23% lit/);
  assert.match(w, /Journal on this date 2024 2 years ago 3 entries 2019 7 years ago 1 entry 2012 14 years ago 1 entry/);
  assert.match(w, /Places on this date San Clemente 2019 · on this date <i>Big Sur<\/i> 2015 · near this date/);
  assert.doesNotMatch(D.tdDaySheet(almanac, onthisday, photoyears), /<i>Big/);
});

test('on this day sheet: photos on this date per year, newest first, and the years chart with dated and undated totals', () => {
  const h = D.tdDaySheet(almanac, onthisday, photoyears), w = visible(h);
  assert.match(w, /Photos on Nov 15 34 photos and videos in 3 earlier years 2024 14 2019 9 2011 11/);
  const bars = h.slice(h.indexOf('class="td-years"'), h.indexOf('class="td-yax"'));
  assert.equal((bars.match(/<i/g) || []).length, 6, 'one column per year');
  assert.equal((bars.match(/<i class="on"/g) || []).length, 3, 'bright: a photo on this date that year');
  assert.match(bars, /title="2019: 4,112" style|style="--h:100%" title="2019: 4,112"/);
  assert.match(bars, /style="--h:0%" title="2010: 0"/, 'an empty year is an empty column, not a guess');
  assert.match(w, /2009 2024 29,357 dated · 27 without a date · most in 2019 \(4,112\) · bright bars have a photo on this date/);
  assert.doesNotMatch(h.replace(/style="--[hv]:[\d.]+%"/g, ''), /style=/, 'inline style carries custom properties only');
});

test('on this day sheet: each feed missing on its own says so; the Almanac down by design is a quiet state, never an error page', () => {
  const noAlm = visible(D.tdDaySheet({ error: 'http 502' }, onthisday, photoyears));
  assert.match(noAlm, /^Photos on this date 34 Earlier years 3 Dated photos 29,357 Almanac The Almanac is not answering This part fills in when the Almanac runs on this computer\. Photos on Nov 15 34 photos/);
  assert.match(visible(D.tdDaySheet(null, { error: 'x' }, { error: 'y' })), /^Photos on this date No data Earlier years No data Dated photos No data/);
  assert.match(visible(D.tdDaySheet(almanac, { error: 'file missing' }, photoyears)), /Photos on this date Photos on this date Not reporting/);
  assert.match(visible(D.tdDaySheet(almanac, { total: 0, years: [] }, photoyears)), /None No photo or video was taken on this date before\./);
  const noPy = visible(D.tdDaySheet(almanac, onthisday, { error: 'file missing' }));
  assert.match(noPy, /Photos by year Photos by year Not reporting Open the Almanac$/);
  assert.match(visible(D.tdDaySheet(almanac, onthisday, { ...photoyears, undated: null })), /Without a date: No data/);
  const off = visible(D.tdDaySheet({ ...almanac, sun: { available: false }, events: { available: false }, places: { available: false } }, onthisday, photoyears));
  assert.match(off, /Sun Not available/);
  assert.match(off, /Journal Not available/);
  assert.match(off, /Places Not available/);
});

test('on this day glue: the Almanac and the photo years are read when the sheet opens, through the fixed path, bounded', () => {
  assert.doesNotMatch(glue.slice(glue.indexOf('const TD_FEEDS='), glue.indexOf('};', glue.indexOf('const TD_FEEDS='))), /almanac|photoyears/, 'never on page load');
  assert.match(glue, /const tdAlmGet=\(\)=>bfetch\(DeckUI\.TD_PATHS\.almanac\+'api\/today',\{credentials:'same-origin',cache:'no-store'\},15000\)/, 'bounded at 15 s');
  assert.match(glue, /'today-day':\['On this day',\(\)=>Promise\.all\(\[tdAlmGet\(\),tdGet\('photoyears'\)\]\)/);
  assert.match(glue, /<p class="note">Reading\\u2026<\/p>/, 'a sheet read on open says Reading until it answers');
});

// ---- #15 Search clicks ----
const traffic = { t: T - 600, status: 'ok',
  daily: { date: '2026-11-13', goal: 2000, sites: [
    { domain: 'meshvault.ai', value: 0, impressions: 32, tracked: true }, { domain: 'protocol-guide.com', value: 16, impressions: 252, tracked: true },
    { domain: 'pepgo.org', value: null, impressions: null, tracked: true, reason: 'no_access', error: 'siteUnverifiedUser' }],
    aggregate: { clicks: 16, measured: 2, tracked: 3, complete: false, pct: 0.8 } },
  sites: [
    { domain: 'protocol-guide.com', value: 465, impressions: 8426, start_date: '2026-10-17', end_date: '2026-11-13', tracked: true },
    { domain: 'meshvault.ai', value: 6, impressions: 1091, start_date: '2026-10-17', end_date: '2026-11-13', tracked: true },
    { domain: 'pepgo.org', value: null, impressions: null, start_date: '2026-10-17', end_date: '2026-11-13', tracked: true, reason: 'no_access' },
    { domain: 'breezybuild.com', value: 1, impressions: 24, start_date: '2026-10-17', end_date: '2026-11-13', tracked: false },
    { domain: 'thefiredev.com', value: null, start_date: '2026-10-17', end_date: '2026-11-13', tracked: false, reason: 'failed', error: 'HTTP 500' }] };

test('search clicks: the tile opens the traffic sheet, not the generic Data sheet', () => {
  const t = D.tdTrafficTile(traffic);
  assert.equal(t.open, 'today-traffic');
  const g = D.tdGlance({ traffic });
  assert.match(g.html, /<button type="button" data-open="today-traffic" class="tile tv-hide" data-key="traffic">/);
  assert.doesNotMatch(g.html, /data-sheet="data"/);
});

test('traffic sheet: clicks against the goal, each tracked site that day, and the 28-day totals with impressions', () => {
  const h = D.tdTrafficSheet(traffic), w = visible(h);
  assert.match(w, /^Clicks 16 Nov 13 · 2 of 3 sites Daily goal 2,000 Of goal 0\.8% at least Toward the goal 0\.8%/);
  assert.match(w, /meshvault\.ai 0 clicks 32 impressions protocol-guide\.com 16 clicks 252 impressions pepgo\.org No Search Console access/, 'a measured zero stays 0; no access is words');
  assert.match(w, /Last 28 days, Oct 17 to Nov 13 Clicks 471 2 of 3 sites Impressions 9,517 protocol-guide\.com 465 clicks 8,426 impressions meshvault\.ai 6 clicks 1,091 impressions pepgo\.org No Search Console access/);
  assert.match(w, /2 more sites breezybuild\.com 1 click 24 impressions thefiredev\.com No reading$/);
  assert.match(h, /<details class="td-more"><summary>2 more sites<\/summary>/);
  assert.doesNotMatch(h, /siteUnverifiedUser|HTTP 500|href=/);
  assert.match(h, /--v:0\.8%/, 'the goal bar');
});

test('traffic sheet: a day without a reading and a missing feed say so, never zero', () => {
  const noDay = visible(D.tdTrafficSheet({ ...traffic, daily: { date: null, goal: null, sites: [], aggregate: { clicks: null, measured: 0, tracked: 0 } } }));
  assert.match(noDay, /^Latest complete day No reading Last 28 days/);
  const noGoal = visible(D.tdTrafficSheet({ ...traffic, daily: { ...traffic.daily, goal: null, aggregate: { ...traffic.daily.aggregate, pct: null, complete: true } } }));
  assert.match(noGoal, /Daily goal No data Of goal No data/);
  assert.doesNotMatch(noGoal, /Toward the goal|at least/);
  for (const bad of [{ error: 'file missing' }, { status: 'unavailable', sites: [] }, null]) assert.match(visible(D.tdTrafficSheet(bad)), /Website traffic is not reporting/);
});

// L23 (owner order kept from 2026-11-04): Vercel page views per project. One traffic tile: page views as the figure, search clicks on its
// small line (Main, 2026-11-15), per-project views in the sheet. Without the block the tile is today's Search clicks; a gap is never zero.
const vercel = { provider: 'vercel_web_analytics', metric: 'pageviews', start_date: '2026-10-19', end_date: '2026-11-15', status: 'ok', projects: [
  { project: 'meshvault-site', domain: 'meshvault.ai', domains: ['meshvault.ai', 'kodros.ai', 'meshchat.net', 'nursebuddy.io', 'openmesh.live'], pageviews: 668, visitors: 260, status: 'ok', tracked: true },
  { project: 'pepgo', domain: 'pepgo.org', domains: ['pepgo.org'], pageviews: 160, visitors: 61, status: 'ok', tracked: true },
  { project: 'broken', domain: 'protocol-guide.com', domains: ['protocol-guide.com'], pageviews: null, visitors: null, status: 'unavailable', tracked: true, error: 'Vercel HTTP 403' },
  { project: 'breezybuild', domain: 'breezybuild.com', domains: ['breezybuild.com'], pageviews: 65, visitors: 25, status: 'ok', tracked: false }] };
test('L23: the traffic tile reads page views with search clicks on its small line; without the Vercel block it is Search clicks', () => {
  const t = D.tdTrafficTile({ ...traffic, vercel });
  assert.deepEqual([t.h, visible(t.v), visible(t.t), t.open], ['Page views · 28 days', '828', 'Search clicks 16 · 2 of 3 sites', 'today-traffic'], 'tracked projects with a reading only: 668 + 160; a partial clicks count keeps its qualifier');
  assert.equal(visible(D.tdTrafficTile({ ...traffic, vercel, daily: { ...traffic.daily, aggregate: { ...traffic.daily.aggregate, complete: true } } }).t), 'Search clicks 16', 'a complete count needs no qualifier');
  assert.equal(D.tdTrafficTile(traffic).h, 'Search clicks', 'no block: as before');
  assert.equal(D.tdTrafficTile({ ...traffic, vercel: { status: 'unavailable', projects: [] } }).h, 'Search clicks');
  // Search Console down, Vercel up: the tile still shows page views, with no clicks line
  const only = D.tdTrafficTile({ status: 'unavailable', sites: [], vercel });
  assert.deepEqual([only.h, visible(only.v), only.t], ['Page views · 28 days', '828', '']);
  assert.equal(D.tdGlance({ traffic: { status: 'unavailable', sites: [], vercel } }).miss.length > 0, true);
  assert.ok(!D.tdGlance({ traffic: { status: 'unavailable', sites: [], vercel } }).miss.some((m) => m.key === 'traffic'), 'page views alone keep the tile');
});
test('L23: the sheet opens on page views, each tracked project with its other domains, the rest folded; a failed project is words, never 0', () => {
  const h = D.tdTrafficSheet({ ...traffic, vercel }), w = visible(h);
  assert.match(w, /^Page views 828 Last 28 days, Oct 19 to Nov 15 Visitors 321 Summed across projects meshvault\.ai Also kodros\.ai, meshchat\.net, nursebuddy\.io and 1 more 668 page views 260 visitors pepgo\.org 160 page views 61 visitors protocol-guide\.com No reading 1 more project breezybuild\.com/);
  assert.match(w, /Search clicks Clicks 16 Nov 13/);
  assert.doesNotMatch(h, /Vercel HTTP 403|href=/);
  assert.match(h, /^<div class="strip"/, 'first data, never a heading');
  const m = Object.fromEntries(D.tdData({ traffic: { ...traffic, vercel } }, NOW).method);
  assert.match(m['Page views'], /last 28 days, summed over your tracked projects[^]*not counted as zero/);
  assert.equal(Object.fromEntries(D.tdData({ traffic }, NOW).method)['Page views'], undefined);
});

test('each sheet opens on its figures or its first row, never on a heading (first data on a TV sheet)', () => {
  const first = (h) => String(h).replace(/^<div class="td-sheet">/, '').slice(0, 40);
  for (const h of [D.tdReplySheet(replyblock), D.tdStatusSheet(today, health, NOW), D.tdCalSheet(cal, null, NOW), D.tdDaySheet(almanac, onthisday, photoyears), D.tdDaySheet(null, null, null), D.tdTrafficSheet(traffic)])
    assert.match(first(h), /^<div class="(strip|flist)"/, first(h));
});

// ---- shared ----
test('every new sheet is one tap away from Today and opens from inside another Today sheet too', () => {
  for (const k of ['today-reply', 'today-cal', 'today-status', 'today-day', 'today-traffic']) assert.match(glue, new RegExp("'" + k + "':\\["), k);
  assert.match(glue, /closest\('#pg-today \[data-go\],#pg-today \[data-open\^="today-"\],\.td-sheet \[data-open\^="today-"\]'\)/);
  assert.match(glue, /\{opener:t\}/, 'focus goes back to the row or tile that opened it (remote Back)');
});

test('hostile or empty feeds never throw and never print a raw error', () => {
  for (const x of [null, undefined, 42, 'x', [], {}, { error: 'ssh: connect to host 192.0.2.50 port 22' }]) {
    const out = [D.tdReplySheet(x), D.tdCalSheet(x, x, NOW), D.tdAlertsHtml(x, x, x, []).html, D.tdStatusSheet(x, x, NOW), D.tdDaySheet(x, x, x), D.tdTrafficSheet(x), D.tdTrafficSheet({ vercel: x }), (D.tdTrafficTile({ vercel: x }) || {}).v || ''].join('');
    assert.doesNotMatch(visible(out), /192\.0|port 22|undefined|NaN|null|\[object/);
  }
});
