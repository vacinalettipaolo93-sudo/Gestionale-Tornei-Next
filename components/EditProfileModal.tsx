import { doc, runTransaction } from "firebase/firestore";
import React, { useMemo, useRef, useState } from 'react';
import { db } from "../firebase";
import { type Event, type User } from '../types';
import {
  ACCEPTED_IMAGE_EXTENSIONS,
  compressImageToDataUrl,
  createInitialsAvatar,
  getCharacterAvatarPresets,
  isSafeAvatarSource,
  validateImageFile,
} from '../utils/avatar';
import { updatePlayerEverywhere } from '../utils/updatePlayerProfile';
import { FaceSmileIcon, LinkIcon, PhotoIcon, TrashIcon } from './Icons';

interface EditProfileModalProps {
  user: User;
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  events: Event[];
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  onClose: () => void;
  initialTab?: 'password' | 'avatar';
}

type ConfirmAction = 'password' | 'avatar';

const EditProfileModal: React.FC<EditProfileModalProps> = ({ user, users, events, onClose, initialTab = 'password' }) => {
  const [activeTab, setActiveTab] = useState<'password' | 'avatar'>(initialTab);

  // Password state
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Avatar state
  const [imageUrl, setImageUrl] = useState('');
  const [avatarError, setAvatarError] = useState('');
  const [avatarSuccess, setAvatarSuccess] = useState('');
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [pendingAvatar, setPendingAvatar] = useState<string | null>(null);
  const [pendingAvatarLabel, setPendingAvatarLabel] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const characterAvatarPresets = useMemo(() => getCharacterAvatarPresets(), []);

  const validatePasswordChange = () => {
    const currentUserState = users.find(u => u.id === user.id);
    if (!currentUserState || currentUserState.password !== oldPassword) {
      return 'La vecchia password non è corretta.';
    }
    if (newPassword.length < 4) {
      return 'La nuova password deve essere di almeno 4 caratteri.';
    }
    if (newPassword !== confirmPassword) {
      return 'Le nuove password non coincidono.';
    }
    return null;
  };

  const savePasswordChange = async () => {
    if (passwordSaving) return;
    setPasswordSaving(true);
    setPasswordError('');
    try {
      await runTransaction(db, async transaction => {
        const ref = doc(db, 'users', user.id);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists()) throw new Error('Utente non trovato.');
        if (snapshot.data().password !== oldPassword) throw new Error('La vecchia password non è corretta o è stata modificata.');
        transaction.update(ref, { password: newPassword });
      });

      try {
        localStorage.removeItem("password");
        localStorage.removeItem("app_password");
        sessionStorage.removeItem("password");
      } catch (err) {
        // ignore
      }

      setPasswordSuccess('Password modificata con successo!');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(''), 2000);
    } catch (err: any) {
      console.error("Errore aggiornamento password:", err);
      setPasswordError(err instanceof Error ? err.message : 'Errore durante il salvataggio della nuova password.');
    } finally {
      setPasswordSaving(false);
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    const validationError = validatePasswordChange();
    if (validationError) {
      setPasswordError(validationError);
      return;
    }
    setConfirmAction('password');
  };

  const persistAvatar = async (newAvatar: string) => {
    if (!user.playerId) throw new Error('Nessun giocatore collegato al profilo.');
    await updatePlayerEverywhere(user.playerId, { avatar: newAvatar });
  };

  const showAvatarSuccess = (msg = 'Avatar aggiornato!') => {
    setAvatarSuccess(msg);
    setTimeout(() => setAvatarSuccess(''), 2000);
  };

  const stageAvatar = (avatar: string, label: string) => {
    setPendingAvatar(avatar);
    setPendingAvatarLabel(label);
    setAvatarError('');
    setAvatarSuccess(`Anteprima pronta (${label}). Premi "Salva modifiche" per confermare.`);
  };

  const handleCharacterAvatarSelect = (avatar: string, label: string) => {
    setAvatarError('');
    stageAvatar(avatar, label);
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAvatarError('');
    const trimmed = imageUrl.trim();
    if (!trimmed) {
      setAvatarError('Inserisci un URL valido.');
      return;
    }
    if (!isSafeAvatarSource(trimmed)) {
      setAvatarError('URL non valido. Usa un link https/http o un\'immagine compatibile.');
      return;
    }
    stageAvatar(trimmed, 'URL immagine');
    setImageUrl('');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarError('');
    const validationError = validateImageFile(file);
    if (validationError) {
      setAvatarError(validationError);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setAvatarLoading(true);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      stageAvatar(dataUrl, `foto caricata (${file.name})`);
    } catch (err: any) {
      console.error("[EditProfileModal] Errore compressione/upload immagine:", err);
      setAvatarError('Errore durante il caricamento dell\'immagine. Riprova.');
    } finally {
      setAvatarLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemovePhoto = () => {
    setAvatarError('');
    const playerName = events
      .flatMap(ev => ev.players)
      .find(p => p.id === user.playerId)?.name ?? user.username;
    stageAvatar(createInitialsAvatar(playerName), 'avatar base');
  };

  const handleSaveAvatarChanges = () => {
    if (!pendingAvatar) return;
    setConfirmAction('avatar');
  };

  const handleConfirmAction = async () => {
    if (confirmAction === 'password') {
      setConfirmAction(null);
      await savePasswordChange();
      return;
    }
    if (confirmAction === 'avatar' && pendingAvatar) {
      setConfirmAction(null);
      setAvatarLoading(true);
      setAvatarError('');
      try {
        await persistAvatar(pendingAvatar);
        setPendingAvatar(null);
        showAvatarSuccess('Avatar aggiornato con successo!');
      } catch (err: any) {
        console.error('[EditProfileModal] Errore salvataggio avatar:', err);
        setAvatarError('Errore durante il salvataggio avatar.');
      } finally {
        setAvatarLoading(false);
      }
    }
  };

  // Current avatar for preview
  const currentAvatar = user.playerId
    ? events.flatMap(ev => ev.players).find(p => p.id === user.playerId)?.avatar
    : undefined;
  const avatarPreview = pendingAvatar ?? currentAvatar;
  const hasPendingAvatarChanges = Boolean(pendingAvatar && pendingAvatar !== currentAvatar);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-secondary rounded-xl shadow-2xl w-full max-w-md border border-tertiary">
        <div className="flex border-b border-tertiary">
          <button
            onClick={() => setActiveTab('password')}
            className={`flex-1 p-3 font-semibold transition-colors ${activeTab === 'password' ? 'bg-tertiary/70 text-accent' : 'text-text-secondary hover:bg-tertiary/40'}`}
          >
            Cambia Password
          </button>
          <button
            onClick={() => setActiveTab('avatar')}
            className={`flex-1 p-3 font-semibold transition-colors ${activeTab === 'avatar' ? 'bg-tertiary/70 text-accent' : 'text-text-secondary hover:bg-tertiary/40'}`}
          >
            Modifica Avatar
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'password' && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4 animate-fadeIn">
              <h4 className="text-lg font-bold mb-2">Profilo di {user.username}</h4>
              <div>
                <label className="block text-sm font-medium text-text-secondary">Vecchia Password</label>
                <input type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} className="mt-1 block w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary">Nuova Password</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="mt-1 block w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary">Conferma Nuova Password</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="mt-1 block w-full bg-primary border border-tertiary rounded-lg p-2 text-text-primary" />
              </div>
              {passwordError && <p className="text-sm text-red-400">{passwordError}</p>}
              {passwordSuccess && <p className="text-sm text-green-400">{passwordSuccess}</p>}
              <div className="flex justify-end gap-4 pt-2">
                <button type="button" onClick={onClose} className="bg-tertiary hover:bg-tertiary/80 text-text-primary font-bold py-2 px-4 rounded-lg transition-colors">Chiudi</button>
                <button type="submit" disabled={passwordSaving} className="bg-highlight hover:bg-highlight/80 text-white font-bold py-2 px-4 rounded-lg transition-colors">{passwordSaving ? 'Salvataggio...' : 'Salva Modifiche'}</button>
              </div>
            </form>
          )}

          {activeTab === 'avatar' && (
            <>
              {user.role === 'participant' ? (
                <div className="space-y-5 animate-fadeIn">
                  <div className="flex items-center gap-4">
                    <h4 className="text-lg font-bold">Personalizza il tuo Avatar</h4>
                  </div>

                  {/* Upload photo */}
                  <div>
                    <h5 className="flex items-center gap-2 text-sm font-semibold text-text-secondary mb-2">
                      <PhotoIcon className="w-5 h-5" /> Carica la tua foto
                    </h5>
                    <label
                      htmlFor="avatar-upload"
                      className={`w-full text-center flex items-center justify-center gap-2 bg-highlight hover:bg-highlight/80 text-white font-bold py-2 px-4 rounded-lg transition-colors cursor-pointer ${avatarLoading ? 'opacity-60 pointer-events-none' : ''}`}
                    >
                      {avatarLoading ? (
                        <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      ) : (
                        <PhotoIcon className="w-5 h-5" />
                      )}
                      {avatarLoading ? 'Caricamento…' : 'Scegli foto…'}
                    </label>
                    <input
                      id="avatar-upload"
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPTED_IMAGE_EXTENSIONS}
                      onChange={handleFileChange}
                      className="hidden"
                      disabled={avatarLoading}
                    />
                    <p className="text-xs text-text-secondary mt-1">JPG, PNG, WebP · max 2 MB</p>
                  </div>

                  {/* Remove photo */}
                  {avatarPreview && (
                    <div>
                      <button
                        type="button"
                        onClick={handleRemovePhoto}
                        disabled={avatarLoading}
                        className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 font-semibold transition-colors disabled:opacity-50"
                      >
                        <TrashIcon className="w-4 h-4" /> Rimuovi foto
                      </button>
                    </div>
                  )}

                  {/* Character avatar picker */}
                  <div>
                    <h5 className="flex items-center gap-2 text-sm font-semibold text-text-secondary mb-2">
                      <FaceSmileIcon className="w-5 h-5" /> Scegli un personaggio (uomo/donna)
                    </h5>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-primary/50 p-3 rounded-lg">
                      {characterAvatarPresets.map(preset => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleCharacterAvatarSelect(preset.avatar, `${preset.label} (${preset.gender === 'male' ? 'uomo' : 'donna'})`)}
                          disabled={avatarLoading}
                          className={`rounded-lg border p-2 transition-colors disabled:opacity-50 ${pendingAvatar === preset.avatar ? 'border-accent bg-tertiary/80' : 'border-tertiary hover:bg-tertiary/40'}`}
                          aria-label={`Scegli avatar ${preset.label}`}
                        >
                          <img src={preset.avatar} alt={`Avatar ${preset.label}`} className="w-12 h-12 rounded-full object-cover mx-auto mb-2" />
                          <div className="text-xs text-center font-semibold">{preset.label}</div>
                          <div className="text-[11px] text-text-secondary text-center">{preset.gender === 'male' ? 'Uomo' : 'Donna'}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* URL */}
                  <div>
                    <h5 className="flex items-center gap-2 text-sm font-semibold text-text-secondary mb-2">
                      <LinkIcon className="w-5 h-5" /> Incolla URL Immagine
                    </h5>
                    <form onSubmit={handleUrlSubmit} className="flex gap-2">
                      <input
                        type="url"
                        placeholder="https://..."
                        value={imageUrl}
                        onChange={e => setImageUrl(e.target.value)}
                        className="flex-grow bg-primary border border-tertiary rounded-lg p-2 text-text-primary"
                      />
                      <button type="submit" disabled={avatarLoading} className="bg-highlight hover:bg-highlight/80 text-white font-bold py-2 px-3 rounded-lg transition-colors disabled:opacity-50">
                        Imposta
                      </button>
                    </form>
                  </div>

                  {avatarError && <p className="text-sm text-red-400">{avatarError}</p>}
                  {avatarSuccess && <p className="text-sm text-green-400">{avatarSuccess}</p>}

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleSaveAvatarChanges}
                      disabled={!hasPendingAvatarChanges || avatarLoading}
                      className="bg-highlight hover:bg-highlight/80 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Salva Modifiche
                    </button>
                    <button type="button" onClick={onClose} className="bg-tertiary hover:bg-tertiary/80 text-text-primary font-bold py-2 px-4 rounded-lg transition-colors">Chiudi</button>
                  </div>
                </div>
              ) : (
                <div className="text-center p-8 animate-fadeIn">
                  <p className="text-text-secondary">La personalizzazione dell'avatar non è disponibile per l'organizzatore.</p>
                  <div className="flex justify-end pt-6">
                    <button type="button" onClick={onClose} className="bg-tertiary hover:bg-tertiary/80 text-text-primary font-bold py-2 px-4 rounded-lg transition-colors">Chiudi</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {confirmAction && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-[60] p-4">
          <div className="bg-secondary rounded-xl shadow-2xl w-full max-w-md border border-tertiary p-6">
            <h4 className="text-lg font-bold mb-2">
              {confirmAction === 'password' ? 'Conferma cambio password' : 'Conferma modifica avatar'}
            </h4>
            <p className="text-sm text-text-secondary">
              {confirmAction === 'password'
                ? 'Stai per salvare la nuova password. Questa è l’ultima conferma prima del salvataggio definitivo.'
                : `Stai per salvare ${pendingAvatarLabel || 'la modifica avatar'}. Questa è l’ultima conferma prima del salvataggio definitivo.`}
            </p>
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="bg-tertiary hover:bg-tertiary/80 text-text-primary font-bold py-2 px-4 rounded-lg transition-colors"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                className="bg-highlight hover:bg-highlight/80 text-white font-bold py-2 px-4 rounded-lg transition-colors"
              >
                Conferma
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EditProfileModal;
