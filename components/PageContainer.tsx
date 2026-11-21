interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
  maxWidth?: '2xl' | '4xl' | '5xl' | '7xl' | 'full';
  withBottomPadding?: boolean;
}

// Static map so Tailwind's scanner sees every class name as a literal string.
const MAX_WIDTH_CLASS: Record<NonNullable<PageContainerProps['maxWidth']>, string> = {
  '2xl':  'max-w-2xl',
  '4xl':  'max-w-4xl',
  '5xl':  'max-w-5xl',
  '7xl':  'max-w-7xl',
  'full': 'max-w-full',
};

export function PageContainer({
  children,
  className = "",
  maxWidth = "7xl",
  withBottomPadding = true,
}: PageContainerProps) {
  const maxWidthClass = MAX_WIDTH_CLASS[maxWidth];

  return (
    <div
      className={`
        ${maxWidthClass} mx-auto px-4 sm:px-6 py-6 md:py-8
        ${withBottomPadding ? 'pb-24 md:pb-6' : ''}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {children}
    </div>
  );
}
