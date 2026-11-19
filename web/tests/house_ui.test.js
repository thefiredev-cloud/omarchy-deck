// House now, key rows and the pad link curve: the parts of the Home, Keys and House pages that are pure.
// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const block = (begin, end) => {
  const s = src.indexOf(begin), e = src.indexOf(end);
  assert.ok(s >= 0 && e > s, 'helper block missing: ' + begin);
  return src.slice(s, e);
};
const HouseUI = vm.runInNewContext(block('// ==== HOUSE UI HELPERS BEGIN', '// ==== HOUSE UI HELPERS END ====') + '\nHouseUI;', {}, { timeout: 1000 });

const ent = (state, unit) => ({ state, unit: unit || '', updated: 1700000000 });
const ha = entities => ({ entities });
const cams = (...ready) => ({ cams: ready.map((r, i) => ({ name: 'eufy_cam' + (i + 1), ready: r, readers: 0, bytes: 0 })) });

test('house now: a lock fact only appears when lock entities answered', () => {
  const bare = HouseUI.nowLine(ha({ 'sensor.whoop_local_battery': ent('88', '%') }), null, null);
  assert.equal(bare.facts.some(f => f.k === 'Locks'), false);
  assert.match(bare.note, /lock sensors/);
  const got = HouseUI.nowLine(ha({ 'lock.front_door': ent('locked'), 'lock.garage': ent('unlocked') }), null, null);
  const lock = got.facts.find(f => f.k === 'Locks');
  assert.equal(lock.v, '1 unlocked');
  assert.equal(lock.mark, 'bad');
  assert.equal(lock.src, '2 lock entities');
  assert.equal(got.note.includes('lock sensors'), false);
});

test('house now: doors, warmest room, cameras and car read from their own sources', () => {
  const r = HouseUI.nowLine(ha({
    'binary_sensor.garage_door': ent('on'), 'binary_sensor.back_door': ent('off'),
    'sensor.living_room_temperature': ent('71', '\u00B0F'), 'sensor.bedroom_temperature': ent('84', '\u00B0F'),
  }), { battery: 63, charging: 'Not charging', locked: false }, cams(true, true, true, false));
  const doors = r.facts.find(f => f.k === 'Doors');
  assert.equal(doors.v, '1 open');
  const warm = r.facts.find(f => f.k === 'Warmest room');
  assert.equal(warm.v, '84 \u00B0F');
  assert.equal(warm.mark, 'bad');
  const cam = r.facts.find(f => f.k === 'Cameras');
  assert.equal(cam.v, '3 of 4 live');
  assert.equal(cam.mark, 'warn');
  const car = r.facts.find(f => f.k === 'Car');
  assert.equal(car.v, '63% \u00B7 UNLOCKED');
  assert.equal(car.mark, 'warn', 'an unlocked car is worth a look, not an alarm');
});

test('house now: a named-but-unknown state is never counted as locked or closed', () => {
  const r = HouseUI.nowLine(ha({ 'lock.front_door': ent('unavailable'), 'binary_sensor.back_door': ent('unknown') }), null, null);
  assert.equal(r.facts.length, 0);
  assert.equal(r.mark, 'bad');
  assert.match(r.note, /lock sensors/);
});

test('house now: the line shows at most four facts and keeps the rest for the tooltip', () => {
  const r = HouseUI.nowLine(ha({
    'lock.a': ent('locked'), 'binary_sensor.garage_door': ent('off'), 'sensor.a_temperature': ent('70', '\u00B0F'),
    'binary_sensor.whoop_local_connected': ent('on'), 'sensor.whoop_local_battery': ent('55', '%'),
  }), { battery: 80, locked: true }, cams(true, true, true, true));
  assert.equal(r.facts.length, 6);
  assert.equal(r.shown.length, 4);
  assert.equal(r.text.split(' \u00B7 ').length, 4);
  assert.equal(r.title.split('\n').length, 6);
  assert.equal(r.mark, 'ok');
});

test('house now: Home Assistant down says so instead of inventing a calm house', () => {
  const r = HouseUI.nowLine({ error: 'ha unreachable', entities: {} }, null, null);
  assert.equal(r.facts.length, 0);
  assert.equal(r.mark, 'bad');
  assert.match(r.note, /Home Assistant/);
});

