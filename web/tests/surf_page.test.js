// node --test tests/surf_page.test.js
// Surf page render (static/pages/surf.js on the DeckUI helpers): what the owner sees on the page and in the spot sheet.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const { S, D, load, feed, regionFile, NOV } = require('./surf_fixture.js');

const ST = (o = {}) => Object.assign({ region: 'orange-county', good: false, sort: 'rating', more: 50 }, o);
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const count = (s, re) => (s.match(re) || []).length;
// the fixture's Salt Creek, Strands and Trestles read the same and fold into one card (M4, tests/surf_better.test.js);
// these card tests give each home break its own reading so every break draws its own card
const own = () => { const f = feed(); const set = (id, w) => { f.spots.find(s => s.id === id).now.wave_ft = w; }; set('strands', [4, 6]); set('trestles', [6, 7]); set('huntington', [3, 5]); return f; };
const SOURCE = /NDBC|CDIP|Open-Meteo|CoastWatch|NOAA|SCCOOS|CeNCOOS|NASA|\b46285\b|\b46232\b|\b9410580\b|\b9410120\b|OC172|model:|docs\/|\bsources?\b/i;

test('the page shows no source text, ids or coverage, and no em dash', () => {
  const html = S.page(feed(), ST());
  const t = text(html);
  assert.doesNotMatch(t, SOURCE);
  assert.doesNotMatch(t, /246|137 with|stations reporting/i, 'coverage counts live in the Data sheet');
  assert.doesNotMatch(html, /\u2014|\u2013/);
});

test('sections run in blueprint order with the seven home spots in owner order', () => {
  const html = S.page(own(), ST());
  const order = ['sf-alerts', 'sf-mine', 'sf-coast', 'sf-best', 'sf-regions', 'sf-spots', 'sf-buoys', 'sf-temp'].map(c => html.indexOf('class="sect ' + c));
  assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), 'order ' + order);
  const mine = html.slice(html.indexOf('sf-mine'), html.indexOf('sf-coast'));
  assert.deepEqual([...mine.matchAll(/data-key="([^"]+)"/g)].map(m => m[1]), ['salt-creek', 'strands', 'doheny', 'san-clemente-pier', 'trestles', 'san-onofre', 'huntington']);
  assert.ok(html.indexOf('class="board sf-board"') < html.indexOf('sf-mine') && html.indexOf('sf-regions') > html.indexOf('</div><section class="sect sf-regions'), 'the TV board wraps spots, coast and best only');
});

test('a compact card: name with pips and word, the height, one meta line of bone values; no reason line that repeats fields', () => {
  const html = S.page(own(), ST());
  const card = html.slice(html.indexOf('data-key="salt-creek"'), html.indexOf('data-key="strands"'));
  assert.match(card, /<header><b>Salt Creek<\/b><span class="pips" data-q="5"/);
  assert.match(card, /Great/);
  assert.match(card, /<div class="big">5-6<span class="u">ft<\/span>/);
  assert.match(card, /<b class="sv">14\u00A0s SW<\/b>/);
  assert.match(card, /<b class="sv">4\u00A0kt<\/b> <span class="sf-w">glassy<\/span>/, 'calm reads Glassy, after its value, never broken at a hyphen');
  assert.match(card, /<b class="sv">74\u00B0F<\/b>/);
  assert.match(card, /Low tide <b class="sv">7:08 pm<\/b>/);
  assert.doesNotMatch(card, /class="why"/, 'the feed reason only repeats the fields');
  assert.doesNotMatch(card, /class="model"/);
});

