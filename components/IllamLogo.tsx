/**
 * The Illam mark: a doorway with a lamp lit inside it. "Illam" is Tamil for home.
 * The same drawing is public/icon.svg; the PNG icons in public/ are rendered from it, so
 * regenerate them if this changes.
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

/**
 * "illam", drawn rather than typed: in most fonts a capital I and two l's are three identical
 * bars. Lower case, tailed l's and a dot on the i keep it readable. Takes the text colour.
 */
export function IllamWordmark({ height = 20, className = '' }: { height?: number; className?: string }) {
  return (
    <svg
      viewBox="0 -1 88 36"
      height={height}
      width={(height * 88) / 36}
      className={`flex-shrink-0 ${className}`}
      role="img"
      aria-label="Illam"
    >
      <path
        d="M4 17v17M13 3v25a6 6 0 0 0 6 6M26 3v25a6 6 0 0 0 6 6M53 17v17M53 25.5a8.5 8.5 0 1 1-17 0a8.5 8.5 0 1 1 17 0M61 34V23a6.5 6.5 0 0 1 13 0v11M74 23a6.5 6.5 0 0 1 13 0v11"
        fill="none"
        stroke="currentColor"
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="4" cy="8" r="3" fill="#2a7488" />
    </svg>
  );
}

/** The mark with the wordmark beside it: the header lockup. */
export function IllamBrand({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-gray-900 ${className}`} aria-label="Illam" role="img">
      <IllamLogo size={size} />
      <IllamWordmark height={Math.round(size * 0.7)} />
    </span>
  );
}
