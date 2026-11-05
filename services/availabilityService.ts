// services/availabilityService.ts
import {
  collection,
  query,
  where,
  getDocs,
  setDoc,
  doc,
  deleteDoc,
  serverTimestamp,
  orderBy,
  getDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { TOURNAMENT_VENUES, type TournamentVenueId } from "../utils/tournamentVenues";
import {
  getTournamentPeriodAvailabilityId,
  isTournamentWeekendDate,
  isTournamentAvailabilityPeriod,
  isTournamentAvailabilityPeriodAllowedOnDate,
  type TournamentAvailabilityPeriodId,
} from "../utils/tournamentAvailabilityPeriods";

/**
 * Servizio disponibilità
 *
 * Collections:
 * - availabilities (legacy per data+slot)
 * - availability_settings (global on/off per player and scoped tournament venue choices)
 * - slot_preferences (preference per slot)
 * - date_unavailabilities (per-player per-date non disponibilità)
 */

// --- tipi ---
export type Slot = "MORNING" | "AFTERNOON" | "EVENING";

export interface AvailabilityRecord {
  id?: string;
  playerId: string;
  date: string; // YYYY-MM-DD
  slot: string; // enum o slot id
  isAvailable: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface SlotPreference {
  id?: string; // doc id playerId_slotId
  playerId: string;
  slotId: string;
  isPreferred: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface GlobalAvailability {
  id?: string; // doc id = playerId
  playerId: string;
  available: boolean; // true = available override, false = explicitly not available
  createdAt?: any;
  updatedAt?: any;
}

export interface DateUnavailability {
  id?: string; // doc id = `${playerId}_${YYYY-MM-DD}`
  playerId: string;
  date: string; // YYYY-MM-DD
  unavailable: boolean; // true = not available for that date
  createdAt?: any;
  updatedAt?: any;
  eventId?: string;
  tournamentId?: string;
}

export interface TournamentAvailabilityScope {
  eventId: string;
  tournamentId: string;
}

export interface TournamentPeriodAvailabilityRecord {
  id?: string;
  playerId: string;
  eventId: string;
  tournamentId: string;
  date: string;
  venueId: TournamentVenueId;
  period: TournamentAvailabilityPeriodId;
  isAvailable: true;
}

export async function setTournamentVenues(playerId: string, venueIds: TournamentVenueId[], scope: TournamentAvailabilityScope): Promise<void> {
  if (!playerId || !scope.eventId || !scope.tournamentId || venueIds.length === 0
    || venueIds.some(id => !TOURNAMENT_VENUES.some(venue => venue.id === id))) {
    throw new Error('Seleziona almeno un centro di gioco valido.');
  }
  const ref = doc(db, 'availability_settings', `${scope.eventId}_${scope.tournamentId}_${playerId}`);
  await setDoc(ref, {
    playerId, ...scope, venueIds: [...new Set(venueIds)], updatedAt: serverTimestamp(),
  }, { merge: true });
}

// --- collections ---
const AVAIL_COL = "availabilities"; // legacy
const GLOBAL_COL = "availability_settings";
const SLOT_PREF_COL = "slot_preferences";
const DATE_UNAVAIL_COL = "date_unavailabilities";
const TOURNAMENT_AVAIL_COL = "availabilities";

export async function setTournamentPeriodAvailability(
  playerId: string, date: string, venueId: TournamentVenueId, period: TournamentAvailabilityPeriodId,
  isAvailable: boolean, scope: TournamentAvailabilityScope,
): Promise<void> {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (!playerId || !scope.eventId || !scope.tournamentId
    || !isTournamentWeekendDate(date)
    || date < todayKey
    || !TOURNAMENT_VENUES.some(venue => venue.id === venueId)
    || !isTournamentAvailabilityPeriod(period)
    || !isTournamentAvailabilityPeriodAllowedOnDate(period, date)) {
    throw new Error('Seleziona un giorno, un centro e una fascia oraria validi. La sera non è disponibile il sabato e la domenica.');
  }
  const ref = doc(db, TOURNAMENT_AVAIL_COL,
    getTournamentPeriodAvailabilityId(scope, playerId, date, venueId, period));
  if (isAvailable) {
    await setDoc(ref, {
      playerId, ...scope, date, venueId, period, slot: period, isAvailable: true,
      updatedAt: serverTimestamp(), createdAt: serverTimestamp(),
    }, { merge: true });
  } else {
    await deleteDoc(ref);
  }
}

// --- legacy: per-date availabilities (lasciamo le funzioni se servono) ---
function docIdAvail(playerId: string, date: string, slot: string) {
  return `${playerId}_${date}_${slot}`;
}

export async function setAvailability(playerId: string, date: string, slot: string, isAvailable: boolean): Promise<void> {
  const id = docIdAvail(playerId, date, slot);
  const ref = doc(db, AVAIL_COL, id);
  await setDoc(ref, { playerId, date, slot, isAvailable, updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
}

export async function removeAvailability(playerId: string, date: string, slot: string): Promise<void> {
  const id = docIdAvail(playerId, date, slot);
  const ref = doc(db, AVAIL_COL, id);
  await deleteDoc(ref);
}

export async function getUserAvailabilities(playerId: string, startDate: string, endDate: string): Promise<AvailabilityRecord[]> {
  const c = collection(db, AVAIL_COL);
  const q = query(c, where("playerId", "==", playerId), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as AvailabilityRecord) }));
}

// --- GLOBAL availability (simple on/off per player) ---
export async function setGlobalAvailability(playerId: string, available: boolean): Promise<void> {
  const ref = doc(db, GLOBAL_COL, playerId);
  await setDoc(ref, { playerId, available, updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
}

export async function removeGlobalAvailability(playerId: string): Promise<void> {
  const ref = doc(db, GLOBAL_COL, playerId);
  await deleteDoc(ref);
}

export async function getGlobalAvailability(playerId: string): Promise<GlobalAvailability | null> {
  const ref = doc(db, GLOBAL_COL, playerId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as GlobalAvailability) };
}

export async function getGlobalAvailabilitiesForPlayers(playerIds: string[]): Promise<GlobalAvailability[]> {
  const results: GlobalAvailability[] = [];
  if (!playerIds || playerIds.length === 0) return results;
  const CHUNK = 10;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const c = collection(db, GLOBAL_COL);
    const q = query(c, where("playerId", "in", chunk));
    const snap = await getDocs(q);
    snap.docs.forEach(d => {
      const record = d.data();
      if (!record.eventId && !record.tournamentId) results.push({ id: d.id, ...(record as GlobalAvailability) });
    });
  }
  return results;
}

// --- DATE unavailabilities (per-player per-date) ---
function docIdDateUnavail(playerId: string, date: string, scope?: TournamentAvailabilityScope) {
  return scope
    ? `${scope.eventId}_${scope.tournamentId}_${playerId}_${date}`
    : `${playerId}_${date}`;
}

export async function setDateUnavailability(playerId: string, date: string, unavailable: boolean, scope?: TournamentAvailabilityScope): Promise<void> {
  const id = docIdDateUnavail(playerId, date, scope);
  const ref = doc(db, DATE_UNAVAIL_COL, id);
  await setDoc(ref, { playerId, date, unavailable, ...(scope ?? {}), updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
}

export async function removeDateUnavailability(playerId: string, date: string, scope?: TournamentAvailabilityScope): Promise<void> {
  const id = docIdDateUnavail(playerId, date, scope);
  const ref = doc(db, DATE_UNAVAIL_COL, id);
  await deleteDoc(ref);
}

export async function getDateUnavailabilitiesForPlayers(playerIds: string[], startDate?: string, endDate?: string): Promise<DateUnavailability[]> {
  const results: DateUnavailability[] = [];
  if (!playerIds || playerIds.length === 0) return results;
  const CHUNK = 10;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const c = collection(db, DATE_UNAVAIL_COL);
    // Build query: playerId in chunk, optional date range
    let q;
    if (startDate && endDate) {
      q = query(c, where("playerId", "in", chunk), where("date", ">=", startDate), where("date", "<=", endDate), orderBy("date", "asc"));
    } else {
      q = query(c, where("playerId", "in", chunk));
    }
    const snap = await getDocs(q);
    snap.docs.forEach(d => results.push({ id: d.id, ...(d.data() as DateUnavailability) }));
  }
  return results;
}

// --- SLOT preferences (per slot created by admin) ---
function docIdSlotPref(playerId: string, slotId: string) {
  return `${playerId}_${slotId}`;
}

export async function setSlotPreference(playerId: string, slotId: string, isPreferred: boolean): Promise<void> {
  const id = docIdSlotPref(playerId, slotId);
  const ref = doc(db, SLOT_PREF_COL, id);
  await setDoc(ref, { playerId, slotId, isPreferred, updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
}

export async function removeSlotPreference(playerId: string, slotId: string): Promise<void> {
  const id = doc(db, SLOT_PREF_COL, slotId);
  await deleteDoc(ref);
}

export async function getSlotPreferencesForPlayers(playerIds: string[]): Promise<SlotPreference[]> {
  const results: SlotPreference[] = [];
  if (!playerIds || playerIds.length === 0) return results;
  const CHUNK = 10;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const c = collection(db, SLOT_PREF_COL);
    const q = query(c, where("playerId", "in", chunk));
    const snap = await getDocs(q);
    snap.docs.forEach(d => results.push({ id: d.id, ...(d.data() as SlotPreference) }));
  }
  return results;
}
