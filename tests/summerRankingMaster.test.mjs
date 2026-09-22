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
  syncSummerRankingMasterMatches,
  updateSummerRankingMasterBracketParticipants,
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

test('manual player override updates a quarterfinal slot and clears obsolete results', () => {
  const bracket = createSummerRankingMasterBracket(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
  const qf1 = bracket.matches.find(match => match.id === 'master-qf-1');
  qf1.score1 = 6;
  qf1.score2 = 2;

  const updated = updateSummerRankingMasterBracketParticipants({
    bracket,
    matchId: 'master-qf-1',
    player1Id: 'p9',
    player2Id: 'p8',
    validPlayerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'],
  });

  assert.ok(updated.bracket);
  const updatedQf1 = updated.bracket.matches.find(match => match.id === 'master-qf-1');
  assert.deepEqual([updatedQf1.player1Id, updatedQf1.player2Id], ['p9', 'p8']);
  assert.equal(updatedQf1.score1, null);
  assert.equal(updatedQf1.score2, null);
  assert.equal(updatedQf1.winnerId, null);
});

test('manual override can change a final pairing and persists across recompute', () => {
  const bracket = createSummerRankingMasterBracket(['p1', 'p2', 'p3', 'p4']);
  const setScore = (matchId, score1, score2) => {
    const match = bracket.matches.find(item => item.id === matchId);
    match.score1 = score1;
    match.score2 = score2;
  };
  setScore('master-sf-1', 6, 1);
  setScore('master-sf-2', 6, 3);
  const readyBracket = recomputeSummerRankingMasterBracket(bracket);

  const updated = updateSummerRankingMasterBracketParticipants({
    bracket: readyBracket,
    matchId: 'master-final',
    player1Id: 'p4',
    player2Id: 'p3',
    validPlayerIds: ['p1', 'p2', 'p3', 'p4'],
  });

  assert.ok(updated.bracket);
  const final = updated.bracket.matches.find(match => match.id === 'master-final');
  assert.deepEqual([final.player1Id, final.player2Id], ['p4', 'p3']);
  assert.deepEqual([final.manualPlayer1Id, final.manualPlayer2Id], ['p4', 'p3']);

  const restored = recomputeSummerRankingMasterBracket(JSON.parse(JSON.stringify(updated.bracket)));
  const restoredFinal = restored.matches.find(match => match.id === 'master-final');
  assert.deepEqual([restoredFinal.player1Id, restoredFinal.player2Id], ['p4', 'p3']);
});

test('changing participants resets result on the edited match and on downstream matches', () => {
  const bracket = createSummerRankingMasterBracket(['p1', 'p2', 'p3', 'p4']);
  const setScore = (matchId, score1, score2) => {
    const match = bracket.matches.find(item => item.id === matchId);
    match.score1 = score1;
    match.score2 = score2;
  };
  setScore('master-sf-1', 6, 1);
  setScore('master-sf-2', 6, 4);
  let recomputed = recomputeSummerRankingMasterBracket(bracket);
  const final = recomputed.matches.find(match => match.id === 'master-final');
  final.score1 = 7;
  final.score2 = 5;
  recomputed = recomputeSummerRankingMasterBracket(recomputed);

  const updated = updateSummerRankingMasterBracketParticipants({
    bracket: recomputed,
    matchId: 'master-sf-1',
    player1Id: 'p4',
    player2Id: 'p1',
    validPlayerIds: ['p1', 'p2', 'p3', 'p4'],
  });

  assert.ok(updated.bracket);
  const updatedSemifinal = updated.bracket.matches.find(match => match.id === 'master-sf-1');
  const updatedFinal = updated.bracket.matches.find(match => match.id === 'master-final');
  assert.equal(updatedSemifinal.score1, null);
  assert.equal(updatedSemifinal.score2, null);
  assert.equal(updatedSemifinal.winnerId, null);
  assert.equal(updatedFinal.score1, null);
  assert.equal(updatedFinal.score2, null);
  assert.equal(updatedFinal.winnerId, null);
});

test('manual overrides reject invalid ids and duplicates in the same round', () => {
  const bracket = createSummerRankingMasterBracket(['p1', 'p2', 'p3', 'p4']);

  const invalid = updateSummerRankingMasterBracketParticipants({
    bracket,
    matchId: 'master-sf-1',
    player1Id: 'unknown',
    player2Id: 'p4',
    validPlayerIds: ['p1', 'p2', 'p3', 'p4'],
  });
  assert.equal(invalid.bracket, undefined);
  assert.match(invalid.error ?? '', /giocatori validi/i);

  const duplicate = updateSummerRankingMasterBracketParticipants({
    bracket,
    matchId: 'master-sf-2',
    player1Id: 'p1',
    player2Id: 'p3',
    validPlayerIds: ['p1', 'p2', 'p3', 'p4'],
  });
  assert.equal(duplicate.bracket, undefined);
  assert.match(duplicate.error ?? '', /duplicati/i);
});

test('manual overrides survive persistence-like serialization and match syncing', () => {
  const bracket = createSummerRankingMasterBracket(['p1', 'p2', 'p3', 'p4']);
  const updated = updateSummerRankingMasterBracketParticipants({
    bracket,
    matchId: 'master-final',
    player1Id: 'p3',
    player2Id: null,
    validPlayerIds: ['p1', 'p2', 'p3', 'p4'],
  });

  assert.ok(updated.bracket);
  const restoredBracket = JSON.parse(JSON.stringify(updated.bracket));
  const restoredFinal = restoredBracket.matches.find(match => match.id === 'master-final');
  assert.deepEqual([restoredFinal.manualPlayer1Id, restoredFinal.manualPlayer2Id], ['p3', null]);

  const syncedMatches = syncSummerRankingMasterMatches(recomputeSummerRankingMasterBracket(restoredBracket));
  const finalMatch = syncedMatches.find(match => match.id === 'master-final');
  assert.deepEqual([finalMatch.player1Id, finalMatch.player2Id], ['p3', null]);
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

test('Top 4 manual overrides keep the bracket limited to semifinals and final', () => {
  const master = createSummerRankingMasterData(['p1', 'p2', 'p3', 'p4'], undefined, [], 'bracket');
  const updated = updateSummerRankingMasterBracketParticipants({
    bracket: master.bracket,
    matchId: 'master-final',
    player1Id: 'p4',
    player2Id: null,
    validPlayerIds: ['p1', 'p2', 'p3', 'p4'],
  });

  assert.ok(updated.bracket);
  const stages = updated.bracket.matches.map(match => match.id);
  assert.equal(stages.some(id => id.startsWith('master-qf-')), false);
  assert.equal(stages.includes('master-third'), false);
  const final = updated.bracket.matches.find(match => match.id === 'master-final');
  assert.deepEqual([final.player1Id, final.player2Id], ['p4', null]);
});
