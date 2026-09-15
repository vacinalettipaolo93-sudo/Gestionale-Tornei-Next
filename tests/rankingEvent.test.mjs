import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ranking-event-'));

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
  'utils/rankingEvent.ts',
], { cwd: repoRoot, stdio: 'pipe' });

for (const relativePath of ['utils/summerRanking.js', 'utils/padelIndividualRanking.js', 'utils/rankingEvent.js']) {
  const absolutePath = path.join(tempDir, relativePath);
  const source = readFileSync(absolutePath, 'utf8')
    .replaceAll("'../types'", "'../types.js'")
    .replaceAll("'./summerRanking'", "'./summerRanking.js'")
    .replaceAll("'./padelIndividualRanking'", "'./padelIndividualRanking.js'")
    .replaceAll("'./rankingEvent'", "'./rankingEvent.js'");
  writeFileSync(absolutePath, source);
}

const rankingEventModuleUrl = pathToFileURL(path.join(tempDir, 'utils/rankingEvent.js')).href;
const {
  createEmptyRankingData,
  getEventType,
  getRankingEventLabel,
  isRankingEventType,
} = await import(rankingEventModuleUrl);

test('label mapping exposes exactly Paitone Arena League for ranking_padel_individuale', () => {
  assert.equal(getRankingEventLabel('ranking_padel_individuale'), 'Paitone Arena League');
  assert.equal(getRankingEventLabel('ranking_singolare'), 'Ranking tennis singolare');
});

test('event type mapping and ranking initialization stay aligned for Paitone Arena League', () => {
  const eventType = getEventType({ eventType: 'ranking_padel_individuale' });
  assert.equal(eventType, 'ranking_padel_individuale');
  assert.equal(isRankingEventType(eventType), true);

  const rankingData = createEmptyRankingData(eventType);
  assert.equal(typeof rankingData.rules, 'string');
  assert.ok(rankingData.rules.includes('NON ESISTONO COPPIE FISSE'));
  assert.equal(rankingData.rulesConfig?.participationBonusEnabled, true);
  assert.equal(rankingData.rulesConfig?.wonGamesBonusEnabled, true);
  assert.equal(rankingData.rulesConfig?.masterSize, 16);
  assert.equal(rankingData.rulesConfig?.masterMinMatches, 6);
});
