import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type SummerAvailabilityByDay,
  type SummerAvailabilityStatus,
  type DrawMode,
  type Match,
  type Player,
  type PlayoffBracket,
  type SummerAvailabilityDay,
  type SummerAvailabilityPeriod,
  type SummerPlayerAvailability,
  type SummerPlayerAvailabilityEntry,
  type SummerRankingData,
  type SummerRankingMasterFormat,
  type SummerRankingMasterGroup,
  type SummerRankingMasterMatch,
  type SummerRankingRulesConfig,
  type TimeSlot,
} from '../types';
import { ArrowDownIcon, ArrowUpIcon, PhoneIcon, PlusIcon, TrashIcon, WhatsAppIcon } from './Icons';
import {
  SUMMER_RANKING_NAME,
  calculateSummerRanking,
  calculateSummerRankingMatchBreakdowns,
  createSummerRankingMasterData,
  generateRulesText,
  getSummerRankingAutoQualifiedPlayerIds,
  getEligibleOpponents,
  getHeadToHeadCount,
  getSummerRankingDiffBand,
  getSummerRankingMasterFormat,
  getSummerRankingMasterQualifiedPlayerIds,
  getSummerRankingLossPoints,
  getSummerRankingWinPoints,
  normalizeRulesConfig,
  recomputeSummerRankingMasterBracket,
  resetSummerRankingMasterData,
  removePlayerFromSummerRankingMaster,
  syncSummerRankingMasterMatches,
} from '../utils/summerRanking';
import {
  getSummerRankingScrollTarget,
  scrollSummerRankingRowIntoView,
  shouldAutoScrollToCurrentPlayer,
  SUMMER_RANKING_ROW_SCROLL_MARGIN,
  waitForSummerRankingScrollTarget,
} from '../utils/summerRankingAutoScroll';

