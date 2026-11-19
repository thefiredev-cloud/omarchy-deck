// Pixel Deck trackpad + keyboard page. One WebSocket (/pad?target=) per visible session.
// The pure core (accel, diff, shortcut, chord, classify, page, modTap, holdKey, repeater) is unit tested:
//   node --test tests/*.test.js
(function () {
  'use strict';
  // ---------- pure core ----------
  // Gain is a function of how fast the finger is moving, not of one event's size: a 1 px nudge stays 1:1
  // (precision) and a flick ramps up to 4x with no jump at the cap. accel(d) is the stateless form.
  const ACCEL_K = 0.055, ACCEL_MAX = 4, ACCEL_SMOOTH = 0.72;
  function gainFor(v) {
    const s = Math.max(0, Math.abs(+v) || 0);
    return Math.min(ACCEL_MAX, 1 + ACCEL_K * Math.pow(s, 0.95));
  }
  function accel(d) {
    if (!d) return 0;
    return d * gainFor(d);
  }
  // One event: mix the delta with a decayed speed estimate (vEma) so a flick accelerates over two or three
  // events and a slow nudge is not multiplied by the speed of the stroke before it. Returns the moved
  // distance and the new estimate, so the next event can reuse it.
  function accelStep(d, vEma) {
    const a = Math.abs(+d) || 0, v = ACCEL_SMOOTH * (Math.abs(+vEma) || 0) + (1 - ACCEL_SMOOTH) * a;
    return { d: (d || 0) * gainFor(0.5 * a + 0.5 * v), v };
  }
  // Diff by code point so an emoji is one backspace and never half a surrogate pair.
  function diff(prev, next) {
    const a = Array.from(prev), b = Array.from(next);
    let i = 0;
    const n = Math.min(a.length, b.length);
    while (i < n && a[i] === b[i]) i++;
    return { bs: a.length - i, ins: b.slice(i).join('') };
  }
  function chunks(s, max) {
    const cp = Array.from(s), out = [];
    for (let i = 0; i < cp.length; i += max) out.push(cp.slice(i, i + max).join(''));
    return out;
  }
  // Click count for a tap: a second tap within 300 ms and 12 px counts up (double, triple click).
  const MULTI_MS = 300, MULTI_PX = 12;
  function tapCount(last, now) {
    if (!last || now.t - last.t > MULTI_MS || Math.hypot(now.x - last.x, now.y - last.y) > MULTI_PX) return 1;
    return Math.min(3, last.n + 1);
  }
  // Owner rule: Omarchy clipboard chords are Ctrl only (Ctrl+C, Ctrl+V, Ctrl+Shift+V).
  // Super+C / Super+V / Super+X must not exist. cmd is Super on the Linux agent, so a
  // cmd-only C/V/X chord is the same forbidden bind. Mac clipboard stays Cmd.
  // Undo stays Ctrl+Z on Linux apps.
  const SC = {
    copy: { macos: ['c', ['cmd']], linux: ['c', ['ctrl']] },
    paste: { macos: ['v', ['cmd']], linux: ['v', ['ctrl']] },
    cut: { macos: ['x', ['cmd']], linux: ['x', ['ctrl']] },
    pasteplain: { macos: ['v', ['cmd', 'shift']], linux: ['v', ['ctrl', 'shift']] },
    undo: { macos: ['z', ['cmd']], linux: ['z', ['ctrl']] },
    launch: { macos: ['space', ['cmd']], linux: ['space', ['cmd']] },
  };
  function shortcut(name, os) {
    const s = SC[name];
    if (!s) return null;
    const linux = os !== 'macos';
    const [k, mods] = s[linux ? 'linux' : 'macos'];
    const out = { k, mods: mods.slice() };
    if (linux && blockedClipboard(out.mods, out.k)) return null;
    return out;
  }
  const GROUPS = ['Workspaces', 'Windows', 'Apps', 'Launchers/menus', 'System', 'Media', 'Screenshots', 'Clipboard', 'Other'];
  const KNOWN_MASK = 1 | 4 | 8 | 64;
  function linuxTarget(t) { return t === 'pc-desktop' || t === 'Dell' }
  function blockedClipboard(mods, key, target) {
    const linux = target == null ? true : linuxTarget(target);
    if (!linux) return false;
    const only = mods.length === 1 && (mods[0] === 'super' || mods[0] === 'cmd');
    return only && (key === 'c' || key === 'v' || key === 'x');
  }
  function hasWord(hay, word) {
    return hay.split(/[^a-z0-9]+/).includes(word);
  }
  function isDangerous(label, rawKey) {
    const s = String(label || '').toLowerCase();
    const k = String(rawKey || '').toLowerCase();
    return k === 'xf86poweroff' || hasWord(s, 'reboot') || hasWord(s, 'logout') || hasWord(s, 'shutdown')
      || hasWord(s, 'poweroff') || hasWord(s, 'kill') || hasWord(s, 'power')
      || s.includes('log out') || s.includes('shut down') || s.includes('power off');
  }
  function groupOf(label) {
    const s = String(label || '').toLowerCase();
    const has = w => s.includes(w);
    if (has('screenshot') || has('screen record') || has('screenrecord') || has('ocr') || has('color picker') || has('capture')) return 'Screenshots';
    if (has('clipboard') || has('copy') || has('paste') || hasWord(s, 'cut')) return 'Clipboard';
    if (has('volume') || has('mute') || has('brightness') || has('track') || has('pause') || has('music') || has('spotify') || has('media') || has('microphone') || has('audio') || hasWord(s, 'play')) return 'Media';
    if (has('workspace') || has('spaceview') || has('overview')) return 'Workspaces';
    if (has('window') || has('focus') || has('split') || has('float') || has('full screen') || has('fullscreen') || has('scratchpad') || has('monitor') || has('gap') || has('transparency') || has('tiling') || has('swap') || has('grouping') || has('group')) return 'Windows';
    if (has('menu') || has('launcher') || has('app grid') || has('spotlight') || has('switcher')) return 'Launchers/menus';
    if (has('lock') || has('idle') || has('theme') || has('wallpaper') || has('notification') || has('dictation') || has('voxtype') || has('voice') || has('game mode') || has('scale') || has('backlight') || has('touchpad') || has('night')) return 'System';
    if (has('terminal') || has('browser') || has('email') || has('calculator') || has('herdr') || has('tmux') || has('whatsapp') || has('obsidian') || has('calendar') || has('photo') || has('atlas') || has('mail') || s === 'x' || s === 'x post') return 'Apps';
    return 'Other';
  }
  function mapKey(raw) {
    const named = {
      RETURN: 'enter', return: 'enter', Return: 'enter', ESCAPE: 'esc', ESC: 'esc', escape: 'esc', Escape: 'esc',
      TAB: 'tab', tab: 'tab', Tab: 'tab', SPACE: 'space', space: 'space', Space: 'space',
      BACKSPACE: 'backspace', backspace: 'backspace', BackSpace: 'backspace', DELETE: 'delete', Delete: 'delete', delete: 'delete',
      HOME: 'home', Home: 'home', home: 'home', END: 'end', End: 'end', end: 'end',
      PRIOR: 'pgup', PGUP: 'pgup', Page_Up: 'pgup', pgup: 'pgup', NEXT: 'pgdn', PGDN: 'pgdn', Page_Down: 'pgdn', pgdn: 'pgdn',
      LEFT: 'left', left: 'left', Left: 'left', RIGHT: 'right', right: 'right', Right: 'right', UP: 'up', up: 'up', Up: 'up', DOWN: 'down', down: 'down', Down: 'down',
      PERIOD: 'period', period: 'period', Period: 'period', COMMA: 'comma', comma: 'comma', Comma: 'comma',
      SLASH: 'slash', slash: 'slash', Slash: 'slash', MINUS: 'minus', minus: 'minus', Minus: 'minus',
      EQUAL: 'equal', equal: 'equal', Equal: 'equal', GRAVE: 'grave', grave: 'grave', Grave: 'grave',
      BRACKETLEFT: 'lbracket', bracketleft: 'lbracket', BRACKETRIGHT: 'rbracket', bracketright: 'rbracket',
      BACKSLASH: 'backslash', backslash: 'backslash', SEMICOLON: 'semicolon', semicolon: 'semicolon',
      APOSTROPHE: 'quote', apostrophe: 'quote', PRINT: 'print', Print: 'print', SYSRQ: 'print', print: 'print',
      XF86AudioRaiseVolume: 'volup', XF86AudioLowerVolume: 'voldown', XF86AudioMute: 'mute',
      XF86AudioPlay: 'playpause', XF86AudioPause: 'playpause', XF86AudioNext: 'next', XF86AudioPrev: 'prev',
    };
    if (named[raw]) return named[raw];
    if (/^[Ff]([1-9]|1[0-2])$/.test(raw)) return 'f' + String(Number(raw.slice(1)));
    if (raw.length === 1 && /[a-z0-9]/i.test(raw)) return raw.toLowerCase();
    return null;
  }
  function cleanLabel(s) {
    let out = '';
    for (const ch of String(s || '')) {
      if (ch.charCodeAt(0) < 32) continue;
      if (ch === ' ' && out.endsWith(' ')) continue;
      out += ch;
      if ([...out].length >= 80) break;
    }
    return out.trim();
  }
  function bindRow(label, modifiers, key, group, confirm) {
    return { label, modifiers: modifiers.slice(), key, group, confirm: !!confirm };
  }
  function bindId(b) {
    return (b.modifiers.length ? b.modifiers.join('+') + ':' : '') + b.key;
  }
  function clipboardRows() {
    return [
      bindRow('Copy', ['ctrl'], 'c', 'Clipboard', false),
      bindRow('Paste', ['ctrl'], 'v', 'Clipboard', false),
      bindRow('Paste plain', ['ctrl', 'shift'], 'v', 'Clipboard', false),
    ];
  }
  function shapeOne(b, linux) {
    if (!b || b.mouse === true || b.release === true || b.longPress === true) return null;
    if (b.submap) return null;
    const rawKey = b.key || '';
    if (!rawKey || rawKey.startsWith('mouse') || rawKey.startsWith('switch:')) return null;
    const desc = b.description || '';
    if (String(desc).toLowerCase().includes('g502')) return null;
    const mask = b.modmask >>> 0;
    if (mask & ~KNOWN_MASK) return null;
    const mods = [];
    if (mask & 64) mods.push('super');
    if (mask & 4) mods.push('ctrl');
    if (mask & 8) mods.push('alt');
    if (mask & 1) mods.push('shift');
    const key = mapKey(rawKey);
    if (!key) return null;
    if (linux && blockedClipboard(mods, key)) return null;
    const dangerous = isDangerous(desc, rawKey);
    let label = cleanLabel(desc);
    if (!label) {
      if (dangerous) return null;
      label = mods.concat(key).join('+');
    }
    if (dangerous && !isDangerous(label, '')) return null;
    const group = dangerous ? 'System' : groupOf(label);
    return bindRow(label, mods, key, group, dangerous);
  }
  function shapeBinds(raw, linux) {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [], seen = new Set();
    for (const b of arr) {
      const row = shapeOne(b, linux !== false);
      if (!row) continue;
      const id = bindId(row);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(row);
      if (out.length >= 400) break;
    }
    if (linux !== false) {
      for (const c of clipboardRows()) {
        const id = bindId(c);
        if (!seen.has(id)) { seen.add(id); out.push(c) }
      }
    }
    const gi = g => { const i = GROUPS.indexOf(g); return i < 0 ? GROUPS.length : i };
    out.sort((a, b) => gi(a.group) - gi(b.group) || a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    return out;
  }
  function macBinds() {
    const r = (label, mods, key, group, confirm) => bindRow(label, mods, key, group, confirm);
    return [
      r('Mission Control', ['ctrl'], 'up', 'Workspaces', false),
      r('Next space', ['ctrl'], 'right', 'Workspaces', false),
      r('Previous space', ['ctrl'], 'left', 'Workspaces', false),
      r('Close window', ['cmd'], 'w', 'Windows', false),
      r('Switch window', ['cmd'], 'tab', 'Windows', false),
      r('Hide window', ['cmd'], 'h', 'Windows', false),
      r('Minimize', ['cmd'], 'm', 'Windows', false),
      r('Cycle windows', ['cmd'], 'grave', 'Windows', false),
      r('Spotlight', ['cmd'], 'space', 'Launchers/menus', false),
      r('Lock screen', ['ctrl', 'cmd'], 'q', 'System', false),
      r('Log out', ['cmd', 'shift'], 'q', 'System', true),
      r('Volume up', [], 'volup', 'Media', false),
      r('Volume down', [], 'voldown', 'Media', false),
      r('Mute', [], 'mute', 'Media', false),
      r('Play', [], 'playpause', 'Media', false),
      r('Next track', [], 'next', 'Media', false),
      r('Previous track', [], 'prev', 'Media', false),
      r('Screenshot', ['cmd', 'shift'], '3', 'Screenshots', false),
      r('Screenshot selection', ['cmd', 'shift'], '4', 'Screenshots', false),
      r('Screenshot options', ['cmd', 'shift'], '5', 'Screenshots', false),
      r('Copy', ['cmd'], 'c', 'Clipboard', false),
      r('Paste', ['cmd'], 'v', 'Clipboard', false),
      r('Cut', ['cmd'], 'x', 'Clipboard', false),
      r('Paste plain', ['cmd', 'shift'], 'v', 'Clipboard', false),
      r('Force quit', ['cmd', 'alt'], 'esc', 'Other', false),
    ];
  }
const LAYERS = ['edit', 'window', 'media'];
  const ROWS = {
    edit: [['copy', 'Copy', 'c', ['cmd'], ['cmd']], ['paste', 'Paste', 'v', ['cmd'], ['cmd']], ['undo', 'Undo', 'z', ['cmd'], ['ctrl']]],
    window: [['overview', { macos: 'Mission', linux: 'Overview' }, { macos: 'up', linux: 'f4' }, ['ctrl'], ['cmd']],
      ['switcher', 'Switch', 'tab', ['cmd'], ['alt']],
      ['launch', { macos: 'Spotlight', linux: 'Menu' }, 'space', ['cmd'], ['cmd']]],
    media: [['voldown', 'Vol \u2212', 'voldown', [], []], ['playpause', 'Play', 'playpause', [], []], ['volup', 'Vol +', 'volup', [], []]],
  };
  function layer(name, os) {
    const o = os === 'macos' ? 'macos' : 'linux', pick = v => (v && typeof v === 'object' && !Array.isArray(v) ? v[o] : v);
    return (ROWS[name] || []).map(([id, label, k, mm, ml]) => ({ id, label: pick(label), k: pick(k), mods: (o === 'macos' ? mm : ml).slice() }));
  }
  function nextLayer(n) { const i = LAYERS.indexOf(n); return LAYERS[(i + 1) % LAYERS.length] }
    const FAV_PREFIX = 'padfav:v1:', REC_PREFIX = 'padrec:v1:', MIG_PREFIX = 'padmig:v1:';
  function readList(store, key) {
    try {
      const v = JSON.parse(store[key] || '[]');
      return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
    } catch (e) { return [] }
  }
  function writeList(store, key, xs) { store[key] = JSON.stringify(xs.slice(0, 24)) }
  function migrateStore(store) {
    const target = ['mini', 'pc-desktop', 'Dell'].includes(store.padt) ? store.padt : null;
    const lyr = LAYERS.includes(store.padlyr) ? store.padlyr : null;
    if (!target || !lyr) return { target: target || 'mini', layer: lyr };
    const mig = MIG_PREFIX + target;
    if (store[mig] == null) {
      store[mig] = lyr;
      const fav = FAV_PREFIX + target;
      if (store[fav] == null) {
        const linux = linuxTarget(target);
        const seed = lyr === 'edit' ? (linux ? ['ctrl:c', 'ctrl:v', 'ctrl+shift:v'] : ['cmd:c', 'cmd:v', 'cmd:x'])
          : lyr === 'window' ? (linux ? ['super:f4', 'alt:tab', 'super:space'] : ['ctrl:up', 'cmd:tab', 'cmd:space'])
          : ['voldown', 'playpause', 'volup'];
        writeList(store, fav, seed);
      }
    }
    return { target, layer: lyr };
  }
  function pinToggle(store, target, id) {
    const k = FAV_PREFIX + target;
    let xs = readList(store, k).filter(x => x !== id);
    const on = !readList(store, k).includes(id);
    if (on) xs = [id].concat(xs);
    writeList(store, k, xs);
    return readList(store, k);
  }
  function pushRecent(store, target, id) {
    const k = REC_PREFIX + target;
    const xs = [id].concat(readList(store, k).filter(x => x !== id));
    writeList(store, k, xs.slice(0, 8));
    return readList(store, k);
  }
  const NAMEOF = { ' ': 'space', '-': 'minus', '=': 'equal', '[': 'lbracket', ']': 'rbracket', '\\': 'backslash', ';': 'semicolon', "'": 'quote', '`': 'grave', ',': 'comma', '.': 'period', '/': 'slash' };
  function chord(s, mods) {
    if (mods.length && s.length === 1) {
      const lo = s.toLowerCase();
      const k = /^[a-z0-9]$/.test(lo) ? lo : NAMEOF[s];
      if (k) {
        const m = mods.slice();
        if (s !== lo && !m.includes('shift')) m.push('shift');
        return { op: 'key', k, mods: m };
      }
    }
    return { op: 'text', s };
  }
  const TAP_MS = 260, TAP_PX = 10;
  function classify(g) {
    if (g.dist > TAP_PX) return 'move';
    if (g.ms > TAP_MS) return 'none';
    return g.fingers >= 3 ? 'mtap' : g.fingers === 2 ? 'rtap' : 'tap';
  }
  // Pointer speed steps, cycled by the speed chip; stored per target ("pads:<target>").
  const SPEEDS = [1, 1.6, 2.4], SPEED_DEFAULT = 1.6;
  function speedFor(t, store) { const v = +store['pads:' + t]; return SPEEDS.includes(v) ? v : SPEED_DEFAULT }
  function setSpeed(t, v, store) { if (SPEEDS.includes(v)) store['pads:' + t] = String(v) }
  function nextSpeed(v) { const i = SPEEDS.indexOf(v); return SPEEDS[(i + 1) % SPEEDS.length] }

  // ---------- key pages ----------
  // Three pages on one six-column, four-row grid. Each key is [id, label, key name, mac mods, linux mods, col, row, width, height, flags].
  // Key names are the allowlist in rust/src/pad.rs and are mapped by both agents. Flags: icon (drawn arrow), aria, rep (repeats while
  // held), mod (a latching modifier; the value is its protocol name), hold (key stays down while the finger does).
  const PAGES = ['keys', 'fn', 'media'];
  const PAGE_LABEL = { keys: 'Keys', fn: 'Function', media: 'Media' };
  const PAGE_COLS = 6, PAGE_ROWS = 4;
  const K = (id, label, k, mm, ml, c, r, w, h, f) => ({ id, label, k, mm, ml, c, r, w: w || 1, h: h || 1, f: f || {} });
  const MS = { macos: '\u2318', linux: 'Super' };
  const PAGE_DEF = {
    keys: [
      // arrows: an inverted T, up directly above down, left and right flanking down
      K('up', 'Up', 'up', [], [], 2, 1, 1, 1, { icon: 'up', aria: 'Arrow up', rep: 1 }),
      K('left', 'Left', 'left', [], [], 1, 2, 1, 1, { icon: 'left', aria: 'Arrow left', rep: 1 }),
      K('down', 'Down', 'down', [], [], 2, 2, 1, 1, { icon: 'down', aria: 'Arrow down', rep: 1 }),
      K('right', 'Right', 'right', [], [], 3, 2, 1, 1, { icon: 'right', aria: 'Arrow right', rep: 1 }),
      K('esc', 'Esc', 'esc', [], [], 4, 1),
      K('tab', 'Tab', 'tab', [], [], 5, 1),
      K('backspace', 'Back', 'backspace', [], [], 6, 1, 1, 1, { aria: 'Backspace', rep: 1 }),
      K('enter', 'Enter', 'enter', [], [], 4, 2, 3, 1),
      // modifiers: tap = next key only, double tap = locked; Right Alt is a key held down while the finger is (VoxType dictation)
      K('super', MS, null, [], [], 1, 3, 1, 1, { mod: 'cmd', aria: { macos: 'Command', linux: 'Super' } }),
      K('ctrl', 'Ctrl', null, [], [], 2, 3, 1, 1, { mod: 'ctrl', aria: 'Control' }),
      K('alt', 'Alt', null, [], [], 3, 3, 1, 1, { mod: 'alt', aria: 'Left Alt' }),
      K('ralt', 'Right Alt', 'ralt', [], [], 4, 3, 1, 1, { hold: 1, aria: 'Right Alt, tap to dictate' }),
      K('shift', 'Shift', null, [], [], 5, 3, 2, 1, { mod: 'shift' }),
      K('copy', 'Copy', 'c', ['cmd'], ['ctrl'], 1, 4),
      K('paste', 'Paste', 'v', ['cmd'], ['ctrl'], 2, 4),
      K('cut', 'Cut', 'x', ['cmd'], ['ctrl'], 3, 4),
      K('undo', 'Undo', 'z', ['cmd'], ['ctrl'], 4, 4),
      K('redo', 'Redo', 'z', ['cmd', 'shift'], ['ctrl', 'shift'], 5, 4),
      K('selall', 'Select all', 'a', ['cmd'], ['ctrl'], 6, 4),
    ],
    fn: [
      ...Array.from({ length: 12 }, (_, i) => K('f' + (i + 1), 'F' + (i + 1), 'f' + (i + 1), [], [], (i % 6) + 1, i < 6 ? 1 : 2)),
      K('home', 'Home', 'home', [], [], 1, 3),
      K('end', 'End', 'end', [], [], 2, 3),
      K('pgup', 'PgUp', 'pgup', [], [], 3, 3, 1, 1, { aria: 'Page up', rep: 1 }),
      K('pgdn', 'PgDn', 'pgdn', [], [], 4, 3, 1, 1, { aria: 'Page down', rep: 1 }),
      K('delete', 'Del', 'delete', [], [], 5, 3, 2, 1, { aria: 'Delete', rep: 1 }),
      // combos: Super+Space launcher, Super+W close, Ctrl+Shift+V terminal paste, Alt+Tab, Super+F4 overview
      K('menu', { macos: 'Search', linux: 'Menu' }, 'space', ['cmd'], ['cmd'], 1, 4, 1, 1, { aria: { macos: 'Spotlight', linux: 'Launcher' } }),
      K('close', 'Close', 'w', ['cmd'], ['cmd'], 2, 4, 1, 1, { aria: 'Close window' }),
      K('termpaste', { macos: 'Paste plain', linux: 'Term paste' }, 'v', ['cmd', 'shift'], ['ctrl', 'shift'], 3, 4, 1, 1, { aria: { macos: 'Paste and match style', linux: 'Paste in terminal' } }),
      K('switch', 'Switch', 'tab', ['cmd'], ['alt'], 4, 4, 1, 1, { aria: 'Switch window' }),
      K('overview', { macos: 'Mission', linux: 'Overview' }, { macos: 'up', linux: 'f4' }, ['ctrl'], ['cmd'], 5, 4, 2, 1, { aria: { macos: 'Mission Control', linux: 'Workspace overview' } }),
    ],
    media: [
      K('voldown', 'Vol \u2212', 'voldown', [], [], 1, 1, 2, 2, { aria: 'Volume down', rep: 1 }),
      K('mute', 'Mute', 'mute', [], [], 3, 1, 2, 2),
      K('volup', 'Vol +', 'volup', [], [], 5, 1, 2, 2, { aria: 'Volume up', rep: 1 }),
      K('prev', 'Prev', 'prev', [], [], 1, 3, 2, 2, { aria: 'Previous track' }),
      K('playpause', 'Play/Pause', 'playpause', [], [], 3, 3, 2, 2),
      K('next', 'Next', 'next', [], [], 5, 3, 2, 2, { aria: 'Next track' }),
    ],
  };
  const pick = (v, o) => (v && typeof v === 'object' && !Array.isArray(v) ? v[o] : v);
  // A control's spoken name starts with the words on it, so voice control finds it by what it shows ("Ctrl, Control"), and the
  // detail follows after a comma. A label of symbols only (an arrow, the Command sign) is read by its detail alone, and a detail that
  // already starts with the label's words is the whole name ("Right Alt, tap to dictate").
  const words = s => String(s == null ? '' : s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  function spoken(visible, detail) {
    const v = String(visible == null ? '' : visible).trim(), d = String(detail == null ? '' : detail).trim();
    if (!d) return v;
    const a = words(v), b = words(d);
    if (!a.length || a.every((w, i) => b[i] === w)) return d;
    return v + ', ' + d;
  }
  // The keys of one page for one OS: labels, key names and modifier lists resolved, ready to place on the grid.
  function page(name, os) {
    const o = os === 'macos' ? 'macos' : 'linux';
    return (PAGE_DEF[name] || []).map(d => {
      const label = pick(d.label, o), kind = d.f.mod ? 'mod' : d.f.hold ? 'hold' : 'key';
      return {
        id: d.id, label, aria: spoken(d.f.icon ? '' : label, pick(d.f.aria, o) || label), kind, mod: d.f.mod || '', icon: d.f.icon || '',
        k: kind === 'mod' ? '' : pick(d.k, o), mods: kind === 'key' ? (o === 'macos' ? d.mm : d.ml).slice() : [],
        c: d.c, r: d.r, w: d.w, h: d.h, rep: !!d.f.rep,
      };
    });
  }
  function nextPage(n) { const i = PAGES.indexOf(n); return PAGES[(i + 1) % PAGES.length] }
  // Haptic style of a key press: a modifier is a selection tick, every other key a light tap; mouse buttons are medium (see the DOM).
  const keyHaptic = d => (d.kind === 'mod' ? 'selection' : 'light');
  // Modifier latch: tap = next key only ("once"), a second tap within LOCK_MS = locked, any other tap = off.
  const LOCK_MS = 350;
  function modTap(state, dt) { return !state ? 'once' : state === 'once' && dt < LOCK_MS ? 'lock' : null }
  // A key that stays down while the finger does. Down is sent at once; the key goes up when the last finger lifts, so a quick tap is a
  // real key tap (the press is what flips VoxType's dictation toggle) and a long press keeps the key down as a secondary gesture. After
  // HOLD_MS a medium tick says the hold is engaged. HOLD_MAX_MS is a watchdog: a missed pointerup can never leave the key down.
  const HOLD_MS = 280, HOLD_MAX_MS = 120000;
  // `press(id)` and `release(id)` take the pointer id: the key goes up when the last pointer on it lifts; `release()` with no id lets go at once.
  function holdKey(io) {
    let st = 'idle', cue = 0, dog = 0;
    const ids = new Set();
    const end = () => { io.clear(cue); io.clear(dog); cue = dog = 0; st = 'idle'; ids.clear(); io.lit(false); io.up() };
    return {
      state: () => st,
      press(id = 0) {
        ids.add(id);
        if (st !== 'idle') return false;
        st = 'down'; io.lit(true); io.down();
        cue = io.set(() => { cue = 0; if (st === 'down' && io.engaged) io.engaged() }, HOLD_MS);
        dog = io.set(() => { dog = 0; if (st === 'down') end() }, HOLD_MAX_MS);
        return true;
      },
      release(id) {
        if (id === undefined) ids.clear(); else ids.delete(id);
        if (st === 'down' && ids.size === 0) end();
      },
    };
  }
  // Key repeat for the keys you hold to keep going (arrows, Backspace, Page, volume): first fire at once, then after REPEAT_DELAY_MS
  // every REPEAT_MS, at most REPEAT_MAX times so a lost pointerup cannot run away.
  const REPEAT_DELAY_MS = 420, REPEAT_MS = 70, REPEAT_MAX = 400;
  function repeater(io) {
    let on = false, id = 0, n = 0;
    const loop = () => { if (!on) return; if (++n > REPEAT_MAX) { on = false; return } io.fire(); id = io.set(loop, REPEAT_MS) };
    return {
      active: () => on,
      press() { if (on) return false; on = true; n = 0; io.fire(); id = io.set(loop, REPEAT_DELAY_MS); return true },
      release() { on = false; io.clear(id); id = 0 },
    };
  }
  // The minimum time a pressed key cap shows its pressed state, so a quick tap is still seen.
  const PRESS_MS = 90;
  // Key taps and typed text leave the page through one ordered queue, never faster than PACE_MS apart (25 a second), as a courtesy to the
  // server: the server keeps its own ordered queue (256) and types at most 29 a second, so nothing is ever dropped or resent, and a burst
  // after a network stall comes out in the order it was typed. The first tap after a quiet moment goes out at once.
  const PACE_MS = 40, QUEUE_MAX = 2000;
  function outbox(io) {
    const q = [];
    let timer = 0, last = -Infinity;
    const later = ms => { if (!timer) timer = io.set(() => { timer = 0; pump() }, ms) };
    function pump() {
      if (timer || !q.length) return;
      const wait = last + PACE_MS - io.now();
      if (wait > 0) return later(wait);
      const o = q.shift();
      if (!io.send(o)) { q.length = 0; return }
      last = io.now();
      if (q.length) later(PACE_MS);
    }
    return {
      push(o) { if (q.length >= QUEUE_MAX) { if (io.lost) io.lost(o); return false } q.push(o); pump(); return true },
      clear() { q.length = 0; io.clear(timer); timer = 0 },
      size: () => q.length,
    };
  }
  // What the page says when the server refuses a command. A Super shortcut outside the allowed keys gets the whole answer, not just "Rejected".
  const SUPER_HELP = 'Super works with C, V, X, Z, A, W, F, Space, Tab, Enter, the arrows and digits';
  const SUPER_KEYS = ['c', 'v', 'x', 'z', 'a', 'w', 'f', 'space', 'tab', 'f4', 'enter', 'up', 'down', 'left', 'right', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  function rejectCopy(r) {
    if (r === 'bad combo') return 'Not sent. ' + SUPER_HELP;
    if (r === 'bad key') return 'Not sent: the Pad does not know that key';
    if (r === 'too long') return 'Not sent: that was too much at once';
    if (r === 'control char') return 'Not sent: the text had a control character';
    return 'Not sent: ' + String(r).slice(0, 60);
  }
  // One letter case on the page: capitalised words, symbols where the key has one.
  const LABEL = { l: 'Left', m: 'Middle', r: 'Right', mini: 'Mini', 'pc-desktop': 'PC', Dell: 'Dell' };
  const modLabel = os => (os === 'macos' ? MS.macos : MS.linux);
  // A connect that gets no answer in CONNECT_MS stops waiting: it says so and offers Try again, the deck's one retry word. After a
  // failed attempt the next attempt keeps Try again on screen ("Still trying"), so the button never flickers away. Idle offers Connect.
  const CONNECT_MS = 8000, AGAIN = 'Try again';
  function connectCopy(kind, name, why, secs, failed) {
    const wait = Math.max(1, Math.round(secs) || 1);
    if (kind === 'connecting') return failed ? { state: 'connecting', title: 'Connecting to ' + name, line: 'Still trying. The last attempt failed.', retry: true, label: AGAIN } : { state: 'connecting', title: 'Connecting to ' + name, line: 'Waiting for the input agent', retry: false, label: '' };
    if (kind === 'timeout') return { state: 'failed', title: name + ' is not responding', line: 'No answer after ' + CONNECT_MS / 1000 + ' s. Trying again in ' + wait + ' s.', retry: true, label: AGAIN };
    if (kind === 'closed') return { state: 'failed', title: name + ' disconnected', line: (why ? why + '. ' : '') + 'Trying again in ' + wait + ' s.', retry: true, label: AGAIN };
    return { state: 'idle', title: 'Trackpad idle', line: 'Connects when this page is on screen', retry: true, label: 'Connect' };
  }
  const HINT_PARTS = ['Tap to click', 'Two fingers to scroll', 'Hold after a double-tap to drag'];
  const HINT = HINT_PARTS.join(' \u00B7 ');
  // The one line on a desk screen that says which machine the Pad drives, so a desktop user never mistakes it for this computer.
  const driveLine = name => 'This Pad controls ' + name + '.';
  // A bind row shows its name over its chord; a bind that sends only on a held press says so before the chord. Its spoken name reads
  // the same words in the same order, so the name starts with what the row shows ("Log out, hold to send, Super+Shift+Q").
  const BIND_HOLD = 'hold to send';
  const bindLine = (chord, hold) => (hold ? BIND_HOLD + ' \u00B7 ' : '') + chord;
  const bindName = (label, chord, hold) => label + ', ' + (hold ? BIND_HOLD + ', ' : '') + chord;
  const core = { accel, gainFor, accelStep, ACCEL_MAX, diff, chunks, tapCount, shortcut, chord, classify, speedFor, setSpeed, nextSpeed, PAGES, PAGE_LABEL, PAGE_COLS, PAGE_ROWS, page, spoken, nextPage, keyHaptic, LOCK_MS, modTap, HOLD_MS, HOLD_MAX_MS, holdKey, REPEAT_DELAY_MS, REPEAT_MS, REPEAT_MAX, repeater, PRESS_MS, LABEL, modLabel, CONNECT_MS, connectCopy, HINT, HINT_PARTS, driveLine, outbox, PACE_MS, QUEUE_MAX, rejectCopy, SUPER_KEYS, LAYERS, layer, nextLayer, GROUPS, blockedClipboard, isDangerous, groupOf, shapeBinds, macBinds, bindId, migrateStore, pinToggle, pushRecent, readList, bindLine, bindName, BIND_HOLD };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (typeof document === 'undefined') return;

  // ---------- DOM ----------
  const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
  const tp = $('#tp'), kin = $('#kin'), kpages = $('#kpages'), padpg = $('#padpg'), SENT = '\u00a0\u00a0';
  // TV view (html.tv) never offers the Pad: no pointer is driven from across the room, so it never connects there
  const onTv = () => document.documentElement.classList.contains('tv');
  // the machine line (shown on D and XL only, css/pad.css): which computer this Pad drives
  const who = document.createElement('p');
  who.id = 'padwho';
  const NAMES = { mini: LABEL.mini, 'pc-desktop': LABEL['pc-desktop'], Dell: LABEL.Dell };
  // a guest deck (app.js sets html.guest) has no Mac mini: the server refuses /pad?target=mini for a guest cookie
  if (document.documentElement.classList.contains('guest')) delete NAMES.mini;
  const FIRST = NAMES.mini ? 'mini' : 'pc-desktop';
  let target = localStorage.getItem('padt') || FIRST;
  if (!NAMES[target]) target = FIRST;
  let ws = null, os = 'macos', open = false, want = false;
  let backoff = 800, retryT = 0, pingAt = 0, pingId = 0, lastErr = '', fails = 0;
  const mods = new Map(); // name -> 'once' | 'lock'
  const osName = () => (os === 'macos' ? 'macOS' : 'Omarchy');
  // Haptics ride the shell's `deckHaptic` bridge (window.haptic in app.js, a no-op outside the iOS app); Android gets a short buzz.
  const VIB = { selection: 4, light: 6, medium: 14 };
  function tick(style) {
    if (typeof haptic === 'function') haptic(style);
    try { navigator.vibrate && navigator.vibrate(VIB[style] || 6) } catch (e) {}
  }
  const timers = { set: (f, ms) => setTimeout(f, ms), clear: id => clearTimeout(id) };
  // every key tap and piece of typed text goes out through this, in order, at most 25 a second (the server takes 30); a tap it drops comes back and is sent again
  const out = outbox({ now: () => performance.now(), set: timers.set, clear: timers.clear, send: o => send(o), lost: () => status('warn', 'Some typing did not go through. Try again.') });

  function status(kind, info) {
    $('#tpst i').className = 'sd ' + kind;
    $('#tpinfo').textContent = info;
  }
  // One place paints the trackpad's off state: connecting (with a progress line), failed or idle, with a 44 px Retry or Connect button.
  function paint(c) {
    tp.classList.add('off');
    tp.classList.toggle('connecting', c.state === 'connecting');
    $('#tpoffb').textContent = c.title;
    $('#tpoffs').textContent = c.line;
    const b = $('#tprec');
    b.style.display = c.retry ? '' : 'none';
    b.textContent = c.label;
  }
  function send(o) {
    if (open && ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true }
    return false;
  }

  let connT = 0;
  function connect() {
    clearTimeout(retryT); clearTimeout(connT);
    if (ws) { try { ws.onclose = null; ws.close() } catch (e) {} ws = null }
    open = false; want = true;
    status('warn', 'Connecting');
    paint(connectCopy('connecting', NAMES[target], '', 0, fails));
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    let s;
    try { s = new WebSocket(proto + location.host + '/pad?target=' + encodeURIComponent(target)) } catch (e) { retry('Could not open the connection'); return }
    ws = s;
    connT = setTimeout(() => { if (ws === s && !open) { try { s.onclose = null; s.close() } catch (e) {} ws = null; retry('', 'timeout') } }, CONNECT_MS);
    s.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data) } catch (e) { return }
      if (m.ready) {
        clearTimeout(connT);
        open = true; backoff = 800; fails = 0; os = m.os || os; lastErr = '';
        tp.classList.remove('off', 'connecting', 'used');
        status('ok', 'Connected \u00B7 ' + osName() + (m.screen ? ' \u00B7 ' + m.screen.map(Math.round).join('\u00D7') : ''));
        kin.placeholder = 'Tap to type on ' + NAMES[target];
        paintKeys();
        syncSuper();
        ping();
      } else if (m.pong != null) {
        if (m.pong === pingId) status('ok', 'Connected \u00B7 ' + osName() + ' \u00B7 ' + Math.round(performance.now() - pingAt) + ' ms');
      } else if (m.error) { lastErr = m.error; status('bad', m.error) }
      else if (m.warn) { status('warn', m.warn) }
      else if (m.lost) status('warn', 'Some typing did not go through. Try again.')
      else if (m.reject) { status('warn', rejectCopy(m.reject)) }
    };
    s.onclose = () => { if (ws === s) { clearTimeout(connT); ws = null; open = false; out.clear(); resetGesture(); if (want) retry(lastErr || 'Connection closed') } };
    s.onerror = () => {};
  }
  function retry(why, kind) {
    const secs = backoff / 1000; fails++;
    // the off panel says what happened and when the next try is; the link line only says the link is down, so the cause shows once
    status('bad', 'Offline');
    paint(connectCopy(kind === 'timeout' ? 'timeout' : 'closed', NAMES[target], why, secs));
    retryT = setTimeout(() => { if (want && visible()) connect() }, backoff);
    backoff = Math.min(backoff * 2, 15000);
  }
  function disconnect() {
    want = false; clearTimeout(retryT); clearTimeout(connT);
    if (ws) { try { send({ op: 'release' }); ws.onclose = null; ws.close() } catch (e) {} }
    out.clear(); ws = null; open = false; fails = 0; resetGesture();
    status('warn', 'Idle');
    paint(connectCopy('idle', NAMES[target]));
  }
  function ping() { if (!open) return; pingId = (pingId + 1) % 1e6; pingAt = performance.now(); send({ op: 'ping', id: pingId }) }
  // keepalive doubles as the latency readout; the server drops sessions quiet for 45 s
  setInterval(() => { if (open) ping() }, 10000);

  let onTarget = null;
  // ---------- target switch ----------
  function setTarget(t) {
    stopAll();
    target = t; fails = 0; localStorage.setItem('padt', t);
    os = t === 'mini' ? 'macos' : 'linux';
    mods.clear();
    if (typeof onTarget === 'function') onTarget(t);
    $$('#ptg button').forEach(b => { const on = b.dataset.t === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on) });
    kin.placeholder = 'Tap to type on ' + NAMES[t];
    who.textContent = driveLine(NAMES[t]);
    syncSuper();
    loadBinds();
    paintKeys();
    if (visible()) connect(); else status('warn', 'Idle');
  }
  $$('#ptg button').forEach(b => { b.onclick = () => { if (b.dataset.t !== target) { tick('selection'); setTarget(b.dataset.t) } } });
  $('#tprec').onclick = () => { tick('light'); backoff = 800; connect() };
  // Reconnect on the link line: the same fresh attempt, available while connected too (a link that looks up but stopped moving the pointer)
  $('#tprecon').onclick = () => { tick('light'); backoff = 800; fails = 0; connect() };
  // the controls on the trackpad surface are buttons, never part of a gesture
  $('#tphd').addEventListener('pointerdown', e => e.stopPropagation());
  $('#tprecon').addEventListener('pointerdown', e => e.stopPropagation());

  // ---------- movement, batched to one message per frame ----------
  let ax = 0, ay = 0, sx = 0, sy = 0, raf = 0;
  function flush() {
    raf = 0;
    const dx = Math.round(ax), dy = Math.round(ay);
    if (dx || dy) { send({ op: 'move', dx, dy }); ax -= dx; ay -= dy }
    const qx = Math.round(sx), qy = Math.round(sy);
    if (qx || qy) { send({ op: 'scroll', dx: qx, dy: qy }); sx -= qx; sy -= qy }
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(flush) };
  let SENS = speedFor(target, localStorage);
  const chip = $('#tpspd');
  // the name starts with what the chip shows ("1.6×"), then says what it is
  const paintSpeed = () => { chip.textContent = SENS + '\u00D7'; chip.setAttribute('aria-label', SENS + '\u00D7 pointer speed, tap to change') };
  chip.onclick = e => { e.stopPropagation(); SENS = nextSpeed(SENS); setSpeed(target, SENS, localStorage); paintSpeed(); tick('selection') };
  pressable(chip);
  paintSpeed();
  onTarget = t => { SENS = speedFor(t, localStorage); paintSpeed(); tp.classList.remove('used') };

  // ---------- trackpad gestures ----------
  const pts = new Map();
  let g = null, lastTapEnd = 0, lastTap = null, dragging = false;
  // Forget every touch and one-shot state so a new session never starts mid-gesture.
  function resetGesture() { pts.clear(); g = null; dragging = false; lastTap = null; tp.classList.remove('act', 'drag'); stopAll() }
  function centroid() { let x = 0, y = 0; pts.forEach(p => { x += p.x; y += p.y }); return { x: x / pts.size, y: y / pts.size } }
  tp.addEventListener('pointerdown', e => {
    if (!open) return;
    e.preventDefault();
    tp.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tp.classList.add('act');
    const now = performance.now();
    if (pts.size === 1) {
      // tap, then touch and move within 300 ms = drag with the left button held
      g = { t0: now, fingers: 1, dist: 0, c: centroid(), dragArm: now - lastTapEnd < 300, vx: 0, vy: 0 };
    } else if (g) { g.fingers = Math.max(g.fingers, pts.size); g.c = centroid() }
  });
  tp.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId);
    if (!p || !g) return;
    if (pts.size === 1) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const list = evs.length ? evs : [e];
      for (const c of list) {
        const dx = c.clientX - p.x, dy = c.clientY - p.y;
        p.x = c.clientX; p.y = c.clientY;
        g.dist += Math.hypot(dx, dy);
        const mx = accelStep(dx, g.vx); g.vx = mx.v;
        const my = accelStep(dy, g.vy); g.vy = my.v;
        ax += mx.d * SENS; ay += my.d * SENS;
      }
      if (g.dragArm && !dragging && g.dist > 4) {
        dragging = true; tp.classList.add('drag'); tick('medium');
        send({ op: 'button', b: 'l', down: true });
      }
    } else {
      p.x = e.clientX; p.y = e.clientY;
      const c = centroid(), dx = c.x - g.c.x, dy = c.y - g.c.y;
      g.dist += Math.hypot(dx, dy);
      sx += dx * 2.2; sy += dy * 2.2; // natural scrolling, like a Mac trackpad
      g.c = c;
    }
    kick();
  });
  function up(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size) { if (g) g.c = centroid(); return }
    tp.classList.remove('act');
    if (!g) return;
    const kind = classify({ fingers: g.fingers, ms: performance.now() - g.t0, dist: g.dist });
    if (kind !== 'none') tp.classList.add('used'); // the hint has done its job until the next connect
    if (dragging) { dragging = false; tp.classList.remove('drag'); send({ op: 'button', b: 'l', down: false }) }
    else if (kind === 'tap') {
      const now = { t: performance.now(), x: g.c.x, y: g.c.y };
      const n = tapCount(lastTap, now);
      lastTap = { ...now, n };
      send(n > 1 ? { op: 'click', b: 'l', n: 1, s: n } : { op: 'click', b: 'l', n: 1 }) && tick('light');
      lastTapEnd = now.t;
    }
    else if (kind === 'rtap') send({ op: 'click', b: 'r', n: 1 }) && tick('medium');
    else if (kind === 'mtap') send({ op: 'click', b: 'm', n: 1 }) && tick('medium');
    g = null;
  }
  // A cancelled touch (edge swipe, shade pull) never clicks; it only lets go of a held drag.
  function cancel(e) {
    pts.delete(e.pointerId);
    if (pts.size) return;
    tp.classList.remove('act');
    if (dragging) { dragging = false; tp.classList.remove('drag'); send({ op: 'button', b: 'l', down: false }) }
    g = null;
  }
  tp.addEventListener('pointerup', up);
  tp.addEventListener('pointercancel', cancel);
  tp.addEventListener('lostpointercapture', e => { if (pts.has(e.pointerId)) cancel(e) });

  // ---------- scroll strip ----------
  const scr = $('#scr');
  let sy0 = null;
  scr.addEventListener('pointerdown', e => { e.preventDefault(); scr.setPointerCapture(e.pointerId); sy0 = e.clientY; scr.classList.add('act') });
  scr.addEventListener('pointermove', e => { if (sy0 == null) return; const d = e.clientY - sy0; sy0 = e.clientY; sy += d * 3; kick() });
  const sEnd = () => { sy0 = null; scr.classList.remove('act') };
  scr.addEventListener('pointerup', sEnd);
  scr.addEventListener('pointercancel', sEnd);

  // ---------- key caps: pressed state shows at once and stays at least PRESS_MS, so a quick tap is seen ----------
  function pressable(b) {
    let at = 0, off = 0;
    b.addEventListener('pointerdown', () => { clearTimeout(off); at = performance.now(); b.classList.add('dn') });
    const lift = () => { clearTimeout(off); off = setTimeout(() => b.classList.remove('dn'), Math.max(0, PRESS_MS - (performance.now() - at))) };
    b.addEventListener('pointerup', lift);
    b.addEventListener('pointercancel', lift);
    b.addEventListener('lostpointercapture', lift);
  }

  // ---------- mouse buttons: press = down, release = up, so another finger can drag ----------
  $$('#mrow [data-ck], #kbmouse [data-ck]').forEach(b => {
    const bt = b.dataset.ck;
    b.textContent = LABEL[bt];
    pressable(b);
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('on'); tick('medium'); send({ op: 'button', b: bt, down: true }) });
    const rel = () => { if (!b.classList.contains('on')) return; b.classList.remove('on'); send({ op: 'button', b: bt, down: false }) };
    b.addEventListener('pointerup', rel);
    b.addEventListener('pointercancel', rel);
  });

  // ---------- modifiers: tap = next key only, double tap = locked, tap again = off ----------
  const modAt = new Map();
  function paintMods() {
    $$('#kpages [data-m], #kbmods [data-m]').forEach(b => {
      const s = mods.get(b.dataset.m);
      b.classList.toggle('on', !!s);
      b.classList.toggle('lock', s === 'lock');
      b.dataset.state = s || 'off';
      b.setAttribute('aria-pressed', s === 'lock' ? 'true' : s ? 'mixed' : 'false');
      if (b.id === 'mcmd') {
        // the cap shows Super or the Command sign and its latch ("Super once"); the name says the same words ("Command once")
        const sup = b.dataset.m === 'super', st = s === 'lock' ? ' lock' : s === 'once' ? ' once' : '';
        b.textContent = (sup ? MS.linux : MS.macos) + st;
        b.setAttribute('aria-label', (sup ? 'Super' : 'Command') + st);
      }
    });
  }
  function syncSuper() {
    const b = $('#mcmd');
    if (!b) return;
    const next = os === 'macos' ? 'cmd' : 'super';
    const prev = b.dataset.m;
    if (prev && prev !== next && mods.has(prev)) { mods.set(next, mods.get(prev)); mods.delete(prev) }
    b.dataset.m = next;
    paintMods();
  }
  function useMods() {
    const m = [...mods.keys()];
    mods.forEach((v, k) => { if (v === 'once') mods.delete(k) });
    paintMods();
    return m;
  }
  function key(k, extra) {
    const m = useMods();
    for (const x of extra || []) if (!m.includes(x)) m.push(x);
    out.push({ op: 'key', k, mods: m });
  }

  // ---------- key pages, drawn from page(): the same keys the agents map ----------
  const ICON = {
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>', down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    left: '<path d="M19 12H5M12 5l-7 7 7 7"/>', right: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  };
  const svg = n => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON[n] + '</svg>';
  const defs = new Map();
  let keysOs = '';
  function paintKeys() {
    if (keysOs === os) return;
    stopAll(); holds.clear(); keysOs = os; defs.clear();
    kpages.textContent = '';
    for (const name of PAGES) {
      const g = document.createElement('div');
      g.className = 'kp'; g.dataset.page = name; g.setAttribute('role', 'group'); g.setAttribute('aria-label', PAGE_LABEL[name] + ' keys');
      for (const d of page(name, os)) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'kc' + (d.kind === 'mod' ? ' mod' : d.kind === 'hold' ? ' holdkey' : '') + (d.icon ? ' ic' : '');
        b.dataset.id = d.id; b.setAttribute('aria-label', d.aria);
        if (d.kind === 'mod') { b.dataset.m = d.mod; b.setAttribute('aria-pressed', 'false') }
        else if (d.kind === 'hold') b.setAttribute('aria-pressed', 'false');
        else if (!d.mods.length) b.dataset.k = d.k;
        b.style.gridColumn = d.c + ' / span ' + d.w; b.style.gridRow = d.r + ' / span ' + d.h;
        if (d.icon) b.innerHTML = svg(d.icon); else b.textContent = d.label;
        defs.set(d.id, d);
        g.appendChild(b);
      }
      kpages.appendChild(g);
    }
    setPage(curPage, true);
    paintMods();
  }
  let curPage = PAGES.includes(localStorage.getItem('padpg')) ? localStorage.getItem('padpg') : 'keys';
  function setPage(name, quiet) {
    if (!quiet) { stopAll(); tick('selection'); localStorage.setItem('padpg', name) }
    curPage = name;
    $$('#kpages .kp').forEach(p => { p.hidden = p.dataset.page !== name });
    $$('#ppg button').forEach(b => { const on = b.dataset.pg === name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on) });
  }
  $$('#ppg button').forEach(b => { b.textContent = PAGE_LABEL[b.dataset.pg]; b.onclick = () => { if (b.dataset.pg !== curPage) setPage(b.dataset.pg) } });

  // Every held key cap is tracked by pointer id, so a lifted, cancelled or lost finger always lets the key go.
  const holds = new Map();
  const downs = new Map();
  function stopAll() { for (const s of [...downs.values()]) s.stop() }
  kpages.addEventListener('pointerdown', e => {
    const b = e.target.closest('.kc');
    if (!b || downs.has(e.pointerId)) return;
    const d = defs.get(b.dataset.id);
    if (!d) return;
    e.preventDefault();
    try { b.setPointerCapture(e.pointerId) } catch (x) {}
    const st = { b, stop() { downs.delete(e.pointerId); b.classList.remove('dn'); if (st.machine) st.machine.release() } };
    downs.set(e.pointerId, st);
    b.classList.add('dn');
    st.at = performance.now();
    tick(keyHaptic(d));
    if (d.kind === 'mod') tapMod(d);
    else if (d.kind === 'hold') {
      // one machine per key, however many fingers are on it: the key goes up when the LAST finger lifts
      let m = holds.get(d.id);
      if (!m) {
        m = holdKey({
          set: timers.set, clear: timers.clear,
          lit: on => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on) },
          down: () => send({ op: 'hold', k: d.k, down: true }), up: () => send({ op: 'hold', k: d.k, down: false }),
          engaged: () => tick('medium'),
        });
        holds.set(d.id, m);
      }
      st.machine = m;
      m.press(e.pointerId);
    } else {
      const fire = keyFire(d);
      if (d.rep) { st.machine = repeater({ set: timers.set, clear: timers.clear, fire }); st.machine.press() } else fire();
    }
  });
  // one key press: the latched modifiers and the key's own combo go out together; a held key repeats the same chord
  function keyFire(d) {
    const m = useMods(); for (const x of d.mods) if (!m.includes(x)) m.push(x);
    return () => out.push({ op: 'key', k: d.k, mods: m });
  }
  function tapMod(d) {
    const dt = Date.now() - (modAt.get(d.mod) || 0), s = modTap(mods.get(d.mod), dt);
    if (s) mods.set(d.mod, s); else mods.delete(d.mod);
    modAt.set(d.mod, Date.now()); paintMods();
  }
  // VoiceOver and keyboards activate a button with a click and no pointer events (detail 0): the same actions, once
  kpages.addEventListener('click', e => {
    const b = e.target.closest('.kc'), d = b && defs.get(b.dataset.id);
    if (!d || e.detail !== 0) return;
    tick(keyHaptic(d));
    if (d.kind === 'mod') tapMod(d);
    else if (d.kind === 'hold') { send({ op: 'hold', k: d.k, down: true }); send({ op: 'hold', k: d.k, down: false }) }
    else keyFire(d)();
  });
  function lift(e) {
    const s = downs.get(e.pointerId);
    if (!s) return;
    const b = s.b, wait = Math.max(0, PRESS_MS - (performance.now() - s.at));
    downs.delete(e.pointerId);
    if (s.machine) s.machine.release(e.pointerId);
    setTimeout(() => b.classList.remove('dn'), wait);
  }
  kpages.addEventListener('pointerup', lift);
  kpages.addEventListener('pointercancel', lift);
  kpages.addEventListener('lostpointercapture', lift);
  addEventListener('blur', stopAll);

  // ---------- layout and wording ----------
  (function arrange() {
    $$('#ptg button').forEach(b => { b.textContent = LABEL[b.dataset.t]; b.setAttribute('aria-pressed', b.classList.contains('on')) });
    const sp = $$('#scr span'); if (sp[1]) sp[1].textContent = 'Scroll';
    HINT_PARTS.forEach(t => { const s = document.createElement('span'); s.textContent = t; $('#tphint').appendChild(s) });
    $('#tphint').setAttribute('aria-label', HINT);
    $$('#kbmods button, #kbnav button, #kbtoggle, #ptg button, #tprec, #tprecon').forEach(pressable);
    $('#tpoff').setAttribute('role', 'status');
    tp.appendChild(who);
    paintKeys();
  })();

  $$('#kbmods [data-m]').forEach(b => {
    let lastT = 0;
    b.onclick = () => {
      const m = b.dataset.m, s = mods.get(m), now = Date.now();
      if (s === 'once' && now - lastT < 350) mods.set(m, 'lock');
      else if (s) mods.delete(m);
      else mods.set(m, 'once');
      lastT = now; paintMods();
    };
  });
  $$('#kbnav [data-k]').forEach(b => { b.onclick = () => key(b.dataset.k) });

  // ---------- Omarchy keybind surface ----------
  const KEY_OK = new Set(['enter', 'esc', 'tab', 'space', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'home', 'end', 'pgup', 'pgdn', 'minus', 'equal', 'lbracket', 'rbracket', 'backslash', 'semicolon', 'quote', 'grave', 'comma', 'period', 'slash', 'volup', 'voldown', 'mute', 'playpause', 'next', 'prev', 'capslock', 'print']);
  const MOD_OK = new Set(['cmd', 'ctrl', 'alt', 'shift', 'super']);
  function clientKeyOk(k) {
    if (typeof k !== 'string' || !k) return false;
    if (k.length === 1 && /[a-z0-9]/.test(k)) return true;
    if (/^f([1-9]|1[0-2])$/.test(k)) return true;
    return KEY_OK.has(k);
  }
  function acceptBind(b) {
    if (!b || typeof b.label !== 'string' || !b.label || typeof b.key !== 'string') return false;
    if (!GROUPS.includes(b.group)) return false;
    if (!Array.isArray(b.modifiers) || b.modifiers.some(m => !MOD_OK.has(m))) return false;
    if (!clientKeyOk(b.key)) return false;
    if (blockedClipboard(b.modifiers, b.key, target)) return false;
    if (b.confirm && !isDangerous(b.label, '')) return false;
    return true;
  }
  const MODN = { super: 'Super', cmd: 'Cmd', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  const KEYN = { enter: 'Enter', esc: 'Esc', tab: 'Tab', space: 'Space', backspace: 'Bksp', print: 'Print', volup: 'Vol+', voldown: 'Vol-', playpause: 'Play', mute: 'Mute', next: 'Next', prev: 'Prev', up: '\u2191', down: '\u2193', left: '\u2190', right: '\u2192', grave: '`' };
  function chordText(b) {
    const ks = KEYN[b.key] || (b.key.length === 1 ? b.key.toUpperCase() : b.key);
    return b.modifiers.map(m => MODN[m] || m).concat(ks).join('+');
  }
  let binds = [], query = '', bindErr = '', bindGen = 0;
  const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms) } catch (e) {} };
  function fireBind(b) {
    if (!acceptBind(b)) return;
    send({ op: 'key', k: b.key, mods: b.modifiers.slice() }) && buzz(6);
    pushRecent(localStorage, target, bindId(b));
    paintBinds();
  }
  function holdSend(btn, b) {
    let timer = 0, armed = false;
    const clear = () => { clearTimeout(timer); timer = 0; if (!armed) btn.classList.remove('arm') };
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      armed = false;
      btn.classList.add('arm');
      try { btn.setPointerCapture(e.pointerId) } catch (err) {}
      timer = setTimeout(() => { armed = true; btn.classList.remove('arm'); fireBind(b) }, 480);
    });
    btn.addEventListener('pointerup', clear);
    btn.addEventListener('pointercancel', clear);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  }
  // #kblist is the list the iOS shell knows ("Keybinds"). Each of its items is one group: a heading over its own list of binds, so a
  // screen reader hears "Workspaces, heading", then "list, 12 items" (a list holds list items only; axe aria-required-children). A note
  // ("No keybinds") is an item of its own. Group headings are level 2 under the page's h1.
  function groupEl(name, rows, favIds) {
    const li = document.createElement('div');
    li.className = 'kbgrp';
    li.setAttribute('role', 'listitem');
    const h = document.createElement('div');
    h.className = 'kbg';
    h.setAttribute('role', 'heading');
    h.setAttribute('aria-level', '2');
    h.textContent = name;
    const ul = document.createElement('div');
    ul.className = 'kbl';
    ul.setAttribute('role', 'list');
    for (const b of rows) ul.appendChild(rowEl(b, favIds));
    li.append(h, ul);
    return li;
  }
  function noteEl(text) {
    const n = document.createElement('div');
    n.className = 'kbnote';
    n.setAttribute('role', 'listitem');
    n.textContent = text;
    return n;
  }
  function rowEl(b, favIds) {
    const id = bindId(b), pinned = favIds.includes(id);
    const wrap = document.createElement('div');
    wrap.className = 'kbr';
    wrap.setAttribute('role', 'listitem');
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'star' + (pinned ? ' on' : '');
    star.textContent = pinned ? '\u2605' : '\u2606';
    star.setAttribute('aria-label', (pinned ? 'Unpin ' : 'Pin ') + b.label);
    pressable(star);
    star.onclick = e => { e.stopPropagation(); pinToggle(localStorage, target, id); paintBinds(); buzz(4) };
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'go' + (b.confirm ? ' hold' : '');
    const lab = document.createElement('b');
    lab.textContent = b.label;
    const sm = document.createElement('small');
    sm.textContent = bindLine(chordText(b), b.confirm);
    // a space between name and chord, so the row's words never run together ("Mission ControlCtrl+Up")
    go.append(lab, ' ', sm);
    go.setAttribute('aria-label', bindName(b.label, chordText(b), b.confirm));
    pressable(go);
    if (b.confirm) holdSend(go, b); else go.onclick = () => fireBind(b);
    wrap.append(star, go);
    return wrap;
  }
  function pinChip(b) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'b' + (b.confirm ? ' hold' : '');
    btn.textContent = b.label;
    btn.setAttribute('aria-label', bindName(b.label, chordText(b), b.confirm));
    pressable(btn);
    if (b.confirm) holdSend(btn, b); else btn.onclick = () => fireBind(b);
    return btn;
  }
  function paintBinds() {
    const list = $('#kblist'), fav = $('#kbfav');
    if (!list || !fav) return;
    const q = query.trim().toLowerCase();
    const match = b => !q || (b.label + ' ' + b.group + ' ' + chordText(b)).toLowerCase().includes(q);
    const favIds = readList(localStorage, 'padfav:v1:' + target);
    const recIds = readList(localStorage, 'padrec:v1:' + target);
    const byId = new Map(binds.map(b => [bindId(b), b]));
    fav.replaceChildren();
    const pins = favIds.map(id => byId.get(id)).filter(b => b && match(b));
    if (!pins.length) {
      const h = document.createElement('span');
      h.className = 'hint';
      h.textContent = 'Star a bind to pin it';
      fav.appendChild(h);
    } else for (const b of pins) fav.appendChild(pinChip(b));
    list.replaceChildren();
    if (bindErr) list.appendChild(noteEl('Live keybinds unavailable'));
    let shown = 0;
    const rec = recIds.map(id => byId.get(id)).filter(b => b && match(b));
    if (rec.length) { list.appendChild(groupEl('Recent', rec, favIds)); shown += rec.length }
    for (const g of GROUPS) {
      const rows = binds.filter(b => b.group === g && match(b));
      if (!rows.length) continue;
      list.appendChild(groupEl(g, rows, favIds));
      shown += rows.length;
    }
    if (!shown) list.appendChild(noteEl(q ? 'No matching binds' : 'No keybinds'));
  }
  async function loadBinds() {
    const gen = ++bindGen, t = target;
    bindErr = '';
    try {
      const r = await fetch('/api/pad-binds?target=' + encodeURIComponent(t), { credentials: 'same-origin' });
      if (!r.ok) throw new Error('http');
      const j = await r.json();
      if (gen !== bindGen) return;
      if (j.os === 'macos' || j.os === 'linux') { os = j.os; syncSuper() }
      const list = Array.isArray(j.binds) ? j.binds.filter(acceptBind) : [];
      bindErr = j.error ? 'unavailable' : '';
      binds = list.length ? list : (linuxTarget(t) ? clipboardRows() : macBinds().filter(acceptBind));
      if (!list.length && !linuxTarget(t)) bindErr = j.error ? 'unavailable' : '';
    } catch (e) {
      if (gen !== bindGen) return;
      bindErr = 'unavailable';
      binds = linuxTarget(t) ? clipboardRows() : macBinds().filter(acceptBind);
    }
    paintBinds();
  }
  const kbq = $('#kbq');
  if (kbq) {
    kbq.addEventListener('input', () => { query = kbq.value; paintBinds() });
    kbq.addEventListener('keydown', e => e.stopPropagation());
    kbq.addEventListener('pointerdown', e => e.stopPropagation());
  }
  migrateStore(localStorage);

  // ---------- keyboard field: diff the field so Gboard autocorrect and swipe typing work ----------
  let prev = SENT, composing = false;
  function reset() { kin.value = SENT; prev = SENT; try { kin.setSelectionRange(SENT.length, SENT.length) } catch (e) {} }
  reset();
  kin.value = ''; // empty while unfocused so the placeholder shows; sentinel only while typing
  kin.addEventListener('blur', () => { kin.value = ''; prev = '' });
  kin.addEventListener('focus', () => { reset(); setTimeout(() => kin.scrollIntoView({ block: 'nearest' }), 250) });
  kin.addEventListener('compositionstart', () => { composing = true });
  kin.addEventListener('compositionend', () => { composing = false; if (kin.value.length > 48) reset() });
  kin.addEventListener('input', () => {
    const d = diff(prev, kin.value);
    prev = kin.value;
    for (let i = 0; i < d.bs; i++) key('backspace');
    if (d.ins) {
      for (const p of d.ins.split(/(\n)/)) {
        if (!p) continue;
        if (p === '\n') { key('enter'); continue }
        for (const c of chunks(p, 200)) out.push(chord(c, mods.size ? useMods() : []));
      }
    }
    if (!composing && (!kin.value.startsWith(SENT) || kin.value.length > 48)) reset();
  });
  kin.addEventListener('keydown', e => {
    const map = { Enter: 'enter', Tab: 'tab', Escape: 'esc', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (map[e.key]) { e.preventDefault(); key(map[e.key]) }
    else if (e.key === 'Backspace' && kin.value.length <= SENT.length) { e.preventDefault(); key('backspace') }
  });

  // ---------- lifecycle: the agent runs while the Pad tab is on screen (Pad or Keys, as before the v3 shell), never in TV view ----------
  // The shell tells the page registry when a route comes and goes. Leaving the Pad tab lets the link go after 8 s, so a quick look at
  // another tab and back keeps it. The guest deck reaches the Pad too (guest: true).
  let vis = false, hideT = 0;
  function visible() { return vis && !document.hidden && !onTv() }
  // the Pad fills the height left under the header: CSS reads --pad-top (the trackpad's distance from the top of the document)
  function fit() {
    if (!padpg.offsetParent) return;
    padpg.style.setProperty('--pad-top', Math.round(padpg.getBoundingClientRect().top + scrollY) + 'px');
  }
  function sync() {
    clearTimeout(hideT);
    if (visible()) { fit(); if (!ws) connect() }
    else { stopAll(); hideT = setTimeout(() => { if (!visible()) disconnect() }, 8000) }
  }
  addEventListener('resize', fit);
  document.addEventListener('deck:class', sync);
  document.addEventListener('visibilitychange', sync);
  addEventListener('pagehide', () => { stopAll(); disconnect() });
  setTarget(target);
  const life = { guest: true, show() { vis = true; requestAnimationFrame(sync) }, hide() { vis = false; sync() } };
  DeckPages.register('pad/pad', life);
  DeckPages.hook('pad/keys', life);
})();
