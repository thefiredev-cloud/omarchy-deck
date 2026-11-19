// Sign-in page (static/login.html): what the owner sees on a device with no deck cookie.
// Baseline problem 34 (2026-11-14): it said "Pixel Deck". It must say Omarchy Deck, use v3 tokens and Geist, an 18 px field,
// plain error words, no source text, and on TV a large field with a note that the ?t= link signs in once.
// How sign-in works does not change: a GET form to / with the token in t (main.rs serves this page for a 401 on GET /).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const page = read('login.html');
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const style = (page.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const visibleText = page.replace(/<script>[\s\S]*?<\/script>|<style>[\s\S]*?<\/style>|<head>[\s\S]*?<\/head>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Run the page's two inline scripts against a small fake document at a given address.
function load(search, stored) {
  const cls = new Set(), err = { hidden: true }, added = [], urls = [];
  const form = { appendChild: (el) => added.push(el) };
  const doc = {
    documentElement: { classList: { add: (c) => cls.add(c) } },
    forms: [form],
    getElementById: (id) => (id === 'err' ? err : null),
    createElement: () => ({}),
  };
  const ctx = {
    URLSearchParams, document: doc,
    location: { search, pathname: '/', hash: '' },
    localStorage: { getItem: (k) => (stored && k in stored ? stored[k] : null) },
    history: { replaceState: (_s, _t, u) => urls.push(u) },
  };
  vm.createContext(ctx);
  for (const s of scripts) vm.runInContext(s, ctx);
  return { tv: cls.has('tv'), err: !err.hidden, urls, added };
}

test('the page names the product Omarchy Deck, never Pixel Deck', () => {
  assert.match(page, /<title>Omarchy Deck sign in<\/title>/);
  assert.match(page, /<h1>Omarchy Deck<\/h1>/);
  assert.doesNotMatch(page, /Pixel Deck/i);
});

test('sign-in itself is unchanged: a GET form to / that sends the token as t', () => {
  assert.match(page, /^<!doctype html><html lang="en"><head>/);
  assert.match(page, /<form method="get" action="\/"/);
  assert.match(page, /<input id="t" name="t" type="password"[^>]*required minlength="8"/);
  assert.match(page, /viewport-fit=cover/);
});

test('a token that did not match shows the plain error and leaves the address bar', () => {
  const bad = load('?t=wrong-token-123');
  assert.equal(bad.err, true, 'the error line shows');
  assert.deepEqual(bad.urls, ['/'], 'the token is taken out of the address');
  assert.match(page, /That token did not work\./);
  const first = load('');
  assert.equal(first.err, false, 'a first visit shows no error');
  assert.deepEqual(first.urls, []);
});

test('TV view is opt-in: ?view=tv or the stored switch, never the user agent alone', () => {
  assert.equal(load('?view=tv').tv, true);
  assert.equal(load('', { view: 'tv' }).tv, true);
  assert.equal(load('').tv, false);
  assert.doesNotMatch(scripts.join('\n'), /userAgent/);
});

test('a TV keeps view=tv through the sign-in, and a bad token on a TV keeps the TV view in the address', () => {
  const r = load('?t=nope-nope-nope&view=tv');
  assert.equal(r.tv, true);
  assert.equal(r.err, true);
  assert.deepEqual(r.urls, ['/?view=tv']);
  assert.equal(r.added.length, 1);
  assert.deepEqual({ type: r.added[0].type, name: r.added[0].name, value: r.added[0].value }, { type: 'hidden', name: 'view', value: 'tv' });
  assert.equal(load('?view=tv').added.length, 1);
  assert.equal(load('').added.length, 0, 'other devices send only the token');
});

test('TV: a large field and the one-time link note, hidden elsewhere', () => {
  assert.match(page, /<p class="tvnote">You can also open your deck link with <code>\?t=<\/code> once\. This TV stays signed in after that\.<\/p>/);
  assert.match(style, /\.tvnote\{display:none\}|\.err\[hidden\],\.tvnote\{display:none\}/);
  assert.match(style, /html\.tv \.tvnote\{display:block/);
  assert.match(style, /html\.tv input,html\.tv button\{[^}]*font-size:var\(--fs-title\)/);
});

test('an 18 px field and Geist through the v3 tokens', () => {
  assert.match(style, /(^|\n)input\{[^}]*font-size:18px/);
  assert.match(page, /<link rel="stylesheet" href="\/tokens\.css">/);
  assert.match(page, /<link rel="preload" href="\/fonts\/Geist-Variable\.woff2" as="font" type="font\/woff2" crossorigin>/);
  assert.match(style, /font:var\(--fw-reg\) var\(--fs-body\)\/var\(--lh-body\) var\(--font\)/);
  // every token the page uses is defined in tokens.css
  const tokens = read('tokens.css');
  for (const [, name] of style.matchAll(/var\((--[a-z0-9-]+)/g)) assert.match(tokens, new RegExp(name + ':'), `${name} is a v3 token`);
});

test('same-origin assets only, no source text, no capitals with tracking', () => {
  for (const [, u] of page.matchAll(/(?:href|src)="([^"]+)"/g)) assert.match(u, /^\/[^/]/, `${u} is same origin`);
  assert.doesNotMatch(page, /url\(|data:|blob:|https?:\/\//);
  assert.doesNotMatch(style, /letter-spacing:\s*\.?[0-9]*[1-9]|text-transform/);
  assert.doesNotMatch(visibleText, /source|updated|as of|\.json|cookie/i);
  assert.doesNotMatch(page, /\u2014/, 'no em dash');
});
