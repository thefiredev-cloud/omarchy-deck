'use strict';
// require('./setup-core.js') before node:test, in every test that loads a deck script (plain `node --test tests/*.test.js` stays the gate).
// The page loads static/ui-core.js before every other script (index.html before app.js, cre.html before cre.js), so DeckCore is a global
// everywhere a deck script runs. Tests build their globals two ways, and both start with DeckCore here, so no loader line changes:
// 1. a slice run through new Function in this realm: DeckCore on globalThis;
// 2. a slice run in a vm context: each new context gets its own DeckCore, evaluated inside it (its Date, its RegExp), unless the sandbox
//    already brings one.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '../static/ui-core.js'), 'utf8');
// a function scope keeps the file's own `const DeckCore` out of the context's lexical scope, so a test may still load ui-core.js itself
const SEED = 'this.DeckCore=(()=>{' + SRC + '\nreturn DeckCore})();';
const seed = (ctx) => {
  if (!Object.prototype.hasOwnProperty.call(ctx, 'DeckCore')) vm.runInContext(SEED, ctx, { filename: 'ui-core.js' });
  return ctx;
};

globalThis.DeckCore = new Function(SRC + '\nreturn DeckCore;')();

const createContext = vm.createContext;
vm.createContext = function (sandbox, options) {
  return seed(createContext.call(this, sandbox, options));
};
const runInNewContext = vm.runInNewContext;
vm.runInNewContext = function (code, sandbox, options) {
  const box = sandbox === undefined ? {} : sandbox;
  if (box === null || typeof box !== 'object' || vm.isContext(box)) return runInNewContext.call(this, code, sandbox, options);
  const o = typeof options === 'object' && options ? options : {};
  vm.createContext(box, { name: o.contextName, origin: o.contextOrigin, codeGeneration: o.contextCodeGeneration, microtaskMode: o.microtaskMode });
  return vm.runInContext(code, box, typeof options === 'string' ? options : o);
};
