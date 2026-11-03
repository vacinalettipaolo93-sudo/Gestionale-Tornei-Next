import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'event-bookings-'));
after(() => rmSync(tempDir, { recursive: true }));
await build({
  entryPoints: ['utils/eventBookings.ts', 'components/BookedVenueSlots.tsx', 'components/TournamentVenueSlots.tsx'],
  bundle: true, platform: 'node', format: 'esm', outbase: '.',
  outExtension: { '.js': '.mjs' }, outdir: tempDir,
  plugins: [{
    name: 'test-dependencies',
    setup(plugin) {
      plugin.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, args => ({ path: createRequire(import.meta.url).resolve(args.path), external: true }));
      plugin.onResolve({ filter: /services\/tournamentBookingService$/ }, () => ({ path: 'booking-service', namespace: 'test' }));
      plugin.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: 'export async function saveTournamentSlotAction() { throw new Error("Unexpected persistence during render"); }',
      }));
    },
  }],
});
const { getEventBookings } = await import(pathToFileURL(path.join(tempDir, 'utils/eventBookings.mjs')).href);
const { default: BookedVenueSlots } = await import(pathToFileURL(path.join(tempDir, 'components/BookedVenueSlots.mjs')).href);
const { default: TournamentVenueSlots } = await import(pathToFileURL(path.join(tempDir, 'components/TournamentVenueSlots.mjs')).href);
const slot = (id = 's1', overrides = {}) => ({
  id, start: '2030-06-03T18:00:00Z', location: 'Canottieri Salò', venueId: 'canottieri-salo', field: 'Campo 1', ...overrides,
});
const match = (id = 'm1', overrides = {}) => ({
  id, player1Id: 'a', player2Id: 'b', status: 'scheduled', slotId: 's1', score1: null, score2: null, ...overrides,
});
const tournament = (id = 't1', overrides = {}) => ({
  id, name: `Torneo ${id}`, groups: [{ matches: [match()] }], timeSlots: [], ...overrides,
});
const event = overrides => ({
  id: 'e1', name: 'Evento estivo', eventType: 'tournament_singolare',
  players: ['a', 'b', 'c', 'd'].map(id => ({ id, name: `Giocatore ${id}` })),
  tournaments: [tournament()], globalTimeSlots: [slot()], ...overrides,
});
const render = e => renderToStaticMarkup(React.createElement(BookedVenueSlots, { event: e }));

test('overview includes every tournament and phase, preserving repeated match ids and chronological order', () => {
  const e = event({ tournaments: [
    tournament('t1', {
      playoffMatches: [match('final', { slotId: undefined, scheduledTime: '2030-06-02T18:00:00Z', location: 'Paitone Arena', field: 'Campo 2' })],
      consolationMatches: [match('third', { slotId: undefined, scheduledTime: '2030-06-04T18:00:00Z', location: 'Canottieri Salo' })],
    }),
    tournament('t2'),
  ] });
  const before = structuredClone(e);
  const bookings = getEventBookings(e);
  assert.deepEqual(bookings.map(b => `${b.tournament.id}:${b.match.id}`), ['t1:final', 't1:m1', 't2:m1', 't1:third']);
  assert.equal(bookings[0].venueId, 'paitone-arena');
  assert.equal(bookings[1].field, 'Campo 1');
  assert.deepEqual(e, before);
});

test('legacy tournament slots and legacy time/location-only reservations are shown', () => {
  const e = event({ globalTimeSlots: [], tournaments: [tournament('t1', {
    timeSlots: [slot()],
    playoffMatches: [match('legacy', { slotId: undefined, scheduledTime: '2030-06-01T10:00:00Z', location: 'Tennis Salo Canottieri', field: 'Campo 3' })],
  })] });
  assert.equal(getEventBookings(e).length, 2);
  assert.ok(getEventBookings(e).every(b => b.venueId === 'canottieri-salo'));
  assert.equal(getEventBookings(e)[1].start, '2030-06-03T18:00:00.000Z');
});

test('rescheduling uses current match details; cancellation removes the reservation and other events stay isolated', () => {
  const e = event();
  e.tournaments[0].groups[0].matches[0] = match('m1', {
    slotId: 'moved', scheduledTime: '2030-06-05T19:00:00Z', location: 'Paitone Arena', field: 'Campo 4',
  });
  assert.equal(getEventBookings(e)[0].venueId, 'paitone-arena');
  assert.equal(getEventBookings(e)[0].field, 'Campo 4');
  assert.equal(getEventBookings(e)[0].start, '2030-06-05T19:00:00.000Z');
  e.tournaments[0].groups[0].matches[0] = match('m1', { status: 'pending', slotId: undefined });
  assert.deepEqual(getEventBookings(e), []);
  assert.deepEqual(getEventBookings(event({ id: 'other', tournaments: [] })), []);
});

