/**
 * RevisionStudio submits edit intent against one immutable ATLAS parent.
 * The server preserves the GenerationID, appends the existing revision history,
 * and owns the mapped panel/proof regeneration and production handoff.
 * Browser-edited images are references only, never canonical print artwork.
 */
import {
  dpApi, ROLE_FOR_SOURCE_VIEW_TYPE,
  type AssetIdentity, type FlatAtlasRevision, type GenerationRevisionReceipt,
  type GenieSurfaceKey,
} from "@/lib/designpro-api";
import { selectCustomerProof } from "@/lib/designpro-artifact-selectors";
import { artifactsForStudioRevision } from "@/lib/studio-artifact-identity.mjs";
import { composeRenderWithLayers, type PlacedLayer } from "@/lib/logo-composite";

/** What the page labels a build with. Kept verbatim so call sites are unchanged. */
export type DesignBuildTrigger =
  | "revision_saved"
  | "proof_requested"
  | "precise_edit"
  | "finish_fixed"
  | "missing_views_completed"
  | "passenger_mirrored"
  | "view_deleted"
  | "view_regenerated"
  | "design_generated"
  | "layer_edit"
  | "manual";

export type DesignBuildStatus = {
  workflowRun: { id: string; workflow_status: string } | null;
  proofUrl: string | null;
  activePack: { proof_artifact: { url: string } | null } | null;
};

/**
 * The durable workflow states the page's poll compares against.
 *
 * The page stops polling on completed/cancelled/failed and keeps polling
 * otherwise, so the run's state has to arrive under those exact words. This is
 * the whole translation, and it is deliberately total: every server state maps
 * to one of them rather than falling through to a default that would poll for
 * ever.
 */
function workflowStatusFor(state: string): string {
  if (state === "complete") return "completed";
  if (state === "failed") return "failed";
  // A run parked on a human action -- GENIE dimensions, preflight QC, final QC
  // -- is neither finished nor progressing on its own. It is reported as
  // running so the page keeps watching it, because the thing it is waiting for
  // is a person, and when that person acts the state moves without a new poll.
  return "running";
}

/**
 * One design's durable build state, for the 2D proof panel.
 *
 * The locator is whatever id the caller holds; here a design has one id, so
 * both the visualization and the run resolve to the same generation.
 */
export async function getDesignBuildStatus(locator: {
  visualizationId?: string | null;
  generationId?: string | null;
  runId?: string | null;
  atlasRevisionId?: string | null;
  revisionRequest?: GenerationRevisionReceipt | null;
}): Promise<DesignBuildStatus> {
  const id = String(
    locator.generationId || locator.visualizationId || locator.runId || "",
  ).trim();
  const empty: DesignBuildStatus = {
    workflowRun: null,
    proofUrl: null,
    activePack: null,
  };
  if (!id) return empty;
  const job = await dpApi.getStatus(id).catch(() => null);
  if (!job) return empty;
  const [artifacts, revisions, request] = await Promise.all([
    dpApi.listArtifacts(job.generationId), dpApi.listJobFlatAtlasRevisions(job.generationId),
    locator.revisionRequest ? dpApi.getGenerationRequest(locator.revisionRequest.requestId) : Promise.resolve(null),
  ]);
  if (request && (request.generationId !== job.generationId || request.requestId !== locator.revisionRequest?.requestId)) {
    throw new Error("The production proof status did not match this revision request.");
  }
  const current = locator.revisionRequest
    ? revisions.find((revision) => revision.generationId === job.generationId
      && revision.parentRevisionId === locator.revisionRequest!.parentAtlasRevisionId
      && revision.revisionSequence === locator.revisionRequest!.revisionSequence) || null
    : revisions.length ? revisionParent(revisions, job.generationId, locator.atlasRevisionId) : null;
  const proof = selectCustomerProof(current ? artifactsForStudioRevision(artifacts, current) : []);
  const proofUrl = proof?.signedUrl || null;
  return {
    workflowRun: {
      id: job.generationId,
      workflow_status: request?.revisionHandoffError ? "failed" : request?.state === "failed" || request?.state === "cancelled" ? request.state
        : job.state === "failed" ? "failed" : !proofUrl ? "running" : workflowStatusFor(job.state),
    },
    proofUrl: proofUrl,
    activePack: proofUrl ? { proof_artifact: { url: proofUrl } } : null,
  };
}

