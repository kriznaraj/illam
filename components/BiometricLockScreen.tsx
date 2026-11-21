'use client';

import { useState } from 'react';
import { verifyBiometric, markSessionUnlocked } from '@/lib/biometric';
import { useAuth } from '@/lib/AuthContext';
import IllamLogo from '@/components/IllamLogo';

export default function BiometricLockScreen() {
  const { supabaseUser, setBiometricUnlocked, logout } = useAuth();
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  const handleBiometric = async () => {
    if (!supabaseUser) return;
    setVerifying(true);
    setError('');
    try {
      const ok = await verifyBiometric(supabaseUser.id);
      if (ok) {
        markSessionUnlocked();
        setBiometricUnlocked();
      } else {
        setError('Biometric verification failed. Try again.');
      }
    } catch {
      setError('Could not complete verification. Try again.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
      {/* App icon / branding */}
      <div className="mb-10 text-center">
        <div className="flex justify-center mb-4">
          <IllamLogo size={56} />
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Illam</h1>
        {supabaseUser?.email && (
          <p className="text-sm text-gray-500 mt-1">{supabaseUser.email}</p>
        )}
      </div>

      {/* Biometric button */}
      <button
        onClick={handleBiometric}
        disabled={verifying}
        className="flex flex-col items-center gap-3 group disabled:opacity-60"
        aria-label="Unlock with biometrics"
      >
        <div className={`
          w-20 h-20 rounded-full flex items-center justify-center transition-all
          ${verifying
            ? 'bg-blue-100 scale-95'
            : 'bg-blue-50 group-hover:bg-blue-100 group-active:scale-95'}
        `}>
          {verifying ? (
            <svg className="w-9 h-9 text-blue-500 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33" />
            </svg>
          ) : (
            <svg className="w-9 h-9 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33" />
            </svg>
          )}
        </div>
        <span className="text-sm font-medium text-gray-700">
          {verifying ? 'Verifying…' : 'Tap to unlock'}
        </span>
      </button>

      {error && (
        <p className="mt-4 text-sm text-red-600 text-center">{error}</p>
      )}

      {/* Fallback */}
      <button
        onClick={logout}
        className="absolute bottom-10 text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        Sign in with password instead
      </button>
    </div>
  );
}
