// ──────────────────────────────────────────────────────────────────────
// wpw-customers-import
//
// Pulls the full WePrintWraps customer list from the Woo REST API and
// upserts each into public.email_subscribers so the MightyMail launch
// campaign can target them. Replaces the Klaviyo dependency.
//
// Body (all optional):
//   { dryRun?: boolean,         // default false — count only, no writes
//     perPage?: number,         // default 100 (Woo max)
//     maxPages?: number,        // default 200 (= up to 20k customers)
//     startPage?: number }      // default 1 — resume from a given page
//
// Returns:
//   { ok, dryRun, fetched, written, skipped_no_email, skipped_unsubscribed,
//     pages_processed, last_page_size, sample: [{email, first_name}, ...] }
//
// Admin-only — caller must have user_roles.role='admin'.
// ──────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { WooCustomer, wooFetch } from "../_shared/woo-client.ts";

function createServiceClient() {
  const url = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

async function authedAdmin(req: Request): Promise<{ id: string; email: string | null } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sb = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
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
  return { id: u.user.id, email: u.user.email || null };
}

interface WooCustomerExt extends WooCustomer {
  total_spent?: string;
  orders_count?: number;
  meta_data?: { key: string; value: unknown }[];
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

    const body = await req.json().catch(() => ({})) as {
      dryRun?: boolean;
      perPage?: number;
      maxPages?: number;
      startPage?: number;
    };
    const dryRun = body.dryRun ?? false;
    const perPage = Math.min(Math.max(body.perPage ?? 100, 1), 100);
    const maxPages = Math.min(Math.max(body.maxPages ?? 200, 1), 500);
    const startPage = Math.max(body.startPage ?? 1, 1);

    const sb = createServiceClient();

    let fetched = 0;
    let written = 0;
    let skippedNoEmail = 0;
    let skippedUnsubscribed = 0;
    let pagesProcessed = 0;
    let lastPageSize = 0;
    const sample: { email: string; first_name: string | null }[] = [];

    for (let page = startPage; page < startPage + maxPages; page++) {
      const customers = await wooFetch<WooCustomerExt[]>(
        `/customers?per_page=${perPage}&page=${page}&orderby=registered_date&order=asc`,
      );
      if (!Array.isArray(customers) || customers.length === 0) {
        lastPageSize = 0;
        break;
      }
      pagesProcessed++;
      lastPageSize = customers.length;
      fetched += customers.length;

      const rows: Record<string, unknown>[] = [];
      for (const c of customers) {
        const email = (c.email || "").trim().toLowerCase();
        if (!email || !email.includes("@")) {
          skippedNoEmail++;
          continue;
        }
        if (sample.length < 5) sample.push({ email, first_name: c.first_name || null });
        rows.push({
          email,
          first_name: c.first_name || null,
          source: "wpw_past_customer",
          metadata: {
            woo_customer_id: c.id,
            last_name: c.last_name || null,
            company: c.billing?.company || null,
            phone: c.billing?.phone || null,
            city: c.billing?.city || null,
            state: c.billing?.state || null,
            country: c.billing?.country || null,
            total_spent: c.total_spent || null,
            orders_count: c.orders_count ?? null,
            registered_at: c.date_created || null,
          },
        });
      }

      if (!dryRun && rows.length > 0) {
        // Don't clobber existing unsubscribed=true rows. Pre-check those
        // emails and exclude from the upsert.
        const emails = rows.map((r) => r.email as string);
        const { data: optedOut } = await sb
          .from("email_subscribers")
          .select("email")
          .in("email", emails)
          .eq("unsubscribed", true);
        const optedOutSet = new Set((optedOut || []).map((r: { email: string }) => r.email));
        const safeRows = rows.filter((r) => {
          if (optedOutSet.has(r.email as string)) {
            skippedUnsubscribed++;
            return false;
          }
          return true;
        });

        if (safeRows.length > 0) {
          const { error } = await sb
            .from("email_subscribers")
            .upsert(safeRows, { onConflict: "email" });
          if (error) {
            console.error("[wpw-customers-import] upsert error", error.message);
            throw error;
          }
          written += safeRows.length;
        }
      }

      if (customers.length < perPage) break; // last page
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dryRun,
        fetched,
        written,
        skipped_no_email: skippedNoEmail,
        skipped_unsubscribed: skippedUnsubscribed,
        pages_processed: pagesProcessed,
        last_page_size: lastPageSize,
        sample,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[wpw-customers-import] error", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
