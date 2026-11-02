import { collection, doc, getDocs, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { type Player, type User } from '../types';

export async function updatePlayerProfile(userId: string, name: string, phone: string): Promise<void> {
  const profile = { name: name.trim(), phone: phone.trim() };
  if (!profile.name) {
    throw new Error('Il nome del giocatore è obbligatorio.');
  }

  const events = await getDocs(collection(db, 'events'));

  await runTransaction(db, async transaction => {
    const userSnapshot = await transaction.get(doc(db, 'users', userId));
    const user = userSnapshot.data() as User | undefined;
    if (!user?.playerId) {
      throw new Error('Nessun giocatore collegato a questo utente.');
    }

    const playerRef = doc(db, 'players', user.playerId);
    const playerSnapshot = await transaction.get(playerRef);
    if (!playerSnapshot.exists()) {
      throw new Error("Il giocatore collegato non esiste nell'archivio globale.");
    }

    // Read fresh event data on every retry to preserve concurrent roster changes.
    const eventSnapshots = await Promise.all(events.docs.map(event => transaction.get(event.ref)));
    transaction.update(playerRef, profile);
    for (const event of eventSnapshots) {
      if (!event.exists()) continue;
      const players = event.data().players as Player[] | undefined;
      if (!Array.isArray(players) || !players.some(player => player.id === user.playerId)) continue;

      transaction.update(event.ref, {
        players: players.map(player => player.id === user.playerId ? { ...player, ...profile } : player),
      });
    }
  });
}
