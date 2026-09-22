import {
  type Match,
  type Player,
  type PlayoffBracket,
  type PlayoffMatch,
  type SummerRankingMasterData,
  type SummerRankingMasterFormat,
  type SummerRankingMasterGroup,
  type SummerRankingMasterMatch,
  type SummerRankingRulesConfig,
} from '../types';

export const SUMMER_RANKING_NAME = 'Summer Ranking Next';
export const SUMMER_RANKING_MASTER_SIZE = 8;
export const SUMMER_RANKING_MASTER_MIN_MATCHES = 5;

export const DEFAULT_RULES_CONFIG: SummerRankingRulesConfig = {
  diffBandLowMax: 99,
  diffBandMediumMax: 199,

  favoriteWinLow: 20,
  favoriteLossLow: -20,
  favoriteWinMedium: 10,
  favoriteLossMedium: -30,
  favoriteWinHigh: 5,
  favoriteLossHigh: -40,

  underdogWinLow: 20,
  underdogLossLow: -20,
  underdogWinMedium: 30,
  underdogLossMedium: -10,
  underdogWinHigh: 40,
  underdogLossHigh: -5,

  drawMode: 'percentage',
  drawPercentage: 50,
  drawFixed: 10,

  participationBonusEnabled: true,
  participationBase: 5,
  participationMonthlyCap: 0,
  participationWeeklyBonus: 10,
  participationWeeklyMinMatches: 2,

  gameDiffBonusEnabled: true,
  gameDiffBonus2: 1,
  gameDiffBonus3: 2,
  gameDiffBonus4plus: 3,

  wonGamesBonusEnabled: true,
  wonGamesMultiplier: 1,
  wonGamesCap: 0,

  inactivityMalusEnabled: true,
  inactivityMalusPoints: 5,
  inactivityMalusDays: 10,

  masterSize: 8,
  masterMinMatches: 5,

  headToHeadLimit: 5,
};

export const normalizeRulesConfig = (config?: Partial<SummerRankingRulesConfig> | null): SummerRankingRulesConfig => ({
  ...DEFAULT_RULES_CONFIG,
  ...config,
  drawMode: (config?.drawMode === 'percentage' || config?.drawMode === 'fixed') ? config.drawMode : DEFAULT_RULES_CONFIG.drawMode,
  participationBonusEnabled: config?.participationBonusEnabled ?? DEFAULT_RULES_CONFIG.participationBonusEnabled,
  gameDiffBonusEnabled: config?.gameDiffBonusEnabled ?? DEFAULT_RULES_CONFIG.gameDiffBonusEnabled,
  wonGamesBonusEnabled: config?.wonGamesBonusEnabled ?? DEFAULT_RULES_CONFIG.wonGamesBonusEnabled,
  wonGamesMultiplier: Number.isFinite(config?.wonGamesMultiplier) ? Number(config!.wonGamesMultiplier) : DEFAULT_RULES_CONFIG.wonGamesMultiplier,
  participationMonthlyCap: Number.isFinite(config?.participationMonthlyCap) ? Math.max(0, Number(config!.participationMonthlyCap)) : DEFAULT_RULES_CONFIG.participationMonthlyCap,
  wonGamesCap: Number.isFinite(config?.wonGamesCap) ? Math.max(0, Number(config!.wonGamesCap)) : DEFAULT_RULES_CONFIG.wonGamesCap,
  inactivityMalusEnabled: config?.inactivityMalusEnabled ?? DEFAULT_RULES_CONFIG.inactivityMalusEnabled,
  masterSize: Number.isFinite(config?.masterSize) ? Math.max(1, Math.floor(Number(config!.masterSize))) : DEFAULT_RULES_CONFIG.masterSize,
  masterMinMatches: Number.isFinite(config?.masterMinMatches) ? Math.max(0, Math.floor(Number(config!.masterMinMatches))) : DEFAULT_RULES_CONFIG.masterMinMatches,
  headToHeadLimit: Number.isFinite(config?.headToHeadLimit) ? Math.max(1, Math.floor(Number(config!.headToHeadLimit))) : DEFAULT_RULES_CONFIG.headToHeadLimit,
});

export const generateRulesText = (config: SummerRankingRulesConfig): string => {
  const lo = config.diffBandLowMax;
  const med = config.diffBandMediumMax;
  const drawDesc = config.drawMode === 'fixed'
    ? `valore fisso ${config.drawFixed} punti`
    : `${config.drawPercentage}% dei punti che si sarebbero vinti`;
  const lines = [
    SUMMER_RANKING_NAME,
    '',
    '• Ranking globale unico con tutti i giocatori iscritti.',
    '• Il punteggio iniziale viene impostato manualmente dall\u2019amministratore.',
    `• Fasce differenza punti (differenza assoluta): 0-${lo} = Pari livello, ${lo + 1}-${med} = Medio livello, ${med + 1}+ = Alto livello.`,
    `• Se il favorito vince (pari/medio/alto): +${config.favoriteWinLow}/+${config.favoriteWinMedium}/+${config.favoriteWinHigh} pt; se perde: ${config.favoriteLossLow}/${config.favoriteLossMedium}/${config.favoriteLossHigh} pt.`,
    `• Se lo sfavorito vince (pari/medio/alto): +${config.underdogWinLow}/+${config.underdogWinMedium}/+${config.underdogWinHigh} pt; se perde: ${config.underdogLossLow}/${config.underdogLossMedium}/${config.underdogLossHigh} pt.`,
    `• Pareggio: ${drawDesc}. Ai game fatti in partita si aggiungono al punteggio base.`,
  ];
  if (config.wonGamesBonusEnabled) {
    const mult = config.wonGamesMultiplier === 2 ? 'doppi (×2)' : config.wonGamesMultiplier === 1 ? 'normali (×1)' : `personalizzati (×${config.wonGamesMultiplier})`;
    lines.push(`• Bonus game fatti: i game fatti dal vincitore si sommano ai punti vittoria (${mult}); i game dello sconfitto riducono la penalità dello stesso importo (min. 0 perdita).`);
  }
  if (config.participationBonusEnabled) {
    lines.push(`• Bonus partecipazione: +${config.participationBase} punti a partita.`);
  }
  if (config.gameDiffBonusEnabled) {
    lines.push(`• Bonus differenza game al vincitore: +${config.gameDiffBonus2} con 2 game di scarto, +${config.gameDiffBonus3} con 3, +${config.gameDiffBonus4plus} con 4 o più.`);
  }
  if (config.inactivityMalusEnabled) {
    lines.push(`• Malus inattività: -${config.inactivityMalusPoints} punti ogni ${config.inactivityMalusDays} giorni consecutivi senza partite.`);
  }
  lines.push(
    `• Master finale: top ${config.masterSize} della classifica qualificati automaticamente, con aggiornamento in tempo reale fino a eventuale override manuale.`,
    `• Limite massimo: ${config.headToHeadLimit} scontri contro lo stesso avversario.`,
  );
  return lines.join('\n');
};

