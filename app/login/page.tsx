'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { signIn } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import IllamLogo from '@/components/IllamLogo';
import { PWAInstallMenuItem } from '@/components/PWAInstallMenuItem';
import { ABOUT } from '@/lib/about';
import { FromAatra } from '@/components/FromAatra';
import {
  isBiometricAvailable,
  isBiometricRegistered,
  registerBiometric,
  markSessionUnlocked,
} from '@/lib/biometric';

/**
 * Where to go after signing in. proxy.ts puts the originally-requested path
 * in ?next= when it bounces an unauthenticated request here, so deep links,
 * bookmarks and the PWA shortcuts survive the login round-trip.
 *
 * Read from window rather than useSearchParams() so the page stays statically
 * prerenderable (useSearchParams would require a Suspense boundary).
 * Only same-origin absolute paths are accepted — '//evil.com' and absolute URLs
 * are rejected so ?next= can't be used as an open redirect.
 */
function getPostLoginPath(): string {
  if (typeof window === 'undefined') return '/home';
  const next = new URLSearchParams(window.location.search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/home';
  return next;
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Biometric registration offer (shown after successful login)
  const [showBiometricOffer, setShowBiometricOffer] = useState(false);
  const [loggedInUserId, setLoggedInUserId] = useState('');
  const [loggedInEmail, setLoggedInEmail] = useState('');
  const [biometricRegistering, setBiometricRegistering] = useState(false);

  const router = useRouter();
  const { supabaseUser } = useAuth();

  // If already authenticated (and not locked), skip login
  useEffect(() => {
    if (supabaseUser) {
      router.replace(getPostLoginPath());
    }
  }, [supabaseUser, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const data = await signIn(email, password);
      const userId = data.user?.id ?? '';
      const userEmail = data.user?.email ?? email;

      // Mark this tab/session as unlocked (fresh login = no biometric gate needed)
      markSessionUnlocked();

      // Offer biometric setup if available and not yet registered
      const available = await isBiometricAvailable();
      if (available && userId && !isBiometricRegistered(userId)) {
        setLoggedInUserId(userId);
        setLoggedInEmail(userEmail);
        setShowBiometricOffer(true);
        setIsLoading(false);
        return;
      }

      router.push(getPostLoginPath());
    } catch (err) {
      // Supabase is the only auth path. There used to be a fallback POST to
      // /api/auth here, but that route does not exist — so a wrong password
      // 404'd, failed to parse as JSON, and surfaced as "Connection error"
      // instead of the real reason. Surface signIn's message directly.
      setError(err instanceof Error ? err.message : 'Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnableBiometric = async () => {
    setBiometricRegistering(true);
    const ok = await registerBiometric(loggedInUserId, loggedInEmail);
    setBiometricRegistering(false);
    if (ok) {
      router.push(getPostLoginPath());
    } else {
      // Registration failed — just proceed without biometric
      router.push(getPostLoginPath());
    }
  };

  // Biometric registration offer screen
  if (showBiometricOffer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-sm w-full bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
            <svg className="w-8 h-8 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Turn on biometric unlock?</h2>
          <p className="text-sm text-gray-500 mb-8">
            Use Face ID, Touch ID, or fingerprint to unlock the app next time — no password needed.
          </p>
          <button
            onClick={handleEnableBiometric}
            disabled={biometricRegistering}
            className="btn btn-primary btn-lg w-full disabled:opacity-50 mb-3"
          >
            {biometricRegistering ? 'Setting up…' : 'Enable biometric unlock'}
          </button>
          <button
            onClick={() => router.push(getPostLoginPath())}
            className="btn btn-link text-sm w-full justify-center"
          >
            Not now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-gray-50">
      <div className="max-w-sm w-full">
        <div className="bg-white rounded-2xl border border-gray-200 px-7 py-8 sm:px-8">
          <div className="text-center mb-7">
            <div className="flex justify-center mb-4">
              <IllamLogo size={56} />
            </div>
            <h1 className="text-2xl font-semibold text-gray-900">Sign in to Illam</h1>
            <p className="text-gray-500 mt-1 text-sm">Your household&apos;s money, in one place.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="label">
                Email
              </label>
              <input
                type="email"
                id="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input py-2.5"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="label">
                Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input py-2.5"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="btn btn-primary btn-lg w-full !mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <PWAInstallMenuItem className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-center gap-2 w-full py-2 text-sm font-medium text-primary-700 hover:text-primary-800" />
        </div>
        {/* AGPL §13: people using a copy over the network can get its source. */}
        <p className="mt-4 text-center text-xs text-gray-400">
          Illam {ABOUT.version} is{' '}
          <a href={ABOUT.repo} target="_blank" rel="noreferrer" className="underline hover:text-gray-600">
            open source
          </a>{' '}
          under the {ABOUT.licence.name}.
        </p>
        <FromAatra className="mt-6" />
      </div>
    </div>
  );
}
