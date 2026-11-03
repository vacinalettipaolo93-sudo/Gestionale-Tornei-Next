export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function sameData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => sameData(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].every(key => sameData(left[key], right[key]));
  }
  return false;
}

export function firestoreData<T>(value: T): T {
  if (Array.isArray(value)) {
    if (value.some(item => item === undefined)) throw new Error('Dati non validi: valore mancante nella lista.');
    return value.map(item => firestoreData(item)) as T;
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, firestoreData(item)])) as T;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Dati non validi: numero non finito.');
  return value;
}

function conflict(): never {
  throw new Error('Dati modificati da un altro utente. Riapri la modifica e riprova.');
}

export function mergeDocumentChanges(baseline: unknown, next: unknown, current: unknown): unknown {
  if (sameData(baseline, next)) return current;
  if (sameData(current, baseline) || sameData(current, next)) return next;
  if (Array.isArray(baseline) && Array.isArray(next)) {
    const fresh = current ?? [];
    if (!Array.isArray(fresh)) return conflict();
    const keyed = (item: unknown): item is Record<string, unknown> & { id: string } =>
      isRecord(item) && typeof item.id === 'string';
    if ([...baseline, ...next, ...fresh].every(keyed)) {
      const before = new Map(baseline.map(item => [item.id, item]));
      const after = new Map(next.map(item => [item.id, item]));
      const now = new Map(fresh.map(item => [item.id, item]));
      const changes = new Map<string, unknown>();
      for (const id of new Set([...before.keys(), ...after.keys()])) {
        const old = before.get(id);
        const updated = after.get(id);
        const actual = now.get(id);
        if (sameData(old, updated)) continue;
        const changesRoster = old && updated && Array.isArray(old.playerIds)
          && (!sameData(old.playerIds, updated.playerIds)
            || !sameData(
              Array.isArray(old.matches) ? old.matches.map(match => isRecord(match) ? match.id : null) : [],
              Array.isArray(updated.matches) ? updated.matches.map(match => isRecord(match) ? match.id : null) : [],
            ));
        const changesBracket = old && updated && (
          !sameData(old.playoffs, updated.playoffs) || !sameData(old.consolationBracket, updated.consolationBracket)
        );
        if ((!old || !updated || old.player1Id !== undefined || changesRoster || changesBracket)
          && !sameData(actual, old) && !sameData(actual, updated)) conflict();
        changes.set(id, mergeDocumentChanges(old, updated, actual));
      }
      return [
        ...fresh.flatMap(item => changes.has(item.id)
          ? changes.get(item.id) === undefined ? [] : [changes.get(item.id)] : [item]),
        ...next.filter(item => !now.has(item.id) && !before.has(item.id)),
      ];
    }
  }
  if (isRecord(baseline) && isRecord(next) && isRecord(current)) {
    const merged = { ...current };
    for (const key of new Set([...Object.keys(baseline), ...Object.keys(next)])) {
      const value = mergeDocumentChanges(baseline[key], next[key], current[key]);
      if (value === undefined) delete merged[key];
      else merged[key] = value;
    }
    return merged;
  }
  return conflict();
}
