// Synthetic deck data for browser proof. Nothing here is owner account state.
import zlib from 'node:zlib';

export const now = () => Math.floor(Date.now() / 1000);
const feed = (o) => ({ t: now(), refresh: 300, stale: false, src: 'fixture (synthetic)', errors: [], ...o });

export function png(w = 320, h = 180, seed = 1) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const i = 1 + x * 3;
      const sq = x > 90 + seed * 12 && x < 150 + seed * 12 && y > 50 && y < 110;
      row[i] = sq ? 250 : 40 + Math.floor((x / w) * 160);
      row[i + 1] = sq ? 190 : 70 + Math.floor((y / h) * 120);
      row[i + 2] = sq ? 60 : 120 + seed * 20;
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const iso = (s) => new Date(s * 1000).toISOString().replace(/\.\d+Z$/, 'Z');

export function cronJobs() {
  const t = now();
  const mk = (id, name, sched, enabled, last, next, provider, model, lastAgo) => ({
    id: id + '00112233445566778899aabbccdd', name, schedule_display: sched, state: enabled ? 'scheduled' : 'paused', enabled,
    provider, model, last_run_at: lastAgo == null ? null : iso(t - lastAgo), last_status: last, next_run_at: next == null ? null : iso(t + next),
    prompt: 'SYNTHETIC PROMPT never shown', script: null,
  });
  return [
    mk('2b23e296', 'Fixture: engagement watch', 'every 30m', true, 'ok', 240, 'openai-codex', 'gpt-6-luna', 1560),
    mk('cb6ee122', 'Fixture: photos intake', '0 21 * * *', true, 'ok', 3480, 'openai-codex', 'gpt-6-luna', 28800),
    mk('a39b7d8b', 'Fixture: evening wrap', '0 21 * * *', true, 'ok', 3480, 'openai-codex', 'gpt-6-luna', 28800),
    mk('f8583e3b', 'Fixture: auto-post 8pm', '0 20 * * *', true, 'blocked_config', 960, 'anthropic', 'claude-sonnet-5-5', 28800),
    mk('54c3bc8e', 'Fixture: network security', 'every 15m', true, 'error', 900, null, null, 100800),
    mk('4b6b12a7', 'Fixture: github green', '0 8,20 * * *', true, 'ok', 960, 'openai-codex', 'gpt-6.1-sol', 25200),
    mk('af52e3e7', 'Fixture: important mail monitor', '0 8-20/3 * * *', true, 'ok', 960, 'openai-codex', 'gpt-6-luna', 10800),
    mk('c0ff721f', 'Fixture: apple apps testflight', 'every 60m', false, null, null, null, null, null),
    mk('232e018d', 'Fixture: morning priority', '50 6 * * 1-5', false, 'ok', null, 'openai-codex', 'gpt-6-luna', 950400),
    mk('ab9273e9', 'Fixture: cold email sender', '13 * * * *', false, 'ok', null, 'openai-codex', 'gpt-6-luna', 864000),
    mk('35c1c984', 'Fixture: commerce daily watch', '40 8 * * *', false, 'ok', null, 'openai-codex', 'gpt-6-luna', 864000),
    mk('f60d506c', 'Fixture: weekly audit', '50 10 * * 0', false, null, null, 'openai-codex', 'gpt-6-luna', null),
  ];
}

// Same shape /api/crons returns (rust/src/crons.rs from_text). Lane is derived like the server.
export function cronsFeed(jobs) {
  const lane = (p, m) => { const a = (p || '').toLowerCase(), b = (m || '').toLowerCase(); if (!a && !b) return 'NO MODEL'; if (a.includes('anthropic') || a.includes('claude') || b.includes('claude')) return 'CLAUDE'; if (a.includes('codex') || a.includes('openai') || b.startsWith('gpt-')) return 'CODEX'; return 'OTHER'; };
  const row = (j) => ({ name: j.name, id: j.id.slice(0, 8), schedule_display: j.schedule_display, state: j.state, enabled: j.enabled, provider: j.provider, model: j.model, lane: lane(j.provider, j.model), last_run_at: j.last_run_at, last_status: j.last_status, next_run_at: j.next_run_at });
  const active = jobs.filter((j) => j.enabled && j.state !== 'paused').map(row);
  const paused = jobs.filter((j) => !(j.enabled && j.state !== 'paused')).map(row);
  const last_failed = active.filter((j) => j.last_status && j.last_status !== 'ok').length;
  return { active, paused, counts: { active: active.length, paused: paused.length, total: jobs.length, last_failed }, src: '~/.hermes/cron/jobs.json', t: now(), file_t: now() - 60 };
}

