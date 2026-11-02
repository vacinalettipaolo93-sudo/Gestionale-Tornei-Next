import React, { useMemo, useState } from "react";
import { type Event, type Player, type Tournament } from "../types";

/**
 * AdminMatchCounts
 *
 * - Mostra solo i giocatori assegnati ad almeno un torneo/girone.
 * - Conta per ogni giocatore:
 *    played     = numero di match completati (status === 'completed' || 'finished') nel suo girone
 *    scheduled  = numero di match non completati ma effettivamente prenotati/assegnati a uno slot (nel suo girone)
 *    expected   = numero totale di match che il giocatore deve disputare nel girone (calcolato dalle matches del girone)
 *    remaining  = expected - played (min 0)
 * - Filtro "Mostra fino a" ora supporta anche il valore speciale 'completed' che mostra
 *   solo i giocatori che hanno finito tutte le partite del loro girone (remaining === 0).
 *
 * - Quando è selezionato 'completed' la lista mostra una singola sezione "Completati".
 * - Altrimenti la lista viene raggruppata per numero di partite giocate (0..N).
 */

type Row = {
  playerId: string;
  name: string;
  played: number;
  scheduled: number;
  expected: number;
  remaining: number;
  tournamentId?: string;
  tournamentName?: string;
  groupId?: string;
  groupName?: string;
};

