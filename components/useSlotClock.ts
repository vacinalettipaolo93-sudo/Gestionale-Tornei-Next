import { useEffect, useState } from 'react';
import { type Event } from '../types';
import { getEventSlots } from '../utils/tournamentAvailability';

export function useSlotClock(event: Event): number {
  const [, refresh] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      refresh(value => value + 1);
      const now = Date.now();
      const deadlines = getEventSlots(event)
        .flatMap(slot => [Date.parse(slot.start), Date.parse(slot.expiresAt ?? '')])
        .filter(time => time > now);
      if (deadlines.length) timer = setTimeout(update, Math.min(Math.min(...deadlines) - now, 2147483647));
    };
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [event]);
  return Date.now();
}