export const DEFAULT_SUMMER_RANKING_RULES = generateRulesText(DEFAULT_RULES_CONFIG);

type Trend = 'up' | 'down' | 'steady';

export interface SummerRankingEntry {
  player: Player;
  rank: number;
  points: number;
  startingPoints: number;
  wins: number;
  draws: number;
  losses: number;
  matchesPlayed: number;
  resultPoints: number;
  participationBonus: number;
  wonGamesBonus: number;
  gameDiffBonus: number;
  inactivityMalus: number;
  recentForm: Array<'W' | 'D' | 'L'>;
  trend: Trend;
  qualifiedForMaster: boolean;
  lastMatchAt?: string;
  upcomingMatches: number;
}

export interface SummerRankingMatchPlayerBreakdown {
  playerId: string;
  outcome: 'win' | 'loss' | 'draw';
  resultPoints: number;
  gameFatti: number;
  gameFattiPoints: number;
  participationPoints: number;
  gameDiffPoints: number;
  rulesAdjustmentPoints: number;
  totalPoints: number;
}

export interface SummerRankingMatchBreakdown {
  matchId: string;
  player1: SummerRankingMatchPlayerBreakdown;
  player2: SummerRankingMatchPlayerBreakdown;
}

const getStartingPoints = (player: Player) => Number(player.summerRankingStartPoints ?? 0);

const MASTER_GROUP_CONFIGS: Array<{ id: string; name: string; seeds: number[] }> = [
  { id: 'master-group-a', name: 'Girone A', seeds: [0, 3, 4, 7] },
  { id: 'master-group-b', name: 'Girone B', seeds: [1, 2, 5, 6] },
];

const MASTER_GROUP_PAIRINGS: Array<[number, number]> = [
  [0, 1],
  [2, 3],
  [0, 2],
  [1, 3],
  [0, 3],
  [1, 2],
];

const getStandardSeedOrder = (size: number): number[] => {
  if (size <= 1) return [1];
  if (size === 2) return [1, 2];
  const previousOrder = getStandardSeedOrder(size / 2);
  return previousOrder.flatMap(seed => [seed, size + 1 - seed]);
};

const getMasterMatchStage = (
  match: Pick<PlayoffMatch, 'round' | 'isBronzeFinal'>,
  maxRound: number,
): SummerRankingMasterMatch['stage'] => {
  if (match.isBronzeFinal) return 'thirdPlace';
  if (match.round >= maxRound) return 'final';
  if (match.round === maxRound - 1) return 'semifinal';
  return 'quarterfinal';
};

export const getSummerRankingDiffBand = (diff: number, config?: SummerRankingRulesConfig) => {
  const cfg = config ?? DEFAULT_RULES_CONFIG;
  if (diff <= cfg.diffBandLowMax) return 'low' as const;
  if (diff <= cfg.diffBandMediumMax) return 'medium' as const;
  return 'high' as const;
};

export const getSummerRankingWinPoints = (winnerPoints: number, loserPoints: number, config?: SummerRankingRulesConfig) => {
  const cfg = config ?? DEFAULT_RULES_CONFIG;
  const diff = Math.abs(winnerPoints - loserPoints);
  const band = getSummerRankingDiffBand(diff, cfg);
  const winnerIsFavorite = winnerPoints >= loserPoints;
  if (winnerIsFavorite) {
    return band === 'low' ? cfg.favoriteWinLow : band === 'medium' ? cfg.favoriteWinMedium : cfg.favoriteWinHigh;
  }
  return band === 'low' ? cfg.underdogWinLow : band === 'medium' ? cfg.underdogWinMedium : cfg.underdogWinHigh;
};

/**
 * Returns the (negative) points the current player would lose if they lose against an opponent.
 * currentPlayerPoints: points of the logged-in player
 * opponentPoints: points of the opponent
 */
export const getSummerRankingLossPoints = (currentPlayerPoints: number, opponentPoints: number, config?: SummerRankingRulesConfig) => {
  const cfg = config ?? DEFAULT_RULES_CONFIG;
  const diff = Math.abs(currentPlayerPoints - opponentPoints);
  const band = getSummerRankingDiffBand(diff, cfg);
  const currentPlayerIsFavorite = currentPlayerPoints >= opponentPoints;
  if (currentPlayerIsFavorite) {
    return band === 'low' ? cfg.favoriteLossLow : band === 'medium' ? cfg.favoriteLossMedium : cfg.favoriteLossHigh;
  }
  return band === 'low' ? cfg.underdogLossLow : band === 'medium' ? cfg.underdogLossMedium : cfg.underdogLossHigh;
};

