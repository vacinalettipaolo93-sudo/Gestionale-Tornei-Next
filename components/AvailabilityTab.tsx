// components/AvailabilityTab.tsx
import React, { useMemo, useState } from "react";
import { type Event, type Tournament, type Group, type Player, type TimeSlot } from "../types";
import {
  setSlotPreference,
  removeSlotPreference,
  setDateUnavailability,
  removeDateUnavailability,
  setTournamentVenues,
} from "../services/availabilityService";
import { getAvailabilityDateKey, getTournamentAvailabilitySlots } from "../utils/tournamentAvailability";
import { useTournamentAvailability } from "./useTournamentAvailability";
import { useSlotClock } from "./useSlotClock";
import { getSlotVenueId, TOURNAMENT_VENUES, type TournamentVenueId } from "../utils/tournamentVenues";
import { hasTournamentSlotPreference } from "../utils/matchFinder";

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

  const now = useSlotClock(event);
  const allFutureSlots = getTournamentAvailabilitySlots(event, tournament, now);
  const availabilityScope = { eventId: event.id, tournamentId: tournament.id };
  const availability = useTournamentAvailability(participantIds, availabilityScope);
  const { loading, error, slotPrefMap, dateUnavailMap, venueMap } = availability;
  const selectedVenues = loggedInPlayerId ? venueMap[loggedInPlayerId] : new Set(TOURNAMENT_VENUES.map(venue => venue.id));
  const [savingVenues, setSavingVenues] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const futureSlots = allFutureSlots.filter(slot => {
    const venueId = getSlotVenueId(slot);
    return !!selectedVenues && !!venueId && selectedVenues.has(venueId);
  });

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

  const [saveError, setSaveError] = useState<string | null>(null);
  const activeDate = dateKeys.includes(selectedDate) ? selectedDate : '';
  const visibleDateKeys = activeDate ? [activeDate] : [];
  const visibleSlots = futureSlots.filter(slot => getAvailabilityDateKey(slot.start) === activeDate);

  async function saveVenues(venueIds: TournamentVenueId[]) {
    if (!loggedInPlayerId || savingVenues) return;
    setSavingVenues(true);
    setSaveError(null);
    try {
      await setTournamentVenues(loggedInPlayerId, venueIds, availabilityScope);
      setSelectedDate('');
    } catch (cause) {
      console.error("Errore salvataggio centri di gioco:", cause);
      setSaveError("Impossibile salvare i centri di gioco. Riprova.");
    } finally {
      setSavingVenues(false);
    }
  }

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
        await setDateUnavailability(loggedInPlayerId, dateKey, true, availabilityScope);
      } else {
        await removeDateUnavailability(loggedInPlayerId, dateKey, availabilityScope);
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

  return (
    <div className="max-w-6xl mx-auto bg-secondary rounded-xl p-6 shadow space-y-6">
      <h3 className="text-xl font-bold text-accent">Disponibilità di gioco</h3>
      <p className="text-sm text-text-secondary">
        Scegli prima il centro o entrambi, poi la data e gli orari in cui vuoi giocare.
        Cerca partita mostra prima le coincidenze di centro, data e ora, poi le alternative da concordare.
        Non aver escluso una data non equivale ad aver dichiarato disponibilità.
      </p>
      {saveError && <p role="alert" className="text-red-400">{saveError}</p>}
      <fieldset className="space-y-3">
        <legend className="font-bold mb-3">1. Dove vuoi giocare?</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {[...TOURNAMENT_VENUES.map(venue => ({ name: venue.name, ids: [venue.id] })), {
            name: 'Entrambi i centri', ids: TOURNAMENT_VENUES.map(venue => venue.id),
          }].map(choice => {
            const selected = selectedVenues?.size === choice.ids.length && choice.ids.every(id => selectedVenues.has(id));
            return (
              <button
                key={choice.name}
                type="button"
                aria-pressed={!!selected}
                disabled={!loggedInPlayerId || savingVenues}
                onClick={() => saveVenues(choice.ids)}
                className={`p-4 rounded-lg border-2 font-semibold disabled:opacity-50 ${selected ? 'border-accent bg-accent/20 text-accent' : 'border-tertiary bg-primary'}`}
              >
                {choice.name}
              </button>
            );
          })}
        </div>
        <p className="text-sm text-text-secondary">
          La scelta viene salvata. Solo gli orari dei centri selezionati contano per i suggerimenti.
          Le preferenze precedenti degli altri centri restano archiviate e tornano attive se li selezioni di nuovo.
        </p>
        {savingVenues && <p role="status">Salvataggio centri…</p>}
      </fieldset>
      {selectedVenues && (
        <div className="space-y-2">
          <label htmlFor="availability-date" className="font-bold block">2. Scegli la data di gioco, poi gli orari</label>
          <select
            id="availability-date"
            value={activeDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="bg-primary border border-tertiary text-text-primary rounded-lg px-3 py-2"
          >
            <option value="">Seleziona una data</option>
            {dateKeys.map(date => <option key={date} value={date}>{formatDisplayDateKey(date)}</option>)}
          </select>
          {dateKeys.length === 0 && <p className="text-text-secondary">Nessuna data con slot futuri liberi per i centri scelti.</p>}
          <p className="text-sm text-text-secondary">Puoi indicare più orari e cambiare data per aggiungere altre disponibilità: ogni scelta viene salvata.</p>
        </div>
      )}
      {!selectedVenues && <p className="text-text-secondary">Seleziona un centro o entrambi per vedere le date disponibili.</p>}
      {activeDate && (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: per-date toggles */}
        <div className="lg:col-span-1 bg-primary p-4 rounded-lg border border-tertiary space-y-4">
          <h4 className="font-semibold">Non disponibile per date</h4>
          {visibleDateKeys.length === 0 ? (
            <div className="text-text-secondary text-sm">Nessuna data futura (gli slot futuri non sono presenti).</div>
          ) : (
            <div className="space-y-2 max-h-[52vh] overflow-auto pr-2">
              {visibleDateKeys.map(dk => {
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

          {visibleDateKeys.length === 0 ? (
            <div className="bg-primary p-4 rounded-lg border border-tertiary">Nessuna data futura disponibile.</div>
          ) : (
            <div className="overflow-auto bg-primary p-3 rounded-lg border border-tertiary">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="text-left pr-4 pb-2 font-semibold">Giocatore</th>
                    {visibleDateKeys.map(dk => (
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
                      {visibleDateKeys.map(dk => {
                        const unavailable = isParticipantUnavailableOn(p.id, dk);
                        const slotsForDate = dateSlotsMap[dk] ?? [];
                        const selectedSlotsOnDate = slotsForDate.filter(slot => hasTournamentSlotPreference(availability, p.id, slot));

                        // Create unique hh:mm list so same start times across fields are shown only once
                        const sortedTimes = [...new Set(selectedSlotsOnDate.map(slot => `${slot.location} · ${formatHHMMFromIso(slot.start)}`))];

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
            {visibleSlots.length === 0 ? (
              <div className="bg-primary p-4 rounded-lg border border-tertiary">Nessuno slot futuro disponibile creato dall'amministratore per questa data e questi centri.</div>
            ) : (
              <div className="space-y-4">
                {visibleSlots.map(slot => {
                  const slotId = slot.id;
                  const slotDateKey = getAvailabilityDateKey(slot.start);
                  const myDateUnavail = loggedInPlayerId ? isParticipantUnavailableOn(loggedInPlayerId, slotDateKey) : false;
                  const interested = participants.filter(p => hasTournamentSlotPreference(availability, p.id, slot)).map(p => p.name);
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
      )}
    </div>
  );
}
