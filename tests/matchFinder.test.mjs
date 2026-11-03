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
  .replaceAll("'./tournamentVenues'", "'./tournamentVenues.js'")
  .replaceAll("'./tournamentAvailabilityPeriods'", "'./tournamentAvailabilityPeriods.js'")
  .replaceAll("'./tournamentAvailability'", "'./tournamentAvailability.js'"));
const availabilityPath = path.join(tempDir, 'utils/tournamentAvailability.js');
writeFileSync(availabilityPath, readFileSync(availabilityPath, 'utf8')
  .replaceAll("'./tournamentVenues'", "'./tournamentVenues.js'"));
const periodsPath = path.join(tempDir, 'utils/tournamentAvailabilityPeriods.js');
writeFileSync(periodsPath, readFileSync(periodsPath, 'utf8')
  .replaceAll("'./tournamentVenues'", "'./tournamentVenues.js'"));
const { getRankingMatchSuggestions, getTournamentMatchSuggestions, hasRankingAvailability } =
  await import(pathToFileURL(finderPath).href);
const { getAvailabilityDateKey, getTournamentAvailabilitySlots, normalizeTournamentSlot } =
  await import(pathToFileURL(path.join(tempDir, 'utils/tournamentAvailability.js')).href);
const { getTournamentWeekends, TOURNAMENT_AVAILABILITY_PERIODS } =
  await import(pathToFileURL(path.join(tempDir, 'utils/tournamentAvailabilityPeriods.js')).href);

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
  periodMap: {},
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

