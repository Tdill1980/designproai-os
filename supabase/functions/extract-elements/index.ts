// ============================================================
// EXTRACT ELEMENTS — Click-to-select element removal via ClipDrop Cleanup
//
// ⚠️ SOURCE RESTORED FROM PRODUCTION 2026-07-30. This function was deleted
// from supabase/functions/ at some point but was NEVER deleted from the
// Supabase project: it stayed ACTIVE (v57), kept its supabase/config.toml
// entry, and stayed wired to a live customer-facing surface
// (src/components/productionflow/ExtractElementsModal.tsx →
// ProductionFlow.tsx). So the repo said it did not exist while production
// kept serving it, and nobody could review or fix it. The bytes below are
// the exact deployed source, pulled back so it is visible again.
//
// ⚠️ THIS IS THE BANNED STRIP/HEAL PATH. CLAUDE.md is explicit:
//   "Never re-introduce a strip/heal (ClipDrop, `liftoverlays`, generative
//    fill) to make a 'clean' logo removal — it smears. The clean base is
//    AUTHORED, not stripped."
// The sanctioned flow is LAYERED: floor the canvas on the authored
// logo-free clean artboard (master_artboard_clean_url) and drop the real
// lifted logo back as a draggable overlay — no heal anywhere, zero smear.
// Restoring this file does NOT bless the approach. It is checked in so the
// decision to retire it (roadmap #5: "dead pipelines must be REMOVED, not
// just unwired") can be made against real code instead of a black box.
// Do not add new callers.
//
// WHAT IT DOES
// Takes an uploaded image + array of click points + brush radius.
// Decodes the source, builds a binary mask (white circles at each click
// on a black canvas) at the same dimensions, and POSTs both to ClipDrop's
// Cleanup API — the same purpose-built object-removal service that
// inpaint-cleanup uses for RevisionIQ element removal.
//
// ClipDrop is non-generative — it fills the masked region with content-
// aware texture synthesis from the surrounding pixels, no hallucinated
// text/logos/objects. Exactly what "erase a logo" needs.
//
// Replicate LaMa-family models (zylim0702/remove-object,
// lucataco/cog-lama-cleaner) all 404 on the model-name endpoint, and
// generative inpainters like flux-fill-pro hallucinate fake text/logos
// in place of erased ones. ClipDrop is the working option.
//
// Direct-call flow (frontend hits this URL straight, not via the
// orchestrator) — token gating bypassed for now since this is admin /
// tester-facing during the initial rollout.
//
// Deploy: npx supabase functions deploy extract-elements --project-ref kfapjdyythzyvnpdeghu
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const BUCKET = 'wrap-files';
const MAX_INPUT_BYTES = 50 * 1024 * 1024; // 50 MB — bumped to handle big design exports
// Cap working res before sending to ClipDrop. ClipDrop accepts up to 30 MB
// per file, but smaller images give faster turnaround and the visual
// quality holds well at 1500px wide.
const MAX_W = 1500;
const WHITE = 0xFFFFFFFF;
const BLACK = 0x000000FF;
const CLIPDROP_ENDPOINT = 'https://clipdrop-api.co/cleanup/v1';
const CLIPDROP_TIMEOUT_MS = 60_000;

function ok(d: any) { return new Response(JSON.stringify(Object.assign({ success: true }, d)), { headers: Object.assign({}, corsHeaders, { 'Content-Type': 'application/json' }) }); }
function failAt(step: string, m: string, extra?: any) {
  console.error('[EXTRACT] FAIL at ' + step + ': ' + m, extra || '');
  return new Response(
    JSON.stringify({ success: false, step: step, error: '[' + step + '] ' + m, debug: extra || null }),
    { status: 400, headers: Object.assign({}, corsHeaders, { 'Content-Type': 'application/json' }) },
  );
}

function isTiff(b: Uint8Array) {
  if (b.length < 4) return false;
  if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A && b[3] === 0x00) return true;
  if (b[0] === 0x4D && b[1] === 0x4D && b[2] === 0x00 && b[3] === 0x2A) return true;
  return false;
}

