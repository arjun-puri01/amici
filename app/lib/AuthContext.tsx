import React, { createContext, useContext, useState, useEffect } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { cacheUserId, clearCachedUserId } from './sessionCache';

type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; session: Session; onboarded: boolean };

type AuthContextValue = {
  auth: AuthState;
  // Re-queries onboarded state directly — use after completing or resetting onboarding.
  refreshOnboarded: () => Promise<void>;
  // Signs out and immediately sets state to signed_out without waiting for the auth event.
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  auth: { status: 'loading' },
  refreshOnboarded: async () => {},
  signOut: async () => {},
});

async function checkOnboarded(userId: string): Promise<boolean> {
  const [profileRes, interestRes] = await Promise.all([
    supabase
      .from('users')
      .select('graduation_year, hometown_city')
      .eq('id', userId)
      .single(),
    supabase
      .from('user_interests')
      .select('interest_id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ]);

  if (profileRes.error) {
    // PGRST116 = no rows returned (user row missing or RLS denied the query).
    // Any error means we cannot confirm onboarding — fall through to onboarding.
    console.warn('[auth] checkOnboarded error:', profileRes.error.code, profileRes.error.message);
    return false;
  }

  const p = profileRes.data;
  return !!(p?.graduation_year && p?.hometown_city && (interestRes.count ?? 0) > 0);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  async function refreshOnboarded() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const onboarded = await checkOnboarded(session.user.id);
    setAuth({ status: 'signed_in', session, onboarded });
  }

  async function signOut() {
    // Set state immediately — don't wait for onAuthStateChange, which can be delayed
    // or lost in some async timing scenarios with Supabase's AsyncStorage adapter.
    setAuth({ status: 'signed_out' });
    await clearCachedUserId();
    await supabase.auth.signOut();
  }

  useEffect(() => {
    // In supabase-js v2, onAuthStateChange fires INITIAL_SESSION only after
    // initializePromise resolves AND the internal lock is acquired — meaning
    // AsyncStorage is fully read and the session token is set before the
    // callback runs. Using getSession() + skipping INITIAL_SESSION was racy:
    // checkOnboarded's queries call _getAccessToken() → getSession() internally,
    // which could contend with _initialize()'s lock and fall back to the anon
    // key, causing RLS to deny the row and return false prematurely.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!session) {
          await clearCachedUserId();
          setAuth({ status: 'signed_out' });
          return;
        }
        // Cache the id for the background task so it never needs getSession().
        await cacheUserId(session.user.id);
        const onboarded = await checkOnboarded(session.user.id);
        setAuth({ status: 'signed_in', session, onboarded });
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ auth, refreshOnboarded, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