const hasValidKnockoutScore = (match: Pick<PlayoffMatch, 'player1Id' | 'player2Id' | 'score1' | 'score2'>) =>
  !!match.player1Id &&
  !!match.player2Id &&
  match.score1 !== null &&
  match.score2 !== null &&
  match.score1 >= 0 &&
  match.score2 >= 0 &&
  match.score1 !== match.score2;

const getWinnerId = (match: Pick<PlayoffMatch, 'player1Id' | 'player2Id' | 'score1' | 'score2'>) => {
  if (!hasValidKnockoutScore(match)) return null;
  return (match.score1 ?? 0) > (match.score2 ?? 0) ? match.player1Id : match.player2Id;
};

const getLoserId = (match: Pick<PlayoffMatch, 'player1Id' | 'player2Id' | 'score1' | 'score2'>) => {
  if (!hasValidKnockoutScore(match)) return null;
  return (match.score1 ?? 0) > (match.score2 ?? 0) ? match.player2Id : match.player1Id;
};

const setParticipants = (
  match: PlayoffMatch,
  player1Id: string | null,
  player2Id: string | null,
) => {
  const playersChanged = match.player1Id !== player1Id || match.player2Id !== player2Id;
  match.player1Id = player1Id;
  match.player2Id = player2Id;

  if (!player1Id || !player2Id || playersChanged) {
    match.score1 = null;
    match.score2 = null;
    match.winnerId = null;
    return;
  }

  match.winnerId = getWinnerId(match);
};

export const getSummerRankingAutoQualifiedPlayerIds = (ranking: SummerRankingEntry[], config?: SummerRankingRulesConfig) => {
  const cfg = config ?? DEFAULT_RULES_CONFIG;
  return ranking
    .slice(0, cfg.masterSize)
    .map(entry => entry.player.id);
};

export const getSummerRankingMasterQualifiedPlayerIds = (
  ranking: SummerRankingEntry[],
  master?: SummerRankingMasterData,
  config?: SummerRankingRulesConfig,
) => {
  const cfg = config ?? DEFAULT_RULES_CONFIG;
  const rankingPlayerIds = new Set(ranking.map(entry => entry.player.id));
  const manualQualified = Array.isArray(master?.manualQualifiedPlayerIds)
    ? master!.manualQualifiedPlayerIds.reduce<string[]>((acc, playerId) => {
      if (!playerId || acc.includes(playerId) || !rankingPlayerIds.has(playerId)) return acc;
      acc.push(playerId);
      return acc;
    }, [])
    : [];

  return manualQualified.length === cfg.masterSize
    ? manualQualified
    : getSummerRankingAutoQualifiedPlayerIds(ranking, cfg);
};

export const getSummerRankingMasterFormat = (master?: SummerRankingMasterData): SummerRankingMasterFormat =>
  master?.format === 'groups' || (Array.isArray(master?.groups) && master.groups.length > 0) ? 'groups' : 'bracket';

export const createSummerRankingMasterBracket = (qualifiedPlayerIds: string[]): PlayoffBracket => {
  const bracketSize = qualifiedPlayerIds.length;
  if (bracketSize === 1) {
    return {
      matches: [],
      isGenerated: true,
      finalId: null,
      bronzeFinalId: null,
    };
  }
  const isPowerOfTwo = bracketSize > 1 && (bracketSize & (bracketSize - 1)) === 0;
  if (!isPowerOfTwo) {
    return {
      matches: [],
      isGenerated: false,
      finalId: null,
      bronzeFinalId: null,
    };
  }

  const seedOrder = getStandardSeedOrder(bracketSize);
  const totalRounds = Math.log2(bracketSize);
  const includeBronzeFinal = bracketSize >= 8;
  const matches: PlayoffMatch[] = [];
  const matchById = new Map<string, PlayoffMatch>();
  const roundMatchIds: string[][] = [];
  let globalMatchIndex = 0;

  for (let round = 1; round <= totalRounds; round += 1) {
    const matchesInRound = 2 ** (totalRounds - round);
    const idsForRound: string[] = [];
    for (let matchIndex = 0; matchIndex < matchesInRound; matchIndex += 1) {
      const pairStartIndex = matchIndex * 2;
      const player1Seed = round === 1 ? seedOrder[pairStartIndex] : null;
      const player2Seed = round === 1 ? seedOrder[pairStartIndex + 1] : null;
      const isFinalMatch = round === totalRounds;
      const isSemifinalMatch = round === totalRounds - 1;
      const id = isFinalMatch
        ? 'master-final'
        : isSemifinalMatch
          ? `master-sf-${matchIndex + 1}`
          : round === 1 && bracketSize >= 8
            ? `master-qf-${matchIndex + 1}`
            : `master-r${round}-m${matchIndex + 1}`;
      idsForRound.push(id);
      const match: PlayoffMatch = {
        id,
        round,
        matchIndex: globalMatchIndex,
        player1Id: player1Seed ? qualifiedPlayerIds[player1Seed - 1] ?? null : null,
        player2Id: player2Seed ? qualifiedPlayerIds[player2Seed - 1] ?? null : null,
        score1: null,
        score2: null,
        winnerId: null,
        nextMatchId: isFinalMatch ? null : '',
        loserGoesToBronzeFinal: includeBronzeFinal && isSemifinalMatch,
      };
      matches.push(match);
      matchById.set(id, match);
      globalMatchIndex += 1;
    }
    roundMatchIds.push(idsForRound);
  }

  for (let round = 1; round < totalRounds; round += 1) {
    roundMatchIds[round - 1].forEach((matchId, index) => {
      const match = matchById.get(matchId);
      if (!match) return;
      match.nextMatchId = roundMatchIds[round][Math.floor(index / 2)] ?? null;
    });
  }

  let bronzeFinalId: string | null = null;
  if (includeBronzeFinal) {
    bronzeFinalId = 'master-third';
    matches.push({
      id: bronzeFinalId,
      round: totalRounds,
      matchIndex: globalMatchIndex,
      player1Id: null,
      player2Id: null,
      score1: null,
      score2: null,
      winnerId: null,
      nextMatchId: null,
      isBronzeFinal: true,
    });
  }

  return recomputeSummerRankingMasterBracket({
    matches,
    isGenerated: true,
    finalId: 'master-final',
    bronzeFinalId,
  });
};

