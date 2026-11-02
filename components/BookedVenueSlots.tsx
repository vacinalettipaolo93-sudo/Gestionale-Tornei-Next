import React from 'react';
import { type Event } from '../types';
import { getEventBookings, type EventBooking } from '../utils/eventBookings';
import { getCompetitorName } from '../utils/padel';
import { formatTournamentSlotDate, formatTournamentSlotTime, TOURNAMENT_VENUES } from '../utils/tournamentVenues';

const BookedVenueSlots: React.FC<{ event: Event }> = ({ event }) => {
  const bookings = getEventBookings(event);
  const renderBooking = ({ tournament, match, start, field, location }: EventBooking) => (
    <li key={`${tournament.id}:${match.id}`} className="bg-primary border border-tertiary rounded-lg p-4 space-y-2">
      <p className="font-bold text-accent">
        {getCompetitorName(event, tournament, match.player1Id)} vs {getCompetitorName(event, tournament, match.player2Id)}
      </p>
      <p className="text-sm text-text-secondary">Torneo: {tournament.name}</p>
      {start ? (
        <p><time dateTime={start}>{formatTournamentSlotDate(start)} · Ore {formatTournamentSlotTime(start)}</time></p>
      ) : <p className="text-highlight">Data e ora non disponibili: verificare la partita.</p>}
      <p>{location || 'Centro non specificato'} · {field || 'Campo non specificato'}</p>
      {(match.status === 'completed' || (match.score1 != null && match.score2 != null)) && (
        <p className="text-sm text-text-secondary">Partita completata</p>
      )}
    </li>
  );
  const otherBookings = bookings.filter(booking => !booking.venueId);

  return (
    <section className="bg-secondary rounded-xl p-4 sm:p-6 space-y-5" aria-label="Slot orari prenotati">
      <h2 className="text-xl font-bold text-accent">Slot orari prenotati</h2>
      <p className="text-sm text-text-secondary">
        Prenotazioni di tutti i tornei di {event.name}, ordinate per giorno e ora, da riportare nei gestionali dei centri.
        Giorno e ora indicano quando si gioca. Le prenotazioni annullate scompaiono e quelle spostate si aggiornano automaticamente.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {TOURNAMENT_VENUES.map(venue => {
          const venueBookings = bookings.filter(booking => booking.venueId === venue.id);
          return (
            <section key={venue.id} aria-label={`Prenotazioni ${venue.name}`} className="min-w-0 space-y-3">
              <h3 className="text-lg font-bold">{venue.name} ({venueBookings.length})</h3>
              {venueBookings.length > 0
                ? <ul className="space-y-3">{venueBookings.map(renderBooking)}</ul>
                : <p className="text-text-secondary">Nessuno slot prenotato per questo centro.</p>}
            </section>
          );
        })}
      </div>
      {otherBookings.length > 0 && (
        <section aria-label="Prenotazioni altri centri" className="space-y-3">
          <h3 className="text-lg font-bold">Altri centri o centro da verificare</h3>
          <ul className="space-y-3">{otherBookings.map(renderBooking)}</ul>
        </section>
      )}
    </section>
  );
};

export default BookedVenueSlots;
