import { ABOUT } from '@/lib/about';

/**
 * The quiet "from Aatra" credit, like the "from Meta" line under WhatsApp's splash.
 * Used on the launch splash, the login page and the About page.
 */
export function FromAatra({ link = true, className = '' }: { link?: boolean; className?: string }) {
  const name = <span className="font-semibold uppercase tracking-[0.2em] text-gray-500">{ABOUT.maker.name}</span>;
  return (
    <p className={`text-center text-[11px] text-gray-400 ${className}`}>
      <span className="block leading-tight">from</span>
      {link ? (
        <a href={ABOUT.maker.url} target="_blank" rel="noreferrer" className="hover:text-gray-700">
          {name}
        </a>
      ) : (
        name
      )}
    </p>
  );
}
