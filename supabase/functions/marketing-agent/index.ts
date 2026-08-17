/**
 * marketing-agent — the OpenAI-driven marketing agent behind the Marketing Hub.
 *
 * Architecture (Trish, 2026-07): content creation lives in RestylePro, human QC +
 * AI editing happen in the Marketing Hub, and Klaviyo (the REAL WePrintWraps
 * account — WPW is the anchor tenant) is the send/measure layer. This function is
 * the engine: it BUILDS campaign content into the tables the Hub / Content
 * Calendar / Engine Room already render (agent_email_campaigns,
 * slack_agent_tasks, agent_content_calendar), so the human team reviews it in the
 * existing UI with zero new screens. Nothing sends automatically — EVER.
 *
 * Actions (POST { action, ... }):
 *   audiences                       — list real Klaviyo lists (id, name, size) so a
 *                                     human picks the audience. Read-only.
 *   plan { brand, goal, count?,     — OpenAI (gpt-4o) writes `count` complete email
 *          audience? }                campaigns (subject, preview, text + simple
 *                                     HTML). Each is saved to agent_email_campaigns
 *                                     with status "needs_review", gets a Marketing
 *                                     Hub card (slack_agent_tasks, "To Do" column)
 *                                     and a calendar entry. NO external calls.
 *   push { campaign_id, list_id,    — take ONE human-approved campaign and create
 *          from_email?, from_label?, it in Klaviyo as a DRAFT (template + campaign
 *          force? }                   + assign). It appears in Klaviyo ready to
 *                                     review/send — this function NEVER calls the
 *                                     Klaviyo send endpoint. Requires the row's
 *                                     status to be "approved" unless force=true.
 *   stats { campaign_id }           — pull the campaign's live status (and, when a
 *                                     "Placed Order" metric exists, open/click/
 *                                     revenue stats) back from Klaviyo into the
 *                                     row's `stats` json. This is the MEASURE leg.
 *
 * Env: OPENAI_API_KEY, KLAVIYO_API_KEY (both already set — same key the
 * wpw-founder-campaign / klaviyo-bulk-import-customers functions use),
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto). verify_jwt=false because
 * this handler performs function-local admin/internal authorization.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { loadBrandBlock } from "../_shared/brand-os.ts";
import { resolveAssetType } from "../_shared/asset-type.ts";
import { brandFactsFor, judgeAtApproval, pillarFromMeta } from "../_shared/content-doctrine.ts";
import { hookForSurface } from "../_shared/idea-hook.ts";
import {
  duplicateOpenings, pieceCopyViolations, screenPieceCopy, sourceTooThin,
  surfaceBrief, type SurfaceBrief,
} from "../_shared/piece-copy.ts";
import { writeSurfaceCopy } from "../_shared/piece-copy-writer.ts";
import { cutCorpus, topCustomerQuotes } from "../_shared/cut-corpus.ts";
import {
  INSTALLER_SERIES, planEpisode, type ClipLike,
} from "../_shared/installer-series.ts";
import {
  CREATIVE_SPEC, creativeBlocker, planSlides, rankSources, slideCopy, wantsVideo,
  type CreativeFormat, type CreativeSource,
} from "../_shared/creative-plan.ts";
import {
  adHookBrief, adPackKey, pickAdCreative, screenAdStrings, withCloser,
  type AdCreativeCandidate,
} from "../_shared/ad-hook.ts";
import { planCuts, cutSourceRef } from "../_shared/surface-shape.ts";
import { canvaFetch, loadTokens, loadServerTokens, type CanvaTokens } from "../_shared/canva-client.ts";
import {
  CONTENT_TYPE_BRIEF,
  WEEKLY_PROGRAMMING,
  nextOccurrence,
  proposeSlot,
  spotlightAssetMismatch,
  type ProgrammingSlot,
} from "../_shared/content-programming.ts";
import { CRIBS_CRAFT, EDITOR_IDENTITY, HOUSE_REFERENCES, LONGFORM_CRAFT, PROMO_CRAFT, SHORTS_CRAFT, TIP_CALLOUTS } from "../_shared/editor-os.ts";

// NOTE: AI image generation (Gemini) was REMOVED as the design engine — it
// invented fake logos and produced off-brand slop. The agent now attaches REAL
// on-brand images: a Canva Brand Template autofill (real logo) when mapped, else
// a real photo/ad from the Content Studio library (pickLibraryImage). Never AI.

// ── Canva autofill — the REAL branding path. Instead of Gemini inventing a
//    logo, we fill the operator's own Canva Brand Template (their logo, fonts,
//    colors, layout are already baked into the template) with the agent's copy,
//    then export a PNG. Requires the connected Canva token to carry the write +
//    brandtemplate scopes (see canva-oauth-init). Best-effort: returns null on
//    any miss so a design failure never blocks the copy. ─────────────────────
const CANVA_POLL_MS = 1500;
const CANVA_MAX_POLLS = 20; // ~30s ceiling for autofill + export each

async function canvaJson(tokens: CanvaTokens, path: string, init?: RequestInit) {
  const res = await canvaFetch(tokens, path, init);
  if (!res.ok) throw new Error(`canva ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return await res.json();
}

/** List the operator's autofill-capable brand templates (id, title, thumbnail). */
async function canvaListTemplates(tokens: CanvaTokens) {
  const out: { id: string; title: string; thumbnail: string | null }[] = [];
  let continuation = "";
  for (let i = 0; i < 5; i++) {
    const u = new URL("https://api.canva.com/rest/v1/brand-templates");
    u.searchParams.set("dataset", "non_empty");
    if (continuation) u.searchParams.set("continuation", continuation);
    const data = await canvaJson(tokens, u.toString());
    for (const t of data.items || []) {
      out.push({ id: t.id, title: t.title || "Untitled", thumbnail: t.thumbnail?.url || null });
    }
    continuation = data.continuation || "";
    if (!continuation) break;
  }
  return out;
}

/** The autofill field names + types a template exposes. */
async function canvaTemplateDataset(tokens: CanvaTokens, templateId: string) {
  const data = await canvaJson(
    tokens,
    `https://api.canva.com/rest/v1/brand-templates/${templateId}/dataset`,
  );
  // { dataset: { fieldName: { type: "text"|"image"|"chart" }, ... } }
  const fields: { name: string; type: string }[] = [];
  for (const [name, def] of Object.entries(data.dataset || {})) {
    fields.push({ name, type: (def as { type?: string })?.type || "text" });
  }
  return fields;
}

async function canvaPoll(tokens: CanvaTokens, path: string) {
  for (let i = 0; i < CANVA_MAX_POLLS; i++) {
    const data = await canvaJson(tokens, path);
    const status = data.job?.status;
    if (status === "success") return data.job;
    if (status === "failed") throw new Error(`canva job failed: ${JSON.stringify(data.job?.error || {}).slice(0, 160)}`);
    await new Promise((r) => setTimeout(r, CANVA_POLL_MS));
  }
  throw new Error("canva job timed out");
}

/**
 * Fill a brand template with copy and return a public PNG URL.
 * `fields` is the template's dataset; we map text fields to headline/subhead/cta
 * by convention (largest/first = headline, then subhead, a cta-named field = cta).
 */
async function generateCanvaDesign(opts: {
  tokens: CanvaTokens; brandKey: string; templateId: string;
  fields: { name: string; type: string }[];
  headline: string; subhead?: string; cta?: string;
  kind?: "image" | "reel"; // reel -> autofill a video template + export MP4
}): Promise<string | null> {
  try {
    const textFields = opts.fields.filter((f) => f.type === "text");
    if (!textFields.length) return null;
    const ctaField = textFields.find((f) => /cta|button|link|url|action|footer/i.test(f.name));
    const bodyPool = [opts.headline, opts.subhead, opts.cta].filter(Boolean) as string[];
    const nonCta = textFields.filter((f) => f !== ctaField);
    const data: Record<string, { type: "text"; text: string }> = {};
    nonCta.forEach((f, i) => {
      const val = bodyPool[i] ?? (i === 0 ? opts.headline : "");
      if (val) data[f.name] = { type: "text", text: String(val).slice(0, 240) };
    });
    if (ctaField && opts.cta) data[ctaField.name] = { type: "text", text: opts.cta.slice(0, 80) };
    if (!Object.keys(data).length) return null;

    // 1) autofill job -> design id
    const af = await canvaJson(opts.tokens, "https://api.canva.com/rest/v1/autofills", {
      method: "POST",
      body: JSON.stringify({ brand_template_id: opts.templateId, data }),
    });
    const afJob = af.job?.status === "success" ? af.job : await canvaPoll(opts.tokens, `https://api.canva.com/rest/v1/autofills/${af.job.id}`);
    const designId = afJob?.result?.design?.id;
    if (!designId) return null;

    // 2) export the design — MP4 (vertical 1080p) for reels, else PNG
    const isReel = opts.kind === "reel";
    const format = isReel ? { type: "mp4", quality: "vertical_1080p" } : { type: "png" };
    const ex = await canvaJson(opts.tokens, "https://api.canva.com/rest/v1/exports", {
      method: "POST",
      body: JSON.stringify({ design_id: designId, format }),
    });
    const exJob = ex.job?.status === "success" ? ex.job : await canvaPoll(opts.tokens, `https://api.canva.com/rest/v1/exports/${ex.job.id}`);
    const outUrl = exJob?.urls?.[0];
    if (!outUrl) return null;

    // 3) pull the export and re-host it in our own bucket (Canva URLs expire)
    const outRes = await fetch(outUrl);
    if (!outRes.ok) return null;
    const bytes = new Uint8Array(await outRes.arrayBuffer());
    const sb = db();
    const ext = isReel ? "mp4" : "png";
    const mime = isReel ? "video/mp4" : "image/png";
    const path = `marketing-designs/${opts.brandKey}/canva-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from("wrap-files").upload(path, bytes, { contentType: mime, upsert: true });
    if (error) return null;
    return sb.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
  } catch (_e) {
    return null;
  }
}

type CanvaMap = {
  template_id: string; fields: { name: string; type: string }[];
  reel_template_id?: string | null; reel_fields?: { name: string; type: string }[];
};
/** Read a brand's saved Canva template mapping (image + reel templates). */
async function loadCanvaMap(brandKey: string): Promise<CanvaMap | null> {
  try {
    const { data } = await db()
      .from("brand_canva_templates")
      .select("template_id, field_map, reel_template_id, reel_field_map")
      .eq("brand", brandKey)
      .maybeSingle();
    if (!data) return null;
    if (!data.template_id && !data.reel_template_id) return null;
    return {
      template_id: data.template_id,
      fields: Array.isArray(data.field_map) ? data.field_map : [],
      reel_template_id: data.reel_template_id || null,
      reel_fields: Array.isArray(data.reel_field_map) ? data.reel_field_map : [],
    };
  } catch {
    return null;
  }
}

// Pull a REAL on-brand image straight from the Content Studio library
// (wrap-files/canva-templates/{brand}/{content_type}) instead of AI-generating
// one. This is the operator's actual photo/ad — no invented logos, no slop.
// Brand key -> the storage folder under `wrap-files/canva-templates/`.
//
// VERIFIED AGAINST STORAGE, 2026-08-07. Only three folders exist, and this map
// disagreed with all of it:
//
//   DesignProAI   17 files      RestyleProAI  31 files    WePrintWraps  38 files
//   (no WrapTV folder, no InkAndEdge folder — those two entries pointed nowhere)
//
// Two brands were missing entirely, and both are live: `wraptvworld` — the
// CANONICAL spelling, carrying 75 of the 84 posts for that brand — and
// `designproai`, which has its own folder sitting unused. Neither was a key
// here, so both fell through the `|| "WePrintWraps"` default and would have
// been served WePrintWraps' assets under their own name. `wraptv` was mapped,
// but only the alias, and to a folder that does not exist.
//
// `wraptvworld` has no folder of its own yet, so it now resolves to null and
// takes the honest gap rather than another brand's artwork.
const LIB_BRAND: Record<string, string> = {
  weprintwraps: "WePrintWraps",
  restylepro: "RestyleProAI",
  designproai: "DesignProAI",
};
// Alias spellings, resolved to the same key. Kept beside the map rather than
// folded into it so it stays visible that these are ONE brand, matching
// src/lib/brandAliases.ts.
const LIB_BRAND_ALIAS: Record<string, string> = {
  wraptv: "wraptvworld",
  "wraptvworld-documentary": "wraptvworld",
};
const LIB_TYPE: Record<string, string[]> = {
  post: ["static-4x5", "static-1x1"], organic: ["static-4x5", "static-1x1"],
  ad: ["static-1x1", "static-4x5"], reel: ["reel", "story"], story: ["story", "reel"],
  carousel: ["carousel", "static-1x1"],
};
const LIB_IMG_RE = /\.(png|jpe?g|webp|gif|mp4|mov|webm)$/i;
async function pickLibraryImage(brandKey: string, itemType: string): Promise<string | null> {
  // NO DEFAULT BRAND. This was `LIB_BRAND[brandKey] || "WePrintWraps"`, which
  // turned every unmapped brand into WePrintWraps' artwork published under
  // someone else's name — the one failure a reviewer cannot spot, because the
  // post looks finished and on-brand, just for the wrong brand. An honest null
  // makes the caller take the gap instead.
  const key = String(brandKey || "").trim().toLowerCase();
  const brand = LIB_BRAND[LIB_BRAND_ALIAS[key] || key];
  if (!brand) {
    console.log(`[library] no asset folder for brand "${brandKey}" — refusing rather than serving another brand's artwork`);
    return null;
  }
  const order = LIB_TYPE[String(itemType || "post").toLowerCase()] || ["static-1x1", "static-4x5"];
  const sb = db();
  const tried = new Set<string>();
  for (const ctype of [...order, "static-1x1", "static-4x5"]) {
    if (tried.has(ctype)) continue;
    tried.add(ctype);
    const folder = `canva-templates/${brand}/${ctype}`;
    const { data } = await sb.storage.from("wrap-files").list(folder, { limit: 100 });
    const files = (data || []).filter((f) => LIB_IMG_RE.test(f.name));
    if (files.length) {
      const f = files[Math.floor(Math.random() * files.length)];
      return sb.storage.from("wrap-files").getPublicUrl(`${folder}/${f.name}`).data.publicUrl;
    }
  }
  return null;
}

/**
 * Resolve Canva credentials from the already authenticated request principal.
 * A human receives only their own integration. An internal caller (service
 * bearer or function-local named secret) receives the explicitly selected
 * server integration, so named-secret workers do not silently lose Canva.
 */
async function canvaTokensForPrincipal(
  principal: RequestPrincipal,
  body?: Record<string, unknown>,
): Promise<CanvaTokens | null> {
  try {
    if (principal.kind === "human") return await loadTokens(principal.userId);

    const owner = typeof body?.canva_owner_id === "string" ? body.canva_owner_id : null;
    const { tokens, reason, candidates } = await loadServerTokens(owner);
    if (!tokens) {
      console.log(`[canva] internal call has no usable token — ${reason} (candidates=${candidates})`);
    }
    return tokens;
  } catch {
    return null;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-restylepro-internal-secret",
};
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o";
const KLAVIYO_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15";

// Marketing Hub brand slugs -> brand-os identity used in the copy prompt.
// How many review cards the Director queue carries. Raised from 100/50 when
// the queue was found showing the 100 OLDEST drafts — the cap and the
// oldest-first sort together hid 111 newer cards, including that same day's
// renders. The response now also reports the true totals (see `totals`), so a
// limit can never masquerade as an inventory again.
const DIRECTOR_QUEUE_LIMIT = 200;
const DIRECTOR_QUEUE_EMAIL_LIMIT = 100;

const BRAND_OS_NAME: Record<string, string> = {
  weprintwraps: "WePrintWraps",
  restylepro: "RestyleProAI",
  designproai: "DesignProAI",
  wraptv: "WrapTV",
  wraptvworld: "WrapTV",
  inkandedge: "InkAndEdge",
  thewrap: "TheWrap",
};

/**
 * The brand-voice block name for a brand key, following alias spellings.
 *
 * Every call site was `brandOsName(brand)`. This map is
 * much fuller than LIB_BRAND was, so the default rarely fired — but it DID
 * fire for `wraptvworld-documentary`, which is a real live spelling on two
 * posts. Those two would have been written in WePrintWraps' voice and
 * published under WrapTVWorld's name: the same wrong-artifact-that-looks-right
 * failure as the artwork leak, one layer up, in the copy instead of the image.
 *
 * The `|| "WePrintWraps"` fallback is KEPT here, unlike in `pickLibraryImage`,
 * and the difference is deliberate. An unmapped brand with no artwork can
 * honestly ship nothing — a gap is a valid outcome. A copy generator with no
 * voice block has no equivalent: it would either fail the call or write in no
 * voice at all. So the fix is to stop the default firing for brands we DO
 * know, rather than to remove the floor under the ones we don't.
 */
function brandOsName(brandKey: unknown): string {
  const key = String(brandKey || "").trim().toLowerCase();
  return BRAND_OS_NAME[LIB_BRAND_ALIAS[key] || key] || "WePrintWraps";
}
const DEFAULT_FROM: Record<string, { email: string; label: string }> = {
  weprintwraps: { email: "hello@weprintwraps.com", label: "WePrintWraps" },
  restylepro: { email: "hello@restyleproai.com", label: "RestyleProAI" },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const MAX_JSON_REQUEST_BYTES = 2 * 1024 * 1024;

async function readJsonBody(req: Request): Promise<Record<string, unknown> | Response> {
  const rawLength = req.headers.get("content-length");
  if (rawLength) {
    const declared = Number(rawLength);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_JSON_REQUEST_BYTES) {
      return json({ error: "Request body too large" }, 413);
    }
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > MAX_JSON_REQUEST_BYTES) {
    return json({ error: "Request body too large" }, 413);
  }
  if (!bytes.length) return json({ error: "Invalid JSON body" }, 400);

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "JSON body must be an object" }, 400);
    }
    return parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
}

type HumanPrincipal = {
  kind: "human";
  userId: string;
  isPlatformAdmin: boolean;
};
type RequestPrincipal = HumanPrincipal | { kind: "internal" };

const HUMAN_ACTIONS = new Set([
  "ad_pack",
  "ads_audit",
  "approve",
  "audiences",
  "autocut",
  "canva_config",
  "canva_designs",
  "canva_export",
  "canva_folders",
  "canva_map",
  "canva_starred",
  "canva_templates",
  "canva_unmap",
  "chat",
  "cribs_build",
  "design",
  "director_approve",
  "director_ideas",
  "director_plan_week",
  "copy_backfill",
  "make_creative",
  "installer_reel",
  "installer_series",
  "director_queue",
  "director_reject",
  "episode_atomize",
  "episode_build",
  "extract_content",
  "footage_approve",
  "footage_generate",
  "footage_ideas",
  "hooks",
  "hooks_to_drafts",
  "idea_approve",
  "idea_reject",
  "import_products",
  "import_products_woo",
  "library_ingest",
  "newsletter_roundup",
  "plan",
  "plan_social",
  "push",
  "repurpose_across_brands",
  "review",
  "run",
  "revise_copy",
  "series_build",
  "shot_list_fresh_ideas",
  "shot_list_idea",
  "stats",
  "transcript_cut",
  "transcript_export",
  "vision_score"
]);
// Only actions whose implementation performs tenant authorization may appear
// here. Legacy/unscoped human actions remain platform-admin-only.
const TENANT_SCOPED_HUMAN_ACTIONS = new Set(["idea_approve"]);

const INTERNAL_ACTIONS = new Set([
  "deploy_sweep",
  "design",
  "director_plan_week",
  // The backfill is INTERNAL: it rewrites existing drafts in bulk, so it is a
  // cron/service capability rather than something a browser session can fire.
  "copy_backfill",
  "run",
  // ad_pack is a PAID action — it calls a model and picks a creative — and was
  // human-only for that reason. Opened to internal callers 2026-08-13 on the
  // owner's explicit decision so the AdsPro proposals board can show the
  // challenger copy and clip ON the card BEFORE approval. Owner: "that should
  // be there before i click approve so i read and view creative that will be
  // added." A board that asks you to approve a replacement you cannot see is
  // asking you to approve a promise, and the only caller able to prepare it
  // ahead of time is the server-side scan.
  //
  // Spend stays bounded by machinery that already exists, not by this gate:
  //   - adPackKey fences on (brand, placement, goal) with NO clock, so a
  //     repeated sweep returns the pack already bought instead of buying it
  //     again;
  //   - ads-proposals caps content generation per scan (max_content, 6);
  //   - a scan is owner-triggered, and the one scheduled caller is the noon
  //     pace check, which raises a contingency card and does not call ad_pack.
  // If an automated caller ever starts burning model spend here, the fence and
  // the cap are the things to look at first — not this line.
  "ad_pack",
  "vision_score"
]);

const SERVICE_ROLE_PROBE_SENTINEL = "restylepro-service-role-capability-probe-v1";

/** Compare credentials without an early-exit string comparison. */
async function constantTimeEqual(presented: string, expected: string): Promise<boolean> {
  const encoded = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoded.encode(presented)),
    crypto.subtle.digest("SHA-256", encoded.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return expected.length > 0 && presented.length > 0 && difference === 0;
}

/**
 * Prove a bearer has the service_role PostgREST capability without depending
 * on byte equality with this Edge runtime's key. The live verifier RPC is a
 * narrow capability unavailable to PUBLIC, anon, and authenticated roles.
 */
async function hasServiceRoleCapability(supabaseUrl: string, bearer: string): Promise<boolean> {
  if (!supabaseUrl || !bearer) return false;
  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/verify_marketing_agent_cron_secret`,
      {
        method: "POST",
        headers: {
          apikey: bearer,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ presented_secret: SERVICE_ROLE_PROBE_SENTINEL }),
        redirect: "error",
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Authenticate before parsing a body. Every human call needs a live Supabase
 * user JWT; the principal records platform-admin status for the action gate.
 * Legacy/unscoped actions remain admin-only, while tenant-scoped actions must
 * authorize shop membership inside their implementation. Automated callers
 * must present a bearer proven to have service_role capability, the exact
 * runtime service key, the function-local named secret, or the Vault-backed
 * pg_cron secret. Publishable/anon keys authorize nothing.
 */
async function authorizeRequest(req: Request): Promise<RequestPrincipal | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const namedSecret = Deno.env.get("MARKETING_AGENT_INTERNAL_SECRET") || "";
  const presentedSecret = req.headers.get("x-restylepro-internal-secret") || "";
  if (await constantTimeEqual(presentedSecret, namedSecret)) {
    return { kind: "internal" };
  }

  // PR #4176 installs this service_role-only verifier before the handler
  // boundary is deployed. A missing/unavailable verifier fails closed.
  if (presentedSecret) {
    if (!supabaseUrl || !serviceKey) {
      console.error("[marketing-agent] auth configuration missing");
      return json({ error: "Authentication unavailable" }, 503);
    }
    const verifier = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: cronSecretValid, error: verifierError } = await verifier.rpc(
      "verify_marketing_agent_cron_secret",
      { presented_secret: presentedSecret },
    );
    if (verifierError) {
      console.error("[marketing-agent] cron credential verification failed");
      return json({ error: "Authentication unavailable" }, 503);
    }
    if (cronSecretValid === true) return { kind: "internal" };
  }

  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+([^\s]+)$/i);
  const bearer = match?.[1] || "";
  const [serviceBearerMatches, namedBearerMatches] = await Promise.all([
    constantTimeEqual(bearer, serviceKey),
    constantTimeEqual(bearer, namedSecret),
  ]);
  if (serviceBearerMatches || namedBearerMatches) {
    return { kind: "internal" };
  }
  if (!bearer) return json({ error: "Unauthorized" }, 401);

  // Modern secret keys are not JWTs and may not byte-match the Edge runtime
  // key. Prove only the service_role-only RPC capability with apikey; any
  // non-2xx response falls through to live human JWT validation.
  if (await hasServiceRoleCapability(supabaseUrl, bearer)) {
    return { kind: "internal" };
  }

  if (!supabaseUrl || !serviceKey) {
    console.error("[marketing-agent] auth configuration missing");
    return json({ error: "Authentication unavailable" }, 503);
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await admin.auth.getUser(bearer);
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  const { data: role, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  if (roleError) {
    console.error("[marketing-agent] admin role lookup failed");
    return json({ error: "Authorization unavailable" }, 503);
  }
  return {
    kind: "human",
    userId: user.id,
    isPlatformAdmin: role?.role === "admin",
  };
}

// ── chat — a conversational marketing agent that DRAFTS content onto the QC
//    board. The operator talks to it in plain English; when they ask for
//    content it writes the pieces and drops them as slack_agent_tasks cards
//    (To Do / marketing) for human QC. Nothing sends. ──────────────────────
type ChatTurn = { role: "user" | "assistant"; content: string };
const CHAT_TASK_TYPE: Record<string, string> = {
  post: "social_post", organic: "social_post", reel: "social_post",
  story: "social_post", carousel: "social_post", ad: "ad_campaign",
  email: "email_campaign",
};
async function actionChat(body: Record<string, unknown>, canvaTokens?: CanvaTokens | null) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
  const brand = String(body.brand || "weprintwraps");
  const message = String(body.message || "").trim();
  if (!message) return json({ error: "message required" }, 400);
  const history = Array.isArray(body.history) ? (body.history as ChatTurn[]).slice(-12) : [];
  const brandBlock = await loadBrandBlock(brandOsName(brand));

  const system =
    `You are the marketing agent for this brand — a sharp, plain-spoken content partner ` +
    `for the operator. You chat naturally AND you can DRAFT finished content that lands on ` +
    `the team's QC board for human review (nothing you make is ever auto-published).\n\n` +
    `When the operator asks you to make/draft/write content (posts, reels, stories, ` +
    `carousels, ads, emails), WRITE the finished pieces in the brand voice below and return ` +
    `them in "create". When they're just talking/strategizing, reply and leave "create" empty.\n\n` +
    `You can also SCHEDULE content to publish. The current time is ${new Date().toISOString()} (UTC). ` +
    `When the operator asks you to schedule or post at a time ("schedule these for Monday 9am", ` +
    `"post one a day next week", "put this out tomorrow morning"), set "schedule" on each item to ` +
    `an ISO 8601 UTC datetime you compute from now. Scheduled items go LIVE to social automatically ` +
    `at that time — so only set "schedule" when they clearly ask to schedule/post. Leave "schedule" ` +
    `off for drafts (those just go to the QC board for review).\n\n` +
    `Return ONLY a strict JSON object:\n` +
    `{ "reply": string (your conversational answer to the operator),\n` +
    `  "create": [ { "type": "post|reel|story|carousel|ad|email", "title": short label, ` +
    `"content": the full finished copy (hook + body + CTA, ready to post), ` +
    `"schedule": optional ISO 8601 UTC datetime to auto-publish (omit for review-only drafts) } ] }\n` +
    `Keep "create" empty unless they clearly want content made. Never invent prices, ` +
    `discounts, or stats not in the brand voice.\n\n` +
    `IMPORTANT: HOOK/PROOF/CTA (and SUBHEAD/HEADLINE/BODY) are STRUCTURE, not text — ` +
    `NEVER print those label words in the actual copy. Write the finished ad as it ` +
    `should read, with no "PROOF:" or "HOOK:" prefixes.\n\n${brandBlock}`;

  const messages = [
    { role: "system", content: system },
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: message },
  ];
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: 0.6, response_format: { type: "json_object" }, messages,
    }),
  });
  if (!res.ok) return json({ error: `OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502);
  const data = await res.json();
  let parsed: { reply?: string; create?: { type: string; title: string; content: string; schedule?: string }[] } = {};
  try { parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}"); } catch { /* */ }
  const reply = parsed.reply || "Done.";
  const toCreate = Array.isArray(parsed.create) ? parsed.create.slice(0, 8) : [];

  const wantDesign = body.design !== false; // default ON — real branded graphics
  // Prefer the operator's own Canva Brand Template (real logo/fonts/colors) when
  // one is mapped for this brand AND their Canva token has autofill scopes.
  const canvaMap = wantDesign && canvaTokens ? await loadCanvaMap(brand) : null;
  const sb = db();
  const created: { id: string; type: string; title: string; design_url?: string; scheduled_for?: string }[] = [];
  for (const item of toCreate) {
    if (!item?.content) continue;
    const ttype = CHAT_TASK_TYPE[String(item.type || "post").toLowerCase()] || "social_post";
    const label = (item.title || item.type || "Content").toString().slice(0, 120);

    // Build a REAL on-brand design image for the card (best-effort — a design
    // failure never blocks the copy). Canva Brand Template first, Gemini fallback.
    let designUrl: string | null = null;
    if (wantDesign) {
      // Strip any structural labels (HOOK:/PROOF:/CTA:/SUBHEAD:) the copy may carry —
      // they're structure, not text to render on the design.
      const delabel = (s: string) => s.replace(/^\s*(hook|proof|cta|subhead|headline|body)\s*[:\-–]\s*/i, "").replace(/^["“”']|["“”']$/g, "").trim();
      const lines = String(item.content).split("\n").map((l) => delabel(l.trim())).filter(Boolean);
      const headline = delabel((item.title || lines[0] || label).toString())
        .replace(/\s+(ad|post|reel|story|carousel|campaign|email|graphic)s?$/i, "").slice(0, 120);
      const subhead = (lines[1] || "").slice(0, 160);
      const cta = (lines.find((l) => /→|\.com|shop|quote|follow|watch|read|try|book/i.test(l)) || "").slice(0, 80);
      const isReelItem = String(item.type).toLowerCase() === "reel";
      if (canvaMap && canvaTokens) {
        if (isReelItem && canvaMap.reel_template_id) {
          // Canva reel: autofill the video brand template → export MP4.
          designUrl = await generateCanvaDesign({
            tokens: canvaTokens, brandKey: brand, templateId: canvaMap.reel_template_id,
            fields: canvaMap.reel_fields || [], headline, subhead, cta, kind: "reel",
          });
        } else if (!isReelItem && canvaMap.template_id) {
          designUrl = await generateCanvaDesign({
            tokens: canvaTokens, brandKey: brand, templateId: canvaMap.template_id,
            fields: canvaMap.fields, headline, subhead, cta,
          });
        }
      }
      // No Canva template → attach a REAL asset from the Content Studio library
      // (the operator's own photo / ad / reel), never an AI-invented one.
      if (!designUrl) {
        designUrl = await pickLibraryImage(brand, item.type);
      }
    }

    // SCHEDULE → publishable post. When the operator asked to schedule/post at a
    // time, write a real agent_social_posts row (status 'scheduled') that
    // content-deploy publishes to Instagram/Facebook when due. Emails aren't
    // social — they still route to the board (use the email plan/Klaviyo flow).
    let scheduledFor: string | null = null;
    const schedRaw = item.schedule ? new Date(String(item.schedule)) : null;
    const wantsSchedule = !!schedRaw && !isNaN(schedRaw.getTime()) && item.type !== "email";
    if (wantsSchedule) {
      scheduledFor = schedRaw!.toISOString();
      const hashtags = (String(item.content).match(/#[\w]+/g) || []).join(" ");
      await sb.from("agent_social_posts").insert({
        brand, platform: "instagram", post_type: item.type === "reel" ? "reel" : "feed",
        caption: item.content, hashtags: hashtags || null,
        scheduled_date: scheduledFor, status: "scheduled",
        media_urls: designUrl ? [designUrl] : [],
        created_by: "marketing-agent-chat",
      });
    }

    const { data: card } = await sb.from("slack_agent_tasks").insert({
      brand, category: "marketing", task_type: ttype,
      title: `[${brand} · ${item.type}] ${label}`.slice(0, 160),
      description: item.content, status: wantsSchedule ? "in_progress" : "pending", priority: "medium",
      created_by: "marketing-agent-chat",
      metadata: {
        content_type: item.type, source: "marketing-agent-chat", full_caption: item.content,
        ...(scheduledFor ? { scheduled_for: scheduledFor } : {}),
        ...(designUrl ? { thumbnail_url: designUrl, media_url: designUrl } : {}),
      },
    }).select("id").single();
    if (card?.id) created.push({ id: card.id, type: item.type, title: label, ...(designUrl ? { design_url: designUrl } : {}), ...(scheduledFor ? { scheduled_for: scheduledFor } : {}) });
  }
  return json({ action: "chat", reply, created });
}
function db() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}
function klaviyoHeaders(key: string) {
  return { Authorization: `Klaviyo-API-Key ${key}`, revision: KLAVIYO_REVISION, "Content-Type": "application/json" };
}
async function klaviyo(key: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${KLAVIYO_BASE}${path}`, {
    method, headers: klaviyoHeaders(key), body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`Klaviyo ${method} ${path} ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

// ── audiences ────────────────────────────────────────────────────────────────
async function listAudiences(key: string) {
  // Klaviyo caps /lists/ at page[size]=10 (profile_count is a computed extra
  // field) — walk the cursor pagination, up to 100 lists.
  const out: { id: string; name: string; profiles: number | null }[] = [];
  let path: string | null = `/lists/?additional-fields[list]=profile_count&page[size]=10`;
  let hops = 0;
  while (path && hops < 10) {
    let data;
    try {
      data = await klaviyo(key, "GET", path);
    } catch {
      // fall back without the computed field if the account rejects it
      data = await klaviyo(key, "GET", path.replace("additional-fields[list]=profile_count&", ""));
    }
    for (const l of data.data ?? []) {
      out.push({ id: l.id, name: l.attributes.name, profiles: l.attributes.profile_count ?? null });
    }
    const next = data.links?.next as string | undefined;
    path = next ? next.replace(KLAVIYO_BASE, "") : null;
    hops++;
  }
  return out.sort((a, b) => (b.profiles ?? 0) - (a.profiles ?? 0));
}

// ── plan (OpenAI writes the campaigns; humans QC them in the Hub) ────────────
interface PlannedCampaign {
  campaign_name: string; campaign_type: string; subject_line: string;
  preview_text: string; body_text: string; body_html: string;
  recommended_audience: string; scheduled_date: string; rationale: string;
}

async function planCampaigns(
  brand: string, goal: string, count: number, audience: string, openaiKey: string,
): Promise<PlannedCampaign[]> {
  const brandBlock = await loadBrandBlock(brandOsName(brand));
  const system =
    `You are the email marketing lead for this brand. You write complete, ready-to-send ` +
    `email campaigns as strict JSON. ` +
    // THE 80/20 RULE (Sabri Suby, owner directive 2026-08-03): at any moment only
    // ~2-3% of the list is ready to buy; pitching the other 97% burns goodwill and
    // deliverability. Every email is ~80% genuine standalone value and at most ~20%
    // offer. This is the campaign brain's editorial law — do not weaken it.
    `THE 80/20 LAW: roughly 80% of every email must be genuinely useful on its own — ` +
    `teach one real thing the reader can use today (a mistake to avoid, a number that ` +
    `changes a decision, a faster way to do their job) even if they never buy. The reader ` +
    `should feel smarter for opening it. Only AFTER the value is delivered may you make ` +
    `ONE soft ask, framed as the natural next step of what was just taught — never a hard ` +
    `pitch, never urgency theatrics. Subject lines sell the LESSON, not the product. ` +
    `A P.S. line may carry the offer instead of the body. Assume only 2-3% of readers are ` +
    `in buying mode; write for the other 97% so this brand is the one they trust when ` +
    `they are ready.\n` +
    `Craft rules: lead with a customer pain or a concrete number, ` +
    `ONE clear call-to-action per email, short sentences, no invented statistics, no invented ` +
    `discounts or prices unless the goal explicitly includes an offer, no spam-trigger words ` +
    `(free!!!, act now, guaranteed). body_html must be a single self-contained fragment: one ` +
    `600px-max centered table, inline CSS only, dark text on white, one CTA button, and it must ` +
    `include the literal string {% unsubscribe %} in a small footer line (Klaviyo requires an ` +
    `unsubscribe link). body_text is the plain-text equivalent. Return ONLY the JSON object.\n\n${brandBlock}`;
  const user =
    `Goal: ${goal}\nAudience: ${audience}\nToday: ${new Date().toISOString().slice(0, 10)}\n\n` +
    `Write ${count} distinct email campaign(s) working toward the goal (e.g. different angles ` +
    `or sequence steps, spaced 3-4 days apart starting 2 days from today). Return JSON:\n` +
    `{"campaigns":[{"campaign_name":"...","campaign_type":"promo|nurture|winback|announcement",` +
    `"subject_line":"...","preview_text":"...","body_text":"...","body_html":"...",` +
    `"recommended_audience":"...","scheduled_date":"YYYY-MM-DD","rationale":"one sentence on why this angle"}]}`;

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: 0.5, response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(data).slice(0, 250)}`);
  const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  if (!Array.isArray(parsed.campaigns) || !parsed.campaigns.length) throw new Error("OpenAI returned no campaigns");
  return parsed.campaigns as PlannedCampaign[];
}

async function actionPlan(body: Record<string, unknown>) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
  const brand = String(body.brand || "weprintwraps");
  const goal = String(body.goal || "").trim();
  const count = Math.min(Number(body.count) || 2, 5);
  const audience = String(body.audience || "past customers and recent quote requesters");
  if (!goal) return json({ error: "pass goal: what should these campaigns achieve?" }, 400);

  const campaigns = await planCampaigns(brand, goal, count, audience, openaiKey);
  const sb = db();
  const created: Record<string, unknown>[] = [];
  for (const c of campaigns) {
    // 1) The campaign itself — the Hub's Email tab + Content Calendar read this table.
    const { data: row, error } = await sb.from("agent_email_campaigns").insert({
      brand, campaign_name: c.campaign_name, campaign_type: c.campaign_type || "promo",
      subject_line: c.subject_line, preview_text: c.preview_text,
      body_text: c.body_text, body_html: c.body_html,
      list_segment: c.recommended_audience || audience,
      scheduled_date: c.scheduled_date || null,
      status: "needs_review", created_by: "marketing-agent",
    }).select("id").single();
    if (error) { created.push({ campaign: c.campaign_name, error: error.message }); continue; }

    // 2) A Marketing Hub card in the "To Do" column so the human team QCs it.
    await sb.from("slack_agent_tasks").insert({
      brand, task_type: "email_campaign", status: "pending", priority: "high",
      title: `QC email: ${c.campaign_name}`,
      description:
        `AI-drafted campaign awaiting human review.\n\nSubject: ${c.subject_line}\n` +
        `Preview: ${c.preview_text}\nAudience: ${c.recommended_audience || audience}\n` +
        `Why this angle: ${c.rationale}\n\n--- BODY ---\n${c.body_text}`,
      created_by: "marketing-agent",
      metadata: { source: "marketing-agent", campaign_id: row.id, goal },
    });

    // 3) Calendar entry so it shows on the day it should go out.
    if (c.scheduled_date) {
      await sb.from("agent_content_calendar").insert({
        brand, content_type: "email_campaign", date: c.scheduled_date,
        title: c.campaign_name, status: "needs_review",
        pipeline_table: "agent_email_campaigns", pipeline_id: row.id,
        notes: `Subject: ${c.subject_line}`,
      });
    }
    created.push({ campaign_id: row.id, campaign: c.campaign_name, subject: c.subject_line, scheduled: c.scheduled_date });
  }
  return json({ action: "plan", brand, goal, created });
}

