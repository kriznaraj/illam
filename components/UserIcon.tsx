import { User as UserGlyph } from 'lucide-react';
import { getUserIcon } from '@/lib/userUtils';
import type { User } from '@/types';

/** A user's own icon when they chose one, otherwise a neutral person icon in the text colour. */
export function UserIcon({ user, size = 14 }: { user: User | undefined | null; size?: number }) {
  const icon = getUserIcon(user);
  if (icon) return <span aria-hidden>{icon}</span>;
  return <UserGlyph size={size} className="inline-block flex-shrink-0 align-[-2px] text-gray-400" aria-hidden />;
}
