'use client';

import { useEffect, useRef, useState } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * 'full' fills the window — edge to edge on mobile, inset by 16px on desktop.
   * Use it for content that wants every available pixel, e.g. an expanded chart.
   */
  maxWidth?: 'sm' | 'md' | 'lg' | 'full';
}

type ScrollLockState = {
  scrollY: number;
  bodyPosition: string;
  bodyTop: string;
  bodyWidth: string;
  bodyOverflow: string;
  htmlOverflow: string;
};

function lockScroll() {
  if (typeof window === 'undefined') return;
  const w = window as any;
  w.__illamModalOpenCount = (w.__illamModalOpenCount ?? 0) + 1;
  if (w.__illamModalOpenCount > 1) return; // already locked

  const scrollY = window.scrollY || 0;
  const body = document.body;
  const html = document.documentElement;

  const prev: ScrollLockState = {
    scrollY,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyWidth: body.style.width,
    bodyOverflow: body.style.overflow,
    htmlOverflow: html.style.overflow,
  };
  w.__illamModalScrollLockPrev = prev;

  // Robust scroll lock (works on iOS Safari too)
  body.style.position = 'fixed';
  body.style.top = `-${scrollY}px`;
  body.style.width = '100%';
  body.style.overflow = 'hidden';
  html.style.overflow = 'hidden';
}

function unlockScroll() {
  if (typeof window === 'undefined') return;
  const w = window as any;
  w.__illamModalOpenCount = Math.max(0, (w.__illamModalOpenCount ?? 1) - 1);
  if (w.__illamModalOpenCount > 0) return;

  const prev: ScrollLockState | undefined = w.__illamModalScrollLockPrev;
  const body = document.body;
  const html = document.documentElement;

  if (prev) {
    body.style.position = prev.bodyPosition;
    body.style.top = prev.bodyTop;
    body.style.width = prev.bodyWidth;
    body.style.overflow = prev.bodyOverflow;
    html.style.overflow = prev.htmlOverflow;
    window.scrollTo(0, prev.scrollY);
    w.__illamModalScrollLockPrev = undefined;
  } else {
    body.style.position = '';
    body.style.top = '';
    body.style.width = '';
    body.style.overflow = '';
    html.style.overflow = '';
  }
}

/**
 * Shared modal with consistent animation:
 * - Mobile: slides up from bottom
 * - Desktop: fades in + scales from 95%
 * - Backdrop: bg-black/40
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'md',
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      lockScroll();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount first, then animate in on the next frames
      setMounted(true);
      // Two rAFs ensure the element is in the DOM before we trigger the transition
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    return () => unlockScroll();
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!mounted) return null;

  const isFull = maxWidth === 'full';

  const maxWidthClass =
    maxWidth === 'sm' ? 'sm:max-w-sm' :
    maxWidth === 'lg' ? 'sm:max-w-2xl' :
    isFull ? 'sm:max-w-none' :
    'sm:max-w-lg';

  // Full mode owns its own sizing/corners, so it opts out of the default
  // max-h-[90dvh] + rounded-t-2xl treatment. dvh (not vh) so the sheet tracks the
  // shrunken viewport when the on-screen keyboard opens, instead of extending
  // behind it and hiding the focused field and its buttons.
  const sizeClass = isFull
    ? 'h-dvh sm:h-full max-h-none rounded-none sm:rounded-2xl'
    : 'max-h-[90dvh] rounded-t-2xl sm:rounded-2xl';

  return (
    <div className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center ${isFull ? 'sm:p-4' : ''}`}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-300 ${
          visible ? 'opacity-40' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={contentRef}
        className={`
          relative w-full ${maxWidthClass} bg-white
          ${sizeClass} shadow-xl
          flex flex-col overflow-hidden
          transition-all duration-300 ease-out
          ${visible
            ? 'translate-y-0 opacity-100 sm:scale-100'
            : 'translate-y-full sm:translate-y-0 opacity-0 sm:scale-95'
          }
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex-1 min-w-0">
            {typeof title === 'string' ? (
              <h2 className="text-lg font-bold text-gray-900 truncate">{title}</h2>
            ) : (
              title
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-button ml-3 flex-shrink-0 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div
          className={`flex-1 min-h-0 overflow-x-hidden overscroll-contain ${
            isFull ? 'overflow-hidden px-3 py-3 sm:px-4 sm:py-4' : 'overflow-y-auto px-6 py-4'
          }`}
        >
          {children}
        </div>

        {/* Footer */}
        {footer !== undefined && (
          <div className="flex-shrink-0 flex justify-end gap-2 px-6 py-4 border-t border-gray-200">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
