import React, { useEffect, useMemo, useState } from 'react';
import { saveEventChanges } from '../services/eventDataService';
import { type Event, type Match, type Player, type PlayoffBracket, type PlayoffMatch, type Tournament } from '../types';
import { getTournamentCompetitors } from '../utils/padel';
import { calculateStandings } from '../utils/standings';
import { PersistenceFeedback, usePersistenceAction } from './usePersistenceAction';

interface PlayoffsProps {
  event: Event;
  tournament: Tournament;
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  isOrganizer: boolean;
  loggedInPlayerId?: string;
  onEditResult: (match: Match) => void;
}

type PlayoffWithdrawal = { groupId: string; playerId: string };
type TournamentWithWithdrawals = Tournament & {
  playoffWithdrawals?: PlayoffWithdrawal[];
  playoffMatches?: Match[];
};

function playoffMatchToLeagueMatchId(playoffMatchId: string) {
  return `po-${playoffMatchId}`;
}

function buildLeagueMatchFromPlayoffMatch(pm: PlayoffMatch): Match | null {
  if (!pm.player1Id || !pm.player2Id) return null;
  return {
    id: playoffMatchToLeagueMatchId(pm.id),
    player1Id: pm.player1Id,
    player2Id: pm.player2Id,
    score1: pm.score1,
    score2: pm.score2,
    status: pm.score1 != null && pm.score2 != null ? 'completed' : 'pending',
  };
}

