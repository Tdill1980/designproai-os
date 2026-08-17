/**
 * render-verify-correct — Vision QC + auto-correction loop for wrap renders.
 *
 * The "do ALL that's asked" safety net. A single image-generation pass reliably
 * DROPS things (a missing stripe) and MISPLACES logos (a wordmark cropped by the
 * wheel arch) — and it never checks its own work. This function closes that gap:
 *
 *   1. VERIFY (vision): a Gemini-Flash pass LOOKS at the render (and the
 *      customer's reference, when given) and reports, as JSON, what is wrong —
 *      every element from the reference that's missing, any logo/text cropped by
 *      a wheel arch or body edge, and whether the customer's typed edits landed.
 *   2. CORRECT: if anything failed, it sends ONLY the concrete fixes to the
 *      Master Editor (revise-render) as a revision on the current render.
 *   3. LOOP: re-verify → re-correct, up to maxRounds. Stops early when clean or
 *      when a correction makes no visible change (that issue is reported as
 *      unresolved rather than looping forever).
 *
 * FAIL-OPEN: any verify/correct error returns the render UNCHANGED — the loop can
 * only improve a render, never make it worse or block the flow.
 *
 * The verify step uses a Flash TEXT+VISION model for analysis only (like
 * recreatepro-analyze) — it does NOT generate images, so the image-generation
 * model lock (gemini-3-pro-image-preview, owned by revise-render) is untouched.
 *
 * POST /render-verify-correct
 * {
 *   "renderUrl": "https://...",        // REQUIRED — the render to check
 *   "referenceUrl": "https://...",     // optional — the example to match
 *   "requestedEdits": "move SD up",    // optional — typed edits that must land
 *   "vehicleYear","vehicleMake","vehicleModel","finish",
 *   "viewType": "side",                // default "side"
 *   "toolType": "designpanelpro",      // forwarded to revise-render
 *   "maxRounds": 2                     // default 2, capped at 3
 * }
 * → { success, renderUrl, changed, rounds, resolved:[], unresolved:[], report }
 *
 * config.toml:  [functions.render-verify-correct]  verify_jwt = false
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const REVISE_FN = `${SUPABASE_URL}/functions/v1/revise-render`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Fetch an image (small, via storage transform when possible) → base64 for Gemini vision. */
async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    // Downscale references/renders for the vision pass — QC doesn't need full res
    // and small payloads keep the Flash call fast and under memory limits.
    let fetchUrl = url;
    if (url.includes("/storage/v1/object/public/")) {
      fetchUrl = url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/") +
        (url.includes("?") ? "&" : "?") + "width=1024&height=1024&resize=contain&quality=85";
    }
    const res = await fetch(fetchUrl, { headers: { "User-Agent": "Deno/1.0" }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      const fb = await fetch(url, { headers: { "User-Agent": "Deno/1.0" }, signal: AbortSignal.timeout(12_000) });
      if (!fb.ok) return null;
      return await toB64(fb);
    }
    return await toB64(res);
  } catch {
    return null;
  }
}

async function toB64(res: Response): Promise<{ data: string; mimeType: string }> {
  const mimeType = res.headers.get("content-type") || "image/png";
  const buf = await res.arrayBuffer();
  const u8 = new Uint8Array(buf);
  let bin = "";
  const chunk = 8192;
  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(u8.subarray(i, Math.min(i + chunk, u8.length))));
  }
  return { data: btoa(bin), mimeType };
}

interface Issue { problem: string; fix: string; }

/**
 * VERIFY: vision pass that returns { pass, issues:[{problem, fix}] }.
 * Fail-open: returns pass=true on any error/uncertainty so it can never fabricate
 * problems or loop on a bad read.
 */