test('model-only spots and regions carry the hollow mark and one forecast line, never a reading look', () => {
  const html = S.page(feed(), ST());
  const best = html.slice(html.indexOf('sf-best'), html.indexOf('sf-regions'));
  const cabo = best.slice(best.indexOf('data-key="cabo-falso"'));
  const card = cabo.slice(0, cabo.indexOf('</button>'));
  assert.match(card, /<span class="model" title="Model forecast, no buoy nearby">6-8<span class="vh">, model forecast, no buoy nearby<\/span><\/span>/, 'the value stays in the accessible name');
  assert.match(card, /about <b class="sv">14\u00A0s NW<\/b>/);
  assert.equal(count(card, /Forecast only\. No buoy nearby\./g), 1, 'once per card, never per number');
  assert.match(card, /High tide about <b class="sv">9:42 am UTC\u22127<\/b>/, 'Mexico model tide, zone mark');
  assert.match(card, /Baja Sur/, 'best right now names the region');
  const rg = html.slice(html.indexOf('data-region="baja-sur"'));
  const rcard = rg.slice(0, rg.indexOf('</button>'));
  assert.match(rcard, /Forecast only\. No buoys in this region\./);
  assert.doesNotMatch(rcard, /Forecaster|Rip risk/, 'Baja has neither row, not even "unknown"');
  const bn = html.slice(html.indexOf('data-region="baja-norte"'));
  assert.doesNotMatch(bn.slice(0, bn.indexOf('</button>')), /Forecast only/, 'Baja Norte has a buoy in range for some spots');
});

test('regions: no-reading regions fold into one line; forecaster and rip risk show for California when present', () => {
  const f = feed();
  f.regions[3].forecaster = { ft: [4, 6], zone: 'CAZ552' };
  f.regions[3].rip = { risk: 'Moderate', zone: 'CAZ552' };
  const html = S.page(f, ST());
  assert.doesNotMatch(html, /data-region="ventura"/);
  assert.match(html, /No reading now: Ventura\./);
  const oc = html.slice(html.indexOf('data-region="orange-county"'));
  assert.match(oc.slice(0, oc.indexOf('</button>')), /Forecaster: 4-6\u00A0ft \u00B7 Rip risk: moderate/);
  assert.match(oc, /3 great \u00B7 2 good \u00B7 2 fair/);
});