/**
 * Ask the server to make this design's pending and retryable work available.
 *
 * `idempotent` is reported true whenever the run is already past the point this
 * call would have started, so the page's "already being processed" message is
 * accurate rather than a guess.
 */
export async function requestDesignBuild(input: {
  visualizationId?: string | null;
  generationId?: string | null;
  expectedUpdatedAt?: string | null;
  trigger?: DesignBuildTrigger;
  change?: unknown;
}): Promise<{ idempotent: boolean }> {
  const id = String(input.generationId || input.visualizationId || "").trim();
  if (!id) throw new Error("no design is selected");
  const before = await dpApi.getStatus(id).catch(() => null);
  await dpApi.requestResume(id);
  return { idempotent: before?.state === "running" || before?.state === "complete" };
}

/** Same server action, from the page's retry button. */
export async function resumeDesignBuild(
  runId: string,
  _retryFailed = false,
): Promise<{ idempotent: boolean }> {
  const id = String(runId || "").trim();
  if (!id) throw new Error("no run to resume");
  await dpApi.requestResume(id);
  return { idempotent: false };
}

const EDIT_SURFACES = new Set(["driver", "passenger", "hood", "roof", "front", "rear"]);

/** Keep saved instructions, but never label the parent's artifacts as a pending child. */
export function pendingRevisionNotes(value: string | Record<string, unknown> | null | undefined): string {
  let notes: Record<string, unknown> = {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) notes = { ...parsed };
  } catch { /* A malformed legacy note cannot supply artifact identity. */ }
  for (const key of ["flat_proof_url", "logo_pack", "logo_layers", "ai_edit_summary"]) delete notes[key];
  return JSON.stringify(notes);
}

export function revisionSurfaces(viewKeys: readonly string[] = []): GenieSurfaceKey[] {
  return [...new Set(viewKeys.map((key) => ROLE_FOR_SOURCE_VIEW_TYPE[key] || key)
    .filter((key) => EDIT_SURFACES.has(key)))] as GenieSurfaceKey[];
}

/** A missing named parent must never silently become the newest version. */
export function revisionParent(
  revisions: readonly FlatAtlasRevision[], generationId: string, requestedId?: string | null,
): FlatAtlasRevision {
  const candidates = revisions.filter((revision) => revision.generationId === generationId);
  const parent = requestedId
    ? candidates.find((revision) => revision.id === requestedId)
    : [...candidates].sort((left, right) => right.revisionSequence - left.revisionSequence)[0];
  if (!parent || !/^[a-f0-9]{64}$/i.test(parent.master?.contentHash || "")) {
    throw new Error("The selected ATLAS version could not be verified. Reload its version history before revising.");
  }
  return parent;
}

/** Upload exact reference bytes through the existing authenticated asset registry. */
export async function prepareRevisionReferences(
  parentId: string, urls: readonly string[],
): Promise<Array<AssetIdentity & { purpose: "reference" }>> {
  const unique = [...new Set(urls.filter(Boolean))];
  if (unique.length > 8) throw new Error("Use at most eight reference images for one revision.");
  // Keep uploads bounded; one failed reference prevents submitting incomplete intent.
  const assets: Array<AssetIdentity & { purpose: "reference" }> = [];
  for (const [index, url] of unique.entries()) {
    const parsed = new URL(url, typeof location === "undefined" ? "https://designpro.invalid" : location.origin);
    if (!["https:", "blob:", "data:"].includes(parsed.protocol)) {
      throw new Error("This edit reference must be an uploaded image.");
    }
    const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("An edit reference could not be read. Re-upload it before submitting.");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 25 * 1024 * 1024) throw new Error("An edit reference exceeds 25 MiB.");
    const blob = await response.blob();
    if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type) || blob.size < 1 || blob.size > 25 * 1024 * 1024) {
      throw new Error("Edit references must be PNG, JPEG or WebP images up to 25 MiB.");
    }
    const asset = await dpApi.uploadRevisionAsset(parentId, "attachment", new File([blob], `revision-reference-${index + 1}`, { type: blob.type }));
    assets.push({ purpose: "reference", ...asset });
  }
  return assets;
}

