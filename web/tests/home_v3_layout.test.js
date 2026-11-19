// node --test tests/home_v3_layout.test.js
// Home > House, Fleet and Cluster in design v3 (static/css/home.css). These pin behaviour a person sees, not the look:
// on a phone the status and the controls come before the four cameras (baseline problem 22), the guest House keeps exactly
// the cameras and the bedroom speaker, the TV board puts the camera wall beside the status, and no Home column scrolls on
// its own (the document is the one scroller). Browser proof at every size lives in the lane report (staging shots).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../static/css/home.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// the body of the first @media block whose query matches `q` (balanced braces)
function media(q) {
  const i = css.indexOf('@media ' + q + '{');
  assert.ok(i >= 0, 'media block ' + q);
  let d = 0, j = css.indexOf('{', i);
  for (let k = j; k < css.length; k++) {
    if (css[k] === '{') d++;
    else if (css[k] === '}' && --d === 0) return css.slice(j + 1, k);
  }
  throw new Error('unbalanced ' + q);
}
// order:N for one selector inside a block of rules
function orderOf(block, sel) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\#>:]/g, '\\$&');
  const m = new RegExp('(?:^|[}\\s])' + esc + '\\{[^}]*?order:(\\d+)').exec(block);
  assert.ok(m, 'order for ' + sel);
  return +m[1];
}
const VOL = '#grid>.card:has(#volrow)';

test('phone: the status line, the readings and every control come before the cameras (baseline problem 22)', () => {
  const p = media('(max-width:599px)');
  const cams = orderOf(p, '#cams');
  for (const sel of ['#hn', '#hrd', '#np', VOL, '#lnch', '#bed']) assert.ok(orderOf(p, sel) < cams, sel + ' before the cameras');
  assert.equal(orderOf(p, '#hn'), 1, 'the house status is first');
  assert.equal(orderOf(p, '#hrd'), 2, 'the readings strip is second');
  for (const sel of ['#vit', '#ink', '#needs', '#prod', '#cc', '#hax']) assert.ok(orderOf(p, sel) > cams, sel + ' after the cameras');
});

