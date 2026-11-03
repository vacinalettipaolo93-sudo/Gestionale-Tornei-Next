import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const temporary = mkdtempSync(path.join(os.tmpdir(), 'firebase-persistence-'));
after(() => {
  rmSync(temporary, { recursive: true });
  delete globalThis.__persistenceDb;
  delete globalThis.__playerAccessUi;
});
await build({
  entryPoints: ['utils/documentChanges.ts', 'services/eventDataService.ts', 'services/playerDataService.ts', 'utils/updatePlayerProfile.ts', 'utils/playerLogin.ts',
    'components/EventPlayersView.tsx', 'components/Login.tsx', 'components/AdminUsersModal.tsx'],
  outdir: temporary, outbase: '.', bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' },
  plugins: [{
    name: 'fake-firestore',
    setup(plugin) {
      plugin.onResolve({ filter: /(^firebase\/firestore$|\/firebase$)/ }, args => ({ path: args.path, namespace: 'fake' }));
      plugin.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'react-fake' }));
      plugin.onLoad({ filter: /.*/, namespace: 'react-fake' }, () => ({
        contents: `
          export const jsx = (type, props) => ({ type, props });
          export const jsxs = jsx;
          export const Fragment = 'fragment';
          export const useState = initial => globalThis.__playerAccessUi.useState(initial);
          export const useEffect = effect => globalThis.__playerAccessUi.effects.push(effect);
          export const useMemo = callback => callback();
          export default { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
        `,
      }));
      plugin.onLoad({ filter: /.*/, namespace: 'fake' }, args => ({
        contents: args.path === 'firebase/firestore' ? `
          export const collection = (_db, name) => ({ path: name });
          export const doc = (...args) => {
            const path = args.length === 1 ? args[0].path + '/new-' + (++globalThis.__persistenceDb.nextId)
              : args[1] + '/' + args[2];
            return { path, id: path.split('/').pop() };
          };
          export const where = (field, op, value) => ({ field, op, value });
          export const query = (ref, ...conditions) => ({ ...ref, conditions });
          export const getDocs = ref => globalThis.__persistenceDb.query(ref);
          export const runTransaction = (_db, callback) => globalThis.__persistenceDb.transact(callback);
          export const updateDoc = (ref, data) => globalThis.__persistenceDb.transact(transaction => transaction.update(ref, data));
        ` : 'export const db = {};',
      }));
    },
  }],
});
const load = name => import(pathToFileURL(path.join(temporary, `${name}.mjs`)).href);
const { mergeDocumentChanges, firestoreData } = await load('utils/documentChanges');
const { saveEventChanges } = await load('services/eventDataService');
const { updatePlayerEverywhere } = await load('utils/updatePlayerProfile');
const { createPlayerWithAccount, associatePlayerWithEvent, deletePlayerEverywhere, removePlayerFromRanking, synchronizePlayerAccounts } = await load('services/playerDataService');
const { findLoginUser } = await load('utils/playerLogin');
const { default: EventPlayersView } = await load('components/EventPlayersView');
const { default: Login } = await load('components/Login');
const { default: AdminUsersModal } = await load('components/AdminUsersModal');

function uiHarness(overrides = {}) {
  const values = [];
  let index = 0;
  const ui = {
    effects: [],
    useState(initial) {
      const id = index++;
      if (!(id in values)) values[id] = id in overrides ? overrides[id] : typeof initial === 'function' ? initial() : initial;
      return [values[id], next => { values[id] = typeof next === 'function' ? next(values[id]) : next; }];
    },
    render(component, props) {
      index = 0;
      globalThis.__playerAccessUi = ui;
      return component(props);
    },
  };
  return ui;
}

function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

