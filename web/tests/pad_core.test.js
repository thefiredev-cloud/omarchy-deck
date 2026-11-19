// node --test tests/  (pure pad logic; no DOM)
require('./setup-core.js');
const test = require('node:test');
const assert = require('node:assert');
const P = require('../static/pad.js');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('pointer acceleration: slow moves stay precise, fast moves go further', () => {
  assert.strictEqual(P.accel(0), 0);
  assert.ok(Math.abs(P.accel(1) - 1.2) < 0.25);
  assert.ok(P.accel(20) > 20 * 1.8);
  assert.strictEqual(P.accel(-20), -P.accel(20));
  assert.ok(P.accel(500) <= 500 * 4);
});

test('input diff turns field edits into backspaces and inserted text', () => {
  assert.deepStrictEqual(P.diff('  ', '  a'), { bs: 0, ins: 'a' });
  assert.deepStrictEqual(P.diff('  hel', '  hello'), { bs: 0, ins: 'lo' });
  assert.deepStrictEqual(P.diff('  teh', '  the '), { bs: 2, ins: 'he ' });
  assert.deepStrictEqual(P.diff('  ', ' '), { bs: 1, ins: '' });
  assert.deepStrictEqual(P.diff('  ab', '  ab'), { bs: 0, ins: '' });
});

test('shortcuts follow the target OS', () => {
  assert.deepStrictEqual(P.shortcut('copy', 'macos'), { k: 'c', mods: ['cmd'] });
  assert.deepStrictEqual(P.shortcut('copy', 'linux'), { k: 'c', mods: ['ctrl'] });
  assert.deepStrictEqual(P.shortcut('undo', 'macos'), { k: 'z', mods: ['cmd'] });
  assert.deepStrictEqual(P.shortcut('undo', 'linux'), { k: 'z', mods: ['ctrl'] });
  assert.deepStrictEqual(P.shortcut('launch', 'macos'), { k: 'space', mods: ['cmd'] });
  assert.strictEqual(P.shortcut('nope', 'macos'), null);
});

test('clipboard rule: Omarchy copy, paste and paste-plain are Ctrl, never Super', () => {
  assert.deepStrictEqual(P.shortcut('paste', 'linux'), { k: 'v', mods: ['ctrl'] });
  assert.deepStrictEqual(P.shortcut('cut', 'linux'), { k: 'x', mods: ['ctrl'] });
  assert.deepStrictEqual(P.shortcut('pasteplain', 'linux'), { k: 'v', mods: ['ctrl', 'shift'] });
  assert.deepStrictEqual(P.shortcut('copy', 'macos'), { k: 'c', mods: ['cmd'] });
  assert.strictEqual(P.blockedClipboard(['super'], 'c', 'pc-desktop'), true);
  assert.strictEqual(P.blockedClipboard(['cmd'], 'v', 'Dell'), true);
  assert.strictEqual(P.blockedClipboard(['super'], 'x', 'pc-desktop'), true);
  assert.strictEqual(P.blockedClipboard(['ctrl'], 'c', 'pc-desktop'), false);
  assert.strictEqual(P.blockedClipboard(['super', 'ctrl'], 'v', 'pc-desktop'), false);
  assert.strictEqual(P.blockedClipboard(['cmd'], 'c', 'mini'), false);
  const rows = P.shapeBinds([
    { modmask: 64, key: 'C', description: 'Copy', mouse: false, submap: '' },
    { modmask: 64, key: 'V', description: 'Paste', mouse: false, submap: '' },
    { modmask: 64, key: 'X', description: 'Cut', mouse: false, submap: '' },
    { modmask: 68, key: 'V', description: 'Clipboard history', mouse: false, submap: '' },
  ], true);
  assert.ok(!rows.some(b => b.key === 'c' && b.modifiers.join('+') === 'super'));
  assert.ok(!rows.some(b => b.key === 'v' && b.modifiers.join('+') === 'super'));
  assert.ok(!rows.some(b => b.key === 'x' && b.modifiers.join('+') === 'super'));
  const copy = rows.find(b => b.label === 'Copy');
  assert.deepStrictEqual(copy.modifiers, ['ctrl']);
  assert.strictEqual(copy.group, 'Clipboard');
  assert.strictEqual(copy.confirm, false);
  const plain = rows.find(b => b.label === 'Paste plain');
  assert.deepStrictEqual(plain.modifiers, ['ctrl', 'shift']);
  const hist = rows.find(b => b.label === 'Clipboard history');
  assert.deepStrictEqual(hist.modifiers, ['super', 'ctrl']);
  assert.strictEqual(hist.group, 'Clipboard');
  assert.ok(!('dispatcher' in hist) && !('arg' in hist));
});

