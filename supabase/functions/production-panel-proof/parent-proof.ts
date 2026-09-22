/**
 * THE PARENT PROOF ON A REVISION — an edit is an edit of the approved sheet.
 *
 * Owner, 2026-09-22: "Revisions should auto generate edits directly to panel
 * pro production proof." The runtime (`revisionRequestFields` in
 * `runtime/atlas-panel-proof-topology.cjs`, `stageParentProofReference` in
 * `runtime/flat-first-atlas.cjs`) stages the parent's ACCEPTED proof sheet under
 * the edge's own Call-1 input allowlist and sends it as an identity:
 *
 *   revisionSequence        number   (1 on a first generation; always sent)
 *   parentAtlasRevisionId   string
 *   revisionContextHash     string
 *   revisionInstruction     string   (already folded into `customerPrompt`)
 *   affectedSurfaces        string[]
 *   parentProof             { storagePath, contentHash, byteSize, role: "parent-production-proof" }
 *
 * Until this module existed the edge ignored every one of those fields and
 * drew V2 from scratch with the instruction in the brief — a fresh design that
 * happened to mention the change, not an edit. This module is the half of the
 * seam the edge owns, kept pure so it can be tested without a server:
 *
 *   · `readRevisionFields`    — the request's revision identity, validated;
 *   · `verifyParentProof`     — the SAME three checks the container and the
 *                                customer assets get (allowlisted path, bytes
 *                                hash to the filename, bytes hash to the claim),
 *                                plus the byte count, refused as
 *                                `panel_proof_parent_invalid:<reason>` with
 *                                HTTP 400 — a caller naming bytes this side did
 *                                not verify is a request defect, not a 500;
 *   · `parentProofFraming`    — the ONE short text part that precedes the
 *                                image. No negatives, and it does not restate
 *                                the instruction (the brief already carries it);
 *   · `attachParentProof`     — text and image pushed TOGETHER, into the
 *                                single-turn `parts` and into the anchored
 *                                design turn, so the sheet never arrives
 *                                unlabelled (the pinned-example lesson);
 *   · `revisionCacheKey` / `providerCacheMaterial`
 *                              — the parent hash and the context hash folded
 *                                into the provider-cache request hash, so a
 *                                revision can never read V1's cached sheet.
 *                                On a first generation the material is
 *                                BYTE-IDENTICAL to what the edge hashed before
 *                                this module existed, asserted in the test.
 */

export const CALL1_INPUT_PATH = /^atlas-call1-inputs\/[0-9a-f]{64}\.png$/;
export const PARENT_PROOF_ROLE = "parent-production-proof";
const HASH_RE = /^[0-9a-f]{64}$/;

/** A request defect the caller can fix. Surfaces as its `status`, never 500. */
export class PanelProofRequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PanelProofRequestError";
    this.status = status;
  }
}

export type ParentProofReference = {
  storagePath: string;
  contentHash: string;
  byteSize: number | null;
  role: string;
};

export type RevisionIdentity = {
  revisionSequence: number;
  parentAtlasRevisionId: string | null;
  revisionContextHash: string | null;
  revisionInstruction: string | null;
  affectedSurfaces: string[];
  parentProof: ParentProofReference | null;
};

const str = (value: unknown) => String(value ?? "").trim();

/**
 * The revision identity as the request states it. `revisionSequence` defaults
 * to 1 (a caller that never learned the field is a first generation); a parent
 * proof on a first generation is a contradiction and is refused rather than
 * silently attached or silently dropped.
 */
export function readRevisionFields(body: Record<string, unknown> | null | undefined): RevisionIdentity {
  const rawSequence = body?.revisionSequence;
  const revisionSequence = rawSequence == null || rawSequence === "" ? 1 : Number(rawSequence);
  if (!Number.isSafeInteger(revisionSequence) || revisionSequence < 1) {
    throw new PanelProofRequestError(`panel_proof_revision_sequence_invalid:${String(rawSequence).slice(0, 32)}`);
  }
  const raw = body?.parentProof;
  const parentProof: ParentProofReference | null = raw && typeof raw === "object"
    && typeof (raw as { storagePath?: unknown }).storagePath === "string"
    ? {
      storagePath: str((raw as { storagePath: string }).storagePath),
      contentHash: str((raw as { contentHash?: unknown }).contentHash).toLowerCase(),
      byteSize: Number((raw as { byteSize?: unknown }).byteSize) > 0
        ? Number((raw as { byteSize?: unknown }).byteSize) : null,
      role: str((raw as { role?: unknown }).role) || PARENT_PROOF_ROLE,
    }
    : null;
  if (parentProof && revisionSequence <= 1) {
    throw new PanelProofRequestError("panel_proof_parent_invalid:sequence:a parent proof on a first generation");
  }
  const surfaces = Array.isArray(body?.affectedSurfaces) ? (body!.affectedSurfaces as unknown[]) : [];
  return {
    revisionSequence,
    parentAtlasRevisionId: str(body?.parentAtlasRevisionId) || null,
    revisionContextHash: str(body?.revisionContextHash).toLowerCase() || null,
    revisionInstruction: str(body?.revisionInstruction) || null,
    affectedSurfaces: surfaces.map((s) => str(s)).filter(Boolean),
    parentProof,
  };
}

