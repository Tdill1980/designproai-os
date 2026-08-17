// ──────────────────────────────────────────────────────────────────────
// klaviyo-bulk-import-customers
//
// One-shot bulk import of all WPW past customers + quote-tool users from
// public.email_subscribers into a Klaviyo list, using Klaviyo's
// Bulk Profile Import API (POST /api/profile-bulk-import-jobs/).
//
// Body: { listId: string, dryRun?: boolean, sources?: string[] }
//   listId — Klaviyo list ID to subscribe profiles to
//   dryRun — if true, report counts without calling Klaviyo
//   sources — array of email_subscribers.source values to include
//             (defaults to ['wpw_past_customer','quote_tool_customer','quotetool'])
//
// Admin-only. Returns the Klaviyo bulk-import job ID.
// ──────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const KLAVIYO_REVISION = "2024-10-15";

function createServiceClient() {
  const url = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

async function authedAdmin(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return null;
  const admin = createServiceClient();
  const { data: role } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", u.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!role) return null;
  return { id: u.user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = await authedAdmin(req);
    if (!admin) {
      return new Response(JSON.stringify({ ok: false, error: "admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const klaviyoKey = Deno.env.get("KLAVIYO_API_KEY");
    if (!klaviyoKey) {
      return new Response(JSON.stringify({ ok: false, error: "KLAVIYO_API_KEY not set" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({})) as {
      listId?: string;
      dryRun?: boolean;
      sources?: string[];
    };
    if (!body.listId) {
      return new Response(JSON.stringify({ ok: false, error: "listId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sources = body.sources && body.sources.length
      ? body.sources
      : ["wpw_past_customer", "quote_tool_customer", "quotetool"];

    // 1. Pull all eligible email_subscribers rows.
    const db = createServiceClient();
    const { data: subs, error: subErr } = await db
      .from("email_subscribers")
      .select("email, first_name, phone, source")
      .in("source", sources)
      .or("unsubscribed.is.null,unsubscribed.eq.false")
      .not("email", "is", null);

    if (subErr) {
      return new Response(JSON.stringify({ ok: false, error: subErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleaned = (subs || [])
      .map((r) => ({
        email: String(r.email || "").trim().toLowerCase(),
        first_name: r.first_name || null,
        phone: r.phone || null,
        source: r.source || "",
      }))
      .filter((r) => r.email.includes("@") && r.email.length > 3);

    // Dedupe by email
    const seen = new Set<string>();
    const profiles = cleaned.filter((r) => {
      if (seen.has(r.email)) return false;
      seen.add(r.email);
      return true;
    });

    if (body.dryRun) {
      return new Response(
        JSON.stringify({
          ok: true,
          dryRun: true,
          count: profiles.length,
          sample: profiles.slice(0, 5).map((p) => p.email),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Build Klaviyo bulk-import payload.
    // Max 10,000 profiles per job.
    const BATCH_SIZE = 10000;
    const batches: typeof profiles[] = [];
    for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
      batches.push(profiles.slice(i, i + BATCH_SIZE));
    }

    const jobs: { jobId: string; profileCount: number }[] = [];

    for (const batch of batches) {
      const payload = {
        data: {
          type: "profile-bulk-import-job",
          attributes: {
            profiles: {
              data: batch.map((p) => ({
                type: "profile",
                attributes: {
                  email: p.email,
                  first_name: p.first_name || undefined,
                  phone_number: p.phone || undefined,
                  properties: { source: p.source },
                },
              })),
            },
          },
          relationships: {
            lists: {
              data: [{ type: "list", id: body.listId }],
            },
          },
        },
      };

      const res = await fetch("https://a.klaviyo.com/api/profile-bulk-import-jobs/", {
        method: "POST",
        headers: {
          Authorization: `Klaviyo-API-Key ${klaviyoKey}`,
          "Content-Type": "application/json",
          accept: "application/json",
          revision: KLAVIYO_REVISION,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        return new Response(
          JSON.stringify({
            ok: false,
            error: `Klaviyo bulk-import failed (${res.status})`,
            details: text.slice(0, 1000),
            partial: jobs,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const data = await res.json();
      jobs.push({ jobId: data?.data?.id || "(unknown)", profileCount: batch.length });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        totalProfiles: profiles.length,
        jobs,
        listId: body.listId,
        message: `Submitted ${profiles.length} profiles to Klaviyo bulk import. Jobs run async — check the list in Klaviyo in 1–5 min for the populated count.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[klaviyo-bulk-import-customers] error", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
