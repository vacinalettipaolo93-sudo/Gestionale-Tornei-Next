import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tournament-availability-'));
try {
  execFileSync('npx', [
    'tsc', '--outDir', tempDir, '--module', 'ESNext', '--target', 'ES2022',
    '--moduleResolution', 'bundler', '--skipLibCheck', '--lib', 'ES2022,DOM',
    'utils/tournamentAvailabilityPeriods.ts',
  ], { cwd: process.cwd(), stdio: 'pipe' });
  const periodsPath = path.join(tempDir, 'utils/tournamentAvailabilityPeriods.js');
  writeFileSync(periodsPath, readFileSync(periodsPath, 'utf8')
    .replaceAll("'./tournamentVenues'", "'./tournamentVenues.js'"));
  const { isTournamentAvailabilityPeriodAllowedOnDate } =
    await import(pathToFileURL(periodsPath).href);

  test('evening availability is disallowed on Saturday and Sunday but remains allowed Friday', () => {
    assert.equal(isTournamentAvailabilityPeriodAllowedOnDate('EVENING', '2030-06-08'), false);
    assert.equal(isTournamentAvailabilityPeriodAllowedOnDate('EVENING', '2030-06-09'), false);
    assert.equal(isTournamentAvailabilityPeriodAllowedOnDate('EVENING', '2030-06-07'), true);
    assert.equal(isTournamentAvailabilityPeriodAllowedOnDate('AFTERNOON', '2030-06-08'), true);
    assert.equal(isTournamentAvailabilityPeriodAllowedOnDate('MORNING', '2030-06-09'), true);
    assert.equal(isTournamentAvailabilityPeriodAllowedOnDate('EVENING', 'invalid'), false);
  });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
