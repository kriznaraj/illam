'use client';

import { useAuth } from '@/lib/AuthContext';
import BiometricLockScreen from './BiometricLockScreen';

export default function BiometricGuard({ children }: { children: React.ReactNode }) {
  const { biometricLocked } = useAuth();

  if (biometricLocked) {
    return <BiometricLockScreen />;
  }

  return <>{children}</>;
}
