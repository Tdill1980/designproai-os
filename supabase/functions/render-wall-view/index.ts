import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { createViewHandler } from './handler.ts';

Deno.serve(createViewHandler({
  createClient,
  supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  apiKey: () => Deno.env.get('GOOGLE_AI_API_KEY') || Deno.env.get('GEMINI_API_KEY') || '',
  fetch,
}));