// Decode source, cap to MAX_W wide, and build a matching-dimension binary
// mask with white filled circles at each click point. Returns PNG-encoded
// bytes for both the working source and the mask.
async function buildSrcAndMask(
  srcBytes: Uint8Array,
  points: Array<{ x: number; y: number }>,
  radiusNorm: number,
): Promise<{ src: Uint8Array; mask: Uint8Array; w: number; h: number }> {
  let img = await Image.decode(srcBytes);
  if (img.width > MAX_W) {
    img = img.resize(MAX_W, Math.round((MAX_W / img.width) * img.height));
  }
  const w = img.width;
  const h = img.height;

  const mask = new Image(w, h);
  mask.fill(BLACK);

  const diag = Math.sqrt(w * w + h * h);
  const r = Math.max(2, Math.round(radiusNorm * diag));
  const r2 = r * r;
  for (const pt of points) {
    const cx = Math.round(pt.x * w);
    const cy = Math.round(pt.y * h);
    const yMin = Math.max(0, cy - r);
    const yMax = Math.min(h, cy + r);
    const xMin = Math.max(0, cx - r);
    const xMax = Math.min(w, cx + r);
    for (let y = yMin; y < yMax; y++) {
      for (let x = xMin; x < xMax; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          // imagescript setPixelAt is 1-indexed
          mask.setPixelAt(x + 1, y + 1, WHITE);
        }
      }
    }
  }

  const src = await img.encode();
  const maskEncoded = await mask.encode();
  return { src, mask: maskEncoded, w, h };
}

