import { supabase } from "@/integrations/supabase/client";
import { extractTransparentSlice, uploadLiftedAsset } from "@/lib/precise-erase-composite";

/**
 * buildProductionPanels — the deterministic per-side print-panel builder, shared
 * so BOTH the manual "Build Assets" button AND the auto-build after the 8th-call
 * 2D proof produce the EXACT same output through the EXACT same proven edge calls
 * (panelize-artboard / panel-artboard-generator → save-production-panels).
 *
 * SOURCE PRIORITY (Artboard-First permanent fix, 2026-07-22):
 * 1. The design's REAL flat MASTER ARTBOARD (designiq_generations.
 *    master_artboard_url) — the labeled flat sheet design-panel-ai-generate
 *    mode:'artboard' painted FIRST, which every 3D view was PROJECTED from. It is
 *    the design's ORIGIN, so panels sliced from it match the proof by
 *    construction. Sliced via `panelize-artboard`: Gemini is used ONLY as a
 *    temp-0 coordinate engine to locate each side's rectangle; the crop itself is
 *    pure code (the documented "(artboard slice)" path) at GENIE trim + 5" mirror
 *    bleed. DesignPro prompt jobs have this; recreate-class jobs don't.
 *    DUAL OUTPUT: when the PASS-1 CLEAN origin sheet is also persisted
 *    (master_artboard_clean_url), it is sliced too — branded panel →
 *    branding_url (the standard flat hi-res print file), clean logo-free panel
 *    → background_url (the design team's re-compose canvas). Clean is strictly
 *    additive and never affects the branded build.
 * 2. A caller-passed CONTINUOUS artboard (artboardBranded preferred over
 *    artboardClean) → geometric gridslice. Validated first: a portrait-ish source
 *    is a labeled sheet / proof, NOT a continuous artboard, and is REJECTED with
 *    a reason instead of sliced into garbage.
 * 3. reproduce:true (recreate-class, no flat source) → per-side GENIE
 *    reproduction from each side's own approved view (the existing safety net).
 * 4. Nothing valid → built:0 + an HONEST reason. This builder NEVER invents an
 *    artboard via AI anymore (the old internal generate-2d-proof fallback was the
 *    slop source that shipped kaleidoscope panels); the operator uploads the real
 *    panel instead.
 *
 * PASSENGER is a 1:1 deterministic mirror of DRIVER in every path. Writes
 * production_flow_assets (side, dimensions_inches, background_url/branding_url)
 * keyed to the generation id — which is what Revision Studio's Production Layers
 * + PanelPro read. Dims come from panelizer-step-validate (the SAME call the 2D
 * proof stamps), so panel dims == proof dims.
 *
 * Fire-and-forget safe: every step is guarded; a failure just yields fewer panels.
 */

