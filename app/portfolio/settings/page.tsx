'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { PageContainer } from '@/components/PageContainer';
import { Download, Landmark, Tag, Coins, ChartCandlestick, TrendingUp, CreditCard, type LucideIcon } from 'lucide-react';

const SECTIONS: { href: string; title: string; description: string; icon: LucideIcon }[] = [
  {
    href: '/portfolio/import',
    title: 'Import (CDSL)',
    description: 'Convert CDSL monthly report to CSV, review, then import holdings and snapshots.',
    icon: Download,
  },
  {
    href: '/portfolio/settings/accounts',
    title: 'Accounts',
    description: 'Manage portfolio accounts (stocks, MF, gold, etc.) and add instruments.',
    icon: Landmark,
  },
  {
    href: '/portfolio/settings/account-types',
    title: 'Account types',
    description: 'Types and colors for accounts (Stocks, Mutual Funds, GOLD, etc.).',
    icon: Tag,
  },
  {
    href: '/portfolio/settings/gold',
    title: 'Gold register',
    description: 'Physical gold & sovereign gold bonds.',
    icon: Coins,
  },
  {
    href: '/portfolio/investments',
    title: 'Investments',
    description: 'Track monthly investments, SIP-derived contributions, and allocation splits.',
    icon: ChartCandlestick,
  },
  {
    href: '/portfolio/settings/sip',
    title: 'SIP schedule',
    description: 'Systematic investment plans by platform.',
    icon: TrendingUp,
  },
  {
    href: '/portfolio/settings/credit-cards',
    title: 'Credit cards',
    description: 'Track statements, due dates, payments, and pending bills.',
    icon: CreditCard,
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
            className="card card-hover flex items-center gap-4 group"
          >
            <div className="w-12 h-12 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">
              <section.icon size={20} aria-hidden />
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
