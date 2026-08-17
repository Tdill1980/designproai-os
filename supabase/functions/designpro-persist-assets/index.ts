// ============================================================================
// designpro-persist-assets
//
// Phase 5 — LayerLiftIQ server-side persistence WRITE path. Saves a generation's
// asset set into public.design_generation_assets, keyed by generation_id, so the
// server (Stripe webhook + Phase 6 slicer) is no longer blind to the two-layer
// separation that previously lived only in the browser (sessionStorage).
//
// Runs with the service role (createExternalClient) so it persists even for the
// guest $299 flow (no auth.uid). Auto-computes iteration history: the FIRST save
// for a generation updates iteration 0 in place (the design-time flow calls this
// a couple times as overlays arrive); an explicit new_iteration (a revision or a
// newly generated background) appends a NEW versioned row chained to its parent,
// never overwriting a prior version.
//
// Input:  {
//   generation_id: string (required),
//   background_url?, overlay_pngs?[], panel_zones?[], layer_manifest?[],
//   layer_layout?{}, proof_2d_url?, proof_3d_url?, view_urls?{}, user_id?,
//   shop_id?, organization_id?, source?, new_iteration?: boolean
// }
//
// layer_layout is the LayerLiftIQ canvas coordinate matrix — a per-view map
//   { [viewKey]: { stageWidth, stageHeight, overlays:[{id,x,y,scaleX,scaleY,...}] } }
// (the slicer scales these into print space). It was previously DROPPED here:
// the function never read it, so the bounding-box coordinates the page sent
// never reached design_generation_assets.layer_layout and it stayed empty —
// the slicer then composited overlays with zeroed/default placement.
//
// DEFAULT SEEDING (Step 4): the design-time flow persists overlay_pngs BEFORE the
// user has touched the canvas, so no layer_layout is supplied on that first save —
// it stayed empty, and Revision Studio / ProductionFlow loaded overlay_pngs with
// "Layers = 0, nothing to grab". When overlays arrive without a layout AND the row
// has none yet, we seed a DEFAULT coordinate matrix (keyed "driver-side", the
// slicer's primary panel id) so the canvas mounts movable nodes immediately. A
// real canvas edit (persistViewLayout) later supplies positions and overwrites it;
// a stored layout is never clobbered by the default.
// Output: 200 { id, generation_id, iteration_index, is_current }
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Inlined from _shared (kept self-contained so this deploys as a single file —
// identical behavior to _shared/cors.ts + _shared/external-db.ts).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function createExternalClient() {
  const url = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

interface OverlayPng {
  id?: string;
  kind?: "logo" | "text";
  role?: string;
  text?: string;
  url: string;
  alternate?: boolean; // Step A: a 2nd-choice Design Element (swap-to), not on canvas
}

interface PersistRequest {
  generation_id?: string;
  background_url?: string;
  overlay_pngs?: OverlayPng[];
  panel_zones?: unknown[];
  layer_manifest?: unknown[];
  // Per-view canvas coordinate matrix. Object map keyed by view (object), but
  // tolerate a flat array too — pass through whatever the canvas supplies.
  layer_layout?: unknown;
  proof_2d_url?: string;
  proof_3d_url?: string;
  view_urls?: Record<string, string>;
  user_id?: string;
  shop_id?: string;
  organization_id?: string;
  source?: string;
  source_prompt?: string;
  new_iteration?: boolean;
  // "lift" → overlay_pngs are brand marks designpro-clean-views sliced off the
  // paint. Merge so an uploaded logo is never clobbered (see the lift-merge below).
  overlay_source?: string;
  // Did clean-views actually strip baked branding off the hero? false → the base
  // is still branded, so a regenerated txt_ overlay would DOUBLE the wordmark and
  // is demoted to an alternate (user-approved "suppress duplicate overlay").
  hero_scrubbed?: boolean;
}

// One positioned, transformable Konva node on the LayerLift canvas. Mirrors
// OverlayElement in src/components/LayerLiftCanvas.tsx. x/y are STAGE coords;
// the print slicer + designpro-clean-logo-swap scale stage→render space.
interface LayoutNode {
  id: string;
  url: string;
  x: number;
  y: number;
  width?: number;
  isLogo?: boolean;
  text?: string;
}

// Canonical default LayerLift stage. Matches the studio's in-memory seeding
// (src/pages/DesignPanelProPremium.tsx seeds nodes at x:280, y:220+i*150) so a
// default DB layout lands where the live canvas would place the same overlays.
const DEFAULT_STAGE_W = 1024;
const DEFAULT_STAGE_H = 576;

// Truthy only for a populated array OR a populated object. Used so we MERGE a
// supplied coordinate matrix but never clobber a stored one with an empty {}/[]
// on the design-time calls that fire before the user has touched the canvas.
function hasContent(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v as Record<string, unknown>).length > 0;
  return false;
}

