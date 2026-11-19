// In-page checks for the final web polish. qa/copy-proof.mjs evaluates POLISH_CHECKS on the page that is on screen, in every
// viewport, with the OmarchyDeck user agent and the shell's 56 px reserved corner, and fails on any violation it returns.
// Rules (Impeccable craft floor + owner feedback): no eyebrow labels, nothing outranks a title, one container level,
// the shell's corner stays empty, the fullscreen button is gone in the shell, short labels are never cut.
export const POLISH_CHECKS = `(() => {
  const V = [];
  const num = (s) => parseFloat(s) || 0;
  const vw = innerWidth, vh = innerHeight, keyIcon = (e) => !!(e.classList && e.classList.contains('ic') && e.closest('.key')); // a key's glyph is the owner's own choice in keys.json, not interface text
  // the page on screen: the deck un-hides one section (v3); the older pager slid pages sideways, so fall back to the one under the viewport
  const pg = document.querySelector('#pager>.page:not([hidden])') || [...document.querySelectorAll('#pager>.page')].find((p) => { const r = p.getBoundingClientRect(); return r.left > -5 && r.left < vw / 2; })
    || document.querySelector('#pager>.page:not([inert])') || document.querySelector('#pager>.page');
  const name = pg ? pg.dataset.name : '?';
  const visible = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); if (e.closest('details:not([open])') && !e.closest('summary')) return false; return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const scope = [document.querySelector('#top'), pg].filter(Boolean);
  const all = scope.flatMap((s) => [s, ...s.querySelectorAll('*')]).filter(visible);
  const hasText = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const label = (e) => (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '') + ' "' + (e.textContent || '').trim().slice(0, 28) + '"';
  const add = (rule, e, extra) => V.push(name + ' ' + rule + ': ' + label(e) + (extra ? ' ' + extra : ''));

  // 1. no eyebrows: capitals or tracking on text
  for (const e of all) if (hasText(e)) { const cs = getComputedStyle(e); if (cs.textTransform === 'uppercase') add('uppercase', e); if (num(cs.letterSpacing) > 0.5) add('tracked', e, cs.letterSpacing); }
  // 2. sizes sit on the type scale; nothing in the top bar outranks the title token; the clock is quiet. The v3 scale is fluid (DESIGN.md 3):
  // its steps are read from the tokens at this viewport (plus 16 px inputs and the 12 px phone map codes); a strip figure scales with its
  // own cell between the lead and fig steps. A deck without the v3 tokens keeps the old fixed ramp 28/20/15/13/12 (+16 for inputs).
  const rootCs = getComputedStyle(document.documentElement), v3 = !!(rootCs.getPropertyValue && String(rootCs.getPropertyValue('--fs-body')).trim());
  const stepPx = (n) => { const t = document.createElement('i'); t.style.fontSize = 'var(' + n + ')'; document.body.appendChild(t); const px = num(getComputedStyle(t).fontSize); t.remove(); return px; };
  const steps = v3 ? ['--fs-micro', '--fs-meta', '--fs-body', '--fs-lead', '--fs-title', '--fs-page', '--fs-fig', '--fs-display'].map(stepPx).concat([16], vw < 600 ? [12] : []) : [28, 20, 15, 13, 12, 16];
  const lead = v3 ? stepPx('--fs-lead') : 0, fig = v3 ? stepPx('--fs-fig') : 0;
  const onRamp = (e, fs) => steps.some((s) => Math.abs(s - fs) < 0.06) || (v3 && fs >= lead - 0.06 && fs <= fig + 0.06 && !!e.closest('.strip>.tile .v,.tiles4>.tile .v'));
  for (const e of all) if (hasText(e) && !keyIcon(e)) { const fs = num(getComputedStyle(e).fontSize); if (!onRamp(e, fs)) add('off-ramp size', e, fs + 'px'); }
  const top = document.querySelector('#top');
  for (const e of top.querySelectorAll('*')) if (hasText(e) && visible(e) && num(getComputedStyle(e).fontSize) > 20) add('top bar outranks a title', e);
  const clock = document.querySelector('#clock'), ccs = getComputedStyle(clock);
  if (num(ccs.fontSize) > 20 || num(ccs.fontWeight) > 400 || !/tabular-nums/.test(ccs.fontVariantNumeric)) add('clock not quiet', clock, ccs.fontSize + ' ' + ccs.fontWeight + ' ' + ccs.fontVariantNumeric);
  // 3. one container level: a surface (tinted fill or inset ring, rounded) never sits inside another surface
  const surface = (e) => { const cs = getComputedStyle(e); if (!/^(DIV|SECTION|A|ARTICLE|SUMMARY|DETAILS)$/.test(e.tagName)) return false; const r = e.getBoundingClientRect();
    if (r.width < 48 || r.height < 30 || num(cs.borderRadius) < 8) return false; if (e.matches('.cam,.cam-media,.pill,.tier,.bar,.sd,.es,#tp,#scr,.lnrow,.cam em') || e.closest('#top')) return false; // the glass bar is the control layer, not a content card
    const fill = cs.backgroundColor, a = /rgba\\(.*,\\s*([\\d.]+)\\)$/.exec(fill); const filled = fill !== 'rgba(0, 0, 0, 0)' && !(a && parseFloat(a[1]) === 0);
    return filled || /inset/.test(cs.boxShadow); };
  for (const e of all) if (surface(e)) for (let p = e.parentElement; p && p !== pg; p = p.parentElement) if (surface(p)) { add('nested card', e, 'in ' + label(p).slice(0, 40)); break; }
  // 4. the shell corner and fullscreen
  const fs = document.querySelector('#fs');
  if (/OmarchyDeck\\//.test(navigator.userAgent) && getComputedStyle(fs).display !== 'none') add('fullscreen button shown inside the shell', fs);
  const reserve = num(getComputedStyle(document.documentElement).getPropertyValue('--shell-reserve-top-right'));
  const pad = Math.max(16, num(getComputedStyle(document.querySelector('#app')).paddingRight));
  if (reserve && document.querySelector('#topr').getBoundingClientRect().right > vw - pad - reserve + 0.5) add('content inside the reserved corner', document.querySelector('#topr'));
  if (reserve) for (const e of document.querySelectorAll('#top *')) { if (!visible(e)) continue; const r = e.getBoundingClientRect(); if (r.right > vw - pad - reserve + 0.5 && r.top < reserve && e.closest('#topr')) add('reserved corner', e); }
  // 5. short labels are whole: no clipped or clamped text on tile labels, values, section titles, pills, chips, the status pill
  const mustFit = '.tile .h,.tile .v,.mt span,.mt b,.chip b,.secttl>span:first-child,.pill,.g b,.g span,#status,#status #st';
  for (const e of pg.querySelectorAll(mustFit)) { if (!visible(e)) continue; const r = e.getBoundingClientRect(); if (r.top > vh || r.bottom < 0) continue;
    // a row below the fold is cut by the scroller, not by its own clamp: only judge rows that start on screen. A figure set at the 1.05
    // line height (DESIGN 3) overhangs its line box by about a tenth of an em (Geist Mono's glyph box is 1.3 em): that is not a cut while
    // the box does not clip, so up to .2 em of vertical overflow passes on a box with overflow visible
    const ecs = getComputedStyle(e), slack = ecs.overflowY === 'visible' ? Math.max(1, 0.2 * num(ecs.fontSize)) : 1;
    if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + slack) add('text cut', e, e.scrollWidth + 'x' + e.scrollHeight + ' in ' + e.clientWidth + 'x' + e.clientHeight); }
  const st = document.querySelector('#status'); if (st.scrollWidth > st.clientWidth + 1) add('status cut', st);
  const on = document.querySelector('#pgs button.on'), strip = document.querySelector('#pgs').getBoundingClientRect(), br = on && on.getBoundingClientRect();
  if (!on || br.left < strip.left - 1 || br.right > strip.right + 1) add('active tab clipped', on || top, on ? 'tab ' + Math.round(br.left) + '-' + Math.round(br.right) + ' strip ' + Math.round(strip.left) + '-' + Math.round(strip.right) : '');
  // 6. one hue for taps and another for warnings; no bare "--" placeholder where a word belongs
  const rgbOf = (n) => { const t = document.createElement('i'); t.style.color = 'var(' + n + ')'; document.body.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return c; };
  const hueOf = (s) => { const m = /(\\d+(?:\\.\\d+)?)[ ,]+(\\d+(?:\\.\\d+)?)[ ,]+(\\d+(?:\\.\\d+)?)/.exec(s); if (!m) return 0; const [r, g, b] = [+m[1], +m[2], +m[3]].map((v) => (/color\\(/.test(s) ? v * 255 : v)); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  const dh = Math.abs(hueOf(rgbOf('--tint')) - hueOf(rgbOf('--warn'))); if (Math.min(dh, 360 - dh) < 15) add('tint and warn are one hue', document.documentElement, rgbOf('--tint') + ' vs ' + rgbOf('--warn'));
  // healthy pages must have none; a failed page may keep the short dash of its own "Not reporting" tile, except on the pages this rule was written for
  if (window.__proofMode !== 'broken' || /^(shop|money|invest|schedules|house)$/.test(name)) for (const e of all) if ([...e.childNodes].some((n) => n.nodeType === 3 && /^\\s*--\\s*$/.test(n.textContent))) add('bare placeholder', e);
  for (const e of all) if (!keyIcon(e) && [...e.childNodes].some((n) => n.nodeType === 3 && /[\\u{1F300}-\\u{1FAFF}\\u23E9-\\u23FA]/u.test(n.textContent))) add('colour emoji glyph', e);
  // 7. text contrast on the colours really painted behind it (group opacity included): 4.5:1, or 3:1 for large text
  const parse = (s) => { const m = /^(rgba?|color)\\(([^)]*)\\)/.exec(s); if (!m) return null; let p = m[2].replace('srgb', '').replace('/', ' ').split(/[\\s,]+/).filter(Boolean).map(parseFloat); if (m[1] === 'color') p = [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; else if (p.length < 4) p.push(1); return p; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const painted = (e) => { const chain = []; for (let p = e; p; p = p.parentElement) chain.unshift(p);
    const ops = chain.map((p) => parseFloat(getComputedStyle(p).opacity)), k = ops.findIndex((o) => o < 1), O = ops.reduce((a, o) => a * o, 1);
    const comp = (from, to, base) => { let c = base; for (let i = from; i < to; i++) { const bg = parse(getComputedStyle(chain[i]).backgroundColor); if (bg && bg[3] > 0) c = mix(c, bg, bg[3]); } return c; };
    const outer = comp(0, k < 0 ? chain.length : k, [22, 22, 26]), inner = k < 0 ? outer : comp(k, chain.length, outer);
    const tc = parse(getComputedStyle(e).color) || [255, 255, 255, 1], over = mix(inner, tc, tc[3]);
    return { bg: mix(outer, inner, O), fg: mix(outer, over, O) }; };
  for (const e of all) { if (!hasText(e) || e.closest('.cam,#viewer,#amb,.sr,[disabled]')) continue; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); if (r.top > vh || r.bottom < 0 || r.left > vw || r.right < 0) continue;
    const fs2 = num(cs.fontSize), large = fs2 >= 24 || (fs2 >= 18.66 && num(cs.fontWeight) >= 600), p = painted(e), cr = ratio(p.fg, p.bg);
    if (cr < (large ? 3 : 4.5) - 0.01) add('low contrast', e, cr.toFixed(2) + ':1'); }
  // 8. the text of a card never sits on its border (a squashed row), and no cut text ends in an ellipsis in the money pages
  for (const e of pg.querySelectorAll('*')) { if (!surface(e) || !visible(e) || e.closest('.seg,.chips,#pgs')) continue; const r = e.getBoundingClientRect();
    for (const t of e.querySelectorAll('*')) { if (!hasText(t) || !visible(t)) continue; const tr = t.getBoundingClientRect();
      if (tr.top < r.top + 2 || tr.bottom > r.bottom - 2) { add('text touches the card edge', t, 'card ' + Math.round(r.height) + 'px'); break; } } }
  // one padding system: the text of a Shop chip, a watch card and a Money card sits at least 8px inside its border (a button is centred in its own box and is judged by its 44px target)
  for (const e of pg.querySelectorAll('.chip.cv,.wc,.fa,.ftot')) { if (!visible(e)) continue; const r = e.getBoundingClientRect();
    for (const t of e.querySelectorAll('*')) { if (!hasText(t) || !visible(t) || t.closest('button')) continue; const tr = t.getBoundingClientRect();
      if (tr.top < r.top + 7.5 || tr.bottom > r.bottom - 7.5 || tr.left < r.left + 7.5 || tr.right > r.right - 7.5) { add('card padding under 8px', t, Math.round(tr.top - r.top) + '/' + Math.round(r.bottom - tr.bottom) + '/' + Math.round(tr.left - r.left) + 'px'); break; } } }
  if (/^(shop|money|schedules|invest)$/.test(name)) for (const e of pg.querySelectorAll('*')) { if (!hasText(e) || !visible(e)) continue; const cs = getComputedStyle(e), r = e.getBoundingClientRect(); if (r.top > vh || r.bottom < 0) continue;
    if ((cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) || (/-webkit-box/.test(cs.display) && cs.webkitLineClamp !== 'none' && e.scrollHeight > e.clientHeight + 1)) add('ellipsis cut', e); }
  // 9. a tap is a filled button, a status is a wash with a word: no outline is both (Reveal and a stale card used to be the same 1px amber ring)
  const warnRgb = rgbOf('--warn');
  for (const e of pg.querySelectorAll('button.b.fr,button.b.fh')) { if (!visible(e)) continue; const cs = getComputedStyle(e), bg = parse(cs.backgroundColor);
    if (/inset/.test(cs.boxShadow) || !bg || bg[3] < 0.9) add('Reveal or Hide is an outline, not a filled button', e, cs.boxShadow); }
  for (const e of pg.querySelectorAll('.stale,.fs,.partial')) { if (!visible(e)) continue; const sh = getComputedStyle(e).boxShadow; if (sh.includes(warnRgb)) add('a stale card is drawn as a ring', e, sh); }
  // 10. glass is the control layer only: no content surface on the page is glass, and the bar never filters its own text. The 2026-10 capsule bar
  // (rounded) had to blur what scrolls under it; the v3 bar is a square solid hairline bar (DESIGN.md: it replaced the glass capsule), so that part
  // applies to a rounded bar only
  for (const e of pg.querySelectorAll('*')) for (const ps of [null, '::before', '::after']) { const cs = getComputedStyle(e, ps), bf = cs.backdropFilter || cs.webkitBackdropFilter; if (bf && bf !== 'none') add('glass on a content surface', e, bf); }
  { const capsule = num(getComputedStyle(top).borderTopLeftRadius) > 0, tcs = getComputedStyle(top, '::before'), bf = tcs.backdropFilter || tcs.webkitBackdropFilter; if (capsule && (!bf || bf === 'none')) add('top bar is not glass', top); const own = getComputedStyle(top).backdropFilter; if (own && own !== 'none') add('top bar filters its own text', top); }
  // 11. the host switch is a control on the page the owner judges: 44 x 44 or more each (DESIGN.md)
  for (const b of document.querySelectorAll('#hosts button')) { const r = b.getBoundingClientRect(); if (r.width < 43.5 || r.height < 43.5) add('host switch under 44 px', b, Math.round(r.width) + 'x' + Math.round(r.height)); }
  // 12. the pill's rounded corner sits inside the capsule's rounded corner (the capsule clips whatever leaves it)
  { const cap = top.getBoundingClientRect(), R = parseFloat(getComputedStyle(top).borderTopLeftRadius) || 0;
    const inside = (x, y) => { const cx = x < cap.left + R ? cap.left + R : x > cap.right - R ? cap.right - R : x, cy = y < cap.top + R ? cap.top + R : y > cap.bottom - R ? cap.bottom - R : y; return Math.hypot(x - cx, y - cy) <= R + 0.5 && x >= cap.left - 0.5 && x <= cap.right + 0.5 && y >= cap.top - 0.5 && y <= cap.bottom + 0.5; };
    for (const b of document.querySelectorAll('#hosts button')) { const r = b.getBoundingClientRect(), rad = parseFloat(getComputedStyle(b).borderTopLeftRadius) || 0, k = rad * (1 - Math.SQRT1_2);
      for (const [x, y] of [[r.left + k, r.top + k], [r.right - k, r.top + k], [r.left + k, r.bottom - k], [r.right - k, r.bottom - k]]) if (!inside(x, y)) { add('host pill clipped by the capsule corner', b, 'corner ' + Math.round(x) + ',' + Math.round(y)); break; } } }
  // 13. the Keys page starts on its first key row: a key column centred inside the taller connections column pushed every key off screen in landscape
  if (name === 'pad') { const kp = pg.querySelector('.sub[data-sub="keys"]:not([hidden])');
    if (kp) { const ks = [...pg.querySelectorAll('#keys .key')].filter(visible), first = ks[0];
      if (first) { const r = first.getBoundingClientRect(), pre = kp.getBoundingClientRect();
        // landscape only: the bug was a key column pushed below a landscape fold. In portrait the Pad/Keys tabs and the group chips sit above the keys by design (about 82 px); the on-screen count below still judges portrait
        if (vw > vh && r.top - pre.top > 80) add('first key row below the fold', first, Math.round(r.top - pre.top) + 'px under the page top');
        const onScreen = ks.filter((k) => { const q = k.getBoundingClientRect(); return q.bottom > 0 && q.top < vh && q.width >= 43.5 && q.height >= 43.5; }).length;
        if (onScreen < 12) add('keys off screen or under 44 px', first, onScreen + ' of ' + ks.length + ' on screen'); } } }
  return V;
})()`;

// Text-block census: how many separate pieces of text a page puts in front of the reader. A block is a visible element with text of its
// own (a direct text node); `screen` counts the blocks that start inside the viewport, `page` counts every block on the page.
export const CENSUS = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const pg = document.querySelector('#pager>.page:not([hidden])') || [...document.querySelectorAll('#pager>.page')].find((p) => { const r = p.getBoundingClientRect(); return r.left > -5 && r.left < vw / 2; })
    || document.querySelector('#pager>.page:not([inert])') || document.querySelector('#pager>.page');
  let screen = 0, page = 0;
  for (const e of pg.querySelectorAll('*')) {
    if (e.closest('.diag') || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (e.closest('details:not([open])') && !e.closest('summary')) continue;
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    if (r.width <= 0 || r.height <= 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    page++;
    if (r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0) screen++;
  }
  return { name: pg.dataset.name, screen, page };
})()`;
