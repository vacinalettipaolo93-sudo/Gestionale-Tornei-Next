// App.tsx
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { type Event, type Tournament, type User, type Player, type SummerRankingData } from './types';
import EventView from './components/EventView';
import TournamentView from './components/TournamentView';
import Login from './components/Login';
import EditProfileModal from './components/EditProfileModal';
import ParticipantDashboard from './components/ParticipantDashboard';
import ContactModal from './components/ContactModal';
import SummerRankingView from './components/SummerRankingView';
import PadelIndividualRankingView from './components/PadelIndividualRankingView';
import AdminPlayersView from './components/AdminPlayersView';
import AdminUsersModal from './components/AdminUsersModal';
import { BackArrowIcon, NextTsBrandIcon, PencilIcon, PlusIcon, TrashIcon, UserCircleIcon, LogoutIcon } from './components/Icons';

import { db } from "./firebase";
import { collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, getDoc } from "firebase/firestore";
import { calculateSummerRanking, normalizeRulesConfig } from './utils/summerRanking';
import { calculatePadelIndividualRanking } from './utils/padelIndividualRanking';
import {
  createEmptyRankingData,
  getEventType,
  getRankingEventLabel,
  isRankingEventType,
  normalizeRankingData,
  sanitizeRankingDataForFirestore,
} from './utils/rankingEvent';
import { isEventConcluded } from './utils/eventStatus';
import { clearPersistedAuthSession, getAuthSessionStorage, persistAuthSession, resolvePersistedAuthUser } from './utils/authSession.js';

type View = 'dashboard' | 'event' | 'tournament' | 'playersAdmin';
type EventType = NonNullable<Event['eventType']>;

type TournamentTab =
  | 'standings'
  | 'matches'
  | 'participants'
  | 'playoffs'
  | 'consolation'
  | 'groups'
  | 'settings'
  | 'rules'
  | 'players'
  | 'availability'; // <-- aggiunto

const EMPTY_RANKING_DATA: SummerRankingData = createEmptyRankingData('ranking_singolare');

