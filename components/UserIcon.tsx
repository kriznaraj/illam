import { Avatar } from '@/components/Avatar';
import { getUserIcon } from '@/lib/userUtils';
import type { User } from '@/types';

/** A user's own icon when they chose one, otherwise a small avatar with their initial. */
export function UserIcon({ user, size = 14 }: { user: User | undefined | null; size?: number }) {
  const icon = getUserIcon(user);
  if (icon) return <span aria-hidden>{icon}</span>;
  return <Avatar name={user?.full_name} email={user?.email} id={user?.id} size={size + 4} className="align-[-4px]" />;
}
