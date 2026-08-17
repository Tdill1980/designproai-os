/**
 * seo-gbp-scheduler — schedule GBP posts and dispatch them on a cron tick.
 *
 * Actions:
 *   create   — { shop_id, summary, topic_type?, call_to_action?, media_url?,
 *               scheduled_for } → inserts a pending row
 *   list     — { shop_id, status? } → array of rows for the shop
 *   delete   — { shop_id, id } → cancels (status -> cancelled) or deletes a
 *              row that hasn't been posted yet
 *   run_due  — no auth: iterates pending rows where scheduled_for <= now(),
 *              dispatches each via the GBP API, marks posted/error.
 *              Triggered every 5 minutes by pg_cron.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopMember, assertShopAdmin } from "../_shared/seo/auth.ts";
import { getValidGoogleAccessToken } from "../_shared/seo/google-oauth.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ScheduledRow {
  id: string;
  shop_id: string;
  summary: string;
  topic_type: string;
  call_to_action: { actionType: string; url?: string } | null;
  media_url: string | null;
  scheduled_for: string;
  status: string;
}

function svcClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase env vars not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function dispatchPost(
  service: SupabaseClient,
  row: ScheduledRow,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { access_token, metadata } = await getValidGoogleAccessToken(
      service,
      row.shop_id,
      "google_business_profile",
    );
    const accountName = metadata?.gbp_account as string | undefined;
    const locationName = metadata?.gbp_location as string | undefined;
    if (!accountName || !locationName) {
      return { ok: false, error: "No GBP location selected for this shop" };
    }

    const payload: Record<string, unknown> = {
      languageCode: "en-US",
      summary: row.summary,
      topicType: row.topic_type,
    };
    if (row.call_to_action) payload.callToAction = row.call_to_action;
    if (row.media_url) {
      payload.media = [{ mediaFormat: "PHOTO", sourceUrl: row.media_url }];
    }

    const res = await fetch(
      `https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/localPosts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `GBP ${res.status}: ${txt.slice(0, 400)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch (_) {
      body = {};
    }
    const action = body?.action as string;
    if (!action) return json({ error: "action required" }, 400);

    // ─── run_due: cron-driven, no user JWT ───────────────────────────────
    if (action === "run_due") {
      // Authorize via the service-role bearer that pg_cron sends.
      const authHeader = req.headers.get("Authorization") ?? "";
      const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const provided = authHeader.replace(/^Bearer\s+/i, "");
      if (!expected || provided !== expected) {
        return json({ error: "run_due requires service role" }, 401);
      }
      const service = svcClient();
      const { data: due, error } = await service
        .from("gbp_scheduled_posts")
        .select("id, shop_id, summary, topic_type, call_to_action, media_url, scheduled_for, status")
        .eq("status", "pending")
        .lte("scheduled_for", new Date().toISOString())
        .limit(50);
      if (error) return json({ error: error.message }, 500);
      const rows = (due ?? []) as ScheduledRow[];
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const row of rows) {
        const res = await dispatchPost(service, row);
        if (res.ok) {
          await service
            .from("gbp_scheduled_posts")
            .update({
              status: "posted",
              posted_at: new Date().toISOString(),
              error: null,
            })
            .eq("id", row.id);
          results.push({ id: row.id, ok: true });
        } else {
          await service
            .from("gbp_scheduled_posts")
            .update({ status: "error", error: res.error })
            .eq("id", row.id);
          results.push({ id: row.id, ok: false, error: res.error });
        }
      }
      return json({ ok: true, processed: results.length, results });
    }

    // ─── User-driven actions ─────────────────────────────────────────────
    const ctx = await authenticate(req);
    const shop_id = body?.shop_id as string;
    if (!shop_id) return json({ error: "shop_id required" }, 400);
    await assertShopMember(ctx, shop_id);

    if (action === "list") {
      const status = body?.status as string | undefined;
      let q = ctx.db
        .from("gbp_scheduled_posts")
        .select("*")
        .eq("shop_id", shop_id)
        .order("scheduled_for", { ascending: true });
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, posts: data ?? [] });
    }

    if (action === "create") {
      await assertShopAdmin(ctx, shop_id);
      const summary = body?.summary as string;
      const topic_type = (body?.topic_type as string) ?? "STANDARD";
      const call_to_action = body?.call_to_action as
        | { actionType: string; url?: string }
        | undefined;
      const media_url = body?.media_url as string | undefined;
      const scheduled_for = body?.scheduled_for as string;
      if (!summary || !scheduled_for) {
        return json({ error: "summary + scheduled_for required" }, 400);
      }
      const insertRow = {
        shop_id,
        summary,
        topic_type,
        call_to_action: call_to_action ?? null,
        media_url: media_url ?? null,
        scheduled_for,
        status: "pending",
        created_by: ctx.user.id,
      };
      const { data, error } = await ctx.db
        .from("gbp_scheduled_posts")
        .insert(insertRow)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, post: data });
    }

    if (action === "delete") {
      await assertShopAdmin(ctx, shop_id);
      const id = body?.id as string;
      if (!id) return json({ error: "id required" }, 400);
      // If still pending, mark cancelled (preserve audit trail). Otherwise hard-delete.
      const { data: existing } = await ctx.db
        .from("gbp_scheduled_posts")
        .select("status")
        .eq("id", id)
        .eq("shop_id", shop_id)
        .maybeSingle();
      if (!existing) return json({ error: "Not found" }, 404);
      if (existing.status === "pending") {
        const { error } = await ctx.db
          .from("gbp_scheduled_posts")
          .update({ status: "cancelled" })
          .eq("id", id)
          .eq("shop_id", shop_id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, cancelled: true });
      }
      const { error } = await ctx.db
        .from("gbp_scheduled_posts")
        .delete()
        .eq("id", id)
        .eq("shop_id", shop_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, deleted: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-gbp-scheduler] error", msg);
    return json({ error: msg }, 500);
  }
});
