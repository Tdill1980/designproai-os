/**
 * layerlift-engine — 100% in-house, $0 "Canva Magic Layers" element engine.
 *
 * This is a DROP-IN replacement for `remove-element-clipdrop` that uses NO paid
 * third-party API (no ClipDrop credits, no Replicate/BiRefNet). It does the two
 * Magic-Layers jobs deterministically with imagescript (the same pure-Deno PNG
 * lib already vetted across the panelizer functions):
 *
 *   1. LIFT  — crop the element's bbox (plus a small margin), then alpha-key the
 *              local background out so the element comes back on a TRANSPARENT
 *              PNG (logo/text isolated, surroundings knocked to alpha 0).
 *   2. HEAL  — remove the element from the source by reconstructing the hole via
 *              bidirectional border interpolation (sample the clean pixels just
 *              outside the bbox on all four sides and blend across the gap). On
 *              the studio backgrounds + clean artboards this product produces,
 *              the patch is seamless — and it never costs a cent.
 *
 * Response contract is byte-for-byte compatible with remove-element-clipdrop:
 *   { success, cleanBackgroundUrl, transparentPngUrl, extractedElementId,
 *     boundingBox }
 * so designpro-clean-views, RenderElementSeparator and precise-erase-composite
 * can call it by name with the identical body and keep working unchanged.
 *
 * Auth mirrors remove-element-clipdrop exactly: a SERVICE_ROLE bearer (the
 * back-of-house auto-strip in designpro-clean-views) is trusted and supplies the
 * owning user id in the body; a browser user JWT is validated as before.
 */

export const maxDuration = 60;

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

// Inlined (not imported from _shared) so the MCP deploy bundle stays flat — the
// same reason remove-element-clipdrop inlines it.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RENDER_BG_BUCKET = "render-backgrounds";
const EXTRACTED_ELEMENTS_BUCKET = "extracted-elements";

type ElementType = "logo" | "text" | "graphic";

interface PercentBoundingBox {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// Crop a sub-region WITHOUT cloning the full-resolution source. imagescript's
// crop() mutates in place and clone() duplicates the entire working bitmap;
// compositing the source onto a small w×h destination at a negative offset
// reads it in place and allocates only w×h, keeping peak memory low and leaving
// the source pristine for the heal pass. (Same trick as remove-element-clipdrop.)
function cropRegion(src: Image, x: number, y: number, w: number, h: number): Image {
  const out = new Image(w, h);
  out.composite(src, -x, -y);
  return out;
}

async function fetchImageBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Deno/ElementMagicLift" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch source image: HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

// imagescript is 1-indexed; wrap get/set with 0-based, frame-clamped accessors.
function getPx(img: Image, x: number, y: number): [number, number, number, number] {
  const cx = clamp(x, 0, img.width - 1);
  const cy = clamp(y, 0, img.height - 1);
  return Image.colorToRGBA(img.getPixelAt(cx + 1, cy + 1));
}
function setPx(img: Image, x: number, y: number, rgba: [number, number, number, number]) {
  img.setPixelAt(x + 1, y + 1, Image.rgbaToColor(rgba[0], rgba[1], rgba[2], rgba[3]));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// ---- LIFT: crop a padded region and alpha-key the local background out -------
// Returns a transparent PNG of the element. The padding gives a background ring
// to learn the key colour from; pixels close to that colour become transparent,
// pixels far from it (the logo/text strokes) stay opaque, with a soft ramp at
// the boundary for clean anti-aliased edges (the "no jaggies" Magic-Layers look).
async function liftTransparentElement(
  src: Image,
  pxX: number,
  pxY: number,
  pxW: number,
  pxH: number,
): Promise<Uint8Array> {
  const padX = Math.max(4, Math.round(pxW * 0.12));
  const padY = Math.max(4, Math.round(pxH * 0.12));
  const cx = clamp(pxX - padX, 0, src.width - 1);
  const cy = clamp(pxY - padY, 0, src.height - 1);
  const cw = clamp(pxX + pxW + padX, 1, src.width) - cx;
  const ch = clamp(pxY + pxH + padY, 1, src.height) - cy;

  const crop = cropRegion(src, cx, cy, cw, ch);

  // Learn the background colour from the outer ring (the padding margin), which
  // is background, not element. Mean over a ring `t` px thick.
  const t = Math.max(2, Math.round(Math.min(cw, ch) * 0.06));
  let br = 0, bg = 0, bb = 0, n = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const onRing = x < t || y < t || x >= cw - t || y >= ch - t;
      if (!onRing) continue;
      const [r, g, b] = getPx(crop, x, y);
      br += r; bg += g; bb += b; n++;
    }
  }
  if (n > 0) { br /= n; bg /= n; bb /= n; }

