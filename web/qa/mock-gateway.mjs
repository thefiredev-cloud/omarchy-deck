// Mock Hermes gateway (subset the deck uses) for full-stack proof inside an isolated box.
// Usage: node qa/mock-gateway.mjs <port> <jobs.json path> <log path>   (key: env MOCK_GW_KEY)
import http from 'node:http';
import fs from 'node:fs';
import { png } from './fixtures.mjs';

const [port, jobsPath, logPath] = [Number(process.argv[2] || 18642), process.argv[3], process.argv[4]];
const KEY = process.env.MOCK_GW_KEY || 'mock-gateway-key-0123456789';
const runs = new Map();
let seq = 0;
const log = (o) => { if (logPath) fs.appendFileSync(logPath, JSON.stringify({ t: Date.now(), ...o }) + '\n'); };
const view = (r) => {
  const age = (Date.now() - r.created) / 1000;
  const status = age < 0.6 ? 'queued' : age < r.dur ? 'running' : 'completed';
  return { run_id: r.id, status, created_at: r.created / 1000, updated_at: (r.created + Math.min(age, r.dur) * 1000) / 1000, session_id: r.session, output: status === 'completed' ? r.out : undefined, last_event: status === 'completed' ? 'run.completed' : 'tool.started', model: 'hermes-agent' };
};
const readJobs = () => JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
const writeJobs = (j) => fs.writeFileSync(jobsPath, JSON.stringify(j, null, 2));
const send = (res, code, v, ct = 'application/json') => { res.writeHead(code, { 'Content-Type': ct }); res.end(typeof v === 'string' ? v : JSON.stringify(v)); };
const body = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });

http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/health') return send(res, 200, { status: 'ok' });
  // Home Assistant subset (when this process is started as the HA mock: env MOCK_ROLE=ha)
  if (process.env.MOCK_ROLE === 'ha') {
    if (p === '/api/states') return send(res, 200, [1, 2, 3, 4].map((i) => ({ entity_id: 'camera.eufy_cam_' + i, state: 'idle', attributes: { friendly_name: 'Cam ' + i }, last_updated: new Date().toISOString() })));
    let c; if ((c = p.match(/^\/api\/camera_proxy\/camera\.eufy_cam_(\d)$/))) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(png(320, 180, Number(c[1]))); }
    return send(res, 404, { message: 'not in mock' });
  }
  // Decisions gate (env MOCK_ROLE=gate, optional MOCK_GATE_P, default 0.97): stands in for jev-local and clef-local. scripts/deck-launch asks
  // POST /api/alpha/decisions before it sends any text and refuses the send unless P(yes) is at least 0.6. The text is read and dropped, never logged.
  if (process.env.MOCK_ROLE === 'gate') {
    if (req.method === 'POST' && p === '/api/alpha/decisions') { await body(req); return send(res, 200, { answers: { q: { bool: Number(process.env.MOCK_GATE_P ?? 0.97) } } }); }
    return send(res, 404, { message: 'not in mock' });
  }
  if ((req.headers.authorization || '') !== 'Bearer ' + KEY) { log({ m: req.method, p, auth: 'bad' }); return send(res, 401, { error: { message: 'bad key' } }); }
  const raw = req.method === 'POST' ? await body(req) : '';
  let j = null; try { j = JSON.parse(raw); } catch {}
  log({ m: req.method, p, len: raw.length, keys: j ? Object.keys(j) : [], session: j?.session_id || null, hasInput: !!j?.input });
  let m;
  if (req.method === 'POST' && p === '/v1/runs') {
    if (!j?.input) return send(res, 400, { error: { message: 'Missing input' } });
    const id = 'run_gw' + ++seq + Date.now().toString(36);
    runs.set(id, { id, created: Date.now(), dur: 2.2, session: j.session_id || id, steers: [], out: `Mock reply to: ${String(j.input).slice(0, 80)}\nsession ${j.session_id || id}` });
    return send(res, 202, { run_id: id, status: 'started' });
  }
  if ((m = p.match(/^\/v1\/runs\/([A-Za-z0-9._-]+)(\/events|\/steer|\/stop)?$/))) {
    const r = runs.get(m[1]);
    if (!r) return send(res, 404, { error: { message: 'run not found' } });
    if (!m[2] && req.method === 'GET') return send(res, 200, view(r));
    if (m[2] === '/events' && req.method === 'GET') {
      const v = view(r);
      const ev = [{ event: 'tool.started', tool: 'read_file', preview: 'SKILL.md' }, { event: 'tool.completed', tool: 'read_file' }];
      if (v.status === 'completed') ev.push({ event: 'message.delta', delta: r.out });
      for (const s of r.steers) ev.push({ event: 'message.interim', text: 'steered: ' + s.slice(0, 60) });
      return send(res, 200, ev.map((e) => 'data: ' + JSON.stringify(e)).join('\n\n') + '\n\n', 'text/event-stream');
    }
    if (m[2] === '/steer' && req.method === 'POST') {
      const v = view(r);
      if (v.status === 'completed') return send(res, 409, { error: { message: 'run not active' } });
      r.steers.push(String(j?.input || '')); return send(res, 200, { run_id: r.id, status: 'steering' });
    }
  }
  if (p === '/api/jobs' && req.method === 'GET') return send(res, 200, { jobs: readJobs().jobs.filter((x) => x.enabled) });
  if ((m = p.match(/^\/api\/jobs\/([0-9a-f]{8,64})\/(pause|resume|run)$/)) && req.method === 'POST') {
    const all = readJobs(); const job = all.jobs.find((x) => x.id === m[1]);
    if (!job) return send(res, 404, { error: { message: 'job not found' } });
    if (m[2] === 'pause') { job.state = 'paused'; job.paused_at = new Date().toISOString(); job.next_run_at = null; }
    if (m[2] === 'resume') { job.state = 'scheduled'; job.enabled = true; job.paused_at = null; job.next_run_at = new Date(Date.now() + 600000).toISOString(); }
    if (m[2] === 'run') { job.last_run_at = new Date().toISOString(); }
    writeJobs(all);
    return send(res, 200, { job: { id: job.id, name: job.name, state: job.state } });
  }
  return send(res, 404, { error: { message: 'not in mock' } });
}).listen(port, '127.0.0.1', () => console.log('mock gateway listening ' + port));
