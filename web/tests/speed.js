'use strict';
// Speed checks that a busy or throttled machine cannot fail and a real regression still does (lane DoClock, 2026-11-15; CI run
// 43789547955 failed a fixed 250 ms bound at 295 ms on the loaded runner, where the work takes 4 ms calm).
// Time is this thread's CPU time, not the wall clock: time the thread waits for a core (other load, or a CPU quota that stalls the
// process for 90 ms of every 100 ms) never counts. That clock moves in steps of about 1 ms here, so each timed sample repeats the
// call until it holds at least 20 ms of CPU. Each side is the fastest of several samples, not the mean, since noise only adds. The
// bound is in units of a fixed calibration workload timed in this process just before, so a slow or down-clocked machine scales
// both sides. Not a test file: `node --test tests/*.test.js` never runs it on its own.
const cpuMs = () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1e3; };
const SAMPLE_MS = 20;
if (typeof process.threadCpuUsage !== 'function') {
  throw new Error('tests/speed.js needs process.threadCpuUsage (Node 22.23+); this Node is ' + process.version);
}

// the CPU ms of one call: the fastest of `runs` samples, each `reps` calls long, after one untimed call that warms the JIT
function perCall(fn, runs) {
  fn();
  const sample = (reps) => { const t0 = cpuMs(); for (let i = 0; i < reps; i++) fn(); return cpuMs() - t0; };
  let reps = 1, t;
  while ((t = sample(reps)) < SAMPLE_MS) reps *= 2;
  let m = t / reps;
  for (let i = 1; i < runs; i++) m = Math.min(m, sample(reps) / reps);
  return m;
}

// the calibration: filter, sort, map and join 20,000 small rows, the kind of work the pages do; about 2 ms of CPU on pc-desktop
const ROWS = Array.from({ length: 20000 }, (_, i) => ({ k: (i * 7919) % 20011, s: 'row ' + i }));
const calibrate = () => ROWS.filter((o) => o.k % 3).slice().sort((a, b) => a.k - b.k).map((o) => '<td>' + o.s + '</td>').join('').length;

// fn's CPU per call against the calibration's, timed just before: {took, unit} in ms and `units` = took / unit
function measure(fn, runs = 5) {
  const unit = perCall(calibrate, runs);
  const took = perCall(fn, runs);
  return { took, unit, units: took / unit };
}

module.exports = { measure };
