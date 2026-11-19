// node --test tests/surf_better.test.js
// Round "Better", lane DoSurf (2026-11-15): Surf answers first (M3), the coast strip shows height (V9, W3, A10), the
// outlook says tomorrow in figures (F6, V22), the TV board names its marks (V10), an ended forecaster line is not shown
// (D8), and the live cams are back (L11, L12).
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { S, D, load, feed, regionFile, NOV } = require('./surf_fixture.js');

const css = fs.readFileSync(path.join(__dirname, '../static/css/surf.css'), 'utf8');
const ST = (o = {}) => Object.assign({ region: 'orange-county', good: false, sort: 'rating', more: 50 }, o);
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const count = (s, re) => (s.match(re) || []).length;
// the CSS `order` of each section inside one @media block
function orders(media) {
  const i = css.indexOf(media);
  assert.ok(i >= 0, 'media block ' + media);
  const block = css.slice(i, css.indexOf('\n}', i));
  return Object.fromEntries([...block.matchAll(/\.sf-([a-z0-9]+)\{order:(\d+)/g)].map(m => [m[1], +m[2]]));
}

test('M3 on P and L: alerts, Your spots, then Best right now before the coast strip and the cams', () => {
  for (const media of ['@media (max-width:599px){\n  .sf-alerts{order:1}', '@media (min-width:600px) and (max-height:499px){']) {
    const o = orders(media);
    assert.ok(o.alerts < o.mine && o.mine < o.best && o.best < o.coast && o.coast < o.cams && o.cams < o.regions, media + ' ' + JSON.stringify(o));
  }
  // Best right now shows three on a phone, the other two behind one Show 2 more, and Show fewer after it
  assert.match(css, /\.sf-cap3:not\(\.open\) \.cards>\.spot:nth-child\(n\+4\)\{display:none\}/);
  assert.match(css, /\.sf-cap3:not\(\.open\) \.sf-more5,\.sf-cap3\.open \.sf-fewer5\{display:inline-flex\}/);
  const open = S.page(feed(), ST({ open: { best: true } }));
  assert.match(open, /<section class="sect sf-best sf-cap3 open">[^]*data-surf="fewer" data-k="best">Show fewer<\/button><\/section>/);
});

test('M3 from laptop up: the alerts line, then Your spots 6/12 beside Best right now 6/12, then the coast strip; TV keeps its board', () => {
  const o = orders('@media (min-width:1100px) and (min-height:500px){\n  .sf{');
  assert.ok(o.alerts < o.mine && o.mine < o.best && o.best < o.coast && o.coast < o.cams, JSON.stringify(o));
  assert.match(css, /html:not\(\.tv\) \.sf-mine\{grid-column:1\/7\}html:not\(\.tv\) \.sf-best\{grid-column:7\/-1\}/);
  assert.match(css, /html:not\(\.tv\) \.sf-mine \.cards,html:not\(\.tv\) \.sf-best \.cards\{grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,10\.5rem\),1fr\)\)\}/);
  // the alerts block is one row from 600 px: the quiet coast line beside the home line
  assert.match(css, /@media \(min-width:600px\)\{\.sf-alerts\{flex-direction:row;flex-wrap:wrap/);
  assert.match(css, /html\.tv \.sf>\.sf-best,html\.tv \.sf-spots,html\.tv \.sf-cams\{display:none\}/, 'TV: the board, never the cams');
});

const tall = () => {
  const f = feed();
  f.regions.push({ id: 'oregon-south', name: 'Oregon South', wave_ft: [21, 26], rating: 4, word: 'Fair' });
  return f;
};

