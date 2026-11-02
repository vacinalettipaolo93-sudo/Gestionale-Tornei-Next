import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'match-finder-'));
after(() => rmSync(tempDir, { recursive: true }));
execFileSync('npx', [
  'tsc', '--outDir', tempDir, '--module', 'ESNext', '--target', 'ES2022',
  '--moduleResolution', 'bundler', '--skipLibCheck', '--lib', 'ES2022,DOM,DOM.Iterable',
  'types.ts', 'utils/matchFinder.ts', 'utils/tournamentAvailability.ts',
], { cwd: process.cwd(), stdio: 'pipe' });
const finderPath = path.join(tempDir, 'utils/matchFinder.js');
writeFileSync(finderPath, readFileSync(finderPath, 'utf8')
  .replaceAll("'./rankingAvailability'", "'./rankingAvailability.js'")
  .replaceAll("'./padel'", "'./padel.js'")
  .replaceAll("'./tournamentAvailability'", "'./tournamentAvailability.js'"));
const availabilityPath = path.join(tempDir, 'utils/tournamentAvailability.js');
writeFileSync(availabilityPath, readFileSync(availabilityPath, 'utf8')
  .replaceAll("'./tournamentVenues'", "'./tournamentVenues.js'"));
const { getRankingMatchSuggestions, getTournamentMatchSuggestions, hasRankingAvailability } =
  await import(pathToFileURL(finderPath).href);
const { getAvailabilityDateKey, getTournamentAvailabilitySlots, normalizeTournamentSlot } =
  await import(pathToFileURL(path.join(tempDir, 'utils/tournamentAvailability.js')).href);

const player = id => ({ id, name: `Giocatore ${id}`, status: 'confirmed', phone: '123', avatar: '' });
const players = ['a', 'b', 'c', 'd', 'e', 'f'].map(player);
const weekly = (days = ['monday'], periods = ['evening']) => ({ status: 'available', days, periods });
const pending = (id, player1Id, player2Id, overrides = {}) => ({
  id, player1Id, player2Id, score1: null, score2: null, status: 'pending', ...overrides,
});
const now = Date.parse('2030-01-01T00:00:00Z');
const slot = (id, start = '2030-06-03T18:00:00Z', overrides = {}) => ({
  id, start, location: 'Circolo', field: 'Campo 1', ...overrides,
});
const tournament = overrides => ({
  id: 't1', groups: [{ id: 'g1', playerIds: ['a', 'b'], matches: [pending('ab', 'a', 'b')] }],
  timeSlots: [slot('s1')], playoffMatches: [], consolationMatches: [], ...overrides,
});
const event = (t, overrides = {}) => ({
  id: 'e1', eventType: 'tournament_singolare', players, tournaments: [t],
  globalTimeSlots: [slot('s1')], ...overrides,
});
const availability = (ids = ['a', 'b'], slots = ['s1']) => ({
  slotPrefMap: Object.fromEntries(ids.map(id => [id, new Set(slots)])),
  dateUnavailMap: {},
});

test('ranking suggestions require the same day AND period, never the cartesian union of days and periods', () => {
  const saved = {
    a: { dayPeriods: { monday: ['morning'], tuesday: ['evening'] } },
    b: { dayPeriods: { monday: ['evening'], tuesday: ['morning'] } },
    c: weekly(['tuesday'], ['evening']),
  };
  const suggestions = getRankingMatchSuggestions('a', players, saved);
  assert.deepEqual(suggestions.map(item => item.id), ['c']);
  assert.deepEqual(suggestions[0].commonTimes, ['Martedì: Sera']);
});

test('missing declarations, unavailable players, pending registrations and self are not suggestions', () => {
  const saved = {
    a: weekly(), b: weekly(), c: { status: 'unavailable', days: ['monday'] },
    d: weekly(), e: { status: 'available', days: ['monday'], periods: [] },
  };
  const candidates = players.map(item => item.id === 'd' ? { ...item, status: 'pending' } : item);
  assert.deepEqual(getRankingMatchSuggestions('a', candidates, saved).map(item => item.id), ['b']);
  assert.deepEqual(getRankingMatchSuggestions('a', candidates, {}), []);
  assert.equal(hasRankingAvailability(undefined), false);
  assert.equal(hasRankingAvailability({ status: 'unavailable' }), false);
});

test('entry-based and legacy availability are compatible, with saved day exclusions applied', () => {
  const saved = {
    a: { entries: [
      { status: 'available', days: ['monday', 'tuesday'], periods: ['evening'] },
      { status: 'unavailable', days: ['monday'] },
    ] },
    b: weekly(['monday', 'tuesday']),
    c: { dayPeriods: { monday: ['evening'] } },
  };
  const suggestions = getRankingMatchSuggestions('a', players, saved);
  assert.deepEqual(suggestions.map(item => item.id), ['b']);
  assert.deepEqual(suggestions[0].commonTimes, ['Martedì: Sera']);
  assert.equal(hasRankingAvailability(saved.a), true);
});

