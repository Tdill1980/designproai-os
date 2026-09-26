import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { createSyncOrdersHandler } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

Deno.serve(createSyncOrdersHandler({
  createClient,
  supabaseUrl,
  serviceKey,
  syncSecret: () => Deno.env.get('WPW_SYNC_SECRET') || '',
  // A signed-in customer syncs only their own linked Woo account. The token is
  // verified by Supabase Auth (getUser), never decoded locally.
  authenticate: async (req: Request) => {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token || !supabaseUrl || !serviceKey) return null;
    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await sb.auth.getUser(token);
    return error || !data?.user?.id ? null : { id: data.user.id };
  },
}));
