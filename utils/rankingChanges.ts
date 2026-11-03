import { type Event, type Match, type SummerRankingData } from '../types';
import { getMatchParticipantIds, matchIncludesPlayer, normalizeRankingData, sanitizeRankingDataForFirestore } from './rankingEvent';
import { type BookingActor } from './tournamentBooking';
import { validateMatchScores } from './tournamentResults';
import { isRecord, sameData as equal } from './documentChanges';
const conflict = () => { throw new Error('Dati modificati da un altro utente. Riapri la modifica e riprova.'); };

export function assertRankingMatchUnchanged(expected: Match | null, actual: Match | undefined): void {
  if (!actual || !equal(expected, actual)) conflict();
}

function mergeValue(baseline: unknown, next: unknown, current: unknown): unknown {
  if (equal(baseline, next)) return current;
  if (equal(current, baseline) || equal(current, next)) return next;
  if (Array.isArray(baseline) && Array.isArray(next) && Array.isArray(current)
    && [...baseline, ...next, ...current].every(item => isRecord(item) && typeof item.id === 'string')) {
    const changed = new Map<string, unknown>();
    const before = new Map(baseline.map(item => [item.id, item]));
    const after = new Map(next.map(item => [item.id, item]));
    const fresh = new Map(current.map(item => [item.id, item]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (equal(before.get(id), after.get(id))) continue;
      if (!equal(fresh.get(id), before.get(id)) && !equal(fresh.get(id), after.get(id))) conflict();
      changed.set(id, after.get(id));
    }
    return [
      ...current.flatMap(item => changed.has(item.id) ? changed.get(item.id) === undefined ? [] : [changed.get(item.id)] : [item]),
      ...next.filter(item => !fresh.has(item.id) && !before.has(item.id)),
    ];
  }
  if (isRecord(baseline) && isRecord(next) && isRecord(current)) {
    const merged = { ...current };
    for (const key of new Set([...Object.keys(baseline), ...Object.keys(next)])) {
      const value = mergeValue(baseline[key], next[key], current[key]);
      if (value === undefined) delete merged[key];
      else merged[key] = value;
    }
    return merged;
  }
  return conflict();
}

export function mergeRankingChanges(
  baseline: SummerRankingData, next: SummerRankingData, current: SummerRankingData,
  eventType: Event['eventType'], actor: BookingActor,
): SummerRankingData {
  const before = sanitizeRankingDataForFirestore(normalizeRankingData(baseline, eventType), eventType);
  const after = sanitizeRankingDataForFirestore(normalizeRankingData(next, eventType), eventType);
  const fresh = sanitizeRankingDataForFirestore(normalizeRankingData(current, eventType), eventType);
  for (const id of new Set([...before.matches, ...after.matches].map(match => match.id))) {
    const old = before.matches.find(match => match.id === id);
    const updated = after.matches.find(match => match.id === id);
    if (equal(old, updated)) continue;
    if (!actor.isOrganizer && (old && !matchIncludesPlayer(old, actor.playerId) || updated && !matchIncludesPlayer(updated, actor.playerId))) {
      throw new Error('Puoi gestire solo le tue partite.');
    }
    if (updated?.status === 'completed') {
      const error = validateMatchScores(updated.score1 == null ? '' : String(updated.score1), updated.score2 == null ? '' : String(updated.score2));
      if (error) throw new Error(error);
      if (eventType === 'ranking_padel_individuale' && updated.score1 === updated.score2) throw new Error('Nel padel individuale il risultato non può terminare in parità.');
    }
    if (updated) {
      const participants = getMatchParticipantIds(updated);
      if (participants.length !== (eventType === 'ranking_padel_individuale' ? 4 : 2)) throw new Error('Seleziona giocatori distinti per la partita.');
    }
  }
  const merged = mergeValue(before, after, fresh) as SummerRankingData;
  for (const match of after.matches) {
    const old = before.matches.find(item => item.id === match.id);
    if (equal(old, match)) continue;
    if (!old && eventType === 'ranking_singolare' && merged.rulesConfig) {
      const count = merged.matches.filter(item =>
        [match.player1Id, match.player2Id].includes(item.player1Id) && [match.player1Id, match.player2Id].includes(item.player2Id)
      ).length;
      if (count > merged.rulesConfig.headToHeadLimit) throw new Error('Il limite di scontri tra questi giocatori è già stato raggiunto.');
    }
    if (match.status !== 'scheduled' || !match.slotId
      || old?.slotId === match.slotId && old.scheduledTime === match.scheduledTime) continue;
    if (merged.matches.some(item => item.id !== match.id && item.slotId === match.slotId)) {
      throw new Error('Lo slot è già prenotato. Seleziona un altro orario.');
    }
    const slot = merged.slots.find(item => item.id === match.slotId);
    if (!slot || Date.parse(slot.start) !== Date.parse(match.scheduledTime ?? '')) {
      throw new Error('Lo slot non è più disponibile. Riapri la prenotazione e scegli un altro orario.');
    }
  }
  return merged;
}