async function clipdropCleanup(
  srcBytes: Uint8Array,
  maskBytes: Uint8Array,
): Promise<{ ok: boolean; bytes: Uint8Array; ms: number; error?: string }> {
  const startMs = Date.now();
  const apiKey = Deno.env.get('CLIPDROP_API_KEY');
  if (!apiKey) {
    return { ok: false, bytes: new Uint8Array(), ms: 0, error: 'CLIPDROP_API_KEY not set' };
  }

  const form = new FormData();
  form.append('image_file', new Blob([srcBytes], { type: 'image/png' }), 'image.png');
  form.append('mask_file', new Blob([maskBytes], { type: 'image/png' }), 'mask.png');
  // "quality" is slower but produces significantly better results on textured
  // surfaces like wraps and patterned backgrounds. Same as inpaint-cleanup.
  form.append('mode', 'quality');

  try {
    const resp = await fetch(CLIPDROP_ENDPOINT, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: form,
      signal: AbortSignal.timeout(CLIPDROP_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return {
        ok: false,
        bytes: new Uint8Array(),
        ms: Date.now() - startMs,
        error: 'ClipDrop HTTP ' + resp.status + ': ' + errText.slice(0, 300),
      };
    }
    const buf = await resp.arrayBuffer();
    return { ok: true, bytes: new Uint8Array(buf), ms: Date.now() - startMs };
  } catch (e: any) {
    return {
      ok: false,
      bytes: new Uint8Array(),
      ms: Date.now() - startMs,
      error: 'ClipDrop error: ' + (e && e.message ? e.message : String(e)),
    };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any;
  try { body = await req.json(); } catch (e: any) {
    return failAt('parse_body', 'Invalid JSON: ' + (e && e.message ? e.message : String(e)));
  }

  try {
    const user_id = body.user_id;
    const file_url = body.file_url;
    const file_name = body.file_name;
    const points = Array.isArray(body.points) ? body.points : [];
    const radius_norm = typeof body.radius_norm === 'number' ? body.radius_norm : 0.05;
    const order_number = body.order_number;
    if (!file_url) return failAt('input', 'file_url required', { received_keys: Object.keys(body) });
    if (points.length === 0) return failAt('input', 'At least one click point required', { points_received: points });

    const startMs = Date.now();
    console.log('[EXTRACT] ' + (file_name || 'file') + ' | ' + points.length + ' points, r=' + radius_norm);

    let sr: Response;
    try { sr = await fetch(file_url, { headers: { 'User-Agent': 'Deno/Extract' } }); }
    catch (e: any) {
      return failAt('fetch_source', 'Network error fetching source: ' + (e && e.message ? e.message : String(e)), { file_url });
    }
    if (!sr.ok) return failAt('fetch_source', 'Source fetch HTTP ' + sr.status, { file_url, status: sr.status, statusText: sr.statusText });
    const srcBytes = new Uint8Array(await sr.arrayBuffer());

    if (srcBytes.length > MAX_INPUT_BYTES) {
      const mb = (srcBytes.length / 1024 / 1024).toFixed(1);
      return failAt('size_check', 'File is ' + mb + ' MB which is too large. Save under 50 MB and try again.', { bytes: srcBytes.length });
    }
    if (isTiff(srcBytes)) return failAt('format', 'TIFF too memory-heavy. Save as PNG or JPG and try again.');

    let built: { src: Uint8Array; mask: Uint8Array; w: number; h: number };
    try {
      built = await buildSrcAndMask(srcBytes, points, radius_norm);
    } catch (e: any) {
      return failAt('decode', 'Could not decode "' + (file_name || 'file') + '" or build mask. Save as PNG or JPG and try again.',
        { error: e && e.message ? e.message : String(e) });
    }
    console.log('[EXTRACT] working ' + built.w + 'x' + built.h + ' | src ' + built.src.length + 'B | mask ' + built.mask.length + 'B');

    const ip = await clipdropCleanup(built.src, built.mask);
    if (!ip.ok || ip.bytes.length === 0) return failAt('inpaint', ip.error || 'no output', { method: 'clipdrop-cleanup' });
    console.log('[EXTRACT] ClipDrop cleaned in ' + ip.ms + 'ms');

    const userId = user_id || 'anonymous';
    const ts = Date.now();
    const basePath = order_number ? 'production-packs/' + userId + '/' + order_number : 'file-services/' + userId + '/' + ts;
    const fileSuffix = order_number ? '-' + ts : '';
    const bgPath = basePath + '/background-cleaned' + fileSuffix + '.png';
    await sb.storage.from(BUCKET).upload(bgPath, ip.bytes, { contentType: 'image/png', upsert: true });
    const bu = sb.storage.from(BUCKET).getPublicUrl(bgPath);

    // Save the mask alongside for debugging / re-edit flows
    const dbgMaskPath = basePath + '/extract-mask' + fileSuffix + '.png';
    await sb.storage.from(BUCKET).upload(dbgMaskPath, built.mask, { contentType: 'image/png', upsert: true });
    const mu2 = sb.storage.from(BUCKET).getPublicUrl(dbgMaskPath);

    const totalMs = Date.now() - startMs;
    console.log('[EXTRACT] Done in ' + totalMs + 'ms');
    return ok({
      output_url: (bu.data && bu.data.publicUrl) || '',
      file_url: (bu.data && bu.data.publicUrl) || '',
      background_url: (bu.data && bu.data.publicUrl) || '',
      background_storage_path: bgPath,
      mask_url: (mu2.data && mu2.data.publicUrl) || '',
      mask_storage_path: dbgMaskPath,
      image_dimensions: { width: built.w, height: built.h },
      points_used: points.length,
      radius_norm: radius_norm,
      inpaint_ms: ip.ms,
      inpaint_method: 'clipdrop-cleanup',
      processing_ms: totalMs,
      step: 'extract_elements',
    });
  } catch (err: any) {
    console.error('[EXTRACT] Uncaught:', err);
    return new Response(
      JSON.stringify({ success: false, step: 'uncaught', error: 'Extract failed: ' + (err && err.message ? err.message : String(err)) }),
      { status: 500, headers: Object.assign({}, corsHeaders, { 'Content-Type': 'application/json' }) },
    );
  }
});
