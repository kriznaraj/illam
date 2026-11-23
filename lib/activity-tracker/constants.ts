import type { ActivityTrackerEventType } from '@/types';
import { Cake, Pin, Repeat, type LucideIcon } from 'lucide-react';

export const EVENT_TABS: { value: ActivityTrackerEventType; label: string }[] = [
  { value: 'activity', label: 'Activities' },
  { value: 'one_time', label: 'One-time' },
  { value: 'annual', label: 'Annual' },
];

export const EVENT_TYPE_ICON: Record<ActivityTrackerEventType, LucideIcon> = {
  one_time: Pin,
  activity: Repeat,
  annual: Cake,
};

export const EVENT_TYPE_OPTIONS: {
  value: ActivityTrackerEventType;
  label: string;
  desc: string;
  icon: LucideIcon;
}[] = [
  { value: 'one_time', label: 'One-time', desc: 'renovation, trip, purchase', icon: Pin },
  { value: 'activity', label: 'Activity', desc: 'class, gym, recharge', icon: Repeat },
  { value: 'annual', label: 'Every year', desc: 'birthday, anniversary', icon: Cake },
];
