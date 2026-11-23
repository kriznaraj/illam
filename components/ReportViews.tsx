import Link from 'next/link';
import { classNames } from '@/lib/utils';

/**
 * The two views behind a section's Reports tab: rule-based Trends and the Insights summary.
 * Links, not state, so each view keeps its own URL. Styled like SegmentedControl.
 */
const VIEWS = {
  expenses: [
    { key: 'trends', label: 'Trends', href: '/expenses/report' },
    { key: 'insights', label: 'Insights', href: '/expenses/insights' },
  ],
  'net-worth': [
    { key: 'trends', label: 'Trends', href: '/portfolio/report' },
    { key: 'insights', label: 'Insights', href: '/portfolio/insights' },
  ],
} as const;

export function ReportViews({ section, current }: { section: keyof typeof VIEWS; current: 'trends' | 'insights' }) {
  return (
    <nav aria-label="Report view" className="mb-6 inline-flex items-center gap-1 rounded-lg bg-gray-100 p-1">
      {VIEWS[section].map((view) => {
        const active = view.key === current;
        return (
          <Link
            key={view.key}
            href={view.href}
            aria-current={active ? 'page' : undefined}
            className={classNames('btn btn-sm', active ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'btn-ghost')}
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
