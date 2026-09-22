/**
 * Deno tests for the revision half of `production-panel-proof`:
 *
 *   deno test --allow-read supabase/functions/production-panel-proof/
 *
 * `index.ts` is one `serve()` handler and cannot be imported without starting a
 * server, so the behaviour lives in `parent-proof.ts` (pure, tested directly)
 * and the WIRING is asserted against `index.ts`'s own source text: where the
 * parent is attached relative to the container, the pinned example, the
 * gold-standard artboards and the customer references; that BOTH provider-cache
 * hashes fold the revision in; that the receipt carries the provenance block.
 *
 * The runtime's field names (`revisionRequestFields` in
 * `runtime/atlas-panel-proof-topology.cjs`) are read the same way, so a rename
 * on either side of the seam fails here rather than on a live revision.
 */
import { assert, assertEquals, assertMatch, assertNotEquals, assertRejects, assertStrictEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CALL1_INPUT_PATH, PARENT_PROOF_ROLE, PanelProofRequestError,
  attachParentProof, parentProofFraming, providerCacheMaterial, readRevisionFields,
  revisionCacheKey, revisionProvenance, sha256Hex, verifyParentProof,
} from "./parent-proof.ts";

const here = new URL(".", import.meta.url);
const indexSource = await Deno.readTextFile(new URL("./index.ts", here));
const runtimeSource = await Deno.readTextFile(new URL("../../../runtime/atlas-panel-proof-topology.cjs", here));

const encodeBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** A content-addressed parent sheet: bytes, its hash, and the allowlisted path. */
async function stagedParent(seed = 7) {
  const bytes = new Uint8Array(512).map((_, i) => (i * seed + 3) % 251);
  const sha256 = await sha256Hex(bytes);
  return { bytes, sha256, storagePath: `atlas-call1-inputs/${sha256}.png` };
}

function bucketWith(objects: Record<string, Uint8Array>) {
  return {
    download: async (path: string) => objects[path]
      ? { data: new Blob([objects[path] as BlobPart]), error: null }
      : { data: null, error: new Error("not found") },
  };
}

function revisionBody(parent: { storagePath: string; sha256: string; bytes: Uint8Array }, overrides: Record<string, unknown> = {}) {
  return {
    customerPrompt: "brief\n\nREVISION V2 — apply this change to the approved parent production proof, keeping everything else exactly as approved: make the phone number larger",
    revisionSequence: 2,
    parentAtlasRevisionId: "rev-parent-1",
    revisionContextHash: "c".repeat(64),
    revisionInstruction: "make the phone number larger",
    affectedSurfaces: ["driver", "passenger"],
    parentProof: { storagePath: parent.storagePath, contentHash: parent.sha256, byteSize: parent.bytes.length, role: PARENT_PROOF_ROLE },
    ...overrides,
  };
}

// ─── (a) the parent is attached in the right position, framed ────────────────

