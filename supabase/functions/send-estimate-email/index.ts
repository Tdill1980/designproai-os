/**
 * send-estimate-email — Phase 6b.
 *
 * Sends the customer the saved QuickQuote estimate. The shop owner
 * triggers it from the Estimator drawer's `Send estimate` button after
 * saveQuote has persisted the row in public.quotes.
 *
 * Input:  { quoteId: string }
 *
 * Output: { success: true, messageId } | { error }
 *
 * What lands in the customer's inbox:
 *   - Shop branding header (logo + name, falls back to gradient + name)
 *   - Hero render (the FINAL stacked image) at the top
 *   - "Design story" thumbnail strip — base render + each precision mod
 *     (chrome delete -> carbon fiber roof -> racing stripe) so the
 *     customer sees how the wrap was built
 *   - Line-item table with totals
 *   - Optional shop notes
 *   - "View your estimate" CTA → /q/:share_token (the existing public
 *     share-link page)
 *
 * Side effects on the quote row:
 *   - last_email_at        = now()
 *   - last_email_type      = 'estimate'
 *   - status               = 'sent'
 *   - email_log row inserted (best-effort; doesn't fail the request)
 *
 * verify_jwt = false (config.toml) — we read the Authorization header
 * to identify the sending shop owner and look up the quote scoped to
 * their shop_id; service-role client handles the writes once the
 * caller is verified.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { corsHeaders } from "../_shared/cors.ts";
import { klaviyoTrack } from "../_shared/klaviyo-track.ts";

interface Body {
  quoteId: string;
}

interface QuoteRow {
  id: string;
  shop_id: string;
  quote_number: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  finish: string | null;
  color_name: string | null;
  manufacturer: string | null;
  customer_total: number | null;
  shop_cost: number | null;
  status: string | null;
  line_items:
    | Array<{
        label: string;
        detail?: string;
        amount: number;
        wooProductId?: number;
        quantity?: number;
      }>
    | null;
  render_url: string | null;
  base_render_url: string | null;
  precision_mod_renders:
    | Array<{ key: string; label: string; renderUrl: string }>
    | null;
  share_token: string | null;
  customer_id: string | null;
}

interface CustomerRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

interface ShopRow {
  id: string;
  name: string | null;
  slug: string | null;
  logo_url: string | null;
  contact_email: string | null;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function fmtMoney(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

/**
 * Build a one-click "Pay Now" URL where the customer lands on the WPW
 * cart with this quote's line items already added. Mirrors
 * buildWpwCheckoutUrl in src/pages/PublicQuotePage.tsx so the email and
 * the public quote page point to the exact same checkout flow.
 *
 * Returns null when the shop isn't WPW or no line carries a Woo product
 * id — caller falls back to the share-link CTA only.
 */
function buildPayUrl(
  _shopSlug: string | null | undefined,
  lineItems: QuoteRow["line_items"],
): string | null {
  // Any line carrying a wooProductId is a WPW Woo SKU — those IDs only
  // mean anything in the WePrintWraps Woo store. We don't gate on the
  // shop slug because slug values vary ("wpw", "weprintwraps", …) but
  // the wooProductId itself is the source of truth.
  if (!lineItems || lineItems.length === 0) return null;
  const woo = lineItems.filter(
    (l) => typeof l.wooProductId === "number" && (l.wooProductId ?? 0) > 0,
  );
  if (woo.length === 0) return null;
  if (woo.length === 1) {
    const l = woo[0];
    const qty = l.quantity && l.quantity > 0 ? Math.round(l.quantity) : 1;
    return `https://weprintwraps.com/cart/?add-to-cart=${l.wooProductId}&quantity=${qty}`;
  }
  const ids = woo.map((l) => l.wooProductId).join(",");
  return `https://weprintwraps.com/cart/?add-to-cart=${ids}`;
}

/**
 * Replace {{merge_tag}} placeholders inside a template string. Mirrors
 * the helper used by send-templated-email so MightyMail-authored
 * templates work identically across the initial-send and retarget-drip
 * paths. Unresolved tags are stripped (rather than left visible to the
 * customer).
 */
function renderMergeTags(
  template: string,
  data: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : "";
  });
}

