import { supabase } from "@/integrations/supabase/client";
import { buildProductionPanels } from "@/lib/buildProductionPanels";
import { enticePanelsFromProof } from "@/lib/enticePanelsFromProof";

/**
 * creatorMarketAutoBuild — builds print files for a paid CreatorMarket order,
 * sized to the BUYER's own year/make/model (RecreatePro-class).
 *
 * The buyer enters their own vehicle, which is usually NOT the vehicle the
 * design was created on. So we NEVER crop the design's on-vehicle 2D proof
 * (that stretches graphics across the wrong body). Instead:
 *
 *   1. PANELS — slice the design's flat, vehicle-agnostic MASTER ARTBOARD at the
 *      buyer's GENIE dims (buildProductionPanels → panelize-artboard). Pure
 *      geometric crop of the actual design at the buyer's per-side sizes, keyed
 *      to THIS order's job id (no cross-buyer vault collisions).
 *   2. CUSTOMER 3D PROOF (best-effort) — when the buyer's vehicle differs from
 *      the design's original, RecreatePro (designpro-recreate-3d) projects the
 *      artboard onto the buyer's actual vehicle so the ProductionFlow proof
 *      shows THEIR truck. Non-fatal — the print files never depend on it.
 *   3. Hand the vault to activate-print-worker (Railway hi-res) keyed to the JOB
 *      id so the files stamp on this order and the Admin QC card appears.
 *
 * The stripe-webhook `listing_id` branch already queued the job (source artboard
 * + buyer vehicle + recreate flag). This runs on the buyer's post-purchase
 * return. Every step is non-fatal: if the tab closes or a step fails, the queued
 * job still sits in the Admin QC board for the design team to finish, and nothing
 * ships to the customer without the downstream human QC stamp.
 */

interface AutoBuildResult {
  status: "built" | "queued" | "no_source" | "no_job" | "error";
  jobId?: string;
  built?: number;
  reason?: string;
}

async function findOrderJob(listingId: string, buyerUserId: string): Promise<any | null> {
  // Poll up to ~18s (the webhook is async). Newest creatormarket job for this
  // buyer + listing.
  for (let attempt = 0; attempt < 9; attempt++) {
    const { data } = await (supabase as any)
      .from("panelizer_jobs")
      .select("id, generation_id, vehicle_year, vehicle_make, vehicle_model, concept_json")
      .eq("user_id", buyerUserId)
      .eq("concept_json->>source", "creatormarket")
      .eq("concept_json->>listing_id", listingId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

export async function creatorMarketAutoBuild(listingId: string): Promise<AutoBuildResult> {
  try {
    const { data: authData } = await supabase.auth.getUser();
    const buyerUserId = authData?.user?.id || null;
    if (!buyerUserId) return { status: "error", reason: "not authenticated" };

    const job = await findOrderJob(listingId, buyerUserId);
    if (!job) return { status: "no_job" };

    const concept = (job.concept_json || {}) as Record<string, any>;
    const artboardUrl: string | null = concept.source_artboard_url || null;
    const artboardCleanUrl: string | null = concept.source_artboard_clean_url || null;
    const proofUrl: string | null = concept.flat_proof_url || null;
    const recreateNeeded: boolean = concept.recreate_needed !== false; // default true
    const make = job.vehicle_make || "";
    const model = job.vehicle_model || "";
    const year = String(job.vehicle_year || "");
    const finish: string | undefined = concept.finish || undefined;
    const allViewUrls: Record<string, string> = (concept.render_urls && typeof concept.render_urls === "object")
      ? (concept.render_urls as Record<string, string>)
      : {};

    // No flat design source at all → honest gap. The queued job stays in the
    // Admin QC board for the team to resolve (regenerate the design's artboard).
    if (!artboardUrl && !proofUrl) return { status: "no_source", jobId: job.id };

    // ── CUSTOMER 3D PROOF (best-effort) — recreate the design on the BUYER's
    // actual vehicle so ProductionFlow shows their truck. Files never depend on
    // this; a failure just leaves the design's original render set on the job.
    if (recreateNeeded && artboardUrl) {
      try {
        const { data: r3d } = await supabase.functions.invoke("designpro-recreate-3d", {
          body: {
            artboardUrl,
            designDescription: concept.business_name || job.vehicle_make || "wrap design",
            vehicleYear: year,
            vehicleMake: make,
            vehicleModel: model,
            finish: finish || "Gloss",
          },
        });
        const recreatedViews = (r3d as any)?.renderUrls;
        if (recreatedViews && typeof recreatedViews === "object" && Object.keys(recreatedViews).length) {
          // Surface the buyer-vehicle views on the job (ProductionFlow reads these).
          await (supabase as any)
            .from("panelizer_jobs")
            .update({
              all_view_urls: recreatedViews,
              concept_json: { ...concept, render_urls: recreatedViews, recreated_on_buyer_vehicle: true },
            })
            .eq("id", job.id);
        }
      } catch { /* non-fatal — the deterministic panels below are the deliverable */ }
    }

    // ── PANELS (the deliverable) — slice the flat master artboard at the buyer's
    // GENIE dims, keyed to THIS order's job id (per-order vault isolation). ──
    let built = 0;
    let reason: string | undefined;
    if (artboardUrl) {
      const r = await buildProductionPanels({
        gid: job.id,
        make,
        model,
        year,
        allViewUrls,
        masterArtboardUrl: artboardUrl,
        masterArtboardCleanUrl: artboardCleanUrl,
        artboardBrandedUrl: artboardUrl,
        artboardCleanUrl,
        finish,
      });
      built = r.built;
      reason = r.reason;
    }

    // Fallback: no flat artboard but we do have the design's 2D proof — build
    // from it (sized to the buyer's dims) rather than leave the order unbuilt.
    if (built <= 0 && proofUrl) {
      const r = await enticePanelsFromProof({
        gid: job.id,
        proofUrl,
        make,
        model,
        year,
        allViewUrls,
        artboardCleanUrl,
        triggerWorker: false,
      });
      built = r.built;
      reason = r.reason;
    }

    if (built <= 0) return { status: "queued", jobId: job.id, reason };

    // Hand the just-built per-order vault to the Railway worker keyed to the JOB
    // id so hi-res files stamp on this order and the Admin QC card appears.
    try {
      await supabase.functions.invoke("activate-print-worker", {
        body: {
          jobId: job.id,
          generationId: job.id,
          userId: buyerUserId,
          orderNumber: concept.order_number || undefined,
        },
      });
    } catch { /* non-fatal — vault is built; the board can kick the worker */ }

    return { status: "built", jobId: job.id, built };
  } catch (err: any) {
    return { status: "error", reason: err?.message || String(err) };
  }
}
