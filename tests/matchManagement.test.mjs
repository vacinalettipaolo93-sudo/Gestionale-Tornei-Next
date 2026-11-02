import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = mkdtempSync(path.join(os.tmpdir(), 'match-management-'));
after(() => { rmSync(temporary, { recursive: true }); delete globalThis.__matchTestFirestore; });
await build({
  entryPoints: ['utils/tournamentResults.ts', 'utils/rankingChanges.ts', 'services/tournamentResultService.ts', 'services/rankingDataService.ts'],
  outdir: temporary, outbase: '.', bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' },
  plugins: [{
    name: 'fake-firestore',
    setup(plugin) {
      plugin.onResolve({ filter: /(^firebase\/firestore$|\/firebase$)/ }, args => ({ path: args.path, namespace: 'fake' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fake' }, args => ({
        contents: args.path === 'firebase/firestore'
          ? 'export const doc = (_db, collection, id) => ({ collection, id }); export const runTransaction = (_db, callback) => globalThis.__matchTestFirestore(callback);'
          : 'export const db = {};',
      }));
    },
  }],
});
const load = file => import(pathToFileURL(path.join(temporary, `${file}.mjs`)).href);
const { applyTournamentResult, validateMatchScores } = await load('utils/tournamentResults');
const { mergeRankingChanges, assertRankingMatchUnchanged } = await load('utils/rankingChanges');
const { saveTournamentResult } = await load('services/tournamentResultService');
const { saveRankingChanges } = await load('services/rankingDataService');
const admin = { isOrganizer: true };
const player = { isOrganizer: false, playerId: 'a' };
const match = (id = 'ab', overrides = {}) => ({
  id, player1Id: 'a', player2Id: 'b', score1: null, score2: null, status: 'pending', ...overrides,
});
const tournament = (overrides = {}) => ({
  id: 't1', name: 'Torneo', groups: [{ id: 'g1', playerIds: ['a', 'b'], matches: [match()] }],
  settings: {}, timeSlots: [], playoffs: null, consolationBracket: null, ...overrides,
});
const event = (t = tournament()) => ({
  id: 'event', name: 'Evento', eventType: 'tournament_singolare', players: ['a', 'b', 'c', 'd'].map(id => ({ id })),
  tournaments: [t, { ...tournament(), id: 'other' }], invitationCode: 'test',
});
const save = { type: 'save', score1: 6, score2: 3 };
const reset = { type: 'reset' };
const ranking = matches => ({ slots: [], matches, participantIds: ['a', 'b', 'c', 'd'] });
const getMatch = t => t.groups[0].matches[0];
const completed = overrides => match('ab', { status: 'completed', score1: 6, score2: 3, completedAt: '2030-01-01T10:00:00Z', ...overrides });
const booked = overrides => match('ab', { status: 'scheduled', slotId: 'slot', scheduledTime: '2030-06-03T18:00:00Z', location: 'Paitone Arena', field: 'Campo 1', ...overrides });

test('score validation rejects empty, negative, decimal and nonfinite scores', () => {
  for (const value of ['', ' ', '-1', '1.5', 'Infinity', 'NaN', '9007199254740992']) assert.ok(validateMatchScores(value, '0'));
  assert.equal(validateMatchScores('0', '6'), null);
});

test('participant saves and edits own result, keeping reservation and unrelated tournament unchanged', () => {
  const original = event(tournament({ groups: [{ matches: [booked()] }] }));
  const copy = structuredClone(original);
  const saved = applyTournamentResult(original, 't1', booked(), save, player, 0);
  assert.deepEqual(original, copy);
  assert.equal(getMatch(saved[0]).status, 'completed');
  assert.equal(getMatch(saved[0]).scheduledTime, booked().scheduledTime);
  assert.equal(getMatch(saved[0]).slotId, 'slot');
  assert.equal(getMatch(saved[0]).completedAt, '1970-01-01T00:00:00.000Z');
  assert.deepEqual(saved[1], original.tournaments[1]);
  const edited = applyTournamentResult({ ...original, tournaments: saved }, 't1', getMatch(saved[0]), { ...save, score1: 7 }, player);
  assert.equal(getMatch(edited[0]).score1, 7);
  assert.equal(getMatch(edited[0]).completedAt, getMatch(saved[0]).completedAt);
});

