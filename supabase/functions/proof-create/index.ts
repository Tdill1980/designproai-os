/**
 * proof-create — Phase 1 of the Proof Approval System.
 *
 * Creates a new proof_approvals row + initial proof_versions row + 'created'
 * proof_events log entry. Returns the public proof URL (HMAC-signed token)
 * and the shop's manage URL.
 *
 * Auth: requires shop owner JWT. Tenant boundary enforced by RLS-aware
 * client (we use the user's auth header to derive shop_id) and the row
 * is then written via service-role for trigger fire / event log atomicity.
 *
 * Phase 2 will add the email send. Phase 1 just returns URLs so internal
 * smoke tests can hit /proof-view.
 *
 * verify_jwt is set to false in supabase/config.toml per JWT.md §1, so this
 * function handles its own auth via the Authorization header.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mintProofToken } from "../_shared/proof-tokens.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
};

interface LineItemInput {
  title: string;
  description?: string;
  render_url?: string;
  thumbnail_url?: string;
  uploaded_file_paths?: string[];
  metadata?: Record<string, unknown>;
}

interface CreateProofRequest {
  // Required
  customer_email: string;
  mode: "sign_only" | "revision_loop";
  // One of these three MUST be present:
  source_visualization_id?: string; // RestylePro-generated render
  uploaded_file_paths?: string[]; // Externally-uploaded artwork (storage paths in `proof-uploads` bucket)
  line_items?: LineItemInput[]; // Phase 8C: multi-line-item proofs

  // Optional metadata
  customer_name?: string;
  customer_phone?: string;
  vehicle_year?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_type?: string;
  design_name?: string;
  finish_type?: string;
  message_to_customer?: string;
  internal_notes?: string;

  // Initial render payload (denormalized for resilience)
  render_urls?: Record<string, string>;

  // Per-proof config overrides
  ai_revisions_allowed?: number;
  white_label_logo_url?: string;
  expires_in_days?: number; // default 14

  // WPW order linkage (optional). Persisted into metadata so the
  // ApprovePro dashboard can group revision/approval history under the
  // WPW order number.
  wpw_order_id?: string;
  wpw_order_number?: string;
  wpw_woo_order_id?: number;
}

const MAX_LINE_ITEMS = 20;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getPublicProofBaseUrl(): string {
  // Phase 1: hardcoded production URL. Phase 6 will add white-label CNAME support.
  return Deno.env.get("PROOF_PUBLIC_BASE_URL") || "https://restyleproai.com";
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Authentication required" }, 401);
    }

    // Resolve shop_id from the JWT
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Invalid auth token" }, 401);
    }
    const shopId = user.id;

    // Parse + validate body
    let body: CreateProofRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (!body.customer_email) {
      return jsonResponse({ error: "customer_email is required" }, 400);
    }
    if (!body.mode || !["sign_only", "revision_loop"].includes(body.mode)) {
      return jsonResponse(
        { error: "mode must be 'sign_only' or 'revision_loop'" },
        400,
      );
    }
    const hasSource = !!body.source_visualization_id;
    const hasUpload =
      Array.isArray(body.uploaded_file_paths) &&
      body.uploaded_file_paths.length > 0;
    const rawLineItems = Array.isArray(body.line_items) ? body.line_items : [];
    const hasLineItems = rawLineItems.length > 0;

    if (!hasSource && !hasUpload && !hasLineItems) {
      return jsonResponse(
        {
          error:
            "Provide source_visualization_id (RestylePro render), uploaded_file_paths (external artwork), or line_items (multi-line proof)",
        },
        400,
      );
    }
    if (hasLineItems && rawLineItems.length > MAX_LINE_ITEMS) {
      return jsonResponse(
        { error: `Too many line items (max ${MAX_LINE_ITEMS})` },
        400,
      );
    }
    if (hasLineItems) {
      for (let i = 0; i < rawLineItems.length; i++) {
        const li = rawLineItems[i];
        if (!li || typeof li.title !== "string" || li.title.trim().length === 0) {
          return jsonResponse(
            { error: `line_items[${i}].title is required` },
            400,
          );
        }
        const liHasRender = typeof li.render_url === "string" && li.render_url.length > 0;
        const liHasUploads =
          Array.isArray(li.uploaded_file_paths) && li.uploaded_file_paths.length > 0;
        if (!liHasRender && !liHasUploads) {
          return jsonResponse(
            {
              error:
                `line_items[${i}] requires render_url or uploaded_file_paths`,
            },
            400,
          );
        }
      }
    }
    const hasRenderUrls =
      body.render_urls && Object.keys(body.render_urls).length > 0;
    if (hasSource && !hasRenderUrls) {
      return jsonResponse(
        {
          error:
            "render_urls is required when source_visualization_id is provided",
        },
        400,
      );
    }

    // Mint tokens BEFORE the DB write so we don't insert without them.
    let viewToken: string;
    let manageToken: string;
    try {
      [viewToken, manageToken] = await Promise.all([
        mintProofToken("view"),
        mintProofToken("manage"),
      ]);
    } catch (err) {
      console.error("proof-create: token mint failed:", err);
      return jsonResponse(
        {
          error:
            "Server misconfiguration: PROOF_TOKEN_SECRET not set or too short",
        },
        500,
      );
    }

    // Phase 6: WPrewards tier gate. Use an early service-role client just
    // for the check; real writes still happen via `db` below.
    const gate = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: allowanceRows } = await gate.rpc(
      "check_proof_allowance",
      { p_user_id: shopId },
    );
    const allowance = Array.isArray(allowanceRows) && allowanceRows.length > 0
      ? allowanceRows[0]
      : null;
    if (allowance && Number(allowance.remaining ?? 0) <= 0) {
      return jsonResponse(
        {
          error:
            `You've used all proofs on your ${allowance.tier} plan this month. Upgrade for more.`,
          reason: "tier_limit",
          tier: allowance.tier,
          remaining: 0,
        },
        402,
      );
    }

    // Default expiry: 14 days
    const expiresInDays = Number.isFinite(body.expires_in_days)
      ? Math.max(1, Math.min(365, Number(body.expires_in_days)))
      : 14;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      .toISOString();

    // Service-role client for atomic insert + trigger fire across tables.
    // RLS is bypassed deliberately — we already verified shop ownership above.
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Insert proof
    const { data: proofRow, error: insertErr } = await db
      .from("proof_approvals")
      .insert({
        shop_id: shopId,
        view_token: viewToken,
        manage_token: manageToken,
        customer_email: body.customer_email,
        customer_name: body.customer_name || null,
        customer_phone: body.customer_phone || null,
        vehicle_year: body.vehicle_year || null,
        vehicle_make: body.vehicle_make || null,
        vehicle_model: body.vehicle_model || null,
        vehicle_type: body.vehicle_type || null,
        design_name: body.design_name || null,
        finish_type: body.finish_type || null,
        source_visualization_id: body.source_visualization_id || null,
        mode: body.mode,
        status: "draft",
        expires_at: expiresAt,
        message_to_customer: body.message_to_customer || null,
        internal_notes: body.internal_notes || null,
        // Phase 6: customer-side AI revision cap comes from the WPrewards
        // tier. Sign-only proofs always get 0. Shop can still override via
        // explicit body.ai_revisions_allowed (capped by tier for safety).
        ai_revisions_allowed: body.mode === "revision_loop"
          ? Math.max(
              0,
              Math.min(
                Number(allowance?.ai_revisions_per_proof ?? 0),
                Number(body.ai_revisions_allowed ?? allowance?.ai_revisions_per_proof ?? 0),
              ),
            )
          : 0,
        // Phase 6: white-label logo honored only on tiers that enabled it.
        white_label_logo_url: allowance?.white_label_enabled
          ? body.white_label_logo_url || null
          : null,
        has_line_items: hasLineItems,
        metadata: {
          tier_at_creation: allowance?.tier || null,
          line_item_count: hasLineItems ? rawLineItems.length : 0,
          wpw_order_id: body.wpw_order_id || null,
          wpw_order_number: body.wpw_order_number || null,
          wpw_woo_order_id:
            typeof body.wpw_woo_order_id === "number" ? body.wpw_woo_order_id : null,
        },
      })
      .select("id")
      .single();

    if (insertErr || !proofRow) {
      console.error("proof-create: insert failed:", insertErr);
      return jsonResponse(
        { error: "Failed to create proof", detail: insertErr?.message },
        500,
      );
    }
    const proofId = proofRow.id;

    // Initial version (v1, active). For line-item proofs, render_urls rolls
    // up every line's render so the legacy PDF template still has a hero.
    const aggregatedRenderUrls: Record<string, string> = hasLineItems
      ? Object.fromEntries(
          rawLineItems
            .map((li, idx) => {
              const url =
                (typeof li.render_url === "string" && li.render_url) ||
                (Array.isArray(li.uploaded_file_paths) && li.uploaded_file_paths[0]) ||
                null;
              return url ? [`line_${idx + 1}`, url as string] : null;
            })
            .filter(Boolean) as Array<[string, string]>,
        )
      : body.render_urls || {};

    const aggregatedUploadPaths: string[] = hasLineItems
      ? rawLineItems.flatMap((li) =>
          Array.isArray(li.uploaded_file_paths) ? li.uploaded_file_paths : [],
        )
      : body.uploaded_file_paths || [];

    const { data: versionRow, error: versionErr } = await db
      .from("proof_versions")
      .insert({
        proof_id: proofId,
        version_number: 1,
        created_by_role: hasSource ? "shop" : "system_upload",
        created_by_user_id: shopId,
        render_urls: aggregatedRenderUrls,
        uploaded_file_paths: aggregatedUploadPaths,
        prompt_text: null,
        is_active: true,
      })
      .select("id")
      .single();

    if (versionErr || !versionRow) {
      console.error("proof-create: version insert failed:", versionErr);
      // Best-effort cleanup of the orphaned proof row
      await db.from("proof_approvals").delete().eq("id", proofId);
      return jsonResponse(
        {
          error: "Failed to create initial version",
          detail: versionErr?.message,
        },
        500,
      );
    }

    // Phase 8C: insert line items (if any). Failure here rolls back the proof.
    if (hasLineItems) {
      const rows = rawLineItems.map((li, idx) => ({
        proof_id: proofId,
        line_number: idx + 1,
        title: li.title.trim(),
        description: li.description?.trim() || null,
        render_url: li.render_url || null,
        thumbnail_url: li.thumbnail_url || li.render_url || null,
        uploaded_file_paths: Array.isArray(li.uploaded_file_paths)
          ? li.uploaded_file_paths
          : [],
        metadata: (li.metadata && typeof li.metadata === "object") ? li.metadata : {},
      }));
      const { error: liErr } = await db.from("proof_line_items").insert(rows);
      if (liErr) {
        console.error("proof-create: line items insert failed:", liErr);
        await db.from("proof_approvals").delete().eq("id", proofId);
        return jsonResponse(
          { error: "Failed to create line items", detail: liErr.message },
          500,
        );
      }
    }

    // Audit log
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;
    const { error: eventErr } = await db.from("proof_events").insert({
      proof_id: proofId,
      event_type: "created",
      actor_role: "shop",
      actor_user_id: shopId,
      ip,
      user_agent: userAgent,
      payload: {
        mode: body.mode,
        version_id: versionRow.id,
        source: hasLineItems ? "line_items" : hasSource ? "render" : "upload",
        line_item_count: hasLineItems ? rawLineItems.length : 0,
        expires_at: expiresAt,
      },
    });
    if (eventErr) {
      console.warn("proof-create: event log insert failed (non-fatal):", eventErr);
    }

    const baseUrl = getPublicProofBaseUrl();
    // Public client-facing approval page — separate URL namespace from the
    // legacy /proof/:token route, which serves a different schema.
    const viewUrl = `${baseUrl}/approve/${viewToken}`;
    const manageUrl = `${baseUrl}/approve/manage/${manageToken}`;

    return jsonResponse({
      success: true,
      proof_id: proofId,
      version_id: versionRow.id,
      view_token: viewToken,
      manage_token: manageToken,
      view_url: viewUrl,
      manage_url: manageUrl,
      expires_at: expiresAt,
    });
  } catch (err) {
    console.error("proof-create: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error" }, 500);
  }
});
