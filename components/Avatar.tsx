import { avatarColour, avatarInitial } from '@/lib/avatar';
import { classNames } from '@/lib/utils';

/** A round avatar with the person's initial (lib/avatar.ts). Decorative: the name sits beside it. */
export function Avatar({
  name,
  email,
  id,
  size = 28,
  className,
}: {
  name?: string | null;
  email?: string | null;
  /** A stable key for the colour; defaults to the email or name. */
  id?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={classNames(
        'inline-flex flex-shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none',
        avatarColour(id || email || name || '?'),
        className
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {avatarInitial(name, email)}
    </span>
  );
}
