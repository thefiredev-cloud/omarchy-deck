import zlib from 'node:zlib';

// Decode an 8-bit RGB/RGBA PNG into a luma plane for pixel comparisons.
export function decode(buf) {
  let p = 8; const idat = []; let w = 0, h = 0, ct = 0;
  while (p < buf.length) { const n = buf.readUInt32BE(p), t = buf.toString('latin1', p + 4, p + 8); if (t === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); ct = buf[p + 17]; } if (t === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + n)); p += 12 + n; }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), row = w * bpp, out = Buffer.alloc(h * row);
  for (let y = 0; y < h; y++) { const f = raw[y * (row + 1)]; for (let x = 0; x < row; x++) { const v = raw[y * (row + 1) + 1 + x], a = x >= bpp ? out[y * row + x - bpp] : 0, b = y ? out[(y - 1) * row + x] : 0, c = x >= bpp && y ? out[(y - 1) * row + x - bpp] : 0;
    out[y * row + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + (() => { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })()) & 255; } }
  const luma = new Float32Array(w * h); for (let i = 0; i < w * h; i++) luma[i] = 0.2126 * out[i * bpp] + 0.7152 * out[i * bpp + 1] + 0.0722 * out[i * bpp + 2];
  return { w, h, luma };
}

// Mean second-difference energy of A-B inside a rect; smooth ramps contribute less than sharp text edges.

export function energy(A, B, r) {
  const { w, luma } = A, d = (x, y) => luma[y * w + x] - B.luma[y * w + x]; let s = 0, n = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++) { s += Math.abs(d(x + 1, y) - 2 * d(x, y) + d(x - 1, y)); n++; } return s / n;
}
export function summarize(measured, limit) {
  const worst = measured.some((item) => item.kept == null) ? 1 : Math.max(...measured.map((item) => item.kept));
  return { worst, blurred: worst < limit };
}
