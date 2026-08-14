/**
 * WallPro production-pack builder — DETERMINISTIC, client-side, no AI, no edge fn.
 *
 * A wall wrap is a flat rectangle (H×W inches) printed on a 54"-wide roll, so the
 * "panelizer" is pure geometry: split the approved design into ceil(W / 54")
 * vertical panels, each a straight fraction of the source image (the design covers
 * the wall), scaled to its trim size with a mirror bleed all around (reflect the
 * design's own edges outward — never white space, matching the print-shop bleed
 * used by the vehicle pipeline's `panelize-artboard`).
 *
 * This runs in the browser (Canvas + JSZip) because (a) the project is at the
 * Supabase edge-function cap and (b) the $149 pack is an INSTANT download. The
 * panels are working-resolution proofing/print files; a true 1500-DPI pack is the
 * $299 custom-assembly path.
 *
 * The 54" roll width and panel-count math mirror `calculateWallWrapEstimate`
 * in src/lib/quick-quote.ts (the same numbers the on-screen estimate shows).
 */

import JSZip from "jszip";

export const WALL_ROLL_WIDTH_INCHES = 54;

export interface WallPanelPlan {
  index: number;      // 1-based, left → right
  widthInches: number; // trimmed panel width (last panel may be < 54")
  heightInches: number;
}

export interface WallPanelImage extends WallPanelPlan {
  blob: Blob;         // PNG, trim + mirror bleed
  bleedInches: number;
}

/**
 * Pure geometry — how the wall splits into 54"-wide panels. Deterministic and
 * unit-testable (no DOM). Panel i covers wall inches [i*54, min((i+1)*54, W)].
 */
export function planWallPanels(widthInches: number, heightInches: number): WallPanelPlan[] {
  const w = Number(widthInches), h = Number(heightInches);
  if (!(w > 0) || !(h > 0)) return [];
  const count = Math.max(1, Math.ceil(w / WALL_ROLL_WIDTH_INCHES));
  const plans: WallPanelPlan[] = [];
  let remaining = w;
  for (let i = 0; i < count; i++) {
    plans.push({ index: i + 1, widthInches: Math.min(WALL_ROLL_WIDTH_INCHES, remaining), heightInches: h });
    remaining -= WALL_ROLL_WIDTH_INCHES;
  }
  return plans;
}

/** The plain-text panel map / install guide bundled in the ZIP. Pure — testable. */
export function buildPanelMapText(
  designName: string,
  widthInches: number,
  heightInches: number,
  bleedInches: number,
  plans: WallPanelPlan[],
): string {
  const totalSqFt = Math.round((widthInches * heightInches) / 144 * 100) / 100;
  const lines: string[] = [];
  lines.push(`RESTYLEPRO — WALLPRO PRODUCTION PACK`);
  lines.push(`Design: ${designName}`);
  lines.push(`Wall size: ${heightInches}" H × ${widthInches}" W  (${totalSqFt} sq ft)`);
  lines.push(`Material: 54" roll · ${bleedInches}" mirror bleed on every panel`);
  lines.push(`Panels: ${plans.length} (install left → right, edges butt-seamed)`);
  lines.push(``);
  lines.push(`PANEL MAP`);
  lines.push(`─────────`);
  for (const p of plans) {
    lines.push(
      `Panel ${p.index} of ${plans.length}:  ${p.widthInches}" W × ${p.heightInches}" H trim  ` +
      `(+${bleedInches}" bleed → ${p.widthInches + bleedInches * 2}" × ${p.heightInches + bleedInches * 2}" printed)`,
    );
  }
  lines.push(``);
  lines.push(`INSTALL`);
  lines.push(`───────`);
  lines.push(`1. Print each panel at 100% (no scaling) on 54" media.`);
  lines.push(`2. Trim to the inner (trim) size; the bleed is overlap/wrap allowance.`);
  lines.push(`3. Hang Panel 1 at the left edge, plumb. Butt each next panel to it.`);
  lines.push(`4. Squeegee from center out; overlap seams by ~1/2" if required.`);
  return lines.join("\n");
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the design image (CORS or network)."));
    img.src = url;
  });
}

