import { type Group, type Player, type StandingsEntry, type TournamentSettings } from '../types';

export const calculateStandings = (group: Group, players: Player[], settings: TournamentSettings): StandingsEntry[] => {
  const standingsMap: { [key: string]: StandingsEntry } = {};

  (Array.isArray(group.playerIds) ? group.playerIds : []).forEach(playerId => {
    standingsMap[playerId] = {
      playerId, played: 0, wins: 0, draws: 0, losses: 0, points: 0,
      goalsFor: 0, goalsAgainst: 0, goalDifference: 0
    };
  });

  (Array.isArray(group.matches) ? group.matches : []).forEach(match => {
    if (match.status !== 'completed' || typeof match.score1 !== 'number' || typeof match.score2 !== 'number'
      || !Number.isSafeInteger(match.score1) || !Number.isSafeInteger(match.score2)
      || match.score1 < 0 || match.score2 < 0) return;

    const { player1Id, player2Id, score1, score2 } = match;
    const stats1 = standingsMap[player1Id];
    const stats2 = standingsMap[player2Id];

    if (!stats1 || !stats2) return;

    stats1.played++;
    stats2.played++;
    stats1.goalsFor += score1;
    stats2.goalsFor += score2;
    stats1.goalsAgainst += score2;
    stats2.goalsAgainst += score1;
    stats1.goalDifference = stats1.goalsFor - stats1.goalsAgainst;
    stats2.goalDifference = stats2.goalsFor - stats2.goalsAgainst;

    if (score1 > score2) {
      stats1.wins++;
      stats2.losses++;
      const diff = score1 - score2;
      const rule = settings.pointRules.find(r => diff >= r.minDiff && diff <= r.maxDiff);
      if(rule) {
        stats1.points += rule.winnerPoints;
        stats2.points += rule.loserPoints;
      }
    } else if (score2 > score1) {
      stats2.wins++;
      stats1.losses++;
      const diff = score2 - score1;
      const rule = settings.pointRules.find(r => diff >= r.minDiff && diff <= r.maxDiff);
      if(rule) {
        stats2.points += rule.winnerPoints;
        stats1.points += rule.loserPoints;
      }
    } else {
      stats1.draws++;
      stats2.draws++;
      stats1.points += settings.pointsPerDraw;
      stats2.points += settings.pointsPerDraw;
    }
  });

  return Object.values(standingsMap).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    
    for (const tieBreaker of settings.tieBreakers) {
        let comparison = 0;
        switch (tieBreaker) {
            case 'headToHead':
                const match = (Array.isArray(group.matches) ? group.matches : []).find(m =>
                    m.status === 'completed' &&
                    ((m.player1Id === a.playerId && m.player2Id === b.playerId) ||
                     (m.player1Id === b.playerId && m.player2Id === a.playerId))
                );
                if (match && match.score1 !== null && match.score2 !== null) {
                    if (match.score1 !== match.score2) {
                        const winnerId = match.score1 > match.score2 ? match.player1Id : match.player2Id;
                        if (winnerId === a.playerId) return -1;
                        if (winnerId === b.playerId) return 1;
                    }
                }
                break;
            case 'wins':
                comparison = b.wins - a.wins;
                break;
            case 'goalDifference':
                comparison = b.goalDifference - a.goalDifference;
                break;
            case 'goalsFor':
                comparison = b.goalsFor - a.goalsFor;
                break;
        }
        if (comparison !== 0) return comparison;
    }
    return 0;
  });
};
