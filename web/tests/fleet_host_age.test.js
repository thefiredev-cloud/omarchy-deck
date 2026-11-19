// A fresh fleet snapshot cannot make an old host probe current.
require('./setup-core.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync(require('node:path').join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(src.slice(src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), src.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const NOW = Date.UTC(2026, 10, 16, 12);
const T = seconds => NOW / 1000 - seconds;
const machine = seconds => ({ name: 'Dell', reachable: true, checked: T(seconds), drives: [{ label: 'System', used_gb: 300, free_gb: 200, pct: 60 }] });
const feed = m => ({ t: T(1), stale: false, refresh: 600, items: [m] });
const vis = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('an old host is out of date inside a fresh file and keeps its disk readings with their age', () => {
  for (const reachable of [true, null]) {
   const m = { ...machine(77_040), reachable, note: reachable === null ? 'TimeoutExpired' : '' };
   for (const nodes of [null, { stale: false, nodes: [{ label: 'Dell', reachable: true, mem_pct: 62 }] }]) {
    const html = D.bMachines(feed(m), NOW, nodes);
    assert.match(html, /tile node stale/);
    assert.match(vis(html), /Dell Out of date Disks read 21 h ago/);
    assert.match(vis(html), /System · 300 GB used · 200 GB free · 60%/);
    assert.doesNotMatch(vis(html), /Dell Up|memory 62%/);
    assert.match(html, /data-retry="fleet"/);
    assert.equal(D.machineState(m, nodes, NOW, 600).s, 'unknown');
   }
  }
});

test('host age becomes stale strictly after twice the producer interval', () => {
  assert.match(vis(D.bMachines(feed(machine(1200)), NOW)), /Dell Up/);
  assert.match(vis(D.bMachines(feed(machine(1201)), NOW)), /Dell Out of date Disks read 20 min ago/);
  assert.match(vis(D.bMachines({ ...feed(machine(1201)), refresh: 900 }, NOW)), /Dell Up/);
  assert.match(vis(D.bMachines(feed({ ...machine(1201), reachable: false }), NOW)), /Dell Out of date/);
  const { refresh, ...legacy } = feed(machine(1200));
  assert.match(vis(D.bMachines(legacy, NOW)), /Dell Up/, 'the fallback also follows the documented ten-minute interval');
});

test('a null host check time reports its reason instead of asserting current reachability', () => {
  const html = D.bMachines(feed({ ...machine(0), checked: null, checked_reason: 'check time not reported or invalid' }), NOW);
  assert.match(vis(html), /Dell Not checked Disk check time not reported/);
  assert.doesNotMatch(vis(html), /Dell Up|Disks read 0/);
});

test('a malformed host time never becomes a current or invented zero-age disk reading', () => {
  for (const checked of [null, '1790895788', true, -1, 0, 1500000000, T(-1)]) {
    const html = D.bMachines(feed({ ...machine(0), checked }), NOW);
    assert.match(vis(html), /Dell Not checked Disk check time not reported/);
    assert.doesNotMatch(vis(html), /Dell Up|Disks read/);
  }
});

test('the Fleet summary also excludes an old host from its current up count', () => {
  const old = { ...machine(0), checked: Date.now() / 1000 - 77_040 };
  const html = D.fleetSummary({ bd: { machines: feed(old) } }).html;
  assert.match(vis(html), /Machines 0 of 1 1 not checked/);
  assert.doesNotMatch(vis(html), /Dell Down/);
});

test('summary and tiles use the same nondefault producer interval', () => {
  const now = Date.now(), m = { ...machine(0), checked: now / 1000 - 1300 };
  const machines = { ...feed(m), refresh: 900 };
  assert.match(vis(D.bMachines(machines, now)), /Dell Up/);
  assert.match(vis(D.fleetSummary({ bd: { machines } }).html), /Machines 1 of 1 All up/);
});

test('a served-name prefix never claims residency without that hosts inventory evidence', () => {
  const f = { t: T(1), engine: { served_name: 'DeepSeek' } };
  const m = { t: T(1), devices: [
    { device: 'Spark', models: ['DeepSeek (engine up)'] },
    { device: 'Ascent', models: ['DeepSeek (engine up)'] }
  ] };
  for (const inv of [null, { hosts: [] }, { error: 'not reporting' },
    { hosts: [{ id: 'spark', resident: ['DeepSeek'], installed: [], services: [] }] }]) {
    const html = D.cluster(f, NOW, m, null, inv)[1];
    const rows = html.slice(html.indexOf('class="flist fmod"'));
    assert.doesNotMatch(rows, /Resident|Installed|GB on the GPU/);
    assert.match(vis(rows), /Spark 1 model DeepSeek \(engine up\) Ascent 1 model DeepSeek/);
  }
  const inv = { hosts: [{ id: 'spark', installed: ['DeepSeek'], resident: ['DeepSeek'],
    services: [{ weights: true, models: [{ id: 'DeepSeek', resident: true, gpu_gib: 48 }] }] }] };
  const html = D.cluster(f, NOW, m, null, inv)[1];
  assert.match(vis(html), /Spark 1 model DeepSeek \(engine up\) 48\.0 GB on the GPU Resident Ascent 1 model DeepSeek \(engine up\)$/);
});
