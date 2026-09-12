import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { createSyncOrdersHandler } from './handler.ts';

Deno.serve(createSyncOrdersHandler({
  createClient,
  supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  syncSecret: () => Deno.env.get('WPW_SYNC_SECRET') || '',
}));
