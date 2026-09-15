export interface Player {
  id: string;
  name: string;
  phone: string;
  avatar: string;
  status: 'pending' | 'confirmed';
  summerRankingStartPoints?: number;
  summerRankingJoinedAt?: string;
}

export interface Match {
  id: string;
  player1Id: string;
  player2Id: string;
  score1: number | null;
  score2: number | null;
  status: 'pending' | 'scheduled' | 'completed';
  scheduledTime?: string;
  location?: string;
  field?: string;
  slotId?: string;
  completedAt?: string;
  monthKey?: string;
  team1PlayerIds?: string[];
  team2PlayerIds?: string[];
}

export interface Group {
  id: string;
  name: string;
  playerIds: string[];
  matches: Match[];
  rules?: string; // <-- aggiunto campo regolamento
}

export interface PadelTeam {
  id: string;
  name: string;
  player1Id: string;
  player2Id: string;
}

export interface PointRule {
  id: string;
  minDiff: number;
  maxDiff: number;
  winnerPoints: number;
  loserPoints: number;
}

export type TieBreaker = 'goalDifference' | 'goalsFor' | 'wins' | 'headToHead';

export interface PlayoffSetting {
  groupId: string;
  numQualifiers: number;
}

export interface ConsolationSetting {
  groupId: string;
  startRank: number;
  endRank: number;
}

export interface TournamentSettings {
    pointsPerDraw: number;
    pointRules: PointRule[];
    tieBreakers: TieBreaker[];
    playoffSettings: PlayoffSetting[];
    hasBronzeFinal: boolean;
    consolationSettings: ConsolationSetting[];
}

export interface TimeSlot {
    id: string;
    start: string;
    location: string;
    field: string;
}

export interface PlayoffMatch {
  id: string;
  round: number;
  matchIndex: number;
  player1Id: string | null;
  player2Id: string | null;
  score1: number | null;
  score2: number | null;
  winnerId: string | null;
  nextMatchId: string | null;
  isBronzeFinal?: boolean;
  loserGoesToBronzeFinal?: boolean;
}

export interface PlayoffBracket {
  matches: PlayoffMatch[];
  isGenerated: boolean;
  finalId: string | null;
  bronzeFinalId: string | null;
}

export interface Tournament {
  id: string;
  name: string;
  groups: Group[];
  padelTeams?: PadelTeam[];
  settings: TournamentSettings;
  timeSlots: TimeSlot[];
  playoffs: PlayoffBracket | null;
  consolationBracket: PlayoffBracket | null;

  // NEW: partite “prenotabili” visibili nel tab Partite
  playoffMatches?: Match[];
  consolationMatches?: Match[];
}

export interface Event {
  id: string;
  name: string;
  tournaments: Tournament[];
  players: Player[];
  invitationCode: string;
  eventType?: 'ranking_singolare' | 'ranking_padel_individuale' | 'tournament_singolare' | 'tournament_padel';
  rankingData?: SummerRankingData;
  globalTimeSlots?: TimeSlot[];
  rules?: string;
}

export type SummerAvailabilityStatus = 'available' | 'unavailable';
export type SummerAvailabilityDay =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';
export type SummerAvailabilityPeriod = 'morning' | 'afternoon' | 'evening';
export type SummerAvailabilityByDay = Partial<Record<SummerAvailabilityDay, SummerAvailabilityPeriod[]>>;

export interface SummerPlayerAvailabilityEntry {
  id?: string;
  status: SummerAvailabilityStatus;
  days: SummerAvailabilityDay[];
  periods?: SummerAvailabilityPeriod[];
}

export interface SummerPlayerAvailability {
  status?: SummerAvailabilityStatus;
  days?: SummerAvailabilityDay[];
  periods?: SummerAvailabilityPeriod[];
  dayPeriods?: SummerAvailabilityByDay;
  entries?: SummerPlayerAvailabilityEntry[];
  updatedAt?: string;
}

export type SummerRankingMasterFormat = 'bracket' | 'groups';
export type SummerRankingMasterStage = 'quarterfinal' | 'semifinal' | 'final' | 'thirdPlace' | 'group';

export interface SummerRankingMasterGroup {
  id: string;
  name: string;
  playerIds: string[];
}

export interface SummerRankingMasterMatch {
  id: string;
  round: number;
  label: string;
  stage: SummerRankingMasterStage;
  groupId?: string;
  player1Id: string | null;
  player2Id: string | null;
  score1: number | null;
  score2: number | null;
  status: 'pending' | 'scheduled' | 'completed';
  scheduledTime?: string;
  location?: string;
  field?: string;
  slotId?: string;
  completedAt?: string;
}

export interface SummerRankingMasterPair {
  id: string;
  player1Id: string;
  player2Id: string;
}

export interface PadelIndividualMasterData {
  qualifiedPlayerIds: string[];
  pairs: SummerRankingMasterPair[];
  bracket?: PlayoffBracket | null;
  matches?: SummerRankingMasterMatch[];
  generatedAt?: string;
}

export interface SummerRankingMasterData {
  format?: SummerRankingMasterFormat;
  manualQualifiedPlayerIds?: string[];
  generatedQualifiedPlayerIds?: string[];
  bracket?: PlayoffBracket | null;
  groups?: SummerRankingMasterGroup[];
  matches?: SummerRankingMasterMatch[];
  generatedAt?: string;
}

export type DrawMode = 'percentage' | 'fixed';

export interface SummerRankingRulesConfig {
  diffBandLowMax: number;
  diffBandMediumMax: number;

  favoriteWinLow: number;
  favoriteLossLow: number;
  favoriteWinMedium: number;
  favoriteLossMedium: number;
  favoriteWinHigh: number;
  favoriteLossHigh: number;

  underdogWinLow: number;
  underdogLossLow: number;
  underdogWinMedium: number;
  underdogLossMedium: number;
  underdogWinHigh: number;
  underdogLossHigh: number;

  drawMode: DrawMode;
  drawPercentage: number;
  drawFixed: number;

  participationBonusEnabled: boolean;
  participationBase: number;
  participationWeeklyBonus: number;
  participationWeeklyMinMatches: number;

  gameDiffBonusEnabled: boolean;
  gameDiffBonus2: number;
  gameDiffBonus3: number;
  gameDiffBonus4plus: number;

  wonGamesBonusEnabled: boolean;
  wonGamesMultiplier: number;

  inactivityMalusEnabled: boolean;
  inactivityMalusPoints: number;
  inactivityMalusDays: number;

  masterSize: number;
  masterMinMatches: number;

  headToHeadLimit: number;
}

export interface SummerRankingData {
  slots: TimeSlot[];
  matches: Match[];
  participantIds?: string[];
  rules?: string;
  rulesConfig?: SummerRankingRulesConfig;
  availabilities?: Record<string, SummerPlayerAvailability>;
  master?: SummerRankingMasterData;
  padelIndividualMaster?: PadelIndividualMasterData;
}

export interface StandingsEntry {
    playerId: string;
    played: number;
    wins: number;
    draws: number;
    losses: number;
    points: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
}

export interface User {
    id: string;
    username: string;
    password: string;
    role: 'organizer' | 'participant';
    playerId?: string;
}