test('camera stall: five quiet seconds counts as stalled, a fresh frame does not', () => {
  assert.equal(HouseUI.STALL_MS, 5000);
  assert.equal(HouseUI.stalled(10000, 5000), true);
  assert.equal(HouseUI.stalled(10000, 9001), false);
  assert.equal(HouseUI.stalled(10000, null), false);
  assert.equal(HouseUI.stalled(null, 5000), false);
});

// design v3, review F2: the status card reads as a word and a short line; every "not reported" folds into one count
test('house now: the status line keeps what is there and folds the not-reported parts into one count', () => {
  const line = 'Internet not reported \u00B7 Router not reported \u00B7 Cameras not reported \u00B7 Tailnet 7 of 11 online \u00B7 Car locked (cached) \u00B7 Presence not reported \u00B7 WHOOP off';
  assert.equal(HouseUI.shortLine(line), 'Tailnet 7 of 11 online \u00B7 Car locked (cached) \u00B7 WHOOP off \u00B7 4 not reported');
  assert.equal(HouseUI.shortLine('Internet up \u00B7 Router not reported'), 'Internet up \u00B7 Router not reported', 'one missing part keeps its name');
  assert.equal(HouseUI.shortLine('Internet up \u00B7 Router up'), 'Internet up \u00B7 Router up');
  assert.equal(HouseUI.shortLine(''), '');
});

// review F2: a watch with no readings is one row (a word and a short line), not a 500 px card
test('apple watch row: not linked, no readings, a missing feed and the writer reason each read as one short row', () => {
  const row = (w) => JSON.parse(JSON.stringify(HouseUI.watchRow(w)));
  assert.deepEqual(row({ near: false, connected: false }), { word: 'Not linked', line: 'Not linked to the Mac mini' });
  assert.deepEqual(row({ near: true, connected: false }), { word: 'No readings', line: 'Nothing has arrived yet' });
  assert.deepEqual(row({ near: true, reason: 'iPhone Health sync is off' }), { word: 'No readings', line: 'iPhone Health sync is off' });
  assert.deepEqual(row({ error: 'file missing' }), { word: 'Not reporting', line: 'No watch file yet' });
  assert.deepEqual(row(null), { word: 'Not reporting', line: 'The watch feed did not answer' });
});

// R1: unknown is not down. A part that did not report gives the dash mark, never the amber banner; amber needs a part that answered
// and is partly up; the crossed square needs one that is down.
test('house status: not reported is the dash mark; partly up is amber; down is bad', () => {
  const ts = { counts: { own_devices: 11, own_online: 11 } };
  const car = { locked: true };
  const up = { 'binary_sensor.internet_reachable': ent('on'), 'binary_sensor.router_reachable': ent('on'), 'person.mesh': ent('home') };
  assert.equal(HouseUI.headline(ha(up), car, cams(true, true), 1700000100000, ts).mark, 'ok');
  const miss = HouseUI.headline(ha({}), car, cams(true, true), 1700000100000, ts);
  assert.equal(miss.mark, 'off', 'only missing parts: the dash, never amber');
  assert.equal(miss.word, 'Partly reported');
  assert.equal(HouseUI.headline(ha({}), car, cams(true, false), 1700000100000, ts).mark, 'warn', 'one camera of two: amber');
  assert.equal(HouseUI.headline(ha(Object.assign({}, up, { 'binary_sensor.internet_reachable': ent('off') })), car, cams(true), 1700000100000, ts).mark, 'bad');
});

test('inside temperature: a room or thermostat sensor, never an outdoor, chip or battery one; none means no tile', () => {
  assert.equal(HouseUI.insideTemp(ha({ 'sensor.outdoor_temperature': ent('61', '°F'), 'sensor.nvme_temperature': ent('44', '°C') })), null);
  assert.deepEqual(JSON.parse(JSON.stringify(HouseUI.insideTemp(ha({ 'sensor.outdoor_temperature': ent('61', '°F'), 'sensor.living_room_temperature': ent('71.6', '°F') })))), { v: 72, unit: '°F' });
  assert.equal(HouseUI.insideTemp(ha({ 'sensor.living_room_temperature': ent('unavailable') })), null);
  assert.equal(HouseUI.insideTemp(null), null);
});