test('keybind shaping groups Omarchy binds and gates dangerous ones', () => {
  const rows = P.shapeBinds([
    { modmask: 64, key: 'TAB', description: 'Next workspace', mouse: false, submap: '' },
    { modmask: 64, key: 'SPACE', description: 'Omarchy menu', mouse: false, submap: '' },
    { modmask: 64, key: 'RETURN', description: 'Terminal', mouse: false, submap: '' },
    { modmask: 0, key: 'F2', description: 'Fullscreen screenshot', mouse: false, submap: '' },
    { modmask: 0, key: 'XF86AudioPlay', description: 'Play', mouse: false, submap: '' },
    { modmask: 0, key: 'PRINT', description: 'Screenshot', mouse: false, submap: '' },
    { modmask: 68, key: 'P', description: 'Power', mouse: false, submap: '' },
    { modmask: 64, key: 'Q', description: 'Kill session', mouse: false, submap: '' },
    { modmask: 64, key: 'R', description: 'Reboot', mouse: false, submap: 'hidden' },
    { modmask: 0, key: 'mouse:274', description: 'Middle click paste', mouse: true, submap: '' },
    { modmask: 0, key: '', description: 'Switch to workspace 1', mouse: false, submap: '' },
    { modmask: 0, key: '1', description: 'G502 1 back thumb: Paste', mouse: false, submap: '' },
    { modmask: 2, key: 'A', description: 'Caps thing', mouse: false, submap: '' },
    { modmask: 64, key: 'W', description: 'Close window', mouse: false, submap: '' },
  ], true);
  const g = label => rows.find(b => b.label === label);
  assert.strictEqual(g('Next workspace').group, 'Workspaces');
  assert.strictEqual(g('Omarchy menu').group, 'Launchers/menus');
  assert.strictEqual(g('Terminal').group, 'Apps');
  assert.strictEqual(g('Fullscreen screenshot').group, 'Screenshots');
  assert.strictEqual(g('Play').group, 'Media');
  assert.strictEqual(g('Play').key, 'playpause');
  assert.strictEqual(g('Screenshot').key, 'print');
  assert.strictEqual(g('Power').confirm, true);
  assert.strictEqual(g('Power').group, 'System');
  assert.deepStrictEqual(g('Power').modifiers, ['super', 'ctrl']);
  assert.strictEqual(g('Kill session').confirm, true);
  assert.strictEqual(g('Close window').confirm, false);
  assert.strictEqual(g('Close window').group, 'Windows');
  assert.ok(!g('Reboot') && !g('Middle click paste') && !g('Caps thing'));
  assert.ok(!rows.some(b => String(b.key).startsWith('mouse')));
  for (const b of rows) {
    assert.deepStrictEqual(Object.keys(b).sort(), ['confirm', 'group', 'key', 'label', 'modifiers']);
    assert.ok(P.GROUPS.includes(b.group));
  }
});

test('storage migration keeps old pad keys and writes versioned favourites', () => {
  const store = { padlyr: 'edit', padt: 'Dell', 'pads:Dell': '2.4', 'pads:mini': '1', custom: 'keep' };
  const again = P.migrateStore(store);
  assert.strictEqual(store.padlyr, 'edit');
  assert.strictEqual(store.padt, 'Dell');
  assert.strictEqual(store['pads:Dell'], '2.4');
  assert.strictEqual(store['pads:mini'], '1');
  assert.strictEqual(store.custom, 'keep');
  assert.strictEqual(store['padmig:v1:Dell'], 'edit');
  assert.deepStrictEqual(P.readList(store, 'padfav:v1:Dell'), ['ctrl:c', 'ctrl:v', 'ctrl+shift:v']);
  assert.strictEqual(again.layer, 'edit');
  store['padfav:v1:Dell'] = JSON.stringify(['super:space']);
  P.migrateStore(store);
  assert.strictEqual(store.padlyr, 'edit');
  assert.deepStrictEqual(P.readList(store, 'padfav:v1:Dell'), ['super:space']);
  assert.deepStrictEqual(P.pinToggle(store, 'Dell', 'super:f4'), ['super:f4', 'super:space']);
  assert.deepStrictEqual(P.pinToggle(store, 'Dell', 'super:space'), ['super:f4']);
  assert.deepStrictEqual(P.pushRecent(store, 'Dell', 'alt:tab'), ['alt:tab']);
  assert.strictEqual(store.padlyr, 'edit');
  assert.strictEqual(store['pads:Dell'], '2.4');
  const mini = { padlyr: 'window', padt: 'mini' };
  P.migrateStore(mini);
  assert.strictEqual(mini.padlyr, 'window');
  assert.deepStrictEqual(P.readList(mini, 'padfav:v1:mini'), ['ctrl:up', 'cmd:tab', 'cmd:space']);
  const empty = { note: 'stay' };
  P.migrateStore(empty);
  assert.deepStrictEqual(empty, { note: 'stay' });
});

