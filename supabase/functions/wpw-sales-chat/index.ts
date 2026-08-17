// ──────────────────────────────────────────────────────────────────────
// wpw-sales-chat — RestylePro-native sales chat for weprintwraps.com
//
// PUBLIC endpoint (verify_jwt = false, CORS-open) behind the site chat
// widget (public/embeds/wpw-chat-widget.js). Answers pricing/product
// questions with REAL numbers from the WPW catalog and hands out
// add-to-cart links. Runs on this project's own ANTHROPIC_API_KEY —
// no WrapCommand dependency.
//
// Layering:
//   1. DETERMINISTIC pricing — sqft × catalog price is computed in code
//      and injected into the model's context, so quotes are never made up.
//   2. Claude (haiku) writes the conversational reply around those facts.
//   3. EVERY chat is persisted to wpw_chat_conversations with the full
//      transcript (per-message timestamps) + IP geolocation.
//   4. On the FIRST message of a session the WPW team is emailed (best-effort),
//      so a chat is never lost even when the visitor never leaves an email.
//   5. If the visitor includes an email address, the lead is forwarded to
//      wpw-calc-lead (saved + emailed to Trish) and — when WORKFORCE_SENDS_ENABLED
//      is on — enrolled in the same 3/5/7-day retarget drip quotes use.
//
// Request:  POST { message, session_id?, history?, page_path?, referrer? }
// Response: { ok, reply, priced?: {product, sqft, total, cart_url} }
// ──────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { klaviyoTrack } from "../_shared/klaviyo-track.ts";
import { resolveVehicleSpecs } from "../_shared/vehicle-specs-lookup.ts";
import { graphMailConfigured, sendGraphMail } from "../_shared/graph-mail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const NOTIFY_TO = "trish@weprintwraps.com";
const RETARGET_DAYS = [3, 5, 7];
const MS_PER_DAY = 86_400_000;
const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// WPW catalog — ids/prices must match the live Woo store.
//
// LINK RULE (verified live 2026-08-11 — do NOT revert to /cart/?add-to-cart=):
// These products are TM Extra Product Options configurators. They require
// Height, Width, Quantity, Lamination Choice and more before Woo will accept
// them, so a bare `/cart/?add-to-cart=<id>&quantity=<sqft>` URL adds NOTHING —
// the customer lands on an EMPTY cart reading "Height missing. Width missing.
// 'Quantity' is a required field. 'Lamination Choice' is a required field."
// Every quote we handed out carried that dead link. Send `url` (the real
// product page) so the customer configures and buys.
const CATALOG = [
  { key: "avery", id: 79, name: "Avery MPI 1105 + DOL 1460Z laminate", price: 5.27, per: "sqft", pattern: /avery|mpi ?1105/i, url: "https://weprintwraps.com/our-products/avery-1105egrs-with-doz13607-lamination/" },
  { key: "3m", id: 72, name: "3M IJ180Cv3 + 8518 laminate", price: 5.27, per: "sqft", pattern: /3 ?m|ij ?180/i, url: "https://weprintwraps.com/our-products/3m-ij180-printed-wrap-film/" },
  { key: "perf", id: 80, name: "Perforated Window Vinyl 50/50", price: 5.95, per: "sqft", pattern: /perf|window vinyl|50\/50/i, url: "https://weprintwraps.com/our-products/perforated-window-vinyl-5050-unlaminated/" },
  { key: "wall", id: 70093, name: "Wall Wrap Printed Vinyl", price: 3.25, per: "sqft", pattern: /wall/i, url: "https://weprintwraps.com/our-products/wall-wrap-printed-vinyl/" },
  { key: "avery_contour", id: 108, name: "Avery Contour-Cut", price: 6.32, per: "sqft", pattern: /avery contour/i, url: "https://weprintwraps.com/our-products/avery-cut-contour-vinyl-graphics-54-roll-max-artwork-size-50/" },
  { key: "3m_contour", id: 19420, name: "3M Contour-Cut", price: 6.92, per: "sqft", pattern: /3 ?m contour/i, url: "https://weprintwraps.com/our-products/3m-cut-contour-vinyl-graphics-54-roll-max-artwork-size-50/" },
];

// The one place a buy link is built. Product page, never a raw add-to-cart.
const CATALOG_BY_KEY = Object.fromEntries(CATALOG.map((c) => [c.key, c]));
function buyUrl(product: { url: string }, _sqft?: number) {
  return product.url;
}