test('deleting result restores scheduled state for slot and legacy manual bookings; otherwise pending', () => {
  for (const metadata of [{}, { slotId: 'slot' }, { scheduledTime: booked().scheduledTime }]) {
    const m = completed(metadata);
    const result = applyTournamentResult(event(tournament({ groups: [{ matches: [m] }] })), 't1', m, reset, player);
    const next = getMatch(result[0]);
    assert.equal(next.status, Object.keys(metadata).length ? 'scheduled' : 'pending');
    assert.equal(next.score1, null);
    assert.ok(!Object.hasOwn(next, 'completedAt'));
    assert.ok(!Object.values(next).includes(undefined));
  }
});

test('unauthorized players, stale scores/participants, invalid scores and absent matches are rejected', () => {
  const original = event();
  assert.throws(() => applyTournamentResult(original, 't1', match(), save, { isOrganizer: false, playerId: 'c' }), /tue partite/);
  assert.throws(() => applyTournamentResult(original, 't1', match('missing'), save, player), /non trovata/);
  assert.throws(() => applyTournamentResult(original, 't1', match('ab', { score1: 1 }), save, player), /altro utente/);
  assert.throws(() => applyTournamentResult(original, 't1', match('ab', { player1Id: 'c' }), save, player), /altro utente/);
  assert.throws(() => applyTournamentResult(original, 't1', match(), { ...save, score1: -1 }, player), /interi/);
  assert.throws(() => applyTournamentResult(original, 't1', match(), reset, player), /non ha un risultato/);
});

test('both members of a fixed Padel team can manage the team result', () => {
  const t = tournament({
    padelTeams: [{ id: 'team1', player1Id: 'a', player2Id: 'b' }, { id: 'team2', player1Id: 'c', player2Id: 'd' }],
    groups: [{ matches: [match('teams', { player1Id: 'team1', player2Id: 'team2' })] }],
  });
  const e = { ...event(t), eventType: 'tournament_padel' };
  for (const playerId of ['a', 'b', 'c', 'd']) {
    assert.equal(getMatch(applyTournamentResult(e, 't1', getMatch(t), save, { isOrganizer: false, playerId })[0]).status, 'completed');
  }
  assert.throws(() => applyTournamentResult(e, 't1', getMatch(t), save, { isOrganizer: false, playerId: 'outsider' }), /tue partite/);
});

function knockout(phase = 'playoff') {
  const prefix = phase === 'playoff' ? 'po-' : 'co-';
  const key = phase === 'playoff' ? 'playoffs' : 'consolationBracket';
  const matchesKey = phase === 'playoff' ? 'playoffMatches' : 'consolationMatches';
  const pm = (id, index, p1, p2, overrides = {}) => ({
    id, round: 1, matchIndex: index, player1Id: p1, player2Id: p2, score1: null, score2: null, winnerId: null, nextMatchId: 'final', ...overrides,
  });
  return {
    ...tournament(),
    [key]: {
      matches: [pm('semi1', 0, 'a', 'b', { loserGoesToBronzeFinal: true }), pm('semi2', 1, 'c', 'd', { loserGoesToBronzeFinal: true }),
        pm('final', 0, null, null, { round: 2, nextMatchId: null }),
        pm('bronze', 1, null, null, { round: 2, nextMatchId: null, isBronzeFinal: true })],
      isGenerated: true, finalId: 'final', bronzeFinalId: 'bronze',
    },
    [matchesKey]: [match(`${prefix}semi1`), match(`${prefix}semi2`, { player1Id: 'c', player2Id: 'd' })],
  };
}