const App: React.FC = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [legacySummerRanking, setLegacySummerRanking] = useState<SummerRankingData | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isUsersLoaded, setIsUsersLoaded] = useState(false);
  const [isAuthBootstrapComplete, setIsAuthBootstrapComplete] = useState(false);

  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);

  const [tournamentInitialTab, setTournamentInitialTab] = useState<TournamentTab | undefined>(undefined);
  const [tournamentInitialGroupId, setTournamentInitialGroupId] = useState<string | undefined>(undefined);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [newEventType, setNewEventType] = useState<EventType>('tournament_singolare');
  const [createEventError, setCreateEventError] = useState<string | null>(null);
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);
  const [eventToRename, setEventToRename] = useState<Event | null>(null);
  const [renameEventName, setRenameEventName] = useState('');
  const [renameEventError, setRenameEventError] = useState<string | null>(null);
  const [isRenamingEvent, setIsRenamingEvent] = useState(false);
  const [contactPlayer, setContactPlayer] = useState<Player | null>(null);
  const [isAdminUsersModalOpen, setIsAdminUsersModalOpen] = useState(false);

  const isOrganizer = currentUser?.role === 'organizer';
  const loggedInPlayerId = currentUser?.playerId;

  const resetNavigationState = useCallback(() => {
    setCurrentView('dashboard');
    setSelectedEvent(null);
    setSelectedTournament(null);
    setTournamentInitialTab(undefined);
    setTournamentInitialGroupId(undefined);
  }, []);

  const getEventRankingData = (event?: Event | null) => {
    const eventType = getEventType(event);
    if (!isRankingEventType(eventType)) return EMPTY_RANKING_DATA;
    if (event?.rankingData) return normalizeRankingData(event.rankingData, eventType);
    if (eventType === 'ranking_singolare') return normalizeRankingData(legacySummerRanking, eventType);
    return createEmptyRankingData(eventType);
  };

  useEffect(() => {
    const unsubEvents = onSnapshot(collection(db, "events"), snapshot => {
      const nextEvents = snapshot.docs.map(snapshotDoc => {
        const raw = snapshotDoc.data() as Partial<Event>;
        const eventType = getEventType(raw);
        return {
          id: snapshotDoc.id,
          name: raw.name ?? '',
          invitationCode: raw.invitationCode ?? '',
          players: Array.isArray(raw.players) ? raw.players : [],
          tournaments: Array.isArray(raw.tournaments) ? raw.tournaments : [],
          globalTimeSlots: Array.isArray(raw.globalTimeSlots) ? raw.globalTimeSlots : [],
          rules: raw.rules,
          eventType,
          rankingData: isRankingEventType(eventType) ? normalizeRankingData(raw.rankingData, eventType) : undefined,
        } as Event;
      });
      setEvents(nextEvents);
    });
    const unsubPlayers = onSnapshot(collection(db, "players"), snapshot => {
      setPlayers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Player)));
    });
    const unsubUsers = onSnapshot(
      collection(db, "users"),
      snapshot => {
        setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User)));
        setIsUsersLoaded(true);
      },
      error => {
        console.error('Errore lettura utenti', error);
        setUsers([]);
        setIsUsersLoaded(true);
      },
    );

    void getDoc(doc(db, "summerRankingNext", "main"))
      .then(snapshot => {
        if (!snapshot.exists()) return;
        const data = snapshot.data() as SummerRankingData | undefined;
        setLegacySummerRanking(normalizeRankingData(data, 'ranking_singolare'));
      })
      .catch(error => {
        console.error('Errore lettura fallback Summer Ranking Next', error);
      });

    return () => {
      unsubEvents();
      unsubPlayers();
      unsubUsers();
    };
  }, []);

  useEffect(() => {
    if (!isUsersLoaded || isAuthBootstrapComplete) return;

    const { user } = resolvePersistedAuthUser({
      storage: getAuthSessionStorage(),
      users,
    });

    if (user) {
      setCurrentUser(user);
    }

    setIsAuthBootstrapComplete(true);
  }, [isAuthBootstrapComplete, isUsersLoaded, users]);

  useEffect(() => {
    if (!isAuthBootstrapComplete || !currentUser) return;

    const matchedUser = users.find(user => user.id === currentUser.id) ?? null;
    if (!matchedUser) {
      clearPersistedAuthSession(getAuthSessionStorage());
      setCurrentUser(null);
      resetNavigationState();
      return;
    }

    if (matchedUser !== currentUser) {
      setCurrentUser(matchedUser);
    }
  }, [currentUser, isAuthBootstrapComplete, resetNavigationState, users]);

  const handleSelectEvent = (event: Event) => {
    setTournamentInitialTab(undefined);
    setTournamentInitialGroupId(undefined);
    setSelectedTournament(null);
    setSelectedEvent(event);
    setCurrentView('event');
  };

  const handleSelectTournament = (tournament: Tournament, initialTab?: TournamentTab, initialGroupId?: string) => {
    setSelectedTournament(tournament);
    setTournamentInitialTab(initialTab);
    setTournamentInitialGroupId(initialGroupId);
    setCurrentView('tournament');
  };

  const navigateBack = () => {
    if (currentView === 'tournament') {
      setCurrentView('event');
      setSelectedTournament(null);
      setTournamentInitialTab(undefined);
      setTournamentInitialGroupId(undefined);
    } else if (currentView === 'playersAdmin') {
      setCurrentView(selectedEvent ? 'event' : 'dashboard');
    } else if (currentView === 'event') {
      setCurrentView('dashboard');
      setSelectedEvent(null);
    }
  };

  const saveEventRankingData = async (eventId: string, eventType: EventType, nextData: SummerRankingData) => {
    const normalized = normalizeRankingData(nextData, eventType);
    setEvents(prevEvents => prevEvents.map(event =>
      event.id === eventId
        ? { ...event, eventType, rankingData: normalized }
        : event
    ));
    if (selectedEvent?.id === eventId) {
      setSelectedEvent(prev => prev ? { ...prev, eventType, rankingData: normalized } : prev);
    }
    const sanitized = sanitizeRankingDataForFirestore(normalized, eventType);
    await updateDoc(doc(db, "events", eventId), {
      eventType,
      rankingData: sanitized,
    });
  };

  const updatePlayerSummerRankingStartPoints = async (playerId: string, points: number) => {
    const currentPlayer = players.find(player => player.id === playerId);
    const payload: Partial<Player> = {
      summerRankingStartPoints: points,
      summerRankingJoinedAt: currentPlayer?.summerRankingJoinedAt ?? new Date().toISOString(),
    };

    setPlayers(prevPlayers => prevPlayers.map(player =>
      player.id === playerId ? { ...player, ...payload } : player
    ));

    // Also update event.players so SummerRankingView (which receives currentEventState.players) reflects the change immediately
    const eventsToPersist = events
      .filter(event => event.players.some(eventPlayer => eventPlayer.id === playerId))
      .map(event => ({
        id: event.id,
        players: event.players.map(eventPlayer =>
          eventPlayer.id === playerId
            ? { ...eventPlayer, summerRankingStartPoints: points }
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

    await updateDoc(doc(db, "players", playerId), payload);
  };

  const resetCreateEventForm = () => {
    setNewEventName('');
    setNewEventType('tournament_singolare');
    setCreateEventError(null);
    setIsCreatingEvent(false);
  };

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    resetCreateEventForm();
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEventName = newEventName.trim();
    setCreateEventError(null);

    if (!trimmedEventName) {
      setCreateEventError("Inserisci il nome dell'evento.");
      return;
    }

    if (
      newEventType !== 'ranking_singolare'
      && newEventType !== 'ranking_padel_individuale'
      && newEventType !== 'tournament_singolare'
      && newEventType !== 'tournament_padel'
    ) {
      setCreateEventError('Seleziona una tipologia valida.');
      return;
    }

    setIsCreatingEvent(true);

    const baseEvent: Omit<Event, 'id'> = {
      name: trimmedEventName,
      invitationCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
      players: [],
      tournaments: [],
      eventType: newEventType,
    };

    try {
      await addDoc(collection(db, "events"), isRankingEventType(newEventType)
        ? {
          ...baseEvent,
          rankingData: createEmptyRankingData(newEventType),
        }
        : baseEvent);
      closeCreateModal();
    } catch (error) {
      console.error('Errore creazione evento', error);
      setCreateEventError('Impossibile creare l’evento. Riprova.');
    } finally {
      setIsCreatingEvent(false);
    }
  };

  const handleDeleteEvent = async () => {
    if (!eventToDelete) return;
    await deleteDoc(doc(db, "events", eventToDelete.id));
    if (selectedEvent?.id === eventToDelete.id) {
      setSelectedEvent(null);
      setCurrentView('dashboard');
    }
    setEventToDelete(null);
  };

  const openRenameModal = (event: Event) => {
    setEventToRename(event);
    setRenameEventName(event.name);
    setRenameEventError(null);
  };

  const closeRenameModal = () => {
    setEventToRename(null);
    setRenameEventName('');
    setRenameEventError(null);
    setIsRenamingEvent(false);
  };

  const handleRenameEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventToRename) return;
    const trimmedName = renameEventName.trim();
    if (!trimmedName) {
      setRenameEventError("Il nome dell'evento non può essere vuoto.");
      return;
    }
    setRenameEventError(null);
    setIsRenamingEvent(true);
    try {
      await updateDoc(doc(db, "events", eventToRename.id), { name: trimmedName });
      if (selectedEvent?.id === eventToRename.id) {
        setSelectedEvent(prev => prev ? { ...prev, name: trimmedName } : prev);
      }
      closeRenameModal();
    } catch (error) {
      console.error('Errore rinomina evento', error);
      setRenameEventError('Impossibile salvare il nome. Riprova.');
    } finally {
      setIsRenamingEvent(false);
    }
  };

  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    persistAuthSession(getAuthSessionStorage(), user);
  };

  const handleLogout = () => {
    clearPersistedAuthSession(getAuthSessionStorage());
    setCurrentUser(null);
    resetNavigationState();
  };

  const currentEventState = useMemo(() => events.find(e => e.id === selectedEvent?.id), [events, selectedEvent]);
  const currentTournamentState = useMemo(() => currentEventState?.tournaments.find(t => t.id === selectedTournament?.id), [currentEventState, selectedTournament]);

  const filteredEventsForOrganizer = useMemo(() => {
    if (isOrganizer) return events;
    return [];
  }, [events, isOrganizer]);

  const ongoingEvents = useMemo(() => filteredEventsForOrganizer.filter(e => !isEventConcluded(e)), [filteredEventsForOrganizer]);
  const concludedEvents = useMemo(() => filteredEventsForOrganizer.filter(e => isEventConcluded(e)), [filteredEventsForOrganizer]);

  if (!isAuthBootstrapComplete) {
    return (
      <div className="min-h-screen bg-primary text-text-primary flex flex-col items-center justify-center p-4 animate-fadeIn">
        <div className="w-full max-w-sm bg-secondary p-8 rounded-xl shadow-2xl border border-tertiary/50 text-center">
          <h2 className="text-xl font-bold mb-2">Ripristino sessione</h2>
          <p className="text-text-secondary">Controllo accesso in corso...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <Login users={users} onLoginSuccess={handleLoginSuccess} />;
  }

  const renderContent = () => {
    if (currentView === 'dashboard') {
      if (!isOrganizer && loggedInPlayerId) {
        return (
          <ParticipantDashboard
            events={events}
            playerId={loggedInPlayerId}
            onSelectEvent={handleSelectEvent}
          />
        );
      }
      return (
        <div className="space-y-6 animate-fadeIn">
          <div className="flex justify-between items-center">
            <h2 className="text-3xl font-bold">I Miei Eventi</h2>
            {isOrganizer && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsAdminUsersModalOpen(true)}
                  className="flex items-center gap-2 bg-tertiary hover:bg-tertiary/80 text-text-primary font-bold py-2 px-4 rounded-lg transition-all shadow-lg"
                >
                  Controllo Utenti
                </button>
                <button
                  onClick={() => {
                    resetCreateEventForm();
                    setIsCreateModalOpen(true);
                  }}
                  className="flex items-center gap-2 bg-highlight/80 hover:bg-highlight text-white font-bold py-2 px-4 rounded-lg transition-all shadow-lg"
                >
                  <PlusIcon className="w-5 h-5" />
                  Crea Evento
                </button>
              </div>
            )}
          </div>

          {filteredEventsForOrganizer.length === 0 && (
            <p className="text-text-secondary text-center py-8">Nessun evento creato.</p>
          )}

          {/* Sezione: In corso */}
          {(ongoingEvents.length > 0 || concludedEvents.length > 0) && (
            <div className="space-y-8">
              <div>
                <h3 className="text-lg font-semibold text-text-secondary mb-4 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-400"></span>
                  In corso
                </h3>
                {ongoingEvents.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {ongoingEvents.map(event => {
                      const eventType = getEventType(event);
                      const rankingData = getEventRankingData(event);
                      const rankingTop8 = isRankingEventType(eventType)
                        ? (
                          eventType === 'ranking_padel_individuale'
                            ? calculatePadelIndividualRanking(
                              (event.players ?? []).filter(
                                player => player.status === 'confirmed' && (rankingData.participantIds ?? []).includes(player.id),
                              ),
                              rankingData.matches ?? [],
                            )
                            : calculateSummerRanking(
                              (event.players ?? []).filter(
                                player => player.status === 'confirmed' && (rankingData.participantIds ?? []).includes(player.id),
                              ),
                              rankingData.matches ?? [],
                              normalizeRulesConfig(rankingData.rulesConfig),
                            )
                        ).slice(0, 8)
                        : [];
                      const { totalMatches, completedMatches, completionPercentage } = (() => {
                        if (isRankingEventType(eventType)) {
                          const total = rankingData.matches.length;
                          const completed = rankingData.matches.filter(match => match.status === 'completed').length;
                          return {
                            totalMatches: total,
                            completedMatches: completed,
                            completionPercentage: total > 0 ? Math.round((completed / total) * 100) : 0,
                          };
                        }
                        let total = 0;
                        let completed = 0;
                        event.tournaments.forEach(tournament => {
                          tournament.groups.forEach(group => {
                            total += group.matches.length;
                            completed += group.matches.filter(m => m.status === 'completed').length;
                          });
                        });
                        return {
                          totalMatches: total,
                          completedMatches: completed,
                          completionPercentage: total > 0 ? Math.round((completed / total) * 100) : 0,
                        };
                      })();

                      return (
                        <div key={event.id} className="bg-secondary rounded-xl shadow-lg transition-all duration-300 group relative overflow-hidden flex flex-col">
                          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-accent/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                          <div onClick={() => handleSelectEvent(event)} className="p-6 cursor-pointer flex-grow z-10">
                            <h3 className="text-xl font-bold text-accent truncate">{event.name}</h3>
                            <p className="text-text-secondary mt-2 text-sm">
                              {isRankingEventType(eventType)
                                ? `${getRankingEventLabel(eventType)} • ${(rankingData.participantIds ?? []).length} partecipanti`
                                : eventType === 'tournament_padel'
                                  ? `${event.tournaments.length} tornei • ${event.tournaments.reduce((total, tournament) => total + (tournament.padelTeams?.length ?? 0), 0)} squadre`
                                  : `${event.tournaments.length} tornei • ${event.players.length} giocatori`}
                            </p>
                            {isRankingEventType(eventType) ? (
                              <div className="mt-4 pt-4 border-t border-tertiary/50">
                                <div className="flex justify-between items-center text-sm mb-2">
                                  <span className="text-text-secondary">Top 8 classifica</span>
                                  <span className="font-semibold text-text-primary">{rankingTop8.length} / 8</span>
                                </div>
                                {rankingTop8.length > 0 ? (
                                  <div className="space-y-1.5">
                                    {rankingTop8.map(entry => (
                                      <div key={entry.player.id} className="text-sm flex items-center gap-2">
                                        <span className="text-text-secondary w-6">{entry.rank}.</span>
                                        <span className="text-text-primary flex-1 truncate">{entry.player.name}</span>
                                        <span className="text-text-primary font-semibold">{entry.points} pt</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-text-secondary">Classifica non ancora disponibile.</p>
                                )}
                              </div>
                            ) : (
                              <div className="mt-4 pt-4 border-t border-tertiary/50">
                                <div className="flex justify-between items-center text-sm mb-1">
                                  <span className="text-text-secondary">Progresso</span>
                                  <span className="font-semibold text-text-primary">{completedMatches} / {totalMatches} partite</span>
                                </div>
                                <div className="w-full bg-tertiary/50 rounded-full h-2.5">
                                  <div
                                    className="bg-gradient-to-r from-accent to-highlight h-2.5 rounded-full transition-all duration-500"
                                    style={{ width: `${completionPercentage}%` }}
                                  />
                                </div>
                                <div className="text-right text-xs text-text-secondary mt-1">{completionPercentage}% Completato</div>
                              </div>
                            )}
                          </div>
                          {isOrganizer && (
                            <div className="p-2 flex justify-end gap-1 z-10">
                              <button
                                onClick={(e) => { e.stopPropagation(); openRenameModal(event); }}
                                className="text-text-secondary/50 hover:text-accent transition-colors"
                                title="Modifica nome evento"
                              >
                                <PencilIcon className="w-5 h-5" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setEventToDelete(event); }}
                                className="text-text-secondary/50 hover:text-red-500 transition-colors"
                                title="Elimina evento"
                              >
                                <TrashIcon className="w-5 h-5" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-text-secondary text-sm py-4">Nessun evento in corso.</p>
                )}
              </div>

              {/* Sezione: Conclusi */}
              <div>
                <h3 className="text-lg font-semibold text-text-secondary mb-4 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-tertiary"></span>
                  Conclusi
                </h3>
                {concludedEvents.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {concludedEvents.map(event => {
                      const eventType = getEventType(event);
                      const rankingData = getEventRankingData(event);
                      const rankingTop8 = isRankingEventType(eventType)
                        ? (
                          eventType === 'ranking_padel_individuale'
                            ? calculatePadelIndividualRanking(
                              (event.players ?? []).filter(
                                player => player.status === 'confirmed' && (rankingData.participantIds ?? []).includes(player.id),
                              ),
                              rankingData.matches ?? [],
                            )
                            : calculateSummerRanking(
                              (event.players ?? []).filter(
                                player => player.status === 'confirmed' && (rankingData.participantIds ?? []).includes(player.id),
                              ),
                              rankingData.matches ?? [],
                              normalizeRulesConfig(rankingData.rulesConfig),
                            )
                        ).slice(0, 8)
                        : [];
                      const { totalMatches, completedMatches } = (() => {
                        if (isRankingEventType(eventType)) {
                          const total = rankingData.matches.length;
                          const completed = rankingData.matches.filter(match => match.status === 'completed').length;
                          return { totalMatches: total, completedMatches: completed };
                        }
                        let total = 0;
                        let completed = 0;
                        event.tournaments.forEach(tournament => {
                          tournament.groups.forEach(group => {
                            total += group.matches.length;
                            completed += group.matches.filter(m => m.status === 'completed').length;
                          });
                        });
                        return { totalMatches: total, completedMatches: completed };
                      })();

                      return (
                        <div key={event.id} className="bg-secondary/60 rounded-xl shadow transition-all duration-300 group relative overflow-hidden flex flex-col opacity-80">
                          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-tertiary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                          <div onClick={() => handleSelectEvent(event)} className="p-6 cursor-pointer flex-grow z-10">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <h3 className="text-xl font-bold text-text-primary truncate">{event.name}</h3>
                              <span className="flex-shrink-0 text-xs font-semibold bg-tertiary/60 text-text-secondary px-2 py-0.5 rounded-full">
                                Terminato
                              </span>
                            </div>
                            <p className="text-text-secondary mt-1 text-sm">
                              {isRankingEventType(eventType)
                                ? `${getRankingEventLabel(eventType)} • ${(rankingData.participantIds ?? []).length} partecipanti`
                                : eventType === 'tournament_padel'
                                  ? `${event.tournaments.length} tornei • ${event.tournaments.reduce((total, tournament) => total + (tournament.padelTeams?.length ?? 0), 0)} squadre`
                                  : `${event.tournaments.length} tornei • ${event.players.length} giocatori`}
                            </p>
                            {isRankingEventType(eventType) ? (
                              <div className="mt-4 pt-4 border-t border-tertiary/50">
                                <div className="flex justify-between items-center text-sm mb-2">
                                  <span className="text-text-secondary">Top 8 classifica</span>
                                  <span className="font-semibold text-text-primary">{rankingTop8.length} / 8</span>
                                </div>
                                {rankingTop8.length > 0 ? (
                                  <div className="space-y-1.5">
                                    {rankingTop8.map(entry => (
                                      <div key={entry.player.id} className="text-sm flex items-center gap-2">
                                        <span className="text-text-secondary w-6">{entry.rank}.</span>
                                        <span className="text-text-primary flex-1 truncate">{entry.player.name}</span>
                                        <span className="text-text-primary font-semibold">{entry.points} pt</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-text-secondary">Classifica non ancora disponibile.</p>
                                )}
                              </div>
                            ) : (
                              <div className="mt-4 pt-4 border-t border-tertiary/50">
                                <p className="text-sm text-text-secondary">
                                  {completedMatches} / {totalMatches} partite giocate
                                </p>
                              </div>
                            )}
                          </div>
                          {isOrganizer && (
                            <div className="p-2 flex justify-end gap-1 z-10">
                              <button
                                onClick={(e) => { e.stopPropagation(); openRenameModal(event); }}
                                className="text-text-secondary/50 hover:text-accent transition-colors"
                                title="Modifica nome evento"
                              >
                                <PencilIcon className="w-5 h-5" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setEventToDelete(event); }}
                                className="text-text-secondary/50 hover:text-red-500 transition-colors"
                                title="Elimina evento"
                              >
                                <TrashIcon className="w-5 h-5" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-text-secondary text-sm py-4">Nessun evento concluso.</p>
                )}
              </div>
            </div>
          )}
        </div>
      );
    }


    if (currentView === 'event' && currentEventState) {
      if (getEventType(currentEventState) === 'ranking_singolare') {
        const rankingData = getEventRankingData(currentEventState);
        return (
          <div className="animate-fadeIn">
            <SummerRankingView
              players={currentEventState.players ?? []}
              rankingData={rankingData}
              isOrganizer={isOrganizer}
              loggedInPlayerId={loggedInPlayerId}
              onPlayerContact={setContactPlayer}
              onSaveRankingData={(nextData) => saveEventRankingData(currentEventState.id, 'ranking_singolare', nextData)}
              onUpdatePlayerStartPoints={updatePlayerSummerRankingStartPoints}
              onOpenPlayersAdmin={isOrganizer ? () => setCurrentView('playersAdmin') : undefined}
              title={`${currentEventState.name} • Ranking tennis singolare`}
              description="Classifica, partite, master finale, disponibilità e regolamento di questo evento."
              playersAdminLabel="Apri gestione giocatori evento"
            />
          </div>
        );
      }

      if (getEventType(currentEventState) === 'ranking_padel_individuale') {
        const rankingData = getEventRankingData(currentEventState);
        return (
          <div className="animate-fadeIn">
            <PadelIndividualRankingView
              players={currentEventState.players ?? []}
              rankingData={rankingData}
              isOrganizer={isOrganizer}
              loggedInPlayerId={loggedInPlayerId}
              onSaveRankingData={(nextData) => saveEventRankingData(currentEventState.id, 'ranking_padel_individuale', nextData)}
              onOpenPlayersAdmin={isOrganizer ? () => setCurrentView('playersAdmin') : undefined}
              title={`${currentEventState.name} • Paitone Arena League`}
              description="Campionato individuale di padel con partner liberi, bonus, storico punti e Master finale."
              playersAdminLabel="Apri gestione giocatori evento"
            />
          </div>
        );
      }

      return (
        <div className="animate-fadeIn">
          <EventView
            event={currentEventState}
            onSelectTournament={handleSelectTournament}
            setEvents={setEvents}
            isOrganizer={isOrganizer}
            loggedInPlayerId={loggedInPlayerId}
          />
        </div>
      );
    }

    if (currentView === 'tournament' && currentEventState && currentTournamentState) {
      return (
        <div className="animate-fadeIn">
          <TournamentView
            event={currentEventState}
            tournament={currentTournamentState}
            setEvents={setEvents}
            isOrganizer={isOrganizer}
            loggedInPlayerId={loggedInPlayerId}
            initialActiveTab={tournamentInitialTab}
            initialSelectedGroupId={tournamentInitialGroupId}
            onPlayerContact={setContactPlayer}
          />
        </div>
      );
    }

    if (
      currentView === 'playersAdmin'
      && isOrganizer
      && currentEventState
      && isRankingEventType(getEventType(currentEventState))
    ) {
      return (
        <AdminPlayersView
          players={players}
          events={events}
          rankingEvent={currentEventState}
          setEvents={setEvents}
        />
      );
    }

    return null;
  };

  return (
    <div className="min-h-screen bg-primary text-text-primary p-4 sm:p-6 lg:p-8">
      <header className="mb-8">
        <div className="max-w-7xl mx-auto flex justify-between items-center gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <NextTsBrandIcon className="w-28 sm:w-36 lg:w-44 h-auto flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight truncate">Tournament Manager Pro</h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-text-secondary hidden sm:block">
              Accesso come: <strong className="text-text-primary">{currentUser.username}</strong>
            </span>

            <button
                onClick={() => setIsProfileModalOpen(true)}
                className="relative group focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full"
                title="Modifica profilo"
                aria-label="Apri profilo"
              >
                {(() => {
                  const playerAvatar = loggedInPlayerId
                    ? events.flatMap(ev => ev.players ?? []).find(p => p.id === loggedInPlayerId)?.avatar
                    : undefined;
                  return playerAvatar ? (
                    <img
                      src={playerAvatar}
                      alt="Il tuo avatar"
                      className="w-8 h-8 rounded-full object-cover border-2 border-transparent group-hover:border-accent transition-colors"
                    />
                  ) : (
                    <UserCircleIcon className="w-7 h-7 text-text-secondary group-hover:text-text-primary transition-colors" />
                  );
                })()}
              </button>

            <button onClick={handleLogout} className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors">
              <LogoutIcon className="w-6 h-6" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto">
        {currentView !== 'dashboard' && (
          <button onClick={navigateBack} className="flex items-center gap-2 text-accent-hover hover:text-accent font-semibold mb-6 transition-colors">
            <BackArrowIcon className="w-5 h-5" />
            <span>Indietro</span>
          </button>
        )}

        {renderContent()}
      </main>

      {contactPlayer && (
        <ContactModal player={contactPlayer} onClose={() => setContactPlayer(null)} />
      )}

      {isProfileModalOpen && (
        <EditProfileModal
          user={currentUser}
          users={users}
          setUsers={setUsers}
          events={events}
          setEvents={setEvents}
          initialTab="avatar"
          onClose={() => setIsProfileModalOpen(false)}
        />
      )}

      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-sm border border-tertiary">
            <h4 className="text-lg font-bold mb-4">Crea Nuovo Evento</h4>
            <form onSubmit={handleCreateEvent} className="space-y-4">
              <input
                type="text"
                placeholder="Nome dell'evento"
                value={newEventName}
                onChange={e => setNewEventName(e.target.value)}
                className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary focus:ring-2 focus:ring-accent focus:border-accent"
                autoFocus
              />
              <div>
                <label htmlFor="event-type" className="block text-sm text-text-secondary mb-1">Tipo evento</label>
                <select
                  id="event-type"
                  value={newEventType}
                  onChange={event => setNewEventType(event.target.value as EventType)}
                  className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary focus:ring-2 focus:ring-accent focus:border-accent"
                >
                  <option value="ranking_singolare">Ranking tennis singolare</option>
                  <option value="ranking_padel_individuale">Paitone Arena League</option>
                  <option value="tournament_singolare">Torneo tennis singolare</option>
                  <option value="tournament_padel">Torneo di padel</option>
                </select>
              </div>
              {createEventError && (
                <p className="text-sm text-red-400" role="alert">
                  {createEventError}
                </p>
              )}
              <div className="flex justify-end gap-4 mt-6">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  disabled={isCreatingEvent}
                  className="bg-tertiary hover:bg-tertiary/80 text-text-primary font-bold py-2 px-4 rounded-lg transition-colors"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={isCreatingEvent}
                  className="bg-highlight hover:bg-highlight/80 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg transition-colors"
                >
                  {isCreatingEvent ? 'Creazione...' : 'Crea Evento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {eventToRename && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-md border border-tertiary">
            <h4 className="text-lg font-bold mb-4">Modifica Nome Evento</h4>
            <form onSubmit={handleRenameEvent}>
              <label htmlFor="rename-event-input" className="block text-sm text-text-secondary mb-1">
                Nuovo nome
              </label>
              <input
                id="rename-event-input"
                type="text"
                value={renameEventName}
                onChange={e => { setRenameEventName(e.target.value); setRenameEventError(null); }}
                className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary focus:ring-2 focus:ring-accent focus:border-accent"
                autoFocus
                disabled={isRenamingEvent}
              />
              {renameEventError && (
                <p className="text-sm text-red-400 mt-2" role="alert">{renameEventError}</p>
              )}
              <div className="flex justify-end gap-4 mt-6">
                <button
                  type="button"
                  onClick={closeRenameModal}
                  disabled={isRenamingEvent}
                  className="bg-tertiary hover:bg-tertiary/80 text-text-primary font-bold py-2 px-4 rounded-lg transition-colors"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={isRenamingEvent}
                  className="bg-highlight hover:bg-highlight/80 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg transition-colors"
                >
                  {isRenamingEvent ? 'Salvataggio...' : 'Salva'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {eventToDelete && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-md border border-tertiary">
            <h4 className="text-lg font-bold mb-4">Conferma Eliminazione</h4>
            <p className="text-text-secondary">
              Sei sicuro di voler eliminare l'evento "{eventToDelete.name}"? Tutti i tornei, gironi e risultati associati verranno persi definitivamente.
            </p>
            <div className="flex justify-end gap-4 mt-6">
              <button onClick={() => setEventToDelete(null)} className="bg-tertiary hover:bg-tertiary/80 text-text-primary font-bold py-2 px-4 rounded-lg transition-colors">
                Annulla
              </button>
              <button onClick={handleDeleteEvent} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                Elimina Evento
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdminUsersModalOpen && isOrganizer && (
        <AdminUsersModal
          users={users}
          onClose={() => setIsAdminUsersModalOpen(false)}
        />
      )}
    </div>
  );
};

export default App;
