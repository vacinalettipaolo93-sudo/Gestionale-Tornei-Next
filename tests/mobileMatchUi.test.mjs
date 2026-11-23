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

const temporary = mkdtempSync(path.join(os.tmpdir(), 'mobile-match-ui-'));
after(() => rmSync(temporary, { recursive: true }));
await build({
  entryPoints: ['components/MatchList.tsx', 'components/PadelIndividualRankingView.tsx', 'components/GroupManagement.tsx', 'components/TournamentTabBar.tsx', 'components/MatchFinder.tsx', 'components/StandingsTable.tsx'], bundle: true, platform: 'node',
  format: 'esm', outdir: temporary, outExtension: { '.js': '.mjs' },
  plugins: [{
    name: 'render-dependencies',
    setup(plugin) {
      const require = createRequire(import.meta.url);
      plugin.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'state' }));
      plugin.onLoad({ filter: /.*/, namespace: 'state' }, () => ({
        contents: `import React from ${JSON.stringify(require.resolve('react'))};
          export * from ${JSON.stringify(require.resolve('react'))};
          export default React;
          export const useState = initial => React.useState(initial === 'ranking' ? 'matches' : initial);`,
      }));
      plugin.onResolve({ filter: /\/react\/index\.js$/ }, args => ({ path: args.path, external: true }));
      plugin.onResolve({ filter: /^react(-dom)?\/|^react-dom$/ }, args => ({ path: require.resolve(args.path), external: true }));
      plugin.onResolve({ filter: /\/useTournamentAvailability$/ }, () => ({ path: 'availability', namespace: 'stub' }));
      plugin.onResolve({ filter: /\/services\/eventDataService$/ }, () => ({ path: 'event-service', namespace: 'event-stub' }));
      plugin.onLoad({ filter: /.*/, namespace: 'event-stub' }, () => ({
        contents: 'export async function saveEventChanges() { throw new Error("Unexpected save during rendering"); }',
      }));
      plugin.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const useTournamentAvailability = () => ({ loading: false, error: null, slotPreferences: [], dateUnavailabilities: [], venuePreferences: [] });' }));
    },
  }],
});
const loadModule = async name => import(pathToFileURL(path.join(temporary, `${name}.mjs`)).href);
const load = async name => (await loadModule(name)).default;
const MatchList = await load('MatchList');
const PadelIndividualRankingView = await load('PadelIndividualRankingView');
const GroupManagement = await load('GroupManagement');
const TournamentTabBar = await load('TournamentTabBar');
const { RankingMatchFinder } = await loadModule('MatchFinder');
const StandingsTable = await load('StandingsTable');
const players = ['a', 'b', 'c', 'd'].map(id => ({ id, name: `Player ${id}`, status: 'confirmed', avatar: 'avatar.png', phone: '' }));
const match = (id, p1 = 'a', p2 = 'b', overrides = {}) => ({
  id, player1Id: p1, player2Id: p2, score1: null, score2: null, status: 'pending', ...overrides,
});
const renderMatches = matches => renderToStaticMarkup(React.createElement(MatchList, {
  group: { id: 'g1', matches }, players, isOrganizer: false, loggedInPlayerId: 'a', viewingOwnGroup: false,
  onEditResult() {}, onBookMatch() {}, onPlayerContact() {}, onRescheduleMatch() {}, onCancelBooking() {}, onDeleteResult() {},
}));

test('assigned players and Padel teams have always-visible red-outlined icon-only removal buttons', () => {
  for (const padel of [false, true]) {
    const group = { id: 'g', name: 'Girone A', playerIds: padel ? ['team'] : ['a'], matches: [] };
    const tournament = { id: 't', groups: [group], padelTeams: [{ id: 'team', name: 'Coppia A', player1Id: 'a', player2Id: 'b' }] };
    const html = renderToStaticMarkup(React.createElement(GroupManagement, {
      event: { players, tournaments: [tournament], eventType: padel ? 'tournament_padel' : 'tournament_singolare' },
      tournament, isOrganizer: true, setEvents() {},
    }));
    const button = html.match(/<button[^>]*aria-label="Rimuovi [^"]+ dal girone Girone A"[^>]*>[\s\S]*?<\/button>/)?.[0];
    assert.ok(button);
    assert.match(button, /title="Rimuovi dal girone"/);
    assert.match(button, /h-11 w-11/);
    assert.match(button, /border border-red-500/);
    assert.doesNotMatch(button, />\s*Rimuovi dal girone/);
    assert.doesNotMatch(button, /opacity-0|group-hover/);
    assert.match(button, /type="button"/);
  }
});

test('legacy scheduled matches without slotId stay visible with own booking actions', () => {
  const html = renderMatches([match('legacy', 'a', 'b', { status: 'scheduled', scheduledTime: '2035-06-03T18:00:00Z' })]);
  assert.match(html, /Modifica prenotazione/);
  assert.match(html, /Annulla prenotazione/);
  assert.match(html, /Inserisci risultato/);
});

