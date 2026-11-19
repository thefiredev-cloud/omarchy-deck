import test from 'node:test';
import assert from 'node:assert/strict';
import { pageRoute } from '../qa/copy-proof-routes.mjs';

test('page routes map legacy page names to current pages', () => {
  assert.deepEqual(pageRoute('house'), { name: 'home', tab: 'home', sub: null });
  assert.deepEqual(pageRoute('invest'), { name: 'markets', tab: 'markets', sub: null });
});

test('page routes open requested Fleet sub-tabs under Fleet', () => {
  assert.deepEqual(pageRoute('cluster'), { name: 'cluster', tab: 'fleet', sub: 'cluster' });
  assert.deepEqual(pageRoute('schedules'), { name: 'schedules', tab: 'fleet', sub: 'schedules' });
});

test('page routes leave a regular page on its own tab', () => {
  assert.deepEqual(pageRoute('today'), { name: 'today', tab: 'today', sub: null });
});

test('a route of the eight-tab deck opens that tab, then that sub-tab', () => {
  assert.deepEqual(pageRoute('realestate/commercial'), { name: 'realestate/commercial', tab: 'realestate', sub: 'commercial' });
  assert.deepEqual(pageRoute('home/cluster'), { name: 'home/cluster', tab: 'home', sub: 'cluster' });
  assert.deepEqual(pageRoute('surf/'), { name: 'surf/', tab: 'surf', sub: null });
});
