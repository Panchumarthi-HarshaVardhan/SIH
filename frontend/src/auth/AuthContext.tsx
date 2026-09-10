import React, { createContext, useEffect, useState, useMemo, useCallback } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: string;
  displayName: string;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | Error | null }>;
  signUp: (email: string, password: string, name?: string, role?: string) => Promise<{ error: AuthError | Error | null; data?: any }>;
  signOut: () => Promise<{ error: AuthError | Error | null }>;
  refreshSession: () => Promise<Session | null>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Restore existing session and subscribe to auth state changes
  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      try {
        const { data: { session: initialSession }, error } = await supabase.auth.getSession();
        if (error) {
          console.error('[AuthProvider] Error retrieving session:', error);
        }
        if (isMounted) {
          setSession(initialSession);
          setUser(initialSession?.user ?? null);
          setLoading(false);
        }
      } catch (err) {
        console.error('[AuthProvider] Auth initialization exception:', err);
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (isMounted) {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const role = useMemo(() => {
    if (!user) return 'anonymous';
    return (
      (user.app_metadata?.role as string) ||
      (user.user_metadata?.role as string) ||
      'operator'
    );
  }, [user]);

  const displayName = useMemo(() => {
    if (!user) return 'Guest';
    return (
      (user.user_metadata?.name as string) ||
      (user.user_metadata?.full_name as string) ||
      user.email?.split('@')[0] ||
      'EOC Operator'
    );
  }, [user]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error };
      setSession(data.session);
      setUser(data.user);
      return { error: null };
    } catch (err: any) {
      return { error: err };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, name?: string, assignedRole: string = 'operator') => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name: name || email.split('@')[0],
            role: assignedRole,
          },
        },
      });
      if (error) return { error };
      if (data.session) {
        setSession(data.session);
        setUser(data.user);
      }
      return { error: null, data };
    } catch (err: any) {
      return { error: err };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) return { error };
      setSession(null);
      setUser(null);
      return { error: null };
    } catch (err: any) {
      return { error: err };
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const { data: { session: refreshedSession }, error } = await supabase.auth.refreshSession();
      if (error) {
        console.warn('[AuthProvider] Failed to refresh session:', error);
        return null;
      }
      setSession(refreshedSession);
      setUser(refreshedSession?.user ?? null);
      return refreshedSession;
    } catch (err) {
      console.error('[AuthProvider] refreshSession exception:', err);
      return null;
    }
  }, []);

  const contextValue = useMemo(() => ({
    user,
    session,
    loading,
    role,
    displayName,
    signIn,
    signUp,
    signOut,
    refreshSession,
  }), [user, session, loading, role, displayName, signIn, signUp, signOut, refreshSession]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};
