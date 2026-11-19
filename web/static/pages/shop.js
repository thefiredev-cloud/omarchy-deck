// Shop > Market and Shop > Orders (Deck v3, lane PgShop, 2026-11-14).
// Market reads GET /api/ecom-market (contract plan/EcomFeed.md) plus /api/ecom (watch detail: range, stores, supply, condition,
// season, local resale) and /api/listings (posted ages). Orders reads GET /api/commerce. The page shows prices and moves; store
// health, coverage and setup live in the Data sheet. Model functions are pure (tests call them); render functions return HTML
// strings built with DeckUI helpers (UiApi section 3); the glue at the bottom registers both routes with DeckPages.
const DeckShop = (() => {
  'use strict';
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const arr = (x) => (Array.isArray(x) ? x : []);
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  const str = (x, n) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200) : '');
  const U = () => DeckUI;
  const esc = (s) => U().esc(s);
  const F = () => U().fmt;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- words and numbers ----------
  // feed labels are lower case ("rtx 4080"): first letter up, short vowel-less codes (rtx, dgx, ssd) in capitals
  const nice = (s) => {
    const t = str(s, 120);
    if (!t) return '';
    const w = t.split(' ').map((x) => (/^[b-df-hj-np-tv-xz]{2,4}$/i.test(x) ? x.toUpperCase() : x));
    w[0] = w[0].charAt(0).toUpperCase() + w[0].slice(1);
    return w.join(' ');
  };
  // product titles as sellers write them: emoji, shouting separators and price echoes go; every word that remains is kept
  const cleanTitle = (s) => {
    let t = str(s, 400).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ');
    t = t.split('|').map((p) => p.trim()).filter((p) => p && !/^\$?[\d,.]+$/.test(p)).join(' · ');
    return t.replace(/\s+/g, ' ').replace(/^[\s·,-]+|[\s·,-]+$/g, '').trim() || 'Product';
  };
  // a shop price: cents under $100, else the deck's money rules
  const price = (v) => (num(v) == null ? F().na() : num(v) < 100 ? F().money(v, { cents: true }) : F().money(v));
  const priceText = (v) => (num(v) == null ? 'No data' : num(v) < 100 ? F().money(v, { cents: true }) : F().money(v));
  // the publisher's period as a reader says it: 2026-Q2 Q2 2026, 2026-10 Oct 2026, 2026-11-12 Nov 12
  function periodLabel(p) {
    const s = str(p, 40);
    let m = /^(\d{4})-Q([1-4])$/.exec(s);
    if (m) return 'Q' + m[2] + ' ' + m[1];
    m = /^(\d{4})-(\d{2})$/.exec(s);
    if (m && MON[+m[2] - 1]) return MON[+m[2] - 1] + ' ' + m[1];
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m && MON[+m[2] - 1]) return MON[+m[2] - 1] + ' ' + +m[3];
    return s.replace(/(\d{4})-(\d{2})-(\d{2})/g, (x, y, mo, d) => (MON[+mo - 1] ? MON[+mo - 1] + ' ' + +d : x));
  }
  const dir = (v) => (num(v) == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : 'flat');
  // a change with its sign and true minus, as a delta mark; pts for point changes. The mark follows the printed value: a change
  // that prints as "0.0%" has no sign, so it gets the flat mark, never an up mark on no change (SeeViz V6)
  const delta = (v, pts) => {
    if (num(v) == null) return '';
    const t = pts ? F().pt(v) : F().chg(v);
    return '<span class="delta ' + (/^[+\u2212-]/.test(t) ? dir(v) : 'flat') + '">' + esc(t) + '</span>';
  };
  // daily series from [[day, value]]: one slot per calendar day between the first and the last, null where a day is missing
  function daily(hist, maxDays) {
    const pts = arr(hist).filter((h) => Array.isArray(h) && /^\d{4}-\d{2}-\d{2}$/.test(str(h[0], 10)) && num(h[1]) != null);
    if (!pts.length) return [];
    const day = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
    const first = day(pts[0][0]), last = day(pts[pts.length - 1][0]), out = [];
    for (let d = Math.max(first, last - (maxDays || 30) + 1); d <= last; d++) out.push(null);
    const base = last - out.length + 1;
    for (const [k, v] of pts) { const i = day(k) - base; if (i >= 0 && i < out.length) out[i] = v; }
    return out;
  }
  // the same days as [[label, value]] pairs for DeckUI.line
  function dailyPairs(hist, maxDays) {
    const v = daily(hist, maxDays), pts = arr(hist).filter((h) => Array.isArray(h) && /^\d{4}-\d{2}-\d{2}$/.test(str(h[0], 10)));
    if (!v.length || !pts.length) return [];
    const last = pts[pts.length - 1][0], end = Date.UTC(+last.slice(0, 4), +last.slice(5, 7) - 1, +last.slice(8, 10));
    return v.map((x, i) => { const d = new Date(end - (v.length - 1 - i) * 86400000); return [MON[d.getUTCMonth()] + ' ' + d.getUTCDate(), x]; });
  }
  const values = (hist) => arr(hist).filter((h) => Array.isArray(h) && num(h[1]) != null).map((h) => h[1]);

  // ---------- macro strip ----------
  // blueprint order; the last two show on D and XL only (dx), so phones, tablets and the TV board keep six
  const STRIP = [
    ['ecom_share', 'Online share of retail'], ['ecom_sales', 'Online sales'], ['retail_sales', 'Retail sales'],
    ['cpi_core_goods', 'Core goods prices'], ['container_wci', 'Shipping'], ['diesel', 'Diesel'],
    ['fedex_ground_fuel', 'Parcel fuel surcharge', true], ['port_la_imports', 'Port imports', true]];
  const CADENCE = { weekly: '1-wk', monthly: '1-mo', quarterly: '1-qtr', daily: '1-day' };
  const UNIT_WORD = { usd_feu: 'per 40 ft box', usd_gal: 'per gallon', teu: 'containers' };
  // one tile: the headline number, its change (1-yr when published, else against the prior period), the sparkline and the period.
  // An index has no meaning as a level, so its change is the headline.
  function macroTile(m, label, dx) {
    const unit = str(m.unit, 10), yoy = num(m.yoy), ch = num(m.change);
    const useYoy = yoy != null, cv = useYoy ? yoy : ch, cu = useYoy ? m.yoy_unit : m.change_unit;
    const cword = useYoy ? '1-yr' : CADENCE[str(m.cadence, 12)] || '';
    const pts = cu === 'pct_pts';
    let value = null;
    const v = num(m.value);
    if (unit === 'index') value = cv == null ? null : pts ? F().pt(cv) : F().chg(cv);
    else if (v == null) value = null;
    else if (unit === 'pct') value = F().share(v);
    else if (unit === 'usd_m') value = F().money(v * 1e6);
    else if (unit === 'usd_b') value = F().money(v * 1e9);
    else if (unit === 'usd' || unit === 'usd_gal') value = F().money(v, { cents: true });
    else if (unit === 'usd_feu') value = F().money(v);
    else value = F().count(v);
    return {
      key: str(m.key, 40), label, dx: !!dx, value, unit: UNIT_WORD[unit] || '',
      chg: unit === 'index' ? null : cv, pts, cword: unit === 'index' ? cword : cword,
      period: periodLabel(m.period), spark: values(m.hist).slice(-24)
    };
  }
  function macroModel(feed) {
    const by = {};
    arr(isObj(feed) && feed.macro).filter(isObj).forEach((m) => { by[str(m.key, 40)] = m; });
    return STRIP.filter(([k]) => by[k]).map(([k, label, dx]) => macroTile(by[k], label, dx)).filter((t) => t.value != null);
  }

  // ---------- watches ----------
  // the confidence mark's words come from the feed's own reasons ("3 of 6 sites")
  function agreeOf(conf) {
    const r = arr(isObj(conf) && conf.reasons).map((x) => str(x, 60)).find((x) => /^\d+ of \d+ sites?$/.test(x));
    const m = r ? /^(\d+) of (\d+)/.exec(r) : null;
    return m ? { agree: +m[1], total: +m[2] } : null;
  }
  const confHtml = (conf) => {
    const s = num(isObj(conf) && conf.score);
    if (s == null) return '';
    const a = agreeOf(conf);
    return U().conf(s, a || {});
  };
  // old /api/ecom watch rows by slug, for the sheet's range, stores, supply, condition, season and best link
  const oldBySlug = (e) => { const o = {}; arr(isObj(e) && e.watch).filter(isObj).forEach((w) => { o[str(w.slug, 80)] = w; }); return o; };
  // the feed's listing condition in words; new says nothing (DoEcomData D7: `best` is new only, `best_used` is the rest)
  const COND_WORD = { used: 'used', refurbished: 'refurbished', open_box: 'open box', unknown: 'condition not stated' };
  // one listing the feed names as the watch's lowest: price, store, its own title and link, and its condition in words.
  // used: the listing came from `best_used`, so it is never read as new even when the feed left out its condition
  function offerOf(b, oldUrl, used) {
    if (!isObj(b) || num(b.price) == null) return null;
    const c = str(b.condition, 20).toLowerCase().replace(/[\s-]+/g, '_');
    const cond = c && c !== 'new' ? COND_WORD[c] || c.replace(/_/g, ' ') : used ? 'not new' : '';
    return { price: b.price, store: str(b.platform, 40), title: str(b.title, 400) ? cleanTitle(b.title) : '', url: U().safeUrl(str(b.url, 600)) || oldUrl || '', cond };
  }
  // the feed's plain reason as a sentence ("no listing passed the price checks" -> "No listing passed the price checks.")
  const sentence = (s) => { const t = str(s, 200); return t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/[.;,\s]+$/, '') + '.' : ''; };
  // GET /api/ecom resale[]: what a watched item asks on the local marketplaces near home, against the same item new
  const ROLE_WORD = { own: 'Yours', buy: 'Buying', watch: 'Watching' };
  const resaleBySlug = (e) => { const o = {}; arr(isObj(e) && e.resale).filter(isObj).forEach((r) => { o[str(r.slug, 80)] = r; }); return o; };
  function localOf(r) {
    if (!isObj(r)) return null;
    const n = num(r.n) || 0, vs = num(r.vs_retail), nw = num(r.retail_median);
    return {
      slug: str(r.slug, 80), name: nice(r.query || r.slug) || 'Item', role: ROLE_WORD[str(r.role, 10)] || 'Watching', area: str(r.area, 60),
      n, median: n > 0 ? num(r.median) : null, newPrice: nw, ofNew: vs != null && nw != null ? Math.round((1 + vs) * 100) : null,
      t: num(r.t), stale: r.stale === true || num(r.t) == null
    };
  }
  // the watch card: the best price leads (a new listing; else the lowest used one, said as used; else the feed's reason), the
  // median beside it in words, the 7-day change on the 7 days it names, a 1-day change when the feed carries `change_1d`
  function watchModel(w, old, local) {
    const o = isObj(old) ? old : {}, be = isObj(w.best) ? w.best : null, ob = isObj(o.best) ? o.best : null;
    const url = ob && num(ob.price) != null && be && Math.abs(ob.price - num(be.price)) < 0.01 ? U().safeUrl(ob.url) : '';
    const best = offerOf(be, url, false), used = best ? null : offerOf(w.best_used, '', true);
    return {
      slug: str(w.slug, 80), name: nice(w.label || o.query || w.slug) || 'Watch', cat: str(w.category, 20),
      median: num(w.median), conf: isObj(w.confidence) ? w.confidence : null, chg1: num(w.change_1d), chg7: num(w.change_7d), chg30: num(w.change_30d),
      spark: daily(w.hist, 8), best, used, why: best || used ? '' : sentence(w.best_reason), local: localOf(local)
    };
  }
  const catKey = (c) => ({ computer: 'computers', computers: 'computers' }[str(c, 20)] || str(c, 20));

  // ---------- trending (GET /api/trends, products) ----------
  // What is trending in public sources (best-seller ranks and their moves), not what he watches (owner, 2026-11-17). Each row
  // keeps the feed's order (the producer ranks across sources), its source's own age from `feeds[]` (matched by `source_id`, else by
  // `source` when the producer wrote the id there), and says when that source failed. A source name is printed as the producer wrote it.
  const srcWord = (s) => nice(str(s, 60).replace(/[-_]+/g, ' '));
  function trendingList(tr, cat) {
    if (!isObj(tr) || tr.error || !Array.isArray(tr.products)) return null;
    const fa = {};
    arr(tr.feeds).filter(isObj).forEach((f) => { fa[str(f.id, 60)] = f; });
    return tr.products.filter((p) => isObj(p) && str(p.title, 200)).map((p, i) => {
      const src = str(p.source, 80), f = fa[str(p.source_id, 60)] || fa[src] || null;
      return {
        key: 'trend:' + i, title: cleanTitle(p.title), cat: catKey(str(p.category, 40).toLowerCase()), source: !src ? '' : fa[src] ? srcWord(src) : src,
        rank: num(p.rank) != null && p.rank >= 1 ? Math.round(p.rank) : null, move: num(p.rank_change) != null ? Math.round(p.rank_change) : null,
        signal: str(p.signal, 160), median: num(p.price_median) != null && p.price_median >= 0 ? p.price_median : null,
        url: U().safeUrl(str(p.url, 600)), age: f && num(f.age_s) != null ? f.age_s : null, down: !!f && f.ok === false
      };
    }).filter((p) => !cat || cat === 'all' || p.cat === cat);
  }
  // the Data sheet's row for the trends feed
  function trendsSource(tr) {
    if (!isObj(tr)) return { name: 'Trending products', gives: 'Not read yet', asOf: '', state: 'never' };
    if (tr.error) return { name: 'Trending products', gives: 'Not reporting', asOf: '', state: 'never' };
    const t = num(tr.t), bad = arr(tr.feeds).filter((f) => isObj(f) && f.ok === false).map((f) => srcWord(f.id)).filter(Boolean);
    return {
      name: 'Trending products', gives: arr(tr.products).length + ' products' + (bad.length ? ', not reporting: ' + bad.join(', ') : ''),
      asOf: t != null ? new Date(t * 1000).toISOString().slice(0, 10) : '', state: tr.stale === true || bad.length ? 'stale' : 'ok'
    };
  }

  // ---------- watch sheet ----------
  const LOCAL = ['craigslist', 'offerup', 'facebook-marketplace'];
  const SITE = { newegg: 'Newegg', 'facebook-marketplace': 'Facebook Marketplace', offerup: 'OfferUp', craigslist: 'Craigslist', amazon: 'Amazon', walmart: 'Walmart', bestbuy: 'Best Buy', poshmark: 'Poshmark', ebay: 'eBay', backmarket: 'Back Market', gamestop: 'GameStop', microcenter: 'Micro Center', macys: "Macy's", costco: 'Costco' };
  const siteName = (k, e) => {
    const s = arr(isObj(e) && isObj(e.coverage) && e.coverage.sites).filter(isObj).find((x) => str(x.site, 40) === k);
    return (s && str(s.label, 40)) || SITE[k] || nice(k);
  };
  // l = GET /api/listings: this watch's public marketplace listings join the sheet (null when the read failed)
  function watchSheetModel(w, old, e, l) {
    const o = isObj(old) ? old : {}, base = watchModel(w, o);
    const stores = arr(isObj(w.detail) && w.detail.by_platform).filter((b) => isObj(b) && num(b.median) != null)
      .map((b) => ({ store: str(b.platform, 40), median: b.median, n: num(b.n) }))
      .sort((a, b) => a.median - b.median);
    const ci = isObj(w.ci) ? w.ci : {};
    // the band is the middle half of the per-store medians (the same basis as the median); the ends are the lowest and highest listing
    const range = {
      min: num(o.min), p25: num(ci.lo), med: base.median, p75: num(ci.hi), max: num(o.max), cur: base.best ? base.best.price : base.used ? base.used.price : null
    };
    const sup = isObj(o.supply) ? o.supply : null, shp = isObj(o.shipping) ? o.shipping : null, cd = isObj(o.condition) ? o.condition : null;
    const supply = [];
    if (sup && num(sup.listings) != null) supply.push(['Listings', F().count(sup.listings)]);
    if (sup && num(sup.new_24h) != null) supply.push(['New in 24 h', F().count(sup.new_24h)]);
    if (sup && num(sup.price_drops_7d) != null) supply.push(['Price drops, 7 days', F().count(sup.price_drops_7d)]);
    if (shp && num(shp.free_share) != null) supply.push(['Ship free', F().share(shp.free_share * 100)]);
    if (shp && num(shp.median_cost) != null) supply.push(['Shipping cost', priceText(shp.median_cost)]);
    if (shp && num(shp.pickup_only) != null) supply.push(['Pickup only', F().count(shp.pickup_only)]);
    const condition = cd ? [['New', cd.new], ['Used', cd.used], ['Refurbished', cd.refurbished], ['Open box', cd.open_box], ['Not stated', cd.unknown]]
      .filter((x) => num(x[1]) != null && x[1] > 0).map((x) => [x[0], F().count(x[1])]) : [];
    const se = isObj(o.season) ? arr(o.season.by_month) : [];
    const season = se.length === 12 && se.some((x) => num(x) != null) ? se.map((v, i) => ({ label: MON[i], value: num(v) })) : null;
    // the listing the card names (its own title and link from the market feed) leads; an older feed's best row stands in
    const fo = base.best || base.used, ob = isObj(o.best) ? o.best : null;
    const bestLink = fo && fo.url && fo.title ? { title: fo.title, price: fo.price, store: fo.store, url: fo.url, cond: fo.cond }
      : ob && U().safeUrl(ob.url) && num(ob.price) != null
        ? { title: cleanTitle(ob.title), price: ob.price, store: siteName(str(ob.site, 40), e), url: U().safeUrl(ob.url), cond: str(ob.condition, 20) } : null;
    const it = isObj(w.interest) ? w.interest : null;
    const missing = [];
    if (range.min == null || range.max == null) missing.push('lowest and highest price');
    if (!stores.length) missing.push('prices by store');
    if (!season) missing.push('season');
    if (!supply.length) missing.push('supply and shipping');
    if (!condition.length) missing.push('condition');
    if (base.chg30 == null) missing.push('30-day change');
    const resale = resaleModel(old);
    if (!resale) missing.push('flip and sold');
    else {
      if (!resale.flip) missing.push('flip');
      if (resale.sold == null) missing.push('sold count');
    }
    const keys = new Set([qkey(w.label), qkey(o.query), qkey(w.slug)].filter(Boolean));
    const listings = listingRows(l, e, (q) => keys.has(qkey(q)));
    if (!listings) missing.push('marketplace listings');
    return Object.assign(base, {
      stores, range, supply, condition, season, bestLink, line: dailyPairs(w.hist, 30), period: str(w.period, 40),
      interest: it && num(it.views) != null ? { views: it.views, period: periodLabel(it.period), chg: num(it.change_pct) } : null, missing,
      resale, dupes: arr(o.groups).filter(isObj).map((g) => lstGroup(g, e)), dupesTotal: num(o.groups_total), listings
    });
  }

  // ---------- best sellers and movers ----------
  const KIND = { bestseller: 'Best seller', rank_gain: 'Rank up', price_drop: 'Price drop', price_rise: 'Price up', on_sale: 'On sale', under_median: 'Under median', new_low: 'New low' };
  const KIND_ORDER = ['price_drop', 'under_median', 'new_low', 'rank_gain', 'price_rise', 'bestseller', 'on_sale'];
  const MOVER_CHIPS = [['all', 'All'], ['bestseller', 'Best seller'], ['rank_gain', 'Rank up'], ['price_drop', 'Price drop'], ['under_median', 'Under median'], ['new_low', 'New low']];
  const lowOffer = (p) => arr(isObj(p.detail) && p.detail.offers).filter((o) => isObj(o) && num(o.price) != null).sort((a, b) => a.price - b.price)[0] || null;
  function productModel(p, i) {
    const pr = isObj(p.price) ? p.price : {}, low = lowOffer(p), n = num(p.platforms_n) || arr(isObj(p.detail) && p.detail.offers).length || 1;
    const kind = KIND[p.kind] ? p.kind : 'bestseller', cp = num(p.change_pct);
    let move = '';
    if (cp != null) move = kind === 'on_sale' ? 'vs regular' : kind === 'under_median' ? 'vs median' : str(p.period, 40) ? periodLabel(str(p.period, 40)).replace(/^7 days to .*/, '7 days') : '';
    return {
      // a watch's own move carries the watch label ("rtx 4080"): cased like the watch card
      key: str(p.gid, 120) || 'p' + i, title: /^watch:/.test(str(p.gid, 120)) ? nice(p.title) : cleanTitle(p.title), cat: str(p.category, 20), kind, kindWord: KIND[kind],
      price: num(pr.low) != null ? pr.low : low ? low.price : null, where: n > 1 ? n + ' stores' : low ? str(low.platform, 40) : '',
      median: n > 1 ? num(pr.median) : null, spread: n > 1 && num(pr.high) != null && num(pr.low) != null ? pr.high - pr.low : null,
      stores: n, chg: cp, move, rank: num(p.rank), rankChg: num(p.rank_change)
    };
  }
  // the owner's own price moves first, then rank and price changes, then best sellers taking turns across categories, then sales
  function productList(feed, cat, kind) {
    const f = isObj(feed) ? feed : {}, okCat = (p) => !cat || cat === 'all' || str(p.category, 20) === cat;
    const all = arr(f.movers).concat(arr(f.bestsellers)).filter((p) => isObj(p) && okCat(p) && (!kind || kind === 'all' || p.kind === kind));
    const seen = new Set(), out = [];
    for (const k of KIND_ORDER) {
      let xs = all.filter((p) => p.kind === k);
      if (k === 'bestseller') {
        const by = {};
        xs.slice().sort((a, b) => (num(a.rank) || 999) - (num(b.rank) || 999)).forEach((p) => { (by[str(p.category, 20)] = by[str(p.category, 20)] || []).push(p); });
        const lists = Object.values(by); xs = [];
        for (let i = 0; lists.some((l) => l[i]); i++) lists.forEach((l) => { if (l[i]) xs.push(l[i]); });
      } else if (k === 'rank_gain') xs.sort((a, b) => (num(b.rank_change) || 0) - (num(a.rank_change) || 0));
      else xs.sort((a, b) => Math.abs(num(b.change_pct) || 0) - Math.abs(num(a.change_pct) || 0));
      xs.forEach((p) => { const g = str(p.gid, 120) || cleanTitle(p.title); if (!seen.has(g)) { seen.add(g); out.push(p); } });
    }
    return out.map(productModel);
  }
  function productSheetModel(p) {
    const m = productModel(p, 0);
    const offers = arr(isObj(p.detail) && p.detail.offers).filter(isObj).map((o) => ({
      store: str(o.platform, 40), price: num(o.price), regular: num(o.regular), discount: num(o.discount_pct),
      reference: num(o.reference), rank: num(o.rank), url: U().safeUrl(o.url), day: periodLabel(str(o.as_of, 10))
    })).sort((a, b) => (a.price == null) - (b.price == null) || a.price - b.price);
    return Object.assign(m, { fullTitle: cleanTitle(p.title), brand: nice(p.brand), offers, asOf: periodLabel(str(p.as_of, 10)) });
  }

  // ---------- listing events (GET /api/ecom movers, movers_info: SeeLostSweep L08) ----------
  // A listing on a watch's search that dropped its price, came in new under the watch's median, or set a new low. They join
  // "Best sellers and movers" as kinds, ahead of the store movers (they are the owner's own watches). The watch-level `trend`
  // rows repeat the watch card's 7-day change, so they are not drawn. A feed with no `movers_info` is an older one whose movers
  // are watch medians: none are drawn. When the prices behind them stopped coming in, each row says Out of date.
  const EVENT_KIND = { drop: 'price_drop', under_median: 'under_median', new_low: 'new_low' };
  function eventsStale(e, now) {
    const mi = isObj(e) && isObj(e.movers_info) ? e.movers_info : null;
    if (!mi) return null;
    const thru = num(mi.data_through), refresh = num(e.refresh) || 3600;
    return mi.stale === true || thru == null || (num(now) != null && now / 1000 - thru > 2 * refresh);
  }
  function eventList(e, feed, cat, kind, now) {
    const stale = eventsStale(e, now);
    if (stale == null) return [];
    const wcat = {};
    arr(isObj(feed) && isObj(feed.watches) && feed.watches.items).filter(isObj).forEach((w) => { wcat[str(w.slug, 80)] = catKey(w.category); });
    const seen = new Set();
    return arr(e.movers).filter((m) => isObj(m) && EVENT_KIND[str(m.kind, 20)] && num(m.price) != null).map((m, i) => {
      const k = EVENT_KIND[str(m.kind, 20)], ch = num(m.chg7), ref = num(m.ref), url = U().safeUrl(str(m.url, 600));
      const c = str(m.condition, 20).toLowerCase().replace(/[\s-]+/g, '_');
      return {
        key: 'l:' + (url || i), title: cleanTitle(m.title), cat: wcat[str(m.slug, 80)] || '', kind: k, kindWord: KIND[k], price: m.price,
        where: siteName(str(m.site, 40), e), url, chg: ch == null ? null : ch * 100, cond: c && c !== 'new' ? COND_WORD[c] || c.replace(/_/g, ' ') : '',
        move: ref == null ? '' : (k === 'price_drop' ? 'from ' : k === 'under_median' ? 'vs median ' : 'vs last low ') + priceText(ref), stale, event: true
      };
    }).filter((r) => (!cat || cat === 'all' || r.cat === cat) && (!kind || kind === 'all' || r.kind === kind))
      .filter((r) => { const k = r.url || r.title + '|' + r.price; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || Math.abs(b.chg || 0) - Math.abs(a.chg || 0));
  }

  // ---------- sells locally (GET /api/ecom resale: SeeLostSweep L07) ----------
  // asking prices on the local marketplaces near home for each watched item, against the same item new; items with no local
  // listing now come last. Platform names stay in the watch sheet.
  function localList(e, feed, cat) {
    const wcat = {};
    arr(isObj(feed) && isObj(feed.watches) && feed.watches.items).filter(isObj).forEach((w) => { wcat[str(w.slug, 80)] = catKey(w.category); });
    return arr(isObj(e) && e.resale).filter(isObj).map(localOf)
      .filter((r) => !cat || cat === 'all' || wcat[r.slug] === cat)
      .sort((a, b) => (a.median == null) - (b.median == null));
  }

  // ---------- macro takeaway (GET /api/ecom macro[].takeaway: SeeLostSweep L09) ----------
  // one plain sentence, the season one, from the online sales series ("November runs 16% above the yearly average: buyers are
  // out, a good month to list."); the year-on-year sentence repeats the strip, so it is left out. Never two.
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function takeaway(e) {
    const ms = arr(isObj(e) && e.macro).filter((m) => isObj(m) && str(m.takeaway, 400));
    const m = ms.find((x) => str(x.key, 40) === 'nonstore_retail') || ms[0];
    if (!m) return '';
    const parts = str(m.takeaway, 400).split('. ').map((x, i, a) => (i < a.length - 1 ? x + '.' : x));
    const s = parts.find((x) => MON.includes(x.slice(0, 3)) && /^[A-Z][a-z]{2} /.test(x)) || parts[parts.length - 1];
    return s.replace(/^([A-Z][a-z]{2}) /, (x, mo) => (MON.includes(mo) ? MONTH[MON.indexOf(mo)] + ' ' : x));
  }

  // ---------- category prices ----------
  const CAT_ORDER = ['computers', 'home', 'outdoors', 'grocery', 'music', 'apparel', 'electronics', 'beauty', 'collectibles'];
  const CAT_CORE = ['computers', 'home', 'outdoors', 'grocery'];
  const BUILD_DAYS = 14;
  // the value's own period: an official month-over-month change says its month, the store index says its window
  function catPeriod(c) {
    const b = str(c.basis, 20), p = str(c.period, 80);
    if (b === 'official_mom') return { word: '1-mo', when: periodLabel(p) };
    if (b === 'platforms') return { word: /^30 days/.test(p) ? '30 days' : '', when: periodLabel(p.replace(/^30 days to /, '')) };
    if (b === 'blend') {
      const [pl, off] = p.split(/;\s*official\s*/);
      return { word: 'blend', when: periodLabel(pl.replace(/^30 days to /, '30 days to ')) + (off ? ' · ' + periodLabel(off) : '') };
    }
    return { word: '', when: '' };
  }
  function categoryModel(c) {
    const pi = isObj(c.platform_index) ? c.platform_index : null, v = num(c.value), basis = str(c.basis, 20) || null;
    const days = pi && num(pi.span_days) != null ? Math.round(pi.span_days) : 0;
    const off = isObj(c.official) ? c.official : null;
    return {
      key: str(c.key, 30), label: str(c.label, 60) || nice(c.key), basis, value: v, period: catPeriod(c),
      conf: basis === 'platforms' || basis === 'blend' ? (isObj(c.confidence) ? c.confidence : null) : null,
      index: pi && num(pi.value) != null ? pi.value : null, chg7: pi ? num(pi.change_7d) : null, chg30: pi ? num(pi.change_30d) : null,
      spark: pi ? daily(pi.hist, 30) : [], ref: off ? values(off.hist) : [],
      building: v == null, days, indexBuilding: pi != null && days < BUILD_DAYS && basis === 'official_mom'
    };
  }
  function categoryList(feed, cat) {
    const by = {};
    arr(isObj(feed) && feed.categories).filter(isObj).forEach((c) => { by[str(c.key, 30)] = c; });
    const keys = CAT_ORDER.filter((k) => by[k]).concat(Object.keys(by).filter((k) => !CAT_ORDER.includes(k)));
    return keys.map((k) => categoryModel(by[k]))
      .filter((m) => (!cat || cat === 'all' ? m.value != null || m.index != null || CAT_CORE.includes(m.key) : m.key === cat));
  }

  // ---------- platforms ----------
  const PKIND = { marketplace: 'Marketplace', retailer: 'Retailer', resale: 'Resale', brand: 'Brand', grocery: 'Grocery' };
  const KIND_CHIPS = [['all', 'All'], ['retailers', 'Retailers'], ['marketplaces', 'Marketplaces'], ['resale', 'Resale']];
  const kindOk = (k, sel) => !sel || sel === 'all' || (sel === 'retailers' ? ['retailer', 'grocery', 'brand'].includes(k) : sel === 'marketplaces' ? k === 'marketplace' : k === 'resale');
  // board order as the feed ranks it; a platform with no rank signal stays, listed last, its ranks absent (never zero)
  function platformRows(feed, sel, max) {
    return arr(isObj(feed) && feed.platforms).filter(isObj).filter((p) => kindOk(str(p.kind, 20), sel))
      .slice().sort((a, b) => (num(a.rank) == null) - (num(b.rank) == null) || (num(a.rank) || 0) - (num(b.rank) || 0))
      .slice(0, max || 30).map((p) => {
        const s = isObj(p.signals) ? p.signals : {};
        return {
          key: str(p.domain, 80) || str(p.name, 60), name: str(p.name, 60) || str(p.domain, 80), rank: num(p.rank), kind: PKIND[p.kind] || nice(p.kind),
          move: num(s.tranco_change_30d), app: num(s.app_rank), web: num(s.tranco_rank), appMove: num(s.app_change_7d),
          priced: p.price_coverage === 'ok', score: num(p.score), note: str(p.note, 200)
        };
      });
  }

  // ---------- trends, deals, costs, setup ----------
  const trendRows = (feed) => arr(isObj(feed) && feed.trending).filter((t) => isObj(t) && t.shopping === true)
    .map((t) => ({ title: nice(t.title), traffic: str(t.traffic, 20) }));
  const LOCAL_NAMES = ['Craigslist', 'OfferUp', 'Facebook Marketplace'];
  // under-median retail listings and local resale for the owner's watches. vs median is against the watch's cross-store median.
  function dealRows(feed, e, l, opt) {
    const o = opt || {}, cat = o.cat, cond = o.cond, out = [], seen = new Set();
    const watches = {};
    arr(isObj(feed) && isObj(feed.watches) && feed.watches.items).filter(isObj).forEach((w) => { watches[str(w.slug, 80)] = w; });
    const posted = {};
    arr(isObj(l) && l.listings).filter(isObj).forEach((x) => { const u = U().safeUrl(x.url); if (u && num(x.posted_at) != null) posted[u] = x.posted_at; });
    const add = (r) => { const k = r.url || r.item + '|' + r.price; if (seen.has(k) || num(r.price) == null) return; seen.add(k); out.push(r); };
    const okCat = (c) => !cat || cat === 'all' || catKey(c) === cat;
    arr(isObj(feed) && feed.movers).filter((p) => isObj(p) && p.kind === 'under_median' && okCat(p.category)).forEach((p) => {
      const of = lowOffer(p) || {}, u = U().safeUrl(of.url), where = str(of.platform, 40);
      add({ item: cleanTitle(p.title), price: num(of.price) != null ? of.price : isObj(p.price) ? num(p.price.low) : null, vs: num(p.change_pct), where,
        pickup: LOCAL_NAMES.includes(where), url: u, posted: u && posted[u] != null ? posted[u] : null, cond: '' });
    });
    arr(isObj(e) && e.resale).filter((r) => isObj(r) && isObj(r.best)).forEach((r) => {
      const w = watches[str(r.slug, 80)];
      if (!okCat(w ? w.category : '')) return;
      const b = r.best, med = w ? num(w.median) : null, u = U().safeUrl(b.url), site = str(b.site, 40);
      add({ item: cleanTitle(b.title), price: num(b.price), vs: med && num(b.price) != null ? ((b.price - med) / med) * 100 : null,
        where: siteName(site, e), pickup: LOCAL.includes(site), url: u, posted: u && posted[u] != null ? posted[u] : null, cond: str(b.condition, 20).toLowerCase() });
    });
    arr(isObj(e) && e.deals).filter(isObj).forEach((d) => {
      const site = str(d.site, 40), u = U().safeUrl(d.url);
      add({ item: cleanTitle(d.title), price: num(d.price), vs: num(d.vs_median) != null ? d.vs_median * 100 : null, where: siteName(site, e),
        pickup: LOCAL.includes(site), url: u, posted: u && posted[u] != null ? posted[u] : null, cond: str(d.condition, 20).toLowerCase() });
    });
    return out.filter((r) => cond !== 'new' || r.cond === 'new')
      .sort((a, b) => (a.vs == null) - (b.vs == null) || (a.vs || 0) - (b.vs || 0));
  }
  const COST_KEYS = ['fedex_ground_fuel', 'fedex_express_fuel', 'usps_priority_env', 'usps_small_box', 'usps_medium_box', 'usps_large_box'];
  function costRows(feed) {
    const by = {};
    arr(isObj(feed) && feed.macro).filter(isObj).forEach((m) => { by[str(m.key, 40)] = m; });
    return COST_KEYS.filter((k) => by[k] && num(by[k].value) != null).map((k) => {
      const m = by[k];
      return { label: str(m.label, 80), value: m.unit === 'pct' ? F().share(m.value) : priceText(m.value), chg: num(m.change), pts: m.change_unit === 'pct_pts', period: periodLabel(m.period) };
    });
  }
  const STATE = { ok: 'ok', stale: 'stale', needs_key: 'needs_key', refused: 'blocked', error: 'blocked' };
  const GIVES = { macro: 'Economy', prices: 'Store prices', platforms: 'Platform ranks', interest: 'Interest' };
  // the stores that need the owner: a free key would open them, or the store walls the collector it used to read
  function setupModel(feed) {
    const rows = [];
    arr(isObj(feed) && feed.sources).filter(isObj).forEach((s) => {
      const name = str(s.name, 80).replace(/ listings$/, '').replace(/ (Browse|Products|Open) API.*$/, '').replace(/ API.*$/, ''), g = str(s.group, 20);
      if (s.status === 'needs_key') rows.push({ id: str(s.id, 60), name, store: g === 'prices', state: 'needs_key', line: name + (g === 'prices' ? ' prices need a free developer key' : g === 'macro' ? ' figures need a free key' : ' ranks need a free key') });
      else if (s.status === 'refused' && s.kind === 'collector') rows.push({ id: str(s.id, 60), name, store: true, state: 'blocked', line: name + ' blocks automated reads' });
    });
    return { rows, stores: rows.filter((r) => r.store).length };
  }
  // a = GET /api/amazon (the owner's shop database, read-only): its source row and its drop rule join the Data sheet.
  // e = GET /api/ecom: the listing moves say when they were computed and from prices through when (the page shows no time line)
  function dataModel(feed, scope, parts, a, e, now) {
    const f = isObj(feed) ? feed : {};
    let src = arr(f.sources).filter((s) => isObj(s) && s.kind !== 'paid' && !(s.status === 'refused' && s.kind === 'site'));
    let blends = [];
    if (scope && /^watch:/.test(scope)) {
      const w = arr(isObj(f.watches) && f.watches.items).filter(isObj).find((x) => 'watch:' + str(x.slug, 80) === scope);
      const ids = new Set(arr(w && isObj(w.detail) && w.detail.by_platform).map((b) => isObj(b) && str(b.source, 60)));
      src = src.filter((s) => ids.has(str(s.id, 60)));
      if (w) blends = [watchBlend(w)];
    } else {
      arr(f.watches && f.watches.items).filter(isObj).forEach((w) => blends.push(watchBlend(w)));
      arr(f.categories).filter((c) => isObj(c) && (c.basis === 'blend' || c.basis === 'platforms') && num(c.value) != null).forEach((c) => blends.push({
        label: str(c.label, 60) + ' prices', value: F().chg(c.value), score: num(isObj(c.confidence) && c.confidence.score), agree: '',
        parts: arr(c.parts).filter(isObj).map((p) => ({ name: p.kind === 'official' ? 'Official monthly change' : 'Store price index', value: num(p.value) == null ? 'No data' : F().chg(p.value), weight: num(p.weight) == null ? '' : Math.round(p.weight * 100) + '%' })),
        note: arr(isObj(c.confidence) && c.confidence.reasons).map((x) => str(x, 80)).join(' · ')
      }));
    }
    const sources = src.map((s) => ({
      name: str(s.name, 80), gives: (GIVES[str(s.group, 20)] || nice(s.group)) + (num(s.count) ? ' · ' + F().count(s.count) + ' read' : ''),
      asOf: str(s.as_of, 20), state: STATE[s.status] || 'never'
    }));
    arr(parts).forEach((p) => sources.push(p));
    const az = amazonSource(a);
    if (az) sources.push(az);
    const mi = isObj(e) && isObj(e.movers_info) ? e.movers_info : null;
    if (mi) {
      const at = num(mi.computed_at), thru = num(mi.data_through), when = (t) => (t == null ? 'an unknown time' : F().date(t) + ' ' + F().time(t));
      sources.push({
        name: 'Listing moves', gives: 'Computed ' + when(at) + ' from prices through ' + when(thru) + (num(mi.listings_checked) != null ? ' · ' + F().count(mi.listings_checked) + ' listings checked' : ''),
        asOf: at != null ? new Date(at * 1000).toISOString().slice(0, 10) : '', state: eventsStale(e, num(now) != null ? now : Date.now()) ? 'stale' : 'ok'
      });
    }
    const rs = arr(isObj(e) && e.resale).filter(isObj);
    if (rs.length) {
      const ts = rs.map((r) => num(r.t)).filter((t) => t != null), t = ts.length ? Math.max(...ts) : null;
      sources.push({ name: 'Local resale', gives: 'Asking prices on OfferUp, Craigslist and Facebook Marketplace' + (str(rs[0].area, 60) ? ' near ' + str(rs[0].area, 60) : ''), asOf: t != null ? new Date(t * 1000).toISOString().slice(0, 10) : '', state: t == null ? 'never' : rs.some((r) => r.stale === true) ? 'stale' : 'ok' });
    }
    const method = [
      ['Watch price', 'Median of the per-store medians over 7 days. Asking prices, not sold prices.'],
      ['Category prices', 'Chained daily store prices, used once they span 7 days; the official monthly change fills in.'],
      ['Platforms', 'Board order from web rank and App Store rank. Not market share.'],
      ['Trending', 'Only searches with a shopping word or a store name.']];
    const rule = isObj(a) && !a.error ? str(a.drop_rule, 240) : '';
    if (rule) method.push(['Amazon price drops', rule.charAt(0).toUpperCase() + rule.slice(1)]);
    return { sources, blends, method, setup: setupModel(f).rows.map((r) => ({ name: r.name, line: r.line, state: r.state })) };
  }

  // ---------- Amazon, item level (GET /api/amazon) ----------
  // `chg7`, `chg30` and `below_avg` are fractions in this feed; the page prints percents. A missing value is "No data", never 0.
  const AZ_STALE = 6 * 3600;
  const azOk = (a) => isObj(a) && !a.error;
  const azAge = (a, now) => (num(a.age) != null ? a.age : num(a.t) != null ? Math.max(0, Math.round(now / 1000 - a.t)) : null);
  // its own status, shown only on its own block: stale is the server's flag, else older than the collector's 6 h
  function amazonState(a, now) {
    if (!azOk(a)) return null;
    const age = azAge(a, now);
    return { age, stale: a.stale === true || age == null || age > AZ_STALE };
  }
  const azPill = (st) => (st && st.stale ? U().pill('warn', 'Out of date' + (st.age != null ? ' · ' + F().age(st.age) : '')) : '');
  const pctOf = (x) => (num(x) == null ? null : Math.round(x * 1000) / 10);
  // the route sends at most 140 characters of a title; a title that long was cut there, so it ends at a word with an ellipsis
  // (the row opens the product page, where the whole title is) instead of mid-word (layout audit P 28)
  const AZ_TITLE = 140;
  function azTitle(raw) {
    const t = cleanTitle(raw);
    if (typeof raw !== 'string' || Array.from(raw).length < AZ_TITLE) return t;
    const cut = t.slice(0, t.lastIndexOf(' ') > 0 ? t.lastIndexOf(' ') : t.length).replace(/[\s,;:·&-]+$/, '');
    return cut + '\u2026';
  }
  function amazonOffer(o, query) {
    const p = num(o.price), prev = num(o.prev), below = num(o.below_avg);
    return {
      title: azTitle(o.title), price: p, url: U().safeUrl(o.url), query: nice(query),
      was: o.dropped === true && prev != null && p != null && prev > p ? prev : null,
      vsAvg: below != null && below > 0 ? -pctOf(below) : null, low30: o.low30 === true
    };
  }
  // the Amazon search for a watch: the feed's own slug first, then the same query words
  const qkey = (s) => str(s, 80).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function amazonFor(a, slug, label) {
    if (!azOk(a)) return null;
    const ws = arr(a.watch).filter(isObj);
    return ws.find((x) => str(x.slug, 80) && str(x.slug, 80) === slug) || ws.find((x) => qkey(x.query) && qkey(x.query) === qkey(label)) || null;
  }
  function amazonBlockModel(a, slug, label, now) {
    const w = amazonFor(a, slug, label);
    if (!w) return null;
    const best = isObj(w.best) ? num(w.best.price) : null, low = num(w.low30);
    const line = arr(w.line).map(num);
    // a search with no price now, no 30-day low, no line and no offers has nothing to say: no block, never an empty one
    if (best == null && low == null && line.filter((x) => x != null).length < 2 && !arr(w.items).some(isObj)) return null;
    return {
      best, low30: low, vsLow: best != null && low != null && low > 0 ? Math.round(((best - low) / low) * 1000) / 10 : null,
      chg7: pctOf(num(w.chg7)), chg30: pctOf(num(w.chg30)), drops: num(w.drops), offers: num(w.offers), days: num(w.days),
      line: line.map((v, i) => [i === line.length - 1 ? 'Latest' : line.length - 1 - i + ' days before', v]),
      items: arr(w.items).filter(isObj).map((o) => amazonOffer(o, w.query)), state: amazonState(a, now)
    };
  }
  const amazonDeals = (a, now) => (azOk(a) ? arr(a.deals).filter(isObj).map((o) => amazonOffer(o, o.query)) : []);
  function amazonSource(a) {
    if (!isObj(a)) return null;
    if (a.error) return { name: 'Amazon prices', gives: 'Amazon prices for your watched searches', asOf: '', state: 'never' };
    const t = num(a.t), stale = a.stale === true;
    return {
      name: 'Amazon prices', gives: 'Amazon prices for ' + arr(a.watch).length + ' watched searches',
      asOf: t != null ? new Date(t * 1000).toISOString().slice(0, 10) : '', state: t == null ? 'never' : stale ? 'stale' : 'ok'
    };
  }
  // one offer: title, its tags, the price; a link to its product page in a new tab when the feed's URL is safe
  function amazonRow(o, withQuery) {
    const tags = [withQuery ? o.query : '', o.was != null ? 'was ' + priceText(o.was) : '', o.vsAvg != null ? F().chg(o.vsAvg) + ' vs 7-day average' : '', o.low30 ? '30-day low' : ''].filter(Boolean).join(' · ');
    const tag = o.url ? 'a' : 'div', href = o.url ? ' href="' + esc(o.url) + '" target="_blank" rel="noopener noreferrer"' : '';
    return '<' + tag + ' class="frow azrow"' + href + '><span class="fl"><b class="ptitle-t">' + esc(o.title) + '</b>' + (tags ? '<small>' + esc(tags) + '</small>' : '') + '</span>' +
      '<span class="fr"><b>' + price(o.price) + '</b></span></' + tag + '>';
  }
  function amazonBlockHtml(b) {
    if (!b) return '';
    const kv = (rows) => '<dl class="kv">' + rows.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>';
    const nd = 'No data';
    const rows = [['Best now', b.best == null ? nd : price(b.best)], ['30-day low', b.low30 == null ? nd : price(b.low30)],
      ['Now vs 30-day low', b.vsLow == null ? nd : b.vsLow === 0 ? 'At the low' : esc(F().chg(b.vsLow))],
      ['7 days', b.chg7 == null ? nd : delta(b.chg7)], ['30 days', b.chg30 == null ? nd : delta(b.chg30)], ['Price drops', b.drops == null ? nd : esc(F().count(b.drops))]];
    const line = b.line.filter((x) => x[1] != null).length > 1 ? U().line({ series: b.line, yfmt: (x) => priceText(x), xlab: [b.line.length + ' days', 'Latest'], label: 'Lowest Amazon price by day' }) : '';
    return '<section class="sh-sec s-az"><h3><span>Amazon</span>' + azPill(b.state) + '</h3>' + kv(rows) + line +
      (b.items.length ? '<div class="flist">' + b.items.map((o) => amazonRow(o, false)).join('') + '</div>' : '') + '</section>';
  }
  function watchBlend(w) {
    const conf = isObj(w.confidence) ? w.confidence : {}, a = agreeOf(conf);
    return {
      label: nice(w.label) + ', median', value: priceText(w.median), score: num(conf.score), agree: a ? a.agree + ' of ' + a.total : '',
      parts: arr(isObj(w.detail) && w.detail.by_platform).filter(isObj).map((b) => ({ name: str(b.platform, 40), value: priceText(b.median), weight: num(b.n) == null ? '' : F().count(b.n) + ' listed' })),
      note: arr(conf.reasons).map((x) => str(x, 80)).join(' · ')
    };
  }

  // ---------- marketplace listings (GET /api/listings) and resale facts (/api/ecom watch[]) ----------
  // The public marketplace searches the old Shop page listed. A listing belongs to the watch whose search returned it (its
  // `query` against the watch's own words). Near-duplicates the writer grouped fold into one row that opens to its members.
  const lstPrice = (x) => (x.currency == null || x.currency === 'USD' ? num(x.price) : null);
  const lstSite = (x, e) => { const k = str(x.source, 40) || str(x.site, 40); return k ? siteName(k, e) : ''; };
  const lstItem = (x, e) => ({ title: cleanTitle(x.title), price: lstPrice(x), url: U().safeUrl(str(x.url, 600)), site: lstSite(x, e), posted: num(x.posted_at), gone: x.seen_this_run === false, count: 1 });
  // one group: the lowest price leads and the range runs to the highest; `left` counts members the feed did not send
  function lstGroup(g, e) {
    const items = arr(g.items).filter(isObj).map((x) => lstItem(x, e)), n = Math.max(items.length, Math.round(num(g.count) || 1));
    const lo = num(g.best_price) != null ? g.best_price : lstPrice(g), hi = num(g.max_price);
    const sites = [...new Set(arr(g.sites).map((k) => siteName(str(k, 40), e)).filter(Boolean))];
    return Object.assign(lstItem(g, e), { price: lo, hi: lo != null && hi != null && hi > lo ? hi : null, count: n, sites: sites.length ? sites : [lstSite(g, e)].filter(Boolean), items, left: Math.max(0, n - items.length) });
  }
  // every listing once: a member of a group of two or more is folded into its group's row, which takes the place of its first
  // member. Priced rows first (a "wanted" post has no price), the sites taking turns so the first rows are not one site's
  // whole search; each site keeps the feed's order. keep(query) picks a watch or a category.
  function listingRows(l, e, keep) {
    if (!isObj(l) || l.error) return null;
    const xs = arr(l.listings).filter(isObj), qOf = new Map(), gOf = new Map(), done = new Set(), out = [];
    xs.forEach((x) => { const u = str(x.url, 600); if (u && !qOf.has(u)) qOf.set(u, str(x.query, 80)); });
    const gs = arr(l.groups).filter((g) => isObj(g) && Math.max(arr(g.items).length, num(g.count) || 1) > 1);
    const urls = (g) => arr(g.items).filter(isObj).concat([g]).map((x) => str(x.url, 600)).filter(Boolean);
    gs.forEach((g, i) => urls(g).forEach((u) => { if (!gOf.has(u)) gOf.set(u, i); }));
    const group = (i) => { done.add(i); const u = urls(gs[i]).find((x) => qOf.has(x)); return Object.assign(lstGroup(gs[i], e), { query: u ? qOf.get(u) : str(gs[i].query, 80) }); };
    xs.forEach((x) => {
      const gi = gOf.get(str(x.url, 600));
      if (gi == null) out.push(Object.assign(lstItem(x, e), { query: str(x.query, 80) }));
      else if (!done.has(gi)) out.push(group(gi));
    });
    gs.forEach((g, i) => { if (!done.has(i)) out.push(group(i)); });
    const ok = typeof keep === 'function' ? keep : () => true, kept = out.filter((r) => ok(r.query));
    const by = new Map(), turns = [];
    kept.filter((r) => r.price != null).forEach((r) => { if (!by.has(r.site)) by.set(r.site, []); by.get(r.site).push(r); });
    const lists = [...by.values()];
    for (let i = 0; lists.some((x) => x[i]); i++) lists.forEach((x) => { if (x[i]) turns.push(x[i]); });
    return turns.concat(kept.filter((r) => r.price == null));
  }
  // Market's category chips: the listings of the watches in that category (by label, slug and the old feed's query words)
  function listingKeep(m, e, cat) {
    if (!cat || cat === 'all') return null;
    const old = oldBySlug(e), want = new Set();
    arr(isObj(m) && isObj(m.watches) && m.watches.items).filter((w) => isObj(w) && catKey(w.category) === cat)
      .forEach((w) => [qkey(w.label), qkey(w.slug), qkey(old[str(w.slug, 80)] && old[str(w.slug, 80)].query)].forEach((k) => { if (k) want.add(k); }));
    return (q) => want.has(qkey(q));
  }
  // flip = resale median (sold once a sold source has 10 sales, else asking) - the lowest price - 13.25% fees - shipping.
  // The lowest price takes used and local offers too; one under 0.3 x the median is a part or a case and is skipped.
  const FEE_RATE = 0.1325, MIN_SOLD = 10;
  function lowestAny(o) {
    const m = num(o.median), sane = (p) => m == null || p >= 0.3 * m, c = [];
    const be = isObj(o.best) ? o.best : null;
    if (be && num(be.price) != null && sane(be.price)) c.push(be.price);
    arr(o.groups).filter(isObj).forEach((g) => { const p = num(g.best_price) != null ? g.best_price : num(g.price); if (p != null && sane(p)) c.push(p); });
    return c.length ? Math.min(...c) : null;
  }
  function resaleModel(o) {
    if (!isObj(o) || !Object.keys(o).length) return null;
    const buy = lowestAny(o), sold = isObj(o.sold) ? o.sold : null, soldN = sold ? num(sold.n) : null;
    let flip = null;
    if (isObj(o.flip) && num(o.flip.score) != null) flip = { score: o.flip.score, basis: str(o.flip.basis, 10) === 'sold' ? 'sold' : 'asking', n: num(o.flip.n) };
    else {
      const sm = sold && num(sold.median) != null && soldN != null && soldN >= MIN_SOLD ? sold.median : null, ref = sm != null ? sm : num(o.median);
      const ship = isObj(o.shipping) && num(o.shipping.median_cost) != null ? o.shipping.median_cost : 0;
      if (ref != null && buy != null) flip = { score: Math.round((ref - buy - ref * FEE_RATE - ship) * 100) / 100, basis: sm != null ? 'sold' : 'asking', n: sm != null ? soldN : num(o.n) };
    }
    const cd = isObj(o.condition) ? o.condition : null, used = cd ? ['used', 'refurbished', 'open_box'].map((k) => num(cd[k])).filter((v) => v != null) : [];
    return {
      flip, buy, asking: isObj(o.asking) && num(o.asking.n) != null ? o.asking.n : num(o.n), sold: soldN,
      newN: cd ? num(cd.new) : null, usedN: used.length ? used.reduce((a, b) => a + b, 0) : null
    };
  }

  // ---------- render: Market ----------
  const CAT_CHIPS = [['all', 'All'], ['computers', 'Computers'], ['home', 'Home'], ['outdoors', 'Outdoors'], ['grocery', 'Grocery'], ['music', 'Music'], ['apparel', 'Apparel']];
  const chipRow = (list, on, attr, label, cls) => '<div class="chips scroll' + (cls ? ' ' + cls : '') + '" role="group" aria-label="' + esc(label) + '">' +
    list.map(([k, t]) => '<button type="button" data-' + attr + '="' + esc(k) + '" aria-pressed="' + (k === on) + '"' + (k === on ? ' class="on"' : '') + '>' + esc(t) + '</button>').join('') + '</div>';
  const segRow = (list, on, attr, label) => '<div class="seg" role="group" aria-label="' + esc(label) + '">' +
    list.map(([k, t]) => '<button type="button" data-' + attr + '="' + esc(k) + '" aria-pressed="' + (k === on) + '"' + (k === on ? ' class="on"' : '') + '>' + esc(t) + '</button>').join('') + '</div>';
  // A persistent band id bounds focus comparisons even when another band contains the same row key.
  const sect = (cls, title, body, act, extra) => {
    const band = /\bs-(trending|move|plat|deal|lst)\b/.exec(cls);
    return '<section class="sect ' + cls + '"' + (band ? ' id="shop-band-' + band[1] + '"' : '') + (extra || '') + '><h2 class="secttl"><span>' + esc(title) + '</span>' + (act || '') + '</h2>' + body + '</section>';
  };
  // All Market bands share one control. These lists only expand; each band keeps its own cap and step.
  const more = (key, shown, total, step = 12) => DeckCore.more({ key, shown, total, step, first: shown });

  // tile sub is plain text (the helper escapes it): the signed change, its word, the period. Each part keeps its words on one
  // line ("+0.8 pt 1-yr", "Q2 2026"): a narrow tile breaks only between parts, never inside a date (layout audit D 21)
  const keep = (s) => s.replace(/ /g, '\u00a0');
  const tileSub = (t) => [t.chg != null ? (t.pts ? F().pt(t.chg) : F().chg(t.chg)) + ' ' + t.cword : t.cword, t.period].filter(Boolean).map(keep).join(' · ');
  // compact (every class but TV): the strip is one short row under the watches at the title step (shop.css); a tile's unit joins
  // its label ("Shipping, per 40 ft box"), so a bare figure never drops its unit onto a line of its own in a narrow cell
  function stripHtml(tiles, compact) {
    if (!tiles.length) return '';
    return U().strip(tiles.map((t) => U().tile({
      label: compact && t.unit ? t.label + ', ' + t.unit : t.label, value: t.value, unit: compact ? '' : t.unit, sub: tileSub(t), key: t.key,
      spark: t.spark.length > 1 ? U().spark(t.spark, { w: 120, h: 24, label: t.label + ', recent readings' }) : '', cls: t.dx ? 'dx' : ''
    })), { label: 'Market' });
  }
  // a seller's title on a watch card ends at a word with an ellipsis past 36 characters (two lines in a phone card and in the
  // desk's 4/12 column); the link opens the listing and carries the whole title. Mover, deal and listing rows keep their titles whole.
  // A size or pack token that tells two items apart ("16GB", "32GB", "2TB", "12 pack", "16.9 fl oz") is kept when it ends by
  // character 44: the cut moves past it, still at a word (review of #383).
  const CARD_TITLE = 36, CARD_TITLE_MAX = 44;
  const UNIT_RE = '(?:gb|tb|mb|oz|fl\\.?\\s?oz|ml|l|lbs?|kg|g|ct|count|pk|packs?|in|inch(?:es)?|"|w|mah|qt|gal|ft|mm|cm)';
  const SIZE_TOKEN = new RegExp('^\\(?\\d+(?:[.,]\\d+)?(?:-|\\s)?' + UNIT_RE + '\\)?[,;.]?$', 'i');
  const SIZE_UNIT = new RegExp('^\\(?' + UNIT_RE + '\\)?[,;.]?$', 'i');
  const NUM_WORD = /^(?:\(?\d+(?:[.,]\d+)?|fl\.?)$/i;
  function cardTitle(t) {
    const ws = String(t).split(' ');
    let len = -1, keep = 0;
    for (; keep < ws.length && len + 1 + Array.from(ws[keep]).length <= CARD_TITLE; keep++) len += 1 + Array.from(ws[keep]).length;
    if (keep === ws.length) return t;
    if (keep === 0) return Array.from(t).slice(0, CARD_TITLE).join('') + '\u2026';
    let end = keep;
    for (let j = keep; j < ws.length; j++) {
      len += 1 + Array.from(ws[j]).length;
      if (len > CARD_TITLE_MAX) break;
      if (SIZE_TOKEN.test(ws[j]) || (SIZE_UNIT.test(ws[j]) && NUM_WORD.test(ws[j - 1]))) end = j + 1;
    }
    if (end === ws.length) return t;
    return ws.slice(0, end).join(' ').replace(/[\s,;:·&|(/-]+$/, '') + '\u2026';
  }
  // one trending product: its rank, its seller title cut at a word (the link carries the whole title), the signal, the source with
  // that source's own age (or that it did not report), the median price and the rank move as a shape and a number. Unknown draws nothing.
  // The producer writes a source as "Best Buy best sellers (bestbuy_api)": the parenthesised id is the collector's, not words to read, and
  // a source the signal already names ("#17 on Best Buy best sellers, up 16") is not said twice. A source's age reads "14 min ago".
  const srcLabel = (source, signal) => {
    const n = str(source, 80).replace(/\s*\([a-z0-9_.-]+\)\s*$/i, '');
    return n && String(signal || '').toLowerCase().indexOf(n.toLowerCase()) >= 0 ? '' : n;
  };
  function trendRow(p) {
    const mv = p.move == null ? '' : '<span class="delta ' + (p.move > 0 ? 'up' : p.move < 0 ? 'dn' : 'flat') + '" aria-label="' + esc(p.move > 0 ? 'Up ' + p.move + ' places' : p.move < 0 ? 'Down ' + -p.move + ' places' : 'Same place') + '">' + esc(String(Math.abs(p.move))) + '</span>';
    // only a short figure stays whole ("14 min ago", "up 16"); the long words wrap at spaces (an all-nbsp signal broke "up 1 / 6" at 908)
    const srcAge = p.down ? keep('source not reporting') : p.age != null ? keep(F().age(p.age) + ' ago') : '';
    const sub = [String(p.signal || '').replace(/ (\S+)$/, '\u00a0$1'), [srcLabel(p.source, p.signal), srcAge].filter(Boolean).join(', ')].filter(Boolean).join(' \u00B7 ');
    const t = cardTitle(p.title), whole = t !== p.title ? ' title="' + esc(p.title) + '"' : '';
    const u = U().safeUrl(str(p.url, 600)), tag = u ? 'a' : 'div', href = u ? ' href="' + esc(u) + '" target="_blank" rel="noopener noreferrer"' : '';
    return '<li><' + tag + ' class="frow trow' + (p.down ? ' stl' : '') + '" data-key="' + esc(p.key) + '"' + href + whole + '><span class="rank-n">' + (p.rank != null ? esc(String(p.rank)) : '') + '</span>' +
      '<span class="fl"><b class="ptitle-t">' + esc(t) + '</b>' + (sub ? '<small>' + (p.down ? '<span class="sd warn"></span>' : '') + esc(sub) + '</small>' : '') + '</span>' +
      '<span class="fr"><b>' + (p.median != null ? price(p.median) : F().na()) + '</b>' + (mv ? '<small>' + mv + '</small>' : '') + '</span></' + tag + '></li>';
  }
  // the Trending section's body and its age words. tr undefined: not answered yet (a skeleton); an error or a wrong shape: not
  // reporting with Try again; no rows: one quiet line
  const TREND_N = 6;
  function trendingBody(tr, cat, shown, tv) {
    if (tr === undefined) return U().skeleton('row', 4);
    const ps = trendingList(tr, cat);
    if (!ps) return U().empty({ k: 'bad', title: 'Trending is not reporting', line: /missing/i.test(str(isObj(tr) ? tr.error : '', 80)) ? 'Nothing has been collected yet. It fills in after the next run.' : 'The trends source did not answer. Try again in a moment.', retry: 'shop' });
    if (!ps.length) return U().empty({ k: 'idle', title: cat && cat !== 'all' ? 'Nothing trending in this category.' : 'Nothing trending right now.' });
    const n = tv ? TREND_N : Math.max(TREND_N, shown || 0);
    return '<ol class="flist prank trank">' + ps.slice(0, n).map(trendRow).join('') + '</ol>' + (tv ? '' : more('trend', n, ps.length));
  }
  function trendingAge(tr, now) {
    if (!isObj(tr) || tr.error) return '';
    const t = num(tr.t) != null ? tr.t : DeckCore.toEpoch(tr.generated_at);
    return t == null ? '' : '<span>' + esc((tr.stale === true ? 'Out of date \u00B7 ' : '') + DeckCore.whole(DeckCore.ago(t, now))) + '</span>';
  }
  function productRow(p) {
    const right = p.chg != null ? '<small>' + delta(p.chg) + (p.move ? ' ' + esc(p.move) : '') + '</small>'
      : p.median != null ? '<small>median ' + esc(priceText(p.median)) + confHtml(null) + '</small>' : p.rank != null ? '<small>rank ' + esc(String(p.rank)) + '</small>' : '';
    // a listing event is the listing itself: it opens in a new tab; a stale one says Out of date first
    if (p.event) {
      const sub = [p.stale ? 'Out of date' : '', p.kindWord, p.where, p.cond, catWord(p.cat)].filter(Boolean).join(' · ');
      const u = U().safeUrl(str(p.url, 600)), tag = u ? 'a' : 'div', href = u ? ' href="' + esc(u) + '" target="_blank" rel="noopener noreferrer"' : '';
      return '<' + tag + ' class="frow prow pev' + (p.stale ? ' stl' : '') + '" data-key="' + esc(p.key) + '"' + href + '><span class="fl"><b class="ptitle-t">' + esc(p.title) + '</b><small>' + (p.stale ? '<span class="sd warn"></span>' : '') + esc(sub) + '</small></span>' +
        '<span class="fr"><b>' + price(p.price) + '</b>' + right + '</span></' + tag + '>';
    }
    const sub = [p.kindWord, p.where, catWord(p.cat)].filter(Boolean).join(' · ');
    return '<button type="button" class="frow prow" data-open="product" data-key="' + esc(p.key) + '"><span class="fl"><b class="ptitle-t">' + esc(p.title) + '</b><small>' + esc(sub) + '</small></span>' +
      '<span class="fr"><b>' + price(p.price) + '</b>' + right + '</span></button>';
  }
  // Sells locally: the item with whose it is, how many listings and how old the read is on its second line (so every class shows
  // them, L and the phone cards included); then the local median ask and what share of new that is. A table, so P reads each row
  // as a card
  function localHtml(rows, now) {
    if (!rows.length) return '';
    const ago = (r) => (r.t == null ? 'no date' : F().age(Math.max(0, now / 1000 - r.t)) + ' ago');
    const sub = (r) => [r.role, r.n === 1 ? '1 listing' : F().count(r.n) + ' listings', (r.stale ? 'Out of date, ' : '') + ago(r)].join(' · ');
    return U().table({
      cols: [{ key: 'name', label: 'Item', place: true }, { key: 'median', label: 'Asks locally', num: true }, { key: 'vs', label: 'Of new', num: true }],
      rows, key: (r) => r.slug, open: 'watch', id: 'local', max: 30, label: 'Sells locally',
      cell: (r, c) => c.key === 'name' ? '<span class="place"><b>' + esc(r.name) + '</b><small>' + (r.stale ? '<span class="sd warn"></span>' : '') + esc(sub(r)) + '</small></span>'
        : c.key === 'median' ? (r.median == null ? esc('None nearby now') : price(r.median))
        : r.ofNew == null ? F().na() : esc(r.ofNew + '%') + (r.newPrice != null ? '<small>' + esc('new ' + priceText(r.newPrice)) + '</small>' : '')
    });
  }
  const CAT_WORD = { computers: 'Computers', electronics: 'Electronics', home: 'Home', apparel: 'Apparel', beauty: 'Beauty', music: 'Music', collectibles: 'Collectibles', outdoors: 'Outdoors', grocery: 'Grocery' };
  const catWord = (k) => CAT_WORD[k] || '';
  function categoryCard(c) {
    const sp = !c.indexBuilding && c.spark.filter((x) => x != null).length > 1 ? U().spark(c.spark, { w: 120, h: 24 }) : '';
    // each part on one line ("Nov 8 to Nov 15", "Oct 2026"); a narrow card breaks only between parts (layout audit P 30)
    const when = [c.period.word, c.period.when].filter(Boolean).join(' · ').split(' · ').map(keep).join(' · ');
    const idx = c.index != null && !c.indexBuilding ? '<p class="note sm">Index ' + esc(c.index.toFixed(1)) + (c.chg7 != null ? ' · ' + esc(F().chg(c.chg7)) + ' 7 days' : '') + (c.chg30 != null ? ' · ' + esc(F().chg(c.chg30)) + ' 30 days' : '') + '</p>' : '';
    return '<div class="card ccard" data-key="' + esc(c.key) + '"><h3><span>' + esc(c.label) + '</span></h3>' +
      '<span class="fig-row"><b class="fig">' + delta(c.value) + confHtml(c.conf) + '</b><span class="note sm">' + esc(when) + '</span></span>' + sp + idx + '</div>';
  }
  // every category without a value yet shares ONE line (critique 21): names, then the day count or its range
  function buildingLine(cs) {
    if (!cs.length) return '';
    const d = cs.map((c) => Math.min(c.days, BUILD_DAYS)), lo = Math.min(...d), hi = Math.max(...d);
    return '<div class="frow cbuild"><span class="fl"><b>' + esc(cs.map((c) => c.label).join(', ')) + '</b><small>' + esc('Building · ' + (lo === hi ? lo : lo + ' to ' + hi) + ' of ' + BUILD_DAYS + ' days') + '</small></span></div>';
  }
  // a column that is empty on every row is left out (30-day move is null on every platform until the writer has 30 days)
  // max: rows before Show more (the TV board draws all 30)
  function platformTable(rows, max) {
    const sd = (k) => '<span class="sd ' + k + '"></span>';
    const any = (k) => rows.some((r) => r[k] != null);
    const cols = [{ key: 'name', label: 'Platform', place: true }, { key: 'kind', label: 'Kind' }, { key: 'move', label: '30-day move', num: true },
      { key: 'app', label: 'App rank', num: true, pri: 2 }, { key: 'web', label: 'Web rank', num: true, pri: 3 }, { key: 'priced', label: 'Prices tracked', pri: 4 }]
      .filter((c) => !['move', 'app', 'web'].includes(c.key) || any(c.key));
    const n = max || 30;
    return U().table({
      cols, rows: rows.slice(0, n), key: (r) => r.key, open: 'platform', id: 'plat', max: n,
      cell: (r, c) => c.key === 'name' ? '<span class="place"><b>' + esc(r.name) + '</b>' + (r.rank != null ? '<small>Rank ' + esc(String(r.rank)) + '</small>' : '') + '</span>'
        : c.key === 'kind' ? esc(r.kind)
        : c.key === 'move' ? (r.move == null ? F().na() : esc((r.move > 0 ? '+' : r.move < 0 ? '\u2212' : '') + Math.abs(r.move)))
        : c.key === 'app' ? (r.app == null ? F().na() : esc(String(r.app)))
        : c.key === 'web' ? (r.web == null ? F().na() : esc(F().count(r.web)))
        : r.priced ? sd('ok') + ' Yes' : sd('off') + ' No'
    }) + more('plat', n, rows.length, 20);
  }
  // rows the table opens with beside the three lists: 24 on T and D; on XL the lists are wider and shorter, so 20 (at 1920 and
  // 2560 the table ran 206 and 329 px past them at 24, layout wave 2)
  const PLAT_D = 24, PLAT_XL = 20;
  // phone: one compact row per platform (rank, name, kind); the ranks live in the platform sheet. 10 rows, then Show more.
  const PLAT_P = 10;
  function platformRowsP(rows, shown) {
    const n = Math.max(PLAT_P, shown || 0);
    return '<ol class="flist prank">' + rows.slice(0, n).map((r) => '<li><button type="button" class="frow" data-open="platform" data-key="' + esc(r.key) + '">' +
      '<span class="rank-n">' + (r.rank != null ? esc(String(r.rank)) : '') + '</span><span class="fl"><b>' + esc(r.name) + '</b><small>' + esc(r.kind) + '</small></span></button></li>').join('') + '</ol>' +
      more('plat', n, rows.length, 20);
  }
  function dealRow(d, now) {
    const ago = d.posted != null ? F().age(Math.max(0, now / 1000 - d.posted)) : '';
    const sub = [d.where, ago ? 'posted ' + ago + ' ago' : '', d.pickup ? 'Pickup' : 'Shipped'].filter(Boolean).join(' · ');
    const tag = d.url ? 'a' : 'div', href = d.url ? ' href="' + esc(d.url) + '" target="_blank" rel="noopener noreferrer"' : '';
    return '<' + tag + ' class="frow drow" data-key="deal:' + esc(d.url || d.item + '|' + d.price) + '"' + href + '><span class="fl"><b class="ptitle-t">' + esc(d.item) + '</b><small>' + esc(sub) + '</small></span>' +
      '<span class="fr"><b>' + price(d.price) + '</b>' + (d.vs != null ? '<small>' + delta(d.vs) + ' vs median</small>' : '') + '</span></' + tag + '>';
  }
  // a listing row: title, where and when, its price; a safe link opens the listing in a new tab. A group is a native disclosure
  // (no script, Enter on a TV) whose summary gives the count and the price range and which opens to each member with its link.
  const lstWhen = (r, now) => (r.gone ? 'not in the latest search' : r.posted != null ? 'posted ' + F().age(Math.max(0, now / 1000 - r.posted)) + ' ago' : '');
  function lstRowHtml(r, now, withQuery) {
    if (r.count > 1) {
      const sub = [withQuery ? nice(r.query) : '', r.count + ' listings', r.sites.join(', ')].filter(Boolean).join(' · ');
      // the lowest price is the figure; the highest is the line under it, so the title keeps its width on a phone
      const hi = r.price != null && r.hi != null ? '<small>' + esc('to ' + priceText(r.hi)) + '</small>' : '';
      return '<details class="lgrp"><summary class="frow" data-key="lst:' + esc(U().safeUrl(r.url) || r.title + '|' + r.query) + '"><span class="fl"><b class="ptitle-t">' + esc(r.title) + '</b><small>' + esc(sub) + '</small></span>' +
        '<span class="fr"><b>' + esc(r.price == null ? 'No price' : priceText(r.price)) + '</b>' + hi + '</span></summary><div class="flist lgi">' + r.items.map((x) => lstRowHtml(x, now, false)).join('') +
        (r.left ? '<p class="note sm">' + esc('And ' + r.left + ' more not shown.') + '</p>' : '') + '</div></details>';
    }
    const sub = [withQuery ? nice(r.query) : '', r.site, lstWhen(r, now)].filter(Boolean).join(' · ');
    const u = U().safeUrl(r.url), tag = u ? 'a' : 'div', href = u ? ' href="' + esc(u) + '" target="_blank" rel="noopener noreferrer"' : '';
    return '<' + tag + ' class="frow lrow-l" data-key="lst:' + esc(u || r.title + '|' + r.query) + '"' + href + '><span class="fl"><b class="ptitle-t">' + esc(r.title) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
      '<span class="fr"><b>' + esc(r.price == null ? 'No price' : priceText(r.price)) + '</b></span></' + tag + '>';
  }
  // the count line: every listing, and how many rows remain once duplicates fold
  function lstCount(rows) {
    const all = rows.reduce((a, r) => a + r.count, 0);
    return '<p class="note sm lst-n">' + esc(F().count(all) + (all === 1 ? ' listing' : ' listings') + (all > rows.length ? ', ' + F().count(rows.length) + ' after duplicates' : '')) + '</p>';
  }
  const LST_N = 6, LST_SHEET = 8;
  function listingBody(rows, now, n, cat) {
    if (!rows) return '<div class="flist"><div class="frow"><span class="fl"><b>Listings are not reporting.</b></span></div></div>';
    if (!rows.length) return '<div class="flist"><div class="frow"><span class="fl"><b>' + (cat && cat !== 'all' ? 'No marketplace listings in this category.' : 'No marketplace listings right now.') + '</b></span></div></div>';
    return lstCount(rows) + '<div class="flist">' + rows.slice(0, n).map((r) => lstRowHtml(r, now, true)).join('') + '</div>' + more('lst', n, rows.length);
  }
  const kvHtml = (rows) => '<dl class="kv">' + rows.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>';
  // the watch sheet's own listings: eight, then the rest behind one native Show more
  function lstSheetHtml(rows, now) {
    if (!rows) return '';
    if (!rows.length) return '<section class="sh-sec s-lst"><h3>Marketplace listings</h3><p class="note">No marketplace listings for this watch right now.</p></section>';
    const row = (r) => lstRowHtml(r, now, false), rest = rows.slice(LST_SHEET);
    return '<section class="sh-sec s-lst"><h3>Marketplace listings</h3>' + lstCount(rows) + '<div class="flist">' + rows.slice(0, LST_SHEET).map(row).join('') + '</div>' +
      (rest.length ? '<details class="lmore"><summary class="btn btn-quiet">Show ' + rest.length + ' more</summary><div class="flist">' + rest.map(row).join('') + '</div></details>' : '') + '</section>';
  }
  function resaleHtml(r) {
    if (!r) return '';
    const nd = 'No data', n = (v) => (v == null ? nd : esc(F().count(v)));
    // one short fact per row (the kv rule); the basis is the sentence under them
    const basis = !r.flip ? '' : r.flip.basis === 'sold' ? 'It uses sold prices' + (r.flip.n != null ? ' (' + F().count(r.flip.n) + ' sales)' : '') + '.' : 'It uses asking prices, so treat it as a rough guide.';
    return '<section class="sh-sec s-resale"><h3>Resale</h3>' + kvHtml([['Flip', r.flip ? price(r.flip.score) : nd], ['Lowest price', r.buy == null ? nd : price(r.buy)],
      ['Asking', n(r.asking)], ['Sold', n(r.sold)], ['New', n(r.newN)], ['Used or refurbished', n(r.usedN)]]) +
      '<p class="note sm">' + esc('Flip is the resale median less the lowest price, 13.25% selling fees and shipping. ' + basis).trim() + '</p></section>';
  }
  function dupesHtml(s, now) {
    if (!s.dupes.length) return '';
    const shown = s.dupes.length, total = s.dupesTotal;
    return '<section class="sh-sec s-dup"><h3>Same item, several listings</h3><div class="flist">' + s.dupes.map((r) => lstRowHtml(r, now, false)).join('') + '</div>' +
      (total != null && total > shown ? '<p class="note sm">' + esc('The ' + shown + ' biggest of ' + F().count(total) + ' groups.') + '</p>' : '') + '</section>';
  }

  // st: {m, e, l, a, tr, now, cls, tv, view:{cat, kind, mover, cond, trend, product, deal, plat}, loading}; a = GET /api/amazon,
  // tr = GET /api/trends (undefined until it answers). loading: the market feed has not answered yet on this visit: the page draws
  // its designed loading state, a static skeleton of Trending and the movers under their titles (DESIGN 6), never a blank page
  function loadingBody() {
    return '<div class="g12 shop-top shop-wait">' + sect('c-12 s-trending', 'Trending', U().skeleton('row', 4)) + '</div>' +
      '<div class="g12 shop-wait">' + sect('c-12 s-move', 'Best sellers and movers', U().skeleton('row', 4)) + '</div>';
  }
  function marketBody(st) {
    const m = st.m, e = st.e, l = st.l, now = st.now, v = st.view || {}, tv = !!st.tv, phone = st.cls === 'P';
    // P and L are both phones: the platforms are ten compact rows and Show more on both, so on L the platforms and the three
    // lists beside them balance in two columns instead of a 30-row table leaving a half-empty page (layout audit L 65)
    const compact = phone || st.cls === 'L', wide = st.cls === 'D' || st.cls === 'XL';
    if (!isObj(m)) {
      if (st.loading) return loadingBody();
      return downBody(st);
    }
    const cat = v.cat || 'all';
    const tiles = macroModel(m);
    // Trending (trends.json products) leads: what the market is buying now, not a list he keeps (owner, 2026-11-17)
    const trendBody = trendingBody(st.tr, cat, v.trend, tv), trendAct = trendingAge(st.tr, now);
    // listing events lead the movers, then the store movers and best sellers. On D and XL the movers share the first row as 4/12
    // beside Trending, so they open at four rows (Show more adds the rest); elsewhere six
    const ps = eventList(e, m, cat, v.mover, now).concat(productList(m, cat, v.mover)), pN = tv ? 6 : Math.max(wide ? 4 : 6, v.product || 0);
    const moverChips = tv ? '' : chipRow(MOVER_CHIPS, v.mover || 'all', 'mover', 'Kind of move', 'mchips');
    const prodBody = moverChips + (ps.length ? '<div class="flist">' + ps.slice(0, pN).map(productRow).join('') + '</div>' + (tv ? '' : more('product', pN, ps.length))
      : U().empty({ k: 'idle', title: 'No products move here right now.' }));
    const cs = categoryList(m, cat), csOn = cs.filter((c) => c.value != null), csB = cs.filter((c) => c.value == null);
    const catBody = cs.length ? (csOn.length ? '<div class="cards ccards">' + csOn.map(categoryCard).join('') + '</div>' : '') + (csB.length ? '<div class="flist">' + buildingLine(csB) + '</div>' : '')
      : U().empty({ k: 'idle', title: 'No category prices yet.' });
    const pr = platformRows(m, tv ? 'all' : v.kind, 30);
    // off TV the table opens at 24 rows, about the height of the three lists beside it on D and XL (layout check at 1366, 1440
    // and 1920 found the table 300 to 590 px longer); Show more adds the rest
    const platBody = !pr.length ? '<div class="flist"><div class="frow"><span class="fl"><b>No platform ranks yet.</b></span></div></div>'
      : compact ? platformRowsP(pr, v.plat) : platformTable(pr, tv ? 30 : Math.max(st.cls === 'XL' ? PLAT_XL : PLAT_D, v.plat || 0));
    const tr = trendRows(m);
    const ds = dealRows(m, e, l, { cat, cond: v.cond }), dN = Math.max(6, v.deal || 0);
    const dealBody = ds.length ? '<div class="flist">' + ds.slice(0, dN).map((d) => dealRow(d, now)).join('') + '</div>' + more('deal', dN, ds.length)
      : '<div class="flist"><div class="frow"><span class="fl"><b>No deals under median right now.</b></span></div></div>';
    const cr = costRows(m);
    // Amazon price drops, in the feed's own order with the same tags as the watch sheet; absent when there are none.
    // Status of its own (stale) on its own title only; the page keeps its one freshness mark.
    const az = amazonDeals(st.a, now);
    const azSect = az.length ? sect('s-az', 'Amazon price drops', '<div class="flist">' + az.map((o) => amazonRow(o, true)).join('') + '</div>', azPill(amazonState(st.a, now))) : '';
    const setup = setupModel(m);
    // TV: one calm board (strip, six trending, six movers); categories and platforms sit one Down press below
    if (tv) {
      const tvStrip = tiles.length ? '<div class="g12 shop-strip"><div class="c-12">' + stripHtml(tiles) + '</div></div>' : '';
      return '<div class="board">' + tvStrip + '<div class="g12 shop-top">' + sect('c-6 s-trending', 'Trending', trendBody, trendAct) + sect('c-6 s-move', 'Best sellers and movers', prodBody) + '</div></div>' +
        '<div class="g12 shop-tv2">' + sect('c-6 s-cat', 'Category prices', catBody) + sect('c-6 s-plat', 'Platforms', platBody) + '</div>';
    }
    // the economy: one plain sentence from the collector's takeaway above one compact strip at the title step (shop.css)
    const take = takeaway(e), mac = (cls) => (tiles.length || take ? '<div class="' + (cls ? cls + ' ' : '') + 'shop-strip">' + (take ? '<p class="shop-take">' + esc(take) + '</p>' : '') + stripHtml(tiles, true) + '</div>' : '');
    const macRow = mac('c-12'), strip = macRow ? '<div class="g12">' + macRow + '</div>' : '';
    const trendSect = (c) => sect(c + ' s-trending', 'Trending', trendBody, trendAct), moveSect = (c) => sect(c + ' s-move', 'Best sellers and movers', prodBody), catSect = (c) => sect(c + ' s-cat', 'Category prices', catBody);
    // Trending answers the page, so it leads (PlanDesign M3; SeeGlanceTouch G5, SeeGlanceWide W4):
    //  P and T: Trending takes the row, the compact strip under it, then Best sellers and Category prices as halves;
    //  L: Trending beside the compact strip and Sells locally (two halves of similar height), then the two lists as halves;
    //  D and XL: the compact strip, then Trending, movers and categories in one row of 4/4/4.
    // P: the category chips get their own scrolling row under the header (headScope gives the header none), so the sub-tab
    // row keeps Market and Orders whole beside the freshness mark (WebKit defect D3)
    const out = [phone ? '<div class="shop-cats">' + chipRow(CAT_CHIPS, cat, 'cat', 'Category') + '</div>' : ''];
    // Sells locally: what each watched item asks near home against new (restored, SeeLostSweep L07); a row opens its sheet. It
    // follows the movers; on L it stacks under the compact strip beside Trending, so the two halves of the first row end together
    const lr = localList(e, m, cat), area = (lr.find((r) => r.area) || {}).area;
    const local = (cls) => (lr.length ? sect((cls ? cls + ' ' : '') + 's-local', 'Sells locally', '<p class="note sm">' + esc('Asking prices' + (area ? ' near ' + area : ' near home') + ', against the same item new.') + '</p>' + localHtml(lr, now)) : '');
    const localRow = lr.length ? '<div class="g12 shop-local">' + local('c-12') + '</div>' : '';
    if (wide) out.push(strip, '<div class="g12 shop-top">' + trendSect('c-4') + moveSect('c-4') + catSect('c-4') + '</div>', localRow);
    else if (st.cls === 'L') {
      const side = (macRow ? mac('') : '') + local('');
      out.push('<div class="g12 shop-top">' + (side ? trendSect('c-6') + '<div class="c-6 sstack shop-side">' + side + '</div>' : trendSect('c-12')) + '</div>', '<div class="g12 shop-two">' + moveSect('c-6') + catSect('c-6') + '</div>');
    } else out.push('<div class="g12 shop-top">' + trendSect('c-12') + '</div>', strip, '<div class="g12 shop-two">' + moveSect('c-6') + catSect('c-6') + '</div>', localRow);
    // Platforms on the left; the right column stacks Amazon price drops over Deals and resale and the marketplace Listings,
    // which also evens the two columns on a desk
    const lst = sect('s-lst', 'Listings', listingBody(listingRows(l, e, listingKeep(m, e, cat)), now, Math.max(LST_N, v.lst || 0), cat));
    const deal = sect('s-deal', 'Deals and resale', dealBody, segRow([['any', 'Any'], ['new', 'New']], v.cond || 'any', 'cond', 'Condition'));
    out.push('<div class="g12 shop-mid">' + sect('c-6 s-plat', 'Platforms', platBody, segRow(KIND_CHIPS, v.kind || 'all', 'pkind', 'Platform kind')) +
      // L flows these four in two columns (shop.css): Listings goes first there, so the columns pair as Platforms and Listings
      // beside Amazon price drops and Deals, which balances them (layout audit L 65)
      '<div class="c-6 sstack">' + (st.cls === 'L' ? lst + azSect + deal : azSect + deal + lst) + '</div></div>');
    if (tr.length) out.push('<div class="g12">' + sect('c-12 s-trend', 'Shopping searches', '<div class="flist">' + tr.map((t) => '<div class="frow"><span class="fl"><b>' + esc(t.title) + '</b></span>' + (t.traffic ? '<span class="fr"><small>' + esc(t.traffic) + ' searches</small></span>' : '') + '</div>').join('') + '</div>') + '</div>');
    if (cr.length) {
      out.push('<details class="sect s-cost"' + (phone ? '' : ' open') + '><summary class="secttl"><span>Selling costs</span></summary><div class="flist">' +
        cr.map((r) => '<div class="frow"><span class="fl"><b>' + esc(r.label) + '</b><small>' + esc(r.period) + '</small></span><span class="fr"><b>' + esc(r.value) + '</b>' + (r.chg != null ? '<small>' + delta(r.chg, r.pts) + '</small>' : '') + '</span></div>').join('') + '</div></details>');
    }
    // stores that need a key or wall the collector: one quiet row at the very bottom, opening the Data sheet's Setup section
    if (setup.stores) out.push('<button type="button" class="frow go shop-setup" data-sheet="data" data-scope="setup"><span class="fl"><b>' + setup.stores + (setup.stores === 1 ? ' store needs' : ' stores need') + ' setup</b></span></button>');
    return out.join('');
  }
  // the market feed is down (SeeStates E2): its own sections say so in one failed state with one Try again (the shared crossed square,
  // the same state Surf and Real estate draw, never a red wash bar), and every section fed by a part that did answer stays: Trending
  // (/api/trends), Sells locally (/api/ecom), Amazon price drops, Deals and resale (/api/ecom and /api/listings), Listings. Nothing answered: the one state.
  function downBody(st) {
    const e = isObj(st.e) ? st.e : null, l = isObj(st.l) && !st.l.error ? st.l : null, now = st.now, v = st.view || {};
    const bar = (words) => U().empty({ k: 'bad', title: words, line: 'Try again in a moment.', retry: 'shop' });
    const az = st.tv ? [] : amazonDeals(st.a, now), trOk = !!trendingList(st.tr, 'all');
    if (st.tv || (!e && !l && !az.length && !trOk)) return bar('Shop data is not reporting.');
    const trend = trOk ? '<div class="g12 shop-top">' + sect('c-12 s-trending', 'Trending', trendingBody(st.tr, 'all', v.trend, false), trendingAge(st.tr, now)) + '</div>' : '';
    const lr = localList(e, null, 'all'), area = (lr.find((r) => r.area) || {}).area;
    const local = lr.length ? sect('c-12 s-local', 'Sells locally', '<p class="note sm">' + esc('Asking prices' + (area ? ' near ' + area : ' near home') + ', against the same item new.') + '</p>' + localHtml(lr, now)) : '';
    const ds = dealRows(null, e, l, { cat: 'all', cond: v.cond }), dN = Math.max(6, v.deal || 0);
    const deal = e || l ? sect('s-deal', 'Deals and resale', ds.length ? '<div class="flist">' + ds.slice(0, dN).map((d) => dealRow(d, now)).join('') + '</div>' + more('deal', dN, ds.length)
      : '<div class="flist"><div class="frow"><span class="fl"><b>No deals under median right now.</b></span></div></div>', segRow([['any', 'Any'], ['new', 'New']], v.cond || 'any', 'cond', 'Condition')) : '';
    const lst = l ? sect('s-lst', 'Listings', listingBody(listingRows(l, e, null), now, Math.max(LST_N, v.lst || 0), 'all')) : '';
    const azSect = az.length ? sect('s-az', 'Amazon price drops', '<div class="flist">' + az.map((o) => amazonRow(o, true)).join('') + '</div>', azPill(amazonState(st.a, now))) : '';
    return bar('Market prices are not reporting.') + trend + (local ? '<div class="g12 shop-local">' + local + '</div>' : '') +
      '<div class="g12 shop-mid shop-down"><div class="c-12 sstack">' + azSect + deal + lst + '</div></div>';
  }
  // what the header's scope slot holds: the category chips on L, T, D and XL; nothing on P (the chips are a row under the header) or TV
  const headScope = (cls, tv, cat) => (tv || cls === 'P' ? '' : chipRow(CAT_CHIPS, cat || 'all', 'cat', 'Category', 'keep'));
  // the one freshness mark's arguments (DeckPages.mark draws it): feed age, its refresh, and how many parts did not answer
  function freshArgs(m, now, missing) {
    if (!isObj(m)) return { age: null, refresh: 3600, missing: (missing || 0) + 1 };
    const t = num(m.t), age = num(m.age) != null ? m.age : t != null ? Math.max(0, Math.round(now / 1000 - t)) : null;
    return { age, refresh: num(m.refresh) || 3600, missing: missing || 0 };
  }

  // ---------- sheets ----------
  // az = amazonBlockModel(...) for this watch, or null: a watch with no Amazon search shows no Amazon block
  function watchSheetHtml(s, az, now) {
    const at = num(now) != null ? now : Date.now();
    const r = s.range, rangeOk = r.med != null && r.p25 != null && r.p75 != null;
    const fmtR = (x) => priceText(x);
    const kv = (rows) => '<dl class="kv">' + rows.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>';
    const head = kv([['Median', price(s.median) + confHtml(s.conf)]].concat(s.chg1 != null ? [['1 day', delta(s.chg1)]] : [])
      .concat([['7 days', s.chg7 == null ? 'No data' : delta(s.chg7)], ['30 days', s.chg30 == null ? 'No data' : delta(s.chg30)]])
      .concat(s.best ? [['Best price', esc(priceText(s.best.price))], ['Best at', esc(s.best.store || 'No data')]]
        : s.used ? [['Best price, ' + s.used.cond, esc(priceText(s.used.price))], ['Best at', esc(s.used.store || 'No data')]]
        : s.why ? [['Best price', esc('None')]] : [])
      .concat(s.interest ? [['Page views, ' + s.interest.period, esc(F().count(s.interest.views))]].concat(s.interest.chg != null ? [['Views, 1-mo', delta(s.interest.chg)]] : []) : []));
    const parts = ['<section class="sh-sec"><h3>Price range</h3>' + (rangeOk ? U().range({ min: r.min, p25: r.p25, med: r.med, p75: r.p75, max: r.max, cur: r.cur, fmt: fmtR }) : '') + head + (s.why ? '<p class="note sm">' + esc(s.why) + '</p>' : '') +
      (s.bestLink ? '<div class="flist"><a class="frow" href="' + esc(s.bestLink.url) + '" target="_blank" rel="noopener noreferrer"><span class="fl"><b class="ptitle-t">' + esc(s.bestLink.title) + '</b><small>' + esc([s.bestLink.store, s.bestLink.cond].filter(Boolean).join(' · ')) + '</small></span><span class="fr"><b>' + price(s.bestLink.price) + '</b></span></a></div>' : '') + '</section>'];
    if (s.stores.length) parts.push('<section class="sh-sec"><h3>By store</h3>' + U().bars(s.stores.map((b, i) => ({ label: b.store, value: b.median, text: priceText(b.median) + (b.n != null ? ' · ' + F().count(b.n) : ''), on: i === 0, key: b.store })), { sort: false }) + '</section>');
    if (az) parts.push(amazonBlockHtml(az));
    if (s.listings) parts.push(lstSheetHtml(s.listings, at));
    if (s.resale) parts.push(resaleHtml(s.resale));
    if (s.dupes && s.dupes.length) parts.push(dupesHtml(s, at));
    if (s.line.filter((x) => x[1] != null).length > 1) parts.push('<section class="sh-sec"><h3>Last 30 days</h3>' + U().line({ series: s.line, yfmt: fmtR, label: 'Median price by day' }) + '</section>');
    if (s.season) parts.push('<section class="sh-sec"><h3>Season</h3>' + U().bars(s.season.filter((x) => x.value != null).map((x) => ({ label: x.label, value: x.value, text: x.value.toFixed(2) })), { sort: false }) + '</section>');
    if (s.supply.length) parts.push('<section class="sh-sec"><h3>Supply and shipping</h3>' + kv(s.supply.map(([k, v]) => [k, esc(v)])) + '</section>');
    if (s.condition.length) parts.push('<section class="sh-sec"><h3>Condition</h3>' + kv(s.condition.map(([k, v]) => [k, esc(v)])) + '</section>');
    parts.push('<p class="note">Asking prices, not sold prices.</p>');
    if (s.missing.length) parts.push(U().missing(s.missing));
    return parts.join('');
  }
  function productSheetHtml(p) {
    const kv = (rows) => '<dl class="kv">' + rows.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>';
    const rows = [['Best price', price(p.price)], ['Stores', esc(String(p.stores))]];
    if (p.median != null) rows.push(['Median', price(p.median)]);
    if (p.spread != null) rows.push(['Spread', price(p.spread)]);
    if (p.chg != null) rows.push([p.kindWord, delta(p.chg) + (p.move ? ' ' + esc(p.move) : '')]);
    if (p.rank != null) rows.push(['Best rank', esc(String(p.rank))]);
    const table = p.offers.length ? U().table({
      cols: [{ key: 'store', label: 'Store', place: true }, { key: 'price', label: 'Price', num: true }, { key: 'regular', label: 'Regular', num: true, pri: 2 }, { key: 'rank', label: 'Rank', num: true, pri: 2 }],
      rows: p.offers, key: (o) => o.store,
      cell: (o, c) => c.key === 'store' ? '<span class="place"><b>' + esc(o.store) + '</b>' + (o.day ? '<small>' + esc(o.day) + '</small>' : '') + '</span>'
        : c.key === 'price' ? price(o.price) : c.key === 'regular' ? (o.regular != null ? price(o.regular) : o.reference != null ? price(o.reference) : F().na()) : o.rank != null ? esc(String(o.rank)) : F().na()
    }) : '';
    const links = p.offers.filter((o) => o.url).map((o) => '<a class="frow" href="' + esc(o.url) + '" target="_blank" rel="noopener noreferrer"><span class="fl"><b>Open at ' + esc(o.store) + '</b></span><span class="fr"><b>' + price(o.price) + '</b></span></a>').join('');
    return '<section class="sh-sec"><h3 class="ptitle-t">' + esc(p.fullTitle) + '</h3>' + kv(rows) + '</section>' + (table ? '<section class="sh-sec"><h3>Stores</h3>' + table + '</section>' : '') +
      (links ? '<section class="sh-sec"><div class="flist">' + links + '</div></section>' : '') + U().missing(['price history']);
  }
  function platformSheetHtml(r) {
    const rows = [['Rank', r.rank == null ? 'No data' : String(r.rank)], ['Kind', r.kind], ['App rank', r.app == null ? 'No data' : String(r.app)],
      ['App move, 7 days', r.appMove == null ? 'No data' : String(r.appMove)], ['Web rank', r.web == null ? 'No data' : F().count(r.web)],
      ['30-day move', r.move == null ? 'No data' : String(r.move)], ['Prices tracked', r.priced ? 'Yes' : 'No']];
    return '<dl class="kv">' + rows.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>' + (r.note ? '<p class="note">' + esc(r.note) + '</p>' : '');
  }

  // ---------- Orders ----------
  const TZ = 'America/Los_Angeles';
  function daysLeft(d, now) {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const today = new Date(now).toLocaleDateString('en-CA', { timeZone: TZ }), a = Date.parse(today + 'T00:00:00Z'), b = Date.parse(d + 'T00:00:00Z');
    return isFinite(a) && isFinite(b) ? Math.round((b - a) / 86400000) : null;
  }
  const returnWord = (n) => (n == null ? { w: 'Date unknown', k: 'warn' } : n < 0 ? { w: 'Window closed', k: 'bad' } : n === 0 ? { w: 'Last day today', k: 'bad' } : { w: n + (n === 1 ? ' day' : ' days') + ' left', k: n <= 7 ? 'warn' : '' });
  function ordersModel(c, now) {
    if (!isObj(c) || c.error) return { down: true, open: [], rest: [], failed: [], paused: false, older: 0 };
    const os = arr(c.orders).filter(isObj).map((o) => ({ id: str(o.id, 60), title: cleanTitle(o.title || 'Amazon order'), date: str(o.date, 10), returnBy: str(o.return_by, 10), amount: num(o.amount), days: daysLeft(str(o.return_by, 10), now) }));
    const mon = isObj(c.monitor) ? c.monitor : {}, ran = U().toEpoch(mon.last_run_at);
    return {
      down: false, open: os.filter((o) => o.returnBy).sort((a, b) => (a.days == null) - (b.days == null) || a.days - b.days), rest: os.filter((o) => !o.returnBy),
      paused: mon.state === 'paused', ranAge: ran == null ? null : Math.max(0, now / 1000 - ran), checked: U().toEpoch(c.checked), stale: c.stale === true,
      failed: arr(c.pulls).filter((p) => isObj(p) && p.ok !== true).map((p) => str(p.account, 30) || 'a mailbox'), older: Math.max(0, (num(c.total) || 0) - os.length)
    };
  }
  const dayText = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? F().date(d) : '');
  const LAUNCH = [['amazon-orders', 'Your orders', 'Amazon'], ['amazon-returns', 'Returns', 'Amazon'], ['commerce-ink-dashboard', 'Commerce Ink dashboard', 'Opens on the PC only'], ['commerce-ink', 'commerceink.com', 'Their public site']];
  const PHONE = [['https://www.amazon.com/your-orders/orders', 'Orders on this phone'], ['https://www.amazon.com/gp/css/returns/homepage.html', 'Returns on this phone']];
  // st: {c, now, host, rev, armed, tv}
  function ordersBody(st) {
    const o = ordersModel(st.c, st.now), on = st.host === 'Dell' ? 'Dell' : 'PC';
    // Return deadlines answers the page, then Purchases. Off TV they stack across the full row: side by side, a two-line Return
    // deadlines left a 224 px hole beside four purchases on his 2470 px window (SeeWs4 W4-8) and on L. The TV board keeps halves.
    const half = st.tv ? 'c-6' : 'c-12';
    const launch = '<div class="flist">' + LAUNCH.map(([id, t, sub]) => {
      const armed = st.armed === id;
      return '<button type="button" class="frow lrow' + (armed ? ' armed' : '') + '" data-cm="' + esc(id) + '"' + (armed ? ' aria-label="' + esc(t + ', tap again to open on ' + on) + '"' : '') + '><span class="fl"><b>' + esc(armed ? 'Tap again' : t) + '</b><small>' + esc(armed ? 'Opens on ' + on : sub) + '</small></span></button>';
    }).join('') + PHONE.map(([u, t]) => '<a class="frow" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer"><span class="fl"><b>' + esc(t) + '</b></span></a>').join('') + '</div>';
    // the page status, at most one line, as the first row of Return deadlines: the owner's pause first, else a failed mail check
    const status = o.down ? '' : o.paused ? '<div class="frow ostat" role="status"><span class="sd warn"></span><span class="fl"><b>' + esc('Paused by you · ' + (o.ranAge == null ? 'never ran' : 'last ran ' + F().age(o.ranAge) + ' ago')) + '</b></span></div>'
      : o.failed.length ? '<div class="frow ostat" role="status"><span class="sd bad"></span><span class="fl"><b>' + esc('Mail check failed for ' + o.failed.join(', ')) + '</b><small>New orders show once it works.</small></span></div>' : '';
    const openRows = o.open.map((x) => {
      const r = returnWord(x.days);
      return '<div class="frow' + (r.k === 'bad' ? ' err' : '') + '"><span class="fl"><b class="ptitle-t">' + esc(x.title) + '</b><small>' + esc([x.date ? 'Delivered ' + dayText(x.date) : '', 'return by ' + dayText(x.returnBy)].filter(Boolean).join(' · ')) + '</small></span><span class="fr">' + U().pill(r.k || 'ok', r.w) + '</span></div>';
    }).join('');
    const open = sect(half + ' s-open', 'Return deadlines', o.down ? U().empty({ k: 'bad', title: 'Orders are not reporting.', retry: 'shop' })
      : '<div class="flist">' + status + (openRows || '<div class="frow"><span class="fl"><b>No open return windows.</b></span></div>') + '</div>');
    const reveal = !o.down && o.rest.some((x) => x.amount != null) ? '<button type="button" class="btn btn-sm btn-quiet act" data-rev="' + (st.rev ? '0' : '1') + '">' + (st.rev ? 'Hide' : 'Show amounts') + '</button>' : '';
    const rest = o.down ? '' : sect(half + ' s-rest', 'Purchases', (o.rest.length ? '<div class="flist">' + o.rest.map((x) => '<div class="frow"><span class="fl"><b class="ptitle-t">' + esc(x.title) + '</b><small>' + esc(x.date ? 'Delivered ' + dayText(x.date) : 'Date not recorded') + '</small></span>' +
      (x.amount != null ? '<span class="fr"><b>' + esc(F().money(x.amount, { cents: true, masked: !st.rev })) + '</b></span>' : '') + '</div>').join('') + '</div>' : '<div class="flist"><div class="frow"><span class="fl"><b>No other purchases recorded.</b></span></div></div>') +
      (o.older ? '<p class="note sm">' + esc(o.older + ' older orders not shown') + '</p>' : ''), reveal);
    // TV: deadlines and purchases are the board; the launch rows sit one Down press below
    return '<div class="board"><div class="g12">' + open + rest + '</div></div><div class="g12">' + sect('c-12 s-launch', 'Open', launch) + '</div>';
  }
  // one status per page: while the owner has paused the monitor the Paused row says it, so the mark shows the plain age, not a second warning
  function ordersFresh(st) {
    const o = ordersModel(st.c, st.now);
    if (o.down) return { age: null, refresh: 86400, missing: 1 };
    const age = o.checked == null ? null : Math.max(0, Math.round(st.now / 1000 - o.checked));
    return { age, refresh: o.paused && age != null ? Math.max(86400, age) : 86400, missing: 0 };
  }
  function ordersData(c) {
    const o = ordersModel(c, Date.now());
    return {
      sources: [{ name: 'Purchase monitor', gives: 'Amazon orders and return dates from mail', asOf: o.checked ? new Date(o.checked * 1000).toISOString().slice(0, 10) : '', state: o.down ? 'never' : o.stale ? 'stale' : 'ok' }],
      blends: [], method: [['Return dates', 'From delivery mail; a window counts in Pacific time.']],
      setup: o.paused ? [{ name: 'Purchase monitor', line: 'The purchase monitor is paused in Hermes crons.', state: 'blocked' }] : []
    };
  }

  // ---------- what a good answer looks like, per read (DeckPages.get `shape`) ----------
  // An error body passes here and is judged by its `error` field. Otherwise the write time is a number when present, every list
  // the page reads is an array or absent, every block an object or absent, and the market feed carries its watches (the
  // contract always writes `watches.items`). A wrong-typed answer ("t":"soon", "items":5, "groups":true) is a failed read.
  const listOrNone = (x) => x == null || Array.isArray(x);
  const objOrNone = (x) => x == null || isObj(x);
  const body = (d, rest) => isObj(d) && (typeof d.error === 'string' || ((d.t == null || num(d.t) != null) && rest(d)));
  const SHAPE = {
    'ecom-market': (d) => body(d, (x) => isObj(x.watches) && Array.isArray(x.watches.items) &&
      ['macro', 'platforms', 'bestsellers', 'movers', 'categories', 'trending', 'sources'].every((k) => listOrNone(x[k]))),
    ecom: (d) => body(d, (x) => objOrNone(x.movers_info) && ['watch', 'movers', 'resale', 'deals', 'macro'].every((k) => listOrNone(x[k]))),
    listings: (d) => body(d, (x) => listOrNone(x.listings) && listOrNone(x.groups)),
    amazon: (d) => body(d, (x) => listOrNone(x.watch) && listOrNone(x.deals) && listOrNone(x.items)),
    trends: (d) => body(d, (x) => Array.isArray(x.products) && listOrNone(x.feeds)),
    commerce: (d) => body(d, (x) => listOrNone(x.orders) && listOrNone(x.pulls) && objOrNone(x.monitor))
  };

  return {
    nice, cleanTitle, periodLabel, daily, macroModel, macroTile, agreeOf, watchModel, watchSheetModel, productModel, productList, productSheetModel,
    categoryModel, categoryList, catPeriod, platformRows, trendRows, dealRows, costRows, setupModel, dataModel, marketBody, freshArgs,
    watchSheetHtml, productSheetHtml, platformSheetHtml, ordersModel, ordersBody, ordersFresh, ordersData, daysLeft, returnWord,
    amazonState, amazonOffer, amazonFor, amazonBlockModel, amazonBlockHtml, amazonDeals, amazonSource,
    listingRows, listingKeep, resaleModel, lstRowHtml, eventList, eventsStale, localList, localHtml, takeaway, loadingBody,
    trendingList, trendingBody, trendRow, trendsSource, TREND_N, CAT_CHIPS, chipRow, BUILD_DAYS, headScope, SHAPE, cardTitle
  };
})();

