import {
  type SummerAvailabilityByDay,
  type SummerAvailabilityDay,
  type SummerAvailabilityPeriod,
  type SummerAvailabilityStatus,
  type SummerPlayerAvailability,
  type SummerPlayerAvailabilityEntry,
} from '../types';

export type AvailabilityDraftState = {
  status: SummerAvailabilityStatus;
  days: SummerAvailabilityDay[];
  periods: SummerAvailabilityPeriod[];
};

export type AvailabilityFormState = {
  entries: SummerPlayerAvailabilityEntry[];
  isEditorOpen: boolean;
  editingEntryId: string | null;
  draft: AvailabilityDraftState;
};

export const AVAILABILITY_DAYS: Array<{ value: SummerAvailabilityDay; label: string; shortLabel: string }> = [
  { value: 'monday', label: 'Lunedì', shortLabel: 'Lun' },
  { value: 'tuesday', label: 'Martedì', shortLabel: 'Mar' },
  { value: 'wednesday', label: 'Mercoledì', shortLabel: 'Mer' },
  { value: 'thursday', label: 'Giovedì', shortLabel: 'Gio' },
  { value: 'friday', label: 'Venerdì', shortLabel: 'Ven' },
  { value: 'saturday', label: 'Sabato', shortLabel: 'Sab' },
  { value: 'sunday', label: 'Domenica', shortLabel: 'Dom' },
];

export const AVAILABILITY_PERIODS: Array<{ value: SummerAvailabilityPeriod; label: string }> = [
  { value: 'morning', label: 'Mattina' },
  { value: 'afternoon', label: 'Pomeriggio' },
  { value: 'evening', label: 'Sera' },
];

const createEmptyAvailabilityByDay = (): Record<SummerAvailabilityDay, SummerAvailabilityPeriod[]> =>
  AVAILABILITY_DAYS.reduce((acc, day) => {
    acc[day.value] = [];
    return acc;
  }, {} as Record<SummerAvailabilityDay, SummerAvailabilityPeriod[]>);

export const getNormalizedPeriods = (periods: SummerAvailabilityPeriod[] | undefined) =>
  AVAILABILITY_PERIODS
    .map(period => period.value)
    .filter(period => periods?.includes(period));

export const getNormalizedDays = (days: SummerAvailabilityDay[] | undefined) =>
  AVAILABILITY_DAYS
    .map(day => day.value)
    .filter(day => days?.includes(day));

export const createEmptyAvailabilityDraft = (): AvailabilityDraftState => ({
  status: 'available',
  days: [],
  periods: [],
});

export const formatAvailabilityDays = (days: SummerAvailabilityDay[], variant: 'short' | 'long' = 'long') =>
  getNormalizedDays(days)
    .map(day => AVAILABILITY_DAYS.find(option => option.value === day)?.[variant === 'short' ? 'shortLabel' : 'label'] ?? day)
    .join(', ');

export const formatAvailabilityPeriods = (periods: SummerAvailabilityPeriod[]) =>
  getNormalizedPeriods(periods)
    .map(period => AVAILABILITY_PERIODS.find(option => option.value === period)?.label ?? period)
    .join(', ');

export const normalizeAvailabilityEntries = (availability?: SummerPlayerAvailability): SummerPlayerAvailabilityEntry[] => {
  const normalizeEntry = (entry: SummerPlayerAvailabilityEntry, index: number): SummerPlayerAvailabilityEntry | null => {
    const days = getNormalizedDays(entry.days);
    if (days.length === 0) return null;
    const periods = entry.status === 'available' ? getNormalizedPeriods(entry.periods) : [];
    if (entry.status === 'available' && periods.length === 0) return null;
    return {
      id: entry.id ?? `availability_${index}`,
      status: entry.status,
      days,
      periods,
    };
  };

  if (availability?.entries?.length) {
    return availability.entries
      .map((entry, index) => normalizeEntry(entry, index))
      .filter((entry): entry is SummerPlayerAvailabilityEntry => entry !== null);
  }

  const normalizedDayPeriods = createEmptyAvailabilityByDay();
  AVAILABILITY_DAYS.forEach(day => {
    normalizedDayPeriods[day.value] = getNormalizedPeriods(availability?.dayPeriods?.[day.value]);
  });

  const groupedEntries = new Map<string, SummerAvailabilityDay[]>();
  AVAILABILITY_DAYS.forEach(day => {
    const periods = normalizedDayPeriods[day.value];
    if (periods.length === 0) return;
    const key = periods.join('|');
    groupedEntries.set(key, [...(groupedEntries.get(key) ?? []), day.value]);
  });

  if (groupedEntries.size > 0) {
    return Array.from(groupedEntries.entries()).map(([key, days], index) => ({
      id: `availability_${index}`,
      status: 'available',
      days,
      periods: key.split('|').filter(Boolean) as SummerAvailabilityPeriod[],
    }));
  }

  if (availability?.status === 'available') {
    const days = getNormalizedDays(availability.days);
    const periods = getNormalizedPeriods(availability.periods);
    if (days.length > 0 && periods.length > 0) {
      return [{
        id: 'availability_0',
        status: 'available',
        days,
        periods,
      }];
    }
  }

  if (availability?.status === 'unavailable') {
    const days = getNormalizedDays(availability.days);
    return [{
      id: 'availability_0',
      status: 'unavailable',
      days: days.length > 0 ? days : AVAILABILITY_DAYS.map(day => day.value),
      periods: [],
    }];
  }

  return [];
};

