const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');

const KEY = 'synthetic-gateway-test';
const NOW = 1_800_000_000_000;
const JOBS = { jobs: [
  { id: '0123456789abcdef', name: 'Active fixture', enabled: true, state: 'scheduled', next_run_at: '2027-01-15T09:00:00Z' },
  { id: 'fedcba9876543210', name: 'Disabled fixture', enabled: false, state: 'paused', next_run_at: null },
] };

// Keep the real CLI and HTTP stack. Only freeze its clock and report the OS-assigned port over IPC.
const PRELOAD = `
  import http from 'node:http';
  let now = ${NOW};
  Date.now = () => now;
  const listen = http.Server.prototype.listen;
  http.Server.prototype.listen = function (...args) {
    this.once('listening', () => process.send({ port: this.address().port }));
    return listen.apply(this, args);
  };
  process.on('message', (ms) => { now += ms; process.send({ advanced: ms }); });
`;

async function gateway(t, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-gateway-'));
  const jobsPath = path.join(dir, 'jobs.json');
  const logPath = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(jobsPath, JSON.stringify(JOBS));
  const child = fork(path.resolve(__dirname, '../qa/mock-gateway.mjs'), ['0', jobsPath, logPath], {
    silent: true,
    env: { MOCK_GW_KEY: KEY, MOCK_ROLE: 'gateway', ...extraEnv },
    execArgv: ['--import', `data:text/javascript,${encodeURIComponent(PRELOAD)}`],
  });
  const closed = once(child, 'close');
  let stderr = '';
  child.stdout.resume();
  child.stderr.on('data', (data) => { stderr += data; });
  t.after(async () => {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
  assert.ok(ready.port > 0, stderr);
  return {
    jobs: () => JSON.parse(fs.readFileSync(jobsPath, 'utf8')),
    logs: () => fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse),
    advance: async (ms) => {
      const next = once(child, 'message', { signal: AbortSignal.timeout(10000) });
      child.send(ms);
      assert.deepEqual((await next)[0], { advanced: ms });
    },
    request: async (route, { body, key = KEY, method = body === undefined ? 'GET' : 'POST' } = {}) => {
      const res = await fetch(`http://127.0.0.1:${ready.port}${route}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      const type = res.headers.get('content-type');
      return { status: res.status, type, body: type === 'application/json' ? await res.json() : await res.text() };
    },
  };
}

const error = (message) => ({ error: { message } });
const events = (response) => response.body.trim().split('\n\n').map((line) => JSON.parse(line.slice('data: '.length)));

test('mock gateway: the gate role answers the decisions endpoint with a fixed P(yes), needs no key and serves nothing else', async (t) => {
  const yes = await gateway(t, { MOCK_ROLE: 'gate' });
  const ask = (gw, key) => gw.request('/api/alpha/decisions', { body: { model: 'jev-local', questions: { q: { type: 'bool' } }, state: 'a message' }, key });
  assert.deepEqual((await ask(yes, '')).body, { answers: { q: { bool: 0.97 } } });
  assert.equal((await yes.request('/api/alpha/decisions', { key: '' })).status, 404, 'GET is not the decisions endpoint');
  assert.equal((await yes.request('/v1/runs', { body: { input: 'x' }, key: '' })).status, 404);
  const no = await gateway(t, { MOCK_ROLE: 'gate', MOCK_GATE_P: '0.2' });
  assert.deepEqual((await ask(no, KEY)).body, { answers: { q: { bool: 0.2 } } });
});

test('mock gateway: health is public but unauthenticated actions cannot mutate jobs or start runs', async (t) => {
  const gw = await gateway(t);
  assert.deepEqual((await gw.request('/health', { key: '' })).body, { status: 'ok' });
  for (const [route, body] of [
    ['/api/jobs/0123456789abcdef/pause', {}], ['/v1/runs', { input: 'Unauthorized' }],
  ]) {
    const denied = await gw.request(route, { body, key: 'wrong-key' });
    assert.equal(denied.status, 401);
    assert.deepEqual(denied.body, error('bad key'));
  }
  assert.deepEqual(gw.jobs(), JOBS);
  assert.ok(gw.logs().every((entry) => entry.auth === 'bad'));
  assert.equal((await gw.request('/api/jobs')).status, 200);
});

test('mock gateway: cron actions persist pause, resume and run without changing other jobs', async (t) => {
  const gw = await gateway(t);
  assert.deepEqual((await gw.request('/api/jobs')).body, { jobs: [JOBS.jobs[0]] });
  const act = (id, action) => gw.request(`/api/jobs/${id}/${action}`, { body: {} });
  const paused = await act(JOBS.jobs[0].id, 'pause');
  assert.equal(paused.status, 200);
  assert.equal(paused.body.job.state, 'paused');
  const saved = gw.jobs();
  assert.equal(saved.jobs[0].state, 'paused');
  assert.equal(saved.jobs[0].next_run_at, null);
  assert.ok(Number.isFinite(Date.parse(saved.jobs[0].paused_at)));
  assert.deepEqual(saved.jobs[1], JOBS.jobs[1]);

  const resumed = await act(JOBS.jobs[1].id, 'resume');
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.job.state, 'scheduled');
  const active = gw.jobs().jobs[1];
  assert.equal(active.enabled, true);
  assert.equal(active.paused_at, null);
  assert.equal(Date.parse(active.next_run_at), NOW + 600000);
  assert.deepEqual((await gw.request('/api/jobs')).body.jobs, gw.jobs().jobs);

  assert.equal((await act(active.id, 'run')).status, 200);
  const ran = gw.jobs().jobs[1];
  assert.ok(Number.isFinite(Date.parse(ran.last_run_at)));
  const { last_run_at, ...unchanged } = ran;
  assert.deepEqual(unchanged, active);
  assert.deepEqual(gw.jobs().jobs[0], saved.jobs[0]);
});

test('mock gateway: unknown jobs, unsupported actions and wrong methods leave disk state unchanged', async (t) => {
  const gw = await gateway(t);
  for (const [route, options, message] of [
    ['/api/jobs/aaaaaaaa/pause', { body: {} }, 'job not found'],
    ['/api/jobs/0123456789abcdef/delete', { body: {} }, 'not in mock'],
    ['/api/jobs/0123456789abcdef/pause', {}, 'not in mock'],
  ]) {
    const response = await gw.request(route, options);
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, error(message));
  }
  assert.deepEqual(gw.jobs(), JOBS);
});

test('mock gateway: runs expose output only at completion and retain the supplied session', async (t) => {
  const gw = await gateway(t);
  const sent = await gw.request('/v1/runs', { body: { input: 'Synthetic question', session_id: 'fixture-session' } });
  assert.equal(sent.status, 202);
  const route = `/v1/runs/${sent.body.run_id}`;
  const read = async () => (await gw.request(route)).body;
  const queued = await read();
  assert.equal(queued.status, 'queued');
  assert.equal(queued.created_at, NOW / 1000);
  assert.equal(queued.session_id, 'fixture-session');
  assert.equal(queued.output, undefined);
  await gw.advance(599);
  assert.equal((await read()).status, 'queued');
  await gw.advance(1);
  const running = await read();
  assert.equal(running.status, 'running');
  assert.equal(running.output, undefined);
  assert.equal(running.last_event, 'tool.started');
  await gw.advance(1599);
  assert.equal((await read()).status, 'running');
  await gw.advance(1);
  const done = await read();
  assert.equal(done.status, 'completed');
  assert.equal(done.last_event, 'run.completed');
  assert.equal(done.output, 'Mock reply to: Synthetic question\nsession fixture-session');
  assert.equal(done.updated_at, (NOW + 2200) / 1000);
  await gw.advance(10000);
  assert.deepEqual(await read(), done);
});

test('mock gateway: SSE carries steering and completion, then rejects steering a completed run', async (t) => {
  const gw = await gateway(t);
  const sent = await gw.request('/v1/runs', { body: { input: 'Start' } });
  const route = `/v1/runs/${sent.body.run_id}`;
  assert.equal((await gw.request(route)).body.session_id, sent.body.run_id);
  const initial = await gw.request(route + '/events');
  assert.equal(initial.type, 'text/event-stream');
  assert.deepEqual(events(initial), [
    { event: 'tool.started', tool: 'read_file', preview: 'SKILL.md' },
    { event: 'tool.completed', tool: 'read_file' },
  ]);
  assert.equal((await gw.request(route + '/steer', { body: { input: 'Use the fixture' } })).status, 200);
  const steering = events(await gw.request(route + '/events'));
  assert.deepEqual(steering.at(-1), { event: 'message.interim', text: 'steered: Use the fixture' });
  assert.equal(steering.some((event) => event.event === 'message.delta'), false);
  await gw.advance(2200);
  const completed = events(await gw.request(route + '/events'));
  assert.deepEqual(completed.find((event) => event.event === 'message.delta'), {
    event: 'message.delta', delta: `Mock reply to: Start\nsession ${sent.body.run_id}`,
  });
  const rejected = await gw.request(route + '/steer', { body: { input: 'Too late' } });
  assert.equal(rejected.status, 409);
  assert.deepEqual(rejected.body, error('run not active'));
  assert.deepEqual(events(await gw.request(route + '/events')), completed);
});

test('mock gateway: missing input and unknown run endpoints return errors', async (t) => {
  const gw = await gateway(t);
  for (const body of [{}, { input: '' }, { input: null }]) {
    const rejected = await gw.request('/v1/runs', { body });
    assert.equal(rejected.status, 400);
    assert.deepEqual(rejected.body, error('Missing input'));
  }
  for (const suffix of ['', '/events', '/steer']) {
    const response = await gw.request('/v1/runs/missing' + suffix, suffix === '/steer' ? { body: { input: 'Hello' } } : {});
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, error('run not found'));
  }
});
