import React, { useEffect, useState } from 'react';
import { saveEventChanges } from '../services/eventDataService';
import { type Event, type Player, type Tournament } from '../types';
import { TOURNAMENT_VENUES, type TournamentVenueId } from '../utils/tournamentVenues';
import AdminMatchCounts from "./AdminMatchCounts";
import BookedVenueSlots from './BookedVenueSlots';
import EventPlayersView from './EventPlayersView';
import { PlusIcon, TrashIcon } from './Icons';
import RegolamentoGironiPanel from './RegolamentoGironiPanel';
import TournamentVenueSlots from './TournamentVenueSlots';
import { useSyncedDraft } from './usePersistenceAction';
import { useSectionScroll } from './useSectionScroll';

interface EventViewProps {
  event: Event;
  // accept optional initial tab and groupId when invoked
  onSelectTournament: (
    tournament: Tournament,
    initialTab?: 'standings' | 'matches' | 'participants' | 'playoffs' | 'consolation' | 'groups' | 'settings' | 'rules' | 'players' | 'availability',
    initialGroupId?: string
  ) => void;
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  isOrganizer: boolean;
  loggedInPlayerId?: string;
  players: Player[];
}

const makeId = () => `${Date.now()}${Math.floor(Math.random() * 10000)}`;

type AdminEventSection = 'tournaments' | 'players' | 'rules' | 'groupRules' | 'matchControl' | 'bookedSlots' | TournamentVenueId;

