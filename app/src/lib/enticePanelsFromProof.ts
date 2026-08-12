import { supabase } from "@/integrations/supabase/client";
import { resolveMasterSheet, type MasterSheet } from "@/lib/flatMasterSheet";

/**
 * enticePanelsFromProof — THE single per-side entice-panel producer.
 *
 * ROOT ARCHITECTURE (roadmap #3, owner spec Trish 2026-07-27: "it's supposed
 * to extract panels from the 2D proof immediately"):
 *
 *   Call 8 — NOT HERE. The master sheet is built by the durable server
 *   workflow (`worker/designpro-entice-workflow.cjs`, stage `panels.build`),
 *   which is the only path handed the 2D proof's exact tile boxes
 *   (`proofTileBoxes`). The browser copy of that ladder invoked
 *   `panelize-artboard` WITHOUT the box manifest, so it fell through to a
 *   vision pass that cannot label the small unlabelled tiles — hood, roof,
 *   front and rear then failed "panel not located" and dropped off RUNG 0.
 *   A second producer in the client is also how one half of a fix kept
 *   shipping without the other half.
 *
 *   Call 9 (THIS function) — ZERO AI, structurally: panels are pure
 *   geometric extractions of that server-built sheet's tiles. No generative
 *   call and no sheet build exists in this file, so a panel can never invent
 *   a design that differs from the sheet — and the sheet is anchored to the
 *   proof the customer signed. No server sheet yet is a reported state, never
 *   a client-side build.
 *
 * DEAD SOURCES (live-confirmed failures, never reintroduce):
 *   • The continuous driver BRANDED/CLEAN ARTBOARD as a cross-side source — it
 *     a new design instead of extracting the proof's (Flamingo Pools
 *     2026-07-27: giant reinvented lockup ≠ the approved proof). It remains
 *     remains only a non-geometric lockup/detail reference.
 *   • The legacy per-side AI flatten at panel time ("genie-reproduce") —
 *     shipped vehicle pictures as panels (Elite Volt hood/front 2026-07-27)
 *     and re-rolled the design on every build.
 *   • A named-rectangle crop of the proof's vehicle-ELEVATION tiles — ships
 *     pictures of the van (wheels/windows/white sheet).
 *
 * Persisted to production_flow_assets (the vault) — the SAME store
 * RevisionStudio's Production Layers, the GENIE progress page, and the
 * PanelPro Studio Board / Railway build read. Fire-and-forget safe.
 */

const STANDARD_SIDES = ["DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "FRONT", "REAR"] as const;
const TRAILER_SIDES = ["DRIVER SIDE", "PASSENGER SIDE", "FRONT", "REAR"] as const;

// A CONTINUOUS artboard is a wide landscape strip; a portrait-ish source is a
// labeled multi-panel sheet / 2D proof — never a sliceable side artwork.
const MIN_CONTINUOUS_ASPECT = 1.2;
function imageAspect(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const im = new window.Image();
      im.onload = () => resolve(im.naturalHeight > 0 ? im.naturalWidth / im.naturalHeight : null);
      im.onerror = () => resolve(null);
      im.src = url;
    } catch { resolve(null); }
  });
}

