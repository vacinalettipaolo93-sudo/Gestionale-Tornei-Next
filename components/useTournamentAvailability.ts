import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { type TournamentAvailability } from '../utils/matchFinder';

interface AvailabilityState extends TournamentAvailability {
  key: string;
  loading: boolean;
  error: string | null;
}

export function useTournamentAvailability(playerIds: string[]) {
  const key = JSON.stringify([...new Set(playerIds)].sort());
  const [state, setState] = useState<AvailabilityState>({
    key: '', slotPrefMap: {}, dateUnavailMap: {}, loading: true, error: null,
  });

  useEffect(() => {
    const ids: string[] = JSON.parse(key);
    const slotPrefMap: TournamentAvailability['slotPrefMap'] = {};
    const dateUnavailMap: TournamentAvailability['dateUnavailMap'] = {};
    const pending = new Set<string>();
    let active = true;
    let error: string | null = null;
    const subscriptions: Array<() => void> = [];
    for (let index = 0; index < ids.length; index += 10) {
      pending.add(`slot_preferences:${index}`);
      pending.add(`date_unavailabilities:${index}`);
    }
    const publish = () => {
      if (active) setState({
        key, slotPrefMap: { ...slotPrefMap }, dateUnavailMap: { ...dateUnavailMap },
        loading: pending.size > 0 && !error, error,
      });
    };
    publish();
    for (let index = 0; index < ids.length; index += 10) {
      const chunk = ids.slice(index, index + 10);
      for (const collectionName of ['slot_preferences', 'date_unavailabilities']) {
        const subscriptionKey = `${collectionName}:${index}`;
        subscriptions.push(onSnapshot(
          query(collection(db, collectionName), where('playerId', 'in', chunk)),
          snapshot => {
            const map = collectionName === 'slot_preferences' ? slotPrefMap : dateUnavailMap;
            chunk.forEach(id => { map[id] = new Set<string>(); });
            snapshot.docs.forEach(document => {
              const record = document.data();
              if (!chunk.includes(record.playerId)) return;
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
    slotPrefMap: {}, dateUnavailMap: {}, loading: true, error: null,
  };
}
