// components/TournamentView.tsx
import React, { useState, useEffect } from 'react';
import {
  type Event,
  type Tournament,
  type Match,
  type Player,
  type Group
} from '../types';
import StandingsTable from './StandingsTable';
import MatchList from './MatchList';
import ParticipantsTab from './ParticipantsTab';
import GroupManagement from './GroupManagement';
import TournamentSettings from './TournamentSettings';
import Playoffs from './Playoffs';
import ConsolationBracket from './ConsolationBracket';
import PlayerManagement from './PlayerManagement';
import AvailabilityTab from './AvailabilityTab';
import { TournamentMatchFinder } from './MatchFinder';
import TournamentBookingModal from './TournamentBookingModal';
import { saveTournamentSlotAction } from '../services/tournamentBookingService';
import CenteredDialog from './CenteredDialog';
import MatchScoreFields from './MatchScoreFields';
import { useSectionScroll } from './useSectionScroll';
import { saveTournamentResult } from '../services/tournamentResultService';
import { validateMatchScores } from '../utils/tournamentResults';
import { getCompetitorName, getTeamForPlayer, getTournamentCompetitors, getTournamentPadelTeams, isPadelEvent } from '../utils/padel';

interface TournamentViewProps {
  event: Event;
  tournament: Tournament;
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  isOrganizer: boolean;
  loggedInPlayerId?: string;
  initialActiveTab?: 'standings' | 'matches' | 'participants' | 'playoffs' | 'consolation' | 'groups' | 'settings' | 'rules' | 'players' | 'availability';
  initialSelectedGroupId?: string;
  onPlayerContact?: (player: Player | { phone?: string }) => void;
}

interface TournamentWithExtraMatches extends Tournament {
  playoffMatches?: Match[];
  consolationMatches?: Match[];
}

