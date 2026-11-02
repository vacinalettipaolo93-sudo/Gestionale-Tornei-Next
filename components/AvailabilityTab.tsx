// components/AvailabilityTab.tsx
import React, { useMemo, useState } from "react";
import { type Event, type Tournament, type Group, type Player, type TimeSlot } from "../types";
import {
  setSlotPreference,
  removeSlotPreference,
  setDateUnavailability,
  removeDateUnavailability,
} from "../services/availabilityService";
import { getAvailabilityDateKey, getTournamentAvailabilitySlots } from "../utils/tournamentAvailability";
import { useTournamentAvailability } from "./useTournamentAvailability";

type Props = {
  event: Event;
  tournament: Tournament;
  selectedGroup: Group;
  loggedInPlayerId?: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDisplayDateKey(key: string) {
  const parts = key.split("-");
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`; // DD-MM-YYYY
  return key;
}

function formatHHMMFromIso(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const h = pad2(d.getHours());
  const m = pad2(d.getMinutes());
  return `${h}:${m}`;
}

export default function AvailabilityTab({ event, tournament, selectedGroup, loggedInPlayerId }: Props) {
  const participantIds = selectedGroup.playerIds ?? [];
  const participants = participantIds.map(pid => event.players.find(p => p.id === pid)).filter(Boolean) as Player[];

  const futureSlots = getTournamentAvailabilitySlots(event, tournament);

  // derive unique date keys (YYYY-MM-DD) from futureSlots, sorted
  const dateKeys = useMemo(() => {
    const set = new Set<string>();
    futureSlots.forEach(s => {
      const key = getAvailabilityDateKey(s.start);
      if (key) set.add(key);
    });
    return Array.from(set).sort();
  }, [futureSlots]);

  // Build date -> slots map for quick lookup (slots on a date)
  const dateSlotsMap: Record<string, TimeSlot[]> = useMemo(() => {
    const m: Record<string, TimeSlot[]> = {};
    futureSlots.forEach(s => {
      const key = getAvailabilityDateKey(s.start);
      if (!key) return;
      if (!m[key]) m[key] = [];
      m[key].push(s);
    });
    Object.keys(m).forEach(k => {
      m[k].sort((a, b) => {
        const ta = Date.parse(a.start);
        const tb = Date.parse(b.start);
        return ta - tb;
      });
    });
    return m;
  }, [futureSlots]);

  const { loading, error, slotPrefMap, dateUnavailMap } = useTournamentAvailability(participantIds);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Toggle slot preference: write then local snapshot will update from listener
  async function toggleMySlot(slotId: string) {
    if (!loggedInPlayerId) return;
    const mySet = slotPrefMap[loggedInPlayerId] ?? new Set<string>();
    const has = mySet.has(slotId);
    setSaveError(null);
    try {
      if (!has) {
        await setSlotPreference(loggedInPlayerId, slotId, true);
      } else {
        await removeSlotPreference(loggedInPlayerId, slotId);
      }
      // don't update local map here; listener will reflect DB change
    } catch (err) {
      console.error("Errore salvataggio preferenza slot:", err);
      setSaveError("Impossibile salvare la preferenza. Riprova.");
    }
  }

  // Toggle date unavailability: write then listener updates state
  async function toggleMyDateUnavail(dateKey: string) {
    if (!loggedInPlayerId) return;
    const mySet = dateUnavailMap[loggedInPlayerId] ?? new Set<string>();
    const has = mySet.has(dateKey);
    setSaveError(null);
    try {
      if (!has) {
        await setDateUnavailability(loggedInPlayerId, dateKey, true);
      } else {
        await removeDateUnavailability(loggedInPlayerId, dateKey);
      }
    } catch (err) {
      console.error("Errore salvataggio non-disponibilità per data:", err);
      setSaveError("Impossibile salvare la non disponibilità. Riprova.");
    }
  }

  if (loading) return <div>Caricamento disponibilità…</div>;
  if (error) return <p role="alert" className="text-red-400">{error}</p>;

  function isParticipantUnavailableOn(pId: string, dateKey: string) {
    return !!(dateUnavailMap[pId]?.has(dateKey));
  }

  // helper: sort hh:mm strings
  function sortHHMMArray(arr: string[]) {
    return arr.slice().sort((a, b) => {
      const [ah, am] = a.split(":").map(Number);
      const [bh, bm] = b.split(":").map(Number);
      return ah !== bh ? ah - bh : am - bm;
    });
  }

  return (
    <div className="max-w-6xl mx-auto bg-secondary rounded-xl p-6 shadow space-y-6">
      <h3 className="text-xl font-bold text-accent">Disponibilità di gioco</h3>
      <p className="text-sm text-text-secondary">
        Seleziona “Voglio giocare” sugli slot che preferisci. Cerca partita propone solo chi ha scelto lo stesso slot:
        non aver escluso una data non equivale ad aver dichiarato disponibilità.
      </p>
      {saveError && <p role="alert" className="text-red-400">{saveError}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: per-date toggles */}
        <div className="lg:col-span-1 bg-primary p-4 rounded-lg border border-tertiary space-y-4">
          <h4 className="font-semibold">Non disponibile per date</h4>
          {dateKeys.length === 0 ? (
            <div className="text-text-secondary text-sm">Nessuna data futura (gli slot futuri non sono presenti).</div>
          ) : (
            <div className="space-y-2 max-h-[52vh] overflow-auto pr-2">
              {dateKeys.map(dk => {
                const countUnavailable = participants.filter(p => isParticipantUnavailableOn(p.id, dk)).length;
                const myUnavail = loggedInPlayerId ? isParticipantUnavailableOn(loggedInPlayerId, dk) : false;
                return (
                  <div key={dk} className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">{formatDisplayDateKey(dk)}</div>
                      <div className="text-xs text-text-secondary">{countUnavailable > 0 ? `${countUnavailable} non disponibili` : 'Nessuna esclusione per questa data'}</div>
                    </div>
                    <div>
                      {loggedInPlayerId ? (
                        <button
                          onClick={() => toggleMyDateUnavail(dk)}
                          className={`px-3 py-2 rounded ${myUnavail ? 'bg-red-600 text-white' : 'bg-tertiary text-text-primary'}`}
                        >
                          {myUnavail ? 'Rimuovi: Non disponibile' : 'Segna Non disponibile'}
                        </button>
                      ) : (
                        <div className="text-sm text-text-secondary">Login per impostare</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Middle/right: participants x dates availability table + slots list */}
        <div className="lg:col-span-3">
          <h4 className="font-semibold mb-3">Disponibilità partecipanti per data</h4>

          {dateKeys.length === 0 ? (
            <div className="bg-primary p-4 rounded-lg border border-tertiary">Nessuna data futura disponibile.</div>
          ) : (
            <div className="overflow-auto bg-primary p-3 rounded-lg border border-tertiary">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="text-left pr-4 pb-2 font-semibold">Giocatore</th>
                    {dateKeys.map(dk => (
                      <th key={dk} className="text-left px-3 pb-2 font-semibold">{formatDisplayDateKey(dk)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {participants.map(p => (
                    <tr key={p.id} className="odd:bg-primary/60">
                      <td className="py-2 pr-4 font-medium">
                        <div className="inline-flex items-center gap-2">
                          <img src={p.avatar} alt={p.name} className="w-7 h-7 rounded-full object-cover" />
                          <span>{p.name}</span>
                        </div>
                      </td>
                      {dateKeys.map(dk => {
                        const unavailable = isParticipantUnavailableOn(p.id, dk);
                        const slotsForDate = dateSlotsMap[dk] ?? [];
                        const selectedSlotIds = Array.from(slotPrefMap[p.id] ?? new Set<string>());
                        const selectedSlotsOnDate = slotsForDate.filter(s => {
                          return selectedSlotIds.includes(s.id);
                        });

                        // Create unique hh:mm list so same start times across fields are shown only once
                        const uniqueTimes = Array.from(new Set(selectedSlotsOnDate.map(s => formatHHMMFromIso(s.start))));
                        const sortedTimes = sortHHMMArray(uniqueTimes.filter(Boolean));

                        return (
                          <td key={dk} className="px-3 py-2 align-top">
                            {unavailable ? (
                              <div className="text-red-600 font-semibold">Non disponibile</div>
                            ) : (
                              <>
                                {sortedTimes.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {sortedTimes.map(time => (
                                      <div key={time}>
                                        <span className="font-semibold text-xs text-green-600">{time}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-text-secondary">Non dichiarata</div>
                                )}
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Slots list (below table) - SHOW FULL DETAILS */}
          <div className="mt-6">
            <h4 className="font-semibold mb-3">Slot futuri creati dall'amministratore</h4>
            {futureSlots.length === 0 ? (
              <div className="bg-primary p-4 rounded-lg border border-tertiary">Nessuno slot futuro disponibile creato dall'amministratore per questo torneo.</div>
            ) : (
              <div className="space-y-4">
                {futureSlots.map(slot => {
                  const slotId = slot.id;
                  const slotDateKey = getAvailabilityDateKey(slot.start);
                  const myDateUnavail = loggedInPlayerId ? isParticipantUnavailableOn(loggedInPlayerId, slotDateKey) : false;
                  const interested = participants.filter(p => slotPrefMap[p.id]?.has(slotId)).map(p => p.name);
                  const myPref = loggedInPlayerId ? (slotPrefMap[loggedInPlayerId]?.has(slotId) ?? false) : false;
                  const startIso = slot.start;
                  const hhmm = formatHHMMFromIso(startIso); // e.g. "08:00"
                  const location = slot.location;
                  const field = slot.field;
                  return (
                    <div key={slotId} className="bg-primary p-3 rounded-lg border border-tertiary flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div>
                        <div className="text-sm text-text-secondary mb-1">{formatDisplayDateKey(slotDateKey)}</div>
                        <div className="font-semibold text-green-600 mb-1">{hhmm}</div>
                        <div className="text-sm text-text-secondary">
                          {location}{location && field ? " - " : ""}{field}
                        </div>
                        <div className="text-xs text-text-secondary mt-1">
                          {interested.length > 0 ? `${interested.length} interessati: ${interested.slice(0,5).join(', ')}${interested.length>5?'...':''}` : 'Nessuno interessato'}
                        </div>
                        {myDateUnavail && <div className="text-xs text-red-600 mt-1">Hai segnato NON disponibile per questa data — non puoi segnare interesse qui.</div>}
                      </div>

                      <div className="flex items-center gap-3">
                        {loggedInPlayerId ? (
                          <button
                            onClick={() => toggleMySlot(slotId)}
                            disabled={myDateUnavail}
                            className={`px-3 py-2 rounded font-semibold ${myPref ? 'bg-green-600 text-white' : 'bg-tertiary text-text-primary'} ${myDateUnavail ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            {myPref ? 'Segnato: Voglio giocare' : 'Segna: Voglio giocare'}
                          </button>
                        ) : (
                          <div className="text-sm text-text-secondary">Login per segnare interesse</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
