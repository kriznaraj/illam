'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, CircleCheck, Inbox } from 'lucide-react';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { SegmentedControl } from '@/components/SegmentedControl';
import { EmptyState } from '@/components/EmptyState';
import Modal from '@/components/Modal';
import { useToast } from '@/lib/useToast';
import { useInbox, type InboxOwnerFilter } from '@/lib/hooks/useInbox';
import { useHousehold } from '@/lib/hooks/useHousehold';
import { useTransfers } from '@/lib/hooks/useTransfers';
import { usePaymentSources } from '@/lib/hooks/usePaymentSources';
import TransferClassifySheet from '@/components/TransferClassifySheet';
import InboxRecordSheet from '@/components/InboxRecordSheet';
import MadalDecisionNote from '@/components/MadalDecisionNote';
import {
  KIND_META,
  ownerLabel,
  TODO_GROUP_LABEL,
  TODO_GROUP_ORDER,
  dayGroupLabel,
  describeActionBy,
  formatMoney,
  gmailLink,
  itemAmount,
  itemIdentity,
  itemState,
  todoGroup,
  type TodoGroup,
  type UrgencyTone,
} from '@/lib/inbox/display';
import { cleanPayee } from '@/lib/inbox/payee';
import { formatters } from '@/lib/utils/dateUtils';
import { classNames } from '@/lib/utils';
import { inboxApi } from '@/lib/inbox/client';
import type { CardIndex } from '@/lib/expenses/paymentSource';
import type { InboxItem, InboxStatus, InboxTransactionData, InboxView, Transfer } from '@/types';

const VIEWS: { value: InboxView; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'money', label: 'Money' },
  { value: 'statements', label: 'Statements' },
  { value: 'all', label: 'All' },
];



const TONE_CLASS: Record<UrgencyTone, string> = {
  danger: 'bg-red-50 text-red-700 ring-red-100',
  warning: 'bg-amber-50 text-amber-700 ring-amber-100',
  info: 'bg-primary-50 text-primary-700 ring-primary-100',
};

const PROVIDER_LABEL = { cdsl: 'CDSL', nsdl: 'NSDL', nps: 'NPS', indmoney: 'INDmoney', groww: 'Groww', zerodha: 'Zerodha' } as const;

const STATUS_TOAST: Record<InboxStatus, string> = {
  done: 'Marked done',
  dismissed: 'Dismissed',
  new: 'Moved back to inbox',
};