function database(documents, { fail = false, beforeTransaction } = {}) {
  const store = new Map(Object.entries(structuredClone(documents)));
  const writes = [];
  const snapshot = ref => ({ ref, id: ref.id ?? ref.path.split('/').pop(), exists: () => store.has(ref.path), data: () => structuredClone(store.get(ref.path)) });
  const db = {
    store, writes, nextId: 0,
    async query(ref) {
      return { docs: [...store.keys()].filter(key => key.split('/')[0] === ref.path
        && (ref.conditions ?? []).every(condition => store.get(key)[condition.field] === condition.value))
        .map(key => snapshot({ path: key, id: key.split('/').pop() })) };
    },
    async transact(callback) {
      beforeTransaction?.(store);
      const pending = [];
      const result = await callback({
        get: async ref => {
          assert.equal(pending.length, 0, 'all reads precede every write');
          return snapshot(ref);
        },
        update: (ref, data) => pending.push({ type: 'update', ref, data }),
        set: (ref, data) => pending.push({ type: 'set', ref, data }),
        delete: ref => pending.push({ type: 'delete', ref }),
      });
      if (fail) throw new Error('Commit Firebase non riuscito.');
      for (const write of pending) {
        if (write.type === 'update') assert.ok(store.has(write.ref.path), 'update must target an existing document');
        if (write.data) assert.deepEqual(write.data, JSON.parse(JSON.stringify(write.data)), 'no undefined/invalid Firestore fields');
      }
      for (const write of pending) {
        if (write.type === 'delete') store.delete(write.ref.path);
        else store.set(write.ref.path, structuredClone(write.type === 'set' ? write.data : { ...store.get(write.ref.path), ...write.data }));
      }
      writes.push(...pending);
      return result;
    },
  };
  globalThis.__persistenceDb = db;
  return db;
}

const player = id => ({ id, name: `Player ${id}`, phone: '', avatar: 'avatar.svg', status: 'confirmed', summerRankingStartPoints: 0 });
const match = () => ({ id: 'm', player1Id: 'p', player2Id: 'q', score1: null, score2: null, status: 'pending' });
const group = () => ({ id: 'g', name: 'Girone', playerIds: ['p', 'q'], matches: [match()] });
const tournament = () => ({ id: 't', name: 'Torneo', groups: [group()], timeSlots: [], settings: {}, playoffs: null, consolationBracket: null });
const event = (eventType = 'tournament_singolare') => ({
  id: eventType, name: 'Evento', eventType, invitationCode: 'test',
  players: [player('p'), player('q')], tournaments: [tournament()], globalTimeSlots: [],
});
const modes = ['tournament_singolare', 'tournament_padel', 'ranking_singolare', 'ranking_padel_individuale'];
const fixture = () => ({
  'players/p': player('p'), 'players/q': player('q'),
  'users/u': { username: 'Player p', playerId: 'p', password: 'test', role: 'participant' },
  ...Object.fromEntries(modes.map(mode => [`events/${mode}`, { ...event(mode), tournaments: [] }])),
});

test('admin event edits preserve concurrent bookings, results, new tournaments and players', async () => {
  const original = event();
  const db = database({ 'events/e': original });
  const fresh = db.store.get('events/e');
  fresh.tournaments[0].groups[0].matches[0] = { ...match(), score1: 6, score2: 4, status: 'completed', slotId: 's' };
  fresh.tournaments.push({ ...tournament(), id: 'another' });
  fresh.players.push(player('r'));
  await saveEventChanges({ ...original, id: 'e' }, {
    tournaments: [{ ...original.tournaments[0], name: 'Nuovo nome' }],
  });
  assert.equal(db.store.get('events/e').tournaments[0].name, 'Nuovo nome');
  assert.equal(db.store.get('events/e').tournaments[0].groups[0].matches[0].score1, 6);
  assert.equal(db.store.get('events/e').tournaments[1].id, 'another');
  assert.equal(db.store.get('events/e').players[2].id, 'r');
});

test('concurrent independent group fields merge, but stale destructive edits and competing values reject', () => {
  const original = [tournament()];
  const renamed = structuredClone(original);
  renamed[0].groups[0].name = 'Nuovo nome';
  const fresh = structuredClone(original);
  fresh[0].groups[0].matches[0].slotId = 'booked';
  const merged = mergeDocumentChanges(original, renamed, fresh);
  assert.equal(merged[0].groups[0].name, 'Nuovo nome');
  assert.equal(merged[0].groups[0].matches[0].slotId, 'booked');
  for (const next of [[], [{ ...original[0], groups: [] }], [{ ...original[0], groups: [{ ...group(), matches: [] }] }],
    [{ ...original[0], groups: [{ ...group(), playerIds: ['p'] }] }],
    [{ ...original[0], playoffs: { isGenerated: true, matches: [] } }]]) {
    assert.throws(() => mergeDocumentChanges(original, next, fresh), /altro utente/);
  }
  const competing = structuredClone(original);
  competing[0].groups[0].name = 'Nome di un altro amministratore';
  assert.throws(() => mergeDocumentChanges(original, renamed, competing), /altro utente/);
});

