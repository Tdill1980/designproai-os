/**
 * 1/24 MINI WRAP KIT builder — READ-ONLY wrapper that turns a design's
 * EXISTING vault print panels into a to-scale miniature print sheet for
 * 1/24 (or any scale) die-cast / model-kit bodies.
 *
 * SEPARATION CONTRACT (Trish 2026-07-28 — "must be separate from pipeline"):
 *   • READ-ONLY, structurally. This module performs ZERO database writes —
 *     no admin_notes, no production_flow_assets, no marketplace_listings —
 *     and invokes ZERO edge functions (vehicle dims/photo-ID lookups are the
 *     dedicated admin page's job; this lib only SELECTs and composes).
 *   • Panels come ONLY from a COMPLETE, APPROVED atomic pack in the vault
 *     (`production_flow_assets`, same getProductionPanelPackState rules as
 *     the entice card). OWNER SPEC (Trish 2026-07-28): "Read only completed,
 *     approved panel files… Fail safely if a complete approved pack is
 *     unavailable." There is NO relaxed/any-version fallback — a legacy v1
 *     pack printed kaleidoscope-era hood/roof/rear on the first live test,
 *     which is exactly what fail-safe prevents. No pack → HONEST GAP.
 *   • The sheet is composed by /api/compose-mini-sheet (Sharp, ZERO AI):
 *     real GENIE inches ÷ scale, shelf-packed with trim crop marks.
 *   • Never touches Railway, the Studio board, QC, or WrapBox.
 *
 * Consumed ONLY by the dedicated /admin/mini-wrap-kit page and the
 * standalone CLI (tools/mini-wrap-kit/) — never by any pipeline surface.
 */

import { supabase } from "@/integrations/supabase/client";
import { formatDid, parseAdminNotes } from "@/lib/designId";
import {
  getProductionPanelPackState,
  type ProductionFlowAssetRow,
} from "@/lib/productionFlowAssetState";

export interface MiniWrapKitPage {
  url: string;
  page: number;
  widthPx: number;
  heightPx: number;
  tiles: Array<Record<string, unknown>>;
}

/** Per-side trim dims (inches) used to retarget the kit to an exact vehicle. */
export interface MiniKitSideDims {
  sideW?: number; sideH?: number;
  hoodW?: number; hoodH?: number;
  roofW?: number; roofH?: number;
  frontW?: number; frontH?: number;
  rearW?: number; rearH?: number;
}

export interface MiniWrapKitResult {
  built: boolean;
  reason?: string;
  pages?: MiniWrapKitPage[];
  scale?: number;
  dpi?: number;
  paper?: string;
  /** Always "atomic" — the exporter reads only complete approved packs (owner spec). */
  packQuality?: "atomic";
  sides?: Array<{ side: string; realWidthIn: number; realHeightIn: number; miniWidthIn: number; miniHeightIn: number }>;
}

export interface BuildMiniWrapKitOptions {
  /** The render/generation id the vault pack is keyed under (color_visualizations id). */
  generationId: string;
  scale?: number;
  paper?: string;
  dpi?: number;
  title?: string;
  vehicle?: string;
  /**
   * Exact-vehicle retarget (model-car flow): per-side GENIE trim dims for the
   * vehicle the customer's model actually is. When set, each panel is sized to
   * THESE inches ÷ scale (the composer center-crops to the new aspect) instead
   * of the pack's stored dims. Resolved by the page via GENIE — never here.
   */
  dimsOverride?: MiniKitSideDims | null;
}

const SIDE_DIM_KEYS: Record<string, [keyof MiniKitSideDims, keyof MiniKitSideDims]> = {
  "DRIVER SIDE": ["sideW", "sideH"],
  "PASSENGER SIDE": ["sideW", "sideH"],
  HOOD: ["hoodW", "hoodH"],
  ROOF: ["roofW", "roofH"],
  FRONT: ["frontW", "frontH"],
  REAR: ["rearW", "rearH"],
};

/**
 * Resolve the canonical DesignIQ id + current proof URL for a render — the
 * same back-link walk ProductionFlowLayersCard does. SELECT-only.
 */
async function resolveCanonical(generationId: string): Promise<{
  canonical: string;
  proofUrl: string | null;
  vehicle: string;
  title: string;
}> {
  let canonical = generationId;
  let proofUrl: string | null = null;
  let vehicle = "";
  let title = "";
  try {
    const { data } = await (supabase as any)
      .from("color_visualizations")
      .select("admin_notes, vehicle_make, vehicle_model, vehicle_year, design_name")
      .eq("id", generationId)
      .maybeSingle();
    if (data) {
      vehicle = [data.vehicle_year, data.vehicle_make, data.vehicle_model].filter(Boolean).join(" ");
      title = data.design_name || "";
      const notes = parseAdminNotes(data.admin_notes);
      if (notes.designiq_generation_id) canonical = String(notes.designiq_generation_id);
      if (notes.flat_proof_url) proofUrl = String(notes.flat_proof_url);
    }
  } catch { /* not linked — the row's own id is the canonical fallback */ }
  try {
    const { data } = await (supabase as any)
      .from("designiq_generations")
      .select("flat_proof_url")
      .eq("id", canonical)
      .maybeSingle();
    if (data?.flat_proof_url) proofUrl = String(data.flat_proof_url);
  } catch { /* retain admin_notes copy */ }
  return { canonical, proofUrl, vehicle, title };
}

