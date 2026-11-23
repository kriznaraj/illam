import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import './globals.css';
import { AuthProvider } from '@/lib/AuthContext';
import ClientNavigation from '@/components/ClientNavigation';
import BiometricGuard from '@/components/BiometricGuard';
import PWARegister from '@/components/PWARegister';
import OfflineIndicator from '@/components/OfflineIndicator';
import CreditCardDuePopup from '@/components/CreditCardDuePopup';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1c1b' },
  ],
};

export const metadata: Metadata = {
  title: 'Illam',
  description: 'Household finance for Indian families: spending, bank mail, statements and net worth.',
  applicationName: 'Illam',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Illam',
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // data-theme is set before React loads (a chosen light/dark theme), so it may differ.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {/* API address and anon key, read at runtime so one build serves any install (lib/api/config.ts). */}
        <Script src="/api/runtime-config" strategy="beforeInteractive" />
        <ErrorBoundary>
          <PWARegister />
          <OfflineIndicator />
          <AuthProvider>
            <BiometricGuard>
              <ClientNavigation />
              <CreditCardDuePopup />
              <main className="pb-20 md:pb-8">
                {children}
              </main>
            </BiometricGuard>
          </AuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
