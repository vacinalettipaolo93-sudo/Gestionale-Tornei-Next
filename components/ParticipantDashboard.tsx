import React from 'react';
import { type Event } from '../types';
import { calculateStandings } from '../utils/standings';
import { calculateSummerRanking, normalizeRulesConfig } from '../utils/summerRanking';
import { calculatePadelIndividualRanking } from '../utils/padelIndividualRanking';
import { getRankingEventLabel, matchIncludesPlayer } from '../utils/rankingEvent';
import { isEventConcluded } from '../utils/eventStatus';
import { getTeamForPlayer, getTournamentCompetitors, getTournamentPadelTeams, isPadelEvent } from '../utils/padel';

interface ParticipantDashboardProps {
  events: Event[];
  headerContent?: React.ReactNode;
  playerId: string;
  onSelectEvent: (event: Event) => void;
}

const ParticipantDashboard: React.FC<ParticipantDashboardProps> = ({ events, headerContent, playerId, onSelectEvent }) => {
  const myEvents = events.filter(event => 
    Array.isArray(event.players) && event.players.some(p => p.id === playerId && p.status === 'confirmed')
  );

  const getPlayerStats = (event: Event) => {
    let position = 'N/A';
    let played = 0;
    let toPlay = 0;
    let totalMatches = 0;
    let completionPercentage = 0;
    let tournamentName = '';

    if (event.eventType === 'ranking_singolare' || event.eventType === 'ranking_padel_individuale') {
      const rankingData = event.rankingData;
      const participantIds = Array.isArray(rankingData?.participantIds) ? rankingData.participantIds : [];
      const isInRanking = participantIds.includes(playerId);
      const confirmedPlayers = Array.isArray(event.players)
        ? event.players.filter(player => player.status === 'confirmed' && participantIds.includes(player.id))
        : [];
      const ranking = event.eventType === 'ranking_padel_individuale'
        ? calculatePadelIndividualRanking(confirmedPlayers, Array.isArray(rankingData?.matches) ? rankingData.matches : [])
        : calculateSummerRanking(confirmedPlayers, Array.isArray(rankingData?.matches) ? rankingData.matches : [], normalizeRulesConfig(rankingData?.rulesConfig));
      const myRanking = ranking.find(entry => entry.player.id === playerId);
      position = isInRanking && myRanking ? `${myRanking.rank}°` : '—';
      const myMatches = (rankingData?.matches ?? []).filter(match => matchIncludesPlayer(match, playerId));
      totalMatches = myMatches.length;
      played = myMatches.filter(match => match.status === 'completed').length;
      toPlay = totalMatches - played;
      completionPercentage = totalMatches > 0 ? Math.round((played / totalMatches) * 100) : 0;
      tournamentName = getRankingEventLabel(event.eventType);
      return { position, played, toPlay, totalMatches, completionPercentage, tournamentName };
    }

    const tournament = Array.isArray(event.tournaments)
      ? event.tournaments.find(t => {
        if (!Array.isArray(t.groups)) return false;
        if (!isPadelEvent(event)) return t.groups.some(g => Array.isArray(g.playerIds) && g.playerIds.includes(playerId));
        const team = getTeamForPlayer(getTournamentPadelTeams(t), playerId);
        return !!team && t.groups.some(g => Array.isArray(g.playerIds) && g.playerIds.includes(team.id));
      })
      : undefined;

    if (tournament) {
      tournamentName = tournament.name;
      const myCompetitorId = isPadelEvent(event)
        ? getTeamForPlayer(getTournamentPadelTeams(tournament), playerId)?.id
        : playerId;
      const group = Array.isArray(tournament.groups)
        ? tournament.groups.find(g => Array.isArray(g.playerIds) && myCompetitorId ? g.playerIds.includes(myCompetitorId) : false)
        : undefined;
      if (group) {
        const standings = calculateStandings(group, getTournamentCompetitors(event, tournament), tournament.settings);
        const myStanding = standings.findIndex(s => s.playerId === myCompetitorId);
        if (myStanding !== -1) {
          position = `${myStanding + 1}°`;
        }

        const myMatches = Array.isArray(group.matches)
          ? group.matches.filter(m => m.player1Id === myCompetitorId || m.player2Id === myCompetitorId)
          : [];
        totalMatches = myMatches.length;
        played = myMatches.filter(m => m.status === 'completed').length;
        toPlay = totalMatches - played;
        completionPercentage = totalMatches > 0 ? Math.round((played / totalMatches) * 100) : 0;
      }
      if (isPadelEvent(event)) {
        tournamentName = `${tournament.name} • Torneo di padel`;
      }
    }
    return { position, played, toPlay, totalMatches, completionPercentage, tournamentName };
  };

  return (
    <div className="space-y-6 animate-fadeIn">
        {headerContent}
        <h2 className="text-3xl font-bold">I Miei Eventi</h2>
        {myEvents.length === 0 && (
            <p className="text-text-secondary text-center py-8">Nessun evento trovato.</p>
        )}
        {myEvents.length > 0 && (() => {
            const ongoing = myEvents.filter(e => !isEventConcluded(e));
            const concluded = myEvents.filter(e => isEventConcluded(e));
            return (
                <div className="space-y-8">
                    {/* Sezione: In corso */}
                    <div>
                        <h3 className="text-lg font-semibold text-text-secondary mb-4 flex items-center gap-2">
                            <span className="inline-block w-2 h-2 rounded-full bg-green-400"></span>
                            In corso
                        </h3>
                        {ongoing.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {ongoing.map(event => {
                                    const stats = getPlayerStats(event);
                                    const isRankingEvent = event.eventType === 'ranking_singolare' || event.eventType === 'ranking_padel_individuale';
                                    return (
                                        <div
                                            key={event.id}
                                            onClick={() => onSelectEvent(event)}
                                            className="bg-secondary rounded-xl shadow-lg transition-all duration-300 group relative overflow-hidden flex flex-col cursor-pointer"
                                        >
                                            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-accent/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                                            <div className="p-6 flex-grow z-10">
                                                <h3 className="text-xl font-bold text-accent truncate">{event.name}</h3>
                                                <p className="text-text-secondary mt-1 text-sm">{stats.tournamentName}</p>
                                                <div className="mt-4 pt-4 border-t border-tertiary/50 grid grid-cols-3 gap-4 text-center">
                                                    <div>
                                                        <div className="text-2xl font-bold">{stats.position}</div>
                                                        <div className="text-xs text-text-secondary">Classifica</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-2xl font-bold">{stats.played}</div>
                                                        <div className="text-xs text-text-secondary">Giocate</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-2xl font-bold">{stats.toPlay}</div>
                                                        <div className="text-xs text-text-secondary">Da giocare</div>
                                                    </div>
                                                </div>
                                                {!isRankingEvent && (
                                                    <div className="mt-2">
                                                        <div className="w-full bg-tertiary/30 h-2 rounded-full">
                                                            <div className="bg-accent h-2 rounded-full transition-all duration-300" style={{ width: `${stats.completionPercentage}%` }}></div>
                                                        </div>
                                                        <div className="text-xs text-text-secondary mt-1 text-right">{stats.completionPercentage}% Completato</div>
                                                    </div>
                                                )}
                                            </div>
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
                        {concluded.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {concluded.map(event => {
                                    const stats = getPlayerStats(event);
                                    return (
                                        <div
                                            key={event.id}
                                            onClick={() => onSelectEvent(event)}
                                            className="bg-secondary/60 rounded-xl shadow transition-all duration-300 group relative overflow-hidden flex flex-col cursor-pointer opacity-80"
                                        >
                                            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-tertiary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                                            <div className="p-6 flex-grow z-10">
                                                <div className="flex items-start justify-between gap-2 mb-1">
                                                    <h3 className="text-xl font-bold text-text-primary truncate">{event.name}</h3>
                                                    <span className="flex-shrink-0 text-xs font-semibold bg-tertiary/60 text-text-secondary px-2 py-0.5 rounded-full">
                                                        Terminato
                                                    </span>
                                                </div>
                                                <p className="text-text-secondary mt-1 text-sm">{stats.tournamentName}</p>
                                                <div className="mt-4 pt-4 border-t border-tertiary/50 grid grid-cols-3 gap-4 text-center">
                                                    <div>
                                                        <div className="text-2xl font-bold">{stats.position}</div>
                                                        <div className="text-xs text-text-secondary">Classifica</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-2xl font-bold">{stats.played}</div>
                                                        <div className="text-xs text-text-secondary">Giocate</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-2xl font-bold">{stats.toPlay}</div>
                                                        <div className="text-xs text-text-secondary">Da giocare</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-text-secondary text-sm py-4">Nessun evento concluso.</p>
                        )}
                    </div>
                </div>
            );
        })()}
    </div>
  );
};

export default ParticipantDashboard;