const Playoffs: React.FC<PlayoffsProps> = ({ event, tournament, setEvents, isOrganizer, loggedInPlayerId, onEditResult }) => {
    const persistence = usePersistenceAction();
  const tt = tournament as TournamentWithWithdrawals;
  const competitors = useMemo(() => getTournamentCompetitors(event, tournament), [event.players, tournament]);

  const [view, setView] = useState<'setup' | 'bracket'>(tournament.playoffs?.isGenerated ? 'bracket' : 'setup');

  // --- NEW: withdrawals managed BEFORE generation (only affects playoff qualifiers) ---
  const playoffWithdrawals = useMemo<PlayoffWithdrawal[]>(
    () => Array.isArray(tt.playoffWithdrawals) ? tt.playoffWithdrawals : [],
    [tt.playoffWithdrawals]
  );

  const isWithdrawn = (groupId: string, playerId: string) =>
    playoffWithdrawals.some(w => w.groupId === groupId && w.playerId === playerId);

  // NEW UI state (setup): manage withdrawals
  const [withdrawGroupId, setWithdrawGroupId] = useState<string>('');
  const [withdrawPlayerId, setWithdrawPlayerId] = useState<string>('');
  const [withdrawError, setWithdrawError] = useState<string>('');
  const [withdrawSaving, setWithdrawSaving] = useState<boolean>(false);

  // Qualifiers with "scaling": if a top player withdraws, the next ranked players fill the quota.
  const qualifiers = useMemo(() => {
    const allQualifiers: { playerId: string, rank: number, fromGroup: string, groupName: string }[] = [];

    tournament.groups.forEach(group => {
      const setting = tournament.settings.playoffSettings.find(s => s.groupId === group.id);
      if (!setting || !(setting.numQualifiers > 0)) return;

      const standings = calculateStandings(group, competitors, tournament.settings);

      // exclude withdrawals ONLY for playoff qualification
      const eligible = standings.filter(entry => !isWithdrawn(group.id, entry.playerId));

      const groupQualifiers = eligible.slice(0, setting.numQualifiers).map((entry, index) => ({
        playerId: entry.playerId,
        rank: index + 1, // recalculated after withdrawals => "scaling"
        fromGroup: group.id,
        groupName: group.name,
      }));

      allQualifiers.push(...groupQualifiers);
    });

    return allQualifiers;
  }, [tournament, competitors, playoffWithdrawals]);

  const bracketSize = useMemo(() => {
    const numPlayers = qualifiers.length;
    if (numPlayers < 2) return 0;
    return 2 ** Math.ceil(Math.log2(numPlayers));
  }, [qualifiers]);

  const [firstRoundAssignments, setFirstRoundAssignments] = useState<(string | null)[]>([]);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  useEffect(() => {
    if (view === 'setup') {
      setFirstRoundAssignments(Array(bracketSize).fill(null));
    }
  }, [qualifiers, view, bracketSize]);

  const getPlayer = (id: string | null): Player | null => id ? competitors.find(p => p.id === id) ?? null : null;

  const handleAssignmentChange = (slotIndex: number, value: string) => {
    setFirstRoundAssignments(prev => {
      const newAssignments = [...prev];
      const existingIndex = newAssignments.findIndex(v => v === value);
      if (existingIndex !== -1 && value !== 'BYE') {
        newAssignments[existingIndex] = null;
      }
      newAssignments[slotIndex] = value === '' ? null : value;
      return newAssignments;
    });
  };

  const saveWithdrawalsToFirestore = async (nextWithdrawals: PlayoffWithdrawal[]) => {
    const updatedTournaments = event.tournaments.map(t =>
      t.id === tournament.id ? ({ ...t, playoffWithdrawals: nextWithdrawals } as any) : t
    );

    await saveEventChanges(event, { tournaments: updatedTournaments });
  };

  const handleAddWithdrawal = async () => {
    setWithdrawError('');

    if (!withdrawGroupId) {
      setWithdrawError('Seleziona un girone.');
      return;
    }
    if (!withdrawPlayerId) {
      setWithdrawError('Seleziona il giocatore che si ritira.');
      return;
    }

    // allow only BEFORE generation (setup)
    if (tournament.playoffs?.isGenerated) {
      setWithdrawError('Puoi gestire i ritiri solo prima della generazione del tabellone (resetta il tabellone).');
      return;
    }

    if (isWithdrawn(withdrawGroupId, withdrawPlayerId)) {
      setWithdrawError('Questo giocatore è già segnato come ritirato dai playoff.');
      return;
    }

    setWithdrawSaving(true);
    try {
      const next = [...playoffWithdrawals, { groupId: withdrawGroupId, playerId: withdrawPlayerId }];
      await saveWithdrawalsToFirestore(next);

      // reset selection
      setWithdrawPlayerId('');
    } catch (err) {
      console.error('Errore salvataggio ritiro', err);
      setWithdrawError('Errore durante il salvataggio del ritiro.');
    } finally {
      setWithdrawSaving(false);
    }
  };

  const handleRemoveWithdrawal = async (groupId: string, playerId: string) => {
    setWithdrawError('');

    if (tournament.playoffs?.isGenerated) {
      setWithdrawError('Puoi modificare i ritiri solo prima della generazione del tabellone (resetta il tabellone).');
      return;
    }

    setWithdrawSaving(true);
    try {
      const next = playoffWithdrawals.filter(w => !(w.groupId === groupId && w.playerId === playerId));
      await saveWithdrawalsToFirestore(next);
    } catch (err) {
      console.error('Errore rimozione ritiro', err);
      setWithdrawError('Errore durante la rimozione del ritiro.');
    } finally {
      setWithdrawSaving(false);
    }
  };

  const handleGenerateBracket = async () => {
    await persistence.run(async () => {
      if (firstRoundAssignments.some(a => a === null)) {
        alert("Per favore, riempi tutti gli slot del primo turno.");
        return;
      }

      const newMatches: PlayoffMatch[] = [];
      const numRounds = Math.log2(bracketSize);
      let matchCounter = 0;

      for (let round = 1; round <= numRounds; round++) {
        const matchesInRound = bracketSize / (2 ** round);
        for (let i = 0; i < matchesInRound; i++) {
          newMatches.push({
            id: `plm-${matchCounter}`, round, matchIndex: matchCounter,
            player1Id: null, player2Id: null, score1: null, score2: null,
            winnerId: null, nextMatchId: null,
            loserGoesToBronzeFinal: round === numRounds - 1,
          });
          matchCounter++;
        }
      }

      newMatches.forEach(match => {
        if (match.round < numRounds) {
          const roundMatches = newMatches.filter(m => m.round === match.round);
          const matchIndexInRound = roundMatches.findIndex(m => m.id === match.id);
          const nextRoundMatches = newMatches.filter(m => m.round === match.round + 1);
          const nextMatch = nextRoundMatches[Math.floor(matchIndexInRound / 2)];
          if (nextMatch) match.nextMatchId = nextMatch.id;
        }
      });

      let bronzeFinalId: string | null = null;
      if (bracketSize > 2 && tournament.settings.hasBronzeFinal) {
        const bronzeMatch: PlayoffMatch = {
          id: `plm-bronze`, isBronzeFinal: true, round: numRounds, matchIndex: 999,
          player1Id: null, player2Id: null, score1: null, score2: null, winnerId: null, nextMatchId: null
        };
        newMatches.push(bronzeMatch);
        bronzeFinalId = bronzeMatch.id;
      }

      const firstRoundMatches = newMatches.filter(m => m.round === 1 && !m.isBronzeFinal);
      firstRoundMatches.forEach((match, i) => {
        const p1Id = firstRoundAssignments[i * 2];
        const p2Id = firstRoundAssignments[i * 2 + 1];
        const isP1Bye = p1Id === 'BYE';
        const isP2Bye = p2Id === 'BYE';

        match.player1Id = isP1Bye ? null : p1Id;
        match.player2Id = isP2Bye ? null : p2Id;

        let winnerId: string | null = null;
        if (!isP1Bye && isP2Bye) winnerId = p1Id;
        if (isP1Bye && !isP2Bye) winnerId = p2Id;

        if (winnerId) {
          match.winnerId = winnerId;
          const nextMatch = newMatches.find(m => m.id === match.nextMatchId);
          if (nextMatch) {
            const matchIndexInRound = firstRoundMatches.findIndex(m => m.id === match.id);
            if (matchIndexInRound % 2 === 0) nextMatch.player1Id = winnerId;
            else nextMatch.player2Id = winnerId;
          }
        }
      });

      const finalBracket: PlayoffBracket = {
        matches: newMatches, isGenerated: true,
        finalId: newMatches.find(m => m.round === numRounds && !m.isBronzeFinal)?.id ?? null,
        bronzeFinalId: bronzeFinalId,
      };

      // Create "league" matches for tab Partite
      const playoffMatches: Match[] = [];
      for (const pm of newMatches) {
        if (pm.isBronzeFinal) continue;
        const m = buildLeagueMatchFromPlayoffMatch(pm);
        if (m) playoffMatches.push(m);
      }

      const updatedTournaments = event.tournaments.map(t =>
        t.id === tournament.id
          ? { ...t, playoffs: finalBracket, playoffMatches }
          : t
      );

      await saveEventChanges(event, { tournaments: updatedTournaments });

      setView('bracket');
    });
  };

  const handleResetBracket = async () => {
    await persistence.run(async () => {
      const resetBracket: PlayoffBracket = {
        ...(tournament.playoffs ?? { matches: [], isGenerated: false, finalId: null, bronzeFinalId: null }),
        isGenerated: false,
        matches: [],
        finalId: null,
        bronzeFinalId: null,
      };

      const updatedTournaments = event.tournaments.map(t =>
        t.id === tournament.id
          ? { ...t, playoffs: resetBracket, playoffMatches: [] }
          : t
      );

      await saveEventChanges(event, { tournaments: updatedTournaments });

      setView('setup');
      setIsResetModalOpen(false);
    });
  };

  if (view === 'setup') {
    if (!isOrganizer) return <React.Fragment><PersistenceFeedback persistence={persistence} />{<p className="text-text-secondary text-center">Il tabellone dei playoff non è stato ancora generato.</p>}</React.Fragment>;

    const unassignedPlayers = qualifiers.filter(q => !firstRoundAssignments.includes(q.playerId));
    const numByesAvailable = bracketSize - qualifiers.length;
    const byesAssigned = firstRoundAssignments.filter(a => a === 'BYE').length;

    const AssignmentSlot = ({ slotIndex }: { slotIndex: number }) => {
      const currentValue = firstRoundAssignments[slotIndex];
      const currentPlayer = getPlayer(currentValue);
      return (
        <select
          value={currentValue ?? ''}
          onChange={(e) => handleAssignmentChange(slotIndex, e.target.value)}
          className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary focus:ring-2 focus:ring-accent"
        >
          <option value="">-- Seleziona --</option>
          {currentValue && currentValue !== 'BYE' && <option value={currentValue}>{currentPlayer?.name}</option>}
          {unassignedPlayers.map(p => (
            <option key={p.playerId} value={p.playerId}>{getPlayer(p.playerId)?.name}</option>
          ))}
          {(byesAssigned < numByesAvailable || currentValue === 'BYE') && <option value="BYE">-- BYE --</option>}
        </select>
      );
    };

    const groupOptions = (tournament.groups ?? []).map(g => ({ id: g.id, name: g.name }));

    const selectedWithdrawGroup = withdrawGroupId
      ? tournament.groups.find(g => g.id === withdrawGroupId) ?? null
      : null;

    const withdrawGroupStandings = selectedWithdrawGroup
      ? calculateStandings(selectedWithdrawGroup, competitors, tournament.settings)
      : [];

    return <React.Fragment><PersistenceFeedback persistence={persistence} />{(
      <div className="bg-secondary p-6 rounded-xl shadow-lg max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <h3 className="text-xl font-bold mb-2 text-accent">Costruttore Tabellone Playoff</h3>
          <p className="text-text-secondary mb-6">Assegna manualmente i giocatori o i "bye" agli slot del primo turno.</p>

          {/* NEW: Withdrawals management (pre-generation) */}
          <div className="bg-primary/40 border border-tertiary/60 rounded-lg p-4 mb-6">
            <h4 className="text-lg font-bold text-accent mb-2">Gestione ritiri (solo playoff)</h4>
            <p className="text-xs text-text-secondary mb-3">
              Se un giocatore si ritira prima della generazione, verrà escluso dai playoff e i qualificati scaleranno automaticamente (es: 1° out → entra il 5°).
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-text-secondary font-semibold">Girone</label>
                <select
                  value={withdrawGroupId}
                  onChange={(e) => { setWithdrawGroupId(e.target.value); setWithdrawPlayerId(''); setWithdrawError(''); }}
                  className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary"
                >
                  <option value="">-- seleziona girone --</option>
                  {groupOptions.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-sm text-text-secondary font-semibold">Giocatore ritirato</label>
                <select
                  value={withdrawPlayerId}
                  onChange={(e) => { setWithdrawPlayerId(e.target.value); setWithdrawError(''); }}
                  className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary"
                  disabled={!withdrawGroupId}
                >
                  <option value="">-- seleziona giocatore --</option>
                  {withdrawGroupStandings.map((s, idx) => {
                    const p = getPlayer(s.playerId);
                    const already = isWithdrawn(withdrawGroupId, s.playerId);
                    return (
                      <option key={s.playerId} value={s.playerId} disabled={already}>
                        {idx + 1}° {p?.name ?? s.playerId}{already ? ' (già ritirato)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={handleAddWithdrawal}
                disabled={withdrawSaving || !withdrawGroupId || !withdrawPlayerId}
                className="bg-highlight text-white font-bold px-4 py-2 rounded-lg disabled:bg-tertiary disabled:cursor-not-allowed"
              >
                {withdrawSaving ? 'Salvataggio...' : 'Segna ritiro'}
              </button>
              {withdrawError && <div className="text-red-500 font-bold text-sm">{withdrawError}</div>}
            </div>

            {playoffWithdrawals.length > 0 && (
              <div className="mt-4">
                <div className="text-sm font-bold text-text-secondary mb-2">Ritiri attivi:</div>
                <ul className="space-y-2">
                  {playoffWithdrawals.map(w => {
                    const g = tournament.groups.find(gr => gr.id === w.groupId);
                    const p = getPlayer(w.playerId);
                    return (
                      <li key={`${w.groupId}-${w.playerId}`} className="flex items-center justify-between bg-secondary/40 border border-tertiary/50 rounded-lg px-3 py-2">
                        <div className="text-sm">
                          <span className="font-bold text-white">{p?.name ?? w.playerId}</span>
                          <span className="text-text-secondary"> — {g?.name ?? w.groupId}</span>
                        </div>
                        <button
                          onClick={() => handleRemoveWithdrawal(w.groupId, w.playerId)}
                          disabled={withdrawSaving}
                          className="text-xs bg-tertiary hover:bg-tertiary/80 text-white font-bold px-3 py-1 rounded disabled:opacity-60"
                        >
                          Rimuovi
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {bracketSize > 0 ? Array.from({ length: bracketSize / 2 }).map((_, index) => (
              <div key={index} className="bg-primary/50 p-4 rounded-lg flex items-center gap-4">
                <span className="font-bold text-text-secondary">M{index + 1}</span>
                <div className="flex-1"><AssignmentSlot slotIndex={index * 2} /></div>
                <span className="text-tertiary">vs</span>
                <div className="flex-1"><AssignmentSlot slotIndex={index * 2 + 1} /></div>
              </div>
            )) : <p className="text-text-secondary">Non ci sono abbastanza qualificati per un playoff.</p>}
          </div>

          <div className="mt-8">
            <button
              onClick={handleGenerateBracket}
              disabled={firstRoundAssignments.some(a => a === null) || qualifiers.length < 2}
              className="w-full bg-highlight hover:bg-highlight/90 text-white font-bold py-3 px-6 rounded-lg transition-colors disabled:bg-tertiary disabled:cursor-not-allowed shadow-lg shadow-highlight/20"
            >
              Genera Tabellone
            </button>
          </div>
        </div>

        <div className="sticky top-4">
          <h4 className="font-semibold text-xl mb-4 text-accent">Riepilogo</h4>
          <div className="bg-primary/50 p-4 rounded-lg mb-6">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div><div className="text-2xl font-bold">{qualifiers.length}</div><div className="text-sm text-text-secondary">Qualificati</div></div>
              <div><div className="text-2xl font-bold">{bracketSize}</div><div className="text-sm text-text-secondary">Posti</div></div>
              <div><div className="text-2xl font-bold">{Math.max(0, bracketSize - qualifiers.length)}</div><div className="text-sm text-text-secondary">Bye</div></div>
            </div>
          </div>

          <h4 className="font-semibold text-lg mb-3">Giocatori da Assegnare</h4>
          <div className="space-y-2">
            {unassignedPlayers.length > 0 ? unassignedPlayers.map(q => {
              const player = getPlayer(q.playerId);
              return (
                <div key={q.playerId} className="bg-tertiary/50 p-2 rounded-lg flex items-center gap-3">
                  <img src={player?.avatar} alt={player?.name} className="w-8 h-8 rounded-full" />
                  <div>
                    <div className="font-semibold text-sm">{player?.name}</div>
                    <div className="text-xs text-text-secondary">{q.rank}° class. {q.groupName}</div>
                  </div>
                </div>
              );
            }) : <p className="text-text-secondary text-sm italic">Tutti i giocatori sono stati assegnati.</p>}
          </div>
        </div>
      </div>
    )}</React.Fragment>;
  }

  // ----------------
  // BRACKET VIEW (resto invariato dal tuo file)
  // ----------------
  const { matches, bronzeFinalId } = tournament.playoffs!;
  const maxRound = Math.max(0, ...matches.filter(m => !m.isBronzeFinal).map(m => m.round));

  const getRoundName = (round: number) => {
    const totalRounds = maxRound;
    if (round === totalRounds) return "Finale";
    if (round === totalRounds - 1) return "Semifinali";
    if (round === totalRounds - 2) return "Quarti di Finale";
    return `Turno ${round}`;
  };

  const PlayerInMatch = ({ player, winnerId }: { player: Player | null; winnerId: string | null }) => {
    if (!player) return <span className="text-text-secondary">TBD</span>;
    const isWinner = winnerId === player.id;
    const isLoser = winnerId !== null && !isWinner;
    const isLoggedUser = player.id === loggedInPlayerId;

    return (
      <span className="inline-flex items-center gap-2 min-w-0">
        <img src={player.avatar} alt={player.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
        <span className={`truncate ${isWinner ? 'font-bold text-text-primary' : isLoser ? 'text-text-secondary/70 line-through' : 'text-text-secondary'} ${isLoggedUser ? 'text-accent font-bold' : ''}`}>
          {player.name}
        </span>
      </span>
    );
  };

  const MatchCard = ({ match }: { match: PlayoffMatch }) => {
    const p1 = getPlayer(match.player1Id);
    const p2 = getPlayer(match.player2Id);
    const canEdit = match.player1Id && match.player2Id
      && (isOrganizer || !!loggedInPlayerId && [match.player1Id, match.player2Id].includes(loggedInPlayerId));

    return (
      <div className={`bg-secondary p-2 rounded-lg w-full`}>
        <div className="flex justify-between items-center text-sm">
          <PlayerInMatch player={p1} winnerId={match.winnerId} />
          {match.score1 !== null && <span className={`font-bold ${match.winnerId === p1?.id ? 'text-accent' : 'text-text-primary'}`}>{match.score1}</span>}
        </div>
        <div className="border-t border-tertiary/50 my-1"></div>
        <div className="flex justify-between items-center text-sm">
          <PlayerInMatch player={p2} winnerId={match.winnerId} />
          {match.score2 !== null && <span className={`font-bold ${match.winnerId === p2?.id ? 'text-accent' : 'text-text-primary'}`}>{match.score2}</span>}
        </div>
        {canEdit && (
          <div className="text-center mt-2">
            <button onClick={() => {
              const mirror = tt.playoffMatches?.find(item => item.id === playoffMatchToLeagueMatchId(match.id))
                ?? buildLeagueMatchFromPlayoffMatch(match);
              if (mirror) onEditResult(mirror);
            }} className="text-xs bg-highlight/80 hover:bg-highlight px-2 py-1 rounded-md text-white transition-colors">Risultato</button>
          </div>
        )}
      </div>
    );
  };

  const finalMatch = matches.find(m => m.round === maxRound && !m.isBronzeFinal);
  const winner = finalMatch?.winnerId ? getPlayer(finalMatch.winnerId) : null;

  return <React.Fragment><PersistenceFeedback persistence={persistence} />{(
    <div className="bg-secondary p-2 md:p-6 rounded-xl shadow-lg">
      <div className="text-center mb-6">
        <h3 className="text-2xl font-bold text-accent">Tabellone Playoff</h3>
        {winner && (
          <div className="mt-2 text-lg text-yellow-400 font-bold animate-subtlePulse inline-flex items-center gap-2">
            <span>🏆 Vincitore:</span>
            <img src={winner.avatar} alt={winner.name} className="w-7 h-7 rounded-full object-cover" />
            <span>{winner.name}</span>
            <span>🏆</span>
          </div>
        )}
        {isOrganizer && <button onClick={() => setIsResetModalOpen(true)} className="mt-2 text-sm text-yellow-500 hover:text-yellow-400 underline">Modifica Tabellone</button>}
      </div>

      <div className="flex justify-start items-stretch gap-4 md:gap-10 overflow-x-auto pb-4 px-2">
        {Array.from({ length: maxRound }).map((_, i) => {
          const roundNum = i + 1;
          const roundMatches = matches.filter(m => m.round === roundNum && !m.isBronzeFinal).sort((a, b) => a.matchIndex - b.matchIndex);
          if (roundMatches.length === 0) return null;
          return (
            <div key={i} className="flex flex-col w-60 flex-shrink-0 justify-around">
              <h4 className="text-lg font-semibold text-center text-text-secondary mb-4">{getRoundName(roundNum)}</h4>
              <div className="space-y-10">
                {roundMatches.map(match => (
                  <div key={match.id} className="relative">
                    <MatchCard match={match} />
                    {match.nextMatchId && (
                      <div className="absolute top-1/2 -right-5 md:-right-8 w-5 md:w-8 h-px bg-tertiary z-0">
                        <div className="absolute top-1/2 -right-px w-px h-10 md:h-12 bg-tertiary" style={{ transform: `translateY(${match.matchIndex % 2 === 0 ? '-100%' : '0'})` }}></div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        <div className="flex flex-col w-60 flex-shrink-0 justify-center items-center">
          <h4 className="text-lg font-semibold text-center text-text-secondary mb-4">Campione</h4>
          {finalMatch ? <MatchCard match={finalMatch} /> : null}
        </div>
      </div>

      {bronzeFinalId && tournament.settings.hasBronzeFinal && (
        <div className="mt-8 pt-6 border-t border-tertiary/50">
          <h4 className="text-lg font-semibold text-center text-text-secondary mb-4">Finale 3° Posto</h4>
          <div className="max-w-xs mx-auto">
            <MatchCard match={matches.find(m => m.id === bronzeFinalId)!} />
          </div>
        </div>
      )}
      {(!bronzeFinalId || !tournament.settings.hasBronzeFinal) && <p className="text-center text-xs text-text-secondary/50 mt-4">Finale 3° Posto disabilitata nelle impostazioni.</p>}

      {isOrganizer && isResetModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fadeIn">
          <div className="bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-md border border-tertiary">
            <h4 className="text-lg font-bold mb-4">Conferma Reset</h4>
            <p className="text-text-secondary">Sei sicuro di voler resettare il tabellone? Tutti i risultati dei playoff verranno persi e tornerai alla fase di costruzione manuale.</p>
            <div className="flex justify-end gap-4 mt-6">
              <button onClick={() => setIsResetModalOpen(false)} className="bg-tertiary hover:bg-tertiary/80 text-text-primary font-bold py-2 px-4 rounded-lg transition-colors">Annulla</button>
              <button onClick={handleResetBracket} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">Resetta Tabellone</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )}</React.Fragment>;
};

export default Playoffs;
