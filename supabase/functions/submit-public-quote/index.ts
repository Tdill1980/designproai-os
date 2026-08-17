// ──────────────────────────────────────────────────────────────────────
// submit-public-quote
//
// Public endpoint (anon-allowed) that accepts a quote submission from the
// homepage QuickQuote tool or a sub-account branded quote page and writes
// it to public.customer_quotes under the shop identified by `shopSlug`.
//
// Why an edge function:
//   - public.customer_quotes RLS requires shop_id IN user_shop_profile_ids,
//     so anonymous browser clients cannot insert directly.
//   - The frontend cannot hold a service-role key.
//   - Sub-accounts need their own URL (?shop=<slug> or /quote/:slug) so
//     submissions land tagged to the right tenant.
//
// Insert path:
//   1. Look up shops row by slug (defaults to "wpw" if omitted).
//   2. Insert customer_quotes row — user_id is set to shop.owner_user_id
//      so the existing NOT NULL constraint is satisfied without forcing
//      end-customers to authenticate.
//   3. Insert a quote_events 'public_quote_submitted' marker for analytics.
//
// Request:
//   POST /submit-public-quote
//   { shopSlug?: string, quoteNumber: string, customer: {...},
//     vehicle: {...}, pricing: {...}, finish?, colorName?, manufacturer?,
//     renderUrl?, visualizationId?, lineItems?, toolSource? }
//
// Response: { ok: true, quoteId, shopId } | { ok: false, error }
// ──────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { klaviyoTrack } from "../_shared/klaviyo-track.ts";

interface SubmitBody {
  shopSlug?: string;
  quoteNumber?: string;
  /**
   * Fire the "Quote Requested" Klaviyo event ONLY — no row is written.
   *
   * The authenticated quote path (src/lib/quickquote-db.ts saveQuote) inserts
   * into `quotes` straight from the browser, which cannot hold the Klaviyo
   * private key. Before this mode, that path — the one carrying essentially
   * all real quote volume — was completely untracked, while the anonymous
   * fallback below was the only instrumented branch. This reuses the existing
   * function rather than adding a new one (the project is at the edge-function
   * cap).
   */
  trackOnly?: boolean;
  quoteId?: string;
  /**
   * Event value for trackOnly. Deliberately NOT `pricing.quoteTotal`: a
   * trackOnly caller must never carry a payload the PREVIOUS deployment would
   * accept as a real submission. The frontend (Vercel) and this function
   * (Supabase) deploy independently, so the browser can call trackOnly before
   * this code is live. Omitting `pricing` makes the old build fail its own
   * "pricing.quoteTotal required" guard and insert nothing, instead of writing
   * a duplicate customer_quotes + leads + quote_events row for a quote that
   * was already saved. Safe in either deploy order.
   */
  trackValue?: number;
  customer?: { name?: string; email?: string; phone?: string };
  vehicle?: { year?: string; make?: string; model?: string };
  finish?: string;
  colorName?: string;
  manufacturer?: string;
  renderUrl?: string | null;
  visualizationId?: string | null;
  toolSource?: string;
  pricing?: {
    quoteTotal?: number;
    filmTotal?: number;
    laborTotal?: number;
    totalSqft?: number;
    filmCostPerSqft?: number;
    laborRatePerSqft?: number;
  };
  lineItems?: Array<{ label: string; detail?: string; amount: number }>;
}

