import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = mkdtempSync(path.join(os.tmpdir(), 'external-booking-ui-'));
after(() => {
  rmSync(temporary, { recursive: true });
  delete globalThis.__externalBookingUi;
});
await build({
  entryPoints: ['components/TournamentBookingModal.tsx'], outdir: temporary,
  bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' },
  plugins: [{
    name: 'booking-ui-dependencies',
    setup(plugin) {
      plugin.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'react' }));
      plugin.onLoad({ filter: /.*/, namespace: 'react' }, () => ({
        contents: `
          export const jsx = (type, props) => ({ type, props });
          export const jsxs = jsx;
          export const useState = initial => globalThis.__externalBookingUi.useState(initial);
          export default { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
        `,
      }));
      plugin.onResolve({ filter: /\/CenteredDialog$/ }, () => ({ path: 'dialog', namespace: 'dialog' }));
      plugin.onLoad({ filter: /.*/, namespace: 'dialog' }, () => ({ contents: 'export default function Dialog(props) { return props.children; }' }));
      plugin.onResolve({ filter: /\/services\/tournamentBookingService$/ }, () => ({ path: 'service', namespace: 'service' }));
      plugin.onLoad({ filter: /.*/, namespace: 'service' }, () => ({
        contents: `export async function saveTournamentSlotAction(...args) {
          globalThis.__externalBookingUi.actions.push(args);
          if (globalThis.__externalBookingUi.fail) throw new Error('Salvataggio Firebase rifiutato');
        }`,
      }));
    },
  }],
});
const { default: Modal } = await import(pathToFileURL(path.join(temporary, 'TournamentBookingModal.mjs')).href);
const match = { id: 'm', player1Id: 'a', player2Id: 'b', status: 'pending', score1: null, score2: null };
const tournament = { id: 't', name: 'Winter League', groups: [{ matches: [match] }], timeSlots: [] };
const event = { id: 'e', name: 'Winter League', eventType: 'tournament_singolare',
  players: [{ id: 'a', name: 'Mario Rossi' }, { id: 'b', name: 'Luca Bianchi' }], tournaments: [tournament], globalTimeSlots: [] };

function harness(overrides = {}) {
  const states = [];
  let index = 0;
  const ui = {
    actions: [], closed: false, fail: false,
    useState(initial) {
      const id = index++;
      if (!(id in states)) states[id] = typeof initial === 'function' ? initial() : initial;
      return [states[id], next => { states[id] = typeof next === 'function' ? next(states[id]) : next; }];
    },
    render() {
      index = 0;
      globalThis.__externalBookingUi = ui;
      return Modal({ event, tournament, match, isOrganizer: false, loggedInPlayerId: 'a',
        onClose() { ui.closed = true; }, ...overrides });
    },
    find(predicate) { return elements(ui.render()).find(predicate); },
    change(id, value) { ui.find(element => element.props?.id === id).props.onChange({ target: { value } }); },
    confirm() { ui.find(element => element.type === 'input' && element.props.type === 'checkbox').props.onChange({ target: { checked: true } }); },
    submit() { return ui.find(element => element.type === 'form').props.onSubmit({ preventDefault() {} }); },
  };
  return ui;
}

function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

test('choosing each centre opens the supplied external link in a new tab, without an app write', () => {
  const ui = harness();
  for (const [venueId, url] of [
    ['canottieri-salo', 'https://playtomic.com/it/clubs/tennis-salo-canottieri'],
    ['paitone-arena', 'https://paitonearena.wansport.com/'],
  ]) {
    const link = ui.find(element => element.type === 'a' && element.props.href === url);
    assert.ok(link);
    assert.equal(link.props.target, '_blank');
    assert.equal(link.props.rel, 'noopener noreferrer');
    link.props.onClick();
    assert.equal(ui.find(element => element.props?.id === 'booking-venue').props.value, venueId);
    assert.equal(ui.actions.length, 0);
    assert.equal(ui.closed, false);
  }
});

test('returning from the provider records the selected centre, day and time without needing any slot', async () => {
  const ui = harness();
  ui.change('booking-venue', 'paitone-arena');
  ui.change('booking-date', '2099-06-03');
  ui.change('booking-time', '19:30');
  await ui.submit();
  assert.equal(ui.actions.length, 0);
  assert.match(ui.find(element => element.props?.role === 'alert').props.children, /Conferma/);
  ui.confirm();
  await ui.submit();
  assert.deepEqual(ui.actions, [['e', 't', {
    type: 'book-external', matchId: 'm', booking: {
      venueId: 'paitone-arena', date: '2099-06-03', time: '19:30', field: '', confirmed: true,
    },
  }, { isOrganizer: false, playerId: 'a' }]]);
  assert.equal(ui.closed, true);
});

test('registration failures keep the dialog, confirmation and entered details available for retry', async () => {
  const ui = harness();
  ui.change('booking-venue', 'canottieri-salo');
  ui.change('booking-date', '2099-06-03');
  ui.change('booking-time', '18:00');
  ui.change('booking-field', 'Campo 2');
  ui.confirm();
  ui.fail = true;
  await ui.submit();
  assert.equal(ui.closed, false);
  assert.match(ui.find(element => element.props?.role === 'alert').props.children, /Firebase rifiutato/);
  assert.equal(ui.find(element => element.props?.id === 'booking-date').props.value, '2099-06-03');
  assert.equal(ui.find(element => element.props?.id === 'booking-field').props.value, 'Campo 2');
  ui.fail = false;
  await ui.submit();
  assert.equal(ui.closed, true);
});

test('rescheduling prefills a legacy booking, requires confirmation again and clears old-centre details on change', async () => {
  const start = new Date(2099, 5, 3, 18, 30).toISOString();
  const ui = harness({ reschedule: true, match: { ...match, status: 'scheduled', slotId: 'legacy',
    scheduledTime: start, location: 'Canottieri Salo', field: 'Campo 1' } });
  assert.equal(ui.find(element => element.props?.id === 'booking-date').props.value, '2099-06-03');
  assert.equal(ui.find(element => element.props?.id === 'booking-time').props.value, '18:30');
  assert.equal(ui.find(element => element.type === 'input' && element.props.type === 'checkbox').props.checked, false);
  ui.confirm();
  await ui.submit();
  assert.equal(ui.actions[0][2].type, 'reschedule-external');
  ui.change('booking-venue', 'paitone-arena');
  assert.equal(ui.find(element => element.props?.id === 'booking-date').props.value, '');
  assert.equal(ui.find(element => element.props?.id === 'booking-time').props.value, '');
  assert.equal(ui.find(element => element.props?.id === 'booking-field').props.value, '');
  assert.equal(ui.find(element => element.type === 'input' && element.props.type === 'checkbox').props.checked, false);
});