// Draw a source region of `src` onto ctx at (dx,dy), optionally mirrored on each
// axis — the primitive behind the mirror-bleed border.
function drawFlipped(
  ctx: CanvasRenderingContext2D, src: CanvasImageSource,
  sx: number, sy: number, sw: number, sh: number,
  dx: number, dy: number, flipX: boolean, flipY: boolean,
) {
  ctx.save();
  ctx.translate(dx + (flipX ? sw : 0), dy + (flipY ? sh : 0));
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.restore();
}

// Wrap a trim canvas in a `b`-px mirror bleed (reflect its own edges outward).
function withMirrorBleed(trim: HTMLCanvasElement, b: number): HTMLCanvasElement {
  const tw = trim.width, th = trim.height;
  if (!(b > 0)) return trim;
  const bw = Math.min(b, tw), bh = Math.min(b, th);
  const out = document.createElement("canvas");
  out.width = tw + 2 * b;
  out.height = th + 2 * b;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(trim, b, b);                                   // main design, centered
  drawFlipped(ctx, trim, 0, 0, bw, th, b - bw, b, true, false);     // left edge
  drawFlipped(ctx, trim, tw - bw, 0, bw, th, tw + b, b, true, false); // right edge
  drawFlipped(ctx, trim, 0, 0, tw, bh, b, b - bh, false, true);     // top edge
  drawFlipped(ctx, trim, 0, th - bh, tw, bh, b, th + b, false, true); // bottom edge
  drawFlipped(ctx, trim, 0, 0, bw, bh, b - bw, b - bh, true, true);           // TL corner
  drawFlipped(ctx, trim, tw - bw, 0, bw, bh, tw + b, b - bh, true, true);     // TR corner
  drawFlipped(ctx, trim, 0, th - bh, bw, bh, b - bw, th + b, true, true);     // BL corner
  drawFlipped(ctx, trim, tw - bw, th - bh, bw, bh, tw + b, th + b, true, true); // BR corner
  return out;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Panel encode failed"))), "image/png"),
  );
}

/**
 * Slice the design into per-panel PNGs (trim + mirror bleed). Browser-only.
 * `longEdgeCap` bounds each panel's pixel size so large walls don't blow the
 * canvas/memory limit — working-res by design.
 */
export async function sliceWallDesign(params: {
  designUrl: string;
  widthInches: number;
  heightInches: number;
  bleedInches?: number;
  longEdgeCap?: number;
}): Promise<WallPanelImage[]> {
  const { designUrl, widthInches, heightInches } = params;
  const bleedInches = params.bleedInches ?? 2;
  const longEdgeCap = params.longEdgeCap ?? 2400;

  const plans = planWallPanels(widthInches, heightInches);
  if (!plans.length) throw new Error("Enter a valid wall height and width first.");

  const img = await loadImage(designUrl);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  if (!(W > 0) || !(H > 0)) throw new Error("The design image has no dimensions.");

  const out: WallPanelImage[] = [];
  let cursorIn = 0;
  for (const plan of plans) {
    // Source column: this panel's horizontal fraction of the design (full height).
    const sx0 = Math.round((cursorIn / widthInches) * W);
    const sx1 = Math.round(((cursorIn + plan.widthInches) / widthInches) * W);
    const cropW = Math.max(1, Math.min(W - sx0, sx1 - sx0));

    // Trim pixel size at a ppi that keeps the bleed-inclusive long edge <= cap.
    const bwIn = plan.widthInches + bleedInches * 2;
    const bhIn = plan.heightInches + bleedInches * 2;
    const ppi = Math.min(150, longEdgeCap / Math.max(bwIn, bhIn));
    const bleedPx = Math.max(0, Math.round(bleedInches * ppi));
    const tpxW = Math.max(1, Math.round(plan.widthInches * ppi));
    const tpxH = Math.max(1, Math.round(plan.heightInches * ppi));

    const trim = document.createElement("canvas");
    trim.width = tpxW;
    trim.height = tpxH;
    trim.getContext("2d")!.drawImage(img, sx0, 0, cropW, H, 0, 0, tpxW, tpxH); // full column → trim, nothing cropped

    const sized = withMirrorBleed(trim, bleedPx);
    const blob = await canvasToPng(sized);
    out.push({ ...plan, blob, bleedInches });
    cursorIn += plan.widthInches;
  }
  return out;
}

