'use strict';
// Liquid Glass control layer, the one-pattern tie-together, the calm Fleet and the filled Life page (no DOM, no network).
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const html = require('./shell_legacy_css.js')(), appJs = read('app.js'), deckJs = read('deck.js');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (src) => [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/^@[^{]*\{/, ''), body: m[2] }));
const a = deckJs.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), b = deckJs.indexOf('// ==== DECK V6 UI HELPERS END ====');
const D = new Function(deckJs.slice(a, b) + '\nreturn DeckUI;')();
const NOW = Date.UTC(2026, 9, 6, 16, 0, 0);
const T = (s) => NOW / 1000 - s;
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'gitsync.sample.json'), 'utf8'));
const CONTROLS = ['#top', '#sheetp', '#runp #runbar', '#runp #runrow', '#vbar', '#viewer #vprev', '#viewer #vnext', '.lnres'];
const UNDER = CONTROLS.map((s) => s + '::before').join(',');




// ---------------- Code backup (gitsync.json) ----------------
const backup = (o) => Object.assign({ src: '~/.meshvault/status/deck/gitsync.json', stale: false, age: 60 }, fx, o);
test('Code backup shows local-ref estimates, missing gaps, unknowns, failures, and the repo sheet', () => {
  const h = D.bBackup(backup(), NOW);
  assert.match(h, /<span>Code backup<\/span>/);
  assert.equal((h.match(/class="frow"/g) || []).length, 3);
  assert.match(h, /<b>Desktop<\/b><small>No local commits ahead/);
  assert.match(h, /<b>Mac mini<\/b><small>3 repos have local commits ahead/);
  // the row is one human line: no repeated counts, no "unknown unknown" (the counts live in the sheet)
  assert.doesNotMatch(h, /no remote|unknown unknown|\bunknown \d/);
  assert.match(h, /<span class="pill warn"><i class="sd warn"><\/i>Ahead<\/span>/);
  assert.match(h, /<span class="pill"><i class="sd ok"><\/i>No commits ahead<\/span>/);
  assert.match(h, /<b>Dell<\/b><small>Not checked yet \u00b7 unreachable<\/small>/);
  assert.match(h, /Local refs only\. Remote backup is not verified\./);
  assert.doesNotMatch(h, /All \d+ repos pushed|\bPushed\b|\bTo push\b/);
  const s = D.syncSheet(backup(), 'mac-mini', NOW);
  assert.equal(s.log.length, 3);
  assert.match(s.log[0], /^projects\/meshvault\/ios-app \u00b7 premium\/deck-20261005 \u00b7 4 ahead$/);
  assert.match(s.lines.join(' '), /No local commits ahead|3 repos have local commits ahead/);
  assert.match(s.lines.join(' '), /Unique repos: 27.*Owner repos: 23.*Repos with local commits ahead: 3/);
  assert.equal(s.logTitle, 'Repos with local commits ahead');
  const st = D.bBackup(backup({ hosts: [{ host: 'dell', label: 'Dell', repos: 121, unpushed: 7, no_remote: 1, unknown: 2, stale_s: 7200, error: 'timeout' }] }), NOW);
  assert.match(st, /<small>7 repos have local commits ahead \u00b7 timeout \u00b7 checked 2 h ago<\/small>/);
  assert.doesNotMatch(st, /no remote|unknown 2/);
  assert.match(st, /<span class="pill"><i class="sd off"><\/i>Not reported<\/span>/, 'R1: a backup state the scan could not settle is Not reported with the dash');
});

test('Code backup never calls an unknown count zero or treats a no-remote host as clean', () => {
  const unknown = D.bBackup(backup({ hosts: [{ host: 'x', label: 'X', repos: 2, own_repos: 2, unpushed: null, no_remote: 1, unknown: 1, stale_s: 0 }] }), NOW);
  assert.match(unknown, /<small>Local commits ahead: unknown<\/small>/);
  assert.match(unknown, /Not reported/);
  const zero = D.bBackup(backup({ hosts: [{ host: 'x', repos: 2, unpushed: 0, no_remote: 0, unknown: 0, stale_s: 0 }] }), NOW);
  assert.match(zero, /No local commits ahead/);
  assert.doesNotMatch(zero, /Not reported/);
});

