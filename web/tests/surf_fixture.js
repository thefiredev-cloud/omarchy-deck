// Shared fixture for tests/surf_*.test.js (not a test file itself). A small coast feed shaped like docs/surf-coast.md:
// seven home spots in Orange County, model-only Baja Sur spots (one with a model tide, one with no tide station), a
// Baja Norte spot on the Ensenada tide table, readings from 32.4 N north, model and satellite values to the south.
const fs = require('node:fs');
const path = require('node:path');

const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const a = deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const b = deck.indexOf('// ==== DECK V6 UI HELPERS END ====');
const D = a >= 0 && b > a ? new Function(deck.slice(a, b) + '\nreturn DeckUI;')() : null;
const src = fs.readFileSync(path.join(__dirname, '../static/pages/surf.js'), 'utf8');
const load = (ui, pages) => new Function('DeckUI', 'DeckPages', src + '\nreturn DeckSurf;')(ui, pages);
const S = load(D, undefined);

const NOV = 1794708090; // Sat Nov 14 2026, 7:01 pm PST
const JUL = Date.UTC(2026, 6, 1, 19, 0, 0) / 1000;
const PT = 'America/Los_Angeles';

function spot(id, o) {
  const now = Object.assign({
    at: NOV, wave_ft: [4, 5], hs_ft: 4.2, period_s: 14, dir_deg: 225, dir: 'SW',
    swell: [{ part: 'primary', ft: 3.6, period_s: 14, dir_deg: 225, dir: 'SW' }, { part: 'wind', ft: 1.1, period_s: 6, dir_deg: 270, dir: 'W' }],
    wind: { kt: 4, gust_kt: 7, dir_deg: 220, dir: 'SW', quality: 'onshore', word: 'calm' },
    water_f: { value: 74.4, spread: 0.8, n: 5 },
    tide: { state: 'falling', ft: 0.9, next: { type: 'L', at: NOV + 600, ft: 0.5, label: '7:08 pm' } },
    rating: 6, word: 'Good', reason: '4 ft at 14 s from SW, calm wind, falling tide',
    confidence: { level: 'high', score: 0.86, sources: 4, model_only: false }
  }, o.now || {});
  return Object.assign({
    id, name: id, region: 'orange-county', sub: 'South OC', lat: 33.47, lon: -117.7, facing_deg: 248, facing: 'WSW', pinned: null, tz: PT, now,
    days: [{ date: '2026-11-14', label: 'Today', am: { wave_ft: [4, 5], period_s: 14, wind_kt: 3, wind: 'offshore', rating: 7, word: 'Good' }, pm: { wave_ft: [4, 6], period_s: 15, wind_kt: 8, wind: 'onshore', rating: 5, word: 'Fair' }, confidence: { level: 'high', score: 0.9 } },
      { date: '2026-11-15', label: 'Sun', am: { wave_ft: [3, 5], period_s: 15, wind_kt: 2, wind: 'offshore', rating: 6, word: 'Good' }, pm: { wave_ft: [3, 4], period_s: 14, wind_kt: 9, wind: 'cross-shore', rating: 4, word: 'Fair' }, confidence: { level: 'medium', score: 0.6 } }],
    best: { start: NOV + 40000, end: NOV + 47200, label: '7-9 am', day: 'tomorrow', rating: 7, word: 'Good', reason: '4 ft at 14 s' },
    buoy: { id: '46285', name: 'Capistrano Beach Nearshore', km: 5.3 }, tide_station: '9410580', gaps: []
  }, o, { now });
}