test('phone: the grouping wrappers dissolve so the order applies to each card, and the House sub is one grid', () => {
  assert.match(css, /#ha,#hal,#har,#grid\{display:contents\}/);
  assert.match(css, /div\.sub\[data-sub="house"\]:not\(\[hidden\]\)\{display:grid;/, 'a hidden sub stays hidden; the sub-tab button (also data-sub) is untouched');
});

test('every House order is unique per class, so no two cards fight for a slot', () => {
  const want = { '(max-width:599px)': 13, '(min-width:600px) and (max-height:499px)': 13, '(min-width:600px) and (max-width:1099px) and (min-height:500px)': 13, '(min-width:1100px) and (min-height:500px)': 8 };
  for (const [q, n] of Object.entries(want)) {
    const b = media(q), seen = new Map();
    for (const m of b.matchAll(/([#\w>.:()-]+)\{[^}]*?order:(\d+)/g)) {
      assert.ok(!seen.has(m[2]), q + ': order ' + m[2] + ' used by ' + seen.get(m[2]) + ' and ' + m[1]);
      seen.set(m[2], m[1]);
    }
    assert.ok(seen.size >= n, q + ' places every House block (' + n + ')');
  }
});

test('phone: the four cameras are a 2 x 2 wall, not four full-width tiles (review F6, page length)', () => {
  assert.match(media('(max-width:599px)'), /#cams\{order:7;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

// L and T: walk the House blocks in their order. A block in the right half (7/-1) needs a left-half block (1/span 6) open beside it,
// and a left-half block needs a right-half partner before the next full-width block, so no block sits in one half with the other
// half empty (main 2026-11-15: 932x430 and 834x1194). A block with no grid-column takes the full width (the base rule).
function partners(q) {
  const l = media(q);
  const blocks = [...l.matchAll(/([#\w>.:()-]+)\{([^}]*?order:(\d+)[^}]*)\}/g)].map((m) => {
    const col = /grid-column:([^;}]+)/.exec(m[2]);
    return { sel: m[1], order: +m[3], col: col ? col[1] : '1/-1' };
  }).sort((a, b) => a.order - b.order);
  assert.equal(blocks.length, 13, q);
  let left = null, paired = true;
  for (const b of blocks) {
    if (b.col === '1/span 6') { assert.ok(paired, q + ': the half before ' + b.sel + ' has a partner'); left = b.sel; paired = false; }
    else if (b.col === '7/-1') { assert.ok(left, q + ': ' + b.sel + ' sits in the right half with nothing beside it'); paired = true; }
    else { assert.ok(paired, q + ': ' + left + ' sits in the left half with nothing beside it'); left = null; }
  }
  assert.ok(paired, q);
  return l;
}
test('phone landscape and tablet: every half-width House block has a partner beside it, in reading order', () => {
  const l = partners('(min-width:600px) and (max-height:499px)');
  partners('(min-width:600px) and (max-width:1099px) and (min-height:500px)');
  assert.match(l, /html\.guest #bed,html\.guest #cams\{grid-column:1\/-1\}/, 'a guest has only the cameras and the speaker: each takes the width');
});

// The Pixel under the monitor (908x411) is tapped for control (SYNTHESIS correction to G2): the controls stay on the first screen,
// under the status line and the readings strip; the cameras open one screen down, 2 x 2, beside the one launcher.
test('phone landscape (the Pixel): readings, then now playing beside volume and the speaker, then cameras 2 x 2 beside the launcher', () => {
  const l = media('(min-width:600px) and (max-height:499px)');
  assert.deepEqual(['#hn', '#hrd', '#np', VOL, '#bed', '#cams', '#lnch'].map((s) => orderOf(l, s)), [1, 2, 3, 4, 5, 6, 7]);
  assert.match(l, /#np\{order:3;grid-column:1\/span 6;grid-row:span 2\}/, 'now playing sits at its own height, so the transport stays on the first screen (it was pushed below at 411 px when stretched)');
  assert.match(l, /#cams\{order:6;grid-column:1\/span 6;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('one launcher of eight; the second copy of the same buttons is gone (G3, decision 5)', () => {
  const html = fs.readFileSync(path.join(__dirname, '../static/index.html'), 'utf8');
  const house = html.slice(html.indexOf('id="pg-home-house"'), html.indexOf('id="pg-home-fleet"'));
  assert.doesNotMatch(house, /id="qk"|id="sys"/, 'no quick-launch tiles in now playing, no System card (the readings strip has CPU, RAM, GPU)');
  assert.equal((house.match(/class="apps"/g) || []).length, 1);
  const launch = [...house.matchAll(/data-a="launch" data-v="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(launch, ['terminal', 'browser', 'files', 'hermes', 'spotify', 'obsidian']);
  assert.match(house, /id="swap"/);
  assert.match(house, /id="lock"/);
  assert.match(house, /<div class="card" id="needs">/, 'Your decisions stay on House (decision 5)');
  assert.match(house, /<div class="card" id="prod">/, 'the products stay on House (decision 5)');
  assert.match(house, /<div id="hrd" class="strip"[^>]*>.*<div class="tile" id="car">/, 'the car is a reading in the strip');
  const app = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
  assert.doesNotMatch(app, /renderQK|#qk/);
});

test('the full-width default has no specificity, so a placement by id wins at every class', () => {
  assert.match(css, /:where\(#hn,#hrd,#vit,#ink,#cams,#bed,#np,#cc,#prod,#needs,#hax,#grid>\.card\)\{grid-column:1\/-1\}/);
  assert.doesNotMatch(css.replace(/:where\([^)]*\)\{grid-column:1\/-1\}/, ''), /#grid>\.card\{[^}]*grid-column/, 'no specific full-width rule for the cards');
  assert.match(css, /@media \(min-width:600px\)\{#vit>\.flist\{grid-column:1\/-2\}\}/, 'the watch row and the weather tile share a row from L up');
  assert.ok(css.indexOf('@media (min-width:600px){#vit>.flist{grid-column:1/-2}}') > css.indexOf('#vit>.es,#vit>.flist{grid-column:1/-1}'), 'it comes after the full-width rule it overrides (same weight)');
});

test('phone landscape: half-width camera tiles stack the name over the status, as on a phone, so neither is cut', () => {
  const l = media('(min-width:600px) and (max-height:499px)');
  assert.match(l, /\.cam \.nm\{flex-direction:column;/);
  assert.match(l, /\.cam \.nm>span\{white-space:nowrap\}/);
  assert.match(l, /\.cam \.nm i\{max-width:100%;/);
});

test('Fleet: off TV each section is one whole block, balanced into columns from L up by the shared balancer', () => {
  const html = fs.readFileSync(path.join(__dirname, '../static/index.html'), 'utf8');
  assert.match(html, /<div id="fleet" data-balance>/, '#fleet opts in to DeckBalance');
  assert.match(css, /html:not\(\.tv\) #fleet\{display:block\}/);
  assert.match(css, /#fleet \.fsec\{display:flex;flex-direction:column;/, 'a section is one block: its title and its blocks together');
  assert.match(css, /#fleet>\.fsec\{margin:0;padding:0 0 var\(--gap\)\}/);
  const at = css.indexOf('html:not(.tv) #fleet{columns:2;');
  assert.ok(at > 0 && /^@media \(min-width:600px\)\{\s*$/.test(css.slice(css.lastIndexOf('@media', at), at)), 'the first rule of the from-L-up block');
  const l = css.slice(at, css.indexOf('\n}', at));
  assert.match(l, /html:not\(\.tv\) #fleet\{columns:2;/, 'L and T: two columns');
  assert.match(l, /html:not\(\.tv\) #fleet\.bal\{display:grid;columns:auto;grid-template-columns:repeat\(var\(--bal-n,2\),minmax\(0,1fr\)\)/, 'the balanced column boxes win over #fleet');
  assert.match(l, /html:not\(\.tv\) #fleet>\.span-all\{column-span:all\}/);
  assert.match(css, /@media \(min-width:1100px\) and \(min-height:500px\)\{html:not\(\.tv\) #fleet\{columns:var\(--col-w\) var\(--col-max\)\}\}/, 'D up: the shared column tokens, as .flow (three on a laptop, four on the wide step), never a fixed three');
  assert.match(fs.readFileSync(path.join(__dirname, '../static/ui.css'), 'utf8'), /\.flow\{columns:var\(--col-w\) var\(--col-max\);/, 'the same two tokens the shared flow uses');
  assert.doesNotMatch(css, /#fleet[^{]*\{[^}]*break-inside:auto/, 'no section continues in another column');
  assert.match(css, /html\.tv #fleet\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/, 'TV keeps its own grid');
  const app = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
  const place = app.slice(app.indexOf('function fleetPlace('), app.indexOf('async function fleet()'));
  assert.match(place, /n\.classList\.contains\('secttl'\)/, 'a title opens a new section');
  assert.match(place, /i===2&&wide\?' span-all':''/, 'L and T: the third column\'s sections span the width under the balanced two');
  assert.match(place, /addEventListener\('deck:class'/, 'placed again when the device class changes');
});

// PlanDesign section 3, House laptop (PR b): status line and readings strip across; then halves in pairs: the camera wall beside Your
// decisions; the watch, the printer row, Now playing and Volume beside Products (both lists grouped by DeckUI.group); Launch beside
// Workspaces. #har stays one box; Products span their four rows and only the Volume row is flexible, so no gap opens between cards.
test('House on D and XL: cameras beside decisions, the readings and the player beside products, launch beside workspaces', () => {
  const d = media('(min-width:1100px) and (min-height:500px)');
  assert.match(d, /html:not\(\.tv\) #ha,html:not\(\.tv\) #hal\{display:contents\}/, 'off TV the two groups only hold markup');
  assert.match(d, /html:not\(\.tv\) #har\{order:3;display:flex;flex-direction:column;[^}]*grid-column:1\/span 6\}/);
  assert.match(d, /html:not\(\.tv\) #needs\{order:4;grid-column:7\/-1\}/, 'the decisions beside the cameras');
  assert.match(d, /html:not\(\.tv\) #prod\{order:6;grid-column:7\/-1;grid-row:span 4\}/, 'the products beside the watch, the printer, the player and the volume');
  assert.match(d, /html:not\(\.tv\) div\.sub\[data-sub="house"\]:not\(\[hidden\]\)\{grid-template-rows:auto auto auto auto auto auto 1fr\}/, 'the volume row (row 7) is the one flexible row');
  const o = (s) => orderOf(d, s);
  assert.deepEqual(['html:not(.tv) #hn', 'html:not(.tv) #hrd', 'html:not(.tv) #har', 'html:not(.tv) #needs', 'html:not(.tv) #vit', 'html:not(.tv) #prod', 'html:not(.tv) #ink', '#np', VOL, '#lnch', '#cc'].map(o), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  for (const s of ['html:not(.tv) #vit', 'html:not(.tv) #ink', '#np', VOL, '#lnch']) assert.match(d, new RegExp('(?:^|[}\\s])' + s.replace(/[.()#>:]/g, '\\$&') + '\\{order:\\d+;grid-column:1\\/span 6'), s + ' in the left half');
  assert.match(d, /#cc\{order:11;grid-column:7\/-1\}/, 'workspaces beside launch');
  assert.match(css, /html\.tv #np\{order:8;grid-column:1\/span 4;grid-row:span 2;/, 'the TV keeps its control row below the board');
  assert.match(d, /#cams\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(d, /\.cam \.nm>span\{white-space:nowrap\}/, 'a half-width camera keeps its name whole beside its state chips');
  assert.match(d, /html\.guest #har\{grid-column:1\/-1\}/, 'a guest has no decisions, so the cameras take the width');
  assert.doesNotMatch(css, /@media \(min-width:1100px\) and \(max-width:1599px\) and \(min-height:500px\)\{\s*html:not\(\.tv\) #ha/, 'one arrangement from D up');
});

test('TV: #ha is the board: status beside a 2 x 2 camera wall that shares the board height; the readings stay off it (review F1)', () => {
  const app = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
  assert.match(app, /function cams\(\)\{const b=\$\('#ha'\);if\(b&&!b\.classList\.contains\('board'\)\)b\.classList\.add\('board'\);syncCameras\(\)\}/);
  assert.match(css, /html\.tv #ha\{display:grid;[^}]*grid-template-columns:minmax\(0,2fr\) minmax\(0,3fr\);grid-template-rows:minmax\(0,1fr\)/);
  assert.match(css, /html\.tv #cams\{flex:1 1 0;min-height:0;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);grid-template-rows:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css, /html\.tv \.cam\{aspect-ratio:auto;height:100%;min-height:0\}/, 'a camera tile takes its share of the board, never its own 16:9 height');
  assert.match(css, /html\.tv #hrd,html\.tv #vit,html\.tv #ink\{display:none\}/, 'the readings strip stays off the board until the TV lane places it');
  assert.match(css, /html\.tv #prod,html\.tv #needs,html\.tv #hax,html\.tv #cc \.tnote\{display:none\}/);
});

test('no color-mix(): the bedroom TV runs Chrome 108, which drops those declarations (review F5)', () => {
  assert.doesNotMatch(css, /color-mix\(/);
});

test('guest House: cameras and the bedroom speaker only, exactly as before', () => {
  const g = /html\.guest #grid,([^{]*)\{display:none\}/.exec(css);
  assert.ok(g, 'guest rule exists');
  const hidden = ('#grid,' + g[1]).split(',').map((s) => s.replace(/html\.guest\s*/, '').trim());
  for (const sel of ['#grid', '#prod', '#needs', '#lock', '.apps [data-v=hermes]', '#hal']) assert.ok(hidden.includes(sel), 'guest hides ' + sel);
  for (const sel of ['#cams', '#bed', '#har']) assert.ok(!hidden.includes(sel), 'guest keeps ' + sel);
  // the guest rule out-ranks the layout rule that turns #grid into display:contents
  assert.ok(css.indexOf('html.guest #grid') > css.indexOf('#ha,#hal,#har,#grid{display:contents}'));
});

test('controls keep a 44 px target on every class, a fine desktop pointer included', () => {
  assert.match(css, /#grid button\.b,#grid a\.b\{min-height:max\(44px,var\(--ctl-h\)\);min-width:max\(44px,var\(--ctl-h\)\)\}/);
  assert.match(css, /#bed button\{[^}]*min-height:max\(44px,var\(--ctl-h\)\)/);
  assert.match(css, /#vs\{[^}]*height:max\(44px,var\(--ctl-h\)\)/);
});

test('Fleet and Cluster columns never scroll on their own; the page is the one scroller', () => {
  const rule = /#fleet>#fl1,#fleet>#fl2,#fleet>#fl3,#cluster>#cl1,#cluster>#cl2,#cluster>#cl3\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'column rule exists');
  assert.match(rule[1], /overflow:visible/);
  assert.match(rule[1], /mask-image:none/);
  assert.doesNotMatch(css, /overflow-y:(auto|scroll)/);
});

test('states read as words on a wash, never a red slab; empty decisions stay bare; a full disk warns', () => {
  assert.match(css, /#hn\[data-mark=bad\]\{[^}]*background:var\(--c-bad-wash\)\}/);
  assert.doesNotMatch(css, /#hn\[data-mark=bad\]\{[^}]*background:var\(--c-bad\)[;}]/);
  assert.match(css, /#needl \.es\{background:none;border:0;/);
  assert.match(css, /\.dk\.hot \.bar>i,\.dk\.hot \.bar i\{background:var\(--c-warn\)\}/);
});

test('camera tiles keep the picture rules the viewer code relies on (rotation, size, snapshot fallback)', () => {
  assert.match(css, /\.cam-media video,\.cam-media img\{position:absolute;left:50%;top:50%;width:var\(--media-w,100%\);height:var\(--media-h,100%\);transform:translate\(-50%,-50%\) rotate\(var\(--rotation,0deg\)\)/);
  assert.match(css, /\.cam\.snap \.cam-media video\{display:none\}/);
  assert.match(css, /\.cam\.snap \.cam-media img,\.cam\.poster \.cam-media img\{display:block\}/);
  assert.match(css, /\.cam\.rot \.cam-media video,\.cam\.rot \.cam-media img\{object-fit:cover\}/);
});

test('calm single-urgent rule: only the item app.js marks .urgent is filled', () => {
  assert.match(css, /#fleet \.tile\.bad,#fleet \.chip\.bad,[^{]*\{background:var\(--c-panel\)\}/);
  assert.match(css, /#fleet \.tile\.bad\.urgent,#fleet \.chip\.bad\.urgent,#fleet \.frow\.bad\.urgent\{background:var\(--c-bad-wash\);/);
});

test('no font size below the 13 px floor and no off-origin asset', () => {
  for (const m of css.matchAll(/font-size:([0-9.]+)px/g)) assert.ok(+m[1] >= 13, 'font-size ' + m[1] + 'px');
  assert.doesNotMatch(css, /url\(\s*['"]?(https?:|data:|blob:)/);
  assert.doesNotMatch(css, /\u2014/, 'no em dash');
});

test('Fleet: the summary block is the first data; off TV it shows the one urgent row, on TV it is the board with every urgent row', () => {
  const app = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
  assert.match(app, /\$\('#fleet'\)\.insertAdjacentHTML\('beforebegin','<div id="fsum" class="board"><\/div>'\)/);
  assert.match(app, /fsum\.innerHTML=DeckUI\.fleetSummary\(\{f,st,bd,nd\}\)\.html/);
  assert.match(css, /#fsum \.fsum-rows>\.frow:nth-child\(n\+2\)\{display:none\}/);
  assert.match(css, /html\.tv #fsum \.fsum-rows>\.frow:nth-child\(n\+2\)\{display:flex\}/);
  assert.match(css, /html\.tv #fsum\.board\{height:calc\(100vh - var\(--tv-board-top\) - 4vh - 2px\)/);
});

test('Cluster: the board exists on TV only; every other class keeps the page as it was', () => {
  const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
  assert.match(deck, /c\.insertAdjacentHTML\('beforebegin','<div id="clboard" class="board"><\/div>'\)/);
  assert.match(deck, /b\.innerHTML=DeckUI\.clusterBoard\(f,pf,now\)/);
  assert.match(css, /#clboard\{display:none\}/);
  assert.match(css, /html\.tv #clboard\.board\{display:flex;height:calc\(100vh - var\(--tv-board-top\) - 4vh - 2px\)/);
});
