import { type Event, type Match, type Tournament } from '../types';
import { getEventSlots, getTournamentMatches, normalizeTournamentSlot } from './tournamentAvailability';
import { getSlotVenueId, type TournamentVenueId } from './tournamentVenues';

export interface EventBooking {
  tournament: Tournament;
  match: Match;
  start?: string;
  field: string;
  location: string;
  venueId?: TournamentVenueId;
}

export function getEventBookings(event: Event): EventBooking[] {
  const slots = new Map(getEventSlots(event).map(slot => [slot.id, slot]));
  return event.tournaments.flatMap(tournament => getTournamentMatches(tournament)
    .filter(match => match.slotId || match.scheduledTime || match.status === 'scheduled')
    .map(match => {
      const slot = match.slotId ? slots.get(match.slotId) : undefined;
      const start = normalizeTournamentSlot({ start: match.scheduledTime })?.start ?? slot?.start;
      const location = match.location || slot?.location || '';
      return {
        tournament, match, start, location,
        field: match.field || slot?.field || '',
        venueId: getSlotVenueId({ location, venueId: match.location ? undefined : slot?.venueId }),
      };
    }))
    .sort((left, right) =>
      (left.start ? Date.parse(left.start) : Infinity) - (right.start ? Date.parse(right.start) : Infinity)
      || left.tournament.name.localeCompare(right.tournament.name, 'it')
      || left.field.localeCompare(right.field, 'it', { numeric: true })
    );
}
