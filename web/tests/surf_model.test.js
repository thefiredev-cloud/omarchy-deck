// node --test tests/surf_model.test.js
// Surf page model (static/pages/surf.js): ratings, model-only rules, Mexico tide wording, zone mark, Baja alert wording,
// spot ordering, the latitude chart model and page states. Pure functions: no DOM, no DeckUI.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const { S, feed, spot, NOV, JUL } = require('./surf_fixture.js');

test('ratings are five pips plus the word; the feed word wins over the score', () => {
  assert.deepEqual(S.rate({ rating: 9, word: 'Great' }), { q: 5, word: 'Great' });
  assert.deepEqual(S.rate({ rating: 6, word: 'Good' }), { q: 4, word: 'Good' });
  assert.deepEqual(S.rate({ rating: 4, word: 'Fair' }), { q: 3, word: 'Fair' });
  assert.deepEqual(S.rate({ rating: 1, word: 'Flat' }), { q: 1, word: 'Flat' });
  // a bare score follows the feed's own bands (docs/surf-coast.md after #240: 9.75 / 7.5 / 5), unrounded score first
  assert.deepEqual(S.rate({ rating: 10, score: 9.8 }), { q: 5, word: 'Great' });
  assert.deepEqual(S.rate({ rating: 10, score: 9.61 }), { q: 4, word: 'Good' }, 'a rounded 10 is not Great when the score is 9.61');
  assert.deepEqual(S.rate({ rating: 9 }), { q: 4, word: 'Good' });
  assert.deepEqual(S.rate({ rating: 7 }), { q: 3, word: 'Fair' });
  assert.deepEqual(S.rate({ score: 5 }), { q: 3, word: 'Fair' });
  assert.deepEqual(S.rate({ rating: 4 }), { q: 2, word: 'Poor' });
  assert.deepEqual(S.rate({ rating: null }), { q: 0, word: 'No rating' });
  assert.deepEqual(S.rate(null), { q: 0, word: 'No rating' });
});

test('model-only spots say "about" for period and regions are forecast only only when every spot is', () => {
  const f = feed();
  const cabo = f.spots.find(s => s.id === 'cabo-falso'), salt = f.spots.find(s => s.id === 'salt-creek');
  assert.equal(S.isModel(cabo), true);
  assert.equal(S.isModel(salt), false);
  assert.equal(S.periodText(14, true), 'about 14\u00A0s');
  assert.equal(S.periodText(14.6, false), '15\u00A0s');
  assert.equal(S.periodText(null, true), null);
  assert.equal(S.regionModelOnly('baja-sur', f.spots), true);
  assert.equal(S.regionModelOnly('baja-norte', f.spots), false, 'one Baja Norte spot has a buoy in range');
  assert.equal(S.regionModelOnly('ventura', f.spots), false, 'a region with no spots is not forecast only');
  assert.equal(S.heightText([5, 6]), '5-6');
  assert.equal(S.heightText([5, 5]), '5');
  assert.equal(S.heightText(null), null, 'no reading never becomes 0');
});

test('Mexico tide: a NOAA table near Ensenada draws normally, a model tide is approximate, no station says so', () => {
  const f = feed();
  const ti = Object.fromEntries(f.tides.map(t => [t.id, t]));
  const cabo = f.spots.find(s => s.id === 'cabo-falso');
  const ens = f.spots.find(s => s.id === 'san-miguel');
  const scorpion = f.spots.find(s => s.id === 'scorpion-bay');
  assert.deepEqual(S.tideMode(ens, ti), { kind: 'table', line: '' });
  assert.deepEqual(S.tideMode(cabo, ti), { kind: 'model', line: 'Approximate tide. No tide table here.' });
  assert.deepEqual(S.tideMode(scorpion, ti), { kind: 'none', line: 'No tide table for this spot.' });
  // cards read the same way
  assert.equal(S.tideCardText(cabo, S.tideMode(cabo, ti)), 'High tide about 9:42 am UTC\u22127');
  assert.equal(S.tideCardText(scorpion, S.tideMode(scorpion, ti)), 'No tide table');
  assert.equal(S.tideCardText(ens, S.tideMode(ens, ti)), 'Low tide 7:20 pm', 'Tijuana keeps Pacific time, no zone mark');
});

