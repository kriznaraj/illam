'use client';

import { ExpenseWithCategory } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { formatters } from '@/lib/utils/dateUtils';
import { getCategoryIcon } from '@/lib/categoryUtils';
import { awaitsDecision, displayTags, isAutoExpense } from '@/lib/expenses/autoTag';
import { describePaymentSource, parsePaymentSource, type CardIndex } from '@/lib/expenses/paymentSource';

interface ExpenseCardProps {
  expense: ExpenseWithCategory;
  onClick?: () => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  showCheckbox?: boolean;
  onCategoryClick?: (categoryName: string) => void;
  onTagClick?: (tagName: string) => void;
  subtitle?: string;
  /** last4 → the card's name and colour (usePaymentSources). Omit and the dot still works. */
  cards?: CardIndex;
}

/**
 * One row in the expense list.
 *
 * Category leads, because that is what the list is scanned by; the payee and what was
 * bought share the line under it (vendor name, category and what was bought matter more
 * than how it was paid). How it was paid used to take a third line of its own and
 * pushed every row to 64px on a phone — it is now a coloured dot beside the label dots, and
 * the detail modal spells it out, which is where there is room for it.
 */
export function ExpenseCard({
  expense,
  onClick,
  isSelected,
  onToggleSelect,
  showCheckbox,
  onCategoryClick,
  onTagClick,
  subtitle,
  cards,
}: ExpenseCardProps) {
  // `auto` has its own badge; drawing it as a dot as well would say the same thing twice.
  const sortedTags = displayTags(expense.tags).slice().sort((a, b) => a.name.localeCompare(b.name));
  const visibleTags = sortedTags.slice(0, 4);
  const remainingTagCount = sortedTags.length - visibleTags.length;
  const paymentSource = parsePaymentSource(expense.payment_method, cards);

  /*
   * An auto-added row is created with `description = merchant`, so printing both would read
   * "Fancy · Fancy". Dedupe rather than pick one: a hand-entered row often has only a
   * description, and an enriched one has a payee the description never mentions.
   */
  const detailParts = [expense.merchant, expense.description]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  const details = detailParts.filter(
    (part, index) => detailParts.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === index
  );

  return (
    <div
      onClick={(e) => {
        if (!showCheckbox && onClick && e.target instanceof HTMLElement && !e.target.closest('input[type="checkbox"]')) {
          onClick();
        }
      }}
      className={`flex items-center py-2 hover:bg-gray-50 rounded-lg transition-colors border-l-4 ${
        onClick && !showCheckbox ? 'cursor-pointer' : ''
      } ${isSelected ? 'bg-primary-50' : ''}`}
      style={{
        borderLeftColor: expense.event ? expense.event.color : 'transparent'
      }}
      title={expense.event ? `Tagged: ${expense.event.name}` : undefined}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0 pl-1 pr-2">
        {showCheckbox && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
            onClick={(e) => e.stopPropagation()}
          />
        )}

        {onCategoryClick && expense.category?.name ? (
          <button
            type="button"
            className="icon-button flex-shrink-0 text-lg hover:opacity-80 transition-opacity"
            style={{ backgroundColor: expense.category?.color + '20' }}
            title="Filter by category"
            onClick={(e) => {
              e.stopPropagation();
              onCategoryClick(expense.category!.name);
            }}
          >
            {getCategoryIcon(expense.category)}
          </button>
        ) : (
          <div
            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg"
            style={{ backgroundColor: expense.category?.color + '20' }}
          >
            {getCategoryIcon(expense.category)}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {onCategoryClick && expense.category?.name ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCategoryClick(expense.category!.name);
                }}
                className="text-sm font-semibold text-gray-900 hover:text-primary-600 hover:underline transition-colors text-left truncate"
                title="Filter by category"
              >
                {expense.category?.name}
              </button>
            ) : (
              <p className="text-sm font-semibold text-gray-900 truncate">
                {expense.category?.name || 'Uncategorized'}
              </p>
            )}

            {/* Added for you and filed nowhere useful — the one kind worth a look. Counts either way. */}
            {awaitsDecision(expense) && (
              <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800">
                auto
              </span>
            )}
            {/* Auto-added and placed, or already dealt with: quieter, but still not something you typed. */}
            {!awaitsDecision(expense) && isAutoExpense(expense) && (
              <span className="flex-shrink-0 text-[10px] font-medium uppercase tracking-wide text-gray-300" title="Added automatically">
                auto
              </span>
            )}
          </div>

          {details.length > 0 && (
            <p className="text-xs text-gray-500 leading-relaxed break-words">
              {details.join(' · ')}
            </p>
          )}

          {subtitle && (
            <div className="mt-1">
              <span className="text-[11px] text-gray-400">{subtitle}</span>
            </div>
          )}
        </div>
      </div>

      <div className="text-right w-28 flex-shrink-0 pr-1 flex flex-col items-end gap-1">
        <p className="text-base font-bold text-gray-900">
          {formatCurrency(parseFloat(expense.amount.toString()))}
        </p>
        {expense.spent_time && (
          <p
            className="text-[11px] text-gray-400 leading-none"
            title={expense.spent_time_approx ? 'When the bank alert arrived' : 'Time of the spend'}
          >
            {formatters.toClock(expense.spent_time, expense.spent_time_approx)}
          </p>
        )}
        {(paymentSource || visibleTags.length > 0) && (
          <div className="flex items-center gap-1.5">
            {/* How it was paid, in the bank's colour. Spelled out in the detail modal. */}
            {paymentSource && (
              <span
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: paymentSource.color }}
                title={describePaymentSource(paymentSource)}
              />
            )}
            {visibleTags.map((tag) => (
              onTagClick ? (
                <button
                  key={tag.id}
                  type="button"
                  className="w-5 h-5 rounded-full hover:bg-gray-100 transition-colors flex items-center justify-center"
                  title={`Filter by label: ${tag.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTagClick(tag.name);
                  }}
                >
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                </button>
              ) : (
                <span
                  key={tag.id}
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: tag.color }}
                  title={tag.name}
                />
              )
            ))}
            {remainingTagCount > 0 && (
              <span className="text-[11px] text-gray-400">+{remainingTagCount}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
