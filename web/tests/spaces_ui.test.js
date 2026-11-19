// Workspaces with their apps (owner feedback 2026-10-07, TestFlight build 11: "Need a place to switch workspaces and see apps").
// The helper answers GET /api/ws-list with window classes only; the deck shows them on every workspace button and marks the current one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('static/app.js'), html = require('./shell_legacy_css.js')();
const a = app.indexOf('// ==== SPACES UI HELPERS BEGIN'), b = app.indexOf('// ==== SPACES UI HELPERS END ====');
assert.ok(a >= 0 && b > a, 'spaces block markers moved');
const S = new Function(app.slice(a, b) + '\nreturn SpacesUI;')();

const LIST = (over) => Object.assign({
  ok: true, active: 2,
  ws: [
    { id: 1, n: 5, apps: ['Chromium', 'Ghostty', 'Firefox'], more: 1 },
    { id: 2, n: 1, apps: ['Spotify'], more: 0 },
    { id: 3, n: 0, apps: [], more: 0 },
    { id: 4, n: 2, apps: ['Obsidian'], more: 0 },
    { id: 5, n: 0, apps: [], more: 0 },
  ],
  other: { n: 1, apps: ['Game'], more: 0 },
}, over || {});

test('a good answer is read per workspace, with the current one and the rest', () => {
  const p = S.parse(LIST());
  assert.equal(p.ok, true);
  assert.equal(p.active, 2);
  assert.deepEqual(Object.keys(p.ws), ['1', '2', '3', '4', '5']);
  assert.deepEqual(p.ws[1], { n: 5, apps: ['Chromium', 'Ghostty', 'Firefox'], more: 1 });
  assert.deepEqual(p.other, { n: 1, apps: ['Game'], more: 0 });
});

test('anything off-shape is "not known", never a guess', () => {
  for (const j of [null, undefined, 3, 'x', [], {}, { ok: false, error: 'bad command' }, { ok: true }, { ok: true, ws: 'x' }, { error: 'Workspaces are not available.' }]) {
    const p = S.parse(j);
    assert.equal(p.ok, false, JSON.stringify(j));
    assert.equal(p.active, null);
    assert.deepEqual(p.ws, {});
  }
});

test('ids outside 1 to 5, non-integers and hostile app names are dropped', () => {
  const p = S.parse(LIST({
    active: 9,
    ws: [{ id: 0, n: 1, apps: ['X'] }, { id: 6, n: 1, apps: ['X'] }, { id: '1', n: 1, apps: ['X'] }, { id: 1.5, n: 1 },
      { id: 3, n: 400, apps: ['<img src=x>', 'Fine App', 'a'.repeat(40), 7, null, 'Two  Words', 'Chromium'], more: -4 }],
  }));
  assert.equal(p.active, null);
  assert.deepEqual(Object.keys(p.ws), ['3']);
  assert.equal(p.ws[3].n, 99);
  assert.deepEqual(p.ws[3].apps, ['Fine App', 'Two  Words', 'Chromium']);
  assert.equal(p.ws[3].more, 0);
});

test('the tile line: first app and the other windows, Empty for none, blank while unknown', () => {
  const p = S.parse(LIST());
  assert.equal(S.tile(p.ws[1]), 'Chromium +4');
  assert.equal(S.tile(p.ws[2]), 'Spotify');
  assert.equal(S.tile(p.ws[3]), 'Empty');
  assert.equal(S.tile(S.norm({ n: 2, apps: [] })), 'Window +1');
  assert.equal(S.tile(null), '');
});

test('the narrow form is a count, never a name: "5 open", Empty, blank while unknown', () => {
  const p = S.parse(LIST());
  assert.equal(S.short(p.ws[1]), '5 open');
  assert.equal(S.short(p.ws[2]), '1 open');
  assert.equal(S.short(p.ws[3]), 'Empty');
  assert.equal(S.short(null), '');
});

test('the full description names every app, the overflow and the current workspace', () => {
  const p = S.parse(LIST());
  assert.equal(S.full(1, p.ws[1], false), 'Workspace 1: Chromium, Ghostty, Firefox and 1 more');
  assert.equal(S.full(2, p.ws[2], true), 'Workspace 2: Spotify, current');
  assert.equal(S.full(3, p.ws[3], false), 'Workspace 3, empty');
  assert.equal(S.full(4, null, false), 'Workspace 4');
});

test('registration: the page asks ws-list and shows the answer on both button sets', () => {
  assert.match(app, /Promise\.all\(\[q\('media'\),q\('vol'\),q\('ws-now'\),q\('ws-list'\)\]\)/, 'q never throws: a failed ws-list is an {error} answer the parser reads as unknown');
  assert.match(app, /paintSpaces\(wl,w\.ws\)/);
  assert.match(app, /\$\$\('\[data-a=ws\],\[data-ws\]'\)/);
  assert.match(app, /if\(k\.action==='ws'\)b\.dataset\.ws=String\(k\.arg\)/);
  // the workspace row is one handler with data-n (a tap picks go or move); no button carries a fixed action.
  // The Spaces pip under each number is drawn by the key handler through data-ws, not by a fire-and-forget data-a.
  assert.equal((html.match(/id="wsrow"[^>]*>(?:<button type="button" class="b" data-n="\d">\d<\/button>){5}/g) || []).length, 1);
  assert.match(html, /@container \(max-width:72px\)\{\.ap \.af\{display:none\}\.ap \.ac\{display:inline\}\}/);
  assert.match(app, /<span class="ap"><span class="af"><\/span><span class="ac"><\/span><\/span>/);
  assert.match(html, /\.key\.on\{background:var\(--tint\)/);
});

test('keys.json: five workspace keys, Apps and Spaces open the shell plugins, nothing else changed in the first six', () => {
  const keys = JSON.parse(read('keys.json')).keys;
  assert.deepEqual(keys.filter((k) => k.action === 'ws').map((k) => k.arg), ['1', '2', '3', '4', '5']);
  assert.ok(keys.some((k) => k.action === 'launch' && k.arg === 'apps' && k.label === 'Apps'));
  assert.ok(keys.some((k) => k.action === 'launch' && k.arg === 'spaces' && k.label === 'Spaces'));
  assert.deepEqual(keys.slice(0, 6).map((k) => k.label), ['Terminal', 'Browser', 'Files', 'Hermes', 'Spotify', 'Obsidian']);
  assert.ok(keys.length <= 64, 'the server serves at most 64 keys (hosts::MAX_KEYS)');
});
