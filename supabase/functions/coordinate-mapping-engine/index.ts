// ============================================================================
// coordinate-mapping-engine  —  RIGID DETERMINISTIC panel mapper (NO AI)
// ----------------------------------------------------------------------------
// Completely isolated module. Zero upstream/repo dependencies (only ImageScript
// + the Supabase client for storage/DB). Contains NO generative AI of any kind.
//
// Strict math framework (per panel):
//   1. ABSOLUTE BOUNDING BOX  — the target panel's true W×H (inches) fixes an
//      unchangeable trim box at a calibrated pixel resolution.
//   2. SCALE FACTOR           — exact aspect-matched source→target scale derived
//      from the VisionBoardIQ source asset region vs. the trim box.
//   3. 2" BLEED INJECTION     — strict bleed extended OUTWARD from the calibrated
//      boundary by edge-pixel clone (deterministic, no white edge).
//   4. 1:1 PIXEL COPY MATRIX  — the SAME crop+scale matrix is applied to the
//      background AND every transparent overlay layer, so background and overlays
//      stay perfectly registered. Pure pixel copy — nothing is repainted.
//
// Action: map   (default)
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const BUCKET = "wrap-files";
const PREFIX = "coordinate-mapping-engine";
const TARGET_LONG = 2000;      // calibrated px for the panel's long trim edge
const ADMIN_EMAILS = ["trish@weprintwraps.com"];

function svc() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function requireAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try {
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return false;
    if (ADMIN_EMAILS.includes((user.email || "").toLowerCase())) return true;
    const { data } = await svc().from("user_roles").select("role")
      .eq("user_id", user.id).in("role", ["admin", "tester"]).limit(1).maybeSingle();
    return !!data;
  } catch { return false; }
}

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function loadImage(src: { url?: string; base64?: string }): Promise<Image> {
  if (src.base64) return await Image.decode(b64ToBytes(src.base64));
  if (src.url) {
    const r = await fetch(src.url);
    if (!r.ok) throw new Error(`fetch ${r.status}`);
    return await Image.decode(new Uint8Array(await r.arrayBuffer()));
  }
  throw new Error("image source requires url or base64");
}
async function upload(path: string, bytes: Uint8Array): Promise<string> {
  const sb = svc();
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true });
  if (error) throw error;
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// ── STEP 3: inject bleed OUTWARD by cloning the trim-edge pixels (background
// only — overlays keep their transparency in the bleed margin). ──
function injectBleed(trim: Image, bleed: number): Image {
  const w = trim.width, h = trim.height;
  const canvas = new Image(w + bleed * 2, h + bleed * 2);
  canvas.composite(trim, bleed, bleed);
  canvas.composite(trim.clone().crop(0, 0, 1, h).resize(bleed, h), 0, bleed);
  canvas.composite(trim.clone().crop(w - 1, 0, 1, h).resize(bleed, h), bleed + w, bleed);
  canvas.composite(trim.clone().crop(0, 0, w, 1).resize(w, bleed), bleed, 0);
  canvas.composite(trim.clone().crop(0, h - 1, w, 1).resize(w, bleed), bleed, bleed + h);
  canvas.composite(trim.clone().crop(0, 0, 1, 1).resize(bleed, bleed), 0, 0);
  canvas.composite(trim.clone().crop(w - 1, 0, 1, 1).resize(bleed, bleed), bleed + w, 0);
  canvas.composite(trim.clone().crop(0, h - 1, 1, 1).resize(bleed, bleed), 0, bleed + h);
  canvas.composite(trim.clone().crop(w - 1, h - 1, 1, 1).resize(bleed, bleed), bleed + w, bleed + h);
  return canvas;
}

interface Box { x: number; y: number; w: number; h: number }

// ── STEP 1+2: derive the source crop box for a panel. If the caller supplies a
// normalized srcBox (0..1) it is used verbatim; otherwise the largest CENTERED
// region of the source matching the panel's exact aspect ratio (no distortion). ──
function sourceBox(srcW: number, srcH: number, panelAR: number, norm?: { x: number; y: number; w: number; h: number }): Box {
  if (norm) {
    return {
      x: Math.round(norm.x * srcW), y: Math.round(norm.y * srcH),
      w: Math.max(1, Math.round(norm.w * srcW)), h: Math.max(1, Math.round(norm.h * srcH)),
    };
  }
  const srcAR = srcW / srcH;
  if (srcAR > panelAR) { const h = srcH, w = Math.round(srcH * panelAR); return { x: Math.round((srcW - w) / 2), y: 0, w, h }; }
  const w = srcW, h = Math.round(srcW / panelAR); return { x: 0, y: Math.round((srcH - h) / 2), w, h };
}

// Pure 1:1 crop+scale matrix: cut the box out of `img` and scale to trimW×trimH.
function cropScale(img: Image, box: Box, trimW: number, trimH: number): Image {
  return img.clone().crop(box.x, box.y, box.w, box.h).resize(trimW, trimH);
}

interface PanelIn { name: string; widthIn: number; heightIn: number; srcBox?: { x: number; y: number; w: number; h: number } }
interface LayerIn { label?: string; url?: string; base64?: string }

