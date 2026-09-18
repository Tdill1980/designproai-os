/**
 * THE ACCEPTED CANONICAL A.T.L.A.S. IS THE SHEET THAT PASSED VALIDATION.
 *
 * Owner, 2026-08-31, reading flat-first-atlas.cjs after the post-repair
 * re-validation landed:
 *
 *   "even after successfully repairing and re-validating the sheet, the
 *    progressive/canonical A.T.L.A.S. object still points to the ORIGINAL
 *    pre-repair masterBytes and masterHash ... A.T.L.A.S. shown to humans =
 *    bad original, Panels/proof authority = repaired derivative. That is not
 *    one canonical authority."
 *
 * That was exactly the contradiction PanelPro printed on its face: "repaired
 * sheet · Master QC passed" over a sheet visibly full of holes, because the
 * object labelled canonical was the pre-repair bytes while the panels and
 * proofs were cut from a repaired sheet nobody could see or download.
 *
 * ⚠️ THIS OVERRIDES RULE 0.15's "the master is never mutated". That rule
 * reasoned that publishing the repaired hash as the panel lineage made a
 * correct pair report "the proof and the panel came from different masters" --
 * true while TWO masters exist and the panels cite the one that is not
 * canonical. Promoting the repaired sheet to canonical DISSOLVES that problem
 * instead of reintroducing it: afterwards there is exactly one accepted master,
 * and the panels, the proofs and both UIs all cite it.
 *
 * The pre-repair bytes survive as `preRepairMasterHash` -- provenance, never
 * called canonical, accepted, or "Master QC passed".
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");

/** The authoring body, from the repair to the persisted revision row. */
const acceptance = source.slice(
  source.indexOf("const repairStartedAt = Date.now();"),
  source.indexOf("preRepairMasterHash,") + 40,
);

test("the accepted master is chosen from the repair result, not assumed", () => {
  // `let`, not `const`, since 2026-09-18: the element graph promotes the
  // COMPOSITED sheet over this one when Layer 1 lands and re-validates. The
  // initial derivation is unchanged and still pinned -- what the repair decides
  // is still what acceptance starts from.
  assert.match(acceptance, /let acceptedMasterBytes = cutoutFill\.changed \? surfaceSourceBytes : masterBytes;/);
  assert.match(acceptance, /let acceptedMasterHash = cutoutFill\.changed \? panelSourceHash : masterHash;/);
  // preRepairMasterHash stays const: provenance is never reassigned.
  assert.match(acceptance, /const preRepairMasterHash = cutoutFill\.changed \? masterHash : null;/);
});

test("the ONLY thing allowed to reassign the accepted master is the element composite", () => {
  // `const` used to carry this guarantee for free. Relaxing it to `let` for
  // Layer 1 would otherwise open the accepted master to any later write, which
  // is precisely the "two masters, one of them canonical" defect this whole
  // file exists to prevent -- so the guarantee moves from the keyword into an
  // assertion instead of quietly disappearing with it.
  const body = source.slice(source.indexOf("let acceptedMasterBytes ="));
  const reassignments = [...body.matchAll(/^\s*acceptedMaster(?:Bytes|Hash|StoragePath) = /gm)];
  assert.equal(reassignments.length, 3,
    `expected exactly the three element-composite promotions, found ${reassignments.length}`);
  // All three sit inside the composite's own re-validated branch.
  const promotion = body.indexOf("acceptedMasterBytes = composited.bytes;");
  const revalidated = body.indexOf("revalidated.blockingFailures.length");
  assert.ok(revalidated !== -1 && revalidated < promotion,
    "the composited sheet must be re-validated BEFORE it replaces the accepted master");
});

test("acceptance happens AFTER the post-repair re-validation, never before", () => {
  // Order is the whole guarantee: bytes may only be promoted to canonical once
  // they have passed structural re-validation. Promoting first and validating
  // after would publish a malformed master and then complain about it.
  const revalidate = acceptance.indexOf("flat_atlas_repaired_master_invalid");
  const promote = acceptance.indexOf("let acceptedMasterBytes");
  assert.ok(revalidate !== -1, "the post-repair re-validation is gone");
  assert.ok(revalidate < promote,
    "bytes must pass re-validation BEFORE they are promoted to canonical");
});

