import React from 'react';
import { type Event, type Player, type SummerPlayerAvailability, type Tournament } from '../types';
import { getRankingMatchSuggestions, getTournamentMatchSuggestions, hasRankingAvailability, type MatchSuggestion } from '../utils/matchFinder';
import { useTournamentAvailability } from './useTournamentAvailability';
import { getAvailabilityDateKey, getTournamentAvailabilitySlots } from '../utils/tournamentAvailability';

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
        Nessun avversario con disponibilità in comune al momento. I suggerimenti si aggiornano quando gli altri giocatori inseriscono o modificano le disponibilità.
      </p>
    ) : (
      <div className="grid gap-3 md:grid-cols-2">
        {suggestions.map(suggestion => (
          <div key={suggestion.id} className="bg-primary rounded-lg border border-tertiary p-4 space-y-3">
            <h4 className="font-semibold text-text-primary break-words">{suggestion.name}</h4>
            <div className="flex flex-wrap gap-2">
              {suggestion.commonTimes.map(time => (
                <span key={time} className="text-sm rounded bg-green-500/10 text-green-400 px-2 py-1">{time}</span>
              ))}
            </div>
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
      description={description ?? 'Avversari sfidabili con almeno un giorno e una fascia oraria in comune con te.'}
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
  const availability = useTournamentAvailability(event.players.map(player => player.id));
  const padel = event.eventType === 'tournament_padel';
  return (
    <MatchFinder
      {...actions}
      loading={availability.loading}
      error={availability.error}
      hasAvailability={getTournamentAvailabilitySlots(event, tournament).some(slot =>
        availability.slotPrefMap[currentPlayerId]?.has(slot.id)
        && !availability.dateUnavailMap[currentPlayerId]?.has(getAvailabilityDateKey(slot.start))
      )}
      suggestions={getTournamentMatchSuggestions(event, tournament, currentPlayerId, availability)}
      description={padel
        ? 'Solo squadre avversarie degli incontri ancora da giocare, con uno slot futuro libero scelto da tutti e quattro i giocatori. Le date segnate come non disponibili sono escluse.'
        : 'Solo avversari degli incontri ancora da giocare, con uno slot futuro libero scelto da entrambi. Le date segnate come non disponibili sono escluse.'}
    />
  );
}