export const recomputeSummerRankingMasterBracket = (bracket: PlayoffBracket): PlayoffBracket => {
  const nextBracket = JSON.parse(JSON.stringify(bracket)) as PlayoffBracket;
  const matchMap = new Map(nextBracket.matches.map(match => [match.id, match]));
  const sortedMatches = nextBracket.matches
    .slice()
    .sort((a, b) => a.round - b.round || a.matchIndex - b.matchIndex);

  sortedMatches.forEach(match => {
    match.winnerId = getWinnerId(match);
  });

  const nextMatchSources = new Map<string, PlayoffMatch[]>();
  sortedMatches.forEach(match => {
    if (!match.nextMatchId) return;
    const sources = nextMatchSources.get(match.nextMatchId) ?? [];
    sources.push(match);
    nextMatchSources.set(match.nextMatchId, sources);
  });

  sortedMatches
    .filter(match => !match.isBronzeFinal)
    .forEach(match => {
      const sources = nextMatchSources.get(match.id) ?? [];
      if (sources.length === 0) return;
      setParticipants(match, sources[0]?.winnerId ?? null, sources[1]?.winnerId ?? null);
    });

  if (nextBracket.bronzeFinalId) {
    const bronzeFinal = matchMap.get(nextBracket.bronzeFinalId);
    if (bronzeFinal) {
      const semifinalLosers = sortedMatches
        .filter(match => match.loserGoesToBronzeFinal)
        .map(match => getLoserId(match));
      setParticipants(bronzeFinal, semifinalLosers[0] ?? null, semifinalLosers[1] ?? null);
    }
  }

  return nextBracket;
};

export const syncSummerRankingMasterMatches = (
  bracket: PlayoffBracket,
  previousMatches: SummerRankingMasterMatch[] = [],
  completedAtFallback = new Date().toISOString(),
): SummerRankingMasterMatch[] => {
  const previousMap = new Map(previousMatches.map(match => [match.id, match]));
  const maxRound = bracket.matches.reduce((max, match) => Math.max(max, match.round), 0);
  const stageCounters = new Map<SummerRankingMasterMatch['stage'], number>();

  return bracket.matches
    .slice()
    .sort((a, b) => a.round - b.round || a.matchIndex - b.matchIndex)
    .map(match => {
      const previousMatch = previousMap.get(match.id);
      const samePlayers = previousMatch?.player1Id === match.player1Id && previousMatch?.player2Id === match.player2Id;
      const stage = getMasterMatchStage(match, maxRound);
      const currentStageCount = (stageCounters.get(stage) ?? 0) + 1;
      stageCounters.set(stage, currentStageCount);
      const label = stage === 'final'
        ? 'Finale'
        : stage === 'thirdPlace'
          ? 'Finale 3°/4° posto'
          : stage === 'semifinal'
            ? `Semifinale ${currentStageCount}`
            : `Quarto ${currentStageCount}`;
      const isCompleted = hasValidKnockoutScore(match);

      return {
        id: match.id,
        round: match.round,
        label,
        stage,
        player1Id: match.player1Id,
        player2Id: match.player2Id,
        score1: isCompleted ? match.score1 : null,
        score2: isCompleted ? match.score2 : null,
        status: isCompleted
          ? 'completed'
          : samePlayers && previousMatch?.slotId && match.player1Id && match.player2Id
            ? 'scheduled'
            : 'pending',
        scheduledTime: samePlayers ? previousMatch?.scheduledTime : undefined,
        location: samePlayers ? previousMatch?.location : undefined,
        field: samePlayers ? previousMatch?.field : undefined,
        slotId: samePlayers ? previousMatch?.slotId : undefined,
        completedAt: isCompleted ? previousMatch?.completedAt ?? completedAtFallback : undefined,
      };
    });
};

export const createSummerRankingMasterGroups = (qualifiedPlayerIds: string[]): SummerRankingMasterGroup[] =>
  MASTER_GROUP_CONFIGS.map(group => ({
    id: group.id,
    name: group.name,
    playerIds: group.seeds.map(seedIndex => qualifiedPlayerIds[seedIndex]).filter((playerId): playerId is string => Boolean(playerId)),
  }));

