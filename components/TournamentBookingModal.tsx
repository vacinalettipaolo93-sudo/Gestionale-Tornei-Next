import React, { useEffect, useRef, useState } from 'react';
import { type Event, type Match, type Tournament } from '../types';
import { saveTournamentSlotAction } from '../services/tournamentBookingService';
import { getAvailabilityDateKey, getTournamentAvailabilitySlots } from '../utils/tournamentAvailability';
import { getCompetitorName } from '../utils/padel';
import { formatTournamentSlotDate, formatTournamentSlotTime, getSlotVenueId, TOURNAMENT_VENUES, type TournamentVenueId } from '../utils/tournamentVenues';

const TournamentBookingModal: React.FC<{
  event: Event;
  tournament: Tournament;
  match: Match;
  isOrganizer: boolean;
  loggedInPlayerId?: string;
  reschedule?: boolean;
  onClose: () => void;
}> = ({ event, tournament, match, isOrganizer, loggedInPlayerId, reschedule = false, onClose }) => {
  const [venueId, setVenueId] = useState<TournamentVenueId | 'legacy' | null>(null);
  const [slotId, setSlotId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const slots = getTournamentAvailabilitySlots(event, tournament, Date.now(), reschedule ? match.id : undefined);
  const venueSlots = slots.filter(slot => venueId === 'legacy' ? !getSlotVenueId(slot) : getSlotVenueId(slot) === venueId);
  const dates = [...new Set(venueSlots.map(slot => getAvailabilityDateKey(slot.start)))];
  const selectedSlot = venueSlots.find(slot => slot.id === slotId);
  const venueName = TOURNAMENT_VENUES.find(venue => venue.id === venueId)?.name ?? 'Altri slot esistenti';

  useEffect(() => {
    const previousFocus = document.activeElement;
    return () => { if (previousFocus instanceof HTMLElement) previousFocus.focus(); };
  }, []);

  useEffect(() => {
    modalRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [venueId]);

  const submit = async () => {
    if (!selectedSlot || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveTournamentSlotAction(event.id, tournament.id, {
        type: reschedule ? 'reschedule' : 'book', matchId: match.id, slotId: selectedSlot.id,
      }, { isOrganizer, playerId: loggedInPlayerId });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Prenotazione non riuscita. Riprova.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-3 sm:p-6">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tournament-booking-title"
        onKeyDown={e => {
          if (e.key === 'Escape' && !saving) onClose();
          if (e.key !== 'Tab') return;
          const buttons = modalRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
          if (!buttons?.length) return;
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }}
        className="bg-secondary rounded-xl shadow-2xl p-4 sm:p-6 w-full max-w-3xl border border-tertiary max-h-[90vh] overflow-y-auto space-y-4"
      >
        <h3 id="tournament-booking-title" className="text-xl font-bold text-accent">{reschedule ? 'Modifica prenotazione' : 'Prenota partita'}</h3>
        <p className="text-sm text-text-secondary">
          {tournament.name}: {getCompetitorName(event, tournament, match.player1Id)} — {getCompetitorName(event, tournament, match.player2Id)}
        </p>
        {error && <p role="alert" className="text-red-400">{error}</p>}
        {!venueId ? (
          <>
            <h4 className="font-bold">1. Scegli dove giocare</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {TOURNAMENT_VENUES.map(venue => {
                const count = slots.filter(slot => getSlotVenueId(slot) === venue.id).length;
                return (
                  <button
                    key={venue.id}
                    onClick={() => { setVenueId(venue.id); setSlotId(''); setError(null); }}
                    className="text-left border-2 border-accent rounded-xl bg-primary hover:bg-tertiary p-6 space-y-2 focus:ring-2 focus:ring-accent"
                  >
                    <span className="block text-xl font-bold text-accent">{venue.name}</span>
                    <span className="block text-sm text-text-secondary">{count > 0 ? `${count} slot liberi in questo evento` : 'Nessuno slot libero in questo evento'}</span>
                  </button>
                );
              })}
            </div>
            {slots.some(slot => !getSlotVenueId(slot)) && (
              <button onClick={() => setVenueId('legacy')} className="text-sm text-accent underline">Altri slot esistenti dell’evento</button>
            )}
          </>
        ) : (
          <>
            <button onClick={() => { setVenueId(null); setSlotId(''); setError(null); }} disabled={saving} className="text-accent font-semibold hover:underline">Cambia centro</button>
            <h4 className="font-bold">2. Scegli giorno, orario e campo — {venueName}</h4>
            {venueSlots.length === 0 && <p className="text-text-secondary">Nessuno slot futuro libero per questo centro nell’evento. Scegli l’altro centro oppure attendi nuovi slot dall’amministratore.</p>}
            {dates.map(date => {
              const dateSlots = venueSlots.filter(slot => getAvailabilityDateKey(slot.start) === date);
              return (
                <fieldset key={date} className="border border-tertiary rounded-lg p-3">
                  <legend className="px-2 font-semibold">{formatTournamentSlotDate(dateSlots[0].start)}</legend>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {dateSlots.map(slot => (
                      <button
                        key={slot.id}
                        type="button"
                        disabled={saving}
                        aria-pressed={slot.id === selectedSlot?.id}
                        onClick={() => { setSlotId(slot.id); setError(null); }}
                        className={`text-left border rounded-lg p-3 ${slot.id === selectedSlot?.id ? 'border-accent bg-accent/20' : 'border-tertiary bg-primary hover:bg-tertiary'}`}
                      >
                        <span className="font-bold">{formatTournamentSlotTime(slot.start)} · {slot.field || 'Campo non specificato'}</span>
                        {venueId === 'legacy' && <span className="block text-sm">{slot.location}</span>}
                      </button>
                    ))}
                  </div>
                </fieldset>
              );
            })}
            {selectedSlot && (
              <p role="status" className="rounded-lg bg-primary p-3 text-sm">
                Prenotazione: <strong>{selectedSlot.location}</strong> · {formatTournamentSlotDate(selectedSlot.start)} · {formatTournamentSlotTime(selectedSlot.start)} · {selectedSlot.field}
              </p>
            )}
          </>
        )}
        <div className="flex flex-wrap justify-end gap-3 border-t border-tertiary pt-4">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg bg-tertiary">Annulla</button>
          {venueId && (
            <button onClick={submit} disabled={!selectedSlot || saving} className="px-4 py-2 rounded-lg bg-highlight text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Salvataggio…' : reschedule ? 'Conferma modifica' : 'Conferma prenotazione'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default TournamentBookingModal;