test('scheduled match shows both players around vs, with court details below on all screen sizes', () => {
  const html = renderMatches([match('booked', 'a', 'b', {
    status: 'scheduled',
    scheduledTime: '2035-06-03T18:00:00Z',
    location: 'Canottieri Salò',
    field: 'Campo 2',
  })]);
  const firstPlayer = html.indexOf('Player a');
  const versus = html.indexOf('>vs</div>', firstPlayer);
  const secondPlayer = html.indexOf('Player b', versus);
  const courtDetails = html.indexOf('Campo di gioco', secondPlayer);

  assert.ok(firstPlayer >= 0 && firstPlayer < versus);
  assert.ok(versus < secondPlayer && secondPlayer < courtDetails);
  assert.match(html.slice(courtDetails), /Canottieri Salò · Campo 2/);
});

test('tournament tabs stay in one swipeable row with a clearly selected section', () => {
  const tabs = [
    { id: 'standings', label: 'Classifica' },
    { id: 'matches', label: 'Partite' },
    { id: 'availability', label: 'Disponibilità di gioco' },
    { id: 'groups', label: 'Gestione Gironi' },
  ];
  const html = renderToStaticMarkup(React.createElement(TournamentTabBar, {
    tabs, activeTab: 'availability', onSelect() {},
  }));
  const nav = html.match(/<nav[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav);
  assert.match(nav, /aria-label="Sezioni del torneo"/);
  assert.match(nav, /flex-nowrap[^"]*overflow-x-auto/);
  for (const tab of tabs) assert.ok(nav.includes(tab.label));
  assert.match(nav, /aria-current="page"[^>]*>Disponibilità di gioco<\/button>/);
  assert.equal((nav.match(/whitespace-nowrap/g) ?? []).length, tabs.length);
});

test('standings table scrolls horizontally on mobile and keeps long player names separate from stats', () => {
  const html = renderToStaticMarkup(React.createElement(StandingsTable, {
    group: { id: 'g', name: 'Girone', playerIds: ['a'], matches: [] },
    players: [{ id: 'a', name: 'Michele Bonomini', avatar: 'avatar.png' }],
    settings: { pointRules: [], pointsPerDraw: 1, tieBreakers: [], playoffSettings: [], consolationSettings: [], hasBronzeFinal: false },
    onPlayerContact() {},
  }));
  assert.match(html, /aria-label="Classifica del girone"[^>]*tabindex="0"[^>]*class="overflow-x-auto overscroll-x-contain"/);
  assert.match(html, /min-w-\[680px\]/);
  assert.match(html, /min-w-56[^"]*whitespace-nowrap/);
  assert.match(html, /Scorri la tabella orizzontalmente per vedere tutte le statistiche/);
  assert.ok(html.indexOf('Michele Bonomini') < html.indexOf('>0</td>'));
});

test('match finder lists players by number of shared periods without exposing their availability details', () => {
  const html = renderToStaticMarkup(React.createElement(RankingMatchFinder, {
    currentPlayerId: 'a',
    opponents: [players[1], players[2]],
    availabilities: {
      a: { dayPeriods: { monday: ['morning', 'afternoon', 'evening'] } },
      b: { dayPeriods: { monday: ['morning'] } },
      c: { dayPeriods: { monday: ['morning', 'afternoon'] } },
    },
    onAvailability() {},
    onPlayerContact() {},
    onChallenge() {},
  }));
  const higherMatch = html.indexOf('Player c');
  const lowerMatch = html.indexOf('Player b');

  assert.ok(higherMatch >= 0 && higherMatch < lowerMatch);
  assert.match(html, /2 fasce in comune/);
  assert.match(html, /1 fascia in comune/);
  assert.match(html, /Sfida/);
  assert.doesNotMatch(html, /Lunedì|Mattina|Pomeriggio|Sera/);
});

test('own result controls remain accessible outside the original group and completed filter excludes other players', () => {
  const html = renderMatches([
    match('own', 'a', 'b', { score1: 6, score2: 3, status: 'completed' }),
    match('other', 'c', 'd', { score1: 7, score2: 5, status: 'completed' }),
  ]);
  assert.match(html, /Modifica risultato/);
  assert.match(html, /Elimina risultato/);
  assert.doesNotMatch(html, /Player c/);
  assert.doesNotMatch(html, /Player d/);
});

test('confirmed Padel participant can open a fresh score dialog before selecting the other players', () => {
  const source = renderToStaticMarkup(React.createElement(PadelIndividualRankingView, {
    players, rankingData: { slots: [], matches: [], participantIds: players.map(player => player.id) },
    isOrganizer: false, loggedInPlayerId: 'a', onSaveRankingData: async () => {},
  }));
  const button = source.match(/<button[^>]*>Inserisci risultato<\/button>/)?.[0];
  assert.ok(button, 'the matches tab renders the opening action');
  assert.doesNotMatch(button, /\sdisabled(?:=|[ >])/, 'opening must not require selecting players inside the still-closed dialog');
});
