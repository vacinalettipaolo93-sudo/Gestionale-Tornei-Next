import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tournament-booking-'));
after(() => rmSync(tempDir, { recursive: true }));
execFileSync('npx', [
  'tsc', '--outDir', tempDir, '--module', 'ESNext', '--target', 'ES2022',
  '--moduleResolution', 'bundler', '--skipLibCheck', '--lib', 'ES2022,DOM,DOM.Iterable',
  'types.ts', 'utils/tournamentBooking.ts',
], { cwd: process.cwd(), stdio: 'pipe' });
for (const file of readdirSync(path.join(tempDir, 'utils'))) {
  const absolute = path.join(tempDir, 'utils', file);
  writeFileSync(absolute, readFileSync(absolute, 'utf8').replace(/from '(\.\/[^'.]+)'/g, "from '$1.js'"));
}
const bookingUrl = pathToFileURL(path.join(tempDir, 'utils/tournamentBooking.js')).href;
const { applyTournamentSlotAction } = await import(bookingUrl);
const { getTournamentAvailabilitySlots, isTournamentSlotBooked, getEventSlots, isEventSlotBooked } =
  await import(pathToFileURL(path.join(tempDir, 'utils/tournamentAvailability.js')).href);
const { getSlotVenueId } =
  await import(pathToFileURL(path.join(tempDir, 'utils/tournamentVenues.js')).href);
const now = Date.parse('2029-01-01T00:00:00Z');
const admin = { isOrganizer: true };
const participant = { isOrganizer: false, playerId: 'a' };
const slot = (id = 's1', overrides = {}) => ({
  id, start: '2030-06-03T18:00:00Z', venueId: 'canottieri-salo', location: 'Canottieri Salò', field: 'Campo 1',
  ...overrides,
});
const match = (id = 'ab', overrides = {}) => ({
  id, player1Id: 'a', player2Id: 'b', status: 'pending', score1: null, score2: null, ...overrides,
});
const tournament = (id = 't1', overrides = {}) => ({
  id, name: id, groups: [{ id: 'g1', playerIds: ['a', 'b', 'c', 'd'], matches: [match(), match('cd', { player1Id: 'c', player2Id: 'd' })] }],
  timeSlots: [slot(), slot('s2', { field: 'Campo 2' }), slot('p1', { venueId: 'paitone-arena', location: 'Paitone Arena' })],
  playoffs: null, consolationBracket: null, playoffMatches: [], consolationMatches: [], settings: {},
  ...overrides,
});
const event = (overrides = {}) => ({
  id: 'event', name: 'Evento', eventType: 'tournament_singolare',
  players: ['a', 'b', 'c', 'd'].map(id => ({ id, name: id, status: 'confirmed' })),
  tournaments: [tournament(), tournament('t2')], globalTimeSlots: [],
  ...overrides,
});
const apply = (e, action, actor = participant, tournamentId = 't1') =>
  ({ ...e, ...applyTournamentSlotAction(e, tournamentId, action, actor, now) });
const getMatch = (e, id = 'ab', tId = 't1') => {
  const t = e.tournaments.find(t => t.id === tId);
  return [...t.groups.flatMap(g => g.matches), ...t.playoffMatches, ...t.consolationMatches].find(m => m.id === id);
};
const externalBooking = overrides => ({
  venueId: 'canottieri-salo', date: '2030-06-03', time: '18:00', field: '', confirmed: true, ...overrides,
});
const withoutSlots = () => event({ tournaments: [tournament('t1', { timeSlots: [] }), tournament('t2', { timeSlots: [] })] });

test('external court confirmation registers a match without admin slots or creating inventory', () => {
  const original = withoutSlots();
  const e = apply(original, { type: 'book-external', matchId: 'ab', booking: externalBooking() });
  assert.deepEqual(getMatch(e), {
    ...match(), status: 'scheduled', scheduledTime: new Date('2030-06-03T18:00:00').toISOString(),
    location: 'Canottieri Salò', field: '',
  });
  assert.equal('slotId' in getMatch(e), false);
  assert.deepEqual(e.globalTimeSlots, []);
  assert.deepEqual(e.tournaments.map(t => t.timeSlots), [[], []]);
  assert.deepEqual(e.tournaments[1], original.tournaments[1]);
  assert.deepEqual(e.players, original.players);
  assert.equal(getMatch(original).status, 'pending');
});

