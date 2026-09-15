import {
  type Match,
  type PadelIndividualMasterData,
  type Player,
  type SummerRankingMasterPair,
  type SummerRankingRulesConfig,
} from '../types';
import {
  createSummerRankingMasterBracket,
  syncSummerRankingMasterMatches,
} from './summerRanking';

export const PADEL_INDIVIDUAL_RANKING_NAME = 'Paitone Arena League';
export const PADEL_INDIVIDUAL_EVENT_NAMES = [
  'PAITONE ARENA LEAGUE',
  'WINTER LAGUE PADEL PAITONE ARENA',
  'PADEL LEAGUE PAITONE ARENA',
] as const;
export const PADEL_INDIVIDUAL_MASTER_SIZE = 16;
export const PADEL_INDIVIDUAL_MASTER_MIN_MATCHES = 6;
export const PADEL_INDIVIDUAL_PARTICIPATION_POINTS = 5;
export const PADEL_INDIVIDUAL_PARTICIPATION_MONTHLY_CAP = 20;
export const PADEL_INDIVIDUAL_WON_GAMES_CAP = 5;

export const DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG: SummerRankingRulesConfig = {
  diffBandLowMax: 99,
  diffBandMediumMax: 199,
  favoriteWinLow: 20,
  favoriteLossLow: -20,
  favoriteWinMedium: 15,
  favoriteLossMedium: -25,
  favoriteWinHigh: 10,
  favoriteLossHigh: -30,
  underdogWinLow: 20,
  underdogLossLow: -20,
  underdogWinMedium: 25,
  underdogLossMedium: -15,
  underdogWinHigh: 30,
  underdogLossHigh: 10,
  drawMode: 'fixed',
  drawPercentage: 0,
  drawFixed: 0,
  participationBonusEnabled: true,
  participationBase: PADEL_INDIVIDUAL_PARTICIPATION_POINTS,
  participationWeeklyBonus: 0,
  participationWeeklyMinMatches: 1,
  gameDiffBonusEnabled: false,
  gameDiffBonus2: 0,
  gameDiffBonus3: 0,
  gameDiffBonus4plus: 0,
  wonGamesBonusEnabled: true,
  wonGamesMultiplier: 1,
  inactivityMalusEnabled: false,
  inactivityMalusPoints: 0,
  inactivityMalusDays: 999,
  masterSize: PADEL_INDIVIDUAL_MASTER_SIZE,
  masterMinMatches: PADEL_INDIVIDUAL_MASTER_MIN_MATCHES,
  headToHeadLimit: 999,
};

export const DEFAULT_PADEL_INDIVIDUAL_RULES = [
  PADEL_INDIVIDUAL_EVENT_NAMES.join(' / '),
  '',
  'Campionato amatoriale di padel individuale senza coppie fisse.',
  '• Non esistono coppie fisse: ogni giocatore sceglie liberamente compagno e avversari.',
  '• La classifica è individuale e ogni partita può cambiare il ranking di tutti e 4 i giocatori.',
  '• Prima di ogni partita si sommano i punteggi delle due coppie: 0-99 equilibrata, 100-199 differenza media, 200+ differenza alta.',
  '• Punti risultato: equilibrata vincitori +20 / sconfitti -20.',
  '• Differenza media: favoriti +15 se vincono e -25 se perdono; sfavoriti +25 se vincono e -15 se perdono.',
  '• Differenza alta: favoriti +10 se vincono e -30 se perdono; sfavoriti +30 se vincono e +10 anche se perdono.',
  `• Bonus partecipazione: +${PADEL_INDIVIDUAL_PARTICIPATION_POINTS} a partita fino a un massimo di +${PADEL_INDIVIDUAL_PARTICIPATION_MONTHLY_CAP} al mese.`,
  `• Bonus game: +1 per ogni game vinto, massimo +${PADEL_INDIVIDUAL_WON_GAMES_CAP} per partita e per giocatore.`,
  `• Master finale: top ${PADEL_INDIVIDUAL_MASTER_SIZE} con almeno ${PADEL_INDIVIDUAL_MASTER_MIN_MATCHES} partite giocate. Le coppie del Master vengono decise dall'organizzazione.`,
  '• Premi: coppia campione del Master, re del ranking (#1), premio fedeltà (più partite), social player (più compagni diversi).',
  '',
  'Scegli il compagno. Scegli gli avversari. Gioca. Vinci per guadagnare punti. Anche ogni game conta.',
  'NON ESISTONO COPPIE FISSE. LA CLASSIFICA È INDIVIDUALE. OGNI PARTITA PUÒ CAMBIARE IL RANKING.',
].join('\n');

