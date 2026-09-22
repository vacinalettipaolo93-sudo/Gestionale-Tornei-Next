import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'event-status-'));

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
  'utils/eventStatus.ts',
], { cwd: repoRoot, stdio: 'pipe' });

{
  const absolutePath = path.join(tempDir, 'utils/eventStatus.js');
  const source = readFileSync(absolutePath, 'utf8')
    .replaceAll("'../types'", "'../types.js'");
  writeFileSync(absolutePath, source);
}

const eventStatusModuleUrl = pathToFileURL(path.join(tempDir, 'utils/eventStatus.js')).href;
const { isTournamentConcluded, isEventConcluded } = await import(eventStatusModuleUrl);

const buildTournament = (overrides = {}) => ({
  id: 't1',
  name: 'Torneo 1',
  groups: [],
  settings: {
    pointsPerDraw: 1,
    pointRules: [],
    tieBreakers: [],
    playoffSettings: [],
    hasBronzeFinal: false,
    consolationSettings: [],
  },
  timeSlots: [],
  playoffs: null,
  consolationBracket: null,
  playoffMatches: [],
  consolationMatches: [],
  ...overrides,
});

test('newly created tournament is in corso (not concluded)', () => {
  const tournament = buildTournament();
  assert.equal(isTournamentConcluded(tournament), false);
});

test('tournament is not concluded after semifinal result only', () => {
  const tournament = buildTournament({
    playoffs: {
      isGenerated: true,
      finalId: 'final-1',
      bronzeFinalId: null,
      matches: [
        { id: 'semi-1', round: 1, matchIndex: 1, player1Id: 'p1', player2Id: 'p2', score1: 6, score2: 4, winnerId: 'p1', nextMatchId: 'final-1' },
        { id: 'semi-2', round: 1, matchIndex: 2, player1Id: 'p3', player2Id: 'p4', score1: null, score2: null, winnerId: null, nextMatchId: 'final-1' },
        { id: 'final-1', round: 2, matchIndex: 1, player1Id: 'p1', player2Id: null, score1: null, score2: null, winnerId: null, nextMatchId: null },
      ],
    },
  });
  assert.equal(isTournamentConcluded(tournament), false);
});

test('tournament is concluded when final result is valid and saved', () => {
  const tournament = buildTournament({
    playoffs: {
      isGenerated: true,
      finalId: 'final-1',
      bronzeFinalId: 'bronze-1',
      matches: [
        { id: 'semi-1', round: 1, matchIndex: 1, player1Id: 'p1', player2Id: 'p2', score1: 6, score2: 4, winnerId: 'p1', nextMatchId: 'final-1' },
        { id: 'semi-2', round: 1, matchIndex: 2, player1Id: 'p3', player2Id: 'p4', score1: 6, score2: 3, winnerId: 'p3', nextMatchId: 'final-1' },
        { id: 'bronze-1', round: 2, matchIndex: 2, player1Id: 'p2', player2Id: 'p4', score1: null, score2: null, winnerId: null, nextMatchId: null, isBronzeFinal: true },
        { id: 'final-1', round: 2, matchIndex: 1, player1Id: 'p1', player2Id: 'p3', score1: 7, score2: 5, winnerId: 'p1', nextMatchId: null },
      ],
    },
  });
  assert.equal(isTournamentConcluded(tournament), true);
  const finalMatch = tournament.playoffs.matches.find(match => match.id === 'final-1');
  assert.equal(finalMatch.winnerId, 'p1');
});

test('tournament returns to in corso when final result is reset', () => {
  const tournament = buildTournament({
    playoffs: {
      isGenerated: true,
      finalId: 'final-1',
      bronzeFinalId: null,
      matches: [
        { id: 'final-1', round: 2, matchIndex: 1, player1Id: 'p1', player2Id: 'p3', score1: null, score2: null, winnerId: null, nextMatchId: null },
      ],
    },
  });
  assert.equal(isTournamentConcluded(tournament), false);
});

test('event enters conclusi for knockout tournament format after final', () => {
  const event = {
    id: 'e1',
    name: 'Evento KO',
    invitationCode: 'ABC',
    players: [],
    eventType: 'tournament_singolare',
    tournaments: [
      buildTournament({
        playoffs: {
          isGenerated: true,
          finalId: 'f1',
          bronzeFinalId: null,
          matches: [{ id: 'f1', round: 1, matchIndex: 1, player1Id: 'p1', player2Id: 'p2', score1: 6, score2: 3, winnerId: 'p1', nextMatchId: null }],
        },
      }),
    ],
  };
  assert.equal(isEventConcluded(event), true);
});

test('ranking event enters conclusi only after master final (second format)', () => {
  const rankingEvent = {
    id: 'e2',
    name: 'Summer Ranking',
    invitationCode: 'DEF',
    players: [],
    eventType: 'ranking_singolare',
    tournaments: [],
    rankingData: {
      matches: [],
      slots: [],
      participantIds: [],
      master: {
        format: 'bracket',
        bracket: { isGenerated: true, finalId: 'master-final', bronzeFinalId: null, matches: [] },
        matches: [
          { id: 'master-semi-1', round: 1, label: 'Semifinale 1', stage: 'semifinal', player1Id: 'p1', player2Id: 'p2', score1: 6, score2: 4, status: 'completed' },
          { id: 'master-final', round: 2, label: 'Finale', stage: 'final', player1Id: 'p1', player2Id: 'p3', score1: null, score2: null, status: 'pending' },
        ],
      },
    },
  };
  assert.equal(isEventConcluded(rankingEvent), false);

  rankingEvent.rankingData.master.matches[1] = {
    ...rankingEvent.rankingData.master.matches[1],
    score1: 7,
    score2: 6,
    status: 'completed',
    completedAt: new Date().toISOString(),
  };
  assert.equal(isEventConcluded(rankingEvent), true);
});
