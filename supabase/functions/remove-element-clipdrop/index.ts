/**
 * remove-element-clipdrop — RevisionIQ "Remove Elements" server pipeline.
 *
 * Flow:
 *   1. Client sends { imageUrl, boundingBox: { xPct,yPct,wPct,hPct }, elementType, ... }
 *   2. We fetch the render PNG and decode it to learn its native pixel dims.
 *   3. We convert the percent bbox to pixel coords and build:
 *        a) a same-size black/white PNG MASK (white rect over the bbox)
 *        b) a tight PNG CROP of just the bbox region
 *   4. We call ClipDrop Cleanup with (render + mask) → clean background PNG
 *      (hole filled with texture-aware inpainting).
 *   5. We call ClipDrop Remove-Background with (crop) → transparent PNG of
 *      the extracted element with its surroundings alpha-knocked.
 *   6. We upload the clean background to bucket `render-backgrounds` and the
 *      transparent element to bucket `extracted-elements`.
 *   7. We insert a row into `extracted_elements` (service role, bypassing RLS
 *      but still tagging the authenticated user_id).
 *   8. We return { cleanBackgroundUrl, transparentPngUrl, extractedElementId,
 *      boundingBox } to the client so it can swap the canvas background and
 *      add the cutout as a draggable layer in the layer strip.
 *
 * Requires CLIPDROP_API_KEY secret. Uses imagescript for server-side PNG ops
 * (same lib as panelizer-step-* functions, already vetted in this project).
 *
 * ClipDrop docs:
 *   https://clipdrop.co/apis/docs/cleanup
 *   https://clipdrop.co/apis/docs/remove-background
 */

export const maxDuration = 60;

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

// Inlined so the MCP deploy path bundles cleanly (it puts index.ts inside
// a `source/` subdir, so `../_shared/cors.ts` relative imports break).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CLIPDROP_CLEANUP_ENDPOINT = "https://clipdrop-api.co/cleanup/v1";
const CLIPDROP_REMOVEBG_ENDPOINT = "https://clipdrop-api.co/remove-background/v1";

const RENDER_BG_BUCKET = "render-backgrounds";
const EXTRACTED_ELEMENTS_BUCKET = "extracted-elements";

type ElementType = "logo" | "text" | "graphic";

