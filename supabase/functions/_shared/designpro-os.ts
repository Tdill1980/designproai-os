/**
 * designpro-os — the SERVER-SIDE API to the sanctioned DesignPro / RecreatePro
 * design pipeline.
 *
 * WHY THIS EXISTS
 * ApprovePro (and any other tool that needs "design this order") used to carry
 * its OWN copy of the design sequence. That copy drifted: it still ran the
 * pre-design ARTBOARD-FIRST projection (`mode:"artboard"` →
 * `visionboard_intent:"artboard_projection"`) that DesignPro deleted on
 * 2026-07-24 (`hasArtboardInput = false` in useDesignPanelProLogic). The result
 * was a softened, re-interpreted design on ApprovePro orders and — on RECREATE
 * orders — an AI artboard that REDREW the customer's uploaded artwork before it
 * ever reached the vehicle, so every downstream view/proof/panel showed the
 * wrong design.
 *
 * This module is the ONE server-side API for that pipeline. It CALLS the locked
 * functions (`design-panel-ai-generate`, `generate-2d-proof`,
 * `panelizer-step-validate`) — it never reimplements or modifies them, and it
 * holds no product-specific logic. Wiring a tool to the OS means calling here;
 * it must not mean copying the sequence again.
 *
 * THE ARCHITECTURE IT IMPLEMENTS (A.C.E. NATIVE — CLAUDE.md, Trish 2026-07-24):
 *
 *   CUSTOMER'S RAW BRIEF ──▶ A.C.E. (design-panel-ai-generate, mode:"restyle")
 *                                 │  ONE pass, composing ON the vehicle
 *                                 ▼
 *                         HERO RENDER (the design)
 *                                 ▼
 *                    views clone the hero (originalRenderUrl)
 *                                 ▼
 *              generate-2d-proof (GENIE dims) ──emits──▶ artboards
 *                                                        (branded + clean)
 *
 * INVARIANTS (violations are regressions — locked by
 * tests/approvepro-designpro-wiring.test.ts):
 *   1. NO pre-design artboard. This module never sends `mode:"artboard"` and
 *      never sends `visionboard_intent:"artboard_projection"`.
 *   2. The hero is ONE native pass off the raw brief. RECREATE orders feed the
 *      customer's uploads as `visionBoardImages` + `exact_reference` so the
 *      upload itself is the reference — nothing redraws it first.
 *   3. Views CLONE the hero (`originalRenderUrl`), they do not re-interpret the
 *      brief per angle.
 *   4. The ONLY artboards are the ones `generate-2d-proof` emits FROM the
 *      approved design, keyed to the CANONICAL DesignIQ generation id.
 *   5. Canonical-id linkage is mandatory: the color_visualizations row carries
 *      `admin_notes.designiq_generation_id` so Build Assets / PanelPro / the DID
 *      resolve the same design (the RecreatePro reconnection, applied here too).
 */

export type DesignRoute = "designpro" | "recreatepro";

export interface DesignVehicle {
  year?: string | number | null;
  make?: string | null;
  model?: string | null;
}

export interface DesignProOsAuth {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  /** A REAL user session bearer — design-panel-ai-generate rejects service role. */
  renderAuth: string;
}

export interface RunDesignJobInput extends DesignProOsAuth {
  brief: string;
  /** Customer-uploaded artwork / references. Non-empty ⇒ RecreatePro route. */
  uploads?: string[];
  vehicle: DesignVehicle;
  finish?: string;
  /** How literally to honor the uploads. Defaults to exact_reference. */
  routeIntent?: "exact_reference" | "style_inspiration";
  /**
   * RECREATE + EDITS: the discrete change list applied as a SECOND pass on the
   * faithful clone (the RecreatePro mechanism — an exact_reference render's
   * "match the original" instruction overrides edits in the same prompt).
   */
  editInstructions?: string;
  /** Trailer/flat-sided bodies have no hood or roof to wrap. */
  isTrailer?: boolean;
  /**
   * Fired as soon as the HERO exists (after any recreate edit pass) and BEFORE
   * the clone stage. Callers persist here so a proof lands fast and survives a
   * timeout in the view stage — the hero must never be lost waiting on angles.
   * Best-effort: a throw is logged and the view stage continues.
   */
  onHero?: (hero: { url: string; designName: string | null; generationId: string | null }) => void | Promise<void>;
  log?: (msg: string) => void;
}

