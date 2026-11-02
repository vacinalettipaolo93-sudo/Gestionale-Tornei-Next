// components/TournamentView.tsx
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  type Event,
  type Tournament,
  type Match,
  type TimeSlot,
  type Player,
  type PlayoffBracket,
  type PlayoffMatch,
  type Group
} from '../types';
import StandingsTable from './StandingsTable';
import MatchList from './MatchList';
import ParticipantsTab from './ParticipantsTab';
import GroupManagement from './GroupManagement';
import TournamentSettings from './TournamentSettings';
import Playoffs from './Playoffs';
import ConsolationBracket from './ConsolationBracket';
import PlayerManagement from './PlayerManagement';
import AvailabilityTab from './AvailabilityTab';
import { TournamentMatchFinder } from './MatchFinder';
import { db } from "../firebase";
import { updateDoc, doc } from "firebase/firestore";
import { getCompetitorName, getTeamForPlayer, getTournamentCompetitors, getTournamentPadelTeams, isPadelEvent } from '../utils/padel';

interface TournamentViewProps {
  event: Event;
  tournament: Tournament;
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  isOrganizer: boolean;
  loggedInPlayerId?: string;
  initialActiveTab?: 'standings' | 'matches' | 'participants' | 'playoffs' | 'consolation' | 'groups' | 'settings' | 'rules' | 'players' | 'availability';
  initialSelectedGroupId?: string;
  onPlayerContact?: (player: Player | { phone?: string }) => void;
}

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

// --- ID helpers ---
function isPlayoffLeagueMatchId(matchId: string) {
  return matchId.startsWith('po-');
}
function isConsolationLeagueMatchId(matchId: string) {
  return matchId.startsWith('co-');
}
function stripPrefix(matchId: string, prefix: string) {
  return matchId.startsWith(prefix) ? matchId.slice(prefix.length) : matchId;
}

// --- Bracket helpers ---
function computeWinnerIdFromScores(match: { player1Id: string | null; player2Id: string | null }, s1: number, s2: number) {
  if (!match.player1Id || !match.player2Id) return null;
  if (s1 === s2) return null;
  return s1 > s2 ? match.player1Id : match.player2Id;
}

function buildBracketCopyWithResultAndAdvance(params: {
  bracket: PlayoffBracket;
  playoffMatchId: string;
  score1: number;
  score2: number;
  hasBronzeFinal: boolean;
}) {
  const { bracket, playoffMatchId, score1, score2, hasBronzeFinal } = params;

  const bracketCopy: PlayoffBracket = JSON.parse(JSON.stringify(bracket));
  const match = bracketCopy.matches.find((m: PlayoffMatch) => m.id === playoffMatchId);
  if (!match) return { bracketCopy, updatedMatch: null as PlayoffMatch | null };

  match.score1 = score1;
  match.score2 = score2;

  const winnerId = computeWinnerIdFromScores({ player1Id: match.player1Id, player2Id: match.player2Id }, score1, score2);
  if (!winnerId) return { bracketCopy, updatedMatch: match };

  const loserId = winnerId === match.player1Id ? match.player2Id : match.player1Id;
  match.winnerId = winnerId;

  if (match.nextMatchId) {
    const nextMatch = bracketCopy.matches.find((m: PlayoffMatch) => m.id === match.nextMatchId);
    if (nextMatch) {
      const allMatchesInRound = bracketCopy.matches
        .filter((m: PlayoffMatch) => m.round === match.round && !m.isBronzeFinal)
        .sort((a: PlayoffMatch, b: PlayoffMatch) => a.matchIndex - b.matchIndex);

      const matchIndexInRound = allMatchesInRound.findIndex((m: PlayoffMatch) => m.id === match.id);

      if (matchIndexInRound % 2 === 0) nextMatch.player1Id = winnerId;
      else nextMatch.player2Id = winnerId;
    }
  }

  if (match.loserGoesToBronzeFinal && bracketCopy.bronzeFinalId && hasBronzeFinal) {
    const bronzeMatch = bracketCopy.matches.find((m: PlayoffMatch) => m.id === bracketCopy.bronzeFinalId);
    if (bronzeMatch && loserId) {
      if (bronzeMatch.player1Id === null) bronzeMatch.player1Id = loserId;
      else if (bronzeMatch.player2Id === null) bronzeMatch.player2Id = loserId;
    }
  }

  return { bracketCopy, updatedMatch: match };
}

function ensureLeagueMatchExistsAndUpToDate(params: {
  leagueMatches: Match[];
  leagueMatchId: string;
  player1Id: string | null;
  player2Id: string | null;
  score1: number | null;
  score2: number | null;
}) {
  const { leagueMatches, leagueMatchId, player1Id, player2Id, score1, score2 } = params;

  if (!player1Id || !player2Id) return leagueMatches;

  const idx = leagueMatches.findIndex(m => m.id === leagueMatchId);
  const nextStatus: Match['status'] = score1 != null && score2 != null ? 'completed' : 'pending';

  const updated: Match = {
    id: leagueMatchId,
    player1Id,
    player2Id,
    score1,
    score2,
    status: nextStatus,
  };

  if (idx === -1) return [...leagueMatches, updated];

  const prev = leagueMatches[idx];
  const merged: Match = {
    ...prev,
    ...updated,
    status: nextStatus,
    scheduledTime: prev.scheduledTime ?? undefined,
    slotId: prev.slotId ?? undefined,
    location: prev.location ?? "",
    field: prev.field ?? "",
  };

  const copy = leagueMatches.slice();
  copy[idx] = merged;
  return copy;
}

type MatchContainerKind = 'group' | 'playoff' | 'consolation';

function findMatchContainerInTournament(t: Tournament, matchId: string): { kind: MatchContainerKind; groupId?: string } | null {
  // playoff/consolation first (unique prefixes)
  if (isPlayoffLeagueMatchId(matchId)) return { kind: 'playoff' };
  if (isConsolationLeagueMatchId(matchId)) return { kind: 'consolation' };

  // groups
  for (const g of t.groups) {
    if (g.matches.some(m => m.id === matchId)) return { kind: 'group', groupId: g.id };
  }
  return null;
}

interface TournamentWithExtraMatches extends Tournament {
  playoffMatches?: Match[];
  consolationMatches?: Match[];
}

