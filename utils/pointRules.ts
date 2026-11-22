import { type Group, type PointRule } from '../types';

export function validatePointRules(rules: PointRule[]): string | null {
  for (const rule of rules) {
    if (!Number.isSafeInteger(rule.minDiff) || !Number.isSafeInteger(rule.maxDiff)
      || rule.minDiff < 1 || rule.maxDiff < rule.minDiff) {
      return 'Ogni regola deve avere una differenza minima di almeno 1 e una massima non inferiore alla minima.';
    }
    if (!Number.isSafeInteger(rule.winnerPoints) || !Number.isSafeInteger(rule.loserPoints)) {
      return 'I punti delle regole devono essere numeri interi.';
    }
  }
  const sorted = [...rules].sort((a, b) => a.minDiff - b.minDiff);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minDiff <= sorted[i - 1].maxDiff) {
      return 'Le regole punteggio si sovrappongono: ogni differenza game deve corrispondere a una sola regola.';
    }
  }
  return null;
}

export function getStandingsRuleWarnings(group: Group, rules: PointRule[]): string[] {
  const missing = new Set<number>();
  const overlapping = new Set<number>();
  let invalidResult = false;
  for (const match of group.matches ?? []) {
    if (match.status !== 'completed') continue;
    if (typeof match.score1 !== 'number' || typeof match.score2 !== 'number'
      || !Number.isSafeInteger(match.score1) || !Number.isSafeInteger(match.score2)
      || match.score1 < 0 || match.score2 < 0) {
      invalidResult = true;
      continue;
    }
    const diff = Math.abs(match.score1 - match.score2);
    if (diff === 0) continue;
    const count = rules.filter(rule => diff >= rule.minDiff && diff <= rule.maxDiff).length;
    if (count === 0) missing.add(diff);
    if (count > 1) overlapping.add(diff);
  }
  const format = (values: Set<number>) => [...values].sort((a, b) => a - b).join(', ');
  const warnings: string[] = [];
  if (invalidResult) warnings.push('Alcune partite completate hanno un risultato non valido e non sono conteggiate.');
  if (missing.size) warnings.push(`Nessuna regola punteggio per la differenza game ${format(missing)}: le partite interessate non ricevono punti.`);
  if (overlapping.size) warnings.push(`Più regole punteggio per la differenza game ${format(overlapping)}: viene applicata la prima. Correggi le impostazioni del torneo.`);
  return warnings;
}
