import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../utils/groupMatchGeneration.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { getMissingGroupMatchups } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`,
);

const match = (player1Id, player2Id, overrides = {}) => ({
  id: `${player1Id}-${player2Id}`,
  player1Id,
  player2Id,
  score1: null,
  score2: null,
  status: 'pending',
  ...overrides,
});

test('single round-robin adds only fixtures involving newly assigned players', () => {
  const completed = match('a', 'b', { status: 'completed', score1: 6, score2: 4 });
  const scheduled = match('c', 'a', {
    status: 'scheduled',
    scheduledTime: '2035-06-08T10:00:00.000Z',
    location: 'Canottieri Salò',
    field: 'Campo 2',
    slotId: 'booking-1',
  });
  const existing = [completed, scheduled];

  assert.deepEqual(getMissingGroupMatchups(['a', 'b', 'c', 'd'], existing, false), [
    ['a', 'd'],
    ['b', 'c'],
    ['b', 'd'],
    ['c', 'd'],
  ]);
  assert.equal(existing[0], completed);
  assert.equal(existing[1], scheduled);
  assert.equal(scheduled.slotId, 'booking-1');
  assert.equal(completed.score1, 6);
});

test('double round-robin preserves existing legs and adds only missing return fixtures', () => {
  const existing = [
    match('a', 'b', { status: 'completed', score1: 6, score2: 4 }),
    match('c', 'a', { status: 'scheduled', slotId: 'booking-1' }),
  ];

  assert.deepEqual(getMissingGroupMatchups(['a', 'b', 'c'], existing, true), [
    ['b', 'a'],
    ['a', 'c'],
    ['b', 'c'],
    ['c', 'b'],
  ]);
});

test('regenerating an unchanged roster creates no duplicate fixtures', () => {
  const playerIds = ['a', 'b', 'c'];
  const firstGeneration = getMissingGroupMatchups(playerIds, [], true);
  const savedMatches = firstGeneration.map(([player1Id, player2Id], index) =>
    match(player1Id, player2Id, { id: `saved-${index}` }),
  );

  assert.deepEqual(getMissingGroupMatchups(playerIds, savedMatches, true), []);
  assert.deepEqual(getMissingGroupMatchups(['a', 'a', 'b'], [], false), [['a', 'b']]);
});
