'use client';

import { useMemo, useState } from 'react';
import Modal from '@/components/Modal';

type ModalWidth = 'sm' | 'md' | 'lg' | 'full';

type ExpandableChartProps = {
  title: React.ReactNode;
  children: (opts: { isExpanded: boolean }) => React.ReactNode;

  height?: number;
  /**
   * Only used when maxWidth is not 'full'. In full mode the chart fills the
   * window instead, so a fixed pixel height would waste the space.
   */
  expandedHeight?: number;
  maxWidth?: ModalWidth;

  /**
   * If true, renders a small top-right button above the chart (no overlap).
   * If false, renders a header row with title + Expand button.
   */
  overlayButton?: boolean;

  /**
   * Optional extra content near the title (header mode only).
   */
  description?: React.ReactNode;
};

export function ExpandableChart({
  title,
  description,
  children,
  height = 300,
  expandedHeight = 560,
  maxWidth = 'full',
  overlayButton = true,
}: ExpandableChartProps) {
  const [open, setOpen] = useState(false);

  const isFull = maxWidth === 'full';
  const compactStyle = useMemo(() => ({ height }), [height]);
  // Full mode fills the modal body (which has a definite height), so the chart's
  // ResponsiveContainer gets every available pixel. Fixed height otherwise.
  const expandedStyle = useMemo(
    () => (isFull ? { height: '100%' as const } : { height: expandedHeight }),
    [isFull, expandedHeight],
  );

  if (overlayButton) {
    return (
      <>
        <div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn btn-secondary btn-sm mb-2 ml-auto block"
          >
            Expand
          </button>
          <div style={compactStyle}>
            {children({ isExpanded: false })}
          </div>
        </div>

        <Modal isOpen={open} onClose={() => setOpen(false)} title={title} maxWidth={maxWidth}>
          <div style={expandedStyle}>
            {children({ isExpanded: true })}
          </div>
        </Modal>
      </>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base sm:text-lg font-semibold text-gray-900">{title}</div>
          {description ? <div className="text-xs text-gray-400 mt-1">{description}</div> : null}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn btn-secondary btn-sm whitespace-nowrap"
        >
          Expand
        </button>
      </div>

      <div className="mt-3" style={compactStyle}>
        {children({ isExpanded: false })}
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={title} maxWidth={maxWidth}>
        <div style={expandedStyle}>
          {children({ isExpanded: true })}
        </div>
      </Modal>
    </>
  );
}

