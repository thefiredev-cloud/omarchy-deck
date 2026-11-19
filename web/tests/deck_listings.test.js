require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const a = src.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const b = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
const D = new Function(src.slice(a, b) + '\nreturn DeckUI;')();
const now = Date.UTC(2026, 9, 8, 17);
test('Money missing feed does not promise an unwired refresh', () => {
  const html = D.finPage({error:'file missing',src:'~/.meshvault/status/deck/finance.json'},now,null);
  assert.match(html, /Money is not set up/);
  assert.doesNotMatch(html, /fills in after the next refresh|data-retry/);
});
test('jobs: hostile titles, companies, sites and links are escaped, only http(s) links open', () => {
  const feedJobs = { t: now / 1000 - 60, listings: [
    { title: '<script>alert(1)</script>', company: '<b>x</b>', location: '"quoted"', site: 'a"b<i>', score: 5, url: 'javascript:alert(1)' },
    { title: 'ok', company: 'Acme', location: 'Irvine', site: 'ashby', score: 9, url: 'https://jobs.example.com/1' }
  ] };
  const html = D.jobs(feedJobs, 'all', now, 400);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.doesNotMatch(html, /<i>/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.match(html, /rel="noopener noreferrer"/);
});
test('safeUrl rejects backslash and userinfo tricks that browsers read differently from parsers', () => {
  for (const bad of ['https://evil.com\\@offerup.com/x', 'https://offerup.com@evil.com/x', 'https://evil.com\\offerup.com/', 'javascript:alert(1)', 'https://a.com/x y'])
    assert.equal(D.safeUrl(bad), '', bad);
  assert.equal(D.safeUrl('https://offerup.com/item/1?a=1&b=2'), 'https://offerup.com/item/1?a=1&b=2');
});
