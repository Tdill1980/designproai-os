// ============================================================================
// designpro-clean-views
//
// Back-of-house "remove the baked branding from every side" orchestrator.
//
// During INITIAL generation (not just revision) this strips the AI's baked-in
// logo/text off each rendered view and returns a CLEAN, text-free background per
// view — the high-resolution Layer-1 source G.E.N.I.E. slices into production
// panels. The customer's real high-quality transparent PNGs (overlay_pngs) ride
// on top as editable Konva nodes, so branding stays crisp and editable instead
// of low-quality baked pixels.
//
// It chains two already-deployed, validated engines:
//   1. extract-logo-elements  — Gemini vision auto-detects every baked logo/text
//      region (normalized bounding boxes). No human box-draw needed.
//   2. designpro-clean-logo-swap (shape B) — fal.ai LaMa heals ONLY inside each
//      region (local repaint, no whole-image regen → no distortion).
//
// SELECTIVE BY DESIGN: only text/logo/phone/url elements are healed. Detected
// `graphic` elements (e.g. the marlin artwork that IS the wrap design) are
// NEVER healed, and an area guard skips any region covering more than
// MAX_REGION_AREA of the frame, so a misclassified design element can't be
// erased. This protects the artwork while removing the junk branding.
//
// Input:  { view_urls: { [viewKey]: url }, user_id?, generation_id?,
//           persist?: boolean }
// Output: { ok, clean_view_urls: { [viewKey]: cleanUrl }, per_view: [...] }
//
// When persist + generation_id are supplied, the clean driver-side becomes the
// row's background_url (production Layer-1 source) and clean_view_urls is saved
// to view_urls via designpro-persist-assets. The customer-facing branded display
// + 2D proof are untouched — this only produces the clean production source.
//
// verify_jwt = false (service-role internal orchestration).
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import {
  classifyElementRole,
  rejectRegionReason,
  validateLiftedElement,
  liftSourceTrust,
  ROLE_LABELS,
  OPAQUE_ALPHA,
  type ElementRole,
} from "../_shared/element-lift-os.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Measure the opaque-pixel ratio of a lifted transparent-PNG cutout — the
// deterministic wheel/fender rejector (element-lift-os OPACITY SLOP GATE). Decodes
// a downscaled copy (cheap, ~200px) so a real element (compact mark in clear space)
// reads LOW and a misread vehicle part (solid photo block) reads ≈1.0. Returns null
// when it can't decode (caller decides via source trust).
async function measureOpaqueRatio(url: string): Promise<number | null> {
  try {
    const small = downscaledUrl(url, 200);
    const res = await fetch(small, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const img = await Image.decode(new Uint8Array(await res.arrayBuffer()));
    const px = img.bitmap; // RGBA
    const total = (px.length / 4) | 0;
    if (total === 0) return null;
    let opaque = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > OPAQUE_ALPHA) opaque++;
    return opaque / total;
  } catch {
    return null;
  }
}

// The liftable taxonomy + geometry guards now live in element-lift-os.ts
// (classifyElementRole / rejectRegionReason) — the single source of truth shared
// with the rest of the pipeline. This function just applies them.

interface DetectedElement {
  type?: string;
  bounding_box?: { x?: number; y?: number; width?: number; height?: number };
}
interface LiftedElement {
  url: string;
  type: string;
  role: ElementRole;
}
interface PerViewResult {
  view: string;
  clean_url: string;
  regions_healed: number;
  // Transparent PNG cutouts of the brand marks sliced off this view — floated as
  // editable Layer-2 overlays instead of regenerated artwork.
  lifted?: LiftedElement[];
  detection_failed?: boolean;
  error?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function invokeFn(name: string, body: unknown): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text }; }
  if (!res.ok) throw new Error(`${name} ${res.status}: ${(data?.error || text || "").slice(0, 200)}`);
  return data;
}

