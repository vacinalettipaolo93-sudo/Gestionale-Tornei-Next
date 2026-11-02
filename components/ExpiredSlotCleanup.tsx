import React, { useEffect, useState } from 'react';
import { type Event } from '../types';
import { getExpiredFreeSlotIds } from '../utils/tournamentAvailability';
import { saveTournamentSlotAction } from '../services/tournamentBookingService';
import { useSlotClock } from './useSlotClock';

const ExpiredSlotCleanup: React.FC<{
  event: Event;
  isOrganizer: boolean;
  playerId?: string;
}> = ({ event, isOrganizer, playerId }) => {
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const now = useSlotClock(event);
  const expiredSlotsKey = [...getExpiredFreeSlotIds(event, now)].sort().join('|');

  useEffect(() => {
    let active = true;
    setError(null);
    if (expiredSlotsKey) {
      saveTournamentSlotAction(event.id, undefined, { type: 'purge-expired' }, { isOrganizer, playerId })
        .catch(cause => {
          if (active) setError(cause instanceof Error ? cause.message : 'Pulizia degli slot scaduti non riuscita.');
        });
    }
    return () => { active = false; };
  }, [event, isOrganizer, playerId, expiredSlotsKey, retry]);

  if (!error) return null;
  return (
    <div role="alert" className="bg-secondary rounded-lg p-4 mb-4 text-red-400">
      Pulizia degli slot scaduti di {event.name} da Firebase non riuscita: {error} Gli slot scaduti restano comunque non prenotabili.
      <button onClick={() => setRetry(value => value + 1)} className="ml-3 text-accent underline">Riprova pulizia</button>
    </div>
  );
};

export default ExpiredSlotCleanup;