// ~/.meshvault/status/deck/gitsync.json: local tracking-ref estimates, never remote verification.
export function gitsyncBoard(t) {
  return { src: '~/.meshvault/status/deck/gitsync.json', t, age: 60, stale: false, refresh: 1800, basis: 'local tracking refs; no fetch or GitHub verification',
    hosts: [
      { host: 'pc-desktop', label: 'Desktop', checkouts: 214, repos: 190, own_repos: 152, clean: 140, unpushed: 0, no_remote: 0, dirty: 3, third_party: 38, unknown: 0, stale_s: 0, at: t - 60 },
      { host: 'mac-mini', label: 'Mac mini', checkouts: 31, repos: 27, own_repos: 23, clean: 20, unpushed: 3, no_remote: 0, dirty: 0, third_party: 4, unknown: 0, stale_s: 0, at: t - 50 },
      { host: 'dell', label: 'Dell', checkouts: null, repos: null, own_repos: null, clean: null, unpushed: null, no_remote: null, dirty: null, third_party: null, unknown: null, stale_s: null, at: null, error: 'unreachable' },
    ],
    unpushed: [
      { host: 'mac-mini', repo: 'projects/meshvault/ios-app', branch: 'premium/deck-20261005', ahead: 4 },
      { host: 'mac-mini', repo: 'projects/meshvault/pixel-deck', branch: 'main', ahead: 2 },
      { host: 'mac-mini', repo: 'work/scratch/notes', branch: 'main', ahead: 1 },
    ] };
}

export function fleetBoard() {
  const t = now();
  return {
    machines: { t, stale: false, items: [
      { name: 'pc-desktop', reachable: true, drives: [{ label: 'System', used_gb: 896, free_gb: 51, pct: 95 }, { label: 'disk-m2', used_gb: 1570, free_gb: 89, pct: 95 }] },
      { name: 'Spark', reachable: true, drives: [{ label: 'System', used_gb: 3530, free_gb: 37, pct: 99 }] },
      { name: 'Ascent', reachable: true, drives: [{ label: 'System', used_gb: 843, free_gb: 26, pct: 97 }] },
      { name: 'Dell', reachable: true, drives: [{ label: 'System', used_gb: 354, free_gb: 117, pct: 75 }] },
      { name: 'Mac mini', reachable: true, drives: [{ label: 'Macintosh HD', used_gb: 411, free_gb: 50, pct: 89 }] } ] },
    cluster: { ok: true, model: 'fixture-model', running: 2, waiting: 0, kv_cache_pct: 36.6, src: 'live http://127.0.0.1:8080/v1/metrics', t, bench: { error: 'file missing', src: 'cluster-bench-*.json' } },
    models: { t, devices: [{ device: 'Spark', models: ['fixture-model'] }, { device: 'Ascent', models: ['fixture-model'] }] },
    backup: gitsyncBoard(t),
    units: { t, stale: false, writer_ok: true, failed_units: ['fleet-health-check.service', 'glm-recipes-daily.service', 'mcp-liveness-sweep.service'] },
  };
}

export function jobsFeed() {
  const t = now();
  const mk = (title, company, loc, site, score, ago, url) => ({ title, company, location: loc, remote: null, salary: null, site, url, posted_at: t - ago, score });
  const listings = [
    mk('Senior AI Infrastructure Engineer', 'Example Corp', 'Costa Mesa, CA', 'linkedin', 87, 3600 * 6, 'https://www.linkedin.com/jobs/view/1'),
    mk('Staff Engineer, Distributed Systems', 'Sample Labs', 'Remote', 'ashby', 86, 3600 * 20, 'https://jobs.ashbyhq.com/sample/2'),
    mk('Machine Learning Infrastructure', 'Fixture AI', 'Los Angeles, CA', 'greenhouse', 84, 3600 * 40, 'https://job-boards.greenhouse.io/fixture/jobs/3'),
    mk('Software Engineer, Platform', 'Demo Industries', 'Newport Beach, CA', 'linkedin', 83, 3600 * 70, 'https://www.linkedin.com/jobs/view/4'),
    mk('Senior Backend Engineer', 'Placeholder Inc', 'Irvine, CA', 'lever', 80, 3600 * 90, 'https://jobs.lever.co/placeholder/5'),
  ];
  return feed({ listings, by_site: { linkedin: 2, ashby: 1, greenhouse: 1, lever: 1 } });
}

