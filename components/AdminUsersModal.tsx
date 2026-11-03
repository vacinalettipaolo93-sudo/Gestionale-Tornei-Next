import React, { useEffect, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { type Player, type User } from '../types';
import { updatePlayerProfile } from '../utils/updatePlayerProfile';

interface AdminUsersModalProps {
  users: User[];
  players: Player[];
  onClose: () => void;
}

type ActionType = 'editUsername' | 'editPlayer' | 'changePassword' | 'resetPassword';

interface ActionState {
  userId: string;
  action: ActionType;
  // editUsername fields
  newUsername: string;
  playerName: string;
  playerPhone: string;
  // password fields
  newPassword: string;
  confirmPassword: string;
  error: string | null;
  saving: boolean;
  success: boolean;
  confirming: boolean;
}

const initialAction = (userId: string, action: ActionType): ActionState => ({
  userId,
  action,
  newUsername: '',
  playerName: '',
  playerPhone: '',
  newPassword: '',
  confirmPassword: '',
  error: null,
  saving: false,
  success: false,
  confirming: false,
});

const AdminUsersModal: React.FC<AdminUsersModalProps> = ({ users, players, onClose }) => {
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [localUsers, setLocalUsers] = useState<User[]>(users);

  useEffect(() => {
    setLocalUsers(users);
  }, [users]);

  const sortedUsers = [...localUsers].sort((a, b) =>
    a.username.localeCompare(b.username, 'it', { sensitivity: 'base' })
  );

  const openAction = (userId: string, action: ActionType) => {
    const user = localUsers.find(item => item.id === userId);
    const player = players.find(item => item.id === user?.playerId);
    setActionState({
      ...initialAction(userId, action),
      playerName: player?.name ?? '',
      playerPhone: player?.phone ?? '',
    });
  };

  const closeAction = () => {
    setActionState(null);
  };

  const handleChange = (
    field: 'newUsername' | 'playerName' | 'playerPhone' | 'newPassword' | 'confirmPassword',
    value: string
  ) => {
    setActionState(prev =>
      prev ? { ...prev, [field]: value, error: null, success: false } : prev
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionState) return;

    const { action, newUsername, newPassword, confirmPassword } = actionState;

    if (action === 'editPlayer') {
      if (!actionState.playerName.trim()) {
        setActionState(prev =>
          prev ? { ...prev, error: 'Il nome del giocatore è obbligatorio.' } : prev
        );
        return;
      }
    } else if (action === 'editUsername') {
      if (!newUsername.trim()) {
        setActionState(prev =>
          prev ? { ...prev, error: 'Il nome utente è obbligatorio.' } : prev
        );
        return;
      }
      if (newUsername.trim().length < 3) {
        setActionState(prev =>
          prev ? { ...prev, error: 'Il nome utente deve essere di almeno 3 caratteri.' } : prev
        );
        return;
      }
      const duplicate = localUsers.find(
        u => u.username.toLowerCase() === newUsername.trim().toLowerCase() && u.id !== actionState.userId
      );
      if (duplicate) {
        setActionState(prev =>
          prev ? { ...prev, error: 'Nome utente già in uso da un altro utente.' } : prev
        );
        return;
      }
    } else {
      if (!newPassword) {
        setActionState(prev =>
          prev ? { ...prev, error: 'La nuova password è obbligatoria.' } : prev
        );
        return;
      }
      if (newPassword.length < 4) {
        setActionState(prev =>
          prev ? { ...prev, error: 'La password deve essere di almeno 4 caratteri.' } : prev
        );
        return;
      }
      if (newPassword !== confirmPassword) {
        setActionState(prev =>
          prev ? { ...prev, error: 'Le password non coincidono.' } : prev
        );
        return;
      }
    }

    setActionState(prev => prev ? { ...prev, confirming: true, error: null } : prev);
  };

  const handleConfirm = async () => {
    if (!actionState || actionState.saving) return;

    setActionState(prev => prev ? { ...prev, saving: true, error: null } : prev);

    try {
      if (actionState.action === 'editPlayer') {
        await updatePlayerProfile(actionState.userId, actionState.playerName, actionState.playerPhone);
      } else if (actionState.action === 'editUsername') {
        await updateDoc(doc(db, 'users', actionState.userId), {
          username: actionState.newUsername.trim(),
        });
      } else {
        await updateDoc(doc(db, 'users', actionState.userId), {
          password: actionState.newPassword,
        });
      }
      setActionState(prev =>
        prev ? { ...prev, saving: false, success: true, confirming: false } : prev
      );
    } catch (err: unknown) {
      setActionState(prev =>
        prev
          ? {
              ...prev,
              saving: false,
              confirming: false,
              error: err instanceof Error ? err.message : 'Errore durante il salvataggio.',
            }
          : prev
      );
    }
  };

  const handleCancelConfirm = () => {
    setActionState(prev => prev ? { ...prev, confirming: false } : prev);
  };

  const activeUser = actionState
    ? localUsers.find(u => u.id === actionState.userId)
    : null;

  const actionLabel = (action: ActionType) => {
    if (action === 'editUsername') return 'Modifica username';
    if (action === 'editPlayer') return 'Modifica giocatore';
    if (action === 'changePassword') return 'Modifica password';
    return 'Reimposta password';
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-lg border border-tertiary max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-lg font-bold">Controllo Utenti</h4>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors text-2xl leading-none"
            aria-label="Chiudi"
          >
            &times;
          </button>
        </div>

        <p className="text-sm text-text-secondary mb-4">
          Elenco utenti in ordine alfabetico. Le password non vengono mostrate.
          Puoi modificare username, nome del giocatore e telefono, cambiare la password o reimpostarla.
        </p>

        <div className="overflow-y-auto flex-1 space-y-2">
          {sortedUsers.map(user => {
            const player = players.find(item => item.id === user.playerId);
            return (
              <div
                key={user.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-primary rounded-lg px-4 py-3 border border-tertiary/50 gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-text-primary truncate">{user.username}</span>
                    <span
                      className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${
                        user.role === 'organizer'
                          ? 'bg-highlight/20 text-highlight'
                          : 'bg-tertiary text-text-secondary'
                      }`}
                    >
                      {user.role === 'organizer' ? 'Organizzatore' : 'Partecipante'}
                    </span>
                  </div>
                  {player && (
                    <p className="text-xs text-text-secondary break-words mt-1">
                      {player.name} · {player.phone || 'Telefono non inserito'}
                    </p>
                  )}
                  {user.playerId && !player && (
                    <p className="text-xs text-red-400 mt-1">Giocatore collegato non trovato.</p>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => openAction(user.id, 'editUsername')}
                    className="text-xs bg-tertiary hover:bg-tertiary/80 text-text-primary font-semibold py-1.5 px-3 rounded-lg transition-colors"
                  >
                    Username
                  </button>
                  {player && (
                    <button
                      onClick={() => openAction(user.id, 'editPlayer')}
                      className="text-xs bg-tertiary hover:bg-tertiary/80 text-text-primary font-semibold py-1.5 px-3 rounded-lg transition-colors"
                    >
                      Nome e telefono
                    </button>
                  )}
                  <button
                    onClick={() => openAction(user.id, 'changePassword')}
                    className="text-xs bg-accent/80 hover:bg-accent text-white font-semibold py-1.5 px-3 rounded-lg transition-colors"
                  >
                    Password
                  </button>
                  <button
                    onClick={() => openAction(user.id, 'resetPassword')}
                    className="text-xs bg-highlight/80 hover:bg-highlight text-white font-semibold py-1.5 px-3 rounded-lg transition-colors"
                  >
                    Reset
                  </button>
                </div>
              </div>
            );
          })}

          {sortedUsers.length === 0 && (
            <p className="text-text-secondary text-center py-6">Nessun utente trovato.</p>
          )}
        </div>
      </div>

      {/* Action modal */}
      {actionState && activeUser && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-60 animate-fadeIn">
          <div className="bg-secondary rounded-xl shadow-2xl p-6 w-full max-w-sm border border-tertiary">
            {actionState.confirming ? (
              <>
                <h5 className="text-base font-bold mb-3">
                  Conferma — {actionLabel(actionState.action)}
                </h5>
                <p className="text-sm text-text-secondary mb-4">
                  {actionState.action === 'editPlayer' ? (
                    <>
                      Stai per aggiornare il giocatore di{' '}
                      <strong className="text-text-primary">{activeUser.username}</strong>: nome{' '}
                      <strong className="text-text-primary">{actionState.playerName.trim()}</strong>, telefono{' '}
                      <strong className="text-text-primary">{actionState.playerPhone.trim() || 'non inserito'}</strong>.
                      {' '}La modifica sarà salvata in tutte le modalità. Lo username di accesso non cambia. Procedere?
                    </>
                  ) : actionState.action === 'editUsername' ? (
                    <>
                      Stai per cambiare il nome utente di{' '}
                      <strong className="text-text-primary">{activeUser.username}</strong> in{' '}
                      <strong className="text-text-primary">{actionState.newUsername.trim()}</strong>.
                      Procedere?
                    </>
                  ) : (
                    <>
                      Stai per {actionState.action === 'resetPassword' ? 'reimpostare' : 'modificare'}{' '}
                      la password di{' '}
                      <strong className="text-text-primary">{activeUser.username}</strong>.
                      Questa operazione è irreversibile. Procedere?
                    </>
                  )}
                </p>
                {actionState.error && (
                  <p className="text-sm text-red-400 mb-3">{actionState.error}</p>
                )}
                <div className="flex justify-end gap-3">
                  <button
                    onClick={handleCancelConfirm}
                    disabled={actionState.saving}
                    className="bg-tertiary hover:bg-tertiary/80 text-text-primary font-bold py-2 px-4 rounded-lg transition-colors"
                  >
                    Annulla
                  </button>
                  <button
                    onClick={handleConfirm}
                    disabled={actionState.saving}
                    className="bg-highlight hover:bg-highlight/80 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg transition-colors"
                  >
                    {actionState.saving ? 'Salvataggio...' : 'Conferma'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h5 className="text-base font-bold mb-3">
                  {actionLabel(actionState.action)} —{' '}
                  <span className="text-accent">{activeUser.username}</span>
                </h5>
                {actionState.success && (
                  <div className="text-sm text-green-400 mb-4">
                    {actionState.action === 'editPlayer'
                      ? 'Nome e telefono aggiornati in tutte le modalità!'
                      : actionState.action === 'editUsername'
                      ? 'Nome utente aggiornato con successo!'
                      : 'Password aggiornata con successo!'}
                  </div>
                )}
                <form onSubmit={handleSubmit} className="space-y-4">
                  {actionState.action === 'editPlayer' ? (
                    <>
                      <div>
                        <label htmlFor="admin-player-name" className="block text-sm text-text-secondary mb-1">
                          Nome del giocatore
                        </label>
                        <input
                          id="admin-player-name"
                          type="text"
                          value={actionState.playerName}
                          onChange={e => handleChange('playerName', e.target.value)}
                          className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary focus:ring-2 focus:ring-accent focus:border-accent"
                          autoFocus
                          required
                          disabled={actionState.saving}
                        />
                      </div>
                      <div>
                        <label htmlFor="admin-player-phone" className="block text-sm text-text-secondary mb-1">
                          Numero di telefono
                        </label>
                        <input
                          id="admin-player-phone"
                          type="tel"
                          value={actionState.playerPhone}
                          onChange={e => handleChange('playerPhone', e.target.value)}
                          className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary focus:ring-2 focus:ring-accent focus:border-accent"
                          disabled={actionState.saving}
                        />
                      </div>
                    </>
                  ) : actionState.action === 'editUsername' ? (
                    <div>
                      <label className="block text-sm text-text-secondary mb-1">
                        Nuovo nome utente
                      </label>
                      <input
                        type="text"
                        value={actionState.newUsername}
                        onChange={e => handleChange('newUsername', e.target.value)}
                        className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary focus:ring-2 focus:ring-accent focus:border-accent"
                        autoFocus
                        disabled={actionState.saving}
                      />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-sm text-text-secondary mb-1">
                          Nuova password
                        </label>
                        <input
                          type="password"
                          value={actionState.newPassword}
                          onChange={e => handleChange('newPassword', e.target.value)}
                          className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary focus:ring-2 focus:ring-accent focus:border-accent"
                          autoFocus
                          disabled={actionState.saving}
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-text-secondary mb-1">
                          Conferma nuova password
                        </label>
                        <input
                          type="password"
                          value={actionState.confirmPassword}
                          onChange={e => handleChange('confirmPassword', e.target.value)}
                          className="w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary focus:ring-2 focus:ring-accent focus:border-accent"
                          disabled={actionState.saving}
                        />
                      </div>
                    </>
                  )}
                  {actionState.error && (
                    <p className="text-sm text-red-400">{actionState.error}</p>
                  )}
                  <div className="flex justify-end gap-3 mt-2">
                    <button
                      type="button"
                      onClick={closeAction}
                      disabled={actionState.saving}
                      className="bg-tertiary hover:bg-tertiary/80 text-text-primary font-bold py-2 px-4 rounded-lg transition-colors"
                    >
                      Annulla
                    </button>
                    <button
                      type="submit"
                      disabled={actionState.saving}
                      className="bg-highlight hover:bg-highlight/80 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg transition-colors"
                    >
                      {actionState.saving ? 'Salvataggio...' : 'Salva'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminUsersModal;