test('admin transaction handles uninitialized arrays, concurrent additions and rejected commits', async () => {
  const original = { id: 'e', players: [], tournaments: [] };
  const first = { ...tournament(), id: 'first' };
  const second = { ...tournament(), id: 'second' };
  const db = database({ 'events/e': { tournaments: [first] } });
  await saveEventChanges(original, { tournaments: [second] });
  assert.deepEqual(db.store.get('events/e').tournaments.map(item => item.id), ['first', 'second']);
  const failed = database({ 'events/e': original }, { fail: true });
  await assert.rejects(saveEventChanges(original, { tournaments: [first] }), /Commit/);
  assert.deepEqual(failed.store.get('events/e'), original);
  database({});
  await assert.rejects(saveEventChanges(original, { players: [player('p')] }), /non trovato/);
  assert.deepEqual(firestoreData({ phone: '', omitted: undefined, score: null }), { phone: '', score: null });
  assert.throws(() => firestoreData({ score: NaN }), /numero/);
  assert.throws(() => firestoreData([undefined]), /mancante/);
});

test('avatar, name, phone and points update atomically in the global archive and all four modes', async () => {
  for (const fail of [false, true]) {
    const original = fixture();
    const db = database(original, { fail });
    const changes = { avatar: 'new.svg', name: 'Nuovo nome', phone: '', summerRankingStartPoints: 150, summerRankingJoinedAt: '2035-01-01' };
    if (fail) {
      await assert.rejects(updatePlayerEverywhere('p', changes), /Commit/);
      assert.deepEqual(Object.fromEntries(db.store), original);
    } else {
      await updatePlayerEverywhere('p', changes);
      assert.deepEqual(db.store.get('players/p'), { ...player('p'), ...changes });
      modes.forEach(mode => {
        assert.deepEqual(db.store.get(`events/${mode}`).players[0], { ...player('p'), ...changes });
        assert.deepEqual(db.store.get(`events/${mode}`).players[1], player('q'));
      });
    }
  }
});

test('player/account/event creation is one atomic operation, including multiple selected events', async () => {
  for (const fail of [false, true]) {
    const original = { 'events/one': { ...event(), players: [], tournaments: [] }, 'events/two': { ...event('ranking_singolare'), players: [], tournaments: [] } };
    const db = database(original, { fail });
    const promise = createPlayerWithAccount(' New player ', ' 333 ', 120, ['one', 'two']);
    if (fail) {
      await assert.rejects(promise, /Commit/);
      assert.deepEqual(Object.fromEntries(db.store), original);
    } else {
      const result = await promise;
      assert.equal(result.name, 'New player');
      assert.equal(db.store.get('players/' + result.id).summerRankingStartPoints, 120);
      assert.equal(db.store.get('events/one').players[0].id, result.id);
      assert.equal(db.store.get('events/two').rankingData.participantIds[0], result.id);
      const users = [...db.store.entries()].filter(([key]) => key.startsWith('users/'));
      assert.equal(users.length, 1);
      assert.equal(users[0][1].playerId, result.id);
      assert.equal(users[0][1].password, '1234');
      assert.equal(users[0][1].username, result.name);
      assert.equal(users[0][1].role, 'participant');
    }
  }
});

test('event player creation provides a global account usable in every future event, without enrolling everyone', async () => {
  const db = database({
    'events/winter': { ...event(), players: [], tournaments: [] },
    'events/future': { ...event(), players: [], tournaments: [] },
  });
  const created = await createPlayerWithAccount('Mario Rossi', '', undefined, ['winter']);
  const account = { ...db.store.get(`users/player_${created.id}`), id: `player_${created.id}` };
  assert.equal(findLoginUser([account], [created], '  MARIO   ROSSI ', '1234'), account);
  assert.equal(findLoginUser([account], [created], 'Mario Rossi', '123'), null);
  assert.equal(db.store.get('events/future').players.length, 0);
  await associatePlayerWithEvent('future', created.id);
  assert.equal(db.store.get('events/future').players[0].id, created.id);
  const source = readFileSync('components/EventPlayersView.tsx', 'utf8');
  assert.match(source, /await createPlayerWithAccount\(name, phone, undefined, \[event.id\]\)/);
});

