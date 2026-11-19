// node --test tests/surf_fold.test.js
// Round "Better", lane DoSurf PR b (2026-11-15): Your spots fold (M4, G4), a break with no wave data of its own shows its
// height once on its region's head (PLAN decision 4), the HDOnTap snapshots on a tap (L12), the piers as rows on a phone,
// the wide spots table (W4-7), and the reads' shape and a null age (E5, E7).
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
const mineOf = html => html.slice(html.indexOf('class="sect sf-mine'), html.indexOf('class="sect sf-coast"'));
const basis = (f, b, pick = s => s.region === 'orange-county') => { for (const s of f.spots) if (pick(s)) s.now.height_basis = b; return f; };

test('M4: home breaks that read the same share one card, each name its own tap; the others keep their own card', () => {
  const mine = mineOf(S.page(feed(), ST()));
  // Salt Creek, Strands and Trestles: 5-6 ft, Great, 14 s SW, glassy 4 kt, 74°F, low tide 7:08 pm; San Clemente Pier
  // and Huntington: 4-5 ft, Good, the same period, wind, water (74 and 73.8 both read 74°F) and tide
  assert.equal(count(mine, /<div class="spot sf-grp" style="--sf-spots:\d+">/g), 2);
  const grp = mine.slice(mine.indexOf('sf-grp'), mine.indexOf('</div></div>', mine.indexOf('sf-grp')));
  assert.deepEqual([...grp.matchAll(/<button class="sf-nm" data-open="spot" data-key="([^"]+)">([^<]+)<\/button>/g)].map(m => m[1]), ['salt-creek', 'strands', 'trestles']);
  assert.match(grp, /<div class="big">5-6<span class="u">ft<\/span><\/div>/, 'the height once for the three');
  assert.doesNotMatch(grp, /<button class="spot"/, 'buttons never nest');
  assert.equal(count(mine, /<button class="spot" data-open="spot"/g), 2, 'Doheny and San Onofre keep their own card');
  // every home break is still reachable from Your spots, in the order of each group's first break
  assert.deepEqual([...mine.matchAll(/data-key="([^"]+)"/g)].map(m => m[1]), ['salt-creek', 'strands', 'trestles', 'doheny', 'san-clemente-pier', 'huntington', 'san-onofre']);
  // a different wind word splits them
  const f = feed();
  f.spots.find(s => s.id === 'strands').now.wind.word = 'light onshore';
  assert.deepEqual([...mineOf(S.page(f, ST())).matchAll(/class="sf-nm"[^>]*data-key="([^"]+)"/g)].map(m => m[1]), ['salt-creek', 'trestles', 'san-clemente-pier', 'huntington'], 'Strands leaves the first group');
  // a different reason line splits them too, and a group prints the reason it shares
  const g = feed();
  for (const id of ['salt-creek', 'strands', 'trestles']) g.spots.find(s => s.id === id).now.reason = '4 ft at 14 s from SW, sheltered from the west swell';
  g.spots.find(s => s.id === 'trestles').now.reason = '4 ft at 14 s from SW, big sets on the outside';
  const gm = mineOf(S.page(g, ST()));
  assert.deepEqual([...gm.matchAll(/class="sf-nm"[^>]*data-key="([^"]+)"/g)].map(m => m[1]), ['salt-creek', 'strands', 'san-clemente-pier', 'huntington'], 'Trestles keeps its own card');
  assert.match(gm, /<div class="spot sf-grp" style="--sf-spots:2"><header><span class="sf-nms"><button class="sf-nm" data-open="spot" data-key="salt-creek">Salt Creek<\/button><span class="sf-nmc">, <\/span><button class="sf-nm" data-open="spot" data-key="strands">Strands<\/button><\/span>[^]*?<\/div><p class="why">Sheltered from the west swell<\/p><\/div>/, 'the shared reason prints once on the group card');
  assert.match(gm, /data-key="trestles">[^]*?<p class="why">Big sets on the outside<\/p>/);
  assert.match(css, /\.sf-nm\{display:inline-flex;align-items:center;min-height:var\(--hit\)/, 'each name is a 44 px target');
});

test('decision 4: breaks with no wave data of their own fold under the region head, the height once; their rows keep rating, wind and tide', () => {
  const f = basis(feed(), 'region');
  const mine = mineOf(S.page(f, ST()));
  assert.equal(count(mine, /<div class="spot sf-rhd" style="--sf-spots:7">/g), 1, 'one head for Orange County, spanning its seven breaks on TV');
  assert.match(mine, /<header><b>Orange County<\/b><span class="sf-rht">Height for the region<\/span><\/header><div class="spot-m"><div class="big">5-6<span class="u">ft<\/span><\/div><p class="one"><b class="sv">72-75\u00B0F<\/b><\/p><\/div>/, 'height and water once; no region period beside the breaks\u2019 own');
  assert.doesNotMatch(mine.slice(0, mine.indexOf('sf-rrows')), /\d\u00A0s\b/, 'the head prints no period');
  assert.equal(count(mine, /class="big"/g), 1, 'no break prints a figure of its own');
  assert.equal(count(mine, /<button class="frow" data-open="spot" data-key=/g), 7, 'every home break keeps its row');
  const row = mine.slice(mine.indexOf('data-key="salt-creek"'), mine.indexOf('</button>', mine.indexOf('data-key="salt-creek"')));
  assert.match(row, /<b>Salt Creek<\/b><small><b class="sv">4\u00A0kt<\/b> <span class="sf-w">glassy<\/span><span class="sf-sep"> <\/span><span class="sf-u">Low tide <b class="sv">7:08 pm<\/b><\/span><\/small>/);
  assert.match(row, /<span class="pips" data-q="5"/);
  assert.doesNotMatch(row, /\d-\d<\/|\bft\b/, 'no height on the row');
  // a home break with its own height beside them keeps its card
  f.spots.find(s => s.id === 'huntington').now.height_basis = 'spot';
  const m2 = mineOf(S.page(f, ST()));
  assert.equal(count(m2, /<button class="frow" data-open="spot"/g), 6);
  assert.match(m2, /<button class="spot" data-open="spot" data-key="huntington">[^]*<div class="big">4-5/);
});

test('decision 4: such a break stays in Best right now, on the TV board and in every sort, its height on the region line', () => {
  const f = basis(feed(), 'region', () => true);
  const html = S.page(f, ST());
  const best = html.slice(html.indexOf('class="sect sf-best sf-cap3'), html.indexOf('class="sect sf-regions"'));
  assert.equal(count(best, /<button class="spot"/g), 5, 'all five still ranked');
  const cabo = best.slice(best.indexOf('data-key="cabo-falso"'), best.indexOf('</button>', best.indexOf('data-key="cabo-falso"')));
  assert.doesNotMatch(cabo, /class="big"/);
  assert.match(cabo, /<p class="one sf-reg">Baja Sur · <b class="sv"><span class="model" title="Model forecast, no buoy nearby">5-7\u00A0ft<span class="vh">, model forecast, no buoy nearby<\/span><\/span><\/b><\/p>/, 'the region line carries the region figure, forecast only marked');
  const board = html.slice(html.indexOf('class="sect sf-best3"'), html.indexOf('</section>', html.indexOf('class="sect sf-best3"')));
  assert.equal(count(board, /<button class="spot"/g), 3, 'the TV board keeps its three');
  assert.deepEqual(S.regionSpots(f.spots, 'all', { sort: 'height' }).map(s => s.id).slice(0, 2), ['cabo-falso', 'cardiff-reef'], 'sorted by height as before');
  // the list prints Region in the height column and one line says why, with the figure for a one-region list
  const list = S.spotsSection(f, ST(), { 'orange-county': 'Orange County' }, {});
  assert.match(list, /<p class="note sf-rnote">Region: no wave reading of its own, so the height is the region\u2019s, Orange County 5-6\u00A0ft\.<\/p>/);
  assert.equal(count(list.slice(list.indexOf('sf-plist')), /<span class="sf-rgn">Region<\/span>/g), 14, 'seven phone rows and seven table cells');
  assert.match(S.spotsSection(f, ST({ region: 'all' }), {}, {}), /on its region card\./);
  assert.doesNotMatch(S.spotsSection(feed(), ST(), {}, {}), /sf-rnote|sf-rgn/, 'an older feed draws as before');
  // the spot sheet names the figure as the region's
  const sh = S.spotSheet(f.spots[0], f, regionFile(), NOV).body;
  assert.match(sh, /<span class="h">Height for the region<\/span><b class="v">5-6<span class="u">ft<\/span>/);
});

const OCAM = () => ({ generated_at: NOV - 600, break_cams: [
  { spot: 'Salt Creek', cam: { id: 'monarch-bay-beach-club', name: 'Monarch Bay Beach Club', operator: 'HDOnTap', kind: 'link',
    view_url: 'https://hdontap.com/stream/621213/monarch-bay-beach-club-live-webcam/', player_url: null,
    snapshot_thumbnail_url: 'https://storage.hdontap.com/wowza_stream_thumbnails/snapshot_hosb6_fulkra_monarch_resort_beach.stream_8FXn5TS.jpg' } },
  { spot: 'Strands', cam: { id: 'dana-point-harbor', name: 'Dana Point Harbor, Laguna Cliffs Resort', operator: 'HDOnTap', kind: 'link',
    view_url: 'https://hdontap.com/stream/994481/dana-point-harbor-laguna-cliffs-resort-live-webcam/', player_url: null,
    snapshot_thumbnail_url: 'https://storage.hdontap.com/wowza_stream_thumbnails/snapshot_hosb6_danapoint-harbor_lgm.stream.jpg' } },
  { spot: 'Doheny', cam: { id: 'dana-point-harbor', name: 'Dana Point Harbor, Laguna Cliffs Resort', operator: 'HDOnTap', kind: 'link',
    view_url: 'https://hdontap.com/stream/994481/dana-point-harbor-laguna-cliffs-resort-live-webcam/', player_url: null,
    snapshot_thumbnail_url: 'https://storage.hdontap.com/wowza_stream_thumbnails/snapshot_hosb6_danapoint-harbor_lgm.stream.jpg' } }
] });

test('L12: the home-break snapshots come back on a tap only, in a fixed 16:9 box with no referrer, the live view beside', () => {
  let html = S.camsSection(OCAM(), true, new Set());
  assert.equal(count(html, /class="sf-snap"/g), 2, 'Salt Creek; Strands and Doheny');
  assert.doesNotMatch(html, /<img|storage\.hdontap/, 'nothing from their host before a tap');
  assert.equal(count(html, /<a class="ext sf-live" href="https:\/\/hdontap\.com\/stream\/[^"]+" target="_blank" rel="noopener noreferrer">Live view<\/a>/g), 2);
  html = S.camsSection(OCAM(), true, new Set(['dana-point-harbor']));
  assert.match(html, /<div class="sf-snap on" data-cam="dana-point-harbor">[^]*aria-expanded="true"[^]*Dana Point Harbor, Laguna Cliffs Resort · snapshot[^]*<div class="sf-snapm"><img src="https:\/\/storage\.hdontap\.com\/wowza_stream_thumbnails\/snapshot_hosb6_danapoint-harbor_lgm\.stream\.jpg" alt="Snapshot: Dana Point Harbor, Laguna Cliffs Resort, near Strands and Doheny" referrerpolicy="no-referrer" decoding="async"><\/div><\/div>/);
  assert.equal(count(html, /<img/g), 1, 'only the row tapped open');
  assert.match(css, /\.sf-snapm\{position:relative;aspect-ratio:16\/9;/, 'the box is sized before the picture lands');
  // another host, a path outside the pattern, or the iPhone app: no picture, a plain link row
  const o = OCAM();
  o.break_cams[0].cam.snapshot_thumbnail_url = 'https://evil.example/x.jpg';
  o.break_cams[1].cam.snapshot_thumbnail_url = 'https://storage.hdontap.com/wowza_stream_thumbnails/../x.jpg"onerror="a';
  o.break_cams[2].cam.snapshot_thumbnail_url = 'https://storage.hdontap.com/wowza_stream_thumbnails/../x.jpg"onerror="a';
  html = S.camsSection(o, true, new Set(['monarch-bay-beach-club', 'dana-point-harbor']));
  assert.doesNotMatch(html, /evil|onerror|<img|sf-snap/);
  assert.equal(count(html, /<a class="frow"/g), 2);
  html = S.camsSection(OCAM(), false, new Set(['dana-point-harbor']));
  assert.doesNotMatch(html, /<img|sf-snap/, 'the app blocks other hosts: links only');
});

test('on a phone the two piers are rows until tapped; from T up they stay 16:9 tiles', () => {
  assert.match(css, /@media \(max-width:599px\),\(max-height:499px\)\{\n  \.sf-cam:not\(\.on\) \.sf-camm\{aspect-ratio:auto;background:none\}/);
  assert.match(css, /\.sf-cam:not\(\.on\) \.sf-camv\{position:static;display:flex;align-items:center;gap:var\(--s-3\);min-height:var\(--hit\)/);
  assert.match(css, /\.sf-camh\{display:none;/, 'Tap to play shows only on the row');
  const html = S.camsSection({ break_cams: [{ spot: 'San Clemente Pier', cam: { id: 'scb', name: 'San Clemente Beach Camera', operator: 'City of San Clemente',
    view_url: 'https://www.youtube.com/watch?v=2c7NV66YzKA', player_url: 'https://www.youtube-nocookie.com/embed/2c7NV66YzKA?autoplay=1&mute=1&playsinline=1&rel=0' } }] }, true);
  assert.match(html, /<span class="sf-camn">San Clemente Pier<\/span><span class="sf-camh">Tap to play<\/span>/);
});

test('W4-7: from 1600 px the spots and buoys tables size the name column to its names', () => {
  assert.match(css, /@media \(min-width:1600px\) and \(min-height:500px\)\{html:not\(\.tv\) \.sf \.htbl tr>:first-child\{width:1%;white-space:nowrap\}\}/);
  assert.ok(css.indexOf('width:1%;white-space:nowrap') > css.indexOf('tr>:first-child{width:30%}'), 'the wide rule comes after the laptop rule');
});

test('E5, E7: each read names its shape; an answer with no age is unknown, never just updated; down says Not reporting', async () => {
  const reads = [], marks = [];
  let res = { ok: true, status: 200, data: Object.assign(feed(), { age: undefined }), age: null };
  const reg = {};
  const pages = { register: (r, h) => { reg[r] = h; }, get: async (p, o) => { reads.push([p, o]); return p === 'outdoors' ? { ok: false } : res; }, mark: (c, o) => { marks.push(o); } };
  load(D, pages);
  const el = { innerHTML: '', dataset: {}, addEventListener() {}, querySelector: () => null };
  await reg.surf.show({ route: 'surf', el, head: null });
  const coast = reads.find(r => r[0] === 'surf-coast')[1];
  assert.equal(typeof coast.shape, 'function');
  assert.equal(coast.shape({ spots: [] }), true);
  assert.equal(coast.shape({ spots: 'x' }), false, 'a wrong-typed answer fails the read');
  assert.equal(coast.shape([]), false);
  assert.equal(typeof reads.find(r => r[0] === 'outdoors')[1].shape, 'function');
  assert.equal(marks[marks.length - 1].age, null, 'no age: Not reporting, never 0');
  assert.match(D.fresh(marks[marks.length - 1]), /Not reporting/);
  res = { ok: false, status: 500, data: null, age: 120 };
  marks.length = 0;
  await reg.surf.refresh({ route: 'surf', el, head: null });
  assert.match(el.innerHTML, /Surf is not reporting\./);
  assert.deepEqual(marks, [{ age: null }], 'the mark never keeps an age over "Surf is not reporting"');
});
