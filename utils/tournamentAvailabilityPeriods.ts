import { TOURNAMENT_VENUES, type TournamentVenueId } from './tournamentVenues';

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const TOURNAMENT_AVAILABILITY_PERIODS = [
  { id: 'MORNING', label: 'Mattina', hours: '08:00–12:00', startHour: 8, endHour: 12 },
  { id: 'AFTERNOON', label: 'Pomeriggio', hours: '12:00–18:00', startHour: 12, endHour: 18 },
  { id: 'EVENING', label: 'Sera', hours: '18:00–22:00', startHour: 18, endHour: 22 },
] as const;

export type TournamentAvailabilityPeriodId = typeof TOURNAMENT_AVAILABILITY_PERIODS[number]['id'];

export interface TournamentPeriodAvailability {
  date: string;
  venueId: TournamentVenueId;
  period: TournamentAvailabilityPeriodId;
}

export interface TournamentWeekend {
  friday: string;
  saturday: string;
  sunday: string;
}

export function isValidTournamentAvailabilityDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isFinite(parsed.getTime()) && parsed.getFullYear() === year
    && parsed.getMonth() + 1 === month && parsed.getDate() === day;
}

export function isTournamentWeekendDate(date: string): boolean {
  if (!isValidTournamentAvailabilityDate(date)) return false;
  const day = new Date(`${date}T12:00:00`).getDay();
  return day === 5 || day === 6 || day === 0;
}

/** Evening availability is not allowed on Saturday or Sunday while the clubs are closed. */
export function isTournamentAvailabilityPeriodAllowedOnDate(
  period: unknown, date: string,
): period is TournamentAvailabilityPeriodId {
  if (!isTournamentAvailabilityPeriod(period) || !isValidTournamentAvailabilityDate(date)) return false;
  const day = new Date(`${date}T12:00:00`).getDay();
  return period !== 'EVENING' || (day !== 6 && day !== 0);
}

export function getTournamentWeekends(now = new Date(), count = 12): TournamentWeekend[] {
  const firstFriday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  firstFriday.setDate(firstFriday.getDate() + ((5 - firstFriday.getDay() + 7) % 7));
  return Array.from({ length: count }, (_, index) => {
    const friday = new Date(firstFriday.getFullYear(), firstFriday.getMonth(), firstFriday.getDate() + index * 7);
    const date = (offset: number) => dateKey(new Date(friday.getFullYear(), friday.getMonth(), friday.getDate() + offset));
    return { friday: date(0), saturday: date(1), sunday: date(2) };
  });
}

export function formatTournamentAvailabilityDate(date: string, options: Intl.DateTimeFormatOptions = {
  weekday: 'long', day: 'numeric', month: 'long',
}): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('it-IT', options);
}

export function getTournamentPeriodAvailabilityId(
  scope: { eventId: string; tournamentId: string }, playerId: string,
  date: string, venueId: TournamentVenueId, period: TournamentAvailabilityPeriodId,
): string {
  return `${scope.eventId}_${scope.tournamentId}_${playerId}_${date}_${venueId}_${period}`;
}

export function isTournamentAvailabilityVenue(value: unknown): value is TournamentVenueId {
  return TOURNAMENT_VENUES.some(venue => venue.id === value);
}

export function isTournamentAvailabilityPeriod(value: unknown): value is TournamentAvailabilityPeriodId {
  return TOURNAMENT_AVAILABILITY_PERIODS.some(period => period.id === value);
}
