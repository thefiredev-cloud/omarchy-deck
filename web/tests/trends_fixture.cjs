// The World view fixtures (tests/fixtures/trends.sample.json, gaps.sample.json, built from the 2026-11-17 contract) as the deck
// serves them: GET /api/trends carries the contract's sources[] as feeds[] (rust/src/sources.rs prepare_trends). Rows are left as the
// file has them, malformed ones included, so the page renderers are tested against what a broken producer could write.
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
module.exports = {
  trends() { const d = read('trends.sample.json'); d.feeds = d.sources; delete d.sources; return d; },
  gaps() { return read('gaps.sample.json'); }
};
