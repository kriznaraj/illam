import { formatCurrency } from '@/lib/utils';
import { resolveInsightCardDisplay } from '@/lib/insights/cardDisplay';
import type { InsightSeverity } from '@/types';

interface InsightCardProps {
  icon: string;
  title: string;
  description: string;
  severity: InsightSeverity;
  /** Nullable, not just optional: the AI wire schema returns `null` for absent figures. */
  value?: number | null;
  change?: number | null;
  action?: string | null;
}

export function InsightCard({
  icon,
  title,
  description,
  severity,
  value,
  change,
  action
}: InsightCardProps) {
  // Null-vs-undefined and unknown-severity handling live in resolveInsightCardDisplay,
  // where they are covered by tests — both have shipped as bugs before.
  const { tone, iconTone, showValue, showChange, changeTone } = resolveInsightCardDisplay({
    severity,
    value,
    change,
  });

  return (
    <div className={`card ${tone} border-2 transition-all duration-200 hover:shadow-lg`}>
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className={`${iconTone} w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0`}>
          {icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-lg mb-1">{title}</h3>
          <p className="text-sm opacity-90 leading-relaxed mb-2">{description}</p>

          {/* Value and Change */}
          {(showValue || showChange) && (
            <div className="flex items-center gap-3 text-sm font-medium mt-3">
              {showValue && (
                <span className="px-3 py-1 bg-white/50 rounded-full">
                  {formatCurrency(value as number)}
                </span>
              )}
              {showChange && (
                <span className={`px-3 py-1 rounded-full ${changeTone} bg-white/50`}>
                  {(change as number) > 0 ? '+' : ''}{(change as number).toFixed(1)}%
                </span>
              )}
            </div>
          )}

          {/* Action */}
          {action && (
            <div className="mt-3 pt-3 border-t border-current/20">
              <p className="text-xs font-medium opacity-75">
                💡 {action}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
