import React from 'react';

export default function MatchScoreFields({
  names, scores, onChange, disabled = false,
}: {
  names: [string, string];
  scores: [string, string];
  onChange: (side: 0 | 1, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {names.map((name, index) => (
        <label key={index} className="min-w-0 rounded-xl border border-tertiary bg-primary p-3 sm:p-4 flex flex-col gap-3">
          <span className="font-semibold text-sm text-center break-words">{name}</span>
          <input type="number" inputMode="numeric" min="0" step="1" required
            aria-label={`Punteggio ${name}`} value={scores[index]} disabled={disabled}
            onChange={event => onChange(index === 0 ? 0 : 1, event.target.value)}
            className="score-input w-full min-w-0 rounded-lg border border-tertiary bg-secondary text-center text-3xl font-bold p-3 focus:ring-2 focus:ring-accent" />
        </label>
      ))}
    </div>
  );
}
