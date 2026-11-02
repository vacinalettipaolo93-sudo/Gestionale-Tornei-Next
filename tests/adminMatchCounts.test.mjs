import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'admin-match-counts-'));
after(() => {
  rmSync(tempDir, { recursive: true });
  delete globalThis.matchFilterState;
  delete globalThis.matchFilterUpdates;
  delete globalThis.matchFilterIndex;
});
const require = createRequire(import.meta.url);
await build({
  entryPoints: ['components/AdminMatchCounts.tsx'],
  bundle: true, platform: 'node', format: 'esm', outfile: path.join(tempDir, 'component.mjs'),
  plugins: [{
    name: 'controlled-react-state',
    setup(plugin) {
      plugin.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'test' }));
      plugin.onResolve({ filter: /^react\/.*$/ }, args => ({ path: require.resolve(args.path), external: true }));
      plugin.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: `
          import React from ${JSON.stringify(require.resolve('react'))};
          export default React;
          export const useMemo = callback => callback();
          export const useState = initial => {
            const index = globalThis.matchFilterIndex++;
            return [globalThis.matchFilterState[index] ?? initial, value => globalThis.matchFilterUpdates.push([index, value])];
          };
        `,
      }));
      plugin.onResolve({ filter: /\/react\/index\.js$/ }, args => ({ path: args.path, external: true }));
    },
  }],
});
const { default: AdminMatchCounts } = await import(pathToFileURL(path.join(tempDir, 'component.mjs')).href);
const match = (id, player1Id, player2Id, status = 'pending') => ({ id, player1Id, player2Id, status });
const group = (id, name, playerIds, matches) => ({ id, name, playerIds, matches });
const event = {
  players: ['Alice', 'Bruno', 'Carla', 'Dario', 'Elena', 'Fabio'].map(name => ({ id: name, name })),
  tournaments: [
    { id: 't1', name: 'Torneo Tennis', groups: [
      group('g1', 'Girone Rosso', ['Alice', 'Bruno'], [match('m1', 'Alice', 'Bruno')]),
      group('g2', 'Girone Blu', ['Carla', 'Dario'], [match('m2', 'Carla', 'Dario', 'completed')]),
    ] },
    { id: 't2', name: 'Torneo Serale', groups: [
      group('g1', 'Girone Verde', ['Elena', 'Fabio'], [match('m3', 'Elena', 'Fabio')]),
    ] },
  ],
};
function render(state = [], input = event, onSelectTournament) {
  globalThis.matchFilterState = state;
  globalThis.matchFilterUpdates = [];
  globalThis.matchFilterIndex = 0;
  const tree = AdminMatchCounts({ event: input, onSelectTournament });
  const nodes = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    nodes.push(node);
    walk(node.props?.children);
  }
  walk(tree);
  return {
    html: renderToStaticMarkup(tree),
    get: id => nodes.find(node => node.props?.id === id),
    rows: nodes.filter(node => node.type === 'tr' && node.props.className?.includes('border-t')),
    nodes,
  };
}
test('default view preserves all tournaments and disables group selection until a tournament is chosen', () => {
  const result = render();
  assert.equal(result.rows.length, 6);
  assert.equal(result.get('matchGroupFilter').props.disabled, true);
  assert.match(result.html, /Tutti i tornei/);
});
test('tournament filter includes all of its groups and populates only its own group options', () => {
  const result = render([4, 't1', '']);
  assert.equal(result.rows.length, 4);
  assert.match(result.html, /Alice/);
  assert.match(result.html, /Carla/);
  assert.ok(result.rows.every(row => !renderToStaticMarkup(row).includes('Elena')));
  const options = result.get('matchGroupFilter').props.children[1];
  assert.deepEqual(options.map(option => option.props.children), ['Girone Rosso', 'Girone Blu']);
});
test('group filter is scoped to the tournament even when group ids repeat across tournaments', () => {
  const first = render([4, 't1', 'g1']);
  assert.equal(first.rows.length, 2);
  assert.match(renderToStaticMarkup(first.rows[0]), /Alice/);
  const second = render([4, 't2', 'g1']);
  assert.equal(second.rows.length, 2);
  assert.match(renderToStaticMarkup(second.rows[0]), /Elena/);
});
test('played threshold and completed mode compose with tournament and group filters', () => {
  assert.equal(render([0, 't1', 'g2']).rows.length, 0);
  assert.equal(render([1, 't1', 'g2']).rows.length, 2);
  assert.equal(render(['completed', 't1', 'g2']).rows.length, 2);
  assert.equal(render(['completed', 't1', 'g1']).rows.length, 0);
});
test('changing tournament clears the previous group while preserving the number filter', () => {
  const result = render([2, 't1', 'g2']);
  result.get('matchTournamentFilter').props.onChange({ target: { value: 't2' } });
  assert.deepEqual(globalThis.matchFilterUpdates, [[1, 't2'], [2, '']]);
  result.get('matchGroupFilter').props.onChange({ target: { value: 'g1' } });
  assert.deepEqual(globalThis.matchFilterUpdates.at(-1), [2, 'g1']);
});
test('removed tournament/group selections recover to available scopes and empty events render safely', () => {
  assert.equal(render([4, 'deleted', 'g1']).rows.length, 6);
  assert.equal(render([4, 't1', 'deleted']).rows.length, 4);
  const empty = render([4, 't1', 'g1'], { players: [], tournaments: [] });
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.get('matchGroupFilter').props.disabled, true);
});
test('clicking a filtered player still opens the correct tournament and group', () => {
  const calls = [];
  const result = render([4, 't2', 'g1'], event, (...args) => calls.push(args));
  result.nodes.find(node => node.type === 'td' && node.props.children === 'Elena').props.onClick();
  assert.deepEqual(calls, [[event.tournaments[1], 'participants', 'g1']]);
});