test('ranking preserves supplied eligibility and sorts most compatible opponents first', () => {
  const saved = { a: weekly(['monday', 'tuesday']), b: weekly(), c: weekly(['monday', 'tuesday']) };
  assert.deepEqual(getRankingMatchSuggestions('a', players, saved).map(item => item.id), ['c', 'b']);
  assert.deepEqual(getRankingMatchSuggestions('a', [players[1]], saved).map(item => item.id), ['b']);
});

test('Padel individual compares real players, not team ids, and leaves room for free partners', () => {
  const suggestions = getRankingMatchSuggestions('a', players, { a: weekly(), d: weekly() });
  assert.deepEqual(suggestions.map(item => item.id), ['d']);
  assert.deepEqual(suggestions[0].contacts, [players[3]]);
});

test('tennis tournaments only suggest opponents from remaining matches, including a reverse fixture', () => {
  const t = tournament({ groups: [{ matches: [
    pending('ab', 'a', 'b'),
    pending('ca', 'c', 'a', { status: 'completed', score1: 2, score2: 1 }),
    pending('da', 'd', 'a'),
    pending('ef', 'e', 'f'),
  ] }] });
  const data = availability(['a', 'b', 'c', 'd', 'e', 'f']);
  const suggestions = getTournamentMatchSuggestions(event(t), t, 'a', data, now);
  assert.deepEqual(suggestions.map(item => item.id), ['b', 'd']);
  assert.equal(suggestions[0].commonTimes.length, 1);
  assert.match(suggestions[0].commonTimes[0], /Circolo · Campo 1/);
});

test('completed scores and unresolved playoff participants do not produce suggestions', () => {
  const t = tournament({ groups: [{ matches: [
    pending('ab', 'a', 'b', { score1: 2, score2: 1 }),
    pending('ac', 'a', ''),
    pending('aa', 'a', 'a'),
  ] }] });
  assert.deepEqual(getTournamentMatchSuggestions(event(t), t, 'a', availability(), now), []);
});

test('remaining playoff and consolation opponents are included, unrelated groups are excluded', () => {
  const t = tournament({
    groups: [{ matches: [pending('ef', 'e', 'f')] }],
    playoffMatches: [pending('po-ab', 'a', 'b')],
    consolationMatches: [pending('co-ac', 'c', 'a', { status: 'scheduled' })],
  });
  assert.deepEqual(
    getTournamentMatchSuggestions(event(t), t, 'a', availability(['a', 'b', 'c', 'e', 'f']), now).map(item => item.id),
    ['b', 'c'],
  );
});

test('tournaments never infer availability from an absent preference or from different slot ids', () => {
  const t = tournament();
  for (const data of [
    availability(['a']),
    availability(['b']),
    { slotPrefMap: { a: new Set(['s1']), b: new Set(['s2']) }, dateUnavailMap: {} },
  ]) {
    assert.deepEqual(getTournamentMatchSuggestions(event(t), t, 'a', data, now), []);
  }
});

test('explicit date unavailability overrides a shared slot for either participant', () => {
  const t = tournament();
  for (const id of ['a', 'b']) {
    const data = availability();
    data.dateUnavailMap[id] = new Set([getAvailabilityDateKey(slot('s1').start)]);
    assert.deepEqual(getTournamentMatchSuggestions(event(t), t, 'a', data, now), []);
  }
});

const padelTournament = () => tournament({
  groups: [{ playerIds: ['team1', 'team2'], matches: [pending('teams', 'team1', 'team2')] }],
  padelTeams: [
    { id: 'team1', name: 'Coppia A', player1Id: 'a', player2Id: 'b' },
    { id: 'team2', name: 'Coppia B', player1Id: 'c', player2Id: 'd' },
  ],
});

test('Padel fixed teams require the very same slot for all four players and expose both opponent contacts', () => {
  const t = padelTournament();
  const e = event(t, { eventType: 'tournament_padel' });
  for (const id of ['a', 'b', 'c', 'd']) {
    const data = availability(['a', 'b', 'c', 'd']);
    delete data.slotPrefMap[id];
    assert.deepEqual(getTournamentMatchSuggestions(e, t, 'a', data, now), []);
  }
  const suggestions = getTournamentMatchSuggestions(e, t, 'a', availability(['a', 'b', 'c', 'd']), now);
  assert.deepEqual(suggestions.map(item => item.id), ['team2']);
  assert.deepEqual(suggestions[0].contacts.map(item => item.id), ['c', 'd']);
  assert.match(suggestions[0].name, /Coppia B/);
});