/** Preserve the user's placed art as an edit reference, never as a print source. */
export async function layerRevisionReferenceFiles(edits: Array<{
  viewKey: string; backgroundUrl: string; layers: PlacedLayer[];
}>): Promise<File[]> {
  if (edits.length > 6 || new Set(edits.map((edit) => edit.viewKey)).size !== edits.length) {
    throw new Error("Use one edit reference per surface, up to six surfaces.");
  }
  const files: File[] = [];
  for (const edit of edits) {
    if (!edit.backgroundUrl || !edit.viewKey) throw new Error("A layer edit needs its saved background and view.");
    const blob = await composeRenderWithLayers(edit.backgroundUrl, edit.layers, { strict: true });
    if (blob.type !== "image/png" || !blob.size || blob.size > 25 * 1024 * 1024) throw new Error("The composed edit reference must be a PNG up to 25 MiB.");
    files.push(new File([blob], `layer-edit-${edit.viewKey}.png`, { type: "image/png" }));
  }
  return files;
}

export async function submitDesignRevision(input: {
  source: {
    id?: string | null; atlas_revision_id?: string | null;
    admin_notes?: string | null; finish_type?: string | null;
    vehicle_type?: string | null; color_name?: string | null; design_file_name?: string | null;
    vehicle_year?: string | null; vehicle_make?: string | null; vehicle_model?: string | null;
    _revisionRequest?: unknown;
  } | null;
  instruction: string;
  vehicle: { year: string; make: string; model: string };
  designName: string;
  parentAtlasRevisionId?: string | null;
  affectedSurfaces?: GenieSurfaceKey[];
  referenceUrls?: string[];
  referenceFiles?: File[];
  editAssets?: Array<AssetIdentity & { purpose: "reference" }>;
  panelOutputRunId?: string | null;
}): Promise<GenerationRevisionReceipt> {
  const generationId = String(input.source?.id || "").trim();
  const instruction = String(input.instruction || "").trim();
  if (!generationId) throw new Error("Open the saved design before revising it.");
  if (input.source?._revisionRequest && !input.source.atlas_revision_id && !input.parentAtlasRevisionId) {
    throw new Error("Wait for this version's artwork to be accepted, or select an existing version from history.");
  }
  if (!instruction) throw new Error("A revision needs a description of the change.");
  if (instruction.length > 4000) throw new Error("Keep this revision instruction within 4,000 characters.");
  for (const field of ["year", "make", "model"] as const) {
    const previous = String(input.source?.[`vehicle_${field}`] || "").trim();
    const next = String(input.vehicle[field] || "").trim();
    if (previous && next && previous.toLowerCase() !== next.toLowerCase()) {
      throw new Error("This revision keeps the verified vehicle. Open DesignPro to prepare a different vehicle.");
    }
  }
  const revisions = await dpApi.listJobFlatAtlasRevisions(generationId);
  const parent = revisionParent(revisions, generationId, input.parentAtlasRevisionId || input.source?.atlas_revision_id);
  if ((input.editAssets?.length || 0) + new Set(input.referenceUrls || []).size + (input.referenceFiles?.length || 0) > 8) {
    throw new Error("Use at most eight reference images for one revision.");
  }
  const editAssets = [...(input.editAssets || []), ...await prepareRevisionReferences(parent.id, input.referenceUrls || [])];
  for (const file of input.referenceFiles || []) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > 25 * 1024 * 1024) {
      throw new Error("Edit references must be PNG, JPEG or WebP images up to 25 MiB.");
    }
    editAssets.push({ purpose: "reference", ...await dpApi.uploadRevisionAsset(parent.id, "attachment", file) });
  }
  const receipt = await dpApi.createGenerationRevision({
    generationId,
    parentAtlasRevisionId: parent.id,
    parentMasterContentHash: parent.master.contentHash,
    instruction,
    ...(input.affectedSurfaces?.length ? { affectedSurfaces: revisionSurfaces(input.affectedSurfaces) } : {}),
    ...(editAssets.length ? { editAssets } : {}),
    ...(input.panelOutputRunId ? { panelOutputRunId: input.panelOutputRunId } : {}),
  });
  if (receipt.generationId !== generationId || receipt.parentAtlasRevisionId !== parent.id ||
      !receipt.requestId || !Number.isSafeInteger(receipt.revisionSequence) || receipt.revisionSequence <= parent.revisionSequence) {
    throw new Error("The server did not confirm this revision's existing design and parent version.");
  }
  return receipt;
}

