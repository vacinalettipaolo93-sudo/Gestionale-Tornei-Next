import React, { useEffect, useState } from 'react';
import { type Event } from '../types';
import { saveTournamentSlotAction } from '../services/tournamentBookingService';
import { getEventSlots, isEventSlotBooked } from '../utils/tournamentAvailability';
import { formatTournamentSlotDate, formatTournamentSlotTime, getSlotVenueId, TOURNAMENT_VENUES, type TournamentVenueId } from '../utils/tournamentVenues';

const TournamentVenueSlots: React.FC<{ event: Event; venueId: TournamentVenueId }> = ({ event, venueId }) => {
  const [start, setStart] = useState('');
  const [field, setField] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const venue = TOURNAMENT_VENUES.find(item => item.id === venueId)!;
  const slots = getEventSlots(event).filter(slot => getSlotVenueId(slot) === venueId);

  useEffect(() => {
    setError(null);
    setSuccess(null);
  }, [event.id, venueId]);

  const addSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await saveTournamentSlotAction(event.id, undefined, {
        type: 'add',
        slot: { id: `slot_${crypto.randomUUID()}`, start, field, location: venue.name, venueId },
      }, { isOrganizer: true });
      setSuccess(`Slot aggiunto a ${event.name} — ${venue.name}, disponibile in tutti i tornei dell’evento.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile salvare lo slot.');
    } finally {
      setSaving(false);
    }
  };

  const deleteSlot = async (slotId: string) => {
    if (saving || !window.confirm('Eliminare questo slot libero da tutti i tornei dell’evento?')) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await saveTournamentSlotAction(event.id, undefined, { type: 'delete', slotId }, { isOrganizer: true });
      setSuccess('Slot eliminato.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile eliminare lo slot.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-secondary rounded-xl p-4 sm:p-6 space-y-5" aria-label={`Slot orari ${venue.name}`}>
      <h2 className="text-xl font-bold text-accent">Slot orari {venue.name}</h2>
      <p className="text-sm text-text-secondary">
        Inserisci un giorno, un orario e un campo per ogni slot libero di {event.name}.
        Gli slot sono condivisi da tutti i tornei di questo evento: una prenotazione li occupa per tutti.
        Gli altri eventi restano indipendenti.
      </p>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      {success && <p role="status" className="text-green-400">{success}</p>}
      <form onSubmit={addSlot} className="bg-primary p-4 rounded-lg space-y-4">
        <h3 className="font-bold">Aggiungi slot libero — {event.name}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="venue-slot-start" className="block text-sm font-semibold mb-1">Giorno e ora</label>
            <input id="venue-slot-start" type="datetime-local" value={start} onChange={e => setStart(e.target.value)} required disabled={saving} className="w-full bg-secondary border border-tertiary p-3 rounded-lg text-text-primary" />
          </div>
          <div>
            <label htmlFor="venue-slot-field" className="block text-sm font-semibold mb-1">Campo</label>
            <input id="venue-slot-field" value={field} onChange={e => setField(e.target.value)} placeholder="Es. Campo 1" required disabled={saving} className="w-full bg-secondary border border-tertiary p-3 rounded-lg text-text-primary" />
          </div>
        </div>
        <button type="submit" disabled={saving} className="bg-accent text-white font-bold rounded-lg px-4 py-2 disabled:opacity-50">
          {saving ? 'Salvataggio…' : 'Aggiungi slot'}
        </button>
      </form>
      <div className="space-y-3">
        <h3 className="font-bold">Slot di {event.name} — {venue.name}</h3>
        {slots.length === 0 && <p className="text-text-secondary">Nessuno slot inserito per questo centro nell’evento.</p>}
        {slots.map(slot => {
          const booked = isEventSlotBooked(event, slot);
          const past = Date.parse(slot.start) <= Date.now();
          return (
            <div key={slot.id} className="bg-primary border border-tertiary rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{formatTournamentSlotDate(slot.start)}</p>
                <p>{formatTournamentSlotTime(slot.start)} · {slot.field || 'Campo non specificato'}</p>
                <p className={`text-sm ${booked ? 'text-highlight' : 'text-text-secondary'}`}>{booked ? 'Prenotato' : past ? 'Trascorso' : 'Libero'}</p>
              </div>
              <button
                onClick={() => deleteSlot(slot.id)}
                disabled={saving || booked}
                title={booked ? 'Annulla prima la prenotazione dalla partita' : undefined}
                className="bg-tertiary text-red-400 px-3 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Elimina slot
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default TournamentVenueSlots;
