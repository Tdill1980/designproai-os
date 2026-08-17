/**
 * Shared auth helpers for SEO edge functions.
 *
 * Resolves the calling user's JWT, returns a Supabase client scoped to that user
 * (so RLS applies), and validates that the user is a member of the requested shop.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface AuthContext {
  user: { id: string; email?: string };
  db: SupabaseClient;
  // Service-role client — bypasses RLS. Only use when explicitly needed
  // (e.g., for cross-shop ops or to write last_error fields without
  // requiring caller perms).
  service: SupabaseClient;
}

export async function authenticate(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Response(JSON.stringify({ error: "Missing bearer token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anon || !serviceRole) {
    throw new Response(JSON.stringify({ error: "Server misconfigured" }), { status: 500 });
  }

  const token = authHeader.replace("Bearer ", "");
  const service = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  // Allow service-role key as bearer token (for cron/internal calls)
  if (token === serviceRole) {
    return {
      user: { id: "00000000-0000-0000-0000-000000000000", email: "cron@restylepro.ai" },
      db: service,
      service,
    };
  }

  const db = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error } = await db.auth.getUser();
  if (error || !userData?.user) {
    throw new Response(JSON.stringify({ error: "Invalid token" }), { status: 401 });
  }

  return {
    user: { id: userData.user.id, email: userData.user.email ?? undefined },
    db,
    service,
  };
}

export async function assertShopMember(ctx: AuthContext, shopId: string): Promise<void> {
  // is_shop_admin is a SECURITY DEFINER function; falling back to a SELECT on
  // shop_members lets a shop member (non-admin) at least read.
  const { data, error } = await ctx.db
    .from("shop_members")
    .select("role")
    .eq("shop_id", shopId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (error || !data) {
    throw new Response(JSON.stringify({ error: "Not a member of this shop" }), { status: 403 });
  }
}

export async function assertShopAdmin(ctx: AuthContext, shopId: string): Promise<void> {
  // Service-role calls (cron, internal) bypass member checks
  if (ctx.user.id === "00000000-0000-0000-0000-000000000000") return;

  const { data, error } = await ctx.db
    .from("shop_members")
    .select("role")
    .eq("shop_id", shopId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (error || !data) {
    throw new Response(JSON.stringify({ error: "Not a member of this shop" }), { status: 403 });
  }
  if (data.role !== "owner" && data.role !== "admin") {
    throw new Response(JSON.stringify({ error: "Shop admin required" }), { status: 403 });
  }
}
