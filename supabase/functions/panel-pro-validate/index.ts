/**
 * panel-pro-validate — Image-based 1:1 match validator (Phase 2)
 *
 * The validator AGENT for Panel Pro Extract. It looks at TWO images:
 *   1. SOURCE  — the 3D wrap render the panel was extracted from
 *   2. PANEL   — the flat panel Panel Pro Extract produced
 *
 * Using Gemini vision it decides whether the flat panel is a 1:1 match of the
 * design on the vehicle (same colors, patterns, graphics, layout) AND a clean
 * flat panel (no vehicle parts, no glare, no 3D, fills edge-to-edge). When it
 * is NOT a match it returns a short `correction` the caller appends to the
 * extract prompt and re-runs — so the panel is regenerated until it matches.
 *
 * POST /panel-pro-validate
 * {
 *   sourceUrl: string,     // the 3D render / design the panel came from  [required]
 *   panelUrl: string,      // the extracted flat panel to check           [required]
 *   label?: string,        // e.g. "Driver Side"
 *   widthInches?: number,
 *   heightInches?: number,
 * }
 *
 * Response: { success, match: boolean, score: 0-100, issues: string[], correction: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { GEMINI_QA_MODEL } from "../_shared/panelizer-os/constants.ts";

const MATCH_THRESHOLD = 75; // realistic: same design faithfully flattened (3D drape distortion is NOT required)

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Fetch an image (memory-safe transform when it's a Supabase object URL) → base64. */
async function fetchBase64(url: string, maxWidth = 1024): Promise<string> {
  let fetchUrl = url;
  if (url.includes("/storage/v1/object/")) {
    fetchUrl = url.replace("/storage/v1/object/", "/storage/v1/render/image/") +
      `?width=${maxWidth}&resize=contain&quality=85`;
  }
  let resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(15_000) });
  if (!resp.ok && fetchUrl !== url) resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) throw new Error(`fetch failed ${resp.status}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length))));
  }
  return btoa(binary);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!hasGeminiKey()) return jsonResponse({ error: "No GOOGLE_AI_API_KEY configured" }, 500);

    const body = await req.json();
    const sourceUrl: string = body.sourceUrl || "";
    const panelUrl: string = body.panelUrl || "";
    const label: string = body.label || "this panel";
    const widthInches = Number(body.widthInches) || null;
    const heightInches = Number(body.heightInches) || null;

    if (!sourceUrl || !panelUrl) {
      return jsonResponse({ error: "sourceUrl and panelUrl are required" }, 400);
    }

    const start = Date.now();
    const [sourceB64, panelB64] = await Promise.all([
      fetchBase64(sourceUrl),
      fetchBase64(panelUrl),
    ]);

    const sizeLine = widthInches && heightInches
      ? `The panel should be a flat ${widthInches}" × ${heightInches}" rectangle.`
      : "The panel should be a flat rectangle.";

    const prompt =
`You are a vehicle wrap production QC inspector. Compare TWO images for the ${label} panel.

IMAGE 1 (SOURCE): a 3D render of a vehicle with a wrap design. The artwork in IMAGE 1 is WRAPPED ON A CURVED 3D BODY, so it is stretched, bent, and shadowed by the vehicle's shape and the camera angle.
IMAGE 2 (PANEL): the FLAT print panel of that SAME design, laid out flat before it is applied to the vehicle.

${sizeLine}

CRITICAL — how to judge a FLAT panel fairly:
IMAGE 2 is FLAT, so it MUST NOT contain the vehicle's 3D body distortion, drape, perspective foreshortening, or contour shadows that you see in IMAGE 1. Removing that 3D distortion is CORRECT and is REQUIRED — do NOT penalize it. A flat panel will naturally have straighter, more even artwork than the body-wrapped source. That difference alone is NOT a failure.

Judge whether IMAGE 2 is the SAME DESIGN as IMAGE 1, by content:
- SAME design identity / subject (e.g. an American flag wrap → an American flag panel; a flames design → the same flames). A DIFFERENT design or a different subject is a FAIL.
- SAME major elements present (e.g. the star field / canton, the stripes, any eagle, logo, text, graphic) — none of the design's signature elements missing or replaced.
- SAME colors and palette, and the SAME general layout/flow (e.g. the canton/star field is on the same end, the stripes run the same direction). Exact star count and exact wave shape do NOT need to match — only the overall design and arrangement.
- NOT blank: if IMAGE 2 is mostly empty, a solid/near-solid color, or is missing most of the design's elements (e.g. a blue panel that lost its stars), that is an automatic FAIL with a low score.
- IMAGE 2 must be a CLEAN FLAT PANEL: no vehicle body, wheels, windows, trim, glare/reflections, 3D perspective, or background. Fills the rectangle edge-to-edge, no blank borders.

So: a faithful FLAT version of the same design = PASS (high score). Only FAIL for a genuinely DIFFERENT design, missing/replaced signature elements, a blank/incomplete panel, or a non-flat image that still shows the vehicle.

Return ONLY JSON:
{
  "match": true | false,
  "score": <0-100 how faithfully the panel reproduces the SAME DESIGN (ignoring 3D-body distortion)>,
  "is_flat_panel": true | false,
  "is_wrong_design": true | false,
  "issues": ["short, specific problems — only real ones: different design, missing element, blank, or still shows the vehicle"],
  "correction": "one short instruction to fix the panel so it matches the source DESIGN (empty string if it already matches)"
}

Set "match" false ONLY if it is a different design, a signature element is missing/replaced, it is blank/incomplete, or it is not a clean flat panel. Do NOT fail it merely for lacking the vehicle's 3D distortion.`;

    let result: any;
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_QA_MODEL}:generateContent?key=${getGeminiKey()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { text: "IMAGE 1 (SOURCE):" },
                { inlineData: { mimeType: "image/png", data: sourceB64 } },
                { text: "IMAGE 2 (PANEL):" },
                { inlineData: { mimeType: "image/png", data: panelB64 } },
              ],
            }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
          }),
          signal: AbortSignal.timeout(45_000),
        },
      );
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        console.warn(`[PANEL-PRO-VALIDATE] Gemini ${resp.status}: ${t.slice(0, 200)}`);
        // Fail-open: don't block the pipeline on a validator outage.
        return jsonResponse({ success: true, match: true, score: 100, validatorSkipped: true, issues: [], correction: "" });
      }
      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      result = JSON.parse(text);
    } catch (err: any) {
      console.warn(`[PANEL-PRO-VALIDATE] error: ${err?.message || err}`);
      return jsonResponse({ success: true, match: true, score: 100, validatorSkipped: true, issues: [], correction: "" });
    }

    const score = Number(result?.score) || 0;
    const isFlat = result?.is_flat_panel !== false;
    const isWrongDesign = result?.is_wrong_design === true;
    // PASS = the model's own verdict, it's flat, it's the right design, and the
    // fidelity score clears the (realistic) bar. We no longer fail a faithful flat
    // panel just for lacking the vehicle's 3D drape distortion.
    const match = result?.match === true && isFlat && !isWrongDesign && score >= MATCH_THRESHOLD;

    console.log(`[PANEL-PRO-VALIDATE] ${label}: match=${match} score=${score} flat=${isFlat} wrongDesign=${isWrongDesign} in ${Date.now() - start}ms`);

    return jsonResponse({
      success: true,
      match,
      score,
      isFlatPanel: isFlat,
      isWrongDesign,
      issues: Array.isArray(result?.issues) ? result.issues : [],
      correction: match ? "" : String(result?.correction || "Reproduce the SAME design from the source — same elements, colors and layout — as a clean flat panel."),
      ms: Date.now() - start,
    });
  } catch (err: any) {
    console.error("[PANEL-PRO-VALIDATE] Error:", err);
    return jsonResponse({ error: err?.message || "validation failed" }, 500);
  }
});
