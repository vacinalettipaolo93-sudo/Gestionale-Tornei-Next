import { type Event, type Player, type SummerPlayerAvailability, type TimeSlot, type Tournament } from '../types';
import { AVAILABILITY_DAYS, formatAvailabilityPeriods, normalizeAvailabilityByDay } from './rankingAvailability';
import { getTeamForPlayer, getTournamentCompetitors, getTournamentPadelTeams, isPadelEvent } from './padel';
import { getAvailabilityDateKey, getTournamentAvailabilitySlots } from './tournamentAvailability';
import { getSlotVenueId, type TournamentVenueId } from './tournamentVenues';

export type MatchCompatibility = 'exact' | 'different-time' | 'different-venue';

export interface MatchSuggestion {
  id: string;
  name: string;
  commonTimes: string[];
  contacts: Player[];
  compatibility?: MatchCompatibility;
}

export interface TournamentAvailability {
  slotPrefMap: Record<string, Set<string>>;
  dateUnavailMap: Record<string, Set<string>>;
  venueMap?: Record<string, Set<TournamentVenueId>>;
}

export function hasTournamentSlotPreference(availability: TournamentAvailability, playerId: string, slot: TimeSlot): boolean {
  const selectedVenues = availability.venueMap?.[playerId];
  const venueId = getSlotVenueId(slot);
  return !!availability.slotPrefMap[playerId]?.has(slot.id)
    && !availability.dateUnavailMap[playerId]?.has(getAvailabilityDateKey(slot.start))
    && (!selectedVenues || !!venueId && selectedVenues.has(venueId));
}

const slotVenueKey = (slot: TimeSlot) => getSlotVenueId(slot) ?? slot.location.trim().toLocaleLowerCase('it');
const formatSlot = (slot: TimeSlot) => [
  new Date(slot.start).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }),
  slot.location, slot.field,
].filter(Boolean).join(' · ');
const compatibilityOrder: Record<MatchCompatibility, number> = { exact: 0, 'different-time': 1, 'different-venue': 2 };

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
    .flatMap(competitor => {
      const opponentIds = memberIds(competitor.id);
      const ids = [...memberIds(ownCompetitorId), ...opponentIds];
      const validPlayers = new Set(ids).size === (padel ? 4 : 2)
        && ids.every(id => event.players.some(player => player.id === id));
      if (!validPlayers) return [];
      const preferences = ids.map(id => slots.filter(slot => hasTournamentSlotPreference(availability, id, slot)));
      const dates = [...new Set(preferences[0].map(slot => getAvailabilityDateKey(slot.start)))];
      const tiers: Record<MatchCompatibility, string[]> = { exact: [], 'different-time': [], 'different-venue': [] };
      for (const date of dates) {
        const byDate = preferences.map(selected => selected.filter(slot => getAvailabilityDateKey(slot.start) === date));
        if (byDate.some(selected => selected.length === 0)) continue;
        const exact = byDate[0].filter(slot => byDate.every(selected => selected.some(other =>
          slotVenueKey(other) === slotVenueKey(slot) && Date.parse(other.start) === Date.parse(slot.start)
        )));
        if (exact.length) {
          tiers.exact.push(...exact.map(formatSlot));
          continue;
        }
        const commonVenues = [...new Set(byDate[0].map(slotVenueKey))]
          .filter(venue => byDate.every(selected => selected.some(slot => slotVenueKey(slot) === venue)));
        const describe = (perPlayer: TimeSlot[][]) => ids.map((id, index) => {
          const name = event.players.find(player => player.id === id)!.name;
          const choices = [...new Set(perPlayer[index].map(slot =>
            `${slot.location} ${new Date(slot.start).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
          ))];
          return `${name}: ${choices.join(', ')}`;
        }).join(' / ');
        const dateLabel = new Date(byDate[0][0].start).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
        if (commonVenues.length) {
          for (const venue of commonVenues) {
            tiers['different-time'].push(`${dateLabel} · ${describe(byDate.map(selected => selected.filter(slot => slotVenueKey(slot) === venue)))}`);
          }
        } else {
          tiers['different-venue'].push(`${dateLabel} · ${describe(byDate)}`);
        }
      }
      return (Object.keys(tiers) as MatchCompatibility[]).filter(tier => tiers[tier].length > 0).map(compatibility => ({
        id: competitor.id, name: competitor.name, compatibility,
        commonTimes: [...new Set(tiers[compatibility])],
        contacts: event.players.filter(player => opponentIds.includes(player.id)),
      }));
    })
    .filter(suggestion => suggestion.commonTimes.length > 0)
    .sort((left, right) => compatibilityOrder[left.compatibility] - compatibilityOrder[right.compatibility]
      || right.commonTimes.length - left.commonTimes.length || left.name.localeCompare(right.name, 'it'));
}
