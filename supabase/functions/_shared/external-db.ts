/**
 * External Database Connection
 *
 * Edge functions use env vars to connect to the live Supabase project.
 * Supabase auto-sets SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * The EXTERNAL_ prefixed vars are checked first as overrides.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Get the external Supabase URL (for data operations)
export function getExternalSupabaseUrl(): string {
  return Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
}

// Get the external Supabase service role key
export function getExternalServiceRoleKey(): string {
  return Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

// Get the external Supabase anon key
export function getExternalAnonKey(): string {
  return Deno.env.get('EXTERNAL_SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!;
}

// Create a Supabase client connected to the EXTERNAL database
export function createExternalClient() {
  const url = getExternalSupabaseUrl();
  const key = getExternalServiceRoleKey();

  console.log(`📊 Connecting to external database: ${url.substring(0, 30)}...`);

  return createClient(url, key);
}

// Create a Supabase client with anon key (for public operations)
export function createExternalAnonClient() {
  const url = getExternalSupabaseUrl();
  const key = getExternalAnonKey();

  return createClient(url, key);
}