export const createSummerRankingMasterGroupMatches = (
  groups: SummerRankingMasterGroup[],
  previousMatches: SummerRankingMasterMatch[] = [],
  completedAtFallback = new Date().toISOString(),
): SummerRankingMasterMatch[] => {
  const previousMap = new Map(previousMatches.map(match => [match.id, match]));

  return groups.flatMap((group, groupIndex) =>
    MASTER_GROUP_PAIRINGS.map(([firstSeedIndex, secondSeedIndex], matchIndex) => {
      const matchId = `${group.id}-match-${matchIndex + 1}`;
      const player1Id = group.playerIds[firstSeedIndex] ?? null;
      const player2Id = group.playerIds[secondSeedIndex] ?? null;
      const previousMatch = previousMap.get(matchId);
      const samePlayers = previousMatch?.player1Id === player1Id && previousMatch?.player2Id === player2Id;
      const isCompleted = samePlayers && hasValidKnockoutScore({ player1Id, player2Id, score1: previousMatch?.score1 ?? null, score2: previousMatch?.score2 ?? null });

      return {
        id: matchId,
        round: groupIndex + 1,
        label: `${group.name} • Match ${matchIndex + 1}`,
        stage: 'group',
        groupId: group.id,
        player1Id,
        player2Id,
        score1: isCompleted ? previousMatch?.score1 ?? null : null,
        score2: isCompleted ? previousMatch?.score2 ?? null : null,
        status: isCompleted
          ? 'completed'
          : samePlayers && previousMatch?.slotId && player1Id && player2Id
            ? 'scheduled'
            : 'pending',
        scheduledTime: samePlayers ? previousMatch?.scheduledTime : undefined,
        location: samePlayers ? previousMatch?.location : undefined,
        field: samePlayers ? previousMatch?.field : undefined,
        slotId: samePlayers ? previousMatch?.slotId : undefined,
        completedAt: isCompleted ? previousMatch?.completedAt ?? completedAtFallback : undefined,
      } as SummerRankingMasterMatch;
    }),
  );
};

export const createSummerRankingMasterData = (
  qualifiedPlayerIds: string[],
  manualQualifiedPlayerIds?: string[],
  previousMatches: SummerRankingMasterMatch[] = [],
  format: SummerRankingMasterFormat = 'bracket',
): SummerRankingMasterData => {
  if (format === 'groups') {
    const groups = createSummerRankingMasterGroups(qualifiedPlayerIds);
    return {
      format,
      manualQualifiedPlayerIds,
      generatedQualifiedPlayerIds: qualifiedPlayerIds,
      groups,
      matches: createSummerRankingMasterGroupMatches(groups, previousMatches),
      generatedAt: new Date().toISOString(),
    };
  }

  const bracket = createSummerRankingMasterBracket(qualifiedPlayerIds);
  return {
    format: 'bracket',
    manualQualifiedPlayerIds,
    generatedQualifiedPlayerIds: qualifiedPlayerIds,
    bracket,
    matches: syncSummerRankingMasterMatches(bracket, previousMatches),
    generatedAt: new Date().toISOString(),
  };
};

export const resetSummerRankingMasterData = (
  master: SummerRankingMasterData | undefined,
  format: SummerRankingMasterFormat = 'bracket',
): SummerRankingMasterData => ({
  format,
  manualQualifiedPlayerIds: master?.manualQualifiedPlayerIds,
});

export const removePlayerFromSummerRankingMaster = (
  master: SummerRankingMasterData | undefined,
  playerId: string,
): SummerRankingMasterData | undefined => {
  if (!master) return master;

  const nextManualQualified = master.manualQualifiedPlayerIds?.filter(id => id !== playerId);
  const generatedIncludesPlayer = master.generatedQualifiedPlayerIds?.includes(playerId);

  if (generatedIncludesPlayer) {
    return {
      manualQualifiedPlayerIds: nextManualQualified,
    };
  }

  return {
    ...master,
    manualQualifiedPlayerIds: nextManualQualified,
  };
};

const toTimestamp = (value?: string) => {
  if (!value) return Number.NaN;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.NaN : time;
};

const getMatchPlayedAt = (match: Match) => match.completedAt ?? match.scheduledTime;

const getParticipationBonus = (config: SummerRankingRulesConfig) => {
  if (!config.participationBonusEnabled) return 0;
  return config.participationBase;
};

const getWonGamesBonus = (gamesWon: number, config: SummerRankingRulesConfig) => {
  if (!config.wonGamesBonusEnabled) return 0;
  return gamesWon * config.wonGamesMultiplier;
};

const getGameDiffBonus = (scoreDiff: number, config: SummerRankingRulesConfig) => {
  if (!config.gameDiffBonusEnabled) return 0;
  if (scoreDiff >= 4) return config.gameDiffBonus4plus;
  if (scoreDiff === 3) return config.gameDiffBonus3;
  if (scoreDiff === 2) return config.gameDiffBonus2;
  return 0;
};

