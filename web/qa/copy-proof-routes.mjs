const LEGACY_PAGE = { house: 'home', invest: 'markets' };
const SUB_PAGE = { launch: 'fleet', agents: 'fleet', cluster: 'fleet', dev: 'fleet', crons: 'fleet', schedules: 'fleet', keys: 'pad' };

// a name is an old page name, a sub-tab name of the older pager, or a route of today's eight tabs ('realestate/commercial')
export function pageRoute(raw) {
  const slash = String(raw).indexOf('/');
  if (slash > 0) { const tab = raw.slice(0, slash), sub = raw.slice(slash + 1) || null; return { name: raw, tab, sub }; }
  const name = LEGACY_PAGE[raw] || raw;
  const sub = SUB_PAGE[name] ? name : null;
  return { name, tab: sub ? SUB_PAGE[name] : name, sub };
}