const applyAvailabilityEntriesToDayPeriods = (entries: SummerPlayerAvailabilityEntry[]) => {
  const normalized = createEmptyAvailabilityByDay();

  normalizeAvailabilityEntries({ entries }).forEach(entry => {
    if (entry.status === 'unavailable') {
      entry.days.forEach(day => {
        normalized[day] = [];
      });
      return;
    }

    const periods = getNormalizedPeriods(entry.periods);
    entry.days.forEach(day => {
      normalized[day] = getNormalizedPeriods([...(normalized[day] ?? []), ...periods]);
    });
  });

  return normalized;
};

export const normalizeAvailabilityByDay = (availability?: SummerPlayerAvailability) => {
  const entries = normalizeAvailabilityEntries(availability);
  if (entries.length === 0) return createEmptyAvailabilityByDay();
  return applyAvailabilityEntriesToDayPeriods(entries);
};

const getSelectedAvailabilityDays = (dayPeriods: SummerAvailabilityByDay) =>
  AVAILABILITY_DAYS
    .filter(day => (dayPeriods[day.value] ?? []).length > 0)
    .map(day => day.value);

const getSelectedAvailabilityPeriods = (dayPeriods: SummerAvailabilityByDay) =>
  Array.from(new Set(
    AVAILABILITY_DAYS.flatMap(day => dayPeriods[day.value] ?? [])
  ));

export const createAvailabilityFormState = (availability?: SummerPlayerAvailability): AvailabilityFormState => ({
  entries: normalizeAvailabilityEntries(availability),
  isEditorOpen: false,
  editingEntryId: null,
  draft: createEmptyAvailabilityDraft(),
});

export const buildAvailabilityPayload = (entries: SummerPlayerAvailabilityEntry[]): SummerPlayerAvailability | undefined => {
  const normalizedEntries = normalizeAvailabilityEntries({ entries });
  if (normalizedEntries.length === 0) return undefined;

  const dayPeriods = applyAvailabilityEntriesToDayPeriods(normalizedEntries);
  const selectedDays = getSelectedAvailabilityDays(dayPeriods);
  const selectedPeriods = getSelectedAvailabilityPeriods(dayPeriods);
  const unavailableDays = getNormalizedDays(
    normalizedEntries
      .filter(entry => entry.status === 'unavailable')
      .flatMap(entry => entry.days)
  );

  return {
    status: selectedDays.length > 0 ? 'available' : 'unavailable',
    days: selectedDays.length > 0 ? selectedDays : unavailableDays,
    periods: selectedDays.length > 0 ? selectedPeriods : [],
    dayPeriods: selectedDays.reduce<SummerAvailabilityByDay>((acc, day) => {
      if ((dayPeriods[day] ?? []).length > 0) {
        acc[day] = dayPeriods[day];
      }
      return acc;
    }, {}),
    entries: normalizedEntries,
    updatedAt: new Date().toISOString(),
  };
};

export const getAvailabilitySummary = (availability?: SummerPlayerAvailability) => {
  const entries = normalizeAvailabilityEntries(availability);
  if (entries.length === 0) {
    return {
      status: 'Non dichiarata',
      details: null as string | null,
    };
  }

  if (entries.length === 1) {
    const entry = entries[0];
    if (entry.status === 'unavailable') {
      return {
        status: 'Non disponibile',
        details: formatAvailabilityDays(entry.days),
      };
    }
    return {
      status: 'Disponibile',
      details: `${formatAvailabilityDays(entry.days)} • ${formatAvailabilityPeriods(entry.periods ?? [])}`,
    };
  }

  return {
    status: 'Disponibilità personalizzata',
    details: `${entries.length} disponibilità configurate`,
  };
};

export const toggleArrayValue = <T,>(items: T[], value: T) =>
  items.includes(value) ? items.filter(item => item !== value) : [...items, value];
