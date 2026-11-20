import React from 'react';
import { type Event, type Player, type SummerPlayerAvailability, type Tournament } from '../types';
import { getRankingMatchSuggestions, getTournamentMatchSuggestions, hasRankingAvailability, hasTournamentAvailability, type MatchSuggestion } from '../utils/matchFinder';
import { useTournamentAvailability } from './useTournamentAvailability';
import { useSlotClock } from './useSlotClock';

interface MatchFinderProps {
  suggestions: MatchSuggestion[];
  hasAvailability: boolean;
  onAvailability: () => void;
  onPlayerContact: (player: Player) => void;
  onChallenge?: (opponentId: string, opponentName: string) => void;
  description: string;
  loading?: boolean;
  error?: string | null;
}

const MatchFinder: React.FC<MatchFinderProps> = ({
  suggestions, hasAvailability, onAvailability, onPlayerContact, onChallenge, description, loading, error,
}) => (
  <section aria-label="Cerca partita" className="bg-secondary rounded-xl shadow-lg p-4 sm:p-6 space-y-4 mb-6">
    <div className="flex flex-wrap justify-between items-center gap-3">
      <h3 className="text-lg font-bold text-accent">Cerca partita</h3>
      <button onClick={onAvailability} className="text-sm font-semibold text-accent hover:underline">
        Modifica disponibilità
      </button>
    </div>
    <p className="text-sm text-text-secondary">{description} I suggerimenti non prenotano automaticamente una partita.</p>
    {error ? (
      <p role="alert" className="text-sm text-red-400">{error}</p>
    ) : loading ? (
      <p role="status" className="text-sm text-text-secondary">Caricamento disponibilità…</p>
    ) : !hasAvailability ? (
      <p className="text-sm text-text-secondary">
        Inserisci le tue disponibilità nella scheda Disponibilità per trovare avversari compatibili.
        Non consideriamo disponibile chi non le ha dichiarate.
      </p>
    ) : suggestions.length === 0 ? (
      <p className="text-sm text-text-secondary">
        Nessun giocatore ancora da sfidare con disponibilità compatibili. I suggerimenti si aggiornano quando vengono inserite o modificate le disponibilità.
      </p>
    ) : (
      <div className="grid gap-3 md:grid-cols-2">
        {suggestions.map((suggestion, index) => (
          <div key={`${suggestion.id}:${suggestion.compatibility ?? 'ranking'}`} className="bg-primary rounded-lg border border-tertiary p-4 space-y-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">
                {index + 1}
              </span>
              <div className="flex shrink-0 -space-x-3">
                {suggestion.contacts.map(player => player.avatar ? (
                  <img key={player.id} src={player.avatar} alt="" className="h-10 w-10 rounded-full border-2 border-primary object-cover" />
                ) : (
                  <span key={player.id} aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-primary bg-tertiary text-sm font-bold text-text-primary">
                    {player.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                ))}
              </div>
              <div className="min-w-0">
                <h4 className="break-words font-semibold text-text-primary">{suggestion.name}</h4>
                <p className="text-sm text-text-secondary">
                  {suggestion.commonCount} {suggestion.compatibility
                    ? suggestion.commonCount === 1 ? 'occasione compatibile' : 'occasioni compatibili'
                    : suggestion.commonCount === 1 ? 'fascia in comune' : 'fasce in comune'}
                </p>
              </div>
            </div>
            {suggestion.compatibility && (
              <p className={`text-sm font-bold ${suggestion.compatibility === 'exact' ? 'text-green-400' : 'text-highlight'}`}>
                {suggestion.compatibility === 'exact'
                  ? 'Compatibilità più alta'
                  : suggestion.compatibility === 'different-time'
                    ? 'Da concordare: stesso centro'
                    : 'Da concordare: centri diversi'}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {suggestion.contacts.map(player => (
                <button
                  key={player.id}
                  onClick={() => onPlayerContact(player)}
                  disabled={!player.phone?.replace(/\D/g, '')}
                  title={player.phone?.replace(/\D/g, '') ? undefined : 'Telefono non inserito'}
                  className="text-sm px-3 py-2 rounded bg-tertiary text-text-primary font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Contatta {player.name}
                </button>
              ))}
              {onChallenge && (
                <button
                  onClick={() => onChallenge(suggestion.id, suggestion.name)}
                  className="text-sm px-3 py-2 rounded bg-accent text-white font-semibold"
                >
                  Sfida
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    )}
  </section>
);

export function RankingMatchFinder({
  currentPlayerId, opponents, availabilities = {}, description, ...actions
}: {
  currentPlayerId: string;
  opponents: Player[];
  availabilities?: Record<string, SummerPlayerAvailability>;
  description?: string;
} & Pick<MatchFinderProps, 'onAvailability' | 'onPlayerContact' | 'onChallenge'>) {
  return (
    <MatchFinder
      {...actions}
      hasAvailability={hasRankingAvailability(availabilities[currentPlayerId])}
      suggestions={getRankingMatchSuggestions(currentPlayerId, opponents, availabilities)}
      description={description ?? 'Giocatori ancora sfidabili, ordinati per numero di fasce in comune con te.'}
    />
  );
}

export function TournamentMatchFinder({
  event, tournament, currentPlayerId, ...actions
}: {
  event: Event;
  tournament: Tournament;
  currentPlayerId: string;
} & Pick<MatchFinderProps, 'onAvailability' | 'onPlayerContact'>) {
  const availability = useTournamentAvailability(event.players.map(player => player.id), {
    eventId: event.id, tournamentId: tournament.id,
  });
  const padel = event.eventType === 'tournament_padel';
  const now = useSlotClock(event);
  return (
    <MatchFinder
      {...actions}
      loading={availability.loading}
      error={availability.error}
      hasAvailability={hasTournamentAvailability(event, tournament, currentPlayerId, availability, now)}
      suggestions={getTournamentMatchSuggestions(event, tournament, currentPlayerId, availability, now)}
      description={padel
        ? 'Squadre con incontri ancora da organizzare, ordinate per compatibilità. Nel Padel devono aver dichiarato la disponibilità tutti e quattro i giocatori.'
        : 'Avversari con incontri ancora da organizzare, ordinati per compatibilità con le tue disponibilità.'}
    />
  );
}
