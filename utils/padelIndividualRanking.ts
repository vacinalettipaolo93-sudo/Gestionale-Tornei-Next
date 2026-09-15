import {
  type Match,
  type PadelIndividualMasterData,
  type Player,
  type PlayoffBracket,
  type PlayoffMatch,
  type SummerRankingMasterPair,
  type SummerRankingMasterMatch,
  type SummerRankingRulesConfig,
} from '../types';

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
const PADEL_INDIVIDUAL_DEFAULT_HEAD_TO_HEAD_LIMIT = 999;
const normalizeEvenMasterSize = (value: number) => {
  const normalized = Math.max(2, Math.round(value));
  return normalized % 2 === 0 ? normalized : normalized + 1;
};

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
  participationMonthlyCap: PADEL_INDIVIDUAL_PARTICIPATION_MONTHLY_CAP,
  participationWeeklyBonus: 0,
  participationWeeklyMinMatches: 1,
  gameDiffBonusEnabled: false,
  gameDiffBonus2: 0,
  gameDiffBonus3: 0,
  gameDiffBonus4plus: 0,
  wonGamesBonusEnabled: true,
  wonGamesMultiplier: 1,
  wonGamesCap: PADEL_INDIVIDUAL_WON_GAMES_CAP,
  inactivityMalusEnabled: false,
  inactivityMalusPoints: 0,
  inactivityMalusDays: 999,
  masterSize: PADEL_INDIVIDUAL_MASTER_SIZE,
  masterMinMatches: PADEL_INDIVIDUAL_MASTER_MIN_MATCHES,
  headToHeadLimit: PADEL_INDIVIDUAL_DEFAULT_HEAD_TO_HEAD_LIMIT,
};

export const normalizePadelIndividualRulesConfig = (config?: Partial<SummerRankingRulesConfig> | null): SummerRankingRulesConfig => ({
  ...DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG,
  ...config,
  drawMode: 'fixed',
  drawPercentage: 0,
  drawFixed: 0,
  participationBonusEnabled: config?.participationBonusEnabled ?? DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG.participationBonusEnabled,
  participationBase: Number.isFinite(config?.participationBase) ? Number(config!.participationBase) : DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG.participationBase,
  participationMonthlyCap: Number.isFinite(config?.participationMonthlyCap) ? Math.max(0, Number(config!.participationMonthlyCap)) : DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG.participationMonthlyCap,
  participationWeeklyBonus: 0,
  participationWeeklyMinMatches: 1,
  gameDiffBonusEnabled: false,
  gameDiffBonus2: 0,
  gameDiffBonus3: 0,
  gameDiffBonus4plus: 0,
  wonGamesBonusEnabled: config?.wonGamesBonusEnabled ?? DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG.wonGamesBonusEnabled,
  wonGamesMultiplier: Number.isFinite(config?.wonGamesMultiplier) ? Math.max(0, Number(config!.wonGamesMultiplier)) : DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG.wonGamesMultiplier,
  wonGamesCap: Number.isFinite(config?.wonGamesCap) ? Math.max(0, Number(config!.wonGamesCap)) : DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG.wonGamesCap,
  inactivityMalusEnabled: false,
  inactivityMalusPoints: 0,
  inactivityMalusDays: DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG.inactivityMalusDays,
  masterSize: Number.isFinite(config?.masterSize) ? normalizeEvenMasterSize(Number(config!.masterSize)) : DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG.masterSize,
  masterMinMatches: Number.isFinite(config?.masterMinMatches) ? Math.max(1, Number(config!.masterMinMatches)) : DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG.masterMinMatches,
  headToHeadLimit: Number.isFinite(config?.headToHeadLimit) ? Math.max(1, Number(config!.headToHeadLimit)) : DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG.headToHeadLimit,
});