test('V9, W3: each coast cell draws its height on one shared scale in its rating shade; no reading keeps the hatch', () => {
  const html = S.coastHtml(tall(), 'orange-county');
  const bar = id => { const m = new RegExp('data-key="' + id + '"[^>]*><i><span class="sf-hb" style="--h:(\\d+)%"><\\/span><\\/i>').exec(html); return m ? +m[1] : null; };
  assert.equal(bar('oregon-south'), 100, 'the tallest region fills the cell');
  assert.equal(bar('orange-county'), 23, 'Orange County 5-6 ft: 6 of 26');
  assert.equal(bar('baja-sur'), 27, 'Baja Sur 5-7 ft: 7 of 26');
  assert.equal(bar('ventura'), null, 'no reading: no bar');
  assert.match(html, /<button type="button" class="cs none" data-q="0" data-key="ventura"[^>]*><i><\/i>/);
  assert.match(html, /<p class="note sf-cnote"><span class="sf-cn-t">Tallest Oregon South 21-26\u00A0ft\. <\/span>One height scale; brighter is a better rating\./);
  assert.match(css, /@media \(min-width:1100px\) and \(min-height:500px\)\{\.sf-cn-t\{display:none\}\}/, 'D and TV print the figures, so the note names no tallest region');
  assert.match(css, /\.sf \.coast \.cs:not\(\.none\)>i\{background:var\(--c-panel-2\)\}/, 'the cell is a track');
  assert.match(css, /\.sf-hb\{position:absolute;left:0;right:0;bottom:0;height:var\(--h\)/);
  for (let q = 3; q <= 5; q++) assert.match(css, new RegExp('\\.sf \\.cs\\[data-q="' + q + '"\\] \\.sf-hb\\{background:var\\(--c-ramp-' + q + '\\)\\}'), 'shade ' + q);
  // a 1 ft region against 26 ft still draws a bar
  const f = tall();
  f.regions.push({ id: 'oregon-north', name: 'Oregon North', wave_ft: [1, 1], rating: 1, word: 'Poor' });
  assert.match(S.coastHtml(f, ''), /data-key="oregon-north"[^>]*><i><span class="sf-hb" style="--h:4%">/);
});

test('A10: on a phone the coast cells fill the panel (at least 24 px each at 390)', () => {
  assert.match(css, /@media \(max-width:599px\)\{\.sf \.coast\{padding-left:2px;padding-right:2px\}\.sf \.coast ol\{gap:1px\}/);
  // 390 viewport: 358 px of content, a 1 px border each side, 2 px padding, 13 gaps of 1 px, 14 cells
  assert.ok((358 - 2 - 4 - 13) / 14 >= 24);
});

test('V10: the coast note names the hatch and the hollow square, and the TV board shows it', () => {
  const html = S.page(feed(), ST());
  const board = html.slice(html.indexOf('<div class="board sf-board">'), html.indexOf('class="sect sf-best3"'));
  assert.match(board, /One height scale; brighter is a better rating\. Striped or an empty square means forecast only\.<\/p>/, 'plain words for the hatch and the hollow square');
  assert.match(css, /html\.tv \.sf-cnote\{/);
  assert.doesNotMatch(css, /html\.tv[^{]*\.sf-cnote[^{]*\{[^}]*display:none/);
  // no model-only spot or region anywhere: the line says nothing about forecast only
  const f = feed();
  f.spots = f.spots.filter(s => !S.isModel(s));
  assert.doesNotMatch(S.coastHtml(f, ''), /forecast only/);
});

test('F6, V22: the outlook says tomorrow morning and afternoon in figures, and its note says what bars and shades mean', () => {
  const f = feed();
  const s = f.spots[0];
  const sh = S.spotSheet(s, f, regionFile(), NOV);
  const out = sh.body.slice(sh.body.indexOf('-day outlook'));
  assert.match(text(out), /Tomorrow: morning 3-5 ft Good afternoon 3-4 ft Fair/);
  assert.match(out, /<p class="sf-tmr">Tomorrow: morning <b class="sv">3-5\u00A0ft<\/b> Good<span class="sf-sep"> <\/span>afternoon <b class="sv">3-4\u00A0ft<\/b> Fair<\/p>/);
  assert.match(out, /Left bar morning, right bar afternoon, on one scale; brighter is a better rating\./);
  // tomorrow is read in the spot's zone: a day later the feed's last day is today, so no tomorrow line
  assert.equal(S.tomorrowOf(s.days, s.tz, NOV + 86400), null);
  assert.equal(S.tomorrowOf(s.days, s.tz, NOV).date, '2026-11-15');
  assert.equal(S.tomorrowOf([{ label: 'Today' }, { label: 'Sun', am: {} }], 'America/Los_Angeles', NOV).label, 'Sun', 'no dates: the day after Today');
});

test('D8: a forecaster line whose period has ended is not shown, on the region card and in the spot sheet', () => {
  const f = feed();
  const oc = f.regions.find(r => r.id === 'orange-county');
  oc.forecaster = { ft: [3, 6], until: NOV + 99999, end: NOV - 60, end_label: 'Sat 6 pm' };
  const card = h => { const i = h.indexOf('data-region="orange-county"'); return h.slice(i, h.indexOf('</button>', i)); };
  assert.doesNotMatch(card(S.page(f, ST(), NOV)), /Forecaster/, 'its period ended a minute ago');
  oc.forecaster.end = NOV + 3600;
  oc.forecaster.period = 'This afternoon through monday';
  assert.match(card(S.page(f, ST(), NOV)), /Forecaster: 3-6\u00A0ft, this afternoon through Monday/, 'the NWS period, weekdays capitalised');
  // an older feed carries only the product's until
  oc.forecaster = { ft: [3, 6], until: NOV - 1, until_label: 'Sat 6:59 pm' };
  assert.doesNotMatch(card(S.page(f, ST(), NOV)), /Forecaster/);
  const s = f.spots[0];
  s.forecaster = { ft: [3, 6], period: 'Tonight', until: NOV + 99999, until_label: 'Mon 3 am', end: NOV + 3600, end_label: 'Sat 8 pm' };
  const body = S.spotSheet(s, f, regionFile(), NOV).body;
  assert.match(body, /Forecaster<\/dt><dd>3-6\u00A0ft \u00B7 Tonight<\/dd>/, 'the period, never the product expiry');
  assert.doesNotMatch(body, /Mon 3 am|until Sat 8 pm/);
  assert.doesNotMatch(S.spotSheet(s, f, regionFile(), NOV + 7200).body, /Forecaster/);
  assert.equal(S.fcLive({ ft: [3, 6] }, NOV).ft[1], 6, 'no end at all: shown');
});

test('per-spot heights: the swell parts say they are offshore; a sensor height says measured; the Data sheet explains the printed height', () => {
  const f = feed(), rf = regionFile();
  const s = f.spots[0];
  let body = S.spotSheet(s, f, rf, NOV).body;
  assert.match(body, /<h3>Offshore swell<\/h3><dl class="kv">[^]*<\/dl><p class="note sf-swn">At sea, before the coast shapes it at this break\.<\/p>/);
  assert.doesNotMatch(body, /Swell parts/);
  s.now.height_basis = 'sensor';
  body = S.spotSheet(s, f, rf, NOV).body;
  assert.match(body, /<span class="h">Height, measured<\/span>/);
  // the Data sheet: a break's own height is the nearshore model scaled to the area level, never the blend's parts alone
  const rs = rf.spots.find(x => x.id === 'salt-creek');
  s.now.hs_ft = 5.6; s.now.height_basis = 'spot';
  rs.parts.scale = { factor: 1.76, mop_id: 'OC512', mop_ft: 3.2, mop_age_min: 30, blend_ft: 4.4, scaled_ft: 5.6, spots: 24, used: true, why: null, sensor: null };
  let dm = S.dataModel(f, 'spot:salt-creek', rf);
  assert.equal(dm.blends[0].label, 'Wave height, Salt Creek');
  assert.equal(dm.blends[0].value, '5.6 ft');
  assert.deepEqual(dm.blends[0].parts.map(p => p.name + ' ' + p.value), ['Nearshore model OC512 3.2 ft', 'Area level 4.4 ft']);
  assert.match(dm.blends[0].note, /times 1\.76, the area level over the nearshore model across 24 breaks/);
  assert.equal(dm.blends[1].label, 'Area level, orange-county');
  assert.equal(dm.blends[1].value, '4.4 ft', 'the blend parts explain the area level, not the printed 5.6');
  // a sensor at the break
  s.now.hs_ft = 4.6; s.now.height_basis = 'sensor';
  rs.parts.scale = Object.assign({}, rs.parts.scale, { scaled_ft: 2.9, used: false, sensor: { id: 'LJPC1', kind: 'pier', km: 0, ft: 4.6, age_min: 12 } });
  dm = S.dataModel(f, 'spot:salt-creek', rf);
  assert.deepEqual(dm.blends[0].parts.map(p => p.name + ' ' + p.value), ['Pier LJPC1 0.0 km 4.6 ft']);
  assert.match(dm.blends[0].note, /^Measured at the break; the nearshore model scaled to 2\.9 ft disagreed with it$/);
  // region basis or no scale: as before, one blend for the printed height
  s.now.height_basis = 'region'; s.now.hs_ft = 4.2;
  dm = S.dataModel(f, 'spot:salt-creek', rf);
  assert.equal(dm.blends[0].label, 'Wave height, Salt Creek');
  assert.equal(dm.blends[0].value, '4.2 ft');
});

// ---------- live cams ----------
const YT = id => 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&mute=1&playsinline=1&rel=0';
const SL = (n, id) => 'https://www.surfline.com/surf-report/' + n + '/' + id;
const OC = () => ({
  generated_at: NOV - 600,
  break_cams: [
    { spot: 'Salt Creek', aka: null, surfline_url: SL('salt-creek', '5842041f4e65fad6a770882e'),
      cam: { id: 'monarch-bay-beach-club', name: 'Monarch Bay Beach Club', operator: 'HDOnTap', kind: 'link', distance_km: 0.7,
        view_url: 'https://hdontap.com/stream/621213/monarch-bay-beach-club-live-webcam/', player_url: null,
        snapshot_thumbnail_url: 'https://storage.hdontap.com/wowza_stream_thumbnails/snapshot_x.jpg' } },
    { spot: 'Strands', cam: { id: 'huntington-beach-harbor', name: 'Huntington Beach Harbor, Laguna Cliffs Resort', operator: 'HDOnTap', kind: 'link',
      view_url: 'https://hdontap.com/stream/994481/huntington-beach-harbor-laguna-cliffs-resort-live-webcam/', player_url: null }, surfline_url: SL('strands', '5842041f4e65fad6a77088d5') },
    { spot: 'Doheny', cam: { id: 'huntington-beach-harbor', name: 'Huntington Beach Harbor, Laguna Cliffs Resort', operator: 'HDOnTap', kind: 'link',
      view_url: 'https://hdontap.com/stream/994481/huntington-beach-harbor-laguna-cliffs-resort-live-webcam/', player_url: null }, surfline_url: SL('doheny-state-beach', '5842041f4e65fad6a77088d7') },
    { spot: 'San Clemente Pier', aka: 'T-Street', surfline_url: SL('t-street', '5842041f4e65fad6a7708830'),
      cam: { id: 'san-clemente-beach', name: 'San Clemente Beach Camera', operator: 'City of San Clemente', kind: 'embed', distance_km: 0,
        view_url: 'https://www.youtube.com/watch?v=2c7NV66YzKA', player_url: YT('2c7NV66YzKA'), snapshot_thumbnail_url: 'https://i.ytimg.com/vi/2c7NV66YzKA/hqdefault.jpg' } },
    { spot: 'Trestles', cam: null, surfline_url: SL('lower-trestles', '5842041f4e65fad6a770888a') },
    { spot: 'San Onofre', cam: null, surfline_url: SL('san-onofre-state-beach', '584204204e65fad6a77099d4') },
    { spot: 'Huntington Pier', cam: { id: 'huntington-beach-pier-city', name: 'View from Huntington Beach Pier', operator: 'City of Huntington Beach', kind: 'embed',
      view_url: 'https://www.youtube.com/watch?v=mhQjsLBfOoY', player_url: YT('mhQjsLBfOoY') }, surfline_url: SL('huntington-beach-pier-northside', '5842041f4e65fad6a7708827') }
  ]
});

test('L11, L12: the two city piers play here as tiles, every other cam is a link row, a break with no cam links its report', () => {
  const html = S.page(feed(), ST({ oc: OC() }));
  const cams = html.slice(html.indexOf('<section class="sect sf-cams">'), html.indexOf('<section class="sect sf-regions">'));
  assert.ok(html.indexOf('class="sect sf-best') < html.indexOf('sf-cams'), 'after Best right now and the coast');
  assert.match(cams, /<span>Live cams<\/span>/);
  assert.equal(count(cams, /data-play="/g), 2, 'San Clemente and Huntington Beach piers');
  assert.match(cams, /data-surf="cam" data-play="https:\/\/www\.youtube-nocookie\.com\/embed\/2c7NV66YzKA\?autoplay=1&amp;mute=1&amp;playsinline=1&amp;rel=0" aria-label="Play live cam: San Clemente Pier"/);
  assert.match(cams, /aria-label="Play live cam: Huntington Pier"/);
  assert.equal(count(cams, /data-surf="camstop">Stop<\/button>/g), 2, 'each tile has its Stop');
  assert.match(cams, /<div class="sf-snap" data-cam="monarch-bay-beach-club"><div class="frow sf-snr"><button class="sf-snb" data-surf="snap" aria-expanded="false"><span class="fl"><b>Salt Creek<\/b><small>Monarch Bay Beach Club · tap for a picture<\/small><\/span><\/button><a class="ext sf-live" href="https:\/\/hdontap\.com\/stream\/621213\/monarch-bay-beach-club-live-webcam\/" target="_blank" rel="noopener noreferrer">Live view<\/a><\/div><\/div>/, 'a snapshot row, the live view beside it');
  assert.match(cams, /<b>Strands and Doheny<\/b><small>Huntington Beach Harbor, Laguna Cliffs Resort · opens at HDOnTap/, 'one row per cam, its breaks named');
  assert.match(text(cams), /No free cam at Trestles and San Onofre\. Trestles on Surfline San Onofre on Surfline/);
  assert.match(cams, /href="https:\/\/www\.surfline\.com\/surf-report\/lower-trestles\/5842041f4e65fad6a770888a"/);
  assert.doesNotMatch(cams, /<img|<iframe|ytimg|storage\.hdontap|thumbnail/, 'no picture from another host, no frame before a tap');
});

test('inside the iPhone app every cam is a link row, the piers to their YouTube page', () => {
  const html = S.camsSection(OC(), false);
  assert.equal(count(html, /data-play=/g), 0);
  assert.equal(count(html, /<a class="frow"/g), 4);
  assert.match(html, /href="https:\/\/www\.youtube\.com\/watch\?v=2c7NV66YzKA"[^]*San Clemente Beach Camera · opens on YouTube/);
  const P = load(D, undefined);
  assert.equal(P._state.shell, false, 'the node test runner is not the app');
  assert.equal(D.isDeckShell('Mozilla/5.0 (iPhone) OmarchyDeck/1.0'), true);
});

test('a cam URL outside its exact pattern never reaches an attribute; names are escaped; no feed, no section', () => {
  const o = OC();
  o.break_cams[3].cam.player_url = 'https://www.youtube.com/embed/2c7NV66YzKA?autoplay=1&mute=1&playsinline=1&rel=0';
  o.break_cams[6].cam.view_url = 'javascript:alert(1)';
  o.break_cams[4].surfline_url = 'https://www.surfline.com/surf-report/x/"onclick="a';
  o.break_cams[0].cam.name = '<img src=x onerror=1>';
  const html = S.camsSection(o, true);
  assert.equal(count(html, /data-play=/g), 0, 'only the privacy-enhanced host plays');
  assert.doesNotMatch(html, /javascript:|onclick|<img/);
  assert.match(html, /&lt;img src=x onerror=1&gt;/);
  assert.match(text(html), /No free cam at Trestles, San Onofre and Huntington Pier\./, 'a cam with a bad page drops to the no-cam line');
  assert.ok(S.CAM_PLAYER_RE.test(YT('2c7NV66YzKA')));
  assert.ok(!S.CAM_PLAYER_RE.test('https://portal.hdontap.com/s/embed/?stream=x'));
  for (const bad of [null, { error: 'file missing' }, { items: [] }, { break_cams: [] }]) assert.equal(S.camsSection(bad, true), '');
  assert.doesNotMatch(S.page(feed(), ST()), /sf-cams/);
});

test('route: the cams come from the outdoors feed; a failed read keeps the last good list; a playing cam holds a timer repaint', async () => {
  const reg = {};
  let ocRes = { ok: true, status: 200, data: OC() };
  const calls = [];
  const pages = { register: (r, h) => { reg[r] = h; }, get: async p => { calls.push(p); return p === 'outdoors' ? ocRes : { ok: true, status: 200, data: feed() }; }, mark: () => true };
  const P = load(D, pages);
  const el = { innerHTML: '', dataset: {}, addEventListener() {}, querySelector: () => null, contains: x => x === el.box };
  const c = { route: 'surf', el, head: null };
  await reg.surf.show(c);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(calls.sort(), ['outdoors', 'surf-coast']);
  assert.match(el.innerHTML, /sf-cams[^]*Play live cam: San Clemente Pier/);
  // the next read fails: the list stays (and outdoors is read again at most every ten minutes)
  P._state.ocAt = 0;
  ocRes = { ok: false, status: 0, data: null };
  await reg.surf.refresh(c, true);
  await new Promise(r => setTimeout(r, 0));
  assert.match(el.innerHTML, /Play live cam: San Clemente Pier/);
  // a cam plays: a timer repaint changes nothing on the page and waits
  el.box = {};
  const frame = { removed: 0, remove() { this.removed++; } };
  P._cam.cur = { box: Object.assign(el.box, { classList: { remove() {} } }), frame };
  el.innerHTML = 'PLAYING';
  await reg.surf.refresh(c, true);
  assert.equal(el.innerHTML, 'PLAYING');
  assert.equal(P._state.pending, true);
  assert.equal(frame.removed, 0);
  // leaving the page stops it
  reg.surf.hide(c);
  assert.equal(frame.removed, 1);
  assert.equal(P._cam.cur, null);
  assert.equal(P._state.pending, false);
});
