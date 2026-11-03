import React from 'react';
import { type Event } from '../types';
import { TOURNAMENT_VENUES, type TournamentVenueId } from '../utils/tournamentVenues';

const TournamentVenueSlots: React.FC<{ event: Event; venueId: TournamentVenueId }> = ({ event, venueId }) => {
  const venue = TOURNAMENT_VENUES.find(item => item.id === venueId)!;
  return (
    <section className="bg-secondary rounded-xl p-4 sm:p-6 space-y-4" aria-label={`Prenotazione campi ${venue.name}`}>
      <h2 className="text-xl font-bold text-accent">Prenotazione campi — {venue.name}</h2>
      <p>Per {event.name} non occorre più inserire slot manualmente. Ogni giocatore prenota il campo in autonomia su {venue.bookingProvider}.</p>
      <a href={venue.bookingUrl} target="_blank" rel="noopener noreferrer"
        className="inline-block bg-highlight text-white font-bold px-4 py-3 rounded-lg">
        Apri {venue.bookingProvider} — {venue.name} (nuova scheda)
      </a>
      <p className="text-sm text-text-secondary">
        Dopo la conferma del circolo, torna nell’app, apri la partita e premi Prenota.
        Seleziona il centro e inserisci giorno e orario già prenotati. Le prenotazioni sono visibili in Prenotazioni partite.
        I dati e le prenotazioni precedenti restano conservati.
      </p>
      <p className="text-sm text-highlight">
        L’app registra solo la partita: non verifica la disponibilità e non prenota, modifica o annulla campi nei gestionali esterni.
      </p>
    </section>
  );
};

export default TournamentVenueSlots;
