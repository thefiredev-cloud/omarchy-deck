require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const deck = fs.readFileSync(path.join(root, 'static/deck.js'), 'utf8');
const D = new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), deck.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const css = require('./shell_legacy_css.js')();
