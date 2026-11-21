'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { MonthNavigator } from '@/components/MonthNavigator';
import { SegmentedControl } from '@/components/SegmentedControl';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { useCashFlow } from '@/lib/hooks/useCashFlow';
import { formatMoney } from '@/lib/inbox/display';
import { formatters, monthKeys } from '@/lib/utils/dateUtils';
import { classNames } from '@/lib/utils';
import type { CashFlowLine, CashFlowSectionKey } from '@/types';

type Period = 'month' | 'year';

const RUPEES = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const rupees = (amount: number) => RUPEES.format(Math.round(amount));

/** April–March: the year salary, tax and the annual premiums are planned in. */
const fyStartYear = (month: string) => (Number(month.slice(5)) >= 4 ? Number(month.slice(0, 4)) : Number(month.slice(0, 4)) - 1);
const fyLabel = (startYear: number) => `FY ${startYear}–${String(startYear + 1).slice(2)}`;

const SECTION_COLOUR: Record<CashFlowSectionKey, string> = {
  spending: 'bg-blue-500',
  commitments: 'bg-orange-500',
  investments: 'bg-green-500',
  tax: 'bg-purple-500',
  other: 'bg-gray-400',
};

function Row({ line }: { line: CashFlowLine }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{line.label}</p>
        {line.detail ? <p className="text-xs text-gray-500 line-clamp-2">{line.detail}</p> : null}
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-gray-900 whitespace-nowrap">{rupees(line.amount)}</p>
        {line.status === 'paid' ? (
          <span className="text-[11px] font-medium text-green-700">Paid</span>
        ) : line.status === 'assumed' ? (
          <span className="text-[11px] font-medium text-amber-700">Not seen yet</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Cash flow — money in against every kind of money out: spending, insurance and EMIs,
 * investments, tax and other payments. What counts, and what deliberately does not, is
 * decided once in lib/cashflow/buildCashFlow.ts; this page only lays it out.
 */
export default function CashFlowPage() {
  const current = monthKeys.current();
  const [period, setPeriod] = useState<Period>('month');
  const [month, setMonth] = useState(current);
  const [fyYear, setFyYear] = useState(fyStartYear(current));

  const from = period === 'month' ? month : `${fyYear}-04`;
  const to = period === 'month' ? month : `${fyYear + 1}-03`;
  const { report, loading } = useCashFlow(from, to);

  const outShare = useMemo(() => {
    if (!report || report.moneyOut.total <= 0) return [];
    return report.moneyOut.sections.map((s) => ({ key: s.key, pct: (s.total / report.moneyOut.total) * 100 }));
  }, [report]);

  const missingSalary = report?.gaps.monthsWithoutSalary ?? [];
  const waiting = report?.gaps.waitingTransfers;

  return (
    <PageContainer maxWidth="4xl">
      <PageHeader
        title="Cash flow"
        description="Money in against everything that went out"
        action={
          <Link href="/cash-flow/commitments" className="btn btn-secondary btn-sm">
            Insurance &amp; EMIs
          </Link>
        }
      />

      <div className="mb-6 space-y-3">
        <SegmentedControl<Period>
          value={period}
          onChange={setPeriod}
          ariaLabel="Period"
          options={[
            { value: 'month', label: 'Month' },
            { value: 'year', label: 'Financial year' },
          ]}
        />
        {period === 'month' ? (
          <MonthNavigator value={month} onChange={setMonth} ariaLabel="Cash flow month" showPicker />
        ) : (
          <div className="flex items-center justify-between gap-2 max-w-md card px-2 py-1.5">
            <button type="button" className="icon-button-sm" aria-label="Previous financial year" onClick={() => setFyYear(fyYear - 1)}>
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-semibold text-gray-900">{fyLabel(fyYear)}</span>
            <button
              type="button"
              className="icon-button-sm disabled:opacity-30"
              aria-label="Next financial year"
              disabled={fyYear >= fyStartYear(current)}
              onClick={() => setFyYear(fyYear + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      {loading && !report ? (
        <LoadingSpinner message="Adding it up..." />
      ) : !report ? (
        <EmptyState icon="📒" title="Could not load the cash flow" description="Use the refresh button at the top, or try again in a moment." />
      ) : (
        <div className="space-y-4">
          {missingSalary.length > 0 || (waiting && waiting.count > 0) ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1.5">
              {missingSalary.length > 0 ? (
                <p>
                  <span className="font-semibold">No salary read for {missingSalary.map((m) => monthKeys.shortLabel(m)).join(', ')}.</span>{' '}
                  Money in comes from bank statements, so until those months&apos; statements are read the net below is too low.
                </p>
              ) : null}
              {waiting && waiting.count > 0 ? (
                <p>
                  <Link href="/inbox?view=todo" className="font-semibold underline">
                    {waiting.count} transfer{waiting.count === 1 ? '' : 's'} waiting in Madal
                  </Link>{' '}
                  ({rupees(waiting.debit)} out{waiting.credit > 0 ? `, ${rupees(waiting.credit)} in` : ''}) — not counted until classified.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="card p-3 sm:p-4">
              <p className="text-xs text-gray-500">Money in</p>
              <p className="mt-1 text-base sm:text-2xl font-bold text-green-700">{rupees(report.moneyIn.total)}</p>
            </div>
            <div className="card p-3 sm:p-4">
              <p className="text-xs text-gray-500">Money out</p>
              <p className="mt-1 text-base sm:text-2xl font-bold text-gray-900">{rupees(report.moneyOut.total)}</p>
            </div>
            <div className="card p-3 sm:p-4">
              <p className="text-xs text-gray-500">{report.net >= 0 ? 'Left over' : 'Shortfall'}</p>
              <p className={classNames('mt-1 text-base sm:text-2xl font-bold', report.net >= 0 ? 'text-green-700' : 'text-red-600')}>
                {rupees(Math.abs(report.net))}
              </p>
              {report.savingsRate !== null && report.net >= 0 ? (
                <p className="text-[11px] text-gray-500">{Math.round(report.savingsRate * 100)}% of money in</p>
              ) : null}
            </div>
          </div>

          <section className="card p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Money in</h2>
              <span className="text-sm font-semibold text-green-700">{rupees(report.moneyIn.total)}</span>
            </div>
            {report.moneyIn.lines.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">Nothing read yet for this period.</p>
            ) : (
              <div className="mt-1">
                {report.moneyIn.lines.map((line) => (
                  <Row key={line.key} line={line} />
                ))}
              </div>
            )}
            {report.moneyIn.foreign.length > 0 ? (
              <p className="mt-2 text-xs text-gray-500">
                Also {report.moneyIn.foreign.map((f) => formatMoney(f.amount, f.currency)).join(', ')} — held in that currency, not added to the
                rupee total.
              </p>
            ) : null}
          </section>

          <section className="card p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Money out</h2>
              <span className="text-sm font-semibold text-gray-900">{rupees(report.moneyOut.total)}</span>
            </div>
            {outShare.length > 0 ? (
              <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden>
                {outShare.map((s) => (
                  <div key={s.key} className={SECTION_COLOUR[s.key]} style={{ width: `${s.pct}%` }} />
                ))}
              </div>
            ) : null}
            {report.moneyOut.sections.length === 0 ? <p className="mt-2 text-sm text-gray-500">Nothing went out in this period.</p> : null}
          </section>

          {report.moneyOut.sections.map((section) => (
            <section key={section.key} className="card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <span className={classNames('inline-block w-2.5 h-2.5 rounded-full', SECTION_COLOUR[section.key])} aria-hidden />
                  {section.label}
                </h3>
                <span className="text-sm font-semibold text-gray-900">
                  {rupees(section.total)}
                  {report.moneyOut.total > 0 ? (
                    <span className="ml-1.5 text-xs font-normal text-gray-500">{Math.round((section.total / report.moneyOut.total) * 100)}%</span>
                  ) : null}
                </span>
              </div>
              <div className="mt-1">
                {section.lines.map((line) => (
                  <Row key={line.key} line={line} />
                ))}
              </div>
            </section>
          ))}

          {period === 'year' && report.monthly.length > 1 ? (
            <section className="card p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-2">Month by month</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500">
                    <th className="text-left font-medium py-1.5">Month</th>
                    <th className="text-right font-medium py-1.5">In</th>
                    <th className="text-right font-medium py-1.5">Out</th>
                    <th className="text-right font-medium py-1.5">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {report.monthly.map((row) => (
                    <tr key={row.month} className="border-t border-gray-100">
                      <td className="py-2">
                        <button type="button" className="text-left text-blue-700" onClick={() => { setMonth(row.month); setPeriod('month'); }}>
                          {monthKeys.shortLabel(row.month)}
                        </button>
                        {missingSalary.includes(row.month) ? <span className="ml-1 text-[11px] text-amber-700">no salary</span> : null}
                      </td>
                      <td className="py-2 text-right text-green-700 whitespace-nowrap">{rupees(row.moneyIn)}</td>
                      <td className="py-2 text-right text-gray-900 whitespace-nowrap">{rupees(row.moneyOut)}</td>
                      <td className={classNames('py-2 text-right font-medium whitespace-nowrap', row.net >= 0 ? 'text-green-700' : 'text-red-600')}>
                        {row.net < 0 ? '−' : ''}
                        {rupees(Math.abs(row.net))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {report.upcoming.length > 0 ? (
            <section className="card p-4">
              <h2 className="text-sm font-semibold text-gray-900">Coming up</h2>
              <div className="mt-1">
                {report.upcoming.map((line) => (
                  <Row key={line.key} line={{ ...line, detail: line.date ? `Due ${formatters.toFullDate(line.date)}` : null, status: undefined }} />
                ))}
              </div>
            </section>
          ) : null}

          <details className="card p-4 text-sm text-gray-600">
            <summary className="cursor-pointer font-semibold text-gray-900">How this is counted</summary>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>Money in is read from bank statements (salary, interest, dividends), plus EPF and NPS that payroll pays before salary reaches the bank.</li>
              <li>Spending is every expense — card spends included, so card bills are not counted again.</li>
              <li>Insurance and EMIs come from what you declared; a due date that passed with no payment seen is counted at the declared amount.</li>
              <li>Investments are Selvam&apos;s contributions: entered, automatic and SIP instalments.</li>
              <li>
                Not counted: transfers between the two of you, moves between your own accounts, cash withdrawn
                {report.gaps.cashWithdrawn > 0 ? ` (${rupees(report.gaps.cashWithdrawn)} this period)` : ''}, and anything still waiting in Madal.
              </li>
            </ul>
          </details>
        </div>
      )}
    </PageContainer>
  );
}