const SYSTEM_PROMPT = `You are the sales assistant for We Print Wraps (weprintwraps.com) — a US wrap-print shop. Wholesale-friendly, fast, no fluff. You help visitors price printed wrap material and buy it NOW.

FACTS (never contradict):
- Printed wrap film: Avery MPI 1105 or 3M IJ180Cv3, both $5.27/sq ft, premium laminate included. Window perf 50/50 $5.95/sq ft. Wall vinyl $3.25/sq ft. Contour-cut: Avery $6.32, 3M $6.92/sq ft.
- Typical full-wrap coverage: sedan ~250 sqft, pickup ~350, cargo van ~450, Sprinter 170 ~550, box truck ~600.
- Wrap By The Yard patterns: $95.50/linear yard (60" wide).
- InkFusion premium paint-quality printed vinyl: $2,075 per full roll (375 sq ft, 60" wide, Avery SW900), ordered through the PrintPro Suite. FadeWraps pre-designed fade graphics start at $600 (driver + passenger sides).
- Custom wrap design service: $975 (design + print-ready files).
- FLEET / BULK VOLUME DISCOUNTS on total order sq ft — automatic, quote them proactively to any shop, franchise or fleet: 500–999 sq ft = 5% off · 1,000–1,499 = 10% off · 1,500–2,499 = 15% off · 2,500+ = 20% off (that's $4.22/sq ft on printed wrap film at the top tier). price_wrap_material and create_quote apply this for you — use the discounted total they return, name the tier, and if they're just under one, say how many sq ft gets them to the next break. That's usually 2-3 vehicles.
- HOW THEY ACTUALLY GET IT: the product page always shows LIST price, so the discount is a real WooCommerce coupon the customer enters at checkout — FLEET5 / FLEET10 / FLEET15 / FLEET20 for the 5/10/15/20% tiers. Whenever you state a discounted price you MUST hand over the matching code in the same breath ("enter FLEET10 at checkout"), or they will land on the product page, see list price and think you were wrong. Never give a code for a tier they have not reached; the coupon enforces its own minimum and will be rejected.
- FREE shipping at $750+. Open press time this week: orders ship in 1-2 business days.
- Free print-file check: they attach the file RIGHT HERE in this chat (the paperclip button) and you run check_artwork on it. They can also email it to hello@weprintwraps.com. Do NOT send them to weprintwraps.com/instant-quote — that page does not exist (404).
- Phone: 549-622-4678. Email: hello@weprintwraps.com.

BRAND FAMILY — you represent the whole family, not just the print shop. Route people to the right product and pitch it confidently:
- We Print Wraps (weprintwraps.com) — the PRINT shop: printed wrap film, contour-cut, perf, wall vinyl. Print-and-ship, no installs.
- RestyleProAI (restyleproai.com) — the AI DESIGN + PREVIEW platform: photorealistic wrap previews on the customer's exact vehicle before anything prints. Free to try.
- DesignProAI (restyleproai.com/designpro) — AI custom wrap DESIGN from a plain-English brief: unique design on their exact vehicle, every angle, plus a dimensioned 2D proof. The human-designed alternative is the $975 custom design service.
- CreatorMarket (restyleproai.com/creatormarket) — marketplace of ready-made pro wrap designs, typically $350 per design.
PITCH RULES: needs a design (not just print) → DesignProAI or the $975 service. Wants to SEE it on their vehicle first → RestyleProAI. Wants a ready-made look → CreatorMarket. Has print-ready files → price the material and hand the cart link. Every design path ends with We Print Wraps printing it — always bring the conversation back to an order. Never invent subscription or software prices; point to restyleproai.com/pricing for those.

BUY LINKS — when you quote a per-sqft product, ALWAYS include its product-page link, and tell them the square footage to enter:
- Avery MPI 1105: https://weprintwraps.com/our-products/avery-1105egrs-with-doz13607-lamination/
- 3M IJ180Cv3: https://weprintwraps.com/our-products/3m-ij180-printed-wrap-film/
- Window perf 50/50: https://weprintwraps.com/our-products/perforated-window-vinyl-5050-unlaminated/
- Wall wrap vinyl: https://weprintwraps.com/our-products/wall-wrap-printed-vinyl/
- Avery contour-cut: https://weprintwraps.com/our-products/avery-cut-contour-vinyl-graphics-54-roll-max-artwork-size-50/
- 3M contour-cut: https://weprintwraps.com/our-products/3m-cut-contour-vinyl-graphics-54-roll-max-artwork-size-50/
NEVER build a weprintwraps.com/cart/?add-to-cart= URL. These products need Height, Width, Quantity and Lamination Choice picked on the product page — an add-to-cart URL lands the customer on an EMPTY cart. Use the product page and say what to enter (e.g. "enter 285 sq ft and pick your lamination").

VOICE — you are a person who knows this trade, not a form. Talk like someone on the shop floor who has priced a thousand of these.
- DEFAULT to 1-3 short sentences plus the link. But MATCH THE ASK: if they want a detailed assessment, breakdown, or "walk me through it", give the full picture — coverage and how you got it, price per sq ft, the total, what's included (premium cast film + laminate), turnaround, the free-shipping threshold, and the link. Never answer "detailed" with two lines.
- DO NOT ask permission to do your job. Never say "would you like me to price that?" or "shall I continue?" — just price it and show the number. Ask a question only when you genuinely need a fact you don't have (the vehicle, the sq ft, their email).
- DON'T open with an apology. No "I apologize for the confusion", no "Unfortunately". If you got something wrong, correct it in the same breath and move on.
- Never repeat a paragraph you already said. If they push back, they want MORE specifics or DIFFERENT ones — not the same answer reworded.
- State assumptions out loud: "no exact match for the Macan, so I'm using compact SUV at ~285 sq ft — send me the length and height and I'll tighten it."

RULES: Use exact prices. The volume ladder above is the ONLY discount that exists — quote it freely and accurately, and never invent any other discount, coupon or product. NEVER state how long a wrap, film or laminate LASTS — no "7-10 years", no "5-7 years", no lifespan range in any form, however hedged (owner instruction 2026-08-12). A lifespan you type to a customer is a performance warranty we never issued. Say what laminate DOES (protects the print from abrasion and UV) and send them to the film manufacturer's published warranty for durability. If they seem ready but hesitant, offer to email their quote (ask for their email). If asked something you can't know (order status, custom jobs), give the phone number. A PRICED_CONTEXT line may be injected with a pre-computed quote — use those exact numbers.

TOOLS: You have real-data tools — use them instead of guessing, and CALL them yourself; never tell a customer to phone in for something a tool can do.
- When a customer names a vehicle (year/make/model), call estimate_wrap_coverage for EXACT square footage, then price_wrap_material for the exact price + cart link. Never invent coverage numbers.
- EMAILING/SAVING A QUOTE: the moment you have an email address + vehicle + the product and square footage you priced, CALL create_quote (pass product_key + sqft — it computes the total, saves the quote, AND emails it to the customer). If a customer asks you to email/send/save their quote, do it via create_quote right then; you do NOT need extra confirmation, and you must NEVER say you can't email or tell them to call 549-622-4678 to get a quote emailed. When it returns emailed:true, tell them it's on the way to their inbox. When it returns emailed:false, the send genuinely failed — do NOT say it's in their inbox. Give them the cart link and 549-622-4678 so they still have a way forward.
- HUMAN CALLBACK: you can reach the team. The MOMENT a customer asks to be called, gives a number for follow-up, asks for a real person/rep, or brings a job too big or too messy to close in chat (fleets, custom quotes, complaints, an order already in production), CALL request_callback with their name, phone, email and a short summary of what they need. If you don't have a number, ask for it first — one question, then call the tool. **NEVER say "someone will get back to you", "I'll have the team reach out", or anything like it unless request_callback returned delivered:true.** Saying it without calling the tool means nobody on the team ever learns the customer exists. If it returns delivered:false, say plainly that they should call 549-622-4678 or email hello@weprintwraps.com.
- ORDER STATUS: call order_status, but only once you have BOTH the order number AND the email on the order; if you have just one, ask for the other. Never reveal order details from an email alone.
- FILE CHECK (this is our lead magnet — run it, don't deflect): when a customer uploads artwork, CALL check_artwork. Never judge a file by eye or by its name, and never tell someone to email it in instead. Get the vehicle first when you can, so you can pass sqft — DPI only means something against the wrap size. Then act on the verdict it returns:
  · print_ready → say it's good to print, give the score, and hand over next_step.cart_url as the buy link.
  · needs_prep → say it will print but needs prep, name the $199 Print-Ready Prep fee, and mention our team is double-checking it now.
  · not_usable → be straight that it can't print as-is and say exactly why (quote the issues). Tell them our design team has been sent the file to double-check, then offer the two paths: $199 Print-Ready Prep, or a full AI recreate at next_step.recreate_url. Never leave them with nothing.
  Give the real score out of 10 and the concrete findings — specific numbers build trust and sell the fix.`;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── FLEET / BULK VOLUME DISCOUNTS ───────────────────────────────────────────
// The CommercialPro quote tool advertises this exact ladder ("Fleet / Bulk
// Discounts — add multiple vehicles with quantities to unlock automatic bulk
// discounts"), and the email assistant's PRICING_CONTEXT quotes it too. This
// function had none of it: every WrapGuru quote was list price × sq ft, so a
// fleet manager asking for 3,000 sq ft was told $15,810 when the advertised
// price is $12,648 — a $3,162 overquote on the exact audience CommercialPro
// is built for, sent in writing when they asked for the quote by email.
// Tiers are on TOTAL ORDER sq ft, highest matching tier wins.
// `code` is the REAL WooCommerce coupon (owned by wpw-volume-coupons) — the
// customer types it at checkout to actually receive the price we quoted.
// Quoting a discount without handing over the code is a promise that breaks
// at checkout, so the code travels with every discounted number we state.
const VOLUME_TIERS = [
  { minSqft: 2500, rate: 0.20, label: "2,500+ sq ft", code: "FLEET20" },
  { minSqft: 1500, rate: 0.15, label: "1,500–2,499 sq ft", code: "FLEET15" },
  { minSqft: 1000, rate: 0.10, label: "1,000–1,499 sq ft", code: "FLEET10" },
  { minSqft: 500, rate: 0.05, label: "500–999 sq ft", code: "FLEET5" },
] as const;

/** Price sq ft of a product with the volume ladder applied. One place, so the
 *  chat reply, the tool result and the emailed quote can never disagree. */
function priceWithVolume(product: { price: number }, sqft: number) {
  const tier = VOLUME_TIERS.find((t) => sqft >= t.minSqft) || null;
  const listTotal = +(sqft * product.price).toFixed(2);
  const unitPrice = tier ? +(product.price * (1 - tier.rate)).toFixed(2) : product.price;
  const total = tier ? +(listTotal * (1 - tier.rate)).toFixed(2) : listTotal;
  return {
    unit_price: unitPrice,
    list_unit_price: product.price,
    list_total: listTotal,
    total,
    discount_pct: tier ? Math.round(tier.rate * 100) : 0,
    discount_amount: +(listTotal - total).toFixed(2),
    volume_tier: tier ? tier.label : null,
    coupon_code: tier ? tier.code : null,
  };
}

// Deterministic pass: pull sqft + product from the message and price it.
function priceFromMessage(msg: string) {
  const sq = msg.match(/(\d{2,4})\s*(sq\s*\.?\s*(ft|feet)|square|sf\b|sqft)/i);
  const sqft = sq ? parseInt(sq[1]) : null;
  const product = CATALOG.find((p) => p.pattern.test(msg)) ||
    (/wrap|print|film|vinyl/i.test(msg) ? CATALOG[0] : null);
  if (!sqft || !product) return null;
  const priced = priceWithVolume(product, sqft);
  return {
    product: product.name,
    sqft,
    total: priced.total,
    list_total: priced.list_total,
    discount_pct: priced.discount_pct,
    volume_tier: priced.volume_tier,
    coupon_code: priced.coupon_code,
    cart_url: buyUrl(product, sqft),
  };
}

// Service-role client (bypasses RLS) for persistence + drip enrollment.
function svc() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
}

// Best-guess client IP from the edge proxy headers.
function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || null;
}

