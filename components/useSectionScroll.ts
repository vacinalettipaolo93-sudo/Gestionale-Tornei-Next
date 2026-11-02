import { useLayoutEffect, useRef } from 'react';

export function useSectionScroll(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [key]);
  return ref;
}