test('zone mark only where the spot clock differs from Pacific time', () => {
  assert.equal(S.zoneMark('America/Mazatlan', NOV), 'UTC\u22127', 'Baja Sur is an hour ahead in winter');
  assert.equal(S.zoneMark('America/Mazatlan', JUL), '', 'and level with PDT in summer');
  assert.equal(S.zoneMark('America/Tijuana', NOV), '');
  assert.equal(S.zoneMark('America/Los_Angeles', NOV), '');
  assert.equal(S.zoneMark('', NOV), '');
  assert.equal(S.bestText({ label: '7-9 am', day: 'tomorrow', start: NOV }, 'America/Los_Angeles'), 'Tomorrow 7-9 am', 'after dark the best window is tomorrow');
  assert.equal(S.bestText({ label: '4-6 pm', day: 'today', start: NOV }, 'America/Mazatlan'), 'Today 4-6 pm UTC\u22127');
  assert.equal(S.bestText(null, 'America/Los_Angeles'), '');
});

test('Baja alerts read "Offshore seas"; groups touching the home region come first', () => {
  const names = { 'baja-sur': 'Baja Sur', 'baja-norte': 'Baja Norte', 'san-diego': 'San Diego', 'orange-county': 'Orange County', ventura: 'Ventura', 'oregon-north': 'Oregon North' };
  assert.equal(S.alertWord({ event: 'High Seas Warning', regions: ['baja-sur', 'baja-norte'] }), 'Offshore seas');
  assert.equal(S.alertWord({ event: 'High Surf Advisory', regions: ['baja-norte', 'san-diego'] }), 'High surf advisory');
  const g = S.alertGroups([
    { event: 'Gale Warning', regions: ['oregon-north'], end: 100, until_label: 'Sun 3 am', severity: 'Moderate' },
    { event: 'High Surf Advisory', regions: ['ventura'], end: 300, until_label: 'Tue 3 pm', severity: 'Minor' },
    { event: 'High Surf Advisory', regions: ['san-diego', 'orange-county'], end: 200, until_label: 'Sun 10 am', severity: 'Minor' },
    { event: 'High Seas Warning', regions: ['baja-sur'], end: 50, until_label: 'Sat 6 pm', severity: 'Moderate' }
  ], names);
  assert.deepEqual(g.map(x => x.word), ['High surf advisory', 'Offshore seas', 'Gale warning']);
  assert.equal(g[0].text, 'High surf advisory \u00B7 Orange County, San Diego and 1 more region \u00B7 until Tue 3 pm', 'one row per event, latest end');
  assert.equal(g[0].home, true);
  assert.equal(g[1].text, 'Offshore seas \u00B7 Baja Sur \u00B7 until Sat 6 pm');
  assert.deepEqual(S.alertGroups([], names), []);
});

test('home spots keep owner order; best right now ranks by rating then size; the list filters and sorts', () => {
  const f = feed();
  f.spots.reverse();
  assert.deepEqual(S.pinnedSpots(f.spots).map(s => s.pinned), [1, 2, 3, 4, 5, 6, 7]);
  const best = S.bestNow(f.spots);
  assert.equal(best.length, 5);
  assert.deepEqual(best.slice(0, 2).map(s => s.id), ['cabo-falso', 'trestles'], 'rating 10 ties break on size: 8 ft before 6 ft');
  assert.ok(best.every((s, i) => i === 0 || s.now.rating <= best[i - 1].now.rating));
  const oc = S.regionSpots(f.spots, 'orange-county', {});
  assert.ok(oc.every(s => s.region === 'orange-county'));
  assert.ok(oc.every((s, i) => i === 0 || s.now.rating <= oc[i - 1].now.rating), 'default sort is rating');
  const good = S.regionSpots(f.spots, 'orange-county', { good: true });
  assert.ok(good.length < oc.length && good.every(s => S.rate(s.now).q >= 4));
  const north = S.regionSpots(f.spots, 'all', { sort: 'north' });
  assert.ok(north.every((s, i) => i === 0 || s.lat <= north[i - 1].lat));
  const height = S.regionSpots(f.spots, 'all', { sort: 'height' });
  assert.ok(height.every((s, i) => i === 0 || s.now.wave_ft[1] <= height[i - 1].now.wave_ft[1]));
  const mineList = S.regionSpots(f.spots, 'mine', {});
  assert.deepEqual(mineList.map(s => s.pinned).sort(), [1, 2, 3, 4, 5, 6, 7], 'the Your spots filter holds exactly the seven');
  assert.deepEqual(mineList.map(s => s.id).slice(0, 2), ['trestles', 'salt-creek'], 'and sorts like any list');
});