function svc() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

  let body: SubmitBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid json" });
  }

  // Track-only: mirror an already-persisted quote into Klaviyo. No insert, so
  // the vehicle/pricing validation below (which guards the write) doesn't apply.
  if (body.trackOnly) {
    const email = body.customer?.email?.trim();
    if (!email) return json(400, { ok: false, error: "customer.email required for trackOnly" });
    const tracked = await klaviyoTrack({
      metric: "Quote Requested",
      email,
      name: body.customer?.name || undefined,
      phone: body.customer?.phone || undefined,
      value: body.trackValue ?? 0,
      // Same key shape as the anonymous branch, so a quote can never be
      // double-counted if it somehow travels both paths.
      uniqueId: body.quoteId ? `quote-requested-${body.quoteId}` : undefined,
      properties: {
        quote_id: body.quoteId || "",
        quote_number: body.quoteNumber || "",
        vehicle: [body.vehicle?.year, body.vehicle?.make, body.vehicle?.model].filter(Boolean).join(" "),
        finish: body.finish || "",
        color_name: body.colorName || "",
        tool_source: body.toolSource || "quote tool",
        path: "authenticated",
      },
    });
    return json(200, { ok: true, tracked });
  }

  if (!body.vehicle?.make || !body.vehicle?.model) {
    return json(400, { ok: false, error: "vehicle.make and vehicle.model required" });
  }
  if (!body.pricing?.quoteTotal || body.pricing.quoteTotal <= 0) {
    return json(400, { ok: false, error: "pricing.quoteTotal required" });
  }

  const sb = svc();
  const slug = (body.shopSlug || "wpw").toLowerCase().trim();

  const { data: shop, error: shopErr } = await sb
    .from("shops")
    .select("id, owner_user_id, name, slug")
    .eq("slug", slug)
    .maybeSingle();

  if (shopErr || !shop) {
    console.warn(`[submit-public-quote] shop slug "${slug}" not found`, shopErr?.message);
    return json(404, { ok: false, error: `shop "${slug}" not found` });
  }

  const insertRow = {
    shop_id: shop.id,
    user_id: shop.owner_user_id,
    customer_name: body.customer?.name || null,
    customer_email: body.customer?.email || null,
    customer_phone: body.customer?.phone || null,
    vehicle_year: body.vehicle.year || null,
    vehicle_make: body.vehicle.make,
    vehicle_model: body.vehicle.model,
    film_manufacturer: body.manufacturer || null,
    film_finish: body.finish || null,
    film_name: body.colorName || null,
    render_url: body.renderUrl || null,
    visualization_id: body.visualizationId || null,
    quote_total: body.pricing.quoteTotal,
    film_total: body.pricing.filmTotal ?? 0,
    labor_total: body.pricing.laborTotal ?? 0,
    total_sqft: body.pricing.totalSqft ?? 0,
    film_cost_per_sqft: body.pricing.filmCostPerSqft ?? 0,
    labor_rate_per_sqft: body.pricing.laborRatePerSqft ?? 0,
    status: "new",
    notes: body.quoteNumber
      ? `Public quote ${body.quoteNumber} via ${body.toolSource || "homepage tool"}`
      : `Public quote via ${body.toolSource || "homepage tool"}`,
  };

  // SOCIALIQ ATTRIBUTION (docs/SOCIALIQ_SPEC.md): if this email was captured
  // from social, stamp WHICH post sent them, at quote time — so the funnel
  // reads DM/comment → quote → job even if they never order.
  // Non-fatal by construction: a lookup failure leaves lead_source null and
  // the quote is submitted exactly as before.
  try {
    const qEmail = (body.customer?.email || "").trim().toLowerCase();
    if (qEmail) {
      const { data: identity } = await sb
        .from("social_identities")
        .select("platform, source_post_id")
        .eq("email", qEmail)
        .maybeSingle();
      if (identity) {
        (insertRow as Record<string, unknown>).lead_source =
          `social:${identity.platform || "unknown"}:${identity.source_post_id || "direct"}`;
      }
    }
  } catch (e) {
    console.warn("[submit-public-quote] social attribution lookup failed (non-fatal):", e);
  }

  const { data: inserted, error: insErr } = await sb
    .from("customer_quotes")
    .insert(insertRow)
    .select("id")
    .single();

  if (insErr || !inserted) {
    console.error("[submit-public-quote] insert failed:", insErr?.message);
    return json(500, { ok: false, error: insErr?.message || "insert failed" });
  }

  // Best-effort analytics marker — don't fail the request if this fails.
  await sb.from("quote_events").insert({
    event_type: "public_quote_submitted",
    quote_id: inserted.id,
    product_type: body.toolSource || "QuickQuote",
    source: "submit-public-quote",
    metadata: {
      shop_slug: slug,
      shop_id: shop.id,
      quote_number: body.quoteNumber || null,
      quote_total: body.pricing.quoteTotal,
      customer_email: body.customer?.email || null,
      line_items: body.lineItems || [],
    },
  }).catch((e) => console.warn("[submit-public-quote] quote_events insert failed:", e?.message));

  // Mirror into the leads CMS so every public quote shows up in the
  // lead-management funnel alongside Twilio voicemail leads, manual
  // entries, etc. caller_phone is NOT NULL on leads, so we fall back
  // to email or a placeholder so the insert always succeeds.
  await sb.from("leads").insert({
    shop_id: shop.id,
    caller_name: body.customer?.name || null,
    caller_phone: body.customer?.phone || body.customer?.email || "public-quote",
    vehicle_year: body.vehicle.year || null,
    vehicle_make: body.vehicle.make,
    vehicle_model: body.vehicle.model,
    service_requested: body.toolSource
      ? `Quote: ${body.toolSource}${body.colorName ? ` — ${body.colorName}` : ""}`
      : "Public quote",
    source: `public-quote:${slug}`,
    status: "new",
    quote_id: inserted.id,
    metadata: {
      shop_slug: slug,
      quote_number: body.quoteNumber || null,
      quote_total: body.pricing.quoteTotal,
      customer_email: body.customer?.email || null,
      tool_source: body.toolSource || null,
      finish: body.finish || null,
      manufacturer: body.manufacturer || null,
    },
  }).catch((e) => console.warn("[submit-public-quote] leads insert failed:", e?.message));

  // Monitor: land the quote request on the customer's Klaviyo profile so all
  // quote activity is quantified in one place. Fire-and-forget — never blocks.
  if (body.customer?.email) {
    klaviyoTrack({
      metric: "Quote Requested",
      email: body.customer.email,
      name: body.customer.name || undefined,
      phone: body.customer.phone || undefined,
      value: body.pricing.quoteTotal ?? 0,
      uniqueId: `quote-requested-${inserted.id}`,
      properties: {
        quote_id: inserted.id,
        quote_number: body.quoteNumber || "",
        shop_name: shop.name,
        vehicle: [body.vehicle.year, body.vehicle.make, body.vehicle.model].filter(Boolean).join(" "),
        finish: body.finish || "",
        color_name: body.colorName || "",
        tool_source: body.toolSource || "homepage tool",
      },
    }).catch(() => {});
  }

  console.log(`[submit-public-quote] OK quote ${inserted.id} for shop ${shop.name} (${slug}) — $${body.pricing.quoteTotal}`);

  return json(200, {
    ok: true,
    quoteId: inserted.id,
    shopId: shop.id,
    shopName: shop.name,
  });
});
