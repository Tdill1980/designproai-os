"use strict";

/**
 * Calls 1-7 request worker — the seam that was missing.
 *
 * generation-engine.cjs knows how to run one slot to a decision.
 * generation-store.cjs knows how to persist it. generation-provider.cjs knows
 * how to call Gemini. Nothing connected them to the request queue, so
 * /api/generation/requests recorded a request that no process ever executed and
 * the four modules were unreachable from index.js. This is that connection.
 *
 * The loop is deliberately narrow:
 *
 *   claim one request -> run its seven slots -> complete, or fail it
 *
 * It claims at most one request at a time per worker. Two runtimes therefore
 * process two requests, never the same one twice: claim_designpro_generation_request
 * takes a row lease, and each slot takes its own lease underneath it, so an
 * interrupted worker resumes the exact slot it lost rather than regenerating
 * accepted work.
 *
 * Nothing here retries on its own beyond the engine's literal ceiling. A failed
 * request is reported to the database and left alone.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");
const engine = require("./generation-engine.cjs");
const angles = require("./view-angles.cjs");
const { buildDesignIQPrompt } = require("./designiq-prompt.cjs");
const { createProvider } = require("./generation-provider.cjs");
const { createDesignPanelServerProvider } = require("./designpanel-server-provider.cjs");
const { BUCKET, createGenerationStore } = require("./generation-store.cjs");
const { verifySourceBytes } = require("./runtime-contract.cjs");
const { STUDIO_ENVIRONMENT, STUDIO_REINFORCEMENT } = require("./studio-os.cjs");
const { loadActiveFlatAtlasTopologyExamples } = require("./flat-atlas-topology-examples.cjs");
const {
  expectedSurfacesFromRow,
  resolveFlatAtlasPreviewDimensions,
} = require("./genie-universal-resolver.cjs");
const {
  atlasProjectionParts,
  atlasReceipt,
  flatFirstRequested,
  generateOrReuseFlatAtlas,
} = require("./flat-first-atlas.cjs");

const RECEIPT_CONTRACT = "designpro.calls-1-7-receipt.v1";
const REQUEST_LEASE_SECONDS = 900;
const HEARTBEAT_MS = 120_000;
const POLL_MS = 5_000;

/**
 * The design brief the customer typed, plus the vehicle it goes on.
 *
 * The gateway forbids the client from sending prompt, model, seed or camera
 * angle -- those are server-owned. So the brief is assembled here from the
 * descriptive fields the contract does allow, and the camera angle is appended
 * from the frozen view contract, never from the request.
 */
function designBrief(input) {
  const vehicle = input?.vehicle || {};
  const descriptor = [vehicle.year, vehicle.make, vehicle.model]
    .map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  const lines = [];

  const brief = String(input?.brief || input?.designBrief || input?.description || "").trim();
  if (brief) lines.push(brief);

  const business = String(input?.companyName || input?.businessName || input?.business || "").trim();
  if (business) lines.push(`Business: ${business}`);
  const industry = String(input?.industry || "").trim();
  if (industry) lines.push(`Industry: ${industry}`);

  const colors = Array.isArray(input?.colors)
    ? input.colors.map((value) => String(value || "").trim()).filter(Boolean)
    : String(input?.colors || "").trim() ? [String(input.colors).trim()] : [];
  if (colors.length) lines.push(`Colors: ${colors.join(", ")}`);

  const style = String(input?.style || "").trim();
  if (style) lines.push(`Style: ${style}`);

  if (!lines.length) lines.push("Professional commercial vehicle wrap design.");

  lines.push(`Vehicle: ${descriptor || "commercial vehicle"}${vehicle.type ? ` (${vehicle.type})` : ""}`);
  return lines.join("\n");
}

/**
 * Download customer-owned references once, then verify the exact bytes against
 * the content-addressed identity admitted by the gateway. Legacy Calls 1-7
 * share these parts across all seven prompts. A.T.L.A.S. loads the same
 * identities only while authoring its master; projections never receive them.
 */
