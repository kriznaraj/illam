import { User } from '@/types';

/**
 * The icon a user picked for themselves (stored on the user row), or null when they have
 * none. Callers show a neutral person icon in that case (components/UserIcon.tsx), so the
 * interface does not fall back to an emoji.
 */
export function getUserIcon(user: User | undefined | null): string | null {
  if (!user) return null;

  if (user.icon) return user.icon;

  return null;
}