const getSummerRankingMatchBreakdown = (
  match: Match,
  player1PointsBefore: number,
  player2PointsBefore: number,
  config: SummerRankingRulesConfig,
): SummerRankingMatchBreakdown | null => {
  if (match.score1 === null || match.score2 === null) return null;

  const diff = Math.abs(player1PointsBefore - player2PointsBefore);
  const band = getSummerRankingDiffBand(diff, config);
  const isPlayer1Favorite = player1PointsBefore >= player2PointsBefore;
  const participationPoints = getParticipationBonus(config);

  if (match.score1 === match.score2) {
    const favWin = band === 'low' ? config.favoriteWinLow : band === 'medium' ? config.favoriteWinMedium : config.favoriteWinHigh;
    const undWin = band === 'low' ? config.underdogWinLow : band === 'medium' ? config.underdogWinMedium : config.underdogWinHigh;
    const player1BaseWin = isPlayer1Favorite ? favWin : undWin;
    const player2BaseWin = !isPlayer1Favorite ? favWin : undWin;
    const player1ResultPoints = config.drawMode === 'fixed'
      ? config.drawFixed
      : player1BaseWin * (config.drawPercentage / 100);
    const player2ResultPoints = config.drawMode === 'fixed'
      ? config.drawFixed
      : player2BaseWin * (config.drawPercentage / 100);
    const player1GameFattiPoints = getWonGamesBonus(match.score1, config);
    const player2GameFattiPoints = getWonGamesBonus(match.score2, config);

    return {
      matchId: match.id,
      player1: {
        playerId: match.player1Id,
        outcome: 'draw',
        resultPoints: player1ResultPoints,
        gameFatti: match.score1,
        gameFattiPoints: player1GameFattiPoints,
        participationPoints,
        gameDiffPoints: 0,
        rulesAdjustmentPoints: 0,
        totalPoints: player1ResultPoints + player1GameFattiPoints + participationPoints,
      },
      player2: {
        playerId: match.player2Id,
        outcome: 'draw',
        resultPoints: player2ResultPoints,
        gameFatti: match.score2,
        gameFattiPoints: player2GameFattiPoints,
        participationPoints,
        gameDiffPoints: 0,
        rulesAdjustmentPoints: 0,
        totalPoints: player2ResultPoints + player2GameFattiPoints + participationPoints,
      },
    };
  }

  const player1Won = match.score1 > match.score2;
  const winnerWasFavorite = player1Won ? isPlayer1Favorite : !isPlayer1Favorite;
  const winnerResult = winnerWasFavorite
    ? (band === 'low' ? config.favoriteWinLow : band === 'medium' ? config.favoriteWinMedium : config.favoriteWinHigh)
    : (band === 'low' ? config.underdogWinLow : band === 'medium' ? config.underdogWinMedium : config.underdogWinHigh);
  // The loser's penalty is based on the loser's own role (opposite of the winner's role).
  const loserWasFavorite = !winnerWasFavorite;
  const loserResult = loserWasFavorite
    ? (band === 'low' ? config.favoriteLossLow : band === 'medium' ? config.favoriteLossMedium : config.favoriteLossHigh)
    : (band === 'low' ? config.underdogLossLow : band === 'medium' ? config.underdogLossMedium : config.underdogLossHigh);
  const scoreDiff = Math.abs(match.score1 - match.score2);
  const gameDiffPoints = getGameDiffBonus(scoreDiff, config);
  const winnerGameFatti = player1Won ? match.score1 : match.score2;
  const loserGameFatti = player1Won ? match.score2 : match.score1;
  const winnerGameFattiPoints = getWonGamesBonus(winnerGameFatti, config);
  const loserGameFattiPoints = getWonGamesBonus(loserGameFatti, config);
  const loserEffectiveReduction = Math.min(Math.abs(loserResult), loserGameFattiPoints);
  const loserRulesAdjustmentPoints = loserEffectiveReduction - loserGameFattiPoints;

  const winnerBreakdown: SummerRankingMatchPlayerBreakdown = {
    playerId: player1Won ? match.player1Id : match.player2Id,
    outcome: 'win',
    resultPoints: winnerResult,
    gameFatti: winnerGameFatti,
    gameFattiPoints: winnerGameFattiPoints,
    participationPoints,
    gameDiffPoints,
    rulesAdjustmentPoints: 0,
    totalPoints: winnerResult + winnerGameFattiPoints + gameDiffPoints + participationPoints,
  };

  const loserBreakdown: SummerRankingMatchPlayerBreakdown = {
    playerId: player1Won ? match.player2Id : match.player1Id,
    outcome: 'loss',
    resultPoints: loserResult,
    gameFatti: loserGameFatti,
    gameFattiPoints: loserGameFattiPoints,
    participationPoints,
    gameDiffPoints: 0,
    rulesAdjustmentPoints: loserRulesAdjustmentPoints,
    totalPoints: loserResult + loserGameFattiPoints + loserRulesAdjustmentPoints + participationPoints,
  };

  return {
    matchId: match.id,
    player1: player1Won ? winnerBreakdown : loserBreakdown,
    player2: player1Won ? loserBreakdown : winnerBreakdown,
  };
};

const countEncounterMatches = (matches: Match[], player1Id: string, player2Id: string) =>
  matches.filter(match => {
    const pair = [match.player1Id, match.player2Id].sort().join(':');
    return pair === [player1Id, player2Id].sort().join(':');
  }).length;

export const getHeadToHeadCount = (matches: Match[], player1Id: string, player2Id: string) =>
  countEncounterMatches(matches, player1Id, player2Id);

export const getEligibleOpponents = (players: Player[], matches: Match[], playerId: string, config?: SummerRankingRulesConfig) => {
  const limit = config?.headToHeadLimit ?? DEFAULT_RULES_CONFIG.headToHeadLimit;
  return players.filter(player =>
    player.id !== playerId &&
    player.status === 'confirmed' &&
    countEncounterMatches(matches, playerId, player.id) < limit
  );
};

