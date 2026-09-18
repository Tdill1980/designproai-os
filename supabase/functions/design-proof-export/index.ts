import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { createProofExportHandler } from './handler.ts';

Deno.serve(createProofExportHandler({
  db: createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } }),
  resendKey: Deno.env.get('RESEND_API_KEY'),
  fromEmail: Deno.env.get('ORDER_FROM_EMAIL') || 'orders@designproai.com',
}));
