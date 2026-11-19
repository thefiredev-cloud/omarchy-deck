// Mock deck for front-end browser proof: serves the worktree's static/ and synthetic /api/* per CONTRACT.md.
// Run only inside the task's named Omabox. Every non-GET is recorded in `log` for assertions.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as F from './fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

export function startMockDeck(port, opts = {}) {
  const staticDir = opts.staticDir || path.join(root, 'static');
  const st = { jobs: F.cronJobs(), runs: new Map(), log: [], diag: [], seq: 0, lastRun: null, hlsStatus: opts.hlsStatus ?? 404, camFail: !!opts.camFail };
  const json = (res, code, v) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(v)); };
  const body = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
  const runView = (r) => {
    const age = (Date.now() - r.created) / 1000;
    const state = age < 0.6 ? 'queued' : age < r.dur ? 'running' : 'done';
    const lines = [];
    if (state !== 'queued') lines.push('tool read_file: SKILL.md');
    if (state === 'done') lines.push(...r.out);
    for (const s of r.steers) lines.push('steer: ' + s.slice(0, 80));
    return { ok: true, run_id: r.id, state, detail: state === 'done' ? 'completed' : state, elapsed_s: Math.round(Math.min(age, r.dur) * 10) / 10, created_at: r.created / 1000, updated_at: (r.created + Math.min(age, r.dur) * 1000) / 1000, t: Math.floor(Date.now() / 1000), last_event: 'x', lines, more: 0, session_id: r.session };
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname, q = url.searchParams;
    if (req.method !== 'GET') {
      const raw = await body(req);
      let j = null; try { j = JSON.parse(raw); } catch {}
      st.log.push({ method: req.method, path: p, query: Object.fromEntries(q), body: j, rawLen: raw.length, ct: req.headers['content-type'] || null });
      if (p === '/api/cron-act') {
        const id = q.get('id'), act = q.get('act');
        if (!/^[0-9a-f]{8}$/.test(id || '') || !['run', 'pause', 'resume'].includes(act)) return json(res, 400, { ok: false, error: 'bad input' });
        const job = st.jobs.find((x) => x.id.startsWith(id));
        if (!job) return json(res, 404, { ok: false, error: 'unknown job' });
        if (opts.cronFail) return json(res, 502, { ok: false, error: 'hermes gateway unreachable' });
        if (act === 'pause') { if (!job.enabled || job.state === 'paused') return json(res, 409, { ok: false, error: 'already paused' }); job.enabled = true; job.state = 'paused'; job.next_run_at = null; }
        if (act === 'resume') { if (job.enabled && job.state !== 'paused') return json(res, 409, { ok: false, error: 'already active' }); job.enabled = true; job.state = 'scheduled'; job.next_run_at = new Date(Date.now() + 600000).toISOString().replace(/\.\d+Z$/, 'Z'); }
        if (act === 'run') job.last_run_at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        return json(res, 200, { ok: true, act, id, name: job.name, t: Math.floor(Date.now() / 1000) });
      }
      if (p === '/api/run-send') {
        const text = typeof j?.text === 'string' ? j.text.trim() : '';
        if (!text || text.length > 2000) return json(res, 400, { ok: false, error: 'bad text' });
        let mode = 'new', id, session;
        const prev = j.run_id ? st.runs.get(j.run_id) : null;
        if (j.run_id && !prev) return json(res, 404, { ok: false, error: 'unknown run' });
        if (prev) {
          const v = runView(prev);
          if (v.state === 'queued' || v.state === 'running') { prev.steers.push(text); return json(res, 200, { ok: true, mode: 'steer', run_id: prev.id, t: Math.floor(Date.now() / 1000) }); }
          mode = 'reply'; session = prev.session;
        }
        id = 'run_mock' + ++st.seq; session = session || id;
        st.runs.set(id, { id, created: Date.now(), dur: 2.4, session, steers: [], out: ['Mock reply (' + mode + ') to: ' + text.slice(0, 90), 'session ' + session] });
        st.lastRun = id;
        return json(res, 200, { ok: true, mode, run_id: id, t: Math.floor(Date.now() / 1000) });
      }
      if (p === '/api/launch-item') {
        const id = 'run_mock' + ++st.seq;
        st.runs.set(id, { id, created: Date.now(), dur: 2.0, session: id, steers: [], out: ['Skill loaded. Nothing changed.', 'Send the topic.'] });
        st.lastRun = id;
        return json(res, 200, { ok: true, target: 'hermes', id: q.get('id'), name: String(q.get('id')).split(':')[1], run_id: id, status: 'started', t: Math.floor(Date.now() / 1000) });
      }
      if (p === '/api/cam-diag') { st.diag.push(j); return json(res, 200, { ok: true }); }
      return json(res, 200, { ok: true });
    }
    // GET
    if (p.startsWith('/api/')) {
      const a = p.slice(5);
      if (a === 'crons') return json(res, 200, F.cronsFeed(st.jobs));
      if (a === 'fleet-board') return json(res, 200, F.fleetBoard());
      if (a === 'today') return json(res, 200, F.todayFeed());
      if (a === 'run') { const r = st.runs.get(q.get('id')); return r ? json(res, 200, runView(r)) : json(res, 404, { ok: false, error: 'run not found' }); }
      if (a === 'run-last') { const r = st.lastRun && st.runs.get(st.lastRun); return r ? json(res, 200, { ok: true, run_id: r.id, id: 'skill:mock', launched_at: r.created / 1000 }) : json(res, 404, { ok: false, error: 'no run' }); }
      if (a === 'unit') {
        const name = q.get('name') || '';
        if (!/^[A-Za-z0-9@._-]{1,96}\.(service|timer)$/.test(name)) return json(res, 400, { ok: false, error: 'bad name' });
        if (!F.fleetBoard().units.failed_units.includes(name)) return json(res, 404, { ok: false, error: 'not a failing unit' });
        return json(res, 200, { ok: true, unit: name, active: 'failed', sub: 'failed', result: 'exit-code', exit: 1, since: 'Sat 2026-10-03 21:00:01 PDT', lines: ['Starting ' + name + '...', 'fixture error: example failure line', name + ': Main process exited, code=exited, status=1/FAILURE'], t: Math.floor(Date.now() / 1000) });
      }
      if (a === 'cams') return json(res, 200, { cams: [1, 2, 3, 4].map((i) => ({ name: 'eufy_cam' + i, ready: true, readers: 1, bytes: 1 })) });
      if (a === 'cam') {
        if (st.camFail) { res.writeHead(502); return res.end('x'); }
        const n = Number((q.get('e') || '').slice(-1)) || 1;
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Snap-Age': '0' });
        return res.end(F.png(320, 180, n));
      }
      if (a === 'keys') { let keys = []; try { keys = JSON.parse(fs.readFileSync(opts.keysFile || path.join(root, 'keys.json'), 'utf8')).keys; } catch {} return json(res, 200, { keys }); } // the real tiles, so the Keys page is drawn as it is on the phone
      if (a === 'ws-list') return json(res, 200, F.wsList());
      if (a === 'ws-now') return json(res, 200, { ws: F.wsList().active });
      if (a === 'hosts' || a === 'pad-targets') return json(res, 200, {});
      if (F.FEEDS[a]) return json(res, 200, F.FEEDS[a]());
      return json(res, 200, { error: 'not in fixture' });
    }
    if (p.startsWith('/cam/')) { res.writeHead(st.hlsStatus); return res.end('no'); }
    if (p === '/theme.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(fs.readFileSync(path.join(root, 'qa', 'theme.css'))); }
    const rel = p === '/' ? 'index.html' : p.slice(1);
    const file = path.join(staticDir, rel);
    if (!file.startsWith(staticDir + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, st, close: () => server.close() })));
}