test('external booking requires valid future day, time, venue and explicit confirmation', () => {
  for (const invalid of [
    { date: '' }, { time: '' }, { date: '2030-02-30' }, { date: '2030-13-01' },
    { time: '24:00' }, { time: '18:65' }, { date: '2020-06-03' }, { venueId: 'other' },
    { confirmed: false }, { confirmed: 'yes' }, { field: null },
  ]) {
    assert.throws(() => apply(withoutSlots(), { type: 'book-external', matchId: 'ab', booking: externalBooking(invalid) }));
  }
  const e = apply(withoutSlots(), { type: 'book-external', matchId: 'ab', booking: externalBooking({
    venueId: 'paitone-arena', field: ' Campo 2 ',
  }) });
  assert.equal(getMatch(e).location, 'Paitone Arena');
  assert.equal(getMatch(e).field, 'Campo 2');
});

test('external registration preserves local wall time and rejects the exact start instant or later', () => {
  const action = { type: 'book-external', matchId: 'ab', booking: externalBooking() };
  const start = new Date('2030-06-03T18:00:00').getTime();
  const e = withoutSlots();
  const update = applyTournamentSlotAction(e, 't1', action, participant, start - 1);
  assert.equal(new Date(getMatch({ ...e, ...update }).scheduledTime).getHours(), 18);
  assert.equal(new Date(getMatch({ ...e, ...update }).scheduledTime).getDate(), 3);
  for (const time of [start, start + 1]) {
    assert.throws(() => applyTournamentSlotAction(e, 't1', action, participant, time), /futuri validi/);
  }
});

test('external reschedule replaces legacy slot linkage and cancellation removes only app booking data', () => {
  let e = apply(event(), { type: 'book', matchId: 'ab', slotId: 's1' });
  e = apply(e, { type: 'reschedule-external', matchId: 'ab', booking: externalBooking({ venueId: 'paitone-arena' }) });
  assert.equal(getMatch(e).location, 'Paitone Arena');
  assert.equal('slotId' in getMatch(e), false);
  assert.ok(getEventSlots(e).some(s => s.id === 's1'));
  assert.equal(isEventSlotBooked(e, slot()), false);
  e = apply(e, { type: 'cancel', matchId: 'ab' });
  assert.deepEqual(getMatch(e), match());
  assert.deepEqual(e.globalTimeSlots, []);
});

test('external registration enforces permissions, match status and known court collisions within the event', () => {
  const action = { type: 'book-external', matchId: 'ab', booking: externalBooking({ field: 'Campo 1' }) };
  const e = apply(withoutSlots(), action);
  assert.throws(() => apply(e, action), /già prenotata/);
  assert.throws(() => apply(e, { ...action, type: 'reschedule-external', matchId: 'cd' }, admin), /è stata modificata/);
  assert.throws(() => apply(withoutSlots(), { ...action, matchId: 'cd' }), /in cui sei presente/);
  assert.throws(() => apply(e, action, participant, 't2'), /già registrato/);
  const completed = withoutSlots();
  getMatch(completed).status = 'completed';
  assert.throws(() => apply(completed, action), /non è prenotabile/);
  const parallel = apply(e, { ...action, matchId: 'cd', booking: externalBooking({ field: 'Campo 2' }) }, admin);
  assert.equal(getMatch(parallel, 'cd').field, 'Campo 2');
  const unknown = apply(e, { ...action, matchId: 'cd', booking: externalBooking() }, admin);
  assert.equal(getMatch(unknown, 'cd').status, 'scheduled', 'unknown courts do not imply a venue-wide collision');
});

for (const phase of ['groups', 'playoffMatches', 'consolationMatches']) {
  test(`external book, reschedule and cancel cover ${phase} for all four Padel players`, () => {
    const t = tournament('t1', { timeSlots: [] });
    const fixture = match('teams', { player1Id: 'team1', player2Id: 'team2' });
    if (phase === 'groups') t.groups[0].matches = [fixture];
    else { t.groups = []; t[phase] = [fixture]; }
    t.padelTeams = [
      { id: 'team1', player1Id: 'a', player2Id: 'b' },
      { id: 'team2', player1Id: 'c', player2Id: 'd' },
    ];
    for (const playerId of ['a', 'b', 'c', 'd']) {
      const actor = { isOrganizer: false, playerId };
      let e = apply(event({ eventType: 'tournament_padel', tournaments: [t] }),
        { type: 'book-external', matchId: 'teams', booking: externalBooking() }, actor);
      assert.equal(getMatch(e, 'teams').status, 'scheduled');
      e = apply(e, { type: 'reschedule-external', matchId: 'teams', booking: externalBooking({ venueId: 'paitone-arena' }) }, actor);
      assert.equal(getMatch(e, 'teams').location, 'Paitone Arena');
      e = apply(e, { type: 'cancel', matchId: 'teams' }, actor);
      assert.deepEqual(getMatch(e, 'teams'), fixture);
    }
  });
}