// Supabase on-the-fly image transform: rewrite a public object URL to the
// render/image endpoint with a width cap. THIS is the real OOM fix — the manual
// "Remove Elements" button succeeds because it operates on the small on-screen
// image, but the auto path handed remove-element-clipdrop the full 4K render URL,
// and DECODING that 16MP frame is what killed the worker (HTTP 546) before any
// heal could run. Feeding it a ~2000px image makes the decode cheap and the lift
// completes — producing the clean separated background + transparent PNG cutout.
function downscaledUrl(url: string, width = 2000): string {
  if (typeof url === "string" && url.includes("/storage/v1/object/public/")) {
    const base = url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
    return base + (base.includes("?") ? "&" : "?") + `width=${width}&resize=contain&quality=90`;
  }
  return url;
}

// Detect baked branding on one view and heal it off. Returns the clean URL (or
// the original URL when nothing healable is found / detection fails — never a
// hard failure, so one bad view can't sink the whole pass).
async function cleanOneView(
  viewKey: string,
  url: string,
  userId?: string,
  sourceKind: "artboard" | "render" = "render",
): Promise<PerViewResult> {
  const sourceTrusted = liftSourceTrust(sourceKind);
  try {
    // RETRY DETECTION: extract-logo-elements (Gemini vision) is non-deterministic
    // — one call finds the logos, the next returns detection_failed / empty. A
    // single miss meant the whole view passed through branded with NO lifted PNG
    // logos (the "no layers even though this one had layers" flake). Retry up to
    // 3 attempts when it comes back empty/failed so the lift lands reliably.
    let detect = await invokeFn("extract-logo-elements", {
      approved_render_url: url,
      user_id: userId || null,
    });
    let detectTries = 1;
    while (
      (detect?.detection_failed || !Array.isArray(detect?.elements) || detect.elements.length === 0) &&
      detectTries < 3
    ) {
      await new Promise((r) => setTimeout(r, 1500));
      detect = await invokeFn("extract-logo-elements", {
        approved_render_url: url,
        user_id: userId || null,
      });
      detectTries++;
    }

    const elements: DetectedElement[] = Array.isArray(detect?.elements) ? detect.elements : [];
    // bounding_box fields are already normalized 0..1 percents (see
    // extract-logo-elements mapping). Classify each via element-lift-os
    // (logo / text / design_element) and apply the canonical geometry guard —
    // drops the whole-panel hero artwork and wide-thin contact bars.
    //
    // CRITICAL: on a 3D RENDER only logo/text are touched — the wrap's hero
    // ARTWORK must stay baked in the clean background (healing a "design_element"
    // off a render would erase the design). design_element layers are lifted ONLY
    // from the trusted flat ARTBOARD, where peeling a graphic is the whole point.
    const regions = elements
      .map((el) => ({ el, role: classifyElementRole(el.type || "") }))
      .filter((x): x is { el: DetectedElement; role: ElementRole } => x.role !== null)
      .filter((x) => sourceKind === "artboard" || x.role !== "design_element")
      .map(({ el, role }) => ({
        role,
        x_percent: el.bounding_box?.x ?? 0,
        y_percent: el.bounding_box?.y ?? 0,
        width_percent: el.bounding_box?.width ?? 0,
        height_percent: el.bounding_box?.height ?? 0,
      }))
      .filter((r) =>
        rejectRegionReason({ x: r.x_percent, y: r.y_percent, width: r.width_percent, height: r.height_percent }) === null,
      );

    if (regions.length === 0) {
      return { view: viewKey, clean_url: url, regions_healed: 0, lifted: [], detection_failed: !!detect?.detection_failed };
    }

    // Heal each region with the in-house layerlift-engine — a $0,
    // pure-imagescript lift+heal that needs NO ClipDrop credits. ClipDrop is
    // fully removed (account has no credit and we never want to spend on it);
    // a region that trips the free engine is just skipped (non-fatal) rather
    // than failing over to a paid API. Chain the clean output region→region.
    let cleanUrl = url;
    let healed = 0;
    const lifted: LiftedElement[] = [];
    for (const r of regions) {
      try {
        const liftBody = {
          // Hand the engine a PRE-SHRUNK image (Supabase resizes on the fly) so the
          // decode is cheap and it stops OOM-ing (HTTP 546) on 4K heroes. The bbox
          // is percent-based, so a smaller image maps identically. This is what the
          // working manual button effectively does.
          imageUrl: downscaledUrl(cleanUrl, 2000),
          boundingBox: {
            xPct: r.x_percent, yPct: r.y_percent,
            wPct: r.width_percent, hPct: r.height_percent,
          },
          elementType: "logo",
          userId: userId || null,
          // Belt-and-suspenders: also cap the engine's internal working frame.
          maxWorkPixels: 4_000_000,
        };
        // FREE engine only — no ClipDrop, ever.
        const res: any = await invokeFn("layerlift-engine", liftBody);
        if (res?.cleanBackgroundUrl) { cleanUrl = res.cleanBackgroundUrl; healed++; }
        // remove-element-clipdrop returns a transparent PNG cutout of the region.
        // SLOP GATE: a real element is a compact mark in clear space; a misread
        // vehicle part (wheel/fender/window) comes back a near-solid opaque block.
        // Measure the opaque-pixel ratio and reject the blob (element-lift-os) so a
        // wheel can NEVER reach overlay_pngs / admin. Cutouts off the trusted flat
        // artboard skip the decode; render cutouts must pass.
        if (res?.transparentPngUrl) {
          const ratio = await measureOpaqueRatio(res.transparentPngUrl);
          const verdict = validateLiftedElement(ratio, sourceTrusted);
          if (verdict.ok) {
            lifted.push({ url: res.transparentPngUrl, type: r.role, role: r.role });
          } else {
            console.warn(`[clean-views] rejected slop cutout (${r.role}) on ${viewKey}: ${verdict.reason} ratio=${verdict.opaqueRatio ?? "n/a"}`);
          }
        }
      } catch (e) {
        console.warn(`[clean-views] ClipDrop heal failed for a region: ${String((e as Error)?.message || e)}`);
      }
    }
    return { view: viewKey, clean_url: cleanUrl, regions_healed: healed, lifted };
  } catch (err) {
    // Non-fatal: fall back to the original view so the pass still completes.
    return { view: viewKey, clean_url: url, regions_healed: 0, lifted: [], error: String((err as Error)?.message || err) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: {
    view_urls?: Record<string, string>;
    user_id?: string;
    generation_id?: string;
    persist?: boolean;
    // The flat master ARTBOARD (DesignProAI artboard-first source of truth). When
    // supplied, the editable element layers are lifted from IT — not the 3D render
    // — so there are no wheels/fenders to misread. This is the slop fix.
    artboard_url?: string;
    // Lift editable overlays from the 3D RENDER when there is no artboard.
    // Default ON (legacy studio paths depend on it), but a clean alpha-matte of a
    // hubcap reads like a logo, so render-lift can leak vehicle-part slop. The
    // autogen/admin path passes false → with no artboard it emits a clean
    // background + ZERO overlays instead of a wheel. Set false for "no slop".
    allow_render_lift?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const viewUrls = body.view_urls || {};
  const entries = Object.entries(viewUrls).filter(([, u]) => typeof u === "string" && u);
  if (entries.length === 0 && !body.artboard_url) return json({ error: "view_urls or artboard_url required" }, 400);

  // Clean every 3D view in parallel — produces the clean Layer-1 background.
  const results = await Promise.all(
    entries.map(([viewKey, url]) => cleanOneView(viewKey, url, body.user_id, "render")),
  );

  const cleanViewUrls: Record<string, string> = {};
  for (const r of results) cleanViewUrls[r.view] = r.clean_url;

  // ELEMENT LIFT — lift the editable layers ONLY from the flat ARTBOARD (trusted:
  // no vehicle parts to misread). DesignProAI is artboard-first, so the artboard is
  // the right source for the real logo / text / design graphics. Render-lift is the
  // slop source (a clean alpha-matte of a hubcap looks like a logo) and is OFF
  // unless the caller explicitly opts in — so with no artboard we emit NO overlays
  // (clean background only) instead of feeding a wheel to admin.
  let liftSource: "artboard" | "render" | "none" = "none";
  let liftedRaw: LiftedElement[] = [];
  // Render-lift default: honor an explicit allow_render_lift; otherwise allow it
  // only for INTERACTIVE calls (a real user_id — the studio paths that depend on
  // it) and NOT for service/autogen calls (no user_id), where a misread hubcap
  // must never reach admin. Autogen therefore gets the no-slop guarantee even
  // before it is redeployed with the explicit flag.
  const allowRenderLift = body.allow_render_lift ?? !!body.user_id;
  if (body.artboard_url) {
    const artboardRes = await cleanOneView("artboard", body.artboard_url, body.user_id, "artboard");
    liftedRaw = artboardRes.lifted || [];
    liftSource = "artboard";
  } else if (allowRenderLift) {
    const heroResult =
      results.find((r) => r.view === "side") ||
      results.find((r) => r.view === "driver-side") ||
      results[0];
    liftedRaw = heroResult?.lifted || [];
    liftSource = liftedRaw.length ? "render" : "none";
  }
  // Carry each element's REAL role (logo / text / design element) into the
  // container so admin "Lifted Layers" shows what it actually is.
  const liftedOverlays = liftedRaw.map((l, i) => ({
    id: `lift-${i}`,
    kind: l.role,
    role: ROLE_LABELS[l.role] || l.role,
    url: l.url,
  }));

  // Did we ACTUALLY strip baked branding off the hero render? When detection finds
  // zero liftable regions we passed the BRANDED hero straight through as the
  // "clean" background. A regenerated text-layer overlay floated on top of that
  // still-branded base renders the SAME wordmark twice — the two-logos bug. Report
  // this so persist-assets can demote the duplicate.
  const heroRenderResult =
    results.find((r) => r.view === "side") ||
    results.find((r) => r.view === "driver-side") ||
    results[0];
  const heroScrubbed = (heroRenderResult?.regions_healed ?? 0) > 0;

  // Persist the clean Layer-1 source so ProductionFlow / QC / G.E.N.I.E. read it.
  // background_url = clean driver-side; view_urls = the clean per-view set; the
  // lifted brand marks ride on top as overlay_pngs. The branded customer display +
  // 2D proof are untouched.
  let persisted = false;
  if (body.persist && body.generation_id) {
    const cleanHero =
      cleanViewUrls["side"] || cleanViewUrls["driver-side"] || Object.values(cleanViewUrls)[0];
    try {
      await invokeFn("designpro-persist-assets", {
        generation_id: body.generation_id,
        background_url: cleanHero,
        view_urls: cleanViewUrls,
        // Tell persist-assets whether the base is truly clean. false → it demotes
        // any regenerated txt_ overlay to an alternate so the baked wordmark isn't
        // doubled (user-approved "suppress duplicate overlay").
        hero_scrubbed: heroScrubbed,
        ...(liftedOverlays.length
          ? { overlay_pngs: liftedOverlays, overlay_source: "lift" }
          : {}),
        user_id: body.user_id || null,
        source: "designpro-clean-views",
      });
      persisted = true;
    } catch (_e) {
      // non-fatal — caller still gets the clean URLs back
    }
  }

  return json({
    ok: true,
    clean_view_urls: cleanViewUrls,
    per_view: results,
    lifted_overlays: liftedOverlays.length,
    lift_source: liftSource,
    lift_roles: liftedOverlays.map((o) => o.kind),
    hero_scrubbed: heroScrubbed,
    persisted,
  });
});
