import type { Metadata } from 'next';
import { Inter, Noto_Sans_Tamil } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/AuthContext';
import ClientNavigation from '@/components/ClientNavigation';
import BiometricGuard from '@/components/BiometricGuard';
import PWARegister from '@/components/PWARegister';
import OfflineIndicator from '@/components/OfflineIndicator';
import CreditCardDuePopup from '@/components/CreditCardDuePopup';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const inter = Inter({ subsets: ['latin'] });
const tamilFont = Noto_Sans_Tamil({
  subsets: ['tamil'],
  weight: ['400', '700'],
  variable: '--font-tamil',
});
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
    <html lang="en">
      <body className={`${inter.className} ${tamilFont.variable}`}>
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