// IP → coarse geolocation via ipwho.is (HTTPS, keyless). Best-effort, 2s cap.
async function resolveGeo(ip: string | null) {
  if (!ip || /^(127\.|10\.|192\.168\.|::1|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const g = await res.json();
    if (!g?.success) return null;
    return {
      city: g.city ?? null,
      region: g.region ?? null,
      country: g.country ?? null,
      country_code: g.country_code ?? null,
      lat: typeof g.latitude === "number" ? g.latitude : null,
      lng: typeof g.longitude === "number" ? g.longitude : null,
      org: g.connection?.org ?? g.connection?.isp ?? null,
    };
  } catch (_) {
    return null;
  }
}

// Email the WPW team the moment a new chat starts — geo + opening message,
// so a live visitor is never lost even if they never leave contact info.
async function notifyTeamNewChat(opts: {
  message: string;
  geo: Awaited<ReturnType<typeof resolveGeo>>;
  pagePath: string | null;
  email: string | null;
  priced: ReturnType<typeof priceFromMessage>;
}) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return false;
  const geoLine = opts.geo
    ? [opts.geo.city, opts.geo.region, opts.geo.country].filter(Boolean).join(", ") || "unknown location"
    : "unknown location";
  try {
    const resend = new Resend(resendKey);
    const r = await resend.emails.send({
      from: "WrapGuru <noreply@restyleproai.com>",
      to: [NOTIFY_TO],
      reply_to: opts.email || NOTIFY_TO,
      subject: `💬 New WrapGuru chat — ${geoLine}${opts.email ? ` · ${opts.email}` : ""}`,
      html: `<!doctype html><html><body style="font-family:-apple-system,sans-serif;color:#0d1220;">
  <h3 style="margin:0 0 6px;">New WrapGuru chat started</h3>
  <p style="margin:0 0 4px;"><b>Location:</b> ${esc(geoLine)}</p>
  <p style="margin:0 0 4px;"><b>Visitor email:</b> ${opts.email ? esc(opts.email) : "— (not provided yet)"}</p>
  <p style="margin:0 0 4px;"><b>Page:</b> ${esc(opts.pagePath || "—")}</p>
  ${opts.priced ? `<p style="margin:0 0 4px;"><b>Priced:</b> ${esc(opts.priced.product)} — ${opts.priced.sqft} sqft $${opts.priced.total}</p>` : ""}
  <div style="margin-top:12px;padding:12px 14px;border-left:3px solid #ec4899;background:#f8fafc;">
    <div style="font-size:12px;color:#64748b;">Opening message</div>
    <div style="white-space:pre-wrap;">${esc(opts.message)}</div>
  </div>
  <p style="color:#94a3b8;font-size:12px;margin-top:14px;">Full transcript is in Admin → WrapGuru Chats.</p>
</body></html>`,
    });
    return !r.error;
  } catch (_) {
    return false;
  }
}

// ── CALLBACK / HUMAN HANDOFF ────────────────────────────────────────────────
// The team-notify email fires ONLY on the first message of a session, so a
// customer who hands over a phone number on message 2+ used to reach NOBODY —
// the agent would say "someone will get back to you" and nothing happened.
// This is the wire that makes that promise true. It mails the WPW team (a
// FIXED internal address, never a customer-supplied one, so it can't be used
// as a relay) and reports honestly whether the alert actually left.
async function sendCallbackRequest(o: {
  name?: string;
  phone?: string;
  email?: string;
  summary: string;
  urgency?: string;
  sessionId: string;
  pagePath?: string | null;
}): Promise<{ delivered: boolean; channels: string[] }> {
  const urgent = String(o.urgency || "").toLowerCase() === "urgent";
  const who = [o.name, o.phone, o.email].filter(Boolean).join(" · ") || "no contact details given";
  const subject = `${urgent ? "🔴 URGENT " : "📞 "}Callback request — ${o.name || o.phone || o.email || "WrapGuru chat"}`;
  const html = `<!doctype html><html><body style="font-family:-apple-system,sans-serif;color:#0d1220;">
  <div style="height:5px;border-radius:5px;background:linear-gradient(90deg,#3b82f6,#ec4899);margin-bottom:16px;"></div>
  <h2 style="margin:0 0 4px;">${urgent ? "URGENT callback request" : "Callback request"}</h2>
  <p style="color:#64748b;margin:0 0 16px;">A customer asked to be contacted by a person.</p>
  <table style="border-collapse:collapse;font-size:15px;">
    <tr><td style="padding:6px 16px 6px 0;color:#64748b;">Name</td><td style="padding:6px 0;font-weight:700;">${esc(o.name || "—")}</td></tr>
    <tr><td style="padding:6px 16px 6px 0;color:#64748b;">Phone</td><td style="padding:6px 0;font-weight:700;">${esc(o.phone || "—")}</td></tr>
    <tr><td style="padding:6px 16px 6px 0;color:#64748b;">Email</td><td style="padding:6px 0;font-weight:700;">${esc(o.email || "—")}</td></tr>
    <tr><td style="padding:6px 16px 6px 0;color:#64748b;">Page</td><td style="padding:6px 0;">${esc(o.pagePath || "—")}</td></tr>
  </table>
  <div style="margin-top:14px;padding:12px 14px;border-left:3px solid #ec4899;background:#f8fafc;">
    <div style="font-size:12px;color:#64748b;">What they need</div>
    <div style="white-space:pre-wrap;">${esc(o.summary)}</div>
  </div>
  <p style="color:#94a3b8;font-size:12px;margin-top:14px;">Full transcript: Admin → WrapGuru Chats · session ${esc(o.sessionId)}</p>
</body></html>`;

  const channels: string[] = [];
  try {
    if (graphMailConfigured() && await sendGraphMail({ to: NOTIFY_TO, subject, html, replyTo: o.email || NOTIFY_TO, fromName: "WrapGuru" })) {
      channels.push("graph");
    }
  } catch { /* try the next channel */ }
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    try {
      const r = await new Resend(resendKey).emails.send({
        from: "WrapGuru <noreply@restyleproai.com>",
        to: [NOTIFY_TO],
        reply_to: o.email || NOTIFY_TO,
        subject,
        html,
      });
      if (!r.error) channels.push("resend");
    } catch { /* fall through — reported below */ }
  }
  // Mirror onto the customer's Klaviyo profile so the request is visible even
  // if every mail channel is down.
  if (o.email) {
    await klaviyoTrack({
      metric: "WrapGuru Callback Requested",
      email: o.email,
      uniqueId: `wrapguru-callback-${o.sessionId}-${(o.phone || "").replace(/\D/g, "")}`,
      properties: { name: o.name ?? null, phone: o.phone ?? null, summary: o.summary, urgency: o.urgency ?? "normal", page_path: o.pagePath ?? null },
    }).then((ok) => { if (ok) channels.push("klaviyo"); }).catch(() => {});
  }
  return { delivered: channels.length > 0, channels };
}

// ── Outbound send guard ─────────────────────────────────────────────────────
// This endpoint is public (verify_jwt=false, open CORS) and create_quote mails
// whatever address the conversation supplies — structurally an open relay. A
// bot can drive it to mail strangers, who mark it spam, and the ESP suspends
// the account for traffic nobody here initiated.
//
// Caps, counted against wrapguru_send_log:
//   · 3 DISTINCT addresses per session   — a real visitor quotes to one inbox
//   · 5 sends per session per hour       — stops a loop on one session
//   · 20 sends per IP per hour           — stops a loop across many sessions
// Fails OPEN on a lookup error: a database hiccup must not block a real
// customer's quote. Fails CLOSED on an actual breach.
const SEND_CAPS = { distinctEmailsPerSession: 3, perSessionPerHour: 5, perIpPerHour: 20 };

