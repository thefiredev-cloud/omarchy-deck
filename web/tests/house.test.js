// node --test tests/house.test.js  (static/house.js: the Home tiles under House. Runs the real file in a vm with a fake fetch and a fake element; no DOM, no network)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '../static/house.js'), 'utf8');
const NOW = Date.UTC(2026, 10, 8, 19, 0, 0);
const SEC = NOW / 1000;
let clock = NOW;
class FakeDate extends Date {
  static now() { return clock; }
}

// one page element: innerHTML, attributes, and a click listener the test can fire
function fakeEl() {
  const attrs = {}, listeners = {};
  return {
    innerHTML: '', firstChild: null,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    click: (btn) => (listeners.click || []).forEach((fn) => fn({ target: { closest: () => btn } })),
  };
}

// a fresh copy of house.js per test: its state (last reading, busy flag) starts empty
function boot(respond) {
  const calls = [], timers = [];
  const win = {};
  const fetch = (url, opts) => {
    calls.push({ url, method: (opts && opts.method) || 'GET' });
    return respond(url, opts);
  };
  const ctx = {
    window: win, fetch, Date: FakeDate,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  };
  vm.runInNewContext(SRC, ctx, { filename: 'house.js', timeout: 1000 });
  return { House: win.DeckHouse, calls, timers };
}

const ok = (body) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const flush = () => new Promise((r) => setImmediate(r));

function reading(over) {
  return Object.assign({
    t: SEC - 30,
    set_ok: true,
    groups: {
      weather: [],
      climate: {
        min: 60, max: 80,
        devices: [{ id: 'climate.hall', name: 'Hall', cur: 71, target: 80, mode: 'heat', action: 'idle', u: SEC - 30 }],
        rows: [],
      },
      lights: {
        lights: [
          { id: 'light.kitchen', name: 'Kitchen', on: true, u: SEC - 30 },
          { id: 'light.porch', name: 'Porch', on: null, u: SEC - 30 },
        ],
        scenes: [],
      },
      media: [],
      irrigation: [], energy: [], doors: [], presence: [], alerts: [], upkeep: [], commute: [],
    },
  }, over);
}

test('an error answer or a failed request says the house is not reporting, and paints no sections', async () => {
  for (const respond of [ok({ error: 'ha unreachable' }), () => Promise.reject(new Error('offline'))]) {
    const { House, calls } = boot(respond);
    const el = fakeEl();
    House.render(el, NOW);
    await flush();
    assert.equal(calls[0].url, '/api/ha?view=house');
    assert.match(el.innerHTML, /The house is not reporting/);
    assert.doesNotMatch(el.innerHTML, /Climate/);
  }
});

test('a valid reading paints each section with no source name and no per-row reading age (design v3)', async () => {
  const { House } = boot(ok(reading()));
  const el = fakeEl();
  House.render(el, NOW);
  await flush();
  assert.match(el.innerHTML, /<span>Climate<\/span>/);
  assert.match(el.innerHTML, /<span>Lights and scenes<\/span>/);
  assert.match(el.innerHTML, /<span>Doors and locks<\/span>/);
  assert.doesNotMatch(el.innerHTML, /Home Assistant|updated|read just now|min ago/);
  assert.doesNotMatch(el.innerHTML, /Out of date/, 'a fresh read carries no status');
});

test('a missing value reads No reading and is never shown as zero or a dash', async () => {
  const data = reading();
  data.groups.weather = [{ k: 'Outside', v: null }, { k: 'Rain', at: null }];
  data.groups.climate.devices[0].cur = null;
  data.groups.climate.devices[0].target = null;
  const { House } = boot(ok(data));
  const el = fakeEl();
  House.render(el, NOW);
  await flush();
  assert.match(el.innerHTML, /<b>Outside<\/b><\/span><span class="fr"><b class="na">No reading<\/b>/);
  assert.match(el.innerHTML, /<b>Rain<\/b><\/span><span class="fr"><b class="na">No reading<\/b>/);
  assert.match(el.innerHTML, /<b>Hall<\/b><small>heat · idle<\/small><\/span><span class="fr"><b class="na">No reading<\/b><\/span>/);
  assert.doesNotMatch(el.innerHTML, />0 °F|<b>0<\/b>|<b>--<\/b>/);
});

