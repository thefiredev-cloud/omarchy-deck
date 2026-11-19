const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

async function deck(t, opts = {}) {
  const { startMockDeck } = await import('../qa/mock-deck.mjs');
  const { server } = await startMockDeck(0, opts);
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (route, body) => {
    const res = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return { status: res.status, body: await res.json() };
  };
}

function clock(t) {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  return (ms) => { now += ms; };
}

const cronAction = (id, act) => `/api/cron-act?id=${id}&act=${act}`;

// These tests use only synthetic loopback HTTP, not a browser or the live deck.
test('mock deck: cron pause and resume update the feed and reject repeated actions', async (t) => {
  const request = await deck(t);
  const before = (await request('/api/crons')).body;
  const id = before.active[0].id;

  assert.equal((await request(cronAction(id, 'pause'), {})).status, 200);
  const paused = (await request('/api/crons')).body;
  assert.equal(paused.active.some((job) => job.id === id), false);
  assert.equal(paused.paused.find((job) => job.id === id).next_run_at, null);
  assert.deepEqual(paused.counts, {
    ...before.counts, active: before.counts.active - 1, paused: before.counts.paused + 1,
  });
  assert.deepEqual(await request(cronAction(id, 'pause'), {}), {
    status: 409, body: { ok: false, error: 'already paused' },
  });

  assert.equal((await request(cronAction(id, 'resume'), {})).status, 200);
  const resumed = (await request('/api/crons')).body;
  assert.equal(resumed.active.find((job) => job.id === id).state, 'scheduled');
  assert.ok(Date.parse(resumed.active.find((job) => job.id === id).next_run_at) > Date.now());
  assert.deepEqual(resumed.counts, before.counts);
  assert.deepEqual(await request(cronAction(id, 'resume'), {}), {
    status: 409, body: { ok: false, error: 'already active' },
  });
});

test('mock deck: resuming a disabled cron makes it active', async (t) => {
  const request = await deck(t);
  const before = (await request('/api/crons')).body;
  const id = before.paused.find((job) => !job.enabled).id;

  assert.equal((await request(cronAction(id, 'resume'), {})).status, 200);
  const after = (await request('/api/crons')).body;
  assert.equal(after.paused.some((job) => job.id === id), false);
  const resumed = after.active.find((job) => job.id === id);
  assert.equal(resumed.enabled, true);
  assert.equal(resumed.state, 'scheduled');
});

test('mock deck: bad cron actions and unknown ids leave the feed unchanged', async (t) => {
  clock(t);
  const request = await deck(t);
  const before = (await request('/api/crons')).body;
  for (const [id, act, status, error] of [
    ['not-an-id', 'pause', 400, 'bad input'],
    [before.active[0].id, 'delete', 400, 'bad input'],
    ['ffffffff', 'pause', 404, 'unknown job'],
  ]) {
    assert.deepEqual(await request(cronAction(id, act), {}), { status, body: { ok: false, error } });
  }
  assert.deepEqual((await request('/api/crons')).body, before);
});

test('mock deck: a gateway failure does not change cron state', async (t) => {
  clock(t);
  const request = await deck(t, { cronFail: true });
  const before = (await request('/api/crons')).body;
  for (const act of ['pause', 'resume', 'run']) {
    assert.deepEqual(await request(cronAction(before.active[0].id, act), {}), {
      status: 502, body: { ok: false, error: 'hermes gateway unreachable' },
    });
  }
  assert.deepEqual((await request('/api/crons')).body, before);
});

test('mock deck: invalid messages create no run and the 2000-character boundary is accepted', async (t) => {
  const request = await deck(t);
  for (const text of [undefined, null, 42, '', ' \n\t ', 'x'.repeat(2001)]) {
    assert.deepEqual(await request('/api/run-send', { text }), {
      status: 400, body: { ok: false, error: 'bad text' },
    });
  }
  assert.deepEqual(await request('/api/run-last'), {
    status: 404, body: { ok: false, error: 'no run' },
  });
  const sent = await request('/api/run-send', { text: 'x'.repeat(2000) });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.mode, 'new');
  assert.equal((await request('/api/run-last')).body.run_id, sent.body.run_id);
});

test('mock deck: run output becomes visible at the queued, running and done boundaries', async (t) => {
  const advance = clock(t);
  const request = await deck(t);
  const sent = await request('/api/run-send', { text: '  Check the fixture  ' });
  const route = `/api/run?id=${sent.body.run_id}`;
  const queued = (await request(route)).body;
  assert.equal(queued.state, 'queued');
  assert.deepEqual(queued.lines, []);
  advance(599);
  assert.equal((await request(route)).body.state, 'queued');
  advance(1);
  const running = (await request(route)).body;
  assert.equal(running.state, 'running');
  assert.deepEqual(running.lines, ['tool read_file: SKILL.md']);
  advance(1799);
  assert.equal((await request(route)).body.state, 'running');
  advance(1);
  const done = (await request(route)).body;
  assert.equal(done.state, 'done');
  assert.equal(done.detail, 'completed');
  assert.deepEqual(done.lines, [
    'tool read_file: SKILL.md', 'Mock reply (new) to: Check the fixture', `session ${queued.session_id}`,
  ]);
  advance(10000);
  const later = (await request(route)).body;
  assert.equal(later.elapsed_s, done.elapsed_s);
  assert.equal(later.updated_at, done.updated_at);
});

test('mock deck: active messages steer the run and completed messages reply in the same session', async (t) => {
  const advance = clock(t);
  const request = await deck(t);
  const first = (await request('/api/run-send', { text: 'Start' })).body;
  const firstRoute = `/api/run?id=${first.run_id}`;
  const session = (await request(firstRoute)).body.session_id;
  for (const [text, elapsed] of [['While queued', 0], ['While running', 600]]) {
    advance(elapsed);
    const steered = await request('/api/run-send', { text, run_id: first.run_id });
    assert.equal(steered.status, 200);
    assert.equal(steered.body.mode, 'steer');
    assert.equal(steered.body.run_id, first.run_id);
    assert.ok((await request(firstRoute)).body.lines.includes(`steer: ${text}`));
  }
  advance(1800);
  const reply = await request('/api/run-send', { text: 'Follow up', run_id: first.run_id });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.mode, 'reply');
  assert.notEqual(reply.body.run_id, first.run_id);
  assert.equal((await request('/api/run-last')).body.run_id, reply.body.run_id);
  advance(2400);
  const result = (await request(`/api/run?id=${reply.body.run_id}`)).body;
  assert.equal(result.session_id, session);
  assert.deepEqual(result.lines, [
    'tool read_file: SKILL.md', 'Mock reply (reply) to: Follow up', `session ${session}`,
  ]);
});

test('mock deck: an unknown run cannot be read or replied to', async (t) => {
  const request = await deck(t);
  assert.deepEqual(await request('/api/run?id=missing'), {
    status: 404, body: { ok: false, error: 'run not found' },
  });
  assert.deepEqual(await request('/api/run-send', { text: 'Follow up', run_id: 'missing' }), {
    status: 404, body: { ok: false, error: 'unknown run' },
  });
  assert.equal((await request('/api/run-last')).status, 404);
});
