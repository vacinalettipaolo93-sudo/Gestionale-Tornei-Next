import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { type Event } from '../types';
import { firestoreData, mergeDocumentChanges } from '../utils/documentChanges';

export async function saveEventChanges(event: Event, patch: Partial<Omit<Event, 'id'>>): Promise<void> {
  const baseline = firestoreData(event);
  const next = firestoreData({ ...event, ...patch });
  await runTransaction(db, async transaction => {
    const ref = doc(db, 'events', event.id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Evento non trovato. Potrebbe essere stato eliminato.');
    const current = snapshot.data();
    const updates: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
      const value = mergeDocumentChanges(baseline[key], next[key], current[key]);
      if (value === undefined) throw new Error(`Valore mancante per ${key}.`);
      updates[key] = value;
    }
    transaction.update(ref, updates);
  });
}
