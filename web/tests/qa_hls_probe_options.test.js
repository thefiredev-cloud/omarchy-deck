const test = require('node:test');
const assert = require('node:assert/strict');

test('HLS probe defaults to warm configs, camera one, and one trial', async () => {
  const { selectProbeOptions } = await import('../qa/hls-probe-options.mjs');

  assert.deepEqual(selectProbeOptions({}), {
    cold: false,
    picked: [0, 1, 2, 3],
    cams: [1],
    trials: 1,
  });
});

test('HLS probe selects valid config and camera indexes from comma lists', async () => {
  const { selectProbeOptions } = await import('../qa/hls-probe-options.mjs');

  assert.deepEqual(selectProbeOptions({ COLD: '1', CFG: '3,1,invalid,9', CAMS: '4,2,0', TRIALS: '3' }), {
    cold: true,
    picked: [3, 1],
    cams: [4, 2],
    trials: 3,
  });
});

test('HLS probe clamps trial count to the supported range', async () => {
  const { selectProbeOptions } = await import('../qa/hls-probe-options.mjs');

  assert.equal(selectProbeOptions({ TRIALS: '0' }).trials, 1);
  assert.equal(selectProbeOptions({ TRIALS: '99' }).trials, 10);
  assert.equal(selectProbeOptions({ TRIALS: 'not-a-number' }).trials, 1);
});
