'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { classNames } from '@/lib/utils';
import { monthKeys } from '@/lib/utils/dateUtils';

interface MonthNavigatorProps {
  /** Selected month, `yyyy-MM`. */
  value: string;
  /**
   * Called with the new month. Always a valid `yyyy-MM` inside `[min, max]` —
   * the navigator clamps before calling, so pages do not repeat that check.
   */
  onChange: (month: string) => void;
  /** Earliest selectable month, `yyyy-MM` inclusive. */
  min?: string;
  /** Latest selectable month, `yyyy-MM` inclusive. Defaults to the current month. */
  max?: string;
  /**
   * Let `max` run into the future. Off by default: every month view in the app
   * reports on data that has already happened, and only `/portfolio/investments`
   * (auto-recurring rows are materialised ahead of today) wants otherwise.
   */
  allowFuture?: boolean;
  /** Show the month picker. Off leaves the label as plain text. */
  showPicker?: boolean;
  /**
   * Extra classes. The control caps itself at `max-w-md`: stretched across a desktop
   * container it became a 700px bar with a small month label adrift in the middle,
   * which read as unfinished on every page that did not constrain it by hand.
   * Pass `max-w-none` here to opt out.
   */
  className?: string;
  /** Distinguishes the control when a page renders more than one. */
  ariaLabel?: string;
}

const MONTH_ABBREVIATIONS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * The month selector for every month-scoped page.
 *
 * Deliberately opinionated: it takes a value and a range, and derives
 * previous / next / jump-to-current itself. It used to accept per-page labels,
 * button classes and handlers, and the six pages using it had drifted into six
 * different controls — two arrow sets, four "today" buttons, three widths, and
 * a month label that read "September 2026" on the insights pages and "2026-09"
 * everywhere else. There is no prop here that can reintroduce that.
 *
 * The label is drawn rather than delegated to `<input type="month">` for the
 * same reason `.select` draws its own chevron: Safari — the browser this PWA
 * actually runs in on iOS — does not implement `type="month"` and silently
 * degrades it to a text box showing the raw `2026-09`.
 */