export type PadelIndividualDiffBand = 'balanced' | 'medium' | 'high';

export interface PadelIndividualPreMatchInfo {
  team1Total: number;
  team2Total: number;
  difference: number;
  band: PadelIndividualDiffBand;
  favoriteSide: 1 | 2 | null;
}

export interface PadelIndividualRankingEntry {
  player: Player;
  rank: number;
  points: number;
  startingPoints: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  resultPoints: number;
  participationBonus: number;
  wonGamesBonus: number;
  distinctPartners: number;
  qualifiedForMaster: boolean;
  eligibleForMaster: boolean;
  lastMatchAt?: string;
}

export interface PadelIndividualMatchPlayerBreakdown {
  playerId: string;
  partnerId: string;
  teamSide: 1 | 2;
  outcome: 'win' | 'loss';
  isFavorite: boolean;
  resultPoints: number;
  participationPoints: number;
  wonGamesPoints: number;
  totalPoints: number;
}

export interface PadelIndividualMatchBreakdown {
  matchId: string;
  band: PadelIndividualDiffBand;
  difference: number;
  favoriteSide: 1 | 2 | null;
  team1TotalBefore: number;
  team2TotalBefore: number;
  team1PlayerIds: string[];
  team2PlayerIds: string[];
  score1: number;
  score2: number;
  players: PadelIndividualMatchPlayerBreakdown[];
}

export interface PadelIndividualAwards {
  rankingKing: PadelIndividualRankingEntry | null;
  fidelityLeaders: PadelIndividualRankingEntry[];
  socialLeaders: PadelIndividualRankingEntry[];
  championPair: SummerRankingMasterPair | null;
}

const getStartingPoints = (player: Player) => Number(player.summerRankingStartPoints ?? 0);

const getMatchPlayedAt = (match: Match) => match.completedAt ?? match.scheduledTime ?? '';

const toTimestamp = (value?: string) => {
  if (!value) return Number.NaN;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
};

const sortMatchesByTime = (matches: Match[]) => matches.slice().sort((left, right) => {
  const leftTime = toTimestamp(getMatchPlayedAt(left));
  const rightTime = toTimestamp(getMatchPlayedAt(right));
  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return left.id.localeCompare(right.id);
  if (Number.isNaN(leftTime)) return 1;
  if (Number.isNaN(rightTime)) return -1;
  return leftTime - rightTime || left.id.localeCompare(right.id);
});

export const getPadelIndividualTeamPlayerIds = (match: Match, teamSide: 1 | 2): string[] => {
  const value = teamSide === 1 ? match.team1PlayerIds : match.team2PlayerIds;
  return Array.isArray(value) ? value.filter(Boolean) : [];
};

export const isPadelIndividualMatch = (match: Match): boolean => {
  const team1 = getPadelIndividualTeamPlayerIds(match, 1);
  const team2 = getPadelIndividualTeamPlayerIds(match, 2);
  return team1.length === 2 && team2.length === 2 && new Set([...team1, ...team2]).size === 4;
};

export const getPadelIndividualMatchPlayerIds = (match: Match): string[] => {
  if (isPadelIndividualMatch(match)) {
    return [...getPadelIndividualTeamPlayerIds(match, 1), ...getPadelIndividualTeamPlayerIds(match, 2)];
  }
  return [match.player1Id, match.player2Id].filter(Boolean);
};

export const padelIndividualMatchIncludesPlayer = (match: Match, playerId?: string) =>
  Boolean(playerId) && getPadelIndividualMatchPlayerIds(match).includes(playerId!);

const isCompletedPadelIndividualMatch = (match: Match) =>
  isPadelIndividualMatch(match)
  && match.score1 !== null
  && match.score2 !== null
  && match.score1 !== match.score2
  && (match.status === 'completed' || Boolean(match.completedAt));

