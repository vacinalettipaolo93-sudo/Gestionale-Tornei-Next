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
          Scegli il circolo, poi decidi se chiamare, contattarlo su WhatsApp o prenotare online.
          Dopo aver ricevuto conferma del campo, registra qui lo stesso giorno e orario.
          Se hai già prenotato, puoi passare direttamente al punto 2.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {TOURNAMENT_VENUES.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => selectVenue(item.id)}
              disabled={saving}
              aria-pressed={venueId === item.id}
              className={`block text-left border-2 rounded-xl bg-primary hover:bg-tertiary p-5 space-y-2 focus:ring-2 focus:ring-accent ${venueId === item.id ? 'border-accent' : 'border-tertiary'} ${saving ? 'pointer-events-none opacity-50' : ''}`}
              aria-label={`Scegli ${item.name}`}
            >
              <span className="block text-xl font-bold text-accent">{item.name}</span>
              <span className="block text-sm">Scegli come prenotare il campo</span>
            </button>
          ))}
        </div>
        {venue && (
          <section aria-label={`Come prenotare presso ${venue.name}`} className="rounded-xl border border-tertiary p-4 space-y-3">
            <h5 className="font-bold">{venue.name} · {venue.phone}</h5>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { label: 'Chiama il circolo', href: `tel:${venue.phone}`, newTab: false },
                { label: 'Contatta su WhatsApp', href: `https://wa.me/${venue.phone.replace('+', '')}`, newTab: true },
                { label: `Prenota online · ${venue.bookingProvider}`, href: venue.bookingUrl, newTab: true },
              ].map(option => (
                <a key={option.label} href={option.href}
                  target={option.newTab ? '_blank' : undefined}
                  rel={option.newTab ? 'noopener noreferrer' : undefined}
                  onClick={e => { if (saving) e.preventDefault(); }}
                  aria-disabled={saving}
                  aria-label={`${option.label}${option.newTab ? ' (nuova scheda)' : ''}`}
                  className={`rounded-lg bg-primary border border-tertiary p-3 text-center font-semibold hover:bg-tertiary focus:ring-2 focus:ring-accent ${saving ? 'pointer-events-none opacity-50' : ''}`}>
                  {option.label}
                </a>
              ))}
            </div>
          </section>
        )}
        <p className="text-sm text-text-secondary">
          L’app non prenota né verifica il campo: una chiamata, un messaggio WhatsApp o l’apertura del sito
          non confermano una prenotazione. Modifiche e annullamenti del campo vanno concordati anche con il circolo.
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
