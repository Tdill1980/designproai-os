/**
 * resend-audiences — read the marketing CONTACT LISTS that live in Resend.
 *
 * Why this exists: the project already uses Resend heavily, but only to SEND
 * (30+ functions call /emails). Nothing reads Resend's Audiences, so the
 * contact lists sitting there are invisible to the rest of the stack — they
 * can't be counted, compared against Klaviyo, or exported to a Meta custom
 * audience. This is the read side.
 *
 * It is read-only. It never writes to Resend and never sends anything.
 *
 * POST body:
 *   action?              "list" (default) — every audience + its contact count
 *                        "contacts"       — the contacts inside one audience
 *   audience_id?         required when action = "contacts"
 *   include_unsubscribed? default false. Unsubscribed contacts are withheld
 *                        unless explicitly asked for, so a careless export
 *                        can't scoop up people who already opted out.
 *
 * Auth: signed-in admin/tester only. This returns customer PII in bulk, so it
 * is gated harder than the send-side functions — an authenticated non-admin
 * gets 403. Per JWT.md §1: verify_jwt = false (gateway off, checked in code).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API = "https://api.resend.com";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type ResendAudience = { id?: string; name?: string; created_at?: string };
type ResendContact = {
  id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  created_at?: string;
  unsubscribed?: boolean;
};

async function resendGet(path: string, apiKey: string): Promise<{ ok: true; json: any } | { ok: false; status: number; detail: string }> {
  const r = await fetch(`${RESEND_API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return { ok: false, status: r.status, detail: detail.slice(0, 500) };
  }
  return { ok: true, json: await r.json() };
}

function contactsOf(json: any): ResendContact[] {
  return Array.isArray(json?.data) ? json.data : [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "Authentication required" }, 401);

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Invalid auth token" }, 401);

    // Bulk PII — admin/tester only. Service role reads user_roles past its RLS.
    const svc = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: privileged } = await svc
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "tester"])
      .limit(1)
      .maybeSingle();
    if (!privileged) return jsonResponse({ error: "Admin access required" }, 403);

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return jsonResponse({ error: "RESEND_API_KEY not configured" }, 500);

    let body: { action?: string; audience_id?: string; include_unsubscribed?: boolean } = {};
    try { body = await req.json(); } catch { /* defaults */ }

    const action = String(body.action || "list");
    const includeUnsub = body.include_unsubscribed === true;

    if (action === "list") {
      const res = await resendGet("/audiences", apiKey);
      if (!res.ok) {
        return jsonResponse(
          { error: "Resend audiences request failed", status: res.status, detail: res.detail },
          502,
        );
      }
      const audiences: ResendAudience[] = Array.isArray(res.json?.data) ? res.json.data : [];

      // Counts require a per-audience fetch; Resend has no count field.
      const out = [];
      for (const a of audiences) {
        if (!a?.id) continue;
        const c = await resendGet(`/audiences/${a.id}/contacts`, apiKey);
        if (!c.ok) {
          out.push({ id: a.id, name: a.name ?? null, created_at: a.created_at ?? null, error: `contacts ${c.status}` });
          continue;
        }
        const contacts = contactsOf(c.json);
        const unsubscribed = contacts.filter((x) => x?.unsubscribed === true).length;
        out.push({
          id: a.id,
          name: a.name ?? null,
          created_at: a.created_at ?? null,
          total: contacts.length,
          subscribed: contacts.length - unsubscribed,
          unsubscribed,
        });
      }

      return jsonResponse({ success: true, action: "list", count: out.length, audiences: out });
    }

    if (action === "contacts") {
      const audienceId = String(body.audience_id || "").trim();
      if (!audienceId) return jsonResponse({ error: "audience_id is required for action 'contacts'" }, 400);

      const c = await resendGet(`/audiences/${audienceId}/contacts`, apiKey);
      if (!c.ok) {
        return jsonResponse(
          { error: "Resend contacts request failed", status: c.status, detail: c.detail },
          502,
        );
      }

      const all = contactsOf(c.json);
      const kept = includeUnsub ? all : all.filter((x) => x?.unsubscribed !== true);

      return jsonResponse({
        success: true,
        action: "contacts",
        audience_id: audienceId,
        total_in_audience: all.length,
        withheld_unsubscribed: all.length - kept.length,
        count: kept.length,
        contacts: kept.map((x) => ({
          email: x?.email ?? null,
          first_name: x?.first_name ?? null,
          last_name: x?.last_name ?? null,
          unsubscribed: x?.unsubscribed === true,
          created_at: x?.created_at ?? null,
        })),
      });
    }

    return jsonResponse({ error: `Unknown action '${action}'. Use 'list' or 'contacts'.` }, 400);
  } catch (err: any) {
    console.error("resend-audiences: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error", detail: String(err?.message || err) }, 500);
  }
});