function feed() {
  const home = [
    spot('salt-creek', { name: 'Salt Creek', pinned: 1, now: { rating: 9, word: 'Great', wave_ft: [5, 6] } }),
    spot('strands', { name: 'Strands', pinned: 2, now: { rating: 8, word: 'Great', wave_ft: [5, 6] } }),
    spot('doheny', { name: 'Doheny State Beach', pinned: 3, now: { rating: 5, word: 'Fair', wave_ft: [3, 4] } }),
    spot('san-clemente-pier', { name: 'San Clemente Pier', pinned: 4, now: { rating: 7, word: 'Good' } }),
    spot('trestles', { name: 'Trestles (Lowers)', pinned: 5, lat: 33.38, now: { rating: 10, word: 'Great', wave_ft: [5, 6] } }),
    spot('san-onofre', { name: 'San Onofre (Old Mans)', pinned: 6, lat: 33.37, now: { rating: 4, word: 'Fair', wave_ft: [2, 3] } }),
    spot('huntington', { name: 'Huntington Beach Pier', pinned: 7, lat: 33.65, now: { rating: 6, word: 'Good', water_f: { value: 73.8, spread: 1.0, n: 4 } } })
  ];
  const model = { confidence: { level: 'low', score: 0.3, sources: 1, model_only: true } };
  const baja = [
    spot('cabo-falso', { name: 'Cabo Falso', region: 'baja-sur', sub: 'Cabo San Lucas', lat: 22.875, lon: -109.97, tz: 'America/Mazatlan', buoy: null, tide_station: 'model:22.875,-109.958',
      best: { start: NOV + 70000, end: NOV + 77200, label: '4-6 pm', day: 'tomorrow', rating: 10 }, gaps: ['No wave buoy within 150 km. Height is from models.'],
      now: Object.assign({}, model, { rating: 10, word: 'Great', wave_ft: [6, 8], hs_ft: 6.4, dir: 'NW', dir_deg: 295, water_f: { value: 84.6, spread: 0.3, n: 2, confidence: { level: 'low', score: 0.3 } },
        reason: '6 ft at 14 s from NW, light cross-shore wind, rising tide', wind: { kt: 7, dir: 'NW', quality: 'cross-shore', word: 'light cross-shore' },
        tide: { state: 'rising', ft: 0.6, next: { type: 'H', at: NOV + 52800, ft: 3.2, label: '9:42 am' } } }) }),
    spot('scorpion-bay', { name: 'Scorpion Bay', region: 'baja-sur', lat: 27.2, lon: -112.9, tz: 'America/Mazatlan', buoy: null, tide_station: null,
      now: Object.assign({}, model, { rating: 6, word: 'Good', wave_ft: [3, 4], tide: { state: null, ft: null, next: null } }) }),
    spot('san-miguel', { name: 'San Miguel', region: 'baja-norte', lat: 31.9, lon: -116.73, tz: 'America/Tijuana', tide_station: '9410120', buoy: { id: '46232', name: 'Point Loma South', km: 95 },
      now: { rating: 7, word: 'Good', tide: { state: 'falling', ft: 1.2, next: { type: 'L', at: NOV + 1100, ft: 0.4, label: '7:20 pm' } } } }),
    spot('punta-baja', { name: 'Punta Baja', region: 'baja-norte', lat: 29.95, lon: -115.8, tz: 'America/Tijuana', buoy: null, tide_station: 'model:29.95,-115.8', now: Object.assign({}, model, { rating: 5, word: 'Fair' }) })
  ];
  const sd = [spot('cardiff-reef', { name: 'Cardiff Reef', region: 'san-diego', lat: 33.01, now: { rating: 9, word: 'Great', wave_ft: [6, 7] } })];
  const region = (id, name, order, o) => Object.assign({ id, name, order, tz: PT, rating: 6, word: 'Good', wave_ft: [4, 5], hs_ft: 4.2,
    swell: { ft: 3.6, period_s: 14, dir_deg: 225, dir: 'SW' }, wind: { kt: 5, dir: 'SW', quality: 'onshore', word: 'light onshore' },
    water_f: { value: 74, min: 72, max: 75, n: 20 }, best: { spot: 'salt-creek', name: 'Salt Creek', start: NOV + 40000, end: NOV + 47200, label: '7-9 am', day: 'tomorrow', rating: 9 },
    counts: { great: 3, good: 2, fair: 2, poor: 0, flat: 0 }, confidence: { level: 'high', score: 0.82 }, gaps: [] }, o);
  return {
    v: 1, t: NOV, refresh: 1800, age: 300, stale: false,
    src: ['Buoy and shore station readings', 'Satellite water temperature'],
    errors: [{ source: 'coastwatch-mur', reason: '7 of 14 parts are old or missing.' }],
    regions: [
      region('baja-sur', 'Baja Sur', 1, { tz: 'America/Mazatlan', wave_ft: [5, 7], confidence: { level: 'low', score: 0.3 }, best: { spot: 'cabo-falso', name: 'Cabo Falso', start: NOV + 70000, label: '4-6 pm', day: 'tomorrow' } }),
      region('baja-norte', 'Baja Norte', 2, { tz: 'America/Tijuana' }),
      region('san-diego', 'San Diego', 3),
      region('orange-county', 'Orange County', 4, { rating: 9, word: 'Great', wave_ft: [5, 6] }),
      region('ventura', 'Ventura', 6, { wave_ft: null, hs_ft: null, rating: null, word: null, swell: null, wind: null, water_f: null, best: null, counts: {} })
    ],
    spots: home.concat(baja, sd),
    buoys: [
      { id: '46232', name: 'Point Loma South', owner: 'CDIP', kind: 'buoy', region: 'san-diego', lat: 32.517, lon: -117.425, at: NOV - 1800, age_min: 30, wave_ft: 6.1, dpd_s: 15, apd_s: 8.1, mwd_deg: 250, mwd: 'WSW', water_f: 66.6, wind: null, swell: { ft: 5, period_s: 15, dir: 'WSW' }, wind_wave: { ft: 2, period_s: 7, dir: 'W' }, nearest_spot: { id: 'imperial', name: 'Imperial Beach', km: 15.2 } },
      { id: '46285', name: 'Capistrano Beach Nearshore', owner: 'CDIP', kind: 'buoy', region: 'orange-county', lat: 33.45, lon: -117.68, at: NOV - 1800, age_min: 30, wave_ft: 4.9, dpd_s: 14, apd_s: 8.7, mwd_deg: 214, mwd: 'SW', water_f: 74.7, wind: null, swell: null, wind_wave: null, nearest_spot: { id: 'doheny', name: 'Doheny State Beach', km: 2.0 } },
      { id: 'LJPC1', name: 'La Jolla', owner: 'NDBC', kind: 'shore station', region: 'san-diego', lat: 32.87, lon: -117.26, at: NOV - 1800, age_min: 30, wave_ft: null, water_f: 67, wind: { kt: 6, dir: 'W' } }
    ],
    water: {
      rows: [
        { lat: 23.0, f: 84.5, kind: 'satellite', name: 'Cabo Falso', region: 'baja-sur' },
        { lat: 30.0, f: 78.0, kind: 'model', name: 'Punta Baja', region: 'baja-norte' },
        { lat: 32.42, f: 67.6, kind: 'buoy', id: '46047', name: 'Tanner Bank', region: 'los-angeles' },
        { lat: 32.75, f: 66.6, kind: 'buoy', id: '46232', name: 'Point Loma South', region: 'san-diego' },
        { lat: 33.45, f: 74.7, kind: 'buoy', id: '46285', name: 'Capistrano Beach Nearshore', region: 'orange-county' },
        { lat: 34.0, f: 63.1, kind: 'pier', name: 'Santa Monica Pier', region: 'los-angeles' }
      ],
      regions: [{ region: 'orange-county', f: 74.0, min: 72.4, max: 75.1, spread: 2.7, n: 52 }],
      bins: [22.75, 23.25, 23.75, 24.25, 25.25, 26.25, 27.25, 28.25, 29.25, 30.25, 31.25, 31.75, 32.25, 32.75, 33.25, 33.75, 34.25, 44.75]
        .map((lat, i) => ({ lat, f: 84.5 - i * 1.1, n: 5 }))
    },
    tides: [
      { id: '9410580', name: 'Newport Bay Entrance', kind: 'prediction', state: 'falling', regions: ['orange-county'], next: [{ type: 'L', at: NOV + 600, ft: 0.5, label: 'Sat 7:08 pm' }, { type: 'H', at: NOV + 23000, ft: 5.1, label: 'Sun 1:24 am' }] },
      { id: '9410120', name: 'Ensenada', kind: 'prediction', state: 'falling', regions: ['baja-norte'], next: [{ type: 'L', at: NOV + 1100, ft: 0.4, label: 'Sat 7:20 pm' }] },
      { id: 'model:22.875,-109.958', name: 'Cabo Falso (model)', kind: 'model', state: 'rising', regions: ['baja-sur'], next: [{ type: 'H', at: NOV + 52800, ft: 3.2, label: 'Sun 9:42 am' }] }
    ],
    alerts: [{ id: 'urn:1', event: 'High Surf Advisory', severity: 'Minor', text: 'High surf advisory until Sun 10 am. Surf 5 to 7 ft.', regions: ['san-diego', 'orange-county'], zones: ['CAZ552'], start: NOV - 9000, end: NOV + 54000, until_label: 'Sun 10 am' }],
    sources: [
      { id: 'ndbc-latest', name: 'Buoy and shore station readings', publisher: 'NOAA NDBC', status: 'ok', as_of: NOV - 1500, count: 80, note: 'All stations in one request.' },
      { id: 'coastwatch-mur', name: 'Satellite water temperature', publisher: 'NASA JPL MUR via NOAA CoastWatch', status: 'stale', as_of: NOV - 130000, count: 7, note: '7 of 14 parts are old.' },
      { id: 'cencoos-piers', name: 'Pier water temperature', publisher: 'SCCOOS via CeNCOOS ERDDAP', status: 'unavailable', as_of: null, count: 0, note: 'timed out' }
    ],
    coverage: { spots: 246, spots_with_data: 246, spots_buoy_50km: 137, spots_model_only: 46, stations_reporting: 74, buoys_waves: 29, water_rows: 348, alerts: 1, tide_stations: 64 },
    gaps: ['Baja has no public wave buoys. Baja heights come from models and carry a low mark.'],
    method: { doc: 'docs/surf-coast.md', bias: { 'orange-county': { factor: 0.846, basis: 'orange-county', pairs: 3 }, 'baja-sur': { factor: null, basis: null, pairs: 0 } } }
  };
}