async function sendGuard(sessionId: string, ip: string | null, email: string): Promise<{ ok: boolean; reason?: string }> {
  const db = svc();
  if (!db) return { ok: true }; // no service role — don't block the happy path
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: sessionRows, error: sErr } = await db
      .from("wrapguru_send_log")
      .select("email")
      .eq("session_id", sessionId)
      .gte("created_at", since);
    if (sErr) return { ok: true };

    const rows = sessionRows || [];
    if (rows.length >= SEND_CAPS.perSessionPerHour) {
      return { ok: false, reason: "too many quote emails from this chat in the last hour" };
    }
    const distinct = new Set(rows.map((r: { email: string }) => r.email));
    if (!distinct.has(email) && distinct.size >= SEND_CAPS.distinctEmailsPerSession) {
      return { ok: false, reason: "too many different email addresses from this chat" };
    }

    if (ip) {
      const { count, error: iErr } = await db
        .from("wrapguru_send_log")
        .select("id", { count: "exact", head: true })
        .eq("ip_address", ip)
        .gte("created_at", since);
      if (!iErr && (count ?? 0) >= SEND_CAPS.perIpPerHour) {
        return { ok: false, reason: "too many quote emails from this network in the last hour" };
      }
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

async function logSend(sessionId: string, ip: string | null, email: string, channel: string) {
  const db = svc();
  if (!db) return;
  try {
    await db.from("wrapguru_send_log").insert({
      session_id: sessionId, ip_address: ip, email, kind: "quote", channel,
    });
  } catch { /* best-effort ledger */ }
}

// Deliver the customer's quote through KLAVIYO (the primary channel while the
// Resend account is suspended).
//
// Klaviyo has no "send this email now" endpoint — delivery is a Flow triggered
// by a metric. So we fire ONE dedicated transactional metric, `WrapGuru Quote
// Ready`, carrying every field the Flow's email template renders. Wire a Flow
// in Klaviyo triggered on that metric and the customer gets their quote; until
// that Flow is live the event still lands on the profile, so nothing is lost.
//
// Deliberately a SEPARATE metric from the existing "Quote Requested" /
// "WrapGuru Lead" analytics events: this one drives a send, and mixing the two
// would make every historical analytics event fire an email the moment the
// Flow goes live.
// deno-lint-ignore no-explicit-any
async function sendQuoteViaKlaviyo(args: any, sessionId: string): Promise<boolean> {
  const to = String(args?.email || "").trim();
  if (!to.includes("@")) return false;
  const vehicle = [args.year, args.make, args.model].filter(Boolean).join(" ") || "your vehicle";
  const sqft = Math.round(Number(args.sqft) || 0);
  const total = Number(args.total) || 0;
  const productId = CATALOG.find((c) => c.name === args.product_name)?.id ?? CATALOG[0].id;
  return await klaviyoTrack({
    metric: "WrapGuru Quote Ready",
    email: to,
    value: total,
    // Same session + same total must not re-send if the model calls twice.
    uniqueId: `wrapguru-quote-ready-${sessionId}-${sqft}-${total}`,
    properties: {
      vehicle,
      year: args.year ?? null,
      make: args.make ?? null,
      model: args.model ?? null,
      material: args.product_name || "printed wrap film",
      sqft,
      price_per_sqft: sqft > 0 ? +(total / sqft).toFixed(2) : null,
      total,
      total_formatted: "$" + total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      cart_url: buyUrl(CATALOG.find((c) => c.id === productId) || CATALOG[0], sqft),
      shipping_note: "Ships in 1-2 business days. Free shipping on orders $750+.",
      phone: "549-622-4678",
      tool_source: "WrapGuru chat",
    },
  });
}

// Email the customer their saved quote (fired by the create_quote tool).
// Best-effort; skips when RESEND_API_KEY is unset. SECONDARY channel — the
// Resend account is suspended, so this returns false today and Klaviyo above
// is what actually delivers. Left in place so both fire once it's reinstated.
// One quote body, shared by every email channel, so Graph and Resend can never
// drift apart.
// deno-lint-ignore no-explicit-any
function quoteEmailParts(args: any) {
  const vehicle = [args.year, args.make, args.model].filter(Boolean).join(" ") || "your vehicle";
  const product = args.product_name || "printed wrap film";
  const sqft = Math.round(Number(args.sqft) || 0);
  const total = Number(args.total) || 0;
  const money = "$" + total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { vehicle, product, sqft, total, money, subject: `Your WrapGuru wrap quote — ${vehicle}` };
}

// Microsoft Graph — sends the customer's own quote from a real WPW mailbox.
// One-to-one, low volume, to someone who just asked for it: exactly what
// mailbox sending is for. Never wire a list or a campaign through here — abuse
// gets the whole Microsoft 365 tenant restricted, not just an API key.
// deno-lint-ignore no-explicit-any
async function sendQuoteViaGraph(args: any): Promise<boolean> {
  const to = String(args?.email || "").trim();
  if (!to.includes("@") || !graphMailConfigured()) return false;
  const p = quoteEmailParts(args);
  return await sendGraphMail({
    to,
    subject: p.subject,
    html: quoteEmailHtml(args),
    replyTo: NOTIFY_TO,
    fromName: "We Print Wraps",
  });
}

// deno-lint-ignore no-explicit-any
async function sendQuoteEmail(args: any): Promise<boolean> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const to = String(args?.email || "").trim();
  if (!resendKey || !to.includes("@")) return false;
  const p = quoteEmailParts(args);
  try {
    const resend = new Resend(resendKey);
    const r = await resend.emails.send({
      from: "WrapGuru <noreply@restyleproai.com>",
      to: [to],
      reply_to: NOTIFY_TO,
      subject: p.subject,
      html: quoteEmailHtml(args),
    });
    return !r.error;
  } catch (_) {
    return false;
  }
}

// deno-lint-ignore no-explicit-any
function quoteEmailHtml(args: any): string {
  const { vehicle, product, sqft, money } = quoteEmailParts(args);
  return `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0d1220;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="height:5px;border-radius:5px;background:linear-gradient(90deg,#3b82f6,#ec4899);margin-bottom:20px;"></div>
    <h2 style="margin:0 0 4px;font-size:22px;">Your wrap quote</h2>
    <p style="color:#64748b;font-size:14px;margin:0 0 18px;">Here's the quote WrapGuru put together for you.</p>
    <table style="border-collapse:collapse;font-size:15px;width:100%;">
      <tr><td style="padding:8px 16px 8px 0;color:#64748b;">Vehicle</td><td style="padding:8px 0;font-weight:600;text-align:right;">${esc(vehicle)}</td></tr>
      <tr><td style="padding:8px 16px 8px 0;color:#64748b;">Material</td><td style="padding:8px 0;font-weight:600;text-align:right;">${esc(product)}</td></tr>
      <tr><td style="padding:8px 16px 8px 0;color:#64748b;">Coverage</td><td style="padding:8px 0;font-weight:600;text-align:right;">${sqft} sq ft</td></tr>
      ${
    Number(args.discount_pct) > 0
      ? `<tr><td style="padding:8px 16px 8px 0;color:#64748b;">List price</td><td style="padding:8px 0;text-align:right;text-decoration:line-through;color:#94a3b8;">$${
        Number(args.list_total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      }</td></tr>
      <tr><td style="padding:8px 16px 8px 0;color:#0a8a3a;">Volume discount (${args.volume_tier})</td><td style="padding:8px 0;font-weight:700;text-align:right;color:#0a8a3a;">−${args.discount_pct}%</td></tr>
      <tr><td style="padding:8px 16px 8px 0;color:#64748b;">Code to enter at checkout</td><td style="padding:8px 0;font-weight:800;text-align:right;letter-spacing:1px;color:#0b1d3a;">${args.coupon_code}</td></tr>`
      : ""
  }
      <tr><td style="padding:8px 16px 8px 0;color:#64748b;">Estimated material cost</td><td style="padding:8px 0;font-weight:800;text-align:right;">${money}</td></tr>
    </table>
    <p style="color:#94a3b8;font-size:12px;margin:18px 0 0;">Material estimate — premium cast film + laminate included. Ships in 1-2 business days. Free shipping on orders $750+.</p>
    <div style="margin-top:24px;">
      <a href="${args.product_url || "https://weprintwraps.com/our-products/"}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:linear-gradient(90deg,#3b82f6,#ec4899);color:#fff;text-decoration:none;font-weight:700;font-size:14px;">Order ${sqft} sq ft →</a>
      <p style="color:#94a3b8;font-size:12px;margin:10px 0 0;">On the product page, enter your size and pick your lamination.</p>
    </div>
    <p style="color:#94a3b8;font-size:12px;margin:20px 0 0;">Questions? Call 549-622-4678 or reply to this email.</p>
  </div>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "invalid json" }); }

  const message = String(body?.message || "").slice(0, 2000).trim();
  if (!message) return json(400, { ok: false, error: "message required" });

  const history = Array.isArray(body?.history)
    ? body.history.slice(-10).map((m: any) => ({
        role: m?.role === "assistant" ? "assistant" : "user",
        content: String(m?.content || "").slice(0, 2000),
      }))
    : [];

  const pagePath = String(body?.page_path || "").slice(0, 300) || null;
  const referrer = String(body?.referrer || req.headers.get("referer") || "").slice(0, 400) || null;
  const sessionId = (String(body?.session_id || "").slice(0, 80) || `wc-${crypto.randomUUID().slice(0, 8)}`);

  const priced = priceFromMessage(message);
  const emailMatch = message.match(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i);
  const email = emailMatch ? emailMatch[0].toLowerCase() : null;

  // A file the visitor attached on this turn (already uploaded client-side into
  // the private wrapguru-files bucket; we only ever see the object path).
  const rawUpload = body?.upload;
  const uploadCtx: UploadCtx = {
    sessionId,
    ip: clientIp(req),
    pagePath,
    upload: rawUpload?.path && rawUpload?.name
      ? {
          path: String(rawUpload.path).slice(0, 400),
          name: String(rawUpload.name).slice(0, 200),
          size: Number(rawUpload.size) || 0,
        }
      : null,
  };

  const db = svc();

  // PREVIEW / admin test console — compute the reply from the SAME deterministic
  // pricing + KB grounding as a live chat, but skip ALL side effects
  // (persistence, geo lookup, team notify, lead forward, Klaviyo, retarget). Lets
  // admins test WrapGuru answers (e.g. verify the KB) without polluting the
  // pipeline or emailing the team. Also returns the KB facts used, for the
  // console to show what grounded the answer. Backward compatible: defaults off.
  if (body?.preview === true || body?.mode === "admin_preview") {
    const kbContext = db ? await retrieveKb(db, message) : "";
    const reply = await buildReply(message, history, priced, kbContext, uploadCtx);
    return json(200, { ok: true, reply, priced: priced || undefined, preview: true, kb: kbContext || undefined });
  }

  // Look up the conversation so we know whether this is a brand-new session
  // (drives the geo lookup + first-message team notification).
  let convo: any = null;
  if (db) {
    const { data } = await db
      .from("wpw_chat_conversations")
      .select("*")
      .eq("session_id", sessionId)
      .maybeSingle();
    convo = data || null;
  }
  const isNewConversation = !convo;

  // Lead capture: forward any email address in the message to wpw-calc-lead
  // (saved + emailed to Trish), best-effort.
  if (email) {
    try {
      const base = Deno.env.get("SUPABASE_URL") || "https://kfapjdyythzyvnpdeghu.supabase.co";
      fetch(`${base}/functions/v1/wpw-calc-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          quote: {
            vehicle: "WEBSITE CHAT LEAD",
            material: priced ? `${priced.product} — ${priced.sqft} sqft $${priced.total}` : message.slice(0, 150),
            total_sqft: priced?.sqft ?? null,
            est_cost: priced?.total ?? null,
          },
          pagePath: pagePath || ("/chat#" + sessionId),
        }),
      }).catch(() => {});
    } catch (_) { /* never block the reply */ }
  }

  const kbContext = db ? await retrieveKb(db, message) : "";
  const reply = await buildReply(message, history, priced, kbContext, uploadCtx);

  // Persist the turn, resolve geo, notify the team, enroll retarget — all
  // best-effort so a storage/email hiccup never breaks the chat reply.
  if (db) {
    try {
      await persistTurn(db, req, {
        sessionId, isNewConversation, convo, message, reply, priced, email, pagePath, referrer,
      });
    } catch (e) {
      console.error("[wpw-sales-chat] persist failed (non-fatal):", e);
    }
  }

  return json(200, { ok: true, reply, priced: priced || undefined });
});

