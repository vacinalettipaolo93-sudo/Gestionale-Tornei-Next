import { type Event, type Match, type PlayoffBracket, type Tournament } from '../types';
import { getTeamForPlayer, getTournamentPadelTeams, isPadelEvent } from './padel';
import { getTournamentMatches } from './tournamentAvailability';
import { type BookingActor } from './tournamentBooking';

export type ResultAction =
  | { type: 'save'; score1: number; score2: number }
  | { type: 'reset' };

export function validateMatchScores(score1: string, score2: string): string | null {
  if (!score1.trim() || !score2.trim()) return 'Inserisci entrambi i punteggi.';
  if (![score1, score2].every(score => Number.isSafeInteger(Number(score)) && Number(score) >= 0)) {
    return 'Inserisci punteggi interi maggiori o uguali a zero.';
  }
  return null;
}

function updateBracket(tournament: Tournament, match: Match, updated: Match, reset: boolean): Tournament {
  const phase = tournament.playoffMatches?.some(item => item.id === match.id)
    || tournament.playoffs?.matches.some(item => `po-${item.id}` === match.id) ? 'playoff' : 'consolation';
  const bracketKey = phase === 'playoff' ? 'playoffs' : 'consolationBracket';
  const matchesKey = phase === 'playoff' ? 'playoffMatches' : 'consolationMatches';
  const prefix = phase === 'playoff' ? 'po-' : 'co-';
  const original = tournament[bracketKey];
  if (!original) return tournament;
  const bracket: PlayoffBracket = { ...original, matches: original.matches.map(item => ({ ...item })) };
  const bracketMatch = bracket.matches.find(item => `${prefix}${item.id}` === match.id);
  if (!bracketMatch) return tournament;
  if (!reset && updated.score1 === updated.score2) throw new Error('Nei playoff e nella consolazione è necessario un vincitore.');
  const winner = reset ? null : updated.score1! > updated.score2! ? updated.player1Id : updated.player2Id;
  const loser = reset ? null : winner === updated.player1Id ? updated.player2Id : updated.player1Id;
  const round = bracket.matches.filter(item => item.round === bracketMatch.round && !item.isBronzeFinal)
    .sort((left, right) => left.matchIndex - right.matchIndex);
  const side = round.findIndex(item => item.id === bracketMatch.id) % 2 === 0 ? 'player1Id' : 'player2Id';
  const targets = [
    { id: bracketMatch.nextMatchId, playerId: winner },
    ...(bracketMatch.loserGoesToBronzeFinal ? [{ id: bracket.bronzeFinalId, playerId: loser }] : []),
  ];
  let mirrors = (tournament[matchesKey] ?? []).map(item => item.id === match.id ? updated : item);
  if (!mirrors.some(item => item.id === updated.id)) mirrors.push(updated);
  for (const target of targets) {
    const next = bracket.matches.find(item => item.id === target.id);
    if (!next || next[side] === target.playerId) continue;
    const mirror = mirrors.find(item => item.id === `${prefix}${next.id}`);
    if (next.winnerId || next.score1 != null || next.score2 != null
      || mirror && (mirror.status !== 'pending' || mirror.slotId || mirror.scheduledTime || mirror.score1 != null || mirror.score2 != null)) {
      throw new Error('Prima di cambiare il vincitore o eliminare questo risultato, annulla la prenotazione o il risultato del turno successivo.');
    }
    next[side] = target.playerId;
    if (!next.player1Id || !next.player2Id) {
      mirrors = mirrors.filter(item => item.id !== `${prefix}${next.id}`);
    } else {
      const nextMatch: Match = {
        id: `${prefix}${next.id}`, player1Id: next.player1Id, player2Id: next.player2Id,
        score1: null, score2: null, status: 'pending',
      };
      mirrors = mirror
        ? mirrors.map(item => item.id === nextMatch.id ? { ...item, ...nextMatch } : item)
        : [...mirrors, nextMatch];
    }
  }
  bracketMatch.score1 = updated.score1;
  bracketMatch.score2 = updated.score2;
  bracketMatch.winnerId = winner;
  return { ...tournament, [bracketKey]: bracket, [matchesKey]: mirrors };
}

export function applyTournamentResult(
  event: Event, tournamentId: string, expected: Match, action: ResultAction, actor: BookingActor, now = Date.now(),
): Tournament[] {
  const tournament = event.tournaments.find(item => item.id === tournamentId);
  const bracketMatch = tournament && [
    ...(tournament.playoffs?.matches ?? []).map(item => ({ item, prefix: 'po-' })),
    ...(tournament.consolationBracket?.matches ?? []).map(item => ({ item, prefix: 'co-' })),
  ].find(({ item, prefix }) => `${prefix}${item.id}` === expected.id)?.item;
  const match = tournament && (getTournamentMatches(tournament).find(item => item.id === expected.id)
    ?? (bracketMatch?.player1Id && bracketMatch.player2Id ? {
      id: expected.id, player1Id: bracketMatch.player1Id, player2Id: bracketMatch.player2Id,
      score1: bracketMatch.score1, score2: bracketMatch.score2,
      status: bracketMatch.score1 != null && bracketMatch.score2 != null ? 'completed' as const : 'pending' as const,
    } : undefined));
  if (!tournament || !match) throw new Error('Partita non trovata. Riapri la scheda.');
  const competitorId = isPadelEvent(event)
    ? getTeamForPlayer(getTournamentPadelTeams(tournament), actor.playerId)?.id : actor.playerId;
  if (!actor.isOrganizer && (!competitorId || ![match.player1Id, match.player2Id].includes(competitorId))) {
    throw new Error('Puoi gestire solo i risultati delle tue partite.');
  }
  if (!match.player1Id || !match.player2Id) throw new Error('I giocatori della partita non sono ancora definiti.');
  if (match.player1Id !== expected.player1Id || match.player2Id !== expected.player2Id
    || match.score1 !== expected.score1 || match.score2 !== expected.score2) {
    throw new Error('La partita è stata modificata da un altro utente. Riapri il risultato prima di salvare.');
  }
  let updated: Match;
  if (action.type === 'save') {
    const error = validateMatchScores(String(action.score1), String(action.score2));
    if (error) throw new Error(error);
    updated = {
      ...match, score1: action.score1, score2: action.score2, status: 'completed',
      completedAt: match.completedAt ?? new Date(now).toISOString(),
    };
  } else {
    if (match.score1 == null || match.score2 == null) throw new Error('La partita non ha un risultato da eliminare.');
    const { completedAt, ...rest } = match;
    updated = { ...rest, score1: null, score2: null, status: match.slotId || match.scheduledTime ? 'scheduled' : 'pending' };
  }
  const replace = (matches: Match[]) => matches.map(item => item.id === match.id ? updated : item);
  let next: Tournament = {
    ...tournament,
    groups: tournament.groups.map(group => ({ ...group, matches: replace(group.matches) })),
    ...(tournament.playoffMatches ? { playoffMatches: replace(tournament.playoffMatches) } : {}),
    ...(tournament.consolationMatches ? { consolationMatches: replace(tournament.consolationMatches) } : {}),
  };
  if (bracketMatch || tournament.playoffMatches?.some(item => item.id === match.id) || tournament.consolationMatches?.some(item => item.id === match.id)) {
    next = updateBracket(next, match, updated, action.type === 'reset');
  }
  return event.tournaments.map(item => item.id === tournamentId ? next : item);
}