// ── review (what the agent built + where it stands — the QC readback) ────────
async function actionReview(body: Record<string, unknown>) {
  const sb = db();
  const brand = String(body.brand || "weprintwraps");
  const [camps, cards, cal] = await Promise.all([
    sb.from("agent_email_campaigns")
      .select("id, campaign_name, subject_line, status, scheduled_date, klaviyo_campaign_id, list_segment")
      .eq("brand", brand).eq("created_by", "marketing-agent")
      .order("created_at", { ascending: false }).limit(25),
    sb.from("slack_agent_tasks")
      .select("id, title, status, priority, metadata")
      .eq("brand", brand).eq("created_by", "marketing-agent")
      .order("created_at", { ascending: false }).limit(25),
    sb.from("agent_content_calendar")
      .select("id, title, date, status, pipeline_id")
      .eq("brand", brand).eq("pipeline_table", "agent_email_campaigns")
      .order("date", { ascending: true }).limit(25),
  ]);
  return json({
    action: "review", brand,
    campaigns: camps.data ?? [], campaigns_error: camps.error?.message,
    hub_cards: cards.data ?? [], hub_cards_error: cards.error?.message,
    calendar: cal.data ?? [], calendar_error: cal.error?.message,
  });
}

// ── approve (flip a campaign to approved — the human QC gate action) ─────────
async function actionApprove(body: Record<string, unknown>) {
  const sb = db();
  const campaignId = String(body.campaign_id || "");
  if (!campaignId) return json({ error: "pass campaign_id" }, 400);
  const { error } = await sb.from("agent_email_campaigns")
    .update({ status: "approved" }).eq("id", campaignId);
  if (error) return json({ error: error.message }, 500);
  // Move the matching Hub card out of "To Do".
  await sb.from("slack_agent_tasks").update({ status: "in_progress" })
    .eq("created_by", "marketing-agent").contains("metadata", { campaign_id: campaignId });
  return json({ action: "approve", campaign_id: campaignId, status: "approved" });
}

// ── push (human-approved campaign -> REAL Klaviyo DRAFT; never sends) ────────
async function actionPush(body: Record<string, unknown>) {
  const klaviyoKey = Deno.env.get("KLAVIYO_API_KEY");
  if (!klaviyoKey) return json({ error: "KLAVIYO_API_KEY missing" }, 500);
  const campaignId = String(body.campaign_id || "");
  const listId = String(body.list_id || "");
  if (!campaignId || !listId) return json({ error: "pass campaign_id and list_id (see action:audiences)" }, 400);

  const sb = db();
  const { data: row, error } = await sb.from("agent_email_campaigns").select("*").eq("id", campaignId).single();
  if (error || !row) return json({ error: `campaign ${campaignId} not found` }, 404);
  if (row.klaviyo_campaign_id) return json({ error: `already in Klaviyo as ${row.klaviyo_campaign_id}` }, 409);
  // Human gate: the team flips status to "approved" in the Hub before push.
  if (row.status !== "approved" && body.force !== true) {
    return json({ error: `status is "${row.status}" — approve it in the Marketing Hub first (or pass force:true)` }, 412);
  }

  const from = DEFAULT_FROM[row.brand] || DEFAULT_FROM.weprintwraps;
  const fromEmail = String(body.from_email || from.email);
  const fromLabel = String(body.from_label || from.label);

  // 1) HTML template. Klaviyo requires an unsubscribe link — inject one if the
  //    AI draft somehow lacks it.
  let html = row.body_html || `<p>${(row.body_text || "").replace(/\n/g, "<br>")}</p>`;
  if (!html.includes("{% unsubscribe %}")) {
    html += `<p style="font-size:11px;color:#888;text-align:center">{% unsubscribe %}</p>`;
  }
  const tpl = await klaviyo(klaviyoKey, "POST", "/templates/", {
    data: { type: "template", attributes: { name: `[agent] ${row.campaign_name}`, editor_type: "CODE", html, text: row.body_text || "" } },
  });

  // 2) DRAFT campaign against the chosen real list. Klaviyo campaigns are
  //    created in Draft status; the static datetime below is only the plan it
  //    WOULD follow — nothing goes out unless a human triggers the send in
  //    Klaviyo (we NEVER call the send-job endpoint).
  const sendAt = row.scheduled_date
    ? `${String(row.scheduled_date).slice(0, 10)}T14:00:00`
    : new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 11) + "14:00:00";
  const camp = await klaviyo(klaviyoKey, "POST", "/campaigns/", {
    data: {
      type: "campaign",
      attributes: {
        name: `[agent] ${row.campaign_name}`,
        audiences: { included: [listId], excluded: [] },
        send_strategy: { method: "static", options_static: { datetime: sendAt } },
        "campaign-messages": {
          data: [{
            type: "campaign-message",
            attributes: {
              channel: "email", label: row.campaign_name,
              content: {
                subject: row.subject_line || row.campaign_name,
                preview_text: row.preview_text || "",
                from_email: fromEmail, from_label: fromLabel, reply_to_email: fromEmail,
              },
            },
          }],
        },
      },
    },
  });
  const klaviyoCampaignId = camp.data.id;
  const messageId = camp.data.relationships?.["campaign-messages"]?.data?.[0]?.id;
  if (messageId) {
    // 3) Attach our HTML template to the campaign's message.
    await klaviyo(klaviyoKey, "POST", "/campaign-message-assign-template/", {
      data: {
        type: "campaign-message", id: messageId,
        relationships: { template: { data: { type: "template", id: tpl.data.id } } },
      },
    });
  }

  await sb.from("agent_email_campaigns").update({
    klaviyo_campaign_id: klaviyoCampaignId, status: "in_klaviyo",
    stats: { pushed_at: new Date().toISOString(), list_id: listId, template_id: tpl.data.id },
  }).eq("id", campaignId);

  return json({
    action: "push", campaign_id: campaignId, klaviyo_campaign_id: klaviyoCampaignId,
    template_id: tpl.data.id, list_id: listId,
    note: "Created as a DRAFT in Klaviyo — review and hit Send there. This agent never sends.",
  });
}

// ── stats (MEASURE: pull Klaviyo results back onto the row) ──────────────────
async function actionStats(body: Record<string, unknown>) {
  const klaviyoKey = Deno.env.get("KLAVIYO_API_KEY");
  if (!klaviyoKey) return json({ error: "KLAVIYO_API_KEY missing" }, 500);
  const campaignId = String(body.campaign_id || "");
  const sb = db();
  const { data: row } = await sb.from("agent_email_campaigns").select("*").eq("id", campaignId).single();
  if (!row?.klaviyo_campaign_id) return json({ error: "campaign not found or not pushed to Klaviyo yet" }, 404);

  const camp = await klaviyo(klaviyoKey, "GET", `/campaigns/${row.klaviyo_campaign_id}/`);
  const attrs = camp.data.attributes || {};
  const stats: Record<string, unknown> = {
    ...(row.stats || {}), klaviyo_status: attrs.status, send_time: attrs.send_time,
    synced_at: new Date().toISOString(),
  };

  // Best-effort performance report (needs a conversion metric — Placed Order).
  try {
    // /metrics/ doesn't support filtering by name — pull the page and match.
    const metrics = await klaviyo(klaviyoKey, "GET", `/metrics/`);
    const metricId = (metrics.data ?? []).find((m: { attributes: { name: string } }) =>
      m.attributes?.name === "Placed Order")?.id;
    if (metricId) {
      const report = await klaviyo(klaviyoKey, "POST", "/campaign-values-reports/", {
        data: {
          type: "campaign-values-report",
          attributes: {
            timeframe: { key: "last_12_months" },
            conversion_metric_id: metricId,
            statistics: ["delivered", "opens_unique", "clicks_unique", "open_rate", "click_rate", "conversion_value"],
            filter: `equals(campaign_id,"${row.klaviyo_campaign_id}")`,
          },
        },
      });
      const res0 = report.data?.attributes?.results?.[0];
      if (res0) stats.performance = res0.statistics;
    }
  } catch (e) {
    stats.performance_error = String(e).slice(0, 160);
  }

  const newStatus = attrs.status === "Sent" ? "sent" : row.status;
  await sb.from("agent_email_campaigns").update({
    stats, status: newStatus, ...(attrs.send_time ? { sent_date: attrs.send_time } : {}),
  }).eq("id", campaignId);
  return json({ action: "stats", campaign_id: campaignId, stats });
}

// ── plan_social (organic Meta posts with REAL media, into the deploy loop) ───
// The rails already exist: agent_social_posts is the deploy queue; the
// content-deploy cron publishes approved/scheduled posts to Instagram +
// Facebook every 5 minutes (brand-aware Meta connections). This action feeds
// that queue: pulls real media from the NATIVE RestylePro library
// (agent_media_assets — Drive-synced clips + finished Video Studio renders),
// has OpenAI pair each asset with a caption/angle toward the goal, and lands
// posts as status "draft" — the team approves/schedules in Content Review /
// the Hub, and ONLY then does content-deploy publish. The agent itself never
// publishes. (WrapCommand media-bridge dependency removed 2026-07 — no
// cross-project calls.)
type MediaAsset = { id: string; file_url: string; file_type: string; category: string; name: string; tags: string[]; duration_seconds: number | null; asset_type?: string };

// ── Tool-render connection (the whole system feeds content creation) ───────
// Past designs from EVERY tool join the agent media pool: ColorPro/DesignPro/
// FadeWraps/PatternPro/MyVehiclePro/WallPro renders (color_visualizations by
// mode_type — starred Gallery picks first, then the most recent completed),
// GraphicsPro jobs (graphics_pro_jobs), and CreatorMarket listings
// (marketplace_listings). Same curated set the Gallery and Content Studio's
// From-Renders picker show. All additive — a miss never blocks the pool.
const HERO_VIEW_ORDER = ["driver-side", "side", "hero", "front", "close-up"];

async function toolRenderList(limit: number): Promise<MediaAsset[]> {
  const sb = db();
  const out: MediaAsset[] = [];

  const { data: cvs } = await sb
    .from("color_visualizations")
    .select("id, color_name, design_file_name, vehicle_year, vehicle_make, vehicle_model, finish_type, mode_type, render_urls, is_featured_hero, created_at")
    .eq("generation_status", "completed")
    .not("render_urls", "is", null)
    .order("is_featured_hero", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  for (const r of cvs ?? []) {
    const urls = (r.render_urls || {}) as Record<string, unknown>;
    const key = HERO_VIEW_ORDER.find((k) => typeof urls[k] === "string") ||
      Object.keys(urls).find((k) => typeof urls[k] === "string");
    if (!key) continue;
    out.push({
      id: `render_${r.id}`,
      file_url: String(urls[key]),
      file_type: "image",
      asset_type: "tool_render",
      category: `${r.is_featured_hero ? "gallery-" : ""}${r.mode_type || "render"}`,
      name: [r.vehicle_year, r.vehicle_make, r.vehicle_model, r.color_name || r.design_file_name]
        .filter(Boolean).join(" ") || `Render ${String(r.id).slice(0, 8)}`,
      tags: [r.mode_type, r.finish_type].filter(Boolean).map(String),
      duration_seconds: null,
    });
  }

  const { data: gpj } = await sb
    .from("graphics_pro_jobs")
    .select("id, business_name, vehicle_year, vehicle_make, vehicle_model, mockup_render_url, created_at")
    .not("mockup_render_url", "is", null)
    .in("status", ["mockup_ready", "approved", "processing", "complete"])
    .order("created_at", { ascending: false })
    .limit(8);
  for (const j of gpj ?? []) {
    out.push({
      id: `graphicspro_${j.id}`,
      file_url: String(j.mockup_render_url),
      file_type: "image",
      asset_type: "tool_render",
      category: "graphicspro",
      name: [j.business_name, j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(" ") || `GraphicsPro ${String(j.id).slice(0, 8)}`,
      tags: ["graphicspro", "commercial"],
      duration_seconds: null,
    });
  }

  const { data: mkt } = await sb
    .from("marketplace_listings")
    .select("id, title, preview_image_url, hero_image_url, created_at")
    .eq("status", "listed")
    .order("created_at", { ascending: false })
    .limit(8);
  for (const m of mkt ?? []) {
    const url = m.preview_image_url || m.hero_image_url;
    if (!url) continue;
    out.push({
      id: `creatormarket_${m.id}`,
      file_url: String(url),
      file_type: "image",
      asset_type: "tool_render",
      category: "creatormarket",
      name: String(m.title || `CreatorMarket ${String(m.id).slice(0, 8)}`),
      tags: ["creatormarket", "design"],
      duration_seconds: null,
    });
  }

  return out;
}

async function nativeMediaList(type: "video" | "image" | "any", limit: number): Promise<MediaAsset[]> {
  const sb = db();
  let q = sb.from("agent_media_assets")
    .select("id, storage_url, asset_type, content_type, content_category, title, original_filename, tags, duration_seconds")
    .not("storage_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (type === "video") q = q.in("asset_type", ["video", "rendered_video"]);
  if (type === "image") q = q.eq("asset_type", "image");
  const { data, error } = await q;
  if (error) throw new Error(`agent_media_assets: ${error.message}`);
  const pool: MediaAsset[] = (data ?? []).map((a: Record<string, unknown>) => ({
    id: String(a.id),
    file_url: String(a.storage_url),
    file_type: String(a.asset_type || "").includes("video") ? "video" : "image",
    asset_type: String(a.asset_type || ""),
    // `content_type` IS the taxonomy (install · ugc · documentary · render …),
    // written by the one classifier in src/lib/assetContentType.ts.
    // `content_category` is a WRAP-PATTERN field ("modern_trippy",
    // "camo_carbon") and is null on 665 of 815 rows — reading it as the
    // category made every consumer's category test miss, including the
    // render exclusion in creative-plan. Prefer the taxonomy, keep the
    // pattern name as the fallback so nothing that matched before stops.
    category: String(a.content_type || a.content_category || ""),
    name: String(a.title || a.original_filename || a.id),
    tags: (a.tags as string[]) || [],
    duration_seconds: a.duration_seconds == null ? null : Number(a.duration_seconds),
  }));
  // ONE pool: past designs from every tool (Gallery stars first) ride
  // alongside the clip library, so agents pull work from the whole system.
  if (type !== "video") {
    try {
      pool.push(...await toolRenderList(Math.min(15, limit)));
    } catch (_) { /* additive — never block the pool */ }
  }
  return pool;
}

async function actionPlanSocial(body: Record<string, unknown>) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
  const brand = String(body.brand || "weprintwraps");
  const goal = String(body.goal || "").trim() || DEFAULT_GOALS[brand] || DEFAULT_GOALS.weprintwraps;
  const count = Math.min(Number(body.count) || 3, 6);

  const assets = await nativeMediaList("any", 30);
  if (!assets.length) return json({ error: "no usable media in the library — hydrate clips (drive-sync) or render in Video Studio first" }, 409);
  const mediaList = assets.map((a, i) =>
    `${i}. [${a.file_type}${a.duration_seconds ? ` ${Math.round(a.duration_seconds)}s` : ""}] ${a.name || a.id} ` +
    `${a.category ? `(${a.category})` : ""} tags: ${(a.tags || []).slice(0, 6).join(", ") || "none"}`).join("\n");

  const brandBlock = await loadBrandBlock(brandOsName(brand));
  const system =
    `You are the social content lead for this brand. You write finished, publish-ready ` +
    `organic Instagram/Facebook posts as strict JSON. Rules: hook in the first line, no invented ` +
    `statistics or prices, one CTA max, 3-8 relevant hashtags (no hashtag walls), video assets ` +
    `become reels, image assets become feed posts. Return ONLY the JSON object.\n\n${brandBlock}`;
  const user =
    `Goal: ${goal}\nToday: ${new Date().toISOString().slice(0, 10)}\n\n` +
    `Available REAL media assets (pick by index — never invent media):\n${mediaList}\n\n` +
    `Plan ${count} organic posts spread over the next 7 days (each on a different asset). Return JSON:\n` +
    `{"posts":[{"media_index":0,"platform":"instagram" (or "facebook" — pick exactly ONE per post),"post_type":"reel" or "feed",` +
    `"caption":"...","hashtags":["..."],"scheduled_date":"YYYY-MM-DDTHH:MM:00Z","rationale":"one sentence"}]}`;

  const res = await fetch(OPENAI_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: 0.6, response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(data).slice(0, 250)}`);
  const posts = JSON.parse(data.choices?.[0]?.message?.content ?? "{}").posts;
  if (!Array.isArray(posts) || !posts.length) throw new Error("OpenAI returned no posts");

  const sb = db();
  const created: Record<string, unknown>[] = [];
  for (const p of posts) {
    const asset = assets[Number(p.media_index)];
    if (!asset) continue;
    const postType = asset.file_type === "video" ? "reel" : (p.post_type === "reel" ? "feed" : p.post_type || "feed");
    const { data: row, error } = await sb.from("agent_social_posts").insert({
      brand, platform: p.platform === "facebook" ? "facebook" : "instagram",
      post_type: postType, caption: p.caption || "",
      hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
      media_urls: [asset.file_url],
      scheduled_date: p.scheduled_date || null,
      status: "draft", created_by: "marketing-agent",
    }).select("id").single();
    if (error) { created.push({ error: error.message }); continue; }

    await sb.from("slack_agent_tasks").insert({
      brand, task_type: "social_post", status: "pending", priority: "medium",
      title: `QC ${postType}: ${(p.caption || "").slice(0, 60)}`,
      description:
        `AI-planned organic post awaiting review. Approve/schedule it in Content Review ` +
        `and content-deploy publishes it automatically.\n\nPlatform: ${p.platform} (${postType})\n` +
        `Media: ${asset.name || asset.id} (${asset.file_type})\n${asset.file_url}\n` +
        `Scheduled: ${p.scheduled_date || "unset"}\nWhy: ${p.rationale}\n\n--- CAPTION ---\n${p.caption}\n\n` +
        `${(Array.isArray(p.hashtags) ? p.hashtags : []).join(" ")}`,
      created_by: "marketing-agent",
      metadata: { source: "marketing-agent", social_post_id: row.id, goal },
    });
    if (p.scheduled_date) {
      await sb.from("agent_content_calendar").insert({
        brand, content_type: "social_post", date: String(p.scheduled_date).slice(0, 10),
        title: `${postType}: ${(p.caption || "").slice(0, 50)}`, status: "needs_review",
        pipeline_table: "agent_social_posts", pipeline_id: row.id,
      });
    }
    created.push({ post_id: row.id, platform: p.platform, post_type: postType, media: asset.name || asset.id, scheduled: p.scheduled_date });
  }
  return json({ action: "plan_social", brand, goal, created });
}

// ── hooks (Hook Creator: topic → ranked scroll-stopping hooks, brand-voiced) ─
// GROUND HOOKS IN THE REAL FOOTAGE. When a shoot/source is given, mine its
// parsed transcript for the actual spoken lines and build hooks FROM the real
// quotes (verbatim soundbites first, then transcript text) instead of an
// abstract topic. This is the transcript → AI-hooks connection: the same words
// the shop said become scroll-stopping hooks, no invention.
type HookResult = { hooks: { text: string; style?: string; score?: number }[]; grounded: boolean; brand: string; topic: string; shoot: string | null; error?: string; status?: number };

async function generateHooks(body: Record<string, unknown>): Promise<HookResult> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const brand = String(body.brand || "weprintwraps");
  const topic = String(body.topic || "").trim();
  const count = Math.min(Number(body.count) || 10, 15);
  const fmt = String(body.format || "reel");
  const shootKey = String(body.shoot || "").trim().toLowerCase();
  const base: HookResult = { hooks: [], grounded: false, brand, topic, shoot: shootKey || null };
  if (!openaiKey) return { ...base, error: "OPENAI_API_KEY missing", status: 500 };
  const brandBlock = await loadBrandBlock(brandOsName(brand));

  let sourceMaterial = "";
  if (shootKey || body.source_id) {
    const sb = db();
    let sQ = sb.from("media_sources").select("id, filename, transcript").not("transcript", "is", null);
    if (body.source_id) sQ = sQ.eq("id", String(body.source_id)).limit(3);
    else sQ = sQ.or(`shoot.ilike.%${shootKey}%,filename.ilike.%${shootKey}%`).limit(40);
    const { data: srcs } = await sQ;
    const ids = (srcs || []).map((s) => s.id);
    let quotes: string[] = [];
    if (ids.length) {
      const { data: moments } = await sb.from("content_moments")
        .select("verbatim_quote, soundbite_score, hook_score")
        .in("source_id", ids).not("verbatim_quote", "is", null)
        .order("soundbite_score", { ascending: false }).limit(40);
      quotes = (moments || []).map((m) => String(m.verbatim_quote || "").trim()).filter((q) => q.length > 8);
    }
    // Fallback to raw transcript text if the vision/soundbite pass is thin.
    if (quotes.length < 5) {
      const blob = (srcs || []).map((s) => String(s.transcript || "")).join(" ").replace(/\s+/g, " ").trim();
      if (blob) quotes = [blob.slice(0, 4000)];
    }
    if (quotes.length) sourceMaterial = quotes.slice(0, 40).map((q, i) => `${i + 1}. ${q}`).join("\n");
  }
  if (!topic && !sourceMaterial) return { ...base, error: "topic or shoot required (a shoot mines its transcript for real hooks)", status: 400 };

  const userMsg = sourceMaterial
    ? `Build hooks FROM this real footage — the actual lines the shop said. Pull the most magnetic ` +
      `moments; you may tighten wording but never invent facts, names, or numbers.\n\n` +
      `${topic ? `Angle: ${topic}\n` : ""}Format: ${fmt}\n\nTRANSCRIPT / SOUNDBITES:\n${sourceMaterial}\n\n` +
      `Write ${count} hooks spread across styles (question, bold claim, pattern interrupt, curiosity gap, ` +
      `direct callout). Score each 1-100. Return {"hooks":[{"text":"...","style":"...","score":95}]} best first.`
    : `Topic: ${topic}\nFormat: ${fmt}\n\nWrite ${count} hooks spread across styles ` +
      `(question, bold claim, pattern interrupt, curiosity gap, direct callout). ` +
      `Score each 1-100 for scroll-stopping power. ` +
      `Return {"hooks":[{"text":"...","style":"...","score":95}]} sorted best first.`;

  const res = await fetch(OPENAI_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: 0.8, response_format: { type: "json_object" },
      messages: [
        { role: "system", content:
          `You write scroll-stopping short-video HOOKS — the first 1-2 seconds of spoken or overlay text. ` +
          `Rules: under 12 words each, concrete, curiosity or stakes up front, no hashtags, ` +
          `no invented statistics or prices. Return ONLY the JSON object.\n\n${brandBlock}` },
        { role: "user", content: userMsg },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) return { ...base, error: `hook generation ${res.status}: ${JSON.stringify(data).slice(0, 200)}`, status: 502 };
  let out: { hooks?: { text: string; style?: string; score?: number }[] };
  try { out = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
  catch { return { ...base, error: "hook generation returned invalid JSON", status: 502 }; }
  return { ...base, grounded: !!sourceMaterial, hooks: Array.isArray(out.hooks) ? out.hooks : [] };
}

async function actionHooks(body: Record<string, unknown>) {
  const r = await generateHooks(body);
  if (r.error) return json({ error: r.error }, r.status || 500);
  return json({ action: "hooks", brand: r.brand, topic: r.topic, shoot: r.shoot, grounded: r.grounded, hooks: r.hooks });
}

// ── hooks_to_drafts — shoot → grounded hooks → draft posts in the queue ─────
// One click: mine the shoot's transcript for hooks, then land the top hooks as
// DRAFT agent_social_posts (per brand) so they flow through the Director queue
// like everything else — approve → content-deploy publishes. If a finished
// render for the shoot exists, it rides along as the post media.
async function actionHooksToDrafts(body: Record<string, unknown>) {
  const sb = db();
  const shootKey = String(body.shoot || "").trim().toLowerCase();
  if (!shootKey && !body.source_id) return json({ error: "shoot (or source_id) required" }, 400);
  const brands: string[] = Array.isArray(body.brands) && body.brands.length
    ? (body.brands as unknown[]).map((b) => String(b))
    : [String(body.brand || "wraptvworld")];
  const perBrand = Math.min(Number(body.per_brand) || 4, 8);
  const fmt = String(body.format || "reel");

  // Optional: attach a finished render for this shoot as the post media.
  let mediaUrl: string | null = null;
  const { data: render } = await sb.from("video_render_jobs")
    .select("final_url, blueprint, created_at").eq("status", "complete")
    .order("created_at", { ascending: false }).limit(20);
  const hit = (render || []).find((r) => String(r.blueprint?.title || "").toLowerCase().includes(shootKey)
    || String(r.blueprint?.source || "").toLowerCase().includes(shootKey));
  if (hit?.final_url) mediaUrl = String(hit.final_url);

  const results: Record<string, unknown>[] = [];
  for (const brand of brands) {
    const r = await generateHooks({ ...body, brand, count: Math.max(perBrand + 2, 6) });
    if (r.error) { results.push({ brand, error: r.error }); continue; }
    const top = (r.hooks || []).slice(0, perBrand);
    let made = 0;
    for (const h of top) {
      const caption = String(h.text || "").trim();
      if (!caption) continue;
      const { data: row, error } = await sb.from("agent_social_posts").insert({
        brand, platform: "instagram",
        post_type: mediaUrl ? "reel" : "feed", caption,
        hashtags: [], media_urls: mediaUrl ? [mediaUrl] : [],
        scheduled_date: null, status: "draft", created_by: "marketing-agent",
      }).select("id").single();
      if (error) { results.push({ brand, error: error.message }); continue; }
      await sb.from("slack_agent_tasks").insert({
        brand, task_type: "social_post", status: "pending", priority: "medium",
        title: `QC hook (${brand}): ${caption.slice(0, 54)}`,
        description:
          `AI hook grounded in the ${shootKey || "shoot"} transcript, ready for review. ` +
          `Approve/schedule in Content Review and content-deploy publishes it.\n\n` +
          `Style: ${h.style || "hook"} · Score: ${h.score ?? "-"}\n` +
          `${mediaUrl ? `Media: ${mediaUrl}\n` : "Media: none yet (attach a clip on approval)\n"}\n--- HOOK ---\n${caption}`,
        created_by: "marketing-agent",
        metadata: { source: "hooks_to_drafts", social_post_id: row.id, shoot: shootKey, grounded: r.grounded },
      });
      made++;
    }
    results.push({ brand, drafts: made, grounded: r.grounded });
  }
  const total = results.reduce((n, r) => n + (Number(r.drafts) || 0), 0);
  return json({ action: "hooks_to_drafts", shoot: shootKey || null, media_attached: !!mediaUrl, total_drafts: total, per_brand: results });
}

// ── revise_copy — chat-with-AI caption fixer for the review queue ───────────
// The reviewer types a plain instruction ("punchier", "add a CTA", "shorten,
// drop the emoji") and the agent rewrites the caption in the brand voice —
// keeping it real (no invented facts/numbers). Returns {caption, hashtags}.
async function actionReviseCopy(body: Record<string, unknown>) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
  const brand = String(body.brand || "weprintwraps");
  const caption = String(body.caption || "").trim();
  const instruction = String(body.instruction || "").trim();
  if (!instruction) return json({ error: "instruction required" }, 400);
  const brandBlock = await loadBrandBlock(brandOsName(brand));
  const res = await fetch(OPENAI_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: 0.7, response_format: { type: "json_object" },
      messages: [
        { role: "system", content:
          `You are a social copy editor. Revise the caption per the reviewer's instruction, ` +
          `in the brand's voice. Never invent facts, names, numbers, or prices. Keep hashtags ` +
          `relevant and few. Return ONLY a JSON object of the form {"caption":"...","hashtags":["..."]}\n\n${brandBlock}` },
        { role: "user", content:
          `CURRENT CAPTION:\n${caption || "(empty)"}\n\nINSTRUCTION: ${instruction}\n\n` +
          `Return the revised {"caption","hashtags"}.` },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: `revise ${res.status}: ${JSON.stringify(data).slice(0, 200)}` }, 502);
  let out: { caption?: string; hashtags?: unknown[] };
  try { out = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
  catch { return json({ error: "revise returned invalid JSON" }, 502); }
  return json({ action: "revise_copy", brand, caption: String(out.caption || caption), hashtags: Array.isArray(out.hashtags) ? out.hashtags.map(String) : [] });
}

// ── import_products — pull WePrintWraps product images into the content library ──
// Fetches WooCommerce product pages (browser UA, server-side) and imports every
// product/swatch image into agent_media_assets, AUTO-CATEGORIZED by product. The
// pages name each swatch in the filename (…Swatches-02-Gray-Marble.jpg), so each
// row gets title "<Collection> — <Pattern>", content_category = the collection
// key, and tags [weprintwraps, wbty, <key>, product, <pattern>]. Idempotent.
const WPW_IMPORT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const WPW_DEFAULT_PRODUCTS = [
  { url: "https://weprintwraps.com/our-products/wrap-by-the-yard-camo-carbon/", category: "camo_carbon", collection: "Camo & Carbon" },
  { url: "https://weprintwraps.com/our-products/wrap-by-the-yard-metal-marble/", category: "metal_marble", collection: "Metal & Marble" },
  { url: "https://weprintwraps.com/our-products/wrap-by-the-yard-wicked-and-wild-wrap-prints-60/", category: "wicked_wild", collection: "Wicked & Wild" },
  { url: "https://weprintwraps.com/our-products/wrap-by-the-yard-bape-camo/", category: "bape_camo", collection: "Bape Camo" },
  { url: "https://weprintwraps.com/our-products/wrap-by-the-yard-modern-and-trippy/", category: "modern_trippy", collection: "Modern & Trippy" },
];
const WPW_DENY = /(logo-wpw|cropped-|brands|shutterstock|favicon|placeholder|icon-|sprite)/i;
function wpwFullSize(u: string) { return u.replace(/-\d+x\d+(\.\w+)(?:$|\?)/i, "$1"); }
function wpwNameFromFile(file: string): string {
  const base = file.replace(/\.\w+$/, "");
  const sw = base.match(/[Ss]watches?-\d+-(.+)$/);
  if (sw) return sw[1].replace(/-/g, " ").replace(/\s+/g, " ").trim();
  return base.replace(/-\d+x\d+$/, "").replace(/-/g, " ").replace(/\b(SQ|scaled|pdf|cover|square)\b/gi, "").replace(/\s+/g, " ").trim();
}
async function actionImportProducts(body: Record<string, unknown>) {
  const sb = db();

  // Direct-insert path: caller provides an explicit list of images (scraped
  // where the fetch is reliable). Each: {url, title, category, collection?,
  // tags?}. Idempotent by storage_url.
  if (Array.isArray(body.images) && body.images.length) {
    const imgs = body.images as { url: string; title: string; category: string; collection?: string; tags?: string[]; swatch?: string }[];
    const urls = imgs.map((i) => i.url);
    const { data: existing } = await sb.from("agent_media_assets").select("storage_url").in("storage_url", urls);
    const have = new Set((existing || []).map((e: { storage_url: string }) => e.storage_url));
    const rows = imgs.filter((i) => i.url && !have.has(i.url)).map((i) => ({
      storage_url: i.url,
      // The CALLER supplies these URLs, so "image" cannot be assumed — one
      // resolver, the same one every uploader in the app calls.
      asset_type: resolveAssetType({ filename: i.url.split("/").pop(), url: i.url }).assetType,
      content_category: i.category,
      title: i.title, original_filename: i.url.split("/").pop() || "",
      tags: i.tags && i.tags.length ? i.tags : ["weprintwraps", "wbty", i.category, "product", ...(i.swatch ? [i.swatch.toLowerCase()] : [])],
      source_folder: `wpw-products/${i.category}`,
    }));
    if (!rows.length) return json({ action: "import_products", total_imported: 0, skipped_existing: imgs.length });
    const { error } = await sb.from("agent_media_assets").insert(rows);
    if (error) return json({ error: error.message }, 500);
    return json({ action: "import_products", total_imported: rows.length, mode: "direct" });
  }

  const products = (Array.isArray(body.products) && body.products.length ? body.products : WPW_DEFAULT_PRODUCTS) as { url: string; category: string; collection: string }[];
  const results: Record<string, unknown>[] = [];
  for (const p of products) {
    try {
      const res = await fetch(p.url, { headers: { "User-Agent": WPW_IMPORT_UA, Accept: "text/html" } });
      if (!res.ok) { results.push({ url: p.url, error: `fetch ${res.status}`, imported: 0 }); continue; }
      const html = await res.text();
      // Match BOTH absolute (gallery) and relative (per-swatch data-image="…")
      // /wp-content/uploads paths — the swatch thumbnails are relative.
      const re = /(?:https:\/\/weprintwraps\.com)?\/wp-content\/uploads\/[^"'\s)\\]+\.(?:jpg|jpeg|png|webp)/gi;
      const seen = new Set<string>();
      const items: { url: string; file: string; name: string; isSwatch: boolean }[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(html))) {
        const url = wpwFullSize(m[0].startsWith("/") ? `https://weprintwraps.com${m[0]}` : m[0]);
        const file = url.split("/").pop() || "";
        if (WPW_DENY.test(file) || seen.has(url)) continue;
        seen.add(url);
        const isSwatch = /[Ss]watches?-\d+-/.test(file);
        if (!(isSwatch || /cover|square|product-image|How-Many-Yards/i.test(file))) continue;
        items.push({ url, file, name: wpwNameFromFile(file), isSwatch });
      }
      if (!items.length) { results.push({ url: p.url, error: "no product images found", imported: 0 }); continue; }
      const { data: existing } = await sb.from("agent_media_assets").select("storage_url").in("storage_url", items.map((i) => i.url));
      const have = new Set((existing || []).map((e: { storage_url: string }) => e.storage_url));
      const rows = items.filter((i) => !have.has(i.url)).map((i) => ({
        storage_url: i.url,
        asset_type: resolveAssetType({ filename: i.file, url: i.url }).assetType,
        content_category: p.category,
        title: i.isSwatch ? `${p.collection} — ${i.name}` : `${p.collection} (${i.name || "cover"})`,
        original_filename: i.file,
        tags: ["weprintwraps", "wbty", p.category, "product", ...(i.isSwatch ? [i.name.toLowerCase()] : [])],
        source_folder: `wpw-products/${p.category}`,
      }));
      if (!rows.length) { results.push({ url: p.url, collection: p.collection, imported: 0, skipped_existing: items.length }); continue; }
      const { error } = await sb.from("agent_media_assets").insert(rows);
      if (error) { results.push({ url: p.url, error: error.message, imported: 0 }); continue; }
      results.push({ collection: p.collection, category: p.category, imported: rows.length, found: items.length, swatches: rows.filter((r) => r.isSwatch !== undefined && r.tags.length > 4).length });
    } catch (e) { results.push({ url: p.url, error: String((e as Error)?.message || e), imported: 0 }); }
  }
  const total = results.reduce((n, r) => n + (Number(r.imported) || 0), 0);
  return json({ action: "import_products", total_imported: total, results });
}

