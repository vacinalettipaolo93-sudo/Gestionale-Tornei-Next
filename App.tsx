import { updatePlayerEverywhere } from './utils/updatePlayerProfile';
// App.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AdminPlayersView from './components/AdminPlayersView';
import AdminUsersModal from './components/AdminUsersModal';
import ContactModal from './components/ContactModal';
import EditProfileModal from './components/EditProfileModal';
import EventView from './components/EventView';
import ExpiredSlotCleanup from './components/ExpiredSlotCleanup';
import { BackArrowIcon, LogoutIcon, NextTsBrandIcon, PencilIcon, PlusIcon, TrashIcon, UserCircleIcon } from './components/Icons';
import Login from './components/Login';
import PadelIndividualRankingView from './components/PadelIndividualRankingView';
import ParticipantDashboard from './components/ParticipantDashboard';
import SummerRankingView from './components/SummerRankingView';
import TournamentView from './components/TournamentView';
import { useSectionScroll } from './components/useSectionScroll';
import { saveRankingChanges } from './services/rankingDataService';
import { type Event, type Player, type SummerRankingData, type Tournament, type User } from './types';

import { addDoc, collection, deleteDoc, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import {
  EVENT_SPORTS, filterAdminEvents, getConcludedYears, getEventYear,
  type EventCategory, type EventPhase,
} from './utils/adminEventFilters';
import { clearPersistedAuthSession, getAuthSessionStorage, persistAuthSession, resolvePersistedAuthUser } from './utils/authSession.js';
import { calculatePadelIndividualRanking } from './utils/padelIndividualRanking';
import {
  createEmptyRankingData,
  getEventType,
  getRankingEventLabel,
  isRankingEventType,
  normalizeRankingData
} from './utils/rankingEvent';
import { calculateSummerRanking, normalizeRulesConfig } from './utils/summerRanking';

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

const readAdminFilters = () => {
  const params = new URLSearchParams(window.location.search);
  const sport = params.get('sport');
  const category = params.get('category');
  const phase = params.get('phase');
  return {
    sport: EVENT_SPORTS.find(option => option.value === sport)?.value ?? null,
    category: (category === 'ranking' || category === 'tournament' ? category : 'all') as EventCategory,
    phase: (phase === 'concluded' ? 'concluded' : 'ongoing') as EventPhase,
    year: params.get('year') ?? 'all',
  };
};

const App: React.FC = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [eventsError, setEventsError] = useState(false);
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  const [syncPending, setSyncPending] = useState<Record<string, boolean>>({});
  const [adminFilters, setAdminFilters] = useState(readAdminFilters);
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
  const mainRef = useSectionScroll(`${currentUser?.id}:${currentView}:${selectedEvent?.id}:${selectedTournament?.id}`);

  const changeAdminFilters = (next: typeof adminFilters) => {
    setAdminFilters(next);
    const url = new URL(window.location.href);
    for (const key of ['sport', 'category', 'phase', 'year']) url.searchParams.delete(key);
    if (next.sport) url.searchParams.set('sport', next.sport);
    if (next.category !== 'all') url.searchParams.set('category', next.category);
    if (next.phase !== 'ongoing') url.searchParams.set('phase', next.phase);
    if (next.phase === 'concluded' && next.year !== 'all') url.searchParams.set('year', next.year);
    window.history.pushState(null, '', url);
  };

  useEffect(() => {
    const onPopState = () => setAdminFilters(readAdminFilters());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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
    const reportSnapshot = (source: string, metadata: { hasPendingWrites: boolean; fromCache: boolean }) => {
      setSyncErrors(previous => ({ ...previous, [source]: '' }));
      setSyncPending(previous => ({ ...previous, [source]: metadata.hasPendingWrites || metadata.fromCache }));
      return !metadata.hasPendingWrites;
    };
    const reportError = (source: string, error: unknown) => {
      console.error(`Errore sincronizzazione ${source}`, error);
      setSyncErrors(previous => ({ ...previous, [source]: `Sincronizzazione ${source} interrotta. Ricarica la pagina per riprovare.` }));
    };
    const unsubEvents = onSnapshot(collection(db, "events"), { includeMetadataChanges: true }, snapshot => {
      if (!reportSnapshot('eventi', snapshot.metadata)) return;
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
      setEventsError(false);
      setEventsLoaded(true);
    }, error => {
      console.error('Errore lettura eventi', error);
      reportError('eventi', error);
      setEventsError(true);
      setEventsLoaded(true);
    });
    const unsubPlayers = onSnapshot(collection(db, "players"), { includeMetadataChanges: true }, snapshot => {
      if (!reportSnapshot('giocatori', snapshot.metadata)) return;
      setPlayers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Player)));
    }, error => reportError('giocatori', error));
    const unsubUsers = onSnapshot(
      collection(db, "users"),
      { includeMetadataChanges: true },
      snapshot => {
        if (!reportSnapshot('utenti', snapshot.metadata)) return;
        // Do not invalidate a persisted session using an incomplete offline cache.
        if (snapshot.metadata.fromCache) return;
        setUsers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as User)));
        setIsUsersLoaded(true);
      },
      error => {
        reportError('utenti', error);
      },
    );

    const unsubLegacy = onSnapshot(doc(db, "summerRankingNext", "main"), snapshot => {
      setLegacySummerRanking(snapshot.exists() ? normalizeRankingData(snapshot.data() as SummerRankingData, 'ranking_singolare') : null);
    }, error => {
      console.error('Errore lettura fallback Summer Ranking Next', error);
    });

    return () => {
      unsubEvents();
      unsubPlayers();
      unsubUsers();
      unsubLegacy();
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
    const event = events.find(item => item.id === eventId);
    if (!event) throw new Error('Evento non trovato.');
    await saveRankingChanges(eventId, eventType, event.rankingData ?? createEmptyRankingData(eventType),
      nextData, { isOrganizer, playerId: loggedInPlayerId });
  };

  const updatePlayerSummerRankingStartPoints = async (playerId: string, points: number) => {
      const player = players.find(item => item.id === playerId);
      await updatePlayerEverywhere(playerId, {
        summerRankingStartPoints: points, summerRankingJoinedAt: player?.summerRankingJoinedAt ?? new Date().toISOString(),
      });
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
      try {
        await deleteDoc(doc(db, "events", eventToDelete.id));
        if (selectedEvent?.id === eventToDelete.id) {
          setSelectedEvent(null); setSelectedTournament(null); setCurrentView('dashboard');
        }
        setEventToDelete(null);
      } catch (error) {
        console.error('Errore eliminazione evento', error);
        alert("Evento non eliminato. Controlla la connessione e riprova.");
      }
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

  useEffect(() => {
    if (!eventsLoaded || eventsError || syncPending.eventi) return;
    if (selectedEvent && !currentEventState) resetNavigationState();
    else if (currentView === 'tournament' && selectedTournament && !currentTournamentState) {
      setSelectedTournament(null);
      setCurrentView('event');
    }
  }, [eventsLoaded, eventsError, syncPending.eventi, selectedEvent, selectedTournament, currentEventState, currentTournamentState, currentView, resetNavigationState]);

  const filteredEventsForOrganizer = useMemo(() =>
    isOrganizer && adminFilters.sport
      ? filterAdminEvents(events, adminFilters.sport, adminFilters.category, adminFilters.phase)
      : [],
  [events, isOrganizer, adminFilters]);
  const concludedYears = useMemo(() => getConcludedYears(filteredEventsForOrganizer), [filteredEventsForOrganizer]);
  const visibleEvents = useMemo(() => filteredEventsForOrganizer.filter(event =>
    adminFilters.phase !== 'concluded' || adminFilters.year === 'all'
      || (adminFilters.year === 'unknown'
        ? getEventYear(event) === null
        : getEventYear(event) === Number(adminFilters.year))
  ), [filteredEventsForOrganizer, adminFilters]);
  const ongoingEvents = adminFilters.phase === 'ongoing' ? visibleEvents : [];
  const concludedEvents = adminFilters.phase === 'concluded' ? visibleEvents : [];
  const syncNotice = Object.values(syncErrors).some(Boolean) ? (
    <div role="alert" className="bg-red-900/40 border border-red-400 rounded-lg p-3 mb-4">
      {Object.values(syncErrors).filter(Boolean).map(message => <p key={message}>{message}</p>)}
      <button type="button" onClick={() => window.location.reload()} className="underline mt-2">Riprova sincronizzazione</button>
    </div>
  ) : Object.values(syncPending).some(Boolean) && (
    <p role="status" className="bg-secondary rounded-lg p-3 mb-4">
      Sincronizzazione Firebase in corso. I dati potrebbero non essere ancora aggiornati; attendi la conferma dei salvataggi.
    </p>
  );

  if (!isAuthBootstrapComplete) {
    return (
      <div className="min-h-screen bg-primary text-text-primary flex flex-col items-center justify-center p-4 animate-fadeIn">
        {syncNotice}
        <div className="w-full max-w-sm bg-secondary p-8 rounded-xl shadow-2xl border border-tertiary/50 text-center">
          <h2 className="text-xl font-bold mb-2">Ripristino sessione</h2>
          <p className="text-text-secondary">Controllo accesso in corso...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <>{syncNotice}<Login users={users} onLoginSuccess={handleLoginSuccess} /></>;
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
          <div className="flex flex-wrap justify-between items-center gap-3">
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

          {isOrganizer && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2" aria-label="Disciplina">
                {EVENT_SPORTS.map(option => (
                  <button key={option.value} type="button" aria-pressed={adminFilters.sport === option.value}
                    onClick={() => changeAdminFilters({ ...adminFilters, sport: option.value, year: 'all' })}
                    className={`rounded-lg px-5 py-2 font-semibold transition-colors ${adminFilters.sport === option.value ? 'bg-accent text-primary' : 'bg-secondary text-text-secondary hover:text-text-primary'}`}>
                    {option.label}
                  </button>
                ))}
              </div>
              {adminFilters.sport && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex gap-2" aria-label="Stato eventi">
                    {([['ongoing', 'In corso'], ['concluded', 'Conclusi']] as const).map(([value, label]) => (
                      <button key={value} type="button" aria-pressed={adminFilters.phase === value}
                        onClick={() => changeAdminFilters({ ...adminFilters, phase: value, year: 'all' })}
                        className={`rounded-lg px-4 py-2 font-semibold ${adminFilters.phase === value ? 'bg-highlight text-white' : 'bg-secondary text-text-secondary hover:text-text-primary'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="text-sm text-text-secondary">
                    Tipo
                    <select value={adminFilters.category} onChange={e => changeAdminFilters({ ...adminFilters, category: e.target.value as EventCategory, year: 'all' })}
                      className="block mt-1 bg-secondary border border-tertiary text-text-primary rounded-lg px-3 py-2">
                      <option value="all">Tutti i tipi</option>
                      <option value="ranking">{adminFilters.sport === 'tennis' ? 'Summer Ranking' : 'Paitone Arena League'}</option>
                      <option value="tournament">Tornei standard</option>
                    </select>
                  </label>
                  {adminFilters.phase === 'concluded' && (
                    <label className="text-sm text-text-secondary">
                      Anno di conclusione
                      <select value={adminFilters.year} onChange={e => changeAdminFilters({ ...adminFilters, year: e.target.value })}
                        className="block mt-1 bg-secondary border border-tertiary text-text-primary rounded-lg px-3 py-2">
                        <option value="all">Tutti gli anni</option>
                        {concludedYears.map(year => <option key={year} value={year}>{year}</option>)}
                        {filteredEventsForOrganizer.some(event => getEventYear(event) === null) && <option value="unknown">Anno non disponibile</option>}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </div>
          )}
          {isOrganizer && !adminFilters.sport && (
            <p className="text-text-secondary text-center py-8">Scegli Tennis o Padel per visualizzare i tornei.</p>
          )}
          {isOrganizer && adminFilters.sport && !eventsLoaded && (
            <p className="text-text-secondary text-center py-8" role="status">Caricamento eventi...</p>
          )}
          {isOrganizer && adminFilters.sport && eventsError && (
            <p className="text-red-300 text-center py-8" role="alert">Impossibile caricare gli eventi. Riprova aggiornando la pagina.</p>
          )}

          {/* Sezione: In corso */}
          {isOrganizer && adminFilters.sport && eventsLoaded && !eventsError && (
            <div className="space-y-8">
              {adminFilters.phase === 'ongoing' && <div>
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
                              rankingData.rulesConfig,
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
                          (tournament.groups ?? []).forEach(group => {
                            const matches = group.matches ?? [];
                            total += matches.length;
                            completed += matches.filter(m => m.status === 'completed').length;
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
                  <p className="text-text-secondary text-sm py-4">Nessun evento in corso per i filtri selezionati.</p>
                )}
              </div>}

              {/* Sezione: Conclusi */}
              {adminFilters.phase === 'concluded' && <div>
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
                              rankingData.rulesConfig,
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
                          (tournament.groups ?? []).forEach(group => {
                            const matches = group.matches ?? [];
                            total += matches.length;
                            completed += matches.filter(m => m.status === 'completed').length;
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
                            <p className="text-xs text-text-secondary mt-1">
                              {getEventYear(event) ?? 'Anno non disponibile'}
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
                  <p className="text-text-secondary text-sm py-4">Nessun evento concluso per i filtri selezionati.</p>
                )}
              </div>}
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
              onPlayerContact={setContactPlayer}
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
            players={players}
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
          isOrganizer={isOrganizer}
        />
      );
    }

    return null;
  };

  return (
    <div className="min-h-screen min-w-0 bg-primary text-text-primary p-3 sm:p-6 lg:p-8">
      {syncNotice}
      {events.filter(event => isOrganizer || event.players.some(player => player.id === loggedInPlayerId)).map(event => (
        <ExpiredSlotCleanup key={event.id} event={event} isOrganizer={isOrganizer} playerId={loggedInPlayerId} />
      ))}
      <header className="mb-8">
        <div className="max-w-7xl mx-auto flex justify-between items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <NextTsBrandIcon className="w-14 sm:w-36 lg:w-44 h-auto flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base sm:text-2xl lg:text-3xl font-bold tracking-tight">Tournament Manager Pro</h1>
            </div>
          </div>

          <div className="flex items-center shrink-0 gap-2 sm:gap-4">
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

            <button onClick={handleLogout} aria-label="Esci" className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors">
              <LogoutIcon className="w-6 h-6" />
            </button>
          </div>
        </div>
      </header>

      <main ref={mainRef} className="min-w-0 max-w-7xl mx-auto scroll-mt-4">
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
          players={players}
          onClose={() => setIsAdminUsersModalOpen(false)}
        />
      )}
    </div>
  );
};

export default App;