for (const phase of ['playoff', 'consolation']) {
  const key = phase === 'playoff' ? 'playoffs' : 'consolationBracket';
  const matchesKey = phase === 'playoff' ? 'playoffMatches' : 'consolationMatches';
  const prefix = phase === 'playoff' ? 'po-' : 'co-';
  test(`${phase}: winner/loser slots, mirrors and reset stay synchronized`, () => {
    const initial = knockout(phase);
    assert.throws(() => applyTournamentResult(event(initial), 't1', initial[matchesKey][0], { ...save, score2: 6 }, admin), /vincitore/);
    const saved = applyTournamentResult(event(initial), 't1', initial[matchesKey][0], save, admin)[0];
    assert.equal(saved[key].matches.find(m => m.id === 'final').player1Id, 'a');
    assert.equal(saved[key].matches.find(m => m.id === 'bronze').player1Id, 'b');
    const both = applyTournamentResult(event(saved), 't1', saved[matchesKey][1], save, admin)[0];
    assert.ok(both[matchesKey].some(m => m.id === `${prefix}final` && m.player1Id === 'a' && m.player2Id === 'c'));
    const cleared = applyTournamentResult(event(both), 't1', both[matchesKey][0], reset, admin)[0];
    assert.equal(cleared[key].matches.find(m => m.id === 'final').player1Id, null);
    assert.equal(cleared[key].matches.find(m => m.id === 'bronze').player1Id, null);
    assert.ok(!cleared[matchesKey].some(m => m.id === `${prefix}final`));
    assert.ok(!cleared[matchesKey].some(m => m.id === `${prefix}bronze`));
  });
  test(`${phase}: winner edits/reset cannot overwrite a booked or completed downstream match`, () => {
    const initial = knockout(phase);
    const first = applyTournamentResult(event(initial), 't1', initial[matchesKey][0], save, admin)[0];
    const both = applyTournamentResult(event(first), 't1', first[matchesKey][1], save, admin)[0];
    for (const status of ['scheduled', 'completed']) {
      const current = structuredClone(both);
      current[matchesKey].find(m => m.id === `${prefix}final`).status = status;
      assert.throws(() => applyTournamentResult(event(current), 't1', current[matchesKey][0], reset, admin), /turno successivo/);
      assert.throws(() => applyTournamentResult(event(current), 't1', current[matchesKey][0], { ...save, score2: 7 }, admin), /turno successivo/);
      assert.doesNotThrow(() => applyTournamentResult(event(current), 't1', current[matchesKey][0], { ...save, score1: 7 }, admin));
    }
  });
}

test('legacy bracket-only match can be saved through the shared result transaction', () => {
  const t = knockout();
  const expected = t.playoffMatches[0];
  delete t.playoffMatches;
  const result = applyTournamentResult(event(t), 't1', expected, save, player)[0];
  assert.equal(result.playoffs.matches[0].winnerId, 'a');
  assert.equal(result.playoffMatches[0].status, 'completed');
});

test('ranking changes merge independent match updates and availability/settings without overwriting fresh data', () => {
  const baseline = ranking([match(), match('cd', { player1Id: 'c', player2Id: 'd' })]);
  const next = { ...baseline, matches: [completed(), baseline.matches[1]] };
  const current = { ...baseline, matches: [baseline.matches[0], completed({ id: 'cd', player1Id: 'c', player2Id: 'd' })], availabilities: { d: { status: 'available', days: ['monday'] } } };
  const merged = mergeRankingChanges(baseline, next, current, 'ranking_singolare', player);
  assert.equal(merged.matches.filter(m => m.status === 'completed').length, 2);
  assert.deepEqual(merged.availabilities.d, current.availabilities.d);
});

test('ranking conflicts prevent stale edit, deletion and accidental recreation of removed matches', () => {
  const baseline = ranking([completed()]);
  const next = ranking([completed({ score1: 7 })]);
  const current = ranking([completed({ score2: 4 })]);
  assert.throws(() => mergeRankingChanges(baseline, next, current, 'ranking_singolare', player), /altro utente/);
  assert.throws(() => mergeRankingChanges(baseline, ranking([]), current, 'ranking_singolare', player), /altro utente/);
  assert.throws(() => mergeRankingChanges(baseline, next, ranking([]), 'ranking_singolare', player), /altro utente/);
  assert.throws(() => assertRankingMatchUnchanged(completed(), current.matches[0]), /altro utente/);
});

test('ranking concurrent additions and removals preserve other new matches', () => {
  const baseline = ranking([match()]);
  const unrelated = match('cd', { player1Id: 'c', player2Id: 'd' });
  const merged = mergeRankingChanges(baseline, ranking([]), ranking([match(), unrelated]), 'ranking_singolare', player);
  assert.deepEqual(merged.matches, [unrelated]);
});