const EventView: React.FC<EventViewProps> = ({
  event,
  onSelectTournament,
  setEvents,
  isOrganizer,
  loggedInPlayerId,
  players,
}) => {
  const [rulesDraft, setRulesDraft, baselineRules] = useSyncedDraft(event.rules, event.id);
  const [rulesEdit, setRulesEdit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // state per "Aggiungi Torneo"
  const [isAddTournamentOpen, setIsAddTournamentOpen] = useState(false);
  const [newTournamentName, setNewTournamentName] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // state per "Modifica Torneo"
  const [editingTournament, setEditingTournament] = useState<Tournament | null>(null);
  const [editTournamentName, setEditTournamentName] = useState<string>('');
  const [editTournamentLoading, setEditTournamentLoading] = useState<boolean>(false);
  const [activeAdminSection, setActiveAdminSection] = useState<AdminEventSection>('tournaments');
  const sectionRef = useSectionScroll(`${event.id}:${activeAdminSection}`);

  useEffect(() => {
    if (!isOrganizer) return;
    setActiveAdminSection('tournaments');
  }, [event.id, isOrganizer]);

  const handleSaveRules = async () => {
    setLoading(true);
    try {
      await saveEventChanges({ ...event, rules: baselineRules }, {
        rules: rulesDraft ?? ''
      });
      setSuccessMsg("Regolamento salvato!");
      setRulesEdit(false);
      setTimeout(() => setSuccessMsg(""), 2500);
    } catch (err) {
      console.error("Errore salvataggio regolamento", err);
      alert(err instanceof Error ? err.message : 'Regolamento non salvato. Riprova.');
    } finally {
      setLoading(false);
    }
  };

  // default settings used when creating new tournament (kept minimal)
  const defaultTournamentSettings = {
    pointsPerDraw: 1,
    pointRules: [],
    tieBreakers: ['wins', 'goalDifference', 'headToHead', 'goalsFor'],
    playoffSettings: [],
    consolationSettings: [],
    hasBronzeFinal: false,
  };

  const openAddTournament = () => {
    setAddError(null);
    setNewTournamentName("");
    setIsAddTournamentOpen(true);
  };

  const cancelAddTournament = () => {
    setIsAddTournamentOpen(false);
    setNewTournamentName("");
    setAddError(null);
  };

  const handleAddTournament = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAddError(null);
    if (!newTournamentName.trim()) {
      setAddError("Inserisci il nome del torneo.");
      return;
    }

    setAddLoading(true);
    try {
      const isPadelEvent = event.eventType === 'tournament_padel';
      const newTournament: Tournament = {
        id: makeId(),
        name: newTournamentName.trim(),
        groups: [],
        ...(isPadelEvent ? { padelTeams: [] } : {}),
        timeSlots: [],
        playoffs: null,
        consolationBracket: null,
        playoffMatches: [],
        consolationMatches: [],
        settings: { ...defaultTournamentSettings } as any,
      };

      await saveEventChanges(event, {
        tournaments: (event.tournaments ?? []).concat(newTournament)
      });

      setIsAddTournamentOpen(false);
      setNewTournamentName("");
    } catch (err: any) {
      console.error("Errore creazione torneo", err);
      setAddError(err?.message || "Errore durante la creazione del torneo");
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteTournament = async (tournamentId: string) => {
    if (!confirm("Sei sicuro di voler eliminare questo torneo?")) return;
    try {
      const updatedTournaments = (event.tournaments ?? []).filter(t => t.id !== tournamentId);
      await saveEventChanges(event, {
        tournaments: updatedTournaments
      });
    } catch (err) {
      console.error("Errore eliminazione torneo", err);
      alert(err instanceof Error ? err.message : 'Torneo non eliminato. Riprova.');
    }
  };

  // --- NEW: edit tournament handlers ---
  const openEditTournament = (t: Tournament) => {
    setEditingTournament(t);
    setEditTournamentName(t.name);
  };

  const closeEditTournamentModal = () => {
    setEditingTournament(null);
    setEditTournamentName('');
    setEditTournamentLoading(false);
  };

  const handleSaveEditTournament = async () => {
    if (!editingTournament) return;
    setEditTournamentLoading(true);
    try {
      const updatedTournaments = (event.tournaments ?? []).map(t =>
        t.id === editingTournament.id ? { ...t, name: editTournamentName.trim() } : t
      );

      await saveEventChanges({
        ...event, tournaments: event.tournaments.map(t => t.id === editingTournament.id ? { ...t, name: editingTournament.name } : t),
      }, {
        tournaments: updatedTournaments
      });

      closeEditTournamentModal();
    } catch (err) {
      console.error('Errore salvataggio nome torneo', err);
      setEditTournamentLoading(false);
      alert('Errore durante il salvataggio del torneo.');
    }
  };

  // Helper: count total and completed matches inside a tournament by scanning its groups
  const countMatchesForTournament = (t: Tournament) => {
    let total = 0;
    let completed = 0;
    (t.groups ?? []).forEach(group => {
      (group.matches ?? []).forEach((m: any) => {
        total++;
        // consider match completed if both scores are present or status indicates finished
        const isComplete = (m.score1 != null && m.score2 != null) || m.status === 'finished' || m.status === 'completed';
        if (isComplete) completed++;
      });
    });
    return { total, completed };
  };

  // helper: find player's group id in a tournament (if any)
  const getPlayerGroupId = (t: Tournament, playerId?: string) => {
    if (!playerId) return undefined;
    const g = (t.groups || []).find(gr => (gr.playerIds || []).includes(playerId));
    return g?.id;
  };

  return (
    <div ref={sectionRef} className="min-w-0 scroll-mt-4">
      <div className="bg-primary p-6 rounded-xl shadow-lg mb-6">
        <div className="flex flex-wrap justify-between items-start gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-bold text-white mb-1">{event.name}</h1>
            <div className="text-sm text-text-secondary">
              Codice Invito: <span className="font-bold text-accent">{event.invitationCode}</span>
            </div>
          </div>

          {isOrganizer && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={openAddTournament}
                className="bg-accent px-5 py-2 rounded-lg text-white font-bold hover:bg-accent/80 shadow transition-all flex items-center gap-2"
              >
                <PlusIcon className="w-4 h-4" />
                + Aggiungi Torneo
              </button>
            </div>
          )}
        </div>

        {/* ===== Top admin menu (only organizers) ===== */}
        {isOrganizer && (
          <nav className="mt-6 bg-secondary/20 rounded p-3 flex flex-wrap gap-2" aria-label="Menu amministratore evento">
            <button
              className={`px-3 py-1 rounded text-text-primary text-sm transition-colors ${activeAdminSection === 'tournaments' ? 'bg-accent text-white' : 'bg-tertiary hover:bg-tertiary/90'}`}
              onClick={() => setActiveAdminSection('tournaments')}
            >
              Tornei
            </button>

            <button
              className={`px-3 py-1 rounded text-text-primary text-sm transition-colors ${activeAdminSection === 'players' ? 'bg-accent text-white' : 'bg-tertiary hover:bg-tertiary/90'}`}
              onClick={() => setActiveAdminSection('players')}
            >
              Lista giocatori
            </button>
            {TOURNAMENT_VENUES.map(venue => (
              <button
                key={venue.id}
                className={`px-3 py-1 rounded text-text-primary text-sm transition-colors ${activeAdminSection === venue.id ? 'bg-accent text-white' : 'bg-tertiary hover:bg-tertiary/90'}`}
                onClick={() => setActiveAdminSection(venue.id)}
              >
                Prenota campo {venue.name}
              </button>
            ))}

            <button
              className={`px-3 py-1 rounded text-text-primary text-sm transition-colors ${activeAdminSection === 'bookedSlots' ? 'bg-accent text-white' : 'bg-tertiary hover:bg-tertiary/90'}`}
              onClick={() => setActiveAdminSection('bookedSlots')}
            >
              Prenotazioni partite
            </button>

            <button
              className={`px-3 py-1 rounded text-text-primary text-sm transition-colors ${activeAdminSection === 'rules' ? 'bg-accent text-white' : 'bg-tertiary hover:bg-tertiary/90'}`}
              onClick={() => setActiveAdminSection('rules')}
            >
              Regolamento torneo
            </button>

            <button
              className={`px-3 py-1 rounded text-text-primary text-sm transition-colors ${activeAdminSection === 'groupRules' ? 'bg-accent text-white' : 'bg-tertiary hover:bg-tertiary/90'}`}
              onClick={() => setActiveAdminSection('groupRules')}
            >
              Regolamento gironi
            </button>

            <button
              className={`px-3 py-1 rounded text-text-primary text-sm transition-colors ${activeAdminSection === 'matchControl' ? 'bg-accent text-white' : 'bg-tertiary hover:bg-tertiary/90'}`}
              onClick={() => setActiveAdminSection('matchControl')}
            >
              Controllo partite
            </button>
          </nav>
        )}
      </div>

      {/* CARD TORNEI */}
      {(!isOrganizer || activeAdminSection === 'tournaments') && (
      <div>
        <h2 className="text-2xl font-bold text-white mb-4">Tornei</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(event.tournaments ?? []).map(tournament => {
            const { total, completed } = countMatchesForTournament(tournament);
            const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

            // Determina se il giocatore loggato è assegnato a questo torneo (in uno dei suoi gironi)
            const isMyTournament = !!(loggedInPlayerId && (tournament.groups || []).some(g => (g.playerIds || []).includes(loggedInPlayerId)));
            const myGroupId = getPlayerGroupId(tournament, loggedInPlayerId);

            // conditional classes for highlight
            const cardBase = 'p-4 rounded-xl flex flex-col justify-between transition-all duration-300';
            const highlightClasses = 'bg-gradient-to-br from-indigo-700 to-indigo-600 ring-2 ring-accent transform scale-[1.01]';
            const normalClasses = 'bg-secondary';
            const cardClasses = `${cardBase} ${isMyTournament ? highlightClasses : normalClasses}`;

            const titleClass = `text-xl font-bold mb-2 ${isMyTournament ? 'text-white' : 'text-accent'}`;

            return (
              <div key={tournament.id} className={cardClasses}>
                <div>
                  <div className="flex justify-between items-start">
                    <h3 className={titleClass}>{tournament.name}</h3>
                    {isOrganizer && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditTournament(tournament)}
                          className="text-text-secondary/80 hover:text-text-primary p-1 rounded"
                          title="Modifica nome torneo"
                        >
                          Modifica
                        </button>
                        <button
                          onClick={() => handleDeleteTournament(tournament.id)}
                          className="text-text-secondary/60 hover:text-red-500 p-1 rounded"
                          title="Elimina torneo"
                        >
                          <TrashIcon className="w-5 h-5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* quick buttons: open tournament directly on specific tab (pass optional groupId when relevant) */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => onSelectTournament(tournament, 'matches', myGroupId)}
                      className="text-sm bg-tertiary/60 text-white px-3 py-1 rounded hover:bg-tertiary transition"
                      title="Apri il tab Partite"
                    >
                      Partite
                    </button>
                    <button
                      onClick={() => onSelectTournament(tournament, 'standings', myGroupId)}
                      className="text-sm bg-tertiary/60 text-white px-3 py-1 rounded hover:bg-tertiary transition"
                      title="Apri il tab Classifica"
                    >
                      Classifica
                    </button>
                    <button
                      onClick={() => onSelectTournament(tournament, 'participants')}
                      className="text-sm bg-tertiary/60 text-white px-3 py-1 rounded hover:bg-tertiary transition"
                      title="Apri il tab Partecipanti"
                    >
                      Partecipanti
                    </button>
                    <button
                      onClick={() => onSelectTournament(tournament, 'playoffs')}
                      className="text-sm bg-tertiary/60 text-white px-3 py-1 rounded hover:bg-tertiary transition"
                      title="Apri il tab Playoff"
                    >
                      Playoff
                    </button>
                    <button
                      onClick={() => onSelectTournament(tournament, 'consolation')}
                      className="text-sm bg-tertiary/60 text-white px-3 py-1 rounded hover:bg-tertiary transition"
                      title="Apri il tab Consolazione"
                    >
                      Consolazione
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onSelectTournament(tournament, 'availability'); }}
                      className="px-3 py-1 rounded-md bg-tertiary text-text-primary text-sm font-semibold hover:bg-tertiary/90 transition"
                    >
                      Disponibilità di Gioco
                    </button>
                  </div>

                  <div className="flex items-center gap-3 mb-2 mt-4">
                    <span className="text-sm text-text-secondary">
                      {tournament.groups?.length ?? 0} gironi
                    </span>
                  </div>
                  <div className="text-sm text-text-secondary mb-2">
                    Progresso
                  </div>
                  <div className="w-full bg-tertiary/30 h-2 rounded-full mb-2">
                    <div className="bg-accent h-2 rounded-full transition-all duration-300" style={{ width: `${percent}%` }}></div>
                  </div>
                  <div className="text-xs text-text-secondary mb-2 flex items-center justify-between">
                    <span>{completed} / {total} partite</span>
                    <span>{percent}% Completato</span>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => onSelectTournament(tournament)}
                    className={`text-white py-2 px-4 rounded-lg font-bold ${isMyTournament ? 'bg-highlight/90 hover:bg-highlight' : 'bg-accent'}`}
                  >
                    Visualizza Torneo
                  </button>
                  {isMyTournament && (
                    <span className="ml-auto inline-block bg-green-600 text-white text-xs font-semibold px-2 py-1 rounded">
                      Il mio torneo
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {isOrganizer && activeAdminSection === 'players' && (
        <EventPlayersView
          event={event}
          players={players}
          setEvents={setEvents}
          isOrganizer={isOrganizer}
        />
      )}
      {isOrganizer && (activeAdminSection === 'canottieri-salo' || activeAdminSection === 'paitone-arena') && (
        <TournamentVenueSlots key={event.id} event={event} venueId={activeAdminSection} />
      )}
      {isOrganizer && activeAdminSection === 'bookedSlots' && (
        <BookedVenueSlots event={event} />
      )}

      {/* REGOLAMENTO (solo organizzatore) */}
      {(!isOrganizer || activeAdminSection === 'rules') && (
      <div className="bg-tertiary p-6 rounded-xl shadow-lg mb-6" id="regolamento">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-xl font-bold text-accent">Regolamento Torneo</h3>
          {!rulesEdit && isOrganizer && (
            <button
              onClick={() => setRulesEdit(true)}
              className="py-1 px-4 bg-highlight text-white rounded-lg font-semibold"
            >
              Modifica
            </button>
          )}
        </div>
        {rulesEdit ? (
          <div>
            <textarea
              value={rulesDraft ?? ''}
              onChange={(e) => setRulesDraft(e.target.value)}
              className="w-full rounded bg-primary border p-3 min-h-[120px] mb-3"
              placeholder="Scrivi qui il regolamento per il girone selezionato..."
              disabled={loading}
            />
            <div className="flex items-center gap-3">
              <button onClick={handleSaveRules} disabled={loading} className="bg-highlight text-white px-4 py-2 rounded font-bold">
                {loading ? "Salvando..." : "Salva regolamento per girone"}
              </button>
              <button onClick={() => { setRulesEdit(false); setRulesDraft(event.rules ?? ""); }} className="bg-tertiary px-4 py-2 rounded">
                Annulla
              </button>
            </div>
            {successMsg && <div className="text-green-600 mt-3 font-semibold">{successMsg}</div>}
          </div>
        ) : (
          <div className="bg-primary p-4 rounded-lg border border-tertiary mt-2 whitespace-pre-line">
            {event.rules?.trim() ? event.rules : <span className="text-text-secondary">Nessun regolamento inserito dall'organizzatore.</span>}
          </div>
        )}
      </div>
      )}

      {/* REGOLAMENTO PER OGNI GIRONE - SOLO ORGANIZZATORE */}
      {isOrganizer && activeAdminSection === 'groupRules' && (event.tournaments ?? []).length > 0 &&
        (event.tournaments ?? []).map(tournament => (
          <RegolamentoGironiPanel
            key={tournament.id}
            event={event}
            tournament={tournament}
            setEvents={setEvents}
          />
        ))
      }

      {/* ----------------- MODAL: AGGIUNGI TORNEO ----------------- */}
      {isAddTournamentOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-md border border-tertiary">
            <h4 className="text-lg font-bold mb-4 text-accent">Aggiungi Nuovo Torneo</h4>
            <form onSubmit={handleAddTournament} className="space-y-4">
              <div>
                <label className="block text-sm mb-1">Nome Torneo</label>
                <input
                  autoFocus
                  value={newTournamentName}
                  onChange={e => setNewTournamentName(e.target.value)}
                  className="w-full bg-primary border border-tertiary rounded-lg p-2"
                  placeholder="Esempio: Torneo Primavera"
                />
              </div>

              {addError && <div className="text-red-400">{addError}</div>}

              <div className="flex justify-end gap-3">
                <button type="button" onClick={cancelAddTournament} className="bg-tertiary px-4 py-2 rounded">Annulla</button>
                <button type="submit" disabled={addLoading} className="bg-highlight text-white px-4 py-2 rounded font-bold">
                  {addLoading ? 'Creazione...' : 'Crea Torneo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ----------------- /MODAL: AGGIUNGI TORNEO ----------------- */}

      {/* == AdminMatchCounts inserito in fondo alla pagina (solo organizer) == */}
      <div id="match-control">
        {isOrganizer && activeAdminSection === 'matchControl' && <AdminMatchCounts event={event} onSelectTournament={onSelectTournament} />}
      </div>
    </div>
  );
};

export default EventView;