test('recovering an existing event player creates only its missing account and preserves points, rosters and results', async () => {
  const original = fixture();
  delete original['users/u'];
  original['players/p'].summerRankingStartPoints = 215;
  original['events/tournament_singolare'].tournaments = [tournament()];
  const db = database(original);
  const result = await synchronizePlayerAccounts();
  assert.deepEqual(result, { created: 2, issues: [] });
  const users = [...db.store].filter(([key]) => key.startsWith('users/')).map(([id, data]) => ({ id, ...data }));
  assert.equal(findLoginUser(users, [original['players/p']], 'Player p', '1234').playerId, 'p');
  for (const [key, value] of Object.entries(original)) assert.deepEqual(db.store.get(key), value);
  assert.deepEqual(await synchronizePlayerAccounts(), { created: 0, issues: [] });
  const reused = await createPlayerWithAccount(' PLAYER   P ', '', undefined, ['tournament_padel']);
  assert.equal(reused.id, 'p');
  assert.equal(reused.summerRankingStartPoints, 215);
  assert.equal([...db.store.keys()].filter(key => key.startsWith('users/')).length, 2);
});

test('account recovery never overwrites personal passwords or usernames, including legacy short passwords', async () => {
  for (const password of ['personal-password', '123', '1234']) {
    const original = fixture();
    original['users/u'].username = 'custom-login';
    original['users/u'].password = password;
    const db = database(original);
    assert.deepEqual(await synchronizePlayerAccounts(), { created: 1, issues: [] });
    assert.deepEqual(db.store.get('users/u'), original['users/u']);
    const user = { ...db.store.get('users/u'), id: 'u' };
    assert.equal(findLoginUser([user], [player('p')], 'Player p', password), user);
    if (password !== '1234') assert.equal(findLoginUser([user], [player('p')], 'Player p', '1234'), null);
  }
});

test('account recovery converges with a concurrent repair and preserves a password changed while checking', async () => {
  const db = database({ 'players/p': player('p') }, { beforeTransaction: store => {
    store.set('users/player_p', { username: 'custom', password: 'new-personal-password', role: 'participant', playerId: 'p' });
  } });
  assert.deepEqual(await synchronizePlayerAccounts(), { created: 0, issues: [] });
  assert.equal(db.store.get('users/player_p').password, 'new-personal-password');
  assert.equal(db.writes.length, 0);
});

test('account recovery reports name collisions and missing passwords without rebinding or resetting accounts', async () => {
  const documents = {
    'players/p': { ...player('p'), name: 'Mario Rossi' },
    'players/q': { ...player('q'), name: 'Luca Bianchi' },
    'users/organizer': { username: ' MARIO   ROSSI ', role: 'organizer', password: 'organizer-password' },
    'users/q': { username: 'Luca Bianchi', role: 'participant', playerId: 'q' },
  };
  const db = database(documents);
  const result = await synchronizePlayerAccounts();
  assert.equal(result.created, 0);
  assert.equal(result.issues.length, 2);
  assert.match(result.issues[0], /altro giocatore/);
  assert.match(result.issues[1], /password mancante/);
  assert.deepEqual(Object.fromEntries(db.store), documents);
  const duplicateDb = database({
    'players/p': { ...player('p'), name: 'Mario Rossi' },
    'players/q': { ...player('q'), name: ' mario  rossi ' },
  });
  assert.equal((await synchronizePlayerAccounts()).issues.length, 2);
  assert.equal(duplicateDb.writes.length, 0);
});

test('account repair failures propagate and never report or persist a successful account creation', async () => {
  const documents = { 'players/p': player('p') };
  const db = database(documents, { fail: true });
  await assert.rejects(synchronizePlayerAccounts(), /Commit/);
  assert.deepEqual(Object.fromEntries(db.store), documents);
});