// ── import_products_woo — named swatches via the WooCommerce REST API ───────
// The reliable path: hit /products/{id}/variations (same Woo creds MightyMail
// uses) — each variation carries its REAL swatch name in `attributes` and its
// image in `image.src`. Inserts into the content library (agent_media_assets)
// named + categorized. Works for every collection, incl. the ones whose files
// are numbered on the site.
const WBTY_WOO: Record<string, { id: number; collection: string }> = {
  camo_carbon: { id: 1726, collection: "Camo & Carbon" },
  metal_marble: { id: 39698, collection: "Metal & Marble" },
  wicked_wild: { id: 4181, collection: "Wicked & Wild" },
  bape_camo: { id: 42809, collection: "Bape Camo" },
  modern_trippy: { id: 52489, collection: "Modern & Trippy" },
};
async function actionImportProductsWoo(body: Record<string, unknown>) {
  const base = (Deno.env.get("WOOCOMMERCE_URL") || "https://weprintwraps.com").replace(/\/$/, "");
  const ck = Deno.env.get("WOOCOMMERCE_CONSUMER_KEY");
  const cs = Deno.env.get("WOOCOMMERCE_CONSUMER_SECRET");
  if (!ck || !cs) return json({ error: "WooCommerce credentials not configured (WOOCOMMERCE_URL/KEY/SECRET)" }, 500);
  const auth = "Basic " + btoa(`${ck}:${cs}`);
  const sb = db();
  const cats = (Array.isArray(body.categories) && body.categories.length ? body.categories : Object.keys(WBTY_WOO)) as string[];
  const results: Record<string, unknown>[] = [];
  let grand = 0;
  for (const cat of cats) {
    const meta = WBTY_WOO[cat];
    if (!meta) { results.push({ category: cat, error: "unknown category" }); continue; }
    try {
      const variations: Record<string, unknown>[] = [];
      for (let page = 1; page <= 10; page++) {
        const r = await fetch(`${base}/wp-json/wc/v3/products/${meta.id}/variations?per_page=100&page=${page}`, { headers: { Authorization: auth } });
        if (!r.ok) { if (page === 1) results.push({ category: cat, error: `woo ${r.status}` }); break; }
        const arr = await r.json();
        if (!Array.isArray(arr) || !arr.length) break;
        variations.push(...arr);
        if (arr.length < 100) break;
      }
      const built = variations.map((v) => {
        const img = (v.image as { src?: string } | undefined)?.src;
        const attrs = (v.attributes as { option?: string }[] | undefined) || [];
        const name = attrs.map((a) => a.option).filter(Boolean).join(" ").trim();
        return img ? { url: String(img).replace(/-\d+x\d+(\.\w+)$/i, "$1"), name: name || `Swatch ${v.id}` } : null;
      }).filter(Boolean) as { url: string; name: string }[];
      if (!built.length) { results.push({ category: cat, collection: meta.collection, imported: 0, variations: variations.length }); continue; }
      const { data: existing } = await sb.from("agent_media_assets").select("storage_url").in("storage_url", built.map((b) => b.url));
      const have = new Set((existing || []).map((e: { storage_url: string }) => e.storage_url));
      const rows = built.filter((b) => !have.has(b.url)).map((b) => ({
        storage_url: b.url,
        asset_type: resolveAssetType({ filename: b.url.split("/").pop(), url: b.url }).assetType,
        content_category: cat,
        title: `${meta.collection} — ${b.name}`, original_filename: b.url.split("/").pop() || "",
        tags: ["weprintwraps", "wbty", cat, "product", b.name.toLowerCase()],
        source_folder: `wpw-products/${cat}`,
      }));
      if (rows.length) {
        const { error } = await sb.from("agent_media_assets").insert(rows);
        if (error) { results.push({ category: cat, error: error.message }); continue; }
      }
      grand += rows.length;
      results.push({ category: cat, collection: meta.collection, imported: rows.length, variations: variations.length, skipped_existing: built.length - rows.length });
    } catch (e) { results.push({ category: cat, error: String((e as Error)?.message || e) }); }
  }
  return json({ action: "import_products_woo", total_imported: grand, results });
}

// ── ad_pack (paid Meta ads: complete ready-to-load ad package into the Hub) ──
// The full paid-ads copy set (headlines, primary texts, CTAs) is generated
// natively here with OpenAI. We pair it with a real media asset and drop the
// whole package on a Hub card — the team loads it into Ads Manager.
// (Programmatic Ads Manager placement needs a Meta Marketing API token, which
// isn't configured anywhere yet — this gets ads OUT today, human-loaded.)
//
// ── THE HOOK ENGINE NOW RUNS HERE (2026-08-07) ──────────────────────────────
// `_shared/idea-hook.ts` gave every ORGANIC surface its own opening move and
// its own claim-free close, and had exactly one caller: `actionIdeaApprove`.
// This action never touched it. Measured on the seven packs generated
// 2026-08-07 21:23–21:24Z, all at placement "feed":
//
//     7 packs · 4 brands · 1 creative (every card carries the same .mp4)
//     "Unveil the Wrap Magic" / "Behind the Wrap Magic" / "Watch the Wrap Magic"
//
// Four changes, and each one is a wire into machinery that already existed:
//   1. PLACEMENT → doctrine surface. `_shared/ad-hook.ts` maps feed/story/reels
//      onto the channel each one actually is, and the move/edge/closer come
//      from `idea-hook.ts` — imported, never restated. A feed ad and a story ad
//      no longer open the same way.
//   2. BRAND FACTS. `content-doctrine.BRAND_FACTS` (mirroring
//      `contentDoctrine.BRANDS`) puts audience / interests / givesAway / voice
//      into the prompt. A brand with none gets an explicit "no audience
//      profile" line — thinner copy, never an invented reader.
//   3. GROUNDING. Every written string is checked back against the declared
//      corpus by `adClaimViolations` and DROPPED if it invents a figure, a
//      quotation, a guarantee or a turnaround. Recorded on the card, not
//      swallowed.
//   4. CREATIVE VARIETY. Candidates are ranked by the best moment score cut
//      from that clip and the ones already sitting on a pending pack are
//      skipped, so two packs cannot silently share a video.
//
// Plus a PRE-SPEND FENCE (`adPackKey`), checked before the model call and keyed
// with no clock — same shape as `already_scored` / `already_designed` /
// `cutSourceRef`.
/**
 * The best customer lines this brand has NOT already put in an ad.
 *
 * `topCustomerQuotes` is a ranking, and a ranking handed to every pack returns
 * the same winners every time. Measured on the six WePrintWraps packs of
 * 2026-08-13: "Pressure Builds Diamonds" led FOUR of them, off the same three
 * or four quotes. Opening two cards in a row looked like one ad photocopied,
 * which is the opposite of the point — the library holds 2,811 scored quotes.
 *
 * So the pool is read wide and the lines already spent are removed. Spent is
 * read off the packs themselves (`ad_copy`), not a separate ledger, because a
 * ledger and the board would disagree the first time a pack was archived.
 *
 * A STATE query with no clock, like `claimedAdCreatives`: the answer does not
 * change because an hour passed, so a retry behaves like the first call. When
 * everything is spent it returns the top of the ranking rather than nothing —
 * a repeat is worse copy, an empty corpus is an ad with no evidence in it, and
 * the second is the bigger failure.
 */
async function freshCustomerQuotes(
  sb: ReturnType<typeof db>,
  brand: string,
  want: number,
): Promise<string[]> {
  const pool = await topCustomerQuotes(sb, Math.max(want * 5, 40)).catch(() => [] as string[]);
  if (!pool.length) return pool;

  const { data } = await sb.from("slack_agent_tasks")
    .select("metadata")
    .eq("task_type", "ad_campaign")
    .eq("brand", brand)
    .order("created_at", { ascending: false })
    .limit(40);

  const spent = ((data ?? []) as Array<{ metadata: Record<string, unknown> | null }>)
    .map((r) => JSON.stringify((r.metadata as any)?.ad_copy ?? "").toLowerCase())
    .join(" ");

  // A quote counts as spent when a distinctive run of it already appears in a
  // pack. Comparing whole strings would miss it — the writer trims and
  // re-punctuates the line it quotes.
  const fingerprint = (q: string) =>
    q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");

  const fresh = pool.filter((q) => {
    const fp = fingerprint(q);
    return fp.length >= 12 ? !spent.includes(fp) : true;
  });

  return (fresh.length >= Math.min(3, want) ? fresh : pool).slice(0, want);
}

async function actionAdPack(body: Record<string, unknown>) {
  const sb = db();
  const brand = String(body.brand || "weprintwraps");
  const goal = String(body.goal || "").trim() || DEFAULT_GOALS[brand] || DEFAULT_GOALS.weprintwraps;
  // REAL CUSTOMER LINES, before the brief is built. Owner, on the one ad of
  // ten that works: "the one thats OK is one built from real customer quote."
  // Fetched here because `ad-hook.ts` is pure — the caller does the I/O.
  const customerQuotes = await freshCustomerQuotes(sb, brand, 10).catch(() => [] as string[]);
  const brief = adHookBrief(body.placement ?? "feed", brand, customerQuotes);
  const packKey = adPackKey(brand, brief.placement, goal);

  // ── PRE-SPEND FENCE — BEFORE the model call, never after ──────────────────
  // Same discipline as the vision_score `already_scored` guard and the
  // approve-time cut fence: the key is the identity of the WORK (brand,
  // placement, goal) with NO CLOCK in it, so a retry, a repeated hourly sweep
  // or a second operator finds the answer that was already paid for.
  //
  // Measured on the 7 packs of 2026-08-07: 4 distinct keys, 7 model calls —
  // 3 of the 7 were re-buying copy already on the board.
  if (body.force !== true) {
    const { data: bought } = await sb.from("slack_agent_tasks")
      .select("id, created_at, metadata")
      .eq("task_type", "ad_campaign")
      .in("status", ["pending", "in_progress"])
      .eq("metadata->>ad_pack_key", packKey)
      .limit(1).maybeSingle();
    if (bought) {
      return json({
        action: "ad_pack", brand, placement: brief.placement,
        hub_card_id: bought.id,
        creative: (bought.metadata as Record<string, unknown> | null)?.media_url ?? null,
        skipped: "already_packed",
        note: `An ad pack for ${brand} · ${brief.placement} · this goal is already on the board awaiting QC. ` +
          `Not re-buying the copy. Send { force: true } to write a second one deliberately.`,
      });
    }
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);

  // ── THE CREATIVE — ranked, and never one already on a pending pack ────────
  const mediaType = String(body.media_type || "video") as "video" | "image";
  // 60, not the old 5: the pick is a RANKING now, and a pool of five newest
  // clips cannot rank. 504 video assets exist, 333 of them with scored moments.
  const pool = await nativeMediaList(mediaType, 60);
  if (!pool.length) return json({ error: "no usable media in the library — hydrate clips (drive-sync) or render in Video Studio first" }, 409);
  const choice = pickAdCreative(await scoreAdCreatives(pool), await claimedAdCreatives());
  const asset = choice.pick;
  if (!asset) return json({ error: "no usable media in the library — hydrate clips (drive-sync) or render in Video Studio first" }, 409);

  // ── THE CORPUS the copy is allowed to claim from ──────────────────────────
  // The DB brand block (the operator-edited brand truth), the doctrine's
  // declared facts, the goal, and the creative's own name/tags. Nothing else is
  // a fact about this brand, so nothing else may be stated as one.
  const adBrandBlock = await loadBrandBlock(brandOsName(brand));
  const corpus = [
    adBrandBlock,
    brief.facts ? [brief.facts.audience, brief.facts.interests.join(" "), brief.facts.givesAway, brief.facts.voice].join("\n") : "",
    // The declared claims and the real quotes join the corpus, which is what
    // LICENSES them: `adClaimViolations` permits a figure or a quotation the
    // corpus contains and refuses one it does not. Without this the guard
    // would drop "10+ years" and every customer line as an invention.
    brief.facts?.claims?.length ? brief.facts.claims.join("\n") : "",
    brief.quotes.join("\n"),
    goal,
    asset.name,
    (asset.tags || []).join(" "),
  ].filter(Boolean).join("\n\n");

  const adRes = await fetch(OPENAI_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: 0.6, response_format: { type: "json_object" },
      messages: [
        { role: "system", content:
          `You write complete Meta (Facebook/Instagram) paid-ad copy packages as strict JSON.\n\n` +
          `THE ONLY FACTS YOU MAY STATE ARE THE ONES IN THE BRAND BLOCK BELOW. You may phrase, ` +
          `compress and angle them. You may NOT introduce a number, a percentage, a price, a ` +
          `guarantee, a turnaround time, a customer count, a named customer or a quotation that ` +
          `the brand block does not contain. If the brand block does not support a strong specific ` +
          `claim, write a shorter honest line instead — thin true copy is a correct answer here and ` +
          `a confident invented one is not.\n\n` +
          `QUOTATION MARKS: only around a line the brand block or the REAL CUSTOMER LINES ` +
          `contain word for word. A quoted line in an ad reads as somebody's testimony, and a ` +
          `quoted line that nobody said is a fabricated customer. A real customer line quoted ` +
          `EXACTLY is the strongest thing you have — a reworded one with the quotation marks ` +
          `left on is the fabrication again in better clothes.\n\n` +
          `Return ONLY the JSON object.\n\n${adBrandBlock}` },
        { role: "user", content:
          `Goal: ${goal}\nCreative: ${asset.file_type} — ${asset.name}\n\n${brief.text}\n\n` +
          `Every headline and every primary text must open with the HOOK MOVE above. ` +
          `Do not write the same opening twice.\n\n` +
          `Return JSON: {"headlines":["5 options, <=40 chars each"],"primary_texts":["3 options, hook first line"],` +
          `"descriptions":["2 options, <=30 chars"],"ctas":["2 Meta CTA button choices e.g. Learn More / Shop Now"],` +
          `"targeting_notes":"one sentence"}` },
      ],
    }),
  });
  const adData = await adRes.json();
  if (!adRes.ok) return json({ error: `ad copy generation ${adRes.status}: ${JSON.stringify(adData).slice(0, 200)}` }, 502);
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(adData.choices?.[0]?.message?.content || "{}"); }
  catch { return json({ error: "ad copy generation returned invalid JSON" }, 502); }

  // ── THE GROUNDING CHECK — the only moment fabrication is observable ───────
  // A violating string is DROPPED, not the whole pack: the clean lines are
  // still loadable, and the drops go on the card so the human QC'ing it sees
  // what the model tried to claim. A field that empties is an honest gap.
  const dropped: Array<{ field: string; text: string; why: string }> = [];
  const screen = (field: string, v: unknown) => {
    const r = screenAdStrings(v, corpus);
    for (const d of r.dropped) dropped.push({ field, ...d });
    return r.kept;
  };

  const headlines = screen("headlines", raw.headlines);
  const descriptions = screen("descriptions", raw.descriptions);
  const targeting = screen("targeting_notes", raw.targeting_notes);
  // The CLOSER is appended by CODE, exactly as `idea-hook.hookForSurface` does
  // it — it asserts nothing about the subject, so it is the one line that can
  // carry the brand's register with zero risk of invention.
  const primaryTexts = screen("primary_texts", raw.primary_texts).map((t) => withCloser(t, brief.closer));
  const ctas = Array.isArray(raw.ctas) ? raw.ctas.map((c) => String(c || "").trim()).filter(Boolean) : [];

  const adCopy = {
    headlines, primary_texts: primaryTexts, descriptions, ctas,
    targeting_notes: targeting[0] || null,
  };

  const gaps: string[] = [];
  if (!headlines.length) gaps.push("every headline invented a claim the brand has not declared — none survived the grounding check");
  if (!primaryTexts.length) gaps.push("every primary text invented a claim the brand has not declared — none survived the grounding check");
  if (!brief.facts) gaps.push(`no declared audience profile for "${brand}" — the copy could not be aimed, so it is deliberately thin. Add the brand to BRAND_FACTS.`);
  if (!brief.placementKnown) gaps.push(`placement "${String(body.placement ?? "")}" is not a surface this doctrine describes — framed as a feed ad`);
  if (choice.note) gaps.push(choice.note);

  const description =
    `Complete Meta ad package — QC then load into Ads Manager.\n\n` +
    `Placement: ${brief.placement} → ${brief.channel} · hook move "${brief.move}" (edge ${brief.edge})\n` +
    `${brief.why}\n\n` +
    `Creative: ${asset.name || asset.id} (${asset.file_type}) — ranked #${choice.rank} of ${choice.pool}` +
    `${asset.score > 0 ? `, best moment score ${asset.score}` : ""}${choice.reused ? " · REPEATED" : ""}\n${asset.file_url}\n\n` +
    (gaps.length ? `--- HONEST GAPS ---\n${gaps.map((g) => `• ${g}`).join("\n")}\n\n` : "") +
    (dropped.length
      ? `--- DROPPED AS UNGROUNDED (${dropped.length}) ---\n` +
        dropped.map((d) => `• [${d.field}] "${d.text}" — ${d.why}`).join("\n").slice(0, 1200) + `\n\n`
      : "") +
    `--- AD COPY ---\n${JSON.stringify(adCopy, null, 2).slice(0, 3500)}`;

  const { data: card, error } = await sb.from("slack_agent_tasks").insert({
    brand, task_type: "ad_campaign", status: "pending", priority: "high",
    title: `Ads Launch Pack (${brief.placement}): ${goal.slice(0, 50)}`,
    description,
    created_by: "marketing-agent",
    metadata: {
      source: "marketing-agent", goal, media_url: asset.file_url, ad_copy: adCopy,
      ad_pack_key: packKey,
      placement: brief.placement, placement_known: brief.placementKnown,
      hook_channel: brief.channel, hook_move: brief.move, hook_edge: brief.edge,
      closer: brief.closer || null,
      brand_facts: brief.facts ? brief.facts.label : null,
      creative_rank: choice.rank, creative_pool: choice.pool,
      creative_score: asset.score, creative_reused: choice.reused,
      dropped_claims: dropped, gaps,
    },
  }).select("id").single();
  if (error) return json({ error: error.message }, 500);
  return json({
    action: "ad_pack", brand, hub_card_id: card.id, creative: asset.file_url,
    placement: brief.placement, hook_channel: brief.channel, hook_move: brief.move, hook_edge: brief.edge,
    creative_rank: choice.rank, creative_pool: choice.pool, creative_reused: choice.reused,
    dropped_claims: dropped.length, gaps,
  });
}

/**
 * Creatives already sitting on an ad pack that is still awaiting QC.
 *
 * A STATE query, not a time window: "is this clip already spoken for" has an
 * answer that does not change because an hour passed, so a retry behaves the
 * same way the first call did. Once the team QCs a pack the creative is free
 * again, which is the correct moment for it to become reusable.
 */
async function claimedAdCreatives(): Promise<string[]> {
  const { data } = await db().from("slack_agent_tasks")
    .select("metadata")
    .eq("task_type", "ad_campaign")
    .in("status", ["pending", "in_progress"])
    .limit(200);
  return (data ?? [])
    .map((r) => String((r.metadata as Record<string, unknown> | null)?.media_url || "").trim())
    .filter(Boolean);
}

/**
 * Score each candidate creative by the strongest MOMENT ever cut from it.
 *
 * `content_moments` already carries `hook_score` and `broll_score` per clip —
 * 9,678 moments across 333 of the video assets in production. The ad path never
 * read them, so "which clip should carry this ad" was answered by
 * `created_at DESC` and `[0]`. Joined through `media_sources.storage_url`,
 * which is what `agent_media_assets` and the parser share.
 *
 * An asset with no moments scores 0 and still ranks — an unscored clip is worse
 * evidence than a scored one, not an unusable one.
 */
async function scoreAdCreatives(pool: MediaAsset[]): Promise<AdCreativeCandidate[]> {
  const base: AdCreativeCandidate[] = pool.map((a) => ({
    id: a.id, file_url: a.file_url, file_type: a.file_type, name: a.name || a.id,
    tags: a.tags || [], score: 0, moments: 0,
  }));
  const urls = [...new Set(base.map((c) => c.file_url).filter(Boolean))];
  if (!urls.length) return base;

  try {
    const sb = db();
    const { data: sources } = await sb.from("media_sources")
      .select("id, storage_url").in("storage_url", urls);
    if (!sources?.length) return base;

    const urlBySource = new Map(sources.map((s) => [String(s.id), String(s.storage_url)]));
    const { data: moments } = await sb.from("content_moments")
      .select("source_id, hook_score, broll_score")
      .in("source_id", [...urlBySource.keys()])
      .limit(5000);

    const best = new Map<string, { score: number; moments: number }>();
    for (const m of moments ?? []) {
      const url = urlBySource.get(String(m.source_id));
      if (!url) continue;
      const s = Math.max(Number(m.hook_score ?? 0) || 0, Number(m.broll_score ?? 0) || 0);
      const cur = best.get(url) || { score: 0, moments: 0 };
      best.set(url, { score: Math.max(cur.score, s), moments: cur.moments + 1 });
    }
    for (const c of base) {
      const b = best.get(c.file_url);
      if (b) { c.score = b.score; c.moments = b.moments; }
    }
  } catch (_) {
    // Ranking is an IMPROVEMENT on library order, never a precondition for
    // shipping an ad. A failed join leaves every score at 0 and the pick falls
    // back to a stable url ordering — still distinct per pack, which is the
    // part that actually mattered.
  }
  return base;
}