// ── Agentic tools — real data the model can call mid-conversation. ─────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "estimate_wrap_coverage",
      description:
        "Look up the REAL full-wrap square footage for a specific vehicle from the 1,660-vehicle database. Call this whenever the customer names a year/make/model so pricing uses exact coverage, not a guess.",
      parameters: {
        type: "object",
        properties: {
          year: { type: "string", description: "Model year, e.g. 2021" },
          make: { type: "string", description: "Make, e.g. Chevrolet" },
          model: { type: "string", description: "Model, e.g. Silverado 1500" },
        },
        required: ["make", "model"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "price_wrap_material",
      description:
        "Compute the exact material price for a square footage of a specific WPW product and return its product-page buy link. Prices are authoritative — always use this instead of doing the math yourself. Hand the customer the returned cart_url (a product page) and tell them the sq ft to enter.",
      parameters: {
        type: "object",
        properties: {
          product_key: { type: "string", enum: CATALOG.map((c) => c.key), description: "Which product" },
          sqft: { type: "number", description: "Square footage to price" },
        },
        required: ["product_key", "sqft"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_quote",
      description:
        "Save AND email a real quote to the customer. Call the moment you have their email + vehicle + the product and square footage you priced. The total is computed automatically from product_key × sqft — you do not pass a dollar amount.",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string", description: "Customer email to send the quote to" },
          year: { type: "string" },
          make: { type: "string" },
          model: { type: "string" },
          product_key: { type: "string", enum: CATALOG.map((c) => c.key), description: "Which product was priced" },
          sqft: { type: "number", description: "Square footage priced (use the coverage number)" },
        },
        required: ["email", "make", "model", "product_key", "sqft"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_artwork",
      description:
        "Run the REAL print-file check on a file the customer just uploaded in this chat (parses actual dimensions, DPI, color space, vector/raster). Call this whenever an upload is announced, and pass sqft once you know the vehicle's coverage — DPI is meaningless without the wrap size. Returns a verdict plus the exact next step: print_ready gives you a cart link to hand over, needs_prep/not_usable means the design team has been emailed and you should offer the fix fee or the RecreatePro link. NEVER guess whether a file will print — call this.",
      parameters: {
        type: "object",
        properties: {
          sqft: { type: "number", description: "Wrap square footage the file must cover (from estimate_wrap_coverage)" },
          vehicle: { type: "string", description: "Year/make/model, if known" },
          email: { type: "string", description: "Customer email, if captured" },
          product_key: { type: "string", enum: CATALOG.map((c) => c.key), description: "Material they're buying (default avery)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_callback",
      description:
        "Alert the WePrintWraps team that a customer wants a person to contact them, and hand over their details. CALL THIS whenever the customer asks to be called/contacted, gives you a phone number for follow-up, asks for a human/rep/salesperson, or has a job too complex to close in chat (large fleets, custom quotes, a complaint). Do NOT tell a customer someone will get back to them unless this tool returned delivered:true — without it, nobody on the team ever hears about them.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Customer's name, if given" },
          phone: { type: "string", description: "Phone number to call — ask for it if they haven't given one" },
          email: { type: "string", description: "Email address, if given" },
          summary: { type: "string", description: "What they need, in one or two sentences: vehicle(s), quantity, material, and anything already quoted" },
          urgency: { type: "string", enum: ["normal", "urgent"], description: "urgent for complaints, deadlines, or a job already in production" },
        },
        required: ["summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "order_status",
      description:
        "Look up a WePrintWraps order's status + tracking (orders are synced live from WooCommerce). Requires BOTH the order number AND the email on the order — they must match. NEVER reveal order details from an email alone; ask for the order number too.",
      parameters: {
        type: "object",
        properties: {
          order_number: { type: "string", description: "The WooCommerce order number, e.g. 12345" },
          email: { type: "string", description: "The email address on the order (verifies ownership)" },
        },
        required: ["order_number", "email"],
      },
    },
  },
];

// The file the visitor attached on THIS turn, if any. `check_artwork` reads it
// from here rather than from the model, so the agent can never invent a file or
// point the checker at someone else's upload.
type UploadCtx = { sessionId: string; ip: string | null; pagePath?: string | null; upload: { path: string; name: string; size: number } | null };

// deno-lint-ignore no-explicit-any
async function executeTool(name: string, args: any, ctx?: UploadCtx): Promise<string> {
  try {
    if (name === "check_artwork") {
      if (!ctx?.upload) {
        return JSON.stringify({
          checked: false,
          note: "No file has been uploaded in this chat yet. Ask them to tap the paperclip and attach the artwork (PDF, AI, EPS, PNG, JPG, TIFF or PSD).",
        });
      }
      const base = Deno.env.get("SUPABASE_URL");
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!base || !key) return JSON.stringify({ checked: false, error: "file check unavailable" });
      const res = await fetch(`${base}/functions/v1/wrapguru-file-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          file_path: ctx.upload.path,
          file_name: ctx.upload.name,
          file_size: ctx.upload.size,
          session_id: ctx.sessionId,
          sqft: args?.sqft ?? null,
          vehicle: args?.vehicle ?? null,
          email: args?.email ?? null,
          product_key: args?.product_key ?? "avery",
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.success) {
        return JSON.stringify({ checked: false, error: String(d?.error || res.status).slice(0, 160) });
      }
      return JSON.stringify({
        checked: true,
        score: d.score,
        verdict: d.verdict,
        checks: d.checks,
        issues: d.issues,
        recommendations: d.recommendations,
        good: d.good,
        next_step: d.next_step,
        team_notified: d.team_notified,
      });
    }
    if (name === "estimate_wrap_coverage") {
      const dims = resolveVehicleSpecs(String(args.year || ""), String(args.make || ""), String(args.model || ""));
      if (dims.source === "none" || !dims.totalSqFt) {
        return JSON.stringify({
          found: false,
          // Pick by BODY STYLE. The old list offered only sedan/pickup/van, so
          // an SUV like a Porsche Macan got called a sedan — the model was
          // steered into a wrong answer because the right option didn't exist.
          note:
            "No exact match in the 1,660-vehicle database — estimate from BODY STYLE, and say which class you used:\n" +
            "· coupe / small 2-door ~230 sqft\n" +
            "· compact or midsize sedan ~250 sqft\n" +
            "· full-size sedan / wagon ~285 sqft\n" +
            "· compact SUV or crossover (Macan, RAV4, CX-5) ~285 sqft\n" +
            "· midsize SUV (Grand Cherokee, 4Runner) ~320 sqft\n" +
            "· full-size SUV (Tahoe, Suburban, Escalade) ~380 sqft\n" +
            "· pickup, crew cab ~350 sqft\n" +
            "· cargo van, low roof (Transit 148) ~450 sqft\n" +
            "· Sprinter / high-roof van 170 ~550 sqft\n" +
            "· box truck ~600 sqft\n" +
            "NEVER call an SUV or crossover a sedan. State the class you assumed, price it, and offer to tighten the number if they send dimensions.",
        });
      }
      return JSON.stringify({
        found: true,
        total_sqft: dims.totalSqFt,
        match: dims.source === "L1-direct" ? "exact" : dims.source === "L2-temporal" ? "same model, nearest year" : "scaled estimate",
        note: "Full-wrap coverage. Partial wraps use less.",
      });
    }
    if (name === "price_wrap_material") {
      const product = CATALOG.find((c) => c.key === args.product_key) || CATALOG[0];
      const sqft = Math.max(1, Math.round(Number(args.sqft) || 0));
      const priced = priceWithVolume(product, sqft);
      return JSON.stringify({
        product: product.name,
        product_key: product.key,
        sqft,
        ...priced,
        cart_url: buyUrl(product, sqft),
        buy_note: `Product page — the customer picks Height/Width, enters ${sqft} sq ft and chooses lamination there.`,
        volume_note: priced.discount_pct
          ? `Volume discount applied: ${priced.discount_pct}% off at ${priced.volume_tier} (list $${priced.list_total.toLocaleString("en-US")} → $${priced.total.toLocaleString("en-US")}). YOU MUST GIVE THEM THE CODE ${priced.coupon_code} and tell them to enter it at checkout — the product page shows list price, the code is how they actually get this number.`
          : sqft >= 400
          ? `No volume tier yet — at 500 sq ft they hit 5% off. Worth telling them.`
          : null,
      });
    }
    if (name === "create_quote") {
      // Compute the total in code (never trust the model to pass a dollar amount).
      const product = CATALOG.find((c) => c.key === args.product_key) || CATALOG[0];
      const sqft = Math.max(1, Math.round(Number(args.sqft) || 0));
      const priced = priceWithVolume(product, sqft);
      const total = priced.total;
      const emailArgs = {
        ...args,
        product_name: product.name,
        product_url: product.url,
        sqft,
        total,
        list_total: priced.list_total,
        discount_pct: priced.discount_pct,
        volume_tier: priced.volume_tier,
        coupon_code: priced.coupon_code,
      };

      // Deliver to the customer FIRST — that's the deliverable and must not
      // depend on the quote-system save succeeding. Klaviyo is primary (Resend
      // is suspended); Resend is still attempted so both fire once it returns.
      // Record WHICH channel worked so the agent never claims a send that
      // didn't happen.
      const sid = ctx?.sessionId || "no-session";
      const toEmail = String(args?.email || "").trim().toLowerCase();

      // Refuse to be used as a relay before anything leaves the building.
      const guard = await sendGuard(sid, ctx?.ip ?? null, toEmail);
      if (!guard.ok) {
        console.warn(`[wpw-sales-chat] send guard blocked ${sid}: ${guard.reason}`);
        return JSON.stringify({
          ok: false,
          blocked: true,
          note: `Could not send — ${guard.reason}. Do NOT retry. Give the customer the cart link and 549-622-4678.`,
        });
      }

      // Klaviyo (Flow-driven) → Graph (real mailbox) → Resend (suspended).
      // Every channel that accepts the message is recorded, so the agent can
      // never claim a send that did not happen.
      const delivered: string[] = [];
      if (await sendQuoteViaKlaviyo(emailArgs, sid)) delivered.push("klaviyo");
      if (await sendQuoteViaGraph(emailArgs)) delivered.push("graph");
      if (await sendQuoteEmail(emailArgs)) delivered.push("resend");
      const emailed = delivered.length > 0;
      const channel = emailed ? delivered.join("+") : "none";
      if (emailed) await logSend(sid, ctx?.ip ?? null, toEmail, channel);

      // Best-effort save into the quote system (customer_quotes via submit-public-quote).
      let saved = false;
      let quoteId: string | null = null;
      try {
        const base = Deno.env.get("SUPABASE_URL") || "https://kfapjdyythzyvnpdeghu.supabase.co";
        const res = await fetch(`${base}/functions/v1/submit-public-quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shopSlug: "wpw",
            customer: { email: args.email },
            vehicle: { year: String(args.year || ""), make: String(args.make || ""), model: String(args.model || "") },
            colorName: product.name,
            manufacturer: /avery/i.test(product.name) ? "Avery" : /3m/i.test(product.name) ? "3M" : null,
            pricing: { quoteTotal: total, totalSqft: sqft, filmTotal: total, filmCostPerSqft: product.price },
            toolSource: "WrapGuru chat",
          }),
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok && d?.ok) {
          saved = true;
          quoteId = d.quoteId ?? null;
        } else {
          console.error("[wpw-sales-chat] create_quote save failed:", res.status, JSON.stringify(d).slice(0, 200));
        }
      } catch (e) {
        console.error("[wpw-sales-chat] create_quote save error:", String(e).slice(0, 160));
      }

      return JSON.stringify({
        ok: true,
        total,
        emailed,
        channel,
        saved,
        quote_id: quoteId,
        note: emailed
          ? `Quote for $${total.toLocaleString("en-US")} sent to the customer via ${channel}${saved ? " and saved to the quote system" : ""}. Tell them it's in their inbox.`
          : `Quote for $${total.toLocaleString("en-US")} recorded${saved ? " and saved" : ""} but NOT delivered — no email channel is working. Do NOT tell the customer it's in their inbox. Give them the cart link and 549-622-4678 instead.`,
      });
    }
    if (name === "request_callback") {
      const phone = String(args?.phone || "").trim();
      const email = String(args?.email || "").trim().toLowerCase();
      if (!phone && !email) {
        return JSON.stringify({
          delivered: false,
          note: "No phone or email captured. Ask the customer for the best number to reach them on, then call this again. Do NOT promise a callback yet.",
        });
      }
      const res = await sendCallbackRequest({
        name: args?.name ? String(args.name).slice(0, 120) : undefined,
        phone: phone.slice(0, 40) || undefined,
        email: email.includes("@") ? email.slice(0, 200) : undefined,
        summary: String(args?.summary || "Customer asked for a callback.").slice(0, 1200),
        urgency: args?.urgency ? String(args.urgency) : "normal",
        sessionId: ctx?.sessionId || "no-session",
        pagePath: ctx?.pagePath ?? null,
      });
      return JSON.stringify({
        delivered: res.delivered,
        channels: res.channels,
        note: res.delivered
          ? `The team has been alerted via ${res.channels.join("+")}. Tell the customer someone will reach out, and confirm the number you passed on. Business hours are the norm — do not promise a specific time.`
          : "The alert did NOT send. Do NOT tell the customer someone will call. Give them 549-622-4678 and hello@weprintwraps.com so they can reach the team directly.",
      });
    }
    if (name === "order_status") {
      // Orders are kept fresh by the WooCommerce webhook (wpw-orders-webhook).
      // Privacy: require order_number AND a matching email — never reveal an
      // order from an email alone (prevents enumeration by guessing emails).
      const db = svc();
      if (!db) return JSON.stringify({ error: "lookup unavailable" });
      const orderNum = String(args.order_number || "").trim().replace(/^#/, "");
      const email = String(args.email || "").trim().toLowerCase();
      if (!orderNum || !email) {
        return JSON.stringify({ found: false, note: "Ask for BOTH the order number and the email on the order." });
      }
      const { data: order } = await db
        .from("wpw_orders")
        .select("order_number,status,total,currency,date_created,date_completed,tracking_number,tracking_carrier,tracking_url,customer_email")
        .eq("order_number", orderNum)
        .limit(1)
        .maybeSingle();
      if (!order || String(order.customer_email || "").toLowerCase() !== email) {
        return JSON.stringify({ found: false, note: "No order matches that number + email. Double-check both, or call 549-622-4678." });
      }
      return JSON.stringify({
        found: true,
        order_number: order.order_number,
        status: order.status,
        total: order.total,
        currency: order.currency,
        placed: order.date_created,
        completed: order.date_completed,
        tracking: order.tracking_number
          ? { number: order.tracking_number, carrier: order.tracking_carrier, url: order.tracking_url }
          : null,
      });
    }
    return JSON.stringify({ error: "unknown tool" });
  } catch (e) {
    return JSON.stringify({ error: String(e).slice(0, 160) });
  }
}

