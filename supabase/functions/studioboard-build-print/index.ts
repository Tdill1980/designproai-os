/**
 * studioboard-build-print — server-side proxy to the Railway print worker.
 *
 * The Railway worker (/process-panel) does the heavy print job: an
 * identity-preserving hi-res upscale (Clarity Pro when requested, else
 * Real-ESRGAN), a clean exact-size export (no mirror-bleed unless asked), and a
 * 1500-DPI CMYK TIFF + full-resolution PNG. It runs off-platform (no 256MB edge
 * limit, no Sharp pixel cap) so it doesn't OOM on the 224" sides.
 *
 * The frontend must NOT call the worker directly (the WORKER_SECRET would be
 * exposed in client code), so this function holds the secret and forwards the
 * request. It is a thin pass-through: it returns the worker's JSON verbatim
 * (tiffPath / pngPath / previewPath / dimensions), and the board turns those
 * storage paths into the per-side active version (printTiffUrl/printPngUrl).
 *
 * Input:  { jobId, userId, orderNumber, panelKey, widthInches, heightInches,
 *           inputPath, outputEps?, exact?, addBleed?, upscaler?, creativity? }
 * Output: the worker's response (200) or { error } (4xx/5xx).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Inlined from ../_shared/cors.ts so this function deploys as a single
// self-contained file (no transitive import resolution needed).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const {
      jobId, userId, orderNumber, panelKey, widthInches, heightInches, inputPath, outputEps,
      // Print controls forwarded to the worker.
      // native = the deterministic recipe: NO upscaling (native pixels = crispy),
      // just the 5" soft bleed ring. exact/upscaler/creativity are legacy paths.
      native, exact, addBleed, upscaler, creativity,
      // Topaz precision-enhance controls (owner 2026-07-27 "GO TOPAZ GIGA"):
      // useTopaz opts the panel into the enhancer; topazModel selects the
      // precision model (e.g. "High Fidelity V2") — also how the model A/B is
      // driven. Generative models are never set here.
      useTopaz, topazModel,
    } = body || {};
    if (!jobId || !userId || !panelKey || !widthInches || !heightInches || !inputPath) {
      return json({ error: "Missing required parameters (jobId, userId, panelKey, widthInches, heightInches, inputPath)" }, 400);
    }

    const WORKER_URL = Deno.env.get("WORKER_URL");
    const WORKER_SECRET = Deno.env.get("WORKER_SECRET") || "genie-worker-2026";
    if (!WORKER_URL) return json({ error: "WORKER_URL is not configured for this project" }, 500);

    const resp = await fetch(`${WORKER_URL.replace(/\/+$/, "")}/process-panel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WORKER_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId, userId, orderNumber, panelKey, widthInches, heightInches, inputPath,
        outputEps: !!outputEps,
        // Default = native: the deterministic, no-upscale recipe the shop
        // validated (native pixels are crispy because nothing is resampled) with
        // a 5" soft bleed ring. Legacy exact/clarity paths only if explicitly asked.
        native: native === undefined ? true : !!native,
        addBleed: addBleed === undefined ? true : !!addBleed,
        ...(exact === undefined ? {} : { exact: !!exact }),
        ...(upscaler ? { upscaler } : {}),
        ...(creativity === undefined ? {} : { creativity: Number(creativity) }),
        ...(useTopaz === undefined ? {} : { useTopaz: !!useTopaz }),
        ...(topazModel ? { topazModel: String(topazModel) } : {}),
        // Forward the Topaz key from Supabase secrets so the worker can run the
        // wrap-industry photographic upscaler to reach true print PPI on full-size
        // panels (the worker's own env doesn't hold this key).
        ...(Deno.env.get("TOPAZ_API_KEY") ? { topazApiKey: Deno.env.get("TOPAZ_API_KEY") } : {}),
      }),
    });

    // Pass the worker's JSON straight back (status + body), so the board sees the
    // real storage paths or the real error.
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return json({ error: `studioboard-build-print failed: ${(e as Error)?.message || e}` }, 500);
  }
});