// ── ads_audit (paid Meta ads: REMOVE/REPLACE verdicts → assigned Hub tasks) ──
// Pulls live campaign performance through meta-ads-report — which resolves the
// ad account for THIS brand via META_ADS_ACCOUNT_MAP (brand slug -> ad account
// id, one system-user token across the Business Manager), falling back to the
// shop's OAuth connection and then the single-account env secrets — applies deterministic
// remove/replace rules, and drops the verdicts on the Hub as tasks:
//   1. ONE removal card assigned to the human (default "trish" — the owner;
//      was "jackson" until the media buyer left, and an unread board is the
//      same as no audit at all) listing the
//      specific campaigns to pause in Ads Manager, each with its numbers and
//      the reason. Nothing is ever paused programmatically — human-executed.
//   2. One replacement-brief card per REPLACE verdict (capped) describing what
//      the content AI should make next (metadata.suggested_action:"ad_pack",
//      metadata.content_ai:true) so the ad_pack / ContentDirector flow can
//      produce the new creative and the old ad is only killed with a
//      replacement in flight.
// dry_run:true returns the verdicts without creating any cards.
async function actionAdsAudit(body: Record<string, unknown>) {
  const brand = String(body.brand || "weprintwraps");
  const assignTo = String(body.assign_to || "trish");
  const datePreset = String(body.date_preset || "last_30d");
  const dryRun = body.dry_run === true;
  // Marketing thresholds — overridable per call, sane paid-social defaults.
  const minSpend = Number(body.min_spend ?? 50); // below this = still learning
  const targetRoas = Number(body.target_roas ?? 2); // healthy line
  const killRoas = Number(body.kill_roas ?? 1); // below = paying to lose money
  const fatigueFrequency = Number(body.fatigue_frequency ?? 3.5);
  const weakCtr = Number(body.weak_ctr ?? 0.8); // %

  const supaUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !svcKey) return json({ error: "Supabase env vars missing" }, 500);
  const repRes = await fetch(`${supaUrl}/functions/v1/meta-ads-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${svcKey}`, apikey: svcKey },
    body: JSON.stringify({
      date_preset: datePreset,
      // Route to THIS brand's ad account. All six brands' accounts sit in one
      // Business Manager and meta-ads-report resolves them through
      // META_ADS_ACCOUNT_MAP, so auditing restylepro no longer reports
      // weprintwraps' numbers back under the wrong brand.
      brand,
      ...(body.shop_id ? { shop_id: body.shop_id } : {}),
    }),
  });
  const report = await repRes.json();
  if (!repRes.ok || !report.ok) {
    return json({ error: `meta-ads-report: ${report.error || repRes.status}` }, 502);
  }

  type Row = {
    campaign: string; spend: number; ctr: number | null; frequency: number | null;
    roas: number | null; purchases: number; cpa: number | null;
  };
  const verdicts = (report.campaigns as Row[]).map((c) => {
    if (c.spend < minSpend) {
      return { ...c, verdict: "LEARNING", reason: `Under $${minSpend} spend in range — leave alone, not enough data.` };
    }
    if (c.purchases === 0 && c.spend >= minSpend * 2) {
      return { ...c, verdict: "REMOVE", reason: `$${c.spend} spent, zero purchases — pure burn.` };
    }
    if (c.roas !== null && c.roas < killRoas) {
      return { ...c, verdict: "REMOVE", reason: `ROAS ${c.roas} < ${killRoas} — returns less than it costs.` };
    }
    if (c.frequency !== null && c.frequency >= fatigueFrequency) {
      return { ...c, verdict: "REPLACE", reason: `Frequency ${c.frequency} ≥ ${fatigueFrequency} — audience fatigued, same people seeing a stale ad. Kill it only when the refresh is ready.` };
    }
    if (c.ctr !== null && c.ctr < weakCtr) {
      return { ...c, verdict: "REPLACE", reason: `CTR ${c.ctr}% < ${weakCtr}% — creative isn't stopping the scroll.` };
    }
    if (c.roas !== null && c.roas < targetRoas) {
      return { ...c, verdict: "REPLACE", reason: `ROAS ${c.roas} between breakeven and the ${targetRoas} target — works, but the creative should be beaten by a challenger.` };
    }
    return { ...c, verdict: "KEEP", reason: `Healthy (ROAS ${c.roas ?? "n/a"}) — leave running; scale before touching.` };
  });

  const removals = verdicts.filter((v) => v.verdict === "REMOVE");
  const replacements = verdicts.filter((v) => v.verdict === "REPLACE");
  if (dryRun) {
    return json({ action: "ads_audit", brand, range: report.range, totals: report.totals, verdicts, dry_run: true });
  }

  const sb = db();
  const created: { id: string; kind: string; campaign?: string }[] = [];

  if (removals.length) {
    const lines = removals.map((r) =>
      `• ${r.campaign} — $${r.spend} spent, ${r.purchases} purchases, ROAS ${r.roas ?? "n/a"}, CPA ${r.cpa ?? "n/a"}\n  WHY: ${r.reason}`,
    ).join("\n");
    const { data: card, error } = await sb.from("slack_agent_tasks").insert({
      brand, category: "marketing", task_type: "ad_campaign",
      status: "pending", priority: "high", assigned_to: assignTo,
      title: `🔻 Pause these ${removals.length} Meta ad campaign(s) in Ads Manager`,
      description:
        `Ads audit (${report.range}) — pause these in Meta Ads Manager. ` +
        `Blended ROAS ${report.totals?.blended_roas ?? "n/a"} on $${report.totals?.spend ?? 0} spend.\n\n${lines}\n\n` +
        `Human-executed on purpose: nothing is paused programmatically.`,
      created_by: "marketing-agent-ads-audit",
      metadata: { source: "marketing-agent-ads-audit", range: report.range, verdicts: removals },
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    created.push({ id: card.id, kind: "removal" });
  }

  for (const r of replacements.slice(0, Number(body.max_replacement_briefs ?? 5))) {
    const { data: card, error } = await sb.from("slack_agent_tasks").insert({
      brand, category: "marketing", task_type: "ad_campaign",
      status: "pending", priority: "medium", assigned_to: assignTo,
      title: `🔁 Replace ad creative: ${r.campaign}`.slice(0, 160),
      description:
        `Ads audit (${report.range}): ${r.reason}\n\n` +
        `Numbers: $${r.spend} spend · ROAS ${r.roas ?? "n/a"} · CTR ${r.ctr ?? "n/a"}% · frequency ${r.frequency ?? "n/a"} · ${r.purchases} purchases.\n\n` +
        `CONTENT AI: build the challenger with the ad_pack flow (new hook + new opening visual — ` +
        `same offer unless the numbers say the offer is the problem). ` +
        `Pause "${r.campaign}" only when the replacement is live.`,
      created_by: "marketing-agent-ads-audit",
      metadata: {
        source: "marketing-agent-ads-audit", range: report.range, content_ai: true,
        suggested_action: "ad_pack", replaces_campaign: r.campaign, verdict: r,
      },
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    created.push({ id: card.id, kind: "replacement_brief", campaign: r.campaign });
  }

  return json({
    action: "ads_audit", brand, range: report.range, totals: report.totals,
    verdicts, cards: created, assigned_to: assignTo,
  });
}

// ── run (the AGENT LOOP — this is what makes it an agent, not a tool belt) ───
// Called on a schedule (cron) with no arguments. Each tick it:
//   1. MEASURE  — syncs Klaviyo status/results for every pushed campaign
//   2. ACT      — pushes human-APPROVED campaigns to Klaviyo as drafts
//                 (audience resolved from the campaign's list_segment name)
//   3. BUILD    — if the review pipeline is running dry (<MIN_PIPELINE awaiting
//                 QC), plans new campaigns toward the team's current goal.
//                 Goals are read from the Marketing Hub itself: any pending card
//                 whose title starts with "GOAL:" is the standing order. No
//                 GOAL card -> a sensible default per brand.
//   4. LEARN    — recent campaign performance is fed into the planning prompt
//   5. REPORT   — writes a run summary to agent_recommendations (Engine Room)
// Hard guarantees: never sends email, never pushes un-approved content, plans
// at most MAX_PLANS_PER_RUN campaigns per tick.
const MIN_PIPELINE = 3;
const MAX_PLANS_PER_RUN = 2;
const DEFAULT_GOALS: Record<string, string> = {
  weprintwraps:
    "Convert wrap/print quote requesters and past customers into booked jobs — " +
    "rotate angles: social proof, process transparency, seasonal fleet/business branding value",
};

/**
 * Resolve a campaign's `list_segment` to a real Klaviyo list id.
 *
 * EXACT MATCH ONLY (after normalising case/punctuation/whitespace). The old
 * substring fallback — `l.name.includes(n) || n.includes(l.name)` — was a
 * live mis-send risk: it would happily resolve a segment described as
 * "customers" to "Recent Customers", and the account carries two lists both
 * literally named "quote requesters" plus a third "WPW Quote Requesters
 * (Outlook)". On a ~10k-recipient send, silently picking the wrong audience is
 * far worse than not sending. No match is now an honest failure the caller
 * must surface.
 */
function normaliseListName(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function resolveListId(name: string, key: string): Promise<string | null> {
  const lists = await listAudiences(key);
  const n = normaliseListName(name);
  if (!n) return null;
  const exact = lists.find((l) => normaliseListName(l.name) === n);
  return exact?.id ?? null;
}

async function actionRun(body: Record<string, unknown>) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const klaviyoKey = Deno.env.get("KLAVIYO_API_KEY");
  if (!openaiKey || !klaviyoKey) return json({ error: "OPENAI_API_KEY / KLAVIYO_API_KEY missing" }, 500);
  const sb = db();
  const brands = Array.isArray(body.brands) ? body.brands.map(String) : ["weprintwraps"];
  const report: Record<string, unknown>[] = [];
  // Human-approved campaigns that could NOT be pushed. These used to be logged
  // into `did` and nothing else, so the daily cron — which only fails on a
  // top-level "error" key — stayed green while an approved campaign sat
  // unpushed indefinitely (one sat 11 days across 7 successful runs). A
  // campaign a human approved and the agent then silently dropped is a
  // failure, and the tick must report it as one.
  const blocked: string[] = [];

  for (const brand of brands) {
    const did: string[] = [];

    // 1) MEASURE — refresh every campaign that lives in Klaviyo.
    const { data: pushed } = await sb.from("agent_email_campaigns")
      .select("id").eq("brand", brand)
      .in("created_by", ["marketing-agent", "workforce-marketing-agent"])
      .not("klaviyo_campaign_id", "is", null).limit(20);
    for (const c of pushed ?? []) {
      try { await actionStats({ campaign_id: c.id }); did.push(`synced ${c.id.slice(0, 8)}`); }
      catch { /* keep the loop alive */ }
    }

    // 2) ACT — push approved-but-not-pushed campaigns as Klaviyo DRAFTS.
    // Includes workforce-agent campaigns (wpw-workforce-orchestrator) so a
    // human approval in the Hub is all it takes to land a Klaviyo draft.
    const { data: approved } = await sb.from("agent_email_campaigns")
      .select("id, campaign_name, list_segment").eq("brand", brand)
      .in("created_by", ["marketing-agent", "workforce-marketing-agent"])
      .eq("status", "approved")
      .is("klaviyo_campaign_id", null).limit(10);
    for (const c of approved ?? []) {
      const listId = await resolveListId(c.list_segment || "", klaviyoKey);
      if (!listId) {
        const msg = `SKIP push "${c.campaign_name}": no Klaviyo list matches "${c.list_segment}"`;
        did.push(msg);
        blocked.push(msg);
        continue;
      }
      const res = await actionPush({ campaign_id: c.id, list_id: listId, force: true });
      if (res.status === 200) {
        did.push(`pushed "${c.campaign_name}" -> Klaviyo draft`);
      } else {
        const msg = `push failed "${c.campaign_name}" (HTTP ${res.status})`;
        did.push(msg);
        blocked.push(msg);
      }
    }

    // 3+4) BUILD (with LEARN) — top up the QC pipeline toward the current goal.
    const { count: awaiting } = await sb.from("agent_email_campaigns")
      .select("id", { count: "exact", head: true })
      .eq("brand", brand).eq("created_by", "marketing-agent").eq("status", "needs_review");
    if ((awaiting ?? 0) < MIN_PIPELINE) {
      // The team's standing order: a Hub card titled "GOAL: ..."
      const { data: goalCards } = await sb.from("slack_agent_tasks")
        .select("title").eq("brand", brand).eq("status", "pending")
        .ilike("title", "GOAL:%").order("created_at", { ascending: false }).limit(1);
      let goal = goalCards?.[0]?.title?.replace(/^GOAL:\s*/i, "") || DEFAULT_GOALS[brand] || DEFAULT_GOALS.weprintwraps;

      // LEARN: fold recent results into the brief so angles adapt.
      const { data: recent } = await sb.from("agent_email_campaigns")
        .select("campaign_name, stats").eq("brand", brand)
        .not("stats", "is", null).order("updated_at", { ascending: false }).limit(5);
      const perf = (recent ?? [])
        .filter((r) => r.stats?.performance)
        .map((r) => `"${r.campaign_name}": ${JSON.stringify(r.stats.performance)}`).join("; ");
      if (perf) goal += `\n\nRecent campaign results (lean into what worked): ${perf}`;

      const deficit = Math.min(MIN_PIPELINE - (awaiting ?? 0), MAX_PLANS_PER_RUN);
      const res = await actionPlan({ brand, goal, count: deficit });
      did.push(res.status === 200 ? `planned ${deficit} new email campaign(s) into the Hub for QC` : "email plan failed");
    } else {
      did.push(`email pipeline full (${awaiting} awaiting QC)`);
    }

    // 3b) SOCIAL — keep the organic queue full (drafts awaiting review).
    const { count: socialDrafts } = await sb.from("agent_social_posts")
      .select("id", { count: "exact", head: true })
      .eq("brand", brand).eq("created_by", "marketing-agent").eq("status", "draft");
    if ((socialDrafts ?? 0) < MIN_PIPELINE) {
      try {
        const deficit = Math.min(MIN_PIPELINE - (socialDrafts ?? 0), MAX_PLANS_PER_RUN + 1);
        const res = await actionPlanSocial({ brand, count: deficit });
        did.push(res.status === 200 ? `planned ${deficit} organic post(s) with real media` : "social plan failed");
      } catch (e) { did.push(`social plan failed: ${String(e).slice(0, 100)}`); }
    } else {
      did.push(`social queue full (${socialDrafts} drafts awaiting QC)`);
    }

    // 3c) ADS — keep one fresh Ads Launch Pack pending at all times.
    const { count: pendingAds } = await sb.from("slack_agent_tasks")
      .select("id", { count: "exact", head: true })
      .eq("brand", brand).eq("created_by", "marketing-agent")
      .eq("task_type", "ad_campaign").eq("status", "pending");
    if ((pendingAds ?? 0) === 0) {
      try {
        const res = await actionAdPack({ brand });
        did.push(res.status === 200 ? "built a fresh Ads Launch Pack" : "ad pack failed");
      } catch (e) { did.push(`ad pack failed: ${String(e).slice(0, 100)}`); }
    } else {
      did.push(`${pendingAds} Ads Launch Pack(s) already awaiting QC`);
    }

    // 5) REPORT — a run log the Engine Room can read.
    await sb.from("agent_recommendations").insert({
      brand, category: "marketing_agent_run", source: "marketing-agent",
      priority: "low", status: "info",
      title: `Agent run ${new Date().toISOString().slice(0, 16)}Z`,
      description: did.join("\n") || "nothing to do",
    });
    report.push({ brand, actions: did });
  }
  if (blocked.length) {
    return json({
      action: "run",
      report,
      blocked,
      error: `${blocked.length} approved campaign(s) could not be pushed to Klaviyo — see "blocked"`,
    });
  }
  return json({ action: "run", report });
}

// ── CONTENT DIRECTOR — one central agent, ONE approval queue ─────────────────
// Every generator (marketing-agent, workforce content-agent, Video Studio,
// Content Studio) lands drafts in agent_social_posts / agent_email_campaigns.
// The Director is the single gate over ALL of them:
//   director_queue      — the one approval queue (all brands, all channels)
//   director_approve    — approve = scheduled = published: assigns the next
//                         open programming slot (or an explicit datetime) and
//                         flips to 'scheduled'; content-deploy publishes it.
//   director_reject     — soft-reject (status 'rejected', row kept)
//   director_plan_week  — fills the week's programming grid
//                         (docs/WEEKLY-CONTENT-ENGINE.md) with drafts from
//                         real library media, one per open slot.

async function takenDates(sb: ReturnType<typeof db>, brand: string, platform: string): Promise<string[]> {
  const { data } = await sb
    .from("agent_social_posts")
    .select("scheduled_date")
    .eq("brand", brand)
    .eq("platform", platform)
    .in("status", ["approved", "scheduled"])
    .gte("scheduled_date", new Date().toISOString());
  return (data || []).map((r: { scheduled_date: string }) => r.scheduled_date).filter(Boolean);
}

// ── IDEAS LANE ──────────────────────────────────────────────────────────────
// Owner: "THERE SHOULD BE SQUARE CARDS SHOWING IDEAS THEN WE APPROVE AND
// CONTENT GETS MADE."
//
// It did not exist. `content_hooks` held 534 rows — 505 of them from one week
// — and NOTHING consumed them. `hooks_to_drafts`, the only action with "hooks"
// in its name, generates FRESH hooks from a shoot transcript and never reads
// that table; the Director queue reads social drafts and email campaigns only.
// So ideas piled up with no surface and no action that could turn one into a
// piece of content. These two actions are the missing loop.

/**
 * FIND FOOTAGE FOR AN IDEA — the library, the transcripts, the hook moments.
 *
 * Owner: "let ai find the vids from our library and drive".
 *
 * Deterministic term overlap, not a model call: the same idea always picks the
 * same clip, and the reason is reportable ("matched on: squeegee, panel"). An
 * LLM would be slower, non-repeatable, and would confidently justify a bad
 * pick — which is the failure mode that matters here, because a wrong clip
 * looks finished and ships.
 *
 * Sources, all already in the database — Drive footage arrives here through
 * the media-parser, so "search the library" and "search Drive" are the same
 * search once a clip has been ingested:
 *   video_render_jobs   finished cuts (preferred for a social draft)
 *   media_sources       Whisper transcripts + titles
 *   content_moments     hook scores and verbatim quotes
 *   agent_media_assets  titles, tags, content_type
 *
 * Returns NULL when nothing matches. That is a real answer.
 */
/**
 * Words that carry no topical signal — matching on them is noise.
 *
 * EXPANDED 2026-08-07 after a LIVE approval matched badly. The idea "We put the
 * wrap industry on camera the way it deserves to be seen" matched on
 * `["put","wrap","industry","way"]` — and the clip was an interview about SLOW
 * SEASON IN WINTER. Two of those four are filler, so a 4-term match was really
 * a 1-term match wearing three passengers, and at 100 points per term it beat
 * genuinely relevant footage. Mirrors `src/lib/footageMatch.ts`.
 */
const IDEA_STOPWORDS = new Set(["the","and","for","with","that","this","you","your","our","are","was","were","has","have","had","not","but","all","can","will","from","they","them","how","why","what","when","who","its","get","got","out","one","two","new","now","just","like","then","than","into","over","off","his","her","she","him","their","there","here","been","more","most","some","any","every","about","after","before","because","make","made","does","did","doing","very",
  "put","puts","way","ways","need","needs","needed","use","uses","used","see","seen","saw","look","looks","show","shows","shown","thing","things","stuff","time","times","good","great","best","better","want","wants","know","knows","take","takes","give","gives","come","comes","keep","keeps","let","lets","must","should","would","could","don't","doesn't","won't","isn't","aren't"]);

/**
 * Words TRUE OF NEARLY EVERY CLIP here, so matching on them proves nothing.
 *
 * Not stopwords — they are real and on-topic. They simply do not DISCRIMINATE
 * in a wrap-footage library where every clip mentions "wrap". Inverse document
 * frequency, stated explicitly so a human can read and argue with the list.
 * They still score; a match made ONLY of them is refused.
 */
const DOMAIN_COMMON = new Set(["wrap","wraps","wrapped","wrapping","vinyl","car","cars","vehicle","vehicles","truck","trucks","van","vans","install","installs","installed","installation","shop","shops","print","printed","printing","graphics","design","designs"]);

function ideaTerms(text: string): string[] {
  const raw = String(text || "").toLowerCase().replace(/[^a-z0-9\s'-]/g, " ");
  const out = new Set<string>();
  for (const w of raw.split(/\s+/)) {
    const t = w.replace(/^['-]+|['-]+$/g, "");
    if (t.length < 3 || IDEA_STOPWORDS.has(t)) continue;
    out.add(t);
  }
  return [...out];
}

interface FootagePick { url: string; label: string | null; matchedOn: string[]; isFinishedCut: boolean }

async function findFootageForIdea(sb: any, ideaText: string, brand: string): Promise<FootagePick | null> {
  const want = ideaTerms(ideaText);
  if (!want.length) return null;

  interface Cand { url: string; text: string; score: number; createdAt: string; finished: boolean; label: string | null; brand: string | null }
  const cands: Cand[] = [];

  // 1. FINISHED CUTS — preferred: a social draft wants something watchable.
  //
  // A "FINISHED CUT" IS NOT NECESSARILY A VIDEO, and that cost a live approval.
  // `video_render_jobs` also carries `kind:"static_post"` jobs, whose
  // `final_url` is a .jpg — one frame grabbed out of a clip. Measured
  // 2026-08-07: of 118 complete renders with a final_url, **42 (35.6%) are
  // stills**, not video.
  //
  // The +40 finished bonus below then made those stills OUTRANK real raw
  // footage, so an approval would match a JPG, report `finished: true`, and the
  // build step would correctly refuse to queue a cut from a still — leaving the
  // owner pressing Approve and getting no video, repeatedly, with the honest
  // reason buried in a `build_gaps` string. Reproduced live on idea
  // 7f559895 ("Nobody films the hands. We do."): matched a .jpg, 0 cuts queued.
  //
  // So a still finished render is still a CANDIDATE — it is legitimate media
  // for a text post — but it is no longer treated as a finished CUT, which is
  // what the bonus is for. `isVideoUrl` decides on the extension, the same test
  // `actionIdeaApprove` uses to set `is_video`, so the two can never disagree.
  const isVideoUrl = (u: string) => /\.(mp4|mov|webm)(\?|$)/i.test(String(u || ""));
  const { data: renders } = await sb.from("video_render_jobs")
    .select("final_url, brand, created_at, blueprint")
    .eq("status", "complete").not("final_url", "is", null)
    .order("created_at", { ascending: false }).limit(120);
  for (const r of renders || []) {
    const bp = r.blueprint || {};
    const label = String(bp.title || bp.topic || "").trim() || null;
    const url = String(r.final_url);
    cands.push({
      url, brand: r.brand || null, createdAt: String(r.created_at || ""),
      finished: isVideoUrl(url), score: 0, label,
      text: [bp.title, bp.topic, bp.caption, bp.hook, ...(bp.scenes || []).map((x: any) => x?.text)].filter(Boolean).join(" "),
    });
  }

  // 2. RAW CLIPS with a real transcript — this is where Drive footage lands.
  //
  // ── THIS READ WAS OFFERING SONGS AS FOOTAGE (fixed 2026-08-10) ────────────
  //
  // Owner, looking at a clip list: "It's offering .mp3 files as clips to cut.
  // You cannot cut video from them."
  //
  // `media_sources` is not a video table, and this query never said otherwise —
  // no `kind` filter, no extension test. Measured on production the same day:
  //
  //   kind = 'music'   105 rows, ALL audio urls, 100 of them carrying beats
  //   kind = 'video'   376 rows, 174 with an audio-shaped FILENAME
  //
  // So the music catalogue — real songs, under `wrap-files/wraptv-music/*.mp3`,
  // with transcripts and hook moments that score exactly like footage — was in
  // the candidate pool on every idea, and step 3 below even lifted it on hook
  // score. This function WRITES its pick onto the draft, so a song could be
  // attached as the clip and the build step would then refuse it.
  //
  // TWO SEPARATE FACTS, AND THEY MUST NOT BE CONFLATED:
  //
  //   the URL   decides whether it can be cut. Audio url → never a candidate.
  //   the NAME  decides nothing. 174 of the `kind='video'` rows carry
  //             `…_reel.mp3` as their filename while `storage_url` points at
  //             `…_reel.mp4` — the parser recorded the audio track it pulled
  //             out for Whisper. Those are REAL clips, and the most editable in
  //             the library (200–355 beats each). Filtering on the name would
  //             have deleted the best footage there is while looking like a fix.
  //
  // Mirrors `cuttableMedia` / `clipLabel` in src/lib/footageMatch.ts, restated
  // here because an edge function cannot import from src/.
  const isAudioUrl = (u: string) =>
    /\.(mp3|wav|m4a|aac|flac|ogg|oga|aif|aiff|wma|opus)$/i.test(String(u || "").split(/[?#]/)[0]);
  /** The name to show — repaired from the url when the name is about the audio track. */
  const clipLabelFor = (name: string, url: string) => {
    const n = String(name || "").trim();
    const base = String(url || "").split(/[?#]/)[0].split("/").pop() || "";
    if (n && !(/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(n) && /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(base))) return n;
    return base || n || null;
  };
  const { data: sources } = await sb.from("media_sources")
    .select("id, kind, title, filename, shoot, transcript, storage_url, created_at")
    // `kind='music'` is the archived audio catalogue. It is not footage and can
    // never become a cut, so it never enters the pool.
    .neq("kind", "music")
    .not("storage_url", "is", null)
    .order("created_at", { ascending: false }).limit(200);
  const byId = new Map<string, Cand>();
  for (const m of sources || []) {
    // The url is the thing ffmpeg would be handed. Belt and braces with the
    // `kind` filter above, because `kind` is a typed column and this is the
    // file itself — a mis-typed row still cannot slip an mp3 into a cut.
    if (isAudioUrl(String(m.storage_url))) continue;
    const c: Cand = {
      url: String(m.storage_url), brand: null, createdAt: String(m.created_at || ""),
      finished: false, score: 0,
      label: clipLabelFor(String(m.title || m.filename || ""), String(m.storage_url)),
      // Transcripts are long; the first slice carries the subject matter.
      text: [m.title, m.filename, m.shoot, String(m.transcript || "").slice(0, 4000)].filter(Boolean).join(" "),
    };
    byId.set(String(m.id), c);
    cands.push(c);
  }

  // 3. HOOK MOMENTS lift a clip that has a strong, quotable beat about it.
  if (byId.size) {
    const { data: moments } = await sb.from("content_moments")
      .select("source_id, hook_score, verbatim_quote")
      .in("source_id", [...byId.keys()].slice(0, 100))
      .order("hook_score", { ascending: false, nullsFirst: false }).limit(400);
    for (const mo of moments || []) {
      const c = byId.get(String(mo.source_id));
      if (!c) continue;
      c.score = Math.max(c.score, Number(mo.hook_score) || 0);
      if (mo.verbatim_quote) c.text += " " + String(mo.verbatim_quote);
    }
  }

  // 4. LIBRARY ASSETS — tags and titles, for footage with no transcript yet.
  const { data: assets } = await sb.from("agent_media_assets")
    .select("storage_url, title, original_filename, tags, content_type, brand, created_at")
    .eq("asset_type", "video").not("storage_url", "is", null)
    .order("created_at", { ascending: false }).limit(200);
  for (const a of assets || []) {
    // Same two rules as step 2: the URL decides, the name is only a label.
    if (isAudioUrl(String(a.storage_url))) continue;
    cands.push({
      url: String(a.storage_url), brand: a.brand || null, createdAt: String(a.created_at || ""),
      finished: false, score: 0,
      label: clipLabelFor(String(a.title || a.original_filename || ""), String(a.storage_url)),
      text: [a.title, a.original_filename, a.content_type, ...(a.tags || [])].filter(Boolean).join(" "),
    });
  }

  // Score: each real term outweighs every tiebreaker, so relevance can never
  // be outvoted by recency or a hook score.
  let best: { c: Cand; s: number; on: string[] } | null = null;
  for (const c of cands) {
    if (!c.url || !c.text) continue;
    if (c.brand && String(c.brand).toLowerCase() !== brand.toLowerCase()) continue;
    const hay = c.text.toLowerCase();
    const on = want.filter((t) => hay.includes(t));
    if (!on.length) continue;

    // Domain-common terms COUNT FOR LESS, they are not refused. Rejecting a
    // domain-only match turns a weak match into NO match and strips footage
    // from reasonable ideas — worse than the bug being fixed. Weighting gets
    // the ranking right at no cost to coverage. Mirrors src/lib/footageMatch.ts.
    const meaningful = on.filter((t) => !DOMAIN_COMMON.has(t));
    let sc = meaningful.length * 100 + (on.length - meaningful.length) * 15;
    // A finished VIDEO is the best answer for a social draft. A still scores on
    // relevance alone — never boosted above real footage it is less relevant
    // than, and never boosted above raw video of equal relevance, because the
    // whole point of matching is to feed a cut.
    if (c.finished) sc += 40;
    else if (isVideoUrl(c.url)) sc += 20;
    sc += Math.min(30, c.score / 4);
    if (!best || sc > best.s || (sc === best.s && c.createdAt > best.c.createdAt)) best = { c, s: sc, on };
  }
  if (!best) return null;
  return { url: best.c.url, label: best.c.label, matchedOn: best.on.slice(0, 6), isFinishedCut: best.c.finished };
}

/** Ideas waiting on a human. Newest first, with the honest total. */
async function actionDirectorIdeas(body: Record<string, unknown>) {
  const sb = db();
  const limit = Math.min(Number(body.limit) || 120, 300);

  let q = sb.from("content_hooks")
    .select("id, brand, hook_text, text, hook_type, pillar_key, awareness, score, source, created_at")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (body.brand) q = q.eq("brand", String(body.brand));

  const [{ data, error }, { count }] = await Promise.all([
    q,
    sb.from("content_hooks").select("id", { count: "exact", head: true }).eq("active", true),
  ]);
  if (error) return json({ error: error.message }, 500);

  const ideas = (data || [])
    // hook_text and text both exist and either may hold the copy. An idea with
    // neither is a blank card — the exact thing the boards were full of.
    .map((h) => ({ ...h, idea_text: String(h.hook_text || h.text || "").trim() }))
    .filter((h) => h.idea_text.length > 0);

  const total = count ?? ideas.length;
  return json({
    action: "director_ideas",
    ideas,
    totals: { ideas: total, shown: ideas.length, truncated: Math.max(0, total - ideas.length) },
  });
}

/**
 * Approve one idea → MAKE THE CONTENT.
 *
 * One idea fans out into every platform that can carry it (owner: "ONE PIECE
 * OF VIDEO SHOULD TURN INTO MANY PIECES OF SOCIAL CONTENT"), each a real
 * agent_social_posts DRAFT so it flows through the queue that already exists.
 * Nothing publishes here — a machine may draft, only a human sends.
 *
 * The idea's own words carry through unchanged. Per-platform work is framing
 * and length, never a new claim: fabricated copy reaches customers.
 */
async function actionIdeaApprove(body: Record<string, unknown>, principal: HumanPrincipal) {
  // The stacked tenant-runtime PR replaces this staging guard with the resolved
  // marketing_tenants.shop_id -> shop_members authorization for VIDEO ideas.
  // Until then, no non-admin principal may reach legacy unscoped writes.
  if (!principal.isPlatformAdmin) {
    return json({ error: "Tenant-scoped video approval is not installed" }, 403);
  }

  const sb = db();
  const ideaId = String(body.idea_id || "").trim();
  if (!ideaId) return json({ error: "idea_id required" }, 400);

  const { data: idea, error: ideaErr } = await sb.from("content_hooks")
    .select("id, brand, hook_text, text, hook_type, active").eq("id", ideaId).maybeSingle();
  if (ideaErr) return json({ error: ideaErr.message }, 500);
  if (!idea) return json({ error: "idea not found" }, 404);

  const text = String(idea.hook_text || idea.text || "").trim();
  if (!text) return json({ error: "that idea has no text to work from" }, 400);
  const brand = String(body.brand || idea.brand || "wraptvworld");

  // FIND THE RIGHT FOOTAGE, or none. This used to attach "the newest finished
  // render for the brand" — not a search, a shrug. Pressed across 534 ideas it
  // would put the same recent clip on every draft, which is the wrong video
  // nearly every time, and a wrong clip is worse than none because it looks
  // finished and ships. See src/lib/footageMatch.ts for the rules and tests.
  let mediaUrl = body.media_url ? String(body.media_url) : null;
  let matchInfo: { matchedOn: string[]; label: string | null; finished: boolean } | null = null;

  if (!mediaUrl) {
    const picked = await findFootageForIdea(sb, text, brand);
    if (picked) {
      mediaUrl = picked.url;
      matchInfo = { matchedOn: picked.matchedOn, label: picked.label, finished: picked.isFinishedCut };
    }
  }
  const isVideo = !!mediaUrl && /\.(mp4|mov|webm)(\?|$)/i.test(mediaUrl);

  // ── the fan-out plan (mirrors src/lib/ideaFanOut.ts) ──────────────────────
  const clip = (t: string, max: number) => {
    const s = t.trim().replace(/\s+/g, " ");
    if (s.length <= max) return s;
    const cut = s.slice(0, max - 1);
    const sp = cut.lastIndexOf(" ");
    return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
  };
  // THE SIX SURFACES — meta, x, threads, short, longform, substack. Each is a
  // real row on its own platform, so the Content Director, the calendar and
  // content-deploy all see it. Owner: "for meta, x, threads, short, longform,
  // substack for each brand ai creates angles".
  //
  // The copy carried here is the idea's OWN words, framed to length. This
  // action never invents a claim; the per-brand ANGLE writing is
  // repurpose_across_brands, which runs the whole slate through one prompt so
  // no two share a hook.
  const wantsVideo = !!mediaUrl && isVideo;

  /**
   * EVERY SURFACE IS FRAMED FOR ITS OWN CHANNEL AND BRAND.
   *
   * This used to be `caption: text` seven times over, differing only by a
   * length clip — so one idea became seven identical posts. Measured over
   * every row this action had ever produced: 59 rows, 9 distinct captions,
   * 100% reused across channels, one line on 7 surfaces at worst. Six
   * identical posts across six accounts is what an audience reads as a bot.
   *
   * `hookForSurface` reshapes the idea's OWN words per the channel's hook move
   * and appends a claim-free close chosen by channel AND brand. It never adds
   * a fact — which keeps this action's stated promise ("never invents a
   * claim") intact while ending the duplication.
   *
   * The clip runs AFTER framing. Clipping first would cut the question mark
   * off the close that makes X a question.
   */
  const surface = (platform: string, post_type: string, media: boolean, max?: number) => {
    const { caption, brief } = hookForSurface(text, platform, post_type, brand);
    return {
      platform, post_type, media, brief,
      // The FRAMED line — the fallback from here on, not the product. It is
      // what lands if the writer below is unavailable or writes something the
      // grounding guard refuses.
      framed: max ? clip(caption, max) : caption,
      copyBrief: surfaceBrief(platform, post_type, brand),
    };
  };

  const pieces = [
    surface("instagram", wantsVideo ? "reel" : "feed", !!mediaUrl),
    surface("facebook", "feed", !!mediaUrl),
    surface("x", "thread", !!mediaUrl, 280),
    surface("threads", "post", !!mediaUrl, 500),
    surface("linkedin", "post", !!mediaUrl),
    surface("substack", "newsletter", false),
  ];
  // A Short needs footage — queueing one with no clip makes a draft nobody can
  // publish, which is the blank-card problem in a new costume.
  if (wantsVideo) pieces.push(surface("youtube", "short", true, 100));

  // ── ONLY THE SURFACES THIS IDEA CAN ACTUALLY FILL ────────────────────────
  //
  // Six surfaces from one sentence is where the dead cards came from: 167 of
  // them in 60 days, and the long ones could never be anything but a fragment
  // or — once a writer existed — an invention. A one-line idea genuinely IS an
  // Instagram caption and an X post. It is not a newsletter, and asking for one
  // produces the fabricated anecdotes the first backfill batch had to revert.
  //
  // So a surface the source cannot carry is NOT CREATED. That is fewer cards
  // and more content: the board stops filling with drafts nobody can use, and
  // the honest gap is reported so a human can add real material and re-run.
  const thin: Array<{ surface: string; why: string }> = [];
  const carried = pieces.filter((p) => {
    const why = sourceTooThin(p.copyBrief, text);
    if (!why) return true;
    thin.push({ surface: `${p.platform}:${p.post_type}`, why });
    return false;
  });
  pieces.length = 0;
  pieces.push(...carried);

  // ── THE COPY IS WRITTEN HERE ─────────────────────────────────────────────
  //
  // Everything above this line is framing, and framing was what shipped: 167
  // rows from this action in 60 days, every one of them under 140 characters,
  // including six "newsletters". `writeSurfaceCopy` is the consumer the brief
  // was always built for; `screenPieceCopy` checks each answer back against the
  // idea's own words and keeps the framed line when it cannot.
  const written = await writeSurfaceCopy(
    text,
    brand,
    pieces.map((p) => p.copyBrief).filter((b): b is SurfaceBrief => !!b),
  );

  const screened = pieces.map((p) => ({
    ...p,
    ...screenPieceCopy({
      written: written.byKey[`${p.platform}:${p.post_type}`],
      framed: p.framed,
      source: text,
      brief: p.copyBrief,
      brandLabel: brandFactsFor(brand)?.label,
    }),
  }));

  // Two surfaces opening identically is the failure this path was rebuilt to
  // end, so it is checked on the finished copy rather than assumed away by the
  // single-pass prompt. Recorded, not repaired — rewriting one of them here
  // would put deterministic code back in the writing seat.
  const dupes = duplicateOpenings(
    Object.fromEntries(screened.map((p) => [`${p.platform}:${p.post_type}`, p.caption])),
  );

  const made: Array<{ platform: string; id: string }> = [];
  const failed: Array<{ platform: string; error: string }> = [];
  for (const p of screened) {
    const { data: row, error } = await sb.from("agent_social_posts").insert({
      brand,
      platform: p.platform,
      post_type: p.post_type,
      caption: p.caption,
      hashtags: [],
      media_urls: p.media && mediaUrl ? [mediaUrl] : [],
      scheduled_date: null,          // never schedules itself
      status: "draft",               // never publishes
      created_by: "idea_approve",
      generation_meta: {
        source: "idea_approve", idea_id: ideaId, idea_type: idea.hook_type || null,
        // The brief that framed this caption, stored beside it. A hook you
        // cannot trace back to a channel rule is one nobody can review.
        hook: p.brief,
        // WHICH PATH WROTE THIS ONE. A card that fell back reads differently
        // from one that did not, and a human should be able to see why on the
        // row instead of guessing at the model's mood.
        copy: {
          method: p.method,
          refused: p.violations,
          writer_error: written.error,
          brief: p.copyBrief,
        },
      },
    }).select("id").single();
    if (error) { failed.push({ platform: p.platform, error: error.message }); continue; }
    made.push({ platform: p.platform, id: row.id });
  }

  // ── WHERE TO CUT FROM ────────────────────────────────────────────────────
  //
  // Owner, watching a finished reel: "I am adjusting my clothes nothing said."
  // She was right, and the cause was one hardcoded line: every cut was
  // `{ start: 0, end: 12 }`. The FIRST twelve seconds of any clip is setup —
  // walking into frame, straightening a shirt, waiting for the cue. The good
  // part is never at 0:00.
  //
  // Meanwhile this system holds 11,675 scored moments that say exactly where
  // the hooks are, and the cut ignored all of them.
  //
  // So: find the strongest scored moment on THIS clip and cut there. Ranked by
  // hook, then soundbite, then b-roll — with `nullsFirst:false`, because
  // Postgres sorts NULLS FIRST on DESC and the unscored rows would otherwise
  // win. Prefer a moment that carries a QUOTE: something was said there.
  //
  // No moments, or the clip is unknown? Fall back to 0-12 and SAY SO on the
  // blueprint, rather than pretending the window was chosen.
  const cutWindow = async (clipUrl: string): Promise<{ start: number; end: number; why: string }> => {
    const FALLBACK = { start: 0, end: 12, why: "no scored moment for this clip — took the opening 12s" };
    try {
      const { data: src } = await sb.from("media_sources")
        .select("id").eq("storage_url", clipUrl).limit(1).maybeSingle();
      if (!src?.id) return FALLBACK;
      const { data: moments } = await sb.from("content_moments")
        .select("start_time, end_time, hook_score, soundbite_score, broll_score, verbatim_quote")
        .eq("source_id", src.id)
        .order("hook_score", { ascending: false, nullsFirst: false })
        .order("soundbite_score", { ascending: false, nullsFirst: false })
        .order("broll_score", { ascending: false, nullsFirst: false })
        .limit(12);
      if (!moments?.length) return FALLBACK;
      // A moment with words beats a silent one of the same rank — "nothing
      // said" is exactly the complaint this exists to answer.
      const spoken = moments.find((m: any) => String(m.verbatim_quote || "").trim().length > 12);
      const best = spoken || moments[0];
      const start = Math.max(0, Number(best.start_time) || 0);
      const end = Number(best.end_time) || 0;
      // Too short to be a cut, or unusable bounds — keep the start, give it room.
      const span = end - start;
      const chosen = span >= 3 ? { start, end: Math.min(end, start + 30) } : { start, end: start + 12 };
      const score = best.hook_score ?? best.soundbite_score ?? best.broll_score ?? null;
      return {
        ...chosen,
        why: `cut at the strongest moment (${score === null ? "unscored" : `score ${score}`}${spoken ? ", carries speech" : ", visual only"}) at ${chosen.start}s`,
      };
    } catch {
      return FALLBACK;
    }
  };
  const window_ = mediaUrl && isVideo ? await cutWindow(mediaUrl) : { start: 0, end: 12, why: "" };

  // ── QUEUE THE BUILDS — one cut per SHAPE, not one per surface ─────────────
  //
  // Owner, 2026-08-07: "it should automatically create a job to build… The crop
  // plus edit unique to social channel."
  //
  // This action found footage and ATTACHED it, and never once queued a render.
  // Measured over every row it had produced: 59 rows, 0 with a build job, 18
  // carrying a RAW clip attached as if it were finished content, and each
  // idea's 7 surfaces sharing 1–2 files. So a 9:16 reel, a 16:9 X post and a
  // 4:5 feed post were handed the same file — one right by luck, the other two
  // cropped by the platform at upload, badly.
  //
  // Grouped by SHAPE because that is where the real work differs: an Instagram
  // reel and a YouTube Short are the same 9:16 cut, so they share a file.
  // Seven surfaces collapse to three renders.
  //
  // Queued ONLY when there is a real source clip. No clip is an honest gap —
  // a render of nothing is a bill for nothing.
  const builds: Array<{ aspect: string; id: string; surfaces: string[] }> = [];
  const buildGaps: string[] = [];
  if (!mediaUrl) {
    buildGaps.push("no footage matched this idea, so no cut was queued — the drafts are copy-only until footage exists");
  } else if (!isVideo) {
    buildGaps.push("the matched asset is a still, not video — no cut queued");
  } else {
    for (const cut of planCuts(pieces.map((p) => ({ platform: p.platform, post_type: p.post_type })))) {
      const sourceRef = cutSourceRef(ideaId, cut.aspect);
      // PRE-SPEND FENCE. Re-approving an idea must find the existing cut, not
      // buy a second identical one. Same shape as the vision_score and
      // already_designed guards: checked BEFORE the insert, never after.
      const { data: existing } = await sb.from("video_render_jobs")
        .select("id").eq("source_ref", sourceRef).limit(1).maybeSingle();
      if (existing) { builds.push({ aspect: cut.aspect, id: existing.id, surfaces: cut.surfaces }); continue; }

      const { data: job, error: jobErr } = await sb.from("video_render_jobs").insert({
        brand,
        source_ref: sourceRef,
        status: "queued",
        bucket: "wrap-files",
        // `[]`, NOT `{}`. The renderer does `for (const cap of job.captions ||
        // [])`, and an empty OBJECT is truthy — so the guard never fires and
        // `for...of {}` throws "object is not iterable", killing the render.
        // Measured: 131 jobs with an array here, 118 complete; 6 with an
        // object, 0 complete — and those 6 were the first approve-time cuts.
        captions: [],
        blueprint: {
          id: sourceRef,
          source: "idea_approve",
          idea_id: ideaId,
          brand,
          title: text.slice(0, 120),
          headline: text.slice(0, 120),
          // `format` implies the aspect in the renderer's FORMAT_ASPECT table,
          // and a format that contradicts an aspect makes the format win — so
          // both are stated and they agree by construction.
          format: cut.format,
          aspectRatio: cut.aspect,
          // Which surfaces this one file is for. Read by the board so a person
          // can see that one cut serves three posts rather than assuming two
          // are missing.
          surfaces: cut.surfaces,
          // Chosen, not assumed — see `cutWindow` above.
          cut_window_reason: window_.why,
          scenes: [{ sceneId: "matched", clipUrl: mediaUrl, start: window_.start, end: window_.end, purpose: "hook" }],
        },
      }).select("id").single();
      if (jobErr) { buildGaps.push(`${cut.aspect}: ${jobErr.message}`); continue; }
      builds.push({ aspect: cut.aspect, id: job.id, surfaces: cut.surfaces });
    }
  }

  // ── THE SPINE ─────────────────────────────────────────────────────────────
  // Owner: "each design idea is turned into the spine, multiple pieces from
  // one idea". The pieces existed; nothing recorded that they came from the
  // same idea, so a topic could not be seen as a topic. One narrative per
  // (brand, idea text); each draft becomes an artifact pointing at its real
  // row. Never fatal — losing the lineage must not lose the content.
  let narrativeId: string | null = null;
  try {
    const topic = text.slice(0, 180);
    const { data: found } = await sb.from("content_narratives")
      .select("id").eq("brand", brand).ilike("topic", topic).limit(1).maybeSingle();
    if (found) narrativeId = found.id;
    else {
      const { data: created } = await sb.from("content_narratives").insert({
        brand, topic, objective: "awareness",
        source_table: "content_hooks", source_id: ideaId,
        created_by: "idea_approve",
      }).select("id").single();
      narrativeId = created?.id || null;
    }
    if (narrativeId) {
      const KIND: Record<string, string> = {
        instagram: "instagram", facebook: "facebook", x: "x_thread",
        threads: "threads", linkedin: "linkedin", youtube: "youtube",
        substack: "substack",
      };
      for (const m of made) {
        const kind = KIND[m.platform];
        if (!kind) continue;   // a surface the spine has no kind for — skip, never invent
        await sb.from("content_artifacts").upsert({
          narrative_id: narrativeId, kind,
          target_table: "agent_social_posts", target_id: m.id,
          status: "drafted", produced_by: "idea_approve",
        }, { onConflict: "narrative_id,kind" });
      }
    }
  } catch (e) {
    console.warn("[idea_approve] spine write failed:", e);
  }

  // Retire the idea ONLY if something was actually produced — otherwise an
  // approval that failed would silently delete the idea and lose the work.
  if (made.length) {
    await sb.from("content_hooks").update({ active: false, updated_at: new Date().toISOString() }).eq("id", ideaId);
  }

  return json({
    action: "idea_approve",
    idea_id: ideaId,
    brand,
    media_attached: !!mediaUrl,
    // WHY this clip — shown on the card, so a bad pick is visible instead of
    // silently shipping. Null means nothing matched and the drafts are
    // copy-only, which is an honest outcome rather than a wrong video.
    media_match: matchInfo,
    narrative_id: narrativeId,
    is_video: isVideo,
    drafts: made,
    failed,
    // THE CUTS THIS APPROVAL QUEUED, one per shape, and what each one serves.
    // Returned so the toast can state the real number and the Brand Board can
    // show a progress bar against a job that actually exists.
    builds,
    // Why a shape got no cut. An empty build list with no reason reads as a
    // failure; with a reason it reads as "there is no footage yet", which is
    // the truth and is actionable.
    build_gaps: buildGaps,
    // Surfaces this idea could not honestly fill, and why. Reported rather
    // than silently dropped — "no LinkedIn post" with a reason is actionable,
    // without one it reads as a bug.
    surfaces_skipped: thin,
    // WHAT ACTUALLY GOT WRITTEN. Stated as counts rather than "done", so an
    // approval where every surface fell back to its framed line cannot read on
    // the board as an approval where every surface got real copy.
    copy: {
      written: screened.filter((p) => p.method === "written").length,
      trimmed: screened.filter((p) => p.method === "trimmed").length,
      framed: screened.filter((p) => p.method === "framed").length,
      writer_error: written.error,
      refused: screened
        .filter((p) => p.method === "framed" && p.violations.length)
        .map((p) => ({ surface: `${p.platform}:${p.post_type}`, why: p.violations })),
      duplicate_openings: dupes,
    },
    retired: made.length > 0,
  });
}

/** Reject an idea — it leaves the lane. No content is made. */
/**
 * REWRITE THE CARDS THAT REACHED THE BOARD BEFORE A WRITER EXISTED.
 *
 * Owner, 2026-08-12: "Fix it so I get content."
 *
 * Wiring the writer fixes every card made from now on. It does nothing for the
 * ~270 drafts already sitting on the board — 45 of them reading "(Caption not
 * written yet — edit before approving.)" and the rest one-line fragments. A
 * board that is 70% placeholder is not a board somebody opens.
 *
 * So this is the same writer and the same guard, pointed backwards. It is an
 * ACTION rather than a migration on purpose: this will be needed again (a brand
 * voice changes, a surface's length floor moves), and a one-off SQL script is a
 * thing nobody can re-run.
 *
 * ── WHERE THE SOURCE COMES FROM, per row ───────────────────────────────────
 * Copy may only be written from material the piece actually has, so the source
 * is recovered in this order and a row with none is SKIPPED, never invented:
 *
 *   1. `generation_meta.idea_id` → the idea's own words in `content_hooks`.
 *      This is every `idea_approve` fan-out row.
 *   2. A finished render behind the card → the cut's own transcript, windowed
 *      to the scenes actually used (`cutCorpus`, shared with
 *      send-render-to-board so both paths read a cut the same way).
 *   3. The existing caption, minus the placeholder line. A fragment IS the
 *      idea's own sentence — expanding it into a real piece for its surface
 *      adds no fact, which is exactly what the guard then verifies.
 *
 * DRAFTS ONLY, and it never schedules, publishes or changes status. The worst
 * case is a draft whose copy got better.
 */
async function actionCopyBackfill(body: Record<string, unknown>) {
  const sb = db();
  const limit = Math.min(Number(body.limit) || 25, 60);
  const brandFilter = body.brand ? String(body.brand) : null;
  const dryRun = body.dry_run === true;

  let q = sb.from("agent_social_posts")
    .select("id, brand, platform, post_type, caption, generation_meta, media_urls, created_by")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(400);
  if (brandFilter) q = q.eq("brand", brandFilter);
  const { data: rows, error } = await q;
  if (error) return json({ error: error.message }, 500);

  // WHICH ROWS NEED IT — the surface's own floor decides, so this cannot drift
  // from what the writer is asked to produce. A row already at length is left
  // alone: rewriting good copy for the sake of a sweep is how a backfill
  // becomes a liability.
  const candidates = (rows || []).filter((r) => {
    const meta = (r.generation_meta || {}) as Record<string, unknown>;
    if ((meta.copy as Record<string, unknown>)?.method === "written") return false;
    const brief = surfaceBrief(r.platform, r.post_type, r.brand);
    if (!brief) return false;
    const cap = String(r.caption || "");
    return cap.includes("Caption not written yet") || cap.trim().length < brief.minChars;
  }).slice(0, limit);

  if (!candidates.length) {
    return json({ action: "copy_backfill", rewritten: 0, note: "no draft is under its surface's length floor" });
  }

  const done: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];

  for (const row of candidates) {
    const meta = (row.generation_meta || {}) as Record<string, unknown>;
    const brief = surfaceBrief(row.platform, row.post_type, row.brand)!;
    let source = "";
    let sourceKind = "";

    // 1. the idea it came from
    const ideaId = String(meta.idea_id || "").trim();
    if (ideaId) {
      const { data: idea } = await sb.from("content_hooks")
        .select("hook_text, text").eq("id", ideaId).maybeSingle();
      source = String(idea?.hook_text || idea?.text || "").trim();
      if (source) sourceKind = "idea";
    }

    // 2. the cut behind it
    if (!source) {
      const url = Array.isArray(row.media_urls) ? String(row.media_urls[0] || "") : "";
      const renderId = String(meta.render_job_id || "").trim();
      let job: Record<string, unknown> | null = null;
      if (renderId) {
        const { data } = await sb.from("video_render_jobs").select("blueprint").eq("id", renderId).maybeSingle();
        job = data;
      } else if (url) {
        const { data } = await sb.from("video_render_jobs")
          .select("blueprint").eq("final_url", url).limit(1).maybeSingle();
        job = data;
      }
      if (job?.blueprint) {
        source = await cutCorpus(sb, job.blueprint);
        if (source) sourceKind = "cut transcript";
      }
    }

    // 3. its own words, placeholder stripped
    if (!source) {
      source = String(row.caption || "").replace(/\(Caption not written yet[^)]*\)/gi, "").trim();
      if (source) sourceKind = "the card's own line";
    }

    if (!source) { skipped.push({ id: row.id, why: "no source material to write from" }); continue; }

    // THE ASK MUST FIT THE MATERIAL — checked BEFORE the model is called, so a
    // brief that could only be satisfied by inventing never gets asked. See
    // `sourceTooThin`: the first real batch wrote nine fabricated anecdotes
    // this way and all nine had to be reverted.
    const tooThin = sourceTooThin(brief, source);
    if (tooThin) {
      skipped.push({ id: row.id, surface: `${row.platform}:${row.post_type}`, why: [tooThin], source: sourceKind });
      continue;
    }

    const written = await writeSurfaceCopy(source, row.brand, [brief]);
    const screened = screenPieceCopy({
      written: written.byKey[`${brief.platform}:${brief.postType}`],
      framed: String(row.caption || ""),
      source,
      brief,
      brandLabel: brandFactsFor(row.brand)?.label,
    });

    if (screened.method === "framed") {
      skipped.push({
        id: row.id, surface: `${row.platform}:${row.post_type}`,
        why: screened.violations, writer_error: written.error,
      });
      continue;
    }

    if (!dryRun) {
      const { error: upErr } = await sb.from("agent_social_posts").update({
        caption: screened.caption,
        updated_at: new Date().toISOString(),
        generation_meta: {
          ...meta,
          copy: {
            method: screened.method,
            source: sourceKind,
            rewritten_at: new Date().toISOString(),
            // The line this replaced, so a human can see what changed and put
            // it back. A backfill nobody can audit is one nobody trusts.
            previous: String(row.caption || "").slice(0, 400),
            brief,
          },
        },
      }).eq("id", row.id);
      if (upErr) { skipped.push({ id: row.id, why: upErr.message }); continue; }
    }

    done.push({
      id: row.id, brand: row.brand, surface: `${row.platform}:${row.post_type}`,
      source: sourceKind, method: screened.method, length: screened.caption.length,
      preview: screened.caption.slice(0, 120),
    });
  }

  return json({
    action: "copy_backfill",
    dry_run: dryRun,
    rewritten: done.length,
    skipped: skipped.length,
    // Named, not counted — a skip with no reason reads as a failure, and with
    // a reason it reads as "this card has nothing to write from", which is
    // actionable.
    details: done,
    skips: skipped,
    remaining_hint: candidates.length === limit ? "limit reached — run again for the next batch" : null,
  });
}

/**
 * CREATIVE PRODUCTION — the product, wired end to end.
 *
 * Owner, 2026-08-13: "I need creatives built I need reels, ads, carousels
 * using our photos screen stills, videos stored in library and googledrive
 * that is the product the creative production output to brandboard that is our
 * biggest rev gen in entire RP marketing software. i thought this was already
 * built end to end must wire as os."
 *
 * It was not built end to end, and the two breaks were invisible from outside:
 * `brand_canva_templates` held ZERO rows so every Canva call died before doing
 * anything, and `autofillText` filled only text so the template's `hero_image`
 * kept its placeholder. Both are fixed; this is the producer that drives them.
 *
 * ── ONE PRODUCER, FOUR FORMATS ─────────────────────────────────────────────
 * static · carousel · ad → the Canva template, filled with a REAL library
 * image and copy the writer produced. reel → the existing video path, because
 * a reel is a cut and `send-render-to-board` already owns that.
 *
 * ── ADDITIVE. ALWAYS. ──────────────────────────────────────────────────────
 * Owner, same message: "DO NOT DELETE ANY WRAPTVWORLD MUSIC VIDEOS, OR
 * WEPRINTWRAPS EXISTING CONTENT that is in BrandBoard."
 *
 * So this function INSERTS a new draft and a new card and does nothing else.
 * There is no delete, and the only UPDATE is `canva-brandboard` writing the
 * design it just made onto the draft THIS run created, matched on that row's
 * own id. Nothing existing is touched. Locked by `tests/creative-plan.test.ts`.
 *
 * ── IT REPORTS ITS STAGES ──────────────────────────────────────────────────
 * Every run returns the stage it reached — sources → copy → design → board —
 * so a failure names the step instead of returning a bare error. That is the
 * "wire as os" shape at this layer: the DesignPro orchestration kernel is
 * frozen (docs/ECOSYSTEM_ORCHESTRATION_NORTH_STAR.md) and marketing is not in
 * its scope, so creative production carries its own stage record rather than
 * editing a locked runner.
 */
/**
 * INSTALLER SERIES — queue one teaching episode onto the Brand Board.
 *
 * Owner, 2026-08-13: "installer education → authority → wholesale print sale."
 *
 * WHAT THIS DOES NOT DO IS THE POINT. It calls no model. The title, the
 * instruction overlay and the CTA are the owner's own words, held verbatim in
 * `_shared/installer-series.ts`; the beats are her structure to the second.
 * A model asked to write "how to wrap a mirror" produces plausible technique,
 * and plausible technique about heat and relief cuts is how an installer ruins
 * a panel. So the only judgement here is WHICH CLIP shows the thing, and that
 * is a ranked match over the library's real install footage.
 *
 * An episode with no matching clip is not built. It reports the SHOT TO FILM,
 * so the gaps in this series read as a shot list rather than a failure.
 *
 * ADDITIVE: inserts a draft, never updates or deletes anything on the board.
 */
async function actionInstallerReel(body: Record<string, unknown>) {
  const sb = db();
  const brand = String(body.brand || "weprintwraps");
  const slug = String(body.slug || "").trim();
  const episode = INSTALLER_SERIES.find((e) => e.slug === slug);
  if (!episode) {
    return json({
      error: slug ? `"${slug}" is not an episode in the installer series` : "slug required",
      episodes: INSTALLER_SERIES.map((e) => ({ slug: e.slug, title: e.title })),
    }, 400);
  }

  // The pool is the library's VIDEO, ranked by what the clip is. Renders are
  // excluded by the same rule creative production uses — a finished cut is not
  // install footage.
  const pool = await nativeMediaList("video", 120);
  const clips: ClipLike[] = pool.map((a) => ({
    id: a.id, url: a.file_url, name: a.name || "",
    tags: a.tags || [], category: a.category || null,
    durationSeconds: a.duration_seconds,
  }));

  const plan = planEpisode(episode, clips);
  if (plan.blocked) {
    return json({
      action: "installer_reel", brand, slug: episode.slug, title: episode.title,
      built: false, why: plan.blocked, plan,
    }, 409);
  }

  // Already queued? The series is a fixed twelve, so the same episode pressed
  // twice must not put two identical cards on the board. Keyed on the slug,
  // with no clock in it — the same discipline as the ad-pack fence.
  const { data: existing } = await sb.from("agent_social_posts")
    .select("id")
    .eq("brand", brand)
    .eq("created_by", "installer_series")
    .contains("generation_meta", { installer_slug: episode.slug })
    .limit(1);
  if (existing?.length) {
    return json({
      action: "installer_reel", brand, slug: episode.slug, title: episode.title,
      built: false, already_queued: true, draft_id: existing[0].id,
      why: "this episode is already on the Brand Board waiting for approval",
      plan,
    });
  }

  const caption = `${episode.title}\n\n${episode.overlay}\n\n${plan.cta}`;
  const { data: draft, error } = await sb.from("agent_social_posts").insert({
    brand,
    platform: "instagram",
    post_type: "reel",
    caption,
    hashtags: [],
    media_urls: plan.clip ? [plan.clip.url] : [],
    scheduled_date: null,
    status: "draft",
    created_by: "installer_series",
    generation_meta: {
      source: "installer_series",
      installer_slug: episode.slug,
      // The words are AUTHORED, not generated. Recorded so a later pass — a
      // copy backfill, a rewrite — can see it must leave them alone.
      authored: true,
      overlays: plan.overlays,
      beats: plan.beats,
      cta: plan.cta,
      clip: plan.clip ? { id: plan.clip.id, url: plan.clip.url, name: plan.clip.name } : null,
      alternates: plan.alternates.map((c) => ({ id: c.id, url: c.url, name: c.name })),
    },
  }).select("id").single();
  if (error) {
    return json({ action: "installer_reel", brand, slug: episode.slug, built: false, why: error.message }, 500);
  }

  return json({
    action: "installer_reel", brand, slug: episode.slug, title: episode.title,
    built: true, draft_id: draft.id, plan,
    note: "On the Brand Board for approval. BrandCast cuts the MP4 to these beats.",
  });
}

/** The series with its footage readiness — what can be cut, and what to film. */
async function actionInstallerSeries(body: Record<string, unknown>) {
  const sb = db();
  const brand = String(body.brand || "weprintwraps");
  const pool = await nativeMediaList("video", 120);
  const clips: ClipLike[] = pool.map((a) => ({
    id: a.id, url: a.file_url, name: a.name || "",
    tags: a.tags || [], category: a.category || null,
    durationSeconds: a.duration_seconds,
  }));

  const { data: queued } = await sb.from("agent_social_posts")
    .select("id, generation_meta")
    .eq("brand", brand)
    .eq("created_by", "installer_series")
    .limit(50);
  const done = new Set(
    ((queued ?? []) as Array<{ generation_meta: Record<string, unknown> | null }>)
      .map((r) => String((r.generation_meta as any)?.installer_slug || "")),
  );

  return json({
    action: "installer_series",
    brand,
    episodes: INSTALLER_SERIES.map((e) => {
      const plan = planEpisode(e, clips);
      return {
        slug: e.slug, title: e.title, overlay: e.overlay,
        queued: done.has(e.slug),
        footage: plan.clip ? { id: plan.clip.id, name: plan.clip.name, url: plan.clip.url } : null,
        alternates: plan.alternates.length,
        blocked: plan.blocked,
      };
    }),
  });
}

async function actionMakeCreative(body: Record<string, unknown>) {
  const sb = db();
  const brand = String(body.brand || "weprintwraps");
  const format = String(body.format || "static").toLowerCase() as CreativeFormat;
  const spec = CREATIVE_SPEC[format];
  const stages: Array<{ stage: string; ok: boolean; detail?: string }> = [];
  const stage = (name: string, ok: boolean, detail?: string) => {
    stages.push({ stage: name, ok, ...(detail ? { detail } : {}) });
    return ok;
  };

  if (!spec) return json({ error: `"${format}" is not a creative this board carries`, stages }, 400);

  // ── STAGE 1: THE MATERIAL ────────────────────────────────────────────────
  const pool = await nativeMediaList(wantsVideo(format) ? "video" : "image", 60);
  // `sourceType` carries the RAW asset_type. Without it a `rendered_video`
  // reads as plain "video" and the reel path builds a new creative out of a
  // cut it already published — 111 such assets are in the library today.
  const sources: CreativeSource[] = pool.map((a) => ({
    id: a.id, url: a.file_url, kind: a.file_type, sourceType: a.asset_type || a.file_type,
    name: a.name || "", tags: a.tags || [], category: a.category || null,
  }));

  const { data: mapped } = await sb.from("brand_canva_templates")
    .select("template_id, reel_template_id").eq("brand", brand).maybeSingle();
  const templateMapped = spec.templateKind === "reel" ? !!mapped?.reel_template_id : !!mapped?.template_id;

  // ── STAGE 2: THE COPY — the writer that already exists ───────────────────
  const seed = String(body.headline || "").trim();
  const brief = surfaceBrief(format === "reel" ? "instagram" : "instagram", spec.postType === "ad" ? "feed" : spec.postType, brand);
  let headline = seed;
  let bodyCopy = String(body.subhead || "").trim();

  if (!headline) {
    // No seed given: take the strongest thing a real customer actually said.
    // Nothing here invents a claim — the same rule the whole copy path holds.
    const quotes = await topCustomerQuotes(sb, 5).catch(() => [] as string[]);
    headline = quotes[0] ? quotes[0].slice(0, 120) : "";
    bodyCopy = bodyCopy || (quotes[1] || "");
  }
  stage("copy", !!headline, headline ? undefined : "no headline given and no customer line available");

  const blocker = creativeBlocker({ format, sources, headline, templateMapped });
  if (blocker) {
    stage("sources", false, blocker);
    return json({ action: "make_creative", brand, format, built: false, why: blocker, stages }, 409);
  }
  const slides = planSlides(sources, format);
  stage("sources", true, `${slides.length} asset${slides.length === 1 ? "" : "s"} selected from the library`);

  // ── STAGE 3: THE DRAFT — a NEW row, never an existing one ────────────────
  const { data: draft, error: draftErr } = await sb.from("agent_social_posts").insert({
    brand,
    platform: "instagram",
    post_type: spec.postType,
    caption: bodyCopy ? `${headline}\n\n${bodyCopy}` : headline,
    hashtags: [],
    media_urls: [],
    scheduled_date: null,
    status: "draft",
    created_by: "creative_production",
    generation_meta: {
      source: "creative_production",
      format,
      aspect: spec.aspect,
      slides: slides.map((s) => ({ id: s.id, url: s.url, name: s.name })),
      brief,
    },
  }).select("id").single();
  if (draftErr) {
    stage("draft", false, draftErr.message);
    return json({ action: "make_creative", brand, format, built: false, why: draftErr.message, stages }, 500);
  }
  stage("draft", true, draft.id);

  // ── STAGE 4: THE DESIGN ──────────────────────────────────────────────────
  // A REEL is a cut, and the video path already owns that end to end. Saying
  // so is more honest than half-building a second video pipeline here.
  if (format === "reel") {
    stage("design", false, "reels are produced by the video renderer — build the cut in BrandCast and it lands on the board automatically");
    return json({
      action: "make_creative", brand, format, built: false, draft_id: draft.id,
      why: "a reel is a rendered cut, not a Canva autofill — the draft is on the board and BrandCast attaches the MP4",
      stages,
    });
  }

  const copyPerSlide = slideCopy(headline, bodyCopy, spec.slides);
  const designs: Array<Record<string, unknown>> = [];
  for (let i = 0; i < slides.length; i++) {
    const { data: made, error: designErr } = await sb.functions.invoke("canva-brandboard", {
      body: {
        action: "design",
        brand,
        post_id: draft.id,
        kind: "image",
        headline: copyPerSlide[i]?.headline || headline,
        subhead: copyPerSlide[i]?.subhead || undefined,
        cta: body.cta ? String(body.cta) : undefined,
        image_url: slides[i].url,
        image_name: slides[i].name,
      },
    });
    const failure = designErr?.message || (made as any)?.error;
    if (failure) {
      stage("design", false, `slide ${i + 1}: ${String(failure).slice(0, 200)}`);
      break;
    }
    designs.push({ slide: i + 1, ...(made as any) });
  }
  if (designs.length) stage("design", true, `${designs.length} slide${designs.length === 1 ? "" : "s"} built`);

  return json({
    action: "make_creative",
    brand,
    format,
    built: designs.length > 0,
    draft_id: draft.id,
    designs,
    // The board card is created by canva-brandboard's own review queue, so
    // the creative arrives where every other piece is approved.
    note: designs.length
      ? "Built from your library and waiting on the Brand Board for approval."
      : "The draft is on the board; the design step did not complete — see stages.",
    stages,
  });
}

async function actionIdeaReject(body: Record<string, unknown>) {
  const sb = db();
  const ideaId = String(body.idea_id || "").trim();
  if (!ideaId) return json({ error: "idea_id required" }, 400);
  const { error } = await sb.from("content_hooks")
    .update({ active: false, updated_at: new Date().toISOString() }).eq("id", ideaId);
  if (error) return json({ error: error.message }, 500);
  return json({ action: "idea_reject", idea_id: ideaId, rejected: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// FOOTAGE-FIRST IDEAS — the lane the customer's own footage proposes
// ═══════════════════════════════════════════════════════════════════════════
//
// Owner, 2026-08-07: "I need to do editing using ai to give us hooks based on
// video uploads and library and drive." And: "I want to use our OpenAI API to
// run fresh hooks, and create narrative based on two things" — footage and
// brand pillars.
//
// The 💡 lane above reads `content_hooks`: strategy hooks written from brand
// doctrine, 534 rows, 525 active. The footage had already produced its own and
// they proposed nothing — so a human approved a claim and the matcher then went
// hunting for a clip to fit it. These three actions invert that: the footage
// speaks first, and approving flows through the EXISTING fan-out
// (`actionIdeaApprove`) so a footage card inherits per-channel hook framing,
// per-shape cuts, the spine and the calendar without a second pipeline.
//
// THE RULES LIVE IN `src/lib/footageIdeas.ts` — pure, no I/O, 59 tests. This
// file deliberately does NOT re-implement the display gates: `footage_ideas`
// returns rows and the client applies the tested module. What IS mirrored here
// is only what protects money and truth — the music exclusion (one SQL clause,
// not a rules copy) and the output grounding check — because a check that runs
// only in the browser protects neither.

/** Mirrors `FOOTAGE_GROUNDING_MIN` in src/lib/footageIdeas.ts. Locked by
 * `tests/footage-ideas-wiring.test.ts`, which fails if the two drift. */
const FOOTAGE_GROUNDING_MIN = 0.25;

/** How many clips one generation run may buy. Mirrors GENERATE_MAX_CLIPS. */
const FOOTAGE_GENERATE_MAX = 8;

const FOOTAGE_STOPWORDS = new Set([
  "the","and","for","are","but","not","you","all","any","can","had","her","was","one","our","out",
  "his","has","him","how","its","new","now","old","see","two","who","did","get","let","put","say",
  "she","too","use","way","that","this","with","from","they","have","what","were","when","your",
  "said","them","then","than","into","just","like","been","more","some","time","very","will","only",
  "over","also","back","after","because","there","their","would","could","about","which","doing",
]);

/** The same stemming shape `contentTerms` uses: lowercase, split on non-word,
 * drop stopwords and anything under 3 characters, then crude suffix strip. */
function footageStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of String(text || "").toLowerCase().split(/[^a-z0-9']+/)) {
    const bare = w.replace(/'/g, "");
    if (bare.length < 3 || FOOTAGE_STOPWORDS.has(bare)) continue;
    out.add(bare.replace(/(ing|ed|es|s)$/, ""));
  }
  return out;
}

/**
 * Check a WRITTEN hook back against the footage it claims to come from.
 *
 * The server-side half of `footageGroundingViolations`. After the model writes
 * is the only moment fabrication can actually be observed, and this must run
 * HERE: a check that runs only in the browser cannot stop a fabricated row from
 * being persisted.
 *
 * `evidence` is the whole corpus — the transcript line AND the visual
 * descriptions of that same instant. A claim may rest on either signal; never
 * on neither.
 */
function footageGrounding(hook: string, evidence: string): string[] {
  const text = String(hook || "").trim();
  const source = String(evidence || "").trim();
  if (!text || !source) return [];          // fails OPEN on missing input
  const lower = source.toLowerCase();
  const out: string[] = [];

  for (const n of [...new Set(text.match(/\d[\d,]*(?:\.\d+)?%?/g) || [])]) {
    const bare = n.replace(/[%,]/g, "");
    if (bare && !lower.includes(bare.toLowerCase())) {
      out.push(`states "${n}" — that figure is nowhere in the footage`);
    }
  }
  for (const q of [...new Set([...text.matchAll(/["“']([^"“”']{6,})["”']/g)].map((m) => m[1]))]) {
    if (!lower.includes(q.toLowerCase().trim())) {
      out.push(`quotes "${q}" — nobody says that in the clip`);
    }
  }
  const said = footageStems(source);
  const terms = [...footageStems(text)];
  if (terms.length >= 4 && said.size) {
    const grounded = terms.filter((t) => said.has(t)).length / terms.length;
    if (grounded < FOOTAGE_GROUNDING_MIN) {
      out.push(`only ${Math.round(grounded * 100)}% of its words appear in the footage — written around the clip, not from it`);
    }
  }
  return out;
}

/** Seconds two moments share. 0 when they do not overlap. */
function footageOverlap(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const as = n(a.start_time), ae = n(a.end_time), bs = n(b.start_time), be = n(b.end_time);
  if (as === null || ae === null || bs === null || be === null) return 0;
  if (![as, ae, bs, be].every(Number.isFinite)) return 0;
  return Math.max(0, Math.min(ae, be) - Math.max(as, bs));
}

/**
 * The pre-spend guard key AND the evidence pointer, in one string.
 *
 * `content_hooks` has no jsonb column, and `source` is already free text, so the
 * clip + timestamp + pillar live there — which makes the "have I bought this
 * already?" check a plain equality lookup rather than a second table. NO CLOCK:
 * re-running the pass tomorrow finds the same key instead of buying the same
 * generation again. A key with a date in it is not a guard, it is a subscription.
 */
function footageHookKey(sourceId: string, pillarSlug: string | null, startTime: unknown): string {
  const t = Number(startTime);
  const at = Number.isFinite(t) ? `@${Math.round(t)}` : "";
  return `footage:${sourceId}${at}:${String(pillarSlug || "none").toLowerCase()}`;
}

/**
 * FOOTAGE MOMENTS, ranked — the raw material for the lane.
 *
 * Two reads, joined in memory rather than in SQL because PostgREST cannot
 * express the time-overlap join and the client needs both halves anyway:
 *
 *   SPEECH — content_moments carrying a verbatim_quote (Whisper).
 *   VISION — content_moments carrying a visual_description (gpt-4o on frames).
 *
 * They are SEPARATE ROWS: production has 3,653 speech rows, 8,017 vision rows
 * and ZERO carrying both. Sending both halves is what lets the client pair them.
 *
 * THE NULL TRAP: Postgres ORDER BY … DESC puts NULLs FIRST, so a plain
 * `.order("hook_score", { ascending: false })` returns the UNSCORED rows ahead
 * of the strong ones — backwards, and it looks like it is working. Only 25 of
 * the 1,530 usable moments carry a score at all, so without `nullsFirst: false`
 * this lane would be 100% unscored rows. Same fix `useBrandCast.ts` carries.
 *
 * Music is excluded in SQL: `media_sources.kind = 'music'` is the house track
 * catalog, Whisper transcribed the lyrics, and they score 10 because lyrics are
 * written to be catchy. 193 of the 218 quoted strong moments in production are
 * song lyrics. Shipping one as "your footage said this" attributes a
 * songwriter's line to a person on camera.
 */
async function actionFootageIdeas(body: Record<string, unknown>) {
  const sb = db();
  const limit = Math.min(Number(body.limit) || 400, 1200);
  const brand = body.brand && String(body.brand) !== "all" ? String(body.brand) : null;

  // The clips this lane may draw from. Music is dropped here, once.
  const srcQ = sb.from("media_sources")
    .select("id, kind, title, filename, storage_url, brands")
    .neq("kind", "music")
    .not("storage_url", "is", null)
    .limit(600);
  const { data: sources, error: srcErr } = await srcQ;
  if (srcErr) return json({ error: srcErr.message }, 500);

  const byId = new Map<string, Record<string, unknown>>();
  for (const s of sources || []) byId.set(String(s.id), s as Record<string, unknown>);
  if (!byId.size) {
    return json({
      action: "footage_ideas", moments: [], music_excluded: 0,
      note: "No parsed clips yet. Upload or parse footage and its moments will propose ideas here.",
    });
  }
  const ids = [...byId.keys()];

  // The music-track lines this lane will never show, counted honestly: moments
  // whose SOURCE is a music row, not "everything we didn't return". A number on
  // screen that is really a subtraction of two unrelated totals is worse than no
  // number, because it looks checked.
  const { data: musicSources } = await sb.from("media_sources")
    .select("id").eq("kind", "music").limit(500);
  const musicIds = (musicSources || []).map((m) => String(m.id));
  const { count: musicMoments } = musicIds.length
    ? await sb.from("content_moments").select("id", { count: "exact", head: true })
        .in("source_id", musicIds).not("verbatim_quote", "is", null)
    : { count: 0 };

  const [{ data: speech }, { data: vision }] = await Promise.all([
    sb.from("content_moments")
      .select("id, source_id, verbatim_quote, hook_score, soundbite_score, broll_score, start_time, end_time, speaker, install_stage")
      .in("source_id", ids)
      .not("verbatim_quote", "is", null)
      // nullsFirst:false on ALL THREE — see the NULL trap note above.
      .order("hook_score", { ascending: false, nullsFirst: false })
      .order("soundbite_score", { ascending: false, nullsFirst: false })
      .order("broll_score", { ascending: false, nullsFirst: false })
      .limit(limit),
    sb.from("content_moments")
      .select("id, source_id, visual_description, hook_score, soundbite_score, broll_score, start_time, end_time, install_stage")
      .in("source_id", ids)
      .not("visual_description", "is", null)
      .order("broll_score", { ascending: false, nullsFirst: false })
      .limit(limit * 2),
  ]);

  // Poster frames, where the library happens to hold one. 13 of the 445 clips
  // that join by URL carry a thumbnail, so this is mostly an honest gap — the
  // card shows the clip's name rather than a fake placeholder image.
  const urls = [...byId.values()].map((s) => String(s.storage_url)).filter(Boolean).slice(0, 400);
  const { data: assets } = await sb.from("agent_media_assets")
    .select("storage_url, thumbnail_url, brand")
    .in("storage_url", urls);
  const thumbByUrl = new Map<string, string>();
  const brandByUrl = new Map<string, string>();
  for (const a of assets || []) {
    if (a.thumbnail_url) thumbByUrl.set(String(a.storage_url), String(a.thumbnail_url));
    if (a.brand) brandByUrl.set(String(a.storage_url), String(a.brand));
  }

  const decorate = (m: Record<string, unknown>) => {
    const s = byId.get(String(m.source_id));
    const url = s ? String(s.storage_url || "") : "";
    return {
      ...m,
      source_kind: s?.kind ?? null,
      source_title: s ? String(s.title || s.filename || "") : null,
      source_url: url || null,
      thumbnail_url: thumbByUrl.get(url) || null,
      source_brands: (s?.brands as string[] | null) || (brandByUrl.get(url) ? [brandByUrl.get(url)] : []),
    };
  };

  let moments = [...(speech || []), ...(vision || [])].map(decorate);

  // Brand filter, when one is asked for. A clip with NO declared brand is kept:
  // most of the library carries none, and dropping them would empty the lane
  // for every brand — an absent label is not a statement that it belongs to
  // somebody else.
  if (brand) {
    moments = moments.filter((m) => {
      const b = (m.source_brands || []).map((x: string) => String(x).toLowerCase().replace(/[^a-z]/g, ""));
      if (!b.length) return true;
      return b.some((x: string) => x.includes(brand.toLowerCase().replace(/[^a-z]/g, "")));
    });
  }

  return json({
    action: "footage_ideas",
    brand,
    moments,
    clips: byId.size,
    // Stated so the lane can say what it excluded before the client's gates
    // even run. A number the user cannot see is a number nobody can check.
    music_excluded: musicMoments || 0,
    note: "Speech and vision moments are separate rows; the client pairs them on time.",
  });
}

/**
 * APPROVE A FOOTAGE CARD → make the content.
 *
 * Mints a `content_hooks` row carrying the footage's OWN words plus its
 * evidence, then hands that id straight to `actionIdeaApprove` — the EXISTING
 * fan-out. That is the whole point: a footage card gets per-channel hook
 * framing (`_shared/idea-hook.ts`), one cut per shape
 * (`_shared/surface-shape.ts`), the narrative spine and the calendar, without a
 * second pipeline that would immediately drift from the first.
 *
 * The clip is passed as `media_url` so the fan-out attaches THE CLIP THE WORDS
 * CAME FROM rather than keyword-searching the library for something that looks
 * related. This is the strongest thing a footage-first lane buys: the footage
 * match is not a guess, it is the provenance.
 */
async function actionFootageApprove(body: Record<string, unknown>) {
  const sb = db();
  const momentId = String(body.moment_id || "").trim();
  if (!momentId) return json({ error: "moment_id required" }, 400);

  const { data: moment, error: mErr } = await sb.from("content_moments")
    .select("id, source_id, verbatim_quote, visual_description, hook_score, soundbite_score, broll_score, start_time, end_time, install_stage")
    .eq("id", momentId).maybeSingle();
  if (mErr) return json({ error: mErr.message }, 500);
  if (!moment) return json({ error: "moment not found" }, 404);

  const { data: source } = await sb.from("media_sources")
    .select("id, kind, title, filename, storage_url").eq("id", moment.source_id).maybeSingle();

  // The music gate, server-side. It runs in the browser too, but a gate that
  // runs only in the browser is not a gate.
  if (String(source?.kind || "").toLowerCase() === "music") {
    return json({ error: "that line is from a music track — it is song lyrics, not somebody speaking on camera" }, 400);
  }

  const quote = String(moment.verbatim_quote || "").trim();
  const seen = String(moment.visual_description || "").trim();
  const text = quote || seen;
  if (!text) return json({ error: "that moment has no transcript line and no visual description" }, 400);

  const brand = String(body.brand || "wraptvworld");
  const pillar = body.pillar_slug ? String(body.pillar_slug) : null;

  // The vision of that same instant, so the row carries BOTH signals as
  // evidence. Bounded to 3 — one speech moment overlaps ~45 vision moments in
  // production and forty frame captions would bury the line somebody said.
  const { data: visionRows } = await sb.from("content_moments")
    .select("id, visual_description, start_time, end_time, broll_score")
    .eq("source_id", moment.source_id).not("visual_description", "is", null).limit(200);
  const overlapping = (visionRows || [])
    .map((v) => ({ v, shared: footageOverlap(moment as Record<string, unknown>, v as Record<string, unknown>) }))
    .filter((x) => x.shared >= 0.25)
    .sort((a, b) => b.shared - a.shared || (Number(b.v.broll_score ?? 0) || 0) - (Number(a.v.broll_score ?? 0) || 0))
    .slice(0, 3)
    .map((x) => String(x.v.visual_description || ""));

  const signals = quote ? (overlapping.length ? "both" : "speech") : "vision";
  const key = footageHookKey(String(moment.source_id), pillar, moment.start_time);

  // PRE-SPEND / PRE-DUPLICATE FENCE. Approving the same card twice must find
  // the existing hook, not mint a second one that fans out all over again.
  const { data: existing } = await sb.from("content_hooks")
    .select("id").eq("source", key).limit(1).maybeSingle();

  let hookId = existing?.id || null;
  if (!hookId) {
    const { data: created, error: hErr } = await sb.from("content_hooks").insert({
      brand,
      hook_text: text,
      text,
      hook_type: `footage_${signals}`,
      pillar_key: pillar,
      pillar_slugs: pillar ? [pillar] : null,
      // EVIDENCE, on the row, in the columns that already exist:
      //   source ................ the clip and the second it starts
      //   approved_language ..... the verbatim line — the exact words that were
      //                           said, which is what makes them approved
      //   required_opening_visual  what was on screen while it was said
      // A hook nobody can trace back to footage cannot be reviewed, and an
      // untraceable hook is how a fabricated one survives.
      source: key,
      approved_language: quote ? [quote] : null,
      required_opening_visual: overlapping[0] || seen || null,
      required_evidence_types: [signals],
      score: Number(moment.hook_score ?? moment.soundbite_score ?? moment.broll_score ?? 0) || 0,
      active: true,
      created_by: null,
    }).select("id").single();
    if (hErr) return json({ error: `could not record the footage hook: ${hErr.message}` }, 500);
    hookId = created.id;
  }

  // ── HAND IT TO THE EXISTING FAN-OUT ──────────────────────────────────────
  // Not a copy of it. `actionIdeaApprove` writes the seven surface drafts, the
  // per-shape cuts, the narrative spine and retires the idea. Passing
  // `media_url` means it attaches THIS clip instead of searching for one.
  const fanned = await actionIdeaApprove({
    idea_id: hookId,
    brand,
    ...(source?.storage_url ? { media_url: String(source.storage_url) } : {}),
  });

  const payload = await fanned.json();
  return json({
    action: "footage_approve",
    moment_id: momentId,
    hook_id: hookId,
    reused_hook: !!existing,
    signals,
    evidence: {
      clip: source?.title || source?.filename || null,
      clip_url: source?.storage_url || null,
      start_time: moment.start_time ?? null,
      end_time: moment.end_time ?? null,
      quote: quote || null,
      visual: overlapping,
    },
    ...payload,
  }, fanned.status);
}

/**
 * GENERATE FRESH HOOKS from footage × brand pillars — OPT-IN, CAPPED, GUARDED.
 *
 * Owner: "I want to use our OpenAI API to run fresh hooks, and create narrative
 * based on two things" — the footage, and the brand's declared strategy.
 *
 * THE RULE, and it is the whole thing: a generated hook may be NEWLY WRITTEN,
 * but every CLAIM in it must be supported by the footage it came from. The model
 * may phrase, compress and angle. It may not introduce a fact, a number, a name,
 * a capability or a customer outcome the footage did not contain. This is not a
 * new rule here — `contentdirectoriq-generate` already states it: "the footage
 * (media_sources + content_moments) is the only truth a script may claim."
 *
 * WHY THIS LIVES HERE AND NOT THERE: `contentdirectoriq-generate` produces
 * SCRIPTS — content_concepts → script_versions → script_lines — keyed on a
 * `content_projects` row (3 exist) and requiring a `sourceMediaId` per run. It
 * has no action that writes `content_hooks`; its `eligible_hooks` action READS
 * that table to filter an already-written library. So it cannot mint the ideas
 * this lane shows without a new action either way, and that file is not this
 * agent's to change. What IS shared is the discipline and the pillar library it
 * reads from — the same `brand_pillars` rows, the same footage-is-the-only-truth
 * rule, and provenance on every row.
 *
 * SPEND CONTROLS, all three required:
 *   OPT-IN   — never runs on page load. A human presses Generate.
 *   CAPPED   — at most FOOTAGE_GENERATE_MAX clips per run, one moment each. A
 *              second hook off the same 12 seconds of speech is the same hook
 *              with different phrasing, and it costs the same.
 *   GUARDED  — the clip × pillar key is checked BEFORE the call, not after.
 *              Same shape as `already_scored` above and `already_designed` in
 *              designs.js. No clock in the key.
 */
async function actionFootageGenerate(body: Record<string, unknown>) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
  const sb = db();

  const brand = String(body.brand || "").trim();
  if (!brand) return json({ error: "brand required — a hook is written to a brand's audience" }, 400);

  const requested = Array.isArray(body.moment_ids) ? body.moment_ids.map(String).filter(Boolean) : [];
  if (!requested.length) return json({ error: "moment_ids required — generation is opt-in, never a sweep" }, 400);
  const momentIds = requested.slice(0, FOOTAGE_GENERATE_MAX);

  // THE PILLARS — the brand's declared strategy, read not invented.
  const { data: pillars } = await sb.from("brand_pillars")
    .select("id, slug, name, description, evidence_guidance")
    .eq("brand", brand).eq("active", true).order("sort_order", { ascending: true });

  if (!pillars?.length) {
    return json({
      action: "footage_generate", brand, generated: [], skipped: [],
      error: `${brand} has no active brand pillars. A hook generated with no declared strategy is doctrine invented on the spot — which is the thing this lane exists to replace. Add pillars in the Brand Pillars library first.`,
    }, 400);
  }

  // Re-read the moments from the DATABASE. The client sends ids, never text —
  // trusting client-supplied "evidence" would let a caller fabricate the very
  // thing the grounding check exists to verify against.
  const { data: moments } = await sb.from("content_moments")
    .select("id, source_id, verbatim_quote, visual_description, hook_score, soundbite_score, broll_score, start_time, end_time")
    .in("id", momentIds);
  if (!moments?.length) return json({ error: "none of those moments exist" }, 404);

  const { data: sources } = await sb.from("media_sources")
    .select("id, kind, title, filename, storage_url")
    .in("id", [...new Set(moments.map((m) => String(m.source_id)))]);
  const srcById = new Map((sources || []).map((s) => [String(s.id), s]));

  const generated: Record<string, unknown>[] = [];
  const skipped: Array<{ moment_id: string; why: string }> = [];

  for (const m of moments) {
    const src = srcById.get(String(m.source_id));

    if (String(src?.kind || "").toLowerCase() === "music") {
      skipped.push({ moment_id: String(m.id), why: "music track — song lyrics, not speech on camera" });
      continue;
    }

    const quote = String(m.verbatim_quote || "").trim();
    const seen = String(m.visual_description || "").trim();
    if (!quote && !seen) {
      skipped.push({ moment_id: String(m.id), why: "no transcript line and no visual description" });
      continue;
    }

    // The vision of the same instant — the join that already existed and was
    // never used. 6,370 speech↔vision pairs overlap in time in production and
    // ZERO rows carry both signals, because they are separate passes writing
    // separate rows. Feeding both is the honest answer to "why can't it use
    // transcribe plus vision".
    const { data: visionRows } = await sb.from("content_moments")
      .select("id, visual_description, start_time, end_time, broll_score")
      .eq("source_id", m.source_id).not("visual_description", "is", null).limit(200);
    const overlapping = (visionRows || [])
      .map((v) => ({ v, shared: footageOverlap(m as Record<string, unknown>, v as Record<string, unknown>) }))
      .filter((x) => x.shared >= 0.25)
      .sort((a, b) => b.shared - a.shared || (Number(b.v.broll_score ?? 0) || 0) - (Number(a.v.broll_score ?? 0) || 0))
      .slice(0, 3)
      .map((x) => String(x.v.visual_description || ""));

    const signals = quote ? (overlapping.length ? "both" : "speech") : "vision";
    const evidence = [quote, seen, ...overlapping].filter(Boolean).join("\n");

    for (const pillar of pillars) {
      const key = footageHookKey(String(m.source_id), String(pillar.slug || pillar.id), m.start_time);

      // ── PRE-SPEND FENCE — BEFORE the call, never after ────────────────────
      const { data: bought } = await sb.from("content_hooks")
        .select("id, hook_text").eq("source", key).limit(1).maybeSingle();
      if (bought) {
        skipped.push({ moment_id: String(m.id), why: `already generated for pillar "${pillar.name}" — not re-buying it` });
        continue;
      }

      const system =
        `You write hooks for ${brand}. A hook is ONE line that makes somebody stop scrolling.\n\n` +
        `THE ONLY TRUTH YOU MAY CLAIM IS THE FOOTAGE BELOW. You may rephrase it, compress it, ` +
        `and angle it toward the brand pillar. You may NOT introduce a fact, a number, a name, a ` +
        `capability, a price, a timescale or a customer outcome that the footage does not contain. ` +
        `If the footage does not support the pillar, say so instead of writing around it — an ` +
        `honest refusal is a correct answer here and a fabricated hook is not.\n\n` +
        `A VISUAL DESCRIPTION LICENSES WHAT IS ON SCREEN, NOT WHAT IT IMPLIES. ` +
        `"a person smiling" grounds "he's smiling"; it does not ground "the customer was satisfied".\n\n` +
        `Return ONLY JSON: {"hook":"<one line, or empty string if the footage cannot honestly ` +
        `carry this pillar>","why":"<one sentence: which words in the footage support it>"}`;

      const user =
        `BRAND PILLAR — ${pillar.name}\n${pillar.description || ""}\n` +
        (pillar.evidence_guidance ? `Evidence this pillar needs: ${pillar.evidence_guidance}\n` : "") +
        `\nFOOTAGE — clip "${src?.title || src?.filename || "untitled"}" at ${m.start_time ?? "?"}s\n` +
        (quote ? `WHAT WAS SAID (verbatim): "${quote}"\n` : "") +
        (seen ? `WHAT WAS ON SCREEN: ${seen}\n` : "") +
        (overlapping.length ? `WHAT WAS ON SCREEN WHILE IT WAS SAID:\n- ${overlapping.join("\n- ")}\n` : "");

      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          // Low, deliberately: a hook that must not invent is not a creative
          // sampling problem. Same reasoning as the temperature-0 panel judges.
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        skipped.push({ moment_id: String(m.id), why: `OpenAI ${res.status}` });
        continue;
      }
      let parsed: { hook?: string; why?: string };
      try { parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
      catch { skipped.push({ moment_id: String(m.id), why: "model returned invalid JSON" }); continue; }

      const hook = String(parsed.hook || "").trim();
      if (!hook) {
        // The model's honest refusal. Recorded as an outcome, not swallowed —
        // "this clip does not support this pillar" is real information.
        skipped.push({ moment_id: String(m.id), why: `the footage does not honestly carry "${pillar.name}"` });
        continue;
      }

      // ── THE GROUNDING CHECK — the only moment fabrication is observable ───
      const violations = footageGrounding(hook, evidence);
      if (violations.length) {
        skipped.push({ moment_id: String(m.id), why: `rejected as ungrounded — ${violations[0]}` });
        continue;
      }

      const { data: row, error: insErr } = await sb.from("content_hooks").insert({
        brand,
        hook_text: hook,
        text: hook,
        hook_type: `footage_generated_${signals}`,
        pillar_key: String(pillar.slug || ""),
        pillar_slugs: pillar.slug ? [String(pillar.slug)] : null,
        source: key,
        // EVIDENCE ON THE ROW — clip, timestamp, the verbatim line, and what was
        // on screen. Without these a generated hook cannot be reviewed, and an
        // unreviewable hook is how a fabricated one survives.
        approved_language: quote ? [quote] : null,
        required_opening_visual: overlapping[0] || seen || null,
        required_evidence_types: [signals],
        score: Number(m.hook_score ?? m.soundbite_score ?? m.broll_score ?? 0) || 0,
        active: true,
      }).select("id").single();
      if (insErr) { skipped.push({ moment_id: String(m.id), why: insErr.message }); continue; }

      generated.push({
        hook_id: row.id, hook, why: String(parsed.why || ""),
        moment_id: String(m.id), source_id: String(m.source_id),
        clip: src?.title || src?.filename || null,
        start_time: m.start_time ?? null, end_time: m.end_time ?? null,
        pillar: pillar.name, pillar_slug: pillar.slug, signals,
        evidence_quote: quote || null, evidence_visual: overlapping,
      });
    }
  }

  return json({
    action: "footage_generate",
    brand,
    generated,
    skipped,
    requested: requested.length,
    capped_at: FOOTAGE_GENERATE_MAX,
    // Never let a cap read as the whole story.
    note: requested.length > FOOTAGE_GENERATE_MAX
      ? `Capped at ${FOOTAGE_GENERATE_MAX} clips per run — ${requested.length - FOOTAGE_GENERATE_MAX} not attempted. Run again to continue.`
      : null,
  });
}

async function actionDirectorQueue() {
  const sb = db();
  const now = new Date();
  const [drafts, campaigns, upcoming, draftTotal, campaignTotal] = await Promise.all([
    // NEWEST FIRST. This was `ascending: true` with a limit of 100, which is a
    // silent truncation pointed the wrong way: 211 drafts existed, the 100
    // OLDEST filled every slot, and the newest thing the Director could show
    // was three weeks old — today's renders and today's Director output were
    // structurally unreachable while an April backlog sat in front of them.
    // A review queue is worked from the top, so the top must be today.
    // The counts on screen were the limits (100 + 50 = the "150 waiting on
    // you"), not the real inventory, which is why nothing looked missing.
    // generation_meta carries `pending_render_job_id` — a creative that is
    // COMPOSING right now. Without it the card looks identical to one nobody
    // has touched, so the operator presses "Make the creative" again and
    // spends a second render for the same file.
    sb.from("agent_social_posts")
      .select("id, brand, platform, post_type, caption, hashtags, media_urls, scheduled_date, engagement, generation_meta, created_by, created_at")
      .eq("status", "draft").order("created_at", { ascending: false }).limit(DIRECTOR_QUEUE_LIMIT),
    sb.from("agent_email_campaigns")
      .select("id, brand, campaign_name, campaign_type, subject_line, preview_text, scheduled_date, created_by, created_at")
      .eq("status", "needs_review").order("created_at", { ascending: false }).limit(DIRECTOR_QUEUE_EMAIL_LIMIT),
    sb.from("agent_social_posts")
      .select("id, brand, platform, post_type, caption, media_urls, scheduled_date, status")
      .in("status", ["approved", "scheduled"])
      .gte("scheduled_date", now.toISOString())
      .order("scheduled_date", { ascending: true }).limit(50),
    // TRUE totals, so the UI can say "showing 200 of 211" instead of printing
    // a limit and calling it a count.
    sb.from("agent_social_posts").select("id", { count: "exact", head: true }).eq("status", "draft"),
    sb.from("agent_email_campaigns").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
  ]);
  if (drafts.error) return json({ error: drafts.error.message }, 500);

  // POSTER FRAMES. A draft's media_urls carries the finished mp4 but nothing
  // carries a still, so the review card rendered an unpostered <video> — a
  // black rectangle, because every cut opens on a dark frame. Reviewers were
  // being asked to approve content they could not see. The renders already
  // have thumbnails (73 of 73 complete jobs do); they were simply never joined
  // back to the post. One query, keyed by the mp4 URL the post points at.
  const posters = new Map<string, string>();
  {
    const { data: rendered } = await sb.from("video_render_jobs")
      .select("final_url, thumbnail_url").eq("status", "complete")
      .not("thumbnail_url", "is", null)
      .order("created_at", { ascending: false }).limit(500);
    for (const r of rendered || []) {
      if (r.final_url && r.thumbnail_url && !posters.has(r.final_url)) {
        posters.set(String(r.final_url), String(r.thumbnail_url));
      }
    }
  }
  const posterFor = (urls: unknown): string | null => {
    const first = Array.isArray(urls) ? String(urls[0] || "") : "";
    return first ? posters.get(first) || null : null;
  };

  const takenCache = new Map<string, string[]>();
  const queue = [];
  for (const p of drafts.data || []) {
    const key = `${p.brand}|${p.platform}`;
    if (!takenCache.has(key)) takenCache.set(key, await takenDates(sb, p.brand, p.platform));
    const proposal = proposeSlot(p.platform, p.brand, now, takenCache.get(key)!);
    // IN FLIGHT. Surfaced as its own field rather than raw metadata so the UI
    // has one thing to read: the render is composing and will attach itself
    // (worker/video-renderer/reattach.js). Cleared by that same pass.
    const meta = (p.generation_meta && typeof p.generation_meta === "object")
      ? p.generation_meta as Record<string, unknown> : {};
    const pendingJob = meta.pending_render_job_id ? String(meta.pending_render_job_id) : null;
    const hasMedia = Array.isArray(p.media_urls) && p.media_urls.filter(Boolean).length > 0;
    queue.push({
      kind: "social_post",
      ...p,
      thumbnail_url: posterFor(p.media_urls),
      building: pendingJob && !hasMedia
        ? { render_job_id: pendingJob, since: meta.pending_render_since ? String(meta.pending_render_since) : null }
        : null,
      proposed_slot: proposal
        ? { id: proposal.slot.id, label: proposal.slot.label, when: proposal.when.toISOString() }
        : null,
    });
  }
  for (const c of campaigns.data || []) {
    queue.push({ kind: "email_campaign", ...c, proposed_slot: null });
  }
  return json({
    action: "director_queue",
    queue,
    scheduled: upcoming.data || [],
    programming: WEEKLY_PROGRAMMING,
    // Honest inventory vs what this response carries. `truncated` is the
    // number the queue is NOT showing — surfaced so a backlog can never again
    // hide today's work behind a silent cap.
    totals: {
      social_drafts: draftTotal.count ?? (drafts.data || []).length,
      email_drafts: campaignTotal.count ?? (campaigns.data || []).length,
      shown_social: (drafts.data || []).length,
      shown_email: (campaigns.data || []).length,
      truncated: Math.max(0, (draftTotal.count ?? 0) - (drafts.data || []).length)
        + Math.max(0, (campaignTotal.count ?? 0) - (campaigns.data || []).length),
    },
  });
}

async function actionDirectorApprove(body: Record<string, unknown>) {
  const sb = db();
  const now = new Date();

  if (body.campaign_id) {
    const { error } = await sb.from("agent_email_campaigns")
      .update({
        status: "approved",
        ...(body.scheduled_date ? { scheduled_date: String(body.scheduled_date) } : {}),
        updated_at: now.toISOString(),
      })
      .eq("id", String(body.campaign_id));
    if (error) return json({ error: error.message }, 500);
    return json({ action: "director_approve", campaign_id: body.campaign_id, status: "approved", note: "next agent run pushes it to Klaviyo as a draft" });
  }

  const postId = String(body.post_id || "");
  if (!postId) return json({ error: "post_id or campaign_id required" }, 400);
  const { data: post, error: getErr } = await sb.from("agent_social_posts")
    .select("id, brand, platform, post_type, caption, engagement, generation_meta, scheduled_date")
    .eq("id", postId).single();
  if (getErr || !post) return json({ error: getErr?.message || "post not found" }, 404);

  // ── THE DOCTRINE GATE ────────────────────────────────────────────────────
  // Approving is the moment a piece becomes something the world will see, so
  // it is the moment the rule bites. Generation is allowed to be wrong — that
  // is what drafts are for.
  //
  // It lives HERE, server-side, rather than in the Director UI, because every
  // cron and agent approval would bypass a UI check — which is exactly how a
  // content standard quietly stops meaning anything.
  //
  // `force: true` is an explicit human override and is RECORDED on the row, so
  // an exception is a decision somebody made rather than a rule that erodes.
  {
    const meta = (post.generation_meta && typeof post.generation_meta === "object")
      ? post.generation_meta as Record<string, unknown> : {};
    const verdict = judgeAtApproval({
      caption: post.caption,
      hook: typeof meta.hook === "string" ? meta.hook : null,
      pillar: pillarFromMeta(meta),
      isPaidAd: String(post.post_type || "").toLowerCase().includes("ad") || meta.is_paid_ad === true,
    });
    if (!verdict.ok && body.force !== true) {
      return json({
        action: "director_approve",
        post_id: postId,
        error: "doctrine_violation",
        reasons: verdict.reasons,
        // Say how to proceed deliberately, rather than leaving a dead end.
        override: "Re-send with force:true to approve anyway — the override is recorded on the post.",
      }, 422);
    }
    if (!verdict.ok && body.force === true) {
      await sb.from("agent_social_posts").update({
        generation_meta: {
          ...meta,
          doctrine_override: true,
          doctrine_override_at: now.toISOString(),
          doctrine_override_reasons: verdict.reasons,
        },
      }).eq("id", postId);
    }
  }

  let when: string;
  let slot: ProgrammingSlot | null = null;
  if (body.scheduled_date) {
    when = new Date(String(body.scheduled_date)).toISOString();
  } else if (post.scheduled_date && new Date(post.scheduled_date) > now) {
    // The draft already carries a future slot (director_plan_week set it).
    when = post.scheduled_date;
  } else {
    const taken = await takenDates(sb, post.brand, post.platform);
    const proposal = proposeSlot(post.platform, post.brand, now, taken);
    slot = proposal?.slot || null;
    // No programming slot for this channel → publish on the next 5-min cron.
    when = (proposal?.when || new Date(now.getTime() + 5 * 60 * 1000)).toISOString();
  }

  const engagement = { ...((post.engagement as Record<string, unknown>) || {}) };
  if (post.platform === "wraptv_site" && !engagement.wtw_show) {
    engagement.wtw_show = slot?.wtwShow || (String(post.post_type).match(/reel|video/) ? "behind-the-install" : "wrap-of-the-week");
  }

  const { error } = await sb.from("agent_social_posts")
    .update({ status: "scheduled", scheduled_date: when, engagement, updated_at: now.toISOString() })
    .eq("id", postId);
  if (error) return json({ error: error.message }, 500);

  await sb.from("agent_content_calendar").insert({
    brand: post.brand, content_type: "social_post", date: when.slice(0, 10),
    title: `${post.post_type || "post"}: ${(post.caption || "").slice(0, 50)}`,
    status: "scheduled", pipeline_table: "agent_social_posts", pipeline_id: postId,
  });
  return json({ action: "director_approve", post_id: postId, status: "scheduled", scheduled_date: when, slot: slot?.label || null });
}

async function actionDirectorReject(body: Record<string, unknown>) {
  const sb = db();
  if (body.campaign_id) {
    const { error } = await sb.from("agent_email_campaigns")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("id", String(body.campaign_id));
    if (error) return json({ error: error.message }, 500);
    return json({ action: "director_reject", campaign_id: body.campaign_id });
  }
  const postId = String(body.post_id || "");
  if (!postId) return json({ error: "post_id or campaign_id required" }, 400);
  const { error } = await sb.from("agent_social_posts")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", postId);
  if (error) return json({ error: error.message }, 500);
  return json({ action: "director_reject", post_id: postId });
}

// Enqueue a render through video-render (reuses its dispatch/kick machinery).
async function enqueueRender(blueprint: Record<string, unknown>, ref: string, captions?: unknown[]) {
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/video-render`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}` },
    body: JSON.stringify({ blueprint, brand: (blueprint.brand as string) || "wraptvworld", source_ref: ref, ...(captions?.length ? { captions } : {}) }),
  });
  const out = await r.json().catch(() => ({}));
  return out?.render_job_id || out?.job_id || null;
}

// ── episode_build — the Story-Edit Engine (editor-os brain) ─────────────────
// One parsed master (media_sources transcript + hook-scored content_moments)
// → the full derivative set in one pass: the LONG-FORM episode EDL
// (documentary rules — Behind Shop Doors doctrine, native audio kept),
// SHORTS (best standalone moments, hook-first), and a PROMO trailer.
// Renders enqueue through video-render (same worker); a rough-cut review
// card lands on the board for Amanda/Trish before anything derives further.
async function actionEpisodeBuild(body: Record<string, unknown>) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
  const sb = db();

  // The material: SHOOT-WIDE by default — a real episode spans many files
  // (interview raws + b-roll). {shoot:"lucid"} gathers every renderable
  // video source matching the shoot/filename; {source_id} pins one file;
  // neither → the newest parsed source.
  let srcQ = sb.from("media_sources")
    .select("id, title, filename, storage_url, shoot, duration_seconds, people, vehicles, brands")
    .eq("kind", "video")
    .not("storage_url", "is", null)
    .order("created_at", { ascending: false });
  const shootKey = String(body.shoot || "").trim().toLowerCase();
  if (body.source_id) srcQ = srcQ.eq("id", String(body.source_id)).limit(1);
  else if (shootKey) srcQ = srcQ.or(`shoot.ilike.%${shootKey}%,filename.ilike.%${shootKey}%`).limit(60);
  else srcQ = srcQ.not("transcript", "is", null).limit(1);
  const { data: sources, error: srcErr } = await srcQ;
  if (srcErr) return json({ error: srcErr.message }, 500);
  if (!sources?.length) return json({ error: "no parsed video sources found — Parse Footage first (transcript + moments are the raw material)" }, 409);
  const src = sources[0];
  const srcById = new Map(sources.map((s) => [String(s.id), s]));

  const { data: moments, error: momErr } = await sb.from("content_moments")
    .select("source_id, start_time, end_time, speaker, verbatim_quote, visual_description, hook_score, soundbite_score, broll_score, install_stage")
    .in("source_id", sources.map((s) => s.id))
    .order("start_time", { ascending: true })
    .limit(150);
  if (momErr) return json({ error: momErr.message }, 500);
  if (!moments || moments.length < 3) {
    return json({ error: `${shootKey || src.title || src.filename} has ${moments?.length || 0} scored moments across ${sources.length} file(s) — parse the shoot fully first` }, 409);
  }

  const momentList = moments.map((m, i) =>
    `${i}. [${(srcById.get(String(m.source_id))?.filename || "clip").slice(0, 24)} ` +
    `${Math.round(Number(m.start_time || 0))}-${Math.round(Number(m.end_time || 0))}s] ` +
    `(hook ${m.hook_score ?? "-"}/10, soundbite ${m.soundbite_score ?? "-"}, broll ${m.broll_score ?? "-"}` +
    `${Number(m.broll_score) >= 8 || Number(m.hook_score) >= 8 ? " ★MONEY SHOT" : ""}` +
    `${m.install_stage ? `, ${m.install_stage}` : ""}) ` +
    `${m.speaker ? `${m.speaker}: ` : ""}${m.verbatim_quote ? `"${String(m.verbatim_quote).slice(0, 160)}"` : ""}` +
    `${m.visual_description ? ` | visual: ${String(m.visual_description).slice(0, 100)}` : ""}`).join("\n");

  const thesis = String(body.thesis || "").trim();
  const system =
    `${EDITOR_IDENTITY}\n\n${LONGFORM_CRAFT}\n\n${SHORTS_CRAFT}\n\n${PROMO_CRAFT}\n\n${TIP_CALLOUTS}\n\n${HOUSE_REFERENCES}\n\n` +
    `You are cutting ONE episode plan from real scored moments. The interview beats carry the STORY; ` +
    `the ★MONEY SHOT visual moments (squeegee pulls, reveals, torch work, drive-bys) are your B-ROLL — ` +
    `lay them over the interview where they illustrate what's being said, and open on the strongest one. ` +
    `Pick moments by index — never invent moments, quotes, or names. Return ONLY the JSON object.`;
  const user =
    `MATERIAL: ${sources.length > 1 ? `${sources.length} files from the "${shootKey || src.shoot || "shoot"}" shoot` : `"${src.title || src.filename}"${src.shoot ? ` (shoot: ${src.shoot})` : ""}`}` +
    `${src.people?.length ? ` — people: ${src.people.join(", ")}` : ""}\n` +
    `${thesis ? `THESIS (from the producer): ${thesis}\n` : ""}\n` +
    `SCORED MOMENTS:\n${momentList}\n\n` +
    `Return JSON:\n` +
    `{"title":"episode title (house formula: transformation arc + intrigue)","thesis":"one sentence",` +
    `"intro_script":"the Behind Shop Doors intro narration (welcome line + shop + premise + 2-3 teased segments, ~20s spoken)",` +
    `"cold_open":<moment index — the strongest 8-20s tease>,` +
    `"chapters":[{"title":"chapter card (wit allowed)","moments":[indexes in story order]}],` +
    `"lower_third":"Name — Shop — Role (only from real given names, else empty)",` +
    `"shorts":[{"moment":<index>,"hook":"overlay hook line","caption":"post caption"}] (2-4 standalone moments),` +
    `"tips":[{"moment":<index>,"text":"TIP: real trade knowledge FROM that moment"}] (2-5, only if the footage teaches),` +
    `"promo":{"moments":[3-5 indexes, escalating],"open_text":"the intrigue line","cta":"Full episode — WrapTVWorld.com"}}`;

  const res = await fetch(OPENAI_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: 0.5, response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: `episode plan ${res.status}: ${JSON.stringify(data).slice(0, 200)}` }, 502);
  let plan: Record<string, unknown>;
  try { plan = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
  catch { return json({ error: "episode plan returned invalid JSON" }, 502); }

  const idx = (n: unknown) => moments[Number(n)] || null;
  const sceneOf = (n: unknown, text?: string, cap = 30) => {
    const m = idx(n);
    if (!m) return null;
    // Each moment renders from ITS OWN source file (shoot-wide EDL).
    const mSrc = srcById.get(String(m.source_id)) || src;
    const start = Number(m.start_time || 0);
    const end = Math.min(Number(m.end_time || start + 6), start + cap);
    return { sceneId: `m${n}`, clipId: String(mSrc.id), clipUrl: mSrc.storage_url, start, end, purpose: "proof", ...(text ? { text, textPosition: "bottom" } : {}) };
  };

  const enqueue = enqueueRender;

  const wants = (k: string) => !Array.isArray(body.outputs) || (body.outputs as string[]).includes(k);
  const jobs: Record<string, unknown> = {};

  if (wants("longform")) {
    const chapters = Array.isArray(plan.chapters) ? plan.chapters as { title?: string; moments?: unknown[] }[] : [];
    const scenes = [];
    const cold = sceneOf(plan.cold_open, undefined, 20);
    if (cold) scenes.push({ ...cold, purpose: "hook" });
    for (const ch of chapters) {
      (ch.moments || []).forEach((n, i) => {
        const s = sceneOf(n, i === 0 ? String(ch.title || "") : undefined, 45);
        if (s) scenes.push(s);
      });
    }
    if (scenes.length >= 3) {
      // Trade TIP callouts as timeline captions: each tip lands at the
      // absolute time its moment starts in the EDL (lower-third, 5s).
      const tipCaptions: { text: string; time: number; duration: number; position: string }[] = [];
      const tips = Array.isArray(plan.tips) ? plan.tips as { moment?: unknown; text?: string }[] : [];
      for (const tip of tips.slice(0, 5)) {
        const sceneId = `m${tip.moment}`;
        let offset = 0;
        let found = false;
        for (const s of scenes) {
          if (s.sceneId === sceneId) { found = true; break; }
          offset += s.end - s.start;
        }
        if (found && tip.text) {
          tipCaptions.push({ text: String(tip.text).slice(0, 90), time: offset + 0.5, duration: 5, position: "bottom" });
        }
      }
      jobs.longform = await enqueue({
        id: `episode_${Date.now()}`, platform: "youtube", format: "youtube",
        aspectRatio: "16:9", source: "episode_build", brand: "wraptvworld",
        title: String(plan.title || src.title || "Behind Shop Doors"),
        keepNativeAudio: true, scenes,
        totalDuration: scenes.reduce((t, s) => t + (s.end - s.start), 0),
        endCard: { duration: 3, text: String(plan.title || "Behind Shop Doors"), cta: "WrapTVWorld.com" },
      }, "episode_longform", tipCaptions);
      jobs.tips = tips.map((t) => t.text).filter(Boolean);
    }
  }

  if (wants("shorts")) {
    const shorts = Array.isArray(plan.shorts) ? plan.shorts as { moment?: unknown; hook?: string; caption?: string }[] : [];
    const ids: unknown[] = [];
    for (const s of shorts.slice(0, 4)) {
      const scene = sceneOf(s.moment, String(s.hook || ""), 44);
      if (!scene) continue;
      ids.push(await enqueue({
        id: `short_${Date.now()}_${ids.length}`, platform: "youtube", format: "short",
        aspectRatio: "9:16", source: "episode_build", brand: "wraptvworld",
        title: String(s.hook || plan.title || "Short"), caption: String(s.caption || ""),
        keepNativeAudio: true, stylePack: "wpw_dark_clean", scenes: [{ ...scene, purpose: "hook" }],
        totalDuration: scene.end - scene.start,
        endCard: { duration: 1.5, text: "Full episode", cta: "WrapTVWorld.com" },
      }, "episode_short"));
    }
    jobs.shorts = ids;
  }

  if (wants("promo")) {
    const promo = (plan.promo || {}) as { moments?: unknown[]; open_text?: string; cta?: string };
    const scenes = (promo.moments || []).map((n, i) =>
      sceneOf(n, i === 0 ? String(promo.open_text || "") : undefined, 8)).filter(Boolean);
    if (scenes.length >= 2) {
      jobs.promo = await enqueue({
        id: `promo_${Date.now()}`, platform: "instagram", format: "reel",
        aspectRatio: "9:16", source: "episode_build", brand: "wraptvworld",
        title: `Promo: ${plan.title || src.title || "episode"}`,
        keepNativeAudio: true, stylePack: "wpw_dark_clean", scenes,
        totalDuration: scenes.reduce((t, s) => t + ((s as { end: number; start: number }).end - (s as { end: number; start: number }).start), 0),
        endCard: { duration: 2, text: String(plan.title || "New episode"), cta: String(promo.cta || "Full episode — WrapTVWorld.com") },
      }, "episode_promo");
    }
  }

  // Rough-cut review card — the human gate (BSD doctrine: review before derive).
  const chapterLines = (Array.isArray(plan.chapters) ? plan.chapters as { title?: string; moments?: unknown[] }[] : [])
    .map((c, i) => `${i + 1}. ${c.title} (${(c.moments || []).length} moments)`).join("\n");
  await sb.from("slack_agent_tasks").insert({
    brand: "wraptvworld", task_type: "video_review", status: "pending", priority: "high",
    assigned_to: "amanda",
    title: `EPISODE ROUGH CUT: ${String(plan.title || src.title || "").slice(0, 70)}`,
    description:
      `Story-Edit Engine cut from master "${src.title || src.filename}".\n\n` +
      `Thesis: ${plan.thesis || thesis || "—"}\n\n` +
      `${plan.intro_script ? `INTRO NARRATION (record this VO for the final cut):\n"${plan.intro_script}"\n\n` : ""}` +
      `Chapters:\n${chapterLines}\n\n` +
      `Derivatives queued: ${Array.isArray(jobs.shorts) ? (jobs.shorts as unknown[]).length : 0} shorts, ` +
      `${jobs.promo ? "1 promo" : "no promo"}.\n\n` +
      `Review the rough renders in Video Studio → Renders. Reply with notes ` +
      `("lose the second tangent, more install b-roll in act 2") and re-run episode_build with a thesis.`,
    created_by: "content-director",
    metadata: { source: "episode_build", source_id: src.id, plan, jobs },
  });

  return json({ action: "episode_build", master: src.title || src.filename, title: plan.title, thesis: plan.thesis, chapters: plan.chapters, jobs });
}

// ── extract_content — the Director mines a saved transcript cut per brand ────
// The gold from transcript_cut is a set of real quotes. This has the Director
// read them, pick the strongest, and assign EACH to the brand it serves best
// (business-growth line → WePrintWraps; craft/story → Ink & Edge; hype/culture
// → WrapTVWorld; tool/design → DesignProAI), then draft a quote piece per
// brand into the Director queue — a reel cut from that line's own clip.
const EXTRACT_BRANDS = ["weprintwraps", "restylepro", "designproai", "wraptvworld", "inkandedge", "thewrap"];
async function actionExtractContent(body: Record<string, unknown>) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
  const sb = db();
  let exQ = sb.from("content_extracts").select("id, shoot, title, thesis, lines").order("created_at", { ascending: false }).limit(1);
  if (body.extract_id) exQ = exQ.eq("id", String(body.extract_id));
  const { data: exs } = await exQ;
  const ex = exs?.[0] as { id: string; shoot: string; title: string; thesis: string; lines: Record<string, unknown>[] } | undefined;
  if (!ex || !Array.isArray(ex.lines) || !ex.lines.length) return json({ error: "no saved transcript cut found — run transcript_cut first" }, 409);

  const quoteList = ex.lines.map((l, i) => `${i}. ${l.speaker ? `${l.speaker}: ` : ""}"${String(l.line).slice(0, 200)}"`).join("\n");
  const res = await fetch(OPENAI_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: 0.5, response_format: { type: "json_object" },
      messages: [
        { role: "system", content:
          `You are the Content Director mining an interview for cross-brand content. Each quote below is REAL ` +
          `(never edit the words). Pick the strongest quotes and assign EACH to the ONE brand it serves best:\n` +
          `- weprintwraps: business growth, print/production, shop operations\n` +
          `- restylepro / designproai: design, tools, the tech that helps shops\n` +
          `- wraptvworld: hype, culture, personality, transformation moments\n` +
          `- inkandedge: craft, story, the human/editorial angle\n` +
          `- thewrap: an industry-insight line for the newsletter\n` +
          `Write a short brand-voiced caption AROUND each quote (the quote stays verbatim). Return ONLY JSON.` },
        { role: "user", content:
          `EPISODE: ${ex.title}\nTHESIS: ${ex.thesis}\n\nQUOTES:\n${quoteList}\n\n` +
          `Return {"picks":[{"quote_index":<i>,"brand":"weprintwraps|restylepro|designproai|wraptvworld|inkandedge|thewrap",` +
          `"caption":"brand-voiced caption that features the verbatim quote","format":"reel|static"}]} — 4-8 picks, spread across brands.` },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: `extract ${res.status}: ${JSON.stringify(data).slice(0, 200)}` }, 502);
  let out: { picks?: Record<string, unknown>[] };
  try { out = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
  catch { return json({ error: "extract returned invalid JSON" }, 502); }

  const created: Record<string, unknown>[] = [];
  for (const p of out.picks || []) {
    const line = ex.lines[Number(p.quote_index)];
    const brand = EXTRACT_BRANDS.includes(String(p.brand)) ? String(p.brand) : "wraptvworld";
    if (!line) continue;
    const clipUrl = String(line.clipUrl || "");
    const isReel = p.format !== "static" && clipUrl;
    // A reel = the quote's own clip segment; a static = a quote card render.
    let mediaUrl = clipUrl;
    if (!isReel && clipUrl) {
      const jobId = await enqueueRender({
        id: `extract_static_${Date.now()}_${created.length}`, kind: "frame_grab", aspectRatio: "4:5",
        platform: "instagram", format: "static", source: "extract_content", brand,
        headline: String(line.line).slice(0, 80), stylePack: "wpw_dark_clean",
        scenes: [{ sceneId: "q0", clipUrl, start: Number(line.in || 0) + 1 }],
      }, "extract_static");
      created.push({ brand, kind: "static_render", render_job_id: jobId, quote: String(line.line).slice(0, 80) });
      continue;
    }
    const { data: row, error } = await sb.from("agent_social_posts").insert({
      brand, platform: brand === "wraptvworld" ? "wraptv_site" : "instagram",
      post_type: isReel ? "reel" : "feed",
      caption: String(p.caption || `"${String(line.line).slice(0, 180)}"`),
      hashtags: ["#wraptvworld", "#wrapculture", "#behindshopdoors"],
      media_urls: mediaUrl ? [mediaUrl] : [],
      status: "draft", created_by: "content-director",
      engagement: { extract_id: ex.id, quote: String(line.line).slice(0, 200), ...(brand === "wraptvworld" ? { wtw_show: "behind-shop-doors", wtw_title: ex.title } : {}) },
    }).select("id").single();
    if (!error && row) created.push({ post_id: row.id, brand, kind: "draft", quote: String(line.line).slice(0, 80) });
  }
  await sb.from("content_extracts").update({ status: "extracted" }).eq("id", ex.id);
  return json({ action: "extract_content", extract_id: ex.id, episode: ex.title, created });
}

// ── episode_atomize — doctrine step 3: atomize the FINISHED master ──────────
// Runs AFTER the rough cut is approved. Takes the latest episode review card
// (or an explicit card_id), finds the completed renders, and builds the full
// cross-channel promotion pack — every piece promotes the CHANNEL, the
// FEATURED SHOP, WePrintWraps, and The Wrap Institute:
//   • reels/promo → agent_social_posts drafts (Director queue) with the
//     credit block + a WrapTVWorld-site teaser for the rotation
//   • statics → search + polaroid render jobs cut from the master
//   • Ink & Edge → a magazine feature draft (seo_blog_posts, draft)
//   • The Wrap → automatic: published pieces flow into the Tuesday roundup
async function actionEpisodeAtomize(body: Record<string, unknown>) {
  const sb = db();
  let cardQ = sb.from("slack_agent_tasks")
    .select("id, title, metadata, created_at")
    .eq("task_type", "video_review")
    .order("created_at", { ascending: false })
    .limit(1);
  if (body.card_id) cardQ = cardQ.eq("id", String(body.card_id));
  const { data: cards } = await cardQ;
  const card = cards?.[0] as { id: string; metadata?: Record<string, unknown> } | undefined;
  const plan = (card?.metadata?.plan || null) as Record<string, unknown> | null;
  const jobs = (card?.metadata?.jobs || {}) as Record<string, unknown>;
  if (!card || !plan) return json({ error: "no episode review card found — run episode_build first" }, 409);

  const ids = [jobs.longform, ...(Array.isArray(jobs.shorts) ? jobs.shorts : []), jobs.promo]
    .filter(Boolean).map(String);
  const { data: renders } = await sb.from("video_render_jobs")
    .select("id, status, final_url, thumbnail_url, blueprint").in("id", ids);
  const done = (renders || []).filter((r: { status: string; final_url: string | null }) => r.status === "complete" && r.final_url);
  if (!done.length) return json({ error: "no completed renders yet — atomize after the rough cut is approved and rendered" }, 409);

  const episodeTitle = String(plan.title || "New episode");
  const shop = String(body.shop || (card.metadata?.shop as string) || "").trim();
  const shopHandle = String(body.shop_handle || "").trim();
  const creditBlock = [
    `🎬 Full episode → WrapTVWorld.com`,
    shop ? `Featuring ${shop}${shopHandle ? ` (${shopHandle})` : ""}` : null,
    `Printed with @weprintwraps`,
    `Learn the craft → The Wrap Institute`,
  ].filter(Boolean).join("\n");
  const tags = ["#wraptvworld", "#wrapculture", "#vehiclewrap", "#weprintwraps", "#wrapinstitute", "#behindshopdoors"];

  const created: Record<string, unknown>[] = [];
  let sitePosted = false;
  for (const r of done as { id: string; final_url: string; blueprint?: Record<string, unknown> }[]) {
    const bp = r.blueprint || {};
    if (bp.format === "youtube") continue; // the master uploads to YouTube with its package
    const caption = `${String(bp.caption || bp.title || episodeTitle)}\n\n${creditBlock}`;
    const { data: row, error } = await sb.from("agent_social_posts").insert({
      brand: "wraptvworld", platform: "instagram", post_type: "reel",
      caption, hashtags: tags, media_urls: [r.final_url],
      status: "draft", created_by: "content-director",
      engagement: { episode_title: episodeTitle, atomized_from: r.id },
    }).select("id").single();
    if (!error && row) created.push({ post_id: row.id, kind: "reel", render: r.id });

    // One teaser also goes to the site rotation (the promo when present).
    if (!sitePosted) {
      sitePosted = true;
      const { data: siteRow } = await sb.from("agent_social_posts").insert({
        brand: "wraptvworld", platform: "wraptv_site", post_type: "reel",
        caption: `${episodeTitle}\n\n${creditBlock}`, hashtags: tags, media_urls: [r.final_url],
        status: "draft", created_by: "content-director",
        engagement: { wtw_show: "behind-shop-doors", wtw_title: episodeTitle, wtw_credit: shop || null, episode_title: episodeTitle },
      }).select("id").single();
      if (siteRow) created.push({ post_id: siteRow.id, kind: "site_teaser", render: r.id });
    }
  }

  // Statics cut from the master (search-bar quote + polaroid).
  const sourceId = String(card.metadata?.source_id || "");
  if (sourceId) {
    const { data: srcRow } = await sb.from("media_sources").select("id, storage_url").eq("id", sourceId).maybeSingle();
    if (srcRow?.storage_url) {
      const coldStart = 0;
      for (const [layout, headline] of [["search", episodeTitle], ["polaroid", String(plan.thesis || episodeTitle)]] as const) {
        const jobId = await enqueueRender({
          id: `atomize_${layout}_${Date.now()}`, kind: "static_post", layout,
          platform: "instagram", aspectRatio: "9:16", format: "static",
          source: "episode_atomize", brand: "wraptvworld",
          title: `${episodeTitle} — ${layout}`, headline,
          suggestions: layout === "search" ? [String(plan.thesis || ""), "watch the full episode", "wraptvworld.com"].filter(Boolean) : undefined,
          footer: "@wraptvworld", siteUrl: "wraptvworld.com",
          scenes: [{ sceneId: "static0", clipId: sourceId, clipUrl: srcRow.storage_url, start: coldStart, end: coldStart + 2, purpose: "hook" }],
        }, "episode_atomize_static");
        created.push({ render_job_id: jobId, kind: `static_${layout}` });
      }
    }
  }

  // Ink & Edge magazine feature draft (editorial voice, real material only).
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  let inkDraft: unknown = null;
  if (openaiKey) {
    try {
      const chapters = Array.isArray(plan.chapters) ? (plan.chapters as { title?: string }[]).map((c) => c.title).filter(Boolean).join(" · ") : "";
      const tips = Array.isArray(jobs.tips) ? (jobs.tips as string[]).join("\n") : "";
      const res = await fetch(OPENAI_URL, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: OPENAI_MODEL, temperature: 0.6, response_format: { type: "json_object" },
          messages: [
            { role: "system", content:
              `You write magazine features as strict JSON. Only use the real material given — ` +
              `never invent quotes, names, or numbers. Return ONLY the JSON object.\n\n${await loadBrandBlock("InkAndEdge")}` },
            { role: "user", content:
              `Write the Ink & Edge feature draft for this WrapTVWorld episode.\n` +
              `Episode: ${episodeTitle}\nThesis: ${plan.thesis || ""}\n` +
              `${shop ? `Featured shop: ${shop}\n` : ""}Chapters: ${chapters}\n` +
              `Trade tips from the footage:\n${tips}\n\n` +
              `Return {"title":"...","excerpt":"1-2 sentences","body_html":"the feature as simple HTML ` +
              `(h2 sections, p paragraphs), ending with 'Watch the full episode at WrapTVWorld.com.'",` +
              `"keywords":["..."]}` },
          ],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const b = JSON.parse(data.choices?.[0]?.message?.content || "{}");
        if (b.title && b.body_html) {
          const { data: conn } = await sb.from("seo_wp_connections")
            .select("shop_id, site_url").ilike("site_url", "%inkandedge%").limit(1).maybeSingle();
          const shopId = conn?.shop_id
            ?? (await sb.from("seo_wp_connections").select("shop_id").limit(1).maybeSingle()).data?.shop_id;
          if (shopId) {
            const slug = String(b.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
            const { data: post } = await sb.from("seo_blog_posts").insert({
              shop_id: shopId, title: String(b.title).slice(0, 200), slug,
              excerpt: String(b.excerpt || "").slice(0, 500), body_html: String(b.body_html),
              meta_title: String(b.title).slice(0, 200), meta_description: String(b.excerpt || "").slice(0, 160),
              keywords: Array.isArray(b.keywords) ? b.keywords.slice(0, 10) : [],
              status: "draft", author_name: "Ink & Edge (AI draft)",
            }).select("id").single();
            inkDraft = post?.id || null;
            if (post) created.push({ blog_post_id: post.id, kind: "inkandedge_feature" });
          }
        }
      }
    } catch (_) { /* editorial draft is additive */ }
  }

  return json({
    action: "episode_atomize",
    episode: episodeTitle,
    created,
    inkandedge_feature: inkDraft,
    newsletter: "automatic — pieces published this week appear in The Wrap's Tuesday roundup",
    note: "reel + site-teaser drafts are in the Content Director queue; approve to schedule + publish",
  });
}

// ── newsletter_roundup — The Wrap (6th brand): the weekly Tuesday digest ─────
// Rounds up the REAL content the ecosystem shipped this week (posted social
// posts, WrapTVWorld site entries, fresh renders) into an agent_email_campaigns
// row (brand 'thewrap', needs_review). The Director approves it like anything
// else; the daily agent run pushes approved campaigns to Klaviyo as drafts.
async function actionNewsletterRoundup(body: Record<string, unknown>) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
  const sb = db();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [posted, wtv, renders] = await Promise.all([
    sb.from("agent_social_posts")
      .select("brand, platform, post_type, caption, posted_date")
      .eq("status", "posted").gte("posted_date", since)
      .order("posted_date", { ascending: false }).limit(15),
    sb.from("wraptv_site_content")
      .select("show_slug, title, caption, credit, published_at")
      .gte("published_at", since)
      .order("published_at", { ascending: false }).limit(10),
    sb.from("agent_media_assets")
      .select("brand, title, asset_type, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false }).limit(10),
  ]);

  const items: string[] = [];
  for (const p of posted.data || []) {
    items.push(`[social · ${p.brand} · ${p.platform}] ${(p.caption || "").slice(0, 140)}`);
  }
  for (const e of wtv.data || []) {
    items.push(`[wraptv · ${e.show_slug}] ${e.title || (e.caption || "").slice(0, 100)}${e.credit ? ` — credit: ${e.credit}` : ""}`);
  }
  for (const r of renders.data || []) {
    items.push(`[new render · ${r.brand}] ${r.title || r.asset_type}`);
  }
  if (!items.length) {
    return json({ error: "nothing shipped in the last 7 days — the roundup only rounds up real content" }, 409);
  }

  const brandBlock = await loadBrandBlock("TheWrap");
  const res = await fetch(OPENAI_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: 0.6, response_format: { type: "json_object" },
      messages: [
        { role: "system", content:
          `You write The Wrap, the industry's weekly email digest, as strict JSON. ` +
          `ONLY round up the real items provided — never invent content, stats, or prices. ` +
          `Return ONLY the JSON object.\n\n${brandBlock}` },
        { role: "user", content:
          `Week ending ${new Date().toISOString().slice(0, 10)}.\n\n` +
          `REAL items that shipped this week:\n${items.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\n` +
          `Write this week's issue. Return JSON:\n` +
          `{"subject":"<=6 words","preview":"one sentence","body_text":"the full plain-text issue",` +
          `"body_html":"the same issue as simple email-safe HTML (inline styles, white bg, dark text, ` +
          `one accent color #F97316 for section headers/links, sections: intro / This Week in Wrap / ` +
          `Watch / From the Shops / one CTA)"}` },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: `roundup generation ${res.status}: ${JSON.stringify(data).slice(0, 200)}` }, 502);
  let issue: Record<string, string>;
  try { issue = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
  catch { return json({ error: "roundup generation returned invalid JSON" }, 502); }

  const { data: row, error } = await sb.from("agent_email_campaigns").insert({
    brand: "thewrap",
    campaign_name: `The Wrap — week of ${new Date().toISOString().slice(0, 10)}`,
    campaign_type: "newsletter",
    subject_line: issue.subject || "This week in wrap",
    preview_text: issue.preview || "",
    body_text: issue.body_text || "",
    body_html: issue.body_html || "",
    list_segment: String(body.list_segment || "newsletter"),
    status: "needs_review",
    scheduled_date: body.scheduled_date ? String(body.scheduled_date) : null,
    created_by: "content-director",
  }).select("id").single();
  if (error) return json({ error: error.message }, 500);
  return json({ action: "newsletter_roundup", campaign_id: row.id, subject: issue.subject, items: items.length });
}

async function actionDirectorPlanWeek(body: Record<string, unknown>) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
  const sb = db();
  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

  // Which programming slots inside the next 7 days are still unfilled?
  const open: { slot: ProgrammingSlot; when: Date }[] = [];
  for (const slot of WEEKLY_PROGRAMMING) {
    if (slot.platform === "email") continue; // the weekly roundup fills this one
    const when = nextOccurrence(slot, now);
    if (when > horizon) continue;
    const { data: existing } = await sb.from("agent_social_posts")
      .select("id")
      .eq("brand", slot.brand).eq("platform", slot.platform)
      .in("status", ["draft", "approved", "scheduled"])
      .gte("scheduled_date", new Date(when.getTime() - 30 * 60 * 1000).toISOString())
      .lte("scheduled_date", new Date(when.getTime() + 30 * 60 * 1000).toISOString())
      .limit(1);
    if (!existing?.length) open.push({ slot, when });
  }
  if (!open.length) return json({ action: "director_plan_week", created: [], note: "every programming slot in the next 7 days is already filled" });

  const assets = await nativeMediaList("any", 30);
  if (!assets.length) return json({ error: "no usable media in the library — hydrate clips (drive-sync) or render in Video Studio first" }, 409);
  const mediaList = assets.map((a, i) =>
    `${i}. [${a.file_type}${a.duration_seconds ? ` ${Math.round(a.duration_seconds)}s` : ""}] ${a.name || a.id} ` +
    `${a.category ? `(${a.category})` : ""} tags: ${(a.tags || []).slice(0, 6).join(", ") || "none"}`).join("\n");
  // ── THE SPOTLIGHT'S EPISODE NUMBER IS COUNTED, NOT WRITTEN ───────────────
  //
  // The brief used to carry "collectible, numbered energy ('Spotlight 004')"
  // as an example. The model copied the example: the spotlights of 24 Jul,
  // 26 Jul, 2 Aug, 6 Aug and 8 Aug are ALL "Spotlight 004". So the number now
  // comes from the series' own history and is handed over as a fact.
  //
  // Computed ONCE for the whole plan, not per post — one episode cross-posted
  // to Instagram, Facebook and The Feed is the same episode, and giving those
  // three different numbers would break the series in the other direction.
  let spotlightEpisode = 0;
  if (open.some((o) => o.slot.contentType === "product_spotlight")) {
    const { data: prior } = await sb.from("agent_social_posts")
      .select("caption").eq("brand", "weprintwraps")
      .ilike("caption", "Spotlight %").limit(400);
    let highest = 0;
    for (const row of prior || []) {
      const m = String(row.caption || "").match(/^\s*Spotlight\s+0*(\d+)/i);
      if (m) highest = Math.max(highest, Number(m[1]) || 0);
    }
    spotlightEpisode = highest + 1;
  }

  const slotList = open.map((o, i) => {
    const line = `${i}. [${o.slot.id}] ${o.slot.label} — brand ${o.slot.brand} — ${CONTENT_TYPE_BRIEF[o.slot.contentType]}`;
    if (o.slot.contentType !== "product_spotlight" || !spotlightEpisode) return line;
    const ep = String(spotlightEpisode).padStart(3, "0");
    return `${line}\n   EPISODE NUMBER: this one is "Spotlight ${ep}". Open with exactly that. Do not write any other number.`;
  }).join("\n");

  // One call plans the whole week: each open slot gets an asset + caption in
  // that slot's brand voice (brand blocks for every brand in the plan).
  const brandsInPlan = [...new Set(open.map((o) => o.slot.brand))];
  const brandBlocks = (await Promise.all(brandsInPlan.map((b) => loadBrandBlock(brandOsName(b))))).join("\n\n---\n\n");
  const res = await fetch(OPENAI_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: 0.6, response_format: { type: "json_object" },
      messages: [
        { role: "system", content:
          `You are the Content Director filling this week's programming grid with finished, ` +
          `publish-ready posts. Rules: hook in the first line, no invented statistics or prices, ` +
          `one CTA max, 3-8 hashtags, video assets suit reels/demo slots, images suit static slots. ` +
          `NEVER write a quotation and attribute it to a person or a role — no "…" - Founder, no ` +
          `customer testimonial, no words in anybody's mouth. NEVER state how long a wrap, print or ` +
          `film lasts, in any form. No ad-speak ("call now", "limited time", "free quote"). ` +
          `Write each post in its slot's brand voice. Return ONLY the JSON object.\n\n${brandBlocks}` },
        { role: "user", content:
          `Today: ${now.toISOString()}\n\nOPEN PROGRAMMING SLOTS:\n${slotList}\n\n` +
          `REAL media assets (pick by index — never invent media, use each asset at most once):\n${mediaList}\n\n` +
          `Return {"posts":[{"slot_index":0,"media_index":0,"caption":"...","hashtags":["..."],"title":"short label"}]} ` +
          `— exactly one post per open slot.` },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: `plan generation ${res.status}: ${JSON.stringify(data).slice(0, 200)}` }, 502);
  let plan: { posts?: Record<string, unknown>[] };
  try { plan = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
  catch { return json({ error: "plan generation returned invalid JSON" }, 502); }

  // The Tuesday email slot: generate The Wrap weekly roundup if this week's
  // issue doesn't exist yet (any thewrap campaign created in the last 7 days).
  let roundup: unknown = null;
  const emailSlot = WEEKLY_PROGRAMMING.find((s) => s.platform === "email");
  if (emailSlot) {
    const emailWhen = nextOccurrence(emailSlot, now);
    if (emailWhen <= horizon) {
      const { data: existing } = await sb.from("agent_email_campaigns")
        .select("id").eq("brand", "thewrap")
        .in("status", ["needs_review", "approved"])
        .gte("created_at", new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString())
        .limit(1);
      if (!existing?.length) {
        try {
          const r = await actionNewsletterRoundup({ scheduled_date: emailWhen.toISOString() });
          roundup = await r.json();
        } catch (e) {
          roundup = { error: String(e).slice(0, 200) };
        }
      }
    }
  }

  const created: Record<string, unknown>[] = [];
  for (const p of plan.posts || []) {
    const o = open[Number(p.slot_index)];
    const asset = assets[Number(p.media_index)];
    if (!o || !asset) continue;
    const postType = asset.file_type === "video" ? "reel" : "feed";

    // A SLOT MAY GO EMPTY. IT MAY NOT GO OUT INVENTED.
    //
    // Live on 2026-08-12 at 13:00Z this planner filled three channels with
    // `"When a customer walks into your shop…" - Founder, RestyleProAI`. The
    // prompt above already banned invented statistics and prices; it said
    // nothing about invented TESTIMONY, and a fabricated quote attributed to a
    // named role is worse than a fabricated number.
    //
    // Scope "hard" only — this copy is legitimately written from the brand's
    // whole voice document rather than from one idea, so the full grounding
    // check would refuse true sentences. Lifespan, ad-speak and put-words-in-
    // a-mouth cannot be true sentences at any corpus size.
    const assetText = `${asset.name || ""} ${(asset.tags || []).join(" ")} ${asset.category || ""} ${asset.file_url || ""}`;
    const refused = pieceCopyViolations(
      String(p.caption || ""),
      `${brandBlocks}\n${assetText}`,
      { scope: "hard" },
    );

    // THE PICTURE MUST BE OF THE THING THE COPY IS ABOUT.
    //
    // Live on the Brand Board, 2026-08-08: "Spotlight 004: Avery MPI 1105
    // Film. Shops pick it for its durability and vibrant finish." attached to
    // a photograph of a fire-department door decal. Every word was true and
    // the picture was of something else, which is a harder thing to catch than
    // a false sentence and reads worse to a buyer than either.
    //
    // Only fires when the caption names a SPECIFIC product and nothing about
    // the asset mentions it — an untagged asset that happens to show the right
    // thing still passes. See `spotlightAssetMismatch`.
    if (o.slot.contentType === "product_spotlight") {
      const mismatch = spotlightAssetMismatch(p.caption, assetText);
      if (mismatch) refused.push(mismatch);
    }

    if (refused.length) {
      created.push({ slot: o.slot.id, label: o.slot.label, refused });
      continue;
    }

    const engagement: Record<string, unknown> = { director_slot: o.slot.id };
    if (o.slot.wtwShow) engagement.wtw_show = o.slot.wtwShow;
    const { data: row, error } = await sb.from("agent_social_posts").insert({
      brand: o.slot.brand, platform: o.slot.platform, post_type: postType,
      caption: String(p.caption || ""),
      hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
      media_urls: [asset.file_url],
      scheduled_date: o.when.toISOString(),
      status: "draft", created_by: "content-director", engagement,
    }).select("id").single();
    if (error) { created.push({ slot: o.slot.id, error: error.message }); continue; }
    created.push({ post_id: row.id, slot: o.slot.id, label: o.slot.label, when: o.when.toISOString(), media: asset.name || asset.id });
  }
  return json({ action: "director_plan_week", created, roundup, note: "drafts land in the Director queue — approving keeps the slot time and schedules them" });
}

// ── shot_list_idea — turn a dictated/typed idea into a structured shot ──────
// The Shot List's "Give the Director an idea" box. A person types (or
// dictates, via the browser keyboard's own mic button — no custom speech
// code needed) a rough idea; this parses it into the same structured fields
// a human would fill in by hand and inserts it straight onto the board.
async function actionShotListIdea(body: Record<string, unknown>) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
  const idea = String(body.idea || "").trim();
  if (!idea) return json({ error: "idea text required" }, 400);
  const brandHint = String(body.brand || "wraptvworld");
  const sb = db();

  const brandBlock = await loadBrandBlock(brandOsName(brandHint));

  const res = await fetch(OPENAI_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: 0.4, response_format: { type: "json_object" },
      messages: [
        { role: "system", content:
          `You turn a rough, dictated content idea into ONE structured Shot List card for a filming/production board. ` +
          `Extract what the person actually said — never invent facts, names, prices, or claims not in their idea. ` +
          `content_type must be exactly one of: reel, story, short_form_ad, podcast_clip, interview_clip, behind_the_scenes, long_form_segment, broll, carousel_assets, static_ad. ` +
          `Pick brand from: weprintwraps, restylepro, designproai, wraptvworld, inkandedge, thewrap — use the hinted brand unless the idea clearly names a different one. ` +
          `Write the hook per the Content Director rule if this brand has one on file below (pattern interrupt / curiosity / pain / aspiration / authority — never a flat problem statement or generic imperative). ` +
          `Return ONLY a JSON object: {"brand":"...","campaign":"...","content_type":"...","shot_title":"...",` +
          `"filming_instruction":"...","on_camera_person":"...","location":"...","props":"...","priority":"low|medium|high","hook":"...","cta":"...","notes":"..."} ` +
          `— use an empty string for any field the idea didn't cover.\n\n${brandBlock}` },
        { role: "user", content: `Idea (brand hint: ${brandHint}):\n${idea}` },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: `idea parse ${res.status}: ${JSON.stringify(data).slice(0, 200)}` }, 502);
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
  catch { return json({ error: "idea parse returned invalid JSON" }, 502); }

  const brand = String(parsed.brand || brandHint);
  const priority = ["low", "medium", "high"].includes(String(parsed.priority)) ? String(parsed.priority) : "medium";
  const { data: row, error } = await sb.from("shot_list_items").insert({
    brand,
    campaign: parsed.campaign || null,
    content_type: parsed.content_type || null,
    shot_title: String(parsed.shot_title || idea.slice(0, 80)),
    filming_instruction: parsed.filming_instruction || null,
    on_camera_person: parsed.on_camera_person || null,
    location: parsed.location || null,
    props: parsed.props || null,
    priority,
    hook: parsed.hook || null,
    cta: parsed.cta || null,
    notes: [parsed.notes, `Original idea: "${idea}"`].filter(Boolean).join("\n\n"),
    status: "planned",
    created_by: "content-director-idea",
  }).select("*").single();
  if (error) return json({ error: error.message }, 500);
  return json({ action: "shot_list_idea", shot: row });
}

// ── shot_list_fresh_ideas — the board refills itself as the crew films ──────
// Owner spec 2026-08-04: "once we add a date and upload it moves card and AI
// creates fresh director ideas." When a dated shot's footage lands, the
// client calls this: it reads the board's recent titles (so nothing repeats)
// and drops a few NEW planned ideas for the brand, tagged as Director ideas.
async function actionShotListFreshIdeas(body: Record<string, unknown>) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
  const brandHint = String(body.brand || "wraptvworld");
  const completedTitle = String(body.completedTitle || "").slice(0, 140);
  const count = Math.min(3, Math.max(1, Number(body.count) || 2));
  const sb = db();

  // Backpressure: a board already deep in unfilmed ideas doesn't need more.
  const { count: openCount } = await sb.from("shot_list_items")
    .select("id", { count: "exact", head: true })
    .eq("brand", brandHint).in("status", ["planned", "ready_to_film"]);
  if ((openCount || 0) > 60) return json({ action: "shot_list_fresh_ideas", shots: [], skipped: "board_full" });

  const { data: recent } = await sb.from("shot_list_items")
    .select("shot_title, campaign").eq("brand", brandHint)
    .order("created_at", { ascending: false }).limit(40);
  const existing = (recent || []).map((r: any) => `- ${r.shot_title}${r.campaign ? ` (${r.campaign})` : ""}`).join("\n");
  const brandBlock = await loadBrandBlock(brandOsName(brandHint));

  const res = await fetch(OPENAI_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: 0.8, response_format: { type: "json_object" },
      messages: [
        { role: "system", content:
          `You are the Content Director for a vehicle-wrap media brand. The crew just finished filming a shot; propose ${count} FRESH, filmable shot ideas to keep the board full. ` +
          `Rules: ideas must be shootable in a wrap shop with a small crew (staged scenes fine); NEVER duplicate or lightly rephrase anything on the existing board list; ` +
          `stay in the brand's world; at least one idea should be a money-making/ad idea when the list lacks one. ` +
          `Each idea needs concrete DIRECTION the camera person can follow — numbered beats, must-get close-ups. ` +
          `content_type must be exactly one of: reel, story, short_form_ad, podcast_clip, interview_clip, behind_the_scenes, long_form_segment, broll, carousel_assets, static_ad. ` +
          `Return ONLY JSON: {"ideas":[{"campaign":"...","content_type":"...","shot_title":"...","filming_instruction":"...","on_camera_person":"...","location":"...","priority":"low|medium|high","hook":"...","cta":"...","notes":"..."}]}\n\n${brandBlock}` },
        { role: "user", content:
          `Brand: ${brandHint}\nJust filmed: ${completedTitle || "(unknown)"}\nExisting board (do NOT repeat):\n${existing}` },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: `fresh ideas ${res.status}: ${JSON.stringify(data).slice(0, 200)}` }, 502);
  let parsed: { ideas?: Record<string, unknown>[] };
  try { parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
  catch { return json({ error: "fresh ideas returned invalid JSON" }, 502); }

  const rows: unknown[] = [];
  for (const idea of (parsed.ideas || []).slice(0, count)) {
    const priority = ["low", "medium", "high"].includes(String(idea.priority)) ? String(idea.priority) : "medium";
    const { data: row, error } = await sb.from("shot_list_items").insert({
      brand: brandHint,
      campaign: idea.campaign || null,
      content_type: idea.content_type || null,
      shot_title: String(idea.shot_title || "").slice(0, 200) || "Director idea",
      filming_instruction: idea.filming_instruction || null,
      on_camera_person: idea.on_camera_person || null,
      location: idea.location || null,
      priority,
      hook: idea.hook || null,
      cta: idea.cta || null,
      notes: [idea.notes, completedTitle ? `Director idea — suggested after "${completedTitle}" uploaded.` : "Director idea."].filter(Boolean).join("\n\n"),
      status: "planned",
      created_by: "content-director-fresh",
    }).select("*").single();
    if (!error && row) rows.push(row);
  }
  return json({ action: "shot_list_fresh_ideas", shots: rows });
}

// ── repurpose_across_brands — ONE moment, a DIFFERENT piece per brand ───────
// Owner spec 2026-08-04: filming one moment (Trish walks in, greets Amanda,
// reacts to the WrapTVWorld floor logo) must NOT become the same caption with
// a WePrintWraps.com tagline pasted on. Each brand gets its OWN angle in its
// OWN voice — WrapTVWorld: studio-build culture piece. WePrintWraps: the
// product/shop-tool story, repurposed across several channel formats, each
// with a DIFFERENT hook. Ink & Edge: an editorial magazine-feature take.
// Every draft reuses the SAME source moment but never reuses another draft's
// hook or caption text — the model is instructed to check its own output.
/**
 * THE SLATE — six angles per brand, one filmed moment.
 *
 * Owner, 2026-08-05: "for meta, x, threads, short, longform, substack for each
 * brand ai creates angles".
 *
 * The old slate was lopsided: WrapTVWorld got ONE slot, Ink & Edge one, and
 * WePrintWraps five — so "repurpose across brands" mostly repurposed for one
 * brand. Every brand now gets the same six surfaces, and each slot states the
 * ANGLE it must take, not just its format. The prompt is built with the whole
 * slate visible at once, which is what lets the model guarantee no two slots
 * share a hook — repurposing, not reposting.
 *
 * PUBLISHING REALITY, stated rather than implied: content-deploy ships
 * instagram, facebook, wraptv_site and wrapfeed. X, Threads, YouTube and
 * Substack land as drafts a human posts. The slate is about what gets WRITTEN;
 * the Narrative board flags which can actually be sent.
 */
const REPURPOSE_SURFACES: { platform: string; post_type: string; angle: string }[] = [
  { platform: "instagram", post_type: "post",   angle: "META — the proof shot. What the eye sees first, one idea, no preamble." },
  { platform: "x",         post_type: "thread", angle: "X — the argument, one beat per post, in the open. Invite disagreement." },
  { platform: "threads",   post_type: "post",   angle: "THREADS — the conversational read. Warmer, shorter, built for replies." },
  { platform: "youtube",   post_type: "short",  angle: "SHORT — the sharpest single idea, hook inside the first second." },
  { platform: "youtube",   post_type: "longform", angle: "LONGFORM — the full walkthrough: what happened, why it mattered, what it cost." },
  { platform: "substack",  post_type: "newsletter", angle: "SUBSTACK — the considered take for people who chose to hear from us. Context and opinion, not an announcement." },
];

const REPURPOSE_BRAND_DEFAULTS: Record<string, { platform: string; post_type: string; label: string }[]> =
  Object.fromEntries(
    ["wraptvworld", "weprintwraps", "inkandedge", "trish-founder"].map((brand) => [
      brand,
      REPURPOSE_SURFACES.map((s) => ({
        platform: s.platform,
        post_type: s.post_type,
        label: `${brand} — ${s.angle}`,
      })),
    ]),
  );

// "trish-founder" is a PERSONA, not a product brand in brand-os.ts — it gets
// its own inline voice instead of loadBrandBlock (owner 2026-08-04: "add a
// personal brand angle for me founder style fun").
const FOUNDER_VOICE_BLOCK = `Persona: Trish, founder — personal brand posts (not a product brand)
VOICE: First-person, founder-to-founder, fun and a little irreverent — never corporate, never a press release.
Reads like a text from a friend who happens to be building something real, not a company account.
ANGLE: The BEHIND-THE-SCENES of building — the excitement, the "we're not perfect yet", the human moment,
not the polished pitch. Self-aware humor about the mess of building is welcome.
CTA: Personal and light — "come watch us build it", "follow along", never a hard sales push.`;

async function actionRepurposeAcrossBrands(body: Record<string, unknown>) {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
  const moment = String(body.moment || "").trim();
  if (!moment) return json({ error: "moment (what actually happened, in plain words) required" }, 400);
  const shotId = body.shot_list_item_id ? String(body.shot_list_item_id) : null;
  const mediaUrl = body.media_url ? String(body.media_url) : null;
  const brands: string[] = Array.isArray(body.brands) && body.brands.length
    ? (body.brands as string[]).filter((b) => REPURPOSE_BRAND_DEFAULTS[b])
    : Object.keys(REPURPOSE_BRAND_DEFAULTS);
  const sb = db();

  // Build one prompt covering every (brand, format) slot at once — the model
  // sees the FULL slate, which is what lets it guarantee no two slots share a
  // hook. Each brand's own voice block is quoted in full so the differences
  // are not left to chance.
  const slots: { brand: string; platform: string; post_type: string; label: string }[] = [];
  for (const brand of brands) for (const spec of REPURPOSE_BRAND_DEFAULTS[brand]) slots.push({ brand, ...spec });
  if (!slots.length) return json({ error: "no valid brands" }, 400);

  const brandBlocks = (await Promise.all(
    [...new Set(brands)].map(async (b) =>
      `=== ${b} ===\n${b === "trish-founder" ? FOUNDER_VOICE_BLOCK : await loadBrandBlock(brandOsName(b))}`),
  )).join("\n\n");

  const res = await fetch(OPENAI_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: 0.7, response_format: { type: "json_object" },
      messages: [
        { role: "system", content:
          `One real moment was filmed. You are writing ${slots.length} DIFFERENT pieces of content from it — one per (brand, slot) below — for a wrap-industry media ecosystem. ` +
          `RULES: (1) Every piece is grounded in the SAME real moment — never invent facts, names, or numbers not in it. ` +
          `(2) Each brand gets its OWN angle in its OWN voice, per that brand's block below — WrapTVWorld covers it as studio/culture story, a print/wrap-supply brand covers it as a shop-tool/product story, an editorial magazine brand covers it as a feature. Do not reuse one brand's angle for another. ` +
          `(3) Within a brand that has multiple formats, EVERY format needs a DIFFERENT hook and different opening line — never the same caption reformatted. Before you finish, check your own output: if two slots share a hook or opening line, rewrite one. ` +
          `(4) A thread post_type must return numbered lines (1/, 2/, 3/…) in the caption text, ready to post as sequential replies. ` +
          `(5) Follow each brand's own CTA convention from its block — do not invent a generic CTA. ` +
          `Return ONLY JSON: {"posts":[{"brand":"...","platform":"...","post_type":"...","caption":"...","hashtags":["..."]}, ...]} — exactly ${slots.length} entries, one per slot in the order given.\n\n${brandBlocks}` },
        { role: "user", content:
          `THE MOMENT (what actually happened, ground everything in this):\n${moment}\n\n` +
          `SLOTS to write, in order:\n${slots.map((s, i) => `${i + 1}. ${s.brand} — ${s.label} (platform: ${s.platform}, post_type: ${s.post_type})`).join("\n")}` },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) return json({ error: `repurpose ${res.status}: ${JSON.stringify(data).slice(0, 200)}` }, 502);
  let parsed: { posts?: Record<string, unknown>[] };
  try { parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
  catch { return json({ error: "repurpose returned invalid JSON" }, 502); }

  const rows: unknown[] = [];
  for (const p of (parsed.posts || []).slice(0, slots.length)) {
    const { data: row, error } = await sb.from("agent_social_posts").insert({
      brand: String(p.brand || slots[rows.length]?.brand || brands[0]),
      platform: String(p.platform || slots[rows.length]?.platform || "instagram"),
      post_type: String(p.post_type || slots[rows.length]?.post_type || "post"),
      caption: String(p.caption || ""),
      hashtags: Array.isArray(p.hashtags) ? p.hashtags : null,
      media_urls: mediaUrl ? [mediaUrl] : null,
      status: "draft",
      created_by: "ecosystem-repurpose",
      generation_meta: { source_shot_list_item_id: shotId, moment, repurposed_at_slot_count: slots.length },
    }).select("*").single();
    if (!error && row) rows.push(row);
  }
  return json({ action: "repurpose_across_brands", posts: rows, slot_count: slots.length });
}

// ── deploy_sweep — internal-only relay to content-deploy ────────────────────
// Never restore the legacy anonymous relay. Before this boundary reaches
// production, the live pg_cron caller must present the exact service-role key
// or MARKETING_AGENT_INTERNAL_SECRET.
async function actionDeploySweep() {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/content-deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}` },
    body: "{}",
  });
  const out = await res.json().catch(() => ({}));
  return json({ action: "deploy_sweep", status: res.status, result: out }, res.ok ? 200 : 502);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // P0 boundary: no body, action, tenant key, token, URL, or path is read until
  // the caller has proved a live user session or internal identity.
  const principal = await authorizeRequest(req);
  if (principal instanceof Response) return principal;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await readJsonBody(req);
  if (body instanceof Response) return body;
  const action = String(body.action || "");
  const allowed = principal.kind === "internal"
    ? INTERNAL_ACTIONS
    : principal.isPlatformAdmin
      ? HUMAN_ACTIONS
      : TENANT_SCOPED_HUMAN_ACTIONS;
  if (!allowed.has(action)) {
    return json({ error: "Action not allowed for this caller" }, 403);
  }
  try {
    if (action === "audiences") {
      const key = Deno.env.get("KLAVIYO_API_KEY");
      if (!key) return json({ error: "KLAVIYO_API_KEY missing" }, 500);
      return json({ action, audiences: await listAudiences(key) });
    }
    if (action === "plan") return await actionPlan(body);
    if (action === "review") return await actionReview(body);
    if (action === "approve") return await actionApprove(body);
    if (action === "push") return await actionPush(body);
    if (action === "stats") return await actionStats(body);
    if (action === "run") return await actionRun(body);
    if (action === "plan_social") return await actionPlanSocial(body);
    if (action === "ad_pack") return await actionAdPack(body);
    if (action === "ads_audit") return await actionAdsAudit(body);
    if (action === "hooks") return await actionHooks(body);
    if (action === "hooks_to_drafts") return await actionHooksToDrafts(body);
    if (action === "revise_copy") return await actionReviseCopy(body);
    if (action === "import_products") return await actionImportProducts(body);
    if (action === "import_products_woo") return await actionImportProductsWoo(body);
    if (action === "chat") return await actionChat(body, await canvaTokensForPrincipal(principal));
    if (action === "shot_list_fresh_ideas") return await actionShotListFreshIdeas(body);
    if (action === "repurpose_across_brands") return await actionRepurposeAcrossBrands(body);
    if (action === "director_queue") return await actionDirectorQueue();
    if (action === "director_ideas") return await actionDirectorIdeas(body);
    if (action === "idea_approve") {
      if (principal.kind !== "human") {
        return json({ error: "Action not allowed for this caller" }, 403);
      }
      return await actionIdeaApprove(body, principal);
    }
    if (action === "copy_backfill") return await actionCopyBackfill(body);
    if (action === "make_creative") return await actionMakeCreative(body);
    if (action === "installer_reel") return await actionInstallerReel(body);
    if (action === "installer_series") return await actionInstallerSeries(body);
    if (action === "idea_reject") return await actionIdeaReject(body);
    // ── FOOTAGE-FIRST IDEAS — the lane the footage proposes ────────────────
    if (action === "footage_ideas") return await actionFootageIdeas(body);
    if (action === "footage_approve") return await actionFootageApprove(body);
    if (action === "footage_generate") return await actionFootageGenerate(body);
    if (action === "director_approve") return await actionDirectorApprove(body);
    if (action === "director_reject") return await actionDirectorReject(body);
    if (action === "director_plan_week") return await actionDirectorPlanWeek(body);
    if (action === "shot_list_idea") return await actionShotListIdea(body);
    if (action === "newsletter_roundup") return await actionNewsletterRoundup(body);
    if (action === "episode_build") return await actionEpisodeBuild(body);
    if (action === "episode_atomize") return await actionEpisodeAtomize(body);
    if (action === "deploy_sweep") return await actionDeploySweep();

    // ── transcript_cut — EDIT BY READING THE TRANSCRIPT (the real way) ──────
    // For interview episodes you don't stare at frames — you read what people
    // SAID and keep the lines that tell the story. This gathers a shoot's
    // timed spoken beats (content_moments.verbatim_quote + start/end + the
    // source video), the editor reads them, picks + ORDERS the story, and the
    // timestamps become the EDL. Returns the paper edit AND renders it.
    if (action === "transcript_cut") {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
      const sb = db();
      const shootKey = String(body.shoot || "houdini").trim().toLowerCase();

      const { data: srcs } = await sb.from("media_sources")
        .select("id, filename, storage_url")
        .not("storage_url", "is", null)
        .not("transcript", "is", null)
        .or(`shoot.ilike.%${shootKey}%,filename.ilike.%${shootKey}%`)
        .limit(60);
      if (!srcs?.length) return json({ error: `no transcribed sources for shoot '${shootKey}'` }, 409);
      const srcById = new Map(srcs.map((s) => [String(s.id), s]));

      const { data: lines } = await sb.from("content_moments")
        .select("source_id, start_time, end_time, speaker, verbatim_quote")
        .in("source_id", srcs.map((s) => s.id))
        .not("verbatim_quote", "is", null)
        .order("start_time", { ascending: true })
        .limit(200);
      if (!lines || lines.length < 3) {
        return json({ error: `only ${lines?.length || 0} spoken lines found for '${shootKey}' — transcripts are thin; parse the full interviews` }, 409);
      }

      const lineList = lines.map((l, i) =>
        `${i}. [${(srcById.get(String(l.source_id))?.filename || "").slice(0, 20)} @${Math.round(Number(l.start_time || 0))}s] ` +
        `${l.speaker ? `${l.speaker}: ` : ""}"${String(l.verbatim_quote).slice(0, 200)}"`).join("\n");

      const res = await fetch(OPENAI_URL, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: OPENAI_MODEL, temperature: 0.5, response_format: { type: "json_object" },
          messages: [
            { role: "system", content:
              `${EDITOR_IDENTITY}\n\n${LONGFORM_CRAFT}\n\nYou are editing an interview episode FROM THE ` +
              `TRANSCRIPT. Read every line below and keep only the ones that tell the story — cut filler, ` +
              `false starts, tangents, repetition. ORDER the kept lines into a documentary arc (open on the ` +
              `most magnetic line, build, land the payoff). Pick lines by index; never invent words. Return ONLY JSON.` },
            { role: "user", content:
              `SHOOT: ${shootKey}\n\nTRANSCRIPT LINES (index, source, timecode, quote):\n${lineList}\n\n` +
              `Return {"title":"episode title","thesis":"one sentence","edit":[{"line":<index>}] (the kept lines ` +
              `IN STORY ORDER, ~8-30 of them)}` },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) return json({ error: `transcript edit ${res.status}: ${JSON.stringify(data).slice(0, 200)}` }, 502);
      let plan: { title?: string; thesis?: string; edit?: { line: number }[] };
      try { plan = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
      catch { return json({ error: "transcript edit returned invalid JSON" }, 502); }
      const edit = (plan.edit || []).map((e) => lines[Number(e.line)]).filter(Boolean);
      if (edit.length < 3) return json({ error: "editor kept too few lines" }, 502);

      // Paper edit = the cut list a human can read/adjust; scenes = the EDL.
      const paperEdit = edit.map((l, i) => ({
        n: i + 1, source: srcById.get(String(l.source_id))?.filename,
        clipUrl: srcById.get(String(l.source_id))?.storage_url,
        in: Number(l.start_time || 0), out: Number(l.end_time || Number(l.start_time || 0) + 5),
        speaker: l.speaker, line: String(l.verbatim_quote).slice(0, 300),
      }));
      const scenes = edit.map((l, i) => ({
        sceneId: `t${i}`, clipId: String(l.source_id),
        clipUrl: srcById.get(String(l.source_id))?.storage_url,
        start: Number(l.start_time || 0),
        end: Math.min(Number(l.end_time || Number(l.start_time || 0) + 6), Number(l.start_time || 0) + 20),
        purpose: i === 0 ? "hook" : "proof",
      }));

      let renderJobId: string | null = null;
      if (body.render !== false) {
        renderJobId = await enqueueRender({
          id: `transcript_${shootKey}_${Date.now()}`, platform: "youtube", format: "youtube",
          aspectRatio: "16:9", source: "transcript_cut", brand: "wraptvworld",
          title: String(plan.title || `${shootKey} — Behind Shop Doors`),
          keepNativeAudio: true, scenes,
          totalDuration: scenes.reduce((t, s) => t + (s.end - s.start), 0),
          endCard: { duration: 3, text: String(plan.title || "Behind Shop Doors"), cta: "WrapTVWorld.com" },
        }, "transcript_cut");
      }

      // PERSIST the gold — the paper edit is saved so nothing is lost and the
      // Director can extract per-brand content from these quotes any time.
      const { data: extractRow } = await sb.from("content_extracts").insert({
        kind: "transcript_cut", shoot: shootKey,
        title: String(plan.title || `${shootKey} — Behind Shop Doors`),
        thesis: String(plan.thesis || ""), lines: paperEdit, render_job_id: renderJobId, status: "ready",
      }).select("id").single();

      // Auto-extract per-brand drafts into the Director queue (unless told not to).
      let extracted: unknown = null;
      if (body.extract !== false && extractRow?.id) {
        try {
          const r = await actionExtractContent({ extract_id: extractRow.id });
          extracted = await r.json();
        } catch (e) { extracted = { error: String(e).slice(0, 160) }; }
      }
      return json({ action: "transcript_cut", shoot: shootKey, title: plan.title, thesis: plan.thesis, lines_kept: edit.length, render_job_id: renderJobId, extract_id: extractRow?.id, extracted, paper_edit: paperEdit });
    }
    if (action === "extract_content") return await actionExtractContent(body);

    // ── cribs_build — the MTV Cribs hype shop tour ──────────────────────────
    // Uses the shoot's renderable VIDEO clips (shop spaces, install, builds)
    // as a room-by-room tour: the editor names each stop with a bold Cribs
    // caption, opens on "Welcome to <SHOP>", scores it with a house anthem,
    // and lands on the hero build. Fast, brash, personality-forward.
    if (action === "cribs_build") {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
      const sb = db();
      const shootKey = String(body.shoot || "houdini").trim().toLowerCase();
      const shopName = String(body.shop || (shootKey === "houdini" ? "Houdini Wraps" : shootKey)).trim();

      // Renderable VIDEO clips for the shoot — from BOTH parsed footage
      // (media_sources) AND the uploaded clip library (agent_media_assets,
      // where direct in-app/Drive uploads land). Merge + dedupe so the tour
      // can use ANY video the shop actually put in the system, not just
      // Whisper-parsed masters.
      const { data: srcs } = await sb.from("media_sources")
        .select("id, filename, storage_url")
        .not("storage_url", "is", null)
        .or(`shoot.ilike.%${shootKey}%,filename.ilike.%${shootKey}%`).limit(60);
      const { data: lib } = await sb.from("agent_media_assets")
        .select("id, title, original_filename, storage_url, tags, content_category")
        .not("storage_url", "is", null)
        .in("asset_type", ["video", "rendered_video"])
        .or(`title.ilike.%${shootKey}%,original_filename.ilike.%${shootKey}%,content_category.ilike.%${shootKey}%`).limit(60);
      const isVid = (u: string) => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u);
      const seenUrl = new Set<string>();
      const candidates = [
        ...((srcs || []).map((s) => ({ id: String(s.id), filename: String(s.filename || ""), storage_url: String(s.storage_url), lib: false }))),
        // library rows are already typed video, so trust asset_type over the ext
        ...((lib || []).map((a) => ({ id: String(a.id), filename: String(a.title || a.original_filename || ""), storage_url: String(a.storage_url), lib: true }))),
      ].filter((s) => {
        const ok = s.lib ? true : isVid(s.storage_url);
        if (!ok || seenUrl.has(s.storage_url)) return false;
        seenUrl.add(s.storage_url); return true;
      });
      // Pre-flight: hydration can leave a media_sources row pointing at a
      // storage object that was never fully uploaded (e.g. dangling "-t2.mp4"
      // URLs that 400). One dead clip 400s the WHOLE render, so drop any clip
      // whose object doesn't actually download BEFORE it reaches the editor.
      const liveChecks = await Promise.all(candidates.map(async (s) => {
        try {
          const h = await fetch(String(s.storage_url), { headers: { Range: "bytes=0-1" } });
          try { await h.body?.cancel(); } catch { /* noop */ }
          return (h.ok || h.status === 206) ? s : null;
        } catch { return null; }
      }));
      const vids = liveChecks.filter(Boolean) as { id: string; filename: string; storage_url: string }[];
      const dead = candidates.length - vids.length;
      if (vids.length < 3) return json({ error: `only ${vids.length} downloadable video clips for '${shootKey}' (${dead} dead/dangling URLs skipped) — parse/upload the shoot's video so the objects are actually in storage` }, 409);
      const vidById = new Map(vids.map((s) => [String(s.id), s]));

      // Optional pinned cold open — force a specific clip as stop 0 (e.g. the
      // owner's "welcome to my shop" intro). {intro:"c0600"} matches on filename.
      const introHint = String(body.intro || "").trim().toLowerCase();
      const introVid = introHint ? vids.find((v) => String(v.filename || "").toLowerCase().includes(introHint)) : null;
      const introMissing = introHint && !introVid;

      // Visual descriptions from the vision pass to help name each stop.
      const { data: moments } = await sb.from("content_moments")
        .select("source_id, start_time, end_time, visual_description, install_stage")
        .in("source_id", vids.map((s) => s.id))
        .order("start_time", { ascending: true }).limit(120);
      const clipList = vids.map((v, i) => {
        const m = (moments || []).filter((x) => String(x.source_id) === String(v.id));
        const desc = m.map((x) => x.visual_description || x.install_stage).filter(Boolean).slice(0, 2).join("; ");
        return `${i}. ${v.filename?.slice(0, 26)} — ${desc || "shop footage"}`;
      }).join("\n");

      const res = await fetch(OPENAI_URL, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: OPENAI_MODEL, temperature: 0.75, response_format: { type: "json_object" },
          messages: [
            { role: "system", content:
              `${EDITOR_IDENTITY}\n\n${CRIBS_CRAFT}\n\nYou are cutting an MTV-Cribs-style hype shop tour of ` +
              `${shopName}. Order the clips into a room-by-room tour and give each a BOLD Cribs caption. Pick ` +
              `clips by index; never invent footage. Return ONLY JSON.` },
            { role: "user", content:
              `SHOP: ${shopName}\n\nAVAILABLE CLIPS:\n${clipList}\n\n` +
              `Return {"title":"tour title","open_caption":"Welcome to ${shopName} — this is my crib",` +
              `"stops":[{"clip":<index>,"caption":"BOLD AREA NAME (e.g. THE DESIGN LAB / WHERE THE MAGIC HAPPENS)"}] ` +
              `(8-14 stops, hero build last)}`},
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) return json({ error: `cribs ${res.status}: ${JSON.stringify(data).slice(0, 200)}` }, 502);
      let plan: { title?: string; open_caption?: string; stops?: { clip: number; caption: string }[] };
      try { plan = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
      catch { return json({ error: "cribs plan invalid JSON" }, 502); }
      let stops = (plan.stops || []).map((s) => ({ v: vidById.get(String(vids[Number(s.clip)]?.id)), cap: s.caption }))
        .filter((s) => s.v);
      if (stops.length < 3) return json({ error: "cribs plan produced too few stops" }, 502);
      // Pin the owner's welcome as the cold open: hoist it to stop 0 (dedupe
      // it from wherever the editor placed it) so Gary's "welcome to my shop"
      // always opens the tour.
      if (introVid) {
        stops = stops.filter((s) => String(s.v.id) !== String(introVid.id));
        stops.unshift({ v: introVid, cap: String(plan.open_caption || `Welcome to ${shopName}`) });
      }

      const scenes = stops.map((s, i) => ({
        sceneId: `crib${i}`, clipId: String(s.v.id), clipUrl: s.v.storage_url,
        start: 0, end: i === stops.length - 1 ? 5 : 3.2,
        purpose: i === 0 ? "hook" : "b_roll",
        text: i === 0 ? String(plan.open_caption || `Welcome to ${shopName}`) : String(s.cap || ""),
        textPosition: i === 0 ? "center" : "top",
      }));
      const anthem = "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/wraptv-music/the-wrap-game.mp3";
      const jobId = await enqueueRender({
        id: `cribs_${shootKey}_${Date.now()}`, platform: "youtube", format: "youtube",
        aspectRatio: "16:9", source: "cribs_build", brand: "wraptvworld",
        title: `${shopName}: ${plan.title || "Shop Cribs"}`,
        stylePack: "wpw_dark_clean", musicStart: 20, scenes,
        totalDuration: scenes.reduce((t, s) => t + (s.end - s.start), 0),
        endCard: { duration: 2.5, text: shopName, cta: "WrapTVWorld.com" },
      }, "cribs_build");
      // music_url rides on the render job body separately.
      await sb.from("video_render_jobs").update({ music_url: anthem }).eq("id", jobId);

      return json({ action: "cribs_build", shoot: shootKey, shop: shopName, title: plan.title, stops: stops.length, render_job_id: jobId, clips_live: vids.length, clips_skipped: dead, clip_files: vids.map((v) => v.filename), intro_pinned: introVid?.filename || null, intro_missing: introMissing });
    }

    // ── transcript_export — hand back the RAW full transcript for a shoot ────
    // So the team can paste it into ChatGPT (or anywhere) to spin hooks, reels
    // scripts, captions. Returns every parsed source's full transcript for the
    // shoot, plus one concatenated `full_text` block. {shoot:"houdini"} or
    // {source_id:"..."}; no AI, just the words.
    if (action === "transcript_export") {
      const sb = db();
      const shootKey = String(body.shoot || "").trim().toLowerCase();
      let q = sb.from("media_sources")
        .select("id, filename, shoot, duration_seconds, transcript")
        .not("transcript", "is", null)
        .order("filename", { ascending: true });
      if (body.source_id) q = q.eq("id", String(body.source_id)).limit(1);
      else if (shootKey) q = q.or(`shoot.ilike.%${shootKey}%,filename.ilike.%${shootKey}%`).limit(60);
      else q = q.order("created_at", { ascending: false }).limit(1);
      const { data: rows, error } = await q;
      if (error) return json({ error: error.message }, 500);
      if (!rows?.length) return json({ error: `no parsed transcripts found for '${shootKey || "latest"}'` }, 404);
      const sources = rows.map((r) => ({
        id: String(r.id), filename: r.filename, shoot: r.shoot,
        duration_seconds: r.duration_seconds, chars: String(r.transcript || "").length,
        transcript: String(r.transcript || ""),
      }));
      const full_text = sources.map((s) => `===== ${s.filename || s.id} =====\n${s.transcript}`).join("\n\n");
      return json({ action: "transcript_export", shoot: shootKey || null, count: sources.length, total_chars: full_text.length, full_text, sources });
    }

    // ── series_build — cut a shoot into a MULTI-PART SERIES ─────────────────
    // Like the published Behind Shop Doors ("part two of our visit to Surf
    // City Graphics"): the editor reads the whole shoot's transcript, designs
    // an N-part arc (each part a self-contained episode with its own theme),
    // and renders one 16:9 documentary per part — "Behind Shop Doors: <Shop>
    // — Part N: <Title>". Each part is saved + gets a review card.
    if (action === "series_build") {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
      const sb = db();
      const shootKey = String(body.shoot || "houdini").trim().toLowerCase();
      const shopName = String(body.shop || "").trim();
      const parts = Math.max(2, Math.min(Number(body.parts) || 3, 6));

      const { data: srcs } = await sb.from("media_sources")
        .select("id, filename, storage_url")
        .not("storage_url", "is", null).not("transcript", "is", null)
        .or(`shoot.ilike.%${shootKey}%,filename.ilike.%${shootKey}%`).limit(60);
      if (!srcs?.length) return json({ error: `no transcribed sources for shoot '${shootKey}' — parse the interviews first` }, 409);
      const srcById = new Map(srcs.map((s) => [String(s.id), s]));
      // Only sources with actual VIDEO (renderable) can show on screen.
      const videoSrc = new Set(srcs.filter((s) => /\.(mp4|mov|m4v|webm)$/i.test(String(s.storage_url))).map((s) => String(s.id)));

      const { data: lines } = await sb.from("content_moments")
        .select("source_id, start_time, end_time, speaker, verbatim_quote")
        .in("source_id", srcs.map((s) => s.id))
        .not("verbatim_quote", "is", null)
        .order("start_time", { ascending: true }).limit(300);
      if (!lines || lines.length < 6) return json({ error: `only ${lines?.length || 0} lines — not enough for a series yet` }, 409);

      const lineList = lines.map((l, i) =>
        `${i}. [${(srcById.get(String(l.source_id))?.filename || "").slice(0, 18)} @${Math.round(Number(l.start_time || 0))}s]` +
        `${l.speaker ? ` ${l.speaker}:` : ""} "${String(l.verbatim_quote).slice(0, 160)}"`).join("\n");

      const res = await fetch(OPENAI_URL, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: OPENAI_MODEL, temperature: 0.5, response_format: { type: "json_object" },
          messages: [
            { role: "system", content:
              `${EDITOR_IDENTITY}\n\n${LONGFORM_CRAFT}\n\n${HOUSE_REFERENCES}\n\nYou are cutting a MULTI-PART ` +
              `Behind Shop Doors SERIES from one shoot's transcript — like "Part Two of our visit to Surf City ` +
              `Graphics." Design ${parts} parts, each a SELF-CONTAINED episode with its own theme and arc (e.g. ` +
              `Part 1: the origin story; Part 2: how they win business; Part 3: the craft & the crew). Assign each ` +
              `transcript line to ONE part, ordered for story. Never invent words. Return ONLY JSON.` },
            { role: "user", content:
              `SHOOT: ${shootKey}${shopName ? ` (${shopName})` : ""}\n\nTRANSCRIPT LINES:\n${lineList}\n\n` +
              `Return {"series_title":"...","parts":[{"part":1,"title":"episode title","theme":"one sentence",` +
              `"lines":[indices in story order, 6-20 per part]}]} — exactly ${parts} parts, no line reused across parts.` },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) return json({ error: `series ${res.status}: ${JSON.stringify(data).slice(0, 200)}` }, 502);
      let plan: { series_title?: string; parts?: { part: number; title: string; theme: string; lines: number[] }[] };
      try { plan = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
      catch { return json({ error: "series plan invalid JSON" }, 502); }
      if (!Array.isArray(plan.parts) || !plan.parts.length) return json({ error: "series plan had no parts" }, 502);

      const built: Record<string, unknown>[] = [];
      for (const p of plan.parts) {
        const kept = (p.lines || []).map((i) => lines[Number(i)]).filter(Boolean)
          .filter((l) => videoSrc.has(String(l.source_id))); // only renderable video
        if (kept.length < 3) { built.push({ part: p.part, skipped: "too few renderable lines" }); continue; }
        const scenes = kept.map((l, i) => ({
          sceneId: `p${p.part}s${i}`, clipId: String(l.source_id),
          clipUrl: srcById.get(String(l.source_id))?.storage_url,
          start: Number(l.start_time || 0),
          end: Math.min(Number(l.end_time || Number(l.start_time || 0) + 6), Number(l.start_time || 0) + 20),
          purpose: i === 0 ? "hook" : "proof",
        }));
        const title = `Behind Shop Doors${shopName ? `: ${shopName}` : ""} — Part ${p.part}: ${p.title}`;
        const jobId = await enqueueRender({
          id: `series_${shootKey}_p${p.part}_${Date.now()}`, platform: "youtube", format: "youtube",
          aspectRatio: "16:9", source: "series_build", brand: "wraptvworld", title,
          keepNativeAudio: true, scenes,
          totalDuration: scenes.reduce((t, s) => t + (s.end - s.start), 0),
          endCard: { duration: 3, text: `Part ${p.part}`, cta: "WrapTVWorld.com" },
        }, "series_build");
        const paperEdit = kept.map((l, i) => ({
          n: i + 1, source: srcById.get(String(l.source_id))?.filename,
          clipUrl: srcById.get(String(l.source_id))?.storage_url,
          in: Number(l.start_time || 0), out: Number(l.end_time || Number(l.start_time || 0) + 6),
          speaker: l.speaker, line: String(l.verbatim_quote).slice(0, 300),
        }));
        await sb.from("content_extracts").insert({
          kind: "series_part", shoot: shootKey, title, thesis: p.theme || "",
          lines: paperEdit, render_job_id: jobId, status: "ready",
        });
        built.push({ part: p.part, title, render_job_id: jobId, scenes: scenes.length });
      }

      await sb.from("slack_agent_tasks").insert({
        brand: "wraptvworld", task_type: "video_review", status: "pending", priority: "high", assigned_to: "amanda",
        title: `SERIES ROUGH CUTS: ${String(plan.series_title || shootKey).slice(0, 60)} (${built.filter((b) => b.render_job_id).length} parts)`,
        description: `Multi-part Behind Shop Doors series from the ${shootKey} shoot.\n\n` +
          built.map((b) => `Part ${b.part}: ${b.title || b.skipped}`).join("\n") +
          `\n\nReview each part in Video Studio → Renders; reply with notes to recut.`,
        created_by: "content-director", metadata: { source: "series_build", shoot: shootKey, series_title: plan.series_title, parts: built },
      });
      return json({ action: "series_build", shoot: shootKey, series_title: plan.series_title, parts: built });
    }
    if (action === "extract_content") return await actionExtractContent(body);

    // ── vision_score — THE VISUAL PASS (the editor's eye) ───────────────────
    // The media-parser sends sampled frames from a clip; gpt-4o vision scores
    // what's ON SCREEN into content_moments, so silent b-roll becomes
    // cuttable. This is the piece that knows the squeegee pull is the money
    // shot — no transcript required.
    if (action === "vision_score") {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
      const sb = db();
      const filename = String(body.filename || "clip.mp4");
      const mediaUrl = String(body.media_url || "");
      const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
      const frames = Array.isArray(body.frames) ? body.frames as { time: number; image_base64: string }[] : [];
      if (!frames.length) return json({ error: "no frames" }, 400);

      // Resolve/insert the media_sources row this clip's moments hang off.
      let sourceId: string | null = null;
      const dedupe = mediaUrl || filename;
      const { data: existing } = await sb.from("media_sources").select("id").eq("dedupe_key", dedupe).maybeSingle();
      if (existing) sourceId = existing.id;
      else {
        const shoot = tags.find((t) => /lucid|houdini|surf|royalty|ghost/i.test(t)) || null;
        const { data: ins } = await sb.from("media_sources").insert({
          kind: "video", title: filename, filename, storage_url: mediaUrl || null,
          shoot, dedupe_key: dedupe, brands: ["wraptvworld"],
        }).select("id").single();
        sourceId = ins?.id || null;
      }
      if (!sourceId) return json({ error: "could not resolve media_sources row" }, 500);

      // ── ALREADY SCORED? DO NOT BUY IT AGAIN. ───────────────────────────────
      //
      // This pass had no spend guard and no idempotent write, so every re-parse
      // of a clip bought a fresh vision call over ~10 frames and APPENDED the
      // results. Measured in production 2026-08-07:
      //
      //     1,122 duplicate visual groups · 2,953 wasted rows · 129 sources
      //     worst case: ONE frame observation stored 53 TIMES
      //
      // 53 copies means that clip was vision-scored 53 times. The duplicated
      // rows are the visible symptom; the model calls behind them are the bill.
      // 2,953 of 11,675 moments — 25% of the library's observations — are
      // re-purchases of something already owned.
      //
      // The transcribe path never had this problem because it clears the
      // source's moments before inserting (`wpw-workforce-sweep`, mode
      // "transcribe"). Verified: ZERO duplicate speech groups. This is the same
      // discipline, plus a check that runs BEFORE the spend rather than after.
      //
      // `refresh: true` is the deliberate re-score, and it replaces rather than
      // appends.
      const refresh = body.refresh === true;
      const { count: alreadyScored } = await sb
        .from("content_moments")
        .select("id", { count: "exact", head: true })
        .eq("source_id", sourceId)
        .not("visual_description", "is", null);

      if (alreadyScored && !refresh) {
        return json({
          action: "vision_score", source_id: sourceId, moments: 0, money_shots: 0,
          skipped: "already_scored",
          note: `This clip already has ${alreadyScored} scored visual moment(s). Not re-buying the vision pass. Send { refresh: true } to re-score deliberately.`,
        });
      }

      // A deliberate re-score REPLACES this source's visual moments. Scoped to
      // rows that carry a `visual_description` so it can never touch the
      // SPEECH moments hanging off the same source — once a clip is parsed both
      // ways, one source row legitimately holds both kinds, and a blanket
      // delete here would silently destroy the transcript half.
      if (alreadyScored && refresh) {
        await sb.from("content_moments").delete()
          .eq("source_id", sourceId)
          .not("visual_description", "is", null);
      }

      const content: unknown[] = [{ type: "text", text:
        `You are a world-class wrap-industry video editor watching sampled frames from "${filename}" ` +
        `(one frame every 5 seconds; the timestamp of each frame is given). For EACH frame, decide what ` +
        `is happening on screen and score its editorial value. You know the craft: the SQUEEGEE PULL, ` +
        `the REVEAL of a finished wrap, TORCH/HEAT-GUN work on a curve, a clean DRIVE-BY of a wrapped ` +
        `vehicle, a satisfying PEEL — these are MONEY SHOTS. Setup, empty rooms, backs of heads, blurry ` +
        `motion — low value. Return ONLY JSON.` }];
      frames.forEach((f) => {
        content.push({ type: "text", text: `Frame at ${f.time}s:` });
        content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${f.image_base64}`, detail: "low" } });
      });
      const res = await fetch(OPENAI_URL, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: OPENAI_MODEL, temperature: 0.3, response_format: { type: "json_object" },
          messages: [{ role: "user", content }, { role: "system", content:
            `Return {"moments":[{"time":<seconds>,"install_stage":"prep|squeegee|trim|heat|reveal|drive-by|peel|detail|interview|other",` +
            `"visual_description":"what's on screen, one line","broll_score":<0-10 editorial value>,` +
            `"money_shot":<true if a hero moment>}]}` }],
        }),
      });
      const data = await res.json();
      if (!res.ok) return json({ error: `vision ${res.status}: ${JSON.stringify(data).slice(0, 200)}` }, 502);
      let parsed: { moments?: Record<string, unknown>[] };
      try { parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
      catch { return json({ error: "vision returned invalid JSON" }, 502); }
      const allScored = parsed.moments || [];
      // Keep genuinely usable b-roll (≥3) — the money-shot flag is the real
      // signal; the score just filters dead frames (empty rooms, blur).
      const moments = allScored.filter((m) => Number(m.broll_score ?? 0) >= 3 || m.money_shot === true);

      let inserted = 0, money = 0;
      for (const m of moments) {
        const t = Number(m.time || 0);
        const isMoney = m.money_shot === true;
        if (isMoney) money++;
        const { error } = await sb.from("content_moments").insert({
          source_id: sourceId, start_time: t, end_time: t + 5,
          visual_description: String(m.visual_description || "").slice(0, 400),
          install_stage: String(m.install_stage || "other"),
          broll_score: Math.round(Number(m.broll_score || 0)),
          hook_score: isMoney ? Math.max(7, Math.round(Number(m.broll_score || 0))) : null,
          content_uses: isMoney ? ["reel", "broll", "hero"] : ["broll"],
        });
        if (!error) inserted++;
      }
      return json({
        action: "vision_score", source_id: sourceId, moments: inserted, money_shots: money,
        scored: allScored.map((m) => ({ t: m.time, stage: m.install_stage, score: m.broll_score, money: m.money_shot, saw: m.visual_description })),
      });
    }

    // ── autocut — the Cut Editor's intelligent pass ─────────────────────────
    // Takes a blueprint and re-cuts it for scroll-stopping pace: hook-first
    // scene order, tight 1.5-4s trims, punchier overlay lines, music drop at
    // frame one. Returns the edited scene plan for the human to review (or
    // one-click re-render). Editor-brain rules apply — punchy, never cringe.
    if (action === "autocut") {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) return json({ error: "OPENAI_API_KEY missing" }, 500);
      const bp = (body.blueprint || {}) as Record<string, unknown>;
      const scenes = Array.isArray(bp.scenes) ? bp.scenes as Record<string, unknown>[] : [];
      if (!scenes.length) return json({ error: "blueprint has no scenes" }, 400);
      const sceneList = scenes.map((s, i) =>
        `${i}. [${s.start}-${s.end}s] text:"${s.text || ""}" purpose:${s.purpose || "-"}`).join("\n");
      const res = await fetch(OPENAI_URL, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: OPENAI_MODEL, temperature: 0.7, response_format: { type: "json_object" },
          messages: [
            { role: "system", content:
              `${EDITOR_IDENTITY}\n\n${SHORTS_CRAFT}\n\nYou are the AUTO-CUT running the MASHUP recipe ` +
              `(Behind the Install energy: beat cuts to the house anthem, punch text, momentum). Rules: the ` +
              `single strongest visual opens (hook first), cuts run 1.5-4s each (never longer) like they're ` +
              `landing on beats, the hook overlay is punchy and under 6 words, at most 3 text overlays ` +
              `total, total runtime under 25s before the end card. Reorder/trim/drop scenes freely — but ` +
              `only use the scenes given. Return ONLY the JSON object.` },
            { role: "user", content:
              `Title: ${bp.title || ""}\nScenes:\n${sceneList}\n\n` +
              `Return {"title":"sharper title","musicStart":<seconds to skip a slow intro, 0 if unknown>,` +
              `"scenes":[{"index":<original index>,"start":<new in>,"end":<new out>,"text":"overlay or empty"}]}` },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) return json({ error: `autocut ${res.status}: ${JSON.stringify(data).slice(0, 200)}` }, 502);
      let cut: { title?: string; musicStart?: number; scenes?: { index: number; start: number; end: number; text?: string }[] };
      try { cut = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
      catch { return json({ error: "autocut returned invalid JSON" }, 502); }
      const newScenes = (cut.scenes || [])
        .map((c) => {
          const orig = scenes[Number(c.index)];
          if (!orig) return null;
          return { ...orig, start: Number(c.start), end: Number(c.end), text: c.text || undefined };
        })
        .filter(Boolean);
      if (!newScenes.length) return json({ error: "autocut produced no usable scenes" }, 502);
      return json({ action: "autocut", title: cut.title || bp.title, musicStart: Number(cut.musicStart || 0), scenes: newScenes });
    }

    // ── Content Studio library ingest — drop a brand asset (real photo, ad, logo)
    //    straight into the Content Studio Template Library
    //    (wrap-files/canva-templates/{brand}/{content_type}) so it shows up in the
    //    "Temp" picker. Service-role upload; base64 body. ─────────────────────────
    if (action === "library_ingest") {
      const brand = String(body.brand || "WePrintWraps");
      const ctype = String(body.content_type || "static-1x1");
      const filename = String(body.filename || "asset.png").replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
      const mime = String(body.mime || "image/png");
      const b64 = String(body.data_base64 || "");
      // Optional explicit folder (e.g. "wtw-music/rap" for WrapTV soundtracks);
      // defaults to the Content Studio template library path.
      const folder = body.folder
        ? String(body.folder).replace(/[^a-zA-Z0-9/_-]/g, "").replace(/^\/+|\/+$/g, "")
        : `canva-templates/${brand}/${ctype}`;
      if (!b64) return json({ error: "data_base64 required" }, 400);
      try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const path = `${folder}/${Date.now()}-${filename}`;
        const sb = db();
        const { error } = await sb.storage.from("wrap-files").upload(path, bytes, { contentType: mime, upsert: true });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, path, url: sb.storage.from("wrap-files").getPublicUrl(path).data.publicUrl });
      } catch (e) {
        return json({ error: String(e).slice(0, 200) }, 500);
      }
    }

    // ── Canva Brand Template wiring (the real-branding design engine) ──────────
    if (action === "canva_templates") {
      const tokens = await canvaTokensForPrincipal(principal, body);
      if (!tokens) return json({ action, error: "canva_not_connected" }, 404);
      try {
        return json({ action, templates: await canvaListTemplates(tokens) });
      } catch (e) {
        return json({ action, error: String(e).slice(0, 200) }, 502);
      }
    }
    if (action === "canva_config") {
      const { data } = await db().from("brand_canva_templates")
        .select("brand, template_id, template_title, field_map, reel_template_id, reel_template_title, reel_field_map");
      return json({ action, maps: data || [] });
    }
    if (action === "canva_map") {
      const tokens = await canvaTokensForPrincipal(principal);
      if (!tokens) return json({ action, error: "canva_not_connected" }, 404);
      const brand = String(body.brand || "");
      const templateId = String(body.template_id || "");
      const kind = String(body.kind || "image"); // "image" | "reel"
      if (!brand || !templateId) return json({ action, error: "brand and template_id required" }, 400);
      try {
        const fields = await canvaTemplateDataset(tokens, templateId);
        const title = body.template_title ? String(body.template_title) : null;
        const row = kind === "reel"
          ? { brand, reel_template_id: templateId, reel_template_title: title, reel_field_map: fields, updated_at: new Date().toISOString() }
          : { brand, template_id: templateId, template_title: title, field_map: fields, updated_at: new Date().toISOString() };
        const { error } = await db().from("brand_canva_templates").upsert(row, { onConflict: "brand" });
        if (error) return json({ action, error: error.message }, 500);
        return json({ action, ok: true, brand, kind, template_id: templateId, fields });
      } catch (e) {
        return json({ action, error: String(e).slice(0, 200) }, 502);
      }
    }
    if (action === "canva_unmap") {
      const brand = String(body.brand || "");
      if (!brand) return json({ action, error: "brand required" }, 400);
      await db().from("brand_canva_templates").delete().eq("brand", brand);
      return json({ action, ok: true, brand });
    }

    // ── Canva pull — list the operator's REAL Canva designs so Content Studio
    //    can show the actual Canva library (not just manual uploads). ─────────
    if (action === "canva_designs") {
      const tokens = await canvaTokensForPrincipal(principal);
      if (!tokens) return json({ action, error: "canva_not_connected" }, 404);
      try {
        const u = new URL("https://api.canva.com/rest/v1/designs");
        u.searchParams.set("ownership", String(body.ownership || "owned_by_me"));
        u.searchParams.set("sort_by", String(body.sort_by || "modified_descending"));
        if (body.query) u.searchParams.set("query", String(body.query));
        if (body.continuation) u.searchParams.set("continuation", String(body.continuation));
        const data = await canvaJson(tokens, u.toString());
        const designs = (data.items || []).map((d: Record<string, any>) => ({
          id: d.id,
          title: d.title || "Untitled",
          thumbnail: d.thumbnail?.url || null,
          updated_at: d.updated_at || null,
        }));
        return json({ action, designs, continuation: data.continuation || null });
      } catch (e) {
        return json({ action, error: String(e).slice(0, 200) }, 502);
      }
    }

    // ── canva_folders — list the operator's top-level Canva folders so the
    //    Content Studio panel can offer a real folder picker. (Canva does NOT
    //    expose the ⭐ Starred list to apps — live-confirmed 404
    //    folder_not_found on 2026-07-28 — so the source folder is chosen.) ───
    if (action === "canva_folders") {
      const tokens = await canvaTokensForPrincipal(principal);
      if (!tokens) return json({ action, error: "canva_not_connected" }, 404);
      try {
        const folders: Record<string, unknown>[] = [];
        let cont: string | undefined = undefined;
        for (let page = 0; page < 5; page++) {
          const u = new URL("https://api.canva.com/rest/v1/folders/root/items");
          u.searchParams.set("item_types", "folder");
          if (cont) u.searchParams.set("continuation", cont);
          const data = await canvaJson(tokens, u.toString());
          for (const it of (data.items || [])) {
            const f = it.folder || it;
            if (f?.id && f?.name) folders.push({ id: f.id, name: f.name });
          }
          cont = data.continuation || undefined;
          if (!cont) break;
        }
        return json({ action, folders });
      } catch (e) {
        return json({ action, error: String(e).slice(0, 200) }, 502);
      }
    }

    // ── canva_starred — list the designs in the operator's chosen template
    //    source folder (body.folder_id). Without one, falls back to a ladder:
    //    literal "starred" id → a folder named "Starred" → "Content Studio".
    //    Returns { designs, source }. ─────────────────────────────────────────
    if (action === "canva_starred") {
      const tokens = await canvaTokensForPrincipal(principal);
      if (!tokens) return json({ action, error: "canva_not_connected" }, 404);
      try {
        const listItems = async (folderId: string, itemTypes: string): Promise<Record<string, any>[]> => {
          const out: Record<string, any>[] = [];
          let cont: string | undefined = undefined;
          for (let page = 0; page < 5; page++) {
            const u = new URL(`https://api.canva.com/rest/v1/folders/${folderId}/items`);
            u.searchParams.set("item_types", itemTypes);
            if (cont) u.searchParams.set("continuation", cont);
            const data = await canvaJson(tokens, u.toString());
            out.push(...(data.items || []));
            cont = data.continuation || undefined;
            if (!cont) break;
          }
          return out;
        };
        const mapDesigns = (items: Record<string, any>[]) =>
          items
            .map((it) => it.design || it)
            .filter((d) => d?.id)
            .map((d) => ({ id: d.id, title: d.title || "Untitled", thumbnail: d.thumbnail?.url || null, updated_at: d.updated_at || null }));

        let designs: Record<string, unknown>[] = [];
        let source = "";
        // Explicit source folders chosen in the UI — the primary path. Accepts
        // folder_ids (array of {id,name} or ids) or the older single folder_id.
        const folderList: { id: string; name?: string }[] = Array.isArray(body.folder_ids)
          ? (body.folder_ids as any[]).map((f) => (typeof f === "string" ? { id: f } : { id: String(f?.id || ""), name: f?.name ? String(f.name) : undefined })).filter((f) => f.id)
          : (body.folder_id ? [{ id: String(body.folder_id), name: body.folder_name ? String(body.folder_name) : undefined }] : []);
        if (folderList.length) {
          const seen = new Set<string>();
          for (const f of folderList) {
            try {
              for (const d of mapDesigns(await listItems(f.id, "design"))) {
                if (!seen.has(String(d.id))) { seen.add(String(d.id)); designs.push(d); }
              }
            } catch (fErr) {
              console.warn(`[canva_starred] folder ${f.name || f.id} failed:`, String(fErr).slice(0, 120));
            }
          }
          source = `folders:${folderList.map((f) => f.name || f.id).join(", ")}`;
        } else {
          // Ladder fallback (no folder picked yet)
          try {
            designs = mapDesigns(await listItems("starred", "design"));
            if (designs.length) source = "starred";
          } catch { /* expected: starred is not a reserved folder id */ }
          if (!designs.length) {
            try {
              const folders = (await listItems("root", "folder"))
                .map((it) => it.folder || it)
                .filter((f) => f?.id && f?.name);
              for (const namePat of [/^\W*starred\W*$/i, /content\s*studio/i]) {
                const hit = folders.find((f) => namePat.test(String(f.name)));
                if (hit) {
                  designs = mapDesigns(await listItems(hit.id, "design"));
                  source = `folder:${hit.name}`;
                  if (designs.length) break;
                }
              }
            } catch { /* fall through to empty result */ }
          }
        }
        return json({ action, designs, source });
      } catch (e) {
        return json({ action, error: String(e).slice(0, 200) }, 502);
      }
    }

    // ── canva_export — export one Canva design and re-host it INTO the
    //    Content Studio template library
    //    (wrap-files/canva-templates/{brand}/{content_type}) so the pulled
    //    template persists there and loads onto the canvas.
    //    kind: "image" (PNG) | "video" (MP4) | "auto" (PNG, falls back to MP4
    //    when the design is a video — reel templates in a mixed Starred batch).
    //    Video exports always land under content_type "reel". ────────────────
    if (action === "canva_export") {
      const tokens = await canvaTokensForPrincipal(principal);
      if (!tokens) return json({ action, error: "canva_not_connected" }, 404);
      const designId = String(body.design_id || "");
      if (!designId) return json({ action, error: "design_id required" }, 400);
      const brand = String(body.brand || "RestyleProAI").replace(/[^a-zA-Z0-9_-]/g, "");
      const kind = String(body.kind || "image"); // "image" | "video" | "auto"
      const title = String(body.title || "canva-design").replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase().slice(0, 60) || "canva-design";
      try {
        const tryExport = async (format: Record<string, unknown>): Promise<string | null> => {
          const ex = await canvaJson(tokens, "https://api.canva.com/rest/v1/exports", {
            method: "POST",
            body: JSON.stringify({ design_id: designId, format }),
          });
          const exJob = ex.job?.status === "success" ? ex.job : await canvaPoll(tokens, `https://api.canva.com/rest/v1/exports/${ex.job.id}`);
          return exJob?.urls?.[0] || null;
        };
        const tryVideo = async (): Promise<string | null> => {
          try { return await tryExport({ type: "mp4", quality: "vertical_1080p" }); }
          catch { return await tryExport({ type: "mp4", quality: "horizontal_1080p" }); }
        };

        let outUrl: string | null = null;
        let isVideo = false;
        if (kind === "video") {
          outUrl = await tryVideo();
          isVideo = true;
        } else {
          try {
            outUrl = await tryExport({ type: "png" });
          } catch (pngErr) {
            if (kind !== "auto") throw pngErr;
            outUrl = await tryVideo();
            isVideo = true;
          }
        }
        if (!outUrl) return json({ action, error: "canva export returned no file" }, 502);
        const outRes = await fetch(outUrl);
        if (!outRes.ok) return json({ action, error: `export download failed (${outRes.status})` }, 502);
        const bytes = new Uint8Array(await outRes.arrayBuffer());
        const ext = isVideo ? "mp4" : "png";
        const mime = isVideo ? "video/mp4" : "image/png";
        let ctypeReq = String(body.content_type || "static-1x1").replace(/[^a-zA-Z0-9_-]/g, "");
        if (!isVideo && ctypeReq === "auto") {
          // Classify by the PNG's own aspect ratio (IHDR width/height are
          // big-endian uint32 at byte offsets 16/20) so a mixed Starred batch
          // files each template under the right content type automatically.
          let w = 0, h = 0;
          if (bytes.length > 24) {
            w = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
            h = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
          }
          const ratio = w > 0 && h > 0 ? w / h : 1;
          const options: [string, number][] = [
            ["static-4x5", 4 / 5], ["static-1x1", 1], ["static-9x16", 9 / 16], ["static-16x9", 16 / 9],
          ];
          let best = "static-1x1", bestDiff = Infinity;
          for (const [name, r] of options) { const diff = Math.abs(ratio - r); if (diff < bestDiff) { bestDiff = diff; best = name; } }
          ctypeReq = best === "static-1x1" && /carousel|slide/i.test(title) ? "carousel" : best;
        }
        const ctype = isVideo ? "reel" : (ctypeReq === "auto" ? "static-1x1" : ctypeReq);
        const path = `canva-templates/${brand}/${ctype}/${Date.now()}-${title}.${ext}`;
        const sb = db();
        const { error } = await sb.storage.from("wrap-files").upload(path, bytes, { contentType: mime, upsert: true });
        if (error) return json({ action, error: error.message }, 500);
        return json({ action, ok: true, url: sb.storage.from("wrap-files").getPublicUrl(path).data.publicUrl, path, isVideo, contentType: ctype });
      } catch (e) {
        return json({ action, error: String(e).slice(0, 200) }, 502);
      }
    }

    if (action === "design") {
      const brandKey = String(body.brand || "weprintwraps");
      const headline = String(body.headline || "");
      const subhead = body.subhead ? String(body.subhead) : undefined;
      const cta = body.cta ? String(body.cta) : undefined;
      let url: string | null = null;
      const tokens = await canvaTokensForPrincipal(principal, body);
      const map = tokens ? await loadCanvaMap(brandKey) : null;
      if (map && tokens) {
        url = await generateCanvaDesign({ tokens, brandKey, templateId: map.template_id, fields: map.fields, headline, subhead, cta });
      }
      if (!url) {
        url = await pickLibraryImage(brandKey, body.format ? String(body.format) : "post");
      }
      return url ? json({ action: "design", ok: true, url, engine: map ? "canva" : "library" }) : json({ action: "design", ok: false, error: "no library image found for this brand — add assets in Content Studio" }, 404);
    }
    return json({ error: "pass action: audiences | plan | review | approve | push | stats | run | plan_social | ad_pack | hooks | chat | design | director_queue | director_approve | director_reject | director_plan_week | canva_templates | canva_config | canva_map | canva_unmap | canva_designs | canva_export" }, 400);
  } catch (e) {
    return json({ error: String(e).slice(0, 400) }, 500);
  }
});
