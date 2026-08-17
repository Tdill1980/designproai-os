/**
 * approvepro-revisions — backend for the A.C.E "ApprovedPro" Revisions
 * dashboard (admin-only, /admin/approve-revisions).
 *
 * One service-role endpoint (RLS-bypassing) so the design team always sees
 * EVERY order that has customer messages / revision requests — even WPW
 * auto-ingested orders whose shop the admin isn't team-linked to (the same
 * RLS gap approvepro-versions works around). Admin/tester role is verified
 * server-side from the caller's JWT before anything runs.
 *
 * Actions:
 *   • list   → every proof that has a customer message or a revision request,
 *              with order meta, the active design (render_urls), version count,
 *              the merged conversation thread, and ACE suggestions distilled
 *              from what the customer actually asked for.
 *   • revise → { proof_id, instruction } surgical AI revision of the active
 *              version (Gemini image-to-image, the SAME runProofRevision the
 *              customer portal uses). Admin action — no customer credit burn.
 *              Saves a new active version + logs the event.
 *   • reply  → { proof_id, body } saves a team reply into proof_messages
 *              (sender_role='team', status='sent') so it persists AND shows in
 *              both this dashboard and the customer's portal thread. Fixes the
 *              "team replies don't save" gap.
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml — auth handled here.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runProofRevision } from "../_shared/proof-ai-revise.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Event types that carry the customer's own words but are NOT mirrored into
// proof_messages — so merging them with proof_messages never double-counts.
const CUSTOMER_EVENT_TYPES = [
  "customer_comment",
  "revision_requested",
  "ai_revise_started",
  "shop_reply",
];

// Events that flag an order as "has a revision request / message" for the list.
const FLAG_EVENT_TYPES = [
  "customer_comment",
  "revision_requested",
  "customer_message",
];

interface ThreadMsg {
  id: string;
  role: "customer" | "team";
  name: string | null;
  body: string;
  at: string;
}

function pickHero(renderUrls: Record<string, string> | null | undefined): string | null {
  if (!renderUrls || typeof renderUrls !== "object") return null;
  return (
    renderUrls.hero ||
    renderUrls.side ||
    renderUrls["driver-side"] ||
    renderUrls.front ||
    renderUrls.roof ||
    Object.values(renderUrls)[0] ||
    null
  );
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Auth: caller must be a signed-in admin or tester ──
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Authentication required" }, 401);
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authErr } = await db.auth.getUser(accessToken);
  if (authErr || !user) return json({ error: "Invalid auth token" }, 401);
  const { data: roleRows } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .in("role", ["admin", "tester"]);
  if (!roleRows || roleRows.length === 0) {
    return json({ error: "Admin or tester role required" }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const action = body?.action || "list";

  try {
    // ────────────────────────────────────────────────────────────────────
    // LIST — orders that have customer messages / revision requests
    // ────────────────────────────────────────────────────────────────────
    if (action === "list") {
      // Proof ids that have at least one stored message.
      const { data: msgIdRows } = await db
        .from("proof_messages")
        .select("proof_id")
        .in("sender_role", ["customer"]);
      // Proof ids flagged by message-bearing events (portal comment / revision).
      const { data: evIdRows } = await db
        .from("proof_events")
        .select("proof_id")
        .in("event_type", FLAG_EVENT_TYPES);

      const proofIds = Array.from(
        new Set([
          ...(msgIdRows || []).map((r: any) => r.proof_id),
          ...(evIdRows || []).map((r: any) => r.proof_id),
        ].filter(Boolean)),
      );
      if (proofIds.length === 0) return json({ success: true, orders: [] });

      const { data: proofs } = await db
        .from("proof_approvals")
        .select(
          "id, customer_name, customer_email, vehicle_year, vehicle_make, vehicle_model, design_name, finish_type, status, mode, view_token, ai_revisions_allowed, ai_revisions_used, metadata, created_at, updated_at",
        )
        .in("id", proofIds);

      // Pull everything we need in bulk, then group by proof.
      const { data: allVersions } = await db
        .from("proof_versions")
        .select("proof_id, version_number, is_active, render_urls, created_at, created_by_role")
        .in("proof_id", proofIds);
      const { data: allMsgs } = await db
        .from("proof_messages")
        .select("id, proof_id, sender_role, sender_name, body, created_at, sent_at, status")
        .in("proof_id", proofIds)
        .eq("status", "sent")
        .in("sender_role", ["customer", "team", "shop"]);
      const { data: allEvents } = await db
        .from("proof_events")
        .select("id, proof_id, event_type, actor_role, payload, created_at")
        .in("proof_id", proofIds)
        .in("event_type", CUSTOMER_EVENT_TYPES);

      const byProof = (rows: any[] | null | undefined, id: string) =>
        (rows || []).filter((r) => r.proof_id === id);

      const orders = (proofs || []).map((p: any) => {
        const versions = byProof(allVersions, p.id).sort(
          (a, b) => (b.version_number || 0) - (a.version_number || 0),
        );
        const active = versions.find((v) => v.is_active) || versions[0] || null;
        const renderUrls = (active?.render_urls as Record<string, string>) || {};

        // Build merged thread (messages + customer events), oldest → newest.
        const fromMsgs: ThreadMsg[] = byProof(allMsgs, p.id).map((r: any) => ({
          id: `m_${r.id}`,
          role: r.sender_role === "customer" ? "customer" : "team",
          name: r.sender_name,
          body: r.body,
          at: r.sent_at || r.created_at,
        }));
        const fromEvents: ThreadMsg[] = byProof(allEvents, p.id)
          .map((e: any) => {
            const pl = e.payload || {};
            const text = pl.message || pl.notes || pl.prompt || "";
            if (!text || String(text).trim().length === 0) return null;
            return {
              id: `e_${e.id}`,
              role: (e.actor_role === "shop" || e.actor_role === "system")
                ? "team"
                : "customer",
              name: null,
              body: String(text),
              at: e.created_at,
            } as ThreadMsg;
          })
          .filter(Boolean) as ThreadMsg[];

        const thread = [...fromMsgs, ...fromEvents].sort(
          (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
        );

        // ACE suggestions = what the customer actually asked for (their words),
        // newest first. The dashboard renders these as the review checklist.
        const suggestions = thread
          .filter((m) => m.role === "customer")
          .slice(-5)
          .reverse()
          .map((m) => ({ id: m.id, text: m.body, at: m.at }));

        const meta = (p.metadata as any) || {};
        return {
          id: p.id,
          customer_name: p.customer_name,
          customer_email: p.customer_email,
          vehicle: [p.vehicle_year, p.vehicle_make, p.vehicle_model].filter(Boolean).join(" "),
          design_name: p.design_name,
          finish_type: p.finish_type,
          status: p.status,
          mode: p.mode,
          view_token: p.view_token,
          wpw_order_number: meta.wpw_order_number || meta.wpw_woo_order_id || null,
          ai_revisions_allowed: p.ai_revisions_allowed,
          ai_revisions_used: p.ai_revisions_used,
          version_count: versions.length,
          active_version_number: active?.version_number || null,
          hero_url: pickHero(renderUrls),
          render_urls: renderUrls,
          unread_customer: thread.filter((m) => m.role === "customer").length,
          last_message_at: thread.length ? thread[thread.length - 1].at : p.created_at,
          thread,
          suggestions,
          created_at: p.created_at,
        };
      });

      // Most recently active conversations first.
      orders.sort(
        (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
      );
      return json({ success: true, orders });
    }

    // ────────────────────────────────────────────────────────────────────
    // REVISE — surgical AI revision of the active version (admin, no credit)
    // ────────────────────────────────────────────────────────────────────
    if (action === "revise") {
      const proofId = body?.proof_id;
      const instruction = String(body?.instruction || "").trim();
      if (!proofId) return json({ error: "proof_id required" }, 400);
      if (instruction.length < 3) {
        return json({ error: "instruction required (min 3 chars)" }, 400);
      }
      if (instruction.length > 500) {
        return json({ error: "instruction too long (max 500 chars)" }, 400);
      }

      const { data: proof } = await db
        .from("proof_approvals")
        .select("id, vehicle_year, vehicle_make, vehicle_model, finish_type")
        .eq("id", proofId)
        .single();
      if (!proof) return json({ error: "Proof not found" }, 404);

      const { data: active } = await db
        .from("proof_versions")
        .select("id, version_number, render_urls, uploaded_file_paths")
        .eq("proof_id", proofId)
        .eq("is_active", true)
        .maybeSingle();
      if (!active) return json({ error: "No active version to revise" }, 409);

      const renderUrls = (active.render_urls as Record<string, string>) || {};
      const originalImageUrl =
        pickHero(renderUrls) ||
        (active.uploaded_file_paths as string[])?.[0] ||
        null;
      if (!originalImageUrl) {
        return json({ error: "Active version has no image to revise" }, 409);
      }

      const vehicleSummary = [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model]
        .filter(Boolean)
        .join(" ");

      const result = await runProofRevision({
        originalImageUrl,
        customerPrompt: instruction,
        vehicleSummary,
        finishType: proof.finish_type || undefined,
      });
      if (!result.ok) {
        return json(
          { error: "AI revision failed", reason: result.reason, detail: result.error },
          502,
        );
      }

      const timestamp = Date.now();
      const newPath = `renders/proof-ai/${proofId}/${timestamp}.png`;
      const { error: upErr } = await db.storage
        .from("wrap-files")
        .upload(newPath, result.pngBytes, { contentType: result.mimeType, upsert: false });
      if (upErr) {
        return json({ error: "Failed to store revised render", detail: upErr.message }, 500);
      }
      const { data: { publicUrl } } = db.storage.from("wrap-files").getPublicUrl(newPath);

      const { data: maxRow } = await db
        .from("proof_versions")
        .select("version_number")
        .eq("proof_id", proofId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVersionNumber = (maxRow?.version_number ?? 0) + 1;

      await db
        .from("proof_versions")
        .update({ is_active: false })
        .eq("proof_id", proofId)
        .eq("is_active", true);

      const { data: newVersion, error: insErr } = await db
        .from("proof_versions")
        .insert({
          proof_id: proofId,
          version_number: nextVersionNumber,
          created_by_role: "shop",
          created_by_user_id: user.id,
          render_urls: { hero: publicUrl },
          uploaded_file_paths: [],
          prompt_text: instruction,
          ai_cost_estimate: 0.15,
          is_active: true,
        })
        .select("id, version_number")
        .single();
      if (insErr || !newVersion) {
        if (active.id) {
          await db.from("proof_versions").update({ is_active: true }).eq("id", active.id);
        }
        return json({ error: "Failed to save new version", detail: insErr?.message }, 500);
      }

      await db.from("proof_events").insert({
        proof_id: proofId,
        event_type: "ai_revise_completed",
        actor_role: "shop",
        actor_user_id: user.id,
        payload: {
          version_id: newVersion.id,
          version_number: newVersion.version_number,
          render_url: publicUrl,
          prompt: instruction,
          source: "approvedpro_dashboard",
        },
      });

      return json({
        success: true,
        version_id: newVersion.id,
        version_number: newVersion.version_number,
        render_url: publicUrl,
      });
    }

    // ────────────────────────────────────────────────────────────────────
    // REPLY — save a team reply (persists + shows in both threads)
    // ────────────────────────────────────────────────────────────────────
    if (action === "reply") {
      const proofId = body?.proof_id;
      const text = String(body?.body || "").trim();
      if (!proofId) return json({ error: "proof_id required" }, 400);
      if (text.length < 1) return json({ error: "Message body required" }, 400);

      const { data: proof } = await db
        .from("proof_approvals")
        .select("id, customer_email")
        .eq("id", proofId)
        .single();
      if (!proof) return json({ error: "Proof not found" }, 404);

      const senderName =
        (user.user_metadata as any)?.shop_name ||
        user.email?.split("@")[0] ||
        "Design team";

      const { data: msg, error: msgErr } = await db
        .from("proof_messages")
        .insert({
          proof_id: proofId,
          sender_role: "team",
          sender_name: senderName,
          body: text.slice(0, 4000),
          status: "sent",
          sent_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (msgErr) return json({ error: "Could not save reply", detail: msgErr.message }, 500);

      await db.from("proof_events").insert({
        proof_id: proofId,
        event_type: "shop_reply",
        actor_role: "shop",
        actor_user_id: user.id,
        payload: { message: text, source: "approvedpro_dashboard" },
      });

      return json({ success: true, message_id: msg.id });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e: any) {
    console.error("approvepro-revisions:", e);
    return json({ error: "Unexpected server error", detail: e?.message }, 500);
  }
});