export const generatePadelIndividualRulesText = (config?: Partial<SummerRankingRulesConfig> | null) => {
  const cfg = normalizePadelIndividualRulesConfig(config);
  const lowLabel = `0-${cfg.diffBandLowMax}`;
  const mediumLabel = `${cfg.diffBandLowMax + 1}-${cfg.diffBandMediumMax}`;
  const highLabel = `${cfg.diffBandMediumMax + 1}+`;
  return [
    PADEL_INDIVIDUAL_EVENT_NAMES.join(' / '),
    '',
    'Campionato amatoriale di padel individuale senza coppie fisse.',
    '• Non esistono coppie fisse: ogni giocatore sceglie liberamente compagno e avversari.',
    '• La classifica è individuale e ogni partita può cambiare il ranking di tutti e 4 i giocatori.',
    `• Prima di ogni partita si sommano i punteggi delle due coppie: ${lowLabel} equilibrata, ${mediumLabel} differenza media, ${highLabel} differenza alta.`,
    `• Partita equilibrata: vincitori ${cfg.favoriteWinLow > 0 ? '+' : ''}${cfg.favoriteWinLow}, sconfitti ${cfg.favoriteLossLow > 0 ? '+' : ''}${cfg.favoriteLossLow}.`,
    `• Differenza media: favoriti ${cfg.favoriteWinMedium > 0 ? '+' : ''}${cfg.favoriteWinMedium} se vincono e ${cfg.favoriteLossMedium > 0 ? '+' : ''}${cfg.favoriteLossMedium} se perdono; sfavoriti ${cfg.underdogWinMedium > 0 ? '+' : ''}${cfg.underdogWinMedium} se vincono e ${cfg.underdogLossMedium > 0 ? '+' : ''}${cfg.underdogLossMedium} se perdono.`,
    `• Differenza alta: favoriti ${cfg.favoriteWinHigh > 0 ? '+' : ''}${cfg.favoriteWinHigh} se vincono e ${cfg.favoriteLossHigh > 0 ? '+' : ''}${cfg.favoriteLossHigh} se perdono; sfavoriti ${cfg.underdogWinHigh > 0 ? '+' : ''}${cfg.underdogWinHigh} se vincono e ${cfg.underdogLossHigh > 0 ? '+' : ''}${cfg.underdogLossHigh} se perdono.`,
    `• Bonus partecipazione: ${cfg.participationBonusEnabled ? `${cfg.participationBase > 0 ? '+' : ''}${cfg.participationBase} a partita fino a un massimo di ${cfg.participationMonthlyCap > 0 ? '+' : ''}${cfg.participationMonthlyCap} al mese.` : 'disattivato.'}`,
    `• Bonus game: ${cfg.wonGamesBonusEnabled ? `${cfg.wonGamesMultiplier > 0 ? '+' : ''}${cfg.wonGamesMultiplier} per ogni game vinto, massimo ${cfg.wonGamesCap} per partita e per giocatore.` : 'disattivato.'}`,
    `• Master finale: top ${cfg.masterSize} con almeno ${cfg.masterMinMatches} partite giocate. Le coppie del Master vengono decise dall'organizzazione.`,
    '• Premi: coppia campione del Master, re del ranking (#1), premio fedeltà (più partite), social player (più compagni diversi).',
    '',
    'Scegli il compagno. Scegli gli avversari. Gioca. Vinci per guadagnare punti. Anche ogni game conta.',
    'NON ESISTONO COPPIE FISSE. LA CLASSIFICA È INDIVIDUALE. OGNI PARTITA PUÒ CAMBIARE IL RANKING.',
  ].join('\n');
};

export const DEFAULT_PADEL_INDIVIDUAL_RULES = generatePadelIndividualRulesText(DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG);

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

export const getPadelIndividualDiffBand = (
  difference: number,
  config?: Partial<SummerRankingRulesConfig> | null,
): PadelIndividualDiffBand => {
  const cfg = normalizePadelIndividualRulesConfig(config);
  if (difference <= cfg.diffBandLowMax) return 'balanced';
  if (difference <= cfg.diffBandMediumMax) return 'medium';
  return 'high';
};

