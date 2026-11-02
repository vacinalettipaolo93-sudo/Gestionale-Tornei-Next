import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { type Event } from '../types';
import { applyTournamentSlotAction, type BookingActor, type TournamentSlotAction } from '../utils/tournamentBooking';

export async function saveTournamentSlotAction(
  eventId: string, tournamentId: string, action: TournamentSlotAction, actor: BookingActor,
): Promise<void> {
  await runTransaction(db, async transaction => {
    const ref = doc(db, 'events', eventId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Evento non trovato.');
    const event = { ...snapshot.data(), id: snapshot.id } as Event;
    const tournaments = applyTournamentSlotAction(event, tournamentId, action, actor);
    transaction.update(ref, { tournaments });
  });
}