async function referenceImageParts(supabase, input) {
  const assets = [];
  if (input?.logoAsset) assets.push({ label: "logo", asset: input.logoAsset });
  for (const image of Array.isArray(input?.visionBoardImages) ? input.visionBoardImages : []) {
    if (image) assets.push({ label: "visionboard", asset: image });
  }

  const parts = [];
  for (const { label, asset } of assets) {
    const storagePath = String(asset?.storagePath || "");
    const contentType = String(asset?.contentType || "").toLowerCase();
    if (!storagePath || !contentType) {
      throw Object.assign(new Error(`${label} reference identity is incomplete`), {
        code: "generation_reference_identity_invalid", retryable: false,
      });
    }
    const { data, error } = await supabase.storage.from(asset.bucket || BUCKET).download(storagePath);
    if (error || !data) {
      throw Object.assign(new Error(`${label} reference is unreadable at ${storagePath}: ${error?.message || "missing bytes"}`), {
        code: "generation_reference_download_failed", retryable: true,
      });
    }
    try {
      const sourceBytes = verifySourceBytes(asset, Buffer.from(await data.arrayBuffer()));
      // Gemini image inputs do not accept SVG. Preserve the verified vector in
      // Storage, but rasterize only the transient conditioning bytes to a
      // bounded PNG so one otherwise-valid logo cannot fail all seven views.
      const conditionedBytes = contentType === "image/svg+xml"
        ? await sharp(sourceBytes, { limitInputPixels: 40_000_000, density: 300 })
          .rotate()
          .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
          .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
          .toBuffer()
        : sourceBytes;
      parts.push({
        inlineData: {
          mimeType: contentType === "image/svg+xml" ? "image/png" : contentType,
          data: conditionedBytes.toString("base64"),
        },
      });
    } catch (cause) {
      throw Object.assign(new Error(`${label} reference failed verification: ${cause.message}`), {
        code: "generation_reference_hash_mismatch", retryable: false,
      });
    }
  }
  return parts;
}

/**
 * Prompt parts for one slot: the brief, the operator's regeneration instruction
 * if this slot is being redone, then the frozen camera angle.
 *
 * The instruction is what "generate this angle again, but bolder" becomes once
 * that capability is server-owned. regenerate_designpro_generation_slot stores
 * it on the slot; the browser never sends it, so the prompt stays server-owned
 * while the operator keeps the control.
 */
function promptPartsFor(input, sourceViewType, instruction = "", imageParts = []) {
  // Throws if the passenger angle ever loses its text-direction guard, which is
  // the defect this whole view contract exists to prevent.
  angles.assertTextDirectionGuard(sourceViewType);
  const note = String(instruction || "").trim();
  const revision = note ? `\n\nRevision requested for this view: ${note}` : "";
  const vehicle = input?.vehicle || {};
  // A.C.E. builds the design prompt now. designBrief() used to: a key:value
  // list plus a camera angle, with none of the creative stack the proven
  // product runs on. buildDesignIQPrompt reads the camera angle itself and
  // locks it first, so it is not appended again here.
  const design = buildDesignIQPrompt({
    prompt: designBrief(input),
    finish: input?.finish,
    substrate: input?.substrate,
    companyName: input?.companyName || input?.businessName || input?.business,
    mascot: input?.mascot,
    bulletPoints: Array.isArray(input?.bulletPoints) ? input.bulletPoints : [],
    industryType: input?.industry,
    phone: input?.phone,
    website: input?.website,
    brandColors: input?.brandColors
      || (Array.isArray(input?.colors) ? input.colors.join(", ") : input?.colors),
    fontStyle: input?.fontStyle,
    qrEnabled: input?.qrEnabled === true,
    qrUrl: input?.qrUrl,
    textLayerPrompt: input?.textLayerPrompt,
    logoAsset: input?.logoAsset,
    vehicleYear: vehicle.year,
    vehicleMake: vehicle.make,
    vehicleModel: vehicle.model,
    visionBoardImages: Array.isArray(input?.visionBoardImages) ? input.visionBoardImages : [],
    visionboardIntent: input?.visionboardIntent,
    styleDescriptors: input?.styleDescriptors,
    viewType: sourceViewType,
    mode: input?.mode,
  });
  return [{ text: `${design}${revision}` }, ...imageParts];
}

