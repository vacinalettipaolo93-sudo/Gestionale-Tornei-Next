import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const reactUrl = dataUrl(`
  export let state;
  export let cleanup;
  export const useState = initial => [initial, next => { state = next; }];
  export const useEffect = callback => { cleanup = callback(); };
`);
const firestoreUrl = dataUrl(`
  export const subscriptions = [];
  export const collection = (_db, name) => ({ name });
  export const where = (_field, _operation, ids) => ids;
  export const query = (collection, ids) => ({ ...collection, ids });
  export const onSnapshot = (query, options, success, error) => {
    const subscription = { ...query, options, success, error, stopped: false };
    subscriptions.push(subscription);
    return () => { subscription.stopped = true; };
  };
`);
const venuesUrl = dataUrl(compile(readFileSync(new URL('../utils/tournamentVenues.ts', import.meta.url), 'utf8')));
const periodsUrl = dataUrl(compile(readFileSync(new URL('../utils/tournamentAvailabilityPeriods.ts', import.meta.url), 'utf8'))
  .replace("'./tournamentVenues'", JSON.stringify(venuesUrl)));
const source = compile(readFileSync(new URL('../components/useTournamentAvailability.ts', import.meta.url), 'utf8'))
  .replace("'react'", JSON.stringify(reactUrl))
  .replace("'firebase/firestore'", JSON.stringify(firestoreUrl))
  .replace("import { db } from '../firebase';", 'const db = {};')
  .replace("'../utils/tournamentVenues'", JSON.stringify(venuesUrl))
  .replace("'../utils/tournamentAvailabilityPeriods'", JSON.stringify(periodsUrl));
const { useTournamentAvailability } = await import(dataUrl(source));
const firestore = await import(firestoreUrl);
const react = await import(reactUrl);
const scope = { eventId: 'e1', tournamentId: 't1' };
const emit = (subscription, records = [], hasPendingWrites = false) => subscription.success({
  docs: records.map(record => ({ data: () => record })), metadata: { hasPendingWrites },
});

test('venue listener waits for all chunks, isolates scopes, updates choices in realtime and removes listeners', () => {
  firestore.subscriptions.length = 0;
  const ids = Array.from({ length: 11 }, (_, i) => `p${i}`);
  useTournamentAvailability(ids, scope);
  assert.equal(firestore.subscriptions.length, 8);
  assert.ok(firestore.subscriptions.every(subscription => subscription.options.includeMetadataChanges));
  assert.equal(react.state.loading, true);
  for (const subscription of firestore.subscriptions.filter(s => s.name !== 'availability_settings')) emit(subscription);
  assert.equal(react.state.loading, true);
  const [first, second] = firestore.subscriptions.filter(s => s.name === 'availability_settings');
  emit(first, [
    { playerId: 'p0', ...scope, venueIds: ['paitone-arena'] },
    { playerId: 'p1', ...scope, tournamentId: 'different', venueIds: ['canottieri-salo'] },
    { playerId: 'p2', ...scope, eventId: 'different', venueIds: ['canottieri-salo'] },
    { playerId: 'p3', available: true },
    { playerId: 'outsider', ...scope, venueIds: ['canottieri-salo'] },
  ]);
  assert.equal(react.state.loading, true);
  const secondPlayer = second.ids[0];
  emit(second, [{ playerId: secondPlayer, ...scope, venueIds: ['canottieri-salo', 'paitone-arena', 'invalid'] }]);
  assert.equal(react.state.loading, false);
  assert.deepEqual([...react.state.venueMap.p0], ['paitone-arena']);
  assert.equal(react.state.venueMap.p1, undefined);
  assert.equal(react.state.venueMap.p2, undefined);
  assert.equal(react.state.venueMap.p3, undefined);
  assert.equal(react.state.venueMap.outsider, undefined);
  assert.deepEqual([...react.state.venueMap[secondPlayer]], ['canottieri-salo', 'paitone-arena']);
  emit(first, [{ playerId: 'p0', ...scope, venueIds: ['canottieri-salo'] }]);
  assert.deepEqual([...react.state.venueMap.p0], ['canottieri-salo']);
  assert.equal(react.state.venueMap[secondPlayer].size, 2);
  const firstPeriods = firestore.subscriptions.find(s => s.name === 'availabilities' && s.ids.includes('p0'));
  emit(firstPeriods, [
    { playerId: 'p0', ...scope, date: '2035-06-08', venueId: 'paitone-arena', period: 'MORNING', isAvailable: true },
    { playerId: 'p0', ...scope, date: '2035-06-08', venueId: 'canottieri-salo', period: 'EVENING', isAvailable: true },
    { playerId: 'p0', ...scope, date: '2035-06-08', venueId: 'canottieri-salo', period: 'unknown', isAvailable: true },
    { playerId: 'p0', ...scope, eventId: 'different', date: '2035-06-08', venueId: 'canottieri-salo', period: 'MORNING', isAvailable: true },
    { playerId: 'outsider', ...scope, date: '2035-06-08', venueId: 'paitone-arena', period: 'MORNING', isAvailable: true },
  ]);
  assert.deepEqual(react.state.periodMap.p0, [
    { date: '2035-06-08', venueId: 'paitone-arena', period: 'MORNING' },
    { date: '2035-06-08', venueId: 'canottieri-salo', period: 'EVENING' },
  ]);
  assert.equal(react.state.periodMap.outsider, undefined);
  emit(first);
  assert.equal(react.state.venueMap.p0, undefined);
  react.cleanup();
  assert.ok(firestore.subscriptions.every(s => s.stopped));
});

test('availability snapshots publish only acknowledged writes, including pending deletion and rollback', () => {
  firestore.subscriptions.length = 0;
  useTournamentAvailability(['p0'], scope);
  firestore.subscriptions.forEach(subscription => emit(subscription));
  const slots = firestore.subscriptions.find(subscription => subscription.name === 'slot_preferences');
  const preference = { playerId: 'p0', slotId: 'slot', isPreferred: true };
  emit(slots, [preference], true);
  assert.equal(react.state.pendingWrites, true);
  assert.equal(react.state.slotPrefMap.p0.size, 0);
  emit(slots, [preference]);
  assert.equal(react.state.pendingWrites, false);
  assert.equal(react.state.slotPrefMap.p0.has('slot'), true);
  emit(slots, [], true);
  assert.equal(react.state.slotPrefMap.p0.has('slot'), true, 'unconfirmed deletion must not be published');
  emit(slots, [preference]);
  assert.equal(react.state.pendingWrites, false);
  assert.equal(react.state.slotPrefMap.p0.has('slot'), true, 'failed deletion keeps the saved selection');
  emit(slots);
  assert.equal(react.state.slotPrefMap.p0.size, 0, 'acknowledged deletion propagates immediately');
  react.cleanup();
});

test('venue listener errors surface instead of returning success-shaped availability', () => {
  firestore.subscriptions.length = 0;
  useTournamentAvailability(['p0'], scope);
  const subscription = firestore.subscriptions.find(s => s.name === 'availability_settings');
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try { subscription.error(new Error('Permission denied')); }
  finally { console.error = originalError; }
  assert.match(react.state.error, /Impossibile caricare/);
  assert.equal(react.state.loading, false);
  assert.equal(errors.length, 1);
  react.cleanup();
});
