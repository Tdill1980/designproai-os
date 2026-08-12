import { supabase } from "@/integrations/supabase/client";
// @ts-ignore -- platform-neutral ESM is shared with the CommonJS worker.
import { runDesignProFlatMasterProducer } from "../../shared/designpro-flat-master-producer.mjs";

/**
 * flatMasterSheet — the ALL-SIDES FLAT MASTER SHEET (roadmap #3, owner spec
 * Trish 2026-07-27: "it's supposed to extract panels from the 2D proof
 * immediately" / "fix the issue at root").
 *
 * This module is Call 8's asset-build tail: it runs IMMEDIATELY after the 2D
 * proof exists (and again whenever the proof changes — every revise), and it is
 * the ONLY place in the panel pipeline where an AI pass runs. Everything
 * downstream (enticePanelsFromProof, production rebuilds) is pure geometric
 * extraction of what this build produced — zero AI, so a panel can never
 * invent a design that differs from the approved proof.
 *
 * PER-SIDE TILES — every side is anchored to that side's OWN approved view and
 * the APPROVED 2D PROOF. The continuous branded artboard is a DRIVER field,
 * not an all-sides sheet, and is NEVER used as a geometric source for hood,
 * roof, front, rear, or passenger (live failure 2026-07-28: treating that
 * driver field as an all-sides master put a giant driver lockup on FRONT):
 *   • RUNG 0 — flatten the side's own approved hi-res view once, then
 *     DETERMINISTICALLY finish it to GENIE trim + 5" mirror bleed with
 *     `panel-artboard-generator step:"gridslice"` (pure pixel math).
 *   • RUNG 1 — when that sidefield cannot land, run `panel-pro-extract
 *     mode:"single"` against that side's code-cropped proof tile (or the whole
 *     approved proof as detector fallback), then apply the same pure finish.
 *   • PASSENGER — a first-class side with its own approved view/proof surface;
 *     never a synthetic driver mirror.
 *
 * Both producer rungs contain exactly one controlled flatten/extract before
 * the pure geometry tail, so `deterministic` remains honestly false. A tile is
 * nevertheless production-eligible when, and only when, its independent judge
 * result is known and passing. Unknown/failed verdicts fall through to an
 * honest gap and can never enter the paid worker.
 *
 * The tiles are then composed into ONE to-scale flat sheet by
 * `/api/compose-master-sheet` (Sharp, ZERO AI) and persisted — sheet URL +
 * exact per-side rectangles + per-tile source URLs — to
 * `color_visualizations.admin_notes.master_sheet`, keyed by the same gid the
 * vault uses. `source_proof_url` is recorded so a new proof (revise)
 * automatically invalidates the sheet and forces a rebuild from the new proof.
 */

export interface MasterSheetTile {
  side: string;
  /** Full-resolution print tile (GENIE trim + bleed baked), the crop source. */
  sourceUrl: string;
  widthIn: number;
  heightIn: number;
  bleedIn: number;
  /** Print rectangle on the composed sheet (pixels). */
  x?: number; y?: number; w?: number; h?: number;
  dpi?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  /** How the tile was produced at BUILD time (sidefield-cut | proof-extract). */
  method: string;
  deterministic: boolean;
  /** True only when this artifact may enter the paid print worker. A single
   *  controlled flatten/extract is allowed, but its judge must be known/pass. */
  productionEligible?: boolean;
  /** Producer-ladder rung that landed this tile (0 sidefield-cut · 1 proof-extract). */
  rung?: number;
  /** The judge's verdict on the landed tile. Unknown verdicts fail closed. */
  qc?: { pass: boolean; known: boolean; reason: string };
  /** Wall-clock for this side's whole ladder (all rungs tried), ms. */
  builtMs?: number;
}

/** One ladder attempt, persisted so "why does this panel look wrong" is a query
 *  (roadmap #6), not screenshot archaeology. Every rung tried on every side
 *  lands here — passes, QC rejections, errors, and honest gaps alike. */
