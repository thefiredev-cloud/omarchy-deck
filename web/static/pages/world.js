// World (2026-11-17): the world's eye view. One page that answers "where is the gap": the scored market gaps first (GET /api/gaps),
// then one compact panel per domain from the feeds the deck already serves: Surf (/api/surf-coast), Residential
// (/api/housing/national?part=summary and /api/realestate/homes), Commercial (/api/cre/deals), Jobs demand (/api/jobs) and Trending
// searches (/api/trends). Every panel says its own age; a feed that is missing or failed is the deck's "is not reporting" state, never zeros.
// Model functions are pure and exported for tests (tests/world_page.test.js); the glue at the bottom registers `world`.
const DeckWorld = (() => {
  'use strict';
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const arr = (x) => (Array.isArray(x) ? x : []);
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  const str = (x, n) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200) : '');
  const U = () => DeckUI;
  const C = () => DeckCore;
  const esc = (s) => C().esc(s);
  const F = () => U().fmt;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ok = (f) => isObj(f) && !f.error;

  // ---------- words and numbers ----------
  const DOMAIN = { ecom: 'E-commerce', residential: 'Residential', commercial: 'Commercial', jobs: 'Jobs', gigs: 'Gigs', surf: 'Surf', local: 'Local', ai: 'AI' };
  // when a feed was written: its `t` (epoch s), else its ISO `generated_at`
  const stamp = (f) => (isObj(f) ? (num(f.t) != null ? f.t : C().toEpoch(f.generated_at)) : null);
  // the panel's age words: "2 h ago", "Out of date · 2 d ago", or nothing when the feed carries no time
  function ageText(f, now) {
    if (!ok(f)) return '';
    const t = stamp(f);
    if (t == null) return f.stale === true ? 'Out of date' : '';
    return (f.stale === true ? 'Out of date \u00B7 ' : '') + C().whole(C().ago(t, now));
  }
  // why a feed is unavailable, in a few words: the reason stays in the Data sheet
  function whyDown(f) {
    const e = isObj(f) ? str(f.error, 120) : '';
    if (!isObj(f)) return 'The deck did not answer';
    if (/missing|not found|no such file/i.test(e)) return 'Not collected yet';
    if (/time(?:d)?[ _-]?out/i.test(e)) return 'Timed out';
    const h = /^http (\d{3})$/i.exec(e);
    return h ? 'HTTP ' + h[1] : 'Not reporting';
  }
  // an as-of as a reader says it: "Nov 17" (a plain date stays its own day)
  function dayOf(s) {
    const t = str(s, 40);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    return m && MON[+m[2] - 1] ? MON[+m[2] - 1] + ' ' + +m[3] : '';
  }
  const money = (v) => (num(v) == null ? '' : num(v) < 100 ? F().money(v, { cents: true }) : F().money(v));
  const pct = (v, d) => (num(v) == null ? '' : F().chg(v, d));

  // ---------- gaps ----------
  // the score's own words, read from the feed's method ("0.55 * demand + 0.45 * (1 - supply)") so the page never states weights the
  // feed did not publish; a method that does not parse says only what a higher score means
  function whyText(method) {
    const t = str(method, 600), m = /0?\.(\d+)\s*\*\s*demand\s*\+\s*0?\.(\d+)\s*\*\s*\(\s*1\s*-\s*supply\s*\)/i.exec(t);
    if (!m) return 'A higher score means more demand and less supply.';
    return 'Demand counts ' + Math.round(+('0.' + m[1]) * 100) + '% and thin supply ' + Math.round(+('0.' + m[2]) * 100) + '%' +
      (/confidence/i.test(t) ? ', scaled down when fewer evidence rows back it' : '') + '. Higher is a bigger gap.';
  }
  // an evidence source lists its members in parentheses ("public job boards (ashby, dice, ... workday)"): past three members that is a count,
  // never a cut-off list
  function sourceText(s) {
    return str(s, 400).replace(/\s*\(([^()]*)\)/g, (m, l) => { const n = l.split(',').length; return n > 3 ? ' (' + n + ' sources)' : m; }).slice(0, 100);
  }
  // gaps.json items, best gap first (an unscored item last), each with its evidence in the feed's order
  function gapsModel(g) {
    if (!ok(g) || !Array.isArray(g.items)) return null;
    const why = whyText(g.method);
    const rows = g.items.filter(isObj).map((x, i) => ({
      key: str(x.id, 60) || 'gap-' + i, title: str(x.title, 160), domain: DOMAIN[x.domain] ? x.domain : '', word: DOMAIN[x.domain] || '',
      demand: str(x.demand_signal, 200), supply: str(x.supply_signal, 200),
      score: num(x.gap_score) != null && x.gap_score >= 0 && x.gap_score <= 100 ? Math.round(x.gap_score) : null,
      next: str(x.next_step, 240), why,
      evidence: arr(x.evidence).filter((e) => isObj(e) && str(e.source, 400)).map((e) => ({
        source: sourceText(e.source), metric: str(e.metric, 80), value: typeof e.value === 'number' ? String(e.value) : str(e.value, 80), asOf: dayOf(e.as_of)
      })),
      i
    })).filter((x) => x.title);
    return rows.sort((a, b) => (a.score == null) - (b.score == null) || (b.score || 0) - (a.score || 0) || a.i - b.i);
  }
  const band = (s) => (s == null ? 'na' : s >= 70 ? 'hi' : s >= 40 ? 'mid' : 'lo');
  // one gap: the score, the title, its domain, the next step, and "Why" with its chevron (a native disclosure: no script, Enter works on a TV).
  // The whole summary is the tap target. Opened it says what the score weighs, then demand against supply, then each source with its as-of.
  // Demand and supply are the reasons, so they sit behind that tap and a card reads in four short lines instead of nine.
  function gapHtml(x) {
    const sc = x.score == null ? '<b>--</b><small>unscored</small>' : '<b>' + x.score + '</b><small>of 100</small>';
    const ds = [['Demand', x.demand], ['Supply', x.supply]].filter((d) => d[1]).map((d) => '<p class="wg-ds"><b>' + d[0] + '</b> ' + esc(d[1]) + '</p>').join('');
    const n = x.evidence.length;
    const ev = n ? '<div class="flist wg-ev">' + x.evidence.map((e) => '<div class="frow"><span class="fl"><b>' + esc(e.metric || 'Value') + '</b><small>' +
      esc([e.source, e.asOf ? 'as of ' + e.asOf : 'no as-of date'].join(' \u00B7 ')) + '</small></span><span class="fr"><b>' + esc(e.value || '--') + '</b></span></div>').join('') + '</div>'
      : '<p class="note sm">No evidence rows in the feed.</p>';
    const lead = x.score == null ? 'This gap has no score yet.' : x.why;
    return '<details class="wg" data-key="' + esc(x.key) + '"><summary><span class="wg-sc" data-band="' + band(x.score) + '" aria-label="' + esc(x.score == null ? 'Unscored' : 'Gap score ' + x.score + ' of 100') + '">' + sc + '</span>' +
      '<span class="wg-b"><b class="wg-t">' + esc(x.title) + '</b>' +
      '<span class="wg-m">' + (x.word ? '<span class="pill wg-dom" data-domain="' + esc(x.domain) + '">' + esc(x.word) + '</span>' : '') +
      '<span class="wg-why">' + esc(n ? 'Why \u00B7 ' + (n === 1 ? '1 evidence row' : n + ' evidence rows') : 'Why') + '</span></span>' +
      (x.next ? '<span class="wg-nx">' + esc('Next: ' + x.next) + '</span>' : '') + '</span></summary>' +
      '<div class="wg-bd"><p class="wg-wy">' + esc(lead) + '</p>' + ds + '</div>' + ev + '</details>';
  }
  const GAPS_FIRST = 6;
  function gapsHtml(g, now, view) {
    const title = 'Gaps', act = ageText(g, now);
    const head = '<h2 class="secttl"><span>' + title + '</span>' + (act ? '<span>' + esc(act) + '</span>' : '') + '</h2>';
    if (g === undefined) return '<section class="sect wd-gaps" id="wd-gaps">' + head + U().skeleton('row', 3) + '</section>';
    const rows = gapsModel(g);
    if (!rows) return '<section class="sect wd-gaps" id="wd-gaps">' + head + unavailable('Gaps', g) + '</section>';
    if (!rows.length) return '<section class="sect wd-gaps" id="wd-gaps">' + head + U().empty({ k: 'idle', title: 'No gaps scored yet', line: 'The gap finder fills this in after its next run.' }) + '</section>';
    const n = Math.min(rows.length, Math.max(GAPS_FIRST, num(view && view.gaps) || 0));
    return '<section class="sect wd-gaps" id="wd-gaps">' + head + '<div class="wg-list">' + rows.slice(0, n).map(gapHtml).join('') + '</div>' +
      C().more({ key: 'gaps', shown: n, total: rows.length, step: GAPS_FIRST, first: GAPS_FIRST }) + '</section>';
  }

  // ---------- panels ----------
  // the deck's one failed state (crossed square, "<name> is not reporting", the plain cause, one Try again) for a feed that did not
  // answer. It replaced a tile that set the word "Unavailable" at the figure step: five of them on one screen, wider than their cells
  // on a phone, and no way to ask again. Try again reads every part again (the tap handler at the bottom).
  function unavailable(label, f) {
    const t = str(label, 60);
    return U().empty({ k: 'bad', title: t + (/[^s]s$/i.test(t) ? ' are' : ' is') + ' not reporting', line: U().problem(f).line, retry: 'world' });
  }
  const row = (main, sub, right, rsub, key) => '<div class="frow"' + (key ? ' data-key="' + esc(key) + '"' : '') + '><span class="fl"><b>' + esc(main) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
    (right || rsub ? '<span class="fr">' + (right ? '<b>' + right + '</b>' : '') + (rsub ? '<small>' + rsub + '</small>' : '') + '</span>' : '') + '</div>';
  // one panel: its title and its own age, then its body; still loading is a skeleton, failed is the not-reporting state
  function panel(id, title, f, now, body) {
    const age = ageText(f, now);
    const inner = f === undefined ? U().skeleton('row', 3) : !ok(f) ? unavailable(title, f) : body();
    return '<section class="sect wd-p" id="wd-' + id + '"><h2 class="secttl"><span>' + esc(title) + '</span>' + (age ? '<span>' + esc(age) + '</span>' : '') + '</h2>' + inner + '</section>';
  }
  const idle = (t) => U().empty({ k: 'idle', title: t });

  // Surf: the pinned home spots, best window first
  function surfModel(s) {
    if (!ok(s)) return null;
    return arr(s.spots).filter((x) => isObj(x) && num(x.pinned) != null).sort((a, b) => a.pinned - b.pinned).slice(0, 4).map((x) => {
      const b = isObj(x.best) ? x.best : {};
      return { key: str(x.id, 60), name: str(x.name, 60) || 'Spot', rating: num(b.rating), word: str(b.word, 20), when: [str(b.day, 12) === 'today' ? 'Today' : str(b.day, 12) === 'tomorrow' ? 'Tomorrow' : str(b.day, 12), str(b.label, 20)].filter(Boolean).join(' '), reason: str(b.reason, 120) };
    });
  }
  function surfHtml(s, now) {
    return panel('surf', 'Surf', s, now, () => {
      const r = surfModel(s);
      if (!r.length) return idle('No home spots pinned');
      return '<div class="flist">' + r.map((x) => row(x.name, [x.when, x.reason].filter(Boolean).join(' \u00B7 '), esc(x.word || '--'), x.rating != null ? esc(x.rating + ' of 10') : '', x.key)).join('') + '</div>';
    });
  }

  // Residential: the national market (30-year rate, home value and its 1-year change, inventory change, days on market) over the
  // homes listed near home. h = housing summary, l = realestate/homes?limit=3
  function resModel(h, l) {
    const us = ok(h) && isObj(h.us) ? h.us : null, mg = ok(h) && isObj(h.mortgage) ? h.mortgage : null;
    const tiles = [];
    if (mg && num(mg.rate_30y) != null) tiles.push({ label: '30-yr rate', value: mg.rate_30y.toFixed(2) + '%', sub: dayOf(mg.as_of) });
    if (us && num(us.zhvi) != null) tiles.push({ label: 'US home value', value: F().money(us.zhvi), chg: num(us.zhvi_yoy), span: '1 yr' });
    if (us && num(us.redfin_inventory_yoy) != null) tiles.push({ label: 'Inventory', value: pct(us.redfin_inventory_yoy), sub: '1 yr' });
    if (us && num(us.days_on_market) != null) tiles.push({ label: 'Days on market', value: String(Math.round(us.days_on_market)), sub: 'US median' });
    const homes = ok(l) ? arr(l.rows).filter(isObj).slice(0, 3).map((x) => ({
      key: str(x.url, 300) || str(x.addr, 120), what: [str(x.type, 30), num(x.beds) != null ? x.beds + ' bd' : ''].filter(Boolean).join(', ') || 'Home', city: str(x.city, 40), price: num(x.price)
    })) : null;
    return { tiles, homes, total: ok(l) ? num(l.total) : null };
  }
  function resHtml(h, l, now) {
    // the panel is up when either read answered; each half says its own state
    const f = ok(h) ? h : ok(l) ? l : h === undefined || l === undefined ? undefined : h;
    return panel('res', 'Residential', f, now, () => {
      const m = resModel(h, l);
      const strip = m.tiles.length ? U().strip(m.tiles.map((t) => U().tile(t)), { label: 'National housing' }) : unavailable('National housing', h);
      const list = m.homes == null ? unavailable('Nearby homes', l) : !m.homes.length ? idle('No homes listed near home')
        : (m.total != null ? '<p class="note sm">' + esc(F().count(m.total) + (m.total === 1 ? ' home' : ' homes') + ' listed near home') + '</p>' : '') +
          '<div class="flist">' + m.homes.map((x) => row(x.what, x.city, esc(money(x.price) || 'No price'), '', x.key)).join('') + '</div>';
      return strip + list;
    });
  }

  // Commercial: the best-scored public deals (type, city, cap rate, price) and how many there are
  function comModel(c) {
    if (!ok(c)) return null;
    return {
      total: num(c.total), rows: arr(c.rows).filter(isObj).slice(0, 3).map((x) => {
        const cap = isObj(x.cap) ? num(x.cap.value) : null;
        return { key: str(x.id, 60) || str(x.url, 300), what: str(x.type, 30) || 'Property', city: [str(x.city, 40), str(x.state, 20)].filter(Boolean).join(', '), cap, capKind: isObj(x.cap) && /est/.test(str(x.cap.kind, 20)) ? 'estimated' : 'listed', price: num(x.price) };
      })
    };
  }
  function comHtml(c, now) {
    return panel('com', 'Commercial', c, now, () => {
      const m = comModel(c);
      if (!m.rows.length) return idle('No commercial deals listed');
      return (m.total != null ? '<p class="note sm">' + esc(F().count(m.total) + ' public deals, best scored first') + '</p>' : '') +
        '<div class="flist">' + m.rows.map((x) => row(x.what, x.city, esc(money(x.price) || 'No price'), x.cap != null ? esc(x.cap.toFixed(2) + '% cap, ' + x.capKind) : '', x.key)).join('') + '</div>';
    });
  }

  // Jobs demand: open roles per category, most first, with the change since the last read and the median top of range
  function jobsModel(j) {
    if (!ok(j)) return null;
    const names = {};
    arr(j.taxonomy).filter(isObj).forEach((t) => { names[str(t.slug, 40)] = str(t.name, 60); });
    const by = isObj(j.market) && isObj(j.market.by_category) ? j.market.by_category : {};
    return Object.keys(by).filter((k) => isObj(by[k]) && num(by[k].total) != null).map((k) => ({
      key: k, name: names[k] || k.replace(/_/g, ' '), total: by[k].total, delta: num(by[k].delta_vs_prev), pay: num(by[k].median_pay_max)
    })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 5);
  }
  function jobsHtml(j, now) {
    // a jobs feed without its market block cannot say demand: unavailable, never "no job counts"
    const f = ok(j) && !isObj(j.market) ? { error: 'market block missing' } : j;
    return panel('jobs', 'Jobs demand', f, now, () => {
      const r = jobsModel(j);
      if (!r.length) return idle('No job counts yet');
      return '<div class="flist">' + r.map((x) => row(x.name, x.pay != null ? 'Median top of range ' + F().money(x.pay) : '', esc(F().count(x.total)),
        x.delta != null ? esc((x.delta > 0 ? '+' : x.delta < 0 ? '\u2212' : '') + F().count(Math.abs(x.delta)) + ' since last read') : '', x.key)).join('') + '</div>';
    });
  }

  // Trending searches (trends.json searches): fastest growing first, an unknown growth last
  function searchesModel(tr) {
    if (!ok(tr) || !Array.isArray(tr.searches)) return null;
    return tr.searches.filter((x) => isObj(x) && str(x.term, 120)).map((x, i) => ({ term: str(x.term, 120), region: str(x.region, 40), growth: num(x.growth_pct), source: str(x.source, 60), i }))
      .sort((a, b) => (a.growth == null) - (b.growth == null) || (b.growth || 0) - (a.growth || 0) || a.i - b.i).slice(0, 8);
  }
  function searchesHtml(tr, now) {
    const f = ok(tr) && !Array.isArray(tr.searches) ? { error: 'searches missing' } : tr;
    return panel('search', 'Trending searches', f, now, () => {
      const r = searchesModel(tr);
      if (!r.length) return idle('No trending searches right now');
      return '<div class="flist">' + r.map((x) => row(x.term, [x.region, x.source].filter(Boolean).join(' \u00B7 '), x.growth != null ? C().delta(x.growth, { d: 0 }).html : esc('--'), '', 'q:' + x.term)).join('') + '</div>';
    });
  }

  // ---------- the page ----------
  // st: {g, tr, surf, house, homes, cre, jobs, now, view}; a part that has not answered yet is undefined (its skeleton shows)
  function page(st) {
    const s = isObj(st) ? st : {}, now = num(s.now) != null ? s.now : Date.now();
    return '<div class="wd">' + gapsHtml(s.g, now, s.view) + '<div class="wd-grid">' + surfHtml(s.surf, now) + resHtml(s.house, s.homes, now) + comHtml(s.cre, now) +
      jobsHtml(s.jobs, now) + searchesHtml(s.tr, now) + '</div></div>';
  }
  // the one freshness mark: the gaps feed's age (the page's answer); missing counts every read that did not answer
  function fresh(st) {
    const s = isObj(st) ? st : {}, parts = [s.g, s.tr, s.surf, s.house, s.homes, s.cre, s.jobs];
    const t = stamp(s.g), now = num(s.now) != null ? s.now : Date.now();
    return { age: ok(s.g) && t != null ? Math.max(0, Math.round(now / 1000 - t)) : null, refresh: ok(s.g) && num(s.g.refresh) ? s.g.refresh : 3600, missing: parts.filter((f) => f !== undefined && !ok(f)).length };
  }
  // Data sheet: every read with its state and when it was written; the gap method and each trends source's own health
  const NAMES = [['g', 'Market gaps', 'Scored gaps with evidence'], ['tr', 'Trends', 'Trending products, tickers and searches'], ['surf', 'Surf coast', 'Home spots'],
    ['house', 'National housing', 'Rates and home values'], ['homes', 'Homes near you', 'Listings'], ['cre', 'Commercial deals', 'Public listings'], ['jobs', 'Jobs', 'Open roles by category']];
  function dataModel(st) {
    const s = isObj(st) ? st : {}, sources = [], method = [], setup = [];
    for (const [k, name, gives] of NAMES) {
      const f = s[k];
      sources.push({ name, gives: ok(f) ? gives : whyDown(f), asOf: ok(f) && stamp(f) != null ? Math.round(stamp(f)) : '', state: !ok(f) ? 'never' : f.stale === true ? 'stale' : 'ok' });
    }
    if (ok(s.g) && str(s.g.method, 300)) method.push(['Gap score', str(s.g.method, 300)]);
    method.push(['Every number', 'Comes from a named public source with its as-of date; a source that failed says so and is never filled in.']);
    for (const x of ok(s.tr) ? arr(s.tr.feeds).filter(isObj) : []) {
      if (x.ok === false) setup.push({ name: str(x.id, 60) || 'A trends source', line: str(x.error, 160) || 'Did not report in the last run.', state: 'blocked' });
    }
    return { sources, method, setup };
  }
  // what a good answer looks like (DeckPages.get `shape`): an error body is judged by its error; the lists the page reads are lists
  const listOrNone = (x) => x == null || Array.isArray(x);
  const body = (d, rest) => isObj(d) && (typeof d.error === 'string' || rest(d));
  const SHAPE = {
    gaps: (d) => body(d, (x) => listOrNone(x.items)),
    trends: (d) => body(d, (x) => ['products', 'tickers', 'searches', 'feeds'].every((k) => listOrNone(x[k]))),
    'surf-coast': (d) => body(d, (x) => listOrNone(x.spots)),
    'housing/national?part=summary': (d) => body(d, (x) => x.us == null || isObj(x.us)),
    'realestate/homes?limit=3': (d) => body(d, (x) => listOrNone(x.rows)),
    'cre/deals?limit=3': (d) => body(d, (x) => listOrNone(x.rows)),
    jobs: (d) => body(d, (x) => isObj(x.market))
  };
  return { DOMAIN, ageText, whyDown, dayOf, whyText, sourceText, gapsModel, gapHtml, gapsHtml, unavailable, surfModel, resModel, comModel, jobsModel, searchesModel, page, fresh, dataModel, SHAPE, GAPS_FIRST };
})();

