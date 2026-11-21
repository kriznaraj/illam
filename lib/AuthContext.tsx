'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getSupabaseClient, signOut } from './auth';
import type { AuthChangeEvent } from '@supabase/supabase-js';
import {
  isBiometricRegistered,
  isBiometricSessionUnlocked,
  clearSessionUnlock,
} from './biometric';
import { User } from '@/types';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';

interface AuthContextType {
  isAuthenticated: boolean;
  currentUser: User | null;
  session: Session | null;
  supabaseUser: SupabaseUser | null;
  login: (user: User) => void;
  logout: () => void;
  isLoading: boolean;
  biometricLocked: boolean;
  setBiometricUnlocked: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticatedState] = useState(false);
  const [currentUser, setCurrentUserState] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [biometricLocked, setBiometricLocked] = useState(false);
  const lastProfileFetchRef = useRef<{ userId: string; at: number } | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const supabase = getSupabaseClient();

    // Listen for auth changes (fires immediately with current session)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      setSession(session);
      setSupabaseUser(session?.user ?? null);
      setAuthenticatedState(!!session);

      if (session?.user) {
        // If session was restored and biometric is registered, show the biometric lock screen
        if (
          isBiometricRegistered(session.user.id) &&
          !isBiometricSessionUnlocked()
        ) {
          setBiometricLocked(true);
        }
        // Avoid refetching on token refresh or repeated auth events.
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          fetchUserProfile(session.user.id);
        } else if (!lastProfileFetchRef.current || lastProfileFetchRef.current.userId !== session.user.id) {
          fetchUserProfile(session.user.id);
        } else {
          setIsLoading(false);
        }
      } else {
        setCurrentUserState(null);
        setIsLoading(false);
        if (pathname !== '/login') {
          router.push('/login');
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [pathname, router]);

  const fetchUserProfile = async (userId: string) => {
    const ttlMs = 5 * 60 * 1000;
    const last = lastProfileFetchRef.current;
    if (last?.userId === userId && Date.now() - last.at < ttlMs) {
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/users?id=${userId}`);
      if (response.ok) {
        const users = await response.json();
        if (users.length > 0) {
          setCurrentUserState(users[0]);
        }
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
    } finally {
      lastProfileFetchRef.current = { userId, at: Date.now() };
      setIsLoading(false);
    }
  };

  const login = (user: User) => {
    // This is now handled by Supabase Auth
    // Keep for backward compatibility
    setAuthenticatedState(true);
    setCurrentUserState(user);
    router.push('/');
  };

  const setBiometricUnlocked = () => {
    setBiometricLocked(false);
  };

  const logout = async () => {
    try {
      await signOut();
      setAuthenticatedState(false);
      setCurrentUserState(null);
      setSession(null);
      setSupabaseUser(null);
      setBiometricLocked(false);
      clearSessionUnlock();
      router.push('/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  return (
    <AuthContext.Provider 
      value={{ 
        isAuthenticated: authenticated, 
        currentUser, 
        session,
        supabaseUser,
        login, 
        logout, 
        isLoading,
        biometricLocked,
        setBiometricUnlocked,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
