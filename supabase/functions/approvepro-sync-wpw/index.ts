/**
 * approvepro-sync-wpw — auto-create draft proofs for the shop's WPW
 * design orders so every WooCommerce design job lands in /approvepro
 * automatically with renders pre-attached. Designers only have to
 * click Send (or use the one-click email Approve/Decline buttons the
 * customer sees once the proof is sent).
 *
 * Idempotent — orders already linked to a proof
 * (proof_approvals.metadata.wpw_woo_order_id) are skipped. Returns
 * { created, skipped, total } so the frontend can display a toast.
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// WPW internal staff — they ARE the shop. They get every WPW design
// order in their ApprovePro queue, regardless of which customer placed
// it. Mirrors src/lib/admin-allowlist.ts WPW_INTERNAL_STAFF_ALLOWLIST.
const WPW_INTERNAL_STAFF = new Set([
  "tdill@restyleproai.com",
  "trish@restyleproai.com",
  "trish@weprintwraps.com",
  "lance@weprintwraps.com",
  "brice@weprintwraps.com",
  "jackson@weprintwraps.com",
  "troy@weprintwraps.com",
  "wyatt-cto@weprintwraps.com",
  "amanda@restyleproai.com",
  "amandakinz1111@gmail.com",
  "carley@restyleproai.com",
]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Deterministic design-order recognition — mirrors the client's
// DESIGN_ORDER_PRODUCT_IDS (src/lib/wpw-design-products.ts). Only orders that
// contain a PAID DESIGN product are ingested into ApprovePro:
//   234 / 58160  CHWD  Custom / Full Wrap Design ($500 / $975)
//   290          HD    Hourly Design (~$90)
//   289          DSFO  Design Setup / File Output (the "Output fee")
// Pure print / material orders (printed wrap film, UV lamination, contour-cut
// vinyl) contain none of these and are never created as proofs.
const DESIGN_ORDER_PRODUCT_IDS = new Set([234, 58160, 290, 289]);
const DESIGN_ORDER_SKUS = new Set(["CHWD", "HD", "DSFO"]);

function isLikelyDesignOrder(items: any[]): boolean {
  if (!items || items.length === 0) return false;
  return items.some((it) => {
    const pid = Number(it?.product_id);
    if (Number.isFinite(pid) && DESIGN_ORDER_PRODUCT_IDS.has(pid)) return true;
    const sku = String(it?.sku || "").toUpperCase();
    if (DESIGN_ORDER_SKUS.has(sku)) return true;
    // Name fallback for any order missing product_id/sku on its items.
    const n = (it?.name || "").toLowerCase();
    return (
      n.includes("wrap design") ||
      n.includes("hourly design") ||
      (n.includes("design") && (n.includes("setup") || n.includes("output") || n.includes("file output")))
    );
  });
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif|svg)(\?|$)/i;
const DOC_EXT_RE = /\.(pdf|ai|psd|eps|svg|zip|rar|doc|docx)(\?|$)/i;
const URL_RE = /^https?:\/\/\S+$/i;

function isImageUrl(s: string): boolean {
  if (!URL_RE.test(s)) return false;
  // Strict: only honour known image extensions. PDFs live under
  // wp-content/uploads too, so the old "any wp-content path = image"
  // heuristic broke on PDF references.
  return IMAGE_EXT_RE.test(s);
}

function isDocumentUrl(s: string): boolean {
  if (!URL_RE.test(s)) return false;
  return DOC_EXT_RE.test(s);
}

function extractStringValues(v: any): string[] {
  // Woo "Upload Files" plugins store either a plain URL string, an array
  // of URLs, or a JSON-stringified array. Normalise to a flat list of
  // candidate strings.
  if (v == null) return [];
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith("[") || s.startsWith("{")) {
      try {
        const parsed = JSON.parse(s);
        return extractStringValues(parsed);
      } catch {
        return [s];
      }
    }
    return [s];
  }
  if (Array.isArray(v)) return v.flatMap((x) => extractStringValues(x));
  if (typeof v === "object") {
    return Object.values(v).flatMap((x) => extractStringValues(x));
  }
  return [];
}

interface BriefAndUploads {
  /** Combined order-level note + line-item brief (for legacy display) */
  customerNote: string | null;
  /** ONLY the order-level customer-provided note from Woo */
  orderNote: string | null;
  /** ONLY the line-item brief ("Please describe…" answer) */
  itemBrief: string | null;
  uploads: string[];
  documents: string[];
}

