import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../firebase';
import { type Event, type Player } from '../types';
import { createInitialsAvatar } from '../utils/avatar';
import { isRankingEventType, normalizeRankingData, sanitizeRankingDataForFirestore, matchIncludesPlayer } from '../utils/rankingEvent';
import { removePlayerFromSummerRankingMaster } from '../utils/summerRanking';
import { removePlayerFromPadelIndividualMaster } from '../utils/padelIndividualRanking';
import { removePlayerFromRankingEvent } from '../utils/eventPlayers.js';

function association(event: Event, player: Player, points?: number): Partial<Event> {
  const existing = event.players?.find(item => item.id === player.id);
  const profile: Player = {
    ...player, status: 'confirmed',
    ...(points !== undefined ? { summerRankingStartPoints: points } : {}),
  };
  const players = existing
    ? event.players.map(item => item.id === player.id ? { ...item, ...profile } : item)
    : [...(event.players ?? []), profile];
  if (!isRankingEventType(event.eventType)) return { players };
  const rankingData = normalizeRankingData(event.rankingData, event.eventType);
  return {
    players,
    rankingData: sanitizeRankingDataForFirestore({
      ...rankingData, participantIds: [...new Set([...(rankingData.participantIds ?? []), player.id])],
    }, event.eventType),
  };
}

export async function associatePlayerWithEvent(eventId: string, playerId: string, points?: number): Promise<void> {
  if (points !== undefined && (!Number.isFinite(points) || points < 0)) throw new Error('Inserisci punti iniziali validi.');
  const events = await getDocs(collection(db, 'events'));
  await runTransaction(db, async transaction => {
    const eventRef = doc(db, 'events', eventId);
    const playerRef = doc(db, 'players', playerId);
    const [eventSnapshot, playerSnapshot, ...eventSnapshots] = await Promise.all([
      transaction.get(eventRef), transaction.get(playerRef), ...events.docs.filter(item => item.id !== eventId).map(item => transaction.get(item.ref)),
    ]);
    if (!eventSnapshot.exists() || !playerSnapshot.exists()) throw new Error('Evento o giocatore non trovato.');
    const player = { ...playerSnapshot.data(), id: playerId } as Player;
    const changes = points === undefined ? {} : {
      summerRankingStartPoints: points, summerRankingJoinedAt: player.summerRankingJoinedAt ?? new Date().toISOString(),
    };
    transaction.update(eventRef, association(eventSnapshot.data() as Event, { ...player, ...changes }, points));
    if (points !== undefined) {
      transaction.update(playerRef, changes);
      eventSnapshots.forEach(snapshot => {
        if (!snapshot.exists()) return;
        const players = snapshot.data().players as Player[] | undefined;
        if (players?.some(item => item.id === playerId)) transaction.update(snapshot.ref, {
          players: players.map(item => item.id === playerId ? { ...item, ...changes } : item),
        });
      });
    }
  });
}

export async function createPlayerWithAccount(
  name: string, phone: string, startPoints: number, eventIds: string[] = [],
): Promise<Player> {
  name = name.trim();
  phone = phone.trim();
  if (!name || !Number.isFinite(startPoints) || startPoints < 0) throw new Error('Inserisci un nome e punti iniziali validi.');
  const [matchingPlayers, matchingUsers, allEvents] = await Promise.all([
    getDocs(query(collection(db, 'players'), where('name', '==', name), where('phone', '==', phone))),
    getDocs(query(collection(db, 'users'), where('username', '==', name))),
    getDocs(collection(db, 'events')),
  ]);
  const playerRef = matchingPlayers.docs[0]?.ref ?? doc(collection(db, 'players'));
  const linkedUsers = await getDocs(query(collection(db, 'users'), where('playerId', '==', playerRef.id)));
  const userRef = linkedUsers.docs[0]?.ref ?? matchingUsers.docs[0]?.ref ?? doc(collection(db, 'users'));
  const events = [...new Map([
    ...allEvents.docs.map(item => [item.id, item.ref] as const),
    ...eventIds.filter(Boolean).map(id => [id, doc(db, 'events', id)] as const),
  ]).values()];
  return runTransaction(db, async transaction => {
    const [playerSnapshot, userSnapshot, ...eventSnapshots] = await Promise.all([
      transaction.get(playerRef), transaction.get(userRef), ...events.map(ref => transaction.get(ref)),
    ]);
    if (userSnapshot.exists() && userSnapshot.data().playerId !== playerRef.id) {
      throw new Error('Esiste già un account con questo nome collegato a un altro giocatore.');
    }
    if (eventSnapshots.some((snapshot, index) => eventIds.includes(events[index].id) && !snapshot.exists())) {
      throw new Error('Un evento selezionato non esiste più.');
    }
    const original: Player = playerSnapshot.exists()
      ? { ...playerSnapshot.data(), id: playerRef.id } as Player
      : {
        id: playerRef.id, name, phone, avatar: createInitialsAvatar(name), status: 'confirmed',
        summerRankingStartPoints: startPoints, summerRankingJoinedAt: new Date().toISOString(),
      };
    const player = { ...original, summerRankingStartPoints: startPoints,
      summerRankingJoinedAt: original.summerRankingJoinedAt ?? new Date().toISOString() };
    transaction.set(playerRef, player);
    if (!userSnapshot.exists()) transaction.set(userRef, {
      username: name, password: '1234', role: 'participant', playerId: playerRef.id,
    });
    eventSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists()) return;
      if (eventIds.includes(events[index].id)) {
        transaction.update(events[index], association(snapshot.data() as Event, player, startPoints));
      } else {
        const players = snapshot.data().players as Player[] | undefined;
        if (players?.some(item => item.id === player.id)) transaction.update(events[index], {
          players: players.map(item => item.id === player.id ? { ...item,
            summerRankingStartPoints: startPoints, summerRankingJoinedAt: player.summerRankingJoinedAt,
          } : item),
        });
      }
    });
    return player;
  });
}

