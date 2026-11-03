import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = mkdtempSync(path.join(os.tmpdir(), 'event-tournament-scroll-'));
after(() => {
  rmSync(temporary, { recursive: true });
  delete globalThis.__eventScroll;
});
await build({
  entryPoints: ['components/EventView.tsx'], outdir: temporary,
  bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' },
  plugins: [{
    name: 'event-scroll-dependencies',
    setup(plugin) {
      plugin.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'react' }));
      plugin.onLoad({ filter: /.*/, namespace: 'react' }, () => ({
        contents: `
          export const jsx = (type, props, key) => ({ type, props, key });
          export const jsxs = jsx;
          export const useState = initial => [initial, () => {}];
          export const useRef = initial => globalThis.__eventScroll.useRef(initial);
          export const useEffect = (effect, deps) => globalThis.__eventScroll.useEffect(effect, deps);
          export default { createElement: (type, props, ...children) => ({ type, key: props?.key, props: { ...props, children } }) };
        `,
      }));
      plugin.onResolve({ filter: /\/useSectionScroll$/ }, () => ({ path: 'section', namespace: 'stub' }));
      plugin.onResolve({ filter: /\/usePersistenceAction$/ }, () => ({ path: 'draft', namespace: 'stub' }));
      plugin.onResolve({ filter: /\/services\/eventDataService$/ }, () => ({ path: 'service', namespace: 'stub' }));
      plugin.onResolve({ filter: /^\.\/(AdminMatchCounts|BookedVenueSlots|EventPlayersView|Icons|RegolamentoGironiPanel|TournamentVenueSlots)$/ }, () => ({ path: 'child', namespace: 'stub' }));
      plugin.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
        contents: args.path === 'section' ? `export const useSectionScroll = () => ({ current: null });`
          : args.path === 'draft' ? `export const useSyncedDraft = value => [value, () => {}, value];`
            : args.path === 'service' ? `export async function saveEventChanges() { throw new Error('Unexpected write'); }`
              : `export default function Child() { return null; } export const PlusIcon = () => null; export const TrashIcon = () => null;`,
      }));
    },
  }],
});
const { default: EventView } = await import(pathToFileURL(path.join(temporary, 'EventView.mjs')).href);
const tournament = (id, playerIds = []) => ({ id, name: id, groups: [{ id: `${id}-group`, playerIds, matches: [] }] });
const event = (overrides = {}) => ({ id: 'e', name: 'Winter League', tournaments: [
  tournament('other'), tournament('mine', ['p']), tournament('last'),
], ...overrides });

function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

function harness() {
  const refs = [], effects = [];
  let refIndex = 0, effectIndex = 0, nextFrame = 0;
  const queue = new Map(), scrolls = [], selections = [];
  const oldRequest = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  const ui = {
    useRef(initial) { return refs[refIndex++] ??= { current: initial }; },
    useEffect(effect, deps) {
      const id = effectIndex++;
      const previous = effects[id];
      if (previous && deps.every((value, index) => Object.is(value, previous.deps[index]))) return;
      previous?.cleanup?.();
      effects[id] = { deps, run: effect };
    },
    render(e = event(), overrides = {}) {
      globalThis.__eventScroll = ui;
      globalThis.requestAnimationFrame = callback => { const id = ++nextFrame; queue.set(id, callback); return id; };
      globalThis.cancelAnimationFrame = id => queue.delete(id);
      refIndex = effectIndex = 0;
      const tree = EventView({ event: e, players: [], isOrganizer: false, loggedInPlayerId: 'p',
        setEvents() { assert.fail('scroll must not write event state'); },
        onSelectTournament(...args) { selections.push(args); }, ...overrides });
      for (const element of elements(tree)) {
        if (element.props?.ref && element.key) {
          element.props.ref.current = { scrollIntoView: options => scrolls.push({ id: element.key, options }) };
        }
      }
      effects.forEach(effect => {
        if (effect.run) { effect.cleanup = effect.run(); delete effect.run; }
      });
      return tree;
    },
    frame() { const pending = [...queue.values()]; queue.clear(); pending.forEach(callback => callback()); },
    flush() { ui.frame(); ui.frame(); },
    scrolls, selections,
    close() {
      effects.forEach(effect => effect.cleanup?.());
      globalThis.requestAnimationFrame = oldRequest;
      globalThis.cancelAnimationFrame = oldCancel;
    },
  };
  return ui;
}

test('participant stays in the list and scrolls only to the assigned card after entry positioning', () => {
  const ui = harness();
  try {
    const tree = ui.render();
    assert.ok(elements(tree).some(element => element.key === 'other'));
    assert.ok(elements(tree).some(element => element.key === 'last'));
    ui.frame();
    assert.deepEqual(ui.scrolls, []);
    ui.frame();
    assert.deepEqual(ui.scrolls, [{ id: 'mine', options: { block: 'start', inline: 'nearest', behavior: 'instant' } }]);
    assert.deepEqual(ui.selections, [], 'never opens a tournament automatically');
    ui.render(structuredClone(event()));
    ui.flush();
    assert.equal(ui.scrolls.length, 1, 'Firebase snapshots do not repeat the scroll');
  } finally { ui.close(); }
});

test('organizers, missing identities and unassigned participants do not trigger personal scrolling', () => {
  for (const overrides of [{ isOrganizer: true }, { loggedInPlayerId: undefined }, { loggedInPlayerId: 'unassigned' }]) {
    const ui = harness();
    try { ui.render(event(), overrides); ui.flush(); assert.deepEqual(ui.scrolls, []); }
    finally { ui.close(); }
  }
});

test('Padel membership uses the player team and the quick actions open the correct group', () => {
  const ui = harness();
  try {
    const mine = { ...tournament('padel', ['team']), padelTeams: [{ id: 'team', player1Id: 'p', player2Id: 'q' }] };
    const tree = ui.render(event({ eventType: 'tournament_padel', tournaments: [tournament('other'), mine] }));
    ui.flush();
    assert.equal(ui.scrolls[0].id, 'padel');
    const card = elements(tree).find(element => element.key === 'padel');
    assert.ok(elements(card).some(element => element.props?.children === 'Il mio torneo'));
    elements(card).find(element => element.type === 'button' && element.props.title === 'Apri il tab Partite').props.onClick();
    assert.deepEqual(ui.selections, [[mine, 'matches', 'padel-group']]);
  } finally { ui.close(); }
});

test('delayed assignment scrolls once, multiple memberships select the first and new events scroll again', () => {
  const ui = harness();
  try {
    ui.render(event({ tournaments: [] })); ui.flush();
    assert.equal(ui.scrolls.length, 0);
    ui.render(event({ tournaments: [tournament('first', ['p']), tournament('second', ['p'])] })); ui.flush();
    assert.equal(ui.scrolls[0].id, 'first');
    ui.render(event({ tournaments: [tournament('second', ['p'])] })); ui.flush();
    assert.equal(ui.scrolls.length, 1);
    ui.render(event({ id: 'new-event' })); ui.flush();
    assert.equal(ui.scrolls.length, 2);
  } finally { ui.close(); }
});

test('unmounting cancels a pending scroll, including the second animation frame', () => {
  const ui = harness();
  ui.render();
  ui.frame();
  ui.close();
  ui.flush();
  assert.deepEqual(ui.scrolls, []);
});
