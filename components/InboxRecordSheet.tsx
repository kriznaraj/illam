'use client';

import { useEffect, useState } from 'react';
import { useCategories } from '@/lib/hooks/useCategories';
import { formatMoney } from '@/lib/inbox/display';
import { cleanPayee } from '@/lib/inbox/payee';
import { INCOME_KIND_LABEL, INCOME_KINDS } from '@/lib/services/IncomeService';
import { formatters, toAppTimezoneDate } from '@/lib/utils/dateUtils';
import type { IncomeKind, InboxItem, InboxTransactionData } from '@/types';
import type { RecordRequest } from '@/lib/services/InboxService';

interface InboxRecordSheetProps {
  item: InboxItem;
  data: InboxTransactionData;
  onRecord: (request: RecordRequest) => Promise<void>;
}

/**
 * Move one inbox alert into Expenses.
 *
 * Automation acts on an alert once and its answer sticks, so a spend dated before the
 * go-live cut, a credit, or anything it could not read simply sat in the list with nothing
 * to press. This is the button that was missing. The category is guessed from the payee with
 * the same offline keyword table the quick-add form uses — a suggestion, not a decision.
 */
export default function InboxRecordSheet({ item, data, onRecord }: InboxRecordSheetProps) {
  const { categories } = useCategories();
  const isCredit = data.direction === 'credit';
  // Rows written before extractor v5 store a footer sentence here. Asking the category
  // service what the household files "all times. If you have not done…" under would be
  // noise, and pre-filling the description with it would write that sentence into the expense.
  const merchant = cleanPayee(data.merchant);

  /*
   * Asked of the server, not guessed here, so the answer is the same one automation would
   * reach: what this household already confirmed for this exact payee, and only then the
   * offline keyword table. "SRI SWEETS" means nothing to a keyword list but plenty to a
   * household that has filed it before.
   */
  const [suggestion, setSuggestion] = useState<{ categoryId: string; categoryName: string; count: number; source: string } | null>(null);
  useEffect(() => {
    if (!merchant || isCredit) return;
    let cancelled = false;
    fetch(`/api/expenses/suggest-category?merchant=${encodeURIComponent(merchant)}`)
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) setSuggestion(body.suggestion ?? null);
      })
      // A suggestion is a convenience; its absence leaves the picker empty, which is fine.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [merchant, isCredit]);

  const suggested = suggestion?.categoryId ?? '';
  const [categoryId, setCategoryId] = useState('');
  // `purpose` is only on rows read after migration 035; dividends already in the table
  // may predate it, and their title is what identifies them.
  const looksLikeDividend = data.purpose === 'dividend' || /^dividend\b/i.test(item.title);
  const [incomeKind, setIncomeKind] = useState<IncomeKind>(looksLikeDividend ? 'dividend' : 'other');
  const [description, setDescription] = useState(merchant ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenCategory = categoryId || suggested;
  const date = data.txnDate ?? toAppTimezoneDate(new Date(item.received_at));
  // Expenses hold rupees only; a USD spend has no rate here to become one.
  const foreignSpend = !isCredit && data.currency !== 'INR';

  const send = async (request: RecordRequest) => {
    setSaving(true);
    setError(null);
    try {
      await onRecord(request);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not record this');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-primary-100 bg-primary-50/40 p-3 space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-900">
          {isCredit ? 'Record this as income' : 'Add as an expense'}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {formatMoney(data.amount, data.currency)} · {formatters.toFullDate(date)}
          {merchant ? ` · ${merchant}` : ''}
        </p>
      </div>

      {isCredit ? (
        <div>
          <label className="label" htmlFor="record-income-kind">
            Kind of income
          </label>
          <select
            id="record-income-kind"
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
        </div>
      ) : foreignSpend ? (
        <p className="text-xs text-gray-600">
          This was spent in {data.currency}. Expenses are recorded in rupees only, so add it by hand with the rate you were
          charged.
        </p>
      ) : (
        <>
          <div>
            <label className="label" htmlFor="record-category">
              Category
            </label>
            <select id="record-category" className="select" value={chosenCategory} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {suggestion && chosenCategory === suggested ? (
              <p className="text-xs text-gray-500 mt-1">
                {suggestion.source === 'history'
                  ? `You filed ${merchant} under ${suggestion.categoryName} ${suggestion.count === 1 ? 'once' : `${suggestion.count} times`} before.`
                  : 'Suggested from the payee. Change it if it is wrong.'}
              </p>
            ) : null}
          </div>

          <div>
            <label className="label" htmlFor="record-description">
              Description
            </label>
            <input
              id="record-description"
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={merchant ?? 'What was it for?'}
            />
          </div>
        </>
      )}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => send({ as: 'ignore' })}
          disabled={saving}
          className="btn btn-secondary flex-1"
        >
          Not worth tracking
        </button>
        {!foreignSpend && (
          <button
            type="button"
            onClick={() =>
              send(
                isCredit
                  ? { as: 'income', kind: incomeKind, source_name: merchant }
                  : { as: 'expense', category_id: chosenCategory, description }
              )
            }
            disabled={saving || (!isCredit && !chosenCategory)}
            className="btn btn-primary flex-1"
          >
            {saving ? 'Saving…' : isCredit ? 'Record income' : 'Add expense'}
          </button>
        )}
      </div>
    </div>
  );
}
