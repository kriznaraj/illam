import type { ActivityTrackerEventType } from '@/types';

export const EVENT_TABS: { value: ActivityTrackerEventType; label: string }[] = [
  { value: 'activity', label: 'Activities' },
  { value: 'one_time', label: 'One-time' },
  { value: 'annual', label: 'Annual' },
];

export const EVENT_TYPE_ICON: Record<ActivityTrackerEventType, string> = {
  one_time: '📌',
  activity: '🔁',
  annual: '🎂',
};

export const EVENT_TYPE_OPTIONS: {
  value: ActivityTrackerEventType;
  label: string;
  desc: string;
  icon: string;
}[] = [
  { value: 'one_time', label: 'One-time', desc: 'renovation, trip, purchase', icon: '📌' },
  { value: 'activity', label: 'Activity', desc: 'class, gym, recharge', icon: '🔁' },
  { value: 'annual', label: 'Every year', desc: 'birthday, anniversary', icon: '🎂' },
];
