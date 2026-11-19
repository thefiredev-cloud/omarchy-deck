'use strict';
// Regressions from the web polish, kept on the design v3 stylesheets (tokens.css, ui.css, app.css, css/*.css): no section
// eyebrows, one container level, the shell's reserved corner stays empty and the fullscreen button hides inside the
// OmarchyDeck shell, one status pill, red only for failures.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = strip(read('tokens.css')), ui = strip(read('ui.css')), app = strip(read('app.css'));
const pages = fs.readdirSync(path.join(__dirname, '..', 'static', 'css')).filter((f) => f.endsWith('.css')).map((f) => [f, strip(read('css/' + f))]);
const appJs = read('app.js');
const rules = (src) => [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/^@[^{]*\{/, ''), body: m[2] }));

test('no section eyebrow: the shell, components and app styles set nothing in capitals or tracked out; section titles use the title step', () => {
  // css/work.css still holds the old Life jobs labels until its lane rewrites it
  for (const [name, src] of [['tokens.css', tokens], ['ui.css', ui], ['app.css', app], ...pages.filter(([f]) => f !== 'work.css')]) {
    assert.doesNotMatch(src.replace(/::first-letter\{[^}]*\}/g, ''), /text-transform:\s*uppercase/, name);
    assert.doesNotMatch(src, /letter-spacing:\s*\.0[4-9]em/, name);
  }
  for (const sel of ['.secttl']) assert.match(rules(ui).find((r) => r.sel === sel).body, /font-size:var\(--fs-title\)/, sel);
  assert.doesNotMatch(appJs, /class="eyebrow|class="kicker/);
});

test('one container level: a disclosure that groups sections has no card class, and no row paints its own wash inside a list', () => {
  assert.doesNotMatch(appJs, /<details class="tcard"/);
  for (const r of rules(ui + app)) if (/(^|,)\s*(\.tgroup|details\.tgroup)\s*(,|$)/.test(r.sel)) assert.doesNotMatch(r.body, /(^|;)\s*(background(-color)?|box-shadow)\s*:/);
  for (const r of rules(ui + app)) if (/(^|,)\s*(a|\.tsec|#needl)?\s*\.frow(\.[\w-]+)*\s*(,|$)/.test(r.sel) && !/\.(err|es)\b/.test(r.sel)) assert.doesNotMatch(r.body, /(^|;)\s*background(-color)?\s*:/, r.sel);
  assert.doesNotMatch(ui + app, /(^|[\s,}])(a)?\.hl[\s,{:]/);
});

test('the shell corner: --shell-reserve-top-right keeps the top-right square empty on the top bar, the page header and sheets', () => {
  assert.match(tokens, /--reserve:var\(--shell-reserve-top-right,0px\)/);
  // the right edge keeps the page margin (--s-4) clear of the corner: with --s-3 the clock sat 4 px inside it (L18, 2026-11-17)
  assert.match(rules(ui).find((r) => r.sel === '#top').body, /padding:var\(--safe-t\) calc\(var\(--s-4\) \+ var\(--reserve\) \+ var\(--safe-r\)\)/);
  assert.match(rules(ui).find((r) => r.sel === '.phead').body, /padding:[^;]*var\(--reserve\)/);
  const clock = rules(ui).find((r) => r.sel === '#clock');
  assert.match(clock.body, /font-family:var\(--mono\)/);
  assert.match(clock.body, /white-space:nowrap/);
});

// The fullscreen block of app.js, run against a fake document: the OmarchyDeck user agent hides the button and requests nothing.
function fullscreenBlock(ua, fsEnabled) {
  const src = appJs.slice(appJs.indexOf('const IN_SHELL='), appJs.indexOf('async function goFull'));
  const classes = new Set();
  const document = { fullscreenEnabled: fsEnabled, documentElement: { requestFullscreen() {}, classList: { add: (c) => classes.add(c) } } };
  const r = new Function('navigator', 'document', src + '\nreturn {IN_SHELL,canFS};')({ userAgent: ua }, document);
  return { ...r, classes };
}
test('the fullscreen button hides inside the OmarchyDeck shell and stays on other browsers that can go fullscreen', () => {
  const shell = fullscreenBlock('Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 OmarchyDeck/1.0', true);
  assert.equal(shell.IN_SHELL, true);
  assert.equal(shell.canFS, false);
  assert.ok(shell.classes.has('nofs'));
  const pixel = fullscreenBlock('Mozilla/5.0 (Linux; Android 16; Pixel 10a) AppleWebKit/537.36 Chrome/150 Mobile Safari/537.36', true);
  assert.equal(pixel.canFS, true);
  assert.equal(pixel.classes.has('nofs'), false);
  assert.match(ui, /\.nofs #fs\{display:none\}/);
});

test('one status pill; red only marks a failure; the bar status is one mark and one word that never wraps', () => {
  assert.equal(rules(ui).filter((r) => r.sel === '.pill').length, 1);
  assert.match(ui, /\.pill\.bad\{background:var\(--c-bad-wash\)/);
  assert.match(ui, /\.pill\.wait\{background:var\(--c-signal-wash\)/);
  assert.doesNotMatch(ui + app, /\.pill[^{]*\.sv-high[^{]*\{[^}]*--(c-)?bad/);
  const st = rules(ui).find((r) => r.sel === '#status').body;
  assert.match(st, /max-width:9rem/);
  assert.match(st, /white-space:nowrap/);
  assert.match(ui, /#top\{flex-wrap:nowrap\}/);
});
