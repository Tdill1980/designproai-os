import { supabase } from "@/integrations/supabase/client";

/**
 * generateDisplaySafe2DProof — THE single, canonical way to produce a 2D
 * production proof that is safe to show a customer.
 *
 * OWNER CORRECTION (2026-07-27, supersedes tests/2d-proof-producer.test.ts's
 * 2026-07-25 header comment): the customer-facing 2D Production Proof MUST be
 * a FLAT ORTHOGRAPHIC ELEVATION — never photoreal 3D-style studio renders
 * (floor reflections, gloss lighting, perspective) inside a sheet labeled
 * "2D Production Proof". Live-verified on the Summit Ridge Electric job:
 * the composer-first architecture below was shipping exactly that — real
 * photoreal panel images, pixel-faithful but NOT flat 2D — and the owner
 * confirmed directly this is wrong, not acceptable, every time it recurs.
 *
 *   • DISPLAY PROOF = generate-2d-proof (the flat painter). It REDRAWS each
 *     approved view as a TRUE flat orthographic elevation with GENIE dims —
 *     zero perspective, zero studio, zero reflections — and self-persists the
 *     clean/branded artboards (master_artboard_clean_url / master_artboard_url)
 *     the per-side panels crop. This is what gets shown and saved. It is an AI
 *     generation pass and can in principle drift from the approved design, but
 *     this session's other fixes (OOM, box-detection reliability) made it
 *     reliable enough that a flat-but-occasionally-imperfect proof beats a
 *     pixel-perfect one that is never actually flat.
 *   • FALLBACK ONLY = the deterministic composer (api/compose-2d-proof, Sharp,
 *     zero-AI). Used ONLY when the flat painter itself fails outright, so a
 *     single AI hiccup doesn't leave the customer with nothing. Its output is
 *     a montage of the real (3D-style) approved views, not a flat elevation —
 *     never treat it as equivalent to the flat painter's output, and never
 *     promote it back to primary without the owner explicitly asking for that
 *     tradeoff again.
 *
 * Callers that need panel extraction (Call 8 / enticePanelsFromProof) MUST
 * use `flatProofUrl` specifically — it is the same value as `proofUrl` now
 * except when the fallback engaged, in which case panels still need the flat
 * artwork, never the composer montage.
 */
export async function generateDisplaySafe2DProof(params: {
  /** Full body for generate-2d-proof: allViewUrls, vehicle*, designName, finish, designiqGenerationId, etc. */
  body: Record<string, unknown>;
  /** Canonical DesignIQ generation id, when known — passed to the composer for its own lookups. */
  generationId?: string | null;
  /** The same view URLs the composer should montage (usually the same as body.allViewUrls). */
  viewUrls: Record<string, string>;
}): Promise<{
  /** The value to display/save — the composer's faithful montage, or the flat painter as a last resort. */
  proofUrl: string | null;
  /** The flat painter's own output — feed this to panel extraction, never `proofUrl`. */
  flatProofUrl: string | null;
  /** The composer's own output, when it succeeded. */
  displayProofUrl: string | null;
  /** Set only when BOTH producers failed and proofUrl is null. */
  error?: string;
}> {
  let flatProofUrl: string | null = null;
  let flatError: string | undefined;
  try {
    const { data, error } = await supabase.functions.invoke("generate-2d-proof", { body: params.body });
    if (error) throw new Error(error.message);
    if (!data?.success || !data?.proofUrl) throw new Error(data?.error || "Failed to generate 2D proof");
    flatProofUrl = data.proofUrl;
  } catch (e: any) {
    flatError = e?.message || String(e);
    console.warn("[2D Proof] flat-painter call failed:", flatError);
  }

  let displayProofUrl: string | null = null;
  try {
    // Forward the same vehicle/design/branding context the flat painter got —
    // compose-2d-proof uses shopName for its own WPW-vs-DesignProAI branding
    // decision and vehicleMake/Model/Year + designName/finish/dimensions for
    // its meta line and GENIE dimension band. Omitting these left the
    // composer's proof branding always defaulting one way and its dimension
    // band frequently blank — part of the "looks dated" complaint, since a
    // proof missing its GENIE size band reads as an incomplete template.
    const b = params.body || {};
    const vehicleName = (b as any).vehicleName
      || [(b as any).vehicleYear, (b as any).vehicleMake, (b as any).vehicleModel].filter(Boolean).join(" ");
    const resp = await fetch("/api/compose-2d-proof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generation_id: params.generationId || null,
        view_urls: params.viewUrls || {},
        shopName: (b as any).shopName,
        vehicleName: vehicleName || undefined,
        vehicleMake: (b as any).vehicleMake,
        vehicleModel: (b as any).vehicleModel,
        vehicleYear: (b as any).vehicleYear,
        designName: (b as any).designName,
        finish: (b as any).finish,
        dimensions: (b as any).dimensions,
      }),
    });
    if (resp.ok) {
      const cj = await resp.json();
      displayProofUrl = cj?.proofUrl || cj?.url || null;
    } else {
      console.warn("[2D Proof] composer HTTP", resp.status, "— using flat painter for display");
    }
  } catch (e: any) {
    console.warn("[2D Proof] composer failed, using flat painter for display:", e?.message || e);
  }

  // FLAT PAINTER WINS. The composer is a fallback for when the flat painter
  // fails outright, not a preference for pixel-faithfulness over flatness.
  const proofUrl = flatProofUrl || displayProofUrl;
  return {
    proofUrl,
    flatProofUrl,
    displayProofUrl,
    error: proofUrl ? undefined : (flatError || "Failed to generate 2D proof"),
  };
}
