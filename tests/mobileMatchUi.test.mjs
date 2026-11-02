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
  entryPoints: ['components/MatchList.tsx', 'components/PadelIndividualRankingView.tsx'], bundle: true, platform: 'node',
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
      plugin.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const useTournamentAvailability = () => ({ loading: false, error: null, slotPreferences: [], dateUnavailabilities: [], venuePreferences: [] });' }));
    },
  }],
});
const load = async name => (await import(pathToFileURL(path.join(temporary, `${name}.mjs`)).href)).default;
const MatchList = await load('MatchList');
const PadelIndividualRankingView = await load('PadelIndividualRankingView');
const players = ['a', 'b', 'c', 'd'].map(id => ({ id, name: `Player ${id}`, status: 'confirmed', avatar: '', phone: '' }));
const match = (id, p1 = 'a', p2 = 'b', overrides = {}) => ({
  id, player1Id: p1, player2Id: p2, score1: null, score2: null, status: 'pending', ...overrides,
});
const renderMatches = matches => renderToStaticMarkup(React.createElement(MatchList, {
  group: { id: 'g1', matches }, players, isOrganizer: false, loggedInPlayerId: 'a', viewingOwnGroup: false,
  onEditResult() {}, onBookMatch() {}, onPlayerContact() {}, onRescheduleMatch() {}, onCancelBooking() {}, onDeleteResult() {},
}));

test('legacy scheduled matches without slotId stay visible with own booking actions', () => {
  const html = renderMatches([match('legacy', 'a', 'b', { status: 'scheduled', scheduledTime: '2035-06-03T18:00:00Z' })]);
  assert.match(html, /Modifica prenotazione/);
  assert.match(html, /Annulla prenotazione/);
  assert.match(html, /Inserisci risultato/);
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
