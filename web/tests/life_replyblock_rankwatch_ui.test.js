// node --test tests/life_replyblock_rankwatch_ui.test.js
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const a = src.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const b = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
assert.ok(a >= 0 && b > a, 'helper block markers present');
const D = new Function(src.slice(a, b) + '\nreturn DeckUI;')();

const NOW = Date.UTC(2026, 9, 29, 16, 0, 0);
const T = (agoS) => NOW / 1000 - agoS;
const base = { t: T(3600), age: 3600, stale: false, refresh: 86400, errors: [] };

const rb = (o) =>
  Object.assign(
    {
      ...base,
      src: '~/.meshvault/status/deck/replyblock.json',
      date: '2026-10-29',
      card_for: '09:00',
      mode: 'run',
      model: { used: true, id: 'local', note: '' },
      counts: { waiting: 3, drafted: 2, cap: 15, over_cap: 1, gmail_drafts_before: 208, gmail_drafts_after: 210 },
      drafts_url: 'https://mail.google.com/mail/u/0/#drafts',
      items: [
        { rank: 1, name: 'Casey Harbor', subject: 'Quote for 12 seats', drafted: true, draft_mode: 'model', draft_url: 'https://mail.google.com/mail/u/0/#drafts/r-123456', thread_url: 'https://mail.google.com/mail/u/0/#inbox/1a0b5aff' },
        { rank: 2, name: 'Lane Quill', subject: 'Re: Dinner plans', drafted: true, draft_mode: 'template', draft_url: 'https://mail.google.com/mail/u/0/#drafts', thread_url: 'https://mail.google.com/mail/u/0/#inbox/1a0b5bbb' },
        { rank: 3, name: 'Pat <b>Evil</b>', subject: 'x', drafted: false, note: 'over daily cap', thread_url: 'https://evil.example/phish' },
      ],
    },
    o,
  );

// Today v3 (2026-11-14): the reply block is one Needs you row ("2 reply drafts ready"); since the restore (2026-11-15) it opens the reply sheet
// with each thread (tests/today_restore.test.js). The page row itself carries no names, subjects or message text.
const needs = (r) => D.tdNeeds({ products: { t: T(60), errors: [], needs: [] }, testflight: { apps: [] }, schedules: { groups: [] }, today: { gateway: { ok: true }, mail: { mailboxes: [] } }, replyblock: r });
test('reply drafts are one Needs you row with the count that opens the reply sheet; no names, subjects or message text', () => {
  const n = needs(rb({ items: [{ rank: 1, name: 'Casey', subject: 'Quote', drafted: true, body: 'SECRET BODY', preview: ['SECRET PREVIEW'] }] }));
  assert.deepEqual(n.items.map((x) => [x.sev, x.text, x.open]), [['med', '2 reply drafts ready', 'today-reply']]);
  assert.doesNotMatch(D.tdReplySheet(rb({ items: [{ rank: 1, name: 'Casey', subject: 'Quote', drafted: true, body: 'SECRET BODY', preview: ['SECRET PREVIEW'] }] })), /SECRET/, 'the sheet never shows message text either');
  const html = D.tdNeedsHtml(n, []);
  assert.doesNotMatch(html, /SECRET|Casey|Quote/);
  assert.equal(D.gmailUrl('https://mail.google.com/mail/u/0/#drafts/r1'), 'https://mail.google.com/mail/u/0/#drafts/r1');
  assert.equal(D.gmailUrl('https://mail.google.com.evil.io/mail/u/0/#drafts'), '');
  assert.equal(D.gmailUrl('javascript:alert(1)'), '');
});

test('no drafts, a dry run or missing counts add no row and never a zero; a missing feed joins the checks row', () => {
  for (const r of [rb({ counts: { waiting: 0, drafted: 0 } }), rb({ mode: 'dry-run' }), rb({ counts: null })]) assert.deepEqual(needs(r).items, []);
  assert.doesNotMatch(D.tdNeedsHtml(needs(rb({ counts: null })), []), /\b0 /);
  assert.deepEqual(needs({ error: 'file missing', stale: true }).miss.map((m) => m.name), ['Reply drafts']);
  const evil = rb({ drafts_url: 'https://evil.example/drafts' });
  assert.equal(needs(evil).items[0].url, undefined, 'the row opens the sheet, never a feed URL');
  assert.doesNotMatch(D.tdReplySheet(evil), /evil\.example/);
});

const rw = (o) =>
  Object.assign(
    {
      ...base,
      src: '~/.meshvault/status/deck/rankwatch.json',
      day: '2026-10-29',
      run: { ok_charts: 14, failed_charts: 1 },
      counts: { apps: 9, live: 2, alerts_today: 1, alerts_7d: 4 },
      alerts: [
        { day: '2026-10-29', kind: 'own_entered', severity: 'good', name: 'Mesh', text: 'Mesh entered Productivity top free at #80.' },
        { day: '2026-10-29', kind: 'jump', severity: 'warn', name: 'Rival', text: 'Rival moved 25 places in Productivity.' },
        { day: '2026-10-28', kind: 'new_entrant', severity: 'warn', name: 'Newcomer', text: 'New in Productivity at #12.' },
        { day: '2026-10-27', kind: 'own_live', severity: 'good', name: 'Dictate', text: 'Dictate is visible in the store.' },
      ],
    },
    o,
  );

// 2026-11-01: Rank watch moved to Home > Dev under App builds. 2026-11-14: the reply block card left Today; Today reads replyblock for one row.
test('Rank watch paints on Home > Dev; Work paints neither card; Today reads the reply block feed', () => {
  const work = src.slice(src.indexOf('// ---- Work > Jobs and Work > Gigs'), src.indexOf('// ---- end Work ----'));
  assert.ok(work.length > 1000);
  assert.doesNotMatch(work, /replyBlock|rankWatch|'replyblock'|'rankwatch'/);
  assert.match(src, /replyblock:'replyblock'/);
  // 2026-11-14: Rank watch is a section of the Dev page (DeckUI.devPage), after App builds, Pull requests and Vercel
  const page = D.devPage({ t: NOW / 1000, github: {}, vercel: { projects: [] }, supabase: { projects: [] } }, NOW, { apps: [] }, rw({}));
  assert.ok(page.indexOf('>App builds<') < page.indexOf('>Rank watch<'), 'Rank watch sits after App builds');
  assert.match(D.devPage(null, NOW, { apps: [] }, { error: 'file missing' }), /data-k="rank"[^]*data-retry="dev"/);
});