test('server text is escaped before it reaches the page', async () => {
  const data = reading();
  data.groups.climate.devices[0].name = '<img src=x onerror=alert(1)>';
  const { House } = boot(ok(data));
  const el = fakeEl();
  House.render(el, NOW);
  await flush();
  assert.doesNotMatch(el.innerHTML, /<img src=x/);
  assert.match(el.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('an entity id that is not a Home Assistant id gets no row and no control', async () => {
  const data = reading();
  data.groups.climate.devices.push({ id: 'x; drop', name: 'Injected', cur: 70, target: 70, u: SEC - 30 });
  data.groups.lights.lights.push({ id: '../etc', name: 'Escaped', on: false, u: SEC - 30 });
  const { House } = boot(ok(data));
  const el = fakeEl();
  House.render(el, NOW);
  await flush();
  assert.doesNotMatch(el.innerHTML, /Injected|Escaped|x; drop|\.\.\/etc/);
  assert.match(el.innerHTML, /Hall/);
});

test('thermostat raise and lower stay inside the 60 to 80 F band', async () => {
  const cases = [
    { target: 80, expect: ['79', '80'] },
    { target: 60, expect: ['60', '61'] },
    { target: 72, expect: ['71', '73'] },
  ];
  for (const c of cases) {
    const data = reading();
    data.groups.climate.devices[0].target = c.target;
    const { House } = boot(ok(data));
    const el = fakeEl();
    House.render(el, NOW);
    await flush();
    const vals = [...el.innerHTML.matchAll(/data-hx-act="climate_set" data-hx-e="climate\.hall" data-hx-v="(\d+)"/g)].map((m) => m[1]);
    assert.deepEqual(vals, c.expect, `target ${c.target}`);
  }
});

test('thermostat controls are hidden when the server says set points are off', async () => {
  const data = reading({ set_ok: false });
  const { House } = boot(ok(data));
  const el = fakeEl();
  House.render(el, NOW);
  await flush();
  assert.match(el.innerHTML, /Hall/);
  assert.doesNotMatch(el.innerHTML, /climate_set/);
});

test('a light that reports no state reads No reading and offers Turn on; a known on light offers Turn off', async () => {
  const { House } = boot(ok(reading()));
  const el = fakeEl();
  House.render(el, NOW);
  await flush();
  assert.match(el.innerHTML, /data-hx-act="light_toggle" data-hx-e="light\.kitchen"[^>]*>Turn off</);
  assert.match(el.innerHTML, /data-hx-act="light_toggle" data-hx-e="light\.porch"[^>]*>Turn on</);
  assert.match(el.innerHTML, /<b>Porch<\/b>[\s\S]*?<span class="fr"><b class="na">No reading<\/b>/);
});

test('a scene name is cut to 24 characters on its button', async () => {
  const data = reading();
  data.groups.lights.scenes = [{ id: 'scene.long', name: 'x'.repeat(40) }];
  const { House } = boot(ok(data));
  const el = fakeEl();
  House.render(el, NOW);
  await flush();
  assert.match(el.innerHTML, new RegExp('>' + 'x'.repeat(24) + '<\\/button>'));
  assert.doesNotMatch(el.innerHTML, />x{25}/);
});

test('an empty section says nothing is reported; Vacuum appears only when it has rows', async () => {
  const { House } = boot(ok(reading()));
  const el = fakeEl();
  House.render(el, NOW);
  await flush();
  assert.match(el.innerHTML, /<span>Irrigation<\/span><\/h3><div class="flist"><div class="frow"><span class="fl"><b>Nothing reported<\/b>/);
  assert.doesNotMatch(el.innerHTML, /<span>Vacuum<\/span>/);

  const data = reading();
  data.groups.vacuum = [{ k: 'Dock', v: 'Docked', u: SEC - 30 }];
  const again = boot(ok(data));
  const el2 = fakeEl();
  again.House.render(el2, NOW);
  await flush();
  assert.match(el2.innerHTML, /<span>Vacuum<\/span>/);
});

test('a press sends one POST with the action, reports success, then re-reads the house', async () => {
  const { House, calls, timers } = boot((url, opts) => (opts && opts.method === 'POST'
    ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reading()) })));
  const el = fakeEl();
  House.render(el, NOW);
  await flush();
  const btn = { disabled: false, getAttribute: (k) => ({ 'data-hx-act': 'light_toggle', 'data-hx-e': 'light.kitchen' })[k] ?? null };
  el.click(btn);
  await flush();
  const post = calls.filter((c) => c.method === 'POST');
  assert.equal(post.length, 1);
  assert.equal(post[0].url, '/api/ha?act=light_toggle&e=light.kitchen');
  assert.match(el.innerHTML, /Done\. Reading the house again\./);
  assert.equal(timers.at(-1).ms, 900);
  timers.at(-1).fn();
  await flush();
  assert.equal(calls.at(-1).url, '/api/ha?view=house');
  assert.equal(calls.at(-1).method, 'GET');
});

