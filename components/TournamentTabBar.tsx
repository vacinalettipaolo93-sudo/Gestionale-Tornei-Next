import React, { useEffect, useRef } from 'react';

interface TournamentTab<T extends string> {
  id: T;
  label: string;
}

interface Props<T extends string> {
  tabs: TournamentTab<T>[];
  activeTab: T;
  onSelect: (tabId: T) => void;
  ariaLabel?: string;
  className?: string;
}

export default function TournamentTabBar<T extends string>({
  tabs,
  activeTab,
  onSelect,
  ariaLabel = 'Sezioni del torneo',
  className = 'mb-6',
}: Props<T>) {
  const activeTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);

  return (
    <nav aria-label={ariaLabel} className={`${className} rounded-xl border border-tertiary/50 bg-secondary/60 p-1.5`}>
      <div className="tournament-tab-scroll flex flex-nowrap snap-x snap-mandatory items-center gap-1.5 overflow-x-auto overscroll-x-contain">
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={isActive ? activeTabRef : undefined}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelect(tab.id)}
              className={`min-h-11 shrink-0 snap-start whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:px-4 sm:text-base ${
                isActive
                  ? 'border-accent/40 bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md'
                  : 'border-transparent text-text-secondary hover:border-tertiary hover:bg-primary/60 hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