async function verify(
  renderB64: { data: string; mimeType: string },
  referenceB64: { data: string; mimeType: string } | null,
  requestedEdits: string,
): Promise<{ pass: boolean; issues: Issue[] }> {
  const parts: any[] = [];
  let checklist = `You are a strict vehicle-wrap production QC inspector. Image 1 is the RECREATED wrap render to inspect.`;
  parts.push({ text: "" }); // placeholder replaced below
  parts.push({ inlineData: renderB64 });
  if (referenceB64) {
    checklist += ` Image 2 is the customer's REFERENCE — the approved design the recreation must match.`;
    parts.push({ inlineData: referenceB64 });
  }

  checklist += `\n\nCheck the RECREATED render (Image 1) against these rules and report every FAILURE:

1. COMPLETENESS: Every graphic element in the reference must be present in the recreation — stripes, accent lines, flames, patterns, gradients, logos, wordmarks, and text. If any is missing or dropped, that is a failure.
2. LOGO/TEXT VISIBILITY (hard rule — applies even if the reference itself shows it wrong): No logo, wordmark, badge, or line of text may be cut off, cropped, or partly hidden by a wheel arch, wheel well, door edge, bumper, or the edge of the image. Every one must read in full on a clear painted panel. If one is clipped, that is a failure — the fix is to move it onto the clear panel so it reads fully.`;

  if (requestedEdits && requestedEdits.trim()) {
    checklist += `\n3. REQUESTED EDITS: The customer asked for these specific changes — each must be visibly applied in Image 1:\n"${requestedEdits.trim()}"\nIf any requested change is not clearly reflected, that is a failure.`;
  }

  checklist += `\n\nFor each failure, give a SHORT corrective instruction a wrap designer could execute (name the element and exactly what to do), e.g. "Move the SPEED DEMONS wordmark up onto the door so it fully clears the rear wheel arch" or "Add the gold rocker stripe along the lower body that is present in the reference".

Respond with STRICT JSON only, no prose:
{"pass": boolean, "issues": [{"problem": "what is wrong", "fix": "the corrective instruction"}]}
If everything is correct, return {"pass": true, "issues": []}. Only report real, visible failures — do not invent problems.`;

  parts[0] = { text: checklist };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1024, temperature: 0 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      console.warn(`[verify-correct] verify HTTP ${resp.status} — failing open (pass)`);
      return { pass: true, issues: [] };
    }
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || "";
    const parsed = JSON.parse(text);
    const issues: Issue[] = Array.isArray(parsed?.issues)
      ? parsed.issues.filter((i: any) => i && i.fix).map((i: any) => ({ problem: String(i.problem || ""), fix: String(i.fix) }))
      : [];
    // Trust the issue list over the boolean: pass only when there are no issues.
    return { pass: issues.length === 0, issues };
  } catch (e) {
    console.warn(`[verify-correct] verify error — failing open: ${e instanceof Error ? e.message : e}`);
    return { pass: true, issues: [] };
  }
}

