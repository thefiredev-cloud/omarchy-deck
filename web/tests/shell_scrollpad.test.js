'use strict';
// P: a section scrolled into view (Show fewer, DeckBalance.fewer, a #hash through waitHash) lands below the fixed top bar.
// The page head is static on a phone, so --sticky-top is 0 there; the phone rule clears the bar itself (LayoutP-3, 2026-11-15).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = fs.readFileSync(path.join(__dirname, '..', 'static', 'ui.css'), 'utf8');

test('phone portrait: scroll-padding clears the fixed top bar; every other class keeps the measured sticky head', () => {
  assert.match(ui, /\nhtml\{[^}]*scroll-padding-top:calc\(var\(--sticky-top\) \+ var\(--s-4\)\)\}/, 'the base rule (L, T, D, TV) is unchanged');
  assert.match(ui, /\n@media \(max-width:599px\)\{html\{scroll-padding-top:calc\(var\(--topbar-h\) \+ var\(--safe-t\) \+ var\(--s-4\)\)\}\}/);
  assert.match(ui, /#top\{position:fixed;[^}]*height:calc\(var\(--topbar-h\) \+ var\(--safe-t\)\)/, 'the same height the bar draws');
});
