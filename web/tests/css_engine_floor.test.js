'use strict';
// One engine floor for every stylesheet. The owner's bedroom TV runs SamsungBrowser 5 on Chrome 108 (Tizen 6.5).
// Chrome 108 drops a declaration whose value it cannot parse, a whole rule whose selector it cannot parse, and an
// at-rule it does not know. A declaration that holds var() always parses, so it wins the cascade and then fails at
// computed time: the property becomes unset, it does not fall back to an earlier plain declaration. A custom property
// holding a newer value is invalid wherever it is used. So a newer value passes only when the same rule has a plain
// declaration of that property before it, the newer one holds no var(), and the property is not a custom property.
// Checked: every .css file under static/, plus <style> blocks and style="" attributes in static/*.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STATIC = path.join(__dirname, '..', 'static');

// value features newer than Chrome 108, with the version that brought them
const VALUES = [
  [/color-mix\(/, 'color-mix() (111)'],
  [/(?<![\w-])(?:ok)?(?:lab|lch)\(/, 'lab/lch/oklab/oklch() (111)'],
  [/(?<![\w-])color\(/, 'color() (111)'],
  [/(?<![\w-])light-dark\(/, 'light-dark() (123)'],
  [/(?<![\w-])(?:rgba?|hsla?|hwb|(?:ok)?lab|(?:ok)?lch|color)\(\s*from\s/, 'relative colour syntax (119)'],
  [/(?<![\w-])(?:sin|cos|tan|asin|acos|atan2?)\(/, 'trig function (111)'],
  [/(?<![\w-])(?:round|mod|rem|pow|sqrt|hypot|log|exp|abs|sign)\(/, 'stepped or exponential function (120 and later)'],
  [/(?<![\w.-])\d*\.?\d+r?lh\b/, 'lh or rlh unit (109, 111)'],
  [/\bsubgrid\b/, 'subgrid (117)'],
];
// at-rules and container style queries Chrome 108 drops whole
const AT = [
  [/@scope\b/, '@scope (118)'],
  [/@starting-style\b/, '@starting-style (117)'],
  [/@container[^{]*\bstyle\(/, '@container style() query (111)'],
];

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// a "{" that opens inside a style rule is nesting (Chrome 112); at-rules (@media, @container, @supports, @font-face) may hold rules
function nested(css) {
  const stack = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      const head = css.slice(start, i).trim();
      if (stack.length && stack[stack.length - 1] === 'rule') return head;
      stack.push(head.startsWith('@') ? 'at' : 'rule');
      start = i + 1;
    } else if (css[i] === '}' || css[i] === ';') {
      if (css[i] === '}') stack.pop();
      start = i + 1;
    }
  }
  return null;
}

// declarations split on ";" outside parentheses and quotes
function split(body) {
  const out = [];
  let depth = 0, quote = '', cur = '';
  for (const ch of body) {
    if (quote) { if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

const newer = (value) => VALUES.find(([re]) => re.test(value));
const parts = (d) => { const c = d.indexOf(':'); return c < 0 ? null : [d.slice(0, c).trim(), d.slice(c + 1)]; };

function checkBody(sel, body, out) {
  const decls = split(body);
  decls.forEach((d, i) => {
    const p = parts(d);
    if (!p) return;
    const [prop, value] = p;
    const hit = newer(value);
    if (!hit) return;
    const plainBefore = !prop.startsWith('--') && !/var\(/.test(value) && decls.slice(0, i).some((x) => {
      const q = parts(x);
      return q && q[0] === prop && !newer(q[1]);
    });
    if (!plainBefore) out.push(`${sel} { ${prop}: ${hit[1]} }`);
  });
}

function findings(raw) {
  const css = strip(raw);
  const out = [];
  const n = nested(css);
  if (n) out.push('nested rule: ' + n);
  if (/(?:^|[{};,\s])&/.test(css)) out.push('nesting selector & (112)');
  for (const [re, what] of AT) if (re.test(css)) out.push(what);
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (/:nth-(?:last-)?child\([^)]*\sof\s/.test(sel)) out.push(sel + ': :nth-child(... of S) (111)');
    checkBody(sel, m[2], out);
  }
  return out;
}

function stylesheets() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.css')) out.push([path.relative(STATIC, f), fs.readFileSync(f, 'utf8')]);
      else if (e.name.endsWith('.html')) {
        const html = fs.readFileSync(f, 'utf8');
        const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
        const attrs = [...html.matchAll(/\sstyle="([^"]*)"/g)].map((m) => '[style]{' + m[1] + '}');
        out.push([path.relative(STATIC, f), blocks.concat(attrs).join('\n')]);
      }
    }
  };
  walk(STATIC);
  return out;
}

test('the checker sees what Chrome 108 drops, and lets a working fallback through', () => {
  assert.deepEqual(findings('.a{color:red;color:color-mix(in srgb,red 50%,blue)}'), [], 'plain fallback first');
  assert.equal(findings('.a{color:color-mix(in srgb,red 50%,blue)}').length, 1, 'no fallback');
  assert.equal(findings('.a{color:color-mix(in srgb,red 50%,blue);color:red}').length, 1, 'fallback after it');
  assert.equal(findings('.a{color:red;color:color-mix(in srgb,var(--x) 50%,blue)}').length, 1, 'var() wins the cascade, then fails');
  assert.equal(findings(':root{--x:#000;--x:oklch(50% .1 20)}').length, 1, 'a custom property never has a fallback');
  assert.equal(findings('.a{background:#000;background:color(display-p3 1 0 0)}').length, 0);
  assert.equal(findings('.a{background-color:color(display-p3 1 0 0)}').length, 1);
  assert.equal(findings('.a{color:rgb(from red r g b / .5)}').length, 1, 'relative colour');
  assert.equal(findings('.a{color:light-dark(#000,#fff)}').length, 1);
  assert.equal(findings('.a{rotate:calc(sin(30deg) * 1turn)}').length, 1, 'trig');
  assert.equal(findings('.a{width:round(up,10px,3px)}').length, 1, 'stepped value');
  assert.equal(findings('.a{height:2lh}').length, 1, 'lh unit');
  assert.equal(findings('.a{grid-template-rows:subgrid}').length, 1);
  assert.equal(findings('li:nth-child(2 of .x){color:red}').length, 1);
  assert.equal(findings('@scope (.a){.b{color:red}}').length, 1);
  assert.equal(findings('@starting-style{.a{opacity:0}}').length, 1);
  assert.equal(findings('@container style(--x:1){.a{color:red}}').length, 1);
  assert.equal(findings('.a{color:red;.b{color:blue}}').length, 1, 'nesting');
  assert.equal(findings('.a{color:red}&.b{color:blue}').length, 1, 'nesting selector');
  assert.deepEqual(findings('@media (min-width:1px){.a{color:red}}@font-face{font-family:x}'), [], 'at-rules may hold rules');
  assert.deepEqual(findings('.a{font-size:var(--fs-sm);margin:1rem;width:calc(100% - 2rem);color:#F1EFEA1F}'), [], 'rem, calc, 8-digit hex');
  assert.deepEqual(findings('.a{background:url("x;y.png");color:red}'), [], 'a ; inside quotes');
});

test('every stylesheet under static/ stays inside Chrome 108', () => {
  const sheets = stylesheets();
  const names = sheets.map(([n]) => n);
  for (const f of ['tokens.css', 'ui.css', 'app.css', 'tv.css', 'login.html', 'index.html', 'cre.html', path.join('css', 'home.css')]) {
    assert.ok(names.includes(f), 'scanned ' + f);
  }
  assert.ok(names.filter((n) => n.endsWith('.css')).length >= 14, 'every .css file: ' + names.join(' '));
  const bad = [];
  for (const [name, css] of sheets) for (const f of findings(css)) bad.push(name + ': ' + f);
  assert.deepEqual(bad, []);
});

// Chrome 108 ignores scrollbar-width and scrollbar-color (Chrome 121) and draws its default 15 px bar: on Today at 1536 the page
// lost 15 px of width. Every selector that sets either one also has a ::-webkit-scrollbar rule, which 108 reads and 121+ skips.
function unbackedScrollbars(css) {
  const set = [], backed = new Set();
  for (const m of strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const parts = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    for (const p of parts) if (/::-webkit-scrollbar$/.test(p)) backed.add(p.replace(/::-webkit-scrollbar$/, ''));
    if (/(?:^|;)\s*scrollbar-(?:width|color)\s*:/.test(m[2])) set.push(...parts);
  }
  return [...new Set(set)].filter((p) => !backed.has(p));
}

test('every selector that sets scrollbar-width or scrollbar-color has a ::-webkit-scrollbar rule for Chrome 108', () => {
  assert.deepEqual(unbackedScrollbars('.a{overflow:auto;scrollbar-width:none}'), ['.a']);
  assert.deepEqual(unbackedScrollbars('.a,.b{scrollbar-width:none}.a::-webkit-scrollbar{display:none}'), ['.b']);
  assert.deepEqual(unbackedScrollbars('@media (x){.a{scrollbar-width:thin}}.a::-webkit-scrollbar{width:8px}'), []);
  const all = stylesheets().filter(([n]) => n.endsWith('.css')).map(([, css]) => css).join('\n');
  assert.deepEqual(unbackedScrollbars(all), []);
});
