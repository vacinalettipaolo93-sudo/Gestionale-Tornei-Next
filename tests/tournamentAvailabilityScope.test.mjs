import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const dataUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const firestoreUrl = dataUrl(`
  export const store = new Map();
  export const doc = (_db, collection, id) => ({path: collection + '/' + id});
  export const collection = (_db, path) => ({path});
  export const query = () => ({});
  export const where = () => ({});
  export const orderBy = () => ({});
  export const getDocs = async () => ({docs:[]});
  export const getDoc = async () => ({exists:()=>false});
  export const serverTimestamp = () => 'timestamp';
  export const setDoc = async (ref, data) => store.set(ref.path, data);
  export const deleteDoc = async ref => store.delete(ref.path);
`);
const { store } = await import(firestoreUrl);
const source = readFileSync(new URL('../services/availabilityService.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
  .replace('"firebase/firestore"', JSON.stringify(firestoreUrl))
  .replace('import { db } from "../firebase";', 'const db = {};');
const { setDateUnavailability, removeDateUnavailability } = await import(dataUrl(compiled));

test('date exclusions have independent Firestore documents for each tournament and event', async () => {
  store.clear();
  const first = { eventId: 'event1', tournamentId: 't1' };
  const second = { eventId: 'event1', tournamentId: 't2' };
  const third = { eventId: 'event2', tournamentId: 't1' };
  for (const scope of [first, second, third]) {
    await setDateUnavailability('player', '2030-06-03', true, scope);
  }
  assert.equal(store.size, 3);
  await removeDateUnavailability('player', '2030-06-03', first);
  assert.equal(store.size, 2);
  assert.deepEqual([...store.values()].map(item => [item.eventId, item.tournamentId]), [
    ['event1', 't2'], ['event2', 't1'],
  ]);
});

test('scoped writes do not remove or overwrite legacy global exclusions', async () => {
  store.clear();
  await setDateUnavailability('player', '2030-06-03', true);
  const scope = { eventId: 'event1', tournamentId: 't1' };
  await setDateUnavailability('player', '2030-06-03', true, scope);
  await removeDateUnavailability('player', '2030-06-03', scope);
  assert.equal(store.size, 1);
  assert.ok(store.has('date_unavailabilities/player_2030-06-03'));
});
