'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { madalApi } from '@/lib/inbox/client';
import { useCachedFetch } from '@/lib/useClientCache';
import { useCategories } from '@/lib/hooks/useCategories';
import { formatMoney } from '@/lib/inbox/display';
import { cleanPayee } from '@/lib/inbox/payee';
import { transfersApi } from '@/lib/inbox/client';
import { formatters, monthKeys } from '@/lib/utils/dateUtils';
import type { IncomeKind, PortfolioAccount, Transfer, TransferKind } from '@/types';
import type { TransferCandidates, TransferDecision } from '@/lib/services/TransferService';
import { INCOME_KIND_LABEL, INCOME_KINDS } from '@/lib/services/IncomeService';
import type { ContributionCandidate, ContributionLink } from '@/lib/portfolio/contributionMatch';

type DecisionKind = TransferKind | 'expense' | 'income';

const DEBIT_OPTIONS: { value: DecisionKind; label: string }[] = [
  { value: 'investment', label: 'Investment' },
  { value: 'own_account', label: 'Own account transfer' },
  { value: 'loan', label: 'Loan payment' },
  { value: 'card_bill', label: 'Credit card bill' },
  { value: 'family', label: 'Family transfer' },
  { value: 'cash', label: 'Cash withdrawal' },
  { value: 'tax', label: 'Tax' },
  { value: 'other', label: 'Other transfer' },
  { value: 'expense', label: 'It was an expense' },
];

/**
 * A credit asks a different question. "It was an expense" is absent because money arriving
 * can never be a spend, and income leads because that is the common answer — but it is not
 * the default, since many credits are the household's own card-bill payments
 * arriving back, which is money already counted on its way out.
 */
const CREDIT_OPTIONS: { value: DecisionKind; label: string }[] = [
  { value: 'income', label: 'Income — money earned' },
  { value: 'own_account', label: 'From my own account' },
  { value: 'family', label: 'From family' },
  { value: 'card_bill', label: 'A card bill payment arriving' },
  { value: 'investment', label: 'From an investment account' },
  { value: 'loan', label: 'A loan' },
  { value: 'other', label: 'Something else' },
];

const NEW_CONTRIBUTION = 'new';

const candidateKey = (c: ContributionCandidate) => (c.kind === 'sip' ? `sip:${c.fund}:${c.month}` : `${c.kind}:${c.rowId}`);

const toLink = (c: ContributionCandidate): ContributionLink =>
  c.kind === 'sip' ? { kind: 'sip', fund: c.fund, month: c.month } : { kind: c.kind, row_id: c.rowId };

function describeCandidate(c: ContributionCandidate): string {
  switch (c.kind) {
    case 'manual':
      return `The ${formatMoney(c.amount, 'INR')} entered by hand on ${formatters.toFullDate(c.date)}${c.note ? ` (${c.note})` : ''}`;
    case 'auto_monthly':
      return `The auto-monthly ${formatMoney(c.amount, 'INR')} for ${monthKeys.label(c.date.slice(0, 7))}`;
    case 'sip':
      return `The ${c.fund} SIP instalment for ${monthKeys.label(c.month)}`;
  }
}

const fetchAccounts = async (): Promise<PortfolioAccount[]> => {
  const res = await fetch('/api/portfolio/accounts');
  if (!res.ok) throw new Error('Failed to load accounts');
  return res.json();
};

interface TransferClassifySheetProps {
  transfer: Transfer;
  onConfirm: (decision: TransferDecision) => Promise<void>;
}

/**
 * Says what a logged transfer was for. Every ad-hoc transfer from an alert waits
 * here until classified; "Remember" turns the answer into a payee rule so the
 * next one is applied without asking — except an investment, which a rule only prefills.
 *
 * For an investment the sheet suggests the account and asks whether the debit is already on
 * record (a hand entry, an auto-monthly row, a SIP instalment), so it is never counted twice.
 */