export interface BuildLogEntry {
  side: string;
  rung: number;
  method: string;
  outcome: "pass" | "qc-fail" | "error" | "skip" | "gap";
  ms: number;
  reason?: string;
}

/** Bumped when the ladder architecture changes: a sheet built by an older
 *  builder must REBUILD under the current one even if its proof still matches
 *  (v4 treated one driver field as an all-sides master; v5 let vehicle-view
 *  text overrule the proof and did not QC-retry a mutated proof candidate). */
export const MASTER_SHEET_VERSION = 6;

export interface MasterSheet {
  version: number;
  /** The composed all-sides flat sheet image ("" if the compose endpoint was unreachable — tiles still authoritative). */
  url: string;
  sheetW?: number;
  sheetH?: number;
  ppi?: number;
  tiles: MasterSheetTile[];
  logo_pack: Array<{ url: string; label: string; widthPct: number; heightPct: number }>;
  source_proof_url: string;
  built_at: string;
  /** Total sheet-build wall clock, ms (roadmap #6). */
  build_ms?: number;
  /** Every ladder attempt on every side this build — the debugging query target. */
  build_log?: BuildLogEntry[];
}

const SHEET_SIDES_STANDARD = ["DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "FRONT", "REAR"] as const;
const SHEET_SIDES_TRAILER = ["DRIVER SIDE", "PASSENGER SIDE", "FRONT", "REAR"] as const;

// panel-pro-extract sideKey hints — the structural prompt locates this side on
// the all-sides proof by name.
const SIDE_KEY: Record<string, string> = {
  "DRIVER SIDE": "driver side",
  "PASSENGER SIDE": "passenger side",
  HOOD: "hood",
  ROOF: "roof",
  FRONT: "front",
  REAR: "rear",
};

async function readAdminNotes(gid: string): Promise<Record<string, any> | null> {
  try {
    const { data } = await (supabase as any)
      .from("color_visualizations").select("admin_notes").eq("id", gid).maybeSingle();
    if (!data) return null;
    try {
      return typeof (data as any).admin_notes === "string"
        ? JSON.parse((data as any).admin_notes)
        : ((data as any).admin_notes || {});
    } catch { return {}; }
  } catch { return null; }
}

async function writeMasterSheet(gid: string, sheet: MasterSheet): Promise<void> {
  // Direct client write, same sanctioned pattern as admin_notes.logo_pack (the
  // project is at the edge-function cap; RLS permits the owner's row).
  try {
    const notes = (await readAdminNotes(gid)) || {};
    notes.master_sheet = sheet;
    // A logo pack belongs to exactly one master-sheet build. Unioning it with
    // previous builds kept stale fragments alive after every rebuild. Replace
    // even when the new pack is empty so an old pack can never masquerade as
    // elements lifted from the current proof.
    notes.logo_pack = sheet.logo_pack;
    await (supabase as any)
      .from("color_visualizations").update({ admin_notes: JSON.stringify(notes) }).eq("id", gid);
  } catch { /* non-fatal — the caller still holds the sheet in memory this run */ }
}

/**
 * Read the persisted master sheet for a design. Returns null when none exists
 * or when it is STALE (built from a different proof than `sourceProofUrl`) —
 * a revise mints a new proof, and panels must always match the CURRENT one.
 */
export async function resolveMasterSheet(
  gid: string,
  opts?: { sourceProofUrl?: string | null },
): Promise<MasterSheet | null> {
  const notes = await readAdminNotes(gid);
  const sheet = notes?.master_sheet as MasterSheet | undefined;
  if (!sheet || !Array.isArray(sheet.tiles) || !sheet.tiles.length) return null;
  if ((sheet.version ?? 1) < MASTER_SHEET_VERSION) return null; // built by an older ladder — rebuild
  if (opts?.sourceProofUrl && sheet.source_proof_url && sheet.source_proof_url !== opts.sourceProofUrl) {
    return null; // stale — built from a previous proof
  }
  return sheet;
}

/**
 * Build the all-sides flat master sheet FROM the approved 2D proof.
 * Returns null only when not even one tile could be produced.
 */
export async function buildFlatMasterSheet(params: {
  gid: string;
  /** The approved, dimensioned 2D proof — current-revision binding and
   *  per-side fallback/reference for every tile. */
  proofUrl: string;
  make: string;
  model: string;
  year: string;
  isTrailer?: boolean;
  /** Per-side GENIE trim inches (same panelizer-step-validate source the proof stamps). */
  dims: Record<string, { w: number; h: number }>;
  /** Continuous driver artboard, permitted only as a non-geometric
   *  lockup/detail reference during proof extraction. It is never a panel
   *  source and must not be treated as an all-sides master. */
  fallbackArtboardUrl?: string | null;
  /** The approved per-view render URLs (side / hood_detail / roof / front / rear).
   *  When present, RUNG 0 flattens each side's OWN hi-res view on the Railway
   *  worker (step:"sidefield" → /clean-artboard, 4K, worker-QC'd) — the
   *  cut-only pipeline's single sanctioned AI pass per side. */
  viewUrls?: Record<string, string> | null;
  bleedIn?: number;
}): Promise<MasterSheet | null> {
  const { gid, proofUrl, make, model, dims } = params;
  if (!gid || !proofUrl) return null;
  const bleedIn = params.bleedIn && params.bleedIn > 0 ? params.bleedIn : 5;
  const sheetSides: readonly string[] = params.isTrailer ? SHEET_SIDES_TRAILER : SHEET_SIDES_STANDARD;

  let uid: string | null = null;
  try { const { data: authData } = await supabase.auth.getUser(); uid = authData?.user?.id || null; } catch { /* anon */ }

  // ── TILE PRE-CROP (pure code, one temp-0 box detection): locate each side's
  // tile rectangle on the proof and crop it in code (panelize-artboard). The
  // extractor is then fed ONE side's tile instead of the whole sheet — feeding
  // the full sheet made it grab neighboring tiles and the header (live 07-27
  // Bright Smile Dental: the rear "panel" came back as a crop of the proof
  // sheet itself, upside-down title included). Non-fatal: with no tile crop a
  // side falls back to whole-proof extraction.
  const tileCropBySide = new Map<string, string>();
  try {
    const wanted = sheetSides.filter((s) => dims[s]?.w && dims[s]?.h);
    if (wanted.length) {
      const { data: pz } = await supabase.functions.invoke("panelize-artboard", {
        body: {
          artboardUrl: params.proofUrl, jobId: `${gid}-sheet-tiles`, bleedIn: 0,
          panels: wanted.map((s) => ({ side: s, dimW: dims[s].w, dimH: dims[s].h })),
        },
      });
      for (const p of ((pz as any)?.panels || [])) {
        if (p?.side && p?.panelUrl) tileCropBySide.set(String(p.side), String(p.panelUrl));
      }
    }
  } catch { /* fall back to whole-proof extraction */ }

  // Deterministic finish: GENIE trim aspect cover-crop + 5" mirror bleed —
  // pure pixel math in panel-artboard-generator (retries at lower canvas caps
  // on the 546 worker limit).
  const deterministicFinish = async (
    side: string,
    srcUrl: string,
    w: number,
    h: number,
    variant: string,
  ): Promise<{ url: string; meta: any } | null> => {
    const CAPS = [4000, 3000, 2400];
    for (const cap of CAPS) {
      try {
        const { data: pr } = await supabase.functions.invoke("panel-artboard-generator", {
          body: {
            step: "gridslice", artboardUrl: srcUrl, side, jobId: gid, variant,
            panelWidthIn: w, panelHeightIn: h, bleedInches: bleedIn, maxCanvas: cap,
          },
        });
        if ((pr as any)?.success && (pr as any)?.url) {
          return { url: (pr as any).url, meta: { dpi: (pr as any).effectiveDpi, px: (pr as any).pixelWidth, py: (pr as any).pixelHeight } };
        }
      } catch { /* retry at lower cap */ }
    }
    return null;
  };

  // THE extractor — panel-pro-extract mode:"single" fed the 2D PROOF (the
  // July-23 sanctioned engine): temperature-0 edit, structural prompt that
  // locates the NAMED side on the all-sides proof, GENIE dims injected.
  const extractSideFromProof = async (
    side: string,
    w: number,
    h: number,
    candidate: number,
  ): Promise<string | null> => {
    // The side's own code-cropped proof tile when the detector found it (the
    // reliable path), else the whole proof sheet. Both are the APPROVED PROOF —
    // the tile is just a deterministic crop of it.
    const proofUrlForSide = tileCropBySide.get(side) || proofUrl;
    for (let transportAttempt = 1; transportAttempt <= 2; transportAttempt++) {
      try {
        const { data: px } = await supabase.functions.invoke("panel-pro-extract", {
          body: {
            mode: "single", imageUrl: proofUrlForSide, sourceIsProof: true,
            // The cropped tile is the surface/layout anchor; the complete
            // customer-approved proof is the authoritative design/text
            // context. A vehicle view or driver-only artboard must never
            // overrule it.
            sourceProofUrl: proofUrl,
            proofTile: tileCropBySide.has(side),
            sideKey: SIDE_KEY[side] || side.toLowerCase(),
            widthInches: w, heightInches: h,
            vehicleMake: make, vehicleModel: model,
            // The only available branded artboard is a DRIVER-SIDE field. It may
            // clarify tiny glyph edges for DRIVER SIDE only. Supplying it to any
            // other surface lets the image model absorb the driver lockup and
            // enlarge/recenter it (live 2026-07-28: giant driver logo on FRONT).
            // A caption saying "non-authoritative" is not an isolation boundary;
            // enforce the surface match in code.
            ...(side === "DRIVER SIDE" && params.fallbackArtboardUrl
              ? { lockupRefUrl: params.fallbackArtboardUrl }
              : {}),
            userId: uid || undefined,
            // A QC-rejected candidate must not be overwritten/reused as the
            // next retry. Give every candidate and transport retry its own
            // immutable storage identity.
            jobId: `${gid}-sheet-${side.toLowerCase().replace(/\s+/g, "-")}-c${candidate}-t${transportAttempt}`,
          },
        });
        if ((px as any)?.success && ((px as any)?.panelUrl || (px as any)?.url)) {
          return ((px as any).panelUrl || (px as any).url) as string;
        }
      } catch { /* retry once */ }
    }
    return null;
  };

  // Per-side tile chain: own-view sidefield → deterministic finish → proof
  // extract fallback → deterministic finish. The driver artboard is never a
  // crop source. Sides run CONCURRENTLY (pool of 3) — each extract/finish is
  // its own isolated edge-function worker, so concurrency costs no worker
  // memory; it just cuts the sheet build's wall clock roughly in half (latency
  // concern, Trish 2026-07-27).
  // ── QC GATE (roadmap #4: "flagged artifacts quarantined — no silent flow").
  // A cheap Flash verdict comparing the finished tile against its design
  // reference: same design, exact lockup text, full-bleed, no vehicle/sheet
  // content. Judge errors fail CLOSED: an unavailable validator must never
  // convert an unverified image into a production artifact.
  // The complete approved 2D proof is the sole design/text authority. The
  // side crop is the layout reference; a vehicle-view render is never a text
  // reference because it may itself contain a render typo (live 07-28 Copper
  // Canyon FRONT: correct proof-derived lettering was rejected against the
  // misspelled vehicle view).
  // Retries absorb transient 546/503s from the shared extract isolate, which
  // previously left ~40% of verdicts unverified.
  // JUDGE MUTEX — verdicts run ONE at a time. Three concurrent qcchecks share
  // one panel-pro-extract isolate and OOM it (live 07-28: the three concurrent
  // judges all died WORKER_RESOURCE_LIMIT while both solo judges passed). Each
  // verdict is ~5s and overlaps other sides' flatten/cut work, so serializing
  // costs seconds, not minutes.
  let judgeChain: Promise<unknown> = Promise.resolve();
  const qcCheck = (side: string, panelUrl: string, refUrl: string): Promise<{ pass: boolean; known: boolean; reason: string }> => {
    const run = async () => {
      const body = {
        panelUrl,
        // Side-specific crop for surface/layout comparison.
        refUrl,
        // Complete customer-approved proof for authoritative design/text
        // context. Never substitute the vehicle view here.
        sourceProofUrl: proofUrl,
        side,
      };
      // PRIMARY: the Railway worker judge (real memory, key-pool rotation) via
      // the panel-artboard-generator proxy. The panel-pro-extract in-isolate
      // judge stays as the fallback — its saturated 256MB isolate 546'd even
      // solo verdicts (live 07-28), so it can no longer be the primary.
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const { data: qc } = await supabase.functions.invoke("panel-artboard-generator", {
            body: { step: "paneljudge", ...body },
          });
          if ((qc as any)?.success === true) {
            return { pass: (qc as any).pass === true, known: true, reason: String((qc as any).reason || "") };
          }
        } catch { /* transient — retry */ }
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1200 * attempt));
      }
      try {
        const { data: qc } = await supabase.functions.invoke("panel-pro-extract", {
          body: { mode: "qccheck", ...body },
        });
        if ((qc as any)?.success === true) {
          return { pass: (qc as any).pass === true, known: true, reason: String((qc as any).reason || "") };
        }
      } catch { /* judge unavailable */ }
      return { pass: false, known: false, reason: "judge unavailable — panel quarantined" };
    };
    const next = judgeChain.then(run, run);
    judgeChain = next.catch(() => { /* keep the chain alive */ });
    return next;
  };

  // The approved per-view render for a side — RUNG 0's full-resolution source.
  const VIEW_KEYS: Record<string, string[]> = {
    "DRIVER SIDE": ["side", "driver-side", "driver_side", "driver"],
    "PASSENGER SIDE": ["passenger", "passenger-side", "passenger_side", "opposite_side"],
    HOOD: ["hood_detail", "hood"],
    ROOF: ["roof", "top"],
    FRONT: ["front"],
    REAR: ["rear", "back"],
  };
  const viewUrlForSide = (side: string): string | null => {
    const vu = params.viewUrls || {};
    for (const k of VIEW_KEYS[side] || []) if (vu[k]) return vu[k];
    return null;
  };

  // RUNG 0 — CUT-ONLY primary (owner 2026-07-28 "I need a cut only pipeline"):
  // the side's OWN hi-res approved view is flattened ONCE on the Railway
  // worker (panel-artboard-generator step:"sidefield" → /clean-artboard:
  // 4K, keepBranding, GENERATE→QC→RETRY inside the worker — full memory, full
  // resolution, "the wrong design must never reach the slicer"). Everything
  // after that field is pure geometry.
  const flattenSideField = async (side: string, w: number, h: number): Promise<string | null> => {
    const viewUrl = viewUrlForSide(side);
    if (!viewUrl) return null;
    try {
      const { data: sf } = await supabase.functions.invoke("panel-artboard-generator", {
        body: {
          step: "sidefield", uid: uid || "anonymous", jobId: gid, keepBranding: true,
          sides: [{ side, viewUrl, widthInches: w, heightInches: h }],
        },
      });
      const entry = (sf as any)?.sides?.[side];
      if ((sf as any)?.success && entry?.url) return String(entry.url);
    } catch { /* fall to the next rung */ }
    return null;
  };

  // One shared protected producer owns both the browser compatibility path
  // and the durable server worker's ladder. Three-wide sidefield/panel pools
  // preserve the proven latency envelope without recreating isolate OOMs.
  const buildStart = Date.now();
  const produced = await runDesignProFlatMasterProducer({
    expectedSides: [...sheetSides],
    dimensionsBySide: dims,
    bleedIn,
    sideFieldPool: 3,
    panelPool: 3,
    proofCandidates: 3,
    missingReason:
      "required side missing; master sheet not persisted",
    hasApprovedView: (side: string) => !!viewUrlForSide(side),
    flattenSideField: ({
      side,
      dimensions,
    }: {
      side: string;
      dimensions: { w: number; h: number };
    }) => flattenSideField(side, dimensions.w, dimensions.h),
    getProofReference: ({ side }: { side: string }) => ({
      referenceUrl: tileCropBySide.get(side) || proofUrl,
      proofTile: tileCropBySide.has(side),
    }),
    deterministicFinish: async ({
      side,
      sourceUrl,
      dimensions,
      variant,
    }: {
      side: string;
      sourceUrl: string;
      dimensions: { w: number; h: number };
      variant: string;
    }) => {
      const finished = await deterministicFinish(
        side,
        sourceUrl,
        dimensions.w,
        dimensions.h,
        variant,
      );
      return finished
        ? {
            url: finished.url,
            dpi: finished.meta.dpi,
            pixelWidth: finished.meta.px,
            pixelHeight: finished.meta.py,
          }
        : null;
    },
    extractSideFromProof: ({
      side,
      dimensions,
      candidate,
    }: {
      side: string;
      dimensions: { w: number; h: number };
      candidate: number;
    }) =>
      extractSideFromProof(
        side,
        dimensions.w,
        dimensions.h,
        candidate,
      ),
    judgePanel: ({
      side,
      panelUrl,
      referenceUrl,
    }: {
      side: string;
      panelUrl: string;
      referenceUrl: string;
    }) => qcCheck(side, panelUrl, referenceUrl),
    onWarning: (message: string) => console.warn(message),
  });
  const tiles: MasterSheetTile[] = produced.panels.map(
    ({ url, ...panel }: { url: string; [key: string]: any }) => ({
      ...panel,
      sourceUrl: url,
    }),
  ) as MasterSheetTile[];
  const buildLog = produced.buildLog as BuildLogEntry[];
  if (
    !tiles.length ||
    produced.missing.length ||
    tiles.length !== sheetSides.length
  ) {
    return null;
  }

  // ── COMPOSE the one flat sheet (Sharp, ZERO AI) — best-effort: a compose
  // outage never blocks the panels (the tiles are the authoritative crop
  // sources either way; the sheet is the single visual source of truth).
  let sheetUrl = "";
  let sheetMeta: { sheetW?: number; sheetH?: number; ppi?: number } = {};
  try {
    const r = await fetch("/api/compose-master-sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generation_id: gid,
        tiles: tiles.map((t) => ({ side: t.side, url: t.sourceUrl, widthIn: t.widthIn, heightIn: t.heightIn, bleedIn: t.bleedIn })),
      }),
    });
    if (r.ok) {
      const c = await r.json();
      if (c?.url) {
        sheetUrl = c.url;
        sheetMeta = { sheetW: c.sheetW, sheetH: c.sheetH, ppi: c.ppi };
        const bySide = new Map<string, any>((c.tiles || []).map((t: any) => [String(t.side), t]));
        for (const t of tiles) {
          const p = bySide.get(t.side);
          if (p) { t.x = p.x; t.y = p.y; t.w = p.w; t.h = p.h; }
        }
      }
    }
  } catch { /* non-fatal */ }

  const sheet: MasterSheet = {
    version: MASTER_SHEET_VERSION,
    url: sheetUrl,
    ...sheetMeta,
    tiles,
    // Branding assets are produced later by the round-trip-validated
    // lift-overlays pass on every panel. The former raw driver-tile crops were
    // opaque rectangles and fragmented words, not production logo files.
    logo_pack: [],
    source_proof_url: proofUrl,
    built_at: new Date().toISOString(),
    build_ms: Date.now() - buildStart,
    build_log: buildLog,
  };
  await writeMasterSheet(gid, sheet);
  return sheet;
}
