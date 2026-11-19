import test from 'node:test';
import assert from 'node:assert/strict';
import { rebase } from '../qa/copy-proof-fixtures.mjs';

test('rebase shifts nested epoch timestamps without changing ordinary numbers', () => {
  const input = {
    captured: 1_800_000_000,
    nested: [{ updated: 1_800_000_010, count: 7 }, null],
    text: '1800000000',
  };

  assert.deepEqual(rebase(input, -300), {
    captured: 1_799_999_700,
    nested: [{ updated: 1_799_999_710, count: 7 }, null],
    text: '1800000000',
  });
});

test('rebase leaves numbers outside the epoch range unchanged', () => {
  const input = [1_699_999_999, 2_000_000_001, 0, -4];

  assert.deepEqual(rebase(input, 120), input);
});