const slug = (s: string) =>
  (s || "wall-design").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "wall-design";

/** Zip already-sliced panels + a panel map into one downloadable Blob. */
export async function zipWallPanels(
  panels: WallPanelImage[],
  meta: { designName: string; widthInches: number; heightInches: number; bleedInches?: number },
): Promise<{ blob: Blob; filename: string; panelCount: number }> {
  const bleedInches = meta.bleedInches ?? panels[0]?.bleedInches ?? 2;
  const plans = panels.map((p) => ({ index: p.index, widthInches: p.widthInches, heightInches: p.heightInches }));
  const zip = new JSZip();
  const n = panels.length;
  for (const p of panels) {
    zip.file(`panels/Panel-${p.index}-of-${n}_${p.widthInches}x${p.heightInches}in.png`, p.blob);
  }
  zip.file(
    "PANEL-MAP.txt",
    buildPanelMapText(meta.designName, meta.widthInches, meta.heightInches, bleedInches, plans),
  );
  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, filename: `wallpro-${slug(meta.designName)}-production-pack.zip`, panelCount: n };
}

/** Full pack: slice + zip in one call. */
export async function buildWallProductionZip(params: {
  designUrl: string;
  designName: string;
  widthInches: number;
  heightInches: number;
  bleedInches?: number;
}): Promise<{ blob: Blob; filename: string; panelCount: number }> {
  const bleedInches = params.bleedInches ?? 2;
  const panels = await sliceWallDesign({ ...params, bleedInches });
  return zipWallPanels(panels, { ...params, bleedInches });
}

/**
 * Persist sliced panels to the shared production_flow_assets vault so the design
 * team can pick a WallPro order up alongside vehicle jobs. Uploads each panel PNG
 * to storage, then inserts a `version:'wallpro'` row per panel — a DIRECT client
 * write, enabled by the scoped INSERT RLS policy
 * (20260725010000_wallpro_production_flow_assets_insert_policy). Best-effort: the
 * customer download never depends on it. Takes the supabase client as a param so
 * this module stays import-light (unit-testable without a DB).
 */
export async function persistWallPanels(opts: {
  supabase: any;
  jobId: string;
  panels: WallPanelImage[];
}): Promise<{ ok: boolean; inserted?: number; error?: string }> {
  const { supabase, jobId, panels } = opts;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "not authenticated" };

    const uploaded: Array<{ url: string; index: number; widthInches: number; heightInches: number; bleedInches: number }> = [];
    for (const p of panels) {
      if (!p.blob) continue;
      const path = `renders/${user.id}/wallpro/panels/${jobId}/panel-${p.index}.png`;
      const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, p.blob, { contentType: "image/png", upsert: true });
      if (upErr) continue;
      const url = supabase.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
      uploaded.push({ url, index: p.index, widthInches: p.widthInches, heightInches: p.heightInches, bleedInches: p.bleedInches });
    }
    if (!uploaded.length) return { ok: false, error: "no panels uploaded" };

    // branding_url / depth_mask_url / final_pack_url are NOT NULL. A wall panel has
    // no separate branded/overlay/final asset — the panel IS the print file — so
    // branding_url mirrors the panel and the other two are "" (same convention as
    // the vehicle run_production vault write).
    const rows = uploaded.map((u) => ({
      job_id: jobId,
      side: `PANEL-${u.index}`,
      version: "wallpro",
      dimensions_inches: { w: u.widthInches, h: u.heightInches, bleed: u.bleedInches },
      background_url: u.url,
      branding_url: u.url,
      depth_mask_url: "",
      final_pack_url: "",
    }));
    const { error: insErr } = await supabase.from("production_flow_assets").insert(rows);
    if (insErr) return { ok: false, error: insErr.message };
    return { ok: true, inserted: rows.length };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
