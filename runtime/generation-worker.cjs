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
const {
  ARTIFACT_AUDIT_CONTRACT,
  ATLAS_PANEL_AUTHORITY_CONTRACT,
  ATLAS_PHOTOGRAPHER_PROOF_CONTRACT,
  ATLAS_PROOF_EXECUTION,
  ATLAS_PROOF_STAGE,
  ATLAS_SERVER_PROVIDER_CONTRACT,
  createAtlasDesignPanelProvider,
  createDesignPanelServerProvider,
} = require("./designpanel-server-provider.cjs");
const { createDesignPanelEdgeProvider } = require("./designpanel-edge-provider.cjs");

/**
 * Calls 1-7 execute on this server.
 *
 * design-panel-ai-generate (the A.C.E. persona brief, view-angles, studio-os
 * lighting and the photorealism lock) and generate-color-render (the anchored
 * reproduction of the accepted View 1) are ported into
 * designpanel-server-provider.cjs and run in this process against the server
 * Gemini key pool. The Supabase Edge transport is retained only as an explicit,
 * operator-selected rollback: DESIGNPRO_STANDARD_TRANSPORT=edge. Anything else
 * -- unset, "server", a typo -- runs server-native, so the Edge path can never
 * become the default again by omission.
 */
function standardProviderFactoryFor(env = process.env) {
  return String(env.DESIGNPRO_STANDARD_TRANSPORT || "").trim().toLowerCase() === "edge"
    ? createDesignPanelEdgeProvider
    : createDesignPanelServerProvider;
}
const {
  ADVISORY_POLICY_CONTRACT: ATLAS_PROOF_ADVISORY_POLICY_CONTRACT,
  QC_CONTRACT: ATLAS_PROOF_QC_CONTRACT,
  VIEW_CONTRACTS: ATLAS_QC_VIEW_CONTRACTS,
  createAtlasProofValidator,
} = require("./atlas-proof-qc.cjs");
const { BUCKET, createGenerationStore } = require("./generation-store.cjs");
const { verifySourceBytes } = require("./runtime-contract.cjs");
const {
  STUDIO_CONTRACT_VERSION,
  STUDIO_ENVIRONMENT,
  STUDIO_REINFORCEMENT,
} = require("./studio-os.cjs");
const { PHOTOREALISM_CONTRACT_VERSION } = require("./photorealism-prompt.cjs");
const { DESIGNPANEL_ARTBOARD_PORT_VERSION } = require("./designiq-prompt.cjs");
const { MASTER_QC_CONTRACT } = require("./atlas-master-qc.cjs");
const {
  expectedSurfacesFromRow,
  resolveFlatAtlasPreviewDimensions,
} = require("./genie-universal-resolver.cjs");
const {
  atlasProjectionParts,
  atlasReceipt,
  flatFirstRequested,
  generateOrReuseFlatAtlas,
  MASTER_PROVIDER_CONTRACT,
  PROMPT_VERSION: ATLAS_PROMPT_VERSION,
  atlasPanelForProofView,
  viewAuthorityFor,
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
  //
  // THE CUSTOMER'S RAW WORDS, NOT A FORM DUMP (2026-08-24).
  //
  // This passed designBrief(input) -- the key:value list this port exists to
  // have replaced. Its output lands inside the quotation marks of "THE CONCEPT
  // -- the heart of this design; build everything around it: Client's creative
  // direction: ..." , so the slot meant to carry what the customer actually
  // said was carrying a form:
  //
  //     "Bright modern dental wrap ... blues and whites
  //      Business: BrightSmiles
  //      Industry: Dental
  //      Colors: blue, white
  //      Vehicle: 2025 Ford Transit (cargo van)"
  //
  // Measured on that prompt: an 80-character brief inflated to 516, and every
  // injected line already stated elsewhere by buildDesignIQPrompt from its own
  // structured fields -- the business name appeared FOUR times in one prompt,
  // the industry, vehicle and palette twice each. The reference interpolates
  // the raw brief (design-panel-ai-generate/index.ts:480, `${prompt}`
  // destructured straight from params at :297), which is the same rule the
  // architecture states as "nothing between the customer's words and A.C.E. --
  // no brief rewriting, no template injection".
  //
  // Nothing is lost by dropping the composite: every field it injected is
  // emitted below from the explicit argument next to it. designBrief() stays
  // exported for callers that still want the summary form.
  const design = buildDesignIQPrompt({
    prompt: String(input?.brief || input?.designBrief || input?.description || "").trim()
      || designBrief(input),
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
/**
 * The real size of the surface this camera is looking at.
 *
 * Call 1 already resolved every side's dimensions and cut the six panels to
 * them, so the renderer does not have to infer how long a driver side is next to
 * a hood -- it is told. Without this each 3D side is drawn at whatever
 * proportion the model assumes, and the proof disagrees with the panel the
 * customer is about to buy.
 *
 * These are the design-time dimensions (calls-1-7-layout-only). GENIE replaces
 * them with the validated production dimensions when the pack is ordered.
 */
function surfaceSizeClause(flatAtlas, sourceViewType) {
  const panel = callOnePanelFor(flatAtlas, sourceViewType);
  if (!panel) return "";
  const trimW = Number(panel.trimWidthIn);
  const trimH = Number(panel.trimHeightIn);
  if (!(trimW > 0) || !(trimH > 0)) return "";
  const sqft = Number(panel.surfaceSqFt);
  return `\n\nSURFACE SIZE (measured, not estimated): the ${panel.surfaceKey} surface is `
    + `${trimW}in wide by ${trimH}in tall`
    + (sqft > 0 ? ` (${sqft} sq ft)` : "")
    + `. Render this panel at that true proportion relative to the rest of the vehicle. `
    + `Do not stretch, squash, crop or re-fit the artwork to a different shape.`;
}

/** The Call-1 panel record for the surface a proof view is showing. */
function callOnePanelFor(flatAtlas, sourceViewType) {
  const surfaceKey = ATLAS_VIEW_ROLES[sourceViewType];
  const panels = flatAtlas?.callOnePanels;
  if (!surfaceKey || !Array.isArray(panels)) return null;
  return panels.find((panel) => panel?.surfaceKey === surfaceKey) || null;
}

function projectionOnlyPromptFor(input, sourceViewType, instruction = "", flatAtlas = null) {
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

Physically realistic printed vinyl; factory glass, lights, wheels and trim; no added props or graphics. Output one 16:9 vehicle proof only. Do not output an installer map, dieline, panel sheet, labels, dimensions or annotations.${surfaceSizeClause(flatAtlas, sourceViewType)}${correction}`,
  };
}

function conditionedPromptPartsFor(input, sourceViewType, instruction, flatAtlas) {
  return [
    ...atlasProjectionParts(flatAtlas, sourceViewType),
    projectionOnlyPromptFor(input, sourceViewType, instruction, flatAtlas),
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
        authorityMetadata: (() => {
          const viewAuthority = viewAuthorityFor(flatAtlas, sourceViewType);
          return {
            contract: flatAtlas.contract,
            revisionId: flatAtlas.revisionId,
            revisionSequence: flatAtlas.revisionSequence,
            masterContentHash: flatAtlas.master.contentHash,
            // What the proof was actually conditioned on: the canonical master
            // on a clean sheet, its deterministic cut-out repair otherwise --
            // the same bytes the six panels were cut from.
            surfaceSourceHash: flatAtlas.projection.sourceMasterHash,
            projectionContentHash: flatAtlas.projection.contentHash,
            projectionSourceMasterHash: flatAtlas.projection.sourceMasterHash,
            manifestContentHash: flatAtlas.manifestAsset.contentHash,
            topology: flatAtlas.manifest.topology,
            geometryAuthority: flatAtlas.manifest.geometryAuthority,
            zoneContract: viewAuthority.contract,
            zoneContentHash: viewAuthority.contentHash,
            zoneSurfaceKey: viewAuthority.surfaceKey,
          };
        })(),
      } : {}),
    };
  });
}

const ATLAS_VIEW_ROLES = Object.freeze({
  side: "driver",
  "passenger-side": "passenger",
  hood_detail: "hood",
  front: "front",
  rear: "rear",
  "close-up": "closeup",
  roof: "roof",
});

function atlasLineageError(reason) {
  return Object.assign(new Error(`A.T.L.A.S. proof lineage is invalid: ${reason}`), {
    code: "generation_atlas_lineage_invalid",
    retryable: false,
  });
}

/**
 * Refuse accepted rows from the retired generic renderer, anonymous storage
 * reconciliation, or a previous Driver revision. A.T.L.A.S. is resumable only
 * when every active proof proves the same immutable master and Driver anchor.
 */
function assertAtlasViewLineage({ views, flatAtlas, requireComplete = false }) {
  if (!Array.isArray(views)) throw atlasLineageError("active views are not an array");
  if (!flatAtlas?.master?.contentHash || !flatAtlas?.projection?.contentHash
    || !flatAtlas?.manifestAsset?.contentHash || !flatAtlas?.revisionId) {
    throw atlasLineageError("immutable flat-master identity is incomplete");
  }
  // THE RUNTIME TWIN OF THE SAME GATE, AND IT MUST READ THE SAME BASIS.
  //
  // This demanded `confidence >= 0.92` -- the SEMANTIC judge's certainty. Since
  // 2026-08-27 that judge no longer decides whether a master may exist: the
  // deterministic pixel gate does, and the judge's verdict is recorded and
  // flags. So a master the deterministic gate ACCEPTED, whose six panels were
  // already cut, died here whenever the judge happened to come back unsure.
  //
  // Live, canary 4efeda23 (2026-08-27 10:29): Call 1 finished in 91s with an
  // accepted master and ZERO proofs rendered, because this assertion fired
  // first -- `generation_atlas_lineage_invalid: flattened master did not pass
  // the current DesignPanel authoring/QC contract`.
  //
  // 20260827070000 fixed the identical predicate in the database an hour
  // earlier. Fixing one copy and not the other is the same divergence twice, so
  // both now accept either proof-of-gate: the recorded acceptance basis, or the
  // legacy numeric confidence for revisions authored before the basis existed.
  const masterAcceptance = flatAtlas.masterAcceptance || {};
  const gatedDeterministically = masterAcceptance.basis === "deterministic";
  const gatedBySemanticConfidence = Number.isFinite(masterAcceptance.confidence)
    && masterAcceptance.confidence >= 0.92;
  if (flatAtlas.promptVersion !== ATLAS_PROMPT_VERSION
    || masterAcceptance.passed !== true
    || masterAcceptance.contract !== MASTER_QC_CONTRACT
    || !(gatedDeterministically || gatedBySemanticConfidence)
    || !/^[0-9a-f]{64}$/.test(String(masterAcceptance.promptHash || ""))
    || masterAcceptance.providerContract !== MASTER_PROVIDER_CONTRACT
    || masterAcceptance.artboardPortVersion !== DESIGNPANEL_ARTBOARD_PORT_VERSION) {
    throw atlasLineageError("flattened master did not pass the current DesignPanel authoring/QC contract");
  }
  if (views.length > 7 || (requireComplete && views.length !== 7)) {
    throw atlasLineageError(`expected ${requireComplete ? "exactly" : "at most"} seven active proofs, found ${views.length}`);
  }

  const byView = new Map();
  for (const view of views) {
    const sourceViewType = String(view?.sourceViewType || "");
    const expectedRole = ATLAS_VIEW_ROLES[sourceViewType];
    if (!expectedRole) throw atlasLineageError(`unrecognized active view ${sourceViewType || "<empty>"}`);
    if (view.consumerRole !== expectedRole) {
      throw atlasLineageError(`${sourceViewType} has role ${view.consumerRole || "<empty>"}; expected ${expectedRole}`);
    }
    if (byView.has(sourceViewType)) throw atlasLineageError(`duplicate active view ${sourceViewType}`);
    if (!/^[0-9a-f]{64}$/.test(String(view.contentHash || ""))) {
      throw atlasLineageError(`${sourceViewType} has no immutable content hash`);
    }

    const metadata = view.metadata && typeof view.metadata === "object" ? view.metadata : {};
    const providerMetadata = metadata.provider && typeof metadata.provider === "object"
      ? metadata.provider : {};
    const validation = metadata.validation && typeof metadata.validation === "object"
      ? metadata.validation : {};
    const authority = metadata.authority && typeof metadata.authority === "object"
      ? metadata.authority : {};
    const viewAuthority = viewAuthorityFor(flatAtlas, sourceViewType);
    const panelAuthority = atlasPanelForProofView(flatAtlas, sourceViewType);
    // THE PRODUCER THIS ASSERTS MUST BE THE PRODUCER THAT RAN.
    //
    // These three blocks described the retired in-runtime projection: a
    // `generate-color-render` stage executing `server-native`, stamping its own
    // prompt hash and the studio/angle/photorealism contract versions, bound to
    // a fresh crop of the master. #232 replaced all of that with the deployed
    // photographer (RULE 0.29) and did not update the assert, so every
    // A.T.L.A.S. run was refused at lineage however good its proofs.
    //
    // It stayed invisible because Call 1 kept failing first. Generation
    // a14acec2-93e8-4d57-a6a2-40b88721b65a (2026-08-28) is what surfaced it:
    // an accepted master, six panels cut, all SEVEN proofs rendered and passing
    // their own visual QC at confidence 1 -- then refused here.
    //
    // The strings now come from the provider that writes them, so the two
    // cannot drift apart again.
    if (metadata.providerContract !== ATLAS_SERVER_PROVIDER_CONTRACT
      || providerMetadata.stage !== ATLAS_PROOF_STAGE
      || providerMetadata.execution !== ATLAS_PROOF_EXECUTION
      || providerMetadata.anchoredToFlatAtlas !== true
      || providerMetadata.atlasConditioningVerified !== true) {
      throw atlasLineageError(`${sourceViewType} was not produced by the pinned photographer stage`);
    }
    // The photographer's own provenance, in place of the retired runtime
    // producer's prompt audit. Every field is stamped by the edge function and
    // carried through by the provider, and each one answers a question the old
    // audit answered about the old producer: WHICH function, at WHICH pinned
    // commit, through WHICH provider and model, in exactly ONE image request.
    if (providerMetadata.proofProducer !== ATLAS_PROOF_STAGE
      || providerMetadata.proofContract !== ATLAS_PHOTOGRAPHER_PROOF_CONTRACT
      || !/^[0-9a-f]{40}$/.test(String(providerMetadata.proofSourceCommit || ""))
      || !/^[0-9a-f-]{36}$/.test(String(providerMetadata.proofRequestId || ""))
      || providerMetadata.proofProvider !== "google"
      || !String(providerMetadata.proofModel || "").trim()
      || Number(providerMetadata.proofImageRequestCount) !== 1) {
      throw atlasLineageError(`${sourceViewType} is missing the photographer's provenance audit`);
    }
    // VISUAL REVIEW IS ADVISORY; IDENTITY IS NOT. Historical accepted proofs
    // predate the explicit policy receipt and remain readable only when their
    // semantic confidence met the old blocking threshold. New proofs carry the
    // advisory policy plus an explicit disposition. Both shapes still have to
    // bind these exact bytes to this exact Atlas projection and surface.
    const legacySemanticPass = validation.policyContract === undefined
      && Number.isFinite(validation.confidence)
      && validation.confidence >= 0.9;
    const advisoryReceipt = validation.policyContract === ATLAS_PROOF_ADVISORY_POLICY_CONTRACT
      && ["pass", "review_required", "unavailable"].includes(validation.semanticDisposition);
    if (validation.contract !== ATLAS_PROOF_QC_CONTRACT
      || validation.expectedView !== ATLAS_QC_VIEW_CONTRACTS[sourceViewType]?.label
      || validation.proofHash !== view.contentHash
      || validation.atlasHash !== flatAtlas.projection.contentHash
      || validation.zoneHash !== viewAuthority.contentHash
      || validation.authorityHash !== viewAuthority.contentHash
      || validation.zoneSurfaceKey !== viewAuthority.surfaceKey
      || (!legacySemanticPass && !advisoryReceipt)) {
      throw atlasLineageError(`${sourceViewType} has no valid bound Atlas proof receipt`);
    }
    if (providerMetadata.atlasMasterContentHash !== flatAtlas.master.contentHash
      || providerMetadata.atlasProjectionContentHash !== flatAtlas.projection.contentHash
      || providerMetadata.atlasManifestContentHash !== flatAtlas.manifestAsset.contentHash
      || providerMetadata.atlasRevisionId !== flatAtlas.revisionId
      || Number(providerMetadata.atlasRevisionSequence) !== Number(flatAtlas.revisionSequence)
      // THE ARTWORK BINDING IS THE PANEL, NOT A CROP OF THE MASTER.
      //
      // RULE 0.28 §6: a proof hash-binds to the persisted Call-1 panel that
      // Call 9 later verifies/promotes unchanged, rather than to a fresh crop.
      // That is what the photographer is handed and what it verifies before it
      // renders; this assert follows it to the same artifact.
      || providerMetadata.atlasZoneContract !== ATLAS_PANEL_AUTHORITY_CONTRACT
      || providerMetadata.atlasZoneContentHash !== panelAuthority.contentHash
      || providerMetadata.atlasZoneSurfaceKey !== panelAuthority.surfaceKey
      || providerMetadata.sourcePanelHash !== panelAuthority.contentHash) {
      throw atlasLineageError(`${sourceViewType} points at a different Atlas revision`);
    }
    if (authority.contract !== flatAtlas.contract
      || authority.masterContentHash !== flatAtlas.master.contentHash
      || authority.projectionContentHash !== flatAtlas.projection.contentHash
      || authority.projectionSourceMasterHash !== flatAtlas.projection.sourceMasterHash
      || authority.manifestContentHash !== flatAtlas.manifestAsset.contentHash
      || authority.revisionId !== flatAtlas.revisionId
      || Number(authority.revisionSequence) !== Number(flatAtlas.revisionSequence)
      || authority.zoneContract !== viewAuthority.contract
      || authority.zoneContentHash !== viewAuthority.contentHash
      || authority.zoneSurfaceKey !== viewAuthority.surfaceKey) {
      throw atlasLineageError(`${sourceViewType} authority metadata does not match the flat master`);
    }
    byView.set(sourceViewType, view);
  }

  // SIX SIBLING SURFACES — THE WORKER ASSERT MATCHES THE DATABASE FENCE.
  //
  // This block used to demand the retired shape: every non-Driver view
  // anchored to Driver's content hash, Passenger carrying the mirror keys.
  // The owner-approved sibling change (8576619a) INVERTED those requirements
  // in designpro_private.flat_first_atlas_view_set_valid -- a view carrying
  // any of the four retired keys is REFUSED -- but this assert kept the old
  // demands, so the two gates contradicted each other and a complete
  // seven-view set could satisfy neither: the fence refused what this
  // required, and this required what the fence refused. No 7/7 run could
  // ever have completed; the contradiction stayed invisible only because
  // every run since the change failed earlier, at proof QC.
  //
  // Now every view, Driver included, must be projected directly from the flat
  // master, and the four retired-path keys are refused on all of them --
  // byte-for-byte the fence's own rule. The continuity-only Driver photograph
  // (atlasDriverContinuityOnly) is a different mechanism with its own name
  // and is not an anchor: artwork authority stays with the Atlas zone crop.
  //
  // A partial set without Driver is valid mid-flight: the seven slots launch
  // together, so a sibling can legitimately persist first and a crash-recovery
  // claim must not convict it. requireComplete still demands all seven below.
  for (const [sourceViewType, view] of byView) {
    const providerMetadata = view.metadata.provider;
    if (providerMetadata.anchoredToView1 !== false
      || providerMetadata.driverContentHash !== undefined
      || providerMetadata.deterministicMirror !== undefined
      || providerMetadata.passengerProducer !== undefined
      || providerMetadata.atlasZonePassedToPassengerRepair !== undefined) {
      throw atlasLineageError(`${sourceViewType} must be projected directly from the flat master`);
    }
  }

  if (requireComplete) {
    for (const sourceViewType of Object.keys(ATLAS_VIEW_ROLES)) {
      if (!byView.has(sourceViewType)) throw atlasLineageError(`missing ${sourceViewType}`);
    }
  }
  return true;
}

/**
 * A.T.L.A.S. proof photography has one legal execution order:
 *
 *   Driver -> persist/hash-verify Driver -> Passenger and five remaining views
 *
 * Driver is isolated and sequential because every later camera is anchored to
 * its accepted, hash-verified bytes. Once that anchor exists the remaining six
 * are independent of each other: each is a projection of the same frozen master
 * onto its own already-cut Call-1 panel, so running them one at a time only
 * multiplies the customer's wait by six. They now run together.
 *
 * Keeping the staging in one exported helper makes that ordering executable in
 * tests instead of relying on comments or prompt wording.
 */
async function runAtlasProofStages({
  runRequest = engine.runRequest,
  requestId,
  generationId,
  tenantKey,
  provider,
  store,
  slots,
}) {
  if (!provider?.generateImage || typeof provider.hydrateDriver !== "function") {
    throw new Error("A.T.L.A.S. requires the DesignPanel projection provider");
  }
  // A FULL SET STILL LEADS WITH DRIVER; A RETRY NEED NOT BE A FULL SET.
  //
  // This demanded exactly seven slots with Driver first, which was right while
  // Driver was staged alone and the rest depended on it. Now that the six
  // surfaces are siblings, a single failed surface can be re-run on its own --
  // it needs only the frozen master it was always conditioned on, and refusing
  // that would force a whole seven-view regeneration to recover one view.
  //
  // The full-set shape is still enforced, so the customer-facing run cannot
  // quietly start without Driver first and lose its priority.
  if (!Array.isArray(slots) || !slots.length) {
    throw new Error("A.T.L.A.S. requires at least one proof slot");
  }
  if (slots.length === 7 && slots[0]?.sourceViewType !== "side") {
    throw new Error("A.T.L.A.S. requires Driver first in a full seven-proof set");
  }
  if (slots.length > 7) {
    throw new Error("A.T.L.A.S. accepts at most seven proof slots");
  }

  // PRIORITY IS NOT PREREQUISITE.
  //
  // This used to render Driver alone, hash-verify it, and only then start the
  // other six -- and the provider additionally handed each of them a compacted
  // copy of the Driver render as a cross-view anchor, with Passenger built by
  // mirroring Driver's pixels outright. So one slow or failed Driver stalled or
  // killed the entire set, and Passenger inherited a defect no amount of
  // repair could fix (a6dd78aa, passengerMirrorMae 0.29343; fc2f2e80,
  // upside-down passenger lettering).
  //
  // The master is already frozen and hash-bound before this function is called.
  // Every view is conditioned on that same master and its own exact surface
  // region, and carries generationId, atlasRevisionId, masterContentHash and
  // surfaceKey -- identity that is hash-verified rather than inherited from a
  // sibling render. So the six surfaces are siblings and start together.
  //
  // Driver keeps its priority by being first in the slot array: Promise.all
  // dispatches in order, so Driver's provider call is issued first and it is
  // still what the customer sees first (RULE 0.23). It is simply no longer a
  // gate -- a failed Driver now leaves the other five free to complete, and
  // `waitForGeneration` still reveals each view the instant it lands.
  const proofs = await runRequest({
    requestId,
    generationId,
    tenantKey,
    provider,
    store,
    slots,
    parallel: true,
    // An orphan image has no persisted Atlas/provider lineage. It may have
    // been produced by the retired generic renderer, so Atlas must regenerate
    // it from the immutable master instead of adopting anonymous bytes.
    allowOrphanReconciliation: false,
    maxProviderAttempts: provider.maxProviderAttempts,
    // Semantic findings never enter this rejection budget: the Atlas validator
    // publishes them in an advisory receipt after deterministic preflight. The
    // bounded ceiling remains for an actually invalid proof transport (missing
    // or corrupt pixels, stale/hash-mismatched authority), which must never be
    // persisted merely because the presentation reviewer is non-blocking.
    maxRegenerations: provider.maxProviderAttempts,
  });
  return proofs;
}

/** Combine independently released proof nodes into the receipt shape the
 * existing completion path already consumes. Each node keeps its own slot
 * lease and retry budget; this only joins their finished receipts. */
function combineAtlasProofRuns(runs, viewPlan) {
  const orderedViews = (Array.isArray(viewPlan) ? viewPlan : [])
    .map((entry) => String(entry?.sourceViewType || ""));
  const results = runs.flatMap((run) => Array.isArray(run?.results) ? run.results : []);
  const byView = new Map(results.map((result) => [String(result?.sourceViewType || ""), result]));
  const orderedResults = orderedViews.map((sourceViewType) => byView.get(sourceViewType)).filter(Boolean);
  const failed = orderedResults.some((result) => result.state === "failed");
  const allAccepted = orderedResults.length === orderedViews.length
    && orderedResults.every((result) => result.state === "accepted");
  return {
    contract: engine.ENGINE_CONTRACT,
    state: failed ? "failed" : allAccepted ? "outputs_ready" : "pending",
    providerCalls: runs.reduce((total, run) => total + Number(run?.providerCalls || 0), 0),
    budget: runs.reduce((total, run) => total + Number(run?.budget || 0), 0),
    results: orderedResults,
    requiresExplicitResume: runs.some((run) => run?.requiresExplicitResume === true),
  };
}

function createGenerationWorker({
  supabase,
  workerId,
  provider,
  supabaseUrl = process.env.SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  standardProviderFactory = standardProviderFactoryFor(),
  atlasProviderFactory = createAtlasDesignPanelProvider,
  atlasProofValidatorFactory = createAtlasProofValidator,
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
        supabaseUrl,
        serviceRoleKey,
        tenantKey: claim.tenantKey,
        generationId: claim.generationId,
        requestId,
        input: claim.input,
      });
      const progressiveProofRuns = new Map();
      let progressiveAtlas = null;
      let driverSurfaceRelease = null;

      // Start one proof node from the progressive A.T.L.A.S. object. The task
      // is registered before it awaits panel/projection persistence, so the
      // callback returns immediately and panel extraction never waits on a 3D
      // render. A no-op rejection observer prevents an early provider failure
      // becoming an unhandled promise while Call 1 is still finishing; the
      // original task is awaited and reported below.
      const launchAtlasProof = ({ atlas, sourceViewType, prerequisites = [] }) => {
        if (progressiveProofRuns.has(sourceViewType)) return progressiveProofRuns.get(sourceViewType);
        const task = (async () => {
          await Promise.all(prerequisites.filter(Boolean));
          const atlasProvider = atlasProviderFactory({
            supabase,
            provider: imageProvider,
            tenantKey: claim.tenantKey,
            generationId: claim.generationId,
            requestId,
            input: executionInput,
            atlas: {
              conditioningPartsFor: (view) => atlasProjectionParts(atlas, view),
              conditioningIdentityFor: (view) => viewAuthorityFor(atlas, view),
              panelFor: (view) => atlasPanelForProofView(atlas, view),
              authorityMetadata: {
                masterContentHash: atlas.master.contentHash,
                surfaceSourceHash: atlas.projection.sourceMasterHash,
                projectionContentHash: atlas.projection.contentHash,
                manifestContentHash: atlas.manifestAsset.contentHash,
                revisionId: atlas.revisionId,
                revisionSequence: atlas.revisionSequence,
              },
            },
          });
          const validator = atlasProofValidatorFactory({
            provider: imageProvider,
            atlas,
            input: executionInput,
          });
          const plan = claim.viewPlan.filter((entry) => entry.sourceViewType === sourceViewType);
          const slots = slotsFrom(plan, executionInput, instructions, atlas, [])
            .map((slot) => ({ ...slot, validate: validator }));
          if (slots.length !== 1) {
            throw new Error(`A.T.L.A.S. progressive release could not resolve ${sourceViewType}`);
          }
          return runAtlasProofStages({
            runRequest: engine.runRequest,
            requestId,
            generationId: claim.generationId,
            tenantKey: claim.tenantKey,
            provider: atlasProvider,
            store,
            slots,
          });
        })();
        void task.catch(() => {});
        progressiveProofRuns.set(sourceViewType, task);
        return task;
      };

      if (isFlatFirst) {
        // The exact v3 contract + pipelineMode pair is the server-side feature
        // gate. v1/v2 never reach this branch, so the UI can roll back by
        // ceasing to issue v3 without requiring a deployment-wide env change.
        dimensionRow = await resolveFlatAtlasPreviewDimensions(
          supabase,
          claim.input?.vehicle,
          imageProvider,
        );
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
          // ONE MANIFEST IDENTITY, FROM THE SINGLE RESOLVER, ALL THE WAY DOWN.
          // The containers, the crops, the proof surface authority and both
          // UIs must all be able to name the same GENIE manifest -- so it
          // travels with the geometry rather than being re-derived per stage.
          geometryResolution: dimensionRow.geometryResolution,
          // THE PRODUCTION AUTHORING BUDGET. This call-site value is the real
          // switch: `resolveMaxAuthoringAttempts` reads `explicit ?? env`, so
          // DESIGNPRO_ATLAS_MAX_AUTHORING_ATTEMPTS cannot reach the customer
          // path while a number is passed here. Setting that env var alone
          // changes nothing.
          //
          // Owner ruling 2026-09-01, and the two halves are not in tension:
          //
          //   Normal path -- attempt 1 is accepted, the authoring loop breaks
          //   before a second request is ever built, and the run pays NOTHING
          //   extra. A.T.L.A.S. accepted <60s, Driver visible <90s, unchanged.
          //   This is why raising the budget cannot slow a healthy run down.
          //
          //   Refusal fallback -- a blocking Call-1 gate refused attempt 1, so
          //   the alternative is not a faster run, it is a failure page shown
          //   for one stochastic refusal. Exactly ONE more attempt is allowed,
          //   and that run is explicitly exempt from the normal SLA. If
          //   attempt 2 is also refused the customer sees the real failure;
          //   there is no third automatic attempt.
          //
          // The customer stays on the authoring copy throughout, because the
          // progress UI advances on an ACCEPTED master, never on an attempt.
          maxAuthoringAttempts: 2,
          onMasterReady: (atlas) => {
            progressiveAtlas = atlas;
          },
          onSurfaceReady: (release) => {
            const atlas = release?.atlas || progressiveAtlas;
            if (!atlas) throw new Error("A.T.L.A.S. surface released before its master");
            const node = {
              atlas,
              prerequisites: [release.projectionReady, release.panelPersisted],
            };
            if (release.surfaceKey === "driver") {
              driverSurfaceRelease = node;
              // Driver owns the first dispatch. Close-Up shares its panel but
              // is deliberately deferred until the next surface releases, so
              // it cannot compete with the customer-critical Driver request.
              launchAtlasProof({ ...node, sourceViewType: "side" });
              return;
            }
            if (driverSurfaceRelease && !progressiveProofRuns.has("close-up")) {
              launchAtlasProof({ ...driverSurfaceRelease, sourceViewType: "close-up" });
            }
            for (const [sourceViewType, surfaceKey] of Object.entries(ATLAS_VIEW_ROLES)) {
              if (surfaceKey === release.surfaceKey) {
                launchAtlasProof({ ...node, sourceViewType });
              }
            }
          },
          logger: (line) => console.log(`[DESIGNPRO-OS] flat-first ${requestId}: ${line}`),
        });
        // A resumed Atlas request may already contain accepted rows. Admit
        // them only when they prove this exact master/provider/Driver lineage;
        // old generic rows must never short-circuit the corrected pipeline.
        assertAtlasViewLineage({
          views: await viewsPayload(requestId),
          flatAtlas,
          requireComplete: false,
        });
      }

      // Standard DesignPanel generation is deliberately staged on this server:
      // design-panel-ai-generate creates View 1, then generate-color-render
      // receives that byte-verified accepted winner for Views 2-7. Reproductions
      // remain sequential so one frozen anchor yields one deterministic order.
      // A.T.L.A.S. is different: panel.ready(surface) releases each independent
      // photographer node while Call 1 is still persisting its later branches.
      const standardReferenceParts = isFlatFirst ? [] : await referenceImageParts(supabase, claim.input);
      const slots = slotsFrom(
        claim.viewPlan,
        executionInput,
        instructions,
        flatAtlas,
        standardReferenceParts,
      );
      let result;
      if (isFlatFirst) {
        // Reuse/resume paths do not emit progressive callbacks. Launch only the
        // nodes that were not already released, then join every independent
        // node in the canonical view order for the existing completion gate.
        for (const slot of slots) {
          if (!progressiveProofRuns.has(slot.sourceViewType)) {
            launchAtlasProof({ atlas: flatAtlas, sourceViewType: slot.sourceViewType });
          }
        }
        const runs = await Promise.all(claim.viewPlan.map((entry) => {
          const task = progressiveProofRuns.get(entry.sourceViewType);
          if (!task) throw new Error(`A.T.L.A.S. proof node ${entry.sourceViewType} was not released`);
          return task;
        }));
        result = combineAtlasProofRuns(runs, claim.viewPlan);
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

      // A REFUSED VIEW DOES NOT CANCEL THE OTHERS. (Trish 2026-08-27.)
      //
      // "A failed Hood 3D proof cannot prevent the Hood production panel from
      // existing. A failed Close-Up cannot cancel Driver/Passenger/Front/Rear/
      // Roof artifacts."
      //
      // The engine marks the whole request failed when ANY slot fails, which is
      // right for Standard and wrong for A.T.L.A.S.: its six panels were cut
      // from the accepted master inside Call 1, before a single proof was
      // dispatched, and the surviving proofs are each independently valid and
      // hash-bound to that same master. Live cost, 04cc0b29: five accepted
      // proofs and six good panels reported `failed` and painted red across the
      // library.
      //
      // So an A.T.L.A.S. run with at least one accepted view completes as a
      // PARTIAL set. It never pretends to be whole: the refusals are named on
      // the receipt, and `callsCompleted` now equals the views actually
      // delivered (the DB predicate was tightened to check exactly that), so a
      // short set cannot be recorded as a full one.
      const acceptedSlots = result.results.filter((item) => item.state === "accepted");
      const refusedSlots = result.results.filter((item) => item.state === "failed");
      const atlasPartial = isFlatFirst
        && result.state !== "outputs_ready"
        && acceptedSlots.length > 0;
      if (result.state !== "outputs_ready" && !atlasPartial) {
        const failed = refusedSlots;
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
      if (isFlatFirst) {
        // Every view present must still prove its lineage to this master; only
        // the completeness of the SET is relaxed, and only for a partial run.
        assertAtlasViewLineage({ views, flatAtlas, requireComplete: !atlasPartial });
      }
      if (atlasPartial
        ? (views.length !== acceptedSlots.length || views.length < 1 || views.length > 7)
        : views.length !== 7) {
        await rpc("fail_designpro_generation_request", {
          p_request_id: requestId, p_claim_token: claimToken,
          p_error_code: "generation_views_incomplete",
          p_error_message: atlasPartial
            ? `Expected ${acceptedSlots.length} persisted views for the accepted slots, found ${views.length}`
            : `Expected seven persisted views, found ${views.length}`,
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
            generationProducer: "design-panel-ai-generate",
            reproductionProducer: "generate-color-render",
            proofExecution: "panel-ready-driver-priority-parallel",
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
          // The number actually delivered, never a constant. The DB predicate
          // now matches this against jsonb_array_length(p_views), so an
          // overstatement is refused rather than recorded.
          callsCompleted: String(views.length),
          ...(atlasPartial
            ? {
                refusedViews: refusedSlots.map((item) => ({
                  sourceViewType: String(item.sourceViewType || ""),
                  reason: String(item.reason || "").slice(0, 240),
                })),
              }
            : {}),
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
        ...(atlasPartial
          ? {
              partial: true,
              acceptedViewCount: acceptedSlots.length,
              refusedViews: refusedSlots.map((item) => String(item.sourceViewType || "")),
            }
          : {}),
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
  assertAtlasViewLineage,
  createGenerationWorker,
  conditionedPromptPartsFor,
  designBrief,
  promptPartsFor,
  projectionOnlyPromptFor,
  surfaceSizeClause,
  referenceImageParts,
  runAtlasProofStages,
  slotsFrom,
  standardProviderFactoryFor,
};
