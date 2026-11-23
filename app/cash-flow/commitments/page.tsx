'use client';

import { useMemo, useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { ListItemRow } from '@/components/ListItemRow';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/lib/useToast';
import { useCommitments } from '@/lib/hooks/useCashFlow';
import { COMMITMENT_KIND_LABEL, COMMITMENT_KINDS, FREQUENCY_LABEL, FREQUENCY_MONTHS, instalments, type DueInstalment } from '@/lib/cashflow/commitments';
import { formatters, getTodayAppDate, monthKeys } from '@/lib/utils/dateUtils';
import type { Commitment, CommitmentFrequency, CommitmentKind, CommitmentPayment } from '@/types';
import { Shield, House, Pin, type LucideIcon } from 'lucide-react';

const KIND_ICON: Record<CommitmentKind, LucideIcon> = { insurance: Shield, loan: House, other: Pin };
function KindIcon({ kind }: { kind: CommitmentKind }) {
  const Icon = KIND_ICON[kind];
  return <Icon size={18} aria-hidden />;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RUPEES = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const rupees = (amount: number) => RUPEES.format(Math.round(amount));
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

interface FormState {
  id: string | null;
  name: string;
  kind: CommitmentKind;
  amount: string;
  frequency: CommitmentFrequency;
  start_month: string;
  due_day: string;
  end_month: string;
  match_text: string;
  note: string;
  active: boolean;
}

const blankForm = (): FormState => ({
  id: null,
  name: '',
  kind: 'insurance',
  amount: '',
  frequency: 'annual',
  start_month: monthKeys.current(),
  due_day: '1',
  end_month: '',
  match_text: '',
  note: '',
  active: true,
});

/**
 * Month and year as two selects. `<input type="month">` degrades to a text box showing
 * "2026-09" on iOS Safari, where this PWA runs (see MonthNavigator).
 */
function MonthYearSelect({
  id,
  value,
  onChange,
  optional = false,
}: {
  id: string;
  value: string;
  onChange: (month: string) => void;
  optional?: boolean;
}) {
  const thisYear = Number(monthKeys.current().slice(0, 4));
  const years = Array.from({ length: 41 }, (_, i) => thisYear - 15 + i);
  const year = value ? value.slice(0, 4) : '';
  const month = value ? value.slice(5, 7) : '';
  return (
    <div className="flex gap-2">
      <select
        id={id}
        className="select"
        value={month}
        disabled={optional && !value}
        onChange={(e) => onChange(`${year || thisYear}-${e.target.value}`)}
      >
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={String(i + 1).padStart(2, '0')}>
            {name}
          </option>
        ))}
      </select>
      <select
        className="select"
        aria-label="Year"
        value={year}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}-${month || '01'}` : '')}
      >
        {optional ? <option value="">Runs on</option> : null}
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The latest instalment already due (covered by an advance or not), and the next one. */
function latestDue(commitment: Commitment, payments: CommitmentPayment[]): { last: DueInstalment | null; next: DueInstalment | null } {
  const current = monthKeys.current();
  const period = FREQUENCY_MONTHS[commitment.frequency];
  const today = getTodayAppDate();
  const rows = instalments([commitment], payments, monthKeys.shift(current, -period), monthKeys.shift(current, period), today);
  const past = rows.filter((r) => r.dueDate <= today);
  return { last: past[past.length - 1] ?? null, next: rows.find((r) => r.dueDate > today) ?? null };
}

interface PaymentForm {
  commitment: Commitment;
  due_month: string;
  paid_date: string;
  amount: string;
  covers_through: string;
}

/**
 * Insurance premiums and EMIs (migration 037), declared once like a SIP. Each is shown on
 * /cash-flow in the months it falls due; a bank statement line, card line or inbox alert whose
 * text contains "How the bank prints it" is recorded as its payment and never becomes an expense.
 */
export default function CommitmentsPage() {
  const { commitments, payments, loading, create, update, remove, markPaid, unmarkPaid } = useCommitments();
  const { showToast, ToastContainer } = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Commitment | null>(null);
  const [paying, setPaying] = useState<PaymentForm | null>(null);

  const yearly = useMemo(
    () =>
      commitments
        .filter((c) => c.active)
        .reduce((total, c) => total + (Number(c.amount) * 12) / FREQUENCY_MONTHS[c.frequency], 0),
    [commitments]
  );

  const openEdit = (c: Commitment) =>
    setForm({
      id: c.id,
      name: c.name,
      kind: c.kind,
      amount: String(c.amount),
      frequency: c.frequency,
      start_month: c.start_month,
      due_day: String(c.due_day),
      end_month: c.end_month ?? '',
      match_text: c.match_text ?? '',
      note: c.note ?? '',
      active: c.active,
    });

  const save = async () => {
    if (!form) return;
    const amount = Number.parseFloat(form.amount);
    if (!form.name.trim()) return showToast({ message: 'Give it a name', type: 'error' });
    if (!Number.isFinite(amount) || amount <= 0) return showToast({ message: 'Enter an amount greater than zero', type: 'error' });
    setSaving(true);
    try {
      const body: Partial<Commitment> = {
        name: form.name.trim(),
        kind: form.kind,
        amount,
        frequency: form.frequency,
        start_month: form.start_month,
        due_day: Number.parseInt(form.due_day, 10) || 1,
        end_month: form.end_month || null,
        match_text: form.match_text.trim() || null,
        note: form.note.trim() || null,
        active: form.active,
      };
      if (form.id) await update(form.id, body);
      else await create(body);
      showToast({ message: form.id ? 'Saved' : 'Added', type: 'success' });
      setForm(null);
    } catch (error: unknown) {
      showToast({ message: error instanceof Error ? error.message : 'Could not save', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove(deleting.id);
      showToast({ message: 'Deleted', type: 'success' });
    } catch (error: unknown) {
      showToast({ message: error instanceof Error ? error.message : 'Could not delete', type: 'error' });
    } finally {
      setDeleting(null);
    }
  };

  const savePayment = async () => {
    if (!paying) return;
    const amount = Number.parseFloat(paying.amount);
    if (!Number.isFinite(amount) || amount <= 0) return showToast({ message: 'Enter an amount greater than zero', type: 'error' });
    setSaving(true);
    try {
      await markPaid({
        commitment_id: paying.commitment.id,
        due_month: paying.due_month,
        paid_date: paying.paid_date,
        amount,
        covers_through: paying.covers_through || null,
      });
      showToast({ message: 'Payment recorded', type: 'success' });
      setPaying(null);
    } catch (error: unknown) {
      showToast({ message: error instanceof Error ? error.message : 'Could not save', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const undoPaid = async (paymentId: string) => {
    try {
      await unmarkPaid(paymentId);
    } catch (error: unknown) {
      showToast({ message: error instanceof Error ? error.message : 'Could not undo', type: 'error' });
    }
  };

  return (
    <PageContainer maxWidth="4xl">
      <PageHeader
        title="Insurance & EMIs"
        description="What you have signed up to pay — kept out of spending, shown in Cash flow"
        action={
          <button type="button" onClick={() => setForm(blankForm())} className="btn btn-primary">
            Add
          </button>
        }
      />

      {loading && commitments.length === 0 ? (
        <LoadingSpinner message="Loading..." />
      ) : commitments.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="Nothing declared yet"
          description="Add each insurance policy and loan once. Your HDFC statement shows LICPOLICY ₹12,000 on the 8th and a ₹40,000 'Housing loan' transfer on the 5th."
          action={{ label: 'Add one', onClick: () => setForm(blankForm()) }}
        />
      ) : (
        <>
          <div className="card p-4 mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">A year of these</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">{rupees(yearly)}</p>
          </div>
          <div className="card p-0 overflow-hidden">
            {commitments.map((c, index) => {
              const due = c.active ? latestDue(c, payments) : null;
              return (
                // The row is itself a button, so "Mark paid" sits beside it rather than inside.
                <div key={c.id} className={index === commitments.length - 1 ? 'flex items-center' : 'flex items-center border-b border-gray-100'}>
                  <div className="flex-1 min-w-0">
                    <ListItemRow
                      onClick={() => openEdit(c)}
                      isLast
                      leading={
                        <span className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center text-orange-700 flex-shrink-0" aria-hidden>
                          <KindIcon kind={c.kind} />
                        </span>
                      }
                      title={c.active ? c.name : `${c.name} (stopped)`}
                      subtitle={`${rupees(Number(c.amount))} · ${FREQUENCY_LABEL[c.frequency]} · due the ${ordinal(c.due_day)}${
                        c.frequency === 'monthly' ? '' : ` of ${MONTH_NAMES[Number(c.start_month.slice(5)) - 1]}`
                      }`}
                      meta={
                        due?.last || due?.next ? (
                          <span className="text-[11px]">
                            {due.last ? (
                              <span className={due.last.status === 'paid' ? 'text-green-700' : 'text-amber-700'}>
                                {monthKeys.shortLabel(due.last.month)}:{' '}
                                {due.last.covered
                                  ? `covered by the advance paid ${formatters.toFullDate(due.last.payment?.paid_date ?? '')}`
                                  : due.last.payment
                                    ? `paid ${formatters.toFullDate(due.last.payment.paid_date)}${
                                        due.last.payment.covers_through ? `, covers to ${monthKeys.shortLabel(due.last.payment.covers_through)}` : ''
                                      }`
                                    : 'not seen on a statement'}
                              </span>
                            ) : null}
                            {due.next && c.frequency !== 'monthly' ? (
                              <span className="text-gray-500">
                                {due.last ? ' · ' : ''}next {formatters.toFullDate(due.next.dueDate)}
                                {due.next.covered ? ' (covered)' : ''}
                              </span>
                            ) : null}
                          </span>
                        ) : null
                      }
                    />
                  </div>
                  {due?.last && !due.last.covered ? (
                    due.last.payment ? (
                      <button type="button" className="btn btn-sm btn-secondary mr-3 shrink-0" onClick={() => void undoPaid(due.last!.payment!.id)}>
                        Undo paid
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary mr-3 shrink-0"
                        onClick={() =>
                          setPaying({ commitment: c, due_month: due.last!.month, paid_date: due.last!.dueDate, amount: String(c.amount), covers_through: '' })
                        }
                      >
                        Mark paid
                      </button>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}

      <Modal
        isOpen={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit' : 'Add insurance or EMI'}
        footer={
          form ? (
            <>
              {form.id ? (
                <button
                  key="delete"
                  type="button"
                  className="btn btn-danger mr-auto"
                  onClick={() => {
                    const row = commitments.find((c) => c.id === form.id);
                    setForm(null);
                    if (row) setDeleting(row);
                  }}
                >
                  Delete
                </button>
              ) : null}
              <button key="cancel" type="button" className="btn btn-secondary" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button key="save" type="button" className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : null
        }
      >
        {form ? (
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="commitment-name">
                Name
              </label>
              <input
                id="commitment-name"
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Tata AIA term plan, family health floater, car insurance, Housing loan…"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="commitment-kind">
                  Kind
                </label>
                <select id="commitment-kind" className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CommitmentKind })}>
                  {COMMITMENT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {COMMITMENT_KIND_LABEL[kind]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="commitment-amount">
                  Amount
                </label>
                <input
                  id="commitment-amount"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  className="input"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="commitment-frequency">
                  How often
                </label>
                <select
                  id="commitment-frequency"
                  className="select"
                  value={form.frequency}
                  onChange={(e) => setForm({ ...form, frequency: e.target.value as CommitmentFrequency })}
                >
                  {(Object.keys(FREQUENCY_LABEL) as CommitmentFrequency[]).map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_LABEL[f]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="commitment-day">
                  Due on day
                </label>
                <input
                  id="commitment-day"
                  type="number"
                  min={1}
                  max={31}
                  inputMode="numeric"
                  className="input"
                  value={form.due_day}
                  onChange={(e) => setForm({ ...form, due_day: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="commitment-start">
                {form.frequency === 'monthly' ? 'First instalment' : 'A month it falls due'}
              </label>
              <MonthYearSelect id="commitment-start" value={form.start_month} onChange={(m) => setForm({ ...form, start_month: m })} />
              {form.frequency !== 'monthly' ? (
                <p className="mt-1 text-xs text-gray-500">
                  Later instalments repeat from this month — for a policy, its renewal month. Paid several years ahead? Record that payment with &ldquo;covers until&rdquo;.
                </p>
              ) : null}
            </div>

            <div>
              <label className="label" htmlFor="commitment-end">
                Last instalment (optional)
              </label>
              <MonthYearSelect id="commitment-end" value={form.end_month} onChange={(m) => setForm({ ...form, end_month: m })} optional />
            </div>

            <div>
              <label className="label" htmlFor="commitment-match">
                How the bank prints it
              </label>
              <input
                id="commitment-match"
                className="input"
                value={form.match_text}
                onChange={(e) => setForm({ ...form, match_text: e.target.value })}
                placeholder="LICPOLICY"
              />
              <p className="mt-1 text-xs text-gray-500">
                A word from the statement or card line. Any debit containing it is recorded as this payment and never becomes an expense.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="commitment-note">
                Note (optional)
              </label>
              <input id="commitment-note" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>

            {form.id ? (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Still paying
              </label>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={paying !== null}
        onClose={() => setPaying(null)}
        title={paying ? `${paying.commitment.name} · ${monthKeys.shortLabel(paying.due_month)}` : 'Record a payment'}
        footer={
          paying ? (
            <>
              <button key="cancel" type="button" className="btn btn-secondary" onClick={() => setPaying(null)}>
                Cancel
              </button>
              <button key="save" type="button" className="btn btn-primary" onClick={savePayment} disabled={saving}>
                {saving ? 'Saving…' : 'Record'}
              </button>
            </>
          ) : null
        }
      >
        {paying ? (
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="payment-due">
                Instalment due
              </label>
              <MonthYearSelect id="payment-due" value={paying.due_month} onChange={(m) => setPaying({ ...paying, due_month: m })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="payment-date">
                  Paid on
                </label>
                <input id="payment-date" type="date" className="input" value={paying.paid_date} onChange={(e) => setPaying({ ...paying, paid_date: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="payment-amount">
                  Amount paid
                </label>
                <input
                  id="payment-amount"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  className="input"
                  value={paying.amount}
                  onChange={(e) => setPaying({ ...paying, amount: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="payment-covers">
                Paid ahead — covers until (optional)
              </label>
              <MonthYearSelect id="payment-covers" value={paying.covers_through} onChange={(m) => setPaying({ ...paying, covers_through: m })} optional />
              <p className="mt-1 text-xs text-gray-500">
                For several years paid at once: the last instalment this payment covers. Those instalments then count ₹0 — the whole amount is in the month you paid.
              </p>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete this?"
        message="Its recorded payments go too, and it disappears from every month of Cash flow. To stop it from now on, untick “Still paying” instead."
        confirmLabel="Delete"
        variant="danger"
      />

      <ToastContainer />
    </PageContainer>
  );
}