/** "2:14 pm" from the clock time an alert quoted. Absent on rows read before 2026-09-20. */
function clockLabel(time: string | null | undefined): string | null {
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const meridiem = hours < 12 ? 'am' : 'pm';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${meridiem}`;
}

function detailRows(item: InboxItem): [string, string][] {
  const data = item.data;
  const money = (amount: number | null, currency = 'INR') => (amount === null ? null : formatMoney(amount, currency));
  const date = (value: string | null) => (value ? formatters.toFullDate(value) : null);
  const card = (last4: string | null) => (last4 ? `••${last4}` : null);

  let rows: [string, string | null][];
  switch (data.kind) {
    case 'transaction':
      rows = [
        ['Amount', money(data.amount, data.currency)],
        ['Type', data.direction === 'debit' ? 'Debit' : 'Credit'],
        // Read back through the same guard the list uses, so a row whose payee is a footer
        // sentence does not quietly reappear here as fact.
        ['Merchant / payee', cleanPayee(data.merchant)],
        ['Bank', data.bank],
        ['Card / account', card(data.last4)],
        ['Date', date(data.txnDate)],
        ['Time', clockLabel(data.txnTime)],
        ['Available', money(data.available)],
        ['Status', data.outcome === 'declined' ? 'Declined' : null],
        ['International', data.international ? 'Yes' : null],
      ];
      break;
    case 'card_statement':
      rows = [
        ['Bank', data.bank],
        ['Card', card(data.last4)],
        ['Statement date', date(data.statementDate)],
        ['Total due', money(data.totalDue)],
        ['Minimum due', money(data.minDue)],
        ['Due date', date(data.dueDate)],
        ['PDF', data.passwordProtected ? 'Password-protected' : null],
      ];
      break;
    case 'investment_statement':
      rows = [
        ['Provider', PROVIDER_LABEL[data.provider]],
        ['Period from', date(data.periodFrom)],
        ['Period to', date(data.periodTo)],
        ['Amount', money(data.amount)],
      ];
      break;
    case 'trade':
      rows = [
        ['Broker', data.broker],
        ['Side', data.side === 'buy' ? 'Buy' : data.side === 'sell' ? 'Sell' : null],
        ['Symbol', data.symbol],
        ['Quantity', data.quantity === null ? null : String(data.quantity)],
        ['Price', money(data.price, data.currency)],
        ['Order value', money(data.amount, data.currency)],
        ['Status', data.outcome === 'success' ? null : data.outcome === 'cancelled' ? 'Cancelled' : 'Failed'],
      ];
      break;
    case 'notice':
      rows = [
        ['From', data.institution],
        ['Flags', data.keywords.join(', ') || null],
        ['Amount', money(data.amount)],
      ];
      break;
  }
  return rows.filter((row): row is [string, string] => Boolean(row[1]));
}

/**
 * One row.
 *
 * Two lines when the item is settled, which is 90% of them; a third only when something is
 * still open. The old row always spent three — a title, a "Debit · HDFC Bank UPI ••1515"
 * line and a badge strip — so a wall of alerts that had already been dealt with looked
 * exactly as busy as the handful that had not.
 */
function InboxRow({
  item,
  transfer,
  cards,
  onSelect,
}: {
  item: InboxItem;
  transfer: Transfer | null;
  cards: CardIndex;
  onSelect: () => void;
}) {
  const identity = itemIdentity(item, cards);
  const state = itemState(item, transfer !== null);
  const amount = itemAmount(item);
  const urgency = item.status === 'new' ? describeActionBy(item.action_by) : null;
  const time = item.data.kind === 'transaction' ? clockLabel(item.data.txnTime) : null;
  const flag = item.status === 'new' && item.needs_attention && !state ? item.attention_reason : null;
  const open = state?.tone === 'open' || urgency?.tone === 'danger';

  // The method, who it belongs to and when — everything that tells two otherwise identical
  // rows apart, on one line.
  const context = [identity.method, ownerLabel(item.owner), time].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      onClick={onSelect}
      className={classNames(
        'flex items-start gap-3 w-full px-4 py-3 text-left border-b border-gray-100 last:border-b-0',
        'hover:bg-gray-50 active:bg-gray-50 transition-colors',
        item.status !== 'new' && 'opacity-60'
      )}
    >
      <span
        className="w-9 h-9 mt-0.5 rounded-xl flex items-center justify-center text-base flex-shrink-0 ring-1 ring-inset"
        style={
          identity.color
            ? { backgroundColor: `${identity.color}14`, borderColor: identity.color, boxShadow: `inset 0 0 0 1px ${identity.color}33` }
            : undefined
        }
        title={identity.method ?? KIND_META[item.kind].label}
        aria-hidden
      >
        <KindIcon kind={item.kind} />
      </span>

      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-3">
          <span
            className={classNames(
              'text-sm font-medium truncate flex-1 min-w-0',
              identity.anonymous ? 'text-gray-600' : 'text-gray-900'
            )}
          >
            {identity.headline}
          </span>
          {amount ? (
            <span
              className={classNames(
                'text-sm font-semibold whitespace-nowrap',
                amount.tone === 'credit' ? 'text-green-600' : 'text-gray-900'
              )}
            >
              {amount.tone === 'credit' ? '+' : ''}
              {formatMoney(amount.amount, amount.currency)}
            </span>
          ) : null}
        </span>

        <span className="flex items-center gap-1.5 mt-0.5 text-xs text-gray-500 min-w-0">
          <span className="truncate">{context || KIND_META[item.kind].label}</span>
          {state && !open ? (
            <>
              <span className="text-gray-300" aria-hidden>
                ·
              </span>
              <span className={classNames('whitespace-nowrap', state.tone === 'muted' ? 'text-gray-400' : 'text-gray-500')}>
                {state.label}
              </span>
            </>
          ) : null}
        </span>

        {open || flag ? (
          <span className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {state?.tone === 'open' ? (
              <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100">
                {state.label}
              </span>
            ) : null}
            {urgency ? (
              <span className={classNames('px-1.5 py-0.5 rounded text-[11px] font-medium ring-1 ring-inset', TONE_CLASS[urgency.tone])}>
                {urgency.label}
              </span>
            ) : null}
            {flag ? (
              <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100">
                {flag}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function KindIcon({ kind }: { kind: keyof typeof KIND_META }) {
  const Icon = KIND_META[kind].icon;
  return <Icon size={18} className="text-gray-500" aria-hidden />;
}

export default function InboxPage() {
  const [view, setView] = useState<InboxView>('todo');
  const [owner, setOwner] = useState<InboxOwnerFilter>('both');
  const household = useHousehold();
  const ownerOptions: { value: InboxOwnerFilter; label: string }[] = [
    { value: 'both', label: 'All' },
    ...household.map((m) => ({ value: m.slug, label: m.name })),
  ];
  const [selected, setSelected] = useState<InboxItem | null>(null);
  const [saving, setSaving] = useState(false);
  const { showToast, ToastContainer } = useToast();
  const { items, attentionCount, loading, hasMore, loadingMore, loadMore, setStatus, refresh } = useInbox(view, owner);
  // Notices are news, not work: shown under the To-do, never counted.
  const { items: headsUp } = useInbox('headsup', owner);
  const { transfers: pendingTransfers, confirm: confirmTransfer } = useTransfers();
  const { cards } = usePaymentSources();
  const pendingTransferByItem = useMemo(
    () => new Map(pendingTransfers.filter((t) => t.inbox_item_id).map((t) => [t.inbox_item_id as string, t])),
    [pendingTransfers]
  );

  // Read ?view= once on mount; useSearchParams would force a Suspense boundary for no benefit.
  // Older tab names still resolve, so an old link keeps working.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('view');
    const legacy: Record<string, InboxView> = {
      attention: 'todo',
      transactions: 'money',
      cards: 'statements',
      investments: 'statements',
    };
    const resolved = requested ? legacy[requested] ?? requested : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the URL after hydration so the prerendered page and first render match
    if (VIEWS.some((v) => v.value === resolved)) setView(resolved as InboxView);
  }, []);

  /*
   * The feed is grouped by day, because that is how a person remembers a spend. The queue
   * is grouped by the question being asked instead: a large tax debit from months ago and a
   * small decline from this morning are different jobs, and interleaving them by date buries
   * unclassified transfers behind months of routine alerts.
   */
  const groups = useMemo(() => {
    if (view === 'todo') {
      const byGroup = new Map<TodoGroup, InboxItem[]>();
      for (const item of items) {
        const group = todoGroup(item, pendingTransferByItem.has(item.id));
        const bucket = byGroup.get(group);
        if (bucket) bucket.push(item);
        else byGroup.set(group, [item]);
      }
      return TODO_GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => {
        // Oldest first inside a group: the one that has been waiting longest is the one to clear.
        const groupItems = [...(byGroup.get(group) as InboxItem[])].sort((a, b) =>
          a.received_at.localeCompare(b.received_at)
        );
        /*
         * Only where a total means something: money awaiting a decision, and money due.
         * Adding up the statement group would sum portfolio valuations, and the alert group
         * holds declines — attempts that moved nothing — so both would read as debt.
         */
        const total =
          group === 'transfer' || group === 'bill'
            ? groupItems.reduce((sum, item) => {
                const amount = itemAmount(item);
                return sum + (amount && amount.currency === 'INR' ? amount.amount : 0);
              }, 0)
            : 0;
        return {
          key: group,
          label: TODO_GROUP_LABEL[group],
          aside: total > 0 ? `${groupItems.length} · ${formatMoney(total, 'INR')}` : `${groupItems.length}`,
          items: groupItems,
        };
      });
    }

    const out: { key: string; label: string; aside: string | null; items: InboxItem[] }[] = [];
    for (const item of items) {
      const label = dayGroupLabel(item.received_at);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(item);
      else out.push({ key: label, label, aside: null, items: [item] });
    }
    return out;
  }, [items, view, pendingTransferByItem]);

  const changeStatus = async (item: InboxItem, status: InboxStatus) => {
    setSaving(true);
    try {
      await setStatus(item.id, status);
      setSelected(null);
      showToast({ message: STATUS_TOAST[status], type: 'success' });
    } catch (error: unknown) {
      showToast({ message: error instanceof Error ? error.message : 'Could not update', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const selectedUrgency = selected ? describeActionBy(selected.action_by) : null;
  const selectedTransfer = selected ? pendingTransferByItem.get(selected.id) ?? null : null;
  const selectedTxn = selected?.data.kind === 'transaction' ? (selected.data as InboxTransactionData) : null;
  const selectedIdentity = selected ? itemIdentity(selected, cards) : null;
  const selectedAmount = selected ? itemAmount(selected) : null;
  /*
   * The alert has no money record and none is pending, so it can still be moved into Expenses.
   * That is the state most of the backlog is in: automation acts once and its answer sticks,
   * so every credit it threw away, every spend dated before the go-live cut and everything it
   * could not read ended up here with nothing to press.
   */
  const canRecord =
    selectedTxn !== null &&
    !selectedTransfer &&
    !selected?.consumed?.expense_id &&
    !selected?.consumed?.income_id &&
    selected?.consumed?.action !== 'card_bill' &&
    selected?.consumed?.action !== 'transfer';

  const recordSelected = async (request: Parameters<typeof inboxApi.record>[1]) => {
    if (!selected) return;
    const result = await inboxApi.record(selected.id, request);
    await refresh();
    setSelected(null);
    showToast({
      message:
        result.expenseId ? 'Added to expenses' : result.incomeId ? 'Recorded as income' : 'Set aside',
      type: 'success',
    });
  };

  return (
    <PageContainer maxWidth="4xl">
      <PageHeader
        title="Inbox"
        description={
          attentionCount > 0
            ? `${attentionCount} thing${attentionCount === 1 ? '' : 's'} waiting on you`
            : 'Important mail from every member\u2019s inbox'
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <SegmentedControl
            value={view}
            onChange={setView}
            className="w-max"
            ariaLabel="Inbox view"
            options={VIEWS.map((option) => ({
              value: option.value,
              label:
                option.value === 'todo' && attentionCount > 0 ? (
                  <>
                    {option.label}
                    <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-white/80 text-primary-700">
                      {attentionCount}
                    </span>
                  </>
                ) : (
                  option.label
                ),
            }))}
          />
        </div>
        <SegmentedControl value={owner} onChange={setOwner} className="w-max" ariaLabel="Whose mail" options={ownerOptions} />
      </div>

      {loading ? (
        <LoadingSpinner message="Loading inbox..." />
      ) : items.length === 0 ? (
        view === 'todo' ? (
          <EmptyState
            icon={CircleCheck}
            title="Nothing waiting"
            description="Everything that arrived has been settled, by the rules or by Claude."
            action={{ label: 'Show all mail', onClick: () => setView('all') }}
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="No mail here yet"
            description="Messages appear once the Gmail sync script has run in each account."
          />
        )
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{group.label}</h2>
                {group.aside ? <span className="text-xs text-gray-400 whitespace-nowrap">{group.aside}</span> : null}
              </div>
              <div className="card p-0 overflow-hidden">
                {group.items.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    transfer={pendingTransferByItem.get(item.id) ?? null}
                    cards={cards}
                    onSelect={() => setSelected(item)}
                  />
                ))}
              </div>
            </section>
          ))}

          {hasMore ? (
            <div className="flex justify-center">
              <button onClick={loadMore} disabled={loadingMore} className="btn btn-secondary">
                {loadingMore ? 'Loading…' : 'Load older'}
              </button>
            </div>
          ) : null}
        </div>
      )}

      {view === 'todo' && !loading && headsUp.length > 0 ? (
        <section className="mt-6">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Heads-up</h2>
            <span className="text-xs text-gray-400">Nothing to do here · not counted</span>
          </div>
          <div className="card p-0 overflow-hidden opacity-90">
            {headsUp.map((item) => (
              <InboxRow
                key={item.id}
                item={item}
                transfer={null}
                cards={cards}
                onSelect={() => setSelected(item)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <Modal
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        title={selectedIdentity?.headline ?? ''}
        maxWidth="md"
        footer={
          selected ? (
            selected.status === 'new' ? (
              <>
                <button
                  key="dismiss"
                  type="button"
                  onClick={() => changeStatus(selected, 'dismissed')}
                  disabled={saving}
                  className="btn btn-ghost"
                >
                  Dismiss
                </button>
                {/*
                 * Secondary, deliberately. "Mark done" was the primary action of this sheet and
                 * has been pressed once in 518 items — the decision below the amount is what a
                 * person actually came here to make, so nothing should compete with it.
                 */}
                <button
                  key="done"
                  type="button"
                  onClick={() => changeStatus(selected, 'done')}
                  disabled={saving}
                  className="btn btn-secondary"
                >
                  Mark done
                </button>
              </>
            ) : (
              <button
                key="reopen"
                type="button"
                onClick={() => changeStatus(selected, 'new')}
                disabled={saving}
                className="btn btn-secondary"
              >
                Move back to inbox
              </button>
            )
          ) : null
        }
      >
        {selected && selectedIdentity ? (
          <div className="space-y-4">
            {/* The amount, then the decision. Everything else is reference. */}
            <div>
              {selectedAmount ? (
                <p
                  className={classNames(
                    'text-2xl font-semibold',
                    selectedAmount.tone === 'credit' ? 'text-green-600' : 'text-gray-900'
                  )}
                >
                  {selectedAmount.tone === 'credit' ? '+' : ''}
                  {formatMoney(selectedAmount.amount, selectedAmount.currency)}
                </p>
              ) : null}
              <p className="text-xs text-gray-500 mt-1">
                {[
                  KIND_META[selected.kind].label,
                  selectedIdentity.method,
                  ownerLabel(selected.owner),
                  formatters.toFullDateTime(selected.received_at),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>

            {selected.status === 'new' && selected.needs_attention ? (
              <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-sm text-amber-800">
                {selected.attention_reason}
                {selectedUrgency ? ` · ${selectedUrgency.label}` : ''}
              </div>
            ) : null}

            <MadalDecisionNote
              key={`decision-${selected.id}`}
              itemId={selected.id}
              onUndone={async () => {
                await refresh();
                setSelected(null);
                showToast({ message: 'Undone — it is back in the To-do', type: 'success' });
              }}
            />

            {selectedTransfer ? (
              <TransferClassifySheet
                key={selectedTransfer.id}
                transfer={selectedTransfer}
                onConfirm={async (decision) => {
                  await confirmTransfer(selectedTransfer.id, decision);
                  await refresh();
                  setSelected(null);
                  showToast({ message: decision.kind === 'expense' ? 'Added to expenses' : 'Transfer recorded', type: 'success' });
                }}
              />
            ) : canRecord && selectedTxn ? (
              <InboxRecordSheet item={selected} data={selectedTxn} onRecord={recordSelected} />
            ) : selected.consumed?.expense_id ? (
              <p className="text-sm text-gray-600">
                {selected.consumed.action === 'created' ? 'Added to expenses from this alert.' : 'Linked to an existing expense.'}
              </p>
            ) : selected.consumed?.income_id ? (
              <p className="text-sm text-gray-600">Recorded as income.</p>
            ) : null}

            {selected.summary ? <p className="text-sm text-gray-700">{selected.summary}</p> : null}

            <dl className="rounded-lg border border-gray-100 divide-y divide-gray-100">
              {detailRows(selected).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 px-3 py-2 text-sm">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="text-gray-900 font-medium text-right break-words min-w-0">{value}</dd>
                </div>
              ))}
            </dl>

            {selected.attachment_names.length > 0 ? (
              <p className="text-xs text-gray-500 break-words">Attachments: {selected.attachment_names.join(', ')}</p>
            ) : null}

            <a
              href={gmailLink(selected.mailbox, selected.gmail_message_id)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-with-icon w-full"
            >
              <ExternalLink size={16} /> Open in Gmail
            </a>
          </div>
        ) : null}
      </Modal>

      <ToastContainer />
    </PageContainer>
  );
}