test('full-name login preserves custom usernames, rejects ambiguous identities and never applies a default fallback', () => {
  const mario = { ...player('p'), name: 'Mario Rossi' };
  const user = { id: 'u', username: 'custom-login', role: 'participant', playerId: 'p', password: 'changed-password' };
  assert.equal(findLoginUser([user], [mario], ' Mario   Rossi ', 'changed-password'), user);
  assert.equal(findLoginUser([user], [mario], 'CUSTOM-LOGIN', 'changed-password'), user);
  assert.equal(findLoginUser([user], [mario], 'Mario Rossi', '1234'), null);
  const organizer = { id: 'admin', username: 'Mario Rossi', role: 'organizer', password: 'admin-password' };
  assert.equal(findLoginUser([user, organizer], [mario], 'Mario Rossi', 'changed-password'), null);
  assert.equal(findLoginUser([user, organizer], [mario], 'Mario Rossi', 'admin-password'), organizer);
  assert.equal(findLoginUser([user, { ...user, id: 'duplicate' }], [mario], 'custom-login', 'changed-password'), null);
  assert.equal(findLoginUser([user], [mario, { ...mario, id: 'q' }], 'Mario Rossi', 'changed-password'), null);
});

test('player creation rejects normalized account and player-name collisions without partial writes', async () => {
  for (const documents of [
    { 'users/other': { username: ' MARIO   ROSSI ', role: 'organizer', password: 'admin-password' } },
    { 'players/other': { ...player('other'), name: 'Mario Rossi', phone: '333' } },
  ]) {
    const db = database(documents);
    await assert.rejects(createPlayerWithAccount('Mario Rossi', '', undefined), /giocatore/);
    assert.equal(db.writes.length, 0);
    assert.deepEqual(Object.fromEntries(db.store), documents);
  }
});

