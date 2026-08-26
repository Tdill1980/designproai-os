/**
 * designpro-orchestrate — the flat artboard, and an honest handoff for the 3D
 *
 * STEP 2 USED TO POST TO A FUNCTION THAT DOES NOT EXIST HERE.
 *
 * `designpro-recreate-3d` was never ported from restylepro-os and has never been
 * deployed on this project, so every call 404'd and this function reported it as
 * `3D recreate failed (HTTP 404)` — a step pointing at nothing, dressed up as a
 * downstream outage. Nothing called this function, so nothing surfaced it.
 *
 * It is obsolete, not missing. What it did — Driver from the flat artboard by
 * `artboard_projection`, then each remaining camera cloned from the accepted
 * Driver — is exactly what `runAtlasProofStages` does in
 * runtime/generation-worker.cjs today, and RULE 0.16 puts Calls 1-7 in that
 * runtime rather than in an Edge Function. Restoring the Edge copy would be a
 * second producer of the same seven views, which the one-sanctioned-chain rule
 * forbids. So the step is removed rather than repaired.
 *
 * What remains is the half this function can actually do, and it says so:
 *
 *   1. designpro-artboard → the flat artboard, its clean design, its panels
 *   2. a handoff naming the runtime that owns the proofs
 *
 * The caller's user JWT is still forwarded, because designpro-artboard resolves
 * the owner from it.
 *
 * POST /designpro-orchestrate
 * {
 *   "designDescription": "Summit Realty Group ...", "companyName": "...",
 *   "vehicleYear": "2022", "vehicleMake": "Cadillac", "vehicleModel": "Escalade ESV",
 *   "bodyType": "suv", "finish": "Gloss",
 *   "panelDims": {...}, "styleReferenceUrl": "...", "logoUrl": "...",
 *   "generationId": "uuid"
 * }
 * → { success, artboardUrl, designUrl, panels, proofs: { produced, owner, reason } }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function callFn(slug: string, payload: Record<string, unknown>, authHeader: string, timeoutMs: number): Promise<any> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader || `Bearer ${ANON_KEY}`,
      "apikey": ANON_KEY,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const body = await req.json();

    const designDescription: string = (body.designDescription || body.prompt || "").trim();
    const companyName: string = body.companyName || "";
    const vehicleYear: string = String(body.vehicleYear || body.year || "2024");
    const vehicleMake: string = (body.vehicleMake || body.make || "").trim();
    const vehicleModel: string = (body.vehicleModel || body.model || "").trim();
    const bodyType: string = body.bodyType || "suv";
    const finish: string = body.finish || "Gloss";

    if (!designDescription) return json({ success: false, error: "designDescription (or prompt) is required" }, 400);
    if (!vehicleMake || !vehicleModel) return json({ success: false, error: "vehicleMake and vehicleModel are required" }, 400);
    if (!authHeader) return json({ success: false, error: "Authorization (user session) required" }, 401);

    console.log(`[ORCHESTRATE] ${vehicleYear} ${vehicleMake} ${vehicleModel} — artboard-first`);

    // ── STEP 1: artboard FIRST ──
    const ab = await callFn("designpro-artboard", {
      designDescription, companyName, vehicleYear, vehicleMake, vehicleModel,
      bodyType, finish,
      ...(body.panelDims ? { panelDims: body.panelDims } : {}),
      ...(body.styleReferenceUrl ? { styleReferenceUrl: body.styleReferenceUrl } : {}),
      ...(body.logoUrl ? { logoUrl: body.logoUrl } : {}),
    }, authHeader, 170_000);

    if (!ab.ok || !ab.data?.artboardUrl) {
      return json({ success: false, stage: "artboard", error: ab.data?.error || `artboard failed (HTTP ${ab.status})` }, 502);
    }
    const artboardUrl: string = ab.data.artboardUrl;
    console.log(`[ORCHESTRATE] artboard ready`);

    // ── STEP 2: the proofs belong to the server-native runtime ──
    //
    // Deliberately NOT a call. See the header: the function this used to POST to
    // does not exist on this project, and the runtime already produces the same
    // seven views from the same frozen master.
    //
    // The artboard is still persisted as the generation's source of truth, which
    // is the one piece of STEP 3 that did not depend on the missing call.
    const generationId: string | null = (body.generationId || "").trim() || null;
    if (generationId) {
      const { error: persistErr } = await sb()
        .from("designiq_generations")
        .update({ master_artboard_url: artboardUrl } as any)
        .eq("id", generationId);
      if (persistErr) console.warn(`[ORCHESTRATE] persist master_artboard_url failed: ${persistErr.message}`);
    }

    console.log(`[ORCHESTRATE] artboard complete — proofs are the Calls 1-7 runtime's`);
    return json({
      success: true,
      artboardUrl,
      designUrl: ab.data?.designUrl || "",
      panels: ab.data?.panels || [],
      generationId,
      proofs: {
        produced: false,
        owner: "server-native Calls 1-7 runtime (runAtlasProofStages)",
        reason:
          "designpro-recreate-3d is retired on this project. Submit a flat-first "
          + "generation request so the runtime renders Driver first and projects "
          + "the remaining six from the same frozen master.",
      },
    });
  } catch (err: any) {
    console.error("[ORCHESTRATE] error:", err?.message || err);
    return json({ success: false, error: err?.message || "orchestrate error" }, 500);
  }
});