export const hockeyFeed = () => feed({ live: [], teams: [
  { abbr: 'ANA', name: 'Ducks', record: '1-0-0', points: 2, standing: '1st Pacific', last_game: { result: 'W', score: '4-2', opp: 'SJS' }, next_game: { opp: 'FLA', at: now() + 3600 * 22, tv: 'KCOP-13', gc: '/gamecenter/fla-vs-ana/2026/10/04/2026020037', home: true, type: 'reg' } },
  { abbr: 'LAK', name: 'Kings', record: '0-1-0', points: 0, standing: '8th Pacific', last_game: { result: 'L', score: '1-3', opp: 'VGK' }, next_game: { opp: 'FLA', at: now() + 3600 * 46, tv: 'ESPN', gc: '/gamecenter/fla-vs-lak/2026/10/06/2026020052', home: true, type: 'reg' } } ] });

export const surfFeed = () => feed({ spots: [
  { name: 'Salt Creek', period_s: 15, swell_dir_deg: 225, wind_kt: 5, wind_dir_deg: 0, water_temp_f: 73, wave_ft_min: 2, wave_ft_max: 2, rating: 'fair' },
  { name: 'Strands', period_s: 15, swell_dir_deg: 225, wind_kt: 5, wind_dir_deg: 0, water_temp_f: 73, wave_ft_min: 2, wave_ft_max: 2, rating: 'fair' } ],
  tide: { station: 'Fixture Pier', next: [{ type: 'H', at: now() + 3600 * 4, ft: 3.1 }] } });

export const realestateFeed = () => feed({ market: { area: 'Fixture Point', median_list_price: 2000000, source: 'fixture', at: now() - 3600 },
  homes: [
    { price: 175000, addr: '1 Fixture Way', city: 'Capistrano Beach', beds: 2, baths: 2, sqft: 1100, source: 'redfin', listed_at: now() - 7200, url: 'https://www.redfin.com/CA/fixture/1' },
    { price: 285000, addr: '2 Sample Ct', city: 'Huntington Beach', beds: 1, baths: 1, sqft: 858, source: 'redfin', listed_at: now() - 9000, url: 'https://www.redfin.com/CA/fixture/2' } ],
  commercial: [] });

export const marketsToday = () => ({ items: [
  { source: 'MarketWatch Top Stories', title: 'Fixture headline one: markets move on synthetic news', at: now() - 3 * 3600, url: 'https://www.marketwatch.com/story/fixture-one' },
  { source: 'CNBC Top News', title: 'Fixture headline two with a link', at: now() - 4 * 3600, url: 'https://www.cnbc.com/2026/10/04/fixture-two.html' },
  { source: 'The Economist', title: 'Fixture headline three has no link', at: now() - 5 * 3600 } ], src: 'newswire.db finance feeds (read-only sqlite3)', t: now() });

export function todayFeed() {
  const t = now();
  return { t, gateway: { ok: true, t, src: 'gateway /health' }, mail: { mailboxes: [{ ok: true, unread: 3 }], status: 'ok', t, src: 'fixture' },
    cron: { next: [{ name: 'Fixture: engagement watch', at: t + 240 }], enabled: 7, paused: 5, failing: ['Fixture: network security'], t, src: 'jobs.json' },
    markets: marketsToday(), whoop: { error: 'not in fixture', src: 'fixture' }, unavailable: [] };
}

// Synthetic launch list with plain names and areas. Area names and order are whatever the feed says; the page has none of its own.
const L = (id, name, label, does, area, ao, tier, score, extra = {}) => ({ id: 'skill:' + id, kind: 'skill', name, label, does, area, ao, earns: ao === 0, desc: 'Trigger text for agents', group: 'other', arg: name, targets: ['hermes'], tier, score, where: ['hermes'], why: '', ...extra });
export const launchFeed = () => feed({ items: [
  L('x-posting', 'x-posting', 'Posts for the brand', 'Drafts and posts short updates for you to approve.', 'Sales', 0, 'core', 90, { why: 'Used daily' }),
  L('cold-outreach', 'fixture-cold-email-pipeline', 'Cold email outreach', 'Finds prospects and drafts cold emails for you to approve.', 'Sales', 0, 'useful', 70),
  L('gig-sweep', 'fixture-gig-lead-sweep', 'Gig lead search', 'Looks over public job boards for work you can bid on.', 'Sales', 0, 'useful', 65),
  L('dev-engineering', 'dev-engineering', 'Build and fix our apps', 'Helps write, test and ship code for the company products.', 'Company', 1, 'core', 88),
  L('site-check', 'fixture-site-check', 'Website health check', 'Visits each company site and reports anything broken.', 'Company', 1, 'useful', 55),
  L('bill-alerts', 'fixture-finance-alerts-ops', 'Bill and money alerts', 'Warns you before bills are due and when money moves.', 'Money', 2, 'core', 80),
  L('social-inbox', 'social-inbox', 'Check messages and mail', 'Looks over your inbox and lists what needs an answer.', 'Life', 3, 'useful', 70),
  L('camera-recap', 'fixture-camera-recap', 'Overnight camera recap', 'Lists what the cameras saw overnight.', 'House', 4, 'niche', 35),
  L('cluster-gauge', 'fixture-cluster-gauge', 'Local AI model health', 'Shows whether the local AI models are up and how fast they answer.', 'Computers', 5, 'useful', 60, { where: ['hermes', 'dell'] }),
  L('deck-markets', 'fixture-deck-feed-markets', 'Market prices', 'Updates stock and crypto prices on your Deck every 5 minutes.', 'Behind the scenes', 6, 'core', 75, { kind: 'automation', id: 'automation:timer-fixture-deck-feed-markets', targets: [] }),
  L('old-thing', 'fixture-old-thing', 'Old helper nobody uses', 'No description yet.', 'Computers', 5, 'dead', 5) ] });