test('typed characters with a held modifier become key chords', () => {
  assert.deepStrictEqual(P.chord('c', ['cmd']), { op: 'key', k: 'c', mods: ['cmd'] });
  assert.deepStrictEqual(P.chord('C', ['ctrl']), { op: 'key', k: 'c', mods: ['ctrl', 'shift'] });
  assert.deepStrictEqual(P.chord(' ', ['cmd']), { op: 'key', k: 'space', mods: ['cmd'] });
  assert.deepStrictEqual(P.chord('hi', []), { op: 'text', s: 'hi' });
  assert.deepStrictEqual(P.chord('é', ['cmd']), { op: 'text', s: 'é' });
});

test('gesture classifier: tap, two-finger tap, drag', () => {
  assert.strictEqual(P.classify({ fingers: 1, ms: 120, dist: 3 }), 'tap');
  assert.strictEqual(P.classify({ fingers: 2, ms: 150, dist: 4 }), 'rtap');
  assert.strictEqual(P.classify({ fingers: 1, ms: 120, dist: 30 }), 'move');
  assert.strictEqual(P.classify({ fingers: 1, ms: 600, dist: 2 }), 'none');
  assert.strictEqual(P.classify({ fingers: 3, ms: 100, dist: 1 }), 'mtap');
});

test('pointer speed is remembered per target and clamped to the offered steps', () => {
  const store = {};
  assert.strictEqual(P.speedFor('mini', store), 1.6);
  assert.strictEqual(P.nextSpeed(1.6), 2.4);
  assert.strictEqual(P.nextSpeed(2.4), 1);
  assert.strictEqual(P.nextSpeed(1), 1.6);
  P.setSpeed('mini', 2.4, store);
  assert.strictEqual(P.speedFor('mini', store), 2.4);
  assert.strictEqual(P.speedFor('Dell', store), 1.6);
  store['pads:Dell'] = '99';
  assert.strictEqual(P.speedFor('Dell', store), 1.6);
});

test('diff counts emoji as one character and never splits a surrogate pair', () => {
  assert.deepStrictEqual(P.diff('  ab😀', '  ab'), { bs: 1, ins: '' });
  assert.deepStrictEqual(P.diff('  😀', '  😁'), { bs: 1, ins: '😁' });
  assert.deepStrictEqual(P.diff('hi', 'hi👍🏽x'), { bs: 0, ins: '👍🏽x' });
});

test('chunks text by code point so no chunk ends in a lone surrogate', () => {
  const s = 'x'.repeat(199) + '😀' + 'y';
  const parts = P.chunks(s, 200);
  assert.strictEqual(parts.join(''), s);
  for (const p of parts) assert.ok(!/[\ud800-\udbff]$/.test(p), 'lone high surrogate at end');
  assert.strictEqual(parts[0].length, 201);
});

test('second quick tap near the first becomes a double click', () => {
  const t = P.tapCount;
  assert.strictEqual(t(null, { t: 1000, x: 10, y: 10 }), 1);
  assert.strictEqual(t({ t: 1000, x: 10, y: 10, n: 1 }, { t: 1250, x: 14, y: 12 }), 2);
  assert.strictEqual(t({ t: 1000, x: 10, y: 10, n: 1 }, { t: 1400, x: 10, y: 10 }), 1);
  assert.strictEqual(t({ t: 1000, x: 10, y: 10, n: 1 }, { t: 1200, x: 60, y: 10 }), 1);
  assert.strictEqual(t({ t: 1000, x: 10, y: 10, n: 2 }, { t: 1200, x: 10, y: 10 }), 3);
});

// ---- the Rust allowlist and both agents are the source of truth for what the pad may send ----
const RUST = read('rust/src/pad.rs'), LINUX = read('agents/pad_linux.py'), MAC = read('agents/pad_mac.py');
const NAMED = new Set([...RUST.slice(RUST.indexOf('const NAMED'), RUST.indexOf('];', RUST.indexOf('const NAMED'))).matchAll(/"([a-z0-9]+)",/g)].map(m => m[1]));
const RUST_MODS = new Set([...RUST.match(/const MODS: \[&str; \d\] = \[([^\]]*)\]/)[1].matchAll(/"(\w+)"/g)].map(m => m[1]));
const HOLDABLE = new Set([...RUST.match(/pub const HOLDABLE: \[&str; \d\] = \[([^\]]*)\]/)[1].matchAll(/"(\w+)"/g)].map(m => m[1]));
const allowed = k => /^[a-z0-9]$/.test(k) || /^f([1-9]|1[0-2])$/.test(k) || NAMED.has(k);
const OSES = ['macos', 'linux'];
const byId = (page, os) => Object.fromEntries(P.page(page, os).map(b => [b.id, b]));
const chordOf = b => b.k + '+' + b.mods.join('+');

test('the Rust allowlist reads as expected (guards the cross-check below)', () => {
  assert.ok(NAMED.has('enter') && NAMED.has('ralt') && NAMED.has('pgdn') && NAMED.has('playpause') && NAMED.size >= 33, [...NAMED].join());
  assert.deepStrictEqual([...RUST_MODS].sort(), ['alt', 'cmd', 'ctrl', 'shift', 'super']);
  assert.deepStrictEqual([...HOLDABLE], ['ralt']);
});