// ---------- page glue: DeckPages registry, fetch, taps ----------
(() => {
  if (typeof DeckPages === 'undefined' || typeof document === 'undefined') return;
  // every fetch here is bounded (PageLanes 13.6): DeckPages.get with FETCH_MS, then the not-reporting state
  const S = DeckShop, ARM_MS = 3000, HIDE_MS = 30000, FETCH_MS = 60000;
  const load = (k, d) => { try { const v = localStorage.getItem('shop:' + k); return v || d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem('shop:' + k, v); } catch (e) { /* private mode */ } };
  // wait: the market feed has not answered this visit; down: which side parts answered with a failure; seq: the newest fetch
  // tr: the trends feed, undefined until it answers this load (Trending shows its skeleton), then the data or {error}
  const M = { m: null, e: null, l: null, a: null, tr: undefined, miss: 0, wait: false, down: { e: false, l: false, tr: false }, seq: 0, view: { cat: load('cat', 'all'), kind: load('kind', 'all'), cond: load('cond', 'any'), mover: 'all' }, ctx: null };
  const O = { c: null, rev: false, revT: 0, armed: '', armT: 0, ctx: null };
  const shell = () => (typeof DeckShell !== 'undefined' ? DeckShell : null);
  // the computer picked in the top bar (app.js `host`, a global lexical binding)
  const hostNow = () => (typeof host === 'string' ? host : 'pc-desktop');
  // header: category chips in the scope slot (kept on phones); the one freshness mark goes through DeckPages.mark (none while loading)
  function head(ctx, scope, fresh) {
    const ps = ctx && ctx.head ? ctx.head.querySelector('.pscope') : null;
    if (ps) ps.innerHTML = scope;
    if (fresh) DeckPages.mark(ctx, fresh);
  }
  function paintMarket() {
    const ctx = M.ctx;
    if (!ctx || !ctx.el) return;
    const now = Date.now();
    try {
      const loading = M.wait && !M.m;
      head(ctx, S.headScope(ctx.cls, ctx.tv, M.view.cat), loading ? null : S.freshArgs(M.m, now, M.miss));
      ctx.el.innerHTML = S.marketBody({ m: M.m, e: M.e, l: M.l, a: M.a, tr: M.tr, now, cls: ctx.cls, tv: ctx.tv, view: M.view, loading });
    } catch (err) {
      ctx.el.innerHTML = DeckUI.empty({ k: 'bad', title: 'Could not show Shop.', retry: 'shop' });
    }
    DeckPages.tv(ctx);
  }
  // The five parts paint as each one answers. The market feed is the page; trends, watch detail, listings and Amazon add to it. One slow
  // or hanging part (Amazon runs sqlite3 over a 130 MB database) never holds the page blank: before, the page waited for all
  // four, so a phone on a cold deck showed the sub-tab row over nothing for up to 60 s. Until the market feed answers the page
  // says Loading. Only the newest fetch's answers count, so an older answer that lands late never replaces a newer one.
  // A read counts only when its body has the shape the page reads (S.SHAPE): a wrong-typed answer is a failed part, so it says
  // not reporting (or, once DeckPages.get keeps last good, keeps the last good rows) instead of "No watches yet" (SeeStates E5).
  // The same check rides on DeckPages.get as `shape`, which the guard (#363) uses to decide what a good answer is.
  const good = (p, r) => !!(r && r.ok && r.data && !r.data.error && S.SHAPE[p](r.data));
  const PARTS = {
    'ecom-market': (r) => { M.m = good('ecom-market', r) ? Object.assign({}, r.data, { age: r.data.age != null ? r.data.age : r.age }) : null; M.wait = false; },
    ecom: (r) => { M.e = good('ecom', r) ? r.data : null; M.down.e = !M.e; },
    listings: (r) => { M.l = good('listings', r) ? r.data : null; M.down.l = !M.l; },
    // the Amazon view keeps its own status on its own blocks; a failed read shows no Amazon block and a source row in the Data sheet
    amazon: (r) => { M.a = good('amazon', r) ? r.data : { error: (r && r.error) || (r && r.ok ? 'wrong shape' : 'http ' + (r ? r.status : 0)) }; },
    // Trending: a kept last good answer stays as it was; the page's one mark says Out of date (DeckPages.get), the feed's own stale flag its title
    trends: (r) => {
      M.tr = good('trends', r) ? r.data : { error: (r && r.data && r.data.error) || (r && r.error) || 'http ' + (r ? r.status : 0) };
      M.down.tr = !!M.tr.error;
    }
  };
  function fetchMarket() {
    const n = ++M.seq;
    if (!M.m) { M.wait = true; paintMarket(); }
    return Promise.all(Object.keys(PARTS).map((p) => DeckPages.get(p, { timeout: FETCH_MS, shape: S.SHAPE[p] }).then((r) => {
      if (n !== M.seq) return;
      PARTS[p](r);
      M.miss = (M.down.e ? 1 : 0) + (M.down.l ? 1 : 0) + (M.down.tr ? 1 : 0);
      paintMarket();
    })));
  }
  function openSheet(spec) { const s = shell(); if (s && s.sheet) s.sheet.open(spec); }
  const dataBtn = (scope) => '<button class="btn" data-sheet="data"' + (scope ? ' data-scope="' + DeckUI.esc(scope) + '"' : '') + '>Data</button>';
  function marketTap(ev) {
    const t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    if (t.closest('[data-retry="shop"]')) return fetchMarket();
    const b = t.closest('[data-cat],[data-mover],[data-pkind],[data-cond],[data-more],[data-open],[data-scope]');
    if (!b) return;
    const d = b.dataset;
    if (d.cat) { M.view.cat = d.cat; save('cat', d.cat); M.view.trend = M.view.product = M.view.deal = M.view.lst = 0; return paintMarket(); }
    if (d.mover) { M.view.mover = d.mover; M.view.product = 0; return paintMarket(); }
    if (d.pkind) { M.view.kind = d.pkind; save('kind', d.pkind); return paintMarket(); }
    if (d.cond) { M.view.cond = d.cond; save('cond', d.cond); return paintMarket(); }
    if (d.more) {
      // Count from the rows already drawn, including the platform table's wider first page.
      const k = d.more, cls = M.ctx && M.ctx.cls, wide = cls === 'D' || cls === 'XL';
      const base = k === 'plat' ? (cls === 'P' || cls === 'L' ? 10 : cls === 'XL' ? 20 : 24) : k === 'product' && wide ? 4 : 6;
      M.view[k] = Math.max(M.view[k] || 0, base) + (k === 'plat' ? 20 : 12);
      return paintMarket();
    }
    if (d.scope && shell() && shell().sheet && shell().sheet.data) { ev.preventDefault(); ev.stopPropagation(); return shell().sheet.data(d.scope); }
    const m = M.m;
    if (!m) return;
    if (d.open === 'watch') {
      const w = (m.watches && m.watches.items || []).find((x) => x && x.slug === d.key);
      if (!w) return;
      const old = (M.e && M.e.watch || []).find((x) => x && x.slug === d.key);
      const s = S.watchSheetModel(w, old, M.e, M.l);
      openSheet({ id: 'watch', title: s.name, sub: 'Asking prices · last 7 days', body: S.watchSheetHtml(s, S.amazonBlockModel(M.a, s.slug, s.name, Date.now()), Date.now()), actions: dataBtn('watch:' + s.slug), wide: true });
    } else if (d.open === 'product') {
      const p = (m.movers || []).concat(m.bestsellers || []).find((x) => x && x.gid === d.key);
      if (!p) return;
      const s = S.productSheetModel(p);
      openSheet({ id: 'product', title: s.kindWord, sub: s.where, body: S.productSheetHtml(s), actions: dataBtn(''), wide: true });
    } else if (d.open === 'platform') {
      const r = S.platformRows(m, 'all', 1000).find((x) => x.key === d.key);
      if (r) openSheet({ id: 'platform', title: r.name, sub: r.kind, body: S.platformSheetHtml(r), actions: dataBtn('') });
    }
  }
  let wiredM = null, wiredH = null, wiredO = null;
  // the chip row moves between the header and the page with the device class: repaint when the class changes
  if (typeof DeckPages.onClass === 'function') DeckPages.onClass((e) => { if (M.ctx) { M.ctx.cls = (e && e.cls) || DeckPages.cls(); paintMarket(); } });
  // the category chips live in the shared Shop header, so the header listener acts only while Market is the visible sub
  const headTap = (ev) => { const b = M.ctx && ev.target && ev.target.closest ? ev.target.closest('[data-cat]') : null; if (b) marketTap(ev); };
  DeckPages.register('shop/market', {
    show(ctx) {
      M.ctx = ctx;
      if (wiredM !== ctx.el) { ctx.el.addEventListener('click', marketTap); wiredM = ctx.el; }
      if (ctx.head && wiredH !== ctx.head) { ctx.head.addEventListener('click', headTap); wiredH = ctx.head; }
      if (M.m) paintMarket();
      return fetchMarket();
    },
    refresh(ctx) { M.ctx = ctx; return fetchMarket(); },
    hide() { M.ctx = null; },
    data(ctx, scope) { return S.dataModel(M.m, scope && scope !== 'setup' ? scope : '', [S.trendsSource(M.tr)], M.a, M.e, Date.now()); }
  });

  function paintOrders() {
    const ctx = O.ctx;
    if (!ctx || !ctx.el) return;
    const st = { c: O.c, now: Date.now(), host: hostNow(), rev: O.rev, armed: O.armed, tv: !!ctx.tv };
    try { head(ctx, '', S.ordersFresh(st)); ctx.el.innerHTML = S.ordersBody(st); } catch (err) { ctx.el.innerHTML = DeckUI.empty({ k: 'bad', title: 'Could not show Orders.', retry: 'shop' }); }
    DeckPages.tv(ctx);
  }
  async function fetchOrders() {
    const r = await DeckPages.get('commerce', { timeout: FETCH_MS, shape: S.SHAPE.commerce });
    O.c = r.ok && r.data && S.SHAPE.commerce(r.data) ? r.data : { error: r.error || (r.ok ? 'wrong shape' : 'http ' + r.status) };
    paintOrders();
  }
  function hideAmounts() { clearTimeout(O.revT); O.revT = 0; if (O.rev) { O.rev = false; paintOrders(); } }
  async function ordersTap(ev) {
    const t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    if (t.closest('[data-retry="shop"]')) return fetchOrders();
    const rv = t.closest('[data-rev]');
    if (rv) { if (rv.dataset.rev === '1') { O.rev = true; clearTimeout(O.revT); O.revT = setTimeout(hideAmounts, HIDE_MS); paintOrders(); } else hideAmounts(); return; }
    const b = t.closest('button[data-cm]');
    if (!b || b.disabled) return;
    const id = b.dataset.cm;
    // the second tap opens it: the first arms the row for 3 s
    if (O.armed !== id) { O.armed = id; clearTimeout(O.armT); O.armT = setTimeout(() => { O.armed = ''; paintOrders(); }, ARM_MS); return paintOrders(); }
    O.armed = ''; clearTimeout(O.armT);
    let ok = false, msg = 'Did not open';
    // bounded like every page fetch (PageLanes 13.6): 60 s, then "The deck did not answer"
    const ac = typeof AbortController === 'function' ? new AbortController() : null, cut = setTimeout(() => { if (ac) ac.abort(); }, FETCH_MS);
    try {
      const r = await fetch('/api/launch?v=' + encodeURIComponent(id) + '&host=' + encodeURIComponent(hostNow()), { method: 'POST', credentials: 'same-origin', signal: ac ? ac.signal : undefined }).then((x) => x.json());
      ok = !!r && !r.error && r.ok !== false; msg = ok ? 'Opened' : String((r && r.error) || 'Did not open').slice(0, 80);
    } catch (err) { msg = 'The deck did not answer'; } finally { clearTimeout(cut); }
    paintOrders();
    if (shell() && shell().status) shell().status(ok ? null : { k: 'bad', word: 'Not opened', detail: msg });
  }
  DeckPages.register('shop/orders', {
    show(ctx) { O.ctx = ctx; if (wiredO !== ctx.el) { ctx.el.addEventListener('click', ordersTap); wiredO = ctx.el; } if (O.c) paintOrders(); return fetchOrders(); },
    refresh(ctx) { O.ctx = ctx; return fetchOrders(); },
    hide() { O.ctx = null; hideAmounts(); clearTimeout(O.armT); O.armed = ''; },
    data() { return S.ordersData(O.c); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) hideAmounts(); });
})();