async function handleMap(body: Record<string, unknown>) {
  const vehicle = String(body.vehicle || "").trim();
  const projectName = String(body.projectName || vehicle || "Coordinate-Mapped Pack").trim();
  const bleedIn = Number(body.bleedIn ?? 2) || 2;
  const panels = (body.panels as PanelIn[]) || [];
  if (!Array.isArray(panels) || panels.length === 0) {
    return json({ error: "at least one panel { name, widthIn, heightIn } is required" }, 400);
  }

  // Background source (the VisionBoardIQ flat asset) + optional transparent layers.
  let background: Image;
  try {
    background = await loadImage({
      url: body.backgroundUrl as string | undefined,
      base64: body.backgroundBase64 as string | undefined,
    });
  } catch (e) {
    return json({ error: "background source failed: " + (e instanceof Error ? e.message : String(e)) }, 400);
  }
  const bgW = background.width, bgH = background.height;

  // Load overlay layers once; normalize each to the background canvas so the
  // SAME crop matrix lands on identical coordinates for every layer.
  const layersIn = (body.layers as LayerIn[]) || [];
  const layers: { label: string; img: Image }[] = [];
  for (let i = 0; i < layersIn.length; i++) {
    try {
      const img = await loadImage(layersIn[i]);
      if (img.width !== bgW || img.height !== bgH) img.resize(bgW, bgH);
      layers.push({ label: layersIn[i].label || `Layer ${i + 1}`, img });
    } catch (e) { console.error(`layer ${i} load failed:`, e); }
  }

  const batchId = crypto.randomUUID();
  const sb = svc();
  const rows: unknown[] = [];

  for (const p of panels) {
    const widthIn = Number(p.widthIn) || 1;
    const heightIn = Number(p.heightIn) || 1;
    const panelAR = widthIn / heightIn;

    // STEP 1 — absolute trim bounding box (calibrated px).
    let trimW: number, trimH: number;
    if (widthIn >= heightIn) { trimW = TARGET_LONG; trimH = Math.max(1, Math.round(TARGET_LONG / panelAR)); }
    else { trimH = TARGET_LONG; trimW = Math.max(1, Math.round(TARGET_LONG * panelAR)); }
    const effectiveDpi = trimW / widthIn;
    const bleedPx = Math.max(2, Math.round(bleedIn * effectiveDpi));

    // STEP 2 — source region + exact scale factors.
    const box = sourceBox(bgW, bgH, panelAR, p.srcBox);
    const scaleX = trimW / box.w;
    const scaleY = trimH / box.h;

    const slug = p.name.replace(/[^a-z0-9]+/gi, "_");
    const overlays: { id: string; type: string; label: string; url: string; xPct: number; yPct: number; scale: number; rotation: number }[] = [];
    let backgroundUrl: string | null = null;
    let status = "complete";

    try {
      // STEP 4 (background) — 1:1 crop matrix, then STEP 3 bleed injection.
      const trim = cropScale(background, box, trimW, trimH);
      const bgPanel = injectBleed(trim, bleedPx);
      backgroundUrl = await upload(`${PREFIX}/${batchId}/${slug}-background.png`, await bgPanel.encode());

      // STEP 4 (overlays) — IDENTICAL crop matrix; placed on a transparent
      // canvas at the bleed offset so they register 1:1 over the background.
      for (let li = 0; li < layers.length; li++) {
        const lyTrim = cropScale(layers[li].img, box, trimW, trimH);
        const lyCanvas = new Image(trimW + bleedPx * 2, trimH + bleedPx * 2); // transparent
        lyCanvas.composite(lyTrim, bleedPx, bleedPx);
        const url = await upload(`${PREFIX}/${batchId}/${slug}-layer-${li + 1}.png`, await lyCanvas.encode());
        overlays.push({
          id: crypto.randomUUID(), type: "graphic", label: layers[li].label,
          url, xPct: 50, yPct: 50, scale: 1, rotation: 0,
        });
      }
    } catch (e) {
      console.error("map failed:", p.name, e);
      status = "error";
    }

    const { data, error } = await sb.from("wrap_panel_artboards").insert({
      batch_id: batchId, project_name: projectName, vehicle,
      design_brief: "Deterministic coordinate-mapped (no AI)",
      finish: String(body.finish || "gloss"),
      panel_name: p.name, width_in: widthIn, height_in: heightIn, bleed_in: bleedIn,
      dpi: Math.round(effectiveDpi),
      background_url: backgroundUrl, overlays, status,
      metadata: {
        engine: "coordinate-mapping-engine", deterministic: true,
        trim_px: { w: trimW, h: trimH }, bleed_px: bleedPx,
        source_box_px: box, scale_factor: { x: scaleX, y: scaleY },
        source_dims_px: { w: bgW, h: bgH },
      },
    }).select().single();
    if (error) { console.error("insert failed:", error); return json({ error: "save failed: " + error.message }, 500); }
    rows.push(data);
  }

  return json({ success: true, batchId, panels: rows });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    if (!(await requireAdmin(req))) return json({ error: "Admin access required" }, 403);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "map");
    if (action === "map") return await handleMap(body);
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("coordinate-mapping-engine error:", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected failure" }, 500);
  }
});