test('three key pages: Keys, Function, Media', () => {
  assert.deepStrictEqual(P.PAGES, ['keys', 'fn', 'media']);
  assert.deepStrictEqual(P.PAGES.map(n => P.PAGE_LABEL[n]), ['Keys', 'Function', 'Media']);
  assert.strictEqual(P.nextPage('keys'), 'fn');
  assert.strictEqual(P.nextPage('media'), 'keys');
  assert.strictEqual(P.nextPage('bogus'), 'keys');
});

test('every key on every page is allowed by the server, mapped by both agents, and sits on the grid without overlap', () => {
  for (const os of OSES) for (const name of P.PAGES) {
    const keys = P.page(name, os), seen = new Set(), ids = new Set();
    assert.ok(keys.length >= 6, name);
    for (const b of keys) {
      assert.ok(!ids.has(b.id), 'duplicate id ' + b.id); ids.add(b.id);
      assert.match(b.label, /^[A-Z0-9\u2318]/, b.id + ' label ' + b.label);
      assert.ok(b.aria, b.id);
      assert.ok(b.c >= 1 && b.r >= 1 && b.c + b.w - 1 <= P.PAGE_COLS && b.r + b.h - 1 <= P.PAGE_ROWS, name + ' ' + b.id + ' off the grid');
      for (let c = b.c; c < b.c + b.w; c++) for (let r = b.r; r < b.r + b.h; r++) { const cell = c + ',' + r; assert.ok(!seen.has(cell), name + ' ' + b.id + ' overlaps at ' + cell); seen.add(cell) }
      if (b.kind === 'mod') { assert.ok(RUST_MODS.has(b.mod), b.id); assert.strictEqual(b.k, ''); continue }
      assert.ok(allowed(b.k), name + ' ' + os + ' ' + b.id + ' sends "' + b.k + '" which the server refuses');
      assert.ok(LINUX.includes('"' + b.k + '":'), 'linux agent has no ' + b.k);
      assert.ok(MAC.includes('"' + b.k + '":'), 'mac agent has no ' + b.k);
      for (const m of b.mods) assert.ok(RUST_MODS.has(m), b.id + ' mod ' + m);
      if (b.kind === 'hold') assert.ok(HOLDABLE.has(b.k), b.id + ' is held but the server will not hold it');
    }
  }
});

test('Keys page: arrows form an inverted T, Enter and Right Alt are labelled keys, modifiers and editing sit below', () => {
  for (const os of OSES) {
    const k = byId('keys', os);
    const up = k.up, down = k.down, left = k.left, right = k.right;
    assert.strictEqual(up.c, down.c);
    assert.strictEqual(down.r, up.r + 1);
    assert.strictEqual(left.r, down.r);
    assert.strictEqual(right.r, down.r);
    assert.strictEqual(left.c, down.c - 1);
    assert.strictEqual(right.c, down.c + 1);
    assert.deepStrictEqual([k.enter.label, k.enter.k, k.enter.kind, k.enter.w], ['Enter', 'enter', 'key', 3]);
    assert.deepStrictEqual([k.ralt.label, k.ralt.k, k.ralt.kind], ['Right Alt', 'ralt', 'hold']);
    assert.deepStrictEqual([k.alt.label, k.alt.kind, k.alt.mod], ['Alt', 'mod', 'alt']);
    assert.deepStrictEqual(['ctrl', 'shift', 'super'].map(i => k[i].mod), ['ctrl', 'shift', 'cmd']);
    for (const id of ['esc', 'tab', 'backspace']) assert.strictEqual(k[id].kind, 'key');
    assert.deepStrictEqual(['up', 'down', 'left', 'right', 'backspace'].filter(i => k[i].rep), ['up', 'down', 'left', 'right', 'backspace']);
  }
  assert.strictEqual(byId('keys', 'macos').super.label, '\u2318');
  assert.strictEqual(byId('keys', 'linux').super.label, 'Super');
  assert.strictEqual(P.modLabel('macos'), '\u2318');
  assert.strictEqual(P.modLabel('linux'), 'Super');
});

test('Right Alt is a different key from Alt: a held key named ralt, while Alt is a modifier that goes in mods', () => {
  for (const os of OSES) {
    const k = byId('keys', os);
    assert.notStrictEqual(k.ralt.k, k.alt.mod);
    assert.deepStrictEqual(k.ralt.mods, []);
    assert.strictEqual(k.alt.k, '');
  }
  // evdev: KEY_RIGHTALT 100 vs KEY_LEFTALT 56; macOS: right Option 61 vs left Option 58
  assert.match(LINUX, /"ralt": 100/); assert.match(LINUX, /"alt": 56/);
  assert.match(MAC, /"ralt": 61/); assert.match(MAC, /"alt": 58/);
});