export const getPadelIndividualDiffBand = (difference: number): PadelIndividualDiffBand => {
  if (difference <= 99) return 'balanced';
  if (difference <= 199) return 'medium';
  return 'high';
};

const getResultPointsForSide = (band: PadelIndividualDiffBand, isFavorite: boolean, won: boolean) => {
  if (band === 'balanced') {
    return won ? 20 : -20;
  }
  if (band === 'medium') {
    if (isFavorite) return won ? 15 : -25;
    return won ? 25 : -15;
  }
  if (isFavorite) return won ? 10 : -30;
  return won ? 30 : 10;
};

const getMonthKey = (match: Match) => {
  if (typeof match.monthKey === 'string' && /^\d{4}-\d{2}$/.test(match.monthKey.trim())) {
    return match.monthKey.trim();
  }
  const source = (match.completedAt ?? match.scheduledTime ?? '').trim();
  const normalized = source.match(/^(\d{4})-(\d{2})/);
  if (normalized) return `${normalized[1]}-${normalized[2]}`;
  const date = source ? new Date(source) : null;
  if (!date || Number.isNaN(date.getTime())) return 'invalid';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const getParticipantBonus = (monthlyCounts: Map<string, number>, playerId: string, match: Match) => {
  const monthKey = `${playerId}:${getMonthKey(match)}`;
  const currentCount = monthlyCounts.get(monthKey) ?? 0;
  monthlyCounts.set(monthKey, currentCount + 1);
  return currentCount * PADEL_INDIVIDUAL_PARTICIPATION_POINTS >= PADEL_INDIVIDUAL_PARTICIPATION_MONTHLY_CAP
    ? 0
    : PADEL_INDIVIDUAL_PARTICIPATION_POINTS;
};

export const getPadelIndividualPreMatchInfo = (
  ratingsByPlayer: Map<string, number>,
  team1PlayerIds: string[],
  team2PlayerIds: string[],
): PadelIndividualPreMatchInfo | null => {
  if (team1PlayerIds.length !== 2 || team2PlayerIds.length !== 2) return null;
  const team1Total = team1PlayerIds.reduce((total, playerId) => total + (ratingsByPlayer.get(playerId) ?? 0), 0);
  const team2Total = team2PlayerIds.reduce((total, playerId) => total + (ratingsByPlayer.get(playerId) ?? 0), 0);
  const difference = Math.abs(team1Total - team2Total);
  return {
    team1Total,
    team2Total,
    difference,
    band: getPadelIndividualDiffBand(difference),
    favoriteSide: team1Total === team2Total ? null : (team1Total > team2Total ? 1 : 2),
  };
};

const createRatingsMap = (players: Player[]) =>
  new Map<string, number>(players.map(player => [player.id, getStartingPoints(player)] as const));

const buildMatchBreakdown = (
  match: Match,
  ratingsByPlayer: Map<string, number>,
  monthlyCounts: Map<string, number>,
  partnerMap: Map<string, Set<string>>,
): PadelIndividualMatchBreakdown | null => {
  if (!isCompletedPadelIndividualMatch(match)) return null;
  const team1PlayerIds = getPadelIndividualTeamPlayerIds(match, 1);
  const team2PlayerIds = getPadelIndividualTeamPlayerIds(match, 2);
  const preMatchInfo = getPadelIndividualPreMatchInfo(ratingsByPlayer, team1PlayerIds, team2PlayerIds);
  if (!preMatchInfo) return null;

  const score1 = match.score1 ?? 0;
  const score2 = match.score2 ?? 0;
  const team1Won = score1 > score2;
  const team1ResultPoints = getResultPointsForSide(preMatchInfo.band, preMatchInfo.favoriteSide === 1, team1Won);
  const team2ResultPoints = getResultPointsForSide(preMatchInfo.band, preMatchInfo.favoriteSide === 2, !team1Won);
  const team1WonGamesPoints = Math.min(score1, PADEL_INDIVIDUAL_WON_GAMES_CAP);
  const team2WonGamesPoints = Math.min(score2, PADEL_INDIVIDUAL_WON_GAMES_CAP);
  const playedAt = getMatchPlayedAt(match);

  const players = [
    ...team1PlayerIds.map((playerId, index) => {
      const partnerId = team1PlayerIds[index === 0 ? 1 : 0];
      const participationPoints = getParticipantBonus(monthlyCounts, playerId, match);
      partnerMap.get(playerId)?.add(partnerId);
      return {
        playerId,
        partnerId,
        teamSide: 1 as const,
        outcome: team1Won ? 'win' as const : 'loss' as const,
        isFavorite: preMatchInfo.favoriteSide === 1,
        resultPoints: team1ResultPoints,
        participationPoints,
        wonGamesPoints: team1WonGamesPoints,
        totalPoints: team1ResultPoints + participationPoints + team1WonGamesPoints,
      };
    }),
    ...team2PlayerIds.map((playerId, index) => {
      const partnerId = team2PlayerIds[index === 0 ? 1 : 0];
      const participationPoints = getParticipantBonus(monthlyCounts, playerId, match);
      partnerMap.get(playerId)?.add(partnerId);
      return {
        playerId,
        partnerId,
        teamSide: 2 as const,
        outcome: team1Won ? 'loss' as const : 'win' as const,
        isFavorite: preMatchInfo.favoriteSide === 2,
        resultPoints: team2ResultPoints,
        participationPoints,
        wonGamesPoints: team2WonGamesPoints,
        totalPoints: team2ResultPoints + participationPoints + team2WonGamesPoints,
      };
    }),
  ];

  players.forEach(playerBreakdown => {
    ratingsByPlayer.set(playerBreakdown.playerId, (ratingsByPlayer.get(playerBreakdown.playerId) ?? 0) + playerBreakdown.totalPoints);
  });

  return {
    matchId: match.id,
    band: preMatchInfo.band,
    difference: preMatchInfo.difference,
    favoriteSide: preMatchInfo.favoriteSide,
    team1TotalBefore: preMatchInfo.team1Total,
    team2TotalBefore: preMatchInfo.team2Total,
    team1PlayerIds,
    team2PlayerIds,
    score1,
    score2,
    players,
  };
};

export const calculatePadelIndividualMatchBreakdowns = (players: Player[], matches: Match[]) => {
  const confirmedPlayers = players.filter(player => player.status === 'confirmed');
  const ratingsByPlayer = createRatingsMap(confirmedPlayers);
  const monthlyCounts = new Map<string, number>();
  const partnerMap = new Map(confirmedPlayers.map(player => [player.id, new Set<string>()]));
  const breakdowns = new Map<string, PadelIndividualMatchBreakdown>();

  sortMatchesByTime(matches)
    .filter(isCompletedPadelIndividualMatch)
    .forEach(match => {
      const breakdown = buildMatchBreakdown(match, ratingsByPlayer, monthlyCounts, partnerMap);
      if (breakdown) breakdowns.set(match.id, breakdown);
    });

  return breakdowns;
};

export const calculatePadelIndividualCurrentRatings = (players: Player[], matches: Match[]) => {
  const confirmedPlayers = players.filter(player => player.status === 'confirmed');
  const ratingsByPlayer = createRatingsMap(confirmedPlayers);
  const monthlyCounts = new Map<string, number>();
  const partnerMap = new Map(confirmedPlayers.map(player => [player.id, new Set<string>()]));

  sortMatchesByTime(matches)
    .filter(isCompletedPadelIndividualMatch)
    .forEach(match => {
      buildMatchBreakdown(match, ratingsByPlayer, monthlyCounts, partnerMap);
    });

  return ratingsByPlayer;
};

export const calculatePadelIndividualPreMatchRatings = (players: Player[], matches: Match[], targetMatchId?: string) => {
  const targetMatch = targetMatchId ? matches.find(match => match.id === targetMatchId) : undefined;
  if (!targetMatchId || !targetMatch) return calculatePadelIndividualCurrentRatings(players, matches);

  const targetTimestamp = toTimestamp(getMatchPlayedAt(targetMatch));
  const filteredMatches = sortMatchesByTime(matches).filter(match => {
    if (match.id === targetMatchId) return false;
    if (!isCompletedPadelIndividualMatch(match)) return false;
    const matchTimestamp = toTimestamp(getMatchPlayedAt(match));
    if (Number.isNaN(targetTimestamp)) return true;
    if (Number.isNaN(matchTimestamp)) return false;
    return matchTimestamp < targetTimestamp || (matchTimestamp === targetTimestamp && match.id.localeCompare(targetMatchId) < 0);
  });

  const confirmedPlayers = players.filter(player => player.status === 'confirmed');
  const ratingsByPlayer = createRatingsMap(confirmedPlayers);
  const monthlyCounts = new Map<string, number>();
  const partnerMap = new Map(confirmedPlayers.map(player => [player.id, new Set<string>()]));
  filteredMatches.forEach(match => {
    buildMatchBreakdown(match, ratingsByPlayer, monthlyCounts, partnerMap);
  });
  return ratingsByPlayer;
};

export const calculatePadelIndividualRanking = (players: Player[], matches: Match[]): PadelIndividualRankingEntry[] => {
  const confirmedPlayers = players.filter(player => player.status === 'confirmed');
  const stats = new Map(confirmedPlayers.map(player => [player.id, {
    player,
    points: getStartingPoints(player),
    startingPoints: getStartingPoints(player),
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    resultPoints: 0,
    participationBonus: 0,
    wonGamesBonus: 0,
    distinctPartners: 0,
    lastMatchAt: undefined as string | undefined,
  }]));
  const partnerMap = new Map(confirmedPlayers.map(player => [player.id, new Set<string>()]));
  const ratingsByPlayer = createRatingsMap(confirmedPlayers);
  const monthlyCounts = new Map<string, number>();

  sortMatchesByTime(matches)
    .filter(isCompletedPadelIndividualMatch)
    .forEach(match => {
      const breakdown = buildMatchBreakdown(match, ratingsByPlayer, monthlyCounts, partnerMap);
      if (!breakdown) return;
      breakdown.players.forEach(playerBreakdown => {
        const entry = stats.get(playerBreakdown.playerId);
        if (!entry) return;
        entry.points = ratingsByPlayer.get(playerBreakdown.playerId) ?? entry.points;
        entry.matchesPlayed += 1;
        entry.resultPoints += playerBreakdown.resultPoints;
        entry.participationBonus += playerBreakdown.participationPoints;
        entry.wonGamesBonus += playerBreakdown.wonGamesPoints;
        entry.lastMatchAt = getMatchPlayedAt(match);
        if (playerBreakdown.outcome === 'win') entry.wins += 1;
        else entry.losses += 1;
      });
    });

  stats.forEach((entry, playerId) => {
    entry.distinctPartners = partnerMap.get(playerId)?.size ?? 0;
    entry.points = Math.round(entry.points * 10) / 10;
  });

  const ranking = Array.from(stats.values())
    .sort((left, right) =>
      right.points - left.points
      || right.wins - left.wins
      || right.matchesPlayed - left.matchesPlayed
      || left.player.name.localeCompare(right.player.name)
    )
    .map((entry, index) => ({
      player: entry.player,
      rank: index + 1,
      points: entry.points,
      startingPoints: entry.startingPoints,
      matchesPlayed: entry.matchesPlayed,
      wins: entry.wins,
      losses: entry.losses,
      resultPoints: entry.resultPoints,
      participationBonus: entry.participationBonus,
      wonGamesBonus: entry.wonGamesBonus,
      distinctPartners: entry.distinctPartners,
      qualifiedForMaster: false,
      eligibleForMaster: entry.matchesPlayed >= PADEL_INDIVIDUAL_MASTER_MIN_MATCHES,
      lastMatchAt: entry.lastMatchAt,
    }));

  const autoQualifiedIds = new Set(
    ranking
      .filter(entry => entry.eligibleForMaster)
      .slice(0, PADEL_INDIVIDUAL_MASTER_SIZE)
      .map(entry => entry.player.id),
  );

  return ranking.map(entry => ({
    ...entry,
    qualifiedForMaster: autoQualifiedIds.has(entry.player.id),
  }));
};

export const getPadelIndividualAutoQualifiedPlayerIds = (ranking: PadelIndividualRankingEntry[]) =>
  ranking
    .filter(entry => entry.eligibleForMaster)
    .slice(0, PADEL_INDIVIDUAL_MASTER_SIZE)
    .map(entry => entry.player.id);

export const createPadelIndividualMasterData = (
  qualifiedPlayerIds: string[],
  pairs: SummerRankingMasterPair[],
): PadelIndividualMasterData | null => {
  if (qualifiedPlayerIds.length !== PADEL_INDIVIDUAL_MASTER_SIZE || pairs.length !== PADEL_INDIVIDUAL_MASTER_SIZE / 2) {
    return null;
  }
  const bracket = createSummerRankingMasterBracket(pairs.map(pair => pair.id));
  return {
    qualifiedPlayerIds,
    pairs,
    bracket,
    matches: syncSummerRankingMasterMatches(bracket),
    generatedAt: new Date().toISOString(),
  };
};

export const removePlayerFromPadelIndividualMaster = (
  master: PadelIndividualMasterData | undefined,
  playerId: string,
): PadelIndividualMasterData | undefined => {
  if (!master) return master;
  const qualifiedPlayerIds = master.qualifiedPlayerIds.filter(id => id !== playerId);
  const pairs = master.pairs.filter(pair => pair.player1Id !== playerId && pair.player2Id !== playerId);
  if (qualifiedPlayerIds.length === master.qualifiedPlayerIds.length && pairs.length === master.pairs.length) {
    return master;
  }
  return {
    qualifiedPlayerIds,
    pairs,
    bracket: null,
    matches: [],
    generatedAt: undefined,
  };
};

const getChampionPairId = (master?: PadelIndividualMasterData) => {
  if (!master?.matches?.length) return null;
  const finalMatch = master.matches.find(match => match.id === 'master-final')
    ?? master.matches
      .filter(match => match.status === 'completed' && match.score1 !== null && match.score2 !== null && match.score1 !== match.score2)
      .slice()
      .sort((left, right) => right.round - left.round || right.label.localeCompare(left.label))[0]
    ?? null;
  if (!finalMatch || finalMatch.score1 === null || finalMatch.score2 === null || finalMatch.score1 === finalMatch.score2) return null;
  return (finalMatch.score1 ?? 0) > (finalMatch.score2 ?? 0) ? finalMatch.player1Id : finalMatch.player2Id;
};

export const calculatePadelIndividualAwards = (
  ranking: PadelIndividualRankingEntry[],
  master?: PadelIndividualMasterData,
): PadelIndividualAwards => {
  const fidelityTop = ranking.reduce((max, entry) => Math.max(max, entry.matchesPlayed), 0);
  const socialTop = ranking.reduce((max, entry) => Math.max(max, entry.distinctPartners), 0);
  const championPairId = getChampionPairId(master);
  return {
    rankingKing: ranking[0] ?? null,
    fidelityLeaders: ranking.filter(entry => entry.matchesPlayed > 0 && entry.matchesPlayed === fidelityTop),
    socialLeaders: ranking.filter(entry => entry.distinctPartners > 0 && entry.distinctPartners === socialTop),
    championPair: master?.pairs.find(pair => pair.id === championPairId) ?? null,
  };
};

export const getPadelIndividualPairName = (
  pair: SummerRankingMasterPair,
  playerMap: Map<string, Player>,
) => `${playerMap.get(pair.player1Id)?.name ?? pair.player1Id} / ${playerMap.get(pair.player2Id)?.name ?? pair.player2Id}`;

export const getPadelIndividualBandLabel = (band: PadelIndividualDiffBand) => {
  if (band === 'balanced') return 'Equilibrata';
  if (band === 'medium') return 'Differenza media';
  return 'Differenza alta';
};

export const getPadelIndividualFavoritePairText = (
  info: PadelIndividualPreMatchInfo | null,
  team1PlayerIds: string[],
  team2PlayerIds: string[],
  playerMap: Map<string, Player>,
) => {
  if (!info)   return 'Seleziona quattro giocatori registrati per calcolare fascia e favorita.';
  if (info.favoriteSide === null) return 'Nessuna coppia favorita';
  const ids = info.favoriteSide === 1 ? team1PlayerIds : team2PlayerIds;
  return ids.map(playerId => playerMap.get(playerId)?.name ?? playerId).join(' / ');
};

export const getPadelIndividualBandTone = (band: PadelIndividualDiffBand) => {
  if (band === 'balanced') return 'bg-green-500/15 text-green-200 border-green-400/30';
  if (band === 'medium') return 'bg-yellow-500/15 text-yellow-100 border-yellow-400/30';
  return 'bg-red-500/15 text-red-200 border-red-400/30';
};
