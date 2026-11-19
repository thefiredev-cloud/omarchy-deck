// Surf page (lane PgSurf, 2026-11-14): Cabo San Lucas to the Columbia River, the owner's Dana Point spots first.
// Data: GET /api/surf-coast (overview) and GET /api/surf-coast/region/<id> (spot sheet detail); contract docs/surf-coast.md.
// What the page shows: PageBlueprints section 6. Nothing about sources on the page: station ids, blend weights, the
// model correction and coverage counts open in the Data sheet. The model functions below are pure (node tests call them
// without a DOM); the render functions use DeckUI helpers; the page registers under `surf` when DeckPages exists.
const DeckSurf = (() => {
  const REGIONS = ['baja-sur', 'baja-norte', 'san-diego', 'orange-county', 'los-angeles', 'ventura', 'santa-barbara',
    'san-luis-obispo', 'monterey-santa-cruz', 'san-francisco-marin', 'sonoma-del-norte', 'oregon-south', 'oregon-central', 'oregon-north'];
  const HOME_REGION = 'orange-county';
  const WORDS = ['Flat', 'Poor', 'Fair', 'Good', 'Great'];
  const LAT0 = 22.9, LAT1 = 46.3;
  const READING = new Set(['buoy', 'pier', 'shore station', 'tide station']);
  const PAGE = 50;
  const MINUS = '\u2212';
  const NB = '\u00A0';
  const SEV = { extreme: 4, severe: 3, moderate: 2, minor: 1 };
  const FETCH_MS = 60000; // every fetch is bounded (PageLanes 13); a timeout paints "Surf is not reporting."

  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const arr = v => (Array.isArray(v) ? v : []);
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const str = v => (typeof v === 'string' ? v.trim() : '');
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const isBaja = id => /^baja-/.test(str(id));

  // ---------- model (pure) ----------

  // Five pips plus the word, no hue. The feed's word wins; a bare 0-10 score maps by the docs/surf-coast.md bands
  // (docs/surf-coast.md after #240: Great from 9.75, Good from 7.5, Fair from 5, else Poor). Flat depends on size, so
  // only the word can say Flat. `score` (unrounded) is read before the rounded `rating`.
  function rate(o) {
    const w = str(o && o.word), i = WORDS.findIndex(x => x.toLowerCase() === w.toLowerCase());
    if (i >= 0) return { q: i + 1, word: WORDS[i] };
    const r = num(o && o.score) ?? num(o && o.rating);
    if (r == null) return { q: 0, word: 'No rating' };
    const k = r >= 9.75 ? 4 : r >= 7.5 ? 3 : r >= 5 ? 2 : 1;
    return { q: k + 1, word: WORDS[k] };
  }

  const isModel = s => !!(s && obj(s.now) && obj(s.now.confidence) && s.now.confidence.model_only === true);
  // A region is forecast only when it has spots and every one is model only (Baja Sur today).
  function regionModelOnly(id, spots) {
    const in_ = arr(spots).filter(s => s && s.region === id);
    return in_.length > 0 && in_.every(isModel);
  }

  // [5, 6] -> "5-6", [5, 5] -> "5"; null when there is no reading
  function heightText(range) {
    const a = arr(range).map(num);
    if (a.length < 1 || a[0] == null) return null;
    const lo = Math.round(a[0]), hi = a[1] == null ? lo : Math.round(a[1]);
    return lo === hi ? String(lo) : lo + '-' + hi;
  }
  // A model gives a mean period, not a peak period, so a model-only spot says "about".
  function periodText(p, model) {
    const v = num(p);
    if (v == null) return null;
    return (model ? 'about ' : '') + Math.round(v) + NB + 's';
  }

  // Zone mark when the spot's clock differs from Pacific time at that moment (Baja Sur is UTC-7 all year, so it differs
  // in winter and matches in summer). Returns '' when it matches or the zone is unknown.
  function offsetOf(tz, at) {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset', hour: 'numeric' })
        .formatToParts(new Date(at * 1000)).find(x => x.type === 'timeZoneName');
      return p ? p.value : null;
    } catch (e) { return null; }
  }
  function zoneMark(tz, at) {
    if (!str(tz) || tz === 'America/Los_Angeles' || num(at) == null) return '';
    const a = offsetOf(tz, at), b = offsetOf('America/Los_Angeles', at);
    if (!a || !b || a === b) return '';
    return a.replace(/^GMT/, 'UTC').replace('-', MINUS);
  }
  const withZone = (label, tz, at) => { const z = zoneMark(tz, at); return str(label) ? str(label) + (z ? ' ' + z : '') : ''; };
  function clockIn(tz, at) {
    if (num(at) == null) return '';
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: str(tz) || 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })
        .format(new Date(at * 1000)).replace(':00', '').replace(/\s?([AP])M$/, (m, x) => ' ' + x.toLowerCase() + 'm');
    } catch (e) { return ''; }
  }
  function dayIn(tz, at) {
    try { return new Intl.DateTimeFormat('en-US', { timeZone: str(tz) || 'America/Los_Angeles', weekday: 'short' }).format(new Date(at * 1000)); } catch (e) { return ''; }
  }

  // Tide per spot. A tide table (NOAA prediction, including the Mexican stations near Ensenada, San Carlos and La Paz)
  // draws the normal curve; a model sea level draws a dashed curve with the low mark; no station says so.
  function tideMode(spot, tidesById) {
    const id = str(spot && spot.tide_station);
    if (!id) return { kind: 'none', line: 'No tide table for this spot.' };
    const t = tidesById && tidesById[id];
    if (/^model:/.test(id) || (t && t.kind === 'model')) return { kind: 'model', line: 'Approximate tide. No tide table here.' };
    return { kind: 'table', line: '' };
  }
  // Next tide on a card: "Low tide 7:08 pm"; an approximate tide reads "Low tide about 8:01 pm UTC−7".
  function tideCardText(spot, mode) {
    if (!mode || mode.kind === 'none') return 'No tide table';
    const nx = obj(spot && spot.now && spot.now.tide && spot.now.tide.next);
    if (!nx || !str(nx.label)) return '';
    const t = (nx.type === 'H' ? 'High' : 'Low') + ' tide ' + (mode.kind === 'model' ? 'about ' : '');
    return t + withZone(nx.label, spot.tz, nx.at);
  }

  // Wind words on the page: Offshore, Glassy, Cross-shore, Onshore, with light and strong kept from the feed.
  function windWord(w) {
    const s = str(w && w.word).toLowerCase();
    if (!s) return '';
    if (s === 'calm' || s === 'glassy') return 'Glassy';
    return cap(s);
  }
  // Value and unit stay together (no-break space); the word comes first, so a card reads "Glassy 4 kt".
  const windText = w => {
    const kt = num(w && w.kt), word = windWord(w);
    if (kt == null) return word;
    return (word ? word + ' ' : '') + Math.round(kt) + NB + 'kt';
  };

  // Best window: "Tomorrow 6-8 am" after dark, the bare window today, with the zone mark where it applies.
  function bestText(best, tz) {
    const b = obj(best);
    if (!b || !str(b.label)) return '';
    const l = withZone(b.label, tz, b.start);
    return b.day === 'tomorrow' ? 'Tomorrow ' + l : 'Today ' + l;
  }

  // The reason line only shows clauses the card's fields do not already say (size, period, direction, wind, tide).
  function reasonExtra(now) {
    const n = obj(now);
    if (!n) return '';
    const word = str(n.wind && n.wind.word).toLowerCase();
    const said = [
      /^(under )?\d+(-\d+)? ft( at \d+ s)?( from (the )?[NSEW]{1,3})?$/i,
      /^\d+ s( swell)?( from (the )?[NSEW]{1,3})?$/i,
      /^(rising|falling|high|low|slack) tide$/i,
      /^(calm|glassy|light|strong)?\s*(offshore|onshore|cross-shore)?\s*wind( \d+ kt)?$/i
    ];
    const left = str(n.reason).split(/,\s*/).filter(c => c && !said.some(re => re.test(c)) && !(word && c.toLowerCase().startsWith(word)));
    return left.join(', ');
  }

  // Alerts grouped by event. Baja gets only offshore high-seas statements, worded "Offshore seas" so nobody reads them as
  // surf-zone advice. Groups touching the owner's region sort first.
  function alertWord(a) {
    const regs = arr(a && a.regions);
    if (regs.length && regs.every(isBaja)) return 'Offshore seas';
    return cap(str(a && a.event).toLowerCase()) || 'Alert';
  }
  // Where an alert applies: the owner's region first, then south to north; past two names, a count.
  function placeText(ids, names) {
    const order = REGIONS.filter(r => ids.includes(r)).sort((a, b) => (b === HOME_REGION) - (a === HOME_REGION));
    const nm = r => (names && names[r]) || r;
    if (order.length <= 2) return order.map(nm).join(', ');
    const k = order.length - 2;
    return nm(order[0]) + ', ' + nm(order[1]) + ' and ' + k + ' more ' + (k === 1 ? 'region' : 'regions');
  }
  function alertGroups(alerts, names) {
    const by = new Map();
    for (const a of arr(alerts).filter(obj)) {
      const word = alertWord(a);
      let g = by.get(word);
      if (!g) { g = { word, regions: [], items: [], end: null, until: '', severe: false, rank: 0 }; by.set(word, g); }
      for (const r of arr(a.regions)) if (!g.regions.includes(r)) g.regions.push(r);
      g.items.push(a);
      if (num(a.end) != null && (g.end == null || a.end > g.end)) { g.end = a.end; g.until = str(a.until_label); }
      if (/severe|extreme/i.test(str(a.severity))) g.severe = true;
      g.rank = Math.max(g.rank, SEV[str(a.severity).toLowerCase()] || 0);
    }
    const out = [...by.values()].map(g => Object.assign(g, {
      home: g.regions.includes(HOME_REGION),
      place: placeText(g.regions, names),
      text: g.word + ' \u00B7 ' + placeText(g.regions, names) + (g.until ? ' \u00B7 until ' + g.until : '')
    }));
    out.sort((a, b) => (b.home - a.home) || (b.rank - a.rank) || Math.min(...a.regions.map(r => REGIONS.indexOf(r))) - Math.min(...b.regions.map(r => REGIONS.indexOf(r))));
    return out;
  }
  // Main's alerts rule (2026-11-14, same on iOS): only alerts touching a home spot's region go above "Your spots", at
  // most two rows, most severe first; everything else is counted once after the spots. Repeat statements (one per
  // NWS zone) count once.
  function alertSplit(feed, names) {
    const homeRegs = new Set(pinnedSpots(feed && feed.spots).map(s => s.region));
    const all = arr(feed && feed.alerts).filter(obj);
    const touches = a => arr(a.regions).some(r => homeRegs.has(r));
    const top = alertGroups(all.filter(touches), names).sort((a, b) => (b.rank - a.rank) || ((a.end || 0) - (b.end || 0)));
    const seen = new Set();
    for (const a of all.filter(a => !touches(a))) seen.add([alertWord(a), arr(a.regions).slice().sort().join(','), str(a.until_label)].join('|'));
    return { top, rest: seen.size };
  }

  // The seven home spots in owner order (pinned 1 to 7).
  const pinnedSpots = spots => arr(spots).filter(s => s && num(s.pinned) != null).sort((a, b) => a.pinned - b.pinned);
  const hi = s => { const w = arr(s && s.now && s.now.wave_ft); return num(w[1]) != null ? w[1] : num(w[0]) != null ? w[0] : -1; };
  const ratingOf = s => { const r = num(s && s.now && s.now.rating); return r == null ? -1 : r; };
  // Best right now: top five coast-wide by rating, then size.
  function bestNow(spots, n = 5) {
    return arr(spots).filter(s => s && ratingOf(s) >= 0)
      .sort((a, b) => ratingOf(b) - ratingOf(a) || hi(b) - hi(a) || (num(b.now.hs_ft) || 0) - (num(a.now.hs_ft) || 0))
      .slice(0, n);
  }
  // The spot list for a region choice: a region id, 'all' (the coast) or 'mine' (the seven), filtered and sorted.
  function regionSpots(spots, region, { good = false, sort = 'rating' } = {}) {
    let list = region === 'mine' ? pinnedSpots(spots) : arr(spots).filter(s => s && (region === 'all' || s.region === region));
    if (good) list = list.filter(s => rate(s.now).q >= 4);
    const lat = s => num(s.lat) || 0;
    if (sort === 'height') list = list.slice().sort((a, b) => hi(b) - hi(a) || ratingOf(b) - ratingOf(a));
    else if (sort === 'north') list = list.slice().sort((a, b) => lat(b) - lat(a));
    else list = list.slice().sort((a, b) => ratingOf(b) - ratingOf(a) || hi(b) - hi(a));
    return list;
  }

  // Water temperature by latitude: dots are readings (buoy, pier, shore and tide stations); the line is the blended
  // median per half degree, dashed where no reading sits within the bin (model and satellite only, all of Baja today).
  function latChart(water, spots) {
    const w = obj(water) || {};
    const dots = arr(w.rows).filter(r => r && READING.has(r.kind) && num(r.f) != null && num(r.lat) != null)
      .map(r => ({ lat: r.lat, f: r.f, name: str(r.name) }));
    const bins = arr(w.bins).filter(b => b && num(b.f) != null && num(b.lat) != null).slice().sort((a, b) => a.lat - b.lat);
    const backed = b => dots.some(d => Math.abs(d.lat - b.lat) <= 0.25);
    const segs = [];
    for (let i = 1; i < bins.length; i++) {
      const a = bins[i - 1], b = bins[i];
      if (b.lat - a.lat > 1.5) continue; // a gap in the bins is a gap in the line
      const dashed = !(backed(a) && backed(b));
      const last = segs[segs.length - 1];
      if (last && last.dashed === dashed && last.pts[last.pts.length - 1][0] === a.lat) last.pts.push([b.lat, b.f]);
      else segs.push({ dashed, pts: [[a.lat, a.f], [b.lat, b.f]] });
    }
    const mine = pinnedSpots(spots).map(s => ({ lat: num(s.lat), f: num(s.now && s.now.water_f && s.now.water_f.value), name: str(s.name) }))
      .filter(p => p.lat != null && p.f != null);
    const all = dots.map(d => d.f).concat(bins.map(b => b.f), mine.map(m => m.f));
    if (!all.length) return null;
    const lo = Math.floor((Math.min(...all) - 1) / 5) * 5, top = Math.ceil((Math.max(...all) + 1) / 5) * 5;
    const mid = Math.round((lo + top) / 2);
    const south = dots.length ? Math.min(...dots.map(d => d.lat)) : null;
    return { lat0: LAT0, lat1: LAT1, lo, hi: top, ticks: [lo, mid, top], dots, segs, mine, south };
  }

  // Page state from the DeckPages.get result.
  function pageState(res) {
    if (!res || !res.ok) return { k: 'down', status: res && res.status };
    const d = res.data;
    if (!obj(d) || d.status === 'not_reporting' || !Array.isArray(d.spots)) return { k: 'down', status: res.status };
    if (!d.spots.length) return { k: 'empty' };
    return { k: d.stale ? 'stale' : 'ok' };
  }

  // Buoys: wave buoys that reported, south to north; shore and tide stations stay in the Data sheet.
  const buoyRows = buoys => arr(buoys).filter(b => b && (b.kind == null || b.kind === 'buoy') &&
    (num(b.wave_ft) != null || num(b.water_f) != null || obj(b.wind))).slice().sort((a, b) => (num(a.lat) || 0) - (num(b.lat) || 0));

  const regionNames = feed => Object.fromEntries(arr(feed && feed.regions).filter(obj).map(r => [r.id, str(r.name) || r.id]));
  const tidesIndex = tides => Object.fromEntries(arr(tides).filter(t => t && t.id).map(t => [t.id, t]));
  const mi = km => (num(km) == null ? null : Math.max(1, Math.round(km * 0.621371)));

  // ---------- render ----------
  const U = () => DeckUI;
  const esc = s => U().esc(s == null ? '' : String(s));
  const F = () => U().fmt;
  const na = () => F().na();
  // Dots only on blended numbers. A single-source value gets none (DeckUI.conf drops total < 2), except model-only
  // spots, which always read low (blueprint 6), so their source count is not passed.
  const confOf = c => (obj(c) && num(c.score) != null ? U().conf(c.score, !c.model_only && num(c.sources) != null ? { total: c.sources } : {}) : '');
  // Same markup as DeckUI.tile({model: true}): the value stays in the accessible name, the mark adds words after it.
  const modelMark = (txt, model) => (model ? '<span class="model" title="Model forecast, no buoy nearby">' + esc(txt) + '<span class="vh">, model forecast, no buoy nearby</span></span>' : esc(txt));
  const pips = o => { const r = rate(o); return r.q ? U().pips(r.q, r.word) : '<span class="pips none">No rating</span>'; };
  const MODEL_LINE = 'Forecast only. No buoy nearby.';
  const REGION_MODEL_LINE = 'Forecast only. No buoys in this region.';

  // Card second line: bone mono values, the words around them in text-2 (critique 9), units glued to their numbers.
  const val = t => '<b class="sv">' + esc(t) + '</b>';
  // the confidence mark stays on its value ("74°F" never ends a line with its mark starting the next)
  const withConf = (t, c) => { const m = confOf(c); return m ? '<span class="sf-nw">' + val(t) + m + '</span>' : val(t); };
  function waterBits(wf) {
    const v = num(wf && wf.value);
    if (v == null) return '';
    return withConf(F().temp(v), wf.confidence) + (wf.upwelling ? ' upwelling' : '');
  }
  // "High tide 11:47 am" is one phrase: it moves to the next line whole (surf.css .sf-u)
  function tideBits(s, tides) {
    const mode = tideMode(s, tides);
    if (mode.kind === 'none') return '<span class="sf-u">No tide table</span>';
    const nx = obj(s.now && s.now.tide && s.now.tide.next);
    if (!nx || !str(nx.label)) return '';
    return '<span class="sf-u">' + (nx.type === 'H' ? 'High' : 'Low') + ' tide ' + (mode.kind === 'model' ? 'about ' : '') + val(withZone(nx.label, s.tz, nx.at)) + '</span>';
  }
  function windBits(w) {
    const kt = num(w && w.kt), word = windWord(w).toLowerCase();
    if (kt == null) return word ? esc(cap(word)) : '';
    return val(Math.round(kt) + NB + 'kt') + (word ? ' <span class="sf-w">' + esc(word) + '</span>' : '');
  }
  // Between the parts of a meta line, a plain space that surf.css paints as a dot: where the line breaks the space
  // collapses, so no line ends or starts on a separator.
  const bits = parts => parts.filter(Boolean).join('<span class="sf-sep"> </span>');

  function metaLine(s, tides) {
    const n = obj(s.now) || {}, model = isModel(s);
    const per = periodText(n.period_s, model);
    return bits([per ? (model ? 'about ' + val(per.replace(/^about /, '') + (str(n.dir) ? ' ' + n.dir : '')) : val(per + (str(n.dir) ? ' ' + n.dir : ''))) : '',
      windBits(n.wind), waterBits(n.water_f), tideBits(s, tides)]);
  }

  // PLAN decision 4 (docs/surf-coast.md 1a, 1b): `now.height_basis` is spot or sensor for a break's own height and region
  // for a break with no wave data of its own, which prints the area's blend. Such a break shows its height once, on its
  // region's head; its own row keeps rating, wind and tide, and it stays in Best right now, the TV board and every sort.
  // A feed without the field (before 2026-11-15) draws as before.
  const regionBasis = s => str(s && s.now && s.now.height_basis) === 'region';
  const heightOfRegion = (id, feed) => { const r = arr(feed && feed.regions).find(x => x && x.id === id); return r ? heightText(r.wave_ft) : null; };
  // "Baja Sur · 6-8 ft": the region's head on a card or row, with the hollow mark where the region is forecast only
  function regionHeight(id, feed) {
    const r = arr(feed && feed.regions).find(x => x && x.id === id), h = r ? heightText(r.wave_ft) : null;
    return h == null ? '' : modelMark(h + NB + 'ft', regionModelOnly(id, feed && feed.spots));
  }

  function spotCard(s, tides, names, opts = {}) {
    const n = obj(s.now) || {}, model = isModel(s), h = heightText(n.wave_ft), area = regionBasis(s);
    const extra = reasonExtra(n);
    const body = h == null
      ? '<p class="one">No wave reading here right now.</p>'
      : area ? '<div class="spot-m"><p class="one">' + metaLine(s, tides) + '</p></div>'
        : '<div class="spot-m"><div class="big">' + modelMark(h, model) + '<span class="u">ft</span></div><p class="one">' + metaLine(s, tides) + '</p></div>';
    const rh = area && h != null ? regionHeight(s.region, opts.feed) : '';
    return '<button class="spot" data-open="spot" data-key="' + esc(s.id) + '"><header><b>' + esc(s.name) + '</b>' + pips(n) + '</header>' + body +
      (extra ? '<p class="why">' + esc(cap(extra)) + '</p>' : '') +
      (opts.region || rh ? '<p class="one sf-reg">' + esc(names[s.region] || s.region) + (rh ? ' \u00B7 <b class="sv">' + rh + '</b>' : '') + '</p>' : '') +
      (model ? '<p class="note sf-model">' + MODEL_LINE + '</p>' : '') + '</button>';
  }

  // M4, G4: Your spots fold. Breaks whose cards would say the same thing (height, rating, period and swell direction,
  // wind, water, next tide) share one card that names each break as its own tap; a break with no wave data of its own
  // joins its region's head (decision 4). Groups keep the owner's order of their first break.
  function foldKey(s, tides) {
    const n = obj(s.now) || {}, wf = num(n.water_f && n.water_f.value);
    return [heightText(n.wave_ft), rate(n).q, isModel(s), periodText(n.period_s, isModel(s)), str(n.dir), windText(n.wind),
      wf == null ? '' : Math.round(wf), tideCardText(s, tideMode(s, tides)), reasonExtra(n)].join('|');
  }
  function foldMine(mine, tides) {
    const out = [];
    for (const s of arr(mine).filter(obj)) {
      const kind = regionBasis(s) ? 'region' : 'spot', key = kind === 'region' ? s.region : foldKey(s, tides);
      let g = out.find(x => x.kind === kind && x.key === key);
      if (!g) { g = { kind, key, spots: [] }; out.push(g); }
      g.spots.push(s);
    }
    return out;
  }
  const nameTaps = spots => spots.map(x => '<button class="sf-nm" data-open="spot" data-key="' + esc(x.id) + '">' + esc(x.name) + '</button>').join('<span class="sf-nmc">, </span>');
  // two or more breaks that read the same: one card, each name its own tap (no card-wide button: buttons never nest)
  function groupCard(g, tides) {
    const s = g.spots[0], n = obj(s.now) || {}, model = isModel(s), h = heightText(n.wave_ft);
    const body = h == null ? '<p class="one">No wave reading here right now.</p>'
      : '<div class="spot-m"><div class="big">' + modelMark(h, model) + '<span class="u">ft</span></div><p class="one">' + metaLine(s, tides) + '</p></div>';
    // the reason line is part of the fold key, so every break in the group shares it
    const extra = reasonExtra(n);
    return '<div class="spot sf-grp" style="--sf-spots:' + g.spots.length + '"><header><span class="sf-nms">' + nameTaps(g.spots) + '</span>' + pips(n) + '</header>' + body +
      (extra ? '<p class="why">' + esc(cap(extra)) + '</p>' : '') + '</div>';
  }
  // the region's head with its height once, then a row per break with its rating, wind and next tide
  function regionHead(g, feed, names, tides) {
    const r = arr(feed.regions).find(x => x && x.id === g.key) || {}, h = heightText(r.wave_ft);
    // the head carries what the rows share and do not print: the height once and the water (min to max over the
    // region); each break's own period stays in its sheet, so the head prints none
    const wf = obj(r.water_f), water = wf && num(wf.min) != null && num(wf.max) != null
      ? withConf(Math.round(wf.min) === Math.round(wf.max) ? F().temp(Math.round(wf.min)) : Math.round(wf.min) + '-' + F().temp(Math.round(wf.max)), wf.confidence) + (wf.upwelling ? ' upwelling' : '') : '';
    const rows = g.spots.map(s => '<button class="frow" data-open="spot" data-key="' + esc(s.id) + '"><span class="fl"><b>' + esc(s.name) + '</b><small>' +
      bits([windBits(s.now && s.now.wind), tideBits(s, tides)]) + '</small></span><span class="fr"><small>' + pips(s.now) + '</small></span></button>').join('');
    return '<div class="spot sf-rhd" style="--sf-spots:' + g.spots.length + '"><header><b>' + esc(names[g.key] || g.key) + '</b><span class="sf-rht">Height for the region</span></header>' +
      (h == null ? '<p class="one">No wave reading here right now.</p>' : '<div class="spot-m"><div class="big">' + modelMark(h, regionModelOnly(g.key, feed.spots)) + '<span class="u">ft</span></div>' + (water ? '<p class="one">' + water + '</p>' : '') + '</div>') +
      '<div class="flist sf-rrows">' + rows + '</div></div>';
  }
  function mineCards(mine, feed, names, tides) {
    return foldMine(mine, tides).map(g => (g.kind === 'region' ? regionHead(g, feed, names, tides) : g.spots.length > 1 ? groupCard(g, tides) : spotCard(g.spots[0], tides, names, { feed }))).join('');
  }

  // M3: the home-region alerts as one line ("2 alerts · High surf, Small craft · until Wed 4 am"): the count, each kind
  // once without its "advisory" or "warning" (the mark carries the severity), and when the last one ends. One tap opens
  // the sheet with every alert. The quiet "N more alerts along the coast" line sits in the same block, under it.
  const alertShort = w => cap(str(w).replace(/\s+(advisory|warning|watch|statement|outlook)$/i, ''));
  function alertLine(top) {
    const g = arr(top).filter(obj);
    if (!g.length) return null;
    const words = [...new Set(g.map(x => alertShort(x.word)))];
    const kinds = words.length <= 3 ? words.join(', ') : words.slice(0, 2).join(', ') + ' and ' + (words.length - 2) + ' more';
    const last = g.filter(x => num(x.end) != null).sort((a, b) => b.end - a.end)[0];
    return { n: g.length, kinds, until: last && last.until ? 'until ' + last.until : '', severe: g.some(x => x.severe) };
  }
  function alertsSection(top, rest) {
    const l = alertLine(top), more = coastAlertsLine(rest);
    if (!l && !more) return '';
    const row = l ? '<div class="flist"><button class="frow sf-al" data-open="alerts"><span class="fl"><span class="sf-al1">' +
      bits(['<b>' + U().mark(l.severe ? 'bad' : 'warn') + ' ' + l.n + ' ' + (l.n === 1 ? 'alert' : 'alerts') + '</b>', l.kinds.split(', ').map(k => '<span class="sf-nw">' + esc(k) + '</span>').join(', '), l.until ? '<span class="sf-nw">' + esc(l.until) + '</span>' : '']) +
      '</span></span></button></div>' : '';
    return '<section class="sect sf-alerts"><h2 class="secttl"><span>Alerts</span></h2>' + row + more + '</section>';
  }
  // The rest of the coast: one quiet line in the alerts block, opening the full list.
  const coastAlertsLine = n => (n > 0 ? '<button class="btn btn-quiet sf-coast-al" data-open="alerts">' + n + ' more ' + (n === 1 ? 'alert' : 'alerts') + ' along the coast</button>' : '');

  // TV words for the coast strip (ShellTv #252 hook): an 82 px segment at 1536 holds about seven characters a line, so
  // a name must break only on its spaces and in two lines at most. The full name stays in data-tv-full and the title.
  const TV_SHORT = { 'san-luis-obispo': 'San Luis', 'monterey-santa-cruz': 'Santa Cruz', 'san-francisco-marin': 'SF and Marin', 'sonoma-del-norte': 'North Coast' };
  // The shared strip, plus two TV hooks: the short label on `.cs small` and the unit in its own span, so TV paints the
  // bare number ("11-14") where a segment cannot hold "11-14 ft" on one line; the Coast title names the unit once.
  // V9, W3: each cell draws its height as a bar on one shared scale (zero to the tallest region's upper figure), in the
  // cell's rating shade, so 21-26 ft in Oregon reads four times Orange County's 4-6 (surf.css .sf-hb).
  function coastHtml(feed, selected) {
    const segs = coastSegs(feed, selected);
    const max = coastMax(segs);
    let html = U().coast(segs, { selected });
    for (const s of segs) {
      const short = TV_SHORT[s.id];
      const name = '<small>' + esc(s.name) + '</small>';
      if (short) html = html.replace(name, '<small data-tv-short="' + esc(short) + '" data-tv-full="' + esc(s.name) + '">' + esc(s.name) + '</small>');
      const pct = barPct(s.top, max);
      if (pct != null) html = html.replace(new RegExp('( data-key="' + esc(s.id) + '"[^>]*>)<i></i>'), '$1<i><span class="sf-hb" style="--h:' + pct + '%"></span></i>');
    }
    return html.replace(/<b>([^<]*?)\u00A0ft<\/b>/g, '<b>$1<span class="sf-cu">\u00A0ft</span></b>') + coastNote(segs, max, feed);
  }
  // the upper figure of a region's range: [21, 26] -> 26; null without a reading
  const upper = range => { const a = arr(range).map(num); return a[1] != null ? a[1] : a[0] != null ? a[0] : null; };
  const coastMax = segs => Math.max(0, ...arr(segs).map(s => num(s && s.top) || 0));
  // a bar from zero; a reading never draws thinner than 4% so a 1 ft region still shows a bar
  const barPct = (v, max) => (num(v) == null || !(max > 0) ? null : Math.max(4, Math.min(100, Math.round(v / max * 100))));
  // One quiet line under the strip says what its ink means (V9, V10): one height scale (where the cells print no
  // figures it names the tallest region, surf.css .sf-cn-t), brighter is better, and hatching or the hollow square
  // means forecast only (the TV hides the cards' own "Forecast only" line, so the board needs it here). One line on TV.
  function coastNote(segs, max, feed) {
    const tall = arr(segs).filter(s => s && num(s.top) === max && max > 0)[0];
    const model = arr(segs).some(s => s && s.model && !s.none) || arr(feed && feed.spots).some(isModel);
    return '<p class="note sf-cnote">' + (tall ? '<span class="sf-cn-t">Tallest ' + esc(tall.name) + ' ' + esc(tall.height) + '. </span>' : '') +
      'One height scale; brighter is a better rating.' +
      (model ? ' Striped or an empty square means forecast only.' : '') + '</p>';
  }
  function coastSegs(feed, selected) {
    const spots = arr(feed.spots);
    const by = Object.fromEntries(arr(feed.regions).filter(obj).map(r => [r.id, r]));
    return REGIONS.map(id => {
      const r = by[id] || { id, name: id };
      const h = heightText(r.wave_ft), rt = rate(r);
      return { id, name: str(r.name) || id, q: h == null ? 0 : rt.q, word: h == null ? 'No reading' : rt.word, height: h == null ? null : h + NB + 'ft', top: h == null ? null : upper(r.wave_ft), model: regionModelOnly(id, spots), none: h == null, on: id === selected };
    });
  }

  // D8: the forecaster's line names its NWS period ("This afternoon through Monday") and holds until that period ends
  // (`end`, docs/surf-coast.md item 14; an older feed has only the product's `until`). Once that time has passed the
  // line is not shown: it would print a past day's surf. The product's own expiry (`until_label`) is never printed.
  function fcLive(fc, now) {
    const f = obj(fc);
    if (!f || !heightText(f.ft)) return null;
    const end = num(f.end) ?? num(f.until);
    return end != null && num(now) != null && end <= now ? null : f;
  }
  const DAYS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
  const fcPeriod = f => cap(str(f && f.period).toLowerCase().replace(DAYS, d => cap(d)));

  function regionCard(r, feed, now = Date.now() / 1000) {
    const model = regionModelOnly(r.id, feed.spots), h = heightText(r.wave_ft);
    const c = obj(r.counts) || {};
    const counts = ['great', 'good', 'fair', 'poor', 'flat'].filter(k => num(c[k])).map(k => c[k] + ' ' + k).join(' \u00B7 ');
    const sw = obj(r.swell), wf = obj(r.water_f);
    const meta = [];
    if (sw && num(sw.period_s) != null) {
      const p = periodText(sw.period_s, false) + (str(sw.dir) ? ' ' + sw.dir : '');
      meta.push(model ? 'about ' + val(p) : val(p));
    }
    const w = windBits(r.wind); if (w) meta.push(w);
    if (wf && num(wf.min) != null && num(wf.max) != null) {
      const a = Math.round(wf.min), b = Math.round(wf.max);
      meta.push(withConf(a === b ? F().temp(a) : a + '-' + F().temp(b), wf.confidence) + (wf.upwelling ? ' upwelling' : ''));
    }
    // the time range stays whole ("today 10 am-12 pm"); the line breaks before it
    const best = obj(r.best) && str(r.best.name) ? esc('Best: ' + r.best.name + ', ') + '<span class="sf-nw">' + esc(bestText(r.best, r.tz).replace(/^T/, 't')) + '</span>' : '';
    const fc = fcLive(r.forecaster, now), rip = obj(r.rip);
    const per = fc ? fcPeriod(fc) : '';
    const nws = isBaja(r.id) ? '' : [fc ? 'Forecaster: ' + heightText(fc.ft) + NB + 'ft' + (per ? ', ' + per[0].toLowerCase() + per.slice(1) : '') : '', rip && str(rip.risk) ? 'Rip risk: ' + str(rip.risk).toLowerCase() : ''].filter(Boolean).join(' \u00B7 ');
    const al = num(r.alerts) || 0;
    return '<button class="spot sf-rg" data-region="' + esc(r.id) + '" data-key="' + esc(r.id) + '"><header><b>' + esc(r.name) + '</b>' + pips(r) + '</header>' +
      (al ? '<p class="one sf-ral">' + U().mark('warn') + al + ' ' + (al === 1 ? 'alert' : 'alerts') + '</p>' : '') +
      '<div class="spot-m"><div class="big">' + modelMark(h, model) + '<span class="u">ft</span>' + confOf(r.confidence) + '</div><p class="one">' + bits(meta) + '</p></div>' +
      (counts ? '<p class="one">' + esc(counts) + '</p>' : '') + (best ? '<p class="one">' + best + '</p>' : '') +
      (nws ? '<p class="one">' + esc(nws) + '</p>' : '') +
      (model ? '<p class="note sf-model">' + REGION_MODEL_LINE + '</p>' : '') + '</button>';
  }
  // Regions with no wave reading fold into one row instead of repeating an empty card (critique 18).
  function regionsSection(feed, names, now = Date.now() / 1000) {
    const regs = REGIONS.map(id => arr(feed.regions).find(r => r && r.id === id)).filter(Boolean);
    const live = regs.filter(r => heightText(r.wave_ft) != null), none = regs.filter(r => heightText(r.wave_ft) == null);
    return '<section class="sect sf-regions"><h2 class="secttl"><span>Regions</span><span class="act">South to north</span></h2>' +
      (live.length ? '<div class="cards">' + live.map(r => regionCard(r, feed, now)).join('') + '</div>' : '') +
      (none.length ? '<p class="note sf-none">No reading now: ' + esc(none.map(r => names[r.id] || r.id).join(', ')) + '.</p>' : '') + '</section>';
  }

  const SPOT_COLS = [
    { key: 'spot', label: 'Spot', place: true },
    { key: 'rating', label: 'Rating' },
    { key: 'height', label: 'Height', num: true },
    { key: 'period', label: 'Period', num: true, pri: 2 },
    { key: 'wind', label: 'Wind', pri: 2 },
    { key: 'swell', label: 'Swell', pri: 3 },
    { key: 'water', label: 'Water', num: true, pri: 3 },
    { key: 'best', label: 'Best window', pri: 4 },
    { key: 'tide', label: 'Next tide', pri: 4 }
  ];
  function spotCell(s, col, tides) {
    const n = obj(s.now) || {}, model = isModel(s);
    switch (col.key) {
      case 'spot': return '<span class="place"><b>' + esc(s.name) + '</b>' + (str(s.sub) ? '<small>' + esc(s.sub) + '</small>' : '') + '</span>';
      case 'rating': return pips(n);
      // decision 4: a break with no wave data of its own prints no figure of its own; the note above the list names it
      case 'height': { const h = heightText(n.wave_ft); return h == null ? na() : regionBasis(s) ? REGION_CELL : modelMark(h + NB + 'ft', model); }
      case 'period': { const p = periodText(n.period_s, model); return p ? esc(p) : na(); }
      case 'wind': { const w = windText(n.wind); return w ? esc(w) : na(); }
      case 'swell': return str(n.dir) ? esc(n.dir + (num(n.dir_deg) != null ? NB + Math.round(n.dir_deg) + '\u00B0' : '')) : na();
      case 'water': { const v = num(n.water_f && n.water_f.value); return v == null ? na() : esc(F().temp(v)) + confOf(n.water_f.confidence); }
      case 'best': { const b = bestText(s.best, s.tz); return b ? esc(b) : na(); }
      case 'tide': { const t = tideCardText(s, tideMode(s, tides)); return t ? esc(t) : na(); }
    }
    return na();
  }
  // Phone row: name and the conditions on the left, height and rating on the right; no per-cell labels.
  function spotRow(s) {
    const n = obj(s.now) || {}, model = isModel(s), h = heightText(n.wave_ft), per = periodText(n.period_s, model), w = windText(n.wind);
    const wv = num(n.water_f && n.water_f.value);
    const line = [per ? per + (str(n.dir) ? ' ' + n.dir : '') : '', w, wv == null ? '' : F().temp(wv)].filter(Boolean).join(' \u00B7 ');
    return '<button class="frow" data-open="spot" data-key="' + esc(s.id) + '"><span class="fl"><b>' + esc(s.name) + '</b><small>' + esc(line) + '</small></span>' +
      '<span class="fr"><b>' + (h == null ? na() : regionBasis(s) ? REGION_CELL : modelMark(h + NB + 'ft', model)) + '</b><small>' + pips(n) + '</small></span></button>';
  }
  const REGION_CELL = '<span class="sf-rgn">Region</span>';
  // one line above a list that holds such breaks: what "Region" means, with the figure when the list is one region
  function regionNote(list, region, feed, names) {
    if (!arr(list).some(regionBasis)) return '';
    const one = region !== 'all' && region !== 'mine' ? regionHeight(region, feed) : '';
    return '<p class="note sf-rnote">Region: no wave reading of its own, so the height is the region\u2019s' + (one ? ', ' + esc(names[region] || region) + ' ' + one : ', on its region card') + '.</p>';
  }
  const SORT_LABEL = { rating: 'Rating', height: 'Height', north: 'North to south' };
  const SORT_NEXT = { rating: 'height', height: 'north', north: 'rating' };

  // P and L are phones: a list shows its first PHONE rows (Best right now its first three) and one Show more (surf.css
  // hides the rest by class); the tap marks the section open in the page state, so a repaint keeps it open. D, T and
  // TV never cap.
  const PHONE = 5;
  const phoneMore = (k, n, open, cap = PHONE) => (n <= cap ? '' : open
    ? '<button class="btn btn-quiet sf-more sf-fewer5" data-surf="fewer" data-k="' + k + '">Show fewer</button>'
    : '<button class="btn sf-more sf-more5" data-surf="open" data-k="' + k + '">Show ' + (n - cap) + ' more</button>');
  // P and L hide the "Your spots" title while the filter shows those spots' own region (four whole cards on the first
  // screen); under All coast or a region without a home spot the pinned cards keep their title (surf.css .sf-mine-t)
  const mineTitled = (region, mine) => region === 'all' || (region !== 'mine' && !arr(mine).some(s => s && s.region === region));
  const capCls = (open, cap = PHONE) => ' sf-cap' + cap + (open ? ' open' : '');

  function spotsSection(feed, st, names, tides) {
    const list = regionSpots(feed.spots, st.region, { good: st.good, sort: st.sort });
    const title = st.region === 'all' ? 'Spots on the coast' : st.region === 'mine' ? 'Your spots' : 'Spots in ' + (names[st.region] || st.region);
    const shown = list.slice(0, st.more);
    const open = !!(st.open && st.open.spots);
    const table = shown.length
      ? U().table({ cols: SPOT_COLS, rows: shown, max: shown.length, cell: (row, col) => spotCell(row, col, tides), key: row => row.id, open: 'spot', label: title })
      : U().empty({ k: 'idle', title: st.good ? 'No spots are good or better here right now.' : 'No spots here.', action: st.good ? '<button class="btn" data-surf="good">Show all spots</button>' : '' });
    const plist = shown.length ? '<div class="flist sf-plist">' + shown.map(s => spotRow(s)).join('') + '</div>' : '';
    const more = list.length > shown.length ? '<button class="btn sf-more" data-surf="more">Show ' + Math.min(PAGE, list.length - shown.length) + ' more</button>' : '';
    return '<section class="sect sf-spots' + capCls(open) + '" id="sf-spots"><h2 class="secttl"><span>' + esc(title) + '</span><button class="act btn btn-quiet" data-surf="sort" aria-label="Sort by ' + esc(SORT_LABEL[SORT_NEXT[st.sort]]) + '">Sort: ' + esc(SORT_LABEL[st.sort]) + '</button></h2>' + regionNote(shown, st.region, feed, names) + plist + '<div class="sf-tbl">' + table + '</div>' + phoneMore('spots', shown.length, open) + more + '</section>';
  }

  const BUOY_COLS = [
    { key: 'buoy', label: 'Buoy', place: true },
    { key: 'height', label: 'Height', num: true },
    { key: 'period', label: 'Period', num: true },
    { key: 'dir', label: 'Direction', pri: 2 },
    { key: 'water', label: 'Water', num: true, pri: 2 },
    { key: 'wind', label: 'Wind', pri: 3 },
    { key: 'trend', label: '24 h', pri: 3 },
    { key: 'near', label: 'Nearest spot', pri: 4 }
  ];
  const trendOf = b => { const h = obj(b && b.hours_ft); return h ? arr(h.ft).map(num) : []; };
  function buoyCell(b, col, names) {
    switch (col.key) {
      case 'buoy': return '<span class="place"><b>' + esc(b.name) + '</b></span>';
      case 'height': return num(b.wave_ft) == null ? na() : esc(b.wave_ft.toFixed(1) + NB + 'ft');
      case 'period': return num(b.dpd_s) == null ? na() : esc(Math.round(b.dpd_s) + NB + 's');
      case 'dir': return str(b.mwd) ? esc(b.mwd + (num(b.mwd_deg) != null ? NB + Math.round(b.mwd_deg) + '\u00B0' : '')) : na();
      case 'water': return num(b.water_f) == null ? na() : esc(b.water_f.toFixed(1) + '\u00B0F');
      case 'wind': return obj(b.wind) && num(b.wind.kt) != null ? esc(Math.round(b.wind.kt) + NB + 'kt' + (str(b.wind.dir) ? ' ' + b.wind.dir : '')) : na();
      case 'trend': { const v = trendOf(b); return v.filter(x => x != null).length >= 2 ? U().spark(v, {}) : na(); }
      case 'near': { const n = obj(b.nearest_spot); return n && str(n.name) ? esc(n.name + (mi(n.km) != null ? ' \u00B7 ' + mi(n.km) + ' mi' : '')) : na(); }
    }
    return na();
  }
  // The buoy list follows the region filter, as the spot list does: a region shows its own buoys, Your spots the buoys
  // of the home spots' regions, All coast every buoy. Without a page state (tests, the Data sheet) it is the whole coast.
  function buoysSection(feed, names, st) {
    const region = (st && st.region) || 'all';
    const regs = region === 'all' ? null : region === 'mine' ? new Set(pinnedSpots(feed.spots).map(s => s.region)) : new Set([region]);
    const rows = buoyRows(feed.buoys).filter(b => !regs || regs.has(b.region));
    const open = !!(st && st.open && st.open.buoys);
    const title = region === 'all' ? 'Buoys' : region === 'mine' ? 'Buoys near your spots' : 'Buoys in ' + (names[region] || region);
    const south = region === 'all' || isBaja(region);
    // the 24 h sparkline column exists only once the feed carries buoy history
    const cols = rows.some(b => trendOf(b).filter(x => x != null).length >= 2) ? BUOY_COLS : BUOY_COLS.filter(c => c.key !== 'trend');
    // a Baja region has no public buoys at all: the note says so, with no empty card after it that reads like an outage
    const body = rows.length
      ? U().table({ cols, rows, cell: (row, col) => buoyCell(row, col, names), key: row => row.id, open: 'buoy' })
      : isBaja(region) ? '' : U().empty({ k: 'idle', title: regs ? 'No buoy is reporting here right now.' : 'No buoy is reporting right now.' });
    return '<section class="sect sf-buoys' + capCls(open) + '"><h2 class="secttl"><span>' + esc(title) + '</span></h2>' + (south ? '<p class="note sf-nobuoy">No public buoys south of San Diego.</p>' : '') + body + phoneMore('buoys', rows.length, open) + '</section>';
  }

  // Inline SVG chart on the shared .chart classes: x is latitude, y is °F.
  function tempChart(m) {
    if (!m) return '<p class="note">No water temperature right now.</p>';
    // fewer than three points is not a chart: one line says it (critique 18)
    const npts = m.dots.length + m.segs.reduce((a, s) => a + s.pts.length, 0);
    if (npts < 3) return '<p class="note">Water ' + esc(m.mine.length ? F().temp(m.mine[0].f) + ' at your spots' : 'temperature has too few readings to chart') + '.</p>';
    // 4% inset at each end so the end dots and labels stay inside the panel
    const X = lat => (4 + (lat - m.lat0) / (m.lat1 - m.lat0) * 92).toFixed(2);
    const Y = f => ((1 - (f - m.lo) / (m.hi - m.lo)) * 100).toFixed(2);
    const lines = m.segs.map(s => '<polyline class="ln' + (s.dashed ? ' sf-dash' : '') + '" points="' + s.pts.map(p => X(p[0]) + ',' + Y(p[1])).join(' ') + '"/>').join('');
    const grid = m.ticks.map(t => '<line class="grid" x1="0" x2="100" y1="' + Y(t) + '" y2="' + Y(t) + '"/>').join('');
    const dots = m.dots.map(d => '<i class="pt" style="--x:' + X(d.lat) + '%;--y:' + Y(d.f) + '%"></i>').join('');
    const mine = m.mine.map(d => '<i class="pt sel" style="--x:' + X(d.lat) + '%;--y:' + Y(d.f) + '%"></i>').join('');
    const yt = m.ticks.map(t => '<span class="yt" style="top:' + Y(t) + '%">' + t + '\u00B0F</span>').join('');
    // the two middle names show only where the chart is wide enough to hold four names apart (surf.css, by its own width)
    const mids = [['San Diego', 32.7], ['San Francisco', 37.8]].map(([n, lat]) => '<span class="xt sf-xm" style="left:' + X(lat) + '%">' + n + '</span>').join('');
    const you = m.mine.length ? Math.round(m.mine.reduce((a, d) => a + d.f, 0) / m.mine.length) : null;
    const lbl = you != null ? '<span class="lbl sf-you" style="left:' + X(m.mine[0].lat) + '%;top:' + Y(Math.max(...m.mine.map(d => d.f))) + '%"><b>' + you + '\u00B0F</b>Your spots</span>' : '';
    const label = 'Water temperature from ' + m.lo + ' to ' + m.hi + '\u00B0F along the coast; your spots near ' + (you != null ? you + '\u00B0F' : 'no reading');
    return '<div class="chart sf-lat" role="img" aria-label="' + esc(label) + '"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + grid + lines + '</svg>' +
      dots + mine + yt + '<span class="xt l">Cabo</span>' + mids + '<span class="xt r">Columbia River</span>' + lbl + '</div>' +
      '<div class="legend sf-legend"><span><i class="lg-pt"></i>Reading</span><span><i class="sf-lg-ln"></i>Median</span><span><i class="sf-lg-ln dash"></i>Model and satellite only</span><span><i class="lg-pt sf-lg-you"></i>Your spots</span></div>';
  }

  // ---------- live cams (L11, L12: the 2026-11-04 sweep, restored) ----------
  // The outdoors feed's `break_cams` names each home break's nearest operator cam within 3 km, or none. A stream the
  // operator publishes on YouTube (the San Clemente and Huntington Beach piers) plays here through YouTube's
  // privacy-enhanced player, the one frame host the deck's policy allows. HDOnTap forbids framing, so its cams are rows:
  // a tap shows the operator's snapshot picture inline (nothing loads from their host before the tap; no referrer) with
  // the live view one link away. A break with no free cam links its Surfline report. Inside the iPhone app (user agent
  // OmarchyDeck/) the shell blocks other hosts, so every cam is a link row there. A URL reaches an attribute only when it
  // matches its exact pattern.
  const CAM_PLAYER_RE = /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}\?autoplay=1&mute=1&playsinline=1&rel=0$/;
  const CAM_PAGE_RE = /^https:\/\/(?:hdontap\.com\/stream\/\d{1,12}\/[A-Za-z0-9_-]{1,120}\/?|www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11})$/;
  const CAM_SNAP_RE = /^https:\/\/storage\.hdontap\.com\/wowza_stream_thumbnails\/[A-Za-z0-9_.-]{1,160}\.(?:jpg|jpeg|png|webp)$/;
  const SURFLINE_RE = /^https:\/\/www\.surfline\.com\/surf-report\/[a-z0-9-]{1,60}\/[a-f0-9]{24}$/;
  const camOk = (re, u) => (typeof u === 'string' && re.test(u) ? u : '');
  const joinNames = xs => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  // {cams: [{id, name, op, view, player, snap, breaks}], none: [{name, url}]}, the cams that play here first; null when
  // the feed is missing or names no break
  function camModel(oc) {
    const o = obj(oc);
    if (!o || str(o.error) || !Array.isArray(o.break_cams)) return null;
    const by = new Map(), none = [];
    for (const b of o.break_cams.filter(obj)) {
      const name = str(b.spot) || 'Break', c = obj(b.cam), id = c ? str(c.id) : '', view = c ? camOk(CAM_PAGE_RE, c.view_url) : '';
      if (c && id && view) {
        if (!by.has(id)) by.set(id, { id, name: str(c.name) || 'Live cam', op: str(c.operator) || 'the operator', view, player: camOk(CAM_PLAYER_RE, c.player_url), snap: camOk(CAM_SNAP_RE, c.snapshot_thumbnail_url), breaks: [] });
        by.get(id).breaks.push(name);
      } else none.push({ name, url: camOk(SURFLINE_RE, b.surfline_url) });
    }
    const cams = [...by.values()].sort((a, b) => !!b.player - !!a.player);
    return cams.length || none.length ? { cams, none } : null;
  }
  // the picture box of an open snapshot row: a fixed 16:9 box, so the picture landing moves nothing
  const snapBox = c => '<div class="sf-snapm"><img src="' + esc(c.snap) + '" alt="' + esc('Snapshot: ' + c.name + ', near ' + joinNames(c.breaks)) + '" referrerpolicy="no-referrer" decoding="async"></div>';
  // inline false (the iPhone app): every cam is a link row. A playing tile is never rebuilt (moving a frame reloads it):
  // a timer repaint waits until the player stops (paint below). `open` holds the snapshot rows tapped open.
  function camsSection(oc, inline, open) {
    const m = camModel(oc);
    if (!m) return '';
    const play = inline ? m.cams.filter(c => c.player) : [];
    const snaps = inline ? m.cams.filter(c => !c.player && c.snap) : [];
    const links = m.cams.filter(c => !play.includes(c) && !snaps.includes(c));
    const tile = c => {
      const where = joinNames(c.breaks);
      return '<div class="sf-cam" data-cam="' + esc(c.id) + '"><div class="sf-camm"><button class="sf-camv" data-surf="cam" data-play="' + esc(c.player) + '" aria-label="' + esc('Play live cam: ' + where) + '">' +
        '<span class="sf-campb" aria-hidden="true"></span><span class="sf-camn">' + esc(where) + '</span><span class="sf-camh">Tap to play</span></button></div>' +
        '<div class="sf-camc"><small>' + esc(c.name + ' \u00B7 ' + c.op) + '</small><button class="btn btn-quiet sf-camx" data-surf="camstop">Stop</button></div></div>';
    };
    const shown = id => !!(open && (open.has ? open.has(id) : open[id]));
    const snapRow = c => '<div class="sf-snap' + (shown(c.id) ? ' on' : '') + '" data-cam="' + esc(c.id) + '"><div class="frow sf-snr"><button class="sf-snb" data-surf="snap" aria-expanded="' + shown(c.id) + '"><span class="fl"><b>' + esc(joinNames(c.breaks)) + '</b><small>' +
      esc(c.name + ' \u00B7 ' + (shown(c.id) ? 'snapshot' : 'tap for a picture')) + '</small></span></button><a class="ext sf-live" href="' + esc(c.view) + '" target="_blank" rel="noopener noreferrer">Live view</a></div>' +
      (shown(c.id) ? snapBox(c) : '') + '</div>';
    const yt = c => /^https:\/\/www\.youtube\.com\//.test(c.view);
    const row = c => '<a class="frow" href="' + esc(c.view) + '" target="_blank" rel="noopener noreferrer"><span class="fl"><b>' + esc(joinNames(c.breaks)) + '</b><small>' +
      esc(c.name + ' \u00B7 ' + (yt(c) ? 'opens on YouTube' : 'opens at ' + c.op)) + '</small></span></a>';
    const none = m.none.length ? '<p class="note sf-camnone">No free cam at ' + esc(joinNames(m.none.map(n => n.name))) + '.' +
      m.none.filter(n => n.url).map(n => ' <a class="ext" href="' + esc(n.url) + '" target="_blank" rel="noopener noreferrer">' + esc(n.name + ' on Surfline') + '</a>').join('') + '</p>' : '';
    return '<section class="sect sf-cams"><h2 class="secttl"><span>Live cams</span></h2>' + (play.length ? '<div class="sf-camg">' + play.map(tile).join('') + '</div>' : '') +
      (snaps.length || links.length ? '<div class="flist">' + snaps.map(snapRow).join('') + links.map(row).join('') + '</div>' : '') + none + '</section>';
  }

  // Section order in the DOM follows the blueprint for a phone; CSS orders sections per class (M3: alerts, Your spots,
  // Best right now and the coast on P and L; alerts, the coast, then Your spots beside Best right now from laptop up).
  // The .board wrapper holds what the TV board shows (the seven home spots, the coast strip, the top three); outside
  // TV it is display:contents.
  function page(feed, st, now = Date.now() / 1000) {
    const names = regionNames(feed), tides = tidesIndex(feed.tides);
    const mine = pinnedSpots(feed.spots), best = bestNow(feed.spots);
    const coast = coastHtml(feed, st.region);
    const al = alertSplit(feed, names);
    const open = !!(st.open && st.open.best);
    const bestCards = list => '<div class="cards">' + list.map(s => spotCard(s, tides, names, { region: true, feed })).join('') + '</div>';
    return '<div class="sf">' + alertsSection(al.top, al.rest) + '<div class="board sf-board">' +
      (mine.length ? '<section class="sect sf-mine' + (mineTitled(st.region, mine) ? ' sf-mine-t' : '') + '"><h2 class="secttl"><span>Your spots</span></h2><div class="cards">' + mineCards(mine, feed, names, tides) + '</div></section>' : '') +
      '<section class="sect sf-coast"><h2 class="secttl"><span>Coast<span class="sf-tvu"> \u00B7 feet</span></span></h2>' + coast + '</section>' +
      // TV only: the top three on the board itself (display:none elsewhere); every other class shows the five below,
      // P and L the first three and Show 2 more
      (best.length ? '<section class="sect sf-best3"><h2 class="secttl"><span>Best right now</span></h2>' + bestCards(best.slice(0, 3)) + '</section>' : '') + '</div>' +
      (best.length ? '<section class="sect sf-best' + capCls(open, 3) + '"><h2 class="secttl"><span>Best right now</span></h2>' + bestCards(best) + phoneMore('best', best.length, open, 3) + '</section>' : '') +
      camsSection(st.oc, !st.shell, st.snaps) +
      regionsSection(feed, names, now) + spotsSection(feed, st, names, tides) + buoysSection(feed, names, st) +
      '<section class="sect sf-temp"><h2 class="secttl"><span>Water temperature by latitude</span></h2><div class="panel">' + tempChart(latChart(feed.water, feed.spots)) + '</div></section></div>';
  }

  // One group marked .keep, so a phone shows the region button and the toggle on one row (the shell hides other scope).
  function headControls(st, names) {
    const label = st.region === 'all' ? 'All coast' : st.region === 'mine' ? 'Your spots' : names[st.region] || st.region;
    return '<div class="keep sf-ctl"><button class="btn" data-surf="region" aria-haspopup="dialog"><svg class="i"><use href="#i-filter"/></svg>' + esc(label) + '</button>' +
      '<button class="fchip' + (st.good ? ' on' : '') + '" data-surf="good" aria-pressed="' + (st.good ? 'true' : 'false') + '">Good or better</button></div>';
  }

  // ---------- sheets ----------
  const sec = (title, body) => (body ? '<section class="sh-sec"><h3>' + esc(title) + '</h3>' + body + '</section>' : '');
  const kv = rows => { const r = rows.filter(x => x && x[1]); return r.length ? '<dl class="kv">' + r.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>').join('') + '</dl>' : ''; };

  // Outlook: one column per day the feed carries (critique 19), morning and afternoon bars shaded by rating, the wind
  // quality under each bar, the day's own confidence dots under its label. F6: tomorrow's morning and afternoon in
  // figures above the bars ("Tomorrow: morning 3-5 ft Good · afternoon 3-4 ft Fair"); V22: the note says what the
  // bars and their shades mean.
  function outlook(days, model, tz, now = Date.now() / 1000) {
    const ds = arr(days).filter(obj).slice(0, 7);
    if (!ds.length) return '';
    const peak = Math.max(1, ...ds.flatMap(d => [d.am, d.pm].map(p => num(obj(p) && arr(p.wave_ft)[1]) || 0)));
    const bar = (p, half) => {
      if (!obj(p) || heightText(p.wave_ft) == null) return '<div class="sf-ob none" data-q="0" role="img" aria-label="' + half + ': no forecast"><i style="--h:0%"></i><span></span></div>';
      const r = rate(p), h = num(arr(p.wave_ft)[1]) || num(arr(p.wave_ft)[0]) || 0;
      const aria = half + ' ' + heightText(p.wave_ft) + ' ft, ' + r.word + (str(p.wind) ? ', ' + p.wind + ' wind' : '');
      return '<div class="sf-ob" data-q="' + r.q + '" role="img" aria-label="' + esc(aria) + '"><i style="--h:' + Math.round(h / peak * 100) + '%"></i><span>' + esc(windShort(p.wind)) + '</span></div>';
    };
    // the day's range across morning and afternoon sits above its pair; a narrow sheet shows the morning wind under it
    const range = d => { const v = [d.am, d.pm].filter(obj).flatMap(p => arr(p.wave_ft).map(num)).filter(x => x != null); return v.length ? heightText([Math.min(...v), Math.max(...v)]) : ''; };
    const t = tomorrowOf(ds, tz, now);
    const half = (p, word) => (obj(p) && heightText(p.wave_ft) ? word + ' ' + val(heightText(p.wave_ft) + NB + 'ft') + ' ' + esc(rate(p).word) : '');
    const tline = t ? bits([half(t.am, 'morning'), half(t.pm, 'afternoon')]) : '';
    return (tline ? '<p class="sf-tmr">Tomorrow: ' + tline + '</p>' : '') +
      '<div class="sf-obars' + (model ? ' model' : '') + '" style="--days:' + ds.length + '">' + ds.map(d => '<div class="sf-day"><b class="sf-dh">' + esc(range(d)) + '</b><div class="sf-pair">' + bar(d.am, 'Morning') + bar(d.pm, 'Afternoon') + '</div>' +
      '<span class="sf-dw">' + esc(windShort(obj(d.am) && d.am.wind)) + '</span><span class="sf-dl">' + esc(str(d.label) || '') + '</span>' + confOf(d.confidence) + '</div>').join('') + '</div>' +
      '<p class="note sf-obk">Feet. Left bar morning, right bar afternoon, on one scale; brighter is a better rating. Under the bars: wind off, on or cross-shore.</p>';
  }
  // Tomorrow in the spot's own zone: the first day dated after today there; a feed without dates takes the day after "Today".
  function tomorrowOf(days, tz, now = Date.now() / 1000) {
    const ds = arr(days).filter(obj);
    let today = '';
    try { today = new Intl.DateTimeFormat('en-CA', { timeZone: str(tz) || 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now * 1000)); } catch (e) { today = ''; }
    if (today && ds.some(d => /^\d{4}-\d{2}-\d{2}$/.test(str(d.date)))) return ds.find(d => str(d.date) > today) || null;
    const i = ds.findIndex(d => str(d.label).toLowerCase() === 'today');
    return i >= 0 ? ds[i + 1] || null : null;
  }
  const outlookTitle = days => { const n = Math.min(7, arr(days).filter(obj).length); return n ? n + '-day outlook' : 'Outlook'; };
  const windShort = w => ({ offshore: 'Off', onshore: 'On', 'cross-shore': 'Cross' })[str(w).toLowerCase()] || '';

  // Tide labels inside the plot: highs above the curve, lows below, clamped at the edges, never closer than `gap`
  // percent to the previous label on the same side or to the Now line (critique 19: 64 px at a phone sheet width).
  function tideLabels(events, start, end, nowx, gap = 14) {
    const out = [], last = { H: -1e9, L: -1e9 };
    for (const e of arr(events).filter(e => e && num(e.at) != null && num(e.ft) != null && e.at > start && e.at < end).sort((a, b) => a.at - b.at)) {
      const side = e.type === 'L' ? 'L' : 'H';
      const x = (e.at - start) / (end - start) * 100;
      if (x - last[side] < gap) continue;
      if (nowx != null && Math.abs(x - nowx) < gap / 2) continue;
      last[side] = x;
      out.push({ x, side, edge: x < 8 ? 'l' : x > 92 ? 'r' : '', e });
    }
    return out;
  }

  // 48 h tide curve from the region file. A model sea level draws dashed with the low mark; no station draws nothing.
  function tideCurve(spot, rf, overviewTides, now = Date.now() / 1000) {
    const mode = tideMode(spot, tidesIndex(overviewTides));
    if (mode.kind === 'none') return '<p class="note">' + mode.line + '</p>';
    const t = rf && arr(rf.tides).find(x => x && x.id === spot.tide_station);
    const curve = t && obj(t.curve);
    const ft = curve ? arr(curve.ft) : [];
    const pts = ft.map((v, i) => [i, num(v)]).filter(p => p[1] != null);
    const line = mode.kind === 'model' ? '<p class="note">' + modelMark(mode.line, true) + '</p>' : '';
    if (pts.length < 2) return line || '<p class="note">No tide curve right now.</p>';
    const n = ft.length - 1, lo = Math.min(...pts.map(p => p[1])) - 0.5, top = Math.max(...pts.map(p => p[1])) + 0.5;
    const X = i => (i / n * 100).toFixed(2), Y = v => ((1 - (v - lo) / (top - lo)) * 100).toFixed(2);
    const P = pts.map(p => X(p[0]) + ',' + Y(p[1])).join(' ');
    const start = num(curve.start), step = num(curve.step) || 3600, end = start != null ? start + n * step : null;
    const nowx = start != null && now >= start && now <= end ? (now - start) / (end - start) * 100 : null;
    const lbls = start == null ? '' : tideLabels(t.next, start, end, nowx).map(l => '<span class="lbl' + (l.side === 'L' ? ' lo' : '') + (l.edge ? ' sf-e' + l.edge : '') + '" style="left:' + l.x.toFixed(1) + '%;top:' + Y(l.e.ft) + '%"><b>' + esc(l.e.ft.toFixed(1) + NB + 'ft') + '</b>' + esc(clockIn(spot.tz, l.e.at)) + '</span>').join('');
    const z = zoneMark(spot.tz, start);
    return '<div class="chart sf-tide' + (mode.kind === 'model' ? ' model' : '') + '" role="img" aria-label="' + esc('Tide for the next 48 hours' + (mode.kind === 'model' ? ', approximate' : '')) + '"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon class="ar" points="0,100 ' + P + ' 100,100"/><polyline class="ln' + (mode.kind === 'model' ? ' sf-dash' : '') + '" points="' + P + '"/>' +
      (nowx != null ? '<line class="now" x1="' + nowx.toFixed(1) + '" x2="' + nowx.toFixed(1) + '" y1="0" y2="100"/>' : '') + '</svg>' + lbls +
      (nowx != null ? '<span class="nowl" style="left:' + nowx.toFixed(1) + '%">Now</span>' : '') +
      (start != null ? '<span class="xt l">' + esc(dayIn(spot.tz, start) + (z ? ' ' + z : '')) + '</span><span class="xt r">' + esc(dayIn(spot.tz, end)) + '</span>' : '') + '</div>' + line;
  }

  function waterRange(s, rs) {
    const wf = obj(s.now && s.now.water_f);
    const parts = arr(rs && rs.parts && rs.parts.water).map(p => num(p && p.f)).filter(v => v != null);
    if (parts.length >= 2) {
      const a = Math.round(Math.min(...parts)), b = Math.round(Math.max(...parts));
      return (a === b ? F().temp(a) : a + '-' + F().temp(b)) + ', ' + parts.length + ' readings';
    }
    return wf && num(wf.n) ? wf.n + (wf.n === 1 ? ' reading' : ' readings') : '';
  }

  function spotSheet(s, feed, rf, now = Date.now() / 1000) {
    const names = regionNames(feed), n = obj(s.now) || {}, model = isModel(s);
    const rs = rf && arr(rf.spots).find(x => x && x.id === s.id);
    const h = heightText(n.wave_ft), per = num(n.period_s), wf = obj(n.water_f), kt = num(n.wind && n.wind.kt), wv = num(wf && wf.value);
    const missing = [h == null && 'height', per == null && 'period', kt == null && 'wind', wv == null && 'water temperature'].filter(Boolean);
    const nowSec = '<div class="sh-head"><div class="chips">' + pips(n) + '</div>' + (str(n.reason) ? '<p class="why note">' + esc(cap(str(n.reason))) + '</p>' : '') +
      U().strip([
        // a reading from a pier gauge or nearshore buoy at the break (height_basis sensor) says so; a break with no wave
        // data of its own shows its region's height under that name (decision 4)
        h == null ? '' : regionBasis(s)
          ? U().tile({ label: 'Height for the region', value: heightOfRegion(s.region, feed) || h, unit: 'ft', model: regionModelOnly(s.region, feed.spots) })
          : U().tile({ label: n.height_basis === 'sensor' ? 'Height, measured' : 'Height', value: h, unit: 'ft', model, conf: confOf(n.confidence) }),
        per == null ? '' : U().tile({ label: model ? 'Period, about' : 'Period', value: String(Math.round(per)), unit: 's' }),
        kt == null ? '' : U().tile({ label: 'Wind', value: String(Math.round(kt)), unit: 'kt' }),
        wv == null ? '' : U().tile({ label: 'Water', value: String(Math.round(wv)), unit: '\u00B0F', conf: wf ? confOf(wf.confidence) : '' })
      ], { label: 'Now at ' + str(s.name) }) +
      (missing.length ? U().missing(missing) : '') +
      kv([['Wind', esc([windWord(n.wind), str(n.wind && n.wind.dir), num(n.wind && n.wind.gust_kt) != null ? 'gusts ' + Math.round(n.wind.gust_kt) + NB + 'kt' : ''].filter(Boolean).join(' \u00B7 '))],
        ['Water', esc([waterRange(s, rs), wf && wf.upwelling ? 'Upwelling' : ''].filter(Boolean).join(' \u00B7 '))],
        ['Best window', esc(bestText(s.best, s.tz))]]) +
      (model ? '<p class="note sf-model">' + MODEL_LINE + '</p>' : '') + '</div>';
    const swell = arr(n.swell).filter(obj).map(p => [{ primary: 'Primary swell', secondary: 'Secondary swell', wind: 'Wind chop' }[p.part] || cap(str(p.part)),
      esc([num(p.ft) != null ? p.ft.toFixed(1) + NB + 'ft' : '', periodText(p.period_s, model) || '', str(p.dir)].filter(Boolean).join(' \u00B7 '))]);
    const fc = fcLive(s.forecaster, now), rip = obj(s.rip);
    const nws = isBaja(s.region) ? '' : kv([['Forecaster', fc ? esc(heightText(fc.ft) + NB + 'ft' + (fcPeriod(fc) ? ' \u00B7 ' + fcPeriod(fc) : '')) : ''],
      ['Rip risk', rip && str(rip.risk) ? esc(cap(str(rip.risk).toLowerCase())) : '']]);
    const b = obj(s.buoy), br = b && arr(feed.buoys).find(x => x && x.id === b.id);
    const buoy = model || !b ? '' : kv([[str(b.name) + (mi(b.km) != null ? ', ' + mi(b.km) + ' mi' : ''),
      esc(br ? [num(br.wave_ft) != null ? br.wave_ft.toFixed(1) + NB + 'ft' : '', num(br.dpd_s) != null ? Math.round(br.dpd_s) + NB + 's' : '', str(br.mwd), num(br.water_f) != null ? br.water_f.toFixed(1) + '\u00B0F' : '', num(br.age_min) != null ? F().age(br.age_min * 60) + ' ago' : ''].filter(Boolean).join(' \u00B7 ') : 'No reading right now')]]);
    const sun = obj(rs && rs.sun);
    const sunRows = sun ? kv([['First light', esc(withZone(sun.first_light && sun.first_light.label, s.tz, sun.first_light && sun.first_light.at))],
      ['Sunrise', esc(withZone(sun.sunrise && sun.sunrise.label, s.tz, sun.sunrise && sun.sunrise.at))],
      ['Sunset', esc(withZone(sun.sunset && sun.sunset.label, s.tz, sun.sunset && sun.sunset.at))]]) : (rf ? '' : '<p class="note">Loading.</p>');
    const al = alertGroups(arr(feed.alerts).filter(a => arr(a && a.regions).includes(s.region)), names);
    const alerts = al.length ? '<div class="flist">' + al.map(g => '<div class="frow"><span class="fl"><b>' + U().mark(g.severe ? 'bad' : 'warn') + ' ' + esc(g.word) + '</b><small>' + esc(g.until ? 'Until ' + g.until : '') + '</small></span></div>').join('') + '</div>' : '';
    // The swell parts are the nearest buoy's and the model's, out at sea: a sheltered break can read 2 ft under a 4.6 ft
    // primary swell, so the section says where they are measured (VerifySurf 6b)
    const swellSec = swell.length ? kv(swell) + '<p class="note sf-swn">At sea, before the coast shapes it at this break.</p>' : '';
    const body = sec('Now', nowSec) + sec('Offshore swell', swellSec) + sec(outlookTitle(s.days), outlook(s.days, model, s.tz, now)) +
      sec('Tide', rf ? tideCurve(s, rf, feed.tides, now) : (tideMode(s, tidesIndex(feed.tides)).kind === 'none' ? '<p class="note">No tide table for this spot.</p>' : '<p class="note">Loading.</p>')) +
      sec('Forecaster and rip risk', nws) + sec('Nearest buoy', buoy) + sec('Sun', sunRows) + sec('Alerts', alerts);
    const sub = [names[s.region], str(s.sub), str(s.facing) ? 'faces ' + s.facing : ''].filter(Boolean).join(' \u00B7 ');
    return { id: 'spot', title: str(s.name), sub, body, actions: '<button class="btn" data-sheet="data" data-scope="spot:' + esc(s.id) + '">Data</button>' };
  }

  function buoySheet(b, feed) {
    const names = regionNames(feed), sw = obj(b.swell), ww = obj(b.wind_wave), w = obj(b.wind), nr = obj(b.nearest_spot);
    const part = p => (p ? esc([num(p.ft) != null ? p.ft.toFixed(1) + ' ft' : '', num(p.period_s) != null ? Math.round(p.period_s) + ' s' : '', str(p.dir)].filter(Boolean).join(' \u00B7 ')) : '');
    const body = kv([
      ['Wave height', num(b.wave_ft) != null ? esc(b.wave_ft.toFixed(1) + ' ft') : ''],
      ['Peak period', num(b.dpd_s) != null ? esc(Math.round(b.dpd_s) + ' s') : ''],
      ['Average period', num(b.apd_s) != null ? esc(b.apd_s.toFixed(1) + ' s') : ''],
      ['Direction', str(b.mwd) ? esc(b.mwd + (num(b.mwd_deg) != null ? ' ' + Math.round(b.mwd_deg) + '\u00B0' : '')) : ''],
      ['Swell', part(sw)], ['Wind waves', part(ww)],
      ['Water', num(b.water_f) != null ? esc(b.water_f.toFixed(1) + '\u00B0F') : ''],
      ['Wind', w && num(w.kt) != null ? esc(Math.round(w.kt) + ' kt' + (str(w.dir) ? ' ' + w.dir : '') + (num(w.gust_kt) != null ? ', gusts ' + Math.round(w.gust_kt) + ' kt' : '')) : ''],
      ['Nearest spot', nr && str(nr.name) ? esc(nr.name + (mi(nr.km) != null ? ', ' + mi(nr.km) + ' mi' : '')) : ''],
      ['Last reading', num(b.age_min) != null ? esc(F().age(b.age_min * 60) + ' ago') : '']
    ]);
    const missing = [['wave height', b.wave_ft], ['period', b.dpd_s], ['wind', b.wind]].filter(x => x[1] == null).map(x => x[0]);
    return { id: 'buoy', title: str(b.name), sub: names[b.region] || '', body: body + (missing.length ? U().missing(missing) : ''), actions: '<button class="btn" data-sheet="data">Data</button>' };
  }

  // Every alert, the tapped group first; each statement keeps its full text here, never on the page.
  function alertsSheet(groups, first) {
    const gs = groups.slice().sort((a, b) => (b.word === first) - (a.word === first));
    const body = gs.map(g => sec(g.word, '<div class="flist">' + g.items.map(a => '<div class="frow"><span class="fl"><b>' + esc(placeText(arr(a.regions), g.names) || '') + (str(a.until_label) ? ' \u00B7 until ' + esc(a.until_label) : '') + '</b><small>' + esc(str(a.text)) + '</small></span></div>').join('') + '</div>')).join('');
    return { id: 'alerts', title: 'Alerts', sub: '', body, actions: '<button class="btn" data-sheet="data">Data</button>' };
  }

  function regionPicker(st, names) {
    const opt = (id, label) => '<button class="frow' + (st.region === id ? ' on' : '') + '" data-surf-pick="' + esc(id) + '" aria-pressed="' + (st.region === id ? 'true' : 'false') + '"><span class="fl"><b>' + esc(label) + '</b></span></button>';
    const sorts = '<div class="seg" role="group" aria-label="Sort">' + Object.keys(SORT_LABEL).map(k => '<button data-surf-sort="' + k + '" class="' + (st.sort === k ? 'on' : '') + '" aria-pressed="' + (st.sort === k ? 'true' : 'false') + '">' + SORT_LABEL[k] + '</button>').join('') + '</div>';
    return { id: 'surf-region', title: 'Region', sub: '', body: '<div class="flist">' + opt('all', 'All coast') + opt('mine', 'Your spots') + REGIONS.map(id => opt(id, names[id] || id)).join('') + '</div>' + sec('Sort', sorts) };
  }

  // ---------- Data sheet (registry data hook) ----------
  const STATE = { ok: 'ok', stale: 'stale', unavailable: 'never' };
  function dataModel(feed, scope, rf) {
    const f = obj(feed) || {};
    const iso = t => (num(t) != null ? new Date(t * 1000).toISOString().slice(0, 10) : '');
    const sources = arr(f.sources).filter(obj).map(s => ({ name: str(s.name), gives: [str(s.publisher), num(s.count) != null ? s.count + ' rows' : '', str(s.note)].filter(Boolean).join(' \u00B7 '), asOf: iso(s.as_of), state: STATE[s.status] || 'never' }));
    const cov = obj(f.coverage) || {};
    const method = [
      ['Spots', [cov.spots, cov.spots_buoy_50km != null ? cov.spots_buoy_50km + ' with a buoy within 50 km' : '', cov.spots_model_only != null ? cov.spots_model_only + ' forecast only' : ''].filter(x => x != null && x !== '').join(' \u00B7 ')],
      ['Stations reporting', [cov.stations_reporting, cov.buoys_waves != null ? cov.buoys_waves + ' with waves' : ''].filter(x => x != null && x !== '').join(' \u00B7 ')],
      ['Water readings', cov.water_rows != null ? String(cov.water_rows) : ''],
      ['Tide stations', cov.tide_stations != null ? String(cov.tide_stations) : ''],
      ['Rating', 'Size 0-4, period 0-2, wind 0-3, tide 0-1. Flat under 1 ft, Poor 3 or less, Fair 4-5, Good 6-7, Great 8 or more'],
      ['Confidence', 'Model only is low. With a buoy, buoy weight and agreement of the parts'],
      ['Period', 'Peak period from buoys; model-only spots show the model period as about']
    ].filter(r => r[1] !== '' && r[1] != null).map(r => [r[0], String(r[1])]);
    for (const g of arr(f.gaps)) method.push(['Gap', str(g)]);
    for (const e of arr(f.errors).filter(obj)) method.push(['Not reporting', str(e.reason)]);
    const blends = [];
    const m = /^spot:(.+)$/.exec(str(scope));
    const s = m && arr(f.spots).find(x => x && x.id === m[1]);
    if (s) {
      const rs = rf && arr(rf.spots).find(x => x && x.id === s.id);
      const parts = obj(rs && rs.parts) || {};
      const pct = (w, all) => (num(w) != null && all > 0 ? Math.round(w / all * 100) + '%' : '');
      const hsW = arr(parts.hs).reduce((a, p) => a + (num(p && p.weight) || 0), 0);
      const label = p => [cap(str(p.kind)), str(p.id), num(p.km) != null ? p.km.toFixed(1) + ' km' : ''].filter(Boolean).join(' ');
      // the height the sheet explains: a break's own (height_basis spot) is the nearshore model point scaled to the area's
      // blend, a sensor's reading prints as it is; the blend parts then explain the area level beside it (VerifySurf 6a)
      const sc = obj(parts.scale), basis = str(s.now && s.now.height_basis);
      const own = sc && (basis === 'spot' || basis === 'sensor');
      if (num(s.now && s.now.hs_ft) != null && own) {
        const sn = obj(sc.sensor);
        blends.push(basis === 'sensor' && sn
          ? { label: 'Wave height, ' + s.name, value: s.now.hs_ft.toFixed(1) + ' ft', parts: [{ name: [cap(str(sn.kind)), str(sn.id), num(sn.km) != null ? sn.km.toFixed(1) + ' km' : ''].filter(Boolean).join(' '), value: num(sn.ft) != null ? sn.ft.toFixed(1) + ' ft' : '', weight: '' }],
            note: 'Measured at the break' + (num(sc.scaled_ft) != null ? '; the nearshore model scaled to ' + sc.scaled_ft.toFixed(1) + ' ft disagreed with it' : '') }
          : { label: 'Wave height, ' + s.name, value: s.now.hs_ft.toFixed(1) + ' ft', parts: [
            { name: ['Nearshore model', str(sc.mop_id)].filter(Boolean).join(' '), value: num(sc.mop_ft) != null ? sc.mop_ft.toFixed(1) + ' ft' : '', weight: '' },
            { name: 'Area level', value: num(sc.blend_ft) != null ? sc.blend_ft.toFixed(1) + ' ft' : '', weight: '' }],
            note: num(sc.factor) != null ? 'The nearshore model at this break times ' + sc.factor + ', the area level over the nearshore model' + (num(sc.spots) != null ? ' across ' + sc.spots + ' breaks' : '') : '' });
      }
      if (num(s.now && s.now.hs_ft) != null) blends.push({ label: own ? 'Area level, ' + (str(s.region) || s.name) : 'Wave height, ' + s.name, value: (own && num(sc.blend_ft) != null ? sc.blend_ft : s.now.hs_ft).toFixed(1) + ' ft', score: num(s.now.confidence && s.now.confidence.score) ?? undefined,
        parts: arr(parts.hs).filter(obj).map(p => ({ name: label(p), value: num(p.ft) != null ? p.ft.toFixed(1) + ' ft' : '', weight: pct(p.weight, hsW) })),
        note: arr(parts.hs).some(p => p && num(p.bias) != null) ? 'Global model corrected by ' + arr(parts.hs).find(p => p && num(p.bias) != null).bias + ' against nearby buoys' : '' });
      const wv = num(s.now && s.now.water_f && s.now.water_f.value);
      if (wv != null) blends.push({ label: 'Water, ' + s.name, value: wv.toFixed(1) + '\u00B0F', score: num(s.now.water_f.confidence && s.now.water_f.confidence.score) ?? undefined,
        parts: arr(parts.water).filter(obj).map(p => ({ name: label(p), value: num(p.f) != null ? p.f.toFixed(1) + '\u00B0F' : '', weight: '' })), note: '' });
      method.unshift(['Tide table', /^model:/.test(str(s.tide_station)) ? 'Model sea level' : str(s.tide_station) || 'None']);
      if (obj(s.buoy)) method.unshift(['Nearest buoy', str(s.buoy.id) + ' ' + str(s.buoy.name)]);
      const bias = obj(f.method && f.method.bias && f.method.bias[s.region]);
      if (bias && num(bias.factor) != null) method.unshift(['Model correction', bias.factor + ' from ' + bias.pairs + ' buoy pairs (' + (bias.basis === 'coast' ? 'whole coast' : bias.basis) + ')']);
      for (const g of arr(s.gaps)) method.push(['Spot gap', str(g)]);
    }
    return { sources, blends, method, setup: [] };
  }

  // ---------- page wiring ----------
  const LS = typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  const st = {
    feed: null, res: null, fetched: 0,
    region: (LS && LS.getItem('surf-region')) || HOME_REGION,
    good: !!(LS && LS.getItem('surf-good') === '1'),
    sort: (LS && SORT_LABEL[LS.getItem('surf-sort')] ? LS.getItem('surf-sort') : 'rating'),
    more: PAGE, open: {}, rf: {}, ctx: null,
    // live cams: the outdoors feed (last good kept), when it was read, and a repaint held back while a cam plays
    oc: null, ocAt: 0, ocSig: '', pending: false, snaps: new Set(),
    shell: typeof navigator !== 'undefined' && !!U() && typeof U().isDeckShell === 'function' && U().isDeckShell(navigator.userAgent)
  };
  if (!(st.region === 'all' || st.region === 'mine' || REGIONS.includes(st.region))) st.region = HOME_REGION;
  const save = () => { if (!LS) return; try { LS.setItem('surf-region', st.region); LS.setItem('surf-good', st.good ? '1' : '0'); LS.setItem('surf-sort', st.sort); } catch (e) { /* private mode */ } };

  // `auto` marks a timer or feed repaint: while a cam plays on this page it only updates the freshness mark and holds
  // the rest until the player stops (rebuilding the page would reload the frame). A repaint the owner asked for (a
  // filter, a sort, Show more) stops the player first.
  function paint(ctx, auto) {
    if (!ctx || !ctx.el) return;
    const state = pageState(st.res);
    const pscope = ctx.head && ctx.head.querySelector('.pscope');
    const live = !!(CAM.cur && ctx.el.contains && ctx.el.contains(CAM.cur.box));
    if (live && auto) {
      st.pending = true;
      if (state.k !== 'down' && typeof DeckPages.mark === 'function') DeckPages.mark(ctx, markOf(st.res));
      return;
    }
    if (live) camStop(true);
    st.pending = false;
    if (state.k === 'down') {
      if (pscope) pscope.innerHTML = '';
      // the one freshness mark says Not reporting, never an age left from an earlier good read (E4, E7)
      if (typeof DeckPages.mark === 'function') DeckPages.mark(ctx, { age: null });
      ctx.el.innerHTML = U().empty({ k: 'bad', title: 'Surf is not reporting.', retry: 'surf' });
      return;
    }
    const feed = st.res.data, names = regionNames(feed);
    if (pscope) pscope.innerHTML = headControls(st, names);
    if (typeof DeckPages.mark === 'function') DeckPages.mark(ctx, markOf(st.res));
    ctx.el.innerHTML = state.k === 'empty' ? U().empty({ k: 'idle', title: 'No wave reading here right now.' }) : page(feed, st);
    if (typeof DeckPages.tv === 'function') DeckPages.tv(ctx);
  }
  // E7: a feed with no age of its own and no timestamp the registry could read has an unknown age (null), never 0
  const markOf = res => { const feed = res.data; return { age: num(feed.age) ?? num(res.age), refresh: num(feed.refresh) || 1800, missing: arr(feed.sources).filter(s => s && s.status === 'unavailable').length }; };
  // E5: what each read must hold before the page draws it; the registry keeps the last good answer when one fails it
  const SHAPE = {
    coast: d => !!obj(d) && Array.isArray(d.spots),
    region: d => !!obj(d) && Array.isArray(d.spots),
    outdoors: d => !!obj(d)
  };

  // The registry gates timer refreshes (`every` below); a show or a manual refresh always reads the feed. The outdoors
  // feed (the cams) is read beside it at most every ten minutes and repaints only when its cams change; a failed read
  // keeps the last good list.
  const OC_MS = 600000;
  async function load(ctx) {
    const prev = st.res && st.res.ok && obj(st.res.data) ? st.res.data.t : null;
    const ocP = Date.now() - st.ocAt >= OC_MS ? DeckPages.get('outdoors', { timeout: FETCH_MS, shape: SHAPE.outdoors }) : null;
    if (ocP) st.ocAt = Date.now();
    st.res = await DeckPages.get('surf-coast', { timeout: FETCH_MS, shape: SHAPE.coast });
    st.fetched = Date.now();
    const same = prev != null && st.res && st.res.ok && obj(st.res.data) && st.res.data.t === prev;
    if (!same) st.rf = {};
    paint(ctx, true);
    if (ocP) ocP.then(r => {
      const d = r && r.ok && obj(r.data) && Array.isArray(r.data.break_cams) ? r.data : null;
      if (!d) { st.ocAt = st.oc ? st.ocAt : 0; return; }
      const sig = JSON.stringify(d.break_cams);
      if (sig === st.ocSig) return;
      st.oc = d; st.ocSig = sig;
      if (st.res && st.res.ok) paint(ctx, true);
    }, () => {});
  }

  // One player at a time. It stops on Stop, when its tile is less than a quarter on screen, when the tab is hidden,
  // when the page leaves, and after ten minutes. YouTube refuses an embed that sends no referrer (its error 153), so
  // the frame sends the origin alone, never a path.
  const CAM = { cur: null, io: null, timer: 0 };
  function camStop(quiet) {
    const c = CAM.cur;
    if (!c) return;
    CAM.cur = null; clearTimeout(CAM.timer);
    if (CAM.io) { CAM.io.disconnect(); CAM.io = null; }
    c.frame.remove(); c.box.classList.remove('on');
    if (!quiet && st.pending && st.ctx) paint(st.ctx);
  }
  // A snapshot row opens and closes in place (a repaint would stop a pier that plays); the open set survives repaints.
  function snapToggle(btn) {
    const box = btn.closest('.sf-snap'), id = box && box.getAttribute('data-cam');
    const c = id && camModel(st.oc) && camModel(st.oc).cams.find(x => x.id === id && x.snap);
    if (!c) return;
    const on = !st.snaps.has(id);
    if (on) st.snaps.add(id); else st.snaps.delete(id);
    box.classList.toggle('on', on);
    btn.setAttribute('aria-expanded', String(on));
    const sm = btn.querySelector('small'); if (sm) sm.textContent = c.name + ' \u00B7 ' + (on ? 'snapshot' : 'tap for a picture');
    const old = box.querySelector('.sf-snapm, .sf-snapx'); if (old) old.remove();
    if (on) box.insertAdjacentHTML('beforeend', snapBox(c));
  }
  function camStart(btn) {
    const url = btn.getAttribute('data-play') || '', box = btn.closest('.sf-cam'), m = box && box.querySelector('.sf-camm');
    if (!m || !CAM_PLAYER_RE.test(url) || typeof document === 'undefined') return;
    camStop(true);
    const f = document.createElement('iframe');
    f.className = 'sf-camf'; f.title = 'Live cam: ' + (btn.querySelector('.sf-camn') || btn).textContent;
    f.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox');
    f.src = url;
    m.appendChild(f); box.classList.add('on');
    CAM.cur = { box, frame: f }; CAM.timer = setTimeout(() => camStop(), 600000);
    const x = box.querySelector('.sf-camx'); if (x && x.focus) x.focus({ preventScroll: true });
    if (typeof IntersectionObserver === 'function') {
      CAM.io = new IntersectionObserver(es => { if (es.some(e => e.intersectionRatio < 0.25)) camStop(); }, { threshold: [0, 0.25] });
      CAM.io.observe(m);
    }
  }

  async function regionFile(id) {
    const c = st.rf[id];
    if (c && Date.now() - c.at < 300000) return c.data;
    const r = await DeckPages.get('surf-coast/region/' + id, { timeout: FETCH_MS, shape: SHAPE.region });
    const data = r && r.ok && obj(r.data) && Array.isArray(r.data.spots) ? r.data : null;
    st.rf[id] = { at: Date.now(), data };
    return data;
  }

  function openSheet(spec) { return typeof DeckShell !== 'undefined' && DeckShell.sheet ? DeckShell.sheet.open(spec) : null; }

  async function openSpot(id) {
    const feed = st.res && st.res.data, s = feed && arr(feed.spots).find(x => x && x.id === id);
    if (!s) return;
    const dlg = openSheet(spotSheet(s, feed, st.rf[s.region] && st.rf[s.region].data));
    const rf = await regionFile(s.region);
    if (!rf || !dlg || !dlg.open) return;
    const b = dlg.querySelector('.sheet-b');
    if (b) b.innerHTML = spotSheet(s, feed, rf).body;
  }

  function onClick(e) {
    const t = e.target.closest('button, tr[data-open]');
    if (!t || !st.ctx) return;
    if (t.dataset.retry === 'surf') { load(st.ctx, true); return; }
    if (!st.res || !st.res.ok) return;
    const feed = st.res.data, names = regionNames(feed);
    const open = t.dataset.open;
    if (open === 'spot') return openSpot(t.dataset.key);
    if (open === 'buoy') { const b = arr(feed.buoys).find(x => x && x.id === t.dataset.key); if (b) openSheet(buoySheet(b, feed)); return; }
    if (open === 'alert' || open === 'alerts') { const g = alertGroups(feed.alerts, names).map(x => Object.assign(x, { names })); openSheet(alertsSheet(g, open === 'alert' ? t.dataset.key : null)); return; }
    if (t.dataset.region) { setRegion(t.dataset.region, true); return; }
    if (t.classList.contains('cs')) {
      const id = t.dataset.key;
      if (REGIONS.includes(id)) { setRegion(id, false); const card = st.ctx.el.querySelector('[data-region="' + id + '"]'); if (card) card.scrollIntoView({ block: 'nearest' }); }
      return;
    }
    const act = t.dataset.surf;
    if (act === 'cam') { camStart(t); return; }
    if (act === 'snap') { snapToggle(t); return; }
    if (act === 'camstop') { const v = t.closest('.sf-cam') && t.closest('.sf-cam').querySelector('.sf-camv'); camStop(); if (v && v.isConnected && v.focus) v.focus({ preventScroll: true }); return; }
    if (act === 'good') { st.good = !st.good; st.more = PAGE; st.open = {}; save(); paint(st.ctx); return; }
    if (act === 'sort') { st.sort = SORT_NEXT[st.sort]; save(); paint(st.ctx); return; }
    if (act === 'more') { st.more += PAGE; paint(st.ctx); return; }
    if (act === 'open') { st.open[t.dataset.k] = true; paint(st.ctx); return; }
    if (act === 'fewer') { const k = t.dataset.k; st.open[k] = false; paint(st.ctx); titleInView(k === 'spots' ? '#sf-spots' : k === 'best' ? '.sf-best' : '.sf-buoys'); return; }
    if (act === 'region') { openSheet(regionPicker(st, names)); return; }
    if (t.dataset.surfPick) { setRegion(t.dataset.surfPick, true); if (DeckShell.sheet) DeckShell.sheet.close(); return; }
    if (t.dataset.surfSort) { st.sort = t.dataset.surfSort; save(); paint(st.ctx); if (DeckShell.sheet) DeckShell.sheet.close(); }
  }

  function setRegion(id, scroll) {
    st.region = id; st.more = PAGE; st.open = {}; save(); paint(st.ctx);
    if (scroll) { const el = st.ctx.el.querySelector('#sf-spots'); if (el) el.scrollIntoView({ block: 'start' }); }
  }
  // After Show fewer the list is short again: if its title is now above the screen (under the sticky bar), bring it back
  // to the top; a title already in view does not move.
  function titleInView(sel) {
    const el = st.ctx && st.ctx.el && st.ctx.el.querySelector(sel);
    if (!el || typeof getComputedStyle !== 'function') return;
    const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    if (el.getBoundingClientRect().top < pad) el.scrollIntoView({ block: 'start' });
  }

  // The page body and header carry their own listeners; sheets live in the shell's dialog, so the document listener
  // acts only on this page's picker buttons.
  function wire(ctx) {
    st.ctx = ctx;
    for (const el of [ctx.el, ctx.head]) {
      if (el && !el.dataset.surfWired) {
        el.dataset.surfWired = '1'; el.addEventListener('click', onClick);
        // a snapshot the operator has rotated away says so in words, never a broken-image icon (error does not bubble)
        el.addEventListener('error', e => {
          const i = e.target;
          if (!i || i.tagName !== 'IMG' || !i.closest || !i.closest('.sf-snapm') || typeof document === 'undefined') return;
          const p = document.createElement('p'); p.className = 'note sf-snapx'; p.textContent = 'No picture right now. The live view still opens.';
          i.replaceWith(p);
        }, true);
      }
    }
    if (typeof document !== 'undefined' && !document.documentElement.dataset.surfWired) {
      document.documentElement.dataset.surfWired = '1';
      document.addEventListener('click', e => { if (e.target.closest('dialog [data-surf-pick], dialog [data-surf-sort]')) onClick(e); });
      document.addEventListener('visibilitychange', () => { if (document.hidden) camStop(true); });
    }
  }

  const route = {
    // deep links: `surf?region=baja-sur` picks the list, `surf?spot=salt-creek` opens that spot's sheet (Today's tile)
    async show(ctx) {
      wire(ctx);
      const p = (ctx && ctx.params) || {};
      if (p.region && (p.region === 'all' || p.region === 'mine' || REGIONS.includes(p.region))) { st.region = p.region; st.more = PAGE; st.open = {}; }
      if (st.res) paint(ctx);
      await load(ctx);
      if (p.spot) openSpot(String(p.spot));
    },
    refresh(ctx) { wire(ctx); return load(ctx); },
    every: 120000,
    hide() { camStop(true); st.pending = false; st.more = PAGE; st.open = {}; },
    data(ctx, scope) {
      const feed = st.res && st.res.ok ? st.res.data : null;
      const m = /^spot:(.+)$/.exec(str(scope)), s = m && feed && arr(feed.spots).find(x => x && x.id === m[1]);
      return dataModel(feed, scope, s && st.rf[s.region] && st.rf[s.region].data);
    }
  };
  if (typeof DeckPages !== 'undefined' && DeckPages && typeof DeckPages.register === 'function') DeckPages.register('surf', route);

  return {
    REGIONS, rate, isModel, regionModelOnly, heightText, periodText, zoneMark, tideMode, tideCardText, windWord, windText, bestText,
    reasonExtra, alertWord, alertGroups, alertSplit, pinnedSpots, spotRow, FETCH_MS, bestNow, regionSpots, latChart, tideLabels, outlookTitle, pageState, buoyRows, dataModel,
    spotCard, regionCard, regionsSection, alertsSection, alertLine, coastSegs, coastHtml, spotsSection, buoysSection, tempChart, outlook, tomorrowOf, tideCurve, page,
    camModel, camsSection, fcLive, CAM_PLAYER_RE, spotSheet, buoySheet, alertsSheet, regionPicker, headControls, route, _state: st, _cam: CAM
  };
})();