test('venue identifiers preserve canonical names and recognize existing venue labels', () => {
  assert.equal(getSlotVenueId({ location: 'Tennis Salò Canottieri' }), 'canottieri-salo');
  assert.equal(getSlotVenueId({ location: 'Canottieri Salo' }), 'canottieri-salo');
  assert.equal(getSlotVenueId({ location: 'PAITONE ARENA' }), 'paitone-arena');
  assert.equal(getSlotVenueId({ location: 'Altro centro' }), undefined);
});

test('admin adds an event-wide canonical slot without selecting a tournament or mutating input', () => {
  const original = event();
  const before = structuredClone(original);
  const updated = apply(original, { type: 'add', slot: slot('new', { start: '2030-06-04T18:00:00Z', location: 'ignored', field: '  Campo 3  ' }) }, admin);
  assert.deepEqual(original, before);
  assert.equal(updated.globalTimeSlots.at(-1).location, 'Canottieri Salò');
  assert.equal(updated.globalTimeSlots.at(-1).field, 'Campo 3');
  assert.deepEqual(updated.tournaments[1], original.tournaments[1]);
  for (const t of updated.tournaments) {
    assert.ok(getTournamentAvailabilitySlots(updated, t, now).some(s => s.id === 'new'));
  }
  const empty = event({ tournaments: [] });
  const result = applyTournamentSlotAction(empty, undefined, { type: 'add', slot: slot() }, admin, now);
  assert.equal(result.globalTimeSlots.length, 1);
});

test('slot administration rejects duplicates, invalid dates, past slots, empty courts and non-admins', () => {
  for (const data of [
    slot('duplicate'), slot('s1', { field: 'Campo 4' }), slot('bad', { start: 'bad' }),
    slot('past', { start: '2020-01-01T18:00:00Z' }), slot('empty', { field: ' ' }),
    slot('venue', { venueId: 'invalid' }),
  ]) assert.throws(() => apply(event(), { type: 'add', slot: data }, admin));
  assert.throws(() => apply(event(), { type: 'add', slot: slot('new') }), /amministratore/);
  assert.throws(() => apply(event(), { type: 'delete', slotId: 's1' }), /amministratore/);
});

test('booking saves venue, day, time and court and preserves all other tournaments and event data', () => {
  const original = event();
  const updated = apply(original, { type: 'book', matchId: 'ab', slotId: 's1' });
  assert.deepEqual(getMatch(updated), {
    ...match(), status: 'scheduled', slotId: 's1', scheduledTime: new Date(slot().start).toISOString(), location: 'Canottieri Salò', field: 'Campo 1',
  });
  assert.deepEqual(updated.tournaments[1], original.tournaments[1]);
  assert.deepEqual(updated.players, original.players);
  assert.equal(getMatch(original).status, 'pending');
});

test('a booking locks the slot in all tournaments of the event, even with repeated match ids', () => {
  let e = apply(event(), { type: 'book', matchId: 'ab', slotId: 's1' });
  assert.throws(() => apply(e, { type: 'book', matchId: 'cd', slotId: 's1' }, admin), /appena prenotato/);
  assert.throws(() => apply(e, { type: 'book', matchId: 'ab', slotId: 's1' }, participant, 't2'), /appena prenotato/);
  assert.ok(!getTournamentAvailabilitySlots(e, e.tournaments[1], now).some(s => s.id === 's1'));
  assert.equal(getMatch(e).slotId, 's1');
});

test('legacy aliases for the same venue/court/time are occupied even with a different slot id', () => {
  const t = tournament();
  t.timeSlots.push(slot('alias', { location: 'Tennis Salò Canottieri', venueId: undefined, field: ' campo 1 ' }));
  const e = apply(event({ tournaments: [t] }), { type: 'book', matchId: 'ab', slotId: 's1' });
  assert.throws(() => apply(e, { type: 'book', matchId: 'cd', slotId: 'alias' }, admin), /appena prenotato/);
  assert.throws(() => apply(e, { type: 'delete', slotId: 'alias' }, admin), /Non puoi eliminare/);
});

test('a reservation with only legacy time/location/court locks that resource but not parallel courts', () => {
  const t = tournament('t1', { groups: [{ matches: [
    match('legacy', { status: 'scheduled', scheduledTime: slot().start, location: 'Canottieri Salo', field: 'Campo 1' }),
    match('cd', { player1Id: 'c', player2Id: 'd' }),
  ] }] });
  const e = event({ tournaments: [t] });
  assert.deepEqual(getTournamentAvailabilitySlots(e, t, now).map(s => s.id), ['s2', 'p1']);
});