test('Keys page editing row: Copy, Paste, Cut, Undo, Redo, Select all per OS', () => {
  const lin = byId('keys', 'linux'), mac = byId('keys', 'macos');
  assert.deepStrictEqual(['copy', 'paste', 'cut', 'undo', 'redo', 'selall'].map(i => chordOf(lin[i])), ['c+ctrl', 'v+ctrl', 'x+ctrl', 'z+ctrl', 'z+ctrl+shift', 'a+ctrl']);
  assert.deepStrictEqual(['copy', 'paste', 'cut', 'undo', 'redo', 'selall'].map(i => chordOf(mac[i])), ['c+cmd', 'v+cmd', 'x+cmd', 'z+cmd', 'z+cmd+shift', 'a+cmd']);
  // the named shortcuts and the keys agree
  for (const [id, name] of [['copy', 'copy'], ['paste', 'paste'], ['cut', 'cut'], ['undo', 'undo']]) for (const os of OSES) {
    const s = P.shortcut(name, os), b = byId('keys', os)[id];
    assert.deepStrictEqual([b.k, b.mods], [s.k, s.mods], id + ' ' + os);
  }
});

test('Function page: F1 to F12, Home, End, PgUp, PgDn, Del, and the common combos', () => {
  for (const os of OSES) {
    const f = byId('fn', os);
    assert.deepStrictEqual(Array.from({ length: 12 }, (_, i) => f['f' + (i + 1)].k), Array.from({ length: 12 }, (_, i) => 'f' + (i + 1)));
    assert.deepStrictEqual(['home', 'end', 'pgup', 'pgdn', 'delete'].map(i => f[i].k), ['home', 'end', 'pgup', 'pgdn', 'delete']);
    assert.deepStrictEqual(['home', 'end', 'pgup', 'pgdn', 'delete'].map(i => f[i].label), ['Home', 'End', 'PgUp', 'PgDn', 'Del']);
    assert.deepStrictEqual(['pgup', 'pgdn', 'delete'].filter(i => f[i].rep), ['pgup', 'pgdn', 'delete']);
    assert.strictEqual(chordOf(f.menu), 'space+cmd'); // Super+Space launcher, Cmd+Space Spotlight
    assert.strictEqual(chordOf(f.close), 'w+cmd'); // Super+W close
    assert.strictEqual(chordOf(f.switch), os === 'macos' ? 'tab+cmd' : 'tab+alt');
    assert.strictEqual(chordOf(f.overview), os === 'macos' ? 'up+ctrl' : 'f4+cmd');
  }
  assert.strictEqual(chordOf(byId('fn', 'linux').termpaste), 'v+ctrl+shift'); // Ctrl+Shift+V paste in a terminal
  assert.strictEqual(chordOf(byId('fn', 'macos').termpaste), 'v+cmd+shift');
  assert.deepStrictEqual(['menu', 'close', 'termpaste', 'switch', 'overview'].map(i => byId('fn', 'linux')[i].label), ['Menu', 'Close', 'Term paste', 'Switch', 'Overview']);
});

test('Media page: play/pause, previous, next, volume and mute', () => {
  for (const os of OSES) {
    const m = byId('media', os);
    assert.deepStrictEqual(['voldown', 'mute', 'volup', 'prev', 'playpause', 'next'].map(i => m[i].k), ['voldown', 'mute', 'volup', 'prev', 'playpause', 'next']);
    assert.deepStrictEqual([m.volup.rep, m.voldown.rep, m.playpause.rep], [true, true, false]);
    for (const b of Object.values(m)) assert.deepStrictEqual([b.mods, b.kind, b.w, b.h], [[], 'key', 2, 2]);
  }
});

test('haptics: modifiers tick as a selection, every other key is a light tap', () => {
  const k = byId('keys', 'linux');
  assert.strictEqual(P.keyHaptic(k.ctrl), 'selection');
  assert.strictEqual(P.keyHaptic(k.enter), 'light');
  assert.strictEqual(P.keyHaptic(k.ralt), 'light');
  assert.strictEqual(P.PRESS_MS, 90);
});

test('modifiers latch: tap = next key only, a quick second tap = locked, any other tap = off', () => {
  assert.strictEqual(P.modTap(undefined, 9999), 'once');
  assert.strictEqual(P.modTap(null, 0), 'once');
  assert.strictEqual(P.modTap('once', P.LOCK_MS - 1), 'lock');
  assert.strictEqual(P.modTap('once', P.LOCK_MS), null);
  assert.strictEqual(P.modTap('lock', 10), null);
  assert.strictEqual(P.modTap('lock', 9999), null);
});

function fakeTimers() {
  let now = 0, id = 0; const q = new Map();
  return {
    set(f, ms) { id++; q.set(id, { f, at: now + ms }); return id },
    clear(i) { q.delete(i) },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let best = null;
        for (const [i, t] of q) if (t.at <= end && (!best || t.at < best[1].at)) best = [i, t];
        if (!best) break;
        q.delete(best[0]); now = best[1].at; best[1].f();
      }
      now = end;
    },
    pending: () => q.size,
    now: () => now,
  };
}