test('tournaments never infer availability from an absent preference or from nonexistent slot ids', () => {
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

test('Padel fixed teams require declarations from all four players and expose both opponent contacts', () => {
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

test('only event-wide future free slots survive, including bookings in groups and finals', () => {
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

test('bookings in another tournament of the event also remove slots from matching suggestions', () => {
  const t = tournament();
  const other = tournament({ id: 'other', groups: [{ matches: [pending('busy', 'c', 'd', { slotId: 's1' })] }] });
  const e = event(t, { tournaments: [t, other], globalTimeSlots: [slot('global-only')] });
  assert.deepEqual(getTournamentAvailabilitySlots(e, t, now), []);
  assert.equal(getTournamentMatchSuggestions(e, t, 'a', availability(), now).length, 0);
  const empty = { ...t, timeSlots: [] };
  assert.deepEqual(getTournamentAvailabilitySlots(e, empty, now), []);
  assert.deepEqual(getTournamentMatchSuggestions(e, empty, 'a', availability(), now), []);
});

test('event-global and old tournament slots appear in every tournament without exposing other events', () => {
  const first = tournament();
  const second = tournament({ id: 'second', timeSlots: [] });
  const e = event(first, { tournaments: [first, second], globalTimeSlots: [slot('global', '2030-07-01T18:00:00Z')] });
  for (const t of e.tournaments) {
    assert.deepEqual(getTournamentAvailabilitySlots(e, t, now).map(item => item.id), ['s1', 'global']);
  }
  const otherEvent = event(second, { tournaments: [second], globalTimeSlots: [] });
  assert.deepEqual(getTournamentAvailabilitySlots(otherEvent, second, now), []);
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

test('expiry removes common availability and opponent suggestions exactly at its deadline', () => {
  const expiresAt = '2030-02-01T12:00:00Z';
  const deadline = Date.parse(expiresAt);
  const t = tournament({ timeSlots: [slot('s1', '2030-06-03T18:00:00Z', { expiresAt })] });
  const e = event(t, { globalTimeSlots: [] });
  assert.equal(getTournamentMatchSuggestions(e, t, 'a', availability(), deadline - 1).length, 1);
  assert.deepEqual(getTournamentMatchSuggestions(e, t, 'a', availability(), deadline), []);
  assert.deepEqual(getTournamentAvailabilitySlots(e, t, deadline), []);
});

const venueSlot = (id, location = 'Canottieri Salò', start = '2030-06-03T18:00:00Z', field = 'Campo 1') =>
  slot(id, start, { location, field });
const chosen = selections => ({
  slotPrefMap: Object.fromEntries(Object.entries(selections).map(([id, slots]) => [id, new Set(slots)])),
  dateUnavailMap: {},
  periodMap: {},
});
const findWithSlots = (slots, data, overrides = {}) => {
  const t = tournament({ timeSlots: slots, ...overrides });
  return getTournamentMatchSuggestions(event(t, { globalTimeSlots: [] }), t, 'a', data, now);
};

test('same centre and instant are exact compatibility even with different court slot ids and legacy centre labels', () => {
  const suggestions = findWithSlots([
    venueSlot('court1'),
    venueSlot('court2', 'Canottieri Salo', '2030-06-03T20:00:00+02:00', 'Campo 2'),
  ], chosen({ a: ['court1'], b: ['court2'] }));
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].compatibility, 'exact');
});

test('same date and centre with different times is an explicit alternative with both declared times', () => {
  const suggestions = findWithSlots([
    venueSlot('early'), venueSlot('late', 'Canottieri Salò', '2030-06-03T20:00:00Z'),
  ], chosen({ a: ['early'], b: ['late'] }));
  assert.equal(suggestions[0].compatibility, 'different-time');
  assert.match(suggestions[0].commonTimes[0], /Giocatore a: Canottieri Salò/);
  assert.match(suggestions[0].commonTimes[0], /Giocatore b: Canottieri Salò/);
  for (const time of ['2030-06-03T18:00:00Z', '2030-06-03T20:00:00Z']) {
    const localTime = new Date(time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    assert.notEqual(suggestions[0].commonTimes[0].indexOf(localTime), -1);
  }
});

test('same date but different centres is last-tier alternative, including different times', () => {
  for (const time of ['2030-06-03T18:00:00Z', '2030-06-03T20:00:00Z']) {
    const suggestions = findWithSlots([venueSlot('salo'), venueSlot('paitone', 'Paitone Arena', time)],
      chosen({ a: ['salo'], b: ['paitone'] }));
    assert.equal(suggestions[0].compatibility, 'different-venue');
    assert.match(suggestions[0].commonTimes[0], /Giocatore a: Canottieri Salò/);
    assert.match(suggestions[0].commonTimes[0], /Giocatore b: Paitone Arena/);
  }
});

test('different dates, missing declarations and excluded dates never create fallback alternatives', () => {
  const slots = [venueSlot('salo'), venueSlot('paitone', 'Paitone Arena', '2030-06-04T18:00:00Z')];
  assert.deepEqual(findWithSlots(slots, chosen({ a: ['salo'], b: ['paitone'] })), []);
  assert.deepEqual(findWithSlots(slots, chosen({ a: ['salo'] })), []);
  const data = chosen({ a: ['salo'], b: ['salo'] });
  data.dateUnavailMap.b = new Set([getAvailabilityDateKey(slots[0].start)]);
  assert.deepEqual(findWithSlots(slots, data), []);
});

test('venue selection gates old slot preferences and selecting both restores them without mutating data', () => {
  const slots = [venueSlot('salo'), venueSlot('paitone', 'Paitone Arena')];
  const data = chosen({ a: ['salo', 'paitone'], b: ['salo'] });
  data.venueMap = { a: new Set(['paitone-arena']) };
  assert.equal(findWithSlots(slots, data)[0].compatibility, 'different-venue');
  data.venueMap.a = new Set(['canottieri-salo', 'paitone-arena']);
  const before = structuredClone(data);
  assert.equal(findWithSlots(slots, data)[0].compatibility, 'exact');
  assert.deepEqual(data, before);
  data.venueMap.a = new Set();
  assert.deepEqual(findWithSlots(slots, data), []);
});

test('all suggestion categories are sorted exact, different time, different centre regardless of opponent name', () => {
  const slots = [
    venueSlot('salo-early'), venueSlot('salo-late', 'Canottieri Salò', '2030-06-03T20:00:00Z'),
    venueSlot('paitone', 'Paitone Arena'),
  ];
  const suggestions = findWithSlots(slots, chosen({
    a: ['salo-early'], b: ['paitone'], c: ['salo-late'], d: ['salo-early'],
  }), { groups: [{ matches: [pending('ab', 'a', 'b'), pending('ac', 'a', 'c'), pending('ad', 'a', 'd')] }] });
  assert.deepEqual(suggestions.map(s => [s.id, s.compatibility]), [
    ['d', 'exact'], ['c', 'different-time'], ['b', 'different-venue'],
  ]);
});

test('one opponent can appear at different levels for different dates, using only the best level for each date', () => {
  const slots = [
    venueSlot('exact'), venueSlot('later', 'Canottieri Salò', '2030-06-03T20:00:00Z'),
    venueSlot('day2-a', 'Canottieri Salò', '2030-06-04T18:00:00Z'),
    venueSlot('day2-b', 'Canottieri Salò', '2030-06-04T20:00:00Z'),
    venueSlot('day3-a', 'Canottieri Salò', '2030-06-05T18:00:00Z'),
    venueSlot('day3-b', 'Paitone Arena', '2030-06-05T18:00:00Z'),
  ];
  const suggestions = findWithSlots(slots, chosen({
    a: ['exact', 'day2-a', 'day3-a'], b: ['exact', 'later', 'day2-b', 'day3-b'],
  }));
  assert.deepEqual(suggestions.map(s => s.compatibility), ['exact', 'different-time', 'different-venue']);
  assert.ok(suggestions.every(s => s.commonTimes.length === 1));
});

test('expired, booked and past declarations never create alternative suggestions', () => {
  const t = tournament({
    timeSlots: [
      venueSlot('salo'), { ...venueSlot('paitone', 'Paitone Arena'), expiresAt: '2020-01-01T00:00:00Z' },
      venueSlot('past', 'Paitone Arena', '2020-06-03T20:00:00Z'), venueSlot('booked', 'Paitone Arena'),
    ],
    playoffMatches: [pending('busy', 'c', 'd', { status: 'scheduled', slotId: 'booked' })],
  });
  assert.deepEqual(getTournamentMatchSuggestions(event(t, { globalTimeSlots: [] }), t, 'a',
    chosen({ a: ['salo'], b: ['paitone', 'past', 'booked'] }), now), []);
});

test('Padel requires real declarations from all four for alternative times and venues too', () => {
  const t = padelTournament();
  t.timeSlots = [
    venueSlot('early'), venueSlot('late', 'Canottieri Salò', '2030-06-03T20:00:00Z'),
    venueSlot('paitone', 'Paitone Arena'),
  ];
  const e = event(t, { globalTimeSlots: [], eventType: 'tournament_padel' });
  const data = chosen({ a: ['early'], b: ['early'], c: ['late'], d: ['late'] });
  assert.equal(getTournamentMatchSuggestions(e, t, 'a', data, now)[0].compatibility, 'different-time');
  data.slotPrefMap.d = new Set(['paitone']);
  assert.equal(getTournamentMatchSuggestions(e, t, 'a', data, now)[0].compatibility, 'different-venue');
  for (const id of ['a', 'b', 'c', 'd']) {
    const incomplete = structuredClone(data);
    delete incomplete.slotPrefMap[id];
    assert.deepEqual(getTournamentMatchSuggestions(e, t, 'a', incomplete, now), []);
  }
  data.dateUnavailMap.d = new Set([getAvailabilityDateKey(t.timeSlots[0].start)]);
  assert.deepEqual(getTournamentMatchSuggestions(e, t, 'a', data, now), []);
});

const periodsOnly = (declarations, overrides = {}) => {
  const data = { slotPrefMap: {}, dateUnavailMap: {}, periodMap: declarations, ...overrides };
  const t = tournament({ timeSlots: [], ...overrides.tournament });
  return getTournamentMatchSuggestions(event(t, { globalTimeSlots: [] }), t, 'a', data, now);
};
const period = (id, venueId, date, bands) => bands.map(band => ({ date, venueId, period: band }));

test('calendar exposes only the next 12 Friday-Sunday weekends with stable local date keys', () => {
  const weekends = getTournamentWeekends(new Date(2030, 0, 1, 23), 12);
  assert.equal(weekends.length, 12);
  assert.deepEqual(weekends[0], { friday: '2030-01-04', saturday: '2030-01-05', sunday: '2030-01-06' });
  assert.deepEqual(weekends[11], { friday: '2030-03-22', saturday: '2030-03-23', sunday: '2030-03-24' });
  assert.ok(TOURNAMENT_AVAILABILITY_PERIODS.map(item => [item.id, item.startHour, item.endHour]).every(
    (item, index) => JSON.stringify(item) === JSON.stringify([
      ['MORNING', 8, 12], ['AFTERNOON', 12, 18], ['EVENING', 18, 22],
    ][index]),
  ));
});

test('same date, centre and period are exact; same centre with different periods is a coordinated alternative', () => {
  const date = '2030-06-09';
  const exact = periodsOnly({
    a: period('a', 'canottieri-salo', date, ['MORNING', 'EVENING']),
    b: period('b', 'canottieri-salo', date, ['EVENING']),
  });
  assert.equal(exact.length, 1);
  assert.equal(exact[0].compatibility, 'exact');
  assert.match(exact[0].commonTimes[0], /domenica 9 giugno/);
  assert.match(exact[0].commonTimes[0], /Canottieri Salò · Sera \(18:00–22:00\)/);

  const differentTime = periodsOnly({
    a: period('a', 'canottieri-salo', date, ['MORNING']),
    b: period('b', 'canottieri-salo', date, ['AFTERNOON']),
  });
  assert.equal(differentTime[0].compatibility, 'different-time');
  assert.match(differentTime[0].commonTimes[0], /Mattina \(08:00–12:00\)/);
  assert.match(differentTime[0].commonTimes[0], /Pomeriggio \(12:00–18:00\)/);
});

test('same weekend date across different centres is the last-tier suggestion and date exclusions override all bands', () => {
  const date = '2030-06-08';
  const data = {
    a: period('a', 'canottieri-salo', date, ['MORNING']),
    b: period('b', 'paitone-arena', date, ['EVENING']),
  };
  const suggestions = periodsOnly(data);
  assert.equal(suggestions[0].compatibility, 'different-venue');
  assert.match(suggestions[0].commonTimes[0], /Canottieri Salò · Mattina/);
  assert.match(suggestions[0].commonTimes[0], /Paitone Arena · Sera/);
  assert.deepEqual(periodsOnly(data, { dateUnavailMap: { b: new Set([date]) } }), []);
  assert.deepEqual(periodsOnly({ a: period('a', 'canottieri-salo', date, ['MORNING']), b: [] }), []);
  assert.deepEqual(periodsOnly({
    a: period('a', 'canottieri-salo', date, ['MORNING']),
    b: period('b', 'canottieri-salo', '2030-06-09', ['MORNING']),
  }), []);
});

test('saved venue choices limit date-based suggestions without affecting an opponent or their other-centre declaration', () => {
  const date = '2030-06-09';
  const data = {
    a: [...period('a', 'canottieri-salo', date, ['MORNING']), ...period('a', 'paitone-arena', date, ['EVENING'])],
    b: period('b', 'paitone-arena', date, ['EVENING']),
  };
  const suggestions = periodsOnly(data, { venueMap: { a: new Set(['paitone-arena']), b: new Set(['paitone-arena']) } });
  assert.equal(suggestions[0].compatibility, 'exact');
  assert.match(suggestions[0].commonTimes[0], /Paitone Arena · Sera/);
  assert.deepEqual(periodsOnly(data, { venueMap: { a: new Set(['canottieri-salo']), b: new Set(['paitone-arena']) } })[0].compatibility, 'different-venue');
});

test('Padel suggestions require matching period declarations from all four members', () => {
  const t = padelTournament();
  t.timeSlots = [];
  const e = event(t, { eventType: 'tournament_padel', globalTimeSlots: [] });
  const declarations = {
    a: period('a', 'canottieri-salo', '2030-06-07', ['MORNING']),
    b: period('b', 'canottieri-salo', '2030-06-07', ['MORNING']),
    c: period('c', 'canottieri-salo', '2030-06-07', ['MORNING']),
    d: period('d', 'canottieri-salo', '2030-06-07', ['MORNING']),
  };
  const data = { slotPrefMap: {}, dateUnavailMap: {}, periodMap: declarations };
  assert.equal(getTournamentMatchSuggestions(e, t, 'a', data, now)[0].compatibility, 'exact');
  delete data.periodMap.d;
  assert.deepEqual(getTournamentMatchSuggestions(e, t, 'a', data, now), []);
  data.periodMap.d = period('d', 'canottieri-salo', '2030-06-07', ['EVENING']);
  assert.equal(getTournamentMatchSuggestions(e, t, 'a', data, now)[0].compatibility, 'different-time');
});

test('new periods work without preloaded slots and can coordinate with a legacy specific-time preference', () => {
  const t = tournament({ timeSlots: [], groups: [{ matches: [pending('ab', 'a', 'b')] }] });
  const e = event(t, { globalTimeSlots: [] });
  const withLegacy = {
    slotPrefMap: { a: new Set(), b: new Set(['evening-slot']) },
    dateUnavailMap: {},
    periodMap: { a: period('a', 'canottieri-salo', '2030-06-07', ['EVENING']) },
  };
  t.timeSlots.push(venueSlot('evening-slot', 'Canottieri Salò', new Date(2030, 5, 7, 21).toISOString()));
  assert.equal(getTournamentMatchSuggestions(e, t, 'a', withLegacy, now)[0].compatibility, 'exact');
  t.timeSlots[0] = venueSlot('evening-slot', 'Canottieri Salò', new Date(2030, 5, 7, 22).toISOString());
  assert.equal(getTournamentMatchSuggestions(e, t, 'a', withLegacy, now)[0].compatibility, 'different-time');
});