test('other courts and other venues remain bookable at the exact same time', () => {
  let e = apply(event(), { type: 'book', matchId: 'ab', slotId: 's1' });
  assert.deepEqual(getTournamentAvailabilitySlots(e, e.tournaments[0], now).map(s => s.id), ['s2', 'p1']);
  e = apply(e, { type: 'book', matchId: 'cd', slotId: 's2' }, admin);
  assert.deepEqual(getTournamentAvailabilitySlots(e, e.tournaments[0], now).map(s => s.id), ['p1']);
});

test('global legacy and previously tournament-local slots are bookable throughout their event', () => {
  const e = event();
  e.globalTimeSlots.push(slot('global-only', { field: 'Campo 3' }));
  e.tournaments[1].timeSlots.push(slot('other-only', { field: 'Campo 4' }));
  for (const slotId of ['global-only', 'other-only']) {
    assert.equal(getMatch(apply(e, { type: 'book', matchId: 'ab', slotId })).slotId, slotId);
  }
  assert.throws(() => apply(e, { type: 'book', matchId: 'ab', slotId: 'missing' }), /non è più disponibile/);
});

test('rescheduling moves to the other venue, releases the old slot and can retain the current booking', () => {
  let e = apply(event(), { type: 'book', matchId: 'ab', slotId: 's1' });
  e = apply(e, { type: 'reschedule', matchId: 'ab', slotId: 's1' });
  e = apply(e, { type: 'reschedule', matchId: 'ab', slotId: 'p1' });
  assert.equal(getMatch(e).location, 'Paitone Arena');
  assert.equal(isTournamentSlotBooked(e.tournaments[0], slot()), false);
  assert.equal(isTournamentSlotBooked(e.tournaments[0], slot('p1', { venueId: 'paitone-arena', location: 'Paitone Arena' })), true);
});

test('cancellation frees the court without undefined Firestore values or changes to participants', () => {
  let e = apply(event(), { type: 'book', matchId: 'ab', slotId: 's1' });
  e = apply(e, { type: 'cancel', matchId: 'ab' });
  assert.deepEqual(getMatch(e), match());
  assert.ok(getTournamentAvailabilitySlots(e, e.tournaments[0], now).some(s => s.id === 's1'));
  assert.equal(Object.values(getMatch(e)).includes(undefined), false);
});

test('admin can delete only free slots; deleting cannot erase a reservation', () => {
  const original = event();
  const updated = apply(original, { type: 'delete', slotId: 's1' }, admin);
  assert.equal(updated.tournaments[0].timeSlots.some(s => s.id === 's1'), false);
  assert.ok(updated.tournaments.every(t => !t.timeSlots.some(s => s.id === 's1')));
  assert.ok(!getEventSlots(updated).some(s => s.id === 's1'));
  const booked = apply(original, { type: 'book', matchId: 'ab', slotId: 's1' });
  assert.throws(() => apply(booked, { type: 'delete', slotId: 's1' }, admin), /Non puoi eliminare/);
});

test('event-wide deletion removes global and legacy copies and checks bookings in other tournaments', () => {
  const original = event({ globalTimeSlots: [slot()] });
  const updated = { ...original, ...applyTournamentSlotAction(original, undefined, { type: 'delete', slotId: 's1' }, admin, now) };
  assert.ok(!getEventSlots(updated).some(s => s.id === 's1'));
  assert.ok(!updated.globalTimeSlots.some(s => s.id === 's1'));
  const booked = apply(original, { type: 'book', matchId: 'ab', slotId: 's1' }, participant, 't2');
  assert.throws(() => applyTournamentSlotAction(booked, undefined, { type: 'delete', slotId: 's1' }, admin, now), /Non puoi eliminare/);
  assert.throws(() => apply(booked, { type: 'add', slot: slot('duplicate') }, admin), /già presente/);
});

test('missing matches, unauthorized players and completed fixtures fail explicitly', () => {
  assert.throws(() => apply(event(), { type: 'book', matchId: 'missing', slotId: 's1' }), /non trovata/);
  assert.throws(() => apply(event(), { type: 'book', matchId: 'cd', slotId: 's1' }), /in cui sei presente/);
  assert.throws(() => apply(event(), { type: 'book', matchId: 'ab', slotId: 's1' }, { isOrganizer: false }), /in cui sei presente/);
  const e = event();
  getMatch(e).status = 'completed';
  assert.throws(() => apply(e, { type: 'book', matchId: 'ab', slotId: 's1' }), /non è prenotabile/);
  assert.throws(() => apply(e, { type: 'cancel', matchId: 'ab' }), /non è prenotabile/);
});

