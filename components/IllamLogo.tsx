import { useId } from 'react';

/**
 * The Illam mark: a home whose roof climbs like a growth line, a lit agal vilakku (clay lamp)
 * in the doorway, and kolam dots at the threshold. The same drawing is public/icon.svg and the
 * PWA icons; regenerate those if this changes.
 */
export default function IllamLogo({
  size = 40,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  const scope = useId().replace(/:/g, '');
  const tile = `${scope}-tile`;
  const glow = `${scope}-glow`;
  const flame = `${scope}-flame`;

  return (
    <div className={`flex-shrink-0 ${className}`} style={{ width: size, height: size }} aria-label="Illam" role="img">
      <svg viewBox="0 0 64 64" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={tile} x1="6" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3B5BFD" />
            <stop offset="0.55" stopColor="#2442C9" />
            <stop offset="1" stopColor="#14287E" />
          </linearGradient>
          <radialGradient
            id={glow}
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(32 37) scale(15 13)"
          >
            <stop stopColor="#FFC94D" stopOpacity="0.55" />
            <stop offset="1" stopColor="#FFC94D" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={flame} x1="32" y1="31" x2="32" y2="44" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFE7A3" />
            <stop offset="0.45" stopColor="#FFB627" />
            <stop offset="1" stopColor="#FF7A1A" />
          </linearGradient>
        </defs>

        <rect x="4" y="4" width="56" height="56" rx="15" fill={`url(#${tile})`} />
        <rect x="4.75" y="4.75" width="54.5" height="54.5" rx="14.25" stroke="#FFFFFF" strokeOpacity="0.14" strokeWidth="1.5" />

        {/* Warm light spilling from the doorway */}
        <ellipse cx="32" cy="40" rx="15" ry="13" fill={`url(#${glow})`} />

        {/* Roof: the left slope climbs like a growth line to the peak */}
        <path
          d="M13 31.5 L19.5 26 L23.5 28.5 L32 15.5 L51 31.5"
          stroke="#FFFFFF"
          strokeWidth="3.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="15.5" r="2.1" fill="#FFC94D" />

        {/* Walls */}
        <path d="M18 33 V46.5 H46 V33" stroke="#FFFFFF" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />

        {/* The lamp */}
        <path
          d="M32 28.6 C34.7 31.8 35.9 34.2 35.9 36.3 C35.9 38.6 34.1 40.2 32 40.2 C29.9 40.2 28.1 38.6 28.1 36.3 C28.1 34.2 29.3 31.8 32 28.6 Z"
          fill={`url(#${flame})`}
        />
        <path
          d="M32 33.5 C33 34.8 33.5 35.7 33.5 36.6 C33.5 37.5 32.8 38.2 32 38.2 C31.2 38.2 30.5 37.5 30.5 36.6 C30.5 35.7 31 34.8 32 33.5 Z"
          fill="#FFF6D8"
        />
        <path d="M25.6 41.4 H38.4 C38 43.6 35.4 45 32 45 C28.6 45 26 43.6 25.6 41.4 Z" fill="#FFB627" />
        <path d="M38.2 41.4 L40.3 40.2" stroke="#FFB627" strokeWidth="1.6" strokeLinecap="round" />

        {/* Kolam dots at the threshold */}
        <circle cx="25" cy="52" r="1.25" fill="#FFFFFF" fillOpacity="0.8" />
        <circle cx="32" cy="53" r="1.25" fill="#FFC94D" />
        <circle cx="39" cy="52" r="1.25" fill="#FFFFFF" fillOpacity="0.8" />
      </svg>
    </div>
  );
}

/** The mark with the "Illam" wordmark beside it — the header lockup. */
export function IllamBrand({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <IllamLogo size={size} />
      <span className="text-[1.15rem] font-semibold tracking-tight text-gray-900 leading-none">Illam</span>
    </span>
  );
}
