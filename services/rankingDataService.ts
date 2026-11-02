import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { type Event, type SummerRankingData } from '../types';
import { createEmptyRankingData } from '../utils/rankingEvent';
import { mergeRankingChanges } from '../utils/rankingChanges';
import { type BookingActor } from '../utils/tournamentBooking';

export async function saveRankingChanges(
  eventId: string, eventType: Event['eventType'], baseline: SummerRankingData, next: SummerRankingData, actor: BookingActor,
): Promise<void> {
  await runTransaction(db, async transaction => {
    const ref = doc(db, 'events', eventId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Evento non trovato.');
    const current = snapshot.data() as Event;
    const rankingData = mergeRankingChanges(baseline, next, current.rankingData ?? createEmptyRankingData(eventType), eventType, actor);
    transaction.update(ref, { eventType, rankingData });
  });
}
