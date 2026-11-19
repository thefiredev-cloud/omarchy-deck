'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('blur probe decodes synthetic RGB PNG pixels to expected luma', async () => {
  const F = await import('../qa/fixtures.mjs');
  const { decode } = await import('../qa/blur-math.mjs');
  const image = decode(F.png(4, 3, 1));

  assert.equal(image.w, 4);
  assert.equal(image.h, 3);
  assert.equal(image.luma.length, 12);
  assert.ok(Math.abs(image.luma[0] - (0.2126 * 40 + 0.7152 * 70 + 0.0722 * 140)) < 0.01);
});

test('blur probe measures second-difference edge energy inside the sample rectangle', async () => {
  const { energy } = await import('../qa/blur-math.mjs');
  const a = { w: 5, h: 1, luma: new Float32Array(5) };
  const b = { w: 5, h: 1, luma: Float32Array.from([0, 0, 255, 0, 0]) };

  assert.equal(energy(a, b, { x: 0, y: 0, w: 5, h: 1 }), 340);
});
test('blur probe rejects measurements with no usable baseline', async () => {
  const { summarize } = await import('../qa/blur-math.mjs');
  assert.deepEqual(summarize([{ where: 'top', kept: null }], 0.5), { worst: 1, blurred: false });
});

test('blur probe compares the worst measured region against the limit', async () => {
  const { summarize } = await import('../qa/blur-math.mjs');
  assert.deepEqual(summarize([{ where: 'top', kept: 0.2 }, { where: 'bottom', kept: 0.5 }], 0.5), { worst: 0.5, blurred: false });
  assert.deepEqual(summarize([{ where: 'top', kept: 0.2 }, { where: 'bottom', kept: 0.49 }], 0.5), { worst: 0.49, blurred: true });
});
