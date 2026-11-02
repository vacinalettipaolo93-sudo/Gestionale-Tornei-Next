import { type Event, type Match, type TimeSlot, type Tournament } from '../types';
import { getSlotVenueId } from './tournamentVenues';

const slotRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};

export function normalizeTournamentSlot(value: unknown): TimeSlot | null {
  const slot = slotRecord(value);
  const rawStart = slot.start ?? slot.time ?? slot.datetime ?? slot.date;
  const numeric = typeof rawStart === 'number' || (typeof rawStart === 'string' && /^\d+$/.test(rawStart))
    ? Number(rawStart)
    : null;
  const startMs = numeric !== null
    ? (numeric < 1e12 ? numeric * 1000 : numeric)
    : Date.parse(String(rawStart).replace(' ', 'T'));
  const date = new Date(startMs);
  if (!Number.isFinite(date.getTime())) return null;
  const location = String(slot.location ?? '');
  const field = String(slot.field ?? '');
  const id = String(slot.id ?? slot.slotId ?? slot.timeSlotId ?? `${rawStart}|${location}|${field}`);
  const venueId = slot.venueId === 'canottieri-salo' || slot.venueId === 'paitone-arena' ? slot.venueId : undefined;
  return { id, start: date.toISOString(), location, field, ...(venueId ? { venueId } : {}) };
}

export function getAvailabilityDateKey(start: string): string {
  const date = new Date(start);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getTournamentSlots(tournament: Tournament): TimeSlot[] {
  const slots = new Map<string, TimeSlot>();
  for (const raw of Array.isArray(tournament.timeSlots) ? tournament.timeSlots : []) {
    const slot = normalizeTournamentSlot(raw);
    if (!slot) continue;
    const previous = slots.get(slot.id);
    if (!previous || Date.parse(slot.start) < Date.parse(previous.start)) slots.set(slot.id, slot);
  }

  return [...slots.values()].sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
}

export const getTournamentMatches = (tournament: Tournament): Match[] => [
  ...(tournament.groups ?? []).flatMap(group => group.matches ?? []),
  ...(tournament.playoffMatches ?? []),
  ...(tournament.consolationMatches ?? []),
];

const normalizeLabel = (label: string) => label.trim().toLocaleLowerCase('it');
export function isSameCourtTime(left: TimeSlot, right: TimeSlot): boolean {
  const leftVenue = getSlotVenueId(left) ?? normalizeLabel(left.location);
  const rightVenue = getSlotVenueId(right) ?? normalizeLabel(right.location);
  return Date.parse(left.start) === Date.parse(right.start)
    && leftVenue === rightVenue && normalizeLabel(left.field) === normalizeLabel(right.field);
}

export function isTournamentSlotBooked(tournament: Tournament, slot: TimeSlot, excludingMatchId?: string): boolean {
  const slots = getTournamentSlots(tournament);
  return getTournamentMatches(tournament).some(match => {
    if (match.id === excludingMatchId) return false;
    if (match.slotId === slot.id) return true;
    const bookedSlot = slots.find(item => item.id === match.slotId);
    if (bookedSlot && isSameCourtTime(bookedSlot, slot)) return true;
    return !!match.scheduledTime && isSameCourtTime({
      id: match.id, start: match.scheduledTime, location: match.location ?? '', field: match.field ?? '',
    }, slot);
  });
}

export function getTournamentAvailabilitySlots(
  _event: Event, tournament: Tournament, now = Date.now(), excludingMatchId?: string,
): TimeSlot[] {
  return getTournamentSlots(tournament).filter(slot =>
    Date.parse(slot.start) > now && !isTournamentSlotBooked(tournament, slot, excludingMatchId)
  );
}
