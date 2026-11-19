'use strict';
// Design v3 foundation wiring: every static file the deck links is cached by the service worker, embedded in the
// binary and served before auth with the right type, no stylesheet reaches off-origin, and the page stubs are safe
// to load before or without the page registry.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('static/index.html');
const sw = read('static/sw.js');
const main = read('rust/src/main.rs');

const PAGES_CSS = ['today', 'home', 'homeops', 'realestate', 'commercial', 'markets', 'surf', 'shop', 'money', 'work', 'pad', 'world'];
const STUBS = { realestate: 'realestate/residential', commercial: 'realestate/commercial', surf: 'surf', shop: 'shop/market', world: 'world' };
const NEW_FILES = [
  ['/tokens.css', 'text/css'],
  ['/ui.css', 'text/css'],
  ...PAGES_CSS.map((p) => [`/css/${p}.css`, 'text/css']),
  ...Object.keys(STUBS).map((p) => [`/pages/${p}.js`, 'text/javascript']),
  ['/fonts/Geist-Variable.woff2', 'font/woff2'],
  ['/fonts/GeistMono-Variable.woff2', 'font/woff2'],
];
const shellList = () => {
  const m = sw.match(/SHELL=\[([^\]]*)\]/);
  assert.ok(m, 'sw.js declares SHELL');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

test('every new static file exists, is in the service worker SHELL, embedded, and in the public match with its type', () => {
  const shell = shellList();
  for (const [url, ct] of NEW_FILES) {
    const rel = 'static' + url;
    assert.ok(fs.existsSync(path.join(ROOT, rel)), rel + ' exists');
    assert.ok(shell.includes(url), url + ' is in SHELL');
    const inc = main.match(new RegExp(`static (\\w+): &\\[u8\\] = include_bytes!\\("\\.\\./\\.\\./${rel.replace(/[./]/g, '\\$&')}"\\);`));
    assert.ok(inc, rel + ' is embedded');
    assert.match(main, new RegExp(`"${url.replace(/[./]/g, '\\$&')}" => Some\\(\\(${inc[1]}, "${ct.replace('/', '\\/')}"\\)\\)`), url + ' is public as ' + ct);
  }
  assert.equal(new Set(shell).size, shell.length, 'no duplicate SHELL entries');
});

test('everything index.html and cre.html link from the same origin is in SHELL, so an installed deck never mixes versions', () => {
  const shell = shellList();
  for (const page of ['static/index.html', 'static/cre.html']) {
    const src = read(page);
    // every script, no exception: a cached script beside a fresh one is a mixed shell
    const scripts = [...src.matchAll(/<script[^>]*\ssrc="(\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(scripts.length > 0, page + ' loads scripts');
    for (const s of scripts) assert.ok(shell.includes(s), `${page}: ${s} is in SHELL`);
    const links = [...src.matchAll(/<link[^>]*href="(\/[^"]+)"/g)].map((m) => m[1]);
    for (const r of links) if (!/^\/(icon|apple-touch-icon|manifest)/.test(r)) assert.ok(shell.includes(r), `${page}: ${r} is in SHELL`);
  }
});

test('SHELL caches only what exists: every entry but the page itself is a file under static/', () => {
  // /theme.css left the shell when the deck stopped following the desktop theme (DESIGN.md decision 5); the route stays in the server
  for (const u of shellList()) if (u !== '/') assert.ok(fs.existsSync(path.join(ROOT, 'static', u)), u + ' is a file under static/');
  assert.ok(!shellList().includes('/theme.css'));
  assert.doesNotMatch(html, /theme\.css/);
});

test('the eleven page stylesheets are linked once each, after the inline shell styles, in a fixed order', () => {
  const links = [...html.matchAll(/<link rel="stylesheet" href="\/css\/([a-z]+)\.css">/g)].map((m) => m[1]);
  assert.deepEqual(links, PAGES_CSS);
  assert.ok(html.indexOf('/css/today.css') > html.lastIndexOf('</style>'), 'page files load after the inline legacy styles');
  assert.ok(html.indexOf('/css/pad.css') < html.indexOf('</head>'));
});

test('no stylesheet reaches off-origin and no data: or blob: asset is used', () => {
  for (const f of ['static/tokens.css', 'static/ui.css', ...PAGES_CSS.map((p) => `static/css/${p}.css`)]) {
    const css = read(f);
    for (const m of css.matchAll(/url\(\s*["']?([^"')]+)/g)) assert.match(m[1], /^\/[^/]/, `${f}: ${m[1]} is a same-origin absolute path`);
    assert.doesNotMatch(css, /@import|data:|blob:/, f);
  }
  for (const m of read('static/tokens.css').matchAll(/url\("([^"]+)"\)/g)) assert.ok(fs.existsSync(path.join(ROOT, 'static', m[1])), m[1] + ' is shipped');
});

test('page stubs load without the registry and register a route that never claims it', () => {
  // a page lane replaces its stub with the real module; only files still marked as the foundation stub are checked here
  for (const [file, route] of Object.entries(STUBS)) {
    const src = read(`static/pages/${file}.js`);
    if (!/page stub from the design v3 foundation/.test(src.split('\n')[0])) continue;
    assert.doesNotThrow(() => vm.runInNewContext(src, {}), file + ' loads before deck.js has a registry');
    const seen = [];
    vm.runInNewContext(src, { DeckPages: { register: (r, page) => seen.push([r, page]) } });
    assert.equal(seen.length, 1, file + ' registers once');
    assert.equal(seen[0][0], route);
    assert.equal(typeof seen[0][1].show, 'undefined', 'a stub has no show(), so the old page keeps its route');
  }
  const deck = html.indexOf('<script src="/deck.js">');
  for (const file of Object.keys(STUBS)) assert.ok(html.indexOf(`<script src="/pages/${file}.js">`) > deck, file + ' loads after deck.js');
});

test('fonts are real woff2 files and are not gzip-compressed by the server', () => {
  for (const f of ['Geist-Variable', 'GeistMono-Variable']) {
    const b = fs.readFileSync(path.join(ROOT, 'static/fonts', f + '.woff2'));
    assert.equal(b.subarray(0, 4).toString('latin1'), 'wOF2', f);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'static/fonts/OFL-Geist.txt')), 'the font licence ships beside the fonts');
  assert.ok(!shellList().includes('/fonts/OFL-Geist.txt'));
  assert.doesNotMatch(read('rust/src/compress.rs').match(/fn compressible[\s\S]*?\n}/)[0], /font/);
});
