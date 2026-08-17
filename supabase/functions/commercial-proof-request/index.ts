// ──────────────────────────────────────────────────────────────────────
// commercial-proof-request
//
// Public endpoint (anon-allowed) behind the CommercialPro page's
// "Request 3D Proof" button — the free-proof lead capture. The proof
// itself is produced by the design team through the EXISTING ApprovePro
// machinery (concierge model): every request is a hot commercial lead
// worth minutes of human time, and human QC protects the first
// impression with fleet buyers. This function only has to make the
// request impossible to lose:
//
//   1. leads row (source 'commercialpro-proof') — shows up in the same
//      lead funnel as voicemail + quote leads.
//   2. Klaviyo "Proof Requested" event — enters the commercial email
//      sequence and gives Meta a conversion to optimize on (the page
//      fires fbq('track','Lead') client-side on success).
//
// POST { name?, email, phone?, company?, vehicle?: {year,make,model},
//        logoUrl?, notes?, source? }
// Response: { ok: true, leadId } | { ok: false, error }
// ──────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { klaviyoTrack } from "../_shared/klaviyo-track.ts";

interface ProofRequestBody {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  vehicle?: { year?: string; make?: string; model?: string };
  logoUrl?: string;
  notes?: string;
  source?: string;
}

function svc() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
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

  let body: ProofRequestBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid json" });
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email.includes("@")) return json(400, { ok: false, error: "email required" });

  const sb = svc();
  // NOTE: there is no shop with slug "wpw" — the live WPW shop (the one the
  // WordPress tenant connection points at) is "we-print-wraps". Try the known
  // aliases in preference order so a slug rename can't silently kill leads.
  const { data: shops } = await sb
    .from("shops")
    .select("id, name, slug")
    .in("slug", ["we-print-wraps", "weprintwraps", "wpw"]);
  const shop = shops?.find((s) => s.slug === "we-print-wraps") ?? shops?.[0];
  if (!shop) return json(500, { ok: false, error: "WPW shop not found" });

  const vehicle = [body.vehicle?.year, body.vehicle?.make, body.vehicle?.model]
    .filter(Boolean)
    .join(" ");

  const { data: lead, error: insErr } = await sb
    .from("leads")
    .insert({
      shop_id: shop.id,
      caller_name: body.name || body.company || null,
      // caller_phone is NOT NULL on leads (same fallback submit-public-quote uses)
      caller_phone: body.phone || email,
      vehicle_year: body.vehicle?.year || null,
      vehicle_make: body.vehicle?.make || null,
      vehicle_model: body.vehicle?.model || null,
      service_requested: "Free 3D commercial proof (CommercialPro)",
      source: body.source || "commercialpro-proof",
      status: "new",
      metadata: {
        customer_email: email,
        company: body.company || null,
        logo_url: body.logoUrl || null,
        notes: body.notes || null,
      },
    })
    .select("id")
    .single();

  if (insErr || !lead) {
    console.error("[commercial-proof-request] insert failed:", insErr?.message);
    return json(500, { ok: false, error: insErr?.message || "insert failed" });
  }

  // Monitor + sequence entry. Fire-and-forget — never blocks the lead save.
  klaviyoTrack({
    metric: "Proof Requested",
    email,
    name: body.name || undefined,
    phone: body.phone || undefined,
    uniqueId: `proof-requested-${lead.id}`,
    properties: {
      lead_id: lead.id,
      company: body.company || "",
      vehicle,
      logo_url: body.logoUrl || "",
      source: body.source || "commercialpro-proof",
    },
  }).catch(() => {});

  console.log(`[commercial-proof-request] OK lead ${lead.id} — ${vehicle || "no vehicle"} (${email})`);
  return json(200, { ok: true, leadId: lead.id });
});
