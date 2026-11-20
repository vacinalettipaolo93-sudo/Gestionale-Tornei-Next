import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const result = await build({
  entryPoints: ['components/AvailabilityTab.tsx'],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{
    name: 'availability-fixtures',
    setup(plugin) {
      plugin.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
      plugin.onResolve({ filter: /\/useTournamentAvailability$/ }, () => ({ path: 'availability', namespace: 'stub' }));
      plugin.onResolve({ filter: /\/useSlotClock$/ }, () => ({ path: 'clock', namespace: 'stub' }));
      plugin.onResolve({ filter: /\/services\/availabilityService$/ }, () => ({ path: 'service', namespace: 'stub' }));
      plugin.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
        contents: path === 'availability' ? `
          export const useTournamentAvailability = () => ({
            loading: false, error: null,
            venueMap: { a: new Set(['canottieri-salo']), z: new Set(['paitone-arena']) },
            dateUnavailMap: { a: new Set(['2035-06-10']) },
            periodMap: {
              a: [{ date: '2035-06-09', venueId: 'canottieri-salo', period: 'MORNING' }],
              z: [
                { date: '2035-06-08', venueId: 'paitone-arena', period: 'AFTERNOON' },
                { date: '2035-06-11', venueId: 'paitone-arena', period: 'MORNING' },
              ],
            },
          });
        ` : path === 'clock' ? `
          export const useSlotClock = () => Date.parse('2035-06-01T12:00:00Z');
        ` : `
          export const removeDateUnavailability = () => { throw new Error('Unexpected write'); };
          export const setDateUnavailability = removeDateUnavailability;
          export const setTournamentPeriodAvailability = removeDateUnavailability;
          export const setTournamentVenues = removeDateUnavailability;
        `,
      }));
    },
  }],
});
const { default: AvailabilityTab } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const players = [{ id: 'a', name: 'Alice' }, { id: 'z', name: 'Zoe' }];
const render = (loggedInPlayerId, playerIds = ['a', 'z']) => renderToStaticMarkup(React.createElement(AvailabilityTab, {
  event: { id: 'event', players }, tournament: { id: 'tournament' },
  selectedGroup: { name: 'Girone A', playerIds }, loggedInPlayerId,
}));

test('participant table always shows both venues while personal editing follows the selected venue', () => {
  for (const [playerId, venueName, otherVenue] of [
    ['a', 'Canottieri Salò', 'Paitone Arena'],
    ['z', 'Paitone Arena', 'Canottieri Salò'],
  ]) {
    const html = render(playerId);
    const table = html.match(/<table[\s\S]*?<\/table>/)[0];
    assert.match(table, /<th[^>]*>Canottieri Salò<\/th>/);
    assert.match(table, /<th[^>]*>Paitone Arena<\/th>/);
    const editor = html.slice(html.indexOf('3. Imposta disponibilità'), html.indexOf('<table'));
    assert.ok(editor.includes(`<h5 class="font-bold text-accent">${venueName}</h5>`));
    assert.ok(!editor.includes(`<h5 class="font-bold text-accent">${otherVenue}</h5>`));
    const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].slice(1).map(match => match[1]);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map(row => row.match(/<td[^>]*>([^<]*)<\/td>/)[1]), ['Zoe', 'Alice', 'Alice', 'Zoe']);
    assert.match(rows[0], /<td[^>]*>—<\/td>[\s\S]*text-green-400">Pomeriggio/);
    assert.match(rows[1], /text-green-400">Mattina[\s\S]*<td[^>]*>—<\/td>/);
    assert.match(rows[0], /text-green-400">Disponibile/);
    assert.match(rows[2], /text-red-400">Non disponibile/);
    assert.doesNotMatch(rows[2], /text-green-400/);
  }
});

test('empty participant table spans both venue columns regardless of personal preference', () => {
  assert.match(render('a', []).match(/<table[\s\S]*?<\/table>/)[0], /colSpan="5"/i);
});

test('availability sections and each weekend are independently collapsible and initially open', () => {
  const html = render('a');
  const details = [...html.matchAll(/<details([^>]*)>/g)].map(match => match[1]);

  assert.equal(details.length, 17);
  assert.ok(details.every(attributes => attributes.includes('open=""')));
  assert.match(html, /<summary>1\. Per quali circoli vuoi indicare la disponibilità\?<\/summary>/);
  assert.match(html, /<summary>2\. Seleziona le date da impostare<\/summary>/);
  assert.match(html, /<summary>Weekend 1<\/summary>/);
  assert.match(html, /Le mie disponibilità salvate/);
  assert.match(html, /3\. Imposta disponibilità/);
  assert.ok(html.indexOf('3. Imposta disponibilità') < html.indexOf('Le mie disponibilità salvate'));
  assert.match(html, /Disponibilità dichiarate · Girone A/);
});