test('hold-to-talk: Right Alt goes down at once and stays down until the finger lifts', () => {
  const T = fakeTimers(), log = [];
  const h = P.holdKey({ set: T.set, clear: T.clear, lit: on => log.push('lit:' + on), down: () => log.push('down'), up: () => log.push('up'), engaged: () => log.push('engaged') });
  assert.strictEqual(h.press(), true);
  assert.deepStrictEqual(log, ['lit:true', 'down']);
  assert.strictEqual(h.press(), false); // a second finger on the same key does nothing
  T.advance(P.HOLD_MS - 1);
  assert.deepStrictEqual(log, ['lit:true', 'down']);
  T.advance(1);
  assert.deepStrictEqual(log, ['lit:true', 'down', 'engaged']); // the hold is felt
  T.advance(60000); // still down a minute later: hold mode records as long as you talk
  assert.strictEqual(h.state(), 'down');
  assert.deepStrictEqual(log, ['lit:true', 'down', 'engaged']);
  h.release();
  assert.deepStrictEqual(log, ['lit:true', 'down', 'engaged', 'lit:false', 'up']);
  h.release(); // releasing twice never sends a second up
  assert.strictEqual(log.filter(x => x === 'up').length, 1);
  assert.strictEqual(T.pending(), 0);
});

test('outbox: the first tap goes out at once, the rest 40 ms apart (25 a second), in order, never more than the server takes', () => {
  const T = fakeTimers(), sent = [];
  const ob = P.outbox({ now: T.now, set: T.set, clear: T.clear, send: o => { sent.push([T.now(), o]); return true } });
  assert.strictEqual(P.PACE_MS, 40);
  ob.push({ op: 'key', k: 'a', mods: [] });
  assert.strictEqual(sent.length, 1); // after a quiet moment: at once
  for (let i = 0; i < 299; i++) ob.push(i % 50 === 49 ? { op: 'text', s: 't' + i } : { op: 'key', k: 'backspace', mods: [] });
  assert.strictEqual(sent.length, 1);
  T.advance(39); assert.strictEqual(sent.length, 1);
  T.advance(1); assert.strictEqual(sent.length, 2);
  T.advance(60000);
  assert.strictEqual(sent.length, 300);
  assert.strictEqual(ob.size(), 0);
  assert.strictEqual(T.pending(), 0);
  // order is the push order
  assert.deepStrictEqual(sent.slice(1).map(([, o]) => (o.op === 'text' ? o.s : o.k)).slice(0, 3), ['backspace', 'backspace', 'backspace']);
  assert.strictEqual(sent.filter(([, o]) => o.op === 'text').length, 5);
  assert.strictEqual(sent[50][1].s, 't49');
  // any one-second window holds at most 25 sends
  let worst = 0;
  for (let i = 0; i < sent.length; i++) worst = Math.max(worst, sent.filter(([t]) => t >= sent[i][0] && t < sent[i][0] + 1000).length);
  assert.ok(worst <= 25, 'worst window ' + worst);
});

test('outbox: there is no resend path any more (the server queues and keeps the order itself)', () => {
  const T = fakeTimers(), sent = [];
  const ob = P.outbox({ now: T.now, set: T.set, clear: T.clear, send: o => { sent.push(o); return true } });
  assert.deepStrictEqual(Object.keys(ob).sort(), ['clear', 'push', 'size']);
  assert.strictEqual(P.RETRY_MAX, undefined);
  // a long, stalled-then-bursty typing session: what goes in comes out once, in order, nothing doubled
  const ops = Array.from({ length: 150 }, (_, i) => (i % 9 === 4 ? { op: 'text', s: 't' + i } : { op: 'key', k: String.fromCharCode(97 + (i % 26)), mods: [] }));
  for (const o of ops.slice(0, 50)) { ob.push(o); T.advance(10) }
  T.advance(700); // the stall
  for (const o of ops.slice(50)) ob.push(o); // the burst
  T.advance(60000);
  assert.deepStrictEqual(sent, ops);
  assert.strictEqual(ob.size(), 0);
  assert.strictEqual(T.pending(), 0);
});

test('the page says so when the server turned typing away, and never tries to resend it', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../static/pad.js'), 'utf8');
  assert.match(src, /else if \(m\.lost\) status\('warn', 'Some typing did not go through\. Try again\.'\)/);
  assert.doesNotMatch(src, /m\.dropped|droppedMany|RETRY_MAX|unshift/);
});