test('Padel partner date exclusions, missing player records and unassigned users prevent suggestions', () => {
  const t = padelTournament();
  const e = event(t, { eventType: 'tournament_padel' });
  const data = availability(['a', 'b', 'c', 'd']);
  data.dateUnavailMap.b = new Set([getAvailabilityDateKey(slot('s1').start)]);
  assert.deepEqual(getTournamentMatchSuggestions(e, t, 'a', data, now), []);
  assert.deepEqual(getTournamentMatchSuggestions(e, t, 'e', availability(['a', 'b', 'c', 'd', 'e']), now), []);
  assert.deepEqual(getTournamentMatchSuggestions(
    { ...e, players: players.filter(item => item.id !== 'd') }, t, 'a', availability(['a', 'b', 'c', 'd']), now,
  ), []);
});

test('slot normalization supports legacy aliases, timestamps and rejects invalid dates', () => {
  assert.equal(normalizeTournamentSlot({ slotId: 'legacy', time: '2030-06-03 18:00:00' }).id, 'legacy');
  assert.equal(normalizeTournamentSlot({ id: 'numeric', start: 1906740000 }).start, new Date(1906740000000).toISOString());
  assert.equal(normalizeTournamentSlot({ id: 'bad', start: 'not-a-date' }), null);
  assert.equal(normalizeTournamentSlot({ id: 'out-of-range', start: 1e20 }), null);
});

test('only tournament-local future free slots survive, including bookings in its own groups and finals', () => {
  const t = tournament({
    timeSlots: [
      slot('s1'), slot('s1'), slot('old', '2029-01-01T00:00:00Z'), slot('invalid', 'bad'),
      slot('at-now', new Date(now).toISOString()), slot('s2', '2030-06-04T18:00:00Z'),
      slot('s3', '2030-06-05T18:00:00Z'), slot('s4', '2030-06-06T18:00:00Z'),
    ],
    groups: [{ matches: [pending('booked', 'e', 'f', { slotId: 's2' })] }],
    playoffMatches: [pending('final', 'e', 'f', { slotId: 's3' })],
    consolationMatches: [pending('third', 'e', 'f', {
      scheduledTime: '2030-06-06T18:00:00Z', location: 'Circolo', field: 'Campo 1',
    })],
  });
  const other = tournament({
    id: 'other', groups: [{ matches: [pending('booked', 'e', 'f', { slotId: 's2' })] }],
    playoffMatches: [pending('final', 'e', 'f', { slotId: 's3' })],
    consolationMatches: [pending('third', 'e', 'f', { scheduledTime: '2030-06-06T18:00:00Z' })],
  });
  const e = event(t, {
    tournaments: [t, other],
    globalTimeSlots: [
      slot('s1'), slot('s2', '2030-06-04T18:00:00Z'), slot('s3', '2030-06-05T18:00:00Z'),
      slot('s4', '2030-06-06T18:00:00Z'), slot('invalid', 'bad'), slot('at-now', new Date(now).toISOString()),
    ],
  });
  assert.deepEqual(getTournamentAvailabilitySlots(e, t, now).map(item => item.id), ['s1']);
});

test('other tournaments and legacy event-wide slots do not affect local availability or matching', () => {
  const t = tournament();
  const other = tournament({ id: 'other', groups: [{ matches: [pending('busy', 'c', 'd', { slotId: 's1' })] }] });
  const e = event(t, { tournaments: [t, other], globalTimeSlots: [slot('global-only')] });
  assert.deepEqual(getTournamentAvailabilitySlots(e, t, now).map(item => item.id), ['s1']);
  assert.equal(getTournamentMatchSuggestions(e, t, 'a', availability(), now).length, 1);
  const empty = { ...t, timeSlots: [] };
  assert.deepEqual(getTournamentAvailabilitySlots(e, empty, now), []);
  assert.deepEqual(getTournamentMatchSuggestions(e, empty, 'a', availability(), now), []);
});

test('availability edits and fixture completion immediately change recomputed suggestions without mutating input', () => {
  const t = tournament();
  const e = event(t);
  const original = structuredClone(e);
  const data = availability();
  assert.equal(getTournamentMatchSuggestions(e, t, 'a', data, now).length, 1);
  assert.deepEqual(e, original);
  data.slotPrefMap.b.clear();
  assert.equal(getTournamentMatchSuggestions(e, t, 'a', data, now).length, 0);
  data.slotPrefMap.b.add('s1');
  t.groups[0].matches[0].status = 'completed';
  assert.equal(getTournamentMatchSuggestions(e, t, 'a', data, now).length, 0);
});
