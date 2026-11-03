import React, { useMemo, useState } from 'react';
import { type Event, type Group, type Player, type Tournament } from '../types';
import {
  removeDateUnavailability,
  setDateUnavailability,
  setTournamentPeriodAvailability,
  setTournamentVenues,
} from '../services/availabilityService';
import { type TournamentAvailabilityScope } from '../services/availabilityService';
import { getAvailabilityDateKey } from '../utils/tournamentAvailability';
import { useTournamentAvailability } from './useTournamentAvailability';
import { useSlotClock } from './useSlotClock';
import { TOURNAMENT_VENUES, type TournamentVenueId } from '../utils/tournamentVenues';
import {
  formatTournamentAvailabilityDate,
  getTournamentWeekends,
  TOURNAMENT_AVAILABILITY_PERIODS,
  type TournamentAvailabilityPeriodId,
} from '../utils/tournamentAvailabilityPeriods';

type Props = {
  event: Event;
  tournament: Tournament;
  selectedGroup: Group;
  loggedInPlayerId?: string;
};

const ALL_VENUES = TOURNAMENT_VENUES.map(venue => venue.id);

function getInitialDate(weekends: ReturnType<typeof getTournamentWeekends>): string {
  const today = getAvailabilityDateKey(new Date().toISOString());
  return weekends.flatMap(weekend => [weekend.friday, weekend.saturday, weekend.sunday])
    .find(date => date >= today) ?? weekends[0].friday;
}

