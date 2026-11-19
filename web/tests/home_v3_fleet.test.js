// node --test tests/home_v3_fleet.test.js
// Home > Fleet and Cluster in design v3 (deck.js DeckUI board/cluster/perf, ops.js DeckOps). Pinned, as a person sees it:
// a unit id is never a heading (baseline problem 28): the row reads a plain name and the id rides into the detail sheet;
// section titles carry no "Updated N min ago" or "Checked" age (one freshness mark per page), only "Out of date" or
// "Not reporting" when that is true; Cluster opens with one strip of engine tiles. No DOM, no network.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const D = new Function(cut(read('static/deck.js'), '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const O = new Function('DeckUI', cut(read('static/ops.js'), '// ==== DECK OPS UI BEGIN', '// ==== DECK OPS UI END ====') + '\nreturn DeckOps;')(D);

const NOW = Date.UTC(2026, 10, 14, 23, 0, 0);
const T = (agoS) => NOW / 1000 - agoS;
// what a person reads: tags and the hidden detail-sheet spans removed
const vis = (h) => h.replace(/<span class="diag">[^<]*<\/span>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const AGE = /Updated|Checked|min ago|just now|h ago/;

test('unit names: a plain name, never the unit id; systemd escapes and run ids go', () => {
  assert.equal(D.unitName('agent-batch-adopt-1794613965-3837389.scope'), 'Agent batch adopt');
  assert.equal(D.unitName('hermes-gateway.service'), 'Hermes gateway');
  assert.equal(D.unitName('mcp-liveness-sweep.service'), 'MCP liveness sweep');
  assert.equal(D.unitName('app-remmina\\x2dapplet@autostart.service'), 'App remmina applet autostart');
  assert.equal(D.unitName('broker@a.timer'), 'Broker a');
  assert.equal(D.unitName('deck_feed_stalls.timer'), 'Deck feed stalls');
  for (const x of ['', null, '.service', '1234567.scope']) assert.equal(D.unitName(x), 'Service');
});

test('failing units: the row is the plain name, the unit id is in the detail sheet, the open-unit hook stays', () => {
  const u = { src: 'x', t: T(60), stale: false, writer_ok: true, failed_units: ['agent-batch-adopt-1794613965-3837389.scope', 'mcp-liveness-sweep.service'] };
  const h = D.board({ units: u }, NOW)[4];
  assert.match(h, /<b>Agent batch adopt<\/b>/);
  assert.match(h, /<b>MCP liveness sweep<\/b>/);
  assert.doesNotMatch(vis(h), /1794613965|\.scope|\.service|mcp-liveness-sweep/);
  assert.match(h, /class="diag">Unit agent-batch-adopt-1794613965-3837389\.scope</);
  assert.match(h, /data-unit="mcp-liveness-sweep\.service"/, 'a .service row still opens the unit sheet');
  assert.doesNotMatch(h, /data-unit="agent-batch/, 'a .scope is not a unit the server can open');
  assert.match(vis(h), /Background services 2 need attention/);
  assert.doesNotMatch(vis(h), AGE);
});

test('Fleet board titles carry no age; stale says Out of date once, a missing part says Not reporting', () => {
  const fresh = { src: 'x', t: T(30), stale: false, items: [{ name: 'pc-desktop', reachable: true, drives: [] }] };
  const b = D.board({ machines: fresh, cluster: { ok: true, model: 'm', running: 0, waiting: 0, kv_cache_pct: 1, t: T(5) }, models: { src: 'x', t: T(5), devices: [{ device: 'Dell', models: [] }] }, units: { src: 'x', t: T(5), writer_ok: true, failed_units: [] } }, NOW);
  for (const [i, part] of b.entries()) assert.doesNotMatch(vis(part), AGE, 'part ' + i);
  const old = D.board({ machines: Object.assign({}, fresh, { stale: true, t: T(5000) }) }, NOW)[0];
  assert.match(old, /<span>Machines<\/span><span>Out of date<\/span>/);
  assert.match(vis(D.board({ machines: { error: 'file missing' } }, NOW)[0]), /Machines is not reporting|Machines are not reporting/);
  const sig = D.fleetSignals({ t: T(5), thermal: { t: T(5), hosts: { a: { cpu_c: 50 } } } }, NOW);
  assert.doesNotMatch(vis(sig), AGE);
});

test('Cluster: one strip of engine tiles first, no ages in titles, a stale feed says Out of date', () => {
  const f = { t: T(60), stale: false, engine: { status: 'up', served_name: 'glm-5.3-flash', max_model_len: 1048576, up_since: T(3 * 86400) },
    proxy: { pc_desktop_8080_up: true, models: ['glm-5.3-flash'] }, bench: { prose_tps: 38.9, code_tps: 40.1, at: T(3600) },
    ratchet: { last_outcome: 'kept', last_date: '2026-11-13', next_run: T(-3600) }, nodes: [{ name: 'spark', reachable: true, gpu_temp_c: 61, gpu_util_pct: 40, power_w: 120, mem_used_gb: 90, mem_total_gb: 128 }], candidates: [] };
  const [c1, c2, c3] = D.cluster(f, NOW);
  assert.match(c1, /<div class="strip" data-n="4" data-nb="4">/);
  assert.equal((c1.match(/<div class="tile/g) || []).length >= 4, true);
  assert.match(vis(c1), /Model glm-5\.3-flash Running/);
  assert.match(vis(c1), /Speed 38\.9 tok\/s/);
  for (const c of [c1, c2, c3]) assert.doesNotMatch(c.replace(/<span class="diag">[^<]*<\/span>/g, '').match(/<div class="secttl">[\s\S]*?<\/div>/g).join(' '), AGE);
  const stale = D.cluster(Object.assign({}, f, { stale: true }), NOW)[0];
  assert.match(stale, /<span>Engine<\/span><span>Out of date<\/span>/);
  assert.match(D.cluster(null, NOW)[0], /data-retry="cluster"/);
  const pf = D.perf({ t: T(5), enabled: true, stop: false, last_tick: T(60), runs_today: { total: 2 }, queue: { queued: 1, running: 0 } }, NOW);
  assert.doesNotMatch(pf.match(/<div class="secttl">[\s\S]*?<\/div>/)[0], AGE);
});

test('agent runs and network: titles keep their counts but no age; a failed service run reads a plain name', () => {
  const s = { t: T(60), counts: { watched: 3 }, alerts: { desktop: true, phone: false }, items: [{ id: 'a', kind: 'unit', name: 'agent-batch-adopt-1794613965-3837389.scope', state: 'failed', since: T(3600), reason: 'exit 1' }] };
  const h = O.stalls(s, NOW);
  assert.match(vis(h), /Agent runs 1 needs a look/);
  assert.doesNotMatch(vis(h).split('Agent batch adopt')[0], AGE);
  assert.match(h, /<b>Agent batch adopt<\/b>/);
  assert.match(h, /class="diag">Unit agent-batch-adopt-1794613965-3837389\.scope</);
  const ts = { t: T(120), counts: { own_devices: 3, own_online: 3, funnel_public: 0, crit: 0 }, nodes: [], exposures: [], alerts: [] };
  const n = O.network(ts, { entities: { 'binary_sensor.internet_reachable': { state: 'on' }, 'binary_sensor.router_reachable': { state: 'on' } } }, NOW);
  assert.doesNotMatch(vis(n), /Updated|Home Assistant/);
  assert.match(vis(n), /House network Internet up · Router up/);
  assert.match(vis(O.network(Object.assign({}, ts, { stale: true }), null, NOW)), /Network Out of date/);
});

test('fleet checks: a failed check never prints its exception; every failure folds into one Not reporting line with Try again (review F3b)', () => {
  const items = [
    { head: 'desktop gpu', text: 'UNAVAILABLE (CalledProcessError)', tag: 'nvidia-smi' },
    { head: 'mail queue', text: 'Traceback (most recent call last): x', tag: '' },
    { head: 'backups', text: '3 of 3 ok', tag: 'live restic' },
    { head: 'cluster', text: 'UNAVAILABLE (TimeoutError)' }, // has its own section, never a tile here
  ];
  const h = D.fleetFacts(items);
  assert.doesNotMatch(vis(h), /UNAVAILABLE|CalledProcessError|Traceback|nvidia-smi|restic/, 'no raw exception and no source on the page');
  assert.equal((h.match(/class="es es-bad"/g) || []).length, 1, 'one line for all failed checks');
  assert.match(vis(h), /2 fleet checks are not reporting It tries again on its own\. Try again/);
  assert.match(h, /data-retry="fleet"/);
  assert.match(h, /class="diag">desktop gpu: UNAVAILABLE \(CalledProcessError\)</, 'the raw text rides into the detail sheet');
  assert.match(vis(h), /Backups 3 of 3 ok/);
  assert.doesNotMatch(h, /Cluster|TimeoutError/);
  const one = D.fleetFacts([{ head: 'desktop gpu', text: 'UNAVAILABLE (CalledProcessError)' }]);
  assert.match(vis(one), /^Desktop gpu is not reporting/);
  assert.equal(D.fleetFacts([]), '');
  assert.equal(D.fleetFacts(null), '');
});

test('fleet summary: the down rows come first (a machine before a host, a site, a service), then the one computed line and one strip of four counters', () => {
  const f = { services: { items: [{ unit: 'hermes-gateway.service', ok: false, state: 'failed' }, { unit: 'webui.service', ok: true }] },
    reach: { items: [{ name: 'Spark', ok: false }, { name: 'Mini', ok: true }] } };
  const st = { items: [{ name: 'meshvault.ai', ok: true }, { name: 'pepgo.org', ok: false }] };
  const bd = { machines: { items: [{ name: 'Spark', reachable: null }, { name: 'pc-desktop', reachable: true }] }, units: { failed_units: ['agent-batch-adopt-1794613965-3837389.scope'] } };
  const s = D.fleetSummary({ f, st, bd });
  assert.equal(s.urgent, 4, 'Spark once (machine and host are the same name), the site, the service, the unit');
  const rows = [...s.html.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(rows.slice(0, 4), ['Spark', 'pepgo.org', 'Hermes gateway', 'Agent batch adopt']);
  assert.match(s.html, /^<div class="flist board-fill fsum-rows">/, 'the first data on the page is the urgent row');
  assert.match(vis(s.html), /^Spark 3 more are down Down/);
  assert.match(s.html, /data-unit="hermes-gateway\.service"/, 'a service row still opens its unit sheet');
  assert.match(s.html, /<p class="fsum-line" role="status">4 down: Spark, pepgo\.org, Hermes gateway and 1 more<\/p>/, 'the failed unit counts too, Spark once; up counts stay in the tiles');
  assert.match(s.html, /<div class="strip" data-n="4" data-nb="4" role="group" aria-label="Fleet counts">/);
  // the machine's disk check raised, and no node check answered for it: Not checked, so the tile counts it as not reported and no row says Down
  // (a machine is Down only when a check answered and said so; the Spark host probe below is that down row)
  assert.match(vis(s.html), /Machines 1 of 2 1 not checked Services 1 of 2 1 down Hosts 1 of 2 1 down Sites 1 of 2 1 down$/);
  assert.doesNotMatch(s.html, /tile bad|frow bad/, 'calm: no fill in the summary; app.js markUrgent fills one item below');
});

// review #353 item 1: the first row deduped by name while the line summed every group, so the kit read "23 more are down" beside
// "Fleet: 25 down". One list now feeds both. L21: the line leads with what is down, by name, and leaves the up counts to the tiles.
test('fleet summary: the line counts down what the rows count, names them, and says nothing about up', () => {
  const f = { services: { items: [{ unit: 'hermes-gateway.service', ok: false, state: 'failed' }, { unit: 'webui.service', ok: true, state: 'active' }, { unit: 'x.service', ok: false, state: 'unknown' }] },
    reach: { items: [{ name: 'Dell', ok: false }, { name: 'Spark', ok: true }, { name: 'Mini', ok: null }] } };
  const st = { items: [{ name: 'a.org', ok: true }, { name: 'b.org', ok: true }] };
  const bd = { machines: { items: [{ name: 'Dell', reachable: false }, { name: 'Spark', reachable: true }, { name: 'Mini', reachable: true }] },
    units: { failed_units: ['hermes-gateway.service', 'backup.timer'] } };
  const s = D.fleetSummary({ f, st, bd });
  const down = Number((s.line.match(/^(\d+) down/) || [])[1]);
  assert.equal(s.urgent, 3, 'Dell, Hermes gateway, Backup: each once');
  assert.equal(down, s.urgent, 'the line says as many are down as the rows show');
  assert.match(vis(s.html), /^Dell 2 more are down Down/);
  assert.equal(s.line, '3 down: Dell, Hermes gateway and Backup · 2 not reported', 'Mini is up as a machine and not reported as a host: one part, not reported');
  assert.doesNotMatch(s.line, /\bup\b/, 'the tiles carry the up counts');
  assert.equal(D.fleetLine([{ name: 'A', s: 'up' }]), '', 'all up: no line (the row says Nothing is down)');
  assert.equal(D.fleetLine([{ name: 'Spark', s: 'down' }, { name: 'spark', s: 'up' }]), '1 down: Spark', 'one part, worst state, first name seen');
  assert.equal(D.fleetLine([{ name: 'A', s: 'down' }, { name: 'B', s: 'down' }]), '2 down: A and B');
  assert.equal(D.fleetLine([], []), '');
});

test('fleet summary: all up reads as one calm row; a feed that did not answer is No data, never zero', () => {
  const s = D.fleetSummary({ f: { error: 'deck server did not answer' }, st: null, bd: { machines: { items: [{ name: 'a', reachable: true }] } } });
  assert.equal(s.urgent, 0);
  assert.match(vis(s.html), /^Nothing is down/);
  assert.match(vis(s.html), /Machines 1 of 1 All up Services No data Hosts No data Sites No data/);
  assert.doesNotMatch(vis(s.html), /\b0 of\b/);
  assert.match(vis(D.fleetSummary(null).html), /Machines No data/);
});

// R1 (SeeReference): unknown is not down. The kit's six units all read "unknown"; the page said "0 of 6, 6 down" and "6 not running".
test('R1: six services with no reading read "0 of 6 · 6 not reported", never down; only a probe that failed is Down', () => {
  const units = ['a', 'b', 'c', 'd', 'e', 'f'].map((u) => ({ unit: u + '.service', ok: false, state: 'unknown' }));
  const s = D.fleetSummary({ f: { services: { items: units }, reach: { items: [] } }, st: { items: [] }, bd: null });
  assert.equal(s.urgent, 0, 'nothing not reported is an urgent row');
  assert.match(vis(s.html), /^Nothing is down/);
  assert.match(vis(s.html), /Services 0 of 6 6 not reported/);
  assert.match(s.html, /role="status">6 not reported<\/p>/, 'nothing is down, so the line names no machine');
  assert.doesNotMatch(vis(s.html), /6 down/);
  const sec = D.fleetServices({ services: { items: units.concat([{ unit: 'g.service', ok: false, state: 'failed' }, { unit: 'h.service', ok: false, state: 'activating' }, { unit: 'i.service', ok: true, state: 'active' }]) }, reach: { items: [] } });
  assert.match(sec, /<span>Services<\/span><span>1 down · 1 degraded · 6 not reported<\/span>/);
  assert.doesNotMatch(sec, /not running/i);
  assert.equal((sec.match(/<div class="chip sm bad">/g) || []).length, 1, 'only the failed unit carries .bad (the crossed square)');
  assert.equal((sec.match(/<i class="sd bad"><\/i>/g) || []).length, 1);
  assert.equal((sec.match(/<i class="sd off"><\/i>/g) || []).length, 6, 'not reported: the dash mark');
  assert.match(sec, /<b><i class="sd warn"><\/i>H<\/b><small>Degraded<\/small>/);
  assert.match(sec, /<b><i class="sd ok"><\/i>I<\/b><small>Up<\/small>/);
  // one state set, one word each
  assert.deepEqual(['up', 'degraded', 'down', 'unknown', 'paused'].map(D.opsWord), ['Up', 'Degraded', 'Down', 'Not reported', 'Paused']);
  assert.deepEqual([true, false, null, undefined, 'yes'].map(D.okState), ['up', 'down', 'unknown', 'unknown', 'unknown']);
});

test('L24: hosts read the shared words; the address that answered and the routes tried ride in the sheet, never on the page', () => {
  const h = D.fleetServices({ services: { items: [] }, reach: { items: [{ name: 'Mini', ok: true, ms: 12.4, via: '198.51.100.132:22' }, { name: 'Dell', ok: false, ms: null, tried: 2 }, { name: 'Ascent' }] } });
  assert.match(vis(h), /Hosts 1 down · 1 not reported Mini Up · 12 ms Dell Down Ascent Not reported/);
  assert.doesNotMatch(vis(h), /198\.51|:22/);
  assert.match(h, /class="diag">Answered at 198\.51\.100\.132:22</);
  assert.match(h, /class="diag">Tried 2 routes</);
});

test('X4: a node or disk percentage that is not a number from 0 to 100 never reaches a style; memory reads GB on Fleet as on Cluster (V12)', () => {
  for (const bad of ['95%;background:url(//x)', '"><img src=x>', 140, -1, null]) {
    const n = D.fleetNodes({ nodes: [{ label: 'Spark', reachable: true, mem_pct: bad, mem_used_gb: 115, mem_total_gb: 122, temp_c: 62 }] });
    assert.doesNotMatch(n, /style=/, 'mem_pct ' + bad);
    assert.match(vis(n), /Spark Memory: no reading/);
    const d = D.fleetDisks({ drives: [{ host: 'pc', label: 'System', pct: bad }] });
    assert.match(d, /<i style="width:0%">/, 'pct ' + bad + ': an empty bar');
    assert.match(vis(d), /-- *$/);
  }
  const n = D.fleetNodes({ nodes: [{ label: 'Spark', reachable: true, mem_pct: 95, mem_used_gb: 115.2, mem_total_gb: 121.7, temp_c: 62 }] });
  assert.match(n, /<div class="v">Memory 95%<\/div><div class="bar"><i style="width:95%"><\/i><\/div>/, 'the bar says what it measures');
  assert.match(vis(n), /124 of 131 GB · 62°C/, 'GiB from the feed read as GB, as Cluster prints them');
  assert.match(vis(D.fleetNodes({ nodes: [{ label: 'Ascent', reachable: false }] })), /Ascent Down/);
});

test('L25: Devices groups computers, phones, cameras, the printer and Home Assistant; two probes that disagree read Degraded', () => {
  const ts = { t: T(60), nodes: [{ name: 'pc-desktop', online: true }, { name: 'dell', online: false, last_seen_h: 7 }, { name: 'spark', online: true }, { name: 'mac-mini', online: true },
    { name: 'tanners-phone', online: true, os: 'iOS' }, { name: 'pixel-10a', online: false, last_seen_h: 195, os: 'android' }, { name: 'someone-elses-phone', online: true, os: 'iOS' }] };
  const f = { reach: { items: [{ name: 'Dell', ok: false }, { name: 'Spark', ok: true }, { name: 'Mini', ok: true, via: '198.51.100.132:22' }] } };
  const bd = { machines: { items: [{ name: 'pc-desktop', reachable: true, drives: [{ pct: 57 }, { pct: 87 }] }, { name: 'Spark', reachable: false }, { name: 'Mac Mini', reachable: true }, { name: 'Dell', reachable: false }] } };
  const ha = { entities: { 'sensor.hp_envy_6400_series_black_cartridge': { state: 'unavailable', updated: T(3 * 3600) }, 'light.x': { state: 'on' } } };
  const h = D.fleetDevices({ ts, f, bd, ha, cams: { cams: [{ ready: true, readers: 0 }, { ready: false }] } }, NOW);
  const t = vis(h);
  assert.match(t, /^Devices 2 down · 1 degraded · 3 not reported/);
  assert.match(t, /Computers pc-desktop This computer · Disk 87% full Up Dell Off the tailnet for 7 h Down Spark Probes disagree · On the tailnet Degraded Ascent Not reported Mac mini On the tailnet Up/);
  assert.match(t, /Phones and tablets iPhone On the tailnet Up Pixel 10a Off the tailnet for 8 d Not reported/);
  assert.doesNotMatch(t, /someone/, 'only the owner\'s own phones are named');
  assert.match(t, /Cameras Cam 1 Streaming Up Cam 2 Not streaming Down/);
  assert.match(t, /Printer and Home Assistant Printer Printer offline · last seen 3 h ago Not reported Home Assistant 2 entities read Up$/);
  assert.doesNotMatch(t, /198\.51/, 'no address on the page');
  assert.match(h, /class="diag">Host probe answered, disk check did not answer</);
  assert.equal((h.match(/class="frow bad"/g) || []).length, 2, 'only the two Down rows can take the urgent fill');
});

test('L26: Cluster lists models by machine read only: without inventory evidence no residency is claimed', () => {
  const f = { t: T(60), engine: { status: 'up', served_name: 'DeepSeek-V4.1-Flash' }, nodes: [{ name: 'spark', reachable: true, mem_used_gb: 124.4, mem_total_gb: 130.7 }] };
  const m = { t: T(60), devices: [{ device: 'Spark', models: ['DeepSeek-V4.1-Flash (tensorfold-native, 1M ctx), engine up'] }, { device: 'pc-desktop', models: ['qwen2.5-coder-1.5b-fim (llama.cpp)', 'glm-ocr (llama.cpp)'] }, { device: 'Dell', models: [] }] };
  const c2 = D.cluster(f, NOW, m, null, { hosts: [] })[1];
  const t = vis(c2.slice(c2.indexOf('Models by machine') - 40));
  assert.match(t, /Models by machine Spark Memory 124 of 131 GB · 1 model DeepSeek-V4\.1-Flash \(tensorfold-native, 1M ctx\), engine up pc-desktop 2 models qwen2\.5-coder-1\.5b-fim \(llama\.cpp\) glm-ocr \(llama\.cpp\) Dell 0 models No models reported/);
  assert.doesNotMatch(t, /Resident|Installed/);
  assert.doesNotMatch(c2, /data-md|Swap/, 'no swap control this round');
  assert.match(D.cluster(f, NOW, null)[1], /Models by machine are not reporting/);
  assert.doesNotMatch(D.cluster(f, NOW)[1], /Models by machine/, 'no board read: the section is left out');
});

// review #353 item 3: a board that answered with an error left Models by machine out with no word. Now the read goes through
// DeckPages.get: a failure says so in the section; a failure after a good read keeps the last rows, marked out of date.
test('L26: a failed board read says so in Models by machine; kept rows read out of date with the reason; the section stands without the cluster feed', () => {
  const f = { t: T(60), engine: { status: 'up', served_name: 'DeepSeek' }, nodes: [] };
  const m = { t: T(60), devices: [{ device: 'Spark', models: ['DeepSeek-V4.1-Flash'] }] };
  // the read as DeckPages.get answers it
  const [em, eold] = D.boardModels({ ok: false, status: 200, data: { error: 'board writer stopped' }, error: 'board writer stopped' });
  assert.equal(eold, null);
  const failed = vis(D.cluster(f, NOW, em, eold)[1]);
  assert.match(failed, /Models by machine Models by machine are not reporting/, 'an error answer is no longer a silent gap');
  assert.match(D.cluster(f, NOW, em, eold)[1], /class="diag">board writer stopped</, 'the raw reason rides in the sheet');
  assert.deepEqual(D.boardModels(null)[0], { error: 'no answer from the deck server' });
  assert.match(D.boardModels({ ok: true, data: { machines: {} } })[0].error, /no model list/);
  const at = NOW - 5 * 60 * 1000;
  const [sm, sold] = D.boardModels({ ok: true, stale: true, at, data: { models: m }, error: 'timed out' });
  assert.equal(sold, at);
  // an inventory that answered with nothing (a kit host with no ModelDeck) says nothing here; the note for that is tested below
  const kept = D.cluster(f, NOW, sm, sold, { hosts: [] })[1];
  assert.match(kept, /<span>Models by machine<\/span><span>Out of date · last read 5 min<\/span>/);
  assert.match(vis(kept), /The fleet board did not answer These rows are from the last time it did\. Try again Spark 1 model DeepSeek-V4\.1-Flash$/);
  assert.match(kept, /data-retry="cluster"/);
  const fresh = D.cluster(f, NOW, D.boardModels({ ok: true, data: { models: m } })[0], null, { hosts: [] })[1];
  assert.doesNotMatch(fresh, /Out of date|did not answer/, 'a good read draws no stale line');
  assert.match(D.cluster(null, NOW, sm, sold, { hosts: [] })[1], /Spark/, 'a down cluster feed still shows the board\'s rows');
  assert.equal(D.boardHasModels({ models: m }), true);
  assert.equal(D.boardHasModels({ models: { error: 'x' } }), false, 'a model list that failed is a failed read, so the last good one stays');
  assert.equal(D.boardHasModels({}), false);
  assert.match(read('static/deck.js'), /DeckPages\.get\('fleet-board',\{shape:DeckUI\.boardHasModels\}\)/, 'Cluster reads the board through the guard');
  assert.match(read('static/deck.js'), /DeckPages\.get\('models',\{shape:DeckUI\.modelInvShape\}\)/, 'and the model inventory too');
});

// SeeViz phase 4: Fleet's machine tiles said Spark and Ascent "Down" while Cluster read them up, on one deck at one moment. The disk check
// (fleet-disks.py) writes ok:null when its own probe raised, which is not the machine being down. One rule, machineState: Not checked, and
// where the page's own node check answers, what it shows. Down only when a check answered and said the machine is not reachable.
test('Fleet machines: a disk check that could not run is never Down; a live node answer says what it shows', () => {
  const f = { t: T(60), stale: false, items: [
    { name: 'Spark', reachable: null, drives: [] }, { name: 'Ascent', reachable: null, drives: [] },
    { name: 'Dell', reachable: null, drives: [] }, { name: 'pc-desktop', reachable: true, drives: [] }] };
  const nodes = { t: T(60), stale: false, nodes: [{ label: 'Spark', reachable: true, mem_pct: 62.4 }, { label: 'Ascent', reachable: true, mem_pct: 55, temp_c: 71 }, { label: 'Dell', reachable: false }] };
  const h = D.bMachines(f, NOW, nodes);
  assert.doesNotMatch(vis(h).replace(/Dell Down The node check did not reach it[^A-Z]*/, ''), /Down/, 'no machine reads Down unless a check said so');
  assert.match(vis(h), /Spark Up · memory 62% Disk space not checked/);
  assert.match(vis(h), /Ascent Up · memory 55% Disk space not checked · 71°C/);
  assert.match(vis(h), /Dell Down The node check did not reach it/, 'a check that answered and could not reach it is Down');
  assert.doesNotMatch(vis(h).replace(/Dell Down The node check did not reach it[^A-Z]*/, ''), /Down/, 'only Dell is Down');
  // no node answer for the machine: Not checked, with the check's own failure named, never Down
  const none = D.bMachines(f, NOW, null);
  assert.doesNotMatch(vis(none), /Down/);
  assert.match(vis(none), /Spark Not checked The disk check did not answer\./);
  assert.match(vis(none), /pc-desktop Up/);
  // a stale node file is no answer (its own section warns it is out of date): the tile says so, and never borrows a day-old "Up · memory"
  const old = D.bMachines(f, NOW, Object.assign({}, nodes, { stale: true }));
  assert.match(vis(old), /Spark Not checked The disk check did not answer\. The node check is out of date\./);
  assert.doesNotMatch(vis(old), /memory 62%|Dell Down/, 'nothing is read from an out-of-date node file');
  assert.match(vis(old), /pc-desktop Up/, 'the disk check that answered still reads Up');
  assert.match(vis(D.bMachines(f, NOW, { error: 'file missing' })), /Spark Not checked The disk check did not answer\. The node check is not reporting\./);
  // machineState is the one rule; the summary counts by it with the same word, so the tile and the line agree
  assert.equal(D.machineState({ name: 'Spark', reachable: null }, nodes).s, 'up');
  assert.equal(D.machineState({ name: 'Dell', reachable: null }, nodes).s, 'down');
  assert.equal(D.machineState({ name: 'Dell', reachable: null }, null).s, 'unknown');
  assert.equal(D.machineState({ name: 'Spark', reachable: null }, Object.assign({}, nodes, { stale: true })).s, 'unknown');
  assert.equal(D.machineState({ name: 'x', reachable: null }, null).s, 'unknown');
  const s = D.fleetSummary({ f: null, st: null, bd: { machines: { items: f.items } }, nd: nodes });
  assert.match(vis(s.html), /^Dell Down/, 'the one machine a check answered down for is the row');
  assert.match(vis(s.html), /Machines 3 of 4 1 down/);
  assert.match(vis(D.fleetSummary({ f: null, st: null, bd: { machines: { items: f.items } } }).html), /^Nothing is down/);
  assert.match(vis(D.fleetSummary({ f: null, st: null, bd: { machines: { items: f.items } } }).html), /Machines 1 of 4 3 not checked/, 'no node check read: the same word the tile draws');
  assert.match(vis(D.fleetSummary({ f: null, st: null, bd: { machines: { items: f.items } }, nd: Object.assign({}, nodes, { stale: true }) }).html), /Machines 1 of 4 3 not checked/, 'a stale node file counts as no answer');
  assert.match(read('static/app.js'), /DeckUI\.board\(bd,now,\{allUnits:fleetUnitsAll,nodes:nd\}\)/, 'the whole node answer reaches the rule');
});

test('Fleet disk true, false and raised null keep distinct states and reasons, even beside a node answer', () => {
  const down = { name: 'Spark', reachable: false, drives: [] };
  const raised = { name: 'Ascent', reachable: null, drives: [], note: 'TimeoutExpired' };
  const leftOut = { name: 'Dell', reachable: null, drives: [], note: 'not in snapshot' };
  const f = { t: T(60), stale: false, items: [down, raised, leftOut] };
  const nodes = { stale: false, nodes: [{ label: 'Spark', reachable: true, mem_pct: 62 }] };
  for (const nd of [null, nodes, { stale: true, nodes: nodes.nodes }]) {
    assert.deepEqual(D.machineState(down, nd), { s: 'down', why: 'The disk check answered that it is not reachable.' });
    const h = D.bMachines(f, NOW, nd);
    assert.match(h, /<i class="sd bad"><\/i>Spark<\/div><div class="v">Down/);
    assert.match(vis(h), /Spark Down The disk check answered that it is not reachable\. .*disk sizes are unknown/);
    assert.match(vis(h), /Ascent Not checked The disk check did not answer\. TimeoutExpired/);
    assert.match(vis(h), /Dell Not checked This machine was left out of the last snapshot\./);
    assert.doesNotMatch(h, /Ascent<\/div><div class="v">Down|Dell<\/div><div class="v">Down/);
    assert.match(vis(D.fleetSummary({ bd: { machines: f }, nd }).html), /^Spark Down/);
  }
  for (const m of [{ name: 'x' }, { name: 'x', reachable: null }]) {
    assert.deepEqual(D.machineState(m, null), { s: 'unknown', why: 'The disk check did not answer.' });
  }
  const hostile = D.bMachines({ t: T(60), items: [{ name: 'x', reachable: null, note: '<img src=x onerror=alert(1)>' }] }, NOW);
  assert.match(hostile, /&lt;img/);
  assert.doesNotMatch(hostile, /<img/);
});

// SeeLostSweep L26: the section waited for "a model inventory route" while GET /api/models (modeldeck.rs) had been in main since #349. It reads
// that route now for installed against resident and each model's own GPU share, and keeps the board's list for the names it alone carries.
test('L26: Models by machine reads the inventory for GPU and installed against resident; an unknown model claims neither', () => {
  const f = { t: T(60), engine: { status: 'up', served_name: 'DeepSeek-V4.1-Flash' }, nodes: [{ name: 'Spark', reachable: true, mem_used_gb: 86, mem_total_gb: 128 }] };
  const m = { t: T(60), devices: [
    { device: 'Spark', models: ['DeepSeek-V4.1-Flash (tensorfold-native, 1M ctx), engine up'] },
    { device: 'pc-desktop', models: ['qwen2.5-coder-1.5b-fim (llama.cpp, q8)', 'hand-placed-model (gguf)'] },
    { device: 'Dell', models: ['glm-ocr (llama.cpp)'] }] };
  const inv = { t: T(45), checked: T(45), stale: false, hosts: [
    { id: 'spark', label: 'Spark', status: 'online', memory_total_gib: 128, memory_used_pct: 67.2, installed: ['DeepSeek-V4.1-Flash'], resident: ['DeepSeek-V4.1-Flash'],
      services: [{ id: 'cluster', weights: true, models: [{ id: 'DeepSeek-V4.1-Flash', gpu_gib: 48.5, resident: true, context_length: 1048576, format: 'EXL3' }] }] },
    { id: 'pc-desktop', label: 'PC', status: 'online', memory_total_gib: 125, installed: ['qwen2.5-coder-1.5b-fim'], resident: [],
      services: [{ id: 'llama', weights: true, models: [{ id: 'qwen2.5-coder-1.5b-fim', gpu_gib: 1.2, resident: false, format: 'Q8_0' }] },
        { id: 'jev', weights: false, models: [{ id: 'jev-local/x', resident: null }] }] }] };
  const c2 = D.cluster(f, NOW, m, null, inv)[1];
  const t = vis(c2);
  // Spark: loaded, with its own GPU share
  assert.match(t, /Spark Memory 86 of 128 GB · 1 model DeepSeek-V4\.1-Flash \(tensorfold-native, 1M ctx\), engine up 48\.5 GB on the GPU Resident/);
  assert.match(c2, /<div class="frow"><span class="fl"><b>DeepSeek-V4\.1-Flash \(tensorfold-native, 1M ctx\), engine up<\/b><small>48\.5\u00A0GB on the GPU<\/small><\/span><span class="fr"><span class="pill"><i class="sd ok"><\/i>Resident<\/span><\/span><\/div>/);
  // pc-desktop: installed but not loaded says Installed; a model the inventory does not know claims nothing at all
  assert.match(t, /qwen2\.5-coder-1\.5b-fim \(llama\.cpp, q8\) 1\.2 GB on the GPU Installed/);
  assert.match(t, /hand-placed-model \(gguf\)(?= pc-desktop|\s*Dell)/, 'unknown model: no GPU figure and no pill');
  assert.doesNotMatch(t, /hand-placed-model \(gguf\)[^]*?Installed/, 'never a guessed Installed');
  // Dell has no inventory row, so no residency or installed claim is drawn.
  assert.match(t, /Dell 1 model glm-ocr \(llama\.cpp\)/);
  assert.doesNotMatch(c2, /not reported right now/, 'the inventory answered, so no missing line');
  // the shape the guard checks, and the not-reporting answer it must refuse
  assert.equal(D.modelInvShape({ hosts: [] }), true);
  assert.equal(D.modelInvShape({ status: 'not_reporting', reason: 'ModelDeck is not running' }), false);
  assert.equal(D.modelInvShape(null), false);
  // an inventory that is not answering: one plain line, the rows stay, and no row pretends to know installed or GPU
  const bad = D.cluster(f, NOW, m, null, D.keptFeed({ ok: false, status: 200, data: null, error: 'ModelDeck is not running on this computer' }))[1];
  assert.match(vis(bad), /Installed and GPU per model are not reported right now\./);
  assert.match(bad, /class="diag">ModelDeck is not running/);
  assert.doesNotMatch(vis(bad).replace('Installed and GPU per model are not reported right now.', ''), /Resident|Installed|GB on the GPU/, 'no pill and no GPU figure without the inventory');
  // a kept inventory: the title carries the age once, and the line says which read went quiet
  const at = NOW - 20 * 60 * 1000;
  const kept = D.cluster(f, NOW, m, null, Object.assign({}, inv, { kept_at: at }))[1];
  assert.match(kept, /<span>Models by machine<\/span><span>Out of date · last read 20 min<\/span>/);
  assert.match(vis(kept), /The model inventory did not answer These rows are from the last time it did\./);
  assert.match(vis(kept), /48\.5 GB on the GPU/, 'the kept rows still carry the facts');
  assert.doesNotMatch(read('static/deck.js'), /until a model inventory route exists/, 'the waiting comment is gone');
});


// Main 2026-11-15: a failed refresh blanked Engine and Tuning loop (feedGet dropped the last answer). They read through DeckPages.get now:
// a kept answer stays on the page with "Out of date · last read N min" in each section title; a first failure says Not reporting.
test('Cluster: Engine and Tuning loop keep their last rows through a failed refresh, marked out of date with the last read', () => {
  const at = NOW - 7 * 60 * 1000;
  const feed = { t: T(60), engine: { status: 'up', served_name: 'DeepSeek' }, nodes: [{ name: 'spark', reachable: true, mem_used_gb: 90, mem_total_gb: 128 }], ratchet: { last_outcome: 'kept', last_date: '2026-11-13' } };
  const pf = { t: T(60), enabled: true, stop: false, last_tick: T(60), runs_today: { total: 2 }, queue: { queued: 1, running: 0 } };
  const f = D.keptFeed({ ok: true, stale: true, at, data: feed, error: 'http 500' });
  assert.equal(f.kept_at, at);
  assert.equal(feed.kept_at, undefined, 'the kept answer itself is never changed');
  const [c1, c2] = D.cluster(f, NOW);
  assert.match(c1, /<span>Engine<\/span><span>Out of date · last read 7 min<\/span>/);
  assert.match(vis(c1), /Model DeepSeek/, 'the engine rows stay');
  assert.match(c2, /<span>Nodes<\/span><span>Out of date · last read 7 min<\/span>/);
  assert.match(vis(c2), /spark Memory 70%/);
  const p = D.perf(D.keptFeed({ ok: true, stale: true, at, data: pf }), NOW);
  assert.match(p, /<span>Tuning loop<\/span><span>Out of date · last read 7 min<\/span>/);
  assert.match(vis(p), /Perf loop Running · 2 runs today/);
  // a fresh read: no stale words; a first failure: Not reporting with the reason in the sheet
  assert.doesNotMatch(D.cluster(D.keptFeed({ ok: true, data: feed }), NOW)[0], /Out of date/);
  const bad = D.cluster(D.keptFeed({ ok: false, status: 500, data: null, error: 'http 500' }), NOW)[0];
  assert.match(vis(bad), /Cluster is not reporting/);
  assert.match(bad, /class="diag">http 500</);
  assert.equal(D.keptFeed({ ok: false, data: { status: 'not_reporting', error: 'collector stopped' }, error: 'collector stopped' }).error, 'collector stopped', 'the feed\'s own reason is kept');
  assert.equal(D.keptFeed(null).error, 'no answer from the deck server');
  const src = read('static/deck.js');
  assert.match(src, /DeckPages\.get\('cluster'\),DeckPages\.get\('perfloop'\)/, 'both reads go through the guard');
  assert.doesNotMatch(src.slice(src.indexOf('const v6Cluster='), src.indexOf('const v6Cluster=') + 600), /feedGet\(/);
});

test('W10, G11, V14: the tuning card says its outcome in words with signed percents; ids and log lines ride in the sheet', () => {
  const pf = { t: T(60), enabled: false, stop: true, last_tick: T(3600), runs_today: { total: 0 }, queue: { queued: 5, running: 0 }, agents: {},
    last_result: { id: 'pl-20261002-205600-ib-hca-both-rails', title: 'IB_HCA both rails', outcome: 'REJECTED', gain: '-1.8%', finished: T(86400),
      note: "GrokCandidateReview: IB_HCA both rails; score -1.8%; deltas {'prose_tps': -0.0379, 'code_tps': 0.0015, 'prefill_tps': 0.0348, 'conc6_tps': -0.0429}" },
    exec_blocked_by: { stop_flag: 'STOP file present', live_env: '/var/tmp/glm53-knapcio/env.live missing: run perf-loop init' } };
  const h = D.perf(pf, NOW), t = vis(h);
  assert.match(t, /Rejected · gain −1\.8% IB_HCA both rails · Writing −3\.8% · Coding \+0\.2% · Prefill \+3\.5% · 6 at once −4\.3% · 24 h ago/);
  assert.match(t, /Held Stop flag · Live env/);
  assert.doesNotMatch(t, /deltas|\{|pl-2026|\/var\/tmp|STOP file/, 'no raw dict, id or path on the page');
  assert.match(h, /class="diag">Experiment pl-20261002-205600-ib-hca-both-rails</);
  assert.match(h, /class="diag">live env: \/var\/tmp/);
  const c1 = D.cluster({ t: T(60), engine: { status: 'up' }, ratchet: { last_outcome: 'APPLIED', last_step: 'ds-improve candidate image-a-fixed-parallel-20261104 marked rejected (superseded)', last_date: '2026-11-12' } }, NOW)[0];
  assert.match(vis(c1), /Tuning Applied Last run Nov 12/);
  assert.doesNotMatch(vis(c1), /image-a-fixed/, 'the candidate id is in the sheet, not on the card (G11)');
  assert.match(c1, /class="diag">Step: ds-improve candidate image-a-fixed-parallel-20261104/);
  assert.deepEqual(D.tuneDeltas('no dict here'), []);
});

test('cluster TV board: engine and model, each node memory and temperature, the tuning headline, then every error row', () => {
  const f = { t: T(60), engine: { status: 'up', served_name: 'glm-5.3-flash' }, proxy: { pc_desktop_8080_up: true },
    nodes: [{ name: 'spark', reachable: true, mem_used_gb: 90.4, mem_total_gb: 128, gpu_temp_c: 61.2, gpu_util_pct: 40 }, { name: 'ascent', reachable: false }],
    errors: [{ source: 'spark engine', reason: 'timeout' }, { source: 'cluster.json', reason: 'x' }] };
  const pf = { t: T(5), enabled: true, stop: false, runs_today: { total: 3 } };
  const h = D.clusterBoard(f, pf, NOW), t = vis(h);
  assert.match(h, /^<div class="strip" data-n="4" data-nb="4" role="group" aria-label="Cluster now">/);
  assert.match(t, /^Engine Running glm-5\.3-flash Spark 71% memory 90 of 128 GB · 61°C · 40% busy Ascent Not reachable Tuning Running 3 runs today/);
  assert.match(h, /<div class="flist board-fill">/);
  assert.match(t, /Ascent Not reachable Spark engine Not reporting/, 'every error row, the node first');
  assert.doesNotMatch(t, /cluster\.json|timeout/, 'no source text and no raw reason on the board');
});

// review #390: a kept engine is not a live one. The board's tile says "Running at last read" and a warn row says how old the read is.
test('cluster TV board: a kept answer reads "at last read" on its tile and one warn row with its age; a fresh one does not', () => {
  const at = NOW - 12 * 60 * 1000;
  const f = { t: T(60), engine: { status: 'up', served_name: 'DeepSeek' }, proxy: { pc_desktop_8080_up: true }, nodes: [] };
  const pf = { t: T(60), enabled: true, stop: false, runs_today: { total: 2 } };
  const kept = D.clusterBoard(D.keptFeed({ ok: true, stale: true, at, data: f }), D.keptFeed({ ok: true, stale: true, at, data: pf }), NOW);
  assert.match(vis(kept), /^Engine Running at last read DeepSeek/);
  assert.match(vis(kept), /Tuning Running at last read 2 runs today/);
  assert.match(kept, /<b>Cluster<\/b><\/span><span class="fr"><span class="pill"><i class="sd warn"><\/i>Out of date · last read 12 min<\/span>/);
  assert.match(vis(kept), /Tuning loop Out of date · last read 12 min/);
  const fresh = vis(D.clusterBoard(f, pf, NOW));
  assert.doesNotMatch(fresh, /at last read|Out of date/);
  assert.match(fresh, /^Engine Running DeepSeek/);
});

test('cluster TV board: missing feeds read No data and Not reporting, never zero; a calm cluster has no error list', () => {
  const none = vis(D.clusterBoard(null, null, NOW));
  assert.match(none, /^Engine No data Not reporting Tuning No data Not reporting Cluster Not reporting Tuning loop Not reporting$/);
  assert.doesNotMatch(none, /\b0\b/);
  const calm = D.clusterBoard({ engine: { status: 'up', served_name: 'm' }, nodes: [{ name: 'spark', reachable: true }] }, { enabled: false }, NOW);
  assert.doesNotMatch(calm, /flist/);
  assert.match(vis(calm), /Spark No data Temperature: no data Tuning Off/);
  assert.match(vis(D.clusterBoard({ engine: { status: 'down' } }, { retirement_date: '2026-10-07' }, NOW)), /Engine Down .*Nodes No data Tuning Retired Since Oct 7 Engine Down/);
});

test('cluster TV board, full outage: every state row stays, feed errors fill to the cap, the rest is one exact count row', () => {
  const names = ['spark', 'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'cluster.json'];
  const f = { engine: { status: 'down', served_name: 'm' }, proxy: { pc_desktop_8080_up: false },
    nodes: [{ name: 'spark', reachable: false }, { name: 'ascent', reachable: false }], errors: names.map((source) => ({ source, reason: 'x' })) };
  assert.equal(f.errors.length, 12, 'twelve error inputs');
  const h = D.clusterBoard(f, { error: 'file missing' }, NOW);
  const rows = [...h.matchAll(/<div class="frow"><span class="fl"><b>([^<]+)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(rows.slice(0, 5), ['Engine', 'Proxy', 'Spark', 'Ascent', 'Tuning loop'], 'the state rows, in order');
  assert.equal(rows.length, 8, 'the cap (CLUSTER_BOARD_ROWS) is the whole list, the count row included');
  assert.deepEqual(rows.slice(5), ['Alpha', 'Bravo', '9 more not reporting'], 'Spark is not listed twice; 10 named and 1 unnamed remain, 2 shown');
  assert.doesNotMatch(h, /\u2026/);
  // a list that fits shows every row and no count row
  const few = D.clusterBoard(Object.assign({}, f, { errors: [{ source: 'alpha' }, { source: 'bravo' }] }), { error: 'file missing' }, NOW);
  assert.doesNotMatch(few, /more not reporting/);
  assert.match(vis(few), /Alpha Not reporting Bravo Not reporting$/);
  // a source with no plain name is counted, never dropped
  assert.match(vis(D.clusterBoard(Object.assign({}, f, { errors: [{ source: 'cluster.json' }] }), { error: 'file missing' }, NOW)), /1 more not reporting$/);
});
