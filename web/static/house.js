/* House tiles for the Home page: climate, lights and scenes, media, irrigation, energy, doors, presence, alerts, upkeep.
   One read: GET /api/ha?view=house. Controls: POST /api/ha?act=..&e=..&v=.. (the server allows lights, scenes, bedroom and TV
   play/pause and a 60 to 80 F thermostat set point, nothing else). Design v3: no source names or per-row ages on the page;
   a missing value reads "No reading", never 0; the block says "Out of date" only when the last re-read failed.
   Exports one global: window.DeckHouse = {render(el, now)}. */
(function () {
  'use strict';
  var NA = 'No reading';
  var st = { data: null, err: false, at: 0, busy: false, note: '', pending: '', el: null };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var isObj = function (x) { return x !== null && typeof x === 'object' && !Array.isArray(x); };
  var arr = function (x) { return Array.isArray(x) ? x : []; };
  var epoch = function (x) { return typeof x === 'number' && isFinite(x) && x > 0 ? x : null; };
  var ID_RE = /^[a-z_]+\.[a-z0-9_]{1,64}$/;

  function lapse(t, now) {
    var s = Math.max(0, Math.round(now / 1000 - t));
    return s < 45 ? 'just now' : s < 5400 ? Math.max(1, Math.round(s / 60)) + ' min ago' : s < 172800 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago';
  }
  function clock(t) {
    try { return new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return NA; }
  }
  /* an event time: a future time reads as a clock time, a past one as how long ago */
  function atText(t, now) {
    t = epoch(t);
    if (t == null) return null;
    return t * 1000 > now ? clock(t) : lapse(t, now);
  }

  function frow(main, val, sub, extra) {
    var none = val == null || val === '';
    return '<div class="frow"><span class="fl"><b>' + esc(main) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span><span class="fr"><b' + (none ? ' class="na"' : '') + '>' + esc(none ? NA : val) + '</b>' + (extra || '') + '</span></div>';
  }
  /* one fact row from the server: a value or an event time, plus the server's own note */
  function factRow(r, now) {
    if (!isObj(r)) return '';
    var v = r.v != null ? r.v : atText(r.at, now);
    return frow(String(r.k || ''), v, r.n ? String(r.n) : '', '');
  }
  function btn(act, e, label, extra, aria) {
    return '<button type="button" class="b" data-hx-act="' + esc(act) + '" data-hx-e="' + esc(e) + '"' + (extra || '') + ' aria-label="' + esc(aria || label) + '"' + (st.busy ? ' disabled' : '') + '>' + esc(label) + '</button>';
  }
  function section(title, body) {
    return '<section class="tsec"><h3 class="secttl"><span>' + esc(title) + '</span></h3>' + body + '</section>';
  }
  var flist = function (rows) { return '<div class="flist">' + rows + '</div>'; };
  var factSection = function (title, rows, now) {
    var list = arr(rows).map(function (r) { return factRow(r, now); }).join('');
    return section(title, flist(list || frow('Nothing reported', null, '', '')));
  };

  function climate(g, now, data) {
    g = isObj(g) ? g : {};
    var min = typeof g.min === 'number' ? g.min : 60, max = typeof g.max === 'number' ? g.max : 80, rows = '';
    arr(g.devices).forEach(function (d) {
      if (!isObj(d) || !ID_RE.test(String(d.id))) return;
      var cur = d.cur != null ? d.cur + ' \u00B0F' : null, tgt = d.target != null ? Number(d.target) : null;
      var can = data.set_ok && tgt != null && isFinite(tgt);
      var ctl = can
        ? '<span class="chips">' + btn('climate_set', d.id, '\u2212', ' data-hx-v="' + esc(Math.max(min, tgt - 1)) + '"', 'Lower ' + d.name + ' by one degree') + btn('climate_set', d.id, '+', ' data-hx-v="' + esc(Math.min(max, tgt + 1)) + '"', 'Raise ' + d.name + ' by one degree') + '</span>'
        : '';
      var val = cur == null && tgt == null ? null : (cur || NA) + (tgt != null ? ' \u2192 ' + tgt + ' \u00B0F' : '');
      rows += frow(String(d.name || 'Thermostat'), val, [d.mode, d.action].filter(Boolean).join(' \u00B7 '), ctl);
    });
    var facts = arr(g.rows).map(function (r) { return factRow(r, now); }).join('');
    var note = !arr(g.devices).length ? '<p class="tnote">No thermostat is set up, so there is nothing to change here (set points stay between ' + esc(min) + ' and ' + esc(max) + ' \u00B0F).</p>' : '';
    return section('Climate', (rows || facts ? flist(rows + facts) : '') + note);
  }

  function lights(g) {
    g = isObj(g) ? g : {};
    var ls = arr(g.lights).filter(function (l) { return isObj(l) && ID_RE.test(String(l.id)); });
    var sc = arr(g.scenes).filter(function (s) { return isObj(s) && ID_RE.test(String(s.id)); });
    var body = '';
    if (ls.length) {
      body += flist(ls.map(function (l) {
        var on = l.on === true, known = typeof l.on === 'boolean';
        return frow(String(l.name || l.id), known ? (on ? 'On' : 'Off') : null, '', btn('light_toggle', l.id, on ? 'Turn off' : 'Turn on', '', (on ? 'Turn off ' : 'Turn on ') + l.name));
      }).join(''));
    }
    if (sc.length) {
      body += '<div class="chips wrap">' + sc.map(function (s) { return btn('scene_on', s.id, String(s.name || s.id).slice(0, 24), '', 'Run scene ' + s.name); }).join('') + '</div>';
    }
    if (!body) body = flist(frow('Lights and scenes', null, 'None set up yet', ''));
    return section('Lights and scenes', body);
  }

  function media(list) {
    var ms = arr(list).filter(function (m) { return isObj(m) && ID_RE.test(String(m.id)); });
    var body = ms.length ? flist(ms.map(function (m) {
      var s = m.state == null ? null : String(m.state).replace(/_/g, ' ');
      s = s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
      return frow(String(m.name || m.id), m.now || s, m.now && s ? s : '', btn('media_pp', m.id, 'Play or pause', '', 'Play or pause ' + m.name));
    }).join('')) : flist(frow('Media players', null, 'None set up yet', ''));
    return section('Media', body);
  }

  function build(d, now) {
    var g = isObj(d.groups) ? d.groups : {};
    var out = [
      factSection('Weather and sun', g.weather, now),
      climate(g.climate, now, d),
      lights(g.lights),
      media(g.media),
      factSection('Irrigation', g.irrigation, now),
      factSection('Energy', g.energy, now),
      factSection('Doors and locks', g.doors, now),
      arr(g.vacuum).length ? factSection('Vacuum', g.vacuum, now) : '',
      factSection('Presence', g.presence, now),
      factSection('Alerts and automations', g.alerts, now),
      factSection('Upkeep', g.upkeep, now),
      factSection('Commute and tolls', g.commute, now)
    ];
    return out.join('');
  }

  var HEAD = '<h2 class="secttl"><span>Around the house</span>';
  function paint(now) {
    var el = st.el;
    if (!el) return;
    var d = st.data;
    if (!isObj(d) || d.error) {
      el.innerHTML = HEAD + '</h2><div class="es es-bad" role="status"><b class="es-t">The house is not reporting</b><span class="es-l">No answer yet. It tries again on its own.</span></div>';
      return;
    }
    var stale = st.err ? '<span class="pill warn"><span class="sd warn"></span>Out of date</span>' : '';
    var note = st.note ? '<p class="tnote" role="status">' + esc(st.note) + '</p>' : '';
    el.innerHTML = HEAD + stale + '</h2>' + note + '<div class="hxg">' + build(d, now) + '</div>';
  }

  /* every request here is bounded (PageLanes 13.6): after FETCH_MS the request is aborted and the call rejects, so a hung answer
     ends in the not-reporting state (or "Out of date" over the last good read) and never in a blank block or a stuck busy flag */
  var FETCH_MS = 60000;
  function bfetch(url, opt) {
    var ac = typeof AbortController === 'function' ? new AbortController() : null, o = {}, k;
    for (k in opt) o[k] = opt[k];
    if (ac) o.signal = ac.signal;
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { if (ac) ac.abort(); rej(new Error('timed out')); }, FETCH_MS);
      var done = function (fn) { return function (x) { if (typeof clearTimeout === 'function') clearTimeout(t); fn(x); }; };
      fetch(url, o).then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { r: r, j: j }; }); }).then(done(res), done(rej));
    });
  }

  function load(now) {
    if (st.busy) return Promise.resolve();
    st.busy = true;
    return bfetch('/api/ha?view=house', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (x) { var j = x.j; if (isObj(j) && !j.error) { st.data = j; st.err = false; } else st.err = true; })
      .catch(function () { st.err = true; })
      .then(function () { st.busy = false; st.at = Date.now(); paint(Date.now()); });
  }

  function act(b) {
    var a = b.getAttribute('data-hx-act'), e = b.getAttribute('data-hx-e'), v = b.getAttribute('data-hx-v');
    if (!a || !ID_RE.test(e || '')) return;
    var url = '/api/ha?act=' + encodeURIComponent(a) + '&e=' + encodeURIComponent(e) + (v != null ? '&v=' + encodeURIComponent(v) : '');
    st.busy = true; st.note = 'Sending\u2026'; paint(Date.now());
    bfetch(url, { method: 'POST', credentials: 'same-origin' })
      .then(function (x) { var r = x.r, j = x.j; return { ok: r.ok && isObj(j) && j.ok === true, j: j, s: r.status }; })
      .catch(function () { return { ok: false, j: null, s: 0 }; })
      .then(function (o) {
        st.busy = false;
        st.note = o.ok ? 'Done. Reading the house again.' : 'Not done: ' + (o.s === 429 ? 'too fast, wait a second' : o.j && o.j.error ? o.j.error : 'the house did not answer');
        paint(Date.now());
        setTimeout(function () { st.note = ''; load(Date.now()); }, o.ok ? 900 : 2500);
      });
  }

  function render(el, now) {
    if (!el) return;
    st.el = el;
    if (!el.getAttribute('data-hx-bound')) {
      el.setAttribute('data-hx-bound', '1');
      el.addEventListener('click', function (ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest('button[data-hx-act]') : null;
        if (b && !b.disabled) act(b);
      });
    }
    var t = typeof now === 'number' ? now : Date.now();
    if (st.data) paint(t);
    else if (!el.firstChild) el.innerHTML = '<p class="tnote" role="status">Reading the house\u2026</p>';
    if (Date.now() - st.at > 5000) load(t);
  }

  window.DeckHouse = { render: render };
})();
