import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { type Event, type Match } from '../types';
import { applyTournamentResult, type ResultAction } from '../utils/tournamentResults';
import { type BookingActor } from '../utils/tournamentBooking';

export async function saveTournamentResult(
  eventId: string, tournamentId: string, match: Match, action: ResultAction, actor: BookingActor,
): Promise<void> {
  await runTransaction(db, async transaction => {
    const ref = doc(db, 'events', eventId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Evento non trovato.');
    const event = { ...snapshot.data(), id: snapshot.id } as Event;
    transaction.update(ref, { tournaments: applyTournamentResult(event, tournamentId, match, action, actor) });
  });
}
