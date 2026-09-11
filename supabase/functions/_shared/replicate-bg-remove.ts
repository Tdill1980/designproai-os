/**
 * replicate-bg-remove.ts — Real subject segmentation + layer split via Replicate
 *
 * - replicateBgRemove(): BiRefNet alpha matting → transparent subject cutout
 * - replicateInpaintBackground(): LaMa-Cleaner → clean background plate with
 *   the subject erased and filled in. Used for "save the background" flows.
 *
 * Both use REPLICATE_API_TOKEN already in Supabase secrets.
 */

// 851-labs/background-remover (BiRefNet) — high-quality alpha matting
// pinned version hash: stable, public, no auth gating.
const BG_REMOVE_MODEL_VERSION = "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc";
// lucataco/cog-lama-cleaner — LaMa-based object removal w/ a mask.
// Uses the model-name endpoint so we don't pin a stale version hash.
const INPAINT_MODEL_OWNER = "lucataco";
const INPAINT_MODEL_NAME = "cog-lama-cleaner";
const POLL_INTERVAL_MS = 1000;
const POLL_MAX = 90;

export interface BgRemoveResult {
  imageBytes: Uint8Array;
  removed: boolean;
  method: string;
  elapsedMs: number;
  error?: string;
}

/**
 * Run a single bg-remove prediction. The caller is responsible for uploading
 * the source bytes somewhere Replicate can fetch (a signed Supabase URL is
 * fine — 5-min expiry is enough).
 */
