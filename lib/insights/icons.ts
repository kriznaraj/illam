/**
 * Icon keys the rule engines put in `Insight.icon`. The insight card resolves each key to a
 * lucide icon (components/InsightCard.tsx). Anything else in that field, such as an emoji
 * from the AI engine or from a cached row written before keys existed, falls back to an
 * icon chosen by the insight's type, so the card never renders the raw value.
 */
export const INSIGHT_ICON_KEYS = [
  'data-health',
  'gap',
  'build',
  'chart',
  'sparkles',
  'warning',
  'check',
  'dice',
  'shopping',
  'trending-up',
  'trending-down',
  'folders',
  'target',
  'calendar',
  'timer',
  'forecast',
  'calendar-range',
  'construction',
  'alert',
  'stale',
  'shuffle',
  'scale',
  'bank',
  'allocation',
  'telescope',
  'star',
  'down',
] as const;

export type InsightIconKey = (typeof INSIGHT_ICON_KEYS)[number];
