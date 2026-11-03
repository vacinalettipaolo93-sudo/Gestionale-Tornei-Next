import { type Event, type Match, type TimeSlot, type Tournament } from '../types';
import { getTeamForPlayer, getTournamentPadelTeams, isPadelEvent } from './padel';
import { getEventSlots, getTournamentMatches, isSameCourtTime, isEventSlotBooked, isSlotExpired, normalizeTournamentSlot, pruneExpiredFreeSlots } from './tournamentAvailability';
import { TOURNAMENT_VENUES } from './tournamentVenues';
import { validateExternalCourtBooking, type ExternalCourtBooking } from './externalCourtBooking';

export type TournamentSlotAction =
  | { type: 'add'; slot: TimeSlot }
  | { type: 'delete'; slotId: string }
  | { type: 'purge-expired' }
  | { type: 'book' | 'reschedule'; matchId: string; slotId: string }
  | { type: 'book-external' | 'reschedule-external'; matchId: string; booking: ExternalCourtBooking }
  | { type: 'cancel'; matchId: string };

export interface BookingActor {
  isOrganizer: boolean;
  playerId?: string;
}

const isCompleted = (match: Match) => match.status === 'completed' || (match.score1 != null && match.score2 != null);

export function applyTournamentSlotAction(
  event: Event, tournamentId: string | undefined, action: TournamentSlotAction, actor: BookingActor, now = Date.now(),
): Pick<Event, 'tournaments' | 'globalTimeSlots'> {
  const cleanedEvent = { ...event, ...pruneExpiredFreeSlots(event, now) };
  if (action.type === 'purge-expired') {
    if (!actor.isOrganizer && (!actor.playerId || !event.players.some(player => player.id === actor.playerId))) {
      throw new Error('Solo l’amministratore o un giocatore dell’evento può eliminare gli slot scaduti.');
    }
    return pruneExpiredFreeSlots(event, now);
  }
  const update = applyAction(cleanedEvent, tournamentId, action, actor, now);
  return pruneExpiredFreeSlots({ ...cleanedEvent, ...update }, now);
}

function applyAction(
  event: Event, tournamentId: string | undefined, action: Exclude<TournamentSlotAction, { type: 'purge-expired' }>, actor: BookingActor, now: number,
): Pick<Event, 'tournaments' | 'globalTimeSlots'> {
  const tournament = event.tournaments.find(item => item.id === tournamentId);
  let updated: Tournament;
  if (action.type === 'add' || action.type === 'delete') {
    if (!actor.isOrganizer) throw new Error('Solo l’amministratore può gestire gli slot.');
    if (action.type === 'add') {
      const slot = normalizeTournamentSlot(action.slot);
      const venue = TOURNAMENT_VENUES.find(item => item.id === slot?.venueId);
      if (!slot || !slot.id.trim() || !venue || !slot.field.trim() || Date.parse(slot.start) <= now) {
        throw new Error('Inserisci una data futura, un orario, un centro e un campo validi.');
      }
      if (slot.expiresAt !== undefined) {
        if (isSlotExpired(slot, now)) throw new Error('Inserisci una scadenza futura valida per gli slot.');
        slot.expiresAt = new Date(slot.expiresAt).toISOString();
      }
      if (getEventSlots(event).some(item => item.id === slot.id || isSameCourtTime(item, slot))) {
        throw new Error('Questo campo è già presente alla stessa data e ora in questo evento.');
      }
      return {
        tournaments: event.tournaments,
        globalTimeSlots: [...(event.globalTimeSlots ?? []), { ...slot, location: venue.name, field: slot.field.trim() }],
      };
    } else {
      const slot = getEventSlots(event).find(item => item.id === action.slotId);
      if (!slot) throw new Error('Slot non trovato.');
      if (isEventSlotBooked(event, slot)) throw new Error('Non puoi eliminare uno slot prenotato. Annulla prima la prenotazione della partita.');
      const keep = (item: TimeSlot) => normalizeTournamentSlot(item)?.id !== action.slotId;
      return {
        globalTimeSlots: (event.globalTimeSlots ?? []).filter(keep),
        tournaments: event.tournaments.map(item => ({ ...item, timeSlots: (item.timeSlots ?? []).filter(keep) })),
      };
    }
  } else {
    if (!tournament) throw new Error('Torneo non trovato. Riapri la pagina.');
    const match = getTournamentMatches(tournament).find(item => item.id === action.matchId);
    if (!match) throw new Error('Partita non trovata.');
    const competitorId = isPadelEvent(event)
      ? getTeamForPlayer(getTournamentPadelTeams(tournament), actor.playerId)?.id
      : actor.playerId;
    if (!actor.isOrganizer && (!competitorId || ![match.player1Id, match.player2Id].includes(competitorId))) {
      throw new Error('Puoi prenotare solo le partite in cui sei presente.');
    }
    if (!match.player1Id || !match.player2Id || isCompleted(match)) {
      throw new Error('La partita non è prenotabile.');
    }
    const isNewBooking = action.type === 'book' || action.type === 'book-external';
    if (isNewBooking && match.status !== 'pending') {
      throw new Error('La partita è già prenotata. Riapri la scheda per vedere la prenotazione.');
    }
    if (!isNewBooking && match.status !== 'scheduled') {
      throw new Error('La prenotazione è stata modificata. Riapri la scheda.');
    }
    let updatedMatch: Match;
    if (action.type === 'cancel') {
      const { slotId, scheduledTime, location, field, ...rest } = match;
      updatedMatch = { ...rest, status: 'pending' };
    } else if ('booking' in action) {
      const booking = validateExternalCourtBooking(action.booking, now);
      if (booking.field && isEventSlotBooked(event, {
        id: '', start: booking.scheduledTime, location: booking.location, field: booking.field,
      }, { tournamentId: tournament.id, matchId: match.id })) {
        throw new Error('Questo campo è già registrato per un’altra partita dell’evento alla stessa data e ora. Verifica la prenotazione con il circolo.');
      }
      const { slotId, ...rest } = match;
      updatedMatch = { ...rest, ...booking, status: 'scheduled' };
    } else {
      const slot = getEventSlots(event).find(item => item.id === action.slotId);
      if (!slot || Date.parse(slot.start) <= now || (isSlotExpired(slot, now) && !(action.type === 'reschedule' && match.slotId === slot.id))) {
        throw new Error('Lo slot non è più disponibile in questo evento.');
      }
      if (isEventSlotBooked(event, slot, { tournamentId: tournament.id, matchId: match.id })) {
        throw new Error('Slot appena prenotato da un’altra partita. Seleziona un altro orario o campo.');
      }
      updatedMatch = {
        ...match, status: 'scheduled', slotId: slot.id, scheduledTime: slot.start,
        location: slot.location, field: slot.field,
      };
    }
    const replace = (matches: Match[]) => matches.map(item => item.id === match.id ? updatedMatch : item);
    updated = {
      ...tournament,
      groups: (tournament.groups ?? []).map(group => ({ ...group, matches: replace(group.matches ?? []) })),
      ...(tournament.playoffMatches ? { playoffMatches: replace(tournament.playoffMatches) } : {}),
      ...(tournament.consolationMatches ? { consolationMatches: replace(tournament.consolationMatches) } : {}),
    };
  }
  return {
    tournaments: event.tournaments.map(item => item.id === tournamentId ? updated : item),
    globalTimeSlots: event.globalTimeSlots ?? [],
  };
}