export const calculateSummerRankingMatchBreakdowns = (
  players: Player[],
  matches: Match[],
  config?: SummerRankingRulesConfig,
) => {
  const cfg = config ?? DEFAULT_RULES_CONFIG;
  const confirmedPlayers = players.filter(player => player.status === 'confirmed');
  const pointsByPlayer = new Map(
    confirmedPlayers.map(player => [player.id, getStartingPoints(player)])
  );
  const matchBreakdowns = new Map<string, SummerRankingMatchBreakdown>();

  matches
    .filter(match =>
      match.score1 !== null &&
      match.score2 !== null &&
      (
        match.status === 'completed' ||
        Boolean(match.completedAt)
      )
    )
    .slice()
    .sort((a, b) => {
      const aTime = toTimestamp(getMatchPlayedAt(a));
      const bTime = toTimestamp(getMatchPlayedAt(b));
      if (Number.isNaN(aTime) && Number.isNaN(bTime)) return a.id.localeCompare(b.id);
      if (Number.isNaN(aTime)) return 1;
      if (Number.isNaN(bTime)) return -1;
      return aTime - bTime;
    })
    .forEach(match => {
      const player1PointsBefore = pointsByPlayer.get(match.player1Id);
      const player2PointsBefore = pointsByPlayer.get(match.player2Id);
      if (player1PointsBefore === undefined || player2PointsBefore === undefined) return;

      const breakdown = getSummerRankingMatchBreakdown(match, player1PointsBefore, player2PointsBefore, cfg);
      if (!breakdown) return;

      matchBreakdowns.set(match.id, breakdown);
      pointsByPlayer.set(match.player1Id, player1PointsBefore + breakdown.player1.totalPoints);
      pointsByPlayer.set(match.player2Id, player2PointsBefore + breakdown.player2.totalPoints);
    });

  return matchBreakdowns;
};

