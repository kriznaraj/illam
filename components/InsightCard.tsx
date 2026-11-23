import { formatCurrency } from '@/lib/utils';
import { resolveInsightCardDisplay } from '@/lib/insights/cardDisplay';
import type { InsightSeverity, InsightType } from '@/types';
import type { InsightIconKey } from '@/lib/insights/icons';
import {
  Building2,
  Calendar,
  CalendarRange,
  ChartColumn,
  ChartPie,
  CircleCheck,
  CircleDashed,
  Compass,
  Construction,
  Dices,
  FolderTree,
  Landmark,
  Lightbulb,
  Scale,
  ShoppingBag,
  Shuffle,
  Siren,
  Snowflake,
  Sparkles,
  Star,
  Stethoscope,
  Target,
  Telescope,
  Timer,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

const ICONS_BY_KEY: Record<InsightIconKey, LucideIcon> = {
  'data-health': Stethoscope,
  gap: CircleDashed,
  build: Building2,
  chart: ChartColumn,
  sparkles: Sparkles,
  warning: TriangleAlert,
  check: CircleCheck,
  dice: Dices,
  shopping: ShoppingBag,
  'trending-up': TrendingUp,
  'trending-down': TrendingDown,
  folders: FolderTree,
  target: Target,
  calendar: Calendar,
  timer: Timer,
  forecast: Telescope,
  'calendar-range': CalendarRange,
  construction: Construction,
  alert: Siren,
  stale: Snowflake,
  shuffle: Shuffle,
  scale: Scale,
  bank: Landmark,
  allocation: ChartPie,
  telescope: Telescope,
  star: Star,
  down: TrendingDown,
};

/** Used when `icon` is not a known key: AI insights and older cached rows carry an emoji there. */
const ICONS_BY_TYPE: Record<InsightType, LucideIcon> = {
  pattern: ChartColumn,
  anomaly: TriangleAlert,
  trend: TrendingUp,
  achievement: Sparkles,
  prediction: Telescope,
  projection: Telescope,
  performance: Scale,
  diversification: ChartPie,
  data_quality: Stethoscope,
};

function resolveIcon(icon: string, type: InsightType | undefined): LucideIcon {
  if (icon in ICONS_BY_KEY) return ICONS_BY_KEY[icon as InsightIconKey];
  return (type && ICONS_BY_TYPE[type]) || Compass;
}

interface InsightCardProps {
  /** An InsightIconKey; any other value (such as an emoji) falls back to an icon for `type`. */
  icon: string;
  type?: InsightType;
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
  type,
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
  const Icon = resolveIcon(icon, type);

  return (
    <div className={`card ${tone} border-2 transition-all duration-200 hover:shadow-lg`}>
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className={`${iconTone} w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0`}>
          <Icon size={20} aria-hidden />
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
              <p className="flex items-start gap-1.5 text-xs font-medium opacity-75">
                <Lightbulb size={14} className="mt-px flex-shrink-0" aria-hidden />
                <span>{action}</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
