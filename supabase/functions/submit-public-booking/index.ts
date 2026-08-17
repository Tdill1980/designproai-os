// ──────────────────────────────────────────────────────────────────────
// submit-public-booking
//
// Public endpoint (anon-allowed) for the booking calendar on
// /quote/:shopSlug. Buyer picks a service + date + time, fills contact
// info, optionally has a quote already submitted. We:
//
//   1. Look up shop by slug.
//   2. Look up the chosen service in service_catalog.
//   3. Verify the slot is free (no existing booking overlaps on that
//      shop_id at that scheduled_at).
//   4. Insert into customer_bookings with status='pending'.
//   5. Optionally link to an existing customer_quotes row via quoteId.
//
// Returns: { ok, bookingId, scheduledAt, serviceName }.
// ──────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface BookingBody {
  shopSlug?: string;
  serviceSlug?: string;
  scheduledAt?: string; // ISO timestamp
  customer?: { name?: string; email?: string; phone?: string };
  vehicle?: { year?: string; make?: string; model?: string };
  notes?: string;
  quoteId?: string;
  attachmentUrls?: string[];
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

  let body: BookingBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid json" });
  }

  if (!body.serviceSlug) return json(400, { ok: false, error: "serviceSlug required" });
  if (!body.scheduledAt) return json(400, { ok: false, error: "scheduledAt required" });

  const scheduledAt = new Date(body.scheduledAt);
  if (isNaN(scheduledAt.getTime())) return json(400, { ok: false, error: "invalid scheduledAt" });
  if (scheduledAt.getTime() < Date.now() - 60_000) {
    return json(400, { ok: false, error: "scheduledAt is in the past" });
  }

  const sb = svc();
  const slug = (body.shopSlug || "wpw").toLowerCase().trim();

  const { data: shop, error: shopErr } = await sb
    .from("shops")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();

  if (shopErr || !shop) {
    return json(404, { ok: false, error: `shop "${slug}" not found` });
  }

  const { data: service, error: svcErr } = await sb
    .from("service_catalog")
    .select("slug, name, base_price, duration_minutes, is_active")
    .eq("shop_id", shop.id)
    .eq("slug", body.serviceSlug)
    .maybeSingle();

  if (svcErr || !service || !service.is_active) {
    return json(404, { ok: false, error: `service "${body.serviceSlug}" not offered by ${shop.name}` });
  }

  // Conflict check — block double-booking the same exact start time.
  // (A more thorough overlap check would compare scheduled_at + duration; this
  // first cut catches the common case of two buyers grabbing the same slot.)
  const { data: existing } = await sb
    .from("customer_bookings")
    .select("id")
    .eq("shop_id", shop.id)
    .eq("scheduled_at", scheduledAt.toISOString())
    .neq("status", "declined")
    .neq("status", "cancelled")
    .maybeSingle();

  if (existing) {
    return json(409, { ok: false, error: "that slot was just taken — please pick another" });
  }

  const insertRow = {
    shop_id: shop.id,
    quote_id: body.quoteId || null,
    service_slug: service.slug,
    service_name: service.name,
    customer_name: body.customer?.name || null,
    customer_email: body.customer?.email || null,
    customer_phone: body.customer?.phone || null,
    vehicle_year: body.vehicle?.year || null,
    vehicle_make: body.vehicle?.make || null,
    vehicle_model: body.vehicle?.model || null,
    scheduled_at: scheduledAt.toISOString(),
    duration_minutes: service.duration_minutes,
    base_price: service.base_price,
    status: "pending",
    notes: body.notes || null,
    attachment_urls: body.attachmentUrls?.length ? body.attachmentUrls : [],
  };

  const { data: booking, error: insErr } = await sb
    .from("customer_bookings")
    .insert(insertRow)
    .select("id, scheduled_at, service_name")
    .single();

  if (insErr || !booking) {
    console.error("[submit-public-booking] insert failed:", insErr?.message);
    return json(500, { ok: false, error: insErr?.message || "insert failed" });
  }

  // Mirror into the leads CMS so bookings show up in the lead-management
  // funnel with source='public-booking:<slug>' for filterable separation.
  await sb.from("leads").insert({
    shop_id: shop.id,
    caller_name: body.customer?.name || null,
    caller_phone: body.customer?.phone || body.customer?.email || "public-booking",
    vehicle_year: body.vehicle?.year || null,
    vehicle_make: body.vehicle?.make || null,
    vehicle_model: body.vehicle?.model || null,
    service_requested: `Booking: ${service.name}`,
    source: `public-booking:${slug}`,
    status: "new",
    quote_id: body.quoteId || null,
    metadata: {
      shop_slug: slug,
      booking_id: booking.id,
      service_slug: service.slug,
      scheduled_at: booking.scheduled_at,
      duration_minutes: service.duration_minutes,
      base_price: service.base_price,
      customer_email: body.customer?.email || null,
      notes: body.notes || null,
    },
  }).catch((e) => console.warn("[submit-public-booking] leads insert failed:", e?.message));

  console.log(`[submit-public-booking] OK booking ${booking.id} for ${shop.name} — ${service.name} @ ${booking.scheduled_at}`);

  return json(200, {
    ok: true,
    bookingId: booking.id,
    scheduledAt: booking.scheduled_at,
    serviceName: booking.service_name,
    shopName: shop.name,
  });
});
