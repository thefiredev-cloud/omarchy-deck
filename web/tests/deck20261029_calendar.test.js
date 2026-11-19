// L8 (2026-10-29), Today v3 (2026-11-14): "Next on the calendar" prefers GET /api/calendar (the deck's own agenda path) and falls back to the
// Mac mini path in /api/accounts only when the agenda is missing or failed. Pure helpers, fixtures only.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const deck = fs.readFileSync(path.join(__dirname, '../static', 'deck.js'), 'utf8');
const cut = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b));
const D = new Function(cut(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();

const NOW = new Date(2026, 9, 29, 12, 0, 0).getTime();
const TODAY = '2026-10-29';
const at = (h, m, d = 29) => new Date(2026, 9, d, h, m, 0).toISOString();
const text = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\u00B7/g, '·').replace(/\s+/g, ' ').trim();

const agenda = (events, more = []) => ({ t: NOW / 1000, generated_at: '2026-10-29T11:55:00-07:00', days: [{ date: TODAY, events }, ...more] });
const mini = { apple: { mini_reachable: true, events_today: [{ title: 'Mini event', calendar: 'Mac mini', start: at(15, 0) }] } };

test('the agenda is preferred over the Mac mini path', () => {
  const cal = agenda([
    { title: 'AU: ATFL', all_day: false, start: at(13, 30), end: at(14, 30), kind: 'personal', source: 'iCloud OC COAST' },
    { title: 'LACoFD shift', all_day: true, start: null, end: null, kind: 'shifts', source: 'iCloud' },
  ]);
  const out = text(D.tdCal(cal, mini, NOW).html);
  assert.match(out, /AU: ATFL/);
  assert.match(out, /LACoFD shift Today All day/, 'an all-day event says so instead of a time');
  assert.doesNotMatch(out, /Mini event/, 'the Mini path must not be used when the agenda answers');
  assert.doesNotMatch(out, /iCloud|OC COAST/, 'which calendar an event came from is not on the page');
});

test('a finished event is gone; the rest stay in time order, three at most', () => {
  const cal = agenda([
    { title: 'Past standup', start: at(8, 0), end: at(8, 30) },
    { title: 'Dentist', start: at(14, 30), end: at(15, 0) },
    { title: 'Call', start: at(13, 0), end: at(13, 30) },
  ], [{ date: '2026-10-30', events: [{ title: 'Run', start: at(7, 0, 30) }, { title: 'Lunch', start: at(12, 0, 30) }] }]);
  const out = text(D.tdCal(cal, mini, NOW).html);
  assert.doesNotMatch(out, /Past standup|Lunch/);
  assert.ok(out.indexOf('Call') < out.indexOf('Dentist') && out.indexOf('Dentist') < out.indexOf('Run'));
  assert.match(out, /Run Tomorrow/);
});

test('an empty agenda says nothing is on the calendar, never that the calendar is broken', () => {
  const r = D.tdCal(agenda([]), mini, NOW);
  assert.match(text(r.html), /Nothing on the calendar/);
  assert.doesNotMatch(text(r.html), /Mini event/);
  assert.equal(r.miss.length, 0);
});

test('a missing or failed agenda falls back to the Mac mini path', () => {
  for (const cal of [null, undefined, { error: 'file missing' }, { days: 'nope' }]) {
    const out = text(D.tdCal(cal, mini, NOW).html);
    assert.match(out, /Mini event/, `fallback for ${JSON.stringify(cal)}`);
  }
});

test('with neither path the section is absent and Calendar joins the checks row', () => {
  const r = D.tdCal({ error: 'file missing' }, { error: 'unavailable' }, NOW);
  assert.equal(r.html, '');
  assert.deepEqual(r.miss.map(m => m.name), ['Calendar']);
});
