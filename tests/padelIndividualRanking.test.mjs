import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'padel-individual-ranking-'));

execFileSync('npx', [
  'tsc',
  '--outDir', tempDir,
  '--module', 'ESNext',
  '--target', 'ES2022',
  '--moduleResolution', 'bundler',
  '--allowJs',
  '--skipLibCheck',
  '--lib', 'ES2022,DOM,DOM.Iterable',
  'types.ts',
  'utils/summerRanking.ts',
  'utils/padelIndividualRanking.ts',
], { cwd: repoRoot, stdio: 'pipe' });

for (const relativePath of ['utils/summerRanking.js', 'utils/padelIndividualRanking.js']) {
  const absolutePath = path.join(tempDir, relativePath);
  const source = readFileSync(absolutePath, 'utf8').replaceAll("'../types'", "'../types.js'").replaceAll("'./summerRanking'", "'./summerRanking.js'");
  writeFileSync(absolutePath, source);
}

const {
  calculatePadelIndividualMatchBreakdowns,
  calculatePadelIndividualRanking,
  getPadelIndividualAutoQualifiedPlayerIds,
} = await import(pathToFileURL(path.join(tempDir, 'utils/padelIndividualRanking.js')).href);

const createPlayer = (id, start) => ({
  id,
  name: id.toUpperCase(),
  phone: '',
  avatar: '',
  status: 'confirmed',
  summerRankingStartPoints: start,
});

const createMatch = ({ id = 'match-1', team1, team2, score1, score2, completedAt }) => ({
  id,
  player1Id: team1[0],
  player2Id: team2[0],
  team1PlayerIds: team1,
  team2PlayerIds: team2,
  score1,
  score2,
  status: 'completed',
  completedAt,
});

const getPlayerBreakdown = (breakdown, playerId) => breakdown.players.find(player => player.playerId === playerId);

test('balanced band awards +20/-20 to every player on the winning/losing pair', () => {
  const players = ['a', 'b', 'c', 'd'].map(id => createPlayer(id, 1000));
  const breakdown = calculatePadelIndividualMatchBreakdowns(players, [
    createMatch({ team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 4, completedAt: '2026-01-10T10:00' }),
  ]).get('match-1');

  assert.equal(breakdown.band, 'balanced');
  assert.equal(getPlayerBreakdown(breakdown, 'a').resultPoints, 20);
  assert.equal(getPlayerBreakdown(breakdown, 'c').resultPoints, -20);
});

test('medium-difference favorite win and underdog loss follow the requested values', () => {
  const players = [createPlayer('a', 1100), createPlayer('b', 1050), createPlayer('c', 1000), createPlayer('d', 1000)];
  const breakdown = calculatePadelIndividualMatchBreakdowns(players, [
    createMatch({ team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 3, completedAt: '2026-01-11T10:00' }),
  ]).get('match-1');

  assert.equal(breakdown.band, 'medium');
  assert.equal(getPlayerBreakdown(breakdown, 'a').resultPoints, 15);
  assert.equal(getPlayerBreakdown(breakdown, 'c').resultPoints, -15);
});

test('medium-difference underdog win and favorite loss follow the requested values', () => {
  const players = [createPlayer('a', 1100), createPlayer('b', 1050), createPlayer('c', 1000), createPlayer('d', 1000)];
  const breakdown = calculatePadelIndividualMatchBreakdowns(players, [
    createMatch({ team1: ['a', 'b'], team2: ['c', 'd'], score1: 3, score2: 6, completedAt: '2026-01-12T10:00' }),
  ]).get('match-1');

  assert.equal(breakdown.band, 'medium');
  assert.equal(getPlayerBreakdown(breakdown, 'c').resultPoints, 25);
  assert.equal(getPlayerBreakdown(breakdown, 'a').resultPoints, -25);
});

test('high-difference underdog loss keeps the requested positive +10', () => {
  const players = [createPlayer('a', 1400), createPlayer('b', 1200), createPlayer('c', 900), createPlayer('d', 800)];
  const breakdown = calculatePadelIndividualMatchBreakdowns(players, [
    createMatch({ team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 1, completedAt: '2026-01-13T10:00' }),
  ]).get('match-1');

  assert.equal(breakdown.band, 'high');
  assert.equal(getPlayerBreakdown(breakdown, 'a').resultPoints, 10);
  assert.equal(getPlayerBreakdown(breakdown, 'c').resultPoints, 10);
});