interface PercentBoundingBox {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

interface RequestBody {
  imageUrl?: string;
  boundingBox?: PercentBoundingBox;
  elementType?: ElementType;
  elementLabel?: string;
  renderId?: string | null;
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
// crop() mutates in place, so the old path did `src.clone().crop(...)` — but
// clone() duplicates the entire working bitmap (a 12MP frame is ~48MB) just to
// keep a tiny region. Two of those transient full-frame clones, stacked with
// the full-frame PNG re-encode below, pushed the worker past the 256MB edge
// ceiling → the runtime killed it mid-call (HTTP 546), which surfaced to the
// user as "Heal step failed — background unchanged". Drawing the source onto a
// small destination via composite reads the source in place and allocates only
// w×h, so peak memory stays well under budget and the source stays intact for
// the final heal composite.
function cropRegion(src: Image, x: number, y: number, w: number, h: number): Image {
  const out = new Image(w, h);
  out.composite(src, -x, -y);
  return out;
}

async function fetchImageBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Deno/RemoveElementClipdrop" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch source image: HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function clipdropCleanup(
  apiKey: string,
  imageBytes: Uint8Array,
  maskBytes: Uint8Array,
): Promise<Uint8Array> {
  const form = new FormData();
  form.append(
    "image_file",
    new Blob([imageBytes], { type: "image/png" }),
    "image.png",
  );
  form.append(
    "mask_file",
    new Blob([maskBytes], { type: "image/png" }),
    "mask.png",
  );
  // "quality" is slower but produces far better fills on textured wraps.
  form.append("mode", "quality");

  const res = await fetch(CLIPDROP_CLEANUP_ENDPOINT, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `ClipDrop Cleanup HTTP ${res.status}: ${errText.substring(0, 300)}`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function clipdropRemoveBackground(
  apiKey: string,
  imageBytes: Uint8Array,
): Promise<Uint8Array> {
  const form = new FormData();
  form.append(
    "image_file",
    new Blob([imageBytes], { type: "image/png" }),
    "image.png",
  );

  const res = await fetch(CLIPDROP_REMOVEBG_ENDPOINT, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `ClipDrop RemoveBackground HTTP ${res.status}: ${errText.substring(0, 300)}`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

// BiRefNet (Replicate 851-labs/background-remover) — high-quality alpha
// matting for a clean transparent cutout of the lifted element. Inlined (not
// imported from _shared) so the MCP deploy bundle stays flat — the same
// reason corsHeaders is inlined above. Returns null on ANY failure so the
// caller transparently falls back to ClipDrop Remove-Background. Needs a
// publicly-fetchable image URL (a public Storage URL is fine).
const BIREFNET_MODEL_VERSION =
  "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc";

async function birefnetCutout(
  replicateKey: string,
  imageUrl: string,
): Promise<Uint8Array | null> {
  try {
    // Prefer: wait holds the response server-side while the model runs.
    const createRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicateKey}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        version: BIREFNET_MODEL_VERSION,
        input: { image: imageUrl },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!createRes.ok) return null;

    let result = await createRes.json();
    let polls = 0;
    while (
      result.status !== "succeeded" &&
      result.status !== "failed" &&
      result.status !== "canceled" &&
      polls < 30
    ) {
      if (!result.urls?.get) break;
      await new Promise((r) => setTimeout(r, 1000));
      polls++;
      const statusRes = await fetch(result.urls.get, {
        headers: { Authorization: `Bearer ${replicateKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (statusRes.ok) result = await statusRes.json();
    }
    if (result.status !== "succeeded" || !result.output) return null;

    const outUrl = typeof result.output === "string"
      ? result.output
      : Array.isArray(result.output)
      ? result.output[0]
      : null;
    if (!outUrl || typeof outUrl !== "string") return null;

    const dl = await fetch(outUrl, { signal: AbortSignal.timeout(30_000) });
    if (!dl.ok) return null;
    return new Uint8Array(await dl.arrayBuffer());
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ---- Env ----
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clipdropKey = Deno.env.get("CLIPDROP_API_KEY");

    if (!clipdropKey) {
      return json(503, {
        code: "API_KEY_MISSING",
        message: "CLIPDROP_API_KEY secret is not configured",
      });
    }

    // ---- Auth ----
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader || authHeader === "Bearer") {
      return json(401, {
        code: "AUTH_ERROR",
        message: "No authorization token provided",
      });
    }
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    // Back-of-house (service-role) callers — e.g. designpro-clean-views running
    // the strip automatically server-side — present the SERVICE_ROLE key and
    // supply the owning user id in the body. Browser callers (the manual Remove
    // Elements tool) present a user JWT and are validated exactly as before —
    // that path is unchanged, so the working button is never affected.
    const isServiceRole = !!supabaseServiceKey && token === supabaseServiceKey;
    let user: { id: string } | null = null;
    if (!isServiceRole) {
      const { data: { user: u }, error: authError } = await authClient.auth.getUser(
        token,
      );
      if (authError || !u) {
        return json(401, {
          code: "AUTH_ERROR",
          message: `Not authenticated: ${authError?.message || "user not found"}`,
        });
      }
      user = u;
    }

    // ---- Parse body ----
    const body = (await req.json().catch(() => null)) as RequestBody | null;
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
    // Optional working-frame cap (megapixels). Browser/manual callers omit it and
    // keep the proven 12MP quality untouched. Back-of-house callers (clean-views)
    // pass a LOWER cap so the full-frame decode+resize+PNG re-encode peak stays
    // under the 256MB edge ceiling — the OOM (HTTP 546) that was silently killing
    // the auto-strip on 4K heroes and leaving Layers = 0. Clamped to a sane range.
    const reqMaxWorkPixels = Number((body as any).maxWorkPixels);
    const MAX_WORK_PIXELS = Number.isFinite(reqMaxWorkPixels) && reqMaxWorkPixels > 0
      ? Math.min(Math.max(reqMaxWorkPixels, 2_000_000), 12_000_000)
      : 12_000_000;

    if (!imageUrl || typeof imageUrl !== "string") {
      return json(400, {
        code: "BAD_REQUEST",
        message: "imageUrl is required",
      });
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

    const uid = user?.id || (body as any).userId || "00000000-0000-0000-0000-000000000000";
    const shortUid = uid.substring(0, 8);
    console.log(
      `[remove-element-clipdrop] user=${shortUid} type=${elementType} bbox=${
        JSON.stringify(boundingBox)
      }`,
    );

    // ---- Fetch source render ----
    const rawBytes = await fetchImageBytes(imageUrl);
    const srcImage = await Image.decode(rawBytes);
    const origW = srcImage.width;
    const origH = srcImage.height;
    console.log(
      `[remove-element-clipdrop] source decoded ${origW}x${origH} (${
        (rawBytes.length / 1024).toFixed(0)
      }KB)`,
    );

    // We heal on a small padded crop ("tile") around the element at the
    // WORKING resolution, NOT by downscaling the whole render to 2048px and
    // upscaling the healed patch back. The old path let ClipDrop fill the
    // hole at 2048px then stretched that patch back to 4K before pasting it —
    // so the removed spot came back soft/blurry against the sharp wrap around
    // it (the "faded background" bug). Cropping the tile from the working
    // frame and pasting it back at the SAME resolution keeps the patch and
    // its surroundings matched, so the removal is clean with no fade.
    //
    // The working frame is capped uniformly at 12MP. A uniform downscale
    // scales the patch and its surroundings together (they still match — no
    // relative fade) and keeps every full-frame clone small enough that the
    // two transient crops + encode stay well under the Deno edge 256MB
    // ceiling. origW/origH below stay the true source dims for the DB record.
    // (MAX_WORK_PIXELS resolved from the request above — 12MP for the manual
    // button, a lower cap for the back-of-house auto-strip to dodge the OOM.)
    let imgW = origW;
    let imgH = origH;
    if (origW * origH > MAX_WORK_PIXELS) {
      const f = Math.sqrt(MAX_WORK_PIXELS / (origW * origH));
      imgW = Math.max(1, Math.round(origW * f));
      imgH = Math.max(1, Math.round(origH * f));
      srcImage.resize(imgW, imgH);
      console.log(
        `[remove-element-clipdrop] working frame capped to ${imgW}x${imgH}`,
      );
    }

    // ---- Percent → full-res pixel bbox of the element to remove ----
    const pxX = clamp(Math.round(boundingBox.xPct * imgW), 0, imgW - 1);
    const pxY = clamp(Math.round(boundingBox.yPct * imgH), 0, imgH - 1);
    const pxW = clamp(Math.round(boundingBox.wPct * imgW), 1, imgW - pxX);
    const pxH = clamp(Math.round(boundingBox.hPct * imgH), 1, imgH - pxY);

    if (pxW < 8 || pxH < 8) {
      return json(400, {
        code: "BBOX_TOO_SMALL",
        message: "Selection too small — draw a bigger box",
      });
    }

    // ---- Element cutout (tight full-res crop → BiRefNet / ClipDrop) --------
    // Lift the element off the PRISTINE source before we heal anything so the
    // transparent layer comes back crisp.
    const cropBytes = await cropRegion(srcImage, pxX, pxY, pxW, pxH).encode();

    // Fire the transparent-element cutout in PARALLEL with the heal below —
    // both only need the crop, and the heal's ClipDrop call is the long pole,
    // so overlapping them keeps wall-clock ≈ the slower of the two (well under
    // the function budget) instead of summing them.
    //
    // Cutout engine: prefer BiRefNet (Replicate 851-labs/background-remover)
    // for clean alpha edges on the lifted logo/text; fall back to ClipDrop
    // Remove-Background if Replicate is unconfigured or fails. BiRefNet needs
    // a public URL, so we stage the raw crop to a temp Storage path first and
    // delete it once the matte is back.
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const replicateKey = Deno.env.get("REPLICATE_API_TOKEN");

    const cutoutPromise: Promise<Uint8Array> = (async () => {
      if (replicateKey) {
        const cropPath = `${uid}/${ts}-${rand}-crop.png`;
        const { error: cropUpErr } = await serviceClient.storage
          .from(EXTRACTED_ELEMENTS_BUCKET)
          .upload(cropPath, cropBytes, {
            contentType: "image/png",
            upsert: true,
          });
        if (!cropUpErr) {
          const cropUrl = serviceClient.storage
            .from(EXTRACTED_ELEMENTS_BUCKET)
            .getPublicUrl(cropPath).data.publicUrl;
          console.log(`[remove-element-clipdrop] BiRefNet cutout starting...`);
          const matte = await birefnetCutout(replicateKey, cropUrl);
          await serviceClient.storage
            .from(EXTRACTED_ELEMENTS_BUCKET)
            .remove([cropPath])
            .catch(() => {});
          if (matte) {
            console.log(
              `[remove-element-clipdrop] BiRefNet cutout ${
                (matte.length / 1024).toFixed(0)
              }KB`,
            );
            return matte;
          }
          console.warn(
            `[remove-element-clipdrop] BiRefNet failed — using ClipDrop Remove-Background`,
          );
        }
      }
      console.log(`[remove-element-clipdrop] ClipDrop Remove-Background...`);
      return await clipdropRemoveBackground(clipdropKey, cropBytes);
    })();

    // ---- Build a padded context tile around the element for the heal ----
    // ClipDrop's content-aware fill needs surrounding wrap material to clone
    // from, so pad the element bbox by ~60% on each side (clamped to frame).
    const padX = Math.round(pxW * 0.6);
    const padY = Math.round(pxH * 0.6);
    const cropX = clamp(pxX - padX, 0, imgW - 1);
    const cropY = clamp(pxY - padY, 0, imgH - 1);
    const cropW = clamp(pxX + pxW + padX, 1, imgW) - cropX;
    const cropH = clamp(pxY + pxH + padY, 1, imgH) - cropY;

    // Cap the tile handed to ClipDrop so an oversized selection can't blow the
    // worker memory or ClipDrop's input limits. Only the tile is scaled — the
    // rest of the render is never touched, so nothing outside it can fade.
    const TILE_MAX_SIDE = 2048;
    const tileLongest = Math.max(cropW, cropH);
    const tileScale = tileLongest > TILE_MAX_SIDE ? TILE_MAX_SIDE / tileLongest : 1;

    const tileImg = cropRegion(srcImage, cropX, cropY, cropW, cropH);
    let tileW = cropW;
    let tileH = cropH;
    if (tileScale < 1) {
      tileW = Math.max(1, Math.round(cropW * tileScale));
      tileH = Math.max(1, Math.round(cropH * tileScale));
      tileImg.resize(tileW, tileH);
    }
    const tileBytes = await tileImg.encode();

    // ---- Tile mask: black everywhere, white over the element region ----
    // (the element's position WITHIN the tile, scaled to tile resolution).
    // imagescript pixel format: 0xRRGGBBAA
    const BLACK = 0x000000ff;
    const WHITE = 0xffffffff;
    const mElemX = clamp(Math.round((pxX - cropX) * tileScale), 0, tileW - 1);
    const mElemY = clamp(Math.round((pxY - cropY) * tileScale), 0, tileH - 1);
    const mElemW = clamp(Math.round(pxW * tileScale), 1, tileW - mElemX);
    const mElemH = clamp(Math.round(pxH * tileScale), 1, tileH - mElemY);
    const mask = new Image(tileW, tileH).fill(BLACK);
    mask.composite(new Image(mElemW, mElemH).fill(WHITE), mElemX, mElemY);
    const maskBytes = await mask.encode();

    // ---- ClipDrop Cleanup on the native-res tile ----
    console.log(
      `[remove-element-clipdrop] calling ClipDrop Cleanup on ${tileW}x${tileH} tile...`,
    );
    const cleanedTileBytes = await clipdropCleanup(
      clipdropKey,
      tileBytes,
      maskBytes,
    );
    console.log(
      `[remove-element-clipdrop] cleanup returned ${
        (cleanedTileBytes.length / 1024).toFixed(0)
      }KB`,
    );

    // ---- Composite the healed tile back onto the pristine full-res render --
    // Fallback keeps the original bytes (PNG) if the composite throws.
    let cleanBackgroundBytes: Uint8Array = rawBytes;
    let cleanMime = "image/png";
    let cleanExt = "png";
    try {
      const cleanedTile = await Image.decode(cleanedTileBytes);
      // ClipDrop normally returns the tile at the same dims; resize defensively
      // back to the crop's native pixel size so it lands sharp and aligned.
      if (cleanedTile.width !== cropW || cleanedTile.height !== cropH) {
        cleanedTile.resize(cropW, cropH);
      }
      srcImage.composite(cleanedTile, cropX, cropY);
      // Encode the healed full frame as JPEG, not PNG. The clean background is
      // an opaque photographic wrap (no alpha needed), and imagescript's PNG
      // encoder builds large transient deflate buffers over the whole frame —
      // that final full-frame encode was the peak allocation that tipped the
      // worker into OOM. JPEG q92 is visually lossless here, encodes with far
      // less memory, and yields a smaller file. The transparent element cutout
      // stays PNG (it comes back from ClipDrop/BiRefNet already, untouched).
      cleanBackgroundBytes = await srcImage.encodeJPEG(92);
      cleanMime = "image/jpeg";
      cleanExt = "jpg";
      console.log(
        `[remove-element-clipdrop] healed tile composited onto full-res ${srcImage.width}x${srcImage.height} (${
          (cleanBackgroundBytes.length / 1024).toFixed(0)
        }KB jpg)`,
      );
    } catch (e) {
      // Fallback: keep the pristine original rather than a faded full-frame
      // ClipDrop downscale, so a composite glitch never re-introduces blur.
      console.warn(
        `[remove-element-clipdrop] tile composite failed, using original: ${
          e instanceof Error ? e.message : e
        }`,
      );
    }

    // ---- Await the element cutout (ran in parallel with the heal) ----
    const transparentBytes = await cutoutPromise;
    console.log(
      `[remove-element-clipdrop] element cutout ready ${
        (transparentBytes.length / 1024).toFixed(0)
      }KB`,
    );

    // ---- Upload to Storage (service role) ----
    const cleanPath = `${uid}/${ts}-${rand}-clean.${cleanExt}`;
    const elementPath = `${uid}/${ts}-${rand}-element.png`;

    const { error: bgUploadErr } = await serviceClient.storage
      .from(RENDER_BG_BUCKET)
      .upload(cleanPath, cleanBackgroundBytes, {
        contentType: cleanMime,
        upsert: true,
      });
    if (bgUploadErr) {
      throw new Error(
        `Upload to ${RENDER_BG_BUCKET} failed: ${bgUploadErr.message}`,
      );
    }

    const { error: elUploadErr } = await serviceClient.storage
      .from(EXTRACTED_ELEMENTS_BUCKET)
      .upload(elementPath, transparentBytes, {
        contentType: "image/png",
        upsert: true,
      });
    if (elUploadErr) {
      throw new Error(
        `Upload to ${EXTRACTED_ELEMENTS_BUCKET} failed: ${elUploadErr.message}`,
      );
    }

    const cleanBackgroundUrl =
      serviceClient.storage.from(RENDER_BG_BUCKET).getPublicUrl(cleanPath)
        .data.publicUrl;
    const transparentPngUrl =
      serviceClient.storage.from(EXTRACTED_ELEMENTS_BUCKET).getPublicUrl(
        elementPath,
      ).data.publicUrl;

    // ---- Insert DB row ----
    // NOTE: x/y/width/height are in the downscaled working-resolution space.
    // Percent values remain canonical — they map cleanly to the original.
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
      // Storage succeeded, DB row failed — not fatal to the UX, but log loudly.
      console.error(
        `[remove-element-clipdrop] DB insert failed: ${insertErr.message}`,
      );
    }

    console.log(
      `[remove-element-clipdrop] ✅ done id=${inserted?.id ?? "(no-row)"}`,
    );

    return json(200, {
      success: true,
      extractedElementId: inserted?.id ?? null,
      cleanBackgroundUrl,
      transparentPngUrl,
      boundingBox: storedBox,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[remove-element-clipdrop] Unhandled error: ${message}`);
    return json(500, { code: "INTERNAL_ERROR", message });
  }
});