test('past and completed reservations remain visible without inventing a reservation for unbooked completed matches', () => {
  const e = event({ tournaments: [tournament('t1', {
    groups: [{ matches: [
      match('played', { status: 'completed', score1: 6, score2: 2, scheduledTime: '2020-01-01T12:00:00Z' }),
      match('unbooked', { status: 'completed', slotId: undefined, score1: 6, score2: 3 }),
    ] }],
  })] });
  assert.equal(getEventBookings(e).length, 1);
  assert.match(render(e), /Partita completata/);
});

test('desktop columns are ordered Canottieri then Paitone with names, tournament, date, time and court', () => {
  const html = render(event());
  assert.match(html, /md:grid-cols-2/);
  assert.ok(html.indexOf('Prenotazioni Canottieri Salò') < html.indexOf('Prenotazioni Paitone Arena'));
  assert.match(html, /Giocatore a vs Giocatore b/);
  assert.match(html, /Torneo: Torneo t1/);
  assert.match(html, /dateTime="2030-06-03T18:00:00.000Z"/);
  assert.match(html, /giugno 2030/);
  assert.match(html, /Ore \d{2}:\d{2}/);
  assert.match(html, /Campo 1/);
  assert.match(html, /Nessuna partita prenotata per questo centro/);
});

test('Padel reservations display both teams and all four player names', () => {
  const html = render(event({ eventType: 'tournament_padel', tournaments: [tournament('t1', {
    groups: [{ matches: [match('m1', { player1Id: 'team1', player2Id: 'team2' })] }],
    padelTeams: [
      { id: 'team1', name: 'Coppia Uno', player1Id: 'a', player2Id: 'b' },
      { id: 'team2', name: 'Coppia Due', player1Id: 'c', player2Id: 'd' },
    ],
  })] }));
  assert.match(html, /Coppia Uno \(Giocatore a \/ Giocatore b\) vs Coppia Due \(Giocatore c \/ Giocatore d\)/);
});

test('unrecognized centres and missing dates stay visible with explicit warnings', () => {
  const e = event({ globalTimeSlots: [], tournaments: [tournament('t1', {
    groups: [{ matches: [match('m1', { scheduledTime: 'invalid', location: 'Altro centro' })] }],
  })] });
  const html = render(e);
  assert.match(html, /Altri centri o centro da verificare/);
  assert.match(html, /Data e ora non disponibili/);
  assert.match(html, /Campo non specificato/);
  assert.ok(!html.includes('Invalid Date'));
  assert.equal((render(event({ tournaments: [] })).match(/Nessuna partita prenotata per questo centro/g) || []).length, 2);
});

test('scheduled reservations offer edit/cancel while completed reservations remain read-only', () => {
  const html = render(event());
  assert.match(html, /Modifica prenotazione/);
  assert.match(html, /Cancella prenotazione/);
  const completed = event();
  completed.tournaments[0].groups[0].matches[0].status = 'completed';
  assert.ok(!render(completed).includes('Cancella prenotazione'));
  assert.ok(!render(completed).includes('Modifica prenotazione'));
});

test('admin centre panels replace manual slot entry with the correct external booking link', () => {
  const e = event({ globalTimeSlots: [
    slot('expired-free', { expiresAt: '2020-01-01T00:00:00Z', field: 'Campo libero scaduto' }),
    slot('s1', { expiresAt: '2020-01-01T00:00:00Z', field: 'Campo prenotato' }),
    slot('no-expiry', { field: 'Campo senza scadenza' }),
  ] });
  const before = structuredClone(e);
  for (const [venueId, url, provider] of [
    ['canottieri-salo', 'https://playtomic.com/it/clubs/tennis-salo-canottieri', 'Playtomic'],
    ['paitone-arena', 'https://paitonearena.wansport.com/', 'Wansport'],
  ]) {
    const html = renderToStaticMarkup(React.createElement(TournamentVenueSlots, { event: e, venueId }));
    assert.ok(html.includes(`href="${url}"`));
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
    assert.ok(html.includes(provider));
    assert.doesNotMatch(html, /<input|<form|Aggiungi slot libero|Slot disponibili fino a/);
    assert.match(html, /giorno e orario già prenotati/);
    assert.match(html, /non verifica la disponibilità/);
  }
  assert.deepEqual(e, before);
});

test('overview shows external bookings without slot ids and warns that external reservations are not synchronized', () => {
  const e = event({ globalTimeSlots: [], tournaments: [tournament('t1', {
    groups: [{ matches: [match('external', {
      slotId: undefined, scheduledTime: '2030-06-03T18:00:00Z', location: 'Paitone Arena', field: '',
    })] }],
  })] });
  const html = render(e);
  assert.match(html, /Paitone Arena \(1\)/);
  assert.match(html, /Campo non specificato/);
  assert.match(html, /non modifica né annulla il campo su Playtomic o Wansport/);
});
