import React, { useState } from 'react';
import { type Group, type Match, type Player } from '../types';

// AGGIUNTA: funzione ICS per calendario
function downloadIcsForMatch({eventName, opponentName, date, startTime}: {eventName: string, opponentName: string, date: string, startTime: string}) {
  const pad = (num: number) => String(num).padStart(2, '0');
  const dtEnd = (() => {
    const [h, m] = startTime.split(':').map(Number);
    // date is expected in YYYY-MM-DD and startTime HH:MM
    const dateObj = new Date(`${date}T${startTime}`);
    // fallback if invalid
    if (isNaN(dateObj.getTime())) {
      const parts = date.split('-').map(Number);
      dateObj.setFullYear(parts[0], parts[1] - 1, parts[2]);
      dateObj.setHours(h, m, 0, 0);
    }
    // durata = 1 ora
    dateObj.setHours(dateObj.getHours() + 1);
    return pad(dateObj.getHours()) + pad(dateObj.getMinutes());
  })();
  const icsContent = [
    `BEGIN:VCALENDAR`,
    `VERSION:2.0`,
    `BEGIN:VEVENT`,
    `SUMMARY:${eventName} - Partita vs ${opponentName}`,
    `DTSTART:${date.replace(/-/g, '')}T${startTime.replace(':','')}00`,
    `DTEND:${date.replace(/-/g, '')}T${dtEnd}00`,
    `DESCRIPTION:Partita torneo contro ${opponentName}`,
    `END:VEVENT`,
    `END:VCALENDAR`
  ].join('\r\n');
  const blob = new Blob([icsContent], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${eventName}_vs_${opponentName}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// /FINE AGGIUNTA funzione ICS

// AGGIUNTA: Apri Google Calendar con evento precompilato
function openGoogleCalendarForMatch({ eventName, opponentName, date, startTime, durationMinutes = 60, location = '', description = '' }:
  { eventName: string; opponentName: string; date: string; startTime: string; durationMinutes?: number; location?: string; description?: string }) {

  // costruiamo una Date locale a partire da date (YYYY-MM-DD) e startTime (HH:MM)
  const [h, m] = startTime.split(':').map(Number);
  let startLocal = new Date(`${date}T${startTime}:00`);
  if (isNaN(startLocal.getTime())) {
    // fallback: crea manualmente
    const parts = date.split('-').map(Number);
    startLocal = new Date(parts[0], parts[1] - 1, parts[2], h, m, 0);
  }

  const endLocal = new Date(startLocal.getTime() + durationMinutes * 60000);

  // Converti in formato Google (YYYYMMDDTHHMMSSZ) - usare UTC per compatibilità
  const toGoogleDateTime = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    const mm = pad(d.getUTCMonth() + 1);
    const dd = pad(d.getUTCDate());
    const hh = pad(d.getUTCHours());
    const min = pad(d.getUTCMinutes());
    const sec = pad(d.getUTCSeconds());
    return `${yyyy}${mm}${dd}T${hh}${min}${sec}Z`;
  };

  const startStr = toGoogleDateTime(startLocal);
  const endStr = toGoogleDateTime(endLocal);

  const title = encodeURIComponent(`${eventName} - vs ${opponentName}`);
  const details = encodeURIComponent(description || `Partita vs ${opponentName}`);
  const loc = encodeURIComponent(location || '');

  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&location=${loc}&dates=${startStr}/${endStr}`;

  window.open(url, '_blank');
}
// /FINE AGGIUNTA Google Calendar

interface MatchListProps {
  group?: Group | null;
  players?: Player[];
  onEditResult: (match: Match, triggerRect?: DOMRect | null) => void;
  onBookMatch: (match: Match, triggerRect?: DOMRect | null) => void;
  isOrganizer: boolean;
  loggedInPlayerId?: string;
  onPlayerContact: (player: Player) => void;
  onRescheduleMatch?: (match: Match, triggerRect?: DOMRect | null) => void;
  onCancelBooking?: (match: Match) => void;
  onDeleteResult?: (match: Match, triggerRect?: DOMRect | null) => void;
  viewingOwnGroup?: boolean;
}

const MatchCard: React.FC<{
  match: Match;
  player1?: Player | null;
  player2?: Player | null;
  onEditResult: (match: Match, triggerRect?: DOMRect | null) => void;
  onBookMatch: (match: Match, triggerRect?: DOMRect | null) => void;
  isOrganizer: boolean;
  loggedInPlayerId?: string;
  onPlayerContact: (player: Player) => void;
  onRescheduleMatch?: (match: Match, triggerRect?: DOMRect | null) => void;
  onCancelBooking?: (match: Match) => void;
  onDeleteResult?: (match: Match, triggerRect?: DOMRect | null) => void;
  viewingOwnGroup?: boolean;
}> = ({
  match,
  player1,
  player2,
  onEditResult,
  onBookMatch,
  isOrganizer,
  loggedInPlayerId,
  onPlayerContact,
  onRescheduleMatch,
  onCancelBooking,
  onDeleteResult,
  viewingOwnGroup = false
}) => {
  if (!player1 || !player2) {
    return (
      <div className="bg-secondary p-4 rounded-lg shadow">
        <div className="text-text-secondary">Giocatori non disponibili per questa partita.</div>
      </div>
    );
  }

  const isParticipant = !!(loggedInPlayerId && (loggedInPlayerId === player1.id || loggedInPlayerId === player2.id));
  const canManageBooking = isOrganizer || (isParticipant && viewingOwnGroup);
  const canEnterResult = isOrganizer || (isParticipant && viewingOwnGroup);
  const canBook = isOrganizer || (isParticipant && viewingOwnGroup);
  const canDeleteResult = isOrganizer || (isParticipant && viewingOwnGroup);

  const scheduledInfo = match.status === 'scheduled' && match.scheduledTime
    ? {
        date: new Date(match.scheduledTime).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }),
        time: new Date(match.scheduledTime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
        field: [match.location, match.field].filter(Boolean).join(' · ')
      }
    : null;

  // compute local date/time
  const localDateObj = match.scheduledTime ? new Date(match.scheduledTime) : null;

  const rawDate = localDateObj
    ? `${String(localDateObj.getDate()).padStart(2, '0')}-${String(localDateObj.getMonth() + 1).padStart(2, '0')}-${localDateObj.getFullYear()}`
    : '';

  const rawTime = localDateObj
    ? `${String(localDateObj.getHours()).padStart(2, '0')}:${String(localDateObj.getMinutes()).padStart(2, '0')}`
    : '';

  const localDateIso = localDateObj
    ? `${localDateObj.getFullYear()}-${String(localDateObj.getMonth() + 1).padStart(2, '0')}-${String(localDateObj.getDate()).padStart(2, '0')}`
    : '';
  const localTimeIso = localDateObj
    ? `${String(localDateObj.getHours()).padStart(2, '0')}:${String(localDateObj.getMinutes()).padStart(2, '0')}`
    : '';

  return (
    <div className="bg-secondary p-4 rounded-lg shadow">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="flex items-center gap-3 justify-start">
          <img src={player1.avatar} alt={player1.name} className="w-10 h-10 rounded-full object-cover" />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPlayerContact(player1); }}
            className="text-left font-semibold hover:underline text-text-primary cursor-pointer"
          >
            {player1.name}
          </button>
        </div>

        <div className="flex flex-col items-center">
          {match.score1 != null && match.score2 != null ? (
            <div className="text-2xl font-bold text-center">
              {match.score1} — {match.score2}
            </div>
          ) : (
            <div className="text-lg font-medium text-center text-text-secondary">vs</div>
          )}
          {scheduledInfo && (
            <div className="text-sm text-text-secondary mt-2 text-center">
              <span>
                {scheduledInfo.date} — {scheduledInfo.time}
              </span>
              {scheduledInfo.field && (
                <div className="font-bold text-white">
                  {scheduledInfo.field}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 justify-end">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPlayerContact(player2); }}
            className="font-semibold hover:underline text-text-primary cursor-pointer"
          >
            {player2.name}
          </button>
          <img src={player2.avatar} alt={player2.name} className="w-10 h-10 rounded-full object-cover" />
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 pt-4 mt-4 border-t border-tertiary/50">
        {match.status === 'pending' && canBook && (
          <button
            onClick={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.focus();
              const rect = el.getBoundingClientRect();
              e.stopPropagation();
              if (typeof onBookMatch === 'function') onBookMatch(match, rect);
            }}
            className="bg-accent/80 hover:bg-accent text-primary font-bold py-2 px-3 rounded-lg text-sm transition-colors"
            type="button"
          >
            Prenota
          </button>
        )}
        {canEnterResult && (
          <button
            type="button"
            onClick={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.focus();
              const rect = el.getBoundingClientRect();
              e.stopPropagation();
              onEditResult(match, rect);
            }}
            className="bg-highlight/80 hover:bg-highlight text-white font-bold py-2 px-3 rounded-lg text-sm transition-colors"
          >
            Risultato
          </button>
        )}
        {match.status === 'scheduled' && canManageBooking && onRescheduleMatch && (
          <button
            type="button"
            onClick={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.focus();
              const rect = el.getBoundingClientRect();
              e.stopPropagation();
              onRescheduleMatch(match, rect);
            }}
            className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-3 rounded-lg text-sm transition-colors"
          >
            Modifica pren.
          </button>
        )}
        {match.status === 'scheduled' && canManageBooking && onCancelBooking && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCancelBooking && onCancelBooking(match); }}
            className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-3 rounded-lg text-sm transition-colors"
          >
            Annulla pren.
          </button>
        )}
        {match.score1 != null && match.score2 != null && canDeleteResult && onDeleteResult && (
          <button
            type="button"
            onClick={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.focus();
              const rect = el.getBoundingClientRect();
              e.stopPropagation();
              if (typeof onDeleteResult === 'function') onDeleteResult(match, rect);
            }}
            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-3 rounded-lg text-sm transition-colors"
          >
            Elimina risultato
          </button>
        )}
      </div>

      {match.status === 'scheduled' && isParticipant && scheduledInfo && (
        <div className="flex gap-2 mt-4 justify-center">
          <button
            className="bg-highlight text-white text-xs px-3 py-1 rounded hover:bg-accent"
            onClick={() => {
              const eventName = 'Partita torneo';
              const opponentName = loggedInPlayerId === player1.id ? player2.name : player1.name;
              downloadIcsForMatch({ eventName, opponentName, date: localDateIso, startTime: localTimeIso });
            }}
          >
            Scarica .ics
          </button>

          <button
            className="bg-blue-600 text-white text-xs px-3 py-1 rounded hover:bg-blue-700"
            onClick={() => {
              const eventName = 'Partita torneo';
              const opponentName = loggedInPlayerId === player1.id ? player2.name : player1.name;
              const location = scheduledInfo.field || '';
              const description = `Partita del torneo contro ${opponentName} - prenotata tramite Tournament Manager.`;
              openGoogleCalendarForMatch({ eventName, opponentName, date: localDateIso, startTime: localTimeIso, durationMinutes: 60, location, description });
            }}
          >
            Aggiungi a Google Calendar
          </button>

          <a
            className="bg-green-600 text-white text-xs px-3 py-1 rounded hover:bg-green-700"
            target="_blank"
            rel="noopener noreferrer"
            href={(() => {
              const myName = loggedInPlayerId === player1.id ? player1.name : player2.name;
              const opponentName = loggedInPlayerId === player1.id ? player2.name : player1.name;
              const opponentPhone = loggedInPlayerId === player1.id ? player2.phone : player1.phone;
              const msg = encodeURIComponent(
                `Ciao ${opponentName},\nti ricordo che hai una partita prenotata al torneo contro di me (${myName}) il ${rawDate} alle ${rawTime}.`
              );
              return `https://wa.me/${opponentPhone?.replace(/[^0-9]/g, '')}?text=${msg}`;
            })()}
          >
            Invia promemoria WhatsApp
          </a>
        </div>
      )}
    </div>
  );
};

