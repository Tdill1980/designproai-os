/**
 * WPW-SHOPFLOW — the guest door to /shopflow.
 *
 * Owner, 2026-09-13: "create a real shopflow page that we can give out for wpw
 * accounts/orders … you must have your account log in or email."
 *
 * THE PAGE ALREADY EXISTS AND IS GOOD. `/shopflow` reads `wpw-orders-read` for a
 * signed-in RestylePro user with a linked Woo customer. This function does not
 * replace any of that and is never called on that path. It adds the OTHER door,
 * because the signed-in one reaches almost nobody:
 *
 *     WPW orders ........................................ 2,326
 *     distinct customer emails ............................. 809
 *     orders linked to a RestylePro user ................... 118
 *     users who can therefore open the page .................. 8
 *
 * (measured 2026-09-14). WePrintWraps customers check out on WordPress and never
 * create a RestylePro account, so handing 801 of 809 of them a link to a sign-in
 * wall is the same dead end as the tracker that was just removed, only politer.
 *
 * THE DOOR IS AN EMAIL, NEVER AN ORDER NUMBER. A visitor names an email and ONE
 * order number that genuinely belongs to it. That proves ownership of the EMAIL;
 * the token minted is bound to the email and the order number is spent, not
 * carried. The old WrapCommandAI tracker looked orders up by order number alone
 * on a public page with no RLS — count upward, read other people's orders. That
 * is the one thing this must never reintroduce.
 *
 * Reads are scoped by the email the SERVER resolved from the verified token.
 * Nothing in the request body is ever the filter.
 *
 * A failed unlock returns ONE message whether the order is absent or the email
 * is wrong. Confirming an order number is real to someone who cannot produce its
 * email is the same leak in a politer form.
 *
 * Rows come back in `wpw-orders-read`'s own `WpwOrder` shape, on purpose, so the
 * page renders a guest's orders through the SAME card component as a signed-in
 * user's. Two shapes would be two renderers, and they would drift.
 *
 * TWO TIERS, AND WHICH ONE A GUEST GETS (owner, 2026-09-15): "ShopFlow should
 * have two parts — one is enter job number and see only that shopflow, then once
 * in it has the WPW ShopFlow log in to see your order history and points page."
 *
 *   action "order"  → the ONE job whose number was entered.   ← the guest tier
 *   action "orders" → every order on the email.               ← signed-in tier
 *
 * `orders` is retained and still email-scoped, but the PAGE no longer calls it
 * for a guest. Do not "simplify" the guest path back onto it: a guest tier that
 * already shows the whole history leaves nothing behind the sign-in, which is
 * where the points, the rewards and the WallPro designs live. Showing less here
 * is the product decision AND the safer one.
 *
 * What did NOT change is the door itself. `unlock` still demands an email proven
 * with an order number, and both token-gated actions resolve the email from the
 * VERIFIED TOKEN, never from the request body. An order number alone still opens
 * nothing at all — that remains the one thing this file must never reintroduce.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { mintShopflowToken, normalizeEmail, verifyShopflowToken } from "../_shared/shopflow-tokens.ts";
import { findPatternProOrder, mergeOrdersByDate, patternProOrdersFor } from "../_shared/shopflow-patternpro.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** One wording for every failed unlock. See the header note. */
const UNLOCK_FAILED =
  "That order number and email don't match an order we can find. Check both — the email has to be the one used on the order.";

/** ONE refusal shape for every token-gated action, so `order` and `orders`
 *  cannot drift into telling a visitor two different things about one token. */
function unauthorized(reason: unknown) {
  const expired = reason === "expired";
  return {
    ok: false,
    error: expired ? "expired" : "unauthorized",
    message: expired
      ? "This link has expired. Enter your email and your order number to open it again."
      : "Enter your email and your order number to open your ShopFlow.",
  };
}

/** Mirrors the columns wpw-orders-read returns, so the page's existing card
 *  component renders a guest's orders with no second code path. */
const ORDER_COLUMNS =
  "id,woo_customer_id,user_id,order_number,status,currency,total,subtotal,shipping_total,tax_total," +
  "payment_method,date_created,date_modified,date_completed,customer_email,customer_name," +
  "tracking_number,tracking_carrier,tracking_url,order_key,pay_url,customer_note,billing,shipping,raw";

