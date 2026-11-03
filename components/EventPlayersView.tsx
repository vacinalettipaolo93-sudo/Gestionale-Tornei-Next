import { doc, runTransaction } from 'firebase/firestore';
import React, { useMemo, useState } from 'react';
import { db } from '../firebase';
import { type Event, type Player } from '../types';
import { createInitialsAvatar } from '../utils/avatar';
import { addPlayerToEvent, removePlayerFromEvent } from '../utils/eventPlayers.js';
import { createPlayerWithAccount } from '../services/playerDataService';

interface EventPlayersViewProps {
  event: Event;
  players: Player[];
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  isOrganizer: boolean;
}

const EventPlayersView: React.FC<EventPlayersViewProps> = ({ event, players, setEvents, isOrganizer }) => {
  const [search, setSearch] = useState('');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerPhone, setNewPlayerPhone] = useState('');
  const [loadingPlayerId, setLoadingPlayerId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const eventPlayerIds = useMemo(() => new Set(event.players.map(player => player.id)), [event.players]);
  const availablePlayers = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return players
      .filter(player => !eventPlayerIds.has(player.id))
      .filter(player => !normalizedSearch
        || player.name.toLocaleLowerCase().includes(normalizedSearch)
        || (player.phone ?? '').toLocaleLowerCase().includes(normalizedSearch))
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [eventPlayerIds, players, search]);
  const sortedEventPlayers = useMemo(
    () => event.players
      .filter((player, index, allPlayers) => allPlayers.findIndex(item => item.id === player.id) === index)
      .slice()
      .sort((first, second) => first.name.localeCompare(second.name)),
    [event.players],
  );

  const associatePlayer = async (player: Player) => {
    if (!isOrganizer || loadingPlayerId || isCreating) return;
    setLoadingPlayerId(player.id);
    setFeedback(null);

    try {
      const eventRef = doc(db, 'events', event.id);
      const updatedPlayers = await runTransaction(db, async transaction => {
        const eventSnapshot = await transaction.get(eventRef);
        const playerSnapshot = await transaction.get(doc(db, 'players', player.id));
        if (!eventSnapshot.exists() || !playerSnapshot.exists()) {
          throw new Error('Evento o giocatore non trovato.');
        }

        const profile = playerSnapshot.data();
        const eventPlayer: Player = {
          id: player.id,
          name: String(profile.name ?? player.name),
          phone: String(profile.phone ?? ''),
          avatar: String(profile.avatar ?? createInitialsAvatar(String(profile.name ?? player.name))),
          status: 'confirmed',
          ...(typeof profile.summerRankingStartPoints === 'number'
            ? { summerRankingStartPoints: profile.summerRankingStartPoints }
            : {}),
          ...(typeof profile.summerRankingJoinedAt === 'string'
            ? { summerRankingJoinedAt: profile.summerRankingJoinedAt }
            : {}),
        };
        const result = addPlayerToEvent(eventSnapshot.data().players, eventPlayer);
        if (result.added) transaction.update(eventRef, { players: result.players });
        return result;
      });

      if (updatedPlayers.added) {
        setFeedback({ type: 'success', message: `${player.name} aggiunto alla lista dell’evento.` });
      } else {
        setFeedback({ type: 'success', message: `${player.name} è già presente nell’evento.` });
      }
    } catch (error) {
      console.error('Errore associazione giocatore all’evento', error);
      setFeedback({ type: 'error', message: 'Impossibile aggiungere il giocatore. Riprova.' });
    } finally {
      setLoadingPlayerId(null);
    }
  };

  const createAndAssociatePlayer = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    if (!isOrganizer || isCreating || loadingPlayerId) return;

    const name = newPlayerName.trim();
    const phone = newPlayerPhone.trim();
    if (!name) {
      setFeedback({ type: 'error', message: 'Il nome del giocatore è obbligatorio.' });
      return;
    }

    setIsCreating(true);
    setFeedback(null);
    try {
      const player = await createPlayerWithAccount(name, phone, undefined, [event.id]);

      setNewPlayerName('');
      setNewPlayerPhone('');
      setFeedback({
        type: 'success',
        message: `${player.name} salvato nell’archivio e aggiunto all’evento, con account di accesso. Le password esistenti non sono state modificate.`,
      });
    } catch (error) {
      console.error('Errore creazione giocatore per l’evento', error);
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Impossibile creare il giocatore. Riprova.' });
    } finally {
      setIsCreating(false);
    }
  };

  const disassociatePlayer = async (player: Player) => {
    if (!isOrganizer || loadingPlayerId || isCreating) return;
    const isAssignedToGroup = event.tournaments.some(tournament =>
      tournament.groups.some(group => group.playerIds.includes(player.id)),
    );
    const groupWarning = isAssignedToGroup
      ? ' I gironi e le partite già create non verranno modificati.'
      : '';
    if (!window.confirm(`Rimuovere ${player.name} dalla lista di questo evento? Il giocatore resterà nell’archivio globale.${groupWarning}`)) return;

    setLoadingPlayerId(player.id);
    setFeedback(null);
    try {
      const eventRef = doc(db, 'events', event.id);
      const updatedPlayers = await runTransaction(db, async transaction => {
        const eventSnapshot = await transaction.get(eventRef);
        if (!eventSnapshot.exists()) throw new Error('Evento non trovato.');
        const currentPlayers = Array.isArray(eventSnapshot.data().players) ? eventSnapshot.data().players : [];
        const nextPlayers = removePlayerFromEvent(currentPlayers, player.id);
        if (nextPlayers.length !== currentPlayers.length) {
          transaction.update(eventRef, { players: nextPlayers });
        }
        return nextPlayers;
      });

      setFeedback({ type: 'success', message: `${player.name} rimosso dall’evento; l’archivio globale non è stato modificato.` });
    } catch (error) {
      console.error('Errore rimozione giocatore dall’evento', error);
      setFeedback({ type: 'error', message: 'Impossibile rimuovere il giocatore. Riprova.' });
    } finally {
      setLoadingPlayerId(null);
    }
  };

  return (
    <section className="space-y-6 animate-fadeIn" aria-labelledby="event-players-heading">
      <div className="bg-secondary rounded-xl shadow-lg p-6">
        <h2 id="event-players-heading" className="text-2xl font-bold text-accent">
          Lista giocatori ({sortedEventPlayers.length})
        </h2>
        <p className="text-text-secondary mt-1">
          I giocatori associati qui saranno disponibili per la futura creazione dei gironi.
          {' '}Restano nell’archivio globale e possono essere aggiunti anche ai nuovi eventi.
        </p>
      </div>

      {feedback && (
        <p role="status" className={feedback.type === 'error' ? 'text-red-400' : 'text-green-400'}>
          {feedback.message}
        </p>
      )}

      {isOrganizer && (
        <>
          <div className="bg-secondary rounded-xl shadow-lg p-6">
            <h3 className="text-lg font-semibold mb-3">Aggiungi un giocatore dall’archivio</h3>
            <label htmlFor="event-player-search" className="sr-only">Cerca giocatori</label>
            <input
              id="event-player-search"
              type="search"
              value={search}
              onChange={inputEvent => setSearch(inputEvent.target.value)}
              placeholder="Cerca per nome o telefono"
              className="w-full bg-primary border border-tertiary rounded-lg p-2 mb-4 text-text-primary"
            />
            {availablePlayers.length ? (
              <ul className="space-y-2">
                {availablePlayers.map(player => (
                  <li key={player.id} className="flex items-center justify-between gap-3 bg-tertiary/50 p-3 rounded-lg">
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={player.avatar || createInitialsAvatar(player.name)}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{player.name}</p>
                        <p className="text-sm text-text-secondary">{player.phone || 'Nessun telefono'}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void associatePlayer(player)}
                      disabled={loadingPlayerId !== null || isCreating}
                      className="bg-highlight hover:bg-highlight/90 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg"
                    >
                      {loadingPlayerId === player.id ? 'Aggiunta…' : 'Aggiungi'}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-secondary italic">
                {players.length ? 'Nessun giocatore disponibile corrisponde alla ricerca.' : 'Nessun giocatore disponibile nell’archivio globale.'}
              </p>
            )}
          </div>

          <div className="bg-secondary rounded-xl shadow-lg p-6">
            <h3 className="text-lg font-semibold mb-3">Crea un nuovo giocatore</h3>
            <p className="text-sm text-text-secondary mb-3">
              Il nuovo account comparirà in Controllo Utenti: accesso con Nome Cognome e password iniziale 1234.
              Le password degli account già esistenti restano invariate.
            </p>
            <form onSubmit={createAndAssociatePlayer} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3">
              <input
                type="text"
                value={newPlayerName}
                onChange={inputEvent => setNewPlayerName(inputEvent.target.value)}
                placeholder="Nome e cognome"
                required
                className="bg-primary border border-tertiary rounded-lg p-2 text-text-primary"
              />
              <input
                type="tel"
                value={newPlayerPhone}
                onChange={inputEvent => setNewPlayerPhone(inputEvent.target.value)}
                placeholder="Numero di telefono (facoltativo)"
                className="bg-primary border border-tertiary rounded-lg p-2 text-text-primary"
              />
              <button
                type="submit"
                disabled={isCreating || loadingPlayerId !== null}
                className="bg-highlight hover:bg-highlight/90 disabled:opacity-50 text-white font-bold py-2 px-4 rounded-lg"
              >
                {isCreating ? 'Creazione…' : 'Crea e aggiungi'}
              </button>
            </form>
          </div>
        </>
      )}

      <div className="bg-secondary rounded-xl shadow-lg p-6">
        <h3 className="text-lg font-semibold mb-3">Giocatori associati</h3>
        {sortedEventPlayers.length ? (
          <ul className="space-y-2">
            {sortedEventPlayers.map(player => (
              <li key={player.id} className="flex items-center justify-between gap-3 bg-tertiary/50 p-3 rounded-lg">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={player.avatar || createInitialsAvatar(player.name)}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover"
                  />
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{player.name}</p>
                    <p className="text-sm text-text-secondary">{player.phone || 'Nessun telefono'}</p>
                  </div>
                </div>
                {isOrganizer && (
                  <button
                    type="button"
                    onClick={() => void disassociatePlayer(player)}
                    disabled={loadingPlayerId !== null || isCreating}
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg"
                  >
                    {loadingPlayerId === player.id ? 'Rimozione…' : 'Rimuovi'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-secondary italic">Non ci sono ancora giocatori associati a questo evento.</p>
        )}
      </div>
    </section>
  );
};

export default EventPlayersView;
