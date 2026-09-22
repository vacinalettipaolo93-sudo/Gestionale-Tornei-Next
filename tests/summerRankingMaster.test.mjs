import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'summer-ranking-master-'));
const tscCliPath = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

execFileSync(process.execPath, [
  tscCliPath,
  '--outDir', tempDir,
  '--module', 'ESNext',
  '--target', 'ES2022',
  '--moduleResolution', 'bundler',
  '--allowJs',
  '--skipLibCheck',
  '--lib', 'ES2022,DOM,DOM.Iterable',
  'types.ts',
  'utils/summerRanking.ts',
], { cwd: repoRoot, stdio: 'pipe' });

const summerRankingPath = path.join(tempDir, 'utils/summerRanking.js');
writeFileSync(
  summerRankingPath,
  readFileSync(summerRankingPath, 'utf8').replaceAll("'../types'", "'../types.js'"),
);

const summerRankingModuleUrl = pathToFileURL(summerRankingPath).href;
const {
  createSummerRankingMasterBracket,
  createSummerRankingMasterData,
  getSummerRankingMasterQualifiedPlayerIds,
  normalizeRulesConfig,
  recomputeSummerRankingMasterBracket,
} = await import(summerRankingModuleUrl);

const createRankingEntry = (id, rank) => ({
  player: {
    id,
    name: id.toUpperCase(),
    phone: '',
    avatar: '',
    status: 'confirmed',
    summerRankingStartPoints: 1000,
  },
  rank,
  points: 1000 - rank,
  startingPoints: 1000,
  wins: 0,
  draws: 0,
  losses: 0,
  matchesPlayed: 0,
  resultPoints: 0,
  participationBonus: 0,
  wonGamesBonus: 0,
  gameDiffBonus: 0,
  inactivityMalus: 0,
  recentForm: [],
  trend: 'steady',
  qualifiedForMaster: false,
  upcomingMatches: 0,
});

test('master bracket keeps standard seed pairings 1vs8, 2vs7, 3vs6, 4vs5', () => {
  const qualifiedPlayerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  const master = createSummerRankingMasterData(qualifiedPlayerIds, undefined, [], 'bracket');
  const quarterfinalPairs = (master.matches ?? [])
    .filter(match => match.stage === 'quarterfinal')
    .map(match => [match.player1Id, match.player2Id]);

  assert.equal(quarterfinalPairs.length, 4);
  assert.deepEqual(
    quarterfinalPairs
      .map(([left, right]) => [left, right].slice().sort().join(':'))
      .sort(),
    [
      ['p1', 'p8'],
      ['p2', 'p7'],
      ['p3', 'p6'],
      ['p4', 'p5'],
    ].map(pair => pair.slice().sort().join(':')).sort(),
  );

  const bracket = createSummerRankingMasterBracket(qualifiedPlayerIds);
  const setScore = (matchId, score1, score2) => {
    const match = bracket.matches.find(item => item.id === matchId);
    match.score1 = score1;
    match.score2 = score2;
  };
  setScore('master-qf-1', 6, 1); // p1
  setScore('master-qf-2', 6, 2); // p4
  setScore('master-qf-3', 6, 3); // p2
  setScore('master-qf-4', 6, 4); // p3

  const recomputed = recomputeSummerRankingMasterBracket(bracket);
  const sf1 = recomputed.matches.find(match => match.id === 'master-sf-1');
  const sf2 = recomputed.matches.find(match => match.id === 'master-sf-2');

  assert.deepEqual([sf1?.player1Id, sf1?.player2Id], ['p1', 'p4']);
  assert.deepEqual([sf2?.player1Id, sf2?.player2Id], ['p2', 'p3']);
});

test('Top 4 master bracket generates only semifinals and final', () => {
  const master = createSummerRankingMasterData(['p1', 'p2', 'p3', 'p4'], undefined, [], 'bracket');
  const stages = (master.matches ?? []).map(match => match.stage);

  assert.equal(stages.includes('quarterfinal'), false);
  assert.equal(stages.includes('thirdPlace'), false);
  assert.equal(stages.filter(stage => stage === 'semifinal').length, 2);
  assert.equal(stages.filter(stage => stage === 'final').length, 1);
  assert.deepEqual(
    (master.matches ?? [])
      .filter(match => match.stage === 'semifinal')
      .map(match => [match.player1Id, match.player2Id]),
    [
      ['p1', 'p4'],
      ['p2', 'p3'],
    ],
  );
});

test('manual replacement is accepted for Top 1 and propagated to generated data', () => {
  const ranking = ['p1', 'p2', 'p3'].map((id, index) => createRankingEntry(id, index + 1));
  const config = normalizeRulesConfig({ masterSize: 1 });

  const selected = getSummerRankingMasterQualifiedPlayerIds(ranking, {
    manualQualifiedPlayerIds: ['p3'],
  }, config);

  assert.deepEqual(selected, ['p3']);
  const topOneMaster = createSummerRankingMasterData(['p3'], ['p3'], [], 'bracket');
  assert.equal(topOneMaster.bracket?.isGenerated, true);
  assert.deepEqual(topOneMaster.matches, []);

  const fallbackConfig = normalizeRulesConfig({ masterSize: 2 });
  const fallbackToAuto = getSummerRankingMasterQualifiedPlayerIds(ranking, {
    manualQualifiedPlayerIds: ['p3', 'p3', 'unknown'],
  }, fallbackConfig);

  assert.deepEqual(fallbackToAuto, ['p1', 'p2']);

  const generated = createSummerRankingMasterData(['p1', 'p2', 'p3', 'p4'], undefined, [], 'bracket');
  const updated = createSummerRankingMasterData(['p5', 'p2', 'p3', 'p4'], ['p5', 'p2', 'p3', 'p4'], generated.matches, 'bracket');

  assert.deepEqual(updated.manualQualifiedPlayerIds, ['p5', 'p2', 'p3', 'p4']);
  assert.deepEqual(updated.generatedQualifiedPlayerIds, ['p5', 'p2', 'p3', 'p4']);
  assert.ok((updated.matches ?? []).some(match => match.player1Id === 'p5' || match.player2Id === 'p5'));
});
