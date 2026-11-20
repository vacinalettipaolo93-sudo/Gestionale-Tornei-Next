import { type Match } from '../types';

type MatchParticipants = Pick<Match, 'player1Id' | 'player2Id'>;

const matchupKey = (player1Id: string, player2Id: string) =>
  JSON.stringify([player1Id, player2Id]);

export function getMissingGroupMatchups(
  playerIds: string[],
  matches: MatchParticipants[],
  isDoubleRoundRobin: boolean,
): Array<[string, string]> {
  const existingMatchups = new Set(
    matches.map(match => matchupKey(match.player1Id, match.player2Id)),
  );
  const missingMatchups: Array<[string, string]> = [];
  const competitors = [...new Set(playerIds)];

  const addIfMissing = (player1Id: string, player2Id: string) => {
    const key = matchupKey(player1Id, player2Id);
    if (existingMatchups.has(key)) return;
    existingMatchups.add(key);
    missingMatchups.push([player1Id, player2Id]);
  };

  for (let i = 0; i < competitors.length; i++) {
    for (let j = i + 1; j < competitors.length; j++) {
      const player1Id = competitors[i];
      const player2Id = competitors[j];
      const hasEitherFixture =
        existingMatchups.has(matchupKey(player1Id, player2Id))
        || existingMatchups.has(matchupKey(player2Id, player1Id));

      if (isDoubleRoundRobin || !hasEitherFixture) {
        addIfMissing(player1Id, player2Id);
      }
      if (isDoubleRoundRobin) {
        addIfMissing(player2Id, player1Id);
      }
    }
  }

  return missingMatchups;
}
