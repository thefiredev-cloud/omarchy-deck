export const rebase = (value, delta) => {
  if (typeof value === 'number' && value > 1.7e9 && value < 2e9) return value + delta;
  if (Array.isArray(value)) return value.map((item) => rebase(item, delta));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebase(item, delta)]));
  }
  return value;
};