test('outbox: a closed connection empties the queue, clear() stops the timers, the queue is bounded', () => {
  const T = fakeTimers(); let open = true; const sent = [];
  const ob = P.outbox({ now: T.now, set: T.set, clear: T.clear, send: o => { if (!open) return false; sent.push(o); return true } });
  for (let i = 0; i < 5; i++) ob.push({ op: 'key', k: 'a', mods: [] });
  open = false; T.advance(100);
  assert.strictEqual(ob.size(), 0);
  assert.strictEqual(T.pending(), 0);
  open = true;
  for (let i = 0; i < 5; i++) ob.push({ op: 'key', k: 'b', mods: [] });
  ob.clear(); assert.strictEqual(ob.size(), 0); assert.strictEqual(T.pending(), 0);
  const lost = [];
  const big = P.outbox({ now: T.now, set: T.set, clear: T.clear, send: () => true, lost: o => lost.push(o) });
  for (let i = 0; i < P.QUEUE_MAX + 50; i++) big.push({ op: 'key', k: 'a', mods: [] });
  assert.ok(lost.length >= 49 && lost.length <= 51);
  big.clear();
});

test('a refused command says why: a Super shortcut outside the allowed keys names the allowed ones', () => {
  const s = P.rejectCopy('bad combo');
  assert.match(s, /^Not sent\./);
  assert.match(s, /Super works with C, V, X, Z, A, W, F, Space, Tab, Enter, the arrows and digits/);
  assert.doesNotMatch(s, /Rejected/);
  assert.match(P.rejectCopy('bad key'), /^Not sent: /);
  assert.match(P.rejectCopy('something odd'), /^Not sent: something odd$/);
  assert.ok(P.rejectCopy('x'.repeat(500)).length < 100);
});