// A layer_layout "has real positions" only when at least one view carries
// overlays. An empty {} or a view with zero overlays counts as no layout, so the
// default-seeding below treats it as fair game.
function hasPositionedLayout(layout: unknown): boolean {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) return false;
  const views = Object.values(layout as Record<string, { overlays?: unknown[] }>);
  return views.some((v) => Array.isArray(v?.overlays) && v.overlays.length > 0);
}

// Build a default coordinate matrix from the separated overlays so the canvas
// (RevisionStudioIQ / LayerLiftRevisionStudio) and the slicer have positioned,
// movable nodes the instant assets are saved. Keyed under "driver-side" (the
// slicer's primary panel id). Positions are a starting point; the user's canvas
// edits overwrite them via persistViewLayout.
function defaultLayoutFromOverlays(overlays: OverlayPng[]): Record<string, unknown> {
  const nodes: LayoutNode[] = (overlays || []).map((o, i) => ({
    id: o.id || `ov_${i}`,
    url: o.url,
    x: 280,
    y: 220 + i * 150,
    // Logos get the 360px display cap (mirrors LayerLiftCanvas); text/taglines
    // keep natural width (undefined) so long lockups aren't squashed.
    ...(o.kind === "logo" ? { width: 360 } : {}),
    isLogo: o.kind === "logo",
    text: o.text || o.role || "",
  }));
  return { "driver-side": { stageWidth: DEFAULT_STAGE_W, stageHeight: DEFAULT_STAGE_H, overlays: nodes } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Build a Layer-1-text-free manifest from the separated overlays: Layer 0 is the
// clean background (image only); text & logos live on Layer 1. This is exactly
// the shape the Phase 6 slicer's assertNoTextInLayer1 guard expects, so a baked
// text leak would FAIL the manufacturing build rather than print garbage.
function manifestFromOverlays(overlays: OverlayPng[]): unknown[] {
  return [
    { index: 0, role: "background", elements: [{ type: "image", label: "clean background" }] },
    {
      index: 1,
      role: "overlay",
      elements: (overlays || []).map((o) => ({
        type: o.kind === "logo" ? "logo" : "text",
        label: o.role || o.text || "overlay",
      })),
    },
  ];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: PersistRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const generationId = (body.generation_id || "").trim();
  if (!generationId) return json({ error: "generation_id required" }, 400);

  const sb = createExternalClient();

  try {
    const incomingOverlays = Array.isArray(body.overlay_pngs) ? body.overlay_pngs : [];

    // Find the current row for this generation (if any). Pull layer_layout +
    // overlay_pngs too so the default-seeding never clobbers a stored coordinate
    // matrix and the lift-merge below can preserve an uploaded logo.
    const { data: current } = await sb
      .from("design_generation_assets")
      .select("id, iteration_index, layer_layout, overlay_pngs, alternate_overlays, hero_scrubbed")
      .eq("generation_id", generationId)
      .eq("is_current", true)
      .order("iteration_index", { ascending: false })
      .limit(1)
      .maybeSingle();

    // LIFT MERGE: designpro-clean-views sends the REAL brand marks it sliced off
    // the paint as overlay_pngs with overlay_source="lift". Never clobber the
    // customer's own uploaded logo (id "upload-…") with a lifted duplicate — if an
    // upload is already present the upload wins and the lifted set is dropped (no
    // double logo). With no upload, the lifted set REPLACES the regenerated
    // text-layer overlays, so the floating layer becomes the real sliced branding.
    // OVERLAY PRECEDENCE (canonical): UPLOAD > LIFT > regenerated text-layer.
    // The lift is the REAL brand mark sliced off the paint; a regenerated
    // text-layer set must NEVER overwrite it. Previously only a "lift" call was
    // guarded (against uploads), so when text-layer-generate persisted AFTER
    // clean-views it clobbered the lifted overlay with slop — the ~50% "slop
    // overlay" race. Existing kinds are detected by id prefix ("upload-"/"lift-")
    // since overlay_source isn't stored on the row.
    const existing = Array.isArray(current?.overlay_pngs)
      ? (current!.overlay_pngs as OverlayPng[])
      : [];
    const existingHasUpload = existing.some(
      (o) => typeof o?.id === "string" && o.id.startsWith("upload-"),
    );
    const existingIsLifted = existing.some(
      (o) => typeof o?.id === "string" && o.id.startsWith("lift-"),
    );
    // STEP A — SAVE BOTH: whichever overlay set LOSES the precedence (upload >
    // lift > regenerated text-layer) is NOT discarded — it becomes an ALTERNATE
    // (the 2nd-choice Design Element the RevisionStudio "Design Elements" card
    // lets the user swap to). `displaced` is the losing set; it's merged into
    // alternate_overlays (kept OUT of overlay_pngs so the canvas never doubles).
    let overlays = incomingOverlays;
    let displaced: OverlayPng[] = [];
    if (body.overlay_source === "lift" && incomingOverlays.length) {
      if (existingHasUpload) {
        overlays = existing;          // the customer's upload wins
        displaced = incomingOverlays; // the lift becomes an alternate
      } else {
        overlays = incomingOverlays;  // lift wins (the real sliced brand mark)
        displaced = existing;         // the displaced (text-layer) set → alternate
      }
    } else if (incomingOverlays.length) {
      if (existingHasUpload || existingIsLifted) {
        overlays = existing;          // keep the canonical primary
        displaced = incomingOverlays; // the regenerated set → alternate
      } else {
        overlays = incomingOverlays;  // nothing real yet → this becomes primary
      }
    }

    // SCRUB GUARD (user-approved "suppress duplicate overlay"): when clean-views
    // reports the hero could NOT be scrubbed (baked branding still on the base),
    // a regenerated text-layer overlay (id "txt_") would render the SAME wordmark
    // a SECOND time on top of the baked one — the two-logos bug. Demote it to an
    // alternate (kept, swappable) instead of a canvas/production primary. UPLOAD
    // ("upload-"), LIFT ("lift-"), manual edits ("box_") and picked alternates
    // ("alt_") are the customer's REAL branding and are never touched.
    // effectiveScrubbed prefers the value this call carries, else the stored flag,
    // so a txt_ set persisting BEFORE clean-views is still corrected once the row
    // is marked false; null/undefined (unknown) leaves behavior unchanged.
    const effectiveScrubbed =
      body.hero_scrubbed !== undefined ? body.hero_scrubbed : (current as any)?.hero_scrubbed;
    const isRegenTextLayer = (o: OverlayPng) =>
      typeof o?.id === "string" && (o.id.startsWith("txt_") || o.id.startsWith("txt-"));
    let forceWriteOverlays = false;
    if (effectiveScrubbed === false) {
      // When clean-views sends no overlays of its own (the 0-region passthrough),
      // still scan the EXISTING primary for a stranded txt_ wordmark to demote.
      const baseForGuard = overlays.length ? overlays : existing;
      const keep = baseForGuard.filter((o) => !isRegenTextLayer(o));
      const demoted = baseForGuard.filter(isRegenTextLayer);
      // NEVER STRIP THE LAST LAYER: only demote the regenerated txt_ wordmark when
      // a REAL element (lift/upload/manual box_) remains on the canvas. If the
      // txt_ is the only layer, keep it grabbable — a missing layer (Layers = 0)
      // is worse than a possible duplicate, and the real lifted element replaces
      // it the moment the auto-strip succeeds. This prevents the regression where
      // a ClipDrop OOM left the canvas with nothing to edit.
      if (demoted.length && keep.length > 0) {
        overlays = keep;
        displaced = [...displaced, ...demoted];
        forceWriteOverlays = true;
      }
    }

    // Merge the displaced set into the alternates (dedupe by url, flag alternate);
    // never let an alternate duplicate a current primary.
    const existingAlternates: OverlayPng[] = Array.isArray((current as any)?.alternate_overlays)
      ? ((current as any).alternate_overlays as OverlayPng[])
      : [];
    const altByUrl = new Map<string, OverlayPng>();
    for (const o of existingAlternates) if (o?.url) altByUrl.set(o.url, o);
    for (const o of displaced) if (o?.url && !altByUrl.has(o.url)) altByUrl.set(o.url, { ...o, alternate: true });
    const primaryUrls = new Set(overlays.map((o) => o?.url).filter(Boolean));
    const alternates = [...altByUrl.values()].filter((o) => o?.url && !primaryUrls.has(o.url));

    const layerManifest =
      Array.isArray(body.layer_manifest) && body.layer_manifest.length
        ? body.layer_manifest
        : manifestFromOverlays(overlays);

    // Resolve the layer_layout to write:
    //  1. A caller-supplied layout with real positions always wins (canvas edits).
    //  2. Else, when overlays are present, seed a DEFAULT matrix — but only when
    //     the existing row has no positioned layout yet, so a re-save (overlay or
    //     proof URL arriving) never wipes the user's edits.
    let resolvedLayout: Record<string, unknown> | null = null;
    if (hasContent(body.layer_layout)) {
      resolvedLayout = body.layer_layout as Record<string, unknown>;
    } else if (overlays.length && !hasPositionedLayout(current?.layer_layout)) {
      resolvedLayout = defaultLayoutFromOverlays(overlays);
    }

    // Only overwrite fields the caller actually supplied (merge, never clobber).
    const setIfPresent: Record<string, unknown> = {};
    if (body.background_url !== undefined) setIfPresent.background_url = body.background_url;
    // Write overlay_pngs when the caller supplied a set OR when the scrub guard
    // emptied/filtered the primary (forceWriteOverlays) so a demoted txt_ wordmark
    // actually leaves the canvas instead of lingering on the stored row.
    if (overlays.length || forceWriteOverlays) setIfPresent.overlay_pngs = overlays;
    setIfPresent.alternate_overlays = alternates; // Step A: keep the 2nd-choice set
    if (body.hero_scrubbed !== undefined) setIfPresent.hero_scrubbed = body.hero_scrubbed;
    if (Array.isArray(body.panel_zones) && body.panel_zones.length) setIfPresent.panel_zones = body.panel_zones;
    setIfPresent.layer_manifest = layerManifest;
    if (body.proof_2d_url !== undefined) setIfPresent.proof_2d_url = body.proof_2d_url;
    if (body.proof_3d_url !== undefined) setIfPresent.proof_3d_url = body.proof_3d_url;
    if (body.view_urls && Object.keys(body.view_urls).length) setIfPresent.view_urls = body.view_urls;
    if (resolvedLayout) setIfPresent.layer_layout = resolvedLayout;
    if (body.shop_id) setIfPresent.shop_id = body.shop_id;
    if (body.organization_id) setIfPresent.organization_id = body.organization_id;
    if (body.source_prompt !== undefined) setIfPresent.source_prompt = body.source_prompt;

    // UPDATE IN PLACE: same generation, no new iteration requested → merge into
    // the current row (the design-time flow calls twice as overlays arrive).
    if (current && !body.new_iteration) {
      const { error } = await sb
        .from("design_generation_assets")
        .update(setIfPresent)
        .eq("id", current.id);
      if (error) throw new Error(`update: ${error.message}`);
      return json({ id: current.id, generation_id: generationId, iteration_index: current.iteration_index, is_current: true });
    }

    // INSERT a NEW versioned row (first save, or an explicit new iteration).
    const iterationIndex = current ? current.iteration_index + 1 : 0;
    const insertRow: Record<string, unknown> = {
      generation_id: generationId,
      iteration_index: iterationIndex,
      parent_asset_id: current?.id ?? null,
      is_current: true,
      user_id: body.user_id || null,
      shop_id: body.shop_id || null,
      organization_id: body.organization_id || null,
      source: body.source || "designpro",
      source_prompt: body.source_prompt ?? null,
      background_url: body.background_url ?? null,
      overlay_pngs: overlays,
      alternate_overlays: alternates,
      panel_zones: Array.isArray(body.panel_zones) ? body.panel_zones : [],
      layer_manifest: layerManifest,
      layer_layout: resolvedLayout ?? {},
      proof_2d_url: body.proof_2d_url ?? null,
      proof_3d_url: body.proof_3d_url ?? null,
      view_urls: body.view_urls || {},
      hero_scrubbed: body.hero_scrubbed ?? null,
    };
    const { data, error } = await sb
      .from("design_generation_assets")
      .insert(insertRow)
      .select("id")
      .single();
    if (error) {
      // Concurrent first-write for the same generation: a sibling call already
      // created iteration 0, so the unique (generation_id, iteration_index)
      // constraint rejected this INSERT. Re-read the current row and UPDATE it
      // instead — two simultaneous first-saves MERGE rather than deadlock into a
      // row-lock hang/504 (the bug that left overlay_pngs empty).
      const code = (error as { code?: string }).code;
      if (code === "23505" && !body.new_iteration) {
        const { data: raced } = await sb
          .from("design_generation_assets")
          .select("id, iteration_index")
          .eq("generation_id", generationId)
          .eq("is_current", true)
          .order("iteration_index", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (raced) {
          const { error: upErr } = await sb
            .from("design_generation_assets")
            .update(setIfPresent)
            .eq("id", raced.id);
          if (upErr) throw new Error(`update-after-conflict: ${upErr.message}`);
          return json({ id: raced.id, generation_id: generationId, iteration_index: raced.iteration_index, is_current: true });
        }
      }
      throw new Error(`insert: ${error.message}`);
    }
    if (!data) throw new Error("insert: no data returned");
    // The AFTER INSERT trigger demotes the prior current row automatically.
    return json({ id: data.id, generation_id: generationId, iteration_index: iterationIndex, is_current: true });
  } catch (err) {
    console.error("[designpro-persist-assets] error:", err);
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