async function sourceHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Per-side GENIE dims from panelizer-step-validate — the SAME full call the 2D
// proof stamps, so panel dims == proof dims.
async function resolveDims(
  make: string,
  model: string,
  year: string,
  vehicleType?: string,
  bodyText?: string,
): Promise<Record<string, { w: number; h: number }>> {
  const dims: Record<string, { w: number; h: number }> = {};
  const isTrailer = vehicleType === "trailer";
  try {
    const { data } = await supabase.functions.invoke("panelizer-step-validate", {
      body: {
        vehicleMake: make,
        vehicleModel: model,
        vehicleYear: year,
        bodyText: [bodyText, model, vehicleType].filter(Boolean).join(" "),
        sideSize: "medium",
        addHood: !isTrailer,
        addRear: true,
        addFrontBumper: !isTrailer,
        addRearBumper: !isTrailer,
        addRoof: !isTrailer,
      },
    });

    if (isTrailer) {
      // Tall trailer sides may be split into upper/lower roll tiles in data.panels.
      // The proof rectangle is the full physical wall, so use data.vehicle.
      const vehicle = (data as any)?.vehicle || {};
      const sideW = Number(vehicle.bodyLengthInches);
      const sideH = Number(vehicle.bodyHeightInches);
      const wallW = Number(vehicle.backWidthInches);
      const wallH = Number(vehicle.backHeightInches || vehicle.bodyHeightInches);
      if (sideW > 0 && sideH > 0 && wallW > 0 && wallH > 0) {
        dims["DRIVER SIDE"] = { w: sideW, h: sideH };
        dims["PASSENGER SIDE"] = { w: sideW, h: sideH };
        dims.FRONT = { w: wallW, h: wallH };
        dims.REAR = { w: wallW, h: wallH };
      }
      return dims;
    }

    const panels: any[] = Array.isArray((data as any)?.panels) ? (data as any).panels : [];
    const find = (re: RegExp) => panels.find((p) => re.test(`${p.panelKey || ""} ${p.label || ""}`.toLowerCase()));
    const side = find(/driver|(^|[^a-z])side/), hood = find(/hood/), roof = find(/roof|top/), rear = find(/rear|back/), front = find(/front/);
    if (side?.widthInches) {
      dims["DRIVER SIDE"] = { w: side.widthInches, h: side.heightInches };
      dims["PASSENGER SIDE"] = { w: side.widthInches, h: side.heightInches };
    }
    if (hood?.widthInches) dims["HOOD"] = { w: hood.widthInches, h: hood.heightInches };
    if (roof?.widthInches) dims["ROOF"] = { w: roof.widthInches, h: roof.heightInches };
    if (front?.widthInches) dims["FRONT"] = { w: front.widthInches, h: front.heightInches };
    if (rear?.widthInches) dims["REAR"] = { w: rear.widthInches, h: rear.heightInches };
    if (!dims["FRONT"] && dims["REAR"]) dims["FRONT"] = dims["REAR"];
    if (!dims["REAR"] && dims["FRONT"]) dims["REAR"] = dims["FRONT"];
  } catch { /* return whatever resolved */ }
  return dims;
}

// Resolve the CONTINUOUS clean artboard as a non-geometric lockup/detail
// reference only. It is never divided into named vehicle surfaces.
async function resolveArtboardClean(gid: string, passed?: string | null): Promise<string | null> {
  let url = passed || null;
  if (!url) {
    try {
      const { data } = await (supabase as any)
        .from("design_generation_assets").select("background_url").eq("generation_id", gid).maybeSingle();
      url = (data as any)?.background_url || null;
    } catch { /* none */ }
  }
  if (!url) {
    try {
      let canonicalId = gid;
      const { data: cv } = await (supabase as any)
        .from("color_visualizations").select("admin_notes").eq("id", gid).maybeSingle();
      if (cv) {
        let notes: Record<string, any> = {};
        try { notes = typeof (cv as any).admin_notes === "string" ? JSON.parse((cv as any).admin_notes) : ((cv as any).admin_notes || {}); } catch { notes = {}; }
        if (notes?.designiq_generation_id) canonicalId = String(notes.designiq_generation_id);
      }
      const { data: g } = await (supabase as any)
        .from("designiq_generations").select("master_artboard_clean_url").eq("id", canonicalId).maybeSingle();
      url = (g as any)?.master_artboard_clean_url || null;
    } catch { /* none */ }
  }
  if (!url) return null;
  const aspect = await imageAspect(url);
  if (aspect !== null && aspect < MIN_CONTINUOUS_ASPECT) return null; // portrait = a sheet/proof, not sliceable.
  return url;
}