// Common car/truck makes — used to parse vehicle from free-text briefs
// like "This is for a 2019 Infiniti Q 50 Luxe…". We only set
// year/make/model when we can match a known make so we don't pollute
// the proof with garbage.
const VEHICLE_MAKES = [
  "acura","alfa romeo","aston martin","audi","bentley","bmw","buick","cadillac",
  "chevrolet","chevy","chrysler","dodge","ferrari","fiat","ford","genesis","gmc",
  "honda","hyundai","infiniti","jaguar","jeep","kia","lamborghini","land rover",
  "lexus","lincoln","maserati","mazda","mclaren","mercedes-benz","mercedes","mini",
  "mitsubishi","nissan","peugeot","polestar","porsche","ram","renault","rivian",
  "rolls-royce","saab","scion","smart","subaru","suzuki","tesla","toyota",
  "volkswagen","vw","volvo",
];

function parseVehicle(text: string | null | undefined): { year: string | null; make: string | null; model: string | null } {
  if (!text) return { year: null, make: null, model: null };
  const lower = text.toLowerCase();
  const yearMatch = text.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  const year = yearMatch ? yearMatch[1] : null;
  for (const make of VEHICLE_MAKES) {
    // Word-boundary match so short makes like "ram" / "kia" / "bmw"
    // don't false-positive inside words like "ceramic" or "asKIA".
    const re = new RegExp(`(^|[^a-z0-9])${make.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    const m = re.exec(lower);
    if (!m) continue;
    const idx = m.index + m[1].length;
    const after = text.slice(idx + make.length).trim();
    // Take up to 3 short tokens after the make as the model — stop at
    // punctuation or anything that doesn't look like a model token.
    const modelMatch = after.match(/^[\s,.-]*([A-Za-z0-9][A-Za-z0-9\- ]{0,30}?)(?=[.,;!?\n]|$)/);
    let model = modelMatch ? modelMatch[1].trim() : null;
    if (model) {
      // Trim to first ~3 tokens (e.g. "Q 50 Luxe" → keep, but cap length)
      const tokens = model.split(/\s+/).slice(0, 4);
      model = tokens.join(" ").slice(0, 60);
      if (!model) model = null;
    }
    const display = make === "vw" ? "Volkswagen" : make === "chevy" ? "Chevrolet" : make.replace(/\b\w/g, (c) => c.toUpperCase());
    return { year, make: display, model: model || null };
  }
  return { year, make: null, model: null };
}

function extractBriefAndUploads(order: any, items: Array<{ meta: any }>): BriefAndUploads {
  // Accept either a row from wpw_orders (with customer_note column) or
  // the raw Woo JSON. Both store the field as `customer_note`.
  const rawOrder = order;
  const uploads: string[] = [];
  const documents: string[] = [];
  // Long-text candidates (any meta whose value looks like a paragraph,
  // not a URL / not numeric). We score by length; longest wins.
  let bestNote: string | null = null;
  let bestNoteLen = 0;

  // Order-level customer_note from Woo — usually short and contains
  // vehicle info ("This is for a 2019 Infiniti Q 50…"). Pulled from
  // the dedicated wpw_orders.customer_note column (raw is null'd by
  // wpw-sync-orders to avoid OOM, so we can't read raw.customer_note).
  let orderLevelNote: string | null = null;
  const noteSource =
    typeof rawOrder?.customer_note === "string" ? rawOrder.customer_note :
    typeof (rawOrder as any)?.order_customer_note === "string" ? (rawOrder as any).order_customer_note :
    null;
  if (noteSource) {
    const s = noteSource.trim();
    if (s.length > 0) orderLevelNote = s.slice(0, 2000);
  }

  for (const it of items) {
    const metaArr = Array.isArray(it.meta) ? it.meta : [];
    for (const m of metaArr) {
      // Don't skip ANY meta entry. The customer's brief + upload URLs
      // sit deeply nested inside Woo plugin meta like `_tmcartepo_data`,
      // `_tmdata`, `_tmpost_data`. extractStringValues descends through
      // arrays + objects so any string anywhere in the structure is
      // surfaced as a candidate.
      const key = String(m?.key || m?.display_key || "").trim();
      const keyLower = key.toLowerCase();

      // Pull every string value out of the meta entry — recursively.
      const candidates = [
        ...extractStringValues(m?.value),
        ...extractStringValues(m?.display_value),
      ];

      for (const raw of candidates) {
        const trimmed = raw.trim();
        if (!trimmed) continue;

        // Image URL → customer-uploaded reference
        if (isImageUrl(trimmed)) {
          if (!uploads.includes(trimmed)) uploads.push(trimmed);
          continue;
        }

        // PDF / AI / PSD etc → customer-supplied document, not an image
        if (isDocumentUrl(trimmed)) {
          if (!documents.includes(trimmed)) documents.push(trimmed);
          continue;
        }

        // URL but not an image — skip (e.g. product permalinks)
        if (URL_RE.test(trimmed)) continue;

        // HTML markup (e.g. <a href="...">...</a> from a Woo display field)
        // is never the customer's brief — skip it cleanly.
        if (/^<[a-z]/i.test(trimmed) || /<\/[a-z]+>/i.test(trimmed)) continue;

        // Numeric / very short → not a brief
        if (trimmed.length < 20) continue;
        if (/^\d+(\.\d+)?$/.test(trimmed)) continue;

        // Prefer entries whose KEY hints at description / brief / project,
        // otherwise fall back to longest text seen.
        const keyHints =
          keyLower.includes("describe") ||
          keyLower.includes("description") ||
          keyLower.includes("project") ||
          keyLower.includes("brief") ||
          keyLower.includes("note") ||
          keyLower.includes("request") ||
          keyLower.includes("detail") ||
          keyLower.includes("info") ||
          keyLower.includes("design");

        const len = trimmed.length;
        if (keyHints && len >= 20) {
          // Strong match — take immediately if longer than current best
          if (len > bestNoteLen) {
            bestNote = trimmed.slice(0, 4000);
            bestNoteLen = len;
          }
        } else if (len > bestNoteLen && len >= 60) {
          // Weak match — only if substantially long
          bestNote = trimmed.slice(0, 4000);
          bestNoteLen = len;
        }
      }
    }
  }

  // Combine order-level note + line-item brief when both exist so the
  // designer sees vehicle info AND the wrap brief in the amber box.
  let combined: string | null = bestNote;
  if (orderLevelNote && bestNote && !bestNote.includes(orderLevelNote)) {
    combined = `${orderLevelNote}\n\n${bestNote}`.slice(0, 4000);
  } else if (orderLevelNote && !bestNote) {
    combined = orderLevelNote;
  }

  return {
    customerNote: combined,
    orderNote: orderLevelNote,
    itemBrief: bestNote,
    uploads: uploads.slice(0, 12),
    documents: documents.slice(0, 12),
  };
}

// Mint a token without HMAC for draft rows. Drafts cannot be opened
// publicly anyway (status=draft is rejected by proof-view), and when
// the shop hits Send the row is preserved — only proof-send transitions
// it to 'sent'. Real HMAC tokens get minted on Send via proof-send's
// flow (it doesn't re-mint, but the existing token works because we
// generate it server-side here using crypto.randomUUID).
//
// To keep parity with proof-create's HMAC tokens we still derive a
// signed token here using the same secret + format.
async function mintHmacToken(kind: "view" | "manage"): Promise<string> {
  const uuid = crypto.randomUUID();
  const secret = Deno.env.get("PROOF_TOKEN_SECRET");
  if (!secret || secret.length < 32) {
    throw new Error("PROOF_TOKEN_SECRET missing or too short");
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(`${kind}:${uuid}`)),
  );
  let bin = "";
  for (let i = 0; i < sigBytes.length; i++) bin += String.fromCharCode(sigBytes[i]);
  const sig = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${uuid}.${sig}`;
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "Authentication required" }, 401);

    // Service-role bypass — when called server-side (admin-triggered
    // sweeps) the caller passes a service-role JWT and { shop_id,
    // user_email } in the body. We decode the JWT and check the role
    // claim instead of string-comparing against env vars (which can
    // drift between legacy and new key formats).
    const incomingToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    let isServiceRole = false;
    try {
      const parts = incomingToken.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (payload?.role === "service_role") isServiceRole = true;
      }
    } catch { /* not a JWT — fine */ }
    // Fallback: a direct match against the project's service-role key. Handles
    // the new non-JWT key format (sb_secret_…) where the decode above can't
    // read a role claim. Lets server-side cron callers (cron-ingest-wpw) in.
    if (!isServiceRole && serviceRoleKey && incomingToken === serviceRoleKey) {
      isServiceRole = true;
    }

    let user: { id: string; email: string | null };
    if (isServiceRole && body?.shop_id) {
      user = { id: String(body.shop_id), email: body.user_email ? String(body.user_email) : null };
    } else {
      const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user: authedUser }, error: authError } = await authClient.auth.getUser();
      if (authError || !authedUser) return jsonResponse({ error: "Invalid auth token" }, 401);
      user = { id: authedUser.id, email: authedUser.email || null };
    }
    // WPW internal staff (Trish, Lance, Brice, Troy, …) ALL share ONE canonical
    // queue. Previously every staff member's sync stamped orders with their OWN
    // user id, so the SAME WooCommerce order got duplicated per-person and landed
    // in different shops — the "I got the email but can't find the order, it's
    // under someone else's shop" bug. Routing them all to one shop_id lets the
    // (shop_id, woo_id) unique index dedupe globally, and the team-sharing RLS
    // already shows the whole team that single queue. Non-staff (linked SaaS
    // customers) keep their own shop so they only see their own orders.
    const isInternalStaff = WPW_INTERNAL_STAFF.has((user.email || "").toLowerCase());
    const CANONICAL_WPW_SHOP = Deno.env.get("WPW_CANONICAL_SHOP_ID") || "61cc6c1c-554c-440c-8e07-a64469f1f4eb";
    const shopId = isInternalStaff ? CANONICAL_WPW_SHOP : user.id;

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    let shopWooCustomerId: number | null = null;

    if (!isInternalStaff) {
      const { data: subRow } = await db
        .from("user_subscriptions")
        .select("woo_customer_id")
        .eq("user_id", shopId)
        .not("woo_customer_id", "is", null)
        .maybeSingle();

      if (!subRow?.woo_customer_id) {
        return jsonResponse({
          ok: true,
          linked: false,
          created: 0,
          skipped: 0,
          total: 0,
          message: "No WePrintWraps account linked.",
        });
      }
      shopWooCustomerId = subRow.woo_customer_id as number;
    }

    // Single-order mode — when the caller passes { woo_order_id: N },
    // sync only that one order and return its proof_id. Used by the
    // WpwOrdersRail click handler: when a designer taps an order that
    // doesn't yet have a linked proof, we create/find the proof on the
    // fly and select it in the workbench so the right pane immediately
    // shows the order detail (brief, uploads, vehicle info, assign-to-
    // self control) instead of dropping into an empty upload dialog.
    const singleWooOrderId =
      typeof body?.woo_order_id === "number" && Number.isFinite(body.woo_order_id)
        ? body.woo_order_id
        : typeof body?.woo_order_id === "string" && /^\d+$/.test(body.woo_order_id)
          ? Number(body.woo_order_id)
          : null;

    // Pull fresh orders from WooCommerce first so this dashboard view
    // never depends on the webhook firing. Webhook misses (Cloudflare
    // timeouts, plugin updates, etc.) used to leave ApprovePro stuck on
    // whatever was in wpw_orders. Interactive window — 30 days back —
    // keeps the response under the edge worker time budget.
    // Skip in single-order mode — we just need the one cached row, and
    // a full WooCommerce sweep on every click would make the click
    // feel sluggish for no benefit.
    if (singleWooOrderId == null) {
      try {
        const refreshRes = await db.functions.invoke("wpw-sync-orders", {
          body: { days_back: 30, per_page: 100 },
        });
        if (refreshRes.error) {
          console.warn("approvepro-sync-wpw: wpw-sync-orders refresh failed:", refreshRes.error.message || refreshRes.error);
        }
      } catch (e) {
        // Non-fatal — fall back to whatever is cached in wpw_orders.
        console.warn("approvepro-sync-wpw: wpw-sync-orders refresh threw:", e);
      }
    }

    // Pull cached WPW orders + items (last 90 days). Internal staff get
    // every order coming into the shop; paying customers only see their
    // own orders (filtered by woo_customer_id). Limit raised to 200 for
    // staff so the post-deploy backfill can sweep everything in one pass.
    const cutoff = new Date(Date.now() - NINETY_DAYS_MS).toISOString();
    let ordersQuery = db
      .from("wpw_orders")
      .select("id, order_number, customer_email, customer_name, customer_note, date_created, raw, wpw_order_items(id, product_id, sku, name, quantity, image_url, meta)")
      .gte("date_created", cutoff)
      .order("date_created", { ascending: false })
      .limit(isInternalStaff ? 200 : 60);

    if (!isInternalStaff && shopWooCustomerId != null) {
      ordersQuery = ordersQuery.eq("woo_customer_id", shopWooCustomerId);
    }

    if (singleWooOrderId != null) {
      ordersQuery = ordersQuery.eq("id", singleWooOrderId);
    }

    const { data: orders, error: ordersErr } = await ordersQuery;

    if (ordersErr) {
      console.error("approvepro-sync-wpw: orders query failed:", ordersErr);
      return jsonResponse({ error: "Failed to load WPW orders", detail: ordersErr.message }, 500);
    }

    const designOrders = (orders || []).filter((o: any) =>
      isLikelyDesignOrder(o.wpw_order_items || []) && !!o.customer_email
    );

    if (designOrders.length === 0) {
      return jsonResponse({
        ok: true,
        created: 0,
        skipped: 0,
        total: 0,
        proof_id: null,
        mode: singleWooOrderId != null ? "single" : "batch",
      });
    }

    // Find which of these orders already have a linked proof for this shop
    const { data: existingProofs } = await db
      .from("proof_approvals")
      .select("id, metadata, vehicle_year, vehicle_make, vehicle_model")
      .eq("shop_id", shopId);

    const proofByWooId = new Map<number, { id: string; metadata: any; vehicle_year: string | null; vehicle_make: string | null; vehicle_model: string | null }>();
    (existingProofs as any[] | null)?.forEach((p) => {
      const wooId = Number(p?.metadata?.wpw_woo_order_id);
      if (Number.isFinite(wooId)) proofByWooId.set(wooId, {
        id: p.id,
        metadata: p.metadata || {},
        vehicle_year: p.vehicle_year || null,
        vehicle_make: p.vehicle_make || null,
        vehicle_model: p.vehicle_model || null,
      });
    });

    let created = 0;
    let skipped = 0;
    let backfilled = 0;
    // In single-order mode the caller needs the proof_id back so the
    // workbench can select it immediately. We capture it during the
    // per-order loop below (both new-insert and backfill paths).
    let resolvedProofId: string | null = null;
    const errors: string[] = [];

    function buildRenderUrls(
      items: Array<{ image_url: string | null }>,
      uploads: string[],
    ): Record<string, string> {
      const renderUrls: Record<string, string> = {};
      // Customer's uploaded reference images take priority — these are
      // what the shop actually needs to see when designing the wrap.
      uploads.forEach((url, idx) => {
        const key = idx === 0 ? "hero" : `customer_upload_${idx + 1}`;
        renderUrls[key] = url;
      });
      // Fall back to product thumbnails so the card never goes empty.
      items.forEach((it, idx) => {
        if (!it.image_url) return;
        const key = `product_${idx + 1}`;
        if (!renderUrls[key]) renderUrls[key] = it.image_url;
        if (!renderUrls.hero) renderUrls.hero = it.image_url;
      });
      return renderUrls;
    }

    for (const o of designOrders) {
      const wooId = Number(o.id);

      try {
        const items = (o.wpw_order_items || []) as Array<{ id: string; product_id: number | null; sku: string | null; name: string | null; quantity: number | null; image_url: string | null; meta: any }>;
        // Pass the order row directly — it now carries customer_note
        // as a top-level column (wpw_orders.customer_note) since raw is
        // null'd by the sync to avoid OOM. extractBriefAndUploads reads
        // customer_note from whichever is present.
        const { customerNote, orderNote, itemBrief, uploads, documents } = extractBriefAndUploads(o, items);
        const renderUrls = buildRenderUrls(items, uploads);
        // Parse the vehicle from ALL the free-text the customer can write it in,
        // not just customerNote. WPW "Custom Wrap Design" orders put the vehicle
        // in the line-item brief (the measurements form), e.g. "2024 Chevy
        // Silverado 2500HD Extended Cab" — customerNote is often null. Reading
        // only customerNote left vehicle_make/model NULL on those orders, which
        // blocked dims + the 2D production proof downstream.
        const vehicle = parseVehicle([customerNote, itemBrief, orderNote].filter(Boolean).join("\n"));

        const designName =
          (items[0]?.name || `WPW Order ${o.order_number || wooId}`).slice(0, 200);

        // Compact line-items array stored in metadata so the designer
        // sees every product on the order, not just the first one.
        const lineItemsMeta = items.slice(0, 20).map((it) => ({
          // product_id is the DETERMINISTIC key for product recognition
          // (e.g. Custom Vehicle Wrap Design = 234 / 58160). Persisting it
          // here is what lets the workbench classify by id instead of name.
          product_id: it.product_id ?? null,
          sku: it.sku || null,
          name: (it.name || "").slice(0, 200) || null,
          quantity: typeof it.quantity === "number" ? it.quantity : null,
          image_url: it.image_url || null,
        }));

        // ── BACKFILL PATH ──
        // If a draft proof already exists for this Woo order, top up its
        // metadata with anything the previous (buggy) sync missed —
        // customer_note, customer_uploads, line_items — and refresh the
        // active version's render_urls so uploaded references show up.
        const existing = proofByWooId.get(wooId);
        if (existing) {
          const meta = existing.metadata || {};
          const metaPatch: Record<string, any> = {};
          if (!meta.customer_note && customerNote) metaPatch.customer_note = customerNote;
          if (!Array.isArray(meta.customer_uploads) || meta.customer_uploads.length === 0) {
            if (uploads.length > 0) metaPatch.customer_uploads = uploads;
          }
          if (!Array.isArray(meta.customer_documents) || meta.customer_documents.length === 0) {
            if (documents.length > 0) metaPatch.customer_documents = documents;
          }
          // Always force-set the dedicated split fields. These are the
          // source of truth for the two distinct UI boxes
          // ("Customer provided note" vs "Customer's design request").
          if (orderNote && meta.order_customer_note !== orderNote) {
            metaPatch.order_customer_note = orderNote;
          } else if (!orderNote && typeof meta.order_customer_note === "string") {
            // No order-note this time — leave whatever's there.
          }
          if (itemBrief && meta.line_item_brief !== itemBrief) {
            metaPatch.line_item_brief = itemBrief;
          }
          // Replace the customer_note in three cases:
          //  1. Legacy rows where the note is raw HTML markup
          //  2. New order-level customer_note now available (was missing
          //     before because wpw-sync-orders.customer_note column
          //     didn't exist) — re-pull combined version
          //  3. Newly-extracted note is meaningfully longer (we now
          //     have the brief) than what's there
          if (customerNote && typeof customerNote === "string") {
            const oldNote = typeof meta.customer_note === "string" ? meta.customer_note : "";
            const looksLikeHtml = /^<[a-z]/i.test(oldNote.trim());
            const newHasOrderNote = !!o.customer_note && customerNote.includes(String(o.customer_note).trim().slice(0, 60));
            const oldHasOrderNote = !!o.customer_note && oldNote.includes(String(o.customer_note).trim().slice(0, 60));
            const longerNote = customerNote.length > oldNote.length + 50;
            if (looksLikeHtml || (newHasOrderNote && !oldHasOrderNote) || longerNote || !oldNote) {
              metaPatch.customer_note = customerNote;
            }
          }
          // Refresh line_items when missing, empty, OR when the stored copy
          // predates product_id tracking. The client's "Custom Wrap Design
          // orders only" filter classifies deterministically by product_id
          // (234 / 58160); legacy rows stored only {name, quantity, image_url}
          // so that filter could never match them — design orders vanished and
          // print orders leaked in. Re-stamp with product_id so the filter works.
          const liMissingProductId =
            Array.isArray(meta.line_items) &&
            meta.line_items.length > 0 &&
            meta.line_items.every((li: any) => li == null || li.product_id == null);
          if (!Array.isArray(meta.line_items) || meta.line_items.length === 0 || liMissingProductId) {
            if (lineItemsMeta.length > 0) metaPatch.line_items = lineItemsMeta;
          }

          const rowPatch: Record<string, any> = {};
          if (!existing.vehicle_year && vehicle.year) rowPatch.vehicle_year = vehicle.year;
          if (!existing.vehicle_make && vehicle.make) rowPatch.vehicle_make = vehicle.make;
          if (!existing.vehicle_model && vehicle.model) rowPatch.vehicle_model = vehicle.model;
          if (Object.keys(metaPatch).length > 0) rowPatch.metadata = { ...meta, ...metaPatch };

          if (Object.keys(rowPatch).length > 0) {
            const { error: upMetaErr } = await db
              .from("proof_approvals")
              .update(rowPatch as any)
              .eq("id", existing.id);
            if (upMetaErr) {
              errors.push(`backfill ${wooId}: ${upMetaErr.message}`);
            }
          }

          // Refresh the active version's render_urls if it has nothing
          // (or only product thumbnails) and we now have customer uploads.
          if (uploads.length > 0) {
            const { data: activeVer } = await db
              .from("proof_versions")
              .select("id, render_urls")
              .eq("proof_id", existing.id)
              .eq("is_active", true)
              .maybeSingle();
            const currentUrls = (activeVer as any)?.render_urls || {};
            const hasCustomerUpload = Object.keys(currentUrls).some((k) => k === "hero" || k.startsWith("customer_upload_"))
              && Object.values(currentUrls).some((u: any) => uploads.includes(String(u)));

            if (activeVer && !hasCustomerUpload) {
              await db
                .from("proof_versions")
                .update({ render_urls: renderUrls } as any)
                .eq("id", (activeVer as any).id);
            } else if (!activeVer) {
              await db.from("proof_versions").insert({
                proof_id: existing.id,
                version_number: 1,
                created_by_role: "system_upload",
                created_by_user_id: shopId,
                render_urls: renderUrls,
                uploaded_file_paths: [],
                prompt_text: null,
                is_active: true,
              });
            }
          }

          if (Object.keys(metaPatch).length > 0 || Object.keys(rowPatch).length > 0 || uploads.length > 0) backfilled++;
          else skipped++;
          if (singleWooOrderId === wooId) resolvedProofId = existing.id;
          continue;
        }

        const [viewToken, manageToken] = await Promise.all([
          mintHmacToken("view"),
          mintHmacToken("manage"),
        ]);

        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

        const { data: proofRow, error: insertErr } = await db
          .from("proof_approvals")
          .insert({
            shop_id: shopId,
            view_token: viewToken,
            manage_token: manageToken,
            customer_email: o.customer_email,
            customer_name: o.customer_name || null,
            design_name: designName,
            vehicle_year: vehicle.year,
            vehicle_make: vehicle.make,
            vehicle_model: vehicle.model,
            mode: "revision_loop",
            status: "draft",
            expires_at: expiresAt,
            // Customer self-serve "Revise with AI" only appears when allowed > 0.
            // Seed WPW orders with 3 so the customer can fix small things (a
            // letter, a color) from their phone instead of having no revise
            // option at all. Autogen also bumps this to max(current, 3).
            ai_revisions_allowed: 3,
            has_line_items: false,
            metadata: {
              auto_ingested: "wpw",
              wpw_order_id: o.id,
              wpw_order_number: o.order_number || null,
              wpw_woo_order_id: wooId,
              line_items: lineItemsMeta,
              customer_note: customerNote,
              order_customer_note: orderNote,
              line_item_brief: itemBrief,
              customer_uploads: uploads,
              customer_documents: documents,
            },
          })
          .select("id")
          .single();

        if (insertErr || !proofRow) {
          errors.push(`order ${wooId}: ${insertErr?.message || "insert failed"}`);
          continue;
        }

        // Initial draft version with the customer's uploaded reference
        // images attached so the shop sees them in /approvepro without
        // further work.
        const { error: versionErr } = await db
          .from("proof_versions")
          .insert({
            proof_id: proofRow.id,
            version_number: 1,
            created_by_role: "system_upload",
            created_by_user_id: shopId,
            render_urls: renderUrls,
            uploaded_file_paths: [],
            prompt_text: null,
            is_active: true,
          });

        if (versionErr) {
          // Don't block — proof exists, just no version. Log it.
          console.warn(`approvepro-sync-wpw: version insert failed for ${proofRow.id}:`, versionErr);
        }

        await db.from("proof_events").insert({
          proof_id: proofRow.id,
          event_type: "created",
          actor_role: "system",
          actor_user_id: shopId,
          payload: {
            source: "wpw_auto_ingest",
            wpw_woo_order_id: wooId,
            wpw_order_number: o.order_number || null,
            line_item_count: items.length,
            customer_upload_count: uploads.length,
          },
        });

        created++;
        if (singleWooOrderId === wooId) resolvedProofId = proofRow.id;
      } catch (err: any) {
        errors.push(`order ${wooId}: ${err?.message || "unknown"}`);
      }
    }

    return jsonResponse({
      ok: true,
      linked: true,
      created,
      skipped,
      backfilled,
      total: designOrders.length,
      proof_id: resolvedProofId,
      mode: singleWooOrderId != null ? "single" : "batch",
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (err: any) {
    console.error("approvepro-sync-wpw: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error", detail: err?.message }, 500);
  }
});
