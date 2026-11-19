'use strict';
// Design v3 shell: the redirect table for old links and stored pages (PageBlueprints 1.1), device classes from size (1.2),
// page swipe, the eight tabs and the containers page lanes fill (UiApi 1.1), and the shell contracts the iOS app relies on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const app = read('app.js'), html = read('index.html');
const a = app.indexOf('// ==== SHELL CORE BEGIN'), b = app.indexOf('// ==== SHELL CORE END ====');
assert.ok(a > 0 && b > a, 'shell core markers');
const C = vm.runInNewContext(app.slice(a, b) + '\nShellCore', {});

test('old links and stored page names land on the new routes (PageBlueprints 1.1)', () => {
  const cases = {
    'markets/housing': 'realestate/residential', housing: 'realestate/residential',
    'markets/commercial': 'realestate/commercial', commercial: 'realestate/commercial',
    markets: 'money/markets', 'markets/markets': 'money/markets', invest: 'money/markets',
    'home/allcrons': 'home/crons?f=all', schedules: 'home/crons?f=all', crons: 'home/crons',
    'home/agents': 'home/launch#missions', agents: 'home/launch#missions',
    'shop/commerce': 'shop/orders', commerce: 'shop/orders', 'shop/shop': 'shop/market',
    life: 'work/jobs', 'life/life': 'work/jobs', jobs: 'work/jobs', 'life/gigs': 'work/gigs', gigs: 'work/gigs',
    fleet: 'home/fleet', cluster: 'home/cluster', dev: 'home/dev', launch: 'home/launch', keys: 'pad/keys', house: 'home/house',
    surf: 'surf', today: 'today', money: 'money', 'money/accounts': 'money/accounts', 'pad/pad': 'pad/pad',
    'realestate/residential?zip=92647': 'realestate/residential?zip=92647', '#fleet': 'home/fleet', '/Housing/': 'realestate/residential',
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(C.redirect(from), to, from);
  // a sub the tab does not have keeps the tab; something that names no page is empty, so the shell falls back to the stored page
  assert.equal(C.redirect('home/nope'), 'home');
  assert.equal(C.redirect('nope'), '');
  assert.equal(C.redirect(''), '');
  assert.equal(C.redirect(null), '');
});

// Which routes a static file registers with a real page (show or refresh), found without running the file: every
// DeckPages.register(route | [routes], page) call, where page is an object literal or the name of one declared in the same
// file. A stub ({} or only hide/data) and a page passed any other way do not count, so a route never passes by accident.
function liveRoutes(src) {
  const out = new Set();
  // the matching close of the bracket at i, skipping strings, template literals and comments
  const close = (s, i) => {
    const open = s[i], shut = { '{': '}', '(': ')', '[': ']' }[open]; let d = 0;
    for (let k = i; k < s.length; k++) {
      const ch = s[k];
      if (ch === '"' || ch === "'" || ch === '`') { for (k++; k < s.length && s[k] !== ch; k++) if (s[k] === '\\') k++; continue; }
      if (ch === '/' && s[k + 1] === '/') { k = s.indexOf('\n', k); if (k < 0) return -1; continue; }
      if (ch === '/' && s[k + 1] === '*') { k = s.indexOf('*/', k + 2) + 1; if (k <= 0) return -1; continue; }
      if (ch === open) d++; else if (ch === shut && --d === 0) return k;
    }
    return -1;
  };
  // top-level keys of an object literal: `show(`, `show:`, `async show(`
  const keys = (obj) => {
    const ks = new Set(); let d = 0;
    for (let k = 0; k < obj.length; k++) {
      const ch = obj[k];
      if (ch === '"' || ch === "'" || ch === '`') { for (k++; k < obj.length && obj[k] !== ch; k++) if (obj[k] === '\\') k++; continue; }
      if ('{(['.includes(ch)) { d++; continue; }
      if ('})]'.includes(ch)) { d--; continue; }
      if (d === 1) { const m = obj.slice(k).match(/^(?:async\s+)?([A-Za-z_$][\w$]*)\s*[(:]/); if (m && /[{,\s]/.test(obj[k - 1])) { ks.add(m[1]); k += m[0].length - 2; } }
    }
    return ks;
  };
  const objectNamed = (name) => { const m = new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*\\{').exec(src); if (!m) return null; const a = m.index + m[0].length - 1, b = close(src, a); return b < 0 ? null : src.slice(a, b + 1); };
  for (const m of src.matchAll(/DeckPages\.register\(/g)) {
    const a = m.index + m[0].length - 1, b = close(src, a); if (b < 0) continue;
    const args = src.slice(a + 1, b).trim();
    const r = args.match(/^(\[[^\]]*\]|'[^']*'|"[^"]*")\s*,\s*([\s\S]*)$/); if (!r) continue;
    const routes = [...r[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] || x[2]);
    let page = r[2].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(page)) page = objectNamed(page) || '';
    else if (page[0] === '{') { const e = close(page, 0); page = e < 0 ? '' : page.slice(0, e + 1); } else page = '';
    const ks = page ? keys(page) : new Set();
    if (ks.has('show') || ks.has('refresh')) routes.forEach((x) => out.add(x));
  }
  return out;
}

test('liveRoutes counts a real page and never a stub', () => {
  assert.deepEqual([...liveRoutes("DeckPages.register('surf',{show(ctx){if(a){b()}},hide(){}});")], ['surf']);
  assert.deepEqual([...liveRoutes("DeckPages.register(['shop/market','shop'],{ async refresh(c,t){} });")], ['shop/market', 'shop']);
  assert.deepEqual([...liveRoutes("const page={\n show:(ctx)=>paint(ctx),\n data(){return {}}};\nDeckPages.register('work/jobs', page);")], ['work/jobs']);
  assert.deepEqual([...liveRoutes("DeckPages.register('realestate/residential',{});")], [], 'a stub');
  assert.deepEqual([...liveRoutes("DeckPages.register('surf',{hide(){},data(){return {show:1}}});")], [], 'a show nested deeper is not the page');
  assert.deepEqual([...liveRoutes("DeckPages.register('surf',{every:9000,label:'show(me)'});")], [], 'a string is not a key');
  assert.deepEqual([...liveRoutes("DeckPages.register('surf',makePage());")], [], 'anything but an object literal or its name');
});

test('every old page leaf still has a painter under its new route until a page lane registers that route', () => {
  assert.deepEqual(Object.assign({}, C.LEGACY), { 'home/house': 'home', 'realestate/residential': 'housing', 'shop/market': 'shop', 'shop/orders': 'commerce', 'money/accounts': 'money', 'work/jobs': 'life' });
  const deck = read('deck.js');
  // a lane deletes its oldPage line only together with a real page (show or refresh) for the new route, in any static script
  const files = fs.readdirSync(path.join(__dirname, '..', 'static')).filter((f) => f.endsWith('.js')).concat(fs.readdirSync(path.join(__dirname, '..', 'static', 'pages')).filter((f) => f.endsWith('.js')).map((f) => 'pages/' + f));
  const live = new Set(files.flatMap((f) => [...liveRoutes(read(f))]));
  for (const [route, leaf] of Object.entries(C.LEGACY)) {
    if (live.has(route)) continue;
    assert.match(deck, new RegExp("oldPage\\((\\[[^\\]]*)?'" + leaf + "'"), leaf + ' is still an old page, or a page file registers ' + route + ' with show or refresh');
  }
});

test('a route hash is re-applied after the page paints it (#missions under Home > Launch)', () => {
  assert.match(app, /if\(hash\)waitHash\(hash\);/);
  assert.match(app, /function waitHash\(id\)\{clearTimeout\(hashT\);const until=Date.now\(\)\+4000;/);
  assert.match(app, /const step=\(\)=>\{if\(look\(\)\|\|Date\.now\(\)>until\)return;hashT=setTimeout\(step,250\)\}/);
});

test('device classes come from width, height and the TV switch, never orientation', () => {
  assert.equal(C.classOf(390, 844, false), 'P');
  assert.equal(C.classOf(430, 932, false), 'P');
  assert.equal(C.classOf(908, 411, false), 'L');
  assert.equal(C.classOf(932, 430, false), 'L');
  assert.equal(C.classOf(834, 1194, false), 'T');
  assert.equal(C.classOf(1099, 800, false), 'T');
  assert.equal(C.classOf(1100, 800, false), 'D');
  assert.equal(C.classOf(1366, 1024, false), 'D');
  assert.equal(C.classOf(1440, 900, false), 'D');
  assert.equal(C.classOf(1600, 900, false), 'XL');
  assert.equal(C.classOf(2560, 1440, false), 'XL');
  assert.equal(C.classOf(1920, 1080, true), 'TV');
  assert.equal(C.classOf(390, 844, true), 'TV');
  // the same rules as tokens.css
  const tokens = read('tokens.css');
  assert.match(tokens, /@media \(max-width:599px\)/);
  assert.match(tokens, /@media \(min-width:600px\) and \(max-height:499px\)/);
  assert.match(tokens, /@media \(min-width:1100px\) and \(min-height:500px\)/);
});

test('every route says its name in the document title (SeeAccess A3)', () => {
  assert.equal(C.pageTitle(['Surf']), 'Surf \u00B7 Deck');
  assert.equal(C.pageTitle(['Today']), 'Today \u00B7 Deck');
  assert.equal(C.pageTitle(['Real estate', 'Residential']), 'Real estate \u00B7 Residential \u00B7 Deck');
  assert.equal(C.pageTitle(['Home', 'Fleet']), 'Home \u00B7 Fleet \u00B7 Deck');
  assert.equal(C.pageTitle(['Pad', 'Pad']), 'Pad \u00B7 Deck', 'a sub named like its tab says it once');
  assert.equal(C.pageTitle([]), 'Deck');
  assert.equal(C.pageTitle(['', ' Surf ']), 'Surf \u00B7 Deck');
  // every route event sets it from the same words the sheet headers use
  assert.match(app, /document\.addEventListener\('deck:route',\(\)=>\{document\.title=ShellCore\.pageTitle\(routeLabel\(\)\.split\(' \\u00B7 '\)\)\}\);/);
  // and every page and sub-page resolves to a title with its own words: tab labels and sub-tab button text from index.html
  for (const m of html.matchAll(/<section class="page" id="pg-(\w+)" data-name="\w+" data-label="([^"]+)" hidden>\n<header class="phead">([^\n]*)<\/header>/g)) {
    const subs = [...m[3].matchAll(/data-sub="\w+" aria-selected="false">([^<]+)</g)].map((s) => s[1]);
    for (const s of subs.length ? subs : ['']) {
      const t = C.pageTitle([m[2], s]);
      assert.match(t, new RegExp('^' + m[2] + '( \u00B7 [^\u00B7]+)? \u00B7 Deck$'), t);
    }
  }
});

test('the page heading stays in the tree on every class but TV: hidden visually where the bar or sub-tabs name the page, never display:none (SeeAccess A3)', () => {
  // one h1 per page section
  const sections = html.split('<section class="page"').slice(1);
  assert.equal(sections.length, 9);
  for (const s of sections) assert.equal((s.match(/<h1 class="ptitle">/g) || []).length, 1, s.slice(0, 60));
  const ui = read('ui.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...ui.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const titleRules = rules.filter((r) => r.sel.split(',').some((s) => /\.ptitle(?![-\w])/.test(s)));
  for (const r of titleRules) assert.doesNotMatch(r.body, /display:\s*none|visibility:\s*hidden/, r.sel);
  const VH = /position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset\(50%\);white-space:nowrap/;
  // P and T: the sub-tabs name the page; L: the rail and the bar do, on every deck page (not /cre, which has no bar)
  const block = (q) => { const i = ui.indexOf(q + '{\n'); assert.ok(i >= 0, q); const b = ui.slice(i); return b.slice(0, b.indexOf('\n}')); };
  assert.match(block('@media (max-width:599px),(min-width:600px) and (max-width:1099px) and (min-height:500px)'), new RegExp('\\.phead:has\\(\\.subrow\\) \\.ptitle\\{' + VH.source + '\\}'));
  assert.match(block('@media (min-width:600px) and (max-height:499px)'), new RegExp('#pager \\.phead \\.ptitle\\{' + VH.source + '\\}'));
  // page stylesheets never hide the deck title either
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'static', 'css'))) {
    const css = read('css/' + f).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (/\.ptitle(?![-\w])/.test(m[1])) assert.doesNotMatch(m[2], /display:\s*none/, f + ' ' + m[1].trim());
  }
});

test('a page swipe is horizontal, dominant and at least 60 px', () => {
  assert.equal(C.swipe(-80, 10), 1);
  assert.equal(C.swipe(90, -20), -1);
  assert.equal(C.swipe(-50, 0), 0);
  assert.equal(C.swipe(-80, 70), 0);
});

test('exactly nine tabs in order, each a section with a header and one container per sub (UiApi 1.1)', () => {
  const sections = [...html.matchAll(/<section class="page" id="pg-(\w+)" data-name="(\w+)" data-label="([^"]+)" hidden>/g)];
  assert.deepEqual(sections.map((m) => m[2]), [...C.TABS]);
  assert.deepEqual(sections.map((m) => m[3]), ['Today', 'World', 'Home', 'Real estate', 'Surf', 'Shop', 'Money', 'Work', 'Pad']);
  for (const t of C.TABS) {
    const subs = C.SUBS[t] || ['main'];
    const sec = html.slice(html.indexOf('id="pg-' + t + '"'), html.indexOf('</section>', html.indexOf('id="pg-' + t + '"')));
    assert.match(sec, /<header class="phead">/, t);
    for (const s of subs) assert.match(sec, new RegExp('<div class="sub" id="pg-' + t + '-' + s + '" data-sub="' + s + '" hidden>'), t + '/' + s);
    const tabs = [...sec.matchAll(/<button type="button" role="tab" data-sub="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(tabs, C.SUBS[t] ? [...subs] : [], t + ' sub-tabs');
  }
  // the old pages live inside the new tabs (nothing the owner uses disappears)
  for (const [box, id] of [['pg-today-main', 'today'], ['pg-home-house', 'hal'], ['pg-home-fleet', 'fleet'], ['pg-home-cluster', 'cluster'], ['pg-home-dev', 'dev'],
    ['pg-home-crons', 'sched'], ['pg-home-launch', 'agents'], ['pg-realestate-residential', 'mhomes'], ['pg-realestate-commercial', 'mcdesk'],
    ['pg-shop-market', 'shop'], ['pg-shop-orders', 'commerce'], ['pg-money-accounts', 'money'], ['pg-money-markets', 'invest'],
    ['pg-work-jobs', 'life'], ['pg-work-gigs', 'gigs'], ['pg-pad-pad', 'padpg'], ['pg-pad-keys', 'keyspg']]) {
    const i = html.indexOf('id="' + box + '"'), j = html.indexOf('<div class="sub"', i + 10), k = html.indexOf('</section>', i);
    const end = j > 0 && j < k ? j : k;
    assert.ok(i > 0 && html.slice(i, end).includes('id="' + id + '"'), id + ' inside #' + box);
  }
  assert.doesNotMatch(html, /id="keynote"|id="totop"|id="dots"|data-sub="schedules"|data-sub="agents"/);
});

test('index.html is markup only: fonts preloaded from the same origin, v3 sheets before the page files, no inline style block', () => {
  assert.doesNotMatch(html, /<style/);
  assert.doesNotMatch(html, /href="\/theme\.css"/);
  assert.match(html, /<link rel="preload" href="\/fonts\/Geist-Variable\.woff2" as="font" type="font\/woff2" crossorigin>/);
  assert.match(html, /<link rel="preload" href="\/fonts\/GeistMono-Variable\.woff2" as="font" type="font\/woff2" crossorigin>/);
  const order = ['/tokens.css', '/ui.css', '/tv.css', '/app.css', '/css/today.css', '/css/pad.css'].map((h) => html.indexOf('href="' + h + '"'));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), 'tokens, ui, tv, app, then the page files');
  assert.ok(html.indexOf('<script src="/tv.js">') > html.indexOf('<script src="/pages/shop.js">'));
  assert.match(html, /<symbol id="i-search"/);
});

test('shell contracts: the iOS tab strip, the shell corner, haptics, the Pad ids, viewport-fit', () => {
  // the strip DeckPageNav presses (#pgs button[data-p], the current one .on); a tab list since B2, its selector unchanged
  assert.match(html, /<nav id="pgs" role="tablist" aria-label="Pages"><\/nav>/);
  assert.match(app, /'<button type="button" role="tab" id="tab-'\+esc\(p\.dataset\.name\)\+'"[^\n]* class="press" data-p="'\+i\+'"/);
  assert.match(app, /\$\$\('#pgs button\[data-p\]'\)\.forEach\(b=>\{const on=\+b\.dataset\.p===page;b\.classList\.toggle\('on',on\);[^}]*if\(on\)b\.setAttribute\('aria-current','page'\)/);
  assert.match(app, /const IN_SHELL=\/OmarchyDeck\\\/\//);
  assert.match(app, /window\.webkit\?\.messageHandlers\?\.deckHaptic\?\.postMessage/);
  for (const id of ['kin', 'kpages', 'kbmods', 'kbnav', 'kbfav', 'kblist']) assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.match(html, /viewport-fit=cover/);
});

test('TV view is opt-in only; the burn-in guard runs only with the Always-on flag and never on TV', () => {
  assert.match(app, /if\(v==='tv'\)localStorage\.setItem\('view','tv'\);else if\(v==='std'\)localStorage\.removeItem\('view'\)/);
  assert.doesNotMatch(app.slice(0, app.indexOf('// ---- burn-in guard')), /navigator\.userAgent[^;]*tv/i, 'never switched on by the user agent');
  assert.match(app, /const ALWAYS_ON=\(\(\)=>\{if\(document\.documentElement\.classList\.contains\('tv'\)\)return false;/);
  assert.match(app, /if\(ALWAYS_ON\)\{\n setInterval/);
});

test('no stylesheet the shell ships sets text under 12 px', () => {
  for (const f of ['tokens.css', 'ui.css', 'app.css']) {
    for (const m of read(f).matchAll(/font-size:\s*([\d.]+)px/g)) assert.ok(+m[1] >= 12, f + ': ' + m[0]);
  }
});

// WCAG 2.x contrast of the v3 pairs (DESIGN-v3 section 2): body text AA or better, quiet text AA, status marks 3:1
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
const lum = (s) => { const [r, g, b2] = hex(s); return 0.2126 * r + 0.7152 * g + 0.0722 * b2; };
const ratio = (x, y) => { const [h, l] = [lum(x), lum(y)].sort((p, q) => q - p); return (h + 0.05) / (l + 0.05); };
test('contrast pairs from tokens.css meet DESIGN-v3', () => {
  const tokens = read('tokens.css'), v = (n) => new RegExp('--' + n + ':(#[0-9A-Fa-f]{6})').exec(tokens)[1];
  const bg = ['c-ground', 'c-panel', 'c-panel-2'].map(v);
  for (const g of bg) {
    assert.ok(ratio(v('c-text-1'), g) >= 7, 'text-1');
    assert.ok(ratio(v('c-text-2'), g) >= 7, 'text-2');
    assert.ok(ratio(v('c-text-3'), g) >= 4.5, 'text-3');
    assert.ok(ratio(v('c-signal'), g) >= 4.5, 'signal');
  }
  assert.ok(ratio(v('c-on-signal'), v('c-signal')) >= 4.5, 'text on a signal fill');
  for (const s of ['c-ok', 'c-warn', 'c-bad']) assert.ok(ratio(v(s), v('c-panel')) >= 3, s);
  for (const w of ['c-ok-wash', 'c-warn-wash', 'c-bad-wash']) assert.ok(ratio(v('c-text-2'), v(w)) >= 4.5, w);
});
