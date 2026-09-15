import React, { useEffect, useMemo, useState } from 'react';
import { collection, addDoc, deleteDoc, doc, getDocs, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { type Event, type Player, type SummerRankingData } from '../types';
import { removePlayerFromPadelIndividualMaster } from '../utils/padelIndividualRanking';
import { removePlayerFromSummerRankingMaster } from '../utils/summerRanking';
import { matchIncludesPlayer, normalizeRankingData, sanitizeRankingDataForFirestore } from '../utils/rankingEvent';
import { createInitialsAvatar } from '../utils/avatar';

interface AdminPlayersViewProps {
  players: Player[];
  events: Event[];
  rankingEvent: Event;
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
}

const AdminPlayersView: React.FC<AdminPlayersViewProps> = ({
  players,
  events,
  rankingEvent,
  setEvents,
}) => {
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerPhone, setNewPlayerPhone] = useState('');
  const [newPlayerStartPoints, setNewPlayerStartPoints] = useState('0');
  const [addNewPlayerToRanking, setAddNewPlayerToRanking] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [eventPlayerPointsById, setEventPlayerPointsById] = useState<Record<string, string>>({});
  const [playerSearchInput, setPlayerSearchInput] = useState('');
  const [playerSearchQuery, setPlayerSearchQuery] = useState('');
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [editPlayerName, setEditPlayerName] = useState('');
  const [editPlayerPhone, setEditPlayerPhone] = useState('');
  const [editPlayerPoints, setEditPlayerPoints] = useState('0');
  const [editLoading, setEditLoading] = useState(false);
  const [deletingPlayerId, setDeletingPlayerId] = useState<string | null>(null);

  const sortedPlayers = useMemo(
    () => players.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [players],
  );
  const filteredPlayers = useMemo(() => {
    const query = playerSearchQuery.trim().toLowerCase();
    if (!query) return sortedPlayers;
    return sortedPlayers.filter(player => player.name.toLowerCase().includes(query));
  }, [playerSearchQuery, sortedPlayers]);
  const rankingData = useMemo<SummerRankingData>(
    () => normalizeRankingData(rankingEvent.rankingData, rankingEvent.eventType),
    [rankingEvent.eventType, rankingEvent.rankingData],
  );
  const rankingParticipantIds = useMemo(
    () => Array.isArray(rankingData.participantIds) ? rankingData.participantIds : [],
    [rankingData.participantIds],
  );
  const participantIdSet = useMemo(
    () => new Set(rankingParticipantIds),
    [rankingParticipantIds],
  );
  const addPlayerToRankingEvent = async (player: Player, startPoints: number) => {
    const event = events.find(item => item.id === rankingEvent.id) ?? rankingEvent;
    const currentRankingData = normalizeRankingData(event.rankingData ?? rankingData, event.eventType);
    const participantIds = Array.from(new Set([...(currentRankingData.participantIds ?? []), player.id]));
    const existingEventPlayer = event.players.find(existing => existing.id === player.id);
    const alreadyInEventPlayers = Boolean(existingEventPlayer);
    const joinedAt = player.summerRankingJoinedAt ?? existingEventPlayer?.summerRankingJoinedAt ?? new Date().toISOString();
    const eventPlayer: Player = {
      id: player.id,
      name: player.name,
      phone: player.phone ?? existingEventPlayer?.phone ?? '',
      avatar: player.avatar ?? existingEventPlayer?.avatar ?? createInitialsAvatar(player.name),
      status: 'confirmed',
      summerRankingStartPoints: startPoints,
      summerRankingJoinedAt: joinedAt,
    };
    const nextPlayers = alreadyInEventPlayers
      ? event.players.map(existing => existing.id === player.id ? eventPlayer : existing)
      : [...event.players, eventPlayer];
    const nextRankingData: SummerRankingData = {
      ...currentRankingData,
      participantIds,
    };
    const eventPayload = {
      eventType: rankingEvent.eventType,
      players: nextPlayers,
      rankingData: sanitizeRankingDataForFirestore(nextRankingData, rankingEvent.eventType),
    };

    const batch = writeBatch(db);
    batch.update(doc(db, 'players', player.id), {
      summerRankingStartPoints: startPoints,
      summerRankingJoinedAt: joinedAt,
    });
    batch.update(doc(db, 'events', rankingEvent.id), eventPayload);
    await batch.commit();

    setEvents(prev =>
      prev.map(item => item.id === rankingEvent.id ? {
        ...item,
        ...eventPayload,
      } : item),
    );

    return {
      wasAlreadyParticipant: participantIdSet.has(player.id),
      wasAlreadyInEventPlayers: alreadyInEventPlayers,
    };
  };

  const addPlayerToRanking = async (player: Player, startPoints: number) => {
    const event = events.find(item => item.id === rankingEvent.id) ?? rankingEvent;
    const currentRankingData = normalizeRankingData(event.rankingData ?? rankingData, event.eventType);
    const currentParticipantSet = new Set(currentRankingData.participantIds);
    if (currentParticipantSet.has(player.id) && event.players.some(existing => existing.id === player.id)) {
      setFeedback({ type: 'success', message: `${player.name} è già nel ranking.` });
      return;
    }

    const result = await addPlayerToRankingEvent(player, startPoints);
    if (!result.wasAlreadyParticipant && !result.wasAlreadyInEventPlayers) {
      setFeedback({ type: 'success', message: `${player.name} aggiunto al ranking.` });
      return;
    }
    if (result.wasAlreadyParticipant && !result.wasAlreadyInEventPlayers) {
      setFeedback({ type: 'success', message: `${player.name} aggiunto ai giocatori dell'evento ranking.` });
      return;
    }
    setFeedback({ type: 'success', message: `${player.name} associato correttamente al ranking.` });
  };

  const addPlayerToEvent = async (eventId: string, player: Player, startPoints: number) => {
    if (!eventId) return;
    const event = events.find(item => item.id === eventId);
    if (!event || event.players.some(existing => existing.id === player.id)) return;

    if ((player.summerRankingStartPoints ?? 0) !== startPoints) {
      await updateDoc(doc(db, 'players', player.id), {
        summerRankingStartPoints: startPoints,
        summerRankingJoinedAt: player.summerRankingJoinedAt ?? new Date().toISOString(),
      });
    }

    const eventPlayer: Player = {
      id: player.id,
      name: player.name,
      phone: player.phone ?? '',
      avatar: player.avatar,
      status: 'confirmed',
      summerRankingStartPoints: startPoints,
      summerRankingJoinedAt: player.summerRankingJoinedAt ?? new Date().toISOString(),
    };
    const updatedPlayers = [...event.players, eventPlayer];
    setEvents(prev =>
      prev.map(item => item.id === event.id ? { ...item, players: updatedPlayers } : item),
    );
    await updateDoc(doc(db, 'events', event.id), { players: updatedPlayers });
  };

  const handleSaveLevelPoints = async (player: Player) => {
    const rawValue = eventPlayerPointsById[player.id] ?? String(player.summerRankingStartPoints ?? 0);
    if (rawValue.trim() === '') {
      setFeedback({ type: 'error', message: `Punti livello non validi per ${player.name}.` });
      return;
    }
    const startPoints = Number(rawValue);
    if (!Number.isFinite(startPoints) || startPoints < 0) {
      setFeedback({ type: 'error', message: `Punti livello non validi per ${player.name}.` });
      return;
    }
    if ((player.summerRankingStartPoints ?? 0) === startPoints) {
      setEventPlayerPointsById(prev => ({ ...prev, [player.id]: String(startPoints) }));
      return;
    }

    const joinedAt = player.summerRankingJoinedAt ?? new Date().toISOString();
    try {
      await updateDoc(doc(db, 'players', player.id), {
        summerRankingStartPoints: startPoints,
        summerRankingJoinedAt: joinedAt,
      });

      const eventsToPersist = events
        .filter(event => event.players.some(eventPlayer => eventPlayer.id === player.id))
        .map(event => ({
          id: event.id,
          players: event.players.map(eventPlayer =>
            eventPlayer.id === player.id
              ? {
                ...eventPlayer,
                summerRankingStartPoints: startPoints,
                summerRankingJoinedAt: joinedAt,
              }
              : eventPlayer,
          ),
        }));

      if (eventsToPersist.length > 0) {
        setEvents(prev =>
          prev.map(event => {
            const update = eventsToPersist.find(item => item.id === event.id);
            return update ? { ...event, players: update.players } : event;
          }),
        );
        await Promise.all(eventsToPersist.map(event => updateDoc(doc(db, 'events', event.id), { players: event.players })));
      }
    } catch (error) {
      console.error('Errore salvataggio punti livello', error);
      setFeedback({ type: 'error', message: `Errore salvataggio punti livello per ${player.name}.` });
      return;
    }

    setEventPlayerPointsById(prev => ({ ...prev, [player.id]: String(startPoints) }));
    setFeedback({ type: 'success', message: `Punti livello aggiornati per ${player.name}.` });
  };

  useEffect(() => {
    setEventPlayerPointsById(prev => {
      const next: Record<string, string> = {};
      for (const player of players) {
        next[player.id] = prev[player.id] ?? String(player.summerRankingStartPoints ?? 0);
      }
      return next;
    });
  }, [players]);

  const ensureUserForPlayer = async (playerId: string, username: string) => {
    const usersRef = collection(db, 'users');
    const userSnap = await getDocs(query(usersRef, where('username', '==', username)));
    if (!userSnap.empty) return;

    await addDoc(usersRef, {
      username,
      password: '1234',
      role: 'participant',
      playerId,
    });
  };

  const handleCreatePlayer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newPlayerName.trim()) return;
    setLoading(true);
    try {
      const trimmedName = newPlayerName.trim();
      const trimmedPhone = newPlayerPhone.trim();
      const startPoints = Number(newPlayerStartPoints || 0);
      const playersRef = collection(db, 'players');
      const existingSnap = await getDocs(query(playersRef, where('name', '==', trimmedName), where('phone', '==', trimmedPhone)));

      let playerId: string;
      if (!existingSnap.empty) {
        const existingDoc = existingSnap.docs[0];
        playerId = existingDoc.id;
      } else {
        const createdRef = await addDoc(playersRef, {
          name: trimmedName,
          phone: trimmedPhone,
          avatar: createInitialsAvatar(trimmedName),
          status: 'confirmed',
          summerRankingStartPoints: startPoints,
          summerRankingJoinedAt: new Date().toISOString(),
        });
        playerId = createdRef.id;
      }

      const createdPlayer: Player = {
        id: playerId,
        name: trimmedName,
        phone: trimmedPhone,
        avatar: createInitialsAvatar(trimmedName),
        status: 'confirmed',
        summerRankingStartPoints: startPoints,
      };

      await ensureUserForPlayer(playerId, trimmedName);
      const playerForActions = players.find(player => player.id === playerId) ?? createdPlayer;
      if (addNewPlayerToRanking) {
        await addPlayerToRanking(playerForActions, startPoints);
      }
      if (selectedEventId) {
        await addPlayerToEvent(selectedEventId, playerForActions, startPoints);
      }

      setNewPlayerName('');
      setNewPlayerPhone('');
      setNewPlayerStartPoints('0');
      setFeedback({ type: 'success', message: 'Giocatore creato correttamente.' });
    } catch (error) {
      console.error('Errore creazione giocatore', error);
      setFeedback({ type: 'error', message: 'Impossibile creare il giocatore. Riprova.' });
    } finally {
      setLoading(false);
    }
  };

  const openEditPlayer = (player: Player) => {
    setEditingPlayer(player);
    setEditPlayerName(player.name);
    setEditPlayerPhone(player.phone ?? '');
    setEditPlayerPoints(String(player.summerRankingStartPoints ?? 0));
  };

  const closeEditPlayer = () => {
    setEditingPlayer(null);
    setEditPlayerName('');
    setEditPlayerPhone('');
    setEditPlayerPoints('0');
  };

  const handleSaveEditedPlayer = async () => {
    if (!editingPlayer) return;
    const normalizedName = editPlayerName.trim();
    const normalizedPhone = editPlayerPhone.trim();
    const normalizedPoints = Number(editPlayerPoints);

    if (!normalizedName) {
      setFeedback({ type: 'error', message: 'Il nome giocatore è obbligatorio.' });
      return;
    }
    if (!Number.isFinite(normalizedPoints) || normalizedPoints < 0) {
      setFeedback({ type: 'error', message: 'Il valore del giocatore deve essere un numero valido maggiore o uguale a 0.' });
      return;
    }

    setEditLoading(true);
    try {
      const joinedAt = editingPlayer.summerRankingJoinedAt ?? new Date().toISOString();
      await updateDoc(doc(db, 'players', editingPlayer.id), {
        name: normalizedName,
        phone: normalizedPhone,
        summerRankingStartPoints: normalizedPoints,
        summerRankingJoinedAt: joinedAt,
      });

      const eventsToUpdate = events.filter(event => event.players.some(player => player.id === editingPlayer.id));
      if (eventsToUpdate.length > 0) {
        const updatedEvents = events.map(event => ({
          ...event,
          players: event.players.map(player =>
            player.id === editingPlayer.id
              ? {
                ...player,
                name: normalizedName,
                phone: normalizedPhone,
                summerRankingStartPoints: normalizedPoints,
                summerRankingJoinedAt: joinedAt,
              }
              : player,
          ),
        }));

        setEvents(updatedEvents);
        await Promise.all(
          updatedEvents
            .filter(event => event.players.some(player => player.id === editingPlayer.id))
            .map(event => updateDoc(doc(db, 'events', event.id), { players: event.players })),
        );
      }

      setFeedback({ type: 'success', message: 'Giocatore aggiornato correttamente.' });
      closeEditPlayer();
    } catch (error) {
      console.error('Errore aggiornamento giocatore', error);
      setFeedback({ type: 'error', message: 'Errore durante il salvataggio del giocatore.' });
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeletePlayer = async (player: Player) => {
    if (!window.confirm(`Eliminare definitivamente ${player.name}?`)) return;
    setDeletingPlayerId(player.id);
    try {
      const usersRef = collection(db, 'users');
      const linkedUsersSnap = await getDocs(query(usersRef, where('playerId', '==', player.id)));
      await Promise.all(linkedUsersSnap.docs.map(userDoc => deleteDoc(userDoc.ref)));
      await deleteDoc(doc(db, 'players', player.id));

      const eventsToPersist: Array<{ id: string; players: Player[]; rankingData?: SummerRankingData; eventType?: Event['eventType'] }> = [];
      const localUpdatesByEventId = new Map<string, { players: Player[]; rankingData?: SummerRankingData }>();

      for (const event of events) {
        const nextPlayers = event.players.filter(eventPlayer => eventPlayer.id !== player.id);
        const removedFromPlayers = nextPlayers.length !== event.players.length;
        const participantIds = Array.isArray(event.rankingData?.participantIds)
          ? event.rankingData.participantIds.filter(id => id !== player.id)
          : undefined;
        const removedFromParticipantIds = participantIds !== undefined
          && participantIds.length !== (event.rankingData?.participantIds?.length ?? 0);
        const nextMatches = Array.isArray(event.rankingData?.matches)
          ? event.rankingData.matches.filter(match => !matchIncludesPlayer(match, player.id))
          : [];
        const removedFromMatches = Array.isArray(event.rankingData?.matches)
          && nextMatches.length !== event.rankingData.matches.length;
        const nextAvailabilities = { ...(event.rankingData?.availabilities ?? {}) };
        const hadAvailability = player.id in nextAvailabilities;
        delete nextAvailabilities[player.id];
        const nextMaster = removePlayerFromSummerRankingMaster(event.rankingData?.master, player.id);
        const nextPadelIndividualMaster = removePlayerFromPadelIndividualMaster(event.rankingData?.padelIndividualMaster, player.id);
        const removedFromMaster = nextMaster !== event.rankingData?.master;
        const removedFromPadelMaster = nextPadelIndividualMaster !== event.rankingData?.padelIndividualMaster;
        const rankingChanged = removedFromParticipantIds || removedFromMatches || hadAvailability || removedFromMaster || removedFromPadelMaster;

        if (!removedFromPlayers && !rankingChanged) continue;

        const nextRankingData: SummerRankingData | undefined = event.rankingData
          ? {
            ...event.rankingData,
            participantIds,
            matches: nextMatches,
            availabilities: nextAvailabilities,
            master: nextMaster,
            padelIndividualMaster: nextPadelIndividualMaster,
          }
          : undefined;

        localUpdatesByEventId.set(event.id, { players: nextPlayers, rankingData: nextRankingData });
        eventsToPersist.push({ id: event.id, players: nextPlayers, rankingData: nextRankingData, eventType: event.eventType });
      }

      setEvents(prev =>
        prev.map(event => {
          const update = localUpdatesByEventId.get(event.id);
          if (!update) return event;
          return {
            ...event,
            players: update.players,
            rankingData: update.rankingData,
          };
        }),
      );

      await Promise.all(
        eventsToPersist.map(event =>
          updateDoc(doc(db, 'events', event.id), {
            players: event.players,
            ...(event.rankingData ? { rankingData: sanitizeRankingDataForFirestore(event.rankingData, event.eventType) } : {}),
          }),
        ),
      );

      if (editingPlayer?.id === player.id) {
        closeEditPlayer();
      }
      setFeedback({ type: 'success', message: `${player.name} eliminato correttamente.` });
    } catch (error) {
      console.error('Errore eliminazione giocatore', error);
      setFeedback({ type: 'error', message: `Errore durante l'eliminazione di ${player.name}.` });
    } finally {
      setDeletingPlayerId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="bg-secondary rounded-xl shadow-lg p-6">
        <h2 className="text-3xl font-bold text-accent">Giocatori</h2>
        <p className="text-text-secondary mt-1">
          Archivio globale condiviso tra eventi. Gestione ranking per l&apos;evento: <strong>{rankingEvent.name}</strong>.
        </p>
      </div>

      <div className="bg-secondary rounded-xl shadow-lg p-6">
        <h3 className="text-xl font-semibold mb-4">Crea nuovo giocatore</h3>
        <form onSubmit={handleCreatePlayer} className="grid grid-cols-1 lg:grid-cols-5 gap-3">
          <input
            type="text"
            value={newPlayerName}
            onChange={event => setNewPlayerName(event.target.value)}
            placeholder="Nome Cognome"
            className="bg-primary border border-tertiary rounded-lg p-2"
            required
          />
          <input
            type="tel"
            value={newPlayerPhone}
            onChange={event => setNewPlayerPhone(event.target.value)}
            placeholder="Telefono"
            className="bg-primary border border-tertiary rounded-lg p-2"
          />
          <input
            type="number"
            min="0"
            value={newPlayerStartPoints}
            onChange={event => setNewPlayerStartPoints(event.target.value)}
            placeholder="Punti ranking iniziali"
            className="bg-primary border border-tertiary rounded-lg p-2"
          />
          <select
            value={selectedEventId}
            onChange={event => setSelectedEventId(event.target.value)}
            className="bg-primary border border-tertiary rounded-lg p-2"
          >
            <option value="">Non aggiungere a evento</option>
            {events.slice().sort((a, b) => a.name.localeCompare(b.name)).map(event => (
              <option key={event.id} value={event.id}>{event.name}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={loading}
            className="bg-highlight hover:bg-highlight/90 text-white rounded-lg font-semibold p-2 disabled:opacity-60"
          >
            {loading ? 'Salvataggio...' : 'Crea giocatore'}
          </button>
        </form>
        <label className="mt-3 inline-flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={addNewPlayerToRanking}
            onChange={event => setAddNewPlayerToRanking(event.target.checked)}
          />
          Aggiungi subito il nuovo giocatore al ranking dell&apos;evento
        </label>
      </div>

      <div className="bg-secondary rounded-xl shadow-lg p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-xl font-semibold">Giocatori globali ({sortedPlayers.length})</h3>
          <div className="flex w-full sm:w-auto items-center gap-2">
            <input
              type="search"
              value={playerSearchInput}
              onChange={event => {
                setPlayerSearchInput(event.target.value);
                setPlayerSearchQuery(event.target.value);
              }}
              placeholder="Cerca giocatore per nome"
              className="flex-1 sm:flex-none bg-primary border border-tertiary rounded-lg p-2 text-sm sm:min-w-[220px]"
            />
            <button
              type="button"
              onClick={() => setPlayerSearchQuery(playerSearchInput)}
              className="px-3 py-2 rounded bg-tertiary text-text-primary text-sm font-semibold"
            >
              Cerca
            </button>
          </div>
          <div className="text-sm text-text-secondary w-full md:w-auto md:text-right">
            Ordinati alfabeticamente • Nel ranking: {rankingParticipantIds.length} • Risultati: {filteredPlayers.length}
          </div>
        </div>
        {feedback && (
          <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${feedback.type === 'success' ? 'bg-green-600/20 text-green-200 border border-green-500/30' : 'bg-red-600/20 text-red-200 border border-red-500/30'}`}>
            {feedback.message}
          </div>
        )}

        {/* ── Mobile card view ── */}
        <div className="sm:hidden space-y-3">
          {filteredPlayers.length === 0 ? (
            <div className="py-8 text-center text-text-secondary">Nessun giocatore trovato.</div>
          ) : filteredPlayers.map(player => (
            <div key={player.id} className="rounded-xl border border-tertiary/40 bg-primary/40 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-text-primary">{player.name}</div>
                  <div className="text-xs text-text-secondary mt-0.5">{player.phone || '—'}</div>
                </div>
                {participantIdSet.has(player.id) ? (
                  <span className="shrink-0 px-2 py-1 rounded bg-green-600 text-white text-xs font-semibold">Nel ranking</span>
                ) : null}
              </div>

              <div className="flex items-center gap-3">
                <label className="text-xs text-text-secondary shrink-0">Punti:</label>
                <input
                  type="number"
                  min="0"
                  value={eventPlayerPointsById[player.id] ?? String(player.summerRankingStartPoints ?? 0)}
                  onChange={event => setEventPlayerPointsById(prev => ({ ...prev, [player.id]: event.target.value }))}
                  onBlur={() => { void handleSaveLevelPoints(player); }}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void handleSaveLevelPoints(player); } }}
                  className="w-24 bg-primary border border-tertiary rounded px-2 py-1 text-sm"
                />
                {!participantIdSet.has(player.id) && (
                  <button
                    onClick={async () => {
                      try {
                        const rawValue = eventPlayerPointsById[player.id] ?? String(player.summerRankingStartPoints ?? 0);
                        if (rawValue.trim() === '') { setFeedback({ type: 'error', message: `Valore non valido per ${player.name}.` }); return; }
                        const startPoints = Number(rawValue);
                        if (!Number.isFinite(startPoints) || startPoints < 0) { setFeedback({ type: 'error', message: `Valore non valido per ${player.name}.` }); return; }
                        await addPlayerToRanking(player, startPoints);
                      } catch (error) {
                        console.error('Errore aggiunta giocatore ranking', error);
                        setFeedback({ type: 'error', message: `Errore durante l'aggiunta di ${player.name} al ranking.` });
                      }
                    }}
                    className="px-3 py-1.5 rounded bg-highlight text-white text-xs font-semibold"
                  >
                    Aggiungi
                  </button>
                )}
              </div>

              {editingPlayer?.id === player.id && (
                <div className="rounded-xl border border-highlight/30 bg-secondary p-4 space-y-3">
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="text-sm text-text-secondary block mb-1">Nome</label>
                      <input value={editPlayerName} onChange={event => setEditPlayerName(event.target.value)} className="w-full bg-primary border border-tertiary rounded p-2" />
                    </div>
                    <div>
                      <label className="text-sm text-text-secondary block mb-1">Telefono</label>
                      <input value={editPlayerPhone} onChange={event => setEditPlayerPhone(event.target.value)} className="w-full bg-primary border border-tertiary rounded p-2" />
                    </div>
                    <div>
                      <label className="text-sm text-text-secondary block mb-1">Valore iniziale</label>
                      <input type="number" min="0" value={editPlayerPoints} onChange={event => setEditPlayerPoints(event.target.value)} className="w-full bg-primary border border-tertiary rounded p-2" />
                    </div>
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button onClick={closeEditPlayer} className="px-4 py-2 rounded bg-tertiary text-text-primary font-semibold text-sm">Annulla</button>
                    <button onClick={handleSaveEditedPlayer} disabled={editLoading} className="px-4 py-2 rounded bg-highlight text-white font-semibold text-sm">
                      {editLoading ? 'Salvataggio...' : 'Salva'}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => openEditPlayer(player)} className="px-3 py-1.5 rounded bg-highlight text-white text-xs font-semibold">Modifica</button>
                <button onClick={() => void handleDeletePlayer(player)} disabled={deletingPlayerId === player.id} className="px-3 py-1.5 rounded bg-red-600 text-white text-xs font-semibold disabled:opacity-60">
                  {deletingPlayerId === player.id ? 'Eliminazione...' : 'Elimina'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ── Desktop table ── */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left border-b border-tertiary text-text-secondary">
                <th className="py-3 pr-3">Giocatore</th>
                <th className="py-3 pr-3">Telefono</th>
                <th className="py-3 pr-3">Punti livello</th>
                <th className="py-3 pr-3">Ranking</th>
                <th className="py-3 pr-3">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlayers.map(player => (
                <React.Fragment key={player.id}>
                  <tr className="border-b border-tertiary/40">
                    <td className="py-3 pr-3 font-semibold">{player.name}</td>
                    <td className="py-3 pr-3 text-text-secondary">{player.phone || '—'}</td>
                    <td className="py-3 pr-3">
                      <input
                        type="number"
                        min="0"
                        value={eventPlayerPointsById[player.id] ?? String(player.summerRankingStartPoints ?? 0)}
                        onChange={event => setEventPlayerPointsById(prev => ({ ...prev, [player.id]: event.target.value }))}
                        onBlur={() => {
                          void handleSaveLevelPoints(player);
                        }}
                        onKeyDown={event => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleSaveLevelPoints(player);
                          }
                        }}
                        className="w-24 bg-primary border border-tertiary rounded px-2 py-1"
                      />
                    </td>
                    <td className="py-3 pr-3">
                      {participantIdSet.has(player.id) ? (
                        <span className="px-2 py-1 rounded bg-green-600 text-white text-xs font-semibold">Nel ranking</span>
                      ) : (
                        <button
                          onClick={async () => {
                            try {
                              const rawValue = eventPlayerPointsById[player.id] ?? String(player.summerRankingStartPoints ?? 0);
                              if (rawValue.trim() === '') {
                                setFeedback({ type: 'error', message: `Valore non valido per ${player.name}.` });
                                return;
                              }
                              const startPoints = Number(rawValue);
                              if (!Number.isFinite(startPoints) || startPoints < 0) {
                                setFeedback({ type: 'error', message: `Valore non valido per ${player.name}.` });
                                return;
                              }
                              await addPlayerToRanking(player, startPoints);
                            } catch (error) {
                              console.error('Errore aggiunta giocatore ranking', error);
                              setFeedback({ type: 'error', message: `Errore durante l'aggiunta di ${player.name} al ranking.` });
                            }
                          }}
                          className="px-3 py-1 rounded bg-highlight text-white text-xs font-semibold"
                        >
                          Aggiungi al ranking
                        </button>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => openEditPlayer(player)}
                          className="px-3 py-1 rounded bg-highlight text-white text-xs font-semibold"
                        >
                          Modifica
                        </button>
                        <button
                          onClick={() => void handleDeletePlayer(player)}
                          disabled={deletingPlayerId === player.id}
                          className="px-3 py-1 rounded bg-red-600 text-white text-xs font-semibold disabled:opacity-60"
                        >
                          {deletingPlayerId === player.id ? 'Eliminazione...' : 'Elimina'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingPlayer?.id === player.id && (
                    <tr className="border-b border-tertiary/40 last:border-b-0">
                      <td colSpan={5} className="pb-4 pt-1">
                        <div className="rounded-xl border border-highlight/30 bg-primary/60 p-4">
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                            <div>
                              <label className="text-sm text-text-secondary block mb-1">Nome</label>
                              <input
                                value={editPlayerName}
                                onChange={event => setEditPlayerName(event.target.value)}
                                className="w-full bg-primary border border-tertiary rounded p-2"
                              />
                            </div>
                            <div>
                              <label className="text-sm text-text-secondary block mb-1">Telefono</label>
                              <input
                                value={editPlayerPhone}
                                onChange={event => setEditPlayerPhone(event.target.value)}
                                className="w-full bg-primary border border-tertiary rounded p-2"
                              />
                            </div>
                            <div>
                              <label className="text-sm text-text-secondary block mb-1">Valore iniziale</label>
                              <input
                                type="number"
                                min="0"
                                value={editPlayerPoints}
                                onChange={event => setEditPlayerPoints(event.target.value)}
                                className="w-full bg-primary border border-tertiary rounded p-2"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-3 mt-4">
                            <button onClick={closeEditPlayer} className="px-4 py-2 rounded bg-tertiary text-text-primary font-semibold">Annulla</button>
                            <button onClick={handleSaveEditedPlayer} disabled={editLoading} className="px-4 py-2 rounded bg-highlight text-white font-semibold">
                              {editLoading ? 'Salvataggio...' : 'Salva'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {filteredPlayers.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-text-secondary">
                    Nessun giocatore trovato.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminPlayersView;
