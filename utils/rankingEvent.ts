import {
  type Event,
  type Match,
  type PadelIndividualMasterData,
  type SummerRankingData,
  type SummerRankingMasterMatch,
} from '../types';
import { DEFAULT_SUMMER_RANKING_RULES, normalizeRulesConfig } from './summerRanking';
import { DEFAULT_PADEL_INDIVIDUAL_RULES, DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG } from './padelIndividualRanking';

export type RankingEventType = 'ranking_singolare' | 'ranking_padel_individuale';

export const isRankingEventType = (eventType?: Event['eventType'] | null): eventType is RankingEventType =>
  eventType === 'ranking_singolare' || eventType === 'ranking_padel_individuale';

export const getEventType = (event?: Partial<Event> | null): NonNullable<Event['eventType']> =>
  event?.eventType === 'ranking_singolare'
    ? 'ranking_singolare'
    : event?.eventType === 'ranking_padel_individuale'
      ? 'ranking_padel_individuale'
      : event?.eventType === 'tournament_padel'
        ? 'tournament_padel'
        : 'tournament_singolare';

export const getRankingEventLabel = (eventType?: Event['eventType'] | null) =>
  eventType === 'ranking_padel_individuale'
    ? 'Ranking padel individuale'
    : 'Ranking tennis singolare';

export const getDefaultRankingRules = (eventType?: Event['eventType'] | null) =>
  eventType === 'ranking_padel_individuale'
    ? DEFAULT_PADEL_INDIVIDUAL_RULES
    : DEFAULT_SUMMER_RANKING_RULES;

export const getDefaultRankingRulesConfig = (eventType?: Event['eventType'] | null) =>
  eventType === 'ranking_padel_individuale'
    ? DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG
    : normalizeRulesConfig(undefined);

export const createEmptyRankingData = (eventType?: Event['eventType'] | null): SummerRankingData => ({
  slots: [],
  matches: [],
  participantIds: [],
  rules: getDefaultRankingRules(eventType),
  rulesConfig: getDefaultRankingRulesConfig(eventType),
  availabilities: {},
});

const sanitizeMatch = (match: Match): Match => {
  const result: Match = {
    id: match.id,
    player1Id: match.player1Id,
    player2Id: match.player2Id,
    score1: match.score1,
    score2: match.score2,
    status: match.status,
  };
  if (match.scheduledTime !== undefined) result.scheduledTime = match.scheduledTime;
  if (match.location !== undefined) result.location = match.location;
  if (match.field !== undefined) result.field = match.field;
  if (match.slotId !== undefined) result.slotId = match.slotId;
  if (match.completedAt !== undefined) result.completedAt = match.completedAt;
  if (Array.isArray(match.team1PlayerIds)) result.team1PlayerIds = match.team1PlayerIds.filter(Boolean);
  if (Array.isArray(match.team2PlayerIds)) result.team2PlayerIds = match.team2PlayerIds.filter(Boolean);
  return result;
};

const sanitizeMasterMatch = (match: SummerRankingMasterMatch): SummerRankingMasterMatch => {
  const result: SummerRankingMasterMatch = {
    id: match.id,
    round: match.round,
    label: match.label,
    stage: match.stage,
    player1Id: match.player1Id,
    player2Id: match.player2Id,
    score1: match.score1,
    score2: match.score2,
    status: match.status,
  };
  if (match.groupId !== undefined) result.groupId = match.groupId;
  if (match.scheduledTime !== undefined) result.scheduledTime = match.scheduledTime;
  if (match.location !== undefined) result.location = match.location;
  if (match.field !== undefined) result.field = match.field;
  if (match.slotId !== undefined) result.slotId = match.slotId;
  if (match.completedAt !== undefined) result.completedAt = match.completedAt;
  return result;
};

const sanitizePadelIndividualMaster = (master: PadelIndividualMasterData): PadelIndividualMasterData => ({
  qualifiedPlayerIds: Array.from(new Set(master.qualifiedPlayerIds.filter(Boolean))),
  pairs: Array.isArray(master.pairs)
    ? master.pairs.map(pair => ({
      id: pair.id,
      player1Id: pair.player1Id,
      player2Id: pair.player2Id,
    }))
    : [],
  bracket: master.bracket ?? null,
  matches: Array.isArray(master.matches) ? master.matches.map(sanitizeMasterMatch) : [],
  ...(master.generatedAt !== undefined ? { generatedAt: master.generatedAt } : {}),
});

