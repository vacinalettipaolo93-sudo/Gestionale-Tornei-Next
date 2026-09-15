import { type Event, type Tournament } from '../types';

/**
 * Determines if a single tournament is concluded (all expected matches played).
 * A tournament is concluded when:
 * - It has at least one match
 * - All group matches are completed
 * - If a playoff bracket was generated, all playoff league-matches are completed
 * - If a consolation bracket was generated, all consolation league-matches are completed
 */
export function isTournamentConcluded(tournament: Tournament): boolean {
  let total = 0;
  let completed = 0;

  // Group matches
  (tournament.groups ?? []).forEach(group => {
    (group.matches ?? []).forEach(m => {
      total++;
      if (m.status === 'completed') completed++;
    });
  });

  // Playoff league-matches (only if bracket was generated)
  if (tournament.playoffs?.isGenerated) {
    const playoffMatches = Array.isArray(tournament.playoffMatches) ? tournament.playoffMatches : [];
    playoffMatches.forEach(m => {
      total++;
      if (m.status === 'completed') completed++;
    });
  }

  // Consolation league-matches (only if bracket was generated)
  if (tournament.consolationBracket?.isGenerated) {
    const consolationMatches = Array.isArray(tournament.consolationMatches) ? tournament.consolationMatches : [];
    consolationMatches.forEach(m => {
      total++;
      if (m.status === 'completed') completed++;
    });
  }

  return total > 0 && completed === total;
}

/**
 * Determines if an event is concluded.
 * - For ranking_singolare / ranking_padel_individuale: always false (kept "In corso" by default)
 * - For tournament_singolare: the event must have at least one tournament
 *   and all its tournaments must be concluded.
 */
export function isEventConcluded(event: Event): boolean {
  if (event.eventType === 'ranking_singolare' || event.eventType === 'ranking_padel_individuale') {
    return false;
  }

  // tournament_singolare (or legacy events without eventType)
  const tournaments = Array.isArray(event.tournaments) ? event.tournaments : [];
  if (tournaments.length === 0) return false;

  return tournaments.every(t => isTournamentConcluded(t));
}
