/**
 * The Illam mark: a doorway with a lamp lit inside it. "Illam" is Tamil for home.
 * The same drawing is public/icon.svg; the PNG icons in public/ are rendered from it,
 * so regenerate them if this changes.
 */
export default function IllamLogo({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`flex-shrink-0 ${className}`}
      role="img"
      aria-label="Illam"
    >
      <rect width="64" height="64" rx="15" fill="#2a7488" />
      <path d="M18 51V30a14 14 0 0 1 28 0v21" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
      <path d="M32 30.5c4.3 4.8 6 8.1 6 11.1a6 6 0 0 1-12 0c0-3 1.7-6.3 6-11.1z" fill="#f6bd45" />
    </svg>
  );
}

/** The mark with the "Illam" wordmark beside it: the header lockup. */
export function IllamBrand({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <IllamLogo size={size} />
      <span className="text-lg font-semibold tracking-tight text-gray-900 leading-none">Illam</span>
    </span>
  );
}
