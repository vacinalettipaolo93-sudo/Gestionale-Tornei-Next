import React, { useMemo } from 'react';
import { type Group, type Player, type TournamentSettings } from '../types';
import { calculateStandings } from '../utils/standings';

interface StandingsTableProps {
  group: Group;
  players: Player[];
  settings: TournamentSettings;
  loggedInPlayerId?: string;
  onPlayerContact: (player: Player) => void;
  entryLabel?: string;
}

const StandingsTable: React.FC<StandingsTableProps> = ({ group, players, settings, loggedInPlayerId, onPlayerContact, entryLabel = 'Giocatore' }) => {
  const standings = useMemo(() => calculateStandings(group, players, settings), [group, players, settings]);

  const getPlayer = (playerId: string) => players.find(p => p.id === playerId);

  return (
    <div className="overflow-hidden rounded-xl bg-secondary shadow-lg">
      <ol aria-label="Classifica del girone" className="space-y-3 p-3 lg:hidden">
        {standings.map((entry, index) => {
          const player = getPlayer(entry.playerId);
          if (!player) return null;
          const isLoggedUser = entry.playerId === loggedInPlayerId;
          const stats = [
            { label: 'Giocate', value: entry.played },
            { label: 'Vinte', value: entry.wins, color: 'text-green-400' },
            { label: 'Pareggi', value: entry.draws, color: 'text-yellow-400' },
            { label: 'Perse', value: entry.losses, color: 'text-red-400' },
            { label: 'Diff. game', value: entry.goalDifference > 0 ? `+${entry.goalDifference}` : entry.goalDifference },
            { label: 'Game fatti', value: entry.goalsFor },
          ];
          return (
            <li key={entry.playerId}>
              <article className={`rounded-xl border p-3 transition-colors ${isLoggedUser
                ? 'border-accent/60 bg-highlight/10 shadow-md'
                : 'border-tertiary/70 bg-primary/40'}`}>
                {isLoggedUser && (
                  <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                    La tua posizione
                  </p>
                )}
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${isLoggedUser
                    ? 'bg-accent text-primary'
                    : 'bg-tertiary text-text-secondary'}`}>
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => onPlayerContact(player)}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg text-left transition-colors hover:text-accent"
                  >
                    <img src={player.avatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover"/>
                    <span className={`min-w-0 whitespace-normal break-words text-sm font-semibold leading-snug ${isLoggedUser ? 'text-text-primary' : ''}`}>
                      {player.name}
                    </span>
                  </button>
                  <div className="min-w-14 shrink-0 rounded-lg border border-accent/30 bg-accent/10 px-2 py-1 text-center">
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-text-secondary">PT</span>
                    <strong className="block text-xl leading-none text-accent">{entry.points}</strong>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-tertiary/50 pt-3">
                  {stats.map(stat => (
                    <div key={stat.label} className="rounded-lg bg-secondary/70 px-2 py-2 text-center">
                      <dt className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-text-secondary">{stat.label}</dt>
                      <dd className={`mt-1 text-sm font-bold ${stat.color ?? 'text-text-primary'}`}>{stat.value}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            </li>
          );
        })}
      </ol>
      <div role="region" aria-label="Tabella classifica del girone" tabIndex={0} className="hidden overflow-x-auto overscroll-x-contain lg:block">
      <table className="w-full min-w-[760px] text-sm text-left text-text-primary">
        <thead className="bg-tertiary/50 text-xs uppercase text-text-secondary">
          <tr>
            <th scope="col" className="w-12 px-3 py-3">#</th>
            <th scope="col" className="min-w-56 px-3 py-3">{entryLabel}</th>
            <th scope="col" className="w-12 px-2 py-3 text-center" title="Punti">PT</th>
            <th scope="col" className="w-12 px-2 py-3 text-center" title="Giocate">G</th>
            <th scope="col" className="w-12 px-2 py-3 text-center" title="Vinte">V</th>
            <th scope="col" className="w-12 px-2 py-3 text-center" title="Nulle">N</th>
            <th scope="col" className="w-12 px-2 py-3 text-center" title="Perse">P</th>
            <th scope="col" className="w-14 px-2 py-3 text-center" title="Differenza Game">DG</th>
            <th scope="col" className="w-12 px-2 py-3 text-center" title="Game Fatti">GF</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((entry, index) => {
            const player = getPlayer(entry.playerId);
            if (!player) return null;
            const isLoggedUser = entry.playerId === loggedInPlayerId;
            return (
              <tr key={entry.playerId} aria-current={isLoggedUser ? 'true' : undefined} className={`border-b border-tertiary/50 transition-colors ${isLoggedUser ? 'bg-highlight/10' : 'hover:bg-tertiary/20'}`}>
                <td className={`px-3 py-3 font-medium ${isLoggedUser ? 'text-accent' : ''} ${isLoggedUser ? 'border-l-4 border-accent' : ''}`}>{index + 1}</td>
                <th scope="row" className="min-w-56 px-3 py-3 font-medium whitespace-nowrap">
                  <button onClick={() => onPlayerContact(player)} className="flex items-center gap-3 text-left hover:text-accent transition-colors">
                    <img src={player.avatar} alt={player.name} className="w-8 h-8 rounded-full object-cover"/>
                    <span className={`whitespace-nowrap ${isLoggedUser ? 'text-text-primary' : ''}`}>{player.name}</span>
                    {isLoggedUser && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase text-accent">Tu</span>}
                  </button>
                </th>
                <td className={`px-2 py-3 text-center font-bold ${isLoggedUser ? 'text-text-primary' : ''}`}>{entry.points}</td>
                <td className="px-2 py-3 text-center">{entry.played}</td>
                <td className="px-2 py-3 text-center text-green-400">{entry.wins}</td>
                <td className="px-2 py-3 text-center text-yellow-400">{entry.draws}</td>
                <td className="px-2 py-3 text-center text-red-400">{entry.losses}</td>
                <td className="px-2 py-3 text-center">{entry.goalDifference > 0 ? `+${entry.goalDifference}` : entry.goalDifference}</td>
                <td className="px-2 py-3 text-center">{entry.goalsFor}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
};

export default StandingsTable;