test('latitude chart: dots are readings, the median line is dashed south of the last reading and where no reading sits', () => {
  const f = feed();
  const m = S.latChart(f.water, f.spots);
  assert.equal(m.lat0, 22.9);
  assert.equal(m.lat1, 46.3);
  assert.equal(m.south, 32.42, 'the southmost reading');
  assert.ok(m.dots.every(d => d.lat >= 32.42), 'satellite and model rows are never drawn as readings');
  assert.equal(m.dots.length, 4);
  const dashed = m.segs.filter(s => s.dashed), solid = m.segs.filter(s => !s.dashed);
  assert.ok(dashed.length >= 1 && solid.length >= 1);
  for (const s of m.segs) for (const p of s.pts) if (p[0] < 32.0) assert.ok(s.dashed, 'every segment touching Baja is dashed');
  assert.ok(solid.every(s => s.pts.every(p => p[0] >= 32.25)), 'solid only where readings back both ends');
  assert.ok(!m.segs.some(s => s.pts.some(p => p[0] === 44.75)), 'a bin more than 1.5 degrees away is not joined');
  assert.equal(m.mine.length, 7, 'every home spot is marked');
  assert.ok(m.lo <= Math.min(...m.dots.map(d => d.f)) && m.hi >= Math.max(...m.dots.map(d => d.f)));
  assert.equal(m.ticks.length, 3);
  assert.equal(S.latChart({}, []), null);
});

test('page states: 403, missing feed and not reporting are down; empty and stale are their own', () => {
  assert.equal(S.pageState({ ok: false, status: 403 }).k, 'down');
  assert.equal(S.pageState(null).k, 'down');
  assert.equal(S.pageState({ ok: true, status: 200, data: { status: 'not_reporting', reason: 'no file' } }).k, 'down');
  assert.equal(S.pageState({ ok: true, status: 200, data: { v: 1, spots: [] } }).k, 'empty');
  assert.equal(S.pageState({ ok: true, status: 200, data: Object.assign(feed(), { stale: true }) }).k, 'stale');
  assert.equal(S.pageState({ ok: true, status: 200, data: feed() }).k, 'ok');
});

test('the reason line only keeps what the card fields do not say', () => {
  assert.equal(S.reasonExtra({ reason: '5 ft at 15 s from SW, calm wind, falling tide', wind: { word: 'calm' } }), '');
  assert.equal(S.reasonExtra({ reason: 'Under 1 ft at 9 s from SE', wind: { word: 'calm' } }), '');
  assert.equal(S.reasonExtra({ reason: '6 ft at 14 s from NW, light cross-shore wind, rising tide', wind: { word: 'light cross-shore' } }), '');
  assert.equal(S.reasonExtra({ reason: '4 ft at 12 s from W, capped by strong onshore wind', wind: { word: 'strong onshore' } }), 'capped by strong onshore wind');
});

test('tide labels keep their distance, flip by type and clamp at the edges', () => {
  const start = 0, end = 48 * 3600;
  const ev = [{ type: 'H', at: 600, ft: 5 }, { type: 'L', at: 7 * 3600, ft: 0.4 }, { type: 'H', at: 13 * 3600, ft: 4.8 }, { type: 'H', at: 14 * 3600, ft: 4.9 }, { type: 'L', at: 47.5 * 3600, ft: 0.2 }];
  const l = S.tideLabels(ev, start, end, null);
  assert.deepEqual(l.map(x => x.side), ['H', 'L', 'H', 'L']);
  assert.equal(l[0].edge, 'l');
  assert.equal(l[l.length - 1].edge, 'r');
  assert.ok(!l.some(x => x.e.at === 14 * 3600), 'a label too close to the last one on its side is dropped');
  const n = S.tideLabels([{ type: 'L', at: 12 * 3600, ft: 0.5 }], start, end, 25.5);
  assert.equal(n.length, 0, 'no label sits on the Now line');
});

test('Data sheet model: sources with states, coverage and the spot blend with ids live here, not on the page', () => {
  const f = feed();
  const d = S.dataModel(f, '', null);
  assert.deepEqual(d.sources.map(s => s.state), ['ok', 'stale', 'never']);
  assert.ok(d.method.some(([k, v]) => k === 'Spots' && /246/.test(v) && /forecast only/.test(v)));
  assert.ok(d.method.some(([k, v]) => k === 'Gap' && /Baja/.test(v)));
  const rf = require('./surf_fixture.js').regionFile();
  const ds = S.dataModel(f, 'spot:salt-creek', rf);
  const hs = ds.blends.find(b => /^Wave height/.test(b.label));
  assert.ok(hs && hs.parts.some(p => /46285/.test(p.name)), 'buoy ids belong to the Data sheet');
  assert.ok(hs.parts.every(p => /%$/.test(p.weight)));
  assert.ok(ds.method.some(([k, v]) => k === 'Model correction' && /0\.846/.test(v)));
  assert.ok(ds.method.some(([k, v]) => k === 'Tide table' && v === '9410580'));
  assert.deepEqual(S.dataModel(null, '', null).sources, [], 'a down feed still gives a Data sheet');
});
