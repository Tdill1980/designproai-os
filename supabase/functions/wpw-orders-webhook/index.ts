// ──────────────────────────────────────────────────────────────────────
// wpw-orders-webhook
//
// Receives order.created / order.updated / order.completed webhooks
// from weprintwraps.com WooCommerce and upserts them into wpw_orders +
// wpw_order_items.
//
// Security: if WOO_WEBHOOK_SECRET is set, we verify the incoming
// X-WC-Webhook-Signature header (HMAC-SHA256, base64) against the raw
// body. If the env var is missing we accept all (dev mode only).
//
// Part of Phase 1 — WPW PrintPro Gateway.
// See docs/OPERATION-EXPAND-THE-WRAP-INDUSTRY.md
// ──────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { mintProofToken } from "../_shared/proof-tokens.ts";
import { isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { klaviyoTrack } from "../_shared/klaviyo-track.ts";
import {
  extractTracking,
  WooLineItem,
  WooOrder,
  wooOrderPayUrl,
} from "../_shared/woo-client.ts";

function createServiceClient() {
  const url = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  const secret = Deno.env.get("WOO_WEBHOOK_SECRET");
  if (!secret) {
    // Dev mode — no secret configured, accept
    console.warn("[wpw-orders-webhook] WOO_WEBHOOK_SECRET not set — skipping verification");
    return true;
  }
  if (!signature) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

  // Constant-time compare
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

async function linkUserIdForCustomer(
  sb: ReturnType<typeof createServiceClient>,
  wooCustomerId: number,
): Promise<string | null> {
  if (!wooCustomerId) return null;
  const { data } = await sb
    .from("user_subscriptions")
    .select("user_id")
    .eq("woo_customer_id", wooCustomerId)
    .limit(1)
    .maybeSingle();
  return (data?.user_id as string) || null;
}

function normalizeOrder(o: WooOrder, userId: string | null) {
  const tracking = extractTracking(o);
  return {
    id: o.id,
    woo_customer_id: o.customer_id,
    user_id: userId,
    order_number: o.number,
    status: o.status,
    currency: o.currency,
    total: parseFloat(o.total || "0") || 0,
    subtotal: o.subtotal ? parseFloat(o.subtotal) : null,
    shipping_total: parseFloat(o.shipping_total || "0") || 0,
    tax_total: parseFloat(o.total_tax || "0") || 0,
    payment_method: o.payment_method_title || o.payment_method || null,
    date_created: o.date_created_gmt ? `${o.date_created_gmt}Z` : o.date_created || null,
    date_modified: o.date_modified_gmt ? `${o.date_modified_gmt}Z` : o.date_modified || null,
    date_completed: o.date_completed || null,
    customer_email: o.billing?.email || null,
    customer_name:
      [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(" ") || null,
    billing: o.billing || null,
    shipping: o.shipping || null,
    tracking_number: tracking.number,
    tracking_carrier: tracking.carrier,
    tracking_url: tracking.url,
    order_key: o.order_key || null,
    pay_url: wooOrderPayUrl(o),
    raw: o,
    fetched_at: new Date().toISOString(),
  };
}

function normalizeLineItems(orderId: number, items: WooLineItem[]) {
  return items.map((it) => ({
    id: it.id,
    order_id: orderId,
    product_id: it.product_id || null,
    variation_id: it.variation_id || null,
    name: it.name || null,
    sku: it.sku || null,
    quantity: it.quantity,
    subtotal: parseFloat(it.subtotal || "0") || 0,
    total: parseFloat(it.total || "0") || 0,
    meta: it.meta_data || null,
    image_url: it.image?.src || null,
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Woo only sends POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const topic = req.headers.get("x-wc-webhook-topic");
  const signature = req.headers.get("x-wc-webhook-signature");
  const resource = req.headers.get("x-wc-webhook-resource");
  const event = req.headers.get("x-wc-webhook-event");

  const sb = createServiceClient();

  // Log first (even if we later reject) so we have a trail
  let parsed: WooOrder | null = null;
  try {
    parsed = JSON.parse(rawBody) as WooOrder;
  } catch {
    parsed = null;
  }

  const sigValid = await verifySignature(rawBody, signature);

  try {
    await sb.from("wpw_webhook_log").insert({
      topic: topic || (resource && event ? `${resource}.${event}` : null),
      resource_id: parsed?.id || null,
      source: "woocommerce",
      signature_ok: sigValid,
      headers: {
        topic,
        resource,
        event,
        // do not log the signature itself
      },
      payload: parsed || { raw: rawBody.slice(0, 4000) },
      processed: false,
    });
  } catch (logErr) {
    console.warn("[wpw-orders-webhook] log insert failed", logErr);
  }

  if (!sigValid) {
    return new Response(JSON.stringify({ ok: false, error: "invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!parsed || typeof parsed.id !== "number") {
    // Woo sometimes fires a "ping" webhook with an empty body on webhook create.
    return new Response(JSON.stringify({ ok: true, ignored: "no-order-body" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Only handle order.* topics
  const normalizedTopic = (topic || "").toLowerCase();
  if (normalizedTopic && !normalizedTopic.startsWith("order.")) {
    return new Response(JSON.stringify({ ok: true, ignored: `topic:${topic}` }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const userId = await linkUserIdForCustomer(sb, parsed.customer_id);
    const orderRow = normalizeOrder(parsed, userId);
    const itemRows = normalizeLineItems(parsed.id, parsed.line_items || []);

    const { error: upErr } = await sb
      .from("wpw_orders")
      .upsert(orderRow, { onConflict: "id" });
    if (upErr) throw upErr;

    if (itemRows.length > 0) {
      // Replace items for this order — easiest way to stay consistent with Woo edits
      await sb.from("wpw_order_items").delete().eq("order_id", parsed.id);
      const { error: itemsErr } = await sb
        .from("wpw_order_items")
        .upsert(itemRows, { onConflict: "id" });
      if (itemsErr) throw itemsErr;
    }

    // ── QUOTE → ORDER CONVERSION TRACKING ──
    // 3-tier matching: metadata quote_number → email → name
    // When a WPW order matches a RestylePro quote, mark it CONVERTED.
    let matchedQuoteId: string | null = null;
    let matchType: string | null = null;

    try {
      // Tier 1: Metadata match (definitive) — quote_number passed via URL
      const quoteNumberMeta = (parsed.meta_data || []).find(
        (m: any) => m.key === "_wpw_quote_number"
      );
      if (quoteNumberMeta?.value) {
        const { data: metaMatch } = await sb
          .from("customer_quotes")
          .select("id")
          .eq("quote_number", quoteNumberMeta.value)
          .maybeSingle();
        if (metaMatch) {
          matchedQuoteId = metaMatch.id;
          matchType = "metadata";
        }
      }

      // Tier 2: Email match
      if (!matchedQuoteId && orderRow.customer_email) {
        const { data: emailMatch } = await sb
          .from("customer_quotes")
          .select("id")
          .eq("customer_email", orderRow.customer_email)
          .neq("status", "converted")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (emailMatch) {
          matchedQuoteId = emailMatch.id;
          matchType = "email";
        }
      }

      // Tier 3: Name match (fuzzy)
      if (!matchedQuoteId && orderRow.customer_name) {
        const { data: nameMatch } = await sb
          .from("customer_quotes")
          .select("id")
          .ilike("customer_name", `%${orderRow.customer_name}%`)
          .neq("status", "converted")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (nameMatch) {
          matchedQuoteId = nameMatch.id;
          matchType = "name";
        }
      }

      if (matchedQuoteId) {
        await sb
          .from("customer_quotes")
          .update({
            status: "converted",
            notes: `WPW Order #${orderRow.order_number} — $${orderRow.total} (match: ${matchType})`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", matchedQuoteId);

        // Track conversion event
        await sb.from("quote_events").insert({
          event_type: "quote_converted_to_order",
          quote_id: matchedQuoteId,
          product_type: "WPW",
          source: "wpw-orders-webhook",
          metadata: {
            woo_order_id: parsed.id,
            woo_order_number: orderRow.order_number,
            woo_order_total: orderRow.total,
            woo_billing_email: orderRow.customer_email,
            woo_billing_name: orderRow.customer_name,
            match_type: matchType,
          },
        });

        console.log(`[wpw-orders-webhook] Quote ${matchedQuoteId} CONVERTED via ${matchType} match — Order #${orderRow.order_number} $${orderRow.total}`);
      }
    } catch (quoteErr) {
      console.warn("[wpw-orders-webhook] Quote matching failed (non-fatal):", quoteErr);
    }
    // ── END CONVERSION TRACKING ──

    // ── SOCIALIQ ATTRIBUTION (docs/SOCIALIQ_SPEC.md) ──
    // Did this job start as a DM/comment? If the buyer's email was captured
    // from social, stamp the quote's lead_source with the originating post
    // and mirror the revenue onto their Klaviyo profile, so "DM → quote →
    // job" is answerable in both systems.
    //
    // STRICTLY ADDITIVE AND NON-FATAL: this is the live WPW tenant. It only
    // ever fills lead_source when it is EMPTY (never overwrites an existing
    // attribution), and any failure here is logged and swallowed — an order
    // must never fail because analytics did. The read-side is the
    // social_attribution_v view, which needs none of this to work.
    try {
      const buyerEmail = (orderRow.customer_email || "").trim().toLowerCase();
      if (buyerEmail) {
        const { data: identity } = await sb
          .from("social_identities")
          .select("id, platform, handle, source_post_id, brand")
          .eq("email", buyerEmail)
          .maybeSingle();

        if (identity) {
          const attribution = `social:${identity.platform || "unknown"}:${identity.source_post_id || "direct"}`;

          if (matchedQuoteId) {
            const { data: existing } = await sb
              .from("customer_quotes")
              .select("lead_source")
              .eq("id", matchedQuoteId)
              .maybeSingle();
            // Only fill a blank — never clobber an existing lead_source.
            if (existing && !existing.lead_source) {
              await sb.from("customer_quotes")
                .update({ lead_source: attribution, updated_at: new Date().toISOString() })
                .eq("id", matchedQuoteId);
            }
            await sb.from("quote_events").insert({
              event_type: "social_attributed_order",
              quote_id: matchedQuoteId,
              product_type: "WPW",
              source: "socialiq-attribution",
              metadata: {
                woo_order_number: orderRow.order_number,
                woo_order_total: orderRow.total,
                social_platform: identity.platform,
                social_handle: identity.handle,
                source_post_id: identity.source_post_id,
                identity_id: identity.id,
              },
            });
          }

          // Mirror to Klaviyo with the revenue value so the profile timeline
          // and any revenue reporting there see the same conversion.
          await klaviyoTrack({
            metric: "Social Attributed Order",
            email: buyerEmail,
            value: Number(orderRow.total) || 0,
            properties: {
              order_number: orderRow.order_number,
              brand: identity.brand,
              social_platform: identity.platform,
              social_handle: identity.handle,
              source_post_id: identity.source_post_id,
              quote_id: matchedQuoteId,
            },
            uniqueId: `social-attr-${orderRow.order_number}`,
          });

          console.log(
            `[wpw-orders-webhook] SOCIAL ATTRIBUTION — order #${orderRow.order_number} ($${orderRow.total}) traced to ${identity.platform} post ${identity.source_post_id || "direct"}`,
          );
        }
      }
    } catch (attrErr) {
      console.warn("[wpw-orders-webhook] Social attribution failed (non-fatal):", attrErr);
    }
    // ── END SOCIALIQ ATTRIBUTION ──

    // ── APPROVEPRO BRIDGE ──
    // Disabled by default until ApprovePro is owned by the DesignProAI OS.
    // The surrounding WPW order, quote, and attribution ingestion stays live.
    if (isApproveProLive()) {
    try {
      // Skip if a proof already exists for this WPW order
      const { data: existingProof } = await sb
        .from("proof_approvals")
        .select("id")
        .eq("metadata->>woo_order_id", String(parsed.id))
        .maybeSingle();

      if (!existingProof) {
        // If we matched a quote, pull vehicle/design info from it
        let vehicleYear: string | null = null;
        let vehicleMake: string | null = null;
        let vehicleModel: string | null = null;
        let designLabel: string | null = null;

        if (matchedQuoteId) {
          const { data: qDetail } = await sb
            .from("customer_quotes")
            .select("shop_id, vehicle_year, vehicle_make, vehicle_model, color_name, render_url")
            .eq("id", matchedQuoteId)
            .maybeSingle();
          vehicleYear = qDetail?.vehicle_year || null;
          vehicleMake = qDetail?.vehicle_make || null;
          vehicleModel = qDetail?.vehicle_model || null;
          designLabel = qDetail?.color_name || null;
        }

        // Try to extract vehicle info from line item names/meta if not from quote
        if (!vehicleMake) {
          const firstItem = (parsed.line_items || [])[0];
          if (firstItem?.meta_data) {
            for (const m of firstItem.meta_data) {
              if (m.key === "pa_vehicle-make" || m.key === "vehicle_make") vehicleMake = m.value;
              if (m.key === "pa_vehicle-model" || m.key === "vehicle_model") vehicleModel = m.value;
              if (m.key === "pa_vehicle-year" || m.key === "vehicle_year") vehicleYear = m.value;
            }
          }
        }

        const shopId = userId || "61cc6c1c-554c-440c-8e07-a64469f1f4eb"; // fallback to Trish
        const viewToken = await mintProofToken("view");
        const manageToken = await mintProofToken("manage");

        const expires = new Date();
        expires.setDate(expires.getDate() + 14);

        const proofDesignName = designLabel
          ? `${designLabel} — WPW #${orderRow.order_number}`
          : `WPW Order #${orderRow.order_number}`;

        const { error: proofErr } = await sb
          .from("proof_approvals")
          .insert({
            shop_id: shopId,
            view_token: viewToken,
            manage_token: manageToken,
            customer_email: orderRow.customer_email,
            customer_name: orderRow.customer_name,
            vehicle_year: vehicleYear,
            vehicle_make: vehicleMake,
            vehicle_model: vehicleModel,
            design_name: proofDesignName,
            mode: "revision_loop",
            status: "draft",
            expires_at: expires.toISOString(),
            // Seed customer self-serve AI revisions so "Revise with AI" appears
            // on the proof (it's gated on allowed > 0). Autogen bumps to max(.,3).
            ai_revisions_allowed: 3,
            internal_notes: `Auto-created from WPW Order #${orderRow.order_number} ($${orderRow.total})`,
            metadata: {
              woo_order_id: parsed.id,
              woo_order_number: orderRow.order_number,
              woo_order_total: orderRow.total,
              woo_status: orderRow.status,
              woo_line_items: (parsed.line_items || []).slice(0, 20).map((i: WooLineItem) => ({
                name: i.name, sku: i.sku, quantity: i.quantity,
                image_url: i.image?.src || null,
              })),
              woo_billing: orderRow.billing,
              woo_date_created: orderRow.date_created,
              source: "wpw-orders-webhook",
              matched_quote_id: matchedQuoteId,
              match_type: matchType,
            },
          });

        if (proofErr) {
          console.warn("[wpw-orders-webhook] ApprovePro bridge insert failed:", proofErr);
        } else {
          console.log(`[wpw-orders-webhook] ApprovePro draft proof created for Order #${orderRow.order_number}`);
        }
      }
    } catch (bridgeErr) {
      // Non-fatal — order processing must not break
      console.warn("[wpw-orders-webhook] ApprovePro bridge error (non-fatal):", bridgeErr);
    }
    } else {
      console.log("[wpw-orders-webhook] ApprovePro bridge disabled");
    }
    // ── END APPROVEPRO BRIDGE ──

    // ── PRODUCTION PACK BRIDGE ──
    // When the Woo order contains a production-pack product AND a line item's
    // meta carries the design's generation id, grant the pack entitlement
    // (same row shape stripe-webhook writes, so pack-gate unlocks) and flip
    // the design + its panelizer job to THIS Woo order number so Studio Board,
    // RevisionStudio, and ProductionFlow all key by it automatically.
    try {
      const PACK_RE = /production[\s_-]?pack/i;
      const packItems = (parsed.line_items || []).filter(
        (i: WooLineItem) => PACK_RE.test(i.sku || "") || PACK_RE.test(i.name || ""),
      );
      const orderNo = String(orderRow.order_number || parsed.id);
      const GEN_META_KEYS = ["generation_id", "designiq_generation_id", "design_id", "render_id"];
      const findGenMeta = (meta: any[]): string | null => {
        const hit = (meta || []).find((m) => GEN_META_KEYS.includes(String(m?.key || "").toLowerCase().replace(/^_/, "")));
        return hit ? String(hit.value).trim() : null;
      };
      for (const item of packItems) {
        // Line-item meta first; fall back to ORDER-level meta (some capture
        // plugins write the URL param there instead of onto the line item).
        const genId = findGenMeta((item as any).meta_data || [])
          || findGenMeta((parsed as any).meta_data || []);
        if (!genId) {
          console.log(`[wpw-orders-webhook] pack item on #${orderNo} has no generation meta — manual Attach Design will link it`);
          continue;
        }

        // 1) Entitlement (idempotent) — only when we know the buyer's user id.
        if (userId) {
          const { data: already } = await sb
            .from("production_packs").select("id")
            .eq("generation_id", genId)
            .in("payment_status", ["paid", "included", "comp", "free"])
            .limit(1).maybeSingle();
          if (!already?.id) {
            await sb.from("production_packs").insert({
              user_id: userId,
              generation_id: genId,
              panels_selected: [],
              payment_status: "paid",
              total_price_cents: Math.round(parseFloat((item as any).total || "0") * 100) || 29900,
              source: "wpw_woo_order",
              pipeline_version: "buildassets",
            } as any);
          }
        }

        // 2) Flip any auto-minted RP- panelizer job for this generation.
        await sb.from("panelizer_jobs")
          .update({ order_number: orderNo })
          .eq("generation_id", genId)
          .like("order_number", "RP-%");

        // 3) Stamp the design row (id match, else designiq back-link).
        let { data: viz } = await sb
          .from("color_visualizations").select("id, admin_notes")
          .eq("id", genId).maybeSingle();
        if (!viz) {
          const { data: byLink } = await sb
            .from("color_visualizations").select("id, admin_notes")
            .ilike("admin_notes", `%designiq_generation_id%${genId}%`)
            .order("created_at", { ascending: false }).limit(1);
          viz = (byLink as any)?.[0] || null;
        }
        if (viz?.id) {
          let notes: Record<string, unknown> = {};
          try { notes = JSON.parse((viz as any).admin_notes || "{}"); } catch { notes = {}; }
          notes.wpw_order_number = orderNo;
          notes.order_number = orderNo;
          await sb.from("color_visualizations")
            .update({ admin_notes: JSON.stringify(notes) }).eq("id", viz.id);
          console.log(`[wpw-orders-webhook] design ${viz.id} flipped to Woo order ${orderNo}`);
        }
      }
    } catch (packErr) {
      console.warn("[wpw-orders-webhook] production-pack bridge error (non-fatal):", packErr);
    }
    // ── END PRODUCTION PACK BRIDGE ──

    // Mark the log row processed
    await sb
      .from("wpw_webhook_log")
      .update({ processed: true })
      .eq("resource_id", parsed.id)
      .eq("processed", false);

    return new Response(JSON.stringify({ ok: true, order_id: parsed.id, matched_quote: matchedQuoteId, match_type: matchType }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[wpw-orders-webhook] process error", msg);

    await sb
      .from("wpw_webhook_log")
      .update({ processed: false, error: msg })
      .eq("resource_id", parsed.id)
      .eq("processed", false);

    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
