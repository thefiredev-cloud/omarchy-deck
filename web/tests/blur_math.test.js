'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const math = import('../qa/blur-math.mjs');

function png(width, height, colorType, rows) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  const chunk = (type, data) => {
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    return Buffer.concat([size, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  const scanlines = rows.map(({ filter, data }) => Buffer.concat([Buffer.from([filter]), data]));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(scanlines))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('decode reconstructs RGB rows using PNG None, Sub, Up, Average, and Paeth filters', async () => {
  const rows = [
    { filter: 0, data: Buffer.from([10, 20, 30]) },
    { filter: 1, data: Buffer.from([5, 5, 5]) },
    { filter: 2, data: Buffer.from([7, 7, 7]) },
    { filter: 3, data: Buffer.from([1, 1, 1]) },
    { filter: 4, data: Buffer.from([3, 3, 3]) },
  ];
  const { decode } = await math;
  const result = decode(png(1, 5, 2, rows));
  assert.equal(result.w, 1);
  assert.equal(result.h, 5);
  assert.deepEqual(Array.from(result.luma, (v) => Math.round(v * 10) / 10), [18.6, 5, 12, 7, 10]);
});

test('decode ignores alpha when calculating RGBA luma', async () => {
  const { decode } = await math;
  const result = decode(png(2, 1, 6, [{ filter: 0, data: Buffer.from([100, 150, 200, 0, 20, 30, 40, 255]) }]));
  assert.ok(Math.abs(result.luma[0] - 142.98) < 0.001);
  assert.ok(Math.abs(result.luma[1] - 28.596) < 0.001);
});

test('energy measures horizontal second differences within the requested rectangle', async () => {
  const { energy } = await math;
  const A = { w: 5, luma: Float32Array.from([0, 0, 0, 0, 0]) };
  const B = { w: 5, luma: Float32Array.from([0, 0, 10, 0, 0]) };
  assert.ok(Math.abs(energy(A, B, { x: 0, y: 0, w: 5, h: 1 }) - 40 / 3) < 1e-12);
  assert.equal(energy(A, B, { x: 1, y: 0, w: 3, h: 1 }), 20);
});
