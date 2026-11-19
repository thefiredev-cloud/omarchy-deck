// Pad > Keys: the macro keys (app.js KEY ROWS helpers) and Connections (deck.js DeckUI.conn), design v3.
// Blueprint section 7: Connections lose per-row source lines; on TV the keys are a focus grid and a confirm key needs
// Enter twice within 3 s (a held OK on a remote repeats Enter, and a repeat never counts as the second press).
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('static/app.js'), deck = read('static/deck.js');
const block = (src, from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to);
  assert.ok(a >= 0 && b > a, 'markers ' + from);
  return src.slice(a, b);
};
const KEYROWS = vm.runInNewContext(block(app, '// ==== KEY ROWS HELPERS BEGIN', '// ==== KEY ROWS HELPERS END ====') + '\nKEYROWS;', {}, { timeout: 1000 });
const D = new Function(block(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();

const NOW = Date.UTC(2026, 10, 14, 20, 0, 0);
const feed = (o) => Object.assign({ src: '~/.meshvault/status/deck/accounts.json', t: NOW / 1000 - 30, age: 30, stale: false, refresh: 60, sources: [], errors: [] }, o);
const missing = { error: 'file missing', src: '~/.meshvault/status/deck/accounts.json', stale: true };
// what a person reads: diagnostic spans and tags removed
const vis = (h) => String(h).replace(/<span class="diag">[\s\S]*?<\/span>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('confirm keys: the first press arms, a second press inside 3 s fires, a late one arms again', () => {
  assert.equal(KEYROWS.ARM_MS, 3000);
  assert.equal(KEYROWS.confirmStep(null, 1000), 'arm', 'not armed: arm');
  assert.equal(KEYROWS.confirmStep(1000, 1000 + 2999), 'fire', 'inside 3 s: fire');
  assert.equal(KEYROWS.confirmStep(1000, 1000 + 3000), 'arm', 'at 3 s the arm has run out');
  assert.equal(KEYROWS.confirmStep(1000, 900), 'arm', 'a clock that went backwards never fires');
});

test('a held Enter (key repeat) is never the second press; a fresh Enter and other keys pass', () => {
  assert.equal(KEYROWS.freshEnter({ key: 'Enter', repeat: true }), false);
  assert.equal(KEYROWS.freshEnter({ key: 'Enter', repeat: false }), true);
  assert.equal(KEYROWS.freshEnter({ key: ' ', repeat: true }), true);
  assert.equal(KEYROWS.freshEnter(null), true);
});

test('every key button refuses a repeated Enter and asks for a second press in the right words', () => {
  const kb = block(app, 'function keyBtn(', '// ==== KEY ROWS HELPERS BEGIN');
  assert.match(kb, /addEventListener\('keydown',e=>\{if\(!KEYROWS\.freshEnter\(e\)\)e\.preventDefault\(\)\}\)/);
  assert.match(kb, /KEYROWS\.confirmStep\(/);
  assert.match(kb, /'Press again':'Tap again'/, 'a TV says press, a touch screen says tap');
});

test('the key grid is CSS: no JS measures or sizes a key row', () => {
  for (const name of ['fitKeys', 'watchKeys', 'wordNeed', 'keyObs', 'gridTemplateColumns', 'gridAutoRows', "'--kf'"]) assert.ok(!app.includes(name), name + ' is gone');
  assert.equal(KEYROWS.layout, undefined);
  assert.equal(KEYROWS.fit, undefined);
});

const acc = feed({
  onepassword: { hosts: [{ host: 'mesh', op_cli: null, token_ok: null, vault: 'Hermes', items: null }, { host: 'mac-mini', op_cli: '2.39.0', token_ok: false, items: 372 }] },
  drives: [{ remote: 'gdrive', kind: 'gdrive', ok: false }, { remote: 'onedrive', kind: 'onedrive', ok: true, used_gb: 31.1, free_gb: 1073.7 }],
  apple: { mini_reachable: true, imessage_unread: 0, notes_recent_7d: 3, photos_recent_7d: null, reminders_open: 2, calendar_today: 1,
    library: { account: 'a@b.c', notes: 340, photos: 13852, calendars: 11, wallet_passes: 33, contacts: true, messages: true, icloud_drive: false, wallet: true } },
  composio: { active: 1, expired: 4, toolkits: [{ toolkit: 'gmail', active: 1, expired: 1, aliases: [{ alias: 'tanner', status: 'ACTIVE' }, { alias: 'tanner-mv', status: 'EXPIRED' }] },
    { toolkit: 'linkedin', active: 0, expired: 3, aliases: [] }] },
  mcp: { omp: { declared: 52, enabled: 48, stdio: 20, http: 28, oauth: 14, signed_in: 13, unreachable: [], auth_needed: ['figma'] }, hermes: null },
  dev_auth: { github: { ok: true, account: 'thefiredev-cloud' }, vercel: { ok: true, projects: 6, mcp_signed_in: false }, supabase: { ok: false, projects: null, mcp_signed_in: true } },
});

test('connections: no source, age or diagnostic line on any row or title', () => {
  const [a, b] = D.conn(acc, NOW), all = a + b;
  assert.doesNotMatch(all, /class="diag"/, 'no diagnostic spans');
  assert.doesNotMatch(vis(all), /Updated|ago|just now|Vault Hermes|op 2\.39|Remote |Address book|Passes only|File names only|readable|\.json/i);
  // section titles carry the title and, at most, a count
  for (const m of all.matchAll(/<h2 class="secttl">([\s\S]*?)<\/h2>/g)) assert.doesNotMatch(m[1], /Updated|ago|Out of date/);
  assert.equal((all.match(/<section class="sect">/g) || []).length, 6, '1Password, Developer sign-in, Tools, Apple, Drives, Connected services');
});

test('connections: the facts stay, unknown stays --, and status is a mark plus a word', () => {
  const [a, b] = D.conn(acc, NOW);
  assert.match(vis(a), /Dell -- items Unknown/);
  assert.match(a, /<b>Mac mini<\/b><small>372 items<\/small><\/span><span class="fr"><span class="pill bad"><i class="sd bad"><\/i>Needs sign-in<\/span>/);
  assert.match(vis(a), /OMP tools 48 of 52 on · 13 of 14 signed in · Sign in: figma 1 need sign-in/);
  assert.match(vis(a), /Hermes tools Settings could not be read Not reporting/);
  assert.match(vis(a), /Vercel 6 projects · Tools signed out Connected/);
  assert.match(vis(a), /Supabase Tools signed in Not connected/);
  assert.match(vis(b), /Photos -- added this week 13,852/);
  assert.match(vis(b), /iMessage 0 unread/);
  assert.match(vis(b), /Google Drive Could not check free space Not reachable/);
  assert.match(vis(b), /OneDrive 31 GB used 1074 GB free/);
  assert.match(vis(b), /Gmail 2 accounts · 1 expired Connected/);
  assert.match(vis(b), /1 more service with only expired links/);
  assert.match(b, /<span class="act">1 connected · 4 expired<\/span>/);
});

test('connections: account names never show; the GitHub link still opens the account', () => {
  const [a, b] = D.conn(acc, NOW);
  assert.doesNotMatch(vis(a), /thefiredev-cloud/);
  assert.match(a, /href="https:\/\/github\.com\/thefiredev-cloud"/);
  // ui.css draws the one external-link mark from target="_blank"; the row itself must not add a second
  assert.match(a, /<a class="frow" href="https:\/\/github\.com\/thefiredev-cloud" target="_blank" rel="noopener noreferrer">/);
  assert.doesNotMatch(a + b, /\u2197|class="lk"/, 'no page-drawn link mark');
  assert.doesNotMatch(vis(b), /tanner/);
  assert.doesNotMatch(D.conn(feed({ dev_auth: { github: { ok: true, account: 'bad/path' } } }), NOW)[0], /href="https:\/\/github\.com\/bad/);
});

test('connections: a missing feed is one Not reporting state with one Try again; an unreachable Mac mini says so once', () => {
  const [m1, m2] = D.conn(missing, NOW);
  assert.match(vis(m1), /Connections are not reporting/);
  assert.equal((m1.match(/data-retry="keys"/g) || []).length, 1);
  assert.equal(m2, '');
  const [, b] = D.conn(feed({ apple: { mini_reachable: false, library: {} } }), NOW);
  assert.match(vis(b), /The Mac mini is not reachable/);
  assert.doesNotMatch(vis(b), /iMessage|Notes|Wallet/);
});

// Layout audit 2026-11-15 (LayoutT row 59): "Google Drive" and "5" split across lines in a narrow column
test('connections: a second drive of a kind keeps its number on the line of its name', () => {
  const [, b] = D.conn(feed({ drives: [{ kind: 'gdrive', ok: true, used_gb: 1, free_gb: 2 }, { kind: 'gdrive', ok: false }] }), NOW);
  assert.match(b, /<b>Google Drive\u00A02<\/b>/);
  assert.doesNotMatch(b, /<b>Google Drive 2<\/b>/);
});