export interface RunDesignJobResult {
  route: DesignRoute;
  heroUrl: string | null;
  designName: string | null;
  /** Every view that rendered, keyed by viewType (plus hero/side aliases). */
  renderUrls: Record<string, string>;
  /** CANONICAL DesignIQ generation id from the hero render. */
  designiqGenerationId: string | null;
  failedViews: string[];
  error?: string;
}

const HERO_VIEW = "side";

/**
 * ROUTE — uploads present means the customer supplied artwork to reproduce
 * (RecreatePro); a text brief alone is a from-scratch DesignPro design.
 */
export function routeDesignJob(uploads?: string[] | null): DesignRoute {
  return Array.isArray(uploads) && uploads.length > 0 ? "recreatepro" : "designpro";
}

/**
 * The canonical extra views for a job (the hero is rendered separately).
 * Trailers get sides + front + rear only — no hood, no roof.
 */
export function canonicalViewsFor(route: DesignRoute, isTrailer = false): string[] {
  const base = isTrailer
    ? ["front", "rear", "close-up"]
    : ["hood_detail", "front", "rear", "close-up", "roof"];
  // Both routes render a real passenger side by cloning the hero, so the text
  // reads forward instead of being a raw mirror of the driver plate.
  return ["passenger-side", ...base];
}

function viewLabel(v: string): string {
  return v.replace(/[^a-z0-9_-]/gi, "");
}

/**
 * ONE call into the locked render engine. `originalRenderUrl` set ⇒ this is a
 * CLONE of the hero at a new camera angle (views 2..n); unset ⇒ this is the
 * native hero pass off the raw brief.
 */
