'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/PageContainer';

const SECTIONS = [
  {
    href: '/portfolio/import',
    title: 'Import (CDSL)',
    description: 'Convert CDSL monthly report to CSV, review, then import holdings and snapshots.',
    icon: '📥',
    bgClass: 'bg-emerald-50',
  },
  {
    href: '/portfolio/settings/accounts',
    title: 'Accounts',
    description: 'Manage portfolio accounts (stocks, MF, gold, etc.) and add instruments.',
    icon: '🏦',
    bgClass: 'bg-blue-50',
  },
  {
    href: '/portfolio/settings/account-types',
    title: 'Account types',
    description: 'Types and colors for accounts (Stocks, Mutual Funds, GOLD, etc.).',
    icon: '🏷️',
    bgClass: 'bg-gray-50',
  },
  {
    href: '/portfolio/settings/gold',
    title: 'Gold register',
    description: 'Physical gold & sovereign gold bonds.',
    icon: '🥇',
    bgClass: 'bg-yellow-50',
  },
  {
    href: '/portfolio/investments',
    title: 'Investments',
    description: 'Track monthly investments, SIP-derived contributions, and allocation splits.',
    icon: '💹',
    bgClass: 'bg-teal-50',
  },
  {
    href: '/portfolio/settings/sip',
    title: 'SIP schedule',
    description: 'Systematic investment plans by platform.',
    icon: '📈',
    bgClass: 'bg-indigo-50',
  },
  {
    href: '/portfolio/settings/credit-cards',
    title: 'Credit cards',
    description: 'Track statements, due dates, payments, and pending bills.',
    icon: '💳',
    bgClass: 'bg-rose-50',
  },
];

export default function SettingsIndexPage() {
  return (
    <PageContainer maxWidth="2xl">
      <PageHeader
        title="Settings"
        description="Manage portfolio accounts, types, and registers"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className={`card flex items-center gap-4 hover:shadow-md transition-shadow group ${section.bgClass}`}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
              {section.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 group-hover:text-gray-700">
                {section.title}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ))}
      </div>
    </PageContainer>
  );
}
