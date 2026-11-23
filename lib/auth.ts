import { normalizeEmail } from './email';
import { createSupabaseBrowserClient } from './api/browser';

// Supabase Auth functions — returns the app-wide singleton so auth and data
// operations share the same session state.
export function getSupabaseClient() {
  return createSupabaseBrowserClient();
}

export async function signIn(email: string, password: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    // Keyboards and autocomplete often leave a trailing space, and GoTrue matches the email
    // exactly, so " alice@example.com " would fail as "Invalid login credentials".
    email: normalizeEmail(email),
    password,
  });
  
  if (error) throw error;
  return data;
}

export async function signOut() {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function updatePassword(newPassword: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (error) throw error;
}
