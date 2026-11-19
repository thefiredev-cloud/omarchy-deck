export function selectProbeOptions(env) {
  const cold = env.COLD === '1';
  const picked = (env.CFG
    ? env.CFG.split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 4)
    : cold ? [0, 1] : [0, 1, 2, 3]);
  const cams = (env.CAMS || env.CAM || '1').split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 4);
  const requestedTrials = Number(env.TRIALS || 1);
  const trials = Number.isFinite(requestedTrials) ? Math.min(10, Math.max(1, requestedTrials)) : 1;
  return { cold, picked, cams, trials };
}
