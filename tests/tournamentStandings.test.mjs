import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = mkdtempSync(path.join(os.tmpdir(), 'tournament-standings-'));
after(() => { rmSync(temporary, { recursive: true }); delete globalThis.__standingsTransaction; });
await build({
  entryPoints: ['utils/standings.ts', 'utils/pointRules.ts', 'services/eventDataService.ts', 'services/tournamentResultService.ts'],
  outdir: temporary, outbase: '.', bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' },
  plugins: [{
    name: 'fake-firestore',
    setup(plugin) {
      plugin.onResolve({ filter: /(^firebase\/firestore$|\/firebase$)/ }, args => ({ path: args.path, namespace: 'fake' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fake' }, args => ({
        contents: args.path === 'firebase/firestore'
          ? 'export const doc = (_db, collection, id) => ({ collection, id }); export const runTransaction = (_db, callback) => globalThis.__standingsTransaction(callback);'
          : 'export const db = {};',
      }));
    },
  }],
});
const load = file => import(pathToFileURL(path.join(temporary, `${file}.mjs`)).href);
const { calculateStandings } = await load('utils/standings');
const { validatePointRules, getStandingsRuleWarnings } = await load('utils/pointRules');
const { saveEventChanges } = await load('services/eventDataService');
const { saveTournamentResult } = await load('services/tournamentResultService');
const rules = [
  { id: 'close', minDiff: 1, maxDiff: 1, winnerPoints: 3, loserPoints: 1 },
  { id: 'wide', minDiff: 2, maxDiff: 99, winnerPoints: 3, loserPoints: 0 },
];
const settings = { pointRules: rules, pointsPerDraw: 2, tieBreakers: ['wins', 'goalDifference'], playoffSettings: [], consolationSettings: [], hasBronzeFinal: false };
const match = (id, player1Id, player2Id, score1, score2, status = 'completed') =>
  ({ id, player1Id, player2Id, score1, score2, status });
const group = (id, matches) => ({ id, name: id, playerIds: ['a', 'b', 'c'], matches });
const byPlayer = entries => Object.fromEntries(entries.map(entry => [entry.playerId, entry]));

test('configured points and game statistics apply to wins on either side, draws and all completed matches', () => {
  const g = group('g1', [
    match('1', 'a', 'b', 6, 7), match('2', 'a', 'c', 7, 6),
    match('3', 'b', 'c', 6, 2), match('4', 'b', 'a', 4, 4),
    match('5', 'a', 'c', 7, 0, 'scheduled'),
  ]);
  const entries = byPlayer(calculateStandings(g, [], settings));
  assert.deepEqual([entries.a.points, entries.b.points, entries.c.points], [6, 8, 1]);
  assert.deepEqual([entries.a.played, entries.a.wins, entries.a.draws, entries.a.losses], [3, 1, 1, 1]);
  assert.deepEqual([entries.a.goalsFor, entries.a.goalsAgainst, entries.a.goalDifference], [17, 17, 0]);
  assert.deepEqual(getStandingsRuleWarnings(g, rules), []);
});

test('configuration validation rejects invalid and overlapping ranges without requiring every possible difference', () => {
  assert.equal(validatePointRules(rules), null);
  assert.match(validatePointRules([...rules, { ...rules[0], id: 'overlap', maxDiff: 2 }]), /sovrappongono/);
  assert.match(validatePointRules([{ ...rules[0], minDiff: 2, maxDiff: 1 }]), /differenza minima/);
  assert.match(validatePointRules([{ ...rules[0], loserPoints: 1.5 }]), /interi/);
});

test('standings warn about missing or ambiguous rules and invalid completed scores', () => {
  const g = group('g', [
    match('1', 'a', 'b', 6, 7), match('2', 'a', 'c', 6, 3),
    match('3', 'b', 'c', undefined, 0), match('4', 'b', 'c', 6, 7, 'scheduled'),
  ]);
  const warnings = getStandingsRuleWarnings(g, [rules[0], { ...rules[0], id: 'duplicate' }]);
  assert.equal(warnings.length, 3);
  assert.match(warnings.join(' '), /non valido/);
  assert.match(warnings.join(' '), /Nessuna regola.*3/);
  assert.match(warnings.join(' '), /Più regole.*1/);
  const entries = byPlayer(calculateStandings(g, [], { ...settings, pointRules: [rules[0]] }));
  assert.equal(entries.a.points, 1);
  assert.equal(entries.b.points, 3);
  assert.equal(entries.c.played, 1);
});

test('saved tournament settings and changed results recalculate every group independently without affecting other tournaments', async () => {
  const g1 = group('g1', [match('m1', 'a', 'b', 6, 7)]);
  const g2 = group('g2', [match('m2', 'a', 'b', 7, 6)]);
  const tournament = { id: 't1', name: 'T1', groups: [g1, g2], settings, timeSlots: [], playoffs: null, consolationBracket: null };
  const other = { ...structuredClone(tournament), id: 't2', settings: { ...settings, pointRules: [{ ...rules[0], loserPoints: 0 }] } };
  let event = { id: 'e', name: 'Evento', invitationCode: '', players: [], tournaments: [tournament, other] };
  globalThis.__standingsTransaction = async callback => callback({
    get: async () => ({ exists: () => true, id: event.id, data: () => structuredClone(event) }),
    update: (_ref, patch) => { event = { ...event, ...structuredClone(patch) }; },
  });
  const nextSettings = { ...settings, pointRules: [{ ...rules[0], loserPoints: 2 }, rules[1]] };
  await saveEventChanges(event, { tournaments: [{ ...tournament, settings: nextSettings }, other] });
  assert.equal(byPlayer(calculateStandings(event.tournaments[0].groups[0], [], event.tournaments[0].settings)).a.points, 2);
  assert.equal(byPlayer(calculateStandings(event.tournaments[0].groups[1], [], event.tournaments[0].settings)).b.points, 2);
  assert.equal(byPlayer(calculateStandings(event.tournaments[1].groups[0], [], event.tournaments[1].settings)).a.points, 0);

  await saveTournamentResult('e', 't1', g1.matches[0], { type: 'save', score1: 6, score2: 3 }, { isOrganizer: true });
  assert.equal(byPlayer(calculateStandings(event.tournaments[0].groups[0], [], event.tournaments[0].settings)).a.points, 3);
  assert.equal(byPlayer(calculateStandings(event.tournaments[0].groups[1], [], event.tournaments[0].settings)).b.points, 2);
  await saveTournamentResult('e', 't1', event.tournaments[0].groups[0].matches[0], { type: 'reset' }, { isOrganizer: true });
  assert.equal(byPlayer(calculateStandings(event.tournaments[0].groups[0], [], event.tournaments[0].settings)).a.points, 0);
});