const BUILD_SIDES = ["DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "FRONT", "REAR"] as const;

type PanelOut = {
  side: string;
  cleanUrl?: string;
  brandedUrl?: string;
  widthIn?: number;
  heightIn?: number;
  dpi?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  // Build-run provenance (roadmap #6) — stamped into production_flow_assets.meta_metrics
  // so "is this panel deterministic?" is a QUERY, not screenshot archaeology.
  method?: "artboard-slice" | "mirror" | "driver-forward" | "genie-fill" | "genie-reproduce";
  deterministic?: boolean;
  sourceArtboard?: string;
  bleedIn?: number;
  error?: string;
};

// Storage image-transform rewrite — the panelize-artboard worker must never
// decode a raw 4K Gemini PNG (the documented 546 OOM); the transform re-encodes
// server-side so the slicer receives a safe ≤4096px image. Same trick
// panel-artboard-generator step:"production" uses for its artboard slices.
function to4kTransform(u: string): string {
  return u.includes("/storage/v1/object/")
    ? u.replace("/storage/v1/object/", "/storage/v1/render/image/") +
        (u.includes("?") ? "&" : "?") + "width=4096&height=4096&resize=contain&quality=92"
    : u;
}

// Measure an image's aspect ratio in the browser (naturalWidth needs no CORS).
// Returns null when it can't be measured — callers fail OPEN on null (a network
// hiccup must not zero a build) but fail CLOSED on a confirmed bad shape.
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

// A CONTINUOUS side artboard is always a wide landscape strip (vehicle sides run
// ~2:1 to 4:1; the AI clean artboard is emitted at the nearest wide aspect). A
// labeled multi-panel sheet / 2D proof stacks panels vertically and comes out
// squarish-to-portrait — gridslicing one ships "grid sheet" garbage panels.
const MIN_CONTINUOUS_ASPECT = 1.2;

// Resolve per-side GENIE dims from panelizer-step-validate — the SAME full call
// (all add-ons, sideSize medium) the 2D proof uses, so panel dims == proof dims.
async function resolveGenieDims(
  make: string, model: string, year: string,
): Promise<Record<string, { w: number; h: number }>> {
  const dims: Record<string, { w: number; h: number }> = {};
  try {
    const { data } = await supabase.functions.invoke("panelizer-step-validate", {
      body: {
        vehicleMake: make, vehicleModel: model, vehicleYear: year,
        sideSize: "medium", addHood: true, addRear: true, addFrontBumper: true, addRearBumper: true, addRoof: true,
      },
    });
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
  } catch { /* return whatever resolved */ }
  return dims;
}

export async function buildProductionPanels(params: {
  gid: string;
  make: string;
  model: string;
  year: string;
  allViewUrls?: Record<string, string>;
  artboardCleanUrl?: string | null;
  artboardBrandedUrl?: string | null;
  /**
   * The design's REAL flat master artboard (the labeled sheet the 3D views were
   * projected from). When omitted it is auto-resolved from
   * designiq_generations.master_artboard_url by gid — callers only pass it when
   * they already have it in hand.
   */
  masterArtboardUrl?: string | null;
  /**
   * The PASS-1 CLEAN origin sheet (background artwork only, zero text/logos).
   * When present it is sliced IN ADDITION to the branded sheet, so each side
   * gets a logo-free clean panel (background_url) alongside the standard
   * branded print panel (branding_url). Auto-resolved from
   * designiq_generations.master_artboard_clean_url when omitted.
   */
  masterArtboardCleanUrl?: string | null;
  /**
   * RECREATE-CLASS jobs (RecreatePro): reproduce each panel from ITS OWN
   * approved view via recreatepro-flat-panels instead of gridslicing an
   * AI-invented "continuous artboard" (Gemini cannot faithfully flatten a
   * reproduced design into a sheet — slicing its hallucination shipped panels
   * whose pattern matched nothing). DesignPro-class jobs keep the documented
   * artboardClean gridslice (the 9th call).
   */
  reproduce?: boolean;
  /**
   * Restrict which sides are CROPPED from the flat artboard. When a recreate
   * artboard is SIDE-ONLY (the native hero is a side render, so the emitted flat
   * sheet only contains the driver-side design), asking panelize-artboard to
   * locate FRONT/HOOD/ROOF/REAR on it returns garbage crops — it grabbed the
   * logo region for "FRONT" (the "business-card on every panel" bug). Pass
   * `sliceSides: ["DRIVER SIDE"]` so ONLY the driver side crops from the sheet;
   * passenger mirrors it, and every side NOT listed here reproduces from ITS OWN
   * approved view (requires `reproduce: true`) instead of being mis-cropped or
   * left as a gap. Omit for the normal all-sides gridslice (unchanged default).
   */
  sliceSides?: string[];
  finish?: string;
}): Promise<{ built: number; reason?: string }> {
  const { gid, make, model, year, allViewUrls } = params;
  if (!gid) return { built: 0, reason: "no generation id" };

  // Per-side reference views for reproduce mode (canonical render_urls keys).
  const SIDE_VIEW_KEY: Record<string, string[]> = {
    "DRIVER SIDE": ["side", "hero", "driver-side"],
    "HOOD": ["hood_detail", "hood"],
    "ROOF": ["roof", "top"],
    "FRONT": ["front"],
    "REAR": ["rear", "back"],
  };
  const refForSide = (side: string): string | null => {
    for (const k of SIDE_VIEW_KEY[side] || []) {
      const u = allViewUrls?.[k];
      if (typeof u === "string" && u) return u;
    }
    return null;
  };

  // ── SOURCE 1: the design's REAL flat MASTER ARTBOARD (Artboard-First) ──
  // The labeled flat sheet the 3D views were PROJECTED from — the design's
  // origin, persisted at design time. Auto-resolved by gid when not passed.
  // CANONICAL-AWARE (gap fix 2026-07-24): a recreate-class gid is a
  // color_visualizations id with no designiq row of its own — resolve the
  // canonical DesignIQ id through the admin_notes.designiq_generation_id
  // back-link (the same resolution every reader uses) so the artboard lookup
  // actually hits for RecreatePro/ApprovePro jobs instead of silently missing.
  let artboardGid = gid;
  try {
    const { data: viz } = await (supabase as any)
      .from("color_visualizations")
      .select("admin_notes")
      .eq("id", gid)
      .maybeSingle();
    const raw = (viz as any)?.admin_notes;
    const n = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    if (n?.designiq_generation_id) artboardGid = String(n.designiq_generation_id);
  } catch { /* not a viz id — use gid as-is */ }
  let masterArtboard = params.masterArtboardUrl || null;
  if (!masterArtboard) {
    try {
      const { data: g } = await (supabase as any)
        .from("designiq_generations")
        .select("master_artboard_url")
        .eq("id", artboardGid)
        .maybeSingle();
      masterArtboard = (g as any)?.master_artboard_url || null;
    } catch { /* no designiq row — fall through to the other sources */ }
  }
  // The CLEAN origin sheet is ADDITIVE — resolved separately so a missing
  // column (migration not applied) or missing value can never affect the
  // standard branded build; it just means no clean panels this run.
  let masterArtboardClean = params.masterArtboardCleanUrl || null;
  if (masterArtboard && !masterArtboardClean) {
    try {
      const { data: gc } = await (supabase as any)
        .from("designiq_generations")
        .select("master_artboard_clean_url")
        .eq("id", artboardGid)
        .maybeSingle();
      masterArtboardClean = (gc as any)?.master_artboard_clean_url || null;
    } catch { /* clean panels are optional */ }
  }

  // ── SOURCE 2: a caller-passed CONTINUOUS artboard, VALIDATED ──
  // PREFER the BRANDED artboard (full design + logos + text) so the pre-purchase
  // entice panels keep their branding; the text-free clean artboard is the
  // fallback. NEVER a 3D render — and never an unvalidated sheet: a portrait-ish
  // source is a labeled multi-panel sheet or stacked proof, and gridslicing one
  // ships "grid sheet" garbage panels. This builder NO LONGER invents an
  // artboard via generate-2d-proof when none was passed — that internal AI
  // fallback was the slop source (kaleidoscope panels that matched nothing).
  let continuousArtboard = params.artboardBrandedUrl || params.artboardCleanUrl || null;
  if (continuousArtboard) {
    const aspect = await imageAspect(continuousArtboard);
    if (aspect !== null && aspect < MIN_CONTINUOUS_ASPECT) {
      if (!masterArtboard && !params.reproduce) {
        return {
          built: 0,
          reason: `artboard source rejected (aspect ${aspect.toFixed(2)} — a labeled sheet/proof, not a continuous flat artboard). Upload the real flat panel per side instead.`,
        };
      }
      continuousArtboard = null;
    }
  }

  // TRUSTED SHEET WINS: even when the caller requests reproduce (recreate-class
  // job), a real master artboard or a passed provenance-stamped artboard is the
  // panel source — the deterministic slice beats a GENIE flatten that can bake
  // the vehicle silhouette into the artwork. Reproduce engages ONLY with no
  // trusted sheet (and we never invent a fresh sheet — the chevron bug).
  const useReproduce = !!params.reproduce && !masterArtboard && !continuousArtboard;
  if (!masterArtboard && !continuousArtboard && !useReproduce) {
    return {
      built: 0,
      reason: "no flat source for this design — no master artboard was saved at design time and no continuous artboard was passed. Upload the real flat panel per side (panels are never invented with AI).",
    };
  }
  if (useReproduce && !(allViewUrls && Object.keys(allViewUrls).length)) {
    return { built: 0, reason: "no views to reproduce from" };
  }

  const dims = await resolveGenieDims(make, model, year);
  const out: PanelOut[] = [];
  let driverUrl: string | null = null;
  let driverCleanUrl: string | null = null;
  // Capture WHY a side didn't produce a panel so a built:0 result can report a
  // real reason (the toast on the recreate page shows it) instead of a silent
  // nothing. Most common: recreatepro-flat-panels (Gemini) failing per side, or
  // panelizer-step-validate returning no dims for the vehicle.
  let lastSideError: string | undefined;
  if (Object.keys(dims).length === 0) {
    return { built: 0, reason: `couldn't resolve panel dimensions for ${year} ${make} ${model} (panelizer-step-validate returned none)` };
  }

  // ── MASTER-ARTBOARD SLICE (primary path): pixel-match crops of the origin
  // sheet via panelize-artboard. ONE call per sheet locates every side's
  // rectangle (temp-0 coordinate detection) and CODE-crops the exact artwork
  // pixels at GENIE trim + 5" mirror bleed — zero repaint, so panels match the
  // proof by construction. Passenger is NOT sliced from the sheet; it stays the
  // deterministic mirror of the driver panel below.
  const sliceSheet = async (sheetUrl: string, tag: string): Promise<Record<string, string>> => {
    const res: Record<string, string> = {};
    const sliceSideList = (params.sliceSides || ["DRIVER SIDE", "HOOD", "ROOF", "FRONT", "REAR"]).filter((s) => dims[s]?.w && dims[s]?.h);
    try {
      const { data: pz, error: pzErr } = await supabase.functions.invoke("panelize-artboard", {
        body: {
          artboardUrl: to4kTransform(sheetUrl),
          jobId: gid,
          bleedIn: 5,
          panels: sliceSideList.map((s) => ({ side: s, dimW: dims[s].w, dimH: dims[s].h })),
        },
      });
      if (pzErr || !(pz as any)?.success) {
        lastSideError = `${tag} slice failed: ${pzErr?.message || (pz as any)?.error || "unknown"}`;
      } else {
        for (const p of ((pz as any).panels || [])) {
          if (p?.panelUrl) res[String(p.side)] = p.panelUrl;
          else if (p?.error) lastSideError = `${tag} ${p.side}: ${p.error}`;
        }
      }
    } catch (e: any) {
      lastSideError = `${tag} slice threw: ${e?.message || e}`;
    }
    return res;
  };
  let slicedUrls: Record<string, string> = {};
  // DUAL OUTPUT: the CLEAN origin sheet is sliced IN ADDITION to the branded
  // one — the branded panel stays the standard flat hi-res print file
  // (branding_url); the clean slice fills background_url so the design team
  // has a logo-free canvas per side for vector-template work. Clean is
  // strictly additive: it only runs after a successful branded slice, and any
  // clean failure just leaves background_url = branded (today's behavior).
  let cleanSlicedUrls: Record<string, string> = {};
  if (masterArtboard) {
    slicedUrls = await sliceSheet(masterArtboard, "master-artboard");
    if (masterArtboardClean && Object.keys(slicedUrls).length) {
      cleanSlicedUrls = await sliceSheet(masterArtboardClean, "clean-artboard");
    }
  }
  // Partial success keeps HONEST GAPS (a missing side is skipped, never
  // AI-filled — mixed-provenance panels are worse than a gap the operator can
  // fill by upload). Only a TOTAL slice failure falls back to a validated
  // continuous artboard, if one was passed.
  const masterActive = !!masterArtboard && Object.keys(slicedUrls).length > 0;
  if (masterArtboard && !masterActive && !continuousArtboard && !params.reproduce) {
    return { built: 0, reason: lastSideError || "master artboard slice produced no panels" };
  }
  // Reproduce re-engages when the master slice totally failed on a recreate job.
  const reproduceActive = useReproduce || (!!params.reproduce && !masterActive && !continuousArtboard);

  // MIXED MODE (recreate side-only artboard): sides the caller deliberately
  // EXCLUDED from the artboard slice (params.sliceSides) reproduce from their OWN
  // approved view instead of being mis-cropped off the side sheet or left as a
  // gap. Independent of masterActive — it must fire whether the driver came from
  // the master slice or the continuous-artboard gridslice. Default callers (no
  // sliceSides) never trigger this, so DesignPro/GraphicsPro paths are unchanged.
  const restrictedSlice = Array.isArray(params.sliceSides);
  const reproduceExcluded = (side: string): boolean =>
    restrictedSlice && !!params.reproduce && side !== "PASSENGER SIDE"
    && !(params.sliceSides as string[]).includes(side) && !!refForSide(side);

  // ── REPRODUCE-CLASS BLANK PANEL + FULL LOGO PACK (RecreatePro parity, 2026-07-27) ──
  // Every side built via GENIE reproduction (recreatepro-flat-panels side-mode)
  // previously shipped cleanUrl === brandedUrl — no logo-free panel for the design
  // team, and the Logo Pack only ever got driver-side elements (lifted incidentally
  // to support the passenger mirror). recreatepro-flat-panels ALSO has a "layers"
  // mode (no `side` param): ONE call returns a clean continuous background (logos/
  // text removed, pattern continued — the same technique the 2D-proof clean
  // artboard uses) plus real-pixel, coordinate-locked element crops. Fire it ONCE
  // per job here, fully non-blocking: any failure leaves today's behavior
  // (cleanUrl === brandedUrl, driver-only logo pack) exactly as it was.
  let reproduceCleanBg: string | null = null;
  const usesReproduceAnySide = reproduceActive || (restrictedSlice && !!params.reproduce);
  if (usesReproduceAnySide) {
    try {
      const layersRef = refForSide("DRIVER SIDE") || Object.values(allViewUrls || {}).find((u) => typeof u === "string" && u) || null;
      if (layersRef) {
        const { data: layers } = await supabase.functions.invoke("recreatepro-flat-panels", {
          body: {
            referenceImageUrl: layersRef,
            vehicleYear: year, vehicleMake: make, vehicleModel: model,
            finish: params.finish || "Gloss",
            runId: `${gid}-layers`,
          },
        });
        if ((layers as any)?.success) {
          reproduceCleanBg = (layers as any).backgroundUrl || null;
          const crops: Array<{ label: string; url: string }> = Array.isArray((layers as any).elementCrops) ? (layers as any).elementCrops : [];
          if (crops.length) {
            try {
              const { data: cur } = await (supabase as any).from("color_visualizations").select("admin_notes").eq("id", gid).maybeSingle();
              if (cur) {
                let notes: Record<string, any> = {};
                try { notes = typeof (cur as any).admin_notes === "string" ? JSON.parse((cur as any).admin_notes) : ((cur as any).admin_notes || {}); } catch { notes = {}; }
                const byUrl = new Map<string, any>();
                for (const e of (Array.isArray(notes.logo_pack) ? notes.logo_pack : [])) if (e?.url) byUrl.set(e.url, e);
                for (const c of crops) if (c?.url) byUrl.set(c.url, { url: c.url, label: c.label || "Logo Element" });
                notes.logo_pack = Array.from(byUrl.values());
                await (supabase as any).from("color_visualizations").update({ admin_notes: JSON.stringify(notes) }).eq("id", gid);
              }
            } catch { /* non-fatal — panels still build */ }
          }
        }
      }
    } catch { /* no clean bg / logo pack this run — cleanUrl stays === brandedUrl, unchanged behavior */ }
  }

  for (const side of BUILD_SIDES) {
    const d = dims[side];
    if (!d?.w || !d?.h) continue; // no GENIE dim → skip this side

    // Master-artboard pixel-match crop for this side (primary source).
    // brandedUrl = the standard flat hi-res print panel; cleanUrl = the
    // logo-free slice of the clean origin sheet when it exists (else branded,
    // exactly as before).
    if (side !== "PASSENGER SIDE" && slicedUrls[side]) {
      out.push({
        side, cleanUrl: cleanSlicedUrls[side] || slicedUrls[side], brandedUrl: slicedUrls[side], widthIn: d.w, heightIn: d.h,
        method: "artboard-slice", deterministic: true, sourceArtboard: masterArtboard!, bleedIn: 5,
      });
      if (side === "DRIVER SIDE") {
        driverUrl = slicedUrls[side];
        driverCleanUrl = cleanSlicedUrls[side] || null;
      }
      continue;
    }
    // When the master slice is active, a side it couldn't locate stays an HONEST
    // GAP — no AI fill, no mixed sources. (Passenger still mirrors below.)
    // EXCEPTION: a side the caller intentionally excluded from the slice
    // (sliceSides) reproduces from its own view below instead of gapping.
    if (masterActive && side !== "PASSENGER SIDE" && !reproduceExcluded(side)) continue;

    // PASSENGER is a 1:1 mirror of the driver panel (deterministic, not a 2nd
    // gen). Both variants mirror: branded driver → the standard print panel,
    // and — when a distinct clean driver panel exists — clean driver → the
    // logo-free clean panel. A failed clean mirror just falls back to branded.
    // BACKWARDS-TEXT FIX (Trish 2026-07-24, "passenger side text still
    // backwards"): mirrorpanel flips the WHOLE bitmap — any baked logo/text
    // reverses unless the overlays array carries the real logos to re-drop
    // UN-flipped at the mirrored X. Same fix already in enticePanelsFromProof;
    // this producer (the RevisionStudio "Build print panels" button + recreate
    // path) was still passing overlays:[]. Lift is real-pixel only — never
    // generative. Any lift failure degrades to the plain mirror (old behavior).
    if (side === "PASSENGER SIDE" && driverUrl) {
      try {
        const logoOverlays: Array<{ url: string; xPct: number; yPct: number; wPct: number; anchor: "center" }> = [];
        try {
          const { data: authData } = await supabase.auth.getUser();
          const uid = authData?.user?.id || null;
          if (uid) {
            const { data: det } = await supabase.functions.invoke("extract-logo-elements", {
              body: { approved_render_url: driverUrl, job_id: gid, user_id: uid },
            });
            const raw: any[] = Array.isArray((det as any)?.elements) ? (det as any).elements : [];
            const boxes = raw
              .map((e) => {
                const bb = e?.bounding_box || {};
                const x = bb.x ?? bb.x_percent, y = bb.y ?? bb.y_percent, w = bb.width ?? bb.width_percent, h = bb.height ?? bb.height_percent;
                return [x, y, w, h].every((n: any) => typeof n === "number") ? { box: { xPct: x, yPct: y, wPct: w, hPct: h }, conf: e?.confidence ?? 1, label: String(e?.label || e?.content || e?.type || "Logo") } : null;
              })
              .filter((o: any) => o && o.conf >= 0.5 && o.box.wPct * o.box.hPct <= 0.4 && o.box.wPct * o.box.hPct > 0.0003)
              .slice(0, 8) as Array<{ box: { xPct: number; yPct: number; wPct: number; hPct: number }; label: string }>;
            const liftedPack: Array<{ url: string; label: string; widthPct: number; heightPct: number }> = [];
            for (const { box, label } of boxes) {
              try {
                const { blob } = await extractTransparentSlice(driverUrl, box);
                const lurl = await uploadLiftedAsset(blob, uid);
                logoOverlays.push({
                  url: lurl,
                  xPct: (box.xPct + box.wPct / 2) * 100,
                  yPct: (box.yPct + box.hPct / 2) * 100,
                  wPct: box.wPct * 100,
                  anchor: "center",
                });
                liftedPack.push({ url: lurl, label, widthPct: box.wPct, heightPct: box.hPct });
              } catch { /* skip element */ }
            }
            // LOGO PACK (entice) — persist the real-pixel lifted elements to
            // admin_notes.logo_pack so they show UNDER the panels in
            // RevisionStudio + on the PanelPro board (Trish 2026-07-24: "the
            // extracted logos should be underneath the panels so people are
            // enticed to purchase the cut contour / logo packet"). Pure copy +
            // alpha-key — no heal, no smear. Merge-dedupe, fire-and-forget.
            if (liftedPack.length) {
              try {
                const { data: cur } = await (supabase as any).from("color_visualizations").select("admin_notes").eq("id", gid).maybeSingle();
                if (cur) {
                  let notes: Record<string, any> = {};
                  try { notes = typeof (cur as any).admin_notes === "string" ? JSON.parse((cur as any).admin_notes) : ((cur as any).admin_notes || {}); } catch { notes = {}; }
                  const byUrl = new Map<string, any>();
                  for (const e of (Array.isArray(notes.logo_pack) ? notes.logo_pack : [])) if (e?.url) byUrl.set(e.url, e);
                  for (const l of liftedPack) byUrl.set(l.url, l);
                  notes.logo_pack = Array.from(byUrl.values());
                  await (supabase as any).from("color_visualizations").update({ admin_notes: JSON.stringify(notes) }).eq("id", gid);
                }
              } catch { /* non-fatal — panels still build */ }
            }
          }
        } catch { /* no lift → plain mirror (legacy behavior) */ }
        const mirrorOf = async (srcUrl: string, overlays: any[]): Promise<any | null> => {
          const { data: pr } = await supabase.functions.invoke("panel-artboard-generator", {
            body: { step: "mirrorpanel", backgroundUrl: srcUrl, overlays, side, jobId: gid },
          });
          return (pr as any)?.success && (pr as any)?.url ? (pr as any) : null;
        };
        // BRANDED passenger: the flip reverses the baked text, and the un-flipped
        // logo overlays only correct it when we actually lifted them. With NO
        // overlays a flip ships fully REVERSED text (the "passenger reads
        // backwards" bug, reported 2026-07-24). So mirror the branded panel ONLY
        // when overlays exist; otherwise keep the UN-FLIPPED branded driver — text
        // forward, identical design. A forward non-mirrored passenger beats a
        // mirrored one with backwards text.
        const pb = logoOverlays.length > 0 ? await mirrorOf(driverUrl, logoOverlays) : null;
        const brandedUrl = pb?.url || driverUrl;            // un-flipped fallback = forward text
        // The CLEAN passenger is logo-free, so its flip can never reverse text —
        // mirror it freely for the correct arrangement.
        let pcUrl: string | null = null;
        if (driverCleanUrl && driverCleanUrl !== driverUrl) {
          try { pcUrl = (await mirrorOf(driverCleanUrl, []))?.url || null; } catch { /* branded fallback */ }
        }
        out.push({
          side, cleanUrl: pcUrl || brandedUrl, brandedUrl, widthIn: d.w, heightIn: d.h,
          dpi: Number(pb?.effectiveDpi) || undefined,
          pixelWidth: Number(pb?.pixelWidth ?? pb?.pixelW) || undefined,
          pixelHeight: Number(pb?.pixelHeight ?? pb?.pixelH) || undefined,
          method: pb ? "mirror" : "driver-forward", deterministic: true, bleedIn: 5,
        });
      } catch { /* skip passenger if mirror fails */ }
      continue;
    }
    // Master slice active but no driver panel to mirror — honest gap, don't
    // fall through to a null-source gridslice. (Excluded sides reproduce below.)
    if (masterActive && !reproduceExcluded(side)) continue;

    let url: string | null = null;
    let dpi: number | undefined, pxW: number | undefined, pxH: number | undefined;
    // sideRef non-null ⟺ we intend to reproduce this side from its own view —
    // either a full recreate reproduce, or a slice-excluded side in mixed mode.
    const sideRef = (reproduceActive || reproduceExcluded(side)) ? refForSide(side) : null;
    if (sideRef) {
      // GENIE reproduction from this side's own approved view (recreate-class).
      for (let attempt = 1; attempt <= 2 && !url; attempt++) {
        try {
          const { data: pr } = await supabase.functions.invoke("recreatepro-flat-panels", {
            body: {
              referenceImageUrl: sideRef, side,
              panelW: d.w, panelH: d.h, bleedInches: 5,
              vehicleYear: year, vehicleMake: make, vehicleModel: model,
              finish: params.finish || "Gloss",
              runId: `${gid}-${side.toLowerCase().replace(/\s+/g, "-")}`,
            },
          });
          if ((pr as any)?.success && (pr as any)?.url) {
            url = (pr as any).url;
            dpi = Number((pr as any).effectiveDpi) || undefined;
            pxW = Number((pr as any).pixelW) || undefined;
            pxH = Number((pr as any).pixelH) || undefined;
          } else if ((pr as any)?.error) {
            lastSideError = `${side}: ${(pr as any).error}`;
          }
        } catch (e: any) { lastSideError = `${side}: ${e?.message || e}`; }
      }
    } else {
      for (let attempt = 1; attempt <= 2 && !url; attempt++) {
        try {
          const { data: pr } = await supabase.functions.invoke("panel-artboard-generator", {
            body: {
              step: "gridslice", artboardUrl: continuousArtboard, side, jobId: gid,
              // 4K first (CLAUDE.md: 3000 produced soft ~13 PPI panels on large
              // sides); retry falls back to 3000 if the 4K decode 546s the worker.
              panelWidthIn: d.w, panelHeightIn: d.h, bleedInches: 5, maxCanvas: attempt === 1 ? 4000 : 3000,
            },
          });
          if ((pr as any)?.success && (pr as any)?.url) {
            url = (pr as any).url;
            dpi = Number((pr as any).effectiveDpi) || undefined;
            pxW = Number((pr as any).pixelWidth) || undefined;
            pxH = Number((pr as any).pixelHeight) || undefined;
          } else if ((pr as any)?.error) {
            lastSideError = `${side}: ${(pr as any).error}`;
          }
        } catch (e: any) { lastSideError = `${side}: ${e?.message || e}`; }
      }
    }
    if (url) {
      // Genuine logo-free panel for this side, sliced from the one-time clean
      // background (deterministic gridslice — pure code, no AI). Falls back to
      // cleanUrl === brandedUrl (today's behavior) on any miss.
      let cleanForSide: string | null = null;
      if (reproduceCleanBg && sideRef) {
        try {
          const { data: cs } = await supabase.functions.invoke("panel-artboard-generator", {
            body: { step: "gridslice", artboardUrl: reproduceCleanBg, side, jobId: gid, panelWidthIn: d.w, panelHeightIn: d.h, bleedInches: 5, maxCanvas: 4000 },
          });
          if ((cs as any)?.success && (cs as any)?.url) cleanForSide = (cs as any).url;
        } catch { /* fall back to branded === clean */ }
      }
      out.push({
        side, cleanUrl: cleanForSide || url, brandedUrl: url, widthIn: d.w, heightIn: d.h, dpi, pixelWidth: pxW, pixelHeight: pxH,
        method: sideRef ? "genie-reproduce" : "artboard-slice",
        deterministic: !sideRef,
        sourceArtboard: sideRef ? sideRef : continuousArtboard, bleedIn: 5,
      });
      if (side === "DRIVER SIDE") { driverUrl = url; driverCleanUrl = cleanForSide || driverCleanUrl; }
    }
  }

  const toSave = out.filter((e) => e.cleanUrl || e.brandedUrl);
  if (toSave.length) {
    try {
      await supabase.functions.invoke("save-production-panels", {
        body: { jobId: gid, version: "v1", panels: toSave },
      });
    } catch (e: any) {
      return { built: 0, reason: `panels built but save-production-panels failed: ${e?.message || e}` };
    }
  }
  return {
    built: toSave.length,
    reason: toSave.length === 0
      ? (lastSideError || "every side's panel reproduction returned no image")
      : undefined,
  };
}