export const normalizeRankingData = (data?: SummerRankingData | null, eventType?: Event['eventType'] | null): SummerRankingData => ({
  slots: Array.isArray(data?.slots) ? data!.slots : [],
  matches: Array.isArray(data?.matches) ? data!.matches : [],
  participantIds: Array.isArray(data?.participantIds) ? data!.participantIds : [],
  rules: data?.rules ?? getDefaultRankingRules(eventType),
  rulesConfig: data?.rulesConfig ?? getDefaultRankingRulesConfig(eventType),
  availabilities: data?.availabilities ?? {},
  master: data?.master
    ? {
      format: data.master.format === 'groups' || (Array.isArray(data.master.groups) && data.master.groups.length > 0) ? 'groups' : 'bracket',
      manualQualifiedPlayerIds: Array.isArray(data.master.manualQualifiedPlayerIds) ? data.master.manualQualifiedPlayerIds : undefined,
      generatedQualifiedPlayerIds: Array.isArray(data.master.generatedQualifiedPlayerIds) ? data.master.generatedQualifiedPlayerIds : undefined,
      bracket: data.master.bracket ?? undefined,
      groups: Array.isArray(data.master.groups) ? data.master.groups : [],
      matches: Array.isArray(data.master.matches) ? data.master.matches : [],
      generatedAt: data.master.generatedAt,
    }
    : undefined,
  padelIndividualMaster: data?.padelIndividualMaster
    ? sanitizePadelIndividualMaster(data.padelIndividualMaster)
    : undefined,
});

export const sanitizeRankingDataForFirestore = (data: SummerRankingData, eventType?: Event['eventType'] | null): SummerRankingData => {
  const payload: SummerRankingData = {
    slots: Array.isArray(data.slots) ? data.slots : [],
    matches: Array.isArray(data.matches) ? data.matches.map(sanitizeMatch) : [],
    participantIds: Array.isArray(data.participantIds) ? Array.from(new Set(data.participantIds.filter(Boolean))) : [],
    rules: data.rules ?? getDefaultRankingRules(eventType),
    availabilities: data.availabilities ?? {},
  };
  if (data.rulesConfig) payload.rulesConfig = data.rulesConfig;
  if (data.master) {
    const nextMaster: NonNullable<SummerRankingData['master']> = {};
    nextMaster.format = data.master.format === 'groups' ? 'groups' : 'bracket';
    if (Array.isArray(data.master.manualQualifiedPlayerIds)) nextMaster.manualQualifiedPlayerIds = data.master.manualQualifiedPlayerIds;
    if (Array.isArray(data.master.generatedQualifiedPlayerIds)) nextMaster.generatedQualifiedPlayerIds = data.master.generatedQualifiedPlayerIds;
    if (data.master.bracket !== undefined) nextMaster.bracket = data.master.bracket;
    if (Array.isArray(data.master.groups)) nextMaster.groups = data.master.groups;
    if (Array.isArray(data.master.matches)) nextMaster.matches = data.master.matches.map(sanitizeMasterMatch);
    if (data.master.generatedAt !== undefined) nextMaster.generatedAt = data.master.generatedAt;
    payload.master = nextMaster;
  }
  if (data.padelIndividualMaster) {
    payload.padelIndividualMaster = sanitizePadelIndividualMaster(data.padelIndividualMaster);
  }
  return payload;
};

export const getMatchParticipantIds = (match: Match) => {
  const ids = [
    ...(Array.isArray(match.team1PlayerIds) ? match.team1PlayerIds : [match.player1Id]),
    ...(Array.isArray(match.team2PlayerIds) ? match.team2PlayerIds : [match.player2Id]),
  ].filter(Boolean);
  return Array.from(new Set(ids));
};

export const matchIncludesPlayer = (match: Match, playerId?: string) =>
  Boolean(playerId) && getMatchParticipantIds(match).includes(playerId!);
