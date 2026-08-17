/**
 * content-intake — unified front door INTO the content deployment loop.
 *
 * External producers (WrapCommandAI's video factory via its
 * sync-draft-to-restylepro bridge, future generators) POST finished content
 * here; it lands in agent_social_posts where the existing review/calendar UI
 * and the content-deploy cron take over. This keeps ONE deployment pipeline —
 * producers feed it, they never publish on their own.
 *
 * Request (POST JSON):
 * {
 *   "brand":          "restylepro" | "weprintwraps"   (default restylepro)
 *   "platform":       "instagram" | "facebook"         (required)
 *   "post_type":      "static" | "feed" | "reel" | "video"  (default static)
 *   "caption":        string,
 *   "hashtags":       string[],
 *   "media_urls":     string[],   // public URLs (storage / Mux mp4)
 *   "scheduled_date": ISO timestamp | null,
 *   "status":         "draft" | "needs_review" | "scheduled"
 *                     (default: "needs_review" → the Content Director queue,
 *                      with scheduled_date as the proposed slot. Explicit
 *                      "scheduled" bypasses the Director and must be a
 *                      deliberate caller choice — the default never publishes
 *                      without human approval.)
 *   "source":         string      // e.g. "wrapcommandai:content_drafts:<id>"
 * }
 *
 * Auth: x-intake-secret header must equal the CONTENT_INTAKE_SECRET function
 * secret, OR the bearer token must be the service role key. Set the SAME
 * secret value in WrapCommandAI as RESTYLEPRO_INTAKE_SECRET.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createExternalClient, getExternalServiceRoleKey } from "../_shared/external-db.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUPPORTED_PLATFORMS = ["instagram", "facebook"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const intakeSecret = Deno.env.get("CONTENT_INTAKE_SECRET");
    const providedSecret = req.headers.get("x-intake-secret");
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const authorized =
      (intakeSecret && providedSecret === intakeSecret) ||
      (bearer && bearer === getExternalServiceRoleKey());
    if (!authorized) {
      return json({ error: "content-intake requires x-intake-secret or the service role key" }, 401);
    }

    const body = await req.json();
    const platform = (body.platform || "").toLowerCase();
    if (!SUPPORTED_PLATFORMS.includes(platform)) {
      return json({ error: `platform must be one of: ${SUPPORTED_PLATFORMS.join(", ")}` }, 400);
    }
    if (!body.caption && !body.media_urls?.length) {
      return json({ error: "caption or media_urls required — nothing to post" }, 400);
    }

    // Content Director is the gate: unless the caller explicitly asks for
    // "scheduled" (or "draft"), incoming content queues for human approval
    // with scheduled_date as its proposed slot.
    const status = body.status === "draft" || body.status === "scheduled" || body.status === "needs_review"
      ? body.status
      : "needs_review";

    const db = createExternalClient();
    const { data, error } = await db
      .from("agent_social_posts")
      .insert({
        brand: body.brand || "restylepro",
        platform,
        post_type: body.post_type || "static",
        caption: body.caption || null,
        hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
        media_urls: Array.isArray(body.media_urls) ? body.media_urls : [],
        status,
        scheduled_date: body.scheduled_date || null,
        created_by: body.source || "content-intake",
      })
      .select("id, status")
      .single();
    if (error) return json({ error: error.message }, 500);

    console.log(`[content-intake] accepted ${data.id} (${platform}/${body.post_type || "static"}, status=${data.status}, source=${body.source || "?"})`);
    return json({ ok: true, post_id: data.id, status: data.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[content-intake] error", msg);
    return json({ error: msg }, 500);
  }
});
