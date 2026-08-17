/**
 * canva-status — returns whether the current user has a valid Canva
 * connection. Used by the frontend to decide whether to show "Connect"
 * vs "Disconnect" + template picker.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { missingAutofillScopes, parseScopes } from "../_shared/canva-scopes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ connected: false, reason: "missing_auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) {
      return new Response(JSON.stringify({ connected: false, reason: "invalid_user" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await admin
      .from("canva_integrations")
      .select("canva_display_name, token_expires_at, updated_at, scopes")
      .eq("user_id", userData.user.id)
      .single();

    if (!data) {
      return new Response(JSON.stringify({ connected: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Report the GRANTED scopes, not the ones we asked for. A token can come
    // back narrower than the request, and a connection that is missing the
    // autofill scopes is not a working connection — it lists designs fine and
    // then fails every brand-template call. Reporting only `connected: true`
    // hid exactly that, so the UI had no way to say "reconnect".
    const missingAutofill = missingAutofillScopes(data.scopes);

    // A live CANVA_SCOPES secret pins what every future connect will request,
    // no matter what the portal or canva-scopes.ts say — a stale one is the
    // one failure that looks correct from every other angle (see the warning
    // in _shared/canva-scopes.ts). Reported here so a reconnect loop that
    // never gains the autofill scopes can be diagnosed from the status call.
    const envOverride = parseScopes(Deno.env.get("CANVA_SCOPES"));

    return new Response(
      JSON.stringify({
        connected: true,
        display_name: data.canva_display_name,
        token_expires_at: data.token_expires_at,
        updated_at: data.updated_at,
        scopes: parseScopes(data.scopes),
        autofill_ready: missingAutofill.length === 0,
        missing_autofill_scopes: missingAutofill,
        scope_override_active: envOverride.length > 0,
        scope_override: envOverride.length ? envOverride : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ connected: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
