import type { ReactNode } from 'react';
import { classNames } from '@/lib/utils';

type MetricTone = 'default' | 'primary' | 'green' | 'purple' | 'orange';

interface MetricCardProps {
  label: ReactNode;
  value: ReactNode;
  subtext?: ReactNode;
  tone?: MetricTone;
  className?: string;
}

interface MetricGridProps {
  children: ReactNode;
  className?: string;
}

// The tone colours only the value, so a row of metrics stays calm and readable.
const valueToneClass: Record<MetricTone, string> = {
  default: 'text-gray-900',
  primary: 'text-primary-700',
  green: 'text-green-700',
  purple: 'text-purple-700',
  orange: 'text-orange-700',
};

export function MetricCard({
  label,
  value,
  subtext,
  tone = 'default',
  className,
}: MetricCardProps) {
  return (
    <div className={classNames('card', className)}>
      <p className="mb-1 text-xs sm:text-sm text-gray-500">{label}</p>
      <div className={classNames('text-lg sm:text-2xl font-semibold tabular-nums', valueToneClass[tone])}>
        {value}
      </div>
      {subtext && <p className="mt-1 text-xs text-gray-500">{subtext}</p>}
    </div>
  );
}

export function MetricGrid({ children, className }: MetricGridProps) {
  return (
    <div className={classNames('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6', className)}>
      {children}
    </div>
  );
}