test('stale booking and reschedule actions cannot overwrite a changed match status', () => {
  const booked = apply(event(), { type: 'book', matchId: 'ab', slotId: 's1' });
  assert.throws(() => apply(booked, { type: 'book', matchId: 'ab', slotId: 's2' }), /già prenotata/);
  assert.throws(() => apply(event(), { type: 'reschedule', matchId: 'ab', slotId: 's2' }), /è stata modificata/);
});

for (const phase of ['groups', 'playoffMatches', 'consolationMatches']) {
  test(`book, reschedule and cancel work in ${phase} without relying on match id prefixes`, () => {
    const t = tournament();
    const fixture = match('fixture-no-prefix');
    if (phase === 'groups') t.groups[0].matches = [fixture];
    else { t.groups = []; t[phase] = [fixture]; }
    let e = event({ tournaments: [t] });
    e = apply(e, { type: 'book', matchId: fixture.id, slotId: 's1' });
    assert.equal(getMatch(e, fixture.id).status, 'scheduled');
    e = apply(e, { type: 'reschedule', matchId: fixture.id, slotId: 'p1' });
    assert.equal(getMatch(e, fixture.id).location, 'Paitone Arena');
    e = apply(e, { type: 'cancel', matchId: fixture.id });
    assert.deepEqual(getMatch(e, fixture.id), fixture);
  });
}

test('either Padel team member can book their match, but unrelated players cannot', () => {
  const t = tournament();
  t.groups[0].matches = [match('teams', { player1Id: 'team1', player2Id: 'team2' })];
  t.padelTeams = [
    { id: 'team1', player1Id: 'a', player2Id: 'b', name: 'Team 1' },
    { id: 'team2', player1Id: 'c', player2Id: 'd', name: 'Team 2' },
  ];
  const e = event({ eventType: 'tournament_padel', tournaments: [t] });
  for (const playerId of ['a', 'b', 'c', 'd']) {
    assert.equal(getMatch(apply(e, { type: 'book', matchId: 'teams', slotId: 's1' }, { isOrganizer: false, playerId }), 'teams').status, 'scheduled');
  }
  assert.throws(() => apply(e, { type: 'book', matchId: 'teams', slotId: 's1' }, { isOrganizer: false, playerId: 'outsider' }), /in cui sei presente/);
});

const dataUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const firestoreUrl = dataUrl(`
  export let store;
  export let failCommit;
  let version = 0;
  export function reset(documents, failure = false) { store = structuredClone(documents); failCommit = failure; version++; }
  export const doc = (_db, collection, id) => ({path: collection + '/' + id, id});
  export async function runTransaction(_db, callback) {
    for (let attempt=0; attempt<10; attempt++) {
      const readVersion = version;
      const writes = [];
      await callback({
        get: async ref => {
          const value = structuredClone(store[ref.path]);
          return {id:ref.id, exists:()=>!!value, data:()=>value};
        },
        update: (ref, fields) => writes.push({ref, fields}),
      });
      await new Promise(resolve => setImmediate(resolve));
      if (readVersion !== version) continue;
      if (failCommit) throw new Error('Firestore commit rejected');
      for (const {ref, fields} of writes) store[ref.path] = {...store[ref.path], ...fields};
      version++;
      return;
    }
    throw new Error('Transaction retry exhausted');
  }
`);
const firestore = await import(firestoreUrl);
const serviceSource = readFileSync(new URL('../services/tournamentBookingService.ts', import.meta.url), 'utf8');
const compiledService = ts.transpileModule(serviceSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
  .replace("'firebase/firestore'", JSON.stringify(firestoreUrl))
  .replace("import { db } from '../firebase';", 'const db = {};')
  .replace("'../utils/tournamentBooking'", JSON.stringify(bookingUrl));
const { saveTournamentSlotAction } = await import(dataUrl(compiledService));

test('external booking transaction retries preserve independent registrations and reject duplicate match bookings', async () => {
  const action = { type: 'book-external', matchId: 'ab', booking: externalBooking() };
  firestore.reset({ 'events/event': withoutSlots() });
  await Promise.all(['ab', 'cd'].map(matchId =>
    saveTournamentSlotAction('event', 't1', { ...action, matchId }, admin)));
  assert.equal(getMatch(firestore.store['events/event']).status, 'scheduled');
  assert.equal(getMatch(firestore.store['events/event'], 'cd').status, 'scheduled');
  firestore.reset({ 'events/event': withoutSlots() });
  const duplicate = await Promise.allSettled([1, 2].map(() => saveTournamentSlotAction('event', 't1', action, admin)));
  assert.equal(duplicate.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(duplicate.find(result => result.status === 'rejected').reason.message, /già prenotata/);
});

test('external registration rejects same-court races, reports commit failures and isolates other events', async () => {
  const action = { type: 'book-external', matchId: 'ab', booking: externalBooking({ field: 'Campo 1' }) };
  firestore.reset({ 'events/event': withoutSlots() });
  const results = await Promise.allSettled(['t1', 't2'].map(t => saveTournamentSlotAction('event', t, action, admin)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /già registrato/);
  const original = { 'events/event': withoutSlots(), 'events/other': withoutSlots() };
  firestore.reset(original, true);
  await assert.rejects(saveTournamentSlotAction('event', 't1', action, admin), /commit rejected/);
  assert.deepEqual(firestore.store, original);
  firestore.reset(original);
  await saveTournamentSlotAction('event', 't1', action, admin);
  assert.deepEqual(firestore.store['events/other'], original['events/other']);
});

test('transaction retries reject the loser of simultaneous bookings for the same court', async () => {
  firestore.reset({ 'events/event': event() });
  const results = await Promise.allSettled([
    saveTournamentSlotAction('event', 't1', { type: 'book', matchId: 'ab', slotId: 's1' }, admin),
    saveTournamentSlotAction('event', 't1', { type: 'book', matchId: 'cd', slotId: 's1' }, admin),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /appena prenotato/);
  const matches = firestore.store['events/event'].tournaments[0].groups[0].matches;
  assert.equal(matches.filter(item => item.status === 'scheduled').length, 1);
});

test('concurrent bookings on different courts across tournaments survive transaction retries', async () => {
  for (const [tId, slotId] of [['t1', 's2'], ['t2', 's2']]) {
    firestore.reset({ 'events/event': event() });
    await Promise.all([
      saveTournamentSlotAction('event', 't1', { type: 'book', matchId: 'ab', slotId: 's1' }, admin),
      saveTournamentSlotAction('event', tId, { type: 'book', matchId: 'cd', slotId }, admin),
    ]);
    assert.equal(getMatch(firestore.store['events/event']).slotId, 's1');
    assert.equal(getMatch(firestore.store['events/event'], 'cd', tId).slotId, slotId);
  }
});

test('concurrent bookings of one shared slot from different tournaments reject one writer', async () => {
  firestore.reset({ 'events/event': event() });
  const results = await Promise.allSettled(['t1', 't2'].map(tId =>
    saveTournamentSlotAction('event', tId, { type: 'book', matchId: 'ab', slotId: 's1' }, admin)
  ));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /appena prenotato/);
});

test('identical resources in different events remain independently bookable', async () => {
  firestore.reset({ 'events/first': event(), 'events/second': event() });
  await Promise.all(['first', 'second'].map(eventId =>
    saveTournamentSlotAction(eventId, 't1', { type: 'book', matchId: 'ab', slotId: 's1' }, admin)
  ));
  for (const key of ['events/first', 'events/second']) assert.equal(getMatch(firestore.store[key]).slotId, 's1');
});

test('rescheduling and cancellation release shared slots for every tournament', () => {
  let e = apply(event(), { type: 'book', matchId: 'ab', slotId: 's1' });
  e = apply(e, { type: 'reschedule', matchId: 'ab', slotId: 'p1' });
  for (const t of e.tournaments) {
    const ids = getTournamentAvailabilitySlots(e, t, now).map(slot => slot.id);
    assert.ok(ids.includes('s1'));
    assert.ok(!ids.includes('p1'));
  }
  e = apply(e, { type: 'cancel', matchId: 'ab' });
  assert.equal(isEventSlotBooked(e, slot('p1', { venueId: 'paitone-arena', location: 'Paitone Arena' })), false);
  assert.ok(getTournamentAvailabilitySlots(e, e.tournaments[1], now).some(slot => slot.id === 'p1'));
});

test('booking transactions preserve unrelated event data and do not write on failed commit or missing event', async () => {
  const original = { 'events/event': { ...event(), rules: 'Keep me' }, 'events/unrelated': event() };
  firestore.reset(original, true);
  await assert.rejects(saveTournamentSlotAction('event', 't1', { type: 'book', matchId: 'ab', slotId: 's1' }, admin), /commit rejected/);
  assert.deepEqual(firestore.store, original);
  firestore.reset(original);
  await saveTournamentSlotAction('event', 't1', { type: 'book', matchId: 'ab', slotId: 's1' }, admin);
  assert.equal(firestore.store['events/event'].rules, 'Keep me');
  assert.deepEqual(firestore.store['events/unrelated'], original['events/unrelated']);
  await assert.rejects(saveTournamentSlotAction('missing', 't1', { type: 'book', matchId: 'ab', slotId: 's1' }, admin), /Evento non trovato/);
});

const deadline = '2030-01-02T00:00:00Z';
const atDeadline = Date.parse(deadline);
const withExpiry = () => event({ globalTimeSlots: [slot('expiring', { expiresAt: deadline, field: 'Campo 5' })] });

test('expiry is optional, persisted per newly inserted slot and validated as a future instant', () => {
  const e = event();
  const created = apply(e, { type: 'add', slot: slot('expiring', { expiresAt: deadline, field: 'Campo 5' }) }, admin);
  assert.equal(created.globalTimeSlots[0].expiresAt, new Date(deadline).toISOString());
  assert.deepEqual(created.tournaments, e.tournaments);
  assert.equal(created.tournaments[0].timeSlots[0].expiresAt, undefined);
  for (const expiresAt of ['bad', '', new Date(now).toISOString(), '2020-01-01T00:00:00Z']) {
    assert.throws(() => apply(e, { type: 'add', slot: slot('new', { expiresAt, field: 'Campo 5' }) }, admin), /scadenza futura/);
  }
});

test('expiry hides and blocks a free slot exactly at the deadline in all tournaments without relying on cleanup', () => {
  const e = withExpiry();
  for (const t of e.tournaments) {
    assert.ok(getTournamentAvailabilitySlots(e, t, atDeadline - 1).some(s => s.id === 'expiring'));
    for (const time of [atDeadline, atDeadline + 1]) {
      assert.ok(!getTournamentAvailabilitySlots(e, t, time).some(s => s.id === 'expiring'));
      assert.throws(() => applyTournamentSlotAction(e, t.id, { type: 'book', matchId: 'ab', slotId: 'expiring' }, admin, time), /non è più disponibile/);
    }
    assert.ok(getTournamentAvailabilitySlots(e, t, atDeadline).some(s => s.id === 's1'));
  }
  assert.equal(e.globalTimeSlots.length, 1);
});

test('malformed stored expiry fails closed rather than reopening the slot', () => {
  const e = withExpiry();
  e.globalTimeSlots[0].expiresAt = 'invalid';
  assert.ok(!getTournamentAvailabilitySlots(e, e.tournaments[0], now).some(s => s.id === 'expiring'));
  assert.throws(() => apply(e, { type: 'book', matchId: 'ab', slotId: 'expiring' }), /non è più disponibile/);
});

test('cleanup removes expired free global and legacy copies without touching other slots or matches', () => {
  const e = withExpiry();
  e.tournaments[1].timeSlots.push(slot('expiring', { expiresAt: deadline, field: 'Campo 5' }));
  const before = structuredClone(e);
  const update = applyTournamentSlotAction(e, undefined, { type: 'purge-expired' }, admin, atDeadline);
  assert.ok(!getEventSlots({ ...e, ...update }).some(s => s.id === 'expiring'));
  assert.deepEqual(update.tournaments[0], e.tournaments[0]);
  assert.deepEqual(update.tournaments[1].groups, e.tournaments[1].groups);
  assert.deepEqual(e, before);
  assert.doesNotThrow(() => applyTournamentSlotAction(e, undefined, { type: 'purge-expired' }, participant, atDeadline));
  for (const actor of [{ isOrganizer: false }, { isOrganizer: false, playerId: 'outsider' }]) {
    assert.throws(() => applyTournamentSlotAction(e, undefined, { type: 'purge-expired' }, actor, atDeadline), /giocatore dell’evento/);
  }
});

test('expiry preserves existing bookings, but cancellation or rescheduling after expiry removes the old free slot', () => {
  const e = apply(withExpiry(), { type: 'book', matchId: 'ab', slotId: 'expiring' });
  const cleaned = { ...e, ...applyTournamentSlotAction(e, undefined, { type: 'purge-expired' }, admin, atDeadline) };
  assert.equal(getMatch(cleaned).slotId, 'expiring');
  assert.ok(getEventSlots(cleaned).some(s => s.id === 'expiring'));
  assert.ok(getTournamentAvailabilitySlots(cleaned, cleaned.tournaments[0], atDeadline, 'ab').some(s => s.id === 'expiring'));
  assert.ok(!getTournamentAvailabilitySlots(cleaned, cleaned.tournaments[1], atDeadline, 'ab').some(s => s.id === 'expiring'));
  assert.doesNotThrow(() => applyTournamentSlotAction(cleaned, 't1', { type: 'reschedule', matchId: 'ab', slotId: 'expiring' }, admin, atDeadline));
  for (const action of [{ type: 'cancel', matchId: 'ab' }, { type: 'reschedule', matchId: 'ab', slotId: 'p1' }]) {
    const updated = { ...e, ...applyTournamentSlotAction(e, 't1', action, admin, atDeadline) };
    assert.ok(!getEventSlots(updated).some(s => s.id === 'expiring'));
    assert.equal(getMatch(updated).status, action.type === 'cancel' ? 'pending' : 'scheduled');
  }
});

test('expiry cleanup preserves physical bookings under other slot ids and legacy reservations', () => {
  for (const fields of [
    { slotId: 'alias' },
    { scheduledTime: slot().start, location: 'Canottieri Salo', field: 'Campo 5' },
  ]) {
    const e = withExpiry();
    e.tournaments[1].timeSlots.push(slot('alias', { field: 'Campo 5' }));
    Object.assign(getMatch(e, 'ab', 't2'), fields, { status: 'scheduled' });
    const updated = { ...e, ...applyTournamentSlotAction(e, undefined, { type: 'purge-expired' }, admin, atDeadline) };
    assert.ok(getEventSlots(updated).some(s => s.id === 'expiring'));
  }
});

test('an expired free resource can be offered again with a new expiry without altering old slots', () => {
  const update = applyTournamentSlotAction(withExpiry(), undefined, {
    type: 'add', slot: slot('renewed', { expiresAt: '2030-01-03T00:00:00Z', field: 'Campo 5' }),
  }, admin, atDeadline);
  assert.equal(update.globalTimeSlots.length, 1);
  assert.equal(update.globalTimeSlots[0].id, 'renewed');
});

test('concurrent cleanup and booking before expiry preserve the winner and never remove its reservation', async () => {
  const e = withExpiry();
  e.globalTimeSlots[0].expiresAt = '2099-01-01T00:00:00Z';
  firestore.reset({ 'events/event': e });
  await Promise.all([
    saveTournamentSlotAction('event', undefined, { type: 'purge-expired' }, admin),
    saveTournamentSlotAction('event', 't2', { type: 'book', matchId: 'ab', slotId: 'expiring' }, admin),
  ]);
  assert.equal(getMatch(firestore.store['events/event'], 'ab', 't2').slotId, 'expiring');
  assert.ok(getEventSlots(firestore.store['events/event']).some(s => s.id === 'expiring'));
});

test('transaction cleanup deletes only expired free slots and does not hide commit failures', async () => {
  const e = withExpiry();
  e.globalTimeSlots[0].expiresAt = '2020-01-01T00:00:00Z';
  firestore.reset({ 'events/event': e, 'events/other': e });
  await saveTournamentSlotAction('event', undefined, { type: 'purge-expired' }, admin);
  assert.equal(firestore.store['events/event'].globalTimeSlots.length, 0);
  assert.equal(firestore.store['events/other'].globalTimeSlots.length, 1);
  firestore.reset({ 'events/event': e }, true);
  await assert.rejects(saveTournamentSlotAction('event', undefined, { type: 'purge-expired' }, admin), /commit rejected/);
  assert.deepEqual(firestore.store['events/event'], e);
});

test('simultaneous participant logins clean only expired free slots and preserve booked resources', async () => {
  const e = withExpiry();
  e.globalTimeSlots[0].expiresAt = '2020-01-01T00:00:00Z';
  e.globalTimeSlots.push(slot('booked-expired', { expiresAt: '2020-01-01T00:00:00Z', field: 'Campo 6' }));
  Object.assign(getMatch(e, 'ab', 't2'), {
    status: 'scheduled', slotId: 'booked-expired', scheduledTime: slot().start, location: slot().location, field: 'Campo 6',
  });
  firestore.reset({ 'events/event': e, 'events/unrelated': e });
  await Promise.all(['a', 'b'].map(playerId =>
    saveTournamentSlotAction('event', undefined, { type: 'purge-expired' }, { isOrganizer: false, playerId })
  ));
  const stored = firestore.store['events/event'];
  assert.ok(!getEventSlots(stored).some(s => s.id === 'expiring'));
  assert.ok(getEventSlots(stored).some(s => s.id === 'booked-expired'));
  assert.deepEqual(stored.tournaments, e.tournaments);
  assert.deepEqual(firestore.store['events/unrelated'], e);
  await assert.rejects(saveTournamentSlotAction('event', undefined, { type: 'purge-expired' }, { isOrganizer: false, playerId: 'outsider' }), /giocatore dell’evento/);
});