export async function replicateBgRemove(
  signedUrl: string,
  timeoutMs = 90_000,
): Promise<BgRemoveResult> {
  const startMs = Date.now();
  const replicateKey = Deno.env.get("REPLICATE_API_TOKEN");

  if (!replicateKey) {
    return {
      imageBytes: new Uint8Array(),
      removed: false,
      method: "none",
      elapsedMs: 0,
      error: "REPLICATE_API_TOKEN not set",
    };
  }

  try {
    // Prefer: wait holds the response server-side for up to 60s while the
    // prediction runs. Client abort must be longer than that window or fast
    // predictions get killed mid-flight (was 20s — caused most cold starts
    // to fail with abort before Replicate could respond).
    const predResp = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${replicateKey}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        version: BG_REMOVE_MODEL_VERSION,
        input: { image: signedUrl },
      }),
      signal: AbortSignal.timeout(65_000),
    });

    if (!predResp.ok) {
      const errText = await predResp.text().catch(() => "");
      return {
        imageBytes: new Uint8Array(),
        removed: false,
        method: "replicate-birefnet",
        elapsedMs: Date.now() - startMs,
        error: `Replicate create failed HTTP ${predResp.status}: ${errText.slice(0, 300)}`,
      };
    }

    let result = await predResp.json();
    let polls = 0;

    while (
      result.status !== "succeeded" &&
      result.status !== "failed" &&
      result.status !== "canceled" &&
      polls < POLL_MAX
    ) {
      if (Date.now() - startMs > timeoutMs) {
        return {
          imageBytes: new Uint8Array(),
          removed: false,
          method: "replicate-birefnet",
          elapsedMs: Date.now() - startMs,
          error: `Timeout after ${timeoutMs}ms`,
        };
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      polls++;

      if (!result.urls?.get) break;
      const statusResp = await fetch(result.urls.get, {
        headers: { Authorization: `Bearer ${replicateKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (statusResp.ok) result = await statusResp.json();
    }

    if (result.status !== "succeeded" || !result.output) {
      return {
        imageBytes: new Uint8Array(),
        removed: false,
        method: "replicate-birefnet",
        elapsedMs: Date.now() - startMs,
        error: `Prediction ${result.status || "stalled"}: ${result.error || "no output"}`,
      };
    }

    const outputUrl = typeof result.output === "string"
      ? result.output
      : Array.isArray(result.output)
      ? result.output[0]
      : result.output;

    if (!outputUrl || typeof outputUrl !== "string") {
      return {
        imageBytes: new Uint8Array(),
        removed: false,
        method: "replicate-birefnet",
        elapsedMs: Date.now() - startMs,
        error: "Output URL missing or not a string",
      };
    }

    const dlResp = await fetch(outputUrl, { signal: AbortSignal.timeout(30_000) });
    if (!dlResp.ok) {
      return {
        imageBytes: new Uint8Array(),
        removed: false,
        method: "replicate-birefnet",
        elapsedMs: Date.now() - startMs,
        error: `Download failed HTTP ${dlResp.status}`,
      };
    }

    const buf = await dlResp.arrayBuffer();
    return {
      imageBytes: new Uint8Array(buf),
      removed: true,
      method: "replicate-birefnet",
      elapsedMs: Date.now() - startMs,
    };
  } catch (err: any) {
    return {
      imageBytes: new Uint8Array(),
      removed: false,
      method: "replicate-birefnet",
      elapsedMs: Date.now() - startMs,
      error: `BG remove error: ${err?.message || String(err)}`,
    };
  }
}

export interface InpaintResult {
  imageBytes: Uint8Array;
  inpainted: boolean;
  method: string;
  elapsedMs: number;
  error?: string;
}

/**
 * Inpaint a region of an image using LaMa-style object removal. The mask
 * defines what gets erased — white pixels are removed and filled in with
 * plausible background, black pixels are kept as-is.
 *
 * Used to produce a clean "background plate" after BG removal: feed the
 * original image + an inverse-alpha mask of the subject, and you get back
 * the wrap art with the logo/subject erased.
 *
 * Both URLs must be publicly fetchable by Replicate (signed Supabase URLs
 * are fine — 5–10 min expiry is enough).
 */
export async function replicateInpaintBackground(
  imageSignedUrl: string,
  maskSignedUrl: string,
  timeoutMs = 90_000,
): Promise<InpaintResult> {
  const startMs = Date.now();
  const replicateKey = Deno.env.get("REPLICATE_API_TOKEN");

  if (!replicateKey) {
    return {
      imageBytes: new Uint8Array(),
      inpainted: false,
      method: "none",
      elapsedMs: 0,
      error: "REPLICATE_API_TOKEN not set",
    };
  }

  try {
    // Use the model-name endpoint so we always hit the model's default
    // version (no stale-hash drift). LaMa-style inpainters take {image, mask}.
    const predResp = await fetch(
      `https://api.replicate.com/v1/models/${INPAINT_MODEL_OWNER}/${INPAINT_MODEL_NAME}/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${replicateKey}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          input: { image: imageSignedUrl, mask: maskSignedUrl },
        }),
        signal: AbortSignal.timeout(65_000),
      },
    );

    if (!predResp.ok) {
      const errText = await predResp.text().catch(() => "");
      return {
        imageBytes: new Uint8Array(),
        inpainted: false,
        method: "replicate-lama",
        elapsedMs: Date.now() - startMs,
        error: `Replicate inpaint create failed HTTP ${predResp.status}: ${errText.slice(0, 300)}`,
      };
    }

    let result = await predResp.json();
    let polls = 0;
    while (
      result.status !== "succeeded" &&
      result.status !== "failed" &&
      result.status !== "canceled" &&
      polls < POLL_MAX
    ) {
      if (Date.now() - startMs > timeoutMs) {
        return {
          imageBytes: new Uint8Array(),
          inpainted: false,
          method: "replicate-lama",
          elapsedMs: Date.now() - startMs,
          error: `Inpaint timeout after ${timeoutMs}ms`,
        };
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      polls++;
      if (!result.urls?.get) break;
      const statusResp = await fetch(result.urls.get, {
        headers: { Authorization: `Bearer ${replicateKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (statusResp.ok) result = await statusResp.json();
    }

    if (result.status !== "succeeded" || !result.output) {
      return {
        imageBytes: new Uint8Array(),
        inpainted: false,
        method: "replicate-lama",
        elapsedMs: Date.now() - startMs,
        error: `Inpaint ${result.status || "stalled"}: ${result.error || "no output"}`,
      };
    }

    const outputUrl = typeof result.output === "string"
      ? result.output
      : Array.isArray(result.output)
      ? result.output[0]
      : result.output;

    if (!outputUrl || typeof outputUrl !== "string") {
      return {
        imageBytes: new Uint8Array(),
        inpainted: false,
        method: "replicate-lama",
        elapsedMs: Date.now() - startMs,
        error: "Inpaint output URL missing or not a string",
      };
    }

    const dlResp = await fetch(outputUrl, { signal: AbortSignal.timeout(30_000) });
    if (!dlResp.ok) {
      return {
        imageBytes: new Uint8Array(),
        inpainted: false,
        method: "replicate-lama",
        elapsedMs: Date.now() - startMs,
        error: `Inpaint download failed HTTP ${dlResp.status}`,
      };
    }

    const buf = await dlResp.arrayBuffer();
    return {
      imageBytes: new Uint8Array(buf),
      inpainted: true,
      method: "replicate-lama",
      elapsedMs: Date.now() - startMs,
    };
  } catch (err: any) {
    return {
      imageBytes: new Uint8Array(),
      inpainted: false,
      method: "replicate-lama",
      elapsedMs: Date.now() - startMs,
      error: `Inpaint error: ${err?.message || String(err)}`,
    };
  }
}