/**
 * The v3 proof contract. Every slot receives the same immutable atlas bytes and
 * manifest identity before its ordinary vehicle/camera prompt. Keeping this as
 * a named export also gives the later surgical-revision loop one safe entrance:
 * it can load a parent atlas revision and reuse this exact conditioning without
 * teaching another code path how the installer map is oriented.
 */
function projectionOnlyPromptFor(input, sourceViewType, instruction = "") {
  angles.assertTextDirectionGuard(sourceViewType);
  const vehicle = input?.vehicle || {};
  const target = [vehicle.year, vehicle.make, vehicle.model, vehicle.type]
    .map((value) => String(value || "").trim()).filter(Boolean).join(" ") || "the exact requested vehicle";
  const note = String(instruction || "").trim();
  const correction = note
    ? `\nVIEW-PROJECTION CORRECTION ONLY: ${note}\nApply this only to camera/projection fidelity. It is not permission to edit the atlas artwork.`
    : "";
  return {
    text: `Render one photorealistic customer proof of this exact target vehicle: ${target}.

CAMERA AND FRAMING ARE LOCKED:
${angles.cameraAngle(sourceViewType)}

The attached canonical flat atlas is the SOLE appearance authority. Project its exact surface zones onto the corresponding painted body panels of this vehicle. This is texture projection, not a new design pass. Never create, redraw, recompose, simplify, beautify, restyle, recolor, mirror, move, resize, correct, autocomplete or substitute any artwork, logo, photograph, pattern, gradient or text from the atlas. Preserve every visible customer string verbatim and forward-reading; never invent another string.

${STUDIO_ENVIRONMENT}

${STUDIO_REINFORCEMENT}

Physically realistic printed vinyl; factory glass, lights, wheels and trim; no added props or graphics. Output one 16:9 vehicle proof only. Do not output an installer map, dieline, panel sheet, labels, dimensions or annotations.${correction}`,
  };
}

function conditionedPromptPartsFor(input, sourceViewType, instruction, flatAtlas) {
  return [
    ...atlasProjectionParts(flatAtlas, sourceViewType),
    projectionOnlyPromptFor(input, sourceViewType, instruction),
  ];
}

const MIME_EXTENSION = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" });

/**
 * The revision this generation hands over to, derived from the request.
 *
 * Deterministic on purpose: a worker that copies four of seven objects and dies
 * resumes into the same revision and finishes, instead of stranding half a
 * revision and starting another.
 */