// ── Retrieval: pull the most relevant KB entries for the message (full-text
// search over wrapguru_kb) so the agent answers from real WPW truth. Returns a
// compact context block, or "" when nothing matches. Best-effort.
async function retrieveKb(db: ReturnType<typeof createClient>, message: string): Promise<string> {
  try {
    const q = message.slice(0, 200).trim();
    if (q.length < 3) return "";
    // deno-lint-ignore no-explicit-any
    const fmt = (rows: any[]) => rows.map((r) => `Q: ${r.question}\nA: ${r.content}`).join("\n\n");

    // Preferred: relevance-RANKED full-text via the match_wrapguru_kb RPC
    // (websearch first, OR-broaden fallback, both ordered by ts_rank server-side
    // so the most relevant entry is always in the returned set). Falls through
    // to the client-side search below on any error (e.g. older DB without it).
    try {
      const { data: ranked, error } = await db.rpc("match_wrapguru_kb", { query_text: q, match_count: 6 });
      if (!error && Array.isArray(ranked) && ranked.length) return fmt(ranked as any[]);
    } catch (_) { /* fall through to client-side search */ }

    const search = (query: string) =>
      db
        .from("wrapguru_kb")
        .select("question, content")
        .eq("is_active", true)
        .textSearch("search", query, { type: "websearch", config: "english" })
        .limit(6);

    // Fallback primary: natural-language (websearch) match on the whole message.
    const { data } = await search(q);
    if (data && data.length) return fmt(data as any[]);

    // Fallback: broaden recall — OR the meaningful keywords so a question that
    // only partly overlaps a KB entry (now a larger KB) still finds it.
    const orQuery = q
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 8)
      .join(" OR ");
    if (!orQuery) return "";
    const { data: loose } = await search(orQuery);
    return loose && loose.length ? fmt(loose as any[]) : "";
  } catch (_) {
    return "";
  }
}

