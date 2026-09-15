import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ranking-availability-'));

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
  'utils/rankingAvailability.ts',
], { cwd: repoRoot, stdio: 'pipe' });

for (const relativePath of ['utils/rankingAvailability.js']) {
  const absolutePath = path.join(tempDir, relativePath);
  const source = readFileSync(absolutePath, 'utf8').replaceAll("'../types'", "'../types.js'");
  writeFileSync(absolutePath, source);
}

const rankingAvailabilityModuleUrl = pathToFileURL(path.join(tempDir, 'utils/rankingAvailability.js')).href;
const {
  buildAvailabilityPayload,
  getAvailabilitySummary,
  normalizeAvailabilityEntries,
} = await import(rankingAvailabilityModuleUrl);

test('legacy availability is normalized into editable entry format', () => {
  const entries = normalizeAvailabilityEntries({
    status: 'available',
    days: ['monday', 'wednesday'],
    periods: ['evening'],
  });

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].days, ['monday', 'wednesday']);
  assert.deepEqual(entries[0].periods, ['evening']);
});

test('availability payload preserves multiple entries and unavailable days', () => {
  const payload = buildAvailabilityPayload([
    { id: '1', status: 'available', days: ['monday'], periods: ['evening'] },
    { id: '2', status: 'unavailable', days: ['friday'], periods: [] },
  ]);

  assert.equal(payload.entries.length, 2);
  assert.deepEqual(payload.dayPeriods.monday, ['evening']);
  assert.equal(payload.dayPeriods.friday, undefined);
});

test('availability summary reports customized schedules clearly', () => {
  const summary = getAvailabilitySummary({
    entries: [
      { id: '1', status: 'available', days: ['monday'], periods: ['evening'] },
      { id: '2', status: 'available', days: ['wednesday'], periods: ['morning'] },
    ],
  });

  assert.equal(summary.status, 'Disponibilità personalizzata');
  assert.equal(summary.details, '2 disponibilità configurate');
});
