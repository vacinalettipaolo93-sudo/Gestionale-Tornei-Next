import React, { useEffect, useMemo, useState } from 'react';
import {
  type Match,
  type Player,
  type SummerRankingData,
  type SummerRankingMasterPair,
  type SummerRankingMasterMatch,
  type SummerRankingRulesConfig,
} from '../types';
import { PlusIcon } from './Icons';
import {
  DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG,
  calculatePadelIndividualAwards,
  calculatePadelIndividualCurrentRatings,
  calculatePadelIndividualMatchBreakdowns,
  calculatePadelIndividualPreMatchRatings,
  calculatePadelIndividualRanking,
  createPadelIndividualMasterData,
  DEFAULT_PADEL_INDIVIDUAL_RULES,
  getPadelIndividualAutoQualifiedPlayerIds,
  getPadelIndividualBandLabel,
  getPadelIndividualBandTone,
  getPadelIndividualFavoritePairText,
  getPadelIndividualPairName,
  getPadelIndividualPreMatchInfo,
  getPadelIndividualTeamPlayerIds,
  generatePadelIndividualRulesText,
  isPadelIndividualMatch,
  PADEL_INDIVIDUAL_RANKING_NAME,
  normalizePadelIndividualRulesConfig,
  recomputePadelIndividualMasterBracket,
  syncPadelIndividualMasterMatches,
} from '../utils/padelIndividualRanking';
import { matchIncludesPlayer } from '../utils/rankingEvent';
import {
  AVAILABILITY_DAYS,
  AVAILABILITY_PERIODS,
  type AvailabilityFormState,
  buildAvailabilityPayload,
  createAvailabilityFormState,
  createEmptyAvailabilityDraft,
  formatAvailabilityDays,
  formatAvailabilityPeriods,
  getAvailabilitySummary,
  getNormalizedDays,
  getNormalizedPeriods,
  normalizeAvailabilityEntries,
  toggleArrayValue,
} from '../utils/rankingAvailability';

interface PadelIndividualRankingViewProps {
  players: Player[];
  rankingData: SummerRankingData;
  isOrganizer: boolean;
  loggedInPlayerId?: string;
  onSaveRankingData: (nextData: SummerRankingData) => Promise<void>;
  onOpenPlayersAdmin?: () => void;
  title?: string;
  description?: string;
  playersAdminLabel?: string;
}

type ActiveTab = 'ranking' | 'matches' | 'master' | 'availability' | 'rules' | 'settings' | 'players';

type MatchFormState = {
  editingMatchId: string | null;
  team1Player1Id: string;
  team1Player2Id: string;
  team2Player1Id: string;
  team2Player2Id: string;
  score1: string;
  score2: string;
  completedAt: string;
  error: string | null;
};

type MasterPairDraft = {
  id: string;
  player1Id: string;
  player2Id: string;
};

type MasterResultFormState = {
  matchId: string | null;
  score1: string;
  score2: string;
  error: string | null;
};

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

const toDateTimeLocalValue = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const createInitialMatchForm = (): MatchFormState => ({
  editingMatchId: null,
  team1Player1Id: '',
  team1Player2Id: '',
  team2Player1Id: '',
  team2Player2Id: '',
  score1: '',
  score2: '',
  completedAt: toDateTimeLocalValue(new Date().toISOString()),
  error: null,
});

const createInitialMasterResultForm = (): MasterResultFormState => ({
  matchId: null,
  score1: '',
  score2: '',
  error: null,
});

const buildDefaultPairDrafts = (pairCount: number, pairs?: SummerRankingMasterPair[]): MasterPairDraft[] => {
  if (Array.isArray(pairs) && pairs.length > 0) {
    return pairs.map(pair => ({ id: pair.id, player1Id: pair.player1Id, player2Id: pair.player2Id }));
  }
  return Array.from({ length: Math.max(1, pairCount) }).map((_, index) => ({
    id: `pair-draft-${index + 1}`,
    player1Id: '',
    player2Id: '',
  }));
};

const getPairNameByIds = (teamPlayerIds: string[], playerMap: Map<string, Player>) =>
  teamPlayerIds.map(playerId => playerMap.get(playerId)?.name ?? playerId).join(' / ');

const canManageMatch = (match: Match, isOrganizer: boolean, loggedInPlayerId?: string) =>
  isOrganizer || matchIncludesPlayer(match, loggedInPlayerId);

const getMasterMatchStatusLabel = (match: SummerRankingMasterMatch) => {
  if (match.status === 'completed') return 'Completata';
  if (!match.player1Id || !match.player2Id) return 'In attesa';
  return 'Da giocare';
};

