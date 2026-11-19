'use strict';
// .flow columns: the space under a section is padding, not margin. WebKit (Safari and the iOS app's web view) keeps a bottom margin
// across a column break, so with margins the second and third columns started 17 to 24 px below the first on L, T and D (WebKit lane,
// 2026-11-15, WebKitGTK 2.54.1: Today and Home > Dev). Node cannot lay out columns, so this pins the rule that fixed it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ui = read('ui.css'), tv = read('tv.css');
const rules = (css, sel) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]);

test('a .flow section carries no vertical margin anywhere: padding makes the gap', () => {
  const base = rules(ui, '.flow>*').filter((b) => /break-inside:avoid/.test(b));
  assert.equal(base.length, 1, 'one base rule');
  assert.match(base[0], /margin:0(;|$)/);
  assert.match(base[0], /padding-bottom:var\(--gap\)/);
  for (const css of [ui, tv, read('app.css')]) {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/\.flow>\*/.test(m[1])) continue;
      assert.doesNotMatch(m[2], /margin(-top|-bottom)?:(?!0(;|$))/, m[1].trim() + ' sets a margin again');
    }
  }
});

test('TV keeps its own section spacing, and the board grid has none', () => {
  assert.match(rules(tv, 'html.tv .flow>*').join(';'), /padding-bottom:var\(--s-4\)/);
  assert.match(rules(tv, 'html.tv .board .flow>*').join(';'), /padding-bottom:0/);
});