// Portal renders children directly in document.body, bypassing any ancestor CSS transforms
// (such as animate-fadeIn) that would otherwise break position:fixed modal centering.
const Portal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const elRef = useRef<HTMLDivElement | null>(null);
  if (!elRef.current) elRef.current = document.createElement('div');
  useEffect(() => {
    const el = elRef.current!;
    document.body.appendChild(el);
    return () => {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, []);
  return createPortal(children, elRef.current!);
};

const formatSignedPoints = (value: number) => {
  const normalized = Math.round(value * 10) / 10;
  return `${normalized > 0 ? '+' : ''}${normalized} pt`;
};

const getMatchOutcomeLabel = (outcome: 'win' | 'loss' | 'draw') =>
  outcome === 'win' ? 'Vittoria' : outcome === 'loss' ? 'Sconfitta' : 'Pareggio';

type ChallengeModalState = {
  opponentId: string;
  opponentName: string;
  scheduledDate: string;
  scheduledHour: string;
  location: string;
  /** Only populated when an organiser creates the match (no currentPlayer). */
  player1Id?: string;
};

type MatchResultModalState = {
  matchId: string;
  score1: string;
  score2: string;
  outcome: 'player1' | 'player2' | 'draw' | '';
  error: string | null;
};

type RankingTab = 'ranking' | 'matches' | 'master' | 'rules' | 'settings' | 'availability' | 'players';
type AvailabilityDraftState = {
  status: SummerAvailabilityStatus;
  days: SummerAvailabilityDay[];
  periods: SummerAvailabilityPeriod[];
};
type AvailabilityFormState = {
  entries: SummerPlayerAvailabilityEntry[];
  isEditorOpen: boolean;
  editingEntryId: string | null;
  draft: AvailabilityDraftState;
};
type MasterScoreFormState = { matchId: string | null; score1: string; score2: string };

const AVAILABILITY_DAYS: Array<{ value: SummerAvailabilityDay; label: string; shortLabel: string }> = [
  { value: 'monday', label: 'Lunedì', shortLabel: 'Lun' },
  { value: 'tuesday', label: 'Martedì', shortLabel: 'Mar' },
  { value: 'wednesday', label: 'Mercoledì', shortLabel: 'Mer' },
  { value: 'thursday', label: 'Giovedì', shortLabel: 'Gio' },
  { value: 'friday', label: 'Venerdì', shortLabel: 'Ven' },
  { value: 'saturday', label: 'Sabato', shortLabel: 'Sab' },
  { value: 'sunday', label: 'Domenica', shortLabel: 'Dom' },
];

const AVAILABILITY_PERIODS: Array<{ value: SummerAvailabilityPeriod; label: string }> = [
  { value: 'morning', label: 'Mattina' },
  { value: 'afternoon', label: 'Pomeriggio' },
  { value: 'evening', label: 'Sera' },
];

const createEmptyAvailabilityByDay = (): Record<SummerAvailabilityDay, SummerAvailabilityPeriod[]> =>
  AVAILABILITY_DAYS.reduce((acc, day) => {
    acc[day.value] = [];
    return acc;
  }, {} as Record<SummerAvailabilityDay, SummerAvailabilityPeriod[]>);

const getNormalizedPeriods = (periods: SummerAvailabilityPeriod[] | undefined) =>
  AVAILABILITY_PERIODS
    .map(period => period.value)
    .filter(period => periods?.includes(period));

const getNormalizedDays = (days: SummerAvailabilityDay[] | undefined) =>
  AVAILABILITY_DAYS
    .map(day => day.value)
    .filter(day => days?.includes(day));

const createEmptyAvailabilityDraft = (): AvailabilityDraftState => ({
  status: 'available',
  days: [],
  periods: [],
});

const isAllAvailabilityDays = (days: SummerAvailabilityDay[]) => getNormalizedDays(days).length === AVAILABILITY_DAYS.length;

const formatAvailabilityDays = (days: SummerAvailabilityDay[], variant: 'short' | 'long' = 'long') =>
  getNormalizedDays(days)
    .map(day => AVAILABILITY_DAYS.find(option => option.value === day)?.[variant === 'short' ? 'shortLabel' : 'label'] ?? day)
    .join(', ');

const formatAvailabilityPeriods = (periods: SummerAvailabilityPeriod[]) =>
  getNormalizedPeriods(periods)
    .map(period => AVAILABILITY_PERIODS.find(option => option.value === period)?.label ?? period)
    .join(', ');

const normalizeAvailabilityEntries = (availability?: SummerPlayerAvailability): SummerPlayerAvailabilityEntry[] => {
  const normalizeEntry = (entry: SummerPlayerAvailabilityEntry, index: number): SummerPlayerAvailabilityEntry | null => {
    const days = getNormalizedDays(entry.days);
    if (days.length === 0) return null;
    const periods = entry.status === 'available' ? getNormalizedPeriods(entry.periods) : [];
    if (entry.status === 'available' && periods.length === 0) return null;
    return {
      id: entry.id ?? `availability_${index}`,
      status: entry.status,
      days,
      periods,
    };
  };

  if (availability?.entries?.length) {
    return availability.entries
      .map((entry, index) => normalizeEntry(entry, index))
      .filter((entry): entry is SummerPlayerAvailabilityEntry => entry !== null);
  }

  const normalizedDayPeriods = createEmptyAvailabilityByDay();
  AVAILABILITY_DAYS.forEach(day => {
    normalizedDayPeriods[day.value] = getNormalizedPeriods(availability?.dayPeriods?.[day.value]);
  });

  const groupedEntries = new Map<string, SummerAvailabilityDay[]>();
  AVAILABILITY_DAYS.forEach(day => {
    const periods = normalizedDayPeriods[day.value];
    if (periods.length === 0) return;
    const key = periods.join('|');
    groupedEntries.set(key, [...(groupedEntries.get(key) ?? []), day.value]);
  });

  if (groupedEntries.size > 0) {
    return Array.from(groupedEntries.entries()).map(([key, days], index) => ({
      id: `availability_${index}`,
      status: 'available',
      days,
      periods: key.split('|').filter(Boolean) as SummerAvailabilityPeriod[],
    }));
  }

  if (availability?.status === 'available') {
    const days = getNormalizedDays(availability.days);
    const periods = getNormalizedPeriods(availability.periods);
    if (days.length > 0 && periods.length > 0) {
      return [{
        id: 'availability_0',
        status: 'available',
        days,
        periods,
      }];
    }
  }

  if (availability?.status === 'unavailable') {
    const days = getNormalizedDays(availability.days);
    return [{
      id: 'availability_0',
      status: 'unavailable',
      days: days.length > 0 ? days : AVAILABILITY_DAYS.map(day => day.value),
      periods: [],
    }];
  }

  return [];
};

const applyAvailabilityEntriesToDayPeriods = (entries: SummerPlayerAvailabilityEntry[]) => {
  const normalized = createEmptyAvailabilityByDay();

  normalizeAvailabilityEntries({ entries }).forEach(entry => {
    if (entry.status === 'unavailable') {
      entry.days.forEach(day => {
        normalized[day] = [];
      });
      return;
    }

    const periods = getNormalizedPeriods(entry.periods);
    entry.days.forEach(day => {
      normalized[day] = getNormalizedPeriods([...(normalized[day] ?? []), ...periods]);
    });
  });

  return normalized;
};

const normalizeAvailabilityByDay = (availability?: SummerPlayerAvailability) => {
  const entries = normalizeAvailabilityEntries(availability);
  if (entries.length === 0) return createEmptyAvailabilityByDay();
  return applyAvailabilityEntriesToDayPeriods(entries);
};

const hasAvailabilitySelections = (dayPeriods: SummerAvailabilityByDay) =>
  AVAILABILITY_DAYS.some(day => (dayPeriods[day.value] ?? []).length > 0);

const getSelectedAvailabilityDays = (dayPeriods: SummerAvailabilityByDay) =>
  AVAILABILITY_DAYS
    .filter(day => (dayPeriods[day.value] ?? []).length > 0)
    .map(day => day.value);

const getSelectedAvailabilityPeriods = (dayPeriods: SummerAvailabilityByDay) =>
  Array.from(new Set(
    AVAILABILITY_DAYS.flatMap(day => dayPeriods[day.value] ?? [])
  ));

const createAvailabilityFormState = (availability?: SummerPlayerAvailability): AvailabilityFormState => ({
  entries: normalizeAvailabilityEntries(availability),
  isEditorOpen: false,
  editingEntryId: null,
  draft: createEmptyAvailabilityDraft(),
});

const buildAvailabilityPayload = (entries: SummerPlayerAvailabilityEntry[]): SummerPlayerAvailability | undefined => {
  const normalizedEntries = normalizeAvailabilityEntries({ entries });
  if (normalizedEntries.length === 0) return undefined;

  const dayPeriods = applyAvailabilityEntriesToDayPeriods(normalizedEntries);
  const selectedDays = getSelectedAvailabilityDays(dayPeriods);
  const selectedPeriods = getSelectedAvailabilityPeriods(dayPeriods);
  const unavailableDays = getNormalizedDays(
    normalizedEntries
      .filter(entry => entry.status === 'unavailable')
      .flatMap(entry => entry.days)
  );

  return {
    status: selectedDays.length > 0 ? 'available' : 'unavailable',
    days: selectedDays.length > 0 ? selectedDays : unavailableDays,
    periods: selectedDays.length > 0 ? selectedPeriods : [],
    dayPeriods: selectedDays.reduce<SummerAvailabilityByDay>((acc, day) => {
      if ((dayPeriods[day] ?? []).length > 0) {
        acc[day] = dayPeriods[day];
      }
      return acc;
    }, {}),
    entries: normalizedEntries,
    updatedAt: new Date().toISOString(),
  };
};

const toggleArrayValue = <T,>(items: T[], value: T) =>
  items.includes(value) ? items.filter(item => item !== value) : [...items, value];

const getRankingRulesText = (
  manualRules: string | undefined,
  rulesConfig: SummerRankingRulesConfig | undefined,
) => {
  if (typeof manualRules === 'string' && manualRules.trim().length > 0) return manualRules;
  return generateRulesText(normalizeRulesConfig(rulesConfig));
};

const getAvailabilitySummary = (availability?: SummerPlayerAvailability) => {
  const entries = normalizeAvailabilityEntries(availability);
  if (entries.length === 0) {
    return {
      status: 'Non dichiarata',
      details: null as string | null,
    };
  }

  if (entries.length === 1) {
    const entry = entries[0];
    if (entry.status === 'unavailable') {
      return {
        status: 'Non disponibile',
        details: isAllAvailabilityDays(entry.days) ? 'Tutta la settimana' : formatAvailabilityDays(entry.days, 'short'),
      };
    }
    return {
      status: 'Disponibile',
      details: `${formatAvailabilityDays(entry.days, 'short')}: ${formatAvailabilityPeriods(entry.periods ?? [])}`,
    };
  }

  const hasAvailableEntries = entries.some(entry => entry.status === 'available');
  const hasUnavailableEntries = entries.some(entry => entry.status === 'unavailable');

  return {
    status:
      hasAvailableEntries && hasUnavailableEntries
        ? 'Disponibilità personalizzata'
        : hasAvailableEntries
          ? 'Disponibile'
          : 'Non disponibile',
    details: entries
      .map(entry => (
        entry.status === 'unavailable'
          ? `${formatAvailabilityDays(entry.days, 'short')}: Non disponibile`
          : `${formatAvailabilityDays(entry.days, 'short')}: ${formatAvailabilityPeriods(entry.periods ?? [])}`
      ))
      .join(' • '),
  };
};

interface SummerRankingViewProps {
  players: Player[];
  rankingData: SummerRankingData;
  isOrganizer: boolean;
  loggedInPlayerId?: string;
  onPlayerContact: (player: Player) => void;
  onSaveRankingData: (nextData: SummerRankingData) => Promise<void>;
  onUpdatePlayerStartPoints: (playerId: string, points: number) => Promise<void>;
  onOpenPlayersAdmin?: () => void;
  title?: string;
  description?: string;
  playersAdminLabel?: string;
}

const generateId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const formatDateTime = (value?: string) => {
  if (!value) return 'Data non disponibile';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDateOnly = (value?: string) => {
  if (!value) return 'Data da definire';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const formatTimeOnly = (value?: string) => {
  if (!value) return 'Orario da definire';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const normalizeWhatsAppPhone = (phone?: string) => phone?.replace(/[^0-9]/g, '') ?? '';
const normalizeTelPhone = (phone?: string) => phone?.replace(/[^\d+]/g, '') ?? '';
const getMatchPlayedAtLabel = (match: Match) => match.completedAt ?? match.scheduledTime;
const getMatchSortTime = (match: Match) => {
  const playedAt = getMatchPlayedAtLabel(match);
  if (!playedAt) return Number.NaN;
  return new Date(playedAt).getTime();
};

const CIRCOLO_WHATSAPP_PHONE = '393397957909';
const CIRCOLO_WHATSAPP_LINK = `https://wa.me/${CIRCOLO_WHATSAPP_PHONE}?text=${encodeURIComponent('Salve, vi contatto per chiedere disponibilità per prenotare la partita per la summer Ranking per il giorno ')}`;

const buildWhatsAppReminderMessage = (
  senderName: string,
  scheduledTime?: string,
  location?: string,
  field?: string,
) => [
  `Ciao sono ${senderName},`,
  'ti ricordo la partita prenotata nel ranking.',
  `Data: ${formatDateOnly(scheduledTime)}`,
  `Ora: ${formatTimeOnly(scheduledTime)}`,
  `Luogo: ${location?.trim() || 'Da definire'}`,
  field?.trim() ? `Campo: ${field.trim()}` : null,
].filter(Boolean).join('\n');

const getChallengeBadgeTone = (pointsToWin: number) => {
  if (pointsToWin >= 40) return 'bg-red-500/20 text-red-300 border-red-400/40';
  if (pointsToWin >= 30) return 'bg-orange-500/20 text-orange-300 border-orange-400/40';
  return 'bg-green-500/20 text-green-300 border-green-400/40';
};

const OPPONENT_BAND_STYLES = {
  low: {
    legend: 'bg-yellow-500/60',
    row: 'bg-yellow-500/30 border-l-4 border-yellow-400',
  },
  medium: {
    legend: 'bg-orange-500/60',
    row: 'bg-orange-500/30 border-l-4 border-orange-400',
  },
  high: {
    legend: 'bg-purple-500/60',
    row: 'bg-purple-500/30 border-l-4 border-purple-400',
  },
} as const;

/** Returns an evident row style based on the point-difference band between
 *  the logged-in player and an opponent. */
const getOpponentBandRowClass = (band: 'low' | 'medium' | 'high') => {
  return OPPONENT_BAND_STYLES[band].row;
};

const arraysEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

const normalizeMasterDraftSelection = (
  qualifiedPlayerIds: string[],
  validPlayerIds: Set<string>,
  expectedSize: number,
) => {
  const uniquePlayerIds = qualifiedPlayerIds.reduce<string[]>((acc, playerId) => {
    if (!playerId || acc.includes(playerId) || !validPlayerIds.has(playerId)) return acc;
    acc.push(playerId);
    return acc;
  }, []);
  if (uniquePlayerIds.length !== expectedSize) return null;
  return uniquePlayerIds;
};

const getMasterMatchStatusLabel = (match: SummerRankingMasterMatch) => {
  if (match.status === 'completed') return 'Completata';
  if (match.status === 'scheduled') return 'Prenotata';
  return match.player1Id && match.player2Id ? 'Da organizzare' : 'In attesa qualificati';
};

const getMasterMatchStatusTone = (match: SummerRankingMasterMatch) => {
  if (match.status === 'completed') return 'bg-green-600 text-white';
  if (match.status === 'scheduled') return 'bg-accent text-white';
  return match.player1Id && match.player2Id ? 'bg-yellow-500/20 text-yellow-200' : 'bg-tertiary text-text-primary';
};

const getOperationalMatchStatus = (match: SummerRankingMasterMatch, slot: TimeSlot) => ({
  ...match,
  status: 'scheduled' as const,
  scheduledTime: slot.start,
  location: slot.location,
  field: slot.field,
  slotId: slot.id,
});

const rebuildMasterState = (
  bracket: PlayoffBracket,
  previousMatches: SummerRankingMasterMatch[],
  generatedQualifiedPlayerIds: string[],
  manualQualifiedPlayerIds?: string[],
  generatedAt?: string,
) => {
  const nextBracket = recomputeSummerRankingMasterBracket(bracket);
  return {
    format: 'bracket' as const,
    manualQualifiedPlayerIds,
    generatedQualifiedPlayerIds,
    bracket: nextBracket,
    matches: syncSummerRankingMasterMatches(nextBracket, previousMatches),
    generatedAt: generatedAt ?? new Date().toISOString(),
  };
};

const SummerRankingView: React.FC<SummerRankingViewProps> = ({
  players,
  rankingData,
  isOrganizer,
  loggedInPlayerId,
  onPlayerContact,
  onSaveRankingData,
  onUpdatePlayerStartPoints,
  onOpenPlayersAdmin,
  title,
  description,
  playersAdminLabel,
}) => {
  const [activeTab, setActiveTab] = useState<RankingTab>('ranking');
  const [slotForm, setSlotForm] = useState({ start: '', location: '', field: '' });
  const [bookingForm, setBookingForm] = useState({ slotId: '', opponentId: '', player1Id: '', player2Id: '' });
  const [resultModal, setResultModal] = useState<MatchResultModalState | null>(null);
  const [isSavingMatchResult, setIsSavingMatchResult] = useState(false);
  const [matchToDelete, setMatchToDelete] = useState<Match | null>(null);
  const [deleteMatchError, setDeleteMatchError] = useState<string | null>(null);
  const [isDeletingMatch, setIsDeletingMatch] = useState(false);
  const [matchActionError, setMatchActionError] = useState<string | null>(null);
  const [rulesConfigForm, setRulesConfigForm] = useState<SummerRankingRulesConfig>(() => normalizeRulesConfig(rankingData.rulesConfig));
  const [rulesSettingsError, setRulesSettingsError] = useState<string | null>(null);
  const [rulesSettingsSuccess, setRulesSettingsSuccess] = useState<string | null>(null);
  const [isSavingRulesSettings, setIsSavingRulesSettings] = useState(false);
  const [rulesForm, setRulesForm] = useState(() => getRankingRulesText(rankingData.rules, rankingData.rulesConfig));
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesSuccess, setRulesSuccess] = useState<string | null>(null);
  const [isSavingRules, setIsSavingRules] = useState(false);
  const [startPointsDrafts, setStartPointsDrafts] = useState<Record<string, string>>({});
  const [busyPlayerId, setBusyPlayerId] = useState<string | null>(null);
  const [pendingStartPointsConfirm, setPendingStartPointsConfirm] = useState<{ playerId: string; playerName: string; nextPoints: number } | null>(null);
  const [rankingSearchInput, setRankingSearchInput] = useState('');
  const [rankingSearch, setRankingSearch] = useState('');
  const [rankingRangeMin, setRankingRangeMin] = useState(0);
  const [rankingRangeMax, setRankingRangeMax] = useState<number | null>(null);
  const [filterAvailDays, setFilterAvailDays] = useState<SummerAvailabilityDay[]>([]);
  const [filterAvailPeriods, setFilterAvailPeriods] = useState<SummerAvailabilityPeriod[]>([]);
  const [availabilityForm, setAvailabilityForm] = useState<AvailabilityFormState>(() =>
    createAvailabilityFormState(loggedInPlayerId ? rankingData.availabilities?.[loggedInPlayerId] : undefined)
  );
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [isSavingAvailability, setIsSavingAvailability] = useState(false);
  const [masterQualifiedDraft, setMasterQualifiedDraft] = useState<string[]>([]);
  const [masterFormatDraft, setMasterFormatDraft] = useState<SummerRankingMasterFormat>('bracket');
  const [masterBookingSlotIdByMatch, setMasterBookingSlotIdByMatch] = useState<Record<string, string>>({});
  const [editingMasterMatchId, setEditingMasterMatchId] = useState<string | null>(null);
  const [masterScoreForm, setMasterScoreForm] = useState<MasterScoreFormState>({ matchId: null, score1: '', score2: '' });
  const [challengeModal, setChallengeModal] = useState<ChallengeModalState | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [challengeSuccess, setChallengeSuccess] = useState<string | null>(null);
  const [isSavingChallenge, setIsSavingChallenge] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [matchesSubTab, setMatchesSubTab] = useState<'booked' | 'completed_mine' | 'all_completed'>('booked');

  const currentPlayerMobileRowRef = useRef<HTMLElement | null>(null);
  const currentPlayerDesktopRowRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setRulesConfigForm(normalizeRulesConfig(rankingData.rulesConfig));
  }, [rankingData.rulesConfig]);
  useEffect(() => {
    setRulesForm(getRankingRulesText(rankingData.rules, rankingData.rulesConfig));
  }, [rankingData.rules, rankingData.rulesConfig]);

  const rankingParticipantIds = useMemo(
    () => (Array.isArray(rankingData.participantIds) ? rankingData.participantIds : []),
    [rankingData.participantIds],
  );
  const rankingParticipantIdSet = useMemo(
    () => new Set(rankingParticipantIds),
    [rankingParticipantIds],
  );
  const confirmedPlayers = useMemo(
    () =>
      players
        .filter(player => player.status === 'confirmed' && rankingParticipantIdSet.has(player.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [players, rankingParticipantIdSet],
  );
  useEffect(() => {
    setStartPointsDrafts(
      confirmedPlayers.reduce<Record<string, string>>((acc, player) => {
        acc[player.id] = String(player.summerRankingStartPoints ?? 0);
        return acc;
      }, {})
    );
  }, [confirmedPlayers]);
  const effectiveConfig = useMemo(
    () => normalizeRulesConfig(rankingData.rulesConfig),
    [rankingData.rulesConfig],
  );
  const ranking = useMemo(
    () => calculateSummerRanking(confirmedPlayers, rankingData.matches, effectiveConfig),
    [confirmedPlayers, rankingData.matches, effectiveConfig],
  );
  const matchBreakdowns = useMemo(
    () => calculateSummerRankingMatchBreakdowns(confirmedPlayers, rankingData.matches, effectiveConfig),
    [confirmedPlayers, rankingData.matches, effectiveConfig],
  );
  const autoQualifiedPlayerIds = useMemo(
    () => getSummerRankingAutoQualifiedPlayerIds(ranking, effectiveConfig),
    [ranking, effectiveConfig],
  );
  const currentMasterQualifiedPlayerIds = useMemo(
    () => getSummerRankingMasterQualifiedPlayerIds(ranking, rankingData.master, effectiveConfig),
    [ranking, rankingData.master, effectiveConfig],
  );
  const playerMap = useMemo(
    () => new Map(players.map(player => [player.id, player])),
    [players],
  );
  const masterFormat = useMemo(
    () => getSummerRankingMasterFormat(rankingData.master),
    [rankingData.master],
  );
  const masterGroups = useMemo<SummerRankingMasterGroup[]>(
    () => Array.isArray(rankingData.master?.groups) ? rankingData.master.groups : [],
    [rankingData.master?.groups],
  );
  const masterBracket = rankingData.master?.bracket;
  const masterMatches = useMemo(
    () => {
      if (Array.isArray(rankingData.master?.matches) && rankingData.master.matches.length > 0) {
        return rankingData.master.matches;
      }
      if (masterFormat === 'bracket' && masterBracket) {
        return syncSummerRankingMasterMatches(masterBracket);
      }
      return [];
    },
    [rankingData.master?.matches, masterBracket, masterFormat],
  );
  const bookedSlotIds = useMemo(
    () => new Set(
      [...rankingData.matches, ...masterMatches]
        .filter(match => match.slotId && match.status !== 'pending')
        .map(match => String(match.slotId))
    ),
    [rankingData.matches, masterMatches],
  );
  const availableSlots = useMemo(
    () => rankingData.slots
      .filter(slot => !bookedSlotIds.has(slot.id))
      .slice()
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [rankingData.slots, bookedSlotIds],
  );
  const currentPlayer = confirmedPlayers.find(player => player.id === loggedInPlayerId);
  const currentPlayerAvailability = loggedInPlayerId ? rankingData.availabilities?.[loggedInPlayerId] : undefined;
  const isLegacyAvailability = !!currentPlayerAvailability && !(currentPlayerAvailability.entries?.length > 0);
  const currentAvailabilitySummary = useMemo(
    () => getAvailabilitySummary(availabilityForm.entries.length > 0 ? { entries: availabilityForm.entries } : undefined),
    [availabilityForm.entries],
  );
  const eligibleOpponents = useMemo(
    () => currentPlayer ? getEligibleOpponents(confirmedPlayers, rankingData.matches, currentPlayer.id, effectiveConfig) : [],
    [confirmedPlayers, rankingData.matches, currentPlayer, effectiveConfig],
  );

  const canBookAsParticipant = !!currentPlayer;
  const rankingById = useMemo(
    () => new Map(ranking.map(entry => [entry.player.id, entry])),
    [ranking],
  );
  const selectedPlayerProfile = useMemo(() => {
    if (!selectedPlayerId) return null;
    const player = playerMap.get(selectedPlayerId);
    if (!player) return null;

    const rankingEntry = rankingById.get(selectedPlayerId);
    const startingPoints = rankingEntry?.startingPoints ?? player.summerRankingStartPoints ?? 0;
    let runningPoints = startingPoints;

    const history = rankingData.matches
      .filter(match =>
        match.status === 'completed' &&
        match.score1 !== null &&
        match.score2 !== null &&
        (match.player1Id === selectedPlayerId || match.player2Id === selectedPlayerId)
      )
      .slice()
      .sort((a, b) => {
        const aTime = getMatchSortTime(a);
        const bTime = getMatchSortTime(b);
        if (Number.isNaN(aTime) && Number.isNaN(bTime)) return a.id.localeCompare(b.id);
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;
        return aTime - bTime;
      })
      .map(match => {
        const isPlayer1 = match.player1Id === selectedPlayerId;
        const opponent = playerMap.get(isPlayer1 ? match.player2Id : match.player1Id);
        const breakdown = matchBreakdowns.get(match.id);
        const playerBreakdown = breakdown
          ? (isPlayer1 ? breakdown.player1 : breakdown.player2)
          : null;
        const pointsBefore = runningPoints;
        const pointsDelta = playerBreakdown?.totalPoints ?? 0;
        const pointsAfter = pointsBefore + pointsDelta;
        runningPoints = pointsAfter;

        return {
          match,
          opponent,
          breakdown: playerBreakdown,
          pointsBefore,
          pointsAfter,
          pointsDelta,
          scoreLabel: match.score1 !== null && match.score2 !== null
            ? `${isPlayer1 ? match.score1 : match.score2} - ${isPlayer1 ? match.score2 : match.score1}`
            : '—',
        };
      });

    return {
      player,
      rankingEntry,
      startingPoints,
      currentPoints: rankingEntry?.points ?? history.at(-1)?.pointsAfter ?? startingPoints,
      history,
      hasPhone: !!player.phone?.trim(),
      whatsappPhone: normalizeWhatsAppPhone(player.phone),
      telPhone: normalizeTelPhone(player.phone),
    };
  }, [selectedPlayerId, playerMap, rankingById, rankingData.matches, matchBreakdowns]);
  const addablePlayers = useMemo(
    () =>
      players
        .filter(player => player.status === 'confirmed' && !rankingParticipantIdSet.has(player.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [players, rankingParticipantIdSet],
  );

  useEffect(() => {
    setAvailabilityForm(createAvailabilityFormState(currentPlayerAvailability));
    setAvailabilityError(null);
  }, [currentPlayerAvailability, loggedInPlayerId]);

  useEffect(() => {
    setMasterQualifiedDraft(currentMasterQualifiedPlayerIds);
  }, [currentMasterQualifiedPlayerIds]);

  useEffect(() => {
    setMasterFormatDraft(masterFormat);
  }, [masterFormat]);

  useEffect(() => {
    setMasterBookingSlotIdByMatch(previous => {
      const validMatchIds = new Set(masterMatches.map(match => match.id));
      const nextState: Record<string, string> = {};
      for (const matchId of Object.keys(previous)) {
        if (validMatchIds.has(matchId)) {
          nextState[matchId] = previous[matchId];
        }
      }
      return nextState;
    });
  }, [masterMatches]);

  const handleAddSlot = async () => {
    if (!slotForm.start || !slotForm.location.trim()) return;
    const nextSlot: TimeSlot = {
      id: generateId('slot'),
      start: slotForm.start,
      location: slotForm.location.trim(),
      field: slotForm.field.trim(),
    };
    await onSaveRankingData({
      ...rankingData,
      slots: [...rankingData.slots, nextSlot],
    });
  };

  const handleDeleteSlot = async (slotId: string) => {
    await onSaveRankingData({
      ...rankingData,
      slots: rankingData.slots.filter(slot => slot.id !== slotId),
    });
  };

  const handleCreateBookedMatch = async () => {
    const slot = availableSlots.find(item => item.id === bookingForm.slotId);
    if (!slot) return;

    const participantIds = isOrganizer && !loggedInPlayerId
      ? [bookingForm.player1Id, bookingForm.player2Id]
      : [loggedInPlayerId ?? '', bookingForm.opponentId];

    if (!participantIds[0] || !participantIds[1] || participantIds[0] === participantIds[1]) return;
    if (getHeadToHeadCount(rankingData.matches, participantIds[0], participantIds[1]) >= effectiveConfig.headToHeadLimit) return;

    const nextMatch: Match = {
      id: generateId('srn-match'),
      player1Id: participantIds[0],
      player2Id: participantIds[1],
      score1: null,
      score2: null,
      status: 'scheduled',
      scheduledTime: slot.start,
      location: slot.location,
      field: slot.field,
      slotId: slot.id,
    };

    await onSaveRankingData({
      ...rankingData,
      matches: [...rankingData.matches, nextMatch],
    });
    setBookingForm({ slotId: '', opponentId: '', player1Id: '', player2Id: '' });
  };

  const openEditResult = (match: Match) => {
    setMatchActionError(null);
    setResultModal({
      matchId: match.id,
      score1: match.score1 !== null ? String(match.score1) : '',
      score2: match.score2 !== null ? String(match.score2) : '',
      outcome: match.score1 === null || match.score2 === null
        ? ''
        : match.score1 === match.score2
          ? 'draw'
          : match.score1 > match.score2
            ? 'player1'
            : 'player2',
      error: null,
    });
  };

  const closeResultModal = () => {
    if (isSavingMatchResult) return;
    setResultModal(null);
  };

  const handleSaveResult = async () => {
    if (!resultModal) return;

    if (!resultModal.score1.trim() || !resultModal.score2.trim()) {
      setResultModal(previous => previous ? { ...previous, error: 'Il risultato è obbligatorio.' } : previous);
      return;
    }
    if (!resultModal.outcome) {
      setResultModal(previous => previous ? { ...previous, error: 'Seleziona vincitore o pareggio.' } : previous);
      return;
    }

    const score1 = Number(resultModal.score1);
    const score2 = Number(resultModal.score2);
    if (!Number.isFinite(score1) || !Number.isFinite(score2) || score1 < 0 || score2 < 0) {
      setResultModal(previous => previous ? { ...previous, error: 'Inserisci un punteggio valido (solo numeri >= 0).' } : previous);
      return;
    }

    if (resultModal.outcome === 'draw' && score1 !== score2) {
      setResultModal(previous => previous ? { ...previous, error: 'Con pareggio selezionato, i due punteggi devono essere uguali.' } : previous);
      return;
    }
    if (resultModal.outcome === 'player1' && score1 <= score2) {
      setResultModal(previous => previous ? { ...previous, error: 'Il vincitore selezionato è il Giocatore 1: il suo punteggio deve essere maggiore.' } : previous);
      return;
    }
    if (resultModal.outcome === 'player2' && score2 <= score1) {
      setResultModal(previous => previous ? { ...previous, error: 'Il vincitore selezionato è il Giocatore 2: il suo punteggio deve essere maggiore.' } : previous);
      return;
    }

    const match = rankingData.matches.find(item => item.id === resultModal.matchId);
    if (!match) {
      setResultModal(previous => previous ? { ...previous, error: 'Partita non trovata. Aggiorna la pagina e riprova.' } : previous);
      return;
    }

    setIsSavingMatchResult(true);
    setMatchActionError(null);
    setResultModal(previous => previous ? { ...previous, error: null } : previous);
    try {
      await onSaveRankingData({
        ...rankingData,
        matches: rankingData.matches.map(item =>
          item.id === match.id
            ? {
                ...item,
                score1,
                score2,
                status: 'completed',
                completedAt: item.completedAt ?? new Date().toISOString(),
              }
            : item
        ),
      });
      setResultModal(null);
    } catch (error) {
      console.error('Errore salvataggio risultato partita', error);
      setResultModal(previous => previous ? { ...previous, error: 'Salvataggio non riuscito. Riprova.' } : previous);
    } finally {
      setIsSavingMatchResult(false);
    }
  };

  const handleResetResult = async (match: Match) => {
    setMatchActionError(null);
    try {
      await onSaveRankingData({
        ...rankingData,
        matches: rankingData.matches.map(item =>
          item.id === match.id
            ? {
                ...item,
                score1: null,
                score2: null,
                status: item.slotId ? 'scheduled' : 'pending',
                completedAt: undefined,
              }
            : item
        ),
      });
    } catch (error) {
      console.error('Errore ripristino risultato partita', error);
      setMatchActionError('Ripristino non riuscito. Riprova.');
    }
  };

  const openDeleteMatchModal = (match: Match) => {
    setDeleteMatchError(null);
    setMatchActionError(null);
    setMatchToDelete(match);
  };

  const closeDeleteMatchModal = () => {
    if (isDeletingMatch) return;
    setMatchToDelete(null);
    setDeleteMatchError(null);
  };

  const handleDeleteMatch = async () => {
    if (!matchToDelete) return;
    setIsDeletingMatch(true);
    setDeleteMatchError(null);
    setMatchActionError(null);
    try {
      await onSaveRankingData({
        ...rankingData,
        matches: rankingData.matches.filter(match => match.id !== matchToDelete.id),
      });
      setMatchToDelete(null);
    } catch (error) {
      console.error('Errore eliminazione partita', error);
      setDeleteMatchError('Eliminazione non riuscita. Riprova.');
    } finally {
      setIsDeletingMatch(false);
    }
  };

  const openChallengeModal = (opponentId?: string, opponentName?: string) => {
    const initialOpponentId = opponentId ?? eligibleOpponents[0]?.id ?? '';
    const initialOpponentName = opponentName
      ?? eligibleOpponents.find(player => player.id === initialOpponentId)?.name
      ?? '';
    // Admin without their own player account needs to pick both participants.
    const player1Id = (isOrganizer && !currentPlayer) ? '' : undefined;
    setChallengeModal({ opponentId: initialOpponentId, opponentName: initialOpponentName, scheduledDate: '', scheduledHour: '', location: 'Tennis Salò Canottieri', player1Id });
    setChallengeError(null);
    setChallengeSuccess(null);
  };

  const closeChallengeModal = () => {
    setChallengeModal(null);
    setChallengeError(null);
    setChallengeSuccess(null);
  };

  const handleCreateChallenge = async () => {
    if (!challengeModal) return;
    // For organisers without a player account the modal carries player1Id; for
    // regular players we fall back to loggedInPlayerId.
    const isAdminMode = isOrganizer && !currentPlayer;
    const effectivePlayer1Id = isAdminMode ? (challengeModal.player1Id ?? '') : (loggedInPlayerId ?? '');
    if (!isAdminMode && (!loggedInPlayerId || !currentPlayer)) return;
    if (isAdminMode && !effectivePlayer1Id) return;
    const { opponentId, scheduledDate, scheduledHour, location } = challengeModal;

    if (!opponentId) {
      setChallengeError('Seleziona un avversario per prenotare la partita.');
      return;
    }
    if (!scheduledDate) {
      setChallengeError('Seleziona una data per la partita.');
      return;
    }
    if (!scheduledHour) {
      setChallengeError('Seleziona un orario per la partita.');
      return;
    }
    if (!location) {
      setChallengeError('Seleziona un luogo per la partita.');
      return;
    }

    const scheduledTime = `${scheduledDate}T${scheduledHour}`;
    const chosenDate = new Date(scheduledTime);
    if (Number.isNaN(chosenDate.getTime())) {
      setChallengeError('Data o orario non validi.');
      return;
    }

    if (opponentId === effectivePlayer1Id) {
      setChallengeError('Non puoi prenotare una partita contro te stesso.');
      return;
    }

    if (getHeadToHeadCount(rankingData.matches, effectivePlayer1Id, opponentId) >= effectiveConfig.headToHeadLimit) {
      setChallengeError(`Il limite massimo di ${effectiveConfig.headToHeadLimit} scontri tra questi giocatori è già stato raggiunto.`);
      return;
    }

    const nextMatch: Match = {
      id: generateId('srn-booking'),
      player1Id: effectivePlayer1Id,
      player2Id: opponentId,
      score1: null,
      score2: null,
      status: 'scheduled',
      scheduledTime: chosenDate.toISOString(),
      location: location,
    };

    setIsSavingChallenge(true);
    setChallengeError(null);
    try {
      await onSaveRankingData({
        ...rankingData,
        matches: [...rankingData.matches, nextMatch],
      });
      setChallengeSuccess('Partita prenotata con successo! La partita è ora visibile nel tab Partite.');
      setTimeout(() => {
        closeChallengeModal();
      }, 1500);
    } catch (err) {
      console.error('Errore prenotazione partita', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      setChallengeError(`Salvataggio non riuscito: ${errMsg}. Riprova.`);
    } finally {
      setIsSavingChallenge(false);
    }
  };

  const persistMasterQualifiedPlayers = async (qualifiedPlayerIds: string[]) => {
    const normalizedQualifiedPlayerIds = normalizeMasterDraftSelection(
      qualifiedPlayerIds,
      new Set(masterCandidatePlayers.map(player => player.id)),
      effectiveConfig.masterSize,
    );
    if (!normalizedQualifiedPlayerIds) return;

    const manualQualifiedPlayerIds = arraysEqual(normalizedQualifiedPlayerIds, autoQualifiedPlayerIds)
      ? undefined
      : normalizedQualifiedPlayerIds;

    const shouldRebuildGeneratedMaster = isMasterGenerated && normalizedQualifiedPlayerIds.length >= 2;
    const nextMaster = shouldRebuildGeneratedMaster
      ? createSummerRankingMasterData(
        normalizedQualifiedPlayerIds,
        manualQualifiedPlayerIds,
        rankingData.master?.matches ?? [],
        masterFormatDraft,
      )
      : {
        ...rankingData.master,
        manualQualifiedPlayerIds,
      };

    await onSaveRankingData({
      ...rankingData,
      master: nextMaster,
    });
  };

  const handleGenerateMaster = async () => {
    const normalizedQualifiedPlayerIds = normalizeMasterDraftSelection(
      masterQualifiedDraft,
      new Set(masterCandidatePlayers.map(player => player.id)),
      effectiveConfig.masterSize,
    );
    if (!isOrganizer || !normalizedQualifiedPlayerIds || normalizedQualifiedPlayerIds.length < 2) return;

    const manualQualifiedPlayerIds = arraysEqual(normalizedQualifiedPlayerIds, autoQualifiedPlayerIds)
      ? undefined
      : normalizedQualifiedPlayerIds;
    const nextMaster = createSummerRankingMasterData(
      normalizedQualifiedPlayerIds,
      manualQualifiedPlayerIds,
      [],
      masterFormatDraft,
    );

    await onSaveRankingData({
      ...rankingData,
      master: nextMaster,
    });
  };

  const handleResetMaster = async () => {
    if (!isOrganizer || !isMasterGenerated) return;

    await onSaveRankingData({
      ...rankingData,
      master: resetSummerRankingMasterData(rankingData.master, masterFormat),
    });

    setEditingMasterMatchId(null);
    setMasterScoreForm({ matchId: null, score1: '', score2: '' });
  };

  const canManageMasterMatch = (match: SummerRankingMasterMatch) =>
    isOrganizer || loggedInPlayerId === match.player1Id || loggedInPlayerId === match.player2Id;

  const handleScheduleMasterMatch = async (match: SummerRankingMasterMatch) => {
    const slotId = masterBookingSlotIdByMatch[match.id];
    const slot = availableSlots.find(item => item.id === slotId);
    if (!slot || !canManageMasterMatch(match) || !rankingData.master?.matches) return;

    await onSaveRankingData({
      ...rankingData,
      master: {
        ...rankingData.master,
        matches: rankingData.master.matches.map(item =>
          item.id === match.id ? getOperationalMatchStatus(item, slot) : item
        ),
      },
    });

    setMasterBookingSlotIdByMatch(previous => ({ ...previous, [match.id]: '' }));
  };

  const openEditMasterResult = (match: SummerRankingMasterMatch) => {
    setEditingMasterMatchId(match.id);
    setMasterScoreForm({
      matchId: match.id,
      score1: match.score1 !== null ? String(match.score1) : '',
      score2: match.score2 !== null ? String(match.score2) : '',
    });
  };

  const handleSaveMasterResult = async (match: SummerRankingMasterMatch) => {
    if (!rankingData.master?.matches || !canManageMasterMatch(match)) return;

    const score1 = Number(masterScoreForm.score1);
    const score2 = Number(masterScoreForm.score2);
    if (
      Number.isNaN(score1) ||
      Number.isNaN(score2) ||
      score1 < 0 ||
      score2 < 0 ||
      score1 === score2
    ) {
      return;
    }

    const nextMatches = rankingData.master.matches.map(item =>
      item.id === match.id
        ? {
            ...item,
            score1,
            score2,
            status: 'completed',
            completedAt: item.completedAt ?? new Date().toISOString(),
          }
        : item
    );

    const nextMaster = masterFormat === 'bracket' && rankingData.master.bracket
      ? (() => {
          const nextBracket: PlayoffBracket = JSON.parse(JSON.stringify(rankingData.master!.bracket));
          const bracketMatch = nextBracket.matches.find(item => item.id === match.id);
          if (!bracketMatch) return rankingData.master;
          bracketMatch.score1 = score1;
          bracketMatch.score2 = score2;
          return rebuildMasterState(
            nextBracket,
            nextMatches,
            rankingData.master?.generatedQualifiedPlayerIds ?? [],
            rankingData.master?.manualQualifiedPlayerIds,
            rankingData.master?.generatedAt,
          );
        })()
      : {
          ...rankingData.master,
          matches: nextMatches,
        };

    await onSaveRankingData({
      ...rankingData,
      master: nextMaster,
    });

    setEditingMasterMatchId(null);
    setMasterScoreForm({ matchId: null, score1: '', score2: '' });
  };

  const handleResetMasterResult = async (match: SummerRankingMasterMatch) => {
    if (!rankingData.master?.matches || !canManageMasterMatch(match)) return;

    const nextMatches = rankingData.master.matches.map(item =>
      item.id === match.id
        ? {
            ...item,
            score1: null,
            score2: null,
            status: item.slotId ? 'scheduled' : 'pending',
            completedAt: undefined,
          }
        : item
    );

    const nextMaster = masterFormat === 'bracket' && rankingData.master.bracket
      ? (() => {
          const nextBracket: PlayoffBracket = JSON.parse(JSON.stringify(rankingData.master!.bracket));
          const bracketMatch = nextBracket.matches.find(item => item.id === match.id);
          if (!bracketMatch) return rankingData.master;
          bracketMatch.score1 = null;
          bracketMatch.score2 = null;
          bracketMatch.winnerId = null;
          return rebuildMasterState(
            nextBracket,
            nextMatches,
            rankingData.master?.generatedQualifiedPlayerIds ?? [],
            rankingData.master?.manualQualifiedPlayerIds,
            rankingData.master?.generatedAt,
          );
        })()
      : {
          ...rankingData.master,
          matches: nextMatches,
        };

    await onSaveRankingData({
      ...rankingData,
      master: nextMaster,
    });

    if (editingMasterMatchId === match.id) {
      setEditingMasterMatchId(null);
      setMasterScoreForm({ matchId: null, score1: '', score2: '' });
    }
  };

  const hasRulesSettingsChanges = useMemo(
    () => JSON.stringify(rulesConfigForm) !== JSON.stringify(effectiveConfig),
    [rulesConfigForm, effectiveConfig],
  );
  const effectiveRulesText = useMemo(
    () => getRankingRulesText(rankingData.rules, rankingData.rulesConfig),
    [rankingData.rules, rankingData.rulesConfig],
  );
  const hasRulesChanges = useMemo(
    () => rulesForm !== effectiveRulesText,
    [rulesForm, effectiveRulesText],
  );

  const updateRulesConfig = (key: keyof SummerRankingRulesConfig, rawValue: string) => {
    if (key === 'drawMode') {
      const mode = rawValue as DrawMode;
      if (mode === 'percentage' || mode === 'fixed') {
        setRulesConfigForm(prev => ({ ...prev, drawMode: mode }));
      }
    } else {
      const parsed = Number(rawValue);
      if (!Number.isNaN(parsed)) {
        setRulesConfigForm(prev => ({ ...prev, [key]: parsed }));
      }
    }
    setRulesSettingsError(null);
    setRulesSettingsSuccess(null);
  };

  const toggleRulesConfigFlag = (key: 'participationBonusEnabled' | 'gameDiffBonusEnabled' | 'wonGamesBonusEnabled' | 'inactivityMalusEnabled') => {
    setRulesConfigForm(prev => ({ ...prev, [key]: !prev[key] }));
    setRulesSettingsError(null);
    setRulesSettingsSuccess(null);
  };

  const resetRulesSettings = () => {
    setRulesConfigForm(normalizeRulesConfig(rankingData.rulesConfig));
    setRulesSettingsError(null);
    setRulesSettingsSuccess(null);
  };

  const resetRules = () => {
    setRulesForm(effectiveRulesText);
    setRulesError(null);
    setRulesSuccess(null);
  };

  const handleSaveRulesSettings = async () => {
    setIsSavingRulesSettings(true);
    setRulesSettingsError(null);
    setRulesSettingsSuccess(null);
    try {
      await onSaveRankingData({
        ...rankingData,
        rulesConfig: rulesConfigForm,
      });
      setRulesSettingsSuccess('Impostazioni salvate con successo. La classifica è stata aggiornata.');
    } catch (error) {
      console.error('Errore salvataggio impostazioni', error);
      setRulesSettingsError('Salvataggio non riuscito. Riprova.');
    } finally {
      setIsSavingRulesSettings(false);
    }
  };

  const handleSaveRules = async () => {
    if (!isOrganizer) return;
    setIsSavingRules(true);
    setRulesError(null);
    setRulesSuccess(null);
    try {
      await onSaveRankingData({
        ...rankingData,
        rules: rulesForm,
      });
      setRulesSuccess('Regolamento salvato con successo.');
    } catch (error) {
      console.error('Errore salvataggio regolamento', error);
      setRulesError('Salvataggio non riuscito. Riprova.');
    } finally {
      setIsSavingRules(false);
    }
  };

  const requestStartPointsSave = (playerId: string) => {
    const nextPoints = Number(startPointsDrafts[playerId] ?? 0);
    if (Number.isNaN(nextPoints)) return;
    const player = confirmedPlayers.find(p => p.id === playerId);
    setPendingStartPointsConfirm({ playerId, playerName: player?.name ?? playerId, nextPoints });
  };

  const confirmStartPointsSave = async () => {
    if (!pendingStartPointsConfirm) return;
    const { playerId, nextPoints } = pendingStartPointsConfirm;
    setPendingStartPointsConfirm(null);
    setBusyPlayerId(playerId);
    try {
      await onUpdatePlayerStartPoints(playerId, nextPoints);
    } finally {
      setBusyPlayerId(null);
    }
  };

  const canEditMatchResult = (match: Match) =>
    isOrganizer || loggedInPlayerId === match.player1Id || loggedInPlayerId === match.player2Id;

  const persistAvailabilityEntries = async (entries: SummerPlayerAvailabilityEntry[]) => {
    if (!currentPlayer) return;
    const nextAvailabilities = { ...(rankingData.availabilities ?? {}) };
    const nextAvailability = buildAvailabilityPayload(entries);

    if (nextAvailability) {
      nextAvailabilities[currentPlayer.id] = nextAvailability;
    } else {
      delete nextAvailabilities[currentPlayer.id];
    }

    setIsSavingAvailability(true);
    setAvailabilityError(null);

    try {
      await onSaveRankingData({
        ...rankingData,
        availabilities: nextAvailabilities,
      });
      setAvailabilityForm({
        entries: nextAvailability?.entries ?? [],
        isEditorOpen: false,
        editingEntryId: null,
        draft: createEmptyAvailabilityDraft(),
      });
    } catch (error) {
      console.error('Errore durante il salvataggio delle disponibilità:', error);
      setAvailabilityError('Non è stato possibile salvare le disponibilità. Riprova.');
    } finally {
      setIsSavingAvailability(false);
    }
  };

  const handleSubmitAvailabilityEntry = async () => {
    const days = getNormalizedDays(availabilityForm.draft.days);
    const periods = getNormalizedPeriods(availabilityForm.draft.periods);

    if (days.length === 0) {
      setAvailabilityError('Seleziona almeno un giorno.');
      return;
    }

    if (availabilityForm.draft.status === 'available' && periods.length === 0) {
      setAvailabilityError('Seleziona almeno una fascia oraria per una disponibilità disponibile.');
      return;
    }

    const nextEntry: SummerPlayerAvailabilityEntry = {
      id: availabilityForm.editingEntryId ?? generateId('availability'),
      status: availabilityForm.draft.status,
      days,
      periods: availabilityForm.draft.status === 'available' ? periods : [],
    };

    const nextEntries = availabilityForm.editingEntryId
      ? availabilityForm.entries.map(entry => (entry.id === availabilityForm.editingEntryId ? nextEntry : entry))
      : [...availabilityForm.entries, nextEntry];

    await persistAvailabilityEntries(nextEntries);
  };

  const handleDeleteAvailabilityEntry = async (entryId: string) => {
    await persistAvailabilityEntries(availabilityForm.entries.filter(entry => entry.id !== entryId));
  };

  const handleClearAvailabilityEntries = async () => {
    await persistAvailabilityEntries([]);
  };

  const handleAddParticipant = async (playerId: string) => {
    if (!isOrganizer || rankingParticipantIdSet.has(playerId)) return;
    await onSaveRankingData({
      ...rankingData,
      participantIds: [...rankingParticipantIds, playerId],
    });
  };

  const handleRemoveParticipant = async (playerId: string) => {
    if (!isOrganizer || !rankingParticipantIdSet.has(playerId)) return;
    const nextAvailabilities = { ...(rankingData.availabilities ?? {}) };
    delete nextAvailabilities[playerId];
    await onSaveRankingData({
      ...rankingData,
      participantIds: rankingParticipantIds.filter(id => id !== playerId),
      matches: rankingData.matches.filter(match => match.player1Id !== playerId && match.player2Id !== playerId),
      availabilities: nextAvailabilities,
      master: removePlayerFromSummerRankingMaster(rankingData.master, playerId),
    });
  };

  const masterQualifiedIdSet = useMemo(
    () => new Set(currentMasterQualifiedPlayerIds),
    [currentMasterQualifiedPlayerIds],
  );
  const topEightQualified = ranking.filter(entry => masterQualifiedIdSet.has(entry.player.id));
  const maxPossiblePoints = useMemo(
    () => (ranking.length > 0 ? Math.max(...ranking.map(entry => entry.points)) : 0),
    [ranking],
  );
  const effectiveRangeMax = rankingRangeMax ?? maxPossiblePoints;
  const normalizedRankingSearch = rankingSearch.trim().toLowerCase();
  const hasActivePointsFilter = rankingRangeMin > 0 || effectiveRangeMax < maxPossiblePoints;
  const hasActiveAvailFilter = filterAvailDays.length > 0 || filterAvailPeriods.length > 0;
  const hasActiveRankingFilters = normalizedRankingSearch.length > 0 || hasActivePointsFilter || hasActiveAvailFilter;
  const filteredRanking = useMemo(
    () =>
      ranking.filter(entry => {
        if (
          normalizedRankingSearch.length > 0 &&
          !entry.player.name.toLowerCase().includes(normalizedRankingSearch) &&
          !entry.player.id.toLowerCase().includes(normalizedRankingSearch)
        ) return false;
        if (entry.points < rankingRangeMin || entry.points > effectiveRangeMax) return false;
        if (filterAvailDays.length > 0 || filterAvailPeriods.length > 0) {
          const avail = rankingData.availabilities?.[entry.player.id];
          const dayPeriods = normalizeAvailabilityByDay(avail);
          const selectedPeriods = getSelectedAvailabilityPeriods(dayPeriods);
          if (!hasAvailabilitySelections(dayPeriods)) return false;
          if (filterAvailDays.length > 0 && !filterAvailDays.some(day => (dayPeriods[day] ?? []).length > 0)) return false;
          if (filterAvailPeriods.length > 0 && !filterAvailPeriods.some(period => selectedPeriods.includes(period))) return false;
        }
        return true;
      }),
    [ranking, normalizedRankingSearch, rankingRangeMin, effectiveRangeMax, filterAvailDays, filterAvailPeriods, rankingData.availabilities],
  );
  const currentPlayerRankingEntry = useMemo(
    () => loggedInPlayerId ? ranking.find(entry => entry.player.id === loggedInPlayerId) : undefined,
    [ranking, loggedInPlayerId],
  );
  const showChallengePointsColumn = !!currentPlayerRankingEntry;
  const currentPlayerVisibleInFilteredRanking = useMemo(
    () => !!(loggedInPlayerId && filteredRanking.some(entry => entry.player.id === loggedInPlayerId)),
    [filteredRanking, loggedInPlayerId],
  );
  useEffect(() => {
    if (!shouldAutoScrollToCurrentPlayer({
      activeTab,
      loggedInPlayerId,
      isCurrentPlayerVisible: currentPlayerVisibleInFilteredRanking,
    })) return;

    return waitForSummerRankingScrollTarget({
      getTarget: () =>
        getSummerRankingScrollTarget({
          mobileRow: currentPlayerMobileRowRef.current,
          desktopRow: currentPlayerDesktopRowRef.current,
        }),
      onTargetReady: scrollSummerRankingRowIntoView,
    });
  }, [activeTab, loggedInPlayerId, currentPlayerVisibleInFilteredRanking, filteredRanking.length]);
  const masterCandidatePlayers = useMemo(
    () => ranking.map(entry => entry.player),
    [ranking],
  );
  const masterCandidateIdSet = useMemo(
    () => new Set(masterCandidatePlayers.map(player => player.id)),
    [masterCandidatePlayers],
  );
  const hasValidMasterDraft = useMemo(
    () => !!normalizeMasterDraftSelection(masterQualifiedDraft, masterCandidateIdSet, effectiveConfig.masterSize),
    [masterQualifiedDraft, masterCandidateIdSet, effectiveConfig.masterSize],
  );
  const generatedMasterQualifiedPlayerIds = rankingData.master?.generatedQualifiedPlayerIds ?? [];
  const isMasterGenerated = masterFormat === 'bracket'
    ? !!masterBracket?.isGenerated
    : Array.isArray(rankingData.master?.matches) && rankingData.master.matches.length > 0;
  const masterNeedsRegeneration = isMasterGenerated && (
    !arraysEqual(currentMasterQualifiedPlayerIds, generatedMasterQualifiedPlayerIds) ||
    masterFormat !== masterFormatDraft
  );
  const visibleMasterMatches = useMemo(
    () =>
      masterMatches
        .slice()
        .sort((a, b) => a.round - b.round || a.label.localeCompare(b.label)),
    [masterMatches],
  );
  const visibleMasterStages = useMemo(
    () =>
      ([
        ['quarterfinal', 'Quarti di finale'],
        ['semifinal', 'Semifinali'],
        ['final', 'Finale'],
        ['thirdPlace', 'Finale 3°/4°'],
      ] as const).filter(([stage]) => visibleMasterMatches.some(match => match.stage === stage)),
    [visibleMasterMatches],
  );
  const masterMatchesByGroup = useMemo(
    () =>
      masterGroups.map(group => ({
        ...group,
        matches: visibleMasterMatches.filter(match => match.groupId === group.id),
      })),
    [masterGroups, visibleMasterMatches],
  );
  const currentPlayerMasterMatches = useMemo(
    () =>
      masterMatches.filter(match => loggedInPlayerId === match.player1Id || loggedInPlayerId === match.player2Id),
    [masterMatches, loggedInPlayerId],
  );
  const resultModalMatch = resultModal
    ? rankingData.matches.find(match => match.id === resultModal.matchId) ?? null
    : null;

  const resetRankingFilters = () => {
    setRankingSearchInput('');
    setRankingSearch('');
    setRankingRangeMin(0);
    setRankingRangeMax(null);
    setFilterAvailDays([]);
    setFilterAvailPeriods([]);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="bg-secondary rounded-xl shadow-lg p-4 sm:p-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-accent">{title ?? SUMMER_RANKING_NAME}</h2>
            <p className="text-text-secondary mt-1">
              {description ?? 'Classifica, partite, regolamento e disponibilità per questo evento.'}
            </p>
          </div>
          <div className="text-sm text-text-secondary">
            {confirmedPlayers.length} giocatori nel ranking • {rankingData.matches.length} partite registrate
          </div>
        </div>

        <nav className="mt-4 sm:mt-6 bg-primary/60 rounded-lg p-2 sm:p-3 flex flex-wrap gap-1.5 sm:gap-2" aria-label="Menu Summer Ranking Next">
          {([
            ['ranking', 'Ranking'],
            ['matches', 'Partite'],
            ['master', 'Master finale'],
            ['availability', 'Disponibilità'],
            ['rules', 'Regolamento'],
            ...(isOrganizer ? [['settings', 'Impostazioni'] as [RankingTab, string]] : []),
            ['players', 'Giocatori'],
          ] as Array<[RankingTab, string]>).map(([tab, label]) => (
            <button
              key={tab}
              className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-colors ${activeTab === tab ? 'bg-accent text-white' : 'bg-tertiary hover:bg-tertiary/90 text-text-primary'}`}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'ranking' && (
        <div className="space-y-4 sm:space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <div className="bg-secondary rounded-xl p-5 shadow-lg">
              <div className="text-sm text-text-secondary">Leader attuale</div>
              <div className="text-xl font-bold mt-2">{ranking[0]?.player.name ?? 'Nessuno'}</div>
              <div className="text-accent font-semibold mt-1">{ranking[0]?.points ?? 0} pt</div>
            </div>
            <div className="bg-secondary rounded-xl p-5 shadow-lg">
              <div className="text-sm text-text-secondary">Master finale</div>
              <div className="text-xl font-bold mt-2">{topEightQualified.length}/{effectiveConfig.masterSize} qualificati</div>
              <div className="text-text-secondary mt-1">Di default seguono sempre i primi {effectiveConfig.masterSize} della classifica.</div>
            </div>
            <div className="bg-secondary rounded-xl p-5 shadow-lg">
              <div className="text-sm text-text-secondary">Partite in programma</div>
              <div className="text-xl font-bold mt-2">{rankingData.matches.filter(match => match.status === 'scheduled').length}</div>
              <div className="text-text-secondary mt-1">Prenotazioni attive nel calendario ranking.</div>
            </div>
          </div>

          <div className="flex justify-end">
            <a
              href={CIRCOLO_WHATSAPP_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
            >
              <WhatsAppIcon className="w-5 h-5" />
              Contatta circolo
            </a>
          </div>


          <div className="bg-secondary rounded-xl shadow-lg p-5 space-y-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-bold text-accent">Ricerca e filtri ranking</h3>
              <p className="text-sm text-text-secondary">
                Cerca giocatori per nome, filtra per punti e disponibilità.
              </p>
            </div>

            {/* Row 1: Name search with OK button */}
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label htmlFor="ranking-search" className="block text-xs font-semibold text-text-secondary mb-1">
                  Cerca giocatore
                </label>
                <input
                  id="ranking-search"
                  type="search"
                  value={rankingSearchInput}
                  onChange={event => setRankingSearchInput(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') setRankingSearch(rankingSearchInput); }}
                  placeholder="Nome o ID giocatore"
                  className="w-full bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary"
                />
              </div>
              <button
                onClick={() => setRankingSearch(rankingSearchInput)}
                className="px-4 py-2 rounded-lg bg-accent text-primary font-semibold text-sm whitespace-nowrap"
              >
                OK
              </button>
            </div>

            {/* Row 2: Points dual range slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-text-secondary">Punti classifica</label>
                <span className="text-xs font-semibold text-accent">
                  {rankingRangeMin} – {effectiveRangeMax}
                  {maxPossiblePoints > 0 && (
                    <span className="text-text-secondary font-normal ml-1">/ {maxPossiblePoints}</span>
                  )}
                </span>
              </div>
              <div className="relative h-8 flex items-center px-1">
                {/* Base track */}
                <div className="absolute left-1 right-1 h-1 bg-tertiary rounded" />
                {/* Active range highlight */}
                <div
                  className="absolute h-1 bg-accent rounded"
                  style={{
                    left: `calc(${maxPossiblePoints > 0 ? (rankingRangeMin / maxPossiblePoints) * 100 : 0}% + 4px)`,
                    right: `calc(${maxPossiblePoints > 0 ? ((maxPossiblePoints - effectiveRangeMax) / maxPossiblePoints) * 100 : 0}% + 4px)`,
                  }}
                />
                {/* Min thumb */}
                <input
                  type="range"
                  className="dual-range"
                  min={0}
                  max={maxPossiblePoints}
                  value={rankingRangeMin}
                  onChange={event => setRankingRangeMin(Math.min(Number(event.target.value), effectiveRangeMax))}
                />
                {/* Max thumb */}
                <input
                  type="range"
                  className="dual-range"
                  min={0}
                  max={maxPossiblePoints}
                  value={effectiveRangeMax}
                  onChange={event => setRankingRangeMax(Math.max(Number(event.target.value), rankingRangeMin))}
                />
              </div>
            </div>

            {/* Row 3: Day filter */}
            <div>
              <div className="text-xs font-semibold text-text-secondary mb-2">Giorni disponibili</div>
              <div className="flex flex-wrap gap-2">
                {AVAILABILITY_DAYS.map(day => (
                  <button
                    key={day.value}
                    onClick={() => setFilterAvailDays(prev => toggleArrayValue(prev, day.value))}
                    className={`px-3 py-1 rounded-lg border text-xs font-semibold ${
                      filterAvailDays.includes(day.value)
                        ? 'bg-highlight text-white border-highlight'
                        : 'bg-primary border-tertiary text-text-primary'
                    }`}
                  >
                    {day.shortLabel}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 4: Period filter */}
            <div>
              <div className="text-xs font-semibold text-text-secondary mb-2">Fasce orarie</div>
              <div className="flex flex-wrap gap-2">
                {AVAILABILITY_PERIODS.map(period => (
                  <button
                    key={period.value}
                    onClick={() => setFilterAvailPeriods(prev => toggleArrayValue(prev, period.value))}
                    className={`px-3 py-1 rounded-lg border text-xs font-semibold ${
                      filterAvailPeriods.includes(period.value)
                        ? 'bg-highlight text-white border-highlight'
                        : 'bg-primary border-tertiary text-text-primary'
                    }`}
                  >
                    {period.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-text-secondary">
                {filteredRanking.length} risultati su {ranking.length}
              </div>
              <button
                onClick={resetRankingFilters}
                disabled={!hasActiveRankingFilters}
                className="px-3 py-2 rounded bg-tertiary hover:bg-tertiary/90 disabled:opacity-50 disabled:cursor-not-allowed text-text-primary text-xs font-semibold"
              >
                Reset filtri
              </button>
            </div>
          </div>

          {currentPlayerRankingEntry && !currentPlayerVisibleInFilteredRanking && (
            <div className="bg-accent/15 border border-accent/50 rounded-xl p-4">
              <div className="text-xs font-semibold text-accent uppercase tracking-wide">La tua posizione reale</div>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                <span className="font-bold text-lg text-accent">#{currentPlayerRankingEntry.rank}</span>
                <span className="font-semibold">{currentPlayerRankingEntry.player.name}</span>
                <span className="text-text-secondary">{currentPlayerRankingEntry.points} pt</span>
              </div>
              <p className="text-xs text-text-secondary mt-1">
                Non è visibile con i filtri attivi, ma questa è la tua posizione in classifica completa.
              </p>
            </div>
          )}

          <div className="bg-secondary rounded-xl shadow-lg p-4 sm:p-6">
            {showChallengePointsColumn && (
              <div className="flex flex-wrap items-center gap-3 mb-4 text-xs text-text-secondary">
                <span className="font-semibold">Fascia avversario:</span>
                <span className="flex items-center gap-1.5">
                  <span className={`inline-block h-3 w-3 rounded-sm ${OPPONENT_BAND_STYLES.low.legend}`} />
                  Pari livello (0–{effectiveConfig.diffBandLowMax} pt di differenza)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className={`inline-block h-3 w-3 rounded-sm ${OPPONENT_BAND_STYLES.medium.legend}`} />
                  Medio livello ({effectiveConfig.diffBandLowMax + 1}–{effectiveConfig.diffBandMediumMax} pt di differenza)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className={`inline-block h-3 w-3 rounded-sm ${OPPONENT_BAND_STYLES.high.legend}`} />
                  Alto livello ({effectiveConfig.diffBandMediumMax + 1}+ pt di differenza)
                </span>
              </div>
            )}

            {/* ── Mobile card view (hidden on sm+) ── */}
            <div className="sm:hidden space-y-3">
              {filteredRanking.length === 0 ? (
                <div className="py-8 text-center text-text-secondary">
                  {hasActiveRankingFilters
                    ? 'Nessun giocatore corrisponde ai filtri selezionati.'
                    : 'Nessun giocatore confermato nel Summer Ranking Next.'}
                </div>
              ) : filteredRanking.map(entry => {
                const isCurrentPlayerRow = entry.player.id === loggedInPlayerId;
                const availabilitySummary = getAvailabilitySummary(rankingData.availabilities?.[entry.player.id]);
                const pointsToWin = currentPlayerRankingEntry && !isCurrentPlayerRow
                  ? getSummerRankingWinPoints(currentPlayerRankingEntry.points, entry.points, effectiveConfig)
                  : 0;
                const pointsToLose = currentPlayerRankingEntry && !isCurrentPlayerRow
                  ? getSummerRankingLossPoints(currentPlayerRankingEntry.points, entry.points, effectiveConfig)
                  : 0;
                const opponentBand = (currentPlayerRankingEntry && !isCurrentPlayerRow)
                  ? getSummerRankingDiffBand(Math.abs(currentPlayerRankingEntry.points - entry.points), effectiveConfig)
                  : null;
                const headToHeadCount = (!isCurrentPlayerRow && loggedInPlayerId)
                  ? getHeadToHeadCount(rankingData.matches, loggedInPlayerId, entry.player.id)
                  : 0;
                const remainingHeadToHead = Math.max(0, effectiveConfig.headToHeadLimit - headToHeadCount);

                return (
                  <div
                    key={entry.player.id}
                    ref={node => { if (isCurrentPlayerRow) currentPlayerMobileRowRef.current = node; }}
                    className={`rounded-xl border p-4 ${
                      isCurrentPlayerRow
                        ? 'bg-accent/20 border-l-4 border-accent/70'
                        : opponentBand
                          ? getOpponentBandRowClass(opponentBand)
                          : 'bg-primary/40 border-tertiary/40'
                    }`}
                    style={isCurrentPlayerRow ? { scrollMarginTop: SUMMER_RANKING_ROW_SCROLL_MARGIN } : undefined}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0">
                        <img
                          src={entry.player.avatar}
                          alt={entry.player.name}
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0 mt-0.5"
                        />
                        <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xl font-bold text-accent">#{entry.rank}</span>
                          <button
                            type="button"
                            onClick={() => setSelectedPlayerId(entry.player.id)}
                            className="font-semibold text-text-primary hover:underline text-left"
                            title={`Apri il profilo di ${entry.player.name}`}
                          >
                            {entry.player.name}
                          </button>
                          {isCurrentPlayerRow && (
                            <span className="px-2 py-0.5 rounded bg-accent text-white text-xs font-semibold">Tu</span>
                          )}
                          {masterQualifiedIdSet.has(entry.player.id) && (
                            <span className="px-2 py-0.5 rounded bg-green-600 text-white text-xs font-semibold">Master</span>
                          )}
                        </div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="text-2xl font-bold">{entry.points}</span>
                          <span className="text-sm text-text-secondary">pt</span>
                          <span className="text-xs text-text-secondary">· base: {entry.startingPoints}</span>
                        </div>
                        {isOrganizer && (
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              type="number"
                              value={startPointsDrafts[entry.player.id] ?? '0'}
                              onChange={event => setStartPointsDrafts(prev => ({ ...prev, [entry.player.id]: event.target.value }))}
                              className="w-20 bg-primary border border-tertiary rounded px-2 py-1 text-text-primary text-xs"
                            />
                            <button
                              onClick={() => requestStartPointsSave(entry.player.id)}
                              disabled={busyPlayerId === entry.player.id}
                              className="px-2 py-1 rounded bg-highlight text-white text-xs font-semibold"
                            >
                              {busyPlayerId === entry.player.id ? 'Salvo...' : 'Salva'}
                            </button>
                          </div>
                        )}
                      </div>
                      </div>
                      <div className="text-right shrink-0 text-xs text-text-secondary space-y-1">
                        <div className="font-semibold text-text-primary">{entry.wins}V {entry.draws}N {entry.losses}P</div>
                        <div className="font-mono">{entry.recentForm.length > 0 ? entry.recentForm.join(' ') : '—'}</div>
                        <div className={`font-semibold ${
                          availabilitySummary.status === 'Disponibile' ? 'text-green-400' :
                          availabilitySummary.status === 'Non disponibile' ? 'text-red-400' :
                          'text-text-secondary'
                        }`}>
                          {availabilitySummary.status}
                        </div>
                      </div>
                    </div>

                    {showChallengePointsColumn && !isCurrentPlayerRow && (
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="inline-flex items-center rounded-md border border-green-400/40 bg-green-500/15 px-2 py-0.5 font-bold text-green-400">
                          +{pointsToWin} pt vittoria
                        </span>
                        <span className="inline-flex items-center rounded-md border border-red-400/40 bg-red-500/15 px-2 py-0.5 font-bold text-red-400">
                          {pointsToLose} pt sconfitta
                        </span>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => onPlayerContact(entry.player)}
                        className="px-3 py-1.5 rounded bg-tertiary hover:bg-tertiary/90 text-text-primary text-xs font-semibold"
                      >
                        Contatta
                      </button>
                      {!isCurrentPlayerRow && (isOrganizer || (currentPlayer && loggedInPlayerId)) && (
                        <>
                          {!isOrganizer && (
                            <span className="text-xs text-text-secondary self-center">
                              {headToHeadCount}/{effectiveConfig.headToHeadLimit} scontri
                            </span>
                          )}
                          {(isOrganizer || remainingHeadToHead > 0) ? (
                            <button
                              onClick={() => openChallengeModal(entry.player.id, entry.player.name)}
                              className="px-3 py-1.5 rounded bg-accent hover:bg-accent/80 text-white text-xs font-semibold"
                            >
                              Crea partita
                            </button>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-xs font-semibold border border-red-500/30">
                              Limite raggiunto
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Desktop table (hidden on mobile) ── */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full min-w-[1120px] text-sm">
                <thead>
                  <tr className="text-left border-b border-tertiary text-text-secondary">
                    <th className="py-3 pr-3">Rank</th>
                    <th className="py-3 pr-3">Giocatore</th>
                    <th className="py-3 pr-3">Punti</th>
                    {showChallengePointsColumn && <th className="py-3 pr-3">Punti sfida (base)</th>}
                    <th className="py-3 pr-3">Serie</th>
                    <th className="py-3 pr-3">Partite</th>
                    <th className="py-3 pr-3">Bonus/Malus</th>
                    <th className="py-3 pr-3">Slot</th>
                    <th className="py-3 pr-3">Disponibilità</th>
                    <th className="py-3 pr-3">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRanking.map(entry => {
                    const availabilitySummary = getAvailabilitySummary(rankingData.availabilities?.[entry.player.id]);
                    const isCurrentPlayerRow = entry.player.id === loggedInPlayerId;
                    const pointsToWin = currentPlayerRankingEntry
                      ? getSummerRankingWinPoints(currentPlayerRankingEntry.points, entry.points, effectiveConfig)
                      : 0;
                    const pointsToLose = currentPlayerRankingEntry
                      ? getSummerRankingLossPoints(currentPlayerRankingEntry.points, entry.points, effectiveConfig)
                      : 0;
                    const opponentBand = (currentPlayerRankingEntry && !isCurrentPlayerRow)
                      ? getSummerRankingDiffBand(Math.abs(currentPlayerRankingEntry.points - entry.points), effectiveConfig)
                      : null;
                    const headToHeadCount = (!isCurrentPlayerRow && loggedInPlayerId)
                      ? getHeadToHeadCount(rankingData.matches, loggedInPlayerId, entry.player.id)
                      : 0;
                    const remainingHeadToHead = Math.max(0, effectiveConfig.headToHeadLimit - headToHeadCount);
                    const playerLastMatch = rankingData.matches
                      .filter(m =>
                        m.status === 'completed' &&
                        m.score1 !== null &&
                        m.score2 !== null &&
                        (m.player1Id === entry.player.id || m.player2Id === entry.player.id),
                      )
                      .reduce<Match | null>((latest, m) => {
                        if (!latest) return m;
                        return new Date(m.completedAt ?? 0) > new Date(latest.completedAt ?? 0) ? m : latest;
                      }, null);
                    const playerLastMatchBreakdown = playerLastMatch ? matchBreakdowns.get(playerLastMatch.id) : null;
                    const playerLastMatchPlayerBd = playerLastMatchBreakdown
                      ? (playerLastMatch!.player1Id === entry.player.id
                        ? playerLastMatchBreakdown.player1
                        : playerLastMatchBreakdown.player2)
                      : null;

                    return (
                    <tr
                      key={entry.player.id}
                      ref={node => {
                        if (isCurrentPlayerRow) currentPlayerDesktopRowRef.current = node;
                      }}
                      className={`border-b border-tertiary/40 last:border-b-0 align-top transition-colors ${isCurrentPlayerRow ? 'bg-accent/20 ring-2 ring-inset ring-accent/70 border-l-4 border-accent' : opponentBand ? getOpponentBandRowClass(opponentBand) : ''}`}
                      style={isCurrentPlayerRow ? { scrollMarginTop: SUMMER_RANKING_ROW_SCROLL_MARGIN } : undefined}
                    >
                      <td className="py-4 pr-3 font-bold text-accent">{entry.rank}</td>
                      <td className="py-4 pr-3">
                        <div className="font-semibold flex items-center gap-2">
                          <img
                            src={entry.player.avatar}
                            alt={entry.player.name}
                            className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                          />
                          <button
                            type="button"
                            onClick={() => setSelectedPlayerId(entry.player.id)}
                            className="text-left hover:underline"
                            title={`Apri il profilo di ${entry.player.name}`}
                          >
                            {entry.player.name}
                          </button>
                          {isCurrentPlayerRow && (
                            <span className="px-2 py-0.5 rounded bg-accent text-white text-xs font-semibold">
                              Tu
                            </span>
                          )}
                          {masterQualifiedIdSet.has(entry.player.id) && (
                            <span
                              className="px-2 py-0.5 rounded bg-green-600 text-white text-xs font-semibold"
                              title="Giocatore qualificato al Master finale"
                            >
                              Qualificato Master
                            </span>
                          )}

                        </div>
                        <div className="text-xs text-text-secondary mt-1">
                          Base {entry.startingPoints} pt
                          {isOrganizer && (
                            <span className="ml-2 inline-flex items-center gap-2">
                              <input
                                type="number"
                                value={startPointsDrafts[entry.player.id] ?? '0'}
                                onChange={event => setStartPointsDrafts(prev => ({ ...prev, [entry.player.id]: event.target.value }))}
                                className="w-20 bg-primary border border-tertiary rounded px-2 py-1 text-text-primary"
                              />
                              <button
                                onClick={() => requestStartPointsSave(entry.player.id)}
                                disabled={busyPlayerId === entry.player.id}
                                className="px-2 py-1 rounded bg-highlight text-white text-xs font-semibold"
                              >
                                {busyPlayerId === entry.player.id ? 'Salvo...' : 'Salva'}
                              </button>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 pr-3">
                        <div className="font-bold text-lg">{entry.points}</div>
                        <div className="flex items-center gap-1 text-xs mt-1">
                          {entry.trend === 'up' && <ArrowUpIcon className="w-4 h-4 text-green-400" />}
                          {entry.trend === 'down' && <ArrowDownIcon className="w-4 h-4 text-red-400" />}
                          {entry.trend === 'steady' && <span className="text-text-secondary">•</span>}
                          <span className="text-text-secondary">trend recente</span>
                        </div>
                      </td>
                      {showChallengePointsColumn && (
                        <td className="py-4 pr-3">
                          {isCurrentPlayerRow ? (
                            <span className="inline-flex items-center rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs font-semibold text-accent">
                              Tu
                            </span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex items-center rounded-md border border-green-400/40 bg-green-500/15 px-2 py-0.5 text-xs font-bold text-green-400">
                                +{pointsToWin} pt
                              </span>
                              <span className="inline-flex items-center rounded-md border border-red-400/40 bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-400">
                                {pointsToLose} pt
                              </span>
                            </div>
                          )}
                        </td>
                      )}
                      <td className="py-4 pr-3 font-mono text-xs tracking-wide">
                        {entry.recentForm.length > 0 ? entry.recentForm.join(' ') : '—'}
                      </td>
                      <td className="py-4 pr-3">
                        <div>{entry.matchesPlayed} giocate</div>
                        <div className="text-xs text-text-secondary mt-1">
                          {entry.wins}V • {entry.draws}N • {entry.losses}P
                        </div>
                      </td>
                      <td className="py-4 pr-3 text-xs text-text-secondary">
                        {playerLastMatchPlayerBd ? (
                          <div className="space-y-0.5">
                            <div>Risultato ({getMatchOutcomeLabel(playerLastMatchPlayerBd.outcome)}): {formatSignedPoints(playerLastMatchPlayerBd.resultPoints)}</div>
                            <div>Game fatti: {playerLastMatchPlayerBd.gameFatti} ({formatSignedPoints(playerLastMatchPlayerBd.gameFattiPoints)})</div>
                            {playerLastMatchPlayerBd.gameDiffPoints !== 0 && (
                              <div>Bonus diff: {formatSignedPoints(playerLastMatchPlayerBd.gameDiffPoints)}</div>
                            )}
                            {playerLastMatchPlayerBd.participationPoints !== 0 && (
                              <div>Partecipazione: {formatSignedPoints(playerLastMatchPlayerBd.participationPoints)}</div>
                            )}
                            {playerLastMatchPlayerBd.rulesAdjustmentPoints !== 0 && (
                              <div>Adeguamento: {formatSignedPoints(playerLastMatchPlayerBd.rulesAdjustmentPoints)}</div>
                            )}
                            <div className="border-t border-tertiary/50 pt-0.5 font-semibold text-text-primary">
                              Totale: {formatSignedPoints(playerLastMatchPlayerBd.totalPoints)}
                            </div>
                          </div>
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                      <td className="py-4 pr-3 text-xs text-text-secondary">
                        <div>{entry.upcomingMatches} prenotazioni attive</div>
                        <div className="mt-1">{entry.lastMatchAt ? `Ultima: ${formatDateTime(entry.lastMatchAt)}` : 'Nessuna partita'}</div>
                      </td>
                      <td className="py-4 pr-3 text-xs text-text-secondary">
                        <div className={`font-semibold ${
                          availabilitySummary.status === 'Disponibile' ? 'text-green-400' :
                          availabilitySummary.status === 'Non disponibile' ? 'text-red-400' :
                          'text-text-secondary'
                        }`}>
                          {availabilitySummary.status}
                        </div>
                        {availabilitySummary.details && (
                          <div className="mt-1 leading-relaxed">
                            {availabilitySummary.details}
                          </div>
                        )}
                      </td>
                      <td className="py-4 pr-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => onPlayerContact(entry.player)}
                            className="px-3 py-1 rounded bg-tertiary hover:bg-tertiary/90 text-text-primary text-xs font-semibold"
                          >
                            Contatta
                          </button>
                          {!isCurrentPlayerRow && (isOrganizer || (currentPlayer && loggedInPlayerId)) && (
                            <div className="flex flex-col gap-1">
                              {!isOrganizer && (
                                <span className="text-xs text-text-secondary">
                                  Scontri: {headToHeadCount}/{effectiveConfig.headToHeadLimit}
                                  {remainingHeadToHead > 0 ? ` · Restano: ${remainingHeadToHead}` : ''}
                                </span>
                              )}
                              {(isOrganizer || remainingHeadToHead > 0) ? (
                                <button
                                  onClick={() => openChallengeModal(entry.player.id, entry.player.name)}
                                  className="px-3 py-1 rounded bg-accent hover:bg-accent/80 text-white text-xs font-semibold"
                                  title={`Crea partita con ${entry.player.name}`}
                                >
                                  Crea partita
                                </button>
                              ) : (
                                <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-xs font-semibold border border-red-500/30">
                                  Limite raggiunto
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {filteredRanking.length === 0 && (
                    <tr>
                      <td colSpan={showChallengePointsColumn ? 10 : 9} className="py-8 text-center text-text-secondary">
                        {hasActiveRankingFilters
                          ? 'Nessun giocatore corrisponde ai filtri selezionati.'
                          : 'Nessun giocatore confermato nel Summer Ranking Next.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'players' && (
        <div className="bg-secondary rounded-xl shadow-lg p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="text-xl font-bold text-accent">Partecipanti ranking ({confirmedPlayers.length})</h3>
            {isOrganizer && onOpenPlayersAdmin && (
              <button
                onClick={onOpenPlayersAdmin}
                className="px-3 py-2 rounded bg-tertiary text-text-primary text-xs font-semibold"
              >
                {playersAdminLabel ?? 'Apri gestione giocatori evento'}
              </button>
            )}
          </div>

          {/* ── Mobile card view ── */}
          <div className="sm:hidden space-y-3">
            {confirmedPlayers.length === 0 ? (
              <div className="py-8 text-center text-text-secondary">Nessun partecipante nel ranking.</div>
            ) : confirmedPlayers.map(player => {
              const rankingEntry = rankingById.get(player.id);
              const hasPhone = !!player.phone?.trim();
              return (
                <div key={player.id} className="flex items-center justify-between gap-3 rounded-xl border border-tertiary/40 bg-primary/40 p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <img src={player.avatar} alt={player.name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                    <div>
                    <button
                      type="button"
                      onClick={() => setSelectedPlayerId(player.id)}
                      className="font-semibold text-text-primary hover:underline text-left"
                    >
                      {player.name}
                    </button>
                    <div className="text-xs text-text-secondary mt-1">
                      {isOrganizer ? (
                        <>Inizio: {rankingEntry?.startingPoints ?? player.summerRankingStartPoints ?? 0} pt · Tel: {player.phone || '—'}</>
                      ) : (
                        <>Inizio: {rankingEntry?.startingPoints ?? player.summerRankingStartPoints ?? 0} pt · Attuale: {rankingEntry?.points ?? rankingEntry?.startingPoints ?? player.summerRankingStartPoints ?? 0} pt</>
                      )}
                    </div>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {isOrganizer ? (
                      <button
                        onClick={() => handleRemoveParticipant(player.id)}
                        className="px-3 py-1.5 rounded bg-red-600 text-white text-xs font-semibold"
                      >
                        Rimuovi
                      </button>
                    ) : (
                      <button
                        onClick={() => onPlayerContact(player)}
                        disabled={!hasPhone}
                        title={hasPhone ? `Contatta ${player.name}` : 'Numero non disponibile'}
                        className="px-3 py-1.5 rounded bg-tertiary hover:bg-tertiary/90 text-text-primary text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Contatta
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Desktop table ── */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="text-left border-b border-tertiary text-text-secondary">
                  <th className="py-3 pr-3">Giocatore</th>
                  <th className="py-3 pr-3">Punti iniziali</th>
                  {isOrganizer ? (
                    <>
                      <th className="py-3 pr-3">Telefono</th>
                      <th className="py-3 pr-3">Azioni</th>
                    </>
                  ) : (
                    <>
                      <th className="py-3 pr-3">Punti attuali</th>
                      <th className="py-3 pr-3">Azioni</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {confirmedPlayers.map(player => {
                  const rankingEntry = rankingById.get(player.id);
                  const hasPhone = !!player.phone?.trim();

                  return (
                    <tr key={player.id} className="border-b border-tertiary/40 last:border-b-0">
                      <td className="py-3 pr-3 font-semibold">
                        <div className="flex items-center gap-2">
                          <img src={player.avatar} alt={player.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                          <button
                            type="button"
                            onClick={() => setSelectedPlayerId(player.id)}
                            className="text-left hover:underline"
                            title={`Apri il profilo di ${player.name}`}
                          >
                            {player.name}
                          </button>
                        </div>
                      </td>
                      <td className="py-3 pr-3 text-text-secondary">{rankingEntry?.startingPoints ?? player.summerRankingStartPoints ?? 0}</td>
                      {isOrganizer ? (
                        <>
                          <td className="py-3 pr-3 text-text-secondary">{player.phone || '—'}</td>
                          <td className="py-3 pr-3">
                            <button
                              onClick={() => handleRemoveParticipant(player.id)}
                              className="px-3 py-1 rounded bg-red-600 text-white text-xs font-semibold"
                            >
                              Rimuovi dal ranking
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-3 pr-3 font-bold text-text-primary">{rankingEntry?.points ?? rankingEntry?.startingPoints ?? player.summerRankingStartPoints ?? 0}</td>
                          <td className="py-3 pr-3">
                            <button
                              onClick={() => onPlayerContact(player)}
                              disabled={!hasPhone}
                              title={hasPhone ? `Contatta ${player.name}` : 'Numero non disponibile'}
                              className="px-3 py-1 rounded bg-tertiary hover:bg-tertiary/90 text-text-primary text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Contatta
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
                {confirmedPlayers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-text-secondary">
                      Nessun partecipante nel ranking.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'matches' && (
        <>
          <div className="bg-secondary rounded-xl shadow-lg p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setMatchesSubTab('booked')}
                  className={`px-3 py-1 text-sm font-semibold rounded-full transition-colors ${matchesSubTab === 'booked' ? 'bg-accent text-white' : 'bg-tertiary hover:bg-tertiary/90 text-text-primary'}`}
                >
                  Partite prenotate
                </button>
                {!isOrganizer && (
                  <button
                    onClick={() => setMatchesSubTab('completed_mine')}
                    className={`px-3 py-1 text-sm font-semibold rounded-full transition-colors ${matchesSubTab === 'completed_mine' ? 'bg-accent text-white' : 'bg-tertiary hover:bg-tertiary/90 text-text-primary'}`}
                  >
                    Partite completate
                  </button>
                )}
                <button
                  onClick={() => setMatchesSubTab('all_completed')}
                  className={`px-3 py-1 text-sm font-semibold rounded-full transition-colors ${matchesSubTab === 'all_completed' ? 'bg-accent text-white' : 'bg-tertiary hover:bg-tertiary/90 text-text-primary'}`}
                >
                  {isOrganizer ? 'Tutte le partite completate' : 'Tutte le partite'}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={CIRCOLO_WHATSAPP_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded transition-colors"
                >
                  <WhatsAppIcon className="w-4 h-4" />
                  Contatta circolo
                </a>
                <button
                  onClick={() => openChallengeModal()}
                  disabled={!isOrganizer && (!canBookAsParticipant || eligibleOpponents.length === 0)}
                  title={isOrganizer ? 'Crea una nuova partita' : (!canBookAsParticipant ? 'Accedi come giocatore per creare una partita' : (eligibleOpponents.length === 0 ? 'Nessun avversario disponibile per una nuova prenotazione' : 'Crea una nuova partita'))}
                  className="px-4 py-2 rounded bg-accent hover:bg-accent/80 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Crea partita
                </button>
              </div>
            </div>

            {/* ── Shared match data computation ── */}
            {(() => {
              const isMyMatch = (match: Match) =>
                !!(loggedInPlayerId && (match.player1Id === loggedInPlayerId || match.player2Id === loggedInPlayerId));

              const visibleMatches = rankingData.matches
                .slice()
                .filter(match => {
                  if (matchesSubTab === 'booked') {
                    return match.status === 'scheduled' && (isOrganizer || isMyMatch(match));
                  }
                  if (matchesSubTab === 'completed_mine') {
                    return match.status === 'completed' && isMyMatch(match);
                  }
                  return match.status === 'completed';
                })
                .sort((a, b) => {
                  const aTime = new Date(a.completedAt ?? a.scheduledTime ?? 0).getTime();
                  const bTime = new Date(b.completedAt ?? b.scheduledTime ?? 0).getTime();
                  return bTime - aTime;
                });

              const myCompletedMatchesCount = loggedInPlayerId
                ? rankingData.matches.filter(m =>
                    m.status === 'completed' &&
                    (m.player1Id === loggedInPlayerId || m.player2Id === loggedInPlayerId)
                  ).length
                : 0;

              const emptyMessage = matchesSubTab === 'booked'
                ? 'Nessuna partita prenotata.'
                : matchesSubTab === 'completed_mine'
                  ? 'Nessuna partita completata.'
                  : 'Nessuna partita completata nel ranking.';

              /* ── Render match action buttons ── */
              const renderMatchActions = (match: Match) => {
                const matchBreakdown = matchBreakdowns.get(match.id);
                const player2 = playerMap.get(match.player2Id);
                return (
                  <div className="flex flex-wrap gap-2">
                    {matchBreakdown && (
                      <button
                        onClick={() => setSelectedMatchId(match.id)}
                        className="px-3 py-1 rounded bg-accent hover:bg-accent/80 text-white text-xs font-semibold"
                      >
                        Dettaglio punti
                      </button>
                    )}
                    {canEditMatchResult(match) && (
                      <button
                        onClick={() => openEditResult(match)}
                        className="px-3 py-1 rounded bg-tertiary hover:bg-tertiary/90 text-text-primary text-xs font-semibold"
                      >
                        {match.status === 'completed' ? 'Modifica risultato' : 'Inserisci risultato'}
                      </button>
                    )}
                    {canEditMatchResult(match) && match.status === 'completed' && (
                      <button
                        onClick={() => handleResetResult(match)}
                        className="px-3 py-1 rounded bg-primary border border-tertiary text-xs font-semibold"
                      >
                        Ripristina
                      </button>
                    )}
                    {canEditMatchResult(match) && (
                      <button
                        onClick={() => openDeleteMatchModal(match)}
                        className="px-3 py-1 rounded bg-red-600 text-white text-xs font-semibold"
                      >
                        Elimina
                      </button>
                    )}
                    {match.status === 'scheduled' && (() => {
                      const isParticipantMatch = !!(loggedInPlayerId && (match.player1Id === loggedInPlayerId || match.player2Id === loggedInPlayerId));
                      const opponentId = loggedInPlayerId === match.player1Id ? match.player2Id : match.player1Id;
                      const opponent = playerMap.get(opponentId);
                      const opponentPhone = normalizeWhatsAppPhone(opponent?.phone);
                      const reminderMessage = encodeURIComponent(
                        buildWhatsAppReminderMessage(currentPlayer?.name ?? 'il giocatore', match.scheduledTime, match.location, match.field)
                      );
                      const whatsappReminderLink = opponentPhone ? `https://wa.me/${opponentPhone}?text=${reminderMessage}` : null;
                      const reminderDisabledReason = !isParticipantMatch
                        ? 'Puoi inviare promemoria solo per le tue partite prenotate.'
                        : !opponentPhone
                          ? 'Numero WhatsApp avversario non disponibile.'
                          : '';

                      return whatsappReminderLink && isParticipantMatch ? (
                        <a
                          href={whatsappReminderLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-semibold"
                        >
                          Promemoria WhatsApp
                        </a>
                      ) : (
                        <button
                          disabled
                          title={reminderDisabledReason}
                          className="px-3 py-1 rounded bg-green-600 text-white text-xs font-semibold opacity-50 cursor-not-allowed"
                        >
                          Promemoria WhatsApp
                        </button>
                      );
                    })()}
                  </div>
                );
              };

              return (
                <>
                  {/* ── Mobile card view ── */}
                  <div className="sm:hidden space-y-3">
                    {visibleMatches.length === 0 ? (
                      <div className="py-8 text-center text-text-secondary">{emptyMessage}</div>
                    ) : visibleMatches.map(match => {
                      const player1 = playerMap.get(match.player1Id);
                      const player2 = playerMap.get(match.player2Id);
                      const matchBreakdown = matchBreakdowns.get(match.id);
                      return (
                        <div key={match.id} className="rounded-xl border border-tertiary/40 bg-primary/40 p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold text-text-primary">
                                {player1?.name ?? match.player1Id} vs {player2?.name ?? match.player2Id}
                              </div>
                              <div className="text-xs text-text-secondary mt-0.5">
                                {match.completedAt ? `Conclusa il ${formatDateTime(match.completedAt)}` : 'In attesa di risultato'}
                              </div>
                            </div>
                            <span className={`shrink-0 px-2 py-1 rounded text-xs font-semibold ${match.status === 'completed' ? 'bg-green-600 text-white' : match.status === 'scheduled' ? 'bg-accent text-white' : 'bg-tertiary text-text-primary'}`}>
                              {match.status === 'completed' ? 'Completata' : match.status === 'scheduled' ? 'Prenotata' : 'Da programmare'}
                            </span>
                          </div>
                          {(match.slotId || match.scheduledTime) && (
                            <div className="text-xs text-text-secondary">
                              {match.scheduledTime && <div>{formatDateTime(match.scheduledTime)}</div>}
                              {match.location && <div>{match.location}{match.field ? ` • ${match.field}` : ''}</div>}
                            </div>
                          )}
                          <div className="flex items-center gap-3">
                            <span className="font-semibold">
                              {match.score1 !== null && match.score2 !== null ? `${match.score1} - ${match.score2}` : '—'}
                            </span>
                            {matchBreakdown && (
                              <div className="flex flex-wrap gap-2 text-xs">
                                {([
                                  [player1?.name ?? match.player1Id, matchBreakdown.player1],
                                  [player2?.name ?? match.player2Id, matchBreakdown.player2],
                                ] as const).map(([playerName, breakdown]) => (
                                  <span
                                    key={breakdown.playerId}
                                    className={`font-semibold ${breakdown.totalPoints > 0 ? 'text-green-400' : breakdown.totalPoints < 0 ? 'text-red-400' : 'text-text-secondary'}`}
                                  >
                                    {playerName} {formatSignedPoints(breakdown.totalPoints)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          {renderMatchActions(match)}
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Desktop table ── */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full min-w-[920px] text-sm">
                      <thead>
                        <tr className="text-left border-b border-tertiary text-text-secondary">
                          <th className="py-3 pr-3">Partita</th>
                          <th className="py-3 pr-3">Stato</th>
                          <th className="py-3 pr-3">Slot</th>
                          <th className="py-3 pr-3">Risultato</th>
                          <th className="py-3 pr-3">Partite giocate</th>
                          <th className="py-3 pr-3">Azioni</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleMatches.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-text-secondary">
                              {emptyMessage}
                            </td>
                          </tr>
                        ) : visibleMatches.map(match => {
                          const player1 = playerMap.get(match.player1Id);
                          const player2 = playerMap.get(match.player2Id);
                          const matchBreakdown = matchBreakdowns.get(match.id);

                          return (
                            <tr key={match.id} className="border-b border-tertiary/40 last:border-b-0 align-top">
                              <td className="py-4 pr-3">
                                <div className="font-semibold">{player1?.name ?? match.player1Id} vs {player2?.name ?? match.player2Id}</div>
                                <div className="text-xs text-text-secondary mt-1">
                                  {match.completedAt ? `Conclusa il ${formatDateTime(match.completedAt)}` : 'In attesa di risultato'}
                                </div>
                              </td>
                              <td className="py-4 pr-3">
                                <span className={`px-2 py-1 rounded text-xs font-semibold ${match.status === 'completed' ? 'bg-green-600 text-white' : match.status === 'scheduled' ? 'bg-accent text-white' : 'bg-tertiary text-text-primary'}`}>
                                  {match.status === 'completed' ? 'Completata' : match.status === 'scheduled' ? 'Prenotata' : 'Da programmare'}
                                </span>
                              </td>
                              <td className="py-4 pr-3 text-xs text-text-secondary">
                                {match.slotId ? (
                                  <>
                                    <div>{formatDateTime(match.scheduledTime)}</div>
                                    <div>{match.location} {match.field ? `• ${match.field}` : ''}</div>
                                  </>
                                ) : match.scheduledTime ? (
                                  <>
                                    <div>{formatDateTime(match.scheduledTime)}</div>
                                    {match.location && <div>{match.location} {match.field ? `• ${match.field}` : ''}</div>}
                                    <div className="text-text-secondary italic">Prenotazione diretta</div>
                                  </>
                                ) : 'Nessuno slot'}
                              </td>
                              <td className="py-4 pr-3">
                                <span className="font-semibold">
                                  {match.score1 !== null && match.score2 !== null ? `${match.score1} - ${match.score2}` : '—'}
                                </span>
                                {matchBreakdown && (
                                  <div className="mt-1 space-y-0.5 text-xs">
                                    {([
                                      [player1?.name ?? match.player1Id, matchBreakdown.player1],
                                      [player2?.name ?? match.player2Id, matchBreakdown.player2],
                                    ] as const).map(([playerName, breakdown]) => (
                                      <div
                                        key={breakdown.playerId}
                                        className={`font-semibold ${
                                          breakdown.totalPoints > 0
                                            ? 'text-green-400'
                                            : breakdown.totalPoints < 0
                                              ? 'text-red-400'
                                              : 'text-text-secondary'
                                        }`}
                                      >
                                        {playerName} {formatSignedPoints(breakdown.totalPoints)}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="py-4 pr-3 text-xs text-text-secondary">
                                {myCompletedMatchesCount}
                              </td>
                              <td className="py-4 pr-3">
                                {renderMatchActions(match)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>
          {matchActionError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {matchActionError}
            </div>
          )}
        </>
      )}

      {activeTab === 'master' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-secondary rounded-xl p-5 shadow-lg">
              <div className="text-sm text-text-secondary">Qualificati automatici</div>
              <div className="text-xl font-bold mt-2">{autoQualifiedPlayerIds.length}/{effectiveConfig.masterSize}</div>
              <div className="text-text-secondary mt-1">Top {effectiveConfig.masterSize} della classifica, aggiornati in tempo reale.</div>
            </div>
            <div className="bg-secondary rounded-xl p-5 shadow-lg">
              <div className="text-sm text-text-secondary">Selezione attuale</div>
              <div className="text-xl font-bold mt-2">{currentMasterQualifiedPlayerIds.length}/{effectiveConfig.masterSize}</div>
              <div className="text-text-secondary mt-1">
                {rankingData.master?.manualQualifiedPlayerIds?.length === effectiveConfig.masterSize
                  ? 'Override manuale salvato.'
                  : 'Basata sui qualificati automatici.'}
              </div>
            </div>
            <div className="bg-secondary rounded-xl p-5 shadow-lg">
              <div className="text-sm text-text-secondary">Le tue partite Master</div>
              <div className="text-xl font-bold mt-2">{currentPlayerMasterMatches.length}</div>
              <div className="text-text-secondary mt-1">
                {currentPlayer ? 'Puoi prenotare e pubblicare risultati solo delle tue partite.' : 'Accedi come giocatore per gestire le tue partite.'}
              </div>
            </div>
          </div>

          {isOrganizer && (
            <div className="bg-secondary rounded-xl shadow-lg p-6 space-y-5">
              <div>
                <h3 className="text-xl font-bold text-accent">Configurazione Master finale</h3>
                <p className="text-sm text-text-secondary mt-1">
                  I primi {effectiveConfig.masterSize} vengono proposti automaticamente, ma puoi sostituirli manualmente in caso di assenza o infortunio.
                </p>
              </div>

              <div className="bg-primary rounded-lg border border-tertiary p-4">
                <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Formato Master finale</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {([
                    ['bracket', 'Tabellone'],
                    ['groups', 'Gironi'],
                  ] as Array<[SummerRankingMasterFormat, string]>).map(([format, label]) => (
                    <button
                      key={format}
                      onClick={() => setMasterFormatDraft(format)}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold ${masterFormatDraft === format ? 'bg-accent text-white' : 'bg-secondary border border-tertiary text-text-primary'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Array.from({ length: effectiveConfig.masterSize }).map((_, index) => {
                  const selectedId = masterQualifiedDraft[index] ?? '';
                  return (
                    <div key={index} className="bg-primary rounded-lg border border-tertiary p-4">
                      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Testa di serie {index + 1}</div>
                      <div className="mt-1 text-[11px] font-semibold text-accent">Modificabile manualmente</div>
                      <select
                        value={selectedId}
                        onChange={event => {
                          const nextPlayerId = event.target.value;
                          setMasterQualifiedDraft(previous => {
                            const nextDraft = [...previous];
                            const duplicateIndex = nextDraft.findIndex((playerId, playerIndex) => playerId === nextPlayerId && playerIndex !== index);
                            if (duplicateIndex !== -1) {
                              nextDraft[duplicateIndex] = '';
                            }
                            nextDraft[index] = nextPlayerId;
                            return nextDraft;
                          });
                        }}
                        className="mt-2 w-full bg-secondary border border-tertiary rounded-lg p-2"
                      >
                        <option value="">Seleziona giocatore</option>
                        {masterCandidatePlayers.map(player => {
                          const entry = rankingById.get(player.id);
                          return (
                            <option key={player.id} value={player.id}>
                              #{entry?.rank ?? '-'} • {player.name} {entry ? `• ${entry.points} pt` : ''}
                            </option>
                          );
                        })}
                      </select>
                      <div className="text-xs text-text-secondary mt-2">
                        Automatico: {playerMap.get(autoQualifiedPlayerIds[index] ?? '')?.name ?? '—'}
                      </div>
                    </div>
                  );
                })}
              </div>

              {!hasValidMasterDraft && (
                <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-200">
                  Per salvare o generare il Master servono {effectiveConfig.masterSize} giocatori univoci e validi.
                </div>
              )}

              {masterNeedsRegeneration && (
                <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-4 text-sm text-orange-200">
                  I qualificati o il formato selezionato non coincidono più con il Master generato: rigenera il Master per evitare dati incoerenti.
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => persistMasterQualifiedPlayers(masterQualifiedDraft)}
                  disabled={!hasValidMasterDraft}
                  className="px-4 py-2 rounded bg-highlight text-white font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Salva qualificati
                </button>
                <button
                  onClick={() => setMasterQualifiedDraft(autoQualifiedPlayerIds)}
                  className="px-4 py-2 rounded bg-tertiary text-text-primary font-semibold"
                >
                  Ripristina top {effectiveConfig.masterSize}
                </button>
                <button
                  onClick={handleGenerateMaster}
                  disabled={!hasValidMasterDraft || effectiveConfig.masterSize < 2}
                  className="px-4 py-2 rounded bg-accent text-white font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isMasterGenerated ? 'Rigenera Master' : 'Genera Master'}
                </button>
                {isMasterGenerated && (
                  <button
                    onClick={handleResetMaster}
                    className="px-4 py-2 rounded bg-red-600 text-white font-semibold hover:bg-red-700"
                  >
                    {masterFormat === 'bracket' ? 'Annulla tabellone' : 'Annulla gironi'}
                  </button>
                )}
              </div>
            </div>
          )}

          {!isMasterGenerated && (
            <div className="bg-secondary rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-bold text-accent">Master non ancora generato</h3>
              <p className="text-text-secondary mt-2">
                {masterFormatDraft === 'groups'
                  ? 'Una volta confermati i qualificati, genera due gironi del Master finale con partite automatiche.'
                  : effectiveConfig.masterSize <= 2
                    ? 'Con almeno Top 2 puoi generare il Master con la sola finale.'
                    : effectiveConfig.masterSize <= 4
                      ? 'Con Top 4 il Master genera direttamente semifinali e finale.'
                      : 'Una volta confermati i qualificati, genera il tabellone per ottenere quarti, semifinali, finale e finale 3°/4° posto.'}
              </p>
            </div>
          )}

          {isMasterGenerated && (
            <>
              {masterFormat === 'bracket' && (
                <div className="bg-secondary rounded-xl shadow-lg p-6">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-xl font-bold text-accent">Tabellone Master finale</h3>
                      <p className="text-sm text-text-secondary mt-1">
                        {effectiveConfig.masterSize <= 2
                          ? 'Finale diretta tra i due qualificati.'
                          : effectiveConfig.masterSize <= 4
                            ? 'Semifinali con accoppiamenti standard (1vs4 e 2vs3) e finale.'
                            : 'Accoppiamenti iniziali standard delle teste di serie (1vs8, 2vs7, 3vs6, 4vs5) con avanzamento automatico del vincitore.'}
                      </p>
                    </div>
                    {rankingData.master?.generatedAt && (
                      <div className="text-xs text-text-secondary">
                        Generato il {formatDateTime(rankingData.master.generatedAt)}
                      </div>
                    )}
                  </div>

                  <div className={`mt-6 grid grid-cols-1 gap-4 ${visibleMasterStages.length >= 4 ? 'xl:grid-cols-4' : visibleMasterStages.length === 3 ? 'xl:grid-cols-3' : visibleMasterStages.length === 2 ? 'xl:grid-cols-2' : 'xl:grid-cols-1'}`}>
                    {visibleMasterStages.map(([stage, label]) => (
                      <div key={stage} className="bg-primary rounded-xl border border-tertiary p-4 space-y-3">
                        <h4 className="font-bold text-accent">{label}</h4>
                        {visibleMasterMatches
                          .filter(match => match.stage === stage)
                          .map(match => (
                            <div key={match.id} className="rounded-lg border border-tertiary bg-secondary/60 p-3">
                              <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{match.label}</div>
                              <div className="mt-2 space-y-2 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                  <span>{playerMap.get(match.player1Id ?? '')?.name ?? 'Da definire'}</span>
                                  <span className="font-bold">{match.score1 ?? '—'}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span>{playerMap.get(match.player2Id ?? '')?.name ?? 'Da definire'}</span>
                                  <span className="font-bold">{match.score2 ?? '—'}</span>
                                </div>
                              </div>
                              <div className="mt-3">
                                <span className={`inline-flex rounded px-2 py-1 text-[11px] font-semibold ${getMasterMatchStatusTone(match)}`}>
                                  {getMasterMatchStatusLabel(match)}
                                </span>
                              </div>
                            </div>
                          ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {masterFormat === 'groups' && (
                <div className="bg-secondary rounded-xl shadow-lg p-6">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-xl font-bold text-accent">Master finale a gironi</h3>
                      <p className="text-sm text-text-secondary mt-1">
                        Due gironi bilanciati e partite generate automaticamente.
                      </p>
                    </div>
                    {rankingData.master?.generatedAt && (
                      <div className="text-xs text-text-secondary">
                        Generato il {formatDateTime(rankingData.master.generatedAt)}
                      </div>
                    )}
                  </div>

                  <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {masterMatchesByGroup.map(group => (
                      <div key={group.id} className="bg-primary rounded-xl border border-tertiary p-4 space-y-3">
                        <h4 className="font-bold text-accent">{group.name}</h4>
                        <div className="text-xs text-text-secondary">
                          {group.playerIds.map(playerId => playerMap.get(playerId)?.name ?? 'Da definire').join(' • ')}
                        </div>
                        {group.matches.map(match => (
                          <div key={match.id} className="rounded-lg border border-tertiary bg-secondary/60 p-3">
                            <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{match.label}</div>
                            <div className="mt-2 space-y-2 text-sm">
                              <div className="flex items-center justify-between gap-3">
                                <span>{playerMap.get(match.player1Id ?? '')?.name ?? 'Da definire'}</span>
                                <span className="font-bold">{match.score1 ?? '—'}</span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span>{playerMap.get(match.player2Id ?? '')?.name ?? 'Da definire'}</span>
                                <span className="font-bold">{match.score2 ?? '—'}</span>
                              </div>
                            </div>
                            <div className="mt-3">
                              <span className={`inline-flex rounded px-2 py-1 text-[11px] font-semibold ${getMasterMatchStatusTone(match)}`}>
                                {getMasterMatchStatusLabel(match)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-secondary rounded-xl shadow-lg p-4 sm:p-6">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-accent">Partite del Master</h3>
                    <p className="text-sm text-text-secondary mt-1">
                      L&apos;organizzatore può sempre intervenire; i giocatori possono prenotare e pubblicare risultati solo nelle partite in cui sono coinvolti.
                    </p>
                  </div>
                  <div className="text-xs text-text-secondary">
                    Slot condivisi con il ranking principale
                  </div>
                </div>

                {/* ── Mobile card view ── */}
                <div className="sm:hidden space-y-4">
                  {visibleMasterMatches.map(match => {
                    const player1 = playerMap.get(match.player1Id ?? '');
                    const player2 = playerMap.get(match.player2Id ?? '');
                    const canManage = canManageMasterMatch(match);
                    const opponent = loggedInPlayerId === match.player1Id ? player2 : loggedInPlayerId === match.player2Id ? player1 : null;

                    return (
                      <div key={match.id} className="rounded-xl border border-tertiary/40 bg-primary/40 p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">{match.label}</div>
                            <div className="text-xs text-text-secondary mt-0.5">
                              {player1?.name ?? 'Da definire'} vs {player2?.name ?? 'Da definire'}
                            </div>
                          </div>
                          <span className={`shrink-0 px-2 py-1 rounded text-xs font-semibold ${getMasterMatchStatusTone(match)}`}>
                            {getMasterMatchStatusLabel(match)}
                          </span>
                        </div>

                        {match.slotId ? (
                          <div className="text-xs text-text-secondary">
                            <div>{formatDateTime(match.scheduledTime)}</div>
                            <div>{match.location}{match.field ? ` • ${match.field}` : ''}</div>
                          </div>
                        ) : (
                          <div className="text-xs text-text-secondary">Nessuno slot assegnato</div>
                        )}

                        {canManage && match.player1Id && match.player2Id && match.status !== 'completed' ? (
                          <div className="flex flex-col gap-2">
                            <select
                              value={masterBookingSlotIdByMatch[match.id] ?? ''}
                              onChange={event => setMasterBookingSlotIdByMatch(previous => ({ ...previous, [match.id]: event.target.value }))}
                              className="w-full bg-primary border border-tertiary rounded-lg p-2 text-sm"
                            >
                              <option value="">Seleziona slot</option>
                              {availableSlots.map(slot => (
                                <option key={slot.id} value={slot.id}>
                                  {formatDateTime(slot.start)} • {slot.location}{slot.field ? ` • ${slot.field}` : ''}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => handleScheduleMasterMatch(match)}
                              disabled={!masterBookingSlotIdByMatch[match.id]}
                              className="w-full px-3 py-2 rounded bg-highlight text-white text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {match.slotId ? 'Aggiorna prenotazione' : 'Prenota slot'}
                            </button>
                          </div>
                        ) : (!canManage || !match.player1Id || !match.player2Id) ? (
                          <div className="text-xs text-text-secondary">
                            {match.player1Id && match.player2Id ? 'Disponibile solo ai giocatori coinvolti o all\'organizzatore.' : 'Attendi il completamento del turno precedente.'}
                          </div>
                        ) : null}

                        <div>
                          {editingMasterMatchId === match.id ? (
                            <div className="flex items-center gap-2">
                              <input type="number" min="0" value={masterScoreForm.score1}
                                onChange={event => setMasterScoreForm(previous => ({ ...previous, score1: event.target.value }))}
                                className="w-16 bg-primary border border-tertiary rounded px-2 py-1 text-sm"
                              />
                              <span>-</span>
                              <input type="number" min="0" value={masterScoreForm.score2}
                                onChange={event => setMasterScoreForm(previous => ({ ...previous, score2: event.target.value }))}
                                className="w-16 bg-primary border border-tertiary rounded px-2 py-1 text-sm"
                              />
                              <button onClick={() => handleSaveMasterResult(match)} className="px-3 py-1 rounded bg-highlight text-white text-xs font-semibold">Salva</button>
                            </div>
                          ) : (
                            <div className="text-sm font-semibold">
                              Risultato: {match.score1 !== null && match.score2 !== null ? `${match.score1} - ${match.score2}` : '—'}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {canManage && match.player1Id && match.player2Id && editingMasterMatchId !== match.id && (
                            <button onClick={() => openEditMasterResult(match)} className="px-3 py-1.5 rounded bg-tertiary hover:bg-tertiary/90 text-text-primary text-xs font-semibold">
                              {match.status === 'completed' ? 'Modifica risultato' : 'Pubblica risultato'}
                            </button>
                          )}
                          {canManage && match.status === 'completed' && (
                            <button onClick={() => handleResetMasterResult(match)} className="px-3 py-1.5 rounded bg-primary border border-tertiary text-xs font-semibold">
                              Ripristina
                            </button>
                          )}
                          {opponent && (
                            <button onClick={() => onPlayerContact(opponent)} className="px-3 py-1.5 rounded bg-primary border border-tertiary text-xs font-semibold">
                              Contatta avversario
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Desktop table ── */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full min-w-[1180px] text-sm">
                    <thead>
                      <tr className="text-left border-b border-tertiary text-text-secondary">
                        <th className="py-3 pr-3">Match</th>
                        <th className="py-3 pr-3">Stato</th>
                        <th className="py-3 pr-3">Slot / Campo</th>
                        <th className="py-3 pr-3">Prenotazione</th>
                        <th className="py-3 pr-3">Risultato</th>
                        <th className="py-3 pr-3">Azioni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleMasterMatches.map(match => {
                        const player1 = playerMap.get(match.player1Id ?? '');
                        const player2 = playerMap.get(match.player2Id ?? '');
                        const canManage = canManageMasterMatch(match);
                        const opponent = loggedInPlayerId === match.player1Id ? player2 : loggedInPlayerId === match.player2Id ? player1 : null;

                        return (
                          <tr key={match.id} className="border-b border-tertiary/40 last:border-b-0 align-top">
                            <td className="py-4 pr-3">
                              <div className="font-semibold">{match.label}</div>
                              <div className="text-xs text-text-secondary mt-1">
                                {player1?.name ?? 'Da definire'} vs {player2?.name ?? 'Da definire'}
                              </div>
                            </td>
                            <td className="py-4 pr-3">
                              <span className={`px-2 py-1 rounded text-xs font-semibold ${getMasterMatchStatusTone(match)}`}>
                                {getMasterMatchStatusLabel(match)}
                              </span>
                            </td>
                            <td className="py-4 pr-3 text-xs text-text-secondary">
                              {match.slotId ? (
                                <>
                                  <div>{formatDateTime(match.scheduledTime)}</div>
                                  <div>{match.location} {match.field ? `• ${match.field}` : ''}</div>
                                </>
                              ) : (
                                'Nessuno slot assegnato'
                              )}
                            </td>
                            <td className="py-4 pr-3">
                              {canManage && match.player1Id && match.player2Id && match.status !== 'completed' ? (
                                <div className="flex items-center gap-2">
                                  <select
                                    value={masterBookingSlotIdByMatch[match.id] ?? ''}
                                    onChange={event => setMasterBookingSlotIdByMatch(previous => ({ ...previous, [match.id]: event.target.value }))}
                                    className="min-w-[280px] bg-primary border border-tertiary rounded-lg p-2"
                                  >
                                    <option value="">Seleziona slot</option>
                                    {availableSlots.map(slot => (
                                      <option key={slot.id} value={slot.id}>
                                        {formatDateTime(slot.start)} • {slot.location} {slot.field ? `• ${slot.field}` : ''}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => handleScheduleMasterMatch(match)}
                                    disabled={!masterBookingSlotIdByMatch[match.id]}
                                    className="px-3 py-2 rounded bg-highlight text-white text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                                  >
                                    {match.slotId ? 'Aggiorna' : 'Prenota'}
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-text-secondary">
                                  {match.player1Id && match.player2Id ? "Disponibile solo ai giocatori coinvolti o all'organizzatore." : 'Attendi il completamento del turno precedente.'}
                                </span>
                              )}
                            </td>
                            <td className="py-4 pr-3">
                              {editingMasterMatchId === match.id ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    min="0"
                                    value={masterScoreForm.score1}
                                    onChange={event => setMasterScoreForm(previous => ({ ...previous, score1: event.target.value }))}
                                    className="w-16 bg-primary border border-tertiary rounded px-2 py-1"
                                  />
                                  <span>-</span>
                                  <input
                                    type="number"
                                    min="0"
                                    value={masterScoreForm.score2}
                                    onChange={event => setMasterScoreForm(previous => ({ ...previous, score2: event.target.value }))}
                                    className="w-16 bg-primary border border-tertiary rounded px-2 py-1"
                                  />
                                  <button
                                    onClick={() => handleSaveMasterResult(match)}
                                    className="px-3 py-1 rounded bg-highlight text-white text-xs font-semibold"
                                  >
                                    Salva
                                  </button>
                                </div>
                              ) : (
                                <span className="font-semibold">
                                  {match.score1 !== null && match.score2 !== null ? `${match.score1} - ${match.score2}` : '—'}
                                </span>
                              )}
                            </td>
                            <td className="py-4 pr-3">
                              <div className="flex flex-wrap gap-2">
                                {canManage && match.player1Id && match.player2Id && editingMasterMatchId !== match.id && (
                                  <button
                                    onClick={() => openEditMasterResult(match)}
                                    className="px-3 py-1 rounded bg-tertiary hover:bg-tertiary/90 text-text-primary text-xs font-semibold"
                                  >
                                    {match.status === 'completed' ? 'Modifica risultato' : 'Pubblica risultato'}
                                  </button>
                                )}
                                {canManage && match.status === 'completed' && (
                                  <button
                                    onClick={() => handleResetMasterResult(match)}
                                    className="px-3 py-1 rounded bg-primary border border-tertiary text-xs font-semibold"
                                  >
                                    Ripristina
                                  </button>
                                )}
                                {opponent && (
                                  <button
                                    onClick={() => onPlayerContact(opponent)}
                                    className="px-3 py-1 rounded bg-primary border border-tertiary text-xs font-semibold"
                                  >
                                    Contatta avversario
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'availability' && (
        <div className="space-y-6">
          <div className="bg-secondary rounded-xl shadow-lg p-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-xl font-bold text-accent">Disponibilità utente</h3>
                <p className="text-text-secondary mt-1">
                  Imposta da qui la tua disponibilità settimanale senza modificare gli slot prenotabili.
                </p>
              </div>
              {currentPlayerAvailability?.updatedAt && availabilityForm.entries.length > 0 && (
                <div className="text-xs text-text-secondary">
                  Ultimo aggiornamento: {formatDateTime(currentPlayerAvailability.updatedAt)}
                </div>
              )}
            </div>

            {currentPlayer ? (
              <div className="mt-6 space-y-6">
                <div className="rounded-xl border border-tertiary bg-primary/80 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">Disponibilità dichiarate</div>
                      <p className="mt-1 text-xs text-text-secondary">
                        Crea più disponibilità separate e gestiscile una per una.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setAvailabilityError(null);
                        setAvailabilityForm(prev => ({
                          ...prev,
                          isEditorOpen: true,
                          editingEntryId: null,
                          draft: createEmptyAvailabilityDraft(),
                        }));
                      }}
                      disabled={isSavingAvailability}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-highlight px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Crea disponibilità
                    </button>
                  </div>

                  {isLegacyAvailability && (
                    <div className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
                      È stata rilevata una disponibilità salvata nel formato precedente: la trovi già convertita nel nuovo elenco e puoi modificarla liberamente.
                    </div>
                  )}

                  {availabilityError && (
                    <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                      {availabilityError}
                    </div>
                  )}

                  {availabilityForm.isEditorOpen && (
                    <div className="mt-4 rounded-xl border border-tertiary bg-secondary p-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-sm font-semibold text-text-primary">
                            {availabilityForm.editingEntryId ? 'Modifica disponibilità' : 'Nuova disponibilità'}
                          </div>
                          <p className="mt-1 text-xs text-text-secondary">
                            Scegli stato, giorni e fasce orarie. Le fasce si applicano solo alle disponibilità disponibili.
                          </p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Stato</div>
                        <div className="flex flex-wrap gap-2">
                          {([
                            ['available', 'Disponibile'],
                            ['unavailable', 'Non disponibile'],
                          ] as const).map(([value, label]) => (
                            <button
                              key={value}
                              onClick={() => setAvailabilityForm(prev => ({
                                ...prev,
                                draft: {
                                  ...prev.draft,
                                  status: value,
                                  periods: value === 'available' ? prev.draft.periods : [],
                                },
                              }))}
                              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                                availabilityForm.draft.status === value
                                  ? value === 'available'
                                    ? 'border-green-500 bg-green-500/15 text-green-300'
                                    : 'border-red-500 bg-red-500/15 text-red-300'
                                  : 'border-tertiary bg-primary text-text-primary'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Giorni</div>
                        <div className="flex flex-wrap gap-2">
                          {AVAILABILITY_DAYS.map(day => {
                            const isSelected = availabilityForm.draft.days.includes(day.value);
                            return (
                              <button
                                key={day.value}
                                onClick={() => setAvailabilityForm(prev => ({
                                  ...prev,
                                  draft: {
                                    ...prev.draft,
                                    days: toggleArrayValue(prev.draft.days, day.value),
                                  },
                                }))}
                                className={`rounded-lg border px-3 py-2 text-sm ${
                                  isSelected
                                    ? 'border-highlight bg-highlight text-white'
                                    : 'border-tertiary bg-primary text-text-primary'
                                }`}
                              >
                                {day.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {availabilityForm.draft.status === 'available' ? (
                        <div className="mt-4">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Fasce orarie</div>
                          <div className="flex flex-wrap gap-2">
                            {AVAILABILITY_PERIODS.map(period => {
                              const isSelected = availabilityForm.draft.periods.includes(period.value);
                              return (
                                <button
                                  key={period.value}
                                  onClick={() => setAvailabilityForm(prev => ({
                                    ...prev,
                                    draft: {
                                      ...prev.draft,
                                      periods: toggleArrayValue(prev.draft.periods, period.value),
                                    },
                                  }))}
                                  className={`rounded-lg border px-3 py-2 text-sm ${
                                    isSelected
                                      ? 'border-highlight bg-highlight text-white'
                                      : 'border-tertiary bg-primary text-text-primary'
                                  }`}
                                >
                                  {period.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 rounded-lg border border-tertiary bg-primary px-3 py-2 text-xs text-text-secondary">
                          Per le disponibilità “Non disponibile” verranno salvati solo i giorni selezionati.
                        </div>
                      )}

                      <div className="mt-5 flex flex-wrap gap-3">
                        <button
                          onClick={handleSubmitAvailabilityEntry}
                          disabled={isSavingAvailability}
                          className="rounded-lg bg-highlight px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSavingAvailability
                            ? 'Salvataggio...'
                            : availabilityForm.editingEntryId
                              ? 'Salva modifica'
                              : 'Aggiungi disponibilità'}
                        </button>
                        <button
                          onClick={() => setAvailabilityForm(prev => ({
                            ...prev,
                            draft: createEmptyAvailabilityDraft(),
                          }))}
                          disabled={isSavingAvailability}
                          className="rounded-lg bg-tertiary px-4 py-2 text-sm font-semibold text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Ripristina
                        </button>
                        <button
                          onClick={() => {
                            setAvailabilityError(null);
                            setAvailabilityForm(prev => ({
                              ...prev,
                              isEditorOpen: false,
                              editingEntryId: null,
                              draft: createEmptyAvailabilityDraft(),
                            }));
                          }}
                          disabled={isSavingAvailability}
                          className="rounded-lg border border-tertiary px-4 py-2 text-sm font-semibold text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Annulla
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-3 text-sm font-semibold text-text-primary">Elenco disponibilità create</div>
                  {availabilityForm.entries.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-tertiary bg-primary px-4 py-5 text-sm text-text-secondary">
                      Nessuna disponibilità dichiarata.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {availabilityForm.entries.map(entry => (
                        <div key={entry.id} className="rounded-xl border border-tertiary bg-primary p-4">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-2">
                              <span
                                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${
                                  entry.status === 'available'
                                    ? 'bg-green-500/15 text-green-300 border border-green-500/30'
                                    : 'bg-red-500/15 text-red-300 border border-red-500/30'
                                }`}
                              >
                                {entry.status === 'available' ? 'Disponibile' : 'Non disponibile'}
                              </span>
                              <div className="text-sm font-semibold text-text-primary">
                                {formatAvailabilityDays(entry.days)}
                              </div>
                              {entry.status === 'available' && (
                                <div className="text-xs text-text-secondary">
                                  {formatAvailabilityPeriods(entry.periods ?? [])}
                                </div>
                              )}
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => {
                                  setAvailabilityError(null);
                                  setAvailabilityForm(prev => ({
                                    ...prev,
                                    isEditorOpen: true,
                                    editingEntryId: entry.id ?? null,
                                    draft: {
                                      status: entry.status,
                                      days: [...entry.days],
                                      periods: [...(entry.periods ?? [])],
                                    },
                                  }));
                                }}
                                disabled={isSavingAvailability}
                                className="rounded-lg bg-tertiary px-3 py-2 text-xs font-semibold text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Modifica
                              </button>
                              <button
                                onClick={() => entry.id && handleDeleteAvailabilityEntry(entry.id)}
                                disabled={isSavingAvailability}
                                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Elimina disponibilità
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-tertiary bg-primary p-4 text-sm text-text-secondary">
                  <div className="font-semibold text-text-primary">Riepilogo tabella</div>
                  <div className="mt-1">{currentAvailabilitySummary.status}</div>
                  {currentAvailabilitySummary.details && <div className="mt-1">{currentAvailabilitySummary.details}</div>}
                </div>

                {availabilityForm.entries.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={handleClearAvailabilityEntries}
                      disabled={isSavingAvailability}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Elimina tutte le disponibilità dichiarate
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-6 rounded-lg border border-tertiary bg-primary p-4 text-text-secondary">
                Accedi con un profilo giocatore confermato per impostare la disponibilità.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'rules' && (
        <div className="bg-secondary rounded-xl shadow-lg p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h3 className="text-xl font-bold text-accent">Regolamento ufficiale</h3>
          </div>
          {isOrganizer ? (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                Inserisci o modifica manualmente il regolamento del ranking.
              </p>
              <textarea
                value={rulesForm}
                onChange={event => {
                  setRulesForm(event.target.value);
                  setRulesError(null);
                  setRulesSuccess(null);
                }}
                rows={16}
                className="w-full bg-primary rounded-lg p-4 whitespace-pre-wrap border border-tertiary text-text-primary"
              />
              {rulesError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {rulesError}
                </div>
              )}
              {rulesSuccess && (
                <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
                  {rulesSuccess}
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleSaveRules}
                  disabled={isSavingRules || !hasRulesChanges}
                  className="px-4 py-2 rounded bg-highlight text-white font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSavingRules ? 'Salvataggio...' : 'Salva regolamento'}
                </button>
                <button
                  onClick={resetRules}
                  disabled={isSavingRules || !hasRulesChanges}
                  className="px-4 py-2 rounded bg-tertiary text-text-primary font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Ripristina
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-primary rounded-lg p-4 whitespace-pre-line border border-tertiary">
              {effectiveRulesText}
            </div>
          )}
        </div>
      )}

      {activeTab === 'settings' && isOrganizer && (
        <div className="bg-secondary rounded-xl shadow-lg p-6 space-y-6">
          <div>
            <h3 className="text-xl font-bold text-accent">Impostazioni ranking</h3>
            <p className="text-sm text-text-secondary mt-1">
              Modifica i valori numerici delle regole usate per il calcolo classifica.
            </p>
          </div>

          {/* Fasce differenza punti */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-accent uppercase tracking-wide">Fasce differenza punti</h4>
            <p className="text-xs text-text-secondary">La differenza punti è sempre calcolata in valore assoluto (uguale per favorito e sfavorito).</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Pari livello: differenza massima (0 – N)</span>
                <input type="number" value={rulesConfigForm.diffBandLowMax} onChange={e => updateRulesConfig('diffBandLowMax', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Medio livello: differenza massima (N+1 – M)</span>
                <input type="number" value={rulesConfigForm.diffBandMediumMax} onChange={e => updateRulesConfig('diffBandMediumMax', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
            </div>
            <p className="text-xs text-text-secondary">Alto livello: da (M+1) in su. Esempio con default: 0–99 = Pari, 100–199 = Medio, 200+ = Alto.</p>
          </div>

          {/* Vittoria favorito */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-accent uppercase tracking-wide">Se vince il favorito (giocatore con più punti)</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Vince contro pari livello: +X punti</span>
                <input type="number" value={rulesConfigForm.favoriteWinLow} onChange={e => updateRulesConfig('favoriteWinLow', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Perde contro pari livello: −Y punti</span>
                <input type="number" value={rulesConfigForm.favoriteLossLow} onChange={e => updateRulesConfig('favoriteLossLow', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Vince contro medio livello: +X punti</span>
                <input type="number" value={rulesConfigForm.favoriteWinMedium} onChange={e => updateRulesConfig('favoriteWinMedium', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Perde contro medio livello: −Y punti</span>
                <input type="number" value={rulesConfigForm.favoriteLossMedium} onChange={e => updateRulesConfig('favoriteLossMedium', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Vince contro alto livello: +X punti</span>
                <input type="number" value={rulesConfigForm.favoriteWinHigh} onChange={e => updateRulesConfig('favoriteWinHigh', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Perde contro alto livello: −Y punti</span>
                <input type="number" value={rulesConfigForm.favoriteLossHigh} onChange={e => updateRulesConfig('favoriteLossHigh', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
            </div>
          </div>

          {/* Vittoria sfavorito */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-accent uppercase tracking-wide">Se vince lo sfavorito (giocatore con meno punti)</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Vince contro pari livello: +X punti</span>
                <input type="number" value={rulesConfigForm.underdogWinLow} onChange={e => updateRulesConfig('underdogWinLow', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Perde contro pari livello: −Y punti</span>
                <input type="number" value={rulesConfigForm.underdogLossLow} onChange={e => updateRulesConfig('underdogLossLow', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Vince contro medio livello: +X punti</span>
                <input type="number" value={rulesConfigForm.underdogWinMedium} onChange={e => updateRulesConfig('underdogWinMedium', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Perde contro medio livello: −Y punti</span>
                <input type="number" value={rulesConfigForm.underdogLossMedium} onChange={e => updateRulesConfig('underdogLossMedium', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Vince contro alto livello: +X punti</span>
                <input type="number" value={rulesConfigForm.underdogWinHigh} onChange={e => updateRulesConfig('underdogWinHigh', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Perde contro alto livello: −Y punti</span>
                <input type="number" value={rulesConfigForm.underdogLossHigh} onChange={e => updateRulesConfig('underdogLossHigh', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
            </div>
          </div>

          {/* Pareggio */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-accent uppercase tracking-wide">Pareggio</h4>
            <p className="text-xs text-text-secondary">Scegli come calcolare i punti in caso di pareggio.</p>
            <div className="flex flex-col gap-3">
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="drawMode"
                    value="percentage"
                    checked={rulesConfigForm.drawMode === 'percentage'}
                    onChange={() => updateRulesConfig('drawMode', 'percentage')}
                    className="accent-accent"
                  />
                  <span className="text-sm text-text-primary">Percentuale dei punti vittoria</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="drawMode"
                    value="fixed"
                    checked={rulesConfigForm.drawMode === 'fixed'}
                    onChange={() => updateRulesConfig('drawMode', 'fixed')}
                    className="accent-accent"
                  />
                  <span className="text-sm text-text-primary">Valore fisso</span>
                </label>
              </div>
              {rulesConfigForm.drawMode === 'percentage' ? (
                <label className="flex flex-col gap-1 max-w-xs">
                  <span className="text-xs font-semibold text-text-secondary">
                    Percentuale dei punti vittoria (es. 50 = metà dei punti che si vincerebbero)
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={rulesConfigForm.drawPercentage}
                    onChange={e => updateRulesConfig('drawPercentage', e.target.value)}
                    className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary"
                  />
                </label>
              ) : (
                <label className="flex flex-col gap-1 max-w-xs">
                  <span className="text-xs font-semibold text-text-secondary">
                    Punti fissi per ogni giocatore in caso di pareggio
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={rulesConfigForm.drawFixed}
                    onChange={e => updateRulesConfig('drawFixed', e.target.value)}
                    className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary"
                  />
                </label>
              )}
            </div>
          </div>

          {/* Bonus partecipazione */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-accent uppercase tracking-wide">Bonus partecipazione</h4>
              <button
                type="button"
                onClick={() => toggleRulesConfigFlag('participationBonusEnabled')}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${rulesConfigForm.participationBonusEnabled ? 'bg-accent' : 'bg-tertiary'}`}
                aria-label="Attiva/disattiva bonus partecipazione"
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${rulesConfigForm.participationBonusEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <div className={`grid grid-cols-1 gap-3 transition-opacity ${rulesConfigForm.participationBonusEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Bonus base per partita (+)</span>
                <input type="number" value={rulesConfigForm.participationBase} onChange={e => updateRulesConfig('participationBase', e.target.value)} disabled={!rulesConfigForm.participationBonusEnabled} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary disabled:opacity-40" />
              </label>
            </div>
          </div>

          {/* Bonus differenza game */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-accent uppercase tracking-wide">Bonus differenza game (vincitore)</h4>
              <button
                type="button"
                onClick={() => toggleRulesConfigFlag('gameDiffBonusEnabled')}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${rulesConfigForm.gameDiffBonusEnabled ? 'bg-accent' : 'bg-tertiary'}`}
                aria-label="Attiva/disattiva bonus differenza game"
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${rulesConfigForm.gameDiffBonusEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <div className={`grid grid-cols-1 md:grid-cols-3 gap-3 transition-opacity ${rulesConfigForm.gameDiffBonusEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Scarto 2 game (+)</span>
                <input type="number" min="0" value={rulesConfigForm.gameDiffBonus2} onChange={e => updateRulesConfig('gameDiffBonus2', e.target.value)} disabled={!rulesConfigForm.gameDiffBonusEnabled} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary disabled:opacity-40" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Scarto 3 game (+)</span>
                <input type="number" min="0" value={rulesConfigForm.gameDiffBonus3} onChange={e => updateRulesConfig('gameDiffBonus3', e.target.value)} disabled={!rulesConfigForm.gameDiffBonusEnabled} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary disabled:opacity-40" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Scarto 4+ game (+)</span>
                <input type="number" min="0" value={rulesConfigForm.gameDiffBonus4plus} onChange={e => updateRulesConfig('gameDiffBonus4plus', e.target.value)} disabled={!rulesConfigForm.gameDiffBonusEnabled} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary disabled:opacity-40" />
              </label>
            </div>
          </div>

          {/* Bonus game fatti */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-accent uppercase tracking-wide">Bonus game fatti</h4>
              <button
                type="button"
                onClick={() => toggleRulesConfigFlag('wonGamesBonusEnabled')}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${rulesConfigForm.wonGamesBonusEnabled ? 'bg-accent' : 'bg-tertiary'}`}
                aria-label="Attiva/disattiva bonus game fatti"
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${rulesConfigForm.wonGamesBonusEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <div className={`flex flex-col gap-2 transition-opacity ${rulesConfigForm.wonGamesBonusEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
              <span className="text-xs font-semibold text-text-secondary">Moltiplicatore game (1x = normale, 2x = doppio)</span>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="wonGamesMultiplier"
                    value="1"
                    checked={rulesConfigForm.wonGamesMultiplier === 1}
                    onChange={() => updateRulesConfig('wonGamesMultiplier', '1')}
                    disabled={!rulesConfigForm.wonGamesBonusEnabled}
                    className="accent-accent"
                  />
                  <span className="text-sm text-text-primary">×1 — normale (6 game = +6 pt)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="wonGamesMultiplier"
                    value="2"
                    checked={rulesConfigForm.wonGamesMultiplier === 2}
                    onChange={() => updateRulesConfig('wonGamesMultiplier', '2')}
                    disabled={!rulesConfigForm.wonGamesBonusEnabled}
                    className="accent-accent"
                  />
                  <span className="text-sm text-text-primary">×2 — doppio (6 game = +12 pt)</span>
                </label>
              </div>
            </div>
          </div>

          {/* Malus inattività */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-accent uppercase tracking-wide">Malus inattività</h4>
              <button
                type="button"
                onClick={() => toggleRulesConfigFlag('inactivityMalusEnabled')}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${rulesConfigForm.inactivityMalusEnabled ? 'bg-accent' : 'bg-tertiary'}`}
                aria-label="Attiva/disattiva malus inattività"
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${rulesConfigForm.inactivityMalusEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 transition-opacity ${rulesConfigForm.inactivityMalusEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Punti malus per periodo (-)</span>
                <input type="number" min="0" value={rulesConfigForm.inactivityMalusPoints} onChange={e => updateRulesConfig('inactivityMalusPoints', e.target.value)} disabled={!rulesConfigForm.inactivityMalusEnabled} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary disabled:opacity-40" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Giorni senza partite per periodo</span>
                <input type="number" min="1" value={rulesConfigForm.inactivityMalusDays} onChange={e => updateRulesConfig('inactivityMalusDays', e.target.value)} disabled={!rulesConfigForm.inactivityMalusEnabled} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary disabled:opacity-40" />
              </label>
            </div>
          </div>

          {/* Master finale */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-accent uppercase tracking-wide">Master finale</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Top N qualificati</span>
                <input type="number" min="1" value={rulesConfigForm.masterSize} onChange={e => updateRulesConfig('masterSize', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
              <div className="flex flex-col gap-1 rounded-lg border border-tertiary bg-primary px-3 py-2">
                <span className="text-xs font-semibold text-text-secondary">Qualificazione automatica</span>
                <span className="text-sm text-text-primary">I primi {rulesConfigForm.masterSize} della classifica sono qualificati in tempo reale fino a eventuale override manuale.</span>
              </div>
            </div>
          </div>

          {/* Limite scontri */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-accent uppercase tracking-wide">Limite scontri diretti</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-secondary">Max incontri vs stesso avversario</span>
                <input type="number" min="1" value={rulesConfigForm.headToHeadLimit} onChange={e => updateRulesConfig('headToHeadLimit', e.target.value)} className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
              </label>
            </div>
          </div>

          {rulesSettingsError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {rulesSettingsError}
            </div>
          )}
          {rulesSettingsSuccess && (
            <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
              {rulesSettingsSuccess}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleSaveRulesSettings}
              disabled={isSavingRulesSettings || !hasRulesSettingsChanges}
              className="px-4 py-2 rounded bg-highlight text-white font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSavingRulesSettings ? 'Salvataggio...' : 'Salva'}
            </button>
            <button
              onClick={resetRulesSettings}
              disabled={isSavingRulesSettings || !hasRulesSettingsChanges}
              className="px-4 py-2 rounded bg-tertiary text-text-primary font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Ripristina
            </button>
          </div>
        </div>
      )}

      {resultModal && resultModalMatch && (
        <Portal>
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) closeResultModal(); }}
          >
            <div className="bg-secondary rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
              <h3 className="text-xl font-bold text-accent">
                {resultModalMatch.status === 'completed' ? 'Modifica risultato' : 'Inserisci risultato'}
              </h3>
              <p className="text-sm text-text-secondary">
                <span className="font-semibold text-text-primary">{playerMap.get(resultModalMatch.player1Id)?.name ?? resultModalMatch.player1Id}</span>
                {' '}vs{' '}
                <span className="font-semibold text-text-primary">{playerMap.get(resultModalMatch.player2Id)?.name ?? resultModalMatch.player2Id}</span>
              </p>

              <div className="space-y-3">
                <div className="text-xs font-semibold text-text-secondary">Esito <span className="text-red-400">*</span></div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    onClick={() => setResultModal(previous => previous ? { ...previous, outcome: 'player1', error: null } : previous)}
                    className={`px-3 py-2 rounded border text-xs font-semibold ${resultModal.outcome === 'player1' ? 'bg-highlight text-white border-highlight' : 'bg-primary border-tertiary text-text-primary'}`}
                  >
                    Vince {playerMap.get(resultModalMatch.player1Id)?.name ?? 'Giocatore 1'}
                  </button>
                  <button
                    onClick={() => setResultModal(previous => previous ? { ...previous, outcome: 'draw', error: null } : previous)}
                    className={`px-3 py-2 rounded border text-xs font-semibold ${resultModal.outcome === 'draw' ? 'bg-highlight text-white border-highlight' : 'bg-primary border-tertiary text-text-primary'}`}
                  >
                    Pareggio
                  </button>
                  <button
                    onClick={() => setResultModal(previous => previous ? { ...previous, outcome: 'player2', error: null } : previous)}
                    className={`px-3 py-2 rounded border text-xs font-semibold ${resultModal.outcome === 'player2' ? 'bg-highlight text-white border-highlight' : 'bg-primary border-tertiary text-text-primary'}`}
                  >
                    Vince {playerMap.get(resultModalMatch.player2Id)?.name ?? 'Giocatore 2'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-text-secondary">
                    {playerMap.get(resultModalMatch.player1Id)?.name ?? 'Giocatore 1'} <span className="text-red-400">*</span>
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={resultModal.score1}
                    onChange={event => setResultModal(previous => previous ? { ...previous, score1: event.target.value, error: null } : previous)}
                    className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-text-secondary">
                    {playerMap.get(resultModalMatch.player2Id)?.name ?? 'Giocatore 2'} <span className="text-red-400">*</span>
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={resultModal.score2}
                    onChange={event => setResultModal(previous => previous ? { ...previous, score2: event.target.value, error: null } : previous)}
                    className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary"
                  />
                </label>
              </div>

              <div className="text-xs text-text-secondary">
                Risultato: {(resultModal.score1 || '0')} - {(resultModal.score2 || '0')}
              </div>

              {resultModal.error && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {resultModal.error}
                </div>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={closeResultModal}
                  disabled={isSavingMatchResult}
                  className="px-4 py-2 rounded bg-tertiary hover:bg-tertiary/90 text-text-primary font-semibold text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Annulla
                </button>
                <button
                  onClick={handleSaveResult}
                  disabled={isSavingMatchResult}
                  className="px-4 py-2 rounded bg-accent hover:bg-accent/80 text-white font-semibold text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSavingMatchResult ? 'Salvataggio...' : 'Salva risultato'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {matchToDelete && (
        <Portal>
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) closeDeleteMatchModal(); }}
          >
            <div className="bg-secondary rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <h3 className="text-xl font-bold text-red-400">Conferma eliminazione</h3>
              <p className="text-sm text-text-secondary">
                Vuoi eliminare definitivamente questa partita? L&apos;operazione rimuoverà anche i punti assegnati a questa partita.
              </p>
              <p className="text-sm">
                <span className="font-semibold text-text-primary">{playerMap.get(matchToDelete.player1Id)?.name ?? matchToDelete.player1Id}</span>
                {' '}vs{' '}
                <span className="font-semibold text-text-primary">{playerMap.get(matchToDelete.player2Id)?.name ?? matchToDelete.player2Id}</span>
              </p>

              {deleteMatchError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {deleteMatchError}
                </div>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={closeDeleteMatchModal}
                  disabled={isDeletingMatch}
                  className="px-4 py-2 rounded bg-tertiary hover:bg-tertiary/90 text-text-primary font-semibold text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Annulla
                </button>
                <button
                  onClick={handleDeleteMatch}
                  disabled={isDeletingMatch}
                  className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white font-semibold text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isDeletingMatch ? 'Eliminazione...' : 'Conferma eliminazione'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {challengeModal && (
        <Portal>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) closeChallengeModal(); }}
          >
            <div className="bg-secondary rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <h3 className="text-xl font-bold text-accent">Crea partita</h3>
              <p className="text-sm text-text-secondary">
                Seleziona avversario, data, orario e luogo per completare la prenotazione della partita.
              </p>

              <div className="space-y-3">
                {/* Admin-only: pick Giocatore 1 when the admin has no player account */}
                {isOrganizer && !currentPlayer && (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-text-secondary">Giocatore 1 <span className="text-red-400">*</span></span>
                    <select
                      value={challengeModal.player1Id ?? ''}
                      onChange={e => setChallengeModal(prev => prev ? { ...prev, player1Id: e.target.value } : prev)}
                      className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary"
                    >
                      <option value="">Seleziona giocatore 1</option>
                      {confirmedPlayers
                        .filter(p => p.id !== challengeModal.opponentId)
                        .map(player => (
                          <option key={player.id} value={player.id}>
                            {player.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-text-secondary">{(isOrganizer && !currentPlayer) ? 'Giocatore 2' : 'Avversario'} <span className="text-red-400">*</span></span>
                  <select
                    value={challengeModal.opponentId}
                    onChange={e => setChallengeModal(prev => prev ? {
                      ...prev,
                      opponentId: e.target.value,
                      opponentName: playerMap.get(e.target.value)?.name ?? '',
                    } : prev)}
                    className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary"
                  >
                    <option value="">{(isOrganizer && !currentPlayer) ? 'Seleziona giocatore 2' : 'Seleziona avversario'}</option>
                    {(isOrganizer && !currentPlayer ? confirmedPlayers.filter(p => p.id !== (challengeModal.player1Id ?? '')) : eligibleOpponents).map(player => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-text-secondary">Data <span className="text-red-400">*</span></span>
                  <input
                    type="date"
                    value={challengeModal.scheduledDate}
                    onChange={e => setChallengeModal(prev => prev ? { ...prev, scheduledDate: e.target.value } : prev)}
                    className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-text-secondary">Orario <span className="text-red-400">*</span></span>
                  <input
                    type="time"
                    value={challengeModal.scheduledHour}
                    onChange={e => setChallengeModal(prev => prev ? { ...prev, scheduledHour: e.target.value } : prev)}
                    className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-text-secondary">Luogo <span className="text-red-400">*</span></span>
                  <select
                    value={challengeModal.location}
                    onChange={e => setChallengeModal(prev => prev ? { ...prev, location: e.target.value } : prev)}
                    className="bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary"
                  >
                    <option value="Tennis Salò Canottieri">Tennis Salò Canottieri</option>
                    <option value="Paitone Arena">Paitone Arena</option>
                  </select>
                </label>
              </div>

              {challengeError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {challengeError}
                </div>
              )}
              {challengeSuccess && (
                <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">
                  {challengeSuccess}
                </div>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={closeChallengeModal}
                  disabled={isSavingChallenge}
                  className="px-4 py-2 rounded bg-tertiary hover:bg-tertiary/90 text-text-primary font-semibold text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Annulla
                </button>
                <button
                  onClick={handleCreateChallenge}
                  disabled={isSavingChallenge || !challengeModal.opponentId || !challengeModal.scheduledDate || !challengeModal.scheduledHour || !challengeModal.location || (isOrganizer && !currentPlayer && !challengeModal.player1Id)}
                  className="px-4 py-2 rounded bg-accent hover:bg-accent/80 text-white font-semibold text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSavingChallenge ? 'Salvataggio...' : 'Conferma prenotazione'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {pendingStartPointsConfirm && (
        <Portal>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setPendingStartPointsConfirm(null); }}
          >
            <div className="bg-secondary rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
              <h3 className="text-xl font-bold text-accent">Conferma modifica punti base</h3>
              <p className="text-sm text-text-secondary">
                Stai per impostare i punti base di{' '}
                <span className="font-semibold text-text-primary">{pendingStartPointsConfirm.playerName}</span>
                {' '}a{' '}
                <span className="font-semibold text-text-primary">{pendingStartPointsConfirm.nextPoints}</span>
                {' '}pt. Confermi il cambiamento?
              </p>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={() => setPendingStartPointsConfirm(null)}
                  className="px-4 py-2 rounded bg-tertiary hover:bg-tertiary/90 text-text-primary font-semibold text-sm"
                >
                  Annulla
                </button>
                <button
                  onClick={confirmStartPointsSave}
                  className="px-4 py-2 rounded bg-highlight hover:bg-highlight/90 text-white font-semibold text-sm"
                >
                  Conferma
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {selectedMatchId && (() => {
        const match = rankingData.matches.find(m => m.id === selectedMatchId);
        if (!match) return null;
        const breakdown = matchBreakdowns.get(match.id);
        if (!breakdown) return null;
        const p1 = playerMap.get(match.player1Id);
        const p2 = playerMap.get(match.player2Id);
        return (
          <Portal>
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
              onClick={(e) => { if (e.target === e.currentTarget) setSelectedMatchId(null); }}
            >
              <div className="bg-secondary rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-bold text-accent">Dettaglio punti partita</h3>
                    <div className="text-sm text-text-secondary mt-1">
                      {p1?.name ?? match.player1Id} vs {p2?.name ?? match.player2Id}
                      {match.score1 !== null && match.score2 !== null && (
                        <span className="ml-2 font-semibold text-text-primary">{match.score1} - {match.score2}</span>
                      )}
                      {match.completedAt && (
                        <span className="ml-2 text-xs">• {formatDateTime(match.completedAt)}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedMatchId(null)}
                    className="shrink-0 text-text-secondary hover:text-text-primary text-xl font-bold leading-none"
                    aria-label="Chiudi"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-3">
                  {([
                    [p1?.name ?? match.player1Id, breakdown.player1],
                    [p2?.name ?? match.player2Id, breakdown.player2],
                  ] as const).map(([playerName, bd]) => (
                    <div key={bd.playerId} className="rounded-lg border border-tertiary/50 bg-primary/40 p-3 text-xs text-text-secondary">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="font-semibold text-text-primary text-sm">{playerName}</span>
                        <span className={`font-bold text-sm ${bd.totalPoints > 0 ? 'text-green-400' : bd.totalPoints < 0 ? 'text-red-400' : 'text-text-secondary'}`}>
                          {formatSignedPoints(bd.totalPoints)}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div>Risultato ({getMatchOutcomeLabel(bd.outcome)}): {formatSignedPoints(bd.resultPoints)}</div>
                        <div>Game fatti: {bd.gameFatti} ({formatSignedPoints(bd.gameFattiPoints)})</div>
                        {bd.gameDiffPoints !== 0 && (
                          <div>Bonus differenza game: {formatSignedPoints(bd.gameDiffPoints)}</div>
                        )}
                        {bd.participationPoints !== 0 && (
                          <div>Partecipazione: {formatSignedPoints(bd.participationPoints)}</div>
                        )}
                        {bd.rulesAdjustmentPoints !== 0 && (
                          <div>Adeguamento regola: {formatSignedPoints(bd.rulesAdjustmentPoints)}</div>
                        )}
                      </div>
                      <div className="mt-2 border-t border-tertiary/50 pt-2 font-semibold text-text-primary">
                        Totale match: {formatSignedPoints(bd.totalPoints)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setSelectedMatchId(null)}
                    className="px-4 py-2 rounded bg-tertiary hover:bg-tertiary/90 text-text-primary font-semibold text-sm"
                  >
                    Chiudi
                  </button>
                </div>
              </div>
            </div>
          </Portal>
        );
      })()}

      {selectedPlayerProfile && (
        <Portal>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setSelectedPlayerId(null); }}
          >
            <div className="bg-secondary rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex items-start justify-between gap-4 border-b border-tertiary/50 px-4 sm:px-6 py-4 sm:py-5">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={selectedPlayerProfile.player.avatar}
                    alt={selectedPlayerProfile.player.name}
                    className="w-12 h-12 sm:w-16 sm:h-16 shrink-0 rounded-full object-cover border-2 border-accent"
                  />
                  <div className="min-w-0">
                    <h3 className="text-xl sm:text-2xl font-bold text-accent truncate">{selectedPlayerProfile.player.name}</h3>
                    <div className="mt-1 text-sm text-text-secondary">
                      Profilo ranking • {selectedPlayerProfile.history.length} partite completate
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedPlayerId(null)}
                  className="shrink-0 text-text-secondary hover:text-text-primary text-xl font-bold leading-none p-1"
                  aria-label="Chiudi"
                >
                  ✕
                </button>
              </div>

              <div className="overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-6">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-xl border border-tertiary/50 bg-primary/40 p-4">
                    <div className="text-xs uppercase tracking-wide text-text-secondary">Punteggio iniziale</div>
                    <div className="mt-2 text-2xl font-bold text-text-primary">{selectedPlayerProfile.startingPoints} pt</div>
                  </div>
                  <div className="rounded-xl border border-tertiary/50 bg-primary/40 p-4">
                    <div className="text-xs uppercase tracking-wide text-text-secondary">Punteggio attuale</div>
                    <div className="mt-2 text-2xl font-bold text-accent">{selectedPlayerProfile.currentPoints} pt</div>
                  </div>
                  <div className="rounded-xl border border-tertiary/50 bg-primary/40 p-4">
                    <div className="text-xs uppercase tracking-wide text-text-secondary">Variazione totale</div>
                    <div className={`mt-2 text-2xl font-bold ${(selectedPlayerProfile.currentPoints - selectedPlayerProfile.startingPoints) > 0 ? 'text-green-400' : (selectedPlayerProfile.currentPoints - selectedPlayerProfile.startingPoints) < 0 ? 'text-red-400' : 'text-text-primary'}`}>
                      {formatSignedPoints(selectedPlayerProfile.currentPoints - selectedPlayerProfile.startingPoints)}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-tertiary/50 bg-primary/30 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-lg font-semibold text-text-primary">Contatti</h4>
                      <p className="mt-1 text-sm text-text-secondary">
                        Usa i recapiti già visibili nel ranking per contattare il giocatore.
                      </p>
                    </div>
                    {selectedPlayerProfile.hasPhone ? (
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={`tel:${selectedPlayerProfile.telPhone}`}
                          className="inline-flex items-center gap-2 rounded-lg bg-tertiary hover:bg-tertiary/80 px-4 py-2 text-sm font-semibold text-text-primary transition-colors"
                        >
                          <PhoneIcon className="w-4 h-4" />
                          Chiama
                        </a>
                        <a
                          href={`https://wa.me/${selectedPlayerProfile.whatsappPhone}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg bg-green-600 hover:bg-green-700 px-4 py-2 text-sm font-semibold text-white transition-colors"
                        >
                          <WhatsAppIcon className="w-4 h-4" />
                          WhatsApp
                        </a>
                        <button
                          onClick={() => onPlayerContact(selectedPlayerProfile.player)}
                          className="inline-flex items-center rounded-lg bg-accent hover:bg-accent/80 px-4 py-2 text-sm font-semibold text-white transition-colors"
                        >
                          Contatta
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-tertiary bg-primary/60 px-4 py-3 text-sm text-text-secondary">
                        Numero non disponibile
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-lg font-semibold text-text-primary">Storico partite completate</h4>
                      <p className="mt-1 text-sm text-text-secondary">
                        Progressione dal punteggio base fino al totale attuale, mantenendo il breakdown del ranking estivo.
                      </p>
                    </div>
                    <div className="rounded-full bg-primary/60 px-3 py-1 text-xs font-semibold text-text-secondary">
                      Base {selectedPlayerProfile.startingPoints} pt → Attuale {selectedPlayerProfile.currentPoints} pt
                    </div>
                  </div>

                  {selectedPlayerProfile.history.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-tertiary bg-primary/30 px-4 py-8 text-center text-text-secondary">
                      Nessuna partita completata ancora per questo giocatore.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {selectedPlayerProfile.history.map((item, index) => (
                        <div key={item.match.id} className="rounded-xl border border-tertiary/50 bg-primary/40 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-xs uppercase tracking-wide text-text-secondary">Partita {index + 1}</div>
                              <div className="mt-1 text-lg font-semibold text-text-primary">
                                vs {item.opponent?.name ?? (item.match.player1Id === selectedPlayerProfile.player.id ? item.match.player2Id : item.match.player1Id)}
                              </div>
                              <div className="mt-1 text-sm text-text-secondary">
                                {getMatchPlayedAtLabel(item.match) ? formatDateTime(getMatchPlayedAtLabel(item.match)) : 'Data non disponibile'}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-text-primary">{item.scoreLabel}</div>
                              <div className={`mt-1 text-sm font-bold ${item.pointsDelta > 0 ? 'text-green-400' : item.pointsDelta < 0 ? 'text-red-400' : 'text-text-secondary'}`}>
                                {formatSignedPoints(item.pointsDelta)}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
                            <div className="space-y-1 text-sm text-text-secondary">
                              <div>
                                Risultato: <span className="font-semibold text-text-primary">{item.breakdown ? getMatchOutcomeLabel(item.breakdown.outcome) : 'Non disponibile'}</span>
                              </div>
                              {item.breakdown ? (
                                <>
                                  <div>Risultato punti: {formatSignedPoints(item.breakdown.resultPoints)}</div>
                                  <div>Game fatti: {item.breakdown.gameFatti} ({formatSignedPoints(item.breakdown.gameFattiPoints)})</div>
                                  {item.breakdown.participationPoints !== 0 && (
                                    <div>Partecipazione: {formatSignedPoints(item.breakdown.participationPoints)}</div>
                                  )}
                                  {item.breakdown.gameDiffPoints !== 0 && (
                                    <div>Bonus differenza game: {formatSignedPoints(item.breakdown.gameDiffPoints)}</div>
                                  )}
                                  {item.breakdown.rulesAdjustmentPoints !== 0 && (
                                    <div>Adeguamento regola: {formatSignedPoints(item.breakdown.rulesAdjustmentPoints)}</div>
                                  )}
                                  <div className="font-semibold text-text-primary">Totale match: {formatSignedPoints(item.breakdown.totalPoints)}</div>
                                </>
                              ) : (
                                <div>Dettaglio punteggio non disponibile.</div>
                              )}
                            </div>

                            <div className="rounded-lg border border-tertiary/50 bg-secondary/60 p-3 text-sm">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-text-secondary">Punti prima</span>
                                <span className="font-semibold text-text-primary">{item.pointsBefore} pt</span>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-3">
                                <span className="text-text-secondary">Delta match</span>
                                <span className={`font-semibold ${item.pointsDelta > 0 ? 'text-green-400' : item.pointsDelta < 0 ? 'text-red-400' : 'text-text-primary'}`}>
                                  {formatSignedPoints(item.pointsDelta)}
                                </span>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-3 border-t border-tertiary/50 pt-2">
                                <span className="text-text-secondary">Punti dopo</span>
                                <span className="font-bold text-accent">{item.pointsAfter} pt</span>
                              </div>
                              {item.breakdown && (
                                <button
                                  onClick={() => setSelectedMatchId(item.match.id)}
                                  className="mt-3 w-full rounded-lg bg-accent hover:bg-accent/80 px-3 py-2 text-xs font-semibold text-white transition-colors"
                                >
                                  Dettaglio punti partita
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}

    </div>
  );
};

export default SummerRankingView;
