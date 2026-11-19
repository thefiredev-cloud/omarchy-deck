'use strict';
// Contracts the shared stylesheet keeps (plan/design/CRITIQUE.md, DESIGN-v3 sections 3 and 8): 12 px text only for the
// phone state map codes (the under-12 px floor and the no-uppercase rule live in shell_core and web_polish), and one
// sheet width per device class through the --sheet-w token, with .wide only for a sheet that holds a sideways-scrolling table.
// The Chrome 108 engine floor for every stylesheet is tests/css_engine_floor.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const UI = read('static/ui.css');
const TOKENS = read('static/tokens.css');

// innermost rules: [selector, declarations]; the enclosing @media or @container text is not needed for these checks
const rules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
const decl = (body, prop) => [...body.matchAll(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'g'))].map((m) => m[1].trim());

test('no font size under 12 px, and 12 px only on the state map codes', () => {
  for (const [sel, body] of rules(UI + TOKENS)) {
    for (const v of decl(body, 'font-size').concat(decl(body, '--fs-[a-z]+'))) {
      for (const px of v.matchAll(/(\d+(?:\.\d+)?)px/g)) {
        const n = +px[1];
        assert.ok(n >= 12, `${sel}: font size ${v} is under 12 px`);
        if (n < 13 && !/calc|clamp|max|min/.test(v)) assert.match(sel, /\.usmap/, `${sel}: 12 px text outside the state map`);
      }
    }
  }
});

test('one sheet width token per device class, used by every sheet', () => {
  assert.match(TOKENS, /:root\{[^}]*--sheet-w:/, 'the token has a default');
  const desk = TOKENS.match(/@media \(min-width:1100px\) and \(min-height:500px\)\{:root\{([^}]*)\}\}/);
  assert.ok(desk && /--sheet-w:/.test(desk[1]), 'D sets its own sheet width');
  let used = 0;
  for (const [sel, body] of rules(UI)) {
    // only rules whose subject is the sheet itself (dialog.sheet… or #sheetp…), not a descendant like its grab handle
    if (!sel.split(',').some((s) => /(?:^|\s)(?:dialog\.sheet|#sheetp)[^\s>+~]*$/.test(s.trim()))) continue;
    for (const w of decl(body, 'width')) {
      if (/var\(--sheet-w\)/.test(w)) { used++; continue; }
      if (/fbar-panel/.test(sel) && w === 'auto') continue; // the inline filter panel on D is not a sheet
      assert.match(sel, /\.wide:has\(\.htw\.scroll\)/, `${sel}: width ${w} bypasses --sheet-w`);
    }
  }
  assert.ok(used >= 2, 'dialog.sheet and #sheetp take var(--sheet-w)');
  assert.doesNotMatch(UI, /dialog\.sheet\.wide\s*\{/, '.wide alone never widens a sheet');
});
