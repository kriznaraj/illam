'use client';

import type { ReactNode } from 'react';
import { classNames } from '@/lib/utils';

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  className?: string;
};

interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  optionClassName?: string;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
  withContainer?: boolean;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
  optionClassName,
  fullWidth = false,
  size = 'sm',
  withContainer = true,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={classNames(
        'flex items-center gap-1',
        withContainer && 'bg-gray-100 rounded-lg p-1',
        fullWidth && 'w-full',
        className,
      )}
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            disabled={option.disabled}
            title={option.title}
            aria-label={option.ariaLabel}
            className={classNames(
              'btn',
              size === 'sm' ? 'btn-sm' : undefined,
              isActive ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'btn-ghost',
              fullWidth && 'flex-1',
              optionClassName,
              option.className,
            )}
            role="tab"
            aria-selected={isActive}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