const PadelIndividualRankingView: React.FC<PadelIndividualRankingViewProps> = ({
  players,
  rankingData,
  isOrganizer,
  loggedInPlayerId,
  onSaveRankingData,
  onOpenPlayersAdmin,
  title,
  description,
  playersAdminLabel,
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('ranking');
  const [matchForm, setMatchForm] = useState<MatchFormState>(() => createInitialMatchForm());
  const [isSavingMatch, setIsSavingMatch] = useState(false);
  const [matchFeedback, setMatchFeedback] = useState<string | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [rulesConfigForm, setRulesConfigForm] = useState<SummerRankingRulesConfig>(() => normalizePadelIndividualRulesConfig(rankingData.rulesConfig ?? DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG));
  const [rulesSettingsError, setRulesSettingsError] = useState<string | null>(null);
  const [rulesSettingsSuccess, setRulesSettingsSuccess] = useState<string | null>(null);
  const [isSavingRulesSettings, setIsSavingRulesSettings] = useState(false);
  const effectiveConfig = useMemo(
    () => normalizePadelIndividualRulesConfig(rankingData.rulesConfig ?? DEFAULT_PADEL_INDIVIDUAL_RULES_CONFIG),
    [rankingData.rulesConfig],
  );
  const pairCount = Math.max(1, Math.floor(effectiveConfig.masterSize / 2));
  const [pairDrafts, setPairDrafts] = useState<MasterPairDraft[]>(() => buildDefaultPairDrafts(pairCount, rankingData.padelIndividualMaster?.pairs));
  const [masterFeedback, setMasterFeedback] = useState<string | null>(null);
  const [masterResultForm, setMasterResultForm] = useState<MasterResultFormState>(() => createInitialMasterResultForm());
  const [isSavingMaster, setIsSavingMaster] = useState(false);
  const [availabilityForm, setAvailabilityForm] = useState<AvailabilityFormState>(() =>
    createAvailabilityFormState(loggedInPlayerId ? rankingData.availabilities?.[loggedInPlayerId] : undefined)
  );
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [isSavingAvailability, setIsSavingAvailability] = useState(false);

  const rankingParticipantIds = useMemo(
    () => Array.isArray(rankingData.participantIds) ? rankingData.participantIds : [],
    [rankingData.participantIds],
  );

  const confirmedPlayers = useMemo(
    () => players
      .filter(player => player.status === 'confirmed' && rankingParticipantIds.includes(player.id))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [players, rankingParticipantIds],
  );

  const playerMap = useMemo(
    () => new Map(confirmedPlayers.map(player => [player.id, player])),
    [confirmedPlayers],
  );

  const ranking = useMemo(
    () => calculatePadelIndividualRanking(confirmedPlayers, rankingData.matches ?? [], effectiveConfig),
    [confirmedPlayers, rankingData.matches, effectiveConfig],
  );

  const matchBreakdowns = useMemo(
    () => calculatePadelIndividualMatchBreakdowns(confirmedPlayers, rankingData.matches ?? [], effectiveConfig),
    [confirmedPlayers, rankingData.matches, effectiveConfig],
  );

  const autoQualifiedIds = useMemo(
    () => getPadelIndividualAutoQualifiedPlayerIds(ranking, effectiveConfig),
    [ranking, effectiveConfig],
  );

  const awards = useMemo(
    () => calculatePadelIndividualAwards(ranking, rankingData.padelIndividualMaster, effectiveConfig),
    [ranking, rankingData.padelIndividualMaster, effectiveConfig],
  );

  const currentRatings = useMemo(
    () => calculatePadelIndividualCurrentRatings(confirmedPlayers, rankingData.matches ?? [], effectiveConfig),
    [confirmedPlayers, rankingData.matches, effectiveConfig],
  );

  const previewRatings = useMemo(
    () => matchForm.editingMatchId
      ? calculatePadelIndividualPreMatchRatings(confirmedPlayers, rankingData.matches ?? [], effectiveConfig, matchForm.editingMatchId)
      : currentRatings,
    [confirmedPlayers, currentRatings, effectiveConfig, matchForm.editingMatchId, rankingData.matches],
  );

  const previewTeam1 = [matchForm.team1Player1Id, matchForm.team1Player2Id].filter(Boolean);
  const previewTeam2 = [matchForm.team2Player1Id, matchForm.team2Player2Id].filter(Boolean);
  const previewInfo = useMemo(
    () => getPadelIndividualPreMatchInfo(previewRatings, previewTeam1, previewTeam2, effectiveConfig),
    [previewRatings, effectiveConfig, previewTeam1.join(':'), previewTeam2.join(':')],
  );

  const visibleMatches = useMemo(
    () => (rankingData.matches ?? [])
      .filter(isPadelIndividualMatch)
      .slice()
      .sort((left, right) => new Date(right.completedAt ?? right.scheduledTime ?? 0).getTime() - new Date(left.completedAt ?? left.scheduledTime ?? 0).getTime()),
    [rankingData.matches],
  );
  const visibleMatchCards = useMemo(
    () =>
      visibleMatches.map(match => {
        const breakdown = matchBreakdowns.get(match.id) ?? null;
        const team1 = getPadelIndividualTeamPlayerIds(match, 1);
        const team2 = getPadelIndividualTeamPlayerIds(match, 2);
        const team1Name = getPairNameByIds(team1, playerMap);
        const team2Name = getPairNameByIds(team2, playerMap);
        const favoriteLabel = breakdown
          ? breakdown.favoriteSide === null
            ? 'Nessuna'
            : breakdown.favoriteSide === 1
              ? team1Name
              : team2Name
          : null;
        return {
          match,
          breakdown,
          team1Name,
          team2Name,
          favoriteLabel,
        };
      }),
    [matchBreakdowns, playerMap, visibleMatches],
  );

  const selectedMatchBreakdown = selectedMatchId ? matchBreakdowns.get(selectedMatchId) ?? null : null;
  const selectedPlayerIds = [matchForm.team1Player1Id, matchForm.team1Player2Id, matchForm.team2Player1Id, matchForm.team2Player2Id];
  const canSubmitMatch = isOrganizer || (
    !!loggedInPlayerId
    && rankingParticipantIds.includes(loggedInPlayerId)
    && selectedPlayerIds.includes(loggedInPlayerId)
  );
  const masterPairs = rankingData.padelIndividualMaster?.pairs ?? [];
  const masterPairMap = useMemo(
    () => new Map(masterPairs.map(pair => [pair.id, pair])),
    [masterPairs],
  );
  const masterMatches = useMemo(
    () => (rankingData.padelIndividualMaster?.matches ?? []).slice().sort((left, right) => left.round - right.round || left.label.localeCompare(right.label)),
    [rankingData.padelIndividualMaster?.matches],
  );
  const currentPlayer = confirmedPlayers.find(player => player.id === loggedInPlayerId);
  const currentPlayerAvailability = loggedInPlayerId ? rankingData.availabilities?.[loggedInPlayerId] : undefined;
  const isLegacyAvailability = !!currentPlayerAvailability && !(currentPlayerAvailability.entries?.length > 0);
  const currentAvailabilitySummary = useMemo(
    () => getAvailabilitySummary(availabilityForm.entries.length > 0 ? { entries: availabilityForm.entries } : undefined),
    [availabilityForm.entries],
  );

  useEffect(() => {
    setRulesConfigForm(effectiveConfig);
  }, [effectiveConfig]);

  useEffect(() => {
    setPairDrafts(buildDefaultPairDrafts(pairCount, rankingData.padelIndividualMaster?.pairs));
  }, [pairCount, rankingData.padelIndividualMaster?.pairs]);

  useEffect(() => {
    setAvailabilityForm(createAvailabilityFormState(loggedInPlayerId ? rankingData.availabilities?.[loggedInPlayerId] : undefined));
  }, [loggedInPlayerId, rankingData.availabilities]);

  const resetMatchForm = () => {
    setMatchForm(createInitialMatchForm());
    setMatchFeedback(null);
  };

  const handleEditMatch = (match: Match) => {
    const team1PlayerIds = getPadelIndividualTeamPlayerIds(match, 1);
    const team2PlayerIds = getPadelIndividualTeamPlayerIds(match, 2);
    setMatchFeedback(null);
    setMatchForm({
      editingMatchId: match.id,
      team1Player1Id: team1PlayerIds[0] ?? '',
      team1Player2Id: team1PlayerIds[1] ?? '',
      team2Player1Id: team2PlayerIds[0] ?? '',
      team2Player2Id: team2PlayerIds[1] ?? '',
      score1: match.score1 !== null ? String(match.score1) : '',
      score2: match.score2 !== null ? String(match.score2) : '',
      completedAt: toDateTimeLocalValue(match.completedAt ?? match.scheduledTime ?? new Date().toISOString()),
      error: null,
    });
    setActiveTab('matches');
  };

  const validateMatchForm = () => {
    const ids = [matchForm.team1Player1Id, matchForm.team1Player2Id, matchForm.team2Player1Id, matchForm.team2Player2Id];
    if (ids.some(id => !id)) return 'Seleziona tutti e 4 i giocatori.';
    if (new Set(ids).size !== 4) return 'I 4 giocatori devono essere tutti diversi.';
    if (ids.some(id => !playerMap.has(id))) return 'Tutti i giocatori devono essere registrati e confermati nell’evento.';
    if (!isOrganizer && (!loggedInPlayerId || !ids.includes(loggedInPlayerId))) {
      return 'Puoi registrare solo partite in cui sei presente.';
    }
    if (!matchForm.score1.trim() || !matchForm.score2.trim()) return 'Inserisci i game di entrambe le coppie.';
    const score1 = Number(matchForm.score1);
    const score2 = Number(matchForm.score2);
    if (!Number.isFinite(score1) || !Number.isFinite(score2) || score1 < 0 || score2 < 0) {
      return 'Inserisci solo numeri validi maggiori o uguali a zero.';
    }
    if (score1 === score2) return 'Nel padel individuale il risultato non può terminare in parità.';
    if (!matchForm.completedAt) return 'Inserisci la data della partita.';
    if (Number.isNaN(new Date(matchForm.completedAt).getTime())) return 'Inserisci una data valida.';
    if (!previewInfo) return 'Completa le due coppie per calcolare la fascia partita.';
    return null;
  };

  const handleSaveMatch = async () => {
    const validationError = validateMatchForm();
    if (validationError) {
      setMatchForm(previous => ({ ...previous, error: validationError }));
      return;
    }

    const nextMatch: Match = {
      id: matchForm.editingMatchId ?? generateId('padel-ranking-match'),
      player1Id: matchForm.team1Player1Id,
      player2Id: matchForm.team2Player1Id,
      team1PlayerIds: [matchForm.team1Player1Id, matchForm.team1Player2Id],
      team2PlayerIds: [matchForm.team2Player1Id, matchForm.team2Player2Id],
      score1: Number(matchForm.score1),
      score2: Number(matchForm.score2),
      status: 'completed',
      completedAt: matchForm.completedAt,
      monthKey: matchForm.completedAt.slice(0, 7),
    };

    setIsSavingMatch(true);
    setMatchFeedback(null);
    setMatchForm(previous => ({ ...previous, error: null }));
    try {
      await onSaveRankingData({
        ...rankingData,
        matches: matchForm.editingMatchId
          ? rankingData.matches.map(match => match.id === matchForm.editingMatchId ? nextMatch : match)
          : [nextMatch, ...rankingData.matches],
      });
      setMatchFeedback(matchForm.editingMatchId ? 'Risultato aggiornato correttamente.' : 'Partita registrata correttamente.');
      resetMatchForm();
    } catch (error) {
      console.error('Errore salvataggio partita ranking padel individuale', error);
      setMatchForm(previous => ({ ...previous, error: 'Salvataggio non riuscito. Riprova.' }));
    } finally {
      setIsSavingMatch(false);
    }
  };

  const handleDeleteMatch = async (match: Match) => {
    if (!isOrganizer) return;
    if (!window.confirm('Eliminare questa partita dal ranking?')) return;
    try {
      await onSaveRankingData({
        ...rankingData,
        matches: rankingData.matches.filter(item => item.id !== match.id),
      });
      setMatchFeedback('Partita eliminata correttamente.');
      if (selectedMatchId === match.id) setSelectedMatchId(null);
      if (matchForm.editingMatchId === match.id) resetMatchForm();
    } catch (error) {
      console.error('Errore eliminazione partita ranking padel individuale', error);
      setMatchFeedback('Eliminazione non riuscita. Riprova.');
    }
  };

  const handleUpdatePairDraft = (draftId: string, field: 'player1Id' | 'player2Id', value: string) => {
    setMasterFeedback(null);
    setPairDrafts(previous => previous.map(draft => draft.id === draftId ? { ...draft, [field]: value } : draft));
  };

  const validateMasterPairs = () => {
    if (effectiveConfig.masterSize % 2 !== 0) {
      return 'La dimensione del Master deve essere un numero pari di giocatori.';
    }
    if (autoQualifiedIds.length < effectiveConfig.masterSize) {
      return `Servono ${effectiveConfig.masterSize} giocatori con almeno ${effectiveConfig.masterMinMatches} partite per generare il Master.`;
    }
    const flatIds = pairDrafts.flatMap(pair => [pair.player1Id, pair.player2Id]).filter(Boolean);
    if (flatIds.length !== effectiveConfig.masterSize) return `Completa tutte le ${pairCount} coppie del Master.`;
    if (new Set(flatIds).size !== effectiveConfig.masterSize) return 'Ogni qualificato può comparire una sola volta nel Master.';
    if (flatIds.some(playerId => !autoQualifiedIds.includes(playerId))) return 'Puoi formare il Master solo con i qualificati correnti.';
    return null;
  };

  const handleGenerateMaster = async () => {
    const validationError = validateMasterPairs();
    if (validationError) {
      setMasterFeedback(validationError);
      return;
    }

    const pairs: SummerRankingMasterPair[] = pairDrafts.map(draft => ({
      id: draft.id.startsWith('pair-draft-') ? generateId('master-pair') : draft.id,
      player1Id: draft.player1Id,
      player2Id: draft.player2Id,
    }));
    const nextMaster = createPadelIndividualMasterData(autoQualifiedIds, pairs, effectiveConfig);
    if (!nextMaster) {
      setMasterFeedback('Impossibile generare il Master con i dati selezionati.');
      return;
    }

    try {
      await onSaveRankingData({
        ...rankingData,
        padelIndividualMaster: nextMaster,
      });
      setMasterFeedback('Master generato correttamente.');
    } catch (error) {
      console.error('Errore generazione Master padel individuale', error);
      setMasterFeedback('Salvataggio Master non riuscito. Riprova.');
    }
  };

  const handleResetMaster = async () => {
    if (!window.confirm('Annullare il Master corrente?')) return;
    try {
      await onSaveRankingData({
        ...rankingData,
        padelIndividualMaster: undefined,
      });
      setPairDrafts(buildDefaultPairDrafts(pairCount));
      setMasterResultForm(createInitialMasterResultForm());
      setMasterFeedback('Master annullato correttamente.');
    } catch (error) {
      console.error('Errore annullamento Master padel individuale', error);
      setMasterFeedback('Operazione non riuscita. Riprova.');
    }
  };

  const openMasterResultEditor = (match: SummerRankingMasterMatch) => {
    setMasterResultForm({
      matchId: match.id,
      score1: match.score1 !== null ? String(match.score1) : '',
      score2: match.score2 !== null ? String(match.score2) : '',
      error: null,
    });
  };

  const handleSaveMasterResult = async (match: SummerRankingMasterMatch) => {
    if (!rankingData.padelIndividualMaster?.matches || !rankingData.padelIndividualMaster.bracket) return;
    const score1 = Number(masterResultForm.score1);
    const score2 = Number(masterResultForm.score2);
    if (!Number.isFinite(score1) || !Number.isFinite(score2) || score1 < 0 || score2 < 0 || score1 === score2) {
      setMasterResultForm(previous => ({ ...previous, error: 'Inserisci un risultato valido senza pareggio.' }));
      return;
    }

    setIsSavingMaster(true);
    setMasterResultForm(previous => ({ ...previous, error: null }));
    try {
      const nextMatches = rankingData.padelIndividualMaster.matches.map(item =>
        item.id === match.id
          ? {
            ...item,
            score1,
            score2,
            status: 'completed' as const,
            completedAt: item.completedAt ?? new Date().toISOString(),
          }
          : item,
      );
      const nextBracket = recomputePadelIndividualMasterBracket({
        ...rankingData.padelIndividualMaster.bracket,
        matches: rankingData.padelIndividualMaster.bracket.matches.map(item =>
          item.id === match.id
            ? { ...item, score1, score2 }
            : item,
        ),
      });

      await onSaveRankingData({
        ...rankingData,
        padelIndividualMaster: {
          ...rankingData.padelIndividualMaster,
          bracket: nextBracket,
          matches: syncPadelIndividualMasterMatches(nextBracket, nextMatches),
        },
      });
      setMasterResultForm(createInitialMasterResultForm());
      setMasterFeedback('Risultato Master salvato correttamente.');
    } catch (error) {
      console.error('Errore salvataggio risultato Master padel individuale', error);
      setMasterResultForm(previous => ({ ...previous, error: 'Salvataggio non riuscito. Riprova.' }));
    } finally {
      setIsSavingMaster(false);
    }
  };

  const handleResetMasterResult = async (match: SummerRankingMasterMatch) => {
    if (!rankingData.padelIndividualMaster?.matches || !rankingData.padelIndividualMaster.bracket) return;
    try {
      const nextMatches = rankingData.padelIndividualMaster.matches.map(item =>
        item.id === match.id
          ? {
            ...item,
            score1: null,
            score2: null,
            status: 'pending' as const,
            completedAt: undefined,
          }
          : item,
      );
      const nextBracket = recomputePadelIndividualMasterBracket({
        ...rankingData.padelIndividualMaster.bracket,
        matches: rankingData.padelIndividualMaster.bracket.matches.map(item =>
          item.id === match.id
            ? { ...item, score1: null, score2: null, winnerId: null }
            : item,
        ),
      });
      await onSaveRankingData({
        ...rankingData,
        padelIndividualMaster: {
          ...rankingData.padelIndividualMaster,
          bracket: nextBracket,
          matches: syncPadelIndividualMasterMatches(nextBracket, nextMatches),
        },
      });
      setMasterFeedback('Risultato Master ripristinato.');
      if (masterResultForm.matchId === match.id) setMasterResultForm(createInitialMasterResultForm());
    } catch (error) {
      console.error('Errore ripristino risultato Master padel individuale', error);
      setMasterFeedback('Ripristino non riuscito. Riprova.');
    }
  };

  const updateRulesConfig = (key: keyof SummerRankingRulesConfig, rawValue: string) => {
    const parsed = Number(rawValue);
    if (!Number.isNaN(parsed)) {
      setRulesConfigForm(previous => ({ ...previous, [key]: parsed }));
    }
    setRulesSettingsError(null);
    setRulesSettingsSuccess(null);
  };

  const toggleRulesConfigFlag = (key: 'participationBonusEnabled' | 'wonGamesBonusEnabled') => {
    setRulesConfigForm(previous => ({ ...previous, [key]: !previous[key] }));
    setRulesSettingsError(null);
    setRulesSettingsSuccess(null);
  };

  const resetRulesSettings = () => {
    setRulesConfigForm(effectiveConfig);
    setRulesSettingsError(null);
    setRulesSettingsSuccess(null);
  };

  const persistAvailabilityEntries = async (entries: AvailabilityFormState['entries']) => {
    if (!currentPlayer) return;
    const nextAvailabilities = { ...(rankingData.availabilities ?? {}) };
    const nextAvailability = buildAvailabilityPayload(entries);

    if (nextAvailability) nextAvailabilities[currentPlayer.id] = nextAvailability;
    else delete nextAvailabilities[currentPlayer.id];

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

    const nextEntry = {
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

  const handleSaveRulesSettings = async () => {
    if (rulesConfigForm.masterSize % 2 !== 0) {
      setRulesSettingsError('La dimensione del Master deve essere un numero pari di giocatori.');
      return;
    }
    if (rulesConfigForm.diffBandMediumMax < rulesConfigForm.diffBandLowMax) {
      setRulesSettingsError('La soglia della fascia media deve essere maggiore o uguale a quella della fascia equilibrata.');
      return;
    }
    setIsSavingRulesSettings(true);
    setRulesSettingsError(null);
    setRulesSettingsSuccess(null);
    try {
      await onSaveRankingData({
        ...rankingData,
        rulesConfig: normalizePadelIndividualRulesConfig(rulesConfigForm),
      });
      setRulesSettingsSuccess('Impostazioni salvate con successo. La classifica è stata aggiornata.');
    } catch (error) {
      console.error('Errore salvataggio impostazioni Paitone Arena League', error);
      setRulesSettingsError('Salvataggio non riuscito. Riprova.');
    } finally {
      setIsSavingRulesSettings(false);
    }
  };

  const hasRulesSettingsChanges = useMemo(
    () => JSON.stringify(normalizePadelIndividualRulesConfig(rulesConfigForm)) !== JSON.stringify(effectiveConfig),
    [effectiveConfig, rulesConfigForm],
  );

  const effectiveRulesText = useMemo(
    () => generatePadelIndividualRulesText(effectiveConfig),
    [effectiveConfig],
  );

  const pairOptions = autoQualifiedIds.map(playerId => playerMap.get(playerId)).filter(Boolean) as Player[];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="bg-secondary rounded-xl shadow-lg p-4 sm:p-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-accent">{title ?? PADEL_INDIVIDUAL_RANKING_NAME}</h2>
            <p className="text-text-secondary mt-1">{description ?? 'Paitone Arena League con partner liberi, bonus e Master finale.'}</p>
          </div>
          <div className="text-sm text-text-secondary">
            {confirmedPlayers.length} partecipanti • {visibleMatches.length} partite registrate
          </div>
        </div>
        <nav className="mt-4 sm:mt-6 bg-primary/60 rounded-lg p-2 sm:p-3 flex flex-wrap gap-1.5 sm:gap-2">
          {([
            ['ranking', 'Ranking'],
            ['matches', 'Partite'],
            ['master', 'Master finale'],
            ['availability', 'Disponibilità'],
            ['rules', 'Regolamento'],
            ...(isOrganizer ? [['settings', 'Impostazioni'] as [ActiveTab, string]] : []),
            ['players', 'Giocatori'],
          ] as Array<[ActiveTab, string]>).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-colors ${activeTab === tab ? 'bg-accent text-white' : 'bg-tertiary hover:bg-tertiary/90 text-text-primary'}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'ranking' && (
        <div className="space-y-4 sm:space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-secondary rounded-xl p-5 shadow-lg">
              <div className="text-sm text-text-secondary">Re del ranking</div>
              <div className="text-xl font-bold mt-2">{awards.rankingKing?.player.name ?? 'Nessuno'}</div>
              <div className="text-accent font-semibold mt-1">{awards.rankingKing?.points ?? 0} pt</div>
            </div>
            <div className="bg-secondary rounded-xl p-5 shadow-lg">
              <div className="text-sm text-text-secondary">Premio fedeltà</div>
              <div className="text-xl font-bold mt-2">{awards.fidelityLeaders.map(entry => entry.player.name).join(', ') || 'Nessuno'}</div>
              <div className="text-text-secondary mt-1">Più partite giocate</div>
            </div>
            <div className="bg-secondary rounded-xl p-5 shadow-lg">
              <div className="text-sm text-text-secondary">Social player</div>
              <div className="text-xl font-bold mt-2">{awards.socialLeaders.map(entry => entry.player.name).join(', ') || 'Nessuno'}</div>
              <div className="text-text-secondary mt-1">Più compagni diversi</div>
            </div>
            <div className="bg-secondary rounded-xl p-5 shadow-lg">
              <div className="text-sm text-text-secondary">Coppia campione</div>
              <div className="text-xl font-bold mt-2">
                {awards.championPair ? getPadelIndividualPairName(awards.championPair, playerMap) : 'Master non concluso'}
              </div>
              <div className="text-text-secondary mt-1">Vincitori della finale Master</div>
            </div>
          </div>

          <div className="bg-secondary rounded-xl shadow-lg p-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-text-secondary border-b border-tertiary/50">
                  <th className="py-3 pr-3">#</th>
                  <th className="py-3 pr-3">Giocatore</th>
                  <th className="py-3 pr-3">Punti</th>
                  <th className="py-3 pr-3">Partite</th>
                  <th className="py-3 pr-3">Vittorie</th>
                  <th className="py-3 pr-3">Bonus partecipazione</th>
                  <th className="py-3 pr-3">Bonus game</th>
                  <th className="py-3 pr-3">Compagni diversi</th>
                  <th className="py-3">Master</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map(entry => (
                  <tr key={entry.player.id} className="border-b border-tertiary/20 last:border-0">
                    <td className="py-3 pr-3 font-semibold">{entry.rank}</td>
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-text-primary">{entry.player.name}</div>
                      <div className="text-xs text-text-secondary">Start {entry.startingPoints} pt</div>
                    </td>
                    <td className="py-3 pr-3 font-bold text-accent">{entry.points}</td>
                    <td className="py-3 pr-3">{entry.matchesPlayed}</td>
                    <td className="py-3 pr-3">{entry.wins}</td>
                    <td className="py-3 pr-3">+{entry.participationBonus}</td>
                    <td className="py-3 pr-3">+{entry.wonGamesBonus}</td>
                    <td className="py-3 pr-3">{entry.distinctPartners}</td>
                    <td className="py-3">
                      {entry.qualifiedForMaster ? (
                        <span className="inline-flex rounded-full bg-green-500/15 text-green-200 px-2.5 py-1 text-xs font-semibold border border-green-400/30">Qualificato</span>
                      ) : entry.eligibleForMaster ? (
                        <span className="inline-flex rounded-full bg-yellow-500/15 text-yellow-100 px-2.5 py-1 text-xs font-semibold border border-yellow-400/30">In corsa</span>
                      ) : (
                        <span className="inline-flex rounded-full bg-tertiary text-text-secondary px-2.5 py-1 text-xs font-semibold">Minimo {effectiveConfig.masterMinMatches} partite</span>
                      )}
                    </td>
                  </tr>
                ))}
                {ranking.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-text-secondary">Nessun partecipante confermato nel ranking.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'matches' && (
        <div className="space-y-4 sm:space-y-6">
          <div className="bg-secondary rounded-xl shadow-lg p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-lg font-bold text-accent">Registra partita</h3>
                <p className="text-sm text-text-secondary">Scegli 4 giocatori distinti, inserisci i game e verifica fascia e coppia favorita prima del salvataggio.</p>
              </div>
              {matchForm.editingMatchId && (
                <button onClick={resetMatchForm} className="px-3 py-2 rounded bg-tertiary text-text-primary text-sm font-semibold">Nuova partita</button>
              )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Coppia 1</div>
                    <select value={matchForm.team1Player1Id} onChange={event => setMatchForm(previous => ({ ...previous, team1Player1Id: event.target.value, error: null }))} className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary">
                      <option value="">Seleziona giocatore</option>
                      {confirmedPlayers.map(player => <option key={`t1a-${player.id}`} value={player.id}>{player.name}</option>)}
                    </select>
                    <select value={matchForm.team1Player2Id} onChange={event => setMatchForm(previous => ({ ...previous, team1Player2Id: event.target.value, error: null }))} className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary">
                      <option value="">Seleziona compagno</option>
                      {confirmedPlayers.map(player => <option key={`t1b-${player.id}`} value={player.id}>{player.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Coppia 2</div>
                    <select value={matchForm.team2Player1Id} onChange={event => setMatchForm(previous => ({ ...previous, team2Player1Id: event.target.value, error: null }))} className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary">
                      <option value="">Seleziona giocatore</option>
                      {confirmedPlayers.map(player => <option key={`t2a-${player.id}`} value={player.id}>{player.name}</option>)}
                    </select>
                    <select value={matchForm.team2Player2Id} onChange={event => setMatchForm(previous => ({ ...previous, team2Player2Id: event.target.value, error: null }))} className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary">
                      <option value="">Seleziona compagno</option>
                      {confirmedPlayers.map(player => <option key={`t2b-${player.id}`} value={player.id}>{player.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">Game coppia 1</label>
                    <input type="number" min="0" value={matchForm.score1} onChange={event => setMatchForm(previous => ({ ...previous, score1: event.target.value, error: null }))} className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">Game coppia 2</label>
                    <input type="number" min="0" value={matchForm.score2} onChange={event => setMatchForm(previous => ({ ...previous, score2: event.target.value, error: null }))} className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">Data partita</label>
                    <input type="datetime-local" value={matchForm.completedAt} onChange={event => setMatchForm(previous => ({ ...previous, completedAt: event.target.value, error: null }))} className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary" />
                  </div>
                </div>

                {matchForm.error && <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{matchForm.error}</div>}
                {matchFeedback && <div className="rounded-lg border border-green-400/30 bg-green-500/10 px-3 py-2 text-sm text-green-200">{matchFeedback}</div>}

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleSaveMatch}
                    disabled={isSavingMatch || !canSubmitMatch}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded bg-accent text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <PlusIcon className="w-4 h-4" />
                    {matchForm.editingMatchId ? 'Aggiorna partita' : 'Salva partita'}
                  </button>
                  {!canSubmitMatch && (
                    <span className="text-sm text-text-secondary">Accedi come organizzatore o come giocatore iscritto per registrare una partita.</span>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-tertiary/40 bg-primary/30 p-4 space-y-3">
                <div className="text-sm font-semibold text-text-secondary uppercase tracking-wide">Anteprima fascia</div>
                {previewInfo ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${getPadelIndividualBandTone(previewInfo.band)}`}>{getPadelIndividualBandLabel(previewInfo.band)}</span>
                      <span className="inline-flex rounded-full border border-tertiary px-3 py-1 text-sm font-semibold text-text-primary">Differenza {previewInfo.difference} pt</span>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div>
                        <div className="text-text-secondary">Coppia 1</div>
                        <div className="font-semibold text-text-primary">{getPairNameByIds(previewTeam1, playerMap)}</div>
                        <div className="text-accent">Totale pre-partita: {previewInfo.team1Total} pt</div>
                      </div>
                      <div>
                        <div className="text-text-secondary">Coppia 2</div>
                        <div className="font-semibold text-text-primary">{getPairNameByIds(previewTeam2, playerMap)}</div>
                        <div className="text-accent">Totale pre-partita: {previewInfo.team2Total} pt</div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-tertiary/40 bg-secondary/60 px-3 py-2 text-sm text-text-primary">
                      <span className="text-text-secondary">Favorita:</span> {getPadelIndividualFavoritePairText(previewInfo, previewTeam1, previewTeam2, playerMap)}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-text-secondary">Seleziona le due coppie per vedere fascia, differenza e pronostico pre-partita.</div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-secondary rounded-xl shadow-lg p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-lg font-bold text-accent">Storico partite</h3>
                <p className="text-sm text-text-secondary">Ogni totale viene ricalcolato in modo deterministico a partire dai punteggi iniziali e dallo storico completo.</p>
              </div>
              {selectedMatchBreakdown && (
                <button onClick={() => setSelectedMatchId(null)} className="px-3 py-2 rounded bg-tertiary text-text-primary text-sm font-semibold">Chiudi dettaglio punti</button>
              )}
            </div>

            <div className="space-y-3">
              {visibleMatchCards.map(({ match, breakdown, team1Name, team2Name, favoriteLabel }) => {
                return (
                  <div key={match.id} className="rounded-xl border border-tertiary/40 bg-primary/30 p-4 space-y-3">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                      <div>
                        <div className="font-semibold text-text-primary">{team1Name} vs {team2Name}</div>
                        <div className="text-sm text-text-secondary mt-1">{formatDateTime(match.completedAt)}</div>
                        <div className="text-sm font-semibold text-accent mt-1">{match.score1} - {match.score2}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {breakdown && (
                          <button onClick={() => setSelectedMatchId(match.id)} className="px-3 py-1 rounded bg-accent text-white text-xs font-semibold">Dettaglio punti</button>
                        )}
                        {canManageMatch(match, isOrganizer, loggedInPlayerId) && (
                          <button onClick={() => handleEditMatch(match)} className="px-3 py-1 rounded bg-tertiary text-text-primary text-xs font-semibold">Modifica</button>
                        )}
                        {isOrganizer && (
                          <button onClick={() => handleDeleteMatch(match)} className="px-3 py-1 rounded bg-red-600 text-white text-xs font-semibold">Elimina</button>
                        )}
                      </div>
                    </div>
                    {breakdown && (
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 font-semibold ${getPadelIndividualBandTone(breakdown.band)}`}>{getPadelIndividualBandLabel(breakdown.band)}</span>
                        <span className="inline-flex rounded-full border border-tertiary px-2.5 py-1 font-semibold text-text-primary">Favorita: {favoriteLabel ?? 'Nessuna'}</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {visibleMatches.length === 0 && <div className="text-sm text-text-secondary">Nessuna partita registrata.</div>}
            </div>

            {selectedMatchBreakdown && (
              <div className="rounded-xl border border-tertiary/40 bg-primary/30 p-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-text-secondary border-b border-tertiary/50">
                      <th className="py-2 pr-3">Giocatore</th>
                      <th className="py-2 pr-3">Esito</th>
                      <th className="py-2 pr-3">Risultato</th>
                      <th className="py-2 pr-3">Partecipazione</th>
                      <th className="py-2 pr-3">Game</th>
                      <th className="py-2">Totale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedMatchBreakdown.players.map(playerBreakdown => (
                      <tr key={`${selectedMatchBreakdown.matchId}-${playerBreakdown.playerId}`} className="border-b border-tertiary/20 last:border-0">
                        <td className="py-2 pr-3 font-semibold text-text-primary">{playerMap.get(playerBreakdown.playerId)?.name ?? playerBreakdown.playerId}</td>
                        <td className="py-2 pr-3">{playerBreakdown.outcome === 'win' ? 'Vittoria' : 'Sconfitta'}</td>
                        <td className="py-2 pr-3">{playerBreakdown.resultPoints > 0 ? '+' : ''}{playerBreakdown.resultPoints}</td>
                        <td className="py-2 pr-3">+{playerBreakdown.participationPoints}</td>
                        <td className="py-2 pr-3">+{playerBreakdown.wonGamesPoints}</td>
                        <td className="py-2 font-bold text-accent">{playerBreakdown.totalPoints > 0 ? '+' : ''}{playerBreakdown.totalPoints}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'master' && (
        <div className="space-y-4 sm:space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-secondary rounded-xl p-5 shadow-lg">
              <div className="text-sm text-text-secondary">Qualificati automatici</div>
              <div className="text-xl font-bold mt-2">{autoQualifiedIds.length}/{effectiveConfig.masterSize}</div>
              <div className="text-text-secondary mt-1">Solo chi ha almeno {effectiveConfig.masterMinMatches} partite.</div>
            </div>
            <div className="bg-secondary rounded-xl p-5 shadow-lg">
              <div className="text-sm text-text-secondary">Coppie Master</div>
              <div className="text-xl font-bold mt-2">{masterPairs.length}/{pairCount}</div>
              <div className="text-text-secondary mt-1">Formazione manuale dell’organizzazione.</div>
            </div>
            <div className="bg-secondary rounded-xl p-5 shadow-lg">
              <div className="text-sm text-text-secondary">Stato tabellone</div>
              <div className="text-xl font-bold mt-2">{masterMatches.length > 0 ? 'Generato' : 'Da generare'}</div>
              <div className="text-text-secondary mt-1">Quarter, semifinali e finale a coppie.</div>
            </div>
          </div>

          <div className="bg-secondary rounded-xl shadow-lg p-5 space-y-4">
            <div>
              <h3 className="text-lg font-bold text-accent">Giocatori qualificati al Master</h3>
              <p className="text-sm text-text-secondary">Top {effectiveConfig.masterSize} con almeno {effectiveConfig.masterMinMatches} partite giocate.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {autoQualifiedIds.map(playerId => {
                const player = playerMap.get(playerId);
                const rankingEntry = ranking.find(entry => entry.player.id === playerId);
                return (
                  <div key={playerId} className="rounded-lg border border-green-400/30 bg-green-500/10 p-3">
                    <div className="font-semibold text-text-primary">{player?.name ?? playerId}</div>
                    <div className="text-sm text-text-secondary">#{rankingEntry?.rank ?? '—'} • {rankingEntry?.matchesPlayed ?? 0} partite • {rankingEntry?.points ?? 0} pt</div>
                  </div>
                );
              })}
              {autoQualifiedIds.length === 0 && <div className="text-sm text-text-secondary">Nessun giocatore ha ancora i requisiti minimi per il Master.</div>}
            </div>
          </div>

          {isOrganizer && (
            <div className="bg-secondary rounded-xl shadow-lg p-5 space-y-4">
              <div>
                <h3 className="text-lg font-bold text-accent">Forma le coppie del Master</h3>
                <p className="text-sm text-text-secondary">Seleziona manualmente le coppie usando solo i qualificati correnti.</p>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {pairDrafts.map((draft, index) => (
                  <div key={draft.id} className="rounded-xl border border-tertiary/40 bg-primary/30 p-4 space-y-3">
                    <div className="text-sm font-semibold text-text-secondary">Coppia Master {index + 1}</div>
                    <select value={draft.player1Id} onChange={event => handleUpdatePairDraft(draft.id, 'player1Id', event.target.value)} className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary">
                      <option value="">Seleziona giocatore</option>
                      {pairOptions.map(player => <option key={`${draft.id}-p1-${player.id}`} value={player.id}>{player.name}</option>)}
                    </select>
                    <select value={draft.player2Id} onChange={event => handleUpdatePairDraft(draft.id, 'player2Id', event.target.value)} className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary">
                      <option value="">Seleziona compagno</option>
                      {pairOptions.map(player => <option key={`${draft.id}-p2-${player.id}`} value={player.id}>{player.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {masterFeedback && <div className="rounded-lg border border-tertiary/40 bg-primary/30 px-3 py-2 text-sm text-text-primary">{masterFeedback}</div>}
              <div className="flex flex-wrap gap-3">
                <button onClick={handleGenerateMaster} className="px-4 py-2 rounded bg-accent text-white font-semibold">Genera Master</button>
                {rankingData.padelIndividualMaster && <button onClick={handleResetMaster} className="px-4 py-2 rounded bg-red-600 text-white font-semibold">Annulla Master</button>}
              </div>
            </div>
          )}

          {masterMatches.length > 0 && (
            <div className="bg-secondary rounded-xl shadow-lg p-5 space-y-4">
              <div>
                <h3 className="text-lg font-bold text-accent">Tabellone Master</h3>
                <p className="text-sm text-text-secondary">La coppia campione corrisponde ai vincitori della finale Master.</p>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {masterMatches.map(match => {
                  const pair1 = match.player1Id ? masterPairMap.get(match.player1Id) : undefined;
                  const pair2 = match.player2Id ? masterPairMap.get(match.player2Id) : undefined;
                  return (
                    <div key={match.id} className="rounded-xl border border-tertiary/40 bg-primary/30 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{match.label}</div>
                          <div className="font-semibold text-text-primary mt-1">{pair1 ? getPadelIndividualPairName(pair1, playerMap) : 'Da definire'} vs {pair2 ? getPadelIndividualPairName(pair2, playerMap) : 'Da definire'}</div>
                        </div>
                        <span className="inline-flex rounded-full bg-tertiary px-2.5 py-1 text-xs font-semibold text-text-primary">{getMasterMatchStatusLabel(match)}</span>
                      </div>
                      {match.score1 !== null && match.score2 !== null && <div className="text-lg font-bold text-accent">{match.score1} - {match.score2}</div>}
                      {isOrganizer && pair1 && pair2 && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <input type="number" min="0" value={masterResultForm.matchId === match.id ? masterResultForm.score1 : (match.score1 ?? '')} onChange={event => setMasterResultForm({ matchId: match.id, score1: event.target.value, score2: masterResultForm.matchId === match.id ? masterResultForm.score2 : String(match.score2 ?? ''), error: null })} className="bg-primary border border-tertiary rounded-lg p-2 text-text-primary" />
                            <input type="number" min="0" value={masterResultForm.matchId === match.id ? masterResultForm.score2 : (match.score2 ?? '')} onChange={event => setMasterResultForm({ matchId: match.id, score1: masterResultForm.matchId === match.id ? masterResultForm.score1 : String(match.score1 ?? ''), score2: event.target.value, error: null })} className="bg-primary border border-tertiary rounded-lg p-2 text-text-primary" />
                          </div>
                          {masterResultForm.matchId === match.id && masterResultForm.error && <div className="text-sm text-red-200">{masterResultForm.error}</div>}
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => openMasterResultEditor(match)} className="px-3 py-1 rounded bg-tertiary text-text-primary text-xs font-semibold">Carica risultato attuale</button>
                            <button onClick={() => handleSaveMasterResult(match)} disabled={isSavingMaster} className="px-3 py-1 rounded bg-accent text-white text-xs font-semibold disabled:opacity-50">Salva risultato</button>
                            {match.status === 'completed' && <button onClick={() => handleResetMasterResult(match)} className="px-3 py-1 rounded bg-red-600 text-white text-xs font-semibold">Ripristina</button>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'availability' && (
        <div className="space-y-6">
          <div className="bg-secondary rounded-xl shadow-lg p-5 space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-lg font-bold text-accent">Disponibilità utente</h3>
                <p className="text-sm text-text-secondary">Usa lo stesso modello disponibilità della Summer Ranking per indicare giorni e fasce orarie.</p>
              </div>
              {currentPlayerAvailability?.updatedAt && availabilityForm.entries.length > 0 && (
                <div className="text-xs text-text-secondary">Ultimo aggiornamento: {formatDateTime(currentPlayerAvailability.updatedAt)}</div>
              )}
            </div>

            {currentPlayer ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-tertiary bg-primary/40 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">Disponibilità dichiarate</div>
                      <p className="mt-1 text-xs text-text-secondary">Crea più disponibilità separate e gestiscile una per una.</p>
                    </div>
                    <button
                      onClick={() => {
                        setAvailabilityError(null);
                        setAvailabilityForm(previous => ({
                          ...previous,
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
                      È stata rilevata una disponibilità nel formato precedente: la trovi già convertita nel nuovo elenco e puoi modificarla liberamente.
                    </div>
                  )}

                  {availabilityError && (
                    <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                      {availabilityError}
                    </div>
                  )}

                  {availabilityForm.isEditorOpen && (
                    <div className="mt-4 rounded-xl border border-tertiary bg-secondary p-4">
                      <div className="text-sm font-semibold text-text-primary">
                        {availabilityForm.editingEntryId ? 'Modifica disponibilità' : 'Nuova disponibilità'}
                      </div>
                      <div className="mt-4">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Stato</div>
                        <div className="flex flex-wrap gap-2">
                          {([
                            ['available', 'Disponibile'],
                            ['unavailable', 'Non disponibile'],
                          ] as const).map(([value, label]) => (
                            <button
                              type="button"
                              aria-pressed={availabilityForm.draft.status === value}
                              key={value}
                              onClick={() => setAvailabilityForm(previous => ({
                                ...previous,
                                draft: {
                                  ...previous.draft,
                                  status: value,
                                  periods: value === 'available' ? previous.draft.periods : [],
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
                          {AVAILABILITY_DAYS.map(day => (
                            <button
                              type="button"
                              aria-pressed={availabilityForm.draft.days.includes(day.value)}
                              key={day.value}
                              onClick={() => setAvailabilityForm(previous => ({
                                ...previous,
                                draft: {
                                  ...previous.draft,
                                  days: toggleArrayValue(previous.draft.days, day.value),
                                },
                              }))}
                              className={`rounded-lg border px-3 py-2 text-sm ${
                                availabilityForm.draft.days.includes(day.value)
                                  ? 'border-highlight bg-highlight text-white'
                                  : 'border-tertiary bg-primary text-text-primary'
                              }`}
                            >
                              {day.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {availabilityForm.draft.status === 'available' ? (
                        <div className="mt-4">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Fasce orarie</div>
                          <div className="flex flex-wrap gap-2">
                            {AVAILABILITY_PERIODS.map(period => (
                              <button
                                type="button"
                                aria-pressed={availabilityForm.draft.periods.includes(period.value)}
                                key={period.value}
                                onClick={() => setAvailabilityForm(previous => ({
                                  ...previous,
                                  draft: {
                                    ...previous.draft,
                                    periods: toggleArrayValue(previous.draft.periods, period.value),
                                  },
                                }))}
                                className={`rounded-lg border px-3 py-2 text-sm ${
                                  availabilityForm.draft.periods.includes(period.value)
                                    ? 'border-highlight bg-highlight text-white'
                                    : 'border-tertiary bg-primary text-text-primary'
                                }`}
                              >
                                {period.label}
                              </button>
                            ))}
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
                          onClick={() => setAvailabilityForm(previous => ({ ...previous, draft: createEmptyAvailabilityDraft() }))}
                          disabled={isSavingAvailability}
                          className="rounded-lg bg-tertiary px-4 py-2 text-sm font-semibold text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Ripristina
                        </button>
                        <button
                          onClick={() => {
                            setAvailabilityError(null);
                            setAvailabilityForm(previous => ({
                              ...previous,
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
                              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${
                                entry.status === 'available'
                                  ? 'bg-green-500/15 text-green-300 border border-green-500/30'
                                  : 'bg-red-500/15 text-red-300 border border-red-500/30'
                              }`}>
                                {entry.status === 'available' ? 'Disponibile' : 'Non disponibile'}
                              </span>
                              <div className="text-sm font-semibold text-text-primary">{formatAvailabilityDays(entry.days)}</div>
                              {entry.status === 'available' && (
                                <div className="text-xs text-text-secondary">{formatAvailabilityPeriods(entry.periods ?? [])}</div>
                              )}
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => {
                                  setAvailabilityError(null);
                                  setAvailabilityForm(previous => ({
                                    ...previous,
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
                  <button
                    aria-label="Elimina tutte le disponibilità dichiarate del tuo profilo"
                    onClick={handleClearAvailabilityEntries}
                    disabled={isSavingAvailability}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Elimina tutte le disponibilità dichiarate
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-tertiary bg-primary p-4 text-text-secondary">
                Accedi con un profilo giocatore confermato per impostare la disponibilità.
              </div>
            )}
          </div>

          <div className="bg-secondary rounded-xl shadow-lg p-5">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-accent">Disponibilità partecipanti</h3>
              <p className="text-sm text-text-secondary">Gli organizzatori possono consultare e gestire la disponibilità secondo il modello già usato nel ranking estivo.</p>
            </div>
            <div className="space-y-3">
              {ranking.map(entry => {
                const availabilitySummary = getAvailabilitySummary(rankingData.availabilities?.[entry.player.id]);
                const normalizedEntries = normalizeAvailabilityEntries(rankingData.availabilities?.[entry.player.id]);
                return (
                  <div key={entry.player.id} className="rounded-xl border border-tertiary/40 bg-primary/30 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="font-semibold text-text-primary">{entry.player.name}</div>
                        <div className="text-sm text-text-secondary">{availabilitySummary.status}</div>
                      </div>
                      {availabilitySummary.details && (
                        <div className="text-sm text-text-secondary">{availabilitySummary.details}</div>
                      )}
                    </div>
                    {isOrganizer && normalizedEntries.length > 1 && (
                      <div className="mt-3 space-y-2 text-xs text-text-secondary">
                        {normalizedEntries.map(item => (
                          <div key={item.id}>
                            <span className="font-semibold text-text-primary">{item.status === 'available' ? 'Disponibile' : 'Non disponibile'}:</span>{' '}
                            {formatAvailabilityDays(item.days)}
                            {item.status === 'available' && item.periods?.length ? ` • ${formatAvailabilityPeriods(item.periods)}` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {ranking.length === 0 && <div className="text-sm text-text-secondary">Nessun partecipante confermato nell’evento.</div>}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'settings' && isOrganizer && (
        <div className="bg-secondary rounded-xl shadow-lg p-5 space-y-5">
          <div>
            <h3 className="text-lg font-bold text-accent">Impostazioni Paitone Arena League</h3>
            <p className="text-sm text-text-secondary">Personalizza punti, fasce, bonus e requisiti Master mantenendo i default ufficiali come base.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1 text-sm">
              <span className="text-text-secondary">Fascia equilibrata fino a</span>
              <input type="number" min="0" value={rulesConfigForm.diffBandLowMax} onChange={event => updateRulesConfig('diffBandLowMax', event.target.value)} className="w-full bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-text-secondary">Fascia media fino a</span>
              <input type="number" min="0" value={rulesConfigForm.diffBandMediumMax} onChange={event => updateRulesConfig('diffBandMediumMax', event.target.value)} className="w-full bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
            </label>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border border-tertiary/40 bg-primary/30 p-4 space-y-3">
              <div className="text-sm font-semibold text-text-primary">Punti coppia favorita</div>
              {([
                ['favoriteWinLow', 'Vittoria equilibrata'],
                ['favoriteLossLow', 'Sconfitta equilibrata'],
                ['favoriteWinMedium', 'Vittoria differenza media'],
                ['favoriteLossMedium', 'Sconfitta differenza media'],
                ['favoriteWinHigh', 'Vittoria differenza alta'],
                ['favoriteLossHigh', 'Sconfitta differenza alta'],
              ] as Array<[keyof SummerRankingRulesConfig, string]>).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-text-secondary">{label}</span>
                  <input type="number" value={rulesConfigForm[key] as number} onChange={event => updateRulesConfig(key, event.target.value)} className="w-28 bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
                </label>
              ))}
            </div>

            <div className="rounded-xl border border-tertiary/40 bg-primary/30 p-4 space-y-3">
              <div className="text-sm font-semibold text-text-primary">Punti coppia sfavorita</div>
              {([
                ['underdogWinLow', 'Vittoria equilibrata'],
                ['underdogLossLow', 'Sconfitta equilibrata'],
                ['underdogWinMedium', 'Vittoria differenza media'],
                ['underdogLossMedium', 'Sconfitta differenza media'],
                ['underdogWinHigh', 'Vittoria differenza alta'],
                ['underdogLossHigh', 'Sconfitta differenza alta'],
              ] as Array<[keyof SummerRankingRulesConfig, string]>).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-text-secondary">{label}</span>
                  <input type="number" value={rulesConfigForm[key] as number} onChange={event => updateRulesConfig(key, event.target.value)} className="w-28 bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border border-tertiary/40 bg-primary/30 p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-text-primary">Bonus partecipazione</div>
                  <div className="text-xs text-text-secondary">Punti a presenza e limite mensile.</div>
                </div>
                <button type="button" aria-pressed={rulesConfigForm.participationBonusEnabled} onClick={() => toggleRulesConfigFlag('participationBonusEnabled')} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${rulesConfigForm.participationBonusEnabled ? 'bg-accent' : 'bg-tertiary'}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${rulesConfigForm.participationBonusEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 ${rulesConfigForm.participationBonusEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
                <label className="space-y-1 text-sm">
                  <span className="text-text-secondary">Punti per partita</span>
                  <input type="number" value={rulesConfigForm.participationBase} onChange={event => updateRulesConfig('participationBase', event.target.value)} className="w-full bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-text-secondary">Cap mensile</span>
                  <input type="number" min="0" value={rulesConfigForm.participationMonthlyCap} onChange={event => updateRulesConfig('participationMonthlyCap', event.target.value)} className="w-full bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-tertiary/40 bg-primary/30 p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-text-primary">Bonus game</div>
                  <div className="text-xs text-text-secondary">Punti per game vinto e massimo per partita.</div>
                </div>
                <button type="button" aria-pressed={rulesConfigForm.wonGamesBonusEnabled} onClick={() => toggleRulesConfigFlag('wonGamesBonusEnabled')} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${rulesConfigForm.wonGamesBonusEnabled ? 'bg-accent' : 'bg-tertiary'}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${rulesConfigForm.wonGamesBonusEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 ${rulesConfigForm.wonGamesBonusEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
                <label className="space-y-1 text-sm">
                  <span className="text-text-secondary">Punti per game</span>
                  <input type="number" min="0" value={rulesConfigForm.wonGamesMultiplier} onChange={event => updateRulesConfig('wonGamesMultiplier', event.target.value)} className="w-full bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-text-secondary">Cap per partita</span>
                  <input type="number" min="0" value={rulesConfigForm.wonGamesCap} onChange={event => updateRulesConfig('wonGamesCap', event.target.value)} className="w-full bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
                </label>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1 text-sm">
              <span className="text-text-secondary">Giocatori qualificati al Master</span>
              <input type="number" min="2" step="2" value={rulesConfigForm.masterSize} onChange={event => updateRulesConfig('masterSize', event.target.value)} className="w-full bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-text-secondary">Partite minime per qualificazione</span>
              <input type="number" min="1" value={rulesConfigForm.masterMinMatches} onChange={event => updateRulesConfig('masterMinMatches', event.target.value)} className="w-full bg-primary border border-tertiary rounded-lg px-3 py-2 text-text-primary" />
            </label>
          </div>

          <div className="rounded-xl border border-tertiary/40 bg-primary/30 p-4">
            <div className="text-sm font-semibold text-text-primary mb-2">Anteprima regolamento aggiornato</div>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-text-primary">{generatePadelIndividualRulesText(rulesConfigForm)}</pre>
          </div>

          {rulesSettingsError && <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{rulesSettingsError}</div>}
          {rulesSettingsSuccess && <div className="rounded-lg border border-green-400/30 bg-green-500/10 px-3 py-2 text-sm text-green-200">{rulesSettingsSuccess}</div>}

          <div className="flex flex-wrap gap-3">
            <button onClick={handleSaveRulesSettings} disabled={isSavingRulesSettings || !hasRulesSettingsChanges} className="px-4 py-2 rounded bg-highlight text-white font-semibold disabled:opacity-60 disabled:cursor-not-allowed">
              {isSavingRulesSettings ? 'Salvataggio...' : 'Salva impostazioni'}
            </button>
            <button onClick={resetRulesSettings} disabled={isSavingRulesSettings || !hasRulesSettingsChanges} className="px-4 py-2 rounded bg-tertiary text-text-primary font-semibold disabled:opacity-60 disabled:cursor-not-allowed">
              Ripristina
            </button>
          </div>
        </div>
      )}

      {activeTab === 'rules' && (
        <div className="bg-secondary rounded-xl shadow-lg p-5 space-y-4">
          <div>
            <h3 className="text-lg font-bold text-accent">Regole Paitone Arena League</h3>
            <p className="text-sm text-text-secondary">Testo promozionale e regole operative sempre allineate alla configurazione Paitone salvata.</p>
          </div>
          <div className="rounded-xl border border-tertiary/40 bg-primary/30 p-4">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-text-primary">{effectiveRulesText || DEFAULT_PADEL_INDIVIDUAL_RULES}</pre>
          </div>
        </div>
      )}

      {activeTab === 'players' && (
        <div className="bg-secondary rounded-xl shadow-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-accent">Partecipanti e punti iniziali</h3>
              <p className="text-sm text-text-secondary">Ogni giocatore parte dal punteggio assegnato dall’organizzazione.</p>
            </div>
            {isOrganizer && onOpenPlayersAdmin && (
              <button onClick={onOpenPlayersAdmin} className="px-4 py-2 rounded bg-accent text-white font-semibold">{playersAdminLabel ?? 'Gestisci giocatori'}</button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {confirmedPlayers.map(player => (
              <div key={player.id} className="rounded-xl border border-tertiary/40 bg-primary/30 p-4">
                <div className="font-semibold text-text-primary">{player.name}</div>
                <div className="text-sm text-text-secondary mt-1">Punteggio iniziale: {player.summerRankingStartPoints ?? 0} pt</div>
                <div className="text-sm text-text-secondary">Partite giocate: {ranking.find(entry => entry.player.id === player.id)?.matchesPlayed ?? 0}</div>
              </div>
            ))}
            {confirmedPlayers.length === 0 && <div className="text-sm text-text-secondary">Nessun giocatore confermato nell’evento.</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default PadelIndividualRankingView;