test('a refused press says why, and a press that never reaches the house says so', async () => {
  const cases = [
    { respond: () => Promise.resolve({ ok: false, status: 429, json: () => Promise.reject(new Error('x')) }), says: /Not done: too fast, wait a second/ },
    { respond: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: false, error: 'entity unavailable' }) }), says: /Not done: entity unavailable/ },
    { respond: () => Promise.reject(new Error('offline')), says: /Not done: the house did not answer/ },
  ];
  for (const c of cases) {
    const { House, timers } = boot((url, opts) => (opts && opts.method === 'POST' ? c.respond() : ok(reading())()));
    const el = fakeEl();
    House.render(el, NOW);
    await flush();
    el.click({ disabled: false, getAttribute: (k) => ({ 'data-hx-act': 'scene_on', 'data-hx-e': 'scene.movie' })[k] ?? null });
    await flush();
    assert.match(el.innerHTML, c.says);
    assert.equal(timers.at(-1).ms, 2500, 'a refusal waits longer before the re-read');
  }
});

test('a press with a bad entity id sends nothing', async () => {
  const { House, calls } = boot(ok(reading()));
  const el = fakeEl();
  House.render(el, NOW);
  await flush();
  el.click({ disabled: false, getAttribute: (k) => ({ 'data-hx-act': 'light_toggle', 'data-hx-e': 'light.a&b=c' })[k] ?? null });
  await flush();
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

test('a failed re-read keeps the last good tiles and marks them out of date', async () => {
  let fail = false;
  const { House } = boot(() => (fail
    ? Promise.reject(new Error('offline'))
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reading()) })));
  const el = fakeEl();
  House.render(el, NOW);
  await flush();
  assert.match(el.innerHTML, /<span>Climate<\/span>/);

  fail = true;
  clock = NOW + 6000;
  House.render(el, clock);
  await flush();
  clock = NOW;
  assert.match(el.innerHTML, /<span>Climate<\/span>/, 'last good tiles stay on screen');
  assert.match(el.innerHTML, /<span class="pill warn"><span class="sd warn"><\/span>Out of date<\/span><\/h2>/);
});

test('a request that never answers is cut at 60 s and paints the not-reporting state, never a blank block (PageLanes 13.6)', async () => {
  const { House, timers } = boot(() => new Promise(() => {}));
  const el = fakeEl();
  House.render(el, NOW);
  await flush();
  assert.match(el.innerHTML, /Reading the house/);
  const cut = timers.find((t) => t.ms === 60000);
  assert.ok(cut, 'the read carries a 60 s bound');
  cut.fn();
  await flush();
  assert.match(el.innerHTML, /The house is not reporting/);
  // the busy flag is released, so the next render reads again
  clock = NOW + 6000;
  House.render(el, clock);
  clock = NOW;
  assert.equal(timers.filter((t) => t.ms === 60000).length, 2, 'a fresh read started');
});

test('ops.js reads only through jget (bounded at 60 s in app.js), never a raw fetch', () => {
  const ops = fs.readFileSync(path.join(__dirname, '../static/ops.js'), 'utf8');
  assert.doesNotMatch(ops, /\bfetch\(/);
  assert.match(ops, /const opGet=p=>jget\(p\)\.catch/);
  const app = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
  assert.match(app, /const jget=async p=>\{const c=typeof AbortController==='function'\?new AbortController\(\):null,t=c\?setTimeout\(\(\)=>c\.abort\(\),60000\)/);
});