export function MonthNavigator({
  value,
  onChange,
  min,
  max,
  allowFuture = false,
  showPicker = true,
  className,
  ariaLabel = 'Month',
}: MonthNavigatorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => Number(value?.slice(0, 4)) || 0);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentMonth = monthKeys.current();

  // An explicit `max` wins; otherwise the current month is the ceiling unless
  // the page opts into the future.
  const effectiveMax = monthKeys.isValid(max) ? max : allowFuture ? undefined : currentMonth;
  const effectiveMin = monthKeys.isValid(min) ? min : undefined;

  const selected = monthKeys.isValid(value) ? value : currentMonth;

  /** Where "This month" goes. Clamped, so a page whose range ends before today
   *  (closed-months-only insights) lands on its latest month instead of nowhere. */
  const jumpTarget = monthKeys.clamp(currentMonth, effectiveMin, effectiveMax);

  const previousMonth = monthKeys.shift(selected, -1);
  const nextMonth = monthKeys.shift(selected, 1);

  const canGoPrevious = monthKeys.isWithin(previousMonth, effectiveMin, effectiveMax);
  const canGoNext = monthKeys.isWithin(nextMonth, effectiveMin, effectiveMax);
  const atJumpTarget = selected === jumpTarget;

  const select = useCallback(
    (month: string) => {
      if (!monthKeys.isValid(month)) return;
      const clamped = monthKeys.clamp(month, effectiveMin, effectiveMax);
      if (clamped !== selected) onChange(clamped);
    },
    [effectiveMin, effectiveMax, onChange, selected],
  );

  const openPicker = () => {
    setPickerYear(Number(selected.slice(0, 4)));
    setPickerOpen(true);
  };

  // Dismiss on outside click or Escape, the way `Modal` does.
  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pickerOpen]);

  const yearBounds = useMemo(() => {
    const minYear = effectiveMin ? Number(effectiveMin.slice(0, 4)) : Number(selected.slice(0, 4)) - 10;
    const maxYear = effectiveMax ? Number(effectiveMax.slice(0, 4)) : Number(selected.slice(0, 4)) + 10;
    return { minYear, maxYear };
  }, [effectiveMin, effectiveMax, selected]);

  return (
    <div ref={containerRef} className={classNames('relative w-full max-w-md', className)}>
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          onClick={() => select(previousMonth)}
          disabled={!canGoPrevious}
          className="btn btn-secondary icon-button shrink-0 text-lg disabled:opacity-40 disabled:cursor-not-allowed"
          title="Previous month"
          aria-label="Previous month"
        >
          ←
        </button>

        {showPicker ? (
          <button
            type="button"
            onClick={() => (pickerOpen ? setPickerOpen(false) : openPicker())}
            className="input flex min-w-0 flex-1 items-center justify-center gap-2 text-sm font-medium"
            aria-label={`${ariaLabel}: ${monthKeys.label(selected)}. Choose a month`}
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
          >
            <span className="truncate">{monthKeys.label(selected)}</span>
            <span aria-hidden="true" className="shrink-0 text-xs text-gray-400">▾</span>
          </button>
        ) : (
          <div
            className="input flex min-w-0 flex-1 items-center justify-center text-sm font-medium"
            aria-label={ariaLabel}
          >
            <span className="truncate">{monthKeys.label(selected)}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => select(nextMonth)}
          disabled={!canGoNext}
          className="btn btn-secondary icon-button shrink-0 text-lg disabled:opacity-40 disabled:cursor-not-allowed"
          title="Next month"
          aria-label="Next month"
        >
          →
        </button>

        {/* Always rendered, disabled when we are already there. Two pages used to
            hide it instead, which shifted the whole row as you navigated. */}
        <button
          type="button"
          onClick={() => select(jumpTarget)}
          disabled={atJumpTarget}
          className="btn btn-secondary btn-sm shrink-0 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          title={
            jumpTarget === currentMonth
              ? 'Go to the current month'
              : `Go to the latest available month (${monthKeys.label(jumpTarget)})`
          }
        >
          {jumpTarget === currentMonth ? 'This month' : 'Latest'}
        </button>
      </div>

      {showPicker && pickerOpen && (
        <div
          role="dialog"
          aria-label="Choose a month"
          className="absolute left-0 right-0 top-full z-30 mt-2 rounded-xl border border-gray-200 bg-white p-3 shadow-lg sm:max-w-xs"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPickerYear((year) => year - 1)}
              disabled={pickerYear - 1 < yearBounds.minYear}
              className="btn btn-ghost icon-button-sm text-base disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Previous year"
            >
              ←
            </button>
            <span className="text-sm font-semibold text-gray-900">{pickerYear}</span>
            <button
              type="button"
              onClick={() => setPickerYear((year) => year + 1)}
              disabled={pickerYear + 1 > yearBounds.maxYear}
              className="btn btn-ghost icon-button-sm text-base disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Next year"
            >
              →
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {MONTH_ABBREVIATIONS.map((abbreviation, index) => {
              const month = `${String(pickerYear).padStart(4, '0')}-${String(index + 1).padStart(2, '0')}`;
              const disabled = !monthKeys.isWithin(month, effectiveMin, effectiveMax);
              const isSelected = month === selected;
              return (
                <button
                  key={month}
                  type="button"
                  disabled={disabled}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => {
                    select(month);
                    setPickerOpen(false);
                  }}
                  className={classNames(
                    'rounded-lg px-2 py-2 text-sm font-medium transition-colors',
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : disabled
                        ? 'text-gray-300 cursor-not-allowed'
                        : 'text-gray-700 hover:bg-gray-100',
                  )}
                >
                  {abbreviation}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
