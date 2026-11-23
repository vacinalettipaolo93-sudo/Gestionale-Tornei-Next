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
    <div className="bg-secondary rounded-xl shadow-lg">
      <p className="px-4 pt-3 text-xs text-text-secondary sm:hidden">
        Scorri la tabella orizzontalmente per vedere tutte le statistiche.
      </p>
      <div role="region" aria-label="Classifica del girone" tabIndex={0} className="overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[680px] text-sm text-left text-text-primary">
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
              <tr key={entry.playerId} className={`border-b border-tertiary/50 transition-colors ${isLoggedUser ? 'bg-highlight/10' : 'hover:bg-tertiary/20'}`}>
                <td className={`px-3 py-3 font-medium ${isLoggedUser ? 'text-accent' : ''} ${isLoggedUser ? 'border-l-4 border-accent' : ''}`}>{index + 1}</td>
                <th scope="row" className="min-w-56 px-3 py-3 font-medium whitespace-nowrap">
                  <button onClick={() => onPlayerContact(player)} className="flex items-center gap-3 text-left hover:text-accent transition-colors">
                    <img src={player.avatar} alt={player.name} className="w-8 h-8 rounded-full object-cover"/>
                    <span className={`whitespace-nowrap ${isLoggedUser ? 'text-text-primary' : ''}`}>{player.name}</span>
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