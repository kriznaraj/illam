'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PageContainer } from '@/components/PageContainer';
import { PageHeader } from '@/components/PageHeader';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Fingerprint, KeyRound, Stethoscope, SunMoon } from 'lucide-react';
import { applyTheme, readTheme, type Theme } from '@/lib/theme';
import {
  isBiometricAvailable,
  isBiometricRegistered,
  registerBiometric,
  removeBiometric,
} from '@/lib/biometric';

export default function AccountPage() {
  const { supabaseUser, logout } = useAuth();
  const router = useRouter();

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [biometricMessage, setBiometricMessage] = useState('');
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => setTheme(readTheme()), []);

  const chooseTheme = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
  };

  useEffect(() => {
    if (!supabaseUser) return;
    isBiometricAvailable().then((available) => {
      setBiometricAvailable(available);
      if (available) {
        setBiometricEnabled(isBiometricRegistered(supabaseUser.id));
      }
    });
  }, [supabaseUser]);

  const handleEnableBiometric = async () => {
    if (!supabaseUser) return;
    setBiometricLoading(true);
    setBiometricMessage('');
    const ok = await registerBiometric(supabaseUser.id, supabaseUser.email ?? '');
    setBiometricLoading(false);
    if (ok) {
      setBiometricEnabled(true);
      setBiometricMessage('Biometric unlock enabled for this device.');
    } else {
      setBiometricMessage('Could not register biometric. Please try again.');
    }
  };

  const handleDisableBiometric = () => {
    if (!supabaseUser) return;
    removeBiometric(supabaseUser.id);
    setBiometricEnabled(false);
    setBiometricMessage('Biometric unlock disabled.');
  };

  return (
    <PageContainer maxWidth="2xl">
      <PageHeader title="Account" description={supabaseUser?.email ?? ''} />

      {/* Theme: per device */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0 text-gray-600">
              <SunMoon size={20} aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Theme</p>
              <p className="text-xs text-gray-500 mt-0.5">For this device</p>
            </div>
          </div>
          <SegmentedControl<Theme>
            value={theme}
            onChange={chooseTheme}
            ariaLabel="Theme"
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
      </div>

      {/* Biometric unlock */}
      <div className="card mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center flex-shrink-0">
              <Fingerprint size={20} aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Biometric unlock</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {!biometricAvailable
                  ? 'Not supported on this device'
                  : biometricEnabled
                  ? 'Enabled on this device'
                  : 'Not set up on this device'}
              </p>
            </div>
          </div>

          {biometricAvailable && (
            biometricEnabled ? (
              <button
                onClick={handleDisableBiometric}
                className="btn btn-link text-sm text-red-500 hover:text-red-700 flex-shrink-0"
              >
                Disable
              </button>
            ) : (
              <button
                onClick={handleEnableBiometric}
                disabled={biometricLoading}
                className="btn btn-link text-sm flex-shrink-0 disabled:opacity-50"
              >
                {biometricLoading ? 'Setting up…' : 'Enable'}
              </button>
            )
          )}
        </div>

        {biometricMessage && (
          <p className={`mt-3 text-xs px-3 py-2 rounded-lg ${
            biometricMessage.includes('Could not')
              ? 'bg-red-50 text-red-600'
              : 'bg-green-50 text-green-700'
          }`}>
            {biometricMessage}
          </p>
        )}
      </div>

      {/* Change password */}
      <div className="card mb-4">
        <button
          onClick={() => router.push('/account/change-password')}
          className="flex items-center justify-between w-full"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-50 text-gray-600 flex items-center justify-center flex-shrink-0">
              <KeyRound size={20} aria-hidden />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-gray-900">Change password</p>
              <p className="text-xs text-gray-500 mt-0.5">Update your login password</p>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Diagnostics: the client-side log, for bug reports */}
      <div className="card mb-4">
        <Link href="/debug" className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-50 text-gray-600 flex items-center justify-center flex-shrink-0">
              <Stethoscope size={20} aria-hidden />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-gray-900">Diagnostics</p>
              <p className="text-xs text-gray-500 mt-0.5">App log and cache tools, for bug reports</p>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      {/* Sign out */}
      <div className="card">
        <button
          onClick={logout}
          className="flex items-center gap-3 w-full text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-xl flex-shrink-0">
            🚪
          </div>
          <p className="text-sm font-semibold text-red-600">Sign out</p>
        </button>
      </div>
    </PageContainer>
  );
}