function handoffRevisionId(requestId) {
  const hash = createHash("sha256").update(`designpro.calls-1-7.handoff:${requestId}`).digest("hex");
  return [
    hash.slice(0, 8), hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    ((parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join("-");
}

/**
 * Copy the accepted views into the revision input paths Calls 8+ reads.
 *
 * The bytes are identical, so the content hash is unchanged and the destination
 * is exactly what validateAssetIdentity recomputes:
 *   users/<ownerId>/revisions/<revisionId>/inputs/<role>/<hash>.<ext>
 *
 * A copy rather than a move: the generation path stays as the immutable record
 * of what the engine produced, and re-running is idempotent.
 */
async function placeRevisionSources({ supabase, ownerId, revisionId, views }) {
  const placed = {};
  for (const view of views) {
    const extension = MIME_EXTENSION[view.contentType];
    if (!extension) throw new Error(`handoff_content_type_invalid: ${view.contentType}`);
    const destination = `users/${ownerId}/revisions/${revisionId}/inputs/${view.consumerRole}/${view.contentHash}.${extension}`;
    const { error } = await supabase.storage.from(BUCKET).copy(view.storagePath, destination);
    if (error && !/exists|duplicate|conflict/i.test(String(error.message))) {
      throw new Error(`handoff_copy_failed for ${view.consumerRole}: ${error.message}`);
    }
    placed[view.consumerRole] = {
      storagePath: destination, contentHash: view.contentHash,
      byteSize: view.byteSize, contentType: view.contentType,
    };
  }
  return placed;
}

function slotsFrom(viewPlan, input, instructions = {}, flatAtlas = null, imageParts = []) {
  const plan = Array.isArray(viewPlan) && viewPlan.length ? viewPlan : angles.viewOrder().map((sourceViewType) => ({ sourceViewType }));
  return plan.map((entry) => {
    const sourceViewType = entry.sourceViewType;
    return {
      sourceViewType,
      consumerRole: entry.consumerRole,
      promptParts: flatAtlas
        ? conditionedPromptPartsFor(input, sourceViewType, instructions[sourceViewType], flatAtlas)
        : promptPartsFor(input, sourceViewType, instructions[sourceViewType], imageParts),
      aspectRatio: angles.aspectRatio(sourceViewType),
      imageSize: angles.resolutionTier(sourceViewType),
      ...(flatAtlas ? {
        authorityMetadata: {
          contract: flatAtlas.contract,
          revisionId: flatAtlas.revisionId,
          revisionSequence: flatAtlas.revisionSequence,
          masterContentHash: flatAtlas.master.contentHash,
          projectionContentHash: flatAtlas.projection.contentHash,
          projectionSourceMasterHash: flatAtlas.projection.sourceMasterHash,
          manifestContentHash: flatAtlas.manifestAsset.contentHash,
          topology: flatAtlas.manifest.topology,
          geometryAuthority: flatAtlas.manifest.geometryAuthority,
        },
      } : {}),
    };
  });
}

function createGenerationWorker({
  supabase,
  workerId,
  provider,
  standardProviderFactory = createDesignPanelServerProvider,
  intervalMs = POLL_MS,
}) {
  if (!supabase) throw new Error("generation worker requires a Supabase client");
  const store = createGenerationStore({ supabase, workerId });
  // Constructed once so per-key health and cooldown persist across requests
  // rather than resetting on every claim.
  const imageProvider = provider || createProvider({});

  let timer = null;
  let busy = false;
  let stopped = false;

  async function rpc(name, args) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(`${name} failed: ${error.message}`);
    return data;
  }

  /** The seven persisted rows, in the exact shape completion validates. */
  async function viewsPayload(requestId) {
    const { data, error } = await supabase
      .from("designpro_generation_views")
      .select("source_view_type,consumer_role,storage_path,content_hash,byte_size,content_type,metadata")
      .eq("request_id", requestId).is("superseded_at", null);
    if (error) throw new Error(`generation view readback failed: ${error.message}`);
    return (data || []).map((row) => ({
      sourceViewType: row.source_view_type,
      consumerRole: row.consumer_role,
      storagePath: row.storage_path,
      contentHash: row.content_hash,
      byteSize: Number(row.byte_size),
      contentType: row.content_type,
      metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    }));
  }

  async function processClaim(claim) {
    const requestId = claim.requestId;
    const claimToken = claim.claimToken;
    let enteredFlatFirst = false;
    const heartbeat = setInterval(() => {
      void rpc("heartbeat_designpro_generation_request", {
        p_request_id: requestId, p_claim_token: claimToken, p_lease_seconds: REQUEST_LEASE_SECONDS,
      }).catch(() => {});
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    try {
      // Per-slot regeneration instructions the operator asked for. Read here so
      // a redone view carries its note and the untouched views do not.
      const { data: slotRows } = await supabase
        .from("designpro_generation_slots")
        .select("source_view_type,instruction")
        .eq("request_id", requestId);
      const instructions = Object.fromEntries(
        (slotRows || []).filter((row) => row.instruction).map((row) => [row.source_view_type, row.instruction]),
      );

      const isFlatFirst = flatFirstRequested(claim.input);
      enteredFlatFirst = isFlatFirst;
      let flatAtlas = null;
      let dimensionRow = null;
      let executionInput = claim.input;
      const ownerId = String(claim.tenantKey || "").replace(/^user_/, "");
      const standardProvider = isFlatFirst ? null : standardProviderFactory({
        supabase,
        provider: imageProvider,
        tenantKey: claim.tenantKey,
        generationId: claim.generationId,
        requestId,
        input: claim.input,
      });

      if (isFlatFirst) {
        // The exact v3 contract + pipelineMode pair is the server-side feature
        // gate. v1/v2 never reach this branch, so the UI can roll back by
        // ceasing to issue v3 without requiring a deployment-wide env change.
        let topologyExamples;
        [dimensionRow, topologyExamples] = await Promise.all([
          resolveFlatAtlasPreviewDimensions(supabase, claim.input?.vehicle, imageProvider),
          loadActiveFlatAtlasTopologyExamples(supabase),
        ]);
        if (dimensionRow.resolvedVehicleClass
          && dimensionRow.resolvedVehicleClass !== claim.input?.vehicle?.type) {
          executionInput = {
            ...claim.input,
            vehicle: { ...claim.input.vehicle, type: dimensionRow.resolvedVehicleClass },
          };
        }
        flatAtlas = await generateOrReuseFlatAtlas({
          supabase,
          store,
          provider: imageProvider,
          requestId,
          claimToken,
          generationId: claim.generationId,
          tenantKey: claim.tenantKey,
          ownerId,
          input: executionInput,
          surfaces: expectedSurfacesFromRow(dimensionRow),
          geometryAuthority: dimensionRow.proofGeometryAuthority,
          topologyExamples,
          logger: (line) => console.log(`[DESIGNPRO-OS] flat-first ${requestId}: ${line}`),
        });
      }

      // Standard DesignPanel generation is deliberately staged on this server:
      // design-panel-ai-generate creates View 1, then generate-color-render
      // receives that byte-verified accepted winner for Views 2-7. Reproductions
      // remain sequential so one frozen anchor yields one deterministic order.
      // A.T.L.A.S. remains its separate, explicitly requested experiment.
      const standardReferenceParts = isFlatFirst ? [] : await referenceImageParts(supabase, claim.input);
      const slots = slotsFrom(claim.viewPlan, executionInput, instructions, flatAtlas, standardReferenceParts);
      let result;
      if (isFlatFirst) {
        result = await engine.runRequest({
          requestId,
          generationId: claim.generationId,
          tenantKey: claim.tenantKey,
          provider: imageProvider,
          store,
          slots,
          parallel: true,
        });
      } else {
        await standardProvider.hydrateHero();
        const designer = await engine.runRequest({
          requestId,
          generationId: claim.generationId,
          tenantKey: claim.tenantKey,
          provider: standardProvider,
          store,
          slots: slots.slice(0, 1),
          parallel: false,
          maxProviderAttempts: standardProvider.maxProviderAttempts,
        });
        if (designer.state !== "outputs_ready") {
          result = designer;
        } else {
          await standardProvider.hydrateHero();
          const photographer = await engine.runRequest({
            requestId,
            generationId: claim.generationId,
            tenantKey: claim.tenantKey,
            provider: standardProvider,
            store,
            slots: slots.slice(1),
            parallel: false,
            maxProviderAttempts: standardProvider.maxProviderAttempts,
          });
          result = {
            ...photographer,
            providerCalls: designer.providerCalls + photographer.providerCalls,
            budget: designer.budget + photographer.budget,
            results: [...designer.results, ...photographer.results],
            requiresExplicitResume:
              designer.requiresExplicitResume || photographer.requiresExplicitResume,
          };
        }
      }

      if (result.state !== "outputs_ready") {
        const failed = result.results.filter((item) => item.state === "failed");
        const reasons = failed.map((item) => `${item.sourceViewType}:${item.reason}`).join(", ");
        // runRequest has already spent its complete bounded slot budget and
        // explicitly requires a human resume. Re-queueing the request here
        // used to claim it again (up to the SQL attempt ceiling), repeating the
        // same Gemini work while the UI sat at 96%. A failed run is terminal;
        // the operator may explicitly start/retry a view from the UI.
        const retryable = result.requiresExplicitResume !== true
          && !failed.some((item) => item.reason === "semantic_review_required");
        await rpc("fail_designpro_generation_request", {
          p_request_id: requestId, p_claim_token: claimToken,
          p_error_code: "generation_slots_failed",
          p_error_message: `Slots failed: ${reasons}`.slice(0, 1000),
          p_retryable: retryable,
        });
        return { requestId, state: "failed", reasons };
      }

      const views = await viewsPayload(requestId);
      if (views.length !== 7) {
        await rpc("fail_designpro_generation_request", {
          p_request_id: requestId, p_claim_token: claimToken,
          p_error_code: "generation_views_incomplete",
          p_error_message: `Expected seven persisted views, found ${views.length}`,
          // Seven successful provider outputs with an incomplete durable
          // readback is an integrity incident. Never pay to regenerate them
          // automatically; a human must inspect/resume.
          p_retryable: false,
        });
        return { requestId, state: "failed", reasons: "views_incomplete" };
      }

      const revisionId = handoffRevisionId(requestId);

      const authoringReceipt = isFlatFirst
        ? {
            flatAtlas: atlasReceipt(flatAtlas),
            vehicleClassResolution: dimensionRow.vehicleClassResolution,
          }
        : {
            generationProducer: "design-panel-ai-generate",
            reproductionProducer: "generate-color-render",
            productionHandoffDeferred: true,
          };

      const completion = await rpc("complete_designpro_generation_request", {
        p_request_id: requestId,
        p_claim_token: claimToken,
        p_views: views,
        p_engine_receipt: {
          contractVersion: RECEIPT_CONTRACT,
          sourceCommit: claim.engineContract?.sourceCommit,
          frozenContractHash: claim.engineContractHash,
          inputHash: claim.inputHash,
          byteVerified: "true",
          callsCompleted: "7",
          engineContract: engine.ENGINE_CONTRACT,
          providerCalls: result.providerCalls,
          handoffRevisionId: revisionId,
          // Carried on the receipt because the worker cannot write the revision
          // itself: save_designpro_revision_source requires an authenticated
          // JWT and refuses a service role. The owner freezes this exact object
          // into the snapshot; nothing here bypasses that.
          ...authoringReceipt,
        },
      });

      // Place the bytes where Calls 8+ expects them. The revision itself is
      // created by the authenticated owner, not here: save_designpro_revision_source
      // requires an 'authenticated' JWT and refuses a service role outright.
      if (completion?.handoffReady === true) {
        await placeRevisionSources({ supabase, ownerId, revisionId, views });
      }
      return {
        requestId,
        state: "outputs_ready",
        revisionId,
        completion,
        ...(isFlatFirst ? { flatAtlas: atlasReceipt(flatAtlas) } : {}),
      };
    } catch (error) {
      // The lease may already be gone; a failed fail-report must not mask the
      // original error.
      await rpc("fail_designpro_generation_request", {
        p_request_id: requestId, p_claim_token: claimToken,
        p_error_code: error.code || "generation_worker_failed",
        p_error_message: String(error.message || error).slice(0, 1000),
        // A.T.L.A.S. performs its one canonical-authoring call before the
        // bounded seven-view engine. Any error after entering flat-first is
        // terminal for this run so the request cannot be auto-claimed and burn
        // the provider pool again. Legacy errors retain their declared retry
        // contract; slot-budget failures above are terminal in both modes.
        p_retryable: enteredFlatFirst ? false : error?.retryable !== false,
      }).catch(() => {});
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function tick() {
    if (busy || stopped) return null;
    busy = true;
    try {
      const claim = await rpc("claim_designpro_generation_request", {
        p_worker_id: workerId, p_lease_seconds: REQUEST_LEASE_SECONDS,
      });
      if (!claim) return null;
      return await processClaim(claim);
    } catch (error) {
      console.error(`[DESIGNPRO-OS] generation worker: ${error.message}`);
      return null;
    } finally {
      busy = false;
    }
  }

  function start() {
    if (timer) return;
    stopped = false;
    timer = setInterval(() => void tick(), intervalMs);
    timer.unref?.();
    void tick();
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick, store, provider: imageProvider, contract: RECEIPT_CONTRACT };
}

module.exports = {
  HEARTBEAT_MS,
  POLL_MS,
  RECEIPT_CONTRACT,
  REQUEST_LEASE_SECONDS,
  createGenerationWorker,
  conditionedPromptPartsFor,
  designBrief,
  promptPartsFor,
  projectionOnlyPromptFor,
  referenceImageParts,
  slotsFrom,
};