export const calculateSummerRanking = (
  players: Player[],
  matches: Match[],
  config?: SummerRankingRulesConfig,
  now: Date = new Date(),
): SummerRankingEntry[] => {
  const cfg = config ?? DEFAULT_RULES_CONFIG;
  const confirmedPlayers = players.filter(player => player.status === 'confirmed');
  const completedMatches = matches
    .filter(match =>
      match.score1 !== null &&
      match.score2 !== null &&
      (
        match.status === 'completed' ||
        Boolean(match.completedAt)
      )
    )
    .slice()
    .sort((a, b) => {
      const aTime = toTimestamp(getMatchPlayedAt(a));
      const bTime = toTimestamp(getMatchPlayedAt(b));
      if (Number.isNaN(aTime) && Number.isNaN(bTime)) return a.id.localeCompare(b.id);
      if (Number.isNaN(aTime)) return 1;
      if (Number.isNaN(bTime)) return -1;
      return aTime - bTime;
    });

  const stats = new Map<string, Omit<SummerRankingEntry, 'player' | 'rank' | 'qualifiedForMaster'>>();
  const playedDatesByPlayer = new Map<string, number[]>();
  confirmedPlayers.forEach(player => {
    stats.set(player.id, {
      points: getStartingPoints(player),
      startingPoints: getStartingPoints(player),
      wins: 0,
      draws: 0,
      losses: 0,
      matchesPlayed: 0,
      resultPoints: 0,
      participationBonus: 0,
      wonGamesBonus: 0,
      gameDiffBonus: 0,
      inactivityMalus: 0,
      recentForm: [],
      trend: 'steady',
      lastMatchAt: undefined,
      upcomingMatches: matches.filter(match =>
        match.status === 'scheduled' && (match.player1Id === player.id || match.player2Id === player.id)
      ).length,
    });
    playedDatesByPlayer.set(player.id, []);
  });

  completedMatches.forEach(match => {
    const player1Stats = stats.get(match.player1Id);
    const player2Stats = stats.get(match.player2Id);
    if (!player1Stats || !player2Stats) return;

    const player1PointsBefore = player1Stats.points;
    const player2PointsBefore = player2Stats.points;
    const diff = Math.abs(player1PointsBefore - player2PointsBefore);
    const band = getSummerRankingDiffBand(diff, cfg);
    const isPlayer1Favorite = player1PointsBefore >= player2PointsBefore;
    const playedAt = getMatchPlayedAt(match);
    const playedDate = toTimestamp(playedAt);
    if (!Number.isNaN(playedDate)) {
      playedDatesByPlayer.get(match.player1Id)?.push(playedDate);
      playedDatesByPlayer.get(match.player2Id)?.push(playedDate);
    }
    const participation1 = getParticipationBonus(cfg);
    const participation2 = getParticipationBonus(cfg);
    const scoreDiff = Math.abs((match.score1 ?? 0) - (match.score2 ?? 0));

    player1Stats.matchesPlayed += 1;
    player2Stats.matchesPlayed += 1;
    player1Stats.participationBonus += participation1;
    player2Stats.participationBonus += participation2;
    player1Stats.points += participation1;
    player2Stats.points += participation2;
    player1Stats.lastMatchAt = playedAt;
    player2Stats.lastMatchAt = playedAt;

    if (match.score1 === match.score2) {
      const favWin = band === 'low' ? cfg.favoriteWinLow : band === 'medium' ? cfg.favoriteWinMedium : cfg.favoriteWinHigh;
      const undWin = band === 'low' ? cfg.underdogWinLow : band === 'medium' ? cfg.underdogWinMedium : cfg.underdogWinHigh;
      const player1BaseWin = isPlayer1Favorite ? favWin : undWin;
      const player2BaseWin = !isPlayer1Favorite ? favWin : undWin;
      let player1DrawPoints: number;
      let player2DrawPoints: number;
      if (cfg.drawMode === 'fixed') {
        player1DrawPoints = cfg.drawFixed;
        player2DrawPoints = cfg.drawFixed;
      } else {
        player1DrawPoints = player1BaseWin * (cfg.drawPercentage / 100);
        player2DrawPoints = player2BaseWin * (cfg.drawPercentage / 100);
      }
      const player1WonGamesBonus = getWonGamesBonus(match.score1 ?? 0, cfg);
      const player2WonGamesBonus = getWonGamesBonus(match.score2 ?? 0, cfg);

      player1Stats.points += player1DrawPoints + player1WonGamesBonus;
      player2Stats.points += player2DrawPoints + player2WonGamesBonus;
      player1Stats.resultPoints += player1DrawPoints;
      player2Stats.resultPoints += player2DrawPoints;
      player1Stats.wonGamesBonus += player1WonGamesBonus;
      player2Stats.wonGamesBonus += player2WonGamesBonus;
      player1Stats.draws += 1;
      player2Stats.draws += 1;
      player1Stats.recentForm.push('D');
      player2Stats.recentForm.push('D');
      return;
    }

    const player1Won = (match.score1 ?? 0) > (match.score2 ?? 0);
    const winnerStats = player1Won ? player1Stats : player2Stats;
    const loserStats = player1Won ? player2Stats : player1Stats;
    const winnerScore = player1Won ? (match.score1 ?? 0) : (match.score2 ?? 0);
    const loserScore = player1Won ? (match.score2 ?? 0) : (match.score1 ?? 0);
    const winnerWasFavorite = player1Won ? isPlayer1Favorite : !isPlayer1Favorite;
    const winnerResult = winnerWasFavorite
      ? (band === 'low' ? cfg.favoriteWinLow : band === 'medium' ? cfg.favoriteWinMedium : cfg.favoriteWinHigh)
      : (band === 'low' ? cfg.underdogWinLow : band === 'medium' ? cfg.underdogWinMedium : cfg.underdogWinHigh);
    // The loser's penalty is based on the loser's own role (opposite of the winner's role).
    const loserWasFavorite = !winnerWasFavorite;
    const loserResult = loserWasFavorite
      ? (band === 'low' ? cfg.favoriteLossLow : band === 'medium' ? cfg.favoriteLossMedium : cfg.favoriteLossHigh)
      : (band === 'low' ? cfg.underdogLossLow : band === 'medium' ? cfg.underdogLossMedium : cfg.underdogLossHigh);
    const gameDiffBonus = getGameDiffBonus(scoreDiff, cfg);

    // Winner gains base result + won games bonus (if enabled) + game diff bonus
    const wonGamesBonus = getWonGamesBonus(winnerScore, cfg);
    const loserGamesReduction = getWonGamesBonus(loserScore, cfg);
    const winnerTotalResult = winnerResult + wonGamesBonus + gameDiffBonus;
    // Loser penalty reduced by their game score (minimum penalty is 0, i.e. cannot gain from a loss)
    const loserPenalty = -Math.max(0, Math.abs(loserResult) - loserGamesReduction);

    winnerStats.points += winnerTotalResult;
    loserStats.points += loserPenalty;
    winnerStats.resultPoints += winnerResult;
    loserStats.resultPoints += loserResult;
    winnerStats.wonGamesBonus += wonGamesBonus;
    winnerStats.gameDiffBonus += gameDiffBonus;
    winnerStats.wins += 1;
    loserStats.losses += 1;
    winnerStats.recentForm.push('W');
    loserStats.recentForm.push('L');
  });

  confirmedPlayers.forEach(player => {
    const playerStats = stats.get(player.id);
    if (!playerStats) return;
    const playedDates = (playedDatesByPlayer.get(player.id) ?? []).slice().sort((a, b) => a - b);
    const referenceDates: number[] = [];
    const joinedAt = toTimestamp(player.summerRankingJoinedAt);
    if (!Number.isNaN(joinedAt)) referenceDates.push(joinedAt);
    referenceDates.push(...playedDates);
    if (referenceDates.length > 0 && cfg.inactivityMalusEnabled) {
      let inactivityPenalty = 0;
      for (let index = 1; index < referenceDates.length; index += 1) {
        const gap = Math.floor((referenceDates[index] - referenceDates[index - 1]) / 86400000);
        inactivityPenalty += Math.floor(gap / cfg.inactivityMalusDays) * cfg.inactivityMalusPoints;
      }
      const lastReference = referenceDates[referenceDates.length - 1];
      const currentGap = Math.floor((now.getTime() - lastReference) / 86400000);
      inactivityPenalty += Math.floor(currentGap / cfg.inactivityMalusDays) * cfg.inactivityMalusPoints;
      playerStats.inactivityMalus = inactivityPenalty;
      playerStats.points -= inactivityPenalty;
    }

    const recent = playerStats.recentForm.slice(-3);
    if (recent.length === 0) {
      playerStats.trend = 'steady';
    } else {
      const score = recent.reduce((total, item) => total + (item === 'W' ? 1 : item === 'L' ? -1 : 0), 0);
      playerStats.trend = score > 0 ? 'up' : score < 0 ? 'down' : 'steady';
    }
    playerStats.recentForm = playerStats.recentForm.slice(-5);
    playerStats.points = Math.round(playerStats.points * 10) / 10;
  });

  const ranking = confirmedPlayers
    .map(player => ({
      player,
      rank: 0,
      qualifiedForMaster: false,
      ...(stats.get(player.id) ?? {
        points: getStartingPoints(player),
        startingPoints: getStartingPoints(player),
        wins: 0,
        draws: 0,
        losses: 0,
        matchesPlayed: 0,
        resultPoints: 0,
        participationBonus: 0,
        wonGamesBonus: 0,
        gameDiffBonus: 0,
        inactivityMalus: 0,
        recentForm: [],
        trend: 'steady' as Trend,
        lastMatchAt: undefined,
        upcomingMatches: 0,
      }),
    }))
    .sort((a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      b.matchesPlayed - a.matchesPlayed ||
      a.player.name.localeCompare(b.player.name)
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  ranking.slice(0, cfg.masterSize).forEach(entry => {
    entry.qualifiedForMaster = true;
  });

  return ranking;
};