const TournamentView: React.FC<TournamentViewProps> = ({
  event, tournament, setEvents, isOrganizer, loggedInPlayerId,
  initialActiveTab, initialSelectedGroupId, onPlayerContact
}) => {
  const t = tournament as TournamentWithExtraMatches;
  const isPadel = isPadelEvent(event);
  const competitorPlayers = getTournamentCompetitors(event, tournament);
  const loggedInCompetitorId = isPadel
    ? getTeamForPlayer(getTournamentPadelTeams(tournament), loggedInPlayerId)?.id
    : loggedInPlayerId;

  const userGroup = tournament.groups.find(g => g.playerIds.includes(loggedInCompetitorId ?? ""));
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>(
    initialSelectedGroupId ?? (userGroup ? userGroup.id : tournament.groups[0]?.id)
  );
  const selectedGroup = tournament.groups.find(g => g.id === selectedGroupId);

  const [activeTab, setActiveTab] = useState<'standings' | 'matches' | 'participants' | 'playoffs' | 'consolation' | 'groups' | 'settings' | 'rules' | 'players' | 'availability'>(
    initialActiveTab ?? 'standings'
  );

  useEffect(() => {
    if (initialActiveTab) setActiveTab(initialActiveTab);
  }, [initialActiveTab]);

  useEffect(() => {
    if (initialSelectedGroupId && tournament.groups.some(g => g.id === initialSelectedGroupId)) {
      setSelectedGroupId(initialSelectedGroupId);
    }
  }, [initialSelectedGroupId, tournament.groups]);

  // modali / stati
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [score1, setScore1] = useState<string>("");
  const [score2, setScore2] = useState<string>("");

  const [bookingMatch, setBookingMatch] = useState<Match | null>(null);

  const [reschedulingMatch, setReschedulingMatch] = useState<Match | null>(null);

  const [deletingMatch, setDeletingMatch] = useState<Match | null>(null);

  const [bookingError, setBookingError] = useState<string>("");
  const [resultError, setResultError] = useState('');
  const [savingResult, setSavingResult] = useState(false);
  const [cancelingMatch, setCancelingMatch] = useState<Match | null>(null);
  const sectionRef = useSectionScroll(`${tournament.id}:${activeTab}:${selectedGroupId}`);

  const handleEditResult = (match: Match) => {
    setScore1(match.score1 == null ? '' : String(match.score1));
    setScore2(match.score2 == null ? '' : String(match.score2));
    setResultError('');
    setEditingMatch(match);
  };
  const handleOpenDeleteResult = (match: Match) => {
    setResultError('');
    setDeletingMatch(match);
  };
  const saveMatchResult = async (match: Match, reset = false) => {
    if (savingResult) return;
    const error = reset ? null : validateMatchScores(score1, score2);
    if (error) { setResultError(error); return; }
    setSavingResult(true);
    setResultError('');
    try {
      await saveTournamentResult(event.id, tournament.id, match,
        reset ? { type: 'reset' } : { type: 'save', score1: Number(score1), score2: Number(score2) },
        { isOrganizer, playerId: loggedInPlayerId });
      setEditingMatch(null);
      setDeletingMatch(null);
    } catch (cause) {
      setResultError(cause instanceof Error ? cause.message : 'Impossibile salvare il risultato. Riprova.');
    } finally {
      setSavingResult(false);
    }
  };

  const handlePlayerContact = (player: { phone?: string } | Player) => {
    const p = player as Player;
    if (!p?.phone) return;
    if (onPlayerContact) {
      onPlayerContact(p);
      return;
    }
    if ((p as any).phone) {
      window.open(`https://wa.me/${(p as any).phone.replace(/[^0-9]/g, "")}`, "_blank");
    }
  };

  // booking
  const handleBookMatch = (match: Match) => {
    setBookingMatch(match);
    setBookingError("");
  };

  // reschedule
  const handleRescheduleMatch = (match: Match) => {
    setReschedulingMatch(match);
    setBookingError("");
  };

  // cancel booking
  async function handleCancelBooking(match: Match) {
    if (savingResult) return;
    setSavingResult(true);
    setBookingError("");
    try {
      await saveTournamentSlotAction(event.id, tournament.id, { type: 'cancel', matchId: match.id }, {
        isOrganizer, playerId: loggedInPlayerId,
      });
      setCancelingMatch(null);
    } catch (cause) {
      setBookingError(cause instanceof Error ? cause.message : 'Impossibile annullare la prenotazione.');
    } finally {
      setSavingResult(false);
    }
  }

  const playoffVirtualGroup: Group = {
    id: `${tournament.id}-playoffs`,
    name: "Playoff",
    playerIds: [],
    matches: Array.isArray(t.playoffMatches) ? t.playoffMatches : [],
  };

  const consolationVirtualGroup: Group = {
    id: `${tournament.id}-consolation`,
    name: "Consolazione",
    playerIds: [],
    matches: Array.isArray(t.consolationMatches) ? t.consolationMatches : [],
  };

  return (
    <div ref={sectionRef} className="min-w-0 scroll-mt-4">
      {/* Tabs menu */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button onClick={() => setActiveTab('standings')}
          className={`px-4 py-2 rounded-full ${activeTab === 'standings'
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
            : 'bg-transparent text-accent'
          }`}
        >
          Classifica
        </button>
        <button onClick={() => setActiveTab('matches')}
          className={`px-4 py-2 rounded-full ${activeTab === 'matches'
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
            : 'bg-transparent text-accent'
          }`}
        >
          Partite
        </button>
        <button onClick={() => setActiveTab('availability')}
          className={`px-4 py-2 rounded-full ${activeTab === 'availability'
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
            : 'bg-transparent text-accent'
          }`}
        >
          Disponibilità di gioco
        </button>
        {!isOrganizer && (
          <button onClick={() => setActiveTab('participants')}
            className={`px-4 py-2 rounded-full ${activeTab === 'participants'
              ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
              : 'bg-transparent text-accent'
            }`}
          >
            Partecipanti
          </button>
        )}
        <button onClick={() => setActiveTab('playoffs')}
          className={`px-4 py-2 rounded-full ${activeTab === 'playoffs'
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
            : 'bg-transparent text-accent'
          }`}
        >
          Playoff
        </button>
        <button onClick={() => setActiveTab('consolation')}
          className={`px-4 py-2 rounded-full ${activeTab === 'consolation'
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
            : 'bg-transparent text-accent'
          }`}
        >
          Consolazione
        </button>
        {isOrganizer && (
          <>
            <button onClick={() => setActiveTab('groups')}
              className={`px-4 py-2 rounded-full ${activeTab === 'groups'
                ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
                : 'bg-transparent text-accent'
              }`}
            >
              Gestione Gironi
            </button>
            <button onClick={() => setActiveTab('players')}
              className={`px-4 py-2 rounded-full ${activeTab === 'players'
                ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
                : 'bg-transparent text-accent'
              }`}
            >
              Giocatori
            </button>
          </>
        )}
        <button onClick={() => setActiveTab('rules')}
          className={`px-4 py-2 rounded-full ${activeTab === 'rules'
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
            : 'bg-transparent text-accent'
          }`}
        >
          Regolamento
        </button>
        {isOrganizer && (
          <button onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 rounded-full ${activeTab === 'settings'
              ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
              : 'bg-transparent text-accent'
            }`}
          >
            Impostazioni
          </button>
        )}
      </div>

      {/* Selettore gironi */}
      {selectedGroup && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <label className="font-bold text-text-secondary">Seleziona Girone:</label>
          <select
            value={selectedGroupId}
            onChange={e => setSelectedGroupId(e.target.value)}
            className="min-w-0 max-w-full bg-tertiary rounded px-3 py-2 font-semibold"
          >
            {tournament.groups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        {activeTab === 'standings' && selectedGroup && (
          <div>
            <h3 className="text-xl font-bold mb-3 text-accent">{selectedGroup.name}</h3>
            <StandingsTable
              group={selectedGroup}
              players={competitorPlayers}
              settings={tournament.settings}
              loggedInPlayerId={loggedInCompetitorId}
              onPlayerContact={handlePlayerContact}
              entryLabel={isPadel ? 'Squadra' : 'Giocatore'}
            />
          </div>
        )}

        {activeTab === 'matches' && (
          <div className="space-y-10">
            {bookingError && <p role="alert" className="text-red-400">{bookingError}</p>}
            {!isOrganizer && loggedInPlayerId && (
              <TournamentMatchFinder
                event={event}
                tournament={tournament}
                currentPlayerId={loggedInPlayerId}
                onAvailability={() => setActiveTab('availability')}
                onPlayerContact={handlePlayerContact}
              />
            )}
            {Array.isArray(t.playoffMatches) && t.playoffMatches.length > 0 && (
              <div>
                <h3 className="text-xl font-bold mb-3 text-accent">Playoff</h3>
                <MatchList
                  group={playoffVirtualGroup}
                  players={competitorPlayers}
                  onEditResult={handleEditResult}
                  onBookMatch={handleBookMatch}
                  isOrganizer={isOrganizer}
                  loggedInPlayerId={loggedInCompetitorId}
                  onPlayerContact={handlePlayerContact}
                  onRescheduleMatch={handleRescheduleMatch}
                  onCancelBooking={match => { setBookingError(''); setCancelingMatch(match); }}
                  onDeleteResult={handleOpenDeleteResult}
                  viewingOwnGroup={true}
                />
              </div>
            )}

            {Array.isArray(t.consolationMatches) && t.consolationMatches.length > 0 && (
              <div>
                <h3 className="text-xl font-bold mb-3 text-accent">Consolazione</h3>
                <MatchList
                  group={consolationVirtualGroup}
                  players={competitorPlayers}
                  onEditResult={handleEditResult}
                  onBookMatch={handleBookMatch}
                  isOrganizer={isOrganizer}
                  loggedInPlayerId={loggedInCompetitorId}
                  onPlayerContact={handlePlayerContact}
                  onRescheduleMatch={handleRescheduleMatch}
                  onCancelBooking={match => { setBookingError(''); setCancelingMatch(match); }}
                  onDeleteResult={handleOpenDeleteResult}
                  viewingOwnGroup={true}
                />
              </div>
            )}

            {selectedGroup && (
              <div>
                <h3 className="text-xl font-bold mb-3 text-accent">{selectedGroup.name}</h3>
                <MatchList
                  group={selectedGroup}
                  players={competitorPlayers}
                  onEditResult={handleEditResult}
                  onBookMatch={handleBookMatch}
                  isOrganizer={isOrganizer}
                  loggedInPlayerId={loggedInCompetitorId}
                  onPlayerContact={handlePlayerContact}
                  onRescheduleMatch={handleRescheduleMatch}
                  onCancelBooking={match => { setBookingError(''); setCancelingMatch(match); }}
                  onDeleteResult={handleOpenDeleteResult}
                  viewingOwnGroup={selectedGroup.playerIds.includes(loggedInCompetitorId ?? "")}
                />
              </div>
            )}

          </div>
        )}

        {editingMatch && (
          <CenteredDialog title={editingMatch.score1 == null ? 'Inserisci risultato' : 'Modifica risultato'} busy={savingResult} onClose={() => setEditingMatch(null)}>
            <form onSubmit={e => { e.preventDefault(); void saveMatchResult(editingMatch); }} className="space-y-4">
              <p className="text-sm text-text-secondary">Inserisci il punteggio finale. La prenotazione rimane associata alla partita.</p>
              <MatchScoreFields
                names={[getCompetitorName(event, tournament, editingMatch.player1Id), getCompetitorName(event, tournament, editingMatch.player2Id)]}
                scores={[score1, score2]} onChange={(side, value) => side === 0 ? setScore1(value) : setScore2(value)} disabled={savingResult} />
              {resultError && <p role="alert" className="text-red-400">{resultError}</p>}
              <div className="flex flex-wrap gap-2 justify-end pt-3">
                {editingMatch.score1 != null && <button type="button" disabled={savingResult}
                  onClick={() => { handleOpenDeleteResult(editingMatch); setEditingMatch(null); }}
                  className="text-red-300 bg-primary px-4 py-2 rounded-lg">Elimina risultato</button>}
                <button type="button" disabled={savingResult} onClick={() => setEditingMatch(null)} className="bg-tertiary px-4 py-2 rounded-lg">Annulla</button>
                <button type="submit" disabled={savingResult || !!validateMatchScores(score1, score2)} className="bg-highlight text-white px-4 py-2 rounded-lg disabled:opacity-50">
                  {savingResult ? 'Salvataggio...' : 'Salva risultato'}
                </button>
              </div>
            </form>
          </CenteredDialog>
        )}

        {bookingMatch && (
          <TournamentBookingModal
            event={event}
            tournament={tournament}
            match={bookingMatch}
            isOrganizer={isOrganizer}
            loggedInPlayerId={loggedInPlayerId}
            onClose={() => setBookingMatch(null)}
          />
        )}

        {reschedulingMatch && (
          <TournamentBookingModal
            event={event}
            tournament={tournament}
            match={reschedulingMatch}
            isOrganizer={isOrganizer}
            loggedInPlayerId={loggedInPlayerId}
            reschedule
            onClose={() => setReschedulingMatch(null)}
          />
        )}

        {deletingMatch && (
          <CenteredDialog title="Elimina risultato" busy={savingResult} onClose={() => setDeletingMatch(null)}>
            <p className="mb-6 font-bold text-white">Sei sicuro di voler eliminare il risultato della partita tra&nbsp;
              <strong>{getCompetitorName(event, tournament, deletingMatch.player1Id)}</strong> e&nbsp;
              <strong>{getCompetitorName(event, tournament, deletingMatch.player2Id)}</strong>?
            </p>
            <p className="text-sm mb-3">Viene eliminato solo il risultato: l'eventuale prenotazione resta valida.</p>
            {resultError && <p role="alert" className="text-red-400">{resultError}</p>}
            <div className="flex flex-wrap gap-2 justify-end pt-3">
              <button disabled={savingResult} onClick={() => setDeletingMatch(null)} className="bg-tertiary px-4 py-2 rounded">Annulla</button>
              <button disabled={savingResult} onClick={() => void saveMatchResult(deletingMatch, true)} className="bg-red-600 text-white px-4 py-2 rounded">{savingResult ? 'Salvataggio...' : 'Elimina risultato'}</button>
            </div>
          </CenteredDialog>
        )}
        {cancelingMatch && (
          <CenteredDialog title="Annulla prenotazione" busy={savingResult} onClose={() => setCancelingMatch(null)}>
            <p>Vuoi annullare la prenotazione? Il campo torna disponibile e la partita resta da giocare.</p>
            {bookingError && <p role="alert" className="text-red-400 mt-3">{bookingError}</p>}
            <div className="flex flex-wrap justify-end gap-2 mt-4">
              <button disabled={savingResult} onClick={() => setCancelingMatch(null)} className="bg-tertiary px-4 py-2 rounded">Mantieni prenotazione</button>
              <button disabled={savingResult} onClick={() => void handleCancelBooking(cancelingMatch)} className="bg-red-600 px-4 py-2 rounded">{savingResult ? 'Salvataggio...' : 'Conferma annullamento'}</button>
            </div>
          </CenteredDialog>
        )}
        {activeTab === 'participants' && !isOrganizer && (
          <ParticipantsTab event={event} tournament={tournament} loggedInPlayerId={loggedInPlayerId} />
        )}

        {activeTab === 'availability' && (
          <AvailabilityTab
            event={event}
            tournament={tournament}
            selectedGroup={{
              id: `${tournament.id}-availability`,
              name: 'Disponibilità torneo',
              playerIds: event.players.map(player => player.id),
              matches: [],
            }}
            loggedInPlayerId={loggedInPlayerId}
          />
        )}

        {activeTab === 'playoffs' && (
          <div className="bg-secondary p-6 rounded-xl shadow-lg max-w-3xl mx-auto">
            <Playoffs event={event} tournament={tournament} setEvents={setEvents} isOrganizer={isOrganizer} loggedInPlayerId={loggedInCompetitorId} onEditResult={handleEditResult} />
          </div>
        )}

        {activeTab === 'consolation' && (
          <ConsolationBracket event={event} tournament={tournament} setEvents={setEvents} isOrganizer={isOrganizer} loggedInPlayerId={loggedInCompetitorId} onEditResult={handleEditResult} />
        )}

        {activeTab === 'groups' && isOrganizer && (
          <GroupManagement event={event} tournament={tournament} setEvents={setEvents} isOrganizer={isOrganizer} />
        )}

        {activeTab === 'players' && isOrganizer && (
          <PlayerManagement event={event} setEvents={setEvents} isOrganizer={isOrganizer} onPlayerContact={handlePlayerContact} />
        )}

        {activeTab === 'settings' && isOrganizer && (
          <TournamentSettings event={event} tournament={tournament} setEvents={setEvents} />
        )}

        {activeTab === 'rules' && (
          <div className="bg-secondary p-6 rounded-xl shadow-lg max-w-3xl mx-auto whitespace-pre-line">
            <h3 className="text-xl font-bold mb-4 text-accent">Regolamento Torneo</h3>
            {event.rules?.trim()
              ? <div className="bg-primary p-4 rounded-lg border border-tertiary">{event.rules}</div>
              : <p className="text-text-secondary">Nessun regolamento inserito dall'organizzatore.</p>}
            <div className="mt-8">
              <h3 className="text-xl font-bold mb-4 text-accent">
                Regolamento Girone: {selectedGroup?.name}
              </h3>
              {selectedGroup?.rules?.trim()
                ? <div className="bg-primary p-4 rounded-lg border border-tertiary">{selectedGroup.rules}</div>
                : <p className="text-text-secondary">Nessun regolamento inserito per questo girone.</p>
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TournamentView;
