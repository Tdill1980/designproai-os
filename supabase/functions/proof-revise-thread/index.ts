/**
 * proof-revise-thread — read the AI-revision CONVERSATION for a proof.
 *
 * Public endpoint (no login). The customer's view token is the auth boundary,
 * exactly like proof-revise-ai / proof-view. Returns the ordered turns so the
 * customer-facing "Revise with AI" chat can render the full back-and-forth
 * (their request + the resulting render + any reference images they attached),
 * persisted across reloads.
 *
 * Each proof_versions row is one turn:
 *   - prompt_text       → the customer's message (null for the base/system
 *                         design and shop uploads)
 *   - render_urls.hero  → the design at that turn
 *   - uploaded_file_paths → reference images the customer attached (signed)
 *   - created_by_role   → "system_upload" | "shop" | "customer" | "ai"
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyProofToken } from "../_shared/proof-tokens.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function heroOf(renderUrls: Record<string, string> | null): string | null {
  if (!renderUrls) return null;
  return (
    renderUrls.hero ||
    renderUrls.side ||
    renderUrls.roof ||
    Object.values(renderUrls)[0] ||
    null
  );
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    let body: { token?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    if (!body.token) return jsonResponse({ error: "token required" }, 400);

    let verifiedUuid: string | null;
    try {
      verifiedUuid = await verifyProofToken(body.token, "view");
    } catch (err) {
      console.error("proof-revise-thread: token verify threw:", err);
      return jsonResponse({ error: "Server misconfiguration" }, 500);
    }
    if (!verifiedUuid) return jsonResponse({ error: "Invalid token" }, 404);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: proof, error: fetchErr } = await db
      .from("proof_approvals")
      .select("id, ai_revisions_allowed, ai_revisions_used, status, mode")
      .eq("view_token", body.token)
      .single();
    if (fetchErr || !proof) return jsonResponse({ error: "Proof not found" }, 404);

    const { data: versions } = await db
      .from("proof_versions")
      .select("id, version_number, created_by_role, created_at, prompt_text, render_urls, uploaded_file_paths, is_active")
      .eq("proof_id", proof.id)
      .order("version_number", { ascending: true });

    const turns = [];
    for (const v of (versions || [])) {
      // Sign any attached reference images so the thread can show thumbnails.
      const refUrls: string[] = [];
      for (const path of ((v.uploaded_file_paths as string[]) || []).slice(0, 4)) {
        if (!path) continue;
        const { data: signed } = await db.storage
          .from("proof-uploads")
          .createSignedUrl(path, 60 * 60);
        if (signed?.signedUrl) refUrls.push(signed.signedUrl);
      }
      turns.push({
        version_number: v.version_number,
        created_by_role: v.created_by_role,
        created_at: v.created_at,
        prompt_text: v.prompt_text || null,
        render_url: heroOf(v.render_urls as Record<string, string> | null),
        reference_urls: refUrls,
        is_active: v.is_active,
      });
    }

    const allowed = Number(proof.ai_revisions_allowed ?? 0);
    const used = Number(proof.ai_revisions_used ?? 0);

    return jsonResponse({
      success: true,
      status: proof.status,
      mode: proof.mode,
      ai_revisions: { allowed, used, remaining: Math.max(0, allowed - used) },
      turns,
    });
  } catch (err: any) {
    console.error("proof-revise-thread: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error", detail: err?.message }, 500);
  }
});
