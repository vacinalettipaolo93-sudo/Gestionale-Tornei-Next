import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

let openDialogs = 0;
let previousBodyStyle: Pick<CSSStyleDeclaration, 'overflow' | 'position' | 'top' | 'left' | 'width' | 'paddingRight'>;
let previousScroll = { x: 0, y: 0 };

export default function CenteredDialog({
  title, children, onClose, busy = false, wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previousFocus = document.activeElement;
    if (openDialogs++ === 0) {
      const body = document.body;
      previousScroll = { x: window.scrollX, y: window.scrollY };
      previousBodyStyle = {
        overflow: body.style.overflow, position: body.style.position,
        top: body.style.top, left: body.style.left, width: body.style.width, paddingRight: body.style.paddingRight,
      };
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      const paddingRight = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      Object.assign(body.style, {
        overflow: 'hidden', position: 'fixed', top: `${-previousScroll.y}px`, left: `${-previousScroll.x}px`, width: '100%',
        ...(scrollbarWidth > 0 ? { paddingRight: `${paddingRight + scrollbarWidth}px` } : {}),
      });
    }
    ref.current?.focus({ preventScroll: true });
    const viewport = window.visualViewport;
    const resize = () => {
      if (!viewport || !backdropRef.current) return;
      backdropRef.current.style.height = `${viewport.height}px`;
      backdropRef.current.style.top = `${viewport.offsetTop}px`;
      backdropRef.current.style.setProperty('--dialog-height', `${viewport.height}px`);
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    const keydown = (event: KeyboardEvent) => {
      if (!ref.current?.contains(document.activeElement)) return;
      if (event.key === 'Escape' && !busyRef.current) closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = [...ref.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'
      )].filter(element => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      if (--openDialogs === 0) {
        Object.assign(document.body.style, previousBodyStyle);
        window.scrollTo({ left: previousScroll.x, top: previousScroll.y, behavior: 'instant' });
      }
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div ref={backdropRef} className="dialog-backdrop" onClick={event => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}
        className={`dialog-panel ${wide ? 'dialog-panel-wide' : ''}`}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <h3 id={titleId} className="text-xl font-bold text-accent break-words min-w-0">{title}</h3>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Chiudi finestra"
            className="shrink-0 rounded-lg bg-tertiary px-3 py-2 disabled:opacity-50">&times;</button>
        </div>
        {children}
      </div>
    </div>, document.body
  );
}
