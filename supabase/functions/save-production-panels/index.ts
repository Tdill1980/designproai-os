/**
 * save-production-panels
 *
 * Persists the per-side flat panels produced by the Build Files flow
 * (DesignAssetsPanel.buildAssets) into production_flow_assets so they survive a
 * reload and show in the Golden Assets / production grid.
 *
 * The browser cannot write this table (RLS is on with no INSERT policy). This
 * edge function accepts the authenticated design owner (or an admin/tester) and
 * internal service callers, then performs the write with the service role.
 *
 * Body: { jobId, version?, panels: [{ side, cleanUrl, brandedUrl, dpi?, pixelWidth?, pixelHeight?, widthIn?, heightIn? }] }
 *  - background_url    := cleanUrl   (clean-background flat panel)
 *  - branding_url      := brandedUrl (with-graphics flat panel; falls back to clean)
 *  - dimensions_inches := { w, h, dpi, px, py } — TRUE per-panel print resolution
 *    the deterministic slicer baked (so QC shows real DPI, not a hardcoded fallback)
 *  - depth_mask_url / final_pack_url := "" (produced later in the pack step; the
 *    UI guards on truthiness so empty strings simply don't render a tile)
 *
 * Re-running the build replaces panels PER SIDE: existing rows for
 * (jobId, version, side ∈ payload) are deleted first so panels never pile up
 * as duplicates. Sides NOT in the payload are left untouched — a partial
 * re-save (e.g. rebuilding just the hood) must never wipe the other sides'
 * good panels (it used to delete ALL rows for the job+version first).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const configuredWorkerSecret = Deno.env.get("WORKER_SECRET") || "";
    const db = createClient(supabaseUrl, serviceKey);
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const workerSecret = String(req.headers.get("x-worker-secret") || "").trim();
    const isService =
      (!!bearer && bearer === serviceKey) ||
      (!!configuredWorkerSecret && workerSecret === configuredWorkerSecret);
    let callerUserId: string | null = null;
    if (!isService) {
      if (!bearer) {
        return new Response(JSON.stringify({ success: false, error: "Authentication required" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: authData, error: authError } = await db.auth.getUser(bearer);
      callerUserId = authData?.user?.id || null;
      if (authError || !callerUserId) {
        return new Response(JSON.stringify({ success: false, error: "Invalid authentication" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const {
      jobId,
      version,
      panels,
      expectedSides,
      sourceHash,
      sourceContractHash,
      sourceProofUrl,
      logoPack,
      revisionId,
      enticePackId,
      designiqGenerationId,
      dimensionManifestId,
      manifestHash,
      stageId,
      leaseToken,
      activate = true,
    } = await req.json();
    if (!jobId) return new Response(JSON.stringify({ success: false, error: "Missing jobId" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!Array.isArray(panels) || !panels.length) return new Response(JSON.stringify({ success: false, error: "No panels" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const required: string[] = Array.isArray(expectedSides)
      ? Array.from(new Set(expectedSides.map((s: unknown) => String(s).trim().toUpperCase()).filter(Boolean)))
      : [];
    const normalizedSourceHash = String(sourceHash || "").trim().toLowerCase();
    const normalizedSourceContractHash = String(
      sourceContractHash || sourceHash || "",
    ).trim().toLowerCase();
    const normalizedSourceProofUrl = String(sourceProofUrl || "").trim();
    if (
      !required.length ||
      !/^[a-f0-9]{64}$/.test(normalizedSourceHash) ||
      !normalizedSourceProofUrl
    ) {
      return new Response(JSON.stringify({
        success: false,
        error: "Atomic save requires expectedSides, sourceProofUrl, and a full SHA-256 sourceHash",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const revisionMode = [
      revisionId,
      enticePackId,
      designiqGenerationId,
      dimensionManifestId,
      manifestHash,
      sourceContractHash,
      activate === false,
    ].some(Boolean);
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (revisionMode) {
      const revisionIdentityValid =
        isService &&
        activate === false &&
        uuidPattern.test(String(revisionId || "")) &&
        uuidPattern.test(String(enticePackId || "")) &&
        uuidPattern.test(String(designiqGenerationId || "")) &&
        uuidPattern.test(String(dimensionManifestId || "")) &&
        uuidPattern.test(String(stageId || "")) &&
        uuidPattern.test(String(leaseToken || "")) &&
        /^[a-f0-9]{64}$/.test(String(manifestHash || "").toLowerCase()) &&
        /^[a-f0-9]{64}$/.test(normalizedSourceContractHash);
      if (!revisionIdentityValid) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              "Revision staging requires service authentication and the complete immutable pack identity",
          }),
          {
            status: isService ? 400 : 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }
    const supplied = panels.map((p: any) => String(p?.side || "").toUpperCase()).filter(Boolean);
    const uniqueSupplied = Array.from(new Set(supplied));
    const missing = required.filter((side) => !uniqueSupplied.includes(side));
    const unexpected = uniqueSupplied.filter((side) => !required.includes(side));
    if (
      missing.length ||
      unexpected.length ||
      uniqueSupplied.length !== required.length ||
      supplied.length !== required.length
    ) {
      return new Response(JSON.stringify({
        success: false, error: "Incomplete atomic panel pack", missing, unexpected,
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // A side may arrive with an explicit, reasoned separation gap: the anti-smear
    // erase gate refused this design's branding, so there is no clean/blank panel
    // and no Logo Pack for it. The branded layer is the deliverable and is still
    // required; the clean layer is the value-add and is honestly absent. It is
    // never backfilled with the branded URL — that substitution is exactly what
    // the Call 7 contract forbids — and `production_eligible` below stays false
    // for the side, so nothing paid can consume it.
    const reasonedSeparationGap = (p: any) =>
      p?.separationQc?.known === true &&
      p?.separationQc?.pass === false &&
      String(p?.separationQc?.reason || "").trim().length > 0;
    const missingLayers = panels
      .filter((p: any) => !p?.brandedUrl || (!p?.cleanUrl && !reasonedSeparationGap(p)))
      .map((p: any) => String(p?.side || ""));
    if (missingLayers.length) {
      return new Response(JSON.stringify({
        success: false, error: "Every side requires separate clean and branded layers", missingLayers,
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const missingDimensions = panels
      .filter((p: any) => !(Number(p?.widthIn) > 0) || !(Number(p?.heightIn) > 0))
      .map((p: any) => String(p?.side || ""));
    if (missingDimensions.length) {
      return new Response(JSON.stringify({
        success: false,
        error: "Every side requires positive GENIE dimensions",
        missingDimensions,
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (version && String(version) !== "v2") {
      return new Response(JSON.stringify({ success: false, error: "Only atomic v2 panel packs are accepted" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ver = `v2:${normalizedSourceHash.slice(0, 24)}`;
    // KEY TO THE CANONICAL DesignIQ id. PanelPro Studio / panel-pro-extract and
    // ProductionFlowLayersCard resolve panels by the design's canonical generation
    // id. If a caller passes a color_visualizations RENDER id (RecreatePro jobs
    // carry a different id per version), resolve its linked designiq_generation_id
    // and key the panels to THAT — so every side lands under ONE id and the whole
    // set is findable. Without this, panels scattered across version ids left
    // PanelPro Studio showing only some/none.
    let canonicalJobId = String(jobId);
    try {
      const { data: viz } = await db.from("color_visualizations").select("admin_notes").eq("id", jobId).maybeSingle();
      if (viz) {
        let n: any = {};
        try { n = typeof (viz as any).admin_notes === "string" ? JSON.parse((viz as any).admin_notes) : ((viz as any).admin_notes || {}); } catch { n = {}; }
        if (n?.designiq_generation_id) canonicalJobId = String(n.designiq_generation_id);
      }
    } catch { /* not a CV row / not linked — key to jobId as passed */ }

    if (revisionMode) {
      const { data: pack, error: packError } = await db
        .from("designpro_entice_packs")
        .select(
          "id,revision_id,designiq_generation_id,dimension_manifest_id,manifest_hash,source_contract_hash,status",
        )
        .eq("id", String(enticePackId))
        .maybeSingle();
      const packMatches =
        !packError &&
        !!pack &&
        String(pack.revision_id) === String(revisionId) &&
        String(pack.designiq_generation_id) === String(designiqGenerationId) &&
        String(pack.dimension_manifest_id) === String(dimensionManifestId) &&
        ["building", "verified"].includes(String(pack.status || "")) &&
        (!pack.manifest_hash ||
          String(pack.manifest_hash) === String(manifestHash).toLowerCase()) &&
        (!pack.source_contract_hash ||
          String(pack.source_contract_hash) === normalizedSourceContractHash);
      if (!packMatches) {
        return new Response(
          JSON.stringify({
            success: false,
            error: packError?.message || "Revision pack identity does not match",
          }),
          {
            status: packError ? 503 : 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      canonicalJobId = String(designiqGenerationId);
      if (
        String(jobId) !== canonicalJobId &&
        String(jobId) !== String(enticePackId)
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "jobId does not match the revision pack design identity",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // This endpoint writes with the service role, so RLS cannot protect a design
    // from a forged browser request. Require the caller to own the canonical
    // DesignIQ generation, unless the caller is an admin/tester or the request is
    // an internal service-to-service invocation.
    if (!isService && callerUserId) {
      const [{ data: generation }, { data: privileged }] = await Promise.all([
        db.from("designiq_generations").select("user_id").eq("id", canonicalJobId).maybeSingle(),
        db.from("user_roles").select("role").eq("user_id", callerUserId)
          .in("role", ["admin", "tester"]).limit(1).maybeSingle(),
      ]);
      if (!privileged && String((generation as any)?.user_id || "") !== callerUserId) {
        return new Response(JSON.stringify({ success: false, error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const rows = panels
      .filter((p: any) => p && p.side && (p.cleanUrl || p.brandedUrl))
      .map((p: any) => {
        // Persist the TRUE per-panel print resolution the deterministic slicer
        // baked this side at (effectiveDpi + pixel/inch dims from
        // panel-artboard-generator). Operators read this back in QC instead of a
        // hardcoded "150"/"300" fallback. Stored in the existing dimensions_inches
        // JSONB so no schema migration is needed. Omit absent values so older
        // callers (no dpi) keep writing {}.
        const dims: Record<string, number> = {};
        if (Number(p.widthIn) > 0) dims.w = Number(p.widthIn);
        if (Number(p.heightIn) > 0) dims.h = Number(p.heightIn);
        if (Number(p.dpi) > 0) dims.dpi = Math.round(Number(p.dpi));
        if (Number(p.pixelWidth) > 0) dims.px = Math.round(Number(p.pixelWidth));
        if (Number(p.pixelHeight) > 0) dims.py = Math.round(Number(p.pixelHeight));

        // BUILD-RUN PROVENANCE (roadmap #6) — stamp HOW this side was produced so
        // "is it deterministic?" is answerable with a query, not a guess. The
        // deterministic paths (artboard-slice / mirror) set deterministic:true; an
        // AI genie-fill fallback would set false. Only stamp what the caller sent.
        const meta: Record<string, unknown> = {};
        if (p.method) meta.method = String(p.method);
        if (typeof p.deterministic === "boolean") meta.deterministic = p.deterministic;
        // This is the server-enforced handoff contract used by
        // activate-print-worker. Absence is deliberately false for legacy rows.
        const separationPass = p.separationQc?.known === true && p.separationQc?.pass === true;
        meta.production_eligible = p.productionEligible === true && separationPass;
        meta.source_hash = normalizedSourceHash;
        if (revisionMode) {
          meta.source_contract_hash = normalizedSourceContractHash;
          meta.revision_id = String(revisionId);
          meta.entice_pack_id = String(enticePackId);
          meta.designiq_generation_id = String(designiqGenerationId);
          meta.dimension_manifest_id = String(dimensionManifestId);
          meta.manifest_hash = String(manifestHash).toLowerCase();
        }
        meta.source_proof_url = normalizedSourceProofUrl;
        meta.pack_version = ver;
        meta.expected_sides = required;
        if (Array.isArray(logoPack)) meta.logo_pack = logoPack;
        meta.branding_overlays = Array.isArray(p.overlayManifest) ? p.overlayManifest : [];
        if (p.separationQc && typeof p.separationQc === "object") {
          meta.separation_qc = {
            pass: (p.separationQc as any).pass === true,
            known: (p.separationQc as any).known === true,
            reason: String((p.separationQc as any).reason || ""),
          };
        }
        if (p.sourceArtboard) meta.source_artboard = String(p.sourceArtboard);
        if (Number(p.bleedIn) > 0) meta.bleed_in = Number(p.bleedIn);
        // Producer-ladder provenance (roadmap #6): which rung landed this
        // panel, what the qccheck judge said, and how long the ladder took.
        if (Number.isFinite(Number(p.rung)) && p.rung !== null && p.rung !== undefined && p.rung !== "") meta.rung = Number(p.rung);
        if (p.qc && typeof p.qc === "object") {
          meta.qc = {
            pass: (p.qc as any).pass === true,
            known: (p.qc as any).known === true,
            reason: String((p.qc as any).reason || ""),
          };
          // Call 7 sanity-gate provenance (mirrored-twin + edge-truncation
          // checks at authoring time). Recorded beside the reason string so a
          // verdict is legible per row exactly like separation_qc is.
          const sanity = (p.qc as any).call7Sanity || (p.qc as any).call7_sanity;
          if (sanity && typeof sanity === "object") {
            (meta.qc as Record<string, unknown>).call7_sanity = {
              known: sanity.known === true,
              pass: sanity.pass !== false,
              candidates: Number(sanity.candidates) || null,
              reason: String(sanity.reason || ""),
            };
          }
        }
        if (Number(p.builtMs) > 0) meta.built_ms = Math.round(Number(p.builtMs));
        if (Object.keys(meta).length) meta.stamped_at = new Date().toISOString();

        return {
          job_id: canonicalJobId,
          side: String(p.side).trim().toUpperCase(),
          version: ver,
          dimensions_inches: dims,
          // Empty on a reasoned separation gap — the column is NOT NULL, and ""
          // is the same "no such asset" sentinel depth_mask_url/final_pack_url
          // already use. Never the branded URL.
          background_url: p.cleanUrl || "",
          branding_url: p.brandedUrl,
          depth_mask_url: "",
          final_pack_url: "",
          meta_metrics: meta,
          ...(revisionMode
            ? {
                revision_id: String(revisionId),
                entice_pack_id: String(enticePackId),
                designiq_generation_id: String(designiqGenerationId),
                dimension_manifest_id: String(dimensionManifestId),
                manifest_hash: String(manifestHash).toLowerCase(),
                source_contract_hash: normalizedSourceContractHash,
                artifact_hash: /^[a-f0-9]{64}$/.test(
                  String(p.artifactHash || "").toLowerCase(),
                )
                  ? String(p.artifactHash).toLowerCase()
                  : null,
              }
            : {}),
        };
      });

    if (!rows.length) return new Response(JSON.stringify({ success: false, error: "No usable panels" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Idempotent retry: a complete pack with this source hash already exists.
    let existingQuery = db
      .from("production_flow_assets")
      .select(
        "id,side,background_url,branding_url,dimensions_inches,meta_metrics,revision_id,entice_pack_id,designiq_generation_id,dimension_manifest_id,manifest_hash,source_contract_hash,artifact_hash",
      )
      .eq("job_id", canonicalJobId);
    existingQuery = revisionMode
      ? existingQuery.eq("entice_pack_id", String(enticePackId))
      : existingQuery.eq("version", ver);
    const { data: existing, error: existingError } = await existingQuery;
    if (existingError) {
      return new Response(
        JSON.stringify({ success: false, error: existingError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const existingSides = new Set((existing || []).map((row: any) => String(row.side).toUpperCase()));
    const desiredBySide = new Map(rows.map((row: any) => [String(row.side).toUpperCase(), row]));
    const existingMatchesPayload = (existing || []).every((row: any) => {
      const side = String(row.side || "").toUpperCase();
      const desired: any = desiredBySide.get(side);
      const meta = row.meta_metrics || {};
      const dimensions = row.dimensions_inches || {};
      const desiredDimensions = desired?.dimensions_inches || {};
      const rowExpected = Array.isArray(meta.expected_sides)
        ? Array.from(new Set(meta.expected_sides.map((s: unknown) => String(s).trim().toUpperCase()).filter(Boolean)))
        : [];
      return (
        !!desired &&
        row.background_url === desired.background_url &&
        row.branding_url === desired.branding_url &&
        Number(dimensions.w) === Number(desiredDimensions.w) &&
        Number(dimensions.h) === Number(desiredDimensions.h) &&
        meta.source_hash === normalizedSourceHash &&
        meta.source_proof_url === normalizedSourceProofUrl &&
        meta.pack_version === ver &&
        rowExpected.length === required.length &&
        required.every((expectedSide) => rowExpected.includes(expectedSide)) &&
        meta.production_eligible === desired.meta_metrics.production_eligible &&
        meta.qc?.known === desired.meta_metrics.qc?.known &&
        meta.qc?.pass === desired.meta_metrics.qc?.pass &&
        meta.separation_qc?.known === desired.meta_metrics.separation_qc?.known &&
        meta.separation_qc?.pass === desired.meta_metrics.separation_qc?.pass &&
        (!revisionMode ||
          (String(row.revision_id) === String(revisionId) &&
            String(row.entice_pack_id) === String(enticePackId) &&
            String(row.designiq_generation_id) ===
              String(designiqGenerationId) &&
            String(row.dimension_manifest_id) ===
              String(dimensionManifestId) &&
            String(row.manifest_hash) === String(manifestHash).toLowerCase() &&
            String(row.source_contract_hash) ===
              normalizedSourceContractHash &&
            String(row.artifact_hash || "") ===
              String(desired.artifact_hash || "")))
      );
    });
    const idempotent = required.every((side) => existingSides.has(side)) &&
      existingSides.size === required.length &&
      (existing || []).length === required.length &&
      existingMatchesPayload;
    let savedRows: Array<{ id?: string; side: string }> = (existing || []) as Array<{ id?: string; side: string }>;
    const clearCandidateRows = async () => {
      let query = db
        .from("production_flow_assets")
        .delete()
        .eq("job_id", canonicalJobId);
      query = revisionMode
        ? query.eq("entice_pack_id", String(enticePackId))
        : query.eq("version", ver);
      return await query;
    };

    if (!idempotent) {
      if (revisionMode) {
        // The revision pack is replaced inside one fenced database transaction.
        // A lost-lease worker cannot delete/overwrite its successor's rows, and
        // an insert error rolls the delete back automatically.
        const { data: staged, error: stageError } = await db.rpc(
          "stage_designpro_entice_pack_assets",
          {
            p_stage_id: String(stageId),
            p_lease_token: String(leaseToken),
            p_pack_id: String(enticePackId),
            p_rows: rows,
            p_expected_sides: required,
          },
        );
        if (
          stageError ||
          staged?.staged !== true ||
          Number(staged?.saved || 0) !== required.length
        ) {
          return new Response(JSON.stringify({
            success: false,
            error:
              stageError?.message ||
              "Fenced atomic panel staging returned an incomplete pack",
          }), {
            status: stageError?.message?.includes("lease_lost") ? 409 : 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        savedRows = Array.isArray(staged?.sides)
          ? staged.sides.map((side: unknown) => ({ side: String(side) }))
          : [];
      } else {
        // Legacy v2 callers retain the prior versioned behavior until their
        // domain is migrated onto the revision-aware stage lease contract.
        const { error: clearError } = await clearCandidateRows();
        if (clearError) {
          return new Response(JSON.stringify({ success: false, error: clearError.message }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: inserted, error } = await db.from("production_flow_assets").insert(rows).select("id, side");
        if (error) return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

        if ((inserted?.length || 0) !== required.length) {
          await clearCandidateRows();
          return new Response(JSON.stringify({ success: false, error: "Atomic insert returned an incomplete pack" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        savedRows = inserted || [];
      }

      // The complete new version exists; only now retire every older version so
      // readers can never assemble a pack from mixed source hashes.
      if (!revisionMode) {
        const { error: retireError } = await db
          .from("production_flow_assets")
          .delete()
          .eq("job_id", canonicalJobId)
          .neq("version", ver)
          .is("entice_pack_id", null);
        if (retireError) {
          // Do not advertise or activate a new pack while an older source version is
          // still live. Remove the candidate and leave the previous complete version
          // available for recovery.
          await clearCandidateRows();
          return new Response(JSON.stringify({
            success: false, error: `Unable to retire the previous panel version: ${retireError.message}`,
          }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    // A paid order may have reached awaiting_build_assets (or a recoverable
    // activation failure) before this complete pack existed. Reset those jobs
    // only after the active pack commit, then enqueue a durable service-authenticated
    // resume through pg_net. A resume failure never invalidates the saved pack;
    // the job remains queued and can be retried without another payment.
    const generationIds = Array.from(new Set([String(jobId), canonicalJobId]));
    const { data: waitingJobs } = revisionMode
      ? { data: [] }
      : await db.from("designpro_production_jobs")
        .select("id,user_id,state,result")
        .in("generation_id", generationIds)
        .in("state", ["awaiting_build_assets", "failed"]);
    const resumedJobs: string[] = [];
    const resumeErrors: Array<{ id: string; error: string }> = [];
    for (const productionJob of (waitingJobs || [])) {
      const result = ((productionJob as any).result && typeof (productionJob as any).result === "object")
        ? (productionJob as any).result
        : {};
      const { error: resetError } = await db.from("designpro_production_jobs").update({
        state: "queued",
        stage: "asset_ready",
        blocked: [],
        last_error: null,
        result: {
          ...result,
          sourceHash: normalizedSourceHash,
          packVersion: ver,
          resumedFromState: (productionJob as any).state,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", (productionJob as any).id);
      if (resetError) {
        resumeErrors.push({ id: String((productionJob as any).id), error: resetError.message });
        continue;
      }
      const { error: kickError } = await db.rpc("kick_print_worker", {
        p_url: `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/run-production-flow`,
        p_secret: serviceKey,
        p_body: {
          mode: "designpro_job",
          action: "resume",
          productionJobId: (productionJob as any).id,
          userId: (productionJob as any).user_id,
        },
      });
      if (kickError) {
        resumeErrors.push({ id: String((productionJob as any).id), error: kickError.message });
      } else {
        resumedJobs.push(String((productionJob as any).id));
      }
    }

    console.log(`[save-production-panels] job ${jobId} -> canonical ${canonicalJobId} (${ver}): ${idempotent ? "reused" : "saved"} ${savedRows.length} atomic panels`);
    return new Response(JSON.stringify({
      success: true, saved: savedRows.length, sides: savedRows.map((r: any) => r.side),
      sourceHash: normalizedSourceHash,
      sourceContractHash: revisionMode ? normalizedSourceContractHash : undefined,
      version: ver,
      idempotent,
      revisionId: revisionMode ? String(revisionId) : undefined,
      enticePackId: revisionMode ? String(enticePackId) : undefined,
      dimensionManifestId: revisionMode ? String(dimensionManifestId) : undefined,
      resumedJobs,
      resumeErrors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[save-production-panels] Error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