// ── Reply builder: OpenAI primary (with agentic tools), Anthropic fallback,
// deterministic floor. Never throws — returns a priced/generic fallback on error.
async function buildReply(
  message: string,
  history: { role: string; content: string }[],
  priced: ReturnType<typeof priceFromMessage>,
  kbContext = "",
  uploadCtx?: UploadCtx,
): Promise<string> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const kbBlock = kbContext
    ? `WPW KNOWLEDGE BASE — authoritative, up-to-date WPW facts retrieved for THIS question. Trust them and answer from them; they EXTEND the facts above, so a product or price that appears here IS real and offered. Never reply that you "don't have information" or "don't sell" something the knowledge base answers. Ignore only entries that aren't relevant:\n${kbContext}`
    : "";

  const detFloor = () =>
    priced
      ? `${priced.sqft} sq ft of ${priced.product} is $${priced.total.toLocaleString("en-US")}${
        priced.discount_pct
          ? ` — that's ${priced.discount_pct}% off list ($${priced.list_total.toLocaleString("en-US")}) at the ${priced.volume_tier} volume tier. Use code ${priced.coupon_code} at checkout`
          : ""
      }. Order now: ${priced.cart_url} — ships in 1-2 business days.`
      : `Happy to help — printed wrap film is $5.27/sq ft (3M or Avery, laminate included) and ships in 1-2 business days. Tell me the square footage or vehicle and I'll price it, or call 549-622-4678.`;

  if (!openaiKey && !anthropicKey) return detFloor();

  // Claude fallback. Reached when OpenAI is CONFIGURED BUT FAILING (quota,
  // billing, rate limit, outage) — not only when its key is absent. Verified
  // live 2026-08-11: the OpenAI key started erroring and every visitor got the
  // one-line deterministic floor instead of an answer, because the old code
  // only tried Claude when `openaiKey` was falsy. A paid outage must degrade to
  // a real answer, not a canned sentence.
  const claudeReply = async (): Promise<string> => {
    if (!anthropicKey) return "";
    const res = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 500,
        system: kbBlock ? `${SYSTEM_PROMPT}\n\n${kbBlock}` : SYSTEM_PROMPT,
        messages: [...history, { role: "user", content: userContent }],
      }),
    });
    if (!res.ok) {
      console.error("[wpw-sales-chat] anthropic error:", res.status, (await res.text()).slice(0, 200));
      return "";
    }
    const data = await res.json();
    // deno-lint-ignore no-explicit-any
    return (data?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  };

  const userContent = priced
    ? `${message}\n\nPRICED_CONTEXT: ${priced.sqft} sqft of ${priced.product} = $${priced.total}. Cart: ${priced.cart_url}`
    : message;

  try {
    let reply = "";
    if (openaiKey) {
      // Agentic loop: the model can call estimate_wrap_coverage / price_wrap_material /
      // create_quote for real data, then answer. Cap the tool rounds.
      // deno-lint-ignore no-explicit-any
      const messages: any[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...(kbBlock ? [{ role: "system", content: kbBlock }] : []),
        ...history,
        { role: "user", content: userContent },
      ];
      for (let round = 0; round < 4; round++) {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            // gpt-4o-mini was the ceiling on how this agent SOUNDED. Under any
            // pressure it fell back to script — apologising, asking permission,
            // restating the same paragraph. Prompt work could not fix that; the
            // model was the limit. Volume here is a few chats a day, so the
            // cost difference is negligible against a lost wrap order.
            model: "gpt-4o",
            max_tokens: 500,
            messages,
            tools: TOOLS,
            tool_choice: "auto",
          }),
        });
        if (!res.ok) {
          console.error("[wpw-sales-chat] openai error:", res.status, (await res.text()).slice(0, 200));
          // Hand the turn to Claude rather than collapsing to the floor.
          const fallback = await claudeReply();
          if (fallback) {
            console.warn("[wpw-sales-chat] served by Claude fallback (OpenAI unavailable)");
            return fallback;
          }
          throw new Error("openai unavailable and no Claude fallback");
        }
        const data = await res.json();
        const msg = data?.choices?.[0]?.message;
        const calls = msg?.tool_calls;
        if (calls && calls.length) {
          messages.push(msg);
          for (const tc of calls) {
            let a: Record<string, unknown> = {};
            try { a = JSON.parse(tc.function?.arguments || "{}"); } catch { /* ignore */ }
            const result = await executeTool(tc.function?.name || "", a, uploadCtx);
            messages.push({ role: "tool", tool_call_id: tc.id, content: result });
          }
          continue; // feed tool results back to the model
        }
        reply = msg?.content || "";
        break;
      }
      reply = reply || "Tell me the vehicle or square footage and I'll get you an exact price.";
    } else {
      reply = await claudeReply();
      if (!reply) throw new Error("model unavailable");
    }
    return reply || "I'm here — tell me the square footage or vehicle and I'll price it.";
  } catch (_e) {
    return detFloor();
  }
}