test('the page and the server agree on the Super keys', () => {
  const rs = require('node:fs').readFileSync(require('node:path').join(__dirname, '../rust/src/pad.rs'), 'utf8');
  const body = /pub const SUPER_KEYS: \[&str; (\d+)\] = \[([^\]]*)\];/.exec(rs);
  assert.ok(body, 'SUPER_KEYS not found in pad.rs');
  const rust = body[2].split(',').map(x => x.trim().replace(/"/g, '')).filter(Boolean);
  assert.strictEqual(Number(body[1]), rust.length);
  assert.deepStrictEqual([...P.SUPER_KEYS].sort(), rust.sort());
});

test('a quick tap on Right Alt is one down and one up, with no hold cue (toggle mode)', () => {
  const T = fakeTimers(), log = [];
  const h = P.holdKey({ set: T.set, clear: T.clear, lit: () => {}, down: () => log.push('down'), up: () => log.push('up'), engaged: () => log.push('engaged') });
  h.press(); T.advance(80); h.release(); T.advance(10000);
  assert.deepStrictEqual(log, ['down', 'up']);
  h.press(); h.release();
  assert.deepStrictEqual(log, ['down', 'up', 'down', 'up']); // and it can be tapped again at once
});

test('a lost pointerup never leaves Right Alt down: the watchdog lets go', () => {
  const T = fakeTimers(), log = [];
  const h = P.holdKey({ set: T.set, clear: T.clear, lit: on => log.push('lit:' + on), down: () => log.push('down'), up: () => log.push('up') });
  h.press();
  T.advance(P.HOLD_MAX_MS - 1);
  assert.strictEqual(h.state(), 'down');
  T.advance(1);
  assert.strictEqual(h.state(), 'idle');
  assert.deepStrictEqual(log, ['lit:true', 'down', 'lit:false', 'up']);
  h.release();
  assert.strictEqual(log.filter(x => x === 'up').length, 1);
});

test('two fingers on Right Alt are one key: it goes up only when the last finger lifts', () => {
  const T = fakeTimers(), log = [];
  const h = P.holdKey({ set: T.set, clear: T.clear, lit: on => log.push('lit:' + on), down: () => log.push('down'), up: () => log.push('up') });
  assert.strictEqual(h.press(7), true);
  assert.strictEqual(h.press(9), false); // the second finger joins the same key: no second down
  h.release(7);
  assert.strictEqual(h.state(), 'down'); // one finger is still on it
  assert.deepStrictEqual(log, ['lit:true', 'down']);
  h.release(9);
  assert.strictEqual(h.state(), 'idle');
  assert.deepStrictEqual(log, ['lit:true', 'down', 'lit:false', 'up']);
  h.release(9); h.release(7); // late or repeated lifts never send a second up
  assert.strictEqual(log.filter(x => x === 'up').length, 1);
  assert.strictEqual(T.pending(), 0);
  // the second finger lifting first changes nothing
  h.press(1); h.press(2); h.release(2); assert.strictEqual(h.state(), 'down'); h.release(1); assert.strictEqual(h.state(), 'idle');
  // lifting a finger that never pressed is ignored; a forced release (page switch, blur) lets go whoever is still down
  h.press(3); h.release(99); assert.strictEqual(h.state(), 'down');
  h.press(4); h.release(); assert.strictEqual(h.state(), 'idle');
  // after a forced release a late lift does not touch the next press
  h.press(5); h.release(3); assert.strictEqual(h.state(), 'down'); h.release(5); assert.strictEqual(h.state(), 'idle');
  assert.strictEqual(log.filter(x => x === 'down').length, log.filter(x => x === 'up').length);
});

test('the watchdog forgets every finger on Right Alt', () => {
  const T = fakeTimers(), log = [];
  const h = P.holdKey({ set: T.set, clear: T.clear, lit: () => {}, down: () => log.push('down'), up: () => log.push('up') });
  h.press(1); h.press(2);
  T.advance(P.HOLD_MAX_MS);
  assert.deepStrictEqual(log, ['down', 'up']);
  h.release(1); h.release(2);
  assert.deepStrictEqual(log, ['down', 'up']);
  h.press(3); assert.strictEqual(h.state(), 'down'); // a fresh press works after the watchdog
  h.release(3); assert.deepStrictEqual(log, ['down', 'up', 'down', 'up']);
});

test('Right Alt is a tap to dictate: spoken as such, one key that goes down on the press', () => {
  const d = P.page('keys', 'linux').find(k => k.id === 'ralt');
  assert.strictEqual(d.label, 'Right Alt');
  assert.strictEqual(d.aria, 'Right Alt, tap to dictate');
  assert.doesNotMatch(d.aria, /hold/i);
  assert.strictEqual(d.kind, 'hold');
  assert.strictEqual(d.k, 'ralt');
  assert.strictEqual(P.page('keys', 'macos').find(k => k.id === 'ralt').aria, 'Right Alt, tap to dictate');
});

test('held keys repeat: once at once, then every 70 ms after 420 ms, and stop on release or at the cap', () => {
  const T = fakeTimers();
  let n = 0;
  const r = P.repeater({ set: T.set, clear: T.clear, fire: () => { n++ } });
  assert.strictEqual(r.press(), true);
  assert.strictEqual(n, 1);
  assert.strictEqual(r.press(), false);
  T.advance(P.REPEAT_DELAY_MS - 1); assert.strictEqual(n, 1);
  T.advance(1); assert.strictEqual(n, 2);
  T.advance(P.REPEAT_MS * 3); assert.strictEqual(n, 5);
  r.release();
  T.advance(5000); assert.strictEqual(n, 5);
  assert.strictEqual(T.pending(), 0);
  assert.strictEqual(r.active(), false);
  // a finger that never lifts cannot run away
  n = 0; r.press(); T.advance(10 * 60 * 1000);
  assert.ok(n <= P.REPEAT_MAX + 1, 'ran ' + n);
  assert.strictEqual(r.active(), false);
});

test('pad labels share one letter case: capitalised words or symbols, never shouting or lowercase', () => {
  for (const [k, v] of Object.entries(P.LABEL)) assert.match(v, /^[A-Z][a-z]*$|^PC$/, k + ' -> ' + v);
  for (const os of OSES) for (const n of P.PAGES) for (const b of P.page(n, os)) {
    if (/^F\d+$/.test(b.label) || b.label === '\u2318') continue;
    assert.doesNotMatch(b.label, /^[A-Z]{2,}$/, b.id + ' ' + b.label);
    assert.doesNotMatch(b.label, /^[a-z]/, b.id + ' ' + b.label);
  }
});

test('the trackpad hint is short and quiet', () => {
  assert.ok(P.HINT.length <= 80, P.HINT.length + ' chars');
  assert.doesNotMatch(P.HINT, /[A-Z]{3,}/);
});

test('a connect that gets no answer gives up after 8 s, says so, and offers Try again (S13: the deck\'s one retry word); connecting never shows it', () => {
  assert.strictEqual(P.CONNECT_MS, 8000);
  const c = P.connectCopy('connecting', 'Mini');
  assert.deepStrictEqual([c.state, c.title, c.retry], ['connecting', 'Connecting to Mini', false]);
  const t = P.connectCopy('timeout', 'Mini', '', 0.8);
  assert.deepStrictEqual([t.state, t.retry, t.label], ['failed', true, 'Try again']);
  assert.match(t.title, /Mini is not responding/);
  assert.match(t.line, /No answer after 8 s\. Trying again in 1 s\./);
  const d = P.connectCopy('closed', 'Dell', 'Connection closed', 4);
  assert.strictEqual(d.line, 'Connection closed. Trying again in 4 s.');
  assert.strictEqual(d.label, 'Try again');
  const i = P.connectCopy('idle', 'Mini');
  assert.deepStrictEqual([i.state, i.retry, i.label], ['idle', true, 'Connect']);
  for (const x of [c, t, d, i]) assert.doesNotMatch(x.title + ' ' + x.line, /websocket|ws:|HTTP|\/pad/i);
  // after a failure the next attempt keeps Try again on screen instead of hiding it for the whole wait
  const again = P.connectCopy('connecting', 'Mini', '', 0, 2);
  assert.deepStrictEqual([again.state, again.retry, again.label, again.line], ['connecting', true, 'Try again', 'Still trying. The last attempt failed.']);
  for (const x of [c, t, d, i, again]) assert.doesNotMatch(x.label, /Retry/);
});