Deno.test("(a) the parent lands as ONE framing text then the image, after the container, before every creative input", async () => {
  const parent = await stagedParent();
  const revision = readRevisionFields(revisionBody(parent));
  assert(revision.parentProof);
  const verified = await verifyParentProof(bucketWith({ [parent.storagePath]: parent.bytes }), revision.parentProof);

  // The request as index.ts builds it up to the point the parent is attached:
  // the prompt, then the container (structural), then the parent.
  const containerPart = { inlineData: { mimeType: "image/png", data: "CONTAINER" } };
  const parts: Record<string, unknown>[] = [{ text: "PROMPT" }, containerPart];
  const creativeParts: Record<string, unknown>[] = [];
  const attached: Record<string, unknown>[] = [{ role: "container", path: "atlas-call1-inputs/x.png" }];
  const record = attachParentProof({ parts, creativeParts, attached }, {
    revisionSequence: revision.revisionSequence, parentProof: revision.parentProof,
    bytes: verified.bytes, sha256: verified.sha256, encodeBase64,
  });
  // Then what index.ts pushes AFTER the parent: a gold-standard artboard pair
  // and a customer reference.
  parts.push({ text: "DESIGNPANEL GOLD-STANDARD ARTBOARD 1" }, { inlineData: { mimeType: "image/png", data: "GOLD" } });
  parts.push({ inlineData: { mimeType: "image/png", data: "CUSTOMER" } });

  assertEquals(parts.length, 7);
  assertEquals(parts[0], { text: "PROMPT" });
  assertStrictEquals(parts[1], containerPart);
  assertEquals(parts[2], { text: parentProofFraming(2) });
  assertEquals((parts[3] as { inlineData: { data: string } }).inlineData.data, encodeBase64(parent.bytes));
  assertEquals((parts[3] as { inlineData: { mimeType: string } }).inlineData.mimeType, "image/png");
  assertMatch(String((parts[4] as { text: string }).text), /GOLD-STANDARD/);
  assertEquals((parts[6] as { inlineData: { data: string } }).inlineData.data, "CUSTOMER");

  // The anchored DESIGN turn receives the same framed pair, first.
  assertEquals(creativeParts.length, 2);
  assertStrictEquals(creativeParts[0], parts[2]);
  assertStrictEquals(creativeParts[1], parts[3]);

  // The framing is exactly the dictated sentence: names V(n-1), no negatives,
  // no restated instruction.
  const framing = parentProofFraming(2);
  assertEquals(framing, "APPROVED PARENT PRODUCTION PROOF — V1. Reproduce it exactly; change only what the revision instruction asks. Same three zones, same panel rectangles, same dimensions.");
  assert(!/\b(no|not|never|don't|do not)\b/i.test(framing), "the framing carries no negatives");
  assert(!framing.includes("phone number"), "the framing does not restate the instruction");
  assertEquals(parentProofFraming(5), framing.replace("V1", "V4"));

  // The receipt record.
  assertEquals(record.role, PARENT_PROOF_ROLE);
  assertEquals(record.sha256, parent.sha256);
  assertEquals(record.byteSize, parent.bytes.length);
  assertEquals(record.framed, true);
  assertStrictEquals(attached[1], record);
});

Deno.test("(a) index.ts wires the parent after the container and the pinned example, before the artboards and the customer references", () => {
  const at = (needle: string) => {
    const i = indexSource.indexOf(needle);
    assert(i >= 0, `index.ts no longer contains ${JSON.stringify(needle)}`);
    return i;
  };
  const container = at('role: "container", path: containerPath');
  const pinnedLoop = at("for (const pinned of (body.separatedArtwork === true ? [] : PINNED_INPUTS))");
  const parent = at("attachParentProof({ parts, creativeParts, attached }");
  const artboards = at("DESIGNPANEL GOLD-STANDARD ARTBOARD");
  const customers = at("for (const asset of customerAssets)");
  assert(container < pinnedLoop && pinnedLoop < parent && parent < artboards && artboards < customers,
    `attachment order drifted: container@${container} pinned@${pinnedLoop} parent@${parent} artboards@${artboards} customers@${customers}`);
  // Gated exactly as specified: a parent AND a sequence above 1.
  assert(indexSource.includes("if (revision.parentProof && revision.revisionSequence > 1) {"));
  // Verified through the same door before it is attached.
  assert(indexSource.includes("await verifyParentProof(svc.storage.from(BUCKET), revision.parentProof)"));
  // The revision identity is read before intake spends anything.
  assert(at("const revision = readRevisionFields(body);") < at("const intake = customerPrompt ? await parseCustomerIntake"));
});

// ─── (b) a bad path or a bad hash is refused as panel_proof_parent_invalid / 400 ──

Deno.test("(b) a parent outside the Call-1 input allowlist is refused: panel_proof_parent_invalid, HTTP 400", async () => {
  const parent = await stagedParent();
  const bucket = bucketWith({ [parent.storagePath]: parent.bytes });
  for (const storagePath of [
    `atlas-panel-proof/${parent.sha256}.png`,   // the edge's OWN output prefix
    `atlas-call1-inputs/${parent.sha256}.jpg`,  // wrong extension
    `atlas-call1-inputs/../${parent.sha256}.png`,
    "atlas-call1-inputs/not-a-hash.png",
  ]) {
    const revision = readRevisionFields(revisionBody(parent, { parentProof: { storagePath, contentHash: parent.sha256 } }));
    const error = await assertRejects(() => verifyParentProof(bucket, revision.parentProof!), PanelProofRequestError);
    assertMatch(error.message, /^panel_proof_parent_invalid:path:/);
    assertEquals(error.status, 400);
  }
});

Deno.test("(b) a parent whose bytes do not hash to contentHash, or to its filename, or to byteSize, is refused at 400", async () => {
  const parent = await stagedParent();
  const other = await stagedParent(11);
  const bucket = bucketWith({ [parent.storagePath]: parent.bytes, [other.storagePath]: parent.bytes });

  // Claim disagrees with the bytes.
  let revision = readRevisionFields(revisionBody(parent, { parentProof: { storagePath: parent.storagePath, contentHash: other.sha256 } }));
  let error = await assertRejects(() => verifyParentProof(bucket, revision.parentProof!), PanelProofRequestError);
  assertMatch(error.message, /^panel_proof_parent_invalid:hash_mismatch:/);
  assertEquals(error.status, 400);

  // A swapped object: the filename names a hash the bytes are not.
  revision = readRevisionFields(revisionBody(parent, { parentProof: { storagePath: other.storagePath, contentHash: other.sha256 } }));
  error = await assertRejects(() => verifyParentProof(bucket, revision.parentProof!), PanelProofRequestError);
  assertMatch(error.message, /^panel_proof_parent_invalid:not_content_addressed:/);

  // Right bytes, wrong byte count.
  revision = readRevisionFields(revisionBody(parent, { parentProof: { storagePath: parent.storagePath, contentHash: parent.sha256, byteSize: 1 } }));
  error = await assertRejects(() => verifyParentProof(bucket, revision.parentProof!), PanelProofRequestError);
  assertMatch(error.message, /^panel_proof_parent_invalid:byte_size:/);

  // A claim that is not a sha256 at all.
  revision = readRevisionFields(revisionBody(parent, { parentProof: { storagePath: parent.storagePath, contentHash: "abc" } }));
  error = await assertRejects(() => verifyParentProof(bucket, revision.parentProof!), PanelProofRequestError);
  assertMatch(error.message, /^panel_proof_parent_invalid:hash:/);

  // Missing from the bucket.
  revision = readRevisionFields(revisionBody(parent));
  error = await assertRejects(() => verifyParentProof(bucketWith({}), revision.parentProof!), PanelProofRequestError);
  assertMatch(error.message, /^panel_proof_parent_invalid:missing:/);

  // A parent on a first generation is a contradiction, refused before any download.
  const first = assertThrows(() => readRevisionFields(revisionBody(parent, { revisionSequence: 1 })), PanelProofRequestError);
  assertMatch(first.message, /^panel_proof_parent_invalid:sequence/);
  assertEquals(first.status, 400);

  // And the handler surfaces that status rather than 500.
  assert(indexSource.includes("providerError?.status || Number((error as { status?: unknown })?.status) || 500"));
});

Deno.test("(b) a verified parent passes with its bytes, hash and size", async () => {
  const parent = await stagedParent();
  const revision = readRevisionFields(revisionBody(parent));
  const verified = await verifyParentProof(bucketWith({ [parent.storagePath]: parent.bytes }), revision.parentProof!);
  assertEquals(verified.sha256, parent.sha256);
  assertEquals(verified.byteSize, parent.bytes.length);
  assertEquals(verified.bytes, parent.bytes);
  // byteSize is optional on the wire (the runtime sends null when it has none).
  const noSize = readRevisionFields(revisionBody(parent, { parentProof: { storagePath: parent.storagePath, contentHash: parent.sha256 } }));
  assertEquals(noSize.parentProof!.byteSize, null);
  await verifyParentProof(bucketWith({ [parent.storagePath]: parent.bytes }), noSize.parentProof!);
});

// ─── (c) a first generation is byte-identical to before ──────────────────────

Deno.test("(c) a first generation (no parentProof) hashes and attaches exactly what it did before", () => {
  for (const body of [{}, { revisionSequence: 1 }, { revisionSequence: "1" }, { customerPrompt: "brief", revisionSequence: 1, parentProof: null }]) {
    const revision = readRevisionFields(body);
    assertEquals(revision.revisionSequence, 1);
    assertEquals(revision.parentProof, null);
    assertEquals(revisionCacheKey(revision), null);
  }
  const revision = readRevisionFields({ customerPrompt: "brief", revisionSequence: 1 });
  const modelRequest = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "PROMPT" }] }] });

  // The literal object the edge hashed before the revision fields existed.
  assertEquals(
    JSON.stringify(providerCacheMaterial({ model: "m", promptVersion: "v", modelRequest, revision: revisionCacheKey(revision) })),
    JSON.stringify({ model: "m", promptVersion: "v", modelRequest }),
  );
  assertEquals(
    JSON.stringify(providerCacheMaterial({ model: "m", promptVersion: "v", turn: "design", modelRequest, revision: revisionCacheKey(revision) })),
    JSON.stringify({ model: "m", promptVersion: "v", turn: "design", modelRequest }),
  );

  // Nothing is attached: the guard in index.ts needs a parent AND sequence > 1,
  // so the parts array a first generation sends is the one it always sent.
  const parts = [{ text: "PROMPT" }, { inlineData: { mimeType: "image/png", data: "CONTAINER" } }];
  const before = JSON.stringify(parts);
  if (revision.parentProof && revision.revisionSequence > 1) throw new Error("unreachable on a first generation");
  assertEquals(JSON.stringify(parts), before);

  // The receipt says so honestly.
  assertEquals(revisionProvenance(revision, null), {
    revisionSequence: 1, parentAtlasRevisionId: null, revisionContextHash: null, revisionInstruction: null,
    affectedSurfaces: [], parentProofContentHash: null, parentProof: null,
  });
});

