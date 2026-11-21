'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { formatCurrency } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

// Shown at most once per browser session (cleared on tab close / logout).
const SESSION_KEY = 'cc_due_popup_shown';

type Alert =
  | { type: 'statement_ready'; account_id: string; account_name: string; statement_date: string }
  | { type: 'due_soon'; account_id: string; account_name: string; due_date: string; days_until_due: number; pending_amount: number }
  | { type: 'overdue'; account_id: string; account_name: string; due_date: string; days_overdue: number; pending_amount: number };

export default function CreditCardDuePopup() {
  const { isAuthenticated, biometricLocked, isLoading } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);

  // Only overdue and due within 3 days. statement_ready is shown inline on the cards page.
  const actionable = useMemo(() =>
    [...alerts]
      .filter((a) => {
        if (a.type === 'statement_ready') return false;
        if (a.type === 'due_soon') return a.days_until_due <= 2;
        return true;
      })
      .sort((a, b) => (a.type === 'overdue' ? -1 : b.type === 'overdue' ? 1 : 0)),
  [alerts]);

  useEffect(() => {
    if (isLoading || !isAuthenticated || biometricLocked) return;
    // Only show once per login session
    if (sessionStorage.getItem(SESSION_KEY)) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/credit-cards/overview?t=${Date.now()}`, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        const a: Alert[] = Array.isArray(data?.alerts) ? data.alerts : [];
        // Mark as seen for this session regardless of result
        sessionStorage.setItem(SESSION_KEY, '1');
        setAlerts(a);
        const hasUrgent = a.some(
          (x) => x.type === 'overdue' || (x.type === 'due_soon' && x.days_until_due <= 2),
        );
        setOpen(hasUrgent);
      } catch {
        // ignore network errors
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, biometricLocked, isLoading]);

  if (!open) return null;

  return (
    <Modal
      isOpen={open}
      onClose={() => setOpen(false)}
      title="Credit card reminders"
      maxWidth="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={() => setOpen(false)}>Close</button>
          <Link className="btn btn-primary" href="/portfolio/credit-cards" onClick={() => setOpen(false)}>
            Open Credit Cards
          </Link>
        </>
      }
    >
      <div className="space-y-2">
        {actionable.map((a) => {
          if (a.type === 'overdue') {
            return (
              <div key={`${a.type}-${a.account_id}`} className="p-3 rounded-xl border border-red-200 bg-red-50">
                <div className="text-sm font-semibold text-gray-900">{a.account_name}</div>
                <div className="text-xs text-gray-700 mt-0.5">
                  Overdue since {format(parseISO(a.due_date), 'dd MMM')} ({a.days_overdue} day{a.days_overdue === 1 ? '' : 's'} ago)
                  {' · '}{formatCurrency(Number(a.pending_amount || 0))} pending
                </div>
              </div>
            );
          }
          if (a.type === 'due_soon') {
            return (
              <div key={`${a.type}-${a.account_id}`} className="p-3 rounded-xl border border-rose-200 bg-rose-50">
                <div className="text-sm font-semibold text-gray-900">{a.account_name}</div>
                <div className="text-xs text-gray-700 mt-0.5">
                  Due {format(parseISO(a.due_date), 'dd MMM')}
                  {a.days_until_due === 0 ? ' — today!' : ` — in ${a.days_until_due} day${a.days_until_due === 1 ? '' : 's'}`}
                  {' · '}{formatCurrency(Number(a.pending_amount || 0))} pending
                </div>
              </div>
            );
          }
          return null;
        })}
      </div>
    </Modal>
  );
}