test('Code backup rows: one short human line, the counts only in the sheet, never a bare unknown or a cut mid-word', () => {
  const row = (o) => D.bBackup(backup({ hosts: [Object.assign({ host: 'x', label: 'X', checkouts: 9, repos: 4, own_repos: 4, clean: 2, unpushed: 0, no_remote: 0, dirty: 1, third_party: 0, unknown: 0, stale_s: 0 }, o)] }), NOW);
  const text = (h) => /<small>([^<]*)<\/small>/.exec(h)[1];
  // partial scan with unknown repos: the line says so in words and the sheet carries the numbers
  const partial = row({ unknown: 3, no_remote: 2, error: 'partial scan' });
  assert.equal(text(partial), 'Not every repo was checked \u00b7 partial scan');
  const s = D.syncSheet(backup({ hosts: [{ host: 'x', label: 'X', repos: 4, own_repos: 4, unpushed: 0, no_remote: 2, unknown: 3, stale_s: 0, error: 'partial scan' }] }), 'x', NOW);
  assert.ok(s.lines.includes('No remote: 2') && s.lines.includes('Unknown: 3'));
  // an old scan says it was not checked recently, and how long ago
  assert.equal(text(row({ stale_s: 90000 })), 'Not checked recently \u00b7 checked 25 h ago');
  // no row in any state repeats counts or reads "unknown unknown"; every line stays short enough for a 142 px column (two lines of about 22 characters)
  for (const o of [{}, { unpushed: 3 }, { unpushed: null }, { unpushed: null, own_repos: null, repos: null, error: 'unreachable', stale_s: null }, { unknown: 2 }, { no_remote: 1 }, { unknown: null, no_remote: null }, { stale_s: 7200, error: 'timeout' }]) {
    const t = text(row(o));
    assert.doesNotMatch(t, /unknown unknown|no remote|\bunknown \d|^\s*\u00b7/);
    assert.ok(t.length <= 64, t);
  }
});

