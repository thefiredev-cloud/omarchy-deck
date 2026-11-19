// node --test tests/qa_fixtures.test.js  (qa/fixtures.mjs: the synthetic PNG writer and the cron feed lane rule; pure functions, no network, no files)
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// Split a PNG into chunks, keeping the CRC the file carries and the CRC recomputed over type + data.
function readChunks(buf) {
  const out = [];
  let p = SIGNATURE.length;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    const crc = buf.readUInt32BE(p + 8 + len);
    out.push({ type, data, crc, expected: zlib.crc32(buf.subarray(p + 4, p + 8 + len)) >>> 0 });
    p += 12 + len;
  }
  return out;
}

const job = (over) => ({
  id: '0123456789abcdef0123456789abcdef', name: 'Fixture job', schedule_display: 'every 5m', state: 'scheduled', enabled: true,
  provider: null, model: null, last_run_at: null, last_status: 'ok', next_run_at: null, ...over,
});

test('fixtures png: a decodable 8-bit RGB PNG at the requested size', async () => {
  const F = await import('../qa/fixtures.mjs');
  const buf = F.png(40, 30, 2);

  assert.deepEqual([...buf.subarray(0, 8)], SIGNATURE);
  const chunks = readChunks(buf);
  assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
  for (const c of chunks) assert.equal(c.crc, c.expected, `${c.type} CRC`);

  const ihdr = chunks[0].data;
  assert.equal(ihdr.readUInt32BE(0), 40, 'width');
  assert.equal(ihdr.readUInt32BE(4), 30, 'height');
  assert.equal(ihdr[8], 8, 'bit depth');
  assert.equal(ihdr[9], 2, 'colour type RGB');

  const raw = zlib.inflateSync(chunks[1].data);
  assert.equal(raw.length, 30 * (1 + 40 * 3), 'one filter byte plus RGB per pixel, every row');
  for (let y = 0; y < 30; y++) assert.equal(raw[y * (1 + 40 * 3)], 0, `row ${y} filter byte`);
});

test('fixtures cronsFeed: lane follows the server rule for provider and model', async () => {
  const F = await import('../qa/fixtures.mjs');
  const cases = [
    [{ provider: 'anthropic', model: 'claude-sonnet-5-5' }, 'CLAUDE'],
    [{ provider: 'openrouter', model: 'claude-haiku-5-5' }, 'CLAUDE'],
    [{ provider: 'openai-codex', model: 'gpt-6-luna' }, 'CODEX'],
    [{ provider: 'other-host', model: 'GPT-6.1-Sol' }, 'CODEX'],
    [{ provider: 'xai', model: 'grok-4.7' }, 'OTHER'],
    [{ provider: null, model: null }, 'NO MODEL'],
    [{ provider: '', model: '' }, 'NO MODEL'],
  ];
  for (const [over, lane] of cases) {
    const feed = F.cronsFeed([job(over)]);
    assert.equal(feed.active[0].lane, lane, JSON.stringify(over));
  }
});

test('fixtures cronsFeed: rows carry the first 8 id chars and paused jobs are counted apart', async () => {
  const F = await import('../qa/fixtures.mjs');
  const jobs = [
    job({ name: 'running ok' }),
    job({ name: 'running failed', last_status: 'error' }),
    job({ name: 'disabled', enabled: false, state: 'paused', last_status: 'error' }),
    job({ name: 'paused state', enabled: true, state: 'paused' }),
  ];
  const feed = F.cronsFeed(jobs);

  assert.deepEqual(feed.active.map((r) => r.name), ['running ok', 'running failed']);
  assert.deepEqual(feed.paused.map((r) => r.name), ['disabled', 'paused state']);
  assert.equal(feed.active[0].id, '01234567');
  assert.deepEqual(feed.counts, { active: 2, paused: 2, total: 4, last_failed: 1 });
});

test('fixtures cronJobs: the seeded set yields 7 active jobs, 5 paused, and 2 failing active', async () => {
  const F = await import('../qa/fixtures.mjs');
  const feed = F.cronsFeed(F.cronJobs());
  assert.deepEqual(feed.counts, { active: 7, paused: 5, total: 12, last_failed: 2 });
});
test('fixtures schedulesFeed: counts match grouped outcomes and time fields are epoch seconds', async (t) => {
  const F = await import('../qa/fixtures.mjs');
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const feed = F.schedulesFeed();
  const jobs = feed.groups.flatMap((group) => group.jobs);

  assert.equal(feed.counts.total, jobs.length);
  assert.equal(feed.counts.failing, jobs.filter((entry) => ['failed', 'overdue'].includes(entry.result)).length);
  assert.equal(feed.counts.failing, 2);
  assert.deepEqual(jobs.map((entry) => entry.result), ['failed', 'overdue', 'ok']);
  assert.ok(jobs.every((entry) => entry.last < 1_900_000_000 && entry.next < 1_900_000_000));
  assert.ok(feed.counts.next_run < 1_900_000_000);
  now += 1000;
  assert.equal(F.schedulesFeed().groups[0].jobs[0].last - jobs[0].last, 1);
});