export const productsFeed = () => feed({ products: [], app_store: { version: { string: '1.0', state: 'PREPARE_FOR_SUBMISSION', build: 6 }, review: {}, latest_build: { number: 6, state: 'VALID', uploaded: now() - 3600 } }, needs: [] });

export const clusterFeed = () => feed({ engine: { status: 'up', served_name: 'fixture-model', container: 'ctn', max_model_len: 131072, port: 8080, up_since: now() - 86400 }, proxy: { pc_desktop_8080_up: true, models: ['fixture-model'] }, bench: { prose_tps: 23.9, code_tps: 34.5, conc6_tps: 69.8, prefill_tps: 1508, at: '2026-09-30' }, ratchet: { last_outcome: 'rejected', last_date: '2026-10-04', next_run: now() + 3600 }, nodes: [], candidates: [] });

export const devFeed = () => feed({ github: { open_prs: [{ repo: 'fixture/repo', num: 12, title: 'Fixture PR with a link', ci: 'pass', url: 'https://github.com/fixture/repo/pull/12' }], failing_main: [], at: now() - 600 }, vercel: { projects: [] }, supabase: { projects: [] }, herdr: { tabs: [], agents_busy: 0 }, chromium: { cdp_up: true, tabs: 3 }, grok: { build_cli: '1.0', logged_in: true } });

export const accountsFeed = () => feed({ onepassword: { hosts: [] }, drives: [], apple: { mini_reachable: true, library: {}, events_today: [], bills_due: [] }, composio: null, mcp: { omp: null, hermes: null }, dev_auth: {} });

// All crons (static/schedules.js reads it; the Agents page reads its failed and overdue jobs): two bad jobs and one good one
export const schedulesFeed = () => feed({ counts: { total: 3, failing: 2, running: 0, never: 0, paused: 0, sources_down: 0, next_run: now() + 120 }, groups: [{ id: 'hermes', label: 'Hermes jobs', host: 'pc-desktop', kind: 'hermes', ok: true, error: null, n: 3, jobs: [
  { id: 'hermes:a1', name: 'Fixture: network security', host: 'pc-desktop', kind: 'hermes', schedule: 'every 15m', enabled: true, last: now() - 800, next: now() + 120, result: 'failed', detail: 'error' },
  { id: 'hermes:a2', name: 'Fixture: asc-watch', host: 'dell', kind: 'systemd', schedule: 'every 10m', enabled: true, last: now() - 86400 * 3, next: now() + 60, result: 'overdue', detail: 'no scheduled run for 3d' },
  { id: 'hermes:a3', name: 'Fixture: engagement watch', host: 'pc-desktop', kind: 'hermes', schedule: 'every 30m', enabled: true, last: now() - 600, next: now() + 1200, result: 'ok', detail: '' }] }] });

// Workspaces 1 to 5 with the apps on each (helper.py ws-list): the second is current
export const wsList = () => ({ ok: true, active: 2, ws: [{ id: 1, n: 5, apps: ['Chromium', 'Ghostty', 'Firefox'], more: 1 }, { id: 2, n: 2, apps: ['Spotify', 'Obsidian'], more: 0 }, { id: 3, n: 0, apps: [], more: 0 }, { id: 4, n: 1, apps: ['Nautilus'], more: 0 }, { id: 5, n: 0, apps: [], more: 0 }], other: { n: 1, apps: ['Mirror'], more: 0 } });

export const FEEDS = { jobs: jobsFeed, hockey: hockeyFeed, surf: surfFeed, realestate: realestateFeed, launch: launchFeed, products: productsFeed, cluster: clusterFeed, dev: devFeed, accounts: accountsFeed, schedules: schedulesFeed, perfloop: () => feed({ enabled: false, stop: false, runs_today: { total: 0 } }), car: () => feed({ battery: 39, range: 109, locked: true, charging: 'Disconnected', charge_limit: 80 }) };