/** 24 hours — see the third-door note. Not the 30-day guest-door default. */
const MINT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * base64(HMAC-SHA256(rawBody, secret)), compared in constant time.
 *
 * Constant time matters even here: a byte-at-a-time `===` on a signature is
 * the one remote-timing oracle that turns "you need the secret" into "you need
 * enough requests".
 */
async function validMintSignature(secret: string, rawBody: string, provided: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
  let bin = "";
  for (const b of mac) bin += String.fromCharCode(b);
  const expected = btoa(bin);
  const a = enc.encode(expected);
  const b = enc.encode(provided);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function svc() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

/** Line items for the card's "· item, item" line, read off the stored Woo
 *  payload so this needs no extra table or join. */
function itemsFrom(raw: unknown) {
  const lineItems = (raw as { line_items?: unknown[] })?.line_items;
  if (!Array.isArray(lineItems)) return [];
  return lineItems.slice(0, 12).map((i) => {
    const item = i as Record<string, unknown>;
    return {
      id: Number(item.id ?? 0) || 0,
      name: item.name == null ? null : String(item.name),
      quantity: Number(item.quantity ?? 0) || null,
      total: item.total == null ? null : Number(item.total),
      image_url: null,
      meta: null,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const db = svc();
  if (!db) return json(503, { ok: false, error: "unavailable" });

  // Read the RAW bytes once. `mint`'s signature is computed over the exact
  // body WordPress sent, so re-serialising a parsed object would not verify.
  let rawBody = "";
  try { rawBody = await req.text(); } catch { /* treated as malformed below */ }
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody || "{}");
  } catch { /* an empty body is malformed, and falls through to unknown_action */ }
  const action = String(body.action || "");

  try {
    // ── UNLOCK ───────────────────────────────────────────────────────────
    // Proves ownership of an EMAIL. The order number is the shared secret
    // spent to prove it; it grants nothing by itself and is not carried on.
    if (action === "unlock") {
      const email = normalizeEmail(body.email);
      const orderNum = String(body.order_number ?? "").trim().replace(/^#/, "");
      if (!email || !orderNum) return json(200, { ok: false, error: "missing_fields", message: UNLOCK_FAILED });
      // Two columns only. A generous select here leaks an order's contents
      // through a call that has not yet proven anything.
      const { data: order, error } = await db
        .from("wpw_orders")
        .select("order_number,customer_email")
        .eq("order_number", orderNum)
        .limit(1)
        .maybeSingle();
      if (error) return json(503, { ok: false, error: "unavailable" });
      if (!order || normalizeEmail(order.customer_email) !== email) {
        // A PatternPro reference (PP-XXXXXXXX, Stripe, wbty_orders) opens the
        // same door under the same rule: the reference is spent to prove the
        // EMAIL, and only a row carrying that email counts.
        const pp = await findPatternProOrder(db, orderNum, email);
        if (!pp) return json(200, { ok: false, error: "no_match", message: UNLOCK_FAILED });
      }
      return json(200, { ok: true, token: await mintShopflowToken(email), email });
    }

    // ── MINT ─────────────────────────────────────────────────────────────
    // WordPress has already authenticated this customer. It signs the request
    // with a secret only the server holds; we verify that, and only that,
    // before minting. See the third-door note at the top of this file.
    if (action === "mint") {
      const secret = Deno.env.get("WPW_SHOPFLOW_MINT_SECRET");
      // No secret, no minting. There is deliberately no fallback: a guessable
      // key here would hand out a token for any email anyone asked for.
      if (!secret || secret.length < 32) return json(503, { ok: false, error: "unavailable" });
      const provided = req.headers.get("x-wpw-signature") || "";
      if (!provided || !(await validMintSignature(secret, rawBody, provided))) {
        return json(401, { ok: false, error: "unauthorized" });
      }
      const email = normalizeEmail(body.email);
      if (!email || !email.includes("@")) return json(400, { ok: false, error: "missing_email" });
      // 24 hours. WordPress re-mints on every page load, so a longer life buys
      // nothing and costs a month of validity to anything that leaks.
      return json(200, { ok: true, token: await mintShopflowToken(email, MINT_TTL_MS), email });
    }

    // ── ONE ORDER ────────────────────────────────────────────────────────
    // THE FIRST DOOR (owner, 2026-09-15): "enter job number and see only that
    // shopflow — then once in it has the WPW ShopFlow log in to see your order
    // history and points page."
    //
    // So the guest tier is deliberately ONE JOB, not the whole history. That is
    // a product decision and a privacy one at the same time, and it only looks
    // like a restriction: the email proof in `unlock` is unchanged, so this is
    // strictly LESS exposure than handing a guest every order on the account.
    // The history, the points and the rewards are what the sign-in is FOR — if
    // the guest tier already showed them, nothing would be behind the door.
    //
    // Scoping is still the server's, never the caller's: the email comes off the
    // verified token and the order must match BOTH the requested number and that
    // email. A token for one customer cannot read another customer's job by
    // naming its number, which is the same rule `orders` follows.
    if (action === "order") {
      const verified = await verifyShopflowToken(body.token);
      if (!verified.ok) return json(200, unauthorized(verified.reason));
      const email = verified.email;
      const orderNum = String(body.order_number ?? "").trim().replace(/^#/, "");
      if (!orderNum) return json(200, { ok: false, error: "no_match", message: UNLOCK_FAILED });
      const { data: order, error } = await db
        .from("wpw_orders")
        .select(ORDER_COLUMNS)
        .eq("order_number", orderNum)
        .eq("customer_email", email)
        .limit(1)
        .maybeSingle();
      if (error) return json(503, { ok: false, error: "unavailable" });
      if (!order) {
        // Not a Woo order — a PatternPro reference, scoped to the same verified email.
        const pp = await findPatternProOrder(db, orderNum, email);
        if (!pp) return json(200, { ok: false, error: "no_match", message: UNLOCK_FAILED });
        return json(200, {
          ok: true, linked: true, guest: true, single: true, email,
          customer_name: pp.customer_name ?? null,
          orders: [pp],
          fetched_at: new Date().toISOString(),
        });
      }
      const { raw, ...row } = order as Record<string, unknown>;
      return json(200, {
        ok: true,
        linked: true,
        guest: true,
        // The guest tier shows ONE job. `orders` is still an array so the page
        // renders it through the SAME card component as a signed-in customer —
        // a second shape would become a second renderer, and they would drift.
        single: true,
        email,
        customer_name: row.customer_name ?? null,
        orders: [{ ...row, wpw_order_items: itemsFrom(raw) }],
        fetched_at: new Date().toISOString(),
      });
    }

    // ── ORDERS ───────────────────────────────────────────────────────────
    if (action === "orders") {
      const verified = await verifyShopflowToken(body.token);
      if (!verified.ok) return json(200, unauthorized(verified.reason));
      const email = verified.email;
      const { data: orders, error } = await db
        .from("wpw_orders")
        .select(ORDER_COLUMNS)
        .eq("customer_email", email)
        .order("date_created", { ascending: false })
        .limit(100);
      if (error) return json(503, { ok: false, error: "unavailable" });
      const rows = (orders || []) as Record<string, unknown>[];
      // PatternPro orders (Stripe, wbty_orders) for the SAME verified email,
      // merged newest-first so the page has one list and one card.
      const patternPro = await patternProOrdersFor(db, email);
      const merged = mergeOrdersByDate(
        rows.map(({ raw, ...order }) => ({ ...order, wpw_order_items: itemsFrom(raw) })) as Array<Record<string, unknown> & { date_created?: string | null }>,
        patternPro as unknown as Array<Record<string, unknown> & { date_created?: string | null }>,
      );
      return json(200, {
        ok: true,
        // `linked:true` is what the page checks before rendering the list. A
        // guest who proved their email HAS an identity here; they just do not
        // have a RestylePro account, which is a different thing.
        linked: true,
        guest: true,
        email,
        customer_name: (rows.find((o) => o.customer_name)?.customer_name ?? patternPro.find((o) => o.customer_name)?.customer_name) ?? null,
        orders: merged,
        fetched_at: new Date().toISOString(),
      });
    }

    return json(400, { ok: false, error: "unknown_action" });
  } catch (e) {
    console.error("[wpw-shopflow]", e);
    return json(500, { ok: false, error: "failed" });
  }
});