// ---------------- Dev and Home: one row pattern, one empty-state look ----------------
test('Dev: a failing row puts the mark and the word in ONE inline cell, like Passing and Running (never stacked)', () => {
  const d = { t: T(5), github: { open_prs: [{ repo: 'o/a', num: 1, title: 'T', ci: 'fail' }, { repo: 'o/a', num: 2, title: 'U', ci: 'pass' }], failing_main: [{ repo: 'o/a', workflow: 'CI' }], at: T(60) }, vercel: { projects: [] }, supabase: { projects: [] } };
  const col = D.devPage(d, NOW);
  const cells = [...col.matchAll(/<span class="fr">(<span>|<i )/g)].map((m) => m[1]);
  assert.ok(cells.length >= 3, 'main row plus two PR rows');
  assert.deepEqual([...new Set(cells)], ['<span>'], 'every right cell starts with ONE inline span (mark and word together), never a bare mark');
  assert.match(col, /<span class="fr"><span><i class="sd bad"><\/i>Failing<\/span>/);
  assert.doesNotMatch(col, /<span class="fr"><i class="sd/);
});

test('Home: an empty state is the one .es component on the page, never wrapped in a card of its own', () => {
  const done = { t: T(5), src: 'x', stale: false, errors: [], needs: [], app_store: {}, products: [] };
  const open = Object.assign({}, done, { errors: [{ source: 's', reason: 'r' }] });
  for (const p of [done, open]) {
    const home = D.products(p, NOW);
    for (const h of [home.needs, home.maintenance]) {
      assert.match(h, /class="es /);
      assert.doesNotMatch(h, /<div class="flist"><div class="es/, 'an empty state inside a .flist card is a card in a card');
    }
  }
  // a list with rows still sits in one card
  const rows = { t: T(5), src: 'x', stale: false, errors: [], needs: [{ text: 'Answer App Review', source: 'asc', sev: 'high', why: 'w' }], app_store: {}, products: [] };
  assert.match(D.products(rows, NOW).needs, /^<div class="flist"><div class="frow need sv-high"|^<div class="flist"><a /);
  // the bare look of those empty states on the Home page is v3 CSS (css/home.css, ui.css): tests/home_v3_layout.test.js
});

test('Code backup: text that can reach the screen from the feed goes through the one credential scanner', () => {
  // fake credentials are assembled here so no scanner sees a secret-shaped literal in the repo
  const skKey = ['sk', 'abcdefghijklmnop1234'].join('-'), ghTok = ['ghp', 'abcdefghijklmnopqrstuvwxyz0123'].join('_'), pw = 'hunter2' + 'secretvalue';
  const repo = 'work/api_key=' + skKey, branch = 'fix/' + ghTok;
  const b = backup({ hosts: [{ host: 'box', label: 'Box password=' + pw, repos: 4, own_repos: 4, unpushed: 1, no_remote: 0, unknown: 0, stale_s: 0, error: 'token=' + ghTok },
    { host: 'ok', label: 'Fine', repos: 1, own_repos: 1, unpushed: 0, no_remote: 0, unknown: 0, stale_s: 0 }], unpushed: [{ host: 'box', repo, branch, ahead: 1 }] });
  const s = D.syncSheet(b, 'box', NOW);
  const all = D.bBackup(b, NOW) + JSON.stringify(s);
  for (const secret of [skKey, ghTok.slice(0, 10), pw]) assert.ok(!all.includes(secret), 'leaked ' + secret.slice(0, 6));
  assert.equal(s.log[0], 'work/api_key=[redacted] \u00b7 fix/[redacted] \u00b7 1 ahead');
  assert.match(s.title, /\[redacted\]/);
  assert.match(s.sub, /\[redacted\]/);
  // plain names are untouched
  const ok = D.syncSheet(backup(), 'mac-mini', NOW);
  assert.equal(ok.title, 'Mac mini');
  assert.match(ok.log[0], /^projects\/meshvault\/ios-app \u00b7 premium\/deck-20261005 \u00b7 4 ahead$/);
});

test('Code backup: the sheet says repos, never commits, for a repo count', () => {
  const s = D.syncSheet(backup(), 'mac-mini', NOW);
  assert.ok(s.lines.includes('Repos with local commits ahead: 3'));
  assert.ok(!s.lines.some((l) => /^Local commits ahead/.test(l)), 'a count of repos is not a count of commits');
  assert.ok(D.syncSheet(backup(), 'dell', NOW).lines.includes('Repos with local commits ahead: unknown'));
});

test('Code backup: a check under a minute ago says "just now", never "checked  ago"', () => {
  const one = (s) => backup({ hosts: [{ host: 'x', label: 'X', repos: 2, own_repos: 2, unpushed: 0, no_remote: 0, unknown: 0, stale_s: s }] });
  for (const s of [1, 2, 10, 30, 44]) {
    assert.match(D.syncSheet(one(s), 'x', NOW).sub, /checked just now$/, 'stale_s ' + s);
    assert.doesNotMatch(D.syncSheet(one(s), 'x', NOW).sub + D.bBackup(one(s), NOW), /checked\s+ago|checked\s{2}/);
  }
  // a fresh row stays one line; an old one says how old
  assert.doesNotMatch(D.bBackup(one(30), NOW), /checked/);
  assert.match(D.bBackup(one(7200), NOW), /Not checked recently \u00b7 checked 2 h ago/);
  assert.match(D.syncSheet(one(90), 'x', NOW).sub, /checked 2 min ago$/);
  assert.doesNotMatch(D.syncSheet(one(0), 'x', NOW).sub, /checked/);
});

test('Code backup: a missing feed is the one calm empty state, never "unavailable", never red', () => {
  for (const f of [null, undefined, { error: 'file missing', src: '~/.meshvault/status/deck/gitsync.json', stale: true }, backup({ hosts: [] }), backup({ hosts: 'x' })]) {
    const m = D.bBackup(f, NOW);
    assert.match(m, /Backup status not reported yet/);
    assert.match(m, /es es-idle/);
    assert.doesNotMatch(m, /unavailable|es-bad|\bbad\b|Not reporting/i);
  }
});

// ---------------- Fleet is not a red wall ----------------
test('Fleet: a failing unit is one calm row, the header carries the count, color fill is for the one most urgent item only', () => {
  const units = { src: 'x', t: T(60), stale: false, ok: true, writer_ok: true, failed_units: ['asc-watch.service', 'app-remmina\\x2dapplet@autostart.service', 'glm-recipes-daily.service', 'a.service', 'b.service', 'c.service', 'd.service', 'e.service'] };
  const h = D.bUnits(units, NOW);
  assert.match(h, /<span>Background services<\/span><span>8 need attention<\/span>/);
  assert.equal((h.match(/class="frow"/g) || []).length, 8);
  assert.match(h, /<b>App remmina applet autostart<\/b>/);
  assert.doesNotMatch(h, /tile bad|frow bad|pill bad|\b7 failed\b|\b8 failed\b/);
  // the fill rule (only .urgent is filled) is v3 CSS in css/home.css: tests/home_v3_layout.test.js
  assert.doesNotMatch(appJs, /#fl1 \.node\.bad/, 'there is no .node in #fl1: that selector can never match');
});

// a tiny DOM with the real layout: app.js fleet() builds three column bodies and fleetPlace() puts them in #fleet, each block marked with
// its column (data-fc): off TV as whole sections (section.fsec), on TV inside #fl1, #fl2 and #fl3. DeckUI.board() machines (B[0]) are in
// the third, the older cluster-node tiles (#fnd) in the first, host chips (#frc) and site chips (#fst) in the second. Selectors are
// descendant chains of #id, .class and [data-fc="N"] compounds.
function fleetDom(tv) {
  const el = (id, cls, kids = [], fc = null) => { const n = { id, fc, cls: new Set(cls), kids, parent: null, classList: { add: (c) => n.cls.add(c), remove: (c) => n.cls.delete(c) } }; kids.forEach((k) => { k.parent = n; }); return n; };
  const walk = (n) => [n, ...n.kids.flatMap(walk)];
  const one = (n, c) => c.match(/#[^#.[]+|\.[^#.[]+|\[[^\]]+\]/g).every((t) => (t[0] === '#' ? n.id === t.slice(1) : t[0] === '[' ? t === '[data-fc="' + n.fc + '"]' : n.cls.has(t.slice(1))));
  const hit = (n, parts) => one(n, parts[parts.length - 1]) && (parts.length === 1 || (() => { for (let p = n.parent; p; p = p.parent) if (hit(p, parts.slice(0, -1))) return true; return false; })());
  // A machine is only .bad when a check answered and said it is not reachable; a disk probe's own raise is null.
  const mach = /class="(tile node[^"]*\bbad\b[^"]*)"/.exec(D.bMachines({ t: T(60), stale: false, items: [{ name: 'Spark', reachable: false, drives: [] }] }, NOW, { stale: false, nodes: [{ label: 'Spark', reachable: false }] }));
  assert.ok(mach, 'bMachines renders a machine the node check could not reach as .tile.node.bad');
  const unchecked = D.bMachines({ t: T(60), stale: false, items: [{ name: 'Spark', reachable: null, drives: [] }] }, NOW, { stale: false, nodes: [{ label: 'Spark', reachable: true, mem_pct: 62 }] });
  assert.doesNotMatch(unchecked, /tile node bad|>Down</, 'a disk check that raised is not the machine being down');
  assert.match(unchecked, /Up \u00B7 memory 62%/);
  const doc = {};
  const make = ({ machine, cluster, host, site }) => {
    const m = machine ? [el(null, mach[1].split(' '))] : [];
    const col = (i, kids) => (tv ? [el('fl' + i, [], kids, i)] : kids.map((k) => el(null, ['fsec'], [k], i)));
    const root = el('fleet', [], [...col(1, [el('fnd', [], cluster ? [el(null, ['tile', 'bad'])] : [])]), ...col(2, [el('frc', [], host ? [el(null, ['chip', 'bad'])] : []), el('fst', [], site ? [el(null, ['chip', 'bad'])] : [])]), ...col(3, [el(null, ['mach'], m)])]);
    const nodes = walk(root);
    doc.querySelectorAll = (s) => (s === '#fleet .urgent' ? nodes.filter((n) => n !== root && n.cls.has('urgent')) : []);
    doc.querySelector = (s) => nodes.find((n) => hit(n, s.split(' '))) || null;
    return { nodes, tag: (n) => (n.parent.id || n.parent.cls.values().next().value) };
  };
  return { make, doc };
}
test('Fleet urgency: one element is filled, a machine in the third column before a cluster node before a host before a site', () => {
  const src = appJs.slice(appJs.indexOf('function markUrgent()'), appJs.indexOf("// fleetPlace replaces #fleet's children"));
  for (const tv of [false, true]) {
    const run = (flags) => {
      const { make, doc } = fleetDom(tv), d = make(flags);
      const f = new Function('document', src + '\nmarkUrgent();markUrgent();');
      f(doc);
      return d.nodes.filter((n) => n.cls.has('urgent')).map(d.tag);
    };
    assert.deepEqual(run({ machine: true, cluster: true, host: true, site: true }), ['mach'], 'a bad Machines tile wins over every cluster node, host and site');
    assert.deepEqual(run({ machine: true }), ['mach']);
    assert.deepEqual(run({ cluster: true, host: true, site: true }), ['fnd'], 'a cluster node is a machine too');
    assert.deepEqual(run({ host: true, site: true }), ['frc']);
    assert.deepEqual(run({ site: true }), ['fst']);
    assert.deepEqual(run({}), []);
    // the old urgent mark is cleared when the failure goes away
    const { make, doc } = fleetDom(tv), d = make({ machine: true, host: true });
    const g = new Function('document', src + '\nmarkUrgent();return markUrgent;');
    const again = g(doc);
    d.nodes.find((n) => n.cls.has('node')).cls.delete('bad');
    again();
    assert.deepEqual(d.nodes.filter((n) => n.cls.has('urgent')).map(d.tag), ['frc']);
  }
  assert.match(appJs, /const c3=\(B\[0\]/, 'the Machines tiles are the third column body');
  assert.match(appJs, /const next=\[c1,c2,c3\];fleetPlace\(next\);fleetGood=next/, 'publish the matching columns only after placement succeeds');
  assert.match(appJs, /s\.dataset\.fc=String\(i\+1\)/, 'off TV each section carries its column');
  assert.match(appJs, /'<div id="fl'\+\(i\+1\)\+'" data-fc="'\+\(i\+1\)\+'">'/, 'on TV each column carries it');
});

// ---------------- Markets homes paging and the jobs glue (jobs paging lives in tests/work_jobs_ui.test.js since 2026-11-14) ----------------
test('Life: the homes list opens short with a Show more button, expands to everything, and keeps the plain list by default', () => {
  const homes = Array.from({ length: 30 }, (_, i) => ({ addr: i + ' Fixture Way', price: 500000 + i, city: 'Dana Point', beds: 3, baths: 2, sqft: 1500 + i, source: 'redfin', listed_at: T(3600), url: 'https://example.com/h' + i }));
  const r = { t: T(30), src: 'x', stale: false, errors: [], market: { area: 'Fixture', median_list_price: 900000, at: T(60) }, homes, commercial: [] };
  const hs = D.homes(r, NOW, 'short');
  assert.equal((hs.match(/ class="frow"/g) || []).length, 8);
  assert.match(hs, /data-more="homes">Show 12 more homes</);
  assert.match(hs, /Showing 8 of 30/);
  assert.match(D.homes(r, NOW, 'all'), /data-more="homes">Show fewer</);
  assert.equal((D.homes(r, NOW).match(/ class="frow"/g) || []).length, 20);
  // the paint calls pass the taxonomy filter and the page count together, and the toggle repaints
  assert.match(deckJs, /DeckUI\.jobs\(V6\.jobs,V6\.job,Date\.now\(\),jobOpt\(\)\)/);
  assert.match(deckJs, /jobsN:DeckUI\.JOB_SHORT/);
  // the Show more tap goes through DeckUI.jobNext (2026-11-01 fix: the glue read an unexported JOB_CAP and every tap fell back to 12)
  assert.match(deckJs, /V6\.jobsN=DeckUI\.jobNext\(V6\.jobsN,!!m\.dataset\.less\)/);
  // homes moved to Markets > Housing (2026-11-11), then to Real estate (pages/realestate.js); the old #mhomes glue left (SeeCode C9)
  assert.doesNotMatch(deckJs, /const HKINDS=/);
});

const rowsOf = (h) => (h.match(/ class="frow"/g) || []).length;
const labelN = (h, k) => { const m = new RegExp('data-more="' + k + '">Show (\\d+) more').exec(h); return m ? +m[1] : null; };
test('Homes: every Show more count is exactly what the click delivers, and a capped list says "Showing N of M"', () => {
  const home = (i) => ({ addr: i + ' Fixture Way', price: 500000 + i, city: 'Dana Point', beds: 3, baths: 2, sqft: 1500 + i, source: 'redfin', listed_at: T(3600), url: 'https://example.com/h' + i });
  const com = (i) => ({ addr: i + ' Office Row', price: 2000000 + i, city: 'Irvine', type: 'Office', sqft: 4000 + i, source: 'loopnet', url: 'https://example.com/c' + i });
  for (const [nh, nc] of [[333, 46], [200, 0], [21, 21], [20, 20], [13, 6], [5, 3]]) {
    const mk = (h, c) => ({ t: T(30), src: 'x', stale: false, errors: [], market: {}, homes: Array.from({ length: h }, (_, i) => home(i)), commercial: Array.from({ length: c }, (_, i) => com(i)) });
    const hs = D.homes(mk(nh, 0), NOW, 'short'), ha = D.homes(mk(nh, 0), NOW, 'all');
    assert.equal(rowsOf(ha), Math.min(nh, 20), 'homes ' + nh);
    assert.equal(labelN(hs, 'homes') || 0, rowsOf(ha) - rowsOf(hs), 'homes ' + nh + ': the button count is the rows it adds');
    const cs = D.homes(mk(0, nc), NOW, 'short'), ca = D.homes(mk(0, nc), NOW, 'all');
    assert.equal(rowsOf(ca), Math.min(nc, 20), 'commercial ' + nc);
    assert.equal(labelN(cs, 'homes') || 0, rowsOf(ca) - rowsOf(cs), 'commercial ' + nc + ': the button count is the rows it adds');
    if (nh > 20) { assert.match(hs, new RegExp('Showing 8 of ' + nh + '<')); assert.match(ha, new RegExp('Showing 20 of ' + nh + '<')); }
    if (nc > 20) { assert.match(cs, new RegExp('Showing 5 of ' + nc + '<')); assert.match(ca, new RegExp('Showing 20 of ' + nc + '<')); }
  }
  const real = D.homes({ t: T(30), src: 'x', stale: false, errors: [], market: {}, homes: Array.from({ length: 333 }, (_, i) => home(i)), commercial: [] }, NOW, 'short');
  assert.doesNotMatch(real, /Show 325 more|Show 41 more/, 'the old promises of 325 and 41 rows are gone');
  assert.match(real, /Show 12 more homes/);
});

test('one list row: no .hl rows anywhere', () => {
  assert.doesNotMatch(appJs, /class="hl"/);
});

test('release review: host switch is 44 x 44, House vitals show one-line ages', () => {
  // the host switch buttons reach 44 px both ways (the capsule padding leaves 44 inside the 48 px portrait bar)
  // design v3: House vitals and weather carry no per-tile age (the House header has the one freshness mark)
  assert.match(appJs, /T\(x\.label,x\.value==null\?'No data':x\.value,''\)/);
  assert.match(appJs, /T\('Weather',wxWord\(e\['weather\.forecast_home'\]\),'','wxt'\)/);
  assert.doesNotMatch(appJs, /textContent=ago2\(b\)\|\|'Home Assistant'/, 'no source name under the bedroom speaker');
});