async function callRender(
  auth: DesignProOsAuth,
  payload: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<{ url: string | null; designName: string | null; generationId: string | null; error?: string }> {
  try {
    const r = await fetch(`${auth.supabaseUrl}/functions/v1/design-panel-ai-generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth.renderAuth,
        apikey: auth.anonKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json().catch(() => ({}));
    const url = j?.renderUrl || j?.render_url || null;
    if (!r.ok || !url) {
      return {
        url: null,
        designName: null,
        generationId: null,
        error: j?.error || j?.message || `HTTP ${r.status}`,
      };
    }
    return {
      url,
      designName: j?.designName || null,
      generationId: j?.generationId || j?.designiq_generation_id || null,
    };
  } catch (e) {
    return { url: null, designName: null, generationId: null, error: (e as any)?.message || "render call failed" };
  }
}

/**
 * DESIGN — hero (native, one pass) then the cloned view set.
 *
 * This is the whole design half of the pipeline. Callers own persistence; this
 * function only produces images + the canonical id, so it stays product-agnostic.
 */
export async function runDesignJob(input: RunDesignJobInput): Promise<RunDesignJobResult> {
  const log = input.log || (() => {});
  const uploads = (input.uploads || []).filter((u) => typeof u === "string" && /^https?:/.test(u));
  const route = routeDesignJob(uploads);
  const finish = input.finish || "Gloss";
  const vehicle = {
    vehicleYear: input.vehicle?.year ? String(input.vehicle.year) : undefined,
    vehicleMake: input.vehicle?.make || undefined,
    vehicleModel: input.vehicle?.model || undefined,
  };

  // INVARIANT 2 — the hero is ONE native A.C.E. pass off the RAW brief. On the
  // recreate route the customer's own uploads ride as the reference; nothing
  // paints a flat sheet first and nothing re-interprets it.
  const visionBoardImages = uploads.slice(0, 6).map((url, i) => ({
    slotLabel: `reference_${i + 1}`,
    storageUrl: url,
  }));

  log(`designpro-os: route=${route} (${uploads.length} upload(s)) — native hero pass`);

  const hero = await callRender(input, {
    mode: "restyle",
    prompt: String(input.brief || "").slice(0, 1500),
    finish,
    ...vehicle,
    viewType: HERO_VIEW,
    ...(route === "recreatepro"
      ? {
          visionBoardImages,
          visionboard_intent: input.routeIntent || "exact_reference",
        }
      : {}),
  });

  if (!hero.url) {
    log(`designpro-os: hero failed — ${hero.error || "no url"}`);
    return {
      route,
      heroUrl: null,
      designName: null,
      renderUrls: {},
      designiqGenerationId: null,
      failedViews: [HERO_VIEW],
      error: hero.error || "hero view failed to render",
    };
  }

  // RECREATE + EDITS (two-pass) — apply the discrete change list ON the faithful
  // clone. Same mechanism RecreatePro uses: originalRenderUrl + the edit list.
  // Best-effort: a failed pass keeps the clean clone rather than losing it.
  let heroUrl = hero.url;
  if (route === "recreatepro" && input.editInstructions && input.editInstructions.trim()) {
    const revised = await callRender(input, {
      mode: "restyle",
      prompt: input.editInstructions.trim().slice(0, 1500),
      originalRenderUrl: hero.url,
      finish,
      ...vehicle,
      viewType: HERO_VIEW,
    });
    if (revised.url) {
      heroUrl = revised.url;
      log("designpro-os: recreate edit pass applied to the hero");
    } else {
      log(`designpro-os: recreate edit pass failed (${revised.error || "no url"}) — keeping the clone`);
    }
  }

  const renderUrls: Record<string, string> = {
    hero: heroUrl,
    side: heroUrl,
  };

  // HERO-FIRST PERSISTENCE — hand the hero back before the clone stage so the
  // caller can save a usable proof immediately.
  if (input.onHero) {
    try {
      await input.onHero({ url: heroUrl, designName: hero.designName, generationId: hero.generationId });
    } catch (e) {
      log(`designpro-os: onHero hook threw (non-fatal): ${(e as any)?.message || e}`);
    }
  }

  // INVARIANT 3 — every other view CLONES the hero. The brief is NOT re-sent
  // per angle (that is what made sides disagree with each other).
  const extras = canonicalViewsFor(route, input.isTrailer);
  const failedViews: string[] = [];
  const results = await Promise.all(
    extras.map(async (viewType) => {
      const r = await callRender(input, {
        mode: "restyle",
        prompt:
          "Reproduce this exact wrap design on the vehicle at the requested camera angle. Same graphics, colors, logos and text — do not redesign.",
        originalRenderUrl: heroUrl,
        finish,
        ...vehicle,
        viewType,
      });
      return { viewType, url: r.url, error: r.error };
    }),
  );
  for (const r of results) {
    if (r.url) renderUrls[viewLabel(r.viewType)] = r.url;
    else {
      failedViews.push(r.viewType);
      log(`designpro-os: view ${r.viewType} failed — ${r.error || "no url"}`);
    }
  }
  // A passenger clone that didn't land falls back to the hero so the proof sheet
  // still has both sides (honest duplicate, never an invented design).
  if (!renderUrls["passenger-side"]) renderUrls["passenger-side"] = heroUrl;

  log(`designpro-os: ${Object.keys(renderUrls).length} view(s) ready, ${failedViews.length} failed`);

  return {
    route,
    heroUrl,
    designName: hero.designName,
    renderUrls,
    designiqGenerationId: hero.generationId,
    failedViews,
  };
}

/**
 * GENIE DIMS — the ONE dimension source (panelizer-step-validate). The same
 * numbers get stamped on the 2D proof and on every panel, so proof dims ==
 * panel dims by construction. Never throws; returns undefined when unresolved.
 */
export async function resolveGenieDims(
  auth: Pick<DesignProOsAuth, "supabaseUrl" | "anonKey" | "serviceRoleKey">,
  vehicle: DesignVehicle,
  log: (msg: string) => void = () => {},
): Promise<Record<string, number> | undefined> {
  if (!vehicle?.make || !vehicle?.model) return undefined;
  try {
    const vr = await fetch(`${auth.supabaseUrl}/functions/v1/panelizer-step-validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.serviceRoleKey}`,
        apikey: auth.anonKey,
      },
      body: JSON.stringify({
        vehicleMake: vehicle.make,
        vehicleModel: vehicle.model,
        vehicleYear: vehicle.year || null,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const vj = await vr.json().catch(() => ({}));
    const ed = vj?.estimatedDimensions;
    if (!vr.ok || !ed || !(ed.bodyLengthInches || ed.sideLengthInches)) {
      log("designpro-os: panelizer-step-validate returned no dims");
      return undefined;
    }
    const dims: Record<string, number> = {
      sideW: ed.bodyLengthInches ?? ed.sideLengthInches,
      sideH: ed.bodyHeightInches ?? ed.sideHeightInches,
      hoodW: ed.hoodWidthInches,
      hoodL: ed.hoodLengthInches,
      roofW: ed.roofWidthInches,
      roofL: ed.roofLengthInches,
      backW: ed.backWidthInches,
      backH: ed.backHeightInches,
    };
    for (const k of Object.keys(dims)) {
      if (dims[k] == null || Number.isNaN(Number(dims[k]))) delete dims[k];
    }
    const total = Number(vj?.totalSqFt ?? ed.totalSqFt);
    if (Number.isFinite(total) && total > 0) dims.totalSqFt = total;
    log(`designpro-os: GENIE dims resolved (side ${dims.sideW}"×${dims.sideH}")`);
    return dims;
  } catch (e) {
    log(`designpro-os: GENIE dims failed (non-fatal): ${(e as any)?.message || e}`);
    return undefined;
  }
}

export interface CanonicalIdentity {
  designiqGenerationId: string | null;
  /** The brief the design was made from — DesignPro stores this as original_prompt. */
  originalPrompt?: string | null;
  /** restyle | commercial | … — mirrors DesignPro's designiq_mode. */
  designiqMode?: string;
  /** Which tool produced the row, for provenance. */
  toolSource?: string;
  /** Extra provenance merged into admin_notes verbatim (e.g. proof_id). */
  extra?: Record<string, unknown>;
}

/**
 * CANONICAL IDENTITY — write the DesignIQ back-link (and the rest of the
 * identity block DesignPro writes) onto the color_visualizations row.
 *
 * `color_visualizations` has no designiq_generation_id / original_prompt
 * COLUMNS — both live in the admin_notes JSON, and that back-link is what
 * generate-2d-proof, buildProductionPanels, DesignAssetsPanel and the DID
 * helper all resolve through. Without it every
 * `designiq_generations.update().eq("id", <CV id>)` silently no-ops, both
 * artboard columns stay NULL, and the row is an orphan: no artboards, no
 * panels, not revisable. Shape matches useDesignPanelProLogic's adminNotes.
 */
export async function linkCanonicalDesign(
  db: any,
  visualizationId: string,
  identity: CanonicalIdentity,
  log: (msg: string) => void = () => {},
): Promise<void> {
  if (!visualizationId) return;
  try {
    const { data: row } = await db
      .from("color_visualizations")
      .select("admin_notes")
      .eq("id", visualizationId)
      .maybeSingle();
    let notes: Record<string, unknown> = {};
    try {
      notes = typeof row?.admin_notes === "string" ? JSON.parse(row.admin_notes) : ((row?.admin_notes as any) || {});
    } catch {
      notes = {};
    }
    if (identity.designiqGenerationId) notes.designiq_generation_id = identity.designiqGenerationId;
    notes.designiq_mode = identity.designiqMode || "restyle";
    notes.original_prompt = identity.originalPrompt ?? null;
    if (identity.toolSource) notes.tool_source = identity.toolSource;
    if (identity.extra) Object.assign(notes, identity.extra);
    await db.from("color_visualizations").update({ admin_notes: JSON.stringify(notes) }).eq("id", visualizationId);
    log(
      identity.designiqGenerationId
        ? `designpro-os: canonical identity written (designiq ${identity.designiqGenerationId})`
        : "designpro-os: canonical identity written WITHOUT a designiq id — the render engine returned none",
    );
  } catch (e) {
    log(`designpro-os: canonical identity write failed (non-fatal): ${(e as any)?.message || e}`);
  }
}

export interface TwoDProofInput extends Pick<DesignProOsAuth, "supabaseUrl" | "anonKey" | "serviceRoleKey"> {
  /** The on-vehicle angle renders. Artboard keys are stripped automatically. */
  viewUrls: Record<string, string>;
  heroUrl: string;
  vehicle: DesignVehicle;
  designName?: string | null;
  finish?: string;
  shopName?: string;
  dimensions?: Record<string, number>;
  revisionNote?: string;
  previousProofUrl?: string;
  /**
   * The color_visualizations id (or the canonical DesignIQ id). generate-2d-proof
   * resolves the canonical id through admin_notes.designiq_generation_id, so
   * linkCanonicalDesign() must have run first.
   */
  visualizationId?: string;
  log?: (msg: string) => void;
}

/** Artboards are giant print sheets, not vehicle views — feeding them to the
 *  proof step blew past the 256MB worker limit (the 546 OOM). */
const ARTBOARD_KEYS = new Set(["master_artboard", "production_artboard", "artboard", "flat_artboard"]);

/**
 * THE 2D PRODUCTION PROOF (call 8) — the flat orthographic painter, which also
 * emits the branded + clean artboards and persists them on the canonical row.
 * This is the ONLY sanctioned producer of both the proof and the artboards;
 * `api/compose-2d-proof` is an image stacker and must never stand in for it.
 */
export async function runTwoDProof(input: TwoDProofInput): Promise<{
  proofUrl: string | null;
  artboardCleanUrl: string | null;
  artboardBrandedUrl: string | null;
  error?: string;
}> {
  const log = input.log || (() => {});
  const proofViewUrls: Record<string, string> = Object.fromEntries(
    Object.entries(input.viewUrls || {}).filter(
      ([k, v]) => !ARTBOARD_KEYS.has(k) && typeof v === "string" && /^https?:/.test(v),
    ),
  );
  try {
    const r = await fetch(`${input.supabaseUrl}/functions/v1/generate-2d-proof`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.serviceRoleKey}`,
        apikey: input.anonKey,
      },
      body: JSON.stringify({
        allViewUrls: proofViewUrls,
        sideUrl: input.heroUrl,
        vehicleYear: input.vehicle?.year ? String(input.vehicle.year) : undefined,
        vehicleMake: input.vehicle?.make || undefined,
        vehicleModel: input.vehicle?.model || undefined,
        designName: input.designName || undefined,
        finish: input.finish || "Gloss",
        shopName: input.shopName || undefined,
        dimensions: input.dimensions,
        revisionNote: input.revisionNote,
        previousProofUrl: input.previousProofUrl,
        designiqGenerationId: input.visualizationId || undefined,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.proofUrl) {
      const error = j?.error || j?.message || `HTTP ${r.status}`;
      log(`designpro-os: 2D proof failed — ${error}`);
      return { proofUrl: null, artboardCleanUrl: null, artboardBrandedUrl: null, error };
    }
    log(`designpro-os: 2D proof ready${j?.artboardCleanUrl ? " (+ clean artboard)" : ""}`);
    return {
      proofUrl: j.proofUrl,
      artboardCleanUrl: j.artboardCleanUrl || null,
      artboardBrandedUrl: j.artboardBrandedUrl || null,
    };
  } catch (e) {
    const error = (e as any)?.message || "2D proof call failed";
    log(`designpro-os: 2D proof threw — ${error}`);
    return { proofUrl: null, artboardCleanUrl: null, artboardBrandedUrl: null, error };
  }
}
