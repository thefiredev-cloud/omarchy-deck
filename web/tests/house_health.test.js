// node --test tests/  (House health tiles: a missing reading is words or one empty state, never a bare "--")
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const a = app.indexOf('// ==== HOUSE HEALTH BEGIN');
const b = app.indexOf('// ==== HOUSE HEALTH END ====');
assert.ok(a >= 0 && b > a);
const H = new Function(app.slice(a, b) + '\nreturn {nm, healthRows};')();

test('a missing watch feed: every row has a null value, so the page draws one empty state', () => {
  const rows = H.healthRows(null);
  assert.deepEqual(rows.map((r) => r.label), ['Heart rate', 'HRV', 'Sleep', 'Watch battery', 'Move', 'Exercise', 'Stand']);
  assert.ok(rows.every((r) => r.value === null));
  assert.equal(H.healthRows({ error: 'file missing' }).every((r) => r.value === null), true);
});

test('unavailable and unknown states are missing, a zero is a reading', () => {
  assert.equal(H.nm({ state: 'unavailable' }, 0), null);
  assert.equal(H.nm({ state: 'unknown' }, 0), null);
  assert.equal(H.nm(undefined, 0), null);
  assert.equal(H.nm({ state: '0' }, 0), '0');
  assert.equal(H.nm({ state: '58.4', unit: 'bpm' }, 0), '58 bpm');
  assert.equal(H.nm({ state: '7.25' }, 1), '7.3');
  assert.equal(H.nm({ state: 'on' }, 0), 'on');
});

test('a partly reporting watch keeps the readings it has', () => {
  const rows = H.healthRows({ hr: 61, hrv: null, sleep_h: 7.25, battery: 80 });
  assert.equal(rows[0].value, '61 bpm');
  assert.equal(rows[1].value, null);
  assert.equal(rows[2].value, '7.3 h');
  assert.equal(rows[3].value, '80%');
});

test('move, exercise and stand come back from the watch feed; a missing one is null (the page says No data), a zero is a reading', () => {
  const rows = H.healthRows({ hr: 61, move_kcal: 420, exercise_min: 0, stand_h: null });
  const by = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  assert.equal(by.Move, '420 kcal');
  assert.equal(by.Exercise, '0 min');
  assert.equal(by.Stand, null);
  assert.equal(H.healthRows({ move_kcal: 312.46, exercise_min: 'x', stand_h: true }).find((r) => r.label === 'Move').value, '312.5 kcal');
  assert.ok(H.healthRows({ exercise_min: 'x', stand_h: true }).slice(5).every((r) => r.value === null), 'text or a boolean is not a reading');
  // the House glue draws a missing reading as "No data", never "--" or 0
  const app = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
  assert.match(app, /health\.map\(x=>T\(x\.label,x\.value==null\?'No data':x\.value,''\)\)/);
});
