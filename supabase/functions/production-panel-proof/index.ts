/**
 * production-panel-proof — CALL 1 AS A FLAT PANEL PRODUCTION PROOF.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-18: "Gemini image pro 3's newest model has no
 * issues generating text we need to rely on our custom design persona edge
 * functions and Gemini's own brain and test a flat panel production proof ...
 * it must be fed a real flat panel production proof and given the base prompt
 * system engineering so it knows its job on call 1 and has a clear example and
 * done with thought multi modal best practices."
 *
 * WHY A SEPARATE FUNCTION AND NOT A BRANCH IN design-panel-ai-generate.
 *
 * That function is the SOLE Call-1 network endpoint (RULE 0.26) and carries
 * three live modes. A new contract inside it is a new way for an edit to reach
 * atlas-artboard, which is what every customer generation runs through today.
 * A separate function cannot: production keeps calling the endpoint it always
 * called, byte for byte, whatever happens in here.
 *
 * THIS IS A PROBE SURFACE, NOT A PRODUCT PATH. Nothing routes to it. It writes
 * no revision, generation, view or artifact row. It returns the proof bytes and
 * its own provenance so the owner can look at the sheet before anything is
 * wired. That is the first rung of the same safety ladder RULE 0.35 describes
 * for the hero-driver cascade.
 *
 * WHAT IT IS TESTING, precisely, because the answer decides real architecture:
 *
 *   1. Does asking for the OBJECT the model draws well -- a panel production
 *      proof, the document a print shop receives -- produce six full-bleed
 *      panels instead of the die-cut layout drawing every previous contract
 *      got? Every documented Call-1 experiment changed the ASK and kept the
 *      object a bare artboard; RULE 0.38's canary table says the artwork was
 *      right and the object was wrong.
 *   2. Can gemini-3-pro-image be trusted with the customer's exact strings?
 *      The element graph exists because RestylePro measured a proof reading
 *      877-555-0000 / stanewerks.com against a hero reading 555-0142 /
 *      cascadestoneworks.com. If that premise has expired, mechanical
 *      typesetting is solving a problem that no longer exists -- and the
 *      composited slab it produces measured 1.95:1 contrast on 34613569.
 *   3. Does ONE designer producing branded + artwork-only + cut proof in one
 *      pass give the cohesion no compositor can?
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { PRIMARY_IMAGE_MODEL, geminiImageUrl } from "../_shared/model-config.ts";
import { resolveDesignProInternalCaller } from "../_shared/designpro-internal-call.ts";
import {
  ATLAS_PANEL_PROOF_CONTRACT,
  buildPanelProofPrompt,
} from "../_shared/atlas-panel-proof-prompt.ts";

const BUCKET = "wrap-files";

/**
 * The two pinned multimodal inputs.
 *
 * FORMAT, NOT STYLE. The proof sheet teaches the document's layout, captions
 * and dimension callouts; the prompt says in as many words that its artwork is
 * not a style reference. That distinction is RULE 0.24's whole subject, and
 * canary 33389124918 is what happens when a reference teaches more than it was
 * meant to -- an installed vehicle proof put wheel wells and template furniture
 * back into the source rectangles.
 *
 * The installation photograph is the PHYSICAL REASON a panel is one rectangle.
 * A positive fact conditions better than "do not draw wheel arches", which is
 * the negative shape this repo warns about in four places and which has failed
 * 4/4 on the field map.
 */
const PINNED_INPUTS = [
  { path: "atlas-examples/panel-production-proof-example.png", role: "format" },
  { path: "atlas-examples/installer-one-panel-per-side.png", role: "installation" },
] as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sha256Hex = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const svc = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // INTERNAL ONLY. This spends a real image request against the production
  // project; it is not reachable by a customer session.
  const caller = await resolveDesignProInternalCaller(req, svc);
  if (!caller.internal || !caller.userId) {
    return json({ error: "production_panel_proof_internal_only" }, 403);
  }
  if (!hasGeminiKey()) return json({ error: "production_panel_proof_no_key" }, 503);

  const requestId = crypto.randomUUID();
  try {
    const body = await req.json();

    const panelRows = Array.isArray(body?.panelRows)
      ? (body.panelRows as unknown[]).map((row) => String(row || "").trim()).filter(Boolean)
      : [];
    const prompt = buildPanelProofPrompt({
      companyName: body?.companyName,
      phone: body?.phone,
      website: body?.website,
      vehicleYear: body?.vehicleYear,
      vehicleMake: body?.vehicleMake,
      vehicleModel: body?.vehicleModel,
      creativeDirection: body?.creativeDirection || body?.prompt,
      panelRows,
    });

    // THE BIG INPUTS TRAVEL BY STORAGE PATH, NOT INSIDE THE JSON BODY.
    // Live 2026-08-27: a 2.2MB request as inline base64 killed the worker 25s
    // in, twice, with a bodiless 504.
    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    const attached: Array<Record<string, unknown>> = [];
    for (const pinned of PINNED_INPUTS) {
      const { data, error } = await svc.storage.from(BUCKET).download(pinned.path);
      if (error || !data) throw new Error(`panel_proof_input_missing:${pinned.path}`);
      const bytes = new Uint8Array(await data.arrayBuffer());
      parts.push({ inlineData: { mimeType: "image/png", data: encodeBase64(bytes) } });
      attached.push({ role: pinned.role, path: pinned.path, sha256: await sha256Hex(bytes), byteSize: bytes.length });
    }

    const t0 = Date.now();
    const response = await fetch(geminiImageUrl(getGeminiKey(), PRIMARY_IMAGE_MODEL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`panel_proof_provider_http_${response.status}:${(await response.text()).slice(0, 300)}`);
    }
    const payload = await response.json();
    const candidateParts = payload?.candidates?.[0]?.content?.parts ?? [];
    const image = candidateParts.find((p: Record<string, unknown>) => (p as { inlineData?: unknown }).inlineData);
    if (!image) {
      throw new Error(`panel_proof_no_image:${payload?.candidates?.[0]?.finishReason || "unknown"}`);
    }
    const bytes = decodeBase64(image.inlineData.data as string);
    const sha256 = await sha256Hex(bytes);
    const storagePath = `atlas-panel-proof/${sha256}.png`;
    const { error: upErr } = await svc.storage.from(BUCKET)
      .upload(storagePath, bytes, { contentType: "image/png", upsert: false });
    if (upErr && !/exists/i.test(String(upErr.message))) throw upErr;

    return json({
      success: true,
      contract: ATLAS_PANEL_PROOF_CONTRACT,
      requestId,
      model: PRIMARY_IMAGE_MODEL,
      proofStoragePath: storagePath,
      proofSha256: sha256,
      proofByteSize: bytes.length,
      // The whole assembled ask, so a disagreement about the design is settled
      // on the REQUEST rather than on impressions of the output -- the reason
      // the designiq A/B harness exists at all.
      promptChars: prompt.length,
      prompt,
      attachedInputs: attached,
      elapsedMs: Date.now() - t0,
      // Whether the model returned reasoning alongside the image, so the
      // base -> typography continuation can be judged before it is built.
      thoughtSignatureCount: candidateParts
        .filter((p: Record<string, unknown>) => typeof p?.thoughtSignature === "string").length,
    });
  } catch (error) {
    return json({ error: String((error as Error)?.message || error), requestId }, 500);
  }
});

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