function regionFile() {
  const f = feed();
  const salt = Object.assign({}, f.spots[0], {
    parts: {
      hs: [{ kind: 'buoy', id: '46285', km: 5.3, age_min: 65, ft: 4.6, weight: 0.838 }, { kind: 'nearshore model', id: 'OC172', ft: 4.3, weight: 0.3 }, { kind: 'global model', ft: 4.9, raw_ft: 5.8, bias: 0.846, weight: 0.3 }],
      water: [{ kind: 'buoy', id: '46285', km: 5.3, f: 74.7 }, { kind: 'satellite', f: 73.9 }, { kind: 'model', f: 74.3 }]
    },
    sun: { first_light: { at: NOV - 44000, label: '5:55 am' }, sunrise: { at: NOV - 42000, label: '6:21 am' }, sunset: { at: NOV - 4400, label: '4:48 pm' }, last_light: { at: NOV - 2800, label: '5:14 pm' } },
    hours: { start: NOV - 2490, step: 3600, hs_ft: [4.8, 4.7], rating: [9, 9] }
  });
  const cabo = Object.assign({}, f.spots.find(s => s.id === 'cabo-falso'), { parts: { hs: [{ kind: 'global model', ft: 6.4, weight: 0.3 }], water: [{ kind: 'satellite', f: 84.5 }, { kind: 'model', f: 84.8 }] },
    sun: { first_light: { at: NOV - 40000, label: '6:10 am' }, sunrise: { at: NOV - 38000, label: '6:35 am' }, sunset: { at: NOV - 2000, label: '5:50 pm' } } });
  const curve = (id, start) => ({ start, step: 3600, ft: Array.from({ length: 48 }, (_, i) => +(2.5 + 2.4 * Math.cos((i - 6) / 12.4 * 2 * Math.PI)).toFixed(2)) });
  return {
    v: 1, t: NOV, refresh: 1800, region: f.regions[3], spots: [salt, cabo],
    tides: f.tides.map(t => Object.assign({}, t, { curve: curve(t.id, NOV - 2490) })),
    buoys: f.buoys, alerts: f.alerts, water: f.water.rows, sources: f.sources
  };
}

module.exports = { S, D, load, feed, spot, regionFile, NOV, JUL, src };