export default function TransferClassifySheet({ transfer, onConfirm }: TransferClassifySheetProps) {
  const isCredit = transfer.direction === 'credit';
  /*
   * Seven of these rows store an alert's safety footer as the payee — "all times. If you
   * have not done above transaction, please i…" — written before the extractor learned to
   * refuse prose. Offering to remember a rule for *that* string would file every future
   * NEFT debit under it, so it degrades to no payee, which is the truth.
   */
  const payee = cleanPayee(transfer.counterparty);
  const options = isCredit ? CREDIT_OPTIONS : DEBIT_OPTIONS;
  const [chosenKind, setKind] = useState<DecisionKind>(() =>
    // A credit arrives carrying the placeholder kind 'other'; it is asked about, not assumed.
    isCredit && !options.some((option) => option.value === transfer.kind) ? 'other' : transfer.kind
  );
  const [accountId, setAccountId] = useState(transfer.account_id ?? '');
  const [accountTouched, setAccountTouched] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [incomeKind, setIncomeKind] = useState<IncomeKind>('other');
  const [note, setNote] = useState('');
  const [remember, setRemember] = useState(false);
  const [matches, setMatches] = useState<TransferCandidates | null>(null);
  const [choice, setChoice] = useState(NEW_CONTRIBUTION);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Claude's answer when it was not sure enough to act on its own (migration 039).
  const [suggestion, setSuggestion] = useState<{ kind: DecisionKind; reason: string } | null>(null);
  const [kindTouched, setKindTouched] = useState(false);

  useEffect(() => {
    if (!transfer.inbox_item_id) return;
    let live = true;
    madalApi
      .decisions([transfer.inbox_item_id])
      .then((rows) => {
        const latest = rows.find((row) => row.action === 'suggested' && row.transfer_id === transfer.id && !row.undone_at);
        const suggested = latest?.kind as DecisionKind | undefined;
        if (!live || !latest || !suggested || !options.some((option) => option.value === suggested)) return;
        setSuggestion({ kind: suggested, reason: latest.reason });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // options is derived from the transfer's direction, which never changes for one sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfer.id, transfer.inbox_item_id]);

  // Filled in, never forced: the person's own choice wins.
  const kind = suggestion && !kindTouched ? suggestion.kind : chosenKind;

  const { data: accounts } = useCachedFetch<PortfolioAccount[]>('inbox-classify-accounts', fetchAccounts, {
    ttl: 30 * 60 * 1000,
  });
  const { categories } = useCategories();

  const isExpense = kind === 'expense';
  const isIncome = kind === 'income';
  const needsAccount = kind === 'investment';

  useEffect(() => {
    if (kind !== 'investment') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- leaving "investment" drops its candidate list and choice
      setMatches(null);
      setChoice(NEW_CONTRIBUTION);
      return;
    }
    let cancelled = false;
    transfersApi
      .candidates(transfer.id, accountId || undefined)
      .then((result) => {
        if (cancelled) return;
        setMatches(result);
        if (!accountId && !accountTouched && result.accountId) setAccountId(result.accountId);
        setChoice(result.preselected ? candidateKey(result.preselected) : NEW_CONTRIBUTION);
      })
      .catch(() => {
        if (!cancelled) setMatches(null);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, accountId, accountTouched, transfer.id]);

  const selected = matches?.candidates.find((c) => candidateKey(c) === choice) ?? null;
  const canSave = isExpense ? categoryId !== '' : isIncome ? true : !needsAccount || accountId !== '';

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await onConfirm({
        kind,
        account_id: isExpense || isIncome ? null : accountId || null,
        category_id: isExpense ? categoryId : null,
        income_kind: isIncome ? incomeKind : null,
        source_name: isIncome ? payee : null,
        note: note.trim() || null,
        remember,
        link: needsAccount && selected ? toLink(selected) : null,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-100 bg-amber-50/40 p-3 space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-900">
          {isCredit ? 'Where did this money come from?' : 'What was this transfer?'}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {[
            formatMoney(Number(transfer.amount), 'INR'),
            formatters.toFullDate(transfer.date),
            payee,
            transfer.payment_method,
            transfer.note ? `suggested: ${transfer.note}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      {suggestion ? (
        <div className="flex items-start gap-2 rounded-md bg-violet-50 border border-violet-100 px-2.5 py-2 text-xs text-violet-900">
          <Sparkles size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            <span className="font-medium">Claude thinks: {options.find((o) => o.value === suggestion.kind)?.label}.</span> {suggestion.reason}
          </span>
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="transfer-kind">
          Type
        </label>
        <select
          id="transfer-kind"
          className="select"
          value={kind}
          onChange={(e) => {
            setKindTouched(true);
            setKind(e.target.value as DecisionKind);
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {isIncome ? (
        <div>
          <label className="label" htmlFor="transfer-income-kind">
            Kind of income
          </label>
          <select
            id="transfer-income-kind"
            className="select"
            value={incomeKind}
            onChange={(e) => setIncomeKind(e.target.value as IncomeKind)}
          >
            {INCOME_KINDS.map((value) => (
              <option key={value} value={value}>
                {INCOME_KIND_LABEL[value]}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">Recorded as income. It is never counted as spending.</p>
        </div>
      ) : isExpense ? (
        <div>
          <label className="label" htmlFor="transfer-category">
            Category
          </label>
          <select id="transfer-category" className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose a category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div>
          <label className="label" htmlFor="transfer-account">
            {needsAccount ? 'Invested into' : 'Account (optional)'}
          </label>
          <select
            id="transfer-account"
            className="select"
            value={accountId}
            onChange={(e) => {
              setAccountTouched(true);
              setAccountId(e.target.value);
            }}
          >
            <option value="">{needsAccount ? 'Choose an account' : 'None'}</option>
            {(accounts ?? [])
              .filter((account) => account.is_active)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.type}
                </option>
              ))}
          </select>
          {needsAccount && matches?.suggestion && matches.suggestion.accountId === accountId ? (
            <p className="text-xs text-gray-500 mt-1">Suggested: {matches.suggestion.reason}.</p>
          ) : null}
        </div>
      )}

      {needsAccount && accountId && matches && matches.candidates.length > 0 ? (
        <fieldset className="space-y-1.5">
          <legend className="label">Already on record?</legend>
          {matches.candidates.map((candidate) => {
            const key = candidateKey(candidate);
            return (
              <label key={key} className="flex items-start gap-2 text-sm text-gray-700">
                <input type="radio" name="contribution" className="mt-1" checked={choice === key} onChange={() => setChoice(key)} />
                <span>{describeCandidate(candidate)}</span>
              </label>
            );
          })}
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="contribution"
              className="mt-1"
              checked={choice === NEW_CONTRIBUTION}
              onChange={() => setChoice(NEW_CONTRIBUTION)}
            />
            <span>No — it is a new contribution</span>
          </label>
          <p className="text-xs text-gray-500">
            {selected ? 'Links the entry already on record — nothing is added twice.' : 'Adds a contribution to that account under Net worth.'}
          </p>
        </fieldset>
      ) : needsAccount ? (
        <p className="text-xs text-gray-500">Recorded as a contribution to that account under Net worth.</p>
      ) : null}

      <div>
        <label className="label" htmlFor="transfer-note">
          Note (optional)
        </label>
        <input id="transfer-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {payee && !isIncome ? (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember for “{payee}”
        </label>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button type="button" onClick={submit} disabled={!canSave || saving} className="btn btn-primary w-full">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