test('fixtures gitsyncBoard: unknown host stays unknown and unpushed values remain local estimates', async () => {
  const F = await import('../qa/fixtures.mjs');
  const board = F.gitsyncBoard(1_800_000_000);
  const dell = board.hosts.find((host) => host.host === 'dell');

  assert.match(board.basis, /local tracking refs; no fetch or GitHub verification/);
  assert.equal(dell.error, 'unreachable');
  for (const key of ['repos', 'own_repos', 'unpushed', 'no_remote', 'unknown']) assert.equal(dell[key], null);
  assert.deepEqual(board.unpushed.map(({ host, repo, ahead }) => [host, repo, ahead]), [
    ['mac-mini', 'projects/meshvault/ios-app', 4],
    ['mac-mini', 'projects/meshvault/pixel-deck', 2],
    ['mac-mini', 'work/scratch/notes', 1],
  ]);
});

test('fixtures wsList: active id identifies a listed workspace and empty workspaces stay empty', async () => {
  const F = await import('../qa/fixtures.mjs');
  const workspaces = F.wsList();

  assert.equal(workspaces.ok, true);
  assert.equal(workspaces.ws.find((workspace) => workspace.id === workspaces.active).id, 2);
  assert.deepEqual(workspaces.ws.map(({ id, n }) => [id, n]), [[1, 5], [2, 2], [3, 0], [4, 1], [5, 0]]);
  assert.deepEqual(workspaces.ws.find((workspace) => workspace.id === 3).apps, []);
  assert.deepEqual(workspaces.other.apps, ['Game']);
});

test('fixtures fleetBoard: every drive percentage follows its used and free space, and the backup board shares the timestamp', async () => {
  const F = await import('../qa/fixtures.mjs');
  const board = F.fleetBoard();

  assert.equal(new Set(board.machines.items.map((m) => m.name)).size, board.machines.items.length, 'machine names are unique');
  for (const machine of board.machines.items) {
    assert.ok(machine.drives.length > 0, machine.name);
    for (const d of machine.drives) assert.equal(d.pct, Math.round((d.used_gb / (d.used_gb + d.free_gb)) * 100), `${machine.name} ${d.label}`);
  }
  assert.equal(board.backup.t, board.machines.t);
  assert.deepEqual(board.models.devices.map((d) => d.device), ['Spark', 'Ascent']);
  assert.ok(board.units.failed_units.every((u) => u.endsWith('.service')));
});

test('fixtures jobsFeed: best score first, per-site counts match the listings and every posting is in the past', async () => {
  const F = await import('../qa/fixtures.mjs');
  const feed = F.jobsFeed();
  const tally = {};
  for (const l of feed.listings) tally[l.site] = (tally[l.site] || 0) + 1;

  assert.deepEqual(feed.by_site, tally);
  const scores = feed.listings.map((l) => l.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  for (const l of feed.listings) {
    assert.ok(l.posted_at < feed.t, l.title);
    assert.match(l.url, /^https:\/\//, l.title);
  }
});

test('fixtures launchFeed: ids are unique, only the first area earns, and automations are not launchable', async () => {
  const F = await import('../qa/fixtures.mjs');
  const { items } = F.launchFeed();

  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  for (const i of items) {
    assert.equal(i.earns, i.ao === 0, i.id);
    assert.ok(['core', 'useful', 'niche', 'dead'].includes(i.tier), `${i.id} tier ${i.tier}`);
  }
  const automations = items.filter((i) => i.kind === 'automation');
  assert.ok(automations.length > 0);
  for (const a of automations) {
    assert.match(a.id, /^automation:/);
    assert.deepEqual(a.targets, [], a.id);
  }
  for (const s of items.filter((i) => i.kind === 'skill')) assert.ok(s.targets.length > 0, s.id);
});

test('fixtures marketsToday and todayFeed: headlines run newest first, only the last has no link, whoop is reported as missing', async () => {
  const F = await import('../qa/fixtures.mjs');
  const today = F.todayFeed();
  const items = today.markets.items;

  assert.deepEqual(items.map((i) => i.at), [...items.map((i) => i.at)].sort((a, b) => b - a));
  assert.deepEqual(items.filter((i) => !i.url).map((i) => i.source), ['The Economist']);
  assert.ok(items.every((i) => i.at < today.t));
  assert.equal(today.whoop.error, 'not in fixture');
  assert.equal(today.cron.next[0].at - today.t, 240);
});

test('fixtures FEEDS: every feed carries the shared envelope with an epoch-seconds timestamp', async () => {
  const F = await import('../qa/fixtures.mjs');
  const before = F.now();

  for (const [name, make] of Object.entries(F.FEEDS)) {
    const f = make();
    assert.ok(Number.isInteger(f.t) && f.t >= before && f.t < 2e9, `${name} t`);
    assert.equal(f.stale, false, name);
    assert.ok(Array.isArray(f.errors) && f.errors.length === 0, `${name} errors`);
    assert.ok(f.refresh > 0, `${name} refresh`);
  }
  assert.deepEqual(Object.keys(F.FEEDS).sort(), ['accounts', 'car', 'cluster', 'dev', 'hockey', 'jobs', 'launch', 'perfloop', 'products', 'realestate', 'schedules', 'surf']);
});
