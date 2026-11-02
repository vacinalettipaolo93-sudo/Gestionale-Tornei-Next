import React, { useState } from 'react';
import { type Event } from '../types';
import { getEventBookings, type EventBooking } from '../utils/eventBookings';
import { getCompetitorName } from '../utils/padel';
import { formatTournamentSlotDate, formatTournamentSlotTime, TOURNAMENT_VENUES } from '../utils/tournamentVenues';
import { saveTournamentSlotAction } from '../services/tournamentBookingService';
import TournamentBookingModal from './TournamentBookingModal';

const BookedVenueSlots: React.FC<{ event: Event }> = ({ event }) => {
  const bookings = getEventBookings(event);
  const [editing, setEditing] = useState<{ tournamentId: string; matchId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const selectedBooking = bookings.find(booking => booking.tournament.id === editing?.tournamentId && booking.match.id === editing.matchId);
  const cancelBooking = async ({ tournament, match }: EventBooking) => {
    if (saving || !window.confirm(`Cancellare la prenotazione di ${getCompetitorName(event, tournament, match.player1Id)} vs ${getCompetitorName(event, tournament, match.player2Id)}? La partita resterà da giocare.`)) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await saveTournamentSlotAction(event.id, tournament.id, { type: 'cancel', matchId: match.id }, { isOrganizer: true });
      setSuccess('Prenotazione cancellata. La partita resta da giocare.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile cancellare la prenotazione.');
    } finally {
      setSaving(false);
    }
  };
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
      {match.status === 'scheduled' && !(match.score1 != null && match.score2 != null) && (
        <div className="flex flex-wrap gap-2">
          <button
            disabled={saving}
            onClick={() => { setError(null); setSuccess(null); setEditing({ tournamentId: tournament.id, matchId: match.id }); }}
            className="bg-accent text-white font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
          >
            Modifica prenotazione
          </button>
          <button
            disabled={saving}
            onClick={() => cancelBooking({ tournament, match, start, field, location })}
            className="bg-tertiary text-red-400 font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
          >
            Cancella prenotazione
          </button>
        </div>
      )}
    </li>
  );
  const otherBookings = bookings.filter(booking => !booking.venueId);

  return (
    <section className="bg-secondary rounded-xl p-4 sm:p-6 space-y-5" aria-label="Slot orari prenotati">
      <h2 className="text-xl font-bold text-accent">Slot orari prenotati</h2>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      {success && <p role="status" className="text-green-400">{success}</p>}
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
      {selectedBooking && (
        <TournamentBookingModal
          key={`${selectedBooking.tournament.id}:${selectedBooking.match.id}`}
          event={event}
          tournament={selectedBooking.tournament}
          match={selectedBooking.match}
          isOrganizer
          reschedule
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
};

export default BookedVenueSlots;
