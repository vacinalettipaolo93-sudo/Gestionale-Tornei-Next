import { type Event, type Player, type SummerPlayerAvailability, type TimeSlot, type Tournament } from '../types';
import { AVAILABILITY_DAYS, formatAvailabilityPeriods, normalizeAvailabilityByDay } from './rankingAvailability';
import { getTeamForPlayer, getTournamentCompetitors, getTournamentPadelTeams, isPadelEvent } from './padel';
import { getAvailabilityDateKey, getTournamentAvailabilitySlots } from './tournamentAvailability';
import { getSlotVenueId, TOURNAMENT_VENUES, type TournamentVenueId } from './tournamentVenues';
import {
  TOURNAMENT_AVAILABILITY_PERIODS,
  formatTournamentAvailabilityDate,
  type TournamentAvailabilityPeriodId,
  type TournamentPeriodAvailability,
} from './tournamentAvailabilityPeriods';

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
  periodMap?: Record<string, TournamentPeriodAvailability[]>;
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

type MatchAvailabilityOption =
  | { kind: 'slot'; date: string; venue: string; label: string; fullLabel: string; start: number }
  | { kind: 'period'; date: string; venue: TournamentVenueId; label: string; period: TournamentAvailabilityPeriodId };

function isDeclaredPeriodCompatible(first: MatchAvailabilityOption, second: MatchAvailabilityOption): boolean {
  if (first.venue !== second.venue) return false;
  if (first.kind === 'period' && second.kind === 'period') return first.period === second.period;
  if (first.kind === 'slot' && second.kind === 'slot') return first.start === second.start;
  const period = first.kind === 'period' ? first : second as Extract<MatchAvailabilityOption, { kind: 'period' }>;
  const slot = first.kind === 'slot' ? first : second as Extract<MatchAvailabilityOption, { kind: 'slot' }>;
  const hour = new Date(slot.start).getHours();
  const range = TOURNAMENT_AVAILABILITY_PERIODS.find(item => item.id === period.period)!;
  return hour >= range.startHour && hour < range.endHour;
}

function formatAvailabilityOption(option: MatchAvailabilityOption): string {
  if (option.kind === 'slot') return option.label;
  const period = TOURNAMENT_AVAILABILITY_PERIODS.find(item => item.id === option.period)!;
  const venue = TOURNAMENT_VENUES.find(item => item.id === option.venue)!;
  return `${venue.name} · ${period.label} (${period.hours})`;
}

function formatExactAvailabilityOption(option: MatchAvailabilityOption): string {
  return option.kind === 'slot' ? option.fullLabel : formatAvailabilityOption(option);
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
    .flatMap(competitor => {
      const opponentIds = memberIds(competitor.id);
      const ids = [...memberIds(ownCompetitorId), ...opponentIds];
      const validPlayers = new Set(ids).size === (padel ? 4 : 2)
        && ids.every(id => event.players.some(player => player.id === id));
      if (!validPlayers) return [];
      const selectedOptions = (id: string): MatchAvailabilityOption[] => {
        const selectedVenues = availability.venueMap?.[id];
        const periods: MatchAvailabilityOption[] = (availability.periodMap?.[id] ?? [])
          .filter(item => !availability.dateUnavailMap[id]?.has(item.date)
            && (!selectedVenues || selectedVenues.has(item.venueId)))
          .map(item => {
            const venue = TOURNAMENT_VENUES.find(candidate => candidate.id === item.venueId)!;
            const period = TOURNAMENT_AVAILABILITY_PERIODS.find(candidate => candidate.id === item.period)!;
            return {
              kind: 'period', date: item.date, venue: item.venueId,
              period: item.period, label: `${venue.name} · ${period.label} (${period.hours})`,
            };
          });
        const legacy: MatchAvailabilityOption[] = slots
          .filter(slot => hasTournamentSlotPreference(availability, id, slot))
          .map(slot => ({
            kind: 'slot', date: getAvailabilityDateKey(slot.start), venue: slotVenueKey(slot),
            label: `${slot.location} ${new Date(slot.start).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`,
            fullLabel: formatSlot(slot),
            start: Date.parse(slot.start),
          }));
        return [...periods, ...legacy];
      };
      const preferences = ids.map(selectedOptions);
      const dates = [...new Set(preferences[0].map(option => option.date))];
      const tiers: Record<MatchCompatibility, string[]> = { exact: [], 'different-time': [], 'different-venue': [] };
      for (const date of dates) {
        const byDate = preferences.map(selected => selected.filter(option => option.date === date));
        if (byDate.some(selected => selected.length === 0)) continue;
        const exact = byDate[0].filter(option =>
          byDate.every(selected => selected.some(other => isDeclaredPeriodCompatible(option, other))));
        if (exact.length) {
          const dateLabel = formatTournamentAvailabilityDate(date);
          tiers.exact.push(...new Set(exact.map(option => `${dateLabel} · ${formatExactAvailabilityOption(option)}`)));
          continue;
        }
        const commonVenues = [...new Set(byDate[0].map(option => option.venue))]
          .filter(venue => byDate.every(selected => selected.some(option => option.venue === venue)));
        const describe = (perPlayer: MatchAvailabilityOption[][]) => ids.map((id, index) => {
          const name = event.players.find(player => player.id === id)!.name;
          const choices = [...new Set(perPlayer[index].map(formatAvailabilityOption))];
          return `${name}: ${choices.join(', ')}`;
        }).join(' / ');
        const dateLabel = formatTournamentAvailabilityDate(date);
        if (commonVenues.length) {
          for (const venue of commonVenues) {
            tiers['different-time'].push(`${dateLabel} · ${describe(byDate.map(selected => selected.filter(option => option.venue === venue)))}`);
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