const MatchList: React.FC<MatchListProps> = ({
  group = null,
  players = [],
  onEditResult,
  onBookMatch,
  isOrganizer,
  loggedInPlayerId,
  onPlayerContact,
  onRescheduleMatch,
  onCancelBooking,
  onDeleteResult,
  viewingOwnGroup = false
}) => {
  const [filter, setFilter] = useState<'all' | 'my'>(isOrganizer ? 'all' : 'my');

  if (!group) {
    return <p className="text-center text-text-secondary py-6">Seleziona un girone per vedere le partite.</p>;
  }

  const getPlayer = (playerId?: string) => players.find(p => p.id === playerId);

  const filteredMatches = (status: Match['status']) => {
    return group.matches.filter(m => {
      const isMyMatch = !!(loggedInPlayerId && (m.player1Id === loggedInPlayerId || m.player2Id === loggedInPlayerId));
      return m.status === status && (filter === 'all' || isMyMatch);
    });
  };

  const pendingMatches = filteredMatches('pending');

  // scheduled only if slotId + scheduledTime
  const scheduledMatches = group.matches.filter(m =>
    m.status === 'scheduled' &&
    m.slotId &&
    m.scheduledTime &&
    (filter === 'all' || (!!loggedInPlayerId && (m.player1Id === loggedInPlayerId || m.player2Id === loggedInPlayerId)))
  );

  const completedMatches = group.matches.filter(m => m.score1 != null && m.score2 != null);

  const sortByTime = (arr: Match[]) =>
    arr.slice().sort((a, b) => {
      const ta = a.scheduledTime ? new Date(a.scheduledTime).getTime() : 0;
      const tb = b.scheduledTime ? new Date(b.scheduledTime).getTime() : 0;
      return ta - tb;
    });

  return (
    <div className="space-y-6">
      {!isOrganizer && (
        <div className="flex justify-center mb-4">
          <div className="bg-tertiary/50 rounded-lg p-1 flex">
            <button
              onClick={() => setFilter('my')}
              className={`px-4 py-1 text-sm font-semibold rounded-md transition-colors ${filter === 'my' ? 'bg-highlight text-white' : 'text-text-secondary'}`}
              type="button"
            >
              Le mie
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-1 text-sm font-semibold rounded-md transition-colors ${filter === 'all' ? 'bg-highlight text-white' : 'text-text-secondary'}`}
              type="button"
            >
              Tutte
            </button>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-lg font-semibold mb-3 text-accent">Partite Programmate</h4>
        <div className="space-y-3">
          {scheduledMatches.length > 0 ? sortByTime(scheduledMatches).map(match => (
            <MatchCard
              key={match.id}
              match={match}
              player1={getPlayer(match.player1Id)}
              player2={getPlayer(match.player2Id)}
              onEditResult={onEditResult}
              onBookMatch={onBookMatch}
              isOrganizer={isOrganizer}
              loggedInPlayerId={loggedInPlayerId}
              onPlayerContact={onPlayerContact}
              onRescheduleMatch={onRescheduleMatch}
              onCancelBooking={onCancelBooking}
              onDeleteResult={onDeleteResult}
              viewingOwnGroup={viewingOwnGroup}
            />
          )) : <p className="text-text-secondary text-center py-4">Nessuna partita programmata.</p>}
        </div>
      </div>

      <div>
        <h4 className="text-lg font-semibold mb-3 text-accent">Partite da Fare</h4>
        <div className="space-y-3">
          {pendingMatches.length > 0 ? pendingMatches.map(match => (
            <MatchCard
              key={match.id}
              match={match}
              player1={getPlayer(match.player1Id)}
              player2={getPlayer(match.player2Id)}
              onEditResult={onEditResult}
              onBookMatch={onBookMatch}
              isOrganizer={isOrganizer}
              loggedInPlayerId={loggedInPlayerId}
              onPlayerContact={onPlayerContact}
              onRescheduleMatch={onRescheduleMatch}
              onCancelBooking={onCancelBooking}
              onDeleteResult={onDeleteResult}
              viewingOwnGroup={viewingOwnGroup}
            />
          )) : <p className="text-text-secondary text-center py-4">Nessuna partita da disputare.</p>}
        </div>
      </div>

      <div>
        <h4 className="text-lg font-semibold mb-3 text-accent">Partite Completate</h4>
        <div className="space-y-3">
          {completedMatches.length > 0 ? completedMatches.map(match => (
            <MatchCard
              key={match.id}
              match={match}
              player1={getPlayer(match.player1Id)}
              player2={getPlayer(match.player2Id)}
              onEditResult={onEditResult}
              onBookMatch={onBookMatch}
              isOrganizer={isOrganizer}
              loggedInPlayerId={loggedInPlayerId}
              onPlayerContact={onPlayerContact}
              onRescheduleMatch={onRescheduleMatch}
              onCancelBooking={onCancelBooking}
              onDeleteResult={onDeleteResult}
              viewingOwnGroup={viewingOwnGroup}
            />
          )) : <p className="text-text-secondary text-center py-4">Nessuna partita completata.</p>}
        </div>
      </div>
    </div>
  );
};

export default MatchList;