// Resolve the CONTINUOUS *branded* driver artboard as a non-geometric
// lockup/detail reference. It is never a panel source.
async function resolveArtboardBranded(gid: string): Promise<string | null> {
  let url: string | null = null;
  try {
    const { data } = await (supabase as any)
      .from("design_generation_assets").select("branding_url").eq("generation_id", gid).maybeSingle();
    url = (data as any)?.branding_url || null;
  } catch { /* none */ }
  if (!url) {
    try {
      let canonicalId = gid;
      const { data: cv } = await (supabase as any)
        .from("color_visualizations").select("admin_notes").eq("id", gid).maybeSingle();
      if (cv) {
        let notes: Record<string, any> = {};
        try { notes = typeof (cv as any).admin_notes === "string" ? JSON.parse((cv as any).admin_notes) : ((cv as any).admin_notes || {}); } catch { notes = {}; }
        if (notes?.designiq_generation_id) canonicalId = String(notes.designiq_generation_id);
      }
      const { data: g } = await (supabase as any)
        .from("designiq_generations").select("master_artboard_url").eq("id", canonicalId).maybeSingle();
      url = (g as any)?.master_artboard_url || null;
    } catch { /* none */ }
  }
  if (!url) return null;
  const aspect = await imageAspect(url);
  if (aspect !== null && aspect < MIN_CONTINUOUS_ASPECT) return null;
  return url;
}

