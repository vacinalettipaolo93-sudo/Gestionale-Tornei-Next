import React, { useState } from 'react';
import { saveEventChanges } from '../services/eventDataService';
import { createPlayerWithAccount, deletePlayerEverywhere } from '../services/playerDataService';
import { type Event, type Player } from '../types';
import { updatePlayerEverywhere } from '../utils/updatePlayerProfile';
import { usePersistenceAction } from './usePersistenceAction';

interface PlayerManagementProps {
  event: Event;
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  isOrganizer: boolean;
  onPlayerContact: (player: Player) => void;
}

// Funzione che determina se il giocatore è assegnato ad almeno un girone
const isPlayerAssignedToGroup = (event: Event, playerId: string): boolean => {
  return event.tournaments.some(tournament =>
    tournament.groups.some(group => group.playerIds?.includes(playerId))
  );
};

const PlayerManagement: React.FC<PlayerManagementProps> = ({ event, setEvents, isOrganizer, onPlayerContact }) => {
    const persistence = usePersistenceAction();
    const [replacingPlayer, setReplacingPlayer] = useState<Player | null>(null);
    const [replacementTarget, setReplacementTarget] = useState<string>('');
    const [newPlayerName, setNewPlayerName] = useState('');
    const [newPlayerPhone, setNewPlayerPhone] = useState('');
    const [newPlayerSummerRankingPoints, setNewPlayerSummerRankingPoints] = useState('0');
    const [loading, setLoading] = useState(false);

    // EDIT states (minimal, simple modal)
    const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
    const [editName, setEditName] = useState('');
    const [editPhone, setEditPhone] = useState('');
    const [editLoading, setEditLoading] = useState(false);

    // DEDUPLICA giocatori per id nella lista visualizzata
    const players = event.players.filter(
      (p, i, arr) => arr.findIndex(pp => pp.id === p.id) === i
    );
    const confirmedPlayers = players.filter(p => p.status === 'confirmed');
    const pendingPlayers = players.filter(p => p.status === 'pending');

    // AGGIUNGI GIOCATORE: anti-doppioni
    const handleAddPlayer = async (e: React.FormEvent) => {
        e.preventDefault();
        if(!newPlayerName.trim() || !newPlayerPhone.trim()) return;
        setLoading(true);
        try {
          await createPlayerWithAccount(newPlayerName, newPlayerPhone, Number(newPlayerSummerRankingPoints || 0), [event.id]);
          setNewPlayerName('');
          setNewPlayerPhone('');
          setNewPlayerSummerRankingPoints('0');
        } catch (err) {
          alert("Errore durante la creazione: " + (err as Error).message);
        }
        setLoading(false);
    };

    // CONFERMA GIOCATORE E AGGIORNA FIRESTORE
    const handleConfirmPlayer = async (playerId: string) => {
        await persistence.run(async () => {
            await saveEventChanges(event, {
                players: event.players.map(p => p.id === playerId ? { ...p, status: 'confirmed' } : p),
            });
        });
    };

    // ELIMINA GIOCATORE DA SISTEMA (evento + firebase)
    const handleDeletePlayer = async (playerId: string) => {
      setLoading(true);
      try {
        await deletePlayerEverywhere(playerId);
      } catch (err) {
        alert("Errore cancellazione: " + (err as Error).message);
      }
      setLoading(false);
    };

    // SOSTITUISCI GIOCATORE E AGGIORNA FIRESTORE
    const handleReplacePlayer = async () => {
        if (!replacingPlayer || !replacementTarget) return;
        await persistence.run(async () => {
            const newTournaments = event.tournaments.map(tourn => ({
                ...tourn,
                groups: tourn.groups.map(group => {
                    if (!group.playerIds.includes(replacingPlayer.id)) return group;
                    return {
                        ...group,
                        playerIds: group.playerIds.map(id => id === replacingPlayer.id ? replacementTarget : id),
                        matches: group.matches.map(match => {
                            if (match.player1Id === replacingPlayer.id) return { ...match, player1Id: replacementTarget };
                            if (match.player2Id === replacingPlayer.id) return { ...match, player2Id: replacementTarget };
                            return match;
                        })
                    };
                })
            }));
            await saveEventChanges(event, { tournaments: newTournaments });
            setReplacingPlayer(null);
        });
    };

    const potentialReplacements = confirmedPlayers.filter(p => p.id !== replacingPlayer?.id);

    // EDIT: open editor modal for a player
    const openEditPlayer = (player: Player) => {
      setEditingPlayer(player);
      setEditName(player.name ?? '');
      setEditPhone(player.phone ?? '');
    };

    const closeEditModal = () => {
      setEditingPlayer(null);
      setEditName('');
      setEditPhone('');
    };

    const handleSaveEditPlayer = async () => {
      if (!editingPlayer) return;
      setEditLoading(true);
      try {
        await updatePlayerEverywhere(editingPlayer.id, { name: editName.trim(), phone: editPhone.trim() });
        closeEditModal();
      } catch (err) {
        alert("Errore durante il salvataggio: " + (err as Error).message);
        console.error(err);
      } finally {
        setEditLoading(false);
      }
    };

    const handleContact = (player: Player) => {
        if (onPlayerContact) {
          onPlayerContact(player);
        } else if (player.phone) {
          window.open(`https://wa.me/${player.phone.replace(/[^0-9]/g, '')}`, '_blank');
        } else {
          alert('Nessun numero disponibile per questo giocatore.');
        }
    };

    return (
        <div className="bg-secondary p-6 rounded-xl shadow-lg">
            {persistence.error && <p role="alert" className="text-red-400 mb-3">{persistence.error}</p>}
            <h3 className="text-xl font-bold mb-6 text-accent">Partecipanti ({confirmedPlayers.length})</h3>

             {isOrganizer && (
                <>
                <div className="mb-8 bg-primary/50 p-4 rounded-lg">
                    <h4 className="text-lg font-semibold mb-3">Aggiungi Nuovo Giocatore</h4>
                    <form onSubmit={handleAddPlayer} className="flex flex-col sm:flex-row gap-3">
                        <input 
                            type="text" 
                            placeholder="Nome Cognome" 
                            value={newPlayerName}
                            onChange={e => setNewPlayerName(e.target.value)}
                            className="flex-grow bg-secondary border border-tertiary rounded-lg p-2 text-text-primary focus:ring-2 focus:ring-accent"
                            required
                        />
                        <input 
                            type="tel" 
                            placeholder="Numero di telefono" 
                            value={newPlayerPhone}
                            onChange={e => setNewPlayerPhone(e.target.value)}
                            className="flex-grow bg-secondary border border-tertiary rounded-lg p-2 text-text-primary focus:ring-2 focus:ring-accent"
                            required
                        />
                        <input
                            type="number"
                            min="0"
                            placeholder="Punti Summer Ranking"
                            value={newPlayerSummerRankingPoints}
                            onChange={e => setNewPlayerSummerRankingPoints(e.target.value)}
                            className="sm:w-48 bg-secondary border border-tertiary rounded-lg p-2 text-text-primary focus:ring-2 focus:ring-accent"
                        />
                        <button type="submit" disabled={loading} className="bg-highlight hover:bg-highlight/90 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm">
                            {loading ? "Aggiungo..." : "Aggiungi"}
                        </button>
                    </form>
                </div>

                <div className="mb-8">
                    <h4 className="text-lg font-semibold mb-3">Richieste di Iscrizione ({pendingPlayers.length})</h4>
                    {pendingPlayers.length > 0 ? (
                        <ul className="space-y-3">
                            {pendingPlayers
                                .slice()
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((player, idx) => (
                                <li key={player.id} className="flex items-center justify-between bg-tertiary/50 p-3 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <img src={player.avatar} alt={player.name} className="w-10 h-10 rounded-full object-cover"/>
                                        <div>
                                            <div className="font-semibold">{idx + 1}. {player.name}</div>
                                            <div className="text-sm text-text-secondary">{player.phone}</div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                      <button onClick={() => handleConfirmPlayer(player.id)} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                                        Conferma
                                      </button>
                                      <button onClick={() => handleDeletePlayer(player.id)} disabled={loading} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                                        Elimina
                                      </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : <p className="text-text-secondary italic">Nessuna richiesta di iscrizione in attesa.</p>}</div>
                </>
             )}

            <div>
                <h4 className="text-lg font-semibold mb-3">Partecipanti Confermati</h4>
                <ul className="space-y-3">
                    {confirmedPlayers
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((player, idx) => (
                        <li key={player.id} className="flex items-center justify-between bg-tertiary/50 p-3 rounded-lg">
                             <button onClick={() => onPlayerContact(player)} className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity">
                                <img src={player.avatar} alt={player.name} className="w-10 h-10 rounded-full object-cover"/>
                                <div>
                                    <div className="font-semibold flex items-center gap-2">
                                      {idx + 1}. {player.name}
                                      {isPlayerAssignedToGroup(event, player.id) && (
                                        <span className="ml-2 px-2 py-[2px] rounded bg-green-600 text-white text-xs font-semibold">
                                          Assegnato
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-sm text-text-secondary">{player.phone}</div>
                                </div>
                            </button>
                            {isOrganizer && (
                                <div className="flex gap-2">
                                    <button onClick={() => setReplacingPlayer(player)} className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm">
                                        Sostituisci
                                    </button>
                                    <button onClick={() => { openEditPlayer(player); }} className="bg-tertiary hover:bg-tertiary/80 text-text-primary font-bold py-2 px-4 rounded-lg transition-colors text-sm">
                                        Modifica
                                    </button>
                                    <button onClick={() => handleDeletePlayer(player.id)} disabled={loading} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                                        Elimina
                                    </button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            </div>

            {isOrganizer && replacingPlayer && (
                 <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 animate-fadeIn">
                    <div className="bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-md border border-tertiary">
                        <h4 className="text-lg font-bold mb-4">Sostituisci {replacingPlayer.name}</h4>
                        <div className="space-y-4">
                            <p className="text-text-secondary">Seleziona un giocatore con cui sostituire {replacingPlayer.name}. I risultati precedenti verranno mantenuti.</p>
                            <select
                                value={replacementTarget}
                                onChange={(e) => setReplacementTarget(e.target.value)}
                                className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary focus:ring-2 focus:ring-accent"
                            >
                                <option value="">Seleziona un giocatore</option>
                                {potentialReplacements
                                    .slice()
                                    .sort((a, b) => a.name.localeCompare(b.name))
                                    .map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex justify-end gap-4 mt-6">
                            <button onClick={() => setReplacingPlayer(null)} className="bg-tertiary hover:bg-tertiary/80 text-text-primary font-bold py-2 px-4 rounded-lg transition-colors">Annulla</button>
                            <button onClick={handleReplacePlayer} disabled={!replacementTarget} className="bg-highlight hover:bg-highlight/80 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                                Conferma Sostituzione
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* EDIT PLAYER MODAL (simple, minimal) */}
            {editingPlayer && (
              <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 animate-fadeIn">
                <div className="bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-sm border border-tertiary">
                  <h4 className="text-lg font-bold mb-4">Modifica Giocatore</h4>
                  <div className="mb-3">
                    <label className="text-sm text-text-secondary block mb-1">Nome</label>
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="w-full p-2 rounded bg-primary border"
                      autoFocus
                    />
                  </div>
                  <div className="mb-4">
                    <label className="text-sm text-text-secondary block mb-1">Telefono</label>
                    <input
                      value={editPhone}
                      onChange={e => setEditPhone(e.target.value)}
                      className="w-full p-2 rounded bg-primary border"
                      placeholder="Es. +391234567890"
                    />
                  </div>

                  <div className="flex justify-end gap-3">
                    <button onClick={closeEditModal} className="bg-tertiary px-4 py-2 rounded">Annulla</button>
                    <button onClick={handleSaveEditPlayer} disabled={editLoading} className="bg-highlight text-white px-4 py-2 rounded">
                      {editLoading ? 'Salvando...' : 'Salva Modifica'}
                    </button>
                  </div>
                </div>
              </div>
            )}
        </div>
    );
};

export default PlayerManagement;