test('alerts rule (M3): the home-region alerts are one line that opens them all; the rest of the coast is one quiet line in the same block', () => {
  const f = feed();
  f.alerts = [];
  let html = S.page(f, ST());
  assert.doesNotMatch(html, /sf-alerts|sf-coast-al/, 'no alerts: no section and no line');
  // far regions only: no home line, the quiet line still sits in the alerts block above the spots (W2)
  f.alerts = [
    { event: 'Gale Warning', regions: ['ventura'], end: NOV + 50, until_label: 'Sun 3 am', severity: 'Moderate' },
    { event: 'Gale Warning', regions: ['ventura'], end: NOV + 50, until_label: 'Sun 3 am', severity: 'Moderate' },
    { event: 'High Seas Warning', regions: ['baja-sur'], end: NOV + 50, until_label: 'Sat 6 pm', severity: 'Severe' },
    { event: 'Storm Warning', regions: ['oregon-north'], end: NOV + 90, until_label: 'Sun 4 am', severity: 'Severe' }
  ];
  html = S.page(f, ST());
  let al = html.slice(html.indexOf('<section class="sect sf-alerts"'), html.indexOf('<div class="board'));
  assert.doesNotMatch(al, /class="frow/);
  assert.match(al, /<button class="btn btn-quiet sf-coast-al" data-open="alerts">3 more alerts along the coast<\/button><\/section>$/, 'one statement per zone counts once');
  assert.equal(count(html, /sf-coast-al/g), 1, 'never repeated after the spots');
  // four home-region groups: one line, each kind once without its advisory or warning word, until the last end
  f.alerts = [
    { event: 'Beach Hazards Statement', regions: ['orange-county'], end: NOV + 10, until_label: 'Sat 9 pm', severity: 'Minor' },
    { event: 'High Surf Advisory', regions: ['san-diego', 'orange-county'], end: NOV + 100, until_label: 'Sun 10 am', severity: 'Minor' },
    { event: 'High Surf Warning', regions: ['orange-county'], end: NOV + 200, until_label: 'Sun 4 pm', severity: 'Moderate' },
    { event: 'Rip Current Statement', regions: ['orange-county'], end: NOV + 300, until_label: 'Mon 6 am', severity: 'Minor' },
    { event: 'Small Craft Advisory', regions: ['ventura'], end: NOV + 50, until_label: 'Sun 3 am', severity: 'Minor' }
  ];
  html = S.page(f, ST());
  al = html.slice(html.indexOf('<section class="sect sf-alerts"'), html.indexOf('<div class="board'));
  assert.equal(count(al, /class="frow/g), 1, 'one line, not one row per group');
  assert.match(al, /<button class="frow sf-al" data-open="alerts">/, 'one tap opens every alert');
  assert.match(text(al).replace(/ ,/g, ','), /^\s*Alerts 4 alerts High surf, Beach hazards, Rip current until Mon 6 am 1 more alert along the coast\s*$/, 'the warning and the advisory of one kind read once');
  assert.match(al, /<span class="sf-nw">Beach hazards<\/span>/, 'a kind never splits across lines');
  assert.ok(html.indexOf('sf-alerts') < html.indexOf('sf-mine'));
  // the two kinds of the owner's example read whole
  const two = S.alertLine(S.alertGroups([
    { event: 'High Surf Advisory', regions: ['orange-county'], end: NOV + 100, until_label: 'Wed 4 am', severity: 'Minor' },
    { event: 'Small Craft Advisory', regions: ['orange-county'], end: NOV + 50, until_label: 'Tue 9 pm', severity: 'Minor' }
  ], {}));
  assert.deepEqual(two, { n: 2, kinds: 'High surf, Small craft', until: 'until Wed 4 am', severe: false });
  assert.equal(S.alertsSection([], 0), '');
  // Baja-only statements keep the Offshore seas word in the full list
  const sheet = S.alertsSheet(S.alertGroups([{ event: 'High Seas Warning', regions: ['baja-sur'] }, { event: 'Gale Warning', regions: ['ventura'] }], { 'baja-sur': 'Baja Sur' }), 'Gale warning');
  assert.deepEqual([...sheet.body.matchAll(/<h3>([^<]+)<\/h3>/g)].map(m => m[1]), ['Gale warning', 'Offshore seas'], 'every alert, the tapped one first');
  assert.doesNotMatch(sheet.body, /High seas warning/i);
});

test('region cards keep their own alert mark', () => {
  const f = feed();
  f.regions[3].alerts = 2;
  const html = S.page(f, ST());
  const oc = html.slice(html.indexOf('data-region="orange-county"'));
  assert.match(oc.slice(0, oc.indexOf('</button>')), /class="one sf-ral"><span class="sd warn"><\/span>2 alerts/);
});

test('spots in the region: table rows open the spot sheet, every cell labelled, Good or better can empty it', () => {
  const html = S.spotsSection(feed(), ST(), { 'orange-county': 'Orange County' }, {});
  assert.match(html, /<span>Spots in Orange County<\/span>/);
  assert.match(html, /Sort: Rating/);
  assert.equal(count(html, /<tr[^>]*data-open="spot"/g), 7);
  const tds = html.match(/<td[^>]*>/g) || [];
  assert.ok(tds.length > 0 && tds.every(td => /data-l="/.test(td)), 'phone card labels on every cell');
  assert.ok(tds.filter(td => /Period|Wind|Swell|Water|Best window|Next tide/.test(td)).every(td => /data-pri="[234]"/.test(td)));
  const f = feed();
  for (const s of f.spots) if (s.region === 'orange-county') { s.now.rating = 4; s.now.word = 'Fair'; }
  const none = S.spotsSection(f, ST({ good: true }), { 'orange-county': 'Orange County' }, {});
  assert.match(none, /No spots are good or better here right now\./);
  assert.match(none, /data-surf="good"/);
});

test('buoys start south with the one muted line; shore stations stay off; the 24 h column waits for history', () => {
  const f = feed();
  let html = S.buoysSection(f, { 'san-diego': 'San Diego', 'orange-county': 'Orange County' });
  assert.ok(html.indexOf('No public buoys south of San Diego.') < html.indexOf('Point Loma South'));
  assert.ok(html.indexOf('Point Loma South') < html.indexOf('Capistrano Beach Nearshore'));
  assert.doesNotMatch(html, /La Jolla/);
  assert.doesNotMatch(html, />24 h</);
  assert.doesNotMatch(text(html), /\b46285\b|CDIP/);
  f.buoys[1].hours_ft = { start: NOV - 86400, step: 3600, ft: [4.1, 4.4, null, 4.9] };
  html = S.buoysSection(f, {});
  assert.match(html, />24 h</);
  assert.match(html, /class="spark"/);
});

test('the buoy list follows the region filter; phones show five rows and one Show more for buoys and spots', () => {
  const f = feed();
  const names = { 'san-diego': 'San Diego', 'orange-county': 'Orange County', 'baja-sur': 'Baja Sur' };
  let html = S.buoysSection(f, names, ST());
  assert.match(html, /<span>Buoys in Orange County<\/span>/);
  assert.match(html, /Capistrano Beach Nearshore/);
  assert.doesNotMatch(html, /Point Loma South|No public buoys south/, 'a California region shows its own buoys and no Baja note');
  html = S.buoysSection(f, names, ST({ region: 'mine' }));
  assert.match(html, /<span>Buoys near your spots<\/span>[^]*Capistrano Beach Nearshore/);
  html = S.buoysSection(f, names, ST({ region: 'baja-sur' }));
  assert.match(html, /<p class="note sf-nobuoy">No public buoys south of San Diego\.<\/p><\/section>/, 'Baja: the note alone');
  assert.doesNotMatch(html, /is reporting|class="empty|sf-more/, 'no empty card after the note');
  html = S.buoysSection(f, names, ST({ region: 'all' }));
  assert.match(html, /<span>Buoys<\/span>[^]*Point Loma South[^]*Capistrano Beach Nearshore/);
  assert.doesNotMatch(html, /sf-more5/, 'two buoys: no Show more');
  // seven rows: five show on a phone, one button names the other two; open, the button is gone
  for (let i = 0; i < 5; i++) f.buoys.push(Object.assign({}, f.buoys[1], { id: 'x' + i, name: 'Extra ' + i }));
  html = S.buoysSection(f, names, ST());
  assert.match(html, /<section class="sect sf-buoys sf-cap5">/);
  assert.match(html, /<button class="btn sf-more sf-more5" data-surf="open" data-k="buoys">Show 1 more<\/button>/);
  assert.doesNotMatch(S.buoysSection(f, names, ST({ open: { buoys: true } })), /sf-more5/);
  assert.match(S.buoysSection(f, names, ST({ open: { buoys: true } })), /<section class="sect sf-buoys sf-cap5 open">/);
  const spots = S.spotsSection(feed(), ST(), names, {});
  assert.match(spots, /<section class="sect sf-spots sf-cap5" id="sf-spots">/);
  assert.match(spots, /data-surf="open" data-k="spots">Show 2 more<\/button>/, 'seven Orange County spots: five and two more');
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../static/css/surf.css'), 'utf8');
  assert.match(css, /@media \(max-width:599px\),\(min-width:600px\) and \(max-height:499px\)\{\n  \.sf-cap5:not\(\.open\) \.sf-plist>\.frow:nth-child\(n\+6\),\.sf-cap5:not\(\.open\) \.htbl tbody>tr:nth-child\(n\+6\)/, 'P and L cap at five rows');
  assert.match(css, /\.sf \.htbl td \.na::after\{content:"No data"/, 'a phone card says No data in words');
  assert.match(css, /\.sf-alerts>\.secttl,\.sf-mine:not\(\.sf-mine-t\)>\.secttl\{display:none\}/, 'P and L: no Your spots title under the home filter, four cards on the first screen');
  assert.match(css, /@media \(min-width:1100px\) and \(min-height:500px\)\{html:not\(\.tv\) \.sf \.htbl tr>:first-child\{width:30%\}\}/, 'D and XL: the name column takes three tenths, not the spare width');
  assert.match(css, /@container tbl \(min-width:52rem\)\{html:not\(\.tv\) \.sf \.htbl th,html:not\(\.tv\) \.sf \.htbl td\{padding-left:var\(--s-4\);padding-right:var\(--s-4\)\}\}/, 'a wide table keeps a real gap between columns');
});

test('phones: the pinned cards keep their title away from their region; an open list ends with Show fewer', () => {
  const titled = st => /class="sect sf-mine sf-mine-t"/.test(S.page(feed(), ST(st)));
  assert.equal(titled({ region: 'orange-county' }), false, 'the home region: title hidden on P and L');
  assert.equal(titled({ region: 'mine' }), false);
  assert.equal(titled({ region: 'baja-sur' }), true, 'Baja Sur: the pinned cards say what they are');
  assert.equal(titled({ region: 'all' }), true);
  assert.equal(titled({ region: 'san-diego' }), true, 'a region with no home spot');
  const f = feed();
  for (let i = 0; i < 5; i++) f.buoys.push(Object.assign({}, f.buoys[1], { id: 'x' + i, name: 'Extra ' + i }));
  const names = { 'orange-county': 'Orange County' };
  const open = S.buoysSection(f, names, ST({ open: { buoys: true } }));
  assert.match(open, /<button class="btn btn-quiet sf-more sf-fewer5" data-surf="fewer" data-k="buoys">Show fewer<\/button><\/section>/);
  assert.doesNotMatch(S.buoysSection(f, names, ST()), /Show fewer/, 'closed: Show more only');
  assert.match(S.spotsSection(feed(), ST({ open: { spots: true } }), names, {}), /data-surf="fewer" data-k="spots">Show fewer</);
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../static/css/surf.css'), 'utf8');
  assert.match(css, /\.sf-more5,\.sf-fewer5\{display:none\}/, 'D, T and TV never show the phone buttons');
  assert.match(css, /\.sf-cap5:not\(\.open\) \.sf-more5,\.sf-cap5\.open \.sf-fewer5\{display:inline-flex\}/);
});

test('water temperature chart: readings as dots, a dashed model stretch, home spots in signal; too few points is one line', () => {
  const f = feed();
  const html = S.tempChart(S.latChart(f.water, f.spots));
  assert.equal(count(html, /class="pt"/g), 4);
  assert.equal(count(html, /class="pt sel"/g), 7);
  assert.match(html, /class="ln sf-dash"/);
  assert.match(html, /class="ln"/);
  assert.match(html, /Cabo/);
  assert.match(html, /Columbia River/);
  assert.doesNotMatch(html, /style="[^"]*(color|width|height|top:[^%]*px)/, 'inline style carries custom properties and positions only');
  const thin = S.tempChart(S.latChart({ rows: [{ lat: 33, f: 70, kind: 'buoy' }], bins: [] }, []));
  assert.doesNotMatch(thin, /<svg/);
  assert.match(thin, /too few readings/);
});

test('Orange County spot sheet: every section, per-day dots, the tide curve with Now, the nearest buoy by name', () => {
  const f = feed(), rf = regionFile();
  const s = f.spots[0];
  s.forecaster = { ft: [4, 6], until_label: 'Sun 10 am' };
  s.rip = { risk: 'high' };
  const sh = S.spotSheet(s, f, rf, NOV);
  assert.equal(sh.title, 'Salt Creek');
  assert.equal(sh.sub, 'Orange County \u00B7 South OC \u00B7 faces WSW');
  assert.ok(!sh.wide, 'one sheet width (critique 13)');
  const heads = [...sh.body.matchAll(/<h3>([^<]+)<\/h3>/g)].map(m => m[1]);
  assert.deepEqual(heads, ['Now', 'Offshore swell', '2-day outlook', 'Tide', 'Forecaster and rip risk', 'Nearest buoy', 'Sun', 'Alerts']);
  // the shared strip and tile: a labelled group, the mark after the value and unit, never in the label row
  assert.match(sh.body, /<div class="strip" data-n="4" data-nb="4" role="group" aria-label="Now at Salt Creek">/);
  assert.match(sh.body, /<span class="h">Height<\/span><b class="v">5-6<span class="u">ft<\/span><span class="conf"/);
  assert.doesNotMatch(sh.body, /<span class="h">[^<]*<span class="conf"/);
  assert.doesNotMatch(sh.body, /tiles4/);
  assert.equal(count(sh.body.slice(sh.body.indexOf('sf-obars')), /class="conf"/g), 2, 'each day its own dots');
  assert.match(sh.body, /class="now"/);
  assert.match(sh.body, />Now</);
  assert.match(sh.body, /Capistrano Beach Nearshore, 3 mi/);
  assert.match(sh.body, /6:21 am/);
  assert.match(sh.body, /Rip risk<\/dt><dd>High/);
  assert.match(sh.body, /74-75\u00B0F, 3 readings/);
  assert.doesNotMatch(text(sh.body), SOURCE);
  assert.match(sh.actions, /data-sheet="data" data-scope="spot:salt-creek"/);
  // before the region file lands the sheet still opens with what the overview holds
  const early = S.spotSheet(s, f, null, NOV);
  assert.match(early.body, /Loading\./);
});

test('Baja Sur spot sheet: forecast line once, approximate dashed tide, zone-marked sun, no buoy and no forecaster', () => {
  const f = feed(), rf = regionFile();
  const cabo = f.spots.find(s => s.id === 'cabo-falso');
  cabo.forecaster = { ft: [4, 6] };
  const sh = S.spotSheet(cabo, f, rf, NOV);
  assert.equal(count(sh.body, /Forecast only\. No buoy nearby\./g), 1);
  assert.match(sh.body, /Period, about/);
  assert.match(sh.body, /<span class="h">Height<\/span><b class="v"><span class="model" title="Model forecast, no buoy nearby">6-8<span class="vh">/, 'the model mark rides through DeckUI.tile');
  assert.match(sh.body, /class="ln sf-dash"/);
  assert.match(sh.body, /Approximate tide\. No tide table here\./);
  assert.match(sh.body, /6:35 am UTC\u22127/);
  assert.doesNotMatch(sh.body, /Nearest buoy|Forecaster/);
  const scorpion = f.spots.find(s => s.id === 'scorpion-bay');
  assert.match(S.spotSheet(scorpion, f, rf, NOV).body, /No tide table for this spot\./);
});

test('escaping: a hostile name never becomes markup', () => {
  const f = feed();
  f.spots[0].name = 'Salt <img src=x onerror=alert(1)> Creek';
  const html = S.page(f, ST());
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Salt &lt;img/);
});

// a tiny fake DOM for the registry route: enough for show() and the header slots
function el() {
  const e = { innerHTML: '', dataset: {}, listeners: 0, children: {}, addEventListener() { this.listeners++; }, querySelector(sel) { return this.children[sel] || null; } };
  return e;
}
function ctxFake() {
  const pact = el(), pscope = el();
  pact.insertAdjacentHTML = function (_w, h) { this.innerHTML = h + this.innerHTML; };
  const head = el(); head.children['.pact'] = pact; head.children['.pscope'] = pscope;
  return { route: 'surf', el: el(), head, pact, pscope };
}

test('route: registers under surf; a 403 or missing feed shows "Surf is not reporting." with one Try again; stale marks the freshness', async () => {
  const reg = {};
  let res = { ok: false, status: 403 };
  const pages = { register: (r, h) => { reg[r] = h; }, get: async () => res, mark: (ctx, o) => { ctx.pact.innerHTML = D.fresh(o); } };
  const P = load(D, pages);
  assert.ok(reg.surf && typeof reg.surf.show === 'function' && typeof reg.surf.data === 'function');
  let c = ctxFake();
  await reg.surf.show(c);
  assert.match(c.el.innerHTML, /Surf is not reporting\./);
  assert.equal(count(c.el.innerHTML, /data-retry="surf"/g), 1);
  res = { ok: true, status: 200, data: { status: 'not_reporting', reason: 'no file' } };
  c = ctxFake();
  await reg.surf.refresh(c, false);
  assert.match(c.el.innerHTML, /Surf is not reporting\./);
  res = { ok: true, status: 200, data: Object.assign(feed(), { stale: true, age: 7200 }) };
  c = ctxFake();
  await reg.surf.refresh(c, false);
  assert.match(c.pact.innerHTML, /Out of date/);
  assert.match(c.pscope.innerHTML, /Orange County/);
  assert.match(c.pscope.innerHTML, /Good or better/);
  assert.match(c.el.innerHTML, /sf-mine/);
  const ds = reg.surf.data(c, '');
  assert.ok(ds.sources.length === 3 && Array.isArray(ds.method));
  assert.ok(P._state.region === 'orange-county');
  // a deep link picks the list; an unknown region id is ignored
  res = { ok: true, status: 200, data: feed() };
  c = ctxFake(); c.params = { region: 'baja-sur' };
  await reg.surf.show(c);
  assert.match(c.el.innerHTML, /<span>Spots in Baja Sur<\/span>/);
  c = ctxFake(); c.params = { region: '../etc' };
  await reg.surf.show(c);
  assert.match(c.el.innerHTML, /<span>Spots in Baja Sur<\/span>/);
});

test('phone spot list: a two-line row per spot with no repeated column labels; the table stays for L and up', () => {
  const html = S.spotsSection(feed(), ST(), { 'orange-county': 'Orange County' }, {});
  const plist = html.slice(html.indexOf('<div class="flist sf-plist">'), html.indexOf('<div class="sf-tbl">'));
  assert.equal(count(plist, /<button class="frow" data-open="spot"/g), 7);
  assert.doesNotMatch(plist, /data-l=|Rating|Period/);
  assert.match(plist, /<b>Salt Creek<\/b><small>14\u00A0s SW \u00B7 Glassy 4\u00A0kt \u00B7 74\u00B0F<\/small>/);
  assert.match(html, /<div class="sf-tbl"><div class="htw">/);
});

test('the buoy place cell is the name alone, so the period keeps its unit', () => {
  const html = S.buoysSection(feed(), { 'san-diego': 'San Diego' });
  assert.match(html, /<span class="place"><b>Point Loma South<\/b><\/span>/);
  assert.doesNotMatch(html.slice(html.indexOf('<tbody')), /San Diego/);
});

test('card lines never split a phrase: the tide phrase moves whole, the dot is a painted space, the best window time stays whole', () => {
  const html = S.page(own(), ST());
  const card = html.slice(html.indexOf('data-key="salt-creek"'), html.indexOf('data-key="strands"'));
  const SEP = '<span class="sf-sep"> <\\/span>';
  assert.match(card, new RegExp('<p class="one"><b class="sv">14\u00A0s SW<\\/b>' + SEP + '<b class="sv">4\u00A0kt<\\/b> <span class="sf-w">glassy<\\/span>' + SEP));
  assert.match(card, new RegExp(SEP + '<span class="sf-u">Low tide <b class="sv">7:08 pm<\\/b><\\/span><\\/p>'), 'the tide phrase is one unit');
  assert.doesNotMatch(card.slice(card.indexOf('<p class="one">')), /\u00B7/, 'the dot is painted on a space, so it collapses where the line breaks');
  const oc = html.slice(html.indexOf('data-region="orange-county"'));
  const rcard = oc.slice(0, oc.indexOf('</button>'));
  assert.match(rcard, /<p class="one">Best: Salt Creek, <span class="sf-nw">tomorrow 7-9 am<\/span><\/p>/);
  assert.match(rcard, new RegExp('<\\/b>' + SEP + '<b class="sv">5\u00A0kt<\\/b>'), 'region meta parts use the same separator');
  const f2 = feed();
  f2.spots.find(s => s.id === 'salt-creek').now.water_f.confidence = { level: 'high', score: 0.8 };
  assert.match(S.page(f2, ST()), /<span class="sf-nw"><b class="sv">74\u00B0F<\/b><span class="conf"/, 'the confidence mark stays on its value');
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../static/css/surf.css'), 'utf8');
  assert.match(css, /\.sf \.sf-u\{display:inline-block;max-width:100%\}/, 'the phrase wraps as a unit');
  assert.match(css, /\.sf \.sf-sep,\.sf-tmr \.sf-sep\{word-spacing:[^}]*background:radial-gradient/, 'the separator stays a collapsible inline space, in the spot sheet too');
});

test('latitude chart: the middle place names show only where the chart is wide enough; buoys run full width under it', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../static/css/surf.css'), 'utf8');
  assert.match(css, /\.sf-lat\{--ar:2\/1;container-type:inline-size\}/);
  assert.match(css, /\.sf-lat \.xt\.sf-xm\{display:none\}\n@container \(min-width:32rem\)\{\.sf-lat \.xt\.sf-xm\{display:block\}\}/);
  assert.match(css, /html:not\(\.tv\) \.sf-temp,html:not\(\.tv\) \.sf-buoys\{grid-column:1\/-1\}/, 'D and XL: no half pins the buoys beside the chart');
  assert.equal(count(css, /grid-column:span 6/g), 1, 'only TV keeps the span its board was tuned with');
  assert.equal(count(css, /\.sf-temp\{order:8[;}]/g), 3, 'L, T and D: the chart sits above the buoy list');
  assert.equal(count(css, /\.sf-buoys\{order:9[;}]/g), 3);
});

test('TV board: the seven home spots, the coast strip and the top three Best cards; the five-card section follows it', () => {
  const html = S.page(feed(), ST());
  const b0 = html.indexOf('<div class="board sf-board">'), best = html.indexOf('<section class="sect sf-best sf-cap3">');
  const board = html.slice(b0, best);
  assert.ok(board.indexOf('class="sect sf-mine"') < board.indexOf('class="sect sf-coast"') && board.indexOf('class="sect sf-coast"') < board.indexOf('class="sect sf-best3"'));
  assert.equal(count(board.slice(board.indexOf('sf-best3')), /<button class="spot"/g), 3, 'three Best cards on the board');
  assert.equal(count(html.slice(best, html.indexOf('sf-regions')), /<button class="spot"/g), 5, 'five below, for every other class (P and L show three and Show 2 more)');
  assert.match(html.slice(best, html.indexOf('sf-regions')), /<button class="btn sf-more sf-more5" data-surf="open" data-k="best">Show 2 more<\/button><\/section>/);
  assert.ok(!/sf-regions|sf-alerts/.test(board));
});

test('TV coast hooks: short labels for the long names, the unit in its own span, the unit named once in the title', () => {
  const f = feed();
  f.regions.push({ id: 'san-luis-obispo', name: 'San Luis Obispo', wave_ft: [11, 14], rating: 7, word: 'Good' },
    { id: 'monterey-santa-cruz', name: 'Monterey and Santa Cruz', wave_ft: [9, 12], rating: 7, word: 'Good' },
    { id: 'sonoma-del-norte', name: 'Sonoma to Del Norte', wave_ft: [15, 18], rating: 4, word: 'Fair' });
  const html = S.page(f, ST());
  const coast = html.slice(html.indexOf('class="sect sf-coast"'), html.indexOf('class="sect sf-best3"'));
  assert.match(coast, /<small data-tv-short="San Luis" data-tv-full="San Luis Obispo">San Luis Obispo<\/small>/);
  assert.match(coast, /<small data-tv-short="Santa Cruz" data-tv-full="Monterey and Santa Cruz">Monterey and Santa Cruz<\/small>/);
  assert.match(coast, /<small data-tv-short="North Coast" data-tv-full="Sonoma to Del Norte">/);
  assert.match(coast, /<small>Orange County<\/small>/, 'short names are only for the long ones');
  assert.match(coast, /<b>11-14<span class="sf-cu">\u00A0ft<\/span><\/b>/);
  assert.match(coast, /aria-label="San Luis Obispo: Good, 11-14\u00A0ft"/, 'the accessible name keeps the full region and the unit');
  assert.match(coast, /<span>Coast<span class="sf-tvu"> \u00B7 feet<\/span><\/span>/);
  for (const w of ['San Luis', 'Santa Cruz', 'SF and Marin', 'North Coast']) assert.ok(w.split(' ').every(x => x.length <= 7), w + ' breaks only on spaces at seven characters a line');
});

test('a fetch that never settles ends in "Surf is not reporting." through the real registry, bounded at 60 s', async () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
  const A = '// ==== DECK PAGES REGISTRY BEGIN', B = '// ==== DECK PAGES REGISTRY END ====';
  const timers = [];
  const sb = {
    console: { error() {} }, Promise, Date, AbortController,
    fetch: () => new Promise(() => {}), // never answers
    setTimeout: (fn, ms) => { timers.push(ms); return setTimeout(fn, 0); }, clearTimeout
  };
  const P = vm.runInNewContext(deck.slice(deck.indexOf(A), deck.indexOf(B)) + '\nDeckPages;', sb, { timeout: 1000 });
  P.mark = () => true;
  const Surf = load(D, P);
  assert.equal(Surf.FETCH_MS, 60000);
  const c = ctxFake();
  await P.page('surf').show(c);
  assert.ok(timers.includes(60000), 'the overview fetch is bounded at 60 s');
  assert.match(c.el.innerHTML, /Surf is not reporting\./);
  assert.match(c.el.innerHTML, /data-retry="surf"/);
});
