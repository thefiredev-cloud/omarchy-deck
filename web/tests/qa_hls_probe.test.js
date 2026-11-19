const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const script = path.resolve(__dirname, '../qa/hls-probe.mjs');

test('HLS probe refuses to start without a token', () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, DECK_TOKEN: '' },
    timeout: 5000,
  });

  assert.equal(result.status, 2);
  assert.equal(result.stderr.trim(), 'DECK_TOKEN missing');
  assert.equal(result.stdout, '');
});

test('HLS probe refuses malformed tokens before starting Chromium', () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, DECK_TOKEN: 'abcdefghijk' },
    timeout: 5000,
  });

  assert.equal(result.status, 2);
  assert.equal(result.stderr.trim(), 'DECK_TOKEN missing');
  assert.equal(result.stdout, '');
});
