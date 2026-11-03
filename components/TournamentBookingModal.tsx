import React, { useState } from 'react';
import CenteredDialog from './CenteredDialog';
import { type Event, type Match, type Tournament } from '../types';
import { saveTournamentSlotAction } from '../services/tournamentBookingService';
import { getAvailabilityDateKey } from '../utils/tournamentAvailability';
import { validateExternalCourtBooking } from '../utils/externalCourtBooking';
import { getCompetitorName } from '../utils/padel';
import { formatTournamentSlotTime, getSlotVenueId, TOURNAMENT_VENUES, type TournamentVenueId } from '../utils/tournamentVenues';

const TournamentBookingModal: React.FC<{
  event: Event;
  tournament: Tournament;
  match: Match;
  isOrganizer: boolean;
  loggedInPlayerId?: string;
  reschedule?: boolean;
  onClose: () => void;
}> = ({ event, tournament, match, isOrganizer, loggedInPlayerId, reschedule = false, onClose }) => {
  const existingStart = reschedule && match.scheduledTime && Number.isFinite(Date.parse(match.scheduledTime))
    ? match.scheduledTime : undefined;
  const [venueId, setVenueId] = useState<TournamentVenueId | null>(
    reschedule ? getSlotVenueId({ location: match.location ?? '' }) ?? null : null,
  );
  const [date, setDate] = useState(existingStart ? getAvailabilityDateKey(existingStart) : '');
  const [time, setTime] = useState(existingStart ? formatTournamentSlotTime(existingStart) : '');
  const [field, setField] = useState(reschedule ? match.field ?? '' : '');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const venue = TOURNAMENT_VENUES.find(item => item.id === venueId);

  const selectVenue = (id: TournamentVenueId) => {
    if (id !== venueId) {
      setDate('');
      setTime('');
      setField('');
      setConfirmed(false);
    }
    setVenueId(id);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!venueId) {
      setError('Scegli il centro in cui hai prenotato il campo.');
      return;
    }
    const booking = { venueId, date, time, field, confirmed };
    setError(null);
    try {
      validateExternalCourtBooking(booking);
      setSaving(true);
      await saveTournamentSlotAction(event.id, tournament.id, {
        type: reschedule ? 'reschedule-external' : 'book-external', matchId: match.id, booking,
      }, { isOrganizer, playerId: loggedInPlayerId });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Registrazione non riuscita. Riprova senza prenotare nuovamente il campo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <CenteredDialog title={reschedule ? 'Modifica prenotazione' : 'Prenota partita'} wide busy={saving} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-text-secondary">
          {tournament.name}: {getCompetitorName(event, tournament, match.player1Id)} — {getCompetitorName(event, tournament, match.player2Id)}
        </p>
        <h4 className="font-bold">1. Scegli il centro e prenota il campo</h4>
        <p className="text-sm text-text-secondary">
          Si apre il sito del circolo in una nuova scheda. Completa lì la prenotazione, poi torna in questa finestra
          e registra lo stesso giorno e orario. Se hai già prenotato, puoi passare direttamente al punto 2.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {TOURNAMENT_VENUES.map(item => (
            <a
              key={item.id}
              href={item.bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => { if (saving) e.preventDefault(); else selectVenue(item.id); }}
              aria-disabled={saving}
              className={`block text-left border-2 rounded-xl bg-primary hover:bg-tertiary p-5 space-y-2 focus:ring-2 focus:ring-accent ${venueId === item.id ? 'border-accent' : 'border-tertiary'} ${saving ? 'pointer-events-none opacity-50' : ''}`}
              aria-label={`Prenota a ${item.name} su ${item.bookingProvider} (nuova scheda)`}
            >
              <span className="block text-xl font-bold text-accent">{item.name}</span>
              <span className="block text-sm">Apri {item.bookingProvider} e prenota il campo</span>
            </a>
          ))}
        </div>
        <p className="text-sm text-text-secondary">
          L’app non prenota né verifica il campo su Playtomic o Wansport. Modifiche e annullamenti del campo
          vanno effettuati anche sul sito del circolo.
        </p>
        <h4 className="font-bold">2. Torna qui e registra la partita</h4>
        {error && <p role="alert" className="text-red-400">{error}</p>}
        <fieldset disabled={saving} className="space-y-4">
          <div>
            <label htmlFor="booking-venue" className="block mb-1">Centro prenotato</label>
            <select id="booking-venue" required value={venueId ?? ''} onChange={e => {
              const selected = TOURNAMENT_VENUES.find(item => item.id === e.target.value);
              if (selected) selectVenue(selected.id);
            }} className="w-full bg-primary border border-tertiary rounded-lg p-2">
              <option value="" disabled>Seleziona il centro</option>
              {TOURNAMENT_VENUES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="booking-date" className="block mb-1">Giorno prenotato</label>
              <input id="booking-date" type="date" required min={getAvailabilityDateKey(new Date().toISOString())}
                value={date} onChange={e => { setDate(e.target.value); setConfirmed(false); }}
                className="w-full min-w-0 bg-primary border border-tertiary rounded-lg p-2" />
            </div>
            <div>
              <label htmlFor="booking-time" className="block mb-1">Orario prenotato</label>
              <input id="booking-time" type="time" required value={time}
                onChange={e => { setTime(e.target.value); setConfirmed(false); }}
                className="w-full min-w-0 bg-primary border border-tertiary rounded-lg p-2" />
            </div>
          </div>
          <div>
            <label htmlFor="booking-field" className="block mb-1">Campo (facoltativo)</label>
            <input id="booking-field" type="text" value={field}
              onChange={e => { setField(e.target.value); setConfirmed(false); }}
              placeholder="Come indicato nella prenotazione del circolo"
              className="w-full bg-primary border border-tertiary rounded-lg p-2" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} required onChange={e => setConfirmed(e.target.checked)} className="mt-1" />
            Ho già prenotato il campo{venue ? ` presso ${venue.name}` : ''} e confermo che giorno e orario corrispondono alla prenotazione del circolo.
          </label>
        </fieldset>
        {reschedule && (
          <p className="text-sm text-highlight">Questa modifica aggiorna solo la partita nell’app, non sposta o annulla il campo nel gestionale del circolo.</p>
        )}
        <div className="flex flex-wrap justify-end gap-3 border-t border-tertiary pt-4">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg bg-tertiary">Chiudi senza salvare</button>
          <button type="submit" disabled={!venueId || !date || !time || !confirmed || saving}
            className="px-4 py-2 rounded-lg bg-highlight text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? 'Salvataggio…' : reschedule ? 'Conferma modifica nell’app' : 'Registra partita nell’app'}
          </button>
        </div>
      </form>
    </CenteredDialog>
  );
};

export default TournamentBookingModal;