test("every canonical binding cites the accepted master, not the pre-repair one", () => {
  // The four places that made this "not one canonical authority": the published
  // root, the panel lineage, the persisted bytes, and the revision row.
  assert.match(source, /master: \{ contentHash: acceptedMasterHash, bytes: acceptedMasterBytes \}/,
    "the published A.T.L.A.S. root must carry the accepted master");
  assert.match(source, /cutCallOnePanels\(surfaceSourceBytes, manifest, acceptedMasterHash, \{/,
    "the six panels must cite the accepted master as their lineage");
  assert.match(source, /masterBytes: acceptedMasterBytes, masterStoragePath: acceptedMasterStoragePath/,
    "the accepted bytes must enter durable recovery at the canonical path before publication");
  assert.match(source, /master_storage_path: acceptedMasterStoragePath,\s*\n\s*master_content_hash: acceptedMasterHash,\s*\n\s*master_byte_size: acceptedMasterBytes\.length,/,
    "the revision row must record the accepted master");
  assert.match(source, /sourceMasterHash: acceptedMasterHash,/,
    "each persisted panel's sourceMasterHash must be the accepted master");
});

test("THE PANEL AND PROOF BYTES MOVE WITH THE COMPOSITE, or the hash lies about them", () => {
  // The assertion directly above passes `surfaceSourceBytes` and
  // `acceptedMasterHash` to `cutCallOnePanels` and calls that "the accepted
  // master" -- but it only ever checked the HASH argument. The BYTES are a
  // different variable, and when the element composite promoted
  // `acceptedMasterBytes` without promoting `surfaceSourceBytes` this file
  // stayed green over exactly the defect it exists to prevent:
  //
  //   master shown to humans  = composited, company name on both flanks
  //   six PRINT PANELS        = the unlettered clean base
  //   seven 3D proofs         = conditioned on that same clean base
  //   panel `sourceMasterHash`= the COMPOSITED hash
  //
  // so PanelPro's "proof and panel came from the same master" check passes
  // while the bytes disagree, and the customer's print files ship blank. That
  // is the 2026-08-31 two-master ruling rebuilt under a new name. Receipts
  // green, pixels wrong -- the failure this file is named after.
  const body = source.slice(source.indexOf("let acceptedMasterBytes ="));
  const promotion = body.indexOf("acceptedMasterBytes = composited.bytes;");
  assert.ok(promotion !== -1, "the element composite promotion is gone");

  const cut = body.indexOf("cutCallOnePanels(surfaceSourceBytes");
  const projection = body.indexOf("projectionDerivative(surfaceSourceBytes)");
  assert.ok(cut !== -1 && projection !== -1,
    "the panels and the projection still read surfaceSourceBytes");

  // Between promoting the accepted master and cutting the panels from it, the
  // panel/proof bytes AND their recorded identity must both have followed.
  const between = body.slice(promotion, Math.min(cut, projection));
  assert.match(between, /^\s*surfaceSourceBytes = composited\.bytes;/m,
    "the panels and proofs must be built from the COMPOSITED sheet, not the clean base");
  assert.match(between, /^\s*panelSourceHash = composited\.contentHash;/m,
    "panelSourceHash is what a RESUME re-derives; leaving it on the clean base "
    + "turns flat_atlas_surface_source_mismatch into a guaranteed failure");

  // And nothing between that promotion and the cut may put the clean base back.
  assert.doesNotMatch(between, /surfaceSourceBytes = (?!composited\.bytes)/,
    "surfaceSourceBytes may only ever be promoted TO the composited sheet here");
});

test("nothing canonical still points at the raw pre-repair bytes", () => {
  // The specific defect, asserted as an absence so it cannot creep back under a
  // different name.
  assert.ok(!/master: \{ contentHash: masterHash, bytes: masterBytes \}/.test(source),
    "the published root still carries the pre-repair master");
  assert.ok(!/master_content_hash: masterHash,/.test(source),
    "the revision row still records the pre-repair master as canonical");
  assert.ok(!/storagePath: masterStoragePath, bytes: masterBytes/.test(source),
    "the pre-repair bytes are still what persists under the canonical path");
});

test("the pre-repair sheet survives as provenance, and only as provenance", () => {
  assert.match(source, /preRepairMasterHash,/,
    "the pre-repair hash must remain recorded for forensics");
  // It is null on a clean run -- there is nothing to distinguish -- and it must
  // never be described as a master.
  assert.match(acceptance, /PROVENANCE ONLY/);
  assert.match(acceptance, /not canonical,\s*\n\s*\/\/ not accepted/);
});

test("a CLEAN master is byte-identical and pays no extra transform", () => {
  // The owner's explicit requirement: "clean-master path stays byte/hash-
  // identical and incurs no additional transform." Both selections resolve
  // through `cutoutFill.changed`, which is false on a clean master, so the
  // accepted bytes ARE `masterBytes`, the accepted hash IS `masterHash`, and
  // the storage path is the one already derived -- no second hash, no second
  // path derivation, no re-encode.
  assert.match(acceptance, /: masterBytes;/, "clean path must fall through to the original bytes");
  assert.match(acceptance, /: masterHash;/, "clean path must fall through to the original hash");
  assert.match(acceptance, /let acceptedMasterStoragePath = cutoutFill\.changed\s*\n\s*\? atlasStoragePath\([^)]*\)\s*\n\s*: masterStoragePath;/,
    "clean path must reuse the already-derived storage path, not re-derive one");

  // And the re-validation itself is skipped when nothing changed, so a clean
  // run pays no extra structural pass on the critical path either.
  assert.match(acceptance, /if \(cutoutFill\.changed\) \{\s*\n\s*const repaired = await deterministicMasterChecks/,
    "the re-validation must be skipped entirely on a clean master");
});

test("the repaired sheet is addressed by its own content hash", () => {
  // A content-addressed store cannot have two different byte streams at one
  // path. The repaired sheet therefore gets a path derived from ITS hash.
  const pathDerivation = acceptance.slice(acceptance.indexOf("let acceptedMasterStoragePath"));
  assert.match(pathDerivation, /contentHash: acceptedMasterHash/,
    "the accepted master's storage path must be derived from the accepted hash");
});
