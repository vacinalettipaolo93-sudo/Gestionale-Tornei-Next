import { TOURNAMENT_VENUES, type TournamentVenueId } from './tournamentVenues';

export interface ExternalCourtBooking {
  venueId: TournamentVenueId;
  date: string;
  time: string;
  field: string;
  confirmed: boolean;
}

export function validateExternalCourtBooking(booking: ExternalCourtBooking, now = Date.now()) {
  const venue = TOURNAMENT_VENUES.find(item => item.id === booking.venueId);
  if (!venue) throw new Error('Scegli Canottieri Salò o Paitone Arena.');
  if (booking.confirmed !== true) throw new Error('Conferma di aver già prenotato il campo sul sito del circolo.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.date) || !/^\d{2}:\d{2}$/.test(booking.time)) {
    throw new Error('Inserisci il giorno e l’orario confermati dal circolo.');
  }
  const start = new Date(`${booking.date}T${booking.time}:00`);
  const [year, month, day] = booking.date.split('-').map(Number);
  const [hour, minute] = booking.time.split(':').map(Number);
  if (!Number.isFinite(start.getTime()) || start.getFullYear() !== year || start.getMonth() + 1 !== month
    || start.getDate() !== day || start.getHours() !== hour || start.getMinutes() !== minute
    || start.getTime() <= now) {
    throw new Error('Inserisci una data e un orario futuri validi.');
  }
  if (typeof booking.field !== 'string') throw new Error('Inserisci un campo valido oppure lascia il campo vuoto.');
  return { scheduledTime: start.toISOString(), location: venue.name, field: booking.field.trim() };
}