// ---------- page glue: DeckPages registry, fetch, taps ----------
(() => {
  if (typeof DeckPages === 'undefined' || typeof document === 'undefined') return;
  const W = DeckWorld, FETCH_MS = 60000;
  // each read paints as it answers; a read that failed keeps its error body so the panel says why
  const PARTS = { g: 'gaps', tr: 'trends', surf: 'surf-coast', house: 'housing/national?part=summary', homes: 'realestate/homes?limit=3', cre: 'cre/deals?limit=3', jobs: 'jobs' };
  const S = { view: {}, ctx: null, seq: 0, wired: null };
  for (const k of Object.keys(PARTS)) S[k] = undefined;
  const state = () => ({ g: S.g, tr: S.tr, surf: S.surf, house: S.house, homes: S.homes, cre: S.cre, jobs: S.jobs, now: Date.now(), view: S.view });
  function paint() {
    const c = S.ctx;
    if (!c || !c.el) return;
    // a repaint keeps every opened gap open
    const open = new Set([...c.el.querySelectorAll('details.wg[open]')].map((d) => d.dataset.key));
    try { c.el.innerHTML = W.page(state()); } catch (e) { c.el.innerHTML = DeckUI.empty({ k: 'bad', title: 'Could not show World', retry: 'world' }); }
    open.forEach((k) => { const d = c.el.querySelector('details.wg[data-key="' + CSS.escape(k) + '"]'); if (d) d.open = true; });
    if (S.g !== undefined) DeckPages.mark(c, W.fresh(state()));
    DeckPages.tv(c);
  }
  function fetchAll() {
    const n = ++S.seq;
    return Promise.all(Object.keys(PARTS).map((k) => DeckPages.get(PARTS[k], { timeout: FETCH_MS, shape: W.SHAPE[PARTS[k]] }).then((r) => {
      if (n !== S.seq) return;
      S[k] = r && r.ok && r.data && !r.data.error ? Object.assign({}, r.data, { stale: r.data.stale === true || r.stale === true })
        : { error: (r && r.data && r.data.error) || (r && r.error) || 'http ' + (r ? r.status : 0) };
      paint();
    })));
  }
  function tap(ev) {
    const t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    if (t.closest('[data-retry="world"]')) return fetchAll();
    const m = t.closest('button[data-more="gaps"]');
    if (m) { S.view.gaps = m.dataset.less ? W.GAPS_FIRST : Math.max(S.view.gaps || W.GAPS_FIRST, W.GAPS_FIRST) + W.GAPS_FIRST; paint(); }
  }
  DeckPages.register('world', {
    every: 60000,
    show(ctx) {
      S.ctx = ctx;
      if (S.wired !== ctx.el) { ctx.el.addEventListener('click', tap); S.wired = ctx.el; }
      paint();
      return fetchAll();
    },
    refresh(ctx) { S.ctx = ctx; return fetchAll(); },
    hide() { S.ctx = null; },
    data() { return W.dataModel(state()); }
  });
})();
