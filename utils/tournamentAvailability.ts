import { type Event, type TimeSlot, type Tournament } from '../types';

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
  return { id, start: date.toISOString(), location, field };
}

export function getAvailabilityDateKey(start: string): string {
  const date = new Date(start);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getTournamentAvailabilitySlots(event: Event, tournament: Tournament, now = Date.now()): TimeSlot[] {
  const slots = new Map<string, TimeSlot>();
  for (const raw of [
    ...(Array.isArray(tournament.timeSlots) ? tournament.timeSlots : []),
    ...(Array.isArray(event.globalTimeSlots) ? event.globalTimeSlots : []),
  ]) {
    const slot = normalizeTournamentSlot(raw);
    if (!slot) continue;
    const previous = slots.get(slot.id);
    if (!previous || Date.parse(slot.start) < Date.parse(previous.start)) slots.set(slot.id, slot);
  }

  const bookedIds = new Set<string>();
  const bookedTimes = new Set<number>();
  for (const item of event.tournaments ?? []) {
    const matches = [
      ...(item.groups ?? []).flatMap(group => group.matches ?? []),
      ...(item.playoffMatches ?? []),
      ...(item.consolationMatches ?? []),
    ];
    for (const match of matches) {
      if (match.slotId) bookedIds.add(String(match.slotId));
      if (match.scheduledTime) bookedTimes.add(Date.parse(match.scheduledTime));
    }
  }
  return [...slots.values()]
    .filter(slot => Date.parse(slot.start) > now && !bookedIds.has(slot.id) && !bookedTimes.has(Date.parse(slot.start)))
    .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
}