test('ranking prevents concurrent duplicate slot bookings, unauthorized edits and invalid scores', () => {
  assert.throws(() => mergeRankingChanges(ranking([]), ranking([booked()]), ranking([booked({ id: 'cd', player1Id: 'c', player2Id: 'd' })]), 'ranking_singolare', player), /già prenotato/);
  assert.throws(() => mergeRankingChanges(ranking([]), ranking([completed()]), ranking([]), 'ranking_singolare', { isOrganizer: false, playerId: 'c' }), /tue partite/);
  assert.throws(() => mergeRankingChanges(ranking([]), ranking([completed({ score1: 1.5 })]), ranking([]), 'ranking_singolare', player), /interi/);
  assert.throws(() => mergeRankingChanges(ranking([]), ranking([completed({ player2Id: 'a' })]), ranking([]), 'ranking_singolare', player), /distinti/);
});

test('ranking Padel authorizes all four participants and preserves booking metadata when changing result', () => {
  const m = completed({ team1PlayerIds: ['a', 'b'], team2PlayerIds: ['c', 'd'], scheduledTime: booked().scheduledTime, slotId: 'slot' });
  for (const playerId of ['a', 'b', 'c', 'd']) {
    const merged = mergeRankingChanges(ranking([m]), ranking([{ ...m, score1: 7 }]), ranking([m]), 'ranking_padel_individuale', { isOrganizer: false, playerId });
    assert.equal(merged.matches[0].slotId, 'slot');
    assert.equal(merged.matches[0].scheduledTime, booked().scheduledTime);
  }
});

test('ranking rechecks slot removal and head-to-head limits after concurrent writes', () => {
  const slot = { id: 'slot', start: booked().scheduledTime, location: 'Paitone Arena', field: 'Campo 1' };
  const baseline = { ...ranking([]), slots: [slot] };
  assert.throws(() => mergeRankingChanges(baseline, { ...baseline, matches: [booked()] }, { ...baseline, slots: [] }, 'ranking_singolare', player), /non è più disponibile/);
  const limited = { ...ranking([]), rulesConfig: { headToHeadLimit: 1 } };
  assert.throws(() => mergeRankingChanges(limited, { ...limited, matches: [match()] }, { ...limited, matches: [match('other')] }, 'ranking_singolare', player), /limite di scontri/);
});

function firestore(initial, fail = false) {
  let state = structuredClone(initial);
  let version = 0;
  globalThis.__matchTestFirestore = async callback => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const currentVersion = version;
      let payload;
      await callback({
        get: async ref => ({ id: ref.id, exists: () => true, data: () => structuredClone(state) }),
        update: (_ref, update) => { payload = update; },
      });
      await Promise.resolve();
      if (currentVersion !== version) continue;
      if (fail) throw new Error('Commit Firebase non riuscito');
      state = { ...state, ...payload };
      version++;
      return;
    }
    throw new Error('Transaction retry exhausted');
  };
  return () => state;
}

test('result transaction re-reads on concurrent saves, so only one differing result succeeds', async () => {
  const get = firestore(event());
  const results = await Promise.allSettled([
    saveTournamentResult('event', 't1', match(), save, player),
    saveTournamentResult('event', 't1', match(), { ...save, score1: 7 }, player),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(getMatch(get().tournaments[0]).score1, 6);
});

test('failed Firebase commits do not publish tournament or ranking results', async () => {
  const initial = event();
  const get = firestore(initial, true);
  await assert.rejects(saveTournamentResult('event', 't1', match(), save, player), /Commit Firebase/);
  assert.deepEqual(get(), initial);
  const rank = { ...initial, eventType: 'ranking_singolare', rankingData: ranking([match()]) };
  const getRanking = firestore(rank, true);
  await assert.rejects(saveRankingChanges('event', 'ranking_singolare', rank.rankingData, ranking([completed()]), player), /Commit Firebase/);
  assert.deepEqual(getRanking(), rank);
});

test('concurrent ranking transactions keep independent results instead of replacing the whole snapshot', async () => {
  const baseline = ranking([match(), match('cd', { player1Id: 'c', player2Id: 'd' })]);
  const get = firestore({ ...event(), rankingData: baseline });
  await Promise.all([
    saveRankingChanges('event', 'ranking_singolare', baseline, ranking([completed(), baseline.matches[1]]), player),
    saveRankingChanges('event', 'ranking_singolare', baseline, ranking([baseline.matches[0], completed({ id: 'cd', player1Id: 'c', player2Id: 'd' })]), admin),
  ]);
  assert.equal(get().rankingData.matches.filter(m => m.status === 'completed').length, 2);
});