test('Lista giocatori form persists an account and the Login form authenticates the same full name', async () => {
  const winter = { ...event(), id: 'winter', players: [], tournaments: [] };
  const db = database({ 'events/winter': winter });
  const ui = uiHarness({ 1: 'Mario Rossi', 2: '' });
  const props = { event: winter, players: [], isOrganizer: true, setEvents() { assert.fail('no optimistic roster writes'); } };
  const form = elements(ui.render(EventPlayersView, props)).find(element => element.type === 'form');
  await form.props.onSubmit({ preventDefault() {} });
  const savedPlayer = db.store.get('events/winter').players[0];
  const savedUsers = [...db.store].filter(([key]) => key.startsWith('users/')).map(([id, user]) => ({ id, ...user }));
  assert.equal(savedUsers.length, 1);
  assert.equal(savedUsers[0].password, '1234');
  assert.equal(db.store.get(`players/${savedPlayer.id}`).name, 'Mario Rossi');
  const feedback = elements(ui.render(EventPlayersView, props)).find(element => element.props?.role === 'status');
  assert.match(feedback.props.children, /account di accesso/);

  const loginUi = uiHarness({ 0: ' MARIO   ROSSI ', 1: '1234' });
  let authenticated;
  const loginTree = loginUi.render(Login, {
    users: savedUsers, players: [savedPlayer], onLoginSuccess(user) { authenticated = user; },
  });
  elements(loginTree).find(element => element.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(authenticated, savedUsers[0]);
});

test('opening Controllo Utenti repairs missing accounts and displays them after the Firestore update', async () => {
  const db = database({ 'players/p': player('p') });
  const ui = uiHarness();
  const props = { users: [], players: [player('p')], onClose() {} };
  ui.render(AdminUsersModal, props);
  ui.effects.splice(0).forEach(effect => effect());
  await new Promise(resolve => setImmediate(resolve));
  const account = db.store.get('users/player_p');
  assert.equal(account.password, '1234');
  const tree = ui.render(AdminUsersModal, { ...props, users: [{ ...account, id: 'player_p' }] });
  ui.effects.splice(0).forEach(effect => effect());
  const updated = elements(ui.render(AdminUsersModal, { ...props, users: [{ ...account, id: 'player_p' }] }));
  assert.ok(updated.some(element => element.type === 'span' && element.props.children === 'Player p'));
  assert.match(elements(tree).find(element => element.props?.role === 'status').props.children, /1 account mancanti creati/);
});

test('reusing a player preserves the existing login, synchronizes points and avoids duplicate accounts', async () => {
  const original = fixture();
  original['users/u'].username = 'Renamed login';
  const db = database(original);
  const result = await createPlayerWithAccount('Player p', '', 210, ['ranking_singolare']);
  assert.equal(result.id, 'p');
  assert.equal([...db.store.keys()].filter(key => key.startsWith('users/')).length, 1);
  modes.forEach(mode => assert.equal(db.store.get(`events/${mode}`).players[0].summerRankingStartPoints, 210));
  assert.equal(db.store.get('players/p').summerRankingStartPoints, 210);
  const conflict = database({ ...fixture(), 'users/other': { username: 'New player', playerId: 'q' } });
  await assert.rejects(createPlayerWithAccount('New player', '', 0, ['ranking_singolare']), /altro giocatore/);
  assert.equal(conflict.writes.length, 0);
});

test('association re-reads current matches and rosters and synchronizes global points across modes', async () => {
  const original = fixture();
  original['events/ranking_singolare'].players = [player('q')];
  const db = database(original, { beforeTransaction: store => {
    store.get('events/ranking_singolare').rankingData = { slots: [], matches: [match()], participantIds: ['q'] };
    store.get('events/tournament_singolare').players.push(player('r'));
  } });
  await associatePlayerWithEvent('ranking_singolare', 'p', 160);
  const ranked = db.store.get('events/ranking_singolare');
  assert.equal(ranked.rankingData.matches[0].id, 'm');
  assert.deepEqual(ranked.rankingData.participantIds, ['q', 'p']);
  assert.equal(db.store.get('events/tournament_singolare').players[2].id, 'r');
  modes.forEach(mode => assert.equal(db.store.get(`events/${mode}`).players.find(item => item.id === 'p').summerRankingStartPoints, 160));
});

test('event-only player removal checks fresh match blockers and never changes other events or global data', async () => {
  const original = fixture();
  original['events/ranking_singolare'].rankingData = { slots: [], matches: [], participantIds: ['p', 'q'], availabilities: { p: { status: 'available' } } };
  const db = database(original, { beforeTransaction: store => {
    store.get('events/ranking_singolare').rankingData.matches.push(match());
  } });
  await assert.rejects(removePlayerFromRanking('ranking_singolare', 'p'), /partite o gironi/);
  assert.equal(db.writes.length, 0);
  const success = database(original);
  await removePlayerFromRanking('ranking_singolare', 'p');
  assert.equal(success.store.get('events/ranking_singolare').players.some(item => item.id === 'p'), false);
  assert.deepEqual(success.store.get('players/p'), original['players/p']);
  assert.deepEqual(success.store.get('events/tournament_padel'), original['events/tournament_padel']);
});

test('global deletion removes linked users, preferences and all event copies atomically', async () => {
  const original = fixture();
  original['users/u2'] = { playerId: 'p', username: 'second' };
  for (const name of ['availabilities', 'availability_settings', 'slot_preferences', 'date_unavailabilities']) {
    original[`${name}/p`] = { playerId: 'p' };
    original[`${name}/q`] = { playerId: 'q' };
  }
  for (const fail of [true, false]) {
    const db = database(original, { fail });
    if (fail) {
      await assert.rejects(deletePlayerEverywhere('p'), /Commit/);
      assert.deepEqual(Object.fromEntries(db.store), original);
    } else {
      await deletePlayerEverywhere('p');
      assert.equal(db.store.has('players/p'), false);
      assert.equal(db.store.has('users/u'), false);
      assert.equal(db.store.has('users/u2'), false);
      modes.forEach(mode => assert.deepEqual(db.store.get(`events/${mode}`).players, [player('q')]));
      assert.deepEqual([...db.store.keys()].filter(key => key.endsWith('/p')), []);
      assert.equal(db.store.has('slot_preferences/q'), true);
    }
  }
});

test('global deletion aborts without orphaning an assigned tournament player or fixed Padel team', async () => {
  for (const assignment of [
    [tournament()],
    [{ ...tournament(), groups: [{ ...group(), playerIds: ['team'], matches: [] }], padelTeams: [{ id: 'team', player1Id: 'p', player2Id: 'q' }] }],
    [{ ...tournament(), groups: [], playoffs: { matches: [{ player1Id: 'p' }] } }],
  ]) {
    const original = fixture();
    original['events/tournament_padel'].tournaments = assignment;
    const db = database(original);
    await assert.rejects(deletePlayerEverywhere('p'), /collegamenti/);
    assert.deepEqual(Object.fromEntries(db.store), original);
  }
});

test('global deletion removes unassigned Padel teams without leaving a missing member', async () => {
  const original = fixture();
  original['events/tournament_padel'].tournaments = [{
    ...tournament(), groups: [], padelTeams: [
      { id: 'team', player1Id: 'p', player2Id: 'q' },
      { id: 'other-team', player1Id: 'q', player2Id: 'r' },
    ],
  }];
  const db = database(original);
  await deletePlayerEverywhere('p');
  assert.deepEqual(db.store.get('events/tournament_padel').tournaments[0].padelTeams, [
    { id: 'other-team', player1Id: 'q', player2Id: 'r' },
  ]);
});

test('global deletion does not delete an account reassigned after the initial query', async () => {
  const db = database(fixture(), { beforeTransaction: store => {
    store.get('users/u').playerId = 'q';
  } });
  await deletePlayerEverywhere('p');
  assert.equal(db.store.get('users/u').playerId, 'q');
  assert.equal(db.store.has('players/p'), false);
});

test('every mounted administrative event writer uses a transaction instead of optimistic event setters', () => {
  for (const name of ['GroupManagement', 'TournamentSettings', 'RegolamentoGironiPanel', 'EventView', 'Playoffs', 'ConsolationBracket', 'PlayerManagement', 'AdminPlayersView', 'EventPlayersView']) {
    const source = readFileSync(`components/${name}.tsx`, 'utf8');
    assert.doesNotMatch(source, /\bsetEvents\s*\(/, name);
    assert.doesNotMatch(source, /\bupdateDoc\s*\(/, name);
  }
  const profile = readFileSync('components/EditProfileModal.tsx', 'utf8');
  assert.doesNotMatch(profile, /\bsetEvents\s*\(|\bsetUsers\s*\(/);
  assert.match(profile, /await updatePlayerEverywhere/);
  assert.match(profile, /snapshot\.data\(\)\.password !== oldPassword/);
  const app = readFileSync('App.tsx', 'utf8');
  assert.match(app, /includeMetadataChanges: true/);
  assert.doesNotMatch(app, /setUsers\(\[\]\)/);
});

test('draft synchronization updates pristine forms, preserves dirty edits, and retains conflict baselines', async () => {
  const source = readFileSync('components/usePersistenceAction.tsx', 'utf8');
  const states = [];
  const effects = [];
  let index = 0;
  const mock = {
    useState(initial) {
      const id = index++;
      states[id] ??= typeof initial === 'function' ? initial() : initial;
      return [states[id], value => { states[id] = typeof value === 'function' ? value(states[id]) : value; }];
    },
    useEffect(effect) { effects.push(effect); },
    useRef(value) { return { current: value }; },
  };
  globalThis.__draftHooks = mock;
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
    .replace(/import React, \{.*?\} from 'react';/, 'const React = {}; const {useEffect, useRef, useState} = globalThis.__draftHooks;')
    .replace("import { sameData } from '../utils/documentChanges';", 'const sameData = (a,b) => JSON.stringify(a) === JSON.stringify(b);');
  const { useSyncedDraft, usePersistenceAction } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const render = (remote, key = 'first') => {
    index = 0;
    let result = useSyncedDraft(remote, key);
    effects.splice(0).forEach(effect => effect());
    index = 0;
    result = useSyncedDraft(remote, key);
    effects.splice(0);
    return result;
  };
  assert.equal(render('one')[0], 'one');
  assert.equal(render('remote')[0], 'remote');
  render('remote')[1]('local draft');
  const dirty = render('other remote');
  assert.equal(dirty[0], 'local draft');
  assert.equal(dirty[2], 'remote');
  assert.equal(render('local draft')[2], 'local draft');
  assert.equal(render('new group', 'second')[0], 'new group');
  states.length = 0;
  index = 0;
  const persistence = usePersistenceAction();
  let finished = false;
  const previousError = console.error;
  console.error = () => {};
  try {
    await persistence.run(async () => { throw new Error('Permission denied'); });
    assert.equal(states[0], 'Permission denied');
    assert.equal(states[1], false);
    await persistence.run(async () => { finished = true; });
  } finally { console.error = previousError; delete globalThis.__draftHooks; }
  assert.equal(finished, true, 'failure does not leave the form permanently busy');
  assert.equal(states[1], false);
});