const TournamentView: React.FC<TournamentViewProps> = ({
  event, tournament, setEvents, isOrganizer, loggedInPlayerId,
  initialActiveTab, initialSelectedGroupId, onPlayerContact
}) => {
  const t = tournament as TournamentWithExtraMatches;
  const isPadel = isPadelEvent(event);
  const competitorPlayers = getTournamentCompetitors(event, tournament);
  const loggedInCompetitorId = isPadel
    ? getTeamForPlayer(getTournamentPadelTeams(tournament), loggedInPlayerId)?.id
    : loggedInPlayerId;

  const userGroup = tournament.groups.find(g => g.playerIds.includes(loggedInCompetitorId ?? ""));
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>(
    initialSelectedGroupId ?? (userGroup ? userGroup.id : tournament.groups[0]?.id)
  );
  const selectedGroup = tournament.groups.find(g => g.id === selectedGroupId);

  const [activeTab, setActiveTab] = useState<'standings' | 'matches' | 'participants' | 'playoffs' | 'consolation' | 'groups' | 'settings' | 'rules' | 'players' | 'availability'>(
    (initialActiveTab ?? 'standings') as any
  );

  useEffect(() => {
    if (initialActiveTab) setActiveTab(initialActiveTab as any);
  }, [initialActiveTab]);

  useEffect(() => {
    if (initialSelectedGroupId && tournament.groups.some(g => g.id === initialSelectedGroupId)) {
      setSelectedGroupId(initialSelectedGroupId);
    }
  }, [initialSelectedGroupId, tournament.groups]);

  // modali / stati
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [score1, setScore1] = useState<string>("");
  const [score2, setScore2] = useState<string>("");

  const [bookingMatch, setBookingMatch] = useState<Match | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string>("");

  const [reschedulingMatch, setReschedulingMatch] = useState<Match | null>(null);
  const [rescheduleSlotId, setRescheduleSlotId] = useState<string>("");

  const [deletingMatch, setDeletingMatch] = useState<Match | null>(null);

  const [bookingError, setBookingError] = useState<string>("");

  // prenotazione dal tab Slot Disponibili (solo gironi, come era)
  const [slotToBook, setSlotToBook] = useState<null | TimeSlot>(null);
  const myPendingMatches = selectedGroup
    ? selectedGroup.matches.filter(m =>
      m.status === "pending" &&
      (m.player1Id === loggedInCompetitorId || m.player2Id === loggedInCompetitorId))
    : [];

  // --- TRIGGER RECTS for anchored modals ---
  const [editingTriggerRect, setEditingTriggerRect] = useState<DOMRect | null>(null);
  const [bookingTriggerRect, setBookingTriggerRect] = useState<DOMRect | null>(null);
  const [rescheduleTriggerRect, setRescheduleTriggerRect] = useState<DOMRect | null>(null);
  const [deletingTriggerRect, setDeletingTriggerRect] = useState<DOMRect | null>(null);
  const [slotToBookTriggerRect, setSlotToBookTriggerRect] = useState<DOMRect | null>(null);

  const handleClickBookSlot = (slot: TimeSlot, triggerRect?: DOMRect | null) => {
    setSlotToBook(slot);
    setSlotToBookTriggerRect(triggerRect ?? null);
  };

  const handleConfirmBookSlot = async (matchId: string) => {
    const match = selectedGroup?.matches.find(m => m.id === matchId);
    if (!match || !slotToBook) return;

    setBookingError("");
    const updatedMatch: Match = {
      ...match,
      status: "scheduled",
      scheduledTime: new Date(slotToBook.start).toISOString(),
      location: slotToBook.location ?? "",
      field: slotToBook.field ?? (slotToBook.location ?? ""),
      slotId: slotToBook.id
    };

    const updatedGroups = tournament.groups.map(g =>
      g.id === selectedGroup?.id
        ? { ...g, matches: g.matches.map(m => m.id === match.id ? updatedMatch : m) }
        : g
    );

    const updatedTournaments = event.tournaments.map(t0 =>
      t0.id === tournament.id ? { ...t0, groups: updatedGroups } : t0
    );

    setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
    await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });

    setSlotToBook(null);
    setSlotToBookTriggerRect(null);
  };

  // Slot locking: now includes groups + playoffMatches + consolationMatches across ALL tournaments
  function getAllBookedSlotIds(): string[] {
    return event.tournaments.flatMap(t0 => {
      const fromGroups = (t0.groups ?? []).flatMap(g =>
        (g.matches ?? [])
          .filter(m => m.slotId && (m.status === "scheduled" || m.status === "completed"))
          .map(m => m.slotId!)
      );

      const fromPlayoff = (t0 as TournamentWithExtraMatches).playoffMatches
        ? (t0 as TournamentWithExtraMatches).playoffMatches!
          .filter(m => m.slotId && (m.status === "scheduled" || m.status === "completed"))
          .map(m => m.slotId!)
        : [];

      const fromCons = (t0 as TournamentWithExtraMatches).consolationMatches
        ? (t0 as TournamentWithExtraMatches).consolationMatches!
          .filter(m => m.slotId && (m.status === "scheduled" || m.status === "completed"))
          .map(m => m.slotId!)
        : [];

      return [...fromGroups, ...fromPlayoff, ...fromCons];
    });
  }

  function getAvailableSlots() {
    const globalSlots = Array.isArray(event.globalTimeSlots) ? event.globalTimeSlots : [];
    const booked = getAllBookedSlotIds();
    const now = new Date();
    return globalSlots.filter(slot => {
      const startIso = (slot as any).start ?? (slot as any).time ?? null;
      if (!startIso) return false;
      const startDate = new Date(startIso);
      if (isNaN(startDate.getTime())) return false;
      if (startDate.getTime() <= now.getTime()) return false;
      return !booked.includes(slot.id);
    });
  }

  const handlePlayerContact = (player: { phone?: string } | Player) => {
    const p = player as Player;
    if (!p?.phone) return;
    if (onPlayerContact) {
      onPlayerContact(p);
      return;
    }
    if ((p as any).phone) {
      window.open(`https://wa.me/${(p as any).phone.replace(/[^0-9]/g, "")}`, "_blank");
    }
  };

  // risultato (modifica / salva)
  const handleEditResult = (match: Match, triggerRect?: DOMRect | null) => {
    setEditingMatch(match);
    setEditingTriggerRect(triggerRect ?? null);
    setScore1(match.score1 !== null ? String(match.score1) : "");
    setScore2(match.score2 !== null ? String(match.score2) : "");
  };

  async function saveMatchResult(match: Match) {
    const s1 = Number(score1);
    const s2 = Number(score2);
    if (Number.isNaN(s1) || Number.isNaN(s2)) return;
    const completedAt = match.status === 'completed' ? match.completedAt : new Date().toISOString();
    const result = { score1: s1, score2: s2, status: 'completed' as const, ...(completedAt ? { completedAt } : {}) };

    // PLAYOFF
    if (isPlayoffLeagueMatchId(match.id)) {
      const playoffMatchId = stripPrefix(match.id, 'po-');
      if (!tournament.playoffs) return;

      const { bracketCopy } = buildBracketCopyWithResultAndAdvance({
        bracket: tournament.playoffs,
        playoffMatchId,
        score1: s1,
        score2: s2,
        hasBronzeFinal: !!tournament.settings.hasBronzeFinal,
      });

      let playoffMatches: Match[] = Array.isArray(t.playoffMatches) ? JSON.parse(JSON.stringify(t.playoffMatches)) : [];

      // keep booking fields, set completed
      const currentIdx = playoffMatches.findIndex(m => m.id === match.id);
      if (currentIdx !== -1) {
        playoffMatches[currentIdx] = { ...playoffMatches[currentIdx], ...result };
      } else {
        playoffMatches.push({ ...match, ...result });
      }

      // ensure next exists if ready
      const pm = bracketCopy.matches.find(m => m.id === playoffMatchId);
      if (pm?.nextMatchId) {
        const nextPm = bracketCopy.matches.find(m => m.id === pm.nextMatchId);
        if (nextPm && nextPm.player1Id && nextPm.player2Id) {
          playoffMatches = ensureLeagueMatchExistsAndUpToDate({
            leagueMatches: playoffMatches,
            leagueMatchId: `po-${nextPm.id}`,
            player1Id: nextPm.player1Id,
            player2Id: nextPm.player2Id,
            score1: nextPm.score1,
            score2: nextPm.score2,
          });
        }
      }

      // ensure bronze exists if ready
      if (bracketCopy.bronzeFinalId && tournament.settings.hasBronzeFinal) {
        const bronzePm = bracketCopy.matches.find(m => m.id === bracketCopy.bronzeFinalId);
        if (bronzePm && bronzePm.player1Id && bronzePm.player2Id) {
          playoffMatches = ensureLeagueMatchExistsAndUpToDate({
            leagueMatches: playoffMatches,
            leagueMatchId: `po-${bronzePm.id}`,
            player1Id: bronzePm.player1Id,
            player2Id: bronzePm.player2Id,
            score1: bronzePm.score1,
            score2: bronzePm.score2,
          });
        }
      }

      const updatedTournaments = event.tournaments.map(t0 =>
        t0.id === tournament.id ? { ...t0, playoffs: bracketCopy, playoffMatches } : t0
      );

      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
      await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });

      setEditingMatch(null);
      setEditingTriggerRect(null);
      setScore1("");
      setScore2("");
      return;
    }

    // CONSOLATION
    if (isConsolationLeagueMatchId(match.id)) {
      const consolationMatchId = stripPrefix(match.id, 'co-');
      if (!tournament.consolationBracket) return;

      const { bracketCopy } = buildBracketCopyWithResultAndAdvance({
        bracket: tournament.consolationBracket,
        playoffMatchId: consolationMatchId,
        score1: s1,
        score2: s2,
        hasBronzeFinal: false,
      });

      let consolationMatches: Match[] = Array.isArray(t.consolationMatches) ? JSON.parse(JSON.stringify(t.consolationMatches)) : [];

      const currentIdx = consolationMatches.findIndex(m => m.id === match.id);
      if (currentIdx !== -1) {
        consolationMatches[currentIdx] = { ...consolationMatches[currentIdx], ...result };
      } else {
        consolationMatches.push({ ...match, ...result });
      }

      const cm = bracketCopy.matches.find(m => m.id === consolationMatchId);
      if (cm?.nextMatchId) {
        const nextCm = bracketCopy.matches.find(m => m.id === cm.nextMatchId);
        if (nextCm && nextCm.player1Id && nextCm.player2Id) {
          consolationMatches = ensureLeagueMatchExistsAndUpToDate({
            leagueMatches: consolationMatches,
            leagueMatchId: `co-${nextCm.id}`,
            player1Id: nextCm.player1Id,
            player2Id: nextCm.player2Id,
            score1: nextCm.score1,
            score2: nextCm.score2,
          });
        }
      }

      const updatedTournaments = event.tournaments.map(t0 =>
        t0.id === tournament.id ? { ...t0, consolationBracket: bracketCopy, consolationMatches } : t0
      );

      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
      await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });

      setEditingMatch(null);
      setEditingTriggerRect(null);
      setScore1("");
      setScore2("");
      return;
    }

    // GROUP MATCH (find the correct group by match id)
    const container = findMatchContainerInTournament(tournament, match.id);
    if (!container || container.kind !== 'group' || !container.groupId) return;

    const groupId = container.groupId;

    // keep booking fields, set completed
    const updatedGroups = tournament.groups.map(g => {
      if (g.id !== groupId) return g;
      return {
        ...g,
        matches: g.matches.map(m => m.id === match.id ? { ...m, ...match, ...result } : m)
      };
    });

    const updatedTournaments = event.tournaments.map(t0 =>
      t0.id === tournament.id ? { ...t0, groups: updatedGroups } : t0
    );

    setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
    await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });

    setEditingMatch(null);
    setEditingTriggerRect(null);
    setScore1("");
    setScore2("");
  }

  const handleOpenDeleteResult = (match: Match, triggerRect?: DOMRect | null) => {
    setDeletingMatch(match);
    setDeletingTriggerRect(triggerRect ?? null);
  };

  async function deleteMatchResult(match: Match) {
    const resetMatch = (current: Match): Match => {
      const { completedAt, ...rest } = current;
      return { ...rest, score1: null, score2: null, status: 'pending' };
    };
    // PLAYOFF
    if (isPlayoffLeagueMatchId(match.id)) {
      const playoffMatchId = stripPrefix(match.id, 'po-');
      if (!tournament.playoffs) return;

      const bracketCopy: PlayoffBracket = JSON.parse(JSON.stringify(tournament.playoffs));
      const m = bracketCopy.matches.find(x => x.id === playoffMatchId);
      if (!m) return;

      m.score1 = null;
      m.score2 = null;
      m.winnerId = null;

      let playoffMatches: Match[] = Array.isArray(t.playoffMatches) ? JSON.parse(JSON.stringify(t.playoffMatches)) : [];
      playoffMatches = playoffMatches.map(x => x.id === match.id ? resetMatch(x) : x);

      const updatedTournaments = event.tournaments.map(t0 =>
        t0.id === tournament.id ? { ...t0, playoffs: bracketCopy, playoffMatches } : t0
      );
      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
      await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });

      setDeletingMatch(null);
      setDeletingTriggerRect(null);
      return;
    }

    // CONSOLATION
    if (isConsolationLeagueMatchId(match.id)) {
      const consolationMatchId = stripPrefix(match.id, 'co-');
      if (!tournament.consolationBracket) return;

      const bracketCopy: PlayoffBracket = JSON.parse(JSON.stringify(tournament.consolationBracket));
      const m = bracketCopy.matches.find(x => x.id === consolationMatchId);
      if (!m) return;

      m.score1 = null;
      m.score2 = null;
      m.winnerId = null;

      let consolationMatches: Match[] = Array.isArray(t.consolationMatches) ? JSON.parse(JSON.stringify(t.consolationMatches)) : [];
      consolationMatches = consolationMatches.map(x => x.id === match.id ? resetMatch(x) : x);

      const updatedTournaments = event.tournaments.map(t0 =>
        t0.id === tournament.id ? { ...t0, consolationBracket: bracketCopy, consolationMatches } : t0
      );
      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
      await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });

      setDeletingMatch(null);
      setDeletingTriggerRect(null);
      return;
    }

    // GROUP
    const container = findMatchContainerInTournament(tournament, match.id);
    if (!container || container.kind !== 'group' || !container.groupId) return;

    const updatedGroups = tournament.groups.map(g => {
      if (g.id !== container.groupId) return g;
      return {
        ...g,
        matches: g.matches.map(m => m.id === match.id ? resetMatch(m) : m)
      };
    });

    const updatedTournaments = event.tournaments.map(t0 =>
      t0.id === tournament.id ? { ...t0, groups: updatedGroups } : t0
    );

    setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
    await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });

    setDeletingMatch(null);
    setDeletingTriggerRect(null);
  }

  // booking
  const handleBookMatch = (match: Match, triggerRect?: DOMRect | null) => {
    setBookingMatch(match);
    setBookingTriggerRect(triggerRect ?? null);
    setSelectedSlotId("");
    setBookingError("");
  };

  async function saveMatchBooking(match: Match) {
    const globalSlots = Array.isArray(event.globalTimeSlots) ? event.globalTimeSlots : [];
    const allBookedSlotIds = getAllBookedSlotIds();

    if (!selectedSlotId) {
      setBookingError("Seleziona uno slot orario.");
      return;
    }
    if (allBookedSlotIds.includes(selectedSlotId)) {
      setBookingError("Slot già prenotato, scegli un altro slot.");
      return;
    }

    const timeSlot = globalSlots.find(s => s.id === selectedSlotId);
    if (!timeSlot) {
      setBookingError("Slot non trovato tra quelli globali.");
      return;
    }
    const dateObj = new Date(timeSlot.start);
    if (!timeSlot.start || isNaN(dateObj.getTime())) {
      setBookingError("Invalid data - campo orario non valido.");
      return;
    }

    const updatedMatch: Match = {
      ...match,
      status: "scheduled",
      scheduledTime: dateObj.toISOString(),
      slotId: timeSlot.id,
      location: timeSlot.location ?? "",
      field: timeSlot.field ?? (timeSlot.location ?? ""),
    };

    // PLAYOFF
    if (isPlayoffLeagueMatchId(match.id)) {
      const current = Array.isArray(t.playoffMatches) ? t.playoffMatches : [];
      const updatedPlayoffMatches = current.map(m => m.id === match.id ? updatedMatch : m);

      const updatedTournaments = event.tournaments.map(t0 =>
        t0.id === tournament.id ? { ...t0, playoffMatches: updatedPlayoffMatches } : t0
      );

      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
      await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });

      setBookingMatch(null);
      setBookingTriggerRect(null);
      setSelectedSlotId("");
      setBookingError("");
      return;
    }

    // CONSOLATION
    if (isConsolationLeagueMatchId(match.id)) {
      const current = Array.isArray(t.consolationMatches) ? t.consolationMatches : [];
      const updatedConsolationMatches = current.map(m => m.id === match.id ? updatedMatch : m);

      const updatedTournaments = event.tournaments.map(t0 =>
        t0.id === tournament.id ? { ...t0, consolationMatches: updatedConsolationMatches } : t0
      );

      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
      await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });

      setBookingMatch(null);
      setBookingTriggerRect(null);
      setSelectedSlotId("");
      setBookingError("");
      return;
    }

    // GROUP
    const container = findMatchContainerInTournament(tournament, match.id);
    if (!container || container.kind !== 'group' || !container.groupId) return;

    const updatedGroups = tournament.groups.map(g =>
      g.id === container.groupId ? { ...g, matches: g.matches.map(m => m.id === match.id ? updatedMatch : m) } : g
    );

    const updatedTournaments = event.tournaments.map(t0 =>
      t0.id === tournament.id ? { ...t0, groups: updatedGroups } : t0
    );

    setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
    await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });

    setBookingMatch(null);
    setBookingTriggerRect(null);
    setSelectedSlotId("");
    setBookingError("");
  }

  // reschedule
  const handleRescheduleMatch = (match: Match, triggerRect?: DOMRect | null) => {
    setReschedulingMatch(match);
    setRescheduleTriggerRect(triggerRect ?? null);
    setRescheduleSlotId("");
  };

  async function saveRescheduleMatch(match: Match) {
    const globalSlots = Array.isArray(event.globalTimeSlots) ? event.globalTimeSlots : [];
    const allBookedSlotIds = getAllBookedSlotIds();

    if (!rescheduleSlotId) {
      setBookingError("Seleziona uno slot orario.");
      return;
    }
    if (allBookedSlotIds.includes(rescheduleSlotId)) {
      setBookingError("Slot già prenotato da un'altra partita.");
      return;
    }

    const timeSlot = globalSlots.find(s => s.id === rescheduleSlotId);
    const dateObj = timeSlot ? new Date(timeSlot.start) : null;

    const updatedMatch: Match = {
      ...match,
      status: "scheduled",
      scheduledTime: timeSlot?.start ? dateObj?.toISOString() ?? "" : "",
      slotId: timeSlot?.id ?? "",
      location: timeSlot?.location ?? "",
      field: timeSlot?.field ?? (timeSlot?.location ?? ""),
    };

    // PLAYOFF
    if (isPlayoffLeagueMatchId(match.id)) {
      const current = Array.isArray(t.playoffMatches) ? t.playoffMatches : [];
      const updatedPlayoffMatches = current.map(m => m.id === match.id ? updatedMatch : m);

      const updatedTournaments = event.tournaments.map(t0 =>
        t0.id === tournament.id ? { ...t0, playoffMatches: updatedPlayoffMatches } : t0
      );

      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
      await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });

      setReschedulingMatch(null);
      setRescheduleTriggerRect(null);
      setRescheduleSlotId("");
      setBookingError("");
      return;
    }

    // CONSOLATION
    if (isConsolationLeagueMatchId(match.id)) {
      const current = Array.isArray(t.consolationMatches) ? t.consolationMatches : [];
      const updatedConsolationMatches = current.map(m => m.id === match.id ? updatedMatch : m);

      const updatedTournaments = event.tournaments.map(t0 =>
        t0.id === tournament.id ? { ...t0, consolationMatches: updatedConsolationMatches } : t0
      );

      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
      await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });

      setReschedulingMatch(null);
      setRescheduleTriggerRect(null);
      setRescheduleSlotId("");
      setBookingError("");
      return;
    }

    // GROUP
    const container = findMatchContainerInTournament(tournament, match.id);
    if (!container || container.kind !== 'group' || !container.groupId) return;

    const updatedGroups = tournament.groups.map(g =>
      g.id === container.groupId ? { ...g, matches: g.matches.map(m => m.id === match.id ? updatedMatch : m) } : g
    );

    const updatedTournaments = event.tournaments.map(t0 =>
      t0.id === tournament.id ? { ...t0, groups: updatedGroups } : t0
    );

    setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
    await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });

    setReschedulingMatch(null);
    setRescheduleTriggerRect(null);
    setRescheduleSlotId("");
    setBookingError("");
  }

  // cancel booking
  async function handleCancelBooking(match: Match) {
    const updatedMatch: Match = { ...match, status: "pending", scheduledTime: null as any, slotId: null as any, location: "", field: "" };

    // PLAYOFF
    if (isPlayoffLeagueMatchId(match.id)) {
      const current = Array.isArray(t.playoffMatches) ? t.playoffMatches : [];
      const updatedPlayoffMatches = current.map(m => m.id === match.id ? updatedMatch : m);

      const updatedTournaments = event.tournaments.map(t0 =>
        t0.id === tournament.id ? { ...t0, playoffMatches: updatedPlayoffMatches } : t0
      );

      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
      await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });
      return;
    }

    // CONSOLATION
    if (isConsolationLeagueMatchId(match.id)) {
      const current = Array.isArray(t.consolationMatches) ? t.consolationMatches : [];
      const updatedConsolationMatches = current.map(m => m.id === match.id ? updatedMatch : m);

      const updatedTournaments = event.tournaments.map(t0 =>
        t0.id === tournament.id ? { ...t0, consolationMatches: updatedConsolationMatches } : t0
      );

      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
      await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });
      return;
    }

    // GROUP
    const container = findMatchContainerInTournament(tournament, match.id);
    if (!container || container.kind !== 'group' || !container.groupId) return;

    const updatedGroups = tournament.groups.map(g =>
      g.id === container.groupId ? { ...g, matches: g.matches.map(m => m.id === match.id ? updatedMatch : m) } : g
    );

    const updatedTournaments = event.tournaments.map(t0 =>
      t0.id === tournament.id ? { ...t0, groups: updatedGroups } : t0
    );

    setEvents(prev => prev.map(e => e.id === event.id ? { ...e, tournaments: updatedTournaments } : e));
    await updateDoc(doc(db, "events", event.id), { tournaments: updatedTournaments });
  }

  // --- MODAL ANCHORING LOGIC (UNCHANGED FROM YOUR FILE) ---
  const editingModalRef = useRef<HTMLDivElement | null>(null);
  const bookingModalRef = useRef<HTMLDivElement | null>(null);
  const rescheduleModalRef = useRef<HTMLDivElement | null>(null);
  const deletingModalRef = useRef<HTMLDivElement | null>(null);
  const slotToBookModalRef = useRef<HTMLDivElement | null>(null);

  const [editingModalStyle, setEditingModalStyle] = useState<React.CSSProperties | undefined>(undefined);
  const [bookingModalStyle, setBookingModalStyle] = useState<React.CSSProperties | undefined>(undefined);
  const [rescheduleModalStyle, setRescheduleModalStyle] = useState<React.CSSProperties | undefined>(undefined);
  const [deletingModalStyle, setDeletingModalStyle] = useState<React.CSSProperties | undefined>(undefined);
  const [slotToBookModalStyle, setSlotToBookModalStyle] = useState<React.CSSProperties | undefined>(undefined);

  function computeAnchorStyle(triggerRect: DOMRect, modalRect: DOMRect) {
    const margin = 8;
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);

    if (vw <= 480) {
      return { position: 'fixed' as const, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
    }

    let top = triggerRect.bottom + margin;
    let left = triggerRect.left;

    if (top + modalRect.height > vh - margin) top = triggerRect.top - modalRect.height - margin;

    top = Math.max(margin, Math.min(top, vh - modalRect.height - margin));

    if (left + modalRect.width > vw - margin) left = Math.max(margin, vw - modalRect.width - margin);
    left = Math.max(margin, left);

    return { position: 'fixed' as const, top: `${Math.round(top)}px`, left: `${Math.round(left)}px`, transform: 'none' };
  }

  function anchorModal(modalRef: React.RefObject<HTMLDivElement>, setStyle: (s?: React.CSSProperties) => void, providedTriggerRect?: DOMRect | null) {
    const modalEl = modalRef.current;
    if (!modalEl) return;

    requestAnimationFrame(() => {
      const modalRect = modalEl.getBoundingClientRect();

      const globalLastClickRect = (window as any).__lastClickRect as DOMRect | undefined;
      const triggerToUse = providedTriggerRect ?? globalLastClickRect ?? null;

      if (triggerToUse) {
        const styleObj = computeAnchorStyle(triggerToUse, modalRect);
        try {
          modalEl.style.position = (styleObj.position as string) || 'fixed';
          modalEl.style.top = (styleObj.top as string) || '';
          modalEl.style.left = (styleObj.left as string) || '';
          modalEl.style.transform = (styleObj.transform as string) || 'none';
        } catch {
          modalEl.style.cssText = `position: ${styleObj.position}; top: ${styleObj.top}; left: ${styleObj.left}; transform: ${styleObj.transform};`;
        }
        setStyle(styleObj);
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body || active === document.documentElement) {
        const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
        const fallbackStyle = vw <= 480
          ? { position: 'fixed' as const, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
          : { position: 'fixed' as const, top: '20%', left: '50%', transform: 'translateX(-50%)' };

        modalEl.style.position = (fallbackStyle.position as string) || 'fixed';
        modalEl.style.top = (fallbackStyle as any).top || '';
        modalEl.style.left = (fallbackStyle as any).left || '';
        modalEl.style.transform = (fallbackStyle as any).transform || 'none';
        setStyle(fallbackStyle);
        return;
      }

      const triggerRect = active.getBoundingClientRect();
      const styleObj = computeAnchorStyle(triggerRect, modalRect);
      modalEl.style.position = (styleObj.position as string) || 'fixed';
      modalEl.style.top = (styleObj.top as string) || '';
      modalEl.style.left = (styleObj.left as string) || '';
      modalEl.style.transform = (styleObj.transform as string) || 'none';
      setStyle(styleObj);
    });
  }

  useEffect(() => {
    if (editingMatch) {
      anchorModal(editingModalRef, setEditingModalStyle, editingTriggerRect);
      const onScroll = () => anchorModal(editingModalRef, setEditingModalStyle, editingTriggerRect);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onScroll);
      return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
    } else {
      if (editingModalRef.current) editingModalRef.current.style.cssText = '';
      setEditingModalStyle(undefined);
      setEditingTriggerRect(null);
    }
  }, [editingMatch, editingTriggerRect]);

  useEffect(() => {
    if (bookingMatch) {
      anchorModal(bookingModalRef, setBookingModalStyle, bookingTriggerRect);
      const onScroll = () => anchorModal(bookingModalRef, setBookingModalStyle, bookingTriggerRect);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onScroll);
      return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
    } else {
      if (bookingModalRef.current) bookingModalRef.current.style.cssText = '';
      setBookingModalStyle(undefined);
      setBookingTriggerRect(null);
    }
  }, [bookingMatch, bookingTriggerRect]);

  useEffect(() => {
    if (reschedulingMatch) {
      anchorModal(rescheduleModalRef, setRescheduleModalStyle, rescheduleTriggerRect);
      const onScroll = () => anchorModal(rescheduleModalRef, setRescheduleModalStyle, rescheduleTriggerRect);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onScroll);
      return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
    } else {
      if (rescheduleModalRef.current) rescheduleModalRef.current.style.cssText = '';
      setRescheduleModalStyle(undefined);
      setRescheduleTriggerRect(null);
    }
  }, [reschedulingMatch, rescheduleTriggerRect]);

  useEffect(() => {
    if (deletingMatch) {
      anchorModal(deletingModalRef, setDeletingModalStyle, deletingTriggerRect);
      const onScroll = () => anchorModal(deletingModalRef, setDeletingModalStyle, deletingTriggerRect);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onScroll);
      return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
    } else {
      if (deletingModalRef.current) deletingModalRef.current.style.cssText = '';
      setDeletingModalStyle(undefined);
      setDeletingTriggerRect(null);
    }
  }, [deletingMatch, deletingTriggerRect]);

  useEffect(() => {
    if (slotToBook && myPendingMatches.length > 0) {
      anchorModal(slotToBookModalRef, setSlotToBookModalStyle, slotToBookTriggerRect);
      const onScroll = () => anchorModal(slotToBookModalRef, setSlotToBookModalStyle, slotToBookTriggerRect);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onScroll);
      return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
    } else {
      if (slotToBookModalRef.current) slotToBookModalRef.current.style.cssText = '';
      setSlotToBookModalStyle(undefined);
      setSlotToBookTriggerRect(null);
    }
  }, [slotToBook, myPendingMatches.length, slotToBookTriggerRect]);

  const modalBackdrop = "fixed inset-0 bg-black/70 z-50";
  const modalBox = "bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-md border border-tertiary";

  const playoffVirtualGroup: Group = {
    id: `${tournament.id}-playoffs`,
    name: "Playoff",
    playerIds: [],
    matches: Array.isArray(t.playoffMatches) ? t.playoffMatches : [],
  };

  const consolationVirtualGroup: Group = {
    id: `${tournament.id}-consolation`,
    name: "Consolazione",
    playerIds: [],
    matches: Array.isArray(t.consolationMatches) ? t.consolationMatches : [],
  };

  // --- UI (same as your latest version: playoff on top) ---
  return (
    <div>
      {/* Tabs menu */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button onClick={() => setActiveTab('standings')}
          className={`px-4 py-2 rounded-full ${activeTab === 'standings'
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
            : 'bg-transparent text-accent'
          }`}
        >
          Classifica
        </button>
        <button onClick={() => setActiveTab('matches')}
          className={`px-4 py-2 rounded-full ${activeTab === 'matches'
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
            : 'bg-transparent text-accent'
          }`}
        >
          Partite
        </button>
        <button onClick={() => setActiveTab('availability')}
          className={`px-4 py-2 rounded-full ${activeTab === 'availability'
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
            : 'bg-transparent text-accent'
          }`}
        >
          Disponibilità di gioco
        </button>
        {!isOrganizer && (
          <button onClick={() => setActiveTab('participants')}
            className={`px-4 py-2 rounded-full ${activeTab === 'participants'
              ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
              : 'bg-transparent text-accent'
            }`}
          >
            Partecipanti
          </button>
        )}
        <button onClick={() => setActiveTab('playoffs')}
          className={`px-4 py-2 rounded-full ${activeTab === 'playoffs'
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
            : 'bg-transparent text-accent'
          }`}
        >
          Playoff
        </button>
        <button onClick={() => setActiveTab('consolation')}
          className={`px-4 py-2 rounded-full ${activeTab === 'consolation'
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
            : 'bg-transparent text-accent'
          }`}
        >
          Consolazione
        </button>
        {isOrganizer && (
          <>
            <button onClick={() => setActiveTab('groups')}
              className={`px-4 py-2 rounded-full ${activeTab === 'groups'
                ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
                : 'bg-transparent text-accent'
              }`}
            >
              Gestione Gironi
            </button>
            <button onClick={() => setActiveTab('players')}
              className={`px-4 py-2 rounded-full ${activeTab === 'players'
                ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
                : 'bg-transparent text-accent'
              }`}
            >
              Giocatori
            </button>
          </>
        )}
        <button onClick={() => setActiveTab('rules')}
          className={`px-4 py-2 rounded-full ${activeTab === 'rules'
            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
            : 'bg-transparent text-accent'
          }`}
        >
          Regolamento
        </button>
        {isOrganizer && (
          <button onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 rounded-full ${activeTab === 'settings'
              ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg'
              : 'bg-transparent text-accent'
            }`}
          >
            Impostazioni
          </button>
        )}
      </div>

      {/* Selettore gironi */}
      {selectedGroup && (
        <div className="mb-6 flex items-center gap-3">
          <label className="font-bold text-text-secondary">Seleziona Girone:</label>
          <select
            value={selectedGroupId}
            onChange={e => setSelectedGroupId(e.target.value)}
            className="bg-tertiary rounded px-3 py-2 font-semibold"
          >
            {tournament.groups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        {activeTab === 'standings' && selectedGroup && (
          <div>
            <h3 className="text-xl font-bold mb-3 text-accent">{selectedGroup.name}</h3>
            <StandingsTable
              group={selectedGroup}
              players={competitorPlayers}
              settings={tournament.settings}
              loggedInPlayerId={loggedInCompetitorId}
              onPlayerContact={handlePlayerContact}
              entryLabel={isPadel ? 'Squadra' : 'Giocatore'}
            />
          </div>
        )}

        {activeTab === 'matches' && (
          <div className="space-y-10">
            {!isOrganizer && loggedInPlayerId && (
              <TournamentMatchFinder
                event={event}
                tournament={tournament}
                currentPlayerId={loggedInPlayerId}
                onAvailability={() => setActiveTab('availability')}
                onPlayerContact={handlePlayerContact}
              />
            )}
            {Array.isArray(t.playoffMatches) && t.playoffMatches.length > 0 && (
              <div>
                <h3 className="text-xl font-bold mb-3 text-accent">Playoff</h3>
                <MatchList
                  group={playoffVirtualGroup}
                  players={competitorPlayers}
                  onEditResult={handleEditResult}
                  onBookMatch={handleBookMatch}
                  isOrganizer={isOrganizer}
                  loggedInPlayerId={loggedInCompetitorId}
                  onPlayerContact={handlePlayerContact as any}
                  onRescheduleMatch={handleRescheduleMatch}
                  onCancelBooking={handleCancelBooking}
                  onDeleteResult={handleOpenDeleteResult}
                  viewingOwnGroup={true}
                />
              </div>
            )}

            {Array.isArray(t.consolationMatches) && t.consolationMatches.length > 0 && (
              <div>
                <h3 className="text-xl font-bold mb-3 text-accent">Consolazione</h3>
                <MatchList
                  group={consolationVirtualGroup}
                  players={competitorPlayers}
                  onEditResult={handleEditResult}
                  onBookMatch={handleBookMatch}
                  isOrganizer={isOrganizer}
                  loggedInPlayerId={loggedInCompetitorId}
                  onPlayerContact={handlePlayerContact as any}
                  onRescheduleMatch={handleRescheduleMatch}
                  onCancelBooking={handleCancelBooking}
                  onDeleteResult={handleOpenDeleteResult}
                  viewingOwnGroup={true}
                />
              </div>
            )}

            {selectedGroup && (
              <div>
                <h3 className="text-xl font-bold mb-3 text-accent">{selectedGroup.name}</h3>
                <MatchList
                  group={selectedGroup}
                  players={competitorPlayers}
                  onEditResult={handleEditResult}
                  onBookMatch={handleBookMatch}
                  isOrganizer={isOrganizer}
                  loggedInPlayerId={loggedInCompetitorId}
                  onPlayerContact={handlePlayerContact as any}
                  onRescheduleMatch={handleRescheduleMatch}
                  onCancelBooking={handleCancelBooking}
                  onDeleteResult={handleOpenDeleteResult}
                  viewingOwnGroup={selectedGroup.playerIds.includes(loggedInCompetitorId ?? "")}
                />
              </div>
            )}

            {/* Modals (same as your file) */}
            {editingMatch && (
              <Portal>
                <div className={modalBackdrop} role="dialog" aria-modal="true">
                  <div ref={editingModalRef} style={editingModalStyle} className={modalBox}>
                    <h4 className="mb-4 font-bold text-lg text-accent">Modifica Risultato</h4>
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col">
                        <label className="font-bold mb-1 text-white">Risultato per {getCompetitorName(event, tournament, editingMatch.player1Id)}</label>
                        <input type="number" min="0" value={score1} onChange={e => setScore1(e.target.value)} className="border px-3 py-2 rounded font-bold text-white bg-primary"/>
                      </div>
                      <div className="flex flex-col">
                        <label className="font-bold mb-1 text-white">Risultato per {getCompetitorName(event, tournament, editingMatch.player2Id)}</label>
                        <input type="number" min="0" value={score2} onChange={e => setScore2(e.target.value)} className="border px-3 py-2 rounded font-bold text-white bg-primary"/>
                      </div>
                      <div className="flex gap-2 justify-end pt-3">
                        <button onClick={() => { setEditingMatch(null); setEditingTriggerRect(null); }} className="bg-tertiary px-4 py-2 rounded">Annulla</button>
                        <button disabled={score1 === "" || score2 === ""} onClick={async () => { if (editingMatch) { await saveMatchResult(editingMatch); } }} className="bg-highlight text-white px-4 py-2 rounded">Salva</button>
                      </div>
                    </div>
                  </div>
                </div>
              </Portal>
            )}

            {bookingMatch && (
              <Portal>
                <div className={modalBackdrop} role="dialog" aria-modal="true">
                  <div ref={bookingModalRef} style={bookingModalStyle} className={modalBox}>
                    <h4 className="mb-4 font-bold text-lg text-accent">Prenota Partita</h4>
                    <div className="flex flex-col gap-4">
                      <label className="font-bold mb-1 text-white">Scegli uno slot libero:</label>
                      <select value={selectedSlotId} onChange={e => { setSelectedSlotId(e.target.value); setBookingError(""); }} className="border px-3 py-2 rounded font-bold text-white bg-primary">
                        <option value="">Seleziona uno slot</option>
                        {getAvailableSlots().map(slot => (
                          <option key={slot.id} value={slot.id}>
                            {new Date(slot.start).toLocaleString("it-IT")}{slot.location ? ` - ${slot.location}` : ""}{slot.field ? ` - ${slot.field}` : ""}
                          </option>
                        ))}
                      </select>
                      {bookingError && <div className="text-red-500 font-bold">{bookingError}</div>}
                      <div className="flex gap-2 justify-end pt-3">
                        <button onClick={() => { setBookingMatch(null); setBookingTriggerRect(null); setBookingError(""); setSelectedSlotId(""); }} className="bg-tertiary px-4 py-2 rounded">Annulla</button>
                        <button disabled={!selectedSlotId} onClick={async () => { if (bookingMatch) { await saveMatchBooking(bookingMatch); } }} className="bg-highlight text-white px-4 py-2 rounded">Prenota</button>
                      </div>
                    </div>
                  </div>
                </div>
              </Portal>
            )}

            {reschedulingMatch && (
              <Portal>
                <div className={modalBackdrop} role="dialog" aria-modal="true">
                  <div ref={rescheduleModalRef} style={rescheduleModalStyle} className={modalBox}>
                    <h4 className="mb-4 font-bold text-lg text-accent">Modifica Prenotazione</h4>
                    <div className="flex flex-col gap-4">
                      <label className="font-bold mb-1 text-white">Scegli uno slot libero:</label>
                      <select value={rescheduleSlotId} onChange={e => { setRescheduleSlotId(e.target.value); setBookingError(""); }} className="border px-3 py-2 rounded font-bold text-white bg-primary">
                        <option value="">Seleziona uno slot</option>
                        {getAvailableSlots().map(slot => (
                          <option key={slot.id} value={slot.id}>
                            {new Date(slot.start).toLocaleString("it-IT")}{slot.location ? ` - ${slot.location}` : ""}{slot.field ? ` - ${slot.field}` : ""}
                          </option>
                        ))}
                      </select>
                      {bookingError && <div className="text-red-500 font-bold">{bookingError}</div>}
                      <div className="flex gap-2 justify-end pt-3">
                        <button onClick={() => { setReschedulingMatch(null); setRescheduleTriggerRect(null); setRescheduleSlotId(""); setBookingError(""); }} className="bg-tertiary px-4 py-2 rounded">Annulla</button>
                        <button disabled={!rescheduleSlotId} onClick={async () => { if (reschedulingMatch) { await saveRescheduleMatch(reschedulingMatch); } }} className="bg-highlight text-white px-4 py-2 rounded">Salva</button>
                      </div>
                    </div>
                  </div>
                </div>
              </Portal>
            )}

            {deletingMatch && (
              <Portal>
                <div className={modalBackdrop} role="dialog" aria-modal="true">
                  <div ref={deletingModalRef} style={deletingModalStyle} className={modalBox}>
                    <h4 className="mb-4 font-bold text-lg text-red-600">Elimina risultato partita</h4>
                    <p className="mb-6 font-bold text-white">Sei sicuro di voler eliminare il risultato della partita tra&nbsp;
                      <strong>{getCompetitorName(event, tournament, deletingMatch.player1Id)}</strong> e&nbsp;
                      <strong>{getCompetitorName(event, tournament, deletingMatch.player2Id)}</strong>?
                    </p>
                    <div className="flex gap-2 justify-end pt-3">
                      <button onClick={() => { setDeletingMatch(null); setDeletingTriggerRect(null); }} className="bg-tertiary px-4 py-2 rounded">Annulla</button>
                      <button onClick={async () => { if (deletingMatch) { await deleteMatchResult(deletingMatch); } }} className="bg-red-600 text-white px-4 py-2 rounded">Elimina</button>
                    </div>
                  </div>
                </div>
              </Portal>
            )}
          </div>
        )}

        {activeTab === 'participants' && !isOrganizer && (
          <ParticipantsTab event={event} tournament={tournament} loggedInPlayerId={loggedInPlayerId} />
        )}

        {activeTab === 'availability' && (
          <AvailabilityTab
            event={event}
            tournament={tournament}
            selectedGroup={{
              id: `${tournament.id}-availability`,
              name: 'Disponibilità torneo',
              playerIds: event.players.map(player => player.id),
              matches: [],
            }}
            loggedInPlayerId={loggedInPlayerId}
          />
        )}

        {activeTab === 'playoffs' && (
          <div className="bg-secondary p-6 rounded-xl shadow-lg max-w-3xl mx-auto">
            <Playoffs event={event} tournament={tournament} setEvents={setEvents} isOrganizer={isOrganizer} loggedInPlayerId={loggedInCompetitorId} />
          </div>
        )}

        {activeTab === 'consolation' && (
          <ConsolationBracket event={event} tournament={tournament} setEvents={setEvents} isOrganizer={isOrganizer} loggedInPlayerId={loggedInCompetitorId} />
        )}

        {activeTab === 'groups' && isOrganizer && (
          <GroupManagement event={event} tournament={tournament} setEvents={setEvents} isOrganizer={isOrganizer} />
        )}

        {activeTab === 'players' && isOrganizer && (
          <PlayerManagement event={event} setEvents={setEvents} isOrganizer={isOrganizer} onPlayerContact={handlePlayerContact} />
        )}

        {activeTab === 'settings' && isOrganizer && (
          <TournamentSettings event={event} tournament={tournament} setEvents={setEvents} />
        )}

        {activeTab === 'rules' && (
          <div className="bg-secondary p-6 rounded-xl shadow-lg max-w-3xl mx-auto whitespace-pre-line">
            <h3 className="text-xl font-bold mb-4 text-accent">Regolamento Torneo</h3>
            {event.rules?.trim()
              ? <div className="bg-primary p-4 rounded-lg border border-tertiary">{event.rules}</div>
              : <p className="text-text-secondary">Nessun regolamento inserito dall'organizzatore.</p>}
            <div className="mt-8">
              <h3 className="text-xl font-bold mb-4 text-accent">
                Regolamento Girone: {selectedGroup?.name}
              </h3>
              {selectedGroup?.rules?.trim()
                ? <div className="bg-primary p-4 rounded-lg border border-tertiary">{selectedGroup.rules}</div>
                : <p className="text-text-secondary">Nessun regolamento inserito per questo girone.</p>
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TournamentView;