export default function AvailabilityTab({ event, tournament, selectedGroup, loggedInPlayerId }: Props) {
  const visibleParticipantIds = [...new Set(selectedGroup.playerIds ?? [])];
  const participantIds = [...new Set([...visibleParticipantIds, ...(loggedInPlayerId ? [loggedInPlayerId] : [])])];
  const participants = visibleParticipantIds.map(id => event.players.find(player => player.id === id)).filter(Boolean) as Player[];
  const now = useSlotClock(event);
  const scope: TournamentAvailabilityScope = { eventId: event.id, tournamentId: tournament.id };
  const availability = useTournamentAvailability(participantIds, scope);
  const { loading, error, dateUnavailMap, venueMap, periodMap } = availability;
  const savedVenues = loggedInPlayerId ? venueMap[loggedInPlayerId] : undefined;
  const selectedVenues = savedVenues ?? new Set<TournamentVenueId>(ALL_VENUES);
  const weekends = useMemo(() => getTournamentWeekends(new Date(now), 12), [now]);
  const [selectedDate, setSelectedDate] = useState(() => getInitialDate(getTournamentWeekends()));
  const [savingVenues, setSavingVenues] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const today = getAvailabilityDateKey(new Date(now).toISOString());
  const activeDate = selectedDate >= today ? selectedDate : getInitialDate(weekends);
  const myUnavail = loggedInPlayerId ? dateUnavailMap[loggedInPlayerId]?.has(activeDate) ?? false : false;

  const hasPeriod = (playerId: string, venueId: TournamentVenueId, period: TournamentAvailabilityPeriodId) =>
    periodMap?.[playerId]?.some(entry => entry.date === activeDate
      && entry.venueId === venueId && entry.period === period) ?? false;

  async function saveVenues(venueIds: TournamentVenueId[]) {
    if (!loggedInPlayerId || savingVenues || savingPreference) return;
    setSavingVenues(true);
    setSaveError(null);
    try {
      await setTournamentVenues(loggedInPlayerId, venueIds, scope);
    } catch (cause) {
      console.error('Errore salvataggio centri di gioco:', cause);
      setSaveError(cause instanceof Error ? cause.message : 'Impossibile salvare i centri di gioco. Riprova.');
    } finally {
      setSavingVenues(false);
    }
  }

  async function togglePeriod(venueId: TournamentVenueId, period: TournamentAvailabilityPeriodId) {
    if (!loggedInPlayerId || savingPreference || myUnavail) return;
    const currentlySelected = hasPeriod(loggedInPlayerId, venueId, period);
    setSavingPreference(true);
    setSaveError(null);
    try {
      await setTournamentPeriodAvailability(loggedInPlayerId, activeDate, venueId, period, !currentlySelected, scope);
    } catch (cause) {
      console.error('Errore salvataggio fascia oraria:', cause);
      setSaveError(cause instanceof Error ? cause.message : 'Impossibile salvare la fascia oraria. Riprova.');
    } finally {
      setSavingPreference(false);
    }
  }

  async function toggleDateUnavailability() {
    if (!loggedInPlayerId || savingPreference) return;
    setSavingPreference(true);
    setSaveError(null);
    try {
      if (myUnavail) await removeDateUnavailability(loggedInPlayerId, activeDate, scope);
      else await setDateUnavailability(loggedInPlayerId, activeDate, true, scope);
    } catch (cause) {
      console.error('Errore salvataggio non disponibilità:', cause);
      setSaveError(cause instanceof Error ? cause.message : 'Impossibile salvare la non disponibilità. Riprova.');
    } finally {
      setSavingPreference(false);
    }
  }

  if (loading) return <div>Caricamento disponibilità…</div>;
  if (error) return <p role="alert" className="text-red-400">{error}</p>;

  const formattedDate = formatTournamentAvailabilityDate(activeDate);
  const venueOptions = [
    { name: TOURNAMENT_VENUES[0].name, ids: [TOURNAMENT_VENUES[0].id] },
    { name: TOURNAMENT_VENUES[1].name, ids: [TOURNAMENT_VENUES[1].id] },
    { name: 'Entrambi i circoli', ids: ALL_VENUES },
  ];

  return (
    <div className="max-w-6xl mx-auto bg-secondary rounded-xl p-4 sm:p-6 shadow space-y-6">
      <h3 className="text-xl font-bold text-accent">Disponibilità di gioco</h3>
      <p className="text-sm text-text-secondary">
        Seleziona un venerdì, sabato o domenica nei prossimi 12 weekend. Per ogni circolo indica mattina,
        pomeriggio o sera: i periodi sono fasce indicative per concordare una partita, non una prenotazione del campo.
        Puoi segnare ogni giornata come non disponibile.
      </p>
      {saveError && <p role="alert" className="text-red-400">{saveError}</p>}
      {(savingPreference || availability.pendingWrites) && <p role="status">Salvataggio disponibilità su Firebase...</p>}
      <fieldset className="space-y-3">
        <legend className="font-bold">1. Per quali circoli vuoi indicare la disponibilità?</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {venueOptions.map(choice => {
            const selected = choice.ids.length === selectedVenues.size
              && choice.ids.every(id => selectedVenues.has(id));
            return (
              <button
                key={choice.name}
                type="button"
                aria-pressed={selected}
                disabled={!loggedInPlayerId || savingVenues || savingPreference}
                onClick={() => void saveVenues(choice.ids)}
                className={`p-3 rounded-lg border-2 font-semibold disabled:opacity-50 ${selected ? 'border-accent bg-accent/20 text-accent' : 'border-tertiary bg-primary'}`}
              >
                {choice.name}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-text-secondary">
          Le preferenze si salvano per questo torneo. Cambiare circolo non cancella le fasce già indicate per l’altro.
        </p>
        {savingVenues && <p role="status">Salvataggio circoli…</p>}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-bold">2. Scegli un giorno del weekend</legend>
        <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
          {weekends.map((weekend, index) => {
            const days = [weekend.friday, weekend.saturday, weekend.sunday].filter(date => date >= today);
            if (!days.length) return null;
            return (
              <div key={weekend.friday} className="rounded-lg border border-tertiary bg-primary p-3">
                <h4 className="text-sm text-text-secondary mb-2">Weekend {index + 1}</h4>
                <div className="grid grid-cols-3 gap-2">
                  {days.map(date => (
                    <button
                      key={date}
                      type="button"
                      aria-pressed={activeDate === date}
                      onClick={() => setSelectedDate(date)}
                      className={`min-w-0 p-2 rounded-lg border text-center capitalize ${activeDate === date ? 'border-accent bg-accent/20 text-accent' : 'border-tertiary hover:bg-tertiary'}`}
                    >
                      <span className="block text-xs">{formatTournamentAvailabilityDate(date, { weekday: 'short' })}</span>
                      <span className="block font-bold">{formatTournamentAvailabilityDate(date, { day: 'numeric', month: 'short' })}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>

      <section className="space-y-4" aria-label={`Disponibilità per ${formattedDate}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-bold text-lg capitalize">{formattedDate}</h4>
          {loggedInPlayerId ? (
            <button type="button" onClick={() => void toggleDateUnavailability()}
              disabled={savingPreference || savingVenues}
              className={`px-4 py-2 rounded-lg font-semibold disabled:opacity-50 ${myUnavail ? 'bg-red-700 text-white' : 'bg-tertiary text-text-primary'}`}>
              {myUnavail ? 'Rimuovi: non disponibile' : 'Segna tutta la giornata non disponibile'}
            </button>
          ) : <span className="text-sm text-text-secondary">Accedi per modificare le disponibilità</span>}
        </div>

        {myUnavail ? (
          <p role="status" className="rounded-lg bg-red-950/40 border border-red-800 p-4 text-red-300">
            Hai segnato questa giornata come non disponibile. Le fasce già salvate sono conservate, ma non compariranno nei suggerimenti.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {TOURNAMENT_VENUES.filter(venue => selectedVenues.has(venue.id)).map(venue => (
              <section key={venue.id} className="bg-primary p-4 rounded-lg border border-tertiary space-y-3">
                <h5 className="font-bold text-accent">{venue.name}</h5>
                <div className="space-y-2">
                  {TOURNAMENT_AVAILABILITY_PERIODS.map(period => {
                    const selected = loggedInPlayerId ? hasPeriod(loggedInPlayerId, venue.id, period.id) : false;
                    return (
                      <button key={period.id} type="button" aria-pressed={selected}
                        onClick={() => void togglePeriod(venue.id, period.id)}
                        disabled={!loggedInPlayerId || savingPreference || savingVenues || myUnavail}
                        className={`w-full flex items-center justify-between gap-3 p-3 rounded-lg border text-left disabled:opacity-50 ${selected ? 'border-green-500 bg-green-950/40' : 'border-tertiary hover:bg-tertiary'}`}>
                        <span><span className="font-semibold">{period.label}</span><span className="block text-xs text-text-secondary">{period.hours}</span></span>
                        <span className={selected ? 'text-green-400 font-semibold' : 'text-text-secondary'}>{selected ? 'Disponibile' : 'Non selezionata'}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h4 className="font-bold">Disponibilità dichiarate · {selectedGroup.name} · <span className="capitalize">{formattedDate}</span></h4>
        <div className="overflow-x-auto rounded-lg border border-tertiary">
          <table className="min-w-full text-sm bg-primary">
            <thead>
              <tr className="text-left border-b border-tertiary">
                <th className="p-3">Giocatore</th>
                {TOURNAMENT_VENUES.filter(venue => selectedVenues.has(venue.id)).map(venue => (
                  <th key={venue.id} className="p-3">{venue.name}</th>
                ))}
                <th className="p-3">Giornata</th>
              </tr>
            </thead>
            <tbody>
              {participants.map(player => {
                const unavailable = dateUnavailMap[player.id]?.has(activeDate) ?? false;
                return (
                  <tr key={player.id} className="border-b border-tertiary last:border-0">
                    <td className="p-3 font-medium">{player.name}</td>
                    {TOURNAMENT_VENUES.filter(venue => selectedVenues.has(venue.id)).map(venue => {
                      const periods = TOURNAMENT_AVAILABILITY_PERIODS
                        .filter(period => hasPeriod(player.id, venue.id, period.id))
                        .map(period => period.label);
                      return (
                        <td key={venue.id} className="p-3">
                          {unavailable ? <span className="text-red-400">Non disponibile</span> : (
                            periods.length ? periods.join(', ') : '—'
                          )}
                        </td>
                      );
                    })}
                    <td className="p-3">{unavailable ? <span className="text-red-400 font-semibold">Non disponibile</span> : '—'}</td>
                  </tr>
                );
              })}
              {participants.length === 0 && (
                <tr><td className="p-3 text-text-secondary" colSpan={TOURNAMENT_VENUES.filter(venue => selectedVenues.has(venue.id)).length + 2}>
                  {selectedGroup.name === 'Nessun girone assegnato' ? 'Non sei assegnato a un girone.' : 'Nessun partecipante assegnato.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
