import { type Event, type Player, type SummerPlayerAvailability, type Tournament } from '../types';
import { AVAILABILITY_DAYS, formatAvailabilityPeriods, normalizeAvailabilityByDay } from './rankingAvailability';
import { getTeamForPlayer, getTournamentCompetitors, getTournamentPadelTeams, isPadelEvent } from './padel';
import { getAvailabilityDateKey, getTournamentAvailabilitySlots } from './tournamentAvailability';

export interface MatchSuggestion {
  id: string;
  name: string;
  commonTimes: string[];
  contacts: Player[];
}

export interface TournamentAvailability {
  slotPrefMap: Record<string, Set<string>>;
  dateUnavailMap: Record<string, Set<string>>;
}

export function hasRankingAvailability(availability?: SummerPlayerAvailability): boolean {
  return Object.values(normalizeAvailabilityByDay(availability)).some(periods => periods.length > 0);
}

export function getRankingMatchSuggestions(
  currentPlayerId: string,
  opponents: Player[],
  availabilities: Record<string, SummerPlayerAvailability> = {},
): MatchSuggestion[] {
  const ownDays = normalizeAvailabilityByDay(availabilities[currentPlayerId]);
  return opponents
    .filter(player => player.id !== currentPlayerId && player.status === 'confirmed')
    .map(player => {
      const opponentDays = normalizeAvailabilityByDay(availabilities[player.id]);
      const commonTimes = AVAILABILITY_DAYS.flatMap(day => {
        const periods = ownDays[day.value].filter(period => opponentDays[day.value].includes(period));
        return periods.length > 0 ? [`${day.label}: ${formatAvailabilityPeriods(periods)}`] : [];
      });
      return { id: player.id, name: player.name, commonTimes, contacts: [player] };
    })
    .filter(suggestion => suggestion.commonTimes.length > 0)
    .sort((left, right) => right.commonTimes.length - left.commonTimes.length || left.name.localeCompare(right.name, 'it'));
}

export function getTournamentMatchSuggestions(
  event: Event,
  tournament: Tournament,
  currentPlayerId: string,
  availability: TournamentAvailability,
  now = Date.now(),
): MatchSuggestion[] {
  const padel = isPadelEvent(event);
  const teams = getTournamentPadelTeams(tournament);
  const ownCompetitorId = padel ? getTeamForPlayer(teams, currentPlayerId)?.id : currentPlayerId;
  if (!ownCompetitorId) return [];
  const memberIds = (id: string) => {
    if (!padel) return [id];
    const team = teams.find(item => item.id === id);
    return team ? [team.player1Id, team.player2Id] : [];
  };
  const opponents = new Set<string>();
  const matches = [
    ...(tournament.groups ?? []).flatMap(group => group.matches ?? []),
    ...(tournament.playoffMatches ?? []),
    ...(tournament.consolationMatches ?? []),
  ];
  for (const match of matches) {
    if (match.status === 'completed' || (match.score1 != null && match.score2 != null)) continue;
    if (match.player1Id === ownCompetitorId && match.player2Id) opponents.add(match.player2Id);
    if (match.player2Id === ownCompetitorId && match.player1Id) opponents.add(match.player1Id);
  }
  opponents.delete(ownCompetitorId);
  const slots = getTournamentAvailabilitySlots(event, tournament, now);
  return getTournamentCompetitors(event, tournament)
    .filter(competitor => opponents.has(competitor.id))
    .map(competitor => {
      const opponentIds = memberIds(competitor.id);
      const ids = [...memberIds(ownCompetitorId), ...opponentIds];
      const validPlayers = new Set(ids).size === (padel ? 4 : 2)
        && ids.every(id => event.players.some(player => player.id === id));
      const commonTimes = validPlayers ? slots
        .filter(slot => ids.every(id =>
          availability.slotPrefMap[id]?.has(slot.id)
          && !availability.dateUnavailMap[id]?.has(getAvailabilityDateKey(slot.start))
        ))
        .map(slot => [
          new Date(slot.start).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }),
          slot.location,
          slot.field,
        ].filter(Boolean).join(' · ')) : [];
      return {
        id: competitor.id,
        name: competitor.name,
        commonTimes: [...new Set(commonTimes)],
        contacts: event.players.filter(player => opponentIds.includes(player.id)),
      };
    })
    .filter(suggestion => suggestion.commonTimes.length > 0)
    .sort((left, right) => right.commonTimes.length - left.commonTimes.length || left.name.localeCompare(right.name, 'it'));
}
