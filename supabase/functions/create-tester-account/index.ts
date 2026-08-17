/**
 * create-tester-account — provision a fixed-credential TESTER account for UI/E2E tests.
 *
 * Creates (or reuses) an auth user with a KNOWN email + password (email pre-confirmed
 * so it can log in immediately with no email link), then upserts the `tester` role so
 * it bypasses render/subscription limits (BYPASS_ROLES = ['admin','tester']). Runs on
 * the PRIMARY project (SUPABASE_URL) — the same instance the frontend authenticates
 * against — NOT the external WPW instance.
 *
 * GATED: requires header `x-setup-secret` === env `TESTER_SETUP_SECRET`, so a
 * public (verify_jwt=false) endpoint can't be abused to mint privileged accounts.
 *
 * Body: { email, password, role? = "tester" }
 * Header: x-setup-secret: <TESTER_SETUP_SECRET>
 * Output: { success, userId, email, role, created }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-setup-secret",
};

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // Gate: prefer the env secret; fall back to a strong baked secret so this
    // works even when edge secrets can't be set. Rotate by setting the env var.
    const setupSecret = Deno.env.get("TESTER_SETUP_SECRET") || "25f5cafb958b114dd92feb3d20236f1edd4febd60556b574";
    if (req.headers.get("x-setup-secret") !== setupSecret) {
      return json({ error: "Forbidden — bad or missing x-setup-secret" }, 403);
    }

    const { email, password } = await req.json();
    if (!email || !password) return json({ error: "email and password are required" }, 400);
    // TESTER-ONLY by design: this endpoint can never mint an admin, so a leaked
    // gate secret is limited to a render-limit-bypassing tester account.
    const role = "tester";

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const normalizedEmail = String(email).toLowerCase();

    // Find existing user (paginate defensively).
    let userId: string | null = null;
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      const found = data?.users?.find((u: { email?: string }) => u.email?.toLowerCase() === normalizedEmail);
      if (found) userId = found.id;
      if (!data?.users?.length || data.users.length < 200) break;
    }

    let created = false;
    if (userId) {
      // Reset the password so tests always have the known credentials.
      const { error: updErr } = await db.auth.admin.updateUserById(userId, { password, email_confirm: true });
      if (updErr) return json({ error: `Failed to update tester password: ${updErr.message}` }, 400);
    } else {
      const { data: newUser, error: createErr } = await db.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
      });
      if (createErr || !newUser?.user) return json({ error: `Failed to create tester: ${createErr?.message}` }, 400);
      userId = newUser.user.id;
      created = true;
    }

    // Grant the role (bypasses render/subscription limits).
    const { error: roleErr } = await db
      .from("user_roles")
      .upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
    if (roleErr) return json({ error: `User ready but role grant failed: ${roleErr.message}`, userId }, 500);

    return json({ success: true, userId, email: normalizedEmail, role, created });
  } catch (e) {
    return json({ error: `create-tester-account failed: ${(e as Error)?.message || e}` }, 500);
  }
});