export default function AdminMatchCounts({
  event,
  defaultMax = 4,
  onSelectTournament,
}: {
  event: Event;
  defaultMax?: number;
  onSelectTournament?: (t: Tournament, initialTab?: string, initialGroupId?: string) => void;
}) {
  // filter can be number or the special string 'completed'
  const [filter, setFilter] = useState<number | "completed">(defaultMax);
  const [tournamentId, setTournamentId] = useState('');
  const [groupId, setGroupId] = useState('');
  const selectedTournament = event.tournaments.find(tournament => tournament.id === tournamentId);
  const selectedGroup = selectedTournament?.groups.find(group => group.id === groupId);

  // Compute full list of rows (no filter applied here)
  const allRows: Row[] = useMemo(() => {
    // Build placement map: first tournament/group where player appears
    const placement = new Map<string, { tournamentId: string; tournamentName?: string; groupId: string; groupName?: string }>();
    (Array.isArray(event.tournaments) ? event.tournaments : []).forEach(t => {
      (Array.isArray(t.groups) ? t.groups : []).forEach((g: any) => {
        (Array.isArray(g.playerIds) ? g.playerIds : []).forEach((pid: string) => {
          if (!placement.has(pid)) {
            placement.set(pid, { tournamentId: t.id, tournamentName: t.name, groupId: g.id, groupName: g.name });
          }
        });
      });
    });

    // If no placements, return empty
    if (placement.size === 0) return [];

    // Build set of booked match ids by scanning tournament.timeSlots and event.globalTimeSlots
    const bookedMatchIds = new Set<string>();
    (Array.isArray(event.tournaments) ? event.tournaments : []).forEach(t => {
      if (Array.isArray((t as any).timeSlots)) {
        (t as any).timeSlots.forEach((ts: any) => {
          if (ts && ts.matchId) bookedMatchIds.add(String(ts.matchId));
        });
      }
    });
    if (Array.isArray((event as any).globalTimeSlots)) {
      (event as any).globalTimeSlots.forEach((ts: any) => {
        if (ts && ts.matchId) bookedMatchIds.add(String(ts.matchId));
      });
    }

    // For each player assigned, compute expected (matches in their group), played and scheduled (only within that group)
    const resultRows: Row[] = [];

    (Array.isArray(event.tournaments) ? event.tournaments : []).forEach((t) => {
      (Array.isArray(t.groups) ? t.groups : []).forEach((g: any) => {
        // Build a map of matches in this group for quick lookup
        const groupMatches = Array.isArray(g.matches) ? g.matches : [];

        // Precompute per-player counts for this group
        const perPlayerPlayed = new Map<string, number>();
        const perPlayerScheduled = new Map<string, number>();
        const perPlayerExpected = new Map<string, number>();

        // expected: count how many matches in group involve each player
        groupMatches.forEach((m: any) => {
          const p1: string | undefined = m?.player1Id;
          const p2: string | undefined = m?.player2Id;
          if (p1) perPlayerExpected.set(p1, (perPlayerExpected.get(p1) || 0) + 1);
          if (p2) perPlayerExpected.set(p2, (perPlayerExpected.get(p2) || 0) + 1);
        });

        // compute played/scheduled limited to group matches
        groupMatches.forEach((m: any) => {
          const matchId = m?.id ?? m?.matchId ?? null;
          const p1: string | undefined = m?.player1Id;
          const p2: string | undefined = m?.player2Id;
          const status: string | undefined = m?.status;
          const isCompleted = status === "completed" || status === "finished";

          // Determine if this match is actually booked:
          const hasDate = !!(m?.date || m?.start || m?.time);
          const hasTimeSlotField = !!(m?.timeSlotId || m?.slotId || m?.matchId);
          const isBooked = (matchId && bookedMatchIds.has(String(matchId))) || hasDate || hasTimeSlotField;

          if (p1 && placement.has(p1)) {
            if (isCompleted) perPlayerPlayed.set(p1, (perPlayerPlayed.get(p1) || 0) + 1);
            else if (isBooked) perPlayerScheduled.set(p1, (perPlayerScheduled.get(p1) || 0) + 1);
          }
          if (p2 && placement.has(p2)) {
            if (isCompleted) perPlayerPlayed.set(p2, (perPlayerPlayed.get(p2) || 0) + 1);
            else if (isBooked) perPlayerScheduled.set(p2, (perPlayerScheduled.get(p2) || 0) + 1);
          }
        });

        // For each player in this group, push a row (only for players assigned to a group)
        (Array.isArray(g.playerIds) ? g.playerIds : []).forEach((pid: string) => {
          if (!placement.has(pid)) return;
          // find player name from event.players
          const pDoc = (Array.isArray(event.players) ? event.players : []).find((pl: Player) => pl.id === pid);
          const name = pDoc?.name ?? pDoc?.nickname ?? pid;
          const expected = perPlayerExpected.get(pid) || 0;
          const played = perPlayerPlayed.get(pid) || 0;
          const scheduled = perPlayerScheduled.get(pid) || 0;
          const remaining = Math.max(0, expected - played);

          resultRows.push({
            playerId: pid,
            name,
            played,
            scheduled,
            expected,
            remaining,
            tournamentId: t.id,
            tournamentName: t.name,
            groupId: g.id,
            groupName: g.name,
          });
        });
      });
    });

    return resultRows;
  }, [event]);

  // Derive displayed rows based on filter
  const displayedRows = useMemo(() => {
    const scopedRows = allRows.filter(row =>
      (!selectedTournament || row.tournamentId === selectedTournament.id)
      && (!selectedGroup || row.groupId === selectedGroup.id)
    );
    if (filter === "completed") {
      return scopedRows.filter(r => r.remaining === 0).sort((a, b) => a.name.localeCompare(b.name));
    }
    const num = Number(filter);
    return scopedRows
      .filter(r => r.played <= num)
      .sort((a, b) => a.played - b.played || a.name.localeCompare(b.name));
  }, [allRows, filter, selectedTournament, selectedGroup]);

  // Build grouping structure depending on filter
  const grouped = useMemo(() => {
    if (filter === "completed") {
      return { completed: displayedRows };
    }
    const max = Number(filter);
    const groups: Record<number, Row[]> = {};
    for (let i = 0; i <= max; i++) groups[i] = [];
    displayedRows.forEach(r => {
      if (r.played <= max) groups[r.played]?.push(r);
    });
    return groups;
  }, [displayedRows, filter]);

  function handlePlayerClick(row: Row) {
    if (!onSelectTournament) return;
    if (!row.tournamentId) return;
    const t = (event.tournaments ?? []).find(tt => tt.id === row.tournamentId);
    if (!t) return;
    onSelectTournament(t, 'participants', row.groupId);
  }

  return (
    <div className="bg-secondary/90 p-4 rounded-xl mb-6 border border-tertiary">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 className="text-xl font-bold text-accent">Controllo partite giocatori (Admin)</h3>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="matchTournamentFilter" className="text-sm text-text-secondary">Torneo:</label>
          <select
            id="matchTournamentFilter"
            value={selectedTournament?.id ?? ''}
            onChange={e => { setTournamentId(e.target.value); setGroupId(''); }}
            className="bg-primary border border-tertiary text-text-primary rounded px-2 py-1"
          >
            <option value="">Tutti i tornei</option>
            {event.tournaments.map(tournament => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}
          </select>
          <label htmlFor="matchGroupFilter" className="text-sm text-text-secondary">Girone:</label>
          <select
            id="matchGroupFilter"
            value={selectedGroup?.id ?? ''}
            onChange={e => setGroupId(e.target.value)}
            disabled={!selectedTournament}
            className="bg-primary border border-tertiary text-text-primary rounded px-2 py-1 disabled:opacity-50"
          >
            <option value="">{selectedTournament ? 'Tutti i gironi' : 'Seleziona prima un torneo'}</option>
            {(selectedTournament?.groups ?? []).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
          <label htmlFor="matchFilter" className="text-sm text-text-secondary mr-2">Mostra:</label>
          <select
            id="matchFilter"
            value={filter}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "completed") setFilter("completed");
              else setFilter(Number(v));
            }}
            className="bg-primary border border-tertiary text-text-primary rounded px-2 py-1"
          >
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 10].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
            <option value="completed">Completato</option>
          </select>
        </div>
      </div>

      <div>
        {filter === "completed" ? (
          <section>
            <h4 className="text-sm font-semibold text-text-secondary mb-2">Completati</h4>
            {grouped.completed && grouped.completed.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full table-auto text-sm">
                  <thead>
                    <tr className="text-left text-text-secondary">
                      <th className="pr-6">Giocatore</th>
                      <th className="pr-6">Torneo / Girone</th>
                      <th className="pr-6">Previste</th>
                      <th className="pr-6">Giocate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.completed.map(r => (
                      <tr key={`${r.tournamentId}:${r.groupId}:${r.playerId}`} className="border-t border-tertiary/40">
                        <td
                          className={`py-2 ${r.tournamentId ? 'cursor-pointer text-accent hover:underline' : ''}`}
                          onClick={() => r.tournamentId && handlePlayerClick(r)}
                        >
                          {r.name}
                        </td>
                        <td className="py-2 text-text-secondary text-sm">
                          {r.tournamentName ? (
                            <>
                              <span className="font-semibold text-text-primary">{r.tournamentName}</span>
                              {r.groupName ? <span className="ml-2">/ <span className="font-medium">{r.groupName}</span></span> : null}
                            </>
                          ) : <span className="text-text-secondary">—</span>}
                        </td>
                        <td className="py-2">{r.expected}</td>
                        <td className="py-2">{r.played}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-text-secondary text-sm">Nessun giocatore completato.</div>
            )}
          </section>
        ) : (
          // numeric grouping 0..N
          Object.keys(grouped).map((k) => {
            const idx = Number(k);
            const groupRows = (grouped as Record<number, Row[]>)[idx] || [];
            return (
              <section key={k} className="mb-4">
                <h4 className="text-sm font-semibold text-text-secondary mb-2">{idx} partite</h4>
                {groupRows.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full table-auto text-sm">
                      <thead>
                        <tr className="text-left text-text-secondary">
                          <th className="pr-6">Giocatore</th>
                          <th className="pr-6">Torneo / Girone</th>
                          <th className="pr-6">Previste</th>
                          <th className="pr-6">Giocate</th>
                          <th className="pr-6">In programma</th>
                          <th className="pr-6">Rimanenti</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupRows.map(r => (
                          <tr key={`${r.tournamentId}:${r.groupId}:${r.playerId}`} className="border-t border-tertiary/40">
                            <td
                              className={`py-2 ${r.tournamentId ? 'cursor-pointer text-accent hover:underline' : ''}`}
                              onClick={() => r.tournamentId && handlePlayerClick(r)}
                              title={r.tournamentId ? 'Vai al torneo e al girone del giocatore' : 'Giocatore non assegnato a nessun torneo'}
                            >
                              {r.name}
                            </td>
                            <td className="py-2 text-text-secondary text-sm">
                              {r.tournamentName ? (
                                <>
                                  <span className="font-semibold text-text-primary">{r.tournamentName}</span>
                                  {r.groupName ? <span className="ml-2">/ <span className="font-medium">{r.groupName}</span></span> : null}
                                </>
                              ) : <span className="text-text-secondary">—</span>}
                            </td>
                            <td className="py-2">{r.expected}</td>
                            <td className="py-2">{r.played}</td>
                            <td className="py-2">{r.scheduled}</td>
                            <td className="py-2">{r.remaining}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-text-secondary text-sm">Nessun giocatore con {idx} partite</div>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
