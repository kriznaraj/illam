import type { ReactNode } from 'react';
import { classNames } from '@/lib/utils';

interface ListItemRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
  contentClassName?: string;
  isLast?: boolean;
  showChevron?: boolean;
  interactive?: boolean;
}

export function ListItemRow({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  onClick,
  className,
  contentClassName,
  isLast = true,
  showChevron = false,
  interactive = true,
}: ListItemRowProps) {
  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={classNames(
        'flex items-center gap-3 w-full px-4 py-3.5 text-left',
        !isLast && 'border-b border-gray-100',
        interactive && onClick && 'hover:bg-gray-50 active:bg-gray-50 transition-colors',
        className,
      )}
    >
      {leading}
      <div className={classNames('flex-1 min-w-0', contentClassName)}>
        <p className="text-sm font-medium text-gray-900 truncate">{title}</p>
        {subtitle ? <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p> : null}
        {meta ? <div className="mt-1">{meta}</div> : null}
      </div>
      {trailing}
      {showChevron ? (
        <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      ) : null}
    </Component>
  );
}
