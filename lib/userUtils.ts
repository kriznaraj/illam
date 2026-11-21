import { User } from '@/types';

/**
 * Get user icon with fallback
 * Returns user's icon if available, otherwise returns a default icon based on username
 */
export function getUserIcon(user: User | undefined | null): string {
  if (!user) return '👤';

  if (user.icon) return user.icon;

  return '👤';
}
