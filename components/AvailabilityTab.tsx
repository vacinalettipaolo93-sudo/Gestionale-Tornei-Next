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
  isTournamentAvailabilityPeriodAllowedOnDate,
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
  const allWeekendDates = useMemo(() => weekends.flatMap(weekend => [weekend.friday, weekend.saturday, weekend.sunday]), [weekends]);
  const initialDate = getInitialDate(weekends);
  const [selectedDates, setSelectedDates] = useState<string[]>([initialDate]);
  const [savingVenues, setSavingVenues] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const today = getAvailabilityDateKey(new Date(now).toISOString());
  const effectiveSelectedDates = selectedDates.filter(date => date >= today).sort();

  const toggleDateSelection = (date: string) => {
    setSelectedDates(previous => previous.includes(date)
      ? previous.filter(item => item !== date)
      : [...previous, date].sort());
  };

  const selectWeekdayDates = (weekday: 'friday' | 'saturday' | 'sunday') => {
    const dates = weekends.map(weekend => weekend[weekday]).filter(date => date >= today);
    setSelectedDates(dates);
  };

  const hasPeriod = (playerId: string, venueId: TournamentVenueId, period: TournamentAvailabilityPeriodId, date: string) =>
    periodMap?.[playerId]?.some(entry => entry.date === date && entry.venueId === venueId && entry.period === period) ?? false;

  const togglePeriod = async (venueId: TournamentVenueId, period: TournamentAvailabilityPeriodId) => {
    if (!loggedInPlayerId || savingPreference || effectiveSelectedDates.length === 0) return;
    const targetDates = effectiveSelectedDates.filter(date => isTournamentAvailabilityPeriodAllowedOnDate(period, date));
    if (!targetDates.length) return;
    const shouldSelect = !targetDates.every(date => hasPeriod(loggedInPlayerId, venueId, period, date));
    setSavingPreference(true);
    setSaveError(null);
    try {
      for (const date of targetDates) {
        await setTournamentPeriodAvailability(loggedInPlayerId, date, venueId, period, shouldSelect, scope);
      }
    } catch (cause) {
      console.error('Errore salvataggio fascia oraria:', cause);
      setSaveError(cause instanceof Error ? cause.message : 'Impossibile salvare la fascia oraria. Riprova.');
    } finally {
      setSavingPreference(false);
    }
  };

  const toggleDateUnavailability = async () => {
    if (!loggedInPlayerId || savingPreference || effectiveSelectedDates.length === 0) return;
    const shouldMarkUnavailable = !effectiveSelectedDates.every(date => dateUnavailMap[loggedInPlayerId]?.has(date) ?? false);
    setSavingPreference(true);
    setSaveError(null);
    try {
      for (const date of effectiveSelectedDates) {
        if (shouldMarkUnavailable) await setDateUnavailability(loggedInPlayerId, date, true, scope);
        else await removeDateUnavailability(loggedInPlayerId, date, scope);
      }
    } catch (cause) {
      console.error('Errore salvataggio non disponibilità:', cause);
      setSaveError(cause instanceof Error ? cause.message : 'Impossibile salvare la non disponibilità. Riprova.');
    } finally {
      setSavingPreference(false);
    }
  };

  const saveVenues = async (venueIds: TournamentVenueId[]) => {
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
  };

  if (loading) return <div>Caricamento disponibilità…</div>;
  if (error) return <p role="alert" className="text-red-400">{error}</p>;

  const venueOptions = [
    { name: TOURNAMENT_VENUES[0].name, ids: [TOURNAMENT_VENUES[0].id] },
    { name: TOURNAMENT_VENUES[1].name, ids: [TOURNAMENT_VENUES[1].id] },
    { name: 'Entrambi i circoli', ids: ALL_VENUES },
  ];
  const allSelectedUnavailable = !!loggedInPlayerId && effectiveSelectedDates.length > 0
    && effectiveSelectedDates.every(date => dateUnavailMap[loggedInPlayerId]?.has(date) ?? false);

  return (
    <div className="max-w-6xl mx-auto bg-secondary rounded-xl p-4 sm:p-6 shadow space-y-6">
      <h3 className="text-xl font-bold text-accent">Disponibilità di gioco</h3>
      <p className="text-sm text-text-secondary">
        Seleziona uno o più giorni, anche di weekend diversi, e applica la stessa fascia a tutte le date selezionate.
        Puoi, ad esempio, selezionare tutti i venerdì e indicare la sera. Il sabato e la domenica non è possibile
        indicare disponibilità serale perché i circoli chiudono alle 18:00.
      </p>
      {saveError && <p role="alert" className="text-red-400">{saveError}</p>}
      {(savingPreference || availability.pendingWrites) && <p role="status">Salvataggio disponibilità su Firebase...</p>}

      <fieldset className="space-y-3">
        <legend className="font-bold">1. Per quali circoli vuoi indicare la disponibilità?</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {venueOptions.map(choice => {
            const selected = choice.ids.length === selectedVenues.size && choice.ids.every(id => selectedVenues.has(id));
            return (
              <button key={choice.name} type="button" aria-pressed={selected}
                disabled={!loggedInPlayerId || savingVenues || savingPreference}
                onClick={() => void saveVenues(choice.ids)}
                className={`p-3 rounded-lg border-2 font-semibold disabled:opacity-50 ${selected ? 'border-accent bg-accent/20 text-accent' : 'border-tertiary bg-primary'}`}>
                {choice.name}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-text-secondary">Le preferenze si salvano per questo torneo. Cambiare circolo non cancella le fasce già indicate per l’altro.</p>
        {savingVenues && <p role="status">Salvataggio circoli…</p>}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-bold">2. Seleziona le date</legend>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => selectWeekdayDates('friday')} className="px-3 py-1.5 rounded-lg border border-tertiary bg-primary text-sm font-semibold">Tutti i venerdì</button>
          <button type="button" onClick={() => selectWeekdayDates('saturday')} className="px-3 py-1.5 rounded-lg border border-tertiary bg-primary text-sm font-semibold">Tutti i sabati</button>
          <button type="button" onClick={() => selectWeekdayDates('sunday')} className="px-3 py-1.5 rounded-lg border border-tertiary bg-primary text-sm font-semibold">Tutte le domeniche</button>
          <button type="button" onClick={() => setSelectedDates(allWeekendDates.filter(date => date >= today))} className="px-3 py-1.5 rounded-lg border border-tertiary bg-primary text-sm font-semibold">Tutti i giorni</button>
          <button type="button" onClick={() => setSelectedDates([])} className="px-3 py-1.5 rounded-lg border border-tertiary bg-primary text-sm font-semibold">Deseleziona tutto</button>
        </div>
        <div className="rounded-lg border border-tertiary bg-primary/60 p-3">
          <p className="text-sm font-semibold">Date selezionate: {effectiveSelectedDates.length}</p>
          {effectiveSelectedDates.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Elenco delle date selezionate">
              {effectiveSelectedDates.map(date => (
                <li key={date} className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs capitalize">
                  {formatTournamentAvailabilityDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-xs text-text-secondary">Seleziona almeno una data per impostare la disponibilità.</p>}
        </div>
        <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
          {weekends.map((weekend, index) => {
            const days = [weekend.friday, weekend.saturday, weekend.sunday].filter(date => date >= today);
            if (!days.length) return null;
            return (
              <div key={weekend.friday} className="rounded-lg border border-tertiary bg-primary p-3">
                <h4 className="text-sm text-text-secondary mb-2">Weekend {index + 1}</h4>
                <div className="grid grid-cols-3 gap-2">
                  {days.map(date => {
                    const isSelected = effectiveSelectedDates.includes(date);
                    const weekday = new Date(`${date}T12:00:00`).getDay();
                    const dayLabel = weekday === 5 ? 'Venerdì' : weekday === 6 ? 'Sabato' : 'Domenica';
                    return (
                      <button key={date} type="button" aria-pressed={isSelected} onClick={() => toggleDateSelection(date)}
                        className={`min-w-0 p-2 rounded-lg border text-center capitalize ${isSelected ? 'border-accent bg-accent/20 text-accent' : 'border-tertiary hover:bg-tertiary'}`}>
                        <span className="block text-[10px] font-semibold uppercase tracking-wide">{dayLabel}</span>
                        <span className="block text-xs mt-1">{formatTournamentAvailabilityDate(date, { weekday: 'short' })}</span>
                        <span className="block font-bold">{formatTournamentAvailabilityDate(date, { day: 'numeric', month: 'short' })}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>

      <section className="space-y-4" aria-label="Disponibilità per le date selezionate">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-bold text-lg">Gestisci disponibilità per le date selezionate</h4>
            <p className="text-xs text-text-secondary mt-1">La fascia scelta verrà salvata separatamente per ogni data selezionata in cui è consentita.</p>
          </div>
          {loggedInPlayerId && (
            <button type="button" onClick={() => void toggleDateUnavailability()}
              disabled={savingPreference || savingVenues || effectiveSelectedDates.length === 0}
              className={`px-4 py-2 rounded-lg font-semibold disabled:opacity-50 ${allSelectedUnavailable ? 'bg-red-700 text-white' : 'bg-tertiary text-text-primary'}`}>
              {allSelectedUnavailable ? 'Rimuovi non disponibilità dalle date selezionate' : 'Segna date selezionate non disponibili'}
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {TOURNAMENT_VENUES.filter(venue => selectedVenues.has(venue.id)).map(venue => (
            <section key={venue.id} className="bg-primary p-4 rounded-lg border border-tertiary space-y-3">
              <h5 className="font-bold text-accent">{venue.name}</h5>
              <div className="space-y-2">
                {TOURNAMENT_AVAILABILITY_PERIODS.map(period => {
                  const allowedDates = effectiveSelectedDates.filter(date => isTournamentAvailabilityPeriodAllowedOnDate(period.id, date));
                  const selectedCount = loggedInPlayerId
                    ? allowedDates.filter(date => hasPeriod(loggedInPlayerId, venue.id, period.id, date)).length
                    : 0;
                  const allDatesSelected = allowedDates.length > 0 && selectedCount === allowedDates.length;
                  return (
                    <button key={period.id} type="button" aria-pressed={allDatesSelected}
                      onClick={() => void togglePeriod(venue.id, period.id)}
                      disabled={!loggedInPlayerId || savingPreference || savingVenues || allowedDates.length === 0}
                      className={`w-full flex items-center justify-between gap-3 p-3 rounded-lg border text-left disabled:opacity-50 ${allDatesSelected ? 'border-green-500 bg-green-950/40' : 'border-tertiary bg-secondary/60'}`}>
                      <span><span className="font-semibold">{period.label}</span><span className="block text-xs text-text-secondary">{period.hours}</span></span>
                      <span className={allDatesSelected ? 'text-green-400 font-semibold' : 'text-text-secondary'}>
                        {allowedDates.length === 0 ? 'Non disponibile in queste date' : `${selectedCount}/${allowedDates.length} date selezionate`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="font-bold">Disponibilità dichiarate · {selectedGroup.name} · date selezionate</h4>
        <div className="overflow-x-auto rounded-lg border border-tertiary">
          <table className="min-w-full text-sm bg-primary">
            <thead>
              <tr className="text-left border-b border-tertiary">
                <th className="p-3">Giocatore</th>
                {TOURNAMENT_VENUES.filter(venue => selectedVenues.has(venue.id)).map(venue => <th key={venue.id} className="p-3">{venue.name}</th>)}
                <th className="p-3">Giornata</th>
              </tr>
            </thead>
            <tbody>
              {participants.map(player => (
                <tr key={player.id} className="border-b border-tertiary last:border-0 align-top">
                  <td className="p-3 font-medium">{player.name}</td>
                  {TOURNAMENT_VENUES.filter(venue => selectedVenues.has(venue.id)).map(venue => (
                    <td key={venue.id} className="p-3">
                      {effectiveSelectedDates.length ? <ul className="space-y-1">{effectiveSelectedDates.map(date => {
                        const isUnavailable = dateUnavailMap[player.id]?.has(date) ?? false;
                        const periods = TOURNAMENT_AVAILABILITY_PERIODS
                          .filter(period => isTournamentAvailabilityPeriodAllowedOnDate(period.id, date) && hasPeriod(player.id, venue.id, period.id, date))
                          .map(period => period.label);
                        return <li key={date}>{formatTournamentAvailabilityDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}: {isUnavailable ? <span className="text-red-400">Non disponibile</span> : periods.length ? periods.join(', ') : 'nessuna fascia'}</li>;
                      })}</ul> : 'Seleziona una data'}
                    </td>
                  ))}
                  <td className="p-3">
                    {effectiveSelectedDates.length ? <ul className="space-y-1">{effectiveSelectedDates.map(date => (
                      <li key={date}>{formatTournamentAvailabilityDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}: {dateUnavailMap[player.id]?.has(date) ? <span className="text-red-400 font-semibold">Non disponibile</span> : 'Disponibile'}</li>
                    ))}</ul> : 'Seleziona una data'}
                  </td>
                </tr>
              ))}
              {participants.length === 0 && <tr><td className="p-3 text-text-secondary" colSpan={TOURNAMENT_VENUES.filter(venue => selectedVenues.has(venue.id)).length + 2}>
                {selectedGroup.name === 'Nessun girone assegnato' ? 'Non sei assegnato a un girone.' : 'Nessun partecipante assegnato.'}
              </td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