test('monthly participation bonus uses stable calendar months and caps at +20 per month', () => {
  const players = ['a', 'b', 'c', 'd'].map(id => createPlayer(id, 1000));
  const ranking = calculatePadelIndividualRanking(players, [
    createMatch({ id: 'm1', team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 4, completedAt: '2026-02-01T10:00' }),
    createMatch({ id: 'm2', team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 4, completedAt: '2026-02-10T10:00' }),
    createMatch({ id: 'm3', team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 4, completedAt: '2026-02-20T10:00' }),
    createMatch({ id: 'm4', team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 4, completedAt: '2026-02-28T23:30' }),
    createMatch({ id: 'm5', team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 4, completedAt: '2026-03-01T00:15' }),
  ]);

  assert.equal(ranking.find(entry => entry.player.id === 'a').participationBonus, 25);
  assert.equal(ranking.find(entry => entry.player.id === 'c').participationBonus, 25);
});

test('won-games bonus is capped at +5 per player and per match', () => {
  const players = ['a', 'b', 'c', 'd'].map(id => createPlayer(id, 1000));
  const ranking = calculatePadelIndividualRanking(players, [
    createMatch({ team1: ['a', 'b'], team2: ['c', 'd'], score1: 7, score2: 6, completedAt: '2026-03-10T10:00' }),
  ]);

  assert.equal(ranking.find(entry => entry.player.id === 'a').wonGamesBonus, 5);
  assert.equal(ranking.find(entry => entry.player.id === 'c').wonGamesBonus, 5);
});

test('editing and re-saving a result recalculates from history without duplicating derived points', () => {
  const players = ['a', 'b', 'c', 'd'].map(id => createPlayer(id, 1000));
  const original = calculatePadelIndividualRanking(players, [
    createMatch({ id: 'm1', team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 4, completedAt: '2026-04-10T10:00' }),
  ]);
  const edited = calculatePadelIndividualRanking(players, [
    createMatch({ id: 'm1', team1: ['a', 'b'], team2: ['c', 'd'], score1: 4, score2: 6, completedAt: '2026-04-10T10:00' }),
  ]);

  assert.equal(original.find(entry => entry.player.id === 'a').matchesPlayed, 1);
  assert.equal(edited.find(entry => entry.player.id === 'a').matchesPlayed, 1);
  assert.equal(edited.find(entry => entry.player.id === 'a').participationBonus, 5);
  assert.notEqual(original.find(entry => entry.player.id === 'a').points, edited.find(entry => entry.player.id === 'a').points);
});

test('social player counts distinct partners across completed matches', () => {
  const players = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => createPlayer(id, 1000));
  const ranking = calculatePadelIndividualRanking(players, [
    createMatch({ id: 'm1', team1: ['a', 'b'], team2: ['c', 'd'], score1: 6, score2: 4, completedAt: '2026-05-01T10:00' }),
    createMatch({ id: 'm2', team1: ['a', 'c'], team2: ['b', 'e'], score1: 6, score2: 3, completedAt: '2026-05-03T10:00' }),
    createMatch({ id: 'm3', team1: ['a', 'f'], team2: ['d', 'e'], score1: 3, score2: 6, completedAt: '2026-05-06T10:00' }),
  ]);

  assert.equal(ranking.find(entry => entry.player.id === 'a').distinctPartners, 3);
});

test('master qualification keeps only the top 16 players with at least 6 matches', () => {
  const rankingEntries = Array.from({ length: 18 }).map((_, index) => ({
    player: createPlayer(`p${index + 1}`, 1000),
    rank: index + 1,
    points: 2000 - index,
    startingPoints: 1000,
    matchesPlayed: index === 16 ? 5 : 6,
    wins: 10,
    losses: 0,
    resultPoints: 50,
    participationBonus: 20,
    wonGamesBonus: 15,
    distinctPartners: 3,
    qualifiedForMaster: false,
    eligibleForMaster: index === 16 ? false : true,
  }));
  const qualifiedIds = getPadelIndividualAutoQualifiedPlayerIds(rankingEntries);

  assert.equal(qualifiedIds.length, 16);
  assert.ok(!qualifiedIds.includes('p17'));
  assert.equal(qualifiedIds[0], 'p1');
  assert.equal(qualifiedIds[15], 'p16');
});
