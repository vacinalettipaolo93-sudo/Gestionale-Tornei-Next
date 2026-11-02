import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const firestoreUrl = moduleUrl(`
  export const store = new Map();
  export let failure = null;
  export let afterQuery = null;
  export function reset(documents, options = {}) {
    store.clear();
    for (const [path, value] of Object.entries(documents)) store.set(path, structuredClone(value));
    failure = options.failure;
    afterQuery = options.afterQuery;
  }
  export const doc = (_db, collection, id) => ({ path: collection + '/' + id });
  export const collection = (_db, path) => ({ path });
  const snapshot = ref => ({
    ref,
    exists: () => store.has(ref.path),
    data: () => structuredClone(store.get(ref.path)),
  });
  export async function getDocs(ref) {
    if (failure === 'query') throw new Error('Lettura eventi non consentita.');
    const docs = [...store.keys()]
      .filter(path => path.startsWith(ref.path + '/'))
      .map(path => snapshot({ path }));
    afterQuery?.(store);
    return { docs };
  }
  export async function runTransaction(_db, callback) {
    const writes = [];
    await callback({
      get: async ref => {
        if (writes.length) throw new Error('Read after write');
        return snapshot(ref);
      },
      update: (ref, fields) => writes.push({ ref, fields }),
    });
    if (failure === 'commit') throw new Error('Salvataggio non consentito.');
    for (const { ref, fields } of writes) {
      if (!store.has(ref.path)) throw new Error('Documento mancante.');
    }
    for (const { ref, fields } of writes) {
      store.set(ref.path, { ...store.get(ref.path), ...fields });
    }
  }
`);
const { reset, store } = await import(firestoreUrl);
const source = readFileSync(new URL('../utils/updatePlayerProfile.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
  .replace("'firebase/firestore'", JSON.stringify(firestoreUrl))
  .replace("import { db } from '../firebase';", 'const db = {};');
const { updatePlayerProfile } = await import(moduleUrl(compiled));

const player = {
  id: 'p1', name: 'Nome iniziale', phone: '111', avatar: 'avatar.svg',
  status: 'confirmed', summerRankingStartPoints: 125,
};
const otherPlayer = { ...player, id: 'p2', name: 'Altro giocatore' };
const modes = ['tournament_singolare', 'tournament_padel', 'ranking_singolare', 'ranking_padel_individuale'];
const fixture = () => ({
  'users/u1': { username: 'login-invariato', password: 'test-password', role: 'participant', playerId: 'p1' },
  'players/p1': player,
  'players/p2': otherPlayer,
  ...Object.fromEntries(modes.map(eventType => [`events/${eventType}`, {
    eventType, players: [{ ...player, status: 'pending', summerRankingStartPoints: 42 }, otherPlayer],
    tournaments: [{ groups: [{ playerIds: ['p1', 'p2'], matches: [{ player1Id: 'p1', score1: 2 }] }] }],
    rankingData: { participantIds: ['p1', 'p2'], availabilities: { p1: { status: 'available' } } },
  }])),
  'events/unrelated': { players: [otherPlayer] },
  'events/legacy': { name: 'Senza giocatori' },
});

test('updates name and phone in the global archive and every mode without changing other data', async () => {
  const original = fixture();
  reset(original);
  await updatePlayerProfile('u1', '  Nuovo nome  ', '  +39 333 1234567  ');

  assert.deepEqual(store.get('players/p1'), { ...player, name: 'Nuovo nome', phone: '+39 333 1234567' });
  for (const mode of modes) {
    const event = original[`events/${mode}`];
    assert.deepEqual(store.get(`events/${mode}`), {
      ...event,
      players: [{ ...event.players[0], name: 'Nuovo nome', phone: '+39 333 1234567' }, otherPlayer],
    });
  }
  for (const key of ['users/u1', 'players/p2', 'events/unrelated', 'events/legacy']) {
    assert.deepEqual(store.get(key), original[key]);
  }
});

test('allows clearing the phone number and saves a player with no event memberships', async () => {
  reset({ 'users/u1': fixture()['users/u1'], 'players/p1': player });
  await updatePlayerProfile('u1', 'Nuovo nome', '   ');
  assert.equal(store.get('players/p1').phone, '');
});

test('rejects empty names, missing users, unlinked accounts and missing global players without writes', async () => {
  for (const [documents, name, message] of [
    [fixture(), '   ', /nome del giocatore è obbligatorio/],
    [{ 'players/p1': player }, 'Nome', /Nessun giocatore collegato/],
    [{ 'users/u1': { username: 'admin', role: 'organizer' } }, 'Nome', /Nessun giocatore collegato/],
    [{ 'users/u1': fixture()['users/u1'] }, 'Nome', /non esiste nell'archivio globale/],
  ]) {
    reset(documents);
    await assert.rejects(updatePlayerProfile('u1', name, '222'), message);
    assert.deepEqual(Object.fromEntries(store), documents);
  }
});

test('surfaces read and commit errors without partial persistence', async () => {
  for (const failure of ['query', 'commit']) {
    const original = fixture();
    reset(original, { failure });
    await assert.rejects(updatePlayerProfile('u1', 'Nome', '222'), /non consentit/);
    assert.deepEqual(Object.fromEntries(store), original);
  }
});

test('uses fresh transactional rosters rather than overwriting concurrent changes', async () => {
  reset(fixture(), {
    afterQuery: documents => {
      documents.get('events/tournament_singolare').players.push({ id: 'p3', name: 'Nuova iscrizione' });
      documents.get('events/tournament_padel').players[0].avatar = 'new-avatar.svg';
      documents.get('events/ranking_singolare').players = [otherPlayer];
      documents.delete('events/legacy');
    },
  });
  await updatePlayerProfile('u1', 'Nuovo nome', '222');
  assert.equal(store.get('events/tournament_singolare').players[2].id, 'p3');
  assert.equal(store.get('events/tournament_padel').players[0].avatar, 'new-avatar.svg');
  assert.deepEqual(store.get('events/ranking_singolare').players, [otherPlayer]);
  assert.equal(store.has('events/legacy'), false);
});
