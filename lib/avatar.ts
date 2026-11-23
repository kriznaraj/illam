/**
 * A person's avatar: the first letter of their name (or email), on a colour of their own.
 * The colour is picked from a fixed set by hashing a stable key, so it never changes between
 * visits and two people in a household are usually told apart at a glance.
 */
const COLOURS = [
  'bg-primary-100 text-primary-800',
  'bg-amber-100 text-amber-800',
  'bg-green-100 text-green-800',
  'bg-purple-100 text-purple-800',
  'bg-rose-100 text-rose-800',
  'bg-indigo-100 text-indigo-800',
] as const;

export function avatarInitial(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name ?? '').trim() || (email ?? '').trim();
  // The first whole character, so a letter outside Latin (e.g. Tamil) is not cut in half.
  const first = Array.from(source)[0];
  return first ? first.toLocaleUpperCase() : '?';
}

export function avatarColour(key: string): string {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return COLOURS[hash % COLOURS.length];
}