// ─── (d) a revision's cache identity differs from the first generation's ─────

Deno.test("(d) the provider-cache identity folds the parent hash and the context hash in, so V2 never reads V1's sheet", async () => {
  const parent = await stagedParent();
  const modelRequest = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "PROMPT" }] }] });
  const first = readRevisionFields({ customerPrompt: "brief", revisionSequence: 1 });
  const second = readRevisionFields(revisionBody(parent));
  const material = (r: ReturnType<typeof readRevisionFields>, turn?: string) =>
    JSON.stringify(providerCacheMaterial({ model: "m", promptVersion: "v", modelRequest, turn, revision: revisionCacheKey(r) }));

  assertNotEquals(material(second), material(first));
  assertNotEquals(material(second, "design"), material(first, "design"));
  assertEquals(revisionCacheKey(second), {
    revisionSequence: 2, revisionContextHash: "c".repeat(64), parentProofContentHash: parent.sha256,
  });

  // A different parent, or a different context, is a different identity even
  // with an identical model request.
  const otherParent = await stagedParent(11);
  const third = readRevisionFields(revisionBody(otherParent));
  assertNotEquals(material(third), material(second));
  const otherContext = readRevisionFields(revisionBody(parent, { revisionContextHash: "d".repeat(64) }));
  assertNotEquals(material(otherContext), material(second));

  // Both hashes in index.ts go through the same fold.
  assertEquals(indexSource.split("revision: revisionCacheKey(revision)").length - 1, 2);
  assertEquals(indexSource.split("providerSha256(JSON.stringify(providerCacheMaterial({").length - 1, 2);
  assert(!/providerSha256\(JSON\.stringify\(\{/.test(indexSource), "a bare requestHash object bypasses the revision fold");
});

// ─── the receipt and the seam ────────────────────────────────────────────────

Deno.test("the response provenance echoes sequence, parent revision id, context hash and the parent proof's content hash", async () => {
  const parent = await stagedParent();
  const revision = readRevisionFields(revisionBody(parent));
  const record = { role: PARENT_PROOF_ROLE, sha256: parent.sha256 };
  assertEquals(revisionProvenance(revision, record), {
    revisionSequence: 2,
    parentAtlasRevisionId: "rev-parent-1",
    revisionContextHash: "c".repeat(64),
    revisionInstruction: "make the phone number larger",
    affectedSurfaces: ["driver", "passenger"],
    parentProofContentHash: parent.sha256,
    parentProof: { storagePath: parent.storagePath, contentHash: parent.sha256, byteSize: parent.bytes.length, role: PARENT_PROOF_ROLE, attached: true },
  });
  assert(indexSource.includes("provenance: revisionProvenance(revision, parentAttached)"));
});

Deno.test("the runtime sends the field names the edge reads, on the allowlist the edge enforces", () => {
  // `revisionRequestFields` in runtime/atlas-panel-proof-topology.cjs is the
  // producer of these fields; a rename on either side fails here.
  for (const field of ["revisionSequence", "parentAtlasRevisionId", "revisionContextHash", "revisionInstruction", "affectedSurfaces", "parentProof"]) {
    assert(runtimeSource.includes(`${field}:`), `runtime no longer sends ${field}`);
  }
  assert(runtimeSource.includes(`role: "${PARENT_PROOF_ROLE}"`));
  assert(runtimeSource.includes("attemptKey: `panel-proof:${revisionFields.revisionSequence}:"));
  // The runtime stages the parent under the same regex this side admits.
  assertEquals(String(CALL1_INPUT_PATH), "/^atlas-call1-inputs\\/[0-9a-f]{64}\\.png$/");
  assert(indexSource.includes("const CALL1_INPUT_PATH = /^atlas-call1-inputs\\/[0-9a-f]{64}\\.png$/;"));
  // The runtime's product route is `separatedArtwork: true`, where the pinned
  // format sheet is not attached -- so there the parent is the image right
  // after the container. Pinned here so a route change is a visible decision.
  assert(runtimeSource.includes("separatedArtwork: true,"));
  assert(indexSource.includes("for (const pinned of (body.separatedArtwork === true ? [] : PINNED_INPUTS))"));
});
