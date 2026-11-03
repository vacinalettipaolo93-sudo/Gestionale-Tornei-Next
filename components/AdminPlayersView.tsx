import React, { useMemo, useState } from 'react';
import { associatePlayerWithEvent, createPlayerWithAccount, deletePlayerEverywhere, removePlayerFromRanking } from '../services/playerDataService';
import { type Event, type Player, type SummerRankingData } from '../types';
import { normalizeRankingData } from '../utils/rankingEvent';
import { updatePlayerEverywhere } from '../utils/updatePlayerProfile';

interface AdminPlayersViewProps {
  players: Player[];
  events: Event[];
  rankingEvent: Event;
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  isOrganizer?: boolean;
}

const AdminPlayersView: React.FC<AdminPlayersViewProps> = ({
  players,
  events,
  rankingEvent,
  isOrganizer = false,
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
  const [removingPlayerId, setRemovingPlayerId] = useState<string | null>(null);

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
  const currentRankingEvent = useMemo(
    () => events.find(item => item.id === rankingEvent.id) ?? rankingEvent,
    [events, rankingEvent],
  );
  const eventPlayerIdSet = useMemo(
    () => new Set((currentRankingEvent.players ?? []).map(player => player.id)),
    [currentRankingEvent.players],
  );
  const addPlayerToRankingEvent = async (player: Player, startPoints: number) => {
    await associatePlayerWithEvent(rankingEvent.id, player.id, startPoints);
    return { wasAlreadyParticipant: participantIdSet.has(player.id), wasAlreadyInEventPlayers: eventPlayerIdSet.has(player.id) };
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

  const handleSaveLevelPoints = async (player: Player) => {
    const raw = eventPlayerPointsById[player.id] ?? String(player.summerRankingStartPoints ?? 0);
    const points = Number(raw);
    if (!raw.trim() || !Number.isFinite(points) || points < 0) {
      setFeedback({ type: 'error', message: 'Inserisci punti validi maggiori o uguali a zero.' }); return;
    }
    if ((player.summerRankingStartPoints ?? 0) === points) {
      setEventPlayerPointsById(previous => { const next = { ...previous }; delete next[player.id]; return next; });
      return;
    }
    try {
      await updatePlayerEverywhere(player.id, {
        summerRankingStartPoints: points,
        summerRankingJoinedAt: player.summerRankingJoinedAt ?? new Date().toISOString()
      });
      setEventPlayerPointsById(previous => { const next = { ...previous }; delete next[player.id]; return next; });
      setFeedback({ type: 'success', message: 'Punti livello aggiornati.' });
    } catch (error) {
      console.error('Errore salvataggio punti livello', error);
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Punti non salvati. Riprova.' });
    }
  };

  const handleCreatePlayer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setFeedback(null);
    try {
      await createPlayerWithAccount(newPlayerName, newPlayerPhone, Number(newPlayerStartPoints || 0),
        [...(addNewPlayerToRanking ? [rankingEvent.id] : []), ...(selectedEventId ? [selectedEventId] : [])]);
      setNewPlayerName(''); setNewPlayerPhone(''); setNewPlayerStartPoints('0');
      setFeedback({ type: 'success', message: 'Giocatore creato correttamente.' });
    } catch (error) {
      console.error('Errore creazione giocatore', error);
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Giocatore non creato. Riprova.' });
    } finally { setLoading(false); }
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
    if (!editingPlayer || editLoading) return;
    setEditLoading(true);
    try {
      await updatePlayerEverywhere(editingPlayer.id, {
        name: editPlayerName.trim(), phone: editPlayerPhone.trim(),
        summerRankingStartPoints: Number(editPlayerPoints),
        summerRankingJoinedAt: editingPlayer.summerRankingJoinedAt ?? new Date().toISOString()
      });
      closeEditPlayer();
      setFeedback({ type: 'success', message: 'Giocatore aggiornato correttamente.' });
    } catch (error) {
      console.error('Errore aggiornamento giocatore', error);
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Giocatore non salvato. Riprova.' });
    } finally { setEditLoading(false); }
  };

  const handleRemovePlayerFromRankingEvent = async (player: Player) => {
    if (!isOrganizer || removingPlayerId || deletingPlayerId) return;
    if (!window.confirm(`Rimuovere ${player.name} solo da questo torneo? Resterà negli altri eventi e nell'archivio globale.`)) return;
    setRemovingPlayerId(player.id);
    try {
      await removePlayerFromRanking(rankingEvent.id, player.id);
      setFeedback({ type: 'success', message: `${player.name} rimosso da questo torneo.` });
    } catch (error) {
      console.error('Errore rimozione giocatore', error);
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Rimozione non riuscita. Riprova.' });
    } finally { setRemovingPlayerId(null); }
  };

  const handleDeletePlayer = async (player: Player) => {
    if (deletingPlayerId || !window.confirm(`Eliminare definitivamente ${player.name}?`)) return;
    setDeletingPlayerId(player.id);
    try {
      await deletePlayerEverywhere(player.id);
      if (editingPlayer?.id === player.id) closeEditPlayer();
      setFeedback({ type: 'success', message: `${player.name} eliminato correttamente.` });
    } catch (error) {
      console.error('Errore eliminazione giocatore', error);
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Eliminazione non riuscita. Riprova.' });
    } finally { setDeletingPlayerId(null); }
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

              <div className="flex flex-wrap gap-2">
                <button onClick={() => openEditPlayer(player)} className="px-3 py-1.5 rounded bg-highlight text-white text-xs font-semibold">Modifica</button>
                {isOrganizer && (participantIdSet.has(player.id) || eventPlayerIdSet.has(player.id)) && (
                  <button
                    onClick={() => void handleRemovePlayerFromRankingEvent(player)}
                    disabled={removingPlayerId === player.id}
                    className="px-3 py-1.5 rounded bg-tertiary text-text-primary text-xs font-semibold disabled:opacity-60"
                  >
                    {removingPlayerId === player.id ? 'Rimozione...' : 'Rimuovi dal torneo'}
                  </button>
                )}
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
                        {isOrganizer && (participantIdSet.has(player.id) || eventPlayerIdSet.has(player.id)) && (
                          <button
                            onClick={() => void handleRemovePlayerFromRankingEvent(player)}
                            disabled={removingPlayerId === player.id}
                            className="px-3 py-1 rounded bg-tertiary text-text-primary text-xs font-semibold disabled:opacity-60"
                          >
                            {removingPlayerId === player.id ? 'Rimozione...' : 'Rimuovi dal torneo'}
                          </button>
                        )}
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