/**
 * Build the mini wrap kit sheet(s) for a design. Honest by construction:
 * returns { built:false, reason } when the design has no COMPLETE APPROVED
 * atomic pack (fail safely — never build from legacy/partial files, never
 * generate anything to fill the gap) or when a side cannot fit the paper at
 * the requested scale. Performs no writes anywhere.
 */
export async function buildMiniWrapKit(opts: BuildMiniWrapKitOptions): Promise<MiniWrapKitResult> {
  const gid = String(opts.generationId || "").trim();
  if (!gid) return { built: false, reason: "generationId required" };
  const scale = Math.max(2, Math.round(opts.scale || 24));

  const { canonical, proofUrl, vehicle, title } = await resolveCanonical(gid);
  const ids = Array.from(new Set([gid, canonical])).sort();

  const { data: rows, error } = await (supabase as any)
    .from("production_flow_assets")
    .select("id, job_id, side, version, dimensions_inches, background_url, branding_url, depth_mask_url, final_pack_url, meta_metrics, created_at")
    .in("job_id", ids)
    .like("version", "v2:%")
    .order("created_at", { ascending: false });
  if (error) return { built: false, reason: `vault read failed: ${error.message}` };
  const allRows = (rows || []) as ProductionFlowAssetRow[];

  // COMPLETE APPROVED ATOMIC PACK ONLY (proof-pinned first, then the newest
  // complete v2 pack). FAIL SAFELY otherwise — no relaxed/legacy fallback.
  let pack = getProductionPanelPackState(allRows, proofUrl);
  if (!pack.hasCompleteAtomicPack && proofUrl) pack = getProductionPanelPackState(allRows);
  if (!pack.hasCompleteAtomicPack) {
    return {
      built: false,
      reason: "No complete approved production pack exists for this design yet — the mini kit only exports finished, approved panels. Build/approve the design's production files first.",
    };
  }
  const packRows: ProductionFlowAssetRow[] = pack.packRows;

  const dimsOv = opts.dimsOverride || null;
  const tiles = packRows
    .map((row) => {
      const di: any = row.dimensions_inches || {};
      const side = String(row.side || "").trim().toUpperCase();
      let widthIn = Number(di.w ?? di.width);
      let heightIn = Number(di.h ?? di.height);
      // Exact-vehicle retarget: use the entered vehicle's GENIE dims when the
      // page resolved them for this side (partial overrides are fine).
      const keys = SIDE_DIM_KEYS[side];
      if (dimsOv && keys && Number(dimsOv[keys[0]]) > 0 && Number(dimsOv[keys[1]]) > 0) {
        widthIn = Number(dimsOv[keys[0]]);
        heightIn = Number(dimsOv[keys[1]]);
      }
      return {
        side,
        // The BRANDED panel is the kit — the blank/clean variant is a
        // production-side asset and never the customer-facing print.
        url: row.branding_url || row.background_url,
        widthIn,
        heightIn,
        bleedIn: Number(di.bleed ?? 5),
      };
    })
    .filter((t) => t.url && t.widthIn > 0 && t.heightIn > 0);
  if (!tiles.length) return { built: false, reason: "vault pack has no usable panels" };

  const res = await fetch("/api/compose-mini-sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generation_id: canonical,
      scale,
      dpi: opts.dpi || undefined,
      paper: opts.paper || undefined,
      title: opts.title || title || undefined,
      vehicle: opts.vehicle || vehicle || undefined,
      did: formatDid(canonical) || undefined,
      tiles,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(payload?.pages) || !payload.pages.length) {
    return { built: false, reason: String(payload?.error || `compose failed (${res.status})`) };
  }

  const round1 = (n: number) => Math.round(n * 100) / 100;
  return {
    built: true,
    pages: payload.pages,
    scale: payload.scale,
    dpi: payload.dpi,
    paper: payload.paper,
    packQuality: "atomic",
    sides: tiles.map((t) => ({
      side: String(t.side),
      realWidthIn: round1(t.widthIn),
      realHeightIn: round1(t.heightIn),
      miniWidthIn: round1(t.widthIn / scale),
      miniHeightIn: round1(t.heightIn / scale),
    })),
  };
}