/** Request-specific reads cannot relabel an earlier version's proofs as the new version. */
export async function readSubmittedRevision(receipt: GenerationRevisionReceipt) {
  const [request, views, revisions] = await Promise.all([
    dpApi.getGenerationRequest(receipt.requestId),
    dpApi.listGenerationViews(receipt.requestId),
    dpApi.listFlatAtlasRevisions(receipt.requestId),
  ]);
  if (request.requestId !== receipt.requestId || request.generationId !== receipt.generationId) {
    throw new Error("The revision status did not match the submitted request.");
  }
  const revision = revisions.find((candidate) => candidate.generationId === receipt.generationId &&
    candidate.revisionSequence === receipt.revisionSequence && candidate.parentRevisionId === receipt.parentAtlasRevisionId) || null;
  const renderUrls: Record<string, string> = {};
  const cameras = new Set<string>();
  if (revision) for (const view of views) {
    const role = ROLE_FOR_SOURCE_VIEW_TYPE[view.sourceViewType];
    if (!role || role !== view.consumerRole || !view.signedUrl || !/^[a-f0-9]{64}$/i.test(view.contentHash || "")) continue;
    if (cameras.has(view.sourceViewType)) throw new Error("The revision returned duplicate proof identities.");
    cameras.add(view.sourceViewType);
    renderUrls[view.sourceViewType] = view.signedUrl;
    renderUrls[role] = view.signedUrl;
  }
  return { request, revision, renderUrls, proofCount: cameras.size };
}

/** Existing precise-edit saves submit a reference to the same ATLAS edit flow. */
export async function readDesignAfterEdit(input: {
  render: { id?: string | null; atlas_revision_id?: string | null; render_urls?: Record<string, string> } | null;
  renderUrls?: Record<string, string>;
  trigger?: DesignBuildTrigger;
  change?: { type?: string; prompt?: string | null; viewKeys?: string[] };
  patch?: Record<string, unknown>;
  parentAtlasRevisionId?: string | null;
  panelOutputRunId?: string | null;
}): Promise<{
  render_urls: Record<string, string>; admin_notes: string | null; updated_at: string | null;
  revisionReceipt: GenerationRevisionReceipt;
}> {
  const id = String(input.render?.id || "").trim();
  if (!id) throw new Error("No saved design is selected");
  if (input.trigger === "view_deleted") throw new Error("The seven saved vehicle proofs remain in version history. Use a revision to change the artwork.");
  const keys = input.change?.viewKeys || [];
  const references = keys.map((key) => input.renderUrls?.[key]).filter((url, index): url is string =>
    Boolean(url && url !== input.render?.render_urls?.[keys[index]]));
  const instruction = input.change?.prompt?.trim() || (references.length
    ? `Apply the artwork changes shown in the supplied edit reference for ${keys.join(", ")}. Preserve the remaining design and regenerate its matching print panels and vehicle proofs.`
    : "");
  if (!instruction) throw new Error("Describe the artwork change or provide the edited reference before saving.");
  const revisionReceipt = await submitDesignRevision({
    source: input.render,
    instruction,
    vehicle: { year: "", make: "", model: "" },
    designName: "",
    parentAtlasRevisionId: input.parentAtlasRevisionId,
    affectedSurfaces: revisionSurfaces(keys),
    referenceUrls: references,
    panelOutputRunId: input.panelOutputRunId,
  });
  return { render_urls: {}, admin_notes: null, updated_at: null, revisionReceipt };
}
