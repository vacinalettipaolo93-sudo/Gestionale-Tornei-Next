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
  assert.throws(() => applyTournamentSlotAction(e, undefined, { type: 'purge-expired' }, participant, atDeadline), /amministratore/);
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