  // Distance threshold (0..441 RGB space). Below LO → background (transparent),
  // above HI → element (opaque), linear ramp between for soft edges.
  const LO = 30;
  const HI = 72;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const [r, g, b] = getPx(crop, x, y);
      const dist = Math.sqrt(
        (r - br) * (r - br) + (g - bg) * (g - bg) + (b - bb) * (b - bb),
      );
      let alpha: number;
      if (dist <= LO) alpha = 0;
      else if (dist >= HI) alpha = 255;
      else alpha = Math.round((255 * (dist - LO)) / (HI - LO));
      setPx(crop, x, y, [r, g, b, alpha]);
    }
  }
  return await crop.encode();
}

// ---- HEAL: reconstruct the bbox hole from its clean surroundings -------------
// For every pixel inside the element bbox, sample the nearest clean pixel just
// outside the box on each axis (left/right, top/bottom), interpolate across the
// gap on both axes and average — a cheap content-aware fill that is seamless on
// the uniform / gradient studio floors+walls and flat artboards this pipeline
// produces. Reads only border pixels (never other hole pixels) so it is order-
// independent and can mutate `src` in place.
function healHole(src: Image, pxX: number, pxY: number, pxW: number, pxH: number) {
  const leftX = pxX - 1;
  const rightX = pxX + pxW;
  const topY = pxY - 1;
  const botY = pxY + pxH;
  const denomX = Math.max(1, rightX - leftX);
  const denomY = Math.max(1, botY - topY);

  for (let y = pxY; y < pxY + pxH; y++) {
    const L = getPx(src, leftX, y);
    const R = getPx(src, rightX, y);
    const tV = clamp((y - topY) / denomY, 0, 1);
    for (let x = pxX; x < pxX + pxW; x++) {
      const T = getPx(src, x, topY);
      const B = getPx(src, x, botY);
      const tH = clamp((x - leftX) / denomX, 0, 1);
      const r = (lerp(L[0], R[0], tH) + lerp(T[0], B[0], tV)) / 2;
      const g = (lerp(L[1], R[1], tH) + lerp(T[1], B[1], tV)) / 2;
      const b = (lerp(L[2], R[2], tH) + lerp(T[2], B[2], tV)) / 2;
      setPx(src, x, y, [Math.round(r), Math.round(g), Math.round(b), 255]);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ---- Auth (mirrors remove-element-clipdrop) ----
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader || authHeader === "Bearer") {
      return json(401, { code: "AUTH_ERROR", message: "No authorization token provided" });
    }
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = !!supabaseServiceKey && token === supabaseServiceKey;
    let user: { id: string } | null = null;
    if (!isServiceRole) {
      const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user: u }, error: authError } = await authClient.auth.getUser(token);
      if (authError || !u) {
        return json(401, {
          code: "AUTH_ERROR",
          message: `Not authenticated: ${authError?.message || "user not found"}`,
        });
      }
      user = u;
    }

    // ---- Parse body ----
    const body = (await req.json().catch(() => null)) as
      | {
          imageUrl?: string;
          boundingBox?: PercentBoundingBox;
          elementType?: ElementType;
          elementLabel?: string;
          renderId?: string | null;
          userId?: string;
          maxWorkPixels?: number;
        }
      | null;
    if (!body || typeof body !== "object") {
      return json(400, { code: "BAD_REQUEST", message: "JSON body required" });
    }

    const {
      imageUrl,
      boundingBox,
      elementType = "logo",
      elementLabel,
      renderId = null,
    } = body;

    if (!imageUrl || typeof imageUrl !== "string") {
      return json(400, { code: "BAD_REQUEST", message: "imageUrl is required" });
    }
    if (
      !boundingBox ||
      typeof boundingBox.xPct !== "number" ||
      typeof boundingBox.yPct !== "number" ||
      typeof boundingBox.wPct !== "number" ||
      typeof boundingBox.hPct !== "number"
    ) {
      return json(400, {
        code: "BAD_REQUEST",
        message: "boundingBox {xPct,yPct,wPct,hPct} is required",
      });
    }
    if (!["logo", "text", "graphic"].includes(elementType)) {
      return json(400, {
        code: "BAD_REQUEST",
        message: "elementType must be one of logo|text|graphic",
      });
    }

    const uid = user?.id || body.userId || "00000000-0000-0000-0000-000000000000";
    const shortUid = uid.substring(0, 8);

    // Working-frame cap keeps the full-frame decode + JPEG re-encode under the
    // Deno edge 256MB ceiling. Default 6MP (free engine — no need for 12MP);
    // clamped to a sane range. Back-of-house callers can pass a lower cap.
    const reqMaxWorkPixels = Number(body.maxWorkPixels);
    const MAX_WORK_PIXELS = Number.isFinite(reqMaxWorkPixels) && reqMaxWorkPixels > 0
      ? Math.min(Math.max(reqMaxWorkPixels, 1_000_000), 12_000_000)
      : 6_000_000;

    console.log(
      `[layerlift-engine] user=${shortUid} type=${elementType} bbox=${JSON.stringify(boundingBox)}`,
    );

    // ---- Fetch + decode source ----
    const rawBytes = await fetchImageBytes(imageUrl);
    const srcImage = await Image.decode(rawBytes);
    const origW = srcImage.width;
    const origH = srcImage.height;

    let imgW = origW;
    let imgH = origH;
    if (origW * origH > MAX_WORK_PIXELS) {
      const f = Math.sqrt(MAX_WORK_PIXELS / (origW * origH));
      imgW = Math.max(1, Math.round(origW * f));
      imgH = Math.max(1, Math.round(origH * f));
      srcImage.resize(imgW, imgH);
    }
    console.log(`[layerlift-engine] decoded ${origW}x${origH} → working ${imgW}x${imgH}`);

    // ---- Percent → working-resolution pixel bbox ----
    const pxX = clamp(Math.round(boundingBox.xPct * imgW), 0, imgW - 1);
    const pxY = clamp(Math.round(boundingBox.yPct * imgH), 0, imgH - 1);
    const pxW = clamp(Math.round(boundingBox.wPct * imgW), 1, imgW - pxX);
    const pxH = clamp(Math.round(boundingBox.hPct * imgH), 1, imgH - pxY);

    if (pxW < 8 || pxH < 8) {
      return json(400, { code: "BBOX_TOO_SMALL", message: "Selection too small — draw a bigger box" });
    }

    // ---- 1) LIFT the transparent element (off the PRISTINE source first) ----
    const transparentBytes = await liftTransparentElement(srcImage, pxX, pxY, pxW, pxH);
    console.log(`[layerlift-engine] lifted element ${(transparentBytes.length / 1024).toFixed(0)}KB`);

    // ---- 2) HEAL the hole in place, then encode the clean background ----
    let cleanBackgroundBytes: Uint8Array = rawBytes;
    let cleanMime = "image/png";
    let cleanExt = "png";
    try {
      healHole(srcImage, pxX, pxY, pxW, pxH);
      // JPEG q92: clean background is opaque, and JPEG encodes with far less peak
      // memory than imagescript's full-frame PNG deflate (the old OOM source).
      cleanBackgroundBytes = await srcImage.encodeJPEG(92);
      cleanMime = "image/jpeg";
      cleanExt = "jpg";
      console.log(
        `[layerlift-engine] healed ${imgW}x${imgH} (${(cleanBackgroundBytes.length / 1024).toFixed(0)}KB jpg)`,
      );
    } catch (e) {
      console.warn(`[layerlift-engine] heal failed, keeping original: ${e instanceof Error ? e.message : e}`);
    }

    // ---- Upload to Storage (service role) ----
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const cleanPath = `${uid}/${ts}-${rand}-clean.${cleanExt}`;
    const elementPath = `${uid}/${ts}-${rand}-element.png`;

    const { error: bgUploadErr } = await serviceClient.storage
      .from(RENDER_BG_BUCKET)
      .upload(cleanPath, cleanBackgroundBytes, { contentType: cleanMime, upsert: true });
    if (bgUploadErr) {
      throw new Error(`Upload to ${RENDER_BG_BUCKET} failed: ${bgUploadErr.message}`);
    }

    const { error: elUploadErr } = await serviceClient.storage
      .from(EXTRACTED_ELEMENTS_BUCKET)
      .upload(elementPath, transparentBytes, { contentType: "image/png", upsert: true });
    if (elUploadErr) {
      throw new Error(`Upload to ${EXTRACTED_ELEMENTS_BUCKET} failed: ${elUploadErr.message}`);
    }

    const cleanBackgroundUrl =
      serviceClient.storage.from(RENDER_BG_BUCKET).getPublicUrl(cleanPath).data.publicUrl;
    const transparentPngUrl =
      serviceClient.storage.from(EXTRACTED_ELEMENTS_BUCKET).getPublicUrl(elementPath).data.publicUrl;

    const storedBox = {
      xPct: boundingBox.xPct,
      yPct: boundingBox.yPct,
      wPct: boundingBox.wPct,
      hPct: boundingBox.hPct,
      x: pxX,
      y: pxY,
      width: pxW,
      height: pxH,
      imageWidth: imgW,
      imageHeight: imgH,
      originalWidth: origW,
      originalHeight: origH,
    };

    let extractedElementId: string | null = null;
    const { data: inserted, error: insertErr } = await serviceClient
      .from("extracted_elements")
      .insert({
        render_id: renderId,
        user_id: uid,
        element_type: elementType,
        element_label: elementLabel ?? null,
        transparent_png_url: transparentPngUrl,
        clean_background_url: cleanBackgroundUrl,
        bounding_box: storedBox,
      })
      .select("id")
      .single();
    if (insertErr) {
      console.error(`[layerlift-engine] DB insert failed: ${insertErr.message}`);
    } else {
      extractedElementId = inserted?.id ?? null;
    }

    console.log(`[layerlift-engine] ✅ done id=${extractedElementId ?? "(no-row)"}`);

    return json(200, {
      success: true,
      extractedElementId,
      cleanBackgroundUrl,
      transparentPngUrl,
      boundingBox: storedBox,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[layerlift-engine] Unhandled error: ${message}`);
    return json(500, { code: "INTERNAL_ERROR", message });
  }
});
