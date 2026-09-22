import { type Event, type Tournament } from '../types';

const isCompletedMatch = (
  match: { status?: string; score1?: number | null; score2?: number | null },
  options?: { allowMissingStatus?: boolean },
) =>
  (match.status === 'completed' || (!!options?.allowMissingStatus && match.status === undefined)) &&
  match.score1 !== null &&
  match.score1 !== undefined &&
  match.score2 !== null &&
  match.score2 !== undefined &&
  match.score1 >= 0 &&
  match.score2 >= 0;

const isCompletedKnockoutFinal = (match: { player1Id?: string | null; player2Id?: string | null; status?: string; score1?: number | null; score2?: number | null } | null | undefined) =>
  !!match &&
  !!match.player1Id &&
  !!match.player2Id &&
  isCompletedMatch(match, { allowMissingStatus: true }) &&
  match.score1 !== match.score2;

const findTournamentFinalMatch = (tournament: Tournament) => {
  if (!tournament.playoffs?.isGenerated) return null;
  const bracketMatches = tournament.playoffs.matches ?? [];
  if (bracketMatches.length === 0) return null;
  if (tournament.playoffs.finalId) {
    return bracketMatches.find(match => match.id === tournament.playoffs?.finalId) ?? null;
  }
  const nonBronzeMatches = bracketMatches.filter(match => !match.isBronzeFinal);
  if (nonBronzeMatches.length === 0) return null;
  return nonBronzeMatches
    .slice()
    .sort((left, right) => right.round - left.round || right.matchIndex - left.matchIndex)[0] ?? null;
};

const findRankingFinalMatch = (
  matches: Array<{ id: string; stage?: string; round: number; status: string; player1Id: string | null; player2Id: string | null; score1: number | null; score2: number | null }> | undefined,
  fallbackFinalId?: string | null,
) => {
  if (!Array.isArray(matches) || matches.length === 0) return null;

  const byStage = matches.find(match => match.stage === 'final');
  if (byStage) return byStage;

  if (fallbackFinalId) {
    const byId = matches.find(match => match.id === fallbackFinalId);
    if (byId) return byId;
  }

  const nonGroupMatches = matches.filter(match => match.stage !== 'group' && match.stage !== 'thirdPlace');
  if (nonGroupMatches.length === 0) return null;
  return nonGroupMatches
    .slice()
    .sort((left, right) => right.round - left.round || right.id.localeCompare(left.id))[0] ?? null;
};

const isRankingMasterConcluded = (event: Event): boolean => {
  const rankingData = event.rankingData;
  if (!rankingData) return false;

  if (event.eventType === 'ranking_singolare') {
    const finalMatch = findRankingFinalMatch(rankingData.master?.matches, rankingData.master?.bracket?.finalId ?? null);
    return isCompletedKnockoutFinal(finalMatch);
  }

  if (event.eventType === 'ranking_padel_individuale') {
    const finalMatch = findRankingFinalMatch(
      rankingData.padelIndividualMaster?.matches,
      rankingData.padelIndividualMaster?.bracket?.finalId ?? null,
    );
    return isCompletedKnockoutFinal(finalMatch);
  }

  return false;
};

/**
 * Determines if a single tournament is concluded (all expected matches played).
 * A tournament is concluded when:
 * - It has at least one match
 * - All group matches are completed
 * - If a playoff bracket was generated, all playoff league-matches are completed
 * - If a consolation bracket was generated, all consolation league-matches are completed
 */
export function isTournamentConcluded(tournament: Tournament): boolean {
  const playoffFinal = findTournamentFinalMatch(tournament);
  if (playoffFinal) {
    return isCompletedKnockoutFinal(playoffFinal);
  }

  let totalGroupMatches = 0;
  let completedGroupMatches = 0;
  (tournament.groups ?? []).forEach(group => {
    (group.matches ?? []).forEach(match => {
      totalGroupMatches++;
      if (isCompletedMatch(match)) completedGroupMatches++;
    });
  });
  return totalGroupMatches > 0 && completedGroupMatches === totalGroupMatches;
}

/**
 * Determines if an event is concluded.
 * - For ranking_singolare / ranking_padel_individuale: always false (kept "In corso" by default)
 * - For tournament_singolare: the event must have at least one tournament
 *   and all its tournaments must be concluded.
 */
export function isEventConcluded(event: Event): boolean {
  if (event.eventType === 'ranking_singolare' || event.eventType === 'ranking_padel_individuale') {
    return isRankingMasterConcluded(event);
  }

  // tournament_singolare (or legacy events without eventType)
  const tournaments = Array.isArray(event.tournaments) ? event.tournaments : [];
  if (tournaments.length === 0) return false;

  return tournaments.every(t => isTournamentConcluded(t));
}
