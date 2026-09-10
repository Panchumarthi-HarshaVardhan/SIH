import { createClient } from '@supabase/supabase-js';

const env = (typeof import.meta !== 'undefined' && (import.meta as any)?.env)
  ? (import.meta as any).env
  : (typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process?.env)
    ? (globalThis as any).process.env
    : {};

const supabaseUrl = env.VITE_SUPABASE_URL || 'https://agxtdttgjdtduyxeijcv.supabase.co';
const supabaseAnonKey =
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_PDCeB8_EbqZ_Y7kxOOROew_EjEa8omq';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseAnonKey !== 'sb_publishable_dummy_key'
);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
});

/**
 * Returns the active session's JWT access token, or null if not authenticated.
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch (error) {
    console.warn('[Supabase] Failed to retrieve active access token:', error);
    return null;
  }
}
