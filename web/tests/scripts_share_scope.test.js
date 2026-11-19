// node --test tests/scripts_share_scope.test.js
// Every classic script a page loads shares ONE global scope with the others. A name declared at top level by two of them (const or let, or
// either beside a function) is a SyntaxError that stops the later file entirely: the deck loads with no pages, tabs or taps. The list is read
// from index.html and cre.html in their own order (row C7: the old list held 3 of 16 scripts), so a new script is checked the day it is linked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const STATIC = path.join(__dirname, '../static');
const scriptsOf = (page) => [...fs.readFileSync(path.join(STATIC, page), 'utf8').matchAll(/<script[^>]*\ssrc="\/([^"?#]+)"/g)].map((m) => m[1]);

for (const page of ['index.html', 'cre.html']) {
  test(page + ': every script it loads parses alone and together, in its order, as one global scope', () => {
    const names = scriptsOf(page);
    assert.ok(names.length >= (page === 'index.html' ? 15 : 3), page + ' loads ' + names.length + ' scripts');
    assert.ok(names.includes('ui-core.js'), 'the shared helpers are in the list');
    const files = names.map((f) => [f, fs.readFileSync(path.join(STATIC, f), 'utf8')]);
    for (const [f, src] of files) assert.doesNotThrow(() => new vm.Script(src, { filename: f }), f + ' parses alone');
    // sequential classic scripts share the global lexical scope: one script made of all of them reports a redeclared const or let
    assert.doesNotThrow(() => new vm.Script(files.map(([, s]) => s).join('\n;\n')), page + ': two scripts declare the same top-level name');
  });
}

test('the check catches a name two scripts declare', () => {
  const names = scriptsOf('index.html'), last = names[names.length - 1];
  const files = names.map((f) => fs.readFileSync(path.join(STATIC, f), 'utf8'));
  // ui-core.js declares DeckCore; a later script that declares it again stops at load
  assert.throws(() => new vm.Script(files.join('\n;\n') + '\n;\nconst DeckCore=1;'), /has already been declared/, 'after ' + last);
});