export async function removePlayerFromRanking(eventId: string, playerId: string): Promise<void> {
  await runTransaction(db, async transaction => {
    const ref = doc(db, 'events', eventId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Evento non trovato.');
    const event = snapshot.data() as Event;
    const result = removePlayerFromRankingEvent(event, playerId);
    if (result.status === 'blocked') throw new Error('Il giocatore ha partite o gironi collegati. Rimuovi prima questi collegamenti.');
    if (result.status === 'not-associated') return;
    const rankingData = result.rankingData ? sanitizeRankingDataForFirestore({
      ...result.rankingData,
      master: removePlayerFromSummerRankingMaster(result.rankingData.master, playerId),
      padelIndividualMaster: removePlayerFromPadelIndividualMaster(result.rankingData.padelIndividualMaster, playerId),
    }, event.eventType) : undefined;
    transaction.update(ref, { players: result.players, ...(rankingData ? { rankingData } : {}) });
  });
}

export async function deletePlayerEverywhere(playerId: string): Promise<void> {
  const [events, users, ...preferences] = await Promise.all([
    getDocs(collection(db, 'events')),
    getDocs(query(collection(db, 'users'), where('playerId', '==', playerId))),
    ...['availabilities', 'availability_settings', 'slot_preferences', 'date_unavailabilities'].map(name =>
      getDocs(query(collection(db, name), where('playerId', '==', playerId)))),
  ]);
  await runTransaction(db, async transaction => {
    const relatedDocuments = [...users.docs, ...preferences.flatMap(snapshot => snapshot.docs)];
    const [snapshots, relatedSnapshots] = await Promise.all([
      Promise.all(events.docs.map(event => transaction.get(event.ref))),
      Promise.all(relatedDocuments.map(document => transaction.get(document.ref))),
    ]);
    const updates = snapshots.flatMap(snapshot => {
      if (!snapshot.exists()) return [];
      const event = snapshot.data() as Event;
      const assigned = (event.tournaments ?? []).some(tournament => {
        const competitorIds = new Set([playerId, ...(tournament.padelTeams ?? [])
          .filter(team => team.player1Id === playerId || team.player2Id === playerId).map(team => team.id)]);
        return tournament.groups.some(group => group.playerIds.some(id => competitorIds.has(id))
          || group.matches.some(match => competitorIds.has(match.player1Id) || competitorIds.has(match.player2Id)))
          || [...(tournament.playoffMatches ?? []), ...(tournament.consolationMatches ?? [])].some(match =>
            competitorIds.has(match.player1Id) || competitorIds.has(match.player2Id))
          || [tournament.playoffs, tournament.consolationBracket].some(bracket => bracket?.matches.some(match =>
            competitorIds.has(match.player1Id) || competitorIds.has(match.player2Id)));
      });
      if (assigned) throw new Error('Il giocatore è collegato a squadre, gironi o partite di un torneo. Rimuovi prima questi collegamenti per non lasciare dati incompleti.');
      const players = (event.players ?? []).filter(player => player.id !== playerId);
      const tournaments = (event.tournaments ?? []).map(tournament => !tournament.padelTeams ? tournament : {
        ...tournament, padelTeams: tournament.padelTeams.filter(team => team.player1Id !== playerId && team.player2Id !== playerId),
      });
      const teamsChanged = tournaments.some((tournament, index) =>
        tournament.padelTeams?.length !== event.tournaments[index].padelTeams?.length);
      const roster = { players, ...(teamsChanged ? { tournaments } : {}) };
      if (!event.rankingData) return players.length === (event.players ?? []).length && !teamsChanged ? [] : [{ ref: snapshot.ref, data: roster }];
      const data = normalizeRankingData(event.rankingData, event.eventType);
      const availabilities = { ...data.availabilities };
      delete availabilities[playerId];
      return [{ ref: snapshot.ref, data: {
        ...roster,
        rankingData: sanitizeRankingDataForFirestore({
          ...data, participantIds: data.participantIds?.filter(id => id !== playerId),
          matches: data.matches.filter(match => !matchIncludesPlayer(match, playerId)), availabilities,
          master: removePlayerFromSummerRankingMaster(data.master, playerId),
          padelIndividualMaster: removePlayerFromPadelIndividualMaster(data.padelIndividualMaster, playerId),
        }, event.eventType),
      } }];
    });
    updates.forEach(({ ref, data }) => transaction.update(ref, data));
    transaction.delete(doc(db, 'players', playerId));
    relatedSnapshots.forEach(snapshot => {
      if (snapshot.exists() && snapshot.data().playerId === playerId) transaction.delete(snapshot.ref);
    });
  });
}