export const sha256Hex = async (bytes: Uint8Array) => {
  // `as BufferSource`: TS 5.7+ types a Uint8Array over ArrayBufferLike, which
  // `digest` refuses; older toolchains accept the plain value. The cast reads
  // the same on both.
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

type DownloadBucket = {
  download: (path: string) => Promise<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: unknown }>;
};

/**
 * Download and verify the parent proof. Every failure is
 * `panel_proof_parent_invalid:<reason>` at HTTP 400. The four checks mirror
 * `attach()` on the hero view and the container/customer-asset checks in
 * `index.ts`: prefix, filename == bytes hash, claim == bytes hash, byte count.
 */
export async function verifyParentProof(bucket: DownloadBucket, parentProof: ParentProofReference) {
  const path = parentProof.storagePath;
  if (!CALL1_INPUT_PATH.test(path)) {
    throw new PanelProofRequestError(`panel_proof_parent_invalid:path:${path.slice(0, 64)}`);
  }
  if (!HASH_RE.test(parentProof.contentHash)) {
    throw new PanelProofRequestError(`panel_proof_parent_invalid:hash:${parentProof.contentHash.slice(0, 16)}`);
  }
  const { data, error } = await bucket.download(path);
  if (error || !data) throw new PanelProofRequestError(`panel_proof_parent_invalid:missing:${path}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  const digest = await sha256Hex(bytes);
  if (digest !== path.slice("atlas-call1-inputs/".length, -4)) {
    throw new PanelProofRequestError(`panel_proof_parent_invalid:not_content_addressed:${digest.slice(0, 16)}`);
  }
  if (digest !== parentProof.contentHash) {
    throw new PanelProofRequestError(`panel_proof_parent_invalid:hash_mismatch:${digest.slice(0, 16)}`);
  }
  if (parentProof.byteSize != null && parentProof.byteSize !== bytes.length) {
    throw new PanelProofRequestError(`panel_proof_parent_invalid:byte_size:${bytes.length}!=${parentProof.byteSize}`);
  }
  return { bytes, sha256: digest, byteSize: bytes.length };
}

/** The one short text part before the parent image. No negatives; no restated instruction. */
export function parentProofFraming(revisionSequence: number): string {
  return `APPROVED PARENT PRODUCTION PROOF — V${revisionSequence - 1}. `
    + "Reproduce it exactly; change only what the revision instruction asks. "
    + "Same three zones, same panel rectangles, same dimensions.";
}

type Part = Record<string, unknown>;

/**
 * Push the framed parent into the request. `parts` is the single-turn ask;
 * `creativeParts` is the anchored DESIGN turn (the parent is the approved
 * design, and the layout turn continues that conversation so it sees the sheet
 * by replay — attaching it a second time would double a 4K sheet in one
 * request). Text and image move together in both. Returns the attached-input
 * record for the receipt.
 */
export function attachParentProof(
  { parts, creativeParts, attached }: { parts: Part[]; creativeParts: Part[]; attached: Part[] },
  { revisionSequence, parentProof, bytes, sha256, encodeBase64 }: {
    revisionSequence: number; parentProof: ParentProofReference;
    bytes: Uint8Array; sha256: string; encodeBase64: (bytes: Uint8Array) => string;
  },
) {
  const framing = { text: parentProofFraming(revisionSequence) };
  const image = { inlineData: { mimeType: "image/png", data: encodeBase64(bytes) } };
  parts.push(framing, image);
  creativeParts.push(framing, image);
  const record = {
    role: PARENT_PROOF_ROLE, path: parentProof.storagePath, sha256, byteSize: bytes.length,
    framed: true, parentOfRevision: revisionSequence,
  };
  attached.push(record);
  return record;
}

/**
 * What a revision contributes to the provider-cache identity: null on a first
 * generation (so the material below is byte-identical to the pre-revision
 * edge), the sequence + both hashes otherwise.
 */
export function revisionCacheKey(identity: RevisionIdentity) {
  if (identity.revisionSequence <= 1 && !identity.revisionContextHash && !identity.parentProof) return null;
  return {
    revisionSequence: identity.revisionSequence,
    revisionContextHash: identity.revisionContextHash,
    parentProofContentHash: identity.parentProof?.contentHash ?? null,
  };
}

/**
 * The object the edge hashes for `runDurableImageProviderRequest.requestHash`.
 * Key ORDER is the pre-revision order — `{model, promptVersion, [turn,]
 * modelRequest}` — with `revision` appended only when there is one, so a first
 * generation hashes exactly what it always hashed.
 */
export function providerCacheMaterial({ model, promptVersion, modelRequest, turn, revision }: {
  model: string; promptVersion: string; modelRequest: string; turn?: string;
  revision: ReturnType<typeof revisionCacheKey>;
}) {
  return {
    model,
    promptVersion,
    ...(turn ? { turn } : {}),
    modelRequest,
    ...(revision ? { revision } : {}),
  };
}

/** The receipt block the runtime binds the edit to its parent with. */
export function revisionProvenance(identity: RevisionIdentity, attachedParent: Part | null) {
  return {
    revisionSequence: identity.revisionSequence,
    parentAtlasRevisionId: identity.parentAtlasRevisionId,
    revisionContextHash: identity.revisionContextHash,
    revisionInstruction: identity.revisionInstruction,
    affectedSurfaces: identity.affectedSurfaces,
    parentProofContentHash: identity.parentProof?.contentHash ?? null,
    parentProof: identity.parentProof
      ? { ...identity.parentProof, attached: Boolean(attachedParent) }
      : null,
  };
}
