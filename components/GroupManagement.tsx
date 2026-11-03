import React, { useMemo, useState } from 'react';
import { saveEventChanges } from '../services/eventDataService';
import { type Event, type Group, type Match, type PadelTeam, type Player, type Tournament } from '../types';
import { TrashIcon } from './Icons';
import { PersistenceFeedback, usePersistenceAction } from './usePersistenceAction';

interface GroupManagementProps {
    event: Event;
    tournament: Tournament;
    setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
    isOrganizer: boolean;
}

const makeId = () => `${Date.now()}${Math.floor(Math.random() * 10000)}`;

const GroupManagement: React.FC<GroupManagementProps> = ({ event, tournament, setEvents, isOrganizer }) => {
    const persistence = usePersistenceAction();
    const withGroupBaseline = (group: Group): Event => ({
        ...event,
        tournaments: event.tournaments.map(t => t.id === tournament.id
            ? { ...t, groups: t.groups.map(g => g.id === group.id ? group : g) } : t),
    });
    const isPadel = event.eventType === 'tournament_padel';
    const teams = Array.isArray(tournament.padelTeams) ? tournament.padelTeams : [];
    const getTeamById = (teamId: string) => teams.find(team => team.id === teamId);
    const getPlayer = (id: string) => event.players.find(p => p.id === id);
    const getCompetitorNameById = (id: string) => {
        if (!isPadel) return getPlayer(id)?.name ?? 'Giocatore sconosciuto';
        const team = getTeamById(id);
        if (!team) return 'Squadra sconosciuta';
        const player1 = getPlayer(team.player1Id);
        const player2 = getPlayer(team.player2Id);
        return `${team.name} (${player1?.name ?? 'Giocatore 1'} / ${player2?.name ?? 'Giocatore 2'})`;
    };

    const [assigningGroup, setAssigningGroup] = useState<Group | null>(null);
    const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set());
    const [playerToRemove, setPlayerToRemove] = useState<{competitorId: string, group: Group} | null>(null);
    const [newTeamName, setNewTeamName] = useState('');
    const [newTeamPlayer1Id, setNewTeamPlayer1Id] = useState('');
    const [newTeamPlayer2Id, setNewTeamPlayer2Id] = useState('');
    const [teamError, setTeamError] = useState<string | null>(null);

    // --- States per aggiungi/modifica/elimina gironi ---
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupSize, setNewGroupSize] = useState<number>(4);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editingGroup, setEditingGroup] = useState<Group | null>(null);
    const [editGroupName, setEditGroupName] = useState('');
    const [editGroupSize, setEditGroupSize] = useState<number>(0);
    const [editGroupRules, setEditGroupRules] = useState(''); // <-- NEW STATE
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // SEARCH for assign modal (ADDED)
    const [assignSearchQuery, setAssignSearchQuery] = useState('');

    const openAssignModal = (group: Group) => {
        setAssigningGroup(group);
        setSelectedPlayers(new Set(group.playerIds));
        setAssignSearchQuery(''); // reset search when opening
    };

    const handlePlayerSelection = (playerId: string) => {
        setSelectedPlayers(prev => {
            const newSet = new Set(prev);
            if (newSet.has(playerId)) {
                newSet.delete(playerId);
            } else {
                newSet.add(playerId);
            }
            return newSet;
        });
    };

    // ASSEGNA GIOCATORI E AGGIORNA FIRESTORE
    const handleSaveAssignments = async () => {
        await persistence.run(async () => {
            if (!assigningGroup) return;

            const updatedGroups = tournament.groups.map(g =>
                g.id === assigningGroup.id ? { ...g, playerIds: Array.from(selectedPlayers) } : g
            );

            await saveEventChanges(withGroupBaseline(assigningGroup), {
                tournaments: event.tournaments.map(t =>
                    t.id === tournament.id ? { ...t, groups: updatedGroups } : t
                )
            });

            setAssigningGroup(null);
        });
    };

    // RIMUOVI GIOCATORE E AGGIORNA FIRESTORE
    const handleRemovePlayer = async () => {
        await persistence.run(async () => {
            if (!playerToRemove) return;
            const { competitorId, group } = playerToRemove;

            const updatedGroups = tournament.groups.map(g => {
                if (g.id !== group.id) return g;
                return {
                    ...g,
                    playerIds: g.playerIds.filter(id => id !== competitorId),
                    matches: g.matches.filter(m => m.player1Id !== competitorId && m.player2Id !== competitorId)
                }
            });

            await saveEventChanges(withGroupBaseline(group), {
                tournaments: event.tournaments.map(t =>
                    t.id === tournament.id ? { ...t, groups: updatedGroups } : t
                )
            });

            setPlayerToRemove(null);
        });
    }

    // GENERA PARTITE E AGGIORNA FIRESTORE
    const handleGenerateMatches = async (group: Group) => {
        await persistence.run(async () => {
            if (group.playerIds.length < 2) {
                alert(isPadel ? "Sono necessarie almeno 2 squadre per generare le partite." : "Sono necessari almeno 2 giocatori per generare le partite.");
                return;
            }

            // Determine if this group must be double round-robin (andata e ritorno)
            const isDouble = !!(tournament.settings?.groupRoundRobin && tournament.settings.groupRoundRobin[group.id]);

            const newMatches: Match[] = [];
            for (let i = 0; i < group.playerIds.length; i++) {
                for (let j = i + 1; j < group.playerIds.length; j++) {
                    // match A vs B
                    newMatches.push({
                        id: `m${Date.now()}${i}${j}`,
                        player1Id: group.playerIds[i],
                        player2Id: group.playerIds[j],
                        score1: null,
                        score2: null,
                        status: 'pending',
                    });
                    // if double round-robin, add reverse fixture
                    if (isDouble) {
                        newMatches.push({
                            id: `m${Date.now()}${j}${i}_r`,
                            player1Id: group.playerIds[j],
                            player2Id: group.playerIds[i],
                            score1: null,
                            score2: null,
                            status: 'pending',
                        });
                    }
                }
            }

            const updatedGroups = tournament.groups.map(g =>
                g.id === group.id ? { ...g, matches: newMatches } : g
            );

            await saveEventChanges(event, {
                tournaments: event.tournaments.map(t => t.id === tournament.id ? { ...t, groups: updatedGroups } : t)
            });
        });
    };

    const handleCreatePadelTeam = async () => {
        await persistence.run(async () => {
            if (!isPadel) return;
            const trimmedTeamName = newTeamName.trim();
            setTeamError(null);

            if (!trimmedTeamName) {
                setTeamError('Inserisci il nome squadra.');
                return;
            }
            if (!newTeamPlayer1Id || !newTeamPlayer2Id) {
                setTeamError('Seleziona Giocatore 1 e Giocatore 2.');
                return;
            }
            if (newTeamPlayer1Id === newTeamPlayer2Id) {
                setTeamError('Giocatore 1 e Giocatore 2 devono essere diversi.');
                return;
            }

            const newTeam: PadelTeam = {
                id: makeId(),
                name: trimmedTeamName,
                player1Id: newTeamPlayer1Id,
                player2Id: newTeamPlayer2Id,
            };

            const updatedTeams = [...teams, newTeam];
            const updatedTournaments = event.tournaments.map(t =>
                t.id === tournament.id ? { ...t, padelTeams: updatedTeams } : t
            );

            await saveEventChanges(event, { tournaments: updatedTournaments });

            setNewTeamName('');
            setNewTeamPlayer1Id('');
            setNewTeamPlayer2Id('');
        });
    };

    // ---------- Nuove funzioni: Aggiungi / Modifica / Elimina Gironi ----------
    const openAddGroup = () => {
        setNewGroupName('');
        setNewGroupSize(4);
        setError(null);
        setIsAddOpen(true);
    };

    const handleAddGroup = async () => {
        setLoading(true);
        setError(null);
        try {
            const newGroup: Group = {
                id: makeId(),
                name: newGroupName || `Girone ${tournament.groups.length + 1}`,
                playerIds: [],
                matches: [],
                rules: ""
            };

            const updatedGroups = [...tournament.groups, newGroup];

            await saveEventChanges(event, {
                tournaments: event.tournaments.map(t => t.id === tournament.id ? { ...t, groups: updatedGroups } : t)
            });

            setIsAddOpen(false);
            setNewGroupName('');
            setNewGroupSize(4);
        } catch (err: any) {
            console.error('Errore aggiunta girone', err);
            setError(err?.message || 'Errore durante la creazione del girone');
        } finally {
            setLoading(false);
        }
    };

    const openEditGroup = (g: Group) => {
        setEditingGroup(g);
        setEditGroupName(g.name);
        setEditGroupSize(g.playerIds?.length ?? 0);
        setEditGroupRules(g.rules ?? "");
        setError(null);
        setIsEditOpen(true);
    };

    const handleSaveEditGroup = async () => {
        if (!editingGroup) return;
        setLoading(true);
        setError(null);
        try {
            const original = editingGroup;
            const targetSize = Math.max(0, Math.floor(editGroupSize));
            let newPlayerIds = original.playerIds ? original.playerIds.slice(0, targetSize) : [];

            if (targetSize > (original.playerIds?.length ?? 0)) {
                newPlayerIds = original.playerIds ?? [];
            }

            const removedPlayerIds = (original.playerIds ?? []).slice(targetSize);
            const newMatches = original.matches ? original.matches.filter(m =>
                !removedPlayerIds.includes(m.player1Id) && !removedPlayerIds.includes(m.player2Id)
            ) : [];

            const updatedGroup: Group = {
                ...original,
                name: editGroupName,
                playerIds: newPlayerIds,
                matches: newMatches,
                rules: editGroupRules // <-- salva il regolamento qui!
            };

            const updatedGroups = tournament.groups.map(g => g.id === updatedGroup.id ? updatedGroup : g);

            await saveEventChanges(withGroupBaseline(original), {
                tournaments: event.tournaments.map(t => t.id === tournament.id ? { ...t, groups: updatedGroups } : t)
            });

            setIsEditOpen(false);
            setEditingGroup(null);
        } catch (err: any) {
            console.error('Errore salvataggio modifica girone', err);
            setError(err?.message || 'Errore durante il salvataggio della modifica');
        } finally {
            setLoading(false);
        }
    };

    const openDeleteGroup = (g: Group) => {
        setGroupToDelete(g);
        setIsDeleteOpen(true);
        setError(null);
    };

    const handleDeleteGroup = async () => {
        if (!groupToDelete) return;
        setLoading(true);
        setError(null);
        try {
            const updatedGroups = tournament.groups.filter(g => g.id !== groupToDelete.id);

            await saveEventChanges(withGroupBaseline(groupToDelete), {
                tournaments: event.tournaments.map(t => t.id === tournament.id ? { ...t, groups: updatedGroups } : t)
            });

            setGroupToDelete(null);
            setIsDeleteOpen(false);
        } catch (err: any) {
            console.error('Errore eliminazione girone', err);
            setError(err?.message || 'Errore durante l\'eliminazione del girone');
        } finally {
            setLoading(false);
        }
    };

    // Filtered + sorted players for assign modal: alphabetical and searchable (ADDED)
    const filteredAssignPlayers = useMemo(() => {
        const q = assignSearchQuery.trim().toLowerCase();
        if (isPadel) {
            return teams
                .slice()
                .filter(team => {
                    if (!q) return true;
                    const player1Name = getPlayer(team.player1Id)?.name ?? '';
                    const player2Name = getPlayer(team.player2Id)?.name ?? '';
                    return team.name.toLowerCase().includes(q)
                        || player1Name.toLowerCase().includes(q)
                        || player2Name.toLowerCase().includes(q);
                })
                .sort((a, b) => a.name.localeCompare(b.name));
        }
        return (event.players ?? [])
            .slice()
            .filter(p => {
                if (!q) return true;
                return (p.name ?? '').toLowerCase().includes(q);
            })
            .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    }, [event.players, assignSearchQuery, isPadel, teams]);

    return <React.Fragment><PersistenceFeedback persistence={persistence} />{(
        <div className="space-y-6">
            {isPadel && (
                <div className="bg-secondary p-4 rounded-xl shadow-md">
                    <h4 className="text-lg font-bold text-accent mb-3">Crea squadra</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input
                            value={newTeamName}
                            onChange={e => setNewTeamName(e.target.value)}
                            placeholder="Nome squadra"
                            className="w-full p-2 rounded bg-primary border border-tertiary"
                        />
                        <select
                            value={newTeamPlayer1Id}
                            onChange={e => setNewTeamPlayer1Id(e.target.value)}
                            className="w-full p-2 rounded bg-primary border border-tertiary"
                        >
                            <option value="">Giocatore 1</option>
                            {event.players.map(player => (
                                <option key={player.id} value={player.id}>{player.name}</option>
                            ))}
                        </select>
                        <select
                            value={newTeamPlayer2Id}
                            onChange={e => setNewTeamPlayer2Id(e.target.value)}
                            className="w-full p-2 rounded bg-primary border border-tertiary"
                        >
                            <option value="">Giocatore 2</option>
                            {event.players.map(player => (
                                <option key={player.id} value={player.id}>{player.name}</option>
                            ))}
                        </select>
                        <button
                            onClick={handleCreatePadelTeam}
                            className="bg-highlight hover:bg-highlight/90 text-white font-bold py-2 px-3 rounded-lg text-sm transition-colors"
                        >
                            Crea squadra
                        </button>
                    </div>
                    {teamError && <p className="text-red-400 text-sm mt-2">{teamError}</p>}
                    <div className="mt-4">
                        <h5 className="text-sm font-semibold mb-2 text-text-secondary">Squadre create ({teams.length})</h5>
                        {teams.length > 0 ? (
                            <ul className="space-y-2">
                                {teams.map(team => (
                                    <li key={team.id} className="bg-tertiary/50 p-2 rounded">
                                        <div className="font-semibold">{team.name}</div>
                                        <div className="text-xs text-text-secondary">
                                            {getPlayer(team.player1Id)?.name ?? 'Giocatore 1'} / {getPlayer(team.player2Id)?.name ?? 'Giocatore 2'}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-text-secondary/80 italic text-sm">Nessuna squadra creata.</p>
                        )}
                    </div>
                </div>
            )}

            {/* Header amministrazione gironi */}
            <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-accent">Gestione Gironi</h3>
                <div className="flex gap-2">
                    <button onClick={openAddGroup} className="bg-accent hover:bg-accent/90 text-white font-bold py-2 px-3 rounded-lg text-sm transition-colors">
                        + Aggiungi Girone
                    </button>
                </div>
            </div>

            {tournament.groups.map(group => (
                <div key={group.id} className="bg-secondary p-4 rounded-xl shadow-md mb-8">
                    <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                            <h4 className="text-lg font-bold text-accent">{group.name}</h4>
                            <span className="text-sm text-text-secondary">{group.playerIds.length} {isPadel ? 'squadre' : 'giocatori'}</span>
                        </div>
                        <div className="flex gap-2">
                             <button onClick={() => openAssignModal(group)} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-3 rounded-lg text-sm transition-colors">
                               {isPadel ? 'Assegna Squadre' : 'Assegna Giocatori'}
                            </button>
                            <button 
                                onClick={() => handleGenerateMatches(group)} 
                                disabled={group.playerIds.length < 2}
                                className="bg-highlight hover:bg-highlight/90 text-white font-bold py-2 px-3 rounded-lg text-sm transition-colors disabled:bg-tertiary disabled:cursor-not-allowed"
                            >
                                Genera Partite
                            </button>
                            <button
                                onClick={() => openEditGroup(group)}
                                className="bg-tertiary hover:bg-tertiary/90 text-text-primary py-2 px-3 rounded-lg text-sm transition-colors"
                            >
                                Modifica
                            </button>
                            <button
                                onClick={() => openDeleteGroup(group)}
                                className="bg-red-600 hover:bg-red-700 text-white py-2 px-3 rounded-lg text-sm transition-colors flex items-center gap-2"
                            >
                                <TrashIcon className="w-4 h-4" />
                                Elimina
                            </button>
                        </div>
                    </div>
                    <div>
                        <h5 className="text-sm font-semibold mb-2 text-text-secondary">{isPadel ? 'Squadre Assegnate' : 'Giocatori Assegnati'} ({group.playerIds.length})</h5>
                        {group.playerIds.length > 0 ? (
                            <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                {group.playerIds.map(competitorId => (
                                    <li key={competitorId} className="bg-tertiary/50 p-2 rounded-lg flex items-center justify-between gap-2 group/player">
                                        <div className="text-sm font-medium truncate">{getCompetitorNameById(competitorId)}</div>
                                        <button onClick={() => setPlayerToRemove({competitorId, group})} className="opacity-0 group-hover/player:opacity-100 text-text-secondary/50 hover:text-red-500 transition-colors p-1">
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : <p className="text-text-secondary/80 italic text-sm">Nessun{isPadel ? 'a squadra' : ' giocatore'} assegnat{isPadel ? 'a' : 'o'} a questo girone.</p>}
                    </div>
                    {/* Mostra regolamento del gruppo (SOLO ADMIN può modificare) */}
                    <div className="mt-4 pt-3 border-t border-tertiary/40">
                        <h5 className="text-sm font-semibold mb-2 text-text-secondary">Regolamento del Girone</h5>
                        <div className="bg-tertiary p-3 rounded-lg border border-tertiary">
                            {group.rules?.trim() ?
                                <div style={{ whiteSpace: 'pre-line' }}>{group.rules}</div>
                                :
                                <span className="text-text-secondary">Nessun regolamento inserito per questo girone.</span>
                            }
                        </div>
                    </div>
                </div>
            ))}

            {tournament.groups.length === 0 && (
                <p className="text-center text-text-secondary py-8">Crea un girone per iniziare la gestione.</p>
            )}

            {/* Modale: Assegna giocatori al girone */}
            {assigningGroup && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fadeIn">
                    <div className="bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-sm border border-tertiary">
                        <h4 className="text-lg font-bold mb-4">
                            {isPadel ? 'Assegna Squadre' : 'Assegna Giocatori'} a {assigningGroup.name}
                        </h4>

                        {/* SEARCH INPUT: ADDED */}
                        <div className="mb-3">
                          <input
                            id="assignSearchInput"
                            type="text"
                            value={assignSearchQuery}
                            onChange={e => setAssignSearchQuery(e.target.value)}
                            placeholder={isPadel ? 'Cerca squadra...' : 'Cerca giocatore...'}
                            className="w-full bg-primary border border-tertiary rounded px-3 py-2"
                            autoFocus
                          />
                        </div>

                        <ul className="mb-4 space-y-2 max-h-80 overflow-auto">
                            {isPadel ? (filteredAssignPlayers as PadelTeam[]).map(team => (
                                <li key={team.id} className="flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        checked={selectedPlayers.has(team.id)}
                                        onChange={() => handlePlayerSelection(team.id)}
                                    />
                                    <span className="font-medium">{team.name}</span>
                                    <span className="text-xs text-text-secondary">
                                        ({getPlayer(team.player1Id)?.name ?? 'Giocatore 1'} / {getPlayer(team.player2Id)?.name ?? 'Giocatore 2'})
                                    </span>
                                </li>
                            )) : (filteredAssignPlayers as Player[]).map(player => (
                                <li key={player.id} className="flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        checked={selectedPlayers.has(player.id)}
                                        onChange={() => handlePlayerSelection(player.id)}
                                    />
                                    <img src={player.avatar} alt={player.name} className="w-7 h-7 rounded-full object-cover" />
                                    <span className="font-medium">{player.name}</span>
                                </li>
                            ))}
                        </ul>
                        <div className="flex justify-end gap-2 mt-2">
                            <button onClick={() => setAssigningGroup(null)} className="bg-tertiary px-4 py-2 rounded">Annulla</button>
                            <button onClick={handleSaveAssignments} className="bg-highlight text-white px-4 py-2 rounded font-bold">Salva Assegnazione</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Confirm remove assigned player */}
            {playerToRemove && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fadeIn">
                    <div className="bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-md border border-tertiary">
                        <h4 className="text-lg font-bold mb-4">{isPadel ? 'Rimuovi Squadra dal Girone' : 'Rimuovi Giocatore dal Girone'}</h4>
                        <p className="text-text-secondary mb-4">
                            Sei sicuro di voler rimuovere <strong>{getCompetitorNameById(playerToRemove.competitorId)}</strong> dal girone <strong>{playerToRemove.group.name}</strong>? Questa operazione rimuoverà anche le relative partite nel girone.
                        </p>
                        <div className="flex justify-end gap-4">
                            <button onClick={() => setPlayerToRemove(null)} className="bg-tertiary px-4 py-2 rounded">Annulla</button>
                            <button onClick={handleRemovePlayer} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded">{isPadel ? 'Rimuovi Squadra' : 'Rimuovi Giocatore'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Modifica girone! Qui puoi MODIFICARE il regolamento */}
            {isEditOpen && editingGroup && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fadeIn">
                    <div className="bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-sm border border-tertiary">
                        <h4 className="text-lg font-bold mb-4">Modifica Girone</h4>
                        <input
                            value={editGroupName}
                            onChange={e => setEditGroupName(e.target.value)}
                            placeholder="Nome girone"
                            className="w-full mb-2 p-2 rounded bg-primary border"
                            autoFocus
                        />
                        <label className="text-sm text-text-secondary">Numero attuale di giocatori: {editingGroup.playerIds.length}</label>
                        <p className="text-sm text-text-secondary mb-2">Per modificare i giocatori usa "Assegna Giocatori". Ridurre il numero rimuoverà i giocatori oltre la dimensione scelta e le loro partite verranno eliminate.</p>
                        <div className="mb-2">
                            <label className="text-sm text-text-secondary">Regolamento del girone</label>
                            <textarea
                                value={editGroupRules}
                                onChange={e => setEditGroupRules(e.target.value)}
                                placeholder="Scrivi qui il regolamento per questo girone..."
                                className="w-full p-2 rounded bg-tertiary border mb-2 min-h-[80px]"
                                rows={4}
                            />
                        </div>
                        <div className="flex justify-end gap-4">
                            <button onClick={() => { setIsEditOpen(false); setEditingGroup(null); }} className="bg-tertiary px-4 py-2 rounded">Annulla</button>
                            <button onClick={handleSaveEditGroup} disabled={loading} className="bg-highlight text-white px-4 py-2 rounded">{loading ? 'Salvando...' : 'Salva Modifica'}</button>
                        </div>
                        {error && <div className="text-red-400 mt-2">{error}</div>}
                    </div>
                </div>
            )}

            {/* Modal: AGGIUNGI GIRONE */}
            {isAddOpen && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fadeIn">
                    <div className="bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-sm border border-tertiary">
                        <h4 className="text-lg font-bold mb-4">Aggiungi nuovo Girone</h4>
                        <input
                            value={newGroupName}
                            onChange={e => setNewGroupName(e.target.value)}
                            placeholder="Nome girone"
                            className="w-full mb-2 p-2 rounded bg-primary border"
                            autoFocus
                        />
                        <div className="text-sm text-text-secondary mb-2">Il nuovo girone partirà senza giocatori e senza partite.</div>
                        <div className="flex justify-end gap-4 mt-4">
                            <button onClick={() => setIsAddOpen(false)} className="bg-tertiary px-4 py-2 rounded">Annulla</button>
                            <button 
                                onClick={handleAddGroup} 
                                disabled={loading || !newGroupName.trim()} 
                                className="bg-highlight text-white px-4 py-2 rounded font-bold"
                            >
                                {loading ? "Creando..." : "Crea Girone"}
                            </button>
                        </div>
                        {error && <div className="text-red-400 mt-2">{error}</div>}
                    </div>
                </div>
            )}

            {/* Modal: Elimina girone */}
            {isDeleteOpen && groupToDelete && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fadeIn">
                    <div className="bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-md border border-tertiary">
                        <h4 className="text-lg font-bold mb-4">Conferma Eliminazione Girone</h4>
                        <p className="text-text-secondary">Sei sicuro di voler eliminare il girone "{groupToDelete.name}"? Questa azione rimuoverà anche le partite associate.</p>
                        {error && <div className="text-red-400 mt-2">{error}</div>}
                        <div className="flex justify-end gap-4 mt-6">
                            <button onClick={() => { setIsDeleteOpen(false); setGroupToDelete(null); }} className="bg-tertiary px-4 py-2 rounded">Annulla</button>
                            <button onClick={handleDeleteGroup} disabled={loading} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded">{loading ? 'Eliminando...' : 'Elimina Girone'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )}</React.Fragment>;
};

export default GroupManagement;
