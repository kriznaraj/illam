import type { ReactNode } from 'react';
import { classNames } from '@/lib/utils';

type MetricTone = 'default' | 'blue' | 'green' | 'purple' | 'orange';

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

const toneClassMap: Record<MetricTone, string> = {
  default: 'card border border-gray-200 text-gray-900',
  blue: 'card bg-gradient-to-r from-blue-500 to-blue-600 text-white',
  green: 'card bg-gradient-to-r from-green-500 to-green-600 text-white',
  purple: 'card bg-gradient-to-r from-purple-500 to-purple-600 text-white',
  orange: 'card bg-gradient-to-r from-orange-500 to-orange-600 text-white',
};

export function MetricCard({
  label,
  value,
  subtext,
  tone = 'default',
  className,
}: MetricCardProps) {
  const isDefaultTone = tone === 'default';

  return (
    <div className={classNames(toneClassMap[tone], className)}>
      <p className={classNames('mb-1', isDefaultTone ? 'text-sm text-gray-600' : 'text-xs sm:text-sm opacity-90')}>
        {label}
      </p>
      <div className={classNames('font-bold', isDefaultTone ? 'text-2xl text-gray-900' : 'text-lg sm:text-2xl')}>
        {value}
      </div>
      {subtext && (
        <p className={classNames('mt-1 text-xs', isDefaultTone ? 'text-gray-500' : 'opacity-90')}>
          {subtext}
        </p>
      )}
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