// ── Persistence: append the turn, geo-locate new sessions, notify the team,
// enroll email leads in the retarget drip. Service-role client (RLS bypass).
async function persistTurn(
  db: ReturnType<typeof createClient>,
  req: Request,
  a: {
    sessionId: string;
    isNewConversation: boolean;
    convo: any;
    message: string;
    reply: string;
    priced: ReturnType<typeof priceFromMessage>;
    email: string | null;
    pagePath: string | null;
    referrer: string | null;
  },
) {
  const now = new Date().toISOString();
  const turn = [
    { role: "user", content: a.message, at: now },
    { role: "assistant", content: a.reply, at: now },
  ];

  if (a.isNewConversation) {
    const ip = clientIp(req);
    const geo = await resolveGeo(ip);
    const notified = await notifyTeamNewChat({
      message: a.message, geo, pagePath: a.pagePath, email: a.email, priced: a.priced,
    });
    const { data: inserted } = await db
      .from("wpw_chat_conversations")
      .insert({
        session_id: a.sessionId,
        messages: turn,
        message_count: 2,
        email: a.email,
        last_priced: a.priced || null,
        ip_address: ip,
        geo_city: geo?.city ?? null,
        geo_region: geo?.region ?? null,
        geo_country: geo?.country ?? null,
        geo_country_code: geo?.country_code ?? null,
        geo_lat: geo?.lat ?? null,
        geo_lng: geo?.lng ?? null,
        geo_org: geo?.org ?? null,
        user_agent: (req.headers.get("user-agent") || "").slice(0, 400) || null,
        page_path: a.pagePath,
        referrer: a.referrer,
        lead_captured: !!a.email,
        team_notified: notified,
        first_message_at: now,
        last_message_at: now,
      })
      .select("id")
      .single();
    if (inserted) {
      const m = await mirrorLead(db, {
        conversationId: inserted.id, email: a.email, priced: a.priced,
        geo: geo ? { city: geo.city, region: geo.region, country: geo.country } : null,
        pagePath: a.pagePath, alreadyKlaviyo: false, alreadyQuoteLogged: false,
      });
      if (m.klaviyoSynced || m.quoteLogged) {
        await db.from("wpw_chat_conversations")
          .update({ klaviyo_synced: m.klaviyoSynced, quote_event_logged: m.quoteLogged })
          .eq("id", inserted.id);
      }
      if (a.email) await enrollRetarget(db, inserted.id, a.email, a.priced, false);
    }
    return;
  }

  // Existing conversation — append the turn, promote email/lead if newly given.
  const prevMsgs = Array.isArray(a.convo.messages) ? a.convo.messages : [];
  await db
    .from("wpw_chat_conversations")
    .update({
      messages: [...prevMsgs, ...turn],
      message_count: (a.convo.message_count || prevMsgs.length) + 2,
      email: a.email || a.convo.email || null,
      last_priced: a.priced || a.convo.last_priced || null,
      lead_captured: a.convo.lead_captured || !!a.email,
      last_message_at: now,
    })
    .eq("id", a.convo.id);

  const emailForLead = a.email || a.convo.email || null;
  const m = await mirrorLead(db, {
    conversationId: a.convo.id, email: emailForLead, priced: a.priced,
    geo: { city: a.convo.geo_city, region: a.convo.geo_region, country: a.convo.geo_country },
    pagePath: a.pagePath || a.convo.page_path,
    alreadyKlaviyo: !!a.convo.klaviyo_synced, alreadyQuoteLogged: !!a.convo.quote_event_logged,
  });
  if (m.klaviyoSynced || m.quoteLogged) {
    await db.from("wpw_chat_conversations")
      .update({
        klaviyo_synced: !!a.convo.klaviyo_synced || m.klaviyoSynced,
        quote_event_logged: !!a.convo.quote_event_logged || m.quoteLogged,
      })
      .eq("id", a.convo.id);
  }
  if (emailForLead) await enrollRetarget(db, a.convo.id, emailForLead, a.priced, a.convo.retarget_enrolled);
}

// ── Mirror a chat lead outward: QuickQuote analytics event (quote_events) +
// Klaviyo profile/event (retarget flows + email analytics). Best-effort; each
// mirror fires at most once per conversation (dedupe via the *_logged flags +
// Klaviyo unique_id). Returns which mirrors fired this turn.
async function mirrorLead(
  db: ReturnType<typeof createClient>,
  o: {
    conversationId: string;
    email: string | null;
    priced: ReturnType<typeof priceFromMessage>;
    geo: { city: string | null; region: string | null; country: string | null } | null;
    pagePath: string | null;
    alreadyKlaviyo: boolean;
    alreadyQuoteLogged: boolean;
  },
): Promise<{ klaviyoSynced: boolean; quoteLogged: boolean }> {
  let klaviyoSynced = false;
  let quoteLogged = false;

  // QuickQuote analytics stream — a priced chat becomes a quote event so it
  // shows alongside homepage QuickQuotes. Once per conversation.
  if (o.priced && !o.alreadyQuoteLogged) {
    const { error } = await db.from("quote_events").insert({
      quote_id: o.conversationId,
      event_type: "wrapguru_quote",
      source: "wpw-sales-chat",
      product_type: "WrapGuru",
      metadata: {
        product: o.priced.product,
        sqft: o.priced.sqft,
        total: o.priced.total,
        cart_url: o.priced.cart_url,
        email: o.email,
        page_path: o.pagePath,
        city: o.geo?.city ?? null,
        region: o.geo?.region ?? null,
        country: o.geo?.country ?? null,
      },
    });
    if (!error) quoteLogged = true;
    else console.error("[wpw-sales-chat] quote_events insert failed:", error.message);
  }

  // Klaviyo — profile + event drives retarget flows + email open/click analytics.
  if (o.email && !o.alreadyKlaviyo) {
    const props: Record<string, unknown> = {
      source: "WrapGuru chat",
      material: o.priced ? o.priced.product : null,
      sqft: o.priced?.sqft ?? null,
      est_total: o.priced?.total ?? null,
      page_path: o.pagePath,
      city: o.geo?.city ?? null,
      region: o.geo?.region ?? null,
      country: o.geo?.country ?? null,
    };
    klaviyoSynced = await klaviyoTrack({
      metric: "WrapGuru Lead",
      email: o.email,
      value: o.priced?.total,
      uniqueId: `wrapguru-lead-${o.conversationId}`,
      properties: props,
    });
    // When a job was priced, also fire the shared "Quote Requested" metric so
    // chat quotes land in the same Klaviyo analytics as homepage quotes.
    if (o.priced) {
      await klaviyoTrack({
        metric: "Quote Requested",
        email: o.email,
        value: o.priced.total,
        uniqueId: `wrapguru-quote-${o.conversationId}`,
        properties: { ...props, tool_source: "WrapGuru chat" },
      }).catch(() => {});
    }
  }

  return { klaviyoSynced, quoteLogged };
}

// ── Retarget: enroll the chat lead in the 3/5/7-day scheduled_emails drip
// quotes use (→ process-scheduled-emails). Gated by WORKFORCE_SENDS_ENABLED,
// idempotent via source_ref.
//
// This used to be skipped whenever KLAVIYO_API_KEY was set, on the assumption
// that Klaviyo owned retargeting via the "WrapGuru Lead" event. It did not:
// no Klaviyo flow is triggered by that metric (verified against the live
// account — `GET /metrics/{id}/flow-triggers` returns []), so the key being
// set meant chat leads got NOTHING from either system.
//
// The hand-off is now explicit rather than inferred. Set
// KLAVIYO_WRAPGURU_FLOW_ENABLED=true only once a Klaviyo flow actually
// triggers on "WrapGuru Lead"; until then the internal drip runs.
async function enrollRetarget(
  db: ReturnType<typeof createClient>,
  conversationId: string,
  email: string,
  priced: ReturnType<typeof priceFromMessage>,
  alreadyEnrolled: boolean,
) {
  if (alreadyEnrolled) return;
  // Only stand down once a Klaviyo flow demonstrably owns this lead.
  if ((Deno.env.get("KLAVIYO_WRAPGURU_FLOW_ENABLED") || "").toLowerCase() === "true") return;
  if ((Deno.env.get("WORKFORCE_SENDS_ENABLED") || "").toLowerCase() !== "on") return;

  const sourceRef = `wrapguru_chat_${conversationId}`;
  const { count } = await db
    .from("scheduled_emails")
    .select("id", { count: "exact", head: true })
    .eq("source_ref", sourceRef);
  if ((count ?? 0) > 0) {
    await db.from("wpw_chat_conversations").update({ retarget_enrolled: true }).eq("id", conversationId);
    return;
  }

  const nowMs = Date.now();
  const mergeData = {
    customer_name: "there",
    customer_email: email,
    vehicle: "your wrap project",
    vehicle_name: "your wrap project",
    quote_total: priced ? `$${priced.total.toFixed(2)}` : "",
    quote_url: "https://weprintwraps.com/our-products/",
    hero_render_block: "",
  };
  const rows = RETARGET_DAYS.map((d) => ({
    send_at: new Date(nowMs + d * MS_PER_DAY).toISOString(),
    template_slug: `retarget-${d}day-formal`,
    recipient_email: email,
    merge_data: mergeData,
    shop_id: null,
    source: "wrapguru_chat",
    source_ref: sourceRef,
    status: "pending",
  }));
  const { error } = await db.from("scheduled_emails").insert(rows);
  if (error) {
    console.error("[wpw-sales-chat] retarget enroll failed:", error.message);
    return;
  }
  await db.from("wpw_chat_conversations").update({ retarget_enrolled: true }).eq("id", conversationId);
}
