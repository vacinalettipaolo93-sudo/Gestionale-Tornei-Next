import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { type TournamentAvailability } from '../utils/matchFinder';
import { type TournamentAvailabilityScope } from '../services/availabilityService';
import { TOURNAMENT_VENUES } from '../utils/tournamentVenues';

interface AvailabilityState extends TournamentAvailability {
  key: string;
  loading: boolean;
  error: string | null;
}

export function useTournamentAvailability(playerIds: string[], scope: TournamentAvailabilityScope) {
  const key = JSON.stringify({ ids: [...new Set(playerIds)].sort(), eventId: scope.eventId, tournamentId: scope.tournamentId });
  const [state, setState] = useState<AvailabilityState>({
    key: '', slotPrefMap: {}, dateUnavailMap: {}, venueMap: {}, loading: true, error: null,
  });

  useEffect(() => {
    const { ids, eventId, tournamentId }: { ids: string[] } & TournamentAvailabilityScope = JSON.parse(key);
    const slotPrefMap: TournamentAvailability['slotPrefMap'] = {};
    const dateUnavailMap: TournamentAvailability['dateUnavailMap'] = {};
    const venueMap: NonNullable<TournamentAvailability['venueMap']> = {};
    const pending = new Set<string>();
    let active = true;
    let error: string | null = null;
    const subscriptions: Array<() => void> = [];
    for (let index = 0; index < ids.length; index += 10) {
      pending.add(`slot_preferences:${index}`);
      pending.add(`date_unavailabilities:${index}`);
      pending.add(`availability_settings:${index}`);
    }
    const publish = () => {
      if (active) setState({
        key, slotPrefMap: { ...slotPrefMap }, dateUnavailMap: { ...dateUnavailMap }, venueMap: { ...venueMap },
        loading: pending.size > 0 && !error, error,
      });
    };
    publish();
    for (let index = 0; index < ids.length; index += 10) {
      const chunk = ids.slice(index, index + 10);
      for (const collectionName of ['slot_preferences', 'date_unavailabilities', 'availability_settings']) {
        const subscriptionKey = `${collectionName}:${index}`;
        subscriptions.push(onSnapshot(
          query(collection(db, collectionName), where('playerId', 'in', chunk)),
          snapshot => {
            if (collectionName === 'availability_settings') {
              chunk.forEach(id => { delete venueMap[id]; });
              snapshot.docs.forEach(document => {
                const record = document.data();
                if (!chunk.includes(record.playerId) || record.eventId !== eventId || record.tournamentId !== tournamentId) return;
                venueMap[record.playerId] = new Set(TOURNAMENT_VENUES
                  .filter(venue => Array.isArray(record.venueIds) && record.venueIds.includes(venue.id))
                  .map(venue => venue.id));
              });
              pending.delete(subscriptionKey);
              publish();
              return;
            }
            const map = collectionName === 'slot_preferences' ? slotPrefMap : dateUnavailMap;
            chunk.forEach(id => { map[id] = new Set<string>(); });
            snapshot.docs.forEach(document => {
              const record = document.data();
              if (!chunk.includes(record.playerId)) return;
              if (collectionName === 'date_unavailabilities'
                && (record.eventId !== eventId || record.tournamentId !== tournamentId)) return;
              const selected = collectionName === 'slot_preferences' ? record.isPreferred : record.unavailable;
              const value = collectionName === 'slot_preferences' ? record.slotId : record.date;
              if (selected === true && typeof value === 'string') map[record.playerId].add(value);
            });
            pending.delete(subscriptionKey);
            publish();
          },
          cause => {
            console.error('Errore lettura disponibilità torneo', cause);
            error = 'Impossibile caricare le disponibilità. Riapri la scheda per riprovare.';
            pending.delete(subscriptionKey);
            publish();
          },
        ));
      }
    }
    return () => {
      active = false;
      subscriptions.forEach(unsubscribe => unsubscribe());
    };
  }, [key]);

  return state.key === key ? state : {
    slotPrefMap: {}, dateUnavailMap: {}, venueMap: {}, loading: true, error: null,
  };
}