export async function enticePanelsFromProof(params: {
  gid: string;
  proofUrl: string;
  make: string;
  model: string;
  year: string;
  finish?: string;
  /** Exact vehicle-class contract passed through Call 8. */
  vehicleType?: string;
  /** Original brief / proof context used for stated trailer body length. */
  bodyText?: string;
  allViewUrls?: Record<string, string>;
  /** The continuous text-free artboardClean, when the caller already has it. */
  artboardCleanUrl?: string | null;
  /** Exact dimension tokens returned by the same Call 8 that stamped the proof. */
  dimensionsResolved?: Record<string, number | string | undefined> | null;
  /** Trigger the Railway worker to build hi-res print files after saving (default true). */
  triggerWorker?: boolean;
}): Promise<{ built: number; reason?: string }> {
  const { gid, proofUrl, make, model, year } = params;
  if (!gid) return { built: 0, reason: "missing generation id" };
  const explicitVehicleType = String(params.vehicleType || "").trim().toLowerCase();
  const isTrailer = explicitVehicleType === "trailer" ||
    (!explicitVehicleType && /\btrailer\b/i.test(`${make || ""} ${model || ""}`));
  const expectedSides: readonly string[] = isTrailer ? TRAILER_SIDES : STANDARD_SIDES;

  const stamped = params.dimensionsResolved && typeof params.dimensionsResolved === "object"
    ? params.dimensionsResolved
    : null;
  const dims: Record<string, { w: number; h: number }> = stamped
    ? {
        ...(Number(stamped.sideW) > 0 && Number(stamped.sideH) > 0 ? {
          "DRIVER SIDE": { w: Number(stamped.sideW), h: Number(stamped.sideH) },
          "PASSENGER SIDE": { w: Number(stamped.sideW), h: Number(stamped.sideH) },
        } : {}),
        ...(Number(stamped.hoodW) > 0 && Number(stamped.hoodL) > 0 ? { HOOD: { w: Number(stamped.hoodW), h: Number(stamped.hoodL) } } : {}),
        ...(Number(stamped.roofW) > 0 && Number(stamped.roofL) > 0 ? { ROOF: { w: Number(stamped.roofW), h: Number(stamped.roofL) } } : {}),
        ...(Number(stamped.frontW) > 0 && Number(stamped.frontH) > 0 ? { FRONT: { w: Number(stamped.frontW), h: Number(stamped.frontH) } } : {}),
        ...(Number(stamped.backW) > 0 && Number(stamped.backH) > 0 ? { REAR: { w: Number(stamped.backW), h: Number(stamped.backH) } } : {}),
      }
    : await resolveDims(make, model, year, isTrailer ? "trailer" : explicitVehicleType, params.bodyText || "");
  if (Object.keys(dims).length === 0) {
    return { built: 0, reason: `couldn't resolve panel dimensions for ${year} ${make} ${model}` };
  }
  const missingDimensions = expectedSides.filter((side) => !dims[side]?.w || !dims[side]?.h);
  if (missingDimensions.length) {
    return { built: 0, reason: `incomplete GENIE dimensions: ${missingDimensions.join(", ")}` };
  }

  // ── THE MASTER SHEET — resolve the persisted one (stale-checked against the
  // CURRENT proof) or build it now (the Call 8 tail running late). After this
  // point there is no AI anywhere in this function.
  const sheet: MasterSheet | null = await resolveMasterSheet(gid, { sourceProofUrl: proofUrl || null });
  if (!sheet) {
    // The browser does not build production pixels. When no server-built sheet
    // exists for the current proof, that is a state to report, not a job to do
    // here: the durable entice workflow's `panels.build` owns it, and it is the
    // only path that receives the proof's exact tile boxes.
    return {
      built: 0,
      reason: proofUrl
        ? "no server-built master sheet for the current proof yet — the durable entice workflow owns panels.build"
        : "no 2D proof to extract panels from (generate the proof first)",
    };
  }
  if (!sheet || !sheet.tiles.length) {
    return { built: 0, reason: "master-sheet build produced no tiles (proof extract returned nothing)" };
  }

  // ── PANELS = pure geometric extraction of the master sheet's tiles. Each
  // tile is already the finished print rectangle (GENIE trim + 5" mirror
  // bleed, deterministic pixel math) recorded at its exact sheet rectangle.
  const panels: any[] = [];
  const missingTiles: string[] = [];
  for (const side of expectedSides) {
    const tile = sheet.tiles.find((t) => t.side === side);
    const d = dims[side];
    if (!tile?.sourceUrl) {
      missingTiles.push(side);
      continue;
    }
    panels.push({
      side,
      // A branded tile must never masquerade as the separated clean layer.
      // The clean URL is filled only by the dedicated clean-artboard pass below.
      cleanUrl: null,
      brandedUrl: tile.sourceUrl,
      widthIn: tile.widthIn || d?.w,
      heightIn: tile.heightIn || d?.h,
      dpi: tile.dpi, pixelWidth: tile.pixelWidth, pixelHeight: tile.pixelHeight,
      method: `mastersheet:${tile.method}`,
      // BUILD-RUN PROVENANCE (roadmap #6): ladder rung, judge verdict, and
      // build wall-clock ride into production_flow_assets.meta_metrics so
      // "why does this panel look wrong" is a query, not archaeology.
      rung: tile.rung,
      qc: tile.qc,
      builtMs: tile.builtMs,
      // HONEST FLAG: both sanctioned producers contain one controlled flatten
      // or proof extraction, so they remain deterministic:false even though
      // the sheet→panel tail itself is pure geometry.
      deterministic: tile.deterministic === true,
      // Paid production may consume the sanctioned one-flatten source only
      // after the independent judge returned a known passing verdict.
      productionEligible: tile.productionEligible === true,
      bleedIn: tile.bleedIn ?? 5,
      sourceArtboard: sheet.url || undefined,
    });
  }

  if (missingTiles.length || panels.length !== expectedSides.length) {
    return {
      built: 0,
      reason: `atomic panel build blocked; missing sides: ${missingTiles.join(", ") || "unknown"}`,
    };
  }

  // ── SEPARATED PRODUCTION LAYERS ──────────────────────────────────────────
  // Never slice design_generation_assets.background_url here: RP-101054 proved
  // that legacy field can contain a vehicle, wheels, floor and reflection.
  // Start with each side's QC-passed BRANDED panel and use the existing
  // round-trip-validated overlay lift to produce:
  //   cleanUrl        = artwork with branding removed
  //   overlayManifest = true-alpha logo/text files + placement metadata
  //   brandedUrl      = the original final composite
  // A no-branding side honestly uses the same clean/composite pixels with an
  // empty overlay manifest.
  const separationQueue = [...panels];
  const SEPARATION_POOL = 3;
  await Promise.all(Array.from({ length: Math.min(SEPARATION_POOL, separationQueue.length) }, async () => {
    while (separationQueue.length) {
      const panel = separationQueue.shift();
      if (!panel) break;
      try {
        const { data, error } = await supabase.functions.invoke("panel-artboard-generator", {
          body: {
            step: "liftoverlays",
            generationId: gid,
            jobId: gid,
            side: panel.side,
            brandedUrl: panel.brandedUrl,
            // Staging only: the new separated pack is committed atomically by
            // save-production-panels after every side passes. Never mutate the
            // currently visible v1/v2 vault row during an in-progress rebuild.
            persist: false,
          },
        });
        const separated = data as any;
        if (error || separated?.success !== true) continue;
        const overlays = Array.isArray(separated?.overlays) ? separated.overlays : [];
        if (Number(separated?.lifted || 0) === 0) {
          panel.cleanUrl = panel.brandedUrl;
          panel.overlayManifest = [];
          panel.separationQc = { pass: true, known: true, reason: separated?.reason || "no branding detected" };
        } else if (separated?.cleanUrl && overlays.length > 0 && separated?.qc?.pass !== false) {
          panel.cleanUrl = String(separated.cleanUrl);
          panel.overlayManifest = overlays;
          panel.separationQc = {
            pass: true,
            known: true,
            reason: String(separated?.qc?.reason || "overlay round-trip passed"),
          };
        }
      } catch { /* atomic validation below rejects the missing layer */ }
    }
  }));

  const missingCleanLayers = panels.filter((p) => !p.cleanUrl).map((p) => p.side);
  if (missingCleanLayers.length) {
    return {
      built: 0,
      reason: `atomic panel build blocked; missing separated clean layers: ${missingCleanLayers.join(", ")}`,
    };
  }

  // One immutable identity for the entire pack. Every side, layer and GENIE
  // dimension must derive from this exact source bundle.
  const packSourceHash = await sourceHash({
    proofUrl,
    masterSheetVersion: sheet.version,
    masterSheetUrl: sheet.url,
    sides: expectedSides.map((side) => ({
      side,
      dimensions: dims[side],
      brandedUrl: panels.find((p) => p.side === side)?.brandedUrl,
      cleanUrl: panels.find((p) => p.side === side)?.cleanUrl,
      overlays: panels.find((p) => p.side === side)?.overlayManifest || [],
    })),
    logoPack: sheet.logo_pack.map((logo) => ({
      url: logo.url, label: logo.label, widthPct: logo.widthPct, heightPct: logo.heightPct,
    })),
  });

  // Persist only a complete, synchronized pack. The server writes it under a
  // source-hash version and retires older versions only after the full insert.
  try {
    const { data, error } = await supabase.functions.invoke("save-production-panels", {
      body: {
        jobId: gid,
        version: "v2",
        sourceHash: packSourceHash,
        sourceProofUrl: proofUrl,
        expectedSides: [...expectedSides],
        logoPack: sheet.logo_pack,
        panels,
      },
    });
    if (error || !(data as any)?.success || Number((data as any)?.saved || 0) !== expectedSides.length) {
      return { built: 0, reason: `atomic vault save rejected: ${error?.message || (data as any)?.error || "incomplete write"}` };
    }
  } catch (e: any) {
    return { built: 0, reason: `panels built but vault save failed: ${e?.message || e}` };
  }

  // This browser-side builder ends at the vault. Paid production is owned by
  // run-production-flow mode:"designpro_job", started server-side by the payment
  // webhook. A tab must never be the process manager for Railway activation.

  return { built: panels.length };
}

