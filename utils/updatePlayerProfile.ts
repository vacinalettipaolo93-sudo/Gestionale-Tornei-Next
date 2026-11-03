import { collection, doc, getDocs, runTransaction, type Transaction } from 'firebase/firestore';
import { db } from '../firebase';
import { type Player, type User } from '../types';

export async function updatePlayerProfile(userId: string, name: string, phone: string): Promise<void> {
  const profile = { name: name.trim(), phone: phone.trim() };
  if (!profile.name) {
    throw new Error('Il nome del giocatore è obbligatorio.');
  }

  await updateProfile(async transaction => {
    const userSnapshot = await transaction.get(doc(db, 'users', userId));
    const user = userSnapshot.data() as User | undefined;
    if (!user?.playerId) {
      throw new Error('Nessun giocatore collegato a questo utente.');
    }

    return user.playerId;
  }, profile);
}

type PlayerChanges = Partial<Pick<Player, 'name' | 'phone' | 'avatar' | 'summerRankingStartPoints' | 'summerRankingJoinedAt'>>;

export async function updatePlayerEverywhere(playerId: string, changes: PlayerChanges): Promise<void> {
  if (changes.name !== undefined && !changes.name.trim()) throw new Error('Il nome del giocatore è obbligatorio.');
  if (changes.summerRankingStartPoints !== undefined
    && (!Number.isFinite(changes.summerRankingStartPoints) || changes.summerRankingStartPoints < 0)) {
    throw new Error('Inserisci punti validi maggiori o uguali a zero.');
  }
  await updateProfile(async () => playerId, changes);
}

async function updateProfile(resolvePlayerId: (transaction: Transaction) => Promise<string>, profile: PlayerChanges): Promise<void> {
  const events = await getDocs(collection(db, 'events'));
  await runTransaction(db, async transaction => {
    const playerId = await resolvePlayerId(transaction);
    const playerRef = doc(db, 'players', playerId);
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
      if (!Array.isArray(players) || !players.some(player => player.id === playerId)) continue;

      transaction.update(event.ref, {
        players: players.map(player => player.id === playerId ? { ...player, ...profile } : player),
      });
    }
  });
}