const getResultPointsForSide = (
  band: PadelIndividualDiffBand,
  isFavorite: boolean,
  won: boolean,
  config?: Partial<SummerRankingRulesConfig> | null,
) => {
  const cfg = normalizePadelIndividualRulesConfig(config);
  if (band === 'balanced') {
    return won
      ? (isFavorite ? cfg.favoriteWinLow : cfg.underdogWinLow)
      : (isFavorite ? cfg.favoriteLossLow : cfg.underdogLossLow);
  }
  if (band === 'medium') {
    if (isFavorite) return won ? cfg.favoriteWinMedium : cfg.favoriteLossMedium;
    return won ? cfg.underdogWinMedium : cfg.underdogLossMedium;
  }
  if (isFavorite) return won ? cfg.favoriteWinHigh : cfg.favoriteLossHigh;
  return won ? cfg.underdogWinHigh : cfg.underdogLossHigh;
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

const getParticipantBonus = (
  monthlyCounts: Map<string, number>,
  playerId: string,
  match: Match,
  config?: Partial<SummerRankingRulesConfig> | null,
) => {
  const cfg = normalizePadelIndividualRulesConfig(config);
  if (!cfg.participationBonusEnabled || cfg.participationBase === 0) return 0;
  const monthKey = `${playerId}:${getMonthKey(match)}`;
  const currentCount = monthlyCounts.get(monthKey) ?? 0;
  const currentTotal = currentCount * cfg.participationBase;
  monthlyCounts.set(monthKey, currentCount + 1);
  if (cfg.participationMonthlyCap <= 0) return 0;
  const remainingAllowance = cfg.participationMonthlyCap - currentTotal;
  if (remainingAllowance <= 0) return 0;
  return Math.min(cfg.participationBase, remainingAllowance);
};

export const getPadelIndividualPreMatchInfo = (
  ratingsByPlayer: Map<string, number>,
  team1PlayerIds: string[],
  team2PlayerIds: string[],
  config?: Partial<SummerRankingRulesConfig> | null,
): PadelIndividualPreMatchInfo | null => {
  if (team1PlayerIds.length !== 2 || team2PlayerIds.length !== 2) return null;
  const team1Total = team1PlayerIds.reduce((total, playerId) => total + (ratingsByPlayer.get(playerId) ?? 0), 0);
  const team2Total = team2PlayerIds.reduce((total, playerId) => total + (ratingsByPlayer.get(playerId) ?? 0), 0);
  const difference = Math.abs(team1Total - team2Total);
  return {
    team1Total,
    team2Total,
    difference,
    band: getPadelIndividualDiffBand(difference, config),
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
  config?: Partial<SummerRankingRulesConfig> | null,
): PadelIndividualMatchBreakdown | null => {
  const cfg = normalizePadelIndividualRulesConfig(config);
  if (!isCompletedPadelIndividualMatch(match)) return null;
  const team1PlayerIds = getPadelIndividualTeamPlayerIds(match, 1);
  const team2PlayerIds = getPadelIndividualTeamPlayerIds(match, 2);
  const preMatchInfo = getPadelIndividualPreMatchInfo(ratingsByPlayer, team1PlayerIds, team2PlayerIds, cfg);
  if (!preMatchInfo) return null;

  const score1 = match.score1 ?? 0;
  const score2 = match.score2 ?? 0;
  const team1Won = score1 > score2;
  const team1ResultPoints = getResultPointsForSide(preMatchInfo.band, preMatchInfo.favoriteSide === 1, team1Won, cfg);
  const team2ResultPoints = getResultPointsForSide(preMatchInfo.band, preMatchInfo.favoriteSide === 2, !team1Won, cfg);
  const team1WonGamesPoints = cfg.wonGamesBonusEnabled && cfg.wonGamesCap > 0 ? Math.min(score1 * cfg.wonGamesMultiplier, cfg.wonGamesCap) : 0;
  const team2WonGamesPoints = cfg.wonGamesBonusEnabled && cfg.wonGamesCap > 0 ? Math.min(score2 * cfg.wonGamesMultiplier, cfg.wonGamesCap) : 0;
  const playedAt = getMatchPlayedAt(match);

  const players = [
    ...team1PlayerIds.map((playerId, index) => {
      const partnerId = team1PlayerIds[index === 0 ? 1 : 0];
      const participationPoints = getParticipantBonus(monthlyCounts, playerId, match, cfg);
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
      const participationPoints = getParticipantBonus(monthlyCounts, playerId, match, cfg);
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

export const calculatePadelIndividualMatchBreakdowns = (
  players: Player[],
  matches: Match[],
  config?: Partial<SummerRankingRulesConfig> | null,
) => {
  const cfg = normalizePadelIndividualRulesConfig(config);
  const confirmedPlayers = players.filter(player => player.status === 'confirmed');
  const ratingsByPlayer = createRatingsMap(confirmedPlayers);
  const monthlyCounts = new Map<string, number>();
  const partnerMap = new Map(confirmedPlayers.map(player => [player.id, new Set<string>()]));
  const breakdowns = new Map<string, PadelIndividualMatchBreakdown>();

  sortMatchesByTime(matches)
    .filter(isCompletedPadelIndividualMatch)
    .forEach(match => {
      const breakdown = buildMatchBreakdown(match, ratingsByPlayer, monthlyCounts, partnerMap, cfg);
      if (breakdown) breakdowns.set(match.id, breakdown);
    });

  return breakdowns;
};

export const calculatePadelIndividualCurrentRatings = (
  players: Player[],
  matches: Match[],
  config?: Partial<SummerRankingRulesConfig> | null,
) => {
  const cfg = normalizePadelIndividualRulesConfig(config);
  const confirmedPlayers = players.filter(player => player.status === 'confirmed');
  const ratingsByPlayer = createRatingsMap(confirmedPlayers);
  const monthlyCounts = new Map<string, number>();
  const partnerMap = new Map(confirmedPlayers.map(player => [player.id, new Set<string>()]));

  sortMatchesByTime(matches)
    .filter(isCompletedPadelIndividualMatch)
    .forEach(match => {
      buildMatchBreakdown(match, ratingsByPlayer, monthlyCounts, partnerMap, cfg);
    });

  return ratingsByPlayer;
};

export const calculatePadelIndividualPreMatchRatings = (
  players: Player[],
  matches: Match[],
  configOrTargetMatchId?: Partial<SummerRankingRulesConfig> | string | null,
  targetMatchId?: string,
) => {
  const config = typeof configOrTargetMatchId === 'string'
    ? undefined
    : configOrTargetMatchId;
  const effectiveTargetMatchId = typeof configOrTargetMatchId === 'string'
    ? configOrTargetMatchId
    : targetMatchId;
  const targetMatch = effectiveTargetMatchId ? matches.find(match => match.id === effectiveTargetMatchId) : undefined;
  if (!effectiveTargetMatchId || !targetMatch) return calculatePadelIndividualCurrentRatings(players, matches, config);

  const targetTimestamp = toTimestamp(getMatchPlayedAt(targetMatch));
  const filteredMatches = sortMatchesByTime(matches).filter(match => {
    if (match.id === effectiveTargetMatchId) return false;
    if (!isCompletedPadelIndividualMatch(match)) return false;
    const matchTimestamp = toTimestamp(getMatchPlayedAt(match));
    if (Number.isNaN(targetTimestamp)) return true;
    if (Number.isNaN(matchTimestamp)) return false;
    return matchTimestamp < targetTimestamp || (matchTimestamp === targetTimestamp && match.id.localeCompare(effectiveTargetMatchId) < 0);
  });

  const confirmedPlayers = players.filter(player => player.status === 'confirmed');
  const ratingsByPlayer = createRatingsMap(confirmedPlayers);
  const monthlyCounts = new Map<string, number>();
  const partnerMap = new Map(confirmedPlayers.map(player => [player.id, new Set<string>()]));
  filteredMatches.forEach(match => {
    buildMatchBreakdown(match, ratingsByPlayer, monthlyCounts, partnerMap, config);
  });
  return ratingsByPlayer;
};

export const calculatePadelIndividualRanking = (
  players: Player[],
  matches: Match[],
  config?: Partial<SummerRankingRulesConfig> | null,
): PadelIndividualRankingEntry[] => {
  const cfg = normalizePadelIndividualRulesConfig(config);
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
      const breakdown = buildMatchBreakdown(match, ratingsByPlayer, monthlyCounts, partnerMap, cfg);
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
      eligibleForMaster: entry.matchesPlayed >= cfg.masterMinMatches,
      lastMatchAt: entry.lastMatchAt,
    }));

  const autoQualifiedIds = new Set(
    ranking
      .filter(entry => entry.eligibleForMaster)
      .slice(0, cfg.masterSize)
      .map(entry => entry.player.id),
  );

  return ranking.map(entry => ({
    ...entry,
    qualifiedForMaster: autoQualifiedIds.has(entry.player.id),
  }));
};

export const getPadelIndividualAutoQualifiedPlayerIds = (
  ranking: PadelIndividualRankingEntry[],
  config?: Partial<SummerRankingRulesConfig> | null,
) => {
  const cfg = normalizePadelIndividualRulesConfig(config);
  return ranking
    .filter(entry => entry.eligibleForMaster)
    .slice(0, cfg.masterSize)
    .map(entry => entry.player.id);
};

const hasValidKnockoutScore = (match: Pick<PlayoffMatch, 'player1Id' | 'player2Id' | 'score1' | 'score2'>) =>
  !!match.player1Id
  && !!match.player2Id
  && match.score1 !== null
  && match.score2 !== null
  && match.score1 >= 0
  && match.score2 >= 0
  && match.score1 !== match.score2;

const getWinnerId = (match: Pick<PlayoffMatch, 'player1Id' | 'player2Id' | 'score1' | 'score2'>) => {
  if (!hasValidKnockoutScore(match)) return null;
  return (match.score1 ?? 0) > (match.score2 ?? 0) ? match.player1Id : match.player2Id;
};

const setParticipants = (match: PlayoffMatch, player1Id: string | null, player2Id: string | null) => {
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

const getNextPowerOfTwo = (value: number) => {
  let current = 1;
  while (current < value) current *= 2;
  return current;
};

const buildSeedOrder = (size: number): number[] => {
  if (size <= 1) return [1];
  const previous = buildSeedOrder(size / 2);
  return previous.flatMap(seed => [seed, size + 1 - seed]);
};

const createPadelIndividualMasterBracket = (pairIds: string[]): PlayoffBracket => {
  const bracketSize = Math.max(2, getNextPowerOfTwo(pairIds.length));
  const seedOrder = buildSeedOrder(bracketSize);
  const seededIds = Array.from({ length: bracketSize }, (_, index) => {
    const seed = seedOrder[index];
    return pairIds[seed - 1] ?? null;
  });
  const totalRounds = Math.log2(bracketSize);
  const matches: PlayoffMatch[] = [];
  let matchCounter = 1;
  let previousRoundIds: string[] = [];

  for (let round = 1; round <= totalRounds; round += 1) {
    const roundMatchCount = bracketSize / 2 ** round;
    const currentRoundIds: string[] = [];

    for (let matchIndex = 0; matchIndex < roundMatchCount; matchIndex += 1) {
      const id = round === totalRounds ? 'master-final' : `padel-master-r${round}-m${matchIndex + 1}`;
      currentRoundIds.push(id);
      const nextMatchId = round === totalRounds ? null : (round + 1 === totalRounds ? 'master-final' : `padel-master-r${round + 1}-m${Math.floor(matchIndex / 2) + 1}`);
      matches.push({
        id,
        round,
        matchIndex: matchCounter - 1,
        player1Id: round === 1 ? seededIds[matchIndex * 2] ?? null : null,
        player2Id: round === 1 ? seededIds[matchIndex * 2 + 1] ?? null : null,
        score1: null,
        score2: null,
        winnerId: null,
        nextMatchId,
      });
      matchCounter += 1;
    }

    previousRoundIds = currentRoundIds;
  }

  return recomputePadelIndividualMasterBracket({
    matches,
    isGenerated: true,
    finalId: previousRoundIds[0] ?? 'master-final',
    bronzeFinalId: null,
  });
};

export const recomputePadelIndividualMasterBracket = (bracket: PlayoffBracket): PlayoffBracket => {
  const nextBracket = JSON.parse(JSON.stringify(bracket)) as PlayoffBracket;
  const orderedMatches = nextBracket.matches.slice().sort((left, right) => left.round - right.round || left.matchIndex - right.matchIndex);
  const matchMap = new Map(orderedMatches.map(match => [match.id, match]));

  orderedMatches.forEach(match => {
    match.winnerId = getWinnerId(match);
  });

  const matchesByRound = orderedMatches.reduce<Map<number, PlayoffMatch[]>>((acc, match) => {
    acc.set(match.round, [...(acc.get(match.round) ?? []), match]);
    return acc;
  }, new Map());

  Array.from(matchesByRound.keys()).sort((a, b) => a - b).forEach(round => {
    if (round === 1) return;
    const currentMatches = matchesByRound.get(round) ?? [];
    currentMatches.forEach(match => {
      const feeders = orderedMatches
        .filter(candidate => candidate.nextMatchId === match.id)
        .sort((left, right) => left.matchIndex - right.matchIndex);
      setParticipants(match, feeders[0]?.winnerId ?? null, feeders[1]?.winnerId ?? null);
    });
  });

  orderedMatches.forEach(match => {
    if (match.player1Id && !match.player2Id && !hasValidKnockoutScore(match)) {
      match.winnerId = match.player1Id;
    }
    if (!match.player1Id && match.player2Id && !hasValidKnockoutScore(match)) {
      match.winnerId = match.player2Id;
    }
  });

  Array.from(matchesByRound.keys()).sort((a, b) => a - b).forEach(round => {
    if (round === 1) return;
    const currentMatches = matchesByRound.get(round) ?? [];
    currentMatches.forEach(match => {
      const feeders = orderedMatches
        .filter(candidate => candidate.nextMatchId === match.id)
        .sort((left, right) => left.matchIndex - right.matchIndex);
      setParticipants(match, feeders[0]?.winnerId ?? null, feeders[1]?.winnerId ?? null);
    });
  });

  const finalMatch = orderedMatches[orderedMatches.length - 1];
  nextBracket.finalId = finalMatch?.id ?? nextBracket.finalId;
  nextBracket.bronzeFinalId = null;
  if (matchMap.size === 0) return nextBracket;
  return nextBracket;
};

const getPadelIndividualMatchLabel = (match: PlayoffMatch, maxRound: number) => {
  if (match.round === maxRound) return 'Finale';
  if (match.round === maxRound - 1) return `Semifinale ${match.matchIndex + 1}`;
  if (match.round === maxRound - 2) return `Quarto ${match.matchIndex + 1}`;
  if (match.round === 1) return `Turno ${match.matchIndex + 1}`;
  return `Round ${match.round} • Match ${match.matchIndex + 1}`;
};

const getPadelIndividualMatchStage = (match: PlayoffMatch, maxRound: number): SummerRankingMasterMatch['stage'] => {
  if (match.round === maxRound) return 'final';
  if (match.round === maxRound - 1) return 'semifinal';
  return 'quarterfinal';
};

export const syncPadelIndividualMasterMatches = (
  bracket: PlayoffBracket,
  previousMatches: SummerRankingMasterMatch[] = [],
  completedAtFallback = new Date().toISOString(),
): SummerRankingMasterMatch[] => {
  const previousMap = new Map(previousMatches.map(match => [match.id, match]));
  const maxRound = bracket.matches.reduce((max, match) => Math.max(max, match.round), 1);

  return bracket.matches
    .slice()
    .sort((a, b) => a.round - b.round || a.matchIndex - b.matchIndex)
    .map((match, index) => {
      const previousMatch = previousMap.get(match.id);
      const samePlayers = previousMatch?.player1Id === match.player1Id && previousMatch?.player2Id === match.player2Id;
      const isCompleted = hasValidKnockoutScore(match);
      return {
        id: match.id,
        round: match.round,
        label: previousMatch?.label ?? getPadelIndividualMatchLabel({ ...match, matchIndex: match.round === maxRound ? 0 : index }, maxRound),
        stage: previousMatch?.stage ?? getPadelIndividualMatchStage(match, maxRound),
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

export const createPadelIndividualMasterData = (
  qualifiedPlayerIds: string[],
  pairs: SummerRankingMasterPair[],
  config?: Partial<SummerRankingRulesConfig> | null,
): PadelIndividualMasterData | null => {
  const cfg = normalizePadelIndividualRulesConfig(config);
  if (cfg.masterSize % 2 !== 0 || qualifiedPlayerIds.length !== cfg.masterSize || pairs.length !== cfg.masterSize / 2) {
    return null;
  }
  const bracket = createPadelIndividualMasterBracket(pairs.map(pair => pair.id));
  return {
    qualifiedPlayerIds,
    pairs,
    bracket,
    matches: syncPadelIndividualMasterMatches(bracket),
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
  _config?: Partial<SummerRankingRulesConfig> | null,
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