function buildHtml(args: {
  quote: QuoteRow;
  customer: CustomerRow | null;
  shop: ShopRow | null;
  origin: string;
  shopOwnerNote?: string;
}): string {
  const { quote, customer, shop, origin } = args;
  const vehicle = [quote.vehicle_year, quote.vehicle_make, quote.vehicle_model]
    .filter(Boolean)
    .join(" ");
  const shopName = shop?.name || "Your Wrap Shop";
  const greeting = customer?.name?.trim() || "there";
  const total = fmtMoney(quote.customer_total);
  const items = (quote.line_items || []).map((i) => ({
    label: i.label,
    detail: i.detail || "",
    amount: i.amount,
  }));
  const mods = quote.precision_mod_renders || [];
  const shareUrl = quote.share_token
    ? `${origin}/q/${quote.share_token}`
    : null;

  // ── Shop header ──
  const shopHeader = shop?.logo_url
    ? `<img src="${shop.logo_url}" alt="${shopName}" style="max-height:48px;max-width:200px;" />`
    : `<h2 style="margin:0;font-size:20px;color:#fff;font-weight:700;letter-spacing:0.5px;">${shopName}</h2>`;

  // ── Hero render ──
  const heroSection = quote.render_url
    ? `
      <tr><td style="padding:24px 32px 0;">
        <img src="${quote.render_url}" alt="Your wrap" style="width:100%;border-radius:12px;display:block;" />
      </td></tr>`
    : "";

  // ── Design story strip ──
  let storySection = "";
  const hasStory = quote.base_render_url || mods.length > 0;
  if (hasStory) {
    const cells: string[] = [];
    if (quote.base_render_url) {
      cells.push(`
        <td style="width:25%;padding:4px;vertical-align:top;">
          <img src="${quote.base_render_url}" alt="Base" style="width:100%;border-radius:6px;display:block;" />
          <p style="margin:6px 0 0;font-size:10px;color:#888;text-align:center;">Base</p>
        </td>`);
    }
    for (const m of mods) {
      cells.push(`
        <td style="width:25%;padding:4px;vertical-align:top;">
          <img src="${m.renderUrl}" alt="${m.label}" style="width:100%;border-radius:6px;display:block;" />
          <p style="margin:6px 0 0;font-size:10px;color:#888;text-align:center;">+ ${m.label}</p>
        </td>`);
    }
    // Group cells into rows of 4 to keep the email layout sane.
    const rows: string[] = [];
    for (let i = 0; i < cells.length; i += 4) {
      rows.push(`<tr>${cells.slice(i, i + 4).join("")}</tr>`);
    }
    storySection = `
      <tr><td style="padding:18px 32px 0;">
        <p style="margin:0 0 8px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:600;">How your wrap was built</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
          ${rows.join("")}
        </table>
      </td></tr>`;
  }

  // ── Line items ──
  const itemRows = items.map((it) => `
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#e0e0e0;border-bottom:1px solid #222;">
        ${it.label}${it.detail ? `<br/><span style="font-size:11px;color:#888;">${it.detail}</span>` : ""}
      </td>
      <td style="padding:8px 0;font-size:13px;color:#fff;text-align:right;font-weight:600;border-bottom:1px solid #222;">
        ${fmtMoney(it.amount)}
      </td>
    </tr>
  `).join("");

  const quoteSection = `
    <tr><td style="padding:24px 32px 0;">
      <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Estimate</p>
      ${quote.quote_number ? `<p style="margin:0 0 12px;font-size:10px;color:#666;">Quote #${quote.quote_number}</p>` : ""}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;">Item</td>
          <td style="padding:8px 0;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;text-align:right;border-bottom:1px solid #333;">Amount</td>
        </tr>
        ${itemRows}
        <tr>
          <td style="padding:14px 0 0;font-size:15px;color:#00C7FF;font-weight:700;">Total</td>
          <td style="padding:14px 0 0;font-size:15px;color:#00C7FF;font-weight:700;text-align:right;">${total}</td>
        </tr>
      </table>
    </td></tr>`;

  const payUrl = buildPayUrl(shop?.slug ?? null, quote.line_items);
  const payButton = payUrl
    ? `
        <a href="${payUrl}" style="display:inline-block;background:linear-gradient(135deg,#22c55e,#10b981);color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;margin-right:8px;">
          Add to WePrintWraps.com Cart
        </a>`
    : "";
  const ctaSection = shareUrl || payUrl
    ? `
      <tr><td style="padding:28px 32px 0;text-align:center;">
        ${payButton}
        ${shareUrl ? `<a href="${shareUrl}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#a855f7);color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;">
          View your estimate online
        </a>` : ""}
        ${payUrl ? `<p style="margin:10px 0 0;font-size:10px;color:#888;">One-click checkout — your items are pre-loaded in the WePrintWraps cart.</p>` : ""}
        ${shareUrl ? `<p style="margin:10px 0 0;font-size:10px;color:#666;">${shareUrl}</p>` : ""}
      </td></tr>`
    : "";

  // WPW-only DesignPro pitch — auto-appended on every WePrintWraps
  // quote. Anchors against WPW's listed $975 custom wrap design fee.
  // Copy is owner-approved — confirm with Trish before changing.
  // Non-WPW shops don't see this — they don't sell the RP subscription.
  const isWpwShop = shop?.slug === "wpw";
  const compareSection = isWpwShop
    ? `
      <tr><td style="padding:24px 32px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #1f2937;border-radius:12px;">
          <tr><td style="padding:22px 24px;text-align:center;">
            <p style="margin:0 0 8px;font-size:11px;color:#06b6d4;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">Need the design done? Read this first.</p>
            <p style="margin:0 0 12px;font-size:14px;color:#ccc;line-height:1.6;">Our custom wrap design fee is <strong style="color:#fff;">$975</strong> per design.</p>
            <p style="margin:0 0 14px;font-size:14px;color:#ccc;line-height:1.6;">Or — for <span style="color:#fff;font-weight:600;">less than that</span> — subscribe to <strong style="color:#fff;">RestylePro DesignPro Studio at $699/mo</strong> and get unlimited photoreal AI mockups, our real human designer producing Production Packs, all the design tools, and print-ready files included.</p>
            <p style="margin:0 0 18px;font-size:13px;color:#a3a3a3;line-height:1.55;font-style:italic;">One subscription month &lt; one custom design. And you keep designing — forever.</p>
            <a href="https://www.restyleproai.com/pricing" style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#a855f7);color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:12px 24px;border-radius:8px;">Subscribe to DesignPro Studio &rarr;</a>
            <p style="margin:12px 0 0;font-size:11px;color:#aaa;">WPW Family rate: <strong style="color:#fff;">$649/mo</strong> &middot; $50 off for life</p>
          </td></tr>
        </table>
      </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#000;">
    <tr><td align="center" style="padding:24px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid #1a1a1a;border-radius:12px;overflow:hidden;">

        <tr><td style="padding:24px 32px;background:linear-gradient(135deg,#2563eb,#a855f7);border-bottom:1px solid #1a1a1a;text-align:center;">
          ${shopHeader}
          ${vehicle ? `<p style="margin:8px 0 0;font-size:12px;color:#e0e7ff;font-weight:600;">${vehicle}</p>` : ""}
        </td></tr>

        <tr><td style="padding:24px 32px 0;">
          <p style="margin:0 0 4px;font-size:14px;color:#fff;font-weight:600;">Hi ${greeting},</p>
          <p style="margin:8px 0 0;font-size:14px;color:#ccc;line-height:1.6;">
            Here's the estimate we put together for your ${vehicle || "vehicle"}.
            ${quote.color_name ? `Color: <span style="color:#fff;">${quote.color_name}</span>${quote.finish ? ` · ${quote.finish}` : ""}.` : ""}
          </p>
        </td></tr>

        ${heroSection}
        ${storySection}
        ${quoteSection}
        ${ctaSection}
        ${compareSection}

        <tr><td style="padding:32px;border-top:1px solid #1a1a1a;text-align:center;">
          <p style="margin:0 0 8px;font-size:11px;color:#888;">
            Questions? Reply to this email${shop?.contact_email ? ` or write to <a href="mailto:${shop.contact_email}" style="color:#00C7FF;text-decoration:none;">${shop.contact_email}</a>` : ""}.
          </p>
          <p style="margin:0;font-size:9px;color:#333;">Powered by RestylePro · Professional Vehicle Wrap Visualization</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }
  if (!body.quoteId) return json(400, { error: "quoteId required" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase env missing" });
  if (!resendKey) return json(503, { error: "RESEND_API_KEY not configured" });

  const sb = createClient(supabaseUrl, serviceKey);
  const resend = new Resend(resendKey);

  // Verify the caller is authenticated and belongs to the quote's shop.
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "auth required" });
  const { data: userData } = await sb.auth.getUser(token);
  const user = userData?.user;
  if (!user) return json(401, { error: "auth required" });

  // Pull the quote.
  const { data: quote, error: qErr } = await sb
    .from("quotes")
    .select(
      "id, shop_id, quote_number, vehicle_year, vehicle_make, vehicle_model, finish, color_name, manufacturer, customer_total, shop_cost, status, line_items, render_url, base_render_url, precision_mod_renders, share_token, customer_id",
    )
    .eq("id", body.quoteId)
    .maybeSingle();
  if (qErr || !quote) {
    console.warn("[send-estimate-email] quote not found", body.quoteId, qErr?.message);
    return json(404, { error: "quote not found" });
  }
  const q = quote as QuoteRow;

  // Check shop membership — caller must be a member of the quote's shop.
  const { data: membership } = await sb
    .from("shop_members")
    .select("shop_id")
    .eq("user_id", user.id)
    .eq("shop_id", q.shop_id)
    .maybeSingle();
  if (!membership) {
    // Soft fallback — owner_user_id check via shops table for legacy rows.
    const { data: shopOwner } = await sb
      .from("shops")
      .select("owner_user_id")
      .eq("id", q.shop_id)
      .maybeSingle();
    if (!shopOwner || (shopOwner as { owner_user_id: string }).owner_user_id !== user.id) {
      return json(403, { error: "not a member of this shop" });
    }
  }

  // Pull customer + shop side-data.
  let customer: CustomerRow | null = null;
  if (q.customer_id) {
    const { data } = await sb
      .from("customers")
      .select("id, name, email, phone")
      .eq("id", q.customer_id)
      .maybeSingle();
    customer = (data as CustomerRow | null) ?? null;
  }

  if (!customer?.email) {
    return json(
      400,
      { error: "customer has no email on file — add one to the estimate before sending" },
    );
  }

  const { data: shopData } = await sb
    .from("shops")
    .select("id, name, slug, logo_url, contact_email")
    .eq("id", q.shop_id)
    .maybeSingle();
  const shop = (shopData as ShopRow | null) ?? null;

  // Pull the shop's MightyMail voice (formal / casual / etc.) so we
  // can pick the matching template variant the same way the retarget
  // drips do (see SavedQuotesTable.handleScheduleRetarget).
  let shopVoice = "formal";
  {
    const { data: profile } = await sb
      .from("shop_profiles")
      .select("shop_voice")
      .eq("id", q.shop_id)
      .maybeSingle();
    const v = (profile as { shop_voice?: string | null } | null)?.shop_voice;
    if (v && typeof v === "string") shopVoice = v;
  }

  const origin = req.headers.get("origin") || "https://restyleproai.com";

  // ── Try MightyMail email_templates first; fall back to hardcoded HTML.
  // Template lookup order:
  //   1. `quote-estimate-{voice}` (e.g. quote-estimate-formal)
  //   2. `quote-estimate` (voice-agnostic default)
  //   3. hardcoded buildHtml (no template configured yet)
  // This unifies the initial-send path with the retarget-drip path
  // (process-scheduled-emails -> send-templated-email -> email_templates)
  // so the team can edit copy in MightyMail without a redeploy.
  const vehicle = [q.vehicle_year, q.vehicle_make, q.vehicle_model]
    .filter(Boolean)
    .join(" ");
  const total = fmtMoney(q.customer_total);
  const shareUrl = q.share_token ? `${origin}/q/${q.share_token}` : "";
  const payUrl = buildPayUrl(shop?.slug ?? null, q.line_items) ?? "";
  const isWpwShop = shop?.slug === "wpw";
  // Same pitch as buildHtml's compareSection — kept in sync. If you
  // change one, change the other (or pull both from a shared constant).
  const pitchHtml = isWpwShop
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #1f2937;border-radius:12px;"><tr><td style="padding:22px 24px;text-align:center;"><p style="margin:0 0 8px;font-size:11px;color:#06b6d4;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">Need the design done? Read this first.</p><p style="margin:0 0 12px;font-size:14px;color:#ccc;line-height:1.6;">Our custom wrap design fee is <strong style="color:#fff;">$975</strong> per design.</p><p style="margin:0 0 14px;font-size:14px;color:#ccc;line-height:1.6;">Or — for <span style="color:#fff;font-weight:600;">less than that</span> — subscribe to <strong style="color:#fff;">RestylePro DesignPro Studio at $699/mo</strong> and get unlimited photoreal AI mockups, our real human designer producing Production Packs, all the design tools, and print-ready files included.</p><p style="margin:0 0 18px;font-size:13px;color:#a3a3a3;line-height:1.55;font-style:italic;">One subscription month &lt; one custom design. And you keep designing — forever.</p><a href="https://www.restyleproai.com/pricing" style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#a855f7);color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:12px 24px;border-radius:8px;">Subscribe to DesignPro Studio &rarr;</a><p style="margin:12px 0 0;font-size:11px;color:#aaa;">WPW Family rate: <strong style="color:#fff;">$649/mo</strong> &middot; $50 off for life</p></td></tr></table>`
    : "";

  const mergeData: Record<string, string> = {
    customer_name: customer.name?.trim() || "there",
    customer_email: customer.email,
    shop_name: shop?.name || "RestylePro",
    shop_logo_url: shop?.logo_url || "",
    shop_email: shop?.contact_email || "",
    shop_slug: shop?.slug || "",
    quote_number: q.quote_number || "",
    quote_total: total,
    vehicle,
    vehicle_year: q.vehicle_year || "",
    vehicle_make: q.vehicle_make || "",
    vehicle_model: q.vehicle_model || "",
    finish: q.finish || "",
    color_name: q.color_name || "",
    manufacturer: q.manufacturer || "",
    hero_render_url: q.render_url || "",
    share_url: shareUrl,
    pay_url: payUrl,
    pay_button_html: payUrl
      ? `<a href="${payUrl}" style="display:inline-block;background:linear-gradient(135deg,#22c55e,#10b981);color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;">Add to WePrintWraps.com Cart</a>`
      : "",
    pitch_html: pitchHtml,
    is_wpw_shop: isWpwShop ? "true" : "false",
  };

  const candidateSlugs = [
    `quote-estimate-${shopVoice}`,
    "quote-estimate",
  ];
  let templateRow:
    | { slug: string; subject: string; html_content: string; from_name: string | null; from_email: string | null }
    | null = null;
  for (const slug of candidateSlugs) {
    const { data: t } = await sb
      .from("email_templates")
      .select("slug, subject, html_content, from_name, from_email")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    if (t) {
      templateRow = t as typeof templateRow;
      break;
    }
  }

  const fromName = (shop?.name || templateRow?.from_name || "RestylePro")
    .replace(/[<>"]/g, "")
    .slice(0, 60);

  let subject: string;
  let html: string;
  if (templateRow) {
    subject = renderMergeTags(templateRow.subject, mergeData);
    html = renderMergeTags(templateRow.html_content, mergeData);
    console.log(`[send-estimate-email] using MightyMail template '${templateRow.slug}'`);
  } else {
    html = buildHtml({ quote: q, customer, shop, origin });
    subject = q.quote_number
      ? `Your wrap estimate — ${q.quote_number}`
      : `Your wrap estimate from ${fromName}`;
    console.log("[send-estimate-email] no MightyMail template found, using hardcoded HTML");
  }

  // ── WPW Klaviyo branch ──
  // When KLAVIYO_QUOTE_FLOW_ENABLED=true and the shop is WPW, route the
  // estimate through a Klaviyo "Quote Sent" metric event instead of
  // Resend. The user-built flow in Klaviyo (triggered on this metric)
  // sends the email using the WPW QuickQuote Estimate template
  // (klaviyo template id XiRM3Z). Until the flag is set, behaviour is
  // unchanged — every send still goes through Resend.
  const klaviyoEnabled =
    isWpwShop && (Deno.env.get("KLAVIYO_QUOTE_FLOW_ENABLED") || "").toLowerCase() === "true";

  if (klaviyoEnabled) {
    const klaviyoKey = Deno.env.get("KLAVIYO_API_KEY");
    if (!klaviyoKey) return json(503, { error: "KLAVIYO_API_KEY not configured" });

    const lineItemsForKlaviyo = (q.line_items || []).map((li) => ({
      label: li.label,
      detail: li.detail || "",
      amount_formatted: fmtMoney(li.amount),
      amount: li.amount,
    }));
    const precisionModsForKlaviyo = (q.precision_mod_renders || []).map((m) => ({
      label: m.label,
      render_url: m.renderUrl,
    }));

    const eventProperties: Record<string, unknown> = {
      customer_name: customer.name?.trim() || "",
      customer_email: customer.email,
      shop_name: shop?.name || "WePrintWraps",
      shop_logo_url: shop?.logo_url || "",
      shop_email: shop?.contact_email || "",
      quote_id: q.id,
      quote_number: q.quote_number || "",
      quote_total: total,
      vehicle,
      color_name: q.color_name || "",
      finish: q.finish || "",
      hero_render_url: q.render_url || "",
      base_render_url: q.base_render_url || "",
      precision_mod_renders: precisionModsForKlaviyo,
      line_items: lineItemsForKlaviyo,
      share_url: shareUrl,
      pay_url: payUrl,
      is_wpw_shop: true,
      subject,
    };

    const profileAttrs: Record<string, string> = { email: customer.email };
    if (customer.name) {
      const parts = customer.name.trim().split(/\s+/);
      profileAttrs.first_name = parts[0];
      if (parts.length > 1) profileAttrs.last_name = parts.slice(1).join(" ");
    }
    if (customer.phone) profileAttrs.phone_number = customer.phone;

    const klaviyoBody = {
      data: {
        type: "event",
        attributes: {
          properties: eventProperties,
          metric: {
            data: { type: "metric", attributes: { name: "Quote Sent" } },
          },
          profile: {
            data: { type: "profile", attributes: profileAttrs },
          },
          time: new Date().toISOString(),
          value: q.customer_total ?? 0,
          value_currency: "USD",
          unique_id: `quote-sent-${q.id}-${Date.now()}`,
        },
      },
    };

    const klaviyoResp = await fetch("https://a.klaviyo.com/api/events/", {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${klaviyoKey}`,
        revision: "2024-10-15",
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(klaviyoBody),
    });

    if (!klaviyoResp.ok) {
      const errText = await klaviyoResp.text().catch(() => "");
      console.error(
        "[send-estimate-email] Klaviyo event post failed:",
        klaviyoResp.status,
        errText,
      );
      return json(502, { error: `Klaviyo event post failed (${klaviyoResp.status})` });
    }

    await sb
      .from("quotes")
      .update({
        last_email_at: new Date().toISOString(),
        last_email_type: "estimate",
        status: "sent",
      })
      .eq("id", q.id);

    await sb
      .from("email_log")
      .insert({
        quote_id: q.id,
        customer_id: q.customer_id,
        shop_id: q.shop_id,
        email_type: "estimate",
        subject,
        body: null,
        recipient: customer.email,
        sent_at: new Date().toISOString(),
        status: "sent",
        metadata: {
          provider: "klaviyo",
          metric: "Quote Sent",
          klaviyo_template_id: "XiRM3Z",
        },
      })
      .catch((e) => console.warn("[send-estimate-email] email_log insert failed:", e?.message));

    return json(200, { success: true, provider: "klaviyo", sentTo: customer.email });
  }

  // ── Resend branch (default for non-WPW shops, or WPW until flag is on) ──

  const fromAddress = isWpwShop
    ? `${fromName} <Design@weprintwraps.com>`
    : `${fromName} <noreply@restyleproai.com>`;
  const replyTo = isWpwShop
    ? "Design@weprintwraps.com"
    : shop?.contact_email || undefined;

  const sendResp = await resend.emails.send({
    from: fromAddress,
    to: [customer.email],
    reply_to: replyTo,
    subject,
    html,
  });

  if (sendResp.error) {
    console.error("[send-estimate-email] resend error:", sendResp.error);
    return json(502, { error: sendResp.error.message || "email send failed" });
  }

  // Update quote status + email tracking.
  await sb
    .from("quotes")
    .update({
      last_email_at: new Date().toISOString(),
      last_email_type: "estimate",
      status: "sent",
    })
    .eq("id", q.id);

  // Best-effort email log.
  await sb.from("email_log").insert({
    quote_id: q.id,
    customer_id: q.customer_id,
    shop_id: q.shop_id,
    email_type: "estimate",
    subject,
    body: html,
    recipient: customer.email,
    sent_at: new Date().toISOString(),
    status: "sent",
    resend_message_id: sendResp.data?.id ?? null,
  }).catch((e) => console.warn("[send-estimate-email] email_log insert failed:", e?.message));

  // Monitor: mirror the quote send into Klaviyo (always on, regardless of the
  // KLAVIYO_QUOTE_FLOW_ENABLED routing flag). Fire-and-forget — never blocks.
  klaviyoTrack({
    metric: "Quote Sent",
    email: customer.email,
    name: customer.name || undefined,
    phone: customer.phone || undefined,
    value: q.customer_total ?? 0,
    uniqueId: `quote-sent-${q.id}`,
    properties: {
      quote_id: q.id,
      quote_number: q.quote_number || "",
      shop_name: shop?.name || "",
      vehicle,
      subject,
      channel: "resend",
    },
  }).catch(() => {});

  return json(200, {
    success: true,
    messageId: sendResp.data?.id ?? null,
    sentTo: customer.email,
  });
});