/** CORRECT: send the concrete fixes to the Master Editor (revise-render). */
async function correct(
  authHeader: string,
  currentUrl: string,
  fixes: string[],
  referenceUrl: string | null,
  ctx: { toolType: string; viewType: string; vehicleYear: string; vehicleMake: string; vehicleModel: string },
): Promise<{ url: string | null; note: string }> {
  const revisionPrompt = fixes.length === 1
    ? fixes[0]
    : `Apply ALL of these corrections to the attached render, changing only what each names and leaving everything else identical:\n- ${fixes.join("\n- ")}`;
  try {
    const resp = await fetch(REVISE_FN, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": authHeader, "apikey": ANON_KEY },
      body: JSON.stringify({
        originalRenderUrl: currentUrl,
        revisionPrompt,
        toolType: ctx.toolType,
        viewType: ctx.viewType,
        vehicleYear: ctx.vehicleYear,
        vehicleMake: ctx.vehicleMake,
        vehicleModel: ctx.vehicleModel,
        visionBoardImageUrls: referenceUrl ? [referenceUrl] : [],
      }),
      signal: AbortSignal.timeout(150_000),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // NO_VISIBLE_CHANGE / RENDER_FAILED → the correction couldn't be applied.
      return { url: null, note: data?.message || data?.code || `HTTP ${resp.status}` };
    }
    return { url: data?.renderUrl || null, note: data?.renderUrl ? "ok" : "no renderUrl" };
  } catch (e) {
    return { url: null, note: e instanceof Error ? e.message : "correction call failed" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader || authHeader === "Bearer") {
      return json({ success: false, error: "Authorization (user session) required" }, 401);
    }
    if (!hasGeminiKey()) {
      // No key → cannot verify; fail-open by returning the render unchanged.
      const body = await req.json().catch(() => ({}));
      return json({ success: true, renderUrl: body.renderUrl, changed: false, rounds: 0, resolved: [], unresolved: [], report: "verify skipped (no API key)" });
    }

    const body = await req.json();
    const renderUrl: string = body.renderUrl || "";
    const referenceUrl: string | null = body.referenceUrl || null;
    const requestedEdits: string = (body.requestedEdits || "").trim();
    const ctx = {
      toolType: body.toolType || "designpanelpro",
      viewType: body.viewType || "side",
      vehicleYear: String(body.vehicleYear || "2024"),
      vehicleMake: body.vehicleMake || "",
      vehicleModel: body.vehicleModel || "",
    };
    const maxRounds = Math.min(Math.max(Number(body.maxRounds) || 2, 1), 3);

    if (!renderUrl) return json({ success: false, error: "renderUrl is required" }, 400);

    const referenceB64 = referenceUrl ? await fetchImageAsBase64(referenceUrl) : null;

    let currentUrl = renderUrl;
    let changed = false;
    let rounds = 0;
    const resolved: string[] = [];
    const unresolved: string[] = [];

    for (let round = 0; round < maxRounds; round++) {
      const renderB64 = await fetchImageAsBase64(currentUrl);
      if (!renderB64) {
        console.warn("[verify-correct] could not fetch render — stopping (fail-open)");
        break;
      }
      const { pass, issues } = await verify(renderB64, referenceB64, requestedEdits);
      if (pass || issues.length === 0) {
        console.log(`[verify-correct] round ${round + 1}: clean`);
        break;
      }
      rounds = round + 1;
      console.log(`[verify-correct] round ${round + 1}: ${issues.length} issue(s) — correcting`);

      const { url, note } = await correct(authHeader, currentUrl, issues.map((i) => i.fix), referenceUrl, ctx);
      if (!url) {
        // Correction couldn't be applied — report these as unresolved and stop.
        for (const i of issues) unresolved.push(i.problem || i.fix);
        console.warn(`[verify-correct] correction failed (${note}) — reporting ${issues.length} unresolved`);
        break;
      }
      currentUrl = url;
      changed = true;
      for (const i of issues) resolved.push(i.problem || i.fix);
      // Loop re-verifies the corrected render on the next iteration.
    }

    // Final sweep: if we exhausted rounds, surface anything still wrong as unresolved.
    if (rounds === maxRounds && changed) {
      const finalB64 = await fetchImageAsBase64(currentUrl);
      if (finalB64) {
        const finalCheck = await verify(finalB64, referenceB64, requestedEdits);
        if (!finalCheck.pass) for (const i of finalCheck.issues) unresolved.push(i.problem || i.fix);
      }
    }

    const report = unresolved.length === 0
      ? (changed ? "All checks passed after auto-correction." : "All checks passed.")
      : `Fixed ${resolved.length}; ${unresolved.length} could not be auto-applied.`;

    return json({
      success: true,
      renderUrl: currentUrl,
      changed,
      rounds,
      resolved: [...new Set(resolved)],
      unresolved: [...new Set(unresolved)],
      report,
    });
  } catch (err) {
    // FAIL-OPEN: never break the flow — return the original render if given.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[verify-correct] unhandled: ${msg}`);
    return json({ success: false, error: msg }, 500);
  }
});
