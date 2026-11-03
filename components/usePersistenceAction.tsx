import React, { useEffect, useRef, useState } from 'react';
import { sameData } from '../utils/documentChanges';

export function useSyncedDraft<T>(remote: T, key = '') {
  const [state, setState] = useState({ baseline: remote, draft: remote, key });
  useEffect(() => {
    setState(previous => {
      if (previous.key === key && sameData(previous.baseline, remote)) return previous;
      if (previous.key !== key || sameData(previous.draft, remote) || sameData(previous.draft, previous.baseline)) {
        return { baseline: remote, draft: remote, key };
      }
      return previous;
    });
  }, [remote, key, state.draft, state.baseline]);
  const setDraft: React.Dispatch<React.SetStateAction<T>> = value => {
    setState(previous => ({ ...previous,
      draft: typeof value === 'function' ? (value as (previous: T) => T)(previous.draft) : value,
    }));
  };
  return [state.draft, setDraft, state.baseline] as const;
}

export function usePersistenceAction() {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      console.error('Operazione Firebase non riuscita', cause);
      setError(cause instanceof Error ? cause.message : 'Operazione non salvata. Riprova.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return { error, saving, run, dismissError: () => setError('') };
}

export function PersistenceFeedback({ persistence }: { persistence: ReturnType<typeof usePersistenceAction> }) {
  return (
    <div aria-live="polite">
      {persistence.error && (
        <div role="alert" className="fixed top-3 inset-x-3 z-[100] mx-auto max-w-lg rounded-xl border border-red-400 bg-primary p-4 shadow-2xl">
          <p className="text-red-400">{persistence.error}</p>
          <button type="button" onClick={persistence.dismissError} className="mt-2 underline">Chiudi avviso</button>
        </div>
      )}
      {persistence.saving && <p role="status">Salvataggio su Firebase...</p>}
    </div>
  );
}